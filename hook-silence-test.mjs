/**
 * "钩子装上了但系统不投递"要被报出来（复核结论第 3 条的收尾）。
 *
 * 背景：从工作区树里启动的 helper，`SetWindowsHookEx` 返回非空、`GetLastError=0`、消息循环在转，
 * 但收不到任何低级鼠标事件。以前这种状态下产品只是"没反应"；现在它必须自己说清楚。
 *
 * 断言：
 *   1. 同一份二进制，从**工作区外**启动 → 注入移动后 `hookSilent=false`；
 *   2. 从**工作区树内**启动 → 注入移动后应报 `hookSilent=true`（若这台机器本来就没有该限制，则记跳过，
 *      而不是把一个环境事实写成产品失败）；
 *   3. 没有消费方（无 scope、无伴随）时不报沉默——静止的桌面不是故障。
 *
 *   node hook-silence-test.mjs
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXE = join(HERE, 'native', 'indicator-helper', 'build', 'dsh-interaction-indicator.exe');
const ASSETS = join(HERE, 'assets', 'character');
const IN_TEMP = join(tmpdir(), `dsh-hook-silence-${process.pid}.exe`);

let passed = 0;
let skipped = 0;
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
function skip(label, detail) {
  skipped += 1;
  console.log(`  SKIP  ${label}${detail === undefined ? '' : ` :: ${detail}`}`);
}

if (!existsSync(EXE) || !existsSync(ASSETS)) {
  console.error(`FAIL  need ${EXE} and ${ASSETS}`);
  process.exit(2);
}
copyFileSync(EXE, IN_TEMP);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 起一个 helper、开伴随、注入一段移动，然后读 health。 */
async function probeWithInjection(exePath, { companion = true } = {}) {
  const child = spawn(exePath, [`--assets=${ASSETS}`, '--no-affinity'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const events = [];
  let carry = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    carry += chunk;
    let index;
    while ((index = carry.indexOf('\n')) >= 0) {
      const line = carry.slice(0, index).trim();
      carry = carry.slice(index + 1);
      if (line === '') continue;
      try { events.push(JSON.parse(line)); } catch { /* ignore */ }
    }
  });
  let request = 0;
  const send = (message) => {
    const requestId = `h${request += 1}`;
    child.stdin.write(`${JSON.stringify({ requestId, ...message })}\n`);
    return requestId;
  };
  const waitFor = async (name, predicate = () => true, timeoutMs = 8000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const index = events.findIndex((one) => one.event === name && predicate(one));
      if (index >= 0) return events.splice(index, 1)[0];
      await sleep(20);
    }
    return null;
  };
  const health = async () => {
    const requestId = send({ method: 'health' });
    return waitFor('health', (one) => one.requestId === requestId, 6000);
  };

  send({ method: 'hello', protocolVersion: 2 });
  const ready = await waitFor('ready', () => true, 10000);
  if (companion) {
    send({ method: 'setCompanionPreferences', enabled: true, hostInstanceId: 'silence', settingsRevision: 1, helperGeneration: 1 });
    await waitFor('companionApplied');
  }
  await sleep(600);
  // 注入 3 秒移动，让"该有回调"这件事成立。
  const injector = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', process.env.SILENCE_INJECTOR], { windowsHide: true });
  await new Promise((resolve) => { injector.on('exit', resolve); setTimeout(resolve, 8000); });
  await sleep(400);
  const snapshot = await health();
  send({ method: 'shutdown' });
  await waitFor('closed', () => true, 4000);
  try { child.kill(); } catch { /* gone */ }
  return snapshot ?? (ready === null ? null : {});
}

import { writeFileSync } from 'node:fs';
const injectorPath = join(tmpdir(), `dsh-silence-inject-${process.pid}.ps1`);
writeFileSync(injectorPath, `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SilenceMove {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, UIntPtr e);
}
"@
[void][SilenceMove]::SetCursorPos(720, 500)
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while ($sw.ElapsedMilliseconds -lt 3000) {
  [SilenceMove]::mouse_event(0x0001, 4, 0, 0, [UIntPtr]::Zero)
  [SilenceMove]::mouse_event(0x0001, -4, 0, 0, [UIntPtr]::Zero)
}
`, 'utf8');
process.env.SILENCE_INJECTOR = injectorPath;

try {
  console.log('\n== 工作区外（%TEMP%）：注入移动后不应报沉默 ==');
  const outside = await probeWithInjection(IN_TEMP, { companion: true });
  check('the helper answered health', outside !== null && outside.mouseHookReady !== undefined,
    JSON.stringify(outside)?.slice(0, 120));
  check('no silence outside the workspace', outside?.hookSilent === false, String(outside?.hookSilent));
  check('callbacks really arrived outside', Number(outside?.mouseHookCalls ?? 0) > 100, String(outside?.mouseHookCalls));

  console.log('\n== 工作区树内：若系统不投递，必须报沉默 ==');
  const inside = await probeWithInjection(EXE, { companion: true });
  // 只看 >0 太弱：工作区里也会有零星一两个真实事件（初始 SetCursorPos 之类）。
  // "成批到达"才说明钩子真的在投递。
  if (Number(inside?.mouseHookCalls ?? 0) > 100) {
    skip('silence inside the workspace', 'this machine delivers hooks from the workspace too');
  } else {
    check('the hook installed but stayed silent', inside?.hookSilent === true, String(inside?.hookSilent));
    check('and the silence is quantified', Number(inside?.hookSilentMs ?? 0) >= 3000, String(inside?.hookSilentMs));
  }

  console.log('\n== 宿主把 hookSilent 带进状态（用户看得到）==');
  // 静态契约：helper 报出来的沉默必须被宿主读进状态，否则等于白报。
  const hostSource = readFileSync(join(HERE, 'index.js'), 'utf8');
  check('the host reads hookSilent from health', /hookSilent: health\.hookSilent === true/.test(hostSource));
  check('and keeps the silence duration', /hookSilentMs: Number\.isFinite\(health\.hookSilentMs\)/.test(hostSource));
  check('the status block exposes it', /character: lastCharacterHealth/.test(hostSource));

  console.log('\n== 没有消费方时不报沉默（静止 ≠ 故障）==');
  const idle = await probeWithInjection(IN_TEMP, { companion: false });
  check('an idle helper is not called silent', idle?.hookSilent === false, String(idle?.hookSilent));
} catch (error) {
  failures.push(`probe crashed :: ${error?.message ?? error}`);
  console.error(error);
}

console.log(`\n${passed} passed, ${failures.length} failed, ${skipped} skipped`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
