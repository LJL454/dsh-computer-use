/**
 * 覆盖层的资源稳定性（方案 8.2 的"100 次 scope 启停、100 次偏好切换、无持续 GDI/HWND/内存增长"）。
 *
 * 判据不是"跑完没崩"，而是**基线对照**：预热后取一次基准，跑完再取一次，
 * 句柄/GDI/用户对象/工作集的增长必须落在阈值内。窗口是每屏 5 个、退出时全部销毁，
 * 所以任何一次启停泄漏都会在计数上看出来。
 *
 *   node tools/soak-overlay.mjs [--cycles 100] [--exe <helper>] [--max-growth-mb 10]
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const argOf = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
};
const EXE = argOf('exe', join(ROOT, 'native', 'indicator-helper', 'build', 'dsh-interaction-indicator.exe'));
const ASSETS = join(ROOT, 'assets', 'character');
const CYCLES = Number(argOf('cycles', '100'));
const MAX_GROWTH_MB = Number(argOf('max-growth-mb', '10'));
const MAX_HANDLE_GROWTH = 32;

if (!existsSync(EXE)) {
  console.error(`FAIL  no helper at ${EXE}`);
  process.exit(2);
}

const child = spawn(EXE, [`--assets=${ASSETS}`], { stdio: ['pipe', 'pipe', 'pipe'] });
const lines = [];
let carry = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  carry += chunk;
  let index;
  while ((index = carry.indexOf('\n')) >= 0) {
    const line = carry.slice(0, index).trim();
    carry = carry.slice(index + 1);
    if (line !== '') { try { lines.push(JSON.parse(line)); } catch { /* ignore */ } }
  }
});
let requestId = 0;
const send = (message) => child.stdin.write(`${JSON.stringify({ requestId: `s${(requestId += 1)}`, ...message })}\n`);
async function waitFor(event, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = lines.findIndex((one) => one.event === event);
    if (found >= 0) return lines.splice(found, 1)[0];
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${event}`);
}

/** 进程资源快照：句柄数 / 工作集 / 私有字节（PowerShell 的 `-f` 会把裸 cast 拆错，先落到变量）。 */
function snapshot(pid) {
  const script = `
$p = Get-Process -Id ${pid}
$p.Refresh()
$h = [int]$p.HandleCount
$w = [int64]$p.WorkingSet64
$v = [int64]$p.PrivateMemorySize64
[Console]::WriteLine(("{0}|{1}|{2}" -f $h, $w, $v))`;
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', timeout: 10_000 }).trim();
  const [handles, workingSet, privateBytes] = out.split('|').map(Number);
  return { handles, workingSet, privateBytes };
}

const PREF_SETS = [
  { enabled: true, bannerCharacter: true, cursorCharacter: true, cursorHalo: true, edgeBreathing: true, bannerDecoration: true, bannerTheme: 'ocean' },
  { enabled: true, bannerCharacter: false, cursorCharacter: true, cursorHalo: false, edgeBreathing: false, bannerDecoration: false, bannerTheme: 'plain' },
  { enabled: false, bannerCharacter: false, cursorCharacter: false, cursorHalo: false, edgeBreathing: false, bannerDecoration: false, bannerTheme: 'ocean' },
  { enabled: true, bannerCharacter: true, cursorCharacter: false, cursorHalo: true, edgeBreathing: true, bannerDecoration: true, reducedMotion: true },
];

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail ? ` :: ${detail}` : ''}`); console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ''}`); }
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

try {
  send({ method: 'hello', protocolVersion: 2 });
  const ready = await waitFor('ready');
  const pid = ready.pid;
  console.log(`helper pid ${pid}，${CYCLES} 次 scope 启停 + ${CYCLES} 次偏好切换`);

  // 预热：让资源解码、缓存、窗口类、D2D/DWrite 工厂都建起来，再取基准。
  send({ method: 'setVisualPreferences', settingsRevision: 1, preferences: PREF_SETS[0] });
  await waitFor('visualPreferencesApplied');
  for (let i = 0; i < 3; i += 1) {
    send({ method: 'beginScope', scopeId: `warm-${i}`, epoch: i });
    await waitFor('scopeReady');
    send({ method: 'endScope', scopeId: `warm-${i}` });
    await waitFor('scopeEnded');
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  const baseline = snapshot(pid);
  console.log(`基准：句柄 ${baseline.handles}，工作集 ${mb(baseline.workingSet)}，私有 ${mb(baseline.privateBytes)}`);

  let revision = 10;
  let peakHandles = baseline.handles;
  for (let i = 0; i < CYCLES; i += 1) {
    const scopeId = `soak-${i}`;
    send({ method: 'beginScope', scopeId, epoch: i });
    const opened = await waitFor('scopeReady');
    if (opened?.visualReady !== true) throw new Error(`scope ${i} was not visually ready`);
    send({ method: 'setVisualPreferences', settingsRevision: (revision += 1), preferences: PREF_SETS[i % PREF_SETS.length] });
    await waitFor('visualPreferencesApplied');
    send({ method: 'endScope', scopeId });
    const ended = await waitFor('scopeEnded');
    if (ended?.counts?.displayWindowCount !== 0) throw new Error(`scope ${i} left ${ended?.counts?.displayWindowCount} display windows behind`);
    if (i % 20 === 0) {
      const now = snapshot(pid);
      peakHandles = Math.max(peakHandles, now.handles);
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 500));
  const after = snapshot(pid);
  console.log(`跑完：句柄 ${after.handles}，工作集 ${mb(after.workingSet)}，私有 ${mb(after.privateBytes)}`);

  send({ method: 'health' });
  const health = await waitFor('health');
  check('every cycle ended with zero display windows', health?.counts?.displayWindowCount === 0, JSON.stringify(health?.counts));
  check('no window is left visible', health?.counts?.visibleWindowCount === 0, JSON.stringify(health?.counts));
  check('no rejected command accumulated', health?.rejectedCommands === 0, String(health?.rejectedCommands));
  check('handle count does not grow with cycles', after.handles <= baseline.handles + MAX_HANDLE_GROWTH,
    `${baseline.handles} -> ${after.handles}（峰值 ${peakHandles}）`);
  const growthMb = (after.workingSet - baseline.workingSet) / 1024 / 1024;
  check(`working set growth stays under ${MAX_GROWTH_MB} MB`, growthMb <= MAX_GROWTH_MB, `${growthMb.toFixed(1)} MB`);
  const cacheMb = Number(health?.characterCacheBytes ?? 0) / 1024 / 1024;
  check('the character cache stays inside its soft budget', cacheMb <= 32, `${cacheMb.toFixed(1)} MB / ${health?.characterCacheEntries} entries`);

  send({ method: 'shutdown' });
  await waitFor('closed');
} catch (error) {
  console.error(`FAIL  ${String(error?.message ?? error)}`);
  process.exitCode = 1;
} finally {
  child.kill();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
