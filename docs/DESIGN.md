# Design notes

The full rules and numbers behind the game, kept from development. For an overview, see the [README](../README.md); screenshots live in `docs/screenshots`.

(Paths below are from the repository root.)

---

# Pioneers (design notes)

A browser remake of *The Settlers* (Blue Byte, 1993), built around the part
that makes it that game: the road-and-carrier economy. Own art and code; no
original assets are used or needed.

```
packages/sim      pure TypeScript simulation (no DOM), tests, parity fixture
packages/client   Vite + PixiJS + Preact viewer and editor
logistics/        C++ reference of the simulation (the test oracle)
skeleton/         the original minimal fixed-step loop sketch
ref/freeserf/     Freeserf checkout, read-only reference (GPL, not copied from)
```

## Run

```sh
pnpm install
pnpm dev            # http://localhost:5173 (next free port if taken)
pnpm test           # sim tests: behaviour + exact parity with the C++ reference
pnpm typecheck
pnpm build          # static site in packages/client/dist
```

The page opens on a **main screen** with *New game* and *Continue game* when there is no saved game; with one, you play straight on (the *Menu* button brings the screen back). Continue is
off until there is a game to return to (a saved one, or one begun this session);
New game asks before replacing a saved game. Nothing runs or is saved while the screen
is up. The *Menu* button in the top bar returns to it (and saves first).

Controls: `1`-`3` select / flag / road, `4`-`9`, `0`, `q`, `w`, `e`, `r`, `t`, `y`, `u`, `i`, `p`, `o` the building sites in the order of the Build row, `g` geologist, `x` demolish, `space` pauses, `Esc` selects, wheel zooms, drag
pans, `f` fits the whole map, `h` returns to the castle. With a building tool
active every valid spot is marked; the Road tool also accepts a click on a
point of a road (it puts a flag there and branches off); hovering shows a ghost with its footprint
and door flag, and says why a spot is refused. A new game starts, as in the original, with only the **castle**: it holds
the starting planks and stone, sends goods out, and supplies every carrier and
builder. Put flags and roads down from it, add construction sites and connect
them. (There is only ever one castle, and it can't be built.)

## How it fits together

- **Sim** (`packages/sim`): hex grid with integer terrain heights, flags with 8
  item slots, roads,
  transporters hired on demand from storages, buildings that produce and
  consume, construction sites with builders, storage dispatch. Integers only,
  no RNG, fixed update order: flags, then buildings, then transporters.
  State is plain data (JSON-serialisable).
- **Client** (`packages/client`): `App` owns the game, the 50 Hz fixed-step
  loop (up to 5 catch-up steps), the tools and every command. `View` reads the
  sim each frame and draws it, interpolating carriers between steps from their
  counters. Panels are Preact. The renderer never mutates the sim.
- **Terrain and placement** (`terrain.ts`, `placement.ts`): each map point has
  a height; water, grass and mountain are derived from it. Buildings are small
  or large (large covers four points), need level grass around them, a door
  flag down-right of their point, and clear ground; flags need space from other
  flags; roads can't cross water or climb too steeply. Every refusal carries a
  reason. `generateTerrain` builds a seeded map with a fixed mix of water,
  grass and mountain; `flattenArea` levels a start area. This layer exists only
  in TypeScript and, with flat terrain, changes no economy number.
- **Flags on roads**: a flag can go on any point of a road, corners included,
  as long as it is two steps from the next flag. It cuts the road in two, and
  a new road can branch from it, which is how roads fork. Items are never lost:
  those on flags keep their destination and route through the new flag; a
  carrier goes with the half it is on, with its remaining time rescaled, and a
  half left without one hires another. Shorter roads also carry more, since one
  carrier's round trip is shorter. This exists only in TypeScript.
- **Saving**: the game is kept in the browser's localStorage under `sett.save`
  (about 10 KB) and loaded when the page opens. It is written about a second after
  your last command (a burst of clicks is one write), every 10 s while the game runs,
  when you start a new game, and when the tab is hidden or closed. Looking around
  with the Select tool, or a paused game, writes nothing. The save is the sim's
  plain-data state (`Game.serialize()` / `Game.restore()`): heights, objects, flags,
  roads, buildings, carriers, counters. The lookup tables (what stands on each
  point) are rebuilt on load. Tests restore a game at many moments and check it
  then runs exactly like the original. A save that cannot be read (damaged, wrong
  version) is set aside under `sett.save.broken` and a new game starts, with a
  message. If the browser refuses to write (full, blocked) you are told once and the
  game goes on. One slot, one tab: two tabs overwrite each other. The camera, the
  selected tool and the selection are not saved.
- **Food and mining**: as in the original, only **mines eat**; carriers and every other
  worker never do. A mine uses one fish, bread *or* meat per unit it digs, and stops without. Fish
  come from a *fisher* (within 5 steps of water, may stand at the shore, the lake never runs
  dry); bread from a *baker* (flour from a *mill*, wheat from a *farm*, plus water from a
  *well*, one unit of each per loaf); meat from a *butcher*, who turns the pigs of a *pig farm*
  (one wheat and one water per pig) into meat, one for one. The wheat is shared: mill and pig
  farm both ask for it. A building can have several inputs, and an input can
  be a group of interchangeable goods (`Building.inGroups`); the baker waits until it has
  all of them, and a mine counts fish and bread together towards what it will stock.
  The *Food and mining* scenario has the whole chain built. The C++ fingerprint covers only
  the first three resources (`PARITY_RES`). TypeScript only.
- **Four kinds of ore, smelting, the food slider**: under the mountains lie stone, coal, iron
  and gold ore (`OreKind`, in regions). Each mine digs only its own kind within 3 steps:
  *stone mine* (stone), *coal mine* (coal), *iron mine* (iron ore), *gold mine* (gold ore). An *iron smelter* melts one iron ore and one coal into one iron, a *gold
  smelter* one gold ore and one coal into one gold; they wait for both. Iron and gold have
  no use yet (no tools, weapons or coins). The **food slider** (side panel, one per kind of
  mine that exists, 0 to 10) says how the fish and bread on offer are shared: a mine with a
  bigger share is served first, one at 0 gets none (`Game.setFoodShare`, `Building.foodWeight`;
  it scales only the mines' food priority, so with plenty of food it changes nothing). Saves
  from before kinds of ore read all their ore as stone. TypeScript only.
- **Ore and fields**: on a map with objects, a **stone mine** digs from the ore under the
  mountain points within 3 steps (`ORE_RADIUS`). Each stone costs one unit and one fish or
  bread; the ore never comes back, and a mine with none in reach stops for good without eating
  ("worked out"). Ore is generated in clusters under mountains (about 45% of mountain points,
  6 to 14 units each, `generateObjects`) and is **hidden**: only a geologist's signs show it
  (next item). A mine can be placed on any mountain, ore or not. A **farm** works fields within 4 steps (`FIELD_RADIUS`): it
  cuts the nearest ripe field (wheat to deliver, the ground is free again), otherwise sows
  a new one on free grass while fewer than 6 (`MAX_FIELDS`) stand within reach, otherwise
  waits. A sown field ripens in 3000 ticks (`FIELD_TICKS`) and blocks building like a tree;
  lumberjacks ignore it. A game with no object layer keeps the old behaviour (farms just make
  wheat, mines need no ore), which is what the C++ parity runs model. A save from before ore
  loads with none. TypeScript only.
- **Tools** (`game.tools`, on in the client's games): every worker needs the tool of his
  trade, taken from a storage when he is sent out and handed back when his building is
  demolished. Eight kinds (`TOOL_KINDS`): axe (lumberjack), pick (stonecutter and all mines),
  shovel (forester), rod (fisher), scythe (farm), saw (sawmill), hammer (smelters and the
  toolmaker), cleaver (butcher); wells, mills, bakers, pig farms, storages and carriers need none (`toolFor`). A finished
  building whose worker finds his tool in no storage by road waits ("Waiting for a rod", and
  the Economy panel shows it under *waiting*), and sets out the moment one turns up. The
  **toolmaker** makes one tool from one iron and one plank. *Which* tool: each kind has a
  slider (0 to 10, panel "Tools to make"); it makes the kind furthest below its share
  (weight over 1 + the number in storages), a building waiting for a kind counts as 20 more
  votes, and at 0 a kind is never made (`Game.chooseTool`, `setToolShare`). The new game
  starts with 2 or 3 of each kind in the castle. A building placed finished by a script comes
  with its tool. **Gold** has no use yet beyond the *Wealth* line (gold in storages): the
  original spent it on knights, and there is no military here. Off by default (the C++
  reference has none); a save from before tools loads with them off, and a save from before
  there were this many resources gets the new ones at zero. TypeScript only.
- **Workers walk in** (`game.settlers`, on in the client's games): a finished building is
  empty until its worker has walked over from the nearest storage by road, at carrier speed,
  as in the original; with no road to a storage he waits. Stores have no walk. The same
  switch lets **spare carriers go home**: a road with two or more carriers hires another when
  3 items wait at an end (up to a cap by length); one that has stood idle for `IDLE_RELEASE`
  (1500 ticks) with nothing waiting at either end walks to the nearest storage and rejoins its
  crew, so it can be hired again. A road always keeps one. Off by default (the C++ reference
  starts work at once and never sends carriers home). TypeScript only.
- **The little people** (`people.ts`): every walker is one small figure built from vector
  shapes, no image files. `pose()` is a pure function from action (walk, idle, work), cycle
  phase and facing to joint positions (tested without a canvas); `drawPerson()` paints them and
  dresses them by trade (carrier, builder, lumberjack, stonecutter, forester, fisher, farmer,
  miller, baker, sawyer, miner, smelter, smith, waterman). Feet follow the distance walked, so
  they do not slide; figures face the way they go and carry their load in front; idle carriers
  breathe; harvesters swing their tool at the tree or rock, foresters and farmers stoop, builders
  walk over (letter `Bu`) and hammer beside the site, and an indoor trade shows its worker busy
  beside the door while the building works. A new worker is drawn walking the road from the
  storage with his trade's letter over his head (`WORKER_LETTER`), and a spare carrier is drawn
  walking home.
- **Roads** (`roads.ts`, drawn in `view.ts`): a road is a smooth curve through its map points (Catmull-Rom,
  so the hex staircase has no corners), with two edges whose widths wander on their own (slow bends and quick
  bumps), so the road looks worn into the land, never ruled across it. It has a soft pale fringe (no hard
  border) and a light dirt surface, lighter than the ground round it so it shows on every terrain, in strips that follow the ground (pale on the beach, gravel on the rock) filled with a
  texture tile, faint wheel ruts, pebbles, stones at the edge and tufts of grass beside it, and an uneven
  trodden patch at every flag. Each building has a short footpath from its door to its flag in the same
  style. The picture is built only when roads, flags or buildings change. Carriers and walking people
  follow the same curve, not the straight steps. Pure geometry, tested (edge sides, widths, smoothness,
  determinism, normals).
- **Buildings** (`buildings.ts`): each of the 20 buildings is drawn from vector shapes in the ground's
  isometric view, from shared pieces (walls of boards, logs, stone, brick or plaster on a stone footing;
  gabled and hipped roofs with shingles; doors, windows with lit glass, chimneys) plus its own trade's props
  and life. Lumberjack: log cabin, chopping block with a swinging axe, log pile. Forester: mossy hut,
  seedbeds, watering can. Sawmill: open shed with a spinning saw blade, plank stacks, sawdust. Stonecutter:
  stone house, bench with a tapping chisel, heaps of stone. Storage: warehouse with double doors, a swinging
  hoist, barrels and crates. Castle: gatehouse with portcullis, arrow slits, two cone-roofed towers and
  waving banners. Fisher: hut, drying net, upturned boat, a rod. Farm: half-timbered farmhouse, haystack,
  fence, wheat. Well: stone ring, roof, rope and a bobbing bucket. Mill: cottage with four turning sails and
  flour dust. Baker: brick house, oven chimney, a stall of loaves. Pig farm: a red barn with a fenced mud pen where pink pigs trot about, a trough and a haystack. Butcher: a shop with a striped awning, hanging sausages, a chopping block with a cleaver and a sign. The four mines: a hillside with a
  timbered entrance, lantern, rails and a cart of their ore. Smelters: furnace with a flickering glow,
  tall chimney, ingots of their metal. Toolmaker: workshop with tools on the wall and a hammer on an anvil.
  A working building smokes, turns or glows; one at rest is quiet. A site goes through stages: foundation
  with the delivered planks and stones beside it, a timber frame rising with a ladder, then the finished
  building under scaffolding. Pure functions of their arguments, tested on a recording canvas (all
  buildings, all states: finite coordinates, near the footprint, plenty of detail, stages differ).
- **The landscape** (`art.ts`, drawn in `view.ts`; nothing here touches the sim): the ground
  is built once per game from triangles, four to a half cell (sixteen where the ground
  changes kind, so shores and mountain feet run smoothly). Each is classed from its own
  interpolated height as water, sand, grass or rock, and coloured by height, the light from the
  north-west and soft noise patches: lush to dry grass, shady patches, warm and cool rock with
  strata, snow high up that slides off steep faces. Grass tufts, flowers, hatching and boulders are
  scattered on top. The ground is cut into blocks of 8x8 cells that are skipped when off screen.
  Water is shallow turquoise at the shore and deepens with distance from land (`waterDepths`);
  glints and rings of foam are drawn each frame, only where the screen is looking. Trees come in
  three species in stands (pines on higher ground, oaks low, birches between), two-tone and
  swaying a little in the wind. Colours and noise are pure functions (`art.ts`, tested).
  **Shore and sea** (`coast.ts`): a triangle that crosses the waterline, the beach line or the
  foot of a mountain is cut exactly there (`clipBand`), the waterline cut using a softened height
  so it curves between points instead of running in facets, with a bright foam line along it. The
  island sits in a sea baked once into a picture (`buildSea`: the island's outline filled on a
  canvas, the distance from it worked out for every pixel by a chamfer sweep, `distanceField`, and each
  pixel coloured by `seaColor`: turquoise at the beach to deep navy far out, with broad mottling and
  swells running along the coast), eight times smaller than the screen and stretched back up, so it is
  one smooth gradient; bright glints come and go on it, thinning out far from land. It has with a wavy beach and surf along the map's edge in
  place of a straight cut, the surf breathing in and out. Slow cloud shadows drift over the land,
  and the screen has a light haze at the top and a soft vignette at the edges. All of it is view
  only; the geometry helpers are pure and tested.
  **Ground textures** (`textures.ts`): eight seamless 256 px tiles are made at start-up from
  noise, no image files: grass (clumps, blades, speckle), forest floor, bare earth, sand
  (wind ripples), scree (pebbles), rock (cracked blocks with strata), snow (drifts and sparkle) and
  water (ripples and a net of caustics). They are brightness only; each polygon is filled with
  the tile of its ground, multiplied by its colour, in world space so the pattern runs across
  polygons without seams. The ground kind follows height, slope and noise (gravel on the low
  mountain slopes, bare patches on dry or steep grass, a forest floor under dense trees),
  and the colour blends smoothly where two meet. Tiles are pure functions of the pixel, tested for
  seamlessness, range and character.
- **Flag menu**: click a flag with the Select tool and a radial menu opens round it, following the flag as
  the map moves: *Build* (a flag with no building only), *Road* (starts a road from this flag), *Geologist*
  (only on or beside a mountain; greyed out, with the reason on hover, when no storage is joined by road or no
  hammer is in store) and *Remove flag* (greyed out where the flag cannot go, with the reason). **Build**
  opens a list beside the flag of every building with its cost (planks and stone), the ones that fit with this
  flag as their door first (`App.buildOptions`, which asks the same `checkBuilding` the placement uses) and
  the rest greyed out with the reason they do not fit; picking one puts the site up at once
  (`buildFromMenu`), *Back* returns to the ring. The Build item is greyed out where nothing fits. Any other
  click, another tool or Esc closes the menu; choosing an item closes it and does it. `App.flagActions`
  decides what is offered, so more things (a carrier call) can be added there. The Geologist and Demolish
  tools are still in the toolbar.
- **Geologists** (Geologist tool, `g`; `Game.sendGeologist`, `checkGeologist`): as in the
  original, the ore under the mountains is hidden until a geologist probes it. Click a flag on or
  beside a mountain: a geologist walks there from the nearest storage by road (with tools he takes
  a hammer and brings it back), then, one at a time, picks a random free mountain spot within 5
  steps (`GEO_RADIUS`) that has no sign yet, walks to it, taps with his hammer for 300 ticks
  (`GEO_PROBE_TICKS`) and puts up a **sign**: grey, black, rust or yellow for stone, coal, iron or
  gold, a large plate for 12 units or more and a small one for less, or a cross for nothing. After
  8 spots (`GEO_PROBES`), or when none is left, he walks home. Signs stay 9000 ticks
  (`SIGN_TICKS`, about 90 s at normal speed), fade out, never block building, and are saved. A new
  find of a kind with no sign of that kind within 3 steps is announced ("Your geologist found
  coal!"). Where hovering used to show ore, only signs are shown now. The numbers are
  placeholders. TypeScript only.
- **Foresters and regrowth**: a forester picks a free grass point within 5
  steps (never a road, flag, building or tree), walks out, plants a sapling and
  walks back, about once every 500 ticks plus the walk. A sapling becomes a tree
  after 6000 ticks (`GROW_TICKS`). Saplings block building like trees do but
  lumberjacks ignore them. With no room, it looks again every 128 ticks. A game
  without map objects gives it nothing to do. TypeScript only.
- **Store capacity**: with `game.limits` set (the client's games do, castle 150 and
  storage 30 of each resource, placeholders), a finished store takes no more than
  its limit, counting items already on their way (`incoming`). Surplus goes to
  another storage with room; if none has, it waits on the flags and the producers
  behind back up (their state turns "Output blocked"). Default is unlimited, which
  is what the C++ parity scenarios model. TypeScript only.
- **Demolition** (Demolish tool, `9`): as in the original, nothing is refunded.
  A **road** can be removed anywhere: its carriers lose what they carry and go
  back to a storage, and goods waiting on its flags look for another way (or
  wait). A **flag** can go if it has no building and either no road or exactly
  two roads to different flags; those merge into one (the exact inverse of
  splitting), and goods lying on the flag are lost. A **building** burns for
  about 20 s (`BURN_TICKS`): its stock and unsent output are lost, goods heading
  for it are re-routed, a builder walks home, and the door flag and its roads stay.
  The ground is blocked until the fire is out. The castle can't be demolished.
  `game.lost` counts what was destroyed, so `created = consumed + lost + present`.
  Removed things are marked, not deleted, so indices never shift. TypeScript only.
- **Slopes**: a road step takes `80 + 12 × height change` ticks (kept between
  40 and 160), so a road takes a different time each way. It applies to
  carriers and to the walk of new carriers and builders, and is in the C++
  reference too; on level ground it is exactly the old timing.
- **Trees and rocks** (`objects.ts`): they block buildings, flags and roads.
  A lumberjack or stonecutter claims the nearest free tree or rock within 6
  steps, walks out, works, walks back and delivers one unit; a rock holds
  several units. With nothing in range it idles and looks again. A game without
  an object layer has unlimited resources, which is what the C++ parity
  scenarios model.
- **Parity**: `logistics/` is the C++ original of the logistics economy. `pnpm gen:parity`
  runs it over 19 scenarios and stores the results plus a state fingerprint
  (FNV hash of every flag, carrier, building and counter) in
  `packages/sim/test/fixtures/parity.json`. The TypeScript port must reproduce
  every number exactly, so any change to the model is made in both or
  deliberately re-baselined.

## Known limits

Harvesters' and foresters' own trips ignore slope. The map is a bounded parallelogram (the
original wraps). Placement limits, the large-building footprint and the
castle's size are placeholders. No audio, military or AI. Saving has one slot, and no export or import.
Carriers whose road is removed return to a storage instantly (no walk home),
builders and ordinary carriers never go home otherwise, and carrier caps, build needs and timings
are placeholders. Terrain is drawn once as a triangle mesh; everything else is
vector shapes redrawn each frame, to be replaced by pooled sprites with real
art.
