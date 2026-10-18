/**
 * 一次性搬迁：把"引用注册表"（快照/帧的所有权记录与拒绝）搬进 `internal/refs.mjs`（9.txt §10）。
 *
 * 与 capture 那次的差别：这里的函数**依赖闭包状态**（`seenSnapshots` / `seenFrames` / 两个上限）与
 * "当前 worker 代次"。所以搬法是：状态与函数一起进工厂，调用点把 `exec` 换成 `sessionId`、
 * 把 `backend?.info?.generation` 换成注入的 `generationOf()`。
 *
 * 用法：node tools/move-refs-module.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const HOST = 'index.js';
const DRY = process.argv.includes('--dry');
let source = readFileSync(HOST, 'utf8');
const applied = [];

function swap(label, from, to) {
  if (!source.includes(from)) {
    console.error(`找不到标记：${label}`);
    process.exit(1);
  }
  source = source.replace(from, to);
  applied.push(label);
}

/** 删除一整段（用起止标记夹住，避免上次那种"按注释往上找"吞掉邻居）。 */
function cutBetween(label, fromNeedle, toNeedle) {
  const start = source.indexOf(fromNeedle);
  if (start < 0) {
    console.error(`找不到删除起点：${label}`);
    process.exit(1);
  }
  const end = source.indexOf(toNeedle, start);
  if (end < 0) {
    console.error(`找不到删除终点：${label}`);
    process.exit(1);
  }
  source = source.slice(0, start) + source.slice(end);
  applied.push(`cut:${label}`);
}

/** 状态声明 + 三个函数 + 帧注册表整块：从"Snapshot ids each session"注释到 `controlState` 的注释之前。 */
cutBetween(
  'ref-registry-block',
  '  /**\n   * Snapshot ids each session has been shown, so a ref can be checked for ownership.',
  '  /**\n   * What the desktop control is doing for one session.',
);

/** 建实例（放在 captureService 之后，保持"实例都在一处"的读法）。 */
swap('refs-instance',
  `  /** 截图服务（规范化 / 命名 / 去重入库 / 信封）：见 internal/capture.mjs。 */
  const captureService = createCaptureService({ sessionKey });
`,
  `  /** 截图服务（规范化 / 命名 / 去重入库 / 信封）：见 internal/capture.mjs。 */
  const captureService = createCaptureService({ sessionKey });
  /** 引用注册表（哪个会话被展示过哪次观察/哪一帧）：见 internal/refs.mjs。 */
  const refs = createRefRegistry({ sessionKey, generationOf: () => backend?.info?.generation });
`);

/** 调用点：把 exec 换成 sessionId。 */
source = source.replaceAll('noteSnapshot(exec, ', 'refs.noteSnapshot(exec?.agent?.session?.id, ');
source = source.replaceAll('assertRefOwnership(exec, ', 'refs.assertRefOwnership(exec?.agent?.session?.id, ');
source = source.replaceAll('noteFrame(exec, ', 'refs.noteFrame(exec?.agent?.session?.id, ');
source = source.replaceAll('assertFrameOwnership(exec, ', 'refs.assertFrameOwnership(exec?.agent?.session?.id, ');
applied.push('call-sites');

/** 引入模块。 */
swap('import',
  "import { normalizeCaptureSpec, resolveFormat, screenshotEnvelope, createCaptureService } from './internal/capture.mjs';",
  "import { normalizeCaptureSpec, resolveFormat, screenshotEnvelope, createCaptureService } from './internal/capture.mjs';\nimport { createRefRegistry } from './internal/refs.mjs';");

/** 两头核对：被搬走的声明不能在宿主里留下。 */
const DECLARATIONS = [
  'const seenSnapshots = new Map();',
  'const SEEN_SNAPSHOT_LIMIT = 4096;',
  'function noteSnapshot(',
  'function assertRefOwnership(',
  'const seenFrames = new Map();',
  'const SEEN_FRAME_LIMIT = 4096;',
  'function noteFrame(',
  'function assertFrameOwnership(',
];
const leftover = DECLARATIONS.filter((declaration) => source.includes(declaration));
if (leftover.length > 0) {
  console.error(`宿主里仍有被搬走的声明，已中止：\n${leftover.join('\n')}`);
  process.exit(1);
}

console.log(`已应用 ${applied.length} 处：${applied.join(', ')}`);
console.log(`宿主 ${source.split('\n').length} 行`);
if (DRY) {
  console.log('（--dry：不写文件）');
  process.exit(0);
}
writeFileSync(HOST, source, 'utf8');
console.log('已写入 index.js。下一步：node --check；compare-functions 核对；跑套件。');
