/**
 * Pacing experiment: the same action, the same observation, alternating stability budgets.
 *
 * This is the comparable experiment the review asked for. The old default polled for a
 * still picture for up to 5 s on every capture that followed a write; the new default is
 * 0 (off), with an explicit budget available. "Faster" is only half of the acceptance
 * criterion, so every case below reports the time *and* what the wait concluded:
 *
 *   median / p95          -- the cost of the pacing, in ms
 *   polls, waitedMs       -- what the poll spent, and what it was allowed to spend
 *   stability.state       -- stable | timeout | disabled | none | other-target | ...
 *   resolvedBy            -- which argument decided the budget
 *   worker timing         -- settle / poll / total, split at the source
 *
 * Cases (each repeated --rounds times):
 *
 *   idle            no write before the capture           -- the floor cost of an observation
 *   stability_ms 0  write, then an explicit zero budget   -- the new default's fast path
 *   stability_ms 400  write, then a small budget          -- two samples on a quiet screen
 *   stability_ms 5000 write, then the old ceiling         -- for comparison
 *   stable:false    write, then the direct skip
 *   worker default  write, then no pacing argument
 *   past TTL        write, wait past the write TTL, then capture
 *   batch, call budget    [key, screenshot] with call-level stability_ms
 *   batch, step budget    [key, screenshot] with a step-level stability_ms
 *   window capture        a window capture after a write (the poll samples the window)
 *   evidence reuse        a batch whose own capture can serve as the after-reading
 *
 * Usage:
 *   node stability-probe.mjs [--rounds N] [--json out.json] [--key shift] [--quiet]
 *
 * Side effect: one key tap per write case (default `shift`, which changes nothing), and
 * captures written into the temp directory. Nothing here clicks.
 */
import { PowerShellBackend } from './backend/bridge.js';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : argv[at + 1];
};
const has = (name) => argv.includes(`--${name}`);

const ROUNDS = Number(flag('rounds', 5));
const KEY = String(flag('key', 'shift'));
const QUIET = has('quiet');
const jsonAt = argv.indexOf('--json');

const backend = new PowerShellBackend();
const shotJpg = join(tmpdir(), 'dsh-cu-stability.jpg');

const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
const stats = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: Math.round(sorted[0]),
    median: Math.round(pct(sorted, 0.5)),
    p95: Math.round(pct(sorted, 0.95)),
    max: Math.round(sorted[sorted.length - 1]),
  };
};

/** One write, using a key tap that changes nothing on screen. */
async function write() {
  await backend.request('key', { keys: KEY, repeat: 1 }, { timeoutMs: 30_000 });
}

/** The same output for every case: the primary display, JPEG, unscaled. */
const shotArgs = (extra = {}) => ({ path: shotJpg, format: 'jpeg', display: 0, ...extra });

const cases = [];

/**
 * Run one case ROUNDS times, collecting wall time plus whatever the reply reported.
 * @param label - the row label.
 * @param once - performs one round and returns the backend reply.
 * @param note - what the case is for.
 * @param report - reads extra fields out of the reply for the row (and the console line).
 */
async function run(label, once, note = '', report = null) {
  const samples = [];
  let last = null;
  let failure = '';
  for (let round = 0; round < ROUNDS; round += 1) {
    const started = performance.now();
    try {
      last = await once(round);
    } catch (error) {
      failure = error.message;
      break;
    }
    samples.push(performance.now() - started);
  }
  if (samples.length === 0) {
    console.log(`${label.padEnd(26)} (failed: ${failure.slice(0, 110)})`);
    const row = { label, note, n: 0, median: 0, p95: 0, max: 0, min: 0, error: failure.slice(0, 300) };
    cases.push(row);
    return row;
  }
  const extra = report === null ? {} : report(last);
  const row = { label, note, ...stats(samples), ...extra };
  cases.push(row);
  const stability = row.stability;
  const stateLine = stability === null || stability === undefined
    ? ''
    : ` state=${stability.state} polls=${stability.polls} waited=${stability.waitedMs}/${stability.budgetMs} by=${stability.resolvedBy}`;
  const conflict = stability?.conflict ? ` conflict="${stability.conflict}"` : '';
  const timing = row.timing ? ` [worker ${row.timing.totalMs}ms: settle ${row.timing.settleMs} poll ${row.timing.pollMs}]` : '';
  console.log(
    `${label.padEnd(26)} median=${String(row.median).padStart(6)}ms p95=${String(row.p95).padStart(6)}ms ` +
    `max=${String(row.max).padStart(6)}ms (${row.n})${stateLine}${conflict}${timing}`,
  );
  if (row.evidence !== undefined) console.log(`    evidence: ${JSON.stringify(row.evidence)}`);
  return row;
}

const shotReport = (reply) => ({
  stability: reply?.stability ?? null,
  timing: reply?.timing ?? null,
});
const batchReport = (reply) => ({
  stability: reply?.shot?.stability ?? null,
  timing: reply?.shot?.timing ?? null,
  evidence: reply?.evidence ?? null,
});

const info = await backend.start();
const pacing = await backend.request('pacing', {}, { timeoutMs: 30_000 });
if (!QUIET) {
  console.log('--- computer-use pacing probe ---');
  console.log(`worker pid ${info.pid}, ps ${info.version}, rounds ${ROUNDS}, write = key '${KEY}'`);
  console.log(`worker pacing defaults: ${JSON.stringify(pacing.after ?? pacing)}\n`);
}

// 1. The floor: an observation with no write in front of it.
await run('idle', () => backend.request('screenshot', shotArgs(), { timeoutMs: 60_000 }),
  'no write before the capture', shotReport);

// 2. The fast path: a write, then an explicit zero budget.
await run('stability_ms 0', async () => {
  await write();
  return backend.request('screenshot', shotArgs({ stabilityMs: 0 }), { timeoutMs: 60_000 });
}, 'write, then an explicit budget of 0', shotReport);

// 3. A small budget: long enough for two samples on a quiet screen.
await run('stability_ms 400', async () => {
  await write();
  return backend.request('screenshot', shotArgs({ stabilityMs: 400 }), { timeoutMs: 60_000 });
}, 'write, then a 400 ms budget', shotReport);

// 4. The historical default, for comparison.
await run('stability_ms 5000', async () => {
  await write();
  return backend.request('screenshot', shotArgs({ stabilityMs: 5000 }), { timeoutMs: 60_000 });
}, 'write, then the old 5000 ms ceiling', shotReport);

// 5. The direct skip the tool schema never used to mention; it now does.
await run('stable:false', async () => {
  await write();
  return backend.request('screenshot', shotArgs({ stable: false }), { timeoutMs: 60_000 });
}, 'write, then stable:false', shotReport);

// 6. No pacing argument at all: whatever the worker default is (0 after this change).
await run('worker default', async () => {
  await write();
  return backend.request('screenshot', shotArgs(), { timeoutMs: 60_000 });
}, 'write, then no pacing argument', shotReport);

// 7. A write that is old by the time the capture happens: the poll must not start.
await run('write, wait past TTL', async () => {
  await write();
  const ttlMs = Number(pacing.after?.writeTtlMs ?? 2000);
  await backend.request('wait', { seconds: Math.max(2.5, ttlMs / 1000 + 0.4) }, { timeoutMs: 30_000 });
  return backend.request('screenshot', shotArgs(), { timeoutMs: 60_000 });
}, 'write, then an observation later than the write TTL', shotReport);

// 8. Batch forwarding: the call-level budget has to reach the capture inside the batch.
await run('batch, call budget', () => backend.request('batch', {
  steps: [{ action: 'key', keys: KEY }, { action: 'screenshot' }],
  path: shotJpg, format: 'jpeg', scale: 1, stabilityMs: 0,
}, { timeoutMs: 60_000 }), 'batch [key, screenshot] with call-level stability_ms 0', batchReport);

// 9. Batch step-level override, which used to be impossible.
await run('batch, step budget', () => backend.request('batch', {
  steps: [{ action: 'key', keys: KEY }, { action: 'screenshot', stability_ms: 400 }],
  path: shotJpg, format: 'jpeg', scale: 1,
}, { timeoutMs: 60_000 }), 'batch with a step-level stability_ms of 400', batchReport);

// 10. A window capture after a write: the poll samples the window's own pixels.
await run('window capture', async () => {
  await write();
  const health = await backend.request('health', {}, { timeoutMs: 30_000 });
  return backend.request('screenshot', { path: shotJpg, format: 'jpeg', window: health.foregroundHwnd }, { timeoutMs: 60_000 });
}, 'window capture after a write (samples the window, not the screen)', shotReport);

// 11. Evidence reuse: a batch whose trailing capture can stand in for the after-reading.
await run('batch evidence', () => backend.request('batch', {
  steps: [{ action: 'key', keys: KEY }],
  path: shotJpg, format: 'jpeg', scale: 1, screenshot: true, evidence: true,
}, { timeoutMs: 60_000 }), 'evidence taken from the batch own capture when it can', batchReport);

// Compliance, stated as a check rather than left to the eye.
const budgeted = cases.filter((row) => row.stability && Number(row.stability.budgetMs) > 0);
const overruns = budgeted.filter((row) => Number(row.stability.waitedMs) > Number(row.stability.budgetMs) + 400);
const tooFew = cases.filter((row) => row.stability && row.stability.state === 'stable' && Number(row.stability.polls) < 2);
const reused = cases.find((row) => row.label === 'batch evidence');
console.log('');
console.log(`budget compliance: ${budgeted.length} case(s) with a budget > 0, ${overruns.length} overrun(s) beyond budget + 400 ms`);
console.log(`two-sample rule:   ${tooFew.length} case(s) claimed 'stable' on fewer than two samples`);
console.log(`evidence reuse:    ${reused?.evidence?.reused === true ? 'the batch own capture was used' : 'taken separately (no capture covered the evidence rectangle)'}`);

backend.dispose();
if (jsonAt !== -1) {
  const out = argv[jsonAt + 1];
  writeFileSync(out, JSON.stringify({ when: new Date().toISOString(), rounds: ROUNDS, key: KEY, pacing: pacing.after ?? pacing, cases }, null, 2));
  console.log(`wrote ${out}`);
}
