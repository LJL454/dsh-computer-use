/**
 * Lifecycle and fault-injection test for @local/dsh-computer-use.
 *
 * The other suites cover shapes and happy paths: `schema-test` checks that every tool's
 * value survives its declared output schema, `harness-test` checks registration and the
 * per-Session gate, `client-smoke` checks the chip. What none of them covered is what
 * happens when a call is *interrupted* 鈥?and that is exactly where the source review found
 * its P0s:
 *
 *   * cancelling a call only ended the caller's wait, while the worker kept executing;
 *   * turning the switch off changed an authorization record and left the desktop being
 *     driven;
 *   * a readiness timeout left the failed promise installed, so every later call failed
 *     instantly and the capability never came back;
 *   * a drag that threw dropped the "held" record without ever sending the release;
 *   * a ref minted before a worker restart could land on an unrelated element;
 *   * a frame whose window had moved was accepted as long as the point stayed inside it;
 *   * an A 鈫?B 鈫?A sequence of frames was reported as "unchanged";
 *   * the batch schema accepted 29 actions while the dispatcher implemented 21.
 *
 * Every one of those is a lifecycle property, so this file drives the real transport and
 * the real PowerShell worker (part 1) and the host half against a backend it can hang and
 * cancel on command (part 2). It also injects a real fault 鈥?a drag whose move step fails 鈥? * because the release path only runs on the failing branch, and a test that never takes
 * that branch is a test of the happy path with extra steps.
 *
 *   node lifecycle-test.mjs
 */
import { registerHooks } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = join(HERE, 'backend', 'worker.ps1');
// The real bridge, loaded through a query-suffixed URL so the module hook below (which
// stubs './backend/bridge.js' for the host half) does not catch it.
const realBridge = await import(`${pathToFileURL(join(HERE, 'backend', 'bridge.js')).href}?lifecycle=1`);
const POWERSHELL = realBridge.resolvePowerShell();

let passed = 0;
const failures = [];

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
    return true;
  }
  failures.push(`${label}${detail === '' ? '' : ` 鈥?${detail}`}`);
  console.log(`  FAIL  ${label}${detail === '' ? '' : ` 鈥?${detail}`}`);
  return false;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ==========================================================================
 * Part 1 鈥?the transport and the worker
 * ======================================================================== */

/** Speak the worker's line protocol directly, so a test can hold the marker file itself. */
function spawnRawWorker(env = {}) {
  const cancelFile = join(tmpdir(), `dsh-cu-lifecycle-${process.pid}-${Math.random().toString(36).slice(2)}.flag`);
  const child = spawn(
    POWERSHELL,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', WORKER],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, DSH_COMPUTER_USE_CANCEL_FILE: cancelFile, ...env } },
  );
  const lines = createInterface({ input: child.stdout });
  const waiters = new Map();
  let info = null;
  let nextId = 1;
  const ready = new Promise((resolve) => {
    lines.on('line', (line) => {
      let payload;
      try {
        payload = JSON.parse(line.trim());
      } catch {
        return;
      }
      if (payload.ready === true) {
        info = payload.info;
        resolve(payload.info);
        return;
      }
      const waiter = waiters.get(payload.id);
      if (waiter === undefined) return;
      waiters.delete(payload.id);
      waiter(payload);
    });
  });
  return {
    child,
    cancelFile,
    info: () => info,
    ready,
    /** @returns the worker's raw reply payload. */
    send(cmd, args = {}) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve) => {
        waiters.set(id, resolve);
        child.stdin.write(`${JSON.stringify({ id, cmd, args })}\n`);
      });
    },
    close() {
      try {
        child.stdin.end();
      } catch {
        /* already gone */
      }
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    },
  };
}

/** Whether Windows currently believes the left mouse button is down. */
function leftButtonHeld() {
  const script = [
    '$sig = \'[DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);\'',
    'Add-Type -Namespace LifecycleProbe -Name Keys -MemberDefinition $sig | Out-Null',
    '$state = [LifecycleProbe.Keys]::GetAsyncKeyState(0x01)',
    'if (($state -band 0x8000) -ne 0) { "DOWN" } else { "UP" }',
  ].join('\n');
  const file = join(tmpdir(), `dsh-cu-button-${process.pid}.ps1`);
  writeFileSync(file, script);
  const out = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { encoding: 'utf8' });
  rmSync(file, { force: true });
  return out.stdout.trim() === 'DOWN';
}

/** Whether Windows considers a window on screen, asked from a process that is not the worker. */
function windowVisible(hwnd) {
  const script = [
    '$sig = \'[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);\'',
    'Add-Type -Namespace LifecycleProbe -Name Visible -MemberDefinition $sig | Out-Null',
    `if ([LifecycleProbe.Visible]::IsWindowVisible([IntPtr]${hwnd})) { "VISIBLE" } else { "HIDDEN" }`,
  ].join('\n');
  const file = join(tmpdir(), `dsh-cu-visible-${process.pid}.ps1`);
  writeFileSync(file, script);
  const out = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { encoding: 'utf8' });
  rmSync(file, { force: true });
  return out.stdout.trim() === 'VISIBLE';
}

/** Whether a window is flagged topmost (WS_EX_TOPMOST), asked from outside the worker. */
function windowTopmost(hwnd) {
  const script = [
    '$sig = \'[DllImport("user32.dll")] public static extern int GetWindowLongW(System.IntPtr h, int i);\'',
    'Add-Type -Namespace LifecycleProbe -Name Top -MemberDefinition $sig | Out-Null',
    `if (([LifecycleProbe.Top]::GetWindowLongW([IntPtr]${hwnd}, -20) -band 0x8) -ne 0) { "TOPMOST" } else { "NORMAL" }`,
  ].join('\n');
  const file = join(tmpdir(), `dsh-cu-topmost-${process.pid}.ps1`);
  writeFileSync(file, script);
  const out = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { encoding: 'utf8' });
  rmSync(file, { force: true });
  return out.stdout.trim() === 'TOPMOST';
}

console.log('\n== the worker publishes the action set it implements ==');

const contractWorker = spawnRawWorker();
const contractInfo = await contractWorker.ready;
check('the worker reports a startup generation', typeof contractInfo.generation === 'string' && contractInfo.generation.length === 4, String(contractInfo.generation));
check('the worker reports its step actions', Array.isArray(contractInfo.actions) && contractInfo.actions.length === 30, String(contractInfo.actions?.length));
check('the condition wait is one of them', contractInfo.actions.includes('wait_for'), (contractInfo.actions ?? []).join(','));
check('the worker reports the cancel marker it watches', typeof contractInfo.cancelFile === 'string' && contractInfo.cancelFile !== '', String(contractInfo.cancelFile));
const missingFromDispatcher = ['click_text', 'close', 'get_caret', 'legacy_action', 'locate_text', 'maximize', 'minimize', 'restore']
  .filter((action) => !contractInfo.actions.includes(action));
check('the eight actions the schema declared but the dispatcher lacked are implemented', missingFromDispatcher.length === 0, missingFromDispatcher.join(', '));

// Every one of them really has a branch: a batch of them must not answer "unknown step
// action". They are run against a window that does not exist, so the expected failure is
// about the element, never about the action.
const actionProbe = await contractWorker.send('batch', {
  steps: ['click_text', 'locate_text', 'get_caret', 'legacy_action', 'close', 'minimize', 'maximize', 'restore']
    .map((action) => ({ action, name: 'no-such-control-xyz', text: 'no-such-text' })),
});
const actionProbeError = String(actionProbe.result?.error ?? actionProbe.error ?? '');
check('the new step actions are dispatched, not rejected as unknown', !actionProbeError.includes('unknown step action'), actionProbeError.slice(0, 140));
check('and they fail on the element, which is the honest failure', actionProbeError.includes('no UI Automation element matched'), actionProbeError.slice(0, 140));

console.log('\n== a batch validates every step before it runs any of them ==');
const preflight = await contractWorker.send('batch', {
  steps: [{ action: 'wait', seconds: 0 }, { action: 'bogus-step' }],
});
check('an unknown action is refused', String(preflight.error).includes('unknown step action'), String(preflight.error).slice(0, 120));
check('and the refusal names the step index', String(preflight.error).includes('at step 1'), String(preflight.error).slice(0, 120));
const preflightMissing = await contractWorker.send('batch', { steps: [{ action: 'drag', to_x: 10, to_y: 10 }] });
check('a drag without its start point is refused up front', String(preflightMissing.error).includes('from_x'), String(preflightMissing.error).slice(0, 120));

console.log('\n== cancellation reaches the worker, not just the caller ==');

const cancelStarted = Date.now();
const longBatch = contractWorker.send('batch', {
  steps: [{ action: 'wait', seconds: 8 }, { action: 'clipboard', op: 'get' }],
});
await sleep(400);
writeFileSync(contractWorker.cancelFile, '1\n', 'utf8');
const cancelledReply = await longBatch;
const cancelElapsed = Date.now() - cancelStarted;
const cancelledResult = cancelledReply.result ?? {};
check('the cancelled batch answers with canceled: true', cancelledResult.canceled === true, JSON.stringify(cancelledResult).slice(0, 200));
check('and its error is coded CANCELED', String(cancelledResult.error).startsWith('[CANCELED]'), String(cancelledResult.error).slice(0, 120));
check('and it stopped instead of running the whole wait', cancelElapsed < 4_000, `${cancelElapsed} ms`);
check('the steps after the cancel did not run', cancelledResult.count === 0, String(cancelledResult.count));

const afterCancel = await contractWorker.send('ping', {});
check('the worker is still usable after a cancel', afterCancel.ok === true && afterCancel.result.ready === true, JSON.stringify(afterCancel).slice(0, 120));
const afterCancelWait = await contractWorker.send('batch', { steps: [{ action: 'wait', seconds: 0.4 }] });
check('the cancel marker did not leak into the next request', afterCancelWait.ok === true && afterCancelWait.result.failedAt === -1, JSON.stringify(afterCancelWait).slice(0, 140));

console.log('\n== a drag that fails mid-gesture still releases the button ==');

const beforeDrag = leftButtonHeld();
const dragReply = await contractWorker.send('drag', { fromX: 120, fromY: 120, toX: -99999, toY: -99999 });
check('the drag really failed', dragReply.ok === false, JSON.stringify(dragReply).slice(0, 120));
const releasedReply = await contractWorker.send('release', {});
check('nothing is still believed to be held', Array.isArray(releasedReply.result.released) && releasedReply.result.released.length === 0, JSON.stringify(releasedReply.result).slice(0, 160));
const afterDrag = leftButtonHeld();
check('the left button is physically up again', afterDrag === false, `before=${beforeDrag} after=${afterDrag}`);

console.log('\n== a ref from a previous worker generation is refused as such ==');
contractWorker.close();

const generationWorker = spawnRawWorker();
await generationWorker.ready;
// A ref as a previous worker would have minted it: four generation characters, then the
// sequence number, then the node index.
const staleGeneration = await generationWorker.send('uiact', { action: 'get_value', ref: 'saaaa7.3' });
const staleText = String(staleGeneration.error ?? '');
check('a ref from another generation is refused', staleGeneration.ok === false && staleText.includes('[STALE_REF]'), staleText.slice(0, 140));
check('and the refusal says it is a generation mismatch', staleText.includes('previous worker generation'), staleText.slice(0, 200));
const malformed = await generationWorker.send('uiact', { action: 'get_value', ref: 'not-a-ref' });
check('a malformed ref is still called malformed', String(malformed.error).includes('malformed'), String(malformed.error).slice(0, 140));
const fabricated = await generationWorker.send('uiact', { action: 'get_value', ref: 's999.999' });
check('a ref past everything this worker issued says so', String(fabricated.error).includes('never issued'), String(fabricated.error).slice(0, 160));
// One real read, so a legacy-shaped ref now falls inside the range this worker has issued.
await generationWorker.send('uitree', { maxDepth: 2, maxNodes: 5 });
const legacy = await generationWorker.send('uiact', { action: 'get_value', ref: 's1.5' });
check('a ref in the pre-generation spelling is named as such', String(legacy.error).includes('older worker build') || String(legacy.error).includes('never issued'), String(legacy.error).slice(0, 160));
generationWorker.close();

console.log('\n== the delta compares what a caller acts on ==');
const deltaWorker = spawnRawWorker();
await deltaWorker.ready;
const baseEntry = {
  key: 'id:save#0', snapshot: 'sbase', name: 'Save', controlType: 'ControlType.Button', className: 'Button',
  enabled: true, offscreen: false, patterns: ['invoke'], x: 10, y: 10, width: 40, height: 20,
};
const deltaSame = await deltaWorker.send('delta', {
  base: 'sbase',
  entries: [baseEntry],
  nodes: [{ ...baseEntry, ref: '' }],
});
check('an identical reading is counted as unchanged', deltaSame.result.counts.same === 1, JSON.stringify(deltaSame.result.counts));
const deltaDisabled = await deltaWorker.send('delta', {
  base: 'sbase',
  entries: [baseEntry],
  nodes: [{ ...baseEntry, ref: '', enabled: false }],
});
check('a control that became disabled is a change', deltaDisabled.result.counts.altered === 1 && deltaDisabled.result.counts.same === 0, JSON.stringify(deltaDisabled.result.counts));
const deltaOffscreen = await deltaWorker.send('delta', {
  base: 'sbase',
  entries: [baseEntry],
  nodes: [{ ...baseEntry, ref: '', offscreen: true }],
});
check('a row that went off screen is a change', deltaOffscreen.result.counts.altered === 1, JSON.stringify(deltaOffscreen.result.counts));
const deltaPatterns = await deltaWorker.send('delta', {
  base: 'sbase',
  entries: [baseEntry],
  nodes: [{ ...baseEntry, ref: '', patterns: [] }],
});
check('a control that lost its patterns is a change', deltaPatterns.result.counts.altered === 1, JSON.stringify(deltaPatterns.result.counts));
const deltaRenamed = await deltaWorker.send('delta', {
  base: 'sbase',
  entries: [baseEntry],
  nodes: [{ ...baseEntry, ref: '', name: 'Save as' }],
});
check('a renamed control is still a change', deltaRenamed.result.counts.altered === 1, JSON.stringify(deltaRenamed.result.counts));
deltaWorker.close();

console.log('\n== a failed startup is recoverable ==');
const slowScript = join(tmpdir(), `dsh-cu-slow-${process.pid}.ps1`);
const slowMarkerName = `dsh-cu-slow-${process.pid}.marker`;
const slowMarker = join(tmpdir(), slowMarkerName);
rmSync(slowMarker, { force: true });
// ASCII only, and the path is computed inside the script: Windows PowerShell reads a .ps1
// without a BOM as ANSI, so a literal path containing 鏉庡仴涔?would be mangled into an
// invalid path before the script even runs (the worker itself is ASCII-only for exactly
// this reason).
writeFileSync(slowScript, [
  '# A worker that only starts on the second attempt, so the recovery path can be tested.',
  `$marker = Join-Path $env:TEMP '${slowMarkerName}'`,
  'if (Test-Path -LiteralPath $marker) {',
  '  [Console]::Out.WriteLine(\'{"ready":true,"info":{"pid":1,"actions":null}}\')',
  '  [Console]::Out.Flush()',
  '  while ($true) { Start-Sleep -Milliseconds 200 }',
  '}',
  'Set-Content -LiteralPath $marker -Value 1',
  'Start-Sleep -Seconds 30',
].join('\n'), 'utf8');
const flaky = new realBridge.PowerShellBackend({ scriptPath: slowScript, timeoutMs: 1_200, startTimeoutMs: 4_000 });
const firstStart = await flaky.start().then(() => 'ok', (error) => error);
check('the first start times out', firstStart?.code === 'START_TIMEOUT', String(firstStart?.code ?? firstStart));
check('and the timed-out worker is not left running', flaky.alive === false, String(flaky.alive));
const secondStart = await flaky.start().then((info) => ({ ok: true, info }), (error) => ({ ok: false, code: error.code }));
check('the next call really retries instead of failing on a stale promise', secondStart.ok === true, JSON.stringify(secondStart).slice(0, 140));
flaky.dispose();
rmSync(slowScript, { force: true });
rmSync(slowMarker, { force: true });

console.log('\n== a queued request that is cancelled never reaches the desktop ==');
const backend = new realBridge.PowerShellBackend({ timeoutMs: 30_000, startTimeoutMs: 30_000 });
await backend.start();
const first = backend.request('batch', { steps: [{ action: 'wait', seconds: 1.2 }] }, { timeoutMs: 30_000 });
const queuedController = new AbortController();
const queued = backend.request('batch', { steps: [{ action: 'wait', seconds: 1.0 }] }, { timeoutMs: 30_000, signal: queuedController.signal })
  .then(() => ({ ok: true }), (error) => ({ ok: false, code: error.code, dispatched: error.dispatched, message: error.message }));
queuedController.abort();
const queuedOutcome = await queued;
check('a request cancelled while queued is refused', queuedOutcome.ok === false && queuedOutcome.code === 'ABORTED', JSON.stringify(queuedOutcome).slice(0, 160));
check('and it is reported as never dispatched', queuedOutcome.dispatched === false, String(queuedOutcome.dispatched));
check('and the message says nothing was sent', String(queuedOutcome.message).includes('nothing was sent'), String(queuedOutcome.message).slice(0, 160));
const queuedElapsed = Date.now();
await first;
check('the queued action was dropped rather than run after the cancel', Date.now() - queuedElapsed < 1_800, `${Date.now() - queuedElapsed} ms after the first call finished`);

console.log('\n== a running request is cancelled in the worker, not merely abandoned ==');
const runningController = new AbortController();
const runningStarted = Date.now();
const running = backend.request('batch', {
  steps: [{ action: 'wait', seconds: 8 }, { action: 'clipboard', op: 'get' }],
}, { timeoutMs: 30_000, signal: runningController.signal }).then(() => ({ ok: true }), (error) => ({ ok: false, code: error.code, dispatched: error.dispatched }));
await sleep(400);
runningController.abort();
const runningOutcome = await running;
check('the running call is reported as cancelled', runningOutcome.ok === false && runningOutcome.code === 'CANCELLED', JSON.stringify(runningOutcome));
check('and as already dispatched, so its outcome is unknown', runningOutcome.dispatched === true, String(runningOutcome.dispatched));
const recovered = await backend.request('ping', {}, { timeoutMs: 12_000 });
check('the worker stopped the wait and answers the next request', recovered.ready === true, JSON.stringify(recovered).slice(0, 120));
check('and it answered quickly, which is the proof it stopped', Date.now() - runningStarted < 6_000, `${Date.now() - runningStarted} ms`);
backend.dispose();

console.log('\n== a batch stops when the window in front changes under it ==');
// The probe: a real WinForms window that can raise a second window of its own on command.
// Using windows the *same* process owns is what makes the foreground change deterministic:
// Windows only lets a process hand the foreground to its own windows, and the probe owns it
// once the worker has focused its first window.
const probeScript = join(tmpdir(), `dsh-cu-probe-${process.pid}.ps1`);
const probeOut = join(tmpdir(), `dsh-cu-probe-${process.pid}.out`);
const probeStop = join(tmpdir(), `dsh-cu-probe-${process.pid}.stop`);
const probeActivate1 = join(tmpdir(), `dsh-cu-probe-${process.pid}.a1`);
const probeActivate2 = join(tmpdir(), `dsh-cu-probe-${process.pid}.a2`);
for (const file of [probeOut, probeStop, probeActivate1, probeActivate2]) rmSync(file, { force: true });
writeFileSync(probeScript, [
  'param([string]$StopFile, [string]$OutFile, [string]$Activate1, [string]$Activate2)',
  'Add-Type -AssemblyName System.Windows.Forms',
  'Add-Type -AssemblyName System.Drawing',
  '$form1 = New-Object System.Windows.Forms.Form',
  "$form1.Text = 'dsh-cu-guard-probe-1'",
  '$form1.ClientSize = New-Object System.Drawing.Size(420, 240)',
  "$form1.StartPosition = 'Manual'",
  '$form1.Left = 30',
  '$form1.Top = 30',
  // Two text boxes so the ref resolution paths can both be exercised on a window whose
  // controls this test owns: one whose automation id is set, one whose is empty.
  '# dsh-cu-probe: two text boxes, one with an automation id and one without',
  '$input1 = New-Object System.Windows.Forms.TextBox',
  "$input1.Name = 'dsh-cu-probe-input'",
  '$input1.Text = "probe-value"',
  '$input1.Left = 20',
  '$input1.Top = 20',
  '$input1.Width = 300',
  '$input2 = New-Object System.Windows.Forms.TextBox',
  '$input2.Text = "no-id-value"',
  '$input2.Left = 20',
  '$input2.Top = 70',
  '$input2.Width = 300',
  '$form1.Controls.Add($input1)',
  '$form1.Controls.Add($input2)',
  '$form1.Show()',
  '$form1.Activate()',
  '$form1.BringToFront()',
  '[System.Windows.Forms.Application]::DoEvents()',
  'Add-Content -LiteralPath $OutFile -Value ("HWND1=" + $form1.Handle)',
  '$form2 = $null',
  '$last1 = ""',
  '$last2 = ""',
  'while (-not (Test-Path -LiteralPath $StopFile)) {',
  '  [System.Windows.Forms.Application]::DoEvents()',
  '  Start-Sleep -Milliseconds 50',
  // Each distinct marker content triggers exactly one activation: a loop that re-activated
  // on every tick would fight the worker for the foreground and make the test measure itself.
  '  $c2 = ""',
  '  if (Test-Path -LiteralPath $Activate2) { $c2 = (Get-Content -LiteralPath $Activate2 -Raw).Trim() }',
  '  if ($null -eq $form2 -and $c2 -ne "") {',
  '    $form2 = New-Object System.Windows.Forms.Form',
  "    $form2.Text = 'dsh-cu-guard-probe-2'",
  '    $form2.ClientSize = New-Object System.Drawing.Size(360, 200)',
  "    $form2.StartPosition = 'CenterScreen'",
  '    $form2.Show()',
  '    Add-Content -LiteralPath $OutFile -Value ("HWND2=" + $form2.Handle)',
  '  }',
  '  $c1 = ""',
  '  if (Test-Path -LiteralPath $Activate1) { $c1 = (Get-Content -LiteralPath $Activate1 -Raw).Trim() }',
  '  if ($c1 -ne "" -and $c1 -ne $last1) { $last1 = $c1; $form1.Activate(); $form1.BringToFront(); [System.Windows.Forms.Application]::DoEvents() }',
  '  if ($c2 -ne "" -and $c2 -ne $last2) { $last2 = $c2; if ($null -ne $form2) { $form2.Activate(); $form2.BringToFront(); [System.Windows.Forms.Application]::DoEvents() } }',
  '}',
  'try { $form1.Close() } catch { }',
].join('\n'), 'utf8');
const probeProcess = spawn(
  POWERSHELL,
  ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', probeScript, probeStop, probeOut, probeActivate1, probeActivate2],
  // windowsHide is left off on purpose: it makes the child's windows genuinely invisible
  // (`IsWindowVisible` false even though WinForms reports `Visible` true), which would make
  // this probe useless for a test about which window is in front.
  { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false },
);
/** Read HWNDn out of the probe's report file, waiting for it to appear. */
function readProbeHwnd(name, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const match = new RegExp(`${name}=(\\d+)`).exec(readFileSync(probeOut, 'utf8'));
      if (match !== null) return Number(match[1]);
    } catch {
      /* the file is not there yet */
    }
    spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Milliseconds 120'], { encoding: 'utf8' });
  }
  return null;
}
const probeHwnd1 = readProbeHwnd('HWND1', 20_000);
check('the probe window is up', typeof probeHwnd1 === 'number' && probeHwnd1 > 0, String(probeHwnd1));

if (probeHwnd1 !== null) {
  const guardBackend = new realBridge.PowerShellBackend({ timeoutMs: 30_000, startTimeoutMs: 30_000 });
  await guardBackend.start();
  // Focus the probe's first window: that makes it the batch's baseline *and* gives the probe
  // process the foreground, which is what lets it raise its own second window later.
  await guardBackend.request('focus', { hwnd: probeHwnd1 }, { timeoutMs: 15_000 });

  const tripBatch = guardBackend.request('batch', {
    steps: [
      { action: 'wait', seconds: 2.5 },
      { action: 'key', keys: 'shift' },
    ],
  }, { timeoutMs: 40_000 });
  await sleep(600);
  writeFileSync(probeActivate2, '1\n', 'utf8');
  const trippedReply = await tripBatch;
  const tripped = trippedReply.result ?? trippedReply;
  check('the guard stops the batch where the window changed', tripped.failedAt === 1, JSON.stringify(tripped).slice(0, 200));
  check('and says why, naming both windows', String(tripped.error).includes('the window in front changed during this batch') && String(tripped.error).includes('hwnd'), String(tripped.error).slice(0, 220));
  check('and reports the steps that did run', tripped.count === 1, String(tripped.count));
  check('and that the guarded step sent nothing', String(tripped.error).includes('action_sent=false'), String(tripped.error).slice(-180));
  const probeHwnd2 = readProbeHwnd('HWND2', 5_000);
  check('the second window is the one the guard saw', typeof probeHwnd2 === 'number' && String(tripped.error).includes(String(probeHwnd2)), String(probeHwnd2));

  // Opting out: the same change happens, and the caller has accepted that the rest of the
  // sequence follows whatever is in front.
  await guardBackend.request('focus', { hwnd: probeHwnd1 }, { timeoutMs: 15_000 });
  const optOutBatch = guardBackend.request('batch', {
    steps: [
      { action: 'wait', seconds: 2.0 },
      { action: 'key', keys: 'shift' },
    ],
    stopOnWindowChange: false,
  }, { timeoutMs: 40_000 });
  await sleep(500);
  const optOut = await optOutBatch;
  const optOutResult = optOut.result ?? optOut;
  check('stopOnWindowChange: false lets the same batch finish', optOutResult.failedAt === -1, JSON.stringify(optOutResult).slice(0, 200));

  // Naming a window is the caller's decision, so the guard follows it: the focus step raises
  // the first window and re-baselines, and the guarded step after it is not refused.
  const focusThenKey = await guardBackend.request('batch', {
    steps: [
      { action: 'focus', hwnd: probeHwnd1 },
      { action: 'key', keys: 'shift' },
    ],
  }, { timeoutMs: 40_000 });
  const focusResult = focusThenKey.result ?? focusThenKey;
  check('an explicit focus step re-baselines the guard', focusResult.failedAt === -1, JSON.stringify(focusResult).slice(0, 200));
  check('and both steps are reported as performed', focusResult.count === 2, String(focusResult.count));

  // The control for the case above: same starting state, same real window change, but no
  // explicit focus to justify it -- so the guard fires. Without this, "the focus step
  // re-baselines" would be indistinguishable from "the guard stopped working".
  await guardBackend.request('focus', { hwnd: probeHwnd1 }, { timeoutMs: 15_000 });
  const controlBatch = guardBackend.request('batch', {
    steps: [
      { action: 'wait', seconds: 2.0 },
      { action: 'key', keys: 'shift' },
    ],
  }, { timeoutMs: 40_000 });
  await sleep(500);
  writeFileSync(probeActivate2, '4\n', 'utf8');
  const controlReply = await controlBatch;
  const controlResult = controlReply.result ?? controlReply;
  check('the same change without a focus step is still refused', controlResult.failedAt === 1, JSON.stringify(controlResult).slice(0, 200));
  check('and the refusal names the window that took over', String(controlResult.error).includes('probe-2'), String(controlResult.error).slice(0, 220));

  // Focusing must not change whether the window is on screen. The worker is started hidden
  // (so no console flashes), and Windows substitutes that startup show state for the first
  // ShowWindow call a process makes -- so the old `ShowWindow(hwnd, SW_SHOW)` in
  // ForceForeground *hid* the window it was asked to bring forward. This is the regression
  // test for that, and it is checked from three sides: the worker's own receipt, the probe's
  // WinForms view, and the plugin's window list.
  await guardBackend.request('focus', { hwnd: probeHwnd1 }, { timeoutMs: 15_000 });
  const focusReceipt = await guardBackend.request('focus', { hwnd: probeHwnd1 }, { timeoutMs: 15_000 });
  check('focusing a window reports whether it is still on screen', focusReceipt.visible === true, JSON.stringify(focusReceipt).slice(0, 160));
  check('and reports no visibility anomaly', focusReceipt.note === undefined, String(focusReceipt.note));
  check('the focused window is still visible to the system', windowVisible(probeHwnd1) === true, 'the window was hidden by the raise');
  const afterFocusList = await guardBackend.request('windows', {}, { timeoutMs: 20_000 });
  check('and it is still in the window list', afterFocusList.windows.some((w) => w.hwnd === probeHwnd1), `${afterFocusList.windows.length} window(s)`);
  // And it is not left floating: the raise has a last-resort path that puts the window on top
  // of the z-order when the desktop will not hand the foreground over, and a window left
  // topmost afterwards would hover over everything the user has open.
  check('and it is not left topmost by the raise', windowTopmost(probeHwnd1) === false, 'the window is still WS_EX_TOPMOST');

  // The ref fast path, on a real window whose controls this test owns: an identity that is
  // an automation id is re-found from one provider query, everything else falls back to the
  // tree walk. Reading a value is the cheapest action that runs the whole ref path (the
  // resolver is only reached through a successful action).
  const probeTree = await guardBackend.request('uitree', { hwnd: probeHwnd1, maxNodes: 400, maxDepth: 8, patterns: true }, { timeoutMs: 60_000 });
  const valueNodes = (probeTree.nodes ?? []).filter((node) => (node.patterns ?? []).includes('value') && typeof node.ref === 'string' && node.ref !== '');
  const byId = valueNodes.find((node) => String(node.automationId ?? '') !== '');
  // A control the resolver can still name without an id: the widget class is what the ref
  // layer falls back to when there is no automation id and no label (a control with none of
  // the three is refused rather than guessed -- that is the documented ref identity rule).
  const byKind = valueNodes.find((node) => String(node.automationId ?? '') === ''
    && /Edit/i.test(String(node.controlType))
    && String(node.className ?? '') !== '');
  if (byId === undefined) {
    console.log('  (the probe window exposed no value control with an automation id)');
  } else {
    const viaId = await guardBackend.request('uiact', { action: 'get_value', ref: byId.ref }, { timeoutMs: 45_000 });
    check('a uniquely identified ref is resolved by one provider query', viaId.resolvedVia === 'automation-id', `${byId.controlType} #${byId.automationId} -> ${String(viaId.resolvedVia)}`);
    check('and the value still reads back through it', viaId.value === 'probe-value', JSON.stringify(viaId.value));
  }
  if (byKind === undefined) {
    console.log('  (the probe window exposed no value control without an automation id)');
  } else {
    const viaKind = await guardBackend.request('uiact', { action: 'get_value', ref: byKind.ref }, { timeoutMs: 45_000 });
    check('a ref without an automation id falls back to the tree walk', viaKind.resolvedVia === 'tree-walk', `${byKind.controlType} -> ${String(viaKind.resolvedVia)}`);
  }
  // A ref *inside a batch step*, which is the path the evaluation set found broken: the batch
  // dispatcher hands its arguments to the ref-aware action path as a hashtable, and a merge
  // that only understood PSCustomObject silently produced an empty argument set -- so every
  // batch step carrying a ref failed with "uiact requires an action" while the single-step
  // tool worked.
  if (byId !== undefined) {
    const batchRef = await guardBackend.request('batch', { steps: [{ action: 'get_value', ref: byId.ref }] }, { timeoutMs: 45_000 });
    check('a ref step inside a batch runs the same path', batchRef.failedAt === -1, JSON.stringify(batchRef).slice(0, 160));
    check('and it reads the value back', String((batchRef.performed ?? [])[0] ?? '').includes('probe-value'), String((batchRef.performed ?? [])[0] ?? '').slice(0, 80));
  }
  guardBackend.dispose();
}
writeFileSync(probeStop, '1\n', 'utf8');
await sleep(400);
try {
  probeProcess.kill();
} catch {
  /* already gone */
}
for (const file of [probeScript, probeOut, probeStop, probeActivate1, probeActivate2]) rmSync(file, { force: true });

/* ==========================================================================
 * Part 2 鈥?the host half against a backend that can hang on command
 * ======================================================================== */

const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-lifecycle-shim-'));
const shotDir = join(shimDir, 'shots');
mkdirSync(shotDir, { recursive: true });

const toolsStub = join(shimDir, 'dsh-tools-stub.mjs');
writeFileSync(toolsStub, 'export const toolDefinitions = [];\nexport const defineTool = (definition) => definition;\n');

const bridgeStub = join(shimDir, 'bridge-stub.mjs');
writeFileSync(bridgeStub, `
export class ComputerUseBackendError extends Error {
  constructor(message, code) { super(message); this.name = 'ComputerUseBackendError'; this.code = code; this.dispatched = false; }
}

const state = () => globalThis.__cuStub;

export class PowerShellBackend {
  constructor(options = {}) {
    this.options = options;
    const s = state();
    s.instances.push(this);
    this.info = { dpi: 'per-monitor-v2', screens: [], generation: 'stub', actions: s.actions, pid: 4242 };
  }
  get alive() { return true; }
  get outstanding() { return state().hung.size; }
  get cancelFilePath() { return this.options.cancelFilePath; }
  async start() { return this.info; }
  cancelAll(reason) {
    const s = state();
    s.cancelCalls.push(reason);
    let cancelled = 0;
    for (const [id, entry] of [...s.hung]) {
      s.hung.delete(id);
      cancelled += 1;
      const error = new ComputerUseBackendError(entry.cmd + ' was cancelled by the host', 'CANCELLED');
      error.dispatched = true;
      error.canceled = true;
      entry.reject(error);
    }
    return cancelled;
  }
  async request(cmd, args = {}, options = {}) {
    const s = state();
    s.calls.push({ cmd, args });
    if (s.hangWhen !== null && s.hangWhen(cmd, args)) {
      return new Promise((resolve, reject) => {
        const id = s.hung.size + 1;
        s.hung.set(id, { cmd, reject });
        const onAbort = () => {
          if (!s.hung.has(id)) return;
          s.hung.delete(id);
          const error = new ComputerUseBackendError(cmd + ' had already been dispatched, so the worker was told to stop at the next step boundary', 'CANCELLED');
          error.dispatched = true;
          reject(error);
        };
        if (options.signal === undefined || options.signal === null) return;
        options.signal.addEventListener('abort', onAbort, { once: true });
        if (options.signal.aborted === true) onAbort();
      });
    }
    return s.reply(cmd, args);
  }
  dispose() {}
}
`);

globalThis.__cuStub = {
  actions: null,
  calls: [],
  instances: [],
  hung: new Map(),
  cancelCalls: [],
  hangWhen: null,
  batchError: '',
  frames: [],
  frameIndex: 0,
  admitted: 0,
  reply(cmd, args) {
    const s = globalThis.__cuStub;
    switch (cmd) {
      case 'ping':
        return { ready: true, dpi: 'per-monitor-v2', screens: [], virtual: { x: 0, y: 0, width: 1920, height: 1080 }, cursor: { x: 0, y: 0 } };
      case 'health':
        return { interactive: true, note: 'ok' };
      case 'release':
        return { released: [], count: 0, note: 'nothing was held down' };
      case 'windows':
        return { windows: [] };
      case 'click':
        return { x: args.x, y: args.y, clicks: args.clicks ?? 1, button: args.button ?? 'left', via: 'mouse' };
      case 'type':
        return { typed: String(args.text ?? '').length, foreground: { hwnd: 1, title: 'Stub', process: 'stub' } };
      case 'paste':
        return { pasted: String(args.text ?? '').length, restored: true, savedUser: true, foreground: { hwnd: 1, title: 'Stub', process: 'stub' } };
      case 'key':
        return { keys: args.keys, repeat: args.repeat ?? 1, heldMs: 0, foreground: { hwnd: 1, title: 'Stub', process: 'stub' } };
      case 'clipboard':
        return { op: args.op ?? 'get', text: '', length: 0, truncated: false };
      case 'batch':
        return {
          performed: (Array.isArray(args.steps) ? args.steps : []).map((step) => String(step.action)),
          count: Array.isArray(args.steps) ? args.steps.length : 0,
          failedAt: s.batchError === '' ? -1 : 0,
          error: s.batchError,
          canceled: false,
          elapsedMs: 12,
          shot: null,
          evidence: null,
          state: null,
        };
      case 'screenshot': {
        const bytes = s.frames[Math.min(s.frameIndex, s.frames.length - 1)] ?? Buffer.from('frame');
        s.frameIndex += 1;
        writeFileSync(args.path, bytes);
        return {
          path: args.path, x: 0, y: 0, width: 800, height: 600, scale: args.scale ?? 1,
          format: args.format ?? 'png', bytes: bytes.length, settledMs: 0,
          screens: [], virtual: { x: 0, y: 0, width: 1920, height: 1080 },
          cursor: { x: 0, y: 0 }, foreground: { hwnd: 1, title: 'Stub window' },
        };
      }
      case 'uitree':
        return {
          window: { hwnd: 77, title: 'Stub window', process: 'stub', pid: 9 },
          nodes: [
            {
              depth: 0, name: 'Root', controlType: 'ControlType.Window', automationId: 'root', className: 'Stub',
              enabled: true, offscreen: false, x: 0, y: 0, width: 800, height: 600, patterns: ['invoke'], ref: 'sstub0.0',
            },
            {
              depth: 1, name: 'Save', controlType: 'ControlType.Button', automationId: 'save', className: 'Button',
              enabled: true, offscreen: false, x: 10, y: 20, width: 60, height: 24, patterns: ['invoke'], ref: 'sstub0.1',
            },
          ],
          truncated: false, mode: 'tree', walked: 2, skipped: 0, snapshot: 'sstub0',
        };
      case 'uiact':
        return {
          action: args.action,
          matched: { name: 'Save', controlType: 'ControlType.Button', automationId: 'save', x: 1, y: 2, width: 30, height: 20, patterns: ['invoke'] },
          value: '',
          // Mirrors the worker: a ref action reports how the element was re-found.
          ...(typeof args.ref === 'string' && args.ref !== '' ? { ref: args.ref, reresolved: false, drift: 0, resolvedVia: 'automation-id' } : {}),
        };
      default:
        return {};
    }
  },
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: pathToFileURL(toolsStub).href, shortCircuit: true };
    if (specifier === './backend/bridge.js' || specifier.endsWith('/backend/bridge.js')) {
      return { url: pathToFileURL(bridgeStub).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

function createContext() {
  const tools = new Map();
  const routes = new Map();
  const effects = [];
  const logs = [];
  const services = {
    attachments: {
      saveImages: async (inputs) => inputs.map((input, index) => {
        globalThis.__cuStub.admitted += 1;
        return {
          attachmentId: `sha256:${String(index).padStart(4, '0')}`,
          mediaType: input.mediaType,
          bytes: input.data.byteLength,
          width: 800,
          height: 600,
        };
      }),
    },
    webServer: { register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path); } },
  };
  const ctx = {
    tools: { register(definition) { tools.set(definition.name, definition); return () => tools.delete(definition.name); } },
    webServer: services.webServer,
    effect(fn, label) {
      const dispose = fn();
      effects.push({ label, dispose: typeof dispose === 'function' ? dispose : () => {} });
      return () => {};
    },
    inject(deps, callback) {
      if (deps.every((name) => services[name] !== undefined)) callback(ctx);
      return () => {};
    },
    get: (name) => services[name],
    logger: { info: (...args) => logs.push(args.join(' ')) },
  };
  return { ctx, tools, routes, effects, logs };
}

const plugin = await import('./index.js');
const harness = createContext();
plugin.apply(harness.ctx, { defaultEnabled: false, shotDir });
const tools = harness.tools;
const stateRoute = harness.routes.get('/computer-use/state');
const stepEnum = tools.get('computer_actions').parameters.steps.items.properties.action.enum;
globalThis.__cuStub.actions = stepEnum;

const exec = (sessionId) => ({ agent: { session: { id: sessionId } }, signal: undefined });

async function postState(body) {
  const req = {
    method: 'POST',
    url: '/computer-use/state',
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body));
    },
  };
  const res = {
    status: 0,
    payload: null,
    writeHead(status) { this.status = status; },
    end(text) { this.payload = JSON.parse(text); },
  };
  await stateRoute.handler(req, res);
  return res;
}

async function getState(query) {
  const req = { method: 'GET', url: `/computer-use/state${query}` };
  const res = { status: 0, payload: null, writeHead(status) { this.status = status; }, end(text) { this.payload = JSON.parse(text); } };
  await stateRoute.handler(req, res);
  return res.payload;
}

console.log('\n== the interface the review found inconsistent ==');
const stepProperties = tools.get('computer_actions').parameters.steps.items.properties;
check('the batch schema declares from_x and from_y', stepProperties.from_x !== undefined && stepProperties.from_y !== undefined, Object.keys(stepProperties).join(','));
check('the batch schema declares ref', stepProperties.ref !== undefined);
check('the batch schema declares into_hwnd', stepProperties.into_hwnd !== undefined);
check('the batch schema declares from_frame for every pointer step', stepProperties.from_frame !== undefined);
check('the paste tool declares into_hwnd', tools.get('computer_paste').parameters.into_hwnd !== undefined, Object.keys(tools.get('computer_paste').parameters).join(','));
check('the drag tool declares from_frame', tools.get('computer_drag').parameters.from_frame !== undefined);
check('the scroll tool declares from_frame', tools.get('computer_scroll').parameters.from_frame !== undefined);
const uiaEnum = tools.get('computer_ui_action').parameters.action.description;
const missingFromSingle = ['click_text', 'locate_text', 'get_caret', 'legacy_action', 'close', 'minimize', 'maximize', 'restore']
  .filter((action) => !uiaEnum.includes(`'${action}'`));
check('the single-step tool lists the same actions as the batch', missingFromSingle.length === 0, missingFromSingle.join(', '));

console.log('\n== the control state a user has to be able to read ==');
const offState = await getState('?sessionId=session-a');
check('an ungranted session is off', offState.control.state === 'off', JSON.stringify(offState.control));
await postState({ sessionId: 'session-a', enabled: true });
const observing = await getState('?sessionId=session-a');
check('a granted session that has driven nothing is observing', observing.control.state === 'observing', JSON.stringify(observing.control));
await tools.get('computer_ui').execute({ hwnd: 77, max_depth: 1, max_nodes: 5 }, exec('session-a'));
const stillObserving = await getState('?sessionId=session-a');
check('a read does not claim the desktop', stillObserving.control.state === 'observing', JSON.stringify(stillObserving.control));

globalThis.__cuStub.hangWhen = (cmd) => cmd === 'batch';
const hangingBatch = tools.get('computer_actions').execute({ steps: [{ action: 'click', x: 10, y: 10 }] }, exec('session-a'))
  .then(() => ({ ok: true }), (error) => ({ ok: false, message: error.message }));
await sleep(50);
const busy = await getState('?sessionId=session-a');
check('a session with a call in flight is busy', busy.control.state === 'busy', JSON.stringify(busy.control));
check('and the state names how many calls are in flight', busy.control.inFlight === 1, JSON.stringify(busy.control));

console.log('\n== turning the switch off is a stop, not a flag ==');
const revoked = await postState({ sessionId: 'session-a', enabled: false });
check('the revoke reports what it cancelled', revoked.payload.revoked?.cancelled >= 1, JSON.stringify(revoked.payload.revoked));
check('the state is now stopped', revoked.payload.control.state === 'stopped', JSON.stringify(revoked.payload.control));
check('the transport was told to cancel everything', globalThis.__cuStub.cancelCalls.length >= 1, JSON.stringify(globalThis.__cuStub.cancelCalls));
check('the worker was asked to release held input', globalThis.__cuStub.calls.some((call) => call.cmd === 'release'), JSON.stringify(globalThis.__cuStub.calls.map((c) => c.cmd)));
const hangingOutcome = await hangingBatch;
check('the in-flight call ended as cancelled', hangingOutcome.ok === false && hangingOutcome.message.includes('CANCELLED'), hangingOutcome.message?.slice(0, 160));
const refusedAfter = await tools.get('computer_ui').execute({ hwnd: 77 }, exec('session-a')).then(() => '', (error) => error.message);
check('and every later call is refused', refusedAfter.includes('[NOT_AUTHORIZED]'), refusedAfter.slice(0, 120));

console.log('\n== the kill switch on the tool does the same thing ==');
await postState({ sessionId: 'session-b', enabled: true });
globalThis.__cuStub.hangWhen = null;
const stopResult = await tools.get('computer_stop').execute({ disable_capability: true }, exec('session-b'));
check('computer_stop reports the disable', stopResult.disabled === true, JSON.stringify(stopResult));
check('and how many requests it cancelled', typeof stopResult.cancelled === 'number', JSON.stringify(stopResult));
const stoppedB = await getState('?sessionId=session-b');
check('the session is stopped', stoppedB.control.state === 'stopped', JSON.stringify(stoppedB.control));
const releasedCalls = globalThis.__cuStub.calls.filter((call) => call.cmd === 'release').length;
check('and held input was released', releasedCalls >= 1, String(releasedCalls));

console.log('\n== reusing an image is not the same claim as an unchanged screen ==');
await postState({ sessionId: 'session-c', enabled: true });
const frameA = Buffer.from('frame-A-bytes');
const frameB = Buffer.from('frame-B-bytes');
const frameC = Buffer.from('frame-C-bytes');
globalThis.__cuStub.frames = [frameA, frameB, frameA];
globalThis.__cuStub.frameIndex = 0;
globalThis.__cuStub.admitted = 0;
const shotOne = await tools.get('computer_screenshot').execute({}, exec('session-c'));
const shotTwo = await tools.get('computer_screenshot').execute({}, exec('session-c'));
const shotThree = await tools.get('computer_screenshot').execute({}, exec('session-c'));
check('the first frame is neither unchanged nor reused', shotOne.unchanged === undefined && shotOne.reused === undefined, JSON.stringify(shotOne).slice(0, 120));
check('a genuinely different frame is not called unchanged', shotTwo.unchanged === undefined, JSON.stringify(shotTwo).slice(0, 120));
check('the A 鈫?B 鈫?A repeat is NOT reported as an unchanged screen', shotThree.unchanged === undefined, JSON.stringify(shotThree).slice(0, 160));
check('but it does say the image resource was reused', shotThree.reused === true, JSON.stringify(shotThree).slice(0, 160));
check('and the attachment was only stored twice', globalThis.__cuStub.admitted === 2, String(globalThis.__cuStub.admitted));
const repeatEnvelope = tools.get('computer_screenshot').output.render({}, shotThree).map((block) => block.text ?? '').join('\n');
check('the envelope explains the reuse without claiming the screen is still', repeatEnvelope.includes('reused:') && !repeatEnvelope.includes('unchanged:'), repeatEnvelope.slice(0, 200));
globalThis.__cuStub.frames = [frameC, frameC];
globalThis.__cuStub.frameIndex = 0;
const sameOne = await tools.get('computer_screenshot').execute({}, exec('session-c'));
const sameTwo = await tools.get('computer_screenshot').execute({}, exec('session-c'));
check('a frame identical to the previous one IS called unchanged', sameTwo.unchanged === true && sameTwo.reused === true, JSON.stringify(sameTwo).slice(0, 160));
// The first of the pair differs from whatever came before it, so it must not claim the
// screen stood still 鈥?that is the distinction the cache used to lose.
const freshFirst = await tools.get('computer_screenshot').execute({}, exec('session-c'));
check('and the first of a pair is never called unchanged', sameOne.unchanged === undefined && freshFirst.unchanged === true, `${JSON.stringify(sameOne.unchanged)} ${JSON.stringify(freshFirst.unchanged)}`);

console.log('\n== a ref belongs to the conversation that read it ==');
globalThis.__cuStub.hangWhen = null;
await postState({ sessionId: 'session-d', enabled: true });
await postState({ sessionId: 'session-e', enabled: true });
const readD = await tools.get('computer_ui').execute({ hwnd: 77 }, exec('session-d'));
check('the read names its snapshot', typeof readD.snapshot === 'string' && readD.snapshot !== '', String(readD.snapshot));
const refD = readD.nodes[0].ref;
check('the read stamps refs', typeof refD === 'string' && refD.startsWith(readD.snapshot), String(refD));
const callsBefore = globalThis.__cuStub.calls.length;
const foreignRef = await tools.get('computer_ui_action').execute({ action: 'get_value', ref: refD }, exec('session-e'))
  .then(() => '', (error) => error.message);
check('another conversation may not act on that ref', foreignRef.includes('[STALE_REF]'), foreignRef.slice(0, 160));
check('and nothing was sent to the backend', globalThis.__cuStub.calls.length === callsBefore, `${globalThis.__cuStub.calls.length} vs ${callsBefore}`);
// A read-only action, so this proves the ref path and not the controller lease (which the
// section above deliberately left with another conversation).
const ownRef = await tools.get('computer_ui_action').execute({ action: 'get_value', ref: refD }, exec('session-d'))
  .then((value) => `ok:${value.action}`, (error) => `refused: ${error.message}`);
check('the conversation that read it may use it', ownRef === 'ok:get_value', ownRef.slice(0, 140));
const ownRefVia = await tools.get('computer_ui_action').execute({ action: 'get_value', ref: refD }, exec('session-d'));
check('the receipt says how the ref was re-found', ownRefVia.resolvedVia === 'automation-id', String(ownRefVia.resolvedVia));
const foreignStep = await tools.get('computer_actions').execute({ steps: [{ action: 'get_value', ref: refD }] }, exec('session-e'))
  .then(() => '', (error) => error.message);
check('a batch carrying a foreign ref is refused too', foreignStep.includes('[STALE_REF]'), foreignStep.slice(0, 160));
check('and the batch never ran a step', !globalThis.__cuStub.calls.some((call) => call.cmd === 'batch' && Array.isArray(call.args?.steps) && call.args.steps[0]?.ref === refD), 'a batch with the foreign ref reached the backend');

console.log('\n== compact is the default observation ==');
await postState({ sessionId: 'session-f', enabled: true });
const observation = await tools.get('computer_ui').execute({ hwnd: 77 }, exec('session-f'));
const compactText = tools.get('computer_ui').output.render({}, observation).map((block) => block.text).join('\n');
check('the compact render drops row geometry', !compactText.includes('centre='), compactText.slice(0, 200));
check('and says how to get it', compactText.includes('compact: false'), compactText.slice(0, 260));
check('the compact render keeps the ref, the type, the name and the patterns', compactText.includes('[sstub0.0]') && compactText.includes('Window "Root"') && compactText.includes('[invoke]'), compactText.slice(0, 200));
const fullText = tools.get('computer_ui').output.render({ compact: false }, observation).map((block) => block.text).join('\n');
check('compact: false brings the geometry back', fullText.includes('centre='), fullText.slice(0, 200));
check('and the returned value always carried the geometry', observation.nodes[0].x === 0 && observation.nodes[0].width === 800, JSON.stringify(observation.nodes[0]));

console.log('\n== the batch guard the worker reports is coded for the model ==');
await postState({ sessionId: 'session-guard', enabled: true });
const guardArgs = globalThis.__cuStub.calls.filter((call) => call.cmd === 'batch').at(-1)?.args;
check('the batch tool forwards stop_on_window_change', guardArgs?.stopOnWindowChange !== undefined, JSON.stringify(guardArgs ?? {}).slice(0, 160));
check('and it defaults to on', (await (async () => {
  globalThis.__cuStub.batchError = '';
  await tools.get('computer_actions').execute({ steps: [{ action: 'wait', seconds: 0.01 }] }, exec('session-guard'));
  const args = globalThis.__cuStub.calls.filter((call) => call.cmd === 'batch').at(-1)?.args;
  return args?.stopOnWindowChange === true;
})()), 'not defaulted to true');
globalThis.__cuStub.batchError = 'the window in front changed during this batch: it was hwnd 11 when the batch started and is hwnd 22 [probe] "dialog" before step 1 (\'key\'). (action_sent=false for this step; the steps listed as performed did happen)';
// Read-only steps on purpose: this section tests the mapping from the worker's message to
// the model-facing code, and a write step would claim the controller lease the earlier
// sections deliberately left with another conversation.
const guarded = await tools.get('computer_actions').execute({ steps: [{ action: 'wait', seconds: 0.01 }, { action: 'get_value', name: 'x' }] }, exec('session-guard'));
check('the worker\'s window-change stop is coded REOBSERVE_REQUIRED', String(guarded.error).includes('[REOBSERVE_REQUIRED]'), String(guarded.error).slice(0, 160));
check('and it says what to do next', String(guarded.error).includes('下一步：') && String(guarded.error).includes('computer_windows'), String(guarded.error).slice(-200));
check('and it does not claim an unknown outcome', !String(guarded.error).includes('[UNKNOWN_OUTCOME]'), String(guarded.error).slice(0, 120));
globalThis.__cuStub.batchError = '';

console.log('\n== the worker action list is checked, not assumed ==');
const mismatchStub = createContext();
globalThis.__cuStub.actions = [...stepEnum].reverse();
plugin.apply(mismatchStub.ctx, { defaultEnabled: true, shotDir });
const mismatch = await mismatchStub.tools.get('computer_actions').execute({ steps: [{ action: 'wait', seconds: 0.01 }] }, exec('session-g'))
  .then(() => '', (error) => error.message);
check('a worker with a different action set is refused', mismatch.includes('different action set'), mismatch.slice(0, 160));
globalThis.__cuStub.actions = stepEnum;

console.log(`\n===== ${passed} passed, ${failures.length} failed =====`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
rmSync(shimDir, { recursive: true, force: true });
