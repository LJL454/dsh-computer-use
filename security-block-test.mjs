/**
 * PR13 —— 安全软件拦截的诊断（方案 4.19.3）。
 *
 * 这一层最容易做错的地方不是"认不出 AMSI"，而是**把什么都当成 AMSI**：一旦把普通启动失败标成
 * 安全拦截，用户会被送去提交误报，真正的原因（语法错误、缺文件、权限）反而没人查。所以测试里
 * 有一半的断言在证明"不该报的没报"。
 *
 * 另一半是边界：诊断里带出去的东西必须是脱敏且有界的；被拦之后**不再自动重启同一个文件**；
 * 只有启动阶段的拦截才允许 `delivery: not_sent`。
 *
 *   node security-block-test.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PowerShellBackend } from './backend/bridge.js';
import {
  SECURITY_BLOCK_CODE,
  buildBlockedDiagnostic,
  classifySecurityBlock,
  extractPowerShellErrorId,
  redactStderr,
} from './internal/security-block.mjs';

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log('\n== classification: only the known shapes are called a block ==');
const amsi = classifySecurityBlock('At line:1 char:1\r\n+ Add-Type -TypeDefinition ...\r\nThis script contains malicious content and has been blocked by your antivirus software.\r\n    + CategoryInfo : ParserError: (:) [], ParserException\r\n    + FullyQualifiedErrorId : ScriptContainedMaliciousContent');
check('an AMSI block is recognised', amsi.blocked === true && amsi.kind === 'amsi', JSON.stringify(amsi));
check('it carries the stable code', amsi.code === SECURITY_BLOCK_CODE, amsi.code);
check('it names where to look, not how to disable the scan', /不要关闭 AMSI/.test(amsi.remediation) && !/exclusion|排除.*(?:添加|加入)/.test(amsi.remediation), amsi.remediation);
const quarantine = classifySecurityBlock('Operation did not complete successfully because the file contains a virus or potentially unwanted software.');
check('a quarantine message is recognised', quarantine.blocked === true && quarantine.kind === 'quarantine', JSON.stringify(quarantine));
const policy = classifySecurityBlock('This program is blocked by group policy. For more information, contact your system administrator.');
check('a policy block is recognised', policy.blocked === true && policy.kind === 'execution-policy', JSON.stringify(policy));
for (const text of [
  "ParserError: Missing closing '}' in statement block",
  'Cannot find path \'C:\\temp\\worker.ps1\' because it does not exist.',
  'Access is denied.',
  '',
]) {
  const verdict = classifySecurityBlock(text);
  check(`an ordinary failure is not called a block: ${text.slice(0, 40) || '(empty)'}`, verdict.blocked === false, JSON.stringify(verdict));
}

console.log('\n== the error id decides confirmed vs suspected ==');
check('the PowerShell error id is extracted', extractPowerShellErrorId('+ FullyQualifiedErrorId : ScriptContainedMaliciousContent') === 'ScriptContainedMaliciousContent');
check('an AMSI hresult is extracted', extractPowerShellErrorId('Exception 0x80076619 while scanning') === '0x80076619');
check('a generic hresult is still extracted', extractPowerShellErrorId('failed with 0x80070005') === '0x80070005');
check('nothing is invented when there is no id', extractPowerShellErrorId('Access is denied.') === '', extractPowerShellErrorId('Access is denied.'));
{
  const confirmed = buildBlockedDiagnostic({ phase: 'launch', stderr: 'This script contains malicious content and has been blocked by your antivirus software.\n+ FullyQualifiedErrorId : ScriptContainedMaliciousContent' });
  check('a structured id makes it confirmed', confirmed.confidence === 'confirmed', confirmed.confidence);
  const suspected = buildBlockedDiagnostic({ phase: 'launch', stderr: 'the antimalware scan interface refused the call' });
  check('a weak hint makes it suspected', suspected.confidence === 'suspected', suspected.confidence);
  const none = buildBlockedDiagnostic({ phase: 'launch', stderr: 'SyntaxError: unexpected token' });
  check('an unrelated failure has no confidence', none.confidence === 'none' && none.blocked === false, JSON.stringify({ blocked: none.blocked, confidence: none.confidence }));
}

console.log('\n== the excerpt is bounded and redacted ==');
{
  const path = 'C:\\Users\\someuser\\AppData\\Local\\Temp\\dsh\\worker.ps1 threw at 0x80076619';
  const redacted = redactStderr(path);
  check('the user name is not carried', !/someuser/.test(redacted) && /<user>/.test(redacted), redacted);
  const mail = redactStderr('owner someone@example.com reported it');
  check('an email is not carried', !/someone@example\.com/.test(mail) && /<email>/.test(mail), mail);
  const long = redactStderr('HEAD' + 'x'.repeat(4000) + 'TAIL', { limit: 200 });
  check('a long excerpt is truncated', long.length <= 200, String(long.length));
  check('the truncation keeps both ends', long.startsWith('HEAD') && long.endsWith('TAIL'), long.slice(0, 20));
}

console.log('\n== the delivery claim depends on the phase ==');
{
  const launch = buildBlockedDiagnostic({ phase: 'launch', stderr: 'ObjectNotFound' });
  check('a launch block is not_sent', launch.delivery === 'not_sent', launch.delivery);
  const running = buildBlockedDiagnostic({ phase: 'run', stderr: 'ScriptContainedMaliciousContent', delivery: 'sent_to_driver' });
  check('a block mid-run is unknown, whatever the caller says', running.delivery === 'unknown', running.delivery);
  const release = buildBlockedDiagnostic({ phase: 'release', stderr: 'ScriptContainedMaliciousContent' });
  check('a release block is unknown', release.delivery === 'unknown', release.delivery);
  check('and it says the release was not confirmed', release.releaseConfirmed === false, String(release.releaseConfirmed));
  check('nothing is marked retryable', launch.retryable === false && running.retryable === false && release.retryable === false);
}

console.log('\n== a blocked worker is not restarted, and the diagnostic survives ==');
{
  const dir = mkdtempSync(join(tmpdir(), 'dsh-security-block-'));
  const scriptPath = join(dir, 'worker.ps1');
  writeFileSync(scriptPath, '# fake worker\n', 'utf8');
  let spawns = 0;
  const backend = new PowerShellBackend({
    scriptPath,
    startTimeoutMs: 3000,
    timeoutMs: 3000,
    cancelFilePath: join(dir, 'cancel.txt'),
    spawn: () => {
      spawns += 1;
      // 一个"被 AMSI 拦下"的 worker：说一句和真实拦截相同的话，然后退出。
      const child = spawn(process.execPath, ['-e', `
        process.stderr.write('This script contains malicious content and has been blocked by your antivirus software.\\n+ FullyQualifiedErrorId : ScriptContainedMaliciousContent\\n');
        setTimeout(() => process.exit(1), 30);
      `], { stdio: ['pipe', 'pipe', 'pipe'] });
      return child;
    },
  });
  let error = null;
  try {
    await backend.request('state', {});
  } catch (caught) {
    error = caught;
  }
  check('the request fails', error !== null, String(error?.message));
  const diagnostic = backend.lastSecurityBlock;
  check('a diagnostic is recorded', diagnostic !== null && diagnostic.code === SECURITY_BLOCK_CODE, JSON.stringify(diagnostic));
  check('it is a launch-phase block', diagnostic?.phase === 'launch', String(diagnostic?.phase));
  check('it is confirmed by the structured id', diagnostic?.confidence === 'confirmed', String(diagnostic?.confidence));
  check('it carries the worker hash', /^[0-9a-f]{64}$/.test(diagnostic?.scriptHash ?? ''), String(diagnostic?.scriptHash));
  check('it is not retryable', diagnostic?.retryable === false);
  check('the stderr excerpt is bounded', (diagnostic?.stderrExcerpt ?? '').length <= 600, String(diagnostic?.stderrExcerpt?.length));

  const before = spawns;
  // 再请求一次：同一代际里不再拉起同一个文件。
  try { await backend.request('state', {}); } catch { /* expected */ }
  await sleep(120);
  check('the same file is not respawned', spawns === before, `${before} -> ${spawns}`);
  check('the diagnostic is still there for status', backend.lastSecurityBlock?.code === SECURITY_BLOCK_CODE);
  backend.dispose?.();
  await sleep(50);
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
