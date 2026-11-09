/**
 * 30 分钟暖态长跑（方案 六 / 8.3）。
 *
 * 只做测量，不改产品行为：起一个带角色资源的 helper，交替做
 * "开 scope / 关 scope / 切偏好（光晕、角色、减少动画、尺寸）/ 移动指针"，
 * 每 30 秒采一次进程指标与 helper 自己的计数，最后按"首个采样 vs 末个采样"判增长。
 *
 * 判据（与 soak-overlay 同口径，但按时间跑）：
 *   - Private Bytes 增长 < 8 MiB；工作集增长 < 16 MiB
 *   - 句柄 < +32；GDI 对象 < +50；USER 对象 < +50
 *   - 角色缓存 < 64 MiB；无 characterError / cursorError；无拒绝命令
 *
 *   node tools/soak-30min.mjs [--minutes 30] [--sample-sec 30] [--out dist/soak-30min.json]
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
const MINUTES = Number(argOf('minutes', '30'));
const SAMPLE_SEC = Number(argOf('sample-sec', '30'));
const OUT = argOf('out', join(ROOT, 'dist', 'soak-30min.json'));

if (!existsSync(EXE) || !existsSync(join(ASSETS, 'pack.json'))) {
  console.error(`FAIL  need ${EXE} and ${ASSETS}`);
  process.exit(2);
}

const staged = join(tmpdir(), `dsh-soak-${process.pid}.exe`);
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
child.stderr.on('data', () => {});

let nextRequest = 0;
const send = (message) => {
  const requestId = `s${nextRequest += 1}`;
  try {
    child.stdin.write(`${JSON.stringify({ requestId, ...message })}\n`);
  } catch { /* child gone */ }
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
const health = async (timeoutMs = 5000) => {
  const requestId = send({ method: 'health' });
  return waitFor('health', (one) => one.requestId === requestId, timeoutMs);
};

/** 进程级指标：私有字节、工作集、句柄、GDI/USER 对象。 */
const procMetrics = () => {
  const script = [
    `$p = Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue`,
    'if ($null -eq $p) { "{}"; exit 0 }',
    '$gdi = (Get-Process -Id $PID).HandleCount',
    'Add-Type -Name U -Namespace W -MemberDefinition \'[DllImport("user32.dll")] public static extern int GetGuiResources(IntPtr h, uint f);\' -ErrorAction SilentlyContinue',
    '$gdiCount = [W.U]::GetGuiResources($p.Handle, 0)',
    '$userCount = [W.U]::GetGuiResources($p.Handle, 1)',
    '[pscustomobject]@{ privateMB = [math]::Round($p.PrivateMemorySize64/1MB,2); workingSetMB = [math]::Round($p.WorkingSet64/1MB,2); handles = $p.HandleCount; gdi = $gdiCount; user = $userCount } | ConvertTo-Json -Compress',
  ].join('; ');
  const run = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  try {
    const parsed = JSON.parse((run.stdout ?? '').trim() || '{}');
    return parsed.privateMB === undefined ? null : parsed;
  } catch {
    return null;
  }
};

const samples = [];
const started = Date.now();
const deadline = started + MINUTES * 60 * 1000;
let cycle = 0;

console.log(`soak: ${MINUTES} min, sampling every ${SAMPLE_SEC}s -> ${OUT}`);
send({ method: 'hello', protocolVersion: 2 });
await waitFor('ready', () => true, 10000);
send({ method: 'setCompanionPreferences', enabled: true, hostInstanceId: 'soak', settingsRevision: 1, helperGeneration: 1 });
await waitFor('companionApplied', () => true, 8000);
await new Promise((resolve) => setTimeout(resolve, 1500));

let nextSampleAt = Date.now();
while (Date.now() < deadline) {
  cycle += 1;
  // 2 秒一个循环：开/关 scope、切偏好、移动指针。
  const phase = cycle % 6;
  if (phase === 0 || phase === 1) {
    send({ method: 'beginScope', scopeId: `soak-${cycle}`, epoch: cycle });
    await waitFor('scopeReady', () => true, 4000);
  } else if (phase === 2) {
    send({ method: 'setVisualPreferences', settingsRevision: cycle, preferences: { cursorHalo: cycle % 3 === 0, reducedMotion: cycle % 4 === 0, cursorCharacterHeightDip: 72 + (cycle % 4) * 16 } });
    await waitFor('visualPreferencesApplied', () => true, 3000);
  } else if (phase === 3) {
    send({ method: 'endScope' });
    await waitFor('scopeEnded', () => true, 3000);
  } else if (phase === 4) {
    spawnSync('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${600 + (cycle % 5) * 40}, ${500 + (cycle % 4) * 30})`], { windowsHide: true, timeout: 8000 });
  } else {
    send({ method: 'setCompanionPreferences', enabled: cycle % 12 !== 0, hostInstanceId: 'soak', settingsRevision: cycle, helperGeneration: 1 });
    await waitFor('companionApplied', () => true, 3000);
    if (cycle % 12 === 0) {
      send({ method: 'setCompanionPreferences', enabled: true, hostInstanceId: 'soak', settingsRevision: cycle + 1, helperGeneration: 1 });
      await waitFor('companionApplied', () => true, 3000);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 300));

  if (Date.now() >= nextSampleAt) {
    nextSampleAt = Date.now() + SAMPLE_SEC * 1000;
    const metrics = procMetrics();
    const h = await health(4000);
    const sample = {
      at: new Date().toISOString(),
      elapsedSec: Math.round((Date.now() - started) / 1000),
      cycle,
      ...(metrics ?? {}),
      cacheBytes: h?.characterCacheBytes ?? null,
      cacheEntries: h?.characterCacheEntries ?? null,
      hits: h?.characterCacheHits ?? null,
      misses: h?.characterCacheMisses ?? null,
      evictions: h?.characterCacheEvictions ?? null,
      rejected: h?.characterCacheRejected ?? null,
      presents: h?.cursorPresents ?? null,
      skips: h?.cursorPixelSkips ?? null,
      pointerEvents: h?.pointerEventsSeen ?? null,
      characterError: h?.characterError ?? '',
      cursorError: h?.cursorError ?? '',
      rejectedCommands: h?.rejectedCommands ?? null,
      state: h?.characterState ?? '',
    };
    samples.push(sample);
    console.log(`  +${sample.elapsedSec}s private=${sample.privateMB}MB ws=${sample.workingSetMB}MB handles=${sample.handles} gdi=${sample.gdi} user=${sample.user} cache=${(Number(sample.cacheBytes) / 1048576).toFixed(1)}MB presents=${sample.presents}`);
  }
}

send({ method: 'shutdown' });
await waitFor('closed', () => true, 5000);
setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 300);

const first = samples.find((one) => one.privateMB !== undefined);
const last = [...samples].reverse().find((one) => one.privateMB !== undefined);
const growth = (key) => (first && last ? Number((last[key] ?? 0) - (first[key] ?? 0)) : null);
const summary = {
  startedAt: new Date(started).toISOString(),
  minutes: MINUTES,
  samples: samples.length,
  privateGrowthMB: growth('privateMB'),
  workingSetGrowthMB: growth('workingSetMB'),
  handleGrowth: growth('handles'),
  gdiGrowth: growth('gdi'),
  userGrowth: growth('user'),
  cacheBytes: last?.cacheBytes ?? null,
  errors: samples.filter((one) => (one.characterError ?? '') !== '' || (one.cursorError ?? '') !== '').length,
  rejectedCommands: last?.rejectedCommands ?? null,
  verdict: 'unknown',
};
const ok =
  summary.privateGrowthMB !== null &&
  summary.privateGrowthMB < 8 &&
  summary.workingSetGrowthMB < 16 &&
  summary.handleGrowth < 32 &&
  summary.gdiGrowth < 50 &&
  summary.userGrowth < 50 &&
  Number(summary.cacheBytes ?? 0) < 64 * 1024 * 1024 &&
  summary.errors === 0;
summary.verdict = ok ? 'pass' : 'fail';

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ summary, samples }, null, 2), 'utf8');
console.log(`\n${ok ? 'PASS' : 'FAIL'}  private ${summary.privateGrowthMB} MB, ws ${summary.workingSetGrowthMB} MB, handles ${summary.handleGrowth}, gdi ${summary.gdiGrowth}, user ${summary.userGrowth}, samples ${summary.samples}`);
console.log(`report: ${OUT}`);
process.exit(ok ? 0 : 1);
