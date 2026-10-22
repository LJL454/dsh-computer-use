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
 * 1.40.0 的两个关键修正：
 *
 *   * **离线/在线分模式**。离线模式只回答"当前环境/这个包/profile"的事实，不再把空工具清单
 *     误报成 `NO_TOOLS_REGISTERED`；在线模式才回答宿主注册、schema 可见性和后端状态。
 *   * **不再用白名单过滤 findings**。旧 CLI 只打印四个白名单 code，后来新增的关键检查
 *     （例如 release 脚本缺失）会被静默丢掉；现在所有 findings 都原样呈现，`RELEASE_SCRIPT_MISSING`
 *     与 `RELEASE_BUILD_MISMATCH` 也会让 `ok` 变成 false。
 */
import { statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { POWERSHELL_CANDIDATES, locatePowerShell } from './powershell.mjs';
import { WORKER_PATH, RELEASE_PATH } from './build-check.mjs';
import { PACKAGE_ROOT, readPackageManifest, summarizeRelease, verifyRelease } from './release-manifest.mjs';
import { PEER_SPECIFIERS, packageInfo, satisfies } from './preflight.mjs';

/** Peer packages and their labels. */
const PEER_LABELS = {
  '@deepseek-ai/dsh-tools': 'tools',
  '@deepseek-ai/dsh-scope': 'scope',
};

/**
 * A script file's existence, size, and modification time.
 * @param path - absolute file path.
 * @returns the description object.
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
 * Whether a resolved package lives inside the plugin's own tree.
 * @param path - resolved package directory.
 * @param packageRoot - plugin package root.
 * @returns whether it is a plugin-local copy rather than a host-provided one.
 */
function isInsidePlugin(path, packageRoot) {
  if (path === '' || packageRoot === '') return false;
  const normalized = path.toLowerCase();
  const root = (packageRoot.endsWith(sep) ? packageRoot : `${packageRoot}${sep}`).toLowerCase();
  return normalized === root.slice(0, -1) || normalized.startsWith(root);
}

/**
 * Build a self-check report.
 *
 * All host state is passed in (registration failures, visibility counts, backend summary), so
 * this module does not know `ctx` or the routes — it only arranges facts into a readable table.
 * @param options.supported - whether the platform is supported.
 * @param options.platform - raw platform identifier.
 * @param options.version - plugin version (defaults to package.json).
 * @param options.packageRoot - plugin package root (defaults to this package).
 * @param options.defaultEnabled - deployment default.
 * @param options.registrationFailures - descriptors refused by the host.
 * @param options.registeredToolNames - tools registered successfully.
 * @param options.schemaVisibility - `{ enabled, liveAgents, restrictedSessions }`.
 * @param options.backend - `{ started, alive, generation, pid }` or null.
 * @param options.hideToolSchemasWhenOff - effective config value.
 * @param options.insideHost - whether this report runs inside the host process; selects the mode.
 * @param options.mode - `'offline'` or `'host'`; defaults from `insideHost`.
 * @param options.host - result of `detectHost()`.
 * @param options.profile - result of `inspectProfile()`.
 * @param options.release - result of `verifyRelease()` (precomputed by the host).
 * @param options.requireReleaseManifest - treat a missing manifest as fatal (`doctor --release`).
 * @param options.paths - override `{ worker, release }` for tests.
 * @returns a JSON-serializable report.
 */
export function collectDoctorReport({
  supported = process.platform === 'win32',
  platform = process.platform,
  version = '',
  packageRoot = PACKAGE_ROOT,
  defaultEnabled = false,
  registrationFailures = [],
  registeredToolNames = [],
  schemaVisibility = { enabled: false, liveAgents: 0, restrictedSessions: 0 },
  backend = null,
  hideToolSchemasWhenOff = true,
  insideHost = false,
  mode = insideHost ? 'host' : 'offline',
  host = null,
  profile = null,
  release = null,
  requireReleaseManifest = false,
  paths = {},
} = {}) {
  const hostMode = mode === 'host';
  const manifestRead = readPackageManifest(packageRoot);
  const packageManifest = manifestRead.manifest;
  const effectiveVersion = version !== '' ? version : String(packageManifest?.version ?? '0.0.0-unversioned');
  const engineRange = String(packageManifest?.engines?.dsh ?? '');
  const powershell = locatePowerShell();
  const peers = {};
  for (const specifier of PEER_SPECIFIERS) {
    peers[PEER_LABELS[specifier]] = packageInfo(specifier);
  }
  const worker = scriptState(paths.worker ?? WORKER_PATH);
  const releaseScript = scriptState(paths.release ?? RELEASE_PATH);
  const releaseReport = release ?? verifyRelease(packageRoot, { version: effectiveVersion });
  const browser = {
    node: process.versions.node ?? '',
    webSocket: typeof globalThis.WebSocket === 'function',
    fetch: typeof fetch === 'function',
  };

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

  if (packageManifest === null) {
    note('fatal', 'PACKAGE_MANIFEST_MISSING',
      `读不到插件根目录的 package.json：${manifestRead.path}（${manifestRead.error}）。`,
      '确认 --package-root / 插件根指向真正含 package.json、index.js、cordis.patch.yml 的那一层；按 INSTALL.md 重新解压。');
  } else if (version !== '' && packageManifest.version !== version) {
    note('warn', 'VERSION_MISMATCH',
      `报告版本是 ${version}，但 package.json 是 ${packageManifest.version}；两边不是同一份安装。`,
      '以 package.json 为准，重新安装完整目录；不要只替换 index.js。');
  }

  if (!worker.exists) {
    note('fatal', 'WORKER_SCRIPT_MISSING',
      `后台脚本不在：${worker.path}。包没有按插件根解压时最容易出现这一条。`,
      '按 INSTALL.md 重新解压，确认 backend/worker.ps1 与 backend/release-input.ps1 都在。');
  }

  // 1.39.5 的 doctor 采集了 release 状态，却只对 worker 缺失报 fatal：隔离副本删掉
  // release-input.ps1 后仍然 ok=true（方案 §H 已复现）。这里把它变成阻断项。
  if (!releaseScript.exists) {
    note('fatal', 'RELEASE_SCRIPT_MISSING',
      `释放脚本不在：${releaseScript.path}。worker 被强杀时宿主会亲自运行它来释放按住的键；缺了它，那条路径只能失败。`,
      '按 INSTALL.md 重新解压完整包；不要只复制 worker.ps1。');
  }

  if (!releaseReport.present) {
    note(requireReleaseManifest ? 'fatal' : 'info',
      'RELEASE_MANIFEST_MISSING',
      `没有发行清单 ${join(packageRoot, 'release-manifest.json')}；当前身份是运行期计算的 ${releaseReport.buildId}。`,
      requireReleaseManifest
        ? '正式发行包必须带 release-manifest.json：用 tools/pack-candidate.mjs 重新打包，不要手工拼 zip。'
        : '源码安装可以忽略这一条；要验证完整发行身份，请用官方 zip 或 doctor --release。');
  } else if (releaseReport.error !== '') {
    note('fatal', 'RELEASE_MANIFEST_INVALID',
      `发行清单无法解析：${releaseReport.error}`,
      '重新解压完整包；不要手工编辑 release-manifest.json。');
  } else if (!releaseReport.matches) {
    const failed = Object.entries(releaseReport.checks ?? {})
      .filter(([, ok]) => ok !== true)
      .map(([name]) => name);
    const examples = [
      ...releaseReport.missing.slice(0, 5),
      ...releaseReport.extra.slice(0, 5),
      ...releaseReport.mismatched.slice(0, 5),
    ];
    note('fatal', 'RELEASE_BUILD_MISMATCH',
      `安装目录与 release-manifest.json 不一致（失败项：${failed.join('、') || 'unknown'}${examples.length > 0 ? `；示例：${examples.join('、')}` : ''}）。`,
      '这是"半套升级/混装"：不要只替换一个文件。按 INSTALL.md 用新目录整体切换，然后完整重启 DSH。');
  }

  if (host !== null && typeof host === 'object') {
    if (host.runtimeVersion === null || host.runtimeVersion === undefined || host.runtimeVersion === '') {
      note('warn', 'HOST_RUNTIME_UNKNOWN',
        '解析不到 @deepseek-ai/dsh-app-boot，无法核对 engines.dsh；这通常意味着插件不是经宿主解析面加载的。',
        '在宿主内运行 /computer-use/doctor；离线时用 profile 的依赖与 bundles 判断。');
    } else if (engineRange === '') {
      note('warn', 'ENGINE_RANGE_MISSING',
        `宿主版本是 ${host.runtimeVersion}，但 package.json 没有声明 engines.dsh。`,
        '在 manifest 写经验证的 engines.dsh 范围；不要用 * 冒充兼容。');
    } else {
      const verdict = satisfies(host.runtimeVersion, engineRange);
      if (verdict === false) {
        note('fatal', 'HOST_RUNTIME_UNSUPPORTED',
          `宿主版本 ${host.runtimeVersion} 不满足 engines.dsh ${engineRange}。`,
          '安装与该宿主版本匹配的插件版本；不要靠豁免硬装，也不要手工替换核心包。');
      } else if (verdict === null) {
        note('warn', 'HOST_RUNTIME_UNVERIFIED',
          `无法用内置比较器判断宿主版本 ${host.runtimeVersion} 是否满足 ${engineRange}。`,
          '把这两个版本一起报给维护者；不要据此认定兼容。');
      }
    }
  } else {
    note('info', 'HOST_RUNTIME_NOT_CHECKED',
      '离线模式不读取宿主版本；宿主启动失败时先看原生 Diagnostic report，不要反复请求在线 doctor。',
      '宿主恢复后运行 node doctor.mjs <origin> 或 /computer-use/doctor。');
  }

  for (const specifier of PEER_SPECIFIERS) {
    const label = PEER_LABELS[specifier];
    const peer = peers[label];
    const declared = String(packageManifest?.peerDependencies?.[specifier] ?? '');
    if (!peer.resolvable) {
      if (hostMode && label === 'tools') {
        // 在宿主里还能走到这一行，说明模块加载过、这条路由答了话，却仍解析不到依赖——
        // 那是一个真实的、少见的不一致，值得当阻断项报出来。
        note('fatal', 'PEER_UNRESOLVED',
          `插件在宿主里运行，却解析不到 peer 依赖 ${specifier}（${peer.error}）。`,
          '确认宿主的运行时解析面覆盖了这个依赖；不要为了消错在插件目录 npm install latest。');
      } else if (label === 'scope') {
        note('warn', 'SCOPE_PEER_UNRESOLVED',
          `解析不到 ${specifier}；schema 可见性会走降级路径（${peer.error}）。`,
          '这是能力退化而不是整个插件失败；确认宿主提供 dsh-scope，或接受降级并检查点开芯片后工具是否出现。');
      } else {
        note('info', 'PEER_RESOLUTION_OUTSIDE_HOST',
          `裸 Node 下解析不到 ${specifier}（${peer.error}）—— 这是正常的：宿主的运行时解析面覆盖这个 peer，插件在宿主里能不能加载由 /computer-use/doctor 判定。`,
          '不用处理。要确认宿主那一边，跑：node doctor.mjs <origin>');
      }
      continue;
    }
    if (declared !== '') {
      const verdict = satisfies(peer.version, declared);
      if (verdict === false) {
        note(hostMode ? 'fatal' : 'warn', 'PEER_VERSION_MISMATCH',
          `${specifier} 解析到 ${peer.version}，不满足声明的 ${declared}。`,
          '让宿主提供匹配版本；不要手工把核心包升级到 latest 来"消错"。');
      }
    }
    if (isInsidePlugin(peer.path, packageRoot)) {
      note('info', 'PEER_FROM_PLUGIN_TREE',
        `${specifier} 从插件目录解析：${peer.path}（版本 ${peer.version || '未知'}）。`,
        '这是开发期的 junction；面向用户的安装应让宿主解析面提供它。确认链接指向宿主自带版本，而不是第二份运行时。');
    }
  }

  if (!powershell.found) {
    note('fatal', 'POWERSHELL_MISSING',
      `找不到可用的 PowerShell（尝试过：${POWERSHELL_CANDIDATES.join('、')}）；worker 起不来时，每个 computer_* 调用都会失败。`,
      '确认 %SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe 存在；企业策略移除 Windows PowerShell 的机器上需要单独装回来。');
  } else if (powershell.source === 'path') {
    note('info', 'POWERSHELL_FROM_PATH',
      `PowerShell 从 PATH 解析为 ${powershell.command}。`,
      '这条路径可用；如果它不是 Windows PowerShell 5.1，截图/UIA 可能缺 GAC 程序集，doctor 的后续能力检查会暴露。');
  }
  if (powershell.found && /(^|[\\/])pwsh(\.exe)?$/i.test(powershell.command)) {
    note('warn', 'POWERSHELL_7_SELECTED',
      `只找到 PowerShell 7（${powershell.command}）；它不保证带 GAC 里的 WinForms / Drawing / UI Automation 程序集。`,
      '优先安装/保留 Windows PowerShell 5.1；PowerShell 7 不是 Windows PowerShell 的无条件等价替换。');
  }

  if (!browser.webSocket || !browser.fetch) {
    note('warn', 'BROWSER_CAPABILITY_MISSING',
      `当前 Node ${browser.node} 缺少 ${!browser.webSocket ? '全局 WebSocket' : '全局 fetch'}；browser_* 会返回 capability_unavailable，桌面工具不受影响。`,
      '完整浏览器能力需要 Node 22+（全局 WebSocket 稳定）；不要为此升级宿主内嵌 Node 而不做验证。');
  }

  if (hostMode) {
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
  }

  if (profile !== null && typeof profile === 'object') {
    for (const entry of profile.findings ?? []) {
      if (entry && typeof entry.code === 'string') {
        note(entry.level ?? 'warn', entry.code, entry.message ?? '', entry.action ?? '');
      }
    }
  }

  const fatal = findings.filter((entry) => entry.level === 'fatal').length;
  const warn = findings.filter((entry) => entry.level === 'warn').length;
  return {
    ok: fatal === 0,
    plugin: '@local/dsh-computer-use',
    version: effectiveVersion,
    mode,
    platform,
    supported,
    defaultEnabled,
    package: {
      root: packageRoot,
      name: String(packageManifest?.name ?? ''),
      version: String(packageManifest?.version ?? ''),
      engines: packageManifest?.engines ?? null,
    },
    checks: {
      powershell: {
        resolved: powershell.command,
        found: powershell.found,
        source: powershell.source,
        selected: powershell.selected,
        candidates: powershell.candidates,
      },
      peers,
      // 向后兼容：旧报告里 checks.peer 指 tools。
      peer: peers.tools,
      scripts: { worker, release: releaseScript },
      release: summarizeRelease(releaseReport),
      tools: {
        registered: registeredToolNames.length,
        names: registeredToolNames,
        failures: registrationFailures.map((entry) => ({ ...entry })),
      },
      schemaVisibility: { ...schemaVisibility, hideToolSchemasWhenOff },
      backend: backend === null ? null : { ...backend },
      browser,
      host,
      profile: profile === null ? null : {
        requested: profile.requested === true,
        dir: profile.dir ?? '',
        dependency: profile.dependency ?? null,
        bundles: profile.bundles ?? [],
        patch: profile.patch ?? null,
        coreCopies: profile.coreCopies ?? [],
      },
    },
    findings,
    summary: fatal > 0
      ? `${fatal} 项让电脑操作无法工作${warn > 0 ? `，另有 ${warn} 项需要注意` : ''}；按 findings 里的 action 逐条处理。`
      : warn > 0
        ? `没有阻断项，但有 ${warn} 项需要注意；按 findings 里的 action 核对。`
        : '没有发现让电脑操作无法工作的问题。',
  };
}
