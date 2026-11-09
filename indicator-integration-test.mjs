/**
 * PR10 —— 覆盖层接进插件（方案 4.15.2 派发顺序、4.16 物理 Esc）。
 *
 * 这一组用**真的 index.js**、一个可控的假 helper（`tests/fake-indicator.mjs`）和一个打桩的后端，
 * 验证三件事：
 *
 *   1. 写操作派发之前，覆盖层必须已经 `scopeReady`（两个 ready 都为真）；覆盖层说自己没就绪时，
 *      调用失败且**桌面零写入**；
 *   2. 派发顺序是"等覆盖层 → 再复核"：等待期间按下 Esc，那一行派发就不发生；
 *   3. Esc 之后闩锁生效：后续写调用一律被拒，直到用户明确把 电脑操作 关掉（唯一清除入口）。
 *
 *   node indicator-integration-test.mjs
 */
import { registerHooks } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { PowerShellBackend } from './backend/bridge.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, 'tests', 'fake-indicator.mjs');
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-indicator-int-'));
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

/* ---------------------------------------------------------- stubbed backend */

const dispatched = [];
const originalStart = PowerShellBackend.prototype.start;
const originalRequest = PowerShellBackend.prototype.request;
const originalDispose = PowerShellBackend.prototype.dispose;
const originalCancelAll = PowerShellBackend.prototype.cancelAll;
const originalCancelSession = PowerShellBackend.prototype.cancelSession;
let healthGate = null;

PowerShellBackend.prototype.start = async function start() { return {}; };
PowerShellBackend.prototype.dispose = function dispose() {};
PowerShellBackend.prototype.request = async function request(cmd) {
  if (cmd === 'health') {
    if (healthGate !== null) await healthGate;
    return { interactive: true, note: 'ok' };
  }
  if (cmd === 'release') return { released: ['mouse:left'], count: 1, note: 'released' };
  dispatched.push(cmd);
  return {};
};
PowerShellBackend.prototype.cancelAll = function cancelAll() { return 0; };
PowerShellBackend.prototype.cancelSession = function cancelSession() { return 0; };

const plugin = await import('./index.js');

/** Mount a fresh instance with the fake helper; returns the tool table and a disposer. */
function mount(env = {}) {
  const tools = new Map();
  const services = { webServer: { register: () => () => {} } };
  const disposers = [];
  const logs = [];
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
    webServer: services.webServer,
    on: () => {},
    effect: (fn) => { const disposer = fn(); disposers.push(disposer); return () => { if (typeof disposer === 'function') disposer(); }; },
    inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx); return () => {}; },
    get: (name) => services[name],
    logger: { info: (...args) => logs.push(args.join(' ')), warn: (...args) => logs.push(args.join(' ')), error: (...args) => logs.push(args.join(' ')) },
  };
  plugin.apply(ctx, {
    defaultEnabled: true,
    interactionIndicator: {
      enabled: true,
      exePath: FAKE,
      spawn: (_exe, _args, options) => spawn(process.execPath, [FAKE], { ...options, env: { ...process.env, ...env } }),
    },
  });
  const dispose = async () => {
    for (const fn of disposers) { try { fn(); } catch { /* ignore */ } }
    await sleep(150); // 让 helper 收窗、退出，再挂下一个实例
  };
  return { tools, dispose, logs };
}

console.log('\n== a write waits for the overlay before it is dispatched ==');
{
  dispatched.length = 0;
  const mounted = mount();
  const exec = { agent: { session: { id: 's-int-1' } }, signal: undefined };
  let firstError = null;
  try { await mounted.tools.get('computer_type').execute({ text: 'hello' }, exec); } catch (failure) { firstError = failure; }
  check('the write went through', firstError === null, String(firstError?.message));
  check('the backend actually saw the type', dispatched.includes('type'), JSON.stringify(dispatched));
  await mounted.dispose();
}

console.log('\n== an overlay that says "not ready" stops the write ==');
{
  dispatched.length = 0;
  const mounted = mount({ FAKE_SCOPE_READY: '0' });
  const exec = { agent: { session: { id: 's-int-1' } }, signal: undefined };
  let error = null;
  try {
    await mounted.tools.get('computer_type').execute({ text: 'nope' }, exec);
  } catch (failure) {
    error = failure;
  }
  check('the call fails', error !== null, String(error?.message));
  check('it says the overlay was not ready', /overlay is not ready/i.test(error?.message ?? ''), error?.message?.slice(0, 220));
  check('and nothing reached the desktop', !dispatched.includes('type'), JSON.stringify(dispatched));
  await mounted.dispose();
}

console.log('\n== Esc during the wait closes admission before the dispatch line ==');
{
  dispatched.length = 0;
  let releaseHealth = null;
  healthGate = new Promise((resolve) => { releaseHealth = () => resolve(); });
  const mounted = mount({ FAKE_ESC_BEFORE: '1' });
  const exec = { agent: { session: { id: 's-int-1' } }, signal: undefined };
  const typing = mounted.tools.get('computer_type').execute({ text: 'x' }, exec).then((value) => ({ value }), (error) => ({ error }));
  // helper 在 beginScope 之后立刻发 Esc；这里等它送到宿主，再放行健康检查。
  await sleep(500);
  releaseHealth();
  const outcome = await typing;
  healthGate = null;
  check('the call did not silently succeed', outcome.error !== undefined, JSON.stringify(outcome).slice(0, 160));
  check('it was refused by the Esc latch', /cancelled with Esc/i.test(outcome.error?.message ?? ''), outcome.error?.message?.slice(0, 220));
  check('and the desktop never saw the write', !dispatched.includes('type'), JSON.stringify(dispatched));

  // 换个会话读一下：读操作不抢租约，所以这里测的确实是闩锁本身。
  const other = { agent: { session: { id: 's-int-4' } }, signal: undefined };
  let second = null;
  try {
    await mounted.tools.get('computer_windows').execute({}, other);
  } catch (failure) {
    second = failure;
  }
  check('another session is refused too', second !== null && /cancelled with Esc/i.test(second.message), second?.message?.slice(0, 160));

  const stop = await mounted.tools.get('computer_stop').execute({ disable_capability: true }, exec);
  check('the user can turn the capability off', stop.disabled === true, JSON.stringify(stop));
  const after = await mounted.tools.get('computer_type').execute({ text: 'z' }, exec).then((value) => ({ value }), (error) => ({ error }));
  check('the latch no longer blocks after the user revokes', !/cancelled with Esc/i.test(after.error?.message ?? ''), after.error?.message?.slice(0, 160));
  await mounted.dispose();
}

PowerShellBackend.prototype.start = originalStart;
PowerShellBackend.prototype.request = originalRequest;
PowerShellBackend.prototype.dispose = originalDispose;
PowerShellBackend.prototype.cancelAll = originalCancelAll;
PowerShellBackend.prototype.cancelSession = originalCancelSession;
rmSync(shimDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
