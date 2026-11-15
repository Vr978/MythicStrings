// SVG from a model (or from a client) is untrusted. It is rebuilt here from an allow-list of drawing
// elements and attributes, so scripts, links, external references and event handlers cannot survive.
// The browser also only ever loads the result as an image, where SVG cannot run code.
import { SLOT_BOX } from '../../shared/protocol';
import type { Slot } from '../../shared/types';

const TAGS: Record<string, string> = {
  g: 'g', path: 'path', rect: 'rect', circle: 'circle', ellipse: 'ellipse', line: 'line', polyline: 'polyline', polygon: 'polygon',
  defs: 'defs', lineargradient: 'linearGradient', radialgradient: 'radialGradient', stop: 'stop',
};
const VOID = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'stop']);
const ATTRS: Record<string, string> = {
  d: 'd', x: 'x', y: 'y', x1: 'x1', y1: 'y1', x2: 'x2', y2: 'y2', cx: 'cx', cy: 'cy', r: 'r', rx: 'rx', ry: 'ry', width: 'width', height: 'height',
  points: 'points', fill: 'fill', stroke: 'stroke', 'stroke-width': 'stroke-width', 'stroke-linecap': 'stroke-linecap',
  'stroke-linejoin': 'stroke-linejoin', 'stroke-dasharray': 'stroke-dasharray', opacity: 'opacity', 'fill-opacity': 'fill-opacity',
  'stroke-opacity': 'stroke-opacity', 'fill-rule': 'fill-rule', transform: 'transform', id: 'id', offset: 'offset',
  'stop-color': 'stop-color', 'stop-opacity': 'stop-opacity', gradientunits: 'gradientUnits', gradienttransform: 'gradientTransform',
  fx: 'fx', fy: 'fy',
};
const MAX_BYTES = 24_000;
const MAX_ELEMENTS = 160;
const TAG_RE = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTR_RE = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
// Numbers, path letters, colours, simple functions and local gradient references. No url() to anywhere else.
const SAFE_VALUE = /^(?:[\w\s.,#%()+\-/:]*|url\(#[\w-]+\))$/;

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Returns clean SVG in the slot's view box, or null when nothing drawable survives. */
export function sanitizeSvg(input: string, slot: Slot): string | null {
  if (typeof input !== 'string' || input.length > MAX_BYTES * 2) return null;
  const start = input.search(/<svg[\s>]/i);
  const end = input.toLowerCase().lastIndexOf('</svg>');
  const inner = start >= 0 && end > start ? input.slice(input.indexOf('>', start) + 1, end) : input;
  const out: string[] = [];
  const open: string[] = [];
  let elements = 0;
  let drawable = 0;
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(inner)) !== null) {
    const closing = m[1] === '/';
    const tag = TAGS[m[2]!.toLowerCase()];
    if (!tag) continue;
    if (closing) {
      if (open[open.length - 1] === tag) {
        open.pop();
        out.push(`</${tag}>`);
      }
      continue;
    }
    if (++elements > MAX_ELEMENTS) break;
    let attrs = '';
    let a: RegExpExecArray | null;
    ATTR_RE.lastIndex = 0;
    while ((a = ATTR_RE.exec(m[3] ?? '')) !== null) {
      const name = ATTRS[a[1]!.toLowerCase()];
      const value = (a[2] ?? a[3] ?? '').trim();
      if (!name || value.length > 6000 || !SAFE_VALUE.test(value) || /javascript|expression|data:/i.test(value)) continue;
      if (/url\s*\(/i.test(value) && !/^url\(#[\w-]+\)$/i.test(value)) continue;
      attrs += ` ${name}="${escapeAttr(value)}"`;
    }
    if (VOID.has(tag)) {
      out.push(`<${tag}${attrs}/>`);
      if (tag !== 'stop') drawable++;
    } else if (m[4] === '/') {
      out.push(`<${tag}${attrs}></${tag}>`);
    } else {
      open.push(tag);
      out.push(`<${tag}${attrs}>`);
    }
  }
  while (open.length) out.push(`</${open.pop()}>`);
  if (drawable === 0) return null;
  const box = SLOT_BOX[slot];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box.w} ${box.h}">${out.join('')}</svg>`;
  return svg.length > MAX_BYTES ? null : svg;
}
