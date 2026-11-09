/**
 * PR18 接线 —— `/computer-use/modules` 只说"现在有什么、宿主支持什么"。
 *
 * 方案 4.21.2 规定：管理入口只给用户设置/管理服务，**不注册成模型可调用的工具**。所以这条路由
 * 只读、只报状态，任何安装/启用/卸载都必须走用户界面。
 *
 * 断言四件事：
 *
 *   - 没有扩展时列表是空的（不扫目录、不唤醒进程）；
 *   - 能力报告是"检测"而不是"声明"：设置服务与配置编辑器不在场就报 false；
 *   - 非 GET 一律 405；
 *   - 这条路由不注册任何工具（工具数量不因它变化）。
 *
 *   node modules-route-test.mjs
 */
import { registerHooks } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-modules-'));
const toolsStub = join(shimDir, 'tools-stub.mjs');
writeFileSync(toolsStub, 'export const defineTool = (definition) => definition;\n');
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

function response() {
  const state = { status: 0, body: '' };
  return { state, writeHead(status) { state.status = status; }, end(chunk) { state.body += chunk ?? ''; } };
}

async function mount({ services: extraServices = {} } = {}) {
  const plugin = await import(`./index.js?modules=${Object.keys(extraServices).join('-') || 'none'}`);
  const tools = new Map();
  const routes = new Map();
  const services = {
    webServer: { register: (definition) => { routes.set(definition.path, definition); return () => {}; } },
    ...extraServices,
  };
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
    webServer: services.webServer,
    on: () => {},
    effect: (fn) => { const disposer = fn(); return () => { if (typeof disposer === 'function') disposer(); }; },
    inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx); return () => {}; },
    get: (name) => services[name],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
  plugin.apply(ctx, { defaultEnabled: false, shotDir: join(shimDir, 'shots') });
  return { tools, routes };
}

const request = (method, url) => ({ method, url });

console.log('\n== the modules route reports an empty, untouched host ==');
{
  const { tools, routes } = await mount();
  const handler = routes.get('/computer-use/modules')?.handler;
  check('the route is registered', typeof handler === 'function', [...routes.keys()].join(', '));
  const res = response();
  await handler(request('GET', '/computer-use/modules'), res);
  const payload = JSON.parse(res.state.body);
  check('it answers 200', res.state.status === 200, String(res.state.status));
  check('it carries a schema', payload.schema === 'dsh.computer-use.modules/v1', String(payload.schema));
  check('no module is installed', Array.isArray(payload.modules) && payload.modules.length === 0, JSON.stringify(payload.modules));
  check('dynamic tool revocation is reported as available', payload.capabilities?.dynamicToolRevocation === true, JSON.stringify(payload.capabilities));
  check('the settings service is reported honestly (absent here)', payload.capabilities?.settingsService === false, JSON.stringify(payload.capabilities));
  check('the note says management is user-facing', /never installs/.test(payload.note ?? ''), String(payload.note));
  check('no tool is added by this route', tools.size === 18, String(tools.size));
  const verboseResponse = response();
  await handler(request('GET', '/computer-use/modules?verbose=1'), verboseResponse);
  const verbose = JSON.parse(verboseResponse.state.body);
  check('verbose mode exposes the host API version', /^[0-9]+\.[0-9]+\.[0-9]+$/.test(String(verbose.hostApiVersion ?? '')), String(verbose.hostApiVersion));
}

console.log('\n== capabilities are detected, not claimed ==');
{
  const { routes } = await mount({ services: { settings: { page: () => {} }, configEditor: { edit: () => {} } } });
  const handler = routes.get('/computer-use/modules').handler;
  const res = response();
  await handler(request('GET', '/computer-use/modules'), res);
  const payload = JSON.parse(res.state.body);
  check('a present settings service is reported', payload.capabilities.settingsService === true, JSON.stringify(payload.capabilities));
  check('a present config editor is reported', payload.capabilities.configEditor === true, JSON.stringify(payload.capabilities));
}

console.log('\n== it refuses anything but GET ==');
{
  const { routes } = await mount();
  const handler = routes.get('/computer-use/modules').handler;
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const res = response();
    await handler(request(method, '/computer-use/modules'), res);
    check(`${method} is refused with 405`, res.state.status === 405, `${method} -> ${res.state.status}`);
  }
}

rmSync(shimDir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
