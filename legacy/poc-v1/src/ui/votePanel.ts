// Local audience voting panel (Req 16.1, 16.4, 16.9): up/down buttons, a Voting_Window countdown,
// and a toggle that disables voting (the Damage_Scorer then uses Vote_Share 0.5).
import { VOTING_WINDOW_SEC_DEFAULT } from '../core/config';
import type { VoteResult, VoteValue } from '../core/voting/votes';
import { systemClock, type Clock, type TimerHandle } from './clock';
import { el, setVisible } from './dom';
import { COUNTDOWN_TICK_MS, countdownSeconds } from './moveInput';

export interface VoteOpenOptions {
  /** Default 10 s. */
  durationMs?: number;
  moveName?: string;
  /** Returns the Voting_Service result so the panel can show rejections. */
  onVote: (value: VoteValue) => VoteResult | void;
  /** Called once when the countdown reaches 0 or close() is called. */
  onClose?: () => void;
}

export class VotePanel {
  readonly root: HTMLElement;
  readonly toggle: HTMLInputElement;
  readonly upButton: HTMLButtonElement;
  readonly downButton: HTMLButtonElement;
  private readonly box: HTMLElement;
  private readonly title: HTMLElement;
  private readonly countdown: HTMLElement;
  private readonly tally: HTMLElement;
  private readonly message: HTMLElement;
  private readonly clock: Clock;
  private opts: VoteOpenOptions | null = null;
  private deadline = 0;
  private ticker: TimerHandle | null = null;
  private ups = 0;
  private downs = 0;

  constructor(options: { clock?: Clock; enabled?: boolean; onToggle?: (enabled: boolean) => void } = {}) {
    this.clock = options.clock ?? systemClock;
    this.toggle = el('input', { type: 'checkbox', class: 'vote-toggle-input' });
    this.toggle.checked = options.enabled ?? true;
    this.toggle.addEventListener('change', () => {
      options.onToggle?.(this.toggle.checked);
      this.renderToggleHint();
    });
    const toggleHint = el('span', { class: 'vote-toggle-hint' });
    const toggleLabel = el('label', { class: 'vote-toggle' }, [this.toggle, ' Audience voting', toggleHint]);

    this.title = el('h3', { class: 'vote-title' });
    this.countdown = el('div', { class: 'countdown vote-countdown' });
    this.upButton = el('button', { class: 'btn vote-up', type: 'button', 'aria-label': 'Vote up', text: '▲ Applaud' });
    this.downButton = el('button', { class: 'btn vote-down', type: 'button', 'aria-label': 'Vote down', text: '▼ Jeer' });
    this.tally = el('div', { class: 'vote-tally' });
    this.message = el('div', { class: 'vote-message', role: 'status' });
    this.box = el('div', { class: 'vote-box' }, [
      el('div', { class: 'move-head' }, [this.title, this.countdown]),
      el('div', { class: 'vote-buttons' }, [this.upButton, this.downButton]),
      this.tally,
      this.message,
    ]);
    setVisible(this.box, false);
    this.root = el('section', { class: 'vote-panel' }, [toggleLabel, this.box]);
    this.upButton.addEventListener('click', () => this.vote('up'));
    this.downButton.addEventListener('click', () => this.vote('down'));
    this.renderToggleHint();
  }

  get enabled(): boolean {
    return this.toggle.checked;
  }

  get isOpen(): boolean {
    return this.opts !== null;
  }

  get displayedSeconds(): number {
    return Number(this.countdown.textContent ?? '0');
  }

  get messageText(): string {
    return this.message.textContent ?? '';
  }

  /** Opens a Voting_Window. Returns false and does nothing when voting is disabled. */
  open(options: VoteOpenOptions): boolean {
    if (!this.enabled) return false;
    this.stop();
    this.opts = options;
    this.ups = 0;
    this.downs = 0;
    this.deadline = this.clock.now() + (options.durationMs ?? VOTING_WINDOW_SEC_DEFAULT * 1000);
    this.title.textContent = options.moveName ? `Audience, judge “${options.moveName}”` : 'Audience, judge this move';
    this.message.textContent = '';
    this.renderTally();
    this.setButtons(true);
    this.toggle.disabled = true;
    setVisible(this.box, true);
    this.tick();
    this.ticker = this.clock.setInterval(() => this.tick(), COUNTDOWN_TICK_MS);
    return true;
  }

  /** Closes the window early (or when the controller's own timer fires). */
  close(): void {
    const opts = this.opts;
    if (!opts) return;
    this.stop();
    this.opts = null;
    this.setButtons(false);
    this.toggle.disabled = false;
    setVisible(this.box, false);
    opts.onClose?.();
  }

  private vote(value: VoteValue): void {
    const opts = this.opts;
    if (!opts) return;
    const result = opts.onVote(value);
    if (result && !result.accepted) {
      this.message.textContent = result.message;
      return;
    }
    if (value === 'up') this.ups++;
    else this.downs++;
    this.message.textContent = 'Vote counted.';
    this.renderTally();
  }

  private tick(): void {
    if (!this.opts) return;
    const secs = countdownSeconds(this.deadline, this.clock.now());
    this.countdown.textContent = String(secs);
    if (secs === 0) this.close();
  }

  private renderTally(): void {
    this.tally.textContent = `▲ ${this.ups}  ▼ ${this.downs}`;
  }

  private renderToggleHint(): void {
    const hint = this.root?.querySelector('.vote-toggle-hint');
    if (hint) hint.textContent = this.enabled ? '' : ' (off: vote share 0.5)';
  }

  private setButtons(enabled: boolean): void {
    this.upButton.disabled = !enabled;
    this.downButton.disabled = !enabled;
  }

  private stop(): void {
    if (this.ticker !== null) this.clock.clearInterval(this.ticker);
    this.ticker = null;
  }
}
