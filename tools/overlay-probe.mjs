// 覆盖层 v2 的实机探针（方案 8.3 的像素确认与窗口几何）：
//   hello → 偏好 → beginScope → 截图 → 窗口枚举 → 暂停/恢复差分 → endScope → 伴随 → shutdown。
//
// 用 `--no-affinity` 启动：截图里才看得见像素（正常启动会请求捕获排除，截图上本来就没有覆盖层）。
// "暂停"与"显示"两张截图的差分就是覆盖层真正画出来的像素 —— 这是判"画了但看不见"的唯一可靠办法。
//
//   node tools/overlay-probe.mjs [--shots <dir>] [--hold 1500]
// 只用 `--no-affinity`：截图里要能看见像素，正常启动会请求捕获排除。
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const exe = join(root, 'native', 'indicator-helper', 'build', 'dsh-interaction-indicator.exe');
const assets = join(root, 'assets', 'character');
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : join(root, '.verify-shots', 'overlay-probe');
const holdMs = process.argv.includes('--hold') ? Number(process.argv[process.argv.indexOf('--hold') + 1]) : 1500;

if (!existsSync(exe)) {
  console.error(`FAIL no helper at ${exe}`);
  process.exit(2);
}
mkdirSync(shots, { recursive: true });

const child = spawn(exe, ['--no-affinity', `--assets=${assets}`], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const events = [];
const waiters = [];

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function waitFor(event, timeoutMs = 6000) {
  const existing = events.find((one) => one.event === event && !one.__taken);
  if (existing) {
    existing.__taken = true;
    return Promise.resolve(existing);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const index = waiters.indexOf(entry);
      if (index >= 0) waiters.splice(index, 1);
      reject(new Error(`timed out waiting for ${event}; saw ${events.map((one) => one.event).join(',')}`));
    }, timeoutMs);
    const entry = { event, resolve: (payload) => { clearTimeout(timer); resolve(payload); } };
    waiters.push(entry);
  });
}

child.stderr.setEncoding('utf8');
let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk; });
createInterface({ input: child.stdout }).on('line', (line) => {
  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    console.log(`NON-JSON ${line}`);
    return;
  }
  events.push(payload);
  const index = waiters.findIndex((one) => one.event === payload.event);
  if (index >= 0) {
    const [entry] = waiters.splice(index, 1);
    payload.__taken = true;
    entry.resolve(payload);
  }
});

function shot(name) {
  const target = join(shots, name);
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class DpiAware {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
"@
[DpiAware]::SetProcessDpiAwarenessContext([IntPtr]-4) | Out-Null
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bmp.Size)
$bmp.Save('${target.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$size = "$($bounds.Width)x$($bounds.Height)"
$g.Dispose(); $bmp.Dispose()
Write-Output "saved $size"
`;
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8' });
  console.log(`SHOT ${out.trim()}`);
}

try {
  send({ requestId: 'h1', method: 'hello', protocolVersion: 2 });
  const ready = await waitFor('ready');
  console.log('READY', JSON.stringify({ protocolVersion: ready.protocolVersion, buildVersion: ready.buildVersion, counts: ready.counts, characterLoaded: ready.characterLoaded, renderMode: ready.renderMode }));

  send({
    requestId: 'p1',
    method: 'setVisualPreferences',
    settingsRevision: 1,
    preferences: {
      enabled: true,
      bannerCharacter: true,
      cursorCharacter: true,
      cursorHalo: true,
      edgeBreathing: true,
      bannerDecoration: true,
      bannerTheme: 'ocean',
      bannerCharacterHeightDip: 144,
      cursorCharacterHeightDip: 96,
    },
  });
  const applied = await waitFor('visualPreferencesApplied');
  console.log('PREFS', JSON.stringify({ applied: applied.applied, changed: applied.changed, cursorSurface: applied.cursorSurface }));

  send({ requestId: 'b1', method: 'beginScope', scopeId: 'smoke#1', epoch: 1 });
  const scope = await waitFor('scopeReady');
  console.log('SCOPE', JSON.stringify({ visualReady: scope.visualReady, escapeReady: scope.escapeReady, counts: scope.counts, firstPresentMs: scope.firstPresentMs, cursorStatus: scope.cursorStatus, characterSurface: scope.characterSurface }));
  if (!scope.visualReady) console.log('WINDOWS', JSON.stringify(scope.windowsDetail));

  await new Promise((resolve) => setTimeout(resolve, 300));
  shot('active.png');

  await new Promise((resolve) => setTimeout(resolve, holdMs));
  send({ requestId: 's1', method: 'health' });
  const health = await waitFor('health');
  console.log('HEALTH', JSON.stringify({ rid: health.requestId, pid: health.pid, loopIterations: health.loopIterations, renderPasses: health.renderPasses, frames: health.frames, characterFrames: health.characterFrames, characterSurface: health.characterSurface, characterCacheBytes: health.characterCacheBytes, characterState: health.characterState, cursorSurface: health.cursorSurface, cursorQuadrant: health.cursorQuadrant, ownerMode: health.ownerMode, phase: health.phase, counts: health.counts, bannerError: health.bannerError, bannerHr: health.bannerHr, bannerDraws: health.bannerDraws, topEdgeAlpha: health.topEdgeAlpha, cursorError: health.cursorError }));
  shot('active-late.png');
  const probe = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'probe-overlay-windows.ps1'), '-TargetPid', String(health.pid)], { encoding: 'utf8' });
  console.log(probe.trim());

  // 暂停 / 恢复：两张截图的差异就是覆盖层真正画出来的像素（定位"画了但看不见"用）。
  await new Promise((resolve) => setTimeout(resolve, 200));
  shot('shown.png');
  send({ requestId: 'v1', method: 'suspendVisual' });
  await waitFor('visualSuspended');
  await new Promise((resolve) => setTimeout(resolve, 200));
  shot('hidden.png');
  send({ requestId: 'v2', method: 'resumeVisual' });
  await waitFor('visualResumed');
  await new Promise((resolve) => setTimeout(resolve, 200));
  shot('resumed.png');

  send({ requestId: 'e1', method: 'endScope', scopeId: 'smoke#1' });
  const ended = await waitFor('scopeEnded');
  console.log('ENDED', JSON.stringify({ applied: ended.applied, counts: ended.counts, ownerMode: ended.ownerMode }));

  send({ requestId: 'c1', method: 'setCompanionPreferences', enabled: true, hostInstanceId: 'smoke-host', settingsRevision: 2, helperGeneration: 1 });
  const companion = await waitFor('companionApplied');
  console.log('COMPANION', JSON.stringify(companion));
  await new Promise((resolve) => setTimeout(resolve, 400));
  shot('companion.png');
  send({ requestId: 's2', method: 'health' });
  const health2 = await waitFor('health');
  console.log('HEALTH2', JSON.stringify({ rid: health2.requestId, pid: health2.pid, loopIterations: health2.loopIterations, renderPasses: health2.renderPasses, cursorEnsureFails: health2.cursorEnsureFails, companion: health2.companion, companionEnabled: health2.companionEnabled, hiddenReason: health2.companionHiddenReason, ownerMode: health2.ownerMode, scopeId: health2.scopeId, cursorSurface: health2.cursorSurface, counts: health2.counts, frames: health2.frames }));

  send({ requestId: 'c2', method: 'setCompanionPreferences', enabled: false, hostInstanceId: 'smoke-host', settingsRevision: 3, helperGeneration: 1 });
  const companionOff = await waitFor('companionApplied');
  console.log('COMPANION-OFF', JSON.stringify({ effectiveVisible: companionOff.effectiveVisible, hiddenReason: companionOff.hiddenReason, cursorWindows: companionOff.cursorWindows }));

  send({ requestId: 'x1', method: 'shutdown' });
  const closed = await waitFor('closed');
  console.log('CLOSED', JSON.stringify({ counts: closed.counts, frames: closed.frames, hookRemoved: closed.hookRemoved }));
} catch (error) {
  console.error('FAIL', String(error?.message ?? error));
  if (stderr.trim() !== '') console.error('stderr:', stderr.trim().slice(-800));
  process.exitCode = 1;
} finally {
  try {
    child.kill();
  } catch {
    /* already gone */
  }
}
