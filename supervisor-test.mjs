/**
 * PR06 —— 六步停止协议与代次（方案 4.4）。
 *
 * 旧实现的停止是一句话："发 shutdown，800 毫秒后 kill"。没有准入关闭、没有协作等待与强制终止的
 * 分界，也分不清"进程真的没了"与"按住的键真的松了"。这里逐个断言方案的六步与三条判据：
 *
 *   - 顺序：close-admission → cancel-in-flight → cooperative-wait → terminate → await-exit → release → cleanup；
 *   - 预算：协作等待到期不等于停止成功，退出未确认必须落到 `faulted`；
 *   - 分离记账：`exitConfirmed` 与 `releaseConfirmed` 是两个字段，互不顶替；
 *   - 幂等：同一代重复停止拿到同一份报告，钩子只跑一次；
 *   - 代次：`admitsRequests` 只在 starting/ready 为真。
 *
 * 最后一段用一个两代假 worker 验证"未派发的请求属于下一代"：上一代超时被杀，排队的那条在新代上
 * 照常跑完，而不是陪葬成 WORKER_EXITED。
 *
 *   node supervisor-test.mjs
 */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Generation, STOP_BUDGETS, stopGeneration } from './backend/supervisor.mjs';
import { PowerShellBackend } from './backend/bridge.js';

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------ state machine */

console.log('\n== a generation only admits requests while it is starting or ready ==');
{
  const generation = new Generation({ id: 3 });
  check('a fresh generation does not admit', generation.admitsRequests === false, generation.state);
  generation.markStarting();
  check('starting admits', generation.state === 'starting' && generation.admitsRequests === true);
  generation.markReady();
  check('ready admits', generation.state === 'ready' && generation.admitsRequests === true);
  generation.markStopping('a test');
  check('stopping does not admit', generation.admitsRequests === false && generation.reason === 'a test', generation.state);
  generation.markStopped();
  check('stopped does not admit', generation.state === 'stopped' && generation.admitsRequests === false);
  const faulted = new Generation({ id: 4 });
  faulted.markFaulted('exit never confirmed');
  check('faulted carries its reason', faulted.state === 'faulted' && faulted.reason === 'exit never confirmed');
}

/* ---------------------------------------------------------------- six steps */

console.log('\n== the six steps run in order, and both confirmations are recorded ==');
{
  const order = [];
  const generation = new Generation({ id: 1 });
  const report = await stopGeneration(generation, {
    reason: 'a test stop',
    budgets: { cooperativeMs: 200, exitMs: 200, releaseMs: 200 },
    closeAdmission: () => { order.push('close'); return 2; },
    cancelInFlight: () => { order.push('cancel'); return true; },
    waitForDrain: () => { order.push('drain'); return true; },
    kill: () => { order.push('kill'); },
    waitForExit: () => { order.push('exit'); return 'exited'; },
    release: () => { order.push('release'); return { releaseConfirmed: true, released: ['mouse:left'] }; },
    cleanup: () => { order.push('cleanup'); },
  });
  check('every hook ran, in the documented order', JSON.stringify(order) === JSON.stringify(['close', 'cancel', 'drain', 'kill', 'exit', 'release', 'cleanup']), JSON.stringify(order));
  check('admission is reported closed', report.admissionClosed === true);
  check('the cancelled count is carried', report.cancelled === 2, String(report.cancelled));
  check('the cooperative wait drained', report.cooperative === 'drained', report.cooperative);
  check('exit is confirmed', report.exitConfirmed === true && report.exitHow === 'exited', `${report.exitConfirmed}/${report.exitHow}`);
  check('the release is confirmed separately', report.releaseConfirmed === true && JSON.stringify(report.released) === JSON.stringify(['mouse:left']), `${report.releaseConfirmed}/${JSON.stringify(report.released)}`);
  check('the generation ends stopped', report.state === 'stopped' && generation.state === 'stopped', `${report.state}/${generation.state}`);
  check('the report names each step with its own timing', report.steps.map((one) => one.name).join(',') === 'close-admission,cancel-in-flight,cooperative-wait,terminate,await-exit,release,cleanup', JSON.stringify(report.steps.map((one) => one.name)));
  check('the report carries a total duration', Number.isFinite(report.ms), String(report.ms));
  check('the reason is recorded', report.reason === 'a test stop', report.reason);
}

console.log('\n== a cooperative wait that runs out still terminates the process ==');
{
  let killed = false;
  const started = Date.now();
  const report = await stopGeneration(new Generation({ id: 2 }), {
    reason: 'drain test',
    budgets: { cooperativeMs: 120, exitMs: 200, releaseMs: 200 },
    waitForDrain: () => new Promise(() => {}), // never finishes
    kill: () => { killed = true; },
    waitForExit: () => 'exited',
    release: () => ({ releaseConfirmed: true, released: [] }),
  });
  const elapsed = Date.now() - started;
  check('the wait is reported as a timeout', report.cooperative === 'timeout', report.cooperative);
  check('the process was still terminated', killed === true);
  check('it took roughly the cooperative budget', elapsed >= 100 && elapsed < 1500, `${elapsed} ms`);
  check('and the stop still completed', report.exitConfirmed === true && report.state === 'stopped', report.state);
}

console.log('\n== an exit that is never confirmed is a fault, not a stop ==');
{
  const order = [];
  const generation = new Generation({ id: 3 });
  const report = await stopGeneration(generation, {
    reason: 'exit test',
    budgets: { cooperativeMs: 50, exitMs: 80, releaseMs: 200 },
    waitForDrain: () => true,
    kill: () => order.push('kill'),
    waitForExit: () => new Promise(() => {}),
    release: () => { order.push('release'); return { releaseConfirmed: false, released: [], releaseError: 'the key is still down' }; },
  });
  check('exit is not confirmed', report.exitConfirmed === false && report.exitHow === 'timeout', `${report.exitConfirmed}/${report.exitHow}`);
  check('the generation is faulted', report.faulted === true && generation.state === 'faulted', generation.state);
  check('the release was still attempted, and says so', order.includes('release') && report.releaseAfterExit === false);
  check('a failed release does not turn into a confirmed one', report.releaseConfirmed === false && report.releaseError === 'the key is still down', String(report.releaseError));
}

console.log('\n== a hook that throws does not abort the stop ==');
{
  const report = await stopGeneration(new Generation({ id: 4 }), {
    reason: 'hook test',
    budgets: { cooperativeMs: 50, exitMs: 50, releaseMs: 50 },
    cancelInFlight: () => { throw new Error('the pipe is gone'); },
    kill: () => {},
    waitForExit: () => 'exited',
    release: () => ({ releaseConfirmed: true, released: [] }),
  });
  check('the failing step is recorded', report.steps.find((one) => one.name === 'cancel-in-flight')?.ok === false, JSON.stringify(report.steps.find((one) => one.name === 'cancel-in-flight')));
  check('and the stop still completed', report.exitConfirmed === true && report.state === 'stopped');
}

console.log('\n== stopping the same generation twice runs the hooks once ==');
{
  let closes = 0;
  const generation = new Generation({ id: 5 });
  const hooks = {
    reason: 'idempotence',
    budgets: { cooperativeMs: 50, exitMs: 50, releaseMs: 50 },
    closeAdmission: () => { closes += 1; return 0; },
    waitForDrain: () => true,
    kill: () => {},
    waitForExit: () => 'exited',
    release: () => ({ releaseConfirmed: true, released: [] }),
  };
  const first = stopGeneration(generation, hooks);
  const second = stopGeneration(generation, hooks);
  const [a, b] = await Promise.all([first, second]);
  check('both callers get the same report', a === b);
  check('admission was closed once', closes === 1, String(closes));
  const third = await stopGeneration(generation, hooks);
  check('a later stop returns the recorded report without running again', third === a && closes === 1, String(closes));
}

console.log('\n== the default budgets are the starting values the plan names ==');
check('cooperative 0.8 s', STOP_BUDGETS.cooperativeMs === 800, String(STOP_BUDGETS.cooperativeMs));
check('exit confirmation 2 s', STOP_BUDGETS.exitMs === 2000, String(STOP_BUDGETS.exitMs));
check('release 5 s', STOP_BUDGETS.releaseMs === 5000, String(STOP_BUDGETS.releaseMs));

/* ---------------------------------------------- a queued request, two generations */

const dir = mkdtempSync(join(tmpdir(), 'dsh-cu-supervisor-'));
const scriptPath = join(dir, 'worker.ps1');
writeFileSync(scriptPath, '# stand-in\n');

class FakeWorker extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.pid = 100;
    this.exitCode = null;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = new PassThrough();
    this.written = [];
    this.stdin.on('data', (chunk) => this.written.push(String(chunk)));
  }
  send(payload) { this.stdout.write(`${JSON.stringify(payload)}\n`); }
  kill() { this.exitCode = 0; this.emit('exit', 0, null); }
}

console.log('\n== a request that was never dispatched survives the restart ==');
{
  const first = new FakeWorker('gen-1');
  const second = new FakeWorker('gen-2');
  let spawns = 0;
  const backend = new PowerShellBackend({
    scriptPath,
    powerShell: 'fake',
    startTimeoutMs: 1000,
    timeoutMs: 2000,
    cancelGraceMs: 100,
    cancelFilePath: join(dir, 'cancel.txt'),
    stopBudgets: { cooperativeMs: 100, exitMs: 500, releaseMs: 200 },
    spawn: () => {
      spawns += 1;
      const worker = spawns === 1 ? first : second;
      setImmediate(() => worker.send({ ready: true, info: {} }));
      return worker;
    },
  });
  // 第一代只回 'ping'，'click' 永远不答（模拟卡住的 UIA 调用）。
  first.stdin.on('data', (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim() === '') continue;
      const request = JSON.parse(line);
      if (request.cmd === 'click') continue;
      first.send({ id: request.id, ok: true, result: { from: 'gen-1' } });
    }
  });
  second.stdin.on('data', (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim() === '') continue;
      const request = JSON.parse(line);
      second.send({ id: request.id, ok: true, result: { from: 'gen-2', echo: request.cmd } });
    }
  });

  const stuck = backend.request('click', {}).then((value) => ({ value }), (error) => ({ error }));
  await sleep(30);
  const queued = backend.request('type', { text: 'x' }).then((value) => ({ value }), (error) => ({ error }));
  const [a, b] = await Promise.all([stuck, queued]);
  check('the stuck call ends as a timeout', a.error?.code === 'TIMEOUT', String(a.error?.code));
  check('its receipt says the stop was a timeout', a.error?.receipt?.interruption === 'timeout', String(a.error?.receipt?.interruption));
  check('its stop report confirms the exit', a.error?.stopReport?.exitConfirmed === true, JSON.stringify(a.error?.stopReport)?.slice(0, 120));
  check('a second generation was started', spawns === 2, String(spawns));
  check('the queued call ran on the new generation instead of being failed', b.value?.from === 'gen-2', JSON.stringify(b).slice(0, 160));
  check('and it was actually written to the new worker', String(second.written.join('')).includes('"type"'), second.written.join('').slice(0, 120));
  check('the last stop report is kept for diagnostics', backend.lastStopReport?.exitConfirmed === true, JSON.stringify(backend.lastStopReport)?.slice(0, 120));
  backend.dispose();
}

rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
