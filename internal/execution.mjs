/**
 * 执行协调：一个会话"正在跑什么"、以及"停"到底停掉了什么（9.txt §5.1 / §5.12 / §10 的执行协调那块）。
 *
 * 三件事在这里：
 *
 *   1. **在飞登记**：每次调用把自己的 AbortController 登记到会话名下。芯片开关与 `computer_stop`
 *      都表示"停"，而只翻一个标志位的停不是停——worker 里已经排上队的东西照样会驱动桌面。撤销时
 *      先中止这些调用：传输层丢掉还没写出去的（没写的永远不会发生），并让 worker 在下一个步骤边界
 *      停下（批次在步骤之间停）。
 *   2. **两个通道共用一份登记**：桌面调用走 `call()`，浏览器工具走另一条通道，最初两边各记各的，
 *      于是 `computer_stop` 只停掉了桌面那一半，浏览器序列还在跑（§5.1）。现在一个登记表、一个合并
 *      信号、一个截止时间，对两条通道含义一致。
 *   3. **停止中的状态**：撤销期间会话标记为 `stopping`，好让芯片说"停止中"而不是"已停止"。
 *
 * 从 `index.js` 搬出来（§10 宿主半边拆分）。它不认识后端、不认识路由：真正"让停止落地"的那一步
 * （取消 worker 队列、请求释放仍按住的输入）留在入口，因为那需要后端句柄。
 */
import { sessionKey } from './sessions.mjs';

/**
 * 合并若干中止信号，好让一次撤销能停掉模型从未取消的调用。
 * @param signals - 任意多个信号，允许出现 undefined/null。
 * @returns 任一信号中止即中止的那一个信号；一个都没有时返回 undefined。
 */
export function combineSignals(...signals) {
  const list = signals.filter((signal) => signal !== undefined && signal !== null);
  if (list.length === 0) return undefined;
  if (list.length === 1) return list[0];
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(list);
  const controller = new AbortController();
  for (const signal of list) {
    if (signal.aborted === true) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

/** 一句短语描述这次调用，给芯片的控制状态用。 */
export function describeCall(cmd, args) {
  if (cmd === 'batch') return `${Array.isArray(args?.steps) ? args.steps.length : 0} step(s)`;
  if (cmd === 'click') return `click (${args?.x},${args?.y})`;
  if (cmd === 'drag') return `drag (${args?.fromX},${args?.fromY})->(${args?.toX},${args?.toY})`;
  if (cmd === 'type' || cmd === 'paste') return `${cmd} ${String(args?.text ?? '').length} char(s)`;
  if (cmd === 'key') return `key ${args?.keys}`;
  if (cmd === 'scroll') return `scroll ${args?.direction}`;
  if (cmd === 'focus') return `focus hwnd=${args?.hwnd}`;
  if (cmd === 'launch') return `launch ${args?.target}`;
  if (cmd === 'uiact') return `uiact ${args?.action}`;
  if (cmd === 'clipboard') return `clipboard ${args?.op ?? 'get'}`;
  return cmd;
}

/**
 * 建立一份执行登记表（每个插件实例一份）。
 * @returns 登记、计数、停止状态与"在会话上下文里跑一次非 worker 调用"的接口。
 */
export function createExecutionRegistry() {
  /** sessionKey -> 该会话在飞调用的 AbortController 集合。 */
  const inFlight = new Map();
  /** 正在撤销（"停止中"）的会话。 */
  const stopping = new Set();

  /**
   * 登记一次调用。
   * @param sessionId - 会话标识（会被归一化）。
   * @param controller - 该调用的 AbortController。
   * @returns 注销函数（调用结束时必须调一次）。
   */
  function track(sessionId, controller) {
    const key = sessionKey(sessionId);
    let set = inFlight.get(key);
    if (set === undefined) {
      set = new Set();
      inFlight.set(key, set);
    }
    set.add(controller);
    return () => {
      set.delete(controller);
      if (set.size === 0) inFlight.delete(key);
    };
  }

  /**
   * 这个会话有多少调用在飞。匿名会话（`''`）返回**所有**会话的合计——那是"整台机器现在忙不忙"。
   * @param sessionId - 会话标识。
   * @returns 数量。
   */
  function count(sessionId) {
    const key = sessionKey(sessionId);
    if (key === '') {
      let total = 0;
      for (const set of inFlight.values()) total += set.size;
      return total;
    }
    return inFlight.get(key)?.size ?? 0;
  }

  /**
   * 中止这个会话的在飞调用（撤销的第二步）。
   * @param sessionId - 会话标识。
   * @param reason - 记在被中止调用上的原因。
   * @returns 被中止的调用数。
   */
  function abort(sessionId, reason) {
    const key = sessionKey(sessionId);
    const controllers = [...(inFlight.get(key) ?? [])];
    for (const controller of controllers) controller.abort(new Error(reason));
    return controllers.length;
  }

  /** 这个会话是否正在撤销（芯片据此显示"停止中"）。 */
  const isStopping = (sessionId) => stopping.has(sessionKey(sessionId));
  /** 标记撤销开始。 */
  const beginStop = (sessionId) => stopping.add(sessionKey(sessionId));
  /** 标记撤销结束。 */
  const endStop = (sessionId) => stopping.delete(sessionKey(sessionId));

  /**
   * 在会话的执行上下文里跑一次**非 worker** 调用（浏览器通道）。
   *
   * 桌面调用由 `call()` 登记；浏览器工具走另一条通道，最初谁也没登记——于是"停"只停掉桌面那一半。
   * 这里给它同一个登记表、同一个合并信号、同一个截止时间。
   * @param exec - 工具执行上下文；它的 signal 是调用方自己的。
   * @param options - `{ timeoutMs, label }`。
   * @param body - `({ signal, deadline }) => Promise<T>`。
   * @returns `body` 的返回值。
   */
  async function runSessionCall(exec, options, body) {
    const sessionId = String(exec?.agent?.session?.id ?? '');
    const controller = new AbortController();
    const untrack = track(sessionId, controller);
    // 兜底截止时间：一个挂住的浏览器调用不能永远占着这个会话的在飞记录（以及随之而来的"停止中"）。
    const requested = Number(options?.timeoutMs);
    const budgetMs = Number.isFinite(requested) && requested > 0 ? requested : 60_000;
    const label = String(options?.label ?? 'the browser call');
    const timer = setTimeout(() => {
      controller.abort(new Error(`${label} exceeded its ${budgetMs} ms deadline`));
    }, budgetMs);
    if (typeof timer.unref === 'function') timer.unref();
    const signal = combineSignals(exec?.signal, controller.signal);
    try {
      return await body({ signal, deadline: Date.now() + budgetMs });
    } finally {
      clearTimeout(timer);
      untrack();
    }
  }

  return { track, count, abort, isStopping, beginStop, endStop, runSessionCall };
}
