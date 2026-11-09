/**
 * 覆盖层开启之后，**缺件不能拦住电脑操作**（O6 翻转的安全属性）。
 *
 * 第 31 轮把 `interactionIndicator.enabled` 翻成 true 出厂值。由此多出一条必须成立的性质：
 *
 *   * helper 没构建 / 路径写错  → 降级，写操作照常执行（"覆盖层是提示能力，缺它不该让电脑操作瘫痪"）；
 *   * helper 构建了但说自己没就绪 → 拒绝，且桌面零写入（"无法确认覆盖层可见时暂停新的交互写入"）。
 *
 * 这两条在代码里是分开的分支，但只有把它们放在一起测，才能确认"翻默认值"没有把第一种情况变成第二种——
 * 那会让用户在 helper 被删掉或杀软隔离之后突然连点击都做不了。
 *
 *   node overlay-degradation-test.mjs
 */
import { registerHooks } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-degrade-'));
const toolsStub = join(shimDir, 'tools-stub.mjs');
const bridgeStub = join(shimDir, 'bridge-stub.mjs');
writeFileSync(toolsStub, 'export const defineTool = (definition) => definition;\n');
writeFileSync(bridgeStub, `
export class ComputerUseBackendError extends Error {
  constructor(message, code) { super(message); this.name = 'ComputerUseBackendError'; this.code = code; }
}
export class PowerShellBackend {
  constructor() {
    this.info = { dpi: 'per-monitor-v2', screens: [{ index: 0, deviceName: 'DISPLAY1', primary: true, x: 0, y: 0, width: 1920, height: 1080 }], virtual: { x: 0, y: 0, width: 1920, height: 1080 }, pid: 1, version: 'stub' };
    this.dispatched = [];
  }
  get alive() { return true; }
  async start() { return this.info; }
  async request(cmd, args) {
    if (cmd === 'health') return { interactive: true, foregroundHwnd: 42, foregroundTitle: 'Stub', note: 'ok' };
    if (cmd === 'ping') return { ready: true, dpi: 'per-monitor-v2', screens: this.info.screens, virtual: this.info.virtual, cursor: { x: 1, y: 1 } };
    this.dispatched.push(cmd);
    globalThis.__degradeDispatched = this.dispatched;
    return { typed: 5 };
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

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}

/** Mounts one isolated plugin instance with its own tool registry. */
async function mount(config, tag) {
  const plugin = await import(`./index.js?degrade=${tag}`);
  const tools = new Map();
  const services = { webServer: { register: () => () => {} } };
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
    webServer: services.webServer,
    on: () => {},
    effect: (fn) => { const disposer = fn(); return () => { if (typeof disposer === 'function') disposer(); }; },
    inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx); return () => {}; },
    get: (name) => services[name],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
  plugin.apply(ctx, { defaultEnabled: true, shotDir: join(shimDir, `shots-${tag}`), ...config });
  return tools;
}

const exec = { agent: { session: { id: 'degrade-session' } }, signal: undefined };

console.log('\n== a missing helper degrades instead of blocking the write ==');
{
  globalThis.__degradeDispatched = [];
  const tools = await mount({
    interactionIndicator: { enabled: true, exePath: join(shimDir, 'does-not-exist.exe') },
  }, 'missing');
  let error = null;
  let value = null;
  try {
    value = await tools.get('computer_type').execute({ text: 'hello' }, exec);
  } catch (caught) {
    error = caught;
  }
  check('the write is not refused', error === null, String(error?.message ?? ''));
  check('the backend actually received the type', globalThis.__degradeDispatched.includes('type'), JSON.stringify(globalThis.__degradeDispatched));
  check('the tool returns a real value', value !== null && typeof value === 'object', JSON.stringify(value));
}

console.log('\n== a built-but-not-ready helper refuses, and writes nothing ==');
{
  globalThis.__degradeDispatched = [];
  // 这个"exe"存在但不会说协议：它一启动就退出，于是 beginScope 等不到 scopeReady。
  const brokenHelper = join(shimDir, 'broken-helper.exe');
  writeFileSync(brokenHelper, 'this is not a program\n', 'utf8');
  const tools = await mount({
    interactionIndicator: {
      enabled: true,
      exePath: brokenHelper,
      // 用 node 跑一个立刻退出的脚本，模拟"起来了但没就绪"。
      spawn: () => {
        const { spawn } = globalThis.__spawnForTest;
        return spawn(process.execPath, ['-e', 'process.exit(9)'], { stdio: ['pipe', 'pipe', 'pipe'] });
      },
    },
  }, 'broken');
  globalThis.__spawnForTest = await import('node:child_process');
  let error = null;
  try {
    await tools.get('computer_type').execute({ text: 'nope' }, exec);
  } catch (caught) {
    error = caught;
  }
  check('the write is refused', error !== null, String(error?.message ?? '(no error)'));
  check('the refusal names the overlay', /overlay|indicator/i.test(String(error?.message ?? '')), String(error?.message ?? ''));
  // 只数**输入类**命令：release/cancel 是停止路径的正常动作，不算"写进桌面"。
  const inputCommands = globalThis.__degradeDispatched.filter((cmd) => !['release', 'cancel', 'health', 'ping', 'state'].includes(cmd));
  check('and no input reached the desktop', inputCommands.length === 0, JSON.stringify(inputCommands));
  check('the recovery did not loop: releases stay bounded', globalThis.__degradeDispatched.filter((cmd) => cmd === 'release').length <= 3, String(globalThis.__degradeDispatched.filter((cmd) => cmd === 'release').length));
}

rmSync(shimDir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
