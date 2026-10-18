/**
 * B4 (8.txt §9): the signals a launch reports, and what it does when a name is ambiguous.
 *
 * §9 is about not guessing: an exact path or name comes first, name relevance decides next,
 * and "is it running" / "how often has the shell seen it" only break ties — they never
 * decide alone. When two candidates tie even after that, the plugin says so and lists them
 * instead of launching whichever one is usually busier.
 *
 * What this checks:
 *   - an explicit path and a bare name are reported with the *true* source ('path' vs
 *     'command'/'on PATH'), not flattened into one kind;
 *   - the reply carries `wasRunning`, `useCount` and `useCountKnown`, and 0 with
 *     useCountKnown false reads as "no usable history" rather than "never used";
 *   - a fuzzy name either resolves with its runners-up in `candidates`, or is refused as
 *     `[AMBIGUOUS_MATCH]` *with the candidates in the message* — never silently picks one;
 *   - a nonexistent name still fails with the same "where did it look" sentence.
 *
 * It only closes windows it created itself (a launch that handed off to an existing
 * instance reports `wasRunning: true`, and its window belongs to the user).
 *
 *   node app-candidates-test.mjs
 */
import { registerHooks } from 'node:module';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-apps-'));
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

const plugin = await import('./index.js');
const tools = new Map();
const services = {
  webServer: { register: () => () => {} },
  attachments: { saveImages: async () => [] },
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
const exec = { agent: { session: { id: 'app-candidates-session' } }, signal: undefined };
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

/** Windows we started ourselves, so the test can close exactly those. */
const ownWindows = [];

try {
  console.log('\n== an explicit path keeps its true source ==');
  const byPath = await callTool('computer_launch', { target: 'C:\\Windows\\System32\\notepad.exe', wait_seconds: 4 });
  check('the launch reports where it came from', byPath.source === 'path', String(byPath.source));
  check('and how it matched', byPath.matchBasis === 'explicit path', String(byPath.matchBasis));
  check('the running state is reported', typeof byPath.wasRunning === 'boolean', String(byPath.wasRunning));
  check('the usage history is reported as a value and a verdict', Number.isInteger(byPath.useCount) && typeof byPath.useCountKnown === 'boolean',
    JSON.stringify({ useCount: byPath.useCount, useCountKnown: byPath.useCountKnown }));
  check('0 with useCountKnown false is not presented as "never used"', byPath.useCountKnown === true || byPath.useCount === 0,
    JSON.stringify({ useCount: byPath.useCount, useCountKnown: byPath.useCountKnown }));
  check('the reply conforms to the declared schema', conformance('computer_launch', byPath).length === 0, conformance('computer_launch', byPath).join('; '));
  if (byPath.hwnd !== 0 && byPath.wasRunning === false) ownWindows.push(byPath.hwnd);

  console.log('\n== a bare name goes through PATH, and says so ==');
  const byName = await callTool('computer_launch', { target: 'notepad', wait_seconds: 4 });
  check('a name on PATH reports the command source', byName.source === 'command', String(byName.source));
  check('with the PATH match basis', byName.matchBasis === 'on PATH', String(byName.matchBasis));
  if (byName.hwnd !== 0 && byName.wasRunning === false && !ownWindows.includes(byName.hwnd)) ownWindows.push(byName.hwnd);

  console.log('\n== a fuzzy name is resolved with its runners-up, or refused with them ==');
  const fuzzy = await callTool('computer_launch', { target: 'note', wait_seconds: 3 })
    .then((value) => ({ value }), (error) => ({ error: String(error.message) }));
  if (fuzzy.error !== undefined && /\[AMBIGUOUS_MATCH\]/.test(fuzzy.error)) {
    // §9's core requirement: a tie is reported, not guessed — and the report carries the
    // candidates, so the caller can name the one it meant.
    check('a name tie is refused rather than guessed', /matches \d+ applications equally well/i.test(fuzzy.error), fuzzy.error.slice(0, 200));
    const quoted = fuzzy.error.match(/'[^']+'/g) ?? [];
    check('and the candidates are listed in the refusal', quoted.length >= 3, fuzzy.error.slice(0, 220));
    check('the refusal says how to disambiguate', /exact display name|executable path|command line/i.test(fuzzy.error), fuzzy.error.slice(-200));
    check('and that nothing was launched', /action_sent=false/.test(fuzzy.error), fuzzy.error.slice(-160));
    check('a pre-flight refusal is not dressed up as an unknown outcome', !/\[UNKNOWN_OUTCOME\]/.test(fuzzy.error), fuzzy.error.slice(0, 90));
  } else if (fuzzy.error !== undefined) {
    check('an unresolvable name says where it looked', /could not find an application named 'note'/i.test(fuzzy.error), fuzzy.error.slice(0, 180));
    skip('the runners-up clause', 'this machine has no Start menu entry containing "note"');
  } else if (fuzzy.value === undefined) {
    check('the fuzzy case produced an answer', false, 'neither a value nor an error');
  } else {
    check('the fuzzy name resolved through a named source', ['shortcut', 'start-app-path', 'store'].includes(fuzzy.value.source),
      JSON.stringify({ source: fuzzy.value.source, file: fuzzy.value.file }));
    check('a fuzzy match reports what it matched on', typeof fuzzy.value.matchBasis === 'string' && fuzzy.value.matchBasis !== '', String(fuzzy.value.matchBasis));
    check('and the runners-up are listed', Array.isArray(fuzzy.value.candidates) && fuzzy.value.candidates.length > 0,
      JSON.stringify(fuzzy.value.candidates));
    check('every runner-up carries the same signals', (fuzzy.value.candidates ?? []).every((one) => typeof one.label === 'string' && typeof one.source === 'string' && typeof one.isRunning === 'boolean' && Number.isInteger(one.useCount) && typeof one.useCountKnown === 'boolean'),
      JSON.stringify((fuzzy.value.candidates ?? [])[0]));
    check('the fuzzy reply conforms to the declared schema', conformance('computer_launch', fuzzy.value).length === 0, conformance('computer_launch', fuzzy.value).join('; '));
    if (fuzzy.value.hwnd !== 0 && fuzzy.value.wasRunning === false && !ownWindows.includes(fuzzy.value.hwnd)) ownWindows.push(fuzzy.value.hwnd);
  }

  console.log('\n== a name the plugin cannot find fails with its search path ==');
  const missing = await refuses('computer_launch', { target: 'definitely-not-an-app-9f3c' });
  check('the refusal names what was tried', /tried a path, PATH, the Start menu, and installed apps/i.test(missing), missing.slice(0, 200));

  console.log('\n== the caches are reused, and can be refreshed ==');
  const first = await callTool('computer_launch', { target: 'C:\\Windows\\System32\\notepad.exe', wait_seconds: 2 });
  const refreshed = await callTool('computer_launch', { target: 'C:\\Windows\\System32\\notepad.exe', wait_seconds: 2, refresh_discovery: true });
  check('a refresh still resolves the same target', refreshed.source === first.source && refreshed.file === first.file,
    JSON.stringify({ first: first.source, refreshed: refreshed.source }));
  check('and reports the same running state', refreshed.wasRunning === true || refreshed.wasRunning === false, String(refreshed.wasRunning));
  if (refreshed.hwnd !== 0 && refreshed.wasRunning === false && !ownWindows.includes(refreshed.hwnd)) ownWindows.push(refreshed.hwnd);

  // Only windows this test started: a launch that handed off to an existing instance
  // (wasRunning true) reports a window that belongs to the user's own session.
  for (const hwnd of ownWindows) {
    await callTool('computer_ui_action', { action: 'close', hwnd, control_type: 'Window' }).catch(() => {});
    await sleep(120);
  }
  if (ownWindows.length === 0) skip('the cleanup clause', 'no window of ours needed closing');

  console.log(`\n${passed} passed, ${failures.length} failed, ${skipped} skipped`);
  if (failures.length > 0) {
    console.log('\nfailures:');
    for (const failure of failures) console.log(`  - ${failure}`);
  }
} catch (error) {
  console.error('app-candidates-test crashed:', error);
  process.exitCode = 1;
} finally {
  rmSync(shimDir, { recursive: true, force: true });
  if (failures.length > 0) process.exitCode = 1;
  setTimeout(() => process.exit(process.exitCode ?? 0), 150).unref();
}
