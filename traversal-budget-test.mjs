/**
 * The traversal budget and the node budget are two different questions (9.txt §7.4 第 2 条).
 *
 * `max_nodes` bounds how many *rows* come back. It never bounded how many nodes the walk
 * *looked at*: a tree of anonymous containers, dropped one by one by `skip_empty`, grows the
 * traversal without ever filling the output budget. The fix is a separate visit budget with
 * two properties this file checks against a real window:
 *
 *   - a normal read reports what it cost (`visited`, `maxQueue`, `visitBudget`) and is *not*
 *     marked truncated because of it — the default must not silently shorten existing reads;
 *   - a read given a small explicit `max_visited` stops on the traversal budget and says so
 *     (`traversalTruncated` + `truncated`), with a marker the caller can act on rather than a
 *     quietly shorter tree;
 *   - `max_visited: 0` means no limit again.
 *
 * The fixture is a Notepad this file starts, so the numbers come from a real UI Automation
 * provider. The engine under test is the default COM one, and `--managed` runs the same
 * assertions against the managed fallback.
 *
 *   node traversal-budget-test.mjs [--managed]
 */
import { registerHooks } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const POWERSHELL = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const MODE = process.argv.includes('--managed') ? 'managed' : 'com';
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-traverse-shim-'));
const toolsStub = join(shimDir, 'dsh-tools-stub.mjs');
writeFileSync(toolsStub, 'export const defineTool = (definition) => definition;\n');
process.env.DSH_COMPUTER_UI_ENGINE = MODE;
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
  const services = { webServer: { register: () => () => {} } };
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
  const exec = { agent: { session: { id: 'traversal-budget-session' } }, signal: undefined };
  const ui = tools.get('computer_ui');
  const windows = await tools.get('computer_windows').execute({}, exec);
  const notepad = (windows.windows ?? []).find((one) => /notepad/i.test(String(one.process ?? '')));
  if (notepad === undefined) throw new Error('no Notepad window to read; the fixture did not start');
  const hwnd = Number(notepad.hwnd);
  console.log(`engine under test: ${MODE}`);

  console.log('\n== a normal read reports its cost and is not shortened by it ==');
  const normal = await ui.execute({ hwnd, max_depth: 4, max_nodes: 40 }, exec);
  check('the read returns nodes', Array.isArray(normal.nodes) && normal.nodes.length > 0, JSON.stringify(normal).slice(0, 200));
  check('it reports a traversal block', normal.traversal !== undefined && typeof normal.traversal === 'object', JSON.stringify(normal.traversal ?? null));
  check('the traversal says how many nodes it looked at', Number(normal.traversal?.visited ?? -1) >= (normal.nodes?.length ?? 0), JSON.stringify({ visited: normal.traversal?.visited, rows: normal.nodes?.length }));
  check('and how long the queue ever got', Number(normal.traversal?.maxQueue ?? -1) >= 1, JSON.stringify(normal.traversal));
  check('the default budget is not exceeded and nothing is marked truncated by it', normal.traversal?.traversalTruncated !== true, JSON.stringify(normal.traversal));
  check('the derived budget is reported', Number(normal.traversal?.visitBudget ?? -1) > 0, JSON.stringify(normal.traversal));
  check('and the traversal time is measured', Number(normal.traversal?.elapsedMs ?? -1) >= 0, JSON.stringify(normal.traversal));

  console.log('\n== the retry cost of one read is a number, and it is bounded (§7.4 第 5 条) ==');
  check('the read reports how many traversals it took', Number(normal.traversal?.walks ?? 0) >= 1, JSON.stringify(normal.traversal));
  check('and the cap those traversals are held to', Number(normal.traversal?.walkCap ?? 0) >= 1, JSON.stringify(normal.traversal));
  check('the traversals stay inside the cap', Number(normal.traversal.walks) <= Number(normal.traversal.walkCap), JSON.stringify(normal.traversal));
  check('health probes are counted, not free', Number(normal.traversal?.healthProbes ?? -1) >= 0, JSON.stringify(normal.traversal));
  check('and client re-creations are counted', Number(normal.traversal?.resets ?? -1) >= 0, JSON.stringify(normal.traversal));
  check('a plain read of a healthy window takes exactly one traversal',
    Number(normal.traversal.walks) === 1 && Number(normal.traversal.resets) === 0,
    JSON.stringify({ walks: normal.traversal.walks, resets: normal.traversal.resets }));
  check('and then the extra-cost marker is not shown', !/needed \d+ traversals/.test(String(tools.get('computer_ui').output.render({ compact: false }, normal)?.map((block) => block.text).join('\n') ?? '')), 'marker appeared for a single-traversal read');

  console.log('\n== a search says its counts are provider-side, not zero because nothing happened ==');
  const search = await ui.execute({ hwnd, name: String(normal.nodes[0]?.name ?? '').slice(0, 8), max_depth: 4, max_nodes: 20 }, exec);
  check('a search reports the provider-side flag', search.traversal?.providerSide === true, JSON.stringify(search.traversal ?? null));

  console.log('\n== a small traversal budget stops the walk and says so ==');
  const capped = await ui.execute({ hwnd, max_depth: 4, max_nodes: 40, max_visited: 3 }, exec);
  check('the walk stopped at the traversal budget', capped.traversal?.traversalTruncated === true, JSON.stringify(capped.traversal ?? null));
  check('and it says the result is partial', capped.truncated === true, JSON.stringify({ truncated: capped.truncated, traversal: capped.traversal }));
  check('it visited about as many nodes as it was allowed', Number(capped.traversal?.visited ?? 0) <= 4, JSON.stringify(capped.traversal));
  check('it returned fewer rows than the node budget allowed', Number(capped.nodes?.length ?? 99) < 40, JSON.stringify({ rows: capped.nodes?.length }));
  const marker = String(tools.get('computer_ui').output.render({ compact: false }, capped)?.map((block) => block.text).join('\n') ?? '');
  check('the render tells the caller what to do about it', /traversal/i.test(marker) && /max_visited/.test(marker), marker.slice(-260));

  console.log('\n== max_visited: 0 means no limit again ==');
  const unlimited = await ui.execute({ hwnd, max_depth: 4, max_nodes: 40, max_visited: 0 }, exec);
  check('an unlimited read is not traversal-truncated', unlimited.traversal?.traversalTruncated !== true, JSON.stringify(unlimited.traversal ?? null));
  check('and it reports the unlimited budget as 0', Number(unlimited.traversal?.visitBudget ?? -1) === 0, JSON.stringify(unlimited.traversal ?? null));
  check('it returns at least as many rows as the capped read', Number(unlimited.nodes?.length ?? 0) >= Number(capped.nodes?.length ?? 0), JSON.stringify({ capped: capped.nodes?.length, unlimited: unlimited.nodes?.length }));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) for (const failure of failures) console.log(`  - ${failure}`);
} catch (error) {
  console.error('traversal-budget-test crashed:', error);
  process.exitCode = 1;
} finally {
  try {
    spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', 'Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force'], { windowsHide: true });
  } catch { /* best effort */ }
  try { rmSync(shimDir, { recursive: true, force: true }); } catch { /* best effort */ }
  if (failures.length > 0) process.exitCode = 1;
  setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
}
