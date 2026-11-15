// Move_Input_Window panel (design: "Game_Client > Move_Input_Window panel", Req 7.1-7.9, 8.2, 8.6, 8.7).
// The panel is driven by the turn controller: open() starts the countdown, close() disables input.
import type { LibraryEntry } from '../core/library/types';
import type { MoveBlock } from '../core/moveblock/types';
import { closeWindowDecision, type WindowDecision } from '../core/turn/closeWindow';
import type { StoredMoveSelection } from '../core/turn/state';
import { systemClock, type Clock, type TimerHandle } from './clock';
import { el, setVisible } from './dom';

export const MOVE_PROMPT_MAX = 200;
export const MAX_RECOMMENDED = 5;
export const MAX_PREVIOUS = 10;
/** Countdown refresh period (design: 250 ms ticker). */
export const COUNTDOWN_TICK_MS = 250;
/** Keystroke debounce before asking for new recommendations (design: 150 ms). */
export const TYPING_DEBOUNCE_MS = 150;

export const TRY_EXAMPLES: readonly string[] = [
  'fire a volley of 50 arrows',
  'make clones from strands of hair',
  'summon a boulder and strike with my mace',
];

/** Remaining whole seconds, rounded up, never below 0 (Req 7.2, Property 33). */
export function countdownSeconds(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** Recommendations, or `'unavailable'` when the Recommendation_Engine failed or timed out (Req 8.6). */
export type Recommendations = readonly StoredMoveSelection[] | 'unavailable';

export interface MoveInputOpenOptions {
  /** e.g. "Player 1"; shown as "Player 1 — your turn". */
  playerLabel: string;
  /** Acting Puppet_Character name, shown under the banner. */
  characterName?: string;
  durationMs: number;
  recommended?: Recommendations;
  previous?: readonly StoredMoveSelection[];
  /** Non-blank submit before the deadline (Req 7.4). */
  onSubmit: (text: string) => void;
  /** Click on a recommended or previous Move (Req 7.4, 8.4). */
  onSelect: (selection: StoredMoveSelection) => void;
  /** Debounced field text while typing, for live recommendations (Req 8.5). */
  onTyping?: (text: string) => void;
  /** Countdown reached 0; the decision follows Req 7.5, 7.6 (Property 32). */
  onExpire?: (decision: WindowDecision<StoredMoveSelection>) => void;
}

export interface MoveInputPanelOptions {
  clock?: Clock;
}

export const fromLibraryEntry = (e: LibraryEntry): StoredMoveSelection => ({
  block: e.block,
  libraryEntryId: e.id,
  ...(e.prompts[0] !== undefined ? { prompt: e.prompts[0] } : {}),
});

export const fromBlock = (block: MoveBlock): StoredMoveSelection => ({ block });

export class MoveInputPanel {
  readonly root: HTMLElement;
  readonly field: HTMLInputElement;
  readonly submitButton: HTMLButtonElement;
  private readonly banner: HTMLElement;
  private readonly subBanner: HTMLElement;
  private readonly countdown: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly error: HTMLElement;
  private readonly recommendedList: HTMLElement;
  private readonly previousList: HTMLElement;
  private readonly tryList: HTMLElement;
  private readonly clock: Clock;
  private opts: MoveInputOpenOptions | null = null;
  private deadline = 0;
  private ticker: TimerHandle | null = null;
  private debounce: TimerHandle | null = null;
  private shown = -1;

  constructor(options: MoveInputPanelOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.banner = el('div', { class: 'turn-banner' });
    this.subBanner = el('div', { class: 'turn-sub' });
    this.countdown = el('div', { class: 'countdown', 'aria-live': 'off' });
    this.field = el('input', {
      class: 'move-field',
      type: 'text',
      maxlength: MOVE_PROMPT_MAX,
      autocomplete: 'off',
      'aria-label': 'Move prompt',
      placeholder: 'Describe your move…',
    });
    this.submitButton = el('button', { class: 'btn btn-primary', type: 'button', text: 'Strike' });
    this.hint = el('div', { class: 'move-hint', role: 'status', text: 'Type a move first.' });
    this.error = el('div', { class: 'move-error', role: 'alert' });
    this.recommendedList = el('ul', { class: 'move-list', 'data-list': 'recommended' });
    this.previousList = el('ul', { class: 'move-list', 'data-list': 'previous' });
    this.tryList = el(
      'div',
      { class: 'try-list' },
      [
        el('span', { class: 'try-label', text: 'Try:' }),
        ...TRY_EXAMPLES.map((ex) => {
          const b = el('button', { class: 'try-chip', type: 'button', text: ex });
          b.addEventListener('click', () => this.fill(ex));
          return b;
        }),
      ],
    );
    setVisible(this.hint, false);
    setVisible(this.error, false);

    this.root = el('section', { class: 'move-panel', 'aria-label': 'Move input' }, [
      el('div', { class: 'move-head' }, [el('div', {}, [this.banner, this.subBanner]), this.countdown]),
      el('div', { class: 'move-row' }, [this.field, this.submitButton]),
      this.hint,
      this.error,
      this.tryList,
      el('div', { class: 'move-columns' }, [
        el('div', { class: 'move-col' }, [el('h3', { text: 'Recommended' }), this.recommendedList]),
        el('div', { class: 'move-col' }, [el('h3', { text: 'Your previous moves' }), this.previousList]),
      ]),
    ]);
    setVisible(this.root, false);

    this.submitButton.addEventListener('click', () => this.submit());
    this.field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      }
    });
    this.field.addEventListener('input', () => this.handleInput());
    this.setEnabled(false);
  }

  get isOpen(): boolean {
    return this.opts !== null;
  }

  get text(): string {
    return this.field.value;
  }

  /** Last countdown value written to the screen. */
  get displayedSeconds(): number {
    return this.shown;
  }

  open(options: MoveInputOpenOptions): void {
    this.stopTimers();
    this.opts = options;
    this.deadline = this.clock.now() + Math.max(0, options.durationMs);
    this.shown = -1;
    this.banner.textContent = `${options.playerLabel} — your turn`;
    this.subBanner.textContent = options.characterName ? `${options.characterName} awaits your command` : '';
    this.field.value = '';
    setVisible(this.hint, false);
    setVisible(this.error, false);
    this.updateRecommendations(options.recommended ?? []);
    this.renderList(this.previousList, (options.previous ?? []).slice(0, MAX_PREVIOUS), 'No previous moves yet.');
    this.setEnabled(true);
    setVisible(this.root, true);
    this.root.classList.remove('closed');
    this.tick();
    this.ticker = this.clock.setInterval(() => this.tick(), COUNTDOWN_TICK_MS);
    this.field.focus();
  }

  /** Replaces the recommended list (Req 8.5); `'unavailable'` shows the unavailable indicator (Req 8.6). */
  updateRecommendations(list: Recommendations): void {
    if (list === 'unavailable') {
      this.recommendedList.replaceChildren(el('li', { class: 'move-empty', 'data-indicator': 'unavailable', text: 'Recommendations unavailable.' }));
      return;
    }
    this.renderList(this.recommendedList, list.slice(0, MAX_RECOMMENDED), 'No matching moves.');
  }

  /** Error for a stored Move that cannot run on this Stage (Req 8.8); the window stays open. */
  showError(message: string): void {
    this.error.textContent = message;
    setVisible(this.error, true);
  }

  /** Disables every input so late input is ignored (Req 7.9). The panel stays visible, greyed out. */
  close(): void {
    this.stopTimers();
    this.opts = null;
    this.setEnabled(false);
    this.root.classList.add('closed');
  }

  /** Closes and hides the panel. */
  hide(): void {
    this.close();
    setVisible(this.root, false);
  }

  /** Re-enables an already open window after a rejected selection (Req 8.8). */
  reopen(): void {
    if (this.opts) this.setEnabled(true);
  }

  private submit(): void {
    const opts = this.opts;
    if (!opts) return;
    const decision = closeWindowDecision<StoredMoveSelection>(this.field.value, null, 'submit');
    if (decision.kind !== 'prompt') {
      setVisible(this.hint, true);
      this.field.focus();
      return;
    }
    this.close();
    opts.onSubmit(decision.text);
  }

  private select(selection: StoredMoveSelection): void {
    const opts = this.opts;
    if (!opts) return;
    // Disable input while the Turn_Manager checks the selection; reopen() restores it on rejection.
    this.setEnabled(false);
    opts.onSelect(selection);
  }

  private fill(text: string): void {
    if (!this.opts) return;
    this.field.value = text.slice(0, MOVE_PROMPT_MAX);
    this.handleInput();
    this.field.focus();
  }

  private handleInput(): void {
    if (!this.opts) return;
    if (this.field.value.length > MOVE_PROMPT_MAX) this.field.value = this.field.value.slice(0, MOVE_PROMPT_MAX);
    if (this.field.value.trim().length > 0) setVisible(this.hint, false);
    if (this.debounce !== null) this.clock.clearTimeout(this.debounce);
    const onTyping = this.opts.onTyping;
    if (!onTyping) return;
    this.debounce = this.clock.setTimeout(() => {
      this.debounce = null;
      if (this.opts) onTyping(this.field.value);
    }, TYPING_DEBOUNCE_MS);
  }

  private tick(): void {
    const opts = this.opts;
    if (!opts) return;
    const secs = countdownSeconds(this.deadline, this.clock.now());
    if (secs !== this.shown) {
      this.shown = secs;
      this.countdown.textContent = String(secs);
      this.countdown.classList.toggle('urgent', secs <= 3);
    }
    if (secs === 0) {
      const decision = closeWindowDecision<StoredMoveSelection>(this.field.value, null, 'deadline');
      this.close();
      opts.onExpire?.(decision);
    }
  }

  private renderList(list: HTMLElement, items: readonly StoredMoveSelection[], emptyText: string): void {
    if (items.length === 0) {
      list.replaceChildren(el('li', { class: 'move-empty', 'data-indicator': 'empty', text: emptyText }));
      return;
    }
    list.replaceChildren(
      ...items.map((item) => {
        const b = el('button', { class: 'move-option', type: 'button', title: item.block.description }, [
          el('span', { class: 'move-name', text: item.block.displayName }),
          el('span', { class: 'move-desc', text: item.block.description }),
        ]);
        b.disabled = !this.opts;
        b.addEventListener('click', () => this.select(item));
        return el('li', {}, [b]);
      }),
    );
  }

  private setEnabled(enabled: boolean): void {
    this.field.disabled = !enabled;
    this.submitButton.disabled = !enabled;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.move-option, .try-chip')) b.disabled = !enabled;
  }

  private stopTimers(): void {
    if (this.ticker !== null) this.clock.clearInterval(this.ticker);
    if (this.debounce !== null) this.clock.clearTimeout(this.debounce);
    this.ticker = null;
    this.debounce = null;
  }
}
