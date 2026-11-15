import { KEY } from '../shared/sim';

export const BINDINGS = [
  { left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS', base: 'KeyK', special: 'KeyL', prompt: 'KeyQ' },
  { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', base: 'Comma', special: 'Period', prompt: 'ShiftRight' },
] as const;

const editable = (node: EventTarget | null): boolean =>
  node instanceof HTMLElement && (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName));

/** Uses physical key codes, so layouts and two attached keyboards share predictable controls. */
export class Input {
  private readonly held = new Set<string>();
  private readonly pointers: [number, number] = [0, 0];
  enabled = false;
  online = false;
  constructor(private readonly onPrompt: (who: 0 | 1) => void, private readonly onMenu: () => void) {
    window.addEventListener('keydown', this.down);
    window.addEventListener('keyup', this.up);
    window.addEventListener('blur', this.reset);
    document.addEventListener('visibilitychange', this.reset);
  }

  private down = (event: KeyboardEvent): void => {
    if (!this.enabled || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Escape' && !editable(event.target)) { this.onMenu(); return; }
    if (editable(event.target)) return;
    const known = Object.values(BINDINGS[0]).some(k => k === event.code) || Object.values(BINDINGS[1]).some(k => k === event.code);
    if (known) event.preventDefault();
    this.held.add(event.code);
    if (!event.repeat) {
      if (event.code === BINDINGS[0].prompt) this.onPrompt(0);
      if (!this.online && event.code === BINDINGS[1].prompt) this.onPrompt(1);
    }
  };

  private up = (event: KeyboardEvent): void => { this.held.delete(event.code); };
  reset = (): void => { this.held.clear(); this.pointers[0] = this.pointers[1] = 0; };

  /** Pointer controls use the same flags as keyboards and work with multiple fingers. */
  pointer(who: 0 | 1, key: number, on: boolean): void {
    if (on) this.pointers[who] |= key;
    else this.pointers[who] &= ~key;
  }

  keys(who: 0 | 1): number {
    if (!this.enabled) return 0;
    const binding = BINDINGS[who];
    let flags = this.pointers[who];
    for (const key of ['left', 'right', 'up', 'down', 'base', 'special'] as const) {
      if (this.held.has(binding[key])) flags |= KEY[key];
    }
    if (this.online && who === 0) {
      for (const key of ['left', 'right', 'up', 'down'] as const) if (this.held.has(BINDINGS[1][key])) flags |= KEY[key];
    }
    return flags;
  }

  destroy(): void {
    window.removeEventListener('keydown', this.down);
    window.removeEventListener('keyup', this.up);
    window.removeEventListener('blur', this.reset);
    document.removeEventListener('visibilitychange', this.reset);
  }
}
