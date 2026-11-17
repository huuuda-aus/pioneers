// Plain data types and constants for the logistics simulation.
// Everything here is a number or a plain object, so a whole game state
// serialises with JSON.stringify.

/** `ownerAt` value for a point no one's military influence reaches. */
export const UNCLAIMED = 255;

// Directions on a skewed hex grid: Down = (x, y+1), DownRight = (x+1, y+1).
export enum Dir { None = -1, Right, DownRight, Down, Left, UpLeft, Up }
export const DIRS = 6;
export const reverse = (d: Dir): Dir => ((d + 3) % DIRS) as Dir;

export enum Res { None = -1, Lumber, Plank, Stone, Fish, Wheat, Flour, Water, Bread, Coal, IronOre, GoldOre, Iron, Gold, Axe, Pick, Shovel, Rod, Scythe, Saw, Hammer, Cleaver, Pig, Meat, Sword, Shield }
export const RES_COUNT = 25;
/** The resources the C++ reference models; the parity fingerprint covers only these. */
export const PARITY_RES = 3;
export const RES_NAMES = ['lumber', 'plank', 'stone', 'fish', 'wheat', 'flour', 'water', 'bread', 'coal', 'iron ore', 'gold ore', 'iron', 'gold', 'axe', 'pick', 'shovel', 'rod', 'scythe', 'saw', 'hammer', 'cleaver', 'pig', 'meat', 'sword', 'shield'] as const;
export const FLAG_PRIO = [1, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]; // pickup priority per resource
/** What a mine will eat: any one of these counts as a unit of food. */
export const FOOD: readonly Res[] = [Res.Fish, Res.Bread, Res.Meat];
/** Top of a mine's food share (0 = it gets none). */
export const FOOD_MAX = 10;

/** The tools a toolmaker makes, one kind per trade. */
export const TOOL_KINDS: readonly Res[] = [Res.Axe, Res.Pick, Res.Shovel, Res.Rod, Res.Scythe, Res.Saw, Res.Hammer, Res.Cleaver];
export const isTool = (r: Res): boolean => r >= Res.Axe && r <= Res.Cleaver;
/** Top of a toolmaker slider (0 = never make that tool). */
export const TOOL_MAX = 10;

export const FLAG_SLOTS = 8;
export const STEP_TICKS = 80; // sim-ticks to walk one road tile on level ground
// Slope: a step that climbs dh height units takes STEP_TICKS + SLOPE_TICKS * dh
// (descending, dh < 0, is quicker), kept between the two limits. Placeholders.
export const SLOPE_TICKS = 12;
export const MIN_STEP_TICKS = 40;
export const MAX_STEP_TICKS = 160;
export const stepTicks = (dh: number): number =>
  Math.min(MAX_STEP_TICKS, Math.max(MIN_STEP_TICKS, STEP_TICKS + SLOPE_TICKS * dh));
export const EARLY_EXIT_PRIO = 204; // destination search stops above this
export const STORAGE_CARRIERS = 20; // carriers a new storage can send out
export const STORAGE_BUILDERS = 3; // builders a new storage can send out
// The castle is where the colony starts: the one building you never build, a
// storage with a much bigger crew. Placeholder numbers.
export const CASTLE_CARRIERS = 40;
export const CASTLE_BUILDERS = 5;
export const BUILD_UNIT_TICKS = 200; // builder time per delivered material
/**
 * How much of each resource a finished store will take, when a game turns
 * limits on (`Game.limits`). Placeholders; the default game has none.
 */
export interface StoreLimits {
  castle: number;
  storage: number;
}
export const DEFAULT_LIMITS: StoreLimits = { castle: 150, storage: 30 };
export const DISPATCH_PERIOD = 64; // storage sends stock out this often
export const BURN_TICKS = 2048; // a demolished building burns this long before the ground is free
export const IDLE_RELEASE = 1500; // a spare carrier idle this long walks back to a storage
export const HIRE_WAITING = 3; // items waiting at one end that call for help
// Carrier cap by road length: MAX_CARRIERS[min(7, floor(length / 2))].
// Placeholder values; tune for your game.
export const MAX_CARRIERS = [1, 2, 3, 4, 6, 8, 11, 15];

export interface Item {
  type: Res;
  dest: number; // flag index, -1 = not yet assigned
  dir: Dir; // first hop chosen for it
}

export const emptyItem = (): Item => ({ type: Res.None, dest: -1, dir: Dir.None });

export interface Flag {
  index: number;
  pos: number;
  slot: Item[]; // FLAG_SLOTS entries
  road: number[]; // road index per direction, -1 = none
  building: number; // -1 = none
  searchNum: number;
  removed: boolean; // demolished: the slot stays so indices never shift
  owner: number; // whose colony this flag belongs to, 0 by default
}

export interface Road {
  index: number;
  flag: [number, number];
  dirAt: [Dir, Dir]; // direction leaving each end flag
  dirs: Dir[]; // path from flag[0] to flag[1]
  length: number;
  /** Ticks to walk the whole road starting from end 0 / end 1 (they differ on slopes). */
  ticks: [number, number];
  carriers: number[]; // transporter indices on this road
  dynamic: boolean; // false: fixed carrier count, no hiring
  removed: boolean; // demolished or merged away: the slot stays so indices never shift
  owner: number; // same owner as the two flags it joins
}

export enum TState { Idle, Walking, Arriving }

export enum GeoPhase { Coming, Out, Probing, Home, Done }

export const MIN_GARRISON = 1; // a building never sends out its last knight
export const ATTACK_RANGE = 16; // steps from one of your garrisons to a target you may attack
export const FIGHT_TICKS = 300; // one duel

export const RANK_MAX = 4; // knight ranks 0..4, each twice as strong as the one below
export const TRAIN_TICKS = 1500; // a garrison tries to promote a knight this often
export const HOME_MORALE = 4096; // a knight's land factor on his own ground
/** Gold a garrison keeps for promotions and morale (freeserf's max_gold). */
export const GOLD_CAPACITY: Partial<Record<BuildingType, number>> = {};
export enum AttackPhase { Marching, Waiting, Fighting, Returning }

/** A knight sent against an enemy building: marches over the land, duels its defenders one at a time, then goes home (or occupies the building). */
export interface Attacker {
  id: number;
  owner: number;
  home: number; // the building he set out from
  target: number; // the building he is attacking
  phase: AttackPhase;
  from: number; // map point he set out from this leg
  to: number; // map point he is walking to this leg
  counter: number; // ticks left in this phase
  total: number; // length of this phase
  rank: number; // his rank
  defRank: number; // rank of the defender he is fighting, -1 when none
}

/** Something the player should hear about: an attack on, or a change of hands of, one of their buildings. */
export interface Alert {
  kind: 'attacked' | 'captured' | 'lost';
  owner: number; // who it concerns
  building: number;
}

/** A knight on his way to garrison a Hut, Tower or Fortress, from the storage that armed him. */
export interface Knight {
  id: number;
  home: number; // the storage he set out from
  building: number; // the building he is walking to
  counter: number; // ticks left on the road
  total: number; // the whole walk, for drawing it
}

/** A geologist on a trip: from a storage to a flag, then from spot to spot, probing each, then home. */
export interface Geologist {
  id: number;
  flag: number; // the flag he was sent to
  home: number; // the storage he came from (and goes back to)
  phase: GeoPhase;
  pos: number; // where he stands, or set out from
  target: number; // the spot he walks to or probes, -1 none
  counter: number; // ticks left in this phase
  total: number; // length of this phase
  probes: number; // spots he will still probe
  hasTool: boolean; // carries a hammer from the storage (game.tools)
}

export interface Transporter {
  road: number;
  at: number; // which end it stands at (or walks away from)
  state: TState; // Arriving: on the way to take the job
  item: Item; // carried item (dir = road direction it travels)
  counter: number;
  tick: number;
  carriedTotal: number;
  gone: boolean; // its road was demolished (or it was sent home); it left the road
  idle: number; // ticks standing at a flag with nothing to do (spare carriers are sent home)
}

export enum BuildingType {
  Lumberjack,
  Sawmill,
  Storage,
  Stonecutter,
  Castle,
  Forester,
  Fisher,
  Farm,
  Well,
  Mill,
  Baker,
  StoneMine,
  CoalMine,
  IronMine,
  GoldMine,
  IronSmelter,
  GoldSmelter,
  Toolmaker,
  PigFarm,
  Butcher,
  Hut,
  Tower,
  Fortress,
  Weaponsmith,
}

/** Knight slots a finished Hut/Tower/Fortress wants to fill; -1 for anything else. */
export const GARRISON_CAPACITY: Partial<Record<BuildingType, number>> = {
  [BuildingType.Hut]: 3,
  [BuildingType.Tower]: 6,
  [BuildingType.Fortress]: 12,
};
GOLD_CAPACITY[BuildingType.Hut] = 2;
GOLD_CAPACITY[BuildingType.Tower] = 4;
GOLD_CAPACITY[BuildingType.Fortress] = 8;
export const goldCapacityOf = (type: BuildingType): number => GOLD_CAPACITY[type] ?? 0;
export const garrisonCapacityOf = (type: BuildingType): number => GARRISON_CAPACITY[type] ?? -1;

/** The tool a worker of this building needs, or None (a store, a carrier, a well, a mill, a baker need none). */
export function toolFor(type: BuildingType): Res {
  switch (type) {
    case BuildingType.Lumberjack: return Res.Axe;
    case BuildingType.Stonecutter:
    case BuildingType.StoneMine:
    case BuildingType.CoalMine:
    case BuildingType.IronMine:
    case BuildingType.GoldMine: return Res.Pick;
    case BuildingType.Forester: return Res.Shovel;
    case BuildingType.Fisher: return Res.Rod;
    case BuildingType.Farm: return Res.Scythe;
    case BuildingType.Sawmill: return Res.Saw;
    case BuildingType.IronSmelter:
    case BuildingType.GoldSmelter:
    case BuildingType.Toolmaker: return Res.Hammer;
    case BuildingType.Butcher: return Res.Cleaver;
    case BuildingType.Weaponsmith: return Res.Hammer;
    default: return Res.None;
  }
}
/** NoResource: a harvester with nothing in range (only when the game has map objects). */
export enum BState { Idle, Working, OutputBlocked, NoResource, Arriving }
export enum BuilderState { None, Walking, Working }

export interface Building {
  index: number;
  type: BuildingType;
  flag: number;
  pos: number; // building point (up-left of its flag), -1 if off the map
  /**
   * What a producer consumes per cycle: one unit from each group, any member of
   * the group will do (a mine takes fish or bread). maxIn is how many of each
   * group it will stock.
   */
  inGroups: Res[][];
  out: Res;
  maxIn: number;
  /** With `game.tools`: the worker has been given his tool (`toolFor(type)`; it counts as an item of that kind while he holds it). */
  hasTool: boolean;
  /** Mines only: how much of the food on offer it gets, 0 to FOOD_MAX (the food slider). */
  foodWeight: number;
  period: number;
  stock: number[];
  requested: number[];
  capacity: number; // store only: most it takes of each resource, 0 = unlimited
  incoming: number[]; // store with a capacity: items on their way, counted against it
  carriers: number; // storage only: carriers it can still send out
  builders: number; // storage only: builders it can still send out

  // Construction: materials arrive as stock; the builder turns each unit into
  // progress. `used` counts units already committed to the structure.
  constructing: boolean;
  need: number[];
  used: number[];
  builder: BuilderState;
  builderHome: number; // storage the builder came from
  builderCounter: number;
  unitRes: Res; // material being worked in
  unitCounter: number;
  dispatchCounter: number; // storage only

  // Harvesters (lumberjack, stonecutter) on a map with objects: the tree or
  // rock they walk to, and the timing of the trip. Not part of the parity hash.
  target: number; // map point being harvested, -1 = none
  walkTicks: number; // one way
  workTotal: number; // whole trip: out, work, back

  state: BState;
  counter: number;
  tick: number;

  // Demolition: a demolished building burns for `burning` more ticks (it does
  // nothing, its ground stays blocked), then is `removed` for good.
  burning: number;
  removed: boolean;
  owner: number; // whose colony this building belongs to, 0 by default
  garrison: number; // Hut/Tower/Fortress only: knights currently inside
  veterans: number[]; // of them, how many are rank 1, 2, 3, 4 (the rest are rank 0)
  train: number; // ticks until the garrison next tries to promote a knight
}

/**
 * How strongly a building claims the land around it (0 = hut-grade, 1 =
 * tower-grade, 2 = fortress-grade), -1 for a building with no military
 * influence at all. Ported from freeserf's `mil_type` (game.cc,
 * update_land_ownership) — the castle always uses the fortress row, even
 * though it has no garrison of its own to manage (see `garrisonCapacityOf`).
 */
export function militaryStrength(b: Building): number {
  switch (b.type) {
    case BuildingType.Castle:
    case BuildingType.Fortress: return 2;
    case BuildingType.Tower: return 1;
    case BuildingType.Hut: return 0;
    default: return -1;
  }
}

/**
 * Does this building actually project territory right now? The castle
 * always does (it has influence but no garrison to wait for); a Hut, Tower
 * or Fortress only does once a knight has arrived — an empty one defends
 * nothing, same as freeserf's `is_done() && is_active()` check.
 */
export function isActiveMilitary(b: Building): boolean {
  if (militaryStrength(b) < 0) return false;
  const cap = garrisonCapacityOf(b.type);
  return cap < 0 || b.garrison > 0;
}

/**
 * Storages and the castle hold stock and send it out; only they hand out
 * carriers and builders.
 */
export const isStore = (b: Building): boolean =>
  b.type === BuildingType.Storage || b.type === BuildingType.Castle;

/** A finished store: takes any goods. A storage under construction does not yet. */
export const acceptsAll = (b: Building): boolean => isStore(b) && !b.constructing;

/** 0 = does not want it, 255 = needs it badly. */
export function priority(b: Building, r: Res): number {
  if (b.constructing) {
    const cap = b.need[r]! - b.used[r]!;
    if (cap <= 0) return 0;
    const total = b.stock[r]! + b.requested[r]!;
    if (total >= cap) return 0;
    return Math.floor((255 * (cap - total)) / cap);
  }
  if (isStore(b) || b.maxIn <= 0) return 0;
  const group = b.inGroups.find((g) => g.includes(r));
  if (!group) return 0;
  let total = 0;
  for (const x of group) total += b.stock[x]! + b.requested[x]!;
  if (total >= b.maxIn) return 0;
  const base = Math.floor((255 * (b.maxIn - total)) / b.maxIn);
  if (!FOOD.includes(r)) return base;
  // the food slider: a mine with a bigger share is served first, one with none is not served
  const w = b.foodWeight;
  return w >= FOOD_MAX ? base : w <= 0 ? 0 : Math.max(1, Math.floor((base * w) / FOOD_MAX));
}
