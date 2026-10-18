/**
 * 一次性搬迁：把"工具契约层"搬进 `internal/tool-contracts.mjs`（9.txt §10 的"桌面/浏览器工具注册"那行的
 * 前半段：**参数与 schema、渲染**；`execute` 适配留在入口——那是装配的活）。
 *
 * 搬走的是两类东西，都是纯数据或纯函数：
 *   - **值 schema**：`IMAGE_VALUE_SCHEMA` / `STABILITY_VALUE_SCHEMA` / `SCREENSHOT_VALUE_SCHEMA` /
 *     `FRAME_ITEM_PROPERTIES` / `UIA_*` / `BROWSER_STATE_SCHEMA` / `WAIT_CONDITION_SCHEMA` /
 *     `BATCH_STEP_SCHEMA` / `BATCH_VALUE_SCHEMA` / `STEP_PASSTHROUGH`；
 *   - **渲染与取值**：`formatDisplays` / `stabilityValue` / `captureTiming` / `shotValue` /
 *     `textFieldValue` / `textObservationValue` / `digestOfNodes` / `digestOfText` / `stateValue` /
 *     `renderTextObservation` / `renderState`（外加它们用的内容摘要 memo）。
 *
 * 纪律（沿用前几轮）：逐字切片、只吃紧贴上方的注释、两头核对、写盘前 --dry 闸门。
 *
 * 用法：node tools/move-contracts-module.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const HOST = 'index.js';
const MODULE = 'internal/tool-contracts.mjs';
const DRY = process.argv.includes('--dry');
let source = readFileSync(HOST, 'utf8');
const removals = [];

/** 紧贴声明上方的注释块（只吃连续的注释行，遇空行即停）。 */
function attachedComment(startAt) {
  const before = source.slice(0, startAt);
  const lines = before.split('\n');
  let index = lines.length - 2;
  const collected = [];
  while (index >= 0) {
    const line = lines[index];
    if (line.trim() === '') break;
    if (!/^\s*(\/\*\*|\*)/.test(line)) break;
    collected.unshift(line);
    if (/^\s*\/\*\*/.test(line)) break;
    index -= 1;
  }
  if (collected.length === 0) return startAt;
  const tail = lines[lines.length - 1];
  return startAt - tail.length - collected.join('\n').length - 1;
}

/** 从某个位置起做括号配对（`{`…`}` 或 `[`…`]`），返回闭合位置。 */
function matchFrom(text, openAt) {
  const open = text[openAt];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let index = openAt; index < text.length; index += 1) {
    const char = text[index];
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error('括号没有闭合');
}

/** 切出一个顶层声明（对象/数组字面量、`new X()` 形式的常量，或函数），含紧贴上方的注释。 */
function takeDeclaration(name) {
  const patterns = [
    `  const ${name} = {`, `  const ${name} = [`, `  const ${name} = new `, `  const ${name} = `,
    `  function ${name}(`, `  async function ${name}(`,
  ];
  let startAt = -1;
  for (const pattern of patterns) {
    const at = source.indexOf(pattern);
    if (at >= 0 && (startAt < 0 || at < startAt)) startAt = at;
  }
  if (startAt < 0) throw new Error(`找不到声明：${name}`);
  const from = attachedComment(startAt);
  let end;
  if (source.startsWith(`  const ${name} = {`, startAt)) {
    end = matchFrom(source, source.indexOf('{', startAt)) + 1;
    if (source[end] === ';') end += 1;
  } else if (source.startsWith(`  const ${name} = [`, startAt)) {
    end = matchFrom(source, source.indexOf('[', startAt)) + 1;
    if (source[end] === ';') end += 1;
  } else if (source.startsWith(`  const ${name} = `, startAt)) {
    // 单行常量（如 `const OBSERVED_DIGEST_LIMIT = 64;` / `new Map()`）
    const semi = source.indexOf(';', startAt);
    end = semi + 1;
  } else {
    end = matchFrom(source, source.indexOf('{', startAt)) + 1;
  }
  const text = source.slice(from, end);
  removals.push({ name, text });
  source = source.slice(0, from) + source.slice(end + 1);
  return text;
}

/** 要搬的清单（顺序即模块里的顺序：先值 schema，再渲染/取值）。 */
const SCHEMAS = [
  'IMAGE_VALUE_SCHEMA', 'STABILITY_VALUE_SCHEMA', 'SCREENSHOT_VALUE_SCHEMA', 'FRAME_ITEM_PROPERTIES',
  'UIA_NODE_SCHEMA', 'UIA_WINDOW_SCHEMA', 'UIA_TEXT_RANGE_SCHEMA', 'UIA_TEXT_SCHEMA', 'UIA_STATE_SCHEMA',
  'BROWSER_STATE_SCHEMA', 'WAIT_CONDITION_SCHEMA', 'BATCH_STEP_SCHEMA', 'BATCH_VALUE_SCHEMA', 'STEP_PASSTHROUGH',
];
const HELPERS = [
  'formatDisplays', 'stabilityValue', 'captureTiming', 'shotValue',
  'textFieldValue', 'textObservationValue', 'digestOfNodes', 'digestOfText', 'stateValue',
  'renderTextObservation', 'renderState',
];
const STATE = ['observedDigests', 'OBSERVED_DIGEST_LIMIT'];

const pieces = { schemas: [], helpers: [], state: [] };
for (const name of SCHEMAS) pieces.schemas.push(takeDeclaration(name));
for (const name of STATE) pieces.state.push(takeDeclaration(name));
for (const name of HELPERS) pieces.helpers.push(takeDeclaration(name));

/** 每段都要含它该有的东西（抽错范围会立刻暴露）。 */
const EXPECT = {
  IMAGE_VALUE_SCHEMA: ['attachmentId'],
  STABILITY_VALUE_SCHEMA: ['budgetMs'],
  SCREENSHOT_VALUE_SCHEMA: ['imageWidth'],
  FRAME_ITEM_PROPERTIES: ['SCREENSHOT_VALUE_SCHEMA'],
  UIA_NODE_SCHEMA: ['controlType'],
  UIA_STATE_SCHEMA: ['patterns'],
  BROWSER_STATE_SCHEMA: ['tabs'],
  WAIT_CONDITION_SCHEMA: ['expected'],
  BATCH_STEP_SCHEMA: ['action'],
  BATCH_VALUE_SCHEMA: ['failedAt'],
  STEP_PASSTHROUGH: ["'hwnd'"],
  formatDisplays: ['deviceName'],
  stabilityValue: ['state'],
  captureTiming: ['captureMs'],
  shotValue: ['frame'],
  textFieldValue: ['text'],
  textObservationValue: ['focused'],
  digestOfNodes: ['createHash'],
  digestOfText: ['createHash'],
  stateValue: ['digestOfNodes'],
  renderTextObservation: ['text'],
  renderState: ['compact'],
  observedDigests: ['observedDigests'],
  OBSERVED_DIGEST_LIMIT: ['OBSERVED_DIGEST_LIMIT'],
};
for (const [name, needles] of Object.entries(EXPECT)) {
  const text = [...pieces.schemas, ...pieces.helpers, ...pieces.state].find((one) => one.includes(` ${name} `) || one.includes(` ${name}(`) || one.includes(`${name} =`));
  if (text === undefined) throw new Error(`清单里没有 ${name} 的片段`);
  for (const needle of needles) {
    if (!text.includes(needle)) throw new Error(`片段 ${name} 里缺少 ${needle}——抽取范围不对`);
  }
}

/** 顶层导出：去一层缩进 + 加 export（`export` 必须在列 0）。 */
const dedent = (text) => text.split('\n').map((line) => (line.startsWith('  ') ? line.slice(2) : line)).join('\n');
const exportTop = (text) => `export ${dedent(text)}`;

const moduleText = `/**
 * 工具契约层：模型可见的**值 schema**与**渲染文案**（9.txt §10"桌面/浏览器工具注册"那行的前半段）。
 *
 * 为什么单独成层：schema 与渲染是"这一族工具对外长什么样"的唯一定义处——参数取值、失败码、坐标口径、
 * 省略原因都写在这里。它们与后端、会话、租约没有任何关系（纯数据 + 纯函数），所以放在入口之外能让
 * "契约"与"装配"分开读：改口径时只看这一个文件，改接线时只看入口。
 *
 * 搬移方式与前面几批一致：**从 index.js 原样切出来**（脚本按括号配对取原文，只加 \`export\`），
 * 不重写、不调整顺序。\`execute\` 适配留在入口——那是装配的活。
 *
 * 唯一带状态的是内容摘要 memo（\`observedDigests\`）：它按内容寻址，属于纯函数的缓存，
 * 多实例共享不影响语义。
 */
import { createHash } from 'node:crypto';

${pieces.schemas.map(exportTop).join('\n\n')}

${pieces.state.map(exportTop).join('\n\n')}

${pieces.helpers.map(exportTop).join('\n\n')}
`;

/** 两头核对：宿主里不能再出现被搬走的声明。 */
const DECLARATIONS = [...SCHEMAS, ...STATE, ...HELPERS].flatMap((name) => [
  `  const ${name} = {`, `  const ${name} = [`, `  function ${name}(`, `  async function ${name}(`,
]);
const leftover = DECLARATIONS.filter((declaration) => source.includes(declaration));
if (leftover.length > 0) {
  console.error(`宿主里仍有被搬走的声明，已中止：\n${leftover.join('\n')}`);
  process.exit(1);
}

/** 宿主侧引入。 */
const IMPORT_ANCHOR = "import { createRefRegistry } from './internal/refs.mjs';";
if (!source.includes(IMPORT_ANCHOR)) {
  console.error('找不到插入 import 的位置');
  process.exit(1);
}
const names = [...SCHEMAS, ...HELPERS].join(', ');
source = source.replace(IMPORT_ANCHOR, `${IMPORT_ANCHOR}\nimport {\n  ${names.split(', ').join(',\n  ')},\n} from './internal/tool-contracts.mjs';`);

console.log(`搬走 ${removals.length} 段：${[...SCHEMAS, ...STATE, ...HELPERS].length} 个声明`);
console.log(`模块 ${moduleText.split('\n').length} 行；宿主 ${source.split('\n').length} 行`);
if (DRY) {
  console.log('（--dry：不写文件）');
  process.exit(0);
}
writeFileSync(MODULE, moduleText, 'utf8');
writeFileSync(HOST, source, 'utf8');
console.log('已写入。下一步：node --check 两个文件；compare-functions 核对；跑套件。');
