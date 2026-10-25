/**
 * 会话的 schema 可见性：能力关着时，让这个会话的 `computer_*` 工具**不占它的 schema 预算**。
 *
 * 已注册工具的 schema 会随该会话的每个请求发出去，所以一个"这个会话根本不能调"的工具是纯开销：
 * 实测那一轮里，这一族占了每请求 20,990 个 schema token 中的 15,054。做法是 `tools.restrict`
 * 只把工具从**这一个 agent 的视野**里摘掉——定义仍然注册着、调用照样被拒，开关一打开立刻恢复。
 *
 * 从 `index.js` 搬出来（§10 宿主半边拆分）。模块只管"每个会话现在是什么状态"，
 * 不认识 ctx、不认识事件：谁在 agent 创建/销毁时调用它，由入口决定（那边才是装配）。
 */
import { sessionKey } from './sessions.mjs';
import { importHostModule, hostResolution, HOST_CODES } from './host-packages.mjs';

/**
 * 宿主 `dsh-scope` 的 `scopeOf(ctx)`：把 Context 上那个按作用域索引的 **key** 取出来。
 *
 * 为什么必须是它、而不是 `agent.ctx`：宿主 `dsh-tools` 的 `get(name, scope)` 会把第二个参数
 * 直接交给按作用域 key 索引的工具层，`dsh-scope` 则用 `scopeOf(ctx)` 拿到 Context 上的真实
 * key（`lib/index.js` 里就是 `ctx[kScope]`）。把 `agent.ctx` 本身传进去，等于把一个 Context
 * 对象当成 key 用：查不到这个会话的继承关系与限制，于是"这个组合里到底有没有这个工具"这个
 * 问题的答案就变成了猜测——隐藏与否都会跟着错。
 *
 * 解析放在模块加载时做一次，而且**允许失败**：`dsh-scope` 是宿主共享包，正常情况下一定在；
 * 但一个装不出来的环境不应该因此整个插件都起不来（这个包还背着 token-guard 与 app-launch）。
 * 解析不到时 {@link visibleOwnToolNames} 退回旧的调用形态，行为与修复前一致，不会更坏。
 * @type {((ctx: unknown) => unknown) | undefined}
 */
let hostScopeOf;
/** 解析失败时的结构化事实：doctor / status 用它区分“能读到清单”与“真的导入了”。 */
let hostScopeError;
try {
  ({ scopeOf: hostScopeOf } = await importHostModule('@deepseek-ai/dsh-scope'));
} catch (error) {
  hostScopeOf = undefined;
  hostScopeError = error;
}

/**
 * `dsh-scope` 的解析结果。
 *
 * 1.40.2 在这里用了裸 `import('@deepseek-ai/dsh-scope')`：`link:` 安装时必然失败，失败又被
 * `catch` 吞掉，于是 `packageInfo()` 能读到清单、doctor 显示“可解析”，而实际作用域隔离是
 * 降级的——这正是研究报告里点名的“把导入失败伪装成正常”。1.40.3 改走统一解析器，并把结果
 * 作为事实报出去。
 * @returns {{ resolved: boolean, degraded: boolean, code: string, error: string, resolution: unknown }}
 */
export function scopeResolution() {
  return {
    resolved: typeof hostScopeOf === 'function',
    degraded: typeof hostScopeOf !== 'function',
    code: typeof hostScopeOf === 'function' ? '' : (hostScopeError?.code ?? HOST_CODES.PACKAGE_NOT_RESOLVED),
    error: hostScopeError === undefined ? '' : String(hostScopeError?.message ?? hostScopeError),
    resolution: hostResolution('@deepseek-ai/dsh-scope') ?? null,
  };
}

/**
 * 能力关着时可以隐藏的工具。
 *
 * `tools.get` 会把这份组合里不存在的名字过滤掉，所以这里可以列全。
 * 浏览器两个工具走同一道会话门（§14）：把浏览器交给模型，和把鼠标交给它是同一量级的步骤。
 */
export const HIDEABLE_TOOL_NAMES = [
  'computer_screenshot', 'computer_actions', 'computer_click', 'computer_drag',
  'computer_scroll', 'computer_type', 'computer_key', 'computer_windows', 'computer_ui',
  'computer_ui_action', 'computer_clipboard', 'computer_paste', 'computer_launch',
  'computer_stop',
  'browser_state', 'browser_actions',
];

/**
 * 摘掉一条限制。**这是本模块唯一正确的释放姿势**，所以它单独成函数、两个调用点共用。
 *
 * 宿主 `tools.restrict()` 的实现是 `return this.layers.effect(...)`，而 cordis 的
 * `ctx.effect(fn)` 返回的是**函数**（`type Disposable<T> = () => T`，lib/index.js 里由
 * `defineProperty(() => {...}, symbols.effect, meta)` 造出来）。函数身上既没有 `.dispose`
 * 属性也没有 `[Symbol.dispose]`，所以 `restricted.dispose?.()` 会静默变成空操作——
 * 限制挂上去、再也没摘下来，而账本已经记成"恢复可见"（芯片是亮的、工具永远不出现）。
 *
 * 两种形态都认（函数优先，顺带兼容 `.dispose()` 对象形态的 stub / 旧宿主）。
 * @param {*} disposable - `tools.restrict()` 的返回值。
 * @throws 透传释放时的异常，由调用方按各自的语义处理。
 */
function liftRestriction(disposable) {
  if (typeof disposable === 'function') disposable();
  else if (typeof disposable?.dispose === 'function') disposable.dispose();
}

/**
 * @param options.enabled - 配置项 `hideToolSchemasWhenOff !== false`；false 表示保持"一直可见"。
 * @param options.isEnabled - `(sessionId) => boolean`，问这个会话的能力开着没有。
 * @param options.logger - 可选的 ctx.logger。
 * @param options.onSessionDisposed - 会话销毁时的额外清理（浏览器通道那条）。
 * @param options.scopeOf - 覆盖宿主 `scopeOf` 的实现。生产环境不传（`undefined`），用模块加载时
 *   解析到的那份；传 `null` 表示**明确没有**解析器，用于逼出兼容分支；传函数则用它。测试靠这个
 *   开关，在不依赖真实宿主包解析结果的前提下钉住"第二个参数是 scope key"这条契约。
 */
export function createSchemaVisibility({ enabled, isEnabled, logger, onSessionDisposed, scopeOf: scopeOfOption }) {
  /** 解析作用域 key 的实现：`undefined` 取宿主那份，`null` 表示没有，函数则原样使用。 */
  const resolveScope = scopeOfOption === undefined ? hostScopeOf : scopeOfOption;
  /** sessionKey -> `agent.ctx.tools.restrict()` 返回的 disposable（**函数**，见 {@link release}）。 */
  const hidden = new Map();
  /** sessionKey -> 活着的 agent，好让芯片开关能触到正确的 scope。 */
  const liveAgents = new Map();
  /** sessionKey -> 最近一次应用的可见性状态（控制块用）。 */
  const state = new Map();

  /**
   * 这个 agent 的视野里真的有本插件的哪些工具。
   *
   * 第二个参数交给 `tools.get` 的必须是**作用域 key**，不是 Context（见 {@link hostScopeOf}）。
   * 三种情形分开处理，因为它们的正确取值并不一样：
   *
   *   * 解析器可用且返回 key —— 用 key；
   *   * 解析器可用但返回 `undefined` —— 这个 Context 本来就没有作用域，把 `undefined` 原样传下去，
   *     让工具层按它自己的"无作用域"语义回答，而不是塞一个假 key；
   *   * 解析器不可用或抛错 —— 退回旧的调用形态，保持兼容。
   * @param agent - 被问的 agent。
   * @returns {@link HIDEABLE_TOOL_NAMES} 中在这里能解析到的那些。
   */
  function visibleOwnToolNames(agent) {
    const tools = agent?.ctx?.tools;
    if (tools === undefined || typeof tools.get !== 'function') return [];
    let scope = agent.ctx;
    if (typeof resolveScope === 'function') {
      try {
        scope = resolveScope(agent.ctx);
      } catch (error) {
        logger?.warn?.('computer-use: reading the session scope failed, falling back to the context: %s', String(error));
        scope = agent.ctx;
      }
    }
    const names = [];
    for (const name of HIDEABLE_TOOL_NAMES) {
      try {
        if (tools.get(name, scope) !== undefined) names.push(name);
      } catch {
        /* 这份组合不认识的名字，就不去拒绝它 */
      }
    }
    return names;
  }

  /**
   * 让一个 agent 的工具可见性对齐它会话当前的授权。
   *
   * 幂等：agent 创建时、每次芯片开关、以及每个工具调用里的授权检查都会调它，所以一个早于本插件
   * 监听器存在的会话，也会在它下一次调用时收敛。
   * @param agent - 要同步的活 agent。
   * @returns 应用后的状态（'advertised' / 'visible' / 'hidden'）。
   */
  function sync(agent) {
    // 同步一个 agent 的同时把它登记下来：`agentOf` 是「点亮芯片」唯一能找到 agent 的路径，
    // 而登记过去只发生在 `agent/created` 监听器里。会话恢复、事件面缺失、插件晚于 agent 挂载
    // 这三种时序都会让那次登记错过，于是限制挂上却再没人摘得下来——芯片点亮、工具永远不出现。
    // 任何一次 sync 都是一次真实的接触，所以接触即登记，比只靠一个事件面结实。
    if (agent?.session?.id !== undefined && agent.session.id !== null) {
      liveAgents.set(sessionKey(agent.session.id), agent);
    }
    if (!enabled) return 'advertised';
    const key = sessionKey(agent?.session?.id);
    const restricted = hidden.get(key);
    if (isEnabled(agent?.session?.id)) {
      if (restricted !== undefined) {
        try {
          liftRestriction(restricted);
        } catch (error) {
          logger?.warn?.('computer-use: releasing the tool restriction failed: %s', String(error));
        }
        hidden.delete(key);
        state.set(key, 'visible');
      }
      return 'visible';
    }
    if (restricted !== undefined) return 'hidden';
    const names = visibleOwnToolNames(agent);
    if (names.length === 0) return 'visible';
    try {
      const disposable = agent.ctx.tools.restrict({ deny: names });
      hidden.set(key, disposable);
      state.set(key, 'hidden');
      logger?.info?.('computer-use: session %s hides %d tool schema(s) while 电脑操作 is off', key, names.length);
      return 'hidden';
    } catch (error) {
      // 没有带作用域的 tools 服务、或某个名字被它拒绝，都不该把能力本身弄坏：
      // 工具保持"可见但被拒"。
      logger?.warn?.('computer-use: could not hide tool schemas for %s: %s', key, String(error));
      state.set(key, 'visible');
      return 'visible';
    }
  }

  /**
   * 用户把芯片点开：让这个会话的工具立刻回来。
   *
   * 与直接 `sync(agentOf(key))` 的差别只有一处，但正是出事的那一处：**找不到 agent 时不再什么都不做**。
   * 限制的 disposer 不依赖 agent，留着它只会让"用户已经说了可以"这一个事实被本地记账吃掉，
   * 于是芯片是亮的、工具永远不出现。找不到 agent 就地释放，agent 之后出现时 `sync` 会按同一个
   * 授权值重新算——开着就不会再挂回去。
   * @param sessionId - 被点开授权的那一个会话。
   * @returns 'visible'（已对齐）、'advertised'（配置关掉了隐藏，本来就一直可见）、
   *          或 'unbound'（没有活 agent，限制已就地释放）。
   */
  function activate(sessionId) {
    const key = sessionKey(sessionId);
    const agent = liveAgents.get(key);
    if (agent !== undefined && enabled) {
      const next = sync(agent);
      // 'hidden' 在这里理论上不可达（同一次调用里授权值已经是 true），真出现了也照样放行，
      // 所以第二次机会落在下面的 release 上，而不是停在"没找到 agent"的分支上。
      if (next !== 'hidden') return next;
    }
    release(key);
    return agent === undefined ? 'unbound' : enabled ? 'visible' : 'advertised';
  }

  /**
   * 用户把芯片关掉：让这个会话重新为它的 schema 付费。
   *
   * 找不到活 agent 时没有任何东西可以摘——`agent/created` 与 `requireGrant` 都会在 agent
   * 第一次露面时对齐到当前授权值，所以这里的安全动作是清掉本地可能的残留、等它自己收敛。
   * @param sessionId - 被关掉的那一个会话。
   * @returns 'visible' / 'hidden' / 'unbound'。
   */
  function deactivate(sessionId) {
    const key = sessionKey(sessionId);
    const agent = liveAgents.get(key);
    if (agent !== undefined) return sync(agent);
    release(key);
    return 'unbound';
  }

  /**
   * 撤掉一个会话持有的限制（会话销毁、芯片关闭、插件卸载时）。
   *
   * 释放走 {@link liftRestriction}：宿主给的是**函数**，`restricted.dispose?.()` 是空操作
   * （这正是"芯片亮了、工具永远不出现"的根因）。
   */
  function release(key) {
    const restricted = hidden.get(key);
    if (restricted === undefined) return;
    try {
      liftRestriction(restricted);
    } catch (error) {
      logger?.warn?.('computer-use: releasing the tool restriction failed: %s', String(error));
    }
    hidden.delete(key);
    state.set(key, 'visible');
  }

  /** agent 创建：记下它，并同步一次。 */
  function remember(agent) {
    if (agent?.session?.id === undefined) return;
    liveAgents.set(sessionKey(agent.session.id), agent);
    sync(agent);
  }

  /** agent 销毁：清掉它的限制与登记，并让入口做它自己的清理（浏览器通道）。 */
  function forget(agent) {
    const key = sessionKey(agent?.session?.id);
    liveAgents.delete(key);
    release(key);
    state.delete(key);
    onSessionDisposed?.(String(agent?.session?.id ?? ''));
  }

  /** 插件卸载：把还留着的限制全部撤掉。 */
  function releaseAll() {
    for (const key of [...hidden.keys()]) release(key);
    liveAgents.clear();
  }

  /** 控制块要的那一格：'hidden' / 'visible'（配置关掉时为 'advertised-by-config'）。 */
  function toolSchemaState(key) {
    return enabled ? (hidden.has(key) ? 'hidden' : 'visible') : 'advertised-by-config';
  }

  return {
    // 入口要用它决定"要不要接 agent 事件、要不要警告没有事件面"——所以必须暴露出去
    // （漏掉它时两条 `if` 都会跳过，于是**根本没有接线**，而这个失败只在行为断言里才看得见）。
    enabled,
    sync,
    activate,
    deactivate,
    release,
    remember,
    forget,
    releaseAll,
    toolSchemaState,
    agentOf: (key) => liveAgents.get(key),
    visibleOwnToolNames,
    /** 现在有多少个活 agent 登记在案：0 表示"点亮芯片"只能靠就地释放这条兜底路。 */
    liveAgentCount: () => liveAgents.size,
    /** 现在有多少个会话的工具 schema 正被摘掉：关着的时候它等于"开着电脑操作的会话数的反面"。 */
    restrictedCount: () => hidden.size,
  };
}
