/**
 * The batch receipt as a record of what happened to *every* step (9.txt §5.2).
 *
 * Three things the review asked for and this checks against the real worker:
 *
 *   - a step that is refused before it sends anything is reported as `not-sent`, and the steps
 *     after it as `not-run` — the difference a caller needs before deciding whether to send
 *     anything again;
 *   - the steps before it stay `completed`, so the record of what did happen survives the
 *     failure;
 *   - a trailing `state` read that fails does not replace the receipt: it is attached as
 *     `observation.failed`, and the steps that ran are still listed.
 *
 * Nothing here sends input: the refusal is a click that names a frame this worker has never
 * issued, which is refused before the pointer moves, and the failing read names a window that
 * does not exist.
 *
 *   node batch-progress-test.mjs
 */
import { registerHooks } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-progress-'));
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
const states = (value) => (value.progress ?? []).map((one) => one.state);

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
  const exec = { agent: { session: { id: 'batch-progress-session' } }, signal: undefined };
  const tool = tools.get('computer_actions');
  const batch = (args) => tool.execute(args, exec).then(
    (value) => ({ value, rendered: textOf(tool.output.render(args, value)) }),
    (error) => ({ error: String(error.message) }),
  );

  console.log('\n== every step is accounted for when the call succeeds ==');
  const ok = await batch({ steps: [{ action: 'wait', seconds: 0.02 }, { action: 'wait', seconds: 0.02 }] });
  if (ok.error !== undefined) throw new Error(`the batch failed: ${ok.error}`);
  check('a successful call lists one entry per step', (ok.value.progress ?? []).length === 2, JSON.stringify(ok.value.progress));
  check('all of them completed', states(ok.value).every((one) => one === 'completed'), JSON.stringify(states(ok.value)));
  check('each entry names its step and action', ok.value.progress?.[1]?.action === 'wait' && ok.value.progress?.[1]?.step === 1, JSON.stringify(ok.value.progress));
  check('and nothing is claimed to be partial', (ok.value.partialSteps ?? []).length === 0, JSON.stringify(ok.value.partialSteps));

  console.log('\n== a step refused before sending is not-sent, and the rest are not-run (9.txt §5.2) ==');
  const refused = await batch({
    steps: [
      { action: 'wait', seconds: 0.02 },
      { action: 'click', x: 5, y: 5, from_frame: 'f-does-not-exist' },
      { action: 'move', x: 5, y: 5 },
    ],
    stop_on_window_change: false,
  });
  if (refused.error !== undefined) throw new Error(`the batch failed instead of reporting: ${refused.error}`);
  check('the call failed at the step that was refused', refused.value.failedAt === 1, JSON.stringify({ failedAt: refused.value.failedAt }));
  check('the step before it is recorded as completed', refused.value.progress?.[0]?.state === 'completed', JSON.stringify(states(refused.value)));
  check('the refused step is not-sent', refused.value.progress?.[1]?.state === 'not-sent', JSON.stringify(states(refused.value)));
  check('the step after it never ran', refused.value.progress?.[2]?.state === 'not-run', JSON.stringify(states(refused.value)));
  check('nothing was sent by the call', refused.value.actionSent === false && (refused.value.wroteSteps ?? []).length === 0, JSON.stringify({ actionSent: refused.value.actionSent, wroteSteps: refused.value.wroteSteps }));
  check('and it is not reported as partial', refused.value.partial !== true, JSON.stringify({ partial: refused.value.partial }));
  check('the receipt still lists what did run', (refused.value.performed ?? []).length === 1, JSON.stringify(refused.value.performed));

  console.log('\n== a failed trailing read is attached, not substituted (9.txt §5.2) ==');
  const observation = await batch({ steps: [{ action: 'wait', seconds: 0.02 }], state: { hwnd: 987654321 } });
  if (observation.error !== undefined) throw new Error(`the call was replaced by an error: ${observation.error}`);
  check('the steps are still reported', (observation.value.performed ?? []).length === 1, JSON.stringify(observation.value.performed));
  check('the call is not marked as failed at a step', observation.value.failedAt === -1, JSON.stringify({ failedAt: observation.value.failedAt }));
  check('the failed read is attached to the reply', observation.value.observation?.failed === true, JSON.stringify(observation.value.observation));
  check('it carries the read error', String(observation.value.observation?.error ?? '').length > 0, JSON.stringify(observation.value.observation));
  check('and no state was invented for it', observation.value.state === undefined, JSON.stringify(observation.value.state));
  check('the reply says the steps did run', /did run/.test(observation.rendered), observation.rendered.slice(-220));

  console.log('\n== a trailing capture that fails is attached as well (9.txt §5.2) ==');
  const capture = await batch({ steps: [{ action: 'wait', seconds: 0.02 }], screenshot: true, window: 987654321 });
  if (capture.error !== undefined) throw new Error(`the call was replaced by an error: ${capture.error}`);
  check('the steps are still reported', (capture.value.performed ?? []).length === 1, JSON.stringify(capture.value.performed));
  check('the call is not marked as failed at a step', capture.value.failedAt === -1, JSON.stringify({ failedAt: capture.value.failedAt }));
  check('the failed capture is attached', capture.value.observation?.what === 'capture' && capture.value.observation?.failed === true, JSON.stringify(capture.value.observation));
  check('no frame is invented for it', capture.value.shot === undefined, JSON.stringify(capture.value.shot));
  check('and the reply says the steps did run', /did run/.test(capture.rendered) && /capture/.test(capture.rendered), capture.rendered.slice(-220));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) for (const failure of failures) console.log(`  - ${failure}`);
} catch (error) {
  console.error('batch-progress-test crashed:', error);
  process.exitCode = 1;
} finally {
  try { rmSync(shimDir, { recursive: true, force: true }); } catch { /* best effort */ }
  if (failures.length > 0) process.exitCode = 1;
  setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref();
}
