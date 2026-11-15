# Mythic Strings (proof of concept)

A locally hosted shadow-puppet battle game. Two players describe moves in text, the moves are turned into Move_Blocks built from registered primitives, validated in a deterministic Rapier2D physics world, and animated on a back-lit PixiJS stage.

## Prerequisites

- Node.js 22 or newer
- npm (bundled with Node)

## Commands

```sh
npm install      # install dependencies
npm run dev      # start the dev server at http://127.0.0.1:5173
npm test         # run unit and property tests once (vitest --run)
npm run build    # type-check (tsc --noEmit) and build to dist/
npm run preview  # serve the production build locally
```

## Layout

```
src/core/     pure logic and all timing/limit constants (src/core/config.ts)
src/sim/      Rapier2D physics (src/sim/rapier.ts loads the WASM once), primitives, Move_Validator
src/ai/       AI interfaces and their hardcoded implementations
src/content/  hardcoded scenario, default rig, fallback moves, lexicon
src/render/   PixiJS stage and puppet renderer
src/ui/       DOM screens and HUD
src/app/      wiring and the game loop
```

## What is hardcoded

There is no LLM, embedding model, database, network server, or account system. Every AI-backed component is a TypeScript interface in `src/ai/` with a hardcoded implementation next to it:

- Scenario_Orchestrator: returns the built-in "Arjun vs Duryodhan" scenario (content in `src/content/`) or a stub scenario for other names.
- Guardrail (`LexiconGuardrail`): word-list matching against `src/content/lexicon.ts` instead of a classifier.
- Move_Generator (`KeywordMoveGenerator`): maps prompt keywords and numbers to Move_Block templates instead of calling a model.
- Move_Library (`LocalMoveLibrary`): in-memory store, persisted to `localStorage`, using bag-of-words cosine similarity instead of embeddings.
- Recommendation_Engine and judge: rule-based scoring.

To swap in a real model or service, implement the matching interface in `src/ai/` and return your implementation from the factory in `src/app/services.ts`, which is the single place where the app constructs these components. The physics (Rapier deterministic build) and the Move_Block parser, validator, and turn logic are real and do not need replacing.

Tunable limits (input window 10 s, Reuse_Threshold 0.85, 200 spawned bodies, 8 s simulation cap, voting window 10 s) are in `src/core/config.ts`.
