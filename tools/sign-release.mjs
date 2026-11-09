/**
 * 签名与重写清单（方案 4.19.5 的流水线里那一段）。
 *
 * 方案把发布流水线写成一条链：
 *
 *   复制到发行 staging → 签名并加时间戳 → 验证签名链/发布者/时间戳
 *     → **为最终已签名字节生成 release-manifest** → 打包
 *
 * 这里实现"签名 → 验签 → 重写清单"这三步，并把顺序钉死：清单必须**在签名之后**生成，
 * 否则它记录的是签名的输入而不是产物 —— 那种包在验签时必然对不上。
 *
 *   node tools/sign-release.mjs --root <staging> --pfx <file.pfx> --password <pw> [--timestamp <url>]
 *   node tools/sign-release.mjs --root <staging> --thumbprint <sha1> [--timestamp <url>]
 *   node tools/sign-release.mjs --root <staging> --self-signed --no-timestamp     # 演练：不联网、不买证书
 *
 * 没有证书时用 `--self-signed`：它真的签、真的验，只是链不受信任（`Status` 会是 `UnknownError`/
 * `NotTrusted`）。演练的意义是证明**流水线本身**是通的，而不是证明"签名有效"。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { needsSignature, signatureReport, writeReleaseManifest } from '../internal/release-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const value = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};
const has = (flag) => args.includes(flag);

const ROOT = value('--root', '');
const PFX = value('--pfx', '');
const PASSWORD = value('--password', '');
const THUMBPRINT = value('--thumbprint', '');
const TIMESTAMP = value('--timestamp', 'http://timestamp.digicert.com');
const NO_TIMESTAMP = has('--no-timestamp');
const SELF_SIGNED = has('--self-signed');

if (ROOT === '' || !existsSync(ROOT)) {
  console.error('usage: node tools/sign-release.mjs --root <staging> (--pfx <file> --password <pw> | --thumbprint <sha1> | --self-signed) [--timestamp <url>] [--no-timestamp]');
  process.exit(2);
}
if (!SELF_SIGNED && PFX === '' && THUMBPRINT === '') {
  console.error('FAIL  no certificate: pass --pfx/--password, --thumbprint, or --self-signed for a rehearsal');
  process.exit(2);
}

/** 找 signtool.exe：优先 PATH，其次 Windows SDK 的已知位置。 */
function findSignTool() {
  for (const candidate of ['signtool.exe']) {
    try {
      execFileSync(candidate, [], { stdio: 'ignore' });
      return candidate;
    } catch (error) {
      if (error?.code !== 'ENOENT') return candidate;
    }
  }
  const sdkRoots = ['C:\\Program Files (x86)\\Windows Kits\\10\\bin', 'C:\\Program Files\\Windows Kits\\10\\bin'];
  for (const sdkRoot of sdkRoots) {
    if (!existsSync(sdkRoot)) continue;
    for (const version of ['10.0.22621.0', '10.0.26100.0', '10.0.22000.0']) {
      const exe = join(sdkRoot, version, 'x64', 'signtool.exe');
      if (existsSync(exe)) return exe;
    }
  }
  return null;
}

/**
 * 递归找出 staging 里需要签名的文件。
 *
 * 不依赖 release-manifest：那张清单是**最后一步**才写的，而这里要给它准备输入。
 * 规则与 `needsSignature` 同源（脚本与 PE），这里只负责走目录。
 */
function filesToSign(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (needsSignature(entry.name)) found.push(full);
    }
  };
  walk(root);
  return { names: found.map((full) => full.slice(root.length + 1).replace(/\\/g, '/')), existing: found };
}

/** 造一个自签证书用于演练；返回 pfx 路径，调用方负责清理。 */
function makeSelfSigned(workDir) {
  const pfx = join(workDir, 'rehearsal.pfx');
  const password = 'rehearsal-only';
  execFileSync('powershell.exe', [
    '-NoProfile', '-Command',
    [
      `$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=DSH Computer Use (rehearsal)' -CertStoreLocation 'Cert:\\CurrentUser\\My' -NotAfter (Get-Date).AddDays(2)`,
      `$pw = ConvertTo-SecureString -String '${password}' -Force -AsPlainText`,
      `Export-PfxCertificate -Cert $cert -FilePath '${pfx}' -Password $pw | Out-Null`,
      `$cert.Thumbprint`,
    ].join('; '),
  ], { encoding: 'utf8' });
  return { pfx, password };
}

const signTool = findSignTool();
if (signTool === null) {
  console.error('FAIL  signtool.exe not found (install the Windows SDK signing tools, or add it to PATH)');
  process.exit(2);
}

const { names: targetNames, existing: targets } = filesToSign(ROOT);
if (targets.length === 0) {
  console.error(`FAIL  nothing to sign under ${ROOT} (no script or PE in the release set)`);
  process.exit(2);
}

const workDir = SELF_SIGNED ? mkdtempSync(join(tmpdir(), 'dsh-sign-')) : null;
const certificate = SELF_SIGNED ? makeSelfSigned(workDir) : { pfx: PFX, password: PASSWORD };

console.log(`root      ${ROOT}`);
console.log(`signtool  ${signTool}`);
console.log(`targets   ${targets.length} file(s)`);
console.log(`cert      ${SELF_SIGNED ? 'self-signed (rehearsal: the chain will NOT be trusted)' : (PFX !== '' ? PFX : `thumbprint ${THUMBPRINT}`)}`);
console.log(`timestamp ${NO_TIMESTAMP ? 'none (rehearsal)' : TIMESTAMP}\n`);

let signed = 0;
const failures = [];
for (const target of targets) {
  const common = ['sign', '/fd', 'sha256'];
  const auth = certificate.pfx !== ''
    ? ['/f', certificate.pfx, '/p', certificate.password]
    : ['/sha1', THUMBPRINT];
  const stamp = NO_TIMESTAMP ? [] : ['/tr', TIMESTAMP, '/td', 'sha256'];
  try {
    execFileSync(signTool, [...common, ...auth, ...stamp, target], { stdio: 'pipe' });
    signed += 1;
    console.log(`signed    ${target.slice(ROOT.length + 1)}`);
  } catch (error) {
    const detail = String(error?.stderr ?? error?.message ?? error).split('\n').slice(0, 3).join(' | ');
    failures.push(`${target.slice(ROOT.length + 1)}: ${detail}`);
    console.log(`FAILED    ${target.slice(ROOT.length + 1)} :: ${detail}`);
  }
}

// 验签：判定交给系统。自签演练时 Status 不是 Valid，这是预期的 —— 打印出来，不假装通过。
const after = await signatureReport(ROOT);
const valid = after.valid.length;
console.log(`\nverify    ${valid}/${targetNames.length} file(s) are Valid, signed and timestamped`);
for (const finding of after.findings) {
  console.log(`          ${finding.file ?? ''}: ${finding.code} — ${finding.detail}`);
}

// 清单在**签名之后**重写：这是整条流水线的顺序要求。
const manifest = writeReleaseManifest(ROOT);
console.log(`manifest  identity ${manifest.manifest.releaseBuildId}, ${manifest.manifest.files.length} file(s), self-check ${manifest.verification.matches ? 'OK' : 'FAILED'}`);

if (workDir !== null) rmSync(workDir, { recursive: true, force: true });

const trustExpected = SELF_SIGNED ? targetNames.length - valid : 0;
if (failures.length > 0 || !manifest.verification.matches) {
  console.log('\nFAIL  the release was not signed cleanly; see the lines above');
  process.exit(1);
}
if (!SELF_SIGNED && valid !== targetNames.length) {
  console.log('\nFAIL  some files still carry no valid signature after signing');
  process.exit(1);
}
if (SELF_SIGNED) {
  console.log(`\nOK  rehearsal done: ${signed} file(s) signed, manifest rewritten over the signed bytes.`);
  console.log(`    ${trustExpected} file(s) are signed but not trusted — that is what a self-signed certificate means.`);
  console.log('    For a real release pass --pfx/--password (or --thumbprint) with your code-signing certificate.');
  process.exit(0);
}
console.log(`\nOK  ${signed} file(s) signed and trusted; manifest rewritten over the signed bytes`);
process.exit(0);
