// Starting positions. Each builds a fresh Game on generated terrain, placing
// everything with the same checked calls the player uses, so a scenario can
// never start in a state the rules would not allow.
import {
  BuildingType,
  DEFAULT_LIMITS,
  Dir,
  FLAT_HEIGHT,
  Game,
  OreKind,
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

export type ScenarioId = 'new' | 'demo' | 'food';

export const SCENARIOS: { id: ScenarioId; name: string; help: string }[] = [
  { id: 'new', name: 'New game', help: 'Just the castle on fresh terrain, as in the original. Build out from it.' },
  { id: 'food', name: 'Food and mining', help: 'The whole food chain, built: fisher, farm, mill, well and baker feed a stone mine on the mountain. Cut a road and watch the mine starve.' },
  { id: 'demo', name: 'Running colony', help: 'A working chain: two lumberjacks, a sawmill and the castle. Add more with the tools.' },
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

function placeCastle(g: Game, x: number, y: number): void {
  const castle = g.placeBuilding(BuildingType.Castle, g.index(x, y), false);
  for (const [res, n] of START_STOCK) g.addStock(castle, res, n);
}

/** Scatter trees and rocks, keeping `clear` free so there is room to build. */
function addObjects(g: Game, clear: (pos: number) => boolean): void {
  g.objects = generateObjects(g.terrain, SEED, { keepClear: clear });
}

/** The free spot nearest to (x, y) where `type` may be built, or -1. */
function findSite(g: Game, type: BuildingType, x: number, y: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let p = 0; p < g.cols * g.rows; p++) {
    const d = hexDistance((p % g.cols) - x, Math.floor(p / g.cols) - y);
    if (d < bestD && checkBuilding(g, type, p).ok) {
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
