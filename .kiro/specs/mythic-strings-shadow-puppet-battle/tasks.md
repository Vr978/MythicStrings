# Implementation Plan: Mythic Strings Shadow Puppet Battle (Local PoC)

## Overview

This plan builds a locally hosted proof of concept of Mythic Strings as a single Vite + TypeScript browser app. Everything AI-related is hardcoded behind TypeScript interfaces (Scenario_Orchestrator, Guardrail, Move_Generator, Move_Library, Recommendation_Engine, judge) so real models can be swapped in later. There is no LLM, embedding model, PostgreSQL, network server, or account system. Two Players share one browser (hot-seat).

Module layout mirrors the design's packages so it can be split later:

```
src/core/     pure logic: Move_Block schema, parser, printer, clamp, registry, turn reducer, scoring, voting, fallback selection
src/sim/      Rapier2D ragdolls, Move_Primitive implementations, Move_Validator
src/ai/       interfaces + hardcoded implementations (scenario, guardrail, move generator, library, recommendations, judge)
src/content/  hardcoded scenario "Arjun vs Duryodhan", default humanoid rig, fallback Move_Blocks, lexicon
src/render/   PixiJS back-lit stage and puppet renderer
src/ui/       DOM screens: scenario prompt, HUD, move input window, notifications, damage breakdown
src/app/      turn controller that wires core, sim, ai, render, and ui
```

Language: TypeScript (as in the design). Tests: Vitest + fast-check, run with `npx vitest --run`.

## Tasks

- [x] 1. Scaffold the project
  - [x] 1.1 Create the Vite + TypeScript app with dependencies, test setup, and README
    - Create `package.json` with scripts `dev` (`vite --host 127.0.0.1 --port 5173`), `build` (`tsc --noEmit && vite build`), `test` (`vitest --run`), `preview`
    - Dependencies: `pixi.js@^8`, `@dimforge/rapier2d-deterministic-compat` (deterministic build with embedded WASM, so no Vite WASM plugin is needed; if that package is unavailable, use `@dimforge/rapier2d-deterministic` with `vite-plugin-wasm` and `vite-plugin-top-level-await`), `pure-rand`
    - Dev dependencies: `typescript`, `vite`, `vitest`, `fast-check`
    - Create `tsconfig.json` (strict, ES2022, `moduleResolution: bundler`), `vite.config.ts`, `vitest.config.ts` (node environment for core/sim/ai tests), `index.html`, `src/main.ts` placeholder
    - Create empty module folders `src/core`, `src/sim`, `src/ai`, `src/content`, `src/render`, `src/ui`, `src/app`, and `src/core/config.ts` holding all timing and limit constants (input window 10 s, Reuse_Threshold 0.85, 200-body cap, 8 s sim cap, voting window 10 s)
    - Add `src/sim/rapier.ts` exporting an async `loadRapier()` that initializes the WASM once, and a smoke test `src/sim/rapier.test.ts` that creates a world and steps it once
    - Write `README.md` with prerequisites (Node 22), `npm install`, `npm run dev` (http://127.0.0.1:5173), `npm test`, `npm run build`, and a short note on which parts are hardcoded and where the swap-in interfaces live
    - _Requirements: 12.2, 11.10_

- [x] 2. Implement the Move_Block core (schema, registry, parser, printer, clamping)
  - [x] 2.1 Define Move_Block types and the Move_Primitive parameter registry
    - `src/core/moveblock/types.ts`: `MoveBlock`, `PrimitiveInvocation`, `TargetRules`, `ParamSchema` (per parameter: type number/integer/enum/boolean, required, min, max, enum values, declared order), `Result<T,E>`
    - `src/core/moveblock/registry.ts`: `PrimitiveRegistry` with `register` (rejects duplicate names with an error naming the duplicate and leaves the existing entry unchanged), `get`, `list`; a `RegistryView` read-only type
    - `src/core/moveblock/primitiveSchemas.ts`: parameter schemas for `projectile_volley`, `spawn_clones`, `apply_impulse`, `summon_object` with the ranges from the design, and a `createDefaultRegistry()` helper. Schemas live in core so parsing does not depend on Rapier
    - _Requirements: 12.1, 12.3, 12.9_

  - [x] 2.2 Implement the Move_Parser, Move_Printer, equivalence, canonical key, and clamping
    - `src/core/moveblock/parse.ts`: `parseMoveBlock(doc, registry)` checks byte size ≤ 65,536 before parsing, converts JSON syntax errors to line/column, validates fields in fixed order (`schemaVersion`, `displayName` 1-40 code points, `description` 1-280 code points, `primitives` 1-10, `targets`), then each invocation by index: registered name, then each parameter in declared order (presence, type, range, finiteness). Errors carry `path` (e.g. `primitives[2].params.count`) and `reason`; never return a partial object
    - `src/core/moveblock/print.ts`: `printMoveBlock(block, registry)` validates first, then emits canonical JSON with keys sorted by UTF-16 code unit order, invocation order preserved, `-0` normalized to `0`
    - `src/core/moveblock/equivalence.ts`: `equivalentMoveBlocks(a, b)` and `canonicalKey(block)` (stable string of canonical-printed `primitives` only, hashed with a small deterministic hash such as FNV-1a)
    - `src/core/moveblock/clamp.ts`: `clampToSchema(block, registry)` returning `{ block, clamped }`; only out-of-range numeric params change, each to its nearest bound
    - `src/core/moveblock/index.ts` re-exports
    - _Requirements: 12.6, 12.7, 12.8, 13.1, 13.2, 13.3, 13.5, 13.6, 13.7, 11.5_

  - [x] 2.3 Write property test for print/parse round trip
    - File `src/core/moveblock/roundtrip.property.test.ts`; build `arbMoveBlock(registry)` in `src/core/test/arbitraries.ts` from the registry's parameter schemas, with non-ASCII and emoji text for names and descriptions
    - **Property 1: Move_Block print/parse round trip**
    - **Validates: Requirements 12.1, 13.1, 13.3, 13.4**

  - [x] 2.4 Write property test for deterministic printing
    - File `src/core/moveblock/deterministic.property.test.ts`; generate equivalent objects with shuffled key insertion order and `-0` versus `0`
    - **Property 2: Deterministic printing**
    - **Validates: Requirements 13.7**

  - [ ]* 2.5 Write property tests for rejection with location and for clamping
    - File `src/core/moveblock/reject-clamp.property.test.ts`
    - **Property 3: Nonconforming documents and objects are rejected with a location** (Validates: Requirements 12.6, 12.7, 12.8, 13.2, 13.6)
    - **Property 7: Clamping lands in range and is idempotent** (Validates: Requirements 11.5)
    - Example test: a 65,537-byte document is rejected with the size-limit error (Requirement 13.5)

- [x] 3. Add hardcoded content and the Scenario_Orchestrator stub
  - [x] 3.1 Create Scenario types, trait validation, and hardcoded content
    - `src/core/scenario/types.ts`: `Scenario`, `StageSpec`, `PuppetCharacter`, `Trait`, `RigSpec`, `SegmentSpec`, `JointSpec`, `SegmentArt` per the design data models
    - `src/core/scenario/traits.ts`: `validateTraitSet` (3-6 Traits, name 1-40, description 1-200, integer magnitude 1-10, case-insensitive unique names) and `traitBalanceOk(scenario)` (magnitude sums differ by at most 10)
    - `src/content/rig.ts`: `DEFAULT_HUMANOID_RIG` with 10 segments (head, torso, 2 upper arms, 2 forearms, 2 thighs, 2 shins with the foot as part of the shin, which is the foot segment for standing checks) and revolute joints with lower/upper angle limits; `resolveRig(rig)` returns the rig when valid (6-20 bodies, every joint lower ≤ upper) and the default rig otherwise
    - `src/content/scenarios/arjunVsDuryodhan.ts`: Kurukshetra stage (dusk palette, floor, width/height), narrative text, Arjun (traits: Master Archer 9, Divine Weapon Affinity 8, Focus 7) and Duryodhan (traits: Mace Strength 9, Endurance 8, Pride 6), sums 24 and 23, 100 HP each, palettes and per-segment art with opacity in [0.3, 0.9] and a few perforation holes and ornaments
    - `src/content/fallbacks.ts`: at least 4 Fallback_Moves as Move_Blocks (e.g. "Staff Strike", "Lamp-Shadow Lunge", "Leather Shield Bash", "Pebble Toss") built only from registered primitives
    - `src/content/lexicon.ts`: blocked terms mapped to the six Derogatory_Content categories (keep placeholder entries mild and clearly marked for later curation)
    - _Requirements: 2.1, 2.6, 4.2, 5.1, 5.2, 5.3, 5.6, 17.1_

  - [x] 3.2 Implement the Scenario_Orchestrator interface with a hardcoded implementation
    - `src/ai/scenario.ts`: `interface ScenarioOrchestrator { generate(prompt: string): Promise<Result<Scenario, ScenarioError>> }`, `validateScenarioPrompt(text)` (trimmed length 1-500), and `HardcodedScenarioOrchestrator`
    - Behaviour: split the prompt on `vs`/`versus`/`,`/`and` to extract names; more than 4 names returns the 4-character-maximum error; "Arjun vs Duryodhan" (case-insensitive) returns the hardcoded scenario; other names map to a stub scenario that reuses the Kurukshetra stage, uses the typed names, and assigns balanced template traits; 0 or 1 names are filled up to 2 characters with a generic "Shadow Warrior"
    - Every returned Scenario passes `validateTraitSet`, `traitBalanceOk`, and `resolveRig`, with starting HP 100
    - _Requirements: 3.1, 3.3, 4.2, 4.3, 4.4, 4.10, 5.3, 5.6_

  - [ ]* 3.3 Write property tests for scenario generation rules
    - File `src/ai/scenario.property.test.ts`
    - **Property 44: Scenario_Prompt gate** (Validates: Requirements 3.1, 3.3, 3.5)
    - **Property 46: Named characters are honored** (Validates: Requirements 4.3, 4.4, 4.10)
    - **Property 49: Trait set validation** (Validates: Requirements 5.1, 5.2)

- [x] 4. Build ragdoll physics, Move_Primitives, and the Move_Validator
  - [x] 4.1 Implement `SimWorld` with ragdoll puppets
    - `src/sim/world.ts`: `SimWorld.create(stage, characters, seed)`, `snapshot()`, `fromSnapshot(bytes)`, `step()` at fixed dt 1/60 s, `jointAngles(id)`, `setStandingMotors(id, enabled)`, `releaseMotors(id)` with a `defeated` flag that blocks re-enabling
    - `src/sim/ragdoll.ts`: one dynamic body per segment, revolute joints with limits enabled, PD motors targeting a rest pose plus a torso-uprighting torque; post-step limit check applying corrective angular velocity when an angle exceeds its limit by more than 1 degree
    - Canonical creation order (characters by Scenario order, segments by index); contact event collection per step (collider pair and impulse) mapped to character IDs; seeded PRNG via `pure-rand`; no `Math.random` or wall-clock reads in the step loop; never mutate collider transforms after creation
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.7, 2.8, 11.10_

  - [x] 4.2 Implement the four Move_Primitives in Rapier2D
    - `src/sim/primitives/types.ts`: `MovePrimitiveImpl` with `name` and `apply(ctx, params)`; `ctx` provides the actor, target, world handles, seeded RNG, and a spawn counter
    - `src/sim/primitives/projectileVolley.ts` (arrows spawned from the actor's hand toward the target with `count`, `speed`, `spreadDeg`, `intervalMs`), `spawnClones.ts` (small translucent clone bodies, `count`, `lifetimeMs`, `behavior` charge/surround), `applyImpulse.ts` (impulse on the actor's chosen segment toward the target, for mace strike or charge; affects only targeted bodies), `summonObject.ts` (boulder or mace dropped above the target from `dropHeight` with `sizeScale`)
    - `src/sim/primitives/index.ts`: map from primitive name to implementation, checked at startup against `createDefaultRegistry()` so every schema has an implementation
    - `src/sim/execute.ts`: `executeMoveBlock(world, block, actorId, targetId, seed)` invokes only registered primitives in block order and never evaluates generated code
    - _Requirements: 2.2, 12.2, 1.6_

  - [x] 4.3 Implement the headless Move_Validator
    - `src/sim/validator.ts`: `validateMoveBlock(job, registry, clock)` restores the snapshot into a fresh scratch world, executes the block, steps until effects settle or 480 steps (8 s), and marks invalid on non-finite position/velocity, more than 200 spawned bodies, the 8 s cap, or a 500 ms wall-clock budget
    - Return `{ valid: true, hits, finalSnapshot, simSteps }` with one `HitResult` per Puppet_Character (integer contact count ≥ 0, finite total impulse ≥ 0, zeros when untouched) or `{ valid: false, reason }`
    - `validateWithClamp(job, registry, clock)`: when invalid and `clampToSchema` changes something, run exactly one more pass with its own budget
    - The live world is never touched; validation runs synchronously on the main thread for the PoC (a worker can be added later)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.7, 11.8, 11.9_

  - [x] 4.4 Write property test for simulation determinism
    - File `src/sim/determinism.property.test.ts`; small scenes (2 characters, ≤ 30 effect bodies), `numRuns: 100`, generated blocks from `arbMoveBlock` with reduced counts and random seeds; validate twice from the same snapshot and compare hits and final snapshot bytes
    - **Property 13: Simulation determinism**
    - **Validates: Requirements 11.9, 11.10**

  - [ ]* 4.5 Write additional simulation property tests
    - File `src/sim/sim.property.test.ts`
    - **Property 12: Validation does not change live state** (Validates: Requirements 11.8)
    - **Property 14: Hit results cover every character** (Validates: Requirements 11.7)
    - **Property 15: Joint limits and connectivity hold under any force** (Validates: Requirements 2.4, 2.8)
    - **Property 16: Rig resolution** (Validates: Requirements 2.1, 2.6)
    - Example tests: NaN impulse is invalid, 201 bodies is invalid (Requirement 11.4)

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement the hardcoded AI layer behind swap-in interfaces
  - [x] 6.1 Implement the lexicon Guardrail
    - `src/ai/guardrail.ts`: `interface Guardrail { classify(text, kind): Promise<Result<Verdict, 'timeout'|'unavailable'>>; rewrite(text, ctx): Promise<Result<string, 'timeout'|'unavailable'>> }` and `LexiconGuardrail`
    - Classification: NFKC + lowercase + simple leetspeak folding, match against `src/content/lexicon.ts`; `pickCategory` in `src/core/guardrail/pickCategory.ts` returns exactly one category by fixed priority
    - Rewrite: remove blocked words, then re-classify; if the result is empty or still derogatory, the caller performs a Fallback_Move (one rewrite attempt only)
    - In-memory moderation log of `{category, timestamp, text, textKind}` for every rejection
    - _Requirements: 3.2, 3.4, 10.1, 10.2, 10.3, 10.4, 10.9, 10.12_

  - [x] 6.2 Implement the keyword/template Move_Generator
    - `src/ai/moveGenerator.ts`: `interface MoveGenerator { generate(prompt, ctx): Promise<Result<GeneratedMove, GenError>>; adjust(block, prompt, ctx): Promise<Result<MoveBlock, GenError>> }` and `KeywordMoveGenerator`
    - Keyword map: `arrow`/`volley`/`shoot` → `projectile_volley` with `count` from the first number in the text (words like "hundred" also parsed); `clone`/`hair`/`copies` → `spawn_clones`; `mace`/`strike`/`punch`/`charge` → `apply_impulse`; `boulder`/`rock`/`summon` → `summon_object`; several keywords combine into one block in text order (max 10 invocations); no keyword gives the closest template plus a note (≤ 200 chars) naming the unsupported effect
    - Out-of-range numbers are clamped and noted; display name 1-40 chars and a one-sentence description ≤ 150 chars are generated from templates; output passes `parseMoveBlock` and `validateGeneratedMeta` (`src/core/moveblock/meta.ts`)
    - `adjust` changes only parameter values (via `applyParamAdjustments` in `src/core/moveblock/adjust.ts`) to match numbers in the new prompt, clamped to schema bounds, keeping primitives and order
    - _Requirements: 9.1, 9.2, 9.5, 9.6, 12.3, 14.4_

  - [x] 6.3 Implement the in-memory Move_Library with localStorage persistence
    - `src/core/text/similarity.ts` (pure, so core logic can reuse it): tokenizer (lowercase, strip punctuation, simple stopword list, number tokens kept) and bag-of-words cosine similarity in [0, 1]
    - `src/ai/moveLibrary.ts`: `interface MoveLibrary { nearest(prompt); topK(prompt, k); store(block, prompt, creatorId); incrementUsage(id); size() }` and `LocalMoveLibrary`
    - Exact prompt match (originating or linked) returns score 1.0; otherwise best cosine score; `pickBest` in `src/core/library/pickBest.ts` breaks ties by higher usage count, then earlier creation time; empty library returns `{ entry: null, score: 0 }`
    - Idempotent store keyed by `canonicalKey`: equivalent blocks link the new prompt to the existing entry and keep its creator and creation time; new entries start with usage count 0
    - Persist to `localStorage` under one key when available (serialized with `printMoveBlock`), fall back to memory-only in Node tests; a failed write leaves no partial entry
    - _Requirements: 14.1, 14.2, 14.5, 14.6, 14.7, 14.10, 10.8_

  - [x] 6.4 Implement the Recommendation_Engine and previous-Moves list
    - `src/ai/recommend.ts`: `interface RecommendationEngine { forWindow(ctx): Promise<LibraryEntry[]>; forTyping(prompt): Promise<LibraryEntry[]> }` and `LocalRecommendationEngine`, using `rankRecommendations` in `src/core/recommend/rank.ts` (0.5 trait similarity + 0.2 situational + 0.3 novelty, deduplicated, sorted, top 5, entry ID tie-break) and library `topK(prompt, 5)` while typing
    - `src/core/recommend/recentDistinct.ts`: `recentDistinct(history, playerId, 10)`
    - _Requirements: 8.1, 8.2, 8.5, 8.7_

  - [ ]* 6.5 Write tests for the AI layer
    - File `src/ai/ai.property.test.ts`
    - **Property 9: Library storage is idempotent** (Validates: Requirements 14.6)
    - **Property 10: Store, exact lookup, and usage counting** (Validates: Requirements 14.1, 14.5, 14.7)
    - **Property 11: Best-match selection and tie-breaking** (Validates: Requirements 14.2)
    - **Property 40: Exactly one rejection category** (Validates: Requirements 10.1)
    - **Property 38: Recommendation lists** (Validates: Requirements 8.1, 8.5)
    - Example tests in `src/ai/moveGenerator.test.ts`: "fire a volley of a hundred arrows" gives `projectile_volley` with count 100; "make clones from strands of hair" gives `spawn_clones`; "summon a boulder and strike with my mace" gives two invocations in that order; unsupported text returns a note (Requirements 9.1, 9.5)

- [x] 7. Implement turn logic, fallback selection, and damage scoring
  - [x] 7.1 Implement damage scoring, creativity decay, trait alignment, and voting
    - `src/core/scoring/damage.ts`: `hitFactor`, `damageScore` returning `{ damage, contributions }` (integer 0-30, 0 when target contact count is 0, contributions sum to the unrounded raw score), `fallbackDamageScore`, `creativityForUse(raw, prev)` (halves on repeat use, 0 stays 0)
    - `src/ai/judge.ts`: `interface Judge { score(move, ctx): Promise<{ creativity: number; traitAlignment: number }> }` and `KeywordJudge` (creativity from primitive count and novelty versus Battle history; trait alignment from keyword overlap between the block's primitives/prompt and the actor's Trait names, e.g. arrows ↔ "Master Archer", mace ↔ "Mace Strength")
    - `src/core/voting/votes.ts`: `castVote` and `voteShare` (0.5 when no votes); in the PoC the "audience" is local up/down buttons
    - _Requirements: 15.1, 15.2, 15.3, 15.5, 15.6, 15.7, 15.9, 15.10, 16.2, 16.3, 16.7, 16.8, 16.9, 17.4_

  - [x] 7.2 Write property tests for damage scoring
    - File `src/core/scoring/damage.property.test.ts`
    - **Property 19: Damage bounds and no-contact rule** (Validates: Requirements 15.2, 15.7)
    - **Property 20: Damage is monotonic in Vote_Share** (Validates: Requirements 15.6)

  - [x] 7.3 Implement the pure turn reducer, resolution decision, and fallback ordering
    - `src/core/turn/state.ts`: `BattleState`, `BattleConfig`, `Phase`, `BattleEvent`, `Effect`, `ResolvedMove`, `FallbackReason`
    - `src/core/turn/reducer.ts`: `startBattle(scenario, config, seed)` (seeded uniform first actor, rotation of Scenario order), `reduce(state, event)` with the phase order input → moderation → resolution → validation → animation → voting → damage, input accepted only from the acting Player during the window (otherwise unchanged state plus a rejection effect), `applyDamage` clamping HP to [0, startingHP], `nextActor` skipping 0-HP characters, `battleOutcome` (winner, draw, optional Turn limit)
    - `src/core/turn/closeWindow.ts`: `closeWindowDecision(fieldText, selection, trigger)` per Requirement 7
    - `src/core/turn/resolveDecision.ts`: the design's decision table as a pure function
    - `src/core/fallback/orderFallbacks.ts`: order Fallback_Moves by similarity (bag-of-words cosine from `src/core/text/similarity.ts`) between the highest-magnitude Trait name and fallback descriptions, ties by set order; selection takes the first valid one, or ends the Turn with damage 0 when none is valid
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 7.4, 7.5, 7.6, 7.7, 7.8, 8.4, 8.8, 9.4, 9.8, 10.4, 10.5, 10.7, 10.10, 11.6, 14.3, 14.8, 14.9, 15.8, 17.2, 17.6, 17.7, 18.5_

  - [x] 7.4 Write property test for the Health_Points invariant
    - File `src/core/turn/hp.property.test.ts`; random event sequences including invalid inputs, fallbacks, and damage 0-30
    - **Property 26: Health_Points invariant**
    - **Validates: Requirements 6.10, 15.8**

  - [ ]* 7.5 Write additional turn logic property tests
    - File `src/core/turn/turn.property.test.ts`
    - **Property 27: Turn order is a rotation of Scenario order** (Validates: Requirements 6.1)
    - **Property 28: Next actor skips defeated characters** (Validates: Requirements 6.2, 6.6)
    - **Property 29: Battle outcome** (Validates: Requirements 6.7, 6.8, 6.9)
    - **Property 31: Only the acting Player can submit, only during the window** (Validates: Requirements 6.4, 6.5, 7.9)
    - **Property 32: Window close decision** (Validates: Requirements 7.4, 7.5, 7.6, 7.7, 7.8)
    - **Property 34: Move resolution decision table** (Validates: Requirements 8.4, 9.1, 9.4, 9.8, 10.4, 10.5, 10.7, 10.10, 11.6, 14.3, 14.8, 14.9, 18.5)
    - **Property 37: Fallback ordering and selection** (Validates: Requirements 17.2, 17.6, 17.7)

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Build the PixiJS renderer and the DOM UI
  - [x] 9.1 Implement the back-lit stage and puppet renderer
    - `src/render/stage.ts`: PixiJS v8 `Application`, full-screen warm radial gradient backlight with slight seeded flicker, Kurukshetra backdrop silhouettes from the stage palette, floor line
    - `src/render/puppet.ts`: one `Mesh` per segment from its outline polygon triangulated with earcut (holes for perforations), fill from palette, alpha clamped to [0.3, 0.9], `blendMode = 'multiply'`; ornaments drawn at segment-local positions; `buildSegmentGeometry` falls back to the plain outline on bad perforation data
    - `src/render/pivots.ts`: rivet circles at each joint's screen position every frame, culled only outside the visible Stage
    - `src/render/effects.ts`: pooled meshes for arrows, clones, boulders with the same translucent multiply style
    - `src/render/renderer.ts`: `PuppetRenderer.sync(world)` maps sim body transforms (meters) to screen pixels each frame
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x] 9.2 Implement the UI screens and HUD
    - `src/ui/scenarioScreen.ts`: Scenario_Prompt field prefilled with "Arjun vs Duryodhan", 1-500 character validation message, submit disabled while checking, per-agent status chips (Scene, Character, Trait) driven by the hardcoded orchestrator, rejection and error messages that keep the text editable
    - `src/ui/hud.ts`: per character name, HP bar with integer value, Trait list with name, description, magnitude; updates on HP change
    - `src/ui/moveInput.ts`: Move_Input_Window panel for the acting Player (hot-seat banner "Player 1 / Player 2 — your turn"), countdown `ceil(remainingMs/1000)` refreshed every 250 ms, `maxlength=200` field, empty-submit indicator, recommended list (top 5) and previous-Moves list (up to 10) with click-to-select, empty/unavailable indicators, inputs disabled on close
    - `src/ui/notifications.ts`: queue with `minVisibleMs` (≥ 3 s) for rewrite/fallback notices with reason and category, generator notes, and fallback-scorer notice
    - `src/ui/damagePanel.ts` and `src/ui/votePanel.ts`: damage breakdown (hit base, creativity, trait alignment, Vote_Share) visible ≥ 3 s; local audience up/down buttons with a 10 s voting countdown and a toggle to disable voting (Vote_Share 0.5)
    - `src/ui/styles.css`: shadow-theatre styling
    - _Requirements: 3.1, 3.3, 3.4, 3.7, 4.7, 5.4, 5.5, 7.1, 7.2, 7.3, 7.7, 7.9, 8.2, 8.6, 8.7, 9.7, 10.6, 15.4, 15.10, 16.4, 17.5_

- [x] 10. Wire the game together and verify it runs locally
  - [x] 10.1 Implement the turn controller and app entry point
    - `src/app/turnController.ts`: executes reducer effects: opens the input window timer, runs Guardrail → library `nearest` → reuse (with `adjust` when numbers differ) or `generate` → Guardrail on display name/description → `validateWithClamp` → fallback chain; enforces the 1 s / 4 s budgets and the 500 ms fallback start; stores accepted non-fallback blocks and increments usage after the animation starts; plays the validated block in the live world with the same snapshot and seed; opens voting, calls the Judge, applies damage, releases motors at 0 HP, advances Turns, shows the Battle result with a "New battle" button
    - Waiting animation (idle sway) starts on window close and stops on the first Move frame
    - `src/app/services.ts`: one factory that constructs the hardcoded implementations of every AI interface, the single place to swap in real models later
    - `src/main.ts`: load Rapier, show the scenario screen, start the Battle with the returned Scenario, run the render loop
    - _Requirements: 6.3, 9.4, 10.6, 10.11, 11.1, 11.9, 14.3, 14.4, 14.5, 14.8, 15.1, 15.8, 16.1, 17.3, 17.5, 17.8, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 2.5, 2.7_

  - [ ]* 10.2 Write a headless integration test for a full Battle
    - File `src/app/battle.integration.test.ts`: drive the turn controller with fake timers, a no-op renderer/UI adapter, and scripted prompts ("fire a volley of 50 arrows", "make clones from strands of hair", an empty window, a prompt containing a lexicon term) until a winner or Turn limit; assert phases, fallback reasons, HP clamping, library reuse on a repeated prompt, and that Fallback_Moves are never stored
    - **Property 35: Only accepted, valid, non-fallback Moves are stored** (Validates: Requirements 10.8, 11.6, 17.8)
    - _Requirements: 6.3, 6.7, 7.6, 14.3, 14.5, 17.8_

  - [x] 10.3 Build, test, and confirm the dev server responds on localhost
    - Run `npm run build` and `npx vitest --run`; fix any failures
    - Start `npm run dev` as a background process (not a blocking shell command), then request `http://127.0.0.1:5173/` (e.g. `curl -sI`) and confirm HTTP 200 and that the page HTML loads `src/main.ts`
    - Report the URL and leave the server running for the user
    - _Requirements: 1.7, 12.2_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Scope is a local PoC: no LLM, embedding model, database, network server, or accounts. Each AI component (`ScenarioOrchestrator`, `Guardrail`, `MoveGenerator`, `MoveLibrary`, `RecommendationEngine`, `Judge`) is a TypeScript interface in `src/ai/` with a hardcoded implementation, constructed in `src/app/services.ts`.
- Requirements that depend on real AI latency or quality (3.2 and 10.1 timing, 4.6, 9.3, 14.2 timing, 8.3) are met trivially by the local implementations and are not benchmarked in the PoC. Spectators, multi-device play, and the PostgreSQL library are deferred.
- Tasks marked with `*` are optional extra tests. The property tests the PoC relies on (Properties 1, 2, 13, 19, 20, 26) are required.
- Each property test uses fast-check with `numRuns: 100` and a tag comment `// Feature: mythic-strings-shadow-puppet-battle, Property N: <title>`.
- Run tests with `npx vitest --run` (never watch mode).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "4.1"] },
    { "id": 3, "tasks": ["2.3", "2.4", "2.5", "3.3", "4.2", "7.1"] },
    { "id": 4, "tasks": ["4.3", "6.1", "6.2", "6.3", "7.2"] },
    { "id": 5, "tasks": ["4.4", "4.5", "6.4", "7.3"] },
    { "id": 6, "tasks": ["6.5", "7.4", "7.5", "9.1"] },
    { "id": 7, "tasks": ["9.2"] },
    { "id": 8, "tasks": ["10.1"] },
    { "id": 9, "tasks": ["10.2"] },
    { "id": 10, "tasks": ["10.3"] }
  ]
}
```
