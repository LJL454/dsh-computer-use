/**
 * 假 helper：按 native/indicator-helper 的 JSONL 协议说话，用来驱动宿主侧测试。
 *
 * 环境变量控制它的"坏脾气"，每个用例只改一件事：
 *   FAKE_SCOPE_READY=0      scopeReady 里 visualReady 为 false
 *   FAKE_SILENT=hello       hello 不回答（测超时）
 *   FAKE_BAD_LINE=1         在 hello 之前先吐一行坏 JSON（测丢弃计数）
 *   FAKE_LONG_LINE=1        先吐一行超长 JSON（测丢弃计数）
 *   FAKE_CRASH=1            hello 之后立刻退出（测 faulted 与等待者失败）
 *   FAKE_ESC_AFTER=<ms>     beginScope 之后过 <ms> 发一条 cancelRequested
 *
 *   node tests/fake-indicator.mjs
 */
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';

const flag = (name) => (process.env[name] ?? '') !== '';
// FAKE_LOG=<path>：把收到的每个 method 逐行追加到文件，供端到端用例断言顺序。
const logPath = process.env.FAKE_LOG ?? '';
const note = (name) => { if (logPath !== '') { try { appendFileSync(logPath, name + '\n'); } catch { /* ignore */ } } };
const number = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

const emit = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);
const send = (event, requestId, extra = {}) => emit({ event, requestId, ...extra });

if (flag('FAKE_BAD_LINE')) process.stdout.write('{not json}\n');
if (flag('FAKE_LONG_LINE')) process.stdout.write(`${JSON.stringify({ event: 'health', padding: 'x'.repeat(80 * 1024) })}\n`);

const lines = createInterface({ input: process.stdin });
let scope = null;

lines.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    emit({ event: 'error', code: 'BAD_JSON', reason: 'the fake helper cannot read that' });
    return;
  }
  const { requestId, method } = message;
  note(method);
  if (method === 'hello') {
    if (process.env.FAKE_SILENT === 'hello') return;
    send('ready', requestId, {
      protocolVersion: 2,
      buildVersion: 'fake-helper',
      pid: process.pid,
      renderBackend: 'fake',
      visualReady: true,
      escapeReady: true,
      monitors: 1,
      layoutEpoch: 1,
      topology: [{ device: '\\\\\\\\.\\\\DISPLAY1', x: 0, y: 0, width: 1920, height: 1080, dpi: 96, primary: true }],
    });
    if (flag('FAKE_CRASH')) setTimeout(() => process.exit(7), 30);
    return;
  }
  if (method === 'beginScope') {
    // 首帧还没完成就先按 Esc：方案 4.17.2 的「首帧未完成时取消」那一行。
    if (flag('FAKE_ESC_BEFORE')) {
      emit({ event: 'cancelRequested', scopeId: message.scopeId, epoch: message.epoch, reason: 'physical_escape', latch: true });
    }
    scope = { scopeId: message.scopeId, epoch: message.epoch };
    send('scopeReady', requestId, {
      scopeId: message.scopeId,
      epoch: message.epoch,
      visualReady: process.env.FAKE_SCOPE_READY === '0' ? false : true,
      escapeReady: true,
      windows: 1,
      layoutEpoch: 1,
      topology: [],
    });
    const escAfter = number('FAKE_ESC_AFTER', -1);
    if (escAfter >= 0) {
      setTimeout(() => emit({ event: 'cancelRequested', scopeId: message.scopeId, epoch: message.epoch, reason: 'physical_escape', latch: true }), escAfter);
    }
    return;
  }
  if (method === 'updateState') {
    if (process.env.FAKE_CRASH_ON === 'updateState') { setTimeout(() => process.exit(7), 5); return; }
    send('stateApplied', requestId, { seq: message.seq, applied: true, currentSeq: message.seq });
    return;
  }
  if (method === 'setVisualPreferences') {
    send('visualPreferencesApplied', requestId, { settingsRevision: message.settingsRevision, applied: true, ...(message.preferences ?? {}) });
    return;
  }
  if (method === 'suspendVisual' || method === 'resumeVisual') {
    if (process.env.FAKE_SUSPEND_FAILS === '1') { emit({ event: 'error', requestId, code: 'SUSPEND_FAILED', reason: 'the fake helper cannot hide' }); return; }
    const suspend = method === 'suspendVisual';
    send(suspend ? 'visualSuspended' : 'visualResumed', requestId, { applied: true, suspended: suspend, windows: 1 });
    return;
  }
  if (method === 'health') {
    if (process.env.FAKE_CRASH_ON === 'health') { setTimeout(() => process.exit(7), 5); return; }
    send('health', requestId, { phase: scope === null ? 'idle' : 'active', frames: 12, escapeReady: true, latch: false, layoutEpoch: 1, rejectedCommands: 0 });
    return;
  }
  if (method === 'endScope') {
    const applied = message.scopeId === scope?.scopeId;
    if (applied) scope = null;
    send('scopeEnded', requestId, { applied, frames: 12 });
    return;
  }
  if (method === 'shutdown') {
    send('closed', requestId, { windows: 0, frames: 12, hookRemoved: true, uptimeMs: 1 });
    setTimeout(() => process.exit(0), 10);
    return;
  }
  emit({ event: 'error', requestId, code: 'UNKNOWN_METHOD', reason: `the fake helper does not know ${method}` });
});
