/**
 * C1 (8.txt §10–§11) against a real browser: discovery, tabs, a bounded accessibility read,
 * the text read, and every way the channel is allowed to refuse.
 *
 * The fixture is a headless Edge the test starts itself on a temporary profile, with a page
 * whose elements are known, so nothing here depends on the user's own browser — the plugin
 * never launches or scans for one in this phase, and the endpoint is passed in by config.
 *
 * What it checks:
 *   - the endpoint is discovered over loopback (`/json/version`) and the WebSocket address the
 *     browser reports is verified to be loopback too;
 *   - `view: tabs` lists the open pages without opening a socket;
 *   - `view: ax` returns the same node shape the desktop reader uses, with a `ref` per node,
 *     `collected` kept apart from `returned`, and the node budget enforced;
 *   - `view: text` is cut inside the page, and reports the total it did not send;
 *   - the budgets clamp to their §11 caps;
 *   - a non-loopback endpoint, an unreachable one, and a missing one are each refused with
 *     their own status instead of a hang;
 *   - `browser: false` in the configuration does not register the tool at all.
 *
 *   node browser-state-test.mjs
 */
import { registerHooks } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { discoverEndpoint } from './browser/connection.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-browser-'));
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

const plugin = await import('./index.js');

/** Mount the plugin once with a given configuration, and hand back its tools. */
function mount(configuration) {
  const tools = new Map();
  const listeners = new Map();
  const services = { webServer: { register: () => () => {} } };
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
    webServer: services.webServer,
    on: (event, handler) => { const list = listeners.get(event) ?? []; list.push(handler); listeners.set(event, list); },
    effect: (fn) => { const disposer = fn(); return () => { if (typeof disposer === 'function') disposer(); }; },
    inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx); return () => {}; },
    get: (name) => services[name],
    logger: { info: () => {}, warn: () => {} },
  };
  plugin.apply(ctx, { defaultEnabled: true, ...configuration });
  const exec = { agent: { session: { id: 'browser-state-session' } }, signal: undefined };
  return { tools, exec, listeners };
}
function conformance(tools, toolName, value) {
  const errors = [];
  validate(value, tools.get(toolName).output.schema, 'value', errors);
  return errors;
}

/* ------------------------------------------------------------- the fixture --- */

const PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html><head><title>B1 浏览器状态夹具</title></head>
<body>
  <h1>季度报告</h1>
  <p>这是页面正文的第一段，用来验证文本读取会在页面端被裁剪。</p>
  <label>搜索 <input type="text" value="已填内容" aria-label="搜索框"></label>
  <button id="save">保存</button>
</body></html>`)}`;

let port = 9411 + (process.pid % 200);
for (let attempt = 0; attempt < 25; attempt += 1) {
  // Skip a port something already answers on: a browser left behind by an earlier run of this
  // test would otherwise be adopted as the fixture, and its page is not the one under test.
  const taken = await fetch(`http://127.0.0.1:${port}/json/version`).then(() => true, () => false);
  if (!taken) break;
  port += 1;
}
const endpoint = `http://127.0.0.1:${port}`;
const profileDir = mkdtempSync(join(tmpdir(), 'dsh-cu-browser-profile-'));
const EDGE_CANDIDATES = [
  join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
  join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
  join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
];
const browserExe = EDGE_CANDIDATES.find((candidate) => existsSync(candidate));
let browserProcess = null;

try {
  if (browserExe === undefined) {
    skip('every browser clause', 'no Edge/Chrome on this machine');
    console.log(`\n${passed} passed, ${failures.length} failed, ${skipped} skipped`);
    process.exitCode = 0;
  } else {
    browserProcess = spawn(browserExe, [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      PAGE,
    ], { stdio: 'ignore', windowsHide: true });

    let discovered = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        discovered = await discoverEndpoint(endpoint, { timeoutMs: 1500 });
        break;
      } catch {
        await sleep(300);
      }
    }
    if (discovered === null) throw new Error(`the headless browser never answered on ${endpoint}`);
    console.log(`\nfixture: ${discovered.browser} on ${discovered.endpoint}\n`);

    console.log('== discovery and the tab list ==');
    check('the endpoint was discovered over loopback', discovered.endpoint === endpoint && discovered.port === port, JSON.stringify(discovered));
    check('the WebSocket address is loopback too', discovered.webSocketDebuggerUrl.startsWith('ws://127.0.0.1:'), discovered.webSocketDebuggerUrl);
    check('the browser reports its identity', discovered.browser !== '', discovered.browser);

    const { tools, exec } = mount({ browserEndpoint: endpoint });
    const call = (args) => tools.get('browser_state').execute(args, exec);
    // A freshly started headless browser lists its page before the page has finished parsing,
    // so the title arrives a moment later. Poll for it rather than asserting on a race — the
    // read itself is what is under test, not the browser's startup timing.
    let listed = await call({});
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if ((listed.tabs ?? []).some((tab) => tab.title !== '')) break;
      await sleep(250);
      listed = await call({});
    }
    check("a read with no bound tab answers with the tab list", listed.view === 'tabs' && Array.isArray(listed.tabs) && listed.tabs.length >= 1, JSON.stringify(listed.tabs));
    const fixtureTab = (listed.tabs ?? []).find((tab) => tab.url.startsWith('data:text/html')) ?? (listed.tabs ?? [])[0];
    check('the tab is the page the fixture opened', fixtureTab !== undefined && fixtureTab.url.startsWith('data:text/html')
      && (fixtureTab.title === '' || fixtureTab.title === 'B1 浏览器状态夹具'),
    JSON.stringify((listed.tabs ?? []).map((tab) => [tab.title, tab.url.slice(0, 24)])));
    check('the read went through the protocol, not a screenshot', listed.path === 'cdp', String(listed.path));
    check('and it conforms to the declared schema', conformance(tools, 'browser_state', listed).length === 0, conformance(tools, 'browser_state', listed).join('; '));

    const tabId = listed.tabs[0].id;

    console.log('\n== a bounded accessibility read ==');
    const ax = await call({ tab: tabId, view: 'ax', max_nodes: 30 });
    check('the read is of the tab that was named', ax.tab?.id === tabId && ax.tab.bound === true, JSON.stringify(ax.tab));
    check('nodes come back in the desktop reader\'s shape', Array.isArray(ax.nodes) && ax.nodes.length > 0
      && ax.nodes.every((node) => typeof node.ref === 'string' && node.ref !== '' && typeof node.role === 'string' && typeof node.name === 'string' && typeof node.value === 'string' && Array.isArray(node.states)),
      JSON.stringify(ax.nodes?.[0]));
    check('the page\'s own controls are in the tree', (ax.nodes ?? []).some((node) => node.name === '保存') && (ax.nodes ?? []).some((node) => /季度报告/.test(node.name)),
      JSON.stringify((ax.nodes ?? []).map((node) => `${node.role}:${node.name}`).slice(0, 8)));
    check('collected is kept apart from returned', Number.isInteger(ax.collected) && ax.collected >= ax.returned, JSON.stringify({ collected: ax.collected, returned: ax.returned }));
    check('every node carries a reference', (ax.nodes ?? []).every((node) => /^b\d+x\d+\.\d+$/.test(node.ref)), JSON.stringify(ax.nodes?.[0]?.ref));
    check('the reply conforms to the declared schema', conformance(tools, 'browser_state', ax).length === 0, conformance(tools, 'browser_state', ax).join('; '));
    check('the read reports the connection generation', Number.isInteger(ax.browser?.generation) && ax.browser.generation > 0, JSON.stringify(ax.browser));
    check('and the document it read', typeof ax.documentGeneration === 'string', String(ax.documentGeneration));

    const tight = await call({ tab: tabId, view: 'ax', max_nodes: 3 });
    check('the node budget is enforced', tight.nodes.length <= 3, String(tight.nodes.length));
    check('and truncation is reported', tight.truncated === true, JSON.stringify({ truncated: tight.truncated, collected: tight.collected }));

    const clamped = await call({ tab: tabId, view: 'ax', max_nodes: 5000, max_chars: 999999 });
    check('the budgets clamp to their §11 caps', clamped.budget?.max_nodes === 1000 && clamped.budget?.max_chars === 20000, JSON.stringify(clamped.budget));

    const filtered = await call({ tab: tabId, view: 'ax', filter: '保存' });
    check('a filter returns only the matches', filtered.nodes.length >= 1 && filtered.nodes.every((node) => `${node.role} ${node.name} ${node.value}`.includes('保存')), JSON.stringify(filtered.nodes.map((node) => node.name)));
    check('while still reporting what it collected', filtered.collected >= filtered.nodes.length, JSON.stringify({ collected: filtered.collected, returned: filtered.returned }));

    console.log('\n== references are per snapshot ==');
    const ax2 = await call({ tab: tabId, view: 'ax', max_nodes: 5 });
    check('a second read mints different references', ax.nodes[0].ref !== ax2.nodes[0].ref, `${ax.nodes[0].ref} vs ${ax2.nodes[0].ref}`);
    check('and the session counts them', ax2.refs >= ax2.nodes.length, JSON.stringify({ refs: ax2.refs, nodes: ax2.nodes.length }));
    check('the generation is unchanged by a read', ax2.browser.generation === ax.browser.generation, `${ax.browser.generation} vs ${ax2.browser.generation}`);

    console.log('\n== text is cut inside the page ==');
    const text = await call({ tab: tabId, view: 'text', max_chars: 40 });
    check('the text comes back within the budget', typeof text.text === 'string' && text.text.length <= 40 && text.text.length > 0, JSON.stringify(text.text));
    check('and the page was cut at the budget', text.truncated === true && Number(text.total) > text.text.length, JSON.stringify({ total: text.total, returned: text.returnedChars }));
    check('the text is the page\'s own text', /季度报告/.test(text.text), text.text.slice(0, 40));
    check('the reply conforms to the declared schema', conformance(tools, 'browser_state', text).length === 0, conformance(tools, 'browser_state', text).join('; '));

    console.log('\n== a target that does not exist is answered, not guessed ==');
    const unknownTab = await call({ tab: 'no-such-target', view: 'ax' });
    check('an unknown tab is reported as no_target', unknownTab.status === 'no_target', String(unknownTab.status));
    check('and the candidates come back with it', Array.isArray(unknownTab.tabs) && unknownTab.tabs.length >= 1, JSON.stringify(unknownTab.tabs));

    console.log('\n== the DOM view is not opened yet, and says so ==');
    const dom = await call({ view: 'dom' });
    check('view: dom answers with a note instead of an empty tree', dom.status === 'ok' && typeof dom.note === 'string' && /not opened yet/.test(dom.note), JSON.stringify(dom.note));

    console.log('\n== the second endpoint source: a profile whose browser wrote its own port ==');
    // The port a managed browser actually chose lives in `DevToolsActivePort` inside its profile
    // (§10). Whether a given build writes that file depends on the build — the one here does not
    // for an explicit `--remote-debugging-port` — so the mechanism is checked directly against a
    // profile that has the file, and the real browser is only asked whether it produced one.
    const portFileDir = mkdtempSync(join(tmpdir(), 'dsh-cu-port-file-'));
    writeFileSync(join(portFileDir, 'DevToolsActivePort'), '59999\n/devtools/browser/abcdef\n');
    const byProfile = mount({ browserUserDataDir: portFileDir });
    const fromProfile = await byProfile.tools.get('browser_state').execute({}, byProfile.exec);
    check('the port is read out of the profile the browser writes it into', fromProfile.browser?.endpoint === 'http://127.0.0.1:59999', JSON.stringify({ endpoint: fromProfile.browser?.endpoint, status: fromProfile.status }));
    check('and an endpoint with nothing behind it still refuses cleanly', fromProfile.status === 'unavailable', String(fromProfile.status));
    rmSync(portFileDir, { recursive: true, force: true });
    const profileHasPortFile = existsSync(join(profileDir, 'DevToolsActivePort'));
    if (profileHasPortFile) {
      const live = mount({ browserUserDataDir: profileDir });
      const liveRead = await live.tools.get('browser_state').execute({}, live.exec);
      check('a live browser profile resolves to a working read', liveRead.view === 'tabs' && (liveRead.tabs ?? []).length >= 1, JSON.stringify({ status: liveRead.status, tabs: liveRead.tabs?.length }));
    } else {
      skip('the live-profile clause', 'this browser build did not write DevToolsActivePort into its profile');
    }
    const staleProfile = mount({ browserUserDataDir: join(profileDir, 'does-not-exist') });
    const staleRead = await staleProfile.tools.get('browser_state').execute({}, staleProfile.exec);
    check('a profile with no DevToolsActivePort is a refusal, not a guess', staleRead.status === 'unavailable', JSON.stringify({ status: staleRead.status, note: staleRead.note?.slice(0, 80) }));

    console.log('\n== a browser this plugin launched is a first-class endpoint ==');
    // No `browserEndpoint` and no profile directory are configured here: the only thing that
    // knows about this browser is the launch that started it (§10's first endpoint source).
    const managedPort = port + 1;
    const managedProfile = join(profileDir, 'managed');
    const launchTools = mount({});
    const launched = await launchTools.tools.get('computer_launch').execute({
      target: browserExe,
      arguments: ['--headless=new', `--remote-debugging-port=${managedPort}`, `--user-data-dir=${managedProfile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'],
      wait_seconds: 4,
    }, launchTools.exec).catch((error) => ({ error: String(error.message) }));
    check('the browser was launched through the plugin', launched.error === undefined && Number(launched.pid) > 0, JSON.stringify(launched).slice(0, 160));
    let managedRead = await launchTools.tools.get('browser_state').execute({}, launchTools.exec);
    for (let attempt = 0; attempt < 20 && (managedRead.tabs ?? []).length === 0; attempt += 1) {
      await sleep(300);
      managedRead = await launchTools.tools.get('browser_state').execute({}, launchTools.exec);
    }
    check('and its endpoint is found without any configuration', String(managedRead.browser?.endpoint ?? '') === `http://127.0.0.1:${managedPort}`, JSON.stringify({ endpoint: managedRead.browser?.endpoint, status: managedRead.status }));
    check('the managed instance answers with its pages', managedRead.view === 'tabs' && (managedRead.tabs ?? []).length >= 1, JSON.stringify({ status: managedRead.status, tabs: managedRead.tabs?.length, note: managedRead.note?.slice(0, 90) }));
    try { process.kill(Number(launched.pid)); } catch { /* already gone */ }

    console.log('\n== the ways the channel refuses ==');
    const missing = mount({});
    const noEndpoint = await missing.tools.get('browser_state').execute({}, missing.exec);
    check('no configured endpoint is a refusal with advice', noEndpoint.status === 'unavailable' && /browserEndpoint/.test(noEndpoint.note ?? ''), JSON.stringify({ status: noEndpoint.status, note: noEndpoint.note?.slice(0, 80) }));
    check('and it says the other source too', /browserUserDataDir|DevToolsActivePort/.test(noEndpoint.note ?? ''), String(noEndpoint.note).slice(0, 200));

    const remote = mount({ browserEndpoint: 'http://192.0.2.10:9222' });
    const notLocal = await remote.tools.get('browser_state').execute({}, remote.exec);
    check('a non-loopback endpoint is refused', notLocal.status === 'not_local', JSON.stringify({ status: notLocal.status, note: notLocal.note?.slice(0, 90) }));
    check('and nothing was contacted', /not on this machine/i.test(notLocal.note ?? ''), String(notLocal.note).slice(0, 120));

    const dead = mount({ browserEndpoint: 'http://127.0.0.1:59999' });
    const unreachable = await dead.tools.get('browser_state').execute({}, dead.exec);
    check('an endpoint with nothing behind it is refused, not hung', unreachable.status === 'unavailable', JSON.stringify({ status: unreachable.status, note: unreachable.note?.slice(0, 100) }));
    check('and the desktop tools are said to be unaffected', /desktop tools are unaffected/.test(unreachable.note ?? ''), String(unreachable.note).slice(-120));

    const off = mount({ browser: false, browserEndpoint: endpoint });
    check('browser: false does not register the browser tools at all', off.tools.get('browser_state') === undefined, JSON.stringify([...off.tools.keys()]));
    check('while the desktop tools are still registered', off.tools.get('computer_ui') !== undefined);

    console.log(`\n${passed} passed, ${failures.length} failed, ${skipped} skipped`);
    if (failures.length > 0) {
      console.log('\nfailures:');
      for (const failure of failures) console.log(`  - ${failure}`);
    }
  }
} catch (error) {
  console.error('browser-state-test crashed:', error);
  process.exitCode = 1;
} finally {
  // Cleanup is best-effort: a browser that has just been killed can still hold its profile
  // directory for a moment, and a test that fails on that would be reporting the wrong thing.
  try { browserProcess?.kill(); } catch { /* already gone */ }
  await sleep(400);
  for (const dir of [profileDir, shimDir]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* still held; the OS will clear it */ }
  }
  if (failures.length > 0) process.exitCode = 1;
  setTimeout(() => process.exit(process.exitCode ?? 0), 150).unref();
}
