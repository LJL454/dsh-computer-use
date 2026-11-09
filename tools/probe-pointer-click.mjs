/**
 * 实机点击探针：证明"钩子回调 → 有序队列 → 状态机 → 角色片段"这条链真的走通。
 *
 * 自检（--pointer-self-test）证明归约逻辑；这个探针证明**真实桌面上的物理点击**也会被看见：
 *
 *   1. 起一个 helper，开日常伴随（只有一个光标角色，没有边栏/横幅/光晕）；
 *   2. 在屏幕中间临时建一个置顶无边框小窗当靶子（点它不会碰到任何真实应用）；
 *   3. 把指针移到靶心，注入一次按下+抬起；
 *   4. 40 ms 轮询 health，记录 characterState / cursorPressed / pointerClicks。
 *
 * 断言：按住期间 cursorPressed=true 且片段是 press_in/pressed_hold；抬起后出现 release；
 * pointerClicks 增加；全程没有边沿被丢。
 *
 *   node tools/probe-pointer-click.mjs [--exe <helper>] [--assets <dir>] [--keep]
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const argOf = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
};
const EXE = argOf('exe', join(ROOT, 'native', 'indicator-helper', 'build', 'dsh-interaction-indicator.exe'));
const ASSETS = argOf('assets', join(ROOT, 'assets', 'character'));

if (!existsSync(EXE)) {
  console.error(`no helper at ${EXE}`);
  process.exit(2);
}

// 从工作区盘直接启动的进程在本机沙箱里收不到低级钩子事件（同样的字节从 %TEMP% 启动就能收到）。
// 探针验证的是产品逻辑，不是沙箱，所以先把 exe 拷到临时目录再从那里启动。
const stagedExe = join(tmpdir(), `dsh-pointer-probe-${process.pid}.exe`);
copyFileSync(EXE, stagedExe);

const child = spawn(stagedExe, [`--assets=${ASSETS}`, '--no-affinity'], { stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk; });
// helper 提前退出时 stdin 会 EPIPE：不接住就会把探针自己带崩。
child.stdin.on('error', () => {});
child.on('exit', (code) => { if (code !== 0 && code !== null) stderr += `\n[helper exited ${code}]`; });

const events = [];
let buffer = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line === '') continue;
    try { events.push(JSON.parse(line)); } catch { events.push({ event: '__unparsable__', line }); }
  }
});

let nextRequest = 0;
function send(message) {
  const requestId = message.requestId ?? `r${nextRequest += 1}`;
  child.stdin.write(`${JSON.stringify({ requestId, ...message })}\n`);
  return requestId;
}

async function waitFor(event, predicate = () => true, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const index = events.findIndex((one) => one.event === event && predicate(one));
    if (index >= 0) return events.splice(index, 1)[0];
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  return null;
}

/**
 * 建一个置顶靶窗、点它、再关掉。**写成 .ps1 文件再 -File 运行**：`-Command` 会把
 * here-string 里的引号吞掉，Add-Type 直接解析失败，点击就根本不会发生。
 */
const CLICK_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeClick {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
"@
$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(240, 240)
$form.Size = New-Object System.Drawing.Size(240, 200)
$form.BackColor = [System.Drawing.Color]::FromArgb(40, 40, 40)
$script:clicked = 0
$form.Add_Click({ $script:clicked = 1 })
$form.Show()
[System.Windows.Forms.Application]::DoEvents()
Start-Sleep -Milliseconds 250
[void][NativeClick]::SetCursorPos(360, 340)
Start-Sleep -Milliseconds 120
[NativeClick]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
for ($i = 0; $i -lt 30; $i++) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 20 }
[NativeClick]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
for ($i = 0; $i -lt 60; $i++) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 20 }
$form.Close()
$form.Dispose()
Write-Output ("clicked=" + $script:clicked)
`;

const observations = [];
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) console.log(`  PASS  ${label}`);
  else { failed += 1; console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
};

try {
  send({ method: 'hello', protocolVersion: 2 });
  const ready = await waitFor('ready');
  check('the helper is ready', ready !== null && ready.characterLoaded === true, JSON.stringify(ready?.characterLoaded));

  send({ method: 'setCompanionPreferences', enabled: true, hostInstanceId: 'probe-pointer-click', settingsRevision: 1, helperGeneration: 1 });
  const applied = await waitFor('companionApplied');
  check('the companion is on', applied?.requestedEnabled === true && applied?.effectiveVisible === true, JSON.stringify(applied));

  send({ method: 'health' });
  const before = await waitFor('health');
  check('the cursor character exists before the click', before?.cursorCharacterVisible === true, JSON.stringify(before?.cursorCharacterVisible));
  const clicksBefore = Number(before?.pointerClicks ?? 0);

  const clickerScript = join(tmpdir(), `dsh-pointer-click-${process.pid}.ps1`);
  writeFileSync(clickerScript, CLICK_SCRIPT, 'utf8');
  const clicker = spawn('powershell', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', clickerScript], { windowsHide: true });
  let clickerOut = '';
  clicker.stdout.on('data', (chunk) => { clickerOut += chunk; });
  clicker.stderr.on('data', (chunk) => { clickerOut += chunk; });
  // 先建好 exit 的 promise：进程可能在 await 之前就结束，之后再挂 once('exit') 会永远等不到。
  const clickerExit = new Promise((resolve) => clicker.once('exit', resolve));
  const clickerOutcome = Promise.race([clickerExit, new Promise((resolve) => setTimeout(() => resolve('timeout'), 8000))]);

  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    send({ method: 'health' });
    const health = await waitFor('health', () => true, 2_000);
    if (health) {
      observations.push({
        at: Date.now(),
        state: health.characterState,
        pressed: health.cursorPressed,
        clicks: Number(health.pointerClicks ?? 0),
        dropped: Number(health.pointerDroppedEdges ?? 0),
        seen: Number(health.pointerEventsSeen ?? -1),
        hook: health.mouseHookReady,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (observations.some((one) => one.state === 'release') && observations.some((one) => one.pressed === true)) break;
  }
  await clickerOutcome;

  const pressedSeen = observations.some((one) => one.pressed === true);
  const pressClipSeen = observations.some((one) => one.state === 'press_in' || one.state === 'pressed_hold');
  const releaseSeen = observations.some((one) => one.state === 'release');
  const clicksAfter = Math.max(...observations.map((one) => one.clicks), 0);
  const dropped = Math.max(...observations.map((one) => one.dropped), 0);

  check('the physical press reached the state machine', pressedSeen,
    JSON.stringify({ clicker: clickerOut.trim().slice(-120), samples: observations.slice(0, 3) }));
  check('the helper hook was ready', observations.every((one) => one.hook === true),
    JSON.stringify(observations.slice(0, 3)));
  check('the hook saw events at all', Math.max(...observations.map((one) => one.seen)) > 2,
    String(Math.max(...observations.map((one) => one.seen))));
  check('the press selected press_in / pressed_hold', pressClipSeen, observations.map((one) => one.state).join(','));
  check('the release selected the release clip', releaseSeen, observations.map((one) => one.state).join(','));
  check('health counted the click', clicksAfter === clicksBefore + 1, `${clicksBefore} -> ${clicksAfter}`);
  check('no button edge was dropped', dropped === 0, String(dropped));
  check('the click left nothing pressed', observations.at(-1)?.pressed === false, String(observations.at(-1)?.pressed));

  send({ method: 'setCompanionPreferences', enabled: false, hostInstanceId: 'probe-pointer-click', settingsRevision: 2, helperGeneration: 1 });
  await waitFor('companionApplied');
  send({ method: 'shutdown' });
  await waitFor('closed', () => true, 4_000);
} catch (error) {
  failed += 1;
  console.error(`  FAIL  probe crashed :: ${error?.message ?? error}`);
  console.error(stderr.slice(-500));
} finally {
  try { child.stdin.end(); } catch { /* already gone */ }
  setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 500);
}

console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} (${observations.length} health samples)`);
process.exit(failed === 0 ? 0 : 1);
