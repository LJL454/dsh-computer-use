/**
 * 引用注册表：**哪个会话被展示过哪次观察、哪一帧**（9.txt §6 第 3 条 / §10 的引用注册表那块）。
 *
 * 为什么需要它：worker 的登记表是**每个 worker 一份**，不是每个会话一份；而两个会话共用同一个
 * worker。于是"这个 ref 是给谁的"这件事只有宿主知道——它在哪次读取里把哪个快照给了哪个会话。
 * 没有这层，会话 B 就能拿会话 A 读出来的 ref 去动作（把 A 在 A 看的窗口里选中的元素钉住），
 * 或者引用 A 拍的那一帧（worker 共用，像素不共用）。
 *
 * 两条边界，都是刻意的：
 *
 *   - **只拒绝能确认的那一种**：ref 带着**当前** worker 的代次、而这个会话从没被展示过那次观察、
 *     且它自己的记录还完整——这才是"不是你的"。别的（旧代次的 ref、旧拼写、worker 已经剪掉的、
 *     记录被裁剪过的会话）都交给 worker 自己的登记表去给更细的结论；在这里猜会把一个准确的答复
 *     换成含糊的。
 *   - **记录是有界的，且裁剪过就说裁剪过**：被裁剪之后宿主不知道完整历史，于是记下 `evicted`，
 *     之后对无法确认的引用**重新读取**（§6 的答案），而不是放它过去。
 *
 * 从 `index.js` 搬出来（§10 宿主半边拆分）。它唯一需要外界告诉它的是"当前 worker 的代次"，
 * 所以以 `generationOf()` 注入。
 */
import { sessionKey as defaultSessionKey } from './sessions.mjs';

/**
 * @param options.sessionKey - 会话标识归一化函数（默认用 sessions 模块里的那个）。
 * @param options.generationOf - `() => string`，当前 worker 的代次；没有 worker 时返回空串。
 */
export function createRefRegistry({ sessionKey = defaultSessionKey, generationOf } = {}) {
  /** sessionKey -> `{ set, evicted }`：这个会话被展示过的观察。 */
  const seenSnapshots = new Map();
  /**
   * 一个会话的所有权记录能留多少条观察。
   *
   * 所有权不是展示缓存（§6：将所有权与历史展示缓存分开维护）。这里存的是"这个会话被**展示**过
   * 什么"，而它是唯一能阻止另一个共用 worker 的会话去动作它从未读过的 ref 的东西。界太小会把长会话
   * 变成"不再检查"的会话，所以界给得宽：读了几千棵树的是长会话，不是停止追问 ref 归属的理由。
   */
  const SEEN_SNAPSHOT_LIMIT = 4096;
  /** sessionKey -> `{ set, evicted }`：这个会话被展示过的帧。 */
  const seenFrames = new Map();
  /** 一个会话的所有权记录能留多少帧（理由同上）。 */
  const SEEN_FRAME_LIMIT = 4096;

  /**
   * 记下"这次观察被展示给了这个会话"。
   * @param sessionId - 会话标识。
   * @param snapshot - 后端回复里的快照 id。
   */
  function noteSnapshot(sessionId, snapshot) {
    if (typeof snapshot !== 'string' || snapshot === '') return;
    const key = sessionKey(sessionId);
    let record = seenSnapshots.get(key);
    if (record === undefined) {
      record = { set: new Set(), evicted: false };
      seenSnapshots.set(key, record);
    }
    record.set.add(snapshot);
    while (record.set.size > SEEN_SNAPSHOT_LIMIT) {
      const oldest = record.set.values().next().value;
      if (oldest === undefined) break;
      record.set.delete(oldest);
      // 从这一刻起，宿主的记录是一扇窗口，而不是完整历史。
      record.evicted = true;
    }
  }

  /**
   * 拒绝一个"铸给了这个 worker、却从没展示给这个会话"的 ref。
   * @param sessionId - 会话标识。
   * @param ref - 调用方传来的 ref。
   */
  function assertRefOwnership(sessionId, ref) {
    if (typeof ref !== 'string' || ref === '') return;
    const at = ref.indexOf('.');
    if (at <= 0) return;
    const generation = generationOf?.();
    if (typeof generation !== 'string' || generation === '') return; // 没有 worker 跑过：不可能有它的 ref
    const snapshot = ref.slice(0, at);
    if (!snapshot.startsWith(`s${generation}`)) return; // 不是这个 worker 的 ref：让 worker 解释
    const record = seenSnapshots.get(sessionKey(sessionId));
    if (record !== undefined && record.set.has(snapshot)) return;
    if (record !== undefined && record.evicted) {
      // 记录被裁剪过，所以这**不是**"你从没读过它"，而是"这个会话读过的观察比宿主保留的所有权记录
      // 还多，因此无法从这里确认这个 ref 是否属于它"。§6 对无法确认的归属的答案是重新读取，
      // 而不是放行——无法确认的 ref 正是这个检查存在的理由。
      throw new Error(`[STALE_REF] ref '${ref}' names the observation ${snapshot}, and this conversation has read more observations than the host keeps an ownership record for, so whether it was shown to it cannot be confirmed. Read the window again with computer_ui and use a ref from that read. (action_sent=false, element_lookup=not_found, recovery=computer_ui)`);
    }
    throw new Error(`[STALE_REF] ref '${ref}' names the observation ${snapshot}, which this conversation was never shown — it belongs to another session's read. Read the window again with computer_ui and use a ref from that read. (action_sent=false, element_lookup=not_found, recovery=computer_ui)`);
  }

  /**
   * 记下"这一帧被展示给了这个会话"。
   * @param sessionId - 会话标识。
   * @param frameId - 后端回复里的帧 id。
   */
  function noteFrame(sessionId, frameId) {
    if (typeof frameId !== 'string' || frameId === '') return;
    const key = sessionKey(sessionId);
    let record = seenFrames.get(key);
    if (record === undefined) {
      record = { set: new Set(), evicted: false };
      seenFrames.set(key, record);
    }
    record.set.add(frameId);
    while (record.set.size > SEEN_FRAME_LIMIT) {
      const oldest = record.set.values().next().value;
      if (oldest === undefined) break;
      record.set.delete(oldest);
      record.evicted = true;
    }
  }

  /**
   * 拒绝一个这个会话从没被展示过的帧。
   * @param sessionId - 会话标识。
   * @param frameId - 调用方传来的帧 id。
   */
  function assertFrameOwnership(sessionId, frameId) {
    if (typeof frameId !== 'string' || frameId === '') return;
    const record = seenFrames.get(sessionKey(sessionId));
    if (record === undefined || record.set.size === 0) return;
    if (record.set.has(frameId)) return;
    if (record.evicted) {
      // 记录被裁剪：诚实的答复是"无法确认这一帧是你的"，而它的答案是重新截图（§6），不是放行。
      throw new Error(`[EXPIRED_FRAME] frame '${frameId}' cannot be confirmed as one this conversation was shown: it has been shown more frames than the host keeps an ownership record for. Take a fresh capture here and cite the frame it returns. (action_sent=false, recovery=computer_screenshot)`);
    }
    throw new Error(`[EXPIRED_FRAME] frame '${frameId}' was not shown to this conversation — it belongs to a capture another conversation took (the worker is shared, the pixels are not). Take a capture here and cite the frame it returns. (action_sent=false, recovery=computer_screenshot)`);
  }

  return { noteSnapshot, assertRefOwnership, noteFrame, assertFrameOwnership };
}
