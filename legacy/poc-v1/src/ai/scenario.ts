// Scenario_Orchestrator interface and a hardcoded, local implementation (design: "Scenario_Orchestrator").
// The hardcoded orchestrator stands in for the Scene_Agent, Character_Agent, and Trait_Agent so the
// rest of the game can run end to end without any AI service.
import { err, ok, type Result } from '../core/moveblock/types';
import { traitBalanceOk, validateTraitSet } from '../core/scenario/traits';
import { STARTING_HP, type PuppetCharacter, type Scenario, type SegmentArt, type Trait } from '../core/scenario/types';
import { DEFAULT_HUMANOID_RIG, resolveRig } from '../content/rig';
import { ARJUN_VS_DURYODHAN, KURUKSHETRA_STAGE } from '../content/scenarios/arjunVsDuryodhan';

export const SCENARIO_PROMPT_MIN = 1;
export const SCENARIO_PROMPT_MAX = 500;
export const SCENARIO_CHARACTERS_MIN = 2;
export const SCENARIO_CHARACTERS_MAX = 4;
/** Name used to fill a Scenario up to 2 characters when the prompt names 0 or 1 (Req 4.4). */
export const FILL_CHARACTER_NAME = 'Shadow Warrior';

export const SCENARIO_AGENTS = ['scene', 'character', 'trait'] as const;
export type ScenarioAgent = (typeof SCENARIO_AGENTS)[number];
export type AgentStatus = 'pending' | 'in_progress' | 'complete' | 'failed';
export type AgentStatusListener = (agent: ScenarioAgent, status: AgentStatus) => void;

export type ScenarioError =
  | { kind: 'invalid_prompt'; message: string }
  | { kind: 'too_many_characters'; count: number; max: typeof SCENARIO_CHARACTERS_MAX; message: string }
  | { kind: 'agent_failed'; agent: ScenarioAgent; message: string }
  | { kind: 'timeout'; message: string };

export interface GenerateOptions {
  /** Called on every agent status transition, for the UI status chips (Req 4.7). */
  onAgentStatus?: AgentStatusListener;
}

export interface ScenarioOrchestrator {
  generate(prompt: string, options?: GenerateOptions): Promise<Result<Scenario, ScenarioError>>;
}

const PROMPT_LIMIT_MESSAGE = `Scenario prompt must be ${SCENARIO_PROMPT_MIN} to ${SCENARIO_PROMPT_MAX} characters.`;

/**
 * Accepts the prompt when its length after trimming is 1 to 500 characters (Req 3.1, 3.3).
 * Returns the original, untrimmed text on success so it can be forwarded unchanged.
 */
export function validateScenarioPrompt(text: string): Result<string, ScenarioError> {
  const length = [...text.trim()].length;
  if (length < SCENARIO_PROMPT_MIN || length > SCENARIO_PROMPT_MAX) {
    return err({ kind: 'invalid_prompt', message: PROMPT_LIMIT_MESSAGE });
  }
  return ok(text);
}

/** Splits a prompt on `vs`, `vs.`, `versus`, `and`, and commas into trimmed, non-empty names. */
export function extractCharacterNames(prompt: string): string[] {
  return prompt
    .split(/,|(?:^|\s)(?:vs\.?|versus|and)(?=\s|$)/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Balanced template Trait sets: every set sums to 21, so any mix stays within the balance limit.
const TRAIT_TEMPLATES: readonly (readonly Trait[])[] = [
  [
    { name: 'Swift Strikes', description: 'Lands quick blows before the foe can react.', magnitude: 8 },
    { name: 'Steady Guard', description: 'Holds a firm stance against incoming attacks.', magnitude: 7 },
    { name: 'Battle Cry', description: 'A shout that steadies allies and shakes enemies.', magnitude: 6 },
  ],
  [
    { name: 'Iron Grip', description: 'Never lets go of weapon or foe.', magnitude: 7 },
    { name: 'Keen Eye', description: 'Spots openings in any defence.', magnitude: 7 },
    { name: 'Stubborn Will', description: 'Keeps fighting through pain and doubt.', magnitude: 7 },
  ],
  [
    { name: 'Agile Footwork', description: 'Darts in and out of reach across the stage.', magnitude: 8 },
    { name: 'Shadow Feint', description: 'Draws the eye one way and strikes from another.', magnitude: 6 },
    { name: 'Tough Hide', description: 'Shrugs off glancing blows.', magnitude: 7 },
  ],
  [
    { name: 'Heavy Blows', description: 'Every strike carries crushing weight.', magnitude: 9 },
    { name: 'Patience', description: 'Waits for the perfect moment to attack.', magnitude: 6 },
    { name: 'Lamp-Lit Resolve', description: 'Grows bolder as the lamp burns brighter.', magnitude: 6 },
  ],
];

// Four-color palettes [skin, garment, accent, trim], one per character slot.
const PALETTES: readonly (readonly [string, string, string, string])[] = [
  ['#3f7a5a', '#d9a441', '#7a3b1f', '#1f4d6b'],
  ['#b5483a', '#5c2a2a', '#c98a2e', '#2f2a1f'],
  ['#c27c3a', '#2e5e4e', '#e0b84c', '#4a2c1a'],
  ['#8a5aa8', '#3a2d5c', '#d98c5f', '#1f1a2e'],
];

function stubArt(palette: readonly [string, string, string, string]): SegmentArt[] {
  const [skin, garment, accent, trim] = palette;
  const colorByRole: Record<string, string> = {
    head: skin,
    upper_arm: skin,
    forearm: skin,
    hand: skin,
    torso: garment,
    pelvis: garment,
    thigh: accent,
    shin: trim,
    foot: trim,
    accessory: accent,
  };
  return DEFAULT_HUMANOID_RIG.segments.map((s) => ({
    segmentId: s.id,
    color: colorByRole[s.role] ?? garment,
    opacity: s.role === 'torso' ? 0.75 : 0.65,
    ...(s.role === 'torso' ? { ornaments: [{ pattern: 'zigzag' as const, position: { x: 0, y: 0.2 }, scale: 0.05 }] } : {}),
  }));
}

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'character';

function stubCharacter(name: string, index: number): PuppetCharacter {
  const palette = PALETTES[index % PALETTES.length]!;
  const traits = TRAIT_TEMPLATES[index % TRAIT_TEMPLATES.length]!;
  return {
    id: `${slug(name)}-${index + 1}`,
    name,
    description: `${name}, a shadow puppet warrior who fights on the field of Kurukshetra.`,
    controllerPlayerId: `player-${index + 1}`,
    appearance: { palette: [...palette], segments: stubArt(palette) },
    rig: resolveRig(DEFAULT_HUMANOID_RIG),
    traits: traits.map((t) => ({ ...t })),
    startingHP: STARTING_HP,
  };
}

const listNames = (names: readonly string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** Fills 0 or 1 names up to 2 with "Shadow Warrior" (numbered when needed to keep names distinct). */
function fillNames(names: readonly string[]): string[] {
  const out = [...names];
  let n = 1;
  while (out.length < SCENARIO_CHARACTERS_MIN) {
    const candidate = n === 1 ? FILL_CHARACTER_NAME : `${FILL_CHARACTER_NAME} ${n}`;
    if (!out.some((x) => x.toLowerCase() === candidate.toLowerCase())) out.push(candidate);
    n++;
  }
  return out;
}

function isArjunVsDuryodhan(names: readonly string[]): boolean {
  return names.length === 2 && names[0]!.toLowerCase() === 'arjun' && names[1]!.toLowerCase() === 'duryodhan';
}

/** Final normalization and checks every returned Scenario must pass (Req 4.2, 5.3, 5.6, 2.6). */
function finalize(scenario: Scenario): Result<Scenario, ScenarioError> {
  const characters = scenario.characters.map(
    (c): PuppetCharacter => ({ ...c, rig: resolveRig(c.rig), startingHP: STARTING_HP }),
  );
  for (const c of characters) {
    const r = validateTraitSet(c.traits);
    if (!r.ok) return err({ kind: 'agent_failed', agent: 'trait', message: `${c.name}: ${r.error.path} ${r.error.reason}` });
  }
  if (!traitBalanceOk({ characters })) {
    return err({ kind: 'agent_failed', agent: 'trait', message: 'Trait magnitudes are not balanced.' });
  }
  return ok({ ...scenario, characters });
}

export interface HardcodedScenarioOrchestratorOptions {
  /** Artificial delay per agent so status chips are visible. Defaults to 300 ms; use 0 in tests. */
  agentDelayMs?: number;
}

export class HardcodedScenarioOrchestrator implements ScenarioOrchestrator {
  private readonly agentDelayMs: number;

  constructor(options: HardcodedScenarioOrchestratorOptions = {}) {
    this.agentDelayMs = Math.max(0, options.agentDelayMs ?? 300);
  }

  async generate(prompt: string, options: GenerateOptions = {}): Promise<Result<Scenario, ScenarioError>> {
    const valid = validateScenarioPrompt(prompt);
    if (!valid.ok) return valid;
    const report = options.onAgentStatus ?? (() => {});
    for (const agent of SCENARIO_AGENTS) report(agent, 'pending');

    // Character name pre-check (Req 4.10).
    const names = extractCharacterNames(prompt);
    if (names.length > SCENARIO_CHARACTERS_MAX) {
      report('character', 'failed');
      return err({
        kind: 'too_many_characters',
        count: names.length,
        max: SCENARIO_CHARACTERS_MAX,
        message: `A Scenario can have at most ${SCENARIO_CHARACTERS_MAX} characters; the prompt names ${names.length}.`,
      });
    }

    let scenario: Scenario;
    if (isArjunVsDuryodhan(names)) {
      scenario = { ...structuredClone(ARJUN_VS_DURYODHAN), prompt };
      await this.runAgent('scene', report);
      await this.runAgent('character', report);
      await this.runAgent('trait', report);
    } else {
      await this.runAgent('scene', report);
      const stage = structuredClone(KURUKSHETRA_STAGE);
      await this.runAgent('character', report);
      const allNames = fillNames(names);
      const characters = allNames.map(stubCharacter);
      await this.runAgent('trait', report);
      scenario = {
        id: `stub-${allNames.map(slug).join('-vs-')}`,
        prompt,
        stage,
        narrative:
          'As dusk falls over Kurukshetra, the lamp behind the screen flickers and throws the shadows of ' +
          `${listNames(allNames)} onto the cloth.`,
        characters,
      };
    }

    const result = finalize(scenario);
    if (!result.ok && result.error.kind === 'agent_failed') report(result.error.agent, 'failed');
    return result;
  }

  private async runAgent(agent: ScenarioAgent, report: AgentStatusListener): Promise<void> {
    report(agent, 'in_progress');
    if (this.agentDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.agentDelayMs));
    report(agent, 'complete');
  }
}
