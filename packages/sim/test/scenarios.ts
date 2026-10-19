// Scenario builders shared by the parity test and the behaviour tests.
// scenarios here mirror logistics/parity.cc line for line: the same setup,
// the same step counts, the same result keys.

import { BuildingType, Dir, Game, Res, TState } from '../src/index.ts';

export type Hook = (g: Game, step: number) => void;

export function run(g: Game, steps: number, hook?: Hook): void {
  for (let i = 0; i < steps; i++) {
    g.update();
    hook?.(g, i);
  }
}

/** Flags every `seg` tiles along row y from x0 to x1, joined by roads. */
export function row(g: Game, x0: number, x1: number, y: number, seg: number, carriers = -1): number[] {
  const f: number[] = [];
  for (let x = x0; x <= x1; x += seg) f.push(g.addFlag(x, y));
  for (let i = 0; i + 1 < f.length; i++) {
    g.addRoad(f[i]!, new Array<Dir>(seg).fill(Dir.Right), carriers);
  }
  return f;
}

export interface ChainResult {
  lumber_made: number;
  planks_made: number;
  planks_stored: number;
  lumber_stored: number;
  hired: number;
  max_on_road: number;
  roads_with_none: number;
  dispatched_lumber: number;
  fingerprints: number[];
}

/** Two lumberjacks -> sawmill -> storage, flags every 2 tiles. */
export function chain(carriers: number, period: number, steps: number, hook?: Hook): ChainResult & { game: Game } {
  const h = new Game(16, 8);
  const a = row(h, 1, 9, 2, 2, carriers);
  const j2 = h.addFlag(5, 6);
  const mid = h.addFlag(5, 4);
  h.addRoad(j2, [Dir.Up, Dir.Up], carriers);
  h.addRoad(mid, [Dir.Up, Dir.Up], carriers);
  h.addBuilding(BuildingType.Lumberjack, a[0]!);
  h.addBuilding(BuildingType.Lumberjack, j2);
  const sawmill = h.addBuilding(BuildingType.Sawmill, a[2]!);
  const storage = h.addBuilding(BuildingType.Storage, a[4]!);
  h.buildings[sawmill]!.period = period;
  const fingerprints: number[] = [];
  const marks = [1, 100, 1000, 5000];
  let next = 0;
  for (let i = 1; i <= steps; i++) {
    h.update();
    hook?.(h, i);
    if (next < 4 && i === marks[next]) {
      fingerprints.push(h.fingerprint());
      next++;
    }
  }
  fingerprints.push(h.fingerprint());
  let maxOnRoad = 0;
  let none = 0;
  for (const r of h.roads) {
    if (r.carriers.length > maxOnRoad) maxOnRoad = r.carriers.length;
    if (r.carriers.length === 0) none++;
  }
  const s = h.buildings[storage]!;
  return {
    lumber_made: h.created[Res.Lumber]!,
    planks_made: h.created[Res.Plank]!,
    planks_stored: s.stock[Res.Plank]!,
    lumber_stored: s.stock[Res.Lumber]!,
    hired: h.hired,
    max_on_road: maxOnRoad,
    roads_with_none: none,
    dispatched_lumber: h.dispatched[Res.Lumber]!,
    fingerprints,
    game: h,
  };
}

export function lumberMade(seg: number, carriers: number, hook?: Hook) {
  const g = new Game(20, 4);
  const f = row(g, 1, 17, 1, seg, carriers);
  g.addBuilding(BuildingType.Lumberjack, f[0]!);
  g.addBuilding(BuildingType.Storage, f[f.length - 1]!);
  run(g, 15000, hook);
  return { lumber_made: g.created[Res.Lumber]!, fingerprint: g.fingerprint() };
}

export function longRoad(hook?: Hook) {
  const g = new Game(20, 4);
  const f = row(g, 1, 9, 1, 8);
  g.addBuilding(BuildingType.Lumberjack, f[0]!);
  g.addBuilding(BuildingType.Storage, f[f.length - 1]!);
  run(g, 15000, hook);
  return { lumber_made: g.created[Res.Lumber]!, carriers: g.roads[0]!.carriers.length, fingerprint: g.fingerprint() };
}

export function hiringCap(hook?: Hook) {
  const g = new Game(12, 4);
  const f = row(g, 1, 5, 1, 4);
  const jack = g.addBuilding(BuildingType.Lumberjack, f[0]!);
  g.addBuilding(BuildingType.Storage, f[f.length - 1]!);
  g.buildings[jack]!.period = 20;
  run(g, 6000, hook);
  return { carriers: g.roads[0]!.carriers.length, fingerprint: g.fingerprint() };
}

export function hiringDelay() {
  const g = new Game(12, 4);
  const f = row(g, 1, 5, 1, 4);
  g.addBuilding(BuildingType.Lumberjack, f[0]!);
  g.addBuilding(BuildingType.Storage, f[f.length - 1]!);
  g.update();
  const after1 = g.roads[0]!.carriers.length;
  const state1: TState = g.transporters[0]!.state;
  run(g, 150);
  const state151: TState = g.transporters[0]!.state;
  run(g, 20);
  return {
    after1,
    state1,
    state151,
    state171: g.transporters[0]!.state as TState,
    at: g.transporters[0]!.at,
    fingerprint: g.fingerprint(),
  };
}

export function poolExhausted(hook?: Hook) {
  const g = new Game(16, 4);
  const f = row(g, 1, 13, 1, 4);
  g.addBuilding(BuildingType.Lumberjack, f[0]!);
  const st = g.addBuilding(BuildingType.Storage, f[f.length - 1]!);
  g.buildings[st]!.carriers = 1;
  run(g, 4000, hook);
  return {
    hired: g.hired,
    pool: g.buildings[st]!.carriers,
    stored: g.buildings[st]!.stock[Res.Lumber]!,
    fingerprint: g.fingerprint(),
  };
}

/** Storage at the east end of a row of 2-tile roads. */
export class Colony {
  readonly g = new Game(16, 4);
  readonly f: number[];
  readonly storage: number;
  constructor() {
    this.f = row(this.g, 1, 9, 1, 2);
    this.storage = this.g.addBuilding(BuildingType.Storage, this.f[this.f.length - 1]!);
  }
}

export function siteBuilt(hook?: Hook) {
  const c = new Colony();
  const g = c.g;
  g.addStock(c.storage, Res.Plank, 10);
  const site = g.addBuilding(BuildingType.Lumberjack, c.f[0]!, true);
  let done = -1;
  for (let i = 0; i < 1500 && done < 0; i++) {
    g.update();
    hook?.(g, i);
    if (!g.buildings[site]!.constructing) done = i;
  }
  const fpDone = g.fingerprint();
  run(g, 4000, hook);
  return {
    done,
    lumber_after: g.created[Res.Lumber]!,
    planks_left: g.buildings[c.storage]!.stock[Res.Plank]!,
    builders_home: g.buildings[c.storage]!.builders,
    fp_done: fpDone,
    fingerprint: g.fingerprint(),
    game: g,
    site,
  };
}

export function siteWaits(hook?: Hook) {
  const c = new Colony();
  const g = c.g;
  g.addStock(c.storage, Res.Plank, 1);
  const site = g.addBuilding(BuildingType.Lumberjack, c.f[0]!, true);
  run(g, 3000, hook);
  const used = g.buildings[site]!.used[Res.Plank]!;
  const still = g.buildings[site]!.constructing;
  const requested = g.buildings[site]!.requested[Res.Plank]!;
  g.addStock(c.storage, Res.Plank, 1);
  run(g, 1500, hook);
  return {
    used_before: used,
    constructing_before: still ? 1 : 0,
    constructing_after: g.buildings[site]!.constructing ? 1 : 0,
    fingerprint: g.fingerprint(),
    requested_before: requested,
  };
}

export function builders(n: number, hook?: Hook) {
  const c = new Colony();
  const g = c.g;
  g.buildings[c.storage]!.builders = n;
  g.addStock(c.storage, Res.Plank, 10);
  const a = g.addBuilding(BuildingType.Lumberjack, c.f[0]!, true);
  const b = g.addBuilding(BuildingType.Stonecutter, c.f[2]!, true);
  let fa = -1;
  let fb = -1;
  for (let i = 0; i < 4000 && (fa < 0 || fb < 0); i++) {
    g.update();
    hook?.(g, i);
    if (fa < 0 && !g.buildings[a]!.constructing) fa = i;
    if (fb < 0 && !g.buildings[b]!.constructing) fb = i;
  }
  return { finish_a: fa, finish_b: fb, fingerprint: g.fingerprint() };
}

export function bootstrap(hook?: Hook) {
  const c = new Colony();
  const g = c.g;
  g.addStock(c.storage, Res.Plank, 4);
  g.addStock(c.storage, Res.Stone, 1);
  const jack = g.addBuilding(BuildingType.Lumberjack, c.f[0]!, true);
  const saw = g.addBuilding(BuildingType.Sawmill, c.f[2]!, true);
  let site2 = -1;
  let ordered = -1;
  let done = -1;
  for (let i = 0; i < 14000 && done < 0; i++) {
    g.update();
    hook?.(g, i);
    if (site2 < 0 && !g.buildings[jack]!.constructing && !g.buildings[saw]!.constructing && i > 3000) {
      site2 = g.addBuilding(BuildingType.Lumberjack, c.f[1]!, true);
      ordered = i;
    }
    if (site2 >= 0 && !g.buildings[site2]!.constructing) done = i;
  }
  return {
    ordered,
    done,
    planks_made: g.created[Res.Plank]!,
    stone_created: g.created[Res.Stone]!,
    fingerprint: g.fingerprint(),
    game: g,
    storage: c.storage,
  };
}

export function stoneSupply(hook?: Hook) {
  const c = new Colony();
  const g = c.g;
  g.addStock(c.storage, Res.Plank, 4);
  const cutter = g.addBuilding(BuildingType.Stonecutter, c.f[0]!, true);
  let saw = -1;
  let done = -1;
  for (let i = 0; i < 9000 && done < 0; i++) {
    g.update();
    hook?.(g, i);
    if (saw < 0 && !g.buildings[cutter]!.constructing) {
      saw = g.addBuilding(BuildingType.Sawmill, c.f[2]!, true);
    }
    if (saw >= 0 && !g.buildings[saw]!.constructing) done = i;
  }
  return { done, fingerprint: g.fingerprint(), stoneUsed: saw >= 0 ? g.buildings[saw]!.used[Res.Stone]! : -1 };
}

export function storageSite(hook?: Hook) {
  const c = new Colony();
  const g = c.g;
  g.addStock(c.storage, Res.Plank, 3);
  g.addStock(c.storage, Res.Stone, 2);
  const west = g.addBuilding(BuildingType.Storage, c.f[0]!, true);
  const c0 = g.buildings[west]!.carriers;
  const b0 = g.buildings[west]!.builders;
  run(g, 3000, hook);
  return {
    carriers_before: c0,
    builders_before: b0,
    constructing: g.buildings[west]!.constructing ? 1 : 0,
    carriers: g.buildings[west]!.carriers,
    builders: g.buildings[west]!.builders,
    fingerprint: g.fingerprint(),
  };
}

/** Like Colony, but the east end is the castle. */
export class CastleColony {
  readonly g = new Game(16, 4);
  readonly f: number[];
  readonly castle: number;
  constructor() {
    this.f = row(this.g, 1, 9, 1, 2);
    this.castle = this.g.addBuilding(BuildingType.Castle, this.f[this.f.length - 1]!);
  }
}

export function castleSite(hook?: Hook) {
  const c = new CastleColony();
  const g = c.g;
  g.addStock(c.castle, Res.Plank, 10);
  const site = g.addBuilding(BuildingType.Lumberjack, c.f[0]!, true);
  let done = -1;
  for (let i = 0; i < 1500 && done < 0; i++) {
    g.update();
    hook?.(g, i);
    if (!g.buildings[site]!.constructing) done = i;
  }
  const fpDone = g.fingerprint();
  run(g, 4000, hook);
  const castle = g.buildings[c.castle]!;
  return {
    done,
    hired: g.hired,
    carriers_left: castle.carriers,
    builders_left: castle.builders,
    lumber_after: g.created[Res.Lumber]!,
    lumber_stored: castle.stock[Res.Lumber]!,
    planks_left: castle.stock[Res.Plank]!,
    fp_done: fpDone,
    fingerprint: g.fingerprint(),
    game: g,
    site,
    castle: c.castle,
  };
}

export function castleBootstrap(hook?: Hook) {
  const c = new CastleColony();
  const g = c.g;
  g.addStock(c.castle, Res.Plank, 4);
  g.addStock(c.castle, Res.Stone, 1);
  const jack = g.addBuilding(BuildingType.Lumberjack, c.f[0]!, true);
  const saw = g.addBuilding(BuildingType.Sawmill, c.f[2]!, true);
  let site2 = -1;
  let ordered = -1;
  let done = -1;
  for (let i = 0; i < 14000 && done < 0; i++) {
    g.update();
    hook?.(g, i);
    if (site2 < 0 && !g.buildings[jack]!.constructing && !g.buildings[saw]!.constructing && i > 3000) {
      site2 = g.addBuilding(BuildingType.Lumberjack, c.f[1]!, true);
      ordered = i;
    }
    if (site2 >= 0 && !g.buildings[site2]!.constructing) done = i;
  }
  return {
    ordered,
    done,
    planks_made: g.created[Res.Plank]!,
    dispatched_planks: g.dispatched[Res.Plank]!,
    fingerprint: g.fingerprint(),
    game: g,
  };
}

/**
 * Ramp used by the slope scenarios: rises (slope > 0) or falls (slope < 0)
 * along x, kept between 5 (just above the sea) and 31, the terrain's maximum (mirrors parity.cc).
 */
export const rampH = (slope: number, x: number): number =>
  Math.min(31, Math.max(5, (slope >= 0 ? 5 : 31) + slope * x));

function applyRamp(g: Game, slope: number): void {
  for (let y = 0; y < g.rows; y++) {
    for (let x = 0; x < g.cols; x++) g.terrain.setHeight(g.index(x, y), rampH(slope, x));
  }
}

/** Lumberjack site at the west end, storage with planks at the east end of a ramp. */
export function slopeSite(slope: number, hook?: Hook) {
  const g = new Game(16, 4);
  applyRamp(g, slope);
  const f = row(g, 1, 9, 1, 2);
  const storage = g.addBuilding(BuildingType.Storage, f[f.length - 1]!);
  g.addStock(storage, Res.Plank, 10);
  const site = g.addBuilding(BuildingType.Lumberjack, f[0]!, true);
  let done = -1;
  for (let i = 0; i < 4000 && done < 0; i++) {
    g.update();
    hook?.(g, i);
    if (!g.buildings[site]!.constructing) done = i;
  }
  return { done, ticks0: g.roads[0]!.ticks[0], ticks1: g.roads[0]!.ticks[1], fingerprint: g.fingerprint() };
}

/** One long road with a single fixed carrier, so the round trip is what counts. */
export function slopeLumber(slope: number, hook?: Hook) {
  const g = new Game(20, 4);
  applyRamp(g, slope);
  const f = row(g, 1, 17, 1, 8, 1);
  g.addBuilding(BuildingType.Lumberjack, f[0]!);
  g.addBuilding(BuildingType.Storage, f[f.length - 1]!);
  run(g, 15000, hook);
  return { lumber_made: g.created[Res.Lumber]!, fingerprint: g.fingerprint() };
}

/** Every scenario in parity.cc, keyed exactly as in parity.json. */
export function allParityScenarios(): Record<string, unknown> {
  const strip = <T extends { game?: Game }>(o: T) => {
    const { game: _g, ...rest } = o as T & { game?: Game };
    return rest;
  };
  const out: Record<string, unknown> = {};
  out.chain_fixed2_fast = strip(chain(2, 150, 15000));
  out.chain_dynamic_fast = strip(chain(-1, 150, 15000));
  out.chain_dynamic_overflow = strip(chain(-1, 300, 15000));
  out.chain_fixed1_overflow = strip(chain(1, 300, 15000));
  out.lumber_seg2_c1 = lumberMade(2, 1);
  out.lumber_seg8_c1 = lumberMade(8, 1);
  out.lumber_seg8_c3 = lumberMade(8, 3);
  out.lumber_seg8_dynamic = lumberMade(8, -1);
  out.long_road_hired = longRoad();
  out.hiring_cap = hiringCap();
  out.hiring_delay = hiringDelay();
  out.pool_exhausted = poolExhausted();
  const sb = siteBuilt();
  out.site_built = {
    done: sb.done,
    lumber_after: sb.lumber_after,
    planks_left: sb.planks_left,
    builders_home: sb.builders_home,
    fp_done: sb.fp_done,
    fingerprint: sb.fingerprint,
  };
  const sw = siteWaits();
  out.site_waits = {
    used_before: sw.used_before,
    constructing_before: sw.constructing_before,
    constructing_after: sw.constructing_after,
    fingerprint: sw.fingerprint,
  };
  out.builders_1 = builders(1);
  out.builders_3 = builders(3);
  const bs = bootstrap();
  out.bootstrap = {
    ordered: bs.ordered,
    done: bs.done,
    planks_made: bs.planks_made,
    stone_created: bs.stone_created,
    fingerprint: bs.fingerprint,
  };
  const ss = stoneSupply();
  out.stone_supply = { done: ss.done, fingerprint: ss.fingerprint };
  out.storage_site = storageSite();
  const cs = castleSite();
  out.castle_site = {
    done: cs.done,
    hired: cs.hired,
    carriers_left: cs.carriers_left,
    builders_left: cs.builders_left,
    lumber_after: cs.lumber_after,
    lumber_stored: cs.lumber_stored,
    planks_left: cs.planks_left,
    fp_done: cs.fp_done,
    fingerprint: cs.fingerprint,
  };
  const cb = castleBootstrap();
  out.castle_bootstrap = {
    ordered: cb.ordered,
    done: cb.done,
    planks_made: cb.planks_made,
    dispatched_planks: cb.dispatched_planks,
    fingerprint: cb.fingerprint,
  };
  out.slope_site_m3 = slopeSite(-3);
  out.slope_site_p3 = slopeSite(3);
  out.slope_site_p5 = slopeSite(5);
  out.slope_lumber_p3 = slopeLumber(3);
  out.slope_lumber_p5 = slopeLumber(5);
  return out;
}
