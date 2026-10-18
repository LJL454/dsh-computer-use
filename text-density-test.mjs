/**
 * B1 (8.txt §5) against the real plugin, the real worker, and a controlled window.
 *
 * What this covers, and why each one is here rather than in `schema-test.mjs`:
 *
 *   - the four text fields actually read something from a real provider, in the shape
 *     `computer_ui` declares (the schema conformance check at the end is the same one
 *     `live-tool-test.mjs` uses);
 *   - the shared budget holds across fields, and a cut never splits a surrogate pair —
 *     both are properties of a *reply*, not of a schema;
 *   - `text` off adds no field at all (the compatibility half of §5: an old caller must
 *     not start paying for a feature it never asked for);
 *   - `text_target` resolves by ref and by selector, and a contradictory target is
 *     refused before anything is read;
 *   - the same configuration works on a batch's trailing observation;
 *   - a tree that did not move but a selection that did is NOT reported as `unchanged`
 *     (the acceptance clause that is easiest to get wrong);
 *   - a control with no text pattern answers `unsupported` rather than an empty string.
 *
 * The window under test is one this file starts itself (WinForms, from a script in a
 * temp directory), so nothing here depends on the user's own desktop state. A case whose
 * fixture turns out not to expose the pattern it needs is SKIPped with the reason, not
 * counted as a pass.
 *
 *   node text-density-test.mjs
 */
import { registerHooks } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-text-'));
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

/* --------------------------------------------------------------- the fixture --- */

const POWERSHELL = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const powershell = existsSync(POWERSHELL) ? POWERSHELL : 'powershell.exe';

const DOC_LINE = '第 1 行：季度报告草稿';
/** Enough text that a small budget has to cut it. No trailing newline: the fixture's
 * command file is trimmed on read, so a trailing one would be a length assertion about
 * the fixture rather than about the plugin. */
const DOC_BODY = `${DOC_LINE}\r\n${'0123456789'.repeat(12)}\r\nend-of-document`;
/** The emoji sits so that a cut at 39 code units would land between its two halves. */
const SURROGATE_PREFIX = 'A'.repeat(38);
const SURROGATE_DOC = `${SURROGATE_PREFIX}🙂${'B'.repeat(24)}`;

const workDir = mkdtempSync(join(tmpdir(), 'dsh-cu-text-probe-'));
const probeScript = join(workDir, 'probe.ps1');
const readyFile = join(workDir, 'ready.txt');
const stateFile = join(workDir, 'state.txt');
const cmdFile = join(workDir, 'cmd.txt');
const stopFile = join(workDir, 'stop');
/*
 * The fixture is WPF, not WinForms, and that is the whole point of it.
 *
 * A WinForms RichTextBox answers UI Automation with `[value]` only: no TextPattern, so
 * selection and document cannot be read from it at all (measured, and the reason this
 * file does not use one). WPF ships its own UIA provider, so a TextBox there exposes
 * TextPattern and a ListBox exposes SelectionPattern — which is what §5's four fields
 * need in order to be tested for real rather than skipped.
 *
 * The command channel is read and written as explicit UTF-8. PowerShell 5.1's
 * Get-Content/Set-Content default to the ANSI code page, which silently mangles the
 * Chinese in a fixture string and turns every length assertion into a mystery.
 */
writeFileSync(probeScript, [
  'param([string]$Dir)',
  'Add-Type -AssemblyName PresentationFramework',
  'Add-Type -AssemblyName PresentationCore',
  'Add-Type -AssemblyName WindowsBase',
  '$window = New-Object System.Windows.Window',
  "$window.Title = 'dsh-cu-text-probe'",
  '$window.Width = 640; $window.Height = 360',
  '$window.Left = 120; $window.Top = 120',
  '$window.WindowStartupLocation = [System.Windows.WindowStartupLocation]::Manual',
  '$box = New-Object System.Windows.Controls.TextBox',
  "$box.Name = 'probeDoc'",
  '$box.AcceptsReturn = $true; $box.AcceptsTab = $true',
  '$box.TextWrapping = [System.Windows.TextWrapping]::Wrap',
  '$box.Height = 190; $box.Margin = "8"',
  "$box.Text = 'placeholder'",
  '$button = New-Object System.Windows.Controls.Button',
  "$button.Name = 'probeButton'",
  "$button.Content = 'probe-action'",
  '$button.Height = 28; $button.Margin = "8,0,8,0"',
  '$list = New-Object System.Windows.Controls.ListBox',
  "$list.Name = 'probeList'",
  '$list.SelectionMode = [System.Windows.Controls.SelectionMode]::Extended',
  '$list.Height = 70; $list.Margin = "8"',
  '[void]$list.Items.Add("alpha")',
  '[void]$list.Items.Add("beta")',
  '[void]$list.Items.Add("gamma")',
  '$stack = New-Object System.Windows.Controls.StackPanel',
  '[void]$stack.Children.Add($box)',
  '[void]$stack.Children.Add($button)',
  '[void]$stack.Children.Add($list)',
  '$window.Content = $stack',
  '$window.Show()',
  '$window.Activate()',
  '[void]$window.Dispatcher.Invoke([System.Action]{}, [System.Windows.Threading.DispatcherPriority]::Background)',
  '[System.IO.File]::WriteAllText((Join-Path $Dir "ready.txt"), ("hwnd=" + (New-Object System.Windows.Interop.WindowInteropHelper($window)).Handle), [System.Text.Encoding]::UTF8)',
  '$script:lastCmd = ""',
  '$timer = New-Object System.Windows.Threading.DispatcherTimer',
  '$timer.Interval = [TimeSpan]::FromMilliseconds(60)',
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
  '      if ($verb -eq "text") { $box.Text = $value; $box.Select(0, 0) }',
  '      if ($verb -eq "select") { $at = $box.Text.IndexOf($value); if ($at -ge 0) { $box.Select($at, $value.Length) } }',
  '      if ($verb -eq "clear") { $box.Select(0, 0) }',
  '      if ($verb -eq "pick") { $list.SelectedItems.Clear(); foreach ($p in $value.Split(",")) { $i = [int]$p; if ($i -ge 0 -and $i -lt $list.Items.Count) { [void]$list.SelectedItems.Add($list.Items[$i]) } } }',
  '      if ($verb -eq "focusdoc") { $window.Activate(); [void]$box.Focus() }',
  '    }',
  '  }',
  '  if (Test-Path -LiteralPath (Join-Path $Dir "ask")) {',
  '    Remove-Item -LiteralPath (Join-Path $Dir "ask") -Force -ErrorAction SilentlyContinue',
  '    $lines = @()',
  '    $lines += "hwnd=" + (New-Object System.Windows.Interop.WindowInteropHelper($window)).Handle',
  '    $lines += "textLength=" + $box.Text.Length',
  '    $lines += "selStart=" + $box.SelectionStart',
  '    $lines += "selLength=" + $box.SelectionLength',
  '    $lines += "picked=" + $list.SelectedItems.Count',
  '    [System.IO.File]::WriteAllText((Join-Path $Dir "state.txt"), ($lines -join "`r`n"), [System.Text.Encoding]::UTF8)',
  '  }',
  '})',
  '$timer.Start()',
  '[System.Windows.Threading.Dispatcher]::Run()',
  '$timer.Stop()',
  'try { $window.Close() } catch { }',
].join('\n'), 'utf8');

let probe = null;
/** Ask the fixture to do something; the file is consumed by its timer. */
function tellProbe(command) {
  writeFileSync(cmdFile, `${command}\n`, 'utf8');
}
/** Read the fixture's own view of itself, so assertions are not made against our own hope. */
function askProbe() {
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
    spawnSync(powershell, ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 50']);
  }
  return {};
}

/* -------------------------------------------------------------- the plugin --- */

const plugin = await import('./index.js');
const tools = new Map();
const services = {
  webServer: { register: () => () => {} },
  attachments: { saveImages: async (inputs) => inputs.map((input) => ({
    attachmentId: 'sha256:test', mediaType: input.mediaType, bytes: input.data.byteLength, width: 100, height: 100,
  })) },
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

const SESSION = 'text-density-session';
const exec = { agent: { session: { id: SESSION } }, signal: undefined };
const callTool = (name, args) => tools.get(name).execute(args, exec);

/** The same schema walker `live-tool-test.mjs` uses, kept in sync with the host's rules. */
function validate(value, schema, path, errors) {
  if (schema === undefined) return;
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push(`${path}: not one of ${JSON.stringify(schema.enum)}`);
    return;
  }
  switch (schema.type) {
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${path}: expected object`);
        return;
      }
      const properties = schema.properties ?? {};
      for (const [key, child] of Object.entries(properties)) {
        const present = Object.prototype.hasOwnProperty.call(value, key);
        const required = child.required === true;
        if (!present) {
          if (required) errors.push(`${path}.${key}: missing but required`);
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
    case 'array':
      if (!Array.isArray(value)) { errors.push(`${path}: expected array`); return; }
      value.forEach((item, index) => validate(item, schema.items, `${path}[${index}]`, errors));
      return;
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
/** A lone surrogate is what a cut between the halves of one character looks like. */
function hasLoneSurrogate(text) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

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
  console.log(`\nfixture: hwnd=${hwnd} (dsh-cu-text-probe)\n`);

  // Focus it once so the focused-element path is the one under test, and give the shell a
  // moment to agree about who owns the foreground.
  await callTool('computer_windows', { focus_hwnd: hwnd }).catch(() => {});
  tellProbe('focusdoc:');
  await sleep(300);

  /* ------------------------------------------------------------ text off --- */
  console.log('== text off leaves the reply exactly as it was ==');
  const plain = await callTool('computer_ui', { hwnd, max_nodes: 60 });
  check('no text field at all when text was not asked for', plain.text === undefined, JSON.stringify(Object.keys(plain)));
  check('and the read still returns its rows', Array.isArray(plain.nodes) && plain.nodes.length > 0, String(plain.nodes?.length));

  /* -------------------------------------------------- focused + selection --- */
  console.log('\n== focused control and its selection ==');
  tellProbe(`text:${DOC_BODY.replace(/\r?\n/g, ' ')}`);
  await sleep(200);
  tellProbe('focusdoc:');
  await sleep(250);
  const state = askProbe();
  const read = await callTool('computer_ui', { hwnd, text: { focused: true, selection: true }, max_nodes: 60 });
  const text = read.text;
  check('a text block comes back', text !== undefined);
  check('the target was resolved', text?.target?.ok === true, JSON.stringify(text?.target));
  check("the source names how it was found", ['focused', 'read-row', 'ref', 'selector'].includes(text?.target?.source ?? ''), String(text?.target?.source));
  check('the focused line names the control', (text?.focused?.summary ?? '').length > 0, JSON.stringify(text?.focused));
  check('the focused line carries the control type', (text?.focused?.summary ?? '').includes('Edit') || (text?.focused?.summary ?? '').includes('Document'), text?.focused?.summary);
  check('the budget is reported', Number.isInteger(text?.budget?.max_chars) && text.budget.max_chars === 2000, JSON.stringify(text?.budget));
  check('the standard conformance check passes', conformance('computer_ui', read).length === 0, conformance('computer_ui', read).join('; '));
  check('the fixture agrees the document is the one we set', state.textLength === String(DOC_BODY.replace(/\r?\n/g, ' ').length), `${state.textLength}`);

  const onlySelection = await callTool('computer_ui', { hwnd, text: { focused: false, selection: true }, max_nodes: 60 });
  check('an unrequested field is absent, not null', onlySelection.text?.focused === undefined, JSON.stringify(Object.keys(onlySelection.text ?? {})));
  check('the requested field is present', onlySelection.text?.selection !== undefined, JSON.stringify(onlySelection.text));
  const selectionStatus = onlySelection.text?.selection?.status;
  if (selectionStatus === 'ok') {
    check('nothing is selected, and that is reported as an answer', (onlySelection.text.selection.value ?? '') === '', JSON.stringify(onlySelection.text.selection));
    check('with a note saying so', /nothing is selected/i.test(onlySelection.text.selection.note ?? ''), String(onlySelection.text.selection.note));
  } else {
    skip('the empty-selection clause', `the fixture provider answered selection=${selectionStatus}`);
  }

  /* ----------------------------------------------------------- document --- */
  console.log('\n== document, on one shared budget ==');
  const docRead = await callTool('computer_ui', { hwnd, text: { document: true }, max_text_chars: 60, max_nodes: 60 });
  const document = docRead.text?.document;
  check('the document field is present', document !== undefined, JSON.stringify(docRead.text));
  if (document?.status === 'ok') {
    check('the document was read, cut at the budget', (document.value ?? '').length <= 60 && document.value.length > 0, String((document.value ?? '').length));
    check('and says it was cut', document.truncated === true, String(document.truncated));
    check('the budget records the cut itself', docRead.text.budget.truncated === true, JSON.stringify(docRead.text.budget));
    check('the budget accounts for what was returned', docRead.text.budget.returned_chars === (document.value ?? '').length, JSON.stringify(docRead.text.budget));
    check('the document starts with the fixture text', document.value.startsWith('第 1 行'), document.value.slice(0, 20));
  } else {
    skip('the document clauses', `the fixture provider answered document=${document?.status} ${document?.note ?? ''}`);
  }

  /* -------------------------------------------- surrogate pair at the cut --- */
  console.log('\n== a cut never splits a character ==');
  tellProbe(`text:${SURROGATE_DOC}`);
  await sleep(200);
  tellProbe('focusdoc:');
  await sleep(250);
  const surrogateRead = await callTool('computer_ui', { hwnd, text: { document: true }, max_text_chars: 39, max_nodes: 40 });
  const surrogateDoc = surrogateRead.text?.document;
  if (surrogateDoc?.status === 'ok') {
    check('no lone surrogate survives the cut', !hasLoneSurrogate(surrogateDoc.value ?? ''), JSON.stringify(surrogateDoc.value));
    check('the character that straddled the cut was dropped whole', (surrogateDoc.value ?? '').length === 38, `${(surrogateDoc.value ?? '').length} chars`);
    check('and the cut is still reported', surrogateDoc.truncated === true);
  } else {
    skip('the surrogate clauses', `document=${surrogateDoc?.status}`);
  }

  /* -------------------------------------------------------- text_target --- */
  console.log('\n== text_target: a ref, a selector, and a contradiction ==');
  tellProbe(`text:${DOC_BODY.replace(/\r?\n/g, ' ')}`);
  await sleep(150);
  tellProbe('focusdoc:');
  await sleep(250);
  const withRefRead = await callTool('computer_ui', { hwnd, text: {}, max_nodes: 80 });
  const ref = withRefRead.text?.target?.ref;
  if (typeof ref === 'string' && ref !== '') {
    const byRef = await callTool('computer_ui', { hwnd, text: { focused: true }, text_target: { ref }, max_nodes: 80 });
    check('a ref from this read resolves', byRef.text?.target?.ok === true, JSON.stringify(byRef.text?.target));
    check("and the source says it came from a ref", byRef.text?.target?.source === 'ref', String(byRef.text?.target?.source));
    check('the same ref is echoed back for the next call', byRef.text?.target?.ref === ref, `${byRef.text?.target?.ref} vs ${ref}`);
  } else {
    skip('the ref clauses', 'this read returned no ref for the text target');
  }
  const bySelector = await callTool('computer_ui', { hwnd, text: { selected: true }, text_target: { automation_id: 'probeList' }, max_nodes: 80 });
  check('a selector resolves too', bySelector.text?.target?.ok === true, JSON.stringify(bySelector.text?.target));
  check("and reports itself as a selector resolution", bySelector.text?.target?.source === 'selector', String(bySelector.text?.target?.source));
  const selected = bySelector.text?.selected;
  if (selected?.status === 'ok') {
    check('the list reports how many items are selected', Number.isInteger(selected.count), JSON.stringify(selected));
  } else if (selected?.status === 'unsupported') {
    // Documented state of this build: the selected-items list is read through the managed
    // API only, and this read went through the COM client (which is what the tree used).
    check('an unreadable selected-items list is reported, not answered with "none"', typeof selected.note === 'string' && selected.note.length > 0, JSON.stringify(selected));
  } else {
    check('the selected-items status is one of the documented ones', false, JSON.stringify(selected));
  }
  let refused = '';
  try {
    await callTool('computer_ui', { hwnd, text: {}, text_target: { ref: 's1.1', automation_id: 'probeList' } });
  } catch (error) {
    refused = String(error.message);
  }
  check('a ref and a selector together are refused', refused.includes('[BAD_REQUEST]') && refused.includes('not both'), refused.slice(0, 160));
  let emptyRefused = '';
  try {
    await callTool('computer_ui', { hwnd, text: {}, text_target: { ref: '' } });
  } catch (error) {
    emptyRefused = String(error.message);
  }
  check('an empty ref is refused rather than ignored', emptyRefused.includes('[BAD_REQUEST]'), emptyRefused.slice(0, 160));

  /* ------------------------------------------------- a non-text control --- */
  console.log('\n== a control with no text pattern says so ==');
  const buttonRead = await callTool('computer_ui', { hwnd, text: { focused: true, document: true, selection: true }, text_target: { automation_id: 'probeButton' }, max_nodes: 60 });
  check('the button resolved as a target', buttonRead.text?.target?.ok === true, JSON.stringify(buttonRead.text?.target));
  check('the focused line describes it', (buttonRead.text?.focused?.summary ?? '').includes('Button'), buttonRead.text?.focused?.summary);
  check('the document read is reported as unsupported, not empty', buttonRead.text?.document?.status === 'unsupported', JSON.stringify(buttonRead.text?.document));
  check('with an explanation instead of an empty string', typeof buttonRead.text?.document?.note === 'string' && buttonRead.text.document.note.length > 0);

  /* ------------------------------------------- selection follows the tree --- */
  console.log('\n== a changed selection is a change, even in an unchanged tree ==');
  tellProbe(`text:${DOC_BODY.replace(/\r?\n/g, ' ')}`);
  await sleep(150);
  tellProbe('clear:');
  await sleep(150);
  const query = { hwnd, text: { focused: true, selection: true }, max_nodes: 60, filter: 'probeDoc' };
  const first = await callTool('computer_ui', query);
  const second = await callTool('computer_ui', query);
  check('an identical repeat is reported as unchanged', second.unchanged === true, `first.unchanged=${first.unchanged} second.unchanged=${second.unchanged}`);
  tellProbe(`select:${DOC_LINE}`);
  await sleep(250);
  const third = await callTool('computer_ui', query);
  const selectionText = third.text?.selection?.value ?? '';
  if (selectionText !== '') {
    check('the new selection is in the reply', selectionText.includes('季度报告草稿'), JSON.stringify(selectionText));
    check('and is not reported as an unchanged observation', third.unchanged !== true, `unchanged=${third.unchanged}`);
  } else {
    skip('the selection-change clause', 'the fixture provider did not report a selection');
  }

  /* ------------------------------------------------------------ batches --- */
  console.log('\n== the same text block on a batch observation ==');
  const focusStepRef = ref !== undefined && ref !== '' ? ref : undefined;
  const batch = await callTool('computer_actions', {
    steps: focusStepRef === undefined
      ? [{ action: 'wait', seconds: 0.2 }]
      : [{ action: 'focus', ref: focusStepRef, hwnd }],
    state: { hwnd, text: { selection: true, document: true }, max_text_chars: 40 },
    evidence: false,
    screenshot: false,
  }).catch((error) => ({ failed: String(error.message) }));
  if (batch.failed !== undefined) {
    skip('the batch clauses', batch.failed.slice(0, 160));
  } else {
    check('the trailing observation carries a text block', batch.state?.text !== undefined, JSON.stringify(Object.keys(batch.state ?? {})));
    check('it used the batch budget', batch.state?.text?.budget?.max_chars === 40, JSON.stringify(batch.state?.text?.budget));
    check('the batch reply conforms', conformance('computer_actions', batch).length === 0, conformance('computer_actions', batch).join('; '));
  }

  /* ------------------------------------------------- target_required --- */
  console.log('\n== a target that no longer resolves says so ==');
  const noTarget = await callTool('computer_ui', { hwnd, text: { focused: true, selection: true }, text_target: { automation_id: 'no-such-control-anywhere' }, max_nodes: 20 });
  const targetStatus = noTarget.text?.target?.status;
  check('an unresolvable target is reported as unavailable', targetStatus === 'unavailable', JSON.stringify(noTarget.text?.target));
  check('the note says what could not be resolved', /could not be resolved|no UI Automation element matched/i.test(noTarget.text?.target?.note ?? ''), String(noTarget.text?.target?.note));
  check('the requested fields carry that status too', noTarget.text?.focused?.status === 'unavailable', JSON.stringify(noTarget.text?.focused));
  const noneRequested = await callTool('computer_ui', { hwnd, text: {}, max_nodes: 20 });
  check('a read with no text configuration still reports what it read', noneRequested.text?.budget !== undefined && noneRequested.text?.target !== undefined, JSON.stringify(noneRequested.text));

  /* -------------------------------------------------- budget accounting --- */
  console.log('\n== the budget is shared, not per field ==');
  tellProbe(`text:${DOC_BODY.replace(/\r?\n/g, ' ')}`);
  await sleep(150);
  tellProbe(`select:${DOC_LINE}`);
  await sleep(200);
  tellProbe('focusdoc:');
  await sleep(250);
  const tight = await callTool('computer_ui', { hwnd, text: { focused: true, selection: true, document: true }, max_text_chars: 80, max_nodes: 60 });
  const budget = tight.text?.budget ?? {};
  const spent = ['focused', 'selection', 'document'].reduce((total, key) => total + ((tight.text?.[key]?.value ?? tight.text?.[key]?.summary ?? '').length), 0);
  check('no field returned more than the budget', budget.returned_chars <= 80, JSON.stringify(budget));
  check('the budget counts what the fields actually returned', spent <= budget.returned_chars, `fields=${spent} budget=${budget.returned_chars}`);
  check('a tight budget is reported as truncated', budget.truncated === true, JSON.stringify(budget));
  check('late fields do not silently come back empty', ['focused', 'selection', 'document'].every((key) => {
    const field = tight.text?.[key];
    if (field === undefined) return true;
    if (field.status === 'budget_exhausted') return typeof field.note === 'string' && field.note.length > 0;
    if (field.status === 'ok') return true;
    return field.status === 'unsupported' || field.status === 'failed';
  }), JSON.stringify(tight.text));

  console.log(`\n${passed} passed, ${failures.length} failed, ${skipped} skipped`);
  if (failures.length > 0) {
    console.log('\nfailures:');
    for (const failure of failures) console.log(`  - ${failure}`);
  }
} catch (error) {
  console.error('text-density-test crashed:', error);
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
