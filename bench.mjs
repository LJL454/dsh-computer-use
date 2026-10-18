/**
 * Latency benchmark for the computer-use backend.
 *
 * Measures the real hot paths the model pays for on every GUI step:
 *   worker cold start, ping, screenshot (full screen / region / downscaled),
 *   click, cursor, windows, focus, UI Automation tree.
 *
 * ⚠ This is a *desktop* benchmark, not a side-effect-free check: it clicks at (40, 40), so it
 * must not be run as part of an ordinary test sweep (9.txt §12.2). Use `--no-side-effects` to
 * skip that one step and measure everything else (every other step here is a read).
 *
 * Usage:  node bench.mjs [--rounds N] [--json out.json] [--no-side-effects]
 */
import { PowerShellBackend } from './backend/bridge.js';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const roundsArg = args.indexOf('--rounds');
const ROUNDS = roundsArg === -1 ? 5 : Number(args[roundsArg + 1]);
const jsonArg = args.indexOf('--json');
/** §12.2: the click is the only step here that touches the desktop; everything else is a read. */
const NO_SIDE_EFFECTS = args.includes('--no-side-effects');

const backend = new PowerShellBackend();

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    min: Math.round(sorted[0]),
    median: Math.round(sorted[Math.floor(sorted.length / 2)]),
    mean: Math.round(sum / sorted.length),
    max: Math.round(sorted[sorted.length - 1]),
  };
}

async function timeIt(label, fn, rounds = ROUNDS) {
  const samples = [];
  let last;
  let blocked;
  for (let i = 0; i < rounds; i += 1) {
    const t0 = performance.now();
    try {
      last = await fn(i);
    } catch (error) {
      // A desktop that has stopped accepting synthesized input — a locked
      // workstation, or a session detached from the console — fails every injection
      // case with the backend's "the pointer did not reach …" error. Reporting that
      // as a skipped case keeps the rest of the numbers readable.
      blocked = error.message;
      break;
    }
    samples.push(performance.now() - t0);
  }
  if (blocked !== undefined) {
    console.log(`${label.padEnd(34)} (skipped: ${blocked.slice(0, 90)})`);
    return { label, n: 0, min: 0, median: 0, mean: 0, max: 0, extra: '', blocked: blocked.slice(0, 200) };
  }
  const s = stats(samples);
  const extra = typeof last === 'object' && last !== null && 'note' in last ? `  ${last.note}` : '';
  console.log(
    `${label.padEnd(34)} min=${String(s.min).padStart(6)}ms  median=${String(s.median).padStart(6)}ms  mean=${String(s.mean).padStart(6)}ms  max=${String(s.max).padStart(6)}ms${extra}`,
  );
  return { label, ...s, extra: extra.trim() };
}

const shotPng = join(tmpdir(), 'dsh-cu-bench.png');
const shotJpg = join(tmpdir(), 'dsh-cu-bench.jpg');
const results = [];

console.log('--- computer-use backend benchmark ---');
console.log(`rounds per case: ${ROUNDS}\n`);

const t0 = performance.now();
const info = await backend.start();
const startMs = Math.round(performance.now() - t0);
console.log(`worker cold start                 ${startMs}ms   (pid ${info.pid}, ps ${info.version})\n`);
results.push({ label: 'worker cold start', median: startMs, min: startMs, max: startMs, n: 1 });

results.push(await timeIt('ping (transport floor)', () => backend.request('ping')));
results.push(await timeIt('cursor', () => backend.request('cursor')));
results.push(await timeIt('windows (enum)', () => backend.request('windows', {})));
results.push(await timeIt('screenshot full PNG', () => backend.request('screenshot', { path: shotPng }, { timeoutMs: 60_000 })));
results.push(await timeIt('screenshot full JPEG', () => backend.request('screenshot', { path: shotJpg, format: 'jpeg' }, { timeoutMs: 60_000 })));
results.push(
  await timeIt('screenshot JPEG scale 0.5', () =>
    backend.request('screenshot', { path: shotJpg, format: 'jpeg', scale: 0.5 }, { timeoutMs: 60_000 }),
  ),
);
results.push(
  await timeIt('screenshot region 800x600', () =>
    backend.request('screenshot', { path: shotPng, region: { x: 0, y: 0, width: 800, height: 600 } }, { timeoutMs: 60_000 }),
  ),
);
if (!NO_SIDE_EFFECTS) results.push(await timeIt('click (no move)', () => backend.request('click', { x: 40, y: 40 })));
else results.push({ name: 'click (no move)', skipped: 'the desktop-touching step was skipped (--no-side-effects)' });
// `depth` is not a worker argument: the command takes `maxDepth`, so a benchmark that passed
// `depth` was measuring the default walk and calling it "depth 4" (9.txt §12.2). The name here
// is the argument the worker actually reads.
results.push(
  await timeIt('uitree (foreground, maxDepth 4)', () => backend.request('uitree', { maxDepth: 4 }, { timeoutMs: 60_000 }), 3),
);
results.push(
  await timeIt('uitree find by name', () => backend.request('uitree', { name: 'e', maxNodes: 40 }, { timeoutMs: 60_000 }), 3),
);

// Batching: the same four steps as one call versus four calls. The pipe overhead is
// only 1-3 ms per request, so this is NOT where batching wins — it wins the model
// round trips, each of which costs seconds. The number below is the honest pipe
// difference; the round-trip count is the real prize.
const BATCH_STEPS = [
  { action: 'wait', seconds: 0.05 },
  { action: 'wait', seconds: 0.05 },
  { action: 'wait', seconds: 0.05 },
  { action: 'screenshot', scale: 0.5 },
];
const batched = await timeIt('batch (3 waits + capture)', () =>
  backend.request('batch', { steps: BATCH_STEPS, path: shotJpg, format: 'jpeg', scale: 0.5 }, { timeoutMs: 60_000 }),
);
const separate = await timeIt('the same steps as 4 calls', async () => {
  await backend.request('wait', { seconds: 0.05 });
  await backend.request('wait', { seconds: 0.05 });
  await backend.request('wait', { seconds: 0.05 });
  await backend.request('screenshot', { path: shotJpg, format: 'jpeg', scale: 0.5 }, { timeoutMs: 60_000 });
});
console.log(
  `\nbatching: one call ${batched.median} ms vs four calls ${separate.median} ms ` +
  `(pipe difference ${separate.median - batched.median} ms; the real saving is 3 fewer model round trips)`,
);

const total = results.filter((r) => r.n > 1).reduce((acc, r) => acc + r.median, 0);
console.log(`\nsum of medians (excluding cold start): ${total}ms`);

backend.dispose();
if (jsonArg !== -1) {
  const out = args[jsonArg + 1];
  writeFileSync(out, JSON.stringify({ when: new Date().toISOString(), rounds: ROUNDS, results }, null, 2));
  console.log(`wrote ${out}`);
}
