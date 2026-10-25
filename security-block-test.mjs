/**
 * 安全软件拦截（AMSI / Defender / AppLocker）的回归测试（1.40.3，报告 P1-B）。
 *
 * 钉住三条：
 *   1. 这类文本被识别成 `BACKEND_BLOCKED_BY_AV`，不是"脚本缺失"、更不是"插件没挂载"。
 *   2. 失败契约里有同码的规则，且 `retry: 'never'`（重试不会变好）。
 *   3. doctor 的分层结论把 backend 标成 `blocked`，而不是笼统的 failed。
 *
 *   node security-block-test.mjs
 */
import assert from 'node:assert/strict';
import { classifySecurityBlock, SECURITY_BLOCK_CODE } from './internal/security-block.mjs';
import { collectDoctorReport } from './internal/doctor.mjs';

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error?.message ?? error}`);
  }
}

console.log('== A. signatures ==');
check('AMSI is recognised', () => {
  const verdict = classifySecurityBlock('At line:1 char:1\nScriptContainedMaliciousContent');
  assert.equal(verdict.blocked, true);
  assert.equal(verdict.code, SECURITY_BLOCK_CODE);
  assert.equal(verdict.kind, 'amsi');
});
check('a quarantine message is recognised', () => {
  const verdict = classifySecurityBlock('Operation did not complete successfully because the file contains a virus or potentially unwanted software.');
  assert.equal(verdict.blocked, true);
  assert.equal(verdict.kind, 'quarantine');
});
check('AppLocker / WDAC is recognised', () => {
  assert.equal(classifySecurityBlock('This program was blocked by your system administrator').blocked, true);
  assert.equal(classifySecurityBlock('CodeIntegrity: cannot be run because it is not digitally signed').blocked, true);
});
check('an ordinary worker crash is not mistaken for AV', () => {
  const verdict = classifySecurityBlock('worker exited with code 1 after 3s');
  assert.equal(verdict.blocked, false);
  assert.equal(verdict.code, '');
});
check('the remediation does not recommend disabling AMSI or adding exclusions', () => {
  const verdict = classifySecurityBlock('AMSI blocked the script');
  // 允许"不要关闭 AMSI"这种禁止句，不允许"建议/请/可以 关闭 AMSI 或加排除"这种推荐句。
  assert.doesNotMatch(verdict.remediation, /(?:建议|请|可以)[^。；]{0,12}(?:关闭\s*AMSI|加(?:入)?排除|disable AMSI|exclusion)/i);
  assert.match(verdict.remediation, /误报|发行说明/);
});

console.log('\n== B. failure contract ==');
const { FAILURE_RULES, backendMessage } = await import('./internal/failures.mjs');
check('a rule carries the same code', () => {
  const rule = FAILURE_RULES.find((entry) => entry.code === SECURITY_BLOCK_CODE);
  assert.ok(rule, 'missing FAILURE_RULES entry for BACKEND_BLOCKED_BY_AV');
  assert.equal(rule.retry, 'never');
});
check('the rule matches the AMSI text', () => {
  const rule = FAILURE_RULES.find((entry) => entry.code === SECURITY_BLOCK_CODE);
  assert.match('ScriptContainedMaliciousContent', rule.test);
});
check('backendMessage says "blocked by security software", not "script missing"', async () => {
  const { ComputerUseBackendError } = await import('./backend/bridge.js');
  const error = new ComputerUseBackendError('ScriptContainedMaliciousContent', { code: 'SPAWN_FAILED' });
  const text = backendMessage(error);
  assert.match(text, /安全软件/);
  assert.doesNotMatch(text, /脚本缺失/);
});

console.log('\n== C. doctor layering ==');
const report = collectDoctorReport({
  mode: 'host',
  insideHost: true,
  backend: { started: true, alive: false, generation: 1, pid: 1234, lastError: 'ScriptContainedMaliciousContent' },
  registeredToolNames: ['computer_screenshot'],
  registrationFailures: [],
});
check('backend phase is "blocked", not "failed"', () => {
  assert.equal(report.phases.backend.status, 'blocked');
  assert.equal(report.phases.backend.security?.vendor?.length > 0, true);
});
check('a fatal finding names the AV code', () => {
  assert.ok(report.findings.some((entry) => entry.code === SECURITY_BLOCK_CODE && entry.level === 'fatal'));
});
check('the three layers are reported separately', () => {
  assert.ok('resolve' in report.phases && 'activate' in report.phases && 'backend' in report.phases);
  assert.equal(report.phases.activate.status, 'ok');
});

console.log(`\n===== ${passed} passed, ${failed} failed =====`);
process.exit(failed === 0 ? 0 : 1);
