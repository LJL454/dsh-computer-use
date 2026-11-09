// DSH 交互提示覆盖层 —— O0 原型（方案 4.14.1 / 4.17.3 / PR08）。
//
// 这个程序**不**接入插件、不认识工具调用，只回答 O0 阶段的几个二选一问题：
//
//   1. 每台显示器一个 `WS_POPUP` + `WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW |
//      WS_EX_NOACTIVATE` 的置顶窗口，能不能在不抢焦点、不挡鼠标的情况下盖住整屏？
//   2. 一条 D2D 渲染路径能不能同时画出四边向内渐隐的渐变与顶部两段文字（含预乘 alpha）？
//   3. `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` 在这台机器上会不会成功、截图里到底
//      有没有覆盖层？
//   4. 专用线程上的 `WH_KEYBOARD_LL` 能不能只对真实 Esc 置位一个原子闩锁，而忽略注入事件？
//   5. 每屏的物理矩形、DPI 与虚拟桌面原点（可能是负坐标）会不会把窗口放错地方？
//
// 结果写一份 JSON 报告（`--report <path>`），字段都是"实测到的事实"：每个显示器一个窗口、
// affinity 的返回值、hook 的安装结果、收到的 Esc 次数、每帧耗时。没有测到的就写 null。
//
// 两种渲染后端：
//   --backend=layered       D2D 画进 32 位预乘 alpha DIB，再 UpdateLayeredWindow（回退路径）
//   --backend=composition   C++/WinRT DispatcherQueue + Compositor + DesktopWindowTarget
//                           （`/DDSH_WITH_COMPOSITION` 编译时可用才注册；否则报告 unsupported-build）
//
//   indicator-probe.exe --backend=layered --duration=6 --report=out.json
//
// 编译：native/indicator-probe/build.ps1（调用 vcvars64 + cl）。

#define NOMINMAX
#include <windows.h>
#include <windowsx.h>
#include <d2d1.h>
#include <d2d1_1.h>
#include <dwrite.h>
#include <shcore.h>
#include <shellscalingapi.h>
#include <wrl/client.h>

#include <atomic>
#include <chrono>
#include <cstdio>
#include <string>
#include <algorithm>
#include <vector>

#ifdef DSH_WITH_COMPOSITION
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.System.h>
#include <winrt/Windows.UI.Composition.h>
#include <winrt/Windows.UI.Composition.Desktop.h>
#include <windows.ui.composition.interop.h>
#include <DispatcherQueue.h>
#include <d2d1_1.h>
#endif

using Microsoft::WRL::ComPtr;

namespace {

/// 程序名，出现在窗口标题与报告里。
constexpr wchar_t kWindowClass[] = L"DshIndicatorProbe";
constexpr wchar_t kWindowTitle[] = L"DSH indicator probe";

/// 命令行参数。
struct Options {
  std::wstring backend = L"layered";
  int durationMs = 4000;
  std::wstring report;
  bool keepAlive = false;
  /// 是否请求截图排除。O0 用 A/B 两次运行证明 affinity 真的生效：同一套视觉，只差这一下。
  bool excludeFromCapture = true;
};

/// 一台显示器。
struct Monitor {
  HMONITOR handle = nullptr;
  RECT bounds{};      // 物理像素，虚拟桌面坐标（可能是负的）
  UINT dpi = 96;
  bool primary = false;
  HWND window = nullptr;
  /// 建窗时记下的句柄值：报告在窗口销毁之后才写，不能那时再去读 `window`。
  unsigned long long reportedHwnd = 0;
  bool affinityOk = false;
  DWORD affinityError = 0;
  std::wstring deviceName;
};

/// 一次命中测试：覆盖层盖住的点上，`WindowFromPoint` 究竟返回谁。
struct HitTestSample {
  int x = 0;
  int y = 0;
  unsigned long long hit = 0;
  bool hitIsOverlay = false;
};

/// 全程共享的状态。
struct State {
  std::atomic<long> escCount{0};
  std::atomic<long> escIgnoredInjected{0};
  std::atomic<bool> latch{false};
  std::atomic<long> frames{0};
  std::atomic<long> hookReady{0};
  std::atomic<long> hookFailed{0};
  std::vector<Monitor> monitors;
  bool dpiAware = false;
  bool hookInstalled = false;
  std::wstring backend;
  std::wstring error;
  long long firstPresentMs = -1;
  /// 覆盖层出现前后的前台窗口：两者相同才说明"没有抢焦点"。
  unsigned long long foregroundBefore = 0;
  unsigned long long foregroundAfter = 0;
  std::vector<HitTestSample> hitTests;
  /// 自检结果：把合成的 KBDLLHOOKSTRUCT 直接喂给钩子回调，验证过滤规则本身。
  bool selfTestSent = false;
  long selfTestInjectedIgnored = 0;
  long selfTestRealCounted = 0;
  bool selfTestLatch = false;
};

State g_state;
bool g_excludeFromCapture = true;

long long NowMs() {
  using namespace std::chrono;
  return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

/// 四边渐变与横幅的绘制参数（与方案 4.14.2 的建议起始值一致）。
struct VisualParams {
  float edgeDip = 20.0f;     // 基础厚度
  float peakDip = 32.0f;     // 峰值厚度
  float alphaLow = 0.18f;
  float alphaHigh = 0.38f;
  float periodMs = 3000.0f;
};

VisualParams g_visual;

/// 把 DIP 换算成像素。每屏用自己的 DPI，避免混屏时厚度不一致。
float Px(const Monitor& monitor, float dip) {
  return dip * static_cast<float>(monitor.dpi) / 96.0f;
}

/// 当前呼吸相位（0..1）。
float Phase(long long nowMs) {
  const double t = static_cast<double>(nowMs) / g_visual.periodMs;
  const double twoPi = 6.283185307179586;
  return static_cast<float>((1.0 - std::cos(twoPi * t)) / 2.0);
}

/* --------------------------------------------------------------- drawing -- */

/// 一台显示器的绘制上下文（layered 后端）。
struct LayeredSurface {
  HDC memoryDc = nullptr;
  HBITMAP bitmap = nullptr;
  HGDIOBJ oldBitmap = nullptr;
  void* pixels = nullptr;
  int width = 0;
  int height = 0;
  ComPtr<ID2D1Factory> factory;
  ComPtr<ID2D1DCRenderTarget> target;
  ComPtr<IDWriteFactory> dwrite;
  ComPtr<IDWriteTextFormat> statusFormat;
  ComPtr<IDWriteTextFormat> cancelFormat;
};

std::vector<LayeredSurface> g_surfaces;

/// 建一台显示器的预乘 alpha DIB 与 D2D 目标。
bool CreateLayeredSurface(Monitor& monitor, LayeredSurface& surface) {
  surface.width = monitor.bounds.right - monitor.bounds.left;
  surface.height = monitor.bounds.bottom - monitor.bounds.top;
  BITMAPINFO info{};
  info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  info.bmiHeader.biWidth = surface.width;
  info.bmiHeader.biHeight = -surface.height;  // top-down
  info.bmiHeader.biPlanes = 1;
  info.bmiHeader.biBitCount = 32;
  info.bmiHeader.biCompression = BI_RGB;
  HDC screen = GetDC(nullptr);
  surface.memoryDc = CreateCompatibleDC(screen);
  ReleaseDC(nullptr, screen);
  void* bits = nullptr;
  surface.bitmap = CreateDIBSection(surface.memoryDc, &info, DIB_RGB_COLORS, &bits, nullptr, 0);
  if (surface.bitmap == nullptr || bits == nullptr) return false;
  surface.pixels = bits;
  surface.oldBitmap = SelectObject(surface.memoryDc, surface.bitmap);

  D2D1_RENDER_TARGET_PROPERTIES props = D2D1::RenderTargetProperties(
      D2D1_RENDER_TARGET_TYPE_DEFAULT,
      D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED),
      static_cast<float>(monitor.dpi), static_cast<float>(monitor.dpi));
  if (FAILED(D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, surface.factory.GetAddressOf()))) return false;
  if (FAILED(surface.factory->CreateDCRenderTarget(&props, surface.target.GetAddressOf()))) return false;
  RECT dcRect{0, 0, surface.width, surface.height};
  if (FAILED(surface.target->BindDC(surface.memoryDc, &dcRect))) return false;

  if (FAILED(DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory),
                                 reinterpret_cast<IUnknown**>(surface.dwrite.GetAddressOf())))) return false;
  // 文字用固定字重与字号：O0 只验证"画得出来、看得清、不抢焦点"，不做排版系统。
  surface.dwrite->CreateTextFormat(L"Segoe UI", nullptr, DWRITE_FONT_WEIGHT_SEMI_BOLD,
                                   DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_STRETCH_NORMAL, 16.0f, L"en-us",
                                   surface.statusFormat.GetAddressOf());
  surface.dwrite->CreateTextFormat(L"Segoe UI", nullptr, DWRITE_FONT_WEIGHT_NORMAL,
                                   DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_STRETCH_NORMAL, 14.0f, L"en-us",
                                   surface.cancelFormat.GetAddressOf());
  return true;
}

/// 画一条向内渐隐的边：靠屏幕边界处有颜色，向内部 alpha 归零。
void DrawEdge(ID2D1DCRenderTarget* target, const D2D1_RECT_F& rect, D2D1_GRADIENT_STOP* stops, UINT stopCount,
              bool horizontal) {
  ComPtr<ID2D1GradientStopCollection> collection;
  target->CreateGradientStopCollection(stops, stopCount, D2D1_GAMMA_2_2, D2D1_EXTEND_MODE_CLAMP,
                                       collection.GetAddressOf());
  ComPtr<ID2D1LinearGradientBrush> brush;
  D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES props{};
  if (horizontal) {
    props.startPoint = D2D1::Point2F(rect.left, rect.top);
    props.endPoint = D2D1::Point2F(rect.right, rect.top);
  } else {
    props.startPoint = D2D1::Point2F(rect.left, rect.top);
    props.endPoint = D2D1::Point2F(rect.left, rect.bottom);
  }
  target->CreateLinearGradientBrush(props, D2D1::BrushProperties(), collection.Get(), brush.GetAddressOf());
  target->FillRectangle(rect, brush.Get());
}

/// 画一帧：四边渐变 + 顶部两段文字。
void RenderFrame(LayeredSurface& surface, Monitor& monitor, long long nowMs) {
  ID2D1DCRenderTarget* target = surface.target.Get();
  target->BeginDraw();
  target->Clear(D2D1::ColorF(0, 0.0f));
  const float phase = Phase(nowMs);
  const float thickness = Px(monitor, g_visual.edgeDip + (g_visual.peakDip - g_visual.edgeDip) * phase);
  const float alpha = g_visual.alphaLow + (g_visual.alphaHigh - g_visual.alphaLow) * phase;
  const float width = static_cast<float>(surface.width);
  const float height = static_cast<float>(surface.height);
  // 顶边：从顶边向下的 alpha 梯度。
  D2D1_GRADIENT_STOP topStops[2] = {
      {0.0f, D2D1::ColorF(0.32f, 0.62f, 1.0f, alpha)},
      {1.0f, D2D1::ColorF(0.32f, 0.62f, 1.0f, 0.0f)},
  };
  DrawEdge(target, D2D1::RectF(0, 0, width, thickness), topStops, 2, false);
  // 底边：从底边向上的 alpha 梯度（用翻转的 stop 顺序）。
  D2D1_GRADIENT_STOP bottomStops[2] = {
      {0.0f, D2D1::ColorF(0.32f, 0.62f, 1.0f, 0.0f)},
      {1.0f, D2D1::ColorF(0.32f, 0.62f, 1.0f, alpha)},
  };
  DrawEdge(target, D2D1::RectF(0, height - thickness, width, height), bottomStops, 2, false);
  // 左边与右边。
  D2D1_GRADIENT_STOP leftStops[2] = {
      {0.0f, D2D1::ColorF(0.32f, 0.62f, 1.0f, alpha)},
      {1.0f, D2D1::ColorF(0.32f, 0.62f, 1.0f, 0.0f)},
  };
  DrawEdge(target, D2D1::RectF(0, 0, thickness, height), leftStops, 2, true);
  D2D1_GRADIENT_STOP rightStops[2] = {
      {0.0f, D2D1::ColorF(0.32f, 0.62f, 1.0f, 0.0f)},
      {1.0f, D2D1::ColorF(0.32f, 0.62f, 1.0f, alpha)},
  };
  DrawEdge(target, D2D1::RectF(width - thickness, 0, width, height), rightStops, 2, true);

  // 横幅：顶部居中，深色底板 + 两段固定文字。
  const float bannerWidth = 420.0f;
  const float bannerHeight = 38.0f;
  const float bannerLeft = (width - bannerWidth) / 2.0f;
  ComPtr<ID2D1SolidColorBrush> plate;
  target->CreateSolidColorBrush(D2D1::ColorF(0.06f, 0.09f, 0.16f, 0.86f), plate.GetAddressOf());
  target->FillRoundedRectangle(D2D1::RoundedRect(D2D1::RectF(bannerLeft, 8.0f, bannerLeft + bannerWidth, 8.0f + bannerHeight), 10.0f, 10.0f), plate.Get());
  ComPtr<ID2D1SolidColorBrush> text;
  target->CreateSolidColorBrush(D2D1::ColorF(0.96f, 0.97f, 1.0f, 1.0f), text.GetAddressOf());
  if (surface.statusFormat) {
    target->DrawText(L"Agent is using your computer", 28, surface.statusFormat.Get(),
                      D2D1::RectF(bannerLeft + 16.0f, 14.0f, bannerLeft + bannerWidth - 130.0f, 8.0f + bannerHeight), text.Get());
  }
  if (surface.cancelFormat) {
    target->DrawText(L"Esc to cancel", 13, surface.cancelFormat.Get(),
                      D2D1::RectF(bannerLeft + bannerWidth - 118.0f, 16.0f, bannerLeft + bannerWidth - 12.0f, 8.0f + bannerHeight), text.Get());
  }
  target->EndDraw();
  g_state.frames.fetch_add(1);
  if (g_state.firstPresentMs < 0) g_state.firstPresentMs = NowMs();
}

/* ---------------------------------------------------------------- window -- */

LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
  switch (message) {
    case WM_NCHITTEST:
      // 显式穿透：即使是分层窗口，也不让命中测试停在覆盖层上。
      return HTTRANSPARENT;
    case WM_MOUSEACTIVATE:
      return MA_NOACTIVATE;
    case WM_ERASEBKGND:
      return 1;
    default:
      return DefWindowProcW(hwnd, message, wParam, lParam);
  }
}

/// 注册窗口类（每个进程一次）。
bool RegisterOverlayClass(HINSTANCE instance) {
  WNDCLASSEXW cls{};
  cls.cbSize = sizeof(cls);
  cls.lpfnWndProc = WindowProc;
  cls.hInstance = instance;
  cls.hCursor = LoadCursor(nullptr, IDC_ARROW);
  cls.lpszClassName = kWindowClass;
  cls.style = CS_HREDRAW | CS_VREDRAW;
  return RegisterClassExW(&cls) != 0 || GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
}

/// 为一台显示器建一个不激活、置顶、鼠标穿透的分层窗口。
HWND CreateOverlayWindow(HINSTANCE instance, Monitor& monitor) {
  const int width = monitor.bounds.right - monitor.bounds.left;
  const int height = monitor.bounds.bottom - monitor.bounds.top;
  HWND hwnd = CreateWindowExW(
      WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST,
      kWindowClass, kWindowTitle, WS_POPUP,
      monitor.bounds.left, monitor.bounds.top, width, height,
      nullptr, nullptr, instance, nullptr);
  if (hwnd == nullptr) return nullptr;
  // 不激活的窗口定位：SWP_NOACTIVATE 维持置顶而不夺焦点。
  SetWindowPos(hwnd, HWND_TOPMOST, monitor.bounds.left, monitor.bounds.top, width, height,
               SWP_NOACTIVATE | SWP_SHOWWINDOW);
  ShowWindow(hwnd, SW_SHOWNOACTIVATE);
  monitor.window = hwnd;
  monitor.reportedHwnd = reinterpret_cast<unsigned long long>(hwnd);
  return hwnd;
}

/* ------------------------------------------------------------------ hook -- */

HHOOK g_hook = nullptr;
HANDLE g_hookThread = nullptr;
DWORD g_hookThreadId = 0;

/// 低级键盘钩子：只看 Esc，只信真实事件。
LRESULT CALLBACK LowLevelKeyboardProc(int code, WPARAM wParam, LPARAM lParam) {
  if (code == HC_ACTION) {
    const auto* info = reinterpret_cast<KBDLLHOOKSTRUCT*>(lParam);
    if (info != nullptr && info->vkCode == VK_ESCAPE && (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN)) {
      // 方案 4.16.1：注入事件不触发取消（否则插件自己发的 Esc 会中断自己）。
      if ((info->flags & LLKHF_INJECTED) != 0) {
        g_state.escIgnoredInjected.fetch_add(1);
      } else {
        g_state.escCount.fetch_add(1);
        g_state.latch.store(true);
      }
    }
  }
  return CallNextHookEx(g_hook, code, wParam, lParam);
}

/// 钩子线程：装钩子、跑消息循环、退出时装回。
DWORD WINAPI HookThreadProc(LPVOID) {
  g_hook = SetWindowsHookExW(WH_KEYBOARD_LL, LowLevelKeyboardProc, GetModuleHandleW(nullptr), 0);
  if (g_hook == nullptr) {
    g_state.hookFailed.store(1);
    return 1;
  }
  g_state.hookInstalled = true;
  g_state.hookReady.store(1);
  MSG message;
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  UnhookWindowsHookEx(g_hook);
  g_hook = nullptr;
  return 0;
}

}  // namespace

/* -------------------------------------------------------------------- main -- */

namespace {

/// 解析 `--key=value`。
Options ParseOptions(int argc, wchar_t** argv) {
  Options options;
  for (int i = 1; i < argc; i += 1) {
    const std::wstring arg = argv[i];
    const auto eq = arg.find(L'=');
    const std::wstring key = eq == std::wstring::npos ? arg : arg.substr(0, eq);
    const std::wstring value = eq == std::wstring::npos ? L"" : arg.substr(eq + 1);
    if (key == L"--backend") options.backend = value;
    else if (key == L"--duration") options.durationMs = _wtoi(value.c_str());
    else if (key == L"--report") options.report = value;
    else if (key == L"--keep-alive") options.keepAlive = true;
    else if (key == L"--no-affinity") options.excludeFromCapture = false;
  }
  if (options.durationMs <= 0) options.durationMs = 4000;
  return options;
}

/// 显示器枚举回调：记录物理矩形与 DPI。
BOOL CALLBACK MonitorProc(HMONITOR handle, HDC, LPRECT, LPARAM) {
  MONITORINFOEXW info{};
  info.cbSize = sizeof(info);
  if (!GetMonitorInfoW(handle, &info)) return TRUE;
  Monitor monitor;
  monitor.handle = handle;
  monitor.bounds = info.rcMonitor;
  monitor.primary = (info.dwFlags & MONITORINFOF_PRIMARY) != 0;
  monitor.deviceName = info.szDevice;
  UINT dpiX = 96;
  UINT dpiY = 96;
  if (SUCCEEDED(GetDpiForMonitor(handle, MDT_EFFECTIVE_DPI, &dpiX, &dpiY))) monitor.dpi = dpiX;
  g_state.monitors.push_back(monitor);
  return TRUE;
}

/// 系统版本（RtlGetVersion 不受兼容性清单影响）。
std::wstring WindowsBuild() {
  using RtlGetVersionFn = LONG(WINAPI*)(PRTL_OSVERSIONINFOW);
  HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  if (ntdll == nullptr) return L"unknown";
  const auto fn = reinterpret_cast<RtlGetVersionFn>(GetProcAddress(ntdll, "RtlGetVersion"));
  if (fn == nullptr) return L"unknown";
  RTL_OSVERSIONINFOW info{};
  info.dwOSVersionInfoSize = sizeof(info);
  if (fn(&info) != 0) return L"unknown";
  wchar_t buffer[64];
  swprintf_s(buffer, L"%lu.%lu.%lu", info.dwMajorVersion, info.dwMinorVersion, info.dwBuildNumber);
  return buffer;
}

/// JSON 转义（只处理报告里会出现的字符）。
std::wstring JsonEscape(const std::wstring& text) {
  std::wstring out;
  for (wchar_t ch : text) {
    switch (ch) {
      case L'"': out += L"\\\""; break;
      case L'\\': out += L"\\\\"; break;
      case L'\n': out += L"\\n"; break;
      case L'\r': out += L"\\r"; break;
      case L'\t': out += L"\\t"; break;
      default:
        if (ch < 0x20) {
          wchar_t buffer[8];
          swprintf_s(buffer, L"\\u%04x", static_cast<unsigned>(ch));
          out += buffer;
        } else {
          out += ch;
        }
    }
  }
  return out;
}

/// 把宽字符串写成 UTF-8。
std::string ToUtf8(const std::wstring& text) {
  if (text.empty()) return {};
  const int size = WideCharToMultiByte(CP_UTF8, 0, text.c_str(), -1, nullptr, 0, nullptr, nullptr);
  std::string out(static_cast<size_t>(size > 0 ? size - 1 : 0), '\0');
  if (size > 1) WideCharToMultiByte(CP_UTF8, 0, text.c_str(), -1, out.data(), size, nullptr, nullptr);
  return out;
}

/// 写报告：一台显示器一段，字段是"实测到的事实"。
bool WriteReport(const Options& options, const std::wstring& path) {
  std::wstring json;
  json += L"{\n";
  json += L"  \"schema\": 1,\n";
  json += L"  \"backend\": \"" + JsonEscape(g_state.backend) + L"\",\n";
  json += L"  \"excludeFromCapture\": " + std::wstring(g_excludeFromCapture ? L"true" : L"false") + L",\n";
  json += L"  \"windowsBuild\": \"" + JsonEscape(WindowsBuild()) + L"\",\n";
  json += L"  \"dpiAware\": " + std::wstring(g_state.dpiAware ? L"true" : L"false") + L",\n";
  json += L"  \"monitors\": " + std::to_wstring(g_state.monitors.size()) + L",\n";
  json += L"  \"hookInstalled\": " + std::wstring(g_state.hookInstalled ? L"true" : L"false") + L",\n";
  json += L"  \"hookReady\": " + std::to_wstring(g_state.hookReady.load()) + L",\n";
  json += L"  \"hookFailed\": " + std::to_wstring(g_state.hookFailed.load()) + L",\n";
  json += L"  \"escCount\": " + std::to_wstring(g_state.escCount.load()) + L",\n";
  json += L"  \"escIgnoredInjected\": " + std::to_wstring(g_state.escIgnoredInjected.load()) + L",\n";
  json += L"  \"frames\": " + std::to_wstring(g_state.frames.load()) + L",\n";
  json += L"  \"firstPresentMs\": " + std::to_wstring(g_state.firstPresentMs) + L",\n";
  json += L"  \"foregroundBefore\": " + std::to_wstring(g_state.foregroundBefore) + L",\n";
  json += L"  \"foregroundAfter\": " + std::to_wstring(g_state.foregroundAfter) + L",\n";
  json += L"  \"focusUnchanged\": " + std::wstring(g_state.foregroundBefore == g_state.foregroundAfter ? L"true" : L"false") + L",\n";
  json += L"  \"selfTest\": { \"injectedIgnored\": " + std::to_wstring(g_state.selfTestInjectedIgnored) + L", \"latchAfterInjected\": " + std::wstring(g_state.selfTestLatch ? L"true" : L"false") + L", \"realCounted\": " + std::to_wstring(g_state.selfTestRealCounted) + L" },\n";
  json += L"  \"hitTestOverlayHits\": " + std::to_wstring(
      std::count_if(g_state.hitTests.begin(), g_state.hitTests.end(), [](const HitTestSample& one) { return one.hitIsOverlay; })) + L",\n";
  json += L"  \"hitTests\": [";
  for (size_t i = 0; i < g_state.hitTests.size(); i += 1) {
    const HitTestSample& sample = g_state.hitTests[i];
    json += L" { \"x\": " + std::to_wstring(sample.x) + L", \"y\": " + std::to_wstring(sample.y)
            + L", \"hit\": " + std::to_wstring(sample.hit)
            + L", \"isOverlay\": " + (sample.hitIsOverlay ? L"true" : L"false") + L" }"
            + (i + 1 < g_state.hitTests.size() ? L"," : L"");
  }
  json += L" ],\n";
  json += L"  \"error\": \"" + JsonEscape(g_state.error) + L"\",\n";
  json += L"  \"windows\": [\n";
  for (size_t i = 0; i < g_state.monitors.size(); i += 1) {
    const Monitor& monitor = g_state.monitors[i];
    json += L"    { \"device\": \"" + JsonEscape(monitor.deviceName) + L"\""
            + L", \"x\": " + std::to_wstring(monitor.bounds.left)
            + L", \"y\": " + std::to_wstring(monitor.bounds.top)
            + L", \"width\": " + std::to_wstring(monitor.bounds.right - monitor.bounds.left)
            + L", \"height\": " + std::to_wstring(monitor.bounds.bottom - monitor.bounds.top)
            + L", \"dpi\": " + std::to_wstring(monitor.dpi)
            + L", \"primary\": " + (monitor.primary ? L"true" : L"false")
            + L", \"hwnd\": " + std::to_wstring(monitor.reportedHwnd)
            + L", \"affinityOk\": " + (monitor.affinityOk ? L"true" : L"false")
            + L", \"affinityError\": " + std::to_wstring(monitor.affinityError)
            + L" }" + (i + 1 < g_state.monitors.size() ? L"," : L"") + L"\n";
  }
  json += L"  ]\n}\n";

  if (!path.empty()) {
    FILE* file = nullptr;
    if (_wfopen_s(&file, path.c_str(), L"wb") != 0 || file == nullptr) return false;
    const std::string utf8 = ToUtf8(json);
    fwrite(utf8.data(), 1, utf8.size(), file);
    fclose(file);
  }
  const std::string utf8 = ToUtf8(json);
  fwrite(utf8.data(), 1, utf8.size(), stdout);
  return true;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  const Options options = ParseOptions(argc, argv);
  g_state.backend = options.backend;
  g_excludeFromCapture = options.excludeFromCapture;

  // Per-Monitor V2：每屏用自己的 DPI，窗口与视觉尺寸都按物理像素摆放。
  g_state.dpiAware = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) != FALSE;

  HINSTANCE instance = GetModuleHandleW(nullptr);
  if (!RegisterOverlayClass(instance)) {
    g_state.error = L"RegisterClassEx failed";
    WriteReport(options, options.report);
    return 2;
  }
  EnumDisplayMonitors(nullptr, nullptr, MonitorProc, 0);
  if (g_state.monitors.empty()) {
    g_state.error = L"no monitors were enumerated";
    WriteReport(options, options.report);
    return 3;
  }

  g_surfaces.resize(g_state.monitors.size());
  // 覆盖层出现之前的焦点，用于证明"它不抢焦点"。
  g_state.foregroundBefore = reinterpret_cast<unsigned long long>(GetForegroundWindow());
  for (size_t i = 0; i < g_state.monitors.size(); i += 1) {
    Monitor& monitor = g_state.monitors[i];
    if (CreateOverlayWindow(instance, monitor) == nullptr) {
      g_state.error = L"CreateWindowEx failed";
      continue;
    }
    // 截图排除：调用成功只说明系统接受了请求，是否真的排除由外部截图验证。
    monitor.affinityOk = options.excludeFromCapture && SetWindowDisplayAffinity(monitor.window, WDA_EXCLUDEFROMCAPTURE) != FALSE;
    monitor.affinityError = monitor.affinityOk ? 0 : GetLastError();
    if (g_state.backend == L"layered") {
      if (!CreateLayeredSurface(monitor, g_surfaces[i])) g_state.error = L"CreateLayeredSurface failed";
    }
  }

  // 钩子放在专用线程：渲染卡住也不能挡住键盘事件。
  g_hookThread = CreateThread(nullptr, 0, HookThreadProc, nullptr, 0, &g_hookThreadId);
  for (int i = 0; i < 100 && g_state.hookReady.load() == 0 && g_state.hookFailed.load() == 0; i += 1) Sleep(10);

  // 过滤规则自检（不需要真的有人按键，也不依赖 SendInput 的权限）：
  // 合成两条 KBDLLHOOKSTRUCT 直接喂给同一个回调 —— 带 LLKHF_INJECTED 的必须被忽略且不置位闩锁，
  // 不带该位的必须计一次并置位。这样"注入 Esc 不中断自己"这条规则在 O0 就有确定结论。
  {
    KBDLLHOOKSTRUCT injected{};
    injected.vkCode = VK_ESCAPE;
    injected.flags = LLKHF_INJECTED;
    KBDLLHOOKSTRUCT real{};
    real.vkCode = VK_ESCAPE;
    real.flags = 0;
    g_state.selfTestSent = true;
    LowLevelKeyboardProc(HC_ACTION, WM_KEYDOWN, reinterpret_cast<LPARAM>(&injected));
    g_state.selfTestInjectedIgnored = g_state.escIgnoredInjected.load();
    g_state.selfTestLatch = g_state.latch.load();
    LowLevelKeyboardProc(HC_ACTION, WM_KEYDOWN, reinterpret_cast<LPARAM>(&real));
    g_state.selfTestRealCounted = g_state.escCount.load();
    // 自检结束了，把闩锁清掉，免得影响后面的真实运行。
    g_state.latch.store(false);
    g_state.escCount.store(0);
    g_state.escIgnoredInjected.store(0);
  }

  const long long started = NowMs();
  MSG message;
  bool sampled = false;
  while (NowMs() - started < options.durationMs || options.keepAlive) {
    if (g_state.backend == L"layered") {
      const long long now = NowMs();
      for (size_t i = 0; i < g_state.monitors.size(); i += 1) {
        LayeredSurface& surface = g_surfaces[i];
        if (surface.target == nullptr || g_state.monitors[i].window == nullptr) continue;
        RenderFrame(surface, g_state.monitors[i], now);
        POINT source{0, 0};
        SIZE size{surface.width, surface.height};
        POINT destination{g_state.monitors[i].bounds.left, g_state.monitors[i].bounds.top};
        BLENDFUNCTION blend{AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
        UpdateLayeredWindow(g_state.monitors[i].window, nullptr, &destination, &size, surface.memoryDc, &source, 0, &blend, ULW_ALPHA);
      }
    }
    while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
    // 首帧之后做一次命中测试与焦点复核：覆盖层盖住的那些点上，`WindowFromPoint` 必须返回
    // 下面的窗口 —— 这是"鼠标穿透"的可测版本（不是靠 WS_EX_TRANSPARENT 这个名字）。
    if (!sampled && g_state.frames.load() > 2) {
      sampled = true;
      for (const Monitor& monitor : g_state.monitors) {
        if (monitor.window == nullptr) continue;
        const int cx = (monitor.bounds.left + monitor.bounds.right) / 2;
        const int cy = (monitor.bounds.top + monitor.bounds.bottom) / 2;
        const int points[5][2] = {
            {cx, cy},                                                   // 屏幕中央
            {cx, monitor.bounds.top + 24},                              // 横幅所在
            {monitor.bounds.left + 8, cy},                              // 左边光带
            {monitor.bounds.right - 8, cy},                             // 右边光带
            {cx, monitor.bounds.bottom - 8},                            // 底边光带
        };
        for (const auto& point : points) {
          POINT target{point[0], point[1]};
          const HWND hit = WindowFromPoint(target);
          HitTestSample sample;
          sample.x = point[0];
          sample.y = point[1];
          sample.hit = reinterpret_cast<unsigned long long>(hit);
          sample.hitIsOverlay = hit == monitor.window;
          g_state.hitTests.push_back(sample);
        }
      }
      g_state.foregroundAfter = reinterpret_cast<unsigned long long>(GetForegroundWindow());
    }
    Sleep(16);
  }

  for (Monitor& monitor : g_state.monitors) {
    if (monitor.window != nullptr) DestroyWindow(monitor.window);
    monitor.window = nullptr;
  }
  for (LayeredSurface& surface : g_surfaces) {
    if (surface.memoryDc != nullptr && surface.oldBitmap != nullptr) SelectObject(surface.memoryDc, surface.oldBitmap);
    if (surface.bitmap != nullptr) DeleteObject(surface.bitmap);
    if (surface.memoryDc != nullptr) DeleteDC(surface.memoryDc);
    surface.target.Reset();
    surface.factory.Reset();
  }
  if (g_hookThread != nullptr) {
    PostThreadMessageW(g_hookThreadId, WM_QUIT, 0, 0);
    WaitForSingleObject(g_hookThread, 2000);
    CloseHandle(g_hookThread);
    g_hookThread = nullptr;
  }

  WriteReport(options, options.report);
  return g_state.error.empty() ? 0 : 4;
}
