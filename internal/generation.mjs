/**
 * 代次（generation）与"进程真的没了"的判据 —— 方案 4.4 / PR04，后续 PR06 的生长点。
 *
 * 方案给这一段的结论很直接：`#exited` 保存的是 `wait.finally(...)` 返回的**新** Promise，却拿
 * `wait` 去比较清空，两者永不相等，于是引用永远留着；下一次停止拿到上一代已经 resolve 的
 * Promise，会立刻认为"进程已退出"，把停止报告写成一个假事实。
 *
 * 修那一行当然能过测试，但把"等待某一代退出"这件事留在一个类的私有字段里，就注定没法在
 * 没有真实进程的测试里证明它。所以这里把它抽成一个有明确契约的小对象：
 *
 *   - **按 child 识别**：等待只对调用它的那个进程生效，A 的迟到 exit 不能结束 B 的等待；
 *   - **一个 child 一个 Promise**：同一个进程重复 stop 拿到同一个 Promise（幂等），不会挂两个
 *     监听器、也不会因为第一次已经结束就把第二次当成"立刻退出"；
 *   - **显式结果**：`'exited'` / `'error'` / `'timeout'` / `'absent'`，调用方不必从"Promise 解
 *     析了"推断是否确认退出 —— 这正是方案要求"不能把计时结束当成停止完成"的那条。
 *
 * 计时器默认 2 秒，沿用现有兜底值，但它现在是"等待预算用尽"这个**结果**，不是"已退出"。
 */

/** 等待一个进程退出的默认预算（沿用既有 2 秒兜底）。 */
export const EXIT_TIMEOUT_MS = 2_000;

/**
 * 建立一份退出等待器。
 * @param options - `{ timeoutMs }`。
 * @returns `{ waitForExit, busy, currentChild }`。
 */
export function createExitWaiter(options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? Number(options.timeoutMs) : EXIT_TIMEOUT_MS;
  /** 当前正在等的那一个：`{ child, promise }`，只在等待期间存在。 */
  let current = null;

  /**
   * 等这个进程结束。
   * @param child - 任何带 `once(event, fn)` 与 `exitCode` 的进程对象（测试可以给假的）。
   * @returns `'exited' | 'error' | 'timeout' | 'absent'`。
   */
  function waitForExit(child) {
    if (child === null || child === undefined) return Promise.resolve('absent');
    if (current !== null && current.child === child) return current.promise;
    if (child.exitCode !== null && child.exitCode !== undefined) return Promise.resolve('exited');
    let settle;
    const raw = new Promise((resolve) => {
      let done = false;
      const finish = (how) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(how);
      };
      settle = finish;
      const timer = setTimeout(() => finish('timeout'), timeoutMs);
      timer.unref?.();
      child.once('exit', () => finish('exited'));
      child.once('error', () => finish('error'));
    });
    const promise = raw.finally(() => {
      // 只清掉**自己这一份**：旧代码在这里比较的是被 finally 派生的那个新 Promise 之前的原
      // Promise，永远不相等，引用就永远留着（方案 1.2 第三条）。比较 `current.promise` 才是
      // "清空属于这次等待的记录"。
      if (current !== null && current.promise === promise) current = null;
    });
    current = { child, promise, settle };
    return promise;
  }

  return {
    waitForExit,
    /** 是否有一次等待还没结束。 */
    get busy() {
      return current !== null;
    },
    /** 正在等的进程（没有则为 null），用于诊断与代次核对。 */
    get currentChild() {
      return current?.child ?? null;
    },
  };
}
