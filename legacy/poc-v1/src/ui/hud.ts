// HUD (Req 5.4, 5.5): per Puppet_Character name, HP bar with integer value, and Trait list.
// Characters alternate between the top-left and top-right corners in Scenario order.
import { STARTING_HP, type PuppetCharacter } from '../core/scenario/types';
import { el } from './dom';

interface CharacterCard {
  card: HTMLElement;
  fill: HTMLElement;
  value: HTMLElement;
  max: number;
  hp: number;
}

/** Health_Points shown as a whole number, never below 0. */
export const displayHp = (hp: number): number => (Number.isFinite(hp) ? Math.max(0, Math.round(hp)) : 0);

export class Hud {
  readonly root: HTMLElement;
  private readonly cards = new Map<string, CharacterCard>();

  constructor(characters: readonly PuppetCharacter[]) {
    const left = el('div', { class: 'hud-corner hud-left' });
    const right = el('div', { class: 'hud-corner hud-right' });
    this.root = el('div', { class: 'hud' }, [left, right]);
    characters.forEach((c, i) => {
      const max = c.startingHP || STARTING_HP;
      const fill = el('div', { class: 'hp-fill' });
      const value = el('span', { class: 'hp-value' });
      const bar = el('div', { class: 'hp-bar', role: 'meter', 'aria-label': `${c.name} health`, 'aria-valuemin': 0, 'aria-valuemax': max }, [fill]);
      const traits = el(
        'ul',
        { class: 'trait-list' },
        c.traits.map((t) =>
          el('li', { class: 'trait', title: t.description }, [
            el('span', { class: 'trait-name', text: t.name }),
            el('span', { class: 'trait-mag', text: String(t.magnitude), 'aria-label': `magnitude ${t.magnitude}` }),
            el('span', { class: 'trait-desc', text: t.description }),
          ]),
        ),
      );
      const card = el('div', { class: 'hud-card', 'data-character': c.id }, [
        el('div', { class: 'hud-head' }, [el('span', { class: 'hud-name', text: c.name }), value]),
        bar,
        traits,
      ]);
      (i % 2 === 0 ? left : right).append(card);
      const entry: CharacterCard = { card, fill, value, max, hp: max };
      this.cards.set(c.id, entry);
      this.render(entry);
    });
  }

  /** Updates one character's HP immediately (Req 5.5). Unknown IDs are ignored. */
  setHp(characterId: string, hp: number): void {
    const entry = this.cards.get(characterId);
    if (!entry) return;
    entry.hp = displayHp(hp);
    this.render(entry);
  }

  getHp(characterId: string): number | undefined {
    return this.cards.get(characterId)?.hp;
  }

  /** Highlights the acting character. */
  setActive(characterId: string | null): void {
    for (const [id, entry] of this.cards) entry.card.classList.toggle('active', id === characterId);
  }

  private render(entry: CharacterCard): void {
    const pct = entry.max > 0 ? Math.min(100, (entry.hp / entry.max) * 100) : 0;
    entry.fill.style.width = `${pct}%`;
    entry.value.textContent = `${entry.hp} HP`;
    entry.fill.parentElement!.setAttribute('aria-valuenow', String(entry.hp));
    entry.card.classList.toggle('low', pct <= 25);
    entry.card.classList.toggle('defeated', entry.hp === 0);
  }
}
