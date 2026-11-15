import { beforeAll, describe, expect, it } from 'vitest';
import { ARJUN_VS_DURYODHAN } from '../content/scenarios/arjunVsDuryodhan';
import type { HitResult } from '../core/scoring/damage';
import { DEFAULT_BATTLE_CONFIG, type BattleConfig, type BattleEvent, type Effect, type Phase } from '../core/turn/state';
import { SimWorld } from '../sim/world';
import { ManualClock } from '../ui/clock';
import type { MoveInputOpenOptions } from '../ui/moveInput';
import type { Notice } from '../ui/notifications';
import type { VoteOpenOptions } from '../ui/votePanel';
import { createServices, type Services } from './services';
import { TurnController } from './turnController';
import type { BattleView } from './view';

/** Records what the controller asks the screen to do. */
class FakeView implements BattleView {
  input: MoveInputOpenOptions | null = null;
  text = '';
  waiting: (string | null)[] = [];
  notices: Notice[] = [];
  hp: Record<string, number> = {};
  damage: number[] = [];
  votingOpened = 0;
  result: string | null = null;
  turnStarted(): void {}
  openInput(o: MoveInputOpenOptions): void {
    this.input = o;
    this.text = '';
  }
  updateRecommendations(): void {}
  inputText(): string {
    return this.text;
  }
  closeInput(): void {}
  reopenInput(): void {}
  hideInput(): void {}
  inputError(): void {}
  notify(n: Notice): void {
    this.notices.push(n);
  }
  setWaiting(id: string | null): void {
    this.waiting.push(id);
  }
  setHp(id: string, hp: number): void {
    this.hp[id] = hp;
  }
  showDamage(info: { damage: number }): void {
    this.damage.push(info.damage);
  }
  openVoting(_o: VoteOpenOptions): boolean {
    this.votingOpened++;
    return true;
  }
  closeVoting(): void {}
  showResult(_o: unknown, message: string): void {
    this.result = message;
  }
}

const FRAME_MS = 16;
const macrotask = () => new Promise<void>((r) => setTimeout(r, 0));

interface Harness {
  ctrl: TurnController;
  clock: ManualClock;
  view: FakeView;
  services: Services;
  phases: Phase[];
  effects: Effect[];
  events: BattleEvent[];
}

function harness(config: Partial<BattleConfig> = {}): Harness {
  const clock = new ManualClock(0);
  const view = new FakeView();
  const services = createServices({ storage: null, scenarioAgentDelayMs: 0 });
  const phases: Phase[] = [];
  const effects: Effect[] = [];
  const events: BattleEvent[] = [];
  const ctrl = new TurnController({
    scenario: ARJUN_VS_DURYODHAN,
    config: { ...DEFAULT_BATTLE_CONFIG, ...config },
    seed: 3,
    services,
    view,
    clock,
    turnGapMs: 0,
    // The 500 ms wall-clock validation budget is covered by validator tests; a frozen clock keeps this
    // wiring test independent of CPU load from parallel test files.
    simClock: () => 0,
    onStep: (s, e, fx) => {
      if (phases[phases.length - 1] !== s.phase) phases.push(s.phase);
      events.push(e);
      effects.push(...fx);
    },
  });
  return { ctrl, clock, view, services, phases, effects, events };
}

/** Advances time frame by frame (flushing async service results) until `done()` or `maxMs`. */
async function runUntil(h: Harness, done: () => boolean, maxMs = 30_000): Promise<void> {
  for (let t = 0; t < maxMs && !done(); t += FRAME_MS) {
    h.clock.advance(FRAME_MS);
    h.ctrl.frame(FRAME_MS);
    await macrotask();
  }
  if (!done()) throw new Error(`condition not reached; phase ${h.ctrl.state.phase}, phases ${h.phases.join(',')}`);
}

beforeAll(async () => {
  await SimWorld.init();
});

describe('TurnController (headless)', () => {
  it('runs a scripted "fire a volley of 50 arrows" Turn through every phase to damage application', async () => {
    const h = harness();
    h.ctrl.start();
    await runUntil(h, () => h.view.input !== null);
    const actor = h.ctrl.state.actor;
    const target = h.ctrl.state.target;

    h.view.input!.onSubmit('fire a volley of 50 arrows');
    expect(h.view.waiting.at(-1)).toBe(actor); // waiting animation starts on window close

    await runUntil(h, () => h.ctrl.state.phase === 'animation');
    expect(h.ctrl.live.isPlaying).toBe(true);
    const validated = h.events.find((e) => e.type === 'validation_result' && e.result.valid);
    if (!validated || validated.type !== 'validation_result' || !validated.result.valid) throw new Error('no valid validation');
    expect(validated.result.block.primitives[0]).toMatchObject({ primitive: 'projectile_volley', params: { count: 50 } });

    // The first Move frame stops the waiting animation and the accepted block is stored.
    await runUntil(h, () => h.view.waiting.at(-1) === null);
    await macrotask();
    expect(await h.services.moveLibrary.size()).toBe(1);

    // Live playback from the same snapshot and seed reproduces the validated hits exactly.
    // `tick` returns right after the last Move step, so the hit totals here cover exactly the playback.
    let liveHits: HitResult[] = [];
    await runUntil(h, () => {
      if (h.ctrl.state.phase !== 'voting') return false;
      liveHits = h.ctrl.live.world.hitTotals();
      return true;
    });
    expect(liveHits).toEqual(validated.result.hits);
    expect(h.view.votingOpened).toBe(1);

    // Voting closes after 10 s, then the Judge scores and damage is applied.
    await runUntil(h, () => h.ctrl.state.turnNumber === 2, 15_000);
    const score = h.effects.find((e) => e.type === 'score_move');
    expect(score).toMatchObject({ voteShare: 0.5, isFallback: false, targetId: target });
    const hpChanged = h.effects.find((e) => e.type === 'hp_changed');
    if (!hpChanged || hpChanged.type !== 'hp_changed') throw new Error('no hp_changed');
    expect(hpChanged.damage).toBe(h.view.damage[0]);
    expect(h.ctrl.state.hp[target]).toBe(100 - hpChanged.damage);
    expect(h.view.hp[target]).toBe(h.ctrl.state.hp[target]);
    expect(h.phases).toEqual(['input', 'moderation', 'resolution', 'validation', 'animation', 'voting', 'damage', 'input']);
    expect(h.ctrl.state.actor).not.toBe(actor);
    h.ctrl.dispose();
  });

  it('performs a Fallback_Move on an empty window and never stores it', async () => {
    const h = harness({ votingEnabled: false, inputWindowSec: 5 });
    h.ctrl.start();
    await runUntil(h, () => h.view.input !== null);
    await runUntil(h, () => h.ctrl.state.turnNumber === 2, 20_000);
    expect(h.view.notices.some((n) => n.kind === 'fallback')).toBe(true);
    expect(h.effects.some((e) => e.type === 'store_move' || e.type === 'increment_usage')).toBe(false);
    expect(await h.services.moveLibrary.size()).toBe(0);
    expect(h.ctrl.state.history[0]?.move?.source).toBe('fallback');
    h.ctrl.dispose();
  });
});
