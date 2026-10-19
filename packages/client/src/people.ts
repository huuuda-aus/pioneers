// The little people: one small figure drawn from vector shapes, posed by a pure
// function (so it can be tested without a canvas) and dressed by trade.
//
// A figure stands with its feet at (0, 0), about 22 px tall, y up is negative.
// `pose` gives the joints; `drawPerson` paints them. Facing is +1 (right) or -1.

import type { Graphics } from 'pixi.js';
import { BuildingType } from '@sett/sim';

export type Trade =
  | 'carrier'
  | 'builder'
  | 'lumberjack'
  | 'stonecutter'
  | 'forester'
  | 'fisher'
  | 'farmer'
  | 'miller'
  | 'baker'
  | 'sawyer'
  | 'miner'
  | 'smelter'
  | 'smith'
  | 'geologist'
  | 'waterman';

export type Action = 'walk' | 'idle' | 'work';

export interface Pt2 {
  x: number;
  y: number;
}

export interface Joints {
  head: Pt2;
  neck: Pt2;
  hip: Pt2;
  handBack: Pt2; // the free hand
  handFront: Pt2; // the hand holding the tool
  footBack: Pt2;
  footFront: Pt2;
  /** Direction the tool points, radians, 0 = forward along the facing, positive = down. */
  toolAngle: number;
}

const LEG = 9;
const TORSO = 8;

/** Trade of the person who works in a building. */
export function tradeOf(type: BuildingType): Trade | null {
  switch (type) {
    case BuildingType.Lumberjack: return 'lumberjack';
    case BuildingType.Stonecutter: return 'stonecutter';
    case BuildingType.Forester: return 'forester';
    case BuildingType.Fisher: return 'fisher';
    case BuildingType.Farm: return 'farmer';
    case BuildingType.Mill: return 'miller';
    case BuildingType.Baker: return 'baker';
    case BuildingType.Sawmill: return 'sawyer';
    case BuildingType.StoneMine:
    case BuildingType.CoalMine:
    case BuildingType.IronMine:
    case BuildingType.GoldMine: return 'miner';
    case BuildingType.IronSmelter:
    case BuildingType.GoldSmelter: return 'smelter';
    case BuildingType.Toolmaker: return 'smith';
    case BuildingType.Well: return 'waterman';
    default: return null; // stores have no worker
  }
}

/**
 * Where every joint is. `phase` is the progress of the cycle in radians: for
 * walking, one full turn per stride pair (tie it to distance walked so feet
 * do not slide); for work, one swing per turn.
 */
export function pose(action: Action, phase: number, facing: 1 | -1, trade: Trade = 'carrier'): Joints {
  const f = facing;
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  let bob = 0;
  let lean = 0;
  let footBack: Pt2;
  let footFront: Pt2;
  let handBack: Pt2;
  let handFront: Pt2;
  let toolAngle = 1.2; // carried loosely at the side

  if (action === 'walk') {
    bob = -Math.abs(s) * 1.4;
    lean = 0.8;
    footFront = { x: f * s * 4.5, y: -Math.max(0, c) * 1.5 };
    footBack = { x: -f * s * 4.5, y: -Math.max(0, -c) * 1.5 };
    handBack = { x: f * (lean + s * 3), y: -TORSO - LEG + 5 + bob };
    handFront = { x: f * (lean + 3 - s * 3), y: -TORSO - LEG + 5 + bob };
  } else if (action === 'work') {
    // raise the tool behind the head, bring it down, rest, repeat
    const t = (s + 1) / 2;
    const strike = t * t; // quick at the bottom
    bob = -(1 - strike) * 1.2;
    lean = 1 + strike * 2.5;
    footFront = { x: f * 3, y: 0 };
    footBack = { x: -f * 3, y: 0 };
    handFront = { x: f * (lean + 2 + strike * 5), y: -TORSO - LEG - 4 + strike * 9 + bob };
    handBack = { x: f * (lean + 1 + strike * 4), y: handFront.y + 2 };
    toolAngle = -2.4 + strike * 3;
    if (trade === 'builder' || trade === 'geologist') toolAngle = -1.6 + strike * 2.2;
    if (trade === 'forester' || trade === 'farmer') toolAngle = 1.6 + strike * 0.6; // works low
    if (trade === 'forester' || trade === 'farmer') {
      handFront = { x: f * (lean + 4), y: -TORSO - LEG + 7 + strike * 3 + bob };
      handBack = { x: f * (lean + 2), y: handFront.y };
    }
  } else {
    bob = Math.sin(phase * 0.5) * 0.5; // breathing
    footFront = { x: f * 2, y: 0 };
    footBack = { x: -f * 2, y: 0 };
    handBack = { x: -f * 2.5, y: -TORSO - LEG + 5 + bob };
    handFront = { x: f * 3, y: -TORSO - LEG + 5 + bob };
  }
  const hip = { x: f * lean * 0.3, y: -LEG + bob };
  const neck = { x: f * lean, y: -LEG - TORSO + bob };
  const head = { x: f * (lean + 0.6), y: -LEG - TORSO - 4 + bob };
  return { head, neck, hip, handBack, handFront, footBack, footFront, toolAngle };
}

interface Look {
  tunic: number;
  hat: number;
  hatKind: 'cap' | 'hard' | 'straw' | 'tall' | 'band';
}

const LOOK: Record<Trade, Look> = {
  carrier: { tunic: 0xd9a441, hat: 0x7a4e2a, hatKind: 'cap' },
  builder: { tunic: 0xd9534f, hat: 0xffd23f, hatKind: 'hard' },
  lumberjack: { tunic: 0xb23a3a, hat: 0x3a3a3a, hatKind: 'cap' },
  stonecutter: { tunic: 0x7d8794, hat: 0xbfc5cc, hatKind: 'cap' },
  forester: { tunic: 0x3f8a46, hat: 0x2c5a30, hatKind: 'cap' },
  fisher: { tunic: 0x3d78b8, hat: 0xf0e0a0, hatKind: 'straw' },
  farmer: { tunic: 0x8a6a3c, hat: 0xe0c060, hatKind: 'straw' },
  miller: { tunic: 0xe8e2d0, hat: 0xffffff, hatKind: 'cap' },
  baker: { tunic: 0xf2f2f2, hat: 0xffffff, hatKind: 'tall' },
  sawyer: { tunic: 0x9a6a3a, hat: 0xffd23f, hatKind: 'band' },
  miner: { tunic: 0x555555, hat: 0xffd23f, hatKind: 'hard' },
  smelter: { tunic: 0x8a3a24, hat: 0x2a2a2a, hatKind: 'band' },
  smith: { tunic: 0x5a4636, hat: 0x2a2a2a, hatKind: 'cap' },
  geologist: { tunic: 0x8a7d4e, hat: 0x6a4e2a, hatKind: 'straw' },
  waterman: { tunic: 0x3aa6c8, hat: 0x2a6a88, hatKind: 'cap' },
};

const SKIN = 0xffd9a8;
const LINE = 0x222222;

function line(g: Graphics, a: Pt2, b: Pt2, width: number, color: number): void {
  g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width, color, cap: 'round' });
}

/** Tool in the front hand, by trade; a carrier carries none. */
function drawTool(g: Graphics, trade: Trade, hand: Pt2, angle: number, f: number): void {
  const dx = Math.cos(angle) * f;
  const dy = Math.sin(angle);
  const at = (len: number): Pt2 => ({ x: hand.x + dx * len, y: hand.y + dy * len });
  switch (trade) {
    case 'lumberjack': {
      const tip = at(9);
      line(g, hand, tip, 1.6, 0x6b4a2b);
      const a = at(7);
      line(g, a, { x: a.x - dy * 3 * f, y: a.y + dx * 3 * f }, 3, 0xaab0b8); // axe head
      break;
    }
    case 'stonecutter':
    case 'builder':
    case 'geologist':
    case 'smith':
    case 'miner': {
      const tip = at(8);
      line(g, hand, tip, 1.6, 0x6b4a2b);
      line(g, { x: tip.x - dy * 2.5 * f, y: tip.y + dx * 2.5 * f }, { x: tip.x + dy * 2.5 * f, y: tip.y - dx * 2.5 * f }, 3, 0x8a8f96); // hammer / pick head
      break;
    }
    case 'forester': {
      const tip = at(6);
      line(g, hand, tip, 1.4, 0x6b4a2b);
      g.circle(tip.x, tip.y, 1.6).fill({ color: 0x4f9a43 }); // a sapling
      break;
    }
    case 'fisher': {
      const tip = at(12);
      line(g, hand, tip, 1, 0x6b4a2b);
      break;
    }
    case 'farmer': {
      const tip = at(10);
      line(g, hand, tip, 1.3, 0x6b4a2b);
      line(g, { x: tip.x - dy * 3 * f, y: tip.y + dx * 3 * f }, { x: tip.x + dy * 3 * f, y: tip.y - dx * 3 * f }, 1.3, 0x6b4a2b); // rake
      break;
    }
    case 'waterman': {
      g.rect(hand.x - 2, hand.y, 4, 4).fill({ color: 0x8a6a3c }).stroke({ width: 1, color: LINE }); // bucket
      break;
    }
    default:
      break; // carrier, miller, baker, sawyer: empty hands
  }
}

export interface PersonOptions {
  action: Action;
  phase: number;
  facing: 1 | -1;
  trade: Trade;
  /** Colour of a load held in front, or null. */
  load?: number | null;
  /** 1 = the standard 22 px figure. */
  scale?: number;
  alpha?: number;
}

/** Paint one person with his feet at (x, y). */
export function drawPerson(g: Graphics, x: number, y: number, o: PersonOptions): void {
  const k = o.scale ?? 1;
  const j = pose(o.action, o.phase, o.facing, o.trade);
  const look = LOOK[o.trade];
  const f = o.facing;
  const P = (p: Pt2): Pt2 => ({ x: x + p.x * k, y: y + p.y * k });
  const hip = P(j.hip);
  const neck = P(j.neck);
  const head = P(j.head);
  const fb = P(j.footBack);
  const ff = P(j.footFront);
  const hb = P(j.handBack);
  const hf = P(j.handFront);
  const a = o.alpha ?? 1;

  g.ellipse(x, y + 1, 7 * k, 3 * k).fill({ color: 0x000000, alpha: 0.28 * a });
  // back leg and arm first, so the body overlaps them
  line(g, hip, fb, 2.4 * k, 0x4a3a2a);
  line(g, neck, hb, 2 * k, SKIN);
  // torso
  g.poly([hip.x - 3.2 * k, hip.y, hip.x + 3.2 * k, hip.y, neck.x + 3 * k, neck.y, neck.x - 3 * k, neck.y])
    .fill({ color: look.tunic, alpha: a })
    .stroke({ width: 1, color: LINE, alpha: 0.7 * a });
  line(g, hip, ff, 2.4 * k, 0x5a4a38);
  // head and hat
  g.circle(head.x, head.y, 3.6 * k).fill({ color: SKIN, alpha: a }).stroke({ width: 1, color: LINE, alpha: 0.7 * a });
  g.circle(head.x + f * 1.3 * k, head.y - 0.4 * k, 0.55 * k).fill({ color: LINE }); // eye
  const hy = head.y - 2.2 * k;
  switch (look.hatKind) {
    case 'hard':
      g.ellipse(head.x, hy, 4.2 * k, 2.4 * k).fill({ color: look.hat }).stroke({ width: 1, color: LINE, alpha: 0.7 });
      break;
    case 'straw':
      g.ellipse(head.x, hy + 0.8 * k, 6 * k, 1.6 * k).fill({ color: look.hat }).stroke({ width: 1, color: LINE, alpha: 0.6 });
      g.ellipse(head.x, hy - 0.6 * k, 3 * k, 1.8 * k).fill({ color: look.hat });
      break;
    case 'tall':
      g.rect(head.x - 2.6 * k, hy - 4.5 * k, 5.2 * k, 5.5 * k).fill({ color: look.hat }).stroke({ width: 1, color: LINE, alpha: 0.5 });
      break;
    case 'band':
      g.rect(head.x - 3.6 * k, hy - 0.4 * k, 7.2 * k, 1.6 * k).fill({ color: look.hat });
      break;
    default:
      g.ellipse(head.x - f * 0.3 * k, hy, 3.9 * k, 2.1 * k).fill({ color: look.hat }).stroke({ width: 1, color: LINE, alpha: 0.7 });
  }
  // front arm, tool, load
  line(g, neck, hf, 2 * k, SKIN);
  drawTool(g, o.trade, hf, j.toolAngle, f);
  if (o.load !== undefined && o.load !== null) {
    g.rect(hf.x - 3 * k + f * 2 * k, hf.y - 4 * k, 6 * k, 6 * k).fill({ color: o.load }).stroke({ width: 1, color: 0x000000 });
  }
}
