/**
 * E 盘路径 vs 临时目录的钩子 A-B-A 对照（复核结论第 3 条）。
 *
 * 复核要求：固定同一份 EXE（SHA256）、资源、参数、父进程、工作目录与环境变量，按 A-B-A 顺序
 * 在"E 盘原路径"和"临时目录"之间来回跑，记录**钩子安装返回值 / GetLastError / 线程与会话 /
 * 回调计数 / 入队计数**，并把两边的路径差异（ACL、来源标记、检测记录、完整性级别）一并留档。
 *
 * 这个工具只做**对照**，不改变产品行为：注入的输入是合成事件（mouse_event），
 * 人工物理输入需要人按同样的流程再跑一遍（见报告里的 manual 段）。
 *
 *   node tools/hook-aba.mjs [--exe <helper>] [--rounds 3] [--out dist/hook-aba.json] [--no-inject]
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const ASSETS = join(ROOT, 'assets', 'character');

const argOf = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
};
const EXE = argOf('exe', join(ROOT, 'native', 'indicator-helper', 'build', 'dsh-interaction-indicator.exe'));
const OUT = argOf('out', join(ROOT, 'dist', 'hook-aba.json'));
const NO_INJECT = process.argv.includes('--no-inject');
const ROUNDS = Math.max(1, Number(argOf('rounds', '3')));

if (!existsSync(EXE)) {
  console.error(`FAIL  no helper at ${EXE}`);
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const powershell = (script, timeout = 25000) =>
  spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout });

/** 一份文件在系统里的"路径事实"：ACL、来源标记（Zone.Identifier）、大小、哈希。 */
function pathFacts(path) {
  const acl = powershell(`(icacls "${path}") -join ' | '`).stdout?.trim() ?? '';
  const zone = powershell(`$z = Get-Item -LiteralPath "${path}" -Stream Zone.Identifier -ErrorAction SilentlyContinue; if ($null -eq $z) { 'none' } else { (Get-Content -LiteralPath "${path}" -Stream Zone.Identifier) -join ' ' }`).stdout?.trim() ?? '';
  return { path, sha256: sha256(path), bytes: readFileSync(path).length, acl, zoneIdentifier: zone };
}

/** 主体身份与会话：用户、完整性级别、会话号、实时防护状态、最近检测记录数。 */
function identity() {
  const out = powershell([
    "$user = (whoami)",
    "$groups = (whoami /groups | Select-String 'S-1-16-') -join ' '",
    "$session = (Get-Process -Id $PID).SessionId",
    "$rt = try { (Get-MpComputerStatus -ErrorAction Stop).RealTimeProtectionEnabled } catch { 'n/a' }",
    "$det = try { (Get-MpThreatDetection -ErrorAction Stop | Measure-Object).Count } catch { 'n/a' }",
    "[pscustomobject]@{ user=$user; integrity=$groups; session=$session; realtime=$rt; detections=$det } | ConvertTo-Json -Compress",
  ].join('; '), 30000);
  try {
    return JSON.parse((out.stdout ?? '').trim() || '{}');
  } catch {
    return {};
  }
}

/** 合成输入：以 3 px 来回移动，制造真实的低级鼠标事件（不会移动很远，也不会点到东西）。 */
const INJECT_SCRIPT = (durationMs) => `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AbaMove {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, UIntPtr e);
}
"@
[void][AbaMove]::SetCursorPos(760, 540)
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$i = 0
while ($sw.ElapsedMilliseconds -lt ${durationMs}) {
  [AbaMove]::mouse_event(0x0001, 3, 0, 0, [UIntPtr]::Zero)
  [AbaMove]::mouse_event(0x0001, -3, 0, 0, [UIntPtr]::Zero)
  $i += 2
}
Write-Output ("injected=" + $i)
`;

/**
 * 跑一次探针：起 helper（`--hook-probe`），在它的 5 秒窗口内注入合成输入，收回它自报的 JSON。
 * 参数、cwd、env 完全一致，唯一变量就是 exe 所在路径。
 */
function runProbe(exePath, label) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(exePath, ['--hook-probe'], {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    let injected = null;
    let injector = null;
    if (!NO_INJECT) {
      setTimeout(() => {
        const script = join(tmpdir(), `aba-inject-${process.pid}-${Math.random().toString(16).slice(2)}.ps1`);
        writeFileSync(script, INJECT_SCRIPT(3000), 'utf8');
        injector = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
        let out = '';
        injector.stdout.on('data', (chunk) => { out += chunk; });
        injector.on('exit', () => { injected = (out.match(/injected=(\d+)/) ?? [])[1] ?? null; });
      }, 400);
    }

    child.on('exit', (code) => {
      setTimeout(() => {
        try { injector?.kill(); } catch { /* gone */ }
        let probe = null;
        try {
          const line = stdout.split('\n').map((one) => one.trim()).find((one) => one.startsWith('{"kind":"hook-probe"'));
          probe = line === undefined ? null : JSON.parse(line);
        } catch { /* reported as null */ }
        resolve({
          label,
          exePath,
          exitCode: code,
          elapsedMs: Date.now() - started,
          injected: injected === null ? null : Number(injected),
          probe,
          stderr: stderr.trim().slice(0, 400),
          stdoutTail: stdout.trim().slice(-200),
        });
      }, 200);
    });
  });
}

const original = pathFacts(EXE);
const stagingDir = mkdtempSync(join(tmpdir(), 'dsh-hook-aba-'));
const tempExe = join(stagingDir, 'dsh-interaction-indicator.exe');
copyFileSync(EXE, tempExe);
const staged = pathFacts(tempExe);

// 只比"E 盘 vs 临时目录"分不清是盘符、目录还是 ACL。这里再加两个位置：
// 用户目录（C 盘、普通 ACL）与 E 盘根下新建目录（同盘、不同目录、不同 ACL）。
const extraSpots = [
  { label: 'C_user', path: join(process.env.USERPROFILE ?? tmpdir(), 'dsh-hookprobe', 'helper.exe') },
  { label: 'E_root', path: 'E:\\dsh-hookprobe\\helper.exe' },
  // 同一棵工作区树里的另外两个位置：用来判断限制是"整个工作区"还是"某个目录"。
  { label: 'W_repo', path: join(ROOT, 'dist', 'hookprobe-helper.exe') },
  { label: 'W_inkos', path: 'E:\\inkos\\dsh-hookprobe\\helper.exe' },
];
const stagedExtra = [];
for (const spot of extraSpots) {
  try {
    mkdirSync(dirname(spot.path), { recursive: true });
    copyFileSync(EXE, spot.path);
    const facts = pathFacts(spot.path);
    if (facts.sha256 !== original.sha256) throw new Error('hash differs after staging');
    stagedExtra.push({ label: spot.label, path: spot.path, facts });
  } catch (error) {
    console.log('(skip ' + spot.label + ': ' + String(error?.message ?? error).slice(0, 80) + ')');
  }
}

if (original.sha256 !== staged.sha256) {
  console.error('FAIL  the staged copy differs from the original — refusing to compare');
  process.exit(2);
}

const id = identity();
console.log(`\n主体：${id.user ?? '?'}  会话 ${id.session ?? '?'}  实时防护 ${id.realtime ?? '?'}  检测记录 ${id.detections ?? '?'}`);
console.log(`完整性：${String(id.integrity ?? '').slice(0, 120)}`);
console.log(`\nA(E 盘)   ${original.path}\n         sha256=${original.sha256.slice(0, 16)}…  zone=${original.zoneIdentifier}`);
console.log(`B(临时)   ${staged.path}\n         sha256=${staged.sha256.slice(0, 16)}…  zone=${staged.zoneIdentifier}`);

/**
 * 产品路径（不是诊断探针）：起 helper、开伴随、注入一段移动，再读 health。
 *
 * `--hook-probe` 是在**主线程**上装钩子并自己泵消息，而产品是在**专用钩子线程**上装。
 * 复核第 3 条的结论必须落在产品路径上，所以这里单独量一次。
 */
function runProduct(exePath, label) {
  return new Promise((resolve) => {
    const child = spawn(exePath, ['--assets=' + ASSETS, '--no-affinity'], {
      cwd: ROOT,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
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
      const requestId = `r${request += 1}`;
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
    (async () => {
      send({ method: 'hello', protocolVersion: 2 });
      const ready = await waitFor('ready', () => true, 10000);
      send({ method: 'setCompanionPreferences', enabled: true, hostInstanceId: 'aba-product', settingsRevision: 1, helperGeneration: 1 });
      await waitFor('companionApplied', () => true, 6000);
      await sleep(500);
      const injector = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', productInjector], { windowsHide: true });
      await new Promise((done) => { injector.on('exit', done); setTimeout(done, 8000); });
      await sleep(300);
      const requestId = send({ method: 'health' });
      const snapshot = await waitFor('health', (one) => one.requestId === requestId, 6000);
      send({ method: 'shutdown' });
      await waitFor('closed', () => true, 4000);
      try { child.kill(); } catch { /* gone */ }
      resolve({
        label,
        exePath,
        ready: ready !== null,
        probe: {
          hook: snapshot?.mouseHookReady ?? null,
          calls: snapshot?.mouseHookCalls ?? null,
          seen: snapshot?.pointerEventsSeen ?? null,
          hookSilent: snapshot?.hookSilent ?? null,
          hookSilentMs: snapshot?.hookSilentMs ?? null,
        },
      });
    })();
  });
}

/** 产品路径用的注入脚本：来回 ±4 px，2.5 秒。 */
const productInjector = join(tmpdir(), 'aba-product-inject-' + process.pid + '.ps1');
writeFileSync(productInjector, [
  'Add-Type @"',
  'using System;',
  'using System.Runtime.InteropServices;',
  'public static class AbaProduct {',
  '  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);',
  '  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, UIntPtr e);',
  '}',
  '"@',
  '[void][AbaProduct]::SetCursorPos(700, 520)',
  '$sw = [System.Diagnostics.Stopwatch]::StartNew()',
  'while ($sw.ElapsedMilliseconds -lt 2500) {',
  '  [AbaProduct]::mouse_event(0x0001, 4, 0, 0, [UIntPtr]::Zero)',
  '  [AbaProduct]::mouse_event(0x0001, -4, 0, 0, [UIntPtr]::Zero)',
  '}',
].join('\r\n'), 'utf8');
const PRODUCT_MODE = process.argv.includes('--mode') && process.argv[process.argv.indexOf('--mode') + 1] === 'product';

const plan = [];
for (let round = 0; round < ROUNDS; round += 1) {
  plan.push({ label: `A${round + 1}`, path: EXE });
  plan.push({ label: `B${round + 1}`, path: tempExe });
  for (const spot of stagedExtra) plan.push({ label: `${spot.label}${round + 1}`, path: spot.path });
}
plan.push({ label: `A${ROUNDS + 1}`, path: EXE });

const runs = [];
for (const step of plan) {
  const result = PRODUCT_MODE ? await runProduct(step.path, step.label) : await runProbe(step.path, step.label);
  runs.push(result);
  const p = result.probe;
  if (PRODUCT_MODE) {
    console.log(
      `${step.label.padEnd(3)} [产品路径] hookReady=${String(p?.hook ?? '—').padEnd(5)} ` +
      `calls=${String(p?.calls ?? '—').padStart(6)} events=${String(p?.seen ?? '—').padStart(6)} ` +
      `silent=${String(p?.hookSilent ?? '—')} silentMs=${p?.hookSilentMs ?? '—'}`,
    );
  } else {
    console.log(
      `${step.label.padEnd(3)} ${p?.hook ? 'hook=ok  ' : 'hook=NULL'} lastError=${String(p?.lastError ?? '—').padEnd(4)} ` +
      `calls=${String(p?.calls ?? '—').padStart(6)} seen=${String(p?.seen ?? '—').padStart(6)} injected=${String(result.injected ?? '—').padStart(6)} ` +
      `session=${p?.session ?? '—'} thread=${p?.thread ?? '—'}`,
    );
  }
}

const byLabel = (prefix) => runs.filter((one) => one.label.startsWith(prefix));
const summarize = (list) => ({
  runs: list.map((one) => ({ label: one.label, hook: one.probe?.hook ?? null, lastError: one.probe?.lastError ?? null, calls: one.probe?.calls ?? null, seen: one.probe?.seen ?? null, injected: one.injected })),
  hookInstalled: list.every((one) => one.probe?.hook === true),
  sawInjected: list.every((one) => Number(one.probe?.seen ?? 0) > 0),
});

const summary = {
  at: new Date().toISOString(),
  identity: id,
  fixed: { args: ['--hook-probe'], cwd: ROOT, env: 'inherited unchanged', parentPid: process.pid },
  files: { original, staged },
  runs,
  verdict: {
    aSide: summarize(byLabel('A')),
    bSide: summarize(byLabel('B')),
  },
  manual: {
    note: '人工物理输入无法自动化：请用真实鼠标在 C:/E: 两种安装路径各做 3 次移动+点击，观察 health 的 pointerEventsSeen/pointerClicks 是否增长。',
    steps: [
      '1) 从 E 盘原路径启动 helper（--assets=…），开一个 scope，手动移动鼠标 10 次并点击 3 次，读 health。',
      '2) 退出，改从安装目录（真实发布路径）启动，重复同样动作。',
      '3) 记录两次的 pointerEventsSeen / pointerClicks / mouseHookCalls 增量与 mouseHookReady。',
    ],
  },
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(summary, null, 2), 'utf8');
console.log(`\n报告：${OUT}`);
// 结论按**实际观察**下：装上钩子是一回事，收不收得到事件是另一回事——
// 以前这里比较的是两个标签，A/B 换了位置就会给出误导性的"没有差异"。
const silentRuns = runs.filter((one) => one.probe?.hookSilent === true);
const loudRuns = runs.filter((one) => Number(one.probe?.calls ?? 0) > 100);
console.log(silentRuns.length === 0
  ? `结论：本次 ${runs.length} 次运行都收到了事件（没有沉默的样本）。`
  : `结论：${silentRuns.map((one) => `${one.label}(${one.exePath})`).join('、')} 收不到事件；其余 ${loudRuns.length} 次正常。`);
process.exit(0);
