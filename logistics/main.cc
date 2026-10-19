// Scenario + checks for the logistics slice.
#include <cstdio>
#include <stdexcept>

#include "sim.h"

using namespace sim;

static int failures = 0;
#define CHECK(cond, ...)                                           \
  do {                                                             \
    if (!(cond)) {                                                 \
      failures++;                                                  \
      std::printf("FAIL %s:%d  %s  ", __FILE__, __LINE__, #cond);  \
      std::printf(__VA_ARGS__);                                    \
      std::printf("\n");                                           \
    }                                                              \
  } while (0)

// Every item ever made and not consumed must exist somewhere.
static void check_conservation(const Game &g, const char *when) {
  for (int r = 0; r < kResCount; r++) {
    CHECK(g.created[r] - g.consumed[r] == g.count_items(static_cast<Res>(r)),
          "res %d at %s: created %d consumed %d found %d", r, when,
          g.created[r], g.consumed[r], g.count_items(static_cast<Res>(r)));
  }
  for (const Building &b : g.buildings)
    for (int r = 0; r < kResCount; r++)
      CHECK(b.requested[r] >= 0, "negative requested at building %d", b.index);
}

static void run(Game &g, int steps, bool conserve = true) {
  for (int i = 0; i < steps; i++) {
    g.update();
    if (conserve && i % 25 == 0) check_conservation(g, "mid-run");
  }
  check_conservation(g, "end");
}

// Flags every `seg` tiles along row y from x0 to x1, joined by roads.
static std::vector<int> row(Game &g, int x0, int x1, int y, int seg,
                            int carriers = -1) {
  std::vector<int> f;
  for (int x = x0; x <= x1; x += seg) f.push_back(g.add_flag(x, y));
  for (size_t i = 0; i + 1 < f.size(); i++) {
    g.add_road(f[i], std::vector<Dir>(static_cast<size_t>(seg), Right),
               carriers);
  }
  return f;
}

// Lumberjacks -> sawmill -> storage, with overflow lumber to storage.
// Roads are split every 2 tiles: a lone carrier on a long road needs a
// full round trip per item, so long roads throttle throughput (see
// test_road_capacity).
static void test_chain() {
  Game h(16, 8);
  auto a = row(h, 1, 9, 2, 2, 2);          // flags at x = 1,3,5,7,9
  int j2 = h.add_flag(5, 6);
  int mid = h.add_flag(5, 4);
  h.add_road(j2, {Up, Up}, 2);
  h.add_road(mid, {Up, Up}, 2);               // ends on the sawmill flag (5,2)
  h.add_building(Building::Lumberjack, a[0]);
  h.add_building(Building::Lumberjack, j2);
  int sawmill = h.add_building(Building::Sawmill, a[2]);
  int storage = h.add_building(Building::Storage, a[4]);
  // Two jacks make 1 lumber / 200 ticks; keep the sawmill faster than that.
  h.buildings[sawmill].period = 150;

  run(h, 15000);   // 30000 sim-ticks at speed 2
  std::printf("%s", h.render().c_str());
  std::printf("chain: lumber made %d, planks made %d | storage: lumber %d "
              "planks %d | sawmill stock %d\n",
              h.created[Lumber], h.created[Plank],
              h.buildings[storage].stock[Lumber],
              h.buildings[storage].stock[Plank],
              h.buildings[sawmill].stock[Lumber]);

  CHECK(h.buildings[storage].stock[Plank] >= 120,
        "planks keep flowing (%d)", h.buildings[storage].stock[Plank]);
  CHECK(h.buildings[sawmill].stock[Lumber] <= 8, "sawmill cap respected");
  CHECK(h.created[Plank] <= h.created[Lumber], "no plank without lumber");
  CHECK(h.created[Lumber] >= 140, "producers not blocked (%d)",
        h.created[Lumber]);
}

// Same producer and storage, different road splitting / carrier counts.
static int lumber_made(int seg, int carriers) {
  Game g(20, 4);
  auto f = row(g, 1, 17, 1, seg, carriers);
  g.add_building(Building::Lumberjack, f.front());
  g.add_building(Building::Storage, f.back());
  run(g, 15000);
  return g.created[Lumber];
}

static void test_road_capacity() {
  int split = lumber_made(2, 1), longr = lumber_made(8, 1);
  int busy = lumber_made(8, 3);
  std::printf("throughput: 2-tile %d, 8-tile %d, 8-tile x3 carriers %d\n",
              split, longr, busy);
  CHECK(split >= 70, "short roads keep the producer busy (%d)", split);
  CHECK(longr < split * 8 / 10, "long roads throttle output (%d vs %d)",
        longr, split);
  CHECK(busy > longr, "more carriers raise throughput (%d vs %d)", busy, longr);
}

struct ChainResult {
  int lumber_made = 0, planks_made = 0, planks_stored = 0, lumber_stored = 0;
  int hired = 0, max_on_road = 0, roads_with_none = 0;
};

// Two lumberjacks -> sawmill -> storage, flags every 2 tiles.
static ChainResult run_chain(int carriers, int sawmill_period, int steps) {
  Game h(16, 8);
  auto a = row(h, 1, 9, 2, 2, carriers);
  int j2 = h.add_flag(5, 6), mid = h.add_flag(5, 4);
  h.add_road(j2, {Up, Up}, carriers);
  h.add_road(mid, {Up, Up}, carriers);
  h.add_building(Building::Lumberjack, a[0]);
  h.add_building(Building::Lumberjack, j2);
  int sawmill = h.add_building(Building::Sawmill, a[2]);
  int storage = h.add_building(Building::Storage, a[4]);
  h.buildings[sawmill].period = sawmill_period;
  run(h, steps);
  ChainResult r;
  r.lumber_made = h.created[Lumber];
  r.planks_made = h.created[Plank];
  r.planks_stored = h.buildings[storage].stock[Plank];
  r.lumber_stored = h.buildings[storage].stock[Lumber];
  r.hired = h.hired;
  for (const Road &rd : h.roads) {
    int n = static_cast<int>(rd.carriers.size());
    if (n > r.max_on_road) r.max_on_road = n;
    if (n == 0) r.roads_with_none++;
    CHECK(n <= Game::max_carriers(rd.length), "road %d over cap (%d)",
          rd.index, n);
  }
  return r;
}

// The scenario that gridlocked with one carrier per road: the sawmill is
// slower than the lumberjacks, so surplus lumber also flows to storage.
static void test_hiring_clears_gridlock() {
  ChainResult fixed = run_chain(1, 300, 15000);
  ChainResult dyn = run_chain(-1, 300, 15000);
  std::printf("overflow chain: 1 fixed carrier -> %d planks | hired -> %d "
              "planks, %d surplus lumber stored, %d carriers hired, max %d "
              "on one road\n",
              fixed.planks_made, dyn.planks_made, dyn.lumber_stored, dyn.hired,
              dyn.max_on_road);
  // Without storage dispatch this reached 95 of a possible 100. Dispatch sends
  // stored surplus back to the sawmill, which makes the jacks' own lumber go
  // east instead: extra trips through the same two-tile roads (carrier cap 2).
  CHECK(dyn.planks_made >= 65, "sawmill mostly busy (%d)", dyn.planks_made);
  CHECK(dyn.planks_made >= fixed.planks_made + 8, "hiring beats 1 carrier");
  CHECK(dyn.lumber_stored > 0, "surplus lumber reaches storage");
  CHECK(dyn.max_on_road >= 2, "busy road got extra carriers");
  CHECK(dyn.roads_with_none == 0, "every road has a carrier");
}

static void test_hiring_matches_generous_fixed() {
  ChainResult fixed = run_chain(2, 150, 15000);
  ChainResult dyn = run_chain(-1, 150, 15000);
  std::printf("fast sawmill: 2 fixed carriers %d planks | hired %d planks "
              "(%d carriers)\n", fixed.planks_made, dyn.planks_made, dyn.hired);
  CHECK(dyn.planks_made >= 120, "dynamic keeps flow (%d)", dyn.planks_made);
  CHECK(dyn.planks_made * 10 >= fixed.planks_made * 9, "within 10%% of fixed");
}

// One long road, hired on demand, vs the fixed single-carrier case.
static void test_hiring_on_long_road() {
  Game g(20, 4);
  auto f = row(g, 1, 9, 1, 8);     // one 8-tile road
  g.add_building(Building::Lumberjack, f.front());
  g.add_building(Building::Storage, f.back());
  run(g, 15000);
  int n = static_cast<int>(g.roads[0].carriers.size());
  std::printf("8-tile road, hired: %d lumber with %d carriers (cap %d)\n",
              g.created[Lumber], n, Game::max_carriers(8));
  CHECK(g.created[Lumber] >= 70, "near full rate (%d)", g.created[Lumber]);
  CHECK(n >= 2 && n <= Game::max_carriers(8), "carriers grew within cap (%d)", n);
}

// A flooding producer pushes the road to its cap, never past it.
static void test_hiring_cap() {
  Game g(12, 4);
  auto f = row(g, 1, 5, 1, 4);     // 4 tiles -> cap 3
  int jack = g.add_building(Building::Lumberjack, f.front());
  g.add_building(Building::Storage, f.back());
  g.buildings[jack].period = 20;
  run(g, 6000);
  int n = static_cast<int>(g.roads[0].carriers.size());
  CHECK(n == Game::max_carriers(4), "reaches cap %d, got %d",
        Game::max_carriers(4), n);
}

// The carrier walks from the storage: it is not instantly available.
static void test_hiring_delay() {
  Game g(12, 4);
  auto f = row(g, 1, 5, 1, 4);
  g.add_building(Building::Lumberjack, f.front());
  int st = g.add_building(Building::Storage, f.back());
  g.update();
  CHECK(g.roads[0].carriers.size() == 1, "carrier requested on first step");
  CHECK(g.transporters[0].state == Transporter::Arriving, "not yet there");
  CHECK(g.buildings[st].carriers == kStorageCarriers - 1, "taken from pool");
  // 4 tiles * 80 ticks at speed 2 = 160 steps.
  for (int i = 0; i < 150; i++) g.update();
  CHECK(g.transporters[0].state == Transporter::Arriving, "still walking");
  for (int i = 0; i < 20; i++) g.update();
  CHECK(g.transporters[0].state != Transporter::Arriving, "arrived");
  CHECK(g.transporters[0].at == 0, "arrived at the requesting end");
}

// A tiny carrier pool: the first roads staff up, the rest wait. Nothing
// is lost or crashes, and items only use roads that have a carrier.
static void test_hiring_pool_exhausted() {
  Game g(16, 4);
  auto f = row(g, 1, 13, 1, 4);    // 3 roads
  g.add_building(Building::Lumberjack, f.front());
  int st = g.add_building(Building::Storage, f.back());
  g.buildings[st].carriers = 1;
  run(g, 4000);
  int total = 0;
  for (const Road &r : g.roads) total += static_cast<int>(r.carriers.size());
  CHECK(total == 1 && g.hired == 1, "only one carrier exists (%d)", total);
  CHECK(g.buildings[st].carriers == 0, "pool empty");
  CHECK(g.buildings[st].stock[Lumber] == 0, "nothing crosses unstaffed roads");
}

// ---- construction ------------------------------------------------------

// Storage at the east end of a row of 2-tile roads, with starting goods.
struct Colony {
  Game g{16, 4};
  std::vector<int> f;
  int storage = 0;
  Colony() {
    f = row(g, 1, 9, 1, 2);
    storage = g.add_building(Building::Storage, f.back());
  }
};

static void test_site_gets_built() {
  Colony c;
  Game &g = c.g;
  g.add_stock(c.storage, Plank, 10);
  int site = g.add_building(Building::Lumberjack, c.f[0], true);
  int done = -1;
  for (int i = 0; i < 1500 && done < 0; i++) {
    g.update();
    CHECK(g.created[Lumber] == 0 || !g.buildings[site].constructing,
          "no production while under construction");
    if (!g.buildings[site].constructing) done = i;
    if (i % 25 == 0) check_conservation(g, "site");
  }
  std::printf("site: finished after %d steps\n", done);
  CHECK(done >= 0, "lumberjack site finishes");
  CHECK(g.buildings[site].used[Plank] == 2, "used exactly its 2 planks");
  CHECK(g.buildings[site].requested[Plank] == 0, "no leftover requests");
  CHECK(g.buildings[c.storage].builders == kStorageBuilders, "builder went home");
  run(g, 4000);
  CHECK(g.created[Lumber] > 0, "finished building produces");
  CHECK(g.buildings[c.storage].stock[Plank] == 8, "other planks stay put (%d)",
        g.buildings[c.storage].stock[Plank]);
}

static void test_site_waits_for_material() {
  Colony c;
  Game &g = c.g;
  g.add_stock(c.storage, Plank, 1);
  int site = g.add_building(Building::Lumberjack, c.f[0], true);
  run(g, 3000);
  CHECK(g.buildings[site].constructing, "cannot finish with 1 of 2 planks");
  CHECK(g.buildings[site].used[Plank] == 1, "built with what it got");
  CHECK(g.buildings[site].requested[Plank] == 0, "nothing in flight");
  g.add_stock(c.storage, Plank, 1);
  run(g, 1500);
  CHECK(!g.buildings[site].constructing, "finishes once restocked");
}

// One builder serves sites one after another; three work side by side.
static int finish_gap(int builders) {
  Colony c;
  Game &g = c.g;
  g.buildings[c.storage].builders = builders;
  g.add_stock(c.storage, Plank, 10);
  int a = g.add_building(Building::Lumberjack, c.f[0], true);
  int b = g.add_building(Building::Stonecutter, c.f[2], true);
  int fa = -1, fb = -1;
  for (int i = 0; i < 4000 && (fa < 0 || fb < 0); i++) {
    g.update();
    if (fa < 0 && !g.buildings[a].constructing) fa = i;
    if (fb < 0 && !g.buildings[b].constructing) fb = i;
  }
  check_conservation(g, "builders");
  CHECK(fa >= 0 && fb >= 0, "both sites finish (%d, %d)", fa, fb);
  return fb > fa ? fb - fa : fa - fb;
}

static void test_builder_pool() {
  int one = finish_gap(1), many = finish_gap(3);
  std::printf("builders: finish gap 1 builder %d steps, 3 builders %d steps\n",
              one, many);
  CHECK(one >= kBuildUnitTicks, "one builder works sequentially (%d)", one);
  CHECK(many < one, "more builders overlap (%d vs %d)", many, one);
}

// The economy builds itself: starting planks pay for a lumberjack and a
// sawmill; a later site is paid for with planks the colony made.
static void test_bootstrap() {
  Colony c;
  Game &g = c.g;
  g.add_stock(c.storage, Plank, 4);
  g.add_stock(c.storage, Stone, 1);
  int jack = g.add_building(Building::Lumberjack, c.f[0], true);
  int saw = g.add_building(Building::Sawmill, c.f[2], true);
  int site2 = -1, done = -1;
  for (int i = 0; i < 14000 && done < 0; i++) {
    g.update();
    if (site2 < 0 && !g.buildings[jack].constructing &&
        !g.buildings[saw].constructing && g.created[Plank] >= 0 && i > 3000) {
      site2 = g.add_building(Building::Lumberjack, c.f[1], true);
      std::printf("bootstrap: both built, second lumberjack ordered at step %d "
                  "(planks made so far %d)\n", i, g.created[Plank] - 4);
    }
    if (site2 >= 0 && !g.buildings[site2].constructing) done = i;
    if (i % 50 == 0) check_conservation(g, "bootstrap");
  }
  std::printf("bootstrap: second lumberjack finished at step %d\n", done);
  CHECK(!g.buildings[jack].constructing && !g.buildings[saw].constructing,
        "first two buildings stand");
  CHECK(site2 >= 0 && done >= 0, "third building built from own production");
  CHECK(g.created[Plank] - 4 >= 2, "colony made the planks it spent");
  CHECK(g.buildings[c.storage].stock[Stone] == 0 && g.created[Stone] == 1,
        "the single stone went into the sawmill");
}

// Stone has to come from a stonecutter the colony built itself.
static void test_stone_supply() {
  Colony c;
  Game &g = c.g;
  g.add_stock(c.storage, Plank, 4);
  int cutter = g.add_building(Building::Stonecutter, c.f[0], true);
  int saw = -1, done = -1;
  for (int i = 0; i < 9000 && done < 0; i++) {
    g.update();
    if (saw < 0 && !g.buildings[cutter].constructing) {
      saw = g.add_building(Building::Sawmill, c.f[2], true);
    }
    if (saw >= 0 && !g.buildings[saw].constructing) done = i;
    if (i % 50 == 0) check_conservation(g, "stone");
  }
  std::printf("stone: sawmill built from cut stone at step %d\n", done);
  CHECK(done >= 0, "sawmill finishes with stone from the stonecutter");
  CHECK(g.buildings[saw].used[Stone] == 1, "stone used");
}

// A finished storage starts supplying carriers and builders.
static void test_storage_site() {
  Colony c;
  Game &g = c.g;
  g.add_stock(c.storage, Plank, 3);
  g.add_stock(c.storage, Stone, 2);
  int west = g.add_building(Building::Storage, c.f[0], true);
  CHECK(g.buildings[west].carriers == 0 && g.buildings[west].builders == 0,
        "unbuilt storage supplies nobody");
  run(g, 3000);
  CHECK(!g.buildings[west].constructing, "storage site finishes");
  CHECK(g.buildings[west].carriers > 0 && g.buildings[west].builders == kStorageBuilders,
        "built storage has staff");
}

// ---- castle ----------------------------------------------------------

// The castle is a storage you start with: unbuildable, one per game, bigger
// crew, and the hub that feeds construction.
struct CastleColony {
  Game g{16, 4};
  std::vector<int> f;
  int castle = 0;
  CastleColony() {
    f = row(g, 1, 9, 1, 2);
    castle = g.add_building(Building::Castle, f.back());
  }
};

static void test_castle_rules() {
  CastleColony c;
  Game &g = c.g;
  CHECK(g.castle() == c.castle, "game knows its castle");
  CHECK(g.buildings[c.castle].carriers == kCastleCarriers, "castle carriers");
  CHECK(g.buildings[c.castle].builders == kCastleBuilders, "castle builders");
  CHECK(g.buildings[c.castle].accepts_all(), "castle takes any goods");
  CHECK(!g.buildings[c.castle].constructing, "castle is never a site");

  bool threw = false;
  try { g.add_building(Building::Castle, c.f[0]); }
  catch (const std::runtime_error &) { threw = true; }
  CHECK(threw, "a second castle is rejected");

  Game h(8, 4);
  int fl = h.add_flag(1, 1);
  threw = false;
  try { h.add_building(Building::Castle, fl, true); }
  catch (const std::runtime_error &) { threw = true; }
  CHECK(threw, "a castle cannot be placed as a construction site");
  CHECK(h.castle() == -1, "failed placement leaves no castle");
}

// Castle stock pays for a site; the castle supplies carriers and the builder,
// and takes the builder back.
static void test_castle_feeds_construction() {
  CastleColony c;
  Game &g = c.g;
  g.add_stock(c.castle, Plank, 10);
  int site = g.add_building(Building::Lumberjack, c.f[0], true);
  int done = -1;
  for (int i = 0; i < 1500 && done < 0; i++) {
    g.update();
    if (!g.buildings[site].constructing) done = i;
    if (i % 25 == 0) check_conservation(g, "castle site");
  }
  std::printf("castle: site finished after %d steps, %d carriers hired\n", done,
              g.hired);
  CHECK(done >= 0, "castle supplies a site");
  CHECK(g.buildings[site].used[Plank] == 2, "planks came from the castle");
  CHECK(g.buildings[c.castle].builders == kCastleBuilders, "builder returned");
  CHECK(g.buildings[c.castle].carriers == kCastleCarriers - g.hired,
        "carriers came from the castle pool");
  run(g, 4000);
  CHECK(g.created[Lumber] > 0, "new building works");
  CHECK(g.buildings[c.castle].stock[Lumber] > 0, "castle stores the output");
  CHECK(g.buildings[c.castle].stock[Plank] == 8, "other planks stay put");
}

// ---- slopes ----------------------------------------------------------

// Ramp used by the slope scenarios: rises (slope > 0) or falls (slope < 0)
// along x, kept between 5 and 31 (just above the sea, the terrain's maximum) so
// the TypeScript terrain, which refuses flags on water, can reproduce it.
static int ramp_h(int slope, int x) {
  int h = (slope >= 0 ? 5 : 31) + slope * x;
  return h < 5 ? 5 : (h > 31 ? 31 : h);
}

// A colony on a ramp (see ramp_h), storage at the east end, so slope > 0
// means the storage is uphill from the west end.
struct SlopeColony {
  Game g{16, 4};
  std::vector<int> f;
  int storage = 0;
  explicit SlopeColony(int slope) {
    for (int y = 0; y < 4; y++)
      for (int x = 0; x < 16; x++) g.set_height(x, y, ramp_h(slope, x));
    f = row(g, 1, 9, 1, 2);
    storage = g.add_building(Building::Storage, f.back());
  }
};

static void test_step_ticks() {
  CHECK(step_ticks(0) == kStepTicks, "level step");
  CHECK(step_ticks(1) == kStepTicks + kSlopeTicks, "uphill is slower");
  CHECK(step_ticks(-1) == kStepTicks - kSlopeTicks, "downhill is quicker");
  CHECK(step_ticks(100) == kMaxStepTicks, "steep climbs are capped");
  CHECK(step_ticks(-100) == kMinStepTicks, "steep descents have a floor");
}

static void test_road_is_asymmetric() {
  Game g(12, 4);
  for (int y = 0; y < 4; y++)
    for (int x = 0; x < 12; x++) g.set_height(x, y, 10 + x);
  int a = g.add_flag(1, 1), b = g.add_flag(5, 1);
  int r = g.add_road(a, {Right, Right, Right, Right});
  (void)b;
  CHECK(g.roads[r].ticks[0] == 4 * step_ticks(1), "uphill from the west end");
  CHECK(g.roads[r].ticks[1] == 4 * step_ticks(-1), "downhill from the east end");
  CHECK(g.roads[r].ticks[0] > g.roads[r].ticks[1], "up is slower than down");

  Game flat(12, 4);
  int fa = flat.add_flag(1, 1);
  flat.add_flag(5, 1);
  int fr = flat.add_road(fa, {Right, Right, Right, Right});
  CHECK(flat.roads[fr].ticks[0] == 4 * kStepTicks && flat.roads[fr].ticks[1] == 4 * kStepTicks,
        "level roads keep the old timing");

  bool threw = false;
  try { g.set_height(0, 0, 3); } catch (const std::runtime_error &) { threw = true; }
  CHECK(threw, "heights are fixed once roads exist");
}

// The builder and the materials walk uphill or downhill to the site.
static int site_done(int slope) {
  SlopeColony c(slope);
  Game &g = c.g;
  g.add_stock(c.storage, Plank, 10);
  int site = g.add_building(Building::Lumberjack, c.f[0], true);
  int done = -1;
  for (int i = 0; i < 4000 && done < 0; i++) {
    g.update();
    if (!g.buildings[site].constructing) done = i;
    if (i % 25 == 0) check_conservation(g, "slope site");
  }
  return done;
}

static void test_site_on_a_slope() {
  int uphill = site_done(-3);    // storage low, site high: everything climbs
  int level = site_done(0);
  int downhill = site_done(3);   // storage high, site low: everything descends
  std::printf("slope site: climbing %d, level %d, descending %d steps\n", uphill, level, downhill);
  CHECK(uphill > level, "reaching a hilltop site takes longer");
  CHECK(downhill < level, "reaching a valley site is quicker");
}

// With one carrier the round trip is what counts. A gentle slope only shifts
// time between the climb and the descent (they add up to a level round trip),
// but past the descent's floor the climb is dearer than the descent is cheap.
static int lumber_on_slope(int slope) {
  Game g(20, 4);
  for (int y = 0; y < 4; y++)
    for (int x = 0; x < 20; x++) g.set_height(x, y, ramp_h(slope, x));
  auto f = row(g, 1, 17, 1, 8, 1);
  g.add_building(Building::Lumberjack, f.front());
  g.add_building(Building::Storage, f.back());
  run(g, 15000);
  return g.created[Lumber];
}

static void test_steep_roads_are_slower() {
  int level = lumber_on_slope(0), gentle = lumber_on_slope(3), steep = lumber_on_slope(5);
  std::printf("lumber on one long road: level %d, gentle %d, steep %d\n", level, gentle, steep);
  CHECK(gentle == level, "a gentle slope keeps the round trip");
  CHECK(steep < level, "a steep road costs throughput");
}

// No consumer and no storage: production backs up, nothing is lost.
static void test_backpressure() {
  Game g(8, 4);
  int a = g.add_flag(1, 1), b = g.add_flag(5, 1);
  g.add_road(a, {Right, Right, Right, Right});
  g.add_building(Building::Lumberjack, a);
  (void)b;
  run(g, 10000);
  int on_flag = 0;
  for (const Item &it : g.flags[a].slot) on_flag += (it.type == Lumber);
  CHECK(on_flag == kFlagSlots, "flag fills to capacity, got %d", on_flag);
  CHECK(g.buildings[0].state == Building::OutputBlocked, "producer blocks");
  CHECK(g.created[Lumber] == kFlagSlots + 1, "stops producing, made %d",
        g.created[Lumber]);
}

// Two routes to storage: the one with fewer hops must carry everything.
static void test_shortest_hops() {
  Game g(12, 8);
  int p = g.add_flag(1, 1), t = g.add_flag(5, 1), m = g.add_flag(1, 4);
  int direct = g.add_road(p, {Right, Right, Right, Right});
  int leg1 = g.add_road(p, {Down, Down, Down});
  int leg2 = g.add_road(m, {Right, Right, Right, Right, Up, Up, Up});
  g.add_building(Building::Lumberjack, p);
  g.add_building(Building::Storage, t);
  run(g, 6000);
  CHECK(g.transporters[direct].carried_total > 0, "direct road used");
  CHECK(g.transporters[leg1].carried_total == 0, "detour leg 1 unused");
  CHECK(g.transporters[leg2].carried_total == 0, "detour leg 2 unused");
  CHECK(g.buildings[1].stock[Lumber] > 0, "lumber arrived");
}

static void expect_throw(const char *what, Game &g, int from,
                         std::vector<Dir> dirs) {
  bool threw = false;
  try { g.add_road(from, dirs); } catch (const std::runtime_error &) { threw = true; }
  CHECK(threw, "%s should be rejected", what);
}

static void test_placement() {
  Game g(10, 6);
  int a = g.add_flag(1, 1), b = g.add_flag(5, 1), c = g.add_flag(3, 3);
  g.add_road(a, {Right, Right, Right, Right});
  expect_throw("duplicate direction", g, a, {Right, Right, Right, Right});
  expect_throw("road onto road", g, c, {Up, Up, Left});         // ends mid-road
  expect_throw("road not ending on flag", g, c, {Right});
  expect_throw("road leaving grid", g, a, {Left, Left});
  expect_throw("flag on road", g, b, {Left, Left});             // hits road tiles
  bool threw = false;
  try { g.add_flag(3, 1); } catch (const std::runtime_error &) { threw = true; }
  CHECK(threw, "flag on road tile rejected");
}

int main() {
  test_chain();
  test_road_capacity();
  test_hiring_clears_gridlock();
  test_hiring_matches_generous_fixed();
  test_hiring_on_long_road();
  test_hiring_cap();
  test_hiring_delay();
  test_hiring_pool_exhausted();
  test_site_gets_built();
  test_site_waits_for_material();
  test_builder_pool();
  test_bootstrap();
  test_stone_supply();
  test_storage_site();
  test_castle_rules();
  test_castle_feeds_construction();
  test_step_ticks();
  test_road_is_asymmetric();
  test_site_on_a_slope();
  test_steep_roads_are_slower();
  test_backpressure();
  test_shortest_hops();
  test_placement();
  std::printf(failures ? "\n%d check(s) FAILED\n" : "\nall checks passed\n",
              failures);
  return failures ? 1 : 0;
}
