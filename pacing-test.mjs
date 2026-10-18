/**
 * Pacing through the public tool interface: does an argument reach the worker, and does the
 * observation behave the way its reply claims?
 *
 * `stability-probe.mjs` measures the cost of each budget at the transport level; this file
 * covers the other half, one layer up: the arguments a *model* passes (`computer_screenshot`,
 * `computer_actions`) have to survive the host and arrive at the worker unchanged. A default
 * quietly swallowing an explicit `0` was the exact failure this change set out to remove, so
 * the assertions here are about receipts, not about milliseconds.
 *
 * The worker's `stability.resolvedBy` is the receipt that matters: it names which argument
 * decided the budget — `stability_ms`, `stable=false`, `stable=true`, or `default` — which
 * distinguishes "the argument arrived" from "something else chose for me".
 *
 *   node pacing-test.mjs
 *
 * Side effect: one harmless key tap (Shift) per case, and JPEG captures in a temp directory.
 * It opens nothing and clicks nothing. On a desktop that refuses synthesized input the tap
 * is replaced by a focus — which stamps the same write without sending any input — and the
 * replacement is reported as a SKIP line.
 */
import { registerHooks } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-pacing-'));
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
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`);
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`);
  }
}

/**
 * A case this desktop cannot run, said out loud rather than counted as a pass.
 *
 * The condition waits that need a real window are skipped when no window appears, but the
 * ones that only need the worker (a condition that can never hold, a refused kind) still
 * run: they are the half of this contract that does not depend on the desktop.
 */
let skipped = 0;
function skip(label, detail) {
  skipped += 1;
  console.log(`  SKIP  ${label}${detail === undefined ? '' : ` :: ${detail}`}`);
}

/** The same rules the host applies, kept in sync with schema-test.mjs. */
function validate(value, schema, path, errors) {
  if (schema === undefined) return;
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push(`${path}: not one of ${JSON.stringify(schema.enum)}`);
    return;
  }
  switch (schema.type) {
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${path}: expected object`);
        return;
      }
      const properties = schema.properties ?? {};
      for (const [key, child] of Object.entries(properties)) {
        const present = Object.prototype.hasOwnProperty.call(value, key);
        const required = child.required === true || (Array.isArray(schema.required) && schema.required.includes(key));
        if (!present) {
          if (required) errors.push(`${path}.${key}: missing but required`);
          continue;
        }
        validate(value[key], child, `${path}.${key}`, errors);
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!Object.prototype.hasOwnProperty.call(properties, key)) {
            errors.push(`${path}.${key}: not a declared property (additionalProperties: false)`);
          }
        }
      }
      return;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected array`);
        return;
      }
      value.forEach((entry, index) => validate(entry, schema.items, `${path}[${index}]`, errors));
      return;
    }
    case 'string':
      if (typeof value !== 'string') errors.push(`${path}: expected string`);
      return;
    case 'integer':
      if (!Number.isInteger(value)) errors.push(`${path}: expected integer, got ${JSON.stringify(value)}`);
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${path}: expected number, got ${JSON.stringify(value)}`);
      return;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${path}: expected boolean`);
      return;
    default:
      return;
  }
}

function conforms(tools, name, value) {
  const errors = [];
  validate(value, tools.get(name).output.schema, 'value', errors);
  return errors;
}

const shotDir = mkdtempSync(join(tmpdir(), 'dsh-cu-pacing-shots-'));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SESSION = 'pacing-session';
// Module scope, not the try block's: the cleanup runs in `finally`, which cannot see
// bindings declared inside the block it is attached to.
let launched = null;
let target = null;

try {
  const plugin = await import('./index.js');
  const tools = new Map();
  let toolSeq = 0;
  const services = {
    webServer: { register: () => () => {} },
    attachments: {
      saveImages: async (inputs) => inputs.map((input) => ({
        attachmentId: `sha256:pacing${String(++toolSeq).padStart(4, '0')}`,
        mediaType: input.mediaType,
        bytes: input.data.byteLength,
        width: 2560,
        height: 1440,
      })),
    },
  };
  const ctx = {
    tools: { register: (d) => { tools.set(d.name, d); return () => {}; } },
    webServer: services.webServer,
    effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d(); }; },
    inject: (deps, callback) => { if (deps.every((n) => services[n] !== undefined)) callback(ctx); return () => {}; },
    get: (name) => services[name],
    logger: { info: () => {} },
  };
  plugin.apply(ctx, { defaultEnabled: true });
  const exec = { agent: { session: { id: SESSION } }, signal: undefined };

  let shotSeq = 0;
  const shotPath = (tag) => join(shotDir, `pacing-${tag}-${++shotSeq}.jpg`);
  // The pacing cases below are about what the worker does *after a write*, so what they
  // need is a write stamp — not a delivered keystroke. On a desktop that refuses
  // synthesized input (the foreground can belong to a window that is not visible, and a
  // test cannot take it) `key` fails before it stamps anything, so the write falls back to
  // `focus`: the worker stamps a write for it and sends no input at all. The assertions
  // stay exactly as strong — there is a real write in front of the capture either way —
  // and the delivered-keystroke path is reported as a SKIP rather than quietly replaced.
  let writePath = 'key';
  let focusHwnd = 0;
  const writeKey = async () => {
    if (writePath === 'key') {
      try {
        await tools.get('computer_key').execute({ keys: 'shift' }, exec);
        return;
      } catch (error) {
        writePath = 'focus';
        skip('a write made by synthesized input (a Shift tap)', `this desktop refuses it (${error.message.slice(0, 150)}), so the pacing cases use a focus, which stamps the same write without sending input`);
      }
    }
    const listed = await tools.get('computer_windows').execute({}, exec);
    const row = (listed.windows ?? []).find((window) => window.hwnd > 0);
    if (row === undefined) throw new Error('no write is possible here: synthesized input is refused and there is no visible window to focus');
    focusHwnd = row.hwnd;
    // The raise itself may fail (another process can hold the foreground), and the write
    // stamp happens either way — which is the part this suite depends on.
    await tools.get('computer_windows').execute({ focus_hwnd: row.hwnd }, exec);
  };
  /**
   * The write step the batch cases use. A key tap where the desktop accepts synthesized
   * input, a focus otherwise: both stamp the same write ordinal, and a batch whose write
   * step is refused is not testing the pacing at all — it is testing a batch that could
   * not write, which is a different case with a different answer.
   */
  const writeStep = () => (writePath === 'key' ? { action: 'key', keys: 'shift' } : { action: 'focus', hwnd: focusHwnd });
  const shot = (tag, args) => tools.get('computer_screenshot').execute({ format: 'jpeg', scale: 0.25, save_path: shotPath(tag), ...args }, exec);

  console.log('\n== what the tool schema tells the model ==');
  // The descriptions are the only place a model learns what a default is, so a wrong one is
  // a real defect: "(default 5000)" read as a favour was half of why this was expensive.
  const screenshotParams = tools.get('computer_screenshot').parameters;
  check('computer_screenshot still takes settle_ms and stability_ms', screenshotParams.settle_ms !== undefined && screenshotParams.stability_ms !== undefined);
  check('and now takes the plain switch too', screenshotParams.stable !== undefined && screenshotParams.stable.type === 'boolean');
  check('stability_ms is described as off by default', /default 0/.test(screenshotParams.stability_ms.description), screenshotParams.stability_ms.description.slice(0, 90));
  check('settle_ms is described as a floor, not a sleep', /floor/.test(screenshotParams.settle_ms.description), screenshotParams.settle_ms.description.slice(0, 90));
  const batchParams = tools.get('computer_actions').parameters;
  check('computer_actions takes the same three arguments', batchParams.stability_ms !== undefined && batchParams.stable !== undefined && batchParams.settle_ms !== undefined);
  const stepProps = batchParams.steps.items.properties;
  check('and a screenshot step can pace itself', stepProps.stability_ms !== undefined && stepProps.stable !== undefined && stepProps.settle_ms !== undefined);

  console.log('\n== the default path ==');
  await writeKey();
  const defaulted = await shot('default', {});
  check('a capture after a write reports its pacing', defaulted.stability !== undefined, JSON.stringify(defaulted.timing));
  check('the default budget is off', defaulted.stability?.state === 'disabled' && defaulted.stability?.budgetMs === 0, JSON.stringify(defaulted.stability));
  check('and the worker default is what decided that', defaulted.stability?.resolvedBy === 'default', JSON.stringify(defaulted.stability));
  check('no five-second poll is left on the default path', defaulted.timing?.captureMs < 2000, `${defaulted.timing?.captureMs} ms`);
  check('the settle floor and the poll are reported separately', Number.isFinite(defaulted.timing?.settleMs) || Number.isFinite(defaulted.timing?.pollMs), JSON.stringify(defaulted.timing));
  check('the default capture conforms to its schema', conforms(tools, 'computer_screenshot', defaulted).length === 0, conforms(tools, 'computer_screenshot', defaulted).join(' | '));

  const idle = await shot('idle', {});
  check('a capture with no write in front of it waits for nothing', idle.stability?.state === 'none', JSON.stringify(idle.stability));

  console.log('\n== explicit arguments reach the worker ==');
  await writeKey();
  const zero = await shot('zero', { stability_ms: 0 });
  check('stability_ms: 0 is what decided the budget', zero.stability?.resolvedBy === 'stability_ms' && zero.stability?.budgetMs === 0, JSON.stringify(zero.stability));
  check('and the wait is skipped rather than shortened', zero.stability?.state === 'disabled' && zero.stability?.polls === 0, JSON.stringify(zero.stability));

  await writeKey();
  const off = await shot('off', { stable: false });
  check('stable: false is what decided the budget', off.stability?.resolvedBy === 'stable=false', JSON.stringify(off.stability));

  await writeKey();
  const on = await shot('on', { stable: true });
  check('stable: true asks for the default budget', on.stability?.resolvedBy === 'stable=true' && on.stability?.budgetMs > 0, JSON.stringify(on.stability));

  await writeKey();
  const budgeted = await shot('budget', { stability_ms: 400 });
  check('a budget is used, and reported', budgeted.stability?.resolvedBy === 'stability_ms' && budgeted.stability?.budgetMs === 400, JSON.stringify(budgeted.stability));
  check('the budget is a real ceiling, not a suggestion', budgeted.stability?.waitedMs <= 400 + 400, JSON.stringify(budgeted.stability));
  check('the outcome is one of the honest states', ['stable', 'timeout'].includes(budgeted.stability?.state), JSON.stringify(budgeted.stability));
  check('a stable verdict needs two samples', budgeted.stability?.state !== 'stable' || budgeted.stability?.polls >= 2, JSON.stringify(budgeted.stability));
  check('a budgeted capture conforms to its schema', conforms(tools, 'computer_screenshot', budgeted).length === 0, conforms(tools, 'computer_screenshot', budgeted).join(' | '));
  const budgetEnvelope = tools.get('computer_screenshot').output.render({}, budgeted).map((block) => block.text ?? '').join('\n');
  check('and its envelope names the budget when it ran out late', budgeted.stability?.state !== 'timeout' || budgetEnvelope.includes('still changing'), budgetEnvelope.slice(0, 200));

  console.log('\n== conflicting arguments resolve in the documented order ==');
  await writeKey();
  const conflicting = await shot('conflict', { stable: false, stability_ms: 2000 });
  check('stable: false wins over a non-zero budget', conflicting.stability?.budgetMs === 0 && conflicting.stability?.resolvedBy === 'stable=false', JSON.stringify(conflicting.stability));
  check('and the conflict is reported rather than hidden', typeof conflicting.stability?.conflict === 'string' && conflicting.stability.conflict.length > 0, JSON.stringify(conflicting.stability));

  await writeKey();
  const zeroAndTrue = await shot('zero-true', { stable: true, stability_ms: 0 });
  check('an explicit 0 wins over stable: true', zeroAndTrue.stability?.budgetMs === 0 && zeroAndTrue.stability?.resolvedBy === 'stability_ms', JSON.stringify(zeroAndTrue.stability));
  check('that conflict is named too', typeof zeroAndTrue.stability?.conflict === 'string' && zeroAndTrue.stability.conflict.length > 0, JSON.stringify(zeroAndTrue.stability));

  console.log('\n== the write stamp has an age ==');
  await writeKey();
  await wait(2600);
  const stale = await shot('stale', {});
  check('a write older than the TTL starts no wait', stale.stability?.state === 'none', JSON.stringify(stale.stability));
  check('and the observation is still fast', stale.timing?.captureMs < 2000, `${stale.timing?.captureMs} ms`);

  console.log('\n== the batch path ==');
  const batchDefault = await tools.get('computer_actions').execute({
    steps: [writeStep(), { action: 'screenshot', path: shotPath('batch-default') }],
    format: 'jpeg', scale: 0.25,
  }, exec);
  check('a capture inside a batch reports its pacing', batchDefault.shot?.stability !== undefined, JSON.stringify(batchDefault.shot?.stability));
  check('and the default is off there too', batchDefault.shot?.stability?.state === 'disabled' && batchDefault.shot?.stability?.budgetMs === 0, JSON.stringify(batchDefault.shot?.stability));

  const batchCall = await tools.get('computer_actions').execute({
    steps: [writeStep(), { action: 'screenshot', path: shotPath('batch-call') }],
    format: 'jpeg', scale: 0.25, stability_ms: 400,
  }, exec);
  check('a call-level budget reaches the capture inside the batch', batchCall.shot?.stability?.budgetMs === 400, JSON.stringify(batchCall.shot?.stability));
  check('and it is honoured there as well', batchCall.shot?.stability?.waitedMs <= 400 + 400, JSON.stringify(batchCall.shot?.stability));
  check('the batch still conforms to its schema', conforms(tools, 'computer_actions', batchCall).length === 0, conforms(tools, 'computer_actions', batchCall).join(' | '));

  const batchStep = await tools.get('computer_actions').execute({
    steps: [writeStep(), { action: 'screenshot', path: shotPath('batch-step'), stability_ms: 0 }],
    format: 'jpeg', scale: 0.25, stability_ms: 400,
  }, exec);
  check('a step-level budget overrides the call level', batchStep.shot?.stability?.budgetMs === 0, JSON.stringify(batchStep.shot?.stability));
  check('and the step override is what decided it', batchStep.shot?.stability?.resolvedBy === 'stability_ms', JSON.stringify(batchStep.shot?.stability));

  const batchFlag = await tools.get('computer_actions').execute({
    steps: [writeStep(), { action: 'screenshot', path: shotPath('batch-flag'), stable: false }],
    format: 'jpeg', scale: 0.25, stability_ms: 400,
  }, exec);
  check('a step-level switch overrides the call-level budget too', batchFlag.shot?.stability?.budgetMs === 0 && batchFlag.shot?.stability?.resolvedBy === 'stable=false', JSON.stringify(batchFlag.shot?.stability));

  // A second capture in the same batch follows one that already happened: the write has been
  // observed, so the second frame must not wait for it again. Its `state` can still read
  // `disabled` -- the write stamp is recent and the budget is 0, which is "there was nothing
  // to wait for" in the state machine's words -- so what is asserted is the wait itself:
  // nothing was spent, and (since 1.18.0) the frame that comes back is the one the second
  // capture step took, with no third capture behind it. The two paths are made once each:
  // shotPath() advances a counter, so calling it twice for one comparison is a test that
  // compares two different files.
  const twiceFirst = shotPath('batch-twice-1');
  const twiceSecond = shotPath('batch-twice-2');
  const batchTwice = await tools.get('computer_actions').execute({
    steps: [
      writeStep(),
      { action: 'screenshot', path: twiceFirst, stability_ms: 400 },
      { action: 'screenshot', path: twiceSecond },
    ],
    screenshot: true, save_path: twiceSecond,
    format: 'jpeg', scale: 0.25,
  }, exec);
  check('a second capture in the same batch does not wait for the same write again',
    batchTwice.shot?.stability?.waitedMs === 0 && ['none', 'disabled'].includes(batchTwice.shot?.stability?.state),
    JSON.stringify(batchTwice.shot?.stability));
  check('and it is served by the frame the first capture took, not a second capture',
    batchTwice.captureUsed?.from === 'step' && batchTwice.shot?.path === twiceSecond,
    `${JSON.stringify(batchTwice.captureUsed)} path=${batchTwice.shot?.path} expected=${twiceSecond}`);

  console.log('\n== evidence reuses a frame only when the frame can contain it ==');
  const evidenceBatch = await tools.get('computer_actions').execute({
    steps: [writeStep()],
    screenshot: true, evidence: true, format: 'jpeg', scale: 0.25, save_path: shotPath('evidence'),
  }, exec);
  const rect = evidenceBatch.evidence ?? { x: 0, y: 0, width: 0, height: 0 };
  const frame = evidenceBatch.shot ?? { x: 0, y: 0, width: 0, height: 0 };
  const contained = rect.width > 0
    && rect.x >= frame.x && rect.y >= frame.y
    && rect.x + rect.width <= frame.x + frame.width
    && rect.y + rect.height <= frame.y + frame.height;
  check('evidence is still returned alongside the capture', typeof rect.changed === 'boolean', JSON.stringify(rect));
  check('the after-reading is reused exactly when the frame can contain it', (rect.reused === true) === contained, `contained=${contained} reused=${rect.reused}`);
  check('the reused reading still fingerprints both ends', typeof rect.before === 'string' && rect.before.length > 0 && typeof rect.after === 'string' && rect.after.length > 0, JSON.stringify(rect));

  console.log('\n== the worker reports its pacing policy ==');
  const bridge = await import('./backend/bridge.js');
  const backend = new bridge.PowerShellBackend();
  await backend.start();
  const before = await backend.request('pacing', {}, { timeoutMs: 20_000 });
  check('the worker reports its pacing defaults', Number.isInteger(before.after?.stabilityMs) && Number.isInteger(before.after?.settleMs), JSON.stringify(before.after));
  check('the stability default is off', before.after.stabilityMs === 0, JSON.stringify(before.after));
  const changed = await backend.request('pacing', { stabilityMs: 900, writeTtlMs: 3000 }, { timeoutMs: 20_000 });
  check('and it accepts a change at runtime', changed.after.stabilityMs === 900 && changed.after.writeTtlMs === 3000, JSON.stringify(changed.after));
  const restored = await backend.request('pacing', { stabilityMs: before.after.stabilityMs, writeTtlMs: before.after.writeTtlMs }, { timeoutMs: 20_000 });
  check('and can be put back', restored.after.stabilityMs === before.after.stabilityMs && restored.after.writeTtlMs === before.after.writeTtlMs, JSON.stringify(restored.after));
  const health = await backend.request('health', {}, { timeoutMs: 20_000 });
  check('health reports the pacing policy and any pending write', health.pacing !== undefined && 'pendingWrite' in health, JSON.stringify(health.pacing));
  const stats = backend.stats;
  check('the transport counts what it queued, dispatched and spawned', stats.requests > 0 && stats.dispatched > 0 && stats.spawns > 0, JSON.stringify(stats));

  console.log('\n== waiting for a condition, at the worker ==');
  // A wait is an *observation with a deadline*, and the whole point of it is that the
  // answer is a fact about the application rather than an error: "it never became true
  // inside the budget" is what a caller acts on, so a timeout must come back as a report
  // and not as a rejection. All of this is worker-level: the tool layer only copies the
  // report into `waits` (schema-test covers that half).
  //
  // The window cases use a Notepad this file launches itself, because a wait for a window
  // is only meaningful against a window whose lifetime this test owns. The cases that need
  // no window (a condition that cannot hold, a refused kind) run either way.
  const nonExistent = { kind: 'window', title: 'no-window-has-this-title-8f3a2b', process: 'no-such-process-8f3a2b' };

  const timedOut = await backend.request('wait_for', { condition: nonExistent, timeout_ms: 800, poll_ms: 100 }, { timeoutMs: 20_000 });
  check('a condition that never holds answers instead of throwing', timedOut.satisfied === false, JSON.stringify(timedOut));
  check('the wait spent roughly its budget, not less', timedOut.waitedMs >= 700 && timedOut.waitedMs <= 800 + 4_000, `${timedOut.waitedMs} ms of an 800 ms budget`);
  check('and it polled more than once instead of sleeping the budget out', timedOut.polls > 1, `${timedOut.polls} poll(s)`);
  check('the report says which budget decided it', timedOut.timeoutMs === 800 && timedOut.timeoutFrom === 'explicit', JSON.stringify({ timeoutMs: timedOut.timeoutMs, timeoutFrom: timedOut.timeoutFrom }));
  check('and the poll interval it actually used', timedOut.pollMs === 100, String(timedOut.pollMs));
  check('every field a caller reads is present and typed', typeof timedOut.what === 'string' && timedOut.what !== ''
    && typeof timedOut.satisfied === 'boolean' && Number.isInteger(timedOut.waitedMs) && Number.isInteger(timedOut.polls)
    && Number.isInteger(timedOut.timeoutMs) && typeof timedOut.timeoutFrom === 'string' && Number.isInteger(timedOut.pollMs)
    && typeof timedOut.observed === 'string' && timedOut.observed !== '', JSON.stringify(timedOut));
  check('and it says what the last check saw', timedOut.observed.includes('no such window is open yet'), timedOut.observed);
  check('the report names the window it was about when there is one', timedOut.window === undefined || timedOut.window === null, JSON.stringify(timedOut.window));

  const refusedAt = Date.now();
  const idleRefusal = await backend.request('wait_for', { condition: { kind: 'idle', every: 200 }, timeout_ms: 1_000 }, { timeoutMs: 20_000 })
    .then(() => null, (failure) => failure);
  const refusedIn = Date.now() - refusedAt;
  check("kind: 'idle' is refused rather than waited out", idleRefusal !== null && String(idleRefusal.message).includes('[BAD_REQUEST]'), String(idleRefusal?.message ?? 'the wait was accepted').slice(0, 200));
  check('and the refusal says a duration is what the wait step is for', idleRefusal !== null && String(idleRefusal.message).includes('duration') && String(idleRefusal.message).includes('wait step'), String(idleRefusal?.message ?? '').slice(0, 200));
  check('the refusal comes back at once, without burning the budget', refusedIn < 3_000, `${refusedIn} ms wall`);

  const absent = await backend.request('wait_for', { condition: { kind: 'window', title: 'no-window-has-this-title-8f3a2b', is: 'absent' }, timeout_ms: 2_000 }, { timeoutMs: 20_000 });
  check('a window condition inverted with is: absent is satisfied when nothing matches', absent.satisfied === true, JSON.stringify(absent));
  check('and it still answers from the first check', absent.waitedMs < 1_000, `${absent.waitedMs} ms`);

  // A window whose lifetime this test owns. `launch` is the worker's own command, so this
  // needs no shell and nothing from the desktop's current state.
  try {
    launched = await backend.request('launch', { target: 'notepad', waitSeconds: 6 }, { timeoutMs: 40_000 });
    if (launched.hwnd > 0) {
      // The window the launch itself matched to the process it started, rather than the
      // first window whose title mentions Notepad: Windows 11 Notepad restores its previous
      // session, so a title search can adopt a window this test does not own.
      target = { hwnd: launched.hwnd, title: launched.title, pid: launched.pid };
    } else {
      for (let attempt = 0; attempt < 20 && target === null; attempt += 1) {
        await wait(400);
        const listed = await backend.request('windows', { filter: 'Notepad' }, { timeoutMs: 20_000 });
        const found = (listed.windows ?? []).find((row) => row.hwnd > 0);
        if (found !== undefined) target = found;
      }
    }
  } catch (error) {
    skip('the window-driven condition waits', `the test could not launch Notepad: ${error.message}`);
  }

  if (target === null) {
    skip('a condition that already holds answers from the first check', 'no window this test owns became visible');
    skip('the report names the window it was about', 'no window this test owns became visible');
    skip('a control condition that matches nothing says so', 'no window this test owns became visible');
    skip('stable_ms requires the condition to keep holding', 'no window this test owns became visible');
    skip('an every list is satisfied by its legs', 'no window this test owns became visible');
    skip('a batch-level waitFor is reported in the batch reply', 'no window this test owns became visible');
  } else {
    console.log(`  (the test's own window: hwnd ${target.hwnd} "${target.title}" pid ${target.pid})`);
    const already = await backend.request('wait_for', { condition: { kind: 'window', hwnd: target.hwnd }, timeout_ms: 5_000 }, { timeoutMs: 20_000 });
    check('a condition that already holds answers from the first check', already.satisfied === true && already.polls === 1, `${already.polls} poll(s), ${already.waitedMs} ms`);
    check('and it does not sleep out its budget', already.waitedMs < 1_000, `${already.waitedMs} ms of a 5000 ms budget`);
    check('the report names the window the condition was about', already.window?.hwnd === target.hwnd, JSON.stringify(already.window));

    const asDefault = await backend.request('wait_for', { condition: { hwnd: target.hwnd } }, { timeoutMs: 20_000 });
    check('a wait that was given no budget uses the worker default, and says so', asDefault.timeoutFrom === 'default' && asDefault.timeoutMs > 0, JSON.stringify({ timeoutFrom: asDefault.timeoutFrom, timeoutMs: asDefault.timeoutMs }));
    check('the default is the wait ceiling from the pacing report, not an arbitrary number', asDefault.timeoutMs === before.after.waitMaxMs, `${asDefault.timeoutMs} vs waitMaxMs ${before.after.waitMaxMs}`);
    check('a shorthand condition (hwnd alone) is read as a window condition', already.satisfied === true && asDefault.satisfied === true, `${asDefault.what}`);

    const noControl = await backend.request('wait_for', { condition: { hwnd: target.hwnd, name: 'no-such-control-8f3a2b' }, timeout_ms: 400, poll_ms: 100 }, { timeoutMs: 20_000 });
    check('a control condition that matches nothing times out and says what it saw', noControl.satisfied === false && noControl.observed.includes('no node matched yet'), noControl.observed);
    check('and it reports the control kind it waited for', noControl.what.includes('no-such-control-8f3a2b'), noControl.what);

    const held = await backend.request('wait_for', { condition: { hwnd: target.hwnd, stable_ms: 150 }, timeout_ms: 5_000, poll_ms: 100 }, { timeoutMs: 20_000 });
    check('stable_ms requires the condition to keep holding, not just to flicker true', held.satisfied === true && held.polls >= 2, `${held.polls} poll(s), ${held.waitedMs} ms`);
    check('and the report carries the stable_ms it was asked for', held.stableMs === 150, JSON.stringify(held));
    check('it waited at least as long as the stability it required', held.waitedMs >= 150, `${held.waitedMs} ms for a 150 ms requirement`);
    check('and it says the condition held for that long', held.observed.includes('held for'), held.observed);

    const every = await backend.request('wait_for', {
      condition: { every: [{ hwnd: target.hwnd }, { title: 'no-window-has-this-title-8f3a2b', is: 'absent' }] },
      timeout_ms: 5_000,
    }, { timeoutMs: 20_000 });
    check('an every list is satisfied by its legs', every.satisfied === true && every.waitedMs < 1_000, `${every.waitedMs} ms in ${every.polls} poll(s)`);

    const everyFails = await backend.request('wait_for', {
      condition: { every: [{ hwnd: target.hwnd }, { title: 'no-window-has-this-title-8f3a2b' }] },
      timeout_ms: 400, poll_ms: 100,
    }, { timeoutMs: 20_000 });
    check('an every list with a leg that never holds is not satisfied', everyFails.satisfied === false, JSON.stringify({ satisfied: everyFails.satisfied, observed: everyFails.observed }));
    check('and its observation names every leg, held or not', everyFails.observed.includes('it is open') && everyFails.observed.includes('no such window is open yet'), everyFails.observed);

    // The batch-level wait runs after the steps and before the trailing capture, so a batch
    // that says "do this, then come back when the result is there" is one round trip.
    const batched = await backend.request('batch', {
      steps: [{ action: 'wait', seconds: 0 }],
      waitFor: { condition: { kind: 'window', hwnd: target.hwnd }, timeout_ms: 5_000 },
    }, { timeoutMs: 40_000 });
    check('a batch-level waitFor is reported in the batch reply', Array.isArray(batched.waits) && batched.waits.length === 1, JSON.stringify(batched.waits));
    check('the batch wait is satisfied and says how long it looked', batched.waits?.[0]?.satisfied === true, JSON.stringify(batched.waits?.[0]?.waitedMs));
    check('the step still ran before the wait', batched.performed?.[0] === 'wait 0s' && batched.failedAt === -1, JSON.stringify(batched.performed));

    const batchWaitStep = await backend.request('batch', {
      steps: [{ action: 'wait_for', condition: { kind: 'window', hwnd: target.hwnd }, timeout_ms: 5_000 }],
    }, { timeoutMs: 40_000 });
    check('a wait_for *step* is reported the same way', batchWaitStep.waits?.length === 1 && batchWaitStep.waits[0].satisfied === true, JSON.stringify(batchWaitStep.waits));
    check('and its step line says what it waited for and whether it held', String(batchWaitStep.performed?.[0] ?? '').includes('wait_for') && String(batchWaitStep.performed?.[0] ?? '').includes('satisfied'), String(batchWaitStep.performed?.[0] ?? ''));
  }

  backend.dispose();
} catch (error) {
  console.error('PACING TEST FAILED:', error.message);
  process.exitCode = 1;
} finally {
  // Closing the window this test opened is housekeeping, not a result: a taskkill that
  // fails must not turn a green run red.
  if (launched?.pid !== undefined && launched.pid > 0) {
    try {
      spawnSync('taskkill', ['/PID', String(launched.pid), '/T', '/F'], { stdio: 'ignore' });
      console.log(`\n(closed the test window: pid ${launched.pid})`);
    } catch (error) {
      console.log(`\n(the test window (pid ${launched.pid}) could not be closed: ${error.message})`);
    }
  }
  console.log(`\n===== ${passed} passed, ${failures.length} failed =====`);
  if (skipped > 0) console.log(`  (${skipped} case(s) skipped — see the SKIP lines above)`);
  for (const failure of failures) console.log(`  - ${failure}`);
  if (failures.length > 0) process.exitCode = 1;
  rmSync(shimDir, { recursive: true, force: true });
  rmSync(shotDir, { recursive: true, force: true });
  setTimeout(() => process.exit(process.exitCode ?? 0), 300).unref();
}
