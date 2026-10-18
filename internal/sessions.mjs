/**
 * 会话登记：谁开着「电脑操作」、以及会话标识怎么归一化（9.txt §10 的"会话管理"那一块）。
 *
 * 授权是**按会话**、默认关闭的。把鼠标键盘交给模型比读文件大一步，所以它必须是一个用户为某一次
 * 对话打开、也能再关掉的东西——这正是输入框那个芯片表达的意思。授权本身存在这里（内存里，
 * DSH 重启即回到默认值，对一个能操控鼠标键盘的能力来说这个默认是刻意的）。
 *
 * 从 `index.js` 搬出来（§10 宿主半边拆分）：这块只有两个变量和三个函数，却是"每个入口最先问"
 * 的东西，独立成模块之后"谁能动桌面"这条线在一个文件里读得完。
 */

/**
 * 会话标识的归一化。
 *
 * 缺失/空值统一成 `''`（匿名会话）：匿名会话也要能被授权与记账，不能因为拿不到 id 就绕过门禁。
 * @param sessionId - 原始会话标识。
 * @returns 用于 Map 键的字符串。
 */
export const sessionKey = (sessionId) => (sessionId === undefined || sessionId === null ? '' : String(sessionId));

/**
 * 授权登记表：`sessionKey -> 显式授权`。**没有记录**表示"用部署默认值"，
 * 所以"关掉"必须显式写 `false`（见 `revoke`），而不是删掉记录。
 */
export function createSessions({ defaultEnabled }) {
  const grants = new Map();

  /**
   * 这个会话现在能不能用。
   * @param sessionId - 会话标识。
   * @returns 显式授权优先，否则用部署默认值。
   */
  const isEnabled = (sessionId) => grants.get(sessionKey(sessionId)) ?? defaultEnabled;

  /** 显式授权（芯片打开时）。 */
  const grant = (sessionId) => grants.set(sessionKey(sessionId), true);

  /** 显式收回（芯片关闭、急停、会话被撤销时）。 */
  const revoke = (sessionId) => grants.set(sessionKey(sessionId), false);

  /** 这个会话是否有过显式授权记录（控制块要区分"关着"与"被停过"）。 */
  const hasExplicit = (sessionId) => grants.has(sessionKey(sessionId));

  /** 清掉一个会话的全部登记（会话销毁时）。 */
  const forget = (sessionId) => grants.delete(sessionKey(sessionId));

  return { isEnabled, grant, revoke, hasExplicit, forget, defaultEnabled };
}
