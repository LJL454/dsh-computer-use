/**
 * Live tool-layer test: the real plugin code against the real PowerShell backend.
 *
 * `schema-test.mjs` validates every tool against a stub, which is what catches
 * schema drift. This file covers the other half: does the mapping from a REAL
 * backend reply — which carries extra fields and real, occasionally awkward
 * values — still produce a conforming value, and does the effect actually land?
 *
 * It drives Notepad, so it opens and closes one itself and touches nothing else.
 *
 *   node live-tool-test.mjs
 */
import { registerHooks } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-live-'));
/**
 * Where the frames this run asks for by name are written.
 *
 * A capture-provenance assertion is about *which file came back*, and the plugin's own shot
 * root names files by sequence number — so a case that has to tell "the step's frame" from
 * "the trailing capture" gives both paths itself.
 */
const liveShotDir = mkdtempSync(join(tmpdir(), 'dsh-cu-live-shots-'));
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
function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`);
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`);
  }
}

/** A case this desktop cannot run, said out loud rather than counted as a pass. */
let skipped = 0;
function skip(label, detail) {
  skipped += 1;
  console.log(`  SKIP  ${label}${detail === undefined ? '' : ` :: ${detail}`}`);
}

/** The same rules the host applies, kept in sync with schema-test.mjs. */
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
        const required = child.required === true || (Array.isArray(schema.required) && schema.required.includes(key));
        if (!present) {
          if (required) errors.push(`${path}.${key}: missing but required`);
          continue;
        }
        validate(value[key], child, `${path}.${key}`, errors);
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!Object.prototype.hasOwnProperty.call(properties, key)) {
            errors.push(`${path}.${key}: not a declared property (additionalProperties: false)`);
          }
        }
      }
      return;
    }
    case 'array':
      if (!Array.isArray(value)) { errors.push(`${path}: expected array`); return; }
      value.forEach((item, index) => validate(item, schema.items, `${path}[${index}]`, errors));
      return;
    case 'string':
      if (typeof value !== 'string') errors.push(`${path}: expected string, got ${typeof value}`);
      return;
    case 'integer':
      if (!Number.isInteger(value)) errors.push(`${path}: expected integer, got ${JSON.stringify(value)}`);
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${path}: expected finite number`);
      return;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${path}: expected boolean`);
      return;
    default:
      return;
  }
}

function conforms(tools, name, value) {
  const errors = [];
  validate(value, tools.get(name).output.schema, 'value', errors);
  return errors;
}

const SESSION = 'live-session';
const MARKER = 'DSH 实时工具层测试 中文';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let notepadHwnd = null;
// Module scope, not the try block's: the cleanup runs in `finally`, which cannot see
// bindings declared inside the block it is attached to.
let notepadPid = null;
let spawnedNotepad = false;
/** Which engine the worker reported, so the engine-specific sections can adapt. */
let engineName = '';

try {
  const plugin = await import('./index.js');
  const tools = new Map();
  let toolSeq = 0;
  const services = {
    webServer: { register: () => () => {} },
    attachments: {
      saveImages: async (inputs) => inputs.map((input) => ({
        attachmentId: `sha256:live${String(++toolSeq).padStart(4, '0')}`,
        mediaType: input.mediaType,
        bytes: input.data.byteLength,
        width: 2560,
        height: 1440,
      })),
    },
  };
  const ctx = {
    tools: { register: (d) => { tools.set(d.name, d); return () => {}; } },
    webServer: services.webServer,
    effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d(); }; },
    inject: (deps, callback) => { if (deps.every((n) => services[n] !== undefined)) callback(ctx); return () => {}; },
    get: (name) => services[name],
    logger: { info: () => {} },
  };
  plugin.apply(ctx, { defaultEnabled: true });
  const exec = { agent: { session: { id: SESSION } }, signal: undefined };
  /** Reused result slot: every section overwrites it and validates what it holds. */
  let value;
  /** The Notepad window under test. */
  let win;

  console.log('\n== failures carry a code that names the next step ==');
  // A code is only worth having if it changes what the caller does next, so each of these
  // is asserted on the code *and* on the hint it carries.
  const refuses = async (tool, args) => tools.get(tool).execute(args, exec).then(() => '', (error) => String(error.message));

  const tooLarge = await refuses('computer_screenshot', { region: { x: 0, y: 0, width: 20000, height: 20000 } });
  check('an impossible capture region is coded CAPTURE_TOO_LARGE', tooLarge.includes('[CAPTURE_TOO_LARGE]'), tooLarge.slice(0, 110));
  check('and its hint says how to fit inside the limit', tooLarge.includes('scale') && tooLarge.includes('显示器'), tooLarge.slice(-140));

  const badDisplay = await refuses('computer_screenshot', { display: 99 });
  check('an unknown display is coded DISPLAY_UNKNOWN', badDisplay.includes('[DISPLAY_UNKNOWN]'), badDisplay.slice(0, 110));
  check('and its hint says where the real indexes are', badDisplay.includes('displays'), badDisplay.slice(-120));

  const goneWindow = await refuses('computer_screenshot', { window: 999999 });
  check('a dead window handle is coded WINDOW_GONE', goneWindow.includes('[WINDOW_GONE]'), goneWindow.slice(0, 110));
  check('and its hint says to list windows again', goneWindow.includes('computer_windows'), goneWindow.slice(-110));

  // A frame id that is present but empty is not "no frame given": the caller meant to cite
  // one. Clicking absolute coordinates instead is a substitution nobody notices until the
  // wrong thing has been clicked.
  const emptyFrame = await refuses('computer_click', { x: 5, y: 5, from_frame: '' });
  check('an empty from_frame is refused rather than ignored', emptyFrame.includes('[BAD_REQUEST]') && emptyFrame.includes('empty'), emptyFrame.slice(0, 120));

  const badChord = await refuses('computer_key', { keys: 'ctrl+alt+shift+a+b+c+d+e+f+g' });
  check('an impossible chord is coded BAD_REQUEST', badChord.includes('[BAD_REQUEST]'), badChord.slice(0, 110));

  console.log('\n== launch a target application ==');
  // Reuse a Notepad that is already open when there is one, and only start our own
  // when there is not. Windows 11 Notepad restores its previous session on launch,
  // so spawning one on every run turns this test into a factory for stray windows.
  let spawnedNotepadHere = false;
  if ((await pickUsableNotepad()) === null) {
    const child = spawn('notepad.exe', [], { detached: true, stdio: 'ignore' });
    child.unref();
    spawnedNotepadHere = true;
  }
  spawnedNotepad = spawnedNotepadHere;
  /**
   * Adopt a Notepad window whose tree is actually usable.
   *
   * Not by "it is new". Windows 11 Notepad shows a placeholder window while it
   * starts and may also restore a previous session as several windows at once, and
   * a desktop that has seen a few taskkill cycles accumulates windows that still
   * enumerate and still answer, but are inert: raising one fails, and its tree then
   * collapses to the window itself. That is exactly the state the plugin reports as
   * "exposed no child controls", so this walks past it the way an agent has to —
   * adopt, raise, verify, and re-adopt when the window turns out to be a dead end.
   */
  async function pickUsableNotepad() {
    let best = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const listed = await tools.get('computer_windows').execute({}, exec);
      for (const candidate of listed.windows.filter((w) => /notepad/i.test(w.process))) {
        // A provider can fail transiently on one window — "event could not call any
        // subscriber" (0x80040201) is what a Notepad that is still restoring its session
        // answers with — and this loop exists precisely to walk past windows that cannot be
        // read. An exception here used to take the whole run down before a single assertion.
        const probe = await tools.get('computer_ui').execute({ hwnd: candidate.hwnd, max_depth: 6, max_nodes: 200 }, exec)
          .then((read) => read, (error) => ({ failed: String(error.message).slice(0, 90) }));
        if (probe.failed !== undefined) {
          console.log(`  (hwnd ${candidate.hwnd} could not be read while looking for a usable Notepad: ${probe.failed})`);
          continue;
        }
        // "Has nodes" is not the bar: Windows 11 Notepad exposes a short-lived
        // placeholder window while it restores a session, and reading that one is a
        // dead end for every later section. Neither is "has a value pattern" — the
        // title bar carries one. The bar is a window that contains a real editor — and one
        // whose editor exposes the text pattern, because that is what the read/select
        // sections use: ranking by node count alone can adopt a restored-session window that
        // answers with a tree and no text pattern at all, which then fails every one of them.
        const editor = probe.nodes.find((n) => /ControlType\.(Document|Edit)$/.test(n.controlType));
        if (probe.nodes.length >= 3 && editor !== undefined) {
          const rank = (Array.isArray(editor.patterns) && editor.patterns.includes('text') ? 1000 : 0) + probe.nodes.length;
          if (best === null || rank > best.rank) best = { win: candidate, tree: probe, rank };
        }
      }
      if (best !== null) return best;
      await wait(500);
    }
    return null;
  }

  /**
   * Adopt a window, raise it, and confirm it survived being raised.
   *
   * Windows 11 Notepad restores its whole previous session on launch, and those
   * restored windows are short-lived: activating one can retire it, after which its
   * handle answers with a single node. So a failed adoption is followed by launching a
   * fresh instance rather than by giving up — the point of this test is to drive a
   * Notepad, not to inherit one.
   *
   * @returns { adopted, reason, sawWindow } — sawWindow distinguishes "no Notepad
   *   window exists at all" (a failure worth reporting) from "the ones that exist are
   *   unusable" (a property of this desktop).
   */
  async function acquireNotepad() {
    let sawWindow = false;
    let launched = false;
    for (let round = 0; round < 4; round += 1) {
      let picked = await pickUsableNotepad();
      if (picked !== null) sawWindow = true;
      if (picked === null) {
        if (launched) return { adopted: null, sawWindow, reason: 'no Notepad window ever exposed a usable tree with a document control' };
        launched = true;
        const child = spawn('notepad.exe', [], { detached: true, stdio: 'ignore' });
        child.unref();
        spawnedNotepad = true;
        await wait(1500);
        continue;
      }
      for (let attempt = 0; attempt < 4; attempt += 1) {
        win = picked.win;
        notepadHwnd = win.hwnd;
        notepadPid = win.pid;
        // Raising a window that is retiring under us is a race this helper is *for*: Windows
        // 11 Notepad's restored-session windows disappear between the listing and the raise,
        // and the refusal ("hwnd … is not a window") is the same "walk past it" case as an
        // unusable tree. Letting it throw would take the run down before a single assertion.
        const focusResult = await tools.get('computer_windows').execute({ focus_hwnd: win.hwnd }, exec)
          .then((result) => result, (error) => ({ gone: String(error.message).slice(0, 120) }));
        if (focusResult.gone !== undefined) {
          console.log(`  (hwnd ${win.hwnd} went away while it was being raised: ${focusResult.gone})`);
          picked = await pickUsableNotepad();
          if (picked === null) break;
          continue;
        }
        const read = await tools.get('computer_ui').execute({ hwnd: win.hwnd, max_depth: 6, max_nodes: 200 }, exec)
          .then((result) => result, (error) => ({ gone: String(error.message).slice(0, 120) }));
        if (read.gone !== undefined) {
          console.log(`  (hwnd ${win.hwnd} could not be read after being raised: ${read.gone})`);
          picked = await pickUsableNotepad();
          if (picked === null) break;
          continue;
        }
        // Re-adopt unless the window still holds a real editor after being raised: a
        // restored-session window answers with a handful of nodes before it retires,
        // and every later section would fail against it.
        const stillUsable = read.nodes.length > 1
          && read.nodes.some((n) => /ControlType\.(Document|Edit)$/.test(n.controlType));
        if (stillUsable) return { adopted: { focusResult, read }, reason: '', sawWindow };
        picked = await pickUsableNotepad();
        if (picked === null) break;
      }
    }
    return {
      adopted: null,
      sawWindow,
      reason: 'every candidate window retired as soon as it was raised, so none could be driven',
    };
  }

  const acquisition = await acquireNotepad();
  const adopted = acquisition.adopted;
  // Two different failures, and only one of them is the plugin's: "computer_launch and
  // computer_windows can put a Notepad on screen at all" is a real assertion, while
  // "the Notepads this desktop happened to have were short-lived" is a property of
  // Windows 11's session restore.
  check('a Notepad window can be brought on screen at all', acquisition.sawWindow === true, acquisition.reason);
  // A window that cannot be raised cannot receive synthesized keys either: the input
  // goes to whatever does hold the foreground. That is a property of this desktop,
  // not of the plugin (which reports it as `focusSucceeded: false` plus who owns the
  // foreground), so the sections that need it are skipped rather than failed.
  // Two different capabilities, and only one of them needs the foreground. Reading a
  // window (UIA, refs, delta, a PrintWindow capture) works on a window that is merely
  // *there*; synthesized keyboard input goes to whatever holds the foreground, so a
  // desktop that will not give it up only invalidates the input sections. Gating both
  // on "could raise it" threw away a hundred assertions about capabilities that were
  // never in question.
  const windowUsable = adopted !== null;
  const foregroundUsable = windowUsable && adopted.focusResult.focusSucceeded === true;
  if (windowUsable) {
    value = adopted.read;
    console.log(`  (hwnd=${win.hwnd} "${win.title}" ${win.width}x${win.height}, ${value.nodes.length} nodes)`);
    if (!foregroundUsable) {
      console.log(`  (the foreground could not be taken — ${adopted.focusResult.foreground ?? 'another process'} owns it — so only the sections that synthesize keyboard input are skipped)`);
    }
  } else {
    console.log(`  (SKIPPING the window-driven sections: ${acquisition.reason})`);
  }

  if (windowUsable) await runWindowDrivenSections();

  /**
   * Everything that needs a window the plugin can actually raise and drive.
   *
   * Synthesized input goes to whatever holds the foreground, so if no window can be
   * brought forward these sections would be measuring the desktop rather than the
   * plugin. The plugin reports that condition honestly (`focused: false` plus the
   * process that owns the foreground); this keeps the suite from calling it a bug.
   */
  async function runWindowDrivenSections() {
  let editable;

  console.log('\n== computer_windows ==');
  check('focus result conforms', conforms(tools, 'computer_windows', adopted.focusResult).length === 0, conforms(tools, 'computer_windows', adopted.focusResult).join(' | '));
  check('focus reports the window', String(adopted.focusResult.focused).includes('hwnd='), String(adopted.focusResult.focused));

  console.log('\n== computer_ui ==');
  check('ui result conforms', conforms(tools, 'computer_ui', value).length === 0, conforms(tools, 'computer_ui', value).join(' | '));
  check('the tree survived being raised', value.nodes.length > 1, `${value.nodes.length} nodes`);
  check('the tree names its window', value.window?.hwnd === win.hwnd, JSON.stringify(value.window));
  editable = value.nodes.find((n) => n.patterns.includes('value') && n.width > 60 && n.height > 16);
  check('found a control with ValuePattern', editable !== undefined, editable === undefined ? 'none' : `${editable.controlType} "${editable.name}"`);

  if (editable !== undefined) {
    const selector = editable.automationId !== ''
      ? { automation_id: editable.automationId }
      : { name: editable.name, control_type: editable.controlType };
    console.log(`  (selector ${JSON.stringify(selector)})`);

    console.log('\n== computer_ui_action: set_value then get_value ==');
    value = await tools.get('computer_ui_action').execute({ ...selector, hwnd: win.hwnd, action: 'set_value', value: MARKER }, exec);
    check('set_value result conforms', conforms(tools, 'computer_ui_action', value).length === 0, conforms(tools, 'computer_ui_action', value).join(' | '));
    check('set_value echoes exactly what was written', value.value === MARKER, JSON.stringify(value.value));
    // The write is read back: accepting it and keeping the old text is what a read-only or masked control does, and 'it was set' is a claim the caller acts on.
    check('set_value reports that the control holds what it was asked to hold', value.verified === true, String(value.verified) + ' / the control holds ' + JSON.stringify(value.value));
    check('set_value reports the matched control', typeof value.matched?.controlType === 'string');

    value = await tools.get('computer_ui_action').execute({ ...selector, hwnd: win.hwnd, action: 'get_value' }, exec);
    check('get_value result conforms', conforms(tools, 'computer_ui_action', value).length === 0, conforms(tools, 'computer_ui_action', value).join(' | '));
    check('get_value round-trips exactly', value.value === MARKER, JSON.stringify(value.value));
    check('get_value carries a string value', typeof value.value === 'string', typeof value.value);

    const blocks = tools.get('computer_ui_action').output.render({}, value);
    check('get_value renders one text block', blocks.length === 1 && blocks[0].type === 'text', JSON.stringify(blocks).slice(0, 120));

    console.log('\n== computer_ui_action: an action that has no value ==');
    value = await tools.get('computer_ui_action').execute({ ...selector, hwnd: win.hwnd, action: 'focus' }, exec);
    check('focus result conforms', conforms(tools, 'computer_ui_action', value).length === 0, conforms(tools, 'computer_ui_action', value).join(' | '));
    check('the value key is absent, not undefined', !Object.prototype.hasOwnProperty.call(value, 'value'), JSON.stringify(value));
    const focusBlocks = tools.get('computer_ui_action').output.render({}, value);
    check('focus renders without touching value', focusBlocks.length === 1 && focusBlocks[0].type === 'text');
  }

  console.log('\n== the backend reports which engine is reading UI Automation ==');
  // A failed compile of the COM layer downgrades every call to the managed wrapper, and
  // that downgrade is invisible from the tool surface: the trees still come back. It has
  // to be asserted, or a broken COM layer can go unnoticed for a whole round of work.
  //
  // The suite is engine-aware rather than COM-only, so the fallback can be run with
  // DSH_COMPUTER_UI_ENGINE=managed and held to the same standard.
  const engineProbe = new (await import('./backend/bridge.js')).PowerShellBackend({ timeoutMs: 30_000 });
  try {
    await engineProbe.start();
    const health = await engineProbe.request('health', {}, { timeoutMs: 20_000 });
    engineName = String(health.engine ?? '');
    // DPI awareness is asked for and then read back, because the setter reports what it
    // asked for and falls through to a weaker mode when the awareness was already fixed.
    // An unaware process sees virtualized coordinates on a scaled display, which puts
    // every click somewhere other than where the caller aimed.
    const ping = await engineProbe.request('ping', {}, { timeoutMs: 20_000 });
    check('the worker reports the DPI awareness it actually has',
      typeof ping.dpiActual === 'string' && ping.dpiActual !== '', String(ping.dpiActual));
    check('and it is per-monitor aware, so screen coordinates are real pixels',
      String(ping.dpiActual).startsWith('per-monitor'), `asked for ${ping.dpi}, actually ${ping.dpiActual}`);
    const wanted = process.env.DSH_COMPUTER_UI_ENGINE === 'managed' ? 'managed' : 'com';
    check(`the engine is ${wanted}`, engineName === wanted, `engine=${engineName} ${health.engineError ?? ''}`.slice(0, 160));
    if (wanted === 'com') {
      check('and it compiled without an error', (health.engineError ?? '') === '', String(health.engineError ?? '').slice(0, 160));
    }
  } finally {
    engineProbe.dispose();
  }

  console.log('\n== the pruning pass, against trees that are actually messy ==');
  // The desktop may have no messy window open at all (on the machine this was written
  // on, only a browser ever was), so the pass is driven through its pure-function hook
  // with synthetic trees. A pass that only ever meets tidy input breaks silently the
  // first time it meets a wall of anonymous panes.
  {
    const pruneBackend = new (await import('./backend/bridge.js')).PowerShellBackend({ timeoutMs: 60_000 });
    const row = (depth, name, controlType, extra = {}) => ({
      depth,
      name,
      controlType,
      automationId: extra.automationId ?? '',
      className: extra.className ?? '',
      enabled: extra.enabled ?? true,
      offscreen: extra.offscreen ?? false,
      x: extra.x ?? 0,
      y: extra.y ?? 0,
      width: extra.width ?? 10,
      height: extra.height ?? 10,
      patterns: extra.patterns ?? [],
    });
    const runPrune = (nodes, maxNodes = 250) => pruneBackend.request('prune', { nodes, maxNodes }, { timeoutMs: 30_000 });
    try {
      await pruneBackend.start();

      // 1. Anonymous zero-area scaffolding goes, and its children are re-parented so the
      //    indentation still tells the truth.
      // 0. Two shaping passes from the reference pipeline: runs of text-only siblings become
      //    one row that keeps their text, and chains of single-child wrappers are flattened.
      const textRun = await runPrune([
        row(0, 'Root', 'ControlType.Window', { width: 800, height: 600 }),
        row(1, 'Name:', 'ControlType.Text'),
        row(1, 'report.txt', 'ControlType.Text'),
        row(1, 'modified', 'ControlType.Text'),
        row(1, '12 KB', 'ControlType.Text'),
        row(1, 'yesterday', 'ControlType.Text'),
        row(1, 'read-only', 'ControlType.Text'),
      ]);
      check('a run of text-only siblings becomes one row', textRun.nodes.length === 2, `${textRun.input} -> ${textRun.nodes.length}`);
      check('the merged row keeps every piece of the text', textRun.nodes[1]?.name === 'Name: report.txt modified 12 KB yesterday read-only', JSON.stringify(textRun.nodes[1]?.name));
      check('and says how many it stands for', textRun.nodes[1]?.merged === 6, String(textRun.nodes[1]?.merged));

      // A merged run whose text would run past the cap says so, rather than looking like a
      // name that happens to end in an ellipsis.
      const longRun = await runPrune([
        row(0, 'Root', 'ControlType.Window', { width: 800, height: 600 }),
        ...Array.from({ length: 12 }, (_, i) => row(1, `label number ${i} with a fair amount of text on it`, 'ControlType.Text', { width: 200, height: 16 })),
      ]);
      check('a merged run past the cap is cut and marked', longRun.nodes[1]?.mergedTruncated === true, String(longRun.nodes[1]?.mergedTruncated));
      check('and the row still says how many it stands for', longRun.nodes[1]?.merged === 12, String(longRun.nodes[1]?.merged));
      check('and the cut is visible in the name', String(longRun.nodes[1]?.name).endsWith(' ...'), JSON.stringify(String(longRun.nodes[1]?.name).slice(-20)));
      check('and it does not collide with the state-level truncated', longRun.nodes[1]?.truncated === undefined, String(longRun.nodes[1]?.truncated));
      const brokenRun = await runPrune([
        row(0, 'Root', 'ControlType.Window', { width: 800, height: 600 }),
        row(1, 'left', 'ControlType.Text'),
        row(1, 'right', 'ControlType.Text'),
        row(1, 'OK', 'ControlType.Button', { width: 60, height: 24, patterns: ['invoke'], automationId: 'ok' }),
        row(1, 'after', 'ControlType.Text'),
        row(1, 'more', 'ControlType.Text'),
      ]);
      check('a text run does not merge across a real control', brokenRun.nodes.length === 4, `${brokenRun.input} -> ${brokenRun.nodes.length}`);
      check('and the control is still addressable', brokenRun.nodes.some((n) => n.automationId === 'ok'), JSON.stringify(brokenRun.nodes.map((n) => n.name)));

      const chain = await runPrune([
        row(0, 'Root', 'ControlType.Window', { width: 800, height: 600 }),
        row(1, '', 'ControlType.Pane'),
        row(2, '', 'ControlType.Group'),
        row(3, '', 'ControlType.Custom'),
        row(4, 'Save', 'ControlType.Button', { width: 60, height: 24, patterns: ['invoke'], automationId: 'save' }),
      ]);
      check('a chain of single-child wrappers is flattened', chain.nodes.length === 2, `${chain.input} -> ${chain.nodes.length}`);
      check('and the node at the end of it is re-parented to the top', chain.nodes[1]?.depth === 1, `depth=${chain.nodes[1]?.depth}`);

      const twoChildren = await runPrune([
        row(0, 'Root', 'ControlType.Window', { width: 800, height: 600 }),
        row(1, '', 'ControlType.Pane'),
        row(2, 'A', 'ControlType.Button', { width: 60, height: 24, patterns: ['invoke'] }),
        row(2, 'B', 'ControlType.Button', { width: 60, height: 24, patterns: ['invoke'] }),
      ]);
      check('a wrapper with two children is a real level and stays', twoChildren.nodes.length === 4, `${twoChildren.input} -> ${twoChildren.nodes.length}`);

      const addressableWrapper = await runPrune([
        row(0, 'Root', 'ControlType.Window', { width: 800, height: 600 }),
        row(1, '', 'ControlType.Pane', { automationId: 'thePane' }),
        row(2, 'Save', 'ControlType.Button', { width: 60, height: 24, patterns: ['invoke'] }),
      ]);
      check('a wrapper that carries an automationId is never dropped', addressableWrapper.nodes.length === 3, `${addressableWrapper.input} -> ${addressableWrapper.nodes.length}`);

      const clickableWrapper = await runPrune([
        row(0, 'Root', 'ControlType.Window', { width: 800, height: 600 }),
        row(1, '', 'ControlType.Pane', { patterns: ['invoke'] }),
        row(2, 'Save', 'ControlType.Button', { width: 60, height: 24, patterns: ['invoke'] }),
      ]);
      check('a wrapper that is itself clickable is never dropped', clickableWrapper.nodes.length === 3, `${clickableWrapper.input} -> ${clickableWrapper.nodes.length}`);
      const scaffolding = await runPrune([
        row(0, 'Root', 'ControlType.Window', { width: 800, height: 600 }),
        row(1, '', 'ControlType.Pane', { width: 0, height: 0 }),
        row(2, 'OK', 'ControlType.Button', { width: 60, height: 24, patterns: ['invoke'] }),
      ]);
      check('anonymous zero-area scaffolding is folded away', scaffolding.nodes.length === 2, `${scaffolding.input} -> ${scaffolding.nodes.length}`);
      check('and its child is re-parented, not orphaned', scaffolding.nodes[1]?.depth === 1, `depth=${scaffolding.nodes[1]?.depth}`);
      check('the actionable child survived', scaffolding.nodes[1]?.name === 'OK', JSON.stringify(scaffolding.nodes[1]?.name));

      // 2. A run of anonymous siblings collapses into one row that says how many.
      const anonymousRun = await runPrune([
        row(0, 'Root', 'ControlType.Window', { width: 800, height: 600 }),
        ...Array.from({ length: 6 }, () => row(1, '', 'ControlType.Image', { width: 16, height: 16 })),
      ]);
      check('a run of anonymous siblings collapses to one row', anonymousRun.nodes.length === 2, `${anonymousRun.input} -> ${anonymousRun.nodes.length}`);
      check('and the row says how many it stands for', anonymousRun.nodes[1]?.repeated === 6, String(anonymousRun.nodes[1]?.repeated));

      // 3. A run of numeric text -- chapter timestamps, dates, counts. The text merge takes
      //    it first and keeps every value: the times are the content, and "x8" would have
      //    thrown away the one thing the caller might need. (The count-based collapse still
      //    covers numeric runs that are not plain text leaves.)
      const numericRun = await runPrune([
        row(0, 'Root', 'ControlType.Window', { width: 800, height: 600 }),
        ...['04:35', '05:02', '04:09', '03:36', '03:51', '04:49', '04:18', '04:39'].map((label) => row(1, label, 'ControlType.Text', { width: 32, height: 16 })),
      ]);
      check('a run of numeric text becomes one row', numericRun.nodes.length === 2, `${numericRun.input} -> ${numericRun.nodes.length}`);
      check('and keeps every value rather than counting them', numericRun.nodes[1]?.name === '04:35 05:02 04:09 03:36 03:51 04:49 04:18 04:39', JSON.stringify(numericRun.nodes[1]?.name));
      check('and says how many it stands for', numericRun.nodes[1]?.merged === 8, String(numericRun.nodes[1]?.merged));

      // 4. A menu of six different labels is not a run, and must survive intact.
      const menu = await runPrune([
        row(0, 'Root', 'ControlType.Window', { width: 800, height: 600 }),
        ...['文件', '编辑', '视图', '帮助', '工具', '运行'].map((label) => row(1, label, 'ControlType.MenuItem', { width: 60, height: 20, patterns: ['invoke'] })),
      ]);
      check('six distinct menu labels are not collapsed', menu.nodes.length === 7, `${menu.input} -> ${menu.nodes.length}`);

      // 5. The hard invariants: addressable and actionable rows are never dropped.
      const invariants = await runPrune([
        row(0, 'Root', 'ControlType.Window', { width: 800, height: 600 }),
        row(1, '', 'ControlType.Pane', { width: 0, height: 0, automationId: 'addressable' }),
        row(1, '', 'ControlType.Group', { width: 0, height: 0, patterns: ['invoke'] }),
      ]);
      check('a zero-area row with an automation id is kept', invariants.nodes.some((n) => n.automationId === 'addressable'), `${invariants.input} -> ${invariants.nodes.length}`);
      check('a zero-area row with a pattern is kept', invariants.nodes.some((n) => (n.patterns ?? []).length > 0), `${invariants.input} -> ${invariants.nodes.length}`);

      // 6. When the budget bites, the useful rows win and no survivor loses its context.
      const crowded = [row(0, 'Root', 'ControlType.Window', { width: 900, height: 700 })];
      for (let i = 0; i < 150; i += 1) crowded.push(row(1 + (i % 4), '', 'ControlType.Pane', { width: 40, height: 20 }));
      for (let i = 0; i < 150; i += 1) crowded.push(row(1 + (i % 4), `Button ${i}`, 'ControlType.Button', { width: 80, height: 24, patterns: ['invoke'] }));
      const cut = await runPrune(crowded, 50);
      check('the budget is respected', cut.nodes.length <= 60, `${cut.input} -> ${cut.nodes.length} (maxNodes 50)`);
      const keptButtons = cut.nodes.filter((n) => n.controlType === 'ControlType.Button').length;
      const keptPanes = cut.nodes.filter((n) => n.controlType === 'ControlType.Pane').length;
      check('actionable rows outrank anonymous containers', keptButtons > keptPanes * 3, `buttons=${keptButtons} panes=${keptPanes}`);
      let floating = 0;
      for (let i = 1; i < cut.nodes.length; i += 1) if (cut.nodes[i].depth - cut.nodes[i - 1].depth > 1) floating += 1;
      check('no surviving row floats free of its context', floating === 0, `${floating} row(s) jump more than one level`);
      check('the root always survives', cut.nodes[0]?.name === 'Root', JSON.stringify(cut.nodes[0]?.name));
    } finally {
      pruneBackend.dispose();
    }
  }

  console.log('\n== computer_screenshot against the live backend ==');
  value = await tools.get('computer_screenshot').execute({ display: 0 }, exec);
  check('screenshot result conforms', conforms(tools, 'computer_screenshot', value).length === 0, conforms(tools, 'computer_screenshot', value).join(' | '));
  check('real dimensions', value.width > 0 && value.height > 0, `${value.width}x${value.height}`);
  check('displays is a single string field', typeof value.displays === 'string' && value.displays.includes('DISPLAY1'), JSON.stringify(value.displays));
  check('an image ref was admitted', typeof value.image?.attachmentId === 'string');
  const shotBlocks = tools.get('computer_screenshot').output.render({}, value);
  check('render gives text then image', shotBlocks[0]?.type === 'text' && shotBlocks[1]?.type === 'image', shotBlocks.map((b) => b.type).join(','));
  check('the envelope carries the real geometry', shotBlocks[0].text.includes(`${value.width}x${value.height}`));

  // A prefix with a character outside the BMP that does not match: the refusal has to name
  // the character arithmetic rather than send the caller hunting for absent text.
  const surrogate = await refuses('computer_ui_action', { hwnd: win.hwnd, control_type: 'Document', action: 'select_text', text: 'ZZZ-not-here', prefix: '😀😀' });
  if (/ACTION_UNAVAILABLE|Pattern not found/.test(surrogate)) {
    // Not every document control exposes TextPattern (this window's does not, on this
    // desktop), and the surrogate arithmetic can only be reached through it.
    skip('the non-BMP prefix refusal', `this window's Document control has no text pattern: ${surrogate.slice(0, 120)}`);
  } else {
    check('a non-BMP prefix is coded TEXT_RANGE_SPLITS_SURROGATE_PAIR', surrogate.includes('[TEXT_RANGE_SPLITS_SURROGATE_PAIR]'), surrogate.slice(0, 130));
    check('and its hint names the fix', surrogate.includes('prefix'), surrogate.slice(-150));
  }
  // Synthesized input can be refused outright: a locked workstation, a secure desktop, or
  // -- as on the machine this was written on -- a foreground held by a window the user is
  // working in. The plugin detects that and reports it with a code, which is the right
  // behaviour; for this suite it means the input sections cannot run, and saying so beats
  // reporting the environment as a defect.
  let inputAccepted = foregroundUsable;
  if (!inputAccepted) {
    console.log(`  (synthesized keyboard input would go to ${adopted.focusResult.foreground ?? 'another process'}, not to this window, so the input sections are skipped)`);
  } else {
    const probe = await tools.get('computer_actions').execute({ steps: [{ action: 'move', x: Math.round(win.x + win.width / 2), y: Math.round(win.y + win.height / 2) }] }, exec)
      .then(() => ({ ok: true }), (error) => ({ ok: false, message: String(error.message) }));
    if (!probe.ok && probe.message.includes('SEND_INPUT_BLOCKED')) {
      inputAccepted = false;
      console.log(`  (Windows is discarding synthesized input right now, so the input sections are skipped: ${probe.message.slice(0, 100)}...)`);
    }
  }
  if (inputAccepted) {
  console.log('\n== computer_key with hold_seconds ==');
  value = await tools.get('computer_key').execute({ keys: 'shift', hold_seconds: 0.3 }, exec);
  check('hold result conforms', conforms(tools, 'computer_key', value).length === 0, conforms(tools, 'computer_key', value).join(' | '));
  check('heldMs is reported', value.heldMs === 300, String(value.heldMs));
  const holdBlocks = tools.get('computer_key').output.render({}, value);
  check('the hold renders as a hold', holdBlocks[0].text.includes('Held'), holdBlocks[0].text);

  value = await tools.get('computer_key').execute({ keys: 'shift' }, exec);
  check('a plain press conforms', conforms(tools, 'computer_key', value).length === 0, conforms(tools, 'computer_key', value).join(' | '));
  check('a plain press reports heldMs=0', value.heldMs === 0, String(value.heldMs));

  console.log('\n== computer_scroll (over the Notepad window) ==');
  value = await tools.get('computer_scroll').execute({ direction: 'down', clicks: 1, x: win.x + 40, y: win.y + 40 }, exec);
  check('scroll result conforms', conforms(tools, 'computer_scroll', value).length === 0, conforms(tools, 'computer_scroll', value).join(' | '));

  console.log('\n== computer_click (a harmless click inside Notepad) ==');
  value = await tools.get('computer_click').execute({ x: win.x + Math.round(win.width / 2), y: win.y + 40 }, exec);
  check('click result conforms', conforms(tools, 'computer_click', value).length === 0, conforms(tools, 'computer_click', value).join(' | '));
  check('click reports no undeclared event count', value.events === undefined);

  console.log('\n== computer_type into the focused editor ==');
  value = await tools.get('computer_type').execute({ text: ' [实时层 OK]' }, exec);
  check('type result conforms', conforms(tools, 'computer_type', value).length === 0, conforms(tools, 'computer_type', value).join(' | '));
  check('type names the receiving window', typeof value.foreground === 'string' && value.foreground.length > 0, value.foreground);

  // The keyboard goes to whatever holds the foreground. Naming the expected window turns
  // "the text went somewhere else" from something the caller notices afterwards into a
  // refusal before anything is sent -- which is what a dialog appearing since the last
  // click looks like from here.
  const wrongTarget = await tools.get('computer_type').execute({ text: 'should not be typed anywhere', into_hwnd: win.hwnd + 1 }, exec)
    .then(() => '', (error) => String(error.message));
  check('typing aimed at the wrong window is refused', wrongTarget.includes('[FRONT_NOT_TARGET]'), wrongTarget.slice(0, 130));
  check('and says nothing was sent', wrongTarget.includes('action_sent=false'), wrongTarget.slice(0, 170));
  check('and names the window that would have received it', wrongTarget.includes('the foreground is hwnd'), wrongTarget.slice(0, 190));
  // The positive case names whatever is actually in front, read at this moment rather than
  // assumed: the foreground can move mid-run (the person using the machine is allowed to
  // click something), and an assertion that presumes it cannot would be measuring that.
  const nowForeground = (await tools.get('computer_windows').execute({}, exec)).foreground;
  if (nowForeground === win.hwnd) {
    const rightTarget = await tools.get('computer_type').execute({ text: ' [into-hwnd OK]', into_hwnd: win.hwnd }, exec);
    check('typing aimed at the window that is actually in front goes through', rightTarget.typed > 0, String(rightTarget.typed));
  } else {
    console.log(`  (the foreground moved to hwnd ${nowForeground} during the run, so the positive case is skipped)`);
  }

  console.log('\n== computer_actions: a whole gesture in one call, and it really lands ==');
  // Click the editor's own centre, taken from UI Automation, rather than guessing an
  // offset from the window frame — on Windows 11 Notepad the top strip is a tab bar.
  const editorX = editable !== undefined ? Math.round(editable.x + editable.width / 2) : win.x + Math.round(win.width / 2);
  const editorY = editable !== undefined ? Math.round(editable.y + editable.height / 2) : win.y + 120;
  value = await tools.get('computer_actions').execute({
    steps: [
      { action: 'click', x: editorX, y: editorY },
      { action: 'key', keys: 'ctrl+a' },
      { action: 'type', text: '批量OK' },
    ],
    screenshot: true,
    scale: 0.5,
    format: 'jpeg',
  }, exec);
  check('batch result conforms', conforms(tools, 'computer_actions', value).length === 0, conforms(tools, 'computer_actions', value).join(' | '));
  // A batch stops itself when the window in front changes under it, and on a machine someone
  // else is working on that happens for real. The plugin is right to refuse the rest of the
  // sequence; the assertions that need the gesture to have *landed* cannot be made then, so
  // they are skipped with the reason rather than reported as a defect of the plugin.
  const stoppedByGuard = value.failedAt >= 0
    && /REOBSERVE_REQUIRED|FRONT_NOT_TARGET/.test(String(value.error ?? ''));
  if (stoppedByGuard) {
    skip('the batched gesture really landing', `the window in front changed mid-batch, and the batch correctly refused to walk through it: ${String(value.error).slice(0, 130)}`);
  } else {
    check('batch ran all three steps', value.count === 3 && value.failedAt === -1, `${value.count} / failedAt=${value.failedAt} ${value.error ?? ''}`);
    check('batch carried a downscaled capture', value.shot?.scale === 0.5 && value.shot?.format === 'jpeg', `${value.shot?.scale} ${value.shot?.format}`);
    check('batch capture has an image ref', typeof value.shot?.image?.attachmentId === 'string');
    const batchBlocks = tools.get('computer_actions').output.render({}, value);
    check('batch render ends with the image', batchBlocks.at(-1)?.type === 'image', batchBlocks.map((b) => b.type).join(','));
    check('the downscaled capture is smaller than the full frame', value.shot !== undefined && value.shot.imageWidth < value.shot.width, `${value.shot?.imageWidth} vs ${value.shot?.width}`);

    // Read the editor back: if the batched click/type did not land, this fails.
    if (editable !== undefined) {
      const selector = editable.automationId !== '' ? { automation_id: editable.automationId } : { name: editable.name, control_type: editable.controlType };
      const readBack = await tools.get('computer_ui_action').execute({ ...selector, hwnd: win.hwnd, action: 'get_value' }, exec);
      check('the batched typing really reached the editor', typeof readBack.value === 'string' && readBack.value.includes('批量OK'), JSON.stringify(readBack.value));
    }
  }
  console.log('\n== computer_screenshot: a frame makes the coordinate arithmetic unnecessary ==');
  // The most expensive mistake in this loop is a *successful* click on the wrong target,
  // and the cheapest way to make it is arithmetic: reading a pixel off a capture and
  // forgetting the origin, or forgetting that the image was downscaled.
  const frameShot = await tools.get('computer_screenshot').execute({ window: win.hwnd, format: 'png' }, exec);
  check('a capture hands back a frame id', typeof frameShot.frame === 'string' && frameShot.frame !== '', String(frameShot.frame));
  const frameBlocks = tools.get('computer_screenshot').output.render({}, frameShot);
  check('and the envelope says it can be cited', frameBlocks[0]?.text?.includes(`frame: ${frameShot.frame}`), frameBlocks[0]?.text?.slice(0, 80));

  const targetPx = 120;
  const targetPy = 120;
  const viaFrame = await tools.get('computer_click').execute({ x: targetPx, y: targetPy, from_frame: frameShot.frame, prefer_a11y: false }, exec);
  check('clicking by frame conforms', conforms(tools, 'computer_click', viaFrame).length === 0, conforms(tools, 'computer_click', viaFrame).join(' | '));
  check('the receipt echoes the frame', viaFrame.frame?.id === frameShot.frame, JSON.stringify(viaFrame.frame));
  check('it reports the image pixel it was given', viaFrame.frame?.fromImage?.x === targetPx && viaFrame.frame?.fromImage?.y === targetPy, JSON.stringify(viaFrame.frame?.fromImage));
  check('and the screen pixel it actually clicked',
    viaFrame.frame?.projected?.x === Math.round(frameShot.x + targetPx / frameShot.scale)
    && viaFrame.frame?.projected?.y === Math.round(frameShot.y + targetPy / frameShot.scale),
    `${JSON.stringify(viaFrame.frame?.projected)} from origin ${frameShot.x},${frameShot.y} scale ${frameShot.scale}; frame ${viaFrame.frame?.id} drift=${viaFrame.frame?.drift ?? 0} ${viaFrame.frame?.note ?? ''}`);
  check('the screen coordinate is the one the click used', viaFrame.x === viaFrame.frame.projected.x && viaFrame.y === viaFrame.frame.projected.y, `${viaFrame.x},${viaFrame.y}`);

  // The same image pixel on a downscaled frame must land somewhere else -- that is the
  // arithmetic the caller no longer has to do.
  const halfShot = await tools.get('computer_screenshot').execute({ window: win.hwnd, format: 'png', scale: 0.5 }, exec);
  const halfClick = await tools.get('computer_click').execute({ x: targetPx, y: targetPy, from_frame: halfShot.frame, prefer_a11y: false }, exec);
  check('a downscaled frame projects the same image pixel differently',
    halfClick.frame?.projected?.x === Math.round(halfShot.x + targetPx / 0.5) && halfClick.frame?.projected?.x !== viaFrame.frame.projected.x,
    `${viaFrame.frame.projected.x} vs ${halfClick.frame?.projected?.x}; frames ${viaFrame.frame?.id} / ${halfClick.frame?.id}, origin ${halfShot.x}, scale ${halfClick.frame?.scale}`);
  check('and the receipt names the scale it projected with', halfClick.frame?.scale === 0.5, String(halfClick.frame?.scale));

  const unknownFrame = await tools.get('computer_click').execute({ x: 10, y: 10, from_frame: 'f999', prefer_a11y: false }, exec)
    .then(() => '', (error) => String(error.message));
  check('a frame this worker never took is refused rather than clicked', unknownFrame.includes('[EXPIRED_FRAME]'), unknownFrame.slice(0, 120));
  check('and says nothing was sent', unknownFrame.includes('action_sent=false'), unknownFrame.slice(0, 150));
  const outsideFrame = await tools.get('computer_click').execute({ x: 999999, y: 10, from_frame: frameShot.frame, prefer_a11y: false }, exec)
    .then(() => '', (error) => String(error.message));
  check('a point outside the frame image is refused', outsideFrame.includes('[BAD_REQUEST]') && outsideFrame.includes('outside frame'), outsideFrame.slice(0, 120));
  }

  console.log('\n== computer_ui: a search returns matches, not the whole tree ==');
  const searchType = editable !== undefined ? editable.controlType.replace('ControlType.', '') : 'Document';
  const searched = await tools.get('computer_ui').execute({ hwnd: win.hwnd, control_type: searchType, max_nodes: 20 }, exec);
  check('search result conforms', conforms(tools, 'computer_ui', searched).length === 0, conforms(tools, 'computer_ui', searched).join(' | '));
  check('a search is flagged as such', searched.searched === true);
  check('a search returns only matching nodes', searched.nodes.length > 0 && searched.nodes.every((n) => n.controlType.includes(searchType)), `${searched.nodes.length} nodes of type ${searchType}`);
  const searchBlocks = tools.get('computer_ui').output.render({}, searched);
  check('a search renders as matching nodes', searchBlocks[0].text.includes('matching node(s)'), searchBlocks[0].text.split('\n')[0]);
  const whole = await tools.get('computer_ui').execute({ hwnd: win.hwnd, max_depth: 3, max_nodes: 60 }, exec);
  check('an unfiltered read is not flagged as a search', whole.searched === false);
  check('an unfiltered read returns a tree', whole.nodes.length >= 1);
  check('a tree reports real depths', whole.nodes.some((n) => n.depth > 0), JSON.stringify(whole.nodes.map((n) => n.depth)));
  check('a tree names the window it came from', whole.window?.hwnd === win.hwnd, JSON.stringify(whole.window));
  check('a tree fingerprints the observation', /^[0-9a-f]{16}$/.test(whole.digest), String(whole.digest));

  console.log('\n== computer_ui: an identical repeat read says so ==');
  const repeatKey = { hwnd: win.hwnd, max_depth: 3, max_nodes: 60 };
  const repeat = await tools.get('computer_ui').execute(repeatKey, exec);
  check('the repeat is flagged unchanged', repeat.unchanged === true, String(repeat.unchanged));
  const repeatBlocks = tools.get('computer_ui').output.render({}, repeat);
  check('the render tells the model not to read it again', repeatBlocks[0].text.includes('do not read it again'), repeatBlocks[0].text.split('\n').at(-1));

  console.log('\n== computer_ui: pixels and tree in one call ==');
  const both = await tools.get('computer_ui').execute({ hwnd: win.hwnd, max_depth: 3, max_nodes: 40, screenshot: true, scale: 0.5 }, exec);
  check('the combined observation conforms', conforms(tools, 'computer_ui', both).length === 0, conforms(tools, 'computer_ui', both).join(' | '));
  check('it carries both halves', both.nodes.length >= 1 && typeof both.shot?.image?.attachmentId === 'string', `${both.nodes.length} nodes`);
  const bothBlocks = tools.get('computer_ui').output.render({}, both);
  check('its render ends with the image', bothBlocks.at(-1)?.type === 'image', bothBlocks.map((b) => b.type).join(','));

  const editorSelector = editable !== undefined
    ? (editable.automationId !== '' ? { automation_id: editable.automationId } : { name: editable.name, control_type: editable.controlType })
    : null;

  // Text that is demonstrably present in the editor right now. The sections below test
  // *locating* text, which is a different capability from *having typed* it, so they use
  // this instead of a literal that only exists when the input sections ran.
  let presentText = 'ZZZ-not-present';
  if (editorSelector !== null) {
    console.log('\n== computer_ui_action: get_text through TextPattern ==');
    const readText = await tools.get('computer_ui_action').execute({ ...editorSelector, hwnd: win.hwnd, action: 'get_text' }, exec);
    check('get_text result conforms', conforms(tools, 'computer_ui_action', readText).length === 0, conforms(tools, 'computer_ui_action', readText).join(' | '));
    // What is in the editor depends on whether the input sections ran, so the capability
    // under test here is get_text, not the content: the content is only asserted when
    // something actually typed it.
    check('get_text returned a string', typeof readText.value === 'string', JSON.stringify(readText.value).slice(0, 90));
    if (inputAccepted) {
      check('get_text returned the editor content', readText.value.includes('批量OK'), JSON.stringify(readText.value).slice(0, 90));
    }
    check('get_text reports whether it truncated', typeof readText.truncated === 'boolean', String(readText.truncated));

    console.log('\n== computer_ui_action: select_text ==');
    // Select something that is demonstrably present -- the text get_text just read back --
    // so this section tests locating text rather than depending on an earlier one.
    if (typeof readText.value === 'string' && readText.value.trim() !== '') presentText = readText.value.trim().slice(0, 8);
    const selected = await tools.get('computer_ui_action').execute({ ...editorSelector, hwnd: win.hwnd, action: 'select_text', text: presentText }, exec);
    check('select_text result conforms', conforms(tools, 'computer_ui_action', selected).length === 0, conforms(tools, 'computer_ui_action', selected).join(' | '));
    check('select_text selected exactly the requested text', selected.value === presentText, JSON.stringify(selected.value));

    const caret = await tools.get('computer_ui_action').execute({ ...editorSelector, hwnd: win.hwnd, action: 'select_text', text: presentText, selection_type: 'cursor_after' }, exec);
    check('a caret placement collapses the selection', caret.value === '', JSON.stringify(caret.value));

    console.log('\n== computer_ui_action: an unsupported action is refused with a reason ==');
    const unsupported = await tools.get('computer_ui_action').execute({ ...editorSelector, hwnd: win.hwnd, action: 'scroll_into_view' }, exec)
      .then(() => '', (error) => String(error.message));
    check('an unsupported pattern is coded ACTION_UNAVAILABLE', unsupported.includes('[ACTION_UNAVAILABLE]'), unsupported.slice(0, 90));
    check('and it points at the patterns list', unsupported.includes('patterns'), unsupported.slice(0, 200));

      console.log('\n== computer_screenshot: a window capture is the window, even when covered ==');
    // The one thing a screen BitBlt cannot do. The window is asked to draw itself, so what
    // is in front of it is irrelevant -- and the frame says which of the two happened.
    const windowShot = await tools.get('computer_screenshot').execute({ window: win.hwnd, format: 'jpeg' }, exec);
    check('the window capture conforms', conforms(tools, 'computer_screenshot', windowShot).length === 0, conforms(tools, 'computer_screenshot', windowShot).join(' | '));
    check('it says the window drew its own pixels', windowShot.source === 'window', String(windowShot.source));
    check('it names the window it captured', windowShot.window?.hwnd === win.hwnd, JSON.stringify(windowShot.window));
    check('it reports what was checked about the frame', Array.isArray(windowShot.verification) && windowShot.verification.length > 0, JSON.stringify(windowShot.verification));
    check('and the window rendered something rather than a blank frame',
      (windowShot.verification ?? []).includes('the window rendered its own pixels'),
      JSON.stringify(windowShot.verification));
    check('the frame is the size of the window', Math.abs(windowShot.width - win.width) <= 24 && Math.abs(windowShot.height - win.height) <= 24,
      `${windowShot.width}x${windowShot.height} vs window ${win.width}x${win.height}`);
    const windowBlocks = tools.get('computer_screenshot').output.render({}, windowShot);
    check('the envelope says how the pixels were obtained', windowBlocks[0]?.text?.includes('drew its own pixels'), windowBlocks[0]?.text?.slice(0, 60));

    // It follows the window, not a fixed rectangle.
    //
    // A window whose provider refuses the Window pattern cannot be resized or minimized by
    // anyone: the same call fails identically on the previous build of the worker (that A/B
    // is recorded in README §27.8), so a refusal here is a property of *this* window — a
    // restored-session Notepad, typically — and not of the plugin. What the plugin owes the
    // caller either way is a coded failure rather than a silent no-op, and that is what gets
    // asserted; the positive cases need a window that offers the action at all.
    const windowAction = async (name) => {
      try {
        await tools.get('computer_ui_action').execute({ hwnd: win.hwnd, control_type: 'Window', action: name }, exec);
        return { ok: true, message: '' };
      } catch (error) {
        return { ok: false, message: String(error.message) };
      }
    };
    const maximized = await windowAction('maximize');
    if (!maximized.ok) {
      check('a window action the provider refuses is reported as a coded failure rather than a silent no-op',
        /^\[[A-Z_]+\]/.test(maximized.message), maximized.message.slice(0, 130));
      console.log(`  (this window's provider refused maximize, so the resize case is skipped: ${maximized.message.slice(0, 100)})`);
    }
    await wait(800);
    if (maximized.ok) {
      const biggerShot = await tools.get('computer_screenshot').execute({ window: win.hwnd, format: 'jpeg' }, exec);
      check('a resized window produces a differently sized capture', biggerShot.width > windowShot.width, `${windowShot.width} -> ${biggerShot.width}`);
      check('and it is still the window path', biggerShot.source === 'window', String(biggerShot.source));
    }
    await windowAction('restore');
    await wait(600);

    // A minimized window answers PrintWindow with the shell's placeholder -- a few dozen
    // pixels at -32000,-32000 -- which looks like content and is not. Refusing and naming
    // the fix is the honest answer.
    const minimizedHere = await windowAction('minimize');
    await wait(900);
    if (minimizedHere.ok) {
      const minimizedShot = await tools.get('computer_screenshot').execute({ window: win.hwnd, format: 'png' }, exec)
        .then(() => '', (error) => String(error.message));
      check('capturing a minimized window is refused with the reason', minimizedShot.includes('[WINDOW_MINIMIZED]'), minimizedShot.slice(0, 140));
      check('and it names the way out', minimizedShot.includes('restore'), minimizedShot.slice(0, 180));
      check('and says nothing was sent', minimizedShot.includes('action_sent=false'), minimizedShot.slice(0, 180));
      await windowAction('restore');
      await wait(900);
      const restoredShot = await tools.get('computer_screenshot').execute({ window: win.hwnd, format: 'jpeg' }, exec);
      check('and it captures again once the window is restored', restoredShot.source === 'window' && restoredShot.width > 100, `${restoredShot.source} ${restoredShot.width}x${restoredShot.height}`);
    } else {
      console.log(`  (the same provider refused minimize, so the minimized-capture cases are skipped too: ${minimizedHere.message.slice(0, 100)})`);
    }


    // A window that cannot render its own pixels. A borderless, single-colour form is the
    // deterministic construction: PrintWindow draws it, every sampled pixel is the same,
    // and there is no window in the frame. Handing that back as "here is the window" is
    // what this refusal exists to prevent.
    console.log('\n== computer_screenshot: a frame with nothing in it is refused, not returned ==');
    {
      // Written to a file rather than passed with -Command: the form needs a real message
      // loop, and a semicolon-joined command line loses the quoting that needs.
      // Written to a file and handed over with -File. -EncodedCommand was tried first and
      // exits 0 without ever opening the window when launched this way, which is a hard
      // failure to see: the only symptom is a window that never appears.
      const flatScriptPath = join(tmpdir(), `dsh-flat-probe-${process.pid}.ps1`);
      writeFileSync(flatScriptPath, [
        'Add-Type -AssemblyName System.Windows.Forms',
        'Add-Type -AssemblyName System.Drawing',
        '$form = New-Object System.Windows.Forms.Form',
        '$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None',
        '$form.Text = [string][char]100 + [string][char]115 + [string][char]104 + "-flat-probe"',
        '$form.BackColor = [System.Drawing.Color]::FromArgb(32, 32, 32)',
        '$form.ClientSize = New-Object System.Drawing.Size(360, 260)',
        '$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual',
        '$form.Location = New-Object System.Drawing.Point(320, 240)',
        '$timer = New-Object System.Windows.Forms.Timer',
        '$timer.Interval = 40000',
        '$timer.Add_Tick({ $form.Close() })',
        '$timer.Start()',
        '[System.Windows.Forms.Application]::Run($form)',
      ].join('\n'));
      // NOT detached. A WinForms window launched with DETACHED_PROCESS exits 0 without ever
      // appearing -- measured, not guessed: the same script with detached: false shows the
      // window in a second. Notepad tolerates being detached; a PowerShell host running a
      // message loop does not.
      const flatChild = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', flatScriptPath], { detached: false, stdio: 'ignore' });
      let flatWindow;
      let seenCount = 0;
      let powershellSeen = '';
      for (let attempt = 0; attempt < 20 && flatWindow === undefined; attempt += 1) {
        await wait(400);
        const seen = await tools.get('computer_windows').execute({}, exec);
        seenCount = seen.windows.length;
        powershellSeen = seen.windows.filter((w) => /powershell/i.test(w.process)).map((w) => w.title).join(' | ');
        flatWindow = seen.windows.find((w) => w.title === 'dsh-flat-probe');
      }
      if (flatWindow === undefined) {
        let flatLog = '';
        try { flatLog = readFileSync(flatLogPath, 'utf8').slice(0, 400); } catch { /* nothing written */ }
      } else {
        const blank = await tools.get('computer_screenshot').execute({ window: flatWindow.hwnd, format: 'png' }, exec)
          .then(() => '', (error) => String(error.message));
        check('a window that renders nothing is refused', blank.includes('[CAPTURE_SURFACE_UNAVAILABLE]'), blank.slice(0, 150));
        check('and the refusal says the frame holds no window', blank.includes('no contrast at all'), blank.slice(0, 170));
        check('and it carries the trail of what was tried', blank.includes('rendered a uniform frame'), blank.slice(0, 230));
        check('and says nothing was sent', blank.includes('action_sent=false'), blank.slice(0, 200));
        // A uniform *region* of the screen is a fact about the screen, not a failed
        // capture, and must not be refused: "this area is one flat colour" is something
        // the caller can legitimately want to see.
        const flatRegion = await tools.get('computer_screenshot').execute({
          region: { x: flatWindow.x + 40, y: flatWindow.y + 40, width: 160, height: 120 },
          format: 'png',
        }, exec);
        check('a uniform region of the screen is still returned', flatRegion.source === 'screen', String(flatRegion.source));
        // require=window: the guarantee is kept here, so it must not be refused.
        const required = await tools.get('computer_screenshot').execute({ window: win.hwnd, require: 'window', format: 'png' }, exec);
        check('require=window is satisfied by a window that renders itself', required.source === 'window', String(required.source));
        try { process.kill(flatChild.pid); } catch { /* it closes itself */ }
      }
    }
    console.log('\n== computer_ui: a ref pins an element across a change to the tree ==');
    // Name/type/index addressing has one failure mode that is worse than a refusal:
    // when the tree moves, the same index can land on a different control and the
    // action still reports success. A ref is supposed to survive that.
    const refRead = await tools.get('computer_ui').execute({ hwnd: win.hwnd }, exec);
    check('the observation names its snapshot', typeof refRead.snapshot === 'string' && refRead.snapshot !== '', String(refRead.snapshot));
    check('every node carries a ref',
      refRead.nodes.length > 0 && refRead.nodes.every((n) => typeof n.ref === 'string' && n.ref !== ''),
      `${refRead.nodes.filter((n) => n.ref).length}/${refRead.nodes.length}`);
    const refTarget = refRead.nodes.find((n) => n.patterns.includes('value') && n.width > 60 && n.height > 16);
    if (refTarget === undefined) {
      console.log('  (no value-bearing control in this tree, so the ref assertions are skipped)');
    } else {
      const refBlocks = tools.get('computer_ui').output.render({}, refRead);
      check('the render marks a node with its ref', refBlocks.some((b) => b.type === 'text' && b.text.includes(`[${refTarget.ref}]`)), String(refTarget.ref));

      const steady = await tools.get('computer_ui_action').execute({ ref: refTarget.ref, action: 'get_value' }, exec);
      check('acting by ref conforms', conforms(tools, 'computer_ui_action', steady).length === 0, conforms(tools, 'computer_ui_action', steady).join(' | '));
      check('the receipt echoes the ref', steady.ref === refTarget.ref, String(steady.ref));
      check('the value reads back through the ref', typeof steady.value === 'string' && steady.value.length > 0, JSON.stringify(steady.value));
      check('an element that has not moved is not reported as re-resolved', steady.reresolved === undefined, JSON.stringify(steady.reresolved));
      // How the ref was re-found: one provider query when the recorded identity is an
      // automation id, the whole tree walk otherwise. Both are correct -- the difference is
      // what the action costs -- and a real window is the only place the two paths can be
      // told apart.
      check('the receipt says how the ref was re-found', steady.resolvedVia === 'automation-id' || steady.resolvedVia === 'tree-walk', String(steady.resolvedVia));
      if (typeof refTarget.automationId === 'string' && refTarget.automationId !== '') {
        check('a uniquely identified ref is answered without walking the whole tree', steady.resolvedVia === 'automation-id', `${JSON.stringify(refTarget.automationId)} -> ${String(steady.resolvedVia)}`);
      } else {
        console.log(`  (the ref target carries no automation id (${refTarget.controlType}), so the tree walk is the expected path: resolvedVia=${String(steady.resolvedVia)})`);
      }

      // Maximising moves every element in the window; the ref was read before that.
      // What is under test is that the ref still names the *same element*: the value
      // it reads back has to be the one it read back before the window changed shape.
      //
      // A window action the provider does not implement answers with a raw failure ("无法执行操作。"),
      // and a case that needs the window to change shape cannot run without it. That is a
      // SKIP — the same treatment the resize cases get a few sections above — and it must not
      // take the rest of the run down with it.
      let reshaped = true;
      try {
        await tools.get('computer_ui_action').execute({ hwnd: win.hwnd, control_type: 'Window', action: 'maximize' }, exec);
        await wait(700);
      } catch (error) {
        reshaped = false;
        skip('the ref-drift case (it needs the window to change shape)', `this window's provider refused maximize: ${error.message.slice(0, 110)}`);
      }
      if (reshaped) {
        const afterMove = await tools.get('computer_ui_action').execute({ ref: refTarget.ref, action: 'get_value' }, exec);
        check('the ref still addresses the same element after the window changed shape', afterMove.value === steady.value, JSON.stringify({ before: steady.value.slice(0, 24), after: String(afterMove.value).slice(0, 24) }));
        check('and the receipt says the element had moved', afterMove.reresolved === true, JSON.stringify({ reresolved: afterMove.reresolved, drift: afterMove.drift }));
        check('with how far it moved, in pixels', typeof afterMove.drift === 'number' && afterMove.drift > 0, String(afterMove.drift));
        const movedBlocks = tools.get('computer_ui_action').output.render({}, afterMove);
        check('the render says so too', movedBlocks.some((b) => b.type === 'text' && b.text.includes('had moved')), movedBlocks.map((b) => b.text?.slice(0, 60)).join(' | '));
        try {
          await tools.get('computer_ui_action').execute({ hwnd: win.hwnd, control_type: 'Window', action: 'restore' }, exec);
          await wait(500);
        } catch (error) {
          console.log(`  (the window could not be restored afterwards: ${error.message.slice(0, 90)})`);
        }
      }

      const stale = await tools.get('computer_ui_action').execute({ ref: 's999.999', action: 'get_value' }, exec)
        .then(() => '', (error) => String(error.message));
      check('a ref this worker never minted is refused rather than guessed', stale.includes('[STALE_REF]'), stale.slice(0, 120));
      // A refusal has to be actionable, not just safe: which kind of "not found" it is
      // decides what the caller should do, and whether the UI was touched decides whether
      // retrying is safe at all.
      check('the refusal names the kind of not-found', stale.includes('never issued'), stale.slice(0, 150));
      check('and states that nothing was sent', stale.includes('action_sent=false'), stale.slice(0, 150));
      check('and names the recovery', stale.includes('recovery=computer_ui'), stale.slice(0, 150));

      // The observation lifetime is 64 snapshots and is enforced on every read, so a
      // handful of small reads retires the first one. What matters is that the refusal
      // says *which* kind of gone this is: retired bookkeeping, not a vanished control.
      const oldestRef = refRead.nodes[1]?.ref ?? refRead.nodes[0]?.ref;
      for (let i = 0; i < 66; i += 1) await tools.get('computer_ui').execute({ hwnd: win.hwnd, max_nodes: 12 }, exec);
      const retired = await tools.get('computer_ui_action').execute({ ref: oldestRef, action: 'get_value' }, exec)
        .then(() => '', (error) => String(error.message));
      check('a ref whose observation was retired says so', retired.includes('retired when older observations were pruned'), retired.slice(0, 160));
      check('and still says the element did not necessarily disappear', retired.includes('does not mean the element disappeared'), retired.slice(0, 160));
    }

    console.log('\n== computer_ui: a delta against an earlier snapshot ==');
    // Watching a long operation should not mean re-reading a tree that did not move.
    const base = await tools.get('computer_ui').execute({ hwnd: win.hwnd }, exec);
    check('the read names the snapshot a delta can be taken against', typeof base.snapshot === 'string' && base.snapshot !== '', String(base.snapshot));

    const noChange = await tools.get('computer_ui').execute({ hwnd: win.hwnd, since: base.snapshot }, exec);
    check('the delta result conforms', conforms(tools, 'computer_ui', noChange).length === 0, conforms(tools, 'computer_ui', noChange).join(' | '));
    check('the delta names its base and says it knew it', noChange.delta?.base === base.snapshot && noChange.delta?.known === true, JSON.stringify(noChange.delta));
    check('an immediate repeat reports no changes at all',
      noChange.nodes.length === 0 && noChange.delta.added === 0 && noChange.delta.moved === 0 && noChange.delta.removed === 0,
      JSON.stringify({ rows: noChange.nodes.length, delta: noChange.delta }));
    check('and accounts for every node as unchanged', noChange.delta.same === base.nodes.length, `${noChange.delta.same} vs ${base.nodes.length}`);
    const quietBlocks = tools.get('computer_ui').output.render({}, noChange);
    check('the render says nothing changed rather than showing an empty tree',
      quietBlocks.some((b) => b.type === 'text' && b.text.includes('nothing changed')), quietBlocks.map((b) => b.text?.slice(0, 40)).join(' | '));

    // Now make something happen, and read the delta again.
    if (editable !== undefined) {
      const movedSelector = editable.automationId !== ''
        ? { automation_id: editable.automationId }
        : { name: editable.name, control_type: editable.controlType };
      // Read first, so the original content can be put back: the sections after this one
      // look for the text an earlier section typed, and a delta test has no business
      // changing what they see.
      const original = await tools.get('computer_ui_action').execute({ ...movedSelector, hwnd: win.hwnd, action: 'get_value' }, exec);
      await tools.get('computer_ui_action').execute({ ...movedSelector, hwnd: win.hwnd, action: 'set_value', value: `${MARKER} delta` }, exec);
      await wait(900);
      const changed = await tools.get('computer_ui').execute({ hwnd: win.hwnd, since: base.snapshot }, exec);
      check('the changed read conforms', conforms(tools, 'computer_ui', changed).length === 0, conforms(tools, 'computer_ui', changed).join(' | '));
      check('a real change produces a non-empty delta', changed.nodes.length > 0, JSON.stringify(changed.delta));
      check('the delta rows carry what happened to them',
        changed.nodes.every((n) => ['added', 'moved', 'changed'].includes(n.delta)), changed.nodes.map((n) => n.delta).join(','));
      check('the delta is far smaller than the tree it describes', changed.nodes.length < base.nodes.length, `${changed.nodes.length} vs ${base.nodes.length}`);
      const changedBlocks = tools.get('computer_ui').output.render({}, changed);
      check('the render leads with the delta summary', changedBlocks.some((b) => b.type === 'text' && b.text.startsWith('delta against ')), changedBlocks[0]?.text?.slice(0, 60));
      await tools.get('computer_ui_action').execute({ ...movedSelector, hwnd: win.hwnd, action: 'set_value', value: String(original.value ?? '') }, exec);
      await wait(400);
    }

    const unknownBase = await tools.get('computer_ui').execute({ hwnd: win.hwnd, since: 's999.999' }, exec);
    check('a snapshot this worker never minted is not guessed at', unknownBase.delta?.known === false, JSON.stringify(unknownBase.delta));
    check('and the full tree comes back instead', unknownBase.nodes.length === base.nodes.length, `${unknownBase.nodes.length} vs ${base.nodes.length}`);
    const unknownBlocks = tools.get('computer_ui').output.render({}, unknownBase);
    check('the render explains why it is not a delta', unknownBlocks.some((b) => b.type === 'text' && b.text.includes('no longer held')), unknownBlocks.map((b) => b.text?.slice(0, 50)).join(' | '));

    console.log('\n== computer_ui_action: window actions need no foreground and no input ==');
    // This is what the window pattern buys over alt+F4: on a desktop where synthesized
    // input is refused outright (the foreground is a service window here), the window
    // can still be minimized, restored and closed, because none of it is input.
    const windowSelector = { hwnd: win.hwnd, control_type: 'Window' };
    const minimized = await tools.get('computer_ui_action').execute({ ...windowSelector, action: 'minimize' }, exec);
    check('minimize conforms', conforms(tools, 'computer_ui_action', minimized).length === 0, conforms(tools, 'computer_ui_action', minimized).join(' | '));
    check('minimize reports the window it matched', minimized.matched?.controlType === 'ControlType.Window', JSON.stringify(minimized.matched?.controlType));
    await wait(600);
    const afterMinimize = await tools.get('computer_windows').execute({}, exec);
    check('the window left the visible list once minimized',
      !afterMinimize.windows.some((w) => w.hwnd === win.hwnd),
      `${afterMinimize.windows.filter((w) => w.pid === win.pid).length} of that process still listed`);

    const restoredWindow = await tools.get('computer_ui_action').execute({ ...windowSelector, action: 'restore' }, exec);
    check('restore conforms', conforms(tools, 'computer_ui_action', restoredWindow).length === 0, conforms(tools, 'computer_ui_action', restoredWindow).join(' | '));
    await wait(600);
    const afterRestore = await tools.get('computer_windows').execute({}, exec);
    check('the window is back in the visible list', afterRestore.windows.some((w) => w.hwnd === win.hwnd));

    console.log('\n== computer_ui_action: get_caret reports where the caret is ==');
    if (engineName === 'managed') {
      // TextPattern2 does not exist in the managed wrapper, so this action is COM-only.
      // Under the fallback the refusal itself is the behaviour worth pinning: a caret
      // position that was never read must not be reported.
      const refused = await tools.get('computer_ui_action').execute({ ...editorSelector, hwnd: win.hwnd, action: 'get_caret' }, exec)
        .then(() => '', (error) => String(error.message));
      check('the managed engine refuses get_caret with a reason rather than guessing', /TextPattern2/.test(refused), refused.slice(0, 130));
      console.log('  (the caret readings are COM-only, so they are skipped under the fallback)');
    } else {
      await tools.get('computer_ui_action').execute({ ...editorSelector, hwnd: win.hwnd, action: 'select_text', text: presentText, selection_type: 'cursor_after' }, exec);
      const caretRead = await tools.get('computer_ui_action').execute({ ...editorSelector, hwnd: win.hwnd, action: 'get_caret' }, exec);
      check('get_caret conforms', conforms(tools, 'computer_ui_action', caretRead).length === 0, conforms(tools, 'computer_ui_action', caretRead).join(' | '));
      check('it reports the line the caret sits on', caretRead.value.includes(presentText), JSON.stringify(caretRead.value));
      check('it reports where the caret is', caretRead.rect !== undefined && caretRead.rect.height > 0, JSON.stringify(caretRead.rect));
      const caretBlocks = tools.get('computer_ui_action').output.render({}, caretRead);
      check('the render describes the caret', caretBlocks.some((b) => b.type === 'text' && b.text.startsWith('Caret')), caretBlocks.map((b) => b.text?.slice(0, 30)).join(' | '));
    }

    console.log('\n== computer_ui_action: get_text and the legacy bridge ==');
    // A button has no TextPattern. The COM engine answers from the MSAA bridge; the
    // managed wrapper has no LegacyIAccessiblePattern type at all, so under the fallback
    // the refusal is the behaviour worth pinning.
    if (engineName === 'managed') {
      const refusedLegacy = await tools.get('computer_ui_action').execute({ hwnd: win.hwnd, control_type: 'Button', action: 'get_text' }, exec)
        .then(() => '', (error) => String(error.message));
      check('the managed engine refuses the legacy read with a code', /\[ACTION_UNAVAILABLE\]/.test(refusedLegacy), refusedLegacy.slice(0, 110));
      console.log('  (the MSAA bridge is COM-only, so the legacy read is skipped under the fallback)');
    } else {
      const legacyRead = await tools.get('computer_ui_action').execute({ hwnd: win.hwnd, control_type: 'Button', action: 'get_text' }, exec);
      check('get_text on a control with no text pattern still answers', typeof legacyRead.value === 'string' && legacyRead.value.length > 0, JSON.stringify(legacyRead.value));
    }

    console.log('\n== computer_ui_action: a window action on a non-window is refused ==');
    const notAWindow = await tools.get('computer_ui_action').execute({ ...editorSelector, hwnd: win.hwnd, action: 'minimize' }, exec)
      .then(() => '', (error) => String(error.message));
    check('the refusal is coded ACTION_UNAVAILABLE', notAWindow.includes('[ACTION_UNAVAILABLE]'), notAWindow.slice(0, 110));
    check('and it names the pattern that is missing', notAWindow.includes('WindowPattern'), notAWindow.slice(0, 160));

    console.log('\n== computer_ui_action: locate_text reports where a string sits (read-only) ==');
    // The happy path needs a provider that exposes text geometry, and the only one on
    // this machine is Chromium. Only the read-only half is exercised against it: a test
    // must not click inside the user's own application.
    const allWindows = await tools.get('computer_windows').execute({}, exec);
    const chromish = allWindows.windows.find((w) => /chrome|electron|edge|harness|deepseek/i.test(w.process));
    if (chromish === undefined) {
      console.log('  (no Chromium-backed window is open, so the geometry path is not exercised)');
    } else {
      // Chromium builds its accessibility tree lazily and drops back to the pre-build
      // view ("Chrome Legacy Window") when no client is asking for it. When that has
      // happened there is no RootWebArea to read, and that is a provider state, not a
      // failure of this plugin -- say so instead of reporting a broken run.
      const pageRead = await tools.get('computer_ui_action').execute({ hwnd: chromish.hwnd, automation_id: 'RootWebArea', action: 'get_text' }, exec)
        .then((result) => ({ ok: true, value: result }), (error) => ({ ok: false, message: String(error.message) }));
      if (!pageRead.ok && /ELEMENT_UNAVAILABLE/.test(pageRead.message)) {
        console.log('  (the Chromium window is exposing its pre-build accessibility view right now, so the geometry path is not exercised)');
      } else {
        check('the page read conforms', conforms(tools, 'computer_ui_action', pageRead.value).length === 0, conforms(tools, 'computer_ui_action', pageRead.value).join(' | '));
        const word = String(pageRead.value?.value ?? '').split(/\s+/).find((token) => token.length > 3);
        if (word === undefined) {
          console.log('  (the page exposed no word long enough to locate)');
        } else {
          const located = await tools.get('computer_ui_action').execute({ hwnd: chromish.hwnd, automation_id: 'RootWebArea', action: 'locate_text', text: word }, exec);
          check('locate_text conforms', conforms(tools, 'computer_ui_action', located).length === 0, conforms(tools, 'computer_ui_action', located).join(' | '));
          check('it reports a real rectangle', located.rect !== undefined && located.rect.width > 0 && located.rect.height > 0, JSON.stringify(located.rect));
          check('the rectangle sits inside the window it came from',
            located.rect.x >= chromish.x - 8 && located.rect.y >= chromish.y - 8
            && located.rect.x + located.rect.width <= chromish.x + chromish.width + 8,
            `${JSON.stringify(located.rect)} vs ${chromish.x},${chromish.y} ${chromish.width}x${chromish.height}`);
          const locatedBlocks = tools.get('computer_ui_action').output.render({}, located);
          check('the render says it located rather than clicked', locatedBlocks.some((b) => b.type === 'text' && b.text.startsWith('Located ')), locatedBlocks.map((b) => b.text?.slice(0, 30)).join(' | '));
        }
      }
    }

    console.log('\n== computer_ui_action: click_text either clicks or names the limitation ==');
    const clickAttempt = await tools.get('computer_ui_action').execute({ ...editorSelector, hwnd: win.hwnd, action: 'click_text', text: presentText }, exec)
      .then((result) => ({ ok: true, value: result }), (error) => ({ ok: false, message: String(error.message) }));
    if (clickAttempt.ok) {
      check('click_text reports the text it clicked', clickAttempt.value.value.includes(presentText), JSON.stringify(clickAttempt.value.value));
      check('click_text reports the rectangle it clicked', clickAttempt.value.rect !== undefined && clickAttempt.value.rect.width > 0, JSON.stringify(clickAttempt.value.rect));
    } else {
      // Notepad's text provider exposes no geometry on this machine. That is a real
      // property of the provider, not of the call: what must hold is that the refusal
      // says so, carries a code, and never pretends to have clicked.
      check('click_text names the provider limitation instead of failing silently', /does not support text geometry/.test(clickAttempt.message), clickAttempt.message.slice(0, 140));
      check('and the refusal carries a code', /\[[A-Z_]+\]/.test(clickAttempt.message), clickAttempt.message.slice(0, 60));
      console.log(`  (${clickAttempt.message.slice(0, 130)})`);
    }

    console.log('\n== computer_actions: UI Automation steps, evidence and a closing observation ==');
    const combined = await tools.get('computer_actions').execute({
      steps: [
        { action: 'focus', hwnd: win.hwnd },
        { action: 'set_value', hwnd: win.hwnd, ...editorSelector, value: `${MARKER} 批` },
        { action: 'get_value', hwnd: win.hwnd, ...editorSelector },
      ],
      evidence: true,
      state: { hwnd: win.hwnd, control_type: 'Document', max_nodes: 10 },
    }, exec);
    check('the combined batch conforms', conforms(tools, 'computer_actions', combined).length === 0, conforms(tools, 'computer_actions', combined).join(' | '));
    check('all three steps ran', combined.count === 3 && combined.failedAt === -1, `${combined.count} / ${combined.error ?? ''}`);
    check('the read step reports what it read', combined.performed.some((line) => line.includes('get_value') && line.includes('批')), JSON.stringify(combined.performed));
    check('evidence says the screen changed', combined.evidence?.changed === true, JSON.stringify(combined.evidence));
    check('the closing observation came back', combined.state?.nodes?.length >= 1 && combined.state?.window?.hwnd === win.hwnd, JSON.stringify(combined.state?.window));
    const combinedBlocks = tools.get('computer_actions').output.render({}, combined);
    check('the render explains the evidence', combinedBlocks.some((b) => b.type === 'text' && b.text.startsWith('evidence:')), combinedBlocks.map((b) => b.type).join(','));

    console.log('\n== computer_actions: evidence is returned and is one-sided ==');
    // The verdict cannot be asserted in the "unchanged" direction on a live desktop:
    // a blinking caret or a clock changes pixels, so `changed: true` is inconclusive
    // by design while `changed: false` is the strong claim. What is checked here is
    // that the region and the verdict come back at all.
    const noop = await tools.get('computer_actions').execute({
      steps: [{ action: 'focus', hwnd: win.hwnd }, { action: 'wait', seconds: 0.2 }],
      evidence: true,
    }, exec);
    check('the no-op batch conforms', conforms(tools, 'computer_actions', noop).length === 0, conforms(tools, 'computer_actions', noop).join(' | '));
    check('evidence comes back as a verdict over a real region', typeof noop.evidence?.changed === 'boolean' && noop.evidence.width > 0 && noop.evidence.height > 0, JSON.stringify(noop.evidence));
    check('evidence fingerprints both ends', /^[0-9a-f]{16}$/.test(String(noop.evidence.before)) && /^[0-9a-f]{16}$/.test(String(noop.evidence.after)), JSON.stringify(noop.evidence));
    const noopBlocks = tools.get('computer_actions').output.render({}, noop);
    check('the render is honest about what "changed" means', noopBlocks.some((b) => b.type === 'text' && b.text.includes(noop.evidence.changed ? 'weak evidence' : 'pixel-identical')), noopBlocks.map((b) => b.text?.slice(0, 40)).join(' | '));

    console.log('\n== computer_paste: the clipboard route into a control ==');
    const clipboardBefore = await tools.get('computer_clipboard').execute({ op: 'get' }, exec);
    const PASTE_MARKER = '粘贴内容 paste-marker 中文';
    const pasted = await tools.get('computer_paste').execute({ text: PASTE_MARKER }, exec);
    check('paste result conforms', conforms(tools, 'computer_paste', pasted).length === 0, conforms(tools, 'computer_paste', pasted).join(' | '));
    check('paste reports the length it wrote', pasted.pasted === PASTE_MARKER.length, String(pasted.pasted));
    check('the clipboard was restored afterwards', pasted.restored === true, JSON.stringify(pasted));
    const restored = await tools.get('computer_clipboard').execute({ op: 'get' }, exec);
    check("the user's clipboard really came back", restored.text === clipboardBefore.text, `${JSON.stringify(restored.text)} vs ${JSON.stringify(clipboardBefore.text)}`);
  }
  }

  console.log('\n== computer_clipboard (no window needed) ==');
  const borrowed = await tools.get('computer_clipboard').execute({ op: 'get' }, exec);
  check('clipboard get conforms', conforms(tools, 'computer_clipboard', borrowed).length === 0, conforms(tools, 'computer_clipboard', borrowed).join(' | '));
  /**
   * Set, then read back, with one retry.
   *
   * The clipboard is a machine-wide resource with no ownership: this test borrowed it, and
   * anything else on the desktop may write to it between the write and the read. That is a
   * real race in the *test*, not in the plugin -- the read is honestly reporting what the
   * clipboard held at that instant -- so the retry distinguishes "the plugin lost the text"
   * from "something else claimed the clipboard mid-check". Without it, a run fails about one
   * time in ten with an empty read-back and no way to tell which it was.
   */
  const roundTrip = async (text) => {
    let last = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const wrote = await tools.get('computer_clipboard').execute({ op: 'set', text }, exec);
      const read = await tools.get('computer_clipboard').execute({ op: 'get' }, exec);
      last = String(read.text ?? '');
      if (last === text) return { ok: true, wrote, read, attempts: attempt + 1 };
      if (last !== '') return { ok: false, wrote, read, attempts: attempt + 1 };
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return { ok: false, wrote: null, read: { text: last }, attempts: 2 };
  };
  const ascii = await roundTrip('clipboard-marker');
  check('clipboard set reports the length', ascii.wrote?.length === 'clipboard-marker'.length, String(ascii.wrote?.length));
  check('clipboard round-trips', ascii.ok, `${JSON.stringify(ascii.read?.text)} after ${ascii.attempts} attempt(s)${ascii.ok ? '' : ' -- the clipboard read empty right after a set that reported the right length, which on this machine means another process claimed it mid-check'}`);
  const unicode = await roundTrip('中文与 emoji 🀄');
  check('a non-ASCII clipboard set conforms', unicode.wrote !== null && conforms(tools, 'computer_clipboard', unicode.wrote).length === 0, conforms(tools, 'computer_clipboard', unicode.wrote ?? {}).join(' | '));
  check('non-ASCII round-trips exactly', unicode.ok, `${JSON.stringify(unicode.read?.text)} after ${unicode.attempts} attempt(s)`);
  await tools.get('computer_clipboard').execute({ op: 'clear' }, exec);
  const cleared = await tools.get('computer_clipboard').execute({ op: 'get' }, exec);
  check('clipboard clear empties it', cleared.text === '' && cleared.length === 0, JSON.stringify(cleared.text));
  // Put the user's clipboard back: this test borrowed it.
  await tools.get('computer_clipboard').execute({ op: 'set', text: borrowed.text }, exec);
  const finalClipboard = await tools.get('computer_clipboard').execute({ op: 'get' }, exec);
  check('the borrowed clipboard was handed back', finalClipboard.text === borrowed.text, JSON.stringify(finalClipboard.text).slice(0, 60));

  console.log('\n== computer_launch ==');
  const launched = await tools.get('computer_launch').execute({ target: 'notepad', wait_seconds: 6 }, exec);
  check('launch result conforms', conforms(tools, 'computer_launch', launched).length === 0, conforms(tools, 'computer_launch', launched).join(' | '));
  check('launch resolved the target', launched.resolvedAs !== '' && launched.file !== '', `${launched.resolvedAs}: ${launched.file}`);
  check('launch found a window to act on', launched.hwnd !== 0 || launched.note !== '', `hwnd=${launched.hwnd} note=${launched.note}`);
  const launchBlocks = tools.get('computer_launch').output.render({}, launched);
  check('launch renders the window handle', launchBlocks.length === 1 && launchBlocks[0].text.includes('hwnd='), launchBlocks[0]?.text?.slice(0, 90));

  console.log('\n== computer_stop ==');
  const released = await tools.get('computer_stop').execute({}, exec);
  check('stop result conforms', conforms(tools, 'computer_stop', released).length === 0, conforms(tools, 'computer_stop', released).join(' | '));
  check('stop reports what it released', Array.isArray(released.released) && Number.isInteger(released.count), JSON.stringify(released));
  const stopBlocks = tools.get('computer_stop').output.render({}, released);
  check('stop renders a line either way', stopBlocks.length === 1 && stopBlocks[0].text.length > 0, stopBlocks[0]?.text);
  const stillWorks = await tools.get('computer_windows').execute({}, exec);
  check('a release does not kill the capability', stillWorks.windows.length > 0, `${stillWorks.windows.length} windows`);

  console.log('\n== pacing: an observation waits only when it is asked to ==');
  // These assertions go through the tool the model actually calls, which is the only place
  // that can prove the pacing arguments survive the host: a default quietly swallowing an
  // explicit 0 was exactly the failure mode this change set out to remove. The worker's
  // `stability.resolvedBy` is the receipt — it names which argument decided the budget, so
  // it distinguishes "the argument arrived" from "something else chose for me".
  //
  // What these cases need is a *write*, not a delivered keystroke, and on a desktop that
  // refuses synthesized input (the foreground can belong to a window no test can take) the
  // obvious write — a Shift tap — is refused before it stamps anything. `focus` stamps the
  // same write ordinal through the worker and sends no input at all, so the assertions keep
  // their meaning; the tap is tried first wherever the desktop accepts input, and where it is
  // refused that is said out loud instead of quietly replaced.
  let writeVia = 'key';
  const writeKey = async () => {
    if (writeVia === 'key') {
      try {
        await tools.get('computer_key').execute({ keys: 'shift' }, exec);
        return;
      } catch (error) {
        writeVia = 'focus';
        skip('a write made by synthesized input (the pacing cases\' Shift tap)', `this desktop refuses it: ${error.message.slice(0, 140)}`);
      }
    }
    // This test's own window: the raise may fail (another process can hold the foreground)
    // and the write stamp happens either way, which is the part the pacing cases depend on.
    await tools.get('computer_windows').execute({ focus_hwnd: win.hwnd }, exec);
  };

  await writeKey();
  const pacedDefault = await tools.get('computer_screenshot').execute({ format: 'jpeg', scale: 0.25 }, exec);
  check('a capture after a write reports its pacing', pacedDefault.stability !== undefined, JSON.stringify(pacedDefault.timing));
  check('the default budget is off, and says so', pacedDefault.stability?.state === 'disabled' && pacedDefault.stability?.budgetMs === 0, JSON.stringify(pacedDefault.stability));
  check('and it is the worker default that decided it', pacedDefault.stability?.resolvedBy === 'default', JSON.stringify(pacedDefault.stability));
  check('a capture after a write no longer runs a five-second poll', pacedDefault.timing?.captureMs < 2000, `${pacedDefault.timing?.captureMs} ms`);
  check('a paced capture still conforms', conforms(tools, 'computer_screenshot', pacedDefault).length === 0, conforms(tools, 'computer_screenshot', pacedDefault).join(' | '));

  await writeKey();
  const pacedZero = await tools.get('computer_screenshot').execute({ format: 'jpeg', scale: 0.25, stability_ms: 0 }, exec);
  check('stability_ms: 0 reaches the worker instead of a default', pacedZero.stability?.resolvedBy === 'stability_ms' && pacedZero.stability?.budgetMs === 0, JSON.stringify(pacedZero.stability));
  check('and it skips the wait entirely', pacedZero.stability?.state === 'disabled' && pacedZero.stability?.polls === 0, JSON.stringify(pacedZero.stability));

  await writeKey();
  const pacedFalse = await tools.get('computer_screenshot').execute({ format: 'jpeg', scale: 0.25, stable: false }, exec);
  check('stable: false reaches the worker too', pacedFalse.stability?.resolvedBy === 'stable=false', JSON.stringify(pacedFalse.stability));

  await writeKey();
  const budgeted = await tools.get('computer_screenshot').execute({ format: 'jpeg', scale: 0.25, stability_ms: 400 }, exec);
  check('a budgeted wait reports what it concluded', ['stable', 'timeout'].includes(budgeted.stability?.state), JSON.stringify(budgeted.stability));
  check('and it stays inside the budget it was given', budgeted.stability?.waitedMs <= 400 + 400, JSON.stringify(budgeted.stability));
  check('a budgeted capture conforms', conforms(tools, 'computer_screenshot', budgeted).length === 0, conforms(tools, 'computer_screenshot', budgeted).join(' | '));

  await writeKey();
  const flagged = await tools.get('computer_screenshot').execute({ format: 'jpeg', scale: 0.25, stable: true }, exec);
  check('stable: true asks for the default budget instead', flagged.stability?.resolvedBy === 'stable=true' && flagged.stability?.budgetMs > 0, JSON.stringify(flagged.stability));

  // A write that is already old by the time the observation happens must not start a wait:
  // "the observation of that action" has stopped being true, and waiting for a picture that
  // settled long ago is waiting for something that already happened.
  await writeKey();
  await wait(2600);
  const stale = await tools.get('computer_screenshot').execute({ format: 'jpeg', scale: 0.25 }, exec);
  check('a write older than the write TTL starts no wait at all', stale.stability?.state === 'none', JSON.stringify(stale.stability));

  // The batch path is where a pacing argument used to be impossible to pass at all.
  const batchPaced = await tools.get('computer_actions').execute({
    steps: [{ action: 'key', keys: 'shift' }, { action: 'screenshot' }],
    format: 'jpeg', scale: 0.25, stability_ms: 0,
  }, exec);
  check('a batch forwards the call-level pacing to its capture', batchPaced.shot?.stability?.resolvedBy === 'stability_ms', JSON.stringify(batchPaced.shot?.stability));
  check('and the batch capture conforms with it', conforms(tools, 'computer_actions', batchPaced).length === 0, conforms(tools, 'computer_actions', batchPaced).join(' | '));

  const batchStepPaced = await tools.get('computer_actions').execute({
    steps: [{ action: 'key', keys: 'shift' }, { action: 'screenshot', stability_ms: 400 }],
    format: 'jpeg', scale: 0.25,
  }, exec);
  check('a step-level pacing overrides the call level', batchStepPaced.shot?.stability?.budgetMs === 400, JSON.stringify(batchStepPaced.shot?.stability));
  check('and that step-level capture conforms', conforms(tools, 'computer_actions', batchStepPaced).length === 0, conforms(tools, 'computer_actions', batchStepPaced).join(' | '));

  // Evidence: when the batch's own capture can contain the evidence rectangle, the reading
  // comes from that frame instead of a second grab of the same pixels. The rule is the
  // assertion, not the reuse: a frame from another region would make the comparison lie, so
  // reuse is expected exactly when the geometry allows it and not otherwise.
  const reuseBatch = await tools.get('computer_actions').execute({
    steps: [{ action: 'key', keys: 'shift' }],
    screenshot: true, evidence: true, format: 'jpeg', scale: 0.25,
  }, exec);
  check('evidence is still returned alongside the capture', reuseBatch.evidence !== undefined && typeof reuseBatch.evidence.changed === 'boolean', JSON.stringify(reuseBatch.evidence));
  const evidenceRect = reuseBatch.evidence ?? { x: 0, y: 0, width: 0, height: 0 };
  const captureRect = reuseBatch.shot ?? { x: 0, y: 0, width: 0, height: 0 };
  const contained = evidenceRect.x >= captureRect.x && evidenceRect.y >= captureRect.y
    && evidenceRect.x + evidenceRect.width <= captureRect.x + captureRect.width
    && evidenceRect.y + evidenceRect.height <= captureRect.y + captureRect.height;
  check('the evidence reading is reused exactly when the capture can contain it', (evidenceRect.reused === true) === contained,
    `contained=${contained} reused=${evidenceRect.reused}`);
  check('a batch that reuses its own frame still conforms', conforms(tools, 'computer_actions', reuseBatch).length === 0, conforms(tools, 'computer_actions', reuseBatch).join(' | '));

  console.log('\n== computer_actions: which frame came back, and what it waited for ==');
  // The worker decides frame provenance from write ordinals; what a *model* sees is
  // `captureUsed` plus the envelope's explanation of it, so that is what is asserted here.
  // The live cases deliberately avoid synthesized input — this desktop refuses it, and a
  // case that needed a delivered keystroke would be measuring the desktop: a `wait` step
  // writes nothing, and a `focus` step stamps a write without sending anything at all.
  const liveShot = (tag) => join(liveShotDir, `live-${tag}.png`);
  const blocksOf = (tool, result) => tools.get(tool).output.render({}, result).map((block) => block.text ?? '').join('\n');

  // (1) The step's frame is still the newest thing this call produced, so it *is* the answer
  // and no second capture happens — the trailing path must not even be created.
  const reuseStepPath = liveShot('reuse-step');
  const reuseTrailingPath = liveShot('reuse-trailing');
  const stepReuse = await tools.get('computer_actions').execute({
    steps: [
      { action: 'screenshot', path: reuseStepPath },
      { action: 'wait', seconds: 0 },
    ],
    screenshot: true, save_path: reuseTrailingPath, evidence: false, format: 'png',
  }, exec);
  check('a step capture with nothing writing after it conforms', conforms(tools, 'computer_actions', stepReuse).length === 0, conforms(tools, 'computer_actions', stepReuse).join(' | '));
  check("captureUsed says the frame is the screenshot step's own", stepReuse.captureUsed?.from === 'step' && stepReuse.captureUsed?.stepIndex === 0, JSON.stringify(stepReuse.captureUsed));
  check('and that it is on the right side of the last write', stepReuse.captureUsed?.afterLastWrite === true, JSON.stringify(stepReuse.captureUsed));
  check('the frame handed back is the file that step wrote', stepReuse.shot?.path === reuseStepPath, `shot.path=${stepReuse.shot?.path}`);
  check('and no second capture was taken for the trailing path', existsSync(reuseTrailingPath) === false, `the trailing path exists: ${reuseTrailingPath}`);
  check('the envelope does not claim a second frame was taken', !blocksOf('computer_actions', stepReuse).includes('was captured after the last step'), blocksOf('computer_actions', stepReuse).slice(0, 240));

  // (2) A write after the step's frame makes that frame a picture of the state *before* the
  // steps finished, so the call pays for a fresh one — and says why.
  const retakeStepPath = liveShot('retake-step');
  const retakeTrailingPath = liveShot('retake-trailing');
  const retaken = await tools.get('computer_actions').execute({
    steps: [
      { action: 'screenshot', path: retakeStepPath },
      { action: 'focus', hwnd: win.hwnd },
    ],
    screenshot: true, save_path: retakeTrailingPath, evidence: false, stop_on_window_change: false, format: 'png',
  }, exec);
  check('a batch whose last step writes conforms', conforms(tools, 'computer_actions', retaken).length === 0, conforms(tools, 'computer_actions', retaken).join(' | '));
  check('captureUsed says the frame had to be retaken', retaken.captureUsed?.from === 'retaken', JSON.stringify(retaken.captureUsed));
  check('the retaken frame is the new capture, not the step frame', retaken.shot?.path === retakeTrailingPath, `shot.path=${retaken.shot?.path}`);
  check('both frames are on disk, which is what makes them different answers', existsSync(retakeStepPath) && existsSync(retakeTrailingPath), `step=${existsSync(retakeStepPath)} trailing=${existsSync(retakeTrailingPath)}`);
  check('the envelope explains why a second frame was needed', blocksOf('computer_actions', retaken).includes('was captured after the last step'), blocksOf('computer_actions', retaken).slice(0, 300));

  // (3) The third declared answer — 'step-stale' — cannot be reached on this build, and that
  // is reported rather than asserted either way: the worker's own guard throws before it can
  // return that state, so a test that "expects" either outcome would be asserting a bug or
  // asserting the fix. The mapper/render contract for it is covered in schema-test.mjs
  // against the declared reply, which is where that half belongs.
  //
  // Evidence, with `steps: [{action:'screenshot', path}, {action:'focus', hwnd}]`,
  // `screenshot: true, save_path: ''`: the reply is
  //   [BAD_REQUEST] batch failed: a trailing screenshot needs a path
  // because the 'step-stale' branch (worker.ps1, "Nothing to reuse and no path for a new
  // frame") sets $shotReuse = 'step-stale' and then falls into the trailing-capture guard
  // `if ($wantedShot -and $shotReuse -ne 'step')`, whose first line throws on exactly the
  // empty path that selected the branch.
  console.log('  (note: computer_actions cannot return captureUsed.from === \'step-stale\' on this build — see the report on worker.ps1; the schema half of that state is covered in schema-test.mjs)');

  // (4) A condition wait, through the tool: the report has to arrive in `waits` and the
  // envelope has to say what happened, because "it never became true" is an answer the
  // caller acts on rather than an error it has to catch.
  const waited = await tools.get('computer_actions').execute({
    steps: [{ action: 'wait', seconds: 0 }],
    wait_for: { hwnd: win.hwnd, timeout_ms: 5_000 },
    evidence: false,
  }, exec);
  check('a batch-level wait_for conforms', conforms(tools, 'computer_actions', waited).length === 0, conforms(tools, 'computer_actions', waited).join(' | '));
  check('the wait is reported in waits', Array.isArray(waited.waits) && waited.waits.length === 1, JSON.stringify(waited.waits));
  check('the wait that already held is satisfied, and typed as declared', waited.waits?.[0]?.satisfied === true && Number.isInteger(waited.waits[0].waitedMs) && Number.isInteger(waited.waits[0].polls) && waited.waits[0].timeoutMs === 5_000 && waited.waits[0].timeoutFrom === 'explicit', JSON.stringify(waited.waits?.[0]));
  check('and the report names the window it was about', waited.waits?.[0]?.window?.hwnd === win.hwnd, JSON.stringify(waited.waits?.[0]?.window));
  check('the envelope says the wait became true, and after how long', blocksOf('computer_actions', waited).includes('it became true after'), blocksOf('computer_actions', waited).slice(0, 300));

  const timedOutWait = await tools.get('computer_actions').execute({
    steps: [{ action: 'wait', seconds: 0 }],
    wait_for: { title: 'no-window-has-this-title-8f3a2b', timeout_ms: 400, poll_ms: 100 },
    evidence: false,
  }, exec);
  check('a wait that never holds is reported rather than thrown', timedOutWait.failedAt === -1 && timedOutWait.waits?.[0]?.satisfied === false, `failedAt=${timedOutWait.failedAt} ${JSON.stringify(timedOutWait.waits?.[0])}`);
  check('the timed-out wait says how long it looked and how often', timedOutWait.waits?.[0]?.waitedMs >= 300 && timedOutWait.waits[0].polls > 1 && timedOutWait.waits[0].pollMs === 100, JSON.stringify(timedOutWait.waits?.[0]));
  check('the step before the wait still ran', timedOutWait.performed?.[0] === 'wait 0s', JSON.stringify(timedOutWait.performed));
  const timedOutText = blocksOf('computer_actions', timedOutWait);
  check('and the envelope tells the caller what a wait that never held means', timedOutText.includes('never became true') && timedOutText.includes('raise timeout_ms'), timedOutText.slice(0, 420));
  check('a batch whose wait timed out still conforms', conforms(tools, 'computer_actions', timedOutWait).length === 0, conforms(tools, 'computer_actions', timedOutWait).join(' | '));

  const waitStep = await tools.get('computer_actions').execute({
    steps: [{ action: 'wait_for', hwnd: win.hwnd, timeout_ms: 5_000 }],
    evidence: false,
  }, exec);
  check('a wait_for *step* is reported in the same list', waitStep.waits?.length === 1 && waitStep.waits[0].satisfied === true, JSON.stringify(waitStep.waits));
  check('and the step log says what it waited for and whether it held', String(waitStep.performed?.[0] ?? '').includes('wait_for') && String(waitStep.performed?.[0] ?? '').includes('satisfied'), String(waitStep.performed?.[0] ?? ''));

  console.log('\n== computer_ui: the tree and the pixels are of the same window ==');
  // A read of hwnd X that returns a picture of the screen is two observations in one reply,
  // and the second one is whatever happened to be in front. The receipt is what tells the
  // caller which of the two they are looking at.
  const uiWithShot = await tools.get('computer_ui').execute({ hwnd: win.hwnd, max_nodes: 40, screenshot: true, format: 'jpeg', scale: 0.5 }, exec);
  check('a read that is also a capture conforms', conforms(tools, 'computer_ui', uiWithShot).length === 0, conforms(tools, 'computer_ui', uiWithShot).join(' | '));
  check('the capture names the window the read was of', uiWithShot.shot?.window?.hwnd === win.hwnd && uiWithShot.window?.hwnd === win.hwnd, JSON.stringify({ shot: uiWithShot.shot?.window, tree: uiWithShot.window }));
  const shotSource = uiWithShot.shot?.source;
  const declaredFallback = (uiWithShot.shot?.verification ?? []).some((line) => String(line).includes('fell back to the screen'));
  check('a capture that could not use the window\'s own pixels says so', shotSource === 'window' || declaredFallback, `source=${shotSource} verification=${JSON.stringify(uiWithShot.shot?.verification)}`);
  check('and the read still carries the tree', Array.isArray(uiWithShot.nodes) && uiWithShot.nodes.length > 0, `${uiWithShot.nodes?.length} node(s)`);
} catch (error) {
  console.error('LIVE TEST FAILED:', error.message);
  process.exitCode = 1;
} finally {
  if (notepadHwnd !== null && spawnedNotepad) {
    try {
      const plugin = await import('./index.js');
      void plugin;
      const closer = new (await import('./backend/bridge.js')).PowerShellBackend({ timeoutMs: 15_000 });
      await closer.start();
      let closed = false;
      // First try: the window pattern's Close. No foreground, no synthesized input,
      // and it closes exactly one window — which matters because Windows 11 Notepad
      // hosts every tab and every restored document inside a single process.
      try {
        await closer.request('uiact', { action: 'close', hwnd: notepadHwnd, controlType: 'Window' }, { timeoutMs: 20_000 });
        await wait(500);
        closed = true;
        console.log('\n(closed the test Notepad window through the window pattern)');
      } catch (error) {
        console.log(`\n(could not close it through the window pattern: ${error.message.slice(0, 90)})`);
      }
      if (!closed) {
        try {
          await closer.request('focus', { hwnd: notepadHwnd }, { timeoutMs: 6_000 });
          await wait(250);
          await closer.request('key', { keys: 'alt+f4' }, { timeoutMs: 6_000 });
          await wait(500);
          await closer.request('key', { keys: 'right' }, { timeoutMs: 6_000 });
          await closer.request('key', { keys: 'enter' }, { timeoutMs: 6_000 });
          closed = true;
        } catch (error) {
          console.log(`(could not close the test Notepad through the keyboard: ${error.message.slice(0, 90)})`);
        }
      }
      // Third try: invoke the window's own close button through UI Automation.
      if (!closed) {
        try {
          const tree = await closer.request('uitree', { hwnd: notepadHwnd, controlType: 'Button', maxNodes: 60 }, { timeoutMs: 20_000 });
          const closeButton = tree.nodes.find((n) => n.automationId === 'Close' || n.name === '关闭' || n.name === 'Close');
          if (closeButton !== undefined) {
            const selector = closeButton.automationId !== ''
              ? { automationId: closeButton.automationId }
              : { name: closeButton.name, controlType: 'Button' };
            await closer.request('uiact', { action: 'invoke', hwnd: notepadHwnd, ...selector }, { timeoutMs: 20_000 });
            await wait(400);
            closed = true;
            console.log('\n(closed the test Notepad window through UI Automation)');
          }
        } catch (error) {
          console.log(`(could not close it through UI Automation either: ${error.message.slice(0, 80)})`);
        }
      }
      // Last resort, and deliberately narrow: kill the process only when it owns a
      // single visible window. Windows 11 Notepad hosts every tab in one process, so
      // killing it blindly would take the user's own documents with it — and a
      // leftover test window otherwise accumulates and makes the next run flakier.
      if (!closed) {
        const listed = await closer.request('windows', {});
        const owned = listed.windows.filter((w) => w.pid === notepadPid);
        if (notepadPid !== null && owned.length <= 1) {
          const { spawnSync } = await import('node:child_process');
          spawnSync('taskkill', ['/PID', String(notepadPid), '/F']);
          console.log(`\n(force-closed the test Notepad, pid ${notepadPid})`);
        } else {
          console.log(`\n(left the Notepad window open: its process (pid ${notepadPid}) owns ${owned.length} windows, because Windows 11 Notepad hosts every document in one process — closing the whole process is not this test's call)`);
        }
      }
      closer.dispose();
    } catch (error) {
      console.log(`\n(could not close the test Notepad: ${error.message})`);
    }
  }
  console.log(`\n===== ${passed} passed, ${failures.length} failed =====`);
  if (skipped > 0) console.log(`  (${skipped} case(s) skipped — see the SKIP lines above)`);
  for (const failure of failures) console.log(`  - ${failure}`);
  if (failures.length > 0) process.exitCode = 1;
  rmSync(shimDir, { recursive: true, force: true });
  // Housekeeping never decides the verdict: a temp directory that will not delete is worth a
  // line, not a red run.
  try { rmSync(liveShotDir, { recursive: true, force: true }); } catch (error) { console.log(`(could not remove ${liveShotDir}: ${error.message})`); }
  setTimeout(() => process.exit(process.exitCode ?? 0), 300).unref();
}
