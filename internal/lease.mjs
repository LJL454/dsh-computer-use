/**
 * 控制权租约：同一时刻只让一个会话驱动桌面（9.txt §6 第 9 条 / §10 的"会话管理"那一块）。
 *
 * 一个宿主进程只有一个 worker，所以多个会话共用同一只鼠标和键盘。两个会话同时动手，会交织成
 * 双方都无法解释的状态。这里用一份**按空闲计时**的租约来仲裁：
 *
 *   - 只有会**移动桌面**的调用才需要租约（读操作永远不需要，stop/release 这条安全通道也不需要——
 *     能被另一个会话挡住的安全控制不是安全控制）；
 *   - 租约在**写操作真正执行期间**保持：`beginWrite()`/`finishWrite()` 计数，空闲时钟在写操作
 *     结束那一刻重新开始。§6 第 9 条之前不是这样：那时租约在调用开始时打戳、十秒后自行过期，
 *     于是一次长拖拽或含等待的批次还在跑，桌面就可能被交给另一个会话；
 *   - 拒绝时说清是"**正在执行**"还是"**安静了 N 秒**"——这两种情况的应对完全不同。
 *
 * 这块从 `index.js` 搬出来（§10 宿主半边拆分）：它只维护"谁在动桌面、动了什么"这几个变量，
 * 不碰工具、路由或后端，接口就是下面四个函数加一个状态查询。
 */
import { READ_ONLY_ACTIONS, READ_ONLY_STEPS } from './failures.mjs';

/**
 * 空闲多久之后租约自行释放。
 *
 * 空闲即释放（而不是要显式交还）：会话之间交接就只是"停一下"，不需要任何仪式。
 */
export const CONTROLLER_IDLE_MS = 10_000;

/** 当前持有租约的会话（`{ sessionId, at }`），没人持有时为 null。 */
let controller = null;
/** 正在执行的写操作计数（§6 第 9 条）：>0 表示桌面**此刻**正在被驱动。 */
let controllerRunning = 0;
/** 这个会话最后一次动桌面的时间与内容，供状态路由展示。 */
let lastAction = null;

/** 会移动桌面的后端命令。读操作刻意不在其中。 */
const MUTATING_COMMANDS = new Set(['click', 'drag', 'scroll', 'type', 'key', 'paste', 'launch', 'focus']);

/**
 * 这个调用是"动桌面"还是"看桌面"。
 * @param cmd - 后端命令。
 * @param args - 后端参数。
 * @returns 需要租约时为 true。
 */
export function movesDesktop(cmd, args) {
  if (MUTATING_COMMANDS.has(cmd)) return true;
  if (cmd === 'clipboard') return String(args?.op ?? 'get') !== 'get';
  if (cmd === 'uiact') return !READ_ONLY_ACTIONS.has(String(args?.action ?? '').toLowerCase());
  if (cmd === 'batch') {
    return (Array.isArray(args?.steps) ? args.steps : []).some((step) => {
      const action = String(step?.action ?? '').toLowerCase();
      if (action === 'clipboard') return String(step?.op ?? 'get') !== 'get';
      return !READ_ONLY_STEPS.has(action);
    });
  }
  return false;
}

/**
 * 取租约，或者因为别的会话正持有而拒绝。
 * @param sessionId - 已经归一化的会话标识（'' 表示匿名会话）。
 * @param cmd - 后端命令。
 * @param args - 后端参数。
 */
export function claimController(sessionId, cmd, args) {
  if (!movesDesktop(cmd, args)) return;
  const now = Date.now();
  if (controller !== null && controller.sessionId !== sessionId) {
    const running = controllerRunning > 0;
    const idleFor = Math.round((now - controller.at) / 1000);
    if (running || now - controller.at < CONTROLLER_IDLE_MS) {
      const owner = controller.sessionId === '' ? '(an unidentified session)' : `…${controller.sessionId.slice(-8)}`;
      // "还在执行"和"已经安静一会儿了"是两个不同的答复，应对方式也不同：前者必须等它跑完，
      // 后者基本就是马上（§6 第 9 条）。
      const why = running
        ? 'is in the middle of a write right now (the desktop is being driven this instant)'
        : `drove the desktop ${idleFor}s ago`;
      const wait = running ? 'a few seconds' : `${Math.max(1, Math.ceil((CONTROLLER_IDLE_MS - (now - controller.at)) / 1000))}s`;
      throw new Error(`[CONTROLLER_BUSY] another conversation (${owner}) ${why}, and one mouse cannot serve two agents at once. Wait ${wait} for that call to finish, or turn 电脑操作 off in that conversation first. Reading the screen is still allowed here.`);
    }
  }
  controller = { sessionId, at: now };
}

/** 记下"这个会话刚动过桌面"（状态路由展示用）。 */
export function noteAction(sessionId, what) {
  lastAction = { sessionId, at: Date.now(), what };
}

/** 一个写操作开始执行：桌面此刻正在被驱动。 */
export function beginWrite() {
  controllerRunning += 1;
}

/**
 * 一个写操作结束。
 *
 * 空闲时钟**从这里开始**，不是在调用被接受时开始："安静了 N 秒"必须真的意味着桌面安静了 N 秒。
 */
export function finishWrite() {
  controllerRunning = Math.max(0, controllerRunning - 1);
  if (controllerRunning === 0 && controller !== null) controller.at = Date.now();
}

/**
 * 状态路由要的那一块：这个会话是否持有租约、租约归谁、以及它最后一次动桌面是什么时候。
 * @param sessionId - 已经归一化的会话标识。
 * @returns `{ owns, idleMs, lease, lastAction }`（`lease` 为 null 表示当前没人持有）。
 */
export function leaseReport(sessionId) {
  const owns = controller !== null && controller.sessionId === sessionId;
  const idleMs = controller === null ? null : Math.max(0, Date.now() - controller.at);
  return {
    owns,
    idleMs,
    held: idleMs !== null && idleMs < CONTROLLER_IDLE_MS,
    lease: controller === null
      ? null
      : {
        owner: controller.sessionId === '' ? null : `…${controller.sessionId.slice(-8)}`,
        idleMs,
        held: idleMs !== null && idleMs < CONTROLLER_IDLE_MS,
      },
    lastAction: lastAction === null || lastAction.sessionId !== sessionId
      ? null
      : { what: lastAction.what, at: lastAction.at, ageMs: Math.max(0, Date.now() - lastAction.at) },
  };
}
