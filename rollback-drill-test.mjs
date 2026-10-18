/**
 * The rollback drill (9.txt §13.7 and §13.8), run against the *shipped pair*, not a description
 * of it.
 *
 * The plan requires two things of a rollback, and both are checkable:
 *
 *   7. host and worker are restored **as a set** — a new host talking to an old worker (or the
 *      other way round) must be refused at the first call rather than misbehaving quietly;
 *   8. after that restart, the citations the old process handed out are dead: an old frame id,
 *      an old UIA ref and an old browser ref must all be refused, never re-guessed.
 *
 * The baseline is the original 1.39.1 `worker.ps1` (kept in `%TEMP%\plugin-ab-check\` or given
 * with `--baseline <path>`), because §13.1 is about keeping the original around precisely so a
 * drill like this one can be run.
 *
 *   node rollback-drill-test.mjs [--baseline <path to the original worker.ps1>]
 */
import { registerHooks } from 'node:module';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = join(HERE, 'backend', 'worker.ps1');
const POWERSHELL = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const baselineArg = process.argv.indexOf('--baseline');
const baseline = baselineArg >= 0
  ? process.argv[baselineArg + 1]
  : join(tmpdir(), 'plugin-ab-check', 'worker-original.ps1');

const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-rollback-'));
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

const current = readFileSync(WORKER);
try {
  console.log('\n== the drill needs the original worker to roll back to (§13.1) ==');
  if (!existsSync(baseline)) {
    check('a baseline copy of the original worker.ps1 is available', false, `not found: ${baseline} (pass --baseline <path>)`);
  } else {
    const baselineBytes = readFileSync(baseline);
    check('a baseline copy of the original worker.ps1 is available', baselineBytes.length > 0, baseline);
    check('and it is not the build under test', baselineBytes.length !== current.length || !baselineBytes.equals(current), 'baseline equals the current worker');

    const plugin = await import('./index.js');
    const makeScope = () => {
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
      return tools;
    };
    const run = (tools, name, args, session = 'rollback-session') => tools.get(name)
      .execute(args, { agent: { session: { id: session } }, signal: undefined })
      .then((value) => ({ value }), (error) => ({ error: String(error.message) }));

    spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process notepad.exe'], { windowsHide: true, stdio: 'ignore' });
    await sleep(4000);

    console.log('\n== before the rollback: the pair works and hands out citations ==');
    const toolsBefore = makeScope();
    const windows = await run(toolsBefore, 'computer_windows', {});
    const notepad = (windows.value?.windows ?? []).find((one) => /notepad/i.test(String(one.process ?? '')));
    if (notepad === undefined) throw new Error('no Notepad window to read; the fixture did not start');
    const tree = await run(toolsBefore, 'computer_ui', { hwnd: Number(notepad.hwnd), max_depth: 4, max_nodes: 30 });
    const ref = (tree.value?.nodes ?? []).find((one) => typeof one.ref === 'string' && one.ref !== '')?.ref;
    const shot = await run(toolsBefore, 'computer_screenshot', { hwnd: Number(notepad.hwnd), attach: false });
    check('the shipped pair reads a window and mints a ref', ref !== undefined, JSON.stringify(tree.value ?? null).slice(0, 140));
    check('and takes a capture with a frame id', typeof shot.value?.frame === 'string' && shot.value.frame !== '', JSON.stringify(shot.value ?? null).slice(0, 140));
    const oldRef = ref;
    const oldFrame = shot.value?.frame;

    console.log('\n== a half-applied rollback is refused, not tolerated (§13.7) ==');
    // New host, old worker: exactly what a rollback that copied only one of the two halves
    // produces. The build check has to name it.
    copyFileSync(baseline, WORKER);
    const toolsHalf = makeScope();
    const halfRolled = await run(toolsHalf, 'computer_windows', {});
    check('the mismatched pair is refused', halfRolled.error !== undefined, JSON.stringify(halfRolled.value ?? null).slice(0, 140));
    // The refusal names what is missing: either the build hashes disagree (a file swapped under a
    // running worker) or the old worker lacks the capabilities this host needs (§13.7). Both are
    // "the halves are not from one install", and the message has to say which.
    check('and the refusal names the mismatch rather than failing quietly',
      /PROTOCOL_MISMATCH/.test(halfRolled.error ?? '')
        && (/different build of worker\.ps1/.test(halfRolled.error ?? '')
          || /capabilities that the running computer-use worker does not have/.test(halfRolled.error ?? '')),
      String(halfRolled.error).slice(0, 260));
    check('naming every capability this host cannot do without', /reply\.traversal/.test(halfRolled.error ?? ''),
      String(halfRolled.error).slice(0, 260));

    console.log('\n== and the citations from before the restart are dead (§13.8) ==');
    // A refusal above means the worker under the new host is not usable, which is the point;
    // restore the pair and check that the *old* citations are refused by the *new* worker.
    writeFileSync(WORKER, current);
    await sleep(20);
    const toolsAfter = makeScope();
    const refAfter = oldRef === undefined ? { error: 'no ref was minted before' } : await run(toolsAfter, 'computer_ui_action', { ref: oldRef, action: 'get_value' });
    check('an old UIA ref is refused rather than re-guessed',
      refAfter.error !== undefined && /read_not_found|not in this registry|STALE_REF|expired|scan|read the window again/i.test(String(refAfter.error)),
      String(refAfter.error ?? JSON.stringify(refAfter.value)).slice(0, 240));
    const frameAfter = oldFrame === undefined
      ? { error: 'no frame was minted before' }
      : await run(toolsAfter, 'computer_actions', { steps: [{ action: 'click', from_frame: oldFrame, x: 10, y: 10 }] });
    check('an old frame id is refused rather than projected onto today’s screen',
      frameAfter.error !== undefined || frameAfter.value?.failedAt !== -1,
      JSON.stringify(frameAfter.value ?? frameAfter.error).slice(0, 240));
    check('and the refusal says to take a new capture',
      /frame|截图|capture/i.test(String(frameAfter.error ?? frameAfter.value?.error ?? '')),
      String(frameAfter.error ?? frameAfter.value?.error ?? '').slice(0, 200));

    console.log('\n== the set, restored together, works again ==');
    const toolsRestored = makeScope();
    const restored = await run(toolsRestored, 'computer_windows', {});
    check('the pair works after the set is whole again', restored.error === undefined, String(restored.error ?? '').slice(0, 160));
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) for (const failure of failures) console.log(`  - ${failure}`);
} catch (error) {
  console.error('rollback-drill-test crashed:', error);
  process.exitCode = 1;
} finally {
  try {
    if (!readFileSync(WORKER).equals(current)) writeFileSync(WORKER, current);
    const ok = readFileSync(WORKER).equals(current);
    console.log(ok ? '  (worker.ps1 restored byte-for-byte)' : '  !! worker.ps1 could not be restored !!');
    if (!ok) process.exitCode = 1;
  } catch (error) {
    console.error('could not verify the worker file was restored:', error);
    process.exitCode = 1;
  }
  try { spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', 'Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force'], { windowsHide: true }); } catch { /* best effort */ }
  try { rmSync(shimDir, { recursive: true, force: true }); } catch { /* best effort */ }
  if (failures.length > 0) process.exitCode = 1;
  setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
}
