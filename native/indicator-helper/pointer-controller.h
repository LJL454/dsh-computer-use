// 指针事件的**纯状态归约**（方案 二·问题 A 的第 5 条 / 阶段 2 与阶段 3）。
//
// 这个头文件不认识窗口、不认识钩子、不认识时钟：只把有序事件折成 `animation::PointerState`。
// 于是"同一批里收到 down 和 up"也能产生一次真实的点击反馈，而不是消费完只剩 idle。
//
// 几条规则值得单独写下来：
//
//   * 多键交错算**一次**手势。第二个键按下时不重置按下点与按下时刻，第一个键抬起时也不结束，
//     直到所有键都抬起才产生一次释放。否则左右键快速交错会让角色反复起停。
//
//   * **位移只有一个口径**（阶段 2 第 6 条）：按下原点 + 本次按住期间的**最大**距离。
//     钩子事件、位置兜底（`UpdatePosition`）、按钮采样重同步（`Resync`）都往同一个最大位移上
//     累计。以前只有钩子事件会更新它，于是"钩子失效 + 位置轮询仍在跑"的部署里，
//     拖出去 100 px 也永远进不了 drag。
//
//   * **反馈是带序号的对象**（阶段 3 第 2/4 条）：每次手势完成生成一个新的 `Feedback`，
//     有自己的 id、来源、事件时间与可见窗口。第一次成功 Present 之后才开始计可见时长；
//     新 id 即使仍叫 `release` 也重新起算，不再靠"clip 名变了没有"。
//
//   * **高频有界合并**（阶段 3 第 7 条）：同一个 kind 在 `kFeedbackMergeMs` 内再次到达时只续期，
//     不排队。合并计数如实上报，绝不积压几秒动画。
//
//   * 短按用"可辨认反馈"的目标时长反算倍率（阶段 3 第 5 条）：不是固定 2.5 倍，而是
//     `releaseAnimationMs / kTapFeedbackMs`，资源换了也仍然落在 150—250 ms 区间附近。
#pragma once

#include "pointer-events.h"

#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <algorithm>
#include <cmath>
#include <string>
#include <utility>

#include "animation-player.h"

namespace pointer {

/// 短按上限：按下到抬起不超过它，且没有越过拖拽阈值。
constexpr long long kShortClickMs = 120;
/// 短按倍率的上限：资源时长比目标反馈还短时不要把它拖慢。
constexpr float kMaxTapRate = 4.0f;

/**
 * 消费者一侧的状态归约器。
 *
 * `Bind` 指向现有的 `animation::PointerState`（main.cpp 里的 `g_helper.pointer`），
 * 这样 health、资源时长、DPI 阈值仍然只有一份，不需要在两个结构之间同步。
 */
class Controller {
 public:
  void Bind(animation::PointerState* state) { state_ = state; }

  animation::PointerState* State() { return state_; }
  const animation::PointerState* State() const { return state_; }
  bool Pressed() const { return state_ != nullptr && state_->pressed; }
  unsigned Buttons() const { return buttons_; }

  /// 施加一条事件。顺序由队列保证；这里不再排序，也不丢弃按钮边沿。
  void Apply(const Event& event) {
    if (state_ == nullptr) return;
    if (event.atMs > lastEventAtMs_) lastEventAtMs_ = event.atMs;
    switch (event.kind) {
      case Kind::Down:
        MoveTo(event.atMs, event.x, event.y);
        Press(event.atMs, event.x, event.y, event.button, event.travelPx);
        break;
      case Kind::Up:
        MoveTo(event.atMs, event.x, event.y);
        Release(event.atMs, event.x, event.y, event.button, event.travelPx, true);
        break;
      case Kind::Wheel:
        MoveTo(event.atMs, event.x, event.y);
        Wheel(event.atMs, event.wheelDelta, event.horizontal);
        break;
      case Kind::Move:
      default:
        moves_ += 1;
        MoveTo(event.atMs, event.x, event.y);
        AccumulateTravel(event.x, event.y, event.coalesced);
        if (event.travelPx > state_->pressTravelPx) state_->pressTravelPx = event.travelPx;
        break;
    }
  }

  /**
   * 用系统当前按键状态校正。返回 true 表示确实合成了边沿（状态被拉回真实值）。
   *
   * 只用于：启动、钩子未就绪、队列报告边沿被丢、以及钩子被判定"投递异常"时的降级采样。
   * `GetAsyncKeyState` 的高位是"此刻按下"，低位"最近按过"不可靠，这里只看高位。
   *
   * 合成出来的边沿会标 `pressTravelResampled`：它是采样重建的手势，可信度低于真实边沿，
   * 呈现层与诊断要能分开说（阶段 2 第 6 条）。
   */
  bool Resync(long long atMs, POINT at, bool left, bool right, bool middle) {
    return ResyncExtended(atMs, at, left, right, middle, false, false);
  }

  bool ResyncExtended(long long atMs, POINT at, bool left, bool right, bool middle, bool x1, bool x2) {
    if (state_ == nullptr) return false;
    resyncs_ += 1;
    unsigned target = 0;
    if (left) target |= ButtonBit(Button::Left);
    if (right) target |= ButtonBit(Button::Right);
    if (middle) target |= ButtonBit(Button::Middle);
    if (x1) target |= ButtonBit(Button::X1);
    if (x2) target |= ButtonBit(Button::X2);
    if (target == buttons_) return false;

    bool changed = false;
    for (unsigned index = 0; index < kButtonCount; index += 1) {
      const unsigned bit = 1u << index;
      if ((target & bit) == (buttons_ & bit)) continue;
      syntheticEdges_ += 1;
      changed = true;
      MoveTo(atMs, at.x, at.y);
      if ((target & bit) != 0) {
        Press(atMs, at.x, at.y, static_cast<Button>(index), 0);
        state_->pressTravelResampled = true;
      } else {
        Release(atMs, at.x, at.y, static_cast<Button>(index), state_->pressTravelPx, false);
      }
    }
    return changed;
  }

  /**
   * 位置兜底（钩子静止或被摘掉时）：更新位置，**同时**累计本次按住的位移。
   *
   * 这是阶段 2 第 6 条的核心修正：以前兜底只写位置，`pressTravelPx` 恒为 0，
   * 于是"只靠轮询"的部署里角色永远停在 press_in / pressed_hold，进不了 drag。
   */
  void UpdatePosition(long long atMs, int x, int y) {
    if (state_ == nullptr) return;
    MoveTo(atMs, x, y);
    AccumulateTravel(x, y, true);
  }

  /// 滚轮 / 横向滚动：一次脉冲。不伪造按钮状态，不参与按住手势。
  void Wheel(long long atMs, int delta, bool horizontal) {
    if (state_ == nullptr) return;
    wheelPulses_ += 1;
    lastWheelDelta_ = delta;
    horizontalWheels_ += horizontal ? 1 : 0;
    EmitFeedback(atMs, "scroll", "scroll", "wheel", animation::kScrollFeedbackMs, 1.0f, true);
  }

  /**
   * 工具语义通道的反馈（阶段 4）：视觉活动消息驱动，**不**伪造全局按钮状态，
   * 也不为动画额外发送任何输入。`kind` 至少覆盖 invoke / set_value / type / scroll / pointer_click。
   */
  void ExternalFeedback(long long atMs, const std::string& kind, const std::string& clip,
                        const std::string& source, long long windowMs) {
    if (state_ == nullptr) return;
    externalFeedbacks_ += 1;
    EmitFeedback(atMs, kind, clip, source, windowMs, 1.0f, true);
    state_->feedback.external = true;
  }

  /// 工具动作结束（完成/失败/取消都走这里）。未知结果不得显示成成功庆祝，只是收势。
  void EndExternal(long long atMs, const char* reason) {
    if (state_ == nullptr || !state_->feedback.external || state_->feedback.id <= 0) return;
    if (state_->feedback.presentedAtMs < 0) {
      DropFeedback(reason != nullptr ? reason : "external_ended");
      return;
    }
    const long long shown = atMs - state_->feedback.presentedAtMs;
    if (shown >= 0 && shown < state_->feedback.windowMs) {
      state_->feedback.windowMs = std::max<long long>(60, shown);
    }
  }

  /**
   * 反馈对象首次真的呈现成功时记账（阶段 3 第 3/8 条）：只有成功 Present 之后，
   * 可见窗口才开始走。返回 true 表示这是这一条反馈的第一次成功呈现。
   */
  bool MarkPresented(long long nowMs) {
    if (state_ == nullptr || state_->feedback.id <= 0) return false;
    if (state_->feedback.presentedAtMs >= 0) return false;
    state_->feedback.presentedAtMs = nowMs;
    presented_ += 1;
    lastPresentedId_ = state_->feedback.id;
    return true;
  }

  /**
   * 未呈现反馈的过期结算：pending 预算用尽仍没显示出来，就如实丢掉并给出原因。
   * 这不是"播放完毕"，而是"没能显示"——诊断里必须能分开。
   */
  bool ExpireFeedback(long long nowMs, const char*& reason) {
    if (state_ == nullptr || state_->feedback.id <= 0) return false;
    if (state_->feedback.presentedAtMs >= 0) return false;
    if (state_->feedback.eventAtMs < 0) return false;
    if (nowMs - state_->feedback.eventAtMs <= animation::kPendingFeedbackMs) return false;
    reason = "pending_expired";
    DropFeedback(reason);
    return true;
  }

  long long Clicks() const { return clicks_; }
  long long Taps() const { return taps_; }
  long long DownEdges() const { return downs_; }
  long long UpEdges() const { return ups_; }
  long long Moves() const { return moves_; }
  long long Resyncs() const { return resyncs_; }
  long long SyntheticEdges() const { return syntheticEdges_; }
  long long WheelPulses() const { return wheelPulses_; }
  long long HorizontalWheels() const { return horizontalWheels_; }
  int LastWheelDelta() const { return lastWheelDelta_; }
  long long FeedbacksCreated() const { return feedbacks_; }
  long long FeedbacksPresented() const { return presented_; }
  long long FeedbacksCoalesced() const { return coalesced_; }
  long long FeedbacksDropped() const { return dropped_; }
  long long ExternalFeedbacks() const { return externalFeedbacks_; }
  long long FeedbackId() const { return state_ == nullptr ? 0 : state_->feedback.id; }
  const char* LastDropReason() const { return lastDropReason_; }
  /// 已施加事件里最晚的时间戳：合并进来的移动不能比它更旧，否则位置会倒退。
  long long LastEventAtMs() const { return lastEventAtMs_; }

 private:
  /// 短按倍率：把 release 片段压到"可辨认"的目标时长。资源越短倍率越小（不拖慢）。
  float TapRate() const {
    if (state_ == nullptr || state_->releaseAnimationMs <= 0) return 1.0f;
    const float raw = static_cast<float>(state_->releaseAnimationMs) / static_cast<float>(animation::kTapFeedbackMs);
    return std::min(kMaxTapRate, std::max(1.0f, raw));
  }

  void MoveTo(long long atMs, int x, int y) {
    if (!state_->hasPointer || state_->lastPointer.x != x || state_->lastPointer.y != y) {
      if (state_->hasPointer) state_->lastMoveMs = atMs;
      state_->lastPointer = POINT{x, y};
      state_->hasPointer = true;
    }
  }

  /// 统一的最大位移口径：按下原点 → 当前位置。只增不减，所以"拖出去再回原点"也算拖拽。
  void AccumulateTravel(int x, int y, bool fromFallback) {
    if (!state_->pressed || !state_->pressOriginValid) return;
    const long long dx = static_cast<long long>(x) - state_->pressOrigin.x;
    const long long dy = static_cast<long long>(y) - state_->pressOrigin.y;
    const int distance = static_cast<int>(std::lround(std::sqrt(static_cast<double>(dx * dx + dy * dy))));
    if (distance > state_->pressTravelPx) {
      state_->pressTravelPx = distance;
      if (fromFallback) state_->pressTravelResampled = true;
    }
  }

  void Press(long long atMs, int x, int y, Button button, int travelPx) {
    const unsigned bit = ButtonBit(button);
    downs_ += 1;
    buttons_ |= bit;
    if (!state_->pressed) {
      state_->pressed = true;
      state_->pressedSinceMs = atMs;
      state_->pressOrigin = POINT{x, y};
      state_->pressOriginValid = true;
      state_->pressTravelPx = std::max(0, travelPx);
      state_->pressTravelResampled = false;
    } else if (travelPx > state_->pressTravelPx) {
      state_->pressTravelPx = travelPx;
    }
  }

  void Release(long long atMs, int x, int y, Button button, int travelPx, bool countClick) {
    const unsigned bit = ButtonBit(button);
    ups_ += 1;
    buttons_ &= ~bit;
    if (state_->pressed && buttons_ == 0) {
      state_->pressed = false;
      state_->releasedAtMs = atMs;
      state_->pressOriginValid = false;
      if (travelPx > state_->pressTravelPx) state_->pressTravelPx = travelPx;
      const long long held = state_->pressedSinceMs < 0 ? 0 : atMs - state_->pressedSinceMs;
      const bool dragged = state_->pressTravelPx >= state_->dragDistancePx;
      const bool tap = held <= kShortClickMs && !dragged;
      // 每一次"所有键都抬起"都是一次点击；短按只是其中更短、需要更快收势的那一类。
      if (countClick) clicks_ += 1;
      state_->feedbackRate = tap ? TapRate() : 1.0f;
      if (tap && countClick) taps_ += 1;
      // 反馈**总是**产生：采样重建的手势也要看得见，只是 `source` 会写 `sampled`、
      // 且不计入 clicks（阶段 2 第 6 条要求标出来源与可信度）。
      const char* kind = dragged ? "pointer_drag" : (tap ? "pointer_click" : "pointer_hold");
      const long long window = tap ? animation::kTapFeedbackMs : state_->releaseAnimationMs;
      const std::string source = state_->pressTravelResampled ? "sampled" : "input";
      EmitFeedback(atMs, kind, "release", source, window, state_->feedbackRate, false);
      // 位置在按下点与抬起点之间没有移动时，仍然记一次"最后位置"用于 move 窗口。
      if (state_->lastPointer.x != x || state_->lastPointer.y != y) {
        state_->lastPointer = POINT{x, y};
      }
    }
  }

  /**
   * 生成（或续期）一条反馈。
   *
   * `allowMerge` 为真时，同类反馈在 `kFeedbackMergeMs` 内再次到达只续期：这是**有界合并**，
   * 连点与连续滚动不会积压成一串动画。点击/拖拽走 `allowMerge=false`，因为它们必须可辨认。
   */
  void EmitFeedback(long long atMs, const std::string& kind, const std::string& clip, const std::string& source,
                    long long windowMs, float rate, bool allowMerge) {
    if (state_ == nullptr) return;
    animation::Feedback& current = state_->feedback;
    if (allowMerge && current.id > 0 && current.kind == kind) {
      const long long anchor = current.presentedAtMs >= 0 ? current.presentedAtMs : current.eventAtMs;
      if (anchor >= 0 && atMs - anchor <= animation::kFeedbackMergeMs) {
        current.eventAtMs = std::max(current.eventAtMs, atMs);
        if (current.presentedAtMs >= 0) {
          current.windowMs = std::max(current.windowMs, (atMs - current.presentedAtMs) + windowMs);
        } else {
          current.windowMs = windowMs;
        }
        current.mergeCount += 1;
        current.coalesced = true;
        current.source = source;
        current.external = source == "uia" || source == "cdp" || source == "tool" || current.external;
        coalesced_ += 1;
        return;
      }
    }
    feedbacks_ += 1;
    current.id = feedbacks_;
    current.kind = kind;
    current.clip = clip;
    current.source = source;
    current.eventAtMs = atMs;
    current.presentedAtMs = -1;
    current.windowMs = std::max<long long>(1, windowMs);
    current.rate = rate;
    current.coalesced = false;
    current.mergeCount = 1;
    current.resampled = source == "sampled";
    current.external = source == "uia" || source == "cdp" || source == "tool";
  }

  void DropFeedback(const char* reason) {
    dropped_ += 1;
    lastDropReason_ = reason != nullptr ? reason : "unknown";
    if (state_ == nullptr) return;
    state_->feedback.id = 0;
    state_->feedback.presentedAtMs = -1;
    state_->feedback.eventAtMs = -1;
  }

  animation::PointerState* state_ = nullptr;
  unsigned buttons_ = 0;
  long long clicks_ = 0;
  long long taps_ = 0;
  long long downs_ = 0;
  long long ups_ = 0;
  long long moves_ = 0;
  long long resyncs_ = 0;
  long long syntheticEdges_ = 0;
  long long wheelPulses_ = 0;
  long long horizontalWheels_ = 0;
  int lastWheelDelta_ = 0;
  long long feedbacks_ = 0;
  long long presented_ = 0;
  long long coalesced_ = 0;
  long long dropped_ = 0;
  long long externalFeedbacks_ = 0;
  long long lastPresentedId_ = 0;
  const char* lastDropReason_ = "none";
  long long lastEventAtMs_ = 0;
};

}  // namespace pointer
