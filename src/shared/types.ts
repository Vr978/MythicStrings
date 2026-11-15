// Data model shared by the browser, the server and the tests. Nothing here touches the DOM or Node.

export const ELEMENTS = ['physical', 'fire', 'lightning', 'water', 'ice', 'wind', 'earth', 'light', 'shadow', 'poison', 'energy'] as const;
export type Element = (typeof ELEMENTS)[number];

/** How an attack reaches the opponent. Each one has a different way to avoid it. */
export const DELIVERIES = ['melee', 'projectile', 'rain', 'beam', 'wave', 'burst'] as const;
export type Delivery = (typeof DELIVERIES)[number];

/** wall stops what comes from the side, canopy stops what falls, dome stops both. */
export const SHIELD_FORMS = ['wall', 'canopy', 'dome'] as const;
export type ShieldForm = (typeof SHIELD_FORMS)[number];

export const SHAPES = ['arrow', 'orb', 'blade', 'rock', 'hammer', 'spear', 'disc', 'bolt', 'flame', 'shard', 'skull', 'feather', 'lotus', 'serpent', 'star', 'fist'] as const;
export type Shape = (typeof SHAPES)[number];

export const ANIMS = ['shoot', 'swing', 'throw', 'cast', 'thrust', 'slam', 'guard'] as const;
export type Anim = (typeof ANIMS)[number];

export type MoveKind = 'attack' | 'defense';
/** instant: all damage lands inside the 2 s the effect is on screen. lingering: same total, decaying ticks. */
export type MoveMode = 'instant' | 'lingering';

export interface MoveSpec {
  id: string;
  name: string;
  kind: MoveKind;
  mode: MoveMode;
  delivery: Delivery;
  shieldForm: ShieldForm;
  element: Element;
  shape: Shape;
  /** Projectiles or strikes, 1..50. Total damage is split evenly between them. */
  count: number;
  /** Total damage budget before the caster's multiplier. Always 0 for a defense. */
  damage: number;
  /** Stamina for a character's own moves, mantra for a typed prompt. */
  cost: number;
  /** Seconds. Typed prompts use the mantra lock instead, so theirs is 0. */
  cooldown: number;
  color: string;
  anim: Anim;
  /** Reach in metres for melee. */
  reach?: number;
  /** One line shown under the move name. */
  flavor?: string;
}

export const WEAPONS = ['bow', 'mace', 'hammer', 'sword', 'spear', 'trident', 'staff', 'chakra', 'axe', 'fists'] as const;
export type Weapon = (typeof WEAPONS)[number];

/** The six fixed criteria every character is judged on, each 0..100. */
export const STAT_KEYS = ['strength', 'skill', 'speed', 'endurance', 'power', 'wisdom'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

export const STAT_LABELS: Record<StatKey, string> = {
  strength: 'Strength',
  skill: 'Weapon Skill',
  speed: 'Speed',
  endurance: 'Endurance',
  power: 'Divine Power',
  wisdom: 'Wisdom',
};

export const HEADGEAR = ['none', 'kirita', 'winged_helm', 'horned_helm', 'plume_helm', 'turban', 'topknot', 'laurel', 'nemes', 'circlet', 'hood'] as const;
export type Headgear = (typeof HEADGEAR)[number];
export const HAIR = ['bald', 'short', 'long', 'bun', 'braid'] as const;
export type Hair = (typeof HAIR)[number];
export const FACIAL_HAIR = ['none', 'mustache', 'beard', 'full'] as const;
export type FacialHair = (typeof FACIAL_HAIR)[number];
export const FACE_MARKS = ['none', 'tilak', 'bindi', 'third_eye', 'warpaint'] as const;
export type FaceMark = (typeof FACE_MARKS)[number];
export const SPECIES = ['human', 'monkey', 'jackal', 'bird'] as const;
export type Species = (typeof SPECIES)[number];
export const TOPS = ['bare', 'sash', 'armor', 'tunic', 'vest', 'robe'] as const;
export type Top = (typeof TOPS)[number];
export const BOTTOMS = ['dhoti', 'trousers', 'kilt', 'skirt', 'loincloth', 'greaves'] as const;
export type Bottom = (typeof BOTTOMS)[number];
export const BUILDS = ['slim', 'average', 'heavy'] as const;
export type Build = (typeof BUILDS)[number];
export const EXTRAS = ['tail', 'wings', 'halo', 'horns'] as const;
export type Extra = (typeof EXTRAS)[number];

export const SLOTS = ['headgear', 'top', 'bottom', 'weapon'] as const;
export type Slot = (typeof SLOTS)[number];

/** A garment or weapon cut by the AI atelier: sanitised SVG in the slot's fixed view box. */
export interface SvgAsset {
  id: string;
  name: string;
  slot: Slot;
  svg: string;
}

export interface PuppetLook {
  species: Species;
  build: Build;
  skin: string;
  hairColor: string;
  primary: string;
  secondary: string;
  accent: string;
  headgear: Headgear;
  hair: Hair;
  facialHair: FacialHair;
  faceMark: FaceMark;
  top: Top;
  bottom: Bottom;
  cape: boolean;
  /** 0 plain, 1 some ornaments, 2 heavily jewelled. */
  jewelry: number;
  extras: Extra[];
  custom?: Partial<Record<Slot, SvgAsset>>;
}

export const STAGE_THEMES = ['battlefield', 'temple', 'mountains', 'columns', 'forest', 'desert'] as const;
export type StageTheme = (typeof STAGE_THEMES)[number];

export interface Citation {
  title: string;
  url: string;
}

export interface CharacterSheet {
  id: string;
  name: string;
  /** Epithet, e.g. "The Peerless Archer". */
  title: string;
  /** Mythology or tradition, e.g. "Mahabharata", "Norse". */
  origin: string;
  lore: string;
  kind: 'legend' | 'custom';
  stats: Stats;
  /** 0..100. For a legend it is fixed for ever; for a custom character it follows the level. */
  rating: number;
  weapon: Weapon;
  look: PuppetLook;
  moves: { base: MoveSpec; special: MoveSpec };
  theme: StageTheme;
  /** Where the sheet came from. */
  source: 'builtin' | 'ai' | 'heuristic' | 'forge';
  citations?: Citation[];
  /** Custom characters only. */
  ownerId?: string;
  wins?: number;
  level?: number;
  createdAt?: number;
}

export interface PlayerProfile {
  id: string;
  name: string;
}

/** A typed prompt after the AI (or the fallback) has read it. */
export interface ResolvedPrompt {
  ok: boolean;
  /** Why the prompt was refused, when ok is false. */
  reason?: string;
  move: MoveSpec;
  /** 1..5, how mighty the described thing is. */
  magnitude: number;
  /** 0..1, how clearly the prompt read. */
  clarity: number;
  source: 'gemini' | 'bedrock' | 'memory' | 'cache' | 'heuristic';
  ms: number;
}

export interface ProgressUpdate {
  characterId: string;
  wins: number;
  level: number;
  rating: number;
  leveledUp: boolean;
}
