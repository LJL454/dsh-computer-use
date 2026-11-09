/**
 * 覆盖层的成本与空转（方案 六 / 8.1 / 8.2，2026-11-08 复核后重做统计口径）。
 *
 * 复核结论里点名的缺陷，这一版逐条修掉：
 *   1. `Number('')` 得到 0 —— 空指标会被当成"零占用"。现在空串/缺失一律 null，
 *      整轮拿不到 CPU 就把该轮标为无效（`valid:false`），不参与统计、也不显示成 0.00%。
 *   2. 偶数样本的中位数 —— 以前 `sorted[floor(n/2)]` 取的是**上中位数**。现在用真中位数
 *      （偶数取中间两个的平均），并额外保留 `upperMedian` 字段明确命名。
 *   3. 采样窗口不等于固定 1 秒 —— 以前在启动采样进程**之前**记墙钟，再 sleep 1 秒。
 *      现在由一个**常驻采样器**（单个 PowerShell 进程）用 `Stopwatch`（单调时钟）在
 *      读取 CPU 的那一刻打时间戳，Node 只负责收行；采样间隔不假设固定值。
 *   4. 均值口径 —— 一律 `(末次 CPU − 首次 CPU) ÷ (末次时间 − 首次时间) × 100`，
 *      不用"各间隔平均值的平均"。同时保留**原始带时间戳样本**（`samples`）与有效样本数，
 *      P95 可以由读者自己复算。
 *   5. 子进程失败/超时 —— 采样器退出、helper 消失、指标缺失都分别记账：
 *      `samplerExit`、`helperGone`、`missing` 计数写进报告；有效间隔太少则该场景作废。
 *
 *   node tools/measure-helper-cost.mjs [--sample 60] [--repeats 3] [--scenes all|quick|static-only]
 *                                      [--exe <helper>] [--assets <dir>] [--no-affinity] [--out <json>] [--cold]
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const argOf = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
};
const EXE = argOf('exe', join(ROOT, 'native', 'indicator-helper', 'build', 'dsh-interaction-helper.exe'));
const HELPER = existsSync(EXE) ? EXE : join(ROOT, 'native', 'indicator-helper', 'build', 'dsh-interaction-indicator.exe');
const ASSETS = argOf('assets', join(ROOT, 'assets', 'character'));
const SAMPLE_SEC = Number(argOf('sample', '60'));
const REPEATS = Math.max(1, Number(argOf('repeats', '3')));
const SCENE_SET = argOf('scenes', 'all');
const NO_AFFINITY = process.argv.includes('--no-affinity');
const OUT = argOf('out', join(ROOT, 'dist', `measure-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
const WARMUP_MS = 5000;
const SAMPLER_PERIOD_MS = 400;
const MIN_VALID_SAMPLES = 3;

if (!existsSync(HELPER)) {
  console.error(`FAIL  no helper at ${HELPER}`);
  process.exit(2);
}
const assetsDir = existsSync(join(ASSETS, 'pack.json')) ? ASSETS : '';

// 同一份二进制才可比：报告里带上 SHA256 与大小。
const helperBytes = existsSync(HELPER) ? statSync(HELPER).size : 0;
const helperSha256 = (() => {
  try {
    return createHash('sha256').update(readFileSync(HELPER)).digest('hex');
  } catch { return null; }
})();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const powershell = (script, timeout = 20000) =>
  spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout });

/** 空串 → null（不是 0）。这是复核点名的第一个坑。 */
function parseMetric(text) {
  if (text === undefined || text === null) return null;
  const trimmed = String(text).trim();
  if (trimmed === '' || trimmed === 'GONE') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** 真中位数：偶数取中间两个的平均。 */
function median(values) {
  const list = values.filter((one) => one !== null && Number.isFinite(one));
  if (list.length === 0) return null;
  const sorted = [...list].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** 明确命名的上中位数，避免再和真中位数混用。 */
function upperMedian(values) {
  const list = values.filter((one) => one !== null && Number.isFinite(one));
  if (list.length === 0) return null;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function percentile(values, ratio) {
  const list = values.filter((one) => one !== null && Number.isFinite(one));
  if (list.length === 0) return null;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

const fmt = (value) => (value === null || value === undefined ? '   —' : value.toFixed(2).padStart(6));

function environment() {
  try {
    const out = powershell([
      '$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1',
      '$gpu = Get-CimInstance Win32_VideoController | Select-Object -First 1',
      '$os = Get-CimInstance Win32_OperatingSystem',
      'Add-Type -AssemblyName System.Windows.Forms',
      '$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
      '$dpi = (Get-ItemProperty "HKCU:\\Control Panel\\Desktop\\WindowMetrics" -ErrorAction SilentlyContinue).AppliedDPI',
      '[pscustomobject]@{ cpu=$cpu.Name.Trim(); cores=$cpu.NumberOfCores; logical=$cpu.NumberOfLogicalProcessors; gpu=$gpu.Name; driver=$gpu.DriverVersion; os=$os.Caption; build=$os.BuildNumber; width=$b.Width; height=$b.Height; dpi=$dpi } | ConvertTo-Json -Compress',
    ].join('; '), 30000);
    return JSON.parse((out.stdout ?? '').trim() || '{}');
  } catch {
    return {};
  }
}

/* ---------------------------------------------------------------- sampler -- */

/**
 * 常驻采样器：一个 PowerShell 进程，用 Stopwatch（单调时钟）在**读取的那一刻**打时间戳。
 *
 * 以前每一秒都新起一个 PowerShell、先记墙钟再 sleep，窗口既不准、又把测量工具自身的启动开销
 * 掺进被测量的机器里。现在只在会话开始时起一次，之后只是收行。
 */
function startSampler(pid) {
  // 只读 CPU：`Get-Counter` 每次要几百毫秒，放进每秒循环会把节奏拖到 1.4 秒，
  // 采样分辨率差到"12 秒只有 6 个点"。DWM/GPU 改成每轮一次的单次读数。
  const script = [
    '$sw = [System.Diagnostics.Stopwatch]::StartNew()',
    `$target = ${pid}`,
    'while ($true) {',
    '  $t0 = $sw.Elapsed.TotalSeconds',
    "  $cpu = ''",
    '  try { $p = Get-Process -Id $target -ErrorAction Stop; $p.Refresh(); $cpu = $p.CPU } catch { $cpu = \'GONE\' }',
    '  $t1 = $sw.Elapsed.TotalSeconds',
    '  (("{0}|{1}|{2}" -f $t0, $t1, $cpu))',
    `  Start-Sleep -Milliseconds ${SAMPLER_PERIOD_MS}`,
    '}',
  ].join('; ');
  const proc = spawn('powershell', ['-NoProfile', '-Command', script], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const samples = [];
  let carry = '';
  let exited = false;
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    carry += chunk;
    let index = carry.indexOf('\n');
    while (index >= 0) {
      const line = carry.slice(0, index).trim();
      carry = carry.slice(index + 1);
      index = carry.indexOf('\n');
      if (line === '') continue;
      const [t0Text, t1Text, cpuText] = line.split('|');
      samples.push({
        t0: Number(t0Text),          // 读 CPU 之前
        t1: Number(t1Text),          // 读完之后
        cpu: parseMetric(cpuText),   // 空串/GONE → null
      });
    }
  });
  proc.on('exit', () => { exited = true; });
  return {
    samples,
    mark: () => samples.length,
    get exited() { return exited; },
    stop: () => { try { proc.kill(); } catch { /* gone */ } },
  };
}

/**
 * GPU 占用只在每轮末尾读一次。
 *
 * `\GPU Engine(*)` 实例动辄几十个，取一次就要几百毫秒——放进每秒循环会把测量工具自己
 * 的负载掺进来（上一版正是这样把 DWM 抬到 19%、GPU 抬到 80%）。所以它是**单次采样**，
 * 报告里明确标成趋势参考，不当统计量用。
 */
function sampleGpuOnce() {
  const out = powershell('try { (Get-Counter "\\GPU Engine(*)\\Utilization Percentage" -ErrorAction Stop).CounterSamples | Measure-Object -Property CookedValue -Sum | Select-Object -ExpandProperty Sum } catch { \'\' }', 20000);
  return parseMetric(out.stdout);
}

/** DWM 同样每轮只读一次（它也是 Get-Counter，放进每秒循环会把节奏拖慢）。 */
function sampleDwmOnce() {
  const out = powershell('try { (Get-Counter "\\Process(dwm)\\% Processor Time" -ErrorAction Stop).CounterSamples[0].CookedValue } catch { \'\' }', 15000);
  return parseMetric(out.stdout);
}
/** 把一段原始样本换算成一轮统计：总 CPU 差 ÷ 总时间，不假设 1 秒窗口。 */
function summarizeRun(samples, from, to) {
  const window = samples.slice(from, to);
  const usable = window.filter((one) => one.cpu !== null && Number.isFinite(one.t0));
  const intervals = [];
  for (let index = 1; index < usable.length; index += 1) {
    const previous = usable[index - 1];
    const current = usable[index];
    const dt = current.t0 - previous.t0;
    if (!(dt > 0)) continue;
    const delta = current.cpu - previous.cpu;
    if (delta < 0) continue;  // 进程重启/读数回绕：记无效，不参与
    intervals.push({ t: current.t0, dt, rate: (delta / dt) * 100 });
  }
  const first = usable[0];
  const last = usable[usable.length - 1];
  const totalTime = first && last ? last.t0 - first.t0 : 0;
  const totalDelta = first && last ? last.cpu - first.cpu : 0;
  const valid = usable.length >= MIN_VALID_SAMPLES && totalTime > 0 && totalDelta >= 0;
  return {
    valid,
    samples: usable.length,
    cadenceSec: usable.length > 1 ? Number(((usable[usable.length - 1].t0 - usable[0].t0) / (usable.length - 1)).toFixed(3)) : null,
    missingCpu: window.length - usable.length,
    totalTimeSec: Number(totalTime.toFixed(3)),
    totalCpuSec: Number(totalDelta.toFixed(4)),
    mean: valid ? (totalDelta / totalTime) * 100 : null,     // ΔCPU ÷ Δt
    intervalP95: valid ? percentile(intervals.map((one) => one.rate), 0.95) : null,
    intervalMax: valid && intervals.length > 0 ? Math.max(...intervals.map((one) => one.rate)) : null,
    raw: usable.map((one) => ({ t: Number(one.t0.toFixed(3)), cpu: Number(one.cpu.toFixed(4)) })),
  };
}

/* ------------------------------------------------------------------ scenes -- */

const PREF_BASE = {
  enabled: true, bannerCharacter: false, cursorCharacter: false, cursorHalo: false, edgeBreathing: false,
  reducedMotion: false, bannerDecoration: false, bannerTheme: 'ocean', bannerCharacterHeightDip: 144,
  cursorCharacterHeightDip: 96, cursorCompanion: false,
};

const SCENES = [
  { name: '无 scope / 无伴随', scope: false, companion: false, prefs: { ...PREF_BASE } },
  { name: '仅伴随（静止）', scope: false, companion: true, prefs: { ...PREF_BASE } },
  { name: '静态提示（装饰全关）', scope: true, companion: false, prefs: { ...PREF_BASE, enabled: false } },
  { name: '仅边缘呼吸', scope: true, companion: false, prefs: { ...PREF_BASE, edgeBreathing: true } },
  { name: '仅横幅角色', scope: true, companion: false, prefs: { ...PREF_BASE, bannerCharacter: true, bannerDecoration: true } },
  { name: '仅光标光晕', scope: true, companion: false, prefs: { ...PREF_BASE, cursorHalo: true } },
  { name: '仅光标角色', scope: true, companion: false, prefs: { ...PREF_BASE, cursorCharacter: true } },
  { name: '全开（静止）', scope: true, companion: false, prefs: { ...PREF_BASE, bannerCharacter: true, cursorCharacter: true, cursorHalo: true, edgeBreathing: true, bannerDecoration: true } },
  { name: '全开（持续移动）', scope: true, companion: false, moving: true, prefs: { ...PREF_BASE, bannerCharacter: true, cursorCharacter: true, cursorHalo: true, edgeBreathing: true, bannerDecoration: true } },
  { name: '减少动态（全开）', scope: true, companion: false, prefs: { ...PREF_BASE, bannerCharacter: true, cursorCharacter: true, cursorHalo: true, edgeBreathing: true, bannerDecoration: true, reducedMotion: true } },
];

const SELECTED = SCENE_SET === 'quick'
  ? SCENES.filter((one) => ['无 scope / 无伴随', '静态提示（装饰全关）', '仅光标角色', '全开（静止）'].includes(one.name))
  : SCENE_SET === 'static-only'
    ? SCENES.filter((one) => one.name === '仅伴随（静止）')
    : SCENES;

const MOVE_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MeasureMove {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
}
"@
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$i = 0
while ($sw.ElapsedMilliseconds -lt DURATION_MS) {
  [void][MeasureMove]::SetCursorPos(600 + ($i % 2) * 80, 520)
  $i += 1
  Start-Sleep -Milliseconds 12
}
`;

/* --------------------------------------------------------------- lifecycle -- */

const child = spawn(HELPER, [...(NO_AFFINITY ? ['--no-affinity'] : []), ...(assetsDir === '' ? [] : [`--assets=${assetsDir}`])], {
  stdio: ['pipe', 'pipe', 'pipe'],
});
const seen = [];
const waiters = [];
child.stdout.setEncoding('utf8');
let buffer = '';
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf('\n');
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf('\n');
    if (line === '') continue;
    try {
      const payload = JSON.parse(line);
      seen.push(payload);
      const at = waiters.findIndex((one) => one.event === payload.event);
      if (at >= 0) waiters.splice(at, 1)[0].resolve(payload);
    } catch {
      /* 非 JSON 行不参与测量 */
    }
  }
});

function waitFor(event, timeoutMs = 15000) {
  const hit = seen.find((one) => one.event === event && one.__taken !== true);
  if (hit !== undefined) {
    hit.__taken = true;
    return Promise.resolve(hit);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
    waiters.push({ event, resolve: (payload) => { clearTimeout(timer); payload.__taken = true; resolve(payload); } });
  });
}
/** 取一次健康快照：用来判断这一轮的 helper 到底有没有在画（present 计数）。 */
async function healthSnapshot() {
  const requestId = `h${Date.now()}-${(nextHealth += 1)}`;
  child.stdin.write(`${JSON.stringify({ requestId, method: 'health' })}\n`);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const found = seen.findIndex((one) => one.event === 'health' && one.requestId === requestId);
    if (found >= 0) {
      const payload = seen.splice(found, 1)[0];
      return {
        presents: Number(payload.cursorPresents ?? 0),
        skips: Number(payload.cursorPixelSkips ?? 0),
        cursorWindows: Number(payload.counts?.cursor ?? 0),
        edgeWindows: Number(payload.counts?.edges ?? 0),
        bannerWindows: Number(payload.counts?.banner ?? 0),
        characterError: payload.characterError ?? '',
        pointerEvents: Number(payload.pointerEventsSeen ?? 0),
      };
    }
    await sleep(20);
  }
  return null;
}

let nextHealth = 0;const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);

/** 冷启动：spawn → ready → scopeReady 的单调时钟耗时。 */
async function coldStart(runs) {
  const timings = [];
  for (let index = 0; index < runs; index += 1) {
    const startedAt = process.hrtime.bigint();
    const proc = spawn(HELPER, [...(NO_AFFINITY ? ['--no-affinity'] : []), ...(assetsDir === '' ? [] : [`--assets=${assetsDir}`])], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let carry = '';
    const queue = [];
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      carry += chunk;
      let at = carry.indexOf('\n');
      while (at >= 0) {
        const line = carry.slice(0, at).trim();
        carry = carry.slice(at + 1);
        at = carry.indexOf('\n');
        if (line === '') continue;
        try { queue.push({ at: Date.now(), elapsedMs: Number(process.hrtime.bigint() - startedAt) / 1e6, payload: JSON.parse(line) }); } catch { /* ignore */ }
      }
    });
    const take = async (event, timeoutMs = 20000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = queue.findIndex((one) => one.payload.event === event);
        if (found >= 0) return queue.splice(found, 1)[0];
        await sleep(10);
      }
      return null;
    };
    proc.stdin.write(`${JSON.stringify({ requestId: 'c1', method: 'hello', protocolVersion: 2 })}\n`);
    const ready = await take('ready');
    proc.stdin.write(`${JSON.stringify({ requestId: 'c2', method: 'setVisualPreferences', settingsRevision: 1, preferences: { enabled: true, decoration: true, cursorCharacter: true, cursorHalo: true, edgeBreathing: true, bannerCharacter: true, bannerDecoration: true } })}\n`);
    await take('visualPreferencesApplied');
    proc.stdin.write(`${JSON.stringify({ requestId: 'c3', method: 'beginScope', scopeId: 'cold', epoch: 1 })}\n`);
    const scopeReady = await take('scopeReady');
    timings.push({
      readyMs: ready ? Number(ready.elapsedMs.toFixed(1)) : null,
      scopeReadyMs: scopeReady ? Number(scopeReady.elapsedMs.toFixed(1)) : null,
    });
    proc.stdin.write(`${JSON.stringify({ requestId: 'c4', method: 'shutdown' })}\n`);
    await take('closed', 5000);
    try { proc.kill(); } catch { /* gone */ }
  }
  return timings;
}

if (process.argv.includes('--cold')) {
  const runs = await coldStart(REPEATS);
  console.log('冷启动（毫秒，单调时钟）：');
  for (const one of runs) console.log(`  ready=${one.readyMs}  scopeReady=${one.scopeReadyMs}`);
  console.log(`\n中位数：ready ${median(runs.map((one) => one.readyMs))} ms，scopeReady ${median(runs.map((one) => one.scopeReadyMs))} ms`);
  try { child.kill(); } catch { /* gone */ }
  process.exit(0);
}

const env = environment();
console.log(`\n环境：${env.cpu}（${env.cores}C/${env.logical}T）  ${env.gpu}  驱动 ${env.driver}`);
console.log(`      ${env.os} build ${env.build}  ${env.width}x${env.height} @ ${env.dpi ? env.dpi / 96 : '?'}x  affinity=${NO_AFFINITY ? 'off(诊断)' : 'on'}`);
console.log(`口径：热身 ${WARMUP_MS / 1000}s、采样 ${SAMPLE_SEC}s × ${REPEATS} 次；真中位数；均值 = ΔCPU ÷ Δt；间隔 P95 由原始样本复算\n`);

const results = [];
let revision = 0;
let scopeOpen = false;
let sampler = null;

try {
  send({ method: 'hello', protocolVersion: 2 });
  const ready = await waitFor('ready');
  console.log(`helper ${ready.buildVersion} protocol=${ready.protocolVersion} pid=${ready.pid}\n`);
  sampler = startSampler(ready.pid);
  await sleep(1200);  // 让采样器先跑起来，别把它的启动算进第一个场景

  for (const scene of SELECTED) {
    const runs = [];
    for (let attempt = 0; attempt < REPEATS; attempt += 1) {
      if (scopeOpen && scene.scope !== true) {
        send({ method: 'endScope', scopeId: 'measure' });
        await waitFor('scopeEnded');
        scopeOpen = false;
      }
      if (scene.companion) {
        send({ method: 'setCompanionPreferences', enabled: true, hostInstanceId: 'measure', settingsRevision: (revision += 1), helperGeneration: 1 });
        await waitFor('companionApplied');
      }
      send({ method: 'setVisualPreferences', settingsRevision: (revision += 1), preferences: scene.prefs });
      await waitFor('visualPreferencesApplied');
      if (scene.scope && !scopeOpen) {
        send({ method: 'beginScope', scopeId: 'measure', epoch: 1 });
        await waitFor('scopeReady');
        scopeOpen = true;
      }
      await sleep(WARMUP_MS);
      let mover = null;
      if (scene.moving) {
        const script = join(dirname(OUT), `move-${process.pid}.ps1`);
        mkdirSync(dirname(script), { recursive: true });
        writeFileSync(script, MOVE_SCRIPT.replace('DURATION_MS', String(SAMPLE_SEC * 1000 + 500)), 'utf8');
        mover = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
      }
      const before = await healthSnapshot();
      const from = sampler.mark();
      await sleep(SAMPLE_SEC * 1000);
      const to = sampler.mark();
      const after = await healthSnapshot();
      if (mover) mover.kill();
      const runSummary = summarizeRun(sampler.samples, from, to);
      runSummary.presentsDelta = before && after ? after.presents - before.presents : null;
      runSummary.cursorWindows = after?.cursorWindows ?? null;
      runSummary.pointerEvents = before && after && after.pointerEvents !== null ? after.pointerEvents - before.pointerEvents : null;
      runSummary.edgeWindows = after?.edgeWindows ?? null;
      runSummary.bannerWindows = after?.bannerWindows ?? null;
      runSummary.characterError = after?.characterError ?? null;
      runSummary.gpuOnce = sampleGpuOnce();  // 单次读数，趋势参考
      runSummary.dwmOnce = sampleDwmOnce();
      runs.push(runSummary);
      if (scene.companion) {
        send({ method: 'setCompanionPreferences', enabled: false, hostInstanceId: 'measure', settingsRevision: (revision += 1), helperGeneration: 1 });
        await waitFor('companionApplied');
      }
    }
    // 有效性再加一条：这轮应该出现画面变化，就要求 Present 计数真的在涨。
    // 否则"0.00%"可能只是"根本没在画"（companion 没真正生效），不能当成零开销。
    const expectPresents = scene.companion === true || scene.scope === true;
    for (const one of runs) {
      if (expectPresents && !(one.presentsDelta > 0)) one.valid = false;
    }
    const validRuns = runs.filter((one) => one.valid);
    const means = validRuns.map((one) => one.mean);
    const intervals = validRuns.flatMap((one) => (one.intervalP95 === null ? [] : [one.intervalP95]));
    const stats = {
      valid: validRuns.length === runs.length && validRuns.length > 0,
      runsValid: validRuns.length,
      runsPlanned: runs.length,
      median: median(means),
      upperMedian: upperMedian(means),
      spread: means.length > 1 ? Math.max(...means) - Math.min(...means) : null,
      intervalP95: percentile(intervals, 0.95),
      dwmOnceMedian: median(runs.map((one) => one.dwmOnce)),
      gpuOnceMedian: median(runs.map((one) => one.gpuOnce)),
      perRun: runs.map((one) => ({
        valid: one.valid, mean: one.mean, samples: one.samples, missingCpu: one.missingCpu,
        presentsDelta: one.presentsDelta, cursorWindows: one.cursorWindows, characterError: one.characterError,
        cadenceSec: one.cadenceSec, dwmOnce: one.dwmOnce, gpuOnce: one.gpuOnce, pointerEvents: one.pointerEvents,
        totalTimeSec: one.totalTimeSec, totalCpuSec: one.totalCpuSec, samplesRaw: one.raw,
      })),
    };
    results.push({ scene: scene.name, ...stats });
    console.log(`${scene.name.padEnd(20)} 中位数 ${fmt(stats.median)}%${stats.valid ? '' : ' [无效]'}  各轮 ${means.map((one) => fmt(one)).join(' / ') || '—'}  DWM(单次) ${fmt(stats.dwmOnceMedian)}%  GPU(单次) ${fmt(stats.gpuOnceMedian)}%`);
  }

  sampler.stop();
  send({ method: 'health' });
  const health = await waitFor('health');
  const report = {
    at: new Date().toISOString(),
    environment: env,
    options: { sampleSec: SAMPLE_SEC, repeats: REPEATS, affinity: !NO_AFFINITY, assets: assetsDir !== '', samplerPeriodMs: SAMPLER_PERIOD_MS },
    helper: { buildVersion: ready.buildVersion, protocolVersion: ready.protocolVersion, pid: ready.pid,
      path: HELPER, sha256: helperSha256, bytes: helperBytes },
    statistics: {
      medianRule: 'even count -> mean of the two middle values',
      meanRule: '(last cpu seconds - first cpu seconds) / (last t0 - first t0) * 100',
      interval: 'sampler cadence, not assumed to be exactly 1 s',
      minValidSamples: MIN_VALID_SAMPLES,
    },
    counts: health.counts,
    characterCache: {
      bytes: health.characterCacheBytes, entries: health.characterCacheEntries,
      hits: health.characterCacheHits, misses: health.characterCacheMisses, evictions: health.characterCacheEvictions,
    },
    results,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n报告：${OUT}`);

  const staticScene = results.find((one) => one.scene.startsWith('静态提示'));
  const companion = results.find((one) => one.scene.startsWith('仅伴随'));
  const moving = results.find((one) => one.scene.startsWith('全开（持续移动）'));
  console.log(`\n门槛（单核口径，2026-11-08 复核后）：静态 ≤0.5% → ${fmt(staticScene?.median)}；仅伴随静止 ≤1% → ${fmt(companion?.median)}；全开移动 ≤10% → ${fmt(moving?.median)}`);

  send({ method: 'shutdown' });
  await waitFor('closed');
} catch (error) {
  console.error(`FAIL  ${String(error?.message ?? error)}`);
  process.exitCode = 1;
} finally {
  try { sampler?.stop(); } catch { /* gone */ }
  try { child.kill(); } catch { /* gone */ }
}
