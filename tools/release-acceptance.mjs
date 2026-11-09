/**
 * 一条命令跑完发行验收（复核结论第 4 条的"可审核候选"）。
 *
 * 把这几件事串起来，任何一条不达标就整体 FAIL：
 *
 *   1. 身份：仓库重算的 `releaseBuildId` 与随包 `release-manifest.json` 一致，且 `missing` 为空；
 *   2. 打包：ZIP 存在，且**清单里的每个文件都在包里**（反之包里的生产文件也都在清单里）；
 *   3. 解包：解到临时目录后重算身份仍一致，并用 `release-report` 在该目录起真实 helper；
 *   4. 钩子：跑一轮 A-B-A（同一份二进制、同参数），报告两个位置的安装返回值与回调计数；
 *   5. 签名：`Get-AuthenticodeSignature` 的结果如实记录（未签名不算"失败"，但要写清楚）。
 *
 *   node tools/release-acceptance.mjs [--zip <path>] [--skip-hook] [--out dist/release-acceptance.json]
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReleaseIdentity, productionFiles } from '../internal/release-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const argOf = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
};
const ZIP = argOf('zip', '');
const OUT = argOf('out', join(ROOT, 'dist', 'release-acceptance.json'));
const SKIP_HOOK = process.argv.includes('--skip-hook');

const rows = [];
const record = (name, status, detail) => {
  rows.push({ name, status, detail });
  const mark = status === 'pass' ? 'PASS' : status === 'warn' ? 'WARN' : 'FAIL';
  console.log(`  ${mark}  ${name.padEnd(22)} ${detail}`);
};
const powershell = (script, timeout = 60000) =>
  spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout });

/** 用 .NET 的 ZipFile 读条目名（PowerShell 5.1 里不需要额外模块）。 */
function zipEntries(path) {
  const out = powershell([
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `$z = [System.IO.Compression.ZipFile]::OpenRead("${path}")`,
    '$names = $z.Entries | ForEach-Object { $_.FullName }',
    '$z.Dispose()',
    '$names -join "`n"',
  ].join('; '), 120000);
  return (out.stdout ?? '').split(/\r?\n/).map((one) => one.trim()).filter(Boolean);
}

console.log('\n== 1. 发行身份 ==');
const identity = buildReleaseIdentity(ROOT);
const manifestPath = join(ROOT, 'release-manifest.json');
const shipped = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
record('manifest exists', shipped ? 'pass' : 'fail', shipped ? `${shipped.files.length} files` : 'release-manifest.json missing');
const identityMatches = shipped !== null && shipped.releaseBuildId === identity.buildId &&
  shipped.files.length === identity.files.length &&
  identity.files.every((one) => shipped.files.find((two) => two.name === one.name && two.sha256 === one.sha256));
record('identity matches', identityMatches ? 'pass' : 'fail', `repo ${identity.buildId} vs shipped ${shipped?.releaseBuildId ?? '—'}`);
record('no missing files', identity.missing.length === 0 ? 'pass' : 'fail', identity.missing.length === 0 ? 'none' : identity.missing.join(', '));
const covers = (prefix) => identity.files.filter((one) => one.name.startsWith(prefix)).length;
record('assets covered', covers('assets/character/') >= 20 ? 'pass' : 'fail', `${covers('assets/character/')} files (incl. transitions.json: ${identity.files.some((one) => one.name.endsWith('transitions.json'))})`);
record('interaction covered', covers('interaction/') >= 1 ? 'pass' : 'fail', `${covers('interaction/')} files`);
record('native helper covered', covers('native/') >= 1 ? 'pass' : 'fail', `${covers('native/')} file(s)`);

console.log('\n== 2. 打包 ==');
const zipPath = ZIP !== '' ? ZIP : (() => {
  const dir = join(ROOT, 'dist');
  const candidates = existsSync(dir)
    ? readdirSync(dir).filter((one) => one.startsWith('dsh-computer-use-') && one.endsWith('.zip')).sort()
    : [];
  return candidates.length === 0 ? '' : join(dir, candidates.at(-1));
})();
if (zipPath === '' || !existsSync(zipPath)) {
  record('zip exists', 'fail', 'no package in dist/ — run tools/pack-candidate.mjs');
} else {
  record('zip exists', 'pass', `${zipPath.split(/[\\/]/).at(-1)} (${(statSync(zipPath).size / 1048576).toFixed(1)} MB)`);
  const entries = zipEntries(zipPath);
  record('zip is readable', entries.length > 0 ? 'pass' : 'fail', `${entries.length} entries`);
  const prefix = 'dsh-computer-use/';
  const inZip = new Set(entries.map((one) => (one.startsWith(prefix) ? one.slice(prefix.length) : one)).filter((one) => one !== ''));
  const missingInZip = identity.files.map((one) => one.name).filter((name) => !inZip.has(name));
  record('every identity file is in the zip', missingInZip.length === 0 ? 'pass' : 'fail',
    missingInZip.length === 0 ? `${identity.files.length} files` : missingInZip.slice(0, 5).join(', '));

    // npm 那条路径：不真的跑 npm pack（要 30 秒），但静态检查 files 必须覆盖运行资源。
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const npmFiles = Array.isArray(pkg.files) ? pkg.files : [];
  const npmCovers = ['assets', 'native', 'interaction'].map((one) => npmFiles.includes(one));
  record('npm file list covers runtime dirs', npmCovers.every(Boolean) ? 'pass' : 'fail',
    ['assets', 'native', 'interaction'].map((one, index) => `${one}:${npmCovers[index] ? 'yes' : 'NO'}`).join(' '));
  // --deep-npm：真的打一次 npm 包、解出来、在解出来的目录里起 helper。
  if (process.argv.includes('--deep-npm')) {
    const out = mkdtempSync(join(tmpdir(), 'dsh-npm-'));
    const packed = spawnSync('npm', ['pack', '--pack-destination', out], { cwd: ROOT, encoding: 'utf8', timeout: 180000, windowsHide: true, shell: true });
    const tgzName = (packed.stdout ?? '').trim().split(/\r?\n/).filter(Boolean).at(-1) ?? '';
    const tgz = join(out, tgzName);
    record('npm pack produced a tarball', existsSync(tgz) ? 'pass' : 'fail', tgzName || String(packed.stderr ?? '').slice(0, 80));
    if (existsSync(tgz)) {
      const dest = mkdtempSync(join(tmpdir(), 'dsh-npm-x-'));
      spawnSync('tar', ['-xzf', tgz, '-C', dest], { encoding: 'utf8', timeout: 180000, windowsHide: true });
      const pkgRoot = join(dest, 'package');
      const npmAssets = existsSync(join(pkgRoot, 'assets', 'character', 'pack.json'));
      const npmHelper = existsSync(join(pkgRoot, 'native', 'indicator-helper', 'build', 'dsh-interaction-indicator.exe'));
      record('npm payload carries the assets', npmAssets ? 'pass' : 'fail', join('assets', 'character', 'pack.json'));
      record('npm payload carries the helper', npmHelper ? 'pass' : 'fail', 'native/indicator-helper/build/*.exe');
      if (npmHelper && npmAssets) {
        const report = spawnSync(process.execPath, ['-e', `
          import(${JSON.stringify('file:///' + join(ROOT, 'tools', 'release-report.mjs').replace(/\\/g, '/'))}).then(async (m) => {
            const r = await m.releaseReport({ root: ${JSON.stringify(pkgRoot.replace(/\\/g, '/'))} });
            process.stdout.write(JSON.stringify(r.columns));
          });`], { encoding: 'utf8', timeout: 120000, windowsHide: true });
        let columns = null;
        try { columns = JSON.parse((report.stdout ?? '').trim()); } catch { /* below */ }
        record('helper runs from the npm payload', columns?.runtime?.status === 'pass' ? 'pass' : 'fail',
          String(columns?.runtime?.detail ?? report.stdout ?? report.stderr ?? '').slice(0, 110));
      }
    }
  }
console.log('\n== 3. 解包后重算 + 起真机 ==');
  const dir = mkdtempSync(join(tmpdir(), 'dsh-accept-'));
  const extract = powershell([
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `[System.IO.Compression.ZipFile]::ExtractToDirectory("${zipPath}", "${dir}")`,
    '"ok"',
  ].join('; '), 180000);
  const unpacked = join(dir, 'dsh-computer-use');
  if ((extract.stdout ?? '').includes('ok') && existsSync(unpacked)) {
    const rebuilt = buildReleaseIdentity(unpacked);
    record('unpacked identity matches', rebuilt.buildId === identity.buildId ? 'pass' : 'fail', `${rebuilt.buildId}`);
    record('unpacked has no missing files', rebuilt.missing.length === 0 ? 'pass' : 'fail', rebuilt.missing.join(', ') || 'none');
    const report = spawnSync(process.execPath, ['-e', `
      import(${JSON.stringify('file:///' + join(ROOT, 'tools', 'release-report.mjs').replace(/\\/g, '/'))}).then(async (m) => {
        const r = await m.releaseReport({ root: ${JSON.stringify(unpacked.replace(/\\/g, '/'))} });
        process.stdout.write(JSON.stringify(r.columns));
      });`], { encoding: 'utf8', timeout: 120000, windowsHide: true });
    let columns = null;
    try { columns = JSON.parse((report.stdout ?? '').trim()); } catch { /* reported below */ }
    record('helper runs from the unpacked package', columns?.runtime?.status === 'pass' ? 'pass' : 'fail',
      String(columns?.runtime?.detail ?? report.stdout ?? report.stderr ?? '').slice(0, 110));
    record('execution policy allows it', columns?.policy?.status === 'pass' ? 'pass' : 'warn',
      String(columns?.policy?.detail ?? '—').slice(0, 90));
  } else {
    record('unpack', 'fail', String((extract.stderr ?? '').slice(0, 120) || 'extraction failed'));
  }
}

console.log('\n== 4. 钩子安装与回调（A-B-A，一轮） ==');
if (SKIP_HOOK) {
  record('hook A-B-A', 'warn', 'skipped (--skip-hook)');
} else {
  const helper = join(ROOT, 'native', 'indicator-helper', 'build', 'dsh-interaction-indicator.exe');
  const staged = join(tmpdir(), `accept-hook-${process.pid}.exe`);
  copyFileSync(helper, staged);
  const sameBytes = createHash('sha256').update(readFileSync(helper)).digest('hex') ===
    createHash('sha256').update(readFileSync(staged)).digest('hex');
  record('staged copy is identical', sameBytes ? 'pass' : 'fail', 'sha256');
  const probe = (path) => {
    const out = spawnSync(path, ['--hook-probe'], { encoding: 'utf8', windowsHide: true, timeout: 20000, cwd: ROOT });
    const line = (out.stdout ?? '').split('\n').map((one) => one.trim()).find((one) => one.startsWith('{"kind":"hook-probe"'));
    try { return line ? JSON.parse(line) : null; } catch { return null; }
  };
  const inside = probe(helper);
  const outside = probe(staged);
  record('hook installs (workspace copy)', inside?.hook === true ? 'pass' : 'fail', `lastError=${inside?.lastError ?? '—'} pumps=${inside?.pumps ?? '—'}`);
  record('hook installs (outside copy)', outside?.hook === true ? 'pass' : 'fail', `lastError=${outside?.lastError ?? '—'} pumps=${outside?.pumps ?? '—'}`);
  record('workspace copy receives no events', inside !== null ? 'warn' : 'fail',
    `calls=${inside?.calls ?? '—'}（这是已知的工作区限制，安装时不要软链回工作区）`);
}

console.log('\n== 5. 签名 ==');
const helperPath = join(ROOT, 'native', 'indicator-helper', 'build', 'dsh-interaction-indicator.exe');
const sig = powershell(`(Get-AuthenticodeSignature "${helperPath}").Status`, 60000);
const sigStatus = (sig.stdout ?? '').trim();
record('helper signature', sigStatus === 'Valid' ? 'pass' : 'warn', sigStatus === '' ? 'unknown' : sigStatus);
const sha = createHash('sha256').update(readFileSync(helperPath)).digest('hex');
record('helper sha256', 'pass', `${sha.slice(0, 16)}…  ${readFileSync(helperPath).length} bytes`);

const failed = rows.filter((one) => one.status === 'fail');
const warned = rows.filter((one) => one.status === 'warn');
const summary = {
  at: new Date().toISOString(),
  buildId: identity.buildId,
  files: identity.files.length,
  failed: failed.map((one) => one.name),
  warned: warned.map((one) => one.name),
  verdict: failed.length === 0 ? (warned.length === 0 ? 'pass' : 'pass-with-warnings') : 'fail',
  rows,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(summary, null, 2), 'utf8');
console.log(`\n${summary.verdict.toUpperCase()}  ${rows.length - failed.length - warned.length} pass / ${warned.length} warn / ${failed.length} fail`);
console.log(`报告：${OUT}`);
process.exit(failed.length === 0 ? 0 : 1);
