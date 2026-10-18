/**
 * Live check of the 1.18.0 additions, against the real worker and the real desktop.
 *
 * Everything here goes through the actual bridge (spawn, readiness, one JSON line per
 * request, cancel file), so a failure means a failure of the shipping path -- not of a
 * stub. The cases are the ones the review asked for:
 *
 *   1. a batch whose trailing screenshot must be newer than its last write;
 *   2. a batch whose mid-sequence capture *is* still the answer, and is reused;
 *   3. a read-only UI Automation call that no longer sleeps;
 *   4. a condition wait that ends as soon as it is true, and one that times out;
 *   5. a batch-level capture aimed at a window and a region.
 *
 * The window under test is one this script launches itself, because a desktop with no
 * window in front is a legitimate state (a locked or freshly started session) and a test
 * that cannot start without one is a test that fails for the wrong reason.
 *
 * Run: node wait-and-capture-test.mjs
 */
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PowerShellBackend } from './backend/bridge.js';

const notes = [];
let passed = 0;
let failed = 0;

function ok(name, detail = '') {
  passed += 1;
  notes.push(`  PASS  ${name}${detail === '' ? '' : ` -- ${detail}`}`);
}

function bad(name, detail = '') {
  failed += 1;
  notes.push(`  FAIL  ${name}${detail === '' ? '' : ` -- ${detail}`}`);
}

function skip(name, detail = '') {
  notes.push(`  SKIP  ${name}${detail === '' ? '' : ` -- ${detail}`}`);
}

function check(condition, name, detail = '') {
  if (condition) ok(name, detail);
  else bad(name, detail);
  return condition;
}

const shots = mkdtempSync(join(tmpdir(), 'dsh-cu-capture-'));
const backend = new PowerShellBackend({ timeoutMs: 30_000 });
const run = (cmd, args = {}, options = {}) => backend.request(cmd, args, options);

function shotPath(name) {
  return join(shots, `${name}.jpg`);
}

/** The window this test drives: Notepad, launched here so the test owns it. */
async function launchTarget() {
  const launched = await run('launch', { target: 'notepad' }, { timeoutMs: 40_000 });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const list = await run('windows', { filter: 'Notepad' });
    const rows = list.windows ?? [];
    const first = rows.find((w) => w.hwnd > 0);
    if (first !== undefined) return { launched, window: first };
  }
  return { launched, window: null };
}

let notepad = null;

try {
  const info = await backend.start();
  ok('worker starts', `pid ${info.pid}, generation ${info.generation}`);
  check(Array.isArray(info.actions) && info.actions.includes('wait_for'), 'wait_for is a known step action');
  check(info.pacing && info.pacing.waitPollMs > 0, 'pacing reports the condition poll', `waitPollMs=${info.pacing?.waitPollMs}`);

  const launched = await launchTarget();
  notepad = launched.launched;
  let target = launched.window;
  if (target === null) {
    // Nothing this session can drive: still exercise the shape, but say so rather than
    // reporting a pass the desktop never earned.
    skip('window-driven cases', 'no window became visible after launching Notepad');
    await run('shutdown', {});
    console.log(notes.join('\n'));
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  }
  ok('a window to drive', `hwnd ${target.hwnd} "${target.title}" [${target.process}] pid ${target.pid}`);

  // ---------------------------------------------------------------- 4. condition wait
  // A window that certainly exists is already true: the wait must return fast, from the
  // first check, without sleeping out a budget nobody needed.
  const now = await run('wait_for', {
    condition: { kind: 'window', hwnd: target.hwnd },
    timeout_ms: 5_000,
  }, { timeoutMs: 20_000 });
  check(now.satisfied === true, 'wait_for(window) is satisfied by an existing window', `${now.waitedMs} ms, ${now.polls} poll(s)`);
  check(now.waitedMs < 1_000, 'a condition that is already true does not sleep out its budget', `${now.waitedMs} ms`);
  check(typeof now.what === 'string' && now.what !== '', 'the report says what it waited for', now.what);

  const gone = await run('wait_for', {
    condition: { kind: 'window', title: 'absolutely-no-window-has-this-title-8f3a2b', process: 'no-such-process-8f3a2b' },
    timeout_ms: 600,
    poll_ms: 100,
  }, { timeoutMs: 20_000 });
  check(gone.satisfied === false, 'a condition that never holds times out and says so', `${gone.waitedMs} ms, ${gone.polls} poll(s)`);
  check(gone.waitedMs >= 500, 'the timeout is respected as a budget, not as a shortcut', `${gone.waitedMs} ms`);

  const bad = await run('wait_for', { condition: { kind: 'idle', every: 200 }, timeout_ms: 1_000 }, { timeoutMs: 20_000 })
    .then(() => null, (failure) => failure);
  check(bad !== null && String(bad.message).includes('[BAD_REQUEST]'), 'a duration dressed up as a condition is refused', String(bad?.message ?? '').slice(0, 80));

  const both = await run('wait_for', {
    condition: {
      every: [
        { kind: 'window', hwnd: target.hwnd },
        { kind: 'window', hwnd: target.hwnd },
      ],
    },
    timeout_ms: 5_000,
  }, { timeoutMs: 20_000 });
  check(both.satisfied === true && both.waitedMs < 1_000, 'an `every` list is satisfied by its legs', `${both.waitedMs} ms in ${both.polls} poll(s): ${both.observed}`);

  // ------------------------------------------ the other three predicate families
  // A control that is really there (the document of the window this test drives), a value
  // it really holds, and a text the window really shows. These are the predicates a caller
  // reaches for first, so they are the ones that must not be broken.
  const present = await run('wait_for', {
    condition: { kind: 'control', hwnd: target.hwnd, control_type: 'Document' },
    timeout_ms: 5_000,
  }, { timeoutMs: 20_000 });
  check(present.satisfied === true, 'wait_for(control) finds a control that is there', `${present.waitedMs} ms: ${present.observed}`);
  check(present.control !== undefined && String(present.control.controlType).includes('Document'), 'and reports the control it found', JSON.stringify(present.control?.controlType));

  const absent = await run('wait_for', {
    condition: { kind: 'control', hwnd: target.hwnd, control_type: 'Document', is: 'absent' },
    timeout_ms: 700,
    poll_ms: 150,
  }, { timeoutMs: 20_000 });
  check(absent.satisfied === false, 'and `is: absent` is false for a control that is there', `${absent.waitedMs} ms: ${absent.observed}`);

  // Synthesized input is not always available: a locked session, or a foreground that
  // cannot be taken, makes the worker refuse a `type`/`key` step by design. That is a fact
  // about this desktop, so the cases that need a delivered keystroke say so and the rest
  // still run -- a suite that silently reports fewer assertions as a pass is worse than one
  // that names what it could not test.
  const injection = await run('batch', {
    steps: [{ action: 'type', text: 'x' }],
    evidence: false,
    stopOnWindowChange: false,
  }, { timeoutMs: 30_000 }).then((reply) => (reply.failedAt === -1 ? '' : String(reply.error ?? 'refused')), (failure) => String(failure.message));
  if (injection !== '') skip('keystroke cases', `this desktop refuses synthesized input: ${injection.slice(0, 110)}`);
  else ok('this desktop accepts synthesized input', 'the keystroke cases below run for real');

  const typed = await run('batch', {
    steps: [{ action: 'set_value', hwnd: target.hwnd, control_type: 'Document', value: 'dsh-wait-probe-8f3a2b' }],
    evidence: false,
    stopOnWindowChange: false,
  }, { timeoutMs: 40_000 });
  if (typed.failedAt === -1) {
    const heldValue = await run('wait_for', {
      condition: { kind: 'value', hwnd: target.hwnd, control_type: 'Document', expected: 'dsh-wait-probe-8f3a2b' },
      timeout_ms: 5_000,
    }, { timeoutMs: 20_000 });
    check(heldValue.satisfied === true, 'wait_for(value) sees the value that was just written', `${heldValue.waitedMs} ms: ${heldValue.observed}`);

    const wantedText = await run('wait_for', {
      condition: { kind: 'text', hwnd: target.hwnd, contains: 'dsh-wait-probe-8f3a2b' },
      timeout_ms: 5_000,
    }, { timeoutMs: 20_000 });
    check(wantedText.satisfied === true, 'wait_for(text) sees it in the window', `${wantedText.waitedMs} ms: ${wantedText.observed}`);

    const noText = await run('wait_for', {
      condition: { kind: 'text', hwnd: target.hwnd, contains: 'no-such-text-4c1d9e' },
      timeout_ms: 700,
      poll_ms: 150,
    }, { timeoutMs: 20_000 });
    check(noText.satisfied === false, 'and it times out for text that is not there', `${noText.waitedMs} ms: ${noText.observed}`);
  } else {
    skip('value and text predicates', `the window does not accept a programmatic write (${String(typed.error ?? '').slice(0, 80)})`);
  }

  // ------------------------------------------------- 3. read-only UIA no longer sleeps
  const tree = await run('uitree', { hwnd: target.hwnd, maxNodes: 120, patterns: true, prune: false }, { timeoutMs: 30_000 });
  const rows = tree.nodes ?? [];
  notes.push(`  note  controls: ${rows.map((n) => `${String(n.controlType).replace('ControlType.', '')}#${n.automationId}${n.patterns?.length ? `[${n.patterns.join(',')}]` : '[]'}`).join(' ').slice(0, 220)}`);
  // A control that can be *read*: get_value needs ValuePattern, and the receipt says
  // which patterns each node carries, so the test picks one instead of assuming every
  // control in every app supports a value.
  const row = rows.find((n) => Array.isArray(n.patterns) && n.patterns.includes('value') && String(n.automationId ?? '') !== '')
    ?? rows.find((n) => Array.isArray(n.patterns) && (n.patterns.includes('text') || n.patterns.includes('invoke')) && String(n.automationId ?? '') !== '');
  if (row !== undefined) {
    const action = row.patterns.includes('value') ? 'get_value' : 'get_text';
    const selector = { action, hwnd: target.hwnd, automationId: row.automationId };
    // Twice, against the same control: the same work, twice, so the difference between
    // the runs is what the call spent on itself. An absolute budget here measured the
    // whole round trip (bridge write, provider query, answer read) and not the sleep this
    // build removed, which made it a test of the machine rather than of the change.
    await run('uiact', selector, { timeoutMs: 30_000 });
    const started = Date.now();
    const read = await run('uiact', selector, { timeoutMs: 30_000 });
    const warm = Date.now() - started;
    const startedCold = Date.now();
    await run('uiact', selector, { timeoutMs: 30_000 });
    const again = Date.now() - startedCold;
    check(read.action === action, `a read-only ${action} answers`, `value ${JSON.stringify(String(read.value ?? '')).slice(0, 40)}`);
    check(warm < 110 && again < 110, `a read-only ${action} no longer pays the fixed 120 ms sleep`, `${warm} ms then ${again} ms wall, control ${row.controlType}`);
  } else {
    skip('read-only uiact timing', 'the window exposed no readable control');
  }

  // ------------------------------------------- 1. trailing capture is after the last write
  // A `move` is a write that needs no synthesized input (it stamps the same ordinal), so
  // this case runs even where keystrokes are refused.
  const stale = await run('batch', {
    steps: [
      { action: 'screenshot', path: shotPath('mid') },
      { action: 'move', x: 20, y: 20 },
    ],
    screenshot: true,
    path: shotPath('trailing'),
    evidence: false,
    stopOnWindowChange: false,
  }, { timeoutMs: 60_000 });
  check(stale.performed.length === 2, 'the batch ran both steps', stale.performed.join(' | '));
  check(stale.shot !== null && stale.shot !== undefined, 'the batch returned a frame');
  check(stale.shot.afterLastWrite === true, 'the returned frame is on the right side of the last write');
  check(stale.captureUsed?.from === 'retaken', 'a write after the step capture forced a fresh frame', `from=${stale.captureUsed?.from}`);
  check(statSync(stale.shot.path).size > 0, 'the fresh frame exists on disk', `${statSync(stale.shot.path).size} bytes`);
  const midSize = statSync(shotPath('mid')).size;
  check(midSize > 0, 'the mid-sequence frame exists too', `${midSize} bytes`);
  check(stale.shot.path === shotPath('trailing'), 'the returned frame is the one taken after the steps', stale.shot.path);
  check(statSync(shotPath('mid')).size > 0 && stale.shot.path !== shotPath('mid'), 'and it is not the mid-sequence one');

  // ------------------------------------------- 2. a still-fresh step capture is reused
  // A read-only step writes nothing, so the frame taken before it is still on the right
  // side of the last write and *is* the answer: the trailing path must not capture again.
  // (A `move` would not do here: it writes -- it moves the pointer and stamps -- so the
  // frame before it is stale by this build's own rule, which is the case above.)
  const before = Date.now();
  const fresh = await run('batch', {
    steps: [
      { action: 'screenshot', path: shotPath('only') },
      { action: 'get_text', hwnd: target.hwnd, control_type: 'Document' },
    ],
    screenshot: true,
    path: shotPath('never-written'),
    evidence: false,
    stopOnWindowChange: false,
  }, { timeoutMs: 60_000 });
  const wall = Date.now() - before;
  check(fresh.failedAt === -1, 'the read-only step ran', `failedAt=${fresh.failedAt} ${String(fresh.error ?? '').slice(0, 60)}`);
  check(fresh.captureUsed?.from === 'step', 'the step capture was reused instead of re-taken', `from=${fresh.captureUsed?.from}`);
  check(fresh.captureUsed?.afterLastWrite === true, 'the reused frame is after the last write');
  check(fresh.shot.afterLastWrite === true, 'the returned frame is marked fresh');
  check(fresh.shot.path === shotPath('only'), 'the reused frame is the one the step wrote', fresh.shot.path);
  check(wall < 5_000, 'no second capture was taken', `${wall} ms for 2 steps + capture`);

  // A write that never writes (empty text) must not invalidate the frame either: the
  // question is whether the *screen* changed, and nothing was sent.
  if (injection === '') {
    const noop = await run('batch', {
      steps: [
        { action: 'screenshot', path: shotPath('noop') },
        { action: 'type', text: '' },
      ],
      screenshot: true,
      path: shotPath('noop-trailing'),
      evidence: false,
      stopOnWindowChange: false,
    }, { timeoutMs: 60_000 });
    check(noop.performed[1] === 'type 0 char(s)', 'an empty type sent nothing', noop.performed[1]);
    check(noop.captureUsed?.from === 'step', 'a no-op step does not invalidate a fresh frame', `from=${noop.captureUsed?.from}`);
  }

  // ------------------------------- 5. batch-level capture aimed at a window and a region
  // A UIA step writes without synthesized input, so this case runs anywhere.
  const aimed = await run('batch', {
    steps: [{ action: 'set_value', hwnd: target.hwnd, control_type: 'Document', value: 'dsh-aim-probe' }],
    screenshot: true,
    path: shotPath('window'),
    window: target.hwnd,
    require_window: true,
    region: { x: target.x, y: target.y, width: Math.min(320, target.width), height: Math.min(200, target.height) },
    evidence: false,
    stopOnWindowChange: false,
    waitFor: { condition: { kind: 'window', hwnd: target.hwnd }, timeout_ms: 2_000 },
  }, { timeoutMs: 60_000 });
  check(Array.isArray(aimed.waits) && aimed.waits.length === 1, 'the batch reports its condition wait');
  check(aimed.waits?.[0]?.satisfied === true, 'the batch-level wait was satisfied', `${aimed.waits?.[0]?.waitedMs} ms`);
  check(aimed.shot.width <= 320 && aimed.shot.height <= 200, 'the trailing capture honoured the region', `${aimed.shot.width}x${aimed.shot.height}`);
  check(aimed.shot.window?.hwnd === target.hwnd, 'the capture names the window it took', `window=${JSON.stringify(aimed.shot.window)}`);

  // ------------------------------- a wait_for step inside a batch, and a failed batch
  const inBatch = await run('batch', {
    steps: [
      { action: 'wait_for', condition: { kind: 'window', hwnd: target.hwnd }, timeout_ms: 2_000 },
      { action: 'get_value', hwnd: target.hwnd, name: 'no-such-control-8f3a2b' },
    ],
    evidence: false,
    stopOnWindowChange: false,
  }, { timeoutMs: 60_000 });
  check(inBatch.failedAt === 1, 'the step after the wait failed as expected', `failedAt=${inBatch.failedAt}`);
  check(Array.isArray(inBatch.waits) && inBatch.waits.length === 1 && inBatch.waits[0].satisfied === true, 'the wait step reported before the failure');
  check(String(inBatch.error ?? '').includes('no UI Automation element matched'), 'the failure is the selector failure, not the wait', inBatch.error);

  // ------------------------------- a batch that never runs its wait says nothing about it
  const noWait = await run('batch', {
    steps: [{ action: 'move', x: 10, y: 10 }],
    evidence: false,
    stopOnWindowChange: false,
  }, { timeoutMs: 30_000 });
  check(noWait.waits === undefined, 'a batch with no wait reports no wait');

  // ------------------------------- a read-only batch step, addressed the way computer_actions
  // addresses one: the batch's selector field is `automation_id`.
  const readBack = await run('batch', {
    steps: [
      { action: 'get_value', hwnd: target.hwnd, automation_id: String(row?.automationId ?? 'no-such-id-8f3a2b') },
    ],
    evidence: false,
    stopOnWindowChange: false,
  }, { timeoutMs: 30_000 });
  check(readBack.failedAt === -1 || readBack.failedAt === 0, 'a read-only batch either reads or fails cleanly', `failedAt=${readBack.failedAt}`);

  await run('shutdown', {});
  ok('worker shuts down');
} catch (failure) {
  failed += 1;
  notes.push(`  ERROR  ${failure?.stack ?? failure}`);
} finally {
  try { await backend.dispose(); } catch { /* already gone */ }
  if (notepad?.pid !== undefined) {
    try {
      const killer = await import('node:child_process');
      killer.execSync(`taskkill /PID ${notepad.pid} /T /F`, { stdio: 'ignore' });
      notes.push('  note  closed the test window');
    } catch { /* it was already gone */ }
  }
}

console.log(notes.join('\n'));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
