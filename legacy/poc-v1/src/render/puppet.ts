// Puppet_Character segments as translucent multiply meshes with perforation holes and ornaments
// (Req 1.1, 1.3, 1.4, 1.5). Meshes are built once; per frame only transforms change.
import { Container, Graphics, Mesh, MeshGeometry, Texture } from 'pixi.js';
import type { PuppetCharacter, SegmentArt, SegmentSpec } from '../core/scenario/types';
import type { Facing } from '../sim/world';
import { buildSegmentGeometry, sanitizeOrnaments, type SegmentGeometry } from './geometry';
import { PX_PER_M } from './layout';
import { ornamentStrokes } from './ornaments';
import { clampAlpha, parseHexColor, PUPPET_BLEND_MODE, shadeColor } from './style';

const DEFAULT_SEGMENT_COLOR = 0x7a5a3a;
const ORNAMENT_ALPHA = 0.9;
const ORNAMENT_LINE_PX = 1.6;

export interface SegmentView {
  id: string;
  /** Positioned and rotated each frame from the segment's body transform. */
  root: Container;
  /** Holds the mesh and ornaments; `scale.x` mirrors the art for characters facing -x. */
  art: Container;
  mesh: Mesh;
  ornaments: Graphics | null;
  geometry: SegmentGeometry;
  color: number;
  alpha: number;
}

export interface ResolvedSegmentStyle {
  color: number;
  alpha: number;
}

/** Color and clamped opacity for a segment, falling back to the character palette (Req 1.1). */
export function resolveSegmentStyle(
  index: number,
  art: SegmentArt | undefined,
  palette: readonly string[],
): ResolvedSegmentStyle {
  const paletteColor = palette.length > 0 ? parseHexColor(palette[index % palette.length], DEFAULT_SEGMENT_COLOR) : DEFAULT_SEGMENT_COLOR;
  return { color: parseHexColor(art?.color, paletteColor), alpha: clampAlpha(art?.opacity) };
}

/** Converts y-up meter positions to y-down pixel positions for a Pixi mesh. */
export function geometryToPixels(g: Pick<SegmentGeometry, 'positions'>, ppm = PX_PER_M): Float32Array {
  const out = new Float32Array(g.positions.length);
  for (let i = 0; i < g.positions.length; i += 2) {
    out[i] = g.positions[i]! * ppm;
    out[i + 1] = -g.positions[i + 1]! * ppm;
  }
  return out;
}

function buildMesh(geometry: SegmentGeometry, color: number, alpha: number, ppm: number): Mesh {
  const positions = geometryToPixels(geometry, ppm);
  const mesh = new Mesh({
    geometry: new MeshGeometry({
      positions,
      uvs: new Float32Array(positions.length),
      indices: new Uint32Array(geometry.indices),
    }),
    texture: Texture.WHITE,
  });
  mesh.tint = color;
  mesh.alpha = alpha;
  mesh.blendMode = PUPPET_BLEND_MODE;
  return mesh;
}

function buildOrnaments(art: SegmentArt | undefined, color: number, ppm: number): Graphics | null {
  const ornaments = sanitizeOrnaments(art?.ornaments);
  if (ornaments.length === 0) return null;
  const g = new Graphics();
  const ink = shadeColor(color, 0.4);
  for (const o of ornaments) {
    const { lines, dots } = ornamentStrokes(o);
    for (const line of lines) {
      if (line.length < 2) continue;
      g.moveTo(line[0]!.x * ppm, -line[0]!.y * ppm);
      for (let i = 1; i < line.length; i++) g.lineTo(line[i]!.x * ppm, -line[i]!.y * ppm);
    }
    if (lines.length > 0) g.stroke({ color: ink, width: ORNAMENT_LINE_PX, alpha: ORNAMENT_ALPHA });
    for (const d of dots) g.circle(d.center.x * ppm, -d.center.y * ppm, Math.max(0.8, d.radius * ppm));
    if (dots.length > 0) g.fill({ color: ink, alpha: ORNAMENT_ALPHA });
  }
  g.blendMode = PUPPET_BLEND_MODE;
  return g;
}

/** Builds one segment view. Bad perforation or ornament data degrades to a plain segment (Req 1.5). */
export function buildSegmentView(
  segment: SegmentSpec,
  index: number,
  art: SegmentArt | undefined,
  palette: readonly string[],
  ppm = PX_PER_M,
): SegmentView {
  const { color, alpha } = resolveSegmentStyle(index, art, palette);
  let geometry: SegmentGeometry;
  try {
    geometry = buildSegmentGeometry(segment, art);
  } catch {
    geometry = buildSegmentGeometry(segment, null);
  }
  const mesh = buildMesh(geometry, color, alpha, ppm);
  let ornaments: Graphics | null = null;
  try {
    ornaments = buildOrnaments(art, color, ppm);
  } catch {
    ornaments = null;
  }
  const artC = new Container();
  artC.addChild(mesh);
  if (ornaments) artC.addChild(ornaments);
  const root = new Container();
  root.label = `segment:${segment.id}`;
  root.addChild(artC);
  return { id: segment.id, root, art: artC, mesh, ornaments, geometry, color, alpha };
}

export class PuppetView {
  readonly container = new Container();
  readonly segments = new Map<string, SegmentView>();
  private facing: Facing = 1;

  constructor(readonly character: PuppetCharacter, ppm = PX_PER_M) {
    this.container.label = `puppet:${character.id}`;
    this.container.visible = false; // shown on the first sync with a sim transform
    const artById = new Map<string, SegmentArt>();
    for (const a of character.appearance.segments) if (!artById.has(a.segmentId)) artById.set(a.segmentId, a);
    character.rig.segments.forEach((s, i) => {
      const view = buildSegmentView(s, i, artById.get(s.id), character.appearance.palette, ppm);
      this.segments.set(s.id, view);
      this.container.addChild(view.root);
    });
  }

  /** Mirrors the art to match the sim, which mirrors outlines for characters facing -x. */
  setFacing(facing: Facing): void {
    if (facing === this.facing) return;
    this.facing = facing;
    for (const s of this.segments.values()) s.art.scale.x = facing;
  }

  getFacing(): Facing {
    return this.facing;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
