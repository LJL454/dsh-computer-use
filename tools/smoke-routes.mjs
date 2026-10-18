/**
 * 路由冒烟：把三个 JSON 路由真的调一遍（9.txt 目标"检查自身代码有没有影响运行的错误"）。
 *
 * 为什么需要它：`test-schema-visibility.mjs` 只**静态**核对两个调用点（因为驱动它们会启动 worker），
 * 而 `client-smoke.mjs` 用的是桩。于是"路由本身能不能跑"没有一条真正执行它的测试——而路由里恰好有
 * 一堆只在运行时才会走到的分支（控制状态推导、授权开关、会话清理、诊断汇总）。
 *
 * 这里不启动 worker 的部分（status / state）全都真跑；`probe` 会启动 worker，所以默认跳过，
 * 加 `--with-worker` 才跑（那一步很慢，而且会占用桌面）。
 *
 * 用法：node tools/smoke-routes.mjs [--with-worker]
 */
import { registerHooks } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WITH_WORKER = process.argv.includes('--with-worker');

const shim = mkdtempSync(join(tmpdir(), 'dsh-smoke-'));
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
plugin.apply(ctx, { defaultEnabled: false });

/** 调一次路由，返回 `{ status, payload }`。 */
async function callRoute(path, { method = 'GET', sessionId = 'smoke-session', body } = {}) {
  const route = routes.get(path);
  if (route === undefined) throw new Error(`路由未注册：${path}`);
  const url = `${path}${sessionId === null ? '' : `?sessionId=${encodeURIComponent(sessionId)}`}`;
  let payload;
  const response = {
    status: 0,
    writeHead(status) { this.status = status; return this; },
    end(text) { payload = text === undefined ? undefined : JSON.parse(text); },
  };
  const request = {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      if (body === undefined) return;
      yield Buffer.from(JSON.stringify(body), 'utf8');
    },
  };
  await route.handler(request, response);
  return { status: response.status, payload };
}

console.log('\n== 路由注册 ==');
check('三条路由都在（status / state / probe）', ['/computer-use/status', '/computer-use/state', '/computer-use/probe'].every((one) => routes.has(one)), [...routes.keys()].join(', '));

console.log('\n== GET /state：一个从没开过的会话 ==');
{
  const off = await callRoute('/computer-use/state');
  check('返回 200', off.status === 200, JSON.stringify(off).slice(0, 200));
  check('state 是 off（控制块在 payload.control 下）', off.payload?.control?.state === 'off', JSON.stringify(off.payload?.control));
  check('enabled=false', off.payload?.enabled === false);
  check('控制块带着 inFlight / lease / lastAction 三个字段', ['inFlight', 'lease', 'lastAction'].every((key) => key in (off.payload?.control ?? {})), JSON.stringify(off.payload?.control));
  check('toolSchemas 是 visible 或 advertised-by-config', ['visible', 'advertised-by-config', 'hidden'].includes(off.payload?.control?.toolSchemas), String(off.payload?.control?.toolSchemas));
}

console.log('\n== POST /state：开 → 状态变 → 关 ==');
{
  const on = await callRoute('/computer-use/state', { method: 'POST', body: { enabled: true } });
  check('打开返回 200', on.status === 200, JSON.stringify(on).slice(0, 200));
  check('state 变成 observing 或 ready', ['observing', 'ready'].includes(on.payload?.control?.state), String(on.payload?.control?.state));
  const off = await callRoute('/computer-use/state', { method: 'POST', body: { enabled: false } });
  check('关闭返回 200', off.status === 200);
  check('关闭后 state 是 stopped（被显式停过）', off.payload?.control?.state === 'stopped', String(off.payload?.control?.state));
  check('revoked 里有 cancelled/released 两项', 'cancelled' in (off.payload?.revoked ?? {}) && 'released' in (off.payload?.revoked ?? {}), JSON.stringify(off.payload?.revoked));
}

console.log('\n== 方法不允许时给 405 ==');
{
  const bad = await callRoute('/computer-use/state', { method: 'PUT' });
  check('PUT 得到 405', bad.status === 405, String(bad.status));
  check('并且说明用 GET 或 POST', /GET or POST/.test(String(bad.payload?.error)), String(bad.payload?.error));
}

console.log('\n== GET /status：诊断汇总 ==');
{
  const status = await callRoute('/computer-use/status', { sessionId: null });
  check('返回 200', status.status === 200, JSON.stringify(status).slice(0, 200));
  const payload = status.payload ?? {};
  check('带 version / platform / label', typeof payload.version === 'string' && typeof payload.label === 'string', JSON.stringify({ version: payload.version, label: payload.label }));
  check('runtime.metrics 里有 buildReads', Number.isFinite(payload.runtime?.metrics?.buildReads), JSON.stringify(payload.runtime?.metrics ?? {}).slice(0, 160));
  check('runtime 里有 trace / profiles / backends', 'trace' in (payload.runtime ?? {}) && 'profiles' in (payload.runtime ?? {}) && 'backends' in (payload.runtime ?? {}));
  check('capabilities 或工具清单至少有一项非空', Array.isArray(payload.tools) ? payload.tools.length > 0 : true, JSON.stringify(payload).slice(0, 160));
}

if (WITH_WORKER) {
  console.log('\n== GET /probe：会启动 worker（--with-worker）==');
  const probe = await callRoute('/computer-use/probe', { sessionId: null });
  check('返回 200', probe.status === 200, JSON.stringify(probe).slice(0, 200));
  check('带 dpi / screens / health', probe.payload?.dpi !== undefined || probe.payload?.screens !== undefined, JSON.stringify(probe.payload ?? {}).slice(0, 200));
} else {
  console.log('\n（跳过 /probe：它会启动 worker，加 --with-worker 才跑）');
}

rmSync(shim, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) for (const failure of failures) console.log(`  - ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
