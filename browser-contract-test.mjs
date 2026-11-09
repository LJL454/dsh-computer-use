/**
 * PR02 —— 从公开入口验证输入契约（方案 4.2 的验收条件）。
 *
 * 方案点名批评过一种"测试"：直接调用 `execute`，绕过 schema，于是"合法输入到不了处理器"这件事
 * 永远不会失败。所以这份测试走真正的公开入口：
 *
 *   - 用宿主会看到的那份 `parameters` 断言 `press.key`、`upload.files`、`scroll.dy`、
 *     `tabs.operation`、`wait_for.condition` 等曾经缺失的字段确实被声明；
 *   - 每个非法输入都必须以 `[BAD_REQUEST]` 失败，**并且**在它之前不能有任何传输层动作 ——
 *     判据是一个真的在监听、并统计连接数的本地 TCP 服务：非法输入之后连接数必须还是 0；
 *   - 合法输入必须越过校验，走到"建立连接"这一步（连接数增加），证明它确实到达了处理器，
 *     而不是被 schema 挡在门外。
 *
 *   node browser-contract-test.mjs
 */
import { registerHooks } from 'node:module';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-contract-'));
const toolsStub = join(shimDir, 'dsh-tools-stub.mjs');
writeFileSync(toolsStub, 'export const defineTool = (definition) => definition;\nexport const toolDefinitions = [];\n');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: pathToFileURL(toolsStub).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}

/* ------------------------------------------------- a transport that counts */

let connections = 0;
const server = createServer((socket) => {
  connections += 1;
  // Nothing here speaks WebSocket: accepting and closing at once is exactly the "the endpoint is
  // there and the protocol failed" case, which is fast and needs no browser.
  socket.destroy();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const endpoint = `http://127.0.0.1:${port}`;

/* ------------------------------------------------------------ the plugin */

const plugin = await import('./index.js');
const tools = new Map();
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
plugin.apply(ctx, { defaultEnabled: true, browserEndpoint: endpoint });
const tool = tools.get('browser_actions');
const exec = { agent: { session: { id: 'contract-session' } }, signal: undefined };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log('\n== the host-visible declaration carries every consumed field ==');
const stepsParameter = tool.parameters.steps;
const item = stepsParameter.items;
check('steps is an array of objects', stepsParameter.type === 'array' && item.type === 'object', `${stepsParameter.type}/${item.type}`);
check('the step object is closed', item.additionalProperties === false, String(item.additionalProperties));
for (const name of ['key', 'code', 'files', 'dx', 'dy', 'operation', 'tab', 'condition']) {
  check(`parameters.steps.items declares "${name}"`, item.properties[name] !== undefined);
}
check('action is required and enumerates the catalog', item.properties.action.required === true && item.properties.action.type === 'string', JSON.stringify(item.properties.action));
check('the action enum has 12 values', Array.isArray(item.properties.action.enum) && item.properties.action.enum.length === 12, JSON.stringify(item.properties.action.enum));
check('files is declared as an array of strings', item.properties.files.type === 'array' && item.properties.files.items?.type === 'string', JSON.stringify(item.properties.files));
check('condition is declared as an object', item.properties.condition.type === 'object', JSON.stringify(item.properties.condition));
check('tab and the call-level tab are different parameters', tool.parameters.tab !== undefined && item.properties.tab !== undefined, `${JSON.stringify(tool.parameters.tab)} / ${JSON.stringify(item.properties.tab)}`);

console.log('\n== invalid input fails before anything is sent ==');
const NEGATIVE = [
  ['an unknown action', [{ action: 'fling' }]],
  ['press without a key', [{ action: 'press' }]],
  ['upload without files', [{ action: 'upload', ref: 'r1' }]],
  ['scroll with no displacement', [{ action: 'scroll' }]],
  ['tabs with an empty tab', [{ action: 'tabs', operation: 'activate', tab: '' }]],
  ['wait_for without a condition', [{ action: 'wait_for' }]],
  ['a field the action does not use', [{ action: 'click', ref: 'r1', dy: 10 }]],
  ['an unknown field', [{ action: 'state', colour: 'red' }]],
  ['a wrong type', [{ action: 'state', max_nodes: 'many' }]],
  ['zero steps', []],
];
for (const [label, steps] of NEGATIVE) {
  const before = connections;
  let outcome = null;
  try {
    await tool.execute({ steps }, exec);
    outcome = 'accepted';
  } catch (error) {
    outcome = String(error?.message ?? error);
  }
  await sleep(30);
  check(`rejects: ${label}`, typeof outcome === 'string' && outcome.startsWith('[BAD_REQUEST]'), outcome);
  check(`nothing was sent for: ${label}`, connections === before, `${connections - before} connection(s)`);
}

console.log('\n== valid input reaches the handler (and the transport) ==');
{
  const before = connections;
  let result = null;
  let thrown = null;
  try {
    result = await tool.execute({ steps: [
      { action: 'state', filter: 'save' },
      { action: 'press', key: 'Enter' },
      { action: 'scroll', dy: 200 },
      { action: 'tabs', operation: 'list' },
      { action: 'wait_for', condition: { name: 'saved' } },
      { action: 'upload', ref: 'r1', files: ['C:\\temp\\one.txt'] },
    ] }, exec);
  } catch (error) {
    thrown = String(error?.message ?? error);
  }
  await sleep(50);
  check('the call was not rejected as bad input', thrown === null || !thrown.startsWith('[BAD_REQUEST]'), String(thrown));
  check('the handler ran and the transport was reached', connections > before, `${connections - before} connection(s)`);
  check('the answer carries the receipt shape', result === null || (typeof result === 'object' && 'outcome' in result && 'failedAt' in result), JSON.stringify(result)?.slice(0, 160));
}

await new Promise((resolve) => server.close(resolve));
rmSync(shimDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
