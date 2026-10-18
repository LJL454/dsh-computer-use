/**
 * The transport's own promises (9.txt §5.12), against a worker that answers the protocol and
 * touches no desktop.
 *
 * The three failures the review named are all transport failures, and each one is checked
 * here by its consequence rather than by its message --
 *
 *   - arguments that cannot be serialized must not leave the run slot occupied: the *next*
 *     request is the evidence, because a queue that stopped advancing is the actual damage;
 *   - a request that never answers is dropped, the worker is replaced, and the request after
 *     it runs on a fresh instance;
 *   - a `start()` that is disposed while it waits for readiness is settled instead of left
 *     hanging, and a backend that was disposed refuses further work.
 *
 *   node tests/bridge/plugin-test.mjs
 */
import { join } from 'node:path';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { PowerShellBackend } from '../../backend/bridge.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUB = join(HERE, 'fixtures', 'stub-worker.ps1');
const SLOW = join(HERE, 'fixtures', 'slow-worker.ps1');
const LATE = join(HERE, 'fixtures', 'late-worker.ps1');

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withTimeout(promise, ms, what) {
  let timer = null;
  const guard = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle within ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, guard]);
  } finally {
    clearTimeout(timer);
  }
}

const backends = [];
function backendFor(scriptPath, options = {}) {
  const backend = new PowerShellBackend({ scriptPath, startTimeoutMs: 30_000, timeoutMs: 10_000, ...options });
  backends.push(backend);
  return backend;
}

try {
  console.log('== a healthy request round-trips and leaves nothing behind ==');
  {
    const backend = backendFor(STUB);
    const info = await backend.start();
    check('the worker announces itself', String(info?.generation ?? '').startsWith('stub-'), JSON.stringify(info));
    check('and the backend is in its ready state', backend.state === 'ready', backend.state);
    const result = await backend.request('ping', {});
    check('a request comes back with its result', result?.pong === true, JSON.stringify(result));
    check('and nothing is left outstanding', backend.outstanding === 0, `${backend.outstanding} outstanding`);
    backend.dispose();
  }

  console.log('\n== arguments that cannot be serialized do not block the queue (9.txt §5.12) ==');
  {
    const backend = backendFor(STUB);
    await backend.start();
    const circular = { name: 'loop' };
    circular.self = circular;
    let error = null;
    try {
      await backend.request('batch', { steps: [circular] });
    } catch (failure) {
      error = failure;
    }
    check('the request fails with a named reason', error?.code === 'BAD_REQUEST', JSON.stringify({ code: error?.code }));
    check('and it says nothing reached the desktop', /nothing was sent/.test(error?.message ?? ''), String(error?.message).slice(0, 120));
    check('and it does not occupy the worker', backend.outstanding === 0, `${backend.outstanding} outstanding`);
    const after = await withTimeout(backend.request('ping', {}), 8_000, 'the request after a bad one');
    check('the next request still runs (the queue kept moving)', after?.pong === true, JSON.stringify(after));
    backend.dispose();
  }

  console.log('\n== a request that never answers is dropped, and the next one runs clean (§5.12) ==');
  {
    const backend = backendFor(STUB, { timeoutMs: 30_000 });
    const first = await backend.start();
    let error = null;
    try {
      await backend.request('hang', {}, { timeoutMs: 700 });
    } catch (failure) {
      error = failure;
    }
    check('the deadline is reported as a timeout', error?.code === 'TIMEOUT', JSON.stringify({ code: error?.code }));
    check('and it is marked as dispatched, so nobody replays it blindly', error?.dispatched === true, JSON.stringify({ dispatched: error?.dispatched }));
    check('the timed-out request no longer occupies the backend', backend.outstanding === 0, `${backend.outstanding} outstanding`);
    const next = await withTimeout(backend.request('ping', {}), 20_000, 'the request after a timeout');
    check('the next request answers on a fresh worker', next?.pong === true, JSON.stringify(next));
    const info = backend.info ?? {};
    check('and that worker is a new instance, not the one that was killed', String(info.generation ?? '') !== String(first?.generation ?? ''), JSON.stringify({ before: first?.generation, after: info.generation }));
    check('the spawn counter shows the replacement', backend.stats.spawns >= 2, JSON.stringify(backend.stats));
    backend.dispose();
  }

  console.log('\n== waiting for a start and queueing behind another call are measured apart (§7.5) ==');
  {
    const backend = backendFor(LATE);
    // This worker becomes ready after ~500 ms, so the first request really does pay a start.
    const first = await backend.request('ping', {});
    const coldTiming = first?.__bridgeTiming;
    check('a request reports its timing at all', coldTiming !== undefined, JSON.stringify(first));
    check('the cold call reports the time it spent waiting for the worker to start', Number(coldTiming?.startMs) >= 300, JSON.stringify(coldTiming));
    check('and that wait is not counted as queue time', Number(coldTiming?.queueMs ?? 0) < 100, JSON.stringify(coldTiming));
    check('the command it ran is still named', coldTiming?.cmd === 'ping', JSON.stringify(coldTiming));
    // The next call pays nothing to start, and says so.
    const warm = await backend.request('ping', {});
    check('a warm call reports no start wait at all', Number(warm?.__bridgeTiming?.startMs ?? -1) === 0, JSON.stringify(warm?.__bridgeTiming));
    check('while the step time is still reported', Number(warm?.__bridgeTiming?.workerMs ?? -1) >= 0, JSON.stringify(warm?.__bridgeTiming));
    backend.dispose();
  }

  console.log('\n== a force-kill releases recorded input through an independent process (§6 item 4) ==');
  {
    const heldDir = mkdtempSync(join(tmpdir(), 'dsh-held-'));
    const held = join(heldDir, 'held.json');
    // What a worker holding the left button and Shift would have mirrored.
    writeFileSync(held, JSON.stringify({ pid: 4242, bootGen: 'ab12', keys: [16], buttons: [2] }), 'utf8');
    const backend = backendFor(STUB, { timeoutMs: 30_000, heldFilePath: held });
    await backend.start();
    let error = null;
    try {
      // The stub never answers `hang`: the request times out, and that is what force-kills it.
      await backend.request('hang', {}, { timeoutMs: 600 });
    } catch (failure) {
      error = failure;
    }
    check('the request still fails as a timeout', error?.code === 'TIMEOUT', JSON.stringify({ code: error?.code }));
    check('the independent release ran and says what it released',
      error?.releaseConfirmed === true && Array.isArray(error?.released) && error.released.includes('mouse:left'),
      JSON.stringify({ confirmed: error?.releaseConfirmed, released: error?.released, releaseError: error?.releaseError }));
    check('the shift key that was recorded is released too',
      Array.isArray(error?.released) && error.released.includes('key:16'),
      JSON.stringify(error?.released));
    check('and the record is cleared, so nothing is released twice',
      !existsSync(held), 'the held record survived a confirmed release');
    check('the backend keeps the outcome for diagnostics',
      backend.lastRelease?.releaseConfirmed === true, JSON.stringify(backend.lastRelease));

    // A record that cannot be read must be reported, never read as "nothing was held".
    const broken = join(heldDir, 'broken.json');
    writeFileSync(broken, '{ not json', 'utf8');
    const second = backendFor(SLOW, { timeoutMs: 5_000, startTimeoutMs: 5_000, heldFilePath: broken });
    let startError = null;
    try {
      await second.start();
    } catch (failure) {
      startError = failure;
    }
    check('a start that never becomes ready still fails on its own terms', startError !== null, 'it started after all');
    // The release of that kill is bounded but asynchronous: give it its moment before reading.
    for (let i = 0; i < 40 && second.lastRelease === null; i += 1) await sleep(100);
    check('an unreadable record is reported as a failure to release',
      second.lastRelease?.releaseConfirmed === false && /could not be read/.test(String(second.lastRelease?.releaseError)),
      JSON.stringify(second.lastRelease));
    check('and that record is left in place for the caller to look at', existsSync(broken), 'it was deleted anyway');
    second.dispose();
  }

  console.log('\n== a start that is disposed while it waits is settled (9.txt §5.12) ==');
  {
    const backend = backendFor(SLOW);
    const starting = backend.start();
    await sleep(200);
    backend.dispose();
    let error = null;
    try {
      await withTimeout(starting, 5_000, 'the disposed start');
    } catch (failure) {
      error = failure;
    }
    check('the waiting start is rejected instead of hanging', error?.code === 'DISPOSED', JSON.stringify({ code: error?.code, message: String(error?.message).slice(0, 90) }));
    check('and the backend reports itself as disposed', backend.state === 'disposed', backend.state);
    let later = null;
    try {
      await backend.request('ping', {});
    } catch (failure) {
      later = failure;
    }
    check('a request afterwards is refused', later?.code === 'DISPOSED', JSON.stringify({ code: later?.code }));
  }
} catch (error) {
  console.error('tests/bridge/plugin-test crashed:', error);
  process.exitCode = 1;
} finally {
  for (const backend of backends) {
    try { backend.dispose(); } catch { /* already gone */ }
  }
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log('\nfailures:');
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  }
  // A disposed backend keeps a short-lived killer timer; let it fire before the process ends.
  setTimeout(() => process.exit(process.exitCode ?? 0), 1200).unref();
}
