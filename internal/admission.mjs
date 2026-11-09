/**
 * 派发准入（方案 4.5 / PR07）。
 *
 * 这一小块只回答一个问题：**这次调用现在还可以写进驱动吗**。看起来像一句 `if`，但它必须
 * 单独存在，因为它是"慢启动之后派发"和"撤权之后仍然写入"这两个 P0 缺陷的唯一防线：
 *
 *   - 调用开始时记下会话标识与授权代次（`capture`）；
 *   - 真正派发之前再比一次（`check`），而不是相信"开始时是有授权的"；
 *   - 中间不许夹一个未经保护的 `await`：所以调用点把 `capture` 放在 `call()` 的第一行，把
 *     `check` 放在 `instance.request(...)` 的前一行。
 *
 * 撤销会把代次 +1，重新授权不会回退它，于是"撤权 → 再授权"之间起跑的旧调用永远对不上号，
 * 不会因为开关又被打开而复活。
 *
 * 纯函数，没有 I/O：测试可以直接把三种状态各摆一遍，不必启动 worker。
 */

/** 准入失败的错误码，与既有后端错误码表一致。 */
export const ADMISSION_DENIED = 'ABORTED';

/**
 * 记下这次调用起跑时的许可。
 * @param sessionId - 会话标识（未归一化也可以）。
 * @param epoch - 当前授权代次。
 * @returns `{ sessionId, epoch }`。
 */
export function capture(sessionId, epoch) {
  return { sessionId: sessionId === undefined || sessionId === null ? '' : String(sessionId), epoch: Number.isFinite(epoch) ? epoch : 0 };
}

/**
 * 派发前复核。
 *
 * @param admission - `capture` 的结果。
 * @param state - `{ enabled, epoch, stopping }`：当前是否授权、当前代次、是否正在撤销。
 * @returns `null` 表示可以派发；否则是 `{ code, message }`。
 */
export function check(admission, state) {
  if (admission === null || admission === undefined) return null;
  if (state?.stopping === true) {
    return { code: ADMISSION_DENIED, message: 'the desktop was being stopped when this call reached dispatch, so nothing was sent — start again after the stop is complete' };
  }
  if (state?.enabled !== true) {
    return { code: ADMISSION_DENIED, message: '电脑操作 was turned off while this call was starting, so nothing was sent to the desktop' };
  }
  const current = Number.isFinite(state?.epoch) ? state.epoch : 0;
  if (current !== admission.epoch) {
    return { code: ADMISSION_DENIED, message: `the session's grant changed while this call was starting (epoch ${admission.epoch} -> ${current}), so nothing was sent to the desktop` };
  }
  return null;
}
