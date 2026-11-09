/**
 * 截图期间的视觉排除（方案 4.17.1 / PR10 尾项）。
 *
 * 第一道防线是系统能力：helper 的每个窗口都设了 `WDA_EXCLUDEFROMCAPTURE`，正常情况下截图里本来就
 * 没有覆盖层。这一层处理的是**第二道**：某些捕获后端不认那个标记，只能"捕获期间把像素收起来"。
 *
 * 三条规则，每条都有具体的失败样子：
 *
 *   1. **引用计数**：并发捕获时只有第一个负责隐藏、最后一个负责恢复。否则先结束的那次会把还在
 *      拍的窗口提前放出来，截图上就有半截横幅。
 *   2. **finally 一定恢复**：捕获抛错也必须恢复 —— 否则覆盖层会一直藏着，用户以为提示坏了。
 *   3. **代次核对**：恢复前比一下视觉代次；helper 在捕获期间重启过的话，旧的那次恢复不能把新
 *      覆盖层"复活"成旧状态（更糟的是把新代的窗口隐藏掉）。
 *
 * 它只做记账与调用，不认识 helper 协议，也不认识截图服务 —— 测试可以只给它两个假函数。
 */

/**
 * 建一份截图排除协调器。
 *
 * @param options - `{ suspend, resume, trace }`：两个 async 钩子，`trace(name, detail)` 可选。
 * @returns `{ begin, end, depth, suspended }`。
 */
export function createCaptureExclusion(options = {}) {
  const suspend = typeof options.suspend === 'function' ? options.suspend : async () => {};
  const resume = typeof options.resume === 'function' ? options.resume : async () => {};
  const trace = typeof options.trace === 'function' ? options.trace : () => {};
  /** 当前持有者：每个 token 一份，用来拒绝重复 end。 */
  const holders = new Set();
  let suspendedGeneration = null;
  let sequence = 0;
  let suspendFailures = 0;
  let resumeFailures = 0;

  /**
   * 开始一次捕获。
   *
   * @param generation - 当前视觉代次（helper 的代次；没有覆盖层时传 null）。
   * @returns token，交给 `end`。
   */
  async function begin(generation = null) {
    sequence += 1;
    const token = { id: sequence, generation };
    holders.add(token);
    if (holders.size === 1) {
      // 第一个持有者负责隐藏。隐藏失败不是致命错误：系统排除仍然在，记录后继续拍。
      try {
        await suspend();
        suspendedGeneration = generation;
        trace('capture.suspend', { generation });
      } catch (error) {
        suspendFailures += 1;
        suspendedGeneration = null;
        trace('capture.suspendFailed', { message: String(error?.message ?? error) });
      }
    }
    return token;
  }

  /**
   * 结束一次捕获；最后一个持有者恢复。
   *
   * @param token - `begin` 的返回值。
   * @returns `{ resumed, reason }`。
   */
  async function end(token) {
    if (token === undefined || token === null || !holders.has(token)) return { resumed: false, reason: 'unknown token' };
    holders.delete(token);
    if (holders.size > 0) return { resumed: false, reason: 'another capture is still running' };
    if (suspendedGeneration === null) return { resumed: false, reason: 'nothing was suspended' };
    const suspended = suspendedGeneration;
    suspendedGeneration = null;
    if (token.generation !== null && suspended !== null && token.generation !== suspended) {
      // 捕获期间 helper 换了代：旧的恢复不能去动新的窗口。
      trace('capture.resumeSkipped', { suspended, current: token.generation });
      return { resumed: false, reason: 'the visual generation changed while capturing' };
    }
    try {
      await resume();
      trace('capture.resume', { generation: suspended });
      return { resumed: true, reason: 'the last capture finished' };
    } catch (error) {
      resumeFailures += 1;
      trace('capture.resumeFailed', { message: String(error?.message ?? error) });
      return { resumed: false, reason: String(error?.message ?? error) };
    }
  }

  return {
    begin,
    end,
    /** 还有几次捕获没结束。 */
    get depth() {
      return holders.size;
    },
    /** 现在是否处于"像素被收起"的状态。 */
    get suspended() {
      return suspendedGeneration !== null;
    },
    /** 诊断：隐藏/恢复各自失败过几次。 */
    get failures() {
      return { suspend: suspendFailures, resume: resumeFailures };
    },
  };
}
