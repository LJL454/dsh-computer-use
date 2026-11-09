/**
 * PR17 尾项 —— 设置面板的**渲染与交互**（方案 4.18.8）。
 *
 * `client.js` 用的是宿主自己的模块装载器（`window.__ModuleLoader__.load`），React 由 factory 的
 * `require('react')` 提供。这让它可以在 Node 里被真实执行：给一个只有四件事的假 React
 * （createElement / useState / useEffect），加上假的 `fetch` 与 DOM，就能把面板渲染出来、点开、
 * 拨一个开关，然后看它**发出的是什么请求、失败时说的是什么**。
 *
 * 它替不掉的仍然是"真人用鼠标点一下"——那是安装后的界面验收；但它能挡住真正的回归：
 * 面板打不开、开关绑错键、失败被吞掉、把 Esc 也做成开关。
 *
 *   node client-panel-render-test.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, 'client.js'), 'utf8');

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}

/* --------------------------------------------------------------- fake env -- */

/** Persistent hook store: same array across renders, so state survives like a real component. */
let hookState = [];
let hookCursor = 0;
let pendingEffects = [];

const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat().filter((child) => child !== null && child !== undefined && child !== false) };
  },
  useState(initial) {
    const index = hookCursor;
    hookCursor += 1;
    if (!(index in hookState)) hookState[index] = typeof initial === 'function' ? initial() : initial;
    const set = (next) => {
      hookState[index] = typeof next === 'function' ? next(hookState[index]) : next;
    };
    return [hookState[index], set];
  },
  useEffect(fn) {
    pendingEffects.push(fn);
  },
  useRef(initial) {
    const index = hookCursor;
    hookCursor += 1;
    if (!(index in hookState)) hookState[index] = { current: initial };
    return hookState[index];
  },
};

const documentStub = {
  head: { appendChild: () => {} },
  getElementById: () => null,
  createElement: () => ({}),
};

/** Renders a component once against the persistent hook store. */
function render(component, props) {
  hookCursor = 0;
  pendingEffects = [];
  const tree = component(props ?? {});
  const cleanups = pendingEffects.map((fn) => fn());
  return { tree, cleanups };
}

/** Depth-first search of the element tree. */
function find(tree, predicate) {
  if (tree === null || typeof tree !== 'object') return null;
  if (predicate(tree)) return tree;
  for (const child of tree.children ?? []) {
    const hit = find(child, predicate);
    if (hit !== null) return hit;
  }
  return null;
}
function findAll(tree, predicate, found = []) {
  if (tree === null || typeof tree !== 'object') return found;
  if (predicate(tree)) found.push(tree);
  for (const child of tree.children ?? []) findAll(child, predicate, found);
  return found;
}

/* --------------------------------------------------------------- loading -- */

let pluginModule = null;
globalThis.window = {
  __ModuleLoader__: {
    load: ({ factory }) => {
      pluginModule = factory((name) => {
        if (name === 'react') return React;
        throw new Error(`unexpected require: ${name}`);
      });
    },
  },
};
globalThis.document = documentStub;
// eslint-disable-next-line no-new-func
new Function(SOURCE)();

const registrations = [];
const ctx = {
  slots: {
    inject: (_name, callback) => callback(),
    register: (descriptor, component) => {
      registrations.push({ descriptor, component });
      return () => {};
    },
  },
};
pluginModule.apply(ctx);

// 设置页就是唯一的入口（芯片已按设计移除）。后面所有渲染都用它。
const effects = { component: registrations.find((one) => one.descriptor.name === 'settings.section')?.component };

console.log('\n== 动画设置 in the settings sidebar, and only the 电脑操作 chip in the composer ==');
check('two entries are registered', registrations.length === 2, registrations.map((one) => one.descriptor.id).join(', '));
const section = registrations.find((one) => one.descriptor.name === 'settings.section');
check('one is the settings section', section !== undefined, registrations.map((one) => one.descriptor.name).join(', '));
check('the section is labelled 动画设置', section?.descriptor.label?.() === '动画设置', String(section?.descriptor.label?.()));
check('the section is NOT inside the plugin-inventory page', registrations.every((one) => one.descriptor.name !== 'plugins.item'));
const chips = registrations.filter((one) => one.descriptor.name === 'conversation.input.left');
check('exactly one composer chip', chips.length === 1, chips.map((one) => one.descriptor.id).join(', '));
check('and it is the 电脑操作 chip', chips[0]?.descriptor.id === 'computer-use', String(chips[0]?.descriptor.id));
check('the 效果 chip is gone from the composer', registrations.every((one) => one.descriptor.id !== 'computer-use-effects'), registrations.map((one) => one.descriptor.id).join(', '));

/* ---------------------------------------------------------------- render -- */

const calls = [];
let nextReply = () => ({
  ok: true,
  json: async () => ({
    ok: true,
    schema: 'dsh.computer-use.visual-preferences/v1',
    values: { enabled: false, bannerCharacter: false, cursorCharacter: false, cursorHalo: true, edgeBreathing: true, reducedMotion: false },
    defaults: { cursorHalo: true },
    settingsRevision: 3,
    degraded: null,
    overlay: { state: 'absent' },
  }),
});
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), method: options.method ?? 'GET', body: options.body === undefined ? null : JSON.parse(options.body) });
  return nextReply();
};

console.log('\n== the settings card renders its rows directly ==');
{
  const first = render(effects.component, {});
  check('no trigger button: a settings card has nothing to expand', find(first.tree, (node) => node.type === 'button') === null);
  check('it renders as a settings card', find(first.tree, (node) => node.props?.className === 'dsh-cu-settings') !== null);
  check('it reads the preferences route', calls.length === 1 && /\/computer-use\/visual-preferences$/.test(calls[0].url), JSON.stringify(calls));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

console.log('\n== it shows one row per setting ==');
{
  const second = render(effects.component, {});
  const panel = find(second.tree, (node) => node.props?.className === 'dsh-cu-settings');
  check('the card is there', panel !== null);
  const boxes = findAll(second.tree, (node) => node.type === 'input');
  // 8 个开关 + 2 个人物高度滑块（日常伴随是独立的一组，排在最前）。select 不是 input。
  check('one control per setting', boxes.length === 10, String(boxes.length));
  const labels = findAll(second.tree, (node) => node.props?.className === 'dsh-cu-fx-name').map((node) => node.children[0]);
  check('each row is named', labels.length === 11 && labels.every((label) => typeof label === 'string' && label !== ''), JSON.stringify(labels));
  check('the companion switch is its own row', labels.some((label) => typeof label === 'string' && label.includes('显示鼠标角色')), JSON.stringify(labels));
  check('the panel says the safety channels are untouched', /Esc 取消不受这些开关影响/.test(SOURCE));
  const checked = boxes.filter((box) => box.props.checked === true).map((box) => box.props['aria-label'] ?? box.key);
  check('the values come from the host, not from a local guess', boxes.filter((box) => box.props.checked).length === 2, String(boxes.filter((box) => box.props.checked).length));
}

console.log('\n== flipping a switch posts exactly that change ==');
{
  const before = calls.length;
  const first = render(effects.component, {});
  const boxes = findAll(first.tree, (node) => node.type === 'input');
  // 第 2 个是「横幅角色」：它此刻是关的，点一下应该只发这一个键。
  const target = boxes[2];
  nextReply = () => ({
    ok: true,
    json: async () => ({
      ok: true,
      values: { enabled: false, bannerCharacter: true, cursorCharacter: false, cursorHalo: true, edgeBreathing: true, reducedMotion: false },
      settingsRevision: 4,
      rejected: [],
      applied: { revision: 4, applied: null },
      applyError: null,
    }),
  });
  target.props.onChange({ target: { checked: true } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const post = calls.slice(before).find((call) => call.method === 'POST');
  check('a POST was sent', post !== undefined, JSON.stringify(calls.slice(before)));
  check('only the changed key is sent', JSON.stringify(post?.body) === JSON.stringify({ values: { bannerCharacter: true } }), JSON.stringify(post?.body));
  const after = render(effects.component, {});
  const boxesAfter = findAll(after.tree, (node) => node.type === 'input');
  check('the reply is what the panel shows', boxesAfter[2]?.props.checked === true, JSON.stringify(boxesAfter.map((box) => box.props.checked)));
}

console.log('\n== a refused or failed save is reported, not hidden ==');
{
  nextReply = () => ({
    ok: true,
    json: async () => ({ ok: true, values: { enabled: false, bannerCharacter: false, cursorCharacter: false, cursorHalo: true, edgeBreathing: true, reducedMotion: false }, settingsRevision: 5, rejected: [{ key: 'cursorHalo', reason: 'must be a boolean' }] }),
  });
  let tree = render(effects.component, {}).tree;
  findAll(tree, (node) => node.type === 'input')[3].props.onChange({ target: { checked: false } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  tree = render(effects.component, {}).tree;
  const note = find(tree, (node) => node.props?.className === 'dsh-cu-fx-error');
  check('a refused key is named in the panel', /宿主拒绝了/.test(note?.children?.[0] ?? ''), JSON.stringify(note?.children));

  nextReply = () => ({ ok: false, json: async () => ({ ok: false, error: 'the host refused the change' }) });
  findAll(tree, (node) => node.type === 'input')[0].props.onChange({ target: { checked: true } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  tree = render(effects.component, {}).tree;
  const failure = find(tree, (node) => node.props?.className === 'dsh-cu-fx-error');
  check('a transport failure is reported', /未能保存/.test(failure?.children?.[0] ?? ''), JSON.stringify(failure?.children));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
