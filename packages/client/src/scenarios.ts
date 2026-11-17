// Starting positions. Each builds a fresh Game on generated terrain, placing
// everything with the same checked calls the player uses, so a scenario can
// never start in a state the rules would not allow.
import {
  BuildingType,
  DEFAULT_LIMITS,
  Dir,
  FLAT_HEIGHT,
  Game,
  MOUNTAIN_LEVEL,
  OreKind,
  Temperament,
  Terrain,
  Res,
  flattenArea,
  generateObjects,
  generateTerrain,
  hexDistance,
  MapObject,
  planRoad,
  checkBuilding,
  type TerrainMap,
} from '@sett/sim';

export type ScenarioId = 'new' | 'demo' | 'food' | 'territory';

export const SCENARIOS: { id: ScenarioId; name: string; help: string }[] = [
  { id: 'new', name: 'New game', help: 'Just the castle on fresh terrain, as in the original. Build out from it.' },
  { id: 'food', name: 'Food and mining', help: 'The whole food chain, built: fisher, farm, mill, well and baker feed a stone mine on the mountain. Cut a road and watch the mine starve.' },
  { id: 'demo', name: 'Running colony', help: 'A working chain: two lumberjacks, a sawmill and the castle. Add more with the tools.' },
  { id: 'territory', name: 'Two colonies', help: 'Your castle in the west, a rival\'s far to the east, and a garrisoned hut each facing the other in the middle. Select theirs and attack. The rival builds out and fights back: pick how in the Opponent panel.' },
];

const COLS = 48;
const ROWS = 40;
const SEED = 1;

/** What the castle starts with. Everything else has to be built from this. */
const START_STOCK: [Res, number][] = [
  [Res.Plank, 12],
  [Res.Stone, 6],
  [Res.Axe, 3],
  [Res.Pick, 3],
  [Res.Shovel, 2],
  [Res.Rod, 2],
  [Res.Scythe, 2],
  [Res.Saw, 2],
  [Res.Hammer, 2],
  [Res.Cleaver, 2],
];

function level(cx: number, cy: number, radius: number): TerrainMap {
  const t = generateTerrain({ cols: COLS, rows: ROWS, seed: SEED });
  flattenArea(t, cx, cy, radius, FLAT_HEIGHT, 4);
  return t;
}

function placeCastle(g: Game, x: number, y: number, owner = 0): void {
  const castle = g.placeBuilding(BuildingType.Castle, g.index(x, y), false, owner);
  for (const [res, n] of START_STOCK) g.addStock(castle, res, n);
}

/** Scatter trees and rocks, keeping `clear` free so there is room to build. */
function addObjects(g: Game, clear: (pos: number) => boolean): void {
  g.objects = generateObjects(g.terrain, SEED, { keepClear: clear });
}

/** The free spot nearest to (x, y) where `type` may be built, or -1. */
function findSite(g: Game, type: BuildingType, x: number, y: number, owner = 0): number {
  let best = -1;
  let bestD = Infinity;
  for (let p = 0; p < g.cols * g.rows; p++) {
    const d = hexDistance((p % g.cols) - x, Math.floor(p / g.cols) - y);
    if (d < bestD && checkBuilding(g, type, p, owner).ok) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** Join a flag to the nearest flag already in `net` that a road can reach. */
function connect(g: Game, flag: number, net: number[]): void {
  const here = g.flags[flag]!.pos;
  const byDistance = net
    .map((f) => ({ f, d: hexDistance((g.flags[f]!.pos % g.cols) - (here % g.cols), Math.floor(g.flags[f]!.pos / g.cols) - Math.floor(here / g.cols)) }))
    .sort((a, b) => a.d - b.d || a.f - b.f);
  for (const { f } of byDistance) {
    const path = planRoad(g, flag, g.flags[f]!.pos);
    if (path) {
      g.addRoad(flag, path);
      net.push(flag);
      return;
    }
  }
  throw new Error('scenario: no road from the new building');
}

export function makeScenario(id: ScenarioId): Game {
  if (id === 'food') return foodScenario();
  if (id === 'territory') return territoryScenario();
  if (id === 'new') {
    const g = new Game(COLS, ROWS, level(24, 20, 5));
    g.limits = { ...DEFAULT_LIMITS };
    g.settlers = true;
    g.tools = true;
    placeCastle(g, 24, 20);
    // leave the castle's surroundings open; forests and rocks start beyond
    addObjects(g, (p) => hexDistance((p % COLS) - 24, Math.floor(p / COLS) - 20) <= 3);
    return g;
  }

  // Lumberjacks feed a sawmill, planks go to the castle. Flags every 2 points
  // along a row; each building stands up-left of its flag.
  const g = new Game(COLS, ROWS, level(26, 20, 8));
  g.limits = { ...DEFAULT_LIMITS };
  g.settlers = true;
  g.tools = true;
  const row = [22, 24, 26, 28, 30].map((x) => g.addFlag(x, 19));
  for (let i = 0; i + 1 < row.length; i++) g.addRoad(row[i]!, [Dir.Right, Dir.Right]);
  const j2 = g.addFlag(26, 23);
  const mid = g.addFlag(26, 21);
  g.addRoad(j2, [Dir.Up, Dir.Up]);
  g.addRoad(mid, [Dir.Up, Dir.Up]);
  g.placeBuilding(BuildingType.Lumberjack, g.index(21, 18), false);
  g.placeBuilding(BuildingType.Lumberjack, g.index(25, 22), false);
  const saw = g.placeBuilding(BuildingType.Sawmill, g.index(25, 18), false);
  g.buildings[saw]!.period = 150;
  // A forester by the south lumberjack keeps its grove growing back.
  g.placeBuilding(BuildingType.Forester, g.index(23, 22), false);
  placeCastle(g, 29, 18);
  // nothing on or right beside what is already built
  const nextToBuilt = (p: number): boolean => {
    const x = p % COLS;
    const y = Math.floor(p / COLS);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (g.inside(x + dx, y + dy) && g.isOccupied(g.index(x + dx, y + dy))) return true;
      }
    }
    return false;
  };
  addObjects(g, nextToBuilt);
  // The south lumberjack has few natural trees in reach: plant it a grove.
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const p = g.index(x, y);
      if (hexDistance(x - 24, y - 25) <= 2 && !nextToBuilt(p) && g.objectAtPos(p) === MapObject.None) {
        g.objects!.set(p, MapObject.Tree);
      }
    }
  }
  return g;
}

/**
 * The castle on the generated map with the whole food chain around it: bread
 * from farm, mill, well and baker, fish from a fisher at the western lake, and
 * a stone mine on the eastern mountain eating both. Spots are searched for, so
 * the scenario follows the terrain.
 */
function foodScenario(): Game {
  const g = new Game(COLS, ROWS, level(24, 20, 5));
  g.limits = { ...DEFAULT_LIMITS };
  g.settlers = true;
  g.tools = true;
  placeCastle(g, 24, 20);
  const castleFlag = g.buildings[g.castle]!.flag;
  const wants: [BuildingType, number, number][] = [
    [BuildingType.Farm, 20, 24],
    [BuildingType.Mill, 20, 17],
    [BuildingType.Well, 27, 23],
    [BuildingType.Baker, 28, 17],
    [BuildingType.Fisher, 14, 20],
    [BuildingType.StoneMine, 33, 20],
  ];
  const flags: number[] = [];
  for (const [type, x, y] of wants) {
    const p = findSite(g, type, x, y);
    if (p < 0) throw new Error(`scenario: no site for ${BuildingType[type]}`);
    flags.push(g.buildings[g.placeBuilding(type, p, false)]!.flag);
  }
  const net = [castleFlag];
  for (const f of flags) connect(g, f, net);
  const near = (p: number): boolean => {
    const x = p % COLS;
    const y = Math.floor(p / COLS);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) if (g.inside(x + dx, y + dy) && g.isOccupied(g.index(x + dx, y + dy))) return true;
    }
    return false;
  };
  addObjects(g, near);
  // the scenario's mine digs stone: make sure that is what lies under its rock
  const mine = g.buildings.find((b) => b.type === BuildingType.StoneMine)!;
  const mx = mine.pos % COLS;
  const my = Math.floor(mine.pos / COLS);
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (hexDistance(dx, dy) > 2 || !g.inside(mx + dx, my + dy)) continue;
      const p = g.index(mx + dx, my + dy);
      if (g.terrain.kindAt(p) === Terrain.Mountain && !g.isOccupied(p)) g.objects!.setOre(p, 12, OreKind.Stone);
    }
  }
  return g;
}

/**
 * Your castle in the west, a second, untouched colony's castle far to the
 * east: too far apart to reach each other's land, but close enough that the
 * tinted territory around each one is easy to see. Demonstrates border claims
 * only; the second colony never builds anything and nothing attacks.
 */
// A much bigger map than the single-player scenarios: room for a real
// opponent's colony to grow into, all of it visible (no fog of war yet).
const TERRITORY_COLS = 160;
const TERRITORY_ROWS = 120;
/** How far from a castle its guaranteed ore hill lies (just beyond the castle's own reach of 8). */
const HILL_DISTANCE = 13;
/** The hill's size and how much ore each of its points holds: enough for a long game's mining. */
const HILL_RADIUS = 3;
const ORE_PER_POINT = 40;

function territoryScenario(): Game {
  const cols = TERRITORY_COLS;
  const rows = TERRITORY_ROWS;
  const t = generateTerrain({ cols, rows, seed: SEED });
  const yours: [number, number] = [20, 60];
  const theirs: [number, number] = [140, 60];
  // a small mountain a step beyond each castle's reach, toward the middle, so coal, iron and gold
  // are always within one expansion of both colonies whatever the generated map is like
  const hills: [number, number][] = [[yours[0] + HILL_DISTANCE, yours[1]], [theirs[0] - HILL_DISTANCE, theirs[1]]];
  for (const [x, y] of hills) flattenArea(t, x, y, HILL_RADIUS, MOUNTAIN_LEVEL, 6);
  flattenArea(t, yours[0], yours[1], 5, FLAT_HEIGHT, 4);
  flattenArea(t, theirs[0], theirs[1], 5, FLAT_HEIGHT, 4);
  // two garrisoned huts facing each other across the middle, close enough to fight over
  const front: [number, number][] = [[70, 60], [84, 60]];
  for (const [x, y] of front) flattenArea(t, x, y, 3, FLAT_HEIGHT, 3);
  const g = new Game(cols, rows, t);
  g.limits = { ...DEFAULT_LIMITS };
  g.settlers = true;
  g.tools = true;
  placeCastle(g, yours[0], yours[1], 0);
  placeCastle(g, theirs[0], theirs[1], 1);
  // some gold on both sides: it raises each army's strength away from home and promotes knights
  g.addStock(g.castleOf(0), Res.Gold, 6);
  g.addStock(g.castleOf(1), Res.Gold, 6);
  // swords and shields to arm knights with (nobody mines for them yet), for you and the opponent alike
  for (const owner of [0, 1]) {
    g.addStock(g.castleOf(owner), Res.Sword, 40);
    g.addStock(g.castleOf(owner), Res.Shield, 40);
  }
  // a few spare tools, so the smelter, a toolmaker and a weaponsmith can all have a worker
  for (const owner of [0, 1]) {
    g.addStock(g.castleOf(owner), Res.Hammer, 2);
    g.addStock(g.castleOf(owner), Res.Pick, 2);
  }
  g.addAi(1, Temperament.Defensive);
  front.forEach(([x, y], owner) => {
    const p = findSite(g, BuildingType.Hut, x, y, owner);
    if (p < 0) throw new Error('scenario: no site for the front-line hut');
    g.setGarrison(g.placeBuilding(BuildingType.Hut, p, false, owner), 3);
  });
  const clear = (p: number): boolean =>
    hexDistance((p % cols) - yours[0], Math.floor(p / cols) - yours[1]) <= 3 ||
    hexDistance((p % cols) - theirs[0], Math.floor(p / cols) - theirs[1]) <= 3;
  addObjects(g, clear);
  for (const [x, y] of hills) {
    let n = 0;
    for (let p = 0; p < cols * rows; p++) {
      if (g.terrain.heightAt(p) >= MOUNTAIN_LEVEL && hexDistance((p % cols) - x, Math.floor(p / cols) - y) <= HILL_RADIUS) {
        g.objects!.setOre(p, ORE_PER_POINT, [OreKind.Coal, OreKind.Iron, OreKind.Gold][n++ % 3]!);
      }
    }
  }
  return g;
}
