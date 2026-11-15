// Notification queue (design: "Game_Client > Notifications"). Each item stays visible for at least
// its `minVisibleMs` (never under 3 s). At most `maxVisible` items show at once; the rest wait in order.
import type { DerogatoryCategory } from '../content/lexicon';
import type { Substitution } from '../core/turn/state';
import { systemClock, type Clock, type TimerHandle } from './clock';
import { el } from './dom';
import { CATEGORY_LABELS, FALLBACK_REASON_LABELS } from './labels';

/** Lower bound for every notice (Req 9.7, 17.5). */
export const MIN_VISIBLE_MS = 3000;
export const DEFAULT_VISIBLE_MS = 4000;

export type NoticeKind = 'rewrite' | 'fallback' | 'note' | 'scorer_fallback' | 'info' | 'error';

export interface Notice {
  kind: NoticeKind;
  title: string;
  message: string;
  /** Raised to at least MIN_VISIBLE_MS. */
  minVisibleMs?: number;
}

interface Active {
  id: number;
  node: HTMLElement;
  shownAt: number;
  minMs: number;
  timer: TimerHandle;
}

export interface NotificationsOptions {
  clock?: Clock;
  maxVisible?: number;
}

export class Notifications {
  readonly root: HTMLElement;
  private readonly clock: Clock;
  private readonly maxVisible: number;
  private readonly waiting: { id: number; notice: Notice }[] = [];
  private readonly active: Active[] = [];
  private nextId = 1;

  constructor(options: NotificationsOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.maxVisible = Math.max(1, options.maxVisible ?? 3);
    this.root = el('div', { class: 'notifications', 'aria-live': 'polite' });
  }

  /** Queues a notice and returns its ID. */
  push(notice: Notice): number {
    const id = this.nextId++;
    this.waiting.push({ id, notice });
    this.pump();
    return id;
  }

  /** Texts currently on screen, oldest first. */
  visibleTexts(): string[] {
    return this.active.map((a) => a.node.textContent ?? '');
  }

  get queued(): number {
    return this.waiting.length;
  }

  private pump(): void {
    while (this.active.length < this.maxVisible && this.waiting.length > 0) {
      const { id, notice } = this.waiting.shift()!;
      const minMs = Math.max(MIN_VISIBLE_MS, notice.minVisibleMs ?? DEFAULT_VISIBLE_MS);
      const node = el('div', { class: `notice notice-${notice.kind}`, role: 'status', 'data-kind': notice.kind }, [
        el('strong', { class: 'notice-title', text: notice.title }),
        el('span', { class: 'notice-msg', text: notice.message }),
      ]);
      this.root.append(node);
      const timer = this.clock.setTimeout(() => this.remove(id), minMs);
      this.active.push({ id, node, shownAt: this.clock.now(), minMs, timer });
    }
  }

  private remove(id: number): void {
    const i = this.active.findIndex((a) => a.id === id);
    if (i < 0) return;
    const [a] = this.active.splice(i, 1);
    a!.node.remove();
    this.pump();
  }
}

/** Rewrite / Fallback_Move notice for the acting Player (Req 10.6, 17.5). */
export function substitutionNotice(sub: Substitution, fallbackName?: string): Notice {
  if (sub.type === 'rewrite') {
    return {
      kind: 'rewrite',
      title: 'Move prompt rewritten',
      message: `Your move was rewritten because it was flagged for ${CATEGORY_LABELS[sub.category]}.`,
    };
  }
  const category = sub.category ? ` Category: ${CATEGORY_LABELS[sub.category]}.` : '';
  return {
    kind: 'fallback',
    title: `Fallback move: ${fallbackName ?? 'default move'}`,
    message: `${FALLBACK_REASON_LABELS[sub.reason]}${category}`,
  };
}

export function categoryLabel(category: DerogatoryCategory): string {
  return CATEGORY_LABELS[category];
}

/** Move_Generator note about omitted or substituted effects (Req 9.7). */
export function generatorNote(note: string): Notice {
  return { kind: 'note', title: 'Move adjusted', message: note };
}

/** Judge failure notice (Req 15.10). */
export function scorerFallbackNotice(): Notice {
  return {
    kind: 'scorer_fallback',
    title: 'Fallback damage calculation',
    message: 'The judge did not respond in time, so damage was computed from hit results only.',
  };
}
