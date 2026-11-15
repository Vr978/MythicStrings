import { describe, expect, it } from 'vitest';
import { traitBalanceOk, validateTraitSet } from '../core/scenario/traits';
import { STARTING_HP, type Scenario } from '../core/scenario/types';
import { validateRig } from '../content/rig';
import { ARJUN_VS_DURYODHAN, KURUKSHETRA_STAGE } from '../content/scenarios/arjunVsDuryodhan';
import {
  extractCharacterNames,
  FILL_CHARACTER_NAME,
  HardcodedScenarioOrchestrator,
  validateScenarioPrompt,
  type AgentStatus,
  type ScenarioAgent,
} from './scenario';

const orchestrator = new HardcodedScenarioOrchestrator({ agentDelayMs: 0 });

async function generateOk(prompt: string): Promise<Scenario> {
  const r = await orchestrator.generate(prompt);
  if (!r.ok) throw new Error(`expected a Scenario, got ${JSON.stringify(r.error)}`);
  return r.value;
}

function expectValidScenario(s: Scenario): void {
  expect(s.characters.length).toBeGreaterThanOrEqual(2);
  expect(s.characters.length).toBeLessThanOrEqual(4);
  for (const c of s.characters) {
    expect(validateTraitSet(c.traits).ok).toBe(true);
    expect(validateRig(c.rig).ok).toBe(true);
    expect(c.startingHP).toBe(STARTING_HP);
  }
  expect(traitBalanceOk(s)).toBe(true);
  expect(new Set(s.characters.map((c) => c.id)).size).toBe(s.characters.length);
}

describe('validateScenarioPrompt', () => {
  it('accepts 1 to 500 trimmed characters and returns the text unchanged', () => {
    expect(validateScenarioPrompt('  a  ')).toEqual({ ok: true, value: '  a  ' });
    expect(validateScenarioPrompt('x'.repeat(500)).ok).toBe(true);
  });
  it('rejects empty, whitespace-only, and over-length prompts', () => {
    for (const p of ['', '   \n\t', 'x'.repeat(501)]) {
      const r = validateScenarioPrompt(p);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).toContain('1 to 500');
    }
  });
});

describe('extractCharacterNames', () => {
  it('splits on vs, versus, commas, and "and"', () => {
    expect(extractCharacterNames('Rama VS Ravana, Sita and Hanuman versus Bhima')).toEqual([
      'Rama',
      'Ravana',
      'Sita',
      'Hanuman',
      'Bhima',
    ]);
    expect(extractCharacterNames('Arjun vs. Karna')).toEqual(['Arjun', 'Karna']);
  });
  it('does not split inside words', () => {
    expect(extractCharacterNames('Brandon vs Vsevolod')).toEqual(['Brandon', 'Vsevolod']);
  });
});

describe('HardcodedScenarioOrchestrator', () => {
  it('returns the hardcoded scenario for "Arjun vs Duryodhan", case-insensitively', async () => {
    const s = await generateOk('aRJUN versus DURYODHAN');
    expect(s.characters.map((c) => c.name)).toEqual(['Arjun', 'Duryodhan']);
    expect(s.narrative).toBe(ARJUN_VS_DURYODHAN.narrative);
    expect(s.prompt).toBe('aRJUN versus DURYODHAN');
    expectValidScenario(s);
  });

  it('builds a stub on the Kurukshetra stage with the typed names', async () => {
    const s = await generateOk('Rama vs Ravana, Hanuman and Sita');
    expect(s.characters.map((c) => c.name)).toEqual(['Rama', 'Ravana', 'Hanuman', 'Sita']);
    expect(s.characters.map((c) => c.controllerPlayerId)).toEqual(['player-1', 'player-2', 'player-3', 'player-4']);
    expect(s.stage).toEqual(KURUKSHETRA_STAGE);
    expectValidScenario(s);
  });

  it('fills 1 named character up to 2 with a Shadow Warrior', async () => {
    const s = await generateOk('Bhima');
    expect(s.characters.map((c) => c.name)).toEqual(['Bhima', FILL_CHARACTER_NAME]);
    expectValidScenario(s);
  });

  it('fills 0 named characters with two distinct Shadow Warriors', async () => {
    const s = await generateOk(' vs ');
    expect(s.characters).toHaveLength(2);
    expect(s.characters[0]!.name).toBe(FILL_CHARACTER_NAME);
    expect(s.characters[1]!.name).not.toBe(s.characters[0]!.name);
    expectValidScenario(s);
  });

  it('returns the 4-character-maximum error for more than 4 names', async () => {
    const r = await orchestrator.generate('A vs B vs C vs D vs E');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('too_many_characters');
      expect(r.error.message).toContain('at most 4');
    }
  });

  it('returns invalid_prompt for an empty prompt', async () => {
    const r = await orchestrator.generate('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('invalid_prompt');
  });

  it('reports per-agent status transitions in order', async () => {
    const events: [ScenarioAgent, AgentStatus][] = [];
    await orchestrator.generate('Arjun vs Karna', { onAgentStatus: (a, s) => events.push([a, s]) });
    expect(events).toEqual([
      ['scene', 'pending'],
      ['character', 'pending'],
      ['trait', 'pending'],
      ['scene', 'in_progress'],
      ['scene', 'complete'],
      ['character', 'in_progress'],
      ['character', 'complete'],
      ['trait', 'in_progress'],
      ['trait', 'complete'],
    ]);
  });

  it('reports the Character agent as failed when too many names are given', async () => {
    const events: [ScenarioAgent, AgentStatus][] = [];
    await orchestrator.generate('A, B, C, D, E', { onAgentStatus: (a, s) => events.push([a, s]) });
    expect(events.at(-1)).toEqual(['character', 'failed']);
  });

  it('does not let callers mutate the shared hardcoded scenario', async () => {
    const s = await generateOk('Arjun vs Duryodhan');
    s.characters[0]!.traits[0]!.magnitude = 1;
    expect(ARJUN_VS_DURYODHAN.characters[0]!.traits[0]!.magnitude).toBe(9);
  });
});
