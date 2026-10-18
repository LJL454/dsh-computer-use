/**
 * 一次性修复：把误删的"在飞调用登记表"（inFlight / stopping / trackCall / inFlightCount /
 * combineSignals / mayRetryRead 等）从上一轮打好的候选包里取回，插进当前 index.js。
 *
 * 起因：搬 schema 可见性那一块时，我按"从 V02 注释到 snapshot 注释"整段删除，而这段区间里还夹着
 * 在飞调用登记——它不属于可见性，属于执行协调。教训记在这里：**按注释块切代码前先列出块内的
 * 顶层声明**，否则会连带删掉同区间的其它声明。
 *
 * 用法：node tools/restore-inflight-block.mjs <old-index.js> [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const oldPath = process.argv[2];
const DRY = process.argv.includes('--dry');
if (oldPath === undefined) {
  console.error('用法：node tools/restore-inflight-block.mjs <old-index.js> [--dry]');
  process.exit(2);
}

const HOST = 'index.js';
const oldText = readFileSync(oldPath, 'utf8');
const hostText = readFileSync(HOST, 'utf8');

/** 取回的范围：从"在飞登记"的说明注释起，到 `lastAction` 那段之前（lastAction 现在归 lease 模块）。 */
const START_MARKER = '  /**\n   * Calls this host is currently waiting on, per session.';
const END_MARKER = '  /**\n   * What this session last drove';
/** 插回的位置：当前宿主里 lastAction 那段已经搬走，所以插在 snapshot 注释之前。 */
const HOST_MARKER = '  /**\n   * Snapshot ids each session has been shown';
const startAt = oldText.indexOf(START_MARKER);
const endAt = oldText.indexOf(END_MARKER);
if (startAt < 0 || endAt < 0 || endAt <= startAt) {
  console.error(`在旧文件里找不到边界（start=${startAt} end=${endAt}）`);
  process.exit(1);
}
const block = oldText.slice(startAt, endAt);

/** 这一块必须包含的声明：少一个就说明取回的范围不对。 */
const REQUIRED = [
  'const inFlight = new Map();',
  'const stopping = new Set();',
];
const missing = REQUIRED.filter((needle) => !block.includes(needle));
if (missing.length > 0) {
  console.error(`取回的块里缺少：${missing.join(', ')}`);
  process.exit(1);
}
console.log(`取回 ${block.split('\n').length} 行，包含全部 ${REQUIRED.length} 个必需声明`);

/** 当前宿主里必须已经没有这些声明（否则会重复定义）。 */
const already = REQUIRED.filter((needle) => hostText.includes(needle));
if (already.length > 0) {
  console.error(`当前宿主里已经存在：${already.join(', ')}——不需要再插`);
  process.exit(1);
}
if (!hostText.includes(HOST_MARKER)) {
  console.error('当前宿主里找不到插入点（snapshot 注释）');
  process.exit(1);
}

const next = hostText.replace(HOST_MARKER, `${block}${HOST_MARKER}`);
console.log(`宿主 ${hostText.split('\n').length} → ${next.split('\n').length} 行`);
if (DRY) {
  console.log('（--dry：没有写文件）');
  process.exit(0);
}
writeFileSync(HOST, next, 'utf8');
console.log('已写回 index.js；下一步 node --check 与套件回归。');
