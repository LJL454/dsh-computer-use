// DSH 交互提示 helper —— 覆盖层 v2（方案 3.x / 4.x / 6.x / 7.1 的落地实现）。
//
// 与 1.50.1 的结构差别，逐条对着方案：
//
//   - 窗口拆分：每台显示器四条细边窗口 + 一个独立横幅窗口，全局最多一个光标窗口。1.50.1 是每台
//     显示器一张整屏 HWND：角色或光晕一动就要重传约 14 MiB 的整屏位图。
//   - 统一 DPI：窗口位置 / DIB 尺寸 / 鼠标热点是物理像素；布局、文字、人物大小是 DIP。D2D render
//     target 保存真实 DPI，传给它的坐标一律 DIP（1.50.1 把物理宽高当 DIP 又乘了一次缩放）。
//   - 独立时钟：press_in / release 用 stateEnteredAt 起算，不是进程启动后的累计时间；帧号按累计
//     时长选，不再"每 tick index++"。
//   - 按需刷新：每条边 / 横幅 / 光标各有期限与脏状态；没有期限就等消息，不再固定轮询。
//   - 基础提示与装饰分离：visualEffects.enabled=false 只熄装饰，四边与两段文字仍是静态提示。
//   - 日常伴随：独立开关，不建 TaskScope、不申请电脑操作权限；只起视觉 helper 与一个光标窗口。
//   - 健康度如实：逐窗核对 CreateWindow / CreateSurface / UpdateLayeredWindow /
//     SetWindowDisplayAffinity；windows 不再冒充显示器数量。
//
// 协议见 docs/indicator-helper-protocol.md（v2）。编译：native/indicator-helper/build.ps1

#define NOMINMAX
#include <windows.h>
#include <shellscalingapi.h>
#include <wrl/client.h>

#include "animation-player.h"
#include "banner-theme.h"
#include "character.h"
#include "overlay-layout.h"
#include "overlay-registry.h"
#include "overlay-render.h"
#include "pointer-controller.h"
#include "pointer-events.h"
#include "pointer-self-test.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <deque>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

using Microsoft::WRL::ComPtr;

namespace {

/* ------------------------------------------------------------------ json -- */

/// 一个极小的 JSON 值。协议只用到对象、字符串、数字、布尔与 null。
struct Json {
  enum class Type { Null, Bool, Number, String, Object, Array } type = Type::Null;
  bool boolean = false;
  double number = 0;
  std::string text;
  std::map<std::string, Json> object;
  std::vector<Json> array;

  const Json* Find(const std::string& key) const {
    if (type != Type::Object) return nullptr;
    const auto it = object.find(key);
    return it == object.end() ? nullptr : &it->second;
  }
  std::string StringOr(const std::string& key, const std::string& fallback = "") const {
    const Json* value = Find(key);
    return value != nullptr && value->type == Type::String ? value->text : fallback;
  }
  double NumberOr(const std::string& key, double fallback = 0) const {
    const Json* value = Find(key);
    return value != nullptr && value->type == Type::Number ? value->number : fallback;
  }
  bool BoolOr(const std::string& key, bool fallback = false) const {
    const Json* value = Find(key);
    return value != nullptr && value->type == Type::Bool ? value->boolean : fallback;
  }
};

/// 递归下降解析器；失败时给出位置说明（只用于诊断）。
class JsonParser {
 public:
  explicit JsonParser(const std::string& text) : text_(text) {}
  bool Parse(Json& out, std::string& error) {
    SkipSpace();
    if (!ParseValue(out)) {
      error = error_.empty() ? "invalid JSON" : error_;
      return false;
    }
    SkipSpace();
    if (pos_ != text_.size()) {
      error = "trailing characters after the value";
      return false;
    }
    return true;
  }

 private:
  void SkipSpace() {
    while (pos_ < text_.size() &&
           (text_[pos_] == ' ' || text_[pos_] == '\t' || text_[pos_] == '\r' || text_[pos_] == '\n')) {
      pos_ += 1;
    }
  }
  bool Fail(const char* why) {
    if (error_.empty()) error_ = std::string(why) + " at offset " + std::to_string(pos_);
    return false;
  }
  bool ParseValue(Json& out) {
    if (pos_ >= text_.size()) return Fail("unexpected end of input");
    switch (text_[pos_]) {
      case '{': return ParseObject(out);
      case '[': return ParseArray(out);
      case '"': {
        out.type = Json::Type::String;
        return ParseString(out.text);
      }
      case 't':
      case 'f': {
        if (text_.compare(pos_, 4, "true") == 0) {
          out.type = Json::Type::Bool;
          out.boolean = true;
          pos_ += 4;
          return true;
        }
        if (text_.compare(pos_, 5, "false") == 0) {
          out.type = Json::Type::Bool;
          out.boolean = false;
          pos_ += 5;
          return true;
        }
        return Fail("expected true/false");
      }
      case 'n': {
        if (text_.compare(pos_, 4, "null") == 0) {
          out.type = Json::Type::Null;
          pos_ += 4;
          return true;
        }
        return Fail("expected null");
      }
      default: return ParseNumber(out);
    }
  }
  bool ParseObject(Json& out) {
    out.type = Json::Type::Object;
    pos_ += 1;
    SkipSpace();
    if (pos_ < text_.size() && text_[pos_] == '}') {
      pos_ += 1;
      return true;
    }
    while (true) {
      SkipSpace();
      std::string key;
      if (!ParseString(key)) return false;
      SkipSpace();
      if (pos_ >= text_.size() || text_[pos_] != ':') return Fail("expected ':'");
      pos_ += 1;
      Json value;
      SkipSpace();
      if (!ParseValue(value)) return false;
      out.object[key] = value;
      SkipSpace();
      if (pos_ < text_.size() && text_[pos_] == ',') {
        pos_ += 1;
        continue;
      }
      if (pos_ < text_.size() && text_[pos_] == '}') {
        pos_ += 1;
        return true;
      }
      return Fail("expected ',' or '}'");
    }
  }
  bool ParseArray(Json& out) {
    out.type = Json::Type::Array;
    pos_ += 1;
    SkipSpace();
    if (pos_ < text_.size() && text_[pos_] == ']') {
      pos_ += 1;
      return true;
    }
    while (true) {
      Json value;
      SkipSpace();
      if (!ParseValue(value)) return false;
      out.array.push_back(value);
      SkipSpace();
      if (pos_ < text_.size() && text_[pos_] == ',') {
        pos_ += 1;
        continue;
      }
      if (pos_ < text_.size() && text_[pos_] == ']') {
        pos_ += 1;
        return true;
      }
      return Fail("expected ',' or ']'");
    }
  }
  bool ParseString(std::string& out) {
    if (pos_ >= text_.size() || text_[pos_] != '"') return Fail("expected a string");
    pos_ += 1;
    out.clear();
    while (pos_ < text_.size()) {
      const char ch = text_[pos_];
      if (ch == '"') {
        pos_ += 1;
        return true;
      }
      if (ch == '\\') {
        pos_ += 1;
        if (pos_ >= text_.size()) return Fail("unterminated escape");
        switch (text_[pos_]) {
          case '"': out.push_back('"'); break;
          case '\\': out.push_back('\\'); break;
          case '/': out.push_back('/'); break;
          case 'b': out.push_back('\b'); break;
          case 'f': out.push_back('\f'); break;
          case 'n': out.push_back('\n'); break;
          case 'r': out.push_back('\r'); break;
          case 't': out.push_back('\t'); break;
          default: return Fail("unsupported escape");
        }
        pos_ += 1;
        continue;
      }
      out.push_back(ch);
      pos_ += 1;
    }
    return Fail("unterminated string");
  }
  bool ParseNumber(Json& out) {
    const size_t start = pos_;
    if (pos_ < text_.size() && (text_[pos_] == '-' || text_[pos_] == '+')) pos_ += 1;
    bool digits = false;
    while (pos_ < text_.size() &&
           (isdigit(static_cast<unsigned char>(text_[pos_])) || text_[pos_] == '.' || text_[pos_] == 'e' ||
            text_[pos_] == 'E' || text_[pos_] == '-' || text_[pos_] == '+')) {
      if (isdigit(static_cast<unsigned char>(text_[pos_]))) digits = true;
      pos_ += 1;
    }
    if (!digits) return Fail("expected a number");
    out.type = Json::Type::Number;
    out.number = strtod(text_.substr(start, pos_ - start).c_str(), nullptr);
    return true;
  }

  const std::string& text_;
  size_t pos_ = 0;
  std::string error_;
};

/// 宽字符串转 UTF-8。
std::string Narrow(const std::wstring& text) {
  if (text.empty()) return {};
  const int size = WideCharToMultiByte(CP_UTF8, 0, text.c_str(), -1, nullptr, 0, nullptr, nullptr);
  if (size <= 1) return {};
  std::string out(static_cast<size_t>(size - 1), '\0');
  WideCharToMultiByte(CP_UTF8, 0, text.c_str(), -1, out.data(), size, nullptr, nullptr);
  return out;
}

/// JSON 字符串转义。
std::string EscapeJson(const std::string& text) {
  std::string out;
  out.reserve(text.size() + 8);
  for (const char ch : text) {
    switch (ch) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (static_cast<unsigned char>(ch) < 0x20) {
          char buffer[8];
          snprintf(buffer, sizeof(buffer), "\\u%04x", static_cast<unsigned char>(ch));
          out += buffer;
        } else {
          out += ch;
        }
    }
  }
  return out;
}

/* -------------------------------------------------------------- protocol -- */

/// 协议版本：窗口拆分、伴随消息与窗口计数都在 v2；v1 supervisor 与 v2 helper 不能混装。
constexpr int kProtocolVersion = 2;
constexpr size_t kMaxLineBytes = 64 * 1024;
constexpr const char* kBuildVersion = "1.50.1-overlay-v2";

std::mutex g_outMutex;

/// 写一行 JSONL 到 stdout。超出行长上限时丢弃。
void EmitLine(const std::string& line) {
  if (line.size() > kMaxLineBytes) return;
  std::lock_guard<std::mutex> lock(g_outMutex);
  fwrite(line.data(), 1, line.size(), stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

/// 组装一条响应：{"event":"…","field":…}。
class Message {
 public:
  explicit Message(const std::string& event) { body_ = "{\"event\":\"" + EscapeJson(event) + "\""; }
  Message& Str(const std::string& key, const std::string& value) {
    body_ += ",\"" + EscapeJson(key) + "\":\"" + EscapeJson(value) + "\"";
    return *this;
  }
  Message& Num(const std::string& key, double value) {
    body_ += ",\"" + EscapeJson(key) + "\":" + NumberText(value);
    return *this;
  }
  Message& Bool(const std::string& key, bool value) {
    body_ += ",\"" + EscapeJson(key) + "\":" + (value ? "true" : "false");
    return *this;
  }
  Message& Raw(const std::string& key, const std::string& raw) {
    body_ += ",\"" + EscapeJson(key) + "\":" + raw;
    return *this;
  }
  std::string Done() const { return body_ + "}"; }

 private:
  static std::string NumberText(double value) {
    char buffer[40];
    if (value == static_cast<double>(static_cast<long long>(value))) {
      snprintf(buffer, sizeof(buffer), "%lld", static_cast<long long>(value));
    } else {
      snprintf(buffer, sizeof(buffer), "%.3f", value);
    }
    return buffer;
  }
  std::string body_;
};

/* ------------------------------------------------------------------ state -- */

enum class Phase { Idle, Preparing, Active, Stopping, Faulted };

/// 日常伴随的开关注册（方案 3.5 / 7.1）：与电脑控制装饰分开保存。
struct CompanionState {
  bool enabled = false;
  std::string hostInstanceId;
  long settingsRevision = 0;
  long long helperGeneration = 0;
  std::string hiddenReason = "disabled";
  bool appliedOnce = false;
};

/// 全局状态：协议线程与窗口线程共用。
struct Helper {
  std::mutex mutex;
  Phase phase = Phase::Idle;
  std::string scopeId;
  long epoch = -1;
  long seq = -1;
  long layoutEpoch = 0;
  long long generation = 1;
  render::Preferences prefs;
  CompanionState companion;
  std::atomic<bool> latch{false};
  std::atomic<long> escCount{0};
  std::atomic<long> frames{0};
  std::atomic<long> loopIterations{0};
  std::atomic<long> renderPasses{0};
  std::atomic<long> cursorEnsureFails{0};
  std::atomic<long> characterDraws{0};
  std::atomic<bool> hookReady{false};
  /// 方案 4.B：两个低级钩子分别报告。以前只看键盘钩子，鼠标钩子被系统静默摘掉也报正常。
  std::atomic<bool> keyboardHookReady{false};
  std::atomic<bool> mouseHookReady{false};
  std::atomic<bool> shuttingDown{false};
  std::atomic<bool> pointerWakePending{false};
  /// 钩子回调被调用的次数：排障时用它区分"没人动鼠标"和"钩子没收到"。
  std::atomic<long> mouseHookCalls{0};
  std::atomic<long> mouseHookError{0};
  std::atomic<long> hookThreadExit{0};
  DWORD mainThreadId = 0;
  std::string backend = "layered";
  std::wstring assetsDir;
  long long startedAtMs = 0;
  bool visualReady = false;
  bool visualSuspended = false;
  long selfTestPressedAfterDown = 0;
  long selfTestPressedAfterUp = 0;
  long stopRequests = 0;
  long rejectedCommands = 0;
  /// 方案 二·问题 A 的诊断计数：事件队列的真实工作量与降级情况。
  long pointerEventsApplied = 0;
  long pointerResyncs = 0;
  long pointerClicks = 0;
  long pointerWakeFailures = 0;
  long long lastResyncAtMs = 0;
  std::string lastResyncReason = "startup";
  /// 方案 五.3：位置应用节流与诊断。
  long long lastPositionAtMs = 0;
  POINT lastAppliedPointer{0, 0};
  long long positionUpdates = 0;
  long long wakeSuppressed = 0;
  long long layoutRefreshes = 0;
  long long monitorQueries = 0;
  /// 缓存的显示器矩形/DPI：同屏移动不再每次 MonitorFromPoint。
  bool cursorMonitorValid = false;
  RECT cursorMonitorRect{0, 0, 0, 0};
  UINT cursorMonitorDpi = 96;
  /// 方案 4.D 的验收计数：普通动作切换时这两个数**不应增长**（窗口/表面没有周转）。
  long cursorWindowCreates = 0;
  long cursorSurfaceRebuilds = 0;

  overlay::Registry registry;
  character::Assets assets;
  character::Cache cache;
  /// 方案 五.1：后台预热线程。Cache 的加锁表负责发布，绘制线程从不等待它。
  character::Prewarm prewarm;
  /// 诊断：--no-prewarm 时退回同步解码，用来做"有/无预热"的同机对照。
  bool prewarmDisabled = false;
  /// 诊断：--no-render-key 时退回"每次唤醒都重画"，用来做"有/无像素调度"的同机对照。
  bool renderKeyDisabled = false;
  /// 诊断：--no-halo-cache 时每帧重新逐像素算光晕，用来量化缓存收益。
  bool haloCacheDisabled = false;
  /// 从真实按下到下一次 Present 的毫秒数（方案 六 的 P95 口径）。
  long long pendingPressAtMs = -1;
  long long lastPressToPresentMs = -1;

  /* ---- 阶段 3：反馈 / 呈现诊断 ---- */
  /// 当前正在显示的反馈 id 与它的首次呈现时刻（用于诊断与"新 id 必须重新起算"）。
  long long cursorFeedbackId = 0;
  long long feedbackPresented = 0;
  long long feedbackDropped = 0;
  std::string feedbackDropReason = "none";
  long long feedbackPresentToComposeMs = -1;
  /* ---- 阶段 2：输入投递健康与降级 ---- */
  /// 钩子安装时刻、重装次数、最近一次重装时刻。
  long long hookInstalledAtMs = 0;
  long hookReinstalls = 0;
  long long lastHookReinstallAtMs = 0;
  /// 最近一次"独立观察到位置变化"的时刻，以及那一刻的钩子计数（判投递异常的证据）。
  long long lastPositionObservedAtMs = 0;
  unsigned long long seenAtLastObservation = 0;
  bool deliveredSinceInstall = false;
  long long lastDeliveryAnomalyAtMs = -1;
  long long lastDegradedSampleAtMs = 0;
  long sampledResyncs = 0;
  /* ---- 阶段 2 第 8 条：键盘活动（只计数，不保存键值/字符/窗口文字） ---- */
  std::atomic<long> keyActivity{0};
  std::atomic<long long> lastKeyActivityAtMs{0};
  long long typingActive = false;
  long long typingLastAtMs = 0;
  /* ---- 阶段 4：工具动作语义通道 ---- */
  long activityApplied = 0;
  std::string lastActivityKind = "none";
  std::string lastActivityPhase = "none";
  std::string lastActivitySource = "none";
  std::string lastActivityOperationId;
  long long lastActivityAtMs = 0;

  animation::PointerState pointer;
  animation::SecondaryMotion motion;
  std::string cursorClip = "idle";
  long long cursorEnteredAtMs = 0;
  long long loopPhaseOriginMs = 0;
  int cursorFrame = 0;
  long long cursorFrameDueMs = -1;
  /// 方案 三·问题 F：最近一次进入片段时选中的进入帧，以及这次切换的短混合窗口。
  int cursorEntryFrame = 0;
  long long cursorFadeStartMs = 0;
  int cursorFadeMs = 0;
  /// 最近一次切换实际采用的混合时长（不会随窗口到期而清零，便于断言）。
  int cursorLastFadeMs = 0;
  /// 上一帧的像素（只在混合窗口内复制），同尺寸才有效。
  std::vector<uint32_t> cursorFadePrev;
  HWND cursorFadePrevWindow = nullptr;
  int cursorFadePrevWidth = 0;
  int cursorFadePrevHeight = 0;
  bool cursorLayoutDirty = true;
  overlay::CursorLayout cursorLayout;
  UINT cursorDpi = 96;
  bool cursorHasLayout = false;

  long long edgeDueMs = -1;
  long long bannerDueMs = -1;
  bool edgesDirty = true;
  bool bannerDirty = true;
  bool cursorDirty = true;
  /// 方案 五.2：上一帧的 renderKey 与"那一次是否画成功"。key 不变就不重新合成、不 Present。
  unsigned long long cursorLastKey = 0;
  bool cursorLastComplete = false;
  long long cursorPresents = 0;
  /// 最后一次低级钩子回调的时间：用来判断"钩子装上了但系统不投递"（复核第 3 条那条限制）。
  std::atomic<long long> lastHookCallbackAtMs{0};
  /// 方案 五.4：合成耗时（只统计 render::DrawCursor 本身）。
  long long cursorComposeUs = 0;
  long long cursorComposeCount = 0;
  long long cursorComposeMaxUs = 0;
  /// 最近 10 次合成的滑动平均：冷启动那一两帧不该混进"稳态"读数。
  long long composeRecent[10] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
  int composeRecentIndex = 0;
  int composeRecentCount = 0;
  long long cursorPixelSkips = 0;
  int bannerFrame = 0;
  long long bannerFrameDueMs = -1;
  std::string bannerError;
  std::string cursorError;
};

Helper g_helper;
std::string g_shutdownRequestId;
/// 诊断开关：--no-affinity 时不请求截图排除，只用于像素比对。
bool g_excludeFromCapture = true;

/// 钩子线程写入、主线程采样：按钮状态用原子量，避免跨线程读一个普通结构体。
/// 方案 二·问题 A：这三个布尔量就是"按下和抬起被最终值覆盖"的根源 —— 现在换成有序事件队列，
/// 钩子把每条边沿连同时间与位置推进 `g_pointerSource`，主线程按顺序归约。
pointer::Source g_pointerSource;
pointer::Controller g_pointerController;
/// 没有角色、也没有控制 scope 时，钩子不再为移动推事件/唤醒（按钮与 Esc 仍然即时）。
std::atomic<bool> g_pointerWanted{false};
std::atomic<long long> g_lastMoveWakeMs{0};
std::atomic<long> g_wakeSuppressed{0};
/// 启动自检直接调用钩子回调：这段期间**不许**污染真实投递计数（阶段 2 第 3 条 / 4.G）。
std::atomic<bool> g_inSelfTest{false};
/// 键盘活动唤醒限速：每 50 ms 最多叫醒一次主线程，输入 20 字/秒也不会变成 20 次唤醒。
std::atomic<long long> g_lastKeyWakeMs{0};

/// 刷新节奏（毫秒）。四边 20 Hz 保留现有效果；横幅同样 20 Hz；光标姿势不超过 30 Hz。
constexpr long long kHookSilenceWarnMs = 3000;  // 装上了却 3 秒没回调，按"沉默"上报
constexpr long long kEdgeIntervalMs = 100;  // 呼吸是 3 秒的正弦：10 Hz = 33 采样/周期，肉眼无差；20 Hz 实测白烧 ~19% 单核
constexpr long long kBannerIntervalMs = 50;
constexpr long long kCursorPoseIntervalMs = 34;
constexpr long long kIdleWaitCapMs = 1000;
constexpr long long kBusyWaitCapMs = 250;
constexpr long long kPointerFallbackMs = 100;
/// 方案 五.3：移动的唤醒上限（≈125 Hz，覆盖 60/120/144 Hz 显示）与位置应用上限。
constexpr long long kMoveWakeMinMs = 8;
constexpr long long kPositionIntervalMs = 8;
/// 阶段 2 第 4 条：钩子被判定"投递异常"时的按钮降级采样间隔（16—33 ms 取 16 ms）。
/// 采样**永远**不能保证抓住比采样周期更短的点击，它只是"钩子没投递时别完全没有按钮"。
constexpr long long kDegradedSampleMs = 16;
/// 健康时的一致性检查间隔：只用来兜住"钩子被静默摘掉"，不做密集诊断。
constexpr long long kHealthyConfirmMs = 1000;
/// 投递"新鲜"窗口：这段时间内有过真实回调就算 ok。
constexpr long long kDeliveryFreshMs = 1500;
/// 阶段 2 第 3 条：疑似丢投递后的有界重装退避（0.5 / 1 / 2 / 5 秒，之后封顶 5 秒）。
constexpr long long kReinstallBackoffMs[4] = {500, 1000, 2000, 5000};
constexpr int kReinstallBackoffCount = 4;
/// 阶段 2 第 8 条：键盘活动聚合窗口。超过它就认为这次输入间歇结束。
constexpr long long kTypingIdleMs = 400;
/// 一次按下之后最多等多久就按"投递异常"处理（钩子装上了、且有消费方）。
constexpr long long kDeliveryAnomalyMs = 1200;
/// 请求钩子线程重装鼠标钩子的自定义消息（定义在这里是因为采样路径要能投递它）。
constexpr UINT kReinstallMouseHookMessage = WM_APP + 5;
/// 钩子线程 id：由 `HookThreadProc` 启动时写入，采样路径只读。
extern DWORD g_hookThreadId;

inline long long NowUs() {
  using namespace std::chrono;
  return duration_cast<microseconds>(steady_clock::now().time_since_epoch()).count();
}

long long NowMs() {
  using namespace std::chrono;
  return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

bool IsStoppingOrFaulted(Phase phase) { return phase == Phase::Stopping || phase == Phase::Faulted; }

/* ------------------------------------------------------------- identity -- */

/**
 * 运行身份（阶段 1）：进程完整性、UIAccess、会话与真实 exe 路径。
 *
 * 阶段 1 的核心事实是"低完整性角色进程装的低级钩子收不到当前桌面的输入"。宿主侧看不到这些，
 * 只有 helper 自己能读自己的令牌，所以把结论原样报上去，让 doctor 能直接把部署问题说出来，
 * 而不是让人继续怀疑鼠标驱动。
 */
struct Identity {
  long long integrityRid = -1;
  bool uiAccess = false;
  unsigned long sessionId = 0;
};

Identity ReadIdentity() {
  Identity identity;
  HANDLE token = nullptr;
  if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) {
    DWORD length = 0;
    GetTokenInformation(token, TokenIntegrityLevel, nullptr, 0, &length);
    if (length > 0) {
      std::vector<unsigned char> buffer(static_cast<size_t>(length), 0);
      if (GetTokenInformation(token, TokenIntegrityLevel, buffer.data(), length, &length)) {
        const auto* label = reinterpret_cast<const TOKEN_MANDATORY_LABEL*>(buffer.data());
        if (label->Label.Sid != nullptr) {
          const DWORD* sub = GetSidSubAuthority(label->Label.Sid,
                                                static_cast<DWORD>(*GetSidSubAuthorityCount(label->Label.Sid) - 1));
          if (sub != nullptr) identity.integrityRid = *sub;
        }
      }
    }
    BOOL uiAccess = FALSE;
    DWORD returned = 0;
    if (GetTokenInformation(token, TokenUIAccess, &uiAccess, sizeof(uiAccess), &returned)) {
      identity.uiAccess = uiAccess != FALSE;
    }
    CloseHandle(token);
  }
  DWORD session = 0;
  if (ProcessIdToSessionId(GetCurrentProcessId(), &session)) identity.sessionId = session;
  return identity;
}

/// 完整性级别名：UIPI 的分界线是 Medium（0x2000）。Low 及以下装不上"看得见用户桌面"的钩子。
const char* IntegrityName(long long rid) {
  if (rid < 0) return "unknown";
  if (rid >= 0x5000) return "protected";
  if (rid >= 0x4000) return "system";
  if (rid >= 0x3000) return "high";
  if (rid >= 0x2000) return "medium";
  if (rid >= 0x1000) return "low";
  return "untrusted";
}

/// 部署身份是否满足"能看见用户桌面输入"的最低条件。
bool IdentityCanObserveInput(const Identity& identity) { return identity.integrityRid >= 0x2000; }

/// 启动时读一次的运行身份与真实 exe 路径（阶段 1 的诊断事实）。
Identity g_identity;
std::wstring g_exePath;

/* --------------------------------------------------------- input delivery -- */

/**
 * 钩子的投递状态（阶段 2 第 2/3 条 / P1-G）。
 *
 * 拆成四件事分开说，不再用一个 `hookSilent` 概括：
 *   unavailable —— 钩子没装上；
 *   idle        —— 装上了，但这一轮没有任何消费方（角色/控制都不在），不猜；
 *   ok          —— 最近有真实回调（`kDeliveryFreshMs` 内）；
 *   quiet       —— 安静：没有回调，也**没有**任何独立观察到的活动（用户真的没动）；
 *   anomalous   —— 位置独立地变了、按键独立地按着，钩子计数却一动不动：这才是"没投递"。
 * 只有 anomalous 才触发降级采样与有界重装；正常静止 60 秒不会误报。
 */
enum class Delivery { Unavailable, Idle, Quiet, Ok, Anomalous };

const char* DeliveryName(Delivery delivery) {
  switch (delivery) {
    case Delivery::Unavailable: return "unavailable";
    case Delivery::Idle: return "idle";
    case Delivery::Ok: return "ok";
    case Delivery::Anomalous: return "anomalous";
    case Delivery::Quiet:
    default: return "quiet";
  }
}


/* --------------------------------------------------------------- visibility -- */

/// 当前是否处于电脑控制 scope（四边 / 横幅只在这个期间存在）。
bool ControlActive() {
  return (g_helper.phase == Phase::Preparing || g_helper.phase == Phase::Active ||
          g_helper.phase == Phase::Stopping) &&
         !g_helper.scopeId.empty();
}

/// 控制期间装饰是否生效（关闭只熄装饰，基础提示仍在）。
bool ControlDecoration() { return ControlActive() && g_helper.prefs.decoration; }

bool CompanionVisible() { return g_helper.companion.enabled && g_helper.companion.hiddenReason.empty(); }

/// 重新计算伴随的隐藏原因（只影响显示，不改用户保存的开关）。
void RefreshCompanionReason() {
  if (!g_helper.companion.enabled) {
    g_helper.companion.hiddenReason = "disabled";
    return;
  }
  if (g_helper.shuttingDown.load()) {
    g_helper.companion.hiddenReason = "shuttingDown";
    return;
  }
  if (g_helper.visualSuspended) {
    g_helper.companion.hiddenReason = "suspended";
    return;
  }
  if (!g_helper.assets.ok) {
    g_helper.companion.hiddenReason = "assetsMissing";
    return;
  }
  g_helper.companion.hiddenReason.clear();
}

bool CursorCharacterWanted() {
  const bool control = ControlDecoration() && g_helper.prefs.cursorCharacter;
  return control || CompanionVisible();
}

bool CursorHaloWanted() { return ControlDecoration() && g_helper.prefs.cursorHalo; }

bool CursorWindowWanted() { return !g_helper.visualSuspended && (CursorCharacterWanted() || CursorHaloWanted()); }

/// 钩子投递状态（见上方 `enum class Delivery` 的判据）。只读几个原子量与主线程自己的采样记录。
Delivery DeliveryState(long long nowMs) {
  if (!g_helper.mouseHookReady.load(std::memory_order_relaxed)) return Delivery::Unavailable;
  const bool consumed = ControlActive() || CursorWindowWanted();
  if (!consumed) return Delivery::Idle;
  const long long last = g_helper.lastHookCallbackAtMs.load(std::memory_order_relaxed);
  if (last > 0 && nowMs - last < kDeliveryFreshMs) return Delivery::Ok;
  // 独立观察：位置在最近的一个窗口里变过，而那一刻的钩子计数至今没变。
  const bool observedMovement = g_helper.lastPositionObservedAtMs > 0 &&
                                nowMs - g_helper.lastPositionObservedAtMs <= kDeliveryAnomalyMs;
  const bool seenFrozen = g_pointerSource.Seen() == g_helper.seenAtLastObservation;
  const bool buttonsDownNow = (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0 ||
                              (GetAsyncKeyState(VK_RBUTTON) & 0x8000) != 0 ||
                              (GetAsyncKeyState(VK_MBUTTON) & 0x8000) != 0;
  if (seenFrozen && (observedMovement || buttonsDownNow)) return Delivery::Anomalous;
  return Delivery::Quiet;
}

bool DeliveryDegraded(long long nowMs) { return DeliveryState(nowMs) == Delivery::Anomalous; }

const char* OwnerMode() {
  const bool control = ControlDecoration() && (g_helper.prefs.cursorHalo || g_helper.prefs.cursorCharacter);
  const bool companion = CompanionVisible();
  if (control && companion) return "both";
  if (control) return "control";
  if (companion) return "companion";
  return "none";
}

/* ---------------------------------------------------------- protocol json -- */

std::string CountsJson(const overlay::Counts& counts) {
  char buffer[384];
  snprintf(buffer, sizeof(buffer),
           "{\"monitorCount\":%d,\"displayWindowCount\":%d,\"cursorWindowCount\":%d,\"createdWindowCount\":%d,"
           "\"surfaceReadyWindowCount\":%d,\"visibleWindowCount\":%d,\"presentOkWindowCount\":%d,"
           "\"failedWindowCount\":%d}",
           counts.monitors, counts.displayWindows, counts.cursorWindows, counts.created, counts.surfaceReady,
           counts.visible, counts.presentOk, counts.failures);
  return buffer;
}

/// 逐窗健康：排障时"没有横幅"与"横幅窗口建失败"必须能分开看。
std::string WindowHealthJson() {
  std::string out = "[";
  bool first = true;
  auto append = [&](const overlay::WindowState& state, const char* kind, int monitorIndex, UINT dpi) {
    if (state.window == nullptr) return;
    char buffer[512];
    snprintf(buffer, sizeof(buffer),
             "%s{\"kind\":\"%s\",\"monitor\":%d,\"created\":%s,\"surfaceReady\":%s,\"presentOk\":%s,"
             "\"visible\":%s,\"captureAffinity\":%d,\"captureError\":%lu,\"width\":%d,\"height\":%d,\"dpi\":%lu}",
             first ? "" : ",", kind, monitorIndex, state.created ? "true" : "false",
             state.surfaceReady ? "true" : "false", state.presentOk ? "true" : "false",
             state.visible ? "true" : "false", state.captureAffinity,
             static_cast<unsigned long>(state.captureAffinityResult), state.widthPx, state.heightPx,
             static_cast<unsigned long>(dpi));
    out += buffer;
    first = false;
  };
  for (size_t i = 0; i < g_helper.registry.monitors.size(); i += 1) {
    const overlay::MonitorGroup& group = g_helper.registry.monitors[i];
    append(group.top, overlay::KindName(overlay::Kind::TopEdge), static_cast<int>(i), group.dpi);
    append(group.bottom, overlay::KindName(overlay::Kind::BottomEdge), static_cast<int>(i), group.dpi);
    append(group.left, overlay::KindName(overlay::Kind::LeftEdge), static_cast<int>(i), group.dpi);
    append(group.right, overlay::KindName(overlay::Kind::RightEdge), static_cast<int>(i), group.dpi);
    append(group.banner, overlay::KindName(overlay::Kind::Banner), static_cast<int>(i), group.dpi);
  }
  append(g_helper.registry.cursor, overlay::KindName(overlay::Kind::Cursor), -1, g_helper.cursorDpi);
  return out + "]";
}

std::string TopologyJson() {
  std::string out = "[";
  for (size_t i = 0; i < g_helper.registry.monitors.size(); i += 1) {
    const overlay::MonitorGroup& group = g_helper.registry.monitors[i];
    char buffer[360];
    snprintf(buffer, sizeof(buffer),
             "{\"device\":\"%s\",\"x\":%ld,\"y\":%ld,\"width\":%ld,\"height\":%ld,\"dpi\":%lu,\"primary\":%s,"
             "\"bandPx\":%d}",
             EscapeJson(Narrow(group.device)).c_str(), group.bounds.left, group.bounds.top,
             group.bounds.right - group.bounds.left, group.bounds.bottom - group.bounds.top,
             static_cast<unsigned long>(group.dpi), group.primary ? "true" : "false", group.edges.bandPx);
    out += buffer;
    if (i + 1 < g_helper.registry.monitors.size()) out += ",";
  }
  return out + "]";
}

const char* CharacterSurface() {
  const bool wanted = (ControlDecoration() && (g_helper.prefs.bannerCharacter || g_helper.prefs.cursorCharacter)) ||
                      CursorCharacterWanted();
  if (!wanted) return "disabled";
  return g_helper.assets.ok ? "ready" : "degraded";
}

const char* RenderModeName() {
  return g_helper.assets.mode == character::RenderMode::Layered ? "layered" : "composite";
}

const char* CursorSurface() {
  if (!CursorWindowWanted()) return "disabled";
  const overlay::WindowState& cursor = g_helper.registry.cursor;
  if (cursor.surfaceReady && cursor.presentOk) return "ready";
  return "degraded";
}

const char* PhaseName() {
  switch (g_helper.phase) {
    case Phase::Active: return "active";
    case Phase::Preparing: return "preparing";
    case Phase::Stopping: return "stopping";
    case Phase::Faulted: return "faulted";
    case Phase::Idle: break;
  }
  return "idle";
}

/// HRESULT 的可读形式（诊断里只用来分辨"画失败"还是"没画"）。
std::string HrText(long value) {
  char buffer[16];
  snprintf(buffer, sizeof(buffer), "0x%08lX", static_cast<unsigned long>(value));
  return buffer;
}

/// 顶部边条表面 (10, 10) 的 alpha：0 说明掩码没写进去。
int TopEdgeSampleAlpha() {
  if (g_helper.registry.monitors.empty()) return -1;
  const overlay::WindowState& top = g_helper.registry.monitors[0].top;
  if (top.pixels == nullptr || top.widthPx <= 10 || top.heightPx <= 10) return -1;
  const auto* pixels = static_cast<const uint32_t*>(top.pixels);
  return static_cast<int>((pixels[static_cast<size_t>(10) * top.widthPx + 10] >> 24) & 0xFF);
}

/// 横幅里吃饭角色用的片段（方案 4.5）：预热与绘制都按这个名字取。
constexpr const char* kBannerClip = "eat_loop";

/* --------------------------------------------------------------- pointer -- */

/**
 * 后台预热角色缓存（方案 五.1）。
 *
 * 缓存键是（片段 × 目标可见高度像素），所以只要高度没变就不用重新起线程；高度、DPI 或偏好
 * 变化会得到新 key，自动重建一轮。绘制线程不等它：预热没完成时照旧走同步 Prepare。
 */
void RequestCharacterPrewarm() {
  if (!g_helper.assets.ok || g_helper.prewarmDisabled) return;
  UINT bannerDpi = g_helper.cursorDpi;
  if (!g_helper.registry.monitors.empty()) bannerDpi = g_helper.registry.monitors[0].dpi;
  const int cursorHeightPx =
      std::max(1, static_cast<int>(std::lround(overlay::DipToPx(g_helper.prefs.cursorCharacterHeightDip, g_helper.cursorDpi))));
  const int bannerHeightPx = std::max(
      1, static_cast<int>(std::lround(overlay::DipToPx(g_helper.prefs.bannerCharacterHeightDip, bannerDpi))));
  const long long key = static_cast<long long>(cursorHeightPx) * 100000 + bannerHeightPx;
  if (!g_helper.prewarm.Running() && g_helper.prewarm.Completed() && g_helper.prewarm.Key() == key) return;
  std::vector<const character::Clip*> cursorClips;
  for (const char* name : {"idle", "press_in", "release", "move", "pressed_hold", "drag"}) {
    if (const character::Clip* clip = g_helper.assets.Find(name)) cursorClips.push_back(clip);
  }
  std::vector<const character::Clip*> bannerClips;
  if (const character::Clip* clip = g_helper.assets.Find(kBannerClip)) bannerClips.push_back(clip);
  g_helper.prewarm.Request(g_helper.cache, g_helper.assets, cursorClips, bannerClips, cursorHeightPx, bannerHeightPx);
}

/// 用系统当前按键状态校正（方案 二·问题 B）。只看 GetAsyncKeyState 的最高位：
/// 低位表示"这一轮输入以来按过"，不是当前状态，不能当作可靠证据。
bool ResyncButtonsFromSystem(long long nowMs, const char* reason) {
  POINT pointer{0, 0};
  if (!GetCursorPos(&pointer)) pointer = g_helper.pointer.lastPointer;
  // 左右键交换：钩子收到的是**逻辑**按钮（WM_LBUTTONDOWN 跟着系统设置走），
  // 而 GetAsyncKeyState(VK_LBUTTON) 跟着**物理**按钮走。不换算的话，左手用户在按住时会
  // 每秒被"校正"出一次假抬起。
  const bool swapped = GetSystemMetrics(SM_SWAPBUTTON) != 0;
  const bool physicalLeft = (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0;
  const bool physicalRight = (GetAsyncKeyState(VK_RBUTTON) & 0x8000) != 0;
  const bool left = swapped ? physicalRight : physicalLeft;
  const bool right = swapped ? physicalLeft : physicalRight;
  const bool middle = (GetAsyncKeyState(VK_MBUTTON) & 0x8000) != 0;
  const bool x1 = (GetAsyncKeyState(VK_XBUTTON1) & 0x8000) != 0;
  const bool x2 = (GetAsyncKeyState(VK_XBUTTON2) & 0x8000) != 0;
  if (!g_pointerController.ResyncExtended(nowMs, pointer, left, right, middle, x1, x2)) return false;
  g_helper.cursorDirty = true;
  g_helper.pointerResyncs += 1;
  g_helper.lastResyncReason = reason;
  return true;
}

/// 把队列里的按钮边沿按顺序交给状态机。这是**主路径**：同一批里收到 down+up 也会产生一次点击。
void DrainPointerEvents(long long nowMs) {
  pointer::Event event;
  int applied = 0;
  while (g_pointerSource.Pop(event)) {
    if (event.kind == pointer::Kind::Down && g_helper.pendingPressAtMs < 0) g_helper.pendingPressAtMs = event.atMs;
    g_pointerController.Apply(event);
    applied += 1;
  }
  // 队列满期间被合并掉的移动：补一条最终位置。比已施加事件更旧的不要（否则位置会倒退）。
  pointer::Event merged;
  if (g_pointerSource.TakeCoalescedMove(merged) && merged.atMs >= g_pointerController.LastEventAtMs()) {
    g_pointerController.Apply(merged);
    applied += 1;
  }
  if (applied > 0) g_helper.pointerEventsApplied += applied;
  const bool overflow = g_pointerSource.TakeResyncRequest();
  if (overflow || !g_helper.mouseHookReady.load()) {
    // 边沿被丢或鼠标钩子没装上：按真实按键集合校正，避免角色永久按住。
    ResyncButtonsFromSystem(nowMs, overflow ? "queue_overflow" : "mouse_hook_not_ready");
  }
}

/// 有界重装：只在"投递异常、身份允许、且退避到了"时才请求钩子线程重装一次。
/// 确认是完整性不匹配（Low 及以下）时**不重装**，直接让 doctor 去说部署问题（阶段 2 第 3 条）。
void MaybeReinstallHook(long long nowMs) {
  if (!DeliveryDegraded(nowMs)) return;
  if (!IdentityCanObserveInput(g_identity)) return;
  if (g_helper.lastDeliveryAnomalyAtMs < 0) g_helper.lastDeliveryAnomalyAtMs = nowMs;
  const long long backoff =
      kReinstallBackoffMs[std::min<int>(static_cast<int>(g_helper.hookReinstalls), kReinstallBackoffCount - 1)];
  if (nowMs - g_helper.lastHookReinstallAtMs < backoff) return;
  if (g_hookThreadId == 0) return;
  if (PostThreadMessageW(g_hookThreadId, kReinstallMouseHookMessage, 0, 0)) {
    g_helper.hookReinstalls += 1;
    g_helper.lastHookReinstallAtMs = nowMs;
  }
}

/**
 * 指针状态只保留"位置、按钮集合、运动时间"，不收集窗口文字、不持久化轨迹、不注入输入。
 *
 * 三条通道，优先级从高到低：钩子事件队列（主路径）→ 位置兜底（`GetCursorPos`）→
 * 按钮采样（`GetAsyncKeyState`）。采样间隔是待测参数：健康时 1 s 一次一致性检查，
 * 判定投递异常时降到 `kDegradedSampleMs`。**采样永远不能保证抓住比采样周期还短的点击**，
 * 它只保证"钩子收不到时不至于完全没有按钮状态"，并且把手势标成 sampled。
 */
void SamplePointer(long long nowMs) {
  // 方案 五.3：位置采样也限到 125 Hz。以前每次唤醒都 GetCursorPos，1000 Hz 鼠标就是一秒一千次；
  // 事件队列里已经有位置时没必要再问系统。
  if (nowMs - g_helper.lastPositionAtMs >= kPositionIntervalMs) {
    POINT pointer{0, 0};
    if (GetCursorPos(&pointer)) {
      // 独立观察：位置变了而钩子计数没动，就是"投递异常"的证据（阶段 2 第 2 条）。
      const bool moved = !g_helper.pointer.hasPointer || g_helper.pointer.lastPointer.x != pointer.x ||
                         g_helper.pointer.lastPointer.y != pointer.y;
      if (moved) {
        g_helper.lastPositionObservedAtMs = nowMs;
        g_helper.seenAtLastObservation = g_pointerSource.Seen();
      }
      g_pointerController.UpdatePosition(nowMs, pointer.x, pointer.y);
    }
  }
  const Delivery delivery = DeliveryState(nowMs);
  const bool degraded = delivery == Delivery::Anomalous;
  // 拖拽阈值按 DIP：96 DPI 下 6 px，高 DPI 下按比例放大。
  g_helper.pointer.dragDistancePx =
      std::max(4, static_cast<int>(std::lround(6.0 * static_cast<double>(g_helper.cursorDpi) / 96.0)));
  if (!g_helper.mouseHookReady.load()) {
    // 钩子没装上：低频校正，避免角色永久按住。
    if (nowMs - g_helper.lastResyncAtMs >= kHealthyConfirmMs) {
      g_helper.lastResyncAtMs = nowMs;
      ResyncButtonsFromSystem(nowMs, "mouse_hook_not_ready");
    }
    return;
  }
  const long long interval = degraded ? kDegradedSampleMs : kHealthyConfirmMs;
  if (nowMs - g_helper.lastResyncAtMs >= interval) {
    g_helper.lastResyncAtMs = nowMs;
    if (degraded) {
      g_helper.lastDegradedSampleAtMs = nowMs;
      if (ResyncButtonsFromSystem(nowMs, "degraded_sample")) g_helper.sampledResyncs += 1;
      MaybeReinstallHook(nowMs);
    } else if (ResyncButtonsFromSystem(nowMs, "periodic")) {
      g_helper.sampledResyncs += 1;
    }
  }
  // 投递恢复正常：退避与异常起点一起清掉，别让下一次偶发安静继承旧退避。
  if (delivery == Delivery::Ok || delivery == Delivery::Quiet) {
    g_helper.lastDeliveryAnomalyAtMs = -1;
    if (g_helper.hookReinstalls > 0 && nowMs - g_helper.lastHookReinstallAtMs > 5000) g_helper.hookReinstalls = 0;
  }
}

/**
 * 键盘活动聚合（阶段 2 第 8 条）：只记"有输入活动"的计数与时间，**不**保存键值、字符、
 * 密码或窗口文字。Esc 仍走自己的独立停止逻辑，不在这里处理。
 */
void PumpTypingActivity(long long nowMs) {
  const long long last = g_helper.lastKeyActivityAtMs.load(std::memory_order_relaxed);
  const bool active = last > 0 && nowMs - last < kTypingIdleMs;
  if (active && !g_helper.typingActive) {
    g_helper.typingActive = true;
    g_helper.typingLastAtMs = nowMs;
    if (CursorCharacterWanted()) {
      g_pointerController.ExternalFeedback(nowMs, "type", "typing", "keyboard", animation::kTypingFeedbackMs);
      g_helper.cursorDirty = true;
    }
  } else if (active && g_helper.typingActive) {
    // 仍在输入：只在超过合并窗口时续期一次，避免每秒几十次续期抖动。
    if (nowMs - g_helper.typingLastAtMs >= animation::kFeedbackMergeMs) {
      g_helper.typingLastAtMs = nowMs;
      if (CursorCharacterWanted()) {
        g_pointerController.ExternalFeedback(nowMs, "type", "typing", "keyboard", animation::kTypingFeedbackMs);
        g_helper.cursorDirty = true;
      }
    }
  } else if (!active && g_helper.typingActive) {
    g_helper.typingActive = false;
    g_pointerController.EndExternal(nowMs, "typing_stopped");
    g_helper.cursorDirty = true;
  }
}

/* ------------------------------------------------------------------ clock -- */


/// 光标姿势：状态变了才重置一次性片段的时钟；循环片段共用相位起点（方案 5.2）。
void UpdateCursorPose(long long nowMs) {
  const animation::StopPhase phase =
      IsStoppingOrFaulted(g_helper.phase) ? animation::StopPhase::Stopped : animation::StopPhase::Running;
  const char* state = animation::StateFor(g_helper.pointer, nowMs, phase);
  // 阶段 3 第 4 条：新反馈即使片段名相同（连点都叫 release）也必须重新起算。
  // 以前只在 clip 名变化时重置进入时间，第二次点击会从第 7 帧开始，等于没播。
  const long long feedbackIdNow = g_helper.pointer.feedback.id;
  const bool feedbackIsNew = feedbackIdNow != 0 && feedbackIdNow != g_helper.cursorFeedbackId;
  if (g_helper.cursorClip != state || feedbackIsNew) {
    const std::string previous = g_helper.cursorClip;
    g_helper.cursorClip = state;
    g_helper.cursorFeedbackId = feedbackIdNow;
    character::Clip* clip = g_helper.assets.Find(state);
    const bool loop = clip != nullptr ? clip->loop : true;
    // 方案 三·问题 F：循环片段不再共用进程相位。进入帧从 transitions 表里取（没有表就是 0），
    // 一次性片段（press_in / release）永远从 0 开始，不能被表跳掉开头。
    int entryFrame = 0;
    int fadeMs = 0;
    if (const character::Transition* transition = g_helper.assets.FindTransition(previous, state)) {
      entryFrame = loop ? transition->entryFrame : 0;
      fadeMs = loop ? transition->fadeMs : 0;
    }
    g_helper.cursorEntryFrame = entryFrame;
    g_helper.cursorEnteredAtMs = nowMs - animation::EntryStartMs(clip != nullptr ? clip->durationsMs : std::vector<int>(),
                                                               entryFrame);
    g_helper.cursorFadeStartMs = nowMs;
    g_helper.cursorFadeMs = (g_helper.prefs.reducedMotion || fadeMs <= 0) ? 0 : fadeMs;
    g_helper.cursorLastFadeMs = g_helper.cursorFadeMs;
    g_helper.motion.OnStateChanged(state, g_helper.prefs.reducedMotion);
    // 方案 4.D：换姿势只表示**内容**变脏，不能顺手把窗口布局也标脏 ——
    // 那会让 EnsureCursorWindow 销毁重建 HWND 与 DIB，旧画面先消失、新窗口等 Present，正是闪动来源。
    g_helper.cursorDirty = true;
    // 只有**没有反馈对象**的旧口径才用"开播时刻"兜 release 窗口。有反馈对象时窗口由
    // `presentedAtMs` 起算，事件时间不再参与可见性判定（阶段 3 第 3 条）。
    if (g_helper.cursorClip == "release" && !g_helper.prefs.reducedMotion && g_helper.pointer.feedback.id == 0) {
      g_helper.pointer.releasedAtMs = nowMs;
    }
  }
  const character::Clip* clip = g_helper.assets.Find(g_helper.cursorClip);
  if (clip == nullptr) {
    g_helper.cursorFrameDueMs = -1;
    return;
  }
  if (g_helper.prefs.reducedMotion) {
    // 减少动画：冻结所有二级动作与换帧，但位置跟随与按压明暗反馈保留。
    g_helper.cursorFrame = 0;
    g_helper.cursorFrameDueMs = -1;
    return;
  }
  const long long elapsed = nowMs - g_helper.cursorEnteredAtMs;
  // 短按的 release 按倍率加速（方案 二·问题 A 第 6 条）：片段时长不变，播放速度变快。
  const float rate = (g_helper.cursorClip == "release" && g_helper.pointer.feedbackRate > 0.1f)
                         ? g_helper.pointer.feedbackRate
                         : 1.0f;
  const long long clipElapsed =
      static_cast<long long>(std::llround(static_cast<double>(elapsed) * static_cast<double>(rate)));
  const int frame = render::FrameOf(*clip, clipElapsed);
  if (frame != g_helper.cursorFrame) {
    g_helper.cursorFrame = frame;
    g_helper.cursorDirty = true;
  }
  const long long deadline =
      animation::NextFrameDeadlineMs(clip->frameCount, clip->durationsMs, clip->totalMs, clip->loop, clipElapsed);
  long long due = deadline < 0 ? -1
                               : g_helper.cursorEnteredAtMs +
                                     static_cast<long long>(std::llround(static_cast<double>(deadline) /
                                                                        static_cast<double>(rate)));
  // 分层资源的活动部件是**连续运动**的：只有"换帧"日期的话，单帧片段（hold）就再也不刷新，
  // 尾巴会僵住。这里给分层模式加一条不超过 30 Hz 的刷新期限。
  if (g_helper.assets.mode == character::RenderMode::Layered && !g_helper.assets.parts.empty()) {
    const long long partDue = nowMs + kCursorPoseIntervalMs;
    due = due < 0 ? partDue : std::min(due, partDue);
  }
  g_helper.cursorFrameDueMs = due;
}

void UpdateBannerPose(long long nowMs) {
  const character::Clip* clip = g_helper.assets.Find(kBannerClip);
  if (clip == nullptr || !g_helper.prefs.bannerCharacter || !g_helper.prefs.decoration) {
    g_helper.bannerFrameDueMs = -1;
    return;
  }
  if (g_helper.prefs.reducedMotion) {
    g_helper.bannerFrame = 0;
    g_helper.bannerFrameDueMs = -1;
    return;
  }
  const long long elapsed = nowMs - g_helper.loopPhaseOriginMs;
  const int frame = render::FrameOf(*clip, elapsed);
  if (frame != g_helper.bannerFrame) g_helper.bannerDirty = true;
  g_helper.bannerFrame = frame;
  const long long deadline =
      animation::NextFrameDeadlineMs(clip->frameCount, clip->durationsMs, clip->totalMs, clip->loop, elapsed);
  long long due = deadline < 0 ? -1 : g_helper.loopPhaseOriginMs + deadline;
  // 同上：分层部件连续运动，横幅也要按部件刷新期限重画（≤20 Hz）。
  if (g_helper.assets.mode == character::RenderMode::Layered && !g_helper.assets.parts.empty()) {
    const long long partDue = nowMs + kBannerIntervalMs;
    due = due < 0 ? partDue : std::min(due, partDue);
  }
  g_helper.bannerFrameDueMs = due;
}

overlay::BannerLayout CurrentBannerLayout(const overlay::MonitorGroup& group) {
  overlay::BannerOptions options;
  options.characterHeightDip = g_helper.prefs.bannerCharacterHeightDip;
  options.wantCharacter = g_helper.prefs.bannerCharacter && g_helper.prefs.decoration;
  const character::Clip* clip = g_helper.assets.Find(kBannerClip);
  if (clip != nullptr && clip->boundsMeasured && clip->contentHeight > 0) {
    options.characterAspect = static_cast<float>(clip->contentWidth) / static_cast<float>(clip->contentHeight);
  }
  return overlay::ComputeBannerLayout(group.bounds, group.dpi, options);
}

/* ---------------------------------------------------------------- drawing -- */

void DrawEdges(overlay::MonitorGroup& group, long long nowMs) {
  const render::Scene scene =
      render::MakeScene(nowMs, g_helper.prefs, group.dpi, IsStoppingOrFaulted(g_helper.phase));
  // 装饰关闭时仍是**静态**四边（方案 6.2：enabled=false 只熄装饰）。亮度统一由 render 那边给，
  // 不再在这里散落魔法数（用户实机反馈"要再亮一点"后上调，见 render::EdgePeakAlpha）。
  const float peak = render::EdgePeakAlpha(g_helper.prefs, scene.phase);
  overlay::WindowState* windows[4] = {&group.top, &group.bottom, &group.left, &group.right};
  for (overlay::WindowState* state : windows) {
    if (state->pixels == nullptr) continue;
    render::FillEdge(*state, group, scene, peak);
    overlay::Present(*state, state->rect);
    if (!state->visible) overlay::ShowWindowNoActivate(*state);
  }
}

void DrawBanner(overlay::MonitorGroup& group, long long nowMs) {
  overlay::WindowState& window = group.banner;
  if (window.pixels == nullptr) return;
  const overlay::BannerLayout layout = CurrentBannerLayout(group);
  const render::Scene scene =
      render::MakeScene(nowMs, g_helper.prefs, group.dpi, IsStoppingOrFaulted(g_helper.phase));
  render::Pose pose;
  pose.clip = kBannerClip;
  pose.frame = g_helper.bannerFrame;
  const bool drewCharacter = g_helper.prefs.bannerCharacter && g_helper.prefs.decoration &&
                             !IsStoppingOrFaulted(g_helper.phase);
  render::DrawBanner(window, group, layout, g_helper.prefs, scene, g_helper.assets, g_helper.cache, pose,
                     g_helper.bannerError);
  overlay::Present(window, window.rect);
  if (!window.visible) overlay::ShowWindowNoActivate(window);
  if (drewCharacter) g_helper.characterDraws.fetch_add(1);
}

/// 光标布局：象限、窗口边长、锚点。成功时写 `changed`，失败返回 false。
bool RefreshCursorLayout(const POINT& pointer, RECT& monitorRect, UINT& dpi, bool& changed) {
  changed = false;
  // 方案 五.3：同屏移动复用显示器信息。以前每次唤醒都 MonitorFromPoint + 查注册表，
  // 1000 Hz 鼠标就是每秒一千次；现在只在该点离开缓存矩形（或拓扑变了）时才重新查询。
  const bool insideCached = g_helper.cursorMonitorValid && pointer.x >= g_helper.cursorMonitorRect.left &&
                            pointer.x < g_helper.cursorMonitorRect.right && pointer.y >= g_helper.cursorMonitorRect.top &&
                            pointer.y < g_helper.cursorMonitorRect.bottom;
  if (insideCached) {
    monitorRect = g_helper.cursorMonitorRect;
    dpi = g_helper.cursorMonitorDpi;
  } else {
    const HMONITOR monitor = MonitorFromPoint(pointer, MONITOR_DEFAULTTONULL);
    if (monitor == nullptr) return false;
    g_helper.monitorQueries += 1;
    monitorRect = RECT{0, 0, 0, 0};
    dpi = 96;
    for (const overlay::MonitorGroup& group : g_helper.registry.monitors) {
      if (group.handle == monitor) {
        monitorRect = group.bounds;
        dpi = group.dpi;
        break;
      }
    }
    if (monitorRect.right <= monitorRect.left) {
      MONITORINFO info{};
      info.cbSize = sizeof(info);
      if (!GetMonitorInfoW(monitor, &info)) return false;
      monitorRect = info.rcMonitor;
      UINT dpiX = 96;
      UINT dpiY = 96;
      if (SUCCEEDED(GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &dpiX, &dpiY))) dpi = dpiX;
    }
    g_helper.cursorMonitorRect = monitorRect;
    g_helper.cursorMonitorDpi = dpi;
    g_helper.cursorMonitorValid = true;
  }
  const bool withCharacter = CursorCharacterWanted();
  // 布局只在"输入变了"时才重算：显示器、DPI、角色开关、高度、方位。
  const overlay::Quadrant cachedQuadrant =
      g_helper.cursorHasLayout ? g_helper.cursorLayout.quadrant : overlay::Quadrant::BottomRight;
  if (g_helper.cursorHasLayout && !g_helper.cursorLayoutDirty && dpi == g_helper.cursorDpi &&
      withCharacter == g_helper.cursorLayout.withCharacter) {
    // 象限可能因为靠近屏幕边缘而变，这个判断很便宜，仍然要做。
    const overlay::Quadrant quadrant =
        overlay::ChooseQuadrant(pointer, monitorRect, g_helper.cursorLayout.extentPx, cachedQuadrant);
    if (quadrant == cachedQuadrant) {
      monitorRect = g_helper.cursorMonitorRect;
      dpi = g_helper.cursorMonitorDpi;
      return true;
    }
  }
  g_helper.layoutRefreshes += 1;
  float aspect = 0.78f;
  const character::Clip* idle = g_helper.assets.Find("idle");
  if (idle != nullptr && idle->boundsMeasured && idle->contentHeight > 0) {
    aspect = static_cast<float>(idle->contentWidth) / static_cast<float>(idle->contentHeight);
  }
  const overlay::Quadrant previous = cachedQuadrant;
  const overlay::CursorLayout layout = overlay::ComputeCursorLayout(
      dpi, g_helper.prefs.cursorCharacterHeightDip, aspect, withCharacter, previous, pointer, monitorRect);
  changed = !g_helper.cursorHasLayout || g_helper.cursorDpi != dpi ||
            g_helper.cursorLayout.sizePx != layout.sizePx ||
            g_helper.cursorLayout.withCharacter != withCharacter ||
            g_helper.cursorLayout.quadrant != layout.quadrant;
  g_helper.cursorLayout = layout;
  g_helper.cursorDpi = dpi;
  g_helper.cursorHasLayout = true;
  return true;
}

/// 建 / 重建光标窗口（整个系统一个）。
bool EnsureCursorWindow(const POINT& pointer) {
  RECT monitorRect{};
  UINT dpi = 96;
  bool changed = false;
  if (!RefreshCursorLayout(pointer, monitorRect, dpi, changed)) {
    overlay::HideWindow(g_helper.registry.cursor);
    return false;
  }
  overlay::WindowState& cursor = g_helper.registry.cursor;
  const bool needsWindow = cursor.window == nullptr || g_helper.cursorLayoutDirty ||
                           cursor.widthPx != g_helper.cursorLayout.sizePx;
  if (!needsWindow) return true;
  overlay::DestroyWindowState(cursor);
  const overlay::CursorLayout& layout = g_helper.cursorLayout;
  cursor.kind = overlay::Kind::Cursor;
  cursor.rect = RECT{pointer.x - layout.extentPx, pointer.y - layout.extentPx, pointer.x + layout.extentPx,
                     pointer.y + layout.extentPx};
  if (!overlay::CreateWindowFor(cursor, L"DSH cursor companion", g_excludeFromCapture)) {
    g_helper.cursorError = "the cursor window could not be created";
    return false;
  }
  if (!overlay::CreateSurface(cursor, dpi, false)) {
    g_helper.cursorError = "the cursor surface could not be created";
    return false;
  }
  g_helper.cursorLayoutDirty = false;
  g_helper.cursorDirty = true;
  overlay::ShowWindowNoActivate(cursor);
  g_helper.cursorWindowCreates += 1;
  g_helper.cursorSurfaceRebuilds += 1;
  g_helper.layoutEpoch += 1;
  g_helper.registry.layoutEpoch = g_helper.layoutEpoch;
  return true;
}

void PositionCursorWindow(const POINT& pointer) {
  overlay::WindowState& cursor = g_helper.registry.cursor;
  if (cursor.window == nullptr) return;
  const int extent = g_helper.cursorLayout.extentPx;
  const RECT next{pointer.x - extent, pointer.y - extent, pointer.x + extent, pointer.y + extent};
  if (next.left == cursor.rect.left && next.top == cursor.rect.top) return;
  cursor.rect = next;
  SetWindowPos(cursor.window, HWND_TOPMOST, cursor.rect.left, cursor.rect.top, cursor.widthPx, cursor.heightPx,
               SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOSIZE | SWP_SHOWWINDOW);
  cursor.visible = true;
}

void DrawCursorPixels(long long nowMs) {
  overlay::WindowState& cursor = g_helper.registry.cursor;
  if (cursor.pixels == nullptr || !g_helper.cursorHasLayout) return;
  // 方案 五.2：先算"这一帧的像素由什么决定"。key 没变就直接返回——位置由 PositionCursorWindow 单独移动，
  // 不再重新合成、也不再 Present。部件幅度 96 px 时只有 0.29/0.14 px，四舍五入后大多恒为零。
  const bool haloWantedNow = CursorHaloWanted();
  const bool characterWantedNow = CursorCharacterWanted();
  const bool stoppingNow = IsStoppingOrFaulted(g_helper.phase);
  const int fadeMsNow = g_helper.cursorFadeMs;
  const long long fadeElapsedNow = nowMs - g_helper.cursorFadeStartMs;
  const int fadeStep = (fadeMsNow > 0 && fadeElapsedNow < fadeMsNow)
                          ? static_cast<int>(16.0 * static_cast<double>(fadeElapsedNow) / static_cast<double>(fadeMsNow))
                          : -1;
  render::Pose keyPose;
  keyPose.clip = g_helper.cursorClip;
  keyPose.frame = g_helper.cursorFrame;
  const unsigned long long renderKey =
      render::CursorRenderKey(keyPose, g_helper.prefs, g_helper.cursorLayout, g_helper.assets, g_helper.cursorDpi,
                              g_helper.pointer.pressed, haloWantedNow, characterWantedNow, stoppingNow, fadeStep,
                              nowMs, cursor.window);
  if (!g_helper.renderKeyDisabled && g_helper.cursorLastComplete && renderKey == g_helper.cursorLastKey &&
      // 有一条"待呈现"的反馈时不许跳过合成：像素键相同（连点仍停在首帧）也算它没显示过，
      // 否则新 id 会被 `renderKey` 去重掉，表现为"点了没反应"。
      !(g_helper.pointer.feedback.id > 0 && g_helper.pointer.feedback.presentedAtMs < 0)) {
    g_helper.cursorPixelSkips += 1;
    g_helper.cursorDirty = false;
    return;
  }
  g_helper.renderPasses.fetch_add(1);
  // 方案 三·问题 F：同一缓冲区内的短混合。先把**上一帧**留下来，再画新的一帧，最后按时间权重
  // 混合两者。两个画面在同一个 DIB 里，所以不会出现"两个窗口互相渐隐把总不透明度掉成一半"。
  const size_t pixelCount = static_cast<size_t>(cursor.widthPx) * static_cast<size_t>(cursor.heightPx);
  const int fadeMs = g_helper.cursorFadeMs;
  const long long fadeElapsed = nowMs - g_helper.cursorFadeStartMs;
  const bool blending = fadeMs > 0 && fadeElapsed < fadeMs && pixelCount > 0;
  if (blending) {
    if (g_helper.cursorFadePrev.size() != pixelCount || g_helper.cursorFadePrevWidth != cursor.widthPx ||
        g_helper.cursorFadePrevHeight != cursor.heightPx || g_helper.cursorFadePrevWindow != cursor.window) {
      g_helper.cursorFadePrev.assign(pixelCount, 0u);
      g_helper.cursorFadePrevWidth = cursor.widthPx;
      g_helper.cursorFadePrevHeight = cursor.heightPx;
      g_helper.cursorFadePrevWindow = cursor.window;
    }
    std::memcpy(g_helper.cursorFadePrev.data(), cursor.pixels, pixelCount * sizeof(uint32_t));
  } else if (fadeMs > 0 && fadeElapsed >= fadeMs) {
    g_helper.cursorFadeMs = 0;  // 窗口结束：下一帧起不再复制上一帧
  }
  const render::Scene scene =
      render::MakeScene(nowMs, g_helper.prefs, g_helper.cursorDpi, IsStoppingOrFaulted(g_helper.phase));
  render::Pose pose;
  pose.clip = g_helper.cursorClip;
  pose.frame = g_helper.cursorFrame;
  const bool haloWanted = CursorHaloWanted();
  const bool characterWanted = CursorCharacterWanted();
  const long long composeStartUs = NowUs();
  const bool complete = render::DrawCursor(cursor, g_helper.cursorLayout, g_helper.prefs, scene,
                                           g_helper.pointer.pressed, haloWanted, characterWanted, g_helper.assets,
                                           g_helper.cache, pose, g_helper.cursorDpi, g_helper.cursorError,
                                           !g_helper.haloCacheDisabled);
  {
    const long long composeUs = NowUs() - composeStartUs;
    g_helper.cursorComposeUs += composeUs;
    g_helper.cursorComposeCount += 1;
    if (composeUs > g_helper.cursorComposeMaxUs) g_helper.cursorComposeMaxUs = composeUs;
    g_helper.composeRecent[g_helper.composeRecentIndex] = composeUs;
    g_helper.composeRecentIndex = (g_helper.composeRecentIndex + 1) % 10;
    if (g_helper.composeRecentCount < 10) g_helper.composeRecentCount += 1;
  }
  // 方案 4.G：两阶段提交。角色画失败、而这一帧又没有光晕兜底时，**不提交**——
  // 否则就是把"清空后的空表面"推上去，用户看到角色整块消失或只剩半边，比保留上一帧更糟。
  if (!complete && !haloWanted) {
    g_helper.cursorDirty = true;  // 下一轮再试，别把失败当成已完成
    g_helper.cursorLastComplete = false;
    return;
  }
  if (blending) {
    // 预乘 alpha 的线性插值：out = prev×(1−t) + cur×t，alpha 与颜色一起插值才是正确的交叉淡化。
    auto* current = static_cast<uint32_t*>(cursor.pixels);
    const uint32_t* previous = g_helper.cursorFadePrev.data();
    const float t = std::min(1.0f, static_cast<float>(fadeElapsed) / static_cast<float>(fadeMs));
    const uint32_t weightCurrent = static_cast<uint32_t>(std::lround(t * 65536.0f));
    const uint32_t weightPrevious = 65536u - weightCurrent;
    for (size_t index = 0; index < pixelCount; index += 1) {
      const uint32_t a = previous[index];
      const uint32_t b = current[index];
      auto mix = [&](int shift) -> uint32_t {
        const uint32_t ca = (a >> shift) & 0xFFu;
        const uint32_t cb = (b >> shift) & 0xFFu;
        return ((ca * weightPrevious + cb * weightCurrent) >> 16) & 0xFFu;
      };
      current[index] = (mix(24) << 24) | (mix(16) << 16) | (mix(8) << 8) | mix(0);
    }
  }
  const bool presented = overlay::Present(cursor, cursor.rect);
  if (presented) {
    g_helper.cursorPresents += 1;
    // 阶段 3 第 3/8 条：反馈的可见窗口从**首帧成功 Present** 起算，也只有它才配算"已呈现"。
    // 以前 StateFor 一旦选中 release 就算成功，墙钟过去就把这次点击吞掉了。
    if (g_helper.pointer.feedback.id > 0 && g_helper.cursorClip == g_helper.pointer.feedback.clip &&
        g_pointerController.MarkPresented(NowMs())) {
      g_helper.feedbackPresented += 1;
      if (g_helper.pointer.feedback.eventAtMs >= 0) {
        g_helper.feedbackPresentToComposeMs = NowMs() - g_helper.pointer.feedback.eventAtMs;
      }
    }
  }
  g_helper.cursorLastKey = renderKey;
  g_helper.cursorLastComplete = true;
  if (g_helper.pendingPressAtMs >= 0) {
    // 用 Present 之后的**新**时钟：循环开头的 now 早于解码，会把解码时间算漏。
    g_helper.lastPressToPresentMs = NowMs() - g_helper.pendingPressAtMs;
    g_helper.pendingPressAtMs = -1;
  }
  if (characterWanted) g_helper.characterDraws.fetch_add(1);
  g_helper.frames.fetch_add(1);
}

/* ------------------------------------------------------------- layout pass -- */

/// 重建四边与横幅并画一帧；返回基础提示是否全部就绪。
bool RebuildDisplayOverlays(long long nowMs) {
  overlay::BannerOptions options;
  options.characterHeightDip = g_helper.prefs.bannerCharacterHeightDip;
  options.wantCharacter = g_helper.prefs.bannerCharacter && g_helper.prefs.decoration;
  const character::Clip* clip = g_helper.assets.Find(kBannerClip);
  if (clip != nullptr && clip->boundsMeasured && clip->contentHeight > 0) {
    options.characterAspect = static_cast<float>(clip->contentWidth) / static_cast<float>(clip->contentHeight);
  }
  g_helper.registry.Rebuild(g_excludeFromCapture, options);
  g_helper.layoutEpoch = g_helper.registry.layoutEpoch;
  for (overlay::MonitorGroup& group : g_helper.registry.monitors) {
    DrawEdges(group, nowMs);
    DrawBanner(group, nowMs);
  }
  return g_helper.registry.BaseOverlaysHealthy();
}

void DestroyDisplayOverlays() {
  for (overlay::MonitorGroup& group : g_helper.registry.monitors) {
    overlay::DestroyWindowState(group.top);
    overlay::DestroyWindowState(group.bottom);
    overlay::DestroyWindowState(group.left);
    overlay::DestroyWindowState(group.right);
    overlay::DestroyWindowState(group.banner);
  }
  g_helper.registry.monitors.clear();
  g_helper.edgeDueMs = -1;
  g_helper.bannerDueMs = -1;
}

/// 一次系统变化可能通知多个窗口：这里只做一次重建（方案 3.3）。
void HandleTopologyChange() {
  const long long now = NowMs();
  if (!ControlActive()) {
    // 没有控制 scope：没有显示层要重建；把光标布局标脏，下次显示时按新 DPI 重算。
    g_helper.cursorLayoutDirty = true;
    return;
  }
  RebuildDisplayOverlays(now);
  if (CursorWindowWanted()) g_helper.cursorLayoutDirty = true;
  EmitLine(Message("topologyChanged")
               .Num("layoutEpoch", static_cast<double>(g_helper.layoutEpoch))
               .Num("monitorCount", static_cast<double>(g_helper.registry.monitors.size()))
               .Raw("counts", CountsJson(g_helper.registry.Statistics()))
               .Raw("topology", TopologyJson())
               .Done());
}

/* --------------------------------------------------------------- commands -- */

void EmitError(const std::string& requestId, const std::string& code, const std::string& reason) {
  EmitLine(Message("error").Str("requestId", requestId).Str("code", code).Str("reason", reason).Done());
}

/// 真实 exe 路径（UTF-8）。定义在 identity 一节，这里先声明给 `ready` 用。
std::string ExePathText();

void EmitReady(const std::string& requestId) {
  EmitLine(Message("ready")
               .Str("requestId", requestId)
               .Num("protocolVersion", kProtocolVersion)
               .Str("buildVersion", kBuildVersion)
               .Num("pid", GetCurrentProcessId())
               .Str("renderBackend", g_helper.backend)
               .Bool("visualReady", g_helper.visualReady)
               // 阶段 1 / 附带验收：停止通道自己的就绪状态。鼠标钩子装上了**不能**证明 Esc 能用。
               .Bool("escapeReady", g_helper.keyboardHookReady.load())
               .Bool("keyboardHookReady", g_helper.keyboardHookReady.load())
               .Bool("mouseHookReady", g_helper.mouseHookReady.load())
               .Str("deliveryState", DeliveryName(DeliveryState(NowMs())))
               // 能力位（阶段 4 第 1 条）：旧宿主不认识这些字段就按 v2 行为用，新宿主据此决定发不发活动消息。
               .Raw("capabilities",
                    std::string("{\"protocol\":") + std::to_string(kProtocolVersion) +
                        ",\"visualActivity\":true,\"wheel\":true,\"sideButtons\":true,\"typing\":true,"
                        "\"feedbackIds\":true,\"presentConfirmed\":true,\"deliveryState\":true,\"identity\":true}")
               .Str("exePath", ExePathText())
               .Num("integrityRid", static_cast<double>(g_identity.integrityRid))
               .Str("integrityName", IntegrityName(g_identity.integrityRid))
               .Bool("uiAccess", g_identity.uiAccess)
               .Num("sessionId", static_cast<double>(g_identity.sessionId))
               .Bool("identityCanObserveInput", IdentityCanObserveInput(g_identity))
               .Num("layoutEpoch", static_cast<double>(g_helper.layoutEpoch))
               .Raw("counts", CountsJson(g_helper.registry.Statistics()))
               .Raw("windows", WindowHealthJson())
               .Raw("topology", TopologyJson())
               .Bool("characterLoaded", g_helper.assets.ok)
               .Str("characterAssetVersion", g_helper.assets.assetVersion)
               .Str("renderMode", RenderModeName())
               .Bool("companionEnabled", g_helper.companion.enabled)
               .Done());
}

/// 诊断：进入帧表里所有 fadeMs 的和。解析失败会明显偏低，便于和 transitions.json 对账。
long TransitionFadeSum() {
  long sum = 0;
  for (const character::Transition& transition : g_helper.assets.transitions) sum += transition.fadeMs;
  return sum;
}

/// 钩子"沉默"了多久（毫秒）：没装钩子、或还没到检查窗口时返回 0。
long long HookSilenceMs() {
  const long long last = g_helper.lastHookCallbackAtMs.load(std::memory_order_relaxed);
  if (!g_helper.mouseHookReady.load() || last <= 0) return 0;
  const long long now = NowMs();
  return now > last ? now - last : 0;
}

/**
 * 钩子是否"装上了但收不到事件"。
 *
 * 阶段 2 第 2 条 / P1-G 的修正：旧判据是"3 秒无回调 + 有人消费"，于是**正常静止**也会被标成
 * silent。现在只有"独立观察到位置/按键在变、钩子计数却一动不动"才算 anomal：无输入是 quiet。
 */
bool HookSilent() { return DeliveryState(NowMs()) == Delivery::Anomalous; }
/// 最近 10 次合成的平均值（稳态口径）。
long long RecentComposeUs() {
  if (g_helper.composeRecentCount == 0) return 0;
  long long sum = 0;
  for (int i = 0; i < g_helper.composeRecentCount; i += 1) sum += g_helper.composeRecent[i];
  return sum / g_helper.composeRecentCount;
}

long HookThreadExitCode();

/// 阶段 1：把运行身份与真实 exe 路径放进 `ready` / `health`，doctor 才答得出"部署是否合规"。
std::string ExePathText() {
  if (g_exePath.empty()) return std::string();
  const int size = WideCharToMultiByte(CP_UTF8, 0, g_exePath.c_str(), -1, nullptr, 0, nullptr, nullptr);
  if (size <= 1) return std::string();
  std::string out(static_cast<size_t>(size - 1), '\0');
  WideCharToMultiByte(CP_UTF8, 0, g_exePath.c_str(), -1, out.data(), size, nullptr, nullptr);
  return out;
}

void EmitHealth(const std::string& requestId) {
  EmitLine(Message("health")
               .Str("requestId", requestId)
               .Num("pid", GetCurrentProcessId())
               .Num("loopIterations", static_cast<double>(g_helper.loopIterations.load()))
               .Num("renderPasses", static_cast<double>(g_helper.renderPasses.load()))
               .Num("cursorEnsureFails", static_cast<double>(g_helper.cursorEnsureFails.load()))
               .Bool("companionEnabled", g_helper.companion.enabled)
               .Str("scopeId", g_helper.scopeId)
               .Num("generation", static_cast<double>(g_helper.generation))
               .Num("layoutEpoch", static_cast<double>(g_helper.layoutEpoch))
               .Bool("visualReady", g_helper.visualReady)
               .Bool("escapeReady", g_helper.hookReady.load())
               .Bool("latch", g_helper.latch.load())
               .Raw("counts", CountsJson(g_helper.registry.Statistics()))
               .Num("frames", static_cast<double>(g_helper.frames.load()))
               .Num("escCount", static_cast<double>(g_helper.escCount.load()))
               .Num("rejectedCommands", static_cast<double>(g_helper.rejectedCommands))
               .Bool("affinityExcluded", g_excludeFromCapture)
               .Num("mouseSelfTestDown", static_cast<double>(g_helper.selfTestPressedAfterDown))
               .Num("mouseSelfTestUp", static_cast<double>(g_helper.selfTestPressedAfterUp))
               .Str("characterSurface", CharacterSurface())
               .Str("characterAssetVersion", g_helper.assets.assetVersion)
               .Str("renderMode", RenderModeName())
               .Str("characterState", g_helper.cursorClip)
               .Num("characterFrames", static_cast<double>(g_helper.characterDraws.load()))
               .Num("characterCacheBytes", static_cast<double>(g_helper.cache.Bytes()))
               .Num("characterCacheEntries", static_cast<double>(g_helper.cache.EntryCount()))
               // 方案 五.1：UI 线程上还在发生几次构建（预热完成后应为 0）＋后台预热进度。
               .Num("characterCacheBuildsUi", static_cast<double>(g_helper.cache.UiBuilds()))
               .Num("characterCacheBuildsWorker", static_cast<double>(g_helper.cache.WorkerBuilds()))
               .Num("characterCacheBuildMs", static_cast<double>(g_helper.cache.BuildMs()))
               .Num("characterCacheHits", static_cast<double>(g_helper.cache.Hits()))
               .Num("characterCacheMisses", static_cast<double>(g_helper.cache.Misses()))
               .Num("characterCacheEvictions", static_cast<double>(g_helper.cache.Evictions()))
               .Num("characterCacheRejected", static_cast<double>(g_helper.cache.Rejected()))
               .Num("characterCacheTemporaryPeak", static_cast<double>(g_helper.cache.TemporaryPeak()))
               .Str("prewarmState", g_helper.prewarm.Completed() ? "done" : (g_helper.prewarm.Running() ? "running" : "idle"))
               .Num("prewarmBuilt", static_cast<double>(g_helper.prewarm.Built()))
               .Num("prewarmFailed", static_cast<double>(g_helper.prewarm.Failed()))
               .Bool("prewarmDisabled", g_helper.prewarmDisabled)
               .Bool("renderKeyDisabled", g_helper.renderKeyDisabled)
               .Bool("haloCacheDisabled", g_helper.haloCacheDisabled)
               .Num("positionUpdates", static_cast<double>(g_helper.positionUpdates))
               .Num("positionWakesSuppressed", static_cast<double>(g_wakeSuppressed.load()))
               .Num("layoutRefreshes", static_cast<double>(g_helper.layoutRefreshes))
               .Num("monitorQueries", static_cast<double>(g_helper.monitorQueries))
               .Bool("pointerSubscribed", g_pointerWanted.load())
               .Num("pressToPresentMs", static_cast<double>(g_helper.lastPressToPresentMs))
               .Str("characterError",
                    !g_helper.assets.error.empty() ? g_helper.assets.error : g_helper.cache.LastError())
               .Str("cursorSurface", CursorSurface())
               .Bool("cursorHaloVisible", CursorHaloWanted())
               .Bool("cursorCharacterVisible", CursorCharacterWanted())
               .Num("cursorWindowCreates", static_cast<double>(g_helper.cursorWindowCreates))
               .Num("cursorSurfaceRebuilds", static_cast<double>(g_helper.cursorSurfaceRebuilds))
               .Num("pressAnimationMs", static_cast<double>(g_helper.pointer.pressAnimationMs))
               .Bool("mouseHookReady", g_helper.mouseHookReady.load())
               // 复核第 3 条：钩子能装上、但系统不投递的情况真实存在（工作区树内启动就是）。
               // 与其静默收不到输入，不如把"沉默"变成一个可读的健康状态。
               .Bool("hookSilent", HookSilent())
               .Num("hookSilentMs", static_cast<double>(HookSilenceMs()))
               // 阶段 2 第 2/3 条 / P1-G：把"装上了 / 有投递 / 安静 / 异常"分开报。
               .Str("deliveryState", DeliveryName(DeliveryState(NowMs())))
               .Bool("hookDelivered", g_helper.deliveredSinceInstall)
               .Num("hookInstalledMs", static_cast<double>(g_helper.hookInstalledAtMs > 0 ? NowMs() - g_helper.hookInstalledAtMs : 0))
               .Num("hookReinstalls", static_cast<double>(g_helper.hookReinstalls))
               .Num("sampledResyncs", static_cast<double>(g_helper.sampledResyncs))
               .Num("keyActivity", static_cast<double>(g_helper.keyActivity.load()))
               .Bool("typingActive", g_helper.typingActive)
               .Bool("keyboardHookReady", g_helper.keyboardHookReady.load())
               .Num("releaseAnimationMs", static_cast<double>(g_helper.pointer.releaseAnimationMs))
               .Str("cursorTracking",
                    (g_helper.registry.cursor.window != nullptr && g_helper.registry.cursor.visible) ? "following"
                                                                                                     : "idle")
               .Bool("cursorPressed", g_helper.pointer.pressed)
               // 方案 二·问题 A：事件队列的真实工作量。可以据此断言"边沿没被丢"和"合并了多少移动"。
               .Num("pointerEventsSeen", static_cast<double>(g_pointerSource.Seen()))
               .Num("mouseHookCalls", static_cast<double>(g_helper.mouseHookCalls.load()))
               .Num("mouseHookError", static_cast<double>(g_helper.mouseHookError.load()))
               .Num("hookThreadExit", static_cast<double>(HookThreadExitCode()))
               .Num("pointerEventsApplied", static_cast<double>(g_pointerController.DownEdges() +
                                                               g_pointerController.UpEdges() +
                                                               g_pointerController.Moves()))
               .Num("pointerQueueDepth", static_cast<double>(g_pointerSource.Size()))
               .Num("pointerMovesCoalesced", static_cast<double>(g_pointerSource.Coalesced()))
               .Num("pointerDroppedEdges", static_cast<double>(g_pointerSource.DroppedEdges()))
               .Num("pointerOverflowEpisodes", static_cast<double>(g_pointerSource.OverflowEpisodes()))
               .Num("pointerClicks", static_cast<double>(g_pointerController.Clicks()))
               .Num("pointerTaps", static_cast<double>(g_pointerController.Taps()))
               .Num("pointerResyncs", static_cast<double>(g_helper.pointerResyncs))
               .Num("pointerWakeFailures", static_cast<double>(g_helper.pointerWakeFailures))
               .Str("pointerResyncReason", g_helper.lastResyncReason)
               .Num("pointerReleaseRate", static_cast<double>(g_helper.pointer.feedbackRate))
               // 阶段 3：反馈对象的账。clicks 增长不等于"用户看见了"，这里能分开回答。
               .Num("feedbackId", static_cast<double>(g_helper.pointer.feedback.id))
               .Str("feedbackKind", g_helper.pointer.feedback.kind)
               .Str("feedbackClip", g_helper.pointer.feedback.clip)
               .Str("feedbackSource", g_helper.pointer.feedback.source)
               .Num("feedbackEventAtMs", static_cast<double>(g_helper.pointer.feedback.eventAtMs))
               .Num("feedbackPresentedAtMs", static_cast<double>(g_helper.pointer.feedback.presentedAtMs))
               .Num("feedbackWindowMs", static_cast<double>(g_helper.pointer.feedback.windowMs))
               .Num("feedbackCreated", static_cast<double>(g_pointerController.FeedbacksCreated()))
               .Num("feedbackPresented", static_cast<double>(g_helper.feedbackPresented))
               .Num("feedbackCoalesced", static_cast<double>(g_pointerController.FeedbacksCoalesced()))
               .Num("feedbackDropped", static_cast<double>(g_pointerController.FeedbacksDropped()))
               .Str("feedbackDropReason", g_pointerController.LastDropReason())
               .Num("gestureTravelPx", static_cast<double>(g_helper.pointer.pressTravelPx))
               .Bool("gestureResampled", g_helper.pointer.pressTravelResampled)
               .Num("pressToPresentMs", static_cast<double>(g_helper.lastPressToPresentMs))
               .Num("feedbackPresentLatencyMs", static_cast<double>(g_helper.feedbackPresentToComposeMs))
               // 阶段 4：工具动作语义通道的最近一次活动。
               .Num("activityApplied", static_cast<double>(g_helper.activityApplied))
               .Str("activityKind", g_helper.lastActivityKind)
               .Str("activityPhase", g_helper.lastActivityPhase)
               .Str("activitySource", g_helper.lastActivitySource)
               // 阶段 1：doctor 需要的事实。
               .Str("exePath", ExePathText())
               .Num("integrityRid", static_cast<double>(g_identity.integrityRid))
               .Str("integrityName", IntegrityName(g_identity.integrityRid))
               .Bool("uiAccess", g_identity.uiAccess)
               .Num("sessionId", static_cast<double>(g_identity.sessionId))
               .Bool("identityCanObserveInput", IdentityCanObserveInput(g_identity))
               .Num("wheelPulses", static_cast<double>(g_pointerController.WheelPulses()))
               .Num("pointerWheelEvents", static_cast<double>(g_pointerSource.WheelEvents()))
               // 方案 三·问题 F：最近一次切换用了哪个进入帧、有没有短混合。
               .Num("cursorEntryFrame", static_cast<double>(g_helper.cursorEntryFrame))
               .Num("cursorFadeMs", static_cast<double>(g_helper.cursorFadeMs))
               .Num("cursorLastFadeMs", static_cast<double>(g_helper.cursorLastFadeMs))
               .Num("characterTransitions", static_cast<double>(g_helper.assets.transitions.size()))
               .Num("transitionFadeSum", static_cast<double>(TransitionFadeSum()))
               .Str("transitionError", g_helper.assets.transitionError)
               .Bool("cursorVisible", g_helper.registry.cursor.visible)
               .Str("cursorQuadrant", overlay::QuadrantName(g_helper.cursorLayout.quadrant))
               .Num("cursorFrames", static_cast<double>(g_helper.frames.load()))
               .Num("cursorPresents", static_cast<double>(g_helper.cursorPresents))
               .Num("cursorComposeAvgUs", static_cast<double>(g_helper.cursorComposeCount == 0 ? 0 : g_helper.cursorComposeUs / g_helper.cursorComposeCount))
               .Num("cursorComposeMaxUs", static_cast<double>(g_helper.cursorComposeMaxUs))
               .Num("cursorComposeRecentUs", static_cast<double>(RecentComposeUs()))
               .Num("haloCacheBuilds", static_cast<double>(render::HaloCache().builds))
               .Num("cursorPixelSkips", static_cast<double>(g_helper.cursorPixelSkips))
               .Str("companion", g_helper.companion.enabled ? (CompanionVisible() ? "visible" : "hidden") : "disabled")
               .Str("companionHiddenReason", g_helper.companion.hiddenReason)
               .Str("ownerMode", OwnerMode())
               .Str("phase", PhaseName())
               .Str("bannerError", g_helper.bannerError)
               .Str("bannerHr",
                    g_helper.registry.monitors.empty()
                        ? std::string("none")
                        : HrText(g_helper.registry.monitors[0].banner.bannerResources.lastHr))
               .Num("bannerDraws", static_cast<double>(g_helper.registry.monitors.empty()
                                                            ? 0
                                                            : g_helper.registry.monitors[0].banner.bannerResources.draws))
               .Num("topEdgeAlpha", static_cast<double>(TopEdgeSampleAlpha()))
               .Str("cursorError", g_helper.cursorError)
               .Bool("visualSuspended", g_helper.visualSuspended)
               .Raw("windows", WindowHealthJson())
               .Done());
}

/// 重置渲染调度（偏好或拓扑变化后强制重画一次）。
void InvalidateVisuals() {
  g_helper.edgesDirty = true;
  g_helper.bannerDirty = true;
  g_helper.cursorDirty = true;
  g_helper.edgeDueMs = -1;
  g_helper.bannerDueMs = -1;
}

/// 应用一份视觉偏好。返回是否有实质变化。
bool ApplyPreferences(const Json* preferences) {
  if (preferences == nullptr) return false;
  bool changed = false;
  auto takeBool = [&](const char* key, bool& target) {
    if (preferences->Find(key) == nullptr) return;
    const bool next = preferences->BoolOr(key, target);
    if (next != target) {
      target = next;
      changed = true;
    }
  };
  auto takeHeight = [&](const char* key, float& target, float low, float high) {
    if (preferences->Find(key) == nullptr) return;
    const double raw = preferences->NumberOr(key, target);
    const float next =
        static_cast<float>(std::min(static_cast<double>(high), std::max(static_cast<double>(low), raw)));
    if (std::fabs(next - target) > 0.01f) {
      target = next;
      changed = true;
    }
  };
  takeBool("enabled", g_helper.prefs.decoration);
  takeBool("edgeBreathing", g_helper.prefs.edgeBreathing);
  takeBool("reducedMotion", g_helper.prefs.reducedMotion);
  takeBool("cursorHalo", g_helper.prefs.cursorHalo);
  takeBool("bannerCharacter", g_helper.prefs.bannerCharacter);
  takeBool("cursorCharacter", g_helper.prefs.cursorCharacter);
  takeBool("bannerDecoration", g_helper.prefs.bannerDecoration);
  takeHeight("bannerCharacterHeightDip", g_helper.prefs.bannerCharacterHeightDip, 112.0f, 176.0f);
  takeHeight("cursorCharacterHeightDip", g_helper.prefs.cursorCharacterHeightDip, 72.0f, 128.0f);
  const Json* theme = preferences->Find("bannerTheme");
  if (theme != nullptr && theme->type == Json::Type::String) {
    const bool ocean = theme->text != "plain";
    if (ocean != g_helper.prefs.oceanTheme) {
      g_helper.prefs.oceanTheme = ocean;
      changed = true;
    }
  }
  if (changed) {
    g_helper.motion.OnStateChanged(g_helper.cursorClip, g_helper.prefs.reducedMotion);
    g_helper.cursorLayoutDirty = true;
    InvalidateVisuals();
  }
  // 角色 / 光晕开关变化要真的移除或重建光标窗口（不是只设一个"不画"的标记）。
  if (!CursorWindowWanted() && g_helper.registry.cursor.window != nullptr) {
    overlay::DestroyWindowState(g_helper.registry.cursor);
    g_helper.cursorHasLayout = false;
    g_helper.cursorLayoutDirty = true;
    g_helper.cursorFadeMs = 0;  // 窗口没了：上一帧不能拿来和新建的表面混合
    g_helper.cursorFadePrev.clear();
  }
  return changed;
}

bool HandleCommand(const Json& command);

/**
 * 反馈 kind → 实际片段名（阶段 3 第 5 条 / 阶段 5 动作表）。
 *
 * 资源里没有对应片段时**退化到已有片段**，并把真实 clip 名如实报出去 ——
 * "未制作前明确临时映射"比偷偷什么都不画要好。新增美术只要放进 pack，这里自动用上。
 */
const char* ResolveFeedbackClip(const std::string& kind) {
  auto has = [](const char* name) { return g_helper.assets.Find(name) != nullptr; };
  if (kind == "scroll") return has("scroll") ? "scroll" : "release";
  if (kind == "type" || kind == "key" || kind == "set_value") return has("typing") ? "typing" : "press_in";
  if (kind == "invoke" || kind == "pointer_click") return has("tap") ? "tap" : "release";
  if (kind == "pointer_drag" || kind == "drag") return has("drag") ? "drag" : "release";
  if (kind == "pointer_hold") return has("pressed_hold") ? "pressed_hold" : "press_in";
  return has("release") ? "release" : "press_in";
}

/* ----------------------------------------------------------- window procs -- */

constexpr UINT kCommandMessage = WM_APP + 3;
constexpr UINT kEscapeMessage = WM_APP + 2;
constexpr UINT kTopologyMessage = WM_APP + 1;
constexpr UINT kPointerMessage = WM_APP + 4;

/* ------------------------------------------------------------------ hook -- */

HHOOK g_hook = nullptr;
HHOOK g_mouseHook = nullptr;
HANDLE g_hookThread = nullptr;
DWORD g_hookThreadId = 0;

bool WakeMainThread(UINT message);

/**
 * 低级键盘钩子。
 *
 * 两件事：真实 Esc 触发停止；**普通键盘输入**只累加"有输入活动"的计数与时间戳（阶段 2 第 8 条），
 * 不保存键值、字符、密码或窗口文字 —— 这里连 `vkCode` 都没有存下来，只在比较 Esc 时读一次。
 */
LRESULT CALLBACK LowLevelKeyboardProc(int code, WPARAM wParam, LPARAM lParam) {
  if (code == HC_ACTION) {
    const auto* info = reinterpret_cast<KBDLLHOOKSTRUCT*>(lParam);
    if (info != nullptr) {
      const bool keyDown = wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN;
      if (keyDown && info->vkCode == VK_ESCAPE && (info->flags & LLKHF_INJECTED) == 0) {
        const bool relevant = g_helper.phase == Phase::Preparing || g_helper.phase == Phase::Active ||
                              g_helper.phase == Phase::Stopping;
        if (relevant && !g_helper.latch.exchange(true)) {
          g_helper.escCount.fetch_add(1);
          if (g_helper.mainThreadId != 0) PostThreadMessageW(g_helper.mainThreadId, kEscapeMessage, 0, 0);
        }
      } else if (keyDown) {
        // 打字活动：只计数 + 时间。每 50 ms 最多叫醒一次主线程（输入 20 字/秒也不会变成 20 次唤醒）。
        g_helper.keyActivity.fetch_add(1, std::memory_order_relaxed);
        const long long atMs = NowMs();
        g_helper.lastKeyActivityAtMs.store(atMs, std::memory_order_relaxed);
        if (!g_inSelfTest.load(std::memory_order_relaxed) && atMs - g_lastKeyWakeMs.load(std::memory_order_relaxed) >= 50) {
          g_lastKeyWakeMs.store(atMs, std::memory_order_relaxed);
          WakeMainThread(kPointerMessage);
        }
      }
    }
  }
  return CallNextHookEx(g_hook, code, wParam, lParam);
}

/**
 * 唤醒主线程（方案 二·问题 A 第 7 条）。
 *
 * `PostThreadMessage` 失败时必须把 pending 标志撤回来：否则之后每条消息都以为"已经有人唤醒"，
 * 队列再怎么增长也不会再投递，动画会一直停在旧状态。
 */
bool WakeMainThread(UINT message) {
  if (g_helper.mainThreadId == 0) return false;
  if (g_helper.pointerWakePending.exchange(true)) return true;  // 已有一条在路上，合并即可
  if (PostThreadMessageW(g_helper.mainThreadId, message, 0, 0)) return true;
  g_helper.pointerWakePending.store(false);
  g_helper.pointerWakeFailures += 1;
  return false;
}

/// 低级鼠标钩子：把按钮变成**有序事件**，移动只做唤醒。不过滤注入事件（自动化自己的点击也要有反馈）。
LRESULT CALLBACK LowLevelMouseProc(int code, WPARAM wParam, LPARAM lParam) {
  // 阶段 2 第 3 条 / 4.G：启动自检是**直接调用**这个回调的，它的次数绝不能混进"系统投递了多少"
  // 的统计里 —— 那正是旧实现里 `mouseHookCalls` 看起来"有回调"却没有真实输入的原因。
  const bool synthetic = g_inSelfTest.load(std::memory_order_relaxed);
  if (!synthetic) {
    g_helper.mouseHookCalls.fetch_add(1, std::memory_order_relaxed);
    g_helper.lastHookCallbackAtMs.store(NowMs(), std::memory_order_relaxed);
    g_helper.deliveredSinceInstall = true;
  }
  if (code == HC_ACTION) {
    const auto* info = reinterpret_cast<MSLLHOOKSTRUCT*>(lParam);
    if (info == nullptr) return CallNextHookEx(g_mouseHook, code, wParam, lParam);
    const bool injected = (info->flags & LLMHF_INJECTED) != 0;
    const long long atMs = NowMs();
    bool wake = false;
    switch (wParam) {
      case WM_MOUSEMOVE: {
        // 方案 五.3：没有角色也没有控制 scope 时，移动根本不订阅。
        if (!g_pointerWanted.load(std::memory_order_relaxed)) break;
        // 回调里只做定长写入 + 唤醒：不解码、不绘制、不做文件 I/O、不等锁。
        g_pointerSource.PushMove(atMs, info->pt, injected);
        // 1000/8000 Hz 鼠标不该把主线程叫醒同样多次：唤醒合并到 8 ms 一次，
        // 事件本身仍然逐条入队，按钮边沿照旧即时唤醒。
        if (atMs - g_lastMoveWakeMs.load(std::memory_order_relaxed) >= kMoveWakeMinMs) {
          g_lastMoveWakeMs.store(atMs, std::memory_order_relaxed);
          wake = true;
        } else {
          g_wakeSuppressed.fetch_add(1, std::memory_order_relaxed);
        }
        break;
      }
      case WM_LBUTTONDOWN: g_pointerSource.PushButton(atMs, info->pt, pointer::Kind::Down, pointer::Button::Left, injected); wake = true; break;
      case WM_LBUTTONUP: g_pointerSource.PushButton(atMs, info->pt, pointer::Kind::Up, pointer::Button::Left, injected); wake = true; break;
      case WM_RBUTTONDOWN: g_pointerSource.PushButton(atMs, info->pt, pointer::Kind::Down, pointer::Button::Right, injected); wake = true; break;
      case WM_RBUTTONUP: g_pointerSource.PushButton(atMs, info->pt, pointer::Kind::Up, pointer::Button::Right, injected); wake = true; break;
      case WM_MBUTTONDOWN: g_pointerSource.PushButton(atMs, info->pt, pointer::Kind::Down, pointer::Button::Middle, injected); wake = true; break;
      case WM_MBUTTONUP: g_pointerSource.PushButton(atMs, info->pt, pointer::Kind::Up, pointer::Button::Middle, injected); wake = true; break;
      // 阶段 2 第 7 条：侧键有独立 down/up，不能塞进默认的 Move 分支。
      case WM_XBUTTONDOWN:
      case WM_XBUTTONUP: {
        const unsigned which = HIWORD(info->mouseData);
        const pointer::Button button = which == XBUTTON2 ? pointer::Button::X2 : pointer::Button::X1;
        g_pointerSource.PushButton(atMs, info->pt, wParam == WM_XBUTTONDOWN ? pointer::Kind::Down : pointer::Kind::Up,
                                   button, injected);
        wake = true;
        break;
      }
      // 滚轮与横向滚动：带 delta 的脉冲，不是 Move 的一种。
      case WM_MOUSEWHEEL:
      case WM_MOUSEHWHEEL: {
        const int delta = static_cast<int>(static_cast<short>(HIWORD(info->mouseData)));
        g_pointerSource.PushWheel(atMs, info->pt, delta, wParam == WM_MOUSEHWHEEL, injected);
        wake = true;
        break;
      }
      default: break;
    }
    // 移动被合并（队列满）时仍要唤醒：消费者需要取走那条"最新位置"。
    if (wake) WakeMainThread(kPointerMessage);
  }
  return CallNextHookEx(g_mouseHook, code, wParam, lParam);
}

/// 钩子线程是否还活着：259 = STILL_ACTIVE。线程一旦退出，Windows 会静默摘掉钩子。
long HookThreadExitCode() {
  if (g_hookThread == nullptr) return -1;
  DWORD code = 0;
  if (!GetExitCodeThread(g_hookThread, &code)) return -2;
  return static_cast<long>(code);
}

DWORD WINAPI HookThreadProc(LPVOID) {
  // 先建线程消息队列：没有它 PostThreadMessage 会以 ERROR_INVALID_THREAD_ID 失败，
  // 而钩子回调正是靠这条消息唤醒主线程的。
  MSG priming;
  PeekMessageW(&priming, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
  SetLastError(0);
  g_mouseHook = SetWindowsHookExW(WH_MOUSE_LL, LowLevelMouseProc, GetModuleHandleW(nullptr), 0);
  g_helper.mouseHookError.store(static_cast<long>(GetLastError()));
  g_hook = SetWindowsHookExW(WH_KEYBOARD_LL, LowLevelKeyboardProc, GetModuleHandleW(nullptr), 0);
  // 方案 4.B：两个钩子**各自**记录。以前只要键盘钩子失败就 `return 1`，鼠标钩子刚装上也跟着被丢掉，
  // 而健康度只有一个 hookReady，谁缺了看不出来。现在缺一个也继续跑，缺哪个如实报哪个。
  g_helper.mouseHookReady.store(g_mouseHook != nullptr);
  g_helper.keyboardHookReady.store(g_hook != nullptr);
  g_helper.hookInstalledAtMs = NowMs();
  if (g_hook == nullptr && g_mouseHook == nullptr) {
    g_helper.hookReady.store(false);
    return 1;
  }
  g_helper.hookReady.store(true);
  MSG message;
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    if (message.message == kReinstallMouseHookMessage) {
      // 阶段 2 第 3 条：有界重装。只在投递被判定异常时由主线程请求，退避在请求侧算。
      // 钩子必须在**安装它的线程**上摘掉，所以这一步只能在这里做。
      if (g_mouseHook != nullptr) {
        UnhookWindowsHookEx(g_mouseHook);
        g_mouseHook = nullptr;
      }
      SetLastError(0);
      g_mouseHook = SetWindowsHookExW(WH_MOUSE_LL, LowLevelMouseProc, GetModuleHandleW(nullptr), 0);
      g_helper.mouseHookError.store(static_cast<long>(GetLastError()));
      g_helper.mouseHookReady.store(g_mouseHook != nullptr);
      g_helper.hookInstalledAtMs = NowMs();
      g_helper.deliveredSinceInstall = false;
      g_helper.lastHookCallbackAtMs.store(0, std::memory_order_relaxed);
      continue;
    }
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  UnhookWindowsHookEx(g_hook);
  g_hook = nullptr;
  if (g_mouseHook != nullptr) {
    UnhookWindowsHookEx(g_mouseHook);
    g_mouseHook = nullptr;
  }
  return 0;
}

/* -------------------------------------------------------------- commands -- */

/// 命令队列：读线程只负责"读一行、解析、投递"，所有 UI 操作都在主线程做。
std::mutex g_queueMutex;
std::deque<Json> g_commandQueue;

void PostCommand(Json command) {
  {
    std::lock_guard<std::mutex> lock(g_queueMutex);
    if (g_commandQueue.size() > 64) {
      g_helper.rejectedCommands += 1;
      return;
    }
    g_commandQueue.push_back(std::move(command));
  }
  if (g_helper.mainThreadId != 0) PostThreadMessageW(g_helper.mainThreadId, kCommandMessage, 0, 0);
}

bool DrainCommands() {
  while (true) {
    Json command;
    {
      std::lock_guard<std::mutex> lock(g_queueMutex);
      if (g_commandQueue.empty()) return true;
      command = g_commandQueue.front();
      g_commandQueue.pop_front();
    }
    if (!HandleCommand(command)) return false;
  }
}

bool HandleCommand(const Json& command) {
  const std::string method = command.StringOr("method");
  const std::string requestId = command.StringOr("requestId");
  if (method.empty()) {
    g_helper.rejectedCommands += 1;
    EmitError(requestId, "BAD_REQUEST", "every command needs a method");
    return true;
  }
  const long long now = NowMs();
  if (method == "hello") {
    const double version = command.NumberOr("protocolVersion", 0);
    if (static_cast<int>(version) != kProtocolVersion) {
      EmitError(requestId, "PROTOCOL_MISMATCH",
                "this helper speaks protocol " + std::to_string(kProtocolVersion) +
                    "; the supervisor and the helper must ship together");
      return true;
    }
    EmitReady(requestId);
    return true;
  }
  if (method == "beginScope") {
    const std::string scopeId = command.StringOr("scopeId");
    const double epoch = command.NumberOr("epoch", -1);
    if (scopeId.empty() || epoch < 0) {
      g_helper.rejectedCommands += 1;
      EmitError(requestId, "BAD_REQUEST", "beginScope needs scopeId and epoch");
      return true;
    }
    {
      std::lock_guard<std::mutex> lock(g_helper.mutex);
      g_helper.scopeId = scopeId;
      g_helper.epoch = static_cast<long>(epoch);
      g_helper.phase = Phase::Preparing;
    }
    // 先建窗并画一帧，确认视觉真的呈现了，再报 scopeReady；firstPresentMs 就是从这到首帧的耗时。
    const long long beginAt = NowMs();
    const bool ready = RebuildDisplayOverlays(beginAt);
    RefreshCompanionReason();
    if (CursorWindowWanted()) {
      POINT pointer{0, 0};
      GetCursorPos(&pointer);
      EnsureCursorWindow(pointer);
      UpdateCursorPose(beginAt);
      DrawCursorPixels(beginAt);
      PositionCursorWindow(pointer);
    }
    g_helper.visualReady = ready;
    {
      std::lock_guard<std::mutex> lock(g_helper.mutex);
      g_helper.phase = Phase::Active;
    }
    const overlay::Counts counts = g_helper.registry.Statistics();
    EmitLine(Message("scopeReady")
                 .Str("requestId", requestId)
                 .Str("scopeId", scopeId)
                 .Num("epoch", epoch)
                 .Bool("visualReady", ready)
                 .Bool("escapeReady", g_helper.keyboardHookReady.load())
                 .Num("windows", static_cast<double>(counts.created))
                 .Raw("counts", CountsJson(counts))
                 .Num("layoutEpoch", static_cast<double>(g_helper.layoutEpoch))
                 .Str("cursorStatus", CursorSurface())
                 .Num("cursorWindows", static_cast<double>(counts.cursorWindows))
                 .Num("firstPresentMs", static_cast<double>(NowMs() - beginAt))
                 .Str("characterSurface", CharacterSurface())
                 .Str("renderMode", RenderModeName())
                 .Raw("topology", TopologyJson())
                 .Raw("windowsDetail", WindowHealthJson())
                 .Done());
    return true;
  }
  if (method == "updateState") {
    const double seq = command.NumberOr("seq", -1);
    const bool active = command.BoolOr("active", false);
    if (seq < 0) {
      g_helper.rejectedCommands += 1;
      EmitError(requestId, "BAD_REQUEST", "updateState needs a monotonic seq");
      return true;
    }
    if (seq <= g_helper.seq) {
      EmitLine(Message("stateApplied")
                   .Str("requestId", requestId)
                   .Num("seq", seq)
                   .Bool("applied", false)
                   .Num("currentSeq", g_helper.seq)
                   .Done());
      return true;
    }
    g_helper.seq = static_cast<long>(seq);
    {
      std::lock_guard<std::mutex> lock(g_helper.mutex);
      if (active) {
        g_helper.phase = Phase::Active;
      } else if (g_helper.phase == Phase::Active) {
        g_helper.phase = Phase::Stopping;
      }
    }
    // 停止中横幅要立刻说"正在停"，装饰动效同时停下。
    g_helper.bannerDirty = true;
    g_helper.edgesDirty = true;
    EmitLine(Message("stateApplied")
                 .Str("requestId", requestId)
                 .Num("seq", seq)
                 .Bool("applied", true)
                 .Num("currentSeq", g_helper.seq)
                 .Done());
    return true;
  }
  if (method == "setVisualPreferences") {
    const double revision = command.NumberOr("settingsRevision", -1);
    if (revision < 0) {
      g_helper.rejectedCommands += 1;
      EmitError(requestId, "BAD_REQUEST", "setVisualPreferences needs settingsRevision");
      return true;
    }
    if (revision < g_helper.prefs.settingsRevision) {
      EmitLine(Message("visualPreferencesApplied")
                   .Str("requestId", requestId)
                   .Num("settingsRevision", revision)
                   .Bool("applied", false)
                   .Num("currentRevision", static_cast<double>(g_helper.prefs.settingsRevision))
                   .Done());
      return true;
    }
    const bool changed = ApplyPreferences(command.Find("preferences"));
    g_helper.prefs.settingsRevision = static_cast<long>(revision);
    // 应用之后画一帧：回执代表"真的应用了"，不只是字段赋值成功。
    if (ControlActive() && !g_helper.visualSuspended) {
      for (overlay::MonitorGroup& group : g_helper.registry.monitors) {
        DrawEdges(group, now);
        DrawBanner(group, now);
      }
    }
    if (CursorWindowWanted() && g_helper.registry.cursor.window != nullptr) {
      POINT pointer{0, 0};
      if (GetCursorPos(&pointer)) PositionCursorWindow(pointer);
      DrawCursorPixels(now);
    }
    EmitLine(Message("visualPreferencesApplied")
                 .Str("requestId", requestId)
                 .Num("settingsRevision", revision)
                 .Bool("applied", true)
                 .Bool("changed", changed)
                 .Bool("enabled", g_helper.prefs.decoration)
                 .Bool("edgeBreathing", g_helper.prefs.edgeBreathing)
                 .Bool("reducedMotion", g_helper.prefs.reducedMotion)
                 .Bool("cursorHalo", g_helper.prefs.cursorHalo)
                 .Bool("bannerCharacter", g_helper.prefs.bannerCharacter)
                 .Bool("cursorCharacter", g_helper.prefs.cursorCharacter)
                 .Bool("bannerDecoration", g_helper.prefs.bannerDecoration)
                 .Str("bannerTheme", g_helper.prefs.oceanTheme ? "ocean" : "plain")
                 .Num("bannerCharacterHeightDip", static_cast<double>(g_helper.prefs.bannerCharacterHeightDip))
                 .Num("cursorCharacterHeightDip", static_cast<double>(g_helper.prefs.cursorCharacterHeightDip))
                 .Str("cursorSurface", CursorSurface())
               .Bool("cursorHaloVisible", CursorHaloWanted())
               .Bool("cursorCharacterVisible", CursorCharacterWanted())
                 .Done());
    return true;
  }
  if (method == "visualActivity") {
    // 阶段 4：工具动作的视觉语义。**只驱动角色动画**，不伪造全局按钮状态、不为动画补发任何输入，
    // 也不把"动画播了"当成"操作成功"。
    const std::string phase = command.StringOr("phase", "start");
    const std::string kind = command.StringOr("kind");
    const std::string source = command.StringOr("source", "tool");
    const std::string operationId = command.StringOr("operationId");
    const double generation = command.NumberOr("helperGeneration", static_cast<double>(g_helper.generation));
    const double epoch = command.NumberOr("epoch", static_cast<double>(g_helper.epoch));
    if (kind.empty()) {
      g_helper.rejectedCommands += 1;
      EmitError(requestId, "BAD_REQUEST", "visualActivity needs a kind");
      return true;
    }
    // 旧代次/旧 epoch 的迟到消息一律丢弃，清理而不是污染新会话（阶段 4 第 7 条）。
    const bool staleGeneration = static_cast<long long>(generation) != g_helper.generation;
    const bool staleEpoch = epoch >= 0 && g_helper.epoch >= 0 && static_cast<long>(epoch) != g_helper.epoch;
    if (staleGeneration || staleEpoch) {
      EmitLine(Message("activityApplied")
                   .Str("requestId", requestId)
                   .Str("operationId", operationId)
                   .Str("kind", kind)
                   .Str("phase", phase)
                   .Bool("applied", false)
                   .Str("reason", staleGeneration ? "stale_generation" : "stale_epoch")
                   .Done());
      return true;
    }
    g_helper.activityApplied += 1;
    g_helper.lastActivityKind = kind;
    g_helper.lastActivityPhase = phase;
    g_helper.lastActivitySource = source;
    g_helper.lastActivityOperationId = operationId;
    g_helper.lastActivityAtMs = now;
    const bool ending = phase == "end" || phase == "failed" || phase == "cancelled";
    if (ending) {
      g_pointerController.EndExternal(now, phase.c_str());
    } else {
      const char* clip = ResolveFeedbackClip(kind);
      long long window = animation::kTapFeedbackMs;
      if (kind == "type" || kind == "key" || kind == "set_value") window = animation::kTypingFeedbackMs;
      if (kind == "scroll") window = animation::kScrollFeedbackMs;
      if (kind == "pointer_drag" || kind == "drag") window = g_helper.pointer.releaseAnimationMs;
      g_pointerController.ExternalFeedback(now, kind, clip, source, window);
    }
    g_helper.cursorDirty = true;
    if (CursorWindowWanted() && g_helper.registry.cursor.window != nullptr) {
      UpdateCursorPose(now);
      DrawCursorPixels(now);
    }
    EmitLine(Message("activityApplied")
                 .Str("requestId", requestId)
                 .Str("operationId", operationId)
                 .Str("kind", kind)
                 .Str("phase", phase)
                 .Bool("applied", true)
                 .Num("feedbackId", static_cast<double>(g_helper.pointer.feedback.id))
                 .Str("feedbackClip", g_helper.pointer.feedback.clip)
                 .Str("feedbackSource", g_helper.pointer.feedback.source)
                 .Bool("feedbackPresented", g_helper.pointer.feedback.presentedAtMs >= 0)
                 .Num("epoch", static_cast<double>(g_helper.epoch))
                 .Num("helperGeneration", static_cast<double>(g_helper.generation))
                 .Num("activityApplied", static_cast<double>(g_helper.activityApplied))
                 .Done());
    return true;
  }
  if (method == "setCompanionPreferences") {
    // 日常伴随的独立准入：不伪造 scopeId，也不代表电脑控制就绪（方案 7.1）。
    const bool requested = command.BoolOr("enabled", false);
    const std::string hostInstanceId = command.StringOr("hostInstanceId");
    const double revision = command.NumberOr("settingsRevision", 0);
    g_helper.companion.enabled = requested;
    g_helper.companion.hostInstanceId = hostInstanceId;
    g_helper.companion.settingsRevision = static_cast<long>(revision);
    g_helper.companion.helperGeneration =
        static_cast<long long>(command.NumberOr("helperGeneration", static_cast<double>(g_helper.generation)));
    g_helper.companion.appliedOnce = true;
    RefreshCompanionReason();
    if (requested && CursorWindowWanted()) {
      g_helper.motion.OnStateChanged(g_helper.cursorClip, g_helper.prefs.reducedMotion);
      // 不要在这里标 layoutDirty：伴随开关不改变布局，只有 withCharacter/DPI 变了窗口才该重建，
      // 那由 EnsureCursorWindow 的尺寸比较发现。无条件标脏会让每次开伴随都换掉一个 HWND。
      POINT pointer{0, 0};
      if (GetCursorPos(&pointer) && EnsureCursorWindow(pointer)) {
        UpdateCursorPose(now);
        DrawCursorPixels(now);
        PositionCursorWindow(pointer);
      }
    } else if (!CursorWindowWanted() && g_helper.registry.cursor.window != nullptr) {
      overlay::DestroyWindowState(g_helper.registry.cursor);
      g_helper.cursorHasLayout = false;
      g_helper.cursorLayoutDirty = true;
    }
    const overlay::Counts counts = g_helper.registry.Statistics();
    EmitLine(Message("companionApplied")
                 .Str("requestId", requestId)
                 .Str("hostInstanceId", hostInstanceId)
                 .Num("settingsRevision", revision)
                 .Num("helperGeneration", static_cast<double>(g_helper.companion.helperGeneration))
                 .Bool("requestedEnabled", requested)
                 .Bool("effectiveVisible", CompanionVisible())
                 .Str("hiddenReason", g_helper.companion.hiddenReason)
                 .Str("ownerMode", OwnerMode())
                 .Num("cursorWindows", static_cast<double>(counts.cursorWindows))
                 .Str("cursorSurface", CursorSurface())
               .Bool("cursorHaloVisible", CursorHaloWanted())
               .Bool("cursorCharacterVisible", CursorCharacterWanted())
                 .Str("characterSurface", CharacterSurface())
                 .Done());
    return true;
  }
  if (method == "endScope") {
    const std::string scopeId = command.StringOr("scopeId");
    {
      std::lock_guard<std::mutex> lock(g_helper.mutex);
      if (!scopeId.empty() && scopeId != g_helper.scopeId) {
        EmitLine(Message("scopeEnded")
                     .Str("requestId", requestId)
                     .Bool("applied", false)
                     .Str("reason", "the scope id does not match the active scope")
                     .Done());
        return true;
      }
    }
    // 结束控制 scope：边条与横幅销毁（没有控制时它们的存在本身就该是零）；
    // 光标按日常伴随开关重新计算，不能一律关掉。
    DestroyDisplayOverlays();
    {
      std::lock_guard<std::mutex> lock(g_helper.mutex);
      g_helper.phase = Phase::Idle;
      g_helper.scopeId.clear();
      g_helper.epoch = -1;
    }
    g_helper.latch.store(false);
    g_helper.visualReady = false;
    RefreshCompanionReason();
    if (!CursorWindowWanted() && g_helper.registry.cursor.window != nullptr) {
      overlay::DestroyWindowState(g_helper.registry.cursor);
      g_helper.cursorHasLayout = false;
      g_helper.cursorLayoutDirty = true;
    }
    EmitLine(Message("scopeEnded")
                 .Str("requestId", requestId)
                 .Bool("applied", true)
                 .Num("frames", static_cast<double>(g_helper.frames.load()))
                 .Raw("counts", CountsJson(g_helper.registry.Statistics()))
                 .Str("ownerMode", OwnerMode())
                 .Done());
    return true;
  }
  if (method == "suspendVisual" || method == "resumeVisual") {
    // 截图回退：只改变"看得见看不见"，不解除 Esc、不解除闩锁、不动任何租约。
    const bool suspend = method == "suspendVisual";
    g_helper.visualSuspended = suspend;
    if (suspend) {
      for (overlay::MonitorGroup& group : g_helper.registry.monitors) {
        overlay::HideWindow(group.top);
        overlay::HideWindow(group.bottom);
        overlay::HideWindow(group.left);
        overlay::HideWindow(group.right);
        overlay::HideWindow(group.banner);
      }
      overlay::HideWindow(g_helper.registry.cursor);
      g_helper.edgeDueMs = -1;
      g_helper.bannerDueMs = -1;
    } else {
      RefreshCompanionReason();
      if (ControlActive()) {
        for (overlay::MonitorGroup& group : g_helper.registry.monitors) {
          DrawEdges(group, now);
          DrawBanner(group, now);
          const overlay::WindowState* windows[5] = {&group.top, &group.bottom, &group.left, &group.right,
                                                    &group.banner};
          for (const overlay::WindowState* state : windows) {
            if (state->window != nullptr) ShowWindow(state->window, SW_SHOWNOACTIVATE);
          }
        }
      }
      if (CursorWindowWanted()) {
        // 恢复只重画内容：窗口还活着，没理由把它换掉（换掉就会闪一下）。
        g_helper.cursorDirty = true;
      }
    }
    EmitLine(Message(suspend ? "visualSuspended" : "visualResumed")
                 .Str("requestId", requestId)
                 .Bool("applied", true)
                 .Bool("suspended", suspend)
                 .Raw("counts", CountsJson(g_helper.registry.Statistics()))
                 .Str("ownerMode", OwnerMode())
                 .Done());
    return true;
  }
  if (method == "health") {
    EmitHealth(requestId);
    return true;
  }
  if (method == "shutdown") {
    g_shutdownRequestId = requestId;
    g_helper.shuttingDown.store(true);
    if (g_helper.mainThreadId != 0) PostThreadMessageW(g_helper.mainThreadId, WM_QUIT, 0, 0);
    return false;
  }
  g_helper.rejectedCommands += 1;
  EmitError(requestId, "UNKNOWN_METHOD", "this helper does not know " + method);
  return true;
}

/* ------------------------------------------------------------ stdin reader -- */

void ReadLoop() {
  std::string pending;
  char buffer[8192];
  DWORD read = 0;
  while (!g_helper.shuttingDown.load()) {
    if (!ReadFile(GetStdHandle(STD_INPUT_HANDLE), buffer, sizeof(buffer), &read, nullptr) || read == 0) break;
    pending.append(buffer, read);
    size_t newline = std::string::npos;
    while ((newline = pending.find('\n')) != std::string::npos) {
      std::string line = pending.substr(0, newline);
      pending.erase(0, newline + 1);
      if (!line.empty() && line.back() == '\r') line.pop_back();
      if (line.empty()) continue;
      if (line.size() > kMaxLineBytes) {
        g_helper.rejectedCommands += 1;
        EmitError("", "LINE_TOO_LONG",
                  "a command line may be at most " + std::to_string(kMaxLineBytes) + " bytes");
        continue;
      }
      Json command;
      std::string error;
      JsonParser parser(line);
      if (!parser.Parse(command, error)) {
        g_helper.rejectedCommands += 1;
        EmitError("", "BAD_JSON", error);
        continue;
      }
      PostCommand(command);
    }
    if (pending.size() > kMaxLineBytes) {
      g_helper.rejectedCommands += 1;
      EmitError("", "LINE_TOO_LONG",
                "a command line may be at most " + std::to_string(kMaxLineBytes) + " bytes");
      pending.clear();
    }
  }
}

}  // namespace

/* ------------------------------------------------------------ window proc -- */

namespace overlay {

/// 自检用的小报告器：只收集"哪一条没通过"，不抛异常。
struct SelfTestReport {
  int checks = 0;
  std::vector<std::string> failures;

  void Check(const std::string& name, bool ok, const std::string& detail = std::string()) {
    checks += 1;
    if (ok) return;
    failures.push_back(detail.empty() ? name : name + " :: " + detail);
  }
};

inline std::string IntText(long long value) { return std::to_string(value); }

inline std::string RectText(const RECT& rect) {
  return IntText(rect.left) + "," + IntText(rect.top) + " " + IntText(rect.right - rect.left) + "x" +
         IntText(rect.bottom - rect.top);
}

inline bool InsideMonitor(const RECT& inner, const RECT& monitor) {
  return inner.left >= monitor.left && inner.top >= monitor.top && inner.right <= monitor.right &&
         inner.bottom <= monitor.bottom;
}

/**
 * 纯几何自检（方案 8.3 的边条几何 / DPI 两行）。
 *
 * 没有第二块物理屏也能跑：这里遍历分辨率、DPI、负坐标与竖屏，检查**产品代码**的四条边
 * 是否两两不相交、是否都在显示器内、面积是否等于理论值、接缝处 alpha 是否连续，再检查横幅与
 * 光标布局是否把人物放得下。任何一条失败都会让进程以 1 退出。
 */
inline int RunLayoutSelfTest() {
  SelfTestReport report;
  struct Case {
    const char* name;
    RECT rect;
    UINT dpi;
  };
  const Case monitors[] = {
      {"1366x768@96", RECT{0, 0, 1366, 768}, 96},
      {"1920x1080@120", RECT{0, 0, 1920, 1080}, 120},
      {"2560x1440@144", RECT{0, 0, 2560, 1440}, 144},
      {"3840x2160@192", RECT{0, 0, 3840, 2160}, 192},
      {"portrait 1080x1920@144", RECT{0, 0, 1080, 1920}, 144},
      {"negative origin@144", RECT{-1920, -200, 0, 880}, 144},
      {"tiny 320x200@96", RECT{0, 0, 320, 200}, 96},
  };

  for (const Case& one : monitors) {
    const std::string name = one.name;
    const Edges edges = ComputeEdges(one.rect, one.dpi);
    report.Check(name + ": edges are usable", edges.ok);
    if (!edges.ok) continue;
    report.Check(name + ": four rects are disjoint", EdgeRectsDisjoint(edges));
    report.Check(name + ": top covers the width", Width(edges.top) == Width(one.rect));
    report.Check(name + ": bottom covers the width", Width(edges.bottom) == Width(one.rect));
    report.Check(name + ": left/right do not overlap the top/bottom",
                 edges.left.top >= edges.top.bottom && edges.left.bottom <= edges.bottom.top &&
                     edges.right.top >= edges.top.bottom && edges.right.bottom <= edges.bottom.top);
    report.Check(name + ": every rect is inside the monitor",
                 InsideMonitor(edges.top, one.rect) && InsideMonitor(edges.bottom, one.rect) &&
                     InsideMonitor(edges.left, one.rect) && InsideMonitor(edges.right, one.rect));
    const long long width = Width(one.rect);
    const long long height = Height(one.rect);
    const long long band = edges.bandPx;
    const long long expected = width * band * 2 + (height - 2 * band) * band * 2;
    report.Check(name + ": edge area equals the capacity formula", edges.Area() == expected,
                 IntText(edges.Area()) + " vs " + IntText(expected));

    // 角部连续性：上下条与左右条在接缝两侧必须来自同一个距离场，不能出现一条亮线。
    const float thickness = DipToPx(kMaxBandDip, one.dpi);
    float previous = 2.0f;
    bool monotone = true;
    for (int d = 0; d <= static_cast<int>(thickness) + 1; d += 1) {
      const float alpha = EdgeAlphaAtMonitorPoint(d, d, Width(one.rect), Height(one.rect), thickness);
      if (alpha > previous + 1e-4f) monotone = false;
      previous = alpha;
    }
    report.Check(name + ": alpha falls off monotonically from the corner", monotone);
    report.Check(name + ": the screen edge is fully lit",
                 EdgeAlphaAtMonitorPoint(0, 0, Width(one.rect), Height(one.rect), thickness) > 0.95f);
    report.Check(name + ": beyond the band it is zero",
                 EdgeAlphaAtMonitorPoint(static_cast<int>(thickness) + 1, static_cast<int>(thickness) + 1, Width(one.rect),
                                         Height(one.rect), thickness) == 0.0f);
    bool seam = true;
    const int seamLimit = std::min<int>(edges.bandPx, static_cast<int>(thickness) + 1);
    for (int x = 0; x < seamLimit; x += 1) {
      const float above = EdgeAlphaAtMonitorPoint(x, edges.bandPx - 1, Width(one.rect), Height(one.rect), thickness);
      const float below = EdgeAlphaAtMonitorPoint(x, edges.bandPx, Width(one.rect), Height(one.rect), thickness);
      if (std::fabs(above - below) > 1e-4f) seam = false;
    }
    report.Check(name + ": no seam between the top edge and the side edges", seam);

    // 横幅：三种人物高度都要放得进屏内，且文字区间为正。
    for (const float characterHeight : {112.0f, 144.0f, 176.0f}) {
      BannerOptions options;
      options.characterHeightDip = characterHeight;
      options.characterAspect = 0.73f;
      options.wantCharacter = true;
      const BannerLayout layout = ComputeBannerLayout(one.rect, one.dpi, options);
      const std::string label = name + ": banner@" + IntText(static_cast<long long>(characterHeight));
      report.Check(label + " is valid", layout.valid);
      if (!layout.valid) continue;
      report.Check(label + " stays inside the monitor", InsideMonitor(layout.window, one.rect), RectText(layout.window));
      report.Check(label + " plate stays inside the window",
                   layout.plateLeftDip >= 0.0f &&
                       layout.plateLeftDip + layout.plateWidthDip <= PxToDip(layout.widthPx, one.dpi) + 0.5f);
      report.Check(label + " text slot is positive", layout.textRightDip > layout.textLeftDip + 40.0f,
                   IntText(static_cast<long long>(layout.textRightDip - layout.textLeftDip)));
      if (layout.characterFits) {
        report.Check(label + " character anchor is inside the window",
                     layout.characterAnchorXDip >= 0.0f && layout.characterAnchorXDip <= layout.widthDip &&
                         layout.characterAnchorYDip > 0.0f && layout.characterAnchorYDip <= layout.heightDip);
        report.Check(label + " character body fits above the plate",
                     layout.characterAnchorYDip - characterHeight >= -0.5f);
      }
    }

    // 光标：人物/光晕都要放得进窗口，且方位随边缘切换。
    for (const UINT dpi : {96u, 144u, 192u}) {
      for (const float cursorHeightDip : {72.0f, 96.0f, 128.0f}) {
        const POINT hotspot{one.rect.left + Width(one.rect) / 2, one.rect.top + Height(one.rect) / 2};
        const CursorLayout layout =
            ComputeCursorLayout(dpi, cursorHeightDip, 0.73f, true, Quadrant::BottomRight, hotspot, one.rect);
        const std::string label = name + ": cursor@" + IntText(dpi) + "/" + IntText(static_cast<long long>(cursorHeightDip));
        report.Check(label + " window is square and even", layout.sizePx == layout.extentPx * 2 && layout.sizePx % 2 == 0);
        report.Check(label + " hotspot sits at the centre",
                     layout.hotspotInWindow.x == layout.extentPx && layout.hotspotInWindow.y == layout.extentPx);
        const int bodyWidth = static_cast<int>(std::lround(static_cast<double>(DipToPx(cursorHeightDip, dpi)) * 0.73));
        const int bodyHeight = static_cast<int>(std::lround(DipToPx(cursorHeightDip, dpi)));
        report.Check(label + " character body is inside the window",
                     layout.characterAnchorX - bodyWidth / 2 >= 0 && layout.characterAnchorX + bodyWidth / 2 <= layout.sizePx &&
                         layout.characterAnchorY - bodyHeight >= 0 && layout.characterAnchorY <= layout.sizePx);
      }
    }
    // 方位：贴右边必须换到左侧，贴底边必须换到上方；同样输入两次结果一致。
    {
      const POINT rightEdge{one.rect.right - 2, one.rect.top + Height(one.rect) / 2};
      const CursorLayout edge = ComputeCursorLayout(one.dpi, 96.0f, 0.73f, true, Quadrant::BottomRight, rightEdge, one.rect);
      const bool leftSide = edge.quadrant == Quadrant::BottomLeft || edge.quadrant == Quadrant::TopLeft;
      report.Check(name + ": the character flips to the left near the right edge", leftSide, QuadrantName(edge.quadrant));
      const POINT bottomEdge{one.rect.left + Width(one.rect) / 2, one.rect.bottom - 2};
      const CursorLayout low = ComputeCursorLayout(one.dpi, 96.0f, 0.73f, true, Quadrant::BottomRight, bottomEdge, one.rect);
      const bool upperSide = low.quadrant == Quadrant::TopLeft || low.quadrant == Quadrant::TopRight;
      report.Check(name + ": the character flips above near the bottom edge", upperSide, QuadrantName(low.quadrant));
      const POINT centre{one.rect.left + Width(one.rect) / 2, one.rect.top + Height(one.rect) / 2};
      const CursorLayout first = ComputeCursorLayout(one.dpi, 96.0f, 0.73f, true, Quadrant::BottomRight, centre, one.rect);
      const CursorLayout again =
          ComputeCursorLayout(one.dpi, 96.0f, 0.73f, true, first.quadrant, centre, one.rect);
      report.Check(name + ": the same hotspot keeps the same quadrant", first.quadrant == again.quadrant,
                   std::string(QuadrantName(first.quadrant)) + " -> " + QuadrantName(again.quadrant));
    }
  }

  // 方案 4.H：换帧期限按"轮起点 + 轮内累计"算。这里的数字不是随手写的：
  // move = 8×125 ms，第一轮之外以前会返回 2000/3000 这种轮边界。
  {
    const std::vector<int> move{125, 125, 125, 125, 125, 125, 125, 125};
    report.Check("clock: first cycle", animation::NextFrameDeadlineMs(8, move, 1000, true, 100) == 125,
                 IntText(animation::NextFrameDeadlineMs(8, move, 1000, true, 100)));
    report.Check("clock: second cycle uses the cycle base", animation::NextFrameDeadlineMs(8, move, 1000, true, 1125) == 1250,
                 IntText(animation::NextFrameDeadlineMs(8, move, 1000, true, 1125)));
    report.Check("clock: third cycle", animation::NextFrameDeadlineMs(8, move, 1000, true, 2125) == 2250,
                 IntText(animation::NextFrameDeadlineMs(8, move, 1000, true, 2125)));
    report.Check("clock: exactly on a boundary goes to the next frame",
                 animation::NextFrameDeadlineMs(8, move, 1000, true, 125) == 250,
                 IntText(animation::NextFrameDeadlineMs(8, move, 1000, true, 125)));
    report.Check("clock: the end of a cycle wraps", animation::NextFrameDeadlineMs(8, move, 1000, true, 1000) == 1125,
                 IntText(animation::NextFrameDeadlineMs(8, move, 1000, true, 1000)));
    const std::vector<int> eat{400, 240, 120, 120, 120, 120, 120, 160, 300, 180, 200, 200, 160, 160, 200, 400};
    report.Check("clock: non-uniform durations", animation::NextFrameDeadlineMs(16, eat, 3200, true, 3400) == 3600,
                 IntText(animation::NextFrameDeadlineMs(16, eat, 3200, true, 3400)));
    const std::vector<int> press{40, 40, 40, 40, 40, 40, 40, 40};
    report.Check("clock: a one-shot ends without a deadline",
                 animation::NextFrameDeadlineMs(8, press, 320, false, 400) == -1);
    report.Check("clock: negative elapsed is treated as zero",
                 animation::NextFrameDeadlineMs(8, move, 1000, true, -50) == 125);
  }

  std::string failures = "[";
  for (size_t i = 0; i < report.failures.size(); i += 1) {
    failures += "\"" + report.failures[i] + "\"";
    if (i + 1 < report.failures.size()) failures += ",";
  }
  failures += "]";
  const std::string line = "{\"ok\":" + std::string(report.failures.empty() ? "true" : "false") +
                           ",\"checks\":" + IntText(report.checks) + ",\"failures\":" + failures + "}";
  // 自检结果走 stdout：`tools/overlay-geometry-test.mjs` 直接解析这一行。
  fwrite(line.data(), 1, line.size(), stdout);
  fputc('\n', stdout);
  fflush(stdout);
  return report.failures.empty() ? 0 : 1;
}

LRESULT CALLBACK OverlayProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
  switch (message) {
    case WM_NCHITTEST: return HTTRANSPARENT;
    case WM_MOUSEACTIVATE: return MA_NOACTIVATE;
    case WM_ERASEBKGND: return 1;
    case WM_DISPLAYCHANGE:
    case WM_DPICHANGED:
      // 拓扑或 DPI 变了：交给主循环合并成一次布局重建（5N 个窗口各触发一轮重建是浪费）。
      if (g_helper.mainThreadId != 0) PostThreadMessageW(g_helper.mainThreadId, WM_APP + 1, 0, 0);
      return 0;
    default: return DefWindowProcW(hwnd, message, wParam, lParam);
  }
}
}  // namespace overlay

/**
 * 光晕缓存的等价性自检（方案 五.4）。
 *
 * 同一次合成分别走"缓存光晕"和"逐像素现算"，逐字节比较。缓存路径不能改变任何一个像素，
 * 只是不再每帧重算：DPI/按压/减少动画三组组合都要对上。
 */
int RunHaloCheck() {
  if (g_helper.assetsDir.empty()) {
    std::printf("{\"kind\":\"halo-check\",\"ok\":false,\"error\":\"--assets is required\"}\n");
    return 1;
  }
  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  character::Assets assets;
  if (!character::Load(g_helper.assetsDir, assets)) {
    std::printf("{\"kind\":\"halo-check\",\"ok\":false,\"error\":\"%s\"}\n", assets.error.c_str());
    return 1;
  }
  character::Cache cache;
  cache.Configure(&assets);
  cache.MarkUiThread();
  int checks = 0;
  int failures = 0;
  std::string detail;
  char buffer[256];
  for (const UINT dpi : {96u, 144u, 192u}) {
    for (const bool pressed : {false, true}) {
      for (const bool reduced : {false, true}) {
        render::Preferences prefs;
        prefs.cursorCharacterHeightDip = 96.0f;
        prefs.reducedMotion = reduced;
        const RECT monitor{0, 0, 2560, 1440};
        const POINT hotspot{1280, 720};
        const overlay::CursorLayout layout =
            overlay::ComputeCursorLayout(dpi, 96.0f, 0.75f, true, overlay::Quadrant::BottomRight, hotspot, monitor);
        const size_t count = static_cast<size_t>(layout.sizePx) * layout.sizePx;
        std::vector<uint32_t> cached(count, 0);
        std::vector<uint32_t> computed(count, 0);
        overlay::WindowState a{};
        overlay::WindowState b{};
        a.widthPx = layout.sizePx;
        a.heightPx = layout.sizePx;
        a.pixels = cached.data();
        b.widthPx = layout.sizePx;
        b.heightPx = layout.sizePx;
        b.pixels = computed.data();
        const render::Scene scene = render::MakeScene(123456, prefs, dpi, false);
        render::Pose pose;
        pose.clip = "idle";
        pose.frame = 0;
        std::string errorA;
        std::string errorB;
        const bool okA = render::DrawCursor(a, layout, prefs, scene, pressed, true, true, assets, cache, pose, dpi,
                                            errorA, true);
        const bool okB = render::DrawCursor(b, layout, prefs, scene, pressed, true, true, assets, cache, pose, dpi,
                                            errorB, false);
        checks += 1;
        if (!okA || !okB) {
          failures += 1;
          detail = "draw failed: " + (okA ? errorB : errorA);
          continue;
        }
        size_t diff = 0;
        for (size_t i = 0; i < count; i += 1) {
          if (cached[i] != computed[i]) diff += 1;
        }
        if (diff != 0) {
          failures += 1;
          std::snprintf(buffer, sizeof(buffer), "dpi=%u pressed=%d reduced=%d differs in %zu px", dpi, pressed ? 1 : 0,
                        reduced ? 1 : 0, diff);
          detail = buffer;
        }
      }
    }
  }
  // 方案 五.4：加载期解析出来的 clip.parts 必须与"现场解析再排序"完全一致。
  int partChecks = 0;
  for (const character::Clip& clip : assets.clips) {
    std::vector<character::Part> expected;
    for (const character::Part& source : assets.parts) expected.push_back(character::PartForClip(clip, source));
    std::stable_sort(expected.begin(), expected.end(),
                     [](const character::Part& a, const character::Part& b) { return a.zOrder < b.zOrder; });
    partChecks += 1;
    bool same = expected.size() == clip.parts.size();
    for (size_t i = 0; same && i < expected.size(); i += 1) {
      const character::Part& a = expected[i];
      const character::Part& b = clip.parts[i];
      same = a.name == b.name && a.atlas == b.atlas && a.zOrder == b.zOrder &&
             a.frameCount == b.frameCount && a.columns == b.columns && a.rows == b.rows;
    }
    if (!same) {
      failures += 1;
      detail = "clip parts differ for " + clip.name;
    }
  }
  // 微基准：同一帧、热缓存，各跑 200 次，只看光晕那一段的差别（方案 五.4 的收益量化）。
  long long benchCachedUs = 0;
  long long benchComputedUs = 0;
  {
    render::Preferences prefs;
    prefs.cursorCharacterHeightDip = 96.0f;
    const RECT monitor{0, 0, 2560, 1440};
    const POINT hotspot{1280, 720};
    const UINT dpi = 96;
    const overlay::CursorLayout layout =
        overlay::ComputeCursorLayout(dpi, 96.0f, 0.75f, true, overlay::Quadrant::BottomRight, hotspot, monitor);
    const size_t count = static_cast<size_t>(layout.sizePx) * layout.sizePx;
    std::vector<uint32_t> pixels(count, 0);
    overlay::WindowState window{};
    window.widthPx = layout.sizePx;
    window.heightPx = layout.sizePx;
    window.pixels = pixels.data();
    const render::Scene scene = render::MakeScene(123456, prefs, dpi, false);
    render::Pose pose;
    pose.clip = "idle";
    pose.frame = 0;
    std::string error;
    constexpr int kIterations = 200;
    for (const bool cached : {true, false}) {
      // 先跑两次预热，再计时。
      for (int warm = 0; warm < 2; warm += 1) {
        render::DrawCursor(window, layout, prefs, scene, false, true, true, assets, cache, pose, dpi, error, cached);
      }
      const long long started = NowUs();
      for (int i = 0; i < kIterations; i += 1) {
        render::DrawCursor(window, layout, prefs, scene, false, true, true, assets, cache, pose, dpi, error, cached);
      }
      const long long elapsed = NowUs() - started;
      (cached ? benchCachedUs : benchComputedUs) = elapsed / kIterations;
    }
  }
  std::printf("{\"kind\":\"halo-check\",\"ok\":%s,\"checks\":%d,\"partChecks\":%d,\"failures\":%d,\"haloCacheBuilds\":%lld,\"benchCachedUs\":%lld,\"benchComputedUs\":%lld,\"detail\":\"%s\"}\n",
              failures == 0 ? "true" : "false", checks, partChecks, failures,
              static_cast<long long>(render::HaloCache().builds), benchCachedUs, benchComputedUs, detail.c_str());
  return failures == 0 ? 0 : 1;
}
int wmain(int argc, wchar_t** argv) {
  bool selfTest = false;
  bool pointerSelfTest = false;
  bool hookProbe = false;
  bool haloCheck = false;
  for (int i = 1; i < argc; i += 1) {
    const std::wstring arg = argv[i];
    if (arg == L"--no-affinity") g_excludeFromCapture = false;
    if (arg == L"--self-test") selfTest = true;
    if (arg == L"--pointer-self-test") pointerSelfTest = true;
    if (arg == L"--hook-probe") hookProbe = true;
    if (arg == L"--halo-check") haloCheck = true;
    if (arg == L"--no-prewarm") g_helper.prewarmDisabled = true;
    if (arg == L"--no-render-key") g_helper.renderKeyDisabled = true;
    if (arg == L"--no-halo-cache") g_helper.haloCacheDisabled = true;
    if (arg.rfind(L"--assets=", 0) == 0) g_helper.assetsDir = arg.substr(9);
    if (arg.rfind(L"--backend=", 0) == 0) g_helper.backend = Narrow(arg.substr(10));
  }
  // 指针保真自检：10,000 组合成事件，只跑产品代码里的队列与状态归约，不建窗口、不装钩子。
  if (pointerSelfTest) return pointer::selftest::Run();
  if (haloCheck) return RunHaloCheck();
  // 身份先读：hook-probe 与正式运行都要用（阶段 1 的诊断事实）。
  g_identity = ReadIdentity();
  {
    wchar_t path[MAX_PATH * 2] = {0};
    const DWORD length = GetModuleFileNameW(nullptr, path, static_cast<DWORD>(sizeof(path) / sizeof(path[0])));
    if (length > 0) g_exePath.assign(path, length);
  }
  if (hookProbe) {
    g_helper.mainThreadId = GetCurrentThreadId();
    MSG priming;
    PeekMessageW(&priming, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
    SetLastError(0);
    HHOOK mh = SetWindowsHookExW(WH_MOUSE_LL, LowLevelMouseProc, GetModuleHandleW(nullptr), 0);
    // 复核第 3 条要求记录"钩子安装返回值 + GetLastError + 线程/消息循环状态"，
    // 所以这里把安装那一刻的错误码原样带出来，而不是只报 true/false。
    const DWORD hookError = mh == nullptr ? GetLastError() : 0;
    MSG msg;
    // pumps 用来证明消息循环一直在转：如果它是死的，"回调数为 0"就不能赖到钩子没送到。
    long pumps = 0;
    const ULONGLONG until = GetTickCount64() + 5000;
    while (GetTickCount64() < until) {
      while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) { TranslateMessage(&msg); DispatchMessageW(&msg); }
      pumps += 1;
      Sleep(10);
    }
    char line[512];
    std::snprintf(line, sizeof(line),
                  "{\"kind\":\"hook-probe\",\"hook\":%s,\"lastError\":%lu,\"thread\":%lu,\"session\":%lu,"
                  "\"integrityRid\":%lld,\"integrity\":\"%s\",\"uiAccess\":%s,\"canObserveInput\":%s,"
                  "\"calls\":%ld,\"seen\":%llu,\"pumps\":%ld}\n",
                  mh != nullptr ? "true" : "false", static_cast<unsigned long>(hookError),
                  static_cast<unsigned long>(g_helper.mainThreadId), static_cast<unsigned long>(g_identity.sessionId),
                  g_identity.integrityRid, IntegrityName(g_identity.integrityRid),
                  g_identity.uiAccess ? "true" : "false",
                  IdentityCanObserveInput(g_identity) ? "true" : "false",
                  g_helper.mouseHookCalls.load(), g_pointerSource.Seen(), pumps);
    std::fwrite(line, 1, std::strlen(line), stdout);
    std::fflush(stdout);
    if (mh != nullptr) UnhookWindowsHookEx(mh);
    return 0;
  }
  if (selfTest) return overlay::RunLayoutSelfTest();
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  g_helper.mainThreadId = GetCurrentThreadId();
  g_helper.startedAtMs = NowMs();
  g_helper.loopPhaseOriginMs = g_helper.startedAtMs;
  g_helper.lastResyncAtMs = g_helper.startedAtMs;
  g_pointerController.Bind(&g_helper.pointer);
  if (!overlay::EnsureWindowClasses()) {
    EmitError("", "INIT_FAILED", "RegisterClassEx failed");
    return 2;
  }
  g_hookThread = CreateThread(nullptr, 0, HookThreadProc, nullptr, 0, &g_hookThreadId);
  for (int i = 0; i < 100 && !g_helper.hookReady.load(); i += 1) Sleep(10);

  // 起手枚举一次拓扑：hello 的 ready 里要带显示器清单（此刻不建任何窗口）。
  {
    std::vector<overlay::MonitorGroup> discovered;
    EnumDisplayMonitors(nullptr, nullptr, overlay::EnumerateProc, reinterpret_cast<LPARAM>(&discovered));
    for (overlay::MonitorGroup& group : discovered) group.edges = overlay::ComputeEdges(group.bounds, group.dpi);
    g_helper.registry.monitors = std::move(discovered);
    g_helper.registry.layoutEpoch = 1;
    g_helper.layoutEpoch = 1;
  }

  // 按键自检：合成两条 MSLLHOOKSTRUCT 喂给**真实钩子回调**，再按主线程的方式从队列归约。
  // 这样 health 里的 mouseSelfTestDown/Up 证明的是"回调 → 队列 → 状态机"整条链路，
  // 不是某个原子量被赋值。自检用独立的状态对象，不污染真实指针状态。
  //
  // 阶段 2 第 3 条：自检的调用次数也**不许**混进 `mouseHookCalls` / `lastHookCallbackAtMs`。
  // 旧实现把这两条合成记录留在健康度里，于是"自检通过"被当成"系统投递正常"的证据。
  {
    g_inSelfTest.store(true, std::memory_order_relaxed);
    MSLLHOOKSTRUCT probe{};
    probe.pt.x = 10;
    probe.pt.y = 10;
    probe.flags = LLMHF_INJECTED;
    animation::PointerState probeState;
    pointer::Controller probeController;
    probeController.Bind(&probeState);
    LowLevelMouseProc(HC_ACTION, WM_LBUTTONDOWN, reinterpret_cast<LPARAM>(&probe));
    pointer::Event event;
    while (g_pointerSource.Pop(event)) probeController.Apply(event);
    g_helper.selfTestPressedAfterDown = probeController.Pressed() ? 1 : 0;
    LowLevelMouseProc(HC_ACTION, WM_LBUTTONUP, reinterpret_cast<LPARAM>(&probe));
    while (g_pointerSource.Pop(event)) probeController.Apply(event);
    pointer::Event merged;
    if (g_pointerSource.TakeCoalescedMove(merged)) probeController.Apply(merged);
    g_helper.selfTestPressedAfterUp = probeController.Pressed() ? 1 : 0;
    // 自检往队列里推的东西不能留在真实队列里：两条边沿已排空，这里再核对一次。
    while (g_pointerSource.Pop(event)) probeController.Apply(event);
    g_inSelfTest.store(false, std::memory_order_relaxed);
  }

  // 角色资源：给了 --assets 才加载；坏资源只降级角色展示，不影响覆盖层与 Esc。
  if (!g_helper.assetsDir.empty()) {
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (!character::Load(g_helper.assetsDir, g_helper.assets)) {
      g_helper.assets.ok = false;
      if (g_helper.assets.error.empty()) g_helper.assets.error = "the character pack could not be loaded";
    }
    g_helper.cache.Configure(&g_helper.assets);
    g_helper.cache.MarkUiThread();  // 之后 UI 线程上的构建会计入 UiBuilds()，预热做好就该不再增长
    // 方案 4.E：一次性片段"播完"的时间以 pack 的 totalMs 为准，状态机不再自带另一套 320/360。
    // 以前 press_in 资源是 570 ms 却在 320 ms 就切走、release 650 ms 在 360 ms 切走，后段根本没播。
    // 上限 1200 ms 只是防坏包把姿势拖成几秒；正常资源都远低于它。
    if (const character::Clip* pressIn = g_helper.assets.Find("press_in")) {
      if (pressIn->totalMs > 0) g_helper.pointer.pressAnimationMs = std::min(1200, pressIn->totalMs);
    }
    if (const character::Clip* release = g_helper.assets.Find("release")) {
      if (release->totalMs > 0) g_helper.pointer.releaseAnimationMs = std::min(1200, release->totalMs);
    }
  }

  RefreshCompanionReason();

  std::thread reader(ReadLoop);
  reader.detach();

  bool running = true;
  MSG message;
  while (running) {
    while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
      if (message.message == WM_QUIT) {
        running = false;
        break;
      }
      if (message.message == kCommandMessage) {
        if (!DrainCommands()) {
          running = false;
          break;
        }
        continue;
      }
      if (message.message == kTopologyMessage) {
        HandleTopologyChange();
        continue;
      }
      if (message.message == kPointerMessage) {
        g_helper.pointerWakePending.store(false);
        // 收到唤醒就归约，不等这一轮末尾：按钮边沿越早进入状态机，点击越早可见。
        DrainPointerEvents(NowMs());
        continue;
      }
      if (message.message == kEscapeMessage) {
        {
          std::lock_guard<std::mutex> lock(g_helper.mutex);
          if (g_helper.phase == Phase::Preparing || g_helper.phase == Phase::Active) g_helper.phase = Phase::Stopping;
        }
        g_helper.stopRequests += 1;
        g_helper.bannerDirty = true;
        // 本地闩锁先于这条事件：即使宿主繁忙，helper 也已经认定这次交互被取消。
        EmitLine(Message("cancelRequested")
                     .Str("scopeId", g_helper.scopeId)
                     .Num("epoch", static_cast<double>(g_helper.epoch))
                     .Str("reason", "physical_escape")
                     .Bool("latch", true)
                     .Done());
        continue;
      }
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
    if (!running) break;

    const long long now = NowMs();
    g_helper.loopIterations.fetch_add(1);
    DrainPointerEvents(now);
    SamplePointer(now);
    // 阶段 2 第 8 条：键盘活动聚合成 typing 反馈（只计数，不读内容）。
    PumpTypingActivity(now);
    // 阶段 3 第 7 条：未呈现的反馈在预算用尽后如实过期，绝不让它无限期霸占姿势。
    {
      const char* expiredReason = nullptr;
      if (g_pointerController.ExpireFeedback(now, expiredReason)) {
        g_helper.feedbackDropped += 1;
        g_helper.feedbackDropReason = expiredReason != nullptr ? expiredReason : "unknown";
        g_helper.cursorDirty = true;
      }
    }
    RefreshCompanionReason();
    // 角色想显示时才值得预热：日常伴随一个角色，控制期间再加横幅。
    if (CursorWindowWanted() || ControlActive()) RequestCharacterPrewarm();

    // 方案 五.5：把这一轮真正要画的资源组固定住，淘汰不许动它们。
    {
      std::vector<std::string> pinned{std::string(kBannerClip)};
      if (CursorWindowWanted()) pinned.push_back(g_helper.cursorClip);
      g_helper.cache.PinGroups(pinned);
    }
    // ---- 四边与横幅：只属于电脑控制 scope ----
    if (ControlActive() && !g_helper.visualSuspended) {
      const bool breathing = g_helper.prefs.decoration && g_helper.prefs.edgeBreathing && !g_helper.prefs.reducedMotion;
      if (g_helper.edgesDirty || (breathing && (g_helper.edgeDueMs < 0 || now >= g_helper.edgeDueMs))) {
        for (overlay::MonitorGroup& group : g_helper.registry.monitors) {
          if (!group.edges.ok) continue;
          DrawEdges(group, now);
        }
        g_helper.edgesDirty = false;
        g_helper.edgeDueMs = breathing ? now + kEdgeIntervalMs : -1;
      }
      // 方案 4.I：先判"这一次到期没有"，再更新展示状态。以前先 UpdateBannerPose 再比较新期限，
      // 每次唤醒都把期限推到未来，横幅的独立换帧定时形同不存在。
      const bool bannerTimed = g_helper.bannerDueMs >= 0 && now >= g_helper.bannerDueMs;
      const bool bannerFrameTimed = g_helper.bannerFrameDueMs >= 0 && now >= g_helper.bannerFrameDueMs;
      UpdateBannerPose(now);
      const bool decorationAnimated =
          g_helper.prefs.decoration && g_helper.prefs.bannerDecoration && !g_helper.prefs.reducedMotion;
      if (g_helper.bannerDirty || bannerTimed || bannerFrameTimed) {
        for (overlay::MonitorGroup& group : g_helper.registry.monitors) {
          if (!group.edges.ok) continue;
          DrawBanner(group, now);
        }
        g_helper.bannerDirty = false;
        g_helper.bannerDueMs = decorationAnimated ? now + kBannerIntervalMs : -1;
      }
    } else {
      g_helper.edgeDueMs = -1;
      g_helper.bannerDueMs = -1;
    }

    // ---- 光标窗口：控制装饰 或 日常伴随 ----
    // 方案 五.3：把"谁在消费指针"告诉钩子。没人看时不再为移动推事件或唤醒主线程。
    const bool inputWanted = CursorWindowWanted() || ControlActive();
    g_pointerWanted.store(inputWanted, std::memory_order_relaxed);
    if (CursorWindowWanted()) {
      // 位置应用限到 125 Hz；绘制与否仍由 cursorDirty / 换帧期限决定（renderKey 再兜一层）。
      const bool positionDue = now - g_helper.lastPositionAtMs >= kPositionIntervalMs;
      POINT pointer = g_helper.pointer.lastPointer;
      if (!g_helper.pointer.hasPointer) pointer = POINT{0, 0};
      if (EnsureCursorWindow(pointer)) {
        // 先判"这一次该不该画"，再更新期限：更新在前会把到期的期限推进到未来，永远等不到下一次。
        const bool poseDue = g_helper.cursorFrameDueMs >= 0 && now >= g_helper.cursorFrameDueMs;
        UpdateCursorPose(now);
        if (g_helper.cursorDirty || poseDue) {
          DrawCursorPixels(now);
          g_helper.cursorDirty = false;
        }
        if (positionDue) {
          PositionCursorWindow(pointer);
          g_helper.lastAppliedPointer = pointer;
          g_helper.lastPositionAtMs = now;
          g_helper.positionUpdates += 1;
        }
      } else {
        g_helper.cursorEnsureFails.fetch_add(1);
      }
    } else if (g_helper.registry.cursor.window != nullptr) {
      overlay::DestroyWindowState(g_helper.registry.cursor);
      g_helper.cursorHasLayout = false;
      g_helper.cursorLayoutDirty = true;
    }

    // ---- 等待：睡到最近一个期限，没有期限就等消息 ----
    animation::Deadlines deadlines;
    if (ControlActive() && !g_helper.visualSuspended) {
      const bool breathing = g_helper.prefs.decoration && g_helper.prefs.edgeBreathing && !g_helper.prefs.reducedMotion;
      if (breathing) deadlines.Add(g_helper.edgeDueMs);
      if (g_helper.prefs.decoration && g_helper.prefs.bannerDecoration && !g_helper.prefs.reducedMotion) {
        deadlines.Add(g_helper.bannerDueMs);
      }
      deadlines.Add(g_helper.bannerFrameDueMs);
    }
    if (CursorWindowWanted()) {
      deadlines.Add(g_helper.cursorFrameDueMs);
      // 阶段 3：有待呈现的反馈就尽快醒来画它，不许它等一个 100 ms 的兜底周期。
      if (g_helper.pointer.feedback.id > 0 && g_helper.pointer.feedback.presentedAtMs < 0) {
        deadlines.Add(now + kDegradedSampleMs);
      }
      // 阶段 2 第 4 条：判定投递异常时按降级采样间隔醒来；健康时完全不启用 16 ms 轮询。
      if (DeliveryDegraded(now)) deadlines.Add(now + kDegradedSampleMs);
      // 位置还没应用完：睡到节流窗口结束，而不是等到 100 ms 兜底。
      const bool positionPending =
          g_helper.pointer.hasPointer && (g_helper.pointer.lastPointer.x != g_helper.lastAppliedPointer.x ||
                                         g_helper.pointer.lastPointer.y != g_helper.lastAppliedPointer.y);
      if (positionPending) deadlines.Add(g_helper.lastPositionAtMs + kPositionIntervalMs);
      // 钩子会立刻投递位置消息；这里的兜底只防止钩子被系统摘掉后位置卡住。
      deadlines.Add(now + kPointerFallbackMs);
    }
    const long long waitMs = deadlines.WaitMs(now, ControlActive() ? kBusyWaitCapMs : kIdleWaitCapMs);
    MsgWaitForMultipleObjectsEx(0, nullptr, static_cast<DWORD>(std::max<long long>(1, waitMs)), QS_ALLINPUT, 0);
  }

  g_helper.shuttingDown.store(true);
  if (g_hookThread != nullptr) {
    PostThreadMessageW(g_hookThreadId, WM_QUIT, 0, 0);
    WaitForSingleObject(g_hookThread, 2000);
    CloseHandle(g_hookThread);
    g_hookThread = nullptr;
  }
  DestroyDisplayOverlays();
  overlay::DestroyWindowState(g_helper.registry.cursor);
  g_helper.prewarm.Shutdown();  // 先停线程，再动缓存与资产
  g_helper.cache.Clear();
  EmitLine(Message("closed")
               .Str("requestId", g_shutdownRequestId)
               .Num("windows", 0)
               .Raw("counts", CountsJson(g_helper.registry.Statistics()))
               .Num("frames", static_cast<double>(g_helper.frames.load()))
               .Bool("hookRemoved", g_hook == nullptr)
               .Num("uptimeMs", static_cast<double>(NowMs() - g_helper.startedAtMs))
               .Done());
  return 0;
}
