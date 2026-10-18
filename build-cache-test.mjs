/**
 * The worker build check: read once and remembered, still able to catch a replaced file
 * (9.txt §7.2).
 *
 * The check that "the process is running the file this plugin was installed with" used to
 * read worker.ps1 — 606 KB — and SHA-256 all of it on **every call**, synchronously, on the
 * host's event loop. What has to stay true after the caching is the part that matters:
 *
 *   - a burst of calls does not read the file once per call (`metrics.buildReads`, read from
 *     the plugin's own status route, which is where a diagnostic like this belongs);
 *   - a file replaced while a worker is running is still detected (a real read, then a
 *     mismatch that names both builds);
 *   - and once the file is back, the check accepts it again — the cache must not keep an old
 *     answer about a new file.
 *
 * The middle case patches the real worker file, so the test restores it byte-for-byte in a
 * `finally` and verifies that it did.
 *
 *   node build-cache-test.mjs
 */
import { registerHooks } from 'node:module';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = join(HERE, 'backend', 'worker.ps1');
const RELEASE = join(HERE, 'backend', 'release-input.ps1');
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-build-'));
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

const original = readFileSync(WORKER);
const releaseOriginal = readFileSync(RELEASE);
/**
 * The engine's real-read counter, through the plugin's own status route.
 * @param routeMap - the routes the scope under test registered.
 */
function counterReader(routeMap) {
  return async () => {
    const route = routeMap.get('/computer-use/status');
    if (route === undefined) return null;
    let payload = null;
    const res = { status: 0, writeHead(status) { this.status = status; }, end(text) { payload = JSON.parse(text); } };
    await route.handler({ method: 'GET', url: '/computer-use/status' }, res);
    return Number(payload?.runtime?.metrics?.buildReads ?? -1);
  };
}

try {
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

  const exec = { agent: { session: { id: 'build-cache-session' } }, signal: undefined };
  const run = (name, args) => tools.get(name).execute(args, exec).then((value) => ({ value }), (error) => ({ error: String(error.message) }));
  /** The counter, from the route the chip and the diagnostics actually read. */
  const buildReads = async () => {
    const route = routes.get('/computer-use/status');
    if (route === undefined) return null;
    let payload = null;
    const res = { status: 0, writeHead(status) { this.status = status; }, end(text) { payload = JSON.parse(text); } };
    await route.handler({ method: 'GET', url: '/computer-use/status' }, res);
    return Number(payload?.runtime?.metrics?.buildReads ?? -1);
  };

  console.log('\n== a call starts the worker and passes the build check ==');
  const first = await run('computer_windows', {});
  check('the call succeeds', first.error === undefined, String(first.error).slice(0, 160));
  const before = await buildReads();
  check('the status route reports how many times the file was really read', Number.isFinite(before) && before >= 1, JSON.stringify({ before }));

  console.log('\n== a burst of calls does not re-read it every time ==');
  for (let i = 0; i < 6; i += 1) await run('computer_windows', {});
  const after = await buildReads();
  check('six more calls added at most one real read', after - before <= 1, JSON.stringify({ before, after }));

  console.log('\n== a file replaced while the worker runs is still caught ==');
  appendFileSync(WORKER, '\n# build-cache-test: this line changes the file while a worker is running\n', 'utf8');
  const mismatch = await run('computer_windows', {});
  check('the replaced file is refused', mismatch.error !== undefined, JSON.stringify(mismatch.value ?? null).slice(0, 120));
  check('and the refusal names the two builds', /different build of worker\.ps1/.test(mismatch.error ?? ''), String(mismatch.error).slice(0, 200));
  check('it says what to do about it', /Restart the desktop app/.test(mismatch.error ?? ''), String(mismatch.error).slice(-120));
  const duringBreak = await buildReads();
  check('that took a real read, not a remembered one', duringBreak > after, JSON.stringify({ after, duringBreak }));

  console.log('\n== the cache does not keep that answer about the restored file ==');
  writeFileSync(WORKER, original);
  await sleep(20);
  const restored = await run('computer_windows', {});
  check('the restored file is accepted again', restored.error === undefined, String(restored.error).slice(0, 200));

  console.log('\n== the build check covers the second script the host runs (§13.5) ==');
  appendFileSync(RELEASE, '\n# build-cache-test: this line changes the release script\n', 'utf8');
  const releaseMismatch = await run('computer_windows', {});
  check('a replaced release script is refused', releaseMismatch.error !== undefined, JSON.stringify(releaseMismatch.value ?? null).slice(0, 120));
  check('and the refusal names that script', /release-input\.ps1/.test(releaseMismatch.error ?? ''), String(releaseMismatch.error).slice(0, 240));
  check('and says why it matters', /press the wrong keys|releases held input/i.test(releaseMismatch.error ?? ''), String(releaseMismatch.error).slice(0, 260));
  writeFileSync(RELEASE, releaseOriginal);
  await sleep(20);
  const releaseRestored = await run('computer_windows', {});
  check('and the restored release script is accepted again', releaseRestored.error === undefined, String(releaseRestored.error).slice(0, 200));

  console.log('\n== the read optimisation has a controlled off switch (§13.6) ==');
  {
    const tools2 = new Map();
    const ctx2 = {
      tools: { register: (definition) => { tools2.set(definition.name, definition); return () => {}; } },
      webServer: services.webServer,
      on: () => {},
      effect: (fn) => { const disposer = fn(); return () => { if (typeof disposer === 'function') disposer(); }; },
      inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx2); return () => {}; },
      get: (name) => services[name],
      logger: { info: () => {}, warn: () => {} },
    };
    plugin.apply(ctx2, { defaultEnabled: true, verifyWorkerBuildEveryCall: true });
    const exec2 = { agent: { session: { id: 'build-cache-fallback' } }, signal: undefined };
    const run2 = (name, args) => tools2.get(name).execute(args, exec2).then((value) => ({ value }), (error) => ({ error: String(error.message) }));
    await run2('computer_windows', {});
    const readCounter = counterReader(routes);
    const before2 = await readCounter();
    for (let i = 0; i < 4; i += 1) await run2('computer_windows', {});
    const after2 = await readCounter();
    check('the counter is still readable with the fallback on', Number.isFinite(before2) && Number.isFinite(after2), JSON.stringify({ before2, after2 }));
    check('with the fallback on, the file is really read on every check', after2 - before2 >= 4, JSON.stringify({ before2, after2 }));
    check('and the calls still work with it on', (await run2('computer_windows', {})).error === undefined);
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) for (const failure of failures) console.log(`  - ${failure}`);
} catch (error) {
  console.error('build-cache-test crashed:', error);
  process.exitCode = 1;
} finally {
  try {
    if (!readFileSync(WORKER).equals(original)) writeFileSync(WORKER, original);
    const restoredOk = readFileSync(WORKER).equals(original);
    console.log(restoredOk ? '  (worker.ps1 restored byte-for-byte)' : '  !! worker.ps1 could not be restored !!');
    if (!restoredOk) process.exitCode = 1;
    if (!readFileSync(RELEASE).equals(releaseOriginal)) writeFileSync(RELEASE, releaseOriginal);
    const releaseOk = readFileSync(RELEASE).equals(releaseOriginal);
    console.log(releaseOk ? '  (release-input.ps1 restored byte-for-byte)' : '  !! release-input.ps1 could not be restored !!');
    if (!releaseOk) process.exitCode = 1;
  } catch (error) {
    console.error('could not verify the worker files were restored:', error);
    process.exitCode = 1;
  }
  try { rmSync(shimDir, { recursive: true, force: true }); } catch { /* best effort */ }
  if (failures.length > 0) process.exitCode = 1;
  setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref();
}
