// Logistics slice: hex grid, flags, roads, transporters, buildings.
// Headless and deterministic (no RNG, integers only). Modelled on the
// structure of Freeserf's flag/serf logistics, rewritten from scratch.
#pragma once

#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace sim {

// Directions on a skewed hex grid: Down = (x, y+1), DownRight = (x+1, y+1).
enum Dir : int { DirNone = -1, Right, DownRight, Down, Left, UpLeft, Up };
constexpr int kDirs = 6;
inline Dir reverse(Dir d) { return static_cast<Dir>((d + 3) % kDirs); }

enum Res : int { ResNone = -1, Lumber, Plank, Stone, kResCount };
inline constexpr int kFlagPrio[kResCount] = {1, 2, 2};  // pickup priority

constexpr int kFlagSlots = 8;
constexpr int kStepTicks = 80;      // sim-ticks to walk one road tile on level ground
// Slope: a step that climbs dh height units takes kStepTicks + kSlopeTicks * dh
// (descending dh < 0 is quicker), kept between the two limits. Placeholders.
constexpr int kSlopeTicks = 12;
constexpr int kMinStepTicks = 40;
constexpr int kMaxStepTicks = 160;
inline int step_ticks(int dh) {
  int t = kStepTicks + kSlopeTicks * dh;
  return t < kMinStepTicks ? kMinStepTicks : (t > kMaxStepTicks ? kMaxStepTicks : t);
}
constexpr int kEarlyExitPrio = 204; // destination search stops above this
constexpr int kStorageCarriers = 20; // carriers a new storage can send out
// Carrier cap by road length: kMaxCarriers[min(7, length / 2)]. Placeholder
// values taken from the shape of the original's table; tune for your game.
inline constexpr int kMaxCarriers[8] = {1, 2, 3, 4, 6, 8, 11, 15};
constexpr int kStorageBuilders = 3; // builders a new storage can send out
// The castle is where the colony starts: the one building you never build, a
// storage with a much bigger crew. Placeholder numbers.
constexpr int kCastleCarriers = 40;
constexpr int kCastleBuilders = 5;
constexpr int kBuildUnitTicks = 200; // builder time per delivered material
constexpr int kDispatchPeriod = 64;  // storage sends stock out this often
constexpr int kHireWaiting = 3;     // items waiting at one end that call help

struct Grid {
  int cols, rows;
  bool inside(int x, int y) const {
    return x >= 0 && y >= 0 && x < cols && y < rows;
  }
  int index(int x, int y) const { return y * cols + x; }
  int move(int pos, Dir d) const;  // -1 when leaving the grid
};

struct Item {
  Res type = ResNone;
  int dest = -1;        // flag index, -1 = not yet assigned
  Dir dir = DirNone;    // first hop chosen for it
};

struct Flag {
  int index = 0;
  int pos = 0;
  std::array<Item, kFlagSlots> slot{};
  std::array<int, kDirs> road;   // road index per direction, -1 = none
  int building = -1;
  unsigned search_num = 0;
};

struct Road {
  int index = 0;
  int flag[2] = {0, 0};
  Dir dir_at[2] = {DirNone, DirNone};  // direction leaving each end flag
  int length = 0;
  // Ticks to walk the whole road starting from end 0 / end 1 (differ on slopes).
  int ticks[2] = {0, 0};
  std::vector<int> carriers;           // transporter indices on this road
  bool dynamic = true;                 // false: fixed carrier count, no hiring
};

struct Transporter {
  enum State { Idle, Walking, Arriving };  // Arriving: on the way to take the job
  int road = 0;
  int at = 0;           // which end it stands at (or walks towards)
  State state = Idle;
  Item item;            // carried item (dir = road direction it travels)
  int counter = 0;
  uint16_t tick = 0;
  int carried_total = 0;
};

struct Building {
  enum Type { Lumberjack, Sawmill, Storage, Stonecutter, Castle };
  enum State { Idle, Working, OutputBlocked };
  enum Builder { NoBuilder, BuilderWalking, BuilderWorking };
  int index = 0;
  Type type = Storage;
  int flag = 0;
  Res in = ResNone, out = ResNone;
  int max_in = 0;
  int period = 0;
  std::array<int, kResCount> stock{};
  std::array<int, kResCount> requested{};
  int carriers = 0;     // storage only: carriers it can still send out
  int builders = 0;     // storage only: builders it can still send out

  // Construction: materials come in as stock, the builder turns each unit
  // into progress. `used` counts units already committed to the structure.
  bool constructing = false;
  std::array<int, kResCount> need{};
  std::array<int, kResCount> used{};
  Builder builder = NoBuilder;
  int builder_home = -1;     // storage the builder came from
  int builder_counter = 0;
  Res unit_res = ResNone;    // material being worked in
  int unit_counter = 0;
  int dispatch_counter = 0;  // storage only

  // Storages and the castle hold stock and send it out; only they hand out
  // carriers and builders. A storage under construction does neither yet.
  bool is_store() const { return type == Storage || type == Castle; }
  bool accepts_all() const { return is_store() && !constructing; }
  State state = Idle;
  int counter = 0;
  uint16_t tick = 0;

  int priority(Res r) const;   // 0 = does not want it, 255 = needs it badly
};

class Game {
 public:
  Game(int cols, int rows);

  // Ground height per point (default 0 = level). Roads cache their walking
  // time, so heights must be set before the first road is added.
  void set_height(int x, int y, int h);
  int height(int pos) const { return height_[pos]; }

  // Setup. All throw std::runtime_error on invalid placement.
  int add_flag(int x, int y);
  // carriers = -1 (default): carriers are hired on demand from storages, up
  // to a cap by road length. carriers >= 1: that many from the start, never
  // hired or fired (for experiments). One carrier moves at most one item per
  // round trip, so busy roads need more carriers or to be split.
  int add_road(int from_flag, const std::vector<Dir> &dirs, int carriers = -1);
  // construct = true places an unbuilt site: it asks for materials and a
  // builder, and starts working once finished. The castle cannot be built and
  // there is only one of it (both throw).
  int add_building(Building::Type type, int flag, bool construct = false);
  // Put starting goods into a building's stock (counted as created).
  void add_stock(int building, Res r, int n);

  void update();  // one real step; sim time advances by `speed`

  // Introspection.
  int count_items(Res r) const;   // everywhere: flags, carried, stock, output
  std::string render() const;     // ASCII map
  // FNV-1a over all simulation state: two implementations that agree on
  // this hash after N steps agree on everything that matters.
  uint32_t fingerprint() const;

  Grid grid;
  uint16_t tick = 0;
  int speed = 2;
  std::vector<Flag> flags;
  std::vector<Road> roads;
  std::vector<Building> buildings;
  std::vector<Transporter> transporters;
  std::array<int, kResCount> created{};   // items made by buildings
  std::array<int, kResCount> consumed{};  // items destroyed by buildings
  int hired = 0;                          // carriers sent out so far
  std::array<int, kResCount> dispatched{};  // items storages sent out

  static int max_carriers(int road_length);
  int castle() const { return castle_; }  // building index, -1 = none yet

 private:
  void update_flag(Flag &f);
  void update_hiring(Flag &f);
  bool hire(Road &r, int end);
  bool has_carrier(const Road &r) const;
  void assign_destination(Flag &f, Item &it);
  void route(Flag &f, Item &it);
  void cancel(Item &it);
  void update_building(Building &b);
  void update_construction(Building &b, uint16_t delta);
  void finish_construction(Building &b);
  bool hire_builder(Building &b);
  void update_storage(Building &b, uint16_t delta);
  void update_transporter(Transporter &t);
  bool handle_flag(Transporter &t, Flag &f, Dir d);
  int best_pickup(const Flag &f, Dir d) const;
  int pickups_waiting(const Flag &f, Dir d) const;
  int covering(const Road &r, int end, const Transporter *self) const;
  bool drop_into_flag(Flag &f, Item item);
  void deliver(Flag &f, Res r);
  template <class Cb> void search(int src, bool carried_only, Cb cb);

  std::vector<int> height_;       // pos -> ground height
  std::vector<int> flag_at_;      // pos -> flag index or -1
  std::vector<char> road_at_;     // pos -> road tile
  std::vector<char> pending_out_; // building -> finished item not yet dropped
  int castle_ = -1;
  unsigned search_id_ = 0;
  bool builder_failed_ = false; // no builder available this step
  bool hire_failed_ = false;   // no carrier available this step: stop asking
};

}  // namespace sim
