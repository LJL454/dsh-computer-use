/**
 * PR14 尾项 —— 签名与清单是两件事（方案 4.19.5）。
 *
 * 方案里那句最容易被忽略的话是："`release-manifest.json` 的哈希本身不等于可信任发布者认证：
 * 篡改者可以同时替换文件与普通清单。" 所以这里的断言分两组：
 *
 *   * 签名判定：有效/未签名/无主体/无时间戳/查不到，各有各的发现；
 *   * 两者独立：清单对得上但没签名 → 不通过；签名全通过但清单过期或版本不对 → 也不通过。
 *
 * Authenticode 用注入的 runner 代替 —— 本机没有发行证书，而这里要验的是**判定规则**。
 *
 *   node release-signature-test.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PACKAGE_ROOT,
  needsSignature,
  productionFiles,
  signatureReport,
  verifySignedRelease,
  writeReleaseManifest,
} from './internal/release-manifest.mjs';

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}

/** An injected runner that answers every queried file with one status. */
const runnerFor = (files, { status, signer, timestamped }) => async () => JSON.stringify(
  files.map((name) => ({ file: join(PACKAGE_ROOT, ...name.split('/')), status, signer, timestamped })),
);

console.log('\n== only what can carry Authenticode is checked ==');
check('a script needs a signature', needsSignature('backend/worker.ps1') === true);
check('an executable needs a signature', needsSignature('native/indicator-helper/build/dsh-interaction-indicator.exe') === true);
check('a command shim needs a signature', needsSignature('install-and-repair.cmd') === true);
check('javascript does not', needsSignature('index.js') === false && needsSignature('internal/receipt.mjs') === false);
check('json does not', needsSignature('package.json') === false);

console.log('\n== the manifest now records the pre-sign build hash ==');
const written = writeReleaseManifest(PACKAGE_ROOT);
check('the manifest is written and verifies', written.verification.matches === true, JSON.stringify(written.verification.checks));
check('every entry carries sourceSha256', written.manifest.files.every((entry) => /^[0-9a-f]{64}$/.test(entry.sourceSha256 ?? '')), JSON.stringify(written.manifest.files.slice(0, 1)));
check('the two hashes agree at build time', written.manifest.files.every((entry) => entry.sourceSha256 === entry.sha256));
const checked = productionFiles(PACKAGE_ROOT).filter((name) => needsSignature(name));
check('the tree has files that need signing', checked.length > 0, String(checked.length));

console.log('\n== signature verdicts, one by one ==');
{
  const report = await signatureReport(PACKAGE_ROOT, checked, { runner: runnerFor(checked, { status: 'Valid', signer: 'CN=Release', timestamped: true }) });
  check('a fully signed set has no findings', report.findings.length === 0, JSON.stringify(report.findings.slice(0, 2)));
  check('every file is counted as valid', report.valid.length === checked.length, `${report.valid.length}/${checked.length}`);
}
{
  const report = await signatureReport(PACKAGE_ROOT, checked, { runner: runnerFor(checked, { status: 'NotSigned', signer: '', timestamped: false }) });
  check('an unsigned set fails for every file', report.findings.length === checked.length, String(report.findings.length));
  check('the finding names the status', /NotSigned/.test(report.findings[0]?.detail ?? ''), report.findings[0]?.detail);
}
{
  const report = await signatureReport(PACKAGE_ROOT, checked, { runner: runnerFor(checked, { status: 'Valid', signer: '', timestamped: true }) });
  check('a valid signature with no signer is refused', report.findings.every((one) => one.code === 'SIGNER_MISSING'), JSON.stringify(report.findings[0]));
}
{
  const report = await signatureReport(PACKAGE_ROOT, checked, { runner: runnerFor(checked, { status: 'Valid', signer: 'CN=Release', timestamped: false }) });
  check('an untimestamped signature is refused', report.findings.every((one) => one.code === 'TIMESTAMP_MISSING'), JSON.stringify(report.findings[0]));
}
{
  const report = await signatureReport(PACKAGE_ROOT, checked, { runner: async () => { throw new Error('powershell is not available'); } });
  check('a failed query fails closed', report.findings.length === 1 && report.findings[0].code === 'SIGNATURE_QUERY_FAILED', JSON.stringify(report.findings));
  check('and nothing is counted as valid', report.valid.length === 0);
}

console.log('\n== the two checks are independent ==');
{
  const signed = await verifySignedRelease(PACKAGE_ROOT, { runner: runnerFor(checked, { status: 'Valid', signer: 'CN=Release', timestamped: true }) });
  check('a fresh manifest plus valid signatures passes', signed.matches === true, JSON.stringify(signed.findings.slice(0, 3)));

  const unsigned = await verifySignedRelease(PACKAGE_ROOT, { runner: runnerFor(checked, { status: 'NotSigned', signer: '', timestamped: false }) });
  check('a fresh manifest without signatures does not', unsigned.matches === false);
  check('and the reason is the signature', unsigned.findings.every((one) => one.code === 'SIGNATURE'), JSON.stringify(unsigned.findings.slice(0, 1)));

  const wrongVersion = await verifySignedRelease(PACKAGE_ROOT, { version: '0.0.0-nope', runner: runnerFor(checked, { status: 'Valid', signer: 'CN=Release', timestamped: true }) });
  check('valid signatures do not excuse a version mismatch', wrongVersion.matches === false, JSON.stringify(wrongVersion.findings.slice(0, 2)));
}

console.log('\n== a package with no binaries to sign needs no signatures ==');
{
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sig-empty-'));
  const report = await signatureReport(dir, [], { runner: async () => '[]' });
  check('nothing to check is not a finding', report.findings.length === 0 && report.checked.length === 0);
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
