// 覆盖层窗口登记表（方案 3.4 / 7.1）。
//
// 1.50.1 把"显示器"和"窗口"当成同一件事：每个显示器一个整屏 HWND，`monitors.size()` 就是窗口数。
// 现在每个显示器有 5 个窗口（四条边 + 横幅），全局最多 1 个光标窗口，窗口数量必须**分开统计**：
// 已创建、具备有效表面、可见、最近一次呈现成功，各自有数。
//
// 登记表还负责三件以前散在 main 里的事：
//   - 每个窗口的 CreateWindow / CreateSurface / UpdateLayeredWindow / SetWindowDisplayAffinity
//     返回值都逐窗核对，失败的那一个窗口单独记状态，不再拿"显示器数量"冒充健康；
//   - 捕获暂停/恢复、拓扑重建、退出清理都从这张表枚举；
//   - 每个窗口带 generation 与 layoutEpoch，恢复时只对仍属于当前代次的窗口执行。
#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <d2d1.h>
#include <wrl/client.h>

#include <string>
#include <vector>

#include "banner-theme.h"
#include "overlay-layout.h"

namespace overlay {

using Microsoft::WRL::ComPtr;

/// 一个覆盖窗口的全部状态。失败时如实记录在哪一步失败的。
struct WindowState {
  Kind kind = Kind::TopEdge;
  int monitorIndex = -1;
  HWND window = nullptr;
  RECT rect{};
  bool created = false;
  bool surfaceReady = false;
  bool presentOk = false;
  bool visible = false;
  /// -2 未尝试，-1 请求失败，0 已请求（不代表系统一定排除成功 —— 另外记录实际值）。
  int captureAffinity = -2;
  DWORD captureAffinityResult = 0;
  HRESULT lastPresentResult = E_FAIL;
  /// 表面（像素 DIB）。
  HDC memoryDc = nullptr;
  HBITMAP bitmap = nullptr;
  HGDIOBJ oldBitmap = nullptr;
  void* pixels = nullptr;
  int widthPx = 0;
  int heightPx = 0;
  /// 只有横幅需要 D2D（文字与主题几何）；边条与光标是纯 CPU 掩码。
  ComPtr<ID2D1DCRenderTarget> target;
  banner::Resources bannerResources;
  long layoutEpoch = -1;
  long long lastPresentMs = 0;

  bool Healthy() const { return created && surfaceReady && presentOk; }
};

/// 一台显示器及其五个窗口。
struct MonitorGroup {
  HMONITOR handle = nullptr;
  RECT bounds{};
  UINT dpi = 96;
  bool primary = false;
  std::wstring device;
  Edges edges;
  WindowState top;
  WindowState bottom;
  WindowState left;
  WindowState right;
  WindowState banner;

  WindowState* KindWindow(Kind kind) {
    switch (kind) {
      case Kind::TopEdge: return &top;
      case Kind::BottomEdge: return &bottom;
      case Kind::LeftEdge: return &left;
      case Kind::RightEdge: return &right;
      case Kind::Banner: return &banner;
      default: return nullptr;
    }
  }
};

/// 统计（诊断与 scopeReady 都从这里来）。
struct Counts {
  int monitors = 0;
  int created = 0;
  int surfaceReady = 0;
  int visible = 0;
  int presentOk = 0;
  int cursorWindows = 0;
  int displayWindows = 0;
  int failures = 0;
};

/// 枚举回调：只收集几何与 DPI，不建窗（建窗必须在主线程、且要能逐窗核对结果）。
inline BOOL CALLBACK EnumerateProc(HMONITOR handle, HDC, LPRECT, LPARAM context) {
  auto* list = reinterpret_cast<std::vector<MonitorGroup>*>(context);
  MONITORINFOEXW info{};
  info.cbSize = sizeof(info);
  if (!GetMonitorInfoW(handle, &info)) return TRUE;
  MonitorGroup group;
  group.handle = handle;
  group.bounds = info.rcMonitor;
  group.primary = (info.dwFlags & MONITORINFOF_PRIMARY) != 0;
  group.device = info.szDevice;
  UINT dpiX = 96;
  UINT dpiY = 96;
  if (SUCCEEDED(GetDpiForMonitor(handle, MDT_EFFECTIVE_DPI, &dpiX, &dpiY))) group.dpi = dpiX;
  list->push_back(std::move(group));
  return TRUE;
}

constexpr wchar_t kOverlayClass[] = L"DshOverlayWindow";
constexpr wchar_t kCursorClass[] = L"DshOverlayCursor";
constexpr UINT kOverlayExStyle = WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST;

/// 窗口过程：命中穿透、不激活、不擦背景；拓扑变化交给主循环。
LRESULT CALLBACK OverlayProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam);

inline bool EnsureWindowClasses() {
  static bool registered = false;
  if (registered) return true;
  WNDCLASSEXW cls{};
  cls.cbSize = sizeof(cls);
  cls.lpfnWndProc = OverlayProc;
  cls.hInstance = GetModuleHandleW(nullptr);
  cls.hCursor = LoadCursorW(nullptr, MAKEINTRESOURCEW(32512));  // IDC_ARROW
  cls.lpszClassName = kOverlayClass;
  const bool overlayOk = RegisterClassExW(&cls) != 0 || GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
  cls.lpszClassName = kCursorClass;
  const bool cursorOk = RegisterClassExW(&cls) != 0 || GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
  registered = overlayOk && cursorOk;
  return registered;
}

/// 建窗。返回是否成功；失败时窗口状态里 `created` 保持 false。
inline bool CreateWindowFor(WindowState& state, const wchar_t* title, bool excludeFromCapture) {
  if (state.created) return true;
  const int width = state.rect.right - state.rect.left;
  const int height = state.rect.bottom - state.rect.top;
  if (width <= 0 || height <= 0) return false;
  state.window = CreateWindowExW(kOverlayExStyle, state.kind == Kind::Cursor ? kCursorClass : kOverlayClass, title,
                                 WS_POPUP, state.rect.left, state.rect.top, width, height, nullptr, nullptr,
                                 GetModuleHandleW(nullptr), nullptr);
  if (state.window == nullptr) return false;
  state.created = true;
  if (excludeFromCapture) {
    // 逐窗核验：返回值记下来，诊断里的开关值不能代表"每窗都排除成功"（方案 3.4 / 1.2）。
    const BOOL applied = SetWindowDisplayAffinity(state.window, WDA_EXCLUDEFROMCAPTURE);
    state.captureAffinityResult = applied ? 0u : GetLastError();
    state.captureAffinity = applied ? 0 : -1;
  }
  return true;
}

/// 建表面（像素 DIB）。`withTarget` 为真时再建一个 D2D DC render target（横幅用）。
inline bool CreateSurface(WindowState& state, UINT dpi, bool withTarget) {
  const int width = state.rect.right - state.rect.left;
  const int height = state.rect.bottom - state.rect.top;
  if (width <= 0 || height <= 0) return false;
  BITMAPINFO info{};
  info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  info.bmiHeader.biWidth = width;
  info.bmiHeader.biHeight = -height;
  info.bmiHeader.biPlanes = 1;
  info.bmiHeader.biBitCount = 32;
  info.bmiHeader.biCompression = BI_RGB;
  HDC screen = GetDC(nullptr);
  state.memoryDc = CreateCompatibleDC(screen);
  ReleaseDC(nullptr, screen);
  if (state.memoryDc == nullptr) return false;
  void* bits = nullptr;
  state.bitmap = CreateDIBSection(state.memoryDc, &info, DIB_RGB_COLORS, &bits, nullptr, 0);
  if (state.bitmap == nullptr || bits == nullptr) return false;
  state.oldBitmap = SelectObject(state.memoryDc, state.bitmap);
  state.pixels = bits;
  state.widthPx = width;
  state.heightPx = height;
  if (withTarget) {
    // 共享工厂：每个窗口各建一份 D2D 工厂是上一轮实测句柄增长的来源之一。
    ComPtr<ID2D1Factory> factory = banner::SharedD2DFactory();
    if (factory == nullptr) return false;
    // render target 的 DPI 用显示器真实 DPI：之后所有布局坐标都按 DIP 传（方案 3.3）。
    const D2D1_RENDER_TARGET_PROPERTIES properties = D2D1::RenderTargetProperties(
        D2D1_RENDER_TARGET_TYPE_DEFAULT,
        D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED),
        static_cast<float>(dpi), static_cast<float>(dpi));
    if (FAILED(factory->CreateDCRenderTarget(&properties, state.target.GetAddressOf()))) return false;
    const RECT bound{0, 0, width, height};
    if (FAILED(state.target->BindDC(state.memoryDc, &bound))) return false;
  }
  state.surfaceReady = true;
  return true;
}

inline void ReleaseSurface(WindowState& state) {
  // 顺序要紧：D2D 的 DC render target 还引用着这块 HDC，必须先放掉 target 再删 DC / 位图。
  // 反过来的话每建一次窗口就留下一个句柄（实测：每个 scope 周期 +3.8 个句柄，工作集却不变）。
  state.target.Reset();
  banner::Reset(state.bannerResources);
  if (state.memoryDc != nullptr && state.oldBitmap != nullptr) SelectObject(state.memoryDc, state.oldBitmap);
  if (state.bitmap != nullptr) DeleteObject(state.bitmap);
  if (state.memoryDc != nullptr) DeleteDC(state.memoryDc);
  state.memoryDc = nullptr;
  state.bitmap = nullptr;
  state.oldBitmap = nullptr;
  state.pixels = nullptr;
  state.widthPx = 0;
  state.heightPx = 0;
  state.surfaceReady = false;
  state.presentOk = false;
}

inline void DestroyWindowState(WindowState& state) {
  if (state.window != nullptr) {
    DestroyWindow(state.window);
    state.window = nullptr;
  }
  ReleaseSurface(state);
  state.created = false;
  state.visible = false;
  state.captureAffinity = -2;
  state.captureAffinityResult = 0;
}

/**
 * 呈现一个窗口。位置用 `rect`（屏幕物理像素），尺寸用表面尺寸。
 *
 * `presentOk` 只反映**这一次**调用的结果：失败要能被 scopeReady/health 看见，而不是被显示器数量盖住。
 */
inline bool Present(WindowState& state, const RECT& destination) {
  if (state.window == nullptr || state.memoryDc == nullptr) return false;
  POINT source{0, 0};
  SIZE size{state.widthPx, state.heightPx};
  POINT target{destination.left, destination.top};
  BLENDFUNCTION blend{AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
  const BOOL ok = UpdateLayeredWindow(state.window, nullptr, &target, &size, state.memoryDc, &source, 0, &blend, ULW_ALPHA);
  state.presentOk = ok != FALSE;
  state.lastPresentResult = ok ? S_OK : HRESULT_FROM_WIN32(GetLastError());
  if (ok) state.lastPresentMs = GetTickCount64();
  return ok != FALSE;
}

inline void ShowWindowNoActivate(WindowState& state) {
  if (state.window == nullptr) return;
  ShowWindow(state.window, SW_SHOWNOACTIVATE);
  SetWindowPos(state.window, HWND_TOPMOST, state.rect.left, state.rect.top, state.widthPx > 0 ? state.widthPx : state.rect.right - state.rect.left,
               state.heightPx > 0 ? state.heightPx : state.rect.bottom - state.rect.top, SWP_NOACTIVATE | SWP_SHOWWINDOW);
  state.visible = true;
}

inline void HideWindow(WindowState& state) {
  if (state.window == nullptr) return;
  ShowWindow(state.window, SW_HIDE);
  state.visible = false;
}

/* ---------------------------------------------------------------- registry -- */

/// 整个辅助进程的窗口登记表。只有主线程碰它。
struct Registry {
  std::vector<MonitorGroup> monitors;
  WindowState cursor;
  /// 光标窗口的 DPI（跨屏时更新）。
  UINT cursorDpi = 96;
  long long generation = 1;
  long layoutEpoch = 0;

  /**
   * 按当前拓扑重建四边与横幅。返回**基础提示**（四边 + 每屏横幅）是否全部建成。
   *
   * 建窗或建面失败的窗口保留在表里但 `created/surfaceReady` 为假 —— 健康度如实降级，
   * 不能因为"枚举到 1 台显示器"就报 visualReady。
   */
  bool Rebuild(bool excludeFromCapture, const BannerOptions& bannerOptions) {
    DestroyAll();
    layoutEpoch += 1;
    std::vector<MonitorGroup> discovered;
    const bool enumerated = EnumDisplayMonitors(nullptr, nullptr, EnumerateProc, reinterpret_cast<LPARAM>(&discovered)) != FALSE;
    if (!enumerated) return false;
    monitors = std::move(discovered);
    if (monitors.empty()) return false;
    for (MonitorGroup& group : monitors) {
      group.edges = ComputeEdges(group.bounds, group.dpi);
      if (!group.edges.ok) continue;
      const struct {
        Kind kind;
        RECT rect;
      } plan[5] = {
          {Kind::TopEdge, group.edges.top},
          {Kind::BottomEdge, group.edges.bottom},
          {Kind::LeftEdge, group.edges.left},
          {Kind::RightEdge, group.edges.right},
          {Kind::Banner, RECT{0, 0, 0, 0}},
      };
      const BannerLayout banner = ComputeBannerLayout(group.bounds, group.dpi, bannerOptions);
      for (const auto& entry : plan) {
        WindowState* state = group.KindWindow(entry.kind);
        if (state == nullptr) continue;
        state->kind = entry.kind;
        state->monitorIndex = static_cast<int>(&group - monitors.data());
        state->rect = entry.kind == Kind::Banner ? banner.window : entry.rect;
        state->layoutEpoch = layoutEpoch;
        if (state->rect.right <= state->rect.left || state->rect.bottom <= state->rect.top) continue;
        if (!CreateWindowFor(*state, L"DSH overlay", excludeFromCapture)) continue;
        if (!CreateSurface(*state, group.dpi, entry.kind == Kind::Banner)) continue;
      }
    }
    return BaseOverlaysHealthyAfterPresent();
  }

  /// 逐窗核对"已建 + 有面"，用于判定是否值得继续（呈现结果由 Present 记录）。
  bool BaseOverlaysHealthyAfterPresent() const {
    if (monitors.empty()) return false;
    for (const MonitorGroup& group : monitors) {
      if (!group.edges.ok) return false;
      const WindowState* windows[5] = {&group.top, &group.bottom, &group.left, &group.right, &group.banner};
      for (const WindowState* state : windows) {
        if (state->window == nullptr || !state->created || !state->surfaceReady) return false;
      }
    }
    return true;
  }

  void DestroyAll() {
    for (MonitorGroup& group : monitors) {
      DestroyWindowState(group.top);
      DestroyWindowState(group.bottom);
      DestroyWindowState(group.left);
      DestroyWindowState(group.right);
      DestroyWindowState(group.banner);
    }
    monitors.clear();
    DestroyWindowState(cursor);
  }

  Counts Statistics() const {
    Counts counts;
    counts.monitors = static_cast<int>(monitors.size());
    for (const MonitorGroup& group : monitors) {
      const WindowState* windows[5] = {&group.top, &group.bottom, &group.left, &group.right, &group.banner};
      for (const WindowState* state : windows) {
        if (state->window == nullptr) continue;
        counts.displayWindows += 1;
        if (state->created) counts.created += 1;
        if (state->surfaceReady) counts.surfaceReady += 1;
        if (state->visible) counts.visible += 1;
        if (state->presentOk) counts.presentOk += 1;
        if (!state->Healthy()) counts.failures += 1;
      }
    }
    if (cursor.window != nullptr) {
      counts.cursorWindows = 1;
      if (cursor.created) counts.created += 1;
      if (cursor.surfaceReady) counts.surfaceReady += 1;
      if (cursor.visible) counts.visible += 1;
      if (cursor.presentOk) counts.presentOk += 1;
      if (!cursor.Healthy()) counts.failures += 1;
    }
    return counts;
  }

  /// 四条边 + 每屏横幅都健康（不含光标：光标按开关可缺，缺失只降级装饰）。
  bool BaseOverlaysHealthy() const {
    if (monitors.empty()) return false;
    for (const MonitorGroup& group : monitors) {
      const WindowState* windows[5] = {&group.top, &group.bottom, &group.left, &group.right, &group.banner};
      for (const WindowState* state : windows) {
        if (!state->Healthy()) return false;
      }
    }
    return true;
  }
};

}  // namespace overlay
