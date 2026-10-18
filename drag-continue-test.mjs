/**
 * P5 (8.txt §8 后半): continuing a stroke from the last drag's end point.
 *
 * The interesting part of this feature is what it refuses. A continuation is only allowed when
 * the backend still holds a fresh handle for the previous drag; with none, the call must stop
 * before any input is sent (a drag that starts from a guessed point is worse than no drag), and
 * the receipt must say so in the plugin's usual shape: a named code plus `action_sent=false`.
 *
 * These checks need no fixture window: the refusals happen before the pointer moves, so the
 * whole chain (host validation → worker → handle lookup → coded refusal) is exercised without
 * touching the desktop. The behavioural half — two strokes in two calls, and byte-identical
 * geometry versus naming the start explicitly — needs a live drag and is covered by
 * `drag-path-test.mjs` plus the manual two-stroke check noted in OPT8-PLAN §4.1.
 *
 *   node drag-continue-test.mjs
 */
import { registerHooks } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-dragcontinue-'));
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
  const exec = { agent: { session: { id: 'drag-continue-session' } }, signal: undefined };
  const drag = (args) => tools.get('computer_drag').execute(args, exec).then((value) => ({ value }), (error) => ({ error: String(error.message) }));

  console.log('\n== a continuation with no handle is refused before anything is sent ==');
  const none = await drag({ to_x: 400, to_y: 400, from_last: true });
  check('starting from the last drag without one is refused', none.error !== undefined, JSON.stringify(none.value ?? '').slice(0, 120));
  check('the refusal names the missing handle', /\[DRAG_HANDLE_MISSING\]/.test(none.error ?? ''), String(none.error).slice(0, 180));
  check('it says nothing was sent', /action_sent=false/.test(none.error ?? ''), String(none.error).slice(-120));
  check('and the host did not mistake it for a missing start point', !/needs from_x/.test(none.error ?? ''), String(none.error).slice(0, 120));

  console.log('\n== an unknown handle is refused the same way ==');
  const unknown = await drag({ to_x: 400, to_y: 400, continue_from: 'd0.999' });
  check('an unknown handle id is refused', /\[DRAG_HANDLE_MISSING\]/.test(unknown.error ?? ''), String(unknown.error).slice(0, 180));
  check('the refusal explains which handle it wanted', /not the most recent one|no drag has been performed/i.test(unknown.error ?? ''), String(unknown.error).slice(0, 200));

  console.log('\n== the ordinary shape checks still hold ==');
  const noCorners = await drag({ to_x: 400, to_y: 400 });
  check('a drag with no start at all is still a bad request', /\[BAD_REQUEST\]/.test(noCorners.error ?? '') && /from_x/.test(noCorners.error ?? ''), String(noCorners.error).slice(0, 160));
  const noEnd = await drag({ from_x: 10, from_y: 10, from_last: true });
  check('a continuation still needs its end point', /\[BAD_REQUEST\]/.test(noEnd.error ?? '') && /to_x/.test(noEnd.error ?? ''), String(noEnd.error).slice(0, 160));

  console.log('\n== the parameter is advertised with its contract ==');
  const schema = tools.get('computer_drag').parameters;
  check('from_last is declared', schema.from_last !== undefined, JSON.stringify(Object.keys(schema).slice(0, 8)));
  check('continue_from is declared', schema.continue_from !== undefined);
  check('and the contract says an expired handle is refused', /refused|过期/i.test(`${schema.continue_from?.description ?? ''} ${schema.from_last?.description ?? ''}`), (schema.continue_from?.description ?? '').slice(0, 140));
  check('the receipt declares the handle it hands back', tools.get('computer_drag').output.schema.properties.handle !== undefined);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) for (const failure of failures) console.log(`  - ${failure}`);
} catch (error) {
  console.error('drag-continue-test crashed:', error);
  process.exitCode = 1;
} finally {
  try { rmSync(shimDir, { recursive: true, force: true }); } catch { /* best effort */ }
  if (failures.length > 0) process.exitCode = 1;
  setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref();
}
