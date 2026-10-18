/**
 * The benefit ledger (8.txt §2 / §17): what each capability saves in round trips.
 *
 * This is deliberately *not* a benchmark of the desktop. A wall-clock number from a live
 * desktop depends on which window happens to be in front, how fast the machine is, and how the
 * model decides to retry — it would look like evidence and mean very little. What is stable and
 * checkable is the *shape of the interaction*: how many tool calls the old path needed, how many
 * the new capability needs, and — checked live against the mounted plugin — that the capability
 * is actually advertised with the fields the new path relies on.
 *
 * So each row has two sides:
 *   - `calls`: the round trips before and after, each with the reasoning in one line;
 *   - `check`: an assertion over the real tool schema, so a row cannot claim a saving for a
 *     capability that is not there. A row whose check fails is reported as unproven.
 *
 *   node tools/task-eval.mjs            # table + totals
 *   node tools/task-eval.mjs --json     # for a report
 */
import { registerHooks } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const pluginDir = join(HERE, '..');
const asJson = process.argv.includes('--json');

const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-eval-'));
const toolsStub = join(shimDir, 'dsh-tools-stub.mjs');
writeFileSync(toolsStub, 'export const defineTool = (definition) => definition;\n');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: pathToFileURL(toolsStub).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

/**
 * Each row: the task, the old path's call count with its reason, the new path's, and a check
 * that the capability behind the new path is really in the tool schemas.
 */
const SCENARIOS = [
  {
    task: 'B1 读一段文本/选区（记事本、输入框）',
    before: { calls: 3, why: '截图看内容 → 定位 → 再截图确认，或多次 computer_ui 逐格取文本' },
    after: { calls: 1, why: 'computer_ui 一次带回 text/selected（有预算与省略说明）' },
    check: (tools) => has(tools, 'computer_ui', 'text') && has(tools, 'computer_ui', 'text_target'),
  },
  {
    task: 'B6 长文本粘贴且不弄坏用户剪贴板',
    before: { calls: 4, why: '读剪贴板 → 写入 → 粘贴 → 写回原内容（还要自己记着复原）' },
    after: { calls: 1, why: 'computer_paste 自带借用/还原与六态 restore 报告' },
    check: (tools) => has(tools, 'computer_paste', 'restore') && hasOutput(tools, 'computer_paste', 'restoreStatus'),
  },
  {
    task: 'B2 看到弹层并点它（对话框/弹出菜单）',
    before: { calls: 4, why: '截图（看不到弹层）→ 换窗口 → 再截图 → 再点' },
    after: { calls: 2, why: 'computer_ui 一次带回树 + 各帧（captures: related），再用帧 id 操作' },
    check: (tools) => has(tools, 'computer_ui', 'captures') && hasOutput(tools, 'computer_ui', 'frames'),
  },
  {
    task: 'B3 画布/滑块上的折线拖拽',
    before: { calls: 3, why: '直拖失败 → 分段多次拖 → 截图核对' },
    after: { calls: 1, why: 'computer_drag 接受 path（弧长采样 + 落点复核）' },
    check: (tools) => has(tools, 'computer_drag', 'path') && has(tools, 'computer_drag', 'duration_ms'),
  },
  {
    task: 'B4 按名字启动一个应用（名字不完整）',
    before: { calls: 2, why: '启动 → 发现开错 → 再按完整路径启动' },
    after: { calls: 1, why: 'computer_launch 返回候选与依据；平局直接拒绝而不是猜' },
    check: (tools) => has(tools, 'computer_launch', 'refresh_discovery') && hasOutput(tools, 'computer_launch', 'candidates'),
  },
  {
    task: 'C1 读一个网页的结构（表单有哪些控件）',
    before: { calls: 3, why: '截图 → 放大看 → 再截图确认（像素里读不出角色与名字）' },
    after: { calls: 1, why: 'browser_state 一次给出可访问性树与引用' },
    check: (tools) => has(tools, 'browser_state', 'view') && hasOutput(tools, 'browser_state', 'nodes'),
  },
  {
    task: 'C2 填表并提交、确认结果',
    before: { calls: 6, why: '点输入框 → 输入 → 点按钮 → 截图 → 发现没成功 → 重试' },
    after: { calls: 2, why: 'browser_state 取引用 → browser_actions 一步填+点+校验（带尾部 state）' },
    check: (tools) => has(tools, 'browser_actions', 'steps') && hasOutput(tools, 'browser_actions', 'verification'),
  },
];

function propertyOf(tools, tool, name) {
  const definition = tools.get(tool);
  if (definition === undefined) return undefined;
  const parameters = definition.parameters ?? {};
  return (parameters.properties ?? parameters)[name];
}
function has(tools, tool, name) {
  return propertyOf(tools, tool, name) !== undefined;
}
function hasOutput(tools, tool, name) {
  return tools.get(tool)?.output?.schema?.properties?.[name] !== undefined;
}

const tools = new Map();
try {
  const plugin = await import(pathToFileURL(join(pluginDir, 'index.js')).href);
  const services = { webServer: { register: () => () => {} } };
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
    webServer: services.webServer,
    on: () => {},
    effect: (fn) => { const disposer = fn(); return () => { if (typeof disposer === 'function') disposer(); }; },
    inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx); return () => {}; },
    get: (name) => services[name],
    logger: { info: () => {}, warn: () => {} },
  };
  plugin.apply(ctx, { defaultEnabled: true });
} catch (error) {
  console.error(`could not mount ${pluginDir}: ${error?.message ?? error}`);
  process.exitCode = 1;
} finally {
  try { rmSync(shimDir, { recursive: true, force: true }); } catch { /* best effort */ }
}

const rows = SCENARIOS.map((scenario) => {
  let proven = false;
  try {
    proven = scenario.check(tools) === true;
  } catch {
    proven = false;
  }
  return {
    task: scenario.task,
    beforeCalls: scenario.before.calls,
    afterCalls: scenario.after.calls,
    saved: scenario.before.calls - scenario.after.calls,
    proven,
    beforeWhy: scenario.before.why,
    afterWhy: scenario.after.why,
  };
});

if (asJson) {
  console.log(JSON.stringify({ scenarios: rows, savedTotal: rows.reduce((sum, row) => sum + (row.proven ? row.saved : 0), 0) }, null, 2));
} else {
  console.log('任务                                    旧路径  新路径  省下  能力已宣传');
  for (const row of rows) {
    console.log(`${row.task.padEnd(40)}${String(row.beforeCalls).padStart(4)}${String(row.afterCalls).padStart(7)}${String(row.proven ? row.saved : 0).padStart(6)}  ${row.proven ? 'yes' : 'NO — 该项不计入合计'}`);
  }
  const saved = rows.reduce((sum, row) => sum + (row.proven ? row.saved : 0), 0);
  console.log(`\n合计：${rows.filter((row) => row.proven).length}/${rows.length} 项能力已证实，每轮这一组任务共省 ${saved} 次往返。`);
  console.log('口径：旧/新路径的调用次数是接口形态的推算（写在每行理由里），"能力已宣传"是对真实工具 schema 的即时断言 —— ');
  console.log('未宣传的能力即使省得再多也不计入，避免用不存在的接口凑数字。');
  if (process.env.DSH_TASK_EVAL_VERBOSE === '1') {
    for (const row of rows) console.log(`\n${row.task}\n  旧：${row.beforeWhy}\n  新：${row.afterWhy}`);
  }
}

setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref();
