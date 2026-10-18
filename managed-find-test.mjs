/**
 * A managed-engine *search* finishes like every other read (9.txt §6 第 1 条).
 *
 * The managed fallback has two branches -- a tree walk and a find -- and only the tree walk
 * went through `Complete-UiTree` / `Add-TextObservation`. The find branch returned its rows
 * straight out, so the same request answered differently depending on which engine happened to
 * serve it: no `snapshot`, no `ref` on any node, no pruning, no delta, no text observation. A
 * machine where COM works never shows any of that, which is why the engine is forced here.
 *
 * The fixture is a Notepad this file starts itself (a plain Win32 window the managed wrapper
 * can address on every build), and the selector is discovered from a managed tree read rather
 * than hard-coded, so the test does not depend on the shell's language.
 *
 *   node managed-find-test.mjs
 */
import { registerHooks } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const POWERSHELL = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-managed-shim-'));
const toolsStub = join(shimDir, 'dsh-tools-stub.mjs');
writeFileSync(toolsStub, 'export const defineTool = (definition) => definition;\n');
// The worker inherits this: the managed wrapper is the engine under test.
process.env.DSH_COMPUTER_UI_ENGINE = 'managed';
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
const killNotepad = () => {
  try {
    spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', 'Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force'], { windowsHide: true });
  } catch { /* best effort */ }
};

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
  const exec = { agent: { session: { id: 'managed-find-session' } }, signal: undefined };
  const ui = tools.get('computer_ui');
  const windows = await tools.get('computer_windows').execute({}, exec);
  const notepad = (windows.windows ?? []).find((one) => /notepad/i.test(String(one.process ?? '')));
  if (notepad === undefined) throw new Error('no Notepad window to read; the fixture did not start');
  const hwnd = Number(notepad.hwnd);

  console.log('\n== a managed tree read (the branch that always finished properly) ==');
  const tree = await ui.execute({ hwnd, max_depth: 4, max_nodes: 40 }, exec);
  const treeNodes = Array.isArray(tree.nodes) ? tree.nodes : [];
  check('the managed engine reads the fixture', treeNodes.length > 0, JSON.stringify(tree).slice(0, 200));
  check('with a snapshot id', typeof tree.snapshot === 'string' && tree.snapshot !== '', JSON.stringify({ snapshot: tree.snapshot }));
  const named = treeNodes.find((one) => Number(one.depth ?? 0) > 0 && typeof one.name === 'string' && one.name.trim() !== '' && one.ref !== undefined);
  check('and at least one descendant carries a name and a ref', named !== undefined, JSON.stringify(treeNodes.slice(0, 3)));

  console.log('\n== patterns: false is cheaper, not just shorter (§7.4 第 1 条) ==');
  const withPatterns = await ui.execute({ hwnd, max_depth: 3, max_nodes: 20, patterns: true }, exec);
  const withoutPatterns = await ui.execute({ hwnd, max_depth: 3, max_nodes: 20, patterns: false }, exec);
  check('a read that wants patterns says how many it asked the provider for',
    Number(withPatterns.cachePatterns ?? -1) > 0, JSON.stringify({ cachePatterns: withPatterns.cachePatterns }));
  check('a read that does not want them asks for none',
    Number(withoutPatterns.cachePatterns ?? -1) === 0, JSON.stringify({ cachePatterns: withoutPatterns.cachePatterns }));
  check('the flag still controls what comes back per row',
    Array.isArray(withoutPatterns.nodes) && withoutPatterns.nodes.every((one) => Array.isArray(one.patterns) && one.patterns.length === 0),
    JSON.stringify(withoutPatterns.nodes?.slice(0, 2) ?? null));
  check('and a pattern read still reports them',
    Array.isArray(withPatterns.nodes) && withPatterns.nodes.every((one) => Array.isArray(one.patterns)),
    JSON.stringify(withPatterns.nodes?.slice(0, 2) ?? null));

  console.log('\n== a condition is pushed down only when that is equivalent (§7.4 第 3 条) ==');
  const exactType = await ui.execute({ hwnd, control_type: 'ControlType.Document', max_depth: 4, max_nodes: 10 }, exec);
  check('a fully named control type is handed to the provider',
    Array.isArray(exactType.pushdown) && exactType.pushdown.includes('controlType'),
    JSON.stringify({ pushdown: exactType.pushdown, nodes: exactType.nodes?.length }));
  check('and it still returns the controls of that type',
    Array.isArray(exactType.nodes) && exactType.nodes.every((one) => String(one.controlType ?? '').includes('Document')),
    JSON.stringify(exactType.nodes?.slice(0, 3)));
  const partialType = await ui.execute({ hwnd, control_type: 'Doc', max_depth: 4, max_nodes: 10 }, exec);
  check('a partial control type is NOT handed to the provider (that would drop rows)',
    !Array.isArray(partialType.pushdown) || !partialType.pushdown.includes('controlType'),
    JSON.stringify({ pushdown: partialType.pushdown }));
  check('and the substring matching the caller asked for still works',
    Array.isArray(partialType.nodes) && partialType.nodes.some((one) => String(one.controlType ?? '').includes('Document')),
    JSON.stringify(partialType.nodes?.slice(0, 3)));
  const byId = await ui.execute({ hwnd, automation_id: 'probeDoc', max_depth: 4, max_nodes: 10 }, exec);
  check('nothing is claimed when the search found nothing to say',
    byId.pushdown === undefined || !Array.isArray(byId.pushdown) || byId.pushdown.every((one) => typeof one === 'string'),
    JSON.stringify({ pushdown: byId.pushdown }));

  console.log('\n== the managed *search* has to finish the same way ==');
  // A descendant's name is the right search term: the search walks the window's *descendants*,
  // so the window's own title could never match.
  const searchTerm = String(named?.name ?? '').trim().slice(0, 16);
  check('a search term could be taken from the tree', searchTerm !== '', `tree names: ${JSON.stringify(treeNodes.map((one) => one.name).slice(0, 6))}`);
  const found = await ui.execute({ hwnd, name: searchTerm, max_depth: 4, max_nodes: 20 }, exec);
  const nodes = Array.isArray(found.nodes) ? found.nodes : [];
  check('the search returns the control it was asked for', nodes.length >= 1, JSON.stringify({ searchTerm, found: found.nodes }));
  check('its reply carries a snapshot id', typeof found.snapshot === 'string' && found.snapshot !== '', JSON.stringify({ snapshot: found.snapshot }));
  check('every node carries a ref (the search went through the shared completion)', nodes.length > 0 && nodes.every((one) => typeof one.ref === 'string' && one.ref !== ''), JSON.stringify(nodes.map((one) => one.ref).slice(0, 4)));

  console.log('\n== and its refs are real refs, which is what registering them means ==');
  const ref = nodes[0]?.ref;
  const acted = ref === undefined
    ? { error: 'the search returned no node to act on' }
    : await tools.get('computer_ui_action').execute({ ref, action: 'get_value' }, exec).then((value) => ({ value }), (error) => ({ error: String(error.message) }));
  check('a ref from a search can be acted on', acted.error === undefined, acted.error);
  check('and the action reports a receipt', acted.value !== undefined, JSON.stringify(acted.value ?? null).slice(0, 200));

  console.log('\n== a search can be the base of a delta ==');
  const delta = await ui.execute({ hwnd, name: searchTerm, max_depth: 4, max_nodes: 20, since: found.snapshot }, exec);
  check('the delta answers against the snapshot the search returned', delta.delta !== undefined, JSON.stringify(delta ?? null).slice(0, 200));
  check('and it is a known base rather than a silent full tree', delta.delta?.known === true, JSON.stringify({ snapshot: found.snapshot, delta: delta.delta }));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) for (const failure of failures) console.log(`  - ${failure}`);
} catch (error) {
  console.error('managed-find-test crashed:', error);
  process.exitCode = 1;
} finally {
  killNotepad();
  try { rmSync(shimDir, { recursive: true, force: true }); } catch { /* best effort */ }
  if (failures.length > 0) process.exitCode = 1;
  setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
}
