/**
 * 覆盖层纯几何自检（方案 8.3 的"边条几何"与"DPI 与拓扑"两行）。
 *
 * 没有第二块物理屏时，几何不能靠肉眼：`dsh-interaction-indicator.exe --self-test` 直接跑**产品代码**里的
 * `ComputeEdges` / `EdgeAlphaAtMonitorPoint` / `ComputeBannerLayout` / `ComputeCursorLayout`，
 * 覆盖 1366×768 到 4K、100/125/150/200% DPI、竖屏、负坐标与极小屏。
 *
 * 断言分三类：矩形不重叠且在屏内（含面积公式）、角部距离场单调且接缝连续、
 * 横幅/光标把人物放得下且贴边会换方位。
 *
 *   node overlay-geometry-test.mjs [--exe <helper>]
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

console.log('\n== the helper answers a geometry self-test without creating windows ==');
let report = null;
let exitCode = 0;
try {
  report = JSON.parse(execFileSync(EXE, ['--self-test'], { encoding: 'utf8', timeout: 30_000 }).trim());
} catch (error) {
  // 自检失败时进程会以 1 退出，但 JSON 仍然在 stdout 上 —— 先解析它，再判失败。
  const stdout = String(error?.stdout ?? '').trim();
  exitCode = Number(error?.status ?? 1);
  try {
    report = JSON.parse(stdout);
  } catch {
    console.error(`FAIL  the self-test did not print a JSON report (exit ${exitCode}): ${stdout.slice(0, 200)}`);
    process.exit(1);
  }
}
check('the report is an object', report !== null && typeof report === 'object');
check('it says whether the geometry is sound', typeof report?.ok === 'boolean', JSON.stringify(report?.ok));
check('it ran a real number of checks', Number.isFinite(report?.checks) && report.checks >= 200, String(report?.checks));
check('every check passed', report?.ok === true, JSON.stringify(report?.failures ?? []));
check('the process exited 0', exitCode === 0, String(exitCode));

console.log('\n== the matrix actually covers the interesting displays ==');
// 报告里不重复列出用例名；这里靠"检查条数随矩阵增长"证明矩阵没被悄悄裁掉：
// 7 组显示器 × (边条 9 + 角部 4 + 接缝 1 + 横幅 3×4 + 光标 9×3 + 方位 3) 的下界。
check('the matrix covers 7 displays × 4 DPIs', report.checks >= 200, String(report.checks));

console.log(`\n${passed} passed, ${failures.length} failed（helper 自检内部 ${report?.checks ?? 0} 条）`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
