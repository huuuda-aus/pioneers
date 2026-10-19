// Dumps scenario results as JSON. The TypeScript port must reproduce every
// number here exactly (packages/sim/test/parity.test.ts).
#include <cstdio>
#include <string>
#include <vector>

#include "sim.h"

using namespace sim;

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

static void run(Game &g, int steps) { for (int i = 0; i < steps; i++) g.update(); }

static bool first = true;
static void key(const char *name) {
  std::printf("%s\n  \"%s\": ", first ? "" : ",", name);
  first = false;
}

static void chain(const char *name, int carriers, int period, int steps) {
  Game h(16, 8);
  auto a = row(h, 1, 9, 2, 2, carriers);
  int j2 = h.add_flag(5, 6), mid = h.add_flag(5, 4);
  h.add_road(j2, {Up, Up}, carriers);
  h.add_road(mid, {Up, Up}, carriers);
  h.add_building(Building::Lumberjack, a[0]);
  h.add_building(Building::Lumberjack, j2);
  int sawmill = h.add_building(Building::Sawmill, a[2]);
  int storage = h.add_building(Building::Storage, a[4]);
  h.buildings[sawmill].period = period;
  std::string fps;
  int marks[] = {1, 100, 1000, 5000};
  int next = 0;
  for (int i = 1; i <= steps; i++) {
    h.update();
    if (next < 4 && i == marks[next]) {
      fps += std::to_string(h.fingerprint()) + ",";
      next++;
    }
  }
  fps += std::to_string(h.fingerprint());
  int max_on_road = 0, none = 0;
  for (const Road &r : h.roads) {
    int n = static_cast<int>(r.carriers.size());
    if (n > max_on_road) max_on_road = n;
    if (n == 0) none++;
  }
  key(name);
  std::printf("{\"lumber_made\": %d, \"planks_made\": %d, \"planks_stored\": %d, "
              "\"lumber_stored\": %d, \"hired\": %d, \"max_on_road\": %d, "
              "\"roads_with_none\": %d, \"dispatched_lumber\": %d, "
              "\"fingerprints\": [%s]}",
              h.created[Lumber], h.created[Plank],
              h.buildings[storage].stock[Plank],
              h.buildings[storage].stock[Lumber], h.hired, max_on_road, none,
              h.dispatched[Lumber], fps.c_str());
}

static void lumber_made(const char *name, int seg, int carriers) {
  Game g(20, 4);
  auto f = row(g, 1, 17, 1, seg, carriers);
  g.add_building(Building::Lumberjack, f.front());
  g.add_building(Building::Storage, f.back());
  run(g, 15000);
  key(name);
  std::printf("{\"lumber_made\": %d, \"fingerprint\": %u}", g.created[Lumber],
              g.fingerprint());
}

static void long_road() {
  Game g(20, 4);
  auto f = row(g, 1, 9, 1, 8);
  g.add_building(Building::Lumberjack, f.front());
  g.add_building(Building::Storage, f.back());
  run(g, 15000);
  key("long_road_hired");
  std::printf("{\"lumber_made\": %d, \"carriers\": %d, \"fingerprint\": %u}",
              g.created[Lumber], static_cast<int>(g.roads[0].carriers.size()),
              g.fingerprint());
}

static void cap_and_delay() {
  {
    Game g(12, 4);
    auto f = row(g, 1, 5, 1, 4);
    int jack = g.add_building(Building::Lumberjack, f.front());
    g.add_building(Building::Storage, f.back());
    g.buildings[jack].period = 20;
    run(g, 6000);
    key("hiring_cap");
    std::printf("{\"carriers\": %d, \"fingerprint\": %u}",
                static_cast<int>(g.roads[0].carriers.size()), g.fingerprint());
  }
  {
    Game g(12, 4);
    auto f = row(g, 1, 5, 1, 4);
    g.add_building(Building::Lumberjack, f.front());
    g.add_building(Building::Storage, f.back());
    g.update();
    int after1 = static_cast<int>(g.roads[0].carriers.size());
    int state1 = g.transporters[0].state;
    run(g, 150);
    int state150 = g.transporters[0].state;
    run(g, 20);
    key("hiring_delay");
    std::printf("{\"after1\": %d, \"state1\": %d, \"state151\": %d, "
                "\"state171\": %d, \"at\": %d, \"fingerprint\": %u}", after1,
                state1, state150, g.transporters[0].state, g.transporters[0].at,
                g.fingerprint());
  }
  {
    Game g(16, 4);
    auto f = row(g, 1, 13, 1, 4);
    g.add_building(Building::Lumberjack, f.front());
    int st = g.add_building(Building::Storage, f.back());
    g.buildings[st].carriers = 1;
    run(g, 4000);
    key("pool_exhausted");
    std::printf("{\"hired\": %d, \"pool\": %d, \"stored\": %d, \"fingerprint\": %u}",
                g.hired, g.buildings[st].carriers, g.buildings[st].stock[Lumber],
                g.fingerprint());
  }
}

struct Colony {
  Game g{16, 4};
  std::vector<int> f;
  int storage = 0;
  Colony() {
    f = row(g, 1, 9, 1, 2);
    storage = g.add_building(Building::Storage, f.back());
  }
};

static void sites() {
  {
    Colony c;
    Game &g = c.g;
    g.add_stock(c.storage, Plank, 10);
    int site = g.add_building(Building::Lumberjack, c.f[0], true);
    int done = -1;
    for (int i = 0; i < 1500 && done < 0; i++) {
      g.update();
      if (!g.buildings[site].constructing) done = i;
    }
    uint32_t fp_done = g.fingerprint();
    run(g, 4000);
    key("site_built");
    std::printf("{\"done\": %d, \"lumber_after\": %d, \"planks_left\": %d, "
                "\"builders_home\": %d, \"fp_done\": %u, \"fingerprint\": %u}",
                done, g.created[Lumber], g.buildings[c.storage].stock[Plank],
                g.buildings[c.storage].builders, fp_done, g.fingerprint());
  }
  {
    Colony c;
    Game &g = c.g;
    g.add_stock(c.storage, Plank, 1);
    int site = g.add_building(Building::Lumberjack, c.f[0], true);
    run(g, 3000);
    int used = g.buildings[site].used[Plank];
    bool still = g.buildings[site].constructing;
    g.add_stock(c.storage, Plank, 1);
    run(g, 1500);
    key("site_waits");
    std::printf("{\"used_before\": %d, \"constructing_before\": %d, "
                "\"constructing_after\": %d, \"fingerprint\": %u}", used,
                still ? 1 : 0, g.buildings[site].constructing ? 1 : 0,
                g.fingerprint());
  }
  for (int builders : {1, 3}) {
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
    key(builders == 1 ? "builders_1" : "builders_3");
    std::printf("{\"finish_a\": %d, \"finish_b\": %d, \"fingerprint\": %u}", fa,
                fb, g.fingerprint());
  }
  {
    Colony c;
    Game &g = c.g;
    g.add_stock(c.storage, Plank, 4);
    g.add_stock(c.storage, Stone, 1);
    int jack = g.add_building(Building::Lumberjack, c.f[0], true);
    int saw = g.add_building(Building::Sawmill, c.f[2], true);
    int site2 = -1, ordered = -1, done = -1;
    for (int i = 0; i < 14000 && done < 0; i++) {
      g.update();
      if (site2 < 0 && !g.buildings[jack].constructing &&
          !g.buildings[saw].constructing && i > 3000) {
        site2 = g.add_building(Building::Lumberjack, c.f[1], true);
        ordered = i;
      }
      if (site2 >= 0 && !g.buildings[site2].constructing) done = i;
    }
    key("bootstrap");
    std::printf("{\"ordered\": %d, \"done\": %d, \"planks_made\": %d, "
                "\"stone_created\": %d, \"fingerprint\": %u}", ordered, done,
                g.created[Plank], g.created[Stone], g.fingerprint());
  }
  {
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
    }
    key("stone_supply");
    std::printf("{\"done\": %d, \"fingerprint\": %u}", done, g.fingerprint());
  }
  {
    Colony c;
    Game &g = c.g;
    g.add_stock(c.storage, Plank, 3);
    g.add_stock(c.storage, Stone, 2);
    int west = g.add_building(Building::Storage, c.f[0], true);
    int c0 = g.buildings[west].carriers, b0 = g.buildings[west].builders;
    run(g, 3000);
    key("storage_site");
    std::printf("{\"carriers_before\": %d, \"builders_before\": %d, "
                "\"constructing\": %d, \"carriers\": %d, \"builders\": %d, "
                "\"fingerprint\": %u}", c0, b0,
                g.buildings[west].constructing ? 1 : 0,
                g.buildings[west].carriers, g.buildings[west].builders,
                g.fingerprint());
  }
}

struct CastleColony {
  Game g{16, 4};
  std::vector<int> f;
  int castle = 0;
  CastleColony() {
    f = row(g, 1, 9, 1, 2);
    castle = g.add_building(Building::Castle, f.back());
  }
};

static void castle() {
  {
    CastleColony c;
    Game &g = c.g;
    g.add_stock(c.castle, Plank, 10);
    int site = g.add_building(Building::Lumberjack, c.f[0], true);
    int done = -1;
    for (int i = 0; i < 1500 && done < 0; i++) {
      g.update();
      if (!g.buildings[site].constructing) done = i;
    }
    uint32_t fp_done = g.fingerprint();
    run(g, 4000);
    key("castle_site");
    std::printf("{\"done\": %d, \"hired\": %d, \"carriers_left\": %d, "
                "\"builders_left\": %d, \"lumber_after\": %d, "
                "\"lumber_stored\": %d, \"planks_left\": %d, \"fp_done\": %u, "
                "\"fingerprint\": %u}",
                done, g.hired, g.buildings[c.castle].carriers,
                g.buildings[c.castle].builders, g.created[Lumber],
                g.buildings[c.castle].stock[Lumber],
                g.buildings[c.castle].stock[Plank], fp_done, g.fingerprint());
  }
  {
    CastleColony c;
    Game &g = c.g;
    g.add_stock(c.castle, Plank, 4);
    g.add_stock(c.castle, Stone, 1);
    int jack = g.add_building(Building::Lumberjack, c.f[0], true);
    int saw = g.add_building(Building::Sawmill, c.f[2], true);
    int site2 = -1, ordered = -1, done = -1;
    for (int i = 0; i < 14000 && done < 0; i++) {
      g.update();
      if (site2 < 0 && !g.buildings[jack].constructing &&
          !g.buildings[saw].constructing && i > 3000) {
        site2 = g.add_building(Building::Lumberjack, c.f[1], true);
        ordered = i;
      }
      if (site2 >= 0 && !g.buildings[site2].constructing) done = i;
    }
    key("castle_bootstrap");
    std::printf("{\"ordered\": %d, \"done\": %d, \"planks_made\": %d, "
                "\"dispatched_planks\": %d, \"fingerprint\": %u}", ordered, done,
                g.created[Plank], g.dispatched[Plank], g.fingerprint());
  }
}

// Ramp used by the slope scenarios: rises (slope > 0) or falls (slope < 0)
// along x, kept between 5 and 31 (just above the sea, the terrain's maximum) so
// the TypeScript terrain, which refuses flags on water, can reproduce it.
static int ramp_h(int slope, int x) {
  int h = (slope >= 0 ? 5 : 31) + slope * x;
  return h < 5 ? 5 : (h > 31 ? 31 : h);
}

static void slopes() {
  for (int slope : {-3, 3, 5}) {
    Game g(16, 4);
    for (int y = 0; y < 4; y++)
      for (int x = 0; x < 16; x++) g.set_height(x, y, ramp_h(slope, x));
    auto f = row(g, 1, 9, 1, 2);
    int storage = g.add_building(Building::Storage, f.back());
    g.add_stock(storage, Plank, 10);
    int site = g.add_building(Building::Lumberjack, f[0], true);
    int done = -1;
    for (int i = 0; i < 4000 && done < 0; i++) {
      g.update();
      if (!g.buildings[site].constructing) done = i;
    }
    std::string name = std::string("slope_site_") + (slope < 0 ? "m" : "p") + std::to_string(slope < 0 ? -slope : slope);
    key(name.c_str());
    std::printf("{\"done\": %d, \"ticks0\": %d, \"ticks1\": %d, \"fingerprint\": %u}",
                done, g.roads[0].ticks[0], g.roads[0].ticks[1], g.fingerprint());
  }
  for (int slope : {3, 5}) {
    Game g(20, 4);
    for (int y = 0; y < 4; y++)
      for (int x = 0; x < 20; x++) g.set_height(x, y, ramp_h(slope, x));
    auto f = row(g, 1, 17, 1, 8, 1);
    g.add_building(Building::Lumberjack, f.front());
    g.add_building(Building::Storage, f.back());
    run(g, 15000);
    std::string name = std::string("slope_lumber_") + (slope < 0 ? "m" : "p") + std::to_string(slope < 0 ? -slope : slope);
    key(name.c_str());
    std::printf("{\"lumber_made\": %d, \"fingerprint\": %u}", g.created[Lumber], g.fingerprint());
  }
}

int main() {
  std::printf("{");
  chain("chain_fixed2_fast", 2, 150, 15000);
  chain("chain_dynamic_fast", -1, 150, 15000);
  chain("chain_dynamic_overflow", -1, 300, 15000);
  chain("chain_fixed1_overflow", 1, 300, 15000);
  lumber_made("lumber_seg2_c1", 2, 1);
  lumber_made("lumber_seg8_c1", 8, 1);
  lumber_made("lumber_seg8_c3", 8, 3);
  lumber_made("lumber_seg8_dynamic", 8, -1);
  long_road();
  cap_and_delay();
  sites();
  castle();
  slopes();
  std::printf("\n}\n");
  return 0;
}
