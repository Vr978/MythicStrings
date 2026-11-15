// Injectable clock and timers for the UI, so countdowns and visibility durations can be tested
// without real time passing.

export type TimerHandle = number;

export interface Clock {
  /** Milliseconds; only differences matter. */
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  setInterval(fn: () => void, ms: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
}

/** Real browser time. */
export const systemClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as TimerHandle,
  clearTimeout: (h) => globalThis.clearTimeout(h),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms) as unknown as TimerHandle,
  clearInterval: (h) => globalThis.clearInterval(h),
};

interface ManualTimer {
  id: TimerHandle;
  due: number;
  fn: () => void;
  /** Present for intervals. */
  every?: number;
}

/** A clock that only moves when `advance` is called. Timers fire in due order, ties by creation order. */
export class ManualClock implements Clock {
  private t: number;
  private nextId = 1;
  private timers: ManualTimer[] = [];

  constructor(start = 0) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.nextId++;
    this.timers.push({ id, due: this.t + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers = this.timers.filter((x) => x.id !== handle);
  }

  setInterval(fn: () => void, ms: number): TimerHandle {
    const every = Math.max(1, ms);
    const id = this.nextId++;
    this.timers.push({ id, due: this.t + every, fn, every });
    return id;
  }

  clearInterval(handle: TimerHandle): void {
    this.clearTimeout(handle);
  }

  /** Moves time forward by `ms`, firing every timer that comes due on the way. */
  advance(ms: number): void {
    const end = this.t + Math.max(0, ms);
    for (;;) {
      let next: ManualTimer | undefined;
      for (const x of this.timers) if (x.due <= end && (!next || x.due < next.due || (x.due === next.due && x.id < next.id))) next = x;
      if (!next) break;
      this.t = next.due;
      if (next.every !== undefined) next.due += next.every;
      else this.timers = this.timers.filter((x) => x !== next);
      next.fn();
    }
    this.t = end;
  }

  /** Number of pending timers and intervals. */
  get pending(): number {
    return this.timers.length;
  }
}
