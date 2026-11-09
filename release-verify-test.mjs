/**
 * PR14 —— 发布目录的验收（方案 4.19.5）。
 *
 * 这条链路上最贵的错误是"清单对得上所以可信"：篡改者当然会一起改清单。测试因此把三件事分开验：
 *
 *   - **字节**：文件变了、少了、多了，都要报；
 *   - **来源关系**：没有 `sourceSha256` 的条目无法证明"发布物来自这份源码"；
 *   - **署名**：未签名、签名无主体、无时间戳，发布验收一律不过；构建期检查则只核对前两项。
 *
 * Authenticode 用一个注入的假函数代替 —— 真签名需要证书，而这里要验的是"判定规则"。
 *
 *   node release-verify-test.mjs
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyRelease } from './tools/release-verify.mjs';

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}
const sha256 = (text) => createHash('sha256').update(Buffer.from(text)).digest('hex');

const signed = async () => ({ status: 'Valid', signer: 'CN=Local Test Signer', timestamped: true, error: '' });
const unsigned = async () => ({ status: 'NotSigned', signer: '', timestamped: false, error: '' });

const dir = mkdtempSync(join(tmpdir(), 'dsh-release-'));
function writeRelease({ mutate } = {}) {
  const files = {
    'backend/worker.ps1': 'Write-Output "worker"\n',
    'native/indicator.exe': 'MZ fake binary',
  };
  for (const [name, text] of Object.entries(files)) {
    const absolute = join(dir, ...name.split('/'));
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, text, 'utf8');
  }
  const manifest = {
    schema: 'dsh.release.manifest/v1',
    version: '1.41.0',
    files: Object.entries(files).map(([name, text]) => ({
      path: name,
      sha256: sha256(text),
      sourceSha256: sha256(`${text}//source`),
    })),
  };
  if (mutate !== undefined) mutate(manifest, files);
  writeFileSync(join(dir, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

console.log('\n== a signed, consistent release passes ==');
writeRelease();
{
  const result = await verifyRelease({ dir, signature: signed });
  check('the release verifies', result.ok === true, JSON.stringify(result.findings));
  check('both files were checked', result.manifest.files.length === 2);
}

console.log('\n== the build-time check does not require a signature ==');
{
  const result = await verifyRelease({ dir, signature: unsigned, mode: 'build' });
  check('the unsigned build verifies', result.ok === true, JSON.stringify(result.findings));
}

console.log('\n== the release check does ==');
{
  const result = await verifyRelease({ dir, signature: unsigned });
  check('it fails', result.ok === false);
  check('the signature is the reason', result.findings.some((one) => one.code === 'SIGNATURE'), JSON.stringify(result.findings.map((one) => one.code)));
}
{
  const noSigner = async () => ({ status: 'Valid', signer: '', timestamped: true, error: '' });
  const result = await verifyRelease({ dir, signature: noSigner });
  check('a valid signature with no signer fails', result.findings.some((one) => one.code === 'SIGNER_MISSING'), JSON.stringify(result.findings.map((one) => one.code)));
}
{
  const noStamp = async () => ({ status: 'Valid', signer: 'CN=X', timestamped: false, error: '' });
  const result = await verifyRelease({ dir, signature: noStamp });
  check('an untimestamped signature fails', result.findings.some((one) => one.code === 'TIMESTAMP_MISSING'), JSON.stringify(result.findings.map((one) => one.code)));
}

console.log('\n== a changed file is caught even though the manifest is internally consistent ==');
{
  writeFileSync(join(dir, 'backend', 'worker.ps1'), 'Write-Output "worker" # tampered\n', 'utf8');
  const result = await verifyRelease({ dir, signature: signed });
  check('the file hash finding names the file', result.findings.some((one) => one.code === 'FILE_HASH' && one.file === 'backend/worker.ps1'), JSON.stringify(result.findings));
  writeRelease();
}

console.log('\n== a missing or extra file is caught ==');
{
  // 文件还在，但清单里没有它：发布包里混进了没被记账的东西。
  writeRelease({ mutate: (manifest) => { manifest.files = manifest.files.filter((one) => one.path !== 'native/indicator.exe'); } });
  const unlisted = await verifyRelease({ dir, signature: signed, strictFiles: true });
  check('a file present without an entry is unlisted', unlisted.findings.some((one) => one.code === 'FILE_UNLISTED' && one.file === 'native/indicator.exe'), JSON.stringify(unlisted.findings));
}
{
  writeRelease({ mutate: (manifest) => { manifest.files.push({ path: 'backend/missing.ps1', sha256: sha256('x'), sourceSha256: sha256('y') }); } });
  const result = await verifyRelease({ dir, signature: signed });
  check('a listed file that is absent is missing', result.findings.some((one) => one.code === 'FILE_MISSING' && one.file === 'backend/missing.ps1'), JSON.stringify(result.findings));
}

console.log('\n== the source relation cannot be skipped ==');
{
  writeRelease({ mutate: (manifest) => { for (const entry of manifest.files) delete entry.sourceSha256; } });
  const result = await verifyRelease({ dir, signature: signed });
  check('every entry without sourceSha256 is reported', result.findings.filter((one) => one.code === 'SOURCE_HASH_MISSING').length === 2, JSON.stringify(result.findings.map((one) => one.code)));
}

console.log('\n== a broken or missing manifest is a finding, not a crash ==');
{
  writeFileSync(join(dir, 'release-manifest.json'), '{ not json', 'utf8');
  const result = await verifyRelease({ dir, signature: signed });
  check('unreadable manifest is reported', result.findings.some((one) => one.code === 'MANIFEST_UNREADABLE'), JSON.stringify(result.findings));
}
{
  rmSync(join(dir, 'release-manifest.json'));
  const result = await verifyRelease({ dir, signature: signed });
  check('missing manifest is reported', result.findings.some((one) => one.code === 'MANIFEST_MISSING'), JSON.stringify(result.findings));
}

rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
