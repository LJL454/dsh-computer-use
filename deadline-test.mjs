/**
 * The deadline as a promise the worker keeps (9.txt §5.7, evidence PS04/PS07).
 *
 * Two of the reproduced problems live here, and both are about what happens *after* the budget
 * is gone:
 *
 *   - a step that starts on a spent budget used to run anyway -- a batch whose wait consumed
 *     the deadline still typed, clicked or moved (PS04). The probe for it is a `move`: it is a
 *     write step, it is visible in `wroteSteps`, and a move to (5,5) is harmless if the guard
 *     ever fails to hold;
 *   - a condition wait with nothing left on the clock used to make one last check and could
 *     report `satisfied: true` on it (PS07). The probe is a wait whose own budget is 0: the
 *     report has to have `polls: 0` and the third answer (`status: unknown`), not "it is false".
 *
 * The last section is what stops this from being a rule that leaks: the *next* call runs on its
 * own clock, so a batch that ran out of time does not poison the one after it.
 *
 *   node deadline-test.mjs
 */
import { registerHooks } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-deadline-'));
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
  const exec = { agent: { session: { id: 'deadline-session' } }, signal: undefined };
  const tool = tools.get('computer_actions');
  const batch = (args) => tool.execute(args, exec).then((value) => ({
    value,
    // The reply as the model sees it: `execute` returns the value, and the rendered blocks are
    // what carry the advice a caller acts on.
    rendered: textOf(tool.output.render(args, value)),
  }), (error) => ({ error: String(error.message) }));

  console.log('\n== a step that starts on a spent budget does not run (PS04) ==');
  const spent = await batch({
    steps: [{ action: 'wait', seconds: 1.5 }, { action: 'move', x: 5, y: 5 }],
    deadline_ms: 1200,
  });
  if (spent.error !== undefined) throw new Error(`the batch failed instead of reporting: ${spent.error}`);
  const value = spent.value;
  check('the call reports the deadline as its outcome', value.outcome === 'deadline', JSON.stringify({ outcome: value.outcome, failedAt: value.failedAt }));
  check('and names the step that never started', value.failedAt === 1, JSON.stringify({ failedAt: value.failedAt }));
  check('it says the refusal was the budget, not the step', value.outOfBudget === true, JSON.stringify({ outOfBudget: value.outOfBudget }));
  check('nothing was sent to the desktop for it', value.actionSent === false, JSON.stringify({ actionSent: value.actionSent, wroteSteps: value.wroteSteps }));
  check('and the write step is not in the write list', (value.wroteSteps ?? []).length === 0, JSON.stringify(value.wroteSteps));
  check('the step that did run is reported', value.count === 1 && /wait/.test(String(value.performed?.[0] ?? '')), JSON.stringify(value.performed));
  check('the reply explains what to do next', /deadline/.test(spent.rendered) && /nothing was sent/i.test(spent.rendered), spent.rendered.slice(-260));

  console.log('\n== a wait with nothing left on the clock makes no check (PS07) ==');
  const noClock = await batch({
    steps: [{ action: 'wait_for', condition: { hwnd: 987654321 }, timeout_ms: 0 }],
  });
  if (noClock.error !== undefined) throw new Error(`the wait batch failed instead of reporting: ${noClock.error}`);
  const report = (noClock.value.waits ?? [])[0];
  check('the wait is reported', report !== undefined, JSON.stringify(noClock.value).slice(0, 200));
  check('with no check made at all', report?.polls === 0, JSON.stringify({ polls: report?.polls }));
  check('and the answer is the third one, not "false"', report?.status === 'unknown', JSON.stringify({ status: report?.status, outcome: report?.outcome }));
  check('the reason is the spent budget', report?.timeoutKind === 'budget-spent', JSON.stringify({ timeoutKind: report?.timeoutKind }));
  check('it is reported as not satisfied', report?.satisfied === false, JSON.stringify({ satisfied: report?.satisfied }));
  check('and the reply says nothing was watched', /nothing was watched|no budget left/.test(noClock.rendered), noClock.rendered.slice(0, 300));

  console.log('\n== a wait that does have time still observes ==');
  const withTime = await batch({
    steps: [{ action: 'wait_for', condition: { hwnd: 987654321 }, timeout_ms: 400 }],
  });
  if (withTime.error !== undefined) throw new Error(`the timed wait failed instead of reporting: ${withTime.error}`);
  const observed = (withTime.value.waits ?? [])[0];
  check('it polls while it has budget', (observed?.polls ?? 0) >= 1, JSON.stringify({ polls: observed?.polls }));
  check('and reports the observation it made', observed?.status !== undefined && observed?.status !== 'unknown', JSON.stringify({ status: observed?.status }));
  check('it is not the spent-budget answer', observed?.timeoutKind !== 'budget-spent', JSON.stringify({ timeoutKind: observed?.timeoutKind }));

  console.log('\n== the deadline does not leak into the next call ==');
  const next = await batch({ steps: [{ action: 'wait', seconds: 0.05 }] });
  if (next.error !== undefined) throw new Error(`the following batch failed: ${next.error}`);
  check('the next call completes normally', next.value.outcome !== 'deadline' && next.value.failedAt === -1, JSON.stringify({ outcome: next.value.outcome, failedAt: next.value.failedAt }));
  check('and it did not inherit a deadline', next.value.outOfBudget !== true, JSON.stringify({ outOfBudget: next.value.outOfBudget }));

  console.log('\n== a call that fits its budget says so ==');
  const fits = await batch({ steps: [{ action: 'wait', seconds: 0.05 }], deadline_ms: 8000 });
  if (fits.error !== undefined) throw new Error(`the fitting batch failed: ${fits.error}`);
  check('the deadline is reported with the call', fits.value.deadlineMs === 8000, JSON.stringify({ deadlineMs: fits.value.deadlineMs }));
  check('and it is reported as met', fits.value.deadlineMet === true, JSON.stringify({ deadlineMet: fits.value.deadlineMet, overDeadlineMs: fits.value.overDeadlineMs }));
  check('with no overrun claimed', (fits.value.overDeadlineMs ?? 0) === 0, JSON.stringify({ overDeadlineMs: fits.value.overDeadlineMs }));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) for (const failure of failures) console.log(`  - ${failure}`);
} catch (error) {
  console.error('deadline-test crashed:', error);
  process.exitCode = 1;
} finally {
  try { rmSync(shimDir, { recursive: true, force: true }); } catch { /* best effort */ }
  if (failures.length > 0) process.exitCode = 1;
  setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref();
}
