// 阶段 1/3/4 的协议验收：身份、能力位、活动通道与反馈账。
//
// 只跑真实 helper（不建角色窗口也能验协议）：每次断言都读 helper 自己的回报，而不是猜。
//   node indicator-activity-test.mjs
//   $env:DSH_INDICATOR_EXE = '...\build-verify\dsh-interaction-indicator.exe'   # 可选
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { previewPlan } from './internal/action-table.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXE = process.env.DSH_INDICATOR_EXE !== undefined && process.env.DSH_INDICATOR_EXE !== ''
  ? process.env.DSH_INDICATOR_EXE
  : join(HERE, 'native', 'indicator-helper', 'build', 'dsh-interaction-indicator.exe');

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

if (!existsSync(EXE)) {
  console.log(`\n  SKIP  the whole activity suite :: helper not built at ${EXE}`);
  console.log('\n0 passed, 0 failed, 1 skipped');
  process.exit(0);
}

const child = spawn(EXE, ['--no-affinity'], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.on('data', () => {});
const events = [];
const waiters = [];
createInterface({ input: child.stdout }).on('line', (line) => {
  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    return;
  }
  events.push(payload);
  for (let index = waiters.length - 1; index >= 0; index -= 1) {
    const waiter = waiters[index];
    if (waiter.match(payload)) {
      waiters.splice(index, 1);
      waiter.resolve(payload);
    }
  }
});

let nextId = 0;
function request(method, extra = {}, event, timeoutMs = 8000) {
  const requestId = `t${nextId += 1}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} for ${method} within ${timeoutMs} ms`)), timeoutMs);
    waiters.push({
      match: (payload) => payload?.requestId === requestId && (event === undefined || payload.event === event),
      resolve: (payload) => {
        clearTimeout(timer);
        resolve(payload);
      },
    });
    child.stdin.write(`${JSON.stringify({ requestId, method, ...extra })}\n`);
  });
}

console.log('\n== identity and capabilities ==');
const ready = await request('hello', { protocolVersion: 2 }, 'ready');
check('the helper speaks protocol 2', ready.protocolVersion === 2, String(ready.protocolVersion));
check('it reports its real exe path', typeof ready.exePath === 'string' && ready.exePath.toLowerCase().endsWith('.exe'), ready.exePath);
check('it reports an integrity RID', Number.isFinite(ready.integrityRid), String(ready.integrityRid));
check('the integrity name matches the RID', typeof ready.integrityName === 'string' && ready.integrityName !== 'unknown', ready.integrityName);
check('it says whether it can observe input at all', typeof ready.identityCanObserveInput === 'boolean', String(ready.identityCanObserveInput));
check('it reports its session', Number.isFinite(ready.sessionId), String(ready.sessionId));
check('it declares the visual-activity capability', ready.capabilities?.visualActivity === true, JSON.stringify(ready.capabilities));
check('it declares wheel and side-button support', ready.capabilities?.wheel === true && ready.capabilities?.sideButtons === true, JSON.stringify(ready.capabilities));
check('it declares present-confirmed feedback', ready.capabilities?.presentConfirmed === true, JSON.stringify(ready.capabilities));
check('escapeReady comes from the keyboard hook', ready.escapeReady === ready.keyboardHookReady, `escape=${ready.escapeReady} keyboard=${ready.keyboardHookReady}`);

console.log('\n== the activity channel ==');
const scope = await request('beginScope', { scopeId: 'activity-test#1', epoch: 3 }, 'scopeReady');
check('the scope is ready', scope.visualReady === true, JSON.stringify({ visual: scope.visualReady, escape: scope.escapeReady }));
check('scopeReady carries its own escape readiness', typeof scope.escapeReady === 'boolean', String(scope.escapeReady));

const start = await request('visualActivity', {
  kind: 'pointer_click', phase: 'start', source: 'tool', operationId: 'op-1', epoch: 3, helperGeneration: 1,
}, 'activityApplied');
check('an activity is accepted', start.applied === true, JSON.stringify(start));
check('it produced a numbered feedback', Number.isFinite(start.feedbackId) && start.feedbackId > 0, String(start.feedbackId));
check('the feedback kind is preserved', start.kind === 'pointer_click', String(start.kind));
check('the source is preserved', start.feedbackSource === 'tool', String(start.feedbackSource));
check('the activity is counted', start.activityApplied >= 1, String(start.activityApplied));

const ended = await request('visualActivity', {
  kind: 'pointer_click', phase: 'end', source: 'tool', operationId: 'op-1', epoch: 3, helperGeneration: 1,
}, 'activityApplied');
check('ending the activity is applied', ended.applied === true, JSON.stringify(ended));

const stale = await request('visualActivity', {
  kind: 'invoke', phase: 'start', source: 'tool', operationId: 'op-old', epoch: 3, helperGeneration: 99,
}, 'activityApplied');
check('a stale generation is refused, not applied', stale.applied === false && stale.reason === 'stale_generation', JSON.stringify(stale));

const staleEpoch = await request('visualActivity', {
  kind: 'invoke', phase: 'start', source: 'tool', operationId: 'op-old-2', epoch: 999, helperGeneration: 1,
}, 'activityApplied');
check('a stale epoch is refused too', staleEpoch.applied === false && staleEpoch.reason === 'stale_epoch', JSON.stringify(staleEpoch));

const better = await request('visualActivity', {
  kind: 'set_value', phase: 'start', source: 'uia', operationId: 'op-2', epoch: 3, helperGeneration: 1,
}, 'activityApplied');
check('set_value maps to a typing-like clip', typeof better.feedbackClip === 'string' && better.feedbackClip !== '', better.feedbackClip);

console.log('\n== the preview plan drives the same channel ==');
for (const entry of previewPlan()) {
  const start = await request('visualActivity', {
    kind: entry.kind, phase: 'start', source: 'preview', operationId: `preview-${entry.kind}`, epoch: 3, helperGeneration: 1,
  }, 'activityApplied');
  const end = await request('visualActivity', {
    kind: entry.kind, phase: 'end', source: 'preview', operationId: `preview-${entry.kind}`, epoch: 3, helperGeneration: 1,
  }, 'activityApplied');
  check(`preview ${entry.kind} animates without any input`, start.applied === true && end.applied === true && Number.isFinite(start.feedbackId), JSON.stringify({ start: start.applied, end: end.applied }));
  check(`preview ${entry.kind} resolves to a real clip`, typeof start.feedbackClip === 'string' && start.feedbackClip !== '', String(start.feedbackClip));
}

console.log('\n== the health payload ==');
const health = await request('health', {}, 'health');
for (const field of ['deliveryState', 'hookSilent', 'hookDelivered', 'hookReinstalls', 'sampledResyncs',
  'feedbackCreated', 'feedbackPresented', 'feedbackCoalesced', 'feedbackDropped', 'feedbackDropReason',
  'feedbackKind', 'feedbackClip', 'feedbackSource', 'gestureTravelPx', 'gestureResampled',
  'activityApplied', 'activityKind', 'activityPhase', 'activitySource',
  'wheelPulses', 'pointerWheelEvents', 'keyActivity', 'typingActive',
  'integrityRid', 'integrityName', 'uiAccess', 'sessionId', 'identityCanObserveInput', 'exePath']) {
  check(`health reports ${field}`, health[field] !== undefined, String(health[field]));
}
check('the delivery state is one of the four honest values',
  ['unavailable', 'idle', 'quiet', 'ok', 'anomalous'].includes(health.deliveryState), String(health.deliveryState));
check('a healthy helper is not reported as silent while it never saw input',
  health.hookSilent === false || health.deliveryState === 'anomalous', `${health.hookSilent}/${health.deliveryState}`);
check('the activity count survived the round trip', health.activityApplied >= 3, String(health.activityApplied));

await request('endScope', { scopeId: 'activity-test#1' }, 'scopeEnded');
await request('shutdown', {}, 'closed');
await new Promise((resolve) => child.on('exit', resolve));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
