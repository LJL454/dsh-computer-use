/**
 * 合并后的挂载契约测试：用**与 profile 里完全相同的配置形状**挂一次，验证三件事都在。
 *
 * 为什么单独有这一条：三个能力合并到一个插件后，profile 只留一个行，配置变成嵌套的
 * `tokenGuard` / `appLaunch` 段。原插件各自的测试覆盖的是"配置直接摊在顶层"的旧形状，
 * 这条测的是**部署真实用的那种形状**，并顺手把 app-launch 的审计工具跑通一遍
 * （它不需要图形界面，因此在任何环境下都能跑）。
 *
 *   node merge-mount-test.mjs
 */
import { registerHooks } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-merge-'));
const stub = join(shimDir, 'stub.mjs');
writeFileSync(stub, 'export const defineTool = (definition) => definition;\n');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: pathToFileURL(stub).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); }
  else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}

// profile 里那一段的原样形状（见 dsh-computer-use/cordis.patch.yml）。
const PROFILE_CONFIG = {
  defaultEnabled: false,
  tokenGuard: {
    enabled: true,
    tools: ['pwsh'],
    normalMaxTokens: 800,
    troubleshootingMaxTokens: 2000,
    skipImageResults: true,
    keepFullOutput: true,
    fullOutputDir: '',
    metrics: true,
    metricsPath: '',
  },
  appLaunch: { enabled: true, defaultWaitMs: 6000, detach: true },
};

const tools = new Map();
const listeners = new Map();
const ctx = {
  tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
  on: (event, handler) => { listeners.set(event, handler); },
  get: () => undefined,
  effect: (fn) => { const disposer = fn(); return () => { if (typeof disposer === 'function') disposer(); }; },
  inject: (deps, callback) => { callback(ctx); return () => {}; },
  logger: { info: () => {}, warn: (message) => console.log(`  [warn] ${message}`) },
  webServer: { register: () => () => {} },
};

try {
  const plugin = await import('./index.js');
  plugin.apply(ctx, PROFILE_CONFIG);

  check('一个插件行提供全部三种能力的工具面', tools.size === 18, `${tools.size} 个工具`);
  check('token-guard 的压缩钩子挂上了', typeof listeners.get('tools/post-execute') === 'function');
  check('app-launch 的两个工具在位', tools.has('app_launch') && tools.has('app_env_audit'),
    [...tools.keys()].filter((name) => name.startsWith('app_')).join(', '));
  check('电脑操作工具面不受影响', tools.has('computer_ui') && tools.has('computer_screenshot') && tools.has('browser_state'));

  // app_env_audit 不需要图形界面，能在任何环境跑通 —— 用它证明 app-launch 的代码路径真的可用。
  const exec = { agent: { session: { id: 'merge-mount' } }, signal: undefined };
  const audit = await tools.get('app_env_audit').execute({}, exec);
  check('审计工具返回了结论', typeof audit?.sessionIsPolluted === 'boolean', JSON.stringify(audit).slice(0, 120));
  check('审计工具说出了要摘哪些变量', Array.isArray(audit?.wouldStrip) && audit.wouldStrip.length > 0,
    JSON.stringify(audit?.wouldStrip ?? []).slice(0, 120));
  check('它确实看到了本会话的 Electron 注入变量',
    audit?.present?.some?.((row) => row.name === 'ELECTRON_RUN_AS_NODE') === true,
    JSON.stringify((audit?.present ?? []).map((row) => row.name)));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) for (const failure of failures) console.log(`  - ${failure}`);
} catch (error) {
  console.error('merge-mount-test crashed:', error);
  process.exitCode = 1;
} finally {
  try { rmSync(shimDir, { recursive: true, force: true }); } catch { /* best effort */ }
  if (failures.length > 0) process.exitCode = 1;
  setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref();
}
