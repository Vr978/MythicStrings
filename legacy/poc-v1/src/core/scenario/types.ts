// Scenario data model (design: "Data Models > Scenario").
// Units are meters and radians. Coordinates are y-up: +y points away from the Stage floor.

export interface Vec2 {
  x: number;
  y: number;
}

/** Number of Health_Points every Puppet_Character starts a Battle with (Req 5.3). */
export const STARTING_HP = 100;

export interface Scenario {
  id: string;
  prompt: string;
  stage: StageSpec;
  narrative: string;
  /** 2..4, in Turn-order base sequence. */
  characters: PuppetCharacter[];
}

/** A static collider on the Stage. Outline is a convex polygon relative to `position`. */
export interface StageProp {
  id: string;
  name: string;
  position: Vec2;
  outline: Vec2[];
  color: string;
}

export interface StageSpec {
  name: string;
  /** Hex colors, back to front (used for the back-lit screen gradient). */
  backdropPalette: string[];
  /** Height of the floor surface in meters. */
  floorY: number;
  width: number;
  height: number;
  /** Static colliders. */
  props: StageProp[];
}

export interface PuppetAppearance {
  palette: string[];
  segments: SegmentArt[];
}

export interface PuppetCharacter {
  id: string;
  name: string;
  description: string;
  controllerPlayerId: string;
  appearance: PuppetAppearance;
  /** Resolved via resolveRig (Req 2.6). */
  rig: RigSpec;
  /** 3..6 (Req 5.1). */
  traits: Trait[];
  startingHP: typeof STARTING_HP;
}

export interface Trait {
  /** 1..40 characters, unique per character (case-insensitive). */
  name: string;
  /** 1..200 characters. */
  description: string;
  /** Integer 1..10. */
  magnitude: number;
}

export const SEGMENT_ROLES = [
  'head',
  'torso',
  'pelvis',
  'upper_arm',
  'forearm',
  'hand',
  'thigh',
  'shin',
  'foot',
  'accessory',
] as const;
export type SegmentRole = (typeof SEGMENT_ROLES)[number];

export interface SegmentSpec {
  id: string;
  role: SegmentRole;
  /** Segment-local polygon in meters, centered on the segment's body origin. */
  outline: Vec2[];
  density: number;
  /**
   * Body origin in the rig's rest pose, in character-local meters (origin at the floor
   * between the feet). Not in the design's sketch, but the sim needs it to place bodies.
   */
  restPosition: Vec2;
  /** Marks a segment whose bottom counts as a foot for the standing check (Req 2.3). */
  isFoot?: boolean;
}

/** Revolute joint. `anchor` is in rest-pose, character-local meters. */
export interface JointSpec {
  parent: string;
  child: string;
  anchor: Vec2;
  lowerRad: number;
  upperRad: number;
}

export interface RigSpec {
  /** 6..20 rigid bodies. */
  segments: SegmentSpec[];
  joints: JointSpec[];
}

export type OrnamentPattern = 'dots' | 'zigzag' | 'floral' | 'scale';

export interface Ornament {
  pattern: OrnamentPattern;
  /** Segment-local position. */
  position: Vec2;
  scale: number;
}

export interface SegmentArt {
  segmentId: string;
  color: string;
  /** Clamped to [0.3, 0.9] at render. */
  opacity: number;
  /** Hole polygons in segment-local coordinates. */
  perforations?: Vec2[][];
  ornaments?: Ornament[];
}
