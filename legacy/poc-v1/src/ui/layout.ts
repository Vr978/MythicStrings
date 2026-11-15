// Screen layout: the game canvas fills the screen; overlay slots hold the HUD (top corners),
// notifications (top-center), damage panel (center), move panel (bottom-center), and vote panel (bottom-right).
import { el } from './dom';

export interface UiLayout {
  root: HTMLElement;
  /** Parent for the PixiJS canvas. */
  stage: HTMLElement;
  overlay: HTMLElement;
  hud: HTMLElement;
  top: HTMLElement;
  center: HTMLElement;
  bottom: HTMLElement;
  side: HTMLElement;
  /** Full-screen layer for the scenario screen. */
  modal: HTMLElement;
}

export function createLayout(host: HTMLElement): UiLayout {
  const stage = el('div', { class: 'ms-stage' });
  const hud = el('div', { class: 'ms-slot ms-hud' });
  const top = el('div', { class: 'ms-slot ms-top' });
  const center = el('div', { class: 'ms-slot ms-center' });
  const bottom = el('div', { class: 'ms-slot ms-bottom' });
  const side = el('div', { class: 'ms-slot ms-side' });
  const modal = el('div', { class: 'ms-modal' });
  const overlay = el('div', { class: 'ms-overlay' }, [hud, top, center, bottom, side]);
  const root = el('div', { class: 'ms-root' }, [stage, overlay, modal]);
  host.replaceChildren(root);
  return { root, stage, overlay, hud, top, center, bottom, side, modal };
}
