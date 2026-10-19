// Logistics simulation: hex grid, flags, roads, transporters, buildings.
// Headless and deterministic (no RNG, integers only). Port of the C++
// reference in logistics/sim.cc: same update order, same numbers. The
// parity tests pin the two together.

import {
  BState,
  BUILD_UNIT_TICKS,
  BURN_TICKS,
  type Building,
  BuilderState,
  BuildingType,
  CASTLE_BUILDERS,
  CASTLE_CARRIERS,
  IDLE_RELEASE,
  DIRS,
  Dir,
  DISPATCH_PERIOD,
  EARLY_EXIT_PRIO,
  FLAG_PRIO,
  FOOD,
  FOOD_MAX,
  GeoPhase,
  type Geologist,
  TOOL_KINDS,
  TOOL_MAX,
  toolFor,
  PARITY_RES,
  FLAG_SLOTS,
  type Flag,
  type StoreLimits,
  HIRE_WAITING,
  type Item,
  MAX_CARRIERS,
  RES_COUNT,
  Res,
  type Road,
  STORAGE_BUILDERS,
  STORAGE_CARRIERS,
  TState,
  type Transporter,
  acceptsAll,
  emptyItem,
  isStore,
  priority,
  reverse,
  stepTicks,
  STEP_TICKS,
} from './types.ts';

import { Terrain, TerrainMap, hash01 } from './terrain.ts';
import {
  FIELD_RADIUS,
  FIELD_TICKS,
  GEO_PROBES,
  GEO_PROBE_TICKS,
  GEO_RADIUS,
  SIGN_EMPTY,
  signFor,
  signKind,
  HARVEST_RADIUS,
  MAX_FIELDS,
  MapObject,
  MapObjects,
  ORE_RADIUS,
  OreKind,
  oreKindOf,
  PLANT_RADIUS,
  SCAN_TICKS,
  distanceBetween,
} from './objects.ts';
import { SAVE_VERSION, type SaveData, fromBase64, sparse, toBase64, unsparse } from './save.ts';
import { type Check, checkBuilding, checkFlag, checkRoadStep, footprintOf } from './placement.ts';

/** A per-resource list from a save made when there were fewer resources: the new ones start at 0. */
const padRes = (a: number[]): number[] => (a.length >= RES_COUNT ? a : [...a, ...new Array<number>(RES_COUNT - a.length).fill(0)]);

const DX = [1, 1, 0, -1, -1, 0];
const DY = [0, 1, 1, 0, -1, -1];

/** One letter per building for render(). */
const GLYPH: Record<BuildingType, string> = {
  [BuildingType.Lumberjack]: 'J',
  [BuildingType.Sawmill]: 'W',
  [BuildingType.Storage]: 'S',
  [BuildingType.Stonecutter]: 'C',
  [BuildingType.Castle]: 'K',
  [BuildingType.Forester]: 'F',
  [BuildingType.Fisher]: 'I',
  [BuildingType.Farm]: 'A',
  [BuildingType.Well]: 'L',
  [BuildingType.Mill]: 'M',
  [BuildingType.Baker]: 'B',
  [BuildingType.StoneMine]: 'N',
  [BuildingType.CoalMine]: 'O',
  [BuildingType.IronMine]: 'R',
  [BuildingType.GoldMine]: 'G',
  [BuildingType.IronSmelter]: 'X',
  [BuildingType.GoldSmelter]: 'Y',
  [BuildingType.Toolmaker]: 'T',
  [BuildingType.PigFarm]: 'Q',
  [BuildingType.Butcher]: 'Z',
};

const zeros = (): number[] => new Array<number>(RES_COUNT).fill(0);

/** What a lumberjack or stonecutter harvests; None for everything else. */
export function harvestKindOf(type: BuildingType): MapObject {
  if (type === BuildingType.Lumberjack) return MapObject.Tree;
  if (type === BuildingType.Stonecutter) return MapObject.Stone;
  return MapObject.None;
}

/** What each mine digs out. */
const MINE_OUT: Partial<Record<BuildingType, Res>> = {
  [BuildingType.StoneMine]: Res.Stone,
  [BuildingType.CoalMine]: Res.Coal,
  [BuildingType.IronMine]: Res.IronOre,
  [BuildingType.GoldMine]: Res.GoldOre,
};

/** The materials a building of this type needs to be built, by resource (a list indexed by Res). */
export function buildNeeds(type: BuildingType): number[] {
  const probe = { type, need: zeros() } as Building;
  setNeeds(probe);
  return probe.need;
}

/** What each building needs to be built. */
function setNeeds(b: Building): void {
  switch (b.type) {
    case BuildingType.Lumberjack:
    case BuildingType.Stonecutter:
    case BuildingType.Forester:
      b.need[Res.Plank] = 2;
      break;
    case BuildingType.Sawmill:
      b.need[Res.Plank] = 2;
      b.need[Res.Stone] = 1;
      break;
    case BuildingType.Storage:
      b.need[Res.Plank] = 3;
      b.need[Res.Stone] = 2;
      break;
    case BuildingType.Fisher:
      b.need[Res.Plank] = 2;
      break;
    case BuildingType.Well:
      b.need[Res.Plank] = 1;
      b.need[Res.Stone] = 1;
      break;
    case BuildingType.Farm:
      b.need[Res.Plank] = 3;
      b.need[Res.Stone] = 1;
      break;
    case BuildingType.Mill:
      b.need[Res.Plank] = 2;
      b.need[Res.Stone] = 2;
      break;
    case BuildingType.Baker:
      b.need[Res.Plank] = 2;
      b.need[Res.Stone] = 2;
      break;
    case BuildingType.StoneMine:
    case BuildingType.CoalMine:
    case BuildingType.IronMine:
    case BuildingType.GoldMine:
      b.need[Res.Plank] = 3;
      break;
    case BuildingType.IronSmelter:
    case BuildingType.GoldSmelter:
      b.need[Res.Plank] = 2;
      b.need[Res.Stone] = 2;
      break;
    case BuildingType.Toolmaker:
      b.need[Res.Plank] = 3;
      b.need[Res.Stone] = 2;
      break;
    case BuildingType.PigFarm:
      b.need[Res.Plank] = 3;
      b.need[Res.Stone] = 1;
      break;
    case BuildingType.Butcher:
      b.need[Res.Plank] = 2;
      b.need[Res.Stone] = 1;
      break;
    case BuildingType.Castle:
      break; // never built
  }
}

/** What a finished building does. */
function initOperation(b: Building): void {
  switch (b.type) {
    case BuildingType.Lumberjack:
      b.out = Res.Lumber;
      b.period = 400;
      break;
    case BuildingType.Stonecutter:
      b.out = Res.Stone;
      b.period = 500;
      break;
    case BuildingType.Forester:
      b.period = 500; // plants, but makes nothing to carry
      break;
    case BuildingType.Sawmill:
      b.inGroups = [[Res.Lumber]];
      b.out = Res.Plank;
      b.maxIn = 8;
      b.period = 300;
      break;
    case BuildingType.Fisher:
      b.out = Res.Fish;
      b.period = 500;
      break;
    case BuildingType.Farm:
      b.out = Res.Wheat;
      b.period = 700;
      break;
    case BuildingType.Well:
      b.out = Res.Water;
      b.period = 350;
      break;
    case BuildingType.Mill:
      b.inGroups = [[Res.Wheat]];
      b.out = Res.Flour;
      b.maxIn = 6;
      b.period = 400;
      break;
    case BuildingType.Baker:
      b.inGroups = [[Res.Flour], [Res.Water]];
      b.out = Res.Bread;
      b.maxIn = 4;
      b.period = 500;
      break;
    case BuildingType.StoneMine:
    case BuildingType.CoalMine:
    case BuildingType.IronMine:
    case BuildingType.GoldMine:
      b.inGroups = [FOOD.slice()]; // fish or bread
      b.out = MINE_OUT[b.type]!;
      b.maxIn = 4;
      b.period = 600;
      break;
    case BuildingType.IronSmelter:
      b.inGroups = [[Res.IronOre], [Res.Coal]];
      b.out = Res.Iron;
      b.maxIn = 4;
      b.period = 600;
      break;
    case BuildingType.GoldSmelter:
      b.inGroups = [[Res.GoldOre], [Res.Coal]];
      b.out = Res.Gold;
      b.maxIn = 4;
      b.period = 600;
      break;
    case BuildingType.PigFarm:
      b.inGroups = [[Res.Wheat], [Res.Water]];
      b.out = Res.Pig;
      b.maxIn = 4;
      b.period = 800;
      break;
    case BuildingType.Butcher:
      b.inGroups = [[Res.Pig]];
      b.out = Res.Meat;
      b.maxIn = 4;
      b.period = 600;
      break;
    case BuildingType.Toolmaker:
      b.inGroups = [[Res.Iron], [Res.Plank]];
      b.out = Res.Axe; // the kind is picked afresh for every tool
      b.maxIn = 4;
      b.period = 800;
      break;
    case BuildingType.Storage:
      b.carriers = STORAGE_CARRIERS;
      b.builders = STORAGE_BUILDERS;
      break;
    case BuildingType.Castle:
      b.carriers = CASTLE_CARRIERS;
      b.builders = CASTLE_BUILDERS;
      break;
  }
}

export class Game {
  readonly cols: number;
  readonly rows: number;
  /** Ground heights. Flat grass unless a map is given. */
  readonly terrain: TerrainMap;
  /**
   * Trees and rocks. With none (null) lumberjacks and stonecutters have
   * unlimited material, as in the C++ reference.
   */
  objects: MapObjects | null;
  /** Bumped whenever flags, roads or buildings are added: caches key on it. */
  layoutVersion = 0;
  tick = 0; // uint16, wraps like the C++ original
  speed = 2; // sim-ticks per real step; 0 pauses
  flags: Flag[] = [];
  roads: Road[] = [];
  buildings: Building[] = [];
  transporters: Transporter[] = [];
  created = zeros(); // items made by buildings
  consumed = zeros(); // items destroyed by buildings
  dispatched = zeros(); // items storages sent out
  lost = zeros(); // items destroyed by demolition (created = consumed + lost + present)
  hired = 0; // carriers sent out so far
  /**
   * Capacity of finished stores, per resource. null (the default) means
   * unlimited, which is what the parity scenarios model. Set it right after
   * creating the game: stores take the limit when they are finished.
   */
  limits: StoreLimits | null = null;
  /**
   * A finished building stays empty until its worker has walked over from a
   * storage (as in the original). Off by default: the C++ reference starts work
   * the moment a site is finished.
   */
  settlers = false;
  /**
   * Every worker needs a tool, taken from a storage when he is sent out (a
   * toolmaker makes them from iron and planks) and given back when his building
   * is demolished. Off by default: the C++ reference has no tools.
   */
  tools = false;
  /** Geologists out on a trip. They are removed when they get home. */
  geologists: Geologist[] = [];
  private nextGeologist = 0;
  /** Ore a geologist has just found: the screen reads it and clears it. Not saved. */
  discoveries: { pos: number; kind: OreKind }[] = [];
  /** What the toolmakers should make: a weight per tool kind (index into TOOL_KINDS), 0 to TOOL_MAX. */
  toolShare: number[] = TOOL_KINDS.map(() => 5);
  /** The food slider per ore kind (index OreKind): 0 to FOOD_MAX. New mines start with their kind's share. */
  foodShare: number[] = [FOOD_MAX, FOOD_MAX, FOOD_MAX, FOOD_MAX, FOOD_MAX];

  private flagAt: Int32Array; // pos -> flag index or -1
  private roadAt: Int32Array; // pos -> index of the road passing through, or -1
  private buildingAt: Int32Array; // pos -> building index (any covered point) or -1
  /**
   * Spare carriers walking back: [storage, ticks left, flag he set out from,
   * whole walk in ticks]. They rejoin the storage's crew on arrival. The last two
   * are for drawing (-1 and 0 in saves that predate them).
   */
  homebound: [number, number, number, number][] = [];
  private pendingOut: number[] = []; // building -> finished item not yet dropped
  private castleIndex = -1;
  private searchId = 0;
  private builderFailed = false; // no builder available this step
  private hireFailed = false; // no carrier available this step

  constructor(cols: number, rows: number, terrain?: TerrainMap, objects?: MapObjects) {
    this.cols = cols;
    this.rows = rows;
    this.objects = objects ?? null;
    if (objects && (objects.cols !== cols || objects.rows !== rows)) {
      throw new Error('objects size does not match the grid');
    }
    this.terrain = terrain ?? TerrainMap.flat(cols, rows);
    if (this.terrain.cols !== cols || this.terrain.rows !== rows) {
      throw new Error('terrain size does not match the grid');
    }
    this.flagAt = new Int32Array(cols * rows).fill(-1);
    this.roadAt = new Int32Array(cols * rows).fill(-1);
    this.buildingAt = new Int32Array(cols * rows).fill(-1);
  }

  // ---- grid ------------------------------------------------------------

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  index(x: number, y: number): number {
    return y * this.cols + x;
  }

  /** Neighbour of `pos` in direction `d`, or -1 when leaving the grid. */
  move(pos: number, d: Dir): number {
    const x = (pos % this.cols) + DX[d]!;
    const y = Math.floor(pos / this.cols) + DY[d]!;
    return this.inside(x, y) ? this.index(x, y) : -1;
  }

  flagAtPos(pos: number): number {
    return this.flagAt[pos]!;
  }

  roadAtPos(pos: number): boolean {
    return this.roadAt[pos]! >= 0;
  }

  /** Index of the road passing through this point (between its flags), -1 if none. */
  roadIndexAt(pos: number): number {
    return this.roadAt[pos]!;
  }

  /** Index of the building covering this point, -1 if none. */
  buildingAtPos(pos: number): number {
    return this.buildingAt[pos]!;
  }

  /** The tree or rock standing here, if any. */
  objectAtPos(pos: number): MapObject {
    return this.objects ? this.objects.kindAt(pos) : MapObject.None;
  }

  /** Does a flag, road or building use this point? */
  isOccupied(pos: number): boolean {
    return this.flagAt[pos]! >= 0 || this.roadAt[pos]! >= 0 || this.buildingAt[pos]! >= 0;
  }

  /** Building index of the castle, -1 until one is placed. */
  get castle(): number {
    return this.castleIndex;
  }

  static maxCarriers(roadLength: number): number {
    const cat = Math.floor(roadLength / 2);
    return MAX_CARRIERS[cat > 7 ? 7 : cat]!;
  }

  // ---- setup (all throw Error on invalid placement) ---------------------

  addFlag(x: number, y: number): number {
    if (!this.inside(x, y)) throw new Error('flag outside grid');
    const pos = this.index(x, y);
    const check = checkFlag(this, pos);
    if (!check.ok) throw new Error(check.reason);
    const f: Flag = {
      index: this.flags.length,
      pos,
      slot: Array.from({ length: FLAG_SLOTS }, emptyItem),
      road: new Array<number>(DIRS).fill(-1),
      building: -1,
      searchNum: 0,
      removed: false,
    };
    const onRoad = this.roadAt[pos]!;
    this.flags.push(f);
    this.flagAt[pos] = f.index;
    if (onRoad >= 0) this.splitRoad(onRoad, f);
    this.layoutVersion++;
    return f.index;
  }

  /**
   * A flag put on a road cuts it in two, at a corner or anywhere along it, and
   * a new road can then branch off from it. The old road keeps its index for
   * the half next to its first flag; the other half is a new road.
   *
   * Nothing is lost: items on flags keep their destination and simply route
   * through the new flag. A carrier goes with whichever half it is standing on
   * or walking along, with the time it has left rescaled to that half. One
   * walking from end to end reaches the new flag and drops its item there.
   * A road that ends up with no carrier hires one.
   */
  private splitRoad(roadIndex: number, f: Flag): void {
    const r = this.roads[roadIndex]!;
    const a = r.flag[0];
    const b = r.flag[1];
    const oldDirs = r.dirs;
    const n = r.length;

    let k = -1; // steps from the first flag to the new one
    let p = this.flags[a]!.pos;
    for (let i = 0; i + 1 < oldDirs.length; i++) {
      p = this.move(p, oldDirs[i]!);
      if (p === f.pos) {
        k = i + 1;
        break;
      }
    }
    if (k < 1) throw new Error('flag is not on that road');

    const dirs1 = oldDirs.slice(0, k);
    const dirs2 = oldDirs.slice(k);
    const walking = (from: number, dirs: Dir[]): [number, number] => {
      let fwd = 0;
      let back = 0;
      let q = from;
      for (const d of dirs) {
        const next = this.move(q, d);
        const dh = this.terrain.heightAt(next) - this.terrain.heightAt(q);
        fwd += stepTicks(dh);
        back += stepTicks(-dh);
        q = next;
      }
      return [fwd, back];
    };
    const oldTicks = r.ticks;
    const oldDirAtB = r.dirAt[1];
    const oldCarriers = r.carriers;

    const r2: Road = {
      index: this.roads.length,
      flag: [f.index, b],
      dirAt: [dirs2[0]!, oldDirAtB],
      dirs: dirs2,
      length: n - k,
      ticks: walking(f.pos, dirs2),
      carriers: [],
      dynamic: true,
      removed: false,
    };
    this.roads.push(r2);
    r.flag = [a, f.index];
    r.dirAt = [r.dirAt[0], reverse(dirs1[k - 1]!)];
    r.dirs = dirs1;
    r.length = k;
    r.ticks = walking(this.flags[a]!.pos, dirs1);
    r.carriers = [];
    r.dynamic = true; // a fixed-crew road (experiments only) hires from here on

    f.road[r.dirAt[1]] = r.index;
    f.road[r2.dirAt[0]] = r2.index;
    this.flags[b]!.road[oldDirAtB] = r2.index;
    this.roadAt[f.pos] = -1; // the flag's own point is no longer road
    let q = f.pos;
    for (let i = 0; i < dirs2.length - 1; i++) {
      q = this.move(q, dirs2[i]!);
      this.roadAt[q] = r2.index;
    }

    for (const ti of oldCarriers) {
      const t = this.transporters[ti]!;
      let onFirst: boolean;
      if (t.state === TState.Walking) {
        const total = oldTicks[t.at]!;
        const progress = Math.min(1, Math.max(0, 1 - t.counter / total));
        const s = t.at === 0 ? progress * n : (1 - progress) * n; // steps from the first flag
        const towardsEnd1 = t.at === 0;
        if (s < k) {
          onFirst = true;
          t.counter = Math.round(r.ticks[towardsEnd1 ? 0 : 1]! * (towardsEnd1 ? 1 - s / k : s / k));
          t.at = towardsEnd1 ? 0 : 1;
        } else {
          onFirst = false;
          const s2 = s - k;
          const m = n - k;
          t.counter = Math.round(r2.ticks[towardsEnd1 ? 0 : 1]! * (towardsEnd1 ? 1 - s2 / m : s2 / m));
          t.at = towardsEnd1 ? 0 : 1;
        }
      } else {
        onFirst = t.at === 0; // standing at (or arriving to) one of the old ends
      }
      const target = onFirst ? r : r2;
      t.road = target.index;
      target.carriers.push(ti);
    }
  }

  /**
   * carriers = -1 (default): carriers are hired on demand from storages, up to
   * a cap by road length. carriers >= 1: that many from the start, never hired
   * or fired (for experiments). One carrier moves at most one item per round
   * trip, so busy roads need more carriers or to be split.
   */
  addRoad(from: number, dirs: Dir[], carriers = -1): number {
    if (carriers === 0 || carriers < -1) {
      throw new Error('carriers must be -1 (dynamic) or >= 1');
    }
    if (dirs.length === 0) throw new Error('empty road');
    const a = this.flags[from];
    if (!a) throw new Error('no such flag');
    if (a.road[dirs[0]!]! >= 0) throw new Error('direction in use');

    let pos = a.pos;
    const tiles: number[] = [];
    let ticksFwd = 0;
    let ticksBack = 0; // walking the road each way
    for (let i = 0; i < dirs.length; i++) {
      const prev = pos;
      pos = this.move(pos, dirs[i]!);
      if (pos < 0) throw new Error('road leaves grid');
      const dh = this.terrain.heightAt(pos) - this.terrain.heightAt(prev);
      ticksFwd += stepTicks(dh);
      ticksBack += stepTicks(-dh);
      if (i + 1 < dirs.length) {
        if (this.flagAt[pos]! >= 0 || this.roadAt[pos]! >= 0) {
          throw new Error('road crosses flag or road');
        }
        tiles.push(pos);
      }
      const step = checkRoadStep(this, prev, pos);
      if (!step.ok) throw new Error(step.reason);
    }
    const to = this.flagAt[pos]!;
    if (to < 0) throw new Error('road must end on a flag');
    if (to === from) throw new Error('road loops to itself');
    const b = this.flags[to]!;
    const back = reverse(dirs[dirs.length - 1]!);
    if (b.road[back]! >= 0) throw new Error('direction in use');

    const r: Road = {
      index: this.roads.length,
      flag: [from, to],
      dirAt: [dirs[0]!, back],
      dirs: dirs.slice(),
      length: dirs.length,
      ticks: [ticksFwd, ticksBack],
      carriers: [],
      dynamic: carriers < 0,
      removed: false,
    };
    this.roads.push(r);
    for (const t of tiles) this.roadAt[t] = r.index;
    a.road[dirs[0]!] = r.index;
    b.road[back] = r.index;
    this.layoutVersion++;

    for (let i = 0; i < carriers; i++) {
      // spread carriers over both ends
      r.carriers.push(this.transporters.length);
      this.transporters.push({
        road: r.index,
        at: i % 2,
        state: TState.Idle,
        item: emptyItem(),
        counter: 0,
        tick: this.tick,
        carriedTotal: 0,
        gone: false,
      idle: 0,
      });
    }
    return r.index;
  }

  /**
   * construct = true places an unbuilt site: it asks for materials and a
   * builder, and starts working once finished. The castle cannot be built and
   * there is only one of it (both throw).
   */
  addBuilding(type: BuildingType, flag: number, construct = false): number {
    const f = this.flags[flag];
    if (!f) throw new Error('no such flag');
    if (f.building >= 0) throw new Error('flag already has building');
    this.assertCastleRules(type, construct);
    const pos = this.move(f.pos, Dir.UpLeft);
    const b: Building = {
      index: this.buildings.length,
      type,
      flag,
      pos,
      inGroups: [],
      out: Res.None,
      maxIn: 0,
      hasTool: false,
      foodWeight: FOOD_MAX,
      period: 0,
      stock: zeros(),
      requested: zeros(),
      capacity: 0,
      incoming: zeros(),
      carriers: 0,
      builders: 0,
      constructing: construct,
      target: -1,
      walkTicks: 0,
      workTotal: 0,
      need: zeros(),
      used: zeros(),
      builder: BuilderState.None,
      builderHome: -1,
      builderCounter: 0,
      unitRes: Res.None,
      unitCounter: 0,
      dispatchCounter: 0,
      state: BState.Idle,
      counter: 0,
      tick: this.tick,
      burning: 0,
      removed: false,
    };
    if (construct) setNeeds(b);
    else {
      initOperation(b);
      this.applyLimit(b);
      this.applyFood(b);
      this.giveTool(b);
    }
    this.buildings.push(b);
    this.pendingOut.push(0);
    f.building = b.index;
    if (type === BuildingType.Castle) this.castleIndex = b.index;
    // Record what the building covers. addBuilding itself does not judge
    // terrain (tests and scenarios use it freely); placeBuilding does.
    if (pos >= 0) {
      const covered = footprintOf(this, type, pos) ?? [pos]; // partly off-map: just the point
      for (const q of covered) this.buildingAt[q] = b.index;
    }
    this.layoutVersion++;
    return b.index;
  }

  /** Move a toolmaker slider: how much of the tools made should be this kind (0 = none). */
  setToolShare(tool: Res, share: number): void {
    const i = TOOL_KINDS.indexOf(tool);
    if (i >= 0) this.toolShare[i] = Math.max(0, Math.min(TOOL_MAX, Math.round(share)));
  }

  /**
   * The kind of tool a toolmaker should make next: the one furthest below its
   * share, counting tools in storages, and counting each building waiting for
   * that kind as 20 more votes. None if every slider is at 0.
   */
  chooseTool(): Res {
    let best = Res.None;
    let bestScore = 0;
    for (let i = 0; i < TOOL_KINDS.length; i++) {
      const kind = TOOL_KINDS[i]!;
      const weight = this.toolShare[i]!;
      if (weight <= 0) continue;
      let stock = 0;
      let waiting = 0;
      for (const b of this.buildings) {
        if (b.removed) continue;
        if (acceptsAll(b)) stock += b.stock[kind]!;
        else if (!b.constructing && b.state === BState.Arriving && b.builderHome < 0 && !b.hasTool && toolFor(b.type) === kind) waiting++;
      }
      const score = (weight + 20 * waiting) / (1 + stock);
      if (score > bestScore) {
        bestScore = score;
        best = kind;
      }
    }
    return best;
  }

  // ---- geologists ------------------------------------------------------

  /**
   * Can a geologist be sent to this flag? He needs the map to have ore at all, a
   * flag on or beside a mountain, no other geologist already there, and a
   * storage joined by road (with a hammer to give him when workers need tools).
   */
  checkGeologist(flag: number): Check {
    const f = this.flags[flag];
    if (!f || f.removed) return { ok: false, reason: 'no such flag' };
    if (!this.objects) return { ok: false, reason: 'there is nothing to find on this map' };
    const mountain = this.flagByMountain(flag);
    if (!mountain) return { ok: false, reason: 'a geologist needs a flag on or beside a mountain' };
    if (this.geologists.some((g) => g.flag === flag)) return { ok: false, reason: 'a geologist is already working there' };
    if (!this.geologistStorage(flag)) {
      return { ok: false, reason: this.tools ? 'no storage joined by road has a hammer to give him' : 'no storage joined by road to send him from' };
    }
    return { ok: true, reason: '' };
  }

  /** Is the flag on a mountain point, or next to one? (Where a geologist has anything to probe.) */
  flagByMountain(flag: number): boolean {
    const f = this.flags[flag];
    if (!f || f.removed) return false;
    if (this.terrain.kindAt(f.pos) === Terrain.Mountain) return true;
    const x = f.pos % this.cols;
    const y = Math.floor(f.pos / this.cols);
    for (let d = 0; d < DIRS; d++) {
      const nx = x + DX[d]!;
      const ny = y + DY[d]!;
      if (this.inside(nx, ny) && this.terrain.kindAt(this.index(nx, ny)) === Terrain.Mountain) return true;
    }
    return false;
  }

  private geologistStorage(flag: number): { storage: number; dist: number } | null {
    let found: { storage: number; dist: number } | null = null;
    this.search(flag, false, (fl, _hop, d) => {
      if (fl.building < 0) return false;
      const s = this.buildings[fl.building]!;
      if (!acceptsAll(s) || (this.tools && s.stock[Res.Hammer]! <= 0)) return false;
      found = { storage: fl.building, dist: d };
      return true;
    });
    return found;
  }

  /** Send a geologist to a flag: he walks from the nearest storage, then probes spots around it. */
  sendGeologist(flag: number): void {
    const c = this.checkGeologist(flag);
    if (!c.ok) throw new Error(c.reason);
    const { storage, dist } = this.geologistStorage(flag)!;
    if (this.tools) this.buildings[storage]!.stock[Res.Hammer]!--;
    this.geologists.push({
      id: this.nextGeologist++,
      flag,
      home: storage,
      phase: GeoPhase.Coming,
      pos: this.flags[this.buildings[storage]!.flag]!.pos,
      target: -1,
      counter: dist,
      total: dist,
      probes: GEO_PROBES,
      hasTool: this.tools,
    });
  }

  private updateGeologists(delta: number): void {
    for (const geo of this.geologists) {
      geo.counter -= delta;
      while (geo.counter <= 0 && geo.phase !== GeoPhase.Done) {
        if (geo.phase === GeoPhase.Coming) {
          geo.pos = this.flags[geo.flag]!.pos;
          this.geologistChooses(geo);
        } else if (geo.phase === GeoPhase.Out) {
          geo.pos = geo.target;
          geo.phase = GeoPhase.Probing;
          geo.total = GEO_PROBE_TICKS;
          geo.counter += GEO_PROBE_TICKS;
        } else if (geo.phase === GeoPhase.Probing) {
          this.geologistProbes(geo);
          if (--geo.probes <= 0) this.geologistGoesHome(geo);
          else this.geologistChooses(geo);
        } else {
          geo.phase = GeoPhase.Done; // arrived: handled below
        }
      }
    }
    // those who have got home give back their hammer and are done
    this.geologists = this.geologists.filter((geo) => {
      if (geo.phase !== GeoPhase.Done) return true;
      if (geo.hasTool) {
        const b = this.buildings[geo.home]!;
        const to = b.removed || !acceptsAll(b) ? this.castleIndex : geo.home;
        if (to >= 0) this.buildings[to]!.stock[Res.Hammer]!++;
        else this.lost[Res.Hammer]!++;
      }
      return false;
    });
  }

  /**
   * He picks, at random, one of the mountain spots near the flag that have
   * nothing on them and no sign yet. When there is none left he goes home.
   */
  private geologistChooses(geo: Geologist): void {
    const o = this.objects!;
    const centre = this.flags[geo.flag]!.pos;
    const cx = centre % this.cols;
    const cy = Math.floor(centre / this.cols);
    const spots: number[] = [];
    for (let dy = -GEO_RADIUS; dy <= GEO_RADIUS; dy++) {
      for (let dx = -GEO_RADIUS; dx <= GEO_RADIUS; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dx - dy)) > GEO_RADIUS || !this.inside(cx + dx, cy + dy)) continue;
        const p = this.index(cx + dx, cy + dy);
        if (this.terrain.kindAt(p) !== Terrain.Mountain || o.kindAt(p) !== MapObject.None || this.isOccupied(p) || o.sign[p] !== 0) continue;
        spots.push(p);
      }
    }
    if (spots.length === 0) {
      this.geologistGoesHome(geo);
      return;
    }
    const p = spots[Math.floor(hash01(geo.id * 977 + geo.probes, this.tick, 0x71) * spots.length)]!;
    geo.target = p;
    geo.phase = GeoPhase.Out;
    geo.total = Math.max(1, distanceBetween(this.cols, geo.pos, p)) * STEP_TICKS;
    geo.counter += geo.total;
  }

  private geologistGoesHome(geo: Geologist): void {
    const b = this.buildings[geo.home]!;
    const door = this.flags[b.flag]!.pos;
    geo.target = -1;
    geo.phase = GeoPhase.Home;
    geo.total = Math.max(1, distanceBetween(this.cols, geo.pos, door)) * STEP_TICKS;
    geo.counter += geo.total;
  }

  /** The hammer has tapped long enough: a sign goes up saying what is under the spot. */
  private geologistProbes(geo: Geologist): void {
    const o = this.objects!;
    const p = geo.target;
    const units = o.ore[p]!;
    const kind = o.oreKind[p] as OreKind;
    if (units > 0 && kind !== OreKind.None) {
      // a new find is news unless a sign of the same kind stands close by
      let news = true;
      const x = p % this.cols;
      const y = Math.floor(p / this.cols);
      for (let dy = -3; dy <= 3 && news; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dx - dy)) > 3 || !this.inside(x + dx, y + dy)) continue;
          if (signKind(o.sign[this.index(x + dx, y + dy)]!) === kind) {
            news = false;
            break;
          }
        }
      }
      o.setSign(p, signFor(kind, units));
      if (news) this.discoveries.push({ pos: p, kind });
    } else {
      o.setSign(p, SIGN_EMPTY);
    }
  }

  /** A building placed finished (by a script) comes with its worker's tool. */
  private giveTool(b: Building): void {
    const tool = toolFor(b.type);
    if (!this.tools || tool === Res.None || b.hasTool) return;
    this.created[tool]++;
    b.hasTool = true;
  }

  /** The worker of a building that is going away walks home with his tool, back into the nearest storage. */
  private releaseTool(b: Building): void {
    if (!b.hasTool) return;
    b.hasTool = false;
    let storage = -1;
    this.search(b.flag, false, (fl) => {
      if (fl.building < 0 || !acceptsAll(this.buildings[fl.building]!)) return false;
      storage = fl.building;
      return true;
    });
    if (storage < 0) storage = this.castleIndex;
    const tool = toolFor(b.type);
    if (storage >= 0) this.buildings[storage]!.stock[tool]!++;
    else this.lost[tool]!++;
  }

  /** A finished mine takes the slider setting of its kind. */
  private applyFood(b: Building): void {
    const kind = oreKindOf(b.type);
    if (kind !== OreKind.None) b.foodWeight = this.foodShare[kind]!;
  }

  /** Move a food slider: every mine of that ore kind, built or to be built, gets this share of the food. */
  setFoodShare(kind: OreKind, share: number): void {
    if (kind === OreKind.None) return;
    const w = Math.max(0, Math.min(FOOD_MAX, Math.round(share)));
    this.foodShare[kind] = w;
    for (const b of this.buildings) if (!b.removed && oreKindOf(b.type) === kind) b.foodWeight = w;
  }

  private applyLimit(b: Building): void {
    b.capacity = 0;
    if (!this.limits || !isStore(b)) return;
    b.capacity = b.type === BuildingType.Castle ? this.limits.castle : this.limits.storage;
  }

  /** Would this finished store take one more `r`, counting what is already on its way? */
  storeWants(b: Building, r: Res): boolean {
    return acceptsAll(b) && (b.capacity <= 0 || b.stock[r]! + b.incoming[r]! < b.capacity);
  }

  private assertCastleRules(type: BuildingType, construct: boolean): void {
    if (type !== BuildingType.Castle) return;
    if (construct) throw new Error('a castle cannot be built');
    if (this.castleIndex >= 0) throw new Error('only one castle');
  }

  /**
   * The checked way to put a building down: `pos` is the building point, its
   * flag goes to the down-right neighbour (reused if one is already there).
   * Throws with the reason when the spot is not allowed.
   */
  placeBuilding(type: BuildingType, pos: number, construct = true): number {
    this.assertCastleRules(type, construct);
    const check = checkBuilding(this, type, pos);
    if (!check.ok) throw new Error(check.reason);
    let fi = this.flagAt[check.flagPos]!;
    if (fi < 0) fi = this.addFlag(check.flagPos % this.cols, Math.floor(check.flagPos / this.cols));
    return this.addBuilding(type, fi, construct);
  }

  /** The map point where a building whose door is this flag would stand (up-left of the flag). */
  buildSpot(flag: number): number {
    return this.move(this.flags[flag]!.pos, Dir.UpLeft);
  }

  /** Put starting goods into a building's stock (counted as created). */
  addStock(building: number, r: Res, n: number): void {
    const b = this.buildings[building];
    if (!b) throw new Error('no such building');
    b.stock[r]! += n;
    this.created[r]! += n;
  }

  // ---- search ----------------------------------------------------------

  /**
   * Breadth-first over flags (hop count, like the original), tagging each flag
   * with the direction of the first hop taken from `src` and the time walked so
   * far, in ticks, by a walker heading back to `src` (a carrier or builder comes
   * from the storage that is searched for). `cb` gets (flag, firstHop, dist) and returns true to stop.
   * The source gets Dir.None. With `carriedOnly`, roads that have no working
   * carrier are not followed (items cannot use them yet).
   */
  private search(
    src: number,
    carriedOnly: boolean,
    cb: (f: Flag, hop: Dir, dist: number) => boolean,
  ): void {
    this.searchId++;
    const qFlag: number[] = [src];
    const qHop: Dir[] = [Dir.None];
    const qDist: number[] = [0];
    this.flags[src]!.searchNum = this.searchId;
    for (let head = 0; head < qFlag.length; head++) {
      const fi = qFlag[head]!;
      const hop = qHop[head]!;
      const dist = qDist[head]!;
      const f = this.flags[fi]!;
      if (cb(f, hop, dist)) return;
      for (let d = 0; d < DIRS; d++) {
        const ri = f.road[d]!;
        if (ri < 0) continue;
        const r = this.roads[ri]!;
        if (carriedOnly && !this.hasCarrier(r)) continue;
        const ni = r.flag[0] === fi ? r.flag[1] : r.flag[0];
        const n = this.flags[ni]!;
        if (n.searchNum === this.searchId) continue;
        n.searchNum = this.searchId;
        qFlag.push(ni);
        qHop.push(hop === Dir.None ? (d as Dir) : hop);
        // the walker goes from ni to fi: leaving end (ni === flag[0] ? 0 : 1)
        qDist.push(dist + r.ticks[ni === r.flag[0] ? 0 : 1]);
      }
    }
  }

  private hasCarrier(r: Road): boolean {
    for (const ti of r.carriers) {
      if (this.transporters[ti]!.state !== TState.Arriving) return true;
    }
    return false;
  }

  // ---- main step -------------------------------------------------------

  /**
   * One real step; sim time advances by `speed`. Order is part of the design:
   * flags decide, buildings produce, transporters move.
   */
  update(): void {
    this.tick = (this.tick + this.speed) & 0xffff;
    this.hireFailed = false;
    this.builderFailed = false;
    this.objects?.grow(this.speed);
    this.objects?.fadeSigns(this.speed);
    for (const f of this.flags) if (!f.removed) this.updateFlag(f);
    for (const b of this.buildings) this.updateBuilding(b);
    for (const t of this.transporters) if (!t.gone) this.updateTransporter(t);
    this.updateHomebound(this.speed);
    if (this.geologists.length > 0) this.updateGeologists(this.speed);
  }

  private updateHomebound(delta: number): void {
    if (this.homebound.length === 0) return;
    const stay: [number, number, number, number][] = [];
    for (const h of this.homebound) {
      h[1] -= delta;
      if (h[1] >= 0) stay.push(h);
      else this.buildings[h[0]]!.carriers++;
    }
    this.homebound = stay;
  }

  /**
   * A spare carrier (the road has another) that has stood idle for a long
   * while leaves the road and walks to the nearest storage; he can be hired
   * again from there. A road keeps at least one.
   */
  private maybeRelease(t: Transporter, r: Road, delta: number): void {
    if (!this.settlers || !r.dynamic || r.carriers.length < 2 || t.item.type !== Res.None) {
      t.idle = 0;
      return;
    }
    t.idle += delta;
    if (t.idle < IDLE_RELEASE) return;
    for (let e = 0; e < 2; e++) {
      if (this.pickupsWaiting(this.flags[r.flag[e]!]!, r.dirAt[e]!) > 0) {
        t.idle = 0;
        return;
      }
    }
    let storage = -1;
    let dist = 0;
    this.search(r.flag[t.at]!, false, (fl, _hop, d) => {
      if (fl.building < 0 || !acceptsAll(this.buildings[fl.building]!)) return false;
      storage = fl.building;
      dist = d;
      return true;
    });
    if (storage < 0) {
      t.idle = 0; // no way home; stay
      return;
    }
    r.carriers = r.carriers.filter((ti) => this.transporters[ti] !== t);
    t.gone = true;
    this.homebound.push([storage, dist, r.flag[t.at]!, dist]);
  }

  // ---- flags -----------------------------------------------------------

  private updateFlag(f: Flag): void {
    for (const it of f.slot) {
      if (it.type === Res.None || it.dir !== Dir.None) continue;
      if (it.dest < 0) this.assignDestination(f, it);
      if (it.dest >= 0) this.route(f, it);
    }
    this.updateHiring(f);
  }

  /**
   * Roads call for carriers: one if the road has none, another when items pile
   * up at this end and the road is below its cap. One request per road at a
   * time; the carrier walks from the nearest storage that has one.
   */
  private updateHiring(f: Flag): void {
    if (this.hireFailed) return;
    for (let d = 0; d < DIRS; d++) {
      const ri = f.road[d]!;
      if (ri < 0) continue;
      const r = this.roads[ri]!;
      if (!r.dynamic) continue;
      let arriving = false;
      for (const ti of r.carriers) {
        if (this.transporters[ti]!.state === TState.Arriving) arriving = true;
      }
      if (arriving) continue;
      const have = r.carriers.length;
      const need =
        have === 0 ||
        (have < Game.maxCarriers(r.length) &&
          this.pickupsWaiting(f, d as Dir) >= HIRE_WAITING);
      if (!need) continue;
      if (!this.hire(r, r.flag[0] === f.index ? 0 : 1)) {
        this.hireFailed = true;
        return;
      }
    }
  }

  private hire(r: Road, end: number): boolean {
    let storage = -1;
    let dist = 0;
    this.search(r.flag[end]!, false, (fl, _hop, d) => {
      if (fl.building < 0) return false;
      const b = this.buildings[fl.building]!;
      if (!acceptsAll(b) || b.carriers <= 0) return false;
      storage = fl.building;
      dist = d;
      return true;
    });
    if (storage < 0) return false;
    this.buildings[storage]!.carriers--;
    this.hired++;
    r.carriers.push(this.transporters.length);
    this.transporters.push({
      road: r.index,
      at: end,
      state: TState.Arriving,
      item: emptyItem(),
      counter: dist,
      tick: this.tick,
      carriedTotal: 0,
      gone: false,
      idle: 0,
    });
    return true;
  }

  /** Pick where an unrouted item goes: the building that wants it most, else the nearest storage. */
  private assignDestination(f: Flag, it: Item): void {
    let best = -1;
    let bestPrio = 0;
    this.search(f.index, true, (fl, hop) => {
      if (hop === Dir.None || fl.building < 0) return false;
      const p = priority(this.buildings[fl.building]!, it.type);
      if (p > bestPrio) {
        bestPrio = p;
        best = fl.index;
      }
      return bestPrio > EARLY_EXIT_PRIO;
    });
    if (best >= 0) {
      this.buildings[this.flags[best]!.building]!.requested[it.type]!++;
      it.dest = best;
      return;
    }
    this.search(f.index, true, (fl, hop) => {
      if (hop === Dir.None || fl.building < 0) return false;
      if (!this.storeWants(this.buildings[fl.building]!, it.type)) return false;
      best = fl.index;
      return true;
    });
    if (best >= 0) {
      it.dest = best;
      const store = this.buildings[this.flags[best]!.building]!;
      if (store.capacity > 0) store.incoming[it.type]!++;
    }
  }

  /** Choose the first hop towards a known destination. */
  private route(f: Flag, it: Item): void {
    let found = Dir.None;
    this.search(f.index, true, (fl, hop) => {
      if (hop !== Dir.None && fl.index === it.dest) {
        found = hop;
        return true;
      }
      return false;
    });
    if (found !== Dir.None) it.dir = found;
    else this.cancel(it);
  }

  private cancel(it: Item): void {
    this.releaseRequest(it);
    it.dest = -1;
  }

  /** An item that was heading for a building will not arrive: give back what it had reserved there. */
  private releaseRequest(it: Item): void {
    if (it.dest < 0) return;
    const d = this.flags[it.dest]!;
    if (d.building < 0) return;
    const b = this.buildings[d.building]!;
    if (!acceptsAll(b)) b.requested[it.type]!--;
    else if (b.capacity > 0 && b.incoming[it.type]! > 0) b.incoming[it.type]!--;
  }

  /** Keeps the item's destination so requests stay accounted for. */
  private dropIntoFlag(f: Flag, item: Item): boolean {
    for (let i = 0; i < f.slot.length; i++) {
      if (f.slot[i]!.type === Res.None) {
        f.slot[i] = { ...item, dir: Dir.None };
        return true;
      }
    }
    return false;
  }

  private deliver(f: Flag, r: Res): void {
    if (f.building < 0) throw new Error('delivery to flag without building');
    const b = this.buildings[f.building]!;
    if (!acceptsAll(b)) b.requested[r]!--;
    else if (b.capacity > 0 && b.incoming[r]! > 0) b.incoming[r]!--;
    b.stock[r]!++;
  }

  // ---- buildings -------------------------------------------------------

  private updateBuilding(b: Building): void {
    if (b.removed) return;
    const delta = (this.tick - b.tick) & 0xffff;
    b.tick = this.tick;
    if (b.burning > 0) {
      b.burning -= delta;
      if (b.burning <= 0) this.burnOut(b);
      return;
    }
    if (b.constructing) {
      this.updateConstruction(b, delta);
      return;
    }
    if (b.state === BState.Arriving) {
      this.updateArrival(b, delta);
      return;
    }
    const planter = b.type === BuildingType.Forester;
    if (planter && !this.objects) return; // nothing to plant on
    if (isStore(b)) {
      this.updateStorage(b, delta);
      return;
    }

    const kind = this.objects ? harvestKindOf(b.type) : MapObject.None;
    if (kind !== MapObject.None && (b.state === BState.Idle || b.state === BState.NoResource)) {
      this.startHarvest(b, delta, kind);
      return;
    }

    if (planter && (b.state === BState.Idle || b.state === BState.NoResource)) {
      this.startPlanting(b, delta);
      return;
    }

    const farming = !!this.objects && b.type === BuildingType.Farm;
    if (farming && (b.state === BState.Idle || b.state === BState.NoResource)) {
      this.startFarming(b, delta);
      return;
    }

    // A mine digs the ore under the rock around it; with none left it stops for good.
    const oreKind = this.objects ? oreKindOf(b.type) : OreKind.None;
    const mining = oreKind !== OreKind.None;
    const origin = b.pos >= 0 ? b.pos : this.flags[b.flag]!.pos;
    if (mining && (b.state === BState.Idle || b.state === BState.NoResource)) {
      if (this.objects!.nearestOre(origin, oreKind, ORE_RADIUS) < 0) {
        b.state = BState.NoResource;
        return;
      }
      b.state = BState.Idle;
    }

    if (b.state === BState.Idle) {
      if (b.type === BuildingType.Toolmaker) {
        const kind = this.chooseTool();
        if (kind === Res.None) return; // every slider is at 0
        b.out = kind;
      }
      if (b.inGroups.length > 0) {
        // one unit from each group, or wait until every group has one
        const picks: Res[] = [];
        for (const group of b.inGroups) {
          const r = group.find((x) => b.stock[x]! > 0);
          if (r === undefined) return;
          picks.push(r);
        }
        for (const r of picks) {
          b.stock[r]!--;
          this.consumed[r]!++;
        }
      }
      if (mining) this.digOre(this.objects!.nearestOre(origin, oreKind, ORE_RADIUS)); // dug now, stone when the work is done
      b.state = BState.Working;
      b.counter = b.period;
      return;
    }
    if (b.state === BState.Working) {
      b.counter -= delta;
      if (b.counter >= 0) return;
      if (planter) {
        this.finishPlanting(b);
        b.state = BState.Idle;
        return;
      }
      if (farming && !this.finishFarming(b)) {
        b.state = BState.Idle; // a field was sown: nothing to carry home
        return;
      }
      if (kind !== MapObject.None) this.finishHarvest(b, kind);
      this.created[b.out]!++;
      this.pendingOut[b.index] = 1;
      b.state = BState.OutputBlocked;
    }
    if (b.state === BState.OutputBlocked) {
      const out: Item = { type: b.out, dest: -1, dir: Dir.None };
      if (this.dropIntoFlag(this.flags[b.flag]!, out)) {
        this.pendingOut[b.index] = 0;
        b.state = BState.Idle;
      }
    }
  }

  // ---- harvesting ------------------------------------------------------

  /**
   * A harvester picks the nearest free tree or rock in range, claims it, walks
   * there, works, walks back and delivers. With nothing in range it looks again
   * every SCAN_TICKS.
   */
  private startHarvest(b: Building, delta: number, kind: MapObject): void {
    if (b.state === BState.NoResource) {
      b.counter -= delta;
      if (b.counter > 0) return;
    }
    const origin = b.pos >= 0 ? b.pos : this.flags[b.flag]!.pos;
    const target = this.findHarvestTarget(origin, kind);
    if (target < 0) {
      b.state = BState.NoResource;
      b.counter = SCAN_TICKS;
      return;
    }
    this.objects!.reservedBy[target] = b.index + 1;
    b.target = target;
    b.walkTicks = distanceBetween(this.cols, origin, target) * STEP_TICKS;
    b.workTotal = 2 * b.walkTicks + b.period;
    b.counter = b.workTotal;
    b.state = BState.Working;
  }

  /**
   * A forester picks a free spot of grass in range, claims it, walks there,
   * plants a sapling and walks back. With no room it looks again every SCAN_TICKS.
   */
  private startPlanting(b: Building, delta: number): void {
    if (b.state === BState.NoResource) {
      b.counter -= delta;
      if (b.counter > 0) return;
    }
    const origin = b.pos >= 0 ? b.pos : this.flags[b.flag]!.pos;
    const spots = this.plantableSpots(origin);
    if (spots.length === 0) {
      b.state = BState.NoResource;
      b.counter = SCAN_TICKS;
      return;
    }
    const target = spots[Math.floor(hash01(b.index, this.tick, 0x51) * spots.length)]!;
    this.objects!.reservedBy[target] = b.index + 1;
    b.target = target;
    b.walkTicks = distanceBetween(this.cols, origin, target) * STEP_TICKS;
    b.workTotal = 2 * b.walkTicks + b.period;
    b.counter = b.workTotal;
    b.state = BState.Working;
  }

  /**
   * A farmer cuts the nearest ripe field in reach; with none ripe he sows a new
   * one on free grass while there are fewer than MAX_FIELDS; otherwise he waits
   * and looks again every SCAN_TICKS.
   */
  private startFarming(b: Building, delta: number): void {
    if (b.state === BState.NoResource) {
      b.counter -= delta;
      if (b.counter > 0) return;
    }
    const o = this.objects!;
    const origin = b.pos >= 0 ? b.pos : this.flags[b.flag]!.pos;
    let target = this.findHarvestTarget(origin, MapObject.Wheat, FIELD_RADIUS);
    if (target < 0 && this.fieldsNear(origin) < MAX_FIELDS) {
      const spots = this.plantableSpots(origin, FIELD_RADIUS);
      if (spots.length > 0) target = spots[Math.floor(hash01(b.index, this.tick, 0x52) * spots.length)]!;
    }
    if (target < 0) {
      b.state = BState.NoResource;
      b.counter = SCAN_TICKS;
      return;
    }
    o.reservedBy[target] = b.index + 1;
    b.target = target;
    b.walkTicks = distanceBetween(this.cols, origin, target) * STEP_TICKS;
    b.workTotal = 2 * b.walkTicks + b.period;
    b.counter = b.workTotal;
    b.state = BState.Working;
  }

  /** One unit of ore comes out of the ground at `p`. */
  private digOre(p: number): void {
    const o = this.objects!;
    o.ore[p]!--;
    if (o.ore[p] === 0) o.oreKind[p] = OreKind.None;
  }

  /** Fields, growing or ripe, within reach of a farm at `origin`. */
  private fieldsNear(origin: number): number {
    const o = this.objects!;
    let n = 0;
    const ox = origin % this.cols;
    const oy = Math.floor(origin / this.cols);
    for (let dy = -FIELD_RADIUS; dy <= FIELD_RADIUS; dy++) {
      for (let dx = -FIELD_RADIUS; dx <= FIELD_RADIUS; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dx - dy)) > FIELD_RADIUS) continue;
        if (!this.inside(ox + dx, oy + dy)) continue;
        const k = o.kindAt(this.index(ox + dx, oy + dy));
        if (k === MapObject.Field || k === MapObject.Wheat) n++;
      }
    }
    return n;
  }

  /** The farmer's trip is over. True if he cut a ripe field (wheat to deliver); false if he sowed one. */
  private finishFarming(b: Building): boolean {
    const o = this.objects!;
    const p = b.target;
    let cut = false;
    if (p >= 0) {
      o.reservedBy[p] = 0;
      if (o.kindAt(p) === MapObject.Wheat) {
        o.remove(p);
        cut = true;
      } else if (this.canPlant(p)) o.plant(p, FIELD_TICKS, MapObject.Field);
    }
    b.target = -1;
    b.walkTicks = 0;
    b.workTotal = 0;
    return cut;
  }

  /** Grass in reach that nothing stands on or has claimed, in point order. */
  private plantableSpots(origin: number, radius = PLANT_RADIUS): number[] {
    const o = this.objects!;
    const ox = origin % this.cols;
    const oy = Math.floor(origin / this.cols);
    const out: number[] = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = ox + dx;
        const y = oy + dy;
        if (!this.inside(x, y)) continue;
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dx - dy)) > radius) continue;
        const p = this.index(x, y);
        if (o.reservedBy[p] === 0 && this.canPlant(p)) out.push(p);
      }
    }
    return out;
  }

  /** Free grass: no object, flag, road or building. */
  private canPlant(p: number): boolean {
    return (
      this.terrain.kindAt(p) === Terrain.Grass &&
      this.objects!.kindAt(p) === MapObject.None &&
      !this.isOccupied(p)
    );
  }

  /** The trip is over: a sapling goes in, unless the spot was built on meanwhile. */
  private finishPlanting(b: Building): void {
    const o = this.objects!;
    const p = b.target;
    if (p >= 0) {
      o.reservedBy[p] = 0;
      if (this.canPlant(p)) o.plant(p);
    }
    b.target = -1;
    b.walkTicks = 0;
    b.workTotal = 0;
  }

  /** Nearest unclaimed object of `kind` within reach; ties go to the lower point. */
  private findHarvestTarget(origin: number, kind: MapObject, radius = HARVEST_RADIUS): number {
    const o = this.objects!;
    const ox = origin % this.cols;
    const oy = Math.floor(origin / this.cols);
    let best = -1;
    let bestDist = Infinity;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = ox + dx;
        const y = oy + dy;
        if (!this.inside(x, y)) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dx - dy));
        if (d > radius) continue;
        const p = this.index(x, y);
        if (o.kindAt(p) !== kind || o.reservedBy[p] !== 0) continue;
        if (d < bestDist || (d === bestDist && p < best)) {
          best = p;
          bestDist = d;
        }
      }
    }
    return best;
  }

  /** The trip is over: a tree is felled, or a rock loses one unit. */
  private finishHarvest(b: Building, kind: MapObject): void {
    const o = this.objects!;
    const p = b.target;
    if (p >= 0 && o.kindAt(p) === kind) {
      const left = kind === MapObject.Tree ? 0 : o.amountAt(p) - 1;
      if (left <= 0) o.remove(p);
      else {
        o.amount[p] = left;
        o.reservedBy[p] = 0;
      }
    }
    b.target = -1;
    b.walkTicks = 0;
    b.workTotal = 0;
  }

  // ---- construction ----------------------------------------------------

  /**
   * A builder walks over from a storage, then turns each delivered material
   * into progress, one unit at a time. Committing a unit moves it from stock
   * to `used`, so the site never over-orders.
   */
  private updateConstruction(b: Building, delta: number): void {
    if (b.builder === BuilderState.None) {
      if (!this.builderFailed && !this.hireBuilder(b)) this.builderFailed = true;
      return;
    }
    if (b.builder === BuilderState.Walking) {
      b.builderCounter -= delta;
      if (b.builderCounter >= 0) return;
      b.builder = BuilderState.Working;
    }
    if (b.unitRes !== Res.None) {
      b.unitCounter -= delta;
      if (b.unitCounter >= 0) return;
      b.unitRes = Res.None;
    }
    let complete = true;
    for (let r = 0; r < RES_COUNT; r++) {
      if (b.used[r]! < b.need[r]!) complete = false;
    }
    if (complete) {
      this.finishConstruction(b);
      return;
    }
    for (let r = 0; r < RES_COUNT; r++) {
      if (b.stock[r]! > 0 && b.used[r]! < b.need[r]!) {
        b.stock[r]!--;
        b.used[r]!++;
        this.consumed[r]!++;
        b.unitRes = r as Res;
        b.unitCounter = BUILD_UNIT_TICKS;
        return;
      }
    }
  }

  private finishConstruction(b: Building): void {
    b.constructing = false;
    initOperation(b);
    this.applyLimit(b);
    this.applyFood(b);
    b.state = BState.Idle;
    if (b.builderHome >= 0) this.buildings[b.builderHome]!.builders++; // walks home
    b.builder = BuilderState.None;
    b.builderHome = -1;
    if ((this.settlers || this.tools) && !isStore(b)) {
      b.state = BState.Arriving; // builderHome is free again: it holds the worker's storage
      b.counter = 0;
    }
  }

  /** The worker walks from the nearest storage by road; with no way there, he waits. */
  private updateArrival(b: Building, delta: number): void {
    if (b.builderHome < 0) {
      let storage = -1;
      let dist = 0;
      const tool = toolFor(b.type);
      const needTool = this.tools && tool !== Res.None && !b.hasTool;
      this.search(b.flag, false, (fl, _hop, d) => {
        if (fl.building < 0) return false;
        const s = this.buildings[fl.building]!;
        if (!acceptsAll(s) || (needTool && s.stock[tool]! <= 0)) return false;
        storage = fl.building;
        dist = d;
        return true;
      });
      if (storage < 0) return;
      if (needTool) {
        this.buildings[storage]!.stock[tool]!--;
        b.hasTool = true;
      }
      b.builderHome = storage;
      b.counter = dist;
      b.walkTicks = dist; // the whole walk, for drawing it
      return;
    }
    b.counter -= delta;
    if (b.counter >= 0) return;
    b.builderHome = -1;
    b.state = BState.Idle;
  }

  /**
   * The flags a walker passes going from flag `from` to flag `to` by road, the
   * quickest way (inclusive of both), or null if there is none. For drawing.
   */
  walkRoute(from: number, to: number): number[] | null {
    const n = this.flags.length;
    const best = new Array<number>(n).fill(Infinity);
    const prev = new Array<number>(n).fill(-1);
    const done = new Array<boolean>(n).fill(false);
    best[from] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && best[i]! < Infinity && (u < 0 || best[i]! < best[u]!)) u = i;
      if (u < 0) return null;
      if (u === to) break;
      done[u] = true;
      const f = this.flags[u]!;
      for (let d = 0; d < DIRS; d++) {
        const ri = f.road[d]!;
        if (ri < 0) continue;
        const r = this.roads[ri]!;
        if (r.removed) continue;
        const end = r.flag[0] === u ? 0 : 1;
        const v = r.flag[1 - end]!;
        const c = best[u]! + r.ticks[end]!;
        if (c < best[v]!) {
          best[v] = c;
          prev[v] = u;
        }
      }
    }
    const route = [to];
    while (route[0] !== from) route.unshift(prev[route[0]!]!);
    return route;
  }

  private hireBuilder(b: Building): boolean {
    let storage = -1;
    let dist = 0;
    this.search(b.flag, false, (fl, _hop, d) => {
      if (fl.building < 0) return false;
      const s = this.buildings[fl.building]!;
      if (!acceptsAll(s) || s.builders <= 0) return false;
      storage = fl.building;
      dist = d;
      return true;
    });
    if (storage < 0) return false;
    this.buildings[storage]!.builders--;
    b.builder = BuilderState.Walking;
    b.builderHome = storage;
    b.builderCounter = dist;
    b.walkTicks = dist; // the whole walk, for drawing it
    return true;
  }

  /**
   * Storage sends stock out to whoever wants it most, one item per resource
   * per period, so a finished plank can end up on a construction site.
   */
  private updateStorage(b: Building, delta: number): void {
    b.dispatchCounter -= delta;
    if (b.dispatchCounter >= 0) return;
    b.dispatchCounter = DISPATCH_PERIOD;
    const f = this.flags[b.flag]!;
    for (let r = 0; r < RES_COUNT; r++) {
      if (b.stock[r]! <= 0) continue;
      let best = -1;
      let bestPrio = 0;
      this.search(b.flag, true, (fl, hop) => {
        if (hop === Dir.None || fl.building < 0) return false;
        const p = priority(this.buildings[fl.building]!, r as Res);
        if (p > bestPrio) {
          bestPrio = p;
          best = fl.index;
        }
        return bestPrio > EARLY_EXIT_PRIO;
      });
      if (best < 0) continue;
      if (!this.dropIntoFlag(f, { type: r as Res, dest: best, dir: Dir.None })) return;
      b.stock[r]!--;
      this.dispatched[r]!++;
      this.buildings[this.flags[best]!.building]!.requested[r]!++;
    }
  }

  // ---- transporters ----------------------------------------------------

  private bestPickup(f: Flag, d: Dir): number {
    let best = -1;
    for (let i = 0; i < FLAG_SLOTS; i++) {
      const it = f.slot[i]!;
      if (it.type === Res.None || it.dir !== d) continue;
      if (best < 0 || FLAG_PRIO[it.type]! > FLAG_PRIO[f.slot[best]!.type]!) best = i;
    }
    return best;
  }

  pickupsWaiting(f: Flag, d: Dir): number {
    let n = 0;
    for (const it of f.slot) if (it.type !== Res.None && it.dir === d) n++;
    return n;
  }

  /** Empty carriers (other than `self`) that already serve flag end `end`: standing there, or walking towards it. */
  private covering(r: Road, end: number, self: Transporter): number {
    let n = 0;
    for (const ti of r.carriers) {
      const o = this.transporters[ti]!;
      if (o === self || o.item.type !== Res.None) continue;
      const serves = o.state === TState.Walking ? 1 - o.at === end : o.at === end;
      if (serves) n++;
    }
    return n;
  }

  /**
   * What a transporter does when it stands at a flag. Returns true if it now
   * carries an item that must walk along its own road.
   */
  private handleFlag(t: Transporter, f: Flag, d: Dir): boolean {
    if (t.item.type !== Res.None && t.item.dest === f.index) {
      this.deliver(f, t.item.type);
      t.item = emptyItem();
    }
    const ps = this.bestPickup(f, d);
    if (t.item.type !== Res.None) {
      if (ps >= 0) {
        // swap in place: leave ours, take theirs
        const leave: Item = { ...t.item, dir: Dir.None };
        t.item = { ...f.slot[ps]!, dir: d };
        f.slot[ps] = leave;
        t.carriedTotal++;
        return true;
      }
      if (this.dropIntoFlag(f, t.item)) t.item = emptyItem();
      return false; // flag full: keep holding and retry next step
    }
    if (ps >= 0) {
      t.item = { ...f.slot[ps]!, dir: d };
      f.slot[ps] = emptyItem();
      t.carriedTotal++;
      return true;
    }
    return false;
  }

  private updateTransporter(t: Transporter): void {
    const r = this.roads[t.road]!;
    const delta = (this.tick - t.tick) & 0xffff;
    t.tick = this.tick;
    let carry = 0;
    if (t.state !== TState.Idle) {
      t.counter -= delta;
      if (t.counter >= 0) return;
      carry = t.counter; // leftover time carries into the next walk
      if (t.state === TState.Walking) t.at = 1 - t.at;
      t.state = TState.Idle;
      t.counter = 0;
    }
    const f = this.flags[r.flag[t.at]!]!;
    let go = this.handleFlag(t, f, r.dirAt[t.at]!);
    if (!go && t.item.type === Res.None) {
      // fetch from the far end, unless enough carriers already cover it
      const far = 1 - t.at;
      go =
        this.pickupsWaiting(this.flags[r.flag[far]!]!, r.dirAt[far]!) >
        this.covering(r, far, t);
    }
    if (go) {
      t.state = TState.Walking;
      t.counter = carry + r.ticks[t.at]!;
      t.idle = 0;
    } else this.maybeRelease(t, r, delta);
  }

  // ---- saving ----------------------------------------------------------

  /**
   * The whole game as plain data (JSON-safe). Restoring it and running on gives
   * exactly what the original would have done.
   */
  serialize(): SaveData {
    const o = this.objects;
    return structuredClone({
      version: SAVE_VERSION,
      cols: this.cols,
      rows: this.rows,
      tick: this.tick,
      speed: this.speed,
      layoutVersion: this.layoutVersion,
      searchId: this.searchId,
      hired: this.hired,
      created: this.created,
      consumed: this.consumed,
      dispatched: this.dispatched,
      lost: this.lost,
      limits: this.limits,
      settlers: this.settlers,
      foodShare: this.foodShare,
      tools: this.tools,
      toolShare: this.toolShare,
      geologists: this.geologists,
      nextGeologist: this.nextGeologist,
      flags: this.flags,
      roads: this.roads,
      buildings: this.buildings,
      transporters: this.transporters,
      pendingOut: this.pendingOut,
      homebound: this.homebound,
      heights: toBase64(this.terrain.height),
      objects: o && {
        kind: toBase64(o.kind),
        amount: toBase64(o.amount),
        reservedBy: sparse(o.reservedBy),
        growth: sparse(o.growth),
        ore: toBase64(o.ore),
        oreKind: toBase64(o.oreKind),
        sign: sparse(o.sign),
        signLeft: sparse(o.signLeft),
      },
    });
  }

  /** Rebuild a game from `serialize()` output. Throws on data that does not fit together. */
  static restore(data: SaveData): Game {
    const d = structuredClone(data);
    if (d.version !== SAVE_VERSION) throw new Error(`save: version ${d.version} is not supported`);
    const n = d.cols * d.rows;
    if (!Number.isInteger(d.cols) || !Number.isInteger(d.rows) || d.cols < 1 || d.rows < 1) throw new Error('save: bad size');
    const terrain = new TerrainMap(d.cols, d.rows, fromBase64(d.heights, n));
    let objects: MapObjects | undefined;
    if (d.objects) {
      objects = new MapObjects(d.cols, d.rows);
      objects.kind.set(fromBase64(d.objects.kind, n));
      objects.amount.set(fromBase64(d.objects.amount, n));
      unsparse(objects.reservedBy, d.objects.reservedBy);
      unsparse(objects.growth, d.objects.growth);
      if (d.objects.ore) objects.ore.set(fromBase64(d.objects.ore, n));
      if (d.objects.oreKind) objects.oreKind.set(fromBase64(d.objects.oreKind, n));
      else for (let p = 0; p < n; p++) if (objects.ore[p]! > 0) objects.oreKind[p] = OreKind.Stone; // before there were kinds
      objects.rebuildGrowing();
      if (d.objects.sign) unsparse(objects.sign, d.objects.sign);
      if (d.objects.signLeft) unsparse(objects.signLeft, d.objects.signLeft);
      objects.rebuildSigns();
    }
    const g = new Game(d.cols, d.rows, terrain, objects);
    g.tick = d.tick;
    g.speed = d.speed;
    g.layoutVersion = d.layoutVersion;
    g.searchId = d.searchId;
    g.hired = d.hired;
    g.created = padRes(d.created);
    g.consumed = padRes(d.consumed);
    g.dispatched = padRes(d.dispatched);
    g.lost = padRes(d.lost);
    g.limits = d.limits;
    g.settlers = d.settlers ?? false;
    if (d.foodShare) g.foodShare = d.foodShare.slice();
    g.tools = d.tools ?? false;
    if (d.toolShare) g.toolShare = TOOL_KINDS.map((_, i) => d.toolShare![i] ?? 5); // saves from before a tool existed ask 5 for it
    g.geologists = d.geologists ?? [];
    g.nextGeologist = d.nextGeologist ?? g.geologists.length;
    g.flags = d.flags;
    g.roads = d.roads;
    g.buildings = d.buildings;
    for (const b of g.buildings) {
      for (const key of ['stock', 'requested', 'incoming', 'need', 'used'] as const) b[key] = padRes(b[key]);
      b.foodWeight ??= FOOD_MAX;
      b.hasTool ??= false;
    }
    g.transporters = d.transporters;
    g.pendingOut = d.pendingOut;
    g.homebound = (d.homebound ?? []).map((h) => [h[0]!, h[1]!, h[2] ?? -1, h[3] ?? 0]);
    for (const t of g.transporters) t.idle ??= 0;
    g.rebuildLookups();
    return g;
  }

  /** Work out which flag, road and building stands on each point from the entity lists. */
  private rebuildLookups(): void {
    const bad = (what: string): never => {
      throw new Error(`save: ${what}`);
    };
    this.flagAt.fill(-1);
    this.roadAt.fill(-1);
    this.buildingAt.fill(-1);
    this.castleIndex = -1;
    for (const f of this.flags) {
      if (f.removed) continue;
      if (!(f.pos >= 0 && f.pos < this.flagAt.length)) bad('flag outside the map');
      this.flagAt[f.pos] = f.index;
    }
    for (const r of this.roads) {
      if (r.removed) continue;
      const a = this.flags[r.flag[0]];
      const b = this.flags[r.flag[1]];
      if (!a || !b || a.removed || b.removed) bad('road between missing flags');
      let p = a!.pos;
      for (let i = 0; i + 1 < r.dirs.length; i++) {
        p = this.move(p, r.dirs[i]!);
        if (p < 0) bad('road leaves the map');
        this.roadAt[p] = r.index;
      }
    }
    for (const b of this.buildings) {
      if (b.removed) continue;
      if (!this.flags[b.flag]) bad('building without a flag');
      if (b.pos >= 0) {
        for (const q of footprintOf(this, b.type, b.pos) ?? [b.pos]) this.buildingAt[q] = b.index;
      }
      if (b.type === BuildingType.Castle) this.castleIndex = b.index;
    }
    for (const t of this.transporters) {
      if (!t.gone && !this.roads[t.road]) bad('carrier on a missing road');
    }
  }

  // ---- demolition ------------------------------------------------------
  //
  // As in the original: nothing is refunded. Stock in a demolished building and
  // items on a removed flag or in a removed road's carriers are gone for good
  // (counted in `lost`); carriers whose road is removed go back to a storage.
  // Entities are never deleted from their arrays, only marked, so indices held
  // anywhere stay valid.

  /** An item destroyed: its request at the destination is cancelled, the unit counted lost. */
  private destroyItem(it: Item): void {
    if (it.type === Res.None) return;
    this.releaseRequest(it);
    this.lost[it.type]!++;
  }

  /** A carrier whose road went away is back in the nearest storage's crew (castle if none reachable). */
  private refundCarrier(near: number): void {
    let storage = -1;
    this.search(near, false, (fl) => {
      if (fl.building < 0) return false;
      if (!acceptsAll(this.buildings[fl.building]!)) return false;
      storage = fl.building;
      return true;
    });
    if (storage < 0 && this.castleIndex >= 0) storage = this.castleIndex;
    if (storage >= 0) this.buildings[storage]!.carriers++;
  }

  private dirsFrom(r: Road, flag: number): Dir[] {
    return r.flag[0] === flag ? r.dirs.slice() : r.dirs.slice().reverse().map(reverse);
  }

  /** Ticks to walk `dirs` starting at `from`, each way. */
  private pathTicks(from: number, dirs: Dir[]): [number, number] {
    let fwd = 0;
    let back = 0;
    let q = from;
    for (const d of dirs) {
      const next = this.move(q, d);
      const dh = this.terrain.heightAt(next) - this.terrain.heightAt(q);
      fwd += stepTicks(dh);
      back += stepTicks(-dh);
      q = next;
    }
    return [fwd, back];
  }

  /** Remove a whole road (between two flags). Its carriers lose what they carry and walk home. */
  demolishRoad(roadIndex: number): void {
    const r = this.roads[roadIndex];
    if (!r || r.removed) throw new Error('no such road');
    const [a, b] = r.flag;
    const fa = this.flags[a]!;
    const fb = this.flags[b]!;
    fa.road[r.dirAt[0]] = -1;
    fb.road[r.dirAt[1]] = -1;
    let q = fa.pos;
    for (let i = 0; i + 1 < r.dirs.length; i++) {
      q = this.move(q, r.dirs[i]!);
      this.roadAt[q] = -1;
    }
    r.removed = true;
    // items that were about to take this road must find another way
    for (const [fl, dir] of [[fa, r.dirAt[0]], [fb, r.dirAt[1]]] as const) {
      for (const it of fl.slot) if (it.type !== Res.None && it.dir === dir) it.dir = Dir.None;
    }
    const carriers = r.carriers;
    r.carriers = [];
    for (const ti of carriers) {
      const t = this.transporters[ti]!;
      this.destroyItem(t.item);
      t.item = emptyItem();
      t.gone = true;
    }
    for (const ti of carriers) this.refundCarrier(this.transporters[ti]!.at === 0 ? a : b);
    this.layoutVersion++;
  }

  /** Can this flag be removed? Free-standing, or in the middle of a plain road (the two halves merge). */
  checkDemolishFlag(flagIndex: number): Check {
    const f = this.flags[flagIndex];
    if (!f || f.removed) return { ok: false, reason: 'no such flag' };
    if (f.building >= 0) return { ok: false, reason: 'a building stands at this flag' };
    const roads = f.road.filter((i) => i >= 0);
    if (roads.length === 0) return { ok: true, reason: '' };
    if (roads.length === 1) return { ok: false, reason: 'remove its road first' };
    if (roads.length > 2) return { ok: false, reason: 'roads fork here: remove some first' };
    const other = (ri: number): number => {
      const r = this.roads[ri]!;
      return r.flag[0] === flagIndex ? r.flag[1] : r.flag[0];
    };
    if (other(roads[0]!) === other(roads[1]!)) {
      return { ok: false, reason: 'both roads lead to the same flag' };
    }
    return { ok: true, reason: '' };
  }

  /** Remove a flag. With two roads they merge into one; goods on the flag are lost. */
  demolishFlag(flagIndex: number): void {
    const check = this.checkDemolishFlag(flagIndex);
    if (!check.ok) throw new Error(check.reason);
    const f = this.flags[flagIndex]!;
    if (f.road.some((i) => i >= 0)) this.mergeAt(f);
    for (const it of f.slot) this.destroyItem(it);
    f.slot = f.slot.map(() => emptyItem());
    f.removed = true;
    this.flagAt[f.pos] = -1;
    this.layoutVersion++;
  }

  /**
   * The reverse of splitRoad. The road with the lower index survives and
   * runs through the flag's point; the other is removed. Carriers keep their
   * place along the way, with the time they have left rescaled; one standing at
   * the flag sets off along the merged road.
   */
  private mergeAt(f: Flag): void {
    const [lo, hi] = f.road.filter((i) => i >= 0).sort((x, y) => x - y) as [number, number];
    const first = this.roads[lo]!;
    const second = this.roads[hi]!;
    const X = first.flag[0] === f.index ? first.flag[1] : first.flag[0];
    const Y = second.flag[0] === f.index ? second.flag[1] : second.flag[0];
    const n1 = first.length;
    const N = n1 + second.length;
    const dirs2 = this.dirsFrom(second, f.index);
    const dirs = [...this.dirsFrom(first, X), ...dirs2];
    const ticks1 = first.ticks;
    const ticks2 = second.ticks;
    const rev1 = first.flag[0] !== X; // first's end 0 is the flag
    const rev2 = second.flag[0] !== f.index; // second's end 0 is Y
    const old1 = first.carriers;
    const old2 = second.carriers;

    first.flag = [X, Y];
    first.dirAt = [dirs[0]!, reverse(dirs[N - 1]!)];
    first.dirs = dirs;
    first.length = N;
    first.ticks = this.pathTicks(this.flags[X]!.pos, dirs);
    first.carriers = [];
    this.flags[X]!.road[first.dirAt[0]] = first.index;
    this.flags[Y]!.road[first.dirAt[1]] = first.index;
    second.removed = true;
    second.carriers = [];
    f.road.fill(-1);
    this.roadAt[f.pos] = first.index;
    let q = f.pos;
    for (let i = 0; i < dirs2.length - 1; i++) {
      q = this.move(q, dirs2[i]!);
      this.roadAt[q] = first.index;
    }

    const place = (list: number[], old: [number, number], len: number, base: number, rev: boolean, isFirst: boolean) => {
      for (const ti of list) {
        const t = this.transporters[ti]!;
        const m = rev ? 1 - t.at : t.at; // 0: the merged road's start side
        t.road = first.index;
        if (t.state === TState.Walking) {
          const progress = Math.min(1, Math.max(0, 1 - t.counter / old[t.at]!));
          const s = base + (m === 0 ? progress * len : (1 - progress) * len);
          t.at = m;
          t.counter = Math.round(first.ticks[m]! * (m === 0 ? 1 - s / N : s / N));
        } else if (isFirst ? m === 0 : m === 1) {
          t.at = m; // at one of the merged road's ends
        } else if (t.state === TState.Idle) {
          // standing at the removed flag: carry on along the merged road
          t.state = TState.Walking;
          t.at = isFirst ? 0 : 1;
          t.counter = Math.round(first.ticks[t.at]! * (isFirst ? 1 - n1 / N : n1 / N));
        } else {
          t.at = n1 * 2 <= N ? 0 : 1; // still on its way to the job
        }
        first.carriers.push(ti);
      }
    };
    place(old1, ticks1, n1, 0, rev1, true);
    place(old2, ticks2, second.length, n1, rev2, false);
  }

  /** Can this building be demolished? The castle cannot. */
  checkDemolishBuilding(index: number): Check {
    const b = this.buildings[index];
    if (!b || b.removed) return { ok: false, reason: 'no such building' };
    if (b.type === BuildingType.Castle) return { ok: false, reason: 'the castle cannot be demolished' };
    if (b.burning > 0) return { ok: false, reason: 'already burning' };
    return { ok: true, reason: '' };
  }

  /**
   * Set a building on fire: stock and the output waiting to leave are lost,
   * goods on their way to it are re-routed, the builder walks home, and the
   * door flag and its roads stay. The ground is blocked until it has burnt out.
   */
  demolishBuilding(index: number): void {
    const check = this.checkDemolishBuilding(index);
    if (!check.ok) throw new Error(check.reason);
    const b = this.buildings[index]!;
    const f = this.flags[b.flag]!;
    this.releaseTool(b); // before the door flag loses its building: the search starts there
    f.building = -1;
    for (let r = 0; r < RES_COUNT; r++) {
      this.lost[r]! += b.stock[r]!;
      b.stock[r] = 0;
      b.requested[r] = 0;
    }
    if (this.pendingOut[index]) {
      this.lost[b.out]!++;
      this.pendingOut[index] = 0;
    }
    if (b.constructing && b.builder !== BuilderState.None && b.builderHome >= 0) {
      this.buildings[b.builderHome]!.builders++;
    }
    b.builder = BuilderState.None;
    b.builderHome = -1;
    if (b.target >= 0 && this.objects) this.objects.reservedBy[b.target] = 0;
    b.target = -1;
    b.carriers = 0;
    b.builders = 0;
    // goods heading for this door find a new home
    for (const fl of this.flags) {
      for (const it of fl.slot) {
        if (it.type !== Res.None && it.dest === f.index) {
          it.dest = -1;
          it.dir = Dir.None;
        }
      }
    }
    for (const t of this.transporters) {
      if (t.item.type !== Res.None && t.item.dest === f.index) t.item.dest = -1;
    }
    b.state = BState.Idle;
    b.burning = BURN_TICKS;
    b.tick = this.tick;
    this.layoutVersion++;
  }

  private burnOut(b: Building): void {
    b.burning = 0;
    b.removed = true;
    if (b.pos >= 0) {
      for (const q of footprintOf(this, b.type, b.pos) ?? [b.pos]) {
        if (this.buildingAt[q] === b.index) this.buildingAt[q] = -1;
      }
    }
    this.layoutVersion++;
  }

  // ---- introspection ---------------------------------------------------

  /** Items of type r everywhere: flags, carried, stock, finished output. */
  countItems(r: Res): number {
    let n = 0;
    for (const f of this.flags) for (const it of f.slot) if (it.type === r) n++;
    for (const t of this.transporters) if (t.item.type === r) n++;
    for (const b of this.buildings) {
      n += b.stock[r]!;
      if (this.pendingOut[b.index] && b.out === r) n++;
      if (b.hasTool && toolFor(b.type) === r) n++; // in a worker's hands
    }
    if (r === Res.Hammer) for (const geo of this.geologists) if (geo.hasTool) n++;
    return n;
  }

  /** Output item waiting for a free flag slot (a building is blocked on it). */
  hasPendingOut(building: number): boolean {
    return this.pendingOut[building] !== 0;
  }

  /**
   * FNV-1a over all simulation state: two implementations that agree on this
   * hash after N steps agree on everything that matters.
   */
  fingerprint(): number {
    let h = 2166136261 >>> 0;
    const mix = (v: number): void => {
      const u = v >>> 0;
      for (let k = 0; k < 4; k++) {
        h ^= (u >>> (8 * k)) & 0xff;
        h = Math.imul(h, 16777619) >>> 0;
      }
    };
    mix(this.tick);
    for (const f of this.flags) {
      mix(f.building);
      for (const it of f.slot) {
        mix(it.type);
        mix(it.dest);
        mix(it.dir);
      }
    }
    for (const r of this.roads) mix(r.carriers.length);
    for (const t of this.transporters) {
      mix(t.road);
      mix(t.at);
      mix(t.state);
      mix(t.item.type);
      mix(t.item.dest);
      mix(t.item.dir);
      mix(t.counter);
      mix(t.tick);
      mix(t.carriedTotal);
    }
    for (const b of this.buildings) {
      for (let r = 0; r < PARITY_RES; r++) {
        mix(b.stock[r]!);
        mix(b.requested[r]!);
        mix(b.used[r]!);
      }
      mix(b.carriers);
      mix(b.builders);
      mix(b.constructing ? 1 : 0);
      mix(b.builder);
      mix(b.builderHome);
      mix(b.builderCounter);
      mix(b.unitRes);
      mix(b.unitCounter);
      mix(b.dispatchCounter);
      mix(b.state);
      mix(b.counter);
      mix(b.tick);
      mix(this.pendingOut[b.index]!);
    }
    for (let r = 0; r < PARITY_RES; r++) {
      mix(this.created[r]!);
      mix(this.consumed[r]!);
      mix(this.dispatched[r]!);
    }
    mix(this.hired);
    return h >>> 0;
  }

  /** ASCII map: J lumberjack, F forester, W sawmill, S storage, C stonecutter, K castle (lowercase = under construction). */
  render(): string {
    const out = new Array<string>(this.cols * this.rows).fill(' ');
    for (let i = 0; i < out.length; i++) if (this.roadAt[i]! >= 0) out[i] = 'o';
    for (const f of this.flags) {
      if (f.removed) continue;
      let c = '+';
      if (f.building >= 0) {
        const b = this.buildings[f.building]!;
        c = GLYPH[b.type];
        if (b.constructing) c = c.toLowerCase();
      }
      out[f.pos] = c;
    }
    let s = '';
    for (let y = 0; y < this.rows; y++) {
      s += ' '.repeat(y); // skew shows hex layout
      for (let x = 0; x < this.cols; x++) s += out[this.index(x, y)] + ' ';
      s += '\n';
    }
    return s;
  }
}
