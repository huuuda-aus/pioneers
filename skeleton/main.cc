// Minimal fixed-step simulation skeleton: sim clock, speed multiplier,
// countdown timers, ordered update phases, deterministic RNG.
// Headless: swap run() for your platform's event loop + renderer.
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <thread>
#include <vector>

constexpr int kTickMs = 20;          // 50 Hz real-time step
constexpr int kMaxCatchUp = 5;       // bounded catch-up per frame
constexpr int kDefaultSpeed = 2;     // sim-ticks per real step (0 = paused)

// 3x16-bit integer-only RNG: same seed + same inputs => same game.
class Random {
 public:
  explicit Random(uint16_t a = 1, uint16_t b = 2, uint16_t c = 3)
    : s_{a, b, c} {}
  uint16_t next() {
    uint16_t r = (s_[0] + s_[1]) ^ s_[2];
    s_[2] += s_[1];
    s_[1] ^= s_[2];
    s_[1] = (s_[1] >> 1) | (s_[1] << 15);
    s_[2] = (s_[2] >> 1) | (s_[2] << 15);
    s_[0] = r;
    return r;
  }
 private:
  uint16_t s_[3];
};

class World;

// Entities refer to each other by index, never by pointer.
struct Entity {
  uint32_t index = 0;
  virtual ~Entity() = default;
};

// A job state machine driven by a countdown, like serf handlers.
struct Worker : Entity {
  enum State { Idle, Working, Delivering } state = Idle;
  int counter = 0;        // sim-ticks until next event
  uint16_t tick = 0;      // sim time of last update
  int delivered = 0;
  void update(World &w);
};

// A flag-like node that holds items and requests carriers.
struct Node : Entity {
  int items = 0;
  void update(World &w);
};

class World {
 public:
  uint16_t tick = 0;      // sim time, scaled by speed
  int tick_diff = 0;
  unsigned const_tick = 0;  // real steps, for UI timeouts
  int speed = kDefaultSpeed;
  Random rnd;
  std::vector<std::unique_ptr<Node>> nodes;
  std::vector<std::unique_ptr<Worker>> workers;

  void update() {
    const_tick += 1;
    uint16_t last = tick;
    tick += speed;
    tick_diff = static_cast<uint16_t>(tick - last);

    // Order is part of the design: nodes decide, then workers act.
    for (auto &n : nodes) n->update(*this);
    for (auto &wk : workers) wk->update(*this);
  }
};

void Node::update(World &) {}

void Worker::update(World &w) {
  uint16_t delta = static_cast<uint16_t>(w.tick - tick);
  tick = w.tick;
  counter -= delta;
  // `while`, not `if`: a big jump fires every event that was due.
  while (counter < 0) {
    switch (state) {
      case Idle:       state = Working;    counter += 400 + (w.rnd.next() & 0x7f); break;
      case Working:    state = Delivering; counter += 128; break;
      case Delivering: state = Idle;       counter += 64; w.nodes[0]->items++; delivered++; break;
    }
  }
}

// Real-time driver: fixed steps, bounded catch-up, then draw once.
template <class Draw>
void run(World &w, int real_steps, Draw draw) {
  using clock = std::chrono::steady_clock;
  auto next = clock::now() + std::chrono::milliseconds(kTickMs);
  int done = 0;
  while (done < real_steps) {
    auto now = clock::now();
    if (now < next) {
      std::this_thread::sleep_until(next);  // platform loop: wait for events
      continue;
    }
    int steps = 0;
    while (now >= next && steps < kMaxCatchUp) {
      w.update();
      next += std::chrono::milliseconds(kTickMs);
      ++steps; ++done;
    }
    if (now >= next) next = now + std::chrono::milliseconds(kTickMs);
    draw(w);
  }
}

int main() {
  World w;
  w.nodes.push_back(std::make_unique<Node>());
  w.workers.push_back(std::make_unique<Worker>());
  run(w, 500, [](World &) {});  // 500 steps ~ 10 s real time
  std::printf("tick=%u const_tick=%u delivered=%d items=%d\n",
              w.tick, w.const_tick, w.workers[0]->delivered, w.nodes[0]->items);
}
