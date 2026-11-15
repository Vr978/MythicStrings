// Browser implementation of BattleView: the DOM panels in their layout slots plus the waiting
// animation, a slow idle sway of the acting puppet drawn on top of the physics pose (Req 18.3).
import type { Scenario } from '../core/scenario/types';
import type { Outcome } from '../core/turn/state';
import type { PuppetRenderer } from '../render/renderer';
import { DamagePanel, type DamageInfo } from '../ui/damagePanel';
import { el } from '../ui/dom';
import { Hud } from '../ui/hud';
import type { UiLayout } from '../ui/layout';
import { MoveInputPanel, type MoveInputOpenOptions, type Recommendations } from '../ui/moveInput';
import { Notifications, type Notice } from '../ui/notifications';
import { VotePanel, type VoteOpenOptions } from '../ui/votePanel';
import type { BattleView, TurnBanner } from './view';

/** Sway amplitude (radians) and period of the waiting animation. */
const SWAY_RAD = 0.045;
const SWAY_PERIOD_MS = 1400;

export class DomBattleView implements BattleView {
  readonly hud: Hud;
  readonly input = new MoveInputPanel();
  readonly notifications = new Notifications();
  readonly damage = new DamagePanel();
  readonly votes: VotePanel;
  private readonly turnLabel = el('div', { class: 'turn-counter' });
  private renderer: PuppetRenderer | null = null;
  private waiting: string | null = null;
  private swayed: string | null = null;

  constructor(
    private readonly layout: UiLayout,
    scenario: Scenario,
    options: { votingEnabled?: boolean } = {},
  ) {
    this.hud = new Hud(scenario.characters);
    this.votes = new VotePanel({ enabled: options.votingEnabled ?? true });
    layout.hud.replaceChildren(this.hud.root);
    layout.top.replaceChildren(this.turnLabel, this.notifications.root);
    layout.center.replaceChildren(this.damage.root);
    layout.bottom.replaceChildren(this.input.root);
    layout.side.replaceChildren(this.votes.root);
    layout.modal.replaceChildren();
  }

  attachRenderer(renderer: PuppetRenderer): void {
    this.renderer = renderer;
  }

  /** Applies the waiting sway after `renderer.sync`; call once per frame. */
  animate(tMs: number): void {
    const r = this.renderer;
    if (!r) return;
    if (this.swayed !== null && this.swayed !== this.waiting) {
      const c = r.puppet(this.swayed)?.container;
      if (c) {
        c.rotation = 0;
        c.pivot.set(0, 0);
        c.position.set(0, 0);
      }
      this.swayed = null;
    }
    if (this.waiting === null) return;
    const c = r.puppet(this.waiting)?.container;
    if (!c) return;
    // Pivot at the bottom centre of the puppet so it rocks on its feet.
    c.rotation = 0;
    c.pivot.set(0, 0);
    c.position.set(0, 0);
    const b = c.getLocalBounds();
    const fx = b.x + b.width / 2;
    const fy = b.y + b.height;
    c.pivot.set(fx, fy);
    c.position.set(fx, fy);
    c.rotation = SWAY_RAD * Math.sin((tMs / SWAY_PERIOD_MS) * Math.PI * 2);
    this.swayed = this.waiting;
  }

  turnStarted(info: TurnBanner): void {
    this.turnLabel.textContent = `Turn ${info.turnNumber}: ${info.actorName} (${info.playerLabel})`;
    this.hud.setActive(info.actorId);
  }

  openInput(options: MoveInputOpenOptions): void {
    this.input.open(options);
  }

  updateRecommendations(list: Recommendations): void {
    this.input.updateRecommendations(list);
  }

  inputText(): string {
    return this.input.text;
  }

  closeInput(): void {
    this.input.close();
  }

  reopenInput(): void {
    this.input.reopen();
  }

  hideInput(): void {
    this.input.hide();
  }

  inputError(message: string): void {
    this.input.showError(message);
  }

  notify(notice: Notice): void {
    this.notifications.push(notice);
  }

  setWaiting(characterId: string | null): void {
    this.waiting = characterId;
  }

  setHp(characterId: string, hp: number): void {
    this.hud.setHp(characterId, hp);
  }

  showDamage(info: DamageInfo): void {
    this.damage.show(info);
  }

  openVoting(options: VoteOpenOptions): boolean {
    return this.votes.open(options);
  }

  closeVoting(): void {
    this.votes.close();
  }

  showResult(outcome: Outcome, message: string, onNewBattle: () => void): void {
    this.hud.setActive(outcome.kind === 'winner' ? outcome.characterId : null);
    const button = el('button', { class: 'btn btn-primary', type: 'button', text: 'New battle' });
    button.addEventListener('click', onNewBattle, { once: true });
    this.layout.modal.replaceChildren(
      el('section', { class: 'battle-result', role: 'dialog', 'aria-label': 'Battle result' }, [
        el('h1', { class: 'title', text: outcome.kind === 'draw' ? 'A draw' : 'Victory' }),
        el('p', { class: 'battle-result-msg', text: message }),
        button,
      ]),
    );
    button.focus();
  }
}
