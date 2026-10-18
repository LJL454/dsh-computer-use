/**
 * B6 (8.txt §6) against the real plugin, the real worker, and a controlled window.
 *
 * §6 is about a borrow: the plugin puts text on the user's clipboard to paste it, and the
 * whole point is that the user gets their clipboard back. What this file checks:
 *
 *   - the ordinary case: the previous content is restored, and the fixture's own view of
 *     itself confirms the text arrived (the verification postcondition, not a fixed wait);
 *   - `restore: false` is reported as `not_requested`, and the pasted text is left there;
 *   - an empty clipboard round-trips back to empty (an empty clipboard and "content whose
 *     text is empty" are different facts);
 *   - a clipboard holding something this path cannot put back (an image) is reported as
 *     `unsupported_original_format` — never as `restored`;
 *   - `require_restore: true` refuses *before* writing in that case, and the image is still
 *     there afterwards;
 *   - when something else writes to the clipboard after our write, the receipt says
 *     `skipped_external_change` and the newer content survives. This is the case the old
 *     implementation got wrong: it wrote its saved text back regardless, deleting whatever
 *     the user had copied in the meantime.
 *
 * The fixture is a WPF window this file starts (the shape is shared with
 * `text-density-test.mjs`); nothing here depends on the user's own windows.
 *
 *   node paste-restore-test.mjs
 */
import { registerHooks } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-paste-'));
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

const ORIGINAL = '用户原来的剪贴板内容 original-clipboard';
const PASTED = '由 computer_paste 写入的中文文本 pasted';
const RACER = 'something-else-wrote-this';

/* --------------------------------------------------------------- the fixture --- */

const workDir = mkdtempSync(join(tmpdir(), 'dsh-cu-paste-probe-'));
const probeScript = join(workDir, 'probe.ps1');
const readyFile = join(workDir, 'ready.txt');
const stateFile = join(workDir, 'state.txt');
const cmdFile = join(workDir, 'cmd.txt');
const stopFile = join(workDir, 'stop');
const racerScript = join(workDir, 'racer.ps1');
const racerDone = join(workDir, 'racer-done');

writeFileSync(racerScript, [
  'param([string]$Dir)',
  'Add-Type -AssemblyName System.Windows.Forms',
  '$end = (Get-Date).AddMilliseconds(1500)',
  '$i = 0',
  'while ((Get-Date) -lt $end) {',
  '  $i++',
  '  try { [System.Windows.Forms.Clipboard]::SetText("something-else-wrote-this-" + $i) } catch { }',
  '  Start-Sleep -Milliseconds 25',
  '}',
  '[System.IO.File]::WriteAllText((Join-Path $Dir "racer-done"), "done", [System.Text.Encoding]::UTF8)',
].join('\n'), 'utf8');

writeFileSync(probeScript, [
  'param([string]$Dir)',
  'Add-Type -AssemblyName PresentationFramework',
  'Add-Type -AssemblyName PresentationCore',
  'Add-Type -AssemblyName WindowsBase',
  '$window = New-Object System.Windows.Window',
  "$window.Title = 'dsh-cu-paste-probe'",
  '$window.Width = 520; $window.Height = 220',
  '$window.Left = 200; $window.Top = 200',
  '$window.WindowStartupLocation = [System.Windows.WindowStartupLocation]::Manual',
  '$box = New-Object System.Windows.Controls.TextBox',
  "$box.Name = 'probeDoc'",
  '$box.AcceptsReturn = $true; $box.Height = 120; $box.Margin = "8"',
  "$box.Text = ''",
  '$window.Content = $box',
  '$window.Show()',
  '$window.Activate()',
  '[System.IO.File]::WriteAllText((Join-Path $Dir "ready.txt"), ("hwnd=" + (New-Object System.Windows.Interop.WindowInteropHelper($window)).Handle), [System.Text.Encoding]::UTF8)',
  '$script:lastCmd = ""',
  '$timer = New-Object System.Windows.Threading.DispatcherTimer',
  '$timer.Interval = [TimeSpan]::FromMilliseconds(50)',
  '$timer.Add_Tick({',
  '  if (Test-Path -LiteralPath (Join-Path $Dir "stop")) { $window.Close(); return }',
  '  $cmdPath = Join-Path $Dir "cmd.txt"',
  '  if (Test-Path -LiteralPath $cmdPath) {',
  '    $cmd = [System.IO.File]::ReadAllText($cmdPath, [System.Text.Encoding]::UTF8).TrimEnd()',
  '    if ($cmd -ne "" -and $cmd -ne $script:lastCmd) {',
  '      $script:lastCmd = $cmd',
  '      Remove-Item -LiteralPath $cmdPath -Force -ErrorAction SilentlyContinue',
  '      $split = $cmd.IndexOf(":")',
  '      $verb = $cmd.Substring(0, $split)',
  '      $value = $cmd.Substring($split + 1)',
  '      if ($verb -eq "text") { $box.Text = $value }',
  '      if ($verb -eq "clear") { $box.Text = "" }',
  '      if ($verb -eq "focusdoc") { $window.Activate(); [void]$box.Focus() }',
  '    }',
  '  }',
  '  if (Test-Path -LiteralPath (Join-Path $Dir "ask")) {',
  '    Remove-Item -LiteralPath (Join-Path $Dir "ask") -Force -ErrorAction SilentlyContinue',
  '    $lines = @()',
  '    $lines += "hwnd=" + (New-Object System.Windows.Interop.WindowInteropHelper($window)).Handle',
  '    $lines += "textLength=" + $box.Text.Length',
  '    $lines += "text=" + $box.Text',
  '    [System.IO.File]::WriteAllText((Join-Path $Dir "state.txt"), ($lines -join "`r`n"), [System.Text.Encoding]::UTF8)',
  '  }',
  '})',
  '$timer.Start()',
  '[System.Windows.Threading.Dispatcher]::Run()',
  '$timer.Stop()',
  'try { $window.Close() } catch { }',
].join('\n'), 'utf8');

let probe = null;
/**
 * Send a command to the fixture.
 *
 * The value carries a sequence number even for verbs that ignore it: the fixture skips a
 * command identical to the one it just processed (that is how it avoids acting on a
 * half-written file), so two identical `clear:` lines in a row would be silently dropped.
 */
let fixtureSeq = 0;
function tellFixture(command) {
  fixtureSeq += 1;
  const at = command.indexOf(':');
  const verb = command.slice(0, at);
  const value = command.slice(at + 1);
  const payload = `${verb}:${value}${value === '' ? '' : ' '}#${fixtureSeq}`;
  writeFileSync(cmdFile, `${payload}\n`, 'utf8');
}
function askFixture() {
  rmSync(stateFile, { force: true });
  writeFileSync(join(workDir, 'ask'), 'now\n', 'utf8');
  for (let i = 0; i < 60; i += 1) {
    if (existsSync(stateFile)) {
      const state = {};
      for (const line of readFileSync(stateFile, 'utf8').split(/\r?\n/)) {
        const at = line.indexOf('=');
        if (at > 0) state[line.slice(0, at)] = line.slice(at + 1);
      }
      return state;
    }
    spawnSyncSleep();
  }
  return {};
}
function spawnSyncSleep() {
  const until = Date.now() + 50;
  while (Date.now() < until) { /* the fixture writes within a tick or two */ }
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
const exec = { agent: { session: { id: 'paste-restore-session' } }, signal: undefined };
const callTool = (name, args) => tools.get(name).execute(args, exec);

function validate(value, schema, path, errors) {
  if (schema === undefined) return;
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push(`${path}: not one of ${JSON.stringify(schema.enum)}`);
    return;
  }
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
const clipboardText = async () => (await callTool('computer_clipboard', { op: 'get' })).text ?? '';

let hwnd = 0;
try {
  probe = spawn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', probeScript, workDir], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  for (let i = 0; i < 100; i += 1) {
    if (existsSync(readyFile)) break;
    await sleep(100);
  }
  if (!existsSync(readyFile)) throw new Error('the fixture window never started');
  hwnd = Number(readFileSync(readyFile, 'utf8').replace(/[^0-9]/g, ''));
  console.log(`\nfixture: hwnd=${hwnd} (dsh-cu-paste-probe)\n`);
  await callTool('computer_windows', { focus_hwnd: hwnd }).catch(() => {});
  tellFixture('focusdoc:');
  await sleep(300);

  /* ------------------------------------------------- the ordinary borrow --- */
  console.log('== a paste borrows the clipboard and gives it back ==');
  tellFixture('clear:');
  await callTool('computer_clipboard', { op: 'set', text: ORIGINAL });
  await sleep(100);
  const ordinary = await callTool('computer_paste', { text: PASTED, into_hwnd: hwnd, verify: { automation_id: 'probeDoc', hwnd } });
  await sleep(300);
  const afterOrdinary = askFixture();
  check('the paste reports what it did', ordinary.pasted === PASTED.length, JSON.stringify(ordinary.pasted));
  check('the events were sent', ordinary.eventsSent > 0, String(ordinary.eventsSent));
  check('the previous content is back', ordinary.restoreStatus === 'restored' && ordinary.restored === true, JSON.stringify(ordinary.restoreStatus));
  check('the clipboard really holds the original text again', (await clipboardText()) === ORIGINAL, await clipboardText());
  check('the fixture received the pasted text', afterOrdinary.text === PASTED, JSON.stringify((afterOrdinary.text ?? '').slice(0, 40)));
  check('the postcondition verifies the paste', ordinary.pasteVerification?.status === 'verified', JSON.stringify(ordinary.pasteVerification));
  check('the sequence numbers are reported', ordinary.clipboard?.seqAfterWrite > ordinary.clipboard?.seqBefore, JSON.stringify(ordinary.clipboard));
  check('the reply conforms to the declared schema', conformance('computer_paste', ordinary).length === 0, conformance('computer_paste', ordinary).join('; '));

  /* ------------------------------------------------------ restore: false --- */
  console.log('\n== restore: false keeps the borrowed text, and says so ==');
  await callTool('computer_clipboard', { op: 'set', text: ORIGINAL });
  const noRestore = await callTool('computer_paste', { text: PASTED, into_hwnd: hwnd, restore: false });
  await sleep(200);
  check('the outcome is not_requested, not restored', noRestore.restoreStatus === 'not_requested', String(noRestore.restoreStatus));
  check('and it does not claim a restore happened', noRestore.restored === false, String(noRestore.restored));
  check('the clipboard holds the pasted text', (await clipboardText()) === PASTED, await clipboardText());
  check('without verify the reply cannot confirm arrival', noRestore.pasteVerification === undefined, JSON.stringify(noRestore.pasteVerification));

  /* ------------------------------------------------------------ empty --- */
  console.log('\n== an empty clipboard round-trips back to empty ==');
  tellFixture('clear:');
  await callTool('computer_clipboard', { op: 'clear' });
  await sleep(100);
  const fromEmpty = await callTool('computer_paste', { text: PASTED, into_hwnd: hwnd });
  await sleep(200);
  check('an empty clipboard is restored to empty', fromEmpty.restoreStatus === 'restored', String(fromEmpty.restoreStatus));
  check('the clipboard is empty again', (await clipboardText()) === '', JSON.stringify(await clipboardText()));

  /* -------------------------------------------- content it cannot restore --- */
  console.log('\n== an image on the clipboard is reported, not silently dropped ==');
  /** Put a bitmap on the clipboard (the one thing this path cannot write back). */
  const installImage = async () => {
    const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command',
      'Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $b = New-Object System.Drawing.Bitmap(12,12); [System.Windows.Forms.Clipboard]::SetImage($b); "ok"'],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    await new Promise((resolve) => {
      child.on('exit', resolve);
      setTimeout(resolve, 8000);
    });
    await sleep(200);
  };
  await installImage();
  const imageGet = await callTool('computer_clipboard', { op: 'get' });
  if (imageGet.length !== 0) {
    skip('the non-text clipboard clauses', 'the clipboard could not be given an image in this session');
  } else {
    const overImage = await callTool('computer_paste', { text: PASTED, into_hwnd: hwnd });
    await sleep(200);
    check('an unrestorable clipboard is reported as such', overImage.restoreStatus === 'unsupported_original_format', String(overImage.restoreStatus));
    check('and is never called restored', overImage.restored === false, String(overImage.restored));
    check('with a sentence naming what was there', typeof overImage.restoreNote === 'string' && /Bitmap|DeviceIndependentBitmap|image|PNG/i.test(overImage.restoreNote), String(overImage.restoreNote));

    // The refusal is about a clipboard that is still unrestorable, so the image goes back on
    // before it is attempted (the paste above replaced it with the borrowed text).
    await installImage();
    tellFixture('clear:');
    await sleep(250);
    let refused = '';
    try {
      await callTool('computer_paste', { text: PASTED, into_hwnd: hwnd, require_restore: true });
    } catch (error) {
      refused = String(error.message);
    }
    check('require_restore refuses before writing', refused.includes('[RESTORE_UNSUPPORTED]'), refused.slice(0, 200));
    check('the refusal names the way out', /require_restore: false|computer_type|set_value/i.test(refused), refused.slice(-220));
    const afterRefusal = askFixture();
    check('nothing was pasted', afterRefusal.text === '', JSON.stringify(afterRefusal.text));
    check('and the image is still on the clipboard', (await callTool('computer_clipboard', { op: 'get' })).length === 0, 'clipboard text was non-empty');
  }

  /* --------------------------------------------------- external change --- */
  console.log('\n== somebody else writes to the clipboard: their content wins ==');
  rmSync(racerDone, { force: true });
  await callTool('computer_clipboard', { op: 'set', text: ORIGINAL });
  await sleep(120);
  tellFixture('focusdoc:');
  const racer = spawn(powershell, ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', racerScript, workDir], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  await sleep(220); // let the racer get going before the paste borrows the clipboard
  const raced = await callTool('computer_paste', { text: PASTED, into_hwnd: hwnd });
  await new Promise((resolve) => {
    racer.on('exit', resolve);
    setTimeout(resolve, 5000);
  });
  try { racer.kill(); } catch { /* already gone */ }
  const afterRace = await clipboardText();
  console.log(`  (race outcome: restoreStatus=${raced.restoreStatus}, clipboard now ${JSON.stringify(afterRace.slice(0, 32))})`);
  check('the outcome is one of the six documented states',
    ['restored', 'not_requested', 'skipped_external_change', 'unsupported_original_format', 'failed_busy', 'failed_other'].includes(raced.restoreStatus),
    String(raced.restoreStatus));
  check('it never claims a restore while holding somebody else\'s content',
    !(raced.restoreStatus === 'restored' && afterRace !== ORIGINAL && !afterRace.startsWith(RACER)),
    `status=${raced.restoreStatus} clipboard=${JSON.stringify(afterRace.slice(0, 32))}`);
  if (raced.restoreStatus === 'skipped_external_change') {
    check('the newer content survived the restore window', afterRace.startsWith(RACER), afterRace.slice(0, 40));
    check('and the note explains why nothing was put back', /changed after this paste/i.test(raced.restoreNote ?? ''), String(raced.restoreNote));
  } else {
    skip('the skipped_external_change clauses', `the racer did not land inside the restore window (status ${raced.restoreStatus})`);
  }

  // Leave the user's clipboard as we found it: the test borrowed it too.
  await callTool('computer_clipboard', { op: 'set', text: ORIGINAL });

  console.log(`\n${passed} passed, ${failures.length} failed, ${skipped} skipped`);
  if (failures.length > 0) {
    console.log('\nfailures:');
    for (const failure of failures) console.log(`  - ${failure}`);
  }
} catch (error) {
  console.error('paste-restore-test crashed:', error);
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
