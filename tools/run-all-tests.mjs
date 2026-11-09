#!/usr/bin/env node
/**
 * 一次跑完全部测试套件，并给出**诚实的**汇总。
 *
 * 为什么要一个总跑器：验证散在几十个 `*-test.mjs` 里，每次只跑一部分就会漏掉"上次还好好的"。
 * 但"全部通过"也不能靠嘴上说 —— 这台机器上有的套件需要真实桌面、真实 tools 服务或真实签名证书，
 * 它们在研究阶段就是红的。所以这里的做法是：
 *
 *   * 全跑；
 *   * 把**已知的、与本次改动无关的**失败列进 `KNOWN`（每条都写清原因）；
 *   * 凡是没在 `KNOWN` 里的失败，一律算回归，退出码非零。
 *
 *   node tools/run-all-tests.mjs [--filter <substring>] [--jobs <n>]
 */
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/**
 * 已知失败：**不是**"允许失败"，而是"失败原因与本插件无关、且已在报告里说明"。
 * 任何新出现的失败都不属于这里。
 */
const KNOWN = [
  { file: 'wait-and-capture-test.mjs', reason: '需要真实桌面夹具（记事本窗口 + 稳定焦点）；在原始 1.40.3 上同样失败（已验证）' },
  { file: 'degraded-bootstrap-test.mjs', reason: '需要真实 tools 服务被延迟启动的宿主环境；在原始 1.40.3 上同样失败' },
  { file: 'live-tool-test.mjs', reason: '需要真实应用与 UIA 控件；在原始 1.40.3 上同样 2 条失败（已验证）' },
  { file: 'managed-find-test.mjs', reason: '需要真实记事本窗口的 UIA 树；同一断言在原始 1.40.3 上同样失败（条数随窗口状态在 1–5 间变化）' },
  { file: 'rollback-drill-test.mjs', reason: '需要一份原始 1.39.1 worker.ps1 作为回滚基线（--baseline）' },
];

/** 需要命令行参数才能跑：由安装/演练脚本带着参数调用，总跑器只报告"跳过"。 */
const NEEDS_ARGS = [
  { file: 'rehearsal-install-test.mjs', args: '--source <候选包目录>' },
];

const args = process.argv.slice(2);
const value = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};
const FILTER = value('--filter', '');
// 默认串行：有一批套件会动共享桌面资源（剪贴板、焦点、真实窗口的 UIA），并行跑会互相污染 ——
// 那样得到的"失败"是跑法造成的，不是代码造成的。`--jobs` 只在明确没有冲突时用。
const JOBS = Math.max(1, Number(value('--jobs', '1')) || 1);

const files = readdirSync(ROOT)
  .filter((name) => name.endsWith('-test.mjs'))
  .filter((name) => FILTER === '' || name.includes(FILTER))
  .sort();

for (const entry of NEEDS_ARGS) {
  const index = files.indexOf(entry.file);
  if (index >= 0) {
    files.splice(index, 1);
    console.log(`skipped ${entry.file} (needs ${entry.args})`);
  }
}

/** 跑一个套件，返回 `{ file, code, passed, failed, output }`。 */
function runSuite(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [join(ROOT, file)], { cwd: ROOT, windowsHide: true });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', (error) => resolve({ file, code: 1, passed: 0, failed: 0, output: String(error?.message ?? error), ms: Date.now() - started }));
    child.on('close', (code) => {
      const passed = (output.match(/(\d+) passed/g) ?? []).reduce((total, one) => total + Number(one.split(' ')[0]), 0);
      const failed = (output.match(/(\d+) failed/g) ?? []).reduce((total, one) => total + Number(one.split(' ')[0]), 0);
      resolve({ file, code, passed, failed, output, ms: Date.now() - started });
    });
  });
}

/** 有限并发地跑。 */
async function runAll(list, jobs) {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(jobs, list.length) }, async () => {
    while (index < list.length) {
      const current = list[index];
      index += 1;
      results.push(await runSuite(current));
    }
  });
  await Promise.all(workers);
  return results.sort((a, b) => a.file.localeCompare(b.file));
}

console.log(`running ${files.length} suite(s) with ${JOBS} job(s)\n`);
const results = await runAll(files, JOBS);

let regressions = 0;
let known = 0;
let totalPassed = 0;
let totalFailed = 0;
for (const result of results) {
  const ok = result.code === 0;
  const knownEntry = KNOWN.find((one) => one.file === result.file);
  totalPassed += result.passed;
  totalFailed += result.failed;
  if (!ok && knownEntry === undefined) regressions += 1;
  if (!ok && knownEntry !== undefined) known += 1;
  const label = ok ? 'ok  ' : knownEntry === undefined ? 'FAIL' : 'known';
  console.log(`${label}  ${result.file.padEnd(40)} ${String(result.passed).padStart(4)} passed ${String(result.failed).padStart(3)} failed  ${result.ms} ms`);
  if (!ok && knownEntry !== undefined) console.log(`       已知：${knownEntry.reason}`);
  if (!ok && knownEntry === undefined) {
    const tail = result.output.trim().split('\n').slice(-6).join('\n        ');
    console.log(`       输出尾部：\n        ${tail}`);
  }
}

console.log(`\n${results.length} suite(s): ${results.length - regressions - known} ok, ${known} known, ${regressions} regression(s)`);
console.log(`断言：${totalPassed} passed, ${totalFailed} failed`);
if (regressions > 0) {
  console.log('FAIL  有未登记的失败，按回归处理');
  process.exitCode = 1;
} else {
  console.log('OK  没有未登记的失败');
  process.exitCode = 0;
}
