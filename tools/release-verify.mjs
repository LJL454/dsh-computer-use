#!/usr/bin/env node
/**
 * 发布目录的完整性校验（方案 4.19.5 / PR14）。
 *
 * 方案把"哈希对得上"和"这是谁发布的"分成两件事：
 *
 *   1. `release-manifest.json` 记录每个文件的**最终字节**哈希；篡改者可以同时替换文件与清单，
 *      所以清单本身不构成信任。
 *   2. 信任来自签名：`.ps1` 用 Authenticode，`.exe` 用代码签名 + 时间戳。签名会改变字节，
 *      因此"签名前"的清单只能用于构建期检查，发布目录必须对**签名后**的字节重新记账。
 *
 * 因此这里有两个模式：
 *
 *   `--verify`（默认）发布验收：清单 + 最终哈希 + 有效签名，缺一不可。
 *   `--build`   构建期：只核对"源正文对应关系 + 清单与现文件一致"，允许未签名。
 *
 * 用法：
 *   node tools/release-verify.mjs --dir <发布目录> [--manifest release-manifest.json] --verify
 *   node tools/release-verify.mjs --dir <发布目录> --build
 *
 * 退出码：0 通过；1 任一检查失败（逐条打印）。
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** 签名状态：`Valid` 之外一律不算通过（`UnknownError`/`NotSigned`/`HashMismatch`…）。 */
const SIGNED = new Set(['Valid']);

/** 只有这些后缀适合 Authenticode；JS/JSON 的来源链由受信任安装载体负责（方案 4.19.5）。 */
const SIGNED_SUFFIXES = ['.ps1', '.exe', '.dll', '.psm1', '.cmd', '.bat'];
const needsSignature = (name) => SIGNED_SUFFIXES.some((suffix) => name.toLowerCase().endsWith(suffix));

/** 发布目录里允许存在、但不进清单的东西。 */
const IGNORED = new Set(['release-manifest.json']);

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** 递归列出目录里的文件（相对路径，正斜杠）。 */
function walk(root, prefix = '') {
  const found = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...walk(root, relativePath));
    else found.push(relativePath);
  }
  return found;
}

/**
 * 取一个文件的 Authenticode 状态。
 *
 * 用 PowerShell 而不是自己解析 PE/签名结构：判定规则由系统给，插件不该另写一份。
 *
 * @param {string} path
 * @returns {Promise<{ status: string, signer: string, timestamped: boolean, error: string }>}
 */
export async function authenticodeStatus(path) {
  const script = [
    '$ErrorActionPreference = "Stop";',
    `$signature = Get-AuthenticodeSignature -LiteralPath '${path.replace(/'/g, "''")}';`,
    '$result = [pscustomobject]@{',
    '  status = [string]$signature.Status;',
    '  signer = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { "" };',
    '  timestamped = [bool]($signature.TimeStamperCertificate);',
    '};',
    'ConvertTo-Json -Compress -InputObject $result',
  ].join(' ');
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 30_000 });
    const parsed = JSON.parse(stdout.trim());
    return { status: String(parsed.status ?? ''), signer: String(parsed.signer ?? ''), timestamped: parsed.timestamped === true, error: '' };
  } catch (error) {
    return { status: 'UnknownError', signer: '', timestamped: false, error: String(error?.message ?? error) };
  }
}

/**
 * 校验一个发布目录。
 *
 * @param {{ dir: string, manifestName?: string, mode?: 'verify'|'build', signature?: (path: string) => Promise<object> }} options
 * @returns {Promise<{ ok: boolean, findings: Array<{ code: string, file?: string, detail: string }>, manifest: object|null }>}
 */
export async function verifyRelease(options) {
  const dir = resolve(options.dir);
  const manifestName = options.manifestName ?? 'release-manifest.json';
  const mode = options.mode === 'build' ? 'build' : 'verify';
  const signature = typeof options.signature === 'function' ? options.signature : authenticodeStatus;
  const findings = [];
  const fail = (code, detail, file) => findings.push({ code, detail, ...(file === undefined ? {} : { file }) });

  const manifestPath = join(dir, manifestName);
  if (!existsSync(manifestPath)) {
    fail('MANIFEST_MISSING', `no ${manifestName} in ${dir}`);
    return { ok: false, findings, manifest: null };
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail('MANIFEST_UNREADABLE', String(error?.message ?? error));
    return { ok: false, findings, manifest: null };
  }
  // 接受两种清单：插件自己写的 `schema: 1`（`files[].name`）与本文档的 v1（`files[].path`）。
  const schema = manifest?.schema;
  if (schema !== 1 && schema !== 'dsh.release.manifest/v1') fail('MANIFEST_SCHEMA', `unexpected schema ${String(schema)}`);
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  if (files.length === 0) fail('MANIFEST_EMPTY', 'the manifest lists no files');

  const listed = new Set();
  for (const entry of files) {
    const name = String(entry?.path ?? entry?.name ?? '');
    if (name === '') { fail('ENTRY_NO_PATH', 'an entry has no path'); continue; }
    listed.add(name);
    const absolute = join(dir, ...name.split('/'));
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      fail('FILE_MISSING', 'listed in the manifest but not in the directory', name);
      continue;
    }
    const actual = sha256(absolute);
    if (!/^[0-9a-f]{64}$/.test(String(entry?.sha256 ?? '')) || actual !== entry.sha256) {
      fail('FILE_HASH', `sha256 ${actual.slice(0, 12)}… does not match the manifest`, name);
    }
    // 源正文对应关系：签名前的构建产物哈希。签名会改字节，所以它和最终哈希本来就不同。
    if (typeof entry?.sourceSha256 === 'string' && entry.sourceSha256 !== '') {
      if (!/^[0-9a-f]{64}$/.test(entry.sourceSha256)) fail('SOURCE_HASH_FORMAT', 'sourceSha256 is not a sha256', name);
    } else {
      fail('SOURCE_HASH_MISSING', 'no sourceSha256 recorded; the source-to-release relation cannot be checked', name);
    }
    if (mode === 'verify' && needsSignature(name)) {
      const verdict = await signature(absolute);
      if (!SIGNED.has(verdict.status)) {
        fail('SIGNATURE', `Authenticode status is ${verdict.status || 'unknown'}${verdict.error === '' ? '' : ` (${verdict.error})`}`, name);
      } else if (String(verdict.signer).trim() === '') {
        fail('SIGNER_MISSING', 'the signature is valid but names no signer', name);
      } else if (verdict.timestamped !== true) {
        fail('TIMESTAMP_MISSING', 'the signature carries no timestamp; it expires with the certificate', name);
      }
    }
  }

  // 目录里多出来的文件：清单只覆盖**执行集**（真实的候选包还会带测试与文档），所以默认不把
  // 额外文件当失败；要"一个不多"的严格校验时显式打开。
  if (options.strictFiles === true) {
    for (const name of walk(dir)) {
      if (listed.has(name) || IGNORED.has(name)) continue;
      fail('FILE_UNLISTED', 'present in the directory but not in the manifest', name);
    }
  }

  return { ok: findings.length === 0, findings, manifest };
}

const isMain = process.argv[1] !== undefined && /release-verify\.mjs$/.test(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf('--dir');
  if (dirIndex < 0 || args[dirIndex + 1] === undefined) {
    console.error('usage: node tools/release-verify.mjs --dir <release dir> [--manifest name] [--build]');
    process.exit(2);
  }
  const manifestIndex = args.indexOf('--manifest');
  const result = await verifyRelease({
    dir: args[dirIndex + 1],
    manifestName: manifestIndex >= 0 ? args[manifestIndex + 1] : undefined,
    mode: args.includes('--build') ? 'build' : 'verify',
  });
  if (result.ok) {
    console.log(`OK  ${result.manifest.files.length} file(s) verified (${args.includes('--build') ? 'build' : 'release'} mode)`);
    process.exit(0);
  }
  for (const finding of result.findings) {
    console.error(`FAIL  ${finding.code}${finding.file === undefined ? '' : ` ${finding.file}`}: ${finding.detail}`);
  }
  console.error(`${result.findings.length} finding(s)`);
  process.exit(1);
}
