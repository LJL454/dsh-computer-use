/**
 * 跨片段进入帧（方案 三·问题 F）。
 *
 * 两半：
 *   1. 表本身：`assets/character/transitions.json` 覆盖全部 49 个 (from,to) 组合，进入帧在范围内，
 *      一次性片段（press_in / release）必须为 0，混合时长只在 {0,60,100}，且选中的帧**从不比 frame 0 更差**。
 *   2. 运行时真的用了表：起一个只开日常伴随的 helper，移动指针进入 move、停下回到 idle，
 *      再点一次真实点击走 release → idle，读 health 的 `cursorEntryFrame` / `cursorLastFadeMs` 对表。
 *
 *   node transition-table-test.mjs
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXE = join(HERE, 'native', 'indicator-helper', 'build', 'dsh-interaction-indicator.exe');
const ASSETS = join(HERE, 'assets', 'character');
const TABLE = join(ASSETS, 'transitions.json');

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

if (!existsSync(EXE) || !existsSync(TABLE)) {
  console.error(`FAIL  need ${EXE} and ${TABLE}`);
  process.exit(2);
}

const pack = JSON.parse(readFileSync(join(ASSETS, 'pack.json'), 'utf8'));
const table = JSON.parse(readFileSync(TABLE, 'utf8'));
const clips = Object.keys(pack.clips);

console.log('\n== the table covers every ordered pair ==');
check('the schema is the one the loader accepts', table.schema === 'dsh.character.transitions/v1', String(table.schema));
check('it was generated for this asset version', table.assetVersion === pack.assetVersion, String(table.assetVersion));
check('49 ordered pairs', table.pairs.length === clips.length * clips.length, `${table.pairs.length}/${clips.length * clips.length}`);
const seen = new Set(table.pairs.map((pair) => `${pair.from}->${pair.to}`));
check('no pair is missing', clips.every((from) => clips.every((to) => seen.has(`${from}->${to}`))));

console.log('\n== every entry frame is usable ==');
let badFrame = null;
let badFade = null;
let worseThanZero = null;
let oneShotJump = null;
for (const pair of table.pairs) {
  const target = pack.clips[pair.to];
  if (!Number.isInteger(pair.entryFrame) || pair.entryFrame < 0 || pair.entryFrame >= target.frameCount) {
    badFrame ??= JSON.stringify(pair);
  }
  if (![0, 60, 100].includes(pair.fadeMs)) badFade ??= JSON.stringify(pair);
  // 选中的进入帧是"对 from 全部帧都最不突兀"的那一帧，至少不能比 frame 0 更差。
  if (pair.worstDistance > pair.frameZeroWorst + 1e-6) worseThanZero ??= JSON.stringify(pair);
  // 一次性片段必须从第 0 帧开始播，不能被表跳掉开头。
  if (!target.loop && pair.entryFrame !== 0) oneShotJump ??= JSON.stringify(pair);
}
check('every entry frame is inside the target clip', badFrame === null, badFrame ?? '');
check('every fade length is one of 0/60/100 ms', badFade === null, badFade ?? '');
check('the chosen frame is never worse than frame 0', worseThanZero === null, worseThanZero ?? '');
check('one-shot clips always start at frame 0', oneShotJump === null, oneShotJump ?? '');

const idleToMove = table.pairs.find((pair) => pair.from === 'idle' && pair.to === 'move');
const moveToIdle = table.pairs.find((pair) => pair.from === 'move' && pair.to === 'idle');
const releaseToIdle = table.pairs.find((pair) => pair.from === 'release' && pair.to === 'idle');
check('idle -> move has a rule', idleToMove !== undefined);
check('a loop-to-loop rule chooses a non-zero entry frame somewhere',
  table.pairs.some((pair) => pack.clips[pair.to].loop && pair.entryFrame > 0), 'none');

console.log('\n== the runtime actually reads the table ==');
const staged = join(tmpdir(), `dsh-transition-probe-${process.pid}.exe`);
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
/**
 * 只认"这次请求"的 health 回执。
 *
 * 直接 `send` 再 `waitFor('health')` 会捡到之前排队的旧回执（例如移动开始前那次 idle），
 * 于是断言拿到的是过期状态 —— 这在本测试里真的发生过一次。
 */
const health = async (predicate = () => true, timeoutMs = 5000) => {
  const requestId = send({ method: 'health' });
  return waitFor('health', (one) => one.requestId === requestId && predicate(one), timeoutMs);
};

try {
  send({ method: 'hello', protocolVersion: 2 });
  const ready = await waitFor('ready');
  check('the character loaded', ready?.characterLoaded === true, JSON.stringify(ready?.characterLoaded));
  send({ method: 'setCompanionPreferences', enabled: true, hostInstanceId: 'transition-probe', settingsRevision: 1, helperGeneration: 1 });
  await waitFor('companionApplied');

  const before = await health();
  check('the helper loaded every transition rule', before?.characterTransitions === table.pairs.length, String(before?.characterTransitions));
  check('no transition file error', (before?.transitionError ?? '') === '', String(before?.transitionError));

  // 让指针真的动起来：日常伴随靠 GetCursorPos 采样位置，SetCursorPos 就足够改变状态。
  // 移动放在**后台**进程里跑，否则等脚本结束再采样时指针已经停了，状态早回到 idle。
  const moveScript = join(tmpdir(), `dsh-move-${process.pid}.ps1`);
  writeFileSync(moveScript, [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$until = (Get-Date).AddSeconds(3)',
    '$i = 0',
    'while ((Get-Date) -lt $until) {',
    '  $x = 600 + ($i % 2) * 80',
    '  [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, 520)',
    '  $i += 1',
    '  Start-Sleep -Milliseconds 60',
    '}',
  ].join('\n'), 'utf8');
  const mover = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', moveScript], { windowsHide: true });
  const moverDone = new Promise((resolve) => mover.once('exit', resolve));
  let moving = null;
  const moveDeadline = Date.now() + 5000;
  while (Date.now() < moveDeadline && moving === null) {
    moving = await health((one) => one.characterState === 'move', 800);
  }
  check('moving selects the move clip', moving?.characterState === 'move', String(moving?.characterState));
  check('and enters at the table frame', Number(moving?.cursorEntryFrame) === Number(idleToMove?.entryFrame),
    `${moving?.cursorEntryFrame} vs ${idleToMove?.entryFrame}`);
  await moverDone;

  await new Promise((resolve) => setTimeout(resolve, 400));
  const idle = await health((one) => one.characterState === 'idle', 3000);
  check('stopping returns to idle', idle?.characterState === 'idle', String(idle?.characterState));
  check('idle is entered at the matched frame, not at the process phase',
    Number(idle?.cursorEntryFrame) === Number(moveToIdle?.entryFrame),
    `${idle?.cursorEntryFrame} vs ${moveToIdle?.entryFrame}`);
  check('and the applied fade matches the table', Number(idle?.cursorLastFadeMs) === Number(moveToIdle?.fadeMs),
    `${idle?.cursorLastFadeMs} vs ${moveToIdle?.fadeMs}`);

  // 一次真实点击：press_in → release → idle。release → idle 在表里是进入第 3 帧，
  // 这条路径只能靠"点击"走到，正好证明非零进入帧在运行时真的生效。
  console.log('\n== a real click lands on release -> idle, whose entry frame is non-zero ==');
  const clickScript = join(tmpdir(), `dsh-click-${process.pid}.ps1`);
  writeFileSync(clickScript, [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class TransitionProbeClick {',
    '  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);',
    '  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);',
    '}',
    '"@',
    '$form = New-Object System.Windows.Forms.Form',
    "$form.FormBorderStyle = 'None'; $form.TopMost = $true; $form.ShowInTaskbar = $false",
    "$form.StartPosition = 'Manual'; $form.Location = New-Object System.Drawing.Point(240, 240)",
    '$form.Size = New-Object System.Drawing.Size(240, 200)',
    '$form.Show(); [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 250',
    '[void][TransitionProbeClick]::SetCursorPos(360, 340)',
    'Start-Sleep -Milliseconds 100',
    '[TransitionProbeClick]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero)',
    'for ($i = 0; $i -lt 5; $i++) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 20 }',
    '[TransitionProbeClick]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)',
    'for ($i = 0; $i -lt 60; $i++) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 20 }',
    '$form.Close(); $form.Dispose()',
  ].join('\n'), 'utf8');
  await new Promise((resolve, reject) => {
    const clicker = spawn('powershell', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', clickScript], { windowsHide: true });
    clicker.on('exit', resolve);
    clicker.on('error', reject);
  });
  const afterClick = await health(
    (one) => one.characterState === 'idle' && Number(one.cursorEntryFrame) === Number(releaseToIdle?.entryFrame), 4000);
  check('the click path uses the release -> idle entry frame', afterClick !== null,
    `expected ${releaseToIdle?.entryFrame}`);

  send({ method: 'setCompanionPreferences', enabled: false, hostInstanceId: 'transition-probe', settingsRevision: 2, helperGeneration: 1 });
  await waitFor('companionApplied');
  send({ method: 'shutdown' });
  await waitFor('closed', () => true, 4000);
} catch (error) {
  failures.push(`runtime probe crashed :: ${error?.message ?? error}`);
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
