/**
 * 角色资源包的验收（方案 4.18.7 的"发布前校验全部项"，2026-11-08 按 v3 重写）。
 *
 * 打包工具是 Python（`tools/character-pack.py`，用 Pillow 拼图集）；这份测试只读产物，检查的是
 * **安装包里那一份**是否自洽。v3 是分层资源：每个片段有主体图集，另有 `hair_back` / `tail`
 * 两个部件图集，均按"每片段一份"存放（`<clip>-<part>.png`）。
 *
 * 复核结论第 2 条要求：v3 资源校验属于本轮验收配套，旧的 v1 断言要改掉、并把**全部部件**补齐验证，
 * 不能长期以"历史失败"豁免。
 *
 *   node character-pack-test.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, 'assets', 'character');
const REQUIRED = ['eat_loop', 'idle', 'move', 'press_in', 'pressed_hold', 'release', 'drag'];
const SCHEMA = 'dsh.character.pack/v3';
const PARTS = ['body', 'hair_back', 'tail'];

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`);
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`);
  }
}

/** 读 PNG 的 IHDR 宽高（字节 16..24）。 */
function pngSize(path) {
  const bytes = readFileSync(path);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes };
}

console.log('\n== the pack exists and is well formed ==');
const packPath = join(DIR, 'pack.json');
if (!existsSync(packPath)) {
  check('assets/character/pack.json exists (run tools/character-pack.py)', false);
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length === 0 ? 0 : 1);
}
check('pack.json exists', true);
const pack = JSON.parse(readFileSync(packPath, 'utf8'));
check(`schema is ${SCHEMA}`, pack.schema === SCHEMA, String(pack.schema));
check('it carries an assetVersion', typeof pack.assetVersion === 'string' && pack.assetVersion.length > 0, String(pack.assetVersion));
check('renderMode is layered (v3)', pack.renderMode === 'layered', String(pack.renderMode));
check('alpha mode is declared', typeof pack.alpha === 'string' && pack.alpha.length > 0, String(pack.alpha));

console.log('\n== every state the animator asks for is present ==');
for (const name of REQUIRED) {
  check(`clip "${name}" is packed`, pack.clips?.[name] !== undefined);
}

console.log('\n== each clip is self-consistent and its atlas is intact ==');
for (const [name, clip] of Object.entries(pack.clips ?? {})) {
  const frames = Number(clip.frameCount);
  const frameWidth = Number(clip.frameSize?.[0]);
  const frameHeight = Number(clip.frameSize?.[1]);
  const columns = Number(clip.grid?.[0]);
  const rows = Number(clip.grid?.[1]);

  check(`${name}: frameCount matches durations`,
    Array.isArray(clip.durationsMs) && clip.durationsMs.length === frames, `${clip.durationsMs?.length}/${frames}`);
  const sum = (clip.durationsMs ?? []).reduce((total, value) => total + Number(value), 0);
  check(`${name}: durations add up to totalMs`, sum === clip.totalMs, `${sum}/${clip.totalMs}`);
  check(`${name}: every frame is short enough to look animated`,
    (clip.durationsMs ?? []).every((ms) => ms > 0 && ms <= 5000), JSON.stringify(clip.durationsMs));

  // v3 的网格是逐片段的，不再假设 4x2。
  check(`${name}: the grid holds every frame`, columns * rows >= frames && columns >= 1 && rows >= 1,
    `${columns}x${rows} for ${frames} frames`);
  check(`${name}: the frame size is positive`, frameWidth > 0 && frameHeight > 0, `${frameWidth}x${frameHeight}`);
  check(`${name}: the anchor is inside the frame`,
    Array.isArray(clip.anchorPx) && clip.anchorPx[0] >= 0 && clip.anchorPx[0] <= frameWidth &&
    clip.anchorPx[1] >= 0 && clip.anchorPx[1] <= frameHeight, JSON.stringify(clip.anchorPx));
  if (Array.isArray(clip.contentBounds)) {
    const [x, y, w, h] = clip.contentBounds;
    check(`${name}: content bounds fit inside the frame`,
      x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= frameWidth && y + h <= frameHeight,
      JSON.stringify(clip.contentBounds));
  }

  const atlasPath = join(DIR, clip.atlas);
  const exists = existsSync(atlasPath);
  check(`${name}: atlas file exists`, exists, clip.atlas);
  if (!exists) continue;
  const { width, height, bytes } = pngSize(atlasPath);
  check(`${name}: atlas size matches the manifest`, bytes.length === clip.bytes, `${bytes.length}/${clip.bytes}`);
  check(`${name}: atlas sha256 matches`, createHash('sha256').update(bytes).digest('hex') === clip.sha256, 'hash changed');
  // v3：图集尺寸 = 每帧尺寸 × 网格。
  check(`${name}: the atlas is ${frameWidth * columns}x${frameHeight * rows}`,
    width === frameWidth * columns && height === frameHeight * rows, `${width}x${height}`);
  check(`${name}: the file is not suspiciously small`, statSync(atlasPath).size > 1000, String(statSync(atlasPath).size));
}

console.log('\n== v3 parts: every declared part atlas is intact ==');
// `parts` 是数组，每项自带 name/atlas/frameSize/grid；每片段一份的文件名是 `<clip>-<atlas>`，
// 与运行时 character.h 里 perClip 的解析规则一致。
const partList = Array.isArray(pack.parts) ? pack.parts : Object.values(pack.parts ?? {});
check('the pack declares parts', partList.length > 0, String(partList.length));
for (const part of partList) {
  const name = part.name ?? '(unnamed)';
  check(`part ${name}: declares a zOrder`, Number.isFinite(Number(part.zOrder)), String(part.zOrder));
  check(`part ${name}: says whether it is per-clip`, typeof part.perClip === 'boolean', String(part.perClip));
  check(`part ${name}: has a motion period`, Number(part.motion?.periodMs) > 0, JSON.stringify(part.motion));
  const partWidth = Number(part.frameSize?.[0] ?? 0);
  const partHeight = Number(part.frameSize?.[1] ?? 0);
  const partColumns = Number(part.grid?.[0] ?? 0);
  const partRows = Number(part.grid?.[1] ?? 0);
  const perClip = part.perClip === true;
  for (const clip of perClip ? REQUIRED : [null]) {
    const file = perClip ? `${clip}-${part.atlas ?? `${name}.png`}` : (part.atlas ?? `${name}.png`);
    const path = join(DIR, file);
    const label = perClip ? `${name}@${clip}` : name;
    const exists = existsSync(path);
    check(`part ${label}: atlas exists`, exists, file);
    if (!exists) continue;
    const { width, height, bytes } = pngSize(path);
    const clipSpec = clip === null ? null : pack.clips?.[clip];
    // perClip 部件的图集几何跟**片段**走：运行时 character.h 用 clip 的 columns/rows/frameSize
    // 覆盖 part 的同名字段，所以吃食这种 4x4、按压 1x1 的片段，部件图集也必须跟着变。
    const expectedWidth = clipSpec ? Number(clipSpec.frameSize[0]) * Number(clipSpec.grid[0]) : partWidth * partColumns;
    const expectedHeight = clipSpec ? Number(clipSpec.frameSize[1]) * Number(clipSpec.grid[1]) : partHeight * partRows;
    check(`part ${label}: atlas is ${expectedWidth}x${expectedHeight}`,
      width === expectedWidth && height === expectedHeight, `${width}x${height}`);
    if (clipSpec) {
      // 单帧尺寸必须一致，否则合成会错位；网格可以随片段变化。
      check(`part ${label}: cell size matches the clip`,
        Number(clipSpec.frameSize[0]) === partWidth && Number(clipSpec.frameSize[1]) === partHeight,
        `clip ${clipSpec.frameSize} vs part ${partWidth}x${partHeight}`);
    }
    check(`part ${label}: the atlas is not empty`, bytes.length > 1000, String(bytes.length));
  }
}

console.log('\n== transitions reference real clips and frames ==');
const transitionsPath = join(DIR, 'transitions.json');
if (existsSync(transitionsPath)) {
  const table = JSON.parse(readFileSync(transitionsPath, 'utf8'));
  // 生成器把"自配对"也写进表里：7 个片段 → 49 条。
  const pairs = Array.isArray(table.pairs) ? table.pairs : Object.values(table.pairs ?? {});
  check('the transition table covers every from->to pair', pairs.length === REQUIRED.length * REQUIRED.length,
    `${pairs.length}/${REQUIRED.length * REQUIRED.length}`);
  let badClip = 0;
  let badFrame = 0;
  let badFade = 0;
  let badRatio = 0;
  for (const entry of pairs) {
    const to = entry.to;
    if (pack.clips?.[entry.from] === undefined || pack.clips?.[to] === undefined) badClip += 1;
    const frame = Number(entry.entryFrame);
    if (!Number.isFinite(frame) || frame < 0 || frame >= Number(pack.clips?.[to]?.frameCount ?? 1)) badFrame += 1;
    const fade = Number(entry.fadeMs);
    if (!Number.isFinite(fade) || fade < 0 || fade > 400) badFade += 1;
    // ratio 可以是 0：自配对与"首帧完全相同"的对（pressed_hold→release）测出来就是 0，`n    // 它们的 fadeMs 也必须是 0（直切）。这里只拒绝负数/缺失。`n    if (!Number.isFinite(Number(entry.ratio)) || Number(entry.ratio) < 0) badRatio += 1;
  }
  check('every pair names packed clips', badClip === 0, String(badClip));
  check('every pair has an in-range entry frame', badFrame === 0, String(badFrame));
  check('every pair has a sane fade duration', badFade === 0, String(badFade));
  check('every pair records a non-negative measured ratio', badRatio === 0, String(badRatio));
  const zeroRatioWithoutCut = pairs.filter((one) => Number(one.ratio) === 0 && Number(one.fadeMs) !== 0).length;
  check('a pair with no measurable motion always cuts instead of fading', zeroRatioWithoutCut === 0, String(zeroRatioWithoutCut));
} else {
  check('transitions.json exists', false);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
