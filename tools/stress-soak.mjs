/**
 * 长跑与压力基线（9.txt §12.2 / §12.3）。
 *
 * 方案对性能只给了**测量方案**而不是收益承诺（"本次没有得到真实桌面性能基线"），所以这里把
 * §12.2 那张清单做成可复现的一条命令：预热后多轮"会话创建 → 截图 → 读取 → 批处理 → 销毁"，
 * 记录
 *
 *   - 每类调用的 p50 / p95 / 最大耗时（用宿主自己的 `timing` 阶段拆分，不是外部揣测）；
 *   - Node 事件循环延迟（每 20 ms 采样一次，取 p95/最大）；
 *   - worker 进程的常驻内存、句柄数、CPU 时间（起点与终点各取一次）；
 *   - **重复次数**类计数（`buildReads` / `readRetries` / `uiReads` / `uiNodes`…）——§12.3 要求
 *     "验证重复次数下降，而不仅是偶然耗时下降"；
 *   - 两阶段之间的**销毁与重建**（第二次 apply + unload），覆盖"多轮会话创建与销毁"。
 *
 * 它是**测量**工具：不设通过/失败门槛（基线还没有），输出一张表与一份 JSON；数字要跟机器状态
 * 一起读，所以 JSON 里带 `environment` 段（当前显示器、当前开着几个可见窗口等）。
 *
 * 用法：
 *   node tools/stress-soak.mjs [--rounds 6] [--json artifacts/stress-soak.json] [--with-browser]
 */
import { registerHooks } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const numberArg = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : Number(args[at + 1]);
};
const ROUNDS = Math.max(2, numberArg('--rounds', 6));
const JSON_PATH = (() => {
  const at = args.indexOf('--json');
  const given = at === -1 ? 'artifacts/stress-soak.json' : args[at + 1];
  // 绝对路径直接用：`join(ROOT, 'C:\\...')` 会拼成一个嵌套路径然后 mkdir 失败（实测踩到）。
  return isAbsolute(given) ? given : join(ROOT, given);
})();
const WITH_BROWSER = args.includes('--with-browser');
/**
 * 固定被测窗口（`--window <标题子串>`）。
 *
 * 不指定时 UIA 读的是**前台窗口**，而前台是谁会变（别的程序抢焦点、弹窗），于是"同一场景"
 * 每次其实都不一样——树的大小能差一个数量级。指定夹具窗口后，跨版本对照才真的是同一件事。
 */
const WINDOW_MATCH = (() => {
  const at = args.indexOf('--window');
  return at === -1 ? null : args[at + 1];
})();

// 装载插件：与其它套件同一套桩（宿主只提供 tools 服务，webServer 用不上）。
const shim = mkdtempSync(join(tmpdir(), 'dsh-soak-'));
writeFileSync(join(shim, 'stub.mjs'), 'export const defineTool = (d) => d;\nexport const toolDefinitions = [];\n');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: pathToFileURL(join(shim, 'stub.mjs')).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

/** 百分位（最近秩法，样本少时也能解释）。 */
function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

/** 事件循环延迟采样：每 20 ms 看一次"实际等了多久"。 */
function startLoopLagSampler() {
  const samples = [];
  let stopped = false;
  const tick = async () => {
    while (!stopped) {
      const started = process.hrtime.bigint();
      await sleep(20);
      const actual = Number(process.hrtime.bigint() - started) / 1e6;
      samples.push(Math.max(0, actual - 20));
    }
  };
  void tick();
  return { stop: () => { stopped = true; return samples; } };
}

/** worker 进程的资源占用（读不到就返回 null，不编数字）。 */
function workerResources(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return null;
  try {
    const output = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { "$($p.WorkingSet64) $($p.HandleCount) $($p.CPU)" }`],
    { encoding: 'utf8', timeout: 15000 }).trim();
    if (output === '') return null;
    const [workingSet, handles, cpu] = output.split(/\s+/);
    return {
      workingSetMB: Math.round(Number(workingSet) / 1048576),
      handles: Number(handles),
      cpuSeconds: Number(cpu),
    };
  } catch {
    return null;
  }
}

const plugin = await import(pathToFileURL(join(ROOT, 'index.js')).href);
const routes = new Map();
const services = { webServer: { register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path); } } };

/**
 * 每个阶段（apply → 多轮 → unload）重新装配一次，覆盖会话创建与销毁。
 *
 * 这个插件不返回卸载函数：它把清理登记在 `ctx.effect` / `ctx.on` / `tools.register` 上
 * （与 lifecycle-test 同一套模型），所以这里把 disposer 收起来，倒序跑一遍当作 unload。
 */
function mount() {
  const tools = new Map();
  const disposers = [];
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); const dispose = () => tools.delete(definition.name); disposers.push(dispose); return dispose; } },
    webServer: services.webServer,
    on: () => { const dispose = () => {}; disposers.push(dispose); return dispose; },
    effect: (fn) => { const dispose = fn(); const wrapped = typeof dispose === 'function' ? dispose : () => {}; disposers.push(wrapped); return wrapped; },
    inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx); const dispose = () => {}; disposers.push(dispose); return dispose; },
    get: (name) => services[name],
    logger: { info() {}, warn() {} },
  };
  plugin.apply(ctx, { defaultEnabled: true });
  /** 反序执行登记到的清理（最后登记的先生效），真实宿主也是这样收尾的。 */
  const unload = () => {
    for (const dispose of [...disposers].reverse()) {
      try { dispose(); } catch { /* 卸载路径的异常不该影响测量 */ }
    }
  };
  return { tools, unload };
}

const status = async () => {
  const route = routes.get('/computer-use/status');
  if (route === undefined) return null;
  let payload = null;
  const res = { status: 0, writeHead(code) { this.status = code; }, end(text) { payload = JSON.parse(text); } };
  await route.handler({ method: 'GET', url: '/computer-use/status' }, res);
  return payload;
};

/** 一次调用 + 它的阶段耗时（宿主自己在 `timing` 里报告的那些）。 */
async function timed(label, run) {
  const started = process.hrtime.bigint();
  const outcome = await run().then((value) => ({ value }), (error) => ({ error: String(error?.message ?? error) }));
  const totalMs = Number(process.hrtime.bigint() - started) / 1e6;
  const value = outcome.value ?? {};
  return {
    label,
    totalMs,
    error: outcome.error,
    timing: value.timing ?? null,
    ok: outcome.error === undefined,
  };
}

const phases = [];
/** 每个阶段第一轮（预热）的耗时：那就是冷启动（§12.2 的第一项）。 */
const coldStart = [];
const environment = (() => {
  const probe = () => {
    try {
      return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `$w = Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Measure-Object; "$($w.Count)"`],
      { encoding: 'utf8', timeout: 20000 }).trim();
    } catch {
      return 'unknown';
    }
  };
  return { visibleWindows: probe(), platform: process.platform, node: process.version, rounds: ROUNDS, fixture: WINDOW_MATCH };
})();
console.log(`环境：${environment.platform} / Node ${environment.node} / 当前可见窗口 ${environment.visibleWindows} 个（这些窗口会与截图争用桌面）${WINDOW_MATCH === null ? '' : ` / 夹具窗口 "${WINDOW_MATCH}"`}`);

const startedAt = Date.now();
/** 两阶段：第一段测稳态，卸载后再来一段，覆盖"多轮创建与销毁"。 */
for (const phaseIndex of [1, 2]) {
  const { tools, unload } = mount();
  const samples = [];
  const before = await status();
  /**
   * worker 进程号：状态路由的 `runtime.backends.main` 是"主后端"（`read` 是那个只读的副后端），
   * 老形状里可能叫 `workers`，两个都认，读不到就报 null 而不是编一个数字。
   */
  const workerPidOf = (payload) => Number(payload?.runtime?.backends?.main?.pid ?? payload?.runtime?.workers?.[0]?.pid ?? 0);
  const workerPid = workerPidOf(before);
  const resourcesBefore = workerResources(workerPid);
  const sampler = startLoopLagSampler();

  /**
   * 夹具窗口：给了 `--window` 就先解析一次 hwnd，之后每轮的 UIA 读都打同一个窗口。
   * 解析不到就直接失败退出——拿不到夹具就没有"同一场景"，继续测出来的数字没意义。
   */
  let fixture = null;
  if (WINDOW_MATCH !== null) {
    const listing = await tools.get('computer_windows').execute({}, { agent: { session: `soak-fixture-${phaseIndex}` }, signal: undefined });
    const hit = (listing?.windows ?? []).find((one) => String(one.title ?? '').toLowerCase().includes(WINDOW_MATCH.toLowerCase()));
    if (hit === undefined) {
      console.error(`找不到标题包含 "${WINDOW_MATCH}" 的窗口，无法固定被测目标`);
      process.exit(1);
    }
    fixture = { hwnd: Number(hit.hwnd), title: hit.title };
    console.log(`夹具窗口：hwnd ${fixture.hwnd} "${fixture.title}"`);
  }

  for (let round = 0; round < ROUNDS + 1; round += 1) {
    // 每轮换一个会话 id：租约、引用、附件都按会话记账，换会话才碰得到这些路径。
    const session = `soak-${phaseIndex}-${round}`;
    const exec = { agent: { session: { id: session } }, signal: undefined };
    const call = (name, payload) => timed(name, () => tools.get(name).execute(payload, exec));
    /** 第 0 轮是**预热**（§12.2：预热之后再测）：worker 首次启动的开销单独记成冷启动。 */
    const roundSamples = [
      await call('computer_screenshot', { region: { x: 0, y: 0, width: 320, height: 200 }, format: 'jpeg', scale: 0.5, save_path: join(tmpdir(), `dsh-soak-${phaseIndex}-${round}.jpg`) }),
      await call('computer_ui', fixture === null ? { max_nodes: 60, max_depth: 4 } : { hwnd: fixture.hwnd, max_nodes: 60, max_depth: 4 }),
      await call('computer_windows', {}),
      await call('computer_actions', { steps: [{ action: 'wait', seconds: 0.05 }], evidence: false, screenshot: false }),
    ];
    if (WITH_BROWSER && round === 1) roundSamples.push(await call('browser_state', { what: 'tabs' }));
    if (round === 0) coldStart.push({ phase: phaseIndex, samples: roundSamples });
    else samples.push(...roundSamples);
    await sleep(30);
  }

  const loopLag = sampler.stop();
  const after = await status();
  const resourcesAfter = workerResources(workerPidOf(after));
  phases.push({
    phase: phaseIndex,
    samples,
    loopLag,
    fixture,
    // 起点还没有 worker（第一次调用才会启动），所以起点 pid 通常是 0，终点才是真正在跑的进程。
    workerPidBefore: workerPid,
    workerPidAfter: workerPidOf(after),
    resourcesBefore,
    resourcesAfter,
    counters: {
      before: before?.runtime?.metrics ?? null,
      after: after?.runtime?.metrics ?? null,
    },
  });
  unload();
  await sleep(400); // 让 dispose 真的跑完（关 worker、清定时器）
}

rmSync(shim, { recursive: true, force: true });

/** 汇总：按调用名分组，给出 p50/p95/max，并单独统计失败（失败也是结果）。 */
const TIMING_KEYS = ['queueMs', 'startMs', 'workerMs', 'captureMs', 'admitMs', 'backendMs'];
const byLabel = new Map();
for (const phase of phases) {
  for (const sample of phase.samples) {
    if (!byLabel.has(sample.label)) byLabel.set(sample.label, []);
    byLabel.get(sample.label).push(sample);
  }
}
const summary = [...byLabel].map(([label, list]) => {
  /** 只汇总这批样本里真的出现过的阶段字段（截图给的是 captureMs，批次给的是 workerMs）。 */
  const phasesSeen = {};
  for (const key of TIMING_KEYS) {
    const values = list.map((one) => one.timing?.[key]).filter((one) => Number.isFinite(one));
    if (values.length > 0) phasesSeen[key] = { p50: percentile(values, 0.5), p95: percentile(values, 0.95) };
  }
  return {
    label,
    calls: list.length,
    failures: list.filter((one) => !one.ok).length,
    total: { p50: percentile(list.map((one) => one.totalMs), 0.5), p95: percentile(list.map((one) => one.totalMs), 0.95), max: Math.max(...list.map((one) => one.totalMs)) },
    phases: phasesSeen,
    firstError: list.find((one) => !one.ok)?.error ?? null,
  };
});
/** 冷启动（每个阶段第一轮，已排除在分位数之外）。 */
const coldStartSummary = [...new Map(coldStart.flatMap((entry) => entry.samples).map((one) => [one.label, null])).keys()].map((label) => ({
  label,
  ms: coldStart.flatMap((entry) => entry.samples).filter((one) => one.label === label).map((one) => Math.round(one.totalMs)),
}));

const allLoopLag = phases.flatMap((phase) => phase.loopLag);
const countersOf = (phase, field) => {
  const before = phase.counters.before?.[field];
  const after = phase.counters.after?.[field];
  return Number.isFinite(before) && Number.isFinite(after) ? after - before : null;
};
const report = {
  tool: 'stress-soak',
  at: new Date().toISOString(),
  elapsedMs: Date.now() - startedAt,
  environment,
  coldStart: coldStartSummary,
  summary,
  loopLagMs: { p50: percentile(allLoopLag, 0.5), p95: percentile(allLoopLag, 0.95), max: Math.max(...allLoopLag) },
  phases: phases.map((phase) => ({
    phase: phase.phase,
    fixture: phase.fixture,
    workerPidBefore: phase.workerPidBefore,
    workerPidAfter: phase.workerPidAfter,
    resourcesBefore: phase.resourcesBefore,
    resourcesAfter: phase.resourcesAfter,
    delta: {
      toolCalls: countersOf(phase, 'toolCalls'),
      screenshots: countersOf(phase, 'screenshots'),
      uiReads: countersOf(phase, 'uiReads'),
      uiNodes: countersOf(phase, 'uiNodes'),
      uiReadMs: countersOf(phase, 'uiReadMs'),
      readRetries: countersOf(phase, 'readRetries'),
      // §12.3：这一项是"重复次数"里最要紧的——读取优化后它应该明显低于调用数。
      buildReads: countersOf(phase, 'buildReads'),
    },
  })),
};

mkdirSync(dirname(JSON_PATH), { recursive: true });
writeFileSync(JSON_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const round2 = (value) => (value === null || value === undefined ? '—' : Math.round(value));
console.log(`\n阶段数 ${phases.length}，每阶段 ${ROUNDS} 轮（另有 1 轮预热，不计入分位数）；已写 ${JSON_PATH}`);
console.log(`冷启动（预热轮，含 worker 首次启动）：${coldStartSummary.map((one) => `${one.label} ${one.ms.join('/')} ms`).join('；')}`);
console.log('调用                 次数  失败   p50总     p95总     最大   阶段拆分(p50)');
for (const row of summary) {
  const detail = Object.entries(row.phases).map(([key, value]) => `${key.replace('Ms', '')} ${Math.round(value.p50)}`).join(' ');
  console.log(`${row.label.padEnd(20)} ${String(row.calls).padStart(4)} ${String(row.failures).padStart(5)}  ${String(round2(row.total.p50)).padStart(6)} ${String(round2(row.total.p95)).padStart(8)} ${String(round2(row.total.max)).padStart(8)}   ${detail}`);
}
console.log(`事件循环延迟 p50/p95/最大：${round2(report.loopLagMs.p50)} / ${round2(report.loopLagMs.p95)} / ${round2(report.loopLagMs.max)} ms`);
for (const phase of report.phases) {
  const before = phase.resourcesBefore;
  const after = phase.resourcesAfter;
  console.log(`阶段 ${phase.phase}：worker pid ${phase.workerPidBefore || '（起点未启动）'} → ${phase.workerPidAfter || '—'}；内存 ${before?.workingSetMB ?? '—'} → ${after?.workingSetMB ?? '—'} MB，句柄 ${before?.handles ?? '—'} → ${after?.handles ?? '—'}，CPU ${after?.cpuSeconds ?? '—'} s`);
  console.log(`        计数增量：调用 ${phase.delta.toolCalls}、截图 ${phase.delta.screenshots}、UIA 读 ${phase.delta.uiReads}（${phase.delta.uiNodes} 节点/${round2(phase.delta.uiReadMs)} ms）、读重试 ${phase.delta.readRetries}、构建读取 ${phase.delta.buildReads}`);
}
process.exit(0);
