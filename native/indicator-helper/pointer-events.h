// 指针按钮事件的有界队列（方案 二·问题 A）。
//
// 旧实现只有三个 `std::atomic<bool>`：钩子写 true/false，主线程过一会儿才 `SamplePointer`
// 读一次。若 down 与 up 都发生在这次采样之前，读到的仍是 false —— 点击确实发生了，但动画
// 状态机从来没收到过"按下"。这个头文件把按钮变成**有序事件**，并保证：
//
//   1. 边沿不合并。按钮事件按产生顺序入队，消费者按同一顺序取出。
//   2. 移动可以合并。队列接近满时丢的是 move，不是按钮；被丢的移动仍以"最新位置 + 时间"
//      的形式交给消费者，按住期间的**最大位移**由生产者精确维护（拖出去再回原点也不会漏）。
//   3. 有限队列不宣称无限保真。真丢到边沿时计数、置降级标志、请求一次按键状态重同步，
//      由消费者用 GetAsyncKeyState 的最高位校正，避免角色永久按住。
//   4. 生产者（钩子回调）只做定长内存写入与原子操作：不解码、不绘制、不做文件 I/O、不等待锁。
//
// 消费者是主线程；这是一个单生产者单消费者环。
#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <windows.h>

#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace pointer {

enum class Kind : unsigned char { Move = 0, Down = 1, Up = 2, Wheel = 3 };
/// 五个按钮：左右中是系统按钮，X1/X2 是侧键（方案 阶段 2 第 7 条：侧键有独立 down/up）。
enum class Button : unsigned char { Left = 0, Right = 1, Middle = 2, X1 = 3, X2 = 4 };

constexpr unsigned kButtonCount = 5;

inline unsigned ButtonBit(Button button) { return 1u << static_cast<unsigned>(button); }
inline const char* ButtonName(Button button) {
  switch (button) {
    case Button::Right: return "right";
    case Button::Middle: return "middle";
    case Button::X1: return "x1";
    case Button::X2: return "x2";
    case Button::Left:
    default: return "left";
  }
}

/// 一条指针事件。`travelPx` 是"本次按住期间离按下点的最大位移"，由生产者精确累计。
struct Event {
  unsigned long long seq = 0;
  long long atMs = 0;
  int x = 0;
  int y = 0;
  int travelPx = 0;
  Kind kind = Kind::Move;
  Button button = Button::Left;
  bool injected = false;
  /// true 表示这条不是排队来的，而是"队列满时被合并掉的那些移动"的最终位置。
  bool coalesced = false;
  /// 滚轮：一格 = 120（WHEEL_DELTA），方向为原始符号。`horizontal` 对应 WM_MOUSEHWHEEL。
  int wheelDelta = 0;
  bool horizontal = false;
};

/// 单生产者单消费者有界环。容量必须是 2 的幂。
template <size_t Capacity>
class Ring {
  static_assert(Capacity > 0 && (Capacity & (Capacity - 1)) == 0, "capacity must be a power of two");

 public:
  bool Push(const Event& event) {
    const size_t head = head_.load(std::memory_order_relaxed);
    const size_t tail = tail_.load(std::memory_order_acquire);
    if (head - tail >= Capacity) return false;
    slots_[head & (Capacity - 1)] = event;
    head_.store(head + 1, std::memory_order_release);
    return true;
  }

  bool Pop(Event& out) {
    const size_t tail = tail_.load(std::memory_order_relaxed);
    const size_t head = head_.load(std::memory_order_acquire);
    if (tail == head) return false;
    out = slots_[tail & (Capacity - 1)];
    tail_.store(tail + 1, std::memory_order_release);
    return true;
  }

  size_t Size() const {
    const size_t head = head_.load(std::memory_order_acquire);
    const size_t tail = tail_.load(std::memory_order_acquire);
    return head - tail;
  }

  bool Empty() const { return Size() == 0; }

 private:
  Event slots_[Capacity]{};
  std::atomic<size_t> head_{0};
  std::atomic<size_t> tail_{0};
};

/**
 * 生产者一侧：钩子回调唯一的落点。
 *
 * 只保留"位置、按钮集合、运动时间"，不收集窗口文字、不持久化轨迹、不注入输入。
 */
class Source {
 public:
  /// 512 条 ≈ 一次主线程卡顿里的全部移动；方案给的初值就是 256 或 512。
  static constexpr size_t kCapacity = 512;
  /// 满负载时仍给按钮边沿预留的槽位数：一次完整点击只有 2 条边沿，32 条足够 16 次连点。
  static constexpr size_t kEdgeReserve = 32;

  bool PushMove(long long atMs, POINT at, bool injected) {
    seen_.fetch_add(1, std::memory_order_relaxed);
    TrackTravel(at);
    if (ring_.Size() + kEdgeReserve > kCapacity) {
      NoteOverflow();
      PublishCoalesced(atMs, at);
      return false;
    }
    Event event;
    event.seq = ++seq_;
    event.atMs = atMs;
    event.x = at.x;
    event.y = at.y;
    event.kind = Kind::Move;
    event.injected = injected;
    event.travelPx = maxTravel_;
    if (!ring_.Push(event)) {
      NoteOverflow();
      PublishCoalesced(atMs, at);
      return false;
    }
    coalescing_ = false;
    enqueued_.fetch_add(1, std::memory_order_relaxed);
    return true;
  }

  bool PushButton(long long atMs, POINT at, Kind kind, Button button, bool injected) {
    seen_.fetch_add(1, std::memory_order_relaxed);
    // 先按当前位置结算位移，再改按钮集合：抬起事件本身也可能带来最后一段位移。
    TrackTravel(at);
    const unsigned bit = ButtonBit(button);
    if (kind == Kind::Down) {
      if (mask_ == 0) {
        origin_ = at;
        originValid_ = true;
        maxTravel_ = 0;
      }
      mask_ |= bit;
    } else {
      mask_ &= ~bit;
      if (mask_ == 0) originValid_ = false;
    }
    buttonsDown_.store(mask_, std::memory_order_relaxed);
    maxTravelPx_.store(maxTravel_, std::memory_order_relaxed);

    Event event;
    event.seq = ++seq_;
    event.atMs = atMs;
    event.x = at.x;
    event.y = at.y;
    event.kind = kind;
    event.button = button;
    event.injected = injected;
    event.travelPx = maxTravel_;
    if (!ring_.Push(event)) {
      // 边沿被丢：如实计数并请求重同步。消费者的校正路径会把状态拉回真实按键集合。
      droppedEdges_.fetch_add(1, std::memory_order_relaxed);
      resyncRequested_.store(true, std::memory_order_release);
      return false;
    }
    coalescing_ = false;
    enqueued_.fetch_add(1, std::memory_order_relaxed);
    return true;
  }

  bool Pop(Event& out) { return ring_.Pop(out); }
  size_t Size() const { return ring_.Size(); }
  bool Empty() const { return ring_.Empty(); }

  /**
   * 滚轮：带 delta 的**脉冲**，不是 Move 的一种（方案 阶段 2 第 7 条）。
   *
   * 滚轮没有 down/up，只是"一次性位移脉冲"，所以单独一个 Kind；`injected` 照旧原样记录，
   * 自动化驱动自己的滚动也该有反馈。滚轮与按钮一样受保留槽位保护：队列满时移动先被合并。
   */
  bool PushWheel(long long atMs, POINT at, int delta, bool horizontal, bool injected) {
    seen_.fetch_add(1, std::memory_order_relaxed);
    TrackTravel(at);
    wheelEvents_.fetch_add(1, std::memory_order_relaxed);
    Event event;
    event.seq = ++seq_;
    event.atMs = atMs;
    event.x = at.x;
    event.y = at.y;
    event.kind = Kind::Wheel;
    event.wheelDelta = delta;
    event.horizontal = horizontal;
    event.injected = injected;
    event.travelPx = maxTravel_;
    if (!ring_.Push(event)) {
      droppedEdges_.fetch_add(1, std::memory_order_relaxed);
      resyncRequested_.store(true, std::memory_order_release);
      return false;
    }
    coalescing_ = false;
    enqueued_.fetch_add(1, std::memory_order_relaxed);
    return true;
  }

  /// 队列满期间被合并掉的移动：给出最终位置。返回 false 表示没有新的合并位置。
  bool TakeCoalescedMove(Event& out) {
    const unsigned long long published = latestSeq_.load(std::memory_order_acquire);
    if (published == 0 || published == lastCoalescedApplied_) return false;
    const long x = latestX_.load(std::memory_order_relaxed);
    const long y = latestY_.load(std::memory_order_relaxed);
    const long long atMs = latestAtMs_.load(std::memory_order_relaxed);
    const int travel = latestTravelPx_.load(std::memory_order_relaxed);
    if (latestSeq_.load(std::memory_order_acquire) != published) return false;  // 读到一半又被写，下一轮再来
    lastCoalescedApplied_ = published;
    out = Event{};
    out.atMs = atMs;
    out.x = static_cast<int>(x);
    out.y = static_cast<int>(y);
    out.travelPx = travel;
    out.kind = Kind::Move;
    out.coalesced = true;
    return true;
  }

  bool TakeResyncRequest() { return resyncRequested_.exchange(false, std::memory_order_acq_rel); }

  unsigned long long Seen() const { return seen_.load(std::memory_order_relaxed); }
  unsigned long long Enqueued() const { return enqueued_.load(std::memory_order_relaxed); }
  unsigned long long WheelEvents() const { return wheelEvents_.load(std::memory_order_relaxed); }
  unsigned long long Coalesced() const { return coalesced_.load(std::memory_order_relaxed); }
  unsigned long long DroppedEdges() const { return droppedEdges_.load(std::memory_order_relaxed); }
  unsigned long long OverflowEpisodes() const { return overflowEpisodes_.load(std::memory_order_relaxed); }
  int MaxTravelPx() const { return maxTravelPx_.load(std::memory_order_relaxed); }
  unsigned ButtonsDown() const { return buttonsDown_.load(std::memory_order_relaxed); }

  /// 供自检使用：把生产者侧的序号读出来，验证"只增不乱"。
  unsigned long long Sequence() const { return seq_; }

 private:
  void TrackTravel(POINT at) {
    if (mask_ == 0 || !originValid_) return;
    const long long dx = static_cast<long long>(at.x) - origin_.x;
    const long long dy = static_cast<long long>(at.y) - origin_.y;
    const int distance = static_cast<int>(std::lround(std::sqrt(static_cast<double>(dx * dx + dy * dy))));
    if (distance > maxTravel_) {
      maxTravel_ = distance;
      maxTravelPx_.store(maxTravel_, std::memory_order_relaxed);
    }
  }

  void NoteOverflow() {
    coalesced_.fetch_add(1, std::memory_order_relaxed);
    if (!coalescing_) {
      coalescing_ = true;
      overflowEpisodes_.fetch_add(1, std::memory_order_relaxed);
    }
  }

  void PublishCoalesced(long long atMs, POINT at) {
    const unsigned long long next = ++coalescedSeq_;
    latestX_.store(at.x, std::memory_order_relaxed);
    latestY_.store(at.y, std::memory_order_relaxed);
    latestAtMs_.store(atMs, std::memory_order_relaxed);
    latestTravelPx_.store(maxTravel_, std::memory_order_relaxed);
    latestSeq_.store(next, std::memory_order_release);
  }

  Ring<kCapacity> ring_;

  // 生产者侧状态：只有钩子线程写。
  unsigned long long seq_ = 0;
  unsigned mask_ = 0;
  POINT origin_{0, 0};
  bool originValid_ = false;
  int maxTravel_ = 0;
  bool coalescing_ = false;
  unsigned long long coalescedSeq_ = 0;

  // 消费者侧状态：只有主线程写。
  unsigned long long lastCoalescedApplied_ = 0;

  // 跨线程读取的诊断量。
  std::atomic<unsigned long long> seen_{0};
  std::atomic<unsigned long long> enqueued_{0};
  std::atomic<unsigned long long> wheelEvents_{0};
  std::atomic<unsigned long long> coalesced_{0};
  std::atomic<unsigned long long> droppedEdges_{0};
  std::atomic<unsigned long long> overflowEpisodes_{0};
  std::atomic<int> maxTravelPx_{0};
  std::atomic<unsigned> buttonsDown_{0};
  std::atomic<bool> resyncRequested_{false};

  std::atomic<unsigned long long> latestSeq_{0};
  std::atomic<long> latestX_{0};
  std::atomic<long> latestY_{0};
  std::atomic<long long> latestAtMs_{0};
  std::atomic<int> latestTravelPx_{0};
};

}  // namespace pointer
