// The computer opponent. It plays by the same rules as the player: it places
// buildings with the checked placeBuilding, joins them with roads from the
// same planner, and attacks with sendAttack. It keeps almost no state of its
// own (a countdown, a temperament, when it was last attacked): every decision
// is a function of the game and `hash01`, so a saved game replays exactly.

import { BState, BuildingType, Res, garrisonCapacityOf, toolFor, type AiPlayer, type Building, Temperament, TOOL_KINDS } from './types.ts';
import { hexDistance } from './terrain.ts';
import { checkBuilding, checkFlag } from './placement.ts';
import { planRoad } from './plan.ts';
import { MapObject, HARVEST_RADIUS, OreKind, oreKindOf } from './objects.ts';
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
/** More military buildings it will put up when it needs to reach ore. */
const SEEK_EXTRA = 6;
/** Sites it will leave unfinished at once before waiting for builders. */
const MAX_SITES = 2;
/** Carriers the castle keeps back from expansion: every road needs one, and a mine's road left without is a mine never built. */
const CARRIER_RESERVE = 12;
/** Below this many spare carriers it merges roads to free some. */
const CARRIER_LOW = 8;
/** It puts up a storage (20 more carriers) when the castle has fewer than this many left, up to MAX_STORAGES. */
const STORAGE_BELOW = 14;
const MAX_STORAGES = 2;
/** Two roads are merged only if together they stay this short: a very long road is a bottleneck for everything behind it. */
const MERGE_MAX = 10;
/** Spots it will try for one building before giving up for the step. */
const BUILD_ATTEMPTS = 5;

/** What it wants before it thinks about soldiers, in order. */
const ECONOMY: [BuildingType, number][] = [
  [BuildingType.Lumberjack, 2],
  [BuildingType.Sawmill, 1],
  [BuildingType.Stonecutter, 1],
  [BuildingType.Forester, 1],
];

/**
 * A producer is pulled down when the castle already holds this much of what it makes, and not put up again
 * until the stock falls to half of it: a store that fills (castle capacity is 150) leaves its goods stuck on
 * the flags, which then block everything else, so the AI must not run its producers into a glut.
 */
const GLUT: Partial<Record<BuildingType, [Res, number]>> = {
  [BuildingType.Lumberjack]: [Res.Lumber, 100],
  [BuildingType.Sawmill]: [Res.Plank, 100],
  [BuildingType.Stonecutter]: [Res.Stone, 100],
  [BuildingType.Fisher]: [Res.Fish, 100],
  [BuildingType.Well]: [Res.Water, 60],
  [BuildingType.Farm]: [Res.Wheat, 60],
  [BuildingType.Mill]: [Res.Flour, 60],
  [BuildingType.CoalMine]: [Res.Coal, 100],
  [BuildingType.IronMine]: [Res.IronOre, 60],
  [BuildingType.GoldMine]: [Res.GoldOre, 30],
  [BuildingType.GoldSmelter]: [Res.Gold, 20],
  [BuildingType.IronSmelter]: [Res.Iron, 80],
  [BuildingType.Weaponsmith]: [Res.Sword, 100],
};

/** Every kind of tool at least this many in the castle: a toolmaker is pulled down. */
const TOOLS_ENOUGH = 3;
/** Fewer than this of some tool: a toolmaker is wanted. */
const TOOLS_WANTED = 2;
const toolsStocked = (stock: ArrayLike<number>, n: number): boolean => TOOL_KINDS.every((r) => stock[r]! >= n);

const isMilitaryType = (t: BuildingType): boolean => t !== BuildingType.Castle && garrisonCapacityOf(t) >= 0;

export const aiPeriod = (ai: AiPlayer): number => KNOBS[ai.temperament].period;

/** Everything it still wants to build before soldiers, in order: wood and stone, food, mines, then the metal and weapons chain. */
function wanted(g: Game, ai: AiPlayer, count: (t: BuildingType) => number, working: (t: BuildingType) => number): BuildingType[] {
  const T = BuildingType;
  const out: BuildingType[] = [];
  const stock = g.buildings[g.castleOf(ai.owner)]!.stock;
  for (const [type, want] of ECONOMY) for (let i = count(type); i < want; i++) out.push(type);
  // a storage brings 20 more carriers: put up another before the castle's 40 run out, as a growing colony must
  if (g.buildings[g.castleOf(ai.owner)]!.carriers < STORAGE_BELOW && count(T.Storage) < MAX_STORAGES) out.push(T.Storage);
  // food the mines will eat: fish if there is water to be had, else the bread chain
  // (the bread chain is kept whole: a baker with no well beside it feeds nobody)
  if (count(T.Fisher) === 0) {
    if (count(T.Farm) === 0 && count(T.Baker) === 0) out.push(T.Fisher);
    for (const t of [T.Farm, T.Mill, T.Well, T.Baker]) if (count(t) === 0) out.push(t);
  }
  const fights = ai.temperament !== Temperament.Peaceful;
  // each link only once what feeds it stands: no smelter before its mine
  // coal feeds the smelters and the weaponsmith: one mine is not enough once all of them run
  const chain: BuildingType[] = [T.CoalMine, T.IronMine];
  if (count(T.Weaponsmith) > 0 && working(T.CoalMine) < 2) out.push(T.CoalMine);
  if (count(T.IronMine) > 0) chain.push(T.IronSmelter);
  if (count(T.IronSmelter) > 0) {
    if (g.tools && !toolsStocked(stock, TOOLS_WANTED)) chain.push(T.Toolmaker);
    chain.push(T.Weaponsmith);
  }
  // gold (morale, promotion) only once iron is really going into weapons, so it does not starve them of coal
  if (fights && g.consumed[Res.Iron]! >= 6) {
    chain.push(T.GoldMine);
    if (count(T.GoldMine) > 0) chain.push(T.GoldSmelter);
  }
  // a mine that has dug out its ore is replaced where there is more
  for (const t of chain) if ((oreKindOf(t) !== OreKind.None ? working(t) : count(t)) === 0) out.push(t);
  // nothing that would add to a pile it already has
  return out.filter((t) => {
    const glut = GLUT[t];
    return !glut || stock[glut[0]]! < glut[1] / 2;
  });
}

/** One decision: the first thing that can be done is done. */
export function aiStep(g: Game, ai: AiPlayer): void {
  const castle = g.castleOf(ai.owner);
  if (castle < 0 || g.defeated.includes(ai.owner)) return;
  const own = g.buildings.filter((b) => !b.removed && b.burning === 0 && b.owner === ai.owner);
  const count = (t: BuildingType): number => own.filter((b) => b.type === t).length;
  const sites = own.filter((b) => b.constructing).length;
  const working = (t: BuildingType): number => own.filter((b) => b.type === t && (b.constructing || b.state !== BState.NoResource)).length;

  // a producer whose goods are piling up in the castle is pulled down before they clog the roads
  const castleStock = g.buildings[castle]!.stock;
  for (const b of own) {
    const glut = GLUT[b.type];
    if (glut && !b.constructing && castleStock[glut[0]]! >= glut[1]) {
      g.demolishBuilding(b.index);
      return;
    }
  }

  // a toolmaker turns iron into tools without limit: once every kind is in stock it is pulled down, or it eats the iron the weapons need
  const toolmaker = own.find((b) => b.type === BuildingType.Toolmaker && !b.constructing);
  if (toolmaker && toolsStocked(castleStock, TOOLS_ENOUGH)) {
    g.demolishBuilding(toolmaker.index);
    return;
  }

  // a mine that has dug out its ore is pulled down: it hands its pick back, and the next one goes where ore is left
  const spent = own.find((b) => !b.constructing && oreKindOf(b.type) !== OreKind.None && b.state === BState.NoResource);
  if (spent) {
    g.demolishBuilding(spent.index);
    return;
  }

  // a road left leading nowhere (the building at its end was pulled down) is taken up: it holds a carrier, and
  // the castle has only so many, so a long game's dead ends would leave the roads that matter without one
  for (const f of g.flags) {
    if (f.removed || f.owner !== ai.owner || f.building >= 0) continue;
    const live = f.road.filter((ri) => ri >= 0 && !g.roads[ri]!.removed);
    if (live.length === 0) {
      if (g.checkDemolishFlag(f.index).ok) g.demolishFlag(f.index); // left standing by a site given up
      continue;
    }
    if (live.length !== 1) continue;
    g.demolishRoad(live[0]!);
    if (g.checkDemolishFlag(f.index).ok) g.demolishFlag(f.index);
    return;
  }

  // carriers running short: a bare waypoint flag is taken out, so its two roads become one and need one carrier, not two
  if (g.buildings[castle]!.carriers < CARRIER_LOW) {
    const waypoint = g.flags.find((f) => !f.removed && f.owner === ai.owner && g.checkDemolishFlag(f.index).ok && f.road.reduce((n, ri) => n + (ri >= 0 ? g.roads[ri]!.length : 0), 0) <= MERGE_MAX);
    if (waypoint) {
      g.demolishFlag(waypoint.index);
      return;
    }
  }

  // roads cut off from its castle (one half of a network that land changing hands split) are taken up: a road that
  // can never get a carrier stops the whole game's hiring for the step, so they must not be left standing
  const reach = reachableFlags(g, g.buildings[castle]!.flag);
  const orphans = g.roads.filter((r) => !r.removed && r.owner === ai.owner && !reach.has(r.flag[0]));
  if (orphans.length > 0) {
    for (const r of orphans) g.demolishRoad(r.index);
    return;
  }

  // a site cut off from its castle (a road lost when land changed hands) is joined again, or given up so it stops holding a slot
  for (const b of own) {
    if (!b.constructing || b.pos < 0) continue;
    if (g.walkRoute(g.buildings[castle]!.flag, b.flag)) continue;
    if (!connect(g, ai.owner, b.flag)) g.demolishBuilding(b.index);
    return;
  }

  if (sites < MAX_SITES) {
    // where the ore it needs lies, when none of it is on its own land: its soldiers head there
    let seek = -1;
    const home = g.buildings[castle]!.pos;
    const mines: [BuildingType, OreKind][] = [[BuildingType.CoalMine, OreKind.Coal], [BuildingType.IronMine, OreKind.Iron]];
    if (ai.temperament !== Temperament.Peaceful) mines.push([BuildingType.GoldMine, OreKind.Gold]);
    for (const [mine, kind] of mines) {
      if (seek >= 0 || working(mine) > 0 || findSite(g, ai, mine) >= 0) continue; // already has, or can place one now
      seek = nearestOreSpot(g, kind, home);
    }
    const tried = new Set<BuildingType>();
    for (const type of wanted(g, ai, count, working)) {
      if (tried.has(type)) continue;
      tried.add(type);
      const kind = oreKindOf(type);
      const spot = kind === OreKind.None ? -1 : nearestOreSpot(g, kind, home);
      if (kind !== OreKind.None && spot < 0) continue; // none of it on the map: no use for the mine
      if (!affordable(g, ai.owner, castle, type)) continue;
      if (build(g, ai, type)) return;
    }
    const military = own.filter((b) => isMilitaryType(b.type));
    const building = military.filter((b) => b.constructing).length;
    if (building === 0 && g.buildings[castle]!.carriers >= CARRIER_RESERVE && military.length < KNOBS[ai.temperament].cap + (seek >= 0 ? SEEK_EXTRA : 0)) {
      // towers soak up six swords each: not while it is short of them on the way to ore
      const tower = seek < 0 && military.length >= 3 && affordable(g, ai.owner, castle, BuildingType.Tower);
      const type = tower ? BuildingType.Tower : BuildingType.Hut;
      const stock = g.buildings[castle]!.stock;
      if (stock[Res.Sword]! > 0 && stock[Res.Shield]! > 0 && affordable(g, ai.owner, castle, type) && build(g, ai, type, seek)) return;
    }
  }
  attack(g, ai);
}

/** The ore point of this kind nearest `from`, or -1 when the map has none. */
function nearestOreSpot(g: Game, kind: OreKind, from: number): number {
  const o = g.objects;
  if (!o) return -1;
  let best = -1;
  let bestD = Infinity;
  for (let p = 0; p < o.ore.length; p++) {
    if (o.ore[p]! === 0 || o.oreKind[p] !== kind) continue;
    const d = dist(g, p, from);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** The flags joined to `from` by road. */
function reachableFlags(g: Game, from: number): Set<number> {
  const seen = new Set<number>([from]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    for (const ri of g.flags[queue[head]!]!.road) {
      if (ri < 0 || g.roads[ri]!.removed) continue;
      const r = g.roads[ri]!;
      for (const f of r.flag) if (!seen.has(f)) {
        seen.add(f);
        queue.push(f);
      }
    }
  }
  return seen;
}

/** Can the castle pay for it right now, and is there a tool for its worker? (The AI does not queue sites it cannot supply.) */
function affordable(g: Game, owner: number, castle: number, type: BuildingType): boolean {
  const need = buildNeeds(type);
  const stock = g.buildings[castle]!.stock;
  if (!need.every((n, r) => n <= stock[r]!)) return false;
  const tool = toolFor(type);
  if (g.tools && tool !== Res.None) {
    const waiting = g.buildings.filter((b) => !b.removed && b.owner === owner && !b.hasTool && toolFor(b.type) === tool).length;
    if (stock[tool]! <= waiting) return false;
  }
  return true;
}

// ---- building ---------------------------------------------------------

function build(g: Game, ai: AiPlayer, type: BuildingType, seek = -1): boolean {
  // a spot no road can reach (a mountain ledge, say) is dropped and the next best tried, not picked again and again
  const skip = new Set<number>();
  for (let attempt = 0; attempt < BUILD_ATTEMPTS; attempt++) {
    const pos = findSite(g, ai, type, seek, skip);
    if (pos < 0) return false;
    skip.add(pos);
    let index: number;
    try {
      index = g.placeBuilding(type, pos, true, ai.owner);
    } catch {
      continue;
    }
    if (connect(g, ai.owner, g.buildings[index]!.flag)) return true;
    g.demolishBuilding(index); // no road to it: do not leave an orphan site
  }
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
function findSite(g: Game, ai: AiPlayer, type: BuildingType, seek = -1, skip?: Set<number>): number {
  const castle = g.buildings[g.castleOf(ai.owner)]!;
  const military = isMilitaryType(type);
  const enemy = military ? enemyCastle(g, ai.owner) : -1;
  const target = seek >= 0 ? seek : enemy >= 0 && ai.temperament !== Temperament.Peaceful ? g.buildings[enemy]!.pos : -1;
  const ownMilitary = g.buildings.filter((b) => !b.removed && b.owner === ai.owner && isMilitaryType(b.type));

  const ore = oreKindOf(type);
  const cands: { p: number; score: number }[] = [];
  for (let p = 0; p < g.ownerAt.length; p++) {
    if (g.ownerAt[p] !== ai.owner || skip?.has(p)) continue;
    const d0 = dist(g, p, castle.pos);
    if (d0 < 3) continue;
    if (ore !== OreKind.None && !(g.objects && g.objects.oreNear(p, ore) > 0)) continue; // a mine only where there is ore to dig
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
  const reach = reachableFlags(g, g.buildings[g.castleOf(owner)]!.flag); // only to what its castle can already reach
  const near = g.flags
    .filter((f) => !f.removed && f.owner === owner && f.index !== flag && reach.has(f.index))
    .sort((a, b) => dist(g, a.pos, here) - dist(g, b.pos, here) || a.index - b.index)
    .slice(0, 12);
  for (const f of near) {
    const path = planRoad(g, flag, f.pos);
    if (!path) continue;
    g.addRoad(flag, path);
    let p = here;
    path.forEach((d, i) => {
      p = g.move(p, d);
      if (i % 4 === 3 && i < path.length - 2 && checkFlag(g, p, owner).ok) g.addFlag(p % g.cols, Math.floor(p / g.cols), owner);
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
