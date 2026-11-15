// Damage breakdown panel (Req 15.4, 15.10): Damage_Score and the four criteria, visible for at least 3 s.
import type { ScoreBreakdown } from '../core/scoring/damage';
import { systemClock, type Clock, type TimerHandle } from './clock';
import { el, setVisible } from './dom';

export const DAMAGE_MIN_VISIBLE_MS = 3000;
export const DAMAGE_DEFAULT_VISIBLE_MS = 4000;

export interface DamageInfo {
  damage: number;
  attackerName?: string;
  targetName: string;
  moveName?: string;
  /** Absent when the hit-only fallback calculation was used (Req 15.10). */
  breakdown?: ScoreBreakdown;
  creativity?: number;
  traitAlignment?: number;
  voteShare?: number;
  fallbackScorer?: boolean;
  /** Raised to at least DAMAGE_MIN_VISIBLE_MS. */
  visibleMs?: number;
}

const pts = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : '0.0');
const pct = (x: number | undefined): string => (x === undefined || !Number.isFinite(x) ? '' : ` (${Math.round(x * 100)}%)`);

export class DamagePanel {
  readonly root: HTMLElement;
  private readonly clock: Clock;
  private timer: TimerHandle | null = null;
  private shownAt = 0;
  private minMs = 0;

  constructor(options: { clock?: Clock } = {}) {
    this.clock = options.clock ?? systemClock;
    this.root = el('section', { class: 'damage-panel', 'aria-live': 'polite' });
    setVisible(this.root, false);
  }

  get isVisible(): boolean {
    return !this.root.hidden;
  }

  show(info: DamageInfo): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    const heading = `${info.moveName ? `${info.moveName}: ` : ''}${info.damage} damage to ${info.targetName}`;
    const rows: HTMLElement[] = [];
    if (info.breakdown && !info.fallbackScorer) {
      const c = info.breakdown.contributions;
      rows.push(
        row('Hit', pts(c.hit), 'hit'),
        row(`Creativity${pct(info.creativity)}`, pts(c.creativity), 'creativity'),
        row(`Trait alignment${pct(info.traitAlignment)}`, pts(c.traitAlignment), 'traitAlignment'),
        row(`Vote share${pct(info.voteShare)}`, pts(c.voteShare), 'voteShare'),
      );
    } else {
      rows.push(
        el('p', { class: 'damage-fallback', text: 'Fallback calculation used: damage from hit results only.' }),
      );
    }
    const byLine = info.attackerName ? el('p', { class: 'damage-by', text: `by ${info.attackerName}` }) : null;
    this.root.replaceChildren(
      el('h2', { class: 'damage-total', text: heading }),
      ...(byLine ? [byLine] : []),
      el('div', { class: 'damage-rows' }, rows),
    );
    this.minMs = Math.max(DAMAGE_MIN_VISIBLE_MS, info.visibleMs ?? DAMAGE_DEFAULT_VISIBLE_MS);
    this.shownAt = this.clock.now();
    setVisible(this.root, true);
    this.timer = this.clock.setTimeout(() => this.hideNow(), this.minMs);
  }

  /** Hides now if the minimum visible time has passed; otherwise the pending auto-hide does it. */
  hide(): void {
    if (this.isVisible && this.clock.now() - this.shownAt >= this.minMs) this.hideNow();
  }

  private hideNow(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    setVisible(this.root, false);
  }
}

function row(label: string, value: string, key: string): HTMLElement {
  return el('div', { class: 'damage-row', 'data-criterion': key }, [
    el('span', { class: 'damage-label', text: label }),
    el('span', { class: 'damage-value', text: value }),
  ]);
}
