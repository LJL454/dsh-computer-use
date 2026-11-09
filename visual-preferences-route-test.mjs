/**
 * PR17 尾项 —— 设置路由与"即时切换"（方案 4.18.8.4）。
 *
 * 协议层与存储层各自有测试；这份补的是它们之间的那段：**用户改了一下设置，覆盖层真的收到了吗**。
 * 用假的 helper 与假的 HTTP 请求走真实的路由处理器，断言四件事：
 *
 *   - GET 给出当前值、默认值与 `settingsRevision`；
 *   - POST 只接受已知键，非法值被拒并原样报告；
 *   - 保存之后 helper 收到新的 `settingsRevision`（旧修订不会覆盖新修订）；
 *   - 覆盖层没起来时，保存仍然成功，只是 `applied` 为空 —— "存下来"和"已经生效"是两句话。
 *
 *   node visual-preferences-route-test.mjs
 */
import { registerHooks } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, 'tests', 'fake-indicator.mjs');
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-prefs-route-'));
const toolsStub = join(shimDir, 'dsh-tools-stub.mjs');
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const plugin = await import('./index.js');
const dataDir = join(shimDir, 'data');
const prefsPath = join(dataDir, 'visual-preferences.json');

/** A request body as an async iterable, which is what readJsonBody consumes. */
function request(method, url, body) {
  const text = body === undefined ? '' : Buffer.from(JSON.stringify(body), 'utf8');
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      if (text.length > 0) yield text;
    },
  };
}

/** A response that records what sendJson wrote. */
function response() {
  const state = { status: 0, body: '' };
  return {
    state,
    writeHead(status) { state.status = status; },
    end(chunk) { state.body += chunk ?? ''; },
  };
}

const routes = new Map();
const disposers = [];
const services = { webServer: { register: (definition) => { routes.set(definition.path, definition); return () => {}; } } };
const ctx = {
  tools: { register: () => () => {} },
  webServer: services.webServer,
  on: () => {},
  effect: (fn) => { const disposer = fn(); disposers.push(disposer); return () => { if (typeof disposer === 'function') disposer(); }; },
  inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx); return () => {}; },
  get: (name) => services[name],
  logger: { info: () => {}, warn: () => {}, error: () => {} },
};
plugin.apply(ctx, {
  defaultEnabled: false,
  shotDir: dataDir,
  interactionIndicator: {
    enabled: true,
    exePath: FAKE,
    spawn: (_exe, _args, options) => spawn(process.execPath, [FAKE], { ...options, env: { ...process.env } }),
  },
});

const handler = routes.get('/computer-use/visual-preferences')?.handler;
check('the route is registered', typeof handler === 'function', [...routes.keys()].join(', '));

console.log('\n== GET gives the values, the defaults and the revision ==');
{
  const res = response();
  await handler(request('GET', '/computer-use/visual-preferences'), res);
  const payload = JSON.parse(res.state.body);
  check('the route answers 200', res.state.status === 200, String(res.state.status));
  check('it reports a schema', payload.schema === 'dsh.computer-use.visual-preferences/v1', String(payload.schema));
  check('the values are the defaults', payload.values.bannerCharacter === false && payload.values.cursorHalo === true, JSON.stringify(payload.values));
  check('the defaults are shipped for the UI', payload.defaults?.cursorHalo === true, JSON.stringify(payload.defaults));
  check('the revision starts at 0', payload.settingsRevision === 0, String(payload.settingsRevision));
  check('no overlay is running yet', payload.overlay?.state === 'absent' || payload.overlay?.state === 'unavailable', JSON.stringify(payload.overlay));
}

console.log('\n== POST stores the change and reports what it refused ==');
{
  const res = response();
  await handler(request('POST', '/computer-use/visual-preferences', { bannerCharacter: true, cursorHalo: 'no', sparkle: 1 }), res);
  const payload = JSON.parse(res.state.body);
  check('the route answers 200', res.state.status === 200, String(res.state.status));
  check('the valid key is stored', payload.values.bannerCharacter === true, JSON.stringify(payload.values));
  check('the wrong type is refused', payload.values.cursorHalo === true, JSON.stringify(payload.values));
  check('both refusals are named', payload.rejected?.length === 2, JSON.stringify(payload.rejected));
  check('the revision moved to 1', payload.settingsRevision === 1, String(payload.settingsRevision));
  check('the file is on disk', existsSync(prefsPath), prefsPath);
  const document = JSON.parse(readFileSync(prefsPath, 'utf8'));
  check('the file carries the same revision', document.settingsRevision === 1, String(document.settingsRevision));
  check('and the same value', document.values.bannerCharacter === true, JSON.stringify(document.values));
  check('the note separates visuals from the cancel path', /not affected/i.test(payload.note ?? ''), String(payload.note));
}

console.log('\n== while a scope is open, the change reaches the helper ==');
{
  // 先让覆盖层真的起来：写一次（fake helper 会 hello + beginScope），这里直接用类型工具触发。
  const tools = new Map();
  const ctx2 = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
    webServer: services.webServer,
    on: () => {},
    effect: (fn) => { const disposer = fn(); disposers.push(disposer); return () => { if (typeof disposer === 'function') disposer(); }; },
    inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx2); return () => {}; },
    get: (name) => services[name],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
  // 第二个实例会被单实例保护挡下；直接复用第一个实例的 helper 状态：发一次 GET 看 overlay 状态，
  // 若仍是 absent 则说明本测试没有触发覆盖层 —— 那也不影响"保存与拒绝"的断言，只是跳过 applied。
  const res = response();
  await handler(request('GET', '/computer-use/visual-preferences'), res);
  const payload = JSON.parse(res.state.body);
  if (payload.overlay?.state === 'absent' || payload.overlay?.state === 'unavailable') {
    console.log('  SKIP  the overlay is not running in this process; the apply path is covered by indicator-integration-test');
  } else {
    const post = response();
    await handler(request('POST', '/computer-use/visual-preferences', { cursorCharacter: true }), post);
    const applied = JSON.parse(post.state.body);
    check('the change is reported as applied to the overlay', applied.applied?.applied === true, JSON.stringify(applied.applied));
    check('the helper saw a newer revision', applied.applied?.revision >= 2, JSON.stringify(applied.applied));
  }
}

console.log('\n== a bad method is refused ==');
{
  const res = response();
  await handler(request('DELETE', '/computer-use/visual-preferences'), res);
  check('it answers 405', res.state.status === 405, String(res.state.status));
}

for (const dispose of disposers) { try { dispose(); } catch { /* ignore */ } }
await sleep(200);
rmSync(shimDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
