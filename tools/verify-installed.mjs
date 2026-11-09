/**
 * 安装后自检：从**现役安装路径**（profile 的符号链接指向的真实目录）加载插件。
 *
 * 与 `rehearsal-install-test.mjs` 的区别：演练用临时目录，这份用真实路径 —— 它回答的是
 * "现在这台机器上装着的这份，能不能被宿主加载"。它只读，不改动任何东西。
 *
 * 用法：
 *   node tools/verify-installed.mjs [--root <package root>]
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
export const DEFAULT_ROOT = rootIndex >= 0 && args[rootIndex + 1] !== undefined
  ? args[rootIndex + 1]
  : 'E:\\inkos\\dsh-plugins\\dsh-computer-use';

export const EXPECTED_TOOLS = 18;
/** 1.40.3 起就有的四条路由：任何版本都必须注册。 */
export const CORE_ROUTES = [
  '/computer-use/status',
  '/computer-use/state',
  '/computer-use/probe',
  '/computer-use/doctor',
];

/**
 * 这个安装应该有哪些可选路由 —— 由**包里有哪些文件**决定。
 *
 * 同一个脚本因此既能验新装，也能验回滚目标：回滚到 1.40.3 时它本来就没有 `/visual-preferences`
 * 与 `/modules`，不该因为"没有新功能"被判失败。
 *
 * @param root - package root.
 * @returns 期望注册的路由列表。
 */
export function expectedRoutes(root = DEFAULT_ROOT) {
  const expected = [...CORE_ROUTES];
  if (existsSync(join(root, 'internal', 'visual-preferences.mjs'))) expected.push('/computer-use/visual-preferences');
  if (existsSync(join(root, 'internal', 'module-host.mjs'))) expected.push('/computer-use/modules');
  return expected;
}

/**
 * 从一个安装根目录加载插件并列出它注册了什么。
 * @param root - package root（真实安装目录）。
 * @returns `{ ok, version, tools, routes, problems }`。
 */
export async function verifyInstalled(root = DEFAULT_ROOT) {
  const problems = [];
  const manifestPath = join(root, 'package.json');
  if (!existsSync(manifestPath)) return { ok: false, version: null, tools: [], routes: [], problems: ['package.json is missing'] };
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
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
  try {
    const plugin = await import(pathToFileURL(join(root, 'index.js')).href);
    plugin.apply(ctx, { defaultEnabled: false, shotDir: join(root, '.verify-shots') });
  } catch (error) {
    problems.push(`apply threw: ${String(error?.message ?? error)}`);
  }
  if (tools.size !== EXPECTED_TOOLS) problems.push(`expected ${EXPECTED_TOOLS} tools, registered ${tools.size}`);
  for (const route of expectedRoutes(root)) {
    if (!routes.has(route)) problems.push(`route ${route} is not registered`);
  }
  return { ok: problems.length === 0, version: manifest.version, tools: [...tools.keys()], routes: [...routes.keys()], problems };
}

const isMain = process.argv[1] !== undefined && /verify-installed\.mjs$/.test(process.argv[1]);
if (isMain) {
  const report = await verifyInstalled(DEFAULT_ROOT);
  console.log(`root      ${DEFAULT_ROOT}`);
  console.log(`version   ${report.version}`);
  console.log(`tools     ${report.tools.length}`);
  console.log(`routes    ${report.routes.length}: ${report.routes.join(', ')}`);
  if (report.ok) {
    console.log('OK  the installed plugin loads and registers everything it declares');
    process.exit(0);
  }
  for (const problem of report.problems) console.error(`FAIL  ${problem}`);
  process.exit(1);
}
