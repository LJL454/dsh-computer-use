/**
 * 按"像素是否变化"调度（方案 五.2）。
 *
 * 断言三件事：
 *   1. 待机 2 秒：Present 次数约等于 idle 的换帧次数（8 帧 / 2600 ms ≈ 3 次/秒），
 *      而 30 Hz 的部件刷新全部走 `cursorPixelSkips`；
 *   2. 打开"减少动画"后部件相位冻结，待机 1.5 秒几乎不再 Present；
 *   3. 指针持续移动时该画的照画（move 片段 8 帧 / 1000 ms），不会因为有 key 就不再更新。
 *
 *   node render-key-test.mjs
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

if (!existsSync(EXE)) {
  console.error(`FAIL  need ${EXE}`);
  process.exit(2);
}

const staged = join(tmpdir(), `dsh-render-key-${process.pid}.exe`);
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
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  send({ method: 'hello', protocolVersion: 2 });
  await waitFor('ready', () => true, 8000);
  send({ method: 'setCompanionPreferences', enabled: true, hostInstanceId: 'render-key', settingsRevision: 1, helperGeneration: 1 });
  await waitFor('companionApplied');
  // 等预热完成，避免把冷解码算进"这 2 秒画了几次"。
  const deadline = Date.now() + 8000;
  let warmed = null;
  while (Date.now() < deadline && warmed === null) warmed = await health((one) => one.prewarmState === 'done', 400);
  await settle(400);

  console.log('\n== idle: only frame changes reach Present ==');
  const before = await health();
  await settle(2000);
  const after = await health();
  const presents = Number(after?.cursorPresents) - Number(before?.cursorPresents);
  const skips = Number(after?.cursorPixelSkips) - Number(before?.cursorPixelSkips);
  const loops = Number(after?.loopIterations) - Number(before?.loopIterations);
  check('the companion is showing the idle clip', after?.characterState === 'idle', String(after?.characterState));
  check('Present follows the idle frames, not the 30 Hz part refresh', presents <= 10, `presents ${presents} / 2 s`);
  check('the skipped refreshes are counted', skips >= 20, `skips ${skips}`);
  check('the main loop really did run', loops > 30, `loops ${loops}`);
  check('most wakes did not touch pixels', skips > presents * 3, `${skips} vs ${presents}`);

  console.log('\n== reduced motion freezes the part phase, so nothing is repainted ==');
  send({ method: 'setVisualPreferences', settingsRevision: 1, preferences: { reducedMotion: true } });
  await waitFor('visualPreferencesApplied');
  await settle(300);
  const frozenBefore = await health();
  await settle(1500);
  const frozenAfter = await health();
  const frozenPresents = Number(frozenAfter?.cursorPresents) - Number(frozenBefore?.cursorPresents);
  check('reduced motion really stops presenting', frozenPresents <= 2, `presents ${frozenPresents} / 1.5 s`);
  check('the surface is still alive', frozenAfter?.cursorSurface === 'ready', String(frozenAfter?.cursorSurface));

  send({ method: 'setVisualPreferences', settingsRevision: 2, preferences: { reducedMotion: false } });
  await waitFor('visualPreferencesApplied');

  console.log('\n== moving: the clip keeps animating ==');
  const moveScript = join(tmpdir(), `dsh-render-key-move-${process.pid}.ps1`);
  writeFileSync(moveScript, [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$until = (Get-Date).AddSeconds(2.5)',
    '$i = 0',
    'while ((Get-Date) -lt $until) {',
    '  [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point((700 + ($i % 2) * 90), 520)',
    '  $i += 1',
    '  Start-Sleep -Milliseconds 50',
    '}',
  ].join('\n'), 'utf8');
  const mover = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', moveScript], { windowsHide: true });
  const moverDone = new Promise((resolve) => mover.once('exit', resolve));
  const moveBefore = await health();
  await settle(1500);
  const moveAfter = await health((one) => one.characterState === 'move', 3000);
  const movePresents = Number((moveAfter ?? moveBefore)?.cursorPresents) - Number(moveBefore?.cursorPresents);
  check('moving selects the move clip', moveAfter?.characterState === 'move', String(moveAfter?.characterState));
  check('move frames still reach Present', movePresents >= 4, `presents ${movePresents}`);
  check('but still bounded by the clip rate', movePresents <= 40, `presents ${movePresents}`);
  await moverDone;

  send({ method: 'setCompanionPreferences', enabled: false, hostInstanceId: 'render-key', settingsRevision: 9, helperGeneration: 1 });
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
