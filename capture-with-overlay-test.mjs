/**
 * O2 端到端 —— 截图工具与覆盖层**同时开着**（方案 4.17.1）。
 *
 * 协调器（`internal/capture-exclusion.mjs`）与 supervisor 各自有测试，缺的是它们中间那一段：
 * `capture()` 真的在覆盖层活动时发 `suspendVisual`、结束发 `resumeVisual`，而不活动时一条都不发。
 *
 * 做法：假后端（截图真的写一张 PNG）+ 假 helper（把收到的命令逐行记进文件）+ 真实工具调用。
 * 为了让覆盖层在截图期间确实处于活动状态，先发起一个**写**（`computer_actions` 的 move，后端故意慢
 * 300ms），在它还没返回时截图 —— 这 300ms 里 scope 是开着的。写本身的回复不重要，会被吞掉。
 *
 *   node capture-with-overlay-test.mjs
 */
import { registerHooks } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE_HELPER = join(HERE, 'tests', 'fake-indicator.mjs');
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-capture-'));
const toolsStub = join(shimDir, 'dsh-tools-stub.mjs');
const bridgeStub = join(shimDir, 'bridge-stub.mjs');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

writeFileSync(toolsStub, 'export const defineTool = (definition) => definition;\n');
writeFileSync(bridgeStub, `
import { writeFileSync } from 'node:fs';

export class ComputerUseBackendError extends Error {
  constructor(message, code) { super(message); this.name = 'ComputerUseBackendError'; this.code = code; }
}

const SCREENS = [{ index: 0, deviceName: '\\\\\\\\.\\\\DISPLAY1', primary: true, x: 0, y: 0, width: 2560, height: 1440 }];
const PIXEL = Buffer.from('${PNG}', 'base64');

export class PowerShellBackend {
  constructor() {
    this.info = { dpi: 'per-monitor-v2', screens: SCREENS, virtual: { x: 0, y: 0, width: 2560, height: 1440 }, pid: 1, version: 'stub' };
    this.calls = [];
  }
  get alive() { return true; }
  async start() { return this.info; }
  async request(cmd, args) {
    this.calls.push(cmd);
    globalThis.__cuStubCalls.push({ cmd, args: JSON.parse(JSON.stringify(args ?? {})) });
    if (cmd === 'health') return { interactive: true, foregroundHwnd: 42, foregroundTitle: 'Stub', note: 'ok' };
    if (cmd === 'ping') return { ready: true, dpi: 'per-monitor-v2', screens: SCREENS, virtual: this.info.virtual, cursor: { x: 10, y: 20 } };
    if (cmd === 'screenshot') {
      writeFileSync(args.path, PIXEL);
      return { path: args.path, x: 0, y: 0, width: 2560, height: 1440, scale: args.scale ?? 1, format: args.format ?? 'png',
               bytes: 68, settledMs: 10, stability: { stable: true, polls: 2, waitedMs: 10 },
               screens: SCREENS, virtual: this.info.virtual, cursor: { x: 10, y: 20 }, foreground: { hwnd: 42, title: 'Stub' } };
    }
    if (cmd === 'type' || cmd === 'batch') {
      // 慢一点：覆盖层要在这段时间里保持活动，截图才落在"覆盖层开着"的窗口内。
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { typed: String(args?.text ?? '').length, performed: ['type'], steps: [] };
    }
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

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Builds a fresh plugin instance with its own tool registry and its own fake helper log. */
async function mount({ indicatorEnabled }) {
  const logPath = join(shimDir, `helper-${indicatorEnabled ? 'on' : 'off'}.log`);
  writeFileSync(logPath, '', 'utf8');
  globalThis.__cuStubCalls = [];
  const plugin = await import(`./index.js?instance=${indicatorEnabled ? 'on' : 'off'}`);
  const tools = new Map();
  const services = {
    webServer: { register: () => () => {} },
    attachments: {
      saveImages: async (inputs) => inputs.map((input) => ({
        attachmentId: `sha256:${'a'.repeat(64)}`, mediaType: input.mediaType, bytes: input.data.byteLength, width: 2560, height: 1440,
      })),
    },
  };
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
    webServer: services.webServer,
    effect: (fn) => { const disposer = fn(); return () => { if (typeof disposer === 'function') disposer(); }; },
    inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx); return () => {}; },
    get: (name) => services[name],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
  plugin.apply(ctx, {
    defaultEnabled: true,
    shotDir: join(shimDir, 'shots'),
    interactionIndicator: {
      enabled: indicatorEnabled,
      exePath: FAKE_HELPER,
      spawn: () => spawn(process.execPath, [FAKE_HELPER], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, FAKE_LOG: logPath } }),
    },
  });
  return { tools, logPath, ctx };
}

/** Runs one tool by name the way the host does, with a session id. */
async function run(tools, name, args) {
  const definition = tools.get(name);
  const exec = { agent: { session: { id: 'session-a' } }, signal: undefined };
  return definition.execute(args, exec);
}

console.log('\n== with the overlay off, a capture sends it nothing ==');
{
  const { tools, logPath } = await mount({ indicatorEnabled: false });
  await run(tools, 'computer_screenshot', {});
  await sleep(150);
  const log = readFileSync(logPath, 'utf8').trim();
  check('the capture succeeded', true);
  check('no suspend/resume was sent', !/suspendVisual|resumeVisual/.test(log), log.replace(/\n/g, ' '));
}
rmSync(join(shimDir, 'shots'), { recursive: true, force: true });

console.log('\n== with the overlay on, the capture hides it and puts it back ==');
{
  const { tools, logPath } = await mount({ indicatorEnabled: true });
  // 先发起一个写：它会把 scope 打开，并在后端那边慢 300ms。
  const write = run(tools, 'computer_type', { text: 'hello' }).then((value) => value, (error) => ({ error }));
  // 等 scope 真的开起来（fake helper 回 scopeReady），再截图。
  for (let i = 0; i < 100; i += 1) {
    if (/beginScope/.test(readFileSync(logPath, 'utf8'))) break;
    await sleep(20);
  }
  let captureError = null;
  try {
    await run(tools, 'computer_screenshot', {});
  } catch (error) {
    captureError = error;
  }
  const writeResult = await write;
  if (writeResult?.error) console.log('  (note: the write returned', String(writeResult.error.message ?? writeResult.error).slice(0, 120), ')');
  await sleep(200);

  const log = readFileSync(logPath, 'utf8').trim().split('\n').filter((line) => line !== '');
  const index = (method) => log.indexOf(method);
  check('the capture succeeded while the overlay was up', captureError === null, String(captureError?.message));
  check('the scope was opened', index('beginScope') >= 0, log.join(' '));
  check('the overlay was suspended for the capture', index('suspendVisual') >= 0, log.join(' '));
  check('and resumed afterwards', index('resumeVisual') >= 0, log.join(' '));
  check('suspension happens before resumption', index('suspendVisual') < index('resumeVisual'), log.join(' '));
  check('nothing else was sent to the helper', log.filter((line) => !['hello', 'beginScope', 'updateState', 'setVisualPreferences', 'setCompanionPreferences', 'suspendVisual', 'resumeVisual', 'endScope', 'health'].includes(line)).length === 0, log.join(' '));
}
rmSync(shimDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
