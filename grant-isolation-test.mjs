/**
 * PR07 —— 派发准入与按会话取消（方案 4.5）。
 *
 * 方案点名的两个 P0：
 *
 *   - **慢启动后派发**：调用在启动 worker 之前就拿到了许可，启动完成后没有复核持有者，于是
 *     "撤权发生在启动期间"这条路上，一条已经失效的调用照样会写进桌面。
 *   - **`cancelAll` 扩散**：撤销一个会话时对共享 worker 调用 `cancelAll`，同时用电脑的另一个
 *     会话会看到自己无法解释的中断。
 *
 * 这份测试分三层，每层都能单独失败：
 *
 *   1. 纯函数：代次与准入判定（续授权不复活旧调用、销毁同样推进代次）；
 *   2. 传输层：`cancelSession(A)` 只结束 A 的请求，B 的请求照常跑完；
 *   3. 公开入口：用打桩的后端让 `computer_type` 卡在 interactive 健康检查上，在那一刻撤销会话，
 *      放行之后**真实的** `call()` 必须在派发前拒绝，且 type 一次都没被派发。
 *
 *   node grant-isolation-test.mjs
 */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { PowerShellBackend } from './backend/bridge.js';
import { createSessions } from './internal/sessions.mjs';
import { capture, check } from './internal/admission.mjs';

let passed = 0;
const failures = [];
function checkThat(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------ epochs */

console.log('\n== a revocation moves the epoch, and turning it back on does not move it back ==');
{
  const sessions = createSessions({ defaultEnabled: false });
  checkThat('a fresh session starts at epoch 0', sessions.epoch('A') === 0, String(sessions.epoch('A')));
  sessions.grant('A');
  checkThat('granting does not move the epoch', sessions.epoch('A') === 0);
  const before = sessions.epoch('A');
  sessions.revoke('A');
  checkThat('revoking moves it by one', sessions.epoch('A') === before + 1, `${before} -> ${sessions.epoch('A')}`);
  sessions.grant('A');
  checkThat('granting again leaves the epoch where the revoke put it', sessions.epoch('A') === before + 1, String(sessions.epoch('A')));
  checkThat('and the capability is back on', sessions.isEnabled('A') === true);
  const callStartedBeforeRevoke = capture('A', before);
  checkThat('a call that started before the revoke is refused afterwards', check(callStartedBeforeRevoke, {
    enabled: sessions.isEnabled('A'), epoch: sessions.epoch('A'), stopping: false,
  })?.code === 'ABORTED');
  sessions.forget('A');
  checkThat('forgetting a session moves its epoch too', sessions.epoch('A') === before + 2, String(sessions.epoch('A')));
}

console.log('\n== the admission check names the reason it refuses ==');
{
  const admission = capture('A', 3);
  checkThat('a matching grant is admitted', check(admission, { enabled: true, epoch: 3, stopping: false }) === null);
  checkThat('a disabled grant is refused', check(admission, { enabled: false, epoch: 3, stopping: false })?.message.includes('turned off'), String(check(admission, { enabled: false, epoch: 3, stopping: false })?.message));
  checkThat('a changed epoch is refused', check(admission, { enabled: true, epoch: 4, stopping: false })?.message.includes('grant changed'), String(check(admission, { enabled: true, epoch: 4, stopping: false })?.message));
  checkThat('a stop in progress is refused', check(admission, { enabled: true, epoch: 3, stopping: true })?.message.includes('being stopped'), String(check(admission, { enabled: true, epoch: 3, stopping: true })?.message));
  checkThat('a missing admission is not an error', check(null, { enabled: false, epoch: 9, stopping: true }) === null);
}

/* ------------------------------------------------- per-session cancellation */

const dir = mkdtempSync(join(tmpdir(), 'dsh-cu-grant-'));
const scriptPath = join(dir, 'worker.ps1');
writeFileSync(scriptPath, '# stand-in\n');

class FakeWorker extends EventEmitter {
  constructor() {
    super();
    this.pid = 99;
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

console.log('\n== cancelling one session leaves the other one running ==');
{
  // 每次 start() 都起一代新的假 worker：取消 A 的卡死调用需要连进程一起停，B 的请求因此迁移到
  // 下一代（PR06 之后这是默认行为，不再陪葬成 WORKER_EXITED）。
  const workers = [];
  const backend = new PowerShellBackend({
    scriptPath,
    powerShell: 'fake',
    startTimeoutMs: 1000,
    timeoutMs: 2000,
    cancelGraceMs: 100,
    cancelFilePath: join(dir, 'cancel.txt'),
    stopBudgets: { cooperativeMs: 100, exitMs: 500, releaseMs: 200 },
    spawn: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      // A 的 'click' 故意不应答 —— 取消时它确实还停在 worker 里（in flight）；其余命令在 5 ms 内应答。
      worker.stdin.on('data', (chunk) => {
        for (const line of String(chunk).split('\n')) {
          if (line.trim() === '') continue;
          const request = JSON.parse(line);
          if (request.cmd === 'click') continue;
          setTimeout(() => worker.send({ id: request.id, ok: true, result: { echo: request.cmd } }), 5);
        }
      });
      setImmediate(() => worker.send({ ready: true, info: {} }));
      return worker;
    },
  });
  const a = backend.request('click', {}, { sessionKey: 'A' }).then((value) => ({ value }), (error) => ({ error }));
  const b = backend.request('type', { text: 'hi' }, { sessionKey: 'B' }).then((value) => ({ value }), (error) => ({ error }));
  await sleep(10);
  const cancelled = backend.cancelSession('A', 'session A was turned off');
  const [ra, rb] = await Promise.all([a, b]);
  checkThat('cancelSession reports one cancelled request', cancelled === 1, String(cancelled));
  checkThat('A fails', ra.error !== undefined, JSON.stringify(ra).slice(0, 120));
  checkThat('A is reported as a cancellation', ra.error?.code === 'CANCELLED', String(ra.error?.code));
  // 方案 4.5 允许"只有 A 实际拥有受影响资源且不能局部停止时才升级资源停止"：单线程 worker 里卡住的
  // 调用只能连进程一起停。PR06 之后，排队的 B 不再陪葬 —— 它在下一代上跑完。
  checkThat('a second generation was started for the queued request', workers.length === 2, String(workers.length));
  checkThat('B completed on the new generation', rb.value?.echo === 'type', JSON.stringify(rb).slice(0, 160));
  checkThat('B was actually written to the second worker', String(workers[1]?.written.join('') ?? '').includes('"type"'), '');
  checkThat('A never got a second chance', workers.every((worker) => !String(worker.written.join('')).includes('"A"')), '');
  checkThat('A and B are different outcomes', ra.error !== rb.error);
  backend.dispose();
}

/* ------------------------------------------------ through the public entry */

const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-grant-shim-'));
const toolsStub = join(shimDir, 'dsh-tools-stub.mjs');
writeFileSync(toolsStub, 'export const defineTool = (definition) => definition;\n');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: pathToFileURL(toolsStub).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

console.log('\n== a revoke during a slow start stops the call before it is dispatched ==');
{
  /** Every backend method the tool path uses, replaced with something observable. */
  const dispatch = [];
  let releaseHealth = null;
  const healthGate = new Promise((resolve) => { releaseHealth = () => resolve({ interactive: true }); });
  const originalStart = PowerShellBackend.prototype.start;
  const originalRequest = PowerShellBackend.prototype.request;
  const originalDispose = PowerShellBackend.prototype.dispose;
  PowerShellBackend.prototype.start = async function start() { return {}; };
  PowerShellBackend.prototype.dispose = function dispose() { /* the stub worker has nothing to stop */ };
  PowerShellBackend.prototype.request = async function request(cmd) {
    if (cmd === 'health') return healthGate;
    if (cmd === 'release') return { released: [], count: 0, note: 'nothing was held down' };
    dispatch.push(cmd);
    return {};
  };

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
  const exec = { agent: { session: { id: 'slow-start-session' } }, signal: undefined };

  const typing = tools.get('computer_type').execute({ text: 'hello' }, exec).then((value) => ({ value }), (error) => ({ error }));
  // 让调用真正走到"等待 interactive 健康检查"这一步，再撤权。
  await sleep(60);
  const stopped = await tools.get('computer_stop').execute({ disable_capability: true }, exec);
  releaseHealth();
  const outcome = await typing;

  checkThat('the stop itself succeeded', stopped.disabled === true, JSON.stringify(stopped));
  checkThat('the in-flight call failed', outcome.error !== undefined, JSON.stringify(outcome).slice(0, 160));
  checkThat('it failed as an admission refusal, not as a desktop error', /nothing was sent to the desktop/.test(outcome.error?.message ?? ''), String(outcome.error?.message).slice(0, 200));
  checkThat('and the dispatch never happened', dispatch.length === 0, JSON.stringify(dispatch));

  PowerShellBackend.prototype.start = originalStart;
  PowerShellBackend.prototype.request = originalRequest;
  PowerShellBackend.prototype.dispose = originalDispose;
}

rmSync(dir, { recursive: true, force: true });
rmSync(shimDir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
