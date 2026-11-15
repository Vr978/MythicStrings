// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { HardcodedScenarioOrchestrator } from '../ai/scenario';
import { LexiconGuardrail, type Guardrail } from '../ai/guardrail';
import { ARJUN_VS_DURYODHAN } from '../content/scenarios/arjunVsDuryodhan';
import type { MoveBlock } from '../core/moveblock/types';
import { damageScore } from '../core/scoring/damage';
import type { StoredMoveSelection } from '../core/turn/state';
import { ManualClock } from './clock';
import { DamagePanel } from './damagePanel';
import { Hud } from './hud';
import { MoveInputPanel, TRY_EXAMPLES } from './moveInput';
import { Notifications, scorerFallbackNotice, substitutionNotice } from './notifications';
import { DEFAULT_SCENARIO_PROMPT, SCENARIO_LIMIT_MESSAGE, ScenarioScreen, runScenarioSubmission } from './scenarioScreen';
import { VotePanel } from './votePanel';

const block = (name: string): MoveBlock => ({
  schemaVersion: 1,
  displayName: name,
  description: `${name} description.`,
  primitives: [{ primitive: 'strike', params: {} }],
  targets: { primary: 'nearest_opponent', affects: 'primary_only' },
});
const sel = (name: string): StoredMoveSelection => ({ block: block(name) });

const typeInto = (field: HTMLInputElement | HTMLTextAreaElement, text: string): void => {
  field.value = text;
  field.dispatchEvent(new Event('input'));
};

describe('ScenarioScreen', () => {
  it('prefills the prompt and rejects empty or over-long text without calling onSubmit', async () => {
    const onSubmit = vi.fn();
    const screen = new ScenarioScreen({ onSubmit });
    expect(screen.text).toBe(DEFAULT_SCENARIO_PROMPT);
    for (const bad of ['   ', 'x'.repeat(501)]) {
      screen.field.value = bad;
      await screen.submit();
      expect(screen.messageText).toBe(SCENARIO_LIMIT_MESSAGE);
      expect(screen.text).toBe(bad);
      expect(screen.field.disabled).toBe(false);
    }
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables submit while the submission is pending', async () => {
    let release!: () => void;
    const screen = new ScenarioScreen({ onSubmit: () => new Promise<void>((r) => (release = r)) });
    const pending = screen.submit();
    expect(screen.submitButton.disabled).toBe(true);
    release();
    await pending;
    expect(screen.submitButton.disabled).toBe(false);
  });

  it('runs the hardcoded orchestrator and marks every agent chip complete', async () => {
    const screen = new ScenarioScreen({ onSubmit: () => {} });
    const deps = { guardrail: new LexiconGuardrail(), orchestrator: new HardcodedScenarioOrchestrator({ agentDelayMs: 0 }) };
    const scenario = await runScenarioSubmission(screen, deps, screen.text);
    expect(scenario?.characters.map((c) => c.name)).toEqual(['Arjun', 'Duryodhan']);
    for (const agent of ['scene', 'character', 'trait'] as const) expect(screen.agentStatus(agent)).toBe('complete');
  });

  it('shows the rejection category and keeps the text editable', async () => {
    const screen = new ScenarioScreen({ onSubmit: () => {} });
    const deps = { guardrail: new LexiconGuardrail(), orchestrator: new HardcodedScenarioOrchestrator({ agentDelayMs: 0 }) };
    screen.field.value = 'Arjun vs a stupid demon';
    expect(await runScenarioSubmission(screen, deps, screen.text)).toBeNull();
    expect(screen.messageKind).toBe('rejection');
    expect(screen.messageText).toContain('harassment');
    expect(screen.text).toBe('Arjun vs a stupid demon');
  });

  it('shows a could-not-be-checked error when the Guardrail fails', async () => {
    const screen = new ScenarioScreen({ onSubmit: () => {} });
    const broken: Guardrail = { classify: () => Promise.reject(new Error('down')), rewrite: () => Promise.reject(new Error('down')) };
    const generate = vi.fn();
    expect(await runScenarioSubmission(screen, { guardrail: broken, orchestrator: { generate } }, screen.text)).toBeNull();
    expect(screen.messageKind).toBe('error');
    expect(screen.messageText).toMatch(/could not be checked/);
    expect(screen.retryButton.hidden).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('Hud', () => {
  it('shows names, traits, and integer HP, and updates HP', () => {
    const hud = new Hud(ARJUN_VS_DURYODHAN.characters);
    const arjun = ARJUN_VS_DURYODHAN.characters[0]!;
    const text = hud.root.textContent ?? '';
    expect(text).toContain(arjun.name);
    for (const t of arjun.traits) {
      expect(text).toContain(t.name);
      expect(text).toContain(t.description);
    }
    expect(hud.root.querySelectorAll(`[data-character="${arjun.id}"] .trait-mag`).length).toBe(arjun.traits.length);
    hud.setHp(arjun.id, 72.6);
    const card = hud.root.querySelector(`[data-character="${arjun.id}"]`)!;
    expect(card.querySelector('.hp-value')!.textContent).toBe('73 HP');
    expect((card.querySelector('.hp-fill') as HTMLElement).style.width).toBe('73%');
    hud.setHp(arjun.id, -5);
    expect(card.querySelector('.hp-value')!.textContent).toBe('0 HP');
  });
});

describe('MoveInputPanel', () => {
  const open = (panel: MoveInputPanel, extra: Partial<Parameters<MoveInputPanel['open']>[0]> = {}) => {
    const calls = { submit: vi.fn(), select: vi.fn(), typing: vi.fn(), expire: vi.fn() };
    panel.open({
      playerLabel: 'Player 1',
      durationMs: 10_000,
      onSubmit: calls.submit,
      onSelect: calls.select,
      onTyping: calls.typing,
      onExpire: calls.expire,
      ...extra,
    });
    return calls;
  };

  it('shows the banner, a ceil countdown, maxlength 200, and the Try list', () => {
    const clock = new ManualClock();
    const panel = new MoveInputPanel({ clock });
    open(panel);
    expect(panel.root.textContent).toContain('Player 1 — your turn');
    expect(panel.field.maxLength).toBe(200);
    for (const ex of TRY_EXAMPLES) expect(panel.root.textContent).toContain(ex);
    expect(panel.displayedSeconds).toBe(10);
    clock.advance(250);
    expect(panel.displayedSeconds).toBe(10);
    clock.advance(750);
    expect(panel.displayedSeconds).toBe(9);
    clock.advance(8_750);
    expect(panel.displayedSeconds).toBe(1);
  });

  it('rejects an empty submit, keeps running, then submits text and disables input', () => {
    const clock = new ManualClock();
    const panel = new MoveInputPanel({ clock });
    const calls = open(panel);
    panel.submitButton.click();
    expect(calls.submit).not.toHaveBeenCalled();
    expect(panel.root.querySelector<HTMLElement>('.move-hint')!.hidden).toBe(false);
    expect(panel.isOpen).toBe(true);
    typeInto(panel.field, 'fire a volley of 50 arrows');
    panel.submitButton.click();
    expect(calls.submit).toHaveBeenCalledWith('fire a volley of 50 arrows');
    expect(panel.field.disabled).toBe(true);
    panel.submitButton.click();
    expect(calls.submit).toHaveBeenCalledTimes(1);
  });

  it('passes the field text at the deadline, or a no_input fallback when empty', () => {
    const clock = new ManualClock();
    const panel = new MoveInputPanel({ clock });
    let calls = open(panel);
    typeInto(panel.field, 'make clones');
    clock.advance(10_000);
    expect(calls.expire).toHaveBeenCalledWith({ kind: 'prompt', text: 'make clones' });
    expect(panel.field.disabled).toBe(true);
    calls = open(panel);
    clock.advance(10_000);
    expect(calls.expire).toHaveBeenCalledWith({ kind: 'fallback', reason: 'no_input' });
    expect(clock.pending).toBe(0);
  });

  it('lists up to 5 recommended and 10 previous Moves with click-to-select and empty indicators', () => {
    const panel = new MoveInputPanel({ clock: new ManualClock() });
    const recs = Array.from({ length: 7 }, (_, i) => sel(`Rec ${i}`));
    const prev = Array.from({ length: 12 }, (_, i) => sel(`Prev ${i}`));
    const calls = open(panel, { recommended: recs, previous: prev });
    const rec = panel.root.querySelectorAll('[data-list="recommended"] .move-option');
    expect(rec.length).toBe(5);
    expect(panel.root.querySelectorAll('[data-list="previous"] .move-option').length).toBe(10);
    (rec[1] as HTMLButtonElement).click();
    expect(calls.select).toHaveBeenCalledWith(recs[1]);
    panel.updateRecommendations('unavailable');
    expect(panel.root.querySelector('[data-indicator="unavailable"]')).not.toBeNull();
    expect(panel.root.querySelectorAll('[data-list="previous"] .move-option').length).toBe(10);
    open(panel, { recommended: [], previous: [] });
    expect(panel.root.querySelectorAll('[data-indicator="empty"]').length).toBe(2);
  });

  it('debounces typing updates by 150 ms', () => {
    const clock = new ManualClock();
    const panel = new MoveInputPanel({ clock });
    const calls = open(panel);
    typeInto(panel.field, 'fi');
    clock.advance(100);
    typeInto(panel.field, 'fire');
    clock.advance(149);
    expect(calls.typing).not.toHaveBeenCalled();
    clock.advance(1);
    expect(calls.typing).toHaveBeenCalledWith('fire');
  });
});

describe('Notifications', () => {
  it('keeps each notice visible for at least 3 s and queues overflow', () => {
    const clock = new ManualClock();
    const n = new Notifications({ clock, maxVisible: 1 });
    n.push({ ...substitutionNotice({ type: 'fallback', reason: 'no_input' }, 'Staff Strike'), minVisibleMs: 500 });
    n.push(scorerFallbackNotice());
    expect(n.visibleTexts()).toHaveLength(1);
    expect(n.visibleTexts()[0]).toContain('Staff Strike');
    expect(n.visibleTexts()[0]).toContain('no input');
    clock.advance(2_999);
    expect(n.visibleTexts()[0]).toContain('Staff Strike');
    clock.advance(1);
    expect(n.visibleTexts()[0]).toContain('Fallback damage calculation');
  });

  it('names the rejection category in a rewrite notice', () => {
    expect(substitutionNotice({ type: 'rewrite', category: 'graphic_gore' }).message).toContain('graphic gore');
  });
});

describe('DamagePanel', () => {
  it('shows the four criteria and stays visible for at least 3 s', () => {
    const clock = new ManualClock();
    const panel = new DamagePanel({ clock });
    const breakdown = damageScore({
      targetHit: { characterId: 'b', contactCount: 3, totalImpulse: 4 },
      creativity: 1,
      traitAlignment: 0.5,
      voteShare: 0.5,
    });
    panel.show({ damage: breakdown.damage, targetName: 'Duryodhan', breakdown, creativity: 1, traitAlignment: 0.5, voteShare: 0.5 });
    const rows = [...panel.root.querySelectorAll('.damage-row')].map((r) => r.getAttribute('data-criterion'));
    expect(rows).toEqual(['hit', 'creativity', 'traitAlignment', 'voteShare']);
    expect(panel.root.textContent).toContain(`${breakdown.damage} damage to Duryodhan`);
    panel.hide();
    expect(panel.isVisible).toBe(true);
    clock.advance(4_000);
    expect(panel.isVisible).toBe(false);
    panel.show({ damage: 9, targetName: 'Arjun', fallbackScorer: true });
    expect(panel.root.textContent).toContain('Fallback calculation');
  });
});

describe('VotePanel', () => {
  it('counts down 10 s, reports votes and rejections, and closes', () => {
    const clock = new ManualClock();
    const panel = new VotePanel({ clock });
    const onClose = vi.fn();
    const onVote = vi.fn((v: string) =>
      v === 'down' ? { accepted: false as const, reason: 'duplicate' as const, message: 'A vote has already been cast for that Move.' } : { accepted: true as const },
    );
    expect(panel.open({ onVote, onClose })).toBe(true);
    expect(panel.displayedSeconds).toBe(10);
    panel.upButton.click();
    expect(onVote).toHaveBeenCalledWith('up');
    panel.downButton.click();
    expect(panel.messageText).toContain('already been cast');
    clock.advance(9_750);
    expect(panel.displayedSeconds).toBe(1);
    clock.advance(250);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(panel.isOpen).toBe(false);
    expect(panel.upButton.disabled).toBe(true);
  });

  it('does not open when voting is toggled off', () => {
    const onToggle = vi.fn();
    const panel = new VotePanel({ clock: new ManualClock(), onToggle });
    panel.toggle.checked = false;
    panel.toggle.dispatchEvent(new Event('change'));
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(panel.enabled).toBe(false);
    expect(panel.open({ onVote: () => {} })).toBe(false);
    expect(panel.root.textContent).toContain('vote share 0.5');
  });
});
