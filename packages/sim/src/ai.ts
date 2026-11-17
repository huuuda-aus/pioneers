// The computer opponent. It plays by the same rules as the player: it places
// buildings with the checked placeBuilding, joins them with roads from the
// same planner, and attacks with sendAttack. It keeps almost no state of its
// own (a countdown, a temperament, when it was last attacked): every decision
// is a function of the game and `hash01`, so a saved game replays exactly.

import { BuildingType, Res, garrisonCapacityOf, type AiPlayer, type Building, Temperament } from './types.ts';
import { hexDistance } from './terrain.ts';
import { checkBuilding, checkFlag } from './placement.ts';
import { planRoad } from './plan.ts';
import { MapObject, HARVEST_RADIUS } from './objects.ts';
import { buildNeeds, type Game } from './game.ts';

/** How a temperament plays: the time between its decisions, how many military buildings it wants, and when it attacks. */
interface Knobs {
  period: number;
  cap: number;
  attack: 'never' | 'provoked' | 'always';
}
export const KNOBS: Record<Temperament, Knobs> = {
  [Temperament.Peaceful]: { period: 450, cap: 4, attack: 'never' },
  [Temperament.Defensive]: { period: 300, cap: 8, attack: 'provoked' },
  [Temperament.Aggressive]: { period: 200, cap: 14, attack: 'always' },
};
/** A defensive AI hits back for this long after being attacked. */
const PROVOKED_TICKS = 20000;
/** Sites it will leave unfinished at once before waiting for builders. */
const MAX_SITES = 2;

/** What it wants before it thinks about soldiers, in order. */
const ECONOMY: [BuildingType, number][] = [
  [BuildingType.Lumberjack, 2],
  [BuildingType.Sawmill, 1],
  [BuildingType.Stonecutter, 1],
  [BuildingType.Forester, 1],
];

const isMilitaryType = (t: BuildingType): boolean => garrisonCapacityOf(t) >= 0;

export const aiPeriod = (ai: AiPlayer): number => KNOBS[ai.temperament].period;

/** One decision: the first thing that can be done is done. */
export function aiStep(g: Game, ai: AiPlayer): void {
  const castle = g.castleOf(ai.owner);
  if (castle < 0) return;
  const own = g.buildings.filter((b) => !b.removed && b.burning === 0 && b.owner === ai.owner);
  const count = (t: BuildingType): number => own.filter((b) => b.type === t).length;
  const sites = own.filter((b) => b.constructing).length;

  if (sites < MAX_SITES) {
    for (const [type, want] of ECONOMY) {
      if (count(type) < want && affordable(g, castle, type) && build(g, ai, type)) return;
    }
    const military = own.filter((b) => isMilitaryType(b.type));
    const building = military.filter((b) => b.constructing).length;
    if (building === 0 && military.length < KNOBS[ai.temperament].cap && count(BuildingType.Sawmill) > 0) {
      const tower = military.length >= 3 && affordable(g, castle, BuildingType.Tower);
      const type = tower ? BuildingType.Tower : BuildingType.Hut;
      const stock = g.buildings[castle]!.stock;
      if (stock[Res.Sword]! > 0 && stock[Res.Shield]! > 0 && affordable(g, castle, type) && build(g, ai, type)) return;
    }
  }
  attack(g, ai);
}

/** Can the castle pay for it right now? (The AI does not queue sites it cannot supply.) */
function affordable(g: Game, castle: number, type: BuildingType): boolean {
  const need = buildNeeds(type);
  const stock = g.buildings[castle]!.stock;
  return need.every((n, r) => n <= stock[r]!);
}

// ---- building ---------------------------------------------------------

function build(g: Game, ai: AiPlayer, type: BuildingType): boolean {
  const pos = findSite(g, ai, type);
  if (pos < 0) return false;
  let index: number;
  try {
    index = g.placeBuilding(type, pos, true, ai.owner);
  } catch {
    return false;
  }
  if (connect(g, ai.owner, g.buildings[index]!.flag)) return true;
  g.demolishBuilding(index); // no road to it: do not leave an orphan site
  return false;
}

/** The nearest enemy castle, or -1. */
function enemyCastle(g: Game, owner: number): number {
  const mine = g.buildings[g.castleOf(owner)]!;
  let best = -1;
  let bestD = Infinity;
  for (const b of g.buildings) {
    if (b.removed || b.type !== BuildingType.Castle || b.owner === owner) continue;
    const d = dist(g, b.pos, mine.pos);
    if (d < bestD) {
      best = b.index;
      bestD = d;
    }
  }
  return best;
}

const dist = (g: Game, a: number, b: number): number => hexDistance((a % g.cols) - (b % g.cols), Math.floor(a / g.cols) - Math.floor(b / g.cols));

function treesNear(g: Game, pos: number, kind: MapObject): number {
  if (!g.objects) return 0;
  const x0 = pos % g.cols;
  const y0 = Math.floor(pos / g.cols);
  let n = 0;
  for (let dy = -HARVEST_RADIUS; dy <= HARVEST_RADIUS; dy++) {
    for (let dx = -HARVEST_RADIUS; dx <= HARVEST_RADIUS; dx++) {
      if (hexDistance(dx, dy) > HARVEST_RADIUS || !g.inside(x0 + dx, y0 + dy)) continue;
      if (g.objects.kindAt(g.index(x0 + dx, y0 + dy)) === kind) n++;
    }
  }
  return n;
}

/** Where to put a building: own land only, scored, best that placement accepts. */
function findSite(g: Game, ai: AiPlayer, type: BuildingType): number {
  const castle = g.buildings[g.castleOf(ai.owner)]!;
  const military = isMilitaryType(type);
  const enemy = military ? enemyCastle(g, ai.owner) : -1;
  const target = enemy >= 0 && ai.temperament !== Temperament.Peaceful ? g.buildings[enemy]!.pos : -1;
  const ownMilitary = g.buildings.filter((b) => !b.removed && b.owner === ai.owner && isMilitaryType(b.type));

  const cands: { p: number; score: number }[] = [];
  for (let p = 0; p < g.ownerAt.length; p++) {
    if (g.ownerAt[p] !== ai.owner) continue;
    const d0 = dist(g, p, castle.pos);
    if (d0 < 3) continue;
    let score: number;
    if (military) {
      if (ownMilitary.some((m) => dist(g, p, m.pos) < 4)) continue;
      score = target >= 0 ? dist(g, p, target) : -d0;
    } else {
      score = d0;
    }
    cands.push({ p, score });
  }
  cands.sort((a, b) => a.score - b.score || a.p - b.p);

  let best = -1;
  let bestScore = Infinity;
  let tried = 0;
  for (const c of cands) {
    if (tried++ > 400) break;
    if (!checkBuilding(g, type, c.p, ai.owner).ok) continue;
    if (military) return c.p;
    // wood and stone only where there is some to work: the best of the first few that fit
    const kind = type === BuildingType.Lumberjack ? MapObject.Tree : type === BuildingType.Stonecutter ? MapObject.Stone : MapObject.None;
    const rich = kind === MapObject.None ? 0 : treesNear(g, c.p, kind);
    if (kind !== MapObject.None && g.objects && rich < 6) continue;
    const s = c.score - rich * 0.5;
    if (s < bestScore) {
      best = c.p;
      bestScore = s;
    }
    if (best >= 0 && tried > 60) break;
  }
  return best;
}

/** Join a new door flag to the nearest flag of its own that a road can reach, with a flag every other tile. */
function connect(g: Game, owner: number, flag: number): boolean {
  const here = g.flags[flag]!.pos;
  const near = g.flags
    .filter((f) => !f.removed && f.owner === owner && f.index !== flag)
    .sort((a, b) => dist(g, a.pos, here) - dist(g, b.pos, here) || a.index - b.index)
    .slice(0, 4);
  for (const f of near) {
    const path = planRoad(g, flag, f.pos);
    if (!path) continue;
    g.addRoad(flag, path);
    let p = here;
    path.forEach((d, i) => {
      p = g.move(p, d);
      if (i % 2 === 1 && i < path.length - 2 && checkFlag(g, p, owner).ok) g.addFlag(p % g.cols, Math.floor(p / g.cols), owner);
    });
    return true;
  }
  return false;
}

// ---- fighting ---------------------------------------------------------

function attack(g: Game, ai: AiPlayer): void {
  const mode = KNOBS[ai.temperament].attack;
  if (mode === 'never') return;
  if (mode === 'provoked' && (ai.provoked < 0 || ((g.tick - ai.provoked) & 0xffff) > PROVOKED_TICKS)) return;
  let best: Building | null = null;
  for (const t of g.buildings) {
    if (t.removed || t.owner === ai.owner || garrisonCapacityOf(t.type) < 0) continue;
    if (!g.checkAttack(ai.owner, t.index).ok) continue;
    if (!best || t.garrison < best.garrison) best = t;
  }
  if (!best) return;
  const avail = g.availableKnights(ai.owner, best.index);
  if (avail < best.garrison + 1) return;
  g.sendAttack(ai.owner, best.index, best.garrison + 2);
}
