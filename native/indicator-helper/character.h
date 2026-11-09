// C 版角色资源：加载、按可见高度缩放、预缩放缓存、贴图（方案 4.1 / 4.2 / 5.3 / 6.3）。
//
// 相对 1.50.1 的三处实质改动：
//
//   1. **尺寸按"人物可见高度"算**，不是整张透明画布。pack 里每个片段带 `contentBounds`（该片段
//      全部帧的稳定包围范围）与 `anchorPx`（包围范围底边中点）；scale = 目标可见高度 / 包围高度。
//      这样透明边距不再吃掉设置值，也不会因为逐帧自动居中而让整个人物跳动。
//   2. **缩放只在资源准备阶段做一次**：按目标像素高度用面积滤波把整格缩到最终尺寸，运行时只做
//      预乘 alpha 混合。1.50.1 是每帧对每个输出像素做四点双线性（512px 画布缩到 52px 时接近
//      10 倍缩小，细线会闪）。
//   3. **按需解码 + 有界缓存**：pack 只读元数据；某个片段第一次要用时才解码它的图集并生成缓存，
//      同时最多留 3 份（片段 × 目标高度），超过软上限按最旧淘汰。7 张图集全量常驻约 42 MiB 是
//      1.50.1 的行为，不再保留。
//
// 支持的资源模式：
//   - `composite`：完整合成帧（尾巴与头发已经画在帧里）。二级动作不发生，健康度如实报 composite。
//   - `layered`：主体帧 + 至多 6 个活动部件（尾巴/发束/呆毛）。部件按 pivot + 相位偏移平移，
//     一个周期最多 32 个栅格相位由调用方决定是否预渲染；这里只做"选相位并平移"。
//
// 这个头文件不认识协议、不认识窗口：只提供加载、缓存、取帧与贴图。

#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <wincodec.h>
#include <wrl/client.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <chrono>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace character {

using Microsoft::WRL::ComPtr;

/* ----------------------------------------------------------------- sha256 -- */

/// 资源完整性校验用（pack.json 里的 sha256 必须与图集字节一致）。
class Sha256 {
 public:
  Sha256() { Reset(); }
  void Reset() {
    length_ = 0;
    block_ = 0;
    const uint32_t initial[8] = {0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
                                 0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u};
    std::memcpy(state_, initial, sizeof(state_));
  }
  void Update(const void* data, size_t size) {
    const auto* bytes = static_cast<const uint8_t*>(data);
    size_t remaining = size;
    while (remaining > 0) {
      const size_t take = std::min(remaining, static_cast<size_t>(64 - block_));
      std::memcpy(buffer_ + block_, bytes, take);
      block_ += take;
      bytes += take;
      remaining -= take;
      length_ += take;
      if (block_ == 64) {
        Transform(buffer_);
        block_ = 0;
      }
    }
  }
  std::string Hex() {
    const uint64_t bits = length_ * 8;
    const uint8_t pad = 0x80;
    Update(&pad, 1);
    const uint8_t zero = 0;
    while (block_ != 56) Update(&zero, 1);
    uint8_t trailer[8];
    for (int i = 0; i < 8; i += 1) trailer[i] = static_cast<uint8_t>((bits >> (56 - i * 8)) & 0xFF);
    Update(trailer, 8);
    static const char* digits = "0123456789abcdef";
    std::string out;
    out.reserve(64);
    for (int i = 0; i < 8; i += 1) {
      for (int shift = 28; shift >= 0; shift -= 4) out.push_back(digits[(state_[i] >> shift) & 0xF]);
    }
    return out;
  }

 private:
  static uint32_t Rotr(uint32_t value, int bits) { return (value >> bits) | (value << (32 - bits)); }
  void Transform(const uint8_t* chunk) {
    static const uint32_t constants[64] = {
        0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
        0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u, 0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
        0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
        0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
        0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u, 0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
        0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
        0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
        0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u, 0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u};
    uint32_t w[64];
    for (int i = 0; i < 16; i += 1) {
      w[i] = (static_cast<uint32_t>(chunk[i * 4]) << 24) | (static_cast<uint32_t>(chunk[i * 4 + 1]) << 16) |
             (static_cast<uint32_t>(chunk[i * 4 + 2]) << 8) | static_cast<uint32_t>(chunk[i * 4 + 3]);
    }
    for (int i = 16; i < 64; i += 1) {
      const uint32_t s0 = Rotr(w[i - 15], 7) ^ Rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
      const uint32_t s1 = Rotr(w[i - 2], 17) ^ Rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    uint32_t a = state_[0], b = state_[1], c = state_[2], d = state_[3];
    uint32_t e = state_[4], f = state_[5], g = state_[6], h = state_[7];
    for (int i = 0; i < 64; i += 1) {
      const uint32_t s1 = Rotr(e, 6) ^ Rotr(e, 11) ^ Rotr(e, 25);
      const uint32_t ch = (e & f) ^ ((~e) & g);
      const uint32_t temp1 = h + s1 + ch + constants[i] + w[i];
      const uint32_t s0 = Rotr(a, 2) ^ Rotr(a, 13) ^ Rotr(a, 22);
      const uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
      const uint32_t temp2 = s0 + maj;
      h = g;
      g = f;
      f = e;
      e = d + temp1;
      d = c;
      c = b;
      b = a;
      a = temp1 + temp2;
    }
    state_[0] += a; state_[1] += b; state_[2] += c; state_[3] += d;
    state_[4] += e; state_[5] += f; state_[6] += g; state_[7] += h;
  }

  uint32_t state_[8]{};
  uint64_t length_ = 0;
  uint8_t buffer_[64]{};
  size_t block_ = 0;
};

/* ------------------------------------------------------------------ model -- */

/// 一个活动部件的运动轨迹（分层资源）。
struct PartMotion {
  /// 'x' 或 'y'：平移轴。
  char axis = 'x';
  /// 幅度（相对可见高度）。
  float amplitude = 0.03f;
  /// 周期（毫秒）。
  float periodMs = 3000.0f;
  /// 相位偏移（相对主相位，0..1）。
  float phase = 0.0f;
};

/// 活动部件（尾巴、发束、呆毛…）。最多 6 个。
struct Part {
  // v3: resolve atlas as <clip>-<atlas>, with the body clip grid/count.
  bool perClip = false;
  std::string name;
  std::string atlas;
  int frameWidth = 0;
  int frameHeight = 0;
  int columns = 1;
  int rows = 1;
  int frameCount = 0;
  /// 部件在**主体帧坐标系**里的挂点（像素，相对主体帧左上角）。
  int pivotX = 0;
  int pivotY = 0;
  int zOrder = 0;
  /// 部件帧的可见包围范围（相对部件帧左上角）。
  int contentLeft = 0;
  int contentTop = 0;
  int contentWidth = 0;
  int contentHeight = 0;
  PartMotion motion;
};

/// 一个片段（一个状态的图集与时长）。
struct Clip {
  std::string name;
  std::string atlas;
  int frameWidth = 384;
  int frameHeight = 512;
  int columns = 4;
  int rows = 2;
  int frameCount = 0;
  bool loop = false;
  std::vector<int> durationsMs;
  int totalMs = 0;
  /// 可见主体锚点（帧坐标，像素）：contentBounds 的底边中点。
  int anchorX = 192;
  int anchorY = 480;
  /// 该片段**全部帧**的稳定包围范围（帧坐标）。为 0 时由加载器从像素里算一次。
  int contentLeft = 0;
  int contentTop = 0;
  int contentWidth = 0;
  int contentHeight = 0;
  /// 可选的共享帧引用（v2）：`frameRefs[i]` 指向同片段内的另一个帧，缺省为自身。
  std::vector<int> frameRefs;
  /// 方案 五.4：该片段要画的部件（已按 zOrder 排好、perClip 已解析）。
  /// 以前每帧都要复制 Part、拼字符串、stable_sort，这里在加载时做一次。
  std::vector<Part> parts;
  /// 图集字节的 sha256（pack 里给了就必须对上；对不上按坏包处理）。
  std::string sha256;
  bool boundsMeasured = false;

  int FrameWidth() const { return frameWidth; }
  int FrameHeight() const { return frameHeight; }
};

enum class RenderMode { Composite, Layered };

/**
 * 一条跨片段切换规则（方案 三·问题 F，可选文件 `transitions.json`）。
 *
 * `entryFrame` 是进入 `to` 时该显示的第一帧：由 `tools/character-transitions.py` 把 to 的每一帧
 * 与 from 的全部帧逐一比较后选出，避免"循环片段共用进程相位、每次从哪一帧进来全看运气"。
 * `fadeMs` 是同一缓冲区内预乘 alpha 混合的时长；0 表示直接切。
 */
struct Transition {
  std::string from;
  std::string to;
  int entryFrame = 0;
  int fadeMs = 0;
};

/// 解析后的 pack。
struct Assets {
  bool ok = false;
  std::string error;
  int schemaVersion = 0;
  std::string assetVersion;
  std::string alphaMode;
  std::string dirUtf8;
  std::wstring dir;
  RenderMode mode = RenderMode::Composite;
  std::vector<Clip> clips;
  std::vector<Part> parts;
  /// 可选的跨片段进入帧表（transitions.json）。空表 = 全部退回 frame 0、不混合。
  std::vector<Transition> transitions;
  /// transitions.json 的问题（不致命：运行时退回 frame 0、不混合）。
  std::string transitionError;
  /// 深度上限：图片像素总数（防止坏包让加载器吃光内存）。
  long long maxAtlasPixels = 64ll * 1024 * 1024;

  Clip* Find(const std::string& name) {
    for (Clip& clip : clips) {
      if (clip.name == name) return &clip;
    }
    return nullptr;
  }
  const Clip* Find(const std::string& name) const {
    for (const Clip& clip : clips) {
      if (clip.name == name) return &clip;
    }
    return nullptr;
  }
  const Transition* FindTransition(const std::string& from, const std::string& to) const {
    for (const Transition& transition : transitions) {
      if (transition.from == from && transition.to == to) return &transition;
    }
    return nullptr;
  }
};

/* ------------------------------------------------------------------ json -- */

namespace json {

inline size_t SkipSpace(const std::string& text, size_t at) {
  while (at < text.size() && (text[at] == ' ' || text[at] == '\t' || text[at] == '\r' || text[at] == '\n')) at += 1;
  return at;
}

inline bool ReadString(const std::string& text, size_t& at, std::string& out) {
  at = SkipSpace(text, at);
  if (at >= text.size() || text[at] != '"') return false;
  at += 1;
  out.clear();
  while (at < text.size() && text[at] != '"') {
    if (text[at] == '\\' && at + 1 < text.size()) at += 1;
    out.push_back(text[at]);
    at += 1;
  }
  if (at >= text.size()) return false;
  at += 1;
  return true;
}

inline bool ReadNumber(const std::string& text, size_t& at, double& out) {
  at = SkipSpace(text, at);
  const size_t start = at;
  while (at < text.size() && (isdigit(static_cast<unsigned char>(text[at])) || text[at] == '-' || text[at] == '+' ||
                              text[at] == '.' || text[at] == 'e' || text[at] == 'E')) {
    at += 1;
  }
  if (at == start) return false;
  out = strtod(text.substr(start, at - start).c_str(), nullptr);
  return true;
}

inline bool ReadBoolOrNull(const std::string& text, size_t& at, bool& out, bool& isNull) {
  at = SkipSpace(text, at);
  isNull = false;
  if (text.compare(at, 4, "true") == 0) { out = true; at += 4; return true; }
  if (text.compare(at, 5, "false") == 0) { out = false; at += 5; return true; }
  if (text.compare(at, 4, "null") == 0) { out = false; isNull = true; at += 4; return true; }
  return false;
}

/// 跳过任意值（用于不认识的对象/数组）。
inline bool SkipValue(const std::string& text, size_t& at) {
  at = SkipSpace(text, at);
  if (at >= text.size()) return false;
  const char ch = text[at];
  if (ch == '"') {
    std::string ignored;
    return ReadString(text, at, ignored);
  }
  if (ch == '{' || ch == '[') {
    const char close = ch == '{' ? '}' : ']';
    int depth = 0;
    while (at < text.size()) {
      if (text[at] == '"') {
        std::string ignored;
        if (!ReadString(text, at, ignored)) return false;
        continue;
      }
      if (text[at] == ch) depth += 1;
      else if (text[at] == close) {
        depth -= 1;
        if (depth == 0) {
          at += 1;
          return true;
        }
      }
      at += 1;
    }
    return false;
  }
  double number = 0;
  if (ReadNumber(text, at, number)) return true;
  if (text.compare(at, 4, "true") == 0) { at += 4; return true; }
  if (text.compare(at, 5, "false") == 0) { at += 5; return true; }
  if (text.compare(at, 4, "null") == 0) { at += 4; return true; }
  return false;
}

/// 从 `objectStart`（指向 `{`）里找 key 的值位置；找不到返回 false。
inline bool FindKey(const std::string& text, size_t objectStart, const std::string& key, size_t& valueAt) {
  size_t at = SkipSpace(text, objectStart);
  if (at >= text.size() || text[at] != '{') return false;
  at += 1;
  while (at < text.size()) {
    at = SkipSpace(text, at);
    if (at < text.size() && text[at] == '}') return false;
    std::string name;
    if (!ReadString(text, at, name)) return false;
    at = SkipSpace(text, at);
    if (at >= text.size() || text[at] != ':') return false;
    at += 1;
    const size_t valueStart = SkipSpace(text, at);
    if (name == key) {
      valueAt = valueStart;
      return true;
    }
    if (!SkipValue(text, at)) return false;
    at = SkipSpace(text, at);
    if (at < text.size() && text[at] == ',') at += 1;
  }
  return false;
}

/// 读一个数字数组（`[1,2,3]`）。
inline bool ReadNumberArray(const std::string& text, size_t at, std::vector<double>& out) {
  at = SkipSpace(text, at);
  if (at >= text.size() || text[at] != '[') return false;
  at += 1;
  while (at < text.size()) {
    at = SkipSpace(text, at);
    if (at < text.size() && text[at] == ']') return true;
    double number = 0;
    if (!ReadNumber(text, at, number)) return false;
    out.push_back(number);
    at = SkipSpace(text, at);
    if (at < text.size() && text[at] == ',') at += 1;
  }
  return false;
}

}  // namespace json

/* ------------------------------------------------------------------- wic -- */

/// 读一个 PNG 成**直通** BGRA（预乘在缩放进缓存时一次完成）。
inline bool DecodePng(const std::wstring& path, std::vector<uint32_t>& out, int& width, int& height, std::string& error) {
  ComPtr<IWICImagingFactory> factory;
  if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory)))) {
    error = "WIC factory could not be created";
    return false;
  }
  ComPtr<IWICBitmapDecoder> decoder;
  if (FAILED(factory->CreateDecoderFromFilename(path.c_str(), nullptr, GENERIC_READ, WICDecodeMetadataCacheOnLoad, &decoder))) {
    error = "the atlas could not be opened";
    return false;
  }
  ComPtr<IWICBitmapFrameDecode> frame;
  if (FAILED(decoder->GetFrame(0, &frame))) {
    error = "the atlas has no frame";
    return false;
  }
  ComPtr<IWICFormatConverter> converter;
  if (FAILED(factory->CreateFormatConverter(&converter))) {
    error = "WIC converter could not be created";
    return false;
  }
  if (FAILED(converter->Initialize(frame.Get(), GUID_WICPixelFormat32bppBGRA, WICBitmapDitherTypeNone, nullptr, 0.0,
                                   WICBitmapPaletteTypeCustom))) {
    error = "the atlas could not be converted to BGRA";
    return false;
  }
  UINT w = 0;
  UINT h = 0;
  converter->GetSize(&w, &h);
  if (w == 0 || h == 0) {
    error = "the atlas has no pixels";
    return false;
  }
  width = static_cast<int>(w);
  height = static_cast<int>(h);
  const size_t count = static_cast<size_t>(w) * h;
  out.resize(count);
  if (FAILED(converter->CopyPixels(nullptr, w * 4, static_cast<UINT>(count * 4), reinterpret_cast<BYTE*>(out.data())))) {
    error = "the atlas pixels could not be read";
    return false;
  }
  return true;
}

/// 文件字节的 sha256（与 pack.json 里的值比对）。
inline bool FileSha256(const std::wstring& path, std::string& hex) {
  HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;
  Sha256 sha;
  std::vector<BYTE> buffer(1 << 16);
  DWORD read = 0;
  while (ReadFile(file, buffer.data(), static_cast<DWORD>(buffer.size()), &read, nullptr) && read > 0) {
    sha.Update(buffer.data(), read);
  }
  CloseHandle(file);
  hex = sha.Hex();
  return true;
}

/* --------------------------------------------------------------- loading -- */

inline bool ReadTextFile(const std::wstring& path, std::string& out, std::string& error) {
  HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) {
    error = "file not found";
    return false;
  }
  LARGE_INTEGER size{};
  GetFileSizeEx(file, &size);
  if (size.QuadPart <= 0 || size.QuadPart > 4 * 1024 * 1024) {
    CloseHandle(file);
    error = "file is empty or unreasonably large";
    return false;
  }
  out.assign(static_cast<size_t>(size.QuadPart), '\0');
  DWORD read = 0;
  const BOOL ok = ReadFile(file, out.data(), static_cast<DWORD>(out.size()), &read, nullptr);
  CloseHandle(file);
  if (!ok) {
    error = "file could not be read";
    return false;
  }
  return true;
}

/// 资源路径必须落在资源目录内：拒绝 `..`、绝对路径、盘符与 UNC。
inline bool SafeAtlasName(const std::string& name, std::string& error) {
  if (name.empty()) {
    error = "atlas name is empty";
    return false;
  }
  if (name.find("..") != std::string::npos || name.find(':') != std::string::npos || name[0] == '\\' || name[0] == '/') {
    error = "atlas path escapes the asset directory: " + name;
    return false;
  }
  return true;
}

inline bool ReadPair(const std::string& text, size_t at, int& first, int& second, bool& present) {
  std::vector<double> values;
  present = json::ReadNumberArray(text, at, values) && values.size() >= 2;
  if (!present) return false;
  first = static_cast<int>(std::lround(values[0]));
  second = static_cast<int>(std::lround(values[1]));
  return true;
}

/**
 * 读可选的 `transitions.json`（方案 三·问题 F）。文件不存在、schema 不认识或字段越界时
 * **不致命**：清空表，运行时就退回"进入 frame 0、不混合"，并在 error 里留下原因。
 */
inline void LoadTransitions(const std::wstring& dir, Assets& out) {
  std::string text;
  std::string error;
  if (!ReadTextFile(dir + L"\\transitions.json", text, error)) return;  // 可选文件：没有就是默认策略
  const size_t root = json::SkipSpace(text, 0);
  size_t at = 0;
  std::string schema;
  if (!json::FindKey(text, root, "schema", at) || !json::ReadString(text, at, schema)) {
    out.transitionError = "transitions.json has no schema; falling back to frame 0";
    return;
  }
  if (schema != "dsh.character.transitions/v1") {
    out.transitionError = "transitions.json has an unknown schema (" + schema + "); falling back to frame 0";
    return;
  }
  size_t pairsAt = 0;
  if (!json::FindKey(text, root, "pairs", pairsAt)) {
    out.transitionError = "transitions.json has no pairs; falling back to frame 0";
    return;
  }
  size_t cursor = json::SkipSpace(text, pairsAt);
  if (cursor >= text.size() || text[cursor] != '[') {
    out.transitionError = "transitions.json pairs is not an array; falling back to frame 0";
    return;
  }
  cursor += 1;
  while (cursor < text.size()) {
    cursor = json::SkipSpace(text, cursor);
    if (cursor >= text.size()) break;
    if (text[cursor] == ']') break;
    if (text[cursor] == ',') {
      cursor += 1;
      continue;
    }
    if (text[cursor] != '{') break;
    const size_t objectAt = cursor;
    Transition transition;
    size_t valueAt = 0;
    if (json::FindKey(text, objectAt, "from", valueAt)) json::ReadString(text, valueAt, transition.from);
    if (json::FindKey(text, objectAt, "to", valueAt)) json::ReadString(text, valueAt, transition.to);
    double number = 0;
    if (json::FindKey(text, objectAt, "entryFrame", valueAt) && json::ReadNumber(text, valueAt, number)) {
      transition.entryFrame = static_cast<int>(std::lround(number));
    }
    if (json::FindKey(text, objectAt, "fadeMs", valueAt) && json::ReadNumber(text, valueAt, number)) {
      transition.fadeMs = static_cast<int>(std::lround(number));
    }
    if (json::SkipValue(text, cursor)) {
      if (transition.from.empty() || transition.to.empty()) continue;
      if (transition.entryFrame < 0) transition.entryFrame = 0;
      if (transition.fadeMs < 0) transition.fadeMs = 0;
      if (transition.fadeMs > 200) transition.fadeMs = 200;  // 方案只允许 80–120 ms 的短过渡
      const Clip* target = out.Find(transition.to);
      if (target != nullptr && transition.entryFrame >= target->frameCount) {
        transition.entryFrame = 0;  // 越界就退回首帧，不猜
      }
      out.transitions.push_back(transition);
    } else {
      break;
    }
  }
}

/**
 * 读 `pack.json` 的**元数据**（图集按需解码）。支持 v1（只读兼容）、v2 与 v3。
 *
 * @param dir - 资源目录（UTF-16）。
 * @param out - 结果；失败时 `out.error` 说明原因。
 */
inline bool Load(const std::wstring& dir, Assets& out) {
  out.dir = dir;
  std::string text;
  std::string error;
  if (!ReadTextFile(dir + L"\\pack.json", text, error)) {
    out.error = "pack.json: " + error;
    return false;
  }
  const size_t root = json::SkipSpace(text, 0);
  size_t at = 0;
  std::string schema;
  if (!json::FindKey(text, root, "schema", at) || !json::ReadString(text, at, schema)) {
    out.error = "pack.json has no schema";
    return false;
  }
  if (schema == "dsh.character.pack/v1") {
    out.schemaVersion = 1;
  } else if (schema == "dsh.character.pack/v2") {
    out.schemaVersion = 2;
  } else if (schema == "dsh.character.pack/v3") {
    out.schemaVersion = 3;
  } else {
    // 未知版本显式拒绝：不猜、不半读（方案 5.3）。
    out.error = "unsupported pack schema: " + schema;
    return false;
  }
  if (!json::FindKey(text, root, "assetVersion", at) || !json::ReadString(text, at, out.assetVersion)) {
    out.error = "pack.json has no assetVersion";
    return false;
  }
  if (json::FindKey(text, root, "alpha", at)) json::ReadString(text, at, out.alphaMode);
  // v1 的画布/网格是全局的；v2 每片段自带。
  int canvasWidth = 384;
  int canvasHeight = 512;
  int gridColumns = 4;
  int gridRows = 2;
  if (out.schemaVersion == 1) {
    size_t sectionAt = 0;
    if (json::FindKey(text, root, "canvas", sectionAt)) {
      size_t valueAt = 0;
      double number = 0;
      if (json::FindKey(text, sectionAt, "width", valueAt) && json::ReadNumber(text, valueAt, number)) canvasWidth = static_cast<int>(number);
      if (json::FindKey(text, sectionAt, "height", valueAt) && json::ReadNumber(text, valueAt, number)) canvasHeight = static_cast<int>(number);
    }
    if (json::FindKey(text, root, "grid", sectionAt)) {
      size_t valueAt = 0;
      double number = 0;
      if (json::FindKey(text, sectionAt, "columns", valueAt) && json::ReadNumber(text, valueAt, number)) gridColumns = static_cast<int>(number);
      if (json::FindKey(text, sectionAt, "rows", valueAt) && json::ReadNumber(text, valueAt, number)) gridRows = static_cast<int>(number);
    }
    if (canvasWidth <= 0 || canvasHeight <= 0 || gridColumns <= 0 || gridRows <= 0) {
      out.error = "pack.json canvas/grid is not usable";
      return false;
    }
  }
  // renderMode：显式声明时以它为准；否则按有没有 parts 推断。
  std::string renderMode;
  if (json::FindKey(text, root, "renderMode", at)) json::ReadString(text, at, renderMode);

  size_t clipsAt = 0;
  if (!json::FindKey(text, root, "clips", clipsAt)) {
    out.error = "pack.json has no clips";
    return false;
  }
  size_t cursor = json::SkipSpace(text, clipsAt);
  if (cursor >= text.size() || text[cursor] != '{') {
    out.error = "clips is not an object";
    return false;
  }
  cursor += 1;
  while (cursor < text.size()) {
    cursor = json::SkipSpace(text, cursor);
    if (cursor < text.size() && text[cursor] == '}') break;
    Clip clip;
    clip.frameWidth = canvasWidth;
    clip.frameHeight = canvasHeight;
    clip.columns = gridColumns;
    clip.rows = gridRows;
    if (!json::ReadString(text, cursor, clip.name)) {
      out.error = "a clip name could not be read";
      return false;
    }
    cursor = json::SkipSpace(text, cursor);
    if (cursor >= text.size() || text[cursor] != ':') {
      out.error = "a clip is missing its value";
      return false;
    }
    cursor += 1;
    const size_t clipStart = json::SkipSpace(text, cursor);
    size_t valueAt = 0;
    if (!json::FindKey(text, clipStart, "atlas", valueAt) || !json::ReadString(text, valueAt, clip.atlas)) {
      out.error = clip.name + ": no atlas";
      return false;
    }
    if (!SafeAtlasName(clip.atlas, out.error)) {
      out.error = clip.name + ": " + out.error;
      return false;
    }
    double number = 0;
    bool numbersPresent = false;
    if (json::FindKey(text, clipStart, "frameSize", valueAt)) {
      if (!ReadPair(text, valueAt, clip.frameWidth, clip.frameHeight, numbersPresent)) {
        out.error = clip.name + ": frameSize must be [width, height]";
        return false;
      }
    }
    if (json::FindKey(text, clipStart, "grid", valueAt)) {
      if (!ReadPair(text, valueAt, clip.columns, clip.rows, numbersPresent)) {
        out.error = clip.name + ": grid must be [columns, rows]";
        return false;
      }
    }
    if (json::FindKey(text, clipStart, "contentBounds", valueAt)) {
      std::vector<double> values;
      if (!json::ReadNumberArray(text, valueAt, values) || values.size() < 4) {
        out.error = clip.name + ": contentBounds must be [x, y, width, height]";
        return false;
      }
      clip.contentLeft = static_cast<int>(std::lround(values[0]));
      clip.contentTop = static_cast<int>(std::lround(values[1]));
      clip.contentWidth = static_cast<int>(std::lround(values[2]));
      clip.contentHeight = static_cast<int>(std::lround(values[3]));
      clip.boundsMeasured = clip.contentWidth > 0 && clip.contentHeight > 0;
    }
    if (json::FindKey(text, clipStart, "frameCount", valueAt) && json::ReadNumber(text, valueAt, number)) {
      clip.frameCount = static_cast<int>(number);
    }
    if (json::FindKey(text, clipStart, "totalMs", valueAt) && json::ReadNumber(text, valueAt, number)) {
      clip.totalMs = static_cast<int>(number);
    }
    if (json::FindKey(text, clipStart, "loop", valueAt)) {
      const size_t value = json::SkipSpace(text, valueAt);
      clip.loop = text.compare(value, 4, "true") == 0;
    }
    if (json::FindKey(text, clipStart, "durationsMs", valueAt)) {
      std::vector<double> values;
      if (!json::ReadNumberArray(text, valueAt, values)) {
        out.error = clip.name + ": durationsMs is not an array";
        return false;
      }
      for (const double ms : values) clip.durationsMs.push_back(static_cast<int>(std::lround(ms)));
    }
    if (json::FindKey(text, clipStart, "anchorPx", valueAt)) {
      if (!ReadPair(text, valueAt, clip.anchorX, clip.anchorY, numbersPresent)) {
        out.error = clip.name + ": anchorPx must be [x, y]";
        return false;
      }
    }
    if (json::FindKey(text, clipStart, "frameRefs", valueAt)) {
      std::vector<double> values;
      if (!json::ReadNumberArray(text, valueAt, values)) {
        out.error = clip.name + ": frameRefs is not an array";
        return false;
      }
      for (const double one : values) clip.frameRefs.push_back(static_cast<int>(std::lround(one)));
    }
    if (json::FindKey(text, clipStart, "sha256", valueAt)) json::ReadString(text, valueAt, clip.sha256);
    // 校验：容量、时长、越界与像素数（方案 5.3）。
    if (clip.frameCount <= 0) {
      out.error = clip.name + ": frameCount is not positive";
      return false;
    }
    if (static_cast<int>(clip.durationsMs.size()) != clip.frameCount) {
      out.error = clip.name + ": durations do not match frameCount";
      return false;
    }
    if (clip.columns <= 0 || clip.rows <= 0) {
      out.error = clip.name + ": the grid is empty";
      return false;
    }
    const long long capacity = static_cast<long long>(clip.columns) * clip.rows;
    if (capacity < clip.frameCount) {
      out.error = clip.name + ": the grid holds " + std::to_string(capacity) + " cells but the clip has " +
                  std::to_string(clip.frameCount) + " frames";
      return false;
    }
    if (clip.frameWidth <= 0 || clip.frameHeight <= 0 || clip.frameWidth > 4096 || clip.frameHeight > 4096) {
      out.error = clip.name + ": frameSize is out of range";
      return false;
    }
    if (static_cast<long long>(clip.frameWidth) * clip.columns > 8192 ||
        static_cast<long long>(clip.frameHeight) * clip.rows > 8192) {
      out.error = clip.name + ": the atlas dimensions are out of range";
      return false;
    }
    int total = 0;
    for (const int ms : clip.durationsMs) {
      if (ms <= 0 || ms > 8000) {
        out.error = clip.name + ": a frame duration is out of range (1..8000 ms)";
        return false;
      }
      total += ms;
    }
    if (total > 20000) {
      out.error = clip.name + ": the clip runs longer than 20 s";
      return false;
    }
    clip.totalMs = total;
    if (clip.frameRefs.size() != 0 && clip.frameRefs.size() != static_cast<size_t>(clip.frameCount)) {
      out.error = clip.name + ": frameRefs must have frameCount entries";
      return false;
    }
    for (const int ref : clip.frameRefs) {
      if (ref < 0 || ref >= clip.frameCount) {
        out.error = clip.name + ": frameRefs points outside the clip";
        return false;
      }
    }
    out.clips.push_back(std::move(clip));
    cursor = json::SkipSpace(text, cursor);
    if (!json::SkipValue(text, cursor)) break;
    cursor = json::SkipSpace(text, cursor);
    if (cursor < text.size() && text[cursor] == ',') cursor += 1;
  }
  if (out.clips.empty()) {
    out.error = "pack.json holds no usable clip";
    return false;
  }
  // 部件（可选；最多 6 个 —— 方案 4.6 的上限）。
  size_t partsAt = 0;
  if (json::FindKey(text, root, "parts", partsAt)) {
    size_t partsCursor = json::SkipSpace(text, partsAt);
    if (partsCursor < text.size() && text[partsCursor] == '[') {
      partsCursor += 1;
      while (partsCursor < text.size()) {
        partsCursor = json::SkipSpace(text, partsCursor);
        if (partsCursor < text.size() && text[partsCursor] == ']') break;
        Part part;
        size_t valueAt = 0;
        const size_t partStart = partsCursor;
        part.name = "part" + std::to_string(out.parts.size());
        if (json::FindKey(text, partStart, "name", valueAt)) json::ReadString(text, valueAt, part.name);
        if (!json::FindKey(text, partStart, "atlas", valueAt) || !json::ReadString(text, valueAt, part.atlas)) {
          out.error = "a part has no atlas";
          return false;
        }
        if (!SafeAtlasName(part.atlas, out.error)) return false;
        if (json::FindKey(text, partStart, "perClip", valueAt)) {
          size_t booleanAt = json::SkipSpace(text, valueAt);
          if (text.compare(booleanAt, 4, "true") == 0) part.perClip = true;
          else if (text.compare(booleanAt, 5, "false") != 0) {
            out.error = part.name + ": perClip must be boolean";
            return false;
          }
          if (part.perClip && out.schemaVersion < 3) {
            out.error = "perClip requires dsh.character.pack/v3";
            return false;
          }
        }
        bool present = false;
        if (json::FindKey(text, partStart, "frameSize", valueAt) && !ReadPair(text, valueAt, part.frameWidth, part.frameHeight, present)) {
          out.error = part.name + ": frameSize must be [width, height]";
          return false;
        }
        if (json::FindKey(text, partStart, "grid", valueAt) && !ReadPair(text, valueAt, part.columns, part.rows, present)) {
          out.error = part.name + ": grid must be [columns, rows]";
          return false;
        }
        if (json::FindKey(text, partStart, "pivot", valueAt) && !ReadPair(text, valueAt, part.pivotX, part.pivotY, present)) {
          out.error = part.name + ": pivot must be [x, y]";
          return false;
        }
        if (json::FindKey(text, partStart, "contentBounds", valueAt)) {
          std::vector<double> values;
          if (!json::ReadNumberArray(text, valueAt, values) || values.size() < 4) {
            out.error = part.name + ": contentBounds must be [x, y, width, height]";
            return false;
          }
          part.contentLeft = static_cast<int>(std::lround(values[0]));
          part.contentTop = static_cast<int>(std::lround(values[1]));
          part.contentWidth = static_cast<int>(std::lround(values[2]));
          part.contentHeight = static_cast<int>(std::lround(values[3]));
        }
        double number = 0;
        if (json::FindKey(text, partStart, "frameCount", valueAt) && json::ReadNumber(text, valueAt, number)) part.frameCount = static_cast<int>(number);
        if (json::FindKey(text, partStart, "zOrder", valueAt) && json::ReadNumber(text, valueAt, number)) part.zOrder = static_cast<int>(number);
        size_t motionAt = 0;
        if (json::FindKey(text, partStart, "motion", motionAt)) {
          size_t inner = 0;
          std::string axis;
          if (json::FindKey(text, motionAt, "axis", inner) && json::ReadString(text, inner, axis) && !axis.empty()) part.motion.axis = axis[0];
          if (json::FindKey(text, motionAt, "amplitude", inner) && json::ReadNumber(text, inner, number)) part.motion.amplitude = static_cast<float>(number);
          if (json::FindKey(text, motionAt, "periodMs", inner) && json::ReadNumber(text, inner, number)) part.motion.periodMs = static_cast<float>(number);
          if (json::FindKey(text, motionAt, "phase", inner) && json::ReadNumber(text, inner, number)) part.motion.phase = static_cast<float>(number);
        }
        if (part.frameCount <= 0) part.frameCount = 1;
        if (part.columns <= 0) part.columns = 1;
        if (part.rows <= 0) part.rows = 1;
        if (part.frameWidth <= 0 || part.frameHeight <= 0) {
          out.error = part.name + ": frameSize is out of range";
          return false;
        }
        if (static_cast<long long>(part.columns) * part.rows < part.frameCount) {
          out.error = part.name + ": the grid cannot hold frameCount frames";
          return false;
        }
        out.parts.push_back(std::move(part));
        partsCursor = json::SkipSpace(text, partsCursor);
        if (!json::SkipValue(text, partsCursor)) break;
        partsCursor = json::SkipSpace(text, partsCursor);
        if (partsCursor < text.size() && text[partsCursor] == ',') partsCursor += 1;
      }
    }
    if (out.parts.size() > 6) {
      out.error = "the pack declares more than 6 animated parts";
      return false;
    }
  }
  if (out.parts.empty()) {
    out.mode = RenderMode::Composite;
  } else if (renderMode == "layered" || renderMode.empty()) {
    out.mode = RenderMode::Layered;
  } else if (renderMode == "composite") {
    out.mode = RenderMode::Composite;
    out.parts.clear();
  } else {
    out.error = "unknown renderMode: " + renderMode;
    return false;
  }
  // 分层资源必须声明每个部件的 contentBounds：没有它就没法在目标尺寸上正确定位（方案 5.3）。
  if (out.mode == RenderMode::Layered) {
    for (const Part& part : out.parts) {
      if (part.contentWidth <= 0 || part.contentHeight <= 0) {
        out.error = "part " + part.name + ": layered parts must declare contentBounds";
        return false;
      }
    }
  }
  for (const Part& part : out.parts) {
    if (part.perClip) for (const Clip& clip : out.clips) {
      if (!SafeAtlasName(clip.name + "-" + part.atlas, out.error)) return false;
    }
  }
  // 方案 五.4：把每个片段要画的部件在加载时解析好并按 zOrder 排好，绘制路径不再复制/排序/拼字符串。
  for (Clip& clip : out.clips) {
    clip.parts.clear();
    for (const Part& source : out.parts) {
      Part part = source;
      if (part.perClip) {
        part.name = clip.name + ":" + source.name;
        part.atlas = clip.name + "-" + source.atlas;
        part.frameWidth = clip.frameWidth;
        part.frameHeight = clip.frameHeight;
        part.columns = clip.columns;
        part.rows = clip.rows;
        part.frameCount = clip.frameCount;
      }
      clip.parts.push_back(part);
    }
    std::stable_sort(clip.parts.begin(), clip.parts.end(),
                     [](const Part& a, const Part& b) { return a.zOrder < b.zOrder; });
  }
  out.ok = true;
  // 可选的跨片段进入帧表：没有就保持空表（运行时进入 frame 0、不混合）。
  LoadTransitions(dir, out);
  return true;
}

/* --------------------------------------------------------------- scaling -- */

/// 一帧的预缩放结果：只覆盖可见主体范围，坐标相对锚点。
struct CachedFrame {
  std::vector<uint32_t> pixels;  ///< 预乘 BGRA
  int width = 0;
  int height = 0;
  /// 相对锚点的左上角偏移（像素，通常为 -w/2 与 -h）。
  int offsetX = 0;
  int offsetY = 0;
  size_t Bytes() const { return pixels.size() * sizeof(uint32_t); }
};

/// 一份（片段 × 目标高度）的缓存。
struct ClipCache {
  std::string clip;
  int visibleHeightPx = 0;
  /// 解码后的图集（直通 BGRA），缓存建完后释放（方案 6.3 的"按需释放"）。
  int anchorX = 0;
  int anchorY = 0;
  int contentWidth = 0;
  int contentHeight = 0;
  std::vector<CachedFrame> frames;
  long long lastUsedMs = 0;
  size_t Bytes() const {
    size_t total = 0;
    for (const CachedFrame& frame : frames) total += frame.Bytes();
    return total;
  }
};

/// 面积平均缩放（大幅缩小用）：每个目标像素覆盖的源矩形按面积加权。
inline void ResampleArea(const uint32_t* source, int sourceWidth, int sourceLeft, int sourceTop, int sourceRight,
                         int sourceBottom, int targetWidth, int targetHeight, std::vector<uint32_t>& out) {
  out.assign(static_cast<size_t>(targetWidth) * targetHeight, 0u);
  const float scaleX = static_cast<float>(sourceRight - sourceLeft) / static_cast<float>(targetWidth);
  const float scaleY = static_cast<float>(sourceBottom - sourceTop) / static_cast<float>(targetHeight);
  for (int y = 0; y < targetHeight; y += 1) {
    const float y0 = static_cast<float>(sourceTop) + scaleY * static_cast<float>(y);
    const float y1 = y0 + scaleY;
    const int iy0 = static_cast<int>(std::floor(y0));
    const int iy1 = std::max(iy0 + 1, static_cast<int>(std::ceil(y1)));
    for (int x = 0; x < targetWidth; x += 1) {
      const float x0 = static_cast<float>(sourceLeft) + scaleX * static_cast<float>(x);
      const float x1 = x0 + scaleX;
      const int ix0 = static_cast<int>(std::floor(x0));
      const int ix1 = std::max(ix0 + 1, static_cast<int>(std::ceil(x1)));
      float sumA = 0.0f, sumR = 0.0f, sumG = 0.0f, sumB = 0.0f, sumWeight = 0.0f;
      for (int sy = iy0; sy < iy1; sy += 1) {
        if (sy < sourceTop || sy >= sourceBottom) continue;
        // 源像素在竖直方向的覆盖比例。
        const float coverY = std::min(y1, static_cast<float>(sy + 1)) - std::max(y0, static_cast<float>(sy));
        if (coverY <= 0.0f) continue;
        for (int sx = ix0; sx < ix1; sx += 1) {
          if (sx < sourceLeft || sx >= sourceRight) continue;
          const float coverX = std::min(x1, static_cast<float>(sx + 1)) - std::max(x0, static_cast<float>(sx));
          if (coverX <= 0.0f) continue;
          const float weight = coverX * coverY;
          const uint32_t pixel = source[static_cast<size_t>(sy) * sourceWidth + sx];
          const float a = static_cast<float>((pixel >> 24) & 0xFF);
          // 直通颜色 → 预乘后再加权平均（半透明边缘不会带出底色）。
          sumA += a * weight;
          sumR += static_cast<float>((pixel >> 16) & 0xFF) * a * weight;
          sumG += static_cast<float>((pixel >> 8) & 0xFF) * a * weight;
          sumB += static_cast<float>(pixel & 0xFF) * a * weight;
          sumWeight += weight;
        }
      }
      if (sumWeight <= 0.0f) continue;
      const float alpha = sumA / sumWeight;
      if (alpha <= 0.5f) continue;
      const float normalize = 1.0f / (sumWeight * 255.0f); // premultiplied cache, NOT straight RGB
      const auto channel = [&](float value) { return std::min(255.0f, std::max(0.0f, value * normalize)); };
      const uint32_t a = static_cast<uint32_t>(std::lround(alpha));
      const uint32_t r = static_cast<uint32_t>(std::lround(channel(sumR)));
      const uint32_t g = static_cast<uint32_t>(std::lround(channel(sumG)));
      const uint32_t b = static_cast<uint32_t>(std::lround(channel(sumB)));
      out[static_cast<size_t>(y) * targetWidth + x] = (a << 24) | (r << 16) | (g << 8) | b;
    }
  }
}

/// 双线性放大（目标比源大时用）：预乘空间插值，透明像素不会发灰。
inline void ResampleBilinear(const uint32_t* source, int sourceWidth, int sourceLeft, int sourceTop, int sourceRight,
                             int sourceBottom, int targetWidth, int targetHeight, std::vector<uint32_t>& out) {
  out.assign(static_cast<size_t>(targetWidth) * targetHeight, 0u);
  const int sourceW = sourceRight - sourceLeft;
  const int sourceH = sourceBottom - sourceTop;
  for (int y = 0; y < targetHeight; y += 1) {
    const float sy = (static_cast<float>(y) + 0.5f) * static_cast<float>(sourceH) / static_cast<float>(targetHeight) - 0.5f;
    const int y0 = std::max(0, static_cast<int>(std::floor(sy)));
    const int y1 = std::min(sourceH - 1, y0 + 1);
    const float fy = std::min(1.0f, std::max(0.0f, sy - static_cast<float>(y0)));
    for (int x = 0; x < targetWidth; x += 1) {
      const float sx = (static_cast<float>(x) + 0.5f) * static_cast<float>(sourceW) / static_cast<float>(targetWidth) - 0.5f;
      const int x0 = std::max(0, static_cast<int>(std::floor(sx)));
      const int x1 = std::min(sourceW - 1, x0 + 1);
      const float fx = std::min(1.0f, std::max(0.0f, sx - static_cast<float>(x0)));
      const uint32_t p00 = source[static_cast<size_t>(sourceTop + y0) * sourceWidth + sourceLeft + x0];
      const uint32_t p10 = source[static_cast<size_t>(sourceTop + y0) * sourceWidth + sourceLeft + x1];
      const uint32_t p01 = source[static_cast<size_t>(sourceTop + y1) * sourceWidth + sourceLeft + x0];
      const uint32_t p11 = source[static_cast<size_t>(sourceTop + y1) * sourceWidth + sourceLeft + x1];
      const auto premultiplied = [](uint32_t pixel, int shift) {
        const float channel = static_cast<float>((pixel >> shift) & 0xFF);
        return shift == 24 ? channel : channel * static_cast<float>((pixel >> 24) & 0xFF) / 255.0f;
      };
      const auto blend = [&](int shift) {
        const float a = premultiplied(p00, shift) * (1 - fx) * (1 - fy);
        const float b = premultiplied(p10, shift) * fx * (1 - fy);
        const float c = premultiplied(p01, shift) * (1 - fx) * fy;
        const float d = premultiplied(p11, shift) * fx * fy;
        return static_cast<uint32_t>(std::lround(std::min(255.0f, std::max(0.0f, a + b + c + d))));
      };
      out[static_cast<size_t>(y) * targetWidth + x] =
          (blend(24) << 24) | (blend(16) << 16) | (blend(8) << 8) | blend(0);
    }
  }
}

/* ----------------------------------------------------------------- cache -- */

inline long long ClockMs();

/**
 * 预缩放缓存（方案 4.2 / 6.3 / 五.1）。
 *
 * 键是（片段、目标可见高度像素）。同一个键只用建一次；软上限 32 MiB、硬上限 64 MiB，
 * 超出时按最久未用淘汰（保留当前片段的最后一帧，不做"每帧重建"）。
 *
 * 方案 五.1 的两处约束决定了这里的形状：
 *   - **条目是 shared_ptr**：淘汰只把条目从表里拿掉，正在被绘制线程使用的那一份仍然活着；
 *     以前返回裸指针，`PreparePart` 一扩容就把调用方的指针悬空（代码里还留着"只保留标量"的绕法）。
 *   - **加锁只护表，不护构建**：解码/面积滤波几十毫秒，绝不能在锁里做；构建完再回填，
 *     发现别人已经建好就丢掉自己那份。于是后台预热线程与绘制线程可以同时工作。
 */
class Cache {
 public:
  long long softLimitBytes = 32ll * 1024 * 1024;
  long long hardLimitBytes = 64ll * 1024 * 1024;

  void Configure(const Assets* assets) { assets_ = assets; }

  /// 丢掉全部缓存（DPI/尺寸变化、停止后释放）。调用前应先停掉预热线程。
  void Clear() {
    std::lock_guard<std::mutex> lock(mutex_);
    entries_.clear();
  }

  size_t Bytes() const {
    std::lock_guard<std::mutex> lock(mutex_);
    size_t total = 0;
    for (const auto& entry : entries_) total += entry->Bytes();
    return total;
  }
  size_t EntryCount() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return entries_.size();
  }
  std::string LastError() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return lastError_;
  }
  /// 诊断：UI 线程上真正发生的构建数（预热做好后应当不再增长）。
  long long UiBuilds() const { return uiBuilds_.load(); }
  long long WorkerBuilds() const { return workerBuilds_.load(); }
  long long BuildMs() const { return buildMs_.load(); }
  long long Hits() const { return hits_.load(); }
  long long Misses() const { return misses_.load(); }
  long long Evictions() const { return evictions_.load(); }
  long long Rejected() const { return rejected_.load(); }
  long long TemporaryPeak() const { return temporaryPeak_.load(); }

  /// 组名：部件条目 `part:<clip>:<name>` 归到它所属的片段。
  static std::string GroupOf(const std::string& entryName) {
    if (entryName.rfind("part:", 0) != 0) return entryName;
    const size_t colon = entryName.find(':', 5);
    return colon == std::string::npos ? entryName : entryName.substr(5, colon - 5);
  }

  /**
   * 固定当前正在画的资源组（方案 五.5）：一次完整绘制需要主体 + 两个部件，
   * 淘汰以"组"为单位，且正在用的组不会被淘汰——否则多尺寸切换时会反复解码同一份资源。
   */
  void PinGroups(const std::vector<std::string>& groups) {
    std::lock_guard<std::mutex> lock(mutex_);
    pinned_ = groups;
  }

  /**
   * 预估一个片段在目标高度下要占多少字节（方案 五.5：**分配前**就做预算检查）。
   *
   * 目标帧：目标宽 × 目标高 × 4 × 帧数；解码图集：声明的网格像素 × 4。两者都做溢出检查，
   * 任何一步算不出来就返回 -1（调用方按"超预算"拒绝，而不是先分配再发现）。
   */
  long long EstimateClipBytes(const Clip& clip, int visibleHeightPx) const {
    if (clip.frameWidth <= 0 || clip.frameHeight <= 0 || clip.columns <= 0 || clip.rows <= 0 ||
        clip.frameCount <= 0) {
      return -1;
    }
    const long long atlasPixels =
        static_cast<long long>(clip.frameWidth) * clip.columns * clip.frameHeight * clip.rows;
    if (atlasPixels <= 0 || atlasPixels > (1ll << 31)) return -1;
    const long long contentWidth = clip.contentWidth > 0 ? clip.contentWidth : clip.frameWidth;
    const long long contentHeight = clip.contentHeight > 0 ? clip.contentHeight : clip.frameHeight;
    const long long scaleNumerator = static_cast<long long>(visibleHeightPx) * contentWidth;
    if (scaleNumerator <= 0) return -1;
    const long long targetWidth = (scaleNumerator + contentHeight - 1) / contentHeight;
    const long long targetPixels = targetWidth * visibleHeightPx;
    if (targetPixels <= 0 || targetPixels > (1ll << 31)) return -1;
    const long long frames = static_cast<long long>(clip.frameCount) * targetPixels * 4;
    const long long atlas = atlasPixels * 4;
    if (frames < 0 || atlas < 0 || frames > (1ll << 40) || atlas > (1ll << 40)) return -1;
    return frames + atlas;  // 构建期间两者同时在内存里
  }

  /**
   * 准备某个片段在目标可见高度下的全部帧缓存。失败返回 nullptr 并写 LastError()。
   *
   * 命中时只更新时间戳；未命中时在**锁外**构建，再回填。
   */
  std::shared_ptr<const ClipCache> Prepare(const Clip& clip, int visibleHeightPx, long long nowMs) {
    if (assets_ == nullptr || visibleHeightPx <= 0) return nullptr;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      for (const auto& entry : entries_) {
        if (entry->clip == clip.name && entry->visibleHeightPx == visibleHeightPx) {
          entry->lastUsedMs = nowMs;
          hits_.fetch_add(1);
          return entry;
        }
      }
    }
    misses_.fetch_add(1);
    // 方案 五.5：**先算预算再分配**。以前是建完之后才看硬上限，构建峰值谁也保证不了。
    const long long estimate = EstimateClipBytes(clip, visibleHeightPx);
    if (estimate < 0) {
      std::lock_guard<std::mutex> lock(mutex_);
      lastError_ = clip.name + ": the clip geometry overflows the cache budget";
      rejected_.fetch_add(1);
      return nullptr;
    }
    if (estimate > hardLimitBytes) {
      std::lock_guard<std::mutex> lock(mutex_);
      lastError_ = clip.name + ": estimated cache (" + std::to_string(estimate / (1024 * 1024)) +
                    " MiB) exceeds the hard memory limit";
      rejected_.fetch_add(1);
      return nullptr;
    }
    {
      // 建之前先把空间腾出来：按**组**淘汰最久未用的，正在用的组不动。
      std::lock_guard<std::mutex> lock(mutex_);
      EvictFor(static_cast<size_t>(estimate), clip.name);
      if (BytesLocked() + static_cast<size_t>(estimate) > static_cast<size_t>(hardLimitBytes)) {
        lastError_ = clip.name + ": no room under the hard memory limit after eviction";
        rejected_.fetch_add(1);
        return nullptr;
      }
      // 构建期间的临时峰值 = 现有 + 图集 + 目标帧。
      const long long peak = static_cast<long long>(BytesLocked()) + estimate;
      if (peak > temporaryPeak_.load()) temporaryPeak_.store(peak);
    }
    auto built = std::make_shared<ClipCache>();
    const long long started = ClockMs();
    if (!BuildClip(clip, visibleHeightPx, *built)) {
      const bool worker = std::this_thread::get_id() != uiThread_;
      (worker ? workerBuilds_ : uiBuilds_).fetch_add(1);
      return nullptr;
    }
    built->lastUsedMs = nowMs;
    buildMs_.fetch_add(ClockMs() - started);
    const bool worker = std::this_thread::get_id() != uiThread_;
    (worker ? workerBuilds_ : uiBuilds_).fetch_add(1);
    std::lock_guard<std::mutex> lock(mutex_);
    for (const auto& entry : entries_) {
      if (entry->clip == clip.name && entry->visibleHeightPx == visibleHeightPx) {
        entry->lastUsedMs = nowMs;
        return entry;  // 另一边先建好了：用它的，丢掉自己这份
      }
    }
    entries_.push_back(built);
    Evict(nowMs, clip.name);
    return built;
  }

  /// 记录当前线程是"绘制线程"，UI 线程上的构建会计入 UiBuilds()。
  void MarkUiThread() { uiThread_ = std::this_thread::get_id(); }

  /**
   * 准备一个活动部件的缓存（分层资源）。
   *
   * 部件与主体共用同一套源像素坐标系：`bodyScale` = 目标可见高度 / 主体 contentBounds 高度，
   * 所以部件的目标高度 = 部件 contentBounds 高度 × bodyScale。
   */
  std::shared_ptr<const ClipCache> PreparePart(const Part& part, float bodyScale, long long nowMs) {
    if (part.contentWidth <= 0 || part.contentHeight <= 0) return nullptr;
    Clip clip;
    clip.name = "part:" + part.name;
    clip.atlas = part.atlas;
    clip.frameWidth = part.frameWidth;
    clip.frameHeight = part.frameHeight;
    clip.columns = part.columns;
    clip.rows = part.rows;
    clip.frameCount = part.frameCount;
    clip.loop = true;
    clip.durationsMs.assign(static_cast<size_t>(part.frameCount), 1000);
    clip.totalMs = 1000 * part.frameCount;
    clip.anchorX = part.contentLeft + part.contentWidth / 2;
    clip.anchorY = part.contentTop + part.contentHeight;
    clip.contentLeft = part.contentLeft;
    clip.contentTop = part.contentTop;
    clip.contentWidth = part.contentWidth;
    clip.contentHeight = part.contentHeight;
    clip.boundsMeasured = true;
    const int visible = std::max(1, static_cast<int>(std::lround(static_cast<float>(part.contentHeight) * bodyScale)));
    return Prepare(clip, visible, nowMs);
  }

 private:
  /// 解码图集并量出 contentBounds（v1 没有这些字段，只有这里是唯一需要像素的地方）。
  bool MeasureClip(const Clip& clip, std::vector<uint32_t>& atlas, int& atlasWidth, int& atlasHeight, Clip& measured) {
    const std::wstring path = assets_->dir + L"\\" + std::wstring(clip.atlas.begin(), clip.atlas.end());
    if (!clip.sha256.empty()) {
      // 图集字节必须与 pack 里声明的 sha256 一致：坏资源只降级角色，不进来跑。
      std::string actual;
      if (!FileSha256(path, actual)) {
        lastError_ = clip.name + ": the atlas could not be hashed";
        return false;
      }
      if (actual != clip.sha256) {
        lastError_ = clip.name + ": the atlas sha256 does not match the pack (" + actual.substr(0, 16) + " vs " +
                    clip.sha256.substr(0, 16) + ")";
        return false;
      }
    }
    if (!DecodePng(path, atlas, atlasWidth, atlasHeight, lastError_)) return false;
    if (atlasWidth != clip.frameWidth * clip.columns || atlasHeight != clip.frameHeight * clip.rows) {
      lastError_ = clip.name + ": the atlas is not a " + std::to_string(clip.columns) + "x" + std::to_string(clip.rows) +
                  " grid of " + std::to_string(clip.frameWidth) + "x" + std::to_string(clip.frameHeight) + " cells";
      return false;
    }
    if (static_cast<long long>(atlasWidth) * atlasHeight > assets_->maxAtlasPixels) {
      lastError_ = clip.name + ": the atlas is larger than the pixel budget";
      return false;
    }
    measured = clip;
    if (measured.boundsMeasured) return true;
    // v1 资源：用**全部帧的并集**量一次稳定包围范围（不逐帧自动居中）。
    int left = measured.frameWidth;
    int top = measured.frameHeight;
    int right = 0;
    int bottom = 0;
    constexpr uint32_t kAlphaThreshold = 24;
    for (int index = 0; index < measured.frameCount; index += 1) {
      const int cellX = (index % measured.columns) * measured.frameWidth;
      const int cellY = (index / measured.columns) * measured.frameHeight;
      for (int y = 0; y < measured.frameHeight; y += 1) {
        const uint32_t* row = atlas.data() + static_cast<size_t>(cellY + y) * atlasWidth + cellX;
        for (int x = 0; x < measured.frameWidth; x += 1) {
          if (((row[x] >> 24) & 0xFF) < kAlphaThreshold) continue;
          left = std::min(left, x);
          top = std::min(top, y);
          right = std::max(right, x + 1);
          bottom = std::max(bottom, y + 1);
        }
      }
    }
    if (right <= left || bottom <= top) {
      lastError_ = clip.name + ": every frame is transparent";
      return false;
    }
    measured.contentLeft = left;
    measured.contentTop = top;
    measured.contentWidth = right - left;
    measured.contentHeight = bottom - top;
    measured.anchorX = left + measured.contentWidth / 2;
    measured.anchorY = bottom;
    measured.boundsMeasured = true;
    return true;
  }

  bool BuildClip(const Clip& clip, int visibleHeightPx, ClipCache& entry) {
    std::vector<uint32_t> atlas;
    int atlasWidth = 0;
    int atlasHeight = 0;
    Clip measured;
    if (!MeasureClip(clip, atlas, atlasWidth, atlasHeight, measured)) return false;
    const int contentHeight = std::max(1, measured.contentHeight);
    const float scale = static_cast<float>(visibleHeightPx) / static_cast<float>(contentHeight);
    const int targetWidth = std::max(1, static_cast<int>(std::lround(static_cast<float>(measured.contentWidth) * scale)));
    const int targetHeight = std::max(1, static_cast<int>(std::lround(static_cast<float>(contentHeight) * scale)));
    entry.clip = clip.name;
    entry.visibleHeightPx = visibleHeightPx;
    entry.contentWidth = measured.contentWidth;
    entry.contentHeight = measured.contentHeight;
    entry.anchorX = measured.anchorX;
    entry.anchorY = measured.anchorY;
    for (int index = 0; index < clip.frameCount; index += 1) {
      const int sourceFrame = clip.frameRefs.empty() ? index : clip.frameRefs[static_cast<size_t>(index)];
      const int cellX = (sourceFrame % measured.columns) * measured.frameWidth;
      const int cellY = (sourceFrame / measured.columns) * measured.frameHeight;
      CachedFrame frame;
      frame.width = targetWidth;
      frame.height = targetHeight;
      frame.offsetX = -targetWidth / 2;
      frame.offsetY = -targetHeight;
      const int left = cellX + measured.contentLeft;
      const int top = cellY + measured.contentTop;
      const int right = left + measured.contentWidth;
      const int bottom = top + measured.contentHeight;
      if (scale < 1.0f) {
        ResampleArea(atlas.data(), atlasWidth, left, top, right, bottom, targetWidth, targetHeight, frame.pixels);
      } else {
        ResampleBilinear(atlas.data(), atlasWidth, left, top, right, bottom, targetWidth, targetHeight, frame.pixels);
      }
      entry.frames.push_back(std::move(frame));
    }
    // 预算检查：单份缓存超过硬上限就拒绝（坏包不该把内存吃光）。
    if (static_cast<long long>(entry.Bytes()) > hardLimitBytes) {
      lastError_ = clip.name + ": the scaled cache exceeds the hard memory limit";
      return false;
    }
    return true;
  }

  /// 超软上限时按最久未用淘汰（当前片段之外的先淘汰）。调用方必须已持有 mutex_。
  void Evict(long long nowMs, const std::string& keep) {
    (void)nowMs;
    EvictFor(0, keep);
  }

  /**
   * 按**组**淘汰，直到"现有 + 预留"落进软上限（方案 五.5）。
   *
   * 组 = 一个片段的主体 + 它的部件；正在用的组（pinned_，通常就是当前绘制的那一组）永远不动，
   * 否则一次完整绘制会在半路把自己的部件淘汰掉，下一帧再解码一遍。
   */
  void EvictFor(size_t reserveBytes, const std::string& keepGroup) {
    auto pinned = [&](const std::string& group) {
      if (group == keepGroup) return true;
      for (const std::string& one : pinned_) {
        if (GroupOf(one) == group) return true;
      }
      return false;
    };
    while (entries_.size() > 1 && static_cast<long long>(BytesLocked() + reserveBytes) > softLimitBytes) {
      // 找最久未用的**未固定组**，整组淘汰。
      std::string victimGroup;
      long long victimUsed = 0;
      for (const auto& entry : entries_) {
        const std::string group = GroupOf(entry->clip);
        if (pinned(group)) continue;
        if (victimGroup.empty() || entry->lastUsedMs < victimUsed) {
          victimGroup = group;
          victimUsed = entry->lastUsedMs;
        }
      }
      if (victimGroup.empty()) break;
      const size_t before = entries_.size();
      entries_.erase(std::remove_if(entries_.begin(), entries_.end(),
                                    [&](const std::shared_ptr<ClipCache>& entry) {
                                      return GroupOf(entry->clip) == victimGroup;
                                    }),
                     entries_.end());
      evictions_.fetch_add(static_cast<long long>(before - entries_.size()));
      if (entries_.size() == before) break;  // 防御：没能删掉任何条目就别死循环
    }
  }

  size_t BytesLocked() const {
    size_t total = 0;
    for (const auto& entry : entries_) total += entry->Bytes();
    return total;
  }

  const Assets* assets_ = nullptr;
  std::vector<std::shared_ptr<ClipCache>> entries_;
  mutable std::mutex mutex_;
  std::string lastError_;
  std::thread::id uiThread_ = std::this_thread::get_id();
  std::atomic<long long> uiBuilds_{0};
  std::atomic<long long> workerBuilds_{0};
  std::atomic<long long> buildMs_{0};
  std::atomic<long long> hits_{0};
  std::atomic<long long> misses_{0};
  std::atomic<long long> evictions_{0};
  std::atomic<long long> rejected_{0};
  std::atomic<long long> temporaryPeak_{0};
  /// 正在绘制的资源组（按组名）；淘汰时不动它们。
  std::vector<std::string> pinned_;
};

/// 单调整毫秒（character.h 不依赖 main.cpp 的 NowMs）。
inline long long ClockMs() {
  using namespace std::chrono;
  return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

/// 分层资源里"某片段专用"的部件（`perClip`）：图集与网格跟着片段走（方案 10.3 / v3）。
inline Part PartForClip(const Clip& clip, const Part& source) {
  if (!source.perClip) return source;
  Part part = source;
  part.name = clip.name + ":" + source.name;
  part.atlas = clip.name + "-" + source.atlas;
  part.frameWidth = clip.frameWidth;
  part.frameHeight = clip.frameHeight;
  part.columns = clip.columns;
  part.rows = clip.rows;
  part.frameCount = clip.frameCount;
  return part;
}

/**
 * 把一个片段（主体 + 分层部件）在目标可见高度下准备好（方案 五.1）。
 *
 * 与 `render::DrawCharacter` 用的是同一套准备顺序与缩放口径，所以预热出来的条目就是绘制时会命中的
 * 那些键。返回 false 表示这个片段没准备好（坏资源），调用方继续下一个。
 */
inline bool PrewarmClip(Cache& cache, const Assets& assets, const Clip& clip, int visibleHeightPx) {
  const auto body = cache.Prepare(clip, visibleHeightPx, ClockMs());
  if (!body || body->frames.empty()) return false;
  if (assets.mode != RenderMode::Layered || assets.parts.empty()) return true;
  const float bodyScale =
      static_cast<float>(visibleHeightPx) / static_cast<float>(std::max(1, body->contentHeight));
  for (const Part& source : assets.parts) {
    const Part part = PartForClip(clip, source);
    const auto prepared = cache.PreparePart(part, bodyScale, ClockMs());
    if (!prepared || prepared->frames.empty()) return false;
  }
  return true;
}

/**
 * 后台预热线程（方案 五.1：首次解码移出 UI 热路径）。
 *
 * 顺序按"用户最可能先看到哪个"：idle → press_in → release → move → pressed_hold → drag，
 * 横幅的 eat_loop 最后。线程自己初始化 COM（WIC 解码要求），通过 `Cache` 的加锁表发布不可变条目；
 * 绘制线程在预热未完成时仍然走原来的同步路径 —— **不阻塞首次点击**，只是尽快让那次同步解码不再发生。
 */
class Prewarm {
 public:
  ~Prewarm() { Shutdown(); }

  /// 请求预热。key 相同且已完成/进行中就不重复起线程。
  void Request(Cache& cache, const Assets& assets, const std::vector<const Clip*>& cursorClips,
               const std::vector<const Clip*>& bannerClips, int cursorHeightPx, int bannerHeightPx) {
    const long long key = static_cast<long long>(cursorHeightPx) * 100000 + bannerHeightPx;
    if (running_.load()) return;
    if (completed_.load() && key == key_) return;
    Shutdown();
    key_ = key;
    completed_.store(false);
    cancelled_.store(false);
    running_.store(true);
    started_.store(0);
    failed_.store(0);
    cursorClips_ = cursorClips;
    bannerClips_ = bannerClips;
    cursorHeightPx_ = cursorHeightPx;
    bannerHeightPx_ = bannerHeightPx;
    worker_ = std::thread([this, &cache, &assets]() {
      // WIC 解码要有 COM；线程自己初始化，不依赖 UI 线程的 apartment。
      const HRESULT com = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
      for (const Clip* clip : cursorClips_) {
        if (clip == nullptr || cancelled_.load()) break;
        if (PrewarmClip(cache, assets, *clip, cursorHeightPx_)) {
          started_.fetch_add(1);
        } else {
          failed_.fetch_add(1);
        }
      }
      for (const Clip* clip : bannerClips_) {
        if (clip == nullptr || cancelled_.load()) break;
        if (PrewarmClip(cache, assets, *clip, bannerHeightPx_)) {
          started_.fetch_add(1);
        } else {
          failed_.fetch_add(1);
        }
      }
      if (SUCCEEDED(com)) CoUninitialize();
      running_.store(false);
      completed_.store(!cancelled_.load());
    });
  }

  /// 停线程并等它退出。必须在 Cache/Assets 销毁之前调用。
  void Shutdown() {
    cancelled_.store(true);
    if (worker_.joinable()) worker_.join();
    running_.store(false);
  }

  bool Running() const { return running_.load(); }
  bool Completed() const { return completed_.load(); }
  long long Built() const { return started_.load(); }
  long long Failed() const { return failed_.load(); }
  long long Key() const { return key_; }

 private:
  std::thread worker_;
  std::atomic<bool> running_{false};
  std::atomic<bool> completed_{false};
  std::atomic<bool> cancelled_{false};
  std::atomic<long long> started_{0};
  std::atomic<long long> failed_{0};
  long long key_ = 0;
  std::vector<const Clip*> cursorClips_;
  std::vector<const Clip*> bannerClips_;
  int cursorHeightPx_ = 0;
  int bannerHeightPx_ = 0;
};

/* ------------------------------------------------------------------ blit -- */

/**
 * 把一帧贴到目标缓冲（预乘 over）。**不做缩放**：缓存里已经是最终像素。
 *
 * @param target - 目标 BGRA 缓冲（窗口 DIB）。
 * @param anchorX/anchorY - 锚点（contentBounds 底边中点）落在目标上的像素位置。
 */
inline void Blit(void* target, int targetWidth, int targetHeight, const CachedFrame& frame, int anchorX, int anchorY) {
  if (target == nullptr || frame.pixels.empty()) return;
  auto* destination = static_cast<uint32_t*>(target);
  const int left = anchorX + frame.offsetX;
  const int top = anchorY + frame.offsetY;
  for (int y = 0; y < frame.height; y += 1) {
    const int dy = top + y;
    if (dy < 0 || dy >= targetHeight) continue;
    const uint32_t* sourceRow = frame.pixels.data() + static_cast<size_t>(y) * frame.width;
    uint32_t* targetRow = destination + static_cast<size_t>(dy) * targetWidth;
    for (int x = 0; x < frame.width; x += 1) {
      const int dx = left + x;
      if (dx < 0 || dx >= targetWidth) continue;
      const uint32_t source = sourceRow[x];
      const uint32_t alpha = (source >> 24) & 0xFF;
      if (alpha == 0) continue;
      if (alpha == 0xFF) {
        targetRow[dx] = source | 0xFF000000u;
        continue;
      }
      const float inverse = 1.0f - static_cast<float>(alpha) / 255.0f;
      const uint32_t below = targetRow[dx];
      const auto mix = [&](int shift) {
        const float base = static_cast<float>((below >> shift) & 0xFF);
        const float value = static_cast<float>((source >> shift) & 0xFF) + base * inverse;
        return static_cast<uint32_t>(std::lround(std::min(255.0f, value)));
      };
      const uint32_t outAlpha = static_cast<uint32_t>(std::lround(
          static_cast<float>(alpha) + static_cast<float>((below >> 24) & 0xFF) * inverse));
      targetRow[dx] = (outAlpha << 24) | (mix(16) << 16) | (mix(8) << 8) | mix(0);
    }
  }
}

/**
 * 分层模式下的部件贴图：按 pivot + 相位偏移平移。
 *
 * @param offsetX/offsetY - 相位偏移（像素，已含幅度）。
 */
inline void BlitPart(void* target, int targetWidth, int targetHeight, const CachedFrame& frame, int pivotX, int pivotY,
                     int offsetX, int offsetY) {
  Blit(target, targetWidth, targetHeight, frame, pivotX + offsetX, pivotY + offsetY);
}

}  // namespace character
