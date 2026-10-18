/**
 * 自检：把"芯片亮着、工具却调不动"这一类症状，变成一份能直接读出原因的清单。
 *
 * 为什么需要它：这一类故障的**共同特征是没有症状**。「电脑操作」芯片由浏览器半边渲染，而工具由
 * 宿主半边注册——两条加载路径不同，所以宿主半边整个没挂上时，界面看起来一切正常，点一下也只是
 * 什么都没发生。已经真实发生过一次（`defineTool` 因 schema 被拒 → `apply()` 整体中断 →
 * 18 个工具一个都没注册），当时唯一能说明问题的信息不在产品里，而在一次临时写出来的探针脚本里。
 *
 * 这个模块把那次探针的经验固化下来，并且**只做只读判断**：不启动 worker、不碰桌面、不改任何状态，
 * 所以它可以在用户报告问题的当下直接跑，而不是等一次复现。
 *
 * 它回答的是四个互不重叠的问题：
 *   1. 宿主半边到底挂上了没有（工具与路由注册的结果）；
 *   2. 会话的 schema 可见性现在是什么，以及"点开"之后能不能回来；
 *   3. worker 跑得起来吗（PowerShell 在哪、脚本在不在、协议对不对得上）；
 *   4. 依赖能不能解析（`@deepseek-ai/dsh-tools`——开发时靠一个手工 junction，干净安装则靠宿主解析）。
 */
import { existsSync, statSync } from 'node:fs';
import { POWERSHELL_CANDIDATES, resolvePowerShell } from './powershell.mjs';
import { WORKER_PATH, RELEASE_PATH } from './build-check.mjs';

/** Node 解析本插件的 peer 依赖时用的说明符。 */
const PEER_SPECIFIER = '@deepseek-ai/dsh-tools';

/**
 * 一个可执行文件是否真的存在（裸名字交给 PATH，绝对路径直接查盘）。
 * @param candidate - 候选路径或命令名。
 * @returns 存在性；裸名字无法在同步路径里确认，返回 null。
 */
function executableState(candidate) {
  if (candidate.includes('\\') || candidate.includes('/')) return existsSync(candidate);
  return null;
}

/**
 * 从本模块的位置解析 peer 依赖。
 *
 * 这是"干净安装能不能起来"的第一个关口：解析成功说明宿主的解析面（或包自带的 node_modules）覆盖了
 * 这个依赖，失败则意味着插件在 import 阶段就会整体失败——那种情况下芯片同样照常显示。
 * @returns `{ specifier, resolvable, url, error }`。
 */
function peerResolution() {
  try {
    const url = import.meta.resolve(PEER_SPECIFIER);
    return { specifier: PEER_SPECIFIER, resolvable: true, url, error: '' };
  } catch (error) {
    return {
      specifier: PEER_SPECIFIER,
      resolvable: false,
      url: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 一份脚本文件的存在性、大小与修改时间。
 * @param path - 文件的绝对路径。
 * @returns 描述对象。
 */
function scriptState(path) {
  try {
    const info = statSync(path);
    return { path, exists: true, bytes: info.size, modifiedAt: new Date(info.mtimeMs).toISOString() };
  } catch {
    return { path, exists: false, bytes: 0, modifiedAt: null };
  }
}

/**
 * 建一份自检报告。
 *
 * 所有需要宿主状态的部分都由调用方以参数传入（注册失败清单、可见性计数、后端摘要），
 * 这样这个模块不认识 ctx，也不认识路由——它只是把事实摆成一份可读的表。
 * @param options.supported - 平台是否受支持（`process.platform === 'win32'`）。
 * @param options.platform - 原始平台标识。
 * @param options.version - 插件版本（取自 package.json）。
 * @param options.defaultEnabled - 部署默认值。
 * @param options.registrationFailures - 被宿主拒绝的工具描述符清单。
 * @param options.registeredToolNames - 已经注册成功的工具名。
 * @param options.schemaVisibility - `{ enabled, liveAgents, restrictedSessions }`。
 * @param options.backend - `{ started, alive, generation, pid }` 或 null。
 * @param options.hideToolSchemasWhenOff - 配置项的实际取值。
 * @param options.insideHost - 这份报告是不是在宿主进程里生成的。
 *   这一项存在的唯一理由是 peer 依赖那一条：**裸 Node 下解析不到 `@deepseek-ai/dsh-tools` 是正常的**
 *   （宿主的运行时解析面会覆盖它，实测过），拿它当阻断项会把每一个解压副本都误判成坏的。
 *   反过来，在宿主里能生成这份报告，就说明模块已经加载成功，这一条必然可解析。
 * @returns 报告对象（JSON 可序列化）。
 */
export function collectDoctorReport({
  supported = process.platform === 'win32',
  platform = process.platform,
  version = '',
  defaultEnabled = false,
  registrationFailures = [],
  registeredToolNames = [],
  schemaVisibility = { enabled: false, liveAgents: 0, restrictedSessions: 0 },
  backend = null,
  hideToolSchemasWhenOff = true,
  insideHost = false,
} = {}) {
  const powershell = resolvePowerShell();
  const candidates = POWERSHELL_CANDIDATES.map((candidate) => ({
    candidate,
    kind: executableState(candidate) === null ? 'path-lookup' : 'absolute',
    exists: executableState(candidate),
  }));
  const peer = peerResolution();
  const worker = scriptState(WORKER_PATH);
  const release = scriptState(RELEASE_PATH);

  /**
   * 结论：每一条都是"哪一件事不成立 + 下一步做什么"。
   *
   * 断言只写能在这份报告里自证的东西：看不到的信息宁可标 'unknown'，也不写一句看起来权威的猜测。
   */
  const findings = [];
  const note = (level, code, message, action) => findings.push({ level, code, message, action });

  if (!supported) {
    note('fatal', 'UNSUPPORTED_PLATFORM',
      `电脑操作只实现了 Windows，当前平台是 ${platform}。`,
      '换一台 Windows 机器，或在支持该平台的插件版本上使用。');
  }

  if (registrationFailures.length > 0) {
    note('fatal', 'TOOLS_REFUSED',
      `宿主拒绝了 ${registrationFailures.length} 个工具描述符：${registrationFailures.map((entry) => entry.name).join('、')}。`,
      '看 runtime.registrationFailures 里每个工具的原文；被拒的那一个工具不可用，其余工具照常。');
  }

  if (registeredToolNames.length === 0) {
    note('fatal', 'NO_TOOLS_REGISTERED',
      '宿主半边一个工具都没注册上——这正是"芯片照常显示、点下去没有反应"的形状。',
      '先看 runtime.registrationFailures；为空则说明 apply() 在此之前就中断了，去宿主日志里找 computer-use 的报错。');
  }

  if (!peer.resolvable) {
    if (insideHost) {
      // 在宿主里还能走到这一行，说明模块加载过、这条路由答了话，却仍解析不到依赖——
      // 那是一个真实的、少见的不一致，值得当阻断项报出来。
      note('fatal', 'PEER_UNRESOLVED',
        `插件在宿主里运行，却解析不到 peer 依赖 ${PEER_SPECIFIER}（${peer.error}）。`,
        '确认宿主的运行时解析面覆盖了这个依赖，或在插件目录下建一个指向宿主自带 dsh-tools 的 node_modules 链接。');
    } else {
      note('info', 'PEER_RESOLUTION_OUTSIDE_HOST',
        `裸 Node 下解析不到 ${PEER_SPECIFIER}（${peer.error}）—— 这是正常的：宿主的运行时解析面覆盖这个 peer，插件在宿主里能不能加载由 /computer-use/doctor 判定。`,
        '不用处理。要确认宿主那一边，跑：node doctor.mjs http://127.0.0.1:19387');
    }
  }

  if (!existsSync(powershell)) {
    note('fatal', 'POWERSHELL_MISSING',
      `找不到可用的 PowerShell：${powershell}。worker 起不来时，每个 computer_* 调用都会失败。`,
      '确认 %SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe 存在；企业策略移除 Windows PowerShell 的机器上需要单独装回来。');
  }

  if (!worker.exists) {
    note('fatal', 'WORKER_SCRIPT_MISSING',
      `后台脚本不在：${worker.path}。包没有按插件根解压时最容易出现这一条。`,
      '按 INSTALL.md 重新解压，确认 backend/worker.ps1 与 backend/release-input.ps1 都在。');
  }

  if (backend === null || backend.started !== true) {
    note('warn', 'BACKEND_NOT_STARTED',
      '后台进程还没有启动——这不一定是问题：它是懒启动的，第一次真正的调用会把它拉起来。',
      '用 GET /computer-use/probe 主动拉一次；它答话说明后端链路是通的。');
  } else if (backend.alive !== true) {
    note('fatal', 'BACKEND_DEAD',
      '后台进程起来了但已经死掉，下一次调用会重新拉起一个。',
      '看 /computer-use/probe 的 transport 计数：反复 spawns 增长说明 worker 每次都在启动阶段退出。');
  }

  if (schemaVisibility.enabled && schemaVisibility.liveAgents === 0) {
    note('warn', 'NO_LIVE_AGENT',
      '现在没有任何 agent 登记在 schema 可见性这条链上，所以"点开电脑操作"只能走就地释放那条兜底路。',
      '正常使用中这是暂时的（agent 一到就会自己对齐）；如果点开芯片后工具仍然不出现，把这一项和 toolSchemas 一起报出来。');
  }

  if (schemaVisibility.enabled && schemaVisibility.restrictedSessions > 0) {
    note('info', 'SCHEMAS_HIDDEN',
      `当前有 ${schemaVisibility.restrictedSessions} 个会话的 computer_* schema 被摘掉（电脑操作关着）。`,
      '这是设计行为：点开芯片就会恢复，不必重启。');
  }

  if (!hideToolSchemasWhenOff) {
    note('info', 'HIDE_DISABLED',
      'hideToolSchemasWhenOff 被关掉了，所以关着的时候工具也一直可见（调用仍会被拒）。',
      '这是受控回退，不需要处理。');
  }

  const fatal = findings.filter((entry) => entry.level === 'fatal').length;
  return {
    ok: fatal === 0,
    plugin: '@local/dsh-computer-use',
    version,
    platform,
    supported,
    defaultEnabled,
    checks: {
      powershell: { resolved: powershell, candidates },
      peer,
      scripts: { worker, release },
      tools: { registered: registeredToolNames.length, names: registeredToolNames, failures: registrationFailures.map((entry) => ({ ...entry })) },
      schemaVisibility: { ...schemaVisibility, hideToolSchemasWhenOff },
      backend: backend === null ? null : { ...backend },
    },
    findings,
    summary: fatal > 0
      ? `${fatal} 项让电脑操作无法工作；按 findings 里的 action 逐条处理。`
      : '没有发现让电脑操作无法工作的问题。',
  };
}
