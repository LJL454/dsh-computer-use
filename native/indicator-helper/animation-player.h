// 动画时钟与二级动作相位（方案 4.6 / 5.2）。
//
// 当前实现的两处**真实**错误都收在这里修：
//
//   1. `press_in` / `release` 用的是"helper 启动后累计时间"，超过片段时长就永远停在末帧 ——
//      所以每次按下都要从 `stateEnteredAt` 重新起算，不是从进程启动算。
//   2. 帧号曾按 tick 递增，慢动作时同一帧被重复画、卡顿后又会"补播"。这里改成**按累计时长**
//      用单调时钟选帧，负的 elapsed 当 0，卡顿后只显示此刻应该显示的那一帧。
//
// 这个头文件不认识窗口，也不认识协议：只把"现在该画第几帧、下一次换帧是何时"算出来。
#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

namespace animation {

/// 一级动作的状态名（与 pack.json 里的 clip 名一致）。
inline const char* StateName(int index) {
  static const char* names[] = {"idle",           "move", "press_in", "pressed_hold", "release",
                                "drag",           "eat_loop", "scroll", "typing",       "tap"};
  if (index < 0 || index >= static_cast<int>(sizeof(names) / sizeof(names[0]))) return "idle";
  return names[index];
}

/* ------------------------------------------------------------- feedback -- */

/// 未呈现反馈最多等多久（毫秒）：墙钟过去不等于"已经播完"，但也不能无限期霸占状态。
constexpr long long kPendingFeedbackMs = 500;
/// 同类高频反馈的合并窗口：窗口内到达的同类反馈只续期，不排队（有界合并）。
constexpr long long kFeedbackMergeMs = 120;
/// 单击可辨认反馈的目标时长（方案 阶段 3 第 5 条给的 150—250 ms 区间取中值）。
constexpr long long kTapFeedbackMs = 220;
/// 滚轮/输入活动的续期步长。
constexpr long long kScrollFeedbackMs = 180;
constexpr long long kTypingFeedbackMs = 260;

/**
 * 一次反馈对象（方案 阶段 3 第 2 条）。
 *
 * 关键点是**事件时间与展示时间分开**：`eventAtMs` 只用于手势判定与延迟统计，
 * `presentedAtMs` 才是可见窗口的起点。有了 `id`，即使新反馈仍然叫 `release`
 * （高频连点、同名片段）也能重新起算，不再依赖"clip 名变了没有"。
 */
struct Feedback {
  long long id = 0;
  std::string kind = "none";     ///< pointer_click / pointer_drag / pointer_hold / scroll / type / invoke / set_value
  std::string clip = "release";  ///< 实际选用的片段名（可能退化到已有片段）
  std::string source = "input";  ///< input / sampled / wheel / keyboard / uia / cdp / tool
  long long eventAtMs = -1;      ///< 真实事件时间
  long long presentedAtMs = -1;  ///< 首次成功 Present 的时间；-1 表示还没显示
  long long windowMs = 0;        ///< 可见窗口（已按 rate 折算）
  float rate = 1.0f;
  bool coalesced = false;        ///< 高频合并：只续期，不排队
  int mergeCount = 1;
  bool resampled = false;        ///< 采样/兜底重建的手势（可信度低于真实边沿）
  bool external = false;         ///< 来自工具语义通道（UIA/CDP/命令行），不是系统输入边沿
};

/**
 * 按累计时长取帧（方案 5.2）。
 *
 * @param frameCount - 帧数。
 * @param durationsMs - 每帧时长（长度必须等于 frameCount；不足时按首帧时长补齐）。
 * @param totalMs - 一轮总时长（≤0 时用累计值兜底）。
 * @param loop - 是否循环。
 * @param elapsedMs - 距本次进入该状态的时间；负值按 0 处理。
 */
inline int FrameFor(int frameCount, const std::vector<int>& durationsMs, int totalMs, bool loop, long long elapsedMs) {
  if (frameCount <= 1 || durationsMs.empty()) return 0;
  const int total = totalMs > 0 ? totalMs : 1;
  long long at = elapsedMs > 0 ? elapsedMs : 0;
  if (loop) {
    at %= total;
  } else if (at >= total) {
    return frameCount - 1;  // 一次性片段：停在末帧，不再回卷
  }
  int accumulated = 0;
  for (int index = 0; index < frameCount; index += 1) {
    accumulated += durationsMs[static_cast<size_t>(index) < durationsMs.size() ? static_cast<size_t>(index) : durationsMs.size() - 1];
    if (at < accumulated) return index;
  }
  return frameCount - 1;
}

/**
 * 下一次换帧的时刻（距**进入状态**的毫秒数）。没有未来期限（一次性片段已到末帧）时返回 -1。
 *
 * 修正（方案 4.H）：以前循环片段在第一轮之后只返回"下一轮边界"，例如 move（8×125 ms）在
 * elapsed=1125 ms 时正确期限是 1250 ms，函数却返回 2000 ms —— 独立动画定时因此失效。
 * 现在按"轮起点 + 轮内第一个严格大于 within 的累计结束时间"算，多轮、恰好落在帧边界、
 * 非均匀帧长都成立。
 */
inline long long NextFrameDeadlineMs(int frameCount, const std::vector<int>& durationsMs, int totalMs, bool loop, long long elapsedMs) {
  if (frameCount <= 1 || durationsMs.empty()) return -1;
  const int total = totalMs > 0 ? totalMs : 1;
  const long long at = elapsedMs > 0 ? elapsedMs : 0;
  const long long cycleBase = loop ? (at / total) * total : 0;
  const long long within = loop ? at % total : at;
  long long accumulated = 0;
  for (int index = 0; index < frameCount; index += 1) {
    accumulated += durationsMs[static_cast<size_t>(index) < durationsMs.size() ? static_cast<size_t>(index) : durationsMs.size() - 1];
    if (within < accumulated) return cycleBase + accumulated;
  }
  // 恰好落在轮末（frameCount 帧全部播完）：循环片段的下一个期限就是下一轮第一帧的边界。
  return loop ? cycleBase + total : -1;
}

/**
 * 进入帧的起始偏移（方案 三·问题 F）。
 *
 * 循环片段不再共用"进程启动时刻"当相位起点：进入 `to` 时先由 transitions 表选定一个进入帧，
 * 再把 `enteredAt` 倒推这么多毫秒，于是 `FrameFor(elapsed)` 恰好落在那一帧上，之后照常往下循环。
 *
 * @returns 该帧在片段内开始的毫秒数；越界帧钳到 [0, frameCount-1]，空时长返回 0。
 */
inline long long EntryStartMs(const std::vector<int>& durationsMs, int frameIndex) {
  if (durationsMs.empty() || frameIndex <= 0) return 0;
  const int limit = std::min(frameIndex, static_cast<int>(durationsMs.size()));
  long long sum = 0;
  for (int index = 0; index < limit; index += 1) sum += std::max(0, durationsMs[static_cast<size_t>(index)]);
  return sum;
}

/**
 * 光标角色的状态机（方案 4.18.6 / 4.4）。
 *
 * 停止/故障 → 拖拽 → 按住/抬起 → 移动 → 待机。只由"真实按钮集合 + 真实指针移动"决定；
 * 拖拽要用实际位移阈值，**长按本身不算拖拽**（方案 4.4 的"长按不能被误判成拖拽"）。
 */
struct PointerState {
  bool pressed = false;
  long long pressedSinceMs = -1;
  long long releasedAtMs = -1;
  long long lastMoveMs = 0;
  POINT lastPointer{0, 0};
  POINT pressOrigin{0, 0};
  int pressTravelPx = 0;      ///< 本次按住期间离按下点的最大位移
  bool pressOriginValid = false;
  bool hasPointer = false;
  /// 本次手势的位移里至少有一段来自兜底采样/重同步，而不是钩子边沿。
  bool pressTravelResampled = false;
  /// 拖拽判定阈值：按住期间的**最大位移**超过它就算拖拽，"长按 200 ms"不再是前置条件。
  long long dragHoldMs = 200;  ///< 保留字段：仅用于诊断，不参与判定
  int dragDistancePx = 6;
  long long pressAnimationMs = 320;
  long long releaseAnimationMs = 360;
  long long moveWindowMs = 160;
  /// release 片段的播放倍率。短按按"可辨认反馈"目标时长反算，普通按住保持原速。
  float feedbackRate = 1.0f;
  /// 当前呈现中的反馈对象（方案 阶段 3）。`id == 0` 时退回旧的 releasedAtMs 口径。
  Feedback feedback;

  /// release 在当前倍率下的可见时长（毫秒）。四舍五入，避免 650/2.9545 这种倍率被截成 219。
  long long ReleaseVisibleMs() const {
    const float rate = feedbackRate > 0.1f ? feedbackRate : 1.0f;
    return static_cast<long long>(
        std::lround(static_cast<double>(releaseAnimationMs) / static_cast<double>(rate)));
  }

  /// 未呈现反馈：仍在 pending 预算内，必须先显示出来（不能被墙钟饿掉）。
  bool FeedbackPending(long long nowMs) const {
    if (feedback.id <= 0 || feedback.presentedAtMs >= 0) return false;
    if (feedback.eventAtMs < 0) return false;
    return nowMs - feedback.eventAtMs <= kPendingFeedbackMs;
  }

  /// 已呈现反馈：可见窗口从首次成功 Present 起算。
  bool FeedbackShowing(long long nowMs) const {
    if (feedback.id <= 0 || feedback.presentedAtMs < 0) return false;
    return nowMs - feedback.presentedAtMs < feedback.windowMs;
  }
};

enum class StopPhase { Running, Stopped };

/// 由指针状态与当前相位决定该播哪个 clip。
inline const char* StateFor(const PointerState& pointer, long long nowMs, StopPhase phase) {
  if (phase == StopPhase::Stopped) return "idle";
  if (pointer.pressed) {
    const long long heldFor = pointer.pressedSinceMs < 0 ? 0 : nowMs - pointer.pressedSinceMs;
    // 方案 4.C：拖拽只看位移。以前要求"按住超过 200 ms"才算拖动，150 ms 内完成的快速拖动
    // 即使距离早就够了也进不了 drag。长按只用来决定 hold，不再是所有拖动的前置条件。
    if (pointer.pressTravelPx >= pointer.dragDistancePx) return "drag";
    return heldFor > pointer.pressAnimationMs ? "pressed_hold" : "press_in";
  }
  // 方案 阶段 3 第 3/4 条：反馈对象优先，且未呈现前不许判过期；同名片段由 id 区分。
  if (pointer.FeedbackPending(nowMs) || pointer.FeedbackShowing(nowMs)) return pointer.feedback.clip.c_str();
  if (pointer.releasedAtMs >= 0 && nowMs - pointer.releasedAtMs < pointer.ReleaseVisibleMs()) return "release";
  if (nowMs - pointer.lastMoveMs < pointer.moveWindowMs) return "move";
  return "idle";
}

/**
 * 二级动作（方案 4.4 / 4.6）。
 *
 * 资源是"完整合成帧包"时，尾巴与头发的动作已经在帧里，这一层只负责**呼吸与尾摆的相位**给
 * 分层资源用；`renderMode=composite` 时调用方不应把这里的结果贴到人物上（那会变成"全身平移"）。
 * 相位在状态切换时**保持**，只调整幅度 —— 这样换状态时尾巴不会突然断相。
 */
struct SecondaryMotion {
  /// 相位起点：进程启动时设定一次，之后不随状态切换重置。
  long long phaseAtMs = 0;
  /// 最近一次采样到的状态幅度（0..1，相对可见高度）与周期。
  float tailAmplitude = 0.045f;
  float tailPeriodMs = 3000.0f;
  float breathAmplitude = 0.008f;
  float breathPeriodMs = 3800.0f;
  bool frozen = false;

  struct Profile {
    float tailAmplitude;
    float tailPeriodMs;
  };

  /// 每个状态的尾摆幅度/周期（方案 4.4 的起始值，以可见高度 H 计）。
  static Profile ProfileFor(const std::string& state) {
    if (state == "eat_loop") return Profile{0.042f, 3000.0f};
    if (state == "idle") return Profile{0.045f, 3200.0f};
    if (state == "move") return Profile{0.080f, 900.0f};
    if (state == "drag") return Profile{0.070f, 1100.0f};
    if (state == "press_in") return Profile{0.050f, 700.0f};
    if (state == "pressed_hold") return Profile{0.035f, 2600.0f};
    if (state == "release") return Profile{0.040f, 800.0f};
    if (state == "scroll") return Profile{0.060f, 1000.0f};
    if (state == "typing") return Profile{0.055f, 760.0f};
    if (state == "tap") return Profile{0.045f, 820.0f};
    return Profile{0.045f, 3200.0f};
  }

  /// 换状态：只调幅度与周期，相位不动（方案 4.6 的"跨状态保持尾部当前相位"）。
  void OnStateChanged(const std::string& state, bool reducedMotion) {
    const Profile profile = ProfileFor(state);
    tailAmplitude = profile.tailAmplitude;
    tailPeriodMs = profile.tailPeriodMs;
    frozen = reducedMotion;
  }

  /// 尾摆的归一化相位（-1..1）。冻结点固定为 0，避免减少动画时还换像素。
  float TailWave(long long nowMs) const {
    if (frozen || tailPeriodMs <= 0.0f) return 0.0f;
    const double t = static_cast<double>(nowMs - phaseAtMs) / static_cast<double>(tailPeriodMs);
    return static_cast<float>(std::sin(6.283185307179586 * t));
  }

  /// 尾鳍相位比尾根滞后约半个关键相位（0.5 周期）。
  float FinWave(long long nowMs) const {
    if (frozen || tailPeriodMs <= 0.0f) return 0.0f;
    const double t = static_cast<double>(nowMs - phaseAtMs) / static_cast<double>(tailPeriodMs) - 0.18;
    return static_cast<float>(std::sin(6.283185307179586 * t));
  }

  /// 呼吸（-1..1），与尾摆不同周期，避免同相抖动。
  float BreathWave(long long nowMs) const {
    if (frozen || breathPeriodMs <= 0.0f) return 0.0f;
    const double t = static_cast<double>(nowMs - phaseAtMs) / static_cast<double>(breathPeriodMs);
    return static_cast<float>(std::sin(6.283185307179586 * t));
  }
};

/* --------------------------------------------------------------- scheduler -- */

/// 脏状态：只有变了的表面才重新合成并呈现（方案 6.2）。
enum DirtyFlag : unsigned {
  kDirtyNone = 0u,
  kDirtyGeometry = 1u << 0,   ///< 矩形/DPI/拓扑变了：重建表面
  kDirtyContent = 1u << 1,    ///< 文字/主题/底板/停止状态变了
  kDirtyCharacter = 1u << 2,  ///< 角色换帧或姿势变了
  kDirtyPosition = 1u << 3,   ///< 光标位置变了（只移动窗口，不重画像素）
  kDirtyVisibility = 1u << 4, ///< 显示/隐藏变了
  kDirtyAll = 0x1Fu,
};

/// 到期时刻表：主循环据此睡到最近一个期限，而不是固定 20 Hz 轮询。
struct Deadlines {
  bool any = false;
  long long atMs = 0;

  void Add(long long whenMs) {
    if (whenMs < 0) return;
    if (!any || whenMs < atMs) {
      atMs = whenMs;
      any = true;
    }
  }
  /// 距离下一个期限还要等多久（毫秒，至少 1，最多 capMs）。
  long long WaitMs(long long nowMs, long long capMs) const {
    if (!any) return capMs;
    const long long remaining = atMs - nowMs;
    if (remaining <= 1) return 1;
    return remaining > capMs ? capMs : remaining;
  }
};

}  // namespace animation
