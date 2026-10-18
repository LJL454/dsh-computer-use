// Verify the per-session tool-schema visibility added for 6.txt §三-3:
// while 电脑操作 is off, a session must not pay for the computer_* schemas.
//
// The plugin is mounted against a stub context, so this runs without a restart
// and without touching the real desktop. The two HTTP-route call sites are
// asserted against the source text, because driving them here would start the
// PowerShell worker.
//
// `@deepseek-ai/dsh-tools` is stubbed, for the same reason `schema-test.mjs` stubs it:
// a bare `import('./index.js')` resolves that peer from the plugin's own directory, which only
// exists as a development convenience on the author's machine — an unpacked release has no
// `node_modules/` next to it and would crash with ERR_MODULE_NOT_FOUND. What that peer's real
// validator thinks of the descriptors is a different question, and it is `real-tools-probe.mjs`
// that answers it against the installed application.
//
// Usage: node test-schema-visibility.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------ peer stub -- */

const shimDir = mkdtempSync(join(tmpdir(), 'cu-visibility-'));
const toolsStub = join(shimDir, 'dsh-tools-stub.mjs');
writeFileSync(toolsStub, 'export const defineTool = (definition) => definition;\n');
// `@deepseek-ai/dsh-scope` gets the same treatment, for the same reason: its `lib/index.js` imports
// `@deepseek-ai/cordis`, which is not next to this plugin either. The stub keeps the one behaviour
// the plugin actually depends on — `scopeOf` reading the scope tag off a context — so the default
// path is exercised rather than skipped.
const scopeStub = join(shimDir, 'dsh-scope-stub.mjs');
writeFileSync(scopeStub, [
  'export const kScope = Symbol.for("test.dsh.scope");',
  'export const scopeOf = (ctx) => ctx?.[kScope];',
  '',
].join('\n'));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: pathToFileURL(toolsStub).href, shortCircuit: true };
    }
    if (specifier === '@deepseek-ai/dsh-scope') {
      return { url: pathToFileURL(scopeStub).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
process.on('exit', () => {
  rmSync(shimDir, { recursive: true, force: true });
});

let failures = 0;
let checks = 0;
function check(name, condition, detail = '') {
  checks += 1;
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const EXPECTED = [
  'computer_screenshot', 'computer_actions', 'computer_click', 'computer_drag',
  'computer_scroll', 'computer_type', 'computer_key', 'computer_windows', 'computer_ui',
  'computer_ui_action', 'computer_clipboard', 'computer_paste', 'computer_launch', 'computer_stop',
];

/** A context with the surface the plugin's apply() touches. */
function stubContext() {
  const listeners = new Map();
  const routes = new Map();
  const disposers = [];
  const registered = [];
  const ctx = {
    logger: { info: () => {}, warn: (message, ...rest) => console.log(`  [warn] ${message} ${rest.join(' ')}`) },
    on(event, handler) {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
    },
    effect(fn) {
      disposers.push(fn());
    },
    inject(_names, callback) {
      callback({
        effect(fn) { disposers.push(fn()); },
        webServer: {
          register({ path, handler }) {
            routes.set(path, handler);
            return { dispose() {} };
          },
        },
      });
    },
    tools: {
      register(definition) {
        registered.push(definition);
        return { dispose() {} };
      },
      get() { return undefined; },
    },
  };
  return { ctx, listeners, routes, disposers, registered };
}

async function fire(listeners, event, payload) {
  for (const handler of listeners.get(event) ?? []) await handler(payload);
}

/**
 * An agent whose scoped tools service records restrict() and its disposables.
 *
 * `restrict()` returns a **function**, because that is what the host returns: `dsh-tools`
 * `restrict()` is `return this.layers.effect(...)`, and cordis defines
 * `Disposable<T> = () => T` — the disposer is callable, and it carries no `.dispose`
 * property. A stub returning `{ dispose() {} }` is what let the plugin's
 * `restricted.dispose?.()` look correct for 300 lines of green checks while the real
 * restriction was never lifted (that was the "chip is lit, the tools never come back" bug).
 * `verify-disposer-contract.mjs` prints the host contract this shape is copied from.
 */
function stubAgent(sessionId) {
  const restrictCalls = [];
  const disposed = [];
  return {
    agent: {
      session: { id: sessionId, header: { id: sessionId } },
      ctx: {
        tools: {
          get: (name) => (EXPECTED.includes(name) ? { name } : undefined),
          restrict(filter) {
            restrictCalls.push(filter);
            return () => disposed.push(true);
          },
        },
      },
    },
    restrictCalls,
    disposed,
  };
}

/** Call a captured route with a fake request/response pair. */
async function callRoute(handler, { method = 'GET', sessionId, body }) {
  const response = {
    status: 0,
    payload: undefined,
    writeHead(status) { this.status = status; return this; },
    end(text) { this.payload = JSON.parse(text); },
  };
  const request = {
    method,
    url: `/?sessionId=${encodeURIComponent(sessionId)}`,
    on(event, handler2) {
      if (event === 'data' && body !== undefined) handler2(Buffer.from(JSON.stringify(body)));
      if (event === 'end') handler2();
      return this;
    },
  };
  await handler(request, response);
  return response;
}

const module = await import(pathToFileURL(join(here, 'index.js')).href);

console.log('capability off (defaultEnabled: false)');
{
  const { ctx, listeners, routes } = stubContext();
  module.apply(ctx, { defaultEnabled: false });
  check('plugin registers its tools', ctx.tools !== undefined);

  const { agent, restrictCalls, disposed } = stubAgent('session-alpha');
  await fire(listeners, 'agent/created', { agent });

  check('restrict() called once on creation', restrictCalls.length === 1, String(restrictCalls.length));
  const denied = restrictCalls[0]?.deny ?? [];
  check('every computer_* schema is denied',
    EXPECTED.every((name) => denied.includes(name)) && denied.length === EXPECTED.length,
    `denied=${denied.length}`);
  check('no allow-list is passed (masks intersect, deny is enough)',
    restrictCalls[0]?.allow === undefined);

  const stateHandler = routes.get('/computer-use/state');
  check('the chip state route is registered', typeof stateHandler === 'function');
  if (stateHandler) {
    const response = await callRoute(stateHandler, { sessionId: 'session-alpha' });
    check('chip reports the schemas as hidden',
      response.payload?.control?.toolSchemas === 'hidden',
      JSON.stringify(response.payload?.control));
    check('chip still reports the capability as off', response.payload?.control?.enabled === false);
  }

  await fire(listeners, 'agent/disposed', { agent });
  check('disposal releases the restriction (function-shaped disposer)', disposed.length === 1, String(disposed.length));
  if (stateHandler) {
    const after = await callRoute(stateHandler, { sessionId: 'session-alpha' });
    check('chip reports visible again after disposal',
      after.payload?.control?.toolSchemas === 'visible',
      JSON.stringify(after.payload?.control));
  }
}

console.log('\ncapability on (defaultEnabled: true)');
{
  const { ctx, listeners } = stubContext();
  module.apply(ctx, { defaultEnabled: true });
  const { agent, restrictCalls } = stubAgent('session-beta');
  await fire(listeners, 'agent/created', { agent });
  check('no restriction is created for a granted session', restrictCalls.length === 0,
    String(restrictCalls.length));
}

console.log('\nconfig switch hides nothing when off');
{
  const { ctx, listeners } = stubContext();
  module.apply(ctx, { defaultEnabled: false, hideToolSchemasWhenOff: false });
  const { agent, restrictCalls } = stubAgent('session-gamma');
  await fire(listeners, 'agent/created', { agent });
  check('hideToolSchemasWhenOff=false keeps the old behaviour', restrictCalls.length === 0);
}

console.log('\nunknown names are skipped instead of throwing');
{
  const { ctx, listeners } = stubContext();
  module.apply(ctx, { defaultEnabled: false });
  const restrictCalls = [];
  const agent = {
    session: { id: 'session-delta' },
    ctx: { tools: {
      // Only two of the family are visible in this composition.
      get: (name) => (['computer_screenshot', 'computer_stop'].includes(name) ? { name } : undefined),
      restrict(filter) { restrictCalls.push(filter); return () => {}; },
    } },
  };
  await fire(listeners, 'agent/created', { agent });
  check('deny list contains exactly the visible names',
    restrictCalls.length === 1 && restrictCalls[0].deny.length === 2,
    JSON.stringify(restrictCalls[0]));
}

console.log('\nrefusal path converges too (a session older than the listener)');
{
  const stub = stubContext();
  module.apply(stub.ctx, { defaultEnabled: false });
  const tool = stub.registered.find((definition) => definition?.name === 'computer_windows');
  check('computer_windows is registered', tool !== undefined);
  const { agent, restrictCalls } = stubAgent('session-epsilon');
  let thrown;
  try {
    await tool.execute({}, { agent, callId: 'call-epsilon', signal: undefined });
  } catch (error) {
    thrown = error;
  }
  check('the refusal still names the missing grant',
    /NOT_AUTHORIZED/.test(String(thrown?.message ?? '')), String(thrown?.message ?? thrown));
  check('and that path hides the schemas while refusing', restrictCalls.length === 1,
    String(restrictCalls.length));
}

console.log('\nroute call sites (static, because driving them starts the worker)');
{
  const source = readFileSync(join(here, 'index.js'), 'utf8');
  const lines = source.split('\n');
  const indexOf = (needle) => lines.findIndex((line) => line.includes(needle));
  // 这三条断言的是**源码里的不变量**："改授权之后必须紧跟一次可见性同步"，否则一个会话可能
  // 长期停在错误的状态里。§10 拆分把授权与同步搬进了模块（`sessions.grant` / `visibility.sync`），
  // 不变量没变，所以这里跟着改的是**写法**，判定距离（6/8 行）保持不变。
  //
  // 1.39.2 之后这一条链路收紧过一次：路由不再自己 `agentOf(...)` 去抓 agent，而是调
  // `activate` / `deactivate`——因为"找不到 agent 就什么都不做"正是"芯片亮着、工具永远不出现"
  // 的成因（见 internal/schema-visibility.mjs 里 activate 的注释）。所以这里除了断言同步紧跟授权，
  // 还断言路由**不再**手抓 agent：那个写法已经不允许回来了。
  const enableLine = indexOf('sessions.grant(sessionId);');
  const disableLine = indexOf('revokeSession(sessionId, \'the user turned 电脑操作 off\')');
  const activateLine = indexOf('visibility.activate(sessionKey(sessionId))');
  const deactivateLine = indexOf('visibility.deactivate(sessionKey(sessionId))');
  check('enable branch activates (grant set, then activate within 8 lines)',
    activateLine > enableLine && activateLine - enableLine <= 8,
    `enable=${enableLine} activate=${activateLine}`);
  check('disable branch deactivates (revoke, then deactivate within 8 lines)',
    deactivateLine > disableLine && deactivateLine - disableLine <= 8,
    `disable=${disableLine} deactivate=${deactivateLine}`);
  check('the refusal path syncs too (older sessions converge)',
    source.includes('visibility.sync(exec?.agent);'));
  check('the routes never reach for an agent by hand (that is the bug shape)',
    !source.includes('visibility.agentOf('),
    'index.js must call activate/deactivate instead of agentOf');
}

console.log('\nactivation does not depend on an agent having been registered');
{
  // 报告过的症状：芯片点开了，工具却永远不出现。旧写法 `sync(agentOf(key))` 在"这个会话还没有
  // 活 agent"时是静默无效的，于是限制留在 `hidden` 里没人摘。这两条断言钉住修复后的两条路：
  // 有 agent 就对齐，没有 agent 也要给出结论（就地释放），而不是什么都不做。
  const { createSchemaVisibility } = await import(pathToFileURL(join(here, 'internal', 'schema-visibility.mjs')).href);
  let granted = false;
  const visibility = createSchemaVisibility({
    enabled: true,
    isEnabled: () => granted,
    logger: undefined,
    onSessionDisposed: () => {},
  });

  const { agent, restrictCalls, disposed } = stubAgent('session-theta');
  visibility.sync(agent);
  check('a refused session hides its schemas',
    restrictCalls.length === 1 && visibility.restrictedCount() === 1,
    `restrict=${restrictCalls.length} hidden=${visibility.restrictedCount()}`);

  granted = true;
  check('activating a registered session lifts the restriction',
    visibility.activate('session-theta') === 'visible' && disposed.length === 1,
    `disposed=${disposed.length}`);

  check('activating a session with no live agent answers instead of doing nothing',
    visibility.activate('session-never-seen') === 'unbound');

  const late = stubAgent('session-never-seen');
  visibility.sync(late.agent);
  check('a late agent for a granted session is not restricted again',
    late.restrictCalls.length === 0, `restrict=${late.restrictCalls.length}`);
}

console.log('\nthe tool lookup asks by scope key, not by context');
{
  // 宿主 `dsh-tools` 的 `get(name, scope)` 把第二个参数交给按**作用域 key** 索引的层表
  // （`view(scope)` → `layers.chainLayers(scope)`），而 `dsh-scope` 的 `scopeOf(ctx)` 才是
  // 从 Context 上取那个 key 的正路（`ctx[kScope]`）。把 `agent.ctx` 本身传进去，等于拿一个
  // Context 当 key 用：层表里没有这一项，于是"这个会话看得见哪些工具"永远答 undefined，
  // 隐藏与否都跟着错。
  //
  // 这里的 stub 把这条契约做成可判定的：`get` 只在第二个参数**就是那个 key** 时才认账。
  // 所以旧的 `get(name, agent.ctx)` 写法在这里一条工具都找不到，修复后能找到全部。
  const K_SCOPE = Symbol.for('test.dsh.scope');
  const visibilityModule = await import(pathToFileURL(join(here, 'internal', 'schema-visibility.mjs')).href);
  const { createSchemaVisibility, HIDEABLE_TOOL_NAMES } = visibilityModule;
  const HIDEABLE = HIDEABLE_TOOL_NAMES.length;

  /** An agent whose tools layer is keyed by scope, exactly like the host's. */
  const scopedAgent = (sessionId, { tag = `${sessionId}:scope` } = {}) => {
    const restrictCalls = [];
    const scopesSeen = [];
    return {
      tag,
      agent: {
        session: { id: sessionId },
        ctx: {
          [K_SCOPE]: tag,
          tools: {
            get(name, scope) {
              scopesSeen.push(scope);
              if (scope !== tag) return undefined;
              return HIDEABLE_TOOL_NAMES.includes(name) ? { name } : undefined;
            },
            restrict(filter) { restrictCalls.push(filter); return () => {}; },
          },
        },
      },
      restrictCalls,
      scopesSeen,
    };
  };

  const build = (options) => createSchemaVisibility({
    enabled: true,
    isEnabled: () => false,
    logger: undefined,
    onSessionDisposed: () => {},
    ...options,
  });

  // 生产路径：不传 `scopeOf`，用模块加载时从宿主包解析到的那份。
  const productionAgent = scopedAgent('session-production');
  const production = build({});
  production.sync(productionAgent.agent);
  check('the default path resolves the scope through the host scopeOf',
    productionAgent.scopesSeen.length === HIDEABLE && productionAgent.scopesSeen[0] === productionAgent.tag,
    `lookups=${productionAgent.scopesSeen.length} first=${String(productionAgent.scopesSeen[0])}`);
  check('so every visible tool is found and denied',
    productionAgent.restrictCalls.length === 1 && productionAgent.restrictCalls[0].deny.length === HIDEABLE,
    `restrict=${productionAgent.restrictCalls.length} deny=${productionAgent.restrictCalls[0]?.deny?.length}`);
  check('and the restriction is really applied', production.restrictedCount() === 1, String(production.restrictedCount()));
  check('the context itself is never handed over as a key',
    productionAgent.scopesSeen.every((scope) => typeof scope === 'string'),
    typeof productionAgent.scopesSeen[0]);

  // 显式覆盖：调用方给什么解析器就用什么。
  const overridden = scopedAgent('session-override');
  const override = build({ scopeOf: (ctx) => ctx[K_SCOPE] });
  override.sync(overridden.agent);
  check('an explicit scopeOf override is honoured',
    overridden.scopesSeen[0] === overridden.tag && overridden.restrictCalls.length === 1,
    `first=${String(overridden.scopesSeen[0])}`);

  // 兼容路径：解析器拿不到时退回旧的调用形态。它在这个 stub 里什么都找不到——这正是要显示的
  // 事实：**没有 scope 就答不出"这个会话看得见什么"**，而旧写法之所以"看起来在工作"，只是因为
  // 当时的测试桩忽略了第二个参数。能力本身不受影响：工具保持"可见但被拒"。
  const withoutResolver = scopedAgent('session-no-scope');
  const compat = build({ scopeOf: null });
  compat.sync(withoutResolver.agent);
  check('without a resolver the lookup still happens (compatibility path)',
    withoutResolver.scopesSeen.length === HIDEABLE && withoutResolver.scopesSeen[0] === withoutResolver.agent.ctx,
    `${withoutResolver.scopesSeen.length} lookups`);
  check('it passes the context, which a keyed layer cannot answer, and the capability survives',
    withoutResolver.restrictCalls.length === 0 && compat.toolSchemaState('session-no-scope') === 'visible',
    `restrict=${withoutResolver.restrictCalls.length} state=${compat.toolSchemaState('session-no-scope')}`);

  // 解析器抛错时同理：退回旧形态，不把能力弄坏。
  const throwing = scopedAgent('session-throwing');
  const tolerant = build({ logger: { warn: () => {} }, scopeOf: () => { throw new Error('no scope here'); } });
  tolerant.sync(throwing.agent);
  check('a throwing resolver degrades to the context instead of breaking the capability',
    throwing.scopesSeen.length === HIDEABLE && throwing.scopesSeen[0] === throwing.agent.ctx && tolerant.toolSchemaState('session-throwing') === 'visible',
    `lookups=${throwing.scopesSeen.length} state=${tolerant.toolSchemaState('session-throwing')}`);
}

console.log('\nlifting a restriction must call the host disposer (it is a function)');
{
  // 报告过的症状（别人拿这个包用不了的那一次）：芯片点开了，工具永远不出现。
  // 根因是插件里 `restricted.dispose?.()` —— 宿主 `tools.restrict()` 返回的是
  // cordis 的 Disposable，也就是**函数**（`Disposable<T> = () => T`），函数身上没有
  // `.dispose`，可选调用静默变成空操作：限制挂在 agent 的 fiber 上没摘，账本却记成
  // "visible"。这里的 stub 就是照那份契约写的（`() => disposed.push(true)`），
  // 所以旧写法一跑就红。释放后 `restrictedCount()` 必须回到 0：那个数才是"限制还在不在"
  // 的真相，而不是 `state` 账本。
  const { createSchemaVisibility } = await import(pathToFileURL(join(here, 'internal', 'schema-visibility.mjs')).href);
  let granted = false;
  const visibility = createSchemaVisibility({
    enabled: true,
    isEnabled: () => granted,
    logger: undefined,
    onSessionDisposed: () => {},
  });

  const { agent, restrictCalls, disposed } = stubAgent('session-disposer');
  visibility.sync(agent);
  check('off -> on: the restriction is counted as applied',
    restrictCalls.length === 1 && visibility.restrictedCount() === 1,
    `restrict=${restrictCalls.length} hidden=${visibility.restrictedCount()}`);

  granted = true;
  const answer = visibility.activate('session-disposer');
  check('on: activate calls the function-shaped disposer exactly once',
    disposed.length === 1, `disposed=${disposed.length}`);
  check('on: and the restriction is really gone, not just unbookkept',
    visibility.restrictedCount() === 0, `hidden=${visibility.restrictedCount()}`);
  check('on: toolSchemaState agrees with the released restriction',
    visibility.toolSchemaState('session-disposer') === 'visible' && answer === 'visible',
    `state=${visibility.toolSchemaState('session-disposer')} answer=${answer}`);

  // 关回去要真的重新挂上：一个已经被摘掉的限制不能只是从账本里消失了。
  granted = false;
  const again = visibility.sync(agent);
  check('off again: the restriction is re-applied',
    again === 'hidden' && restrictCalls.length === 2 && visibility.restrictedCount() === 1,
    `answer=${again} restrict=${restrictCalls.length} hidden=${visibility.restrictedCount()}`);

  visibility.releaseAll();
  check('releaseAll (plugin unload) lifts what is left and forgets the agents',
    disposed.length === 2 && visibility.restrictedCount() === 0 && visibility.liveAgentCount() === 0,
    `disposed=${disposed.length} hidden=${visibility.restrictedCount()} live=${visibility.liveAgentCount()}`);
}


console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
