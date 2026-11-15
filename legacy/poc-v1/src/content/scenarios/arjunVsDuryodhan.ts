// Hardcoded Scenario "Arjun vs Duryodhan" on the field of Kurukshetra at dusk.
import { STARTING_HP, type PuppetCharacter, type Scenario, type SegmentArt, type StageSpec, type Vec2 } from '../../core/scenario/types';
import { DEFAULT_HUMANOID_RIG, resolveRig } from '../rig';

export const KURUKSHETRA_STAGE: StageSpec = {
  name: 'Kurukshetra at Dusk',
  // Dusk sky from horizon glow to deep indigo, behind the oil-lamp backlight.
  backdropPalette: ['#f6c56b', '#e38b3c', '#b2512f', '#5a2a3c', '#2a1a33'],
  floorY: 0,
  width: 16,
  height: 9,
  props: [],
};

const diamond = (cx: number, cy: number, r: number): Vec2[] => [
  { x: cx, y: cy - r },
  { x: cx + r, y: cy },
  { x: cx, y: cy + r },
  { x: cx - r, y: cy },
];

const square = (cx: number, cy: number, r: number): Vec2[] => [
  { x: cx - r, y: cy - r },
  { x: cx + r, y: cy - r },
  { x: cx + r, y: cy + r },
  { x: cx - r, y: cy + r },
];

/** Per-segment art for the default rig, using a 4-color palette [skin, garment, accent, trim]. */
function artFor(palette: readonly [string, string, string, string], ornament: 'floral' | 'scale'): SegmentArt[] {
  const [skin, garment, accent, trim] = palette;
  return [
    {
      segmentId: 'torso',
      color: garment,
      opacity: 0.75,
      perforations: [diamond(0, 0.12, 0.04), diamond(-0.09, -0.08, 0.03), diamond(0.09, -0.08, 0.03)],
      ornaments: [
        { pattern: ornament, position: { x: 0, y: -0.15 }, scale: 0.08 },
        { pattern: 'zigzag', position: { x: 0, y: 0.25 }, scale: 0.05 },
      ],
    },
    {
      segmentId: 'head',
      color: skin,
      opacity: 0.7,
      perforations: [square(0.05, 0.02, 0.015)],
      ornaments: [{ pattern: 'dots', position: { x: 0, y: 0.08 }, scale: 0.03 }],
    },
    { segmentId: 'upper_arm_l', color: skin, opacity: 0.6, ornaments: [{ pattern: 'dots', position: { x: 0, y: 0.1 }, scale: 0.02 }] },
    { segmentId: 'forearm_l', color: skin, opacity: 0.6 },
    { segmentId: 'upper_arm_r', color: skin, opacity: 0.55 },
    { segmentId: 'forearm_r', color: skin, opacity: 0.55 },
    {
      segmentId: 'thigh_l',
      color: accent,
      opacity: 0.8,
      perforations: [diamond(0, 0.05, 0.03)],
    },
    { segmentId: 'shin_l', color: trim, opacity: 0.85, ornaments: [{ pattern: 'zigzag', position: { x: 0, y: 0.15 }, scale: 0.03 }] },
    { segmentId: 'thigh_r', color: accent, opacity: 0.7 },
    { segmentId: 'shin_r', color: trim, opacity: 0.75 },
  ];
}

const ARJUN_PALETTE = ['#3f7a5a', '#d9a441', '#7a3b1f', '#1f4d6b'] as const;
const DURYODHAN_PALETTE = ['#b5483a', '#5c2a2a', '#c98a2e', '#2f2a1f'] as const;

export const ARJUN: PuppetCharacter = {
  id: 'arjun',
  name: 'Arjun',
  description: 'The Pandava archer prince, wielder of the Gandiva bow, calm and exact in battle.',
  controllerPlayerId: 'player-1',
  appearance: { palette: [...ARJUN_PALETTE], segments: artFor(ARJUN_PALETTE, 'floral') },
  rig: resolveRig(DEFAULT_HUMANOID_RIG),
  traits: [
    { name: 'Master Archer', description: 'Looses arrows with unmatched speed and accuracy.', magnitude: 9 },
    { name: 'Divine Weapon Affinity', description: 'Can call on celestial astras granted by the gods.', magnitude: 8 },
    { name: 'Focus', description: 'Sees only the eye of the target, never the distraction.', magnitude: 7 },
  ],
  startingHP: STARTING_HP,
};

export const DURYODHAN: PuppetCharacter = {
  id: 'duryodhan',
  name: 'Duryodhan',
  description: 'The eldest Kaurava prince, a mighty mace fighter who will not yield.',
  controllerPlayerId: 'player-2',
  appearance: { palette: [...DURYODHAN_PALETTE], segments: artFor(DURYODHAN_PALETTE, 'scale') },
  rig: resolveRig(DEFAULT_HUMANOID_RIG),
  traits: [
    { name: 'Mace Strength', description: 'Swings the heavy gada with crushing force.', magnitude: 9 },
    { name: 'Endurance', description: 'Keeps fighting long after others would fall.', magnitude: 8 },
    { name: 'Pride', description: 'Refuses to retreat, pressing every attack to the end.', magnitude: 6 },
  ],
  startingHP: STARTING_HP,
};

export const ARJUN_VS_DURYODHAN: Scenario = {
  id: 'arjun-vs-duryodhan',
  prompt: 'Arjun vs Duryodhan',
  stage: KURUKSHETRA_STAGE,
  narrative:
    'As the sun sinks over the plain of Kurukshetra, chariot wheels lie still in the dust. ' +
    'Arjun raises the Gandiva while Duryodhan lifts his mace, and the lamp behind the screen flickers as two shadows meet.',
  characters: [ARJUN, DURYODHAN],
};
