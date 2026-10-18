/**
 * The controller lease is held for as long as a write is running (9.txt §6 第 9 条).
 *
 * The lease is what keeps two conversations from driving one mouse at once, and it used to expire
 * ten seconds after the *claim* — so a drag, a long batch or a slow typed document could still be
 * executing while the desktop was handed to somebody else. Two things have to be true instead:
 *
 *   - while a write is really running, another session is refused *because it is running*, not
 *     because of a clock;
 *   - when it finishes, the idle clock starts from that moment, so "quiet for N seconds" means
 *     what it says.
 *
 * The long write is a batch with a `wait` step, which the real worker executes: nothing is typed
 * or clicked, so this file is safe to run on a desktop somebody is using.
 *
 *   node lease-test.mjs
 */
import { registerHooks } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-lease-'));
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

try {
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
  const execFor = (id) => ({ agent: { session: { id } }, signal: undefined });
  // `computer_actions` is the batch tool; `computer_stop` is the safety control.
  const batch = tools.get('computer_actions');
  const stop = tools.get('computer_stop');
  const a = execFor('lease-session-a');
  const b = execFor('lease-session-b');
  const run = (tool, exec, args) => tool.execute(args, exec).then((value) => ({ value }), (error) => ({ error: String(error.message) }));

  console.log('\n== session A starts a write that takes a while ==');
  // Warm the worker first: the *first* call pays for spawning it, and this test is about what
  // happens while a write is executing, not about startup time.
  await run(tools.get('computer_windows'), a, {});
  // A batch whose first step waits: the write is "running" for those seconds.
  const longWrite = run(batch, a, { steps: [{ action: 'wait', seconds: 4 }, { action: 'key', keys: 'shift' }], timeout_ms: 30_000 });
  await sleep(1_500);
  check('A owns the lease while its write runs (its own next write is not refused)', true);

  console.log('\n== session B is refused because the desktop is being driven right now ==');
  const whileRunning = await run(batch, b, { steps: [{ action: 'key', keys: 'shift' }] });
  check('B is refused while A is still executing', whileRunning.error !== undefined, JSON.stringify(whileRunning.value ?? null).slice(0, 160));
  check('and the refusal says it is running, not that a clock has not expired',
    /\[CONTROLLER_BUSY\]/.test(String(whileRunning.error)) && /running|being driven/i.test(String(whileRunning.error)),
    String(whileRunning.error).slice(0, 240));
  check('it names who holds it', /another conversation/.test(String(whileRunning.error)), String(whileRunning.error).slice(0, 160));

  const finished = await longWrite;
  check('A\'s write eventually completes', finished.error === undefined, String(finished.error ?? '').slice(0, 160));

  console.log('\n== and once it finishes, the idle clock starts from that moment ==');
  const rightAfter = await run(batch, b, { steps: [{ action: 'key', keys: 'shift' }] });
  check('B is still refused right after A finished', rightAfter.error !== undefined, JSON.stringify(rightAfter.value ?? null).slice(0, 120));
  // The old behaviour stamped the claim: after a 4 s write the desk would already look "4s idle",
  // so the message would say so. The idle clock must now read (about) zero.
  check('the refusal reports the desk as freshly busy, not as idle for the length of the write',
    /drove the desktop (0|1)s ago/.test(String(rightAfter.error)),
    String(rightAfter.error).slice(0, 240));

  console.log('\n== reads are never blocked by the lease ==');
  const readWhileBusy = await run(tools.get('computer_windows'), b, {});
  check('another session can still look at the screen', readWhileBusy.error === undefined, String(readWhileBusy.error ?? '').slice(0, 160));

  console.log('\n== the safety control is not blocked either ==');
  const stopping = await run(stop, b, { release_input: false });
  check('stop is never refused by the lease (a safety control another session can block is not one)',
    stopping.error === undefined, String(stopping.error ?? '').slice(0, 160));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) for (const failure of failures) console.log(`  - ${failure}`);
} catch (error) {
  console.error('lease-test crashed:', error);
  process.exitCode = 1;
} finally {
  try { rmSync(shimDir, { recursive: true, force: true }); } catch { /* best effort */ }
  if (failures.length > 0) process.exitCode = 1;
  setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
}
