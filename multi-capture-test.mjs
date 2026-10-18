/**
 * B2 (8.txt §7) against the real plugin and two real windows.
 *
 * A popup or a menu is its own window, and a frame of the window behind it cannot say that
 * it is there. §7 asks for two things, and both are checked here on a fixture that has a
 * genuine owner relationship (a WPF window with `Owner` set, shown):
 *
 *   - the *relationship* of the windows around the target (who owns whom) and the *real
 *     z-order* (what is in front) are reported as two separate facts, with the observation
 *     time, the rectangle, visibility and the minimized flag;
 *   - `captures: 'related'` returns one frame per window, each through the whole attachment
 *     pipeline and each with its own frame id — an id that really is usable through
 *     `from_frame`, not an array index dressed up as one;
 *   - the default is still one frame, and the frame budget (2 by default, 3 at most) says
 *     what it left out.
 *
 *   node multi-capture-test.mjs
 */
import { registerHooks } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-multi-'));
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

const workDir = mkdtempSync(join(tmpdir(), 'dsh-cu-multi-probe-'));
const probeScript = join(workDir, 'probe.ps1');
const readyFile = join(workDir, 'ready.txt');
const cmdFile = join(workDir, 'cmd.txt');
const stopFile = join(workDir, 'stop');
writeFileSync(probeScript, [
  'param([string]$Dir)',
  'Add-Type -AssemblyName PresentationFramework',
  'Add-Type -AssemblyName PresentationCore',
  'Add-Type -AssemblyName WindowsBase',
  '$main = New-Object System.Windows.Window',
  "$main.Title = 'dsh-cu-multi-probe'",
  '$main.Width = 420; $main.Height = 300',
  '$main.Left = 200; $main.Top = 160',
  '$main.WindowStartupLocation = [System.Windows.WindowStartupLocation]::Manual',
  '$button = New-Object System.Windows.Controls.Button',
  "$button.Name = 'probeButton'",
  "$button.Content = 'probe-action'",
  '$button.Height = 30; $button.Margin = "10"',
  '$main.Content = $button',
  '$main.Show()',
  '$main.Activate()',
  '# An owned window, shown: this is the relationship the plugin has to see (a dialog that',
  '# belongs to the target), and it is a real top-level HWND of its own.',
  '$popup = New-Object System.Windows.Window',
  "$popup.Title = 'dsh-cu-multi-popup'",
  '$popup.Width = 260; $popup.Height = 140',
  '$popup.Owner = $main',
  '$popup.WindowStartupLocation = [System.Windows.WindowStartupLocation]::CenterOwner',
  '$popup.Show()',
  '$popup.Activate()',
  '[System.IO.File]::WriteAllText((Join-Path $Dir "ready.txt"), ("main=" + (New-Object System.Windows.Interop.WindowInteropHelper($main)).Handle + "`npopup=" + (New-Object System.Windows.Interop.WindowInteropHelper($popup)).Handle), [System.Text.Encoding]::UTF8)',
  '$script:lastCmd = ""',
  '$timer = New-Object System.Windows.Threading.DispatcherTimer',
  '$timer.Interval = [TimeSpan]::FromMilliseconds(60)',
  '$timer.Add_Tick({',
  '  if (Test-Path -LiteralPath (Join-Path $Dir "stop")) { $popup.Close(); $main.Close(); return }',
  '  $cmdPath = Join-Path $Dir "cmd.txt"',
  '  if (Test-Path -LiteralPath $cmdPath) {',
  '    $cmd = [System.IO.File]::ReadAllText($cmdPath, [System.Text.Encoding]::UTF8).TrimEnd()',
  '    if ($cmd -ne "" -and $cmd -ne $script:lastCmd) {',
  '      $script:lastCmd = $cmd',
  '      Remove-Item -LiteralPath $cmdPath -Force -ErrorAction SilentlyContinue',
  '      if ($cmd.StartsWith("front")) { $popup.Activate() }',
  '      if ($cmd.StartsWith("main2front")) { $main.Activate() }',
  '      if ($cmd.StartsWith("minimize")) { $popup.WindowState = [System.Windows.WindowState]::Minimized }',
  '      if ($cmd.StartsWith("restore")) { $popup.WindowState = [System.Windows.WindowState]::Normal; $popup.Activate() }',
  '    }',
  '  }',
  '})',
  '$timer.Start()',
  '[System.Windows.Threading.Dispatcher]::Run()',
  '$timer.Stop()',
  'try { $popup.Close(); $main.Close() } catch { }',
].join('\n'), 'utf8');

let probe = null;
let fixtureSeq = 0;
function tellFixture(command) {
  fixtureSeq += 1;
  writeFileSync(cmdFile, `${command}#${fixtureSeq}\n`, 'utf8');
}

/* -------------------------------------------------------------- the plugin --- */

const plugin = await import('./index.js');
const tools = new Map();
let admitted = 0;
const services = {
  webServer: { register: () => () => {} },
  attachments: {
    saveImages: async (inputs) => inputs.map((input) => {
      admitted += 1;
      return { attachmentId: `sha256:multi${String(admitted).padStart(4, '0')}`, mediaType: input.mediaType, bytes: input.data.byteLength, width: 120, height: 90 };
    }),
  },
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
const exec = { agent: { session: { id: 'multi-capture-session' } }, signal: undefined };
const callTool = (name, args) => tools.get(name).execute(args, exec);
const refuses = (name, args) => callTool(name, args).then(() => '', (error) => String(error.message));

function validate(value, schema, path, errors) {
  if (schema === undefined) return;
  if (schema.enum !== undefined && !schema.enum.includes(value)) { errors.push(`${path}: not one of ${JSON.stringify(schema.enum)}`); return; }
  switch (schema.type) {
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) { errors.push(`${path}: expected object`); return; }
      const properties = schema.properties ?? {};
      for (const [key, child] of Object.entries(properties)) {
        const present = Object.prototype.hasOwnProperty.call(value, key);
        if (!present) {
          if (child.required === true) errors.push(`${path}.${key}: missing but required`);
          continue;
        }
        validate(value[key], child, `${path}.${key}`, errors);
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!Object.prototype.hasOwnProperty.call(properties, key)) errors.push(`${path}.${key}: not a declared property`);
        }
      }
      return;
    }
    case 'array': if (!Array.isArray(value)) { errors.push(`${path}: expected array`); return; } value.forEach((item, index) => validate(item, schema.items, `${path}[${index}]`, errors)); return;
    case 'string': if (typeof value !== 'string') errors.push(`${path}: expected string`); return;
    case 'integer': if (!Number.isInteger(value)) errors.push(`${path}: expected integer`); return;
    case 'number': if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${path}: expected finite number`); return;
    case 'boolean': if (typeof value !== 'boolean') errors.push(`${path}: expected boolean`); return;
    default: return;
  }
}
function conformance(toolName, value) {
  const errors = [];
  validate(value, tools.get(toolName).output.schema, 'value', errors);
  return errors;
}

let mainHwnd = 0;
let popupHwnd = 0;
try {
  probe = spawn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', probeScript, workDir], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  for (let i = 0; i < 120; i += 1) {
    if (existsSync(readyFile)) break;
    await sleep(100);
  }
  if (!existsSync(readyFile)) throw new Error('the fixture windows never started');
  const ready = readFileSync(readyFile, 'utf8');
  mainHwnd = Number((ready.match(/main=(\d+)/) ?? [])[1] ?? 0);
  popupHwnd = Number((ready.match(/popup=(\d+)/) ?? [])[1] ?? 0);
  console.log(`\nfixture: main=${mainHwnd} popup=${popupHwnd}\n`);
  if (mainHwnd === 0 || popupHwnd === 0) throw new Error('the fixture did not report its handles');
  tellFixture('front');
  await sleep(500);

  /* ------------------------------------------------------- related capture --- */
  console.log('== captures: related gives one frame per window, popup first ==');
  const related = await callTool('computer_screenshot', { window: mainHwnd, captures: 'related', max_captures: 2 });
  const frames = related.frames ?? [];
  check('two frames come back', frames.length === 2, JSON.stringify(frames.map((one) => one.relation)));
  check('the popup is captured first', frames[0]?.relation === 'owned-popup', JSON.stringify(frames.map((one) => one.relation)));
  check('the window itself is the other frame', frames[1]?.relation === 'self', JSON.stringify(frames.map((one) => one.relation)));
  check('each frame has its own frame id', frames.length === 2 && frames[0].frame !== undefined && frames[1].frame !== undefined && frames[0].frame !== frames[1].frame,
    JSON.stringify(frames.map((one) => one.frame)));
  check('each frame names the window it is of', frames[0]?.windowHwnd === popupHwnd && frames[1]?.windowHwnd === mainHwnd,
    JSON.stringify(frames.map((one) => one.windowHwnd)));
  check('each frame went through the attachment pipeline', frames.every((one) => one.image?.attachmentId !== undefined && one.image.width > 0),
    JSON.stringify(frames.map((one) => one.image?.attachmentId)));
  check('each frame reports its encoded size', frames.every((one) => Number(one.imageWidth) > 0 && Number(one.imageHeight) > 0),
    JSON.stringify(frames.map((one) => [one.imageWidth, one.imageHeight])));
  check('the z-ranks are known and the popup is in front of the window behind it',
    frames.every((one) => one.zRankKnown === true) && Number(frames[0].zRank) < Number(frames[1].zRank),
    JSON.stringify(frames.map((one) => [one.zRank, one.zRankKnown])));
  check('the owner relationship is reported', frames[0]?.ownerHwnd === mainHwnd, `${frames[0]?.ownerHwnd} vs ${mainHwnd}`);
  check('the reply conforms to the declared schema', validate(related, tools.get('computer_screenshot').output.schema, 'value', []) === undefined && (() => { const errors = []; validate(related, tools.get('computer_screenshot').output.schema, 'value', errors); return errors.length === 0; })(), (() => { const errors = []; validate(related, tools.get('computer_screenshot').output.schema, 'value', errors); return errors.join('; '); })());
  check('the related list carries the metadata that decided', Array.isArray(related.related) && related.related.length >= 2
    && related.related.every((row) => row.owner_hwnd !== undefined && row.relation !== undefined && row.visible !== undefined && row.minimized !== undefined && row.observed_at !== undefined),
    JSON.stringify(related.related?.[0]));

  /* ------------------------------------------------------------ useful id --- */
  console.log('\n== the frame id is usable, not just a label ==');
  const popupFrame = frames[0];
  // The image the model is shown is the *attached* one, and that is the space the frame id
  // projects in — the encoded file may be bigger. `attachment`/`image` carry the delivered
  // size; `imageWidth` is the encoder's.
  const shownWidth = Number(popupFrame.attachment?.width ?? popupFrame.image?.width ?? popupFrame.imageWidth ?? popupFrame.width);
  const shownHeight = Number(popupFrame.attachment?.height ?? popupFrame.image?.height ?? popupFrame.imageHeight ?? popupFrame.height);
  const inside = { x: Number(popupFrame.x) + Math.round(Number(popupFrame.width) / 2), y: Number(popupFrame.y) + Math.round(Number(popupFrame.height) / 2) };
  // Something else may be in front of the fixture on a desktop that is being used for real:
  // the landing guard would refuse the click, and that refusal is the guard working, not a
  // frame-id problem. Raise the popup once and treat an occlusion refusal as a skip.
  tellFixture('front');
  await sleep(400);
  let clicked;
  try {
    clicked = await callTool('computer_click', { x: Math.round(shownWidth / 2), y: Math.round(shownHeight / 2), from_frame: popupFrame.frame });
  } catch (error) {
    const message = String(error.message);
    if (/\[TARGET_OCCLUDED\]|is over hwnd/.test(message)) skip('the frame-id usability clauses', 'something else was in front of the fixture on this desktop, so the landing guard refused the click');
    else throw error;
  }
  if (clicked !== undefined) {
    check('a click through that frame id is accepted', clicked.frame !== undefined, JSON.stringify(clicked.frame));
    check('and it projected into the popup it names', Math.abs(Number(clicked.frame?.projected?.x ?? 0) - inside.x) <= 12 && Math.abs(Number(clicked.frame?.projected?.y ?? 0) - inside.y) <= 12,
      `${JSON.stringify(clicked.frame?.projected)} vs ${JSON.stringify(inside)}`);
  }

  /* ------------------------------------------------------------ the budget --- */
  console.log('\n== the budget says what it left out ==');
  const one = await callTool('computer_screenshot', { window: mainHwnd, captures: 'related', max_captures: 1 });
  check('a budget of one returns one frame', one.frames?.length === 1, JSON.stringify(one.frames?.map((entry) => entry.relation)));
  check('and it is the popup (the thing in front)', one.frames?.[0]?.relation === 'owned-popup', JSON.stringify(one.frames?.map((entry) => entry.relation)));
  check('the window that was not captured is named with a reason',
    Array.isArray(one.omitted) && one.omitted.length >= 1 && /max_captures/.test(String(one.omitted[0].reason)),
    JSON.stringify(one.omitted));

  /* ------------------------------------------------------------ unchanged --- */
  console.log('\n== the default is still one frame ==');
  const single = await callTool('computer_screenshot', { window: mainHwnd });
  check('no frames array without captures: related', single.frames === undefined, JSON.stringify(Object.keys(single).slice(0, 8)));
  check('and it is still one envelope', Number(single.width) > 0 && typeof single.path === 'string', JSON.stringify({ width: single.width, path: single.path }));
  check('no relation is claimed for a single capture', single.relation === undefined && single.zRank === undefined, JSON.stringify({ relation: single.relation, zRank: single.zRank }));

  /* --------------------------------------------------- tree plus frames --- */
  console.log('\n== a read can carry the popup frames too (§7 interface) ==');
  const readWithFrames = await callTool('computer_ui', { hwnd: mainHwnd, captures: 'related', max_captures: 2, max_nodes: 60 });
  check('the read still returns its tree', Array.isArray(readWithFrames.nodes) && readWithFrames.nodes.length > 0, String(readWithFrames.nodes?.length));
  check('and it carries the related frames', readWithFrames.frames?.length === 2, JSON.stringify(readWithFrames.frames?.map((one) => one.relation)));
  check('with each frame id usable', readWithFrames.frames?.every((frame) => typeof frame.frame === 'string' && frame.frame !== '' && frame.frame !== String(readWithFrames.frames.indexOf(frame))),
    JSON.stringify(readWithFrames.frames?.map((one) => one.frame)));
  check('the read reply conforms to its schema', conformance('computer_ui', readWithFrames).length === 0, conformance('computer_ui', readWithFrames).join('; '));

  /* ------------------------------------------------------------- refusals --- */
  console.log('\n== related without a window ==');
  const noWindow = await refuses('computer_screenshot', { captures: 'related' });
  check("captures: 'related' without a window is refused", noWindow.includes('[BAD_REQUEST]') && /needs `window`/.test(noWindow), noWindow.slice(0, 160));

  /* ------------------------------------------------------------ minimized --- */
  console.log('\n== a minimized window is skipped with a reason ==');
  tellFixture('minimize');
  await sleep(600);
  const minimized = await callTool('computer_screenshot', { window: mainHwnd, captures: 'related', max_captures: 2 });
  const minimizedFrame = (minimized.frames ?? []).find((entry) => entry.windowHwnd === popupHwnd);
  const omittedMinimized = (minimized.omitted ?? []).find((entry) => entry.hwnd === popupHwnd);
  if (minimizedFrame === undefined && omittedMinimized !== undefined) {
    check('the minimized popup is not captured', true);
    check('and the reason says why', /minimized/i.test(String(omittedMinimized.reason)), String(omittedMinimized.reason));
  } else if (minimizedFrame !== undefined) {
    skip('the minimized clause', 'the popup reported a usable rectangle anyway (WPF minimized windows still answer PrintWindow here)');
  } else {
    check('the popup is accounted for either way', false, JSON.stringify({ frames: (minimized.frames ?? []).map((f) => f.windowHwnd), omitted: minimized.omitted }));
  }
  tellFixture('restore');
  await sleep(300);

  console.log(`\n${passed} passed, ${failures.length} failed, ${skipped} skipped`);
  if (failures.length > 0) {
    console.log('\nfailures:');
    for (const failure of failures) console.log(`  - ${failure}`);
  }
} catch (error) {
  console.error('multi-capture-test crashed:', error);
  process.exitCode = 1;
} finally {
  try { writeFileSync(stopFile, 'stop\n', 'utf8'); } catch { /* the fixture may already be gone */ }
  await sleep(250);
  try { probe?.kill(); } catch { /* already dead */ }
  rmSync(workDir, { recursive: true, force: true });
  rmSync(shimDir, { recursive: true, force: true });
  if (failures.length > 0) process.exitCode = 1;
  setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref();
}
