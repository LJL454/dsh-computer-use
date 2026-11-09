/**
 * 一代 worker 的停止协议（方案 4.4 / PR06）。
 *
 * 旧实现的停止是"发 shutdown，800 毫秒后 kill"：没有准入关闭，没有协作等待与强制终止的分界，
 * 也没有"退出确认"与"输入释放确认"这两件不同的事。于是一条卡在 UIA 里的调用被杀掉之后，
 * 回执只能说"停了"，说不出"进程真的没了"和"按住的键真的松了"。
 *
 * 这里把方案第 4.4 节的六步做成一个**有预算、有报告**的函数，且与具体进程无关：
 *
 *   1. 关闭该代的新请求准入，未派发的请求按调用方要求记为取消并移出队列；
 *   2. 对已派发的请求协作取消，按协作预算等待；到期就终止受控旧进程；
 *   3. 等待**实际退出事件**，记录 `exitConfirmed`；超过退出预算仍无法确认则 `faulted`；
 *   4. 在旧进程不可能再产生输入之后，按该代 held-input 清单运行独立释放程序；
 *   5. 分别记录 `releaseConfirmed`、释放的键/按钮、错误与耗时；
 *   6. 根据报告释放资源或保持隔离；新代不得复用旧的取消文件与引用代次。
 *
 * 三个预算（协作 0.8 s / 退出确认 2 s / 释放 5 s）是**建议起始值**，不是性能保证：调用方可以
 * 覆盖它们，报告里带着每一步的实际耗时，实机 P95 出来之后再调。
 *
 * 这个模块不认识 `PowerShellBackend`：它只拿到几个钩子和一个 Generation，于是"停止顺序"可以在
 * 没有真实进程的测试里被逐步断言。
 */

/** 停止预算的默认值（方案 4.4 的建议起始值）。 */
export const STOP_BUDGETS = Object.freeze({
  cooperativeMs: 800,
  exitMs: 2_000,
  releaseMs: 5_000,
});

/** 一代 worker 的生命周期状态。 */
export const GENERATION_STATES = Object.freeze(['idle', 'starting', 'ready', 'stopping', 'stopped', 'faulted']);

/** 用预算包住一个 promise，不抛：超时是结果，不是异常。 */
async function withBudget(promise, ms) {
  let timer = null;
  const budget = new Promise((resolve) => {
    // 这个计时器**不** unref：它是这次停止的截止时间，必须能独立触发 —— 被它包住的钩子可能永远
    // 不返回（卡在 UIA 里的调用正是如此），而"没人再持有事件循环"的时刻恰恰是最该结束等待的时刻。
    timer = setTimeout(() => resolve({ timedOut: true }), Math.max(1, ms));
  });
  try {
    const value = await Promise.race([Promise.resolve(promise).then((result) => ({ timedOut: false, value: result })), budget]);
    return value;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/**
 * 一代 worker。
 *
 * 它只持有身份与状态，不持有进程句柄之外的任何能力：进程由调用方创建并交给它，停止由
 * `stopGeneration` 驱动。这样"哪一代"永远能和"哪个 PID、哪个取消文件、哪些引用"对上号。
 */
export class Generation {
  /**
   * @param options - `{ id, child, budgets }`。
   */
  constructor(options = {}) {
    this.id = Number.isFinite(options.id) ? options.id : 1;
    this.child = options.child ?? null;
    this.budgets = { ...STOP_BUDGETS, ...(options.budgets ?? {}) };
    this.startedAt = Date.now();
    this.readyAt = null;
    this.stoppedAt = null;
    this.state = 'idle';
    this.report = null;
    this.stopPromise = null;
    this.reason = null;
  }

  /** 进入 starting（进程已创建，还没等到 ready）。 */
  markStarting() {
    if (this.state === 'idle' || this.state === 'stopped' || this.state === 'faulted') this.state = 'starting';
    return this.state;
  }

  /** 收到 ready 行。 */
  markReady() {
    this.state = 'ready';
    this.readyAt = Date.now();
    return this.state;
  }

  /** 进入 stopping（准入已关闭）。 */
  markStopping(reason) {
    if (this.state !== 'stopped' && this.state !== 'faulted') {
      this.state = 'stopping';
      this.reason = reason ?? this.reason;
    }
    return this.state;
  }

  /** 停止完成，且退出与释放都得到确认。 */
  markStopped() {
    this.state = 'stopped';
    this.stoppedAt = Date.now();
    return this.state;
  }

  /** 停止没有完成（退出未确认、或释放失败到无法继续）。 */
  markFaulted(reason) {
    this.state = 'faulted';
    this.stoppedAt = Date.now();
    this.reason = reason ?? this.reason;
    return this.state;
  }

  /** 这一代是否还能接受新请求。 */
  get admitsRequests() {
    return this.state === 'starting' || this.state === 'ready';
  }
}

/**
 * 按六步停止一代 worker。
 *
 * 钩子（全部可选，缺省视为"无事可做"），顺序即方案 4.4 的顺序：
 *   - `closeAdmission(reason)` → 关闭准入；返回被取消的未派发请求数；
 *   - `cancelInFlight(reason)` → 对已派发请求协作取消（写取消标记、发信号）；
 *   - `waitForDrain(ms)` → 在协作预算内等它们结束；
 *   - `kill()` → 终止受控旧进程；
 *   - `waitForExit()` → 返回 `'exited'|'error'|'timeout'|'absent'`；
 *   - `release(ms)` → 独立释放 held input，返回 `{ releaseConfirmed, released, releaseError }`；
 *   - `cleanup()` → 清监听器、临时标记、引用代次。
 *
 * @param generation - 要停止的那一代。
 * @param hooks - 见上；`reason` 一并接受。
 * @returns 停止报告（幂等：同一代重复调用拿到同一份报告）。
 */
export async function stopGeneration(generation, hooks = {}) {
  if (generation === null || generation === undefined) {
    return { generation: null, reason: hooks.reason ?? '', admissionClosed: false, cancelled: 0, cooperative: 'absent', exitConfirmed: true, exitHow: 'absent', releaseConfirmed: null, released: [], releaseError: undefined, state: 'stopped', faulted: false, ms: 0, steps: [] };
  }
  if (generation.report !== null) return generation.report;
  if (generation.stopPromise !== null) return generation.stopPromise;

  const started = Date.now();
  const budgets = { ...generation.budgets, ...(hooks.budgets ?? {}) };
  const reason = String(hooks.reason ?? 'the worker was stopped');
  const steps = [];
  /** 跑一步，记录耗时与结果；钩子抛错不会中断停止流程。 */
  const step = async (name, body) => {
    const at = Date.now();
    const record = { name, ms: 0, ok: true };
    try {
      const value = await body();
      Object.assign(record, value === undefined || value === null ? {} : (typeof value === 'object' ? value : { value }));
    } catch (error) {
      record.ok = false;
      record.error = String(error?.message ?? error);
    }
    record.ms = Date.now() - at;
    steps.push(record);
    return record;
  };

  const run = async () => {
    generation.markStopping(reason);
    // 1. 关闭准入：此后不再接受新请求；未派发的请求由调用方决定是否取消。
    const closed = await step('close-admission', async () => (typeof hooks.closeAdmission === 'function' ? { cancelled: Number(await hooks.closeAdmission(reason)) || 0 } : { cancelled: 0 }));
    // 2. 协作取消，按预算等待；到期就进入强制终止。
    const cancelling = await step('cancel-in-flight', async () => (typeof hooks.cancelInFlight === 'function' ? { signalled: (await hooks.cancelInFlight(reason)) !== false } : { signalled: false }));
    const drained = typeof hooks.waitForDrain === 'function'
      ? await step('cooperative-wait', async () => {
        const outcome = await withBudget(hooks.waitForDrain(budgets.cooperativeMs), budgets.cooperativeMs);
        return { cooperative: outcome.timedOut === true ? 'timeout' : 'drained', drained: outcome.timedOut !== true };
      })
      : { cooperative: 'not-applicable', drained: true };
    // 3. 终止受控旧进程，并等待**实际退出**。协作没用完也照样终止：单线程 worker 里阻塞的
    //    调用只能靠结束进程来停。
    await step('terminate', async () => {
      if (typeof hooks.kill === 'function') hooks.kill();
      return { killed: true };
    });
    const exit = await step('await-exit', async () => {
      if (typeof hooks.waitForExit !== 'function') return { exitHow: 'absent', exitConfirmed: true };
      const outcome = await withBudget(hooks.waitForExit(), budgets.exitMs);
      if (outcome.timedOut === true) return { exitHow: 'timeout', exitConfirmed: false };
      const how = String(outcome.value ?? 'exited');
      return { exitHow: how, exitConfirmed: how === 'exited' || how === 'absent' };
    });
    // 4. 释放仍然被按住的输入。退出没被确认时也照样尝试 —— 键可能还按着，而"没确认退出"不是
    //    "还该继续按着"的理由；报告里会同时写明 exitConfirmed 与 releaseAfterExit。
    const release = await step('release', async () => {
      if (typeof hooks.release !== 'function') return { releaseConfirmed: null };
      const outcome = await withBudget(hooks.release(budgets.releaseMs), budgets.releaseMs);
      if (outcome.timedOut === true) return { releaseConfirmed: false, releaseError: `the release did not answer within ${budgets.releaseMs} ms` };
      const value = outcome.value ?? {};
      return {
        releaseConfirmed: value.releaseConfirmed === true,
        released: Array.isArray(value.released) ? value.released.map(String) : [],
        releaseError: value.releaseError === undefined ? undefined : String(value.releaseError),
      };
    });
    // 5. 清理监听器与临时标记；新代不复用旧的取消文件。
    const cleanup = await step('cleanup', async () => {
      if (typeof hooks.cleanup === 'function') await hooks.cleanup();
      return { cleaned: true };
    });

    const exitConfirmed = exit.exitConfirmed === true;
    const faulted = exitConfirmed !== true;
    if (faulted) generation.markFaulted(`the process did not confirm exit (${exit.exitHow ?? 'unknown'})`);
    else generation.markStopped();

    const report = {
      generation: generation.id,
      reason,
      admissionClosed: closed.ok === true,
      cancelled: Number(closed.cancelled ?? 0),
      cooperative: drained.cooperative ?? 'not-applicable',
      cancelled_in_flight: cancelling.signalled === true,
      exitConfirmed,
      exitHow: exit.exitHow ?? 'unknown',
      releaseConfirmed: release.releaseConfirmed === undefined ? null : release.releaseConfirmed === true,
      released: Array.isArray(release.released) ? release.released : [],
      releaseError: release.releaseError,
      releaseAfterExit: exitConfirmed,
      cleaned: cleanup.cleaned === true,
      state: generation.state,
      faulted,
      ms: Date.now() - started,
      steps,
    };
    generation.report = report;
    return report;
  };

  generation.stopPromise = run().finally(() => { generation.stopPromise = null; });
  return generation.stopPromise;
}
