/**
 * 发布验收矩阵（方案 4.19/4.20）的行为约束。
 *
 * 这份测试只守两条底线，因为四列本身是**报表**而不是判定器：
 *
 *   1. **必需列**只有"实际启动与工作流"和"签名验证"两列；静态扫描与组织策略是记录项，
 *      没跑就写 `not_run`，绝不能因为"没报错"算通过。
 *   2. 缺件（没有 helper、没有清单）必须是 `fail` 并说明原因，不是崩、也不是静默通过。
 *
 * 真机上的四列结论记在 `outputs/evidence/release-report.md`；这里跑的是可重复的那部分。
 *
 *   node release-report-test.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseReport } from './tools/release-report.mjs';

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); failures.push(label); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}

console.log('\n== an empty directory fails the two required columns, with reasons ==');
{
  const dir = mkdtempSync(join(tmpdir(), 'dsh-release-report-'));
  const report = await releaseReport({ root: dir });
  check('the report is not ok', report.ok === false);
  check('runtime fails because the helper is missing', report.columns.runtime.status === 'fail' && /helper/i.test(report.columns.runtime.detail), JSON.stringify(report.columns.runtime));
  check('signature fails because there is no manifest', report.columns.signature.status === 'fail', JSON.stringify(report.columns.signature));
  check('the static scan is recorded as not_run', report.columns.staticScan.status === 'not_run', JSON.stringify(report.columns.staticScan));
  check('the policy column is a record, not a verdict', ['pass', 'warn', 'not_run'].includes(report.columns.policy.status), JSON.stringify(report.columns.policy));
  rmSync(dir, { recursive: true, force: true });
}

console.log('\n== the real installation: runtime works, signature is the honest blocker ==');
{
  const root = 'E:\\inkos\\dsh-plugins\\dsh-computer-use';
  const report = await releaseReport({ root });
  check('runtime passes on the installed package', report.columns.runtime.status === 'pass', JSON.stringify(report.columns.runtime));
  check('the runtime detail names what it saw', /scopeReady/i.test(report.columns.runtime.detail) && /frames/i.test(report.columns.runtime.detail), report.columns.runtime.detail);
  check('signature is still the blocker', report.columns.signature.status === 'fail', JSON.stringify(report.columns.signature));
  check('the signature detail counts the findings', /\d+ finding/.test(report.columns.signature.detail), report.columns.signature.detail);
  check('so the overall verdict is fail', report.ok === false);
}

console.log(`\n${passed} passed, ${[...new Set(failures)].length} failed`);
if (failures.length > 0) {
  for (const failure of [...new Set(failures)]) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
