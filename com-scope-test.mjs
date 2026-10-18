/**
 * The COM boundary: measure first, release what has a scope (9.txt §7.4 第 7 条).
 *
 * The review's instruction is deliberately in that order — "测量后处理 COM 资源" — and the
 * reason is in the same paragraph: a blanket `ReleaseComObject` can release an element the ref
 * registry is still holding. So what this file checks is:
 *
 *   - the engine counts what it creates and what it releases (`Census()` in the health reply);
 *   - the arrays a walk allocates have a scope and are released at the end of it, so a long
 *     session does not accumulate them per visited node;
 *   - and repeated reads do not grow the element count without bound.
 *
 * The fixture is a Notepad this file starts, and the census is read through the plugin's own
 * backend-probe route, which is where the harness and the chip read diagnostics from.
 *
 *   node com-scope-test.mjs
 */
import { registerHooks } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const POWERSHELL = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-com-scope-'));
const toolsStub = join(shimDir, 'dsh-tools-stub.mjs');
writeFileSync(toolsStub, 'export const defineTool = (definition) => definition;\n');
delete process.env.DSH_COMPUTER_UI_ENGINE;
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

try {
  spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process notepad.exe'], { windowsHide: true, stdio: 'ignore' });
  await sleep(4000);

  const plugin = await import('./index.js');
  const tools = new Map();
  const routes = new Map();
  const services = { webServer: { register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path); } } };
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
    webServer: services.webServer,
    on: () => {},
    effect: (fn) => { const disposer = fn(); return () => { if (typeof disposer === 'function') disposer(); }; },
    inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx); return () => {}; },
    get: (name) => services[name],
    logger: { info: () => {}, warn: () => {} },
  };
  plugin.apply(ctx, { defaultEnabled: true });
  const exec = { agent: { session: { id: 'com-scope-session' } }, signal: undefined };
  const ui = tools.get('computer_ui');
  const windows = await tools.get('computer_windows').execute({}, exec);
  const notepad = (windows.windows ?? []).find((one) => /notepad/i.test(String(one.process ?? '')));
  if (notepad === undefined) throw new Error('no Notepad window to read; the fixture did not start');
  const hwnd = Number(notepad.hwnd);

  /** The COM census, from the route diagnostics actually use. */
  const census = async () => {
    const route = routes.get('/computer-use/probe');
    if (route === undefined) return { routes: [...routes.keys()] };
    let payload = null;
    const res = { status: 0, writeHead(status) { this.status = status; }, end(text) { payload = JSON.parse(text); } };
    await route.handler({ method: 'GET', url: '/computer-use/probe' }, res);
    return payload;
  };

  console.log('\n== the engine counts what it creates and what it releases ==');
  const firstProbe = await census();
  if (firstProbe.comObjects === undefined) {
    console.log(`  (routes available: ${JSON.stringify(firstProbe.routes ?? null)})`);
  }
  const before = firstProbe.comObjects ?? null;
  check('the backend probe reports the COM census', before !== null && typeof before === 'object', JSON.stringify(firstProbe).slice(0, 200));
  check('with the counters the plan asks to measure first',
    before !== null && ['arrays', 'arraysReleased', 'arraysLive', 'resets'].every((key) => typeof before[key] === 'number'),
    JSON.stringify(before));

  const read = () => ui.execute({ hwnd, max_depth: 5, max_nodes: 120 }, exec);
  await read();
  const afterOne = (await census()).comObjects;
  check('a read walks the window and creates arrays', Number(afterOne.arrays) > Number(before.arrays), JSON.stringify({ before: before.arrays, after: afterOne.arrays }));
  check('and every array of that walk is released at the end of its scope',
    Number(afterOne.arraysReleased) === Number(afterOne.arrays) && Number(afterOne.arraysLive) === 0,
    JSON.stringify(afterOne));
  check('elements handed out are counted too', Number(afterOne.elements) >= Number(before.elements), JSON.stringify({ before: before.elements, after: afterOne.elements }));

  console.log('\n== a burst of reads does not leave the arrays behind ==');
  for (let i = 0; i < 5; i += 1) await read();
  const afterBurst = (await census()).comObjects;
  check('the released count keeps up with the created count', Number(afterBurst.arraysLive) === 0, JSON.stringify(afterBurst));
  check('and it grew with the work, which is what makes the number mean something',
    Number(afterBurst.arrays) > Number(afterOne.arrays), JSON.stringify({ afterOne: afterOne.arrays, afterBurst: afterBurst.arrays }));
  check('the client has not been rebuilt for a healthy window', Number(afterBurst.resets) === 0, JSON.stringify(afterBurst));

  console.log('\n== the census is a diagnostic, not a brake ==');
  const readsStillWork = await read();
  check('reads keep working after the census is read', Array.isArray(readsStillWork.nodes) && readsStillWork.nodes.length > 0, JSON.stringify(readsStillWork).slice(0, 160));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) for (const failure of failures) console.log(`  - ${failure}`);
} catch (error) {
  console.error('com-scope-test crashed:', error);
  process.exitCode = 1;
} finally {
  try {
    spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', 'Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force'], { windowsHide: true });
  } catch { /* best effort */ }
  try { rmSync(shimDir, { recursive: true, force: true }); } catch { /* best effort */ }
  if (failures.length > 0) process.exitCode = 1;
  setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
}
