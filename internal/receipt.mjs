/**
 * 回执（方案 4.3 / PR05）。
 *
 * 这一层要回答的问题只有一句：**这次调用到底走到哪一步了**。旧实现把三件不同的事混成一个
 * `dispatched: true`：请求写进了管道、worker 收到并开始执行、GUI 副作用真的发生。混在一起的
 * 后果不是"信息少"，而是**错误的恢复策略**——一个"可能已经点下去"的调用被当普通失败重试，
 * 就是第二次点击。
 *
 * 所以这里把状态拆成互相独立的几轴，并且都只是数据：
 *
 *   - `delivery`：`not_sent` → `sent_to_driver` → `driver_ack`，另加 `unknown`。写入被调用只说明
 *     "可能进了驱动"；只有 worker 的应答能证明它收到过；写入调用发生但既无 flush 确认也无应答，
 *     就是 `unknown`。
 *   - `verification`：`not_requested` / `matched` / `mismatch` / `unavailable`。**未验证不是成功**，
 *     读不回来也不是不匹配。
 *   - `interruption`：`none` / `cancel` / `timeout` / `driver_exit`。
 *   - `recovery`：由上面三轴推导出的建议 —— `continue`（可以继续/重试，因为什么都没派发）、
 *     `observe`（先看再决定，绝不自动重发）、`retry_read`（只读动作可以重读）、`stop`（停止）。
 *
 * `unknown` 永远不会映射成 `failed`：那会让调用方以为"没发生"，而它其实可能发生了。
 *
 * 这份回执是**内部契约**，不是工具输出。旧工具的结果 schema 仍然是 `additionalProperties:false`，
 * 新字段只出现在抛出的错误对象与诊断接口上（方案 3.2）。`LegacyResultAdapter` 那层投影没有
 * 在这里出现，因为现在还没有一个工具需要"新版回执 → 旧 schema"的转换；等 PR06 的停止报告
 * 需要进状态路由时再加，避免先造一层没有消费者的适配器。
 */

/** 派发状态的取值，按发生顺序排列。 */
export const DELIVERY = Object.freeze({
  not_sent: 'not_sent',
  sent_to_driver: 'sent_to_driver',
  driver_ack: 'driver_ack',
  unknown: 'unknown',
});

/** 后置验证的取值。 */
export const VERIFICATION = Object.freeze({
  not_requested: 'not_requested',
  matched: 'matched',
  mismatch: 'mismatch',
  unavailable: 'unavailable',
});

/** 中断原因的取值。 */
export const INTERRUPTION = Object.freeze({
  none: 'none',
  cancel: 'cancel',
  timeout: 'timeout',
  driver_exit: 'driver_exit',
});

/** 恢复建议的取值。 */
export const RECOVERY = Object.freeze({
  continue: 'continue',
  observe: 'observe',
  retry_read: 'retry_read',
  stop: 'stop',
});

const DELIVERY_VALUES = new Set(Object.values(DELIVERY));
const VERIFICATION_VALUES = new Set(Object.values(VERIFICATION));
const INTERRUPTION_VALUES = new Set(Object.values(INTERRUPTION));

/**
 * 把任意字符串收敛到合法取值，未知值退回 `fallback`。
 * @param value - 候选值。
 * @param allowed - 允许的集合。
 * @param fallback - 不合法时的取值。
 */
function pick(value, allowed, fallback) {
  return typeof value === 'string' && allowed.has(value) ? value : fallback;
}

/**
 * 由三轴推导恢复建议。
 *
 * 顺序是有意的：任何"已经派发且结果不确定"的状态都先于"可以继续"。超时/取消排在最前，因为
 * 它们意味着执行已经被打断，必须重新观察；`not_sent` 排最后，因为它是唯一能证明"什么都没发生"
 * 的状态。
 *
 * @param axes - `{ delivery, verification, interruption }`。
 * @returns RECOVERY 之一。
 */
export function recoveryFor(axes = {}) {
  const delivery = pick(axes.delivery, DELIVERY_VALUES, DELIVERY.not_sent);
  const verification = pick(axes.verification, VERIFICATION_VALUES, VERIFICATION.not_requested);
  const interruption = pick(axes.interruption, INTERRUPTION_VALUES, INTERRUPTION.none);
  const failed = axes.errorCode !== undefined && axes.errorCode !== null;
  if (interruption === 'timeout' || interruption === 'driver_exit') return RECOVERY.stop;
  if (interruption === 'cancel') return delivery === DELIVERY.not_sent ? RECOVERY.continue : RECOVERY.observe;
  if (delivery === DELIVERY.unknown) return RECOVERY.observe;
  if (delivery === DELIVERY.driver_ack) {
    // 驱动确认收到了请求之后又出错：页面上可能已经发生了半件事，先看再决定。
    if (failed) return RECOVERY.observe;
    if (verification === VERIFICATION.mismatch || verification === VERIFICATION.unavailable) return RECOVERY.observe;
    return RECOVERY.continue;
  }
  if (delivery === DELIVERY.sent_to_driver) return RECOVERY.observe;
  // not_sent: 什么都没出去。只读动作可以直接重读同一条路径。
  return verification === VERIFICATION.not_requested ? RECOVERY.continue : RECOVERY.observe;
}

/**
 * 造一份内部回执。所有字段都有默认值，调用方只填它知道的那几个。
 *
 * @param fields - 见下方返回结构；未知键被忽略（回执不承载任意附加数据）。
 * @returns 冻结的回执对象。
 */
export function createReceipt(fields = {}) {
  const delivery = pick(fields.delivery, DELIVERY_VALUES, DELIVERY.not_sent);
  const verification = pick(fields.verification, VERIFICATION_VALUES, VERIFICATION.not_requested);
  const interruption = pick(fields.interruption, INTERRUPTION_VALUES, INTERRUPTION.none);
  const receipt = {
    requestId: fields.requestId ?? null,
    sessionId: fields.sessionId ?? null,
    grantEpoch: Number.isFinite(fields.grantEpoch) ? fields.grantEpoch : null,
    driverGeneration: Number.isFinite(fields.driverGeneration) ? fields.driverGeneration : null,
    delivery,
    verification,
    interruption,
    recovery: pick(fields.recovery, new Set(Object.values(RECOVERY)), recoveryFor({ delivery, verification, interruption, errorCode: fields.errorCode ?? null })),
    errorCode: fields.errorCode ?? null,
    completedSteps: Number.isFinite(fields.completedSteps) ? fields.completedSteps : 0,
    failedAt: Number.isFinite(fields.failedAt) ? fields.failedAt : -1,
    nextStep: Number.isFinite(fields.nextStep) ? fields.nextStep : null,
    timings: fields.timings === undefined || fields.timings === null ? {} : { ...fields.timings },
    /** 验证阶段耗时（方案 4.9）；没做验证的调用是 null，而不是 0 —— 0 会被读成"很快就验完了"。 */
    verifyMs: Number.isFinite(fields.verifyMs) ? fields.verifyMs : null,
    /**
     * 这次调用在传输层重发过几次（方案 4.9）。**结构上永远是 0**：结果未知的写操作从不重发，
     * 只读操作也没有重试策略。保留字段是为了将来若加退避重试，无法悄悄把重放藏起来。
     */
    retryCount: Number.isFinite(fields.retryCount) ? Math.max(0, Math.trunc(fields.retryCount)) : 0,
  };
  return Object.freeze(receipt);
}

/**
 * 这次失败能不能原样重试。
 *
 * 只有"能证明什么都没派发"才算可以；其余一律不行，包括 `unknown`（它可能已经发生了）。
 * @param receipt - createReceipt 的结果。
 * @returns 布尔值。
 */
export function mayRetry(receipt) {
  if (receipt === null || receipt === undefined) return false;
  return receipt.delivery === DELIVERY.not_sent && receipt.interruption !== INTERRUPTION.timeout;
}

/**
 * 把一份回执挂到错误对象上，同时把 `delivery` 单独暴露出来。
 *
 * 回执本身用非枚举属性挂上去：错误对象可能被序列化进日志或被 spread，而回执里带着
 * 请求身份与时间，不该在无意间流进工具输出。`delivery` 保持可枚举，因为调用方与测试要读它。
 *
 * @param error - 要标注的错误（会被原地修改）。
 * @param receipt - 回执。
 * @returns 同一个错误，便于链式使用。
 */
export function annotateError(error, receipt) {
  if (error === null || typeof error !== 'object') return error;
  try {
    Object.defineProperty(error, 'receipt', { value: receipt, enumerable: false, configurable: true, writable: true });
  } catch {
    error.receipt = receipt;
  }
  error.delivery = receipt.delivery;
  error.recovery = receipt.recovery;
  return error;
}

/**
 * 从错误对象反推一份回执；用于没有显式回执的旧路径。
 * @param error - 任意错误。
 * @param defaults - 补充字段（requestId、errorCode 等）。
 */
export function receiptFromError(error, defaults = {}) {
  const delivery = pick(error?.delivery, DELIVERY_VALUES, error?.dispatched === true ? DELIVERY.unknown : DELIVERY.not_sent);
  const interruption = pick(
    defaults.interruption,
    INTERRUPTION_VALUES,
    error?.canceled === true ? INTERRUPTION.cancel : INTERRUPTION.none,
  );
  return createReceipt({ ...defaults, delivery, interruption, errorCode: defaults.errorCode ?? error?.code ?? null });
}
