// Preact panels over the canvas: toolbar, stats, inspector. They read the
// sim through `app` and refresh at 10 Hz; all changes go through App methods.
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  BState,
  BuilderState,
  BuildingType,
  FIELD_RADIUS,
  TOOL_KINDS,
  TOOL_MAX,
  isTool,
  toolFor,
  FOOD_MAX,
  ORE_NAMES,
  OreKind,
  oreKindOf,
  Game,
  MAX_FIELDS,
  type Building,
  RES_COUNT,
  MapObject,
  RES_NAMES,
  Res,
  TState,
  distanceBetween,
  harvestKindOf,
  acceptsAll,
  isStore,
} from '@sett/sim';
import type { App, Tool } from './app.ts';
import { BUILDING_COLOR, BUILDING_NAME, RES_COLOR } from './palette.ts';
import { SCENARIOS, type ScenarioId } from './scenarios.ts';
import { View } from './view.ts';

type ToolInfo = { id: Tool; label: string; key: string; help: string };

const TOOLS: ToolInfo[] = [
  { id: 'select', label: 'Select', key: '1', help: 'Click things to inspect them. Drag to pan, wheel to zoom. Everything starts from the castle.' },
  { id: 'flag', label: 'Flag', key: '2', help: 'Click ground to place a flag. On a road it cuts the road in two: shorter roads carry more, and a branch can start there.' },
  { id: 'road', label: 'Road', key: '3', help: 'Click one flag, then another: a road is routed between them. Click a point on a road to put a flag there and branch off.' },
  { id: 'geologist', label: 'Geologist', key: 'g', help: 'Click a flag on or beside a mountain: a geologist walks there from a storage, probes the rock around it spot by spot with his hammer and leaves a sign at each (ore kind, large or small, or nothing). The signs fade after a while. Without him the ore is hidden.' },
  { id: 'demolish', label: 'Demolish', key: 'x', help: 'Click a building (it burns, its stock is lost), a flag (joins its two roads), or a road (its carriers go home). Nothing is refunded.' },
];

/** Construction sites, in the order of the economy: wood, stone, food, mining. */
const BUILD: ToolInfo[] = [
  { id: 'lumberjack', label: 'Lumberjack', key: '4', help: 'Needs 2 planks. Fells trees within 6 steps, so build it next to a forest.' },
  { id: 'forester', label: 'Forester', key: '5', help: 'Needs 2 planks. Plants saplings within 5 steps; they take a while to grow into trees. Build it by a lumberjack so the forest never runs out.' },
  { id: 'sawmill', label: 'Sawmill', key: '6', help: 'Needs 2 planks and 1 stone. Turns lumber into planks.' },
  { id: 'stonecutter', label: 'Stonecutter', key: '7', help: 'Needs 2 planks. Chips rocks within 6 steps for stone.' },
  { id: 'storage', label: 'Storage', key: '8', help: 'Needs 3 planks and 2 stone. A second place to keep and send out goods.' },
  { id: 'fisher', label: 'Fisher', key: '9', help: 'Needs 2 planks. Catches fish; build it within 5 steps of water, at the shore if you like. Fish feed mines.' },
  { id: 'farm', label: 'Farm', key: '0', help: 'Needs 3 planks and 1 stone. Sows fields within 4 steps, waits for them to ripen and cuts them: wheat for the mill. Needs free grass.' },
  { id: 'well', label: 'Well', key: 'q', help: 'Needs 1 plank and 1 stone. Draws water for the baker.' },
  { id: 'mill', label: 'Mill', key: 'w', help: 'Needs 2 planks and 2 stone. Grinds wheat into flour.' },
  { id: 'baker', label: 'Baker', key: 'e', help: 'Needs 2 planks and 2 stone. Bakes bread from flour and water. Bread feeds mines.' },
  { id: 'stonemine', label: 'Stone mine', key: 'r', help: 'Needs 3 planks. Goes on a mountain; a grey sign from a geologist says there is stone under it. Eats one fish or bread for every stone it digs out: without food it stops, and when the ore within 3 steps is used up it stops for good.' },
  { id: 'coalmine', label: 'Coal mine', key: 't', help: 'Needs 3 planks. Goes on a mountain; a black sign from a geologist says there is coal under it. Eats food like every mine; its coal feeds the smelters.' },
  { id: 'ironmine', label: 'Iron mine', key: 'y', help: 'Needs 3 planks. Goes on a mountain; a rust sign from a geologist says there is iron under it. Eats food; the ore goes to an iron smelter.' },
  { id: 'goldmine', label: 'Gold mine', key: 'u', help: 'Needs 3 planks. Goes on a mountain; a yellow sign from a geologist says there is gold under it. Eats food; the ore goes to a gold smelter.' },
  { id: 'ironsmelter', label: 'Iron smelter', key: 'i', help: 'Needs 2 planks and 2 stone. Melts one iron ore with one coal into one iron.' },
  { id: 'toolmaker', label: 'Toolmaker', key: 'p', help: 'Needs 3 planks and 2 stone. Makes a tool from one iron and one plank. Every new worker needs a tool; a demolished building gives its tool back.' },
  { id: 'goldsmelter', label: 'Gold smelter', key: 'o', help: 'Needs 2 planks and 2 stone. Melts one gold ore with one coal into one gold.' },
];

const ALL_TOOLS: ToolInfo[] = [...TOOLS, ...BUILD];

const SPEEDS: { label: string; speed: number }[] = [
  { label: '1×', speed: 2 },
  { label: '2×', speed: 4 },
  { label: '4×', speed: 8 },
  { label: '8×', speed: 16 },
];

const B_STATE = ['Idle', 'Working', 'Output blocked', 'Nothing in range', 'Worker on his way'];
/** The state to show: a worker waiting for a tool has not set out yet. */
const stateLabel = (g: Game, b: Building): string =>
  b.state === BState.Arriving && g.tools && b.builderHome < 0 ? `Waiting for ${a(toolName(b.type))}` : B_STATE[b.state]!;
const nameOf = (r: Res): string => RES_NAMES[r as number] ?? '';
const toolName = (type: BuildingType): string | undefined => {
  const t = toolFor(type);
  return t === Res.None ? undefined : RES_NAMES[t];
};
const a = (word: string | undefined): string => (word ? `${'aeiou'.includes(word[0]!) ? 'an' : 'a'} ${word}` : 'a tool');
const BUILDER_STATE = ['none', 'walking in', 'building'];

function useApp(app: App): void {
  const [, setV] = useState(0);
  useEffect(() => app.subscribe(() => setV((v) => v + 1)), [app]);
}

export function Root({ app }: { app: App }) {
  useApp(app);
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View | null>(null);

  useEffect(() => {
    const view = new View();
    let alive = true;
    void view.init(host.current!, app).then(() => {
      if (!alive) view.dispose();
      else {
        viewRef.current = view;
        if (import.meta.env.DEV) (window as unknown as { __view: View }).__view = view; // for tests and tooling
      }
    });
    return () => {
      alive = false;
      viewRef.current = null;
    };
  }, [app]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'SELECT' || app.screen === 'menu') return;
      if (e.key === ' ') {
        e.preventDefault();
        app.togglePause();
      } else if (e.key === 'Escape') {
        app.setTool('select');
      } else if (e.key === 'f') {
        viewRef.current?.fit();
      } else if (e.key === 'h') {
        viewRef.current?.home();
      } else {
        const t = ALL_TOOLS.find((x) => x.key === e.key);
        if (t) app.setTool(t.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);

  // The tab can be closed or hidden without another frame: save then.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') app.saveNow();
    };
    const onPageHide = () => app.saveNow();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [app]);

  const g = app.game;
  const startNew = () => {
    if (!app.canContinue || window.confirm('Start a new game? Your saved game will be replaced.')) app.newGame();
  };
  const tool = ALL_TOOLS.find((t) => t.id === app.tool)!;
  return (
    <div class="shell">
      <div class="topbar">
        <h1>Settlers remake</h1>
        <button title="Back to the main screen" onClick={() => app.openMenu()}>☰ Menu</button>
        <div class="group">
          <span class="label">Tool</span>
          {TOOLS.map((t) => (
            <button
              key={t.id}
              class={app.tool === t.id ? 'active' : ''}
              title={`${t.help} [${t.key}]`}
              onClick={() => app.setTool(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div class="group palette">
          <span class="label">Build</span>
          {BUILD.map((t) => (
            <button
              key={t.id}
              class={app.tool === t.id ? 'active' : ''}
              title={`${t.help} [${t.key}]`}
              onClick={() => app.setTool(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div class="group">
          <span class="label">Speed</span>
          <button class={g.speed === 0 ? 'active' : ''} title="[space]" onClick={() => app.togglePause()}>
            {g.speed === 0 ? '▶ Paused' : '❚❚'}
          </button>
          {SPEEDS.map((s) => (
            <button key={s.speed} class={g.speed === s.speed ? 'active' : ''} onClick={() => app.setSpeed(s.speed)}>
              {s.label}
            </button>
          ))}
        </div>
        <div class="group">
          <span class="label">Game</span>
          <select
            value=""
            title="Other starting maps"
            onChange={(e) => {
              const id = (e.currentTarget.value || '') as ScenarioId | '';
              if (id && (app.game.tick === 0 || window.confirm('Start over? Your saved game will be replaced.'))) app.loadScenario(id);
              e.currentTarget.value = '';
            }}
          >
            <option value="">New game…</option>
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id} title={s.help}>
                {s.name}
              </option>
            ))}
          </select>
          {app.lastSaved !== null && (
            <span class="saved" title="The game is saved in this browser as you play">
              saved {new Date(app.lastSaved).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
      </div>
      {app.screen === 'menu' && (
        <div class="menu" role="dialog" aria-label="Main screen">
          <div class="menu-card">
            <h1>Settlers remake</h1>
            <p class="menu-sub">Roads, carriers and a growing colony.</p>
            <button class="primary" onClick={startNew}>New game</button>
            <button class="primary" disabled={!app.canContinue} onClick={() => app.continueGame()}>
              Continue game
            </button>
            <p class="menu-note">
              {app.lastSaved !== null
                ? `Saved ${new Date(app.lastSaved).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
                : app.canContinue
                  ? 'Game in progress (not saved: this browser blocks storage).'
                  : 'No saved game yet.'}
            </p>
            {app.toast && <p class="menu-note bad">{app.toast}</p>}
          </div>
        </div>
      )}
      <div class="stage">
        <div class="canvas-host" ref={host}>
          <FlagMenu app={app} viewRef={viewRef} host={host} />
          <div class={app.toast ? 'toast' : 'toast hint'}>
            {app.toast || tool.help}
            {app.hoverInfo() && <div class="hint">{app.hoverInfo()}</div>}
          </div>
        </div>
        <div class="side">
          <Stats game={g} />
          <FoodSliders app={app} />
          <ToolSliders app={app} />
          <Inspector app={app} />
        </div>
      </div>
    </div>
  );
}

const ICONS: Record<'road' | 'geologist' | 'demolish', preact.ComponentChildren> = {
  road: (
    <>
      <path d="M5 21 C 9 13, 4 9, 11 3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
      <path d="M17 21 C 21 13, 16 9, 22 3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
      <path d="M11 19 L 14 15 M 12 11 L 15 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
    </>
  ),
  geologist: (
    <>
      <path d="M5 21 L 15 9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
      <path d="M8 6 Q 16 2 22 10 M 9 7 L 12 10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
    </>
  ),
  demolish: (
    <>
      <path d="M6 6 L 20 20 M 20 6 L 6 20" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
    </>
  ),
};

/**
 * A radial menu round a flag: one round button per thing the flag can do, laid
 * out on a circle and following the flag as the map moves. Greyed ones say why
 * on hover. Opened by clicking a flag with the Select tool; any other click, Esc
 * or choosing an item closes it.
 */
function FlagMenu({ app, viewRef, host }: { app: App; viewRef: { current: View | null }; host: { current: HTMLDivElement | null } }) {
  const root = useRef<HTMLDivElement>(null);
  const flag = app.menu?.flag ?? -1;
  useEffect(() => {
    if (flag < 0) return;
    let raf = 0;
    const place = () => {
      const view = viewRef.current;
      const el = root.current;
      const h = host.current;
      const f = app.game.flags[flag];
      if (view && el && h && f && !f.removed) {
        const r = h.getBoundingClientRect();
        const p = view.screenOf(f.pos);
        const R = 84; // room for the ring of buttons
        const x = Math.max(R, Math.min(r.width - R, p.x - r.left));
        const y = Math.max(R, Math.min(r.height - R, p.y - r.top - 6));
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      }
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [flag, app, viewRef, host]);
  if (flag < 0) return null;
  const actions = app.flagActions(flag);
  const n = actions.length;
  return (
    <div class="radial" ref={root} role="menu" aria-label="Flag">
      <div class="radial-ring" />
      {actions.map((a, i) => {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(3, n) + (n < 3 ? Math.PI / 6 : 0);
        const x = Math.cos(angle) * 56;
        const y = Math.sin(angle) * 56;
        return (
          <button
            key={a.id}
            role="menuitem"
            class={`radial-item${a.enabled ? '' : ' off'}`}
            style={{ left: `${x}px`, top: `${y}px`, animationDelay: `${i * 40}ms` }}
            title={a.enabled ? a.label : `${a.label}: ${a.reason}`}
            aria-disabled={!a.enabled}
            onClick={() => app.chooseFlagAction(a.id)}
          >
            <svg viewBox="0 0 26 26" width="24" height="24" aria-hidden="true">
              {ICONS[a.id]}
            </svg>
            <span>{a.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** How the food on offer is split between the mines: one slider per kind that has a mine. */
function FoodSliders({ app }: { app: App }) {
  const g = app.game;
  const kinds = [OreKind.Stone, OreKind.Coal, OreKind.Iron, OreKind.Gold].filter((k) => g.buildings.some((b) => !b.removed && oreKindOf(b.type) === k));
  if (kinds.length === 0) return null;
  return (
    <section>
      <h2>Food for the mines</h2>
      {kinds.map((k) => (
        <label class="slider" key={k}>
          <span>{ORE_NAMES[k]}</span>
          <input
            type="range"
            min={0}
            max={FOOD_MAX}
            step={1}
            value={g.foodShare[k]}
            onInput={(e) => app.setFoodShare(k, Number(e.currentTarget.value))}
          />
          <span class="value">{g.foodShare[k]}</span>
        </label>
      ))}
      <p class="hint">
        {kinds.length > 1
          ? 'A mine with a bigger share is fed first; at 0 it gets no fish or bread.'
          : 'Only one kind of mine so far: the slider matters once there are two.'}
      </p>
    </section>
  );
}

/** What the toolmakers should make: one slider per tool, shown once a toolmaker exists. */
function ToolSliders({ app }: { app: App }) {
  const g = app.game;
  if (!g.buildings.some((b) => !b.removed && b.type === BuildingType.Toolmaker)) return null;
  return (
    <section>
      <h2>Tools to make</h2>
      {TOOL_KINDS.map((k, i) => (
        <label class="slider" key={k}>
          <span>{nameOf(k)}</span>
          <input type="range" min={0} max={TOOL_MAX} step={1} value={g.toolShare[i]} onInput={(e) => app.setToolShare(k, Number(e.currentTarget.value))} />
          <span class="value">{g.toolShare[i]}</span>
        </label>
      ))}
      <p class="hint">The toolmaker makes the tool furthest below its share; a worker waiting for one counts extra. At 0 it never makes it.</p>
    </section>
  );
}

/** "2 fields growing, 1 ripe" around a farm. */
function farmFields(game: Game, b: Building): string {
  const o = game.objects!;
  const origin = b.pos >= 0 ? b.pos : game.flags[b.flag]!.pos;
  let growing = 0;
  let ripe = 0;
  for (let p = 0; p < o.kind.length; p++) {
    const k = o.kind[p];
    if (k !== MapObject.Field && k !== MapObject.Wheat) continue;
    if (distanceBetween(game.cols, origin, p) > FIELD_RADIUS) continue;
    if (k === MapObject.Field) growing++;
    else ripe++;
  }
  return `Fields within reach: ${growing} growing, ${ripe} ripe (up to ${MAX_FIELDS}).`;
}

function Stats({ game }: { game: Game }) {
  const stored = new Array<number>(RES_COUNT).fill(0);
  const sites = new Array<number>(RES_COUNT).fill(0);
  const inBuildings = new Array<number>(RES_COUNT).fill(0);
  const moving = new Array<number>(RES_COUNT).fill(0);
  const waiting = new Array<number>(RES_COUNT).fill(0); // workers waiting for this tool
  for (const b of game.buildings) {
    if (b.removed) continue;
    for (let r = 0; r < RES_COUNT; r++) {
      if (acceptsAll(b)) stored[r]! += b.stock[r]!;
      else if (b.constructing) sites[r]! += b.stock[r]!;
      else inBuildings[r]! += b.stock[r]!;
    }
    const tool = toolFor(b.type);
    if (tool !== Res.None && b.hasTool) inBuildings[tool]!++; // in a worker's hands
    if (tool !== Res.None && !b.constructing && b.state === BState.Arriving && b.builderHome < 0 && !b.hasTool) waiting[tool]!++;
  }
  for (const f of game.flags) for (const it of f.slot) if (it.type >= 0) moving[it.type]!++;
  const crew = game.transporters.filter((t) => !t.gone);
  for (const t of crew) if (t.item.type >= 0) moving[t.item.type]!++;
  const arriving = crew.filter((t) => t.state === TState.Arriving).length;
  const trees = game.objects?.count(MapObject.Tree);
  const saplings = game.objects?.count(MapObject.Sapling) ?? 0;
  let rockUnits = 0;
  if (game.objects) {
    for (let p = 0; p < game.objects.kind.length; p++) {
      if (game.objects.kind[p] === MapObject.Stone) rockUnits += game.objects.amount[p]!;
    }
  }
  return (
    <section>
      <h2>Economy</h2>
      <p class="hint wealth" title="Gold in storages is the score: it has no other use yet">
        Wealth: {stored[Res.Gold]} gold
      </p>
      <table>
        <thead>
          <tr>
            <th />
            <th title="in finished storages">stored</th>
            <th title="on flags or carried">moving</th>
            <th title="in sawmills and construction sites">used</th>
            <th title="made by buildings">made</th>
          </tr>
        </thead>
        <tbody>
          {RES_NAMES.map((name, r) => ({ name, r }))
            .filter(({ r }) => !isTool(r as Res) && (r < 3 || game.created[r]! > 0 || stored[r]! + moving[r]! + inBuildings[r]! + sites[r]! > 0))
            .map(({ name, r }) => (
            <tr key={name}>
              <td>
                <span class="dot" style={{ background: `#${RES_COLOR[r]!.toString(16).padStart(6, '0')}` }} />
                {name}
              </td>
              <td>{stored[r]}</td>
              <td>{moving[r]}</td>
              <td>{inBuildings[r]! + sites[r]!}</td>
              <td>{game.created[r]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {TOOL_KINDS.some((k) => game.created[k]! > 0 || stored[k]! > 0) && (
        <table class="tools" title="tools in storages, and in the hands of workers">
          <thead>
            <tr>
              <th>tools</th>
              <th>stored</th>
              <th>in hand</th>
              <th>waiting</th>
            </tr>
          </thead>
          <tbody>
            {TOOL_KINDS.map((k) => (
              <tr key={k}>
                <td>{nameOf(k)}</td>
                <td>{stored[k]}</td>
                <td>{inBuildings[k]}</td>
                <td class={waiting[k]! > 0 ? 'full' : ''}>{waiting[k]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {game.objects && (
        <p class="hint">
          On the map: {trees} trees{saplings > 0 ? ` (+${saplings} growing)` : ''}, {rockUnits} rock units left
        </p>
      )}
      {game.lost.some((n) => n > 0) && (
        <p class="hint">
          Lost to demolition: {RES_NAMES.map((n, r) => `${game.lost[r]} ${n}`).join(', ')}
        </p>
      )}
      <p class="hint">
        {crew.length - arriving} carriers working, {arriving} on the way · tick {game.tick} ·{' '}
        {game.flags.filter((f) => !f.removed).length} flags, {game.roads.filter((r) => !r.removed).length} roads,{' '}
        {game.buildings.filter((b) => !b.removed).length} buildings
      </p>
    </section>
  );
}

function Inspector({ app }: { app: App }) {
  const g = app.game;
  const sel = app.selection;
  if (!sel) {
    return (
      <section>
        <h2>Inspector</h2>
        <p class="hint">Pick the Select tool and click a flag, building or road.</p>
      </section>
    );
  }

  if (sel.kind === 'building') {
    const b = g.buildings[sel.index]!;
    return (
      <section>
        <h2>
          <span class="dot" style={{ background: `#${BUILDING_COLOR[b.type]!.toString(16).padStart(6, '0')}` }} />
          {BUILDING_NAME[b.type]}
          {b.constructing ? ' (under construction)' : ''}
          {b.burning > 0 ? ' (burning)' : ''}
        </h2>
        <div class="kv">
          <span>Flag</span>
          <span>#{b.flag}</span>
          {b.constructing ? (
            <>
              <span>Builder</span>
              <span>{BUILDER_STATE[b.builder]}</span>
            </>
          ) : isStore(b) ? (
            <>
              <span>Holds</span>
              <span>{b.capacity > 0 ? `up to ${b.capacity} of each` : 'any amount'}</span>
              <span>Carriers left</span>
              <span>{b.carriers}</span>
              <span>Builders left</span>
              <span>{b.builders}</span>
            </>
          ) : (
            <>
              <span>State</span>
              <span>
                <span class={`badge ${b.state === BState.OutputBlocked || b.state === BState.NoResource ? 'bad' : b.state === BState.Working ? 'ok' : ''}`}>
                  {stateLabel(g, b)}
                </span>
              </span>
            </>
          )}
        </div>
        <table>
          <thead>
            <tr>
              <th />
              <th>stock</th>
              <th>ordered</th>
              {b.constructing && <th>built in</th>}
              {b.constructing && <th>needs</th>}
            </tr>
          </thead>
          <tbody>
            {RES_NAMES.map((name, r) => {
              const relevant = b.stock[r]! || b.requested[r]! || b.inGroups.some((g) => g.includes(r as Res)) || (b.constructing && (b.need[r]! || b.used[r]!));
              if (!relevant && !acceptsAll(b)) return null;
              return (
                <tr key={name}>
                  <td>{name}</td>
                  <td class={b.capacity > 0 && b.stock[r]! >= b.capacity ? 'full' : ''}>
                    {b.stock[r]}
                    {b.capacity > 0 ? ` / ${b.capacity}` : ''}
                  </td>
                  <td>{acceptsAll(b) ? b.incoming[r] : b.requested[r]}</td>
                  {b.constructing && <td>{b.used[r]}</td>}
                  {b.constructing && <td>{b.need[r]}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {b.state === BState.NoResource && !b.constructing && (
          <p class="hint">
            {b.type === BuildingType.Forester
              ? 'No free grass within 5 steps to plant on. It looks again now and then.'
              : oreKindOf(b.type) !== OreKind.None
                ? `The rock around this mine is worked out: no ${ORE_NAMES[oreKindOf(b.type)]} ore left within 3 steps. It stays idle for good.`
                : b.type === BuildingType.Farm
                  ? 'No room for another field within 4 steps, and none is ripe yet. It looks again now and then.'
                  : `No ${harvestKindOf(b.type) === MapObject.Tree ? 'trees' : 'rocks'} within 6 steps. Build it nearer to some, or it stays idle.`}
          </p>
        )}
        {g.objects && !b.constructing && oreKindOf(b.type) !== OreKind.None && (
          <p class="hint">
            {ORE_NAMES[oreKindOf(b.type)]} ore left within reach: {g.objects.oreNear(b.pos >= 0 ? b.pos : g.flags[b.flag]!.pos, oreKindOf(b.type))} units.
          </p>
        )}
        {g.objects && !b.constructing && b.type === BuildingType.Farm && (
          <p class="hint">{farmFields(g, b)}</p>
        )}
        {b.target >= 0 && !b.constructing && (
          <p class="hint">
            {b.type === BuildingType.Forester ? 'Planting at' : 'Working at'} {b.target % g.cols},{' '}
            {Math.floor(b.target / g.cols)} (the highlighted{' '}
            {b.type === BuildingType.Forester ? 'spot' : harvestKindOf(b.type) === MapObject.Tree ? 'tree' : 'rock'}).
          </p>
        )}
        {!b.constructing && g.tools && b.state === BState.Arriving && b.builderHome < 0 && (
          <p class="hint">
            No {toolName(b.type) ?? 'tool'} in any storage connected by road. A toolmaker makes tools from iron and planks (set the sliders to ask for this one); iron comes from an iron mine and an iron smelter.
          </p>
        )}
        {b.builder === BuilderState.None && b.constructing && (
          <p class="hint">Waiting for a builder: it comes from a storage connected by road.</p>
        )}
      </section>
    );
  }

  if (sel.kind === 'flag') {
    const f = g.flags[sel.index]!;
    const items = f.slot.filter((it) => it.type >= 0);
    return (
      <section>
        <h2>Flag #{f.index}</h2>
        <div class="kv">
          <span>Position</span>
          <span>
            {f.pos % g.cols}, {Math.floor(f.pos / g.cols)}
          </span>
          <span>Roads</span>
          <span>{f.road.filter((r) => r >= 0).length}</span>
          <span>Waiting</span>
          <span>{items.length} / 8</span>
        </div>
        {items.map((it, i) => (
          <div key={i} class="hint">
            {RES_NAMES[it.type as number]} → flag #{it.dest < 0 ? '?' : it.dest}
          </div>
        ))}
      </section>
    );
  }

  const r = g.roads[sel.index]!;
  const carried = r.carriers.map((ti) => g.transporters[ti]!).filter((t) => t.item.type >= 0).length;
  return (
    <section>
      <h2>Road #{r.index}</h2>
      <div class="kv">
        <span>Between</span>
        <span>
          #{r.flag[0]} and #{r.flag[1]}
        </span>
        <span>Length</span>
        <span>{r.length} tiles</span>
        <span>Carriers</span>
        <span>
          {r.carriers.length} / {r.dynamic ? Game.maxCarriers(r.length) : 'fixed'}
        </span>
        <span>Carrying now</span>
        <span>{carried}</span>
      </div>
      <p class="hint">Busy roads call more carriers, up to a cap by length. Split long roads with flags.</p>
    </section>
  );
}
