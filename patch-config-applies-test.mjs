/**
 * 出厂配置的自检（O6 的默认值翻转）。
 *
 * `cordis.patch.yml` 是宿主读到的那一行配置。它一旦写错（键名拼错、YAML 方言不对、值类型不对），
 * 症状是"插件照常加载但功能没开"，很难从界面上看出来。所以这里做两件事：
 *
 *   1. 用**宿主自己的** YAML 方言解析，取出 `@local/dsh-computer-use` 这一行的 `config`；
 *   2. 把这份 config **原样**喂给 `apply()`，用假后端 + 假 helper 跑一次写操作 —— 断言覆盖层真的
 *      被拉起来（`beginScope` 出现在 helper 的命令日志里），而不是"配置里写了却没生效"。
 *
 *   node patch-config-applies-test.mjs
 */
import { registerHooks } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolveAppNodeModules } from './tests/host-app.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE_HELPER = join(HERE, 'tests', 'fake-indicator.mjs');

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* -------------------------------------------------- 1. parse with the host dialect -- */

const yamlPath = join(resolveAppNodeModules('js-yaml/index.js'), 'js-yaml', 'index.js');
const yaml = await import(pathToFileURL(yamlPath).href);
const source = readFileSync(join(HERE, 'cordis.patch.yml'), 'utf8');
let document = null;
try {
  document = yaml.default.load(source, { schema: yaml.default.JSON_SCHEMA });
} catch (error) {
  check('cordis.patch.yml parses', false, String(error?.message ?? error));
}

check('the patch parses as a YAML sequence', Array.isArray(document), typeof document);

/** 找到本插件那一行（任意嵌套深度）。 */
function findRow(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRow(item);
      if (found !== null) return found;
    }
    return null;
  }
  if (value === null || typeof value !== 'object') return null;
  if (value.name === '@local/dsh-computer-use') return value;
  for (const child of Object.values(value)) {
    const found = findRow(child);
    if (found !== null) return found;
  }
  return null;
}

const row = findRow(document);
check('the plugin row is present exactly once', (JSON.stringify(document).match(/"@local\/dsh-computer-use"/g) ?? []).length === 1, 'multiple rows would double-register routes');
const config = row?.config ?? {};
check('the row carries a config', typeof config === 'object' && config !== null, typeof config);

/* ------------------------------------------------------ 2. the flip is actually on -- */

check('the overlay is enabled by default', config.interactionIndicator?.enabled === true, JSON.stringify(config.interactionIndicator));
check('exePath is left empty so the package path is used', config.interactionIndicator?.exePath === '', JSON.stringify(config.interactionIndicator?.exePath));
check('visual effects are on', config.visualEffects?.enabled === true, JSON.stringify(config.visualEffects));
check('the banner character is on (verified on screen)', config.visualEffects?.bannerCharacter === true, JSON.stringify(config.visualEffects));
check('the cursor character is on (pixel-verified on the real helper)', config.visualEffects?.cursorCharacter === true, JSON.stringify(config.visualEffects));
check('computer control still starts off per session', config.defaultEnabled === false, String(config.defaultEnabled));

/* -------------------------------------- 3. that config really starts the overlay -- */

const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-patch-'));
const toolsStub = join(shimDir, 'tools-stub.mjs');
const bridgeStub = join(shimDir, 'bridge-stub.mjs');
writeFileSync(toolsStub, 'export const defineTool = (definition) => definition;\n');
writeFileSync(bridgeStub, `
export class ComputerUseBackendError extends Error {
  constructor(message, code) { super(message); this.name = 'ComputerUseBackendError'; this.code = code; }
}
export class PowerShellBackend {
  constructor() { this.info = { dpi: 'per-monitor-v2', screens: [{ index: 0, deviceName: 'DISPLAY1', primary: true, x: 0, y: 0, width: 1920, height: 1080 }], virtual: { x: 0, y: 0, width: 1920, height: 1080 }, pid: 1, version: 'stub' }; }
  get alive() { return true; }
  async start() { return this.info; }
  async request(cmd) {
    if (cmd === 'health') return { interactive: true, foregroundHwnd: 42, foregroundTitle: 'Stub', note: 'ok' };
    if (cmd === 'ping') return { ready: true, dpi: 'per-monitor-v2', screens: this.info.screens, virtual: this.info.virtual, cursor: { x: 1, y: 1 } };
    return {};
  }
  async dispose() {}
}
`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: pathToFileURL(toolsStub).href, shortCircuit: true };
    if (specifier === './backend/bridge.js' || specifier.endsWith('/backend/bridge.js')) return { url: pathToFileURL(bridgeStub).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const logPath = join(shimDir, 'helper.log');
writeFileSync(logPath, '', 'utf8');
const plugin = await import(`./index.js?patch=${Date.now()}`);
const tools = new Map();
const routes = new Map();
const services = { webServer: { register: (definition) => { routes.set(definition.path, definition); return () => {}; } } };
const ctx = {
  tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
  webServer: services.webServer,
  on: () => {},
  effect: (fn) => { const disposer = fn(); return () => { if (typeof disposer === 'function') disposer(); }; },
  inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx); return () => {}; },
  get: (name) => services[name],
  logger: { info: () => {}, warn: () => {}, error: () => {} },
};
// 用真实的那份 config，只把 spawn 换成本地 helper（否则会去起真实的 exe）。
const applied = { ...config, interactionIndicator: { ...config.interactionIndicator, spawn: () => spawn(process.execPath, [FAKE_HELPER], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, FAKE_LOG: logPath } }) }, shotDir: join(shimDir, 'shots') };
plugin.apply(ctx, applied);
check('apply does not throw with the shipped config', tools.size === 18, String(tools.size));

// 状态路由里现在带 `indicator` 字段：配置有没有真的把覆盖层打开，看它就够，不必先发一次写。
{
  const handler = routes.get('/computer-use/status')?.handler;
  const res = { status: 0, body: '', writeHead(code) { this.status = code; }, end(text) { this.body += text ?? ''; } };
  handler({ method: 'GET', url: '/computer-use/status' }, res);
  const payload = JSON.parse(res.body);
  check('the status route reports the overlay switch', payload.indicator?.enabled === true, JSON.stringify(payload.indicator));
  // exePath: '' 必须解析成包内那一份；否则 helper 会被判成没构建，覆盖层永远不出现。
  check('an empty exePath resolves to the packaged helper', /native[\\/]indicator-helper[\\/]build[\\/]dsh-interaction-indicator\.exe$/.test(String(payload.indicator?.helper?.path ?? '')), String(payload.indicator?.helper?.path));
  check('and no helper is running before the first write', payload.indicator?.state === 'absent', JSON.stringify(payload.indicator));
}

const exec = { agent: { session: { id: 'patch-session' } }, signal: undefined };
// defaultEnabled 为 false：这里只验**授权路由**能把会话打开；"写操作 → 覆盖层就绪"那条链路由
// indicator-integration-test 用完整夹具验证（本文件的假后端回复不足以走到那一步，硬凑只会测出假象）。
{
  const handler = routes.get('/computer-use/state')?.handler;
  check('the state route is available to grant the session', typeof handler === 'function', [...routes.keys()].join(', '));
  const body = Buffer.from(JSON.stringify({ sessionId: 'patch-session', enabled: true }), 'utf8');
  const req = { method: 'POST', url: '/computer-use/state', async *[Symbol.asyncIterator]() { yield body; } };
  const res = { status: 0, body: '', writeHead(code) { this.status = code; }, end(text) { this.body += text ?? ''; } };
  await handler(req, res);
  const payload = JSON.parse(res.body);
  check('granting the session through the route succeeds', payload.ok === true && payload.enabled === true, JSON.stringify({ ok: payload.ok, enabled: payload.enabled }));
  check('and the overlay switch survives the grant', payload.indicator?.enabled === true, JSON.stringify(payload.indicator));
  check('the grant did not leave a helper running', payload.indicator?.state === 'absent', JSON.stringify(payload.indicator));
}
check('the tools still register 18 entries with the shipped config', tools.size === 18, String(tools.size));
void exec;

rmSync(shimDir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
