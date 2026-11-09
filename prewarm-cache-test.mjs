/**
 * 后台预热（方案 五.1）：首次解码不再发生在绘制线程上。
 *
 * 断言分三段：
 *   1. 只开日常伴随、**不做任何点击**，后台线程就把六个光标片段（含两个活动部件）建好：
 *      `prewarmState: done`、`prewarmBuilt ≥ 7`、`prewarmFailed: 0`、缓存条目 ≥ 20。
 *   2. 预热做完之后再点一次：`characterCacheBuildsUi` **不再增长**（点击路径没有解码），
 *      而状态机照常走 press_in → release。
 *   3. 预热与绘制并发：来回开关伴随 20 次（期间后台还在建），不崩、`characterError` 为空。
 *
 *   node prewarm-cache-test.mjs
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXE = join(HERE, 'native', 'indicator-helper', 'build', 'dsh-interaction-indicator.exe');
const ASSETS = join(HERE, 'assets', 'character');

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`);
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`);
  }
}

if (!existsSync(EXE) || !existsSync(ASSETS)) {
  console.error(`FAIL  need ${EXE} and ${ASSETS}`);
  process.exit(2);
}

const staged = join(tmpdir(), `dsh-prewarm-${process.pid}.exe`);
copyFileSync(EXE, staged);  // 工作区盘直接启动的进程收不到低级钩子（本机沙箱行为）
const child = spawn(staged, [`--assets=${ASSETS}`, '--no-affinity'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = '';
const events = [];
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line === '') continue;
    try { events.push(JSON.parse(line)); } catch { /* ignore */ }
  }
});
let nextRequest = 0;
const send = (message) => {
  const requestId = `r${nextRequest += 1}`;
  child.stdin.write(`${JSON.stringify({ requestId, ...message })}\n`);
  return requestId;
};
const waitFor = async (name, predicate = () => true, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const index = events.findIndex((one) => one.event === name && predicate(one));
    if (index >= 0) return events.splice(index, 1)[0];
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return null;
};
const health = async (predicate = () => true, timeoutMs = 5000) => {
  const requestId = send({ method: 'health' });
  return waitFor('health', (one) => one.requestId === requestId && predicate(one), timeoutMs);
};
/**
 * 反复问，直到条件满足。只问一次的话，第一个回执还是 `running` 就再也不会来了
 * ——预热从 running 变 done 本来就需要几帧。
 */
const waitForHealth = async (predicate, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sample = await health(predicate, 400);
    if (sample !== null) return sample;
  }
  return null;
};

try {
  send({ method: 'hello', protocolVersion: 2 });
  const ready = await waitFor('ready');
  check('the character loaded', ready?.characterLoaded === true, JSON.stringify(ready?.characterLoaded));

  console.log('\n== the background thread warms the cache without any click ==');
  send({ method: 'setCompanionPreferences', enabled: true, hostInstanceId: 'prewarm-probe', settingsRevision: 1, helperGeneration: 1 });
  await waitFor('companionApplied');
  const done = await waitForHealth((one) => one.prewarmState === 'done', 8000);
  check('prewarm reports done', done?.prewarmState === 'done', String(done?.prewarmState));
  check('it built the clips (idle/press_in/release/move/hold/drag + banner)', Number(done?.prewarmBuilt) >= 7, String(done?.prewarmBuilt));
  check('nothing failed', Number(done?.prewarmFailed) === 0, String(done?.prewarmFailed));
  check('the cache really holds body + part entries', Number(done?.characterCacheEntries) >= 20, String(done?.characterCacheEntries));
  check('the worker did the decoding', Number(done?.characterCacheBuildsWorker) >= 7, String(done?.characterCacheBuildsWorker));
  // 打开伴随的第一帧还没有任何画面可保留，所以 idle 的三层（body + tail + hair_back）仍会在
  // UI 线程上建一次——这是可以接受的；预热的价值在于**之后**的点击路径不再解码（下一条断言）。
  check('the UI thread built at most the first frame (3 layers of idle)', Number(done?.characterCacheBuildsUi) <= 3, String(done?.characterCacheBuildsUi));

  console.log('\n== after prewarm, a click decodes nothing ==');
  const buildsBefore = Number(done?.characterCacheBuildsUi ?? 0);
  const clickScript = join(tmpdir(), `dsh-prewarm-click-${process.pid}.ps1`);
  writeFileSync(clickScript, [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class PrewarmClick {',
    '  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);',
    '  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);',
    '}',
    '"@',
    '$form = New-Object System.Windows.Forms.Form',
    "$form.FormBorderStyle = 'None'; $form.TopMost = $true; $form.ShowInTaskbar = $false",
    "$form.StartPosition = 'Manual'; $form.Location = New-Object System.Drawing.Point(240, 240)",
    '$form.Size = New-Object System.Drawing.Size(240, 200)',
    '$form.Show(); [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 250',
    '[void][PrewarmClick]::SetCursorPos(360, 340)',
    'Start-Sleep -Milliseconds 100',
    '[PrewarmClick]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero)',
    'for ($i = 0; $i -lt 25; $i++) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 20 }',
    '[PrewarmClick]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)',
    'for ($i = 0; $i -lt 40; $i++) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 20 }',
    '$form.Close(); $form.Dispose()',
  ].join('\n'), 'utf8');
  await new Promise((resolve, reject) => {
    const clicker = spawn('powershell', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', clickScript], { windowsHide: true });
    clicker.on('exit', resolve);
    clicker.on('error', reject);
  });
  const afterClick = await health();
  check('the click did not decode on the UI thread',
    Number(afterClick?.characterCacheBuildsUi) === buildsBefore,
    `${afterClick?.characterCacheBuildsUi} vs ${buildsBefore}`);
  check('the click still ran through the state machine',
    (afterClick?.pointerClicks ?? 0) >= 1, String(afterClick?.pointerClicks));

  console.log('\n== prewarm and drawing really do run concurrently ==');
  for (let index = 0; index < 20; index += 1) {
    send({ method: 'setCompanionPreferences', enabled: index % 2 === 0, hostInstanceId: 'prewarm-probe', settingsRevision: 10 + index, helperGeneration: 1 });
    await waitFor('companionApplied', () => true, 2000);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  send({ method: 'setCompanionPreferences', enabled: true, hostInstanceId: 'prewarm-probe', settingsRevision: 99, helperGeneration: 1 });
  await waitFor('companionApplied');
  const settled = await waitForHealth((one) => one.prewarmState === 'done', 8000);
  check('the helper survived 20 toggles while warming', settled !== null);
  check('no character error was recorded', (settled?.characterError ?? '') === '', String(settled?.characterError));
  check('the cache is still bounded', Number(settled?.characterCacheBytes) < 64 * 1024 * 1024, String(settled?.characterCacheBytes));

  send({ method: 'setCompanionPreferences', enabled: false, hostInstanceId: 'prewarm-probe', settingsRevision: 100, helperGeneration: 1 });
  await waitFor('companionApplied');
  send({ method: 'shutdown' });
  await waitFor('closed', () => true, 4000);
} catch (error) {
  failures.push(`probe crashed :: ${error?.message ?? error}`);
  console.error(error);
} finally {
  try { child.stdin.end(); } catch { /* gone */ }
  setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 300);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
