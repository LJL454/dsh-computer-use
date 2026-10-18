/**
 * The fixed task set the source review asked for, with the metrics it named.
 *
 * The review's acceptance section is not about shapes or unit behaviour: it says the thing
 * to measure is **task completion rate, dispatches to the wrong target, duplicated
 * execution, stop latency and recovery rate**, over a fixed set of real tasks, repeated.
 * `schema-test` cannot answer any of those (it stubs the backend) and `live-tool-test`
 * asserts behaviour rather than measuring it over repeats. So this file does exactly that:
 *
 *   * one probe application the test owns (WinForms), which reports *its own* state on
 *     demand -- so "did the click land on the right control" is answered by the app rather
 *     than by the plugin's own receipt;
 *   * 30 real tasks over the real worker (real clicks, real typing, real UI Automation),
 *     each declaring the state change it is allowed to cause;
 *   * after every task the probe state is compared against the *expected* delta: an
 *     unexpected change is a dispatch to the wrong target, and a change that happened twice
 *     is duplicated execution -- both counted, not assumed;
 *   * stop latency is measured (a long batch cancelled mid-flight) and recovery is measured
 *     per repetition by inducing a failure and requiring the next call to succeed.
 *
 *   node task-eval.mjs                 # 3 repetitions (the review asks for 10)
 *   node task-eval.mjs --reps 10
 *   node task-eval.mjs --tasks t07,t19 --reps 5
 *   node task-eval.mjs --json artifacts/task-eval.json
 *
 * Deliberately not a head-to-head comparison against any other implementation: the ones
 * reviewed publish no runnable baseline, so there is nothing to run side by side. What
 * this produces is the part that can be measured here -- the plugin's own numbers, on a
 * fixed task set, repeatable and diffable across versions.
 */
import { registerHooks } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function argValue(name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback;
}
const REPS = Math.max(1, Number(argValue('reps', 3)));
const ONLY = argValue('tasks', '') === '' ? null : new Set(argValue('tasks', '').split(',').map((id) => id.trim()));
const JSON_OUT = argValue('json', '');
const PROBE_ONLY = args.includes('--probe-only');
const POWERSHELL = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const powershell = existsSync(POWERSHELL) ? POWERSHELL : 'powershell.exe';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------- the probe app --- */

const workDir = mkdtempSync(join(tmpdir(), 'dsh-cu-eval-'));
const probeScript = join(workDir, 'probe.ps1');
const scriptLines = [
  'param([string]$Dir)',
  'Add-Type -AssemblyName System.Windows.Forms',
  'Add-Type -AssemblyName System.Drawing',
  // The probe reports Windows' own view of it, not just WinForms': a window can be
  // "visible" to the framework and invisible to the shell (that is what `windowsHide: true`
  // does to a child process), and then every coordinate task would aim at whatever is in
  // front instead.
  "Add-Type -Namespace EvalProbe -Name Win -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(System.IntPtr h); [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();'",
  '$form = New-Object System.Windows.Forms.Form',
  "$form.Text = 'dsh-cu-eval-probe'",
  '$form.ClientSize = New-Object System.Drawing.Size(560, 380)',
  '$form.StartPosition = "Manual"',
  '$form.Left = 60',
  '$form.Top = 60',
  '$editBox = New-Object System.Windows.Forms.TextBox',
  "$editBox.Name = 'evalInput'",
  '$editBox.Left = 20; $editBox.Top = 20; $editBox.Width = 380',
  '$agreeBox = New-Object System.Windows.Forms.CheckBox',
  "$agreeBox.Name = 'evalCheck'",
  "$agreeBox.Text = 'agree'",
  '$agreeBox.Left = 20; $agreeBox.Top = 60; $agreeBox.Width = 200',
  '$countButton = New-Object System.Windows.Forms.Button',
  "$countButton.Name = 'evalButton'",
  "$countButton.Text = 'Count'",
  '$countButton.Left = 20; $countButton.Top = 92; $countButton.Width = 120',
  '$counterLabel = New-Object System.Windows.Forms.Label',
  "$counterLabel.Name = 'evalCountLabel'",
  "$counterLabel.Text = 'count:0'",
  '$counterLabel.Left = 160; $counterLabel.Top = 99; $counterLabel.Width = 240',
  '$itemsBox = New-Object System.Windows.Forms.ListBox',
  "$itemsBox.Name = 'evalList'",
  '$itemsBox.Left = 20; $itemsBox.Top = 130; $itemsBox.Width = 240; $itemsBox.Height = 120',
  '$itemsBox.Items.Add("alpha") | Out-Null',
  '$itemsBox.Items.Add("beta") | Out-Null',
  '$itemsBox.Items.Add("gamma") | Out-Null',
  '$itemsBox.Items.Add("delta") | Out-Null',
  '$form.Controls.AddRange(@($editBox, $agreeBox, $countButton, $counterLabel, $itemsBox))',
  '$script:count = 0',
  '$script:events = 0',
  '$editBox.Add_TextChanged({ $script:events++ })',
  '$editBox.Add_SelectionChanged({ $script:events++ })',
  '$agreeBox.Add_CheckedChanged({ $script:events++ })',
  '$itemsBox.Add_SelectedIndexChanged({ $script:events++ })',
  '$countButton.Add_Click({ $script:count++; $script:events++; $counterLabel.Text = "count:" + $script:count })',
  '$form.Show()',
  '$form.Activate()',
  '$form.BringToFront()',
  '[System.Windows.Forms.Application]::DoEvents()',
  '$script:raised = $false',
  '$script:lastMove = ""',
  '$script:lastRaise = ""',
  '$script:lastReset = ""',
  'Set-Content -LiteralPath (Join-Path $Dir "probe-ready.txt") -Value ("hwnd=" + $form.Handle)',
  // A real message loop, not a DoEvents spin.
  //
  // The spin version worked until a *window capture* asked the probe to render itself: a
  // window capture sends WM_PRINT and waits for the window to answer, and a DoEvents loop
  // that spends most of its time inside Start-Sleep and file IO starves that message -- the
  // probe's UI thread stays wedged, and from then on every UI Automation read of it comes
  // back with a handful of rows and no controls (measured: 6 nodes instead of 16, for the
  // rest of the run, while a freshly started worker reads the same window fine).
  // Application.Run pumps every message, so the probe answers a capture the way a real
  // application does.
  '$timer = New-Object System.Windows.Forms.Timer',
  '$timer.Interval = 80',
  '$timer.Add_Tick({',
  '  if (Test-Path -LiteralPath (Join-Path $Dir "probe-stop")) { $form.Close(); return }',
  '  if (Test-Path -LiteralPath (Join-Path $Dir "probe-move")) {',
  '    $mv = (Get-Content -LiteralPath (Join-Path $Dir "probe-move") -Raw).Trim()',
  '    if ($mv -ne "" -and $mv -ne $script:lastMove) {',
  '      $script:lastMove = $mv',
  '      $form.Left = $form.Left + 90',
  '      $form.Top = $form.Top + 60',
  // The probe keeps itself on screen. The tasks move it on purpose, and a long repeated run
  // walks it off the desktop -- where the window list stops describing it and every coordinate
  // task fails for a reason that has nothing to do with the plugin.
  '      if ($form.Left -gt 1700 -or $form.Top -gt 900) { $form.Left = 60; $form.Top = 60 }',
  '    }',
  '  }',
  '  if (Test-Path -LiteralPath (Join-Path $Dir "probe-reset")) {',
  '    $rz = (Get-Content -LiteralPath (Join-Path $Dir "probe-reset") -Raw).Trim()',
  '    if ($rz -ne "" -and $rz -ne $script:lastReset) {',
  '      $script:lastReset = $rz',
  '      $form.Left = 60',
  '      $form.Top = 60',
  '    }',
  '  }',
  '  if (Test-Path -LiteralPath (Join-Path $Dir "probe-raise")) {',
  '    $rs = (Get-Content -LiteralPath (Join-Path $Dir "probe-raise") -Raw).Trim()',
  '    if ($rs -ne "" -and $rs -ne $script:lastRaise) {',
  '      $script:lastRaise = $rs',
  '      if (-not $script:raised) {',
  '        $script:raised = $true',
  '        $script:second = New-Object System.Windows.Forms.Form',
  "        $script:second.Text = 'dsh-cu-eval-probe-2'",
  '        $script:second.ClientSize = New-Object System.Drawing.Size(300, 160)',
  '        $script:second.StartPosition = "CenterScreen"',
  '        $script:second.Show()',
  '      }',
  '      $script:second.Activate()',
  '      $script:second.BringToFront()',
  '    }',
  '  }',
  '  if (Test-Path -LiteralPath (Join-Path $Dir "probe-ask")) {',
  '    $token = (Get-Content -LiteralPath (Join-Path $Dir "probe-ask") -Raw).Trim()',
  '    Remove-Item -LiteralPath (Join-Path $Dir "probe-ask") -Force -ErrorAction SilentlyContinue',
  '    $lines = @()',
  '    $lines += "token=" + $token',
  '    $lines += "count=" + $script:count',
  '    $lines += "check=" + $(if ($agreeBox.Checked) { "true" } else { "false" })',
  '    $lines += "text=" + $editBox.Text',
  '    $lines += "selStart=" + $editBox.SelectionStart',
  '    $lines += "selEnd=" + $editBox.SelectionLength',
  '    $lines += "selectedIndex=" + $itemsBox.SelectedIndex',
  '    $lines += "events=" + $script:events',
  '    $lines += "left=" + $form.Left',
  '    $lines += "top=" + $form.Top',
  '    $lines += "visible=" + $form.Visible',
  '    $lines += "shellVisible=" + [EvalProbe.Win]::IsWindowVisible($form.Handle)',
  '    $lines += "foreground=" + ([EvalProbe.Win]::GetForegroundWindow() -eq $form.Handle)',
  '    Set-Content -LiteralPath (Join-Path $Dir "probe-state.txt") -Value $lines',
  '  }',
  '})',
  '$timer.Start()',
  '[System.Windows.Forms.Application]::Run($form)',
  '$timer.Stop()',
  'try { $form.Close() } catch { }',
];
writeFileSync(probeScript, scriptLines.join('\n'), 'utf8');
const probeReadyFile = join(workDir, 'probe-ready.txt');
const askFile = join(workDir, 'probe-ask');
const stateFile = join(workDir, 'probe-state.txt');
const stopFile = join(workDir, 'probe-stop');

let probe = null;
let fixtureRestarts = 0;
let workerRestarts = 0;
let stateTokenSeq = 0;

/** Start the probe application (again, if it has to be replaced). */
function startProbe() {
  rmSync(probeReadyFile, { force: true });
  rmSync(stopFile, { force: true });
  rmSync(stateFile, { force: true });
  rmSync(askFile, { force: true });
  probe = spawn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', probeScript, workDir], {
    stdio: ['ignore', 'pipe', 'pipe'],
    // Deliberately NOT `windowsHide: true`: that flag makes the child's windows genuinely
    // invisible (`IsWindowVisible` false, while WinForms still reports `Visible` true), so the
    // probe would answer its own state questions while being absent from the window list and
    // impossible to capture. Found by this harness's own t03 assertion.
    windowsHide: false,
  });
  return probe;
}

/** Stop the probe application. */
async function stopProbe() {
  writeFileSync(stopFile, '1\n', 'utf8');
  await sleep(400);
  try {
    probe?.kill();
  } catch {
    /* already gone */
  }
}

/** Wait for the probe window to report its handle. */
async function waitForProbe(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(probeReadyFile)) {
      const match = /hwnd=(\d+)/.exec(readFileSync(probeReadyFile, 'utf8'));
      if (match !== null) return Number(match[1]);
    }
    await sleep(150);
  }
  return null;
}

/**
 * Whether the fixture still answers UI Automation the way it did at the start.
 *
 * A probe whose UI thread has been wedged (a window capture asking it to render itself is the
 * case this exists for) still reports its own state, still appears in the window list, and
 * still accepts input -- but every tree read of it comes back with a handful of rows and no
 * controls, which would turn the rest of a long repeated run into noise. Checked between
 * repetitions, where replacing the fixture costs nothing: within a repetition the tasks
 * depend on each other's state.
 */
async function probeHealthy() {
  const tree = await run('computer_ui', { hwnd: probeHwnd, max_nodes: 60 }).catch(() => null);
  if (tree === null) return { ok: false, why: 'the tree could not be read' };
  const hasInput = tree.nodes.some((node) => node.automationId === 'evalInput');
  if (!hasInput) {
    // The raw shape says whether the walk could not *name* its rows (a client or provider
    // problem) or whether the window really has no controls left.
    const named = tree.nodes.filter((node) => String(node.automationId ?? '') !== '' || String(node.name ?? '') !== '').length;
    return {
      ok: false,
      why: `the tree came back with ${tree.nodes.length} nodes and no controls (mode ${String(tree.mode)}, ${named} of them named)`,
    };
  }
  return { ok: true };
}

/** Replace the fixture and re-resolve its handle. */
async function restartProbe() {
  await stopProbe();
  startProbe();
  const hwnd = await waitForProbe();
  if (hwnd === null) throw new Error('the replacement probe did not start');
  probeHwnd = hwnd;
  fixtureRestarts += 1;
  return hwnd;
}

/**
 * Replace the plugin's worker process.
 *
 * This is the heal that actually works for the tree degradation: a worker that has started
 * answering through the legacy accessibility bridge keeps doing so for the rest of its life, and
 * re-creating the client *inside* it does not clear that (both verified by hand). A fresh worker
 * reads the same window through the window's own provider again. Refs minted before the restart
 * are refused by generation, which is what the plugin documents and what a caller should see.
 */
async function restartWorker() {
  for (const dispose of disposers.reverse()) {
    try {
      dispose();
    } catch {
      /* best effort */
    }
  }
  disposers.length = 0;
  tools.clear();
  plugin.apply(ctx, { defaultEnabled: true, shotDir: join(workDir, 'shots') });
  workerRestarts += 1;
}

/**
 * Ask the probe application what its own controls hold.
 *
 * This is the point of the probe: the plugin's receipt says what it *thinks* it did, and a
 * wrong-target dispatch is exactly the case where those two disagree. The application is the
 * only witness that cannot be wrong about what reached it.
 *
 * The request carries a token and the answer has to quote it back. Without that, a state file
 * written for an earlier request (the probe is answering on its own timer) can be read as the
 * answer to this one -- which is how a run once reported "the field is empty" for a field the
 * previous task had just filled.
 */
async function probeState(timeoutMs = 6_000) {
  const token = `${Date.now()}-${++stateTokenSeq}`;
  rmSync(stateFile, { force: true });
  writeFileSync(askFile, `${token}\n`, 'utf8');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(stateFile)) {
      const state = {};
      for (const line of readFileSync(stateFile, 'utf8').split(/\r?\n/)) {
        const at = line.indexOf('=');
        if (at <= 0) continue;
        const key = line.slice(0, at);
        state[key] = line.slice(at + 1);
      }
      if (state.token === token && state.count !== undefined) {
        return {
          count: Number(state.count),
          check: state.check === 'true',
          text: state.text ?? '',
          selStart: Number(state.selStart ?? 0),
          selEnd: Number(state.selEnd ?? 0),
          selectedIndex: Number(state.selectedIndex ?? -1),
          events: Number(state.events ?? 0),
          left: Number(state.left ?? 0),
          top: Number(state.top ?? 0),
          // Windows' own answer, so a task that cannot work says why instead of failing
          // somewhere downstream with a confusing message.
          shellVisible: state.shellVisible === 'True',
          foreground: state.foreground === 'True',
        };
      }
    }
    await sleep(80);
  }
  throw new Error('the probe did not report its state in time');
}

/** The delta fields a task is allowed to change; everything else must stay put. */
function delta(before, after) {
  return {
    count: after.count - before.count,
    check: after.check !== before.check ? `${before.check}->${after.check}` : '',
    text: after.text !== before.text ? `${before.text}=>${after.text}` : '',
    selectedIndex: after.selectedIndex - before.selectedIndex,
    selection: after.selStart !== before.selStart || after.selEnd !== before.selEnd ? `${after.selStart}+${after.selEnd}` : '',
  };
}

/** Fields that changed but were not declared by the task: a dispatch to something else. */
function unexpectedFields(change, allowed) {
  const fields = [];
  for (const field of ['count', 'check', 'text', 'selectedIndex', 'selection']) {
    const touched = field === 'check' || field === 'text' || field === 'selection'
      ? change[field] !== ''
      : change[field] !== 0;
    if (touched && !allowed.includes(field)) fields.push(`${field}(${change[field]})`);
  }
  return fields;
}

/* --------------------------------------------------------------- the plugin --- */

const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-eval-shim-'));
const toolsStub = join(shimDir, 'dsh-tools-stub.mjs');
writeFileSync(toolsStub, 'export const toolDefinitions = [];\nexport const defineTool = (definition) => definition;\n');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: pathToFileURL(toolsStub).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const SESSION = 'eval-session';
const plugin = await import('./index.js');
const tools = new Map();
let attachmentSeq = 0;
const services = {
  webServer: { register: () => () => {} },
  attachments: {
    saveImages: async (inputs) => inputs.map((input) => ({
      attachmentId: `sha256:eval${String(++attachmentSeq).padStart(4, '0')}`,
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 2560,
      height: 1440,
    })),
  },
};
let stateRoute = null;
/** Disposers from `ctx.effect`, so the plugin's backend worker is shut down at the end. */
const disposers = [];
const ctx = {
  tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
  webServer: {
    register: (route) => {
      if (route.path === '/computer-use/state') stateRoute = route;
      return () => {};
    },
  },
  effect: (fn) => {
    const dispose = fn();
    disposers.push(typeof dispose === 'function' ? dispose : () => {});
    return () => {};
  },
  inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx); return () => {}; },
  get: (name) => services[name],
  logger: { info: () => {} },
};
plugin.apply(ctx, { defaultEnabled: true, shotDir: join(workDir, 'shots') });
const exec = { agent: { session: { id: SESSION } }, signal: undefined };
const tool = (name) => tools.get(name);
const run = (name, args) => tool(name).execute(args, exec);

/** Read the capability state the way the chip does. */
async function readState() {
  const req = { method: 'GET', url: `/computer-use/state?sessionId=${SESSION}` };
  const res = { payload: null, writeHead() {}, end(text) { this.payload = JSON.parse(text); } };
  await stateRoute.handler(req, res);
  return res.payload;
}

/** Revoke the session the way the chip's switch does. */
async function revokeSession() {
  const body = Buffer.from(JSON.stringify({ sessionId: SESSION, enabled: false }));
  const req = {
    method: 'POST',
    url: '/computer-use/state',
    async *[Symbol.asyncIterator]() { yield body; },
  };
  const res = { payload: null, writeHead() {}, end(text) { this.payload = JSON.parse(text); } };
  await stateRoute.handler(req, res);
  return res.payload;
}

/* ------------------------------------------------------------------ the tasks --- */

const PROBE_TITLE = 'dsh-cu-eval-probe';
let probeHwnd = null;
/**
 * This run's probe window, found by handle.
 *
 * By handle and not by title: a probe window left behind by an earlier run that was killed
 * mid-flight carries the same title, and picking that one would measure the wrong window --
 * its size, its position, and its controls. The title is only a fallback for the moment
 * between starting the probe and reading its handle.
 */
async function findProbe() {
  const listed = await run('computer_windows', {});
  return listed.windows.find((w) => w.hwnd === probeHwnd)
    // Exact title, not a substring: the second window this probe raises is called
    // `dsh-cu-eval-probe-2`, which contains this title and would otherwise be picked up as the
    // fixture -- a different window, at a different place, with no controls.
    ?? listed.windows.find((w) => w.title === PROBE_TITLE)
    ?? null;
}

/**
 * Put the probe back where the fixture expects it.
 *
 * The tasks move it on purpose (the stale-frame task has to move the window after the capture),
 * and a long repeated run walks it off the screen: a rectangle that is mostly outside the
 * desktop makes every coordinate task fail for a reason that has nothing to do with the plugin.
 * Checked between repetitions, where nothing depends on the window's position.
 */
async function ensureProbeOnScreen() {
  const listed = await findProbe();
  if (listed === null) return { ok: false, why: 'the probe window is not in the list' };
  const inside = listed.x >= -8 && listed.y >= -8 && listed.x < 4000 && listed.y < 3000
    && listed.x + listed.width <= 4000 && listed.y + listed.height <= 3000;
  if (inside) return { ok: true, at: `${listed.x},${listed.y}` };
  writeFileSync(join(workDir, 'probe-reset'), `${Date.now()}\n`, 'utf8');
  await sleep(700);
  const after = await findProbe();
  return { ok: after !== null && after.x < 4000 && after.y < 3000, at: after === null ? 'gone' : `${after.x},${after.y}`, moved: true };
}
/**
 * Bring the probe to the front, and say whether it got there.
 *
 * Every task starts from this, because the alternative is worse than a failure: a
 * coordinate click or a keystroke aimed at a window that is *not* in front lands on whatever
 * is (on this machine: a full-screen video). A task that cannot get the probe in front is
 * skipped and reported as an environment skip, never counted as a pass.
 */
async function ensureProbeFront() {
  // The plugin's own raise first, then a real click on the probe's title bar if the desktop
  // refuses to hand the foreground over. The second step exists because Windows only lets a
  // process move the foreground freely when *input* does it: on this machine a hidden service
  // window (GameInputSvc) holds the foreground and never answers the synthetic-ALT unlock, so
  // `focus_hwnd` reports focused=false no matter what it tries. A click is what a person
  // would do, it lands on the probe because the raise put it on top of the z-order, and it
  // touches no control (the title bar is outside the client area).
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const focused = await run('computer_windows', { focus_hwnd: probeHwnd });
    if (focused.focusSucceeded === true) return true;
    const listed = await run('computer_windows', {});
    if (listed.windows.find((w) => w.hwnd === probeHwnd)?.foreground === true) return true;
    const probeRow = listed.windows.find((w) => w.hwnd === probeHwnd);
    if (probeRow !== undefined) {
      await run('computer_click', {
        x: Math.round(probeRow.x + probeRow.width / 2),
        y: Math.round(probeRow.y + 10),
        prefer_a11y: false,
      }).catch(() => undefined);
      await sleep(350);
      const after = await run('computer_windows', {});
      if (after.windows.find((w) => w.hwnd === probeHwnd)?.foreground === true) return true;
    }
    await sleep(300);
  }
  return false;
}
/**
 * Capture the probe's screen rectangle.
 *
 * A *region* capture rather than a window capture on purpose: a window that is covered by
 * something else can come back uniform (and a uniform window frame is refused, correctly, by
 * the plugin), while the rectangle the probe occupies is always a real observation. The
 * window-capture path has its own task, which reports which source answered.
 */
async function shootProbe() {
  const found = await findProbe();
  if (found === null) throw new Error('the probe window is not in the window list');
  return run('computer_screenshot', {
    region: { x: found.x, y: found.y, width: found.width, height: found.height },
    format: 'png',
  });
}
let cachedFrame = null;
let cachedGeometry = null;

/**
 * One task.
 *
 * `allowed` names the probe-state fields the task may change -- that is what makes an
 * unexpected change *detectable* rather than ignored, and `expect` states the change that
 * must have happened for the task to count as completed. `countMax` is how much the
 * application's own click counter may move (anything above it is a duplicated dispatch).
 */
const TASKS = [
  {
    id: 't01', name: 'capture the probe region and read its geometry', allowed: [],
    async body() {
      const shot = await shootProbe();
      cachedFrame = shot.frame;
      cachedGeometry = shot;
      if (typeof shot.path !== 'string' || !existsSync(shot.path)) throw new Error('no file was written');
      if (shot.width <= 0 || shot.height <= 0) throw new Error(`degenerate geometry ${shot.width}x${shot.height}`);
      return `source=${shot.source ?? 'screen'} ${shot.imageWidth}x${shot.imageHeight}`;
    },
  },
  {
    id: 't02', name: 'window capture: the probe renders its own pixels', allowed: [],
    // Environmental: a window that is covered (or whose first paint has not happened) comes
    // back uniform, and the plugin refuses a uniform window frame on purpose. That is not a
    // task failure, so this task may report itself as skipped.
    skipWhen: (error) => error.includes('[CAPTURE_SURFACE_UNAVAILABLE]'),
    async body() {
      const shot = await run('computer_screenshot', { window: probeHwnd, format: 'png' });
      if (shot.source === 'window') {
        return `window pixels (${shot.width}x${shot.height})`;
      }
      return `fell back to the screen (${shot.width}x${shot.height}); the window could not render itself`;
    },
  },
  {
    id: 't03', name: 'list windows and find the target by title', allowed: [],
    async body() {
      const found = await findProbe();
      if (found === null) throw new Error('the probe window is not in the list');
      return `hwnd=${found.hwnd} ${found.width}x${found.height}`;
    },
  },
  {
    id: 't04', name: 'read the probe tree and find the input by automation id', allowed: [],
    async body() {
      const read = await run('computer_ui', { hwnd: probeHwnd });
      const input = read.nodes.find((node) => node.automationId === 'evalInput');
      if (input === undefined) throw new Error(`no evalInput among ${read.nodes.length} nodes`);
      return `${read.nodes.length} nodes, snapshot ${read.snapshot}`;
    },
  },
  {
    id: 't05', name: 'search the tree by name and land on the button', allowed: [],
    async body() {
      const read = await run('computer_ui', { hwnd: probeHwnd, name: 'Count' });
      const button = read.nodes.find((node) => node.automationId === 'evalButton');
      if (button === undefined) throw new Error('the search did not return the button');
      return `search returned ${read.nodes.length} node(s)`;
    },
  },
  {
    id: 't06', name: 'click into the input and type text into it', allowed: ['text', 'selection'],
    async body() {
      // A real click rather than UIA `focus`: WinForms only routes keystrokes to the control
      // that owns the keyboard focus inside the active window, and that is what a click sets.
      const shot = await shootProbe();
      const input = (await run('computer_ui', { hwnd: probeHwnd, automation_id: 'evalInput' })).nodes[0];
      const px = Math.round((input.x + 20 - shot.x) * shot.scale);
      const py = Math.round((input.y + input.height / 2 - shot.y) * shot.scale);
      await run('computer_click', { x: px, y: py, from_frame: shot.frame, prefer_a11y: false });
      const typed = await run('computer_type', { text: 'hello-eval', into_hwnd: probeHwnd });
      if (typed.typed !== 10) throw new Error(`typed ${typed.typed} characters`);
      return `typed ${typed.typed} into ${typed.foreground}`;
    },
    // Relative to what the field held: the click puts the caret where it puts it, so the text is
    // *inserted*, and in a repeated run the field is not empty at the start (repetition 1 passed
    // with an absolute expectation and repetitions 2+ did not, which is how this was found).
    expect: (change, before) => {
      const after = change.text.includes('=>') ? change.text.split('=>').pop() : '';
      return after.length === before.text.length + 10 && after.includes('hello-eval');
    },
  },
  {
    id: 't07', name: 'paste inserts the text in one gesture', allowed: ['text', 'selection'],
    async body() {
      const before = await probeState();
      const pasted = await run('computer_paste', { text: 'pasted-eval', into_hwnd: probeHwnd });
      if (pasted.pasted !== 11) throw new Error(`pasted ${pasted.pasted} characters`);
      return `pasted ${pasted.pasted} into a field holding ${before.text.length} characters`;
    },
    // A paste goes in at the caret, so the field grows by the pasted length -- unless something
    // is selected, in which case it replaces that selection, which is also correct. Both are
    // accepted; what is not accepted is the text not arriving at all.
    expect: (change, before) => {
      const after = change.text.includes('=>') ? change.text.split('=>').pop() : '';
      return after.includes('pasted-eval')
        && after.length <= before.text.length + 11
        && after.length >= before.text.length + 11 - before.selEnd;
    },
  },
  {
    id: 't08', name: 'select all and set the value through UIA', allowed: ['text', 'selection'],
    async body() {
      const set = await run('computer_ui_action', { hwnd: probeHwnd, automation_id: 'evalInput', action: 'set_value', value: 'value-eval' });
      if (set.verified !== true) throw new Error(`the control reports ${JSON.stringify(set.value)}`);
      return 'set_value verified by read-back';
    },
    expect: (change) => change.text.endsWith('=>value-eval'),
  },
  {
    id: 't09', name: 'read the value back through the same element', allowed: [],
    async body() {
      const read = await run('computer_ui_action', { hwnd: probeHwnd, automation_id: 'evalInput', action: 'get_value' });
      if (read.value !== 'value-eval') throw new Error(`read ${JSON.stringify(read.value)}`);
      return 'value matches what was written';
    },
  },
  {
    id: 't10', name: 'click the button through UI Automation (no pointer)', allowed: ['count'],
    async body() {
      const invoked = await run('computer_ui_action', { hwnd: probeHwnd, automation_id: 'evalButton', action: 'invoke' });
      if (invoked.action !== 'invoke') throw new Error('the action did not run');
      return 'invoked';
    },
    expect: (change) => change.count === 1,
  },
  {
    id: 't11', name: 'click the button by coordinate from a frame', allowed: ['count'],
    async body() {
      const shot = await shootProbe();
      const button = (await run('computer_ui', { hwnd: probeHwnd, automation_id: 'evalButton' })).nodes[0];
      const px = Math.round((button.x + button.width / 2 - shot.x) * shot.scale);
      const py = Math.round((button.y + button.height / 2 - shot.y) * shot.scale);
      const clicked = await run('computer_click', { x: px, y: py, from_frame: shot.frame, prefer_a11y: false });
      if (clicked.frame === undefined) throw new Error('the receipt did not name the frame');
      return `clicked image (${px},${py}) -> screen (${clicked.x},${clicked.y})`;
    },
    expect: (change) => change.count === 1,
  },
  {
    id: 't12', name: 'double click is delivered as two clicks, not one', allowed: ['count'], countMax: 2,
    async body() {
      const shot = await shootProbe();
      const button = (await run('computer_ui', { hwnd: probeHwnd, automation_id: 'evalButton' })).nodes[0];
      const px = Math.round((button.x + button.width / 2 - shot.x) * shot.scale);
      const py = Math.round((button.y + button.height / 2 - shot.y) * shot.scale);
      const clicked = await run('computer_click', { x: px, y: py, from_frame: shot.frame, clicks: 2, prefer_a11y: false });
      if (clicked.clicks !== 2) throw new Error(`the receipt says ${clicked.clicks} clicks`);
      return 'double click dispatched';
    },
    expect: (change) => change.count === 2,
  },
  {
    id: 't13', name: 'toggle the checkbox and read the state back', allowed: ['check'],
    async body() {
      const before = await probeState();
      await run('computer_ui_action', { hwnd: probeHwnd, automation_id: 'evalCheck', action: 'toggle' });
      const after = await run('computer_ui_action', { hwnd: probeHwnd, automation_id: 'evalCheck', action: 'toggle' });
      if (after.action !== 'toggle') throw new Error('toggle did not run');
      // Two toggles: the observable state must be back where it started, which also proves
      // the action is not being applied twice per call.
      const now = await probeState();
      if (now.check !== before.check) throw new Error('two toggles did not return the checkbox to its starting state');
      return 'toggled twice, state restored';
    },
  },
  {
    id: 't14', name: 'select a list item and confirm the selection landed', allowed: ['selectedIndex'],
    async body() {
      // The item, not the list box: a ListBox exposes Selection, only its items expose
      // SelectionItem -- selecting "the list" is a refusal, not a bug.
      const tree = await run('computer_ui', { hwnd: probeHwnd, max_nodes: 60 });
      const item = tree.nodes.find((node) => String(node.name) === 'gamma');
      if (item === undefined) throw new Error('the list items are not in the tree');
      const selected = await run('computer_ui_action', { hwnd: probeHwnd, name: 'gamma', control_type: item.controlType, action: 'select' });
      if (selected.action !== 'select') throw new Error('select did not run');
      return `selected ${item.controlType} "gamma"`;
    },
    expect: (change) => change.selectedIndex >= 0,
  },
  {
    id: 't15', name: 'read the label through the tree and confirm it reflects the counter', allowed: [],
    async body() {
      const read = await run('computer_ui', { hwnd: probeHwnd, automation_id: 'evalCountLabel' });
      const label = read.nodes[0];
      if (label === undefined || !String(label.name).includes('count:')) throw new Error(`the label reads ${JSON.stringify(label?.name)}`);
      const probeNow = await probeState();
      if (!String(label.name).includes(String(probeNow.count))) throw new Error(`the label says ${label.name} while the application counts ${probeNow.count}`);
      return `label "${label.name}" agrees with the application`;
    },
  },
  {
    id: 't16', name: 'drag inside the input to select characters', allowed: ['selection'],
    async body() {
      const shot = await shootProbe();
      const input = (await run('computer_ui', { hwnd: probeHwnd, automation_id: 'evalInput' })).nodes[0];
      const fromX = Math.round((input.x + 4 - shot.x) * shot.scale);
      const fromY = Math.round((input.y + input.height / 2 - shot.y) * shot.scale);
      const toX = Math.round((input.x + input.width / 3 - shot.x) * shot.scale);
      await run('computer_drag', { from_x: fromX, from_y: fromY, to_x: toX, to_y: fromY, from_frame: shot.frame });
      return 'drag dispatched from image coordinates';
    },
    expect: (change) => change.selection !== '',
  },
  {
    id: 't17', name: 'scroll the list with the pointer aimed by a frame', allowed: [],
    async body() {
      const shot = await shootProbe();
      const list = (await run('computer_ui', { hwnd: probeHwnd, automation_id: 'evalList' })).nodes[0];
      const px = Math.round((list.x + list.width / 2 - shot.x) * shot.scale);
      const py = Math.round((list.y + list.height / 2 - shot.y) * shot.scale);
      const scrolled = await run('computer_scroll', { direction: 'down', clicks: 2, x: px, y: py, from_frame: shot.frame });
      if (scrolled.clicks !== 2) throw new Error('the wheel was not turned');
      return 'two notches, aimed through the frame';
    },
  },
  {
    id: 't18', name: 'batch: focus, type, read back in one call', allowed: ['text', 'selection'],
    async body() {
      const batch = await run('computer_actions', {
        steps: [
          { action: 'focus', hwnd: probeHwnd, automation_id: 'evalInput' },
          { action: 'set_value', hwnd: probeHwnd, automation_id: 'evalInput', value: 'batch-eval' },
          { action: 'get_value', hwnd: probeHwnd, automation_id: 'evalInput' },
        ],
      });
      if (batch.failedAt !== -1) throw new Error(`step ${batch.failedAt} failed: ${batch.error}`);
      if (!batch.performed[2].includes('batch-eval')) throw new Error(`the read-back says ${batch.performed[2]}`);
      return `${batch.count} steps in one call`;
    },
    expect: (change) => change.text.endsWith('=>batch-eval'),
  },
  {
    id: 't19', name: 'batch: click by frame coordinate, then observe the tree', allowed: ['count'],
    async body() {
      const shot = await shootProbe();
      const button = (await run('computer_ui', { hwnd: probeHwnd, automation_id: 'evalButton' })).nodes[0];
      const px = Math.round((button.x + button.width / 2 - shot.x) * shot.scale);
      const py = Math.round((button.y + button.height / 2 - shot.y) * shot.scale);
      const batch = await run('computer_actions', {
        steps: [{ action: 'click', x: px, y: py, from_frame: shot.frame, prefer_a11y: false }],
        state: { hwnd: probeHwnd, automation_id: 'evalCountLabel' },
      });
      if (batch.failedAt !== -1) throw new Error(`step ${batch.failedAt} failed: ${batch.error}`);
      if (batch.state === undefined || batch.state.nodes.length === 0) throw new Error('the trailing read returned nothing');
      return 'click + trailing observation';
    },
    expect: (change) => change.count === 1,
  },
  {
    id: 't20', name: 'batch: invoke through a ref from the same read', allowed: ['count'],
    async body() {
      const read = await run('computer_ui', { hwnd: probeHwnd, automation_id: 'evalButton' });
      const ref = read.nodes[0].ref;
      const batch = await run('computer_actions', { steps: [{ action: 'invoke', ref }] });
      if (batch.failedAt !== -1) throw new Error(`step ${batch.failedAt} failed: ${batch.error}`);
      return 'invoked by ref inside a batch';
    },
    expect: (change) => change.count === 1,
  },
  {
    id: 't21', name: 'batch: copy a selection through the keyboard and read the clipboard', allowed: ['selection'],
    async body() {
      const before = await probeState();
      if (before.text === '') throw new Error('the field is empty, so there is nothing to copy');
      // Select by dragging across the field rather than through UIA: a WinForms TextBox
      // exposes ValuePattern, not TextPattern (the plugin says so when asked to select text),
      // and the drag is the path a person would use anyway.
      const shot = await shootProbe();
      const input = (await run('computer_ui', { hwnd: probeHwnd, automation_id: 'evalInput' })).nodes[0];
      const y = Math.round((input.y + input.height / 2 - shot.y) * shot.scale);
      const x1 = Math.round((input.x + 2 - shot.x) * shot.scale);
      const x2 = Math.round((input.x + input.width - 4 - shot.x) * shot.scale);
      await run('computer_drag', { from_x: x1, from_y: y, to_x: x2, to_y: y, from_frame: shot.frame });
      // Check the selection before the copy: if the drag selected nothing then the copy has
      // nothing to copy, and the clipboard comparison below would blame the wrong thing.
      await sleep(250);
      const selected = await probeState();
      if (selected.selEnd === 0) throw new Error(`the drag selected nothing (caret at ${selected.selStart}, selection length ${selected.selEnd})`);
      const batch = await run('computer_actions', { steps: [{ action: 'key', keys: 'ctrl+c', into_hwnd: probeHwnd }] });
      if (batch.failedAt !== -1) throw new Error(`step ${batch.failedAt} failed: ${batch.error}`);
      const clip = await run('computer_clipboard', { op: 'get' });
      const text = String(clip.text ?? '');
      if (text !== before.text) {
        // Distinguish "the copy never reached the field" from "this path is broken": the
        // single-key tool is tried once as a control, and the field's own state is reported.
        const single = await run('computer_key', { keys: 'ctrl+c', into_hwnd: probeHwnd }).then(() => '', (error) => String(error?.message ?? error).split('\n')[0]);
        await sleep(250);
        const second = String((await run('computer_clipboard', { op: 'get' })).text ?? '');
        const now = await probeState();
        throw new Error(`the batch copy left ${JSON.stringify(text.slice(0, 30))}; the single-key copy left ${JSON.stringify(second.slice(0, 30))}${single === '' ? '' : ` (it failed: ${single.slice(0, 60)})`}; field "${now.text}" caret ${now.selStart} selection ${now.selEnd}`);
      }
      return `the clipboard matches the field (${text.length} chars)`;
    },
  },
  {
    id: 't22', name: 'capture and tree in one call', allowed: [],
    async body() {
      const read = await run('computer_ui', { hwnd: probeHwnd, screenshot: true, max_depth: 3, max_nodes: 40 });
      if (read.shot === undefined || read.shot.path === undefined) throw new Error('no capture came back with the tree');
      if (!Array.isArray(read.nodes) || read.nodes.length === 0) throw new Error('no nodes came back with the capture');
      return `${read.nodes.length} nodes + a frame`;
    },
  },
  {
    id: 't23', name: 'delta read reports only what changed', allowed: ['text', 'selection'],
    async body() {
      const base = await run('computer_ui', { hwnd: probeHwnd });
      await run('computer_ui_action', { hwnd: probeHwnd, automation_id: 'evalInput', action: 'set_value', value: 'delta-eval' });
      const after = await run('computer_ui', { hwnd: probeHwnd, since: base.snapshot });
      if (after.delta?.known !== true) throw new Error(`the delta base was not held: ${JSON.stringify(after.delta)}`);
      return `${after.delta.altered} altered, ${after.delta.same} unchanged, ${after.nodes.length} row(s) returned`;
    },
    expect: (change) => change.text.endsWith('delta-eval'),
  },
  {
    id: 't24', name: 'a ref keeps naming its element after the window moves', allowed: [],
    async body() {
      const read = await run('computer_ui', { hwnd: probeHwnd, automation_id: 'evalInput' });
      const ref = read.nodes[0].ref;
      const before = await probeState();
      // A unique marker content every time: the probe moves on a *change*, and a repeated
      // value would make the second repetition skip the move it is supposed to make.
      writeFileSync(join(workDir, 'probe-move'), `${Date.now()}\n`, 'utf8');
      await sleep(700);
      const value = await run('computer_ui_action', { ref, action: 'get_value' });
      const after = await probeState();
      if (after.left === before.left && after.top === before.top) throw new Error('the probe never moved');
      if (value.value !== 'delta-eval') throw new Error(`the ref read ${JSON.stringify(value.value)}`);
      cachedGeometry = await shootProbe();
      return `element still found after a ${after.left - before.left}px move (drift=${value.drift ?? 0})`;
    },
  },
  {
    id: 't25', name: 'a window frame from before the move is re-projected, not clicked blindly', allowed: ['count'],
    // A *window* frame, because that is the frame that carries the window's identity and its
    // rectangle: a region frame is a piece of the screen and cannot be stale about a window.
    skipWhen: (error) => error.includes('[CAPTURE_SURFACE_UNAVAILABLE]'),
    async body() {
      const shot = await run('computer_screenshot', { window: probeHwnd, format: 'png' });
      const button = (await run('computer_ui', { hwnd: probeHwnd, automation_id: 'evalButton' })).nodes[0];
      const px = Math.round((button.x + button.width / 2 - shot.x) * shot.scale);
      const py = Math.round((button.y + button.height / 2 - shot.y) * shot.scale);
      // Move the window *after* the capture, so the frame is stale by construction (a new
      // marker content makes the probe move once more). The wait is for the probe's own
      // poll loop, which is what actually moves it.
      const before = await probeState();
      writeFileSync(join(workDir, 'probe-move'), `${Date.now()}\n`, 'utf8');
      await sleep(900);
      const moved = await probeState();
      if (moved.left === before.left && moved.top === before.top) throw new Error('the probe did not move, so the frame cannot be stale');
      const clicked = await run('computer_click', { x: px, y: py, from_frame: shot.frame, prefer_a11y: false });
      const drift = clicked.frame?.drift ?? 0;
      if (drift === 0) throw new Error('the window moved but the receipt reports no re-projection');
      return `clicked (${clicked.x},${clicked.y}) from a frame taken before the move (drift ${drift}px)`;
    },
    expect: (change) => change.count === 1,
  },
  {
    id: 't26', name: 'a stale ref is refused with the code that says what to do', allowed: [], protection: true,
    async body() {
      const refused = await run('computer_ui_action', { ref: 'saaaa7.3', action: 'get_value' }).then(() => '', (error) => String(error.message));
      if (!refused.includes('[STALE_REF]')) throw new Error(`a ref from another generation was accepted: ${refused.slice(0, 80)}`);
      return refused.split('\n')[0].slice(0, 90);
    },
  },
  {
    id: 't27', name: 'input aimed at another window is refused before it is sent', allowed: [], protection: true,
    async body() {
      const other = (await run('computer_windows', {})).windows.find((w) => w.hwnd !== probeHwnd && w.foreground !== true);
      if (other === undefined) throw new Error('no second window is available to aim at');
      const refused = await run('computer_type', { text: 'nope', into_hwnd: other.hwnd }).then(() => '', (error) => String(error.message));
      if (!refused.includes('[FRONT_NOT_TARGET]') && !refused.includes('[SEND_INPUT_BLOCKED]')) throw new Error(`the mismatch was not refused: ${refused.slice(0, 90)}`);
      return `refused: ${refused.split('\n')[0].slice(0, 80)}`;
    },
  },
  {
    id: 't28', name: 'a batch stops when a new window takes the foreground', allowed: [], protection: true,
    async body() {
      // The window must appear *during* the batch: raising it first would just make it the
      // batch's own baseline, and the guard is about a change the caller could not see coming.
      const batch = run('computer_actions', {
        steps: [
          { action: 'wait', seconds: 2.2 },
          { action: 'type', text: 'should-not-be-typed' },
        ],
      });
      await sleep(600);
      writeFileSync(join(workDir, 'probe-raise'), `${Date.now()}\n`, 'utf8');
      const result = await batch;
      if (result.failedAt === -1) throw new Error('the batch ran to completion with another window in front');
      if (!String(result.error).includes('[REOBSERVE_REQUIRED]')) throw new Error(`the stop was not coded for re-observation: ${String(result.error).slice(0, 90)}`);
      return `stopped at step ${result.failedAt}: ${String(result.error).split('.')[0].slice(0, 80)}`;
    },
  },
  {
    id: 't29', name: 'an impossible coordinate is refused, not clamped', allowed: [], protection: true,
    async body() {
      const refused = await run('computer_click', { x: -99999, y: -99999 }).then(() => '', (error) => String(error.message));
      if (!refused.includes('[OUT_OF_BOUNDS]')) throw new Error(`the click was accepted: ${refused.slice(0, 80)}`);
      if (!refused.includes('nothing was sent')) throw new Error('the refusal does not say whether anything was sent');
      return 'refused before dispatch';
    },
  },
  {
    id: 't30', name: 'a long batch can be stopped, and the stop is measured', allowed: [],
    async body() {
      const started = Date.now();
      const pending = run('computer_actions', { steps: [{ action: 'wait', seconds: 8 }] }).then(() => 'completed', (error) => `cancelled: ${error.message.split('\n')[0].slice(0, 60)}`);
      await sleep(400);
      const revoked = await revokeSession();
      const outcome = await pending;
      const latency = Date.now() - started;
      if (outcome === 'completed') throw new Error('the batch ran to completion after the capability was switched off');
      if (revoked.revoked === undefined) throw new Error('the revoke did not report what it cancelled');
      // The switch is now off for this session; turn it back on for the rest of the run.
      const body = Buffer.from(JSON.stringify({ sessionId: SESSION, enabled: true }));
      const req = { method: 'POST', url: '/computer-use/state', async *[Symbol.asyncIterator]() { yield body; } };
      const res = { payload: null, writeHead() {}, end(text) { this.payload = JSON.parse(text); } };
      await stateRoute.handler(req, res);
      return { text: `stop latency ${latency} ms (${revoked.revoked.cancelled} cancelled)`, stopLatencyMs: latency };
    },
  },
  {
    id: 't32', name: 'focusing a window leaves it on screen', allowed: [],
    async body() {
      // The regression this task exists for: the worker is started hidden, Windows
      // substitutes that startup show state for a process's first ShowWindow call, and the
      // old code asked for SW_SHOW -- which hid the window it was raising. The probe is the
      // witness: it reports Windows' view of itself, not the plugin's opinion.
      const receipt = await run('computer_windows', { focus_hwnd: probeHwnd });
      if (receipt.focusSucceeded !== true) throw new Error(`the raise failed: ${JSON.stringify(receipt).slice(0, 120)}`);
      const state = await probeState();
      if (state.shellVisible !== true) throw new Error('the window is not visible to the shell after being focused');
      const listed = await findProbe();
      if (listed === null) throw new Error('the window is no longer in the window list after being focused');
      return `focused and still visible (hwnd=${listed.hwnd})`;
    },
  },
  {
    id: 't31', name: 'recovery: an induced failure does not poison the next call', allowed: [], protection: true,
    async body() {
      await run('computer_screenshot', { display: 99 }).then(() => '', () => 'refused as expected');
      const read = await run('computer_ui', { hwnd: probeHwnd, max_nodes: 20 });
      if (!Array.isArray(read.nodes)) throw new Error('the call after a failure did not work');
      return `recovered (${read.nodes.length} nodes)`;
    },
  },
];

/** The probe handle, re-resolved when a task needs the current one. */
function probeWnd() {
  return probeHwnd;
}

/* ------------------------------------------------------------------- runner --- */

/**
 * Whether the desktop is accepting synthesized input at all.
 *
 * A locked workstation, a UAC secure desktop or a detached session silently discards
 * SendInput: the pointer does not move, keystrokes go nowhere, and windows cannot be brought
 * to the foreground. Every task would then be measuring the lock screen, so the set checks
 * this first and refuses to report numbers when it cannot.
 *
 * The check reads the pointer twice around a *relative* move (that is what a `move` step is)
 * and compares the two positions, because the step's own receipt reports what it asked for,
 * not what happened -- which is exactly the difference this check exists to detect.
 */
async function desktopAcceptsInput() {
  const cursor = async () => {
    const shot = await run('computer_screenshot', { region: { x: 0, y: 0, width: 8, height: 8 }, format: 'png' });
    return shot.cursor ?? null;
  };
  const before = await cursor().catch((error) => ({ error: String(error?.message ?? error).split('\n')[0] }));
  if (before === null || before.error !== undefined) {
    return { ok: false, why: `the pointer position could not be read: ${before?.error ?? 'no cursor in the capture'}` };
  }
  const target = { x: 320, y: 260 };
  const moved = await run('computer_actions', { steps: [{ action: 'move', x: target.x, y: target.y }] })
    .then((value) => value, (error) => String(error?.message ?? error).split('\n')[0]);
  if (typeof moved === 'string') return { ok: false, why: moved };
  const after = await cursor().catch(() => null);
  if (after === null) return { ok: false, why: 'the pointer position could not be read after the move' };
  // A generous radius on purpose: Windows snaps the pointer to a window's default button, so a
  // move can land several pixels from where it was asked to go. What is being checked here is
  // whether synthesized input reaches the desktop at all, not whether SetCursorPos is exact.
  const dx = Math.abs(after.x - target.x);
  const dy = Math.abs(after.y - target.y);
  if (dx > 24 || dy > 24) {
    return {
      ok: false,
      why: `the pointer did not move: asked for (${target.x},${target.y}) from (${before.x},${before.y}) and it is at (${after.x},${after.y}) -- a locked or secure desktop discards synthesized input`,
    };
  }
  return { ok: true };
}

const metrics = {
  reps: REPS,
  tasks: TASKS.length,
  runs: 0,
  completed: 0,
  skipped: 0,
  wrongTarget: 0,
  stoppedEarly: '',
  duplicates: 0,
  protectionRefusals: 0,
  recovery: { attempts: 0, succeeded: 0 },
  stopLatencyMs: [],
  failures: [],
  perTask: new Map(),
};

function record(task, passed, detail) {
  const entry = metrics.perTask.get(task.id) ?? { id: task.id, name: task.name, runs: 0, passed: 0, notes: [] };
  entry.runs += 1;
  if (passed) entry.passed += 1;
  else if (entry.notes.length < 3) entry.notes.push(detail);
  metrics.perTask.set(task.id, entry);
}

const selected = TASKS.filter((task) => ONLY === null || ONLY.has(task.id));
const startedAll = Date.now();
console.log(`\n== fixed task set: ${selected.length} tasks x ${REPS} repetition(s) ==`);
startProbe();
console.log(`   probe window: hwnd ${await waitForProbe()}`);

probeHwnd = await waitForProbe();
if (PROBE_ONLY) {
  // The fixture on its own, for when the desktop cannot be used at all: this starts the
  // probe, asks it for its state twice (the timer loop is what answers), and stops it.
  if (probeHwnd === null) {
    console.error('the probe application did not start');
    process.exitCode = 1;
  } else {
    const first = await probeState().catch((error) => ({ error: String(error?.message ?? error) }));
    await sleep(300);
    const second = await probeState().catch((error) => ({ error: String(error?.message ?? error) }));
    console.log(`probe hwnd ${probeHwnd}`);
    console.log(`  first read : ${JSON.stringify(first)}`);
    console.log(`  second read: ${JSON.stringify(second)}`);
    const listed = await findProbe();
    console.log(`  in the window list: ${listed === null ? 'no' : `yes, at (${listed.x},${listed.y}) ${listed.width}x${listed.height}`}`);
    const tree = await run('computer_ui', { hwnd: probeHwnd, max_nodes: 60 }).catch((error) => ({ error: String(error?.message ?? error).slice(0, 120) }));
    console.log(`  tree read  : ${tree.error !== undefined ? tree.error : `${tree.nodes.length} nodes, input ${tree.nodes.some((n) => n.automationId === 'evalInput') ? 'found' : 'MISSING'}`}`);
    await stopProbe();
    for (const dispose of disposers.reverse()) { try { dispose(); } catch { /* best effort */ } }
    rmSync(shimDir, { recursive: true, force: true });
    process.exit(process.exitCode ?? 0);
  }
}
if (probeHwnd === null) {
  console.error('the probe application did not start; nothing can be measured');
  process.exitCode = 1;
} else {
  // A precondition, not a task: if the desktop is not taking synthesized input, every number
  // below would describe the lock screen. Say so and stop instead of reporting noise.
  const inputOk = await desktopAcceptsInput();
  if (!inputOk.ok) {
    console.error(`\nthe desktop is not accepting synthesized input, so no task can be measured:\n  ${inputOk.why}\nUnlock the workstation (or dismiss the secure desktop) and run this again.`);
    process.exitCode = 2;
    await stopProbe();
    for (const dispose of disposers.reverse()) { try { dispose(); } catch { /* best effort */ } }
    rmSync(shimDir, { recursive: true, force: true });
    process.exit(2);
  }

  // Bring the probe to the front once, so every task starts from a known foreground.
  await run('computer_windows', { focus_hwnd: probeHwnd });

  repetitions: for (let rep = 1; rep <= REPS; rep += 1) {
    // Checked again every repetition, not just at the start: a workstation that locks in the
    // middle of a long run turns every remaining task into a measurement of the lock screen
    // (UIA reads collapse to a handful of nodes, input is discarded), and those numbers must
    // not be reported as task failures.
    const stillLive = await desktopAcceptsInput();
    if (!stillLive.ok) {
      metrics.stoppedEarly = `repetition ${rep}: ${stillLive.why}`;
      console.log(`\nstopping: the desktop stopped accepting input before repetition ${rep} — ${stillLive.why}`);
      break;
    }
    // And the fixture itself, for the same reason: a wedged probe would make the rest of the
    // run measure its own brokenness. Replaced here, between repetitions, where no task
    // depends on state left by the previous one.
    const fixture = await probeHealthy();
    if (!fixture.ok) {
      console.log(`  the fixture stopped answering UIA (${fixture.why}); replacing the worker and the probe`);
      await restartWorker();
      await restartProbe();
      console.log(`  replacement probe: hwnd ${probeHwnd}`);
    }
    const onScreen = await ensureProbeOnScreen();
    if (onScreen.moved === true) console.log(`  the probe had drifted off the desktop and was put back at (${onScreen.at})`);
    console.log(`\n-- repetition ${rep}/${REPS} --`);
    for (const task of selected) {
      metrics.runs += 1;
      // Nothing may be typed or clicked until the probe is the window in front: a task that
      // cannot get there would otherwise aim its input at the desktop behind it.
      const front = await ensureProbeFront().catch(() => false);
      if (!front) {
        metrics.skipped += 1;
        metrics.failures.push(`${task.id} (rep ${rep}): skipped — the probe could not be brought to the front`);
        console.log(`  SKIP  ${task.id} ${task.name} — the probe could not be brought to the front`);
        record(task, false, 'skipped (probe not in front)');
        continue;
      }
      const before = await probeState().catch(() => null);
      if (before === null) {
        record(task, false, 'the probe stopped answering');
        metrics.failures.push(`${task.id}: the probe stopped answering`);
        continue;
      }
      if (!before.shellVisible || !before.foreground) {
        // The harness's own environment check, reported by the probe itself: without a
        // visible, in-front window every coordinate task would measure the window behind it.
        const why = `the probe window is ${before.shellVisible ? '' : 'not visible to the shell; '}${before.foreground ? '' : 'not in the foreground; '}(left=${before.left}, top=${before.top})`;
        metrics.skipped += 1;
        metrics.failures.push(`${task.id} (rep ${rep}): skipped — ${why}`);
        console.log(`  SKIP  ${task.id} ${task.name} — ${why}`);
        record(task, false, `skipped: ${why.slice(0, 80)}`);
        continue;
      }
      let detail = '';
      let outcome = 'ok';
      let passed = false;
      try {
        const result = await task.body();
        detail = typeof result === 'string' ? result : result.text;
        if (typeof result === 'object' && Number.isFinite(result.stopLatencyMs)) metrics.stopLatencyMs.push(result.stopLatencyMs);
        outcome = 'ok';
      } catch (error) {
        detail = String(error?.message ?? error).split('\n')[0];
        if (/SEND_INPUT_BLOCKED|the pointer did not move|nothing moved|no contrast at all/i.test(detail)) {
          // The desktop stopped taking input *during* this task: the same condition the
          // precondition checks for, seen from inside a task. Stop the run instead of
          // recording a lock screen as a plugin failure.
          metrics.skipped += 1;
          metrics.stoppedEarly = `repetition ${rep}, ${task.id}: ${detail.slice(0, 160)}`;
          console.log(`\nstopping: the desktop stopped accepting input during ${task.id} — ${detail.slice(0, 120)}`);
          record(task, false, `stopped: ${detail.slice(0, 80)}`);
          break repetitions;
        }
        if (task.skipWhen !== undefined && task.skipWhen(detail)) {
          // An environment condition the task is not measuring: counted as a skip, never as
          // a pass, and printed with its reason so the number is auditable.
          metrics.skipped += 1;
          metrics.failures.push(`${task.id} (rep ${rep}): skipped — ${detail.slice(0, 140)}`);
          console.log(`  SKIP  ${task.id} ${task.name} — ${detail.slice(0, 120)}`);
          record(task, false, `skipped: ${detail.slice(0, 80)}`);
          continue;
        }
        outcome = 'error';
      }
      // Let the application process what was sent to it before asking what it holds. The
      // probe pumps its own message loop on a short timer, so reading its state in the same
      // millisecond as the last keystroke measures the harness, not the plugin.
      await sleep(400);
      const after = await probeState().catch(() => null);
      if (after === null) {
        record(task, false, `task ${task.id}: the probe stopped answering`);
        metrics.failures.push(`${task.id}: the probe stopped answering`);
        continue;
      }
      const change = delta(before, after);
      const unexpected = unexpectedFields(change, task.allowed ?? []);
      if (unexpected.length > 0) {
        metrics.wrongTarget += 1;
        detail += ` | UNEXPECTED CHANGE: ${unexpected.join(', ')}`;
      }
      // Duplicated execution: the application's own counter moved further than the task
      // declared. That is the failure a retry or a double dispatch produces, and nothing but
      // the application can see it.
      const allowedCount = task.countMax ?? 1;
      const duplicated = (task.allowed ?? []).includes('count') && Math.abs(change.count) > allowedCount;
      if (duplicated) {
        metrics.duplicates += 1;
        detail += ` | DUPLICATED (count moved ${change.count}, allowed ${allowedCount})`;
      }
      if (outcome === 'ok' && task.expect !== undefined && !task.expect(change, before)) {
        detail += ` | EXPECTED CHANGE MISSING (${JSON.stringify(change)})`;
        outcome = 'unexpected';
      }
      passed = outcome === 'ok' && unexpected.length === 0 && !duplicated;
      if (passed) metrics.completed += 1;
      else metrics.failures.push(`${task.id} (rep ${rep}): ${detail}`);
      if (task.protection === true && outcome === 'ok') metrics.protectionRefusals += 1;
      record(task, passed, detail);
      // Every task ends with the recovery probe's condition: a failure was induced inside
      // t31, and for the rest a successful read is what "the session is still usable" means.
      metrics.recovery.attempts += 1;
      const healthy = await run('computer_ui', { hwnd: probeWnd(), max_nodes: 5 }).then((value) => Array.isArray(value.nodes), () => false);
      if (healthy) metrics.recovery.succeeded += 1;
      // Diagnostic mode (`DSH_EVAL_WATCH_TREE=1`): one tree read after every task, so the exact
      // task after which the fixture's tree stops describing its controls is named rather than
      // guessed at. Off by default because it is an extra read per task.
      if (process.env.DSH_EVAL_WATCH_TREE === '1') {
        const watch = await run('computer_ui', { hwnd: probeWnd(), max_nodes: 60 }).then((value) => value, () => null);
        if (watch === null) console.log('    tree watch: unreadable');
        else if (watch.nodes.length < 10) {
          const shape = watch.nodes.map((n) => `${n.controlType}/${n.automationId || '-'}/${String(n.name).slice(0, 10) || '-'}/${(n.patterns ?? []).length}p`).join(' | ');
          console.log(`    tree watch: ${watch.nodes.length} rows after ${task.id} (mode ${String(watch.mode)}, reinit ${String(watch.reinit)}, legacy ${String(watch.legacy)}, note ${String(watch.note ?? '-').slice(0, 40)}) -> ${shape}`);
        } else {
          console.log(`    tree watch: ${watch.nodes.length} rows after ${task.id}`);
        }
      }
      console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${task.id} ${task.name} — ${detail}`);
    }
  }
}

const elapsed = ((Date.now() - startedAll) / 1000).toFixed(1);
const judged = metrics.runs - metrics.skipped;
const completionRate = judged === 0 ? 0 : metrics.completed / judged;
const recoveryRate = metrics.recovery.attempts === 0 ? 0 : metrics.recovery.succeeded / metrics.recovery.attempts;
const latencies = [...metrics.stopLatencyMs].sort((a, b) => a - b);
const p50 = latencies.length === 0 ? null : latencies[Math.floor(latencies.length / 2)];

console.log('\n== the review\'s five acceptance metrics ==');
console.log(`  task completion rate      : ${(completionRate * 100).toFixed(1)}%  (${metrics.completed}/${judged} judged runs)`);
console.log(`  dispatches to wrong target: ${metrics.wrongTarget}`);
console.log(`  duplicated executions     : ${metrics.duplicates}`);
console.log(`  stop latency              : ${p50 === null ? 'n/a' : `${p50} ms (median of ${latencies.length})`}`);
console.log(`  recovery rate             : ${(recoveryRate * 100).toFixed(1)}%  (${metrics.recovery.succeeded}/${metrics.recovery.attempts})`);
console.log(`  protection refusals       : ${metrics.protectionRefusals} (a refusal counted here is the guard working, not a failure)`);
console.log(`  skipped runs              : ${metrics.skipped} (environment conditions, excluded from the rate above)`);
if (fixtureRestarts > 0) console.log(`  fixture restarts          : ${fixtureRestarts} (the probe stopped answering UIA and was replaced between repetitions)`);
if (workerRestarts > 0) console.log(`  worker restarts           : ${workerRestarts} (the backend had started answering through the legacy accessibility bridge, which only a new process clears)`);
if (metrics.stoppedEarly !== '') console.log(`  stopped early             : ${metrics.stoppedEarly}`);
console.log(`  wall clock                : ${elapsed}s for ${metrics.runs} task runs`);
if (metrics.failures.length > 0) {
  console.log(`\n  ${metrics.failures.length} failing run(s):`);
  for (const failure of metrics.failures.slice(0, 20)) console.log(`    - ${failure}`);
}

const report = {
  generatedAt: new Date().toISOString(),
  reps: REPS,
  tasks: selected.length,
  runs: metrics.runs,
  skipped: metrics.skipped,
  stoppedEarly: metrics.stoppedEarly === '' ? null : metrics.stoppedEarly,
  judged: judged,
  completionRate,
  wrongTarget: metrics.wrongTarget,
  duplicates: metrics.duplicates,
  stopLatencyMs: { samples: latencies, median: p50 },
  recoveryRate,
  protectionRefusals: metrics.protectionRefusals,
  wallClockSeconds: Number(elapsed),
  perTask: [...metrics.perTask.values()],
  failures: metrics.failures,
};
if (JSON_OUT !== '') {
  mkdirSync(dirname(JSON_OUT), { recursive: true });
  writeFileSync(JSON_OUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\n  wrote ${JSON_OUT}`);
}
console.log(`\n===== ${metrics.completed} passed, ${metrics.runs - metrics.completed} failed =====`);

/* ---------------------------------------------------------------- teardown --- */

// Leave the desktop as it was found: the probe windows are the only thing this run added.
await stopProbe();
// The plugin's own disposers come first, because its PowerShell worker holds a pipe that
// would otherwise keep this process alive after the last line.
for (const dispose of disposers.reverse()) {
  try {
    dispose();
  } catch {
    /* best effort */
  }
}
rmSync(shimDir, { recursive: true, force: true });
if (metrics.failures.length > 0) {
  console.log(`  probe work dir kept for inspection: ${workDir}`);
} else {
  rmSync(workDir, { recursive: true, force: true });
}
