#include "sim.h"

#include <deque>
#include <stdexcept>
#include <utility>

namespace sim {

int Grid::move(int pos, Dir d) const {
  static const int dx[kDirs] = {1, 1, 0, -1, -1, 0};
  static const int dy[kDirs] = {0, 1, 1, 0, -1, -1};
  int x = pos % cols + dx[d];
  int y = pos / cols + dy[d];
  return inside(x, y) ? index(x, y) : -1;
}

int Building::priority(Res r) const {
  if (constructing) {
    int cap = need[r] - used[r];
    if (cap <= 0) return 0;
    int total = stock[r] + requested[r];
    if (total >= cap) return 0;
    return 255 * (cap - total) / cap;
  }
  if (is_store() || r != in || max_in <= 0) return 0;
  int total = stock[r] + requested[r];
  if (total >= max_in) return 0;
  return 255 * (max_in - total) / max_in;
}

Game::Game(int cols, int rows)
  : grid{cols, rows}, height_(cols * rows, 0), flag_at_(cols * rows, -1),
    road_at_(cols * rows, 0) {}

void Game::set_height(int x, int y, int h) {
  if (!roads.empty()) throw std::runtime_error("set heights before adding roads");
  height_.at(grid.index(x, y)) = h;
}

// ---- setup -----------------------------------------------------------

int Game::add_flag(int x, int y) {
  if (!grid.inside(x, y)) throw std::runtime_error("flag outside grid");
  int pos = grid.index(x, y);
  if (flag_at_[pos] >= 0 || road_at_[pos]) {
    throw std::runtime_error("position occupied");
  }
  Flag f;
  f.index = static_cast<int>(flags.size());
  f.pos = pos;
  f.road.fill(-1);
  flags.push_back(f);
  flag_at_[pos] = f.index;
  return f.index;
}

int Game::max_carriers(int road_length) {
  int cat = road_length / 2;
  return kMaxCarriers[cat > 7 ? 7 : cat];
}

int Game::add_road(int from, const std::vector<Dir> &dirs, int carriers) {
  if (carriers == 0 || carriers < -1) {
    throw std::runtime_error("carriers must be -1 (dynamic) or >= 1");
  }
  if (dirs.empty()) throw std::runtime_error("empty road");
  Flag &a = flags.at(from);
  if (a.road[dirs.front()] >= 0) throw std::runtime_error("direction in use");

  int pos = a.pos;
  std::vector<int> tiles;
  int ticks_fwd = 0, ticks_back = 0;   // walking the road each way
  for (size_t i = 0; i < dirs.size(); i++) {
    int prev = pos;
    pos = grid.move(pos, dirs[i]);
    if (pos < 0) throw std::runtime_error("road leaves grid");
    int dh = height_[pos] - height_[prev];
    ticks_fwd += step_ticks(dh);
    ticks_back += step_ticks(-dh);
    if (i + 1 < dirs.size()) {
      if (flag_at_[pos] >= 0 || road_at_[pos]) {
        throw std::runtime_error("road crosses flag or road");
      }
      tiles.push_back(pos);
    }
  }
  int to = flag_at_[pos];
  if (to < 0) throw std::runtime_error("road must end on a flag");
  if (to == from) throw std::runtime_error("road loops to itself");
  Flag &b = flags[to];
  Dir back = reverse(dirs.back());
  if (b.road[back] >= 0) throw std::runtime_error("direction in use");

  for (int t : tiles) road_at_[t] = 1;
  Road r;
  r.index = static_cast<int>(roads.size());
  r.flag[0] = from;
  r.flag[1] = to;
  r.dir_at[0] = dirs.front();
  r.dir_at[1] = back;
  r.length = static_cast<int>(dirs.size());
  r.ticks[0] = ticks_fwd;
  r.ticks[1] = ticks_back;
  r.dynamic = (carriers < 0);
  roads.push_back(r);
  a.road[dirs.front()] = r.index;
  b.road[back] = r.index;

  for (int i = 0; i < carriers; i++) {   // spread carriers over both ends
    Transporter t;
    t.road = r.index;
    t.at = i % 2;
    t.tick = tick;
    roads[r.index].carriers.push_back(static_cast<int>(transporters.size()));
    transporters.push_back(t);
  }
  return r.index;
}

// What each building needs to be built.
static void set_needs(Building &b) {
  switch (b.type) {
    case Building::Lumberjack: b.need[Plank] = 2; break;
    case Building::Stonecutter: b.need[Plank] = 2; break;
    case Building::Sawmill: b.need[Plank] = 2; b.need[Stone] = 1; break;
    case Building::Storage: b.need[Plank] = 3; b.need[Stone] = 2; break;
    case Building::Castle: break;  // never built
  }
}

// What a finished building does.
static void init_operation(Building &b) {
  switch (b.type) {
    case Building::Lumberjack: b.out = Lumber; b.period = 400; break;
    case Building::Stonecutter: b.out = Stone; b.period = 500; break;
    case Building::Sawmill:
      b.in = Lumber; b.out = Plank; b.max_in = 8; b.period = 300; break;
    case Building::Storage:
      b.carriers = kStorageCarriers;
      b.builders = kStorageBuilders;
      break;
    case Building::Castle:
      b.carriers = kCastleCarriers;
      b.builders = kCastleBuilders;
      break;
  }
}

void Game::add_stock(int building, Res r, int n) {
  buildings.at(building).stock[r] += n;
  created[r] += n;
}

int Game::add_building(Building::Type type, int flag, bool construct) {
  Flag &f = flags.at(flag);
  if (f.building >= 0) throw std::runtime_error("flag already has building");
  if (type == Building::Castle) {
    if (construct) throw std::runtime_error("a castle cannot be built");
    if (castle_ >= 0) throw std::runtime_error("only one castle");
  }
  Building b;
  b.index = static_cast<int>(buildings.size());
  b.type = type;
  b.flag = flag;
  b.tick = tick;
  b.constructing = construct;
  if (construct) set_needs(b); else init_operation(b);
  buildings.push_back(b);
  pending_out_.push_back(0);
  f.building = b.index;
  if (type == Building::Castle) castle_ = b.index;
  return b.index;
}

// ---- search ----------------------------------------------------------

// Breadth-first over flags (hop count, like the original), tagging each
// flag with the direction of the first hop taken from `src` and the road
// time walked so far, in ticks, for a walker heading back to `src` (a carrier or
// builder comes from the storage that is searched for). `cb` gets (flag, first_hop, dist) and returns true
// to stop. The source gets DirNone. With `carried_only`, roads that have no
// working carrier are not followed (items cannot use them yet).
template <class Cb>
void Game::search(int src, bool carried_only, Cb cb) {
  ++search_id_;
  struct Node { int flag; Dir hop; int dist; };
  std::deque<Node> queue;
  flags[src].search_num = search_id_;
  queue.push_back({src, DirNone, 0});
  while (!queue.empty()) {
    Node n = queue.front();
    queue.pop_front();
    if (cb(flags[n.flag], n.hop, n.dist)) return;
    for (int d = 0; d < kDirs; d++) {
      int ri = flags[n.flag].road[d];
      if (ri < 0) continue;
      const Road &r = roads[ri];
      if (carried_only && !has_carrier(r)) continue;
      int ni = (r.flag[0] == n.flag) ? r.flag[1] : r.flag[0];
      if (flags[ni].search_num == search_id_) continue;
      flags[ni].search_num = search_id_;
      // the walker goes from ni to n: leaving end (ni == flag[0] ? 0 : 1)
      queue.push_back({ni, n.hop == DirNone ? static_cast<Dir>(d) : n.hop,
                       n.dist + r.ticks[ni == r.flag[0] ? 0 : 1]});
    }
  }
}

bool Game::has_carrier(const Road &r) const {
  for (int ti : r.carriers) {
    if (transporters[ti].state != Transporter::Arriving) return true;
  }
  return false;
}

// ---- main step -------------------------------------------------------

// Order is part of the design: flags decide, buildings produce,
// transporters move.
void Game::update() {
  tick = static_cast<uint16_t>(tick + speed);
  hire_failed_ = false;
  builder_failed_ = false;
  for (Flag &f : flags) update_flag(f);
  for (Building &b : buildings) update_building(b);
  for (Transporter &t : transporters) update_transporter(t);
}

// ---- flags -----------------------------------------------------------

void Game::update_flag(Flag &f) {
  for (Item &it : f.slot) {
    if (it.type == ResNone || it.dir != DirNone) continue;
    if (it.dest < 0) assign_destination(f, it);
    if (it.dest >= 0) route(f, it);
  }
  update_hiring(f);
}

// Roads call for carriers: one if the road has none, another when items
// pile up at this end and the road is below its cap. One request per road
// at a time; the carrier walks from the nearest storage that has one.
void Game::update_hiring(Flag &f) {
  if (hire_failed_) return;
  for (int d = 0; d < kDirs; d++) {
    int ri = f.road[d];
    if (ri < 0) continue;
    Road &r = roads[ri];
    if (!r.dynamic) continue;
    bool arriving = false;
    for (int ti : r.carriers) {
      arriving |= (transporters[ti].state == Transporter::Arriving);
    }
    if (arriving) continue;
    int have = static_cast<int>(r.carriers.size());
    bool need = have == 0 || (have < max_carriers(r.length) &&
                              pickups_waiting(f, static_cast<Dir>(d)) >=
                                  kHireWaiting);
    if (!need) continue;
    if (!hire(r, r.flag[0] == f.index ? 0 : 1)) {
      hire_failed_ = true;
      return;
    }
  }
}

bool Game::hire(Road &r, int end) {
  int storage = -1, dist = 0;
  search(r.flag[end], false, [&](Flag &fl, Dir, int d) {
    if (fl.building < 0) return false;
    const Building &b = buildings[fl.building];
    if (!b.accepts_all() || b.carriers <= 0) return false;
    storage = fl.building;
    dist = d;
    return true;
  });
  if (storage < 0) return false;
  buildings[storage].carriers--;
  hired++;
  Transporter t;
  t.road = r.index;
  t.at = end;
  t.state = Transporter::Arriving;
  t.counter = dist;
  t.tick = tick;
  r.carriers.push_back(static_cast<int>(transporters.size()));
  transporters.push_back(t);
  return true;
}

// Pick where an unrouted item goes: the building that wants it most,
// else the nearest storage.
void Game::assign_destination(Flag &f, Item &it) {
  int best = -1, best_prio = 0;
  search(f.index, true, [&](Flag &fl, Dir hop, int) {
    if (hop == DirNone || fl.building < 0) return false;
    int p = buildings[fl.building].priority(it.type);
    if (p > best_prio) { best_prio = p; best = fl.index; }
    return best_prio > kEarlyExitPrio;
  });
  if (best >= 0) {
    buildings[flags[best].building].requested[it.type]++;
    it.dest = best;
    return;
  }
  search(f.index, true, [&](Flag &fl, Dir hop, int) {
    if (hop == DirNone || fl.building < 0) return false;
    if (!buildings[fl.building].accepts_all()) return false;
    best = fl.index;
    return true;
  });
  if (best >= 0) it.dest = best;
}

// Choose the first hop towards a known destination.
void Game::route(Flag &f, Item &it) {
  Dir found = DirNone;
  search(f.index, true, [&](Flag &fl, Dir hop, int) {
    if (hop != DirNone && fl.index == it.dest) { found = hop; return true; }
    return false;
  });
  if (found != DirNone) it.dir = found; else cancel(it);
}

void Game::cancel(Item &it) {
  const Flag &d = flags[it.dest];
  if (d.building >= 0 && !buildings[d.building].accepts_all()) {
    buildings[d.building].requested[it.type]--;
  }
  it.dest = -1;
}

// Keeps the item's destination so requests stay accounted for.
bool Game::drop_into_flag(Flag &f, Item item) {
  item.dir = DirNone;
  for (Item &it : f.slot) {
    if (it.type == ResNone) {
      it = item;
      return true;
    }
  }
  return false;
}

void Game::deliver(Flag &f, Res r) {
  if (f.building < 0) throw std::logic_error("delivery to flag without building");
  Building &b = buildings[f.building];
  if (!b.accepts_all()) b.requested[r]--;
  b.stock[r]++;
}

// ---- buildings -------------------------------------------------------

void Game::update_building(Building &b) {
  uint16_t delta = static_cast<uint16_t>(tick - b.tick);
  b.tick = tick;
  if (b.constructing) { update_construction(b, delta); return; }
  if (b.is_store()) { update_storage(b, delta); return; }

  if (b.state == Building::Idle) {
    if (b.in != ResNone) {
      if (b.stock[b.in] == 0) return;
      b.stock[b.in]--;
      consumed[b.in]++;
    }
    b.state = Building::Working;
    b.counter = b.period;
    return;
  }
  if (b.state == Building::Working) {
    b.counter -= delta;
    if (b.counter >= 0) return;
    created[b.out]++;
    pending_out_[b.index] = 1;
    b.state = Building::OutputBlocked;
  }
  if (b.state == Building::OutputBlocked) {
    if (drop_into_flag(flags[b.flag], Item{b.out, -1, DirNone})) {
      pending_out_[b.index] = 0;
      b.state = Building::Idle;
    }
  }
}

// ---- construction ----------------------------------------------------

// A builder walks over from a storage, then turns each delivered material
// into progress, one unit at a time. Committing a unit moves it from stock
// to `used`, so the site never over-orders.
void Game::update_construction(Building &b, uint16_t delta) {
  if (b.builder == Building::NoBuilder) {
    if (!builder_failed_ && !hire_builder(b)) builder_failed_ = true;
    return;
  }
  if (b.builder == Building::BuilderWalking) {
    b.builder_counter -= delta;
    if (b.builder_counter >= 0) return;
    b.builder = Building::BuilderWorking;
  }
  if (b.unit_res != ResNone) {
    b.unit_counter -= delta;
    if (b.unit_counter >= 0) return;
    b.unit_res = ResNone;
  }
  bool complete = true;
  for (int r = 0; r < kResCount; r++) {
    if (b.used[r] < b.need[r]) complete = false;
  }
  if (complete) { finish_construction(b); return; }
  for (int r = 0; r < kResCount; r++) {
    if (b.stock[r] > 0 && b.used[r] < b.need[r]) {
      b.stock[r]--;
      b.used[r]++;
      consumed[r]++;
      b.unit_res = static_cast<Res>(r);
      b.unit_counter = kBuildUnitTicks;
      return;
    }
  }
}

void Game::finish_construction(Building &b) {
  b.constructing = false;
  init_operation(b);
  b.state = Building::Idle;
  if (b.builder_home >= 0) buildings[b.builder_home].builders++;  // walks home
  b.builder = Building::NoBuilder;
  b.builder_home = -1;
}

bool Game::hire_builder(Building &b) {
  int storage = -1, dist = 0;
  search(b.flag, false, [&](Flag &fl, Dir, int d) {
    if (fl.building < 0) return false;
    const Building &s = buildings[fl.building];
    if (!s.accepts_all() || s.builders <= 0) return false;
    storage = fl.building;
    dist = d;
    return true;
  });
  if (storage < 0) return false;
  buildings[storage].builders--;
  b.builder = Building::BuilderWalking;
  b.builder_home = storage;
  b.builder_counter = dist;
  return true;
}

// Storage sends stock out to whoever wants it most, one item per resource
// per period, so a finished plank can end up on a construction site.
void Game::update_storage(Building &b, uint16_t delta) {
  b.dispatch_counter -= delta;
  if (b.dispatch_counter >= 0) return;
  b.dispatch_counter = kDispatchPeriod;
  Flag &f = flags[b.flag];
  for (int r = 0; r < kResCount; r++) {
    if (b.stock[r] <= 0) continue;
    int best = -1, best_prio = 0;
    search(b.flag, true, [&](Flag &fl, Dir hop, int) {
      if (hop == DirNone || fl.building < 0) return false;
      int p = buildings[fl.building].priority(static_cast<Res>(r));
      if (p > best_prio) { best_prio = p; best = fl.index; }
      return best_prio > kEarlyExitPrio;
    });
    if (best < 0) continue;
    if (!drop_into_flag(f, Item{static_cast<Res>(r), best, DirNone})) return;
    b.stock[r]--;
    dispatched[r]++;
    buildings[flags[best].building].requested[r]++;
  }
}

// ---- transporters ----------------------------------------------------

int Game::best_pickup(const Flag &f, Dir d) const {
  int best = -1;
  for (int i = 0; i < kFlagSlots; i++) {
    const Item &it = f.slot[i];
    if (it.type == ResNone || it.dir != d) continue;
    if (best < 0 || kFlagPrio[it.type] > kFlagPrio[f.slot[best].type]) best = i;
  }
  return best;
}

int Game::pickups_waiting(const Flag &f, Dir d) const {
  int n = 0;
  for (const Item &it : f.slot) n += (it.type != ResNone && it.dir == d);
  return n;
}

// Empty carriers (other than `self`) that already serve flag end `end`:
// standing there, or walking towards it.
int Game::covering(const Road &r, int end, const Transporter *self) const {
  int n = 0;
  for (int ti : r.carriers) {
    const Transporter &o = transporters[ti];
    if (&o == self || o.item.type != ResNone) continue;
    bool serves = (o.state == Transporter::Walking) ? 1 - o.at == end
                                                   : o.at == end;
    if (serves) n++;
  }
  return n;
}

// What a transporter does when it stands at a flag. Returns true if it
// now carries an item that must walk along its own road.
bool Game::handle_flag(Transporter &t, Flag &f, Dir d) {
  if (t.item.type != ResNone && t.item.dest == f.index) {
    deliver(f, t.item.type);
    t.item = Item{};
  }
  int ps = best_pickup(f, d);
  if (t.item.type != ResNone) {
    if (ps >= 0) {   // swap in place: leave ours, take theirs
      Item leave = t.item;
      leave.dir = DirNone;
      t.item = f.slot[ps];
      t.item.dir = d;
      f.slot[ps] = leave;
      t.carried_total++;
      return true;
    }
    if (drop_into_flag(f, t.item)) t.item = Item{};
    return false;   // flag full: keep holding and retry next step
  }
  if (ps >= 0) {
    t.item = f.slot[ps];
    t.item.dir = d;
    f.slot[ps] = Item{};
    t.carried_total++;
    return true;
  }
  return false;
}

void Game::update_transporter(Transporter &t) {
  const Road &r = roads[t.road];
  uint16_t delta = static_cast<uint16_t>(tick - t.tick);
  t.tick = tick;
  int carry = 0;
  if (t.state != Transporter::Idle) {
    t.counter -= delta;
    if (t.counter >= 0) return;
    carry = t.counter;          // leftover time carries into the next walk
    if (t.state == Transporter::Walking) t.at = 1 - t.at;
    t.state = Transporter::Idle;
    t.counter = 0;
  }
  Flag &f = flags[r.flag[t.at]];
  bool go = handle_flag(t, f, r.dir_at[t.at]);
  if (!go && t.item.type == ResNone) {   // fetch from the far end, unless
    int far = 1 - t.at;                  // enough carriers already cover it
    go = pickups_waiting(flags[r.flag[far]], r.dir_at[far]) >
         covering(r, far, &t);
  }
  if (go) {
    t.state = Transporter::Walking;
    t.counter = carry + r.ticks[t.at];
  }
}

// ---- introspection ---------------------------------------------------

int Game::count_items(Res r) const {
  int n = 0;
  for (const Flag &f : flags)
    for (const Item &it : f.slot) n += (it.type == r);
  for (const Transporter &t : transporters) n += (t.item.type == r);
  for (const Building &b : buildings) {
    n += b.stock[r];
    n += (pending_out_[b.index] && b.out == r);
  }
  return n;
}

uint32_t Game::fingerprint() const {
  uint32_t h = 2166136261u;
  auto mix = [&h](int v) {
    uint32_t u = static_cast<uint32_t>(v);
    for (int k = 0; k < 4; k++) {
      h ^= (u >> (8 * k)) & 0xffu;
      h *= 16777619u;
    }
  };
  mix(tick);
  for (const Flag &f : flags) {
    mix(f.building);
    for (const Item &it : f.slot) { mix(it.type); mix(it.dest); mix(it.dir); }
  }
  for (const Road &r : roads) mix(static_cast<int>(r.carriers.size()));
  for (const Transporter &t : transporters) {
    mix(t.road); mix(t.at); mix(t.state);
    mix(t.item.type); mix(t.item.dest); mix(t.item.dir);
    mix(t.counter); mix(t.tick); mix(t.carried_total);
  }
  for (const Building &b : buildings) {
    for (int r = 0; r < kResCount; r++) {
      mix(b.stock[r]); mix(b.requested[r]); mix(b.used[r]);
    }
    mix(b.carriers); mix(b.builders); mix(b.constructing);
    mix(b.builder); mix(b.builder_home); mix(b.builder_counter);
    mix(b.unit_res); mix(b.unit_counter); mix(b.dispatch_counter);
    mix(b.state); mix(b.counter); mix(b.tick);
    mix(pending_out_[b.index]);
  }
  for (int r = 0; r < kResCount; r++) {
    mix(created[r]); mix(consumed[r]); mix(dispatched[r]);
  }
  mix(hired);
  return h;
}

std::string Game::render() const {
  std::string out(static_cast<size_t>(grid.cols * grid.rows), ' ');
  for (size_t i = 0; i < out.size(); i++) if (road_at_[i]) out[i] = 'o';
  for (const Flag &f : flags) {
    char c = '+';
    if (f.building >= 0) {
      const Building &b = buildings[f.building];
      switch (b.type) {
        case Building::Lumberjack: c = 'J'; break;
        case Building::Sawmill: c = 'W'; break;
        case Building::Storage: c = 'S'; break;
        case Building::Castle: c = 'K'; break;
        case Building::Stonecutter: c = 'C'; break;
      }
      if (b.constructing) c = static_cast<char>(c - 'A' + 'a');
    }
    out[f.pos] = c;
  }
  std::string s;
  for (int y = 0; y < grid.rows; y++) {
    s += std::string(static_cast<size_t>(y), ' ');   // skew shows hex layout
    for (int x = 0; x < grid.cols; x++) {
      s += out[grid.index(x, y)];
      s += ' ';
    }
    s += '\n';
  }
  return s;
}

}  // namespace sim
