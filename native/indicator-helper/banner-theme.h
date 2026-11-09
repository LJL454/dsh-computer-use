// 专属海洋横幅主题（方案 4.7）。
//
// 层次与更新方式按方案的表来分：外层胶囊双描边与外光是 DPI/主题改变时才重建的小范围缓存；底板、
// 海浪与小鲸是静态几何；气泡是**固定两个**、低透明度、慢周期的局部动效；两段文字是独立布局，
// 清楚稳定 —— 不呼吸、不缩放、不晃、不加动态辉光。
//
// 文字从不烘焙进图片：`Agent is using your computer` / `Esc to cancel` 一直是真实文本绘制，
// 停止时换成 `Stopping…` / `Esc was pressed`（横幅样式不暗示任务成功）。
#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <d2d1.h>
#include <dwrite.h>
#include <wrl/client.h>

#include <cmath>
#include <string>

#include "overlay-layout.h"

namespace banner {

using Microsoft::WRL::ComPtr;

/**
 * 进程级共享的 D2D / DWrite 工厂。
 *
 * 原先每个横幅窗口各建一份（`D2D1CreateFactory` + `DWriteCreateFactory`），每建一次窗口就多一份
 * 工厂对象；实测每个 scope 周期泄漏约 3.8 个句柄，工作集却不动 —— 先从这里收掉一份来源。
 * 工厂本身是线程安全的一次性对象，共享它不会带来跨窗口的状态耦合。
 */
inline ComPtr<ID2D1Factory>& SharedD2DFactory() {
  static ComPtr<ID2D1Factory> factory;
  if (factory == nullptr) {
    D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, factory.GetAddressOf());
  }
  return factory;
}

inline ComPtr<IDWriteFactory>& SharedDWriteFactory() {
  static ComPtr<IDWriteFactory> factory;
  if (factory == nullptr) {
    DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory),
                        reinterpret_cast<IUnknown**>(factory.GetAddressOf()));
  }
  return factory;
}

/// 主题与装饰开关（来自偏好；减少动画的优先级最高）。
struct ThemeOptions {
  /// true：完整海洋主题（淡冰蓝胶囊、双描边、外光、小鲸、海浪）。
  bool ocean = true;
  /// 装饰动效（气泡、局部波光）。关闭后只留静态底板。
  bool decoration = true;
  bool reducedMotion = false;
  /// 停止中：文字换成停止提示，装饰动效立即停下。
  bool stopping = false;
};

/// 每个横幅窗口的 D2D/DWrite 资源缓存：DPI 或目标变了才重建（方案 6.3 的"复用画刷"）。
struct Resources {
  bool built = false;
  UINT dpi = 0;
  ComPtr<ID2D1Factory> factory;
  ComPtr<IDWriteFactory> dwrite;
  ComPtr<IDWriteTextFormat> statusFormat;
  ComPtr<IDWriteTextFormat> cancelFormat;
  ComPtr<ID2D1GradientStopCollection> plateStops;
  ComPtr<ID2D1LinearGradientBrush> plateBrush;
  ComPtr<ID2D1SolidColorBrush> strokeOuter;
  ComPtr<ID2D1SolidColorBrush> strokeInner;
  ComPtr<ID2D1SolidColorBrush> glow;
  ComPtr<ID2D1SolidColorBrush> text;
  ComPtr<ID2D1SolidColorBrush> wave;
  ComPtr<ID2D1SolidColorBrush> whale;
  ComPtr<ID2D1SolidColorBrush> plainPlate;
  ComPtr<ID2D1SolidColorBrush> plainText;
  /// 文字布局缓存：运行/停止两套。文字从不烘焙进图片，布局只按文本与宽度建一次。
  ComPtr<IDWriteTextLayout> statusLayouts[2];
  ComPtr<IDWriteTextLayout> cancelLayouts[2];
  float layoutWidth = 0.0f;
  bool layoutsBuilt = false;
  /// 文字宽度缓存：运行/停止两套，宽度按可用区间量一次。
  float statusWidth[2] = {0.0f, 0.0f};
  float cancelWidth[2] = {0.0f, 0.0f};
  bool widthsMeasured = false;
  bool detail = true;
  /// 最近一次绘制的 HRESULT：失败要能被诊断看见（"没有横幅"与"横幅画失败"是两件事）。
  HRESULT lastHr = S_OK;
  long draws = 0;
};

inline void Reset(Resources& resources) { resources = Resources{}; }

/**
 * 建一次资源。失败返回 false，调用方降级为"无底板文字"（但仍然画四边与 Esc 提示之外的基础提示）。
 */
inline bool EnsureResources(Resources& resources, UINT dpi) {
  if (resources.built && resources.dpi == dpi) return true;
  Reset(resources);
  resources.dpi = dpi;
  // 工厂是进程级共享的：这里只留一份引用，不重复创建（见 SharedD2DFactory 的说明）。
  resources.factory = SharedD2DFactory();
  resources.dwrite = SharedDWriteFactory();
  if (resources.factory == nullptr || resources.dwrite == nullptr) return false;
  resources.dwrite->CreateTextFormat(L"Segoe UI", nullptr, DWRITE_FONT_WEIGHT_SEMI_BOLD, DWRITE_FONT_STYLE_NORMAL,
                                     DWRITE_FONT_STRETCH_NORMAL, 16.0f, L"en-us", resources.statusFormat.GetAddressOf());
  resources.dwrite->CreateTextFormat(L"Segoe UI", nullptr, DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_STYLE_NORMAL,
                                     DWRITE_FONT_STRETCH_NORMAL, 14.0f, L"en-us", resources.cancelFormat.GetAddressOf());
  resources.built = resources.statusFormat != nullptr && resources.cancelFormat != nullptr;
  return resources.built;
}

/// 让资源与某个 render target 绑定（画刷属于 target）。
inline bool BindBrushes(Resources& resources, ID2D1DCRenderTarget* target, bool ocean) {
  if (target == nullptr) return false;
  if (ocean) {
    D2D1_GRADIENT_STOP stops[2] = {
        {0.0f, D2D1::ColorF(0.945f, 0.976f, 1.0f, 1.0f)},
        {1.0f, D2D1::ColorF(0.792f, 0.902f, 1.0f, 1.0f)},
    };
    if (resources.plateStops == nullptr) {
      target->CreateGradientStopCollection(stops, 2, D2D1_GAMMA_2_2, D2D1_EXTEND_MODE_CLAMP,
                                           resources.plateStops.GetAddressOf());
    }
    if (resources.plateStops != nullptr && resources.plateBrush == nullptr) {
      const D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES brush = D2D1::LinearGradientBrushProperties(
          D2D1::Point2F(0.0f, 0.0f), D2D1::Point2F(0.0f, 1.0f));
      target->CreateLinearGradientBrush(brush, D2D1::BrushProperties(), resources.plateStops.Get(),
                                        resources.plateBrush.GetAddressOf());
    }
    if (resources.strokeOuter == nullptr) target->CreateSolidColorBrush(D2D1::ColorF(0.086f, 0.290f, 0.573f, 0.95f), resources.strokeOuter.GetAddressOf());
    if (resources.strokeInner == nullptr) target->CreateSolidColorBrush(D2D1::ColorF(0.663f, 0.855f, 1.0f, 0.90f), resources.strokeInner.GetAddressOf());
    if (resources.glow == nullptr) target->CreateSolidColorBrush(D2D1::ColorF(0.486f, 0.826f, 1.0f, 0.16f), resources.glow.GetAddressOf());
    if (resources.text == nullptr) target->CreateSolidColorBrush(D2D1::ColorF(0.055f, 0.176f, 0.353f, 1.0f), resources.text.GetAddressOf());
    if (resources.wave == nullptr) target->CreateSolidColorBrush(D2D1::ColorF(0.416f, 0.792f, 0.976f, 0.55f), resources.wave.GetAddressOf());
    if (resources.whale == nullptr) target->CreateSolidColorBrush(D2D1::ColorF(0.086f, 0.290f, 0.573f, 0.55f), resources.whale.GetAddressOf());
    return resources.plateBrush != nullptr && resources.text != nullptr;
  }
  if (resources.plainPlate == nullptr) target->CreateSolidColorBrush(D2D1::ColorF(0.06f, 0.09f, 0.16f, 0.86f), resources.plainPlate.GetAddressOf());
  if (resources.plainText == nullptr) target->CreateSolidColorBrush(D2D1::ColorF(0.96f, 0.97f, 1.0f, 1.0f), resources.plainText.GetAddressOf());
  return resources.plainPlate != nullptr && resources.plainText != nullptr;
}

/// 量一段文字的宽度（DIP）。
inline float MeasureText(Resources& resources, IDWriteTextFormat* format, const wchar_t* text) {
  if (format == nullptr || resources.dwrite == nullptr) return 0.0f;
  ComPtr<IDWriteTextLayout> layout;
  if (FAILED(resources.dwrite->CreateTextLayout(text, static_cast<UINT32>(wcslen(text)), format, 1000.0f, 60.0f,
                                                layout.GetAddressOf()))) {
    return 0.0f;
  }
  DWRITE_TEXT_METRICS metrics{};
  if (FAILED(layout->GetMetrics(&metrics))) return 0.0f;
  return metrics.width;
}

/// 建（或重建）两套文字布局：可用宽度变了才重建。
inline bool EnsureTextLayouts(Resources& resources, float wrapWidth) {
  if (resources.layoutsBuilt && std::fabs(wrapWidth - resources.layoutWidth) < 0.5f) return true;
  resources.layoutsBuilt = false;
  if (resources.dwrite == nullptr || resources.statusFormat == nullptr || resources.cancelFormat == nullptr) {
    return false;
  }
  const wchar_t* statusTexts[2] = {L"Agent is using your computer", L"Stopping…"};
  const wchar_t* cancelTexts[2] = {L"Esc to cancel", L"Esc was pressed"};
  for (int slot = 0; slot < 2; slot += 1) {
    resources.statusLayouts[slot].Reset();
    resources.cancelLayouts[slot].Reset();
    if (FAILED(resources.dwrite->CreateTextLayout(statusTexts[slot], static_cast<UINT32>(wcslen(statusTexts[slot])),
                                                  resources.statusFormat.Get(), wrapWidth, 24.0f,
                                                  resources.statusLayouts[slot].GetAddressOf()))) {
      return false;
    }
    if (FAILED(resources.dwrite->CreateTextLayout(cancelTexts[slot], static_cast<UINT32>(wcslen(cancelTexts[slot])),
                                                  resources.cancelFormat.Get(), wrapWidth, 24.0f,
                                                  resources.cancelLayouts[slot].GetAddressOf()))) {
      return false;
    }
  }
  resources.layoutWidth = wrapWidth;
  resources.layoutsBuilt = true;
  return true;
}

/// 小鲸图案：身体椭圆 + 尾鳍三角 + 眼睛。位置在胶囊右侧。
inline void DrawWhale(ID2D1DCRenderTarget* target, ID2D1Factory* factory, ID2D1SolidColorBrush* brush, float centerX,
                      float centerY, float size) {
  if (target == nullptr || factory == nullptr || brush == nullptr || size <= 1.0f) return;
  const float halfWidth = size * 0.5f;
  const float halfHeight = size * 0.30f;
  target->FillEllipse(D2D1::Ellipse(D2D1::Point2F(centerX, centerY), halfWidth, halfHeight), brush);
  // 尾鳍：从身体右侧向后上方分叉。
  const D2D1_POINT_2F tail[3] = {
      D2D1::Point2F(centerX + halfWidth * 0.92f, centerY),
      D2D1::Point2F(centerX + halfWidth * 1.55f, centerY - halfHeight * 1.10f),
      D2D1::Point2F(centerX + halfWidth * 1.45f, centerY + halfHeight * 0.95f),
  };
  ComPtr<ID2D1PathGeometry> geometry;
  ComPtr<ID2D1GeometrySink> sink;
  if (SUCCEEDED(factory->CreatePathGeometry(geometry.GetAddressOf())) && SUCCEEDED(geometry->Open(sink.GetAddressOf()))) {
    sink->BeginFigure(tail[0], D2D1_FIGURE_BEGIN_FILLED);
    sink->AddLine(tail[1]);
    sink->AddLine(tail[2]);
    sink->EndFigure(D2D1_FIGURE_END_CLOSED);
    sink->Close();
    target->FillGeometry(geometry.Get(), brush);
  }
  // 眼睛：一个更小的实心圆，用同色画在浅底上（对比靠底板亮度，不额外加色）。
  target->FillEllipse(D2D1::Ellipse(D2D1::Point2F(centerX - halfWidth * 0.45f, centerY - halfHeight * 0.15f),
                                    size * 0.045f, size * 0.045f),
                      brush);
}

/// 底部两侧的简化海浪：两段二次贝塞尔弧，静止不动。
inline void DrawWaves(ID2D1DCRenderTarget* target, ID2D1Factory* factory, ID2D1SolidColorBrush* brush, float left,
                      float right, float bottomY, float height) {
  if (target == nullptr || factory == nullptr || brush == nullptr) return;
  ComPtr<ID2D1PathGeometry> geometry;
  ComPtr<ID2D1GeometrySink> sink;
  if (FAILED(factory->CreatePathGeometry(geometry.GetAddressOf())) || FAILED(geometry->Open(sink.GetAddressOf()))) return;
  const float span = (right - left) * 0.22f;
  sink->BeginFigure(D2D1::Point2F(left, bottomY), D2D1_FIGURE_BEGIN_HOLLOW);
  sink->AddBezier(D2D1::BezierSegment(D2D1::Point2F(left + span * 0.35f, bottomY - height),
                                      D2D1::Point2F(left + span * 0.65f, bottomY - height),
                                      D2D1::Point2F(left + span, bottomY)));
  sink->EndFigure(D2D1_FIGURE_END_OPEN);
  sink->BeginFigure(D2D1::Point2F(right - span, bottomY), D2D1_FIGURE_BEGIN_HOLLOW);
  sink->AddBezier(D2D1::BezierSegment(D2D1::Point2F(right - span * 0.65f, bottomY - height),
                                      D2D1::Point2F(right - span * 0.35f, bottomY - height),
                                      D2D1::Point2F(right, bottomY)));
  sink->EndFigure(D2D1_FIGURE_END_OPEN);
  sink->Close();
  target->DrawGeometry(geometry.Get(), brush, 1.2f);
}

/// 两个固定气泡，慢周期上浮；减少动画时一个都不画。
inline void DrawBubbles(ID2D1DCRenderTarget* target, ID2D1SolidColorBrush* brush, float left, float right, float bottomY,
                        float topY, long long nowMs) {
  if (target == nullptr || brush == nullptr) return;
  constexpr float periodMs = 4200.0f;
  for (int index = 0; index < 2; index += 1) {
    const float phase = static_cast<float>(nowMs % static_cast<long long>(periodMs)) / periodMs;
    const float offset = index == 0 ? 0.0f : 0.45f;
    const float t = std::fmod(phase + offset, 1.0f);
    const float x = index == 0 ? left + (right - left) * 0.18f : right - (right - left) * 0.22f;
    const float y = bottomY - (bottomY - topY) * t;
    const float radius = 1.6f + 1.1f * static_cast<float>(index);
    const float alpha = 0.34f * (1.0f - t);
    ComPtr<ID2D1SolidColorBrush> bubble;
    if (FAILED(target->CreateSolidColorBrush(D2D1::ColorF(0.55f, 0.86f, 1.0f, alpha), bubble.GetAddressOf()))) continue;
    target->FillEllipse(D2D1::Ellipse(D2D1::Point2F(x, y), radius, radius), bubble.Get());
  }
}

/**
 * 画一帧横幅（不含人物；人物由调用方在 EndDraw 之后贴进 DIB）。
 *
 * @returns 文字的绘制是否成功（失败只是少一段字，不影响人物与四边）。
 */
inline bool Draw(ID2D1DCRenderTarget* target, Resources& resources, const overlay::BannerLayout& layout, UINT dpi,
                 const ThemeOptions& options, long long nowMs) {
  if (target == nullptr || !layout.valid) return false;
  if (!EnsureResources(resources, dpi)) {
    resources.lastHr = E_FAIL;
    return false;
  }
  const bool ocean = options.ocean;
  const float widthDip = overlay::PxToDip(layout.widthPx, dpi);
  const float heightDip = overlay::PxToDip(layout.heightPx, dpi);
  const D2D1_RECT_F plate = D2D1::RectF(layout.plateLeftDip, layout.plateTopDip,
                                        layout.plateLeftDip + layout.plateWidthDip,
                                        layout.plateTopDip + layout.plateHeightDip);
  target->BeginDraw();
  target->Clear(D2D1::ColorF(0.0f, 0.0f, 0.0f, 0.0f));
  if (!BindBrushes(resources, target, ocean)) {
    resources.lastHr = E_FAIL;
    target->EndDraw();
    return false;
  }
  const float radius = layout.plateHeightDip * 0.5f;
  if (ocean) {
    // 轻柔青蓝外光：三层同心描边，不用模糊核（禁止全屏模糊）。
    for (int layer = 3; layer >= 1; layer -= 1) {
      const float grow = static_cast<float>(layer) * 1.6f;
      const D2D1_ROUNDED_RECT glowRect =
          D2D1::RoundedRect(D2D1::RectF(plate.left - grow, plate.top - grow, plate.right + grow, plate.bottom + grow),
                            radius + grow, radius + grow);
      target->DrawRoundedRectangle(glowRect, resources.glow.Get(), 1.0f);
    }
    target->FillRoundedRectangle(D2D1::RoundedRect(plate, radius, radius), resources.plateBrush.Get());
    target->DrawRoundedRectangle(D2D1::RoundedRect(plate, radius, radius), resources.strokeOuter.Get(), 1.6f);
    const D2D1_ROUNDED_RECT inner = D2D1::RoundedRect(
        D2D1::RectF(plate.left + 2.6f, plate.top + 2.6f, plate.right - 2.6f, plate.bottom - 2.6f), radius - 2.6f,
        radius - 2.6f);
    target->DrawRoundedRectangle(inner, resources.strokeInner.Get(), 1.0f);
    // 几何必须由**同一个 factory** 造：跨 factory 的 D2D 资源会返回 D2DERR_WRONG_FACTORY。
    // `ID2D1Resource::GetFactory` 返回的是**借用**引用（不 AddRef），所以这里不能 Release ——
    // 以前多 Release 一次会把工厂提前放掉，后面的窗口就只能靠运气。
    ID2D1Factory* targetFactory = resources.factory.Get();
    DrawWaves(target, targetFactory, resources.wave.Get(), plate.left + 10.0f, plate.right - 10.0f,
              plate.bottom - 4.0f, 5.0f);
    DrawWhale(target, targetFactory, resources.whale.Get(), plate.right - 16.0f,
              (plate.top + plate.bottom) * 0.5f, 18.0f);
    if (options.decoration && !options.reducedMotion && !options.stopping) {
      DrawBubbles(target, resources.wave.Get(), plate.left + 8.0f, plate.right - 24.0f, plate.bottom - 5.0f,
                  plate.top + 8.0f, nowMs);
    }
  } else {
    target->FillRoundedRectangle(D2D1::RoundedRect(plate, radius * 0.45f, radius * 0.45f), resources.plainPlate.Get());
  }
  ID2D1SolidColorBrush* textBrush = ocean ? resources.text.Get() : resources.plainText.Get();
  const wchar_t* status = options.stopping ? L"Stopping…" : L"Agent is using your computer";
  const wchar_t* cancel = options.stopping ? L"Esc was pressed" : L"Esc to cancel";
  const int slot = options.stopping ? 1 : 0;
  if (!resources.widthsMeasured) {
    resources.statusWidth[0] = MeasureText(resources, resources.statusFormat.Get(), L"Agent is using your computer");
    resources.statusWidth[1] = MeasureText(resources, resources.statusFormat.Get(), L"Stopping…");
    resources.cancelWidth[0] = MeasureText(resources, resources.cancelFormat.Get(), L"Esc to cancel");
    resources.cancelWidth[1] = MeasureText(resources, resources.cancelFormat.Get(), L"Esc was pressed");
    resources.widthsMeasured = resources.statusWidth[0] > 0.0f;
  }
  const float textLeft = layout.textLeftDip;
  const float textRight = layout.textRightDip;
  const float wrapWidth = std::max(40.0f, textRight - textLeft);
  // 文字不呼吸、不缩放：位置只由布局与量出来的宽度决定；布局按可用宽度建一次再复用。
  const float statusY = layout.statusRowTopDip;
  const float cancelY = layout.cancelRowTopDip;
  const bool twoRows = layout.compact;
  const float statusX = textLeft;
  const float cancelX = twoRows ? textLeft : std::max(textLeft, textRight - resources.cancelWidth[slot]);
  if (EnsureTextLayouts(resources, wrapWidth)) {
    if (resources.statusLayouts[slot] != nullptr) {
      target->DrawTextLayout(D2D1::Point2F(statusX, statusY), resources.statusLayouts[slot].Get(), textBrush,
                             D2D1_DRAW_TEXT_OPTIONS_NONE);
    }
    if (resources.cancelLayouts[slot] != nullptr) {
      target->DrawTextLayout(D2D1::Point2F(cancelX, cancelY), resources.cancelLayouts[slot].Get(), textBrush,
                             D2D1_DRAW_TEXT_OPTIONS_NONE);
    }
  }
  (void)status;
  (void)cancel;
  const HRESULT draw = target->EndDraw();
  resources.lastHr = draw;
  resources.draws += 1;
  (void)widthDip;
  (void)heightDip;
  return SUCCEEDED(draw);
}

}  // namespace banner
