// The legends that ship with the game. Their six ratings are fixed here once and never change, so
// they play the same in every match. Any other legend is summoned through the AI and then cached.
import { ratingFromStats } from './balance';
import { ELEMENT_COLORS, named } from './moves';
import type { CharacterSheet, MoveSpec, PuppetLook, StageTheme, Stats, Weapon } from './types';

export const DEFAULT_LOOK: PuppetLook = {
  species: 'human',
  build: 'average',
  skin: '#e0a060',
  hairColor: '#2a1a14',
  primary: '#d8341f',
  secondary: '#f2b21e',
  accent: '#e9a400',
  headgear: 'none',
  hair: 'short',
  facialHair: 'none',
  faceMark: 'none',
  top: 'tunic',
  bottom: 'trousers',
  cape: false,
  jewelry: 0,
  extras: [],
};

interface LegendDef {
  id: string;
  name: string;
  title: string;
  origin: string;
  lore: string;
  stats: Stats;
  weapon: Weapon;
  look: Partial<PuppetLook>;
  base: MoveSpec;
  special: MoveSpec;
  theme: StageTheme;
}

const stats = (strength: number, skill: number, speed: number, endurance: number, power: number, wisdom: number): Stats => ({
  strength,
  skill,
  speed,
  endurance,
  power,
  wisdom,
});

const DEFS: LegendDef[] = [
  {
    id: 'arjuna',
    name: 'Arjuna',
    title: 'The Peerless Archer',
    origin: 'Mahabharata',
    lore: 'Third of the Pandavas and wielder of the bow Gandiva, who could loose arrows with either hand faster than the eye could follow.',
    stats: stats(84, 98, 90, 86, 92, 88),
    weapon: 'bow',
    look: {
      skin: '#e0a060', primary: '#f2b21e', secondary: '#c92a1c', accent: '#e9a400',
      headgear: 'kirita', hair: 'long', facialHair: 'mustache', faceMark: 'tilak',
      top: 'sash', bottom: 'dhoti', jewelry: 2,
    },
    base: named('bow.shot', 'Swift Arrow'),
    special: named('bow.storm', 'Sharavarsha', { flavor: 'The rain of arrows: thirty-six fall where the foe stood.' }),
    theme: 'battlefield',
  },
  {
    id: 'karna',
    name: 'Karna',
    title: 'Son of the Sun',
    origin: 'Mahabharata',
    lore: 'Born with golden armour and earrings from his father Surya, the most generous of warriors and Arjuna’s equal with the bow.',
    stats: stats(88, 96, 86, 93, 90, 80),
    weapon: 'bow',
    look: {
      skin: '#c98a4a', primary: '#e9a400', secondary: '#b3261e', accent: '#f6d04a',
      headgear: 'kirita', hair: 'long', facialHair: 'mustache', faceMark: 'tilak',
      top: 'armor', bottom: 'dhoti', jewelry: 2, extras: ['halo'],
    },
    base: named('bow.twin', 'Vijaya Twin Shot'),
    special: named('bow.serpent', 'Nagastra', { flavor: 'The serpent arrow: its venom keeps biting after the hit.' }),
    theme: 'battlefield',
  },
  {
    id: 'bhima',
    name: 'Bhima',
    title: 'The Wolf-Bellied',
    origin: 'Mahabharata',
    lore: 'Second of the Pandavas, with the strength of ten thousand elephants and a mace no other man could lift.',
    stats: stats(99, 84, 72, 96, 80, 66),
    weapon: 'mace',
    look: {
      build: 'heavy', skin: '#c98a4a', primary: '#b3261e', secondary: '#2f9a4a', accent: '#e9a400',
      headgear: 'turban', hair: 'long', facialHair: 'full', faceMark: 'tilak',
      top: 'bare', bottom: 'dhoti', jewelry: 1,
    },
    base: named('mace.smash', 'Gada Smash'),
    special: named('mace.quake', 'Earthshaker'),
    theme: 'battlefield',
  },
  {
    id: 'hanuman',
    name: 'Hanuman',
    title: 'Son of the Wind',
    origin: 'Ramayana',
    lore: 'The vanara who leapt the ocean to Lanka and carried a mountain in one hand, devoted beyond measure and never once defeated.',
    stats: stats(99, 86, 97, 98, 94, 92),
    weapon: 'mace',
    look: {
      species: 'monkey', skin: '#e8662a', hairColor: '#8a3a12', primary: '#d8341f', secondary: '#f2b21e', accent: '#e9a400',
      headgear: 'kirita', hair: 'bald', facialHair: 'none', faceMark: 'tilak',
      top: 'bare', bottom: 'loincloth', jewelry: 2, extras: ['tail'],
    },
    base: named('mace.smash', 'Gada Strike'),
    special: named('mace.whirl', 'Whirlwind of Vayu'),
    theme: 'forest',
  },
  {
    id: 'ravana',
    name: 'Ravana',
    title: 'Ten-Headed King of Lanka',
    origin: 'Ramayana',
    lore: 'Scholar, musician and demon king, who won the moon-blade Chandrahasa from Shiva and made the gods his servants.',
    stats: stats(95, 92, 78, 93, 96, 90),
    weapon: 'sword',
    look: {
      build: 'heavy', skin: '#6f9a4a', primary: '#6a2f8f', secondary: '#c92a1c', accent: '#e9a400',
      headgear: 'kirita', hair: 'long', facialHair: 'full', faceMark: 'warpaint',
      top: 'armor', bottom: 'dhoti', cape: true, jewelry: 2,
    },
    base: named('sword.slash', 'Chandrahasa'),
    special: named('sword.cuts', 'Fury of Ten Heads', {
      element: 'shadow', shape: 'skull', count: 10, color: ELEMENT_COLORS.shadow,
      flavor: 'Ten shrieking heads fly at the foe.',
    }),
    theme: 'temple',
  },
  {
    id: 'thor',
    name: 'Thor',
    title: 'God of Thunder',
    origin: 'Norse',
    lore: 'Son of Odin and defender of Asgard, whose hammer Mjolnir levels mountains and always returns to his hand.',
    stats: stats(98, 84, 80, 96, 95, 66),
    weapon: 'hammer',
    look: {
      build: 'heavy', skin: '#f0c49a', hairColor: '#d9a53a', primary: '#3f6fae', secondary: '#c92a1c', accent: '#c9c2b0',
      headgear: 'winged_helm', hair: 'long', facialHair: 'full', faceMark: 'none',
      top: 'armor', bottom: 'trousers', cape: true, jewelry: 0,
    },
    base: named('hammer.throw', 'Mjolnir Throw'),
    special: named('hammer.lightning', 'Lightning Strike'),
    theme: 'mountains',
  },
  {
    id: 'zeus',
    name: 'Zeus',
    title: 'King of Olympus',
    origin: 'Greek',
    lore: 'Ruler of the sky and of the gods, who overthrew the Titans and whose thunderbolt no shield has ever turned.',
    stats: stats(90, 82, 80, 92, 99, 84),
    weapon: 'fists',
    look: {
      skin: '#e8b88a', hairColor: '#cfc6b4', primary: '#f1dfb6', secondary: '#7a3fa0', accent: '#e9a400',
      headgear: 'laurel', hair: 'long', facialHair: 'full', faceMark: 'none',
      top: 'sash', bottom: 'skirt', jewelry: 1,
    },
    base: named('fists.bolt', 'Thunderbolt', { element: 'lightning', shape: 'bolt', color: ELEMENT_COLORS.lightning, anim: 'throw', flavor: 'A thrown fork of lightning.' }),
    special: named('fists.blast', 'Olympian Storm', {
      delivery: 'rain', element: 'lightning', shape: 'bolt', count: 8, anim: 'cast', color: ELEMENT_COLORS.lightning,
      flavor: 'Eight bolts from a clear sky.',
    }),
    theme: 'columns',
  },
  {
    id: 'athena',
    name: 'Athena',
    title: 'Grey-Eyed Strategist',
    origin: 'Greek',
    lore: 'Goddess of wisdom and of war fought well, born fully armed and never beaten in a contest she chose to enter.',
    stats: stats(82, 95, 86, 88, 90, 99),
    weapon: 'spear',
    look: {
      build: 'slim', skin: '#ecc09a', hairColor: '#5a3a1e', primary: '#f1dfb6', secondary: '#2a6fbf', accent: '#e9a400',
      headgear: 'plume_helm', hair: 'braid', facialHair: 'none', faceMark: 'none',
      top: 'robe', bottom: 'skirt', jewelry: 1,
    },
    base: named('spear.thrust', 'Spear of Wisdom'),
    special: named('spear.light', 'Pallas Lance'),
    theme: 'columns',
  },
  {
    id: 'wukong',
    name: 'Sun Wukong',
    title: 'The Monkey King',
    origin: 'Chinese',
    lore: 'Born from a stone egg, he stormed heaven with a staff that grows from a needle to a pillar of the sky.',
    stats: stats(94, 95, 98, 96, 93, 78),
    weapon: 'staff',
    look: {
      species: 'monkey', skin: '#d9904a', hairColor: '#7a4a1e', primary: '#c92a1c', secondary: '#f2b21e', accent: '#e9a400',
      headgear: 'circlet', hair: 'bald', facialHair: 'none', faceMark: 'none',
      top: 'armor', bottom: 'trousers', jewelry: 1, extras: ['tail'],
    },
    base: named('staff.strike', 'Ruyi Jingu Bang'),
    special: named('staff.pillars', 'Pillar of Heaven'),
    theme: 'mountains',
  },
  {
    id: 'anubis',
    name: 'Anubis',
    title: 'Weigher of Hearts',
    origin: 'Egyptian',
    lore: 'The jackal-headed guardian of the dead, who weighs every heart against a feather and guides souls through the Duat.',
    stats: stats(84, 86, 84, 90, 94, 92),
    weapon: 'staff',
    look: {
      species: 'jackal', build: 'slim', skin: '#3d3340', hairColor: '#1e1820', primary: '#f1dfb6', secondary: '#2a6fbf', accent: '#e9a400',
      headgear: 'nemes', hair: 'bald', facialHair: 'none', faceMark: 'none',
      top: 'bare', bottom: 'kilt', jewelry: 2,
    },
    base: named('staff.strike', 'Was-Sceptre'),
    special: named('staff.curse', 'Curse of the Duat'),
    theme: 'desert',
  },
];

export const ROSTER: CharacterSheet[] = DEFS.map((d) => ({
  id: d.id,
  name: d.name,
  title: d.title,
  origin: d.origin,
  lore: d.lore,
  kind: 'legend' as const,
  stats: d.stats,
  rating: ratingFromStats(d.stats),
  weapon: d.weapon,
  look: { ...DEFAULT_LOOK, ...d.look, extras: d.look.extras ?? [] },
  moves: { base: d.base, special: d.special },
  theme: d.theme,
  source: 'builtin' as const,
}));

const BY_ID = new Map(ROSTER.map((c) => [c.id, c]));

export function findBuiltin(id: string): CharacterSheet | undefined {
  return BY_ID.get(id);
}

/** Dye colours offered in the forge. All are saturated, because the screen light only darkens them. */
export const SWATCHES = [
  '#d8341f', '#b3261e', '#ee7a1c', '#f2b21e', '#e9a400', '#f1dfb6', '#2f9a4a', '#1f7a45',
  '#2a6fbf', '#3f6fae', '#3a3f9a', '#6a2f8f', '#b8418f', '#2aa7a0', '#7a4a1e', '#2a1a14',
] as const;

export const SKIN_SWATCHES = ['#f0c49a', '#e0a060', '#c98a4a', '#9a6238', '#6b4226', '#4a7fd0', '#4fa35a', '#e8662a', '#3d3340'] as const;
