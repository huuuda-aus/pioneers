// Building art: every building is drawn from vector shapes in the same
// isometric projection as the ground. A building stands on a rhombus footprint
// `w` wide; its left face looks down-left (lit), its right face down-right
// (shaded). Walls, roofs, doors and windows come from a few shared pieces, then
// each trade adds its own props and its own life (smoke, a turning wheel or
// sails, a glowing furnace). A site under construction goes through stages:
// foundation and material piles, a timber frame going up, then the finished
// building under scaffolding.
//
// All of it is a pure function of the arguments (no state, no randomness except
// from `seed`), so a building looks the same every frame; the tests draw every
// building in every state onto a recording stand-in for the canvas.

import type { Graphics } from 'pixi.js';
import { BuildingType } from '@sett/sim';
import { hash2, lerpColor, scaleColor } from './art.ts';

export interface Art {
  type: BuildingType;
  /** Ground point of the footprint centre. */
  cx: number;
  cy: number;
  /** Footprint width and wall height in world pixels. */
  w: number;
  h: number;
  /** Seconds, for animation only. */
  time: number;
  /** Whether the trade is at work right now (smoke, sparks, turning parts). */
  working: boolean;
  /** 1 for a finished building, below 1 a site: the share of its materials built in. */
  progress: number;
  /** Materials delivered but not yet built in, for the piles beside a site. */
  planks?: number;
  stones?: number;
  /** A number that makes this building differ a little from its neighbours. */
  seed: number;
  /** Which ore a mine digs (OreKind), for the colour of its cart. */
  ore?: number;
}

type Pt = { x: number; y: number };
const WOOD = 0x9a7048;
const DARK_WOOD = 0x5c4128;
const STONE = 0x9b9a96;
const SLATE = 0x4f5660;
const TILE_RED = 0xb4472f;
const OUTLINE = 0x1b140e;

/** The drawing context: a canvas, a footprint and a clock, with helpers for the faces of a box. */
class Ctx {
  readonly hw: number;
  readonly hd: number;
  constructor(
    readonly g: Graphics,
    readonly cx: number,
    readonly cy: number,
    readonly w: number,
    readonly h: number,
    readonly a: number,
    readonly t: number,
    readonly working: boolean,
    readonly seed: number,
  ) {
    this.hw = w / 2;
    this.hd = w / 4;
  }
  /** A point on the left face: u from the outer corner (0) to the middle (1), v from the ground (0) to the eaves (1). */
  left(u: number, v: number, h = this.h): Pt {
    return { x: this.cx - this.hw + this.hw * u, y: this.cy + this.hd * u - h * v };
  }
  /** A point on the right face: u from the middle (0) to the outer corner (1). */
  right(u: number, v: number, h = this.h): Pt {
    return { x: this.cx + this.hw * u, y: this.cy + this.hd * (1 - u) - h * v };
  }
  quad(side: 'l' | 'r', u0: number, u1: number, v0: number, v1: number, h = this.h): number[] {
    const p = side === 'l' ? (u: number, v: number) => this.left(u, v, h) : (u: number, v: number) => this.right(u, v, h);
    const a = p(u0, v0);
    const b = p(u1, v0);
    const c = p(u1, v1);
    const d = p(u0, v1);
    return [a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y];
  }
  fill(poly: number[], color: number, k = 1): void {
    this.g.poly(poly).fill({ color, alpha: this.a * k });
  }
  line(poly: number[], color: number, width = 1, k = 1): void {
    this.g.poly(poly, false).stroke({ width, color, alpha: this.a * k });
  }
  seg(a: Pt, b: Pt, color: number, width = 1, k = 1): void {
    this.g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width, color, alpha: this.a * k, cap: 'round' });
  }
  rect(x: number, y: number, w: number, h: number, color: number, k = 1): void {
    this.g.rect(x, y, w, h).fill({ color, alpha: this.a * k });
  }
  circle(x: number, y: number, r: number, color: number, k = 1): void {
    this.g.circle(x, y, r).fill({ color, alpha: this.a * k });
  }
  ellipse(x: number, y: number, rx: number, ry: number, color: number, k = 1): void {
    this.g.ellipse(x, y, rx, ry).fill({ color, alpha: this.a * k });
  }
}

// ---- pieces: walls, roofs, openings -----------------------------------------

interface WallStyle {
  /** Boards (vertical lines), horizontal logs, or blocks of stone. */
  texture: 'boards' | 'logs' | 'stone' | 'plaster' | 'brick';
  /** A stone footing of this fraction of the wall height, or 0. */
  footing?: number;
}

/** The two walls of a box, with their texture, and a flat top if it has no roof. */
function walls(c: Ctx, color: number, style: WallStyle, h = c.h, flatTop = false): void {
  const lcol = scaleColor(color, 0.86);
  const rcol = scaleColor(color, 0.64);
  c.fill(c.quad('l', 0, 1, 0, 1, h), lcol);
  c.fill(c.quad('r', 0, 1, 0, 1, h), rcol);
  for (const side of ['l', 'r'] as const) {
    const dark = side === 'l' ? 0.2 : 0.28;
    const at = (u: number, v: number) => (side === 'l' ? c.left(u, v, h) : c.right(u, v, h));
    if (style.texture === 'boards') {
      const n = 7;
      for (let i = 1; i < n; i++) c.seg(at(i / n, 0), at(i / n, 1), 0x000000, 1, dark);
    } else if (style.texture === 'logs') {
      const n = 6;
      for (let i = 1; i < n; i++) c.seg(at(0, i / n), at(1, i / n), 0x000000, 1.3, dark + 0.05);
      for (let i = 0; i < n; i++) {
        // log ends poking out at the corner
        const p = at(side === 'l' ? 0 : 1, (i + 0.5) / n);
        c.circle(p.x, p.y, 1.6, scaleColor(color, 0.55), 0.9);
      }
    } else if (style.texture === 'stone' || style.texture === 'brick') {
      const rows = style.texture === 'stone' ? 6 : 8;
      for (let r = 1; r < rows; r++) c.seg(at(0, r / rows), at(1, r / rows), 0x000000, 1, dark - 0.04);
      for (let r = 0; r < rows; r++) {
        const cols = style.texture === 'stone' ? 4 : 6;
        for (let k = 1; k < cols; k++) {
          const u = (k + (r % 2 ? 0.5 : 0)) / cols;
          if (u < 1) c.seg(at(u, r / rows), at(u, (r + 1) / rows), 0x000000, 1, dark - 0.06);
        }
      }
    } else {
      // plaster: a few cracks and a darker skirting
      c.seg(at(0.2, 0.55), at(0.3, 0.4), 0x000000, 1, 0.12);
      c.seg(at(0.7, 0.8), at(0.8, 0.62), 0x000000, 1, 0.1);
    }
    if (style.footing) c.fill(c.quad(side, 0, 1, 0, style.footing, h), side === 'l' ? scaleColor(STONE, 0.9) : scaleColor(STONE, 0.62));
    if (style.footing) c.seg(at(0, style.footing), at(1, style.footing), 0x000000, 1, 0.3);
  }
  // corner posts and the ground line
  c.seg(c.left(0, 0, h), c.left(0, 1, h), OUTLINE, 1, 0.45);
  c.seg(c.left(1, 0, h), c.left(1, 1, h), OUTLINE, 1.2, 0.5);
  c.seg(c.right(1, 0, h), c.right(1, 1, h), OUTLINE, 1, 0.45);
  c.line([...c.quad('l', 0, 1, 0, 0, h).slice(0, 4), ...c.quad('r', 0, 1, 0, 0, h).slice(2, 4)], OUTLINE, 1, 0.5);
  if (flatTop) {
    const top = [c.cx - c.hw, c.cy - h, c.cx, c.cy - h - c.hd, c.cx + c.hw, c.cy - h, c.cx, c.cy - h + c.hd];
    c.fill(top, scaleColor(color, 1.12));
    c.line([...top, top[0]!, top[1]!], OUTLINE, 1, 0.35);
  }
}

/** A gabled roof over a box `h` high, ridge `rise` above the eaves. `flip` mirrors it left to right. */
function gable(c: Ctx, color: number, rise: number, opts: { h?: number; flip?: boolean; shingles?: number; gable?: number; overhang?: number } = {}): void {
  const h = opts.h ?? c.h;
  const m = opts.flip ? -1 : 1;
  const X = (x: number): number => c.cx + m * (x - c.cx);
  const ov = opts.overhang ?? 3;
  const L = { x: X(c.cx - c.hw - ov), y: c.cy - h + ov * 0.5 };
  const F = { x: X(c.cx), y: c.cy - h + c.hd + ov };
  const Rl = { x: X(c.cx - c.hw / 2), y: c.cy - h - c.hd / 2 - rise };
  const Rr = { x: X(c.cx + c.hw / 2), y: c.cy - h + c.hd / 2 - rise };
  // gable end on the front-right wall (front-left when flipped)
  const endCol = opts.gable ?? 0;
  const tri = [F.x, c.cy - h + c.hd, X(c.cx + c.hw), c.cy - h, Rr.x, Rr.y];
  c.fill(tri, endCol || 0x6b5039, 1);
  c.line([...tri, tri[0]!, tri[1]!], OUTLINE, 1, 0.4);
  // the slope facing us
  const slope = [L.x, L.y, F.x, F.y, Rr.x + m * ov, Rr.y + ov * 0.8, Rl.x, Rl.y];
  c.fill(slope, scaleColor(color, 1.08));
  const n = opts.shingles ?? 6;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const a = { x: L.x + (Rl.x - L.x) * t, y: L.y + (Rl.y - L.y) * t };
    const b = { x: F.x + (Rr.x + m * ov - F.x) * t, y: F.y + (Rr.y + ov * 0.8 - F.y) * t };
    c.seg(a, b, 0x000000, 1, 0.2);
  }
  c.seg({ x: Rl.x, y: Rl.y }, { x: Rr.x, y: Rr.y }, scaleColor(color, 1.35), 2, 0.9); // ridge
  c.line([...slope, slope[0]!, slope[1]!], OUTLINE, 1, 0.45);
  c.seg(L, F, 0x000000, 3, 0.18); // shadow under the eave
}

/** A hipped (pyramid) roof. */
function hip(c: Ctx, color: number, rise: number, h = c.h): void {
  const apex = { x: c.cx, y: c.cy - h - rise };
  const L = { x: c.cx - c.hw - 3, y: c.cy - h + 1 };
  const F = { x: c.cx, y: c.cy - h + c.hd + 3 };
  const R = { x: c.cx + c.hw + 3, y: c.cy - h + 1 };
  c.fill([L.x, L.y, F.x, F.y, apex.x, apex.y], scaleColor(color, 1.12));
  c.fill([F.x, F.y, R.x, R.y, apex.x, apex.y], scaleColor(color, 0.78));
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    c.seg({ x: L.x + (apex.x - L.x) * t, y: L.y + (apex.y - L.y) * t }, { x: F.x + (apex.x - F.x) * t, y: F.y + (apex.y - F.y) * t }, 0x000000, 1, 0.18);
    c.seg({ x: F.x + (apex.x - F.x) * t, y: F.y + (apex.y - F.y) * t }, { x: R.x + (apex.x - R.x) * t, y: R.y + (apex.y - R.y) * t }, 0x000000, 1, 0.22);
  }
  c.line([L.x, L.y, F.x, F.y, R.x, R.y, apex.x, apex.y, L.x, L.y, F.x, F.y], OUTLINE, 1, 0.4);
}

/** A window on a face: frame, glass (lit warm when `lit`), cross bars, a sill. */
function windowAt(c: Ctx, side: 'l' | 'r', u: number, v: number, size = 0.13, lit = false, h = c.h): void {
  const du = size;
  const dv = size * 1.25 * (h / c.h);
  const frame = c.quad(side, u - du / 2 - 0.012, u + du / 2 + 0.012, v - dv / 2 - 0.02, v + dv / 2 + 0.02, h);
  c.fill(frame, 0x3b2a1b);
  const glass = c.quad(side, u - du / 2, u + du / 2, v - dv / 2, v + dv / 2, h);
  c.fill(glass, lit ? 0xffd77a : side === 'l' ? 0x8fb4c8 : 0x5d7f93);
  const at = side === 'l' ? c.left.bind(c) : c.right.bind(c);
  c.seg(at(u, v - dv / 2, h), at(u, v + dv / 2, h), 0x3b2a1b, 1, 0.9);
  c.seg(at(u - du / 2, v, h), at(u + du / 2, v, h), 0x3b2a1b, 1, 0.9);
}

/** A door on a face, optionally arched, with planks and a handle. */
function doorAt(c: Ctx, side: 'l' | 'r', u: number, width: number, height: number, color = 0x5a3a22, arched = false, h = c.h): void {
  const at = side === 'l' ? c.left.bind(c) : c.right.bind(c);
  const u0 = u - width / 2;
  const u1 = u + width / 2;
  const pts: Pt[] = [at(u0, 0, h), at(u1, 0, h)];
  if (arched) {
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * Math.PI;
      pts.push(at(u1 - width * (0.5 - 0.5 * Math.cos(a)) * 1, height - 0.0 + 0.12 * Math.sin(a) - 0.06, h));
    }
  } else {
    pts.push(at(u1, height, h), at(u0, height, h));
  }
  c.fill(pts.flatMap((p) => [p.x, p.y]), color);
  c.line([...pts.flatMap((p) => [p.x, p.y]), pts[0]!.x, pts[0]!.y], OUTLINE, 1, 0.6);
  c.seg(at(u, 0, h), at(u, height - (arched ? 0.04 : 0), h), 0x000000, 1, 0.3);
  const knob = at(u + width * 0.28, height * 0.45, h);
  c.circle(knob.x, knob.y, 1, 0xe3c46a);
  // a step
  c.fill(c.quad(side, u0 - 0.03, u1 + 0.03, -0.04, 0, h), scaleColor(STONE, 0.9));
}

function chimney(c: Ctx, x: number, y: number, hgt: number, w = 5, color = 0x7a5a48): void {
  c.rect(x - w / 2, y - hgt, w, hgt, scaleColor(color, 0.85));
  c.rect(x, y - hgt, w / 2, hgt, scaleColor(color, 0.62));
  c.rect(x - w / 2 - 1, y - hgt - 2, w + 2, 3, scaleColor(color, 1.1));
}

/** Rising puffs of smoke from a chimney top; only when `on`. */
function smoke(c: Ctx, x: number, y: number, on: boolean, color = 0xe9e9ee, strength = 1): void {
  const n = on ? 5 : 1;
  for (let i = 0; i < n; i++) {
    const ph = (c.t * 0.45 + i / n + c.seed * 0.17) % 1;
    const sway = Math.sin(c.t * 1.3 + i * 2 + c.seed) * 4 * ph;
    c.circle(x + 3 * ph + sway, y - 4 - 26 * ph, (2 + 5.5 * ph) * strength, color, (on ? 0.5 : 0.18) * (1 - ph));
  }
}

// ---- props -----------------------------------------------------------------

function logPile(c: Ctx, x: number, y: number, rows = 3): void {
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < rows - r; i++) {
      const lx = x + i * 5.2 + r * 2.6;
      const ly = y - r * 4.2;
      c.ellipse(lx + 2, ly, 5, 2.4, scaleColor(WOOD, 0.8));
      c.circle(lx, ly - 0.5, 2.7, lerpColor(0xc79b62, 0xa97a46, hash2(i, r, 3)));
      c.circle(lx, ly - 0.5, 1.2, 0xe2c08a, 0.8);
    }
  }
}
function plankStack(c: Ctx, x: number, y: number, layers = 4, w = 14): void {
  for (let i = 0; i < layers; i++) {
    const yy = y - i * 2.6;
    c.fill([x - w / 2, yy, x, yy + w / 4, x + w / 2, yy, x, yy - w / 4], i % 2 ? 0xe8c98a : 0xd9b673);
    c.fill([x - w / 2, yy, x, yy + w / 4, x, yy + w / 4 + 2.2, x - w / 2, yy + 2.2], 0xb88f55);
    c.fill([x, yy + w / 4, x + w / 2, yy, x + w / 2, yy + 2.2, x, yy + w / 4 + 2.2], 0x94703f);
  }
}
function stoneHeap(c: Ctx, x: number, y: number, n = 4): void {
  for (let i = 0; i < n; i++) {
    const sx = x + (hash2(i, 1, c.seed) - 0.5) * 12;
    const sy = y - (hash2(i, 2, c.seed) * 5);
    const r = 3 + hash2(i, 3, c.seed) * 2.5;
    c.ellipse(sx + 1, sy + 1, r + 1, r * 0.55, 0x000000, 0.2);
    c.g.poly([sx - r, sy, sx - r * 0.5, sy - r * 0.9, sx + r * 0.6, sy - r, sx + r, sy - r * 0.2, sx + r * 0.7, sy]).fill({ color: scaleColor(STONE, 0.8 + 0.3 * hash2(i, 4, c.seed)), alpha: c.a });
  }
}
function barrel(c: Ctx, x: number, y: number, color = 0x8a5a32): void {
  c.ellipse(x + 1, y + 1, 5, 2.2, 0x000000, 0.22);
  c.rect(x - 4, y - 9, 8, 9, scaleColor(color, 0.9));
  c.rect(x + 1, y - 9, 3, 9, scaleColor(color, 0.65));
  c.ellipse(x, y - 9, 4, 1.8, scaleColor(color, 1.2));
  c.rect(x - 4, y - 6.5, 8, 1, 0x3a3a3a, 0.7);
  c.rect(x - 4, y - 2.5, 8, 1, 0x3a3a3a, 0.7);
}
function crate(c: Ctx, x: number, y: number, s = 8): void {
  c.ellipse(x + 1, y + 1, s * 0.7, s * 0.3, 0x000000, 0.2);
  c.fill([x - s / 2, y - s, x, y - s + s / 4, x, y + s / 4, x - s / 2, y], 0xb98a50);
  c.fill([x, y - s + s / 4, x + s / 2, y - s, x + s / 2, y, x, y + s / 4], 0x8b6538);
  c.fill([x - s / 2, y - s, x, y - s - s / 4, x + s / 2, y - s, x, y - s + s / 4], 0xd0a468);
  c.seg({ x: x - s / 2, y: y - s / 2 }, { x, y: y - s / 2 + s / 4 }, 0x000000, 1, 0.3);
}
function sack(c: Ctx, x: number, y: number, color = 0xe8dcc0): void {
  c.ellipse(x + 1, y + 1, 4.5, 2, 0x000000, 0.2);
  c.g.poly([x - 4, y, x - 3.5, y - 6, x - 1.5, y - 8.5, x + 1.5, y - 8.5, x + 3.5, y - 6, x + 4, y]).fill({ color, alpha: c.a });
  c.g.poly([x + 0.5, y, x + 1.5, y - 8.5, x + 3.5, y - 6, x + 4, y]).fill({ color: scaleColor(color, 0.78), alpha: c.a });
  c.seg({ x: x - 1.5, y: y - 8.5 }, { x: x + 1.5, y: y - 8.5 }, 0x6a5a3a, 1.3, 0.8);
}
function fence(c: Ctx, a: Pt, b: Pt, posts = 5): void {
  c.seg(a, b, 0x6a4a2c, 1.4, 0.9);
  c.seg({ x: a.x, y: a.y - 3.5 }, { x: b.x, y: b.y - 3.5 }, 0x6a4a2c, 1.4, 0.9);
  for (let i = 0; i < posts; i++) {
    const t = i / (posts - 1);
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    c.seg({ x, y }, { x, y: y - 6 }, 0x4a3320, 1.6);
  }
}
function haystack(c: Ctx, x: number, y: number): void {
  c.ellipse(x + 2, y + 1, 10, 4, 0x000000, 0.22);
  c.g.poly([x - 9, y, x - 8, y - 7, x - 4, y - 12, x, y - 14, x + 4, y - 12, x + 8, y - 7, x + 9, y]).fill({ color: 0xd9bb5a, alpha: c.a });
  c.g.poly([x + 1, y, x, y - 14, x + 4, y - 12, x + 8, y - 7, x + 9, y]).fill({ color: 0xb59840, alpha: c.a });
  for (let i = 0; i < 5; i++) c.seg({ x: x - 7 + i * 3.4, y: y - 2 - (i % 2) * 3 }, { x: x - 5 + i * 3.4, y: y - 5 - (i % 2) * 3 }, 0x8a7430, 1, 0.5);
}
function ingots(c: Ctx, x: number, y: number, color: number): void {
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 3 - r; i++) {
      const ix = x + i * 6 + r * 3;
      const iy = y - r * 3;
      c.g.poly([ix - 3, iy, ix - 2, iy - 2.6, ix + 3, iy - 2.6, ix + 4, iy]).fill({ color: lerpColor(color, 0xffffff, 0.18), alpha: c.a });
      c.rect(ix - 3, iy, 7, 2, scaleColor(color, 0.72));
    }
  }
}
function anvil(c: Ctx, x: number, y: number): void {
  c.ellipse(x + 1, y + 1, 6, 2.4, 0x000000, 0.22);
  c.rect(x - 3, y - 4, 6, 4, 0x4d5057);
  c.g.poly([x - 7, y - 4, x + 7, y - 4, x + 9, y - 7, x - 4, y - 7]).fill({ color: 0x70747c, alpha: c.a });
  c.rect(x - 7, y - 7.5, 3, 1.2, 0x8a8e96);
}
function sprouts(c: Ctx, x: number, y: number, n: number, k: number): void {
  c.g.poly([x - 11, y, x, y - 5, x + 11, y, x, y + 5]).fill({ color: 0x6b4b2e, alpha: c.a });
  for (let i = 0; i < n; i++) {
    const sx = x - 7 + (i % 3) * 7 + (Math.floor(i / 3) % 2) * 3;
    const sy = y - 2 + Math.floor(i / 3) * 2.4 - 1;
    const hgt = 3 + k * 6;
    c.seg({ x: sx, y: sy }, { x: sx, y: sy - hgt }, 0x4f9a43, 1.4);
    c.circle(sx, sy - hgt, 1.9 + k, 0x74c05a);
  }
}
function lantern(c: Ctx, x: number, y: number): void {
  c.seg({ x, y }, { x, y: y - 9 }, 0x3a2a1a, 1.3);
  c.rect(x - 2.2, y - 13, 4.4, 4.6, 0xffd77a);
  c.circle(x, y - 10.7, 5, 0xffd77a, 0.16);
  c.rect(x - 2.6, y - 14, 5.2, 1.3, 0x3a2a1a);
}
function flag(c: Ctx, x: number, y: number, color: number, scale = 1): void {
  c.seg({ x, y }, { x, y: y - 16 * scale }, 0x3a2a1a, 1.6);
  const wave = Math.sin(c.t * 4 + c.seed) * 1.8 * scale;
  c.g.poly([x, y - 16 * scale, x + 11 * scale, y - 14 * scale + wave, x + 9 * scale, y - 11 * scale + wave * 0.6, x + 12 * scale, y - 8.5 * scale + wave, x, y - 9.5 * scale]).fill({ color, alpha: c.a });
}
function cart(c: Ctx, x: number, y: number, ore: number): void {
  c.ellipse(x + 1, y + 1, 7, 2.4, 0x000000, 0.22);
  c.g.poly([x - 7, y - 3, x - 6, y - 8, x + 6, y - 8, x + 7, y - 3]).fill({ color: 0x5a4636, alpha: c.a });
  c.rect(x - 7, y - 4, 14, 1.2, 0x3a2e24);
  for (let i = 0; i < 4; i++) c.circle(x - 4.5 + i * 3, y - 8.6 - (i % 2) * 1.1, 2.2, scaleColor(ore, 0.85 + 0.25 * hash2(i, 9, c.seed)));
  c.circle(x - 4, y - 1, 1.9, 0x2a2a2a);
  c.circle(x + 4, y - 1, 1.9, 0x2a2a2a);
}
function rails(c: Ctx, a: Pt, b: Pt): void {
  c.seg(a, b, 0x4a3a2a, 3, 0.55);
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    c.seg({ x: a.x + (b.x - a.x) * t - 2.5, y: a.y + (b.y - a.y) * t + 1 }, { x: a.x + (b.x - a.x) * t + 2.5, y: a.y + (b.y - a.y) * t - 1 }, 0x6a5238, 1.4, 0.9);
  }
}

/** A pig: pink body, snout, flopped ears, a curly tail. `bob` in [-1, 1] makes it trot a little. */
function pig(c: Ctx, x: number, y: number, face: 1 | -1, bob: number, size = 1): void {
  const s = size;
  c.ellipse(x + 1, y + 1, 7 * s, 2.6 * s, 0x000000, 0.22);
  const by = y - 4.5 * s - Math.abs(bob) * 0.8;
  c.ellipse(x, by, 7 * s, 4.4 * s, 0xf0a8b8);
  c.ellipse(x + 1.2 * s * face, by + 1.4 * s, 5.2 * s, 2.6 * s, 0xe38aa0, 0.5);
  c.circle(x + 6 * s * face, by - 1 * s, 3.1 * s, 0xf4b5c4);
  c.ellipse(x + 8.6 * s * face, by - 0.2 * s, 1.5 * s, 1.2 * s, 0xe0788f);
  c.g.poly([x + 4.6 * s * face, by - 3.4 * s, x + 6.2 * s * face, by - 6 * s, x + 7.4 * s * face, by - 2.6 * s]).fill({ color: 0xe98fa5, alpha: c.a });
  c.circle(x + 6.8 * s * face, by - 1.8 * s, 0.7 * s, 0x2a1a1a);
  const step = bob * 1.2 * s;
  for (const [dx, k] of [[-4, 1], [-1.6, -1], [2, 1], [4.4, -1]] as const) c.rect(x + dx * s - 0.7, by + 3 * s, 1.5 * s, 2.6 * s + k * step * 0.5, 0xd98aa0);
  c.seg({ x: x - 6.6 * s * face, y: by - 0.6 * s }, { x: x - 8.6 * s * face, y: by - 2.4 * s }, 0xe38aa0, 1.2 * s);
  c.circle(x - 8.8 * s * face, by - 2.4 * s, 1 * s, 0xe38aa0, 0.9);
}

// ---- the buildings ---------------------------------------------------------

function lumberjack(c: Ctx): void {
  logPile(c, c.cx - c.hw - 6, c.cy + 7, 3);
  walls(c, WOOD, { texture: 'logs', footing: 0.12 });
  gable(c, 0x6e4a2c, 15, { shingles: 7, gable: 0x735236 });
  doorAt(c, 'l', 0.5, 0.26, 0.62, 0x4c321e);
  windowAt(c, 'r', 0.5, 0.58, 0.2, c.working);
  chimney(c, c.cx - 6, c.cy - c.h - 8, 12, 5);
  smoke(c, c.cx - 6, c.cy - c.h - 20, c.working);
  // the chopping block, with the axe in it
  const bx = c.cx + c.hw + 5;
  const by = c.cy + 9;
  c.ellipse(bx, by + 1, 7, 3, 0x000000, 0.25);
  c.rect(bx - 5, by - 7, 10, 8, 0x8a6035);
  c.ellipse(bx, by - 7, 5, 2.2, 0xd2a972);
  const swing = c.working ? Math.sin(c.t * 7) * 0.5 : 0;
  c.seg({ x: bx + 1, y: by - 8 }, { x: bx + 8 + swing * 6, y: by - 17 - swing * 3 }, 0x6b4a2b, 1.8);
  c.g.poly([bx + 5 + swing * 6, by - 17 - swing * 3, bx + 11 + swing * 6, by - 18 - swing * 3, bx + 9 + swing * 6, by - 13 - swing * 3]).fill({ color: 0xb7bcc4, alpha: c.a });
  // a log standing waiting on the sawhorse
  c.seg({ x: c.cx + 2, y: c.cy + c.hd + 10 }, { x: c.cx + 8, y: c.cy + c.hd + 6 }, 0x6b4a2b, 1.6);
  c.seg({ x: c.cx + 8, y: c.cy + c.hd + 10 }, { x: c.cx + 14, y: c.cy + c.hd + 6 }, 0x6b4a2b, 1.6);
  c.rect(c.cx + 1, c.cy + c.hd + 5, 14, 3, 0xb98a50);
}

function forester(c: Ctx): void {
  walls(c, 0x8d7a4a, { texture: 'plaster', footing: 0.1 });
  gable(c, 0x3f7a3c, 15, { shingles: 6, gable: 0x76693f, flip: true });
  // moss and grass on the roof
  for (let i = 0; i < 5; i++) c.circle(c.cx - c.hw / 2 + i * 6, c.cy - c.h - 4 - (i % 2) * 3 - i * 0.8, 2.6, 0x5fa54a, 0.8);
  doorAt(c, 'l', 0.5, 0.26, 0.6, 0x4b3a24);
  windowAt(c, 'r', 0.5, 0.58, 0.2, c.working);
  // seedbeds and a watering can
  sprouts(c, c.cx - c.hw - 9, c.cy + 9, 6, c.working ? 0.7 : 0.4);
  sprouts(c, c.cx + c.hw + 10, c.cy + 10, 6, 0.9);
  c.rect(c.cx + c.hw - 2, c.cy + 12, 6, 4.5, 0x4f7a8c);
  c.seg({ x: c.cx + c.hw + 4, y: c.cy + 13 }, { x: c.cx + c.hw + 9, y: c.cy + 10 }, 0x4f7a8c, 1.4);
  // a shovel against the wall
  c.seg({ x: c.cx - c.hw - 2, y: c.cy + 4 }, { x: c.cx - c.hw + 3, y: c.cy - 9 }, 0x6b4a2b, 1.6);
  c.g.poly([c.cx - c.hw - 4, c.cy + 6, c.cx - c.hw, c.cy + 6, c.cx - c.hw - 2, c.cy + 12]).fill({ color: 0xb7bcc4, alpha: c.a });
}

function sawmill(c: Ctx): void {
  plankStack(c, c.cx - c.hw - 4, c.cy + 12, 5, 16);
  plankStack(c, c.cx - c.hw + 11, c.cy + 17, 3, 16);
  logPile(c, c.cx + c.hw - 12, c.cy + 20, 3);
  walls(c, 0xb08a58, { texture: 'boards', footing: 0.14 });
  gable(c, 0x7a5a38, 18, { shingles: 9, gable: 0x8b6a45, overhang: 4 });
  // a wide opening in the front wall with the saw blade turning inside
  const o = c.quad('l', 0.12, 0.88, 0.0, 0.62);
  c.fill(o, 0x20160e);
  const sx = c.left(0.5, 0.3).x;
  const sy = c.left(0.5, 0.3).y;
  c.circle(sx, sy, 9, 0xaab0b8);
  c.circle(sx, sy, 2.4, 0x4d5057);
  const spin = c.working ? c.t * 14 : 0.4;
  for (let i = 0; i < 10; i++) {
    const a = spin + (i / 10) * Math.PI * 2;
    c.g.poly([sx + Math.cos(a) * 8, sy + Math.sin(a) * 8, sx + Math.cos(a + 0.18) * 11.2, sy + Math.sin(a + 0.18) * 11.2, sx + Math.cos(a + 0.36) * 8, sy + Math.sin(a + 0.36) * 8]).fill({ color: 0x8e949c, alpha: c.a });
  }
  c.seg({ x: c.left(0.12, 0.62).x, y: c.left(0.12, 0.62).y }, { x: c.left(0.88, 0.62).x, y: c.left(0.88, 0.62).y }, DARK_WOOD, 2);
  windowAt(c, 'r', 0.5, 0.6, 0.22, c.working);
  chimney(c, c.cx + 10, c.cy - c.h - 6, 9, 5);
  smoke(c, c.cx + 10, c.cy - c.h - 15, false);
  if (c.working) {
    for (let i = 0; i < 4; i++) {
      const ph = (c.t * 2 + i * 0.27) % 1;
      c.circle(sx + 10 + ph * 8, sy + 4 - ph * 6, 1.1, 0xf0d9a0, 0.8 * (1 - ph)); // sawdust
    }
  }
}

function stonecutter(c: Ctx): void {
  stoneHeap(c, c.cx - c.hw - 5, c.cy + 9, 5);
  walls(c, 0xa7a49d, { texture: 'stone' });
  gable(c, SLATE, 12, { shingles: 5, gable: 0x8b8880, flip: false });
  doorAt(c, 'l', 0.5, 0.26, 0.6, 0x4a3a2a, true);
  windowAt(c, 'r', 0.5, 0.58, 0.18, c.working);
  // a cutting bench with a block and a chisel
  const bx = c.cx + c.hw + 6;
  const by = c.cy + 10;
  c.rect(bx - 8, by - 6, 16, 2.4, 0x7a5a38);
  c.seg({ x: bx - 6, y: by - 4 }, { x: bx - 6, y: by + 1 }, 0x5a4028, 1.6);
  c.seg({ x: bx + 6, y: by - 4 }, { x: bx + 6, y: by + 1 }, 0x5a4028, 1.6);
  c.g.poly([bx - 5, by - 6, bx - 1, by - 11, bx + 6, by - 10, bx + 4, by - 6]).fill({ color: 0xc4c1ba, alpha: c.a });
  const tap = c.working ? Math.abs(Math.sin(c.t * 9)) : 0;
  c.seg({ x: bx + 3, y: by - 14 - tap * 4 }, { x: bx + 3, y: by - 10 }, 0x8a8e96, 1.4);
  c.seg({ x: bx + 6, y: by - 15 - tap * 6 }, { x: bx + 1, y: by - 15 - tap * 6 }, 0x6b4a2b, 2);
  if (c.working) c.circle(bx + 3, by - 10, 2.4, 0xfff3c4, 0.5 * tap);
  stoneHeap(c, c.cx + 6, c.cy + c.hd + 10, 3);
}

function storage(c: Ctx): void {
  barrel(c, c.cx - c.hw - 4, c.cy + 9);
  barrel(c, c.cx - c.hw + 6, c.cy + 14, 0x7a5030);
  crate(c, c.cx + c.hw + 4, c.cy + 10, 9);
  crate(c, c.cx + c.hw - 5, c.cy + 17, 7);
  sack(c, c.cx + c.hw + 12, c.cy + 15);
  walls(c, 0xb59365, { texture: 'boards', footing: 0.2 });
  hip(c, 0x8a5636, 15);
  // big double doors on the front-left wall, with a hoist above
  const door = c.quad('l', 0.2, 0.8, 0, 0.62);
  c.fill(door, 0x4a3320);
  c.line([...door, door[0]!, door[1]!], OUTLINE, 1.2, 0.7);
  c.seg(c.left(0.5, 0), c.left(0.5, 0.62), 0x000000, 1.4, 0.55);
  for (const u of [0.28, 0.38, 0.62, 0.72]) c.seg(c.left(u, 0.1), c.left(u, 0.52), 0x000000, 1, 0.22);
  c.circle(c.left(0.45, 0.28).x, c.left(0.45, 0.28).y, 1.3, 0xe3c46a);
  c.circle(c.left(0.55, 0.28).x, c.left(0.55, 0.28).y, 1.3, 0xe3c46a);
  windowAt(c, 'r', 0.3, 0.6, 0.16, false);
  windowAt(c, 'r', 0.7, 0.6, 0.16, false);
  // a hoist beam out over the doors, with a rope and a crate swinging a little
  const top = c.left(0.5, 1);
  const beam = { x: top.x - 4, y: top.y - 6 };
  c.seg({ x: top.x + 6, y: top.y - 10 }, { x: beam.x - 10, y: beam.y - 6 }, DARK_WOOD, 2.2);
  const sw = Math.sin(c.t * 1.6 + c.seed) * 1.2;
  c.seg({ x: beam.x - 10, y: beam.y - 5 }, { x: beam.x - 10 + sw, y: beam.y + 7 }, 0xd8c79a, 1);
  c.rect(beam.x - 13 + sw, beam.y + 7, 6, 5, 0xb98a50);
}

function castle(c: Ctx): void {
  // gate wall and keep first, towers in front of them
  walls(c, 0xa38b8f, { texture: 'stone', footing: 0.12 }, c.h, true);
  // crenellations along the top edges
  for (let i = 0; i < 6; i++) {
    const u = (i + 0.2) / 6;
    const p = c.left(u, 1);
    c.rect(p.x - 2, p.y - 6, 4.2, 6, 0xb8a1a5);
    const q = c.right(u, 1);
    c.rect(q.x - 2, q.y - 6, 4.2, 6, 0x8a7478);
  }
  // the gate, an arch with a portcullis
  const gate = c.quad('l', 0.34, 0.66, 0, 0.55);
  c.fill(gate, 0x1d1511);
  for (const u of [0.4, 0.46, 0.52, 0.58, 0.64]) c.seg(c.left(u, 0), c.left(u, 0.55), 0x6b6b70, 1.1, 0.8);
  for (const v of [0.15, 0.3, 0.45]) c.seg(c.left(0.34, v), c.left(0.66, v), 0x6b6b70, 1.1, 0.8);
  c.line([...gate, gate[0]!, gate[1]!], OUTLINE, 1.4, 0.7);
  // arrow slits and a few windows
  for (const [u, v] of [[0.12, 0.62], [0.88, 0.62], [0.2, 0.3], [0.8, 0.3]] as const) {
    const p = c.left(u, v);
    c.rect(p.x - 1, p.y - 4, 2, 8, 0x14100d);
  }
  windowAt(c, 'r', 0.35, 0.6, 0.14, false);
  windowAt(c, 'r', 0.7, 0.6, 0.14, false);
  // two round towers with cone roofs, drawn in front
  for (const sx of [-1, 1]) {
    const tx = c.cx + sx * c.w * 0.64;
    const ty = c.cy + 2;
    const th = c.h + 22;
    const tw = 22;
    c.ellipse(tx + 2, ty + 5, tw * 0.62, tw * 0.28, 0x000000, 0.25);
    c.g.poly([tx - tw / 2, ty, tx - tw / 2, ty - th, tx, ty - th + 3, tx, ty + 5]).fill({ color: 0xa38b8f, alpha: c.a });
    c.g.poly([tx, ty - th + 3, tx + tw / 2, ty - th, tx + tw / 2, ty, tx, ty + 5]).fill({ color: 0x7c676b, alpha: c.a });
    for (let r = 1; r < 8; r++) c.seg({ x: tx - tw / 2, y: ty - (th / 8) * r }, { x: tx + tw / 2, y: ty - (th / 8) * r + 0.5 }, 0x000000, 1, 0.14);
    const sl = { x: tx - 1, y: ty - th * 0.55 };
    c.rect(sl.x, sl.y, 2, 9, 0x14100d);
    // the cone
    const apex = { x: tx, y: ty - th - 18 };
    c.fill([tx - tw / 2 - 3, ty - th + 1, tx + 1, ty - th + 6, apex.x, apex.y], 0xb23a48);
    c.fill([tx + 1, ty - th + 6, tx + tw / 2 + 3, ty - th + 1, apex.x, apex.y], 0x7c2832);
    c.line([tx - tw / 2 - 3, ty - th + 1, apex.x, apex.y, tx + tw / 2 + 3, ty - th + 1], OUTLINE, 1, 0.5);
    flag(c, apex.x, apex.y + 1, sx < 0 ? 0xf2d04b : 0xe8e8e8, 1);
  }
  // a banner on the keep
  const top = c.left(0.5, 1);
  flag(c, top.x, top.y - 8, 0xb23a48, 1.2);
}

function fisher(c: Ctx): void {
  walls(c, 0x7d9aa3, { texture: 'boards', footing: 0.1 });
  gable(c, 0x4f6f7c, 14, { shingles: 6, gable: 0x6f8a93, flip: true });
  doorAt(c, 'l', 0.5, 0.26, 0.6, 0x3f4e55);
  windowAt(c, 'r', 0.5, 0.58, 0.2, c.working);
  // a net hung to dry between two posts
  const a = { x: c.cx - c.hw - 14, y: c.cy + 12 };
  const b = { x: c.cx - c.hw + 4, y: c.cy + 18 };
  c.seg(a, { x: a.x, y: a.y - 16 }, 0x6a4a2c, 1.8);
  c.seg(b, { x: b.x, y: b.y - 16 }, 0x6a4a2c, 1.8);
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    c.seg({ x, y: y - 15 }, { x: x + Math.sin(c.t + i) * 0.6, y: y - 3 }, 0xd8c79a, 1, 0.6);
  }
  for (let j = 0; j < 4; j++) c.seg({ x: a.x, y: a.y - 14 + j * 3.2 }, { x: b.x, y: b.y - 14 + j * 3.2 }, 0xd8c79a, 1, 0.5);
  // a boat turned over, a fish barrel, a rod
  const bx = c.cx + c.hw + 6;
  const by = c.cy + 14;
  c.g.poly([bx - 12, by, bx - 8, by - 5, bx + 8, by - 5, bx + 12, by, bx + 8, by + 3, bx - 8, by + 3]).fill({ color: 0x8a5a32, alpha: c.a });
  c.seg({ x: bx - 8, y: by - 5 }, { x: bx + 8, y: by - 5 }, 0x5a3a20, 1.4);
  barrel(c, c.cx + c.hw - 4, c.cy + 12, 0x6f8a93);
  c.seg({ x: c.cx + c.hw + 2, y: c.cy + 2 }, { x: c.cx + c.hw + 17, y: c.cy - 15 }, 0x6b4a2b, 1.2);
  if (c.working) c.seg({ x: c.cx + c.hw + 17, y: c.cy - 15 }, { x: c.cx + c.hw + 19, y: c.cy - 4 + Math.sin(c.t * 3) * 2 }, 0xeeeeee, 0.8, 0.8);
  smoke(c, c.cx - 8, c.cy - c.h - 10, false);
}

function farm(c: Ctx): void {
  // fenced yard with hay, the barn behind and the house in front
  haystack(c, c.cx - c.hw - 4, c.cy + 12);
  fence(c, { x: c.cx - c.hw - 14, y: c.cy + 20 }, { x: c.cx + 2, y: c.cy + 28 }, 5);
  fence(c, { x: c.cx + 2, y: c.cy + 28 }, { x: c.cx + c.hw + 12, y: c.cy + 20 }, 4);
  crate(c, c.cx + c.hw + 4, c.cy + 12, 8);
  sack(c, c.cx + c.hw + 12, c.cy + 14, 0xdcc88a);
  walls(c, 0xd9cfae, { texture: 'plaster', footing: 0.12 });
  // timber framing on the plaster
  for (const side of ['l', 'r'] as const) {
    const at = side === 'l' ? c.left.bind(c) : c.right.bind(c);
    for (const u of [0.0, 0.5, 1.0]) c.seg(at(u, 0), at(u, 1), DARK_WOOD, 1.6, 0.8);
    c.seg(at(0, 0.5), at(1, 0.5), DARK_WOOD, 1.4, 0.7);
    c.seg(at(0, 0), at(0.5, 0.5), DARK_WOOD, 1.2, 0.6);
  }
  gable(c, TILE_RED, 17, { shingles: 7, gable: 0xcfc4a2, overhang: 4, flip: true });
  doorAt(c, 'l', 0.28, 0.2, 0.6, 0x4a3320);
  windowAt(c, 'l', 0.7, 0.58, 0.17, c.working);
  windowAt(c, 'r', 0.5, 0.6, 0.18, false);
  chimney(c, c.cx - 10, c.cy - c.h - 8, 11, 5, 0x9a6a50);
  smoke(c, c.cx - 10, c.cy - c.h - 19, c.working);
  // a wheat patch beside the yard
  for (let i = 0; i < 4; i++) {
    const wx = c.cx + c.hw + 4 + i * 3.4;
    c.seg({ x: wx, y: c.cy + 24 - i }, { x: wx, y: c.cy + 15 - i }, 0xe6c84f, 1.3);
    c.circle(wx, c.cy + 14.5 - i, 1.5, 0xf2dd7a);
  }
}

function well(c: Ctx): void {
  // a ring of stones, two posts and a little roof
  const cx = c.cx;
  const cy = c.cy + 4;
  c.ellipse(cx + 1, cy + 5, 13, 6, 0x000000, 0.25);
  c.g.poly([cx - 11, cy, cx - 11, cy - 9, cx, cy - 9 - 5.5, cx + 11, cy - 9, cx + 11, cy, cx, cy + 5.5]).fill({ color: scaleColor(STONE, 0.95), alpha: c.a });
  c.g.poly([cx, cy + 5.5, cx + 11, cy, cx + 11, cy - 9, cx, cy - 9 + 5.5]).fill({ color: scaleColor(STONE, 0.66), alpha: c.a });
  c.ellipse(cx, cy - 9, 11, 5.5, 0x4d4f52);
  c.ellipse(cx, cy - 8.5, 9, 4.2, 0x2f6fb0);
  c.ellipse(cx - 2, cy - 9.2, 3, 1.1, 0xb6dcff, 0.7);
  for (let i = 0; i < 5; i++) c.seg({ x: cx - 11 + i * 4.4, y: cy + 0.5 - (i % 2) * 2 }, { x: cx - 11 + i * 4.4, y: cy - 8 }, 0x000000, 1, 0.18);
  // posts, a beam with a crank, a rope and a bucket
  c.seg({ x: cx - 9, y: cy - 4 }, { x: cx - 9, y: cy - 30 }, DARK_WOOD, 2.4);
  c.seg({ x: cx + 9, y: cy - 4 }, { x: cx + 9, y: cy - 30 }, scaleColor(DARK_WOOD, 0.7), 2.4);
  c.seg({ x: cx - 9, y: cy - 24 }, { x: cx + 9, y: cy - 24 }, 0x7a5a38, 2.2);
  c.seg({ x: cx + 9, y: cy - 24 }, { x: cx + 15, y: cy - 21 }, 0x3a2a1a, 1.6);
  const bob = c.working ? Math.sin(c.t * 3) * 3 : 0;
  c.seg({ x: cx, y: cy - 24 }, { x: cx, y: cy - 15 + bob }, 0xd8c79a, 1);
  c.rect(cx - 3, cy - 15 + bob, 6, 5, 0x8a6035);
  c.rect(cx - 3, cy - 15 + bob, 6, 1, 0x3a3a3a, 0.8);
  // the roof
  c.fill([cx - 15, cy - 29, cx, cy - 32 + 5, cx, cy - 44, cx - 6, cy - 40], scaleColor(TILE_RED, 1.1));
  c.fill([cx, cy - 27, cx + 15, cy - 29, cx + 6, cy - 40, cx, cy - 44], scaleColor(TILE_RED, 0.78));
  c.line([cx - 15, cy - 29, cx, cy - 27, cx + 15, cy - 29], OUTLINE, 1, 0.5);
}

function mill(c: Ctx): void {
  // round-ish tower body with a cap, the sails turning on the front
  sack(c, c.cx - c.hw - 3, c.cy + 12);
  sack(c, c.cx - c.hw + 6, c.cy + 16, 0xf4efe4);
  sack(c, c.cx - c.hw + 11, c.cy + 11);
  walls(c, 0xd8d0bd, { texture: 'plaster', footing: 0.16 });
  hip(c, 0x7a5a3c, 20);
  doorAt(c, 'l', 0.32, 0.22, 0.58, 0x4a3320, true);
  windowAt(c, 'r', 0.5, 0.62, 0.18, c.working);
  windowAt(c, 'l', 0.74, 0.62, 0.14, false);
  // the sails on the front-left wall: hub, four lattice arms
  const hub = c.left(0.5, 0.7);
  const hx = hub.x - 2;
  const hy = hub.y - 6;
  const ang = c.working ? c.t * 1.1 : 0.5;
  for (let i = 0; i < 4; i++) {
    const a = ang + (i * Math.PI) / 2;
    const ex = hx + Math.cos(a) * 26;
    const ey = hy + Math.sin(a) * 26 * 0.9;
    c.seg({ x: hx, y: hy }, { x: ex, y: ey }, DARK_WOOD, 2);
    const px = Math.cos(a + Math.PI / 2) * 7;
    const py = Math.sin(a + Math.PI / 2) * 7 * 0.9;
    const sx = hx + Math.cos(a) * 9;
    const sy = hy + Math.sin(a) * 9 * 0.9;
    c.g.poly([sx, sy, ex, ey, ex + px, ey + py, sx + px, sy + py]).fill({ color: 0xf1ead2, alpha: 0.92 * c.a });
    c.seg({ x: sx, y: sy }, { x: ex + px, y: ey + py }, 0x8a7a58, 1, 0.5);
    c.seg({ x: sx + px, y: sy + py }, { x: ex, y: ey }, 0x8a7a58, 1, 0.5);
  }
  c.circle(hx, hy, 3.4, 0x3a2a1a);
  if (c.working) for (let i = 0; i < 4; i++) {
    const ph = (c.t * 0.9 + i * 0.25) % 1;
    c.circle(c.cx - c.hw + 8 + ph * 6, c.cy + 8 - ph * 14, 1.6 + ph * 2, 0xffffff, 0.45 * (1 - ph)); // flour dust at the door
  }
}

function baker(c: Ctx): void {
  walls(c, 0xd0a074, { texture: 'brick', footing: 0.12 });
  gable(c, 0x8e3f2c, 16, { shingles: 7, gable: 0xc29468, flip: true });
  doorAt(c, 'l', 0.3, 0.22, 0.58, 0x4a3320, true);
  windowAt(c, 'l', 0.7, 0.55, 0.18, c.working);
  windowAt(c, 'r', 0.5, 0.6, 0.18, c.working);
  // a big brick oven chimney
  chimney(c, c.cx + 12, c.cy - c.h - 4, 20, 8, 0x9a5a44);
  smoke(c, c.cx + 12, c.cy - c.h - 24, c.working, 0xf4f4f4, 1.2);
  // an awning over a stall with loaves
  const sx = c.cx - c.hw - 4;
  const sy = c.cy + 14;
  c.seg({ x: sx - 8, y: sy }, { x: sx - 8, y: sy - 15 }, DARK_WOOD, 1.6);
  c.seg({ x: sx + 8, y: sy + 2 }, { x: sx + 8, y: sy - 13 }, DARK_WOOD, 1.6);
  for (let i = 0; i < 4; i++) c.g.poly([sx - 10 + i * 5, sy - 15 + i * 0.5, sx - 5 + i * 5, sy - 15 + i * 0.5, sx - 5 + i * 5, sy - 9 + i * 0.5, sx - 10 + i * 5, sy - 9 + i * 0.5]).fill({ color: i % 2 ? 0xf2f2f2 : 0xc23a3a, alpha: c.a });
  c.rect(sx - 9, sy - 3, 18, 3.2, 0x8a6035);
  for (let i = 0; i < 4; i++) c.ellipse(sx - 6 + i * 4, sy - 4.5, 2.4, 1.5, i % 2 ? 0xc77d3a : 0xd9954a);
  // a hanging sign with a loaf
  c.seg({ x: c.left(0.62, 0.9).x, y: c.left(0.62, 0.9).y }, { x: c.left(0.62, 0.9).x, y: c.left(0.62, 0.9).y + 6 }, 0x3a2a1a, 1);
  c.ellipse(c.left(0.62, 0.9).x, c.left(0.62, 0.9).y + 9, 4.5, 3, 0xe0a24e);
}

const ORE_TINT = [0x000000, 0xb7bcc4, 0x2b2b2e, 0xc2602b, 0xf2c744];

function mineAt(c: Ctx, oreKind: number): void {
  const tint = ORE_TINT[oreKind] ?? 0xb7bcc4;
  // the hillside, a timber-framed entrance, rails to a cart and a spoil heap
  const cx = c.cx;
  const cy = c.cy;
  c.ellipse(cx + 2, cy + 8, c.w * 0.62, c.w * 0.26, 0x000000, 0.25);
  c.g.poly([cx - c.w * 0.6, cy + 4, cx - c.w * 0.45, cy - c.h * 0.7, cx - c.w * 0.1, cy - c.h * 1.15, cx + c.w * 0.25, cy - c.h * 1.05, cx + c.w * 0.55, cy - c.h * 0.5, cx + c.w * 0.62, cy + 4, cx, cy + 10]).fill({ color: 0x7d7468, alpha: c.a });
  c.g.poly([cx + c.w * 0.25, cy - c.h * 1.05, cx + c.w * 0.55, cy - c.h * 0.5, cx + c.w * 0.62, cy + 4, cx, cy + 10, cx + c.w * 0.1, cy - c.h * 0.4]).fill({ color: 0x5f574d, alpha: c.a });
  for (let i = 0; i < 7; i++) {
    const rx = cx - c.w * 0.4 + hash2(i, 1, c.seed) * c.w * 0.75;
    const ry = cy - c.h * 0.9 + hash2(i, 2, c.seed) * c.h * 0.8;
    c.g.poly([rx - 3, ry + 2, rx, ry - 2, rx + 4, ry + 1]).fill({ color: scaleColor(0x7d7468, 0.8 + 0.5 * hash2(i, 3, c.seed)), alpha: c.a });
  }
  // flecks of the ore showing in the rock
  for (let i = 0; i < 4; i++) c.circle(cx - c.w * 0.3 + hash2(i, 5, c.seed) * c.w * 0.5, cy - c.h * 0.5 + hash2(i, 6, c.seed) * c.h * 0.4, 1.3, tint, 0.9);
  // the entrance
  const ex = cx - 3;
  const ey = cy + 2;
  c.g.poly([ex - 10, ey + 4, ex - 10, ey - 10, ex - 6, ey - 15, ex + 6, ey - 15, ex + 10, ey - 10, ex + 10, ey + 4]).fill({ color: 0x120e0b, alpha: c.a });
  c.seg({ x: ex - 10, y: ey + 4 }, { x: ex - 10, y: ey - 11 }, DARK_WOOD, 3);
  c.seg({ x: ex + 10, y: ey + 4 }, { x: ex + 10, y: ey - 11 }, DARK_WOOD, 3);
  c.seg({ x: ex - 12, y: ey - 11 }, { x: ex + 12, y: ey - 11 }, WOOD, 3.4);
  c.seg({ x: ex - 12, y: ey - 15 }, { x: ex + 12, y: ey - 15 }, WOOD, 2.4);
  lantern(c, ex + 12, ey - 2);
  // rails out of the entrance to a cart, and the heap
  rails(c, { x: ex, y: ey + 3 }, { x: ex + 18, y: ey + 14 });
  cart(c, ex + 20, ey + 16, tint);
  stoneHeap(c, cx - c.w * 0.45, cy + 12, 4);
  // a sign plate in the kind of ore
  c.seg({ x: cx + c.w * 0.38, y: cy + 6 }, { x: cx + c.w * 0.38, y: cy - 10 }, 0x6b4a2b, 1.6);
  c.rect(cx + c.w * 0.38 - 5, cy - 16, 10, 7, tint);
  c.g.rect(cx + c.w * 0.38 - 5, cy - 16, 10, 7).stroke({ width: 1, color: OUTLINE, alpha: 0.7 * c.a });
  if (c.working) for (let i = 0; i < 3; i++) {
    const ph = (c.t * 1.2 + i / 3) % 1;
    c.circle(ex + (ph - 0.5) * 6, ey - 10 - ph * 10, 1.8 + ph * 2, 0xb9b0a2, 0.5 * (1 - ph)); // dust from the shaft
  }
}

function smelter(c: Ctx, metal: number): void {
  ingots(c, c.cx - c.hw - 7, c.cy + 12, metal);
  walls(c, 0x8a8e94, { texture: 'stone', footing: 0.0 });
  gable(c, 0x3d3f45, 11, { shingles: 4, gable: 0x777b82, flip: true });
  // tall brick chimney with smoke, a furnace mouth that glows when working
  chimney(c, c.cx + 6, c.cy - c.h - 3, 28, 9, 0x8a4a3a);
  smoke(c, c.cx + 6, c.cy - c.h - 31, c.working, 0x5a5a60, 1.4);
  const mouth = c.quad('l', 0.3, 0.7, 0, 0.46);
  c.fill(mouth, 0x14100d);
  if (c.working) {
    const flick = 0.75 + 0.25 * Math.sin(c.t * 13 + c.seed);
    c.fill(c.quad('l', 0.34, 0.66, 0, 0.36), lerpColor(0xff7a1a, 0xffd23f, flick));
    const p = c.left(0.5, 0.2);
    c.circle(p.x, p.y, 14, 0xff9a3a, 0.14 * flick);
  } else {
    c.fill(c.quad('l', 0.34, 0.66, 0, 0.3), 0x3a1a10);
  }
  c.line([...mouth, mouth[0]!, mouth[1]!], OUTLINE, 1.3, 0.8);
  windowAt(c, 'r', 0.5, 0.6, 0.16, c.working);
  // a mould on the ground with a pour of molten metal
  c.ellipse(c.cx + c.hw + 4, c.cy + 12, 6, 2.6, 0x3a3a3e);
  if (c.working) c.ellipse(c.cx + c.hw + 4, c.cy + 11.4, 3.6, 1.4, lerpColor(0xff7a1a, 0xffd23f, 0.5));
  else c.ellipse(c.cx + c.hw + 4, c.cy + 11.4, 3.6, 1.4, metal);
}

function pigFarm(c: Ctx): void {
  // a barn behind, a pen of pigs in front, a trough, a haystack
  haystack(c, c.cx + c.hw + 3, c.cy + 12);
  walls(c, 0xa5604a, { texture: 'boards', footing: 0.12 });
  gable(c, 0x6a4036, 17, { shingles: 7, gable: 0x8a5442, overhang: 4 });
  doorAt(c, 'l', 0.3, 0.3, 0.64, 0x4a2c20);
  windowAt(c, 'r', 0.5, 0.62, 0.16, false);
  // a hay-loft hatch under the gable
  const hatch = c.right(0.5, 0.86);
  c.rect(hatch.x - 3.5, hatch.y - 3, 7, 6, 0x2a1a12);
  // the pen: a mud patch and a fence round it
  const px = c.cx - c.hw + 4;
  const py = c.cy + 19;
  c.g.poly([px - 20, py, px, py - 10, px + 20, py, px, py + 10]).fill({ color: 0x6f5238, alpha: c.a });
  c.g.poly([px - 12, py + 1, px - 2, py - 4, px + 8, py + 1, px - 2, py + 6]).fill({ color: 0x5a422c, alpha: c.a * 0.8 });
  fence(c, { x: px - 22, y: py }, { x: px, y: py + 11 }, 5);
  fence(c, { x: px, y: py + 11 }, { x: px + 22, y: py }, 5);
  // the trough
  c.rect(px + 6, py - 2, 9, 3, 0x7a5a38);
  c.rect(px + 7, py - 3, 7, 1.4, c.working ? 0xd8c070 : 0x4d8aa8);
  // pigs trot about the pen (always a little, more when the farm is working)
  const t = c.t * (c.working ? 1.0 : 0.35);
  for (let i = 0; i < 3; i++) {
    const ph = t + i * 2.1 + c.seed;
    const x = px - 10 + i * 9 + Math.sin(ph * 0.9) * 4;
    const y = py + 2 + (i % 2) * 4 + Math.cos(ph * 0.7) * 1.6;
    pig(c, x, y, Math.cos(ph * 0.9) > 0 ? 1 : -1, c.working ? Math.sin(ph * 6) : Math.sin(ph * 2) * 0.3, 0.85 + 0.1 * i);
  }
  chimney(c, c.cx + 10, c.cy - c.h - 6, 9, 5, 0x8a5a48);
  smoke(c, c.cx + 10, c.cy - c.h - 15, false);
}

function butcher(c: Ctx): void {
  walls(c, 0xe0d2bc, { texture: 'plaster', footing: 0.14 });
  gable(c, 0xa23a32, 14, { shingles: 6, gable: 0xdccdb6, flip: true });
  // a striped awning over the shop front, with the counter beneath
  const a0 = c.left(0.06, 0.62);
  const a1 = c.left(0.94, 0.62);
  for (let i = 0; i < 6; i++) {
    const u0 = i / 6;
    const u1 = (i + 1) / 6;
    const p0 = { x: a0.x + (a1.x - a0.x) * u0, y: a0.y + (a1.y - a0.y) * u0 };
    const p1 = { x: a0.x + (a1.x - a0.x) * u1, y: a0.y + (a1.y - a0.y) * u1 };
    c.g.poly([p0.x, p0.y, p1.x, p1.y, p1.x - 3, p1.y + 6, p0.x - 3, p0.y + 6]).fill({ color: i % 2 ? 0xf2f2f2 : 0xc23a3a, alpha: c.a });
  }
  const counter = c.quad('l', 0.12, 0.88, 0, 0.3);
  c.fill(counter, 0x6a4a30);
  c.fill(c.quad('l', 0.12, 0.88, 0.3, 0.34), 0x9a7a52);
  doorAt(c, 'r', 0.35, 0.22, 0.58, 0x4a2c20);
  windowAt(c, 'r', 0.75, 0.58, 0.16, c.working);
  // sausages and a ham hung from the awning
  for (let i = 0; i < 4; i++) {
    const x = a0.x + (a1.x - a0.x) * (0.18 + i * 0.22) - 3;
    const y = a0.y + (a1.y - a0.y) * (0.18 + i * 0.22) + 6;
    c.seg({ x, y }, { x, y: y + 4 }, 0x3a2a1a, 0.9);
    c.ellipse(x, y + 8, 2, 4.2 + (i % 2), i % 2 ? 0xb3402f : 0xc4544a);
  }
  // a chopping block with a cleaver, and a sign
  const bx = c.cx + c.hw + 5;
  const by = c.cy + 10;
  c.ellipse(bx, by + 1, 7, 3, 0x000000, 0.25);
  c.rect(bx - 5, by - 7, 10, 8, 0x8a6035);
  c.ellipse(bx, by - 7, 5, 2.2, 0xd2a972);
  const chop = c.working ? Math.abs(Math.sin(c.t * 8)) : 0;
  c.seg({ x: bx + 1, y: by - 9 - chop * 6 }, { x: bx + 7, y: by - 12 - chop * 6 }, 0x6b4a2b, 1.6);
  c.g.poly([bx + 5, by - 14 - chop * 6, bx + 11, by - 12 - chop * 6, bx + 10, by - 8 - chop * 6, bx + 5, by - 9 - chop * 6]).fill({ color: 0xc4cbd2, alpha: c.a });
  c.seg({ x: c.cx - c.hw - 5, y: c.cy + 8 }, { x: c.cx - c.hw - 5, y: c.cy - 12 }, 0x6b4a2b, 1.6);
  c.rect(c.cx - c.hw - 11, c.cy - 16, 12, 8, 0xe0d2bc);
  c.ellipse(c.cx - c.hw - 5, c.cy - 12, 3.4, 2.4, 0xc4544a);
  chimney(c, c.cx + 8, c.cy - c.h - 7, 11, 5, 0x9a6a58);
  smoke(c, c.cx + 8, c.cy - c.h - 18, c.working);
}

function toolmaker(c: Ctx): void {
  anvil(c, c.cx - c.hw - 3, c.cy + 12);
  walls(c, 0x9a8264, { texture: 'boards', footing: 0.12 });
  gable(c, 0x5c6470, 14, { shingles: 6, gable: 0x8b7458 });
  doorAt(c, 'l', 0.3, 0.22, 0.58, 0x4a3320);
  windowAt(c, 'l', 0.7, 0.58, 0.16, c.working);
  // tools hung on the front-right wall: axe, saw, pick
  const a = c.right(0.3, 0.6);
  c.seg({ x: a.x, y: a.y + 7 }, { x: a.x, y: a.y - 6 }, 0x6b4a2b, 1.2);
  c.g.poly([a.x, a.y - 6, a.x + 5, a.y - 5, a.x + 4, a.y - 1]).fill({ color: 0xb7bcc4, alpha: c.a });
  const s = c.right(0.55, 0.55);
  c.g.poly([s.x - 5, s.y - 3, s.x + 5, s.y - 3, s.x + 5, s.y + 1, s.x - 5, s.y + 1]).fill({ color: 0xaab0b8, alpha: c.a });
  c.rect(s.x - 7, s.y - 4, 2.4, 6, 0x6b4a2b);
  const p = c.right(0.8, 0.6);
  c.seg({ x: p.x, y: p.y + 6 }, { x: p.x, y: p.y - 6 }, 0x6b4a2b, 1.2);
  c.seg({ x: p.x - 4, y: p.y - 6 }, { x: p.x + 4, y: p.y - 6 }, 0x9aa0a6, 1.8);
  chimney(c, c.cx - 8, c.cy - c.h - 6, 14, 6, 0x6a6a72);
  smoke(c, c.cx - 8, c.cy - c.h - 20, c.working, 0xd0d0d6);
  // a hammer that rises and falls on the anvil
  const hit = c.working ? Math.abs(Math.sin(c.t * 8)) : 0;
  const ax = c.cx - c.hw - 3;
  const ay = c.cy + 12;
  c.seg({ x: ax + 1, y: ay - 8 - hit * 7 }, { x: ax + 9, y: ay - 14 - hit * 7 }, 0x6b4a2b, 1.8);
  c.rect(ax - 1 + (hit > 0.2 ? 0 : 0), ay - 11 - hit * 7, 4, 3, 0x9aa0a6);
  if (c.working && hit < 0.12) c.circle(ax - 1, ay - 8, 3, 0xffe9a0, 0.7);
  barrel(c, c.cx + c.hw + 3, c.cy + 13, 0x4f5660);
}

// ---- construction ----------------------------------------------------------

/**
 * A site: first the foundation and the materials piled beside it, then a timber
 * frame rising, then the finished building under scaffolding.
 */
function site(c: Ctx, art: Art, finish: (c: Ctx) => void): void {
  const p = Math.max(0, Math.min(1, art.progress));
  const h = c.h;
  // foundation slab, always
  const slab = [c.cx - c.hw - 3, c.cy + 1, c.cx, c.cy - c.hd - 1, c.cx + c.hw + 3, c.cy + 1, c.cx, c.cy + c.hd + 3];
  c.fill(slab, 0x8b8678);
  c.line([...slab, slab[0]!, slab[1]!], OUTLINE, 1, 0.5);
  for (let i = 0; i < 5; i++) c.seg({ x: c.cx - c.hw + i * (c.w / 5), y: c.cy + 1 - i * 0.2 }, { x: c.cx - c.hw + i * (c.w / 5) + 2, y: c.cy + 3 }, 0x000000, 1, 0.15);
  // materials on the site
  const planks = Math.min(4, art.planks ?? 0);
  const stones = Math.min(4, art.stones ?? 0);
  if (planks > 0) plankStack(c, c.cx - c.hw - 7, c.cy + 11, planks + 1, 14);
  if (stones > 0) stoneHeap(c, c.cx + c.hw + 7, c.cy + 12, stones + 1);
  if (p > 0.82) {
    // nearly done: the building shows through, with the scaffold still up
    const old = c.a;
    finish(new Ctx(c.g, c.cx, c.cy, c.w, c.h, old * 0.7, c.t, false, c.seed));
  } else {
    const rise = Math.max(0.08, p / 0.82); // how tall the frame stands
    const fh = h * rise;
    // stakes at the corners, then posts and a wall of boards going up
    for (const [dx, dy] of [[-1, 0], [0, -0.5], [1, 0], [0, 0.5]] as const) {
      const x = c.cx + dx * c.hw;
      const y = c.cy + dy * c.hd * 2 * 0.5 + (dy > 0 ? c.hd * 0.5 : dy < 0 ? -c.hd * 0.5 : 0);
      c.seg({ x, y }, { x, y: y - fh }, WOOD, 2.2, 0.95);
    }
    if (rise > 0.3) {
      c.fill(c.quad('l', 0, 1, 0, 1, fh), scaleColor(WOOD, 0.9), 0.55);
      c.fill(c.quad('r', 0, 1, 0, 1, fh), scaleColor(WOOD, 0.62), 0.55);
      for (let i = 1; i < 6; i++) c.seg(c.left(i / 6, 0, fh), c.left(i / 6, 1, fh), 0x000000, 1, 0.18);
    }
    // cross braces and a top plate
    c.seg(c.left(0, 0, fh), c.left(1, 1, fh), DARK_WOOD, 1.4, 0.8);
    c.seg(c.left(1, 0, fh), c.left(0, 1, fh), DARK_WOOD, 1.4, 0.8);
    c.line([c.cx - c.hw, c.cy - fh, c.cx, c.cy - fh - c.hd, c.cx + c.hw, c.cy - fh, c.cx, c.cy - fh + c.hd, c.cx - c.hw, c.cy - fh], DARK_WOOD, 1.6, 0.9);
    if (rise > 0.7) {
      // rafters: the first of the roof
      const apex = { x: c.cx, y: c.cy - fh - c.hd - 9 };
      for (const [x, y] of [[c.cx - c.hw, c.cy - fh], [c.cx + c.hw, c.cy - fh], [c.cx, c.cy - fh + c.hd]] as const) c.seg({ x, y }, apex, WOOD, 1.6, 0.9);
    }
  }
  // scaffolding: a ladder and a platform at the front corner
  const lx = c.cx + c.hw + 4;
  c.seg({ x: lx, y: c.cy + 6 }, { x: lx - 4, y: c.cy - h * 0.85 }, 0xcaa56a, 1.6, 0.95);
  c.seg({ x: lx + 4, y: c.cy + 6 }, { x: lx, y: c.cy - h * 0.85 }, 0xcaa56a, 1.6, 0.95);
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    c.seg({ x: lx - 4 * t, y: c.cy + 6 - (h * 0.85 + 6) * t }, { x: lx + 4 - 4 * t, y: c.cy + 6 - (h * 0.85 + 6) * t }, 0xcaa56a, 1.2, 0.9);
  }
}

// ---- entry point -----------------------------------------------------------

const MINES = new Set<BuildingType>([BuildingType.StoneMine, BuildingType.CoalMine, BuildingType.IronMine, BuildingType.GoldMine]);

/** Draw one building (or the site of one) standing on the footprint centre (art.cx, art.cy). */
export function drawBuildingArt(g: Graphics, art: Art): void {
  const c = new Ctx(g, art.cx, art.cy, art.w, art.h, art.progress < 1 ? 0.92 : 1, art.time, art.working, art.seed);
  // the contact shadow, softer for a site
  g.ellipse(art.cx + 3, art.cy + 5, art.w * 0.66, art.w * 0.3).fill({ color: 0x000000, alpha: 0.24 * (art.progress < 1 ? 0.7 : 1) });
  const finished = (cc: Ctx): void => {
    switch (art.type) {
      case BuildingType.Lumberjack: return lumberjack(cc);
      case BuildingType.Forester: return forester(cc);
      case BuildingType.Sawmill: return sawmill(cc);
      case BuildingType.Stonecutter: return stonecutter(cc);
      case BuildingType.Storage: return storage(cc);
      case BuildingType.Castle: return castle(cc);
      case BuildingType.Fisher: return fisher(cc);
      case BuildingType.Farm: return farm(cc);
      case BuildingType.Well: return well(cc);
      case BuildingType.Mill: return mill(cc);
      case BuildingType.Baker: return baker(cc);
      case BuildingType.IronSmelter: return smelter(cc, 0xaab4c4);
      case BuildingType.GoldSmelter: return smelter(cc, 0xf2c744);
      case BuildingType.Toolmaker: return toolmaker(cc);
      case BuildingType.PigFarm: return pigFarm(cc);
      case BuildingType.Butcher: return butcher(cc);
      default:
        if (MINES.has(art.type)) return mineAt(cc, art.ore ?? 1);
        return walls(cc, 0x999999, { texture: 'boards' }, cc.h, true);
    }
  };
  if (art.progress < 1) site(c, art, finished);
  else finished(c);
}
