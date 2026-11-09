/**
 * PR10 —— 宿主侧的 helper 客户端（方案 4.15）。
 *
 * 这一层要守住的是"提示可用"与"驱动可用"两件事的边界。测试用一个假 helper 进程（`tests/fake-indicator.mjs`）
 * 把每一种坏脾气都摆一遍：
 *
 *   - 正常：ready → scopeReady（两个 ready 都为真）→ updateState → endScope → closed；
 *   - 视觉没就绪：`visualReady:false` 时 `beginScope` 必须**抛**（附 payload），调用方据此停止派发；
 *   - 不语：hello 不回时按预算超时，不挂死；
 *   - 崩溃：等待者全部失败、状态 `faulted`，且这**不是**"驱动已停"；
 *   - 坏行/超长行：只计数丢弃，后续请求照常；
 *   - Esc：`cancelRequested` 不带 requestId 也能送到回调；
 *   - 退出：`stop()` 拿到 `closed`，进程消失；
 *   - 缺件：exe 不存在时 `start()` 明确说"没构建"，不是崩。
 *
 *   node indicator-supervisor-test.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IndicatorSupervisor } from './interaction/indicator-supervisor.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, 'tests', 'fake-indicator.mjs');

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A supervisor whose helper is the fake script, with extra environment. */
function makeSupervisor(env = {}, overrides = {}) {
  const cancels = [];
  const traces = [];
  const supervisor = new IndicatorSupervisor({
    exePath: FAKE,
    spawn: (_exe, _args, options) => spawn(process.execPath, [FAKE], { ...options, env: { ...process.env, ...env } }),
    onCancelRequested: (payload) => cancels.push(payload),
    trace: (name, detail) => traces.push({ name, detail }),
    timeouts: { startMs: 1500, scopeMs: 1500, commandMs: 1000, stopMs: 1500, ...overrides.timeouts },
    ...overrides,
  });
  return { supervisor, cancels, traces };
}

console.log('\n== the happy path: ready, scope, state, end, closed ==');
{
  const { supervisor } = makeSupervisor();
  const ready = await supervisor.start();
  check('ready names the protocol', ready.protocolVersion === 2, String(ready.protocolVersion));
  check('ready reports the escape path', ready.escapeReady === true);
  check('the supervisor is ready', supervisor.state === 'ready', supervisor.state);
  const scopeReady = await supervisor.beginScope({ scopeId: 'task-1', epoch: 4 });
  check('scopeReady reports both readiness bits', scopeReady.visualReady === true && scopeReady.escapeReady === true, JSON.stringify(scopeReady));
  check('the supervisor is active', supervisor.state === 'active');
  const applied = await supervisor.updateState({ active: true });
  check('state updates are acknowledged', applied.applied === true && applied.seq === 1, JSON.stringify(applied));
  const prefs = await supervisor.setVisualPreferences({ enabled: false, edgeBreathing: false }, 2);
  check('preferences are acknowledged with the values', prefs.applied === true && prefs.enabled === false, JSON.stringify(prefs));
  const health = await supervisor.health();
  check('health is readable while active', health?.phase === 'active', JSON.stringify(health));
  const ended = await supervisor.endScope();
  check('endScope is applied', ended?.applied === true, JSON.stringify(ended));
  check('a second endScope is a no-op', (await supervisor.endScope()) === null);
  const closed = await supervisor.stop();
  check('shutdown answers with closed', closed?.hookRemoved === true, JSON.stringify(closed));
  check('the supervisor is back to absent', supervisor.state === 'absent', supervisor.state);
}

console.log('\n== the visual not being ready is a refusal, not a warning ==');
{
  const { supervisor } = makeSupervisor({ FAKE_SCOPE_READY: '0' });
  await supervisor.start();
  let error = null;
  try {
    await supervisor.beginScope({ scopeId: 'task-2', epoch: 1 });
  } catch (failure) {
    error = failure;
  }
  check('beginScope throws when visualReady is false', error !== null, String(error?.message));
  check('the payload comes with it', error?.scopeReady?.visualReady === false, JSON.stringify(error?.scopeReady));
  check('and the message says nothing should be dispatched', /nothing should be dispatched/i.test(error?.message ?? ''), error?.message);
  await supervisor.stop();
}

console.log('\n== a helper that never answers times out instead of hanging ==');
{
  const { supervisor } = makeSupervisor({ FAKE_SILENT: 'hello' }, { timeouts: { startMs: 300 } });
  const started = Date.now();
  let error = null;
  try {
    await supervisor.start();
  } catch (failure) {
    error = failure;
  }
  const elapsed = Date.now() - started;
  check('start fails on the budget', error !== null && /did not answer hello/.test(error.message), error?.message);
  check('it waited roughly the budget', elapsed >= 250 && elapsed < 2000, `${elapsed} ms`);
  await supervisor.stop();
}

console.log('\n== a crashed helper faults, and that is not a stop ==');
{
  const { supervisor, traces } = makeSupervisor({ FAKE_CRASH_ON: 'updateState' });
  await supervisor.start();
  await supervisor.beginScope({ scopeId: 'crash-1', epoch: 1 });
  let error = null;
  try {
    await supervisor.updateState({ active: true });
  } catch (failure) {
    error = failure;
  }
  check('a later request fails with the exit detail', error !== null && /exited/.test(error.message), error?.message);
  check('the state is faulted', supervisor.state === 'faulted', supervisor.state);
  check('the exit was traced', traces.some((one) => one.name === 'indicator.exited'));
}

console.log('\n== a malformed or oversized line is dropped, and the channel keeps working ==');
{
  const { supervisor } = makeSupervisor({ FAKE_BAD_LINE: '1', FAKE_LONG_LINE: '1' });
  const ready = await supervisor.start();
  check('ready still arrives after the junk', ready.protocolVersion === 2);
  check('the junk lines were counted', supervisor.droppedLines >= 1, String(supervisor.droppedLines));
  const scopeReady = await supervisor.beginScope({ scopeId: 'task-3', epoch: 1 });
  check('and the channel still answers', scopeReady.visualReady === true);
  await supervisor.stop();
}

console.log('\n== physical Esc reaches the host without a requestId ==');
{
  const { supervisor, cancels } = makeSupervisor({ FAKE_ESC_AFTER: '80' });
  await supervisor.start();
  await supervisor.beginScope({ scopeId: 'task-4', epoch: 9 });
  await sleep(250);
  check('the cancel event was delivered', cancels.length === 1, JSON.stringify(cancels));
  check('it names the scope, epoch and reason', cancels[0]?.scopeId === 'task-4' && cancels[0]?.epoch === 9 && cancels[0]?.reason === 'physical_escape', JSON.stringify(cancels[0]));
  await supervisor.stop();
}

console.log('\n== a missing binary is "not built", not a crash ==');
{
  const dir = mkdtempSync(join(tmpdir(), 'dsh-indicator-missing-'));
  const missing = join(dir, 'nope.exe');
  const supervisor = new IndicatorSupervisor({ exePath: missing });
  check('availability is checked first', supervisor.available === false);
  let error = null;
  try {
    await supervisor.start();
  } catch (failure) {
    error = failure;
  }
  check('start explains it is not built', /not built/.test(error?.message ?? ''), error?.message);
  check('and the state says unavailable', supervisor.state === 'unavailable', supervisor.state);
  rmSync(dir, { recursive: true, force: true });
}

console.log('\n== with the real helper, if it is built ==');
{
  const real = join(HERE, 'native', 'indicator-helper', 'build', 'dsh-interaction-indicator.exe');
  if (!existsSync(real)) {
    console.log('  SKIP  the real helper is not built on this machine');
  } else {
    const supervisor = new IndicatorSupervisor({ exePath: real });
    const ready = await supervisor.start();
    check('the real helper answers ready', ready.protocolVersion === 2 && ready.buildVersion !== 'fake-helper', JSON.stringify(ready).slice(0, 120));
    const scopeReady = await supervisor.beginScope({ scopeId: 'live-1', epoch: 1 });
    check('the real helper presents the overlay before answering', scopeReady.visualReady === true && scopeReady.windows >= 1, JSON.stringify(scopeReady).slice(0, 160));
    const health = await supervisor.health();
    check('and reports frames', health?.frames > 0, String(health?.frames));
    const suspended = await supervisor.suspendVisual();
    check('the real helper hides its pixels on request', suspended?.applied === true && suspended?.suspended === true, JSON.stringify(suspended));
    const resumed = await supervisor.resumeVisual();
    check('and puts them back', resumed?.applied === true && resumed?.suspended === false, JSON.stringify(resumed));
    const closed = await supervisor.stop();
    check('and closes cleanly', closed?.hookRemoved === true, JSON.stringify(closed));
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
