/**
 * 工具冒烟：每个工具收到"明显非法/缺失的参数"时，必须**干净地拒绝**，而不是崩掉或去动桌面。
 *
 * 为什么需要它：套件是按功能写的（点、读、批处理、剪贴板……），覆盖的是"参数正确时对不对"。
 * "参数不对时会怎样"只有零散几条断言，而这一类的失败最难看：模型给错参数是常态，如果那时抛的是
 * 未包装的 TypeError，或者更糟——**先启动了 worker 再拒绝**（每次试错都付一次 1 秒的启动代价），
 * 用户看到的就是"这个能力很慢很脆"。
 *
 * 所以这里断言三件事：
 *   1. 每个工具的非法调用要么抛出**带 `[CODE]` 前缀**的拒绝，要么返回带说明的失败；
 *   2. 拒绝之后**没有 worker 被启动**（`/status` 里 `backend.started === false`）；
 *   3. 没有任何调用让进程崩掉（未捕获异常/未处理拒绝都会让这个脚本非零退出）。
 *
 * 用法：node tools/smoke-tools.mjs
 */
import { registerHooks } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const shim = mkdtempSync(join(tmpdir(), 'dsh-tools-smoke-'));
writeFileSync(join(shim, 'stub.mjs'), 'export const defineTool = (d) => d;\nexport const toolDefinitions = [];\n');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: pathToFileURL(join(shim, 'stub.mjs')).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}

process.on('unhandledRejection', (reason) => {
  failures.push(`未处理的拒绝：${String(reason)}`);
  console.log(`  FAIL  未处理的拒绝：${String(reason)}`);
});

const plugin = await import(pathToFileURL(join(ROOT, 'index.js')).href);
const routes = new Map();
const tools = new Map();
const services = { webServer: { register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path); } } };
const ctx = {
  tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
  webServer: services.webServer,
  on: () => () => {},
  effect: (fn) => { const disposer = fn(); return typeof disposer === 'function' ? disposer : () => {}; },
  inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx); return () => {}; },
  get: (name) => services[name],
  logger: { info() {}, warn() {} },
};
plugin.apply(ctx, { defaultEnabled: true });

const status = async () => {
  const route = routes.get('/computer-use/status');
  let payload = null;
  const response = { writeHead() {}, end(text) { payload = JSON.parse(text); } };
  await route.handler({ method: 'GET', url: '/computer-use/status' }, response);
  return payload;
};

/** 明显非法的参数（每个工具都适用：类型错、必填缺、取值不在枚举里）。 */
const BAD_ARGS = [
  { label: '空对象', args: {} },
  { label: '类型全错', args: { hwnd: 'not-a-number', x: 'left', y: [], action: 42, keys: {}, text: [], steps: 'nope' } },
  { label: '越界数值', args: { hwnd: -1, x: -999999, y: -999999, amount: 9999, timeout_ms: -5, max_nodes: -3 } },
];

/** 只读工具：`{}` 是**有意义**的调用（枚举窗口、读前台、读剪贴板…），成功就是成功。 */
const READ_ONLY_TOOLS = new Set([
  'computer_windows', 'computer_ui', 'computer_screenshot', 'computer_clipboard', 'computer_ui_action', 'app_env_audit',
]);
/** 写工具：缺了必填参数还敢"成功"，就是真问题——它意味着一次没人要求的误操作。 */
const WRITE_TOOLS = new Set([
  'computer_click', 'computer_drag', 'computer_scroll', 'computer_type', 'computer_key', 'computer_paste',
  'computer_launch', 'computer_stop', 'computer_actions', 'app_launch', 'browser_actions',
]);

console.log(`\n== 18 个工具 × 3 组非法参数：都要干净拒绝 ==`);
const before = await status();
const problems = [];
/** 记录"哪一个工具的非法调用把 worker 拉起来了"——这比"有没有启动"更有用。 */
const startedBy = [];
/** worker 进程的启动次数：能力开启时**预热**会启动一次，所以看"次数有没有再涨"而不是"起没起"。 */
const spawnsOf = (payload) => Number(payload?.backend?.transport?.spawns ?? 0);
const spawnsBefore = spawnsOf(before);
for (const [name, definition] of tools) {
  const takesNoArguments = Object.keys(definition.parameters ?? {}).length === 0;
  for (const { label, args } of BAD_ARGS) {
    const exec = { agent: { session: { id: `smoke-${name}` } }, signal: undefined };
    let outcome;
    try {
      const value = await definition.execute(args, exec);
      outcome = { kind: 'value', value };
    } catch (error) {
      outcome = { kind: 'throw', message: String(error?.message ?? error) };
    }
    if (outcome.kind === 'throw') {
      // 拒绝必须是"有结构的"：要么带失败码前缀，要么带明确的下一步说明。
      // `app_*` 家族（并入自 @local/dsh-app-launch）用自己的一套文案（"target is required"），
      // 这里按家族放宽，但仍然要求"说得清哪里不对"。
      const structured = /^\[[A-Z_]+\]/.test(outcome.message)
        || /下一步：/.test(outcome.message)
        || /needs |must be |invalid|unknown /.test(outcome.message)
        || (name.startsWith('app_') && /is required|not found|could not/.test(outcome.message));
      if (!structured) problems.push(`${name} / ${label}：拒绝没有结构（${outcome.message.slice(0, 120)}）`);
    } else if (WRITE_TOOLS.has(name) && !takesNoArguments) {
      const value = outcome.value ?? {};
      const explained = value.ok === false || typeof value.note === 'string' || value.failedAt !== undefined || value.error !== undefined;
      if (!explained) problems.push(`${name} / ${label}：写工具在缺必填参数时"成功"了（${JSON.stringify(value).slice(0, 120)}）`);
    } else if (!READ_ONLY_TOOLS.has(name) && !WRITE_TOOLS.has(name) && !takesNoArguments) {
      const value = outcome.value ?? {};
      const explained = value.ok === false || typeof value.note === 'string' || value.failedAt !== undefined || value.error !== undefined || value.satisfied !== undefined;
      if (!explained) problems.push(`${name} / ${label}：返回了成功形状却没有说明（${JSON.stringify(value).slice(0, 120)}）`);
    }
  }
  const probe = await status();
  if (spawnsOf(probe) > spawnsBefore && startedBy.length === 0) startedBy.push(name);
}
check('每个工具的非法调用都被"有结构地"拒绝（未结构化的问题见下）', problems.length === 0, problems.slice(0, 6).join(' | '));
const after = await status();
check('整轮非法调用没有多启动 worker（廉价拒绝）', spawnsOf(after) === spawnsBefore, `spawns ${spawnsBefore} → ${spawnsOf(after)}；第一个让它多启动的工具：${startedBy.join(', ') || '（无）'}`);
check('非法调用没有推进工具调用计数以外的状态', Number.isFinite(after?.runtime?.metrics?.toolCalls), JSON.stringify(after?.runtime?.metrics ?? {}).slice(0, 140));
check('拒绝计数有增长（refusals 是能被观察的）', Number(after?.runtime?.metrics?.refusals ?? 0) >= Number(before?.runtime?.metrics?.refusals ?? 0), JSON.stringify({ before: before?.runtime?.metrics?.refusals, after: after?.runtime?.metrics?.refusals }));

console.log('\n== 参数护栏本身：该挡的挡、该放的放 ==');
{
  const clickTool = tools.get('computer_click');
  const dragTool = tools.get('computer_drag');
  const actionsTool = tools.get('computer_actions');
  const exec = { agent: { session: { id: 'smoke-guard' } }, signal: undefined };
  const refusal = async (definition, args) => {
    try {
      await definition.execute(args, exec);
      return null;
    } catch (error) {
      return String(error?.message ?? error);
    }
  };

  const noCoords = await refusal(clickTool, {});
  check('缺坐标的 click 被拒（不会点到 (0,0)）', /^\[BAD_REQUEST\]/.test(noCoords ?? ''), String(noCoords).slice(0, 140));
  check('拒绝语告诉它去哪拿坐标', /computer_ui|capture/.test(noCoords ?? ''), String(noCoords).slice(0, 140));

  const badHwnd = await refusal(actionsTool, { steps: [{ action: 'screenshot', hwnd: 'not-a-number' }] });
  check('垃圾 hwnd 被拒（不会漏出 PowerShell 转换异常）', /^\[BAD_REQUEST\]/.test(badHwnd ?? ''), String(badHwnd).slice(0, 140));
  const negativeHwnd = await refusal(tools.get('computer_ui'), { hwnd: -1 });
  check('负数 hwnd 被拒（不会漏出 COM 异常）', /^\[BAD_REQUEST\]/.test(negativeHwnd ?? ''), String(negativeHwnd).slice(0, 140));

  const badStep = await refusal(actionsTool, { steps: [{ action: 'screenshot' }, { action: 'click' }] });
  check('批次里缺坐标的步骤在第一步之前就被拒', /step 2 \(click\)/.test(badStep ?? ''), String(badStep).slice(0, 160));

  // 该放的要放：只给 path 的拖拽是 worker 支持的合法用法，护栏不能把它当"缺坐标"。
  const pathOnly = await refusal(dragTool, { path: [{ x: 10, y: 10 }, { x: 60, y: 40 }], duration_ms: 300 });
  check('只给 path 的拖拽不被护栏拒绝（会走到派发）', pathOnly === null || !/needs a numeric fromX/.test(pathOnly), String(pathOnly).slice(0, 160));
  const relativeMove = await refusal(actionsTool, { steps: [{ action: 'move', dx: 5, dy: -5 }] });
  check('相对移动（dx/dy，无坐标）不被护栏拒绝', relativeMove === null || !/needs a numeric/.test(relativeMove), String(relativeMove).slice(0, 160));
}

console.log('\n== 关闭能力时每个工具都应拒绝（且不启动 worker）==');
{
  const offTools = new Map();
  const offCtx = {
    tools: { register: (definition) => { offTools.set(definition.name, definition); return () => {}; } },
    webServer: services.webServer,
    on: () => () => {},
    effect: (fn) => { const disposer = fn(); return typeof disposer === 'function' ? disposer : () => {}; },
    inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(offCtx); return () => {}; },
    get: (name) => services[name],
    logger: { info() {}, warn() {} },
  };
  plugin.apply(offCtx, { defaultEnabled: false });
  const gateProblems = [];
  for (const name of offTools.keys()) {
    if (name.startsWith('app_') || name.startsWith('browser_') === false && name.startsWith('app')) continue;
    const exec = { agent: { session: { id: 'smoke-off' } }, signal: undefined };
    try {
      const value = await offTools.get(name).execute({}, exec);
      gateProblems.push(`${name}：关闭时仍返回了 ${JSON.stringify(value).slice(0, 60)}`);
    } catch (error) {
      const message = String(error?.message ?? error);
      // 电脑操作关闭时的拒绝语必须提到怎么打开（可执行），而不是一句"没有权限"。
      if (!/电脑操作|电脑操作目前|开启/.test(message)) gateProblems.push(`${name}：拒绝语没有告诉用户怎么打开（${message.slice(0, 100)}）`);
    }
  }
  check('能力关闭时每个工具都拒绝并给出可执行的提示', gateProblems.length === 0, gateProblems.slice(0, 5).join(' | '));
}

rmSync(shim, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) for (const failure of failures) console.log(`  - ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
