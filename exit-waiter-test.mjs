/**
 * PR04 —— "进程真的没了"必须有据可依（方案 4.4）。
 *
 * 被证伪的旧行为：`#exited` 把 `wait.finally(...)` 返回的**新** Promise 存进 `#exitPromise`，
 * 却在 finally 里拿 `wait` 去比较清空；两者永不相等，引用永远留着。下一次停止拿到上一代那个
 * 已经 resolve 的 Promise，于是"还没退出"被当成"已退出"。
 *
 * 这里用一个只有 `once/emit` 的假进程，验证抽出来的等待器满足四条契约：
 *
 *   - 同一个 child 重复等待拿到同一个 Promise（幂等，不重复挂监听器）；
 *   - 只有这个 child 的 exit 才结束这次等待，上一个 child 的迟到 exit 不算；
 *   - 等待结束（无论退出还是超时）后引用被清空，下一次等待是新的等待；
 *   - 超时是 `'timeout'` 这个**结果**，不是"已退出"；已经退出的 child 直接给 `'exited'`。
 *
 *   node exit-waiter-test.mjs
 */
import { createExitWaiter } from './internal/generation.mjs';

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}

/** A child process with exactly the surface the waiter uses. */
function fakeChild(name) {
  const handlers = new Map();
  return {
    name,
    exitCode: null,
    once(event, fn) { handlers.set(event, fn); return this; },
    emit(event) {
      if (event === 'exit') this.exitCode = 0;
      const fn = handlers.get(event);
      handlers.delete(event);
      if (fn !== undefined) fn();
    },
    listenerCount() { return handlers.size; },
  };
}

/** Did this promise settle within `ms`? Returns the value or the string 'pending'. */
async function settleWithin(promise, ms) {
  const timer = new Promise((resolve) => setTimeout(() => resolve('pending'), ms));
  return Promise.race([promise, timer]);
}

console.log('\n== a stop is confirmed by the exit event, and the reference is released ==');
{
  const waiter = createExitWaiter({ timeoutMs: 500 });
  const child = fakeChild('A');
  let settled = null;
  const wait = waiter.waitForExit(child).then((how) => { settled = how; return how; });
  check('the waiter reports that it is waiting', waiter.busy === true && waiter.currentChild === child);
  check('nothing has settled yet', settled === null, String(settled));
  // One listener per event the waiter watches (exit and error), and no more.
  check('the wait registered its exit/error listeners once', child.listenerCount() === 2, String(child.listenerCount()));
  child.emit('exit');
  check('the wait answers "exited"', (await wait) === 'exited', String(settled));
  check('and the waiter is idle again', waiter.busy === false && waiter.currentChild === null);
}

console.log('\n== the same child is waited for once, no matter how often stop is called ==');
{
  const waiter = createExitWaiter({ timeoutMs: 500 });
  const child = fakeChild('A');
  const first = waiter.waitForExit(child);
  const second = waiter.waitForExit(child);
  check('the second call returns the same promise', first === second);
  check('no extra listeners were attached by the second call', child.listenerCount() === 2, String(child.listenerCount()));
  child.emit('exit');
  await first;
  check('both callers see the exit', (await second) === 'exited');
}

console.log('\n== a late exit from the previous process does not finish the next wait ==');
{
  const waiter = createExitWaiter({ timeoutMs: 60 });
  const first = fakeChild('A');
  const second = fakeChild('B');
  const waitA = waiter.waitForExit(first);
  first.emit('exit');
  check('the first wait finished', (await waitA) === 'exited');
  const waitB = waiter.waitForExit(second);
  first.emit('exit'); // the process that is already gone firing again must not matter
  check('the new wait is still pending after the old process fires again', (await settleWithin(waitB, 20)) === 'pending', 'it settled');
  second.emit('exit');
  check('and it finishes on its own process', (await waitB) === 'exited');
}

console.log('\n== timing out is a result, not a confirmation ==');
{
  // The waiter's timer is unref'd on purpose (a pending exit wait must not keep the host alive).
  // In production the child process handle keeps the loop alive; here a keep-alive stands in.
  const keepAlive = setInterval(() => {}, 250);
  const waiter = createExitWaiter({ timeoutMs: 60 });
  const child = fakeChild('A');
  const started = Date.now();
  const how = await waiter.waitForExit(child);
  const elapsed = Date.now() - started;
  check('the outcome is "timeout"', how === 'timeout', String(how));
  check('it waited roughly the budget', elapsed >= 50 && elapsed < 1000, `${elapsed} ms`);
  check('the reference is released after a timeout too', waiter.busy === false);
  // The process is still alive: a second stop must start a new wait rather than reuse the
  // timed-out one; reusing it would report an exit that never happened.
  const again = waiter.waitForExit(child);
  check('a second wait is a fresh wait', waiter.busy === true);
  child.emit('exit');
  check('and it can still observe the real exit', (await again) === 'exited');
  clearInterval(keepAlive);
}

console.log('\n== a process that is already gone, and no process at all ==');
{
  const waiter = createExitWaiter({ timeoutMs: 500 });
  const gone = fakeChild('A');
  gone.exitCode = 3;
  check('an exited child answers immediately', (await waiter.waitForExit(gone)) === 'exited');
  check('waiting for nothing is "absent"', (await waiter.waitForExit(null)) === 'absent');
  const erroring = fakeChild('E');
  const wait = waiter.waitForExit(erroring);
  erroring.emit('error');
  check('an error event is its own outcome', (await wait) === 'error');
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
