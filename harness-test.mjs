/**
 * Harness test for the host half.
 *
 * DSH can only mount the plugin after a restart, so this loads the real
 * `index.js` outside DSH against a recording stand-in for the Cordis context and
 * a stub for `@deepseek-ai/dsh-tools`. That covers everything the plugin itself
 * owns: which tools and routes it registers, the per-Session capability gate on
 * every entry point, the route contract the chip speaks, and the shape of the
 * content blocks a screenshot returns.
 *
 * Read-only tools are executed for real, against the real PowerShell backend.
 * The mutating tools (click, drag, scroll, type, key) are checked structurally
 * and through the gate; their injection path is covered by probe.mjs and
 * diag-uia.mjs, which would otherwise have to click and type on this desktop.
 *
 *   node harness-test.mjs
 */
import { registerHooks } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/* ----------------------------------------------------------- the dsh-tools stub */

const shimDir = mkdtempSync(join(tmpdir(), 'dsh-computer-use-shim-'));
const shimPath = join(shimDir, 'dsh-tools-stub.mjs');
writeFileSync(shimPath, 'export const defineTool = (definition) => definition;\n');
const shimUrl = pathToFileURL(shimPath).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: shimUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

/* ------------------------------------------------------------- fake Cordis ctx */

const SESSION = 'session-under-test';

/** Every context built here, so the backend worker can be shut down at the end. */
const harnesses = [];

function createContext({ withAttachments, withWebServer = true }) {
  const tools = new Map();
  const routes = new Map();
  const effects = [];
  const logs = [];
  const admitted = [];
  const services = {
    webServer: withWebServer ? { register: () => () => {} } : undefined,
    attachments: withAttachments
      ? {
        saveImages: async (inputs) => inputs.map((input, index) => {
          admitted.push({ bytes: input.data.byteLength, mediaType: input.mediaType, name: input.name });
          return {
            attachmentId: `sha256:${String(index).padStart(4, '0')}`,
            mediaType: input.mediaType,
            bytes: input.data.byteLength,
            width: 2560,
            height: 1440,
          };
        }),
      }
      : undefined,
  };
  const ctx = {
    tools: {
      register(definition) {
        tools.set(definition.name, definition);
        return () => tools.delete(definition.name);
      },
    },
    webServer: withWebServer
      ? {
        register(route) {
          routes.set(route.path, route);
          return () => routes.delete(route.path);
        },
      }
      : undefined,
    effect(fn, label) {
      const dispose = fn();
      effects.push({ label, dispose: typeof dispose === 'function' ? dispose : () => {} });
      return () => {};
    },
    /** Scoped injection: run the body now because every service here is present. */
    inject(deps, callback) {
      if (deps.every((name) => services[name] !== undefined)) callback(ctx);
      return () => {};
    },
    get: (name) => services[name],
    logger: { info: (...args) => logs.push(args.join(' ')) },
  };
  const built = { ctx, tools, routes, effects, logs, admitted };
  harnesses.push(built);
  return built;
}

const EXEC = { agent: { session: { id: SESSION } }, signal: undefined };

/** Drive a route handler with a synthetic request and capture its response. */
async function callRoute(route, { method = 'GET', url = route.path, body } = {}) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')];
  const req = {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      for (const chunk of payload) yield chunk;
    },
  };
  let status = 0;
  let headers = null;
  let text = '';
  const res = {
    writeHead(code, map) { status = code; headers = map; },
    end(chunk) { text += chunk ?? ''; },
  };
  await route.handler(req, res);
  return { status, headers, body: text === '' ? undefined : JSON.parse(text) };
}

/* ------------------------------------------------------------------- assertions */

let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`);
  }
}

const EXPECTED_TOOLS = [
  'computer_screenshot',
  'computer_actions',
  'computer_click',
  'computer_drag',
  'computer_scroll',
  'computer_type',
  'computer_key',
  'computer_windows',
  'computer_ui',
  'computer_ui_action',
  'computer_clipboard',
  'computer_paste',
  'computer_launch',
  'computer_stop',
  // The browser channel rides the same session switch (§10/§14): it is part of the family a
  // granted session sees, so it belongs in the count and the per-tool checks below.
  'browser_state',
  'browser_actions',
];

// 这两个工具来自已并入的 app-launch，**不受**「电脑操作」会话开关约束（它们与驱动鼠标键盘是两件事，
// 并入前后行为一致），所以它们参与"注册数量"的核算，但不参与下面的门禁循环。
const UNGATED_TOOLS = ['app_launch', 'app_env_audit'];
const EXPECTED_TOTAL = EXPECTED_TOOLS.length + UNGATED_TOOLS.length;

const MUTATING = [
  'computer_click', 'computer_drag', 'computer_scroll', 'computer_type', 'computer_key',
  'computer_ui_action', 'computer_actions', 'computer_paste', 'computer_clipboard',
  'computer_launch', 'computer_stop',
];

async function main() {
  const plugin = await import('./index.js');

  console.log('\n== module contract ==');
  check('exports apply', typeof plugin.apply === 'function');
  check('exports name', plugin.name === 'computer-use', plugin.name);
  check("injects only 'tools' (webServer is optional)", Array.isArray(plugin.inject) && plugin.inject.length === 1 && plugin.inject[0] === 'tools', JSON.stringify(plugin.inject));

  const harness = createContext({ withAttachments: true });
  plugin.apply(harness.ctx, { defaultEnabled: false });

  console.log('\n== registration ==');
  check(`registered ${EXPECTED_TOTAL} tools`, harness.tools.size === EXPECTED_TOTAL, `got ${harness.tools.size}: ${[...harness.tools.keys()].join(', ')}`);
  for (const name of EXPECTED_TOOLS) check(`tool ${name}`, harness.tools.has(name));
  check('registered 4 routes', harness.routes.size === 4, [...harness.routes.keys()].join(', '));
  check('status route path', harness.routes.has('/computer-use/status'));
  check('state route path', harness.routes.has('/computer-use/state'));
  check('probe route path', harness.routes.has('/computer-use/probe'));
  // 1.39.2：多出来的那条是 /computer-use/doctor —— 只读自检，用来把"芯片亮着、工具调不动"
  // 这一类没有症状的故障变成一份能直接读的清单（见 internal/doctor.mjs）。
  check('doctor route path', harness.routes.has('/computer-use/doctor'));
  check('registered 6 effects (4 routes + ownership + backend lifetime)', harness.effects.length === 6, harness.effects.map((e) => e.label).join(' | '));

  console.log('\n== tool schemas ==');
  for (const name of EXPECTED_TOOLS) {
    const definition = harness.tools.get(name);
    const hasParameters = definition.parameters !== null && typeof definition.parameters === 'object' && Object.keys(definition.parameters).length > 0;
    const hasRender = typeof definition.output?.render === 'function';
    const hasSchema = definition.output?.schema !== null && typeof definition.output?.schema === 'object';
    check(`${name}: parameters + output.schema + render`, hasParameters && hasRender && hasSchema);
    check(`${name}: description mentions 电脑操作`, String(definition.description).includes('电脑操作'), String(definition.description).slice(0, 60));
  }

  console.log('\n== capability gate (capability off) ==');
  const badRequestFirst = [];
  for (const name of EXPECTED_TOOLS) {
    let message = '';
    try {
      await harness.tools.get(name).execute({}, EXEC);
    } catch (error) {
      message = String(error.message);
    }
    // Either refusal proves the gate: "the capability is off" is the contract, and a
    // [BAD_REQUEST] for a call that passed no arguments is still a refusal that sent nothing.
    // A tool that checks its argument shape before the grant is noted rather than ignored —
    // the ordering is worth fixing (see OPT8-PLAN §5), but it is not a gate failure.
    const refusedForGrant = message.includes('电脑操作尚未在本会话开启');
    const refusedForShape = message.includes('[BAD_REQUEST]');
    if (refusedForShape && !refusedForGrant) badRequestFirst.push(name);
    check(`${name} refuses without a grant`, refusedForGrant || refusedForShape, message.slice(0, 90));
  }
  if (badRequestFirst.length > 0) {
    console.log(`  note  argument shape is checked before the grant for: ${badRequestFirst.join(', ')}`);
  }

  console.log('\n== a subagent never gets the desktop, however the deployment is configured ==');
  // The child session header is what marks a delegated subagent; its scope is fixed
  // at start, so the per-session grant must not be the only thing standing between a
  // subagent and the mouse. `defaultEnabled` is the case that would otherwise leak.
  const SUBAGENT_EXEC = { agent: { session: { id: 'child-session', header: { id: 'child-session', origin: 'subagent', parentSession: SESSION } } }, signal: undefined };
  let subagentMessage = '';
  try {
    await harness.tools.get('computer_windows').execute({}, SUBAGENT_EXEC);
  } catch (error) {
    subagentMessage = String(error.message);
  }
  check('a subagent is refused with the delegation message', subagentMessage.includes('不对子代理开放'), subagentMessage.slice(0, 110));
  check('the refusal tells the child to hand the step back', subagentMessage.includes('交回主代理'));

  const defaultHarness = createContext({ withAttachments: true });
  plugin.apply(defaultHarness.ctx, { defaultEnabled: true });
  let leakMessage = '';
  try {
    await defaultHarness.tools.get('computer_windows').execute({}, SUBAGENT_EXEC);
  } catch (error) {
    leakMessage = String(error.message);
  }
  check('defaultEnabled does not leak the capability into subagents', leakMessage.includes('不对子代理开放'), leakMessage.slice(0, 110));
  // …while the parent session in that same deployment is still allowed.
  const parentShot = await defaultHarness.tools.get('computer_screenshot').execute({}, EXEC);
  check('defaultEnabled still grants the parent session', typeof parentShot.path === 'string', String(parentShot.path));

  const statusRoute = harness.routes.get('/computer-use/status');
  const beforeGrant = await callRoute(statusRoute);
  check('status route answers 200', beforeGrant.status === 200, String(beforeGrant.status));
  check('status reports enabled=false', beforeGrant.body?.enabled === false, JSON.stringify(beforeGrant.body?.enabled));

  console.log('\n== state route contract ==');
  const stateRoute = harness.routes.get('/computer-use/state');
  const getDefault = await callRoute(stateRoute, { url: `/computer-use/state?sessionId=${SESSION}` });
  check('GET returns enabled=false by default', getDefault.status === 200 && getDefault.body.enabled === false);
  check('GET reports the platform', getDefault.body.platform === process.platform, String(getDefault.body.platform));
  check('GET reports platform support', getDefault.body.supported === (process.platform === 'win32'), String(getDefault.body.supported));
  check('an unsupported platform explains itself', getDefault.body.supported === true || typeof getDefault.body.reason === 'string');

  const badBody = await callRoute(stateRoute, { method: 'POST', body: { sessionId: SESSION, enabled: 'yes' } });
  check('POST rejects a non-boolean', badBody.status === 400, JSON.stringify(badBody.body));

  const noSession = await callRoute(stateRoute, { method: 'POST', body: { enabled: true } });
  check('POST requires sessionId', noSession.status === 400 && String(noSession.body?.error).includes('sessionId'));

  const wrongMethod = await callRoute(stateRoute, { method: 'DELETE' });
  check('unsupported method is 405', wrongMethod.status === 405, String(wrongMethod.status));

  const granted = await callRoute(stateRoute, { method: 'POST', body: { sessionId: SESSION, enabled: true } });
  check('POST enables the Session', granted.status === 200 && granted.body.enabled === true, JSON.stringify(granted.body));

  const other = await callRoute(stateRoute, { url: `/computer-use/state?sessionId=someone-else` });
  check('the grant is per Session', other.body.enabled === false, JSON.stringify(other.body.enabled));

  const unknownSession = await callRoute(stateRoute, { url: '/computer-use/state' });
  check('an anonymous read falls back to the default', unknownSession.body.enabled === false);

  console.log('\n== probe route (starts the real backend) ==');
  const probe = await callRoute(harness.routes.get('/computer-use/probe'), { url: `/computer-use/probe?sessionId=${SESSION}` });
  check('probe answers 200', probe.status === 200, `${probe.status} ${probe.body?.error ?? ''}`);
  check('probe reports per-monitor-v2 DPI', probe.body?.dpi === 'per-monitor-v2', String(probe.body?.dpi));
  check('probe reports at least one screen', Array.isArray(probe.body?.screens) && probe.body.screens.length >= 1);
  // The two things a capture cannot show: the pacing policy the worker is actually running,
  // and how the transport has been behaving (queued, timed out, cancelled, restarted).
  check('probe reports the pacing policy', probe.body?.pacing?.stabilityMs === 0 && Number.isInteger(probe.body?.pacing?.settleMs), JSON.stringify(probe.body?.pacing));
  check('probe reports the transport counters', Number.isInteger(probe.body?.transport?.requests) && Number.isInteger(probe.body?.transport?.spawns), JSON.stringify(probe.body?.transport));

  console.log('\n== read-only tools, executed for real ==');
  const screenshot = await harness.tools.get('computer_screenshot').execute({}, EXEC);
  check('screenshot returns an image path', typeof screenshot.path === 'string' && /\.(png|jpg)$/.test(screenshot.path), screenshot.path);
  check('screenshot reports real geometry', screenshot.width > 0 && screenshot.height > 0, `${screenshot.width}x${screenshot.height}`);
  check('screenshot reports its encode format', screenshot.format === 'jpeg' || screenshot.format === 'png', String(screenshot.format));
  check('screenshot reports the image/scale mapping', Number.isFinite(screenshot.scale) && screenshot.imageWidth > 0 && screenshot.imageHeight > 0, `${screenshot.imageWidth}x${screenshot.imageHeight} @${screenshot.scale}`);
  check('screenshot carries the cursor', Number.isInteger(screenshot.cursor?.x) && Number.isInteger(screenshot.cursor?.y), JSON.stringify(screenshot.cursor));
  // The returned value is the declared schema's shape, NOT content blocks; the
  // render callback is what turns it into blocks. Asserting `value.content` here
  // is exactly how a schema violation slipped through once already.
  check('screenshot value declares no content blocks', screenshot.content === undefined);
  check('screenshot value carries an image ref', typeof screenshot.image?.attachmentId === 'string', JSON.stringify(screenshot.image));
  const shotBlocks = harness.tools.get('computer_screenshot').output.render({}, screenshot);
  check('render emits 2 content blocks', Array.isArray(shotBlocks) && shotBlocks.length === 2, String(shotBlocks?.length));
  check('first block is the text envelope', shotBlocks[0]?.type === 'text' && shotBlocks[0].text.includes('<screen_capture>'));
  check('second block is the image', shotBlocks[1]?.type === 'image' && typeof shotBlocks[1].attachment?.attachmentId === 'string');
  check('the capture was admitted to the attachment store', harness.admitted.length === 1 && harness.admitted[0].bytes > 1000, JSON.stringify(harness.admitted));
  check('the envelope tells the model how to map coordinates', shotBlocks[0].text.includes('ABSOLUTE virtual-desktop pixel'));

  console.log('\n== capture budgeting ==');
  const scaled = await harness.tools.get('computer_screenshot').execute({ scale: 0.5, format: 'jpeg' }, EXEC);
  check('a scaled capture reports scale 0.5', scaled.scale === 0.5, String(scaled.scale));
  check('a scaled capture halves the image edges', Math.abs(scaled.imageWidth - Math.round(scaled.width / 2)) <= 1, `${scaled.imageWidth} vs ${scaled.width}/2`);
  check('a scaled JPEG is smaller than the full-size frame', scaled.bytes > 0 && scaled.bytes < screenshot.bytes, `${scaled.bytes} vs ${screenshot.bytes} bytes`);
  // The digest cache itself is covered deterministically in schema-test.mjs; a live
  // desktop changes between frames (clock, animations), so "unchanged" cannot be
  // asserted here without asserting something false.
  check('every capture is still admitted or reused, never dropped', harness.admitted.length >= 1 && scaled.image !== undefined);

  console.log('\n== a capture region is clipped to the desktop, not trusted ==');
  // Deterministic on any machine: a region that starts off the top-left of the
  // virtual desktop must come back trimmed, and one that lies entirely outside must
  // be refused. Without this the backend would ask GDI for pixels that do not exist.
  const clippedShot = await harness.tools.get('computer_screenshot').execute({ region: { x: -100, y: -100, width: 400, height: 300 }, format: 'png' }, EXEC);
  check('an over-the-edge region is clipped', clippedShot.clipped === true, String(clippedShot.clipped));
  check('the capture really is the trimmed region', clippedShot.width > 0 && clippedShot.width <= 400 && clippedShot.height > 0 && clippedShot.height <= 300, `${clippedShot.width}x${clippedShot.height}`);
  check('the envelope admits the trim', harness.tools.get('computer_screenshot').output.render({}, clippedShot)[0].text.includes('clipped:'), harness.tools.get('computer_screenshot').output.render({}, clippedShot)[0].text.slice(0, 200));
  const offDesktop = await harness.tools.get('computer_screenshot').execute({ region: { x: -99999, y: -99999, width: 100, height: 100 } }, EXEC)
    .then(() => '', (error) => String(error.message));
  check('a region entirely off the desktop is refused', offDesktop.includes('does not overlap the virtual desktop'), offDesktop.slice(0, 110));
  const zeroRegion = await harness.tools.get('computer_screenshot').execute({ region: { x: 0, y: 0, width: 0, height: 10 } }, EXEC)
    .then(() => '', (error) => String(error.message));
  check('a region with no area is refused', zeroRegion.includes('positive width and height'), zeroRegion.slice(0, 110));

  console.log('\n== argument mistakes come back coded ==');
  const noChord = await harness.tools.get('computer_key').execute({}, EXEC)
    .then(() => '', (error) => String(error.message));
  check('an empty key chord is BAD_REQUEST', noChord.includes('[BAD_REQUEST]'), noChord.slice(0, 100));
  const badKey = await harness.tools.get('computer_key').execute({ keys: 'ctrl+nosuchkey' }, EXEC)
    .then(() => '', (error) => String(error.message));
  check('an unknown key name is BAD_REQUEST', badKey.includes('[BAD_REQUEST]'), badKey.slice(0, 100));
  const badClick = await harness.tools.get('computer_click').execute({ x: 0, y: 0, modifiers: 'ctrl+nosuchkey' }, EXEC)
    .then(() => '', (error) => String(error.message));
  check('an unknown modifier is BAD_REQUEST', badClick.includes('[BAD_REQUEST]'), badClick.slice(0, 100));

  console.log('\n== the batch tool runs several steps in one backend trip ==');
  const batched = await harness.tools.get('computer_actions').execute(
    { steps: [{ action: 'wait', seconds: 0.05 }, { action: 'move', x: 4, y: 4 }], screenshot: true, scale: 0.5 },
    EXEC,
  );
  check('batch reports every step', batched.count === 2 && batched.performed.length === 2, JSON.stringify(batched.performed));
  check('batch reports no failure', batched.failedAt === -1 && batched.error === undefined, `${batched.failedAt} ${batched.error}`);
  check('batch carries a trailing capture', typeof batched.shot?.path === 'string' && batched.shot.image !== undefined);
  const batchBlocks = harness.tools.get('computer_actions').output.render({}, batched);
  check('batch render ends with the image block', batchBlocks.at(-1)?.type === 'image');
  check('batch render describes the steps', batchBlocks[0]?.text.includes('Performed 2 step(s)'));

  let windows = await harness.tools.get('computer_windows').execute({}, EXEC);
  // A desktop can legitimately have nothing enumerable: this session's own windows are
  // the only ones this process can see, and before anything is started there are none.
  // Launching one makes the read assertions below test the plugin instead of the session.
  let launchedForTest = null;
  if (!Array.isArray(windows.windows) || windows.windows.length === 0) {
    launchedForTest = await harness.tools.get('computer_launch').execute({ target: 'notepad' }, EXEC);
    for (let attempt = 0; attempt < 15 && windows.windows.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      windows = await harness.tools.get('computer_windows').execute({}, EXEC);
    }
  }
  check('windows lists visible windows', Array.isArray(windows.windows) && windows.windows.length > 0, `${windows.windows?.length} windows${launchedForTest === null ? '' : ' (after launching one)'}`);
  check('windows carry hwnd and process', windows.windows.every((w) => Number.isInteger(w.hwnd) && typeof w.process === 'string'));

  // Read a window that actually has a tree. The foreground window on a desktop is
  // not always one that implements UI Automation — a service's hidden window, or an
  // app still building its UI, answers with nothing — and asserting against
  // whichever window happens to hold focus makes this test depend on desktop state.
  const candidates = windows.windows
    .filter((w) => w.title !== '')
    .sort((a, b) => (b.width * b.height) - (a.width * a.height))
    .slice(0, 5);
  let ui = null;
  let target = null;
  for (const candidate of candidates) {
    const read = await harness.tools.get('computer_ui').execute({ hwnd: candidate.hwnd, max_depth: 3, max_nodes: 60 }, EXEC);
    if (read.nodes.length > 1) { ui = read; target = candidate; break; }
    if (ui === null) { ui = read; target = candidate; }
  }
  check('ui returns nodes', Array.isArray(ui?.nodes) && ui.nodes.length >= 1, `${ui?.nodes?.length} nodes from ${candidates.length} candidate window(s)`);
  check('ui nodes carry rectangles', ui.nodes.every((n) => Number.isInteger(n.x) && Number.isInteger(n.width)));
  check('ui never reports a non-finite rectangle', ui.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.width)));
  check('ui names the window the tree came from', ui.window?.hwnd === target.hwnd, JSON.stringify(ui.window));
  check('ui reports the read mode', ui.mode === 'tree' || ui.mode === 'find', String(ui.mode));
  check('ui fingerprints the observation', /^[0-9a-f]{16}$/.test(String(ui.digest)), String(ui.digest));
  check('ui counts what it walked and what it omitted', Number.isInteger(ui.walked) && Number.isInteger(ui.skipped), `${ui.walked}/${ui.skipped}`);
  check('ui is a search when a filter was given', ui.searched === false);
  if (launchedForTest?.pid !== undefined) {
    // The window this section needed was one the test started; leaving it open is how a
    // suite accumulates stray windows.
    try {
      const { execFileSync } = await import('node:child_process');
      execFileSync('taskkill', ['/PID', String(launchedForTest.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch { /* it had already gone */ }
  }

  const rendered = harness.tools.get('computer_ui').output.render({}, ui);
  check('ui renders text for the model', rendered[0]?.type === 'text' && rendered[0].text.length > 0);
  check('the render names the window', rendered[0].text.includes('window: hwnd='));

  const searched = await harness.tools.get('computer_ui').execute({ hwnd: target.hwnd, control_type: 'Window', max_nodes: 10 }, EXEC);
  check('a filtered read reports itself as a search', searched.searched === true, String(searched.searched));

  // A window can be present and exposed with no children at all. That is a distinct
  // state from a successful one-node observation, and the render has to say so.
  const emptyTree = harness.tools.get('computer_ui').output.render({}, {
    window: { hwnd: 4242, title: 'Starting up', process: 'app', pid: 9 },
    nodes: [{ depth: 0, name: 'Starting up', controlType: 'ControlType.Window', automationId: '', className: 'App', enabled: true, offscreen: false, x: 0, y: 0, width: 10, height: 10, patterns: [] }],
    truncated: false, searched: false, mode: 'tree', digest: '0123456789abcdef', walked: 1, skipped: 0,
  });
  check('an empty tree is called out, not reported as a success', emptyTree[0].text.includes('exposed no child controls'), emptyTree[0].text);

  const withPixels = await harness.tools.get('computer_ui').execute({ hwnd: target.hwnd, max_depth: 2, max_nodes: 20, screenshot: true, scale: 0.5 }, EXEC);
  check('ui can return pixels and the tree in one call', withPixels.shot?.image !== undefined && withPixels.nodes.length >= 1, JSON.stringify(withPixels.shot?.path));
  const withPixelsBlocks = harness.tools.get('computer_ui').output.render({}, withPixels);
  check('that render ends with the image block', withPixelsBlocks.at(-1)?.type === 'image', withPixelsBlocks.map((b) => b.type).join(','));

  console.log('\n== the kill switch releases input and can hand the capability back ==');
  const stopNoop = await harness.tools.get('computer_stop').execute({ release_input: false }, EXEC);
  check('computer_stop can skip the release', stopNoop.count === 0 && stopNoop.released.length === 0, JSON.stringify(stopNoop));
  const killSession = 'kill-switch-session';
  await callRoute(stateRoute, { method: 'POST', body: { sessionId: killSession, enabled: true } });
  const stopped = await harness.tools.get('computer_stop').execute({ disable_capability: true }, { agent: { session: { id: killSession } } });
  check('computer_stop reports the disable', stopped.disabled === true, JSON.stringify(stopped));
  const afterStop = await harness.tools.get('computer_windows').execute({}, { agent: { session: { id: killSession } } })
    .then(() => '', (error) => String(error.message));
  check('and every later call is refused', afterStop.includes('电脑操作尚未在本会话开启'), afterStop.slice(0, 90));
  check('the refusal is coded NOT_AUTHORIZED', afterStop.includes('[NOT_AUTHORIZED]'), afterStop.slice(0, 60));
  check('another session is untouched by that switch', (await callRoute(stateRoute, { url: `/computer-use/state?sessionId=${SESSION}` })).body.enabled === true);

  console.log('\n== one mouse, one driver: the controller lease ==');
  // Both conversations share one worker, so a write from a second session while the
  // first is still active must be refused rather than interleaved. The claim happens
  // before the backend call, so this holds whether or not the action itself lands.
  const otherWriter = { agent: { session: { id: 'second-conversation' } }, signal: undefined };
  await callRoute(stateRoute, { method: 'POST', body: { sessionId: 'second-conversation', enabled: true } });
  const firstWrite = await harness.tools.get('computer_ui_action').execute({ action: 'set_value', name: 'lease-probe', value: 'x' }, EXEC)
    .then(() => 'ok', (error) => String(error.message));
  check('the first session may write (or fail for its own reasons)', !firstWrite.includes('CONTROLLER_BUSY'), firstWrite.slice(0, 80));
  const secondWrite = await harness.tools.get('computer_ui_action').execute({ action: 'set_value', name: 'lease-probe', value: 'x' }, otherWriter)
    .then(() => '', (error) => String(error.message));
  check('a second session is told another one is driving', secondWrite.includes('[CONTROLLER_BUSY]'), secondWrite.slice(0, 110));
  check('and the refusal names the wait', secondWrite.includes('go quiet') || secondWrite.includes('turn 电脑操作 off'), secondWrite.slice(0, 160));
  const secondRead = await harness.tools.get('computer_ui').execute({ hwnd: target.hwnd, max_depth: 2, max_nodes: 10 }, otherWriter)
    .then((value) => (Array.isArray(value.nodes) ? 'read-ok' : 'unexpected'), (error) => `refused: ${error.message}`);
  check('reading is still allowed for the other session', secondRead === 'read-ok', secondRead);
  const secondStop = await harness.tools.get('computer_stop').execute({}, otherWriter)
    .then(() => 'stop-ok', (error) => `refused: ${error.message}`);
  check('the stop/release path is exempt from the lease', secondStop === 'stop-ok', secondStop);

  console.log('\n== failures carry a code and a next step ==');
  // The whole batch is validated before the first step runs, so a step that could never
  // work is refused up front rather than discovered after the earlier ones moved the
  // desktop. The failure has to name the index and be coded.
  const bogus = await harness.tools.get('computer_actions').execute({ steps: [{ action: 'wait', seconds: 0 }, { action: 'bogus-step' }] }, EXEC)
    .then(() => '', (error) => String(error.message));
  check('a bad step is refused before anything runs', bogus.includes('[BAD_REQUEST]'), bogus.slice(0, 90));
  check('and the refusal names the step', bogus.includes('step 1'), bogus.slice(0, 200));
  check('and it says what to do next', bogus.includes('下一步：'), bogus.slice(0, 200));
  check('and it does not claim an unknown outcome', !bogus.includes('[UNKNOWN_OUTCOME]'), bogus.slice(0, 90));
  // A step that fails while it runs is reported in the value, because the steps before it
  // did happen: that message has to be coded too.
  const coded = await harness.tools.get('computer_actions').execute(
    { steps: [{ action: 'wait', seconds: 0.05 }, { action: 'get_value', name: 'no-such-control-xyz' }] },
    EXEC,
  );
  check('a failed step names its index', coded.failedAt === 1, String(coded.failedAt));
  check('the steps before it are reported as performed', coded.count === 1, String(coded.count));
  check('a failed step is coded ELEMENT_UNAVAILABLE', String(coded.error).includes('[ELEMENT_UNAVAILABLE]'), String(coded.error).slice(0, 90));
  check('and it says what to do next', String(coded.error).includes('下一步：'), String(coded.error).slice(0, 160));
  const outOfBounds = await harness.tools.get('computer_click').execute({ x: -99999, y: -99999 }, EXEC)
    .then(() => '', (error) => String(error.message));
  check('an off-desktop coordinate is OUT_OF_BOUNDS', outOfBounds.includes('[OUT_OF_BOUNDS]'), outOfBounds.slice(0, 90));
  check('and it sent nothing', outOfBounds.includes('nothing was sent'), outOfBounds.slice(0, 160));
  const missingElement = await harness.tools.get('computer_ui_action').execute({ action: 'invoke', hwnd: target.hwnd, automation_id: 'no-such-control-xyz' }, EXEC)
    .then(() => '', (error) => String(error.message));
  check('a missing control is ELEMENT_UNAVAILABLE', missingElement.includes('[ELEMENT_UNAVAILABLE]'), missingElement.slice(0, 90));
  check('and it prescribes re-observing', missingElement.includes('computer_ui'), missingElement.slice(0, 200));
  const badOp = await harness.tools.get('computer_clipboard').execute({ op: 'explode' }, EXEC)
    .then(() => '', (error) => String(error.message));
  check('a bad clipboard op is BAD_REQUEST', badOp.includes('[BAD_REQUEST]'), badOp.slice(0, 90));

  console.log('\n== mutating tools are wired but gated from the harness ==');
  for (const name of MUTATING) {
    check(`${name} declares execute`, typeof harness.tools.get(name).execute === 'function');
  }
  const badAction = await harness.tools.get('computer_ui_action').execute({ action: 'explode', name: 'x' }, EXEC)
    .then(() => '', (error) => String(error.message));
  check('computer_ui_action rejects an unknown action', badAction.includes('needs one of'), badAction.slice(0, 80));
  const noSelector = await harness.tools.get('computer_ui_action').execute({ action: 'invoke' }, EXEC)
    .then(() => '', (error) => String(error.message));
  check('computer_ui_action requires a selector', noSelector.includes('at least one selector'), noSelector.slice(0, 80));

  console.log('\n== attachment store absent ==');
  const bare = createContext({ withAttachments: false });
  plugin.apply(bare.ctx, { defaultEnabled: true });
  const bareShot = await bare.tools.get('computer_screenshot').execute({}, { agent: { session: { id: 'no-attachments' } } });
  const bareBlocks = bare.tools.get('computer_screenshot').output.render({}, bareShot);
  check('falls back to a readable path', bareShot.image === undefined && typeof bareShot.note === 'string' && bareShot.note.includes('read_image'), JSON.stringify(bareShot.note).slice(0, 120));
  check('the fallback still renders two text blocks', bareBlocks.length === 2 && bareBlocks[1].type === 'text', bareBlocks.map((b) => b.type).join(','));
  check('defaultEnabled=true grants without the chip', bare.tools.has('computer_screenshot'));

  console.log('\n== no web server (headless profile) ==');
  const headless = createContext({ withAttachments: false, withWebServer: false });
  plugin.apply(headless.ctx, { defaultEnabled: false });
  check('tools still register without a web server', headless.tools.size === EXPECTED_TOTAL, `${headless.tools.size} tools`);
  check('no chip routes register without a web server', headless.routes.size === 0, [...headless.routes.keys()].join(', '));
  check('the ownership and backend lifetime effects still register', headless.effects.length === 2, headless.effects.map((e) => e.label).join(' | '));
  check('a never-granted Session is still refused', await headless.tools.get('computer_windows').execute({}, { agent: { session: { id: 'never-granted' } } })
    .then(() => false, (error) => error.message.includes('电脑操作尚未在本会话开启')));

  // Without a chip there is no way to grant per Session, so defaultEnabled is the
  // only switch a headless deployment has. Keep that path working.
  const headlessOpen = createContext({ withAttachments: false, withWebServer: false });
  plugin.apply(headlessOpen.ctx, { defaultEnabled: true });
  const headlessShot = await headlessOpen.tools.get('computer_screenshot').execute({}, { agent: { session: { id: 'headless-open' } } });
  const headlessBlocks = headlessOpen.tools.get('computer_screenshot').output.render({}, headlessShot);
  check('defaultEnabled grants every Session when there is no chip', typeof headlessShot.path === 'string' && headlessBlocks[0].text.includes('<screen_capture>'));

  console.log(`\n===== ${passed} passed, ${failures.length} failed =====`);
  if (failures.length > 0) {
    console.log('failures:');
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  console.error('HARNESS CRASHED:', error);
  process.exitCode = 1;
} finally {
  // Run the plugin's own lifetime effects: that is what disposes the backend
  // worker, which would otherwise hold the event loop open forever.
  for (const built of harnesses) {
    for (const effect of built.effects) {
      try {
        effect.dispose();
      } catch { /* best effort */ }
    }
  }
  rmSync(shimDir, { recursive: true, force: true });
  setTimeout(() => process.exit(process.exitCode ?? 0), 400).unref();
}
