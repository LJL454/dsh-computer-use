// 各窗口的像素合成（方案 3.2 / 4.2 / 4.7 / 6.2）。
//
// 三类表面，三种成本：
//   - 四边：固定容量的条带，用**环形距离场**一张一张算 alpha。纯 CPU 内存写，没有 D2D 对象、
//     没有整屏位图；呼吸只改 peak alpha，不改 HWND 尺寸。
//   - 横幅：小窗口（约 600×210 DIP），D2D 画主题与两段真实文字，结束绘制后把角色贴进 DIB。
//   - 光标：固定正方形表面，径向 alpha 掩码 + 角色贴图；位置变化只移动窗口，不重画像素。
//
// 所有缩放都在角色缓存里做过一次（character::Cache），这里只做预乘 over。
#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>
#include <vector>

#include "animation-player.h"
#include "banner-theme.h"
#include "character.h"
#include "overlay-layout.h"
#include "overlay-registry.h"

namespace render {

/// 解析后的视觉偏好（helper 只认这一个结构，不再到处读全局）。
struct Preferences {
  /// 装饰总开关（V）。关闭只熄灭装饰，四边与两段文字仍是静态提示。
  bool decoration = true;
  bool edgeBreathing = true;
  bool reducedMotion = false;
  bool cursorHalo = true;
  bool bannerCharacter = false;
  bool cursorCharacter = false;
  bool bannerDecoration = true;
  bool oceanTheme = true;
  /// 人物可见高度（DIP）：横幅与光标分别设置（方案 4.1）。
  float bannerCharacterHeightDip = 144.0f;
  float cursorCharacterHeightDip = 96.0f;
  /// 已应用的偏好修订号（只用于"只接受更新的修订"）。
  long settingsRevision = 0;
};

/// 一帧的共同输入。
struct Scene {
  long long nowMs = 0;
  bool stopping = false;
  /// 呼吸相位 0..1。
  float phase = 0.0f;
  /// 光带厚度（像素）：20→32 DIP 之间随相位。
  float thicknessPx = 0.0f;
};

inline float PhaseValue(long long nowMs, const Preferences& prefs) {
  if (prefs.reducedMotion || !prefs.edgeBreathing || !prefs.decoration) return 0.0f;
  const double t = static_cast<double>(nowMs) / 3000.0;
  return static_cast<float>((1.0 - std::cos(6.283185307179586 * t)) / 2.0);
}

/**
 * 四边光带的峰值透明度。
 *
 * 方案 4.3 的初值是 0.18 → 0.38（呼吸）。实机看过之后用户要求"再亮一点"，上调到 0.24 → 0.52；
 * 装饰关闭时也保留 0.24 的静态提示（基础提示不能被调暗成看不见）。
 * 光带厚度仍是 32 DIP、窗口容量仍是 36 DIP，只改亮度不动几何。
 */
inline float EdgePeakAlpha(const Preferences& prefs, float phase) {
  const float clamped = std::min(1.0f, std::max(0.0f, phase));
  if (!prefs.decoration) return 0.24f;
  return 0.24f + 0.28f * clamped;
}

inline Scene MakeScene(long long nowMs, const Preferences& prefs, UINT dpi, bool stopping) {
  Scene scene;
  scene.nowMs = nowMs;
  scene.stopping = stopping;
  scene.phase = PhaseValue(nowMs, prefs);
  const float thicknessDip = 20.0f + 12.0f * scene.phase;
  scene.thicknessPx = overlay::DipToPx(thicknessDip, dpi);
  return scene;
}

/* ------------------------------------------------------------------ edges -- */

/**
 * 把一条边条画成"到最近屏幕边缘的距离"的环形象素。
 *
 * 角部只由它所属的窗口画一次：上下条负责四个角，左右条从内边界起止，所以不会两窗叠加变亮。
 */
inline void FillEdge(overlay::WindowState& window, const overlay::MonitorGroup& group, const Scene& scene,
                     float peakAlpha) {
  if (window.pixels == nullptr || window.widthPx <= 0 || window.heightPx <= 0) return;
  auto* pixels = static_cast<uint32_t*>(window.pixels);
  const int monitorWidth = group.bounds.right - group.bounds.left;
  const int monitorHeight = group.bounds.bottom - group.bounds.top;
  const int originX = window.rect.left - group.bounds.left;
  const int originY = window.rect.top - group.bounds.top;
  const float clampPeak = std::min(1.0f, std::max(0.0f, peakAlpha));
  // 预乘查表：alpha 只有 0..255，颜色固定 (81, 158, 255)，每帧建一次 256 项表就够。
  uint32_t table[256] = {};
  for (int a = 0; a < 256; a += 1) {
    const uint32_t alpha = static_cast<uint32_t>(a);
    const uint32_t red = static_cast<uint32_t>(std::lround(81.0 * a / 255.0));
    const uint32_t green = static_cast<uint32_t>(std::lround(158.0 * a / 255.0));
    const uint32_t blue = static_cast<uint32_t>(std::lround(255.0 * a / 255.0));
    table[a] = (alpha << 24) | (red << 16) | (green << 8) | blue;
  }
  for (int y = 0; y < window.heightPx; y += 1) {
    uint32_t* row = pixels + static_cast<size_t>(y) * window.widthPx;
    for (int x = 0; x < window.widthPx; x += 1) {
      const float alpha01 = overlay::EdgeAlphaAtMonitorPoint(originX + x, originY + y, monitorWidth, monitorHeight,
                                                             scene.thicknessPx);
      const int alpha = static_cast<int>(std::lround(alpha01 * clampPeak * 255.0f));
      row[x] = alpha <= 0 ? 0u : table[std::min(255, alpha)];
    }
  }
}

/* --------------------------------------------------------------- character -- */

/// 角色一帧的选帧输入。
struct Pose {
  std::string clip = "idle";
  int frame = 0;
};

/// 取帧：按累计时长（不再按 tick 递增），负 elapsed 当 0。
inline int FrameOf(const character::Clip& clip, long long elapsedMs) {
  return animation::FrameFor(clip.frameCount, clip.durationsMs, clip.totalMs, clip.loop, elapsedMs);
}

/**
 * 把一帧角色贴到目标表面。
 *
 * @param visibleHeightPx - 目标**可见主体**高度（已由 DIP 换算成像素）。
 * @param anchorX/anchorY - contentBounds 底边中点落在目标的位置。
 */
inline bool DrawCharacter(void* pixels, int width, int height, character::Assets& assets, character::Cache& cache,
                          const std::string& clipName, int frame, int visibleHeightPx, int anchorX, int anchorY,
                          long long nowMs, bool reducedMotion, std::string& error) {
  if (!assets.ok || pixels == nullptr) return false;
  character::Clip* clip = assets.Find(clipName);
  if (clip == nullptr) clip = assets.Find("idle");
  if (clip == nullptr) return false;
  const character::ClipCache* preparedRaw = nullptr;
  // 方案 五.1：条目是 shared_ptr，缓存淘汰也不会让正在画的这一帧悬空。
  std::shared_ptr<const character::ClipCache> prepared = cache.Prepare(*clip, visibleHeightPx, nowMs);
  preparedRaw = prepared.get();
  if (preparedRaw == nullptr || preparedRaw->frames.empty()) {
    error = cache.LastError();
    return false;
  }
  const size_t index = static_cast<size_t>(std::min(std::max(0, frame), static_cast<int>(preparedRaw->frames.size()) - 1));
  const int sourceHeight = std::max(1, preparedRaw->contentHeight);
  auto drawBody = [&]() -> bool {
    const auto body = cache.Prepare(*clip, visibleHeightPx, nowMs);
    if (!body || index >= body->frames.size()) { error = cache.LastError(); return false; }
    character::Blit(pixels, width, height, body->frames[index], anchorX, anchorY);
    return true;
  };
  if (assets.mode != character::RenderMode::Layered || clip->parts.empty()) return drawBody();
  const float bodyScale = static_cast<float>(visibleHeightPx) / static_cast<float>(sourceHeight);
  auto drawPart = [&](const character::Part& part) -> bool {
    const auto pc = cache.PreparePart(part, bodyScale, nowMs);
    if (!pc || pc->frames.empty()) { error = cache.LastError(); return false; }
    const size_t pi = index % pc->frames.size();
    // 方案 五.2：减少动画要冻结**部件相位**，不只是停主帧 —— 否则尾巴还在 30 Hz 摆，
    // 既不符合"减少动画"的承诺，也让 renderKey 永远在变、省不掉重绘。
    const double phase = static_cast<double>(nowMs) / std::max(1.0f, part.motion.periodMs) + part.motion.phase;
    const float wave = reducedMotion ? 0.0f : static_cast<float>(std::sin(6.283185307179586 * phase));
    const float amplitude = part.motion.amplitude * visibleHeightPx;
    const int dx = part.motion.axis == 'x' ? static_cast<int>(std::lround(wave * amplitude)) : 0;
    const int dy = part.motion.axis == 'y' ? static_cast<int>(std::lround(wave * amplitude)) : 0;
    const int px = anchorX + static_cast<int>(std::lround((part.pivotX - clip->anchorX) * bodyScale));
    const int py = anchorY + static_cast<int>(std::lround((part.pivotY - clip->anchorY) * bodyScale));
    character::BlitPart(pixels, width, height, pc->frames[pi], px, py, dx, dy);
    return true;
  };
  // Body is z=0; concealed tail/hair roots must be drawn BEFORE the body.
  // `clip->parts` 已在加载时按 zOrder 排好（方案 五.4），这里只按符号分两段，不再排序。
  for (const auto& part : clip->parts) if (part.zOrder < 0 && !drawPart(part)) return false;
  if (!drawBody()) return false;
  for (const auto& part : clip->parts) if (part.zOrder >= 0 && !drawPart(part)) return false;
  return true;
}

/* ----------------------------------------------------------------- banner -- */

/**
 * 画横幅：主题与文字走 D2D，角色在 EndDraw 之后贴进同一块 DIB。
 *
 * @returns 文字/主题是否画成（失败只降级横幅，不影响四边与 Esc）。
 */
inline bool DrawBanner(overlay::WindowState& window, const overlay::MonitorGroup& group,
                       const overlay::BannerLayout& layout, const Preferences& prefs, const Scene& scene,
                       character::Assets& assets, character::Cache& cache, const Pose& pose, std::string& error) {
  if (window.target == nullptr || window.pixels == nullptr) return false;
  banner::ThemeOptions options;
  options.ocean = prefs.oceanTheme && prefs.bannerDecoration;
  options.decoration = prefs.bannerDecoration && prefs.decoration;
  options.reducedMotion = prefs.reducedMotion;
  options.stopping = scene.stopping;
  const bool drawn = banner::Draw(window.target.Get(), window.bannerResources, layout, group.dpi, options, scene.nowMs);
  if (prefs.bannerCharacter && !scene.stopping) {
    const int heightPx = static_cast<int>(std::lround(overlay::DipToPx(prefs.bannerCharacterHeightDip, group.dpi)));
    const int anchorX = static_cast<int>(std::lround(overlay::DipToPx(layout.characterAnchorXDip, group.dpi)));
    const int anchorY = static_cast<int>(std::lround(overlay::DipToPx(layout.characterAnchorYDip, group.dpi)));
    if (!DrawCharacter(window.pixels, window.widthPx, window.heightPx, assets, cache, pose.clip, pose.frame, heightPx,
                       anchorX, anchorY, scene.nowMs, prefs.reducedMotion, error)) {
      return drawn;  // 角色失败只降级角色
    }
  }
  return drawn;
}

/* ----------------------------------------------------------------- cursor -- */

/**
 * 光标表面的 renderKey（方案 五.2）。
 *
 * 部件幅度很小（tail 0.003×H、hair 0.0015×H，96 px 时只有 0.29/0.14 px），四舍五入后大多恒为零，
 * 以前却仍按 30 Hz 重新合成并 Present。把"这一帧的像素由什么决定"全部折进一个 64 位哈希：
 * 片段/帧号、DPI、表面尺寸与锚点、光晕与角色准入、按压、减弱动画、停止态、每个部件的**栅格位移**、
 * 混合进度、以及窗口句柄（重建后旧画面不能复用）。
 *
 * key 不变就跳过像素重合成与 Present，窗口位置照旧由 `PositionCursorWindow` 单独移动。
 */
inline void HashMix(unsigned long long& hash, unsigned long long value) {
  hash ^= value + 0x9e3779b97f4a7c15ull + (hash << 6) + (hash >> 2);
}

inline void HashString(unsigned long long& hash, const std::string& text) {
  unsigned long long value = 1469598103934665603ull;
  for (const char c : text) {
    value ^= static_cast<unsigned char>(c);
    value *= 1099511628211ull;
  }
  HashMix(hash, value);
}

inline unsigned long long CursorRenderKey(const Pose& pose, const Preferences& prefs, const overlay::CursorLayout& layout,
                                          const character::Assets& assets, UINT dpi, bool pressed, bool haloWanted,
                                          bool characterWanted, bool stopping, int fadeStep, long long nowMs,
                                          HWND window) {
  unsigned long long hash = 0xcbf29ce484222325ull;
  HashString(hash, pose.clip);
  HashMix(hash, static_cast<unsigned long long>(pose.frame));
  HashMix(hash, static_cast<unsigned long long>(dpi));
  HashMix(hash, static_cast<unsigned long long>(layout.sizePx));
  HashMix(hash, static_cast<unsigned long long>(layout.extentPx));
  HashMix(hash, static_cast<unsigned long long>(layout.hotspotInWindow.x));
  HashMix(hash, static_cast<unsigned long long>(layout.hotspotInWindow.y));
  HashMix(hash, static_cast<unsigned long long>(layout.characterAnchorX));
  HashMix(hash, static_cast<unsigned long long>(layout.characterAnchorY));
  HashMix(hash, static_cast<unsigned long long>(static_cast<int>(layout.quadrant)));
  HashMix(hash, pressed ? 1u : 0u);
  HashMix(hash, haloWanted ? 2u : 0u);
  HashMix(hash, characterWanted ? 4u : 0u);
  HashMix(hash, prefs.reducedMotion ? 8u : 0u);
  HashMix(hash, stopping ? 16u : 0u);
  HashMix(hash, static_cast<unsigned long long>(fadeStep + 1));
  HashMix(hash, reinterpret_cast<unsigned long long>(window));
  if (!characterWanted) return hash;
  const int visibleHeightPx =
      std::max(1, static_cast<int>(std::lround(overlay::DipToPx(prefs.cursorCharacterHeightDip, dpi))));
  HashMix(hash, static_cast<unsigned long long>(visibleHeightPx));
  if (assets.mode != character::RenderMode::Layered || assets.parts.empty()) return hash;
  for (const character::Part& part : assets.parts) {
    // 与 DrawCharacter 完全相同的位移公式：只有 lround 之后真的变了，才值得重画。
    // 减少动画时部件相位固定为 0（与绘制侧一致），key 于是保持稳定。
    const double phase =
        static_cast<double>(nowMs) / std::max(1.0f, part.motion.periodMs) + part.motion.phase;
    const float wave =
        prefs.reducedMotion ? 0.0f : static_cast<float>(std::sin(6.283185307179586 * phase));
    const float amplitude = part.motion.amplitude * static_cast<float>(visibleHeightPx);
    const int dx = part.motion.axis == 'x' ? static_cast<int>(std::lround(wave * amplitude)) : 0;
    const int dy = part.motion.axis == 'y' ? static_cast<int>(std::lround(wave * amplitude)) : 0;
    HashMix(hash, static_cast<unsigned long long>(part.zOrder));
    HashMix(hash, static_cast<unsigned long long>(dx + 4096));
    HashMix(hash, static_cast<unsigned long long>(dy + 4096));
  }
  return hash;
}

/**
 * 光晕缓存（方案 五.4）。
 *
 * 光晕只由（表面尺寸、DPI、按压、减少动画）决定，却以前每帧都对整个窗口逐像素算 sqrt、
 * 走 256 级 alpha 表。现在只建一次，命中时整块 memcpy；构建时也只遍历光晕的包围盒，
 * 不再扫整个窗口（陪伴窗口里光晕半径只占一小块）。
 */
struct HaloCacheEntry {
  int sizePx = -1;
  UINT dpi = 0;
  bool pressed = false;
  bool reducedMotion = false;
  std::vector<uint32_t> pixels;
  long long builds = 0;
};

inline HaloCacheEntry& HaloCache() {
  static HaloCacheEntry entry;
  return entry;
}

/// 构建光晕像素（半透明蓝色的径向衰减，预乘 BGRA）。
inline void BuildHalo(HaloCacheEntry& entry, int widthPx, int heightPx, const overlay::CursorLayout& layout,
                      UINT dpi, bool pressed, bool reducedMotion) {
  entry.pixels.assign(static_cast<size_t>(widthPx) * heightPx, 0u);
  entry.sizePx = widthPx;
  entry.dpi = dpi;
  entry.pressed = pressed;
  entry.reducedMotion = reducedMotion;
  entry.builds += 1;
  const float dipScale = static_cast<float>(dpi) / 96.0f;
  const float radius = overlay::kHaloRadiusDip * dipScale * (pressed && !reducedMotion ? 0.86f : 1.0f);
  const float baseAlpha = pressed ? 0.32f : 0.24f;
  const float centerX = static_cast<float>(layout.hotspotInWindow.x);
  const float centerY = static_cast<float>(layout.hotspotInWindow.y);
  uint32_t table[256] = {};
  for (int a = 0; a < 256; a += 1) {
    const uint32_t alpha = static_cast<uint32_t>(a);
    const uint32_t red = static_cast<uint32_t>(std::lround(102.0 * a / 255.0));
    const uint32_t green = static_cast<uint32_t>(std::lround(173.0 * a / 255.0));
    const uint32_t blue = static_cast<uint32_t>(std::lround(255.0 * a / 255.0));
    table[a] = (alpha << 24) | (red << 16) | (green << 8) | blue;
  }
  const int left = std::max(0, static_cast<int>(std::floor(centerX - radius)));
  const int right = std::min(widthPx, static_cast<int>(std::ceil(centerX + radius)) + 1);
  const int top = std::max(0, static_cast<int>(std::floor(centerY - radius)));
  const int bottom = std::min(heightPx, static_cast<int>(std::ceil(centerY + radius)) + 1);
  for (int y = top; y < bottom; y += 1) {
    uint32_t* row = entry.pixels.data() + static_cast<size_t>(y) * widthPx;
    for (int x = left; x < right; x += 1) {
      const float dx = static_cast<float>(x) + 0.5f - centerX;
      const float dy = static_cast<float>(y) + 0.5f - centerY;
      const float distance = std::sqrt(dx * dx + dy * dy);
      if (distance >= radius) continue;
      const float u = distance / radius;
      const float alpha01 = baseAlpha * (1.0f - overlay::SmoothStep01(u));
      const int alpha = static_cast<int>(std::lround(alpha01 * 255.0f));
      row[x] = alpha <= 0 ? 0u : table[std::min(255, alpha)];
    }
  }
}

/// 光标窗口的一帧：径向光晕 +（可选）角色。
inline bool DrawCursor(overlay::WindowState& window, const overlay::CursorLayout& layout, const Preferences& prefs,
                       const Scene& scene, bool pressed, bool haloWanted, bool characterWanted,
                       character::Assets& assets, character::Cache& cache,
                       const Pose& pose, UINT dpi, std::string& error, bool useCachedHalo = true) {
  if (window.pixels == nullptr || window.widthPx <= 0) return false;
  auto* pixels = static_cast<uint32_t*>(window.pixels);
  const size_t count = static_cast<size_t>(window.widthPx) * window.heightPx;
  std::fill(pixels, pixels + count, 0u);
  // 光晕与角色分属两套准入（方案 3.5）：日常伴随时窗口是为**角色**建的，光晕仍然只属于电脑控制。
  // 以前这里只看 `prefs.cursorHalo`，于是"只开伴随"也会在鼠标旁挂一圈雾化光。
  if (haloWanted) {
    if (useCachedHalo) {
      HaloCacheEntry& halo = HaloCache();
      if (halo.sizePx != window.widthPx || halo.dpi != dpi || halo.pressed != pressed ||
          halo.reducedMotion != prefs.reducedMotion) {
        BuildHalo(halo, window.widthPx, window.heightPx, layout, dpi, pressed, prefs.reducedMotion);
      }
      std::memcpy(pixels, halo.pixels.data(), count * sizeof(uint32_t));
    } else {
      HaloCacheEntry scratch;
      BuildHalo(scratch, window.widthPx, window.heightPx, layout, dpi, pressed, prefs.reducedMotion);
      std::memcpy(pixels, scratch.pixels.data(), count * sizeof(uint32_t));
    }
  }
  if (characterWanted) {
    const int heightPx = static_cast<int>(std::lround(overlay::DipToPx(prefs.cursorCharacterHeightDip, dpi)));
    if (!DrawCharacter(pixels, window.widthPx, window.heightPx, assets, cache, pose.clip, pose.frame, heightPx,
                       layout.characterAnchorX, layout.characterAnchorY, scene.nowMs, prefs.reducedMotion, error)) {
      // 角色失败：光晕还在，健康度由调用方报 degraded。返回 true 表示"这一帧是完整的"，
      // 即只有光晕、没有半成品角色 —— 调用方据此决定要不要提交（方案 4.G 两阶段提交）。
      return false;
    }
  }
  return true;
}

}  // namespace render
