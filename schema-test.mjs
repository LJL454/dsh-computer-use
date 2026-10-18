/**
 * Output-schema conformance test.
 *
 * This exists because of a real escape: `computer_screenshot` returned a
 * `content` field the declared `output.schema` did not name, and DSH rejected
 * the call at runtime with
 *
 *   tool "computer_screenshot" returned invalid output:
 *   "value.content" is not a declared property (additionalProperties: false)
 *
 * The other harness called each tool and asserted the shape it *expected*, so it
 * happily asserted the bug in. A tool's returned value is a contract the host
 * enforces, and nothing here was checking that contract.
 *
 * So this file does the opposite: it stubs the PowerShell backend with replies
 * that deliberately carry extra fields (as the real one does), executes every
 * tool, and validates each returned value against that tool's own declared
 * schema using the same rules the host applies —`additionalProperties: false`,
 * per-property `required`, `enum`, and primitive types.
 *
 *   node schema-test.mjs
 */
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/* --------------------------------------------------------------- stub modules */

const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-schema-'));
const shotDir = join(shimDir, 'shots');
mkdirSync(shotDir, { recursive: true });

const toolsStub = join(shimDir, 'dsh-tools-stub.mjs');
writeFileSync(toolsStub, 'export const toolDefinitions = [];\nexport const defineTool = (definition) => { globalThis.__cuTools.push(definition); return definition; };\n');

/** A real 1x1 PNG, so the capture path can actually read bytes back. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const bridgeStub = join(shimDir, 'bridge-stub.mjs');
writeFileSync(bridgeStub, `
import { writeFileSync } from 'node:fs';

export class ComputerUseBackendError extends Error {
  constructor(message, code) { super(message); this.name = 'ComputerUseBackendError'; this.code = code; }
}

const SCREENS = [
  { index: 0, deviceName: '\\\\\\\\.\\\\DISPLAY1', primary: true, x: 0, y: 0, width: 2560, height: 1440 },
  { index: 1, deviceName: '\\\\\\\\.\\\\DISPLAY2', primary: false, x: -1920, y: 0, width: 1920, height: 1080 },
];

/** A real 1x1 PNG, so the capture paths can read bytes back from the paths they are given. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** Replies deliberately carry fields the tool schemas do NOT declare. */
export class PowerShellBackend {
  constructor() { this.info = { dpi: 'per-monitor-v2', screens: SCREENS, virtual: { x: -1920, y: 0, width: 4480, height: 1440 }, pid: 1, version: 'stub' }; }
  get alive() { return true; }
  async start() { return this.info; }
  async request(cmd, args) {
    switch (cmd) {
      case 'ping':
        return { ready: true, dpi: 'per-monitor-v2', screens: SCREENS, virtual: this.info.virtual, cursor: { x: 10, y: 20 }, UNDECLARED: 'x' };
      case 'health':
        return { interactive: true, foregroundHwnd: 42, foregroundTitle: 'Stub window', note: 'ok', UNDECLARED: 'x' };
      case 'screenshot':
        // What the caller actually asked the worker for. The replies here are shaped by
        // hand, so the arguments are the only thing that can prove an answer was
        // *forwarded* rather than invented: "a capture of hwnd 42" is a claim about this
        // argument, not about the pixels.
        globalThis.__cuStubArgs.screenshot.push(JSON.parse(JSON.stringify(args)));
        writeFileSync(args.path, PIXEL);
        return { path: args.path, x: 0, y: 0, width: 2560, height: 1440, scale: args.scale ?? 1,
                 format: args.format ?? 'png', bytes: 68, settledMs: 300, stability: { stable: true, polls: 2, waitedMs: 260 },
                 clipped: args.region !== undefined && args.region !== null,
                 screens: SCREENS, virtual: this.info.virtual,
                 cursor: { x: 10, y: 20 }, foreground: { hwnd: 42, title: 'Stub window' }, UNDECLARED: 'x' };
      case 'batch': {
        globalThis.__cuStubArgs.batch.push(JSON.parse(JSON.stringify(args)));
        const steps = Array.isArray(args.steps) ? args.steps : [];
        const performed = steps.map((step) => String(step.action));
        const wantsShot = args.screenshot === true || steps.some((step) => step.action === 'screenshot');
        // Whether this call has anywhere to put a trailing frame. computer_actions mints a
        // path of its own unless the caller passes one, so an empty save_path is the only
        // way through the tool to reach the worker's "nowhere to write" branch.
        const hasPath = typeof args.path === 'string' && args.path !== '';
        const frameAt = (path) => ({ path, x: 0, y: 0, width: 2560, height: 1440, scale: args.scale ?? 1,
                     format: args.format ?? 'png', bytes: 68, settledMs: 300, stability: { stable: false, polls: 21, waitedMs: 5000 },
                     screens: SCREENS, virtual: this.info.virtual,
                     cursor: { x: 10, y: 20 }, foreground: { hwnd: 42, title: 'Stub window' } });
        let shot = null;
        if (wantsShot && hasPath) {
          writeFileSync(args.path, PIXEL);
          shot = frameAt(args.path);
        }
        // ---------------------------------------------------------------- 1.18.0 replies
        //
        // Two things the worker now answers that a reply shaped like the old one cannot:
        //
        //   * which frame the caller is being handed, and whether it is on the right side
        //     of the batch's last write (the trailing capture is no longer always taken);
        //   * one report per condition wait, including the ones that timed out.
        //
        // Both are reported only when the situation that produces them happened, exactly
        // as the worker does it: no screenshot step in the batch means no reuse decision
        // to report, and no wait means no waits.
        const WRITES = ['click', 'drag', 'scroll', 'type', 'key', 'paste', 'focus', 'invoke', 'set_value',
                        'select_text', 'toggle', 'select', 'expand', 'collapse', 'scroll_into_view', 'click_text'];
        let captureUsed = null;
        if (args.screenshot === true) {
          const shotStep = steps.findIndex((step) => String(step.action) === 'screenshot');
          if (shotStep >= 0) {
            const laterWrite = steps.slice(shotStep + 1).some((step) => WRITES.includes(String(step.action)));
            const from = laterWrite ? (hasPath ? 'retaken' : 'step-stale') : 'step';
            const stepPath = String(steps[shotStep].path ?? '');
            // The file the step wrote, and the file the trailing capture would have written:
            // a tool or a test that reads back a path needs the bytes to be there.
            for (const candidate of [stepPath, from === 'retaken' ? args.path : '']) {
              if (candidate !== '') { try { writeFileSync(candidate, PIXEL); } catch { /* not this call's path */ } }
            }
            shot = frameAt(from === 'retaken' ? args.path : (stepPath !== '' ? stepPath : args.path));
            captureUsed = { from, stepIndex: shotStep, afterLastWrite: from !== 'step-stale' };
            if (from === 'retaken') captureUsed.note = 'a fresh capture was taken because a write came after the step frame';
            if (from === 'step-stale') captureUsed.note = 'the only frame this call took predates its last write';
          }
        }
        // The wait reports. The first one is the answer a caller most needs to see
        // rendered: a condition that never became true inside its budget. The second is
        // the satisfied one, carrying the stableMs/window/control fields the schema
        // declares as optional -- a render and a validator that both ignore them is a
        // contract nobody exercised.
        let waits;
        if (args.waitFor !== undefined || steps.some((step) => String(step.action) === 'wait_for')) {
          waits = [
            { what: "a window with title~'stub-that-never-appears'", satisfied: false, waitedMs: 600, polls: 5,
              timeoutMs: 600, timeoutFrom: 'explicit', pollMs: 120,
              observed: 'no such window is open yet', error: 'the window was never opened',
              UNDECLARED: 'x' },
            { what: "value of the control named 'Stub'", satisfied: true, waitedMs: 118, polls: 2,
              timeoutMs: 30000, timeoutFrom: 'default', pollMs: 120, stableMs: 100,
              observed: "it holds 'stub clipboard 中文'",
              window: { hwnd: 42, title: 'Stub window', process: 'stub', pid: 7 },
              control: { depth: 1, name: 'Root', controlType: 'ControlType.Edit', automationId: 'root', className: 'Stub',
                         enabled: true, offscreen: false, x: 0, y: 0, width: 800, height: 600, patterns: ['value'], ref: 's1.1' } },
          ];
        }
        const state = args.state === undefined || args.state === null || args.state === undefined ? null : {
          nodes: [{ depth: 0, name: 'Root', controlType: 'ControlType.Window', automationId: 'root', className: 'Stub',
                    enabled: true, offscreen: false, x: 0, y: 0, width: 800, height: 600, patterns: ['invoke'] }],
          truncated: false, mode: 'find', maxDepth: 4, maxNodes: 20, window: { hwnd: 42, title: 'Stub window', process: 'stub', pid: 7 },
          settledMs: 0, walked: 0, skipped: 0, UNDECLARED: 'x',
        };
        return { performed, count: performed.length, failedAt: -1, error: '', shot,
                 evidence: { changed: true, before: 'aaa', after: 'bbb', x: 0, y: 0, width: 100, height: 80 },
                 state, captureUsed, waits, UNDECLARED: 'x' };
      }
      case 'click': {
        // Mirrors the backend: accessibility is preferred for a plain single left
        // click, and anything chorded or repeated is a real click.
        const chorded = typeof args.modifiers === 'string' && args.modifiers !== '';
        const a11y = args.preferA11y !== false && !chorded
          && (args.clicks === undefined || args.clicks === 1)
          && (args.button === undefined || args.button === 'left');
        const reply = { x: args.x, y: args.y, clicks: args.clicks, button: args.button ?? 'left',
                        events: a11y ? 0 : 2, via: a11y ? 'a11y' : 'mouse', UNDECLARED: 'x' };
        if (a11y) reply.element = { name: 'Save', controlType: 'ControlType.Button', automationId: 'save' };
        if (chorded) reply.modifiers = args.modifiers;
        return reply;
      }
      case 'drag': {
        const reply = { from: { x: args.fromX, y: args.fromY }, to: { x: args.toX, y: args.toY }, steps: 12, UNDECLARED: 'x' };
        if (typeof args.modifiers === 'string' && args.modifiers !== '') reply.modifiers = args.modifiers;
        return reply;
      }
      case 'scroll':
        return { direction: args.direction, clicks: args.clicks, horizontal: args.horizontal, delta: -360, events: 3, UNDECLARED: 'x' };
      case 'type':
        return { typed: String(args.text ?? '').length, events: 2, skipped: [], foreground: { hwnd: 42, title: 'Stub window', process: 'stub' }, UNDECLARED: 'x' };
      case 'key':
        return { keys: args.keys, repeat: args.repeat, heldMs: args.holdMs ?? 0, events: 2, foreground: { hwnd: 42, title: 'Stub window', process: 'stub' }, UNDECLARED: 'x' };
      case 'windows':
        return { windows: [{ hwnd: 42, title: 'Stub window', process: 'stub', pid: 7, className: 'Stub', x: 0, y: 0, width: 800, height: 600, foreground: true }], UNDECLARED: 'x' };
      case 'focus':
        return { hwnd: args.hwnd, focused: true, title: 'Stub window', UNDECLARED: 'x' };
      case 'uitree':
        // Recorded for the same reason the screenshot case is: since and prune were
        // declared on the batch's state long before they were reachable on computer_ui,
        // and the only way to tell "the argument arrived" from "the tool ignored it" is to
        // look at what the worker was sent.
        globalThis.__cuStubArgs.uitree.push(JSON.parse(JSON.stringify(args)));
        return { nodes: [{ depth: 0, name: 'Root', controlType: 'ControlType.Window', automationId: 'root', className: 'Stub',
                           enabled: true, offscreen: false, x: 0, y: 0, width: 800, height: 600, patterns: ['invoke', 'value'] }],
                 truncated: false, mode: 'tree', maxDepth: args.maxDepth, maxNodes: args.maxNodes,
                 window: { hwnd: 42, title: 'Stub window', process: 'stub', pid: 7 },
                 settledMs: 0, walked: 3, skipped: 2, pruned: 2, snapshot: 'snap-1', UNDECLARED: 'x' };
      case 'uiact':
        return { action: args.action, value: args.value ?? args.text ?? 'Stub text', truncated: true, wrote: false,
                 matched: { depth: 0, name: 'Root', controlType: 'ControlType.Button',
                 automationId: 'root', className: 'Stub', enabled: true, offscreen: false, x: 0, y: 0, width: 10, height: 10,
                 patterns: ['invoke', 'text'] }, foreground: { hwnd: 42, title: 'Stub window', process: 'stub' }, UNDECLARED: 'x' };
      case 'clipboard':
        if (args.op === 'set') return { op: 'set', length: String(args.text ?? '').length, foreground: { hwnd: 42, title: 'Stub window', process: 'stub' }, UNDECLARED: 'x' };
        if (args.op === 'clear') return { op: 'clear', length: 0, UNDECLARED: 'x' };
        return { op: 'get', text: 'stub clipboard 中文', length: 21, truncated: false, UNDECLARED: 'x' };
      case 'paste':
        return { pasted: String(args.text ?? '').length, restored: args.restore !== false, savedUser: true, events: 4,
                 foreground: { hwnd: 42, title: 'Stub window', process: 'stub' }, UNDECLARED: 'x' };
      case 'launch':
        return { resolvedAs: 'command', file: 'C:\\\\stub\\\\app.exe', pid: 4242, process: 'stubapp', hwnd: 777,
                 title: 'Stub app', waitedMs: 540, matchedBy: 'process', note: '', UNDECLARED: 'x' };
      case 'release':
        return { released: ['mouse:left'], count: 1, note: 'held input was released', UNDECLARED: 'x' };
      case 'digest':
        return { digest: 'abcdef0123456789', x: 0, y: 0, width: 800, height: 600, maxSide: 320, UNDECLARED: 'x' };
      default:
        throw new Error('stub backend: unexpected command ' + cmd);
    }
  }
  dispose() {}
}
`);

globalThis.__cuTools = [];
/** What each command was called with, so an assertion can be about the argument and not the reply. */
globalThis.__cuStubArgs = { uitree: [], batch: [], screenshot: [] };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: pathToFileURL(toolsStub).href, shortCircuit: true };
    if (specifier === './backend/bridge.js' || specifier.endsWith('/backend/bridge.js')) {
      return { url: pathToFileURL(bridgeStub).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

/* -------------------------------------------------------------- the validator */

/**
 * Validate a value against a tool's declared output schema, applying the same
 * rules the host does. The RULES that matter here, and that a hand-written test
 * silently skips, are `additionalProperties: false` and per-property `required`.
 * @param value - the returned value.
 * @param schema - the declared schema.
 * @param path - dotted path for error messages.
 * @param errors - collector.
 */
function validate(value, schema, path, errors) {
  if (schema === undefined) return;
  if (Array.isArray(schema.oneOf)) {
    // 精确一支命中 —— host 的 checkValue 就是这条规则（"must match exactly one oneOf branch"）。
    // 少了这一段，可空声明（integer | null）会被静默跳过，等于把契约当空气。
    let matches = 0;
    for (const branch of schema.oneOf) {
      const probe = [];
      validate(value, branch, path, probe);
      if (probe.length === 0) matches += 1;
    }
    if (matches !== 1) errors.push(`${path}: must match exactly one oneOf branch (matched ${matches})`);
    return;
  }
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
    return;
  }
  switch (schema.type) {
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${path}: expected an object, got ${Array.isArray(value) ? 'array' : typeof value}`);
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
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected an array, got ${typeof value}`);
        return;
      }
      value.forEach((item, index) => validate(item, schema.items, `${path}[${index}]`, errors));
      return;
    }
    case 'string':
      if (typeof value !== 'string') errors.push(`${path}: expected a string, got ${typeof value}`);
      return;
    case 'integer':
      if (!Number.isInteger(value)) errors.push(`${path}: expected an integer, got ${JSON.stringify(value)}`);
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${path}: expected a finite number, got ${JSON.stringify(value)}`);
      return;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${path}: expected a boolean, got ${typeof value}`);
      return;
    case 'null':
      if (value !== null) errors.push(`${path}: expected null`);
      return;
    default:
      return;
  }
}

/** Validate the content blocks a render callback produces. */
function validateContent(blocks, path, errors) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    errors.push(`${path}: render must return a non-empty array of content blocks`);
    return;
  }
  blocks.forEach((block, index) => {
    if (block === null || typeof block !== 'object') {
      errors.push(`${path}[${index}]: not a content block`);
      return;
    }
    if (block.type === 'text') {
      if (typeof block.text !== 'string') errors.push(`${path}[${index}].text: must be a string`);
      return;
    }
    if (block.type === 'image') {
      if (block.attachment === null || typeof block.attachment !== 'object') {
        errors.push(`${path}[${index}].attachment: an image block needs an attachment reference`);
        return;
      }
      for (const key of ['attachmentId', 'mediaType', 'bytes', 'width', 'height']) {
        if (block.attachment[key] === undefined) errors.push(`${path}[${index}].attachment.${key}: missing`);
      }
      return;
    }
    errors.push(`${path}[${index}].type: unsupported block type ${JSON.stringify(block.type)}`);
  });
}

/* --------------------------------------------------------------------- drive */

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

const SESSION = 'schema-session';

/** The file a batch handed back, as the assertion detail when the path is the question. */
function usedPathOf(value) {
  return `shot.path=${String(value?.shot?.path)}`;
}

/** Arguments that exercise every declared branch of every tool. */
const CALLS = [
  ['computer_screenshot', { display: 0 }],
  ['computer_screenshot', { all_displays: true, save_path: join(shotDir, 'saved.png') }],
  ['computer_screenshot', { display: 0, scale: 0.5, format: 'jpeg' }],
  ['computer_screenshot', { display: 0, settle_ms: 0, stability_ms: 0, delay_seconds: 0 }],
  ['computer_screenshot', { region: { x: 0, y: 0, width: 800, height: 600 }, format: 'png' }],
  ['computer_actions', { steps: [{ action: 'click', x: 10, y: 20 }, { action: 'type', text: '中文' }, { action: 'key', keys: 'enter' }] }],
  ['computer_actions', { steps: [{ action: 'scroll', direction: 'down', clicks: 3 }, { action: 'wait', seconds: 0.2 }], screenshot: true, settle_ms: 150, scale: 0.5 }],
  ['computer_actions', { steps: [{ action: 'screenshot', scale: 0.25 }], format: 'png', save_path: join(shotDir, 'batch.png') }],
  // The 1.18.0 batch replies: a wait report (satisfied and timed out), and each way the
  // trailing frame can be obtained. One call per `captureUsed.from`, because the three
  // are produced by three different situations and a mapper can easily handle one.
  ['computer_actions', {
    steps: [
      { action: 'wait_for', condition: { kind: 'window', title: 'stub-that-never-appears' }, timeout_ms: 600, poll_ms: 120 },
      { action: 'wait_for', name: 'Stub', expected: 'v', timeout_ms: 5_000 },
    ],
    wait_for: { kind: 'value', name: 'Stub', expected: 'v' }, timeout_ms: 5_000, poll_ms: 120,
    evidence: false,
  }],
  ['computer_actions', {
    steps: [{ action: 'key', keys: 'shift' }, { action: 'screenshot', path: join(shotDir, 'reused.png') }],
    screenshot: true, save_path: join(shotDir, 'reused-trailing.png'), evidence: false,
  }],
  ['computer_actions', {
    steps: [{ action: 'screenshot', save_path: join(shotDir, 'stale-step.png') }, { action: 'type', text: 'x' }],
    screenshot: true, save_path: join(shotDir, 'retaken-trailing.png'), evidence: false,
  }],
  ['computer_actions', { steps: [{ action: 'paste', text: '粘贴' }, { action: 'focus', hwnd: 42 }, { action: 'clipboard', op: 'get' }], evidence: false }],
  ['computer_actions', {
    steps: [
      { action: 'invoke', automation_id: 'root' },
      { action: 'set_value', name: 'Root', value: 'v' },
      { action: 'get_value', control_type: 'Edit' },
      { action: 'get_text', control_type: 'Document' },
      { action: 'select_text', name: 'Root', text: 't', prefix: 'a', suffix: 'b', selection_type: 'cursor_after' },
      { action: 'scroll_into_view', class_name: 'Stub', element_index: 1 },
      { action: 'toggle', name: 'Root' },
      { action: 'select', name: 'Root' },
      { action: 'expand', name: 'Root' },
      { action: 'collapse', name: 'Root' },
      { action: 'move', x: 1, y: 2 },
    ],
    state: { hwnd: 42, filter: 'root', max_nodes: 20 },
    screenshot: true,
  }],
  ['computer_click', { x: 100, y: 200 }],
  ['computer_click', { x: 100, y: 200, button: 'right', clicks: 2 }],
  ['computer_click', { x: 100, y: 200, modifiers: 'shift' }],
  ['computer_click', { x: 100, y: 200, prefer_a11y: false }],
  ['computer_drag', { from_x: 1, from_y: 2, to_x: 30, to_y: 40 }],
  ['computer_drag', { from_x: 1, from_y: 2, to_x: 30, to_y: 40, modifiers: 'ctrl' }],
  ['computer_scroll', { direction: 'down' }],
  ['computer_scroll', { direction: 'left', clicks: 5, x: 10, y: 20 }],
  ['computer_type', { text: 'hello 中文' }],
  ['computer_key', { keys: 'ctrl+c' }],
  ['computer_key', { keys: 'shift', repeat: 3 }],
  ['computer_key', { keys: 'shift', hold_seconds: 0.2 }],
  ['computer_windows', {}],
  ['computer_windows', { filter: 'stub' }],
  ['computer_windows', { focus_hwnd: 42 }],
  ['computer_ui', { hwnd: 42 }],
  ['computer_ui', { hwnd: 42, filter: 'root', max_depth: 2, max_nodes: 10 }],
  ['computer_ui', { hwnd: 42, name: 'Root', patterns: false, skip_empty: false }],
  ['computer_ui', { hwnd: 42, control_type: 'Button', automation_id: 'root' }],
  ['computer_ui', { hwnd: 42, screenshot: true, scale: 0.5, format: 'jpeg', settle_ms: 0 }],
  ['computer_ui_action', { action: 'invoke', automation_id: 'root' }],
  ['computer_ui_action', { action: 'set_value', automation_id: 'root', value: '中文值' }],
  ['computer_ui_action', { action: 'get_value', control_type: 'Edit' }],
  ['computer_ui_action', { action: 'get_text', control_type: 'Document' }],
  ['computer_ui_action', { action: 'select_text', name: 'Root', text: 'hello', prefix: 'a', suffix: 'b', selection_type: 'cursor_before' }],
  ['computer_ui_action', { action: 'scroll_into_view', class_name: 'Stub', index: 1 }],
  ['computer_clipboard', { op: 'get' }],
  ['computer_clipboard', { op: 'set', text: '剪贴板' }],
  ['computer_clipboard', { op: 'clear' }],
  ['computer_paste', { text: '粘贴文本' }],
  ['computer_paste', { text: 'x', restore: false }],
  ['computer_launch', { target: 'notepad' }],
  ['computer_launch', { target: '计算器', arguments: ['/a'], wait_seconds: 1 }],
  ['computer_stop', { release_input: false }],
  // Last on purpose: this one turns the capability off for the session, so anything
  // after it would be refused by the gate rather than exercised.
  ['computer_stop', { disable_capability: true }],
];

const EXPECTED_TOOLS = [
  'computer_screenshot', 'computer_actions', 'computer_click', 'computer_drag', 'computer_scroll',
  'computer_type', 'computer_key', 'computer_windows', 'computer_ui', 'computer_ui_action',
  'computer_clipboard', 'computer_paste', 'computer_launch', 'computer_stop',
  // The browser channel (8.txt §11/§12): one read entry point and one action entry point,
  // gated by the same session switch.
  'browser_state', 'browser_actions',
];

// 来自已并入的 app-launch（原 @local/dsh-app-launch）：与上面 16 个不同，它们**不**受「电脑操作」
// 会话开关约束，也不进下面的 CALLS —— 执行它们会真的去启动进程，行为有自己的 tests/app-launch 用例。
// 但契约那一半照付、也照查：见后面 "the two ungated app-launch tools still owe schema + render"。
const UNGATED_TOOLS = ['app_launch', 'app_env_audit'];
const EXPECTED_TOTAL = EXPECTED_TOOLS.length + UNGATED_TOOLS.length;

try {
  const plugin = await import('./index.js');

  const tools = new Map();
  const services = {
    webServer: { register: () => () => {} },
    // Content-addressed like the real store, and it records every admission so a
    // test can prove that an unchanged frame never reaches it twice.
    admissions: [],
    attachments: {
      saveImages: async (inputs) => inputs.map((input) => {
        const digest = createHash('sha256').update(Buffer.from(input.data)).digest('hex');
        services.admissions.push({ mediaType: input.mediaType, bytes: input.data.byteLength, digest });
        return {
          attachmentId: `sha256:${digest}`,
          mediaType: input.mediaType,
          bytes: input.data.byteLength,
          width: 2560,
          height: 1440,
        };
      }),
    },
  };
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
    webServer: services.webServer,
    effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d(); }; },
    inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx); return () => {}; },
    get: (name) => services[name],
    logger: { info: () => {} },
  };
  plugin.apply(ctx, { defaultEnabled: true });

  console.log('\n== tools and their declared output schemas ==');
  check(`registered ${EXPECTED_TOTAL} tools`, tools.size === EXPECTED_TOTAL, `${tools.size}`);
  for (const name of EXPECTED_TOOLS) {
    const definition = tools.get(name);
    check(`${name} declares output.schema`, definition?.output?.schema !== undefined);
    check(`${name} declares output.render`, typeof definition?.output?.render === 'function');
    check(`${name} output is additionalProperties:false`, definition?.output?.schema?.additionalProperties === false, String(definition?.output?.schema?.additionalProperties));
  }

  console.log('\n== the two ungated app-launch tools still owe schema + render ==');
  // 这两个工具不进 CALLS（执行会真启动进程），但"值要符合声明、声明过 output.schema 就得有
  // output.render"这一份契约它们照付：host 先校验返回值，再调 output.render 产出模型看到的内容。
  // 而漏写 render 这件事真的穿过去过一次 —— 回报是
  //   tool "app_launch" returned invalid output: output.render failed: userRender is not a function
  // （defineTool 会无条件把 render 包一层去调 options.output.render）。所以这里用真实形状的值
  // 单独过一遍，包括 exitCode 为 null 的那一档（声明必须是可空的，否则 host 以
  // "value.exitCode must be an integer" 拒掉"直接启动一个常驻 GUI 应用"这个主场景）。
  {
    const FIXTURES = [
      ['app_launch', '直接启动、进程还活着（exitCode 为 null 的那一档）', {
        ok: true,
        state: 'window',
        target: 'C:\\Apps\\ExampleApp.exe',
        resolved: 'exe',
        viaExplorer: false,
        pid: 12345,
        imageName: 'ExampleApp',
        exited: false,
        exitCode: null,
        stripped: ['ELECTRON_RUN_AS_NODE'],
        windows: [{ pid: 12345, title: 'ExampleApp — main window', matchedBy: 'pid', fuzzy: false }],
        windowMatch: 'target',
        fuzzyMatch: false,
        waitedMs: 1200,
        durationMs: 1400,
      }],
      ['app_launch', '交给 shell 打开的目标', {
        ok: true,
        state: 'window',
        target: 'https://example.com',
        resolved: 'shell',
        viaExplorer: true,
        pid: 4321,
        imageName: '',
        exited: true,
        exitCode: 1,
        stripped: [],
        windows: [{ pid: 999, title: 'Example Domain - Microsoft Edge', matchedBy: 'started', fuzzy: true }],
        windowMatch: 'started-window',
        fuzzyMatch: true,
        waitedMs: 800,
        durationMs: 900,
      }],
      ['app_launch', '什么都没出现（失败，带 hint）', {
        ok: false,
        state: 'exited-without-window',
        target: 'E:\\definitely\\not\\here.exe',
        resolved: 'exe',
        viaExplorer: false,
        pid: 0,
        imageName: 'here',
        exited: true,
        exitCode: 1,
        stripped: [],
        windows: [],
        windowMatch: 'none',
        fuzzyMatch: false,
        waitedMs: 6000,
        durationMs: 6100,
        hint: 'the process exited without opening a window — check the target path, or that an instance is not already running with a modal dialog open.',
      }],
      ['app_launch', '根本没启动起来（launch-failed）', {
        ok: false,
        state: 'launch-failed',
        target: 'E:\\tmp\\bogus.exe',
        resolved: 'exe',
        viaExplorer: false,
        pid: 0,
        imageName: '',
        exited: null,
        exitCode: null,
        stripped: [],
        windows: [],
        windowMatch: 'none',
        fuzzyMatch: false,
        waitedMs: 0,
        durationMs: 20,
        error: 'spawn EINVAL',
        hint: 'the target could not be started: spawn EINVAL. Check that it is a runnable program (a document and a URL go through the shell — pass kind: \'store\' for a packaged app).',
      }],
      ['app_env_audit', '被污染的本会话', {
        sessionIsPolluted: true,
        present: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }],
        wouldStrip: ['ELECTRON_RUN_AS_NODE'],
        explanation: 'This session exports ELECTRON_RUN_AS_NODE=1, so an Electron app started from it runs as Node: no window, silent exit 0.',
      }],
      ['app_env_audit', '干净会话', {
        sessionIsPolluted: false,
        present: [],
        wouldStrip: [],
        explanation: 'No Electron/Node-injection variables found in this session; launching an Electron app directly should work.',
      }],
    ];
    for (const [name, label, value] of FIXTURES) {
      const definition = tools.get(name);
      const tag = `${name} · ${label}`;
      check(`${tag}: declares output.render`, typeof definition?.output?.render === 'function');
      if (definition === undefined) continue;

      const errors = [];
      validate(value, definition.output.schema, 'value', errors);
      check(`${tag}: 工具真实返回的形状符合声明`, errors.length === 0, errors.join(' | '));

      try {
        const blocks = definition.output.render({}, value);
        const contentErrors = [];
        validateContent(blocks, 'content', contentErrors);
        check(`${tag}: render 产出合法内容块`, contentErrors.length === 0, contentErrors.join(' | '));
      } catch (error) {
        check(`${tag}: render 产出合法内容块`, false, error.message);
      }
    }
  }

  console.log('\n== every tool, executed against a stub backend, validated ==');
  const exec = { agent: { session: { id: SESSION } }, signal: undefined };
  // The kill-switch call turns the capability off for whichever session makes it,
  // so it runs as its own session: the calls after it are here to be validated, not
  // to be refused by a switch the previous line flipped.
  const killSwitchSession = { agent: { session: { id: `${SESSION}-kill-switch` } }, signal: undefined };
  for (const [name, args] of CALLS) {
    const definition = tools.get(name);
    if (definition === undefined) {
      check(`${name} exists`, false);
      continue;
    }
    const label = `${name}(${Object.keys(args).join(',') || 'no args'})`;
    const callExec = name === 'computer_stop' && args.disable_capability === true ? killSwitchSession : exec;
    let value;
    try {
      value = await definition.execute(args, callExec);
    } catch (error) {
      check(`${label} executes`, false, error.message);
      continue;
    }
    const errors = [];
    validate(value, definition.output.schema, 'value', errors);
    check(`${label} output conforms to its schema`, errors.length === 0, errors.join(' | '));

    // The render callback is the other half of the contract: it turns the value
    // into the content blocks the model actually receives.
    try {
      const blocks = definition.output.render(args, value);
      const contentErrors = [];
      validateContent(blocks, 'content', contentErrors);
      check(`${label} renders valid content blocks`, contentErrors.length === 0, contentErrors.join(' | '));
    } catch (error) {
      check(`${label} renders`, false, error.message);
    }
  }

  console.log('\n== a batch says which frame it returned, and what waits it ran ==');
  // The 1.18.0 batch value carries two things a caller acts on: `captureUsed` (was the
  // frame I am looking at taken after my last step?) and `waits` (did the condition I
  // asked for ever become true?). Both are declared, so both have to survive the mapper
  // AND say the right thing in the envelope -- a field a caller cannot interpret is the
  // same as a field that was dropped.
  const batchArgs = globalThis.__cuStubArgs.batch;
  const waitsCall = await tools.get('computer_actions').execute({
    steps: [{ action: 'wait_for', condition: { kind: 'window', title: 'stub-that-never-appears' }, timeout_ms: 600, poll_ms: 120 }],
    wait_for: { kind: 'value', name: 'Stub', expected: 'v' },
    timeout_ms: 5_000, poll_ms: 120,
    evidence: false,
  }, exec);
  const waitsErrors = [];
  validate(waitsCall, tools.get('computer_actions').output.schema, 'value', waitsErrors);
  check('a batch reply carrying waits and captureUsed conforms', waitsErrors.length === 0, waitsErrors.join(' | '));
  check('the wait that timed out survives the mapper', waitsCall.waits?.[0]?.satisfied === false && waitsCall.waits[0].pollMs === 120, JSON.stringify(waitsCall.waits?.[0]));
  check('so does the satisfied one, with its stableMs', waitsCall.waits?.[1]?.satisfied === true && waitsCall.waits[1].stableMs === 100, JSON.stringify(waitsCall.waits?.[1]));
  check('a wait carries the window it was about', waitsCall.waits?.[1]?.window?.hwnd === 42, JSON.stringify(waitsCall.waits?.[1]?.window));
  check('and the control it was about', waitsCall.waits?.[1]?.control?.automationId === 'root', JSON.stringify(waitsCall.waits?.[1]?.control));
  const waitsText = tools.get('computer_actions').output.render({}, waitsCall).map((block) => block.text ?? '').join('\n');
  check('the envelope says a wait never became true, and that the steps before it did run', waitsText.includes('never became true') && waitsText.includes('stub-that-never-appears') && waitsText.includes('The steps before it did run'), waitsText.slice(0, 400));
  check('and the timeout line says how long it looked and what it saw', waitsText.includes('5 check(s) over 600 ms') && waitsText.includes('no such window is open yet'), waitsText.slice(0, 400));
  check('the satisfied wait is reported as a wait that ended, not a warning', waitsText.includes('it became true after 118 ms'), waitsText.slice(0, 400));
  // The calls above reach the worker with the arguments the tool built, and the call-level
  // timeout/poll are the ones the batch declared rather than two more sleeps nobody chose.
  check('the batch wait reaches the worker as a condition', batchArgs.some((a) => a.waitFor?.kind === 'value' && a.waitFor?.expected === 'v'), JSON.stringify(batchArgs.at(-1)?.waitFor));
  check('the call-level timeout_ms and poll_ms reach the batch wait', batchArgs.some((a) => a.waitFor?.timeout_ms === 5_000 && a.waitFor?.poll_ms === 120), JSON.stringify(batchArgs.at(-1)?.waitFor));

  const reusedCall = await tools.get('computer_actions').execute({
    steps: [{ action: 'key', keys: 'shift' }, { action: 'screenshot', path: join(shotDir, 'reused.png') }],
    screenshot: true, save_path: join(shotDir, 'reused-trailing.png'), evidence: false,
  }, exec);
  const reusedErrors = [];
  validate(reusedCall, tools.get('computer_actions').output.schema, 'value', reusedErrors);
  check('a reused step frame conforms', reusedErrors.length === 0, reusedErrors.join(' | '));
  check("captureUsed.from is 'step' and names the step", reusedCall.captureUsed?.from === 'step' && reusedCall.captureUsed?.stepIndex === 1, JSON.stringify(reusedCall.captureUsed));
  check('and it says the frame is after the last write', reusedCall.captureUsed?.afterLastWrite === true, JSON.stringify(reusedCall.captureUsed));
  check('the returned frame is the one the step wrote, not the trailing path', reusedCall.shot?.path === join(shotDir, 'reused.png'), usedPathOf(reusedCall));
  const reusedText = tools.get('computer_actions').output.render({}, reusedCall).map((block) => block.text ?? '').join('\n');
  check('a reused frame is not described as a retake', !reusedText.includes('was captured after the last step'), reusedText.slice(0, 240));

  const retakenCall = await tools.get('computer_actions').execute({
    steps: [{ action: 'screenshot', path: join(shotDir, 'stale-step.png') }, { action: 'type', text: 'x' }],
    screenshot: true, save_path: join(shotDir, 'retaken-trailing.png'), evidence: false,
  }, exec);
  const retakenErrors = [];
  validate(retakenCall, tools.get('computer_actions').output.schema, 'value', retakenErrors);
  check('a retaken frame conforms', retakenErrors.length === 0, retakenErrors.join(' | '));
  check("captureUsed.from is 'retaken'", retakenCall.captureUsed?.from === 'retaken', JSON.stringify(retakenCall.captureUsed));
  check('the retaken frame is the new capture, not the step frame', retakenCall.shot?.path === join(shotDir, 'retaken-trailing.png'), usedPathOf(retakenCall));
  const retakenText = tools.get('computer_actions').output.render({}, retakenCall).map((block) => block.text ?? '').join('\n');
  check('the envelope explains why a second frame was taken', retakenText.includes('was captured after the last step'), retakenText.slice(0, 400));
  check('and it says which one it is not', retakenText.includes('a write came after it'), retakenText.slice(0, 400));

  // 'step-stale' is the third answer, and the one that needs a warning: the only frame
  // this call has predates its own last write, and there was nowhere to write a new one.
  //
  // Reaching it through the tool takes an explicitly empty `save_path`: computer_actions
  // mints a path of its own whenever a capture is wanted, so the "nowhere to write" branch
  // is only entered when the caller says the path is empty. The reply below is the one the
  // worker gives in that case, and it is the only place that warning can come from.
  const staleCall = await tools.get('computer_actions').execute({
    steps: [{ action: 'screenshot', path: join(shotDir, 'stale-only.png') }, { action: 'type', text: 'x' }],
    screenshot: true, save_path: '', evidence: false,
  }, exec);
  const staleErrors = [];
  validate(staleCall, tools.get('computer_actions').output.schema, 'value', staleErrors);
  check('a stale step frame conforms', staleErrors.length === 0, staleErrors.join(' | '));
  check("captureUsed.from is 'step-stale' with afterLastWrite false", staleCall.captureUsed?.from === 'step-stale' && staleCall.captureUsed?.afterLastWrite === false, JSON.stringify(staleCall.captureUsed));
  const staleText = tools.get('computer_actions').output.render({}, staleCall).map((block) => block.text ?? '').join('\n');
  check('the envelope warns that the frame shows the state before the steps finished', staleText.includes('shows the state before the steps finished'), staleText.slice(0, 400));

  console.log('\n== computer_ui and the batch read reach the same worker arguments ==');
  const reachable = await tools.get('computer_ui').execute({ hwnd: 42, since: 'snap-1', prune: false, max_depth: 3 }, exec);
  const reachableErrors = [];
  validate(reachable, tools.get('computer_ui').output.schema, 'value', reachableErrors);
  check('a window read with since and prune conforms', reachableErrors.length === 0, reachableErrors.join(' | '));
  const uitreeArgs = globalThis.__cuStubArgs.uitree;
  check('since reaches the worker (it is what makes a delta possible)', uitreeArgs.at(-1)?.since === 'snap-1', JSON.stringify(uitreeArgs.at(-1)?.since));
  check('so does prune', uitreeArgs.at(-1)?.prune === false, JSON.stringify(uitreeArgs.at(-1)?.prune));
  check('and the read reports what the worker folded away', reachable.pruned === 2, String(reachable.pruned));
  check('a snapshot id comes back for the next delta', reachable.snapshot === 'snap-1', String(reachable.snapshot));

  const windowShot = await tools.get('computer_ui').execute({ hwnd: 42, screenshot: true, max_nodes: 20 }, exec);
  const windowShotErrors = [];
  validate(windowShot, tools.get('computer_ui').output.schema, 'value', windowShotErrors);
  check('a read that is also a capture conforms', windowShotErrors.length === 0, windowShotErrors.join(' | '));
  check('and it carries the picture it took', windowShot.shot?.width === 2560 && windowShot.shot?.image !== undefined, JSON.stringify(windowShot.shot && { width: windowShot.shot.width, image: windowShot.shot.image?.attachmentId }));
  const lastShot = globalThis.__cuStubArgs.screenshot.at(-1);
  check('and it captures that window rather than the screen', lastShot?.window === 42, JSON.stringify(lastShot && { window: lastShot.window, display: lastShot.display }));

  console.log('\n== the screenshot tool really does attach an image when it can ==');
  const shot = await tools.get('computer_screenshot').execute({ display: 0 }, exec);
  check('value carries an admitted image ref', shot.image !== undefined && typeof shot.image.attachmentId === 'string', JSON.stringify(shot.image));
  const shotBlocks = tools.get('computer_screenshot').output.render({}, shot);
  check('render emits a text block then an image block', shotBlocks[0]?.type === 'text' && shotBlocks[1]?.type === 'image', shotBlocks.map((b) => b.type).join(','));
  check('the envelope names the file', shotBlocks[0].text.includes(shot.path));
  check('the envelope lists both displays', shotBlocks[0].text.includes('DISPLAY1') && shotBlocks[0].text.includes('DISPLAY2'));

  console.log('\n== an unchanged frame is served from the digest cache ==');
  // The stub writes the same 1x1 PNG for every capture, which is exactly the
  // "screen did not move" case a GUI loop hits most of the time.
  const before = services.admissions.length;
  const repeat = await tools.get('computer_screenshot').execute({ display: 0 }, exec);
  check('the repeat is flagged unchanged', repeat.unchanged === true, String(repeat.unchanged));
  check('the repeat is not admitted again', services.admissions.length === before, `${services.admissions.length} vs ${before}`);
  check('the repeat reuses the earlier attachment', repeat.image?.attachmentId === shot.image?.attachmentId, `${repeat.image?.attachmentId} vs ${shot.image?.attachmentId}`);
  const repeatBlocks = tools.get('computer_screenshot').output.render({}, repeat);
  check('the envelope says the frame is unchanged', repeatBlocks[0].text.includes('unchanged: this frame is byte-identical'));
  const scaled = await tools.get('computer_screenshot').execute({ display: 0, scale: 0.5, format: 'jpeg' }, exec);
  check('a scaled capture reports its format', scaled.format === 'jpeg' && scaled.scale === 0.5, `${scaled.format} @${scaled.scale}`);
  check('a scaled capture halves the reported image edges', scaled.imageWidth === Math.round(scaled.width / 2), `${scaled.imageWidth} vs ${scaled.width / 2}`);
  check('the envelope explains the scale mapping', tools.get('computer_screenshot').output.render({}, scaled)[0].text.includes('multiply an image coordinate by'));

  console.log('\n== and falls back to a path when no store is mounted ==');
  const bare = new Map();
  const bareCtx = {
    tools: { register: (d) => { bare.set(d.name, d); return () => {}; } },
    webServer: services.webServer,
    effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d(); }; },
    inject: (deps, callback) => { callback(bareCtx); return () => {}; },
    get: () => undefined,
    logger: { info: () => {} },
  };
  plugin.apply(bareCtx, { defaultEnabled: true });
  const bareValue = await bare.get('computer_screenshot').execute({ display: 0 }, exec);
  const bareErrors = [];
  validate(bareValue, bare.get('computer_screenshot').output.schema, 'value', bareErrors);
  check('a store-less capture still conforms', bareErrors.length === 0, bareErrors.join(' | '));
  check('it explains itself with a note', typeof bareValue.note === 'string' && bareValue.note.includes('read_image'), String(bareValue.note).slice(0, 80));
  check('it has no image field', bareValue.image === undefined);
  const bareBlocks = bare.get('computer_screenshot').output.render({}, bareValue);
  check('render degrades to two text blocks', bareBlocks.length === 2 && bareBlocks[1].type === 'text', bareBlocks.map((b) => b.type).join(','));

  console.log(`\n===== ${passed} passed, ${failures.length} failed =====`);
  if (failures.length > 0) {
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error('SCHEMA TEST CRASHED:', error);
  process.exitCode = 1;
} finally {
  rmSync(shimDir, { recursive: true, force: true });
  setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref();
}
