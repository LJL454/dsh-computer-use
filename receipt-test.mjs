/**
 * PR05 —— 请求级回执（方案 4.3）。
 *
 * 方案点名的那条旧行为：失败路径只知道 `dispatched: true`，把所有"写进去了 / 收到了应答 /
 * 结果不确定"压成一个布尔，再用**同一个** Error 实例拒给所有请求。于是调用方无法区分
 * "这条排队时就被取消，桌面上一件事都没发生"和"这条已经发出去、结果未知"——而这恰好是
 * "要不要重试"的唯一判据。
 *
 * 这份测试用注入的假 worker 进程驱动**真实的传输层**（`PowerShellBackend`），行文只在
 * 三种事实上：
 *
 *   1. 取消一个还在队列里的请求 → `not_sent` + `cancel` + `continue`，且管道里确实没有它；
 *   2. 写出去之后超时 → `sent_to_driver` + `timeout` + `stop`，不是 `failed`、也不能重放；
 *   3. worker 回了错 → `driver_ack` + `observe`；
 *   4. dispose 时队列与在飞两条请求拿到**不同的** delivery，且是两个不同的错误对象。
 *
 *   node receipt-test.mjs
 */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PowerShellBackend } from './backend/bridge.js';
import { DELIVERY, INTERRUPTION, RECOVERY, VERIFICATION, annotateError, createReceipt, mayRetry, receiptFromError, recoveryFor } from './internal/receipt.mjs';

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* --------------------------------------------------------------- pure part */

console.log('\n== the three axes each say one thing ==');
check('nothing sent + no error is a plain continue', recoveryFor({ delivery: DELIVERY.not_sent }) === RECOVERY.continue);
check('nothing sent but cancelled is still continue', recoveryFor({ delivery: DELIVERY.not_sent, interruption: INTERRUPTION.cancel }) === RECOVERY.continue);
check('sent but not acknowledged is observe', recoveryFor({ delivery: DELIVERY.sent_to_driver }) === RECOVERY.observe);
check('an unknown write is observe', recoveryFor({ delivery: DELIVERY.unknown }) === RECOVERY.observe);
check('acknowledged but failed is observe', recoveryFor({ delivery: DELIVERY.driver_ack, errorCode: 'WORKER_ERROR' }) === RECOVERY.observe);
check('acknowledged and verified is continue', recoveryFor({ delivery: DELIVERY.driver_ack, verification: VERIFICATION.matched }) === RECOVERY.continue);
check('a mismatch is observe', recoveryFor({ delivery: DELIVERY.driver_ack, verification: VERIFICATION.mismatch }) === RECOVERY.observe);
check('a timeout stops', recoveryFor({ delivery: DELIVERY.sent_to_driver, interruption: INTERRUPTION.timeout }) === RECOVERY.stop);
check('a dead driver stops', recoveryFor({ delivery: DELIVERY.driver_ack, interruption: INTERRUPTION.driver_exit }) === RECOVERY.stop);

console.log('\n== only "nothing was sent" may be retried ==');
check('not_sent may be retried', mayRetry(createReceipt({ delivery: DELIVERY.not_sent })) === true);
check('sent_to_driver may not', mayRetry(createReceipt({ delivery: DELIVERY.sent_to_driver })) === false);
check('unknown may not', mayRetry(createReceipt({ delivery: DELIVERY.unknown })) === false);
check('driver_ack may not', mayRetry(createReceipt({ delivery: DELIVERY.driver_ack })) === false);
check('a timeout after a write may not', mayRetry(createReceipt({ delivery: DELIVERY.sent_to_driver, interruption: INTERRUPTION.timeout })) === false);
check('a missing receipt may not', mayRetry(null) === false);

console.log('\n== the receipt is internal: non-enumerable, but readable ==');
{
  const error = new Error('boom');
  const receipt = createReceipt({ requestId: 7, delivery: DELIVERY.sent_to_driver, errorCode: 'TIMEOUT' });
  annotateError(error, receipt);
  check('the receipt is readable off the error', error.receipt?.requestId === 7, JSON.stringify(error.receipt));
  check('it does not appear in Object.keys', !Object.keys(error).includes('receipt'), Object.keys(error).join(','));
  check('it does not leak into JSON', !JSON.stringify(error).includes('"requestId"'), JSON.stringify(error));
  check('delivery is the one field that stays enumerable', error.delivery === DELIVERY.sent_to_driver, String(error.delivery));
  check('a legacy error without a receipt is read back honestly', receiptFromError(new Error('x')).delivery === DELIVERY.not_sent);
  check('a legacy dispatched error is unknown, not not_sent', receiptFromError(Object.assign(new Error('x'), { dispatched: true })).delivery === DELIVERY.unknown);
}

/* ------------------------------------------------------------- fake worker */

const dir = mkdtempSync(join(tmpdir(), 'dsh-cu-receipt-'));
const scriptPath = join(dir, 'worker.ps1');
writeFileSync(scriptPath, '# a stand-in: the real spawn is injected below\n');

/**
 * A worker process with the surface the transport uses. `stdin.write` resolves its callback on
 * the next tick, which is exactly the "flushed to the pipe" evidence the receipt records.
 */
class FakeWorker extends EventEmitter {
  constructor() {
    super();
    this.pid = 4242;
    this.exitCode = null;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.written = [];
    this.stdin = new PassThrough();
    this.stdin.on('data', (chunk) => this.written.push(String(chunk)));
  }
  send(payload) { this.stdout.write(`${JSON.stringify(payload)}\n`); }
  ready() { this.send({ ready: true, info: { version: 'fake' } }); }
  kill() { this.exitCode = 0; this.emit('exit', 0, null); }
}

/** A backend whose worker is a fake; `reply` decides what the fake does with each request. */
async function backendWith(reply) {
  const worker = new FakeWorker();
  const backend = new PowerShellBackend({
    scriptPath,
    powerShell: 'fake-powershell',
    startTimeoutMs: 1000,
    timeoutMs: 500,
    cancelGraceMs: 100,
    cancelFilePath: join(dir, `cancel-${Math.random().toString(16).slice(2)}.txt`),
    spawn: () => { setImmediate(() => worker.ready()); return worker; },
  });
  worker.stdin.on('data', (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim() === '') continue;
      const request = JSON.parse(line);
      reply?.(worker, request);
    }
  });
  return { backend, worker };
}

/* --------------------------------------------------- a cancel before dispatch */

console.log('\n== a request cancelled while queued never reaches the pipe ==');
{
  // The first request is never answered, so the second stays in the queue.
  const { backend, worker } = await backendWith(() => {});
  const first = backend.request('click', { x: 1, y: 2 }).catch((error) => error);
  await sleep(60);
  const controller = new AbortController();
  const second = backend.request('type', { text: 'hello' }, { signal: controller.signal }).catch((error) => error);
  await sleep(20);
  controller.abort();
  const error = await second;
  check('the queued call fails as ABORTED', error?.code === 'ABORTED', String(error?.code));
  check('its delivery is not_sent', error.receipt?.delivery === 'not_sent', String(error.receipt?.delivery));
  check('the interruption is a cancel', error.receipt?.interruption === 'cancel', String(error.receipt?.interruption));
  check('recovery says it may be continued', error.receipt?.recovery === 'continue', String(error.receipt?.recovery));
  check('it may be retried', mayRetry(error.receipt) === true);
  const typed = worker.written.join('');
  check('the cancelled request never reached the worker', !typed.includes('hello'), typed.slice(0, 120));
  backend.dispose();
  await first;
}

/* ------------------------------------------------------ a timeout after a write */

console.log('\n== a request that was written and never answered is unknown, not failed ==');
{
  const { backend, worker } = await backendWith(() => {});
  const error = await backend.request('click', { x: 5, y: 6 }, { timeoutMs: 80 }).catch((failure) => failure);
  check('the call fails as TIMEOUT', error?.code === 'TIMEOUT', String(error?.code));
  check('the worker did receive the line', worker.written.join('').includes('"click"'));
  check('delivery is sent_to_driver (the write was flushed)', error.receipt?.delivery === 'sent_to_driver', String(error.receipt?.delivery));
  check('the interruption is a timeout', error.receipt?.interruption === 'timeout', String(error.receipt?.interruption));
  check('recovery says stop', error.receipt?.recovery === 'stop', String(error.receipt?.recovery));
  check('and it may not be replayed', mayRetry(error.receipt) === false);
  backend.dispose();
}

/* ------------------------------------------------------- an answered failure */

console.log('\n== a worker that answers with an error is acknowledged, and observed ==');
{
  const { backend } = await backendWith((worker, request) => {
    worker.send({ id: request.id, ok: false, error: 'the window is gone' });
  });
  const error = await backend.request('click', {}).catch((failure) => failure);
  check('the error is a WORKER_ERROR', error?.code === 'WORKER_ERROR', String(error?.code));
  check('the receipt says the driver acknowledged it', error.receipt?.delivery === 'driver_ack', String(error.receipt?.delivery));
  check('recovery says observe, not retry', error.receipt?.recovery === 'observe', String(error.receipt?.recovery));
  check('the receipt carries the request id', Number.isFinite(error.receipt?.requestId), String(error.receipt?.requestId));
  backend.dispose();
}

/* --------------------------------------------------- dispose: two deliveries */

console.log('\n== dispose gives the queue and the in-flight request different receipts ==');
{
  const { backend } = await backendWith(() => {});
  const first = backend.request('click', { x: 1 }).catch((error) => error);
  await sleep(40);
  const second = backend.request('type', { text: 'x' }).catch((error) => error);
  await sleep(20);
  backend.dispose();
  const [one, two] = await Promise.all([first, second]);
  check('both fail', one instanceof Error && two instanceof Error, `${one?.code}/${two?.code}`);
  check('they are different error objects', one !== two);
  check('the in-flight one was sent', one.receipt?.delivery === 'sent_to_driver', String(one.receipt?.delivery));
  check('the queued one was never sent', two.receipt?.delivery === 'not_sent', String(two.receipt?.delivery));
  check('both are reported as cancels', one.receipt?.interruption === 'cancel' && two.receipt?.interruption === 'cancel', `${one.receipt?.interruption}/${two.receipt?.interruption}`);
  check('the queued one may be retried, the in-flight one may not', mayRetry(two.receipt) === true && mayRetry(one.receipt) === false);
}

console.log('\n== verifyMs and retryCount are explicit, not implied ==');
{
  // 没做验证的调用：verifyMs 是 null 而不是 0 —— 0 会被读成"很快就验完了"。
  const plain = createReceipt({ delivery: 'sent_to_driver', verification: 'not_requested' });
  check('verifyMs is null when nothing was verified', plain.verifyMs === null, String(plain.verifyMs));
  const verified = createReceipt({ delivery: 'sent_to_driver', verification: 'matched', verifyMs: 12 });
  check('verifyMs is reported when it was measured', verified.verifyMs === 12, String(verified.verifyMs));
  check('retryCount defaults to zero', plain.retryCount === 0, String(plain.retryCount));
  const clamped = createReceipt({ retryCount: -3 });
  check('a negative retryCount cannot be reported', clamped.retryCount === 0, String(clamped.retryCount));
  const truncated = createReceipt({ retryCount: 2.9 });
  check('retryCount is a whole number', truncated.retryCount === 2, String(truncated.retryCount));
  check('a write that was sent still cannot be retried', mayRetry(plain) === false);
}

rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
