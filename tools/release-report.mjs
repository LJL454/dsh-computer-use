#!/usr/bin/env node
/**
 * 发布验收矩阵（方案 4.19/4.20 的"四列分开记"）。
 *
 * 方案明确要求：发行结果必须分别记录**静态文件扫描**、**实际启动与工作流**、**签名验证**、
 * **组织策略兼容**，不能用其中一个通过替代其它项。这份工具就按这四列出报表，每一列都自己跑、
 * 自己给结论，跑不了就写 `not_run` 并说明原因 —— 不拿"没报错"当通过。
 *
 *   node tools/release-report.mjs --root <安装根目录> [--scan]
 *
 * 退出码：0 = 必需的列都通过（签名 + 运行时）；1 = 必需列里有失败；2 = 用法错误。
 */
import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { verifySignedRelease } from '../internal/release-manifest.mjs';

const PASS = 'pass';
const FAIL = 'fail';
const NOT_RUN = 'not_run';
const WARN = 'warn';

function run(command, args, options = {}) {
  try {
    const stdout = execFileSync(command, args, { encoding: 'utf8', timeout: options.timeout ?? 120_000, windowsHide: true });
    return { ok: true, stdout, error: '' };
  } catch (error) {
    return { ok: false, stdout: String(error?.stdout ?? ''), error: String(error?.message ?? error) };
  }
}

/**
 * 列 2：实际启动与工作流 —— 真的起 helper、真的拿到 scopeReady 与 health。
 * @param root - 安装根目录。
 * @returns `{ status, detail }`。
 */
async function runtimeColumn(root) {
  const exe = join(root, 'native', 'indicator-helper', 'build', 'dsh-interaction-indicator.exe');
  const assets = join(root, 'assets', 'character');
  if (!existsSync(exe)) return { status: FAIL, detail: 'the indicator helper is not in the package' };
  const child = spawn(exe, [`--assets=${assets}`], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const lines = [];
  let carry = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    carry += chunk;
    let index;
    while ((index = carry.indexOf('\n')) >= 0) {
      const line = carry.slice(0, index).trim();
      carry = carry.slice(index + 1);
      if (line === '') continue;
      try { lines.push(JSON.parse(line)); } catch { /* a bad line is a finding of its own, below */ }
    }
  });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const waitFor = async (event, ms = 5000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const found = lines.findIndex((one) => one.event === event);
      if (found >= 0) return lines.splice(found, 1)[0];
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return null;
  };
  // 协议版本必须与 helper 一致（v2）。以前这里写死 1，helper 回 PROTOCOL_MISMATCH 就再也不发 ready，
  // 于是被误读成'启动失败'——实际是夹具陈旧。
  send({ requestId: 'r-hello', method: 'hello', protocolVersion: 2 });
  const ready = await waitFor('ready');
  if (ready === null) {
    const error = lines.find((one) => one.event === 'error');
    child.kill();
    return { status: FAIL, detail: error?.code === 'PROTOCOL_MISMATCH' ? 'the fixture speaks the wrong protocol' : 'the helper never sent ready' };
  }
  send({ requestId: 'r-prefs', method: 'setVisualPreferences', settingsRevision: 1, preferences: { bannerCharacter: true, cursorCharacter: true } });
  await waitFor('visualPreferencesApplied');
  send({ requestId: 'r-scope', method: 'beginScope', scopeId: 'release-report', epoch: 1 });
  const scope = await waitFor('scopeReady');
  send({ requestId: 'r-health', method: 'health' });
  const health = await waitFor('health');
  send({ requestId: 'r-stop', method: 'shutdown' });
  await waitFor('closed', 3000);
  child.kill();
  const problems = [];
  if (scope?.visualReady !== true) problems.push('visualReady is false');
  if (scope?.escapeReady !== true) problems.push('escapeReady is false');
  if (health?.characterSurface === 'ready' && !(health?.characterFrames > 0)) problems.push('the character never drew a frame');
  if (!(health?.frames > 0)) problems.push('the overlay never presented a frame');
  if (health?.affinityExcluded === false) problems.push('the overlay is not excluded from capture');
  return problems.length === 0
    ? { status: PASS, detail: `ready + scopeReady + health (frames ${health?.frames}, character ${health?.characterAssetVersion ?? 'n/a'}, cursor ${health?.cursorSurface ?? 'n/a'})` }
    : { status: FAIL, detail: problems.join('; ') };
}

/**
 * 列 1：静态文件扫描。默认不跑（跑一次是按需扫描，可能要几分钟），显式 `--scan` 才做。
 * @param root - 安装根目录。
 * @param enabled - 是否执行扫描。
 * @returns `{ status, detail }`。
 */
function staticScanColumn(root, enabled) {
  if (!enabled) return { status: NOT_RUN, detail: 'no on-demand scan was requested (pass --scan to run Start-MpScan)' };
  const scan = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-MpScan -ScanType CustomScan -ScanPath '${root}'`], { timeout: 600_000 });
  if (!scan.ok) return { status: NOT_RUN, detail: `the scan could not run: ${scan.error.split('\n')[0]}` };
  // 扫描跑完不等于"干净"：查最近一次检测记录里有没有指向这个目录的条目。
  const detections = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-MpThreatDetection | Select-Object -First 20 | ConvertTo-Json -Compress']);
  const text = detections.stdout.toLowerCase();
  const reported = text.includes(root.toLowerCase().replace(/\\/g, '\\\\')) || text.includes(root.toLowerCase());
  return reported
    ? { status: FAIL, detail: 'a Defender detection names this package' }
    : { status: PASS, detail: 'the on-demand scan finished and no detection names this package' };
}

/**
 * 列 3：签名验证。
 * @param root - 安装根目录。
 * @returns `{ status, detail }`。
 */
async function signatureColumn(root) {
  const report = await verifySignedRelease(root);
  if (report.matches) return { status: PASS, detail: `${report.signatures.valid.length} file(s) carry a valid, timestamped signature` };
  const codes = [...new Set(report.findings.map((one) => one.code))];
  return { status: FAIL, detail: `${report.findings.length} finding(s): ${codes.join(', ')}` };
}

/**
 * 列 4：组织策略兼容 —— 只读查询，不改任何策略。
 * @returns `{ status, detail }`。
 */
function policyColumn() {
  const execution = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-ExecutionPolicy -List | ConvertTo-Json -Compress']);
  const applocker = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'try { (Get-AppLockerPolicy -Effective -ErrorAction Stop).RuleCollections.Count } catch { "unavailable" }']);
  if (!execution.ok) return { status: NOT_RUN, detail: 'the execution policy could not be read' };
  const text = execution.stdout.toLowerCase();
  const restricted = /"allscope":"restricted"|"localmachine":"restricted"|"currentuser":"restricted"|"process":"restricted"/.test(text);
  const applockerCount = /^\d+/.test(applocker.stdout.trim()) ? Number(applocker.stdout.trim()) : null;
  const parts = [`execution policy ${restricted ? 'has Restricted scopes' : 'is not Restricted'}`, applockerCount === null ? 'AppLocker policy unavailable' : `AppLocker rule collections ${applockerCount}`];
  // 这不是"通过"：机器能不能跑，只有真的启动过才知道（列 2 回答那个）。
  return { status: restricted ? WARN : PASS, detail: parts.join('; ') };
}

/**
 * 组装四列报表。
 * @param options.root - 安装根目录。
 * @param options.scan - 是否执行按需扫描。
 * @returns 报表对象。
 */
export async function releaseReport(options = {}) {
  const root = resolve(options.root ?? '.');
  const columns = {
    staticScan: staticScanColumn(root, options.scan === true),
    runtime: await runtimeColumn(root),
    signature: await signatureColumn(root),
    policy: policyColumn(),
  };
  const required = [columns.runtime, columns.signature];
  const ok = required.every((column) => column.status === PASS);
  return { root, columns, ok };
}

const isMain = process.argv[1] !== undefined && /release-report\.mjs$/.test(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  if (rootIndex < 0 || args[rootIndex + 1] === undefined) {
    console.error('usage: node tools/release-report.mjs --root <installed package root> [--scan]');
    process.exit(2);
  }
  const report = await releaseReport({ root: args[rootIndex + 1], scan: args.includes('--scan') });
  const label = { staticScan: '静态文件扫描', runtime: '实际启动与工作流', signature: '签名验证', policy: '组织策略兼容' };
  console.log(`root: ${report.root}\n`);
  for (const [key, column] of Object.entries(report.columns)) {
    console.log(`${label[key].padEnd(10, '　')} ${column.status.padEnd(7)} ${column.detail}`);
  }
  console.log(`\n${report.ok ? 'OK  必需的列（运行时 + 签名）都通过' : 'FAIL  必需的列里有失败项'}`);
  process.exit(report.ok ? 0 : 1);
}
