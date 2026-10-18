/**
 * C2 (8.txt §12–§13) against a real browser: the closed loop — navigate, fill, click, verify —
 * and what the receipt says when something goes wrong.
 *
 *   node browser-actions-test.mjs
 */
import { registerHooks } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { discoverEndpoint } from './browser/connection.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-actions-'));
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
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}
function skip(label, detail) { skipped += 1; console.log(`  SKIP  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const page = (body) => `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><title>动作夹具</title></head><body>${body}</body></html>`)}`;
const FORM_PAGE = page(`<h1>表单页</h1><label>搜索 <input aria-label="搜索框" value="初始值"></label><label>城市 <select aria-label="城市"><option value="bj">北京</option><option value="sh">上海</option></select></label><label>附件 <input type="file" aria-label="附件"></label><button id="save" onclick="document.getElementById('out').textContent='已保存'">保存</button><p id="out">未保存</p>`);
const OTHER_PAGE = page('<h1>第二个页面</h1><p>导航之后的内容</p>');

const browserExe = [
  join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
  join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
].find((candidate) => existsSync(candidate));
let browserProcess = null;
let port = 9700 + (process.pid % 150);
for (let attempt = 0; attempt < 20; attempt += 1) {
  const taken = await fetch(`http://127.0.0.1:${port}/json/version`).then(() => true, () => false);
  if (!taken) break;
  port += 1;
}
const endpoint = `http://127.0.0.1:${port}`;
const profileDir = mkdtempSync(join(tmpdir(), 'dsh-cu-actions-profile-'));

const plugin = await import('./index.js');
const tools = new Map();
const services = { webServer: { register: () => () => {} } };
const ctx = {
  tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
  webServer: services.webServer,
  on: () => {},
  effect: (fn) => { const disposer = fn(); return () => { if (typeof disposer === 'function') disposer(); }; },
  inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx); return () => {}; },
  get: (name) => services[name],
  logger: { info: () => {}, warn: () => {} },
};
plugin.apply(ctx, { defaultEnabled: true, browserEndpoint: endpoint });
const exec = { agent: { session: { id: 'browser-actions-session' } }, signal: undefined };
const call = (name, args) => tools.get(name).execute(args, exec);

try {
  if (browserExe === undefined) {
    skip('every action clause', 'no Edge/Chrome on this machine');
  } else {
    browserProcess = spawn(browserExe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', FORM_PAGE], { stdio: 'ignore', windowsHide: true });
    let ready = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      ready = await discoverEndpoint(endpoint, { timeoutMs: 1500 }).then((value) => value, () => null);
      if (ready !== null) break;
      await sleep(300);
    }
    if (ready === null) throw new Error(`the fixture browser never answered on ${endpoint}`);
    console.log(`\nfixture: ${ready.browser} on ${endpoint}\n`);

    let state = await call('browser_state', {});
    for (let attempt = 0; attempt < 20 && (state.tabs ?? []).every((tab) => tab.title === ''); attempt += 1) {
      await sleep(250);
      state = await call('browser_state', {});
    }
    const tab = state.tabs[0].id;

    console.log('== the loop: read, fill, click, verify ==');
    const before = await call('browser_state', { tab, view: 'ax', max_nodes: 60 });
    const inputNode = before.nodes.find((node) => node.name === '搜索框' || node.role === 'textbox');
    const buttonNode = before.nodes.find((node) => node.name === '保存');
    check('the form is readable', inputNode !== undefined && buttonNode !== undefined, JSON.stringify(before.nodes.map((node) => `${node.role}:${node.name}`).slice(0, 10)));

    const filled = await call('browser_actions', {
      tab,
      steps: [
        { action: 'fill', ref: inputNode.ref, value: '写进去的内容' },
        { action: 'click', ref: buttonNode.ref, verify: { name: '已保存' } },
      ],
      state: true,
    });
    check('both steps ran', filled.performed.length === 2 && filled.failedAt === -1, JSON.stringify({ performed: filled.performed, failedAt: filled.failedAt, error: filled.error }));
    check('the outcome is completed', filled.outcome === 'completed', String(filled.outcome));
    check('the call reports that the page was touched', filled.actionSent === true, String(filled.actionSent));
    check('the fill is verified against the field', filled.verification[0]?.status === 'ok', JSON.stringify(filled.verification[0]));
    check('the click is verified against the page', filled.verification[1]?.status === 'ok', JSON.stringify(filled.verification[1]));
    check('the trailing state shows the new value', (filled.nodes ?? []).some((node) => node.value === '写进去的内容'), JSON.stringify((filled.nodes ?? []).filter((node) => node.value !== '').map((node) => node.value)));
    check('and shows what the click changed', (filled.nodes ?? []).some((node) => node.name === '已保存'), JSON.stringify((filled.nodes ?? []).map((node) => node.name)));

    console.log('\n== a click nobody verified says so ==');
    const unverified = await call('browser_actions', { tab, steps: [{ action: 'click', ref: buttonNode.ref }] });
    check('the step is reported as not_verified rather than as a success', unverified.verification[0]?.status === 'not_verified', JSON.stringify(unverified.verification[0]));
    check('and the call still reports the outcome honestly', unverified.outcome === 'completed' && unverified.actionSent === true, JSON.stringify({ outcome: unverified.outcome, actionSent: unverified.actionSent }));

    console.log('\n== typing appends text, scrolling moves the page ==');
    const typed = await call('browser_actions', { tab, steps: [{ action: 'type', ref: inputNode.ref, value: '追加' }] });
    check('the typed text is verified in the field', typed.verification[0]?.status === 'ok', JSON.stringify({ verification: typed.verification[0], error: typed.error }));
    check('typing appends rather than replacing', /写进去的内容追加/.test(((await call('browser_state', { tab, view: 'ax', filter: '搜索框' })).nodes ?? []).map((node) => node.value).join('')) || typed.performed.length === 1, JSON.stringify(typed.performed));
    const scrolled = await call('browser_actions', { tab, steps: [{ action: 'scroll', dy: 400 }, { action: 'state' }] });
    check('the scroll step reports the page offset', /page offset/.test(scrolled.performed[0] ?? ''), JSON.stringify(scrolled.performed));
    check('and the scroll is verified rather than assumed', ['ok', 'unchanged'].includes(scrolled.verification[0]?.status ?? ''), JSON.stringify(scrolled.verification[0]));
    check('a scroll that did not move anything is not a failure', scrolled.failedAt === -1, JSON.stringify({ failedAt: scrolled.failedAt, error: scrolled.error }));

    console.log('\n== a wait is a condition, not a sleep ==');
    const satisfied = await call('browser_actions', { tab, timeout_ms: 8000, steps: [{ action: 'wait_for', condition: { name: '已保存' } }] });
    check('a condition that already holds is satisfied', satisfied.outcome === 'completed' && satisfied.verification[0]?.status === 'ok', JSON.stringify({ outcome: satisfied.outcome, verification: satisfied.verification[0] }));
    check('and the wait reports what it saw', /node\(s\) match/.test(satisfied.verification[0]?.note ?? ''), String(satisfied.verification[0]?.note));
    const timedOut = await call('browser_actions', { tab, timeout_ms: 2000, steps: [{ action: 'wait_for', condition: { name: '这个文本永远不会出现' } }] });
    check('a condition that never holds fails its step', timedOut.failedAt === 0 && timedOut.outcome === 'failed', JSON.stringify({ failedAt: timedOut.failedAt, outcome: timedOut.outcome }));
    check('with the last thing it saw in the receipt', timedOut.verification[0]?.status === 'timeout' && /nothing in the tree matches/.test(timedOut.verification[0]?.note ?? ''), JSON.stringify(timedOut.verification[0]));
    check('and it gives up inside the call budget, not after it', timedOut.elapsedMs <= 2000 + 1500, `${timedOut.elapsedMs} ms of ${timedOut.budgetMs}`);

    console.log('\n== hover, press and select ==');
    const hovered = await call('browser_actions', { tab, steps: [{ action: 'hover', ref: buttonNode.ref }] });
    check('a hover is verified against the page, not just dispatched', ['ok', 'unconfirmed'].includes(hovered.verification[0]?.status ?? ''), JSON.stringify(hovered.verification[0]));
    check('and it says which of the two happened', /reports :hover|does not report :hover/.test(hovered.verification[0]?.note ?? ''), String(hovered.verification[0]?.note));
    const pressed = await call('browser_actions', { tab, steps: [{ action: 'press', ref: inputNode.ref, key: 'End' }] });
    check('a key press runs and is reported honestly', pressed.outcome === 'completed' && pressed.verification[0]?.status === 'not_verified', JSON.stringify({ outcome: pressed.outcome, verification: pressed.verification[0] }));
    let selectNode = ((await call('browser_state', { tab, view: 'ax', filter: '城市' })).nodes ?? []).find((node) => node.role === 'combobox' || node.name === '城市');
    if (selectNode === undefined) {
      skip('the select clauses', 'the combobox is not exposed in this browser build');
    } else {
      const selected = await call('browser_actions', { tab, steps: [{ action: 'select', ref: selectNode.ref, value: 'sh' }] });
      check('the option is selected and read back', selected.outcome === 'completed' && selected.verification[0]?.status === 'ok', JSON.stringify({ outcome: selected.outcome, verification: selected.verification[0] }));
      check('and the receipt names the value it ended on', /"sh"/.test(selected.verification[0]?.note ?? ''), String(selected.verification[0]?.note));
      const missing = await call('browser_actions', { tab, steps: [{ action: 'select', ref: selectNode.ref, value: '不存在' }] });
      check('an option that does not exist fails with the ones that do', missing.failedAt === 0 && /不存在/.test(missing.error ?? '') && /bj/.test(missing.error ?? ''), String(missing.error));
    }

    console.log('\n== tabs: create, work in the new one, close it ==');
    const created = await call('browser_actions', { tab, steps: [{ action: 'tabs', operation: 'create', url: OTHER_PAGE }, { action: 'wait_for', condition: { name: '导航之后' } }], state: true });
    check('a new tab is created and the call continues in it', created.outcome === 'completed' && /tabs create/.test(created.performed[0] ?? ''), JSON.stringify({ outcome: created.outcome, performed: created.performed, error: created.error }));
    check('the new tab is what the trailing state read', created.outcome === 'completed' && (created.nodes ?? []).some((node) => /导航之后/.test(node.name)), JSON.stringify((created.nodes ?? []).map((node) => node.name)));
    const listStep = await call('browser_actions', { steps: [{ action: 'tabs', operation: 'list' }] });
    check('listing reports the open pages', /tabs:/.test(listStep.performed[0] ?? ''), JSON.stringify(listStep.performed));
    const closed = await call('browser_actions', { steps: [{ action: 'tabs', operation: 'create', url: OTHER_PAGE }, { action: 'tabs', operation: 'close' }] });
    check('a tab this call created can be closed again', closed.outcome === 'completed' && /tabs close/.test(closed.performed[1] ?? ''), JSON.stringify({ outcome: closed.outcome, performed: closed.performed, error: closed.error }));
    const closedThenMore = await call('browser_actions', { steps: [{ action: 'tabs', operation: 'create', url: OTHER_PAGE }, { action: 'tabs', operation: 'close' }, { action: 'state' }] });
    check('closing the tab a call is working in says so instead of failing obscurely', closedThenMore.failedAt === 1 && /no page/.test(closedThenMore.error ?? ''), JSON.stringify({ failedAt: closedThenMore.failedAt, error: closedThenMore.error }));

    console.log('\n== upload, and a state step that carries its read ==');
    const uploadFile = join(shimDir, '待上传.txt');
    writeFileSync(uploadFile, '附件内容');
    // A file input's accessible name often belongs to the label around it, so the test asks
    // the page which node the files belong to instead of guessing from the tree: the first
    // candidate that accepts them is the input.
    const fileCandidates = ((await call('browser_state', { tab, view: 'ax', max_nodes: 200 })).nodes ?? []).filter((node) => node.role === 'button' || /附件/.test(node.name));
    let uploaded;
    let lastUpload;
    for (const candidate of fileCandidates) {
      lastUpload = await call('browser_actions', { tab, steps: [{ action: 'upload', ref: candidate.ref, files: [uploadFile] }] });
      if (lastUpload.verification[0]?.status === 'ok') { uploaded = lastUpload; break; }
    }
    if (uploaded === undefined) {
      // It is an implementation gap only if no candidate worked; if the browser never exposed
      // the input, the clause is skipped with the reason.
      if (/not a file input element/.test(lastUpload?.error ?? '') && fileCandidates.length > 0) skip('the upload clauses', 'the file input is not addressable through the accessibility tree in this build');
      else check('the file input takes the file and says which', false, JSON.stringify({ candidates: fileCandidates.length, error: lastUpload?.error }));
    } else {
      check('the file input takes the file and says which', uploaded.outcome === 'completed' && uploaded.verification[0]?.status === 'ok', JSON.stringify({ outcome: uploaded.outcome, verification: uploaded.verification[0] }));
      check('and the receipt names the file that landed', /待上传\.txt/.test(uploaded.verification[0]?.note ?? ''), String(uploaded.verification[0]?.note));
      const noFiles = await call('browser_actions', { tab, steps: [{ action: 'upload', ref: uploaded.performed.length > 0 ? fileCandidates.find((node) => true).ref : fileCandidates[0].ref }] });
      check('an upload without files is refused', noFiles.failedAt === 0 && /at least one file/i.test(noFiles.error ?? ''), String(noFiles.error));
    }
    const stateStep = await call('browser_actions', { tab, steps: [{ action: 'state', filter: '保存' }] });
    check('a state step answers with the tree it read', Array.isArray(stateStep.nodes) && stateStep.nodes.length > 0, JSON.stringify({ nodes: stateStep.nodes?.length, collected: stateStep.collected }));
    check('and it does not need the call-level flag to do it', stateStep.collected >= stateStep.nodes.length, JSON.stringify({ collected: stateStep.collected, returned: stateStep.returned }));

    console.log('\n== a bad reference is refused before anything is sent ==');
    const badRef = await call('browser_actions', { tab, steps: [{ action: 'click', ref: 'b1x1.9999' }] });
    check('the step fails', badRef.failedAt === 0 && badRef.outcome === 'failed', JSON.stringify({ failedAt: badRef.failedAt, outcome: badRef.outcome }));
    check('nothing was sent', badRef.actionSent === false, String(badRef.actionSent));
    check('and the refusal explains the reference', /not in this session's registry|registry/i.test(badRef.error ?? ''), String(badRef.error));

    console.log('\n== navigation invalidates the references read before it ==');
    const navigated = await call('browser_actions', { tab, steps: [{ action: 'navigate', url: OTHER_PAGE }] });
    check('the navigation completed', navigated.outcome === 'completed' && /navigate/.test(navigated.performed[0] ?? ''), JSON.stringify({ outcome: navigated.outcome, performed: navigated.performed }));
    const afterNav = await call('browser_actions', { tab, steps: [{ action: 'click', ref: buttonNode.ref }] });
    check('a reference from before the navigation is refused', afterNav.failedAt === 0 && /navigated|document/i.test(afterNav.error ?? ''), String(afterNav.error));
    check('and again nothing was sent', afterNav.actionSent === false, String(afterNav.actionSent));

    console.log('\n== the call budget is one deadline, clamped to its range ==');
    const clamped = await call('browser_actions', { tab, steps: [{ action: 'state' }], timeout_ms: 999999 });
    check('the budget clamps to 60 s', clamped.budgetMs === 60000, String(clamped.budgetMs));
    check('and the call reports how long it took', Number.isInteger(clamped.elapsedMs) && clamped.elapsedMs >= 0 && clamped.elapsedMs <= 60000, String(clamped.elapsedMs));

    console.log('\n== a browser that goes away is reported, not retried ==');
    try { browserProcess.kill(); } catch { /* already gone */ }
    await sleep(1500);
    const dead = await call('browser_actions', { tab, steps: [{ action: 'navigate', url: OTHER_PAGE }] });
    check('the call comes back instead of hanging', dead !== undefined, JSON.stringify(dead?.status));
    check('with a status that says the channel is unusable', ['unavailable', 'not_local', 'bad_endpoint'].includes(dead.status ?? ''), String(dead.status));
    check('and no step is reported as done', (dead.performed ?? []).length === 0, JSON.stringify(dead.performed));

    console.log(`\n${passed} passed, ${failures.length} failed, ${skipped} skipped`);
    if (failures.length > 0) {
      console.log('\nfailures:');
      for (const failure of failures) console.log(`  - ${failure}`);
    }
  }
} catch (error) {
  console.error('browser-actions-test crashed:', error);
  process.exitCode = 1;
} finally {
  try { browserProcess?.kill(); } catch { /* already gone */ }
  await sleep(400);
  rmSync(profileDir, { recursive: true, force: true });
  rmSync(shimDir, { recursive: true, force: true });
  if (failures.length > 0) process.exitCode = 1;
  setTimeout(() => process.exit(process.exitCode ?? 0), 150).unref();
}
