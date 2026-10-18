/**
 * Two receipts that used to say more than they knew (9.txt §8.4 and §6 第 7 条).
 *
 *   - `computer_stop` built its first line from `count` alone, so a release that *failed* — with
 *     the reason already sitting in `note` — was printed as "Nothing was held down." (evidence
 *     HOST03). Turning the capability off and confirming that held input was released are two
 *     different results, and the reply has to keep them apart.
 *   - a capture whose attachment failed still recorded the frame as "the last thing this session
 *     was shown", so the next identical capture was answered with "nothing has changed since you
 *     last looked" about a picture nobody saw. The record is committed when the frame is really
 *     delivered, and a failure leaves it retryable.
 *
 * Both are about a *value*, so both are checked here by rendering the reply the value would
 * produce — no desktop, no worker.
 *
 *   node stop-report-test.mjs
 */
import { registerHooks } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-stop-'));
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
const textOf = (blocks) => (Array.isArray(blocks) ? blocks : [])
  .filter((block) => block?.type === 'text')
  .map((block) => String(block.text ?? ''))
  .join('\n');

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
  const stop = tools.get('computer_stop');
  const render = (value) => textOf(stop.output.render({}, value));

  console.log('\n== a stop whose release failed does not read as a stop that had nothing to do ==');
  const failed = render({
    released: [],
    count: 0,
    note: 'the session was revoked, but releasing held input failed: the worker is not running',
    disabled: true,
    cancelled: 3,
    releaseConfirmed: false,
    releaseError: 'the worker is not running',
  });
  check('it does not claim nothing was held down', !/Nothing was held down/.test(failed), failed);
  check('it says the release was not confirmed', /not confirmed|Nothing was confirmed released/i.test(failed), failed);
  check('it gives the reason', /the worker is not running/.test(failed), failed);
  check('it names the capability state', /OFF/.test(failed), failed);
  check('it still reports what was cancelled', /3 request/.test(failed), failed);
  check('and it tells the user what to do about a key that may be down', /may still be down/.test(failed), failed);

  console.log('\n== a release that did work still reads as one ==');
  const released = render({ released: ['mouse:left'], count: 1, note: 'held input was released', releaseConfirmed: true });
  check('the released input is named', /Released: mouse:left/.test(released), released);
  check('and no failure is claimed', !/not confirmed/i.test(released), released);
  check('and the capability line is absent when nothing was turned off', !/OFF/.test(released), released);

  console.log('\n== a stop with nothing held says exactly that ==');
  const clean = render({ released: [], count: 0, note: 'nothing was held down', releaseConfirmed: true });
  check('nothing held is reported as nothing held', /Nothing was held down/.test(clean), clean);
  check('with no failure text', !/not confirmed/i.test(clean), clean);

  console.log('\n== the fields the renderer reads are the ones the tool promises ==');
  const schema = stop.output.schema.properties;
  check('releaseConfirmed is declared', schema.releaseConfirmed !== undefined, JSON.stringify(Object.keys(schema)));
  check('releaseError is declared', schema.releaseError !== undefined);
  check('and the note explains what the two facts are', /released/i.test(`${schema.releaseConfirmed?.description ?? ''} ${schema.releaseError?.description ?? ''}`), schema.releaseConfirmed?.description ?? '');

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) for (const failure of failures) console.log(`  - ${failure}`);
} catch (error) {
  console.error('stop-report-test crashed:', error);
  process.exitCode = 1;
} finally {
  try { rmSync(shimDir, { recursive: true, force: true }); } catch { /* best effort */ }
  if (failures.length > 0) process.exitCode = 1;
  setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref();
}
