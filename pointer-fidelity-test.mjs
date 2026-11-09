/**
 * 指针保真测试（方案 二·问题 A 与 六 的首条验收）。
 *
 * `dsh-interaction-indicator.exe --pointer-self-test` 直接跑产品代码里的
 * `pointer::Source`（钩子回调落点）、`pointer::Controller`（状态归约）与
 * `animation::StateFor`（选片段），合成 20,000 组 down/up 与移动：
 *
 *   - 10,000 组每组立刻排空（正常主线程节奏）；
 *   - 10,000 组整组攒着再排空（主线程卡住、首次解码、断点），其中每 100 组灌 600 条移动，
 *     把队列压满，验证"移动可合并、按钮边沿仍有保留槽位"。
 *
 * 这里只判自检本身的结论与规模，不重复实现状态机 —— 状态机在 C++ 里只有一份。
 *
 *   node pointer-fidelity-test.mjs [--exe <helper>]
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argOf = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
};
const EXE = argOf('exe', join(HERE, 'native', 'indicator-helper', 'build', 'dsh-interaction-indicator.exe'));

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

if (!existsSync(EXE)) {
  console.error(`FAIL  no helper at ${EXE} — build it first (native/indicator-helper/build.ps1)`);
  process.exit(2);
}

console.log('\n== 20,000 synthetic pointer groups run against the production reducer ==');
let report = null;
let exitCode = 0;
const started = Date.now();
try {
  report = JSON.parse(execFileSync(EXE, ['--pointer-self-test'], { encoding: 'utf8', timeout: 120_000 }).trim());
} catch (error) {
  // 失败时进程以 1 退出，但 JSON 仍然在 stdout 上 —— 先解析它，再判失败。
  const stdout = String(error?.stdout ?? '').trim();
  exitCode = Number(error?.status ?? 1);
  try {
    report = JSON.parse(stdout);
  } catch {
    console.error(`FAIL  the self-test did not print a JSON report (exit ${exitCode}): ${stdout.slice(0, 300)}`);
    process.exit(1);
  }
}
const elapsedMs = Date.now() - started;

check('the report names the pointer self-test', report?.kind === 'pointer-self-test', String(report?.kind));
check('every group passed', report?.ok === true, JSON.stringify(report?.failures ?? []).slice(0, 400));
check('the process exited 0', exitCode === 0, String(exitCode));
check('it covered at least 10,000 groups (the plan asks for 10,000)',
  Number(report?.groups) >= 10_000, String(report?.groups));
check('it covered the stalled-consumer half as well',
  Number(report?.groupsOnline) >= 10_000 && Number(report?.groupsStalled) >= 10_000,
  `${report?.groupsOnline}+${report?.groupsStalled}`);
check('each group contributed a real number of assertions',
  Number(report?.checks) >= 100_000, String(report?.checks));
check('no assertion was silently dropped', Array.isArray(report?.failures), JSON.stringify(report?.failures));
check('it runs in interactive time (no 20 s hang from the queue)', elapsedMs < 20_000, `${elapsedMs} ms`);

console.log(`\n${passed} passed, ${failures.length} failed（自检内部 ${report?.checks ?? 0} 条 / ${report?.groups ?? 0} 组 / ${elapsedMs} ms）`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
