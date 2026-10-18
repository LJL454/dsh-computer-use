/**
 * 一次性搬迁：把"执行协调"（在飞登记 / 合并信号 / 浏览器通道的会话上下文 / 调用描述）搬进
 * `internal/execution.mjs`。
 *
 * **教训固化在这里**：上一批按注释块整段删除时连带删掉了同区间的其它声明。所以这个脚本在删之前
 * 先做两件事：
 *
 *   1. 列出**要删区间内出现的全部顶层声明**，并与"允许删的清单"比对——多出一个就整体中止；
 *   2. 删完之后再用 `tools/compare-declarations.mjs` 对一遍（人工步骤，脚本会把命令打出来）。
 *
 * 用法：node tools/move-execution-module.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const HOST = 'index.js';
const DRY = process.argv.includes('--dry');
let source = readFileSync(HOST, 'utf8');
const steps = [];

function cut(label, from, to) {
  if (!source.includes(from)) {
    console.error(`找不到待删片段：${label}`);
    process.exit(1);
  }
  source = source.replace(from, to);
  steps.push(`cut:${label}`);
}
function swap(label, from, to) {
  if (!source.includes(from)) {
    console.error(`找不到待替换片段：${label}`);
    process.exit(1);
  }
  source = source.replace(from, to);
  steps.push(`swap:${label}`);
}

/** 要删掉的三段：在飞登记说明 + 两个声明；trackCall/inFlightCount；combineSignals；runSessionCall；describeCall。 */
const pieces = [
  {
    label: 'inflight-state',
    from: `  /**
   * Calls this host is currently waiting on, per session.
   *
   * The chip's switch and \`computer_stop\` both mean "stop", and a stop that only flips
   * a flag is not a stop: whatever is already in the worker keeps driving the desktop.
   * Every call registers a controller here, so revoking a session can abort what is in
   * flight — which drops anything still queued in the transport and tells the worker to
   * stop at its next step boundary — and then only report the session as stopped.
   */
  const inFlight = new Map();

  /** Sessions whose revoke is draining right now, so the chip can say 停止中 rather than 已停止. */
  const stopping = new Set();

`,
  },
  {
    label: 'track-and-count',
    from: `  function trackCall(sessionId, controller) {`,
  },
];

/** 先检查"待删区间"里的顶层声明，确保只删该删的。 */
const RANGE_START = `  /**\n   * Calls this host is currently waiting on, per session.`;
const RANGE_END = `  /**\n   * Snapshot ids each session has been shown`;
const rangeStartAt = source.indexOf(RANGE_START);
const rangeEndAt = source.indexOf(RANGE_END);
if (rangeStartAt < 0 || rangeEndAt < 0) {
  console.error('找不到待删区间（可能已经搬过）');
  process.exit(1);
}
const range = source.slice(rangeStartAt, rangeEndAt);
const declared = [...range.matchAll(/^ {2}(?:async )?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map((one) => one[1]);
const ALLOWED = ['inFlight', 'stopping', 'trackCall', 'inFlightCount', 'combineSignals', 'runSessionCall', 'describeCall'];
const unexpected = declared.filter((name) => !ALLOWED.includes(name));
if (unexpected.length > 0) {
  console.error(`待删区间里有计划外的声明，已中止：${unexpected.join(', ')}`);
  process.exit(1);
}
console.log(`待删区间声明检查通过：${declared.join(', ')}（${range.split('\n').length} 行）`);

// 1) 状态声明 → 登记表实例
swap('inflight-state', `  /**
   * Calls this host is currently waiting on, per session.
   *
   * The chip's switch and \`computer_stop\` both mean "stop", and a stop that only flips
   * a flag is not a stop: whatever is already in the worker keeps driving the desktop.
   * Every call registers a controller here, so revoking a session can abort what is in
   * flight — which drops anything still queued in the transport and tells the worker to
   * stop at its next step boundary — and only then report the session as stopped.
   */
  const inFlight = new Map();

  /** Sessions whose revoke is draining right now, so the chip can say 停止中 rather than 已停止. */
  const stopping = new Set();
`,
`  /** 执行协调（在飞登记 / 停止状态 / 浏览器通道的会话上下文）：见 internal/execution.mjs。 */
  const execution = createExecutionRegistry();
`);

// 2) trackCall + inFlightCount → 登记表方法（连同它们之间的注释一起删）
const trackBlockStart = source.indexOf(`  function trackCall(sessionId, controller) {`);
const countBlockEnd = source.indexOf(`  /**\n   * Combine the caller's abort signal with the host's own`);
if (trackBlockStart < 0 || countBlockEnd < 0 || countBlockEnd <= trackBlockStart) {
  console.error('找不到 trackCall…inFlightCount 的边界');
  process.exit(1);
}
source = source.slice(0, trackBlockStart) + source.slice(countBlockEnd);
steps.push('cut:trackCall+inFlightCount');

// 3) combineSignals + runSessionCall → 登记表方法（从 combineSignals 的注释到 describeCall 的注释之前）
const combineStart = source.indexOf(`  /**\n   * Combine the caller's abort signal with the host's own`);
const describeStart = source.indexOf(`  /** One short phrase describing a call, for the control state the chip shows. */`);
if (combineStart < 0 || describeStart < 0 || describeStart <= combineStart) {
  console.error('找不到 combineSignals…describeCall 的边界');
  process.exit(1);
}
source = source.slice(0, combineStart) + source.slice(describeStart);
steps.push('cut:combineSignals+runSessionCall');

// 4) describeCall → 从模块引入（函数体删掉）
const describeEnd = source.indexOf('\n', source.indexOf(`    return cmd;\n  }`));
if (describeEnd < 0) {
  console.error('找不到 describeCall 的结尾');
  process.exit(1);
}
source = source.slice(0, describeStart) + source.slice(describeEnd + 1);
steps.push('cut:describeCall');

// 5) 调用点改名
swap('call-track', `    const untrack = trackCall(sessionId, control);`, `    const untrack = execution.track(sessionId, control);`);
swap('call-combine', `    const signal = combineSignals(exec?.signal, control.signal);`, `    const signal = combineSignals(exec?.signal, control.signal);`);
swap('control-stopping', `    if (stopping.has(key)) state = 'stopping';`, `    if (execution.isStopping(key)) state = 'stopping';`);
swap('control-count', `      inFlight: inFlightCount(sessionId),`, `      inFlight: execution.count(sessionId),`);
swap('revoke-begin', `    stopping.add(key);`, `    execution.beginStop(key);`);
swap('revoke-abort', `    const controllers = [...(inFlight.get(key) ?? [])];
    for (const controller of controllers) controller.abort(new Error(reason));
    let cancelled = controllers.length;`, `    let cancelled = execution.abort(key, reason);`);
swap('revoke-end', `      stopping.delete(key);`, `      execution.endStop(key);`);

// 6) 引入模块
swap('import', `import { sessionKey, createSessions } from './internal/sessions.mjs';`,
`import { sessionKey, createSessions } from './internal/sessions.mjs';
import { combineSignals, describeCall, createExecutionRegistry } from './internal/execution.mjs';`);

if (DRY) {
  // 干跑必须**真的**不写盘：这个脚本第一版忘了这一步，于是 `--dry` 直接把文件改了
  // （第二次运行才发现"已经搬过"）。教训：带 --dry 的脚本，写盘之前必须有一道 DRY 闸门。
  console.log('（--dry：只检查与预演，不写文件）');
  process.exit(0);
}

writeFileSync(HOST, source, 'utf8');
console.log(`已应用 ${steps.length} 处：${steps.join(', ')}`);
console.log(`宿主 ${readFileSync(HOST, 'utf8').split('\n').length} 行`);
console.log('下一步：node --check index.js；再 node tools/compare-declarations.mjs <旧 index.js> 核对没删多。');
