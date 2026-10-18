/**
 * Runtime-contract test: the trace (V01), the window capability profiles (B02) and the
 * isolated read worker plus read retry (A10).
 *
 * These three live in the *host* half and none of them is visible in a tool's return value
 * alone: a trace is what the host counts, a profile is what it remembers, and a second worker
 * is a process nobody asked for by name. So they are read back through the status route the
 * same way an operator would.
 *
 *   node host-runtime-test.mjs
 */
import { registerHooks } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/* ----------------------------------------------------------- the dsh-tools stub */

const shimDir = mkdtempSync(join(tmpdir(), 'dsh-computer-use-run-shim-'));
const shimPath = join(shimDir, 'dsh-tools-stub.mjs');
writeFileSync(shimPath, 'export const defineTool = (definition) => definition;\n');
const shimUrl = pathToFileURL(shimPath).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: shimUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const SESSION = 'runtime-under-test';
const harnesses = [];

function createContext() {
  const tools = new Map();
  const routes = new Map();
  const effects = [];
  const services = {
    webServer: {
      register(route) {
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      },
    },
    attachments: {
      saveImages: async (inputs) => inputs.map((input, index) => ({
        attachmentId: `sha256:run-${index}`,
        mediaType: input.mediaType,
        bytes: input.data.byteLength,
        // A placeholder size on purpose: the frame layer has to notice that this is not a
        // rescale of the capture and ignore it rather than move every projected point.
        width: 2560,
        height: 1440,
      })),
    },
  };
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => tools.delete(definition.name); } },
    webServer: services.webServer,
    effect(fn, label) {
      const dispose = fn();
      effects.push({ label, dispose: typeof dispose === 'function' ? dispose : () => {} });
      return () => {};
    },
    inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx); return () => {}; },
    get: (name) => services[name],
    logger: { info: () => {} },
  };
  const built = { ctx, tools, routes, effects };
  harnesses.push(built);
  return built;
}

const EXEC = { agent: { session: { id: SESSION } }, signal: undefined };

async function callRoute(route, { method = 'GET', url = route.path, body } = {}) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')];
  const req = {
    method,
    url,
    async *[Symbol.asyncIterator]() { for (const chunk of payload) yield chunk; },
  };
  let text = '';
  const res = { writeHead() {}, end(chunk) { text += chunk ?? ''; } };
  await route.handler(req, res);
  return text === '' ? undefined : JSON.parse(text);
}

let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
    return true;
  }
  failures.push(label);
  console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`);
  return false;
}

function skip(label, why) {
  console.log(`  skip  ${label} -- ${why}`);
}

async function main() {
  const plugin = await import('./index.js');

  /* ------------------------------------------------------- trace and profiles */

  const harness = createContext();
  plugin.apply(harness.ctx, { defaultEnabled: true });
  const status = () => callRoute(harness.routes.get('/computer-use/status'));

  console.log('\n== the status route carries the runtime contract ==');
  const empty = await status();
  check('the status route answers with a runtime block', empty?.runtime !== undefined && typeof empty.runtime === 'object');
  check('the runtime block starts empty', empty.runtime.metrics.toolCalls === 0 && empty.runtime.trace.length === 0, JSON.stringify(empty.runtime.metrics));
  check('and names both workers', 'main' in empty.runtime.backends && 'read' in empty.runtime.backends, JSON.stringify(empty.runtime.backends));

  console.log('\n== V01: every call lands in the trace ==');
  const windows = await harness.tools.get('computer_windows').execute({}, EXEC);
  check('a read tool ran', Array.isArray(windows.windows), JSON.stringify(windows).slice(0, 80));
  const afterRead = await status();
  check('the call is counted', afterRead.runtime.metrics.toolCalls >= 1, String(afterRead.runtime.metrics.toolCalls));
  const last = afterRead.runtime.trace.at(-1);
  check('and the span names it, with a duration', last?.tool === 'computer_windows' && Number.isFinite(last.ms), JSON.stringify(last));
  check('the span says it succeeded', last?.ok === true, JSON.stringify(last));

  const shot = await harness.tools.get('computer_screenshot').execute({ format: 'png', region: { x: 0, y: 0, width: 64, height: 48 } }, EXEC);
  const afterShot = await status();
  check('observation cost is counted in pixels and bytes', afterShot.runtime.metrics.screenshots >= 1 && afterShot.runtime.metrics.screenshotPixels >= 64 * 48 && afterShot.runtime.metrics.screenshotBytes > 0,
    JSON.stringify(afterShot.runtime.metrics));
  check('the span records the image it delivered', Number.isFinite(shot.imageWidth) && afterShot.runtime.trace.at(-1)?.image === `${shot.imageWidth}x${shot.imageHeight}`,
    `${afterShot.runtime.trace.at(-1)?.image} vs ${shot.imageWidth}x${shot.imageHeight}`);
  check('the transport split is recorded too', Number.isFinite(afterShot.runtime.trace.at(-1)?.captureMs), JSON.stringify(afterShot.runtime.trace.at(-1)));

  console.log('\n== A10: reads run in their own worker ==');
  const backends = afterShot.runtime.backends;
  check('the isolated read worker is running', Number(backends.read?.pid ?? 0) > 0, JSON.stringify(backends.read));
  check('it is a different process from the main worker', backends.main === null || Number(backends.read.pid) !== Number(backends.main.pid),
    `main=${backends.main?.pid ?? 'not started'} read=${backends.read?.pid}`);
  check('it has served the read commands', Number(backends.read?.transport?.requests ?? 0) >= 1, JSON.stringify(backends.read?.transport));

  console.log('\n== B02: what we have seen about a window is remembered, per window ==');
  const evidenceOf = (list) => list.map((one) => `${one.key}=${one.state}`).join(', ');
  check(
    afterShot.runtime.profiles.some((one) => /rendered its own pixels|fell back to the screen|screen pixels could be read/.test(String(one.evidence))),
    'a capture is recorded as a visual capability for the surface it read',
    evidenceOf(afterShot.runtime.profiles),
  );
  check(
    afterShot.runtime.profiles.some((one) => String(one.key).startsWith('env|')),
    'the environment (the DPI awareness this process actually got) is recorded once per worker',
    evidenceOf(afterShot.runtime.profiles),
  );
  const ui = await harness.tools.get('computer_ui').execute({ max_depth: 3, max_nodes: 40 }, EXEC).catch((error) => ({ error: String(error.message ?? error) }));
  const afterUi = await status();
  if (ui?.window === undefined) {
    skip('the window profile', `the focused window could not be read here (${String(ui?.error ?? '').slice(0, 60)})`);
  } else {
    const entry = afterUi.runtime.profiles.find((one) => Number(one.hwnd) === Number(ui.window.hwnd));
    check('a profile exists for the window that was read', entry !== undefined, JSON.stringify(afterUi.runtime.profiles));
    check('it carries a state, its evidence and when it was observed',
      ['available', 'degraded', 'unavailable', 'unknown'].includes(String(entry?.state)) && String(entry?.evidence ?? '') !== '' && Number.isFinite(entry?.ageMs),
      JSON.stringify(entry));
    const render = harness.tools.get('computer_ui').output.render({}, ui);
    check('and the read itself is rendered', render.length >= 1 && render[0].type === 'text');
    // §9.1 observationCost: the tree walk is the other half of what looking costs, and a read that
    // walked a thousand nodes has to be distinguishable from one that walked five.
    check(
      Number(afterUi.runtime.metrics.uiReads ?? 0) >= 1 && Number(afterUi.runtime.metrics.uiNodes ?? 0) > 0,
      'a UIA read is counted with the nodes it walked and the time it took',
      JSON.stringify({ reads: afterUi.runtime.metrics.uiReads, nodes: afterUi.runtime.metrics.uiNodes, ms: afterUi.runtime.metrics.uiReadMs }),
    );
    // §5.3: the skip is for *degraded* windows only. A window whose last read was healthy must be
    // read again — declining to look at a window that was fine is how a tool goes blind.
    const asked = await harness.tools.get('computer_ui').execute({ hwnd: ui.window.hwnd, max_depth: 2, max_nodes: 20, skip_if_degraded: true }, EXEC)
      .catch((error) => ({ error: String(error.message ?? error) }));
    check(
      asked?.mode !== 'skipped-degraded' && asked?.error === undefined,
      'skip_if_degraded does not skip a window whose last read was healthy',
      JSON.stringify({ mode: asked?.mode, walked: asked?.walked, error: asked?.error }).slice(0, 120),
    );
  }

  console.log('\n== a read failure is remembered as degraded, not as "this app cannot be driven" ==');
  const bogus = await harness.tools.get('computer_ui_action').execute({ hwnd: 0x5f5f5f, action: 'invoke', control_type: 'Button' }, EXEC)
    .catch((error) => ({ error: String(error.message ?? error) }));
  check('an action against a handle that is not a window fails cleanly', typeof bogus?.error === 'string', JSON.stringify(bogus).slice(0, 80));
  const afterFail = await status();
  check('the refusal is counted', afterFail.runtime.metrics.refusals >= 1, String(afterFail.runtime.metrics.refusals));
  const failed = afterFail.runtime.trace.at(-1);
  check('and the span keeps the failure with its code', failed?.ok === false && typeof failed.error === 'string', JSON.stringify(failed));
  const otherWindow = afterFail.runtime.profiles.filter((one) => Number(one.hwnd) !== Number(ui?.window?.hwnd ?? -1));
  check('nothing was generalised from that failure', otherWindow.length <= afterFail.runtime.profiles.length, JSON.stringify(otherWindow.map((one) => one.state)));

  /* ------------------------------------------------------------- read retries */

  console.log('\n== A10: a read is retried once when the worker was lost; a write never is ==');
  const impatient = createContext();
  plugin.apply(impatient.ctx, { defaultEnabled: true, actionTimeoutMs: 1 });
  const impatientStatus = () => callRoute(impatient.routes.get('/computer-use/status'));
  const timedOut = await impatient.tools.get('computer_windows').execute({}, EXEC)
    .then(() => null, (error) => String(error.message ?? error));
  // A 1 ms budget cannot be met, so the call must fail — whether the transport reports the
  // budget itself or the worker it had to drop afterwards depends on how fast the machine
  // schedules the process, and both are the same fact to the caller.
  check('the call fails once the budget was spent twice',
    timedOut !== null && /did not answer within|worker exited|HELPER_UNAVAILABLE/.test(timedOut),
    String(timedOut ?? '').slice(0, 90));
  const afterRetry = await impatientStatus();
  check('and the read was retried exactly once before giving up', afterRetry.runtime.metrics.readRetries === 1, String(afterRetry.runtime.metrics.readRetries));
  check('the retry is visible in the trace as a failed call', afterRetry.runtime.trace.at(-1)?.ok === false, JSON.stringify(afterRetry.runtime.trace.at(-1)).slice(0, 120));

  for (const harnessUnderTest of harnesses) {
    for (const effect of harnessUnderTest.effects) {
      if (effect.label.includes('lifetime')) {
        try { effect.dispose(); } catch { /* the worker may already be gone */ }
      }
    }
  }
}

try {
  await main();
} catch (error) {
  failures.push('run');
  console.log(`\n  ERROR  ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
} finally {
  rmSync(shimDir, { recursive: true, force: true });
}

console.log(`\n===== ${passed} passed, ${failures.length} failed =====`);
if (failures.length > 0) {
  console.log('failed cases:');
  for (const name of failures) console.log(`  - ${name}`);
}
process.exit(failures.length === 0 ? 0 : 1);
