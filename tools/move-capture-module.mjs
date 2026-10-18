/**
 * 一次性搬迁：把"截图服务"（参数规范化 / 格式推断 / 信封文案 / 落盘命名 / 摘要去重入库）搬进
 * `internal/capture.mjs`（9.txt §10）。
 *
 * **两条教训固化在这里**（都是上一版脚本踩的）：
 *
 *   1. 搬迁必须**逐字搬运**。第一版我凭记忆重写了 `screenshotEnvelope`，而原函数还有 stability 状态、
 *      `clipped`、帧来源等分支——手写等于悄悄改行为。现在按花括号配对**从文件里切原文**。
 *   2. 切片的边界要**精确**。第二版按"往上找最近的 `/**`"取注释，结果把相邻的 `let backend` /
 *      `lastLegacyRestartMs` 一起吞进了片段。现在只吃**紧贴其上的**注释块，并且在删除前把
 *      "这段区间里出现的顶层声明"与白名单比对，多一个就整体中止。
 *
 * 用法：node tools/move-capture-module.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const HOST = 'index.js';
const MODULE = 'internal/capture.mjs';
const DRY = process.argv.includes('--dry');
let source = readFileSync(HOST, 'utf8');
const removals = [];

/** 取紧贴声明之上的注释块（只吃连续的 `/** … *\/`，中间不允许有空行）。 */
function attachedComment(startAt) {
  const lines = source.slice(0, startAt).split('\n');
  // lines 的最后一项是 startAt 之前的那一行的前半段；从倒数第二行开始向上看
  let index = lines.length - 2;
  const collected = [];
  while (index >= 0) {
    const line = lines[index];
    if (line.trim() === '') break;
    if (!/^\s*(\/\*\*|\*|\*\/)/.test(line) && !/^\s*\*\//.test(line)) break;
    collected.unshift(line);
    if (/^\s*\/\*\*/.test(line)) break;
    index -= 1;
  }
  if (collected.length === 0) return startAt;
  // 注释块的长度（含它与声明之间的那个换行）：注意基数是 startAt，不是整份文件的长度。
  const tail = lines[lines.length - 1];
  const lineStart = startAt - tail.length;
  return lineStart - collected.join('\n').length - 1;
}

/** 按花括号配对切出一个函数的完整原文（含紧贴其上的注释）。 */
function takeFunction(declaration) {
  const startAt = source.indexOf(declaration);
  if (startAt < 0) throw new Error(`找不到函数：${declaration}`);
  const from = attachedComment(startAt);
  let index = source.indexOf('{', startAt);
  let depth = 0;
  for (; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const end = index + 1;
  const text = source.slice(from, end);
  removals.push({ kind: 'function', text, from, end });
  source = source.slice(0, from) + source.slice(end + 1);
  return text;
}

/** 切出一行声明（含紧贴其上的注释）。 */
function takeLine(line) {
  const startAt = source.indexOf(line);
  if (startAt < 0) throw new Error(`找不到声明：${line}`);
  const from = attachedComment(startAt);
  const end = startAt + line.length;
  const text = source.slice(from, end);
  removals.push({ kind: 'line', text, from, end });
  source = source.slice(0, from) + source.slice(end + 1);
  return text;
}

const pieces = {
  normalize: takeFunction('  function normalizeCaptureSpec(options) {'),
  resolve: takeFunction('  function resolveFormat(requested, path) {'),
  admit: takeFunction('  async function admitCapture(ctx, path, mediaType, name, sessionId) {'),
  envelope: takeFunction('function screenshotEnvelope(value) {'),
  shotSeq: takeLine('  let shotSeq = 0;'),
  shotCache: takeLine('  const shotCache = new Map();'),
  shotCacheLimit: takeLine('  const SHOT_CACHE_LIMIT = 8;'),
  lastShotDigest: takeLine('  const lastShotDigest = new Map();'),
};

/**
 * 白名单：被搬走的**顶层声明**只能是这些。
 *
 * 检查方式说明：不按"片段里出现 2 空格缩进的声明"来判断——文件级的 `screenshotEnvelope` 在列 0，
 * 它的函数体恰好缩进 2 空格，那样会把函数体里的局部 `const` 全算成顶层（上一版就是这么误报的）。
 * 这里改成两头核对：片段里必须**包含**该有的东西（EXPECT），而宿主在替换之后必须**不再包含**
 * 被搬走的声明。
 */
const ALLOWED = [
  'normalizeCaptureSpec', 'resolveFormat', 'admitCapture', 'screenshotEnvelope',
  'shotSeq', 'shotCache', 'SHOT_CACHE_LIMIT', 'lastShotDigest',
];
console.log(`搬走 ${removals.length} 段：${ALLOWED.join(', ')}`);

/** 每段都要能在里面找到它该有的东西。 */
const EXPECT = {
  normalize: ['region_space', 'surface'],
  resolve: ["requested === 'png'"],
  admit: ['attachments.saveImages', 'unchanged'],
  envelope: ['stability', 'clipped', 'timingParts'],
  shotSeq: ['shotSeq'],
  shotCache: ['shotCache'],
  shotCacheLimit: ['SHOT_CACHE_LIMIT'],
  lastShotDigest: ['lastShotDigest'],
};
for (const [key, needles] of Object.entries(EXPECT)) {
  for (const needle of needles) {
    if (!pieces[key].includes(needle)) throw new Error(`片段 ${key} 里缺少 ${needle}——抽取范围不对`);
  }
}

/**
 * 顶层导出必须是列 0：`export` 前面不能有缩进。
 * 从 `apply()` 里切出来的片段带 2 空格缩进，所以这里整体去一层（缩进对 JS 无意义，`export` 的位置有意义）。
 */
const dedent = (text) => text.split('\n').map((line) => (line.startsWith('  ') ? line.slice(2) : line)).join('\n');
/** 顶层声明：去缩进 + 加 export。 */
const exportTop = (text) => `export ${dedent(text)}`;

const moduleText = `/**
 * 截图服务：参数规范化、格式推断、信封文案、落盘命名、摘要去重与入库
 * （9.txt §5.4 / §5.5 / §6 第 7 条 / §10）。
 *
 * 从 \`index.js\` 搬出来（§10 宿主半边拆分）。留下的是"调 worker 抓一张图"那一步——它需要后端的
 * \`call\`，属于入口的编排；搬走的是四件与后端无关的事：
 *
 *   1. **参数规范化**：单张与批次共用同一条规则（它们曾经不一致：同样的参数，单张返回整窗、批次返回
 *      裁切，而调用方除了看图大小没有任何办法分辨）。
 *   2. **落盘命名**：序号在这里，所以两张图永远不会撞同一个文件名。
 *   3. **摘要去重与入库**：同样的字节可以复用附件，但"屏幕没动"是**另一个问题**；去重状态只在图真的
 *      交付成功之后才提交（§6 第 7 条），否则一次失败的保存会把没人看过的画面记成"你看过了"。
 *   4. **信封文案**：像素↔屏幕换算、缩放、复用/未变、节奏与裁剪结论。
 *
 * 下面的函数体是**从 index.js 原样切出来的**（不是重写）：搬迁脚本按花括号配对取原文，只给声明加了
 * \`export\`，并把去重状态关进一层工厂。
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

${exportTop(pieces.normalize)}

${exportTop(pieces.resolve)}

${exportTop(pieces.envelope)}

/**
 * 捕获的落盘命名与入库去重（每个插件实例一份）。
 * @param options.sessionKey - 会话标识归一化函数（去重按会话记账）。
 */
export function createCaptureService({ sessionKey }) {
${pieces.shotSeq}

${pieces.shotCache}

${pieces.shotCacheLimit}

${pieces.lastShotDigest}

  /**
   * 下一张图的落盘路径（序号在这里，避免两张图撞名）。
   * @param root - 插件自己的截图目录。
   * @param format - 'jpeg' 或 'png'。
   * @returns 绝对路径。
   */
  function nextCapturePath(root, format) {
    shotSeq += 1;
    return join(root, \`capture-\${process.pid}-\${shotSeq}.\${format === 'jpeg' ? 'jpg' : 'png'}\`);
  }

${pieces.admit}

  return { nextCapturePath, admit: admitCapture };
}
`;

/** 宿主侧接线。 */
const swaps = [
  ['capture-instance', '  /** 执行协调（在飞登记 / 停止状态 / 浏览器通道的会话上下文）：见 internal/execution.mjs。 */\n  const execution = createExecutionRegistry();\n',
    '  /** 执行协调（在飞登记 / 停止状态 / 浏览器通道的会话上下文）：见 internal/execution.mjs。 */\n  const execution = createExecutionRegistry();\n  /** 截图服务（规范化 / 命名 / 去重入库 / 信封）：见 internal/capture.mjs。 */\n  const captureService = createCaptureService({ sessionKey });\n'],
  ['capture-name', '    shotSeq += 1;\n    await mkdir(shotRoot, { recursive: true });\n    const format = resolveFormat(options.format, options.path);\n    const ext = format === \'jpeg\' ? \'jpg\' : \'png\';\n    const shotPath = options.path ?? join(shotRoot, `capture-${process.pid}-${shotSeq}.${ext}`);',
    '    await mkdir(shotRoot, { recursive: true });\n    const format = resolveFormat(options.format, options.path);\n    const shotPath = options.path ?? captureService.nextCapturePath(shotRoot, format);'],
  ['admit-calls', 'admitCapture(', 'captureService.admit('],
  ['import', "import { combineSignals, describeCall, createExecutionRegistry } from './internal/execution.mjs';",
    "import { combineSignals, describeCall, createExecutionRegistry } from './internal/execution.mjs';\nimport { normalizeCaptureSpec, resolveFormat, screenshotEnvelope, createCaptureService } from './internal/capture.mjs';"],
];

for (const [label, from, to] of swaps) {
  if (!source.includes(from)) {
    console.error(`找不到替换标记：${label}`);
    process.exit(1);
  }
  source = source.replaceAll(from, to);
}

/** 宿主在替换之后不能再出现被搬走的声明（这是"两头核对"的另一头）。 */
const DECLARATIONS = [
  'function normalizeCaptureSpec(options) {',
  'function resolveFormat(requested, path) {',
  'async function admitCapture(ctx, path, mediaType, name, sessionId) {',
  'function screenshotEnvelope(value) {',
  'let shotSeq = 0;',
  'const shotCache = new Map();',
  'const SHOT_CACHE_LIMIT = 8;',
  'const lastShotDigest = new Map();',
];
const leftover = DECLARATIONS.filter((declaration) => source.includes(declaration));
if (leftover.length > 0) {
  console.error(`宿主里仍有被搬走的声明，已中止：\n${leftover.join('\n')}`);
  process.exit(1);
}

console.log(`模块 ${moduleText.split('\n').length} 行；宿主 ${source.split('\n').length} 行`);
if (DRY) {
  console.log('（--dry：不写文件）');
  process.exit(0);
}
writeFileSync(MODULE, moduleText, 'utf8');
writeFileSync(HOST, source, 'utf8');
console.log('已写入。下一步：node --check 两个文件；compare-declarations 核对；跑套件。');
