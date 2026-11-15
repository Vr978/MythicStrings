import { PROMPT_SECONDS, SIM_DT } from '../shared/balance';
import { verdictOf, type PromptVerdict } from '../shared/protocol';
import { resolveLocally } from '../shared/resolve';
import { Match, type MatchState, type SimEvent } from '../shared/sim';
import type { CharacterSheet, PlayerProfile, ProgressUpdate } from '../shared/types';
import { api, pickOf } from './api';
import { PracticeBot } from './bot';
import type { Input } from './input';
import type { OnlineRoom } from './online';

export type DuelMode = 'local' | 'cpu' | 'online';
export interface DuelHooks {
  events: (events: SimEvent[]) => void;
  verdict: (verdict: PromptVerdict) => void;
  text: (who: 0 | 1) => string;
  result: (progress: ProgressUpdate[], error?: string) => void;
}

export class Duel {
  readonly match: Match | null;
  state: MatchState;
  private readonly bot: PracticeBot | null;
  private accumulator = 0;
  private recorded = false;
  private lastKeys = -1;
  private keySentAt = 0;
  private active = true;
  private recording: Promise<void> | null = null;
  private readonly submitting = new Set<number>();

  constructor(
    readonly sheets: [CharacterSheet, CharacterSheet],
    readonly mode: DuelMode,
    readonly you: 0 | 1,
    private readonly input: Input,
    private readonly player: PlayerProfile,
    private readonly hooks: DuelHooks,
    private readonly room: OnlineRoom | null = null,
  ) {
    this.match = mode === 'online' ? null : new Match(sheets, Math.floor(Math.random() * 0x7fffffff));
    this.state = this.match?.state ?? new Match(sheets, 1).state;
    this.bot = mode === 'cpu' ? new PracticeBot() : null;
    input.online = mode === 'online';
    input.enabled = true;
    input.reset();
  }

  tick(dt: number): void {
    if (!this.active) return;
    if (!this.match) {
      const f = this.state.fighters[this.you];
      const keys = f.prompt ? 0 : this.input.keys(0);
      // Keep held inputs alive, so the server can safely expire stale controls.
      if (keys !== this.lastKeys || performance.now() - this.keySentAt > 200) {
        this.lastKeys = keys;
        this.keySentAt = performance.now();
        this.room?.send({ t: 'in', k: keys });
      }
      return;
    }
    // Cap physics catch-up after tab suspension while still charging all elapsed match time.
    const elapsed = Math.min(dt, 0.25);
    if (this.state.phase === 'fight' && dt > elapsed) this.state.clock = Math.max(0, this.state.clock - (dt - elapsed));
    this.accumulator += elapsed;
    while (this.accumulator >= SIM_DT) {
      this.accumulator -= SIM_DT;
      const left = this.state.fighters[0].prompt ? 0 : this.input.keys(0);
      const right = this.bot ? this.bot.keys(this.match) : this.state.fighters[1].prompt ? 0 : this.input.keys(1);
      this.match.step([left, right]);
      this.events(this.match.drain());
    }
    if (this.state.phase === 'over' && !this.recorded) {
      this.recorded = true;
      this.recording = this.record();
    }
  }

  snapshot(state: MatchState, events: SimEvent[]): void {
    if (!this.active) return;
    this.state = state;
    this.events(events);
  }

  private events(events: SimEvent[]): void {
    this.hooks.events(events);
    for (const event of events) {
      if (event.type === 'prompt' && event.phase === 'timeout' && (this.mode !== 'online' || event.who === this.you)) {
        void this.submit(event.who);
      }
    }
  }

  open(who: 0 | 1): void {
    if (!this.active || this.state.phase !== 'fight' || (this.mode === 'cpu' && who === 1)) return;
    this.input.reset();
    if (this.match) {
      this.match.openPrompt(who);
      this.events(this.match.drain());
    } else if (who === this.you) this.room?.send({ t: 'popen' });
  }

  cancel(who: 0 | 1): void {
    if (this.match) this.match.cancelPrompt(who);
    else this.room?.send({ t: 'pcancel' });
  }

  async submit(who: 0 | 1): Promise<void> {
    if (!this.active || this.submitting.has(who)) return;
    const text = this.hooks.text(who).trim().slice(0, 80);
    const f = this.state.fighters[who];
    if (f.prompt !== 1) return;
    if (!text) { this.cancel(who); return; }
    if (!this.match) {
      this.room?.send({ t: 'psubmit', text });
      return;
    }
    const typedMs = Math.round((PROMPT_SECONDS - Math.max(0, f.promptT)) * 1000);
    if (!this.match.submitPrompt(who)) return;
    this.submitting.add(who);
    try {
      const result = await api.prompt(text, typedMs).catch(() => resolveLocally(text, typedMs));
      if (!this.active) return;
      this.match.resolvePrompt(who, result.ok ? result.move : null);
      this.hooks.verdict(verdictOf(who, text, result));
      this.events(this.match.drain());
    } finally { this.submitting.delete(who); }
  }

  private async record(): Promise<void> {
    try {
      const result = await api.result({
        owner: this.player.id, picks: this.sheets.map(s => ({ ...pickOf(s), name: s.name })),
        winner: this.state.winner, reason: this.state.reason, hp: this.state.fighters.map(f => f.hp), versus: this.mode,
      });
      if (this.active) this.hooks.result(result.progress);
    } catch {
      if (this.active) this.hooks.result([], 'The duel finished, but its result could not be saved.');
    }
  }

  /** A quick rematch must use any rank earned by the duel that just finished. */
  async resultReady(): Promise<void> { await this.recording; }

  stop(): void {
    this.active = false;
    this.input.reset();
    this.input.enabled = false;
    this.room?.send({ t: 'in', k: 0 });
  }
}
