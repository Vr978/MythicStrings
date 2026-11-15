// The move catalogue. A weapon decides which base and special moves a character may carry, so an
// archer can never swing a mace. Damage per stamina is kept close to constant across the catalogue.
import type { Anim, Delivery, Element, MoveSpec, Shape, Weapon } from './types';

export const ELEMENT_COLORS: Record<Element, string> = {
  physical: '#4a2c1a',
  fire: '#e2501b',
  lightning: '#f2c81e',
  water: '#2377b8',
  ice: '#6fc3dd',
  wind: '#7fae8e',
  earth: '#8a5a2b',
  light: '#f5b82e',
  shadow: '#4b2a6b',
  poison: '#4f9a2c',
  energy: '#2aa7d6',
};

interface MoveOpts {
  mode?: MoveSpec['mode'];
  reach?: number;
  flavor?: string;
  color?: string;
}

function attack(
  id: string,
  name: string,
  delivery: Delivery,
  element: Element,
  shape: Shape,
  count: number,
  damage: number,
  cost: number,
  cooldown: number,
  anim: Anim,
  opts: MoveOpts = {},
): MoveSpec {
  return {
    id,
    name,
    kind: 'attack',
    mode: opts.mode ?? 'instant',
    delivery,
    shieldForm: 'wall',
    element,
    shape,
    count,
    damage,
    cost,
    cooldown,
    color: opts.color ?? ELEMENT_COLORS[element],
    anim,
    ...(opts.reach !== undefined ? { reach: opts.reach } : {}),
    ...(opts.flavor ? { flavor: opts.flavor } : {}),
  };
}

export interface WeaponInfo {
  label: string;
  /** Short line for the forge screen. */
  blurb: string;
  base: MoveSpec[];
  special: MoveSpec[];
}

export const WEAPON_INFO: Record<Weapon, WeaponInfo> = {
  bow: {
    label: 'Bow',
    blurb: 'Strikes from afar. Weak when cornered.',
    base: [
      attack('bow.shot', 'Swift Arrow', 'projectile', 'physical', 'arrow', 1, 3.4, 11, 0.5, 'shoot', { flavor: 'One arrow, straight and fast.' }),
      attack('bow.twin', 'Twin Shot', 'projectile', 'physical', 'arrow', 2, 4.2, 14, 0.7, 'shoot', { flavor: 'Two arrows a breath apart.' }),
    ],
    special: [
      attack('bow.storm', 'Arrow Storm', 'rain', 'physical', 'arrow', 36, 13, 46, 6.5, 'shoot', { flavor: 'Thirty-six arrows fall where the foe stood.' }),
      attack('bow.astra', 'Piercing Astra', 'beam', 'light', 'arrow', 1, 12, 44, 6, 'shoot', { flavor: 'A lance of light at chest height. Duck it.' }),
      attack('bow.serpent', 'Serpent Arrows', 'projectile', 'poison', 'serpent', 5, 12, 44, 7, 'shoot', { mode: 'lingering', flavor: 'Venom that keeps biting after the hit.' }),
    ],
  },
  mace: {
    label: 'Mace',
    blurb: 'Crushing blows up close.',
    base: [attack('mace.smash', 'Gada Smash', 'melee', 'physical', 'hammer', 1, 4.6, 13, 0.65, 'swing', { reach: 1.9, flavor: 'An overhead blow with the gada.' })],
    special: [
      attack('mace.quake', 'Earthshaker', 'wave', 'earth', 'rock', 1, 13, 46, 6.5, 'slam', { flavor: 'A shockwave along the ground. Jump it.' }),
      attack('mace.whirl', 'Whirling Gada', 'burst', 'wind', 'hammer', 1, 12, 42, 6, 'swing', { flavor: 'A spinning ring that hits everything near.' }),
    ],
  },
  hammer: {
    label: 'Hammer',
    blurb: 'Thrown or swung, it calls the storm.',
    base: [
      attack('hammer.throw', 'Hammer Throw', 'projectile', 'physical', 'hammer', 1, 4, 13, 0.7, 'throw', { flavor: 'The hammer flies and returns.' }),
      attack('hammer.blow', 'Hammer Blow', 'melee', 'physical', 'hammer', 1, 4.6, 13, 0.65, 'swing', { reach: 1.8, flavor: 'A heavy swing at arm’s length.' }),
    ],
    special: [
      attack('hammer.lightning', 'Lightning Strike', 'rain', 'lightning', 'bolt', 6, 14, 48, 7, 'cast', { flavor: 'Six bolts hunt the ground beneath the foe.' }),
      attack('hammer.clap', 'Thunderclap', 'burst', 'lightning', 'bolt', 1, 12, 42, 6, 'slam', { flavor: 'A ring of thunder around the wielder.' }),
    ],
  },
  sword: {
    label: 'Sword',
    blurb: 'Fast cuts, short cooldowns.',
    base: [attack('sword.slash', 'Slash', 'melee', 'physical', 'blade', 1, 4, 11, 0.5, 'swing', { reach: 1.8, flavor: 'A quick cut.' })],
    special: [
      attack('sword.wave', 'Crescent Wave', 'projectile', 'wind', 'blade', 3, 12, 43, 6, 'swing', { flavor: 'Three flying crescents.' }),
      attack('sword.cuts', 'Thousand Cuts', 'projectile', 'physical', 'blade', 12, 12.5, 45, 6.5, 'swing', { flavor: 'A fan of twelve blades.' }),
    ],
  },
  spear: {
    label: 'Spear',
    blurb: 'The longest reach in melee.',
    base: [
      attack('spear.thrust', 'Thrust', 'melee', 'physical', 'spear', 1, 3.8, 11, 0.55, 'thrust', { reach: 2.5, flavor: 'A long, straight thrust.' }),
      attack('spear.javelin', 'Javelin', 'projectile', 'physical', 'spear', 1, 3.8, 13, 0.7, 'throw', { flavor: 'A thrown spear.' }),
    ],
    special: [
      attack('spear.rain', 'Spear Rain', 'rain', 'physical', 'spear', 10, 13, 46, 6.5, 'cast', { flavor: 'Ten spears from the sky.' }),
      attack('spear.light', 'Lance of Dawn', 'beam', 'light', 'spear', 1, 12, 44, 6, 'thrust', { flavor: 'A beam of light from the spear tip.' }),
    ],
  },
  trident: {
    label: 'Trident',
    blurb: 'Three points, and the sea behind them.',
    base: [attack('trident.jab', 'Trident Jab', 'melee', 'physical', 'spear', 1, 4, 12, 0.6, 'thrust', { reach: 2.3, flavor: 'Three points at once.' })],
    special: [
      attack('trident.tide', 'Tidal Wave', 'wave', 'water', 'orb', 1, 13, 46, 6.5, 'slam', { flavor: 'A wall of water along the ground.' }),
      attack('trident.bolt', 'Trishula Bolt', 'projectile', 'lightning', 'bolt', 3, 12, 43, 6, 'thrust', { flavor: 'Three forks of lightning.' }),
    ],
  },
  staff: {
    label: 'Staff',
    blurb: 'Reach, and a little magic.',
    base: [
      attack('staff.strike', 'Staff Strike', 'melee', 'physical', 'spear', 1, 3.7, 11, 0.5, 'swing', { reach: 2.4, flavor: 'A sweeping blow.' }),
      attack('staff.orb', 'Spirit Orb', 'projectile', 'energy', 'orb', 1, 3.4, 12, 0.6, 'cast', { flavor: 'A slow orb of spirit.' }),
    ],
    special: [
      attack('staff.pillars', 'Pillar Crash', 'rain', 'earth', 'rock', 5, 13, 46, 6.5, 'slam', { flavor: 'Five stone pillars drop from above.' }),
      attack('staff.nova', 'Mystic Nova', 'burst', 'energy', 'star', 1, 12, 42, 6, 'cast', { flavor: 'A ring of force around the caster.' }),
      attack('staff.curse', 'Withering Curse', 'projectile', 'shadow', 'skull', 3, 12, 44, 7, 'cast', { mode: 'lingering', flavor: 'A curse that keeps draining.' }),
    ],
  },
  chakra: {
    label: 'Chakra',
    blurb: 'Spinning discs that never miss by much.',
    base: [attack('chakra.throw', 'Discus Throw', 'projectile', 'light', 'disc', 1, 3.8, 12, 0.55, 'throw', { flavor: 'One spinning disc.' })],
    special: [
      attack('chakra.storm', 'Wheel Storm', 'projectile', 'light', 'disc', 8, 13, 46, 6.5, 'throw', { flavor: 'Eight discs in a spread.' }),
      attack('chakra.ring', 'Solar Ring', 'burst', 'light', 'disc', 1, 12, 42, 6, 'cast', { flavor: 'A burning ring around the thrower.' }),
    ],
  },
  axe: {
    label: 'Axe',
    blurb: 'Slow, and it hurts.',
    base: [attack('axe.cleave', 'Cleave', 'melee', 'physical', 'blade', 1, 4.8, 14, 0.72, 'swing', { reach: 1.9, flavor: 'A heavy downward cut.' })],
    special: [
      attack('axe.cyclone', 'Axe Cyclone', 'burst', 'wind', 'blade', 1, 12.5, 43, 6, 'swing', { flavor: 'A spinning storm of steel.' }),
      attack('axe.split', 'Splitting Throw', 'projectile', 'physical', 'blade', 3, 12, 43, 6, 'throw', { flavor: 'Three thrown axes.' }),
    ],
  },
  fists: {
    label: 'Bare Hands',
    blurb: 'No weapon. The body is the weapon.',
    base: [
      attack('fists.palm', 'Palm Strike', 'melee', 'physical', 'fist', 1, 3.8, 10, 0.42, 'thrust', { reach: 1.6, flavor: 'The fastest strike in the game.' }),
      attack('fists.bolt', 'Chi Bolt', 'projectile', 'energy', 'orb', 1, 3.3, 12, 0.55, 'thrust', { flavor: 'A bolt of breath and will.' }),
    ],
    special: [
      attack('fists.blast', 'Prana Blast', 'beam', 'energy', 'orb', 1, 13, 46, 6.5, 'thrust', { flavor: 'Both palms forward: a river of life force.' }),
      attack('fists.meteor', 'Meteor Fists', 'projectile', 'fire', 'fist', 10, 12.5, 45, 6.5, 'thrust', { flavor: 'Ten burning fists.' }),
      attack('fists.stomp', 'Shockwave Stomp', 'wave', 'earth', 'rock', 1, 12, 43, 6, 'slam', { flavor: 'A stamp that rolls across the ground.' }),
    ],
  },
};

const ALL_MOVES = new Map<string, MoveSpec>();
for (const w of Object.values(WEAPON_INFO)) for (const m of [...w.base, ...w.special]) ALL_MOVES.set(m.id, m);

export function findMove(id: string): MoveSpec | undefined {
  return ALL_MOVES.get(id);
}

/** A catalogue move under a character's own name, e.g. Thor's hammer throw becomes "Mjolnir Throw". */
export function named(id: string, name: string, patch: Partial<MoveSpec> = {}): MoveSpec {
  const m = ALL_MOVES.get(id);
  if (!m) throw new Error(`unknown move ${id}`);
  return { ...m, ...patch, name };
}

export function isBaseFor(weapon: Weapon, moveId: string): boolean {
  return WEAPON_INFO[weapon].base.some((m) => m.id === moveId);
}

export function isSpecialFor(weapon: Weapon, moveId: string): boolean {
  return WEAPON_INFO[weapon].special.some((m) => m.id === moveId);
}

/** The moves a weapon gives when nothing else is chosen. */
export function defaultMoves(weapon: Weapon): { base: MoveSpec; special: MoveSpec } {
  const info = WEAPON_INFO[weapon];
  return { base: { ...info.base[0]! }, special: { ...info.special[0]! } };
}
