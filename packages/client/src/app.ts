// App state and rules: owns the Game, the fixed-step loop, the current tool
// and selection, and every command that changes the sim. The renderer and the
// panels only read from here.

import { BuildingType, Game, MapObject, ORE_NAMES, SIGN_EMPTY, buildNeeds, type OreKind, Res, Terrain, signIsSmall, signKind, checkBuilding, checkFlag, checkFlagAt, planRoad } from '@sett/sim';
import { BUILDING_NAME } from './palette.ts';
import { type KV, readSave, writeSave } from './persistence.ts';
import { makeScenario, type ScenarioId } from './scenarios.ts';

export const STEP_MS = 20; // 50 Hz, like the original on the vertical blank
const MAX_CATCH_UP = 5; // beyond this the game slows down instead of freezing
/** After a command, wait this long (real ms) for more before saving: a burst of clicks is one write. */
export const SAVE_DEBOUNCE_MS = 1000;
/** While the game runs, save at least this often even without commands. */
export const SAVE_PERIOD_MS = 10_000;

export type Tool =
  | 'select'
  | 'flag'
  | 'road'
  | 'lumberjack'
  | 'sawmill'
  | 'stonecutter'
  | 'forester'
  | 'fisher'
  | 'farm'
  | 'well'
  | 'mill'
  | 'baker'
  | 'stonemine'
  | 'coalmine'
  | 'ironmine'
  | 'goldmine'
  | 'ironsmelter'
  | 'goldsmelter'
  | 'toolmaker'
  | 'pigfarm'
  | 'butcher'
  | 'storage'
  | 'geologist'
  | 'demolish';

/** What the demolish tool would remove at a point. */
export type DemolishTarget =
  | { kind: 'building' | 'flag' | 'road'; index: number; ok: boolean; reason: string; label: string }
  | null;

/** One thing a flag's radial menu can do. */
export interface FlagAction {
  id: 'build' | 'road' | 'geologist' | 'demolish';
  label: string;
  enabled: boolean;
  /** Why it is greyed out; empty when enabled. */
  reason: string;
}

/** One building the Build list of a flag can offer. */
export interface BuildOption {
  type: BuildingType;
  name: string;
  enabled: boolean;
  /** Why it cannot be built here; empty when it can. */
  reason: string;
  /** Planks and stone it needs. */
  planks: number;
  stones: number;
}

export type Selection = { kind: 'flag' | 'building' | 'road'; index: number } | null;

/** The order buildings are listed in: the economy's, as in the toolbar. */
const BUILD_ORDER: BuildingType[] = [
  BuildingType.Lumberjack,
  BuildingType.Forester,
  BuildingType.Sawmill,
  BuildingType.Stonecutter,
  BuildingType.Storage,
  BuildingType.Fisher,
  BuildingType.Farm,
  BuildingType.Well,
  BuildingType.Mill,
  BuildingType.Baker,
  BuildingType.PigFarm,
  BuildingType.Butcher,
  BuildingType.StoneMine,
  BuildingType.CoalMine,
  BuildingType.IronMine,
  BuildingType.GoldMine,
  BuildingType.IronSmelter,
  BuildingType.Toolmaker,
  BuildingType.GoldSmelter,
];

const SITE_TOOLS: Partial<Record<Tool, BuildingType>> = {
  lumberjack: BuildingType.Lumberjack,
  sawmill: BuildingType.Sawmill,
  stonecutter: BuildingType.Stonecutter,
  forester: BuildingType.Forester,
  fisher: BuildingType.Fisher,
  farm: BuildingType.Farm,
  well: BuildingType.Well,
  mill: BuildingType.Mill,
  baker: BuildingType.Baker,
  stonemine: BuildingType.StoneMine,
  coalmine: BuildingType.CoalMine,
  ironmine: BuildingType.IronMine,
  goldmine: BuildingType.GoldMine,
  ironsmelter: BuildingType.IronSmelter,
  goldsmelter: BuildingType.GoldSmelter,
  toolmaker: BuildingType.Toolmaker,
  pigfarm: BuildingType.PigFarm,
  butcher: BuildingType.Butcher,
  storage: BuildingType.Storage,
};

export class App {
  game: Game;
  /** The main screen sits over the game: nothing runs or is saved while it shows. */
  screen: 'menu' | 'game' = 'game';
  tool: Tool = 'select';
  selection: Selection = null;
  /** The flag whose radial menu is open (Select tool, click on a flag). */
  menu: { flag: number; page: 'main' | 'build' } | null = null;
  roadStart = -1; // flag index while the road tool has a first click
  hover: { x: number; y: number } | null = null;
  toast = '';
  /** Fraction of the next step already elapsed; the view interpolates with it. */
  alpha = 0;
  /** Bumped whenever the panels should re-read the game. */
  version = 0;

  /** When the game was last written to storage (ms since epoch), null if never. */
  lastSaved: number | null = null;

  private storage: KV | null;
  private sinceSave = 0; // real ms since the last write
  private commandPending = false; // the player changed something since the last write
  private saveFailing = false;
  private acc = 0;
  private lastSpeed = 2;
  private listeners = new Set<() => void>();
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private sinceNotify = 0;

  /**
   * With a storage, the saved game (if there is one) is loaded instead of a
   * fresh scenario, and the game is saved as it is played: after commands, every
   * SAVE_PERIOD_MS while running, and whenever `saveNow` is called (page hidden).
   */
  constructor(scenario: ScenarioId = 'new', storage: KV | null = null) {
    this.storage = storage;
    const loaded = storage ? readSave(storage) : ({ kind: 'none' } as const);
    if (loaded.kind === 'loaded') {
      this.game = loaded.game;
      this.game.settlers = true; // games saved before workers walked in get it too
      this.lastSaved = loaded.savedAt;
      this.lastSpeed = loaded.game.speed > 0 ? loaded.game.speed : 2;
      this.toast = 'Continued your saved game.';
      this.toastTimer = setTimeout(() => this.say(''), 3500);
    } else {
      this.game = makeScenario(scenario);
      if (loaded.kind === 'broken') {
        this.toast = `The saved game could not be loaded (${loaded.reason}); a new one was started. The old data is kept under "sett.save.broken".`;
      }
    }
  }

  /** A game to go back to: a saved one, or one begun in this session. */
  get canContinue(): boolean {
    return this.lastSaved !== null || this.game.tick > 0;
  }

  /** On page load: the main screen only when there is no game to carry on with; with a saved game, play straight on. */
  startScreen(): void {
    this.screen = this.canContinue ? 'game' : 'menu';
  }

  openMenu(): void {
    this.saveNow();
    this.screen = 'menu';
    this.say('');
    this.changed();
  }

  continueGame(): void {
    if (!this.canContinue) return;
    this.screen = 'game';
    this.acc = 0;
    this.changed();
  }

  /** A fresh game; the caller has already checked with the player if one is in progress. */
  newGame(): void {
    this.loadScenario('new');
    this.screen = 'game';
    this.changed();
  }

  /** Write the game to storage now. Reports a failure once, not on every attempt. */
  saveNow(): void {
    if (!this.storage) return;
    this.sinceSave = 0;
    this.commandPending = false;
    try {
      writeSave(this.storage, this.game, Date.now());
      this.lastSaved = Date.now();
      if (this.saveFailing) {
        this.saveFailing = false;
        this.say('Saving works again.');
      }
    } catch (e) {
      if (!this.saveFailing) {
        this.saveFailing = true;
        this.say(`Could not save the game: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  /** The player changed the game: save soon. */
  private commanded(): void {
    this.commandPending = true;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  // ---- loop ------------------------------------------------------------

  /** Called once per rendered frame with the real time since the last one. */
  frame(dtMs: number): void {
    const g = this.game;
    if (this.screen === 'menu') return;
    if (g.speed > 0) {
      this.acc += dtMs;
      let steps = 0;
      while (this.acc >= STEP_MS && steps < MAX_CATCH_UP) {
        g.update();
        this.acc -= STEP_MS;
        steps++;
      }
      if (this.acc >= STEP_MS) this.acc = 0; // fell behind: drop the backlog
      this.alpha = this.acc / STEP_MS;
    } else {
      this.alpha = 0;
    }
    this.dropStaleSelection();
    if (g.discoveries.length > 0) {
      const found = g.discoveries.splice(0);
      this.say(`Your geologist found ${[...new Set(found.map((d) => ORE_NAMES[d.kind]))].join(' and ')}!`);
    }
    this.sinceSave += dtMs;
    if (this.storage) {
      if (this.commandPending && this.sinceSave >= SAVE_DEBOUNCE_MS) this.saveNow();
      else if (g.speed > 0 && this.sinceSave >= SAVE_PERIOD_MS) this.saveNow();
    }
    this.sinceNotify += dtMs;
    if (this.sinceNotify >= 100) {
      this.sinceNotify = 0;
      this.changed(); // panels refresh at 10 Hz
    }
  }

  /** A selected thing that has since been demolished or merged away is no longer selectable. */
  private dropStaleSelection(): void {
    const g = this.game;
    if (this.menu && g.flags[this.menu.flag]!.removed) this.menu = null;
    const sel = this.selection;
    if (!sel) return;
    const gone =
      sel.kind === 'building' ? g.buildings[sel.index]!.removed
      : sel.kind === 'flag' ? g.flags[sel.index]!.removed
      : g.roads[sel.index]!.removed;
    if (gone) this.selection = null;
  }

  /** What the menu of a flag offers: a road from it, a geologist (only where there is a mountain), demolishing it. */
  flagActions(flag: number): FlagAction[] {
    const g = this.game;
    const out: FlagAction[] = [];
    if (g.flags[flag]!.building < 0) {
      const options = this.buildOptions(flag);
      const any = options.find((o) => o.enabled);
      out.push({ id: 'build', label: 'Build', enabled: !!any, reason: any ? '' : 'nothing can be built at this flag' });
    }
    out.push({ id: 'road', label: 'Road', enabled: true, reason: '' });
    if (g.flagByMountain(flag)) {
      const c = g.checkGeologist(flag);
      out.push({ id: 'geologist', label: 'Geologist', enabled: c.ok, reason: c.reason });
    }
    const d = g.checkDemolishFlag(flag);
    out.push({ id: 'demolish', label: 'Remove flag', enabled: d.ok, reason: d.reason });
    return out;
  }

  /** Every building, with whether it can stand with this flag as its door, and why not if it cannot. Buildable ones come first. */
  buildOptions(flag: number): BuildOption[] {
    const g = this.game;
    const spot = g.buildSpot(flag);
    const out: BuildOption[] = [];
    for (const type of BUILD_ORDER) {
      const c = checkBuilding(g, type, spot);
      const need = buildNeeds(type);
      out.push({ type, name: BUILDING_NAME[type]!, enabled: c.ok, reason: c.reason, planks: need[Res.Plank]!, stones: need[Res.Stone]! });
    }
    return out.sort((a, b) => Number(b.enabled) - Number(a.enabled));
  }

  /** Back from the Build list to the ring. */
  menuBack(): void {
    if (this.menu) this.menu = { flag: this.menu.flag, page: 'main' };
    this.changed();
  }

  /** The player picked a building in the Build list: a site goes up here, its door on this flag. */
  buildFromMenu(type: BuildingType): void {
    const m = this.menu;
    if (!m) return;
    this.menu = null;
    try {
      this.game.placeBuilding(type, this.game.buildSpot(m.flag), true);
      this.commanded();
      this.say('');
    } catch (e) {
      this.say(e instanceof Error ? e.message : String(e));
    }
    this.changed();
  }

  closeMenu(): void {
    if (!this.menu) return;
    this.menu = null;
    this.changed();
  }

  /** The player picked an item in the flag menu. */
  chooseFlagAction(id: FlagAction['id']): void {
    const m = this.menu;
    if (!m) return;
    const fi = m.flag;
    const action = this.flagActions(fi).find((x) => x.id === id);
    if (id === 'build' && action?.enabled) {
      this.menu = { flag: fi, page: 'build' }; // stays open, as a list
      this.changed();
      return;
    }
    this.menu = null;
    if (!action) return;
    if (!action.enabled) {
      this.say(`Can't do that: ${action.reason}.`);
      return;
    }
    try {
      if (id === 'road') {
        this.setTool('road');
        this.roadStart = fi;
        this.say('Now click the flag where the road ends.');
      } else if (id === 'geologist') {
        this.game.sendGeologist(fi);
        this.commanded();
        this.say('A geologist is on his way. He probes the rock around the flag and leaves a sign at every spot.');
      } else {
        this.game.demolishFlag(fi);
        this.selection = null;
        this.commanded();
        this.say('');
      }
    } catch (e) {
      this.say(e instanceof Error ? e.message : String(e));
    }
    this.changed();
  }

  /** A toolmaker slider: how much of what the toolmakers make should be this tool. */
  setToolShare(tool: Res, share: number): void {
    this.game.setToolShare(tool, share);
    this.commanded();
    this.changed();
  }

  /** The food slider of one kind of mine. */
  setFoodShare(kind: OreKind, share: number): void {
    this.game.setFoodShare(kind, share);
    this.commanded();
    this.changed();
  }

  setSpeed(speed: number): void {
    if (speed > 0) this.lastSpeed = speed;
    this.game.speed = speed;
    this.commanded();
    this.changed();
  }

  togglePause(): void {
    this.setSpeed(this.game.speed === 0 ? this.lastSpeed : 0);
  }

  loadScenario(id: ScenarioId): void {
    this.game = makeScenario(id);
    this.selection = null;
    this.menu = null;
    this.roadStart = -1;
    this.acc = 0;
    this.say('');
    this.saveNow();
    this.changed();
  }

  // ---- tools -----------------------------------------------------------

  setTool(tool: Tool): void {
    this.tool = tool;
    this.menu = null;
    this.roadStart = -1;
    this.say('');
    this.changed();
  }

  say(msg: string): void {
    this.toast = msg;
    clearTimeout(this.toastTimer);
    if (msg) this.toastTimer = setTimeout(() => this.say(''), 3500);
    this.changed();
  }

  /** The building the active tool places, or null if it is not a building tool. */
  get buildType(): BuildingType | null {
    return SITE_TOOLS[this.tool] ?? null;
  }

  canFlagAt(x: number, y: number): boolean {
    return checkFlagAt(this.game, x, y).ok;
  }

  /** One line about the hovered point: terrain, and what the tool could do there. */
  hoverInfo(): string {
    const h = this.hover;
    if (!h) return '';
    const g = this.game;
    const pos = g.index(h.x, h.y);
    const kind = ['water', 'grass', 'mountain'][g.terrain.kindAt(pos) as Terrain];
    let line = `${h.x}, ${h.y} · ${kind} · height ${g.terrain.heightAt(pos)}`;
    const obj = g.objectAtPos(pos);
    if (obj === MapObject.Tree) line += ' · tree';
    else if (obj === MapObject.Sapling) line += ' · young tree';
    else if (obj === MapObject.Field) line += ' · young field';
    else if (obj === MapObject.Wheat) line += ' · ripe field';
    else if (obj === MapObject.Stone) line += ` · rock (${g.objects!.amountAt(pos)} left)`;
    const sign = g.objects ? g.objects.sign[pos]! : 0;
    if (sign === SIGN_EMPTY) line += ' · sign: nothing found here';
    else if (sign > 0) line += ` · sign: ${signIsSmall(sign) ? 'a little' : 'plenty of'} ${ORE_NAMES[signKind(sign)]}`;
    const type = this.buildType;
    if (type !== null) {
      const c = checkBuilding(g, type, pos);
      line += c.ok ? ' · can build here' : ` · can't build: ${c.reason}`;
    } else if (this.tool === 'flag') {
      const c = checkFlagAt(g, h.x, h.y);
      line += c.ok ? (g.roadAtPos(pos) ? ' · flag fits (cuts this road in two)' : ' · flag fits') : ` · no flag: ${c.reason}`;
    } else if (this.tool === 'geologist') {
      const fi = g.flagAtPos(pos);
      if (fi >= 0) {
        const c = g.checkGeologist(fi);
        line += c.ok ? ' · click to send a geologist' : ` · no geologist: ${c.reason}`;
      } else line += ' · a geologist goes to a flag';
    } else if (this.tool === 'demolish') {
      const t = this.demolishTargetAt(pos);
      if (t) line += t.ok ? ` · click to demolish ${t.label}` : ` · can't demolish ${t.label}: ${t.reason}`;
    } else if (this.tool === 'road' && g.roadAtPos(pos) && g.flagAtPos(pos) < 0) {
      const c = checkFlagAt(g, h.x, h.y);
      line += c.ok ? ' · click to put a flag here and branch off' : ` · no flag here: ${c.reason}`;
    }
    return line;
  }

  click(x: number, y: number): void {
    const g = this.game;
    const pos = g.index(x, y);
    this.menu = null; // any click closes an open menu; selecting a flag opens it again
    if (this.tool !== 'select') this.commanded();
    try {
      switch (this.tool) {
        case 'select':
          this.selectAt(pos);
          break;
        case 'flag':
          g.addFlag(x, y);
          break;
        case 'road':
          this.clickRoad(pos);
          break;
        case 'demolish':
          this.clickDemolish(pos);
          break;
        case 'geologist':
          this.clickGeologist(pos);
          break;
        default:
          this.clickBuilding(pos);
      }
    } catch (e) {
      this.say(e instanceof Error ? e.message : String(e));
    }
    this.changed();
  }

  private clickRoad(pos: number): void {
    const g = this.game;
    let fi = g.flagAtPos(pos);
    if (fi < 0 && g.roadIndexAt(pos) >= 0) {
      // A point on a road: put a flag there (which cuts the road) and branch from it.
      const c = checkFlag(g, pos);
      if (!c.ok) {
        this.say(`No flag can go there: ${c.reason}.`);
        return;
      }
      fi = g.addFlag(pos % g.cols, Math.floor(pos / g.cols));
    }
    if (fi < 0) {
      this.say('Roads run between flags: click a flag, or a point on a road to branch from it.');
      return;
    }
    if (this.roadStart < 0) {
      this.roadStart = fi;
      this.say('Now click the flag where the road ends.');
      return;
    }
    if (fi === this.roadStart) {
      this.roadStart = -1;
      this.say('');
      return;
    }
    const path = planRoad(g, this.roadStart, pos);
    if (!path) {
      this.say('No free route between those flags.');
      return;
    }
    g.addRoad(this.roadStart, path);
    this.roadStart = -1;
    this.say('');
  }

  /**
   * What demolishing at this point would remove: a building (any point it
   * covers), else a flag, else the road passing through. Burning ground and
   * empty ground are nothing.
   */
  demolishTargetAt(pos: number): DemolishTarget {
    const g = this.game;
    const bi = g.buildingAtPos(pos);
    if (bi >= 0) {
      const c = g.checkDemolishBuilding(bi);
      const name = BUILDING_NAME[g.buildings[bi]!.type]!.toLowerCase();
      return { kind: 'building', index: bi, ok: c.ok, reason: c.reason, label: `the ${name}` };
    }
    const fi = g.flagAtPos(pos);
    if (fi >= 0) {
      const c = g.checkDemolishFlag(fi);
      const merges = g.flags[fi]!.road.filter((r) => r >= 0).length === 2;
      return { kind: 'flag', index: fi, ok: c.ok, reason: c.reason, label: merges ? 'this flag (joins its two roads)' : 'this flag' };
    }
    const ri = g.roadIndexAt(pos);
    if (ri >= 0) return { kind: 'road', index: ri, ok: true, reason: '', label: 'this road (its carriers go home)' };
    return null;
  }

  private clickGeologist(pos: number): void {
    const g = this.game;
    const fi = g.flagAtPos(pos);
    if (fi < 0) {
      this.say('A geologist is sent to a flag: click a flag on or beside a mountain.');
      return;
    }
    g.sendGeologist(fi);
    this.say('A geologist is on his way. He probes the rock around the flag and leaves a sign at every spot.');
  }

  private clickDemolish(pos: number): void {
    const t = this.demolishTargetAt(pos);
    if (!t) {
      this.say('Nothing to demolish there: click a building, a flag or a road.');
      return;
    }
    if (!t.ok) {
      this.say(`Can't demolish ${t.label}: ${t.reason}.`);
      return;
    }
    const g = this.game;
    if (t.kind === 'building') g.demolishBuilding(t.index);
    else if (t.kind === 'flag') g.demolishFlag(t.index);
    else g.demolishRoad(t.index);
    this.selection = null;
    this.say('');
  }

  /** The point clicked is the building point; its flag goes down-right of it. */
  private clickBuilding(pos: number): void {
    const type = this.buildType;
    if (type === null) return;
    this.game.placeBuilding(type, pos, true);
    this.say('');
  }

  private selectAt(pos: number): void {
    const g = this.game;
    const bi = g.buildingAtPos(pos); // any point a building covers
    if (bi >= 0) {
      this.selection = { kind: 'building', index: bi };
      return;
    }
    const fi = g.flagAtPos(pos);
    if (fi >= 0) {
      const f = g.flags[fi]!;
      this.selection = f.building >= 0 ? { kind: 'building', index: f.building } : { kind: 'flag', index: fi };
      this.menu = { flag: fi, page: 'main' };
      return;
    }
    // A road tile: find the road that covers it.
    for (const r of g.roads) {
      if (r.removed) continue;
      let p = g.flags[r.flag[0]]!.pos;
      for (const d of r.dirs) {
        p = g.move(p, d);
        if (p === pos) {
          this.selection = { kind: 'road', index: r.index };
          return;
        }
      }
    }
    this.selection = null;
  }
}
