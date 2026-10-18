/**
 * 一次性搬迁：把 index.js 里"失败分类与重试判定"整块移到 internal/failures.mjs。
 *
 * 9.txt §10 的宿主半边拆分：这块自成一体——不再有任何插件状态，只做三件事：
 *   1. 把后端的错误变成一句人话（`backendMessage`）；
 *   2. 给失败贴上稳定的 `code` 与"下一步"（`FAILURE_RULES` + `decorateFailure`）；
 *   3. 判断"这个调用能否安全重发"，从而决定要不要加 `[UNKNOWN_OUTCOME]`
 *      （`READ_ONLY_*` / `IDEMPOTENT_*` / `isIdempotentCall` / `withOutcomeNote`）。
 *
 * 搬迁是**按行搬运 + 只加 `export` 关键字**：不重写、不调整格式，搬完立刻用
 * `node --check` 与几个套件核对（harness/schema/lifecycle 对这一块覆盖最密）。
 *
 * 用法：node tools/move-failures-module.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = join(ROOT, 'index.js');
const MODULE = join(ROOT, 'internal', 'failures.mjs');
const DRY = process.argv.includes('--dry');

const source = readFileSync(HOST, 'utf8');

/** 块的边界：从 `function backendMessage` 起，到 `withOutcomeNote` 结束（`readJsonBody` 的 JSDoc 之前）。 */
const START = 'function backendMessage(error) {';
const END_MARKER = '\n/**\n * Read and parse a bounded JSON body.';
const startAt = source.indexOf(START);
const endAt = source.indexOf(END_MARKER);
if (startAt < 0 || endAt < 0 || endAt <= startAt) {
  console.error('找不到搬迁边界（文件可能已经搬过了）');
  process.exit(1);
}

/** 搬走的正文（保留原有缩进与注释）。 */
let block = source.slice(startAt, endAt).replace(/\s+$/, '');

/** 需要导出的符号：外部仍在用的那些。 */
const EXPORTS = [
  'function backendMessage(error) {',
  'const FAILURE_RULES = [',
  'const READ_ONLY_ACTIONS =',
  'const READ_ONLY_STEPS =',
  'const IDEMPOTENT_STEP_ACTIONS =',
  'const STEP_ACTION_LIST = [',
  'const UIA_ACTION_LIST = [',
  'const IDEMPOTENT_COMMANDS =',
  'function isIdempotentCall(cmd, args) {',
  'function decorateFailure(message, context = {}) {',
  'function withOutcomeNote(message, error, cmd, args) {',
];
for (const declaration of EXPORTS) {
  if (!block.includes(declaration)) {
    console.error(`块里找不到要导出的声明：${declaration}`);
    process.exit(1);
  }
  block = block.replace(declaration, `export ${declaration}`);
}

const header = `/**
 * 失败怎么说、以及"能不能重发"（9.txt §10：宿主半边拆分搬出来的第一块）。
 *
 * 三件事，都是纯函数与常量，没有任何插件状态：
 *
 *   1. \`backendMessage\`：把后端的错误对象变成一句人话（含 §6 第 4 条那条"输入是否确认释放"）；
 *   2. \`FAILURE_RULES\` + \`decorateFailure\`：给失败贴稳定的 \`code\` 与 \`retry\` 判据，并附上
 *      "下一步做什么"——顺序即优先级，第一条命中即用；
 *   3. \`READ_ONLY_*\` / \`IDEMPOTENT_*\` / \`isIdempotentCall\` / \`withOutcomeNote\`：
 *      "这个调用能不能安全重发"。答错方向要付代价：把可重发的当不可重发，只是多看一眼；
 *      把不可重发的当可重发，就是**重复一次副作用**。所以没列进去的一律按不可重发处理。
 *
 * \`STEP_ACTION_LIST\` / \`UIA_ACTION_LIST\` 也放这里：它们是 schema、描述与 worker 分发表共用的
 * **唯一**一份动作清单（曾经有三份并且互相矛盾），属于"契约"而不是"入口装配"。
 */
`;

const nextHost = `${source.slice(0, startAt)}${source.slice(endAt)}`;
/** 宿主侧换成从新模块引入。 */
const IMPORT_ANCHOR = "} from './internal/build-check.mjs';\n";
const IMPORT_BLOCK = `${IMPORT_ANCHOR}import {
  backendMessage,
  decorateFailure,
  withOutcomeNote,
  isIdempotentCall,
  READ_ONLY_ACTIONS,
  READ_ONLY_STEPS,
  IDEMPOTENT_STEP_ACTIONS,
  STEP_ACTION_LIST,
  UIA_ACTION_LIST,
} from './internal/failures.mjs';\n`;
if (!nextHost.includes(IMPORT_ANCHOR)) {
  console.error('找不到插入 import 的位置');
  process.exit(1);
}

const withImport = nextHost.replace(IMPORT_ANCHOR, IMPORT_BLOCK);
const moduleText = `${header}\nimport { ComputerUseBackendError } from '../backend/bridge.js';\n\n${block}\n`;

/** 搬迁后宿主里不应再出现"定义"，只应出现引用。 */
const stillDefines = EXPORTS.filter((declaration) => withImport.includes(declaration));
if (stillDefines.length > 0) {
  console.error(`宿主里仍有定义残留：${stillDefines.join(' | ')}`);
  process.exit(1);
}

console.log(`块大小：${block.split('\n').length} 行 → internal/failures.mjs`);
console.log(`宿主 ${source.split('\n').length} 行 → ${withImport.split('\n').length} 行`);
if (DRY) {
  console.log('（--dry：没有写文件）');
  process.exit(0);
}
writeFileSync(MODULE, moduleText, 'utf8');
writeFileSync(HOST, withImport, 'utf8');
console.log('已写入 internal/failures.mjs 并更新 index.js；下一步 node --check index.js，再跑 harness/schema/lifecycle。');
