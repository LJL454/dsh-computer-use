/**
 * 失败怎么说、以及"能不能重发"（9.txt §10：宿主半边拆分搬出来的第一块）。
 *
 * 三件事，都是纯函数与常量，没有任何插件状态：
 *
 *   1. `backendMessage`：把后端的错误对象变成一句人话（含 §6 第 4 条那条"输入是否确认释放"）；
 *   2. `FAILURE_RULES` + `decorateFailure`：给失败贴稳定的 `code` 与 `retry` 判据，并附上
 *      "下一步做什么"——顺序即优先级，第一条命中即用；
 *   3. `READ_ONLY_*` / `IDEMPOTENT_*` / `isIdempotentCall` / `withOutcomeNote`：
 *      "这个调用能不能安全重发"。答错方向要付代价：把可重发的当不可重发，只是多看一眼；
 *      把不可重发的当可重发，就是**重复一次副作用**。所以没列进去的一律按不可重发处理。
 *
 * `STEP_ACTION_LIST` / `UIA_ACTION_LIST` 也放这里：它们是 schema、描述与 worker 分发表共用的
 * **唯一**一份动作清单（曾经有三份并且互相矛盾），属于"契约"而不是"入口装配"。
 */

import { ComputerUseBackendError } from '../backend/bridge.js';
import { classifySecurityBlock } from './security-block.mjs';

export function backendMessage(error) {
  if (error instanceof ComputerUseBackendError) {
    // 安全软件拦截单独成句：它不是"脚本写错了"，也不该让用户去重装插件（研究报告 P1-B）。
    const security = classifySecurityBlock(error.message);
    if (security.blocked) {
      return `电脑操作后端被安全软件阻止（${security.vendor}：${security.signature}）。${security.remediation}`;
    }
    // §6 item 4: a worker that was force-killed while it held input is released by an
    // independent process, and whether that worked is part of the answer — "the call was
    // stopped" and "the mouse button you were holding was released" are two different facts.
    const release = typeof error.releaseConfirmed === 'boolean'
      ? (error.releaseConfirmed
        ? `；被按住不放的输入已由独立进程释放${Array.isArray(error.released) && error.released.length > 0 ? `（${error.released.join(', ')}）` : ''}`
        : `；**释放被按住的输入失败**（${error.releaseError ?? '原因未知'}）——桌面可能仍按着某个按键或鼠标键，请先手动按一下对应的键再继续`)
      : '';
    if (error.code === 'NO_WORKER_SCRIPT') {
      return `电脑操作后端脚本缺失：${error.message}`;
    }
    if (error.code === 'START_TIMEOUT' || error.code === 'SPAWN_FAILED' || error.code === 'WORKER_EXITED') {
      return `电脑操作后端无法启动：${error.message}${release}`;
    }
    return `${error.message}${release}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Failure classes the model can act on differently, each with the next step that
 * actually helps.
 *
 * This mirrors the reference contract: every failure carries a stable `code` and a
 * `retry` verdict, because "it failed" and "it failed, observe again first" call
 * for opposite reactions. `retry: 'never'` is the important one — repeating an
 * action the target has no support for just burns turns, so the message says so
 * instead of letting the model guess.
 *
 * Order matters: the first match wins.
 */
export const FAILURE_RULES = [
  { code: 'BACKEND_BLOCKED_BY_AV', retry: 'never', test: /ScriptContainedMaliciousContent|This script contains malicious content|Antimalware Scan Interface|\bAMSI\b|has been quarantined|blocked by (?:your )?(?:antivirus|antimalware)|was blocked by your system administrator|CodeIntegrity|cannot be run because it is not digitally signed/i, hint: '后端被安全软件（AMSI / Defender / AppLocker）拦住，不是插件挂载失败：不要重装插件、不要关闭 AMSI、也不要让用户长期加排除项。先确认宿主加载与工具注册是否正常；若只有 worker 起不来，按发行说明把样本（版本、文件哈希、这段原文）提交给安全厂商做误报分析。' },
  { code: 'FRONT_NOT_TARGET', retry: 'never', test: /was aimed at hwnd \d+ but the foreground is/i, hint: '合成键盘输入发给了前台窗口，而前台不是你要的那个窗口（通常是刚弹出了对话框）。先把它置前（computer_windows 的 focus_hwnd，或在目标窗口里点一下）再输入；不指定 into_hwnd 时插件会在回执里报告实际收到的窗口。' },
  { code: 'FOREGROUND_REQUIRED', retry: 'never', test: /would go nowhere|no window holds the foreground|no window currently has the foreground/i, hint: '没有任何窗口持有前台，键入会无处可去。先用 computer_windows 列出窗口并 focus_hwnd 置前，或用 computer_launch 打开目标，或在目标窗口里点一下，然后再输入。' },
  { code: 'POINTER_NOT_SETTLED', retry: 'retry', test: /\[POINTER_NOT_SETTLED\]|was moved to .* and is still at/i, hint: '指针移动了但没在时限内停稳——输入是通的，是桌面慢或被占用（不是锁屏）。直接重试这个动作即可。' },
  { code: 'SEND_INPUT_BLOCKED', retry: 'never', test: /SendInput delivered no|pointer did not reach|nothing moved/i, hint: '系统丢弃了合成输入。常见原因：工作站已锁屏、有 UAC 安全桌面弹窗、会话未连接到控制台（远程/分离）、或目标窗口以管理员身份运行而本进程不是（UIPI）。请先让桌面回到可交互状态；对提权窗口可改用 computer_ui_action 走 UIA 通道（不受 UIPI 限制）。' },
  { code: 'SCREEN_LOCKED', retry: 'never', test: /interactive desktop|workstation is locked/i, hint: '当前不可交互（锁屏或安全桌面）。请先让用户解锁，再重试。' },
  { code: 'OUT_OF_BOUNDS', retry: 'reobserve', test: /outside the virtual desktop/i, hint: '坐标不在虚拟桌面范围内。若你用的是缩放后的截图，记得按信封里的倍数把图像坐标换回屏幕坐标，然后重试。' },
  { code: 'EXPIRED_FRAME', retry: 'reobserve', test: /frame '.+' is not in this worker|is gone\. Take a new capture/i, hint: '这张截图（frame）已经不在 worker 的登记表里了——跨重启、被淘汰，或它对应的窗口已经不存在。重新截图，用新的 frame id。' },
  { code: 'FRAME_STALE', retry: 'reobserve', test: /the window moved \d+px since frame/i, hint: '截图之后窗口移动了，投影出来的点已经不在那个窗口里——照旧点下去会打到别的地方。重新截图再点。' },
  { code: 'FRAME_CONTENT_CHANGED', retry: 'reobserve', test: /\[FRAME_CONTENT_CHANGED\]/i, hint: '这张图拍下之后**界面内容自己变了**（窗口内滚动、列表刷新、页面跳转）：矩形、DPI、进程都没变，所以几何检查看不出来，但图上的像素已经不对应现在的位置了。重新截图、重新读面板，或者改成按 ref 动作（ref 每次使用前都会重新解析）。如果这个界面本来就在动（转圈、闪烁的状态、时钟），在该调用上传 verify_content: false。' },
  { code: 'TARGET_OCCLUDED', retry: 'reobserve', test: /\[TARGET_OCCLUDED\]/i, hint: '投影出来的落点上面是**别的进程的窗口**——输入会送到它那里，所以一个字节都没发。这不是坐标算错，而是目标被挡住了（或被最小化、被移到别的显示器）。看一眼现在的屏幕（computer_screenshot 或 computer_windows），把目标窗口置前（focus_hwnd），或者改成按控件动作（computer_ui 拿 ref 再 computer_ui_action，UIA 动作不受遮挡影响）。' },
  { code: 'COORDINATE_MAPPING_UNKNOWN', retry: 'reobserve', test: /\[COORDINATE_MAPPING_UNKNOWN\]/i, hint: '这张图到屏幕坐标的变换不确定——附件层报告了它交付的图片尺寸不一致，或者记录里缺少编码尺寸——所以插件拒绝投影而不是猜。重新截一张图再引用它的 frame，或者改成按控件动作。' },
  { code: 'CONDITION_TIMEOUT', retry: 'reobserve', test: /\[CONDITION_TIMEOUT\]/i, hint: '等待的条件在预算内没有成立，**依赖它的后续步骤没有执行**（默认 stop）。回执里有 nextStep（从哪一步继续）和 waits（它到底看到了什么）。要么延长 timeout_ms 再等一次，要么先自己看一眼窗口确认条件该不该成立；如果这一串本来就不依赖它，在那一步上写 on_timeout: "continue" 明确表示继续。' },
  { code: 'FRAME_REGION_OUTSIDE_WINDOW', retry: 'never', test: /is not inside the captured window/i, hint: 'region 超出了那个窗口自身的范围：region 默认是**屏幕坐标**（region_space: screen），和 window 一起用时会被换算成窗口内部的矩形；如果你给的数字本来就是"窗口内坐标"，就显式写 region_space: "window"。也可以传 clip: true 只取存在的部分，或者去掉 window 让它纯粹按屏幕像素读。' },
  { code: 'STALE_REF', retry: 'reobserve', test: /ref '.+' (\(never issued|retired when older|not in this registry|malformed|minted by)/i, hint: '这个 ref 已经不在 worker 的登记表里了（跨重启、来自上一个 worker 代次，或它所属的那次观察已被淘汰）——**这不代表控件消失了**。用 computer_ui 重新读一次，用新读出的 ref 再动作。' },
  { code: 'TARGET_CHANGED', retry: 'reobserve', test: /the handle has been recycled|belonged to pid \d+ when the ref was read/i, hint: '窗口句柄已被系统回收复用：现在这个 hwnd 属于另一个进程，不再是你读 ref 时的那个窗口。用 computer_windows 重新定位目标窗口，再重新读取并动作。' },
  { code: 'REOBSERVE_REQUIRED', retry: 'reobserve', test: /the window in front changed during this batch/i, hint: '批次跑到一半时前台窗口变了（弹窗、菜单或导航），剩下的步骤**没有执行**——照旧跑下去会把输入送进新窗口。先用 computer_windows 看窗口列表、computer_ui 读新窗口的控件，再从回执里的 nextStep 继续；如果这一串本来就要走进某个已知窗口，用 expected_transitions 声明它（比 stop_on_window_change: false 更安全：没预料到的变化仍然会被拦住）。' },
  { code: 'ELEMENT_UNAVAILABLE', retry: 'reobserve', test: /no UI Automation element matched|is no longer in hwnd|has no readable UI Automation tree/i, hint: '没有匹配到控件。先用 computer_ui 重新观察该窗口，取当前存在的 automation_id / name 再动作；也可以放宽选择器（只用 control_type）或加大 index。' },
  { code: 'AMBIGUOUS_APP', retry: 'never', test: /\[AMBIGUOUS_MATCH\] '.+' matches \d+ applications/i, hint: '这个名称同时匹配多个应用，插件不替你挑（"用得最多"不等于"你要的那个"）。回执里列出了候选：用完整显示名、可执行文件路径或命令行再调一次；想先看有哪些候选，可以用 computer_windows 或把名称写得更完整。' },
  { code: 'AMBIGUOUS_MATCH', retry: 'reobserve', test: /index \d+ is out of range/i, hint: '多个控件命中同一个选择器。先用 computer_ui 看清有几个匹配，再用 index 指定其中一个，或把选择器写得更精确。' },
  { code: 'TEXT_RANGE_SPLITS_SURROGATE_PAIR', retry: 'never', test: /outside the Basic Multilingual Plane|surrogate pair/i, hint: '前缀/后缀或搜索文本里含 BMP 之外的字符（emoji、罕见汉字等），而该控件按"字符"而非 UTF-16 码元计数，导致范围边界落在半个字符上。去掉 prefix/suffix 只按正文定位，或把前缀换成纯 BMP 文本。' },
  { code: 'NOT_SELECTABLE', retry: 'never', test: /was not found in this element|was not found with the given prefix/i, hint: '该文本不在这个控件里。先用 computer_ui_action 的 get_text 读到真实内容，再按读到的原文定位。' },
  { code: 'CARET_UNAVAILABLE', retry: 'never', test: /needs TextPattern2, which the managed UI Automation wrapper does not expose/i, hint: '托管回退引擎没有 TextPattern2，读不到光标位置——这是引擎能力差异，不是控件问题。设 DSH_COMPUTER_UI_ENGINE=com（默认）后重试；或者改用 select_text 看选区文本。' },
  { code: 'ACTION_UNAVAILABLE', retry: 'never', test: /does not support|is disabled/i, hint: '该控件不支持这个动作，或它当前是禁用状态（禁用的控件会忽略动作）。computer_ui 返回的 patterns 列出了它真正支持的动作，换一个；没有任何动作可用时就退回截图加像素点击。' },
  { code: 'TREE_UNAVAILABLE', retry: 'reobserve', test: /usable UI Automation element|could not resolve a UI Automation root/i, hint: '该窗口没有可用的 UIA 树（少数窗口对 UIA 完全惰性）。改用 computer_screenshot 加像素点击，或先 computer_windows 确认焦点窗口。' },
  { code: 'CLIPBOARD_BUSY', retry: 'retry', test: /clipboard is held open/i, hint: '剪贴板被其他程序短暂占用，稍后重试即可。' },
  { code: 'RESTORE_UNSUPPORTED', retry: 'never', test: /\[RESTORE_UNSUPPORTED\]/i, hint: '剪贴板里是这条通道无法还原的内容（图片、文件列表、富文本），而 require_restore: true 要求"要么原样放回、要么别动"。所以这次什么都没写。三个选择：去掉 require_restore 明确接受覆盖、改用 computer_type 逐字输入、或用 computer_ui_action 的 set_value 直接设值（后两者不碰剪贴板）。' },
  { code: 'LAUNCH_FAILED', retry: 'never', test: /could not start|returned no process|could not find an application/i, hint: '启动失败。target 可以是可执行文件路径、PATH 里的名字、开始菜单里的显示名，或已安装应用的名称；换一种写法再试。' },
  { code: 'CAPTURE_TOO_LARGE', retry: 'never', test: /a capture region may be at most|the capture covers .* pixels, over the|the capture region .* does not overlap the virtual desktop/i, hint: '要抓的范围太大或不在虚拟桌面内。改用 scale 缩小、只抓一个显示器、或传一个更小的 region；region 会被裁剪到桌面内的部分，但完全不相交就会被拒。' },
  { code: 'DISPLAY_UNKNOWN', retry: 'never', test: /display \d+ is out of range/i, hint: '显示器序号不存在。用信封里 displays 列出的序号（0 是主显示器），或用 display: "all"。' },
  { code: 'CAPTURE_SURFACE_UNAVAILABLE', retry: 'reobserve', test: /came back with no contrast at all|require=window was asked for and this window could not render/i, hint: '这次捕获拿不到可用的像素：要么窗口什么都没画、要么桌面没给像素（截图全同色）。换个方式——用 region 抓同一块区域、把窗口置前再试，或者（如果是 require=window 拒的）去掉 require 让它回退到屏幕捕获。' },
  { code: 'WINDOW_MINIMIZED', retry: 'never', test: /is minimized: what it would render is the placeholder/i, hint: '这个窗口是最小化的——PrintWindow 只会画出系统为它保留的那块几十像素的占位图，不是窗口内容。先恢复它（computer_ui_action 用 control_type Window + action restore），或改用屏幕捕获。' },
  { code: 'WINDOW_GONE', retry: 'reobserve', test: /is not a window any more|is not a window$|has no usable rectangle/i, hint: '这个 hwnd 已经不是一个可用窗口（被关闭、被销毁，或还没有可用的矩形）。用 computer_windows 重新列一次，用当前存在的句柄。' },
  { code: 'DISPLAY_TOPOLOGY_CHANGED', retry: 'reobserve', test: /the display layout changed since frame/i, hint: '截图之后显示器布局变了（分辨率、缩放或显示器数量），那张图的坐标已经不能映射到现在的屏幕。重新截图再点。' },
  { code: 'DPI_CHANGED', retry: 'reobserve', test: /\[DPI_CHANGED\]/i, hint: '截图之后这个窗口（或整个系统）的 DPI 缩放变了——窗口矩形可能一点没动，但图上的像素已经不再对应同一个物理位置（最常见的原因是窗口被拖到了另一台缩放比不同的显示器）。重新截图再点。' },
  { code: 'BAD_REQUEST', retry: 'never', test: /unknown (command|step action|UI Automation action|key name)|chord such as|needs at least|needs one of|needs hwnd|needs a path|needs a positive|requires |accepts at most|holds at most|must be 'get', 'set' or 'clear'|has no action|the text to locate is required|unsupported image format|empty capture region/i, hint: '参数不合法：按报错里列出的取值修正后重发。' },
  { code: 'TIMEOUT', retry: 'retry', test: /did not answer within/i, hint: (context) => (context.idempotent === false
    ? '后端超时并已被重启。这个动作**不是只读的**：它可能已经发生，也可能没有——**不要直接重发**。先用 computer_ui 或 computer_screenshot 看一眼现在的状态，确认没有生效再重试。'
    : '后端超时并已被重启。这个调用是只读的，直接重试即可。') },
  { code: 'CANCELLED', retry: 'never', test: /\[CANCELED\]|had already been dispatched|cancelled before it was dispatched/i, hint: '这次调用被取消了（用户关掉了开关、点了停止，或会话被中断）。取消发生在哪一步并不确定：已经发出的动作可能已经生效。先观察屏幕确认状态，再决定要不要继续——不要因为"被取消"就认为什么都没发生。' },
  { code: 'UNKNOWN_OUTCOME', retry: 'reobserve', test: /^\[UNKNOWN_OUTCOME\]/, hint: '这一步是否已经作用到桌面上，无法从失败本身判断。先观察（computer_ui / computer_screenshot），再决定重发还是继续。' },
  { code: 'HELPER_UNAVAILABLE', retry: 'retry', test: /backend|worker/i, hint: '后端进程不可用，重试会自动重启它。' },
];

/**
 * The actions and batch steps that only look at the desktop.
 *
 * Module scope rather than inside `apply`, because the retry guidance needs them too:
 * "is this safe to repeat" and "does this need the controller lease" are the same
 * question asked by two different layers, and answering it twice is how the two
 * answers drift apart.
 */
export const READ_ONLY_ACTIONS = new Set(['get_value', 'get_text', 'locate_text', 'get_caret']);
export const READ_ONLY_STEPS = new Set(['get_value', 'get_text', 'locate_text', 'get_caret', 'wait', 'screenshot']);

/** Batch steps that can be repeated after a failure without side effects (clipboard is op-dependent). */
export const IDEMPOTENT_STEP_ACTIONS = new Set([...READ_ONLY_STEPS]);

/**
 * The one list of batch step actions, shared by the schema, the description and the
 * worker's dispatcher.
 *
 * It used to exist three times, and the copies disagreed: the schema accepted 29
 * actions while the dispatcher implemented 21, so eight documented actions
 * (`click_text`, `close`, `get_caret`, `legacy_action`, `locate_text`, `maximize`,
 * `minimize`, `restore`) failed with "unknown step action" after the caller had done
 * exactly what the schema said. The worker publishes the same list at startup and the
 * host compares the two before dispatching anything.
 *
 * Order is part of the contract, because the comparison is exact.
 */
/** The batch's step actions, in the order the worker publishes them. */
export const STEP_ACTION_LIST = [
  'click', 'move', 'drag', 'scroll', 'type', 'key', 'wait', 'wait_for', 'screenshot', 'paste', 'focus', 'clipboard',
  'invoke', 'set_value', 'get_value', 'get_text', 'select_text', 'scroll_into_view',
  'toggle', 'select', 'expand', 'collapse',
  'close', 'minimize', 'maximize', 'restore', 'legacy_action',
  'click_text', 'locate_text', 'get_caret',
];

/**
 * The single-step tool's action list.
 *
 * A superset of the batch's UI Automation steps by exactly one entry: `focus` is an
 * element action here and a window action in a batch, so the same name means two
 * things. Everything else is shared, which is what keeps a step that works on its own
 * working inside a batch.
 */
export const UIA_ACTION_LIST = [
  'invoke', 'set_value', 'get_value', 'get_text', 'select_text', 'scroll_into_view', 'focus',
  'toggle', 'select', 'expand', 'collapse',
  'close', 'minimize', 'maximize', 'restore', 'legacy_action',
  'click_text', 'locate_text', 'get_caret',
];

/**
 * Whether a backend command can be safely repeated.
 *
 * This is the fact that decides what a failure means: a read that timed out can be
 * issued again for free, while a click, a paste or a batch that writes may already have
 * happened, and repeating it is a second action rather than a retry. Anything not on
 * this list is treated as non-idempotent, because being wrong in that direction costs
 * one observation, and being wrong in the other direction duplicates a side effect.
 */
export const IDEMPOTENT_COMMANDS = new Set(['ping', 'health', 'screenshot', 'windows', 'cursor', 'digest', 'uitree', 'release', 'wait', 'frameproject', 'frameattach']);

/**
 * Classify a call for the retry guidance a failure carries.
 * @param cmd - backend command.
 * @param args - backend arguments.
 * @returns whether repeating the call is safe.
 */
export function isIdempotentCall(cmd, args) {
  if (cmd === 'clipboard') return String(args?.op ?? 'get') === 'get';
  if (cmd === 'uiact') return READ_ONLY_ACTIONS.has(String(args?.action ?? '').toLowerCase());
  if (cmd === 'batch') {
    return (Array.isArray(args?.steps) ? args.steps : []).every((step) => {
      const action = String(step?.action ?? '').toLowerCase();
      if (action === 'clipboard') return String(step?.op ?? 'get') === 'get';
      return IDEMPOTENT_STEP_ACTIONS.has(action);
    });
  }
  return IDEMPOTENT_COMMANDS.has(cmd);
}

/**
 * Prefix a failure with its stable code and the next step that helps.
 * @param message - the raw failure text.
 * @param context - `{ idempotent }`, so a hint can depend on whether repeating the call
 *   is safe.
 * @returns `[CODE] message` plus a hint line when one is known.
 */
export function decorateFailure(message, context = {}) {
  for (const rule of FAILURE_RULES) {
    if (!rule.test.test(message)) continue;
    const hint = typeof rule.hint === 'function' ? rule.hint(context) : rule.hint;
    const head = `[${rule.code}] ${message}`;
    return hint === undefined ? head : `${head}\n下一步：${hint}`;
  }
  return message;
}

/**
 * Say out loud when a failure left the outcome of a write unknown.
 *
 * The transport knows one thing the message does not: whether the request had already
 * been handed to the worker when it failed. When it had, and the command is not a read,
 * "it failed" is not a fact the caller can act on — "it may or may not have happened"
 * is. The note goes in front of the decorated message, so the first thing the model
 * reads is the part that changes its next move.
 * @param message - the decorated failure text.
 * @param error - the thrown value, which may carry `dispatched`.
 * @param cmd - backend command name.
 * @param args - backend arguments.
 * @returns the message, prefixed when the outcome is genuinely unknown.
 */
export function withOutcomeNote(message, error, cmd, args) {
  const dispatched = error?.dispatched === true || error?.canceled === true;
  if (!dispatched || isIdempotentCall(cmd, args)) return message;
  // A refused argument never became an action: the worker validates a request before it
  // runs any of it, so a [BAD_REQUEST] answers "nothing happened" and does not need the
  // unknown-outcome warning.
  if (/\[BAD_REQUEST\]/.test(message)) return message;
  // The worker says the same thing itself, in the marker its refusals carry: a call refused
  // before anything was sent (a name the caller has to disambiguate, a target that does not
  // exist) is not an unknown outcome, and telling the caller it might have reached the
  // desktop sends it looking for something that never happened.
  if (/action_sent=false/.test(message)) return message;
  return `[UNKNOWN_OUTCOME] ${cmd} had already been sent to the backend when this failed, so it may or may not have reached the desktop. ${message}`;
}
