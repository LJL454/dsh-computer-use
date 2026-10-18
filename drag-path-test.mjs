/**
 * B3 (path drag) and B5 (relative move) against the real plugin and a real window.
 *
 * §8 wants a drag that follows a shape rather than a straight line, and §9 wants a move
 * expressed as a delta for targets whose pointer is locked or recentred. The interesting
 * part is not the receipt but the desktop: does the gesture actually trace the path, and
 * does a gesture that fails half way still let go of the button?
 *
 * So the fixture is a WPF canvas that records what the mouse did to it — where it went
 * down, every move while the button was held, and where it came up — and the assertions
 * are made against that recording:
 *
 *   - a three-point path whose middle vertex is far off the straight line between its ends
 *     comes back as a recording that bends (a chord drag would report ~0 deviation);
 *   - a two-point drag is still a straight line, so the old form is unchanged;
 *   - duplicates are dropped, a single point and 65 points are refused, and `path` with
 *     the four corner coordinates is refused rather than silently preferring one;
 *   - the whole gesture is spread over `duration_ms`;
 *   - a path that walks off the desktop fails, and the button is NOT left down
 *     (`computer_stop` then reports that nothing was held);
 *   - `move` with `dx`/`dy` reports the requested delta and an observed one, without
 *     failing when the two differ (pointer acceleration) or when the pointer does not move
 *     at all (a locked pointer is exactly what this form is for).
 *
 *   node drag-path-test.mjs
 */
import { registerHooks } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-drag-'));
const toolsStub = join(shimDir, 'dsh-tools-stub.mjs');
writeFileSync(toolsStub, 'export const defineTool = (definition) => definition;\n');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: pathToFileURL(toolsStub).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

let passed = 0;
const failures = [];
let skipped = 0;
function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`);
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`);
  }
}
function skip(label, detail) {
  skipped += 1;
  console.log(`  SKIP  ${label}${detail === undefined ? '' : ` :: ${detail}`}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const POWERSHELL = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const powershell = existsSync(POWERSHELL) ? POWERSHELL : 'powershell.exe';

/* --------------------------------------------------------------- the fixture --- */

const workDir = mkdtempSync(join(tmpdir(), 'dsh-cu-drag-probe-'));
const probeScript = join(workDir, 'probe.ps1');
const readyFile = join(workDir, 'ready.txt');
const stateFile = join(workDir, 'state.txt');
const cmdFile = join(workDir, 'cmd.txt');
const stopFile = join(workDir, 'stop');
writeFileSync(probeScript, [
  'param([string]$Dir)',
  'Add-Type -AssemblyName PresentationFramework',
  'Add-Type -AssemblyName PresentationCore',
  'Add-Type -AssemblyName WindowsBase',
  '$window = New-Object System.Windows.Window',
  "$window.Title = 'dsh-cu-drag-probe'",
  '$window.Width = 420; $window.Height = 300',
  '$window.Left = 160; $window.Top = 140',
  '$window.WindowStartupLocation = [System.Windows.WindowStartupLocation]::Manual',
  '$canvas = New-Object System.Windows.Controls.Canvas',
  '$canvas.Background = [System.Windows.Media.Brushes]::White',
  '$canvas.Name = "probeCanvas"',
  '$window.Content = $canvas',
  '$script:moves = New-Object System.Collections.Generic.List[string]',
  '$script:down = ""',
  '$script:up = ""',
  '$script:downAt = [datetime]::MinValue',
  '$script:upAt = [datetime]::MinValue',
  '$record = { param($p) $script:moves.Add(("{0},{1}" -f [int]$p.X, [int]$p.Y)) }',
  '$canvas.Add_MouseLeftButtonDown({ param($s, $e) $script:down = ("{0},{1}" -f [int]$e.GetPosition($canvas).X, [int]$e.GetPosition($canvas).Y); $script:downAt = [datetime]::UtcNow; $script:moves.Clear(); [void]$canvas.CaptureMouse() })',
  '$canvas.Add_MouseMove({ param($s, $e) if ($e.LeftButton -eq [System.Windows.Input.MouseButtonState]::Pressed) { $p = $e.GetPosition($canvas); $script:moves.Add(("{0},{1}" -f [int]$p.X, [int]$p.Y)) } })',
  '$canvas.Add_MouseLeftButtonUp({ param($s, $e) $p = $e.GetPosition($canvas); $script:up = ("{0},{1}" -f [int]$p.X, [int]$p.Y); $script:upAt = [datetime]::UtcNow; [void]$canvas.ReleaseMouseCapture() })',
  '$window.Show()',
  '$window.Activate()',
  '$origin = $canvas.PointToScreen((New-Object System.Windows.Point(0,0)))',
  '[System.IO.File]::WriteAllText((Join-Path $Dir "ready.txt"), ("hwnd=" + (New-Object System.Windows.Interop.WindowInteropHelper($window)).Handle + "`norigin=" + [int]$origin.X + "," + [int]$origin.Y), [System.Text.Encoding]::UTF8)',
  '$script:lastCmd = ""',
  '$timer = New-Object System.Windows.Threading.DispatcherTimer',
  '$timer.Interval = [TimeSpan]::FromMilliseconds(40)',
  '$timer.Add_Tick({',
  '  if (Test-Path -LiteralPath (Join-Path $Dir "stop")) { $window.Close(); return }',
  '  $cmdPath = Join-Path $Dir "cmd.txt"',
  '  if (Test-Path -LiteralPath $cmdPath) {',
  '    $cmd = [System.IO.File]::ReadAllText($cmdPath, [System.Text.Encoding]::UTF8).TrimEnd()',
  '    if ($cmd -ne "" -and $cmd -ne $script:lastCmd) {',
  '      $script:lastCmd = $cmd',
  '      Remove-Item -LiteralPath $cmdPath -Force -ErrorAction SilentlyContinue',
  '      if ($cmd.StartsWith("focus")) { $window.Activate() }',
  '      if ($cmd.StartsWith("reset")) { $script:down = ""; $script:up = ""; $script:moves.Clear() }',
  '    }',
  '  }',
  '  if (Test-Path -LiteralPath (Join-Path $Dir "ask")) {',
  '    Remove-Item -LiteralPath (Join-Path $Dir "ask") -Force -ErrorAction SilentlyContinue',
  '    $lines = @()',
  '    $lines += "hwnd=" + (New-Object System.Windows.Interop.WindowInteropHelper($window)).Handle',
  '    $lines += "down=" + $script:down',
  '    $lines += "up=" + $script:up',
  '    $lines += "moves=" + $script:moves.Count',
  '    $lines += "points=" + ($script:moves -join ";")',
  '    if ($script:downAt -ne [datetime]::MinValue -and $script:upAt -ne [datetime]::MinValue) {',
  '      $lines += "gestureMs=" + [int]($script:upAt - $script:downAt).TotalMilliseconds',
  '    }',
  '    [System.IO.File]::WriteAllText((Join-Path $Dir "state.txt"), ($lines -join "`r`n"), [System.Text.Encoding]::UTF8)',
  '  }',
  '})',
  '$timer.Start()',
  '[System.Windows.Threading.Dispatcher]::Run()',
  '$timer.Stop()',
  'try { $window.Close() } catch { }',
].join('\n'), 'utf8');

let probe = null;
let fixtureSeq = 0;
function tellFixture(command) {
  fixtureSeq += 1;
  writeFileSync(cmdFile, `${command}#${fixtureSeq}\n`, 'utf8');
}
function askFixture() {
  rmSync(stateFile, { force: true });
  writeFileSync(join(workDir, 'ask'), 'now\n', 'utf8');
  for (let i = 0; i < 80; i += 1) {
    if (existsSync(stateFile)) {
      const state = {};
      for (const line of readFileSync(stateFile, 'utf8').split(/\r?\n/)) {
        const at = line.indexOf('=');
        if (at > 0) state[line.slice(0, at)] = line.slice(at + 1);
      }
      return state;
    }
    const until = Date.now() + 50;
    while (Date.now() < until) { /* the fixture writes within a tick or two */ }
  }
  return {};
}
/** The points the fixture recorded, in canvas coordinates. */
function recordedPoints(state) {
  if (typeof state.points !== 'string' || state.points === '') return [];
  return state.points.split(';').map((pair) => {
    const [x, y] = pair.split(',').map((one) => Number(one));
    return { x, y };
  });
}
/** How far a recorded gesture strays from the straight line between its own ends. */
function maxDeviation(points) {
  if (points.length < 3) return 0;
  const first = points[0];
  const last = points[points.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return 0;
  let worst = 0;
  for (const point of points) {
    const area = Math.abs(dx * (first.y - point.y) - (first.x - point.x) * dy);
    worst = Math.max(worst, area / length);
  }
  return worst;
}

/* -------------------------------------------------------------- the plugin --- */

const plugin = await import('./index.js');
const tools = new Map();
const services = {
  webServer: { register: () => () => {} },
  attachments: { saveImages: async (inputs) => inputs.map((input) => ({ attachmentId: 'sha256:test', mediaType: input.mediaType, bytes: input.data.byteLength, width: 10, height: 10 })) },
};
const ctx = {
  tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
  webServer: services.webServer,
  effect: (fn) => { const disposer = fn(); return () => { if (typeof disposer === 'function') disposer(); }; },
  inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx); return () => {}; },
  get: (name) => services[name],
  logger: { info: () => {}, warn: () => {} },
};
plugin.apply(ctx, { defaultEnabled: true });
const exec = { agent: { session: { id: 'drag-path-session' } }, signal: undefined };
const callTool = (name, args) => tools.get(name).execute(args, exec);
const refuses = (name, args) => callTool(name, args).then(() => '', (error) => String(error.message));

let hwnd = 0;
let origin = { x: 0, y: 0 };
try {
  probe = spawn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', probeScript, workDir], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  for (let i = 0; i < 120; i += 1) {
    if (existsSync(readyFile)) break;
    await sleep(100);
  }
  if (!existsSync(readyFile)) throw new Error('the fixture window never started');
  const ready = readFileSync(readyFile, 'utf8');
  hwnd = Number((ready.match(/hwnd=(\d+)/) ?? [])[1] ?? 0);
  const originMatch = ready.match(/origin=(-?\d+),(-?\d+)/);
  if (originMatch !== null) origin = { x: Number(originMatch[1]), y: Number(originMatch[2]) };
  console.log(`\nfixture: hwnd=${hwnd} canvas origin=(${origin.x},${origin.y})\n`);
  await callTool('computer_windows', { focus_hwnd: hwnd }).catch(() => {});
  tellFixture('focus');
  await sleep(400);

  /** A canvas point (in window/canvas coordinates) as an absolute desktop point. */
  const at = (x, y) => ({ x: origin.x + x, y: origin.y + y });

  /* ------------------------------------------------------------ path drag --- */
  console.log('== a path drag follows the path, not the chord ==');
  tellFixture('reset');
  await sleep(150);
  const start = at(40, 40);
  const bend = at(200, 40);
  const finish = at(200, 180);
  const startedAt = Date.now();
  const pathDrag = await callTool('computer_drag', {
    path: [start, bend, finish],
    duration_ms: 600,
  });
  const elapsed = Date.now() - startedAt;
  await sleep(300);
  const recorded = askFixture();
  const points = recordedPoints(recorded);
  const deviation = maxDeviation(points);
  console.log(`  (recorded ${points.length} move(s), max deviation from the chord ${deviation.toFixed(1)} px, gesture ${recorded.gestureMs ?? '?'} ms, call ${elapsed} ms)`);
  check('the receipt names the path it walked', pathDrag.path?.points === 3, JSON.stringify(pathDrag.path));
  check('the receipt starts and ends where the path does',
    pathDrag.from.x === start.x && pathDrag.from.y === start.y && pathDrag.to.x === finish.x && pathDrag.to.y === finish.y,
    JSON.stringify({ from: pathDrag.from, to: pathDrag.to }));
  check('the gesture was sampled into many moves', points.length >= 8, String(points.length));
  check('the recording starts where the drag started',
    recorded.down === '40,40' || (points.length > 0 && Math.abs(points[0].x - 40) <= 3 && Math.abs(points[0].y - 40) <= 3),
    `down=${recorded.down} first=${JSON.stringify(points[0])}`);
  check('the recording ends where the drag ended',
    recorded.up === '200,180' || (points.length > 0 && Math.abs(points[points.length - 1].x - 200) <= 4 && Math.abs(points[points.length - 1].y - 180) <= 4),
    `up=${recorded.up} last=${JSON.stringify(points[points.length - 1])}`);
  check('the mouse really traced the bend (a straight chord would deviate ~0)', deviation > 40, deviation.toFixed(1));
  check('the gesture took the requested time, not more', Number(recorded.gestureMs ?? 0) >= 300 && Number(recorded.gestureMs ?? 0) <= 2500, String(recorded.gestureMs));

  /* ------------------------------------------------------- straight drag --- */
  console.log('\n== the two-point form is unchanged ==');
  tellFixture('reset');
  await sleep(150);
  const straight = await callTool('computer_drag', {
    from_x: at(40, 160).x, from_y: at(40, 160).y,
    to_x: at(300, 160).x, to_y: at(300, 160).y,
  });
  await sleep(300);
  const straightRecorded = askFixture();
  const straightPoints = recordedPoints(straightRecorded);
  check('no path is reported for a two-point drag', straight.path === undefined, JSON.stringify(straight.path));
  check('the drag still went from the first point to the second',
    straight.from.x === at(40, 160).x && straight.to.x === at(300, 160).x, JSON.stringify({ from: straight.from, to: straight.to }));
  check('the recording is a straight line', maxDeviation(straightPoints) <= 3, maxDeviation(straightPoints).toFixed(1));
  check('and it produced moves of its own', straightPoints.length >= 4, String(straightPoints.length));

  /* ------------------------------------------------------------ refusals --- */
  console.log('\n== a step names one way to move ==');
  const bothForms = await refuses('computer_drag', { path: [start, finish], from_x: start.x, from_y: start.y });
  check('path together with the corner coordinates is refused', bothForms.includes('[BAD_REQUEST]') && /not both/i.test(bothForms), bothForms.slice(0, 160));
  const onePoint = await refuses('computer_drag', { path: [start] });
  check('a one-point path is refused', onePoint.includes('[BAD_REQUEST]') && /at least two/i.test(onePoint), onePoint.slice(0, 160));
  const missingCorners = await refuses('computer_drag', {});
  check('neither form at all is refused', missingCorners.includes('[BAD_REQUEST]'), missingCorners.slice(0, 160));
  const manyPoints = await refuses('computer_drag', { path: Array.from({ length: 65 }, (_unused, index) => at(40 + index, 40)) });
  check('a 65-point path is refused', manyPoints.includes('[BAD_REQUEST]') && /64/.test(manyPoints), manyPoints.slice(0, 160));
  const moveBoth = await refuses('computer_actions', { steps: [{ action: 'move', dx: 10, x: 100 }] });
  check('a relative move that also gives x is refused', moveBoth.includes('[BAD_REQUEST]') && /relative move/i.test(moveBoth), moveBoth.slice(0, 180));
  const moveFrame = await refuses('computer_actions', { steps: [{ action: 'move', dx: 10, from_frame: 's1.1' }] });
  check('a relative move with a frame is refused', moveFrame.includes('[BAD_REQUEST]'), moveFrame.slice(0, 180));

  /* ------------------------------------------------------------ dedupe --- */
  console.log('\n== a path is normalised before anything moves ==');
  tellFixture('reset');
  await sleep(150);
  const duplicated = await callTool('computer_drag', {
    path: [start, { x: start.x, y: start.y }, bend, { x: bend.x, y: bend.y }, finish],
    duration_ms: 300,
  });
  check('consecutive duplicates are dropped', duplicated.path?.points === 3, JSON.stringify(duplicated.path));
  check('and its samples are reported', duplicated.path?.samples >= 3, JSON.stringify(duplicated.path));

  /* --------------------------------------------------- relative move (§9) --- */
  console.log('\n== a move can be a delta ==');
  const relative = await callTool('computer_actions', { steps: [{ action: 'move', dx: 40, dy: -20 }], evidence: false, screenshot: false });
  const line = (relative.performed ?? []).join(' | ');
  check('the step reports the requested delta and what the pointer did', /move relative dx=40 dy=-20 \(observed -?\d+,-?\d+\)/.test(line), line.slice(0, 160));
  check('the call succeeded', relative.count === 1 && relative.failedAt === -1, JSON.stringify({ count: relative.count, failedAt: relative.failedAt }));

  /* ------------------------------------------------- release on failure --- */
  console.log('\n== a gesture that fails half way still lets go ==');
  tellFixture('reset');
  await sleep(150);
  const offDesktop = await refuses('computer_drag', {
    path: [at(30, 30), { x: -9000, y: -9000 }, at(60, 60)],
    duration_ms: 200,
  });
  check('a path that walks off the desktop is refused', offDesktop.includes('outside the virtual desktop') || offDesktop.includes('[OUT_OF_BOUNDS]'), offDesktop.slice(0, 200));
  const stopped = await callTool('computer_stop', {});
  check('and the mouse button was not left down', stopped.count === 0, `${stopped.count} still held: ${JSON.stringify(stopped.released)}`);

  console.log(`\n${passed} passed, ${failures.length} failed, ${skipped} skipped`);
  if (failures.length > 0) {
    console.log('\nfailures:');
    for (const failure of failures) console.log(`  - ${failure}`);
  }
} catch (error) {
  console.error('drag-path-test crashed:', error);
  process.exitCode = 1;
} finally {
  try { writeFileSync(stopFile, 'stop\n', 'utf8'); } catch { /* the fixture may already be gone */ }
  await sleep(200);
  try { probe?.kill(); } catch { /* already dead */ }
  rmSync(workDir, { recursive: true, force: true });
  rmSync(shimDir, { recursive: true, force: true });
  if (failures.length > 0) process.exitCode = 1;
  setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref();
}
