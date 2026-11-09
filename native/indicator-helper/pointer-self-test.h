// 指针保真自检（方案 六 的首条验收：合成事件 10,000 组 down/up 不丢失、不乱序）。
//
// 自检直接跑**产品代码**：`pointer::Source`（钩子回调落点）、`pointer::Controller`（状态归约）、
// `animation::StateFor`（选择片段）。没有另写一份 JS 状态机，所以测试通过与线上行为是同一段逻辑。
//
// 三组断言：
//   1. 10,000 组点击 + 移动，每步即排空：边沿数量、顺序、点击判定、最大位移、最终未按住。
//   2. 10,000 组"主线程卡住"（整组攒着再排空）：边沿仍然不丢，被合并的移动以最新位置补交。
//   3. 溢出与重同步：移动把队列填满时按钮边沿仍有保留槽位；真丢边沿时如实计数并可校正。
//
//   dsh-interaction-indicator.exe --pointer-self-test
#pragma once

#include "pointer-controller.h"

#include <cstdio>
#include <random>
#include <string>
#include <vector>

namespace pointer {
namespace selftest {

struct Report {
  int checks = 0;
  int groups = 0;
  int groupsOnline = 0;
  int groupsStalled = 0;
  std::vector<std::string> failures;

  void Check(const std::string& name, bool ok, const std::string& detail = std::string()) {
    checks += 1;
    if (ok) return;
    if (failures.size() < 40) failures.push_back(detail.empty() ? name : name + " :: " + detail);
  }
};

inline std::string Num(long long value) { return std::to_string(value); }

/// 一组脚本化输入：按下 → 若干移动 → 抬起。
struct Script {
  Button button = Button::Left;
  long long atMs = 0;
  long long holdMs = 30;
  int baseX = 500;
  int baseY = 400;
  std::vector<POINT> path;   ///< 不含按下点本身；抬起点在最后一个 path 点或按下点。
  bool stalled = false;      ///< true = 整组先攒着，最后一次性排空
  int paddingMoves = 0;      ///< 额外灌入的移动条数（制造队列压力）
};

inline int Distance(POINT a, POINT b) {
  const long long dx = static_cast<long long>(a.x) - b.x;
  const long long dy = static_cast<long long>(a.y) - b.y;
  return static_cast<int>(std::lround(std::sqrt(static_cast<double>(dx * dx + dy * dy))));
}

/// 队列顺序的全局见证：取出的每条事件序号都必须严格递增。
struct OrderWitness {
  unsigned long long last = 0;
  long long violations = 0;
  long long observed = 0;
};

inline OrderWitness& Witness() {
  static OrderWitness witness;
  return witness;
}

/// 按 main.cpp 的消费顺序排空：先取队列，再补一条被合并的最终位置（比已施加事件更旧的不要）。
/// `witness` 默认为全局见证；独立的 Source 实例序号从 1 重新开始，所以各有各的见证。
inline void DrainAll(Source& source, Controller& controller, OrderWitness* witness = nullptr) {
  OrderWitness& seen = witness != nullptr ? *witness : Witness();
  Event event;
  while (source.Pop(event)) {
    if (event.seq <= seen.last) seen.violations += 1;
    seen.last = event.seq;
    seen.observed += 1;
    controller.Apply(event);
  }
  Event merged;
  if (source.TakeCoalescedMove(merged) && merged.atMs >= controller.LastEventAtMs()) controller.Apply(merged);
}

/// 跑一组脚本，返回这一组实际产生的边沿数（供调用方核对）。
inline void RunScript(const Script& script, Source& source, Controller& controller, Report& report,
                      const std::string& label) {
  const long long downAt = script.atMs;
  const long long upAt = script.atMs + script.holdMs;
  const POINT down{script.baseX, script.baseY};
  const POINT up = script.path.empty() ? down : script.path.back();

  source.PushButton(downAt, down, Kind::Down, script.button, false);
  long long stepAt = downAt + 1;
  for (size_t index = 0; index < script.path.size(); index += 1) {
    source.PushMove(stepAt, script.path[index], false);
    stepAt += 1;
  }
  for (int index = 0; index < script.paddingMoves; index += 1) {
    source.PushMove(stepAt, POINT{script.baseX + (index % 64), script.baseY + (index % 32)}, false);
    stepAt += 1;
  }
  source.PushButton(upAt, up, Kind::Up, script.button, false);

  int expectedTravel = 0;
  for (const POINT& point : script.path) expectedTravel = std::max(expectedTravel, Distance(point, down));
  if (script.paddingMoves > 0) {
    for (int index = 0; index < script.paddingMoves; index += 1) {
      const POINT point{script.baseX + (index % 64), script.baseY + (index % 32)};
      expectedTravel = std::max(expectedTravel, Distance(point, down));
    }
  }

  const long long clicksBefore = controller.Clicks();
  const long long tapsBefore = controller.Taps();
  DrainAll(source, controller);

  report.Check(label + ": no button is left held", !controller.Pressed(), Num(controller.Buttons()));
  report.Check(label + ": one press and one release were observed",
               controller.DownEdges() >= 1 && controller.UpEdges() >= 1,
               Num(controller.DownEdges()) + "/" + Num(controller.UpEdges()));
  report.Check(label + ": the travel matches the real path",
               controller.State()->pressTravelPx == expectedTravel,
               Num(controller.State()->pressTravelPx) + " vs " + Num(expectedTravel));

  const bool tap = script.holdMs <= kShortClickMs && expectedTravel < controller.State()->dragDistancePx;
  const long long clicksAfter = controller.Clicks();
  const long long tapsAfter = controller.Taps();
  report.Check(label + ": every completed press counts as one click", (clicksAfter - clicksBefore) == 1,
               Num(clicksAfter - clicksBefore));
  report.Check(label + ": only a short press counts as a tap", (tapsAfter - tapsBefore) == (tap ? 1 : 0),
               Num(tapsAfter - tapsBefore));

  // 核心回归：短按也必须在抬起后立刻进入 release，而不是消费完只剩 idle。
  const char* onRelease = animation::StateFor(*controller.State(), upAt + 1, animation::StopPhase::Running);
  report.Check(label + ": the release is visible right after up", std::string(onRelease) == "release",
               std::string(onRelease));
  // 阶段 3 第 5 条：短按的可辨认反馈目标 150—250 ms，由倍率反算而不是写死的 2.5 倍。
  const long long visible = controller.State()->ReleaseVisibleMs();
  if (tap) {
    report.Check(label + ": a tap lands in the 150-250 ms band",
                 visible >= 150 && visible <= 250 && visible == animation::kTapFeedbackMs, Num(visible));
  } else {
    report.Check(label + ": a normal press keeps the full release", visible == 650, Num(visible));
  }
  // 阶段 3 第 3 条：可见窗口从**首次成功呈现**起算。呈现之前不许因为墙钟过去就判过期。
  // 探测点取"窗口末尾"与"pending 预算内"的较小者：pending 预算本身就是有界的，
  // 超过预算还没画出来要如实报 dropped，而不是无限期挂着（见后面的 starved 用例）。
  const long long lateProbe = upAt + std::min<long long>(visible + 20, animation::kPendingFeedbackMs - 10);
  report.Check(label + ": a delayed paint is not judged as finished",
               std::string(animation::StateFor(*controller.State(), lateProbe, animation::StopPhase::Running)) ==
                   "release",
               "a consumer that is " + Num(lateProbe - upAt) + " ms late must still show the click");
  controller.MarkPresented(upAt + 1);
  const char* afterWindow =
      animation::StateFor(*controller.State(), upAt + 1 + visible + 20, animation::StopPhase::Running);
  report.Check(label + ": the release ends once its presented window is over", std::string(afterWindow) != "release",
               std::string(afterWindow));
}

inline std::string JsonEscape(const std::string& text) {
  std::string out;
  out.reserve(text.size() + 8);
  for (const char c : text) {
    if (c == '"' || c == '\\') {
      out.push_back('\\');
      out.push_back(c);
    } else if (c == '\n') {
      out += "\\n";
    } else {
      out.push_back(c);
    }
  }
  return out;
}

/// 跑完整个自检，打印一行 JSON 并返回进程退出码。
inline int Run() {
  Report report;
  std::mt19937_64 random(20261107ull);

  animation::PointerState state;
  state.pressAnimationMs = 570;    // 与 pack.json 的 press_in 一致
  state.releaseAnimationMs = 650;  // 与 pack.json 的 release 一致
  state.dragDistancePx = 6;
  Controller controller;
  controller.Bind(&state);
  Source source;

  unsigned long long previousSequence = 0;
  bool sequenceOk = true;

  // ---- 1. 10,000 组：每组立刻排空（正常主线程节奏） ----
  for (int index = 0; index < 10000; index += 1) {
    Script script;
    const unsigned pick = static_cast<unsigned>(random() % 3);
    script.button = pick == 0 ? Button::Left : (pick == 1 ? Button::Right : Button::Middle);
    script.atMs = 1'000 + static_cast<long long>(index) * 4;
    const unsigned kind = static_cast<unsigned>(random() % 4);
    script.holdMs = kind == 0 ? static_cast<long long>(random() % 4)          // 0..3 ms 极短点击
                              : kind == 1 ? 5 + static_cast<long long>(random() % 116)   // 5..120 ms 短点击
                                          : kind == 2 ? 121 + static_cast<long long>(random() % 450)  // 普通按压
                                                      : 571 + static_cast<long long>(random() % 2000);  // 长按
    script.baseX = 100 + static_cast<int>(random() % 3000);
    script.baseY = 100 + static_cast<int>(random() % 1600);
    const int moves = static_cast<int>(random() % 7);
    int x = script.baseX;
    int y = script.baseY;
    for (int step = 0; step < moves; step += 1) {
      x += static_cast<int>(random() % 41) - 20;
      y += static_cast<int>(random() % 41) - 20;
      script.path.push_back(POINT{x, y});
    }
    // 每 7 组固定塞一条"拖出去再回原点"：最大位移不能被最终位置掩盖。
    if (index % 7 == 0) {
      script.path.push_back(POINT{script.baseX + 40, script.baseY + 30});
      script.path.push_back(POINT{script.baseX, script.baseY});
    }
    RunScript(script, source, controller, report, "online#" + Num(index));
    if (!source.Empty()) {
      // 每组必须排空：留着会让下一组的起点不干净。
      DrainAll(source, controller);
    }
    if (source.Sequence() < previousSequence) sequenceOk = false;
    previousSequence = source.Sequence();
    report.groupsOnline += 1;
    report.groups += 1;
  }

  // ---- 2. 10,000 组：整组攒着再排空（主线程卡住 / 首次解码 / 断点） ----
  for (int index = 0; index < 10000; index += 1) {
    Script script;
    script.stalled = true;
    script.button = static_cast<unsigned>(random() % 3) == 0 ? Button::Right : Button::Left;
    script.atMs = 100'000 + static_cast<long long>(index) * 4;
    script.holdMs = static_cast<long long>(random() % 700);
    script.baseX = 50 + static_cast<int>(random() % 2000);
    script.baseY = 50 + static_cast<int>(random() % 1200);
    const int moves = static_cast<int>(random() % 5);
    for (int step = 0; step < moves; step += 1) {
      script.path.push_back(POINT{script.baseX + static_cast<int>(random() % 61) - 30,
                                  script.baseY + static_cast<int>(random() % 61) - 30});
    }
    if (index % 100 == 0) {
      script.paddingMoves = 600;  // 把队列灌满：移动被合并，但按钮边沿仍有保留槽位
      script.holdMs = script.paddingMoves + 50;  // 抬起必须晚于全部填充移动
    }
    RunScript(script, source, controller, report, "stalled#" + Num(index));
    report.groupsStalled += 1;
    report.groups += 1;
  }

  // ---- 3. 溢出、保留槽位与重同步 ----
  {
    Source pressure;
    Controller quiet;
    animation::PointerState quietState;
    quiet.Bind(&quietState);

    const POINT origin{10, 10};
    pressure.PushButton(0, origin, Kind::Down, Button::Left, false);
    for (int index = 0; index < 2000; index += 1) {
      pressure.PushMove(index + 1, POINT{10 + index % 500, 10 + index % 300}, false);
    }
    for (int index = 0; index < 8; index += 1) {
      pressure.PushButton(3000 + index, origin, index % 2 == 0 ? Kind::Down : Kind::Up, Button::Left, false);
    }
    pressure.PushButton(4000, origin, Kind::Up, Button::Left, false);
    report.Check("overflow: moves are coalesced instead of blocking the queue",
                 pressure.Coalesced() > 0, Num(static_cast<long long>(pressure.Coalesced())));
    report.Check("overflow: the reserved slots keep every button edge",
                 pressure.DroppedEdges() == 0, Num(static_cast<long long>(pressure.DroppedEdges())));
    report.Check("overflow: overflow episodes are observable",
                 pressure.OverflowEpisodes() >= 1, Num(static_cast<long long>(pressure.OverflowEpisodes())));
    OrderWitness pressureOrder;
    DrainAll(pressure, quiet, &pressureOrder);
    report.Check("overflow: the consumer is not left pressed", !quiet.Pressed());
    report.Check("overflow: the surviving events keep their order", pressureOrder.violations == 0,
                 Num(pressureOrder.violations));

    Source drowning;
    for (int index = 0; index < 600; index += 1) {
      drowning.PushButton(index, origin, index % 2 == 0 ? Kind::Down : Kind::Up, Button::Left, false);
    }
    report.Check("overflow: losing edges is counted, not hidden",
                 drowning.DroppedEdges() > 0, Num(static_cast<long long>(drowning.DroppedEdges())));
    report.Check("overflow: a lost edge asks for a resync", drowning.TakeResyncRequest());

    // 重同步：系统说"没有键按下"，归约器必须把残留的按住状态解开。
    animation::PointerState stuck;
    Controller rescuer;
    rescuer.Bind(&stuck);
    Event down;
    down.kind = Kind::Down;
    down.button = Button::Left;
    down.atMs = 0;
    rescuer.Apply(down);
    report.Check("resync: an unreleased press starts out pressed", rescuer.Pressed());
    const bool changed = rescuer.Resync(500, POINT{10, 10}, false, false, false);
    report.Check("resync: the system state wins", changed && !rescuer.Pressed());
    report.Check("resync: the release it synthesises is not counted as a click", rescuer.Clicks() == 0,
                 Num(rescuer.Clicks()));
    const bool changedBack = rescuer.Resync(600, POINT{10, 10}, true, false, false);
    report.Check("resync: a press the queue never saw is recovered", changedBack && rescuer.Pressed());
  }

  // ---- 4. 定点回归：同一批里的 down+up、多键交错、拖出又回原点 ----
  {
    Source batch;
    animation::PointerState state2;
    state2.pressAnimationMs = 570;
    state2.releaseAnimationMs = 650;
    Controller controller2;
    controller2.Bind(&state2);

    // 3 ms 点击：旧实现里主线程两次采样都只看到 false，状态机永远不会收到按下。
    batch.PushButton(0, POINT{100, 100}, Kind::Down, Button::Left, true);
    batch.PushButton(3, POINT{100, 100}, Kind::Up, Button::Left, true);
    OrderWitness batchOrder;
    DrainAll(batch, controller2, &batchOrder);
    report.Check("regression: the batch keeps its order", batchOrder.violations == 0, Num(batchOrder.violations));
    report.Check("regression: a 3 ms click still reaches the state machine", controller2.Clicks() == 1,
                 Num(controller2.Clicks()));
    report.Check("regression: it is visible as a release, not as idle",
                 std::string(animation::StateFor(state2, 4, animation::StopPhase::Running)) == "release",
                 std::string(animation::StateFor(state2, 4, animation::StopPhase::Running)));
    report.Check("regression: a 3 ms click uses the fast release", state2.feedbackRate > 1.5f &&
                                                                   state2.ReleaseVisibleMs() == animation::kTapFeedbackMs,
                 std::to_string(state2.feedbackRate) + "/" + Num(state2.ReleaseVisibleMs()));
    report.Check("regression: the click produced a numbered feedback", state2.feedback.id > 0 &&
                                                                         state2.feedback.kind == "pointer_click",
                 state2.feedback.kind + "#" + Num(state2.feedback.id));

    // 多键交错：左键抬起时右键还按着，不能结束手势。
    Source multi;
    animation::PointerState state3;
    Controller controller3;
    controller3.Bind(&state3);
    multi.PushButton(0, POINT{0, 0}, Kind::Down, Button::Left, false);
    multi.PushButton(10, POINT{0, 0}, Kind::Down, Button::Right, false);
    multi.PushButton(20, POINT{0, 0}, Kind::Up, Button::Left, false);
    OrderWitness multiOrder;
    DrainAll(multi, controller3, &multiOrder);
    report.Check("multi-button: releasing one button keeps the gesture", controller3.Pressed());
    multi.PushButton(30, POINT{0, 0}, Kind::Up, Button::Right, false);
    DrainAll(multi, controller3, &multiOrder);
    report.Check("multi-button: the last release ends it", !controller3.Pressed());
    report.Check("multi-button: the events keep their order", multiOrder.violations == 0,
                 Num(multiOrder.violations));

    // 拖出去再回原点：最终位置等于按下点，但最大位移必须被记住（判定为 drag）。
    Source drag;
    animation::PointerState state4;
    Controller controller4;
    controller4.Bind(&state4);
    drag.PushButton(0, POINT{100, 100}, Kind::Down, Button::Left, false);
    drag.PushMove(1, POINT{180, 160}, false);
    drag.PushMove(2, POINT{100, 100}, false);
    OrderWitness dragOrder;
    DrainAll(drag, controller4, &dragOrder);
    report.Check("drag: out and back keeps the maximum travel", state4.pressTravelPx >= 100,
                 Num(state4.pressTravelPx));
    report.Check("drag: it reads as drag while held",
                 std::string(animation::StateFor(state4, 3, animation::StopPhase::Running)) == "drag",
                 std::string(animation::StateFor(state4, 3, animation::StopPhase::Running)));

    // 负时间：抬起时刻晚于 now 时按 release 处理，不出现负数选帧。
    animation::PointerState state5;
    state5.pressed = false;
    state5.releasedAtMs = 1000;
    state5.releaseAnimationMs = 650;
    report.Check("time: a negative elapsed still selects release",
                 std::string(animation::StateFor(state5, 900, animation::StopPhase::Running)) == "release");
    report.Check("time: FrameFor clamps a negative elapsed",
                 animation::FrameFor(8, {125, 125, 125, 125, 125, 125, 125, 125}, 1000, true, -50) == 0);

    // 方案 三·问题 F：进入帧的起始偏移。用 8×125 与一条非均匀时长各验一遍。
    const std::vector<int> even{125, 125, 125, 125, 125, 125, 125, 125};
    report.Check("entry: frame 0 starts at 0", animation::EntryStartMs(even, 0) == 0,
                 Num(animation::EntryStartMs(even, 0)));
    report.Check("entry: frame 4 starts at 500", animation::EntryStartMs(even, 4) == 500,
                 Num(animation::EntryStartMs(even, 4)));
    report.Check("entry: frame 7 starts at 875", animation::EntryStartMs(even, 7) == 875,
                 Num(animation::EntryStartMs(even, 7)));
    report.Check("entry: an out-of-range frame is clamped", animation::EntryStartMs(even, 99) == 1000,
                 Num(animation::EntryStartMs(even, 99)));
    report.Check("entry: a negative frame is treated as 0", animation::EntryStartMs(even, -3) == 0,
                 Num(animation::EntryStartMs(even, -3)));
    const std::vector<int> uneven{650, 250, 100, 150, 100, 350, 350, 650};
    report.Check("entry: uneven durations accumulate", animation::EntryStartMs(uneven, 3) == 1000,
                 Num(animation::EntryStartMs(uneven, 3)));
    report.Check("entry: the chosen frame is what FrameFor reports",
                 animation::FrameFor(8, uneven, 2600, true, animation::EntryStartMs(uneven, 5)) == 5,
                 Num(animation::FrameFor(8, uneven, 2600, true, animation::EntryStartMs(uneven, 5))));
    report.Check("entry: an empty clip starts at 0", animation::EntryStartMs({}, 5) == 0,
                 Num(animation::EntryStartMs({}, 5)));
  }

  report.Check("the queue never went backwards", sequenceOk);
  report.Check("every popped event is strictly newer than the previous one",
               Witness().violations == 0, Num(Witness().violations));
  report.Check("the witness really looked at the whole stream", Witness().observed >= 100000,
               Num(Witness().observed));

  // ---- 5. 阶段 2/3 的新回归：兜底拖拽、同名反馈重启、待呈现窗口、滚轮与侧键、工具语义 ----
  {
    // P1-C：只靠"重同步按下 + 位置兜底"也要能进入 drag。以前 travel 恒为 0。
    animation::PointerState sampled;
    sampled.dragDistancePx = 6;
    Controller sampledController;
    sampledController.Bind(&sampled);
    sampledController.Resync(1000, POINT{400, 400}, true, false, false);
    for (int step = 1; step <= 20; step += 1) {
      sampledController.UpdatePosition(1000 + step * 5, 400 + step * 5, 400);
    }
    report.Check("fallback: the press is reconstructed from the system state", sampled.pressed);
    report.Check("fallback: the fallback move accumulates the drag distance", sampled.pressTravelPx >= 100,
                 Num(sampled.pressTravelPx));
    report.Check("fallback: the gesture is marked as sampled", sampled.pressTravelResampled);
    report.Check("fallback: it reads as drag while held",
                 std::string(animation::StateFor(sampled, 1100, animation::StopPhase::Running)) == "drag",
                 std::string(animation::StateFor(sampled, 1100, animation::StopPhase::Running)));
    sampledController.Resync(1200, POINT{500, 400}, false, false, false);
    report.Check("fallback: the release feedback names its source", sampled.feedback.source == "sampled",
                 sampled.feedback.source);
    report.Check("fallback: the drag is reported as a drag, not a click", sampled.feedback.kind == "pointer_drag",
                 sampled.feedback.kind);

    // P1-E：同名 clip 的第二次点击必须重新起算（靠 feedback id，而不是字符串比较）。
    animation::PointerState twice;
    twice.releaseAnimationMs = 650;
    Controller twiceController;
    twiceController.Bind(&twice);
    twiceController.Apply(Event{0, 1000, 10, 10, 0, Kind::Down, Button::Left, false, false});
    twiceController.Apply(Event{0, 1050, 10, 10, 0, Kind::Up, Button::Left, false, false});
    const long long firstId = twice.feedback.id;
    twiceController.MarkPresented(1051);
    report.Check("feedback: the first click is presented", twice.feedback.presentedAtMs == 1051,
                 Num(twice.feedback.presentedAtMs));
    twiceController.Apply(Event{0, 1250, 10, 10, 0, Kind::Down, Button::Left, false, false});
    twiceController.Apply(Event{0, 1300, 10, 10, 0, Kind::Up, Button::Left, false, false});
    report.Check("feedback: a new click gets a new id even with the same clip name",
                 twice.feedback.id > firstId, Num(twice.feedback.id) + " vs " + Num(firstId));
    report.Check("feedback: the new feedback starts unpresented", twice.feedback.presentedAtMs < 0,
                 Num(twice.feedback.presentedAtMs));
    report.Check("feedback: the new click is visible again right away",
                 std::string(animation::StateFor(twice, 1301, animation::StopPhase::Running)) == "release",
                 std::string(animation::StateFor(twice, 1301, animation::StopPhase::Running)));

    // P1-D：主线程晚 350 ms 才处理，仍未呈现 → 必须还在；呈现之后窗口才走。
    animation::PointerState late;
    late.releaseAnimationMs = 650;
    Controller lateController;
    lateController.Bind(&late);
    lateController.Apply(Event{0, 1000, 10, 10, 0, Kind::Down, Button::Left, false, false});
    lateController.Apply(Event{0, 1050, 10, 10, 0, Kind::Up, Button::Left, false, false});
    report.Check("delay: a 350 ms late consumer still shows the click",
                 std::string(animation::StateFor(late, 1400, animation::StopPhase::Running)) == "release",
                 std::string(animation::StateFor(late, 1400, animation::StopPhase::Running)));
    const char* expiredReason = nullptr;
    report.Check("delay: within the pending budget nothing is dropped",
                 !lateController.ExpireFeedback(1400, expiredReason), lateController.LastDropReason());
    lateController.MarkPresented(1400);
    report.Check("delay: the window starts at the first present",
                 std::string(animation::StateFor(late, 1500, animation::StopPhase::Running)) == "release",
                 std::string(animation::StateFor(late, 1500, animation::StopPhase::Running)));
    report.Check("delay: and ends exactly one window later",
                 std::string(animation::StateFor(late, 1400 + animation::kTapFeedbackMs + 5,
                                                 animation::StopPhase::Running)) != "release",
                 "the presented window did not end");

    // 未呈现预算用尽：如实丢弃并给出原因，不能假装"播完了"。
    animation::PointerState starved;
    starved.releaseAnimationMs = 650;
    Controller starvedController;
    starvedController.Bind(&starved);
    starvedController.Apply(Event{0, 1000, 10, 10, 0, Kind::Down, Button::Left, false, false});
    starvedController.Apply(Event{0, 1050, 10, 10, 0, Kind::Up, Button::Left, false, false});
    const bool droppedLate = starvedController.ExpireFeedback(1050 + animation::kPendingFeedbackMs + 10, expiredReason);
    report.Check("delay: a feedback that never painted is reported as dropped", droppedLate, starvedController.LastDropReason());
    report.Check("delay: the drop reason is explicit",
                 std::string(starvedController.LastDropReason()) == "pending_expired",
                 starvedController.LastDropReason());
    report.Check("delay: it no longer forces the clip",
                 std::string(animation::StateFor(starved, 1050 + animation::kPendingFeedbackMs + 20,
                                                 animation::StopPhase::Running)) == "idle",
                 std::string(animation::StateFor(starved, 1050 + animation::kPendingFeedbackMs + 20,
                                                 animation::StopPhase::Running)));

    // 滚轮：脉冲驱动反馈，不伪造按住，不改变 pressed。
    animation::PointerState wheeled;
    Controller wheelController;
    wheelController.Bind(&wheeled);
    wheelController.Apply(Event{0, 2000, 50, 50, 0, Kind::Wheel, Button::Left, false, false, 120, false});
    report.Check("wheel: a pulse does not fake a press", !wheeled.pressed);
    report.Check("wheel: it produces a scroll feedback", wheeled.feedback.kind == "scroll" &&
                                                             wheeled.feedback.clip == "scroll",
                 wheeled.feedback.kind + "/" + wheeled.feedback.clip);
    report.Check("wheel: the source is the wheel, not an input click", wheeled.feedback.source == "wheel",
                 wheeled.feedback.source);
    const long long wheelPulseId = wheeled.feedback.id;
    wheelController.Apply(Event{0, 2030, 50, 50, 0, Kind::Wheel, Button::Left, false, false, 120, true});
    report.Check("wheel: rapid pulses coalesce into one feedback", wheeled.feedback.id == wheelPulseId,
                 Num(wheeled.feedback.id));
    report.Check("wheel: the merge is counted", wheeled.feedback.coalesced && wheeled.feedback.mergeCount == 2,
                 Num(wheeled.feedback.mergeCount));
    report.Check("wheel: horizontal pulses are counted separately", wheelController.HorizontalWheels() == 1,
                 Num(wheelController.HorizontalWheels()));

    // 侧键：独立 down/up，不与其他按钮混淆。
    animation::PointerState sided;
    Controller sideController;
    sideController.Bind(&sided);
    sideController.Apply(Event{0, 3000, 5, 5, 0, Kind::Down, Button::X1, false, false});
    report.Check("side buttons: X1 presses the gesture", sided.pressed);
    sideController.Apply(Event{0, 3050, 5, 5, 0, Kind::Up, Button::X1, false, false});
    report.Check("side buttons: X1 releases it again", !sided.pressed);
    report.Check("side buttons: the click is counted", sideController.Clicks() == 1, Num(sideController.Clicks()));

    // 工具语义通道：只驱动视觉，不伪造按钮；结束时收势；未知结果不算成功。
    animation::PointerState tool;
    Controller toolController;
    toolController.Bind(&tool);
    toolController.ExternalFeedback(4000, "invoke", "press_in", "uia", 260);
    report.Check("activity: a UIA invoke never fakes a press", !tool.pressed);
    report.Check("activity: it is marked external", tool.feedback.external && tool.feedback.source == "uia",
                 tool.feedback.source);
    report.Check("activity: the clip is what the caller asked for",
                 std::string(animation::StateFor(tool, 4001, animation::StopPhase::Running)) == "press_in",
                 std::string(animation::StateFor(tool, 4001, animation::StopPhase::Running)));
    toolController.MarkPresented(4010);
    toolController.EndExternal(4080, "completed");
    report.Check("activity: ending shortens the presented window instead of restarting it",
                 std::string(animation::StateFor(tool, 4081, animation::StopPhase::Running)) != "press_in",
                 "the window did not end");
    report.Check("activity: ending does not count as a user click", toolController.Clicks() == 0,
                 Num(toolController.Clicks()));
  }

  char buffer[512];
  std::string failures = "[";
  for (size_t index = 0; index < report.failures.size(); index += 1) {
    if (index > 0) failures += ",";
    failures += "\"" + JsonEscape(report.failures[index]) + "\"";
  }
  failures += "]";
  std::snprintf(buffer, sizeof(buffer),
                "{\"kind\":\"pointer-self-test\",\"ok\":%s,\"groups\":%d,\"groupsOnline\":%d,"
                "\"groupsStalled\":%d,\"checks\":%d,\"failures\":",
                report.failures.empty() ? "true" : "false", report.groups, report.groupsOnline, report.groupsStalled,
                report.checks);
  std::string line = buffer + failures + "}";
  std::fwrite(line.data(), 1, line.size(), stdout);
  std::fputc('\n', stdout);
  std::fflush(stdout);
  return report.failures.empty() ? 0 : 1;
}

}  // namespace selftest
}  // namespace pointer
