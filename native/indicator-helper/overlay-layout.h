// 覆盖层的**纯几何**（方案 3.2 / 3.3 / 4.1）。
//
// 这个头文件里没有窗口、没有 D2D、也没有偏好：只回答"每个窗口该在哪、多大、角部怎么收光、
// 人物锚点落在哪"。这样它可以离线验证（矩形不重叠、半开区间、DPI 换算），运行时只是照着算结果。
//
// 三条口径，全部按方案 3.3 固定下来：
//   - 窗口屏幕位置、DIB 尺寸、鼠标热点：物理像素；
//   - 布局、光带厚度、文字与人物大小：DIP；
//   - 两者之间只经过 DipToPx / PxToDip 一处换算，不在别处再乘一次缩放。
//
// 边条容量是**固定**的（32 DIP 光带 + 4 DIP 安全边距）：呼吸只改变窗口内部的光效 alpha，
// 不每帧改 HWND 尺寸 —— 改尺寸会连带一次重新合成，正是当前 CPU 高的来源之一。
#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

#include <algorithm>
#include <cmath>
#include <cstddef>

namespace overlay {

/// 光带最大厚度与安全边距（DIP）。两者之和就是边条窗口的固定容量。
constexpr float kMaxBandDip = 32.0f;
constexpr float kBandMarginDip = 4.0f;
constexpr float kBandCapacityDip = kMaxBandDip + kBandMarginDip;

/// 窗口种类。顺序即诊断里的展示顺序。
enum class Kind { TopEdge = 0, BottomEdge = 1, LeftEdge = 2, RightEdge = 3, Banner = 4, Cursor = 5 };

constexpr int kKindCount = 6;

inline const char* KindName(Kind kind) {
  switch (kind) {
    case Kind::TopEdge: return "topEdge";
    case Kind::BottomEdge: return "bottomEdge";
    case Kind::LeftEdge: return "leftEdge";
    case Kind::RightEdge: return "rightEdge";
    case Kind::Banner: return "banner";
    case Kind::Cursor: return "cursor";
  }
  return "unknown";
}

inline bool IsEdge(Kind kind) {
  return kind == Kind::TopEdge || kind == Kind::BottomEdge || kind == Kind::LeftEdge || kind == Kind::RightEdge;
}

inline int RoundToInt(float value) { return static_cast<int>(std::lround(value)); }

/// DIP → 物理像素。**唯一**的换算入口。
inline float DipToPx(float dip, UINT dpi) { return dip * static_cast<float>(dpi) / 96.0f; }

/// 物理像素 → DIP。传给 D2D 的布局坐标必须先过这一处（方案 3.3）。
inline float PxToDip(int px, UINT dpi) { return static_cast<float>(px) * 96.0f / static_cast<float>(dpi); }
inline float PxToDipF(float px, UINT dpi) { return px * 96.0f / static_cast<float>(dpi); }

/// 边条的固定容量（像素，向上取整）。
inline int BandCapacityPx(UINT dpi) { return RoundToInt(std::ceil(DipToPx(kBandCapacityDip, dpi))); }

/* ------------------------------------------------------------------ edges -- */

/// 一台显示器的四条边条矩形（物理像素、半开区间）。
struct Edges {
  bool ok = false;
  /// 实际用到的容量（像素）。极小屏上会被夹小，使矩形不反转。
  int bandPx = 0;
  RECT top{};
  RECT bottom{};
  RECT left{};
  RECT right{};

  /// 四条边条的像素面积合计（面积预算用）。
  long long Area() const {
    auto area = [](const RECT& rect) -> long long {
      const long long width = rect.right - rect.left;
      const long long height = rect.bottom - rect.top;
      return width > 0 && height > 0 ? width * height : 0;
    };
    return area(top) + area(bottom) + area(left) + area(right);
  }
};

inline int Width(const RECT& rect) { return rect.right - rect.left; }
inline int Height(const RECT& rect) { return rect.bottom - rect.top; }

/**
 * 四边无重叠的几何（方案 3.2）。
 *
 * 上下条拥有四个角，左右条从内边界起止；所有尺寸来自同一轮计算，不分别四舍五入相邻边界。
 */
inline Edges ComputeEdges(const RECT& monitor, UINT dpi) {
  Edges edges;
  const int width = Width(monitor);
  const int height = Height(monitor);
  if (width <= 0 || height <= 0) return edges;
  int band = BandCapacityPx(dpi);
  const int maxBand = std::min(width / 2 - 1, height / 2 - 1);
  if (maxBand < 1) return edges;  // 小到放不下任何边条：调用方按"基础提示不可用"处理
  band = std::max(1, std::min(band, maxBand));
  edges.bandPx = band;
  edges.top = RECT{monitor.left, monitor.top, monitor.left + width, monitor.top + band};
  edges.bottom = RECT{monitor.left, monitor.top + height - band, monitor.left + width, monitor.top + height};
  edges.left = RECT{monitor.left, monitor.top + band, monitor.left + band, monitor.top + height - band};
  edges.right = RECT{monitor.left + width - band, monitor.top + band, monitor.left + width, monitor.top + height - band};
  edges.ok = true;
  return edges;
}

inline RECT RectForKind(const Edges& edges, Kind kind) {
  switch (kind) {
    case Kind::TopEdge: return edges.top;
    case Kind::BottomEdge: return edges.bottom;
    case Kind::LeftEdge: return edges.left;
    case Kind::RightEdge: return edges.right;
    default: return RECT{0, 0, 0, 0};
  }
}

inline float SmoothStep01(float u) {
  if (u <= 0.0f) return 0.0f;
  if (u >= 1.0f) return 1.0f;
  return u * u * (3.0f - 2.0f * u);
}

/**
 * 环形距离场：到最近屏幕边缘的距离决定亮度（方案 3.2）。
 *
 * 四个窗口只取同一个函数在各自矩形上的片段，所以角部**只生成一次**颜色 —— 不会由两窗叠加变亮，
 * 各边也有连续边界。坐标是显示器局部物理像素。
 */
inline float EdgeAlphaAtMonitorPoint(int mx, int my, int monitorWidth, int monitorHeight, float thicknessPx) {
  if (thicknessPx <= 0.0f) return 0.0f;
  const float x = static_cast<float>(mx) + 0.5f;
  const float y = static_cast<float>(my) + 0.5f;
  const float distance = std::min(std::min(x, static_cast<float>(monitorWidth) - x),
                                  std::min(y, static_cast<float>(monitorHeight) - y));
  if (distance >= thicknessPx) return 0.0f;
  return 1.0f - SmoothStep01(distance / thicknessPx);
}

/* ----------------------------------------------------------------- banner -- */

/// 横幅的位置与内部布局（窗口矩形是像素，其余是窗口内的 DIP）。
struct BannerLayout {
  bool valid = false;
  RECT window{};
  int widthPx = 0;
  int heightPx = 0;
  float widthDip = 0.0f;
  float heightDip = 0.0f;
  /// 胶囊底板（窗口内 DIP）。
  float plateLeftDip = 0.0f;
  float plateTopDip = 0.0f;
  float plateWidthDip = 0.0f;
  float plateHeightDip = 0.0f;
  /// 人物的可见高度、槽位宽度与锚点（锚点是 contentBounds 的底边中点）。
  float characterHeightDip = 0.0f;
  float characterSlotDip = 0.0f;
  float characterAnchorXDip = 0.0f;
  float characterAnchorYDip = 0.0f;
  /// 文字可用区间（窗口内 DIP）。
  float textLeftDip = 0.0f;
  float textRightDip = 0.0f;
  float statusRowTopDip = 0.0f;
  float cancelRowTopDip = 0.0f;
  /// 窄屏两行档：底板加高，人物可能放不下。
  bool compact = false;
  bool characterFits = true;
};

struct BannerOptions {
  float characterHeightDip = 144.0f;
  /// contentBounds 的宽高比（宽 / 高）；资源加载后由调用方填。
  float characterAspect = 0.78f;
  bool wantCharacter = true;
};

inline float ClampFloat(float value, float low, float high) {
  return value < low ? low : (value > high ? high : value);
}

/**
 * 横幅布局（方案 4.1 / 4.7）。
 *
 * 人物与两段文字**分别测量**：人物占左侧槽位，两段文字在右侧按行排；窄屏换成两行，但不得裁掉
 * Esc 提示。窗口高度 = 人物可见高度 + 底板 + 上下留白，宽度 = 底板 + 外光边距。
 */
inline BannerLayout ComputeBannerLayout(const RECT& monitor, UINT dpi, const BannerOptions& options) {
  BannerLayout layout;
  const int monitorWidthPx = Width(monitor);
  const int monitorHeightPx = Height(monitor);
  if (monitorWidthPx <= 0 || monitorHeightPx <= 0) return layout;

  const float monitorWidthDip = PxToDip(monitorWidthPx, dpi);
  const float characterHeight = ClampFloat(options.characterHeightDip, 48.0f, 240.0f);
  const float aspect = ClampFloat(options.characterAspect, 0.35f, 1.6f);
  const bool wantCharacter = options.wantCharacter;
  const float slot = wantCharacter ? characterHeight * aspect : 0.0f;

  constexpr float glowMarginDip = 14.0f;
  constexpr float sidePadDip = 14.0f;
  constexpr float gapDip = 14.0f;
  constexpr float whaleDip = 26.0f;
  constexpr float plateHeightDip = 44.0f;
  constexpr float compactPlateHeightDip = 66.0f;
  constexpr float verticalPadDip = 8.0f;

  // 文字槽位是**测量上界**（16 DIP 半粗体 27 字符约 205 DIP；14 DIP 的 "Esc to cancel" 约 92 DIP）。
  constexpr float statusSlotDip = 216.0f;
  constexpr float cancelSlotDip = 100.0f;

  float plateWidth = slot + (wantCharacter ? sidePadDip : 0.0f) + statusSlotDip + gapDip + cancelSlotDip + whaleDip + sidePadDip;
  bool compact = false;
  float plateHeight = plateHeightDip;
  float available = monitorWidthDip - glowMarginDip * 2.0f;
  if (plateWidth > available) {
    // 两行档：人物 + 两行文字并排。
    compact = true;
    plateHeight = compactPlateHeightDip;
    const float textSlot = std::max(statusSlotDip, cancelSlotDip);
    plateWidth = slot + (wantCharacter ? sidePadDip : 0.0f) + textSlot + sidePadDip;
    if (plateWidth > available) {
      // 仍然放不下：先去掉人物槽位，再把底板压到屏内（文字继续缩小由渲染端负责）。
      layout.characterFits = false;
      plateWidth = textSlot + sidePadDip * 2.0f;
      if (plateWidth > available) plateWidth = std::max(120.0f, available);
    }
  }

  const float windowWidthDip = plateWidth + glowMarginDip * 2.0f;
  const bool characterInLayout = wantCharacter && layout.characterFits;
  const float windowHeightDip = (characterInLayout ? characterHeight + verticalPadDip * 2.0f : 0.0f) + plateHeight;

  layout.valid = true;
  layout.compact = compact;
  layout.widthDip = windowWidthDip;
  layout.heightDip = windowHeightDip;
  layout.widthPx = RoundToInt(DipToPx(windowWidthDip, dpi));
  layout.heightPx = RoundToInt(DipToPx(windowHeightDip, dpi));
  if (layout.widthPx > monitorWidthPx) layout.widthPx = monitorWidthPx;
  if (layout.heightPx > monitorHeightPx) layout.heightPx = monitorHeightPx;
  const int left = monitor.left + (monitorWidthPx - layout.widthPx) / 2;
  const int top = monitor.top + RoundToInt(DipToPx(4.0f, dpi));
  layout.window = RECT{left, top, left + layout.widthPx, top + layout.heightPx};

  layout.plateLeftDip = glowMarginDip;
  layout.plateWidthDip = plateWidth;
  layout.plateHeightDip = plateHeight;
  layout.plateTopDip = windowHeightDip - plateHeight;  // 底板贴窗口底（下方还有 glow 边距之外没有内容）
  // 底板顶部留一点外光边距，人物坐在这条底板上。
  layout.plateTopDip = windowHeightDip - plateHeight + glowMarginDip * 0.0f;

  layout.characterHeightDip = characterInLayout ? characterHeight : 0.0f;
  layout.characterSlotDip = characterInLayout ? slot : 0.0f;
  layout.characterAnchorXDip = layout.plateLeftDip + (characterInLayout ? sidePadDip + slot * 0.5f : 0.0f);
  // 脚底/髋部接触点落在底板下沿上方 3 DIP：坐在胶囊上，不悬空。
  layout.characterAnchorYDip = windowHeightDip - 3.0f;

  layout.textLeftDip = layout.plateLeftDip + (characterInLayout ? sidePadDip + slot + gapDip : sidePadDip);
  layout.textRightDip = layout.plateLeftDip + plateWidth - sidePadDip - whaleDip;
  if (layout.textRightDip < layout.textLeftDip + 80.0f) layout.textRightDip = layout.plateLeftDip + plateWidth - sidePadDip;
  layout.statusRowTopDip = layout.plateTopDip + (compact ? 8.0f : (plateHeight - 22.0f) * 0.5f);
  layout.cancelRowTopDip = compact ? layout.plateTopDip + 34.0f : layout.statusRowTopDip;
  return layout;
}

/* ----------------------------------------------------------------- cursor -- */

/// 人物相对热点的方位。屏幕边缘会切换，切换带小滞回区（方案 4.1）。
enum class Quadrant { BottomRight = 0, BottomLeft = 1, TopRight = 2, TopLeft = 3 };

inline const char* QuadrantName(Quadrant quadrant) {
  switch (quadrant) {
    case Quadrant::BottomRight: return "bottomRight";
    case Quadrant::BottomLeft: return "bottomLeft";
    case Quadrant::TopRight: return "topRight";
    case Quadrant::TopLeft: return "topLeft";
  }
  return "bottomRight";
}

struct CursorLayout {
  int sizePx = 0;
  float sizeDip = 0.0f;
  POINT hotspotInWindow{0, 0};
  int characterAnchorX = 0;
  int characterAnchorY = 0;
  bool withCharacter = false;
  Quadrant quadrant = Quadrant::BottomRight;
  int extentPx = 0;
};

/// 光晕的半径与透明边距（DIP）。
constexpr float kHaloRadiusDip = 26.0f;
constexpr float kHaloMarginDip = 12.0f;

/**
 * 选方位：优先放在热点**侧下方**，靠近屏幕边缘时换边，切换带宽 24 DIP 的滞回区。
 *
 * @param hotspot - 屏幕坐标热点。
 * @param monitor - 所在显示器的物理矩形。
 * @param extentPx - 人物/光晕在单侧需要的最大像素。
 * @param previous - 上一次的方位（用于滞回）。
 */
inline Quadrant ChooseQuadrant(const POINT& hotspot, const RECT& monitor, int extentPx, Quadrant previous) {
  const int hysteresis = std::max(2, extentPx / 6);
  const int roomRight = monitor.right - hotspot.x;
  const int roomLeft = hotspot.x - monitor.left;
  const int roomBottom = monitor.bottom - hotspot.y;
  const int roomTop = hotspot.y - monitor.top;

  const bool previousRight = previous == Quadrant::BottomRight || previous == Quadrant::TopRight;
  const bool previousBottom = previous == Quadrant::BottomRight || previous == Quadrant::BottomLeft;

  // 先决定横向：留得住就保持上一次的选择，避免在边界上反复跳。
  bool right;
  if (previousRight) right = roomRight >= extentPx;
  else right = roomRight < extentPx + hysteresis;
  if (right && roomRight < extentPx) right = false;
  if (!right && roomLeft < extentPx) right = roomRight >= roomLeft;

  bool bottom;
  if (previousBottom) bottom = roomBottom >= extentPx;
  else bottom = roomBottom < extentPx + hysteresis;
  if (bottom && roomBottom < extentPx) bottom = false;
  if (!bottom && roomTop < extentPx) bottom = roomBottom >= roomTop;

  if (right) return bottom ? Quadrant::BottomRight : Quadrant::TopRight;
  return bottom ? Quadrant::BottomLeft : Quadrant::TopLeft;
}

/**
 * 光标窗口布局。
 *
 * 窗口是以热点为中心的正方形，边长按"人物/光晕单侧最大需要"算，内容只占一个象限 —— 箭头尖端附近
 * 始终留空，光晕中心始终压在实际热点上（不靠钳制窗口来对齐）。
 */
inline CursorLayout ComputeCursorLayout(UINT dpi, float characterHeightDip, float characterAspect, bool withCharacter,
                                        Quadrant previous, const POINT& hotspot, const RECT& monitor) {
  CursorLayout layout;
  layout.withCharacter = withCharacter;
  const int haloExtent = RoundToInt(DipToPx(kHaloRadiusDip + kHaloMarginDip, dpi));
  const int characterHeight = withCharacter ? RoundToInt(DipToPx(ClampFloat(characterHeightDip, 48.0f, 200.0f), dpi)) : 0;
  const int characterWidth = withCharacter ? RoundToInt(static_cast<float>(characterHeight) * ClampFloat(characterAspect, 0.35f, 1.6f)) : 0;
  const int gapPx = withCharacter ? RoundToInt(DipToPx(12.0f, dpi)) : 0;
  const int padPx = RoundToInt(DipToPx(6.0f, dpi));
  const int extent = std::max({haloExtent, withCharacter ? characterHeight + gapPx : 0, withCharacter ? characterWidth + gapPx : 0}) + padPx;
  layout.extentPx = extent;
  layout.sizePx = extent * 2;
  layout.sizeDip = PxToDipF(static_cast<float>(layout.sizePx), dpi);
  layout.hotspotInWindow = POINT{extent, extent};
  layout.quadrant = ChooseQuadrant(hotspot, monitor, extent, previous);

  const int center = extent;
  switch (layout.quadrant) {
    case Quadrant::BottomRight:
      layout.characterAnchorX = center + gapPx + characterWidth / 2;
      layout.characterAnchorY = center + gapPx + characterHeight;
      break;
    case Quadrant::BottomLeft:
      layout.characterAnchorX = center - gapPx - characterWidth / 2;
      layout.characterAnchorY = center + gapPx + characterHeight;
      break;
    case Quadrant::TopRight:
      layout.characterAnchorX = center + gapPx + characterWidth / 2;
      layout.characterAnchorY = center - gapPx;
      break;
    case Quadrant::TopLeft:
      layout.characterAnchorX = center - gapPx - characterWidth / 2;
      layout.characterAnchorY = center - gapPx;
      break;
  }
  return layout;
}

/* ------------------------------------------------------------ offline test -- */

/// 四边矩形是否两两不相交（离线验证用）。
inline bool EdgeRectsDisjoint(const Edges& edges) {
  struct Entry { const RECT* rect; };
  const RECT* rects[4] = {&edges.top, &edges.bottom, &edges.left, &edges.right};
  for (int i = 0; i < 4; i += 1) {
    for (int j = i + 1; j < 4; j += 1) {
      const RECT& a = *rects[i];
      const RECT& b = *rects[j];
      const bool disjoint = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
      if (!disjoint) return false;
    }
  }
  return true;
}

}  // namespace overlay
