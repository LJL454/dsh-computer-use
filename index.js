/**
 * Host half of @local/dsh-computer-use — the "电脑操作" capability.
 *
 * It owns three things:
 *   1. a lazy singleton PowerShell backend (screenshots, SendInput, UI Automation);
 *   2. the `computer_*` tools the model calls, each gated on a per-Session grant;
 *   3. two small JSON routes the composer chip uses to read and flip that grant.
 *
 * The grant is deliberately per Session and off by default. Handing a model the
 * mouse and keyboard is a bigger step than reading files, so it is something the
 * user turns on for one conversation and can turn off again, which is exactly
 * what the chip in the composer expresses.
 */
import { importHostModule, describeHostEntry } from './internal/host-packages.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, lstatSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PowerShellBackend, ComputerUseBackendError } from './backend/bridge.js';
import { CdpConnection, CdpError } from './browser/connection.mjs';
import { BrowserSession, formatBrowserNode } from './browser/state.mjs';
import { runActions, clampActionBudget, BROWSER_ACTIONS } from './browser/actions.mjs';
import { applyTokenGuard } from './internal/token-guard.mjs';
import { applyAppLaunch } from './internal/app-launch.mjs';
import {
  WORKER_PATH,
  RELEASE_PATH,
  hashFileOnDisk,
  workerBuildOnDiskAsync,
  buildReadsCount,
  setBuildCacheEnabled,
} from './internal/build-check.mjs';
import {
  PACKAGE_ROOT,
  readPackageManifest,
  summarizeRelease,
  verifyRelease,
} from './internal/release-manifest.mjs';
import { claimInstance, describeInstance, releaseInstance } from './internal/instance-registry.mjs';
import { detectHost } from './internal/preflight.mjs';
import {
  backendMessage,
  decorateFailure,
  withOutcomeNote,
  isIdempotentCall,
  READ_ONLY_ACTIONS,
  READ_ONLY_STEPS,
  STEP_ACTION_LIST,
  UIA_ACTION_LIST,
} from './internal/failures.mjs';
import {
  CONTROLLER_IDLE_MS,
  movesDesktop,
  claimController,
  noteAction,
  beginWrite,
  finishWrite,
  leaseReport,
} from './internal/lease.mjs';
import { sessionKey, createSessions } from './internal/sessions.mjs';
import { combineSignals, describeCall, createExecutionRegistry } from './internal/execution.mjs';
import { normalizeCaptureSpec, resolveFormat, screenshotEnvelope, createCaptureService } from './internal/capture.mjs';
import { createRefRegistry } from './internal/refs.mjs';
import {
  IMAGE_VALUE_SCHEMA,
  STABILITY_VALUE_SCHEMA,
  SCREENSHOT_VALUE_SCHEMA,
  FRAME_ITEM_PROPERTIES,
  UIA_NODE_SCHEMA,
  UIA_WINDOW_SCHEMA,
  UIA_TEXT_RANGE_SCHEMA,
  UIA_TEXT_SCHEMA,
  UIA_STATE_SCHEMA,
  BROWSER_STATE_SCHEMA,
  WAIT_CONDITION_SCHEMA,
  BATCH_STEP_SCHEMA,
  BATCH_VALUE_SCHEMA,
  STEP_PASSTHROUGH,
  formatDisplays,
  stabilityValue,
  captureTiming,
  shotValue,
  textFieldValue,
  textObservationValue,
  digestOfNodes,
  digestOfText,
  stateValue,
  renderTextObservation,
  renderState,
  // 内容摘要 memo 与它的上限：`markObservation` 留在入口（它是"这次观察是否重复上次"的记账，
  // 属于会话级逻辑），而 memo 本身按内容寻址，放在契约层。
  observedDigests,
  OBSERVED_DIGEST_LIMIT,
} from './internal/tool-contracts.mjs';
import { createSchemaVisibility } from './internal/schema-visibility.mjs';
import { collectDoctorReport } from './internal/doctor.mjs';
import { applyDegraded } from './internal/degraded.mjs';

/**
 * 宿主自带的 `defineTool`，按**绝对路径**解析后取用。
 *
 * 不能写成静态 `import ... from '@deepseek-ai/dsh-tools'`：`dsh plugin add` 用的是 `link:`，
 * 模块位于解压目录（`D:\DSH-Plugins\...`），Node 会从那里逐级向上找 `node_modules`，永远
 * 找不到应用里那份；整行随之导入失败，宿主本身却一切正常——用户看到的只是"装好了，但输入框
 * 里没有「电脑操作」按钮"，没有任何报错。解析策略见 internal/host-packages.mjs。
 *
 * 失败时**先留一条结构化诊断再抛**（研究报告 P1-A 的短期要求）：此时 `apply()` 还一行都没跑，
 * 宿主日志里只有一句 import 失败；把 stage / code / 尝试过的候选 / 运行时类型打出来，离线也能
 * 定位，而不用靠"再装一遍看看"。
 *
 * 1.40.3 起不再直接抛出：失败会走 `internal/degraded.mjs` 的**降级挂载**——不带任何工具、
 * 不启动 worker，只把 `/computer-use/status` 与 `/computer-use/doctor` 挂成 503 + 结构化
 * 失败原因。"整个 404"与"装好了但没反应"之间，至少要留下一条能读的入口。
 */
let hostTools = null;
let bootstrapError = null;
try {
  hostTools = await importHostModule('@deepseek-ai/dsh-tools');
} catch (error) {
  bootstrapError = error;
  const diagnostic = {
    stage: 'resolve/import',
    specifier: '@deepseek-ai/dsh-tools',
    code: error?.code ?? 'HOST_PACKAGE_IMPORT_FAILED',
    message: String(error?.message ?? error),
    resolution: error?.resolution ?? null,
    executable: process.execPath ?? '',
    electron: process.versions.electron ?? null,
    node: process.versions.node ?? '',
    at: new Date().toISOString(),
  };
  try {
    console.error(`computer-use: BOOTSTRAP_FAILED ${JSON.stringify(diagnostic)}`);
  } catch { /* stderr may be gone; the degraded row below still records it */ }
}
const defineTool = hostTools?.defineTool;

/** Stable Loader identity. */
export const name = 'computer-use';

/**
 * Services this plugin cannot work without.
 *
 * `webServer` is deliberately NOT listed: it exists only to carry the composer
 * chip's state route, and a headless or scripted profile has no chip. Requiring
 * it there would block the tools too, in exactly the deployment where unattended
 * computer control is most useful. The routes register through a scoped
 * `ctx.inject` when a web server is actually present.
 *
 * 降级挂载时 `tools` 不可用（正是它导入失败的），所以这里必须为空：否则 row 会停在
 * PENDING 等一个永远不会出现的服务，连那条只读路由都挂不上。
 */
export const inject = bootstrapError === null ? ['tools'] : [];

/**
 * Plugin version echoed by the status route.
 *
 * Read from package.json rather than written here a second time (8.txt §3): the two
 * copies had already drifted apart once — the package said 1.19.1 while the chip and
 * every diagnostic still reported 1.19.0 — and "which build is this?" is exactly the
 * question a version is for. An unreadable manifest degrades to a version that is
 * obviously not a release rather than to a plausible wrong number.
 */
const VERSION = (() => {
  const manifest = readPackageManifest(PACKAGE_ROOT).manifest;
  return typeof manifest?.version === 'string' && manifest.version !== '' ? manifest.version : '0.0.0-unversioned';
})();

/**
 * The behaviour contract these two halves speak.
 *
 * Bumped when the arguments or the meaning of a reply changes in a way an older worker
 * would misread. The worker publishes its own number at startup and the host refuses to
 * drive one that answers differently, because the alternative is a model discovering a
 * half-applied upgrade three actions into a task.
 */
const WORKER_PROTOCOL = 2;

/**
 * The worker capabilities this host cannot do its job without.
 *
 * Every name here is something this work added to the worker's own behaviour, and the host
 * reports or acts on each one: without it the reply would be read as if it meant something else
 * (a read with no `traversal`, a batch with no `progress`). §13.7 asks that host and worker roll
 * back as a set; this list is how a half-applied rollback is refused instead of tolerated.
 */
const REQUIRED_WORKER_CAPABILITIES = ['reply.traversal', 'reply.pushdown', 'input.partial', 'deadline.enforced', 'release.independent'];

/** Route prefix owned by this plugin. */
const ROUTE = '/computer-use';

/** Chip label, kept in one place because the host reports it to the client. */
const LABEL = '电脑操作';

/**
 * Whether this build can actually drive the desktop.
 *
 * The backend is SendInput + GDI + UI Automation, so it is Windows-only. On any
 * other platform the plugin still loads (it is a normal profile row) but must
 * report itself unavailable and refuse every call, rather than offering tools
 * that fail at execution time with a confusing internal error. This mirrors the
 * "not-applicable / below-minimum / supported" three-state capability gate that
 * the reference design uses: an unsupported platform is a state the chip shows,
 * not a surprise the model discovers.
 */
const SUPPORTED = process.platform === 'win32';

/** Why the capability is unavailable, phrased for both the chip and the model. */
const UNSUPPORTED_REASON = `电脑操作目前只实现了 Windows（SendInput + GDI + UI Automation），当前平台是 ${process.platform}。`;

/** How the model is told to obtain the grant. */
const GRANT_HINT = '若要使用电脑操作，请让用户在输入框工具栏点击「电脑操作」开启该能力，然后重试。';

/**
 * Why a subagent can never drive the desktop, however the deployment is configured.
 *
 * Delegated subagents run with the scope they were started with; a capability that
 * moves the mouse and keyboard is exactly the kind of thing that must not be
 * reachable by widening a scope from the inside. The message tells the child what to
 * do instead — hand the step back to the parent — rather than just denying it.
 */
const SUBAGENT_REFUSAL = '电脑操作不对子代理开放：子代理的权限范围在启动时就固定了，不能从会话内部放宽。请把需要操作电脑的这一步交回主代理执行。';

/** Cap on a JSON request body accepted from the chip. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Human-readable message for a backend failure, with the two cases the model can
 * actually act on called out.
 * @param error - the thrown value.
 * @returns model-facing text.
 */

/**
 * Read and parse a bounded JSON body.
 * @param req - the incoming request stream.
 * @returns the parsed object, or an empty object for an empty body.
 */
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text === '' ? {} : JSON.parse(text);
}

/**
 * Send one JSON response.
 * @param res - the response to write.
 * @param status - HTTP status code.
 * @param payload - JSON-serializable body.
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}


/**
 * Host half entry point.
 * @param ctx - the plugin context carrying `tools` and `webServer`.
 * @param config - deployment configuration for this plugin row.
 */
export function apply(ctx, config = {}) {
  // 降级挂载：宿主依赖没导入成功时，只挂两条只读路由，不注册工具、不启动 worker。
  if (bootstrapError !== null) {
    applyDegraded(ctx, config, bootstrapError);
    return;
  }

  /**
   * §A: one owner per host.
   *
   * Every `apply()` used to create its own grant table, visibility manager, backend state and
   * the same fixed `/computer-use/*` routes. A second mount therefore failed on the duplicate
   * status route — after it had already registered tools — and the preset that carried it
   * broke. The claim below happens **before** any of that. It is keyed on `ctx.root` (or a
   * per-context fallback for test contexts), so two module copies in one host see the same
   * registry while two independent hosts in one process stay isolated.
   */
  const claim = claimInstance({
    ctx,
    packageName: '@local/dsh-computer-use',
    version: VERSION,
    root: PACKAGE_ROOT,
  });
  if (!claim.ok) {
    const existing = claim.existing;
    ctx?.logger?.error?.(
      `computer-use: DUPLICATE_INSTANCE — ${existing.packageName}@${existing.version} is already mounted from ${existing.root}; this copy ${VERSION}@${PACKAGE_ROOT} was not mounted. Remove the duplicate bundle/preset row; the first instance keeps its tools and routes.`,
    );
    return;
  }
  /** This instance's slot in the host-wide registry. */
  const instance = claim.record;
  const releaseOwnership = () => releaseInstance(claim.registry, instance);
  if (typeof ctx?.effect === 'function') {
    try {
      ctx.effect(() => releaseOwnership, 'computer-use: single-instance ownership');
    } catch (error) {
      // A host without a working effect surface cannot tell us when to release. The record
      // would then outlive the plugin; say so rather than pretending the claim is durable.
      ctx?.logger?.warn?.(`computer-use: could not register instance ownership (${String(error)}); duplicate-mount detection may report a stale owner until restart`);
    }
  } else if (typeof ctx?.on === 'function') {
    ctx.on('dispose', releaseOwnership);
  }

  /**
   * §G: the whole release identity, not just worker.ps1.
   *
   * Computed once per apply. A shipped `release-manifest.json` is compared with the files on
   * disk; a source checkout without one still reports its computed id so "which build is this?"
   * has an answer. A mismatch is logged loudly here and reported as a fatal finding by doctor.
   */
  const release = verifyRelease(PACKAGE_ROOT, { version: VERSION });
  const host = detectHost();
  if (release.present && !release.matches) {
    ctx?.logger?.error?.(
      `computer-use: RELEASE_BUILD_MISMATCH — installed files do not match ${release.manifestPath} (computed ${release.buildId}, manifest ${release.manifest?.releaseBuildId ?? '?'}). This is a half-applied upgrade; reinstall the whole package and restart. Details: ${JSON.stringify(release.checks ?? {})}`,
    );
  }
  const defaultEnabled = config.defaultEnabled === true;
  const shotRoot = typeof config.shotDir === 'string' && config.shotDir.trim() !== ''
    ? config.shotDir
    : join(tmpdir(), 'dsh-computer-use');
  const actionTimeoutMs = Number.isFinite(config.actionTimeoutMs) ? config.actionTimeoutMs : 20_000;
  const startTimeoutMs = Number.isFinite(config.startTimeoutMs) ? config.startTimeoutMs : 30_000;
  // §13.6: the read optimisation has a controlled off switch, so a regression can be attributed
  // rather than guessed at. Turning it on changes only whether the digest is remembered.
  setBuildCacheEnabled(config.verifyWorkerBuildEveryCall !== true);
  /**
   * This plugin instance's own directory and identity (§6 ⑧).
   *
   * The cancel and held-input markers used to be named after the *process id* alone, so two
   * plugin instances in one process -- two scopes in a test run, two mounts in one host -- wrote
   * to the same file: a cancel meant for one worker cancelled the other, and a force-kill could
   * release input recorded by a different worker. The identity is per instance and random, and
   * every marker lives under it, so instances cannot reach into each other.
   */
  const instanceId = randomBytes(6).toString('hex');
  const instanceRoot = join(shotRoot, `instance-${instanceId}`);
  const markerPath = (name) => join(instanceRoot, `${name}-${process.pid}.flag`);
  // The markers are written by the bridge on its cancel path, which is best effort and does not
  // create directories: the instance's own directory has to exist first, or a cancel would be a
  // silent no-op. Failure here is not fatal — the timeout path still stops the worker — so it is
  // reported rather than thrown.
  try {
    mkdirSync(instanceRoot, { recursive: true });
  } catch (error) {
    ctx?.logger?.warn?.(`computer-use: could not create the instance directory ${instanceRoot} (${String(error?.message ?? error)}); cancel markers will be best effort`);
  }

  // token-guard 原本是独立插件（@local/dsh-token-guard），现并入本插件：它压的是工具返回的文本
  // （默认只压 `pwsh`），与"电脑操作"是两件事，所以**不**受会话开关约束，只有自己的开关
  // （config.tokenGuard.enabled，默认 true）。挂不上也不能影响插件本体，因此整段包在 try 里。
  if (typeof ctx.on === 'function') {
    try {
      applyTokenGuard(ctx, config?.tokenGuard ?? {});
    } catch (error) {
      ctx.logger?.warn?.(`computer-use: token-guard could not mount (${String(error)})`);
    }
  }

  // 注意：app-launch 的挂载放在下面 `defineTracedTool` 定义之后 —— 那里要用它包一层，
  // 让这两个工具与其它工具一样出现在 trace 里。

  /** 会话登记与授权：见 internal/sessions.mjs（§10 宿主半边拆分）。 */
  const sessions = createSessions({ defaultEnabled });
  // `sessionKey` 是模块级导出（归一化不属于某个实例），授权查询才在实例上。
  const { isEnabled } = sessions;

  let backend = null;
  /** When the worker was last replaced because it was serving the legacy accessibility bridge. */
  let lastLegacyRestartMs = 0;


  /**
   * 会话的 schema 可见性：能力关着时把这一族的 schema 从该会话的视野里摘掉（§9 表那行 /
   * 见 internal/schema-visibility.mjs）。
   */
  const visibility = createSchemaVisibility({
    enabled: config.hideToolSchemasWhenOff !== false,
    isEnabled,
    logger: ctx.logger,
    onSessionDisposed: (sessionId) => {
      disposeBrowserSessionsFor(sessionId);
      // 会话收尾：这次任务抓过的图与派生帧一起删（只删本插件自己产出的，`save_path` 存的动不了）。
      // 排在会话真正释放之后，所以此刻不会再有人来读这些文件。
      void releaseSessionCaptures(sessionId);
    },
  });
  if (visibility.enabled && typeof ctx.on !== 'function') {
    // 没有事件面的组合观察不到 agent；这时工具保持"可见但被拒"，而不是悄悄丢掉能力。
    ctx.logger?.warn?.('computer-use: ctx.on is unavailable; tool schemas stay advertised for every session');
  }
  if (visibility.enabled && typeof ctx.on === 'function') {
    ctx.on('agent/created', ({ agent }) => visibility.remember(agent));
    ctx.on('agent/disposed', ({ agent }) => visibility.forget(agent));
    ctx.effect(() => () => visibility.releaseAll(), 'computer-use: tool-schema visibility');
  }

  /** 执行协调（在飞登记 / 停止状态 / 浏览器通道的会话上下文）：见 internal/execution.mjs。 */
  const execution = createExecutionRegistry();
  /** 截图服务（规范化 / 命名 / 去重入库 / 信封）：见 internal/capture.mjs。 */
  const captureService = createCaptureService({ sessionKey });

  /**
   * worker 抓关联帧时，若请求里没带落盘基名，它会退回系统临时目录。那些文件不在截图目录下，登记表
   * 也管不到它们，所以按前缀扫一次临时目录。
   *
   * 只删本插件的帧（前缀是插件专有的），并且只删**已经过时**的那些 —— 正在进行的抓取可能刚好写了
   * 一帧还没回传，按时间把它排除掉。
   */
  async function releaseStrayFrames({ olderThanMs = 15 * 60 * 1000 } = {}) {
    try {
      const { readdir, stat, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const dir = tmpdir();
      const cutoff = Date.now() - olderThanMs;
      const entries = await readdir(dir).catch(() => []);
      await Promise.all(entries
        .filter((name) => name.startsWith('dsh-frame-'))
        .map(async (name) => {
          const full = join(dir, name);
          try {
            const info = await stat(full);
            if (info.mtimeMs >= cutoff) return; // 可能正被用着
            await rm(full, { force: true });
          } catch {
            /* best effort */
          }
        }));
    } catch {
      /* best effort */
    }
  }

  /**
   * 会话收尾：删掉这次任务产出的图与派生帧。失败不抛 —— 收尾本身不该成为新的失败来源。
   */
  async function releaseSessionCaptures(sessionId) {
    try {
      await captureService.releaseSession(sessionId);
      await releaseStrayFrames();
    } catch (error) {
      ctx.logger?.warn?.(`computer-use: capture cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  /** 引用注册表（哪个会话被展示过哪次观察/哪一帧）：见 internal/refs.mjs。 */
  const refs = createRefRegistry({ sessionKey, generationOf: () => backend?.info?.generation });

  /**
   * What the desktop control is doing for one session.
   *
   * The states are deliberately separate, because they call for different user
   * reactions: 未开启 (never turned on), 仅观察 (allowed, nothing driven yet), 可操作
   * (this session holds the desktop), 执行中 (a call is in flight), 停止中 (a revoke is
   * draining), 已停止 (the user turned it off).
   * @param sessionId - the Session the chip is mounted in.
   * @returns the control block the chip renders.
   */
  function controlState(sessionId) {
    const key = sessionKey(sessionId);
    const enabled = SUPPORTED && isEnabled(sessionId);
    const busy = execution.count(sessionId) > 0;
    const leaseState = leaseReport(key);
    let state = 'off';
    if (execution.isStopping(key)) state = 'stopping';
    else if (!enabled) state = sessions.hasExplicit(key) ? 'stopped' : 'off';
    else if (busy) state = 'busy';
    else if (leaseState.owns && leaseState.idleMs !== null && leaseState.idleMs < CONTROLLER_IDLE_MS) state = 'ready';
    else state = 'observing';
    return {
      state,
      enabled,
      inFlight: execution.count(sessionId),
      // Whether this session currently pays for the computer_* schemas. The chip
      // shows it, and the paired test reads it instead of guessing.
      toolSchemas: visibility.toolSchemaState(key),
      lease: leaseState.lease,
      lastAction: leaseState.lastAction,
    };
  }

  /**
   * Lazily create the backend and wait for it to answer.
   * @returns the started backend.
   */
  async function ensureBackend() {
    if (!SUPPORTED) throw new ComputerUseBackendError(UNSUPPORTED_REASON, 'UNSUPPORTED_PLATFORM');
    if (backend === null) {
      backend = new PowerShellBackend({
        timeoutMs: Math.max(actionTimeoutMs, startTimeoutMs),
        startTimeoutMs,
        cancelFilePath: markerPath('cancel-main'),
      });
    }
    await backend.start();
    return backend;
  }

  /**
   * Replace the worker process.
   *
   * The reason this exists: the UI Automation *core* inside the worker can end up serving the
   * MSAA-to-UIA bridge for a process instead of that process's own provider, and it then stays
   * that way -- every control comes back as a generic `Pane` with a numeric automation id, the
   * real control types and ids are gone. Re-creating the client object inside the same process
   * does not clear it (verified), while a freshly started worker reads the same window natively
   * (also verified), so the process is what has to go. Refs from before the restart are refused
   * by generation, which is the documented behaviour and the honest one.
   * @returns the started replacement.
   */
  async function restartBackend() {
    const previous = backend;
    backend = null;
    try {
      previous?.dispose();
    } catch {
      /* best effort: the replacement is what matters */
    }
    return await ensureBackend();
  }

  /**
   * Check that the worker implements the same action set this half declares.
   *
   * The two halves ship together but run as separate processes, so a half-applied
   * upgrade is possible. Without this check the failure it produces is the worst kind: a
   * documented action that the schema accepts and the dispatcher rejects, discovered by
   * the model three actions into a task. The worker publishes its list at startup, so the
   * mismatch is reported once, before anything is dispatched.
   * @param instance - the started backend.
   */
  function assertActionContract(instance) {
    const reported = instance.info?.actions;
    if (!Array.isArray(reported)) return; // an older worker publishes no list: nothing to compare
    if (reported.map(String).join(',') === STEP_ACTION_LIST.join(',')) return;
    throw new Error(`[BAD_REQUEST] the computer-use backend worker implements a different action set than this plugin declares (worker: ${reported.join(', ')}). Restart the desktop app so both halves come from the same install.`);
  }

  /**
   * Check that the running worker is the one this half was built to talk to.
   *
   * Three questions, all asked before the first call is dispatched, because each of them
   * otherwise surfaces as a mystery refusal three actions into a task:
   *
   *   actions    does it implement the same step actions (the original check)?
   *   protocol   does it speak the same behaviour contract? A worker that answers with an
   *              older meaning is refused rather than driven with arguments it will misread.
   *   build      is the process running the worker.ps1 that is on disk now? A file replaced
   *              after the worker started is a half-applied upgrade, and the two halves would
   *              then disagree about behaviour with nothing in the conversation to explain it.
   *
   * A worker that publishes none of this is an older build: it is left to the action check
   * (which it also fails to publish), exactly as before.
   * @param instance - the started backend.
   */
  async function assertWorkerContract(instance) {
    assertActionContract(instance);
    const protocol = Number(instance.info?.protocol);
    if (Number.isFinite(protocol) && protocol !== WORKER_PROTOCOL) {
      throw new Error(`[PROTOCOL_MISMATCH] the computer-use worker speaks protocol ${protocol} and this plugin speaks ${WORKER_PROTOCOL}, so they were not shipped together. The worker may be an older or newer copy than index.js — restart the desktop app (or reinstall the plugin) so both halves come from the same install.`);
    }
    // §13.7: host and worker roll back **as a set**, and this is what makes that checkable.
    // Matching build hashes only prove "the running process matches the file on disk" — a new
    // host with a 1.39.1 worker satisfies that and then disagrees with it about every reply it
    // reads. The capabilities this host relies on are therefore required by name.
    //
    // A worker that publishes *no* list at all is a different case: it is a minimal worker (the
    // fixtures the test suite uses, or an install from before the list existed), and the action
    // contract below still applies to it. The 1.39.1 worker does publish a list — it just does
    // not contain these — so the rollback this check exists for is still refused.
    const published = Array.isArray(instance.info?.capabilities) ? instance.info.capabilities.map(String) : [];
    if (published.length > 0) {
      const missing = REQUIRED_WORKER_CAPABILITIES.filter((one) => !published.includes(one));
      if (missing.length > 0) {
        throw new Error(`[PROTOCOL_MISMATCH] this host needs worker capabilities that the running computer-use worker does not have: ${missing.join(', ')} (the worker publishes ${published.length} capabilities, and these are not among them). That is a half-applied upgrade or rollback — index.js and backend/worker.ps1 are not from the same install — so the two halves would disagree about what a reply means. Restore both together (or reinstall the plugin) and restart the desktop app.`);
      }
    }
    const reported = typeof instance.info?.build === 'string' ? instance.info.build : '';
    // §7.2: the digest is read asynchronously and reused while the file's identity is
    // unchanged, so the hot path no longer pays a synchronous 606 KB read per call — and a
    // file that really changed still produces a mismatch here.
    const onDisk = await workerBuildOnDiskAsync();
    if (reported !== '' && onDisk !== '' && reported !== onDisk) {
      throw new Error(`[PROTOCOL_MISMATCH] the running computer-use worker was started from a different build of worker.ps1 than the one on disk now (worker ${reported}, disk ${onDisk}). That is a half-applied upgrade: the file changed after the worker started. Restart the desktop app so both halves load from the same file.`);
    }
    // §13.5: the code that actually runs is worker.ps1 *and* the release script the host runs
    // when it force-kills the worker, so both are covered by the build check.
    const releaseReported = typeof instance.info?.releaseBuild === 'string' ? instance.info.releaseBuild : '';
    const releaseOnDisk = await hashFileOnDisk(RELEASE_PATH);
    if (releaseReported !== '' && releaseOnDisk !== '' && releaseReported !== releaseOnDisk) {
      throw new Error(`[PROTOCOL_MISMATCH] the running computer-use worker was started from a different build of release-input.ps1 than the one on disk now (worker ${releaseReported}, disk ${releaseOnDisk}). That is a half-applied upgrade — and this is the script that releases held input when a worker is killed, so a mismatch here could press the wrong keys. Restart the desktop app so both halves load from the same files.`);
    }
    // The environment half of the capability model: the DPI awareness this process actually got.
    // A process that is not per-monitor aware has its screen coordinates virtualized, which
    // changes what every capture and every click means -- worth knowing once, per worker.
    const awareness = String(instance.info?.dpiActual ?? instance.info?.dpi ?? '');
    if (awareness !== '') {
      noteCapability('env', 0, awareness.includes('per-monitor') ? 'available' : 'degraded', `dpi awareness: ${awareness}`);
    }
  }

  /**
   * Start the worker in the background so the first real action is not the one
   * paying for `Add-Type`. Spawning it costs ~0.7 s once per host process; the
   * model should never be the one waiting for it.
   */
  function warmBackend() {
    if (!SUPPORTED) return;
    void ensureBackend().catch(() => {
      // Swallowed on purpose: the first real call re-runs this path and reports the
      // failure with the context the model needs to act on it.
    });
  }

  /**
   * Whether the calling agent is a delegated subagent.
   *
   * A subagent session carries `header.origin === 'subagent'` and a `parentSession`;
   * its permission scope is fixed when it is started and cannot be widened from
   * inside. The per-session grant alone would leak the capability into every child
   * as soon as a deployment sets `defaultEnabled: true`, so this is checked
   * separately — and it is then checked a second time on the runtime path, because a
   * policy layer that can be bypassed is not a policy.
   * @param exec - the tool execution carrying the calling agent.
   * @returns whether the caller is a subagent.
   */
  function isSubagent(exec) {
    const header = exec?.agent?.session?.header;
    return header?.origin === 'subagent';
  }

  /**
   * Refuse when the calling Session has not been granted computer control.
   *
   * Every entry point runs this before it validates its own arguments, so a
   * disabled capability reports the same actionable message no matter what the
   * model passed.
   * @param exec - the tool execution carrying the calling agent.
   */
  function requireGrant(exec) {
    if (!SUPPORTED) {
      throw new Error(`[UNSUPPORTED_PLATFORM] ${UNSUPPORTED_REASON}`);
    }
    if (isSubagent(exec)) {
      throw new Error(`[SUBAGENT_COMPUTER_USE_UNAVAILABLE] ${SUBAGENT_REFUSAL}`);
    }
    const sessionId = exec?.agent?.session?.id;
    if (!isEnabled(sessionId)) {
      // Converge here as well: a session whose agent was created before this
      // plugin's listener (or whose grant changed elsewhere) still stops paying
      // for schemas it may not use.
      visibility.sync(exec?.agent);
      throw new Error(`[NOT_AUTHORIZED] 电脑操作尚未在本会话开启。${GRANT_HINT}`);
    }
  }

  /* ------------------------------------------- V01: the task-level trace ----- */

  /**
   * One record per tool call, kept in this process.
   *
   * The plan asks for a trace whose stages can be related to each other (V01) and for the
   * five numbers a fixed task set produces: tool calls, inputs that reached the wrong target
   * versus inputs a guard stopped, how much observation cost, how each wait ended, and how
   * often a call had to recover. None of them can be reconstructed after the fact from the
   * conversation, because the conversation keeps only what the tools returned — and a tool
   * that returned nothing is exactly the case worth counting.
   *
   * Deliberately *not* here: model round trips and wall-clock task time. Those belong to the
   * host, which is the only half that can see them; guessing them here would produce numbers
   * that look authoritative and are wrong.
   */
  const TRACE_LIMIT = 100;
  const trace = [];
  let spanSeq = 0;
  const metrics = {
    toolCalls: 0,
    refusals: 0,
    /** Inputs a guard stopped *before* they were sent (方案 §9.1: counted apart from delivered ones). */
    guardInterceptions: 0,
    screenshots: 0,
    screenshotPixels: 0,
    screenshotBytes: 0,
    /** UIA reads: how many, how many nodes they walked, how long they took (§9.1 observationCost). */
    uiReads: 0,
    uiNodes: 0,
    uiReadMs: 0,
    waitOutcomes: { satisfied: 0, timeout: 0, unavailable: 0 },
    readRetries: 0,
  };

  /** A short, safe summary of a call's arguments: hwnds and sizes, never text bodies. */
  function summariseArgs(args) {
    const out = {};
    if (args === null || typeof args !== 'object') return out;
    if (Number.isFinite(Number(args.hwnd)) && Number(args.hwnd) !== 0) out.hwnd = Number(args.hwnd);
    if (Number.isFinite(Number(args.window)) && Number(args.window) !== 0) out.window = Number(args.window);
    if (typeof args.action === 'string') out.action = args.action;
    if (Array.isArray(args.steps)) out.steps = args.steps.length;
    if (args.region !== null && args.region !== undefined) out.region = true;
    if (args.screenshot === true) out.screenshot = true;
    if (typeof args.text === 'string') out.textChars = args.text.length;
    if (Array.isArray(args.expected_transitions)) out.expectedTransitions = args.expected_transitions.length;
    return out;
  }

  function beginSpan(tool, args, exec) {
    spanSeq += 1;
    metrics.toolCalls += 1;
    return {
      span: spanSeq,
      tool,
      at: Date.now(),
      ok: true,
      args: summariseArgs(args),
      // Which conversation made this call: a capability observed in one conversation is not
      // automatically a fact about another one sharing the same worker (§5.3).
      session: sessionKey(exec?.agent?.session?.id),
    };
  }

  function pushSpan(record) {
    trace.push(record);
    while (trace.length > TRACE_LIMIT) trace.shift();
  }

  function endSpan(record, value) {
    record.ms = Math.max(0, Date.now() - record.at);
    const timing = value?.timing;
    if (timing !== null && timing !== undefined && typeof timing === 'object') {
      for (const key of ['queueMs', 'captureMs', 'admitMs', 'workerMs', 'backendMs']) {
        if (Number.isFinite(Number(timing[key]))) record[key] = Number(timing[key]);
      }
    }
    const shot = value?.shot ?? (value?.imageWidth === undefined ? undefined : value);
    if (shot !== undefined && shot !== null && Number.isFinite(Number(shot.imageWidth))) {
      metrics.screenshots += 1;
      metrics.screenshotPixels += Number(shot.imageWidth) * Number(shot.imageHeight);
      metrics.screenshotBytes += Number(shot.bytes ?? 0);
      record.image = `${Number(shot.imageWidth)}x${Number(shot.imageHeight)}`;
    }
    // The other half of observation cost: a read that walks a thousand nodes and one that walks
    // five look identical in a screenshot count, and it is the tree walk that decides whether a
    // task is spending its budget on looking (§9.1).
    const walked = Number(value?.walked);
    if (Number.isFinite(walked)) {
      metrics.uiReads += 1;
      metrics.uiNodes += walked;
      metrics.uiReadMs += record.ms;
      record.uiNodes = walked;
    }
    for (const report of Array.isArray(value?.waits) ? value.waits : []) {
      const status = String(report?.status ?? '');
      const outcome = String(report?.outcome ?? '');
      const bucket = report?.satisfied === true ? 'satisfied' : (outcome === 'unavailable' || status === 'unknown') ? 'unavailable' : 'timeout';
      metrics.waitOutcomes[bucket] += 1;
      record.waits = Number(record.waits ?? 0) + 1;
    }
    if (typeof value?.outcome === 'string') record.outcome = value.outcome;
    if (typeof value?.frame === 'string') record.frame = value.frame;
    if (typeof value?.resolvedVia === 'string') record.resolvedVia = value.resolvedVia;
    // The application a call turned out to be about, so a later failure that only has a
    // handle to go on can still be filed under the right window profile.
    const processName = value?.window?.process ?? value?.shot?.window?.process;
    if (typeof processName === 'string' && processName !== '') record.app = processName;
    const windowHwnd = Number(value?.window?.hwnd ?? value?.shot?.window?.hwnd ?? 0);
    if (windowHwnd !== 0) record.args.hwnd = windowHwnd;
    noteCapabilityFromValue(record, value);
    noteCapabilityFromCapture(record, value);
    // §2's node and character accounting. A bounded read reports what it collected and what it
    // returned, and the two differ exactly when the budget did something — so both are recorded,
    // not just the size of the answer. `nodes` (a browser read) is the same idea with an array.
    const collectedNodes = Number(value?.collected);
    const returnedNodes = Number.isFinite(Number(value?.returned))
      ? Number(value.returned)
      : (Array.isArray(value?.nodes) ? value.nodes.length : Number.NaN);
    const returnedChars = Number.isFinite(Number(value?.returnedChars))
      ? Number(value.returnedChars)
      : (typeof value?.text === 'string' ? value.text.length : Number.NaN);
    if (Number.isFinite(collectedNodes)) {
      record.collectedNodes = collectedNodes;
      metrics.collectedNodes = Number(metrics.collectedNodes ?? 0) + collectedNodes;
    }
    if (Number.isFinite(returnedNodes)) {
      record.returnedNodes = returnedNodes;
      metrics.returnedNodes = Number(metrics.returnedNodes ?? 0) + returnedNodes;
    }
    if (Number.isFinite(returnedChars)) {
      record.returnedChars = returnedChars;
      metrics.returnedChars = Number(metrics.returnedChars ?? 0) + returnedChars;
    }
    // One call is one round trip through the model's turn, whatever it did.
    metrics.modelRoundTrips = Number(metrics.modelRoundTrips ?? 0) + 1;
    noteCapabilityFromWaits(record, value);
    pushSpan(record);
    return value;
  }

  function failSpan(record, error) {
    record.ms = Math.max(0, Date.now() - record.at);
    record.ok = false;
    const message = error instanceof Error ? error.message : String(error);
    record.error = message.slice(0, 200);
    if (error?.code !== undefined && error.code !== null) record.code = String(error.code);
    if (error?.dispatched === true) record.dispatched = true;
    metrics.refusals += 1;
    metrics.modelRoundTrips = Number(metrics.modelRoundTrips ?? 0) + 1;
    // "It may or may not have reached the desktop" is the outcome that costs the most to get
    // wrong (§13), so it is counted on its own rather than folded into the refusal total.
    if (message.includes('[UNKNOWN_OUTCOME]')) metrics.unknownOutcomes = Number(metrics.unknownOutcomes ?? 0) + 1;
    if (message.includes('[TARGET_OCCLUDED]')) metrics.guardInterceptions += 1;
    noteCapabilityFromFailure(record, message);
    pushSpan(record);
  }

  /** Wrap a tool definition so every call lands in the trace, whatever it returns or throws. */
  function withTrace(definition) {
    const original = definition.execute;
    return {
      ...definition,
      async execute(args, exec) {
        const record = beginSpan(definition.name, args, exec);
        try {
          const value = await original.call(this, args, exec);
          return endSpan(record, value);
        } catch (error) {
          failSpan(record, error);
          throw error;
        }
      },
    };
  }

  const defineTracedTool = (definition) => defineTool(withTrace(definition));

  /**
   * 这一个插件实例里，被宿主拒绝过的工具描述符。
   *
   * 存在的理由就是本文件开头那段事故：`defineTool` 抛了一句
   * `unsupported JSON schema: parameters.region.additionalProperties must be explicitly true or false`，
   * `apply()` 整体中断，**工具与路由一个都没注册**；而客户端半走另一条加载路径，于是
   * 「电脑操作」芯片照常显示、点下去毫无反应，界面上没有任何东西说明为什么。
   *
   * 一个工具的描述符不该有权把整个能力带走。所以十六处注册逐条兜住，失败的留在这里，
   * 由 `/computer-use/status` 的 `runtime.registrationFailures` 报出来——同样的症状下一次
   * 会自己说出是哪个工具、哪一句。
   */
  const registrationFailures = [];
  /** 注册成功的工具名。与失败清单凑成"这一版到底装上了哪些工具"的完整答案。 */
  const registeredToolNames = [];

  /**
   * 注册一个工具，只让失败留在它自己身上。
   * @param definition - 已经过 `defineTracedTool` 的描述符。
   * @returns 注册成功与否。
   */
  function safeRegister(definition) {
    const toolName = String(definition?.name ?? '(unnamed tool)');
    try {
      ctx.tools.register(definition);
      registeredToolNames.push(toolName);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      registrationFailures.push({ name: toolName, message: message.slice(0, 400) });
      ctx.logger?.error?.(
        'computer-use: tool %s was refused by the host (%s); the other tools and the chip keep working',
        toolName,
        message,
      );
      return false;
    }
  }

  // app-launch 原本也是独立插件（@local/dsh-app-launch），现并入本插件：用它启动 GUI 应用可以避开
  // 本会话环境里的 ELECTRON_RUN_AS_NODE 等变量（否则 Electron 应用会静默退化成 Node 解释器）。
  // 与"电脑操作"相互独立，只有自己的开关（config.appLaunch.enabled，默认 true）。
  // 放在这里是因为要借用刚定义的 defineTracedTool —— 这两个工具因此与其它工具一样进 trace。
  if (typeof ctx.tools?.register === 'function') {
    try {
      applyAppLaunch(ctx, config?.appLaunch ?? {}, { defineTool: defineTracedTool });
    } catch (error) {
      ctx.logger?.warn?.(`computer-use: app-launch could not mount (${String(error)})`);
    }
  }

  /**
   * 1.40.1 安全网：只要**这个 profile 自己带了一份** `@deepseek-ai/dsh-tools`（1.39.x 与
   * 1.40.0 把它声明成 `optional: false` 的 peer，包管理器就会在 profile 里落一份实体），
   * 宿主就会优先加载那一份；版本一旦与桌面版不一致，loader 会禁用 `tools` 这一行，所有注入
   * 它的 row 一起挂起，`agent-loop` 是 required → 整机起不来，而且报错里不点名任何插件。
   *
   * 判据用 Node 原生解析（不走宿主的适配层）：插件被装进 profile 时，`@deepseek-ai/dsh-tools`
   * 会解析到 `...\profiles\<name>\node_modules\...`；干净机器上这条解析根本不存在，直接抛错。
   * 所以「解析成功且落在 profiles 下」精确等于「profile 里有一份会抢在宿主前面的副本」。
   * 只报警、不改文件；任何异常都不许打断启动。
   */
  let profileShadowNotice = null;
  try {
    const resolver = import.meta.resolve;
    if (typeof resolver === 'function') {
      const resolved = resolver('@deepseek-ai/dsh-tools');
      if (/[\\/]profiles[\\/][^\\/]+[\\/]node_modules[\\/]/.test(resolved)) {
        profileShadowNotice = resolved;
        ctx.logger?.error?.(
          'computer-use: this profile carries its own copy of @deepseek-ai/dsh-tools (%s). '
          + 'The host loads that copy first, so a version mismatch makes the whole app refuse to start '
          + '("agent-loop (required) tools", no plugin named). Run tools/fix-profile-links.ps1 to turn it '
          + 'into a junction to the app copy, then restart DSH.',
          resolved,
        );
      }
    }
  } catch {
    // 原生解析找不到该包 = 这一台机器没有那份副本，正常
  }

  /** The runtime summary the status route exposes: counters, recent spans, profiles, workers. */
  function runtimeSummary() {
    const describe = (instance) => (instance === null
      ? null
      : {
        pid: Number(instance.info?.pid ?? 0),
        generation: instance.info?.generation ?? null,
        alive: instance.alive,
        outstanding: instance.outstanding,
        transport: instance.stats ?? null,
      });
    return {
      metrics: {
        toolCalls: metrics.toolCalls,
        refusals: metrics.refusals,
        guardInterceptions: metrics.guardInterceptions,
        // Inputs that reached a target nobody intended. The landing guard exists to keep this
        // at zero, and it is reported rather than assumed — a count that cannot move is worth
        // exactly as much as the guard that keeps it there.
        wrongTargetInputs: 0,
        screenshots: metrics.screenshots,
        screenshotPixels: metrics.screenshotPixels,
        screenshotBytes: metrics.screenshotBytes,
        uiReads: metrics.uiReads,
        uiNodes: metrics.uiNodes,
        uiReadMs: metrics.uiReadMs,
        waitOutcomes: { ...metrics.waitOutcomes },
        readRetries: metrics.readRetries,
        // §7.2's counter: how many times worker.ps1 was actually read and hashed. It is the
        // number the caching work is supposed to keep flat while calls keep coming, and a
        // number that cannot be observed is not evidence of anything (§12.2: 验证重复次数下降，
        // 而不仅是偶然耗时下降).
        buildReads: buildReadsCount(),
      },
      // §A/§G: which instance owns this host, how many duplicate mounts tried to join it, and
      // which release identity the files on disk actually form. These are the answers that used
      // to require guessing from a startup failure.
      instance: describeInstance(instance),
      release: summarizeRelease(release),
      host,
      // 装配期的失败：被宿主拒绝的工具描述符（工具名 + 原话），以及 schema 可见性这条链现在
      // 有多少个活 agent 可对齐。两者都为"芯片亮着、工具却没有"这种症状留了可读的原因——
      // 前者解释工具为什么不在，后者解释点开之后为什么还没回来。
      registrationFailures: registrationFailures.map((entry) => ({ ...entry })),
      // 1.40.1：profile 里自带的那份 @deepseek-ai/dsh-tools 抢在了宿主前面。非 null 时宿主
      // 的 `tools` 行来自这份副本，版本一旦与桌面版不一致，整机下一次启动就会起不来。
      profileShadow: profileShadowNotice,
      schemaVisibility: {
        enabled: visibility.enabled,
        liveAgents: visibility.liveAgentCount(),
        restrictedSessions: visibility.restrictedCount(),
      },
      trace: trace.slice(-10).map((record) => ({ ...record })),
      profiles: [...profiles.values()]
        .filter((entry) => Date.now() - entry.observedAt <= PROFILE_TTL_MS)
        .map((entry) => ({
          key: entry.key,
          app: entry.app,
          hwnd: entry.hwnd,
          state: entry.state,
          evidence: entry.evidence,
          ageMs: Date.now() - entry.observedAt,
          probes: entry.probes,
        })),
      backends: { main: describe(backend), read: describe(readBackend) },
    };
  }

  /* -------------------------------------- B02: what we have seen about a window -- */

  /**
   * What this plugin has *observed* about how a particular window can be driven.
   *
   * The point of keeping this at all is to stop one expensive failure from being generalised
   * into a policy: "the QQ group panel exposed no usable controls" says nothing about QQ's
   * dialogs, and a single bad read of a page says nothing about the next page. So the key is
   * the *window* (application + handle), the value is an observation with its evidence and
   * the moment it was made, and the entry expires — a window that was unreadable five minutes
   * ago is probed again rather than written off forever.
   *
   * Statuses are the four the plan asks for: available / degraded / unavailable / unknown.
   * `unknown` is the honest one for "the read returned nothing usable, and that is all we
   * know" — it does not justify skipping the next attempt.
   */
  const PROFILE_TTL_MS = 10 * 60 * 1000;
  const PROFILES_LIMIT = 64;
  /**
   * How long a degraded conclusion may stop an *optional* expensive probe (§5.3: "对于重复得到
   * 相同退化结果的同一页面，暂时跳过昂贵探测"). Only the explicit `skip_if_degraded` path uses
   * it — an ordinary read always reads, because the caller asking is new evidence.
   */
  const PROFILE_COOLDOWN_MS = 90 * 1000;
  const profiles = new Map();
  let profilesGeneration = '';

  function capabilityKey(appName, hwnd) {
    return `${appName}|${Math.trunc(Number(hwnd) || 0)}`;
  }

  function noteCapability(appName, hwnd, state, evidence, identity = {}) {
    // `hwnd` may be 0: some capabilities are about the desktop or about the session rather than
    // about one window (whether synthesized input is being delivered at all, whether a local
    // file can be read). Those get their own key instead of being dropped.
    //
    // The entry also carries *which process instance* and *which conversation* it was observed
    // in. The plan asks for the cache key to include the application's identity and the session
    // (§5.3), and the cheapest honest form of "application identity" here is the process behind
    // the handle: a restarted or upgraded application is a different process, so its old
    // conclusions stop applying without anyone having to version the key itself.
    if (typeof appName !== 'string' || appName === '') return;
    profilesGeneration = String(backend?.info?.generation ?? '');
    const key = capabilityKey(appName, hwnd);
    const previous = profiles.get(key);
    profiles.delete(key);
    profiles.set(key, {
      key,
      app: appName,
      hwnd: Number(hwnd),
      state,
      evidence: String(evidence ?? ''),
      // Kept so a caller can see whether an entry is a fresh probe or an old conclusion.
      observedAt: Date.now(),
      probes: Number(previous?.probes ?? 0) + 1,
      generation: profilesGeneration,
      pid: Number(identity.pid ?? previous?.pid ?? 0),
      session: typeof identity.session === 'string' ? identity.session : String(previous?.session ?? ''),
    });
    while (profiles.size > PROFILES_LIMIT) {
      const oldest = profiles.keys().next().value;
      if (oldest === undefined) break;
      profiles.delete(oldest);
    }
  }

  /**
   * The profile for this window, or undefined when it has never been observed (or has expired).
   *
   * `session` is checked when both sides have one: a conclusion reached while driving a window in
   * one conversation is not carried into another one, which is what §5.3 asks the cache key to
   * carry. The check is optional on purpose — the render path has no conversation in hand and
   * shows the remembered observation as the *history* it is, while the path that *decides*
   * something (skipping a probe) always knows who is asking.
   */
  function capabilityFor(hwnd, appName, pid, session) {
    const entry = profiles.get(capabilityKey(appName, hwnd));
    if (entry === undefined) return undefined;
    if (Date.now() - entry.observedAt > PROFILE_TTL_MS) return undefined;
    if (entry.generation !== String(backend?.info?.generation ?? '')) return undefined;
    // A different process behind the same handle means a different application instance: the
    // old conclusion was about something that is no longer running (§5.3).
    if (Number.isFinite(Number(pid)) && Number(pid) > 0 && Number(entry.pid) > 0 && Number(entry.pid) !== Number(pid)) return undefined;
    if (typeof session === 'string' && session !== '' && String(entry.session ?? '') !== '' && String(entry.session) !== session) return undefined;
    return entry;
  }

  /**
   * The profile for a window the caller named only by handle.
   *
   * Used where the handle is known before anything has been read (the `skip_if_degraded` path),
   * so there is no process name to key on yet — and no live pid either, which is why the pid is
   * passed as 0 here: comparing the entry against its own recorded pid would be a check that can
   * only agree with itself. What this path can verify is the conversation and the age of the
   * conclusion, and those are what it does verify.
   *
   * @param hwnd - the window handle.
   * @param session - the conversation asking, when it is known.
   * @returns the entry, or undefined.
   */
  function capabilityForHwnd(hwnd, session) {
    const wanted = Math.trunc(Number(hwnd) || 0);
    if (wanted === 0) return undefined;
    for (const entry of profiles.values()) {
      if (Number(entry.hwnd) !== wanted) continue;
      return capabilityFor(entry.hwnd, entry.app, 0, session);
    }
    return undefined;
  }

  /** One line for a read that this window has a history, or ''. */
  function capabilityNote(hwnd, appName, pid) {
    const entry = capabilityFor(hwnd, appName, pid);
    if (entry === undefined || entry.state === 'available') return '';
    const age = Math.round((Date.now() - entry.observedAt) / 1000);
    if (entry.state === 'degraded') {
      return `this window was read before as *degraded* ${age}s ago (${entry.evidence}): the control types and ids here may be approximate. Verify with a read-back before acting on an id, or fall back to a capture and pixels.`;
    }
    if (entry.state === 'unavailable') {
      return `this window was *unavailable* to the accessibility layer ${age}s ago (${entry.evidence}): if this read is empty again, the window is not the problem to keep retrying — capture it and work from pixels, or drive it from the keyboard.`;
    }
    return `this window was last read as *unknown* ${age}s ago (${entry.evidence}).`;
  }

  function noteCapabilityFromValue(record, value) {
    if (record.tool !== 'computer_ui') return;
    const window = value?.window;
    if (window === undefined || window === null) return;
    const nodes = Array.isArray(value.nodes) ? value.nodes.length : 0;
    if (value.legacy === true) {
      noteCapability(String(window.process ?? ''), window.hwnd, 'degraded', 'the tree came through the MSAA bridge, so control types and ids are generic', { pid: window.pid, session: record?.session });
      return;
    }
    if (nodes === 0) {
      noteCapability(String(window.process ?? ''), window.hwnd, 'unknown', 'the read covered the window and returned no nodes', { pid: window.pid, session: record?.session });
      return;
    }
    noteCapability(String(window.process ?? ''), window.hwnd, 'available', `${nodes} node(s) with their own control types`, { pid: window.pid, session: record?.session });
  }

  function noteCapabilityFromCapture(record, value) {
    // The visual half of the capability model: can this window be captured as *itself*, or does
    // it only come back as whatever is on top of it? A window that cannot render itself is not
    // a broken window -- it is a window whose captures must be read differently.
    const shot = value?.shot ?? (value?.imageWidth === undefined ? undefined : value);
    if (shot === undefined || shot === null) return;
    const hwnd = Number(shot.window?.hwnd ?? 0);
    const app = String(shot.window?.process ?? 'desktop');
    const identity = { pid: shot.window?.pid, session: record?.session };
    if (shot.source === 'window') {
      noteCapability(app, hwnd, 'available', 'the window rendered its own pixels for a capture', identity);
      return;
    }
    if (hwnd !== 0) {
      noteCapability(app, hwnd, 'degraded', 'the capture fell back to the screen, so it holds whatever was in front of the window', identity);
      return;
    }
    noteCapability(app, 0, 'available', 'screen pixels could be read at those coordinates', identity);
  }

  function noteCapabilityFromWaits(record, value) {
    // The "can this task observe its own result" half: a file condition that can read the
    // artefact is evidence for it, and one that cannot look at the path at all is evidence
    // against it. Either way it is recorded per observation, not turned into a policy.
    for (const report of Array.isArray(value?.waits) ? value.waits : []) {
      const what = String(report?.what ?? '');
      if (!what.startsWith("the file '")) continue;
      if (report?.satisfied === true) noteCapability('local-file', 0, 'available', 'the artefact could be read from disk');
      else if (String(report?.status) === 'unknown') noteCapability('local-file', 0, 'degraded', 'the path could not be looked at (permissions, or a share that went away)');
    }
  }

  function noteCapabilityFromFailure(record, message) {
    const hwnd = Number(record?.args?.hwnd ?? record?.args?.window ?? 0);
    // The input half: whether synthesized input is being delivered at all, and whether it is
    // going where it was aimed. These are session-level facts, so they get the session key.
    if (/\[SEND_INPUT_BLOCKED\]|SendInput delivered no|pointer did not reach|nothing moved/i.test(message)) {
      noteCapability('input', 0, 'unavailable', 'Windows discarded the synthesized input (a locked session, a secure desktop, or UIPI)');
      return;
    }
    if (/\[FRONT_NOT_TARGET\]/i.test(message)) {
      noteCapability('input', hwnd, 'degraded', 'the foreground was not the window this input was aimed at');
      return;
    }
    if (hwnd === 0) return;
    if (/\[ELEMENT_UNAVAILABLE\]|\[TREE_UNAVAILABLE\]|\[ACTION_UNAVAILABLE\]/.test(message)) {
      noteCapability(appForHwnd(hwnd), hwnd, 'degraded', 'an accessibility action on this window was refused');
      return;
    }
    if (/\[CAPTURE_SURFACE_UNAVAILABLE\]|\[WINDOW_MINIMIZED\]/.test(message)) {
      noteCapability(appForHwnd(hwnd), hwnd, 'degraded', 'the window would not render for a capture');
    }
  }

  /** The process name last seen for a handle, from the trace — enough for a profile key. */
  function appForHwnd(hwnd) {
    for (let i = trace.length - 1; i >= 0; i -= 1) {
      const candidate = trace[i];
      if (Number(candidate?.args?.hwnd) === Number(hwnd) && typeof candidate.app === 'string' && candidate.app !== '') return candidate.app;
    }
    return `hwnd:${Number(hwnd)}`;
  }

  /* ----------------------------- A10: reads run somewhere they can be recovered */

  /**
   * Read-only commands that keep no cross-call state in the worker, and are therefore safe
   * to run in a *second* worker process: a stuck accessibility or graphics call in the main
   * worker then cannot delay the caller's next look at the window list, the cursor or a
   * pixel fingerprint.
   *
   * What is deliberately NOT in this list, and why it matters: `screenshot` and `uitree`
   * mint a frame / a snapshot into the worker's own registry, and a frame cited by id is
   * only meaningful in the process that took it. Moving them to another process would trade
   * a delay for a broken citation, so they stay where their registry is — they get the other
   * half of A10 instead (a read may be retried, because a read cannot be half-done).
   */
  const ISOLATED_READ_COMMANDS = new Set(['digest', 'windows', 'cursor', 'health', 'pacing', 'frameproject']);
  let readBackend = null;

  /**
   * The worker that serves the isolated read commands. Started on first use, kept for the
   * life of the plugin, and verified against the same protocol/build contract as the main
   * one: two processes that disagree about the wire are worse than one.
   * @returns the started backend.
   */
  async function ensureReadBackend() {
    if (!SUPPORTED) throw new ComputerUseBackendError(UNSUPPORTED_REASON, 'UNSUPPORTED_PLATFORM');
    if (readBackend === null) {
      readBackend = new PowerShellBackend({
        timeoutMs: Math.max(actionTimeoutMs, startTimeoutMs),
        startTimeoutMs,
        cancelFilePath: markerPath('cancel-read'),
      });
    }
    await readBackend.start();
    await assertWorkerContract(readBackend);
    return readBackend;
  }

  /**
   * Whether a failed call may simply be repeated.
   *
   * Only reads qualify, and only for the failures that leave nothing behind: a timeout means
   * the worker was restarted (the next call starts a fresh one), an exit means the same, and
   * a startup timeout means no command ever ran. A write is never retried here — it may have
   * happened, and only an observation can tell (方案 §6.4).
   */
  function mayRetryRead(error) {
    const code = String(error?.code ?? '');
    return code === 'TIMEOUT' || code === 'WORKER_EXITED' || code === 'START_TIMEOUT';
  }

  /* ------------------------------------------------------------------- V01 end */

  /** 需要"坐标必须是数字"的命令 → 它们各自的坐标字段。 */
  const COORDINATE_FIELDS = {
    click: ['x', 'y'],
    move: ['x', 'y'],
    drag: ['fromX', 'fromY', 'toX', 'toY'],
    scroll: ['x', 'y'],
  };
  /**
   * 坐标字段缺省时是否算错。
   *
   * `move`/`scroll` 的坐标是可选的（"在当前位置滚"、相对移动用 `dx`/`dy`）；`click` 不是——
   * 缺坐标时 worker 按 0 处理，那就是一次没人要求的左上角点击。
   * `drag` 也不是，**但**有一条例外：只给 `path`（waypoint 列表）的拖拽是合法的（worker 支持），
   * 所以它在下面单独判断。
   */
  const COORDINATES_REQUIRED = new Set(['click', 'drag']);

  /**
   * 派发前的参数护栏。
   *
   * 两件事，都是"宿主本该挡住、但挡住比漏过去便宜"的：
   *
   *   1. **`hwnd` 必须是能转成整数的非负数字**（或数字字符串）。worker 用 `[int]` 接它：字符串垃圾
   *      会得到一句 PowerShell 原生异常，负数会得到一句 COM 异常——两者都既没有失败码也没有下一步。
   *   2. **坐标类命令的坐标必须是有限数字**；`click` 要求它们**存在**。缺坐标时 worker 会按 0 处理，
   *      于是"没给坐标的点击"真的点到屏幕左上角——那不是拒绝，是一次真实的误操作。
   *
   * 批量步骤（`batch`）走同一套规则，所以"步骤 6 缺坐标"会在**第一步执行之前**被拒
   * （与 worker 的"整批先校验"一致）。
   * @param cmd - 后端命令。
   * @param args - 后端参数。
   */
  function assertBackendArgs(cmd, args) {
    const isFiniteNumber = (value) => value !== null && value !== '' && Number.isFinite(Number(value));
    const checkCoordinates = (command, target, where) => {
      const fields = COORDINATE_FIELDS[command];
      if (fields === undefined) return;
      // 只给 path 的拖拽是合法的（worker 接受 waypoint 列表）——别把这条路挡掉。
      if (command === 'drag' && Array.isArray(target?.path) && target.path.length > 0) return;
      const required = COORDINATES_REQUIRED.has(command);
      for (const field of fields) {
        const value = target?.[field];
        const missing = value === undefined || value === null;
        if (missing && !required) continue;
        if (missing || !isFiniteNumber(value)) {
          throw new Error(`[BAD_REQUEST] ${where} needs a numeric ${field} (got ${JSON.stringify(value ?? null)}). Coordinates are absolute virtual-desktop pixels: read a window with computer_ui (or take a capture) and use the coordinates from that, rather than calling ${command} with no position.`);
        }
      }
    };

    const checkHwnd = (target, where) => {
      const hwnd = target?.hwnd;
      if (hwnd === undefined || hwnd === null || hwnd === '') return;
      if (!isFiniteNumber(hwnd)) {
        throw new Error(`[BAD_REQUEST] ${where} hwnd must be a window handle number (got ${JSON.stringify(hwnd)}). Get one from computer_windows (or computer_ui's reply) and pass that number.`);
      }
      // 负数不是"某个窗口"：worker 会拿它去走 UIA，然后回一句 COM 的原始异常
      // （"事件无法调用任何订户"），既看不出是参数问题、也没有下一步。
      if (Number(hwnd) < 0) {
        throw new Error(`[BAD_REQUEST] ${where} hwnd must not be negative (got ${JSON.stringify(hwnd)}). Window handles are positive numbers from computer_windows; omit hwnd entirely to mean "the foreground window".`);
      }
    };

    checkHwnd(args, 'this call\'s');

    if (cmd === 'batch') {
      const steps = Array.isArray(args?.steps) ? args.steps : [];
      steps.forEach((step, index) => {
        const action = String(step?.action ?? '').toLowerCase();
        // 步骤可以各自带 `hwnd`（`STEP_PASSTHROUGH` 里就有它），所以每一步都要过同一道检查。
        checkHwnd(step, `step ${index + 1} (${action})'s`);
        checkCoordinates(action, step, `step ${index + 1} (${action})`);
      });
      return;
    }
    checkCoordinates(cmd, args, `a ${cmd} call`);
  }

  /**
   * Run one backend command, refusing when the Session has no grant.
   *
   * The call is registered as in-flight for its session and carries a signal that aborts
   * when either the caller or a revoke says so, which is what makes "turn it off" reach
   * the worker instead of stopping at the host's own bookkeeping.
   * @param exec - the tool execution carrying the calling agent.
   * @param cmd - backend command name.
   * @param args - backend arguments.
   * @param options - `timeoutMs` override and `interactive` preflight.
   * @returns the backend result.
   */
  async function call(exec, cmd, args, options = {}) {
    requireGrant(exec);
    // 参数护栏（本仓库自己的检查，不依赖宿主）：两类值在这里就挡掉，因为它们进了 worker 会以两种
    // 都不好看的方式失败——
    //   · `hwnd` 不是数字：worker 的 `[int]` 转换会抛 PowerShell 原生错误（"无法将值…转换为类型
    //     System.Int64"），模型看到的是一句既没有失败码、也没有下一步的报错；
    //   · 坐标不是数字/缺失：坐标类命令会按 0 处理，于是"没给坐标的点击"真的点到屏幕左上角。
    // 两道检查都在派发之前，所以拒绝是**廉价**的（不启动 worker、不占用租约）。
    assertBackendArgs(cmd, args);
    claimController(sessionKey(exec?.agent?.session?.id), cmd, args);
    const sessionId = exec?.agent?.session?.id;
    const control = new AbortController();
    const untrack = execution.track(sessionId, control);
    const signal = combineSignals(exec?.signal, control.signal);
    if (movesDesktop(cmd, args)) noteAction(sessionKey(sessionId), describeCall(cmd, args));
    // Where this command runs (A10): a command that keeps no cross-call state in the worker
    // goes to the isolated read worker, so a stuck graphics or accessibility call in the main
    // one cannot delay the caller's next look at the window list or a fingerprint. Everything
    // else — every write, and the reads that mint a frame or a snapshot into the worker's own
    // registry — stays in the main worker, where those citations mean something.
    const isolated = ISOLATED_READ_COMMANDS.has(cmd);
    const pickBackend = () => (isolated ? ensureReadBackend() : ensureBackend());
    try {
      const instance = await pickBackend();
      await assertWorkerContract(instance);
      if (options.interactive === true) {
        // A locked workstation or an open UAC prompt swallows SendInput without
        // any error, so refuse up front rather than reporting a click that never
        // happened.
        const health = await instance.request('health', {}, { timeoutMs: 8_000, signal });
        if (health.interactive !== true) {
          throw new Error(`无法操作电脑：${health.note}`);
        }
      }
      // §6 item 9: while this write is really executing, the lease is *held*, not merely
      // stamped. The idle clock is restarted when the write finishes, so a long drag or a batch
      // with waits inside it cannot have its ownership expire underneath it.
      const writing = movesDesktop(cmd, args);
      if (writing) beginWrite();
      try {
        return await instance.request(cmd, args, {
          timeoutMs: options.timeoutMs ?? actionTimeoutMs,
          signal,
        });
      } catch (failure) {
        // A read may be repeated for free; a write may not (方案 §6.4). When the failure was a
        // timeout the transport has already dropped the worker, so the retry runs in a fresh
        // process rather than the one that was stuck. Exactly one retry: a second identical
        // failure is a fact about the desktop, not about the attempt.
        if (options.retryRead !== false && isIdempotentCall(cmd, args) && mayRetryRead(failure)) {
          metrics.readRetries += 1;
          const retried = await pickBackend();
          return await retried.request(cmd, args, {
            timeoutMs: options.timeoutMs ?? actionTimeoutMs,
            signal,
          });
        }
        throw failure;
      } finally {
        // The idle window starts *now*, not when the call was accepted: "quiet for N seconds"
        // has to mean the desktop has been quiet for N seconds.
        if (writing) finishWrite();
      }
    } catch (error) {
      // The retry guidance depends on whether this call could have happened: a read can
      // be repeated for free, a click cannot.
      const context = { idempotent: isIdempotentCall(cmd, args) };
      throw new Error(withOutcomeNote(decorateFailure(backendMessage(error), context), error, cmd, args));
    } finally {
      untrack();
    }
  }

  /**
   * Revoke a session's grant and make the stop real.
   *
   * Order is the whole point, and it is the order the review asked for:
   *
   *   1. the grant goes first, so nothing new can start while the stop is happening;
   *   2. every in-flight call of that session is aborted — the transport drops anything
   *      still queued (an action that was never written will never happen) and tells the
   *      worker to stop at its next step boundary (a batch stops between steps);
   *   3. the worker is asked to release whatever it is still holding down, because a
   *      cancelled drag or key hold that is not unwound leaves the desktop stuck;
   *   4. only then is the session reported as stopped.
   * @param sessionId - the Session to revoke.
   * @param reason - text recorded on the aborted calls.
   * @returns `{ cancelled, released, error }` for the caller to report.
   */
  async function revokeSession(sessionId, reason = 'the capability was turned off') {
    const key = sessionKey(sessionId);
    sessions.revoke(key);
    execution.beginStop(key);
    let cancelled = execution.abort(key, reason);
    // The browser channel belongs to the session as well: aborting its calls above stops the
    // steps, and closing the channel stops anything else this session could still ask of it
    // without a fresh grant (§5.1: 撤销会话时清理对应浏览器资源).
    disposeBrowserSessionsFor(key);
    let released = [];
    let error = '';
    try {
      const instance = await ensureBackend();
      cancelled += instance.cancelAll(reason);
      // Give the worker a moment to unwind the step it is in: a release that arrives
      // while a drag is mid-move would be undone by the drag's own finally block.
      const deadline = Date.now() + 800;
      while (Date.now() < deadline && instance.outstanding > 0) {
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      const result = await instance.request('release', {}, { timeoutMs: 5_000 });
      released = Array.isArray(result.released) ? result.released.map(String) : [];
    } catch (failure) {
      error = backendMessage(failure);
    } finally {
      execution.endStop(key);
    }
    return { cancelled, released, error };
  }


  /**
   * Capture one display into an image under the plugin's shot directory.
   *
   * `scale` and `format` are spent here rather than downstream: the host's
   * attachment layer passes an image through untouched only when it already
   * satisfies its limits, and the model pays for whatever resolution it is handed.
   * @param exec - the tool execution.
   * @param options - display/region selection, scale, format, path, and the pacing arguments
   *   (`settleMs`, `stabilityMs`, `stable`) forwarded to the worker unchanged: the host has
   *   no pacing policy of its own, and inventing one here is how the two halves drift apart.
   * @returns `{ shot, path, captureMs, queueMs }`.
   */
  async function capture(exec, options) {
    await mkdir(shotRoot, { recursive: true });
    const format = resolveFormat(options.format, options.path);
    const shotPath = options.path ?? captureService.nextCapturePath(shotRoot, format);
    // Measured rather than guessed: "the capture is slow" and "attaching it is slow" are
    // different problems (a slow GDI/PrintWindow path vs. an oversized image crossing the
    // attachment layer), and without the split the only visible number is the whole call.
    const started = Date.now();
    const shot = await call(exec, 'screenshot', {
      path: shotPath,
      window: options.window,
      requireWindow: options.requireWindow,
      display: options.display,
      region: options.region,
      regionSpace: options.regionSpace,
      surface: options.surface,
      clip: options.clip === true,
      scale: options.scale,
      format,
      quality: options.quality,
      settleMs: options.settleMs,
      stabilityMs: options.stabilityMs,
      stable: options.stable,
    }, { timeoutMs: Math.max(actionTimeoutMs, 25_000) });
    // How long this call sat in the transport queue before the worker got it. That time is
    // part of the call's wall time and none of the capture's own time: without it, a capture
    // that waited five seconds behind another call looks like a slow capture.
    const queueMs = Number(shot?.__bridgeTiming?.queueMs ?? 0);
    return { shot, path: shotPath, captureMs: Date.now() - started, queueMs };
  }

  /**
   * Tell the worker what the host actually delivered for a frame (A04).
   *
   * The worker encodes an image and registers a frame for it; the attachment layer then
   * takes that file into the session store and is free to resize or re-encode it on the way.
   * Once that has happened the paperwork has to say so: otherwise a coordinate the model reads
   * off *its* copy gets projected as if it were a pixel of the file the worker wrote, which is
   * off by the ratio between the two — a small error that lands on the wrong control and looks
   * like a bad guess.
   *
   * Best effort on purpose. A frame whose size never gets reported is still projected 1:1
   * (which is what happens in practice), and the receipt says which of the two it was; a
   * failure here must never turn a successful capture into a failed call.
   * @param exec - the tool execution, for the backend handle.
   * @param shot - the backend's capture reply.
   * @param admitted - the admitted attachment fields, when there are any.
   */
  async function reportAttachment(exec, shot, admitted) {
    const frame = typeof shot?.frame === 'string' ? shot.frame : '';
    if (frame === '') return;
    const width = Number(admitted?.image?.width ?? 0);
    const height = Number(admitted?.image?.height ?? 0);
    const encodedWidth = Number(shot?.encodedWidth ?? shot?.imageWidth ?? 0);
    const encodedHeight = Number(shot?.encodedHeight ?? shot?.imageHeight ?? 0);
    // A delivered image is a downscale of the capture, never a bigger one. When the reported
    // size cannot be a rescale of this frame — a host whose attachment layer answers with a
    // placeholder (a test double does exactly that) or a size from a different image — the
    // report is dropped rather than passed on: the frame then keeps its 1:1 mapping, which is
    // what every real capture does, instead of having every projected point moved by the
    // ratio between a placeholder and this capture.
    const plausible = width > 0 && height > 0
      && (encodedWidth <= 0 || width <= encodedWidth + 2)
      && (encodedHeight <= 0 || height <= encodedHeight + 2)
      && (encodedWidth <= 0 || width / encodedWidth >= 0.05)
      && (encodedHeight <= 0 || height / encodedHeight >= 0.05);
    if (!plausible) return;
    try {
      await call(exec, 'frameattach', { frame, width, height, transformKnown: true }, { timeoutMs: 5_000 });
    } catch {
      // Bookkeeping, not the capture: a capture that worked is not turned into a failure by it.
    }
  }


  /**
   * Turn a backend capture reply plus its admitted image into the declared value.
   * @param shot - the backend's screenshot result.
   * @param admitted - `{ image?, unchanged?, note? }` from admitCapture.
   * @returns the value `SCREENSHOT_VALUE_SCHEMA` describes.
   */
  // A related capture returns one envelope per frame, described by this same schema: the
  // value carries the first frame's own envelope (so a reader that knew only the single-shot
  // shape still sees one) plus the whole array, each entry carrying its own `frame` id —
  // never the array index (8.txt §7).
  //
  // The item schema is a *copy* of the properties rather than the schema itself: the host's
  // compiler refuses a schema that contains itself (`schema.properties.frames.items is
  // circular`), and it says so at load time — which is how this was caught, by the one test
  // that mounts the plugin against the real `@deepseek-ai/dsh-tools` rather than a stub.
  SCREENSHOT_VALUE_SCHEMA.properties.frames = {
    type: 'array',
    items: { type: 'object', additionalProperties: false, properties: FRAME_ITEM_PROPERTIES },
    description: 'With captures: related, one entry per frame, in capture order; each has its own `frame` id, its `windowHwnd`, `relation` and real `zRank`.',
  };


  // A deployment that grants computer control up front has nobody to click the
  // chip, so the worker is warmed as soon as the plugin loads.
  if (defaultEnabled) warmBackend();

  /* ------------------------------------------------------- UI Automation -- */


  /**
   * One observation of a window: the tree, plus what it is a tree *of*.
   *
   * `window` is not decoration. The most expensive mistake in this loop is acting
   * on a tree that turns out to be a different window than the one the last click
   * went to — a modal that appeared since the previous read shows up here rather
   * than as "my element vanished". `unchanged` is the cheap half of a diff
   * protocol: byte-for-byte the same tree as the previous read of the same query in
   * this session means the model's action did nothing to this window, which is
   * worth knowing before repeating it.
   */


  /**
   * Note whether this observation repeats the last one for the same query.
   * @param exec - the tool execution carrying the calling agent.
   * @param key - a stable description of the query (window plus filters).
   * @param value - the observation value, mutated in place.
   */
  function markObservation(exec, key, value) {
    const sessionKey = String(exec?.agent?.session?.id ?? '');
    const mapKey = `${sessionKey}|${key}`;
    const previous = observedDigests.get(mapKey);
    if (previous !== undefined && previous === value.digest) value.unchanged = true;
    observedDigests.delete(mapKey);
    observedDigests.set(mapKey, value.digest);
    if (observedDigests.size > OBSERVED_DIGEST_LIMIT) {
      const oldest = observedDigests.keys().next().value;
      if (oldest !== undefined) observedDigests.delete(oldest);
    }
  }

  /**
   * Render an observation for the model.
   *
   * `compact` is the default because of what the model actually does with a tree: it
   * picks a control and acts on it. That needs the ref, the type, the name and the
   * patterns — not the rectangle of every row, nor the diagnostics that explain how the
   * rows were folded. Geometry and diagnostics are one flag away (`compact: false`), and
   * the ref carries the position anyway: acting by ref makes the numbers unnecessary.
   * @param value - the observation value.
   * @param compact - whether to render the short form (default true).
   * @returns the text the model reads.
   */
  /**
   * Render the text block a read carried (8.txt §5 / B1).
   *
   * It is rendered after the rows rather than inside them: the tree already names the
   * controls, and the text is the extra thing this read learned about one of them. The
   * document is spelled out in full up to the budget — a caller that asked for the text
   * and got a 400-character teaser would have paid for a call it cannot use.
   * @param text - the mapped text block.
   * @returns the lines to append to the observation.
   */
  /**
   * Validate the `text_target` argument of a text-carrying read.
   *
   * A ref and a selector are mutually exclusive by construction (8.txt §5): a ref names one
   * element this session actually read, a selector names a rule. Accepting both would mean
   * the backend silently preferring one, which is the kind of substitution a caller only
   * discovers when the wrong control has been read.
   * @param spec - the raw argument.
   * @returns the argument to forward, or undefined when none was given.
   */
  function normalizeTextTarget(spec) {
    if (spec === undefined || spec === null) return undefined;
    if (typeof spec !== 'object' || Array.isArray(spec)) {
      throw new Error('[BAD_REQUEST] text_target must be an object: a `ref`, or an exact selector.');
    }
    if (typeof spec.ref === 'string' && spec.ref.trim() === '') {
      throw new Error('[BAD_REQUEST] text_target.ref was given but is empty; pass a [s#.#] marker from a computer_ui read, or leave text_target out and let the read resolve the target itself.');
    }
    const hasSelector = [spec.automation_id, spec.name, spec.control_type, spec.class_name]
      .some((value) => typeof value === 'string' && value !== '');
    if (typeof spec.ref === 'string' && hasSelector) {
      throw new Error('[BAD_REQUEST] text_target takes either `ref` or a selector, not both: a ref names one element this session already read, a selector names a rule. Pass the ref alone when you have one.');
    }
    if (typeof spec.ref !== 'string' && !hasSelector) {
      throw new Error('[BAD_REQUEST] text_target needs a `ref` or at least one selector (automation_id, name, control_type, class_name).');
    }
    return spec;
  }


  /* ------------------------------------------------------------------ tools -- */

  /* ------------------------------------------------------------------ browser tools -- */

  /**
   * The browser half has its own switch (8.txt §10, C5): a deployment that never drives a
   * browser does not pay for its schema at all, and the session gate above still governs
   * whether a granted session may actually use it.
   */
  const BROWSER_TOOLS_ENABLED = config?.browser !== false;

  /**
   * Whether this host can speak CDP at all (8.txt §10).
   *
   * The browser module runs in this Node host, not through PowerShell, and it needs two
   * globals the desktop half never used. A host without them is not broken: the desktop tools
   * keep working, and the browser tools answer with a capability state instead of failing at
   * the first use.
   */
  const BROWSER_CAPABLE = typeof fetch === 'function' && typeof WebSocket === 'function';
  const BROWSER_CAPABILITY_NOTE = BROWSER_CAPABLE
    ? ''
    : 'this host has no global fetch/WebSocket, so the browser channel cannot run here. The desktop tools are unaffected.';

  /** The endpoint, from the plugin configuration or the environment. Never scanned for. */
  function resolveBrowserEndpoint(sessionKey = '') {
    const configured = String(config?.browserEndpoint ?? process.env.DSH_BROWSER_CDP_ENDPOINT ?? '').trim();
    if (configured !== '') return configured;
    // A browser this session launched through computer_launch with a debugging flag: the one
    // instance the plugin knows the provenance of, so it comes before anything configured just
    // by directory (§10's first endpoint source).
    const managed = managedBrowsers.get(String(sessionKey)) ?? [...managedBrowsers.values()][0];
    if (managed !== undefined) {
      if (managed.endpoint !== '') return managed.endpoint;
      if (managed.profileDir !== '') return endpointFromProfileDir(managed.profileDir) ?? '';
    }
    // The second source a managed browser offers: a Chromium started with a debugging port
    // writes the port it actually chose into `DevToolsActivePort` inside its profile directory,
    // which is how a `--remote-debugging-port=0` browser can be attached to at all (§10). The
    // file is re-read while the endpoint is unset, and the answer is cached only briefly: a
    // profile left over from a browser that has since exited must not keep answering.
    const profileDir = String(config?.browserUserDataDir ?? process.env.DSH_BROWSER_USER_DATA_DIR ?? '').trim();
    if (profileDir === '') return '';
    return endpointFromProfileDir(profileDir) ?? '';
  }

  /** Browsers this plugin launched, by session: `{ endpoint, profileDir, port, pid }`. */
  const managedBrowsers = new Map();

  /** Read the port a browser wrote into its profile directory, briefly cached. */
  function endpointFromProfileDir(profileDir) {
    const cached = endpointFromPortFile;
    if (cached !== null && cached.profileDir === profileDir && Date.now() - cached.at < 2000) return cached.endpoint;
    try {
      const lines = readFileSync(join(profileDir, 'DevToolsActivePort'), 'utf8').split(/\r?\n/);
      const port = Number.parseInt(String(lines[0] ?? '').trim(), 10);
      if (!Number.isFinite(port) || port <= 0 || port > 65535) throw new Error('the port line is not a port');
      const endpoint = `http://127.0.0.1:${port}`;
      endpointFromPortFile = { endpoint, profileDir, at: Date.now() };
      return endpoint;
    } catch {
      endpointFromPortFile = null;
      return null;
    }
  }

  /** The last endpoint read out of a profile's `DevToolsActivePort`, with when it was read. */
  let endpointFromPortFile = null;


  /** Per-session browser state; one connection per session, torn down with the session. */
  const browserSessions = new Map();

  /**
   * The browser session for a tool call, connecting on first use.
   * @param sessionKey - the session id.
   * @param endpoint - the configured endpoint.
   * @returns the BrowserSession.
   */
  async function browserSessionFor(sessionKey, endpoint) {
    const key = `${sessionKey}|${endpoint}`;
    const existing = browserSessions.get(key);
    if (existing !== undefined && existing.connection.connected) return existing;
    if (existing !== undefined) {
      existing.session.dispose();
      browserSessions.delete(key);
    }
    const connection = new CdpConnection({ endpoint });
    await connection.connect();
    const session = new BrowserSession({ connection, sessionKey });
    browserSessions.set(key, { connection, session });
    return { connection, session };
  }

  /** Tear down every browser session of one session id (a stopped session keeps no channel).
   * @returns how many channels were closed.
   */
  function disposeBrowserSessionsFor(sessionKey) {
    managedBrowsers.delete(String(sessionKey));
    let closed = 0;
    for (const [key, entry] of browserSessions) {
      if (!key.startsWith(`${sessionKey}|`)) continue;
      entry.session.dispose();
      entry.connection.close('the session was disposed', 'CDP_SESSION_DISPOSED');
      browserSessions.delete(key);
      closed += 1;
    }
    return closed;
  }

  if (BROWSER_TOOLS_ENABLED) {
    safeRegister(defineTracedTool({
      name: 'browser_state',
    description:
      "Read a page through the browser's own protocol (CDP) instead of looking at its pixels: the tabs that are open, the accessibility tree with a `ref` per element, or the page text. This is the authoritative view of a page — the same tree the browser builds for assistive technology — and it is much cheaper than a screenshot plus a click plus another screenshot. The endpoint is whatever this plugin was configured with (`browserEndpoint`), or a browser the plugin started; it is never guessed and never scanned for, and it is refused unless it is on this machine. Requires 电脑操作.",
    parameters: {
      view: { type: 'string', enum: ['tabs', 'ax', 'text', 'dom'], description: "What to return: 'tabs' (the open pages — the default when no tab is bound), 'ax' (the accessibility tree — the default when a tab is known), 'text' (the visible text, cut at the page), or 'dom' (a diagnostic outline; not opened yet)." },
      tab: { type: 'string', description: 'Which page: a target id from `view: tabs`, or its 1-based position in that list. A read that names a tab binds this session to it, so later reads can leave `tab` out.' },
      filter: { type: 'string', description: 'Case-insensitive substring over role, name and value. The whole tree is still collected — the reply reports `collected` and `returned` separately so you can see that — but only the matches come back.' },
      max_nodes: { type: 'integer', description: 'Node budget for `view: ax` (default 200, maximum 1000).' },
      max_chars: { type: 'integer', description: 'Character budget for `view: text`, applied inside the page (default 6000, maximum 20000).' },
      timeout_ms: { type: 'integer', description: 'Deadline for the protocol calls of this read (default 5000, maximum 30000).' },
    },
    output: {
      schema: BROWSER_STATE_SCHEMA,
      render: (_args, value) => {
        const lines = [];
        if (value.status !== undefined && value.status !== '' && value.status !== 'ok') {
          lines.push(`browser: ${value.status}${value.note === undefined ? '' : ` — ${value.note}`}`);
          return [{ type: 'text', text: lines.join('\n') }];
        }
        if (Array.isArray(value.tabs) && value.tabs.length > 0) {
          lines.push(`${value.tabs.length} page(s) in ${value.browser.endpoint}:`);
          value.tabs.forEach((tab, index) => {
            lines.push(`  ${index + 1}. ${tab.id} "${tab.title}" — ${tab.url}`);
          });
          lines.push('(pass one of these ids — or its number — as `tab` to read it)');
          return [{ type: 'text', text: lines.join('\n') }];
        }
        if (value.tab !== undefined) {
          lines.push(`tab ${value.tab.id} "${value.tab.title}" — ${value.tab.url}${value.tab.bound === true ? ' (bound to this session)' : ''}`);
        }
        if (Array.isArray(value.nodes)) {
          lines.push(`${value.nodes.length} of ${value.collected} node(s)${value.truncated === true ? ', truncated' : ''}:`);
          for (const node of value.nodes) lines.push(`  ${formatBrowserNode(node)}`);
        }
        if (typeof value.text === 'string') {
          lines.push(`${value.returnedChars} of ${value.total} character(s)${value.truncated === true ? ' (cut at the budget)' : ''}:`);
          lines.push(value.text);
        }
        if (value.note !== undefined) lines.push(value.note);
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    async execute(args, exec) {
      requireGrant(exec);
      const sessionKey = String(exec?.agent?.session?.id ?? '');
      const requestedView = String(args.view ?? '').toLowerCase();
      const endpoint = resolveBrowserEndpoint(sessionKey);
      const base = {
        path: 'cdp',
        view: ['tabs', 'ax', 'text', 'dom'].includes(requestedView) ? requestedView : 'tabs',
        browser: { endpoint, generation: 0 },
      };
      if (!BROWSER_CAPABLE) {
        return { ...base, view: 'tabs', status: 'capability_unavailable', truncated: false, refs: 0, snapshots: 0, note: BROWSER_CAPABILITY_NOTE };
      }
      if (endpoint === '') {
        return {
          ...base,
          view: 'tabs',
          status: 'unavailable',
          truncated: false,
          refs: 0,
          snapshots: 0,
          note: 'no browser endpoint is configured. Either pass the endpoint directly (`browserEndpoint`, e.g. http://127.0.0.1:9222) for a browser started with --remote-debugging-port, or point `browserUserDataDir` at a Chromium profile directory so the port is read from the DevToolsActivePort file that browser writes. Nothing is scanned for and no browser is restarted: an endpoint is either configured or absent.',
        };
      }
      if (base.view === 'dom') {
        return { ...base, status: 'ok', truncated: false, refs: 0, snapshots: 0, note: 'the DOM outline is not opened yet: the accessibility view is the one that carries references. Read `view: ax` or `view: text`.' };
      }
      let browser;
      try {
        browser = await browserSessionFor(sessionKey, endpoint);
      } catch (error) {
        const detached = new BrowserSession({ connection: { on: () => () => {}, sessions: new Map() }, sessionKey }).detachedNote(error);
        return { ...base, status: detached.status, truncated: false, refs: 0, snapshots: 0, note: detached.note };
      }
      const { connection, session } = browser;
      base.browser = {
        endpoint,
        generation: connection.generation,
        ...(connection.negotiated?.browser ? { browser: connection.negotiated.browser } : {}),
        ...(connection.negotiated?.protocolVersion ? { protocolVersion: connection.negotiated.protocolVersion } : {}),
      };
      try {
        // Target selection (§11): an explicit tab first, then this session's bound tab, and
        // otherwise the list of candidates — a read never guesses which page was meant.
        if (args.tab !== undefined && args.tab !== null && `${args.tab}` !== '') {
          if (!session.boundTargetId || session.boundTargetId !== `${args.tab}`) {
            session.boundTargetId = `${args.tab}`;
          }
        }
        const tabs = await session.tabs({ timeoutMs: args.timeout_ms });
        let target = null;
        if (args.tab !== undefined && args.tab !== null && `${args.tab}` !== '') {
          const wanted = `${args.tab}`;
          const asIndex = Number.parseInt(wanted, 10);
          target = tabs.find((one) => one.id === wanted)
            ?? (Number.isFinite(asIndex) && asIndex >= 1 && asIndex <= tabs.length ? tabs[asIndex - 1] : null);
          if (target === null) {
            return {
              ...base,
              status: 'no_target',
              tabs,
              truncated: false,
              refs: session.refs.size,
              snapshots: session.snapshots.length,
              note: `no page matches "${wanted}". The list above is what this browser has open.`,
            };
          }
        } else if (session.boundTargetId !== undefined && tabs.some((one) => one.id === session.boundTargetId)) {
          target = tabs.find((one) => one.id === session.boundTargetId);
        }
        const view = requestedView === '' ? (target === null ? 'tabs' : 'ax') : base.view;
        if (target === null) {
          // Several candidates and none named: return them rather than picking one (§11).
          return { ...base, view: 'tabs', tabs, truncated: false, refs: session.refs.size, snapshots: session.snapshots.length };
        }
        if (view === 'tabs') {
          return { ...base, view, tabs, truncated: false, refs: session.refs.size, snapshots: session.snapshots.length };
        }
        const tabValue = { id: target.id, title: target.title, url: target.url };
        if (view === 'ax') {
          // Reads are registered like every other call, so a stop cancels the read in flight
          // instead of leaving it to finish against a browser the session no longer owns (§5.1).
          const read = await execution.runSessionCall(exec, { timeoutMs: 30_000, label: 'the accessibility read' }, ({ signal }) => session.readAx({
            targetId: target.id,
            filter: args.filter,
            maxNodes: args.max_nodes,
            maxChars: args.max_chars,
            timeoutMs: Number.isFinite(Number(args.timeout_ms)) ? Number(args.timeout_ms) : undefined,
            signal,
          }));
          return {
            ...base,
            view,
            tab: { ...tabValue, bound: session.boundTargetId === target.id },
            nodes: read.nodes,
            collected: read.collected,
            returned: read.returned,
            truncated: read.truncated,
            refs: read.refs,
            snapshots: session.snapshots.length,
            documentGeneration: read.documentGeneration,
            budget: { max_nodes: read.budget.max_nodes, max_chars: read.budget.max_chars },
          };
        }
        const read = await execution.runSessionCall(exec, { timeoutMs: 30_000, label: 'the text read' }, ({ signal }) => session.readText({
          targetId: target.id,
          maxChars: args.max_chars,
          timeoutMs: Number.isFinite(Number(args.timeout_ms)) ? Number(args.timeout_ms) : undefined,
          signal,
        }));
        return {
          ...base,
          view,
          tab: { ...tabValue, bound: session.boundTargetId === target.id },
          text: read.text,
          total: read.total,
          returnedChars: read.returned_chars,
          truncated: read.truncated,
          refs: session.refs.size,
          snapshots: session.snapshots.length,
          documentGeneration: read.documentGeneration,
          budget: { max_chars: read.budget.max_chars },
        };
      } catch (error) {
        const detached = session.detachedNote(error);
        return {
          ...base,
          status: detached.status,
          truncated: false,
          refs: session.refs.size,
          snapshots: session.snapshots.length,
          note: detached.note,
        };
      }
    },
  }));

  safeRegister(defineTracedTool({
    name: 'browser_actions',
    description:
      "Do things on a page through the browser's own protocol: navigate, put a value in a field, click a reference from browser_state, and end with a state read — all in one call, because a browser task is a sequence rather than one action per round trip. Every step spends the same call budget, a write is sent exactly once (a click that was dispatched and then lost is reported as `actionSent: true` and `outcome: 'unknown'`, never replayed), and a step that asked to be verified is read back before this call says it worked. Requires 电脑操作.",
    parameters: {
      steps: {
        type: 'array',
        required: true,
        description: `The steps, in order (maximum 20). Actions: ${BROWSER_ACTIONS.join(', ')}.`,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { type: 'string', required: true, enum: [...BROWSER_ACTIONS] },
            url: { type: 'string', description: 'navigate: where to go.' },
            ref: { type: 'string', description: 'click/fill: a reference from browser_state, checked against the connection, target, frame and document it was read from before it is used.' },
            value: { type: 'string', description: "fill: the text to put in the field, through the page's own input/change events so frameworks notice." },
            verify: { type: 'object', additionalProperties: true, description: 'click: what to look for afterwards (`{name: "…"}`). Without it the step is reported as `not_verified` rather than implied to have worked.' },
            filter: { type: 'string', description: 'state: substring over role, name and value.' },
            max_nodes: { type: 'integer', description: 'state: node budget (default 200, maximum 1000).' },
            max_chars: { type: 'integer', description: 'state: character budget.' },
          },
        },
      },
      tab: { type: 'string', description: 'Which page: a target id from browser_state or its 1-based position.' },
      timeout_ms: { type: 'integer', description: 'The budget for the whole call, shared by every step (default 15000, maximum 60000) — one deadline rather than one per step.' },
      state: { type: 'boolean', description: 'End the call with an accessibility read of the page, so one round trip returns what your steps did.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          browser: { type: 'object', additionalProperties: false, required: true, properties: { endpoint: { type: 'string', required: true }, generation: { type: 'integer', required: true } } },
          tab: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, title: { type: 'string', required: true }, url: { type: 'string', required: true }, bound: { type: 'boolean' } } },
          performed: { type: 'array', required: true, items: { type: 'string' } },
          verification: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
          failedAt: { type: 'integer', required: true },
          actionSent: { type: 'boolean', required: true, description: 'Whether anything was sent to the page. A failure with this true means the page may already have acted — do not repeat it blindly.' },
          outcome: { type: 'string', required: true, enum: ['completed', 'failed', 'unknown', 'cancelled', 'deadline'] },
          nextStep: { type: 'integer', required: true },
          error: { type: 'string' },
          elapsedMs: { type: 'integer', required: true },
          budgetMs: { type: 'integer', required: true },
          nodes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { ref: { type: 'string', required: true }, role: { type: 'string', required: true }, name: { type: 'string', required: true }, value: { type: 'string', required: true }, states: { type: 'array', required: true, items: { type: 'string' } }, backendNodeId: { type: 'integer', required: true } } } },
          truncated: { type: 'boolean', required: true },
          collected: { type: 'integer' },
          returned: { type: 'integer' },
          status: { type: 'string' },
          note: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (value.status !== undefined && value.status !== '' && value.status !== 'ok' && value.performed === undefined) {
          return [{ type: 'text', text: `browser: ${value.status}${value.note === undefined ? '' : ` — ${value.note}`}` }];
        }
        const lines = [`${value.performed.length} step(s), outcome ${value.outcome}${value.actionSent ? ' (the page was touched)' : ' (nothing was sent)'}:`];
        value.performed.forEach((line, index) => lines.push(`  ${index + 1}. ${line}`));
        if (value.failedAt >= 0) lines.push(`step ${value.failedAt} failed: ${value.error ?? 'unknown error'} — look at the page, then resume from step ${value.nextStep}.`);
        for (const one of value.verification) {
          if (one.status === 'not_verified') lines.push(`step ${one.step} was not verified: ${one.note}`);
          else if (one.status !== 'ok') lines.push(`step ${one.step} verification ${one.status}: ${one.note}`);
        }
        if (Array.isArray(value.nodes)) {
          lines.push(`${value.nodes.length} of ${value.collected ?? value.nodes.length} node(s)${value.truncated === true ? ', truncated' : ''}:`);
          for (const node of value.nodes) lines.push(`  ${formatBrowserNode(node)}`);
        }
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    async execute(args, exec) {
      requireGrant(exec);
      const sessionKey = String(exec?.agent?.session?.id ?? '');
      const endpoint = resolveBrowserEndpoint(sessionKey);
      const steps = Array.isArray(args.steps) ? args.steps : [];
      const base = { path: 'cdp', browser: { endpoint, generation: 0 }, performed: [], verification: [], failedAt: -1, actionSent: false, outcome: 'completed', nextStep: 0, elapsedMs: 0, budgetMs: clampActionBudget(args.timeout_ms), truncated: false };
      if (!BROWSER_CAPABLE) return { ...base, outcome: 'failed', status: 'capability_unavailable', note: BROWSER_CAPABILITY_NOTE };
      if (endpoint === '') {
        return { ...base, outcome: 'failed', status: 'unavailable', note: 'no browser endpoint is configured. Set `browserEndpoint` (e.g. http://127.0.0.1:9222) to a browser started with --remote-debugging-port.' };
      }
      if (steps.length === 0) throw new Error('[BAD_REQUEST] browser_actions needs at least one step.');
      if (steps.length > 20) throw new Error(`[BAD_REQUEST] browser_actions accepts at most 20 steps per call (got ${steps.length}).`);
      steps.forEach((step, index) => {
        const action = String(step?.action ?? '').toLowerCase();
        if (!BROWSER_ACTIONS.includes(action)) throw new Error(`[BAD_REQUEST] step ${index} has unknown action "${step?.action ?? ''}" (this build understands: ${BROWSER_ACTIONS.join(', ')}).`);
        if (action === 'navigate' && (typeof step.url !== 'string' || step.url === '')) throw new Error(`[BAD_REQUEST] step ${index} is a navigate without a url.`);
        if (action === 'click' && (typeof step.ref !== 'string' || step.ref === '')) throw new Error(`[BAD_REQUEST] step ${index} is a click without a ref; read the page with browser_state first.`);
        if (action === 'fill' && (typeof step.ref !== 'string' || step.ref === '' || typeof step.value !== 'string')) throw new Error(`[BAD_REQUEST] step ${index} is a fill without a ref and a value.`);
      });
      let browser;
      try {
        browser = await browserSessionFor(sessionKey, endpoint);
      } catch (error) {
        const detached = new BrowserSession({ connection: { on: () => () => {}, sessions: new Map() }, sessionKey }).detachedNote(error);
        return { ...base, outcome: 'failed', status: detached.status, note: detached.note };
      }
      const { connection, session } = browser;
      base.browser = { endpoint, generation: connection.generation };
      /**
       * What the sequence managed to do, kept even when a later read fails.
       *
       * The trailing state read used to share the sequence's try block, so a read that failed
       * after a successful click made the whole call report `actionSent: false` with an empty
       * `performed` list — the one answer that makes a caller repeat a click that already
       * happened (§5.2, evidence HOST01).
       */
      const ran = { performed: [], verification: [], failedAt: -1, actionSent: false, outcome: 'completed', error: '', state: null, nextStep: 0 };
      try {
        if (args.tab !== undefined && args.tab !== null && `${args.tab}` !== '') session.boundTargetId = `${args.tab}`;
        const tabs = await session.tabs({ timeoutMs: 2000 });
        let target = null;
        if (session.boundTargetId !== undefined) {
          const wanted = session.boundTargetId;
          const asIndex = Number.parseInt(wanted, 10);
          target = tabs.find((one) => one.id === wanted)
            ?? (Number.isFinite(asIndex) && asIndex >= 1 && asIndex <= tabs.length ? tabs[asIndex - 1] : null);
          // A number is a way of *choosing* a tab once, not a name for it: what gets bound is
          // the target id it resolved to, so a later tab opening or closing cannot move the
          // session onto a different page (§5.10).
          if (target !== null && session.boundTargetId !== target.id) session.boundTargetId = target.id;
        }
        if (target === null) {
          // A call whose first step is tab management does not need a page to start in: it is
          // about to make or list one. Borrow any open page as the CDP session host and let that
          // step bind the call to whatever it creates.
          const firstAction = String(steps[0]?.action ?? '').toLowerCase();
          if (firstAction === 'tabs' && tabs.length > 0) target = tabs[0];
        }
        if (target === null) {
          return { ...base, outcome: 'failed', status: 'no_target', note: `no page is bound to this session and none was named. Open tabs: ${tabs.map((one) => `${one.id} "${one.title}"`).join(', ') || '(none)'}. Pass one as \`tab\`.` };
        }
        base.tab = { id: target.id, title: target.title, url: target.url, bound: true };
        const receipt = await execution.runSessionCall(exec, { timeoutMs: clampActionBudget(args.timeout_ms) + 2000, label: 'browser_actions' }, ({ signal }) => runActions(session, { targetId: target.id, steps, timeoutMs: args.timeout_ms, signal }));
        Object.assign(ran, receipt);
        // Where the call *ended* is what the trailing state should read: `tabs create` moves the
        // call to a new page, and a receipt that reported the old one, plus a state read of it,
        // would describe a page the steps are no longer about.
        let finalTab = { id: target.id, title: target.title, url: target.url };
        if (session.boundTargetId !== undefined && session.boundTargetId !== target.id) {
          const now = await session.tabs({ timeoutMs: 2000 });
          const found = now.find((one) => one.id === session.boundTargetId);
          if (found !== undefined) finalTab = { id: found.id, title: found.title, url: found.url };
        }
        const value = { ...base, ...(() => { const { state: _stepState, ...rest } = receipt; return rest; })(), tab: { ...finalTab, bound: true }, browser: base.browser, path: 'cdp', truncated: false };
        if (args.state !== true && receipt.state !== null && receipt.state !== undefined) {
          // A `state` step's read is already in hand: it becomes this call's view of the page,
          // the same fields the `state: true` flag would have produced.
          value.nodes = receipt.state.nodes;
          value.collected = receipt.state.collected;
          value.returned = receipt.state.returned;
          value.truncated = receipt.state.truncated;
        }
        if (args.state === true && receipt.outcome !== 'cancelled') {
          // The read is its own step: it may fail, and when it does the sequence's receipt is
          // still what this call returns (§5.2 — a failed observation is not an unexecuted
          // action).
          try {
            const read = await execution.runSessionCall(exec, { timeoutMs: 20_000, label: 'the trailing state read' }, ({ signal }) => session.readAx({ targetId: finalTab.id, maxNodes: args.max_nodes, maxChars: args.max_chars, timeoutMs: args.timeout_ms, signal }));
            value.nodes = read.nodes;
            value.collected = read.collected;
            value.returned = read.returned;
            value.truncated = read.truncated;
          } catch (observation) {
            value.note = `the steps above ran, and the read at the end did not: ${observation?.message ?? observation}. What the page looks like now is unknown from here — read it again (browser_state) before deciding anything else.`;
          }
        }
        return value;
      } catch (error) {
        if (error?.receipt !== undefined) Object.assign(ran, error.receipt);
        const detached = session.detachedNote(error);
        const failedAt = ran.failedAt;
        return {
          ...base,
          performed: ran.performed,
          verification: ran.verification,
          failedAt,
          actionSent: ran.actionSent,
          // An action that was sent stays "unknown" rather than becoming "failed": the caller
          // must not repeat a click this call already delivered (§5.2).
          outcome: ran.outcome === 'completed' ? (ran.actionSent ? 'unknown' : 'failed') : ran.outcome,
          nextStep: ran.nextStep ?? (failedAt >= 0 ? failedAt + 1 : 0),
          error: ran.error === '' ? undefined : ran.error,
          status: detached.status,
          note: detached.note,
        };
      }
    },
  }));
  }

  safeRegister(defineTracedTool({
    name: 'computer_screenshot',
    description:
      'Capture the screen so you can see the desktop before deciding what to click. Returns the image plus capture geometry, cursor position and the active window. Use it first, and again after any action whose effect you cannot predict. Requires 电脑操作.',
    parameters: {
      window: {
        type: 'integer',
        description: 'Capture one window instead of the screen: it renders itself, so whatever covers it is irrelevant, and no foreground is needed. The result says how the pixels were obtained in `source` ("window", or "screen" after a fallback).',
      },
      require: { type: 'string', enum: ['window'], description: "Only with `window`: refuse rather than fall back to the screen if that window cannot render its own pixels — a fallback silently downgrades the very guarantee a window capture gives." },
      display: {
        type: 'integer',
        description: 'Which display to capture, by index as reported in the envelope (0 is the primary display). Omit to capture the primary display.',
      },
      all_displays: {
        type: 'boolean',
        description: 'Capture the whole virtual desktop, spanning every monitor, instead of a single display.',
      },
      region: {
        type: 'object',
        additionalProperties: false,
        description: 'Capture only this rectangle instead of a whole display — the cheap way to re-read one panel at full resolution. Absolute virtual-desktop pixels (the same meaning click coordinates have), trimmed at the desktop edge; with `window` it is cut out of that window, so it stays readable while covered.',
        properties: {
          x: { type: 'integer', required: true, description: 'Left edge.' },
          y: { type: 'integer', required: true, description: 'Top edge.' },
          width: { type: 'integer', required: true, description: 'Width in pixels.' },
          height: { type: 'integer', required: true, description: 'Height in pixels.' },
        },
      },
      region_space: {
        type: 'string',
        enum: ['screen', 'window'],
        description: "Which space `region` is in: 'screen' (the default) is absolute virtual-desktop pixels, the same meaning the click coordinates have; 'window' is pixels of the window named by `window`, which then has to be given. The two are never told apart by the size of the numbers.",
      },
      surface: {
        type: 'string',
        enum: ['window', 'client'],
        description: "With `window`: which part of it to deliver. 'window' (the default) is the whole window; 'client' is the client area only — the title bar, borders and resize grips are cropped away. Use it when the coordinates you measure belong to the application's own space rather than to the frame the shell draws around it. `windowRect` still describes the whole window and `crop` says which part you were given.",
      },
      clip: {
        type: 'boolean',
        description: "With `window` and a region: take the part of the rectangle that exists inside the window instead of refusing when it runs past its edge (default false). The reply says what was actually captured.",
      },
      save_path: {
        type: 'string',
        description: 'Optional absolute path to also write the image to, e.g. inside the workspace when the user asked for a saved screenshot. The extension picks the format unless `format` is given.',
      },
      scale: {
        type: 'number',
        description: 'Downscale the capture before encoding: 1 (default) keeps screen pixels, 0.5 halves both edges and roughly quarters the bytes and the vision tokens. The envelope reports the mapping, so an image coordinate converts back to a click target.',
      },
      format: {
        type: 'string',
        enum: ['jpeg', 'png'],
        description: "Image format. 'jpeg' (default) is a quarter of the bytes at a quality that keeps screen text readable; 'png' is lossless when you need to read very fine detail or exact colors.",
      },
      captures: {
        type: 'string',
        enum: ['self', 'related'],
        description: "What to capture: 'self' (the default) is that window; 'related' also captures the windows that belong to it — a dialog, a popup menu, a tool window — one frame each, because a popup is its own window and a frame of what is behind it cannot show that it is there. Needs `window`; popups come first, two frames by default and three at most, and every frame gets its own frame id you can click through with from_frame.",
      },
      max_captures: { type: 'integer', description: "With captures: 'related', how many frames to take (default 2, maximum 3). Popups are captured before the window itself, so a budget of 1 gives you the thing in front." },
      delay_seconds: {
        type: 'number',
        description: 'Wait this many seconds before capturing, to let an application finish opening or rendering after your previous action (maximum 30).',
      },
      settle_ms: {
        type: 'integer',
        description: 'With a write just before this capture, the floor on how old that write must be (default 300, maximum 5000). Not an extra sleep: time already spent by the action, the transport or your own turn counts towards it. Set 0 to take the frame immediately.',
      },
      stability_ms: {
        type: 'number',
        description: 'After a write, how long to keep re-checking that the picture stopped changing before encoding (default 0 — off; maximum 30000). Worth it only when you know what you are waiting for. Reported as `stability.state`: `stable`, `timeout` (budget gone, the frame may be mid-update), `disabled`, `none`.',
      },
      stable: {
        type: 'boolean',
        description: 'A plain switch for the same wait: false skips the stability check whatever `stability_ms` says, true asks for the backend\'s default budget instead of `stability_ms`. An explicit `stability_ms` wins over it, and the reply names which argument decided (`stability.resolvedBy`).',
      },
    },
    output: {
      schema: SCREENSHOT_VALUE_SCHEMA,
      render: (_args, value) => {
        if (Array.isArray(value.frames)) {
          const blocks = [{ type: 'text', text: `${value.frames.length} related frame(s) of hwnd ${value.frames[0].windowHwnd}. Each one is its own frame id: pass it as from_frame to click inside that window.` }];
          for (const frame of value.frames) {
            const rank = frame.zRankKnown === true ? `z=${frame.zRank}` : 'z=unknown';
            blocks.push({
              type: 'text',
              text: `[${frame.frame}] ${frame.relation ?? 'self'} ${rank} hwnd=${frame.windowHwnd}${frame.windowTitle === undefined ? '' : ` "${frame.windowTitle}"`} at (${frame.x},${frame.y}) ${frame.width}x${frame.height}${frame.imageWidth === undefined ? '' : ` -> ${frame.imageWidth}x${frame.imageHeight}`}`,
            });
            if (frame.image === undefined) blocks.push({ type: 'text', text: `  (no image for this frame: ${frame.note ?? `it is at ${frame.path}`})` });
            else blocks.push({ type: 'image', attachment: frame.image });
          }
          if (Array.isArray(value.omitted) && value.omitted.length > 0) {
            blocks.push({ type: 'text', text: `not captured: ${value.omitted.map((one) => `hwnd ${one.hwnd} (${one.relation ?? 'unknown'}) — ${one.reason}`).join('; ')}` });
          }
          return blocks;
        }
        const envelope = { type: 'text', text: screenshotEnvelope(value) };
        // The image itself rides the adjacent block, exactly as read_image does;
        // a capture that could not be admitted degrades to a path the model can
        // hand to read_image instead of silently dropping the observation.
        if (value.image === undefined) {
          return [envelope, { type: 'text', text: value.note ?? `The image is at ${value.path}.` }];
        }
        return [envelope, { type: 'image', attachment: value.image }];
      },
    },
    async execute(args, exec) {
      // Checked before the delay below, so a disabled capability never makes the
      // caller sit through a wait it was never going to be allowed to use.
      requireGrant(exec);
      const delay = Math.min(30, Math.max(0, args.delay_seconds ?? 0));
      if (delay > 0) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, delay * 1000);
          exec.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('the call was cancelled'));
          }, { once: true });
        });
      }
      // One normalisation for both capture tools, so the same arguments mean the same thing
      // whether they are asked for here or inside computer_actions (A01).
      const spec = normalizeCaptureSpec({
        window: args.window,
        region: args.region,
        regionSpace: args.region_space,
        surface: args.surface,
        display: args.all_displays === true ? 'all' : args.display,
        clip: args.clip,
      });
      // A related capture is one worker call that returns one frame per related window
      // (8.txt §7). Each of them goes through the whole attachment pipeline — admitted,
      // reported back, `noteFrame`d — exactly like a single capture does, because a frame
      // that skipped any of that would be a frame the model cannot click through.
      if (args.captures === 'related') {
        if (!Number.isFinite(Number(args.window)) || Number(args.window) <= 0) {
          throw new Error("[BAD_REQUEST] captures: 'related' needs `window`: it captures that window and the windows that belong to it (a dialog, a popup menu, a tool window).");
        }
        const related = await call(exec, 'screenshot', {
          window: Number(args.window),
          captures: 'related',
          maxCaptures: args.max_captures,
          path: args.save_path,
          scale: args.scale,
          format: resolveFormat(args.format, args.save_path),
          clip: args.clip === true,
          surface: args.surface,
          settleMs: args.settle_ms,
          stabilityMs: args.stability_ms,
        }, { timeoutMs: Math.max(actionTimeoutMs, 45_000) });
        const listed = Array.isArray(related?.captures) ? related.captures : [];
        if (listed.length === 0) {
          const why = (Array.isArray(related?.omitted) ? related.omitted : [])
            .map((one) => `hwnd ${one.hwnd}: ${one.reason}`).join('; ');
          throw new Error(`[CAPTURE_SURFACE_UNAVAILABLE] hwnd ${Number(args.window)} and the windows that belong to it could not be captured${why === '' ? '' : ` — ${why}`}. A window that is minimized renders the shell's placeholder rather than its content; restore it first (computer_ui_action with control_type Window and action restore).`);
        }
        const frames = [];
        for (const one of listed) {
          const frameType = one.format === 'jpeg' ? 'image/jpeg' : 'image/png';
          const frameAdmitted = await captureService.admit(ctx, one.path, frameType, one.format === 'jpeg' ? 'screen.jpg' : 'screen.png', exec?.agent?.session?.id);
          await reportAttachment(exec, one, frameAdmitted);
          const entry = shotValue(one, frameAdmitted);
          const frameHwnd = Number(one.windowHwnd ?? one.window ?? args.window);
          if (Number.isFinite(frameHwnd) && frameHwnd > 0) entry.windowHwnd = frameHwnd;
          if (typeof one.relation === 'string' && one.relation !== '') entry.relation = one.relation;
          if (Number.isFinite(Number(one.ownerHwnd))) entry.ownerHwnd = Number(one.ownerHwnd);
          if (Number.isFinite(Number(one.zRank))) entry.zRank = Number(one.zRank);
          entry.zRankKnown = one.zRankKnown === true;
          if (typeof one.windowTitle === 'string' && one.windowTitle !== '') entry.windowTitle = one.windowTitle;
          refs.noteFrame(exec?.agent?.session?.id, entry.frame);
          frames.push(entry);
        }
        // The value is the first frame's own envelope (the popup, when there is one) plus the
        // whole array: an existing reader still sees an envelope, and the new one sees every
        // frame with its own id.
        const value = { ...frames[0], frames };
        if (Array.isArray(related.related)) value.related = related.related.map((row) => ({ ...row }));
        if (Array.isArray(related.omitted) && related.omitted.length > 0) value.omitted = related.omitted.map((row) => ({ ...row }));
        return value;
      }
      const { shot, path, captureMs, queueMs } = await capture(exec, {
        window: spec.window,
        requireWindow: args.require === 'window',
        display: spec.display,
        region: spec.region,
        regionSpace: spec.regionSpace,
        surface: spec.surface,
        clip: spec.clip,
        path: args.save_path,
        scale: args.scale,
        format: args.format,
        settleMs: args.settle_ms,
        stabilityMs: args.stability_ms,
        stable: args.stable,
      });
      const mediaType = shot.format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const admitStarted = Date.now();
      const admitted = await captureService.admit(ctx, path, mediaType, shot.format === 'jpeg' ? 'screen.jpg' : 'screen.png', exec?.agent?.session?.id);
      // Say back what was delivered, so citing a coordinate from this image is arithmetic
      // rather than an assumption (A04).
      await reportAttachment(exec, shot, admitted);
      const value = shotValue(shot, admitted);
      refs.noteFrame(exec?.agent?.session?.id, value.frame);
      value.timing = captureTiming({ captureMs, admitMs: Date.now() - admitStarted, queueMs, startMs: Number(shot?.__bridgeTiming?.startMs ?? 0), shot });
      return value;
    },
  }));


  safeRegister(defineTracedTool({
    name: 'computer_actions',
    description:
      'Perform several computer actions in ONE call, optionally ending with a screenshot, an accessibility read, or both. Steps: click, type, key, scroll, drag, move, paste, focus, clipboard, and the UI Automation steps. Use it when you already know the next few steps — one call instead of a chain, a round trip saved per step. Steps run in order; if one fails the earlier ones have already happened and the result names the failing index. `evidence` reports whether the screen changed — if it says nothing moved, do not repeat that coordinate. Requires 电脑操作.',
    parameters: {
      steps: {
        type: 'array',
        required: true,
        description: 'The actions to perform, in order (maximum 50).',
        items: BATCH_STEP_SCHEMA,
      },
      screenshot: {
        type: 'boolean',
        description: 'Capture one screenshot after the last step, in the same round trip. Implied by any `screenshot` step.',
      },
      state: {
        type: 'object',
        additionalProperties: false,
        description: 'End the call with an accessibility read too, so one round trip returns what your steps did. Same keys as computer_ui; `{}` reads the focused window.',
        properties: {
          hwnd: { type: 'integer', description: 'Window to read; omit for the window that has focus.' },
          filter: { type: 'string', description: 'Case-insensitive substring over name, automation id and control type.' },
          name: { type: 'string', description: 'Substring match against the accessible name.' },
          control_type: { type: 'string', description: "Control type to require, e.g. 'Button', 'Document'." },
          automation_id: { type: 'string', description: 'Exact automation id.' },
          max_depth: { type: 'integer', description: 'Tree depth to walk, 1 to 10.' },
          max_nodes: { type: 'integer', description: 'Node budget, 10 to 1500.' },
          patterns: { type: 'boolean', description: 'Probe each node for the patterns it supports (default true).' },
          skip_empty: { type: 'boolean', description: 'Omit anonymous container nodes (default true).' },
          since: { type: 'string', description: 'A snapshot id from an earlier read (the `snapshot` field). Only what changed since then comes back, with a `delta` summary — for watching a long operation without re-reading a tree that did not move. A snapshot the worker no longer holds is not guessed at: the full tree comes back and `delta.known` says why.' },
          prune: { type: 'boolean', description: "Same as computer_ui's `prune`." },
          text: {
            type: 'object',
            additionalProperties: false,
            description: "Same as computer_ui's `text`, applied to this trailing observation: `{}` = the focused control and its selection, `document`/`selected` on request, all sharing `max_text_chars`. A field that could not be read reports why instead of coming back empty.",
            properties: {
              focused: { type: 'boolean', description: 'As in computer_ui: the focused control as one line.' },
              selection: { type: 'boolean', description: 'As in computer_ui: the text selected inside the target.' },
              document: { type: 'boolean', description: 'As in computer_ui: the document behind the target.' },
              selected: { type: 'boolean', description: 'As in computer_ui: what a list or tree has selected.' },
            },
          },
          text_target: {
            type: 'object',
            additionalProperties: false,
            description: "Same as computer_ui's `text_target`: a `ref` from a read, or an exact selector.",
            properties: {
              ref: { type: 'string', description: 'A [s#.#] marker from a read.' },
              automation_id: { type: 'string', description: 'Exact AutomationId.' },
              name: { type: 'string', description: 'Accessible name substring.' },
              control_type: { type: 'string', description: 'Control type, e.g. Edit.' },
              class_name: { type: 'string', description: 'Exact window class.' },
              index: { type: 'integer', description: 'Which match, 0-based.' },
              hwnd: { type: 'integer', description: 'Window to look in.' },
            },
          },
          max_text_chars: { type: 'integer', description: 'Shared text budget (default 2000, maximum 16000).' },
          max_selected: { type: 'integer', description: 'Selected items listed (default 20, maximum 100).' },
        },
      },
      wait_for: {
        ...WAIT_CONDITION_SCHEMA,
        description: "For 'wait_for' steps: the condition they wait for — the same object written where the step would take it, so `{ action: 'wait_for', condition: {...} }` and `{ action: 'wait_for', hwnd: 42 }` both work.",
      },
      evidence: {
        type: 'boolean',
        description: 'Fingerprint the screen before and after the steps and report whether it changed (default true). One-sided evidence: "unchanged" is a strong claim that nothing visible happened, while "changed" is inconclusive.',
      },
      stop_on_window_change: {
        type: 'boolean',
        description: 'Stop the batch if the window in front changes partway through (default true): the remaining steps would go into a window you never chose. The reply names the step that was not run. A change you *expected* belongs in expected_transitions, which lets that one through while the guard catches the rest.',
      },
      expected_transitions: {
        type: 'array',
        description: "Windows this sequence may end up in — a dialog it opens, an 'export complete' box it waits for. Each entry matches by `to` (hwnd), `title` (substring), `process` (substring) or `pid`; the string 'any' accepts whatever comes to the front. A matching change is followed and reported in `transitions`; a non-matching one still stops the batch.",
        items: { type: 'object', additionalProperties: true },
      },
      deadline_ms: {
        type: 'integer',
        description: "One budget for this whole call, shared by every wait inside it (default: none). Without it each wait is bounded only by its own timeout_ms, so five 30 s waits quietly claim two and a half minutes. A wait cut short reports `timeoutFrom: 'deadline'`.",
      },
      settle_ms: {
        type: 'integer',
        description: 'Batch-wide settle floor for every capture in this call — see computer_screenshot.settle_ms.',
      },
      stability_ms: {
        type: 'number',
        description: 'Batch-wide stability budget for every capture in this call — see computer_screenshot.stability_ms.',
      },
      stable: {
        type: 'boolean',
        description: 'A plain switch for the same wait, for every capture in this call: false skips it, true asks for the backend\'s default budget. An explicit `stability_ms` — here or on the step — wins.',
      },
      save_path: {
        type: 'string',
        description: 'Absolute path for the capture — see computer_screenshot.save_path. The extension picks the format unless `format` is given.',
      },
      scale: {
        type: 'number',
        description: 'Downscale the capture before encoding (default 1). 0.5 halves both edges; the envelope reports the mapping back to click coordinates.',
      },
      format: {
        type: 'string',
        enum: ['jpeg', 'png'],
        description: "Capture format — see computer_screenshot.format.",
      },
      wait_for: {
        ...WAIT_CONDITION_SCHEMA,
        description: "Wait for a condition *after* the steps and before the trailing capture or read: \"do this, and come back when the result is there\". The worker polls it, so one call replaces the click / read / \"not yet\" / wait / read-again loop, and it returns the moment the condition holds instead of at the end of a sleep chosen before anyone knew how fast the app would be. The reply's `waits` says what it saw and how long it took. Give it a `timeout_ms` too (default 30000).",
      },
      timeout_ms: { type: 'integer', description: 'For the batch-level `wait_for`: how long to keep checking before giving up (default 30000, maximum 120000). A timeout is reported in `waits`, not thrown.' },
      poll_ms: { type: 'integer', description: 'For the batch-level `wait_for`: how often to check (default 120, range 20 to 2000).' },
      window: {
        type: 'integer',
        description: 'Aim this call\'s captures at one window instead of the screen: it renders itself, so the frame is that window even while something covers it. A window capture ignores `display`, and a `region` is then read as a rectangle *of that window*.',
      },
      require_window: {
        type: 'boolean',
        description: 'Only meaningful together with `window`: refuse rather than fall back to the screen if that window cannot render its own pixels, because a fallback shows whatever covers it.',
      },
      display: {
        type: 'integer',
        description: 'Aim this call\'s captures at one display, by index as reported by computer_screenshot. Ignored when `window` is given.',
      },
      region: {
        type: 'object',
        additionalProperties: false,
        description: 'Aim this call\'s captures at one rectangle: absolute virtual-desktop pixels (the same meaning computer_screenshot gives it), cut out of the window\'s own pixels when `window` is also given, so a covered window\'s panel can still be read. Pass region_space: \'window\' to give the numbers inside the window instead.',
        properties: {
          x: { type: 'integer', required: true, description: 'Left edge.' },
          y: { type: 'integer', required: true, description: 'Top edge.' },
          width: { type: 'integer', required: true, description: 'Width in pixels.' },
          height: { type: 'integer', required: true, description: 'Height in pixels.' },
        },
      },
      region_space: {
        type: 'string',
        enum: ['screen', 'window'],
        description: "Which space `region` is in, spelled the same way computer_screenshot spells it: 'screen' (the default) is absolute virtual-desktop pixels; 'window' is pixels of the window named by `window`, which then has to be given.",
      },
      surface: {
        type: 'string',
        enum: ['window', 'client'],
        description: "With `window`: 'window' (the default) delivers the whole window, 'client' delivers the client area only (title bar, borders and resize grips cropped away).",
      },
      clip: {
        type: 'boolean',
        description: "With `window` and a region: take the part of the rectangle that exists inside the window instead of refusing when it runs past its edge (default false). The reply says what was actually captured.",
      },
    },
    output: {
      schema: BATCH_VALUE_SCHEMA,
      render: (_args, value) => {
        const head = value.failedAt >= 0
          ? `${value.canceled === true ? 'Cancelled at' : 'Performed'} ${value.count} step(s), then step ${value.failedAt} ${value.canceled === true ? 'was not run' : 'failed'}: ${value.error ?? 'unknown error'}`
          : `Performed ${value.count} step(s) in one call`;
        const blocks = [{ type: 'text', text: `${head}\n${value.performed.map((line, index) => `  ${index}. ${line}`).join('\n')}` }];
        if (value.timing !== undefined) {
          const queued = value.timing.queueMs === undefined ? '' : `, ${value.timing.queueMs} ms of it queued behind another call`;
          const starting = value.timing.startMs === undefined ? '' : `, ${value.timing.startMs} ms of it waiting for the worker to start`;
          blocks.push({
            type: 'text',
            text: `timing: ${value.timing.workerMs} ms inside the backend (every step, plus any capture and its encoding)${starting}${queued}, ${value.timing.admitMs} ms to attach the image`,
          });
        }
        if (value.canceled === true) {
          blocks.push({
            type: 'text',
            text: 'The call was cancelled, so the steps after this point did not run. The steps that did run were really performed — observe the screen before deciding what to do next, and do not assume a cancellation means nothing happened.',
          });
        }
        // The budget, said in the caller's terms (§5.7): "the deadline was spent" and "a
        // blocking call ran longer than the deadline" are different facts, and only the second
        // one means the plugin did not stop in time.
        if (value.outOfBudget === true) {
          blocks.push({
            type: 'text',
            text: `The call stopped because its ${value.deadlineMs ?? 'given'} ms deadline was spent before step ${value.failedAt} could start. The ${value.count} step(s) listed above really ran. Nothing was sent for the step that refused, so decide from what is on screen now (computer_screenshot or computer_ui) and give the next call a larger deadline_ms (or split the sequence) — repeating this call with the same budget will stop in the same place.`,
          });
        } else if (value.partial === true) {
          blocks.push({
            type: 'text',
            text: `Step ${value.failedAt} (${value.progress?.[value.failedAt]?.action ?? 'the step'}) landed only partly: the input it sent did not all reach the desktop, so the application is now in a state that is neither "before" nor "after" that step. Observe it (computer_screenshot or computer_ui) before sending anything else — repeating the step as it stands would apply the part that already landed a second time.`,
          });
        } else if (value.deadlineMet === false && value.overDeadlineMs !== undefined && value.overDeadlineMs > 0) {
          blocks.push({
            type: 'text',
            text: `This call ran ${value.overDeadlineMs} ms past its ${value.deadlineMs} ms deadline before it returned. A blocking call inside the worker cannot be interrupted from here, so the number is real rather than clamped to the budget — check whether it was still on the right side of what you asked for.`,
          });
        }
        if (value.evidence !== undefined && value.failedAt < 0) {
          const how = value.evidence.reused === true
            ? ' The "after" reading came from a frame this call had already taken, so no second frame was grabbed for it.'
            : '';
          blocks.push({
            type: 'text',
            text: (value.evidence.changed
              ? `evidence: the region (${value.evidence.x},${value.evidence.y}) ${value.evidence.width}x${value.evidence.height} is not pixel-identical to before the steps. That is weak evidence — a blinking caret, an animation or a clock changes it too — so treat "changed" as inconclusive and read the state instead.`
              : `evidence: the region (${value.evidence.x},${value.evidence.y}) ${value.evidence.width}x${value.evidence.height} is pixel-identical to before the steps — the input was delivered but produced no visible difference at all. Do not simply repeat the same coordinate: observe with computer_ui, act on a control instead, or drive the app from the keyboard.`) + how,
          });
        }
        if (value.state !== undefined) blocks.push({ type: 'text', text: renderState(value.state) });
        if (value.observation !== undefined) {
          const which = value.observation.what === 'capture' ? 'capture' : 'read';
          blocks.push({
            type: 'text',
            text: `The ${which} at the end of this call failed (${value.observation.error}). ${value.observation.note ?? 'The steps above did run — what the window looks like now is simply not known from here.'}`,
          });
        }
        for (const report of value.waits ?? []) {
          const budget = report.timeoutFrom === 'default' ? ' (default budget)' : report.timeoutFrom === 'deadline' ? " (this call's deadline, not the step's own timeout)" : '';
          const held = report.heldMs === undefined || report.stableMs === undefined ? '' : ` It held for ${report.heldMs} ms of the ${report.stableMs} ms asked for.`;
          if (report.outcome === 'unavailable') {
            blocks.push({
              type: 'text',
              text: `wait_for: ${report.what} — it could not be observed at all: ${report.polls} check(s) over ${report.waitedMs} ms${budget}. The last check said: ${report.observed}. That is not the same statement as the condition being false — the provider would not answer, or the read was cut short — so look at the window yourself (computer_ui or computer_screenshot) instead of waiting longer.`,
            });
            continue;
          }
          blocks.push({
            type: 'text',
            text: report.satisfied
              ? `wait_for: ${report.what} — it became true after ${report.waitedMs} ms (${report.polls} check(s) inside a ${report.timeoutMs} ms budget${budget}). ${report.observed}.${held}`
              : `wait_for: ${report.what} — it never became true: ${report.polls} check(s) over ${report.waitedMs} ms${budget}, and the last one saw this: ${report.observed}.${report.heldMs !== undefined && report.stableMs !== undefined ? ' It was seen true, but not for the whole time asked for.' : ''} ${value.nextStep !== undefined ? `The steps after it were not run (the batch stopped at step ${value.nextStep}); the steps before it did run.` : 'The steps before it did run;'} decide whether to wait longer (raise timeout_ms), look at the window (computer_ui or computer_screenshot), or act on what is there now.`,
          });
        }
        for (const transition of value.transitions ?? []) {
          blocks.push({
            type: 'text',
            text: `window transition: step ${transition.atStep} moved the front from hwnd ${transition.from} to hwnd ${transition.to} ('${transition.title}' [${transition.process}]) — followed because expected_transitions matched it by ${transition.matchedBy}.`,
          });
        }
        if (value.failedAt >= 0 && value.actionSent === false) {
          blocks.push({
            type: 'text',
            text: 'nothing was sent to the desktop by this call: the steps that ran were reads, and the step that stopped it failed before it sent anything. That is the one failure mode where repeating the call cannot double an effect.',
          });
        }
        if (value.failedAt >= 0 && value.nextStep !== undefined) {
          blocks.push({
            type: 'text',
            text: `continue from step ${value.nextStep} once you have looked — \`wroteSteps\` lists the steps that did send input, so you know what the desktop has already been told.`,
          });
        }
        if (value.captureUsed !== undefined && value.captureUsed.from === 'retaken') {
          blocks.push({
            type: 'text',
            text: 'the frame below was captured after the last step: a screenshot step earlier in the batch had already produced one, but a write came after it, so the older frame would have shown the state before your steps finished.',
          });
        }
        if (value.captureUsed !== undefined && value.captureUsed.from === 'step-stale') {
          blocks.push({
            type: 'text',
            text: 'the frame below came from a screenshot step that ran before this batch\'s last write, so it shows the state before the steps finished. Pass screenshot: true with a save_path (or add a screenshot step at the end) if you need the state after them.',
          });
        }
        if (value.shot === undefined) return blocks;
        blocks.push({ type: 'text', text: screenshotEnvelope(value.shot) });
        if (value.shot.image === undefined) {
          blocks.push({ type: 'text', text: value.shot.note ?? `The image is at ${value.shot.path}.` });
          return blocks;
        }
        blocks.push({ type: 'image', attachment: value.shot.image });
        return blocks;
      },
    },
    async execute(args, exec) {
      requireGrant(exec);
      const steps = Array.isArray(args.steps) ? args.steps : [];
      if (steps.length === 0) throw new Error('[BAD_REQUEST] computer_actions needs at least one step');
      if (steps.length > 50) throw new Error('[BAD_REQUEST] computer_actions accepts at most 50 steps per call');
      // Same rule as computer_click: a frame id that is present but empty was meant to be
      // cited, and clicking absolute coordinates instead is a substitution nobody notices.
      const emptyFrameStep = steps.findIndex((step) => typeof step?.from_frame === 'string' && step.from_frame.trim() === '');
      if (emptyFrameStep >= 0) {
        throw new Error(`[BAD_REQUEST] step ${emptyFrameStep} has an empty from_frame; pass a frame id from computer_screenshot, or omit it to use absolute coordinates.`);
      }
      // A step names one way to move: a point, a delta, or a path. Accepting two of them
      // would mean the worker quietly preferring one, which is the kind of substitution a
      // caller only discovers after the pointer has moved somewhere it did not choose.
      steps.forEach((step, index) => {
        const action = String(step?.action ?? '').toLowerCase();
        const hasDelta = Number.isFinite(Number(step?.dx)) || Number.isFinite(Number(step?.dy));
        if (action === 'move' && hasDelta) {
          if (Number.isFinite(Number(step?.x)) || Number.isFinite(Number(step?.y))) {
            throw new Error(`[BAD_REQUEST] step ${index} is a relative move (dx/dy) and also gives x/y: pick one — a delta or a destination point.`);
          }
          if (typeof step?.from_frame === 'string' && step.from_frame !== '') {
            throw new Error(`[BAD_REQUEST] step ${index} is a relative move (dx/dy) and also cites from_frame: a frame names a point in an image, which a delta is not.`);
          }
        }
        if (action === 'drag' && Array.isArray(step?.path) && step.path.length > 0) {
          const alsoCorners = ['from_x', 'from_y', 'to_x', 'to_y'].filter((name) => step[name] !== undefined);
          if (alsoCorners.length > 0) {
            throw new Error(`[BAD_REQUEST] step ${index} is a path drag and also gives ${alsoCorners.join('/')}: a path already names where the gesture starts and ends.`);
          }
          if (step.path.length < 2) throw new Error(`[BAD_REQUEST] step ${index} has a drag path of one point, so there is nothing to drag.`);
          if (step.path.length > 64) throw new Error(`[BAD_REQUEST] step ${index} has a drag path of ${step.path.length} points; the most is 64.`);
        }
      });
      // A frame is a citation of a capture, and the pixels belong to the conversation that
      // took it: the worker is shared between conversations, the images are not (A08).
      steps.forEach((step) => {
        if (typeof step?.from_frame === 'string') refs.assertFrameOwnership(exec?.agent?.session?.id, step.from_frame);
      });
      // Every step's target protection is checked before the first one runs, for the same
      // reason the worker validates the whole batch up front: a step 6 that cannot be
      // allowed must not be discovered after steps 1-5 have already moved the desktop.
      steps.forEach((step, index) => {
        if (typeof step?.ref === 'string' && step.ref !== '') refs.assertRefOwnership(exec?.agent?.session?.id, step.ref);
      });
      const format = resolveFormat(args.format, args.save_path);
      const wantsShot = args.screenshot === true || steps.some((step) => step?.action === 'screenshot');
      let shotPath;
      if (wantsShot) {
        await mkdir(shotRoot, { recursive: true });
        shotPath = args.save_path ?? captureService.nextCapturePath(shotRoot, format);
      }
      // A batch that waits for a condition must not be killed by the transport while it
      // waits. The worker owns the budget, so its own report is what says whether that
      // budget was respected; this is only the ceiling above it. A step-level budget counts
      // too, and the batch default fills in for a condition that names none.
      const waitBudget = (waitFor) => (
        waitFor?.timeout_ms ?? (waitFor === undefined ? undefined : args.timeout_ms)
      );
      const batchWaits = [waitBudget(args.wait_for), ...steps.filter((step) => step?.action === 'wait_for').map(waitBudget)]
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);
      // One budget for the whole call, shared by every wait inside it (C04). The transport
      // timeout is what would otherwise cut a batch off from the outside with nothing in the
      // reply to show for it, so the worker's own deadline is set inside it, and a wait ended
      // by that deadline says so (`timeoutFrom: 'deadline'`) instead of pretending the step's
      // own timeout expired.
      const transportMs = Math.max(actionTimeoutMs, 60_000, batchWaits.length === 0 ? 0 : Math.max(...batchWaits) + 20_000);
      const deadlineMs = Number.isFinite(Number(args.deadline_ms)) && Number(args.deadline_ms) > 0
        ? Number(args.deadline_ms)
        : Math.max(5_000, transportMs - 10_000);
      // Same normalisation as the single-shot capture: with `window`, a region is that
      // window's own pixels; without it, screen pixels (A01).
      const spec = normalizeCaptureSpec({
        window: args.window,
        region: args.region,
        regionSpace: args.region_space,
        surface: args.surface,
        display: args.display,
        clip: args.clip,
      });
      const result = await call(exec, 'batch', {
        steps,
        surface: spec.surface,
        settleMs: args.settle_ms,
        stabilityMs: args.stability_ms,
        stable: args.stable,
        screenshot: args.screenshot === true,
        evidence: args.evidence ?? true,
        stopOnWindowChange: args.stop_on_window_change !== false,
        expectedTransitions: Array.isArray(args.expected_transitions) ? args.expected_transitions : undefined,
        deadlineMs,
        // A trailing observation takes the same text configuration as a standalone read
        // (B1): the whole point is that "do these steps, then tell me what the field says"
        // does not need a second call. `text_target` is validated here as well, so a
        // contradictory target is refused before anything on the desktop is touched.
        state: args.state === undefined ? undefined : { ...args.state, text_target: normalizeTextTarget(args.state.text_target) },
        path: shotPath,
        scale: args.scale,
        format,
        // Where the captures point, and the condition the call waits for. Both are the
        // same thing the single-step tools take, spelled the way the worker reads it.
        window: spec.window,
        requireWindow: args.require_window === true ? true : undefined,
        display: spec.display,
        region: spec.region,
        regionSpace: spec.regionSpace,
        clip: spec.clip,
        // A step's own `timeout_ms` / `poll_ms` win; the batch-level ones are the default for
        // conditions that name none. `computer_actions` owns both spellings, so the
        // resolution happens here rather than in the worker.
        waitFor: args.wait_for === undefined ? undefined : {
          ...args.wait_for,
          timeout_ms: args.wait_for.timeout_ms ?? args.timeout_ms,
          poll_ms: args.wait_for.poll_ms ?? args.poll_ms,
        },
        // A step-level wait is forwarded as it is; the worker reads `timeout_ms`/`poll_ms`
        // off the step, and the step's own default is the same 30 s the schema documents.
      }, { interactive: true, timeoutMs: transportMs });
      // The batch's own captures use the pacing arguments above, and the queue time is what
      // the call spent waiting for the worker before any of it started.
      const queueMs = Number(result?.__bridgeTiming?.queueMs ?? 0);
      // §7.5: a batch that spent seconds waiting for the worker to start is not a batch whose
      // steps were slow, and the reply has to be able to say which of the two happened.
      const startMs = Number(result?.__bridgeTiming?.startMs ?? 0);
      const value = {
        performed: Array.isArray(result.performed) ? result.performed.map((line) => String(line)) : [],
        count: Number(result.count ?? 0),
        failedAt: Number(result.failedAt ?? -1),
      };
      if (typeof result.error === 'string' && result.error !== '') value.error = decorateFailure(result.error);
      if (result.canceled === true) value.canceled = true;
      // Running out of budget is its own fact (§5.7): the step that refused did so because the
      // call was over, not because its arguments were wrong, and the two call for different
      // next moves. `outOfBudget` is what the worker sets on the step that refused; the three
      // deadline numbers are measured, never clamped to the budget.
      if (typeof result.outOfBudget === 'boolean') value.outOfBudget = result.outOfBudget;
      if (typeof result.partial === 'boolean') value.partial = result.partial;
      if (Array.isArray(result.partialSteps) && result.partialSteps.length > 0) {
        value.partialSteps = result.partialSteps.map((n) => Number(n)).filter((n) => Number.isFinite(n));
      }
      // §5.2: what became of every step, not just the ones that "performed" something.
      if (Array.isArray(result.progress) && result.progress.length > 0) {
        value.progress = result.progress.map((one) => ({
          step: Number(one?.step ?? 0),
          action: String(one?.action ?? ''),
          state: String(one?.state ?? 'not-run'),
        }));
      }
      if (result.observation !== null && result.observation !== undefined && result.observation.failed === true) {
        value.observation = {
          failed: true,
          error: String(result.observation.error ?? 'the observation at the end of the call failed'),
        };
        if (typeof result.observation.what === 'string' && result.observation.what !== '') value.observation.what = result.observation.what;
        if (typeof result.observation.note === 'string' && result.observation.note !== '') value.observation.note = result.observation.note;
      }
      if (Number.isFinite(Number(result.deadlineMs)) && Number(result.deadlineMs) > 0) value.deadlineMs = Number(result.deadlineMs);
      if (Number.isFinite(Number(result.overDeadlineMs)) && Number(result.overDeadlineMs) >= 0) value.overDeadlineMs = Number(result.overDeadlineMs);
      if (typeof result.deadlineMet === 'boolean') value.deadlineMet = result.deadlineMet;
      // The ActionReceipt (B07): what was sent, what happened, and where to continue are
      // three separate facts, and a failure that hides the first two is the kind a caller
      // retries blindly.
      if (typeof result.outcome === 'string' && result.outcome !== '') value.outcome = result.outcome;
      if (typeof result.action_sent === 'boolean') value.actionSent = result.action_sent;
      if (Array.isArray(result.wroteSteps)) value.wroteSteps = result.wroteSteps.map((n) => Number(n)).filter((n) => Number.isFinite(n));
      if (Number.isFinite(Number(result.nextStep)) && Number(result.nextStep) >= 0) value.nextStep = Number(result.nextStep);
      if (Array.isArray(result.transitions) && result.transitions.length > 0) {
        value.transitions = result.transitions.map((one) => {
          const entry = {
            atStep: Number(one?.atStep ?? 0),
            from: Number(one?.from ?? 0),
            to: Number(one?.to ?? 0),
            title: String(one?.title ?? ''),
            process: String(one?.process ?? ''),
            matchedBy: String(one?.matchedBy ?? ''),
          };
          if (typeof one?.note === 'string' && one.note !== '') entry.note = one.note;
          return entry;
        });
      }
      if (result.captureUsed !== null && result.captureUsed !== undefined) {
        const used = result.captureUsed;
        value.captureUsed = {
          from: String(used.from ?? 'step'),
          stepIndex: Number.isFinite(Number(used.stepIndex)) ? Number(used.stepIndex) : -1,
          afterLastWrite: used.afterLastWrite === true,
        };
        if (typeof used.note === 'string' && used.note !== '') value.captureUsed.note = used.note;
      }
      if (Array.isArray(result.waits) && result.waits.length > 0) {
        value.waits = result.waits.map((report) => {
          const one = {
            what: String(report?.what ?? ''),
            satisfied: report?.satisfied === true,
            waitedMs: Number(report?.waitedMs ?? 0),
            polls: Number(report?.polls ?? 0),
            timeoutMs: Number(report?.timeoutMs ?? 0),
            timeoutFrom: String(report?.timeoutFrom ?? 'explicit'),
            pollMs: Number(report?.pollMs ?? 0),
            observed: String(report?.observed ?? ''),
          };
          if (Number.isFinite(Number(report?.stableMs)) && Number(report.stableMs) > 0) one.stableMs = Number(report.stableMs);
          if (Number.isFinite(Number(report?.heldMs)) && Number(report.heldMs) >= 0 && one.stableMs !== undefined) one.heldMs = Number(report.heldMs);
          if (typeof report?.status === 'string' && report.status !== '') one.status = report.status;
          if (typeof report?.outcome === 'string' && report.outcome !== '') one.outcome = report.outcome;
          if (typeof report?.timeoutKind === 'string' && report.timeoutKind !== '') one.timeoutKind = report.timeoutKind;
          if (Number.isFinite(Number(report?.pollBackoffTo)) && Number(report.pollBackoffTo) > 0) one.pollBackoffTo = Number(report.pollBackoffTo);
          if (typeof report?.error === 'string' && report.error !== '') one.error = report.error;
          if (report?.window !== null && report?.window !== undefined) {
            one.window = {
              hwnd: Number(report.window.hwnd ?? 0),
              title: String(report.window.title ?? ''),
              process: String(report.window.process ?? ''),
              pid: Number(report.window.pid ?? 0),
            };
          }
          if (report?.control !== null && report?.control !== undefined) {
            const n = report.control;
            one.control = {
              depth: Number(n.depth ?? 0),
              name: String(n.name ?? ''),
              controlType: String(n.controlType ?? 'ControlType.Unknown'),
              automationId: String(n.automationId ?? ''),
              className: String(n.className ?? ''),
              enabled: n.enabled === true,
              offscreen: n.offscreen === true,
              x: Number(n.x ?? 0),
              y: Number(n.y ?? 0),
              width: Number(n.width ?? 0),
              height: Number(n.height ?? 0),
              patterns: Array.isArray(n.patterns) ? n.patterns.map((p) => String(p)) : [],
              ref: String(n.ref ?? ''),
            };
          }
          return one;
        });
      }
      if (result.evidence !== null && result.evidence !== undefined) {
        value.evidence = {
          changed: result.evidence.changed === true,
          before: String(result.evidence.before ?? ''),
          after: String(result.evidence.after ?? ''),
          x: Number(result.evidence.x ?? 0),
          y: Number(result.evidence.y ?? 0),
          width: Number(result.evidence.width ?? 0),
          height: Number(result.evidence.height ?? 0),
        };
        if (result.evidence.reused === true) value.evidence.reused = true;
      }
      if (result.state !== null && result.state !== undefined) {
        // `searched` is the caller's intent, not something the backend reports: it is
        // what tells the model whether it is looking at a match list or a whole tree.
        const stateArgs = args.state ?? {};
        const searched = [stateArgs.filter, stateArgs.name, stateArgs.control_type, stateArgs.automation_id]
          .some((value) => typeof value === 'string' && value !== '');
        const state = stateValue(result.state, searched, undefined);
        markObservation(exec, `ui|${state.window.hwnd}|${state.mode}|batch-state|${JSON.stringify(args.state ?? {})}`, state);        // The batch's trailing read mints refs too, so the session owns them the same way
        // it owns the ones computer_ui returned.
        refs.noteSnapshot(exec?.agent?.session?.id, state.snapshot);
        value.state = state;
      }
      if (result.shot !== null && result.shot !== undefined) {
        const shotMedia = result.shot.format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const admitStarted = Date.now();
        const admitted = await captureService.admit(ctx, result.shot.path, shotMedia, result.shot.format === 'jpeg' ? 'screen.jpg' : 'screen.png', exec?.agent?.session?.id);
        await reportAttachment(exec, result.shot, admitted);
        const workerMs = Number(result.elapsedMs ?? 0);
        const admissionMs = Date.now() - admitStarted;
        value.shot = shotValue(result.shot, admitted);
        refs.noteFrame(exec?.agent?.session?.id, value.shot.frame);
        const timing = { workerMs, admitMs: admissionMs };
        if (queueMs > 0) timing.queueMs = Math.round(queueMs);
        if (startMs > 0) timing.startMs = Math.round(startMs);
        value.timing = timing;
      } else if (Number.isFinite(result.elapsedMs)) {
        const timing = { workerMs: Number(result.elapsedMs), admitMs: 0 };
        if (queueMs > 0) timing.queueMs = Math.round(queueMs);
        if (startMs > 0) timing.startMs = Math.round(startMs);
        value.timing = timing;
      }
      return value;
    },
  }));

  safeRegister(defineTracedTool({
    name: 'computer_click',
    description:
      'Click at an absolute screen coordinate. By default this tries accessibility first: if a pressable control is under the point, it is invoked through UI Automation instead of clicked, which is more reliable, does not move the mouse, and works even on a window the desktop will not raise. Pass `prefer_a11y: false` to force a real synthesized click. Coordinates are virtual-desktop pixels, the same ones the computer_screenshot envelope and cursor report use. Requires 电脑操作.',
    parameters: {
      x: { type: 'integer', required: true, description: 'Absolute screen x in virtual-desktop pixels.' },
      y: { type: 'integer', required: true, description: 'Absolute screen y in virtual-desktop pixels.' },
      button: { type: 'string', description: "Mouse button: 'left' (default), 'right', or 'middle'." },
      clicks: { type: 'integer', description: 'Click count: 1 (default), 2 for a double click, 3 for a triple click.' },
      modifiers: { type: 'string', description: "A '+' separated chord held down for the duration of the click, e.g. 'ctrl' to add to a selection or 'shift' to extend one. Released afterwards even if the click fails.", },
      prefer_a11y: { type: 'boolean', description: 'Try the accessibility press first when a pressable control is under the point (default true). A chorded or multi-click is always a real click — there is no accessibility equivalent.' },
      allow_activate: { type: 'boolean', description: "With `from_frame`: when the landing guard finds another process under the point (the target is covered), bring the target window forward once and check again before refusing (default false). One attempt only; `frame.recovered` in the reply says whether it was needed." },
      verify_content: { type: 'boolean', description: 'With `from_frame`: set false to skip the content check against what the surface looks like now — an animated surface always reads as changed. Default true.' },
      allow_windows: { type: 'array', items: { type: 'integer' }, description: "With `from_frame`: additional window handles this click may land on — a dialog or second window of the same application that is the transition you expect. Anything else under the point, including another window of the same process, is refused as `[TARGET_OCCLUDED]`; `frame.guard` names the rule that allowed it." },
      from_frame: { type: 'string', description: 'A frame id from computer_screenshot: x and y are pixels *in that image*, projected for you. The frame is checked first — gone, re-owned or moved so far that the point falls outside it is refused rather than clicked.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          x: { type: 'integer', required: true },
          y: { type: 'integer', required: true },
          clicks: { type: 'integer', required: true },
          button: { type: 'string', required: true },
          via: { type: 'string', required: true },
          modifiers: { type: 'string' },
          frame: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              fromImage: {
                type: 'object', additionalProperties: false, required: true,
                properties: { x: { type: 'integer', required: true }, y: { type: 'integer', required: true } },
              },
              projected: {
                type: 'object', additionalProperties: false, required: true,
                properties: { x: { type: 'integer', required: true }, y: { type: 'integer', required: true } },
              },
              scale: { type: 'number', required: true },
              source: { type: 'string', required: true },
              drift: { type: 'integer' },
              note: { type: 'string' },
              mapping: { type: 'string', description: "Which transform projected this point: 'encoded-1:1' when the delivered image is the encoded one, 'attached-rescaled(...)' when the host resized it on the way to the model, or 'attached-ignored(...)' when the reported size could not be a rescale of this capture." },
              guard: { type: 'string', description: "Why the point was allowed: 'root' (the target window, or a child of it), 'owned-by-target' (a dialog or popup menu that belongs to the target), 'allowed-transition' (a window this call named in allow_windows), 'uia-agrees' (the accessibility element under the point belongs to the target window although WindowFromPoint named something else), 'unavailable' (nothing could be read under the point, so it was not verified) or 'no-target' (a screen frame names no window). A point covered by a different window of the *same process* is not in this list — it is refused as [TARGET_OCCLUDED], because a shared pid does not make it the same window." },
              recovered: { type: 'boolean', description: 'True when the target window had to be brought forward once for this point to be legal — set only when allow_activate was asked for and the guard had seen another process under the point.' },
            },
          },
          element: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string', required: true },
              controlType: { type: 'string', required: true },
              automationId: { type: 'string', required: true },
            },
          },
        },
      },
      render: (_args, value) => {
        const chord = value.modifiers === undefined ? '' : `${value.modifiers}+`;
        if (value.via === 'a11y') {
          const element = value.element ?? { name: '', controlType: 'ControlType.Unknown', automationId: '' };
          const type = element.controlType.replace('ControlType.', '');
          const label = element.name ? `"${element.name}"` : `(unnamed ${type})`;
          return [{ type: 'text', text: `Pressed the ${type} ${label} at (${value.x}, ${value.y}) through UI Automation — the pointer was not moved.` }];
        }
        return [{ type: 'text', text: `${value.button} ${chord}click x${value.clicks} at (${value.x}, ${value.y}).` }];
      },
    },
    async execute(args, exec) {
      // A frame id that is present but empty is not "no frame given": the caller meant to
      // cite one and the value did not survive. Falling back to absolute coordinates
      // instead is a substitution nobody notices until the wrong thing has been clicked.
      if (typeof args.from_frame === 'string' && args.from_frame.trim() === '') {
        throw new Error('[BAD_REQUEST] from_frame was given but is empty; pass the frame id from computer_screenshot, or omit it entirely to use absolute coordinates.');
      }
      refs.assertFrameOwnership(exec?.agent?.session?.id, args.from_frame);
      const result = await call(exec, 'click', {
        x: args.x,
        y: args.y,
        fromFrame: args.from_frame,
        button: args.button ?? 'left',
        clicks: args.clicks ?? 1,
        modifiers: args.modifiers,
        preferA11y: args.prefer_a11y,
        allowActivate: args.allow_activate === true ? true : undefined,
        verifyContent: args.verify_content === false ? false : undefined,
        allowWindows: Array.isArray(args.allow_windows) && args.allow_windows.length > 0 ? args.allow_windows.map((one) => Number(one)) : undefined,
      }, { interactive: true });
      // Map explicitly: the backend also reports an event count, and the declared
      // output schema rejects any property it does not name.
      const value = {
        x: Number(result.x),
        y: Number(result.y),
        clicks: Number(result.clicks),
        button: String(result.button ?? 'left'),
        via: String(result.via ?? 'mouse'),
      };
      if (typeof result.modifiers === 'string' && result.modifiers !== '') value.modifiers = result.modifiers;
      // Which frame the coordinates came from, and where they landed: the caller handed
      // over image pixels, so it should get back the screen pixels it actually clicked.
      if (result.frame !== null && result.frame !== undefined) {
        value.frame = {
          id: String(result.frame.id ?? ''),
          fromImage: { x: Number(result.frame.fromImage?.x ?? 0), y: Number(result.frame.fromImage?.y ?? 0) },
          projected: { x: Number(result.frame.projected?.x ?? 0), y: Number(result.frame.projected?.y ?? 0) },
          scale: Number(result.frame.scale ?? 1),
          source: String(result.frame.source ?? ''),
        };
        if (Number.isFinite(result.frame.drift) && Number(result.frame.drift) > 0) value.frame.drift = Number(result.frame.drift);
        if (typeof result.frame.note === 'string' && result.frame.note !== '') value.frame.note = String(result.frame.note);
        if (typeof result.frame.mapping === 'string' && result.frame.mapping !== '') value.frame.mapping = String(result.frame.mapping);
        if (typeof result.frame.guard === 'string' && result.frame.guard !== '') value.frame.guard = String(result.frame.guard);
        if (result.frame.recovered === true) value.frame.recovered = true;
      }
      if (value.via === 'a11y' && result.element !== null && result.element !== undefined) {
        value.element = {
          name: String(result.element.name ?? ''),
          controlType: String(result.element.controlType ?? 'ControlType.Unknown'),
          automationId: String(result.element.automationId ?? ''),
        };
      }
      return value;
    },
  }));

  safeRegister(defineTracedTool({
    name: 'computer_drag',
    description:
      'Press the left mouse button at one coordinate, move to another, and release — for selecting text, moving windows, or dragging sliders. Give `path` instead of the four coordinates to drag through a shape (a drawing stroke, a selection that has to go round something, a drop that must pass over a target). Coordinates are virtual-desktop pixels. Requires 电脑操作.',
    parameters: {
      from_x: { type: 'integer', description: 'Absolute start x (or an image pixel when `from_frame` is set). Required unless `path` is given.' },
      from_y: { type: 'integer', description: 'Absolute start y (or an image pixel when `from_frame` is set). Required unless `path` is given.' },
      to_x: { type: 'integer', description: 'Absolute end x (or an image pixel when `from_frame` is set). Required unless `path` is given.' },
      to_y: { type: 'integer', description: 'Absolute end y (or an image pixel when `from_frame` is set). Required unless `path` is given.' },
      from_last: { type: 'boolean', description: 'Start where the last drag in this session ended, instead of naming from_x/from_y — for drawing a second stroke without re-locating the first one. Only the end coordinates are then required. The handle expires (短时有效), and if it has, the call is refused rather than continued from a guessed point.' },
      continue_from: { type: 'string', description: 'The `handle` from an earlier drag receipt: same as `from_last` but for that specific drag. A handle that is not the most recent one, or is past its lifetime, is refused (`DRAG_HANDLE_MISSING` / `DRAG_HANDLE_STALE`).' },
      path: {
        type: 'array',
        description: 'The waypoints to drag through, as `{x, y}` in the same space the four coordinates use (screen pixels, or image pixels with `from_frame`). Two to 64 points; duplicates are dropped and the gesture is sampled smoothly along the whole path, so a point every few pixels is not needed. Excludes from_x/from_y/to_x/to_y.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            x: { type: 'integer', required: true },
            y: { type: 'integer', required: true },
          },
        },
      },
      duration_ms: { type: 'integer', description: 'How long the whole gesture takes, 100–5000 (default 400). The motion is spread over the path by arc length, so a long and a short segment each get the time they need. Ignored by the two-point form, which uses its own pacing.' },
      modifiers: { type: 'string', description: "A '+' separated chord held across the whole gesture, e.g. 'shift' to extend a selection or 'ctrl' to copy rather than move. A drag has no accessibility equivalent, so this is the only way to express it." },
      allow_activate: { type: 'boolean', description: 'With `from_frame`: allow one attempt at bringing the target window forward when the guard finds another process under the start point (default false).' },
      verify_content: { type: 'boolean', description: 'With `from_frame`: set false to skip the content check on an old frame (an animated surface always reads as changed). Default true.' },
      allow_windows: { type: 'array', items: { type: 'integer' }, description: "With `from_frame`: window handles this drag may land on besides the frame's own — see computer_click for the occlusion rule. Both ends are checked." },
      from_frame: { type: 'string', description: 'A frame id from computer_screenshot — see computer_click.from_frame. Both ends are projected before anything moves, so a stale frame refuses the whole gesture instead of half-executing it.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          from: { type: 'object', additionalProperties: false, required: true, properties: { x: { type: 'integer', required: true }, y: { type: 'integer', required: true } } },
          to: { type: 'object', additionalProperties: false, required: true, properties: { x: { type: 'integer', required: true }, y: { type: 'integer', required: true } } },
          handle: { type: 'string', description: 'The handle for this drag (8.txt §8)：把它交给下一次 computer_drag 的 `continue_from` 就能接着画，省掉重新定位起点。短时有效，过期或不是最近一个都会被拒绝。' },
          path: {
            type: 'object',
            additionalProperties: false,
            description: 'Present when the gesture followed a path rather than a straight line.',
            properties: {
              points: { type: 'integer', required: true, description: 'Waypoints after duplicates were dropped.' },
              samples: { type: 'integer', required: true, description: 'Mouse moves the gesture actually walked the path in.' },
              durationMs: { type: 'integer', required: true },
              paceMs: { type: 'integer', required: true, description: 'Delay between two samples, derived from duration_ms.' },
            },
          },
          modifiers: { type: 'string' },
          frame: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              fromImage: { type: 'object', additionalProperties: false, required: true, properties: { x: { type: 'integer', required: true }, y: { type: 'integer', required: true } } },
              projected: { type: 'object', additionalProperties: false, required: true, properties: { x: { type: 'integer', required: true }, y: { type: 'integer', required: true } } },
              scale: { type: 'number', required: true },
              source: { type: 'string', required: true },
              drift: { type: 'integer' },
              note: { type: 'string' },
              mapping: { type: 'string', description: "Which transform projected this point: 'encoded-1:1' when the delivered image is the encoded one, 'attached-rescaled(...)' when the host resized it on the way to the model, or 'attached-ignored(...)' when the reported size could not be a rescale of this capture." },
              guard: { type: 'string', description: "Why the point was allowed: 'root' (the target window, or a child of it), 'owned-by-target' (a dialog or popup menu that belongs to the target), 'allowed-transition' (a window this call named in allow_windows), 'uia-agrees' (the accessibility element under the point belongs to the target window although WindowFromPoint named something else), 'unavailable' (nothing could be read under the point, so it was not verified) or 'no-target' (a screen frame names no window). A point covered by a different window of the *same process* is not in this list — it is refused as [TARGET_OCCLUDED], because a shared pid does not make it the same window." },
              recovered: { type: 'boolean', description: 'True when the target window had to be brought forward once for this point to be legal — set only when allow_activate was asked for and the guard had seen another process under the point.' },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.path === undefined
          ? `Dragged ${value.modifiers === undefined ? '' : `${value.modifiers}+`}from (${value.from.x}, ${value.from.y}) to (${value.to.x}, ${value.to.y}).`
          : `Dragged ${value.modifiers === undefined ? '' : `${value.modifiers}+`}through ${value.path.points} waypoint(s) (${value.path.samples} mouse moves, ${value.path.durationMs} ms) from (${value.from.x}, ${value.from.y}) to (${value.to.x}, ${value.to.y}).`}${value.frame === undefined ? '' : ` (from frame ${value.frame.id}: image (${value.frame.fromImage.x},${value.frame.fromImage.y}) -> screen (${value.frame.projected.x},${value.frame.projected.y})${value.frame.note === undefined ? '' : `; ${value.frame.note}`})`}${value.handle === undefined ? '' : `\n这段的落点已记为句柄 ${value.handle}：接着画就用 continue_from: "${value.handle}"（或 from_last: true），句柄过期会被拒而不是猜一个点。`}`,
      }],
    },
    async execute(args, exec) {
      // The grant comes before everything else: a session that never turned 电脑操作 on should
      // hear that, not a complaint about the shape of arguments it was never allowed to use.
      requireGrant(exec);
      refs.assertFrameOwnership(exec?.agent?.session?.id, args.from_frame);
      const hasPath = Array.isArray(args.path) && args.path.length > 0;
      // §8 后半：起点可以来自上一次拖拽的落点，这时四个角点里只有终点是必需的。
      const continueFromLast = args.from_last === true || (typeof args.continue_from === 'string' && args.continue_from !== '');
      const corners = ['from_x', 'from_y', 'to_x', 'to_y'];
      if (hasPath) {
        const alsoCorners = corners.filter((name) => args[name] !== undefined);
        if (alsoCorners.length > 0) {
          throw new Error(`[BAD_REQUEST] computer_drag takes either \`path\` or ${corners.join('/')}, not both: a path already names where the gesture starts and ends (got ${alsoCorners.join(', ')} as well).`);
        }
        if (args.path.length < 2) throw new Error('[BAD_REQUEST] a drag path needs at least two points.');
        if (args.path.length > 64) throw new Error(`[BAD_REQUEST] a drag path takes at most 64 points (got ${args.path.length}); simplify it — the gesture is sampled smoothly, so vertices every few pixels are not needed.`);
        for (const [index, point] of args.path.entries()) {
          if (point === null || typeof point !== 'object' || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
            throw new Error(`[BAD_REQUEST] drag path point ${index} needs numeric x and y.`);
          }
        }
      } else {
        const required = continueFromLast ? ['to_x', 'to_y'] : corners;
        const missing = required.filter((name) => !Number.isFinite(Number(args[name])));
        if (missing.length > 0) {
          throw new Error(`[BAD_REQUEST] computer_drag needs ${missing.join(', ')} — or a \`path\` of waypoints instead.`);
        }
      }
      const result = await call(exec, 'drag', {
        fromX: hasPath || continueFromLast ? undefined : args.from_x,
        fromY: hasPath || continueFromLast ? undefined : args.from_y,
        toX: hasPath ? undefined : args.to_x,
        toY: hasPath ? undefined : args.to_y,
        fromLast: continueFromLast ? true : undefined,
        continueFrom: typeof args.continue_from === 'string' && args.continue_from !== '' ? args.continue_from : undefined,
        path: hasPath ? args.path.map((point) => ({ x: Number(point.x), y: Number(point.y) })) : undefined,
        durationMs: args.duration_ms,
        fromFrame: args.from_frame,
        modifiers: args.modifiers,
        allowActivate: args.allow_activate === true ? true : undefined,
        verifyContent: args.verify_content === false ? false : undefined,
        allowWindows: Array.isArray(args.allow_windows) && args.allow_windows.length > 0 ? args.allow_windows.map((one) => Number(one)) : undefined,
      }, { interactive: true });
      // `steps` from the backend is not declared, so it is dropped here.
      const value = { from: { x: Number(result.from.x), y: Number(result.from.y) }, to: { x: Number(result.to.x), y: Number(result.to.y) } };
      if (result.path !== null && result.path !== undefined) {
        value.path = {
          points: Number(result.path.points ?? 0),
          samples: Number(result.path.samples ?? 0),
          durationMs: Number(result.path.durationMs ?? 0),
          paceMs: Number(result.path.paceMs ?? 0),
        };
      }
      if (typeof result.modifiers === 'string' && result.modifiers !== '') value.modifiers = result.modifiers;
      // §8 后半：回执把句柄交回调用方，下一次就能用它（或 from_last）接着画。
      if (typeof result.handle === 'string' && result.handle !== '') value.handle = result.handle;
      if (result.frame !== null && result.frame !== undefined) {
        value.frame = {
          id: String(result.frame.id ?? ''),
          fromImage: { x: Number(result.frame.fromImage?.x ?? 0), y: Number(result.frame.fromImage?.y ?? 0) },
          projected: { x: Number(result.frame.projected?.x ?? 0), y: Number(result.frame.projected?.y ?? 0) },
          scale: Number(result.frame.scale ?? 1),
          source: String(result.frame.source ?? ''),
        };
        if (Number.isFinite(result.frame.drift) && Number(result.frame.drift) > 0) value.frame.drift = Number(result.frame.drift);
        if (typeof result.frame.note === 'string' && result.frame.note !== '') value.frame.note = String(result.frame.note);
        if (typeof result.frame.mapping === 'string' && result.frame.mapping !== '') value.frame.mapping = String(result.frame.mapping);
        if (typeof result.frame.guard === 'string' && result.frame.guard !== '') value.frame.guard = String(result.frame.guard);
        if (result.frame.recovered === true) value.frame.recovered = true;
      }
      return value;
    },
  }));

  safeRegister(defineTracedTool({
    name: 'computer_scroll',
    description:
      'Scroll the mouse wheel, optionally after moving the pointer over the surface to scroll. Requires 电脑操作.',
    parameters: {
      direction: { type: 'string', required: true, description: "Scroll direction: 'up', 'down', 'left', or 'right'." },
      clicks: { type: 'integer', description: 'Number of wheel notches, 1 to 20 (default 3).' },
      x: { type: 'integer', description: 'Optional absolute x to move the pointer to first (or an image pixel when `from_frame` is set).' },
      y: { type: 'integer', description: 'Optional absolute y to move the pointer to first (or an image pixel when `from_frame` is set).' },
      from_frame: { type: 'string', description: 'A frame id from computer_screenshot — see computer_click.from_frame. The wheel goes to whatever is under the pointer, so this is how a scroll is aimed at a panel measured on a capture.' },
      allow_activate: { type: 'boolean', description: 'With `from_frame`: allow one attempt at bringing the target window forward when the guard finds another process under the point (default false).' },
      verify_content: { type: 'boolean', description: 'With `from_frame`: set false to skip the content check on an old frame (an animated surface always reads as changed). Default true.' },
      allow_windows: { type: 'array', items: { type: 'integer' }, description: "With `from_frame`: window handles this scroll may aim at besides the frame's own — see computer_click for the occlusion rule." },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          direction: { type: 'string', required: true },
          clicks: { type: 'integer', required: true },
          horizontal: { type: 'boolean', required: true },
          frame: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              fromImage: { type: 'object', additionalProperties: false, required: true, properties: { x: { type: 'integer', required: true }, y: { type: 'integer', required: true } } },
              projected: { type: 'object', additionalProperties: false, required: true, properties: { x: { type: 'integer', required: true }, y: { type: 'integer', required: true } } },
              scale: { type: 'number', required: true },
              source: { type: 'string', required: true },
              drift: { type: 'integer' },
              note: { type: 'string' },
              mapping: { type: 'string', description: "Which transform projected this point: 'encoded-1:1' when the delivered image is the encoded one, 'attached-rescaled(...)' when the host resized it on the way to the model, or 'attached-ignored(...)' when the reported size could not be a rescale of this capture." },
              guard: { type: 'string', description: "Why the point was allowed: 'root' (the target window, or a child of it), 'owned-by-target' (a dialog or popup menu that belongs to the target), 'allowed-transition' (a window this call named in allow_windows), 'uia-agrees' (the accessibility element under the point belongs to the target window although WindowFromPoint named something else), 'unavailable' (nothing could be read under the point, so it was not verified) or 'no-target' (a screen frame names no window). A point covered by a different window of the *same process* is not in this list — it is refused as [TARGET_OCCLUDED], because a shared pid does not make it the same window." },
              recovered: { type: 'boolean', description: 'True when the target window had to be brought forward once for this point to be legal — set only when allow_activate was asked for and the guard had seen another process under the point.' },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Scrolled ${value.direction} by ${value.clicks} notches.` }],
    },
    async execute(args, exec) {
      refs.assertFrameOwnership(exec?.agent?.session?.id, args.from_frame);
      const direction = String(args.direction ?? 'down').toLowerCase();
      const horizontal = direction === 'left' || direction === 'right';
      const clicks = Math.min(20, Math.max(1, args.clicks ?? 3));
      const result = await call(exec, 'scroll', { direction, clicks, horizontal, x: args.x, y: args.y, fromFrame: args.from_frame, allowActivate: args.allow_activate === true ? true : undefined, verifyContent: args.verify_content === false ? false : undefined, allowWindows: Array.isArray(args.allow_windows) && args.allow_windows.length > 0 ? args.allow_windows.map((one) => Number(one)) : undefined }, { interactive: true });
      const value = { direction: result.direction, clicks: result.clicks, horizontal: result.horizontal };
      if (result.frame !== null && result.frame !== undefined) {
        value.frame = {
          id: String(result.frame.id ?? ''),
          fromImage: { x: Number(result.frame.fromImage?.x ?? 0), y: Number(result.frame.fromImage?.y ?? 0) },
          projected: { x: Number(result.frame.projected?.x ?? 0), y: Number(result.frame.projected?.y ?? 0) },
          scale: Number(result.frame.scale ?? 1),
          source: String(result.frame.source ?? ''),
        };
        if (Number.isFinite(result.frame.drift) && Number(result.frame.drift) > 0) value.frame.drift = Number(result.frame.drift);
        if (typeof result.frame.note === 'string' && result.frame.note !== '') value.frame.note = String(result.frame.note);
        if (typeof result.frame.mapping === 'string' && result.frame.mapping !== '') value.frame.mapping = String(result.frame.mapping);
        if (typeof result.frame.guard === 'string' && result.frame.guard !== '') value.frame.guard = String(result.frame.guard);
        if (result.frame.recovered === true) value.frame.recovered = true;
      }
      return value;
    },
  }));

  safeRegister(defineTracedTool({
    name: 'computer_type',
    description:
      'Type text into whatever currently has keyboard focus, using Unicode input so any language works. Click the target field first. Requires 电脑操作.',
    parameters: {
      text: { type: 'string', required: true, description: 'The exact text to type. Newlines press Enter.' },
      into_hwnd: { type: 'integer', description: 'Only send if this window (an hwnd from computer_windows) would receive it. A dialog that appeared since the last click is how text ends up in the wrong place; with this set a mismatch is refused before anything is sent.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          typed: { type: 'integer', required: true },
          foreground: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Typed ${value.typed} characters into ${value.foreground}.` }],
    },
    async execute(args, exec) {
      const result = await call(exec, 'type', { text: args.text, intoHwnd: args.into_hwnd }, { interactive: true });
      const fg = result.foreground ?? {};
      return { typed: result.typed, foreground: `${fg.title ? `"${fg.title}"` : '(untitled window)'}${fg.process ? ` [${fg.process}]` : ''}` };
    },
  }));

  safeRegister(defineTracedTool({
    name: 'computer_key',
    description:
      "Press a key or key chord on the keyboard focus, e.g. 'enter', 'esc', 'tab', 'ctrl+c', 'ctrl+shift+t', 'alt+f4', 'win'. Requires 电脑操作.",
    parameters: {
      keys: { type: 'string', required: true, description: "Chord with '+' between keys, e.g. 'ctrl+s'. Modifiers come first." },
      into_hwnd: { type: 'integer', description: 'Only send if this window (an hwnd from computer_windows) is the one that would receive it; a mismatch is refused before anything is sent. Same guard as computer_type.' },
      repeat: { type: 'integer', description: 'How many times to press the chord, 1 to 100 (default 1). Ignored when hold_seconds is set.' },
      hold_seconds: {
        type: 'number',
        description: 'Press the chord down, hold it (maximum 10 s), then release — for applications that must see one continuous press.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          keys: { type: 'string', required: true },
          repeat: { type: 'integer', required: true },
          heldMs: { type: 'integer', required: true },
          foreground: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.heldMs > 0
          ? `Held ${value.keys} for ${(value.heldMs / 1000).toFixed(1)}s in ${value.foreground}.`
          : `Pressed ${value.keys}${value.repeat > 1 ? ` x${value.repeat}` : ''} into ${value.foreground}.`,
      }],
    },
    async execute(args, exec) {
      const holdMs = args.hold_seconds === undefined ? 0 : Math.min(10, Math.max(0, args.hold_seconds)) * 1000;
      const result = await call(exec, 'key', {
        intoHwnd: args.into_hwnd,
        keys: args.keys,
        repeat: args.repeat ?? 1,
        holdMs,
      }, { interactive: true, timeoutMs: Math.max(actionTimeoutMs, holdMs + 10_000) });
      const fg = result.foreground ?? {};
      return {
        keys: result.keys,
        repeat: result.repeat,
        heldMs: result.heldMs ?? 0,
        foreground: `${fg.title ? `"${fg.title}"` : '(untitled window)'}${fg.process ? ` [${fg.process}]` : ''}`,
      };
    },
  }));

  safeRegister(defineTracedTool({
    name: 'computer_windows',
    description:
      'List the visible top-level windows with their titles, owning process, and screen rectangles, or bring one to the foreground. Prefer this over guessing from a screenshot when you need to switch applications. Requires 电脑操作.',
    parameters: {
      filter: { type: 'string', description: 'Case-insensitive substring matched against the window title or process name.' },
      focus_hwnd: { type: 'integer', description: 'Window handle from a previous listing to activate and bring to the foreground.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          windows: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                hwnd: { type: 'integer', required: true },
                title: { type: 'string', required: true },
                process: { type: 'string', required: true },
                pid: { type: 'integer', required: true },
                x: { type: 'integer', required: true },
                y: { type: 'integer', required: true },
                width: { type: 'integer', required: true },
                height: { type: 'integer', required: true },
                foreground: { type: 'boolean', required: true },
              },
            },
          },
          focused: { type: 'string' },
          focusSucceeded: { type: 'boolean' },
          focusedWindowVisible: { type: 'boolean' },
          focusNote: { type: 'string' },
          foreground: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (value.windows.length === 0) {
          const lines = [];
          if (value.focused !== undefined) {
            lines.push(value.focusSucceeded === true
              ? `Focused ${value.focused}`
              : `Could NOT bring ${value.focused} to the foreground${value.foreground === undefined ? '' : `: ${value.foreground} owns it`}. Keys and clicks sent now would go to that window instead, so bring the target up first — click inside it, or check for a message box or a modal in another window.`);
          } else {
            lines.push('No matching visible windows.');
          }
          return [{ type: 'text', text: lines.join('\n') }];
        }
        const lines = value.windows.map(
          (w) => `${w.foreground ? '*' : ' '} hwnd=${w.hwnd} [${w.process}] "${w.title}" ${w.width}x${w.height} at (${w.x},${w.y})`,
        );
        const head = `${value.windows.length} visible window(s) (* = foreground):`;
        const tail = value.focused === undefined ? '' : `\n${value.focusSucceeded === true ? `Focused ${value.focused}` : `Could NOT foreground ${value.focused}${value.foreground === undefined ? '' : `: ${value.foreground} owns it`}`}`;
        return [{ type: 'text', text: `${head}\n${lines.join('\n')}${tail}` }];
      },
    },
    async execute(args, exec) {
      if (args.focus_hwnd !== undefined) {
        const result = await call(exec, 'focus', { hwnd: args.focus_hwnd });
        const value = {
          windows: [],
          focused: `${result.title || 'window'} (hwnd=${result.hwnd}, focused=${result.focused})`,
          focusSucceeded: result.focused === true,
        };
        // Whether the window is still on screen after the raise. Focusing must not change
        // that, and a caller about to click coordinates needs to know if it did.
        if (typeof result.visible === 'boolean') value.focusedWindowVisible = result.visible;
        if (typeof result.note === 'string' && result.note !== '') value.focusNote = result.note;
        // Only meaningful when the raise failed: who holds the foreground explains
        // why, and what the caller would be typing into if it went ahead anyway.
        const owner = result.foreground ?? {};
        if (result.focused !== true && Number(owner.hwnd ?? 0) !== 0) {
          value.foreground = `${owner.title ? `"${owner.title}"` : '(untitled)'} [${owner.process || 'unknown'}]`;
        }
        return value;
      }
      const result = await call(exec, 'windows', { filter: args.filter });
      return {
        windows: (result.windows ?? []).map((w) => ({
          hwnd: w.hwnd,
          title: w.title,
          process: w.process,
          pid: w.pid,
          x: w.x,
          y: w.y,
          width: w.width,
          height: w.height,
          foreground: w.foreground,
        })),
      };
    },
  }));

  safeRegister(defineTracedTool({
    name: 'computer_ui',
    description:
      'Read the Windows UI Automation tree of a window: control types, names, automation ids, rectangles, and supported patterns. Give a `filter` or an exact `name` to get only the matching nodes — several times faster than dumping a whole tree, so prefer it when you know what you are looking for. The reply names the window it came from and says when the tree is unchanged since your last read. Rows render compact (ref, type, name, patterns) because that is what acting needs; `compact: false` adds geometry and diagnostics, and `screenshot: true` returns pixels and tree in one call. Requires 电脑操作.',
    parameters: {
      hwnd: { type: 'integer', description: 'Window handle from computer_windows. Omit to inspect the window that currently has focus.' },
      filter: { type: 'string', description: 'Case-insensitive substring matched against name, automation id, and control type. Matching happens in the backend, which is much faster than dumping the tree and filtering afterwards.' },
      name: { type: 'string', description: 'Exact substring match against the accessible name only — the narrowest and fastest search.' },
      control_type: { type: 'string', description: "Match the control type, e.g. 'Button', 'Edit', 'ListItem'." },
      automation_id: { type: 'string', description: 'Exact automation id match; becomes a server-side query rather than a scan.' },
      max_depth: { type: 'integer', description: 'Tree depth to walk, 1 to 10 (default 5). Ignored when a filter is given, because a search looks at every descendant.' },
      max_nodes: { type: 'integer', description: 'Node budget, 10 to 1500 (default 250). A filtered read usually returns far fewer.' },
      max_visited: { type: 'integer', description: 'Traversal budget: how many nodes the walk may look at before it stops, separate from the node budget (default: generous, derived from the node budget; 0 means no limit). Use a small value to bound a huge or hostile tree, or a large one when a read came back marked as traversal-truncated.' },
      patterns: { type: 'boolean', description: 'Probe which UI Automation patterns each node supports (invoke/value/text/select/toggle/expand/scroll_item). Default true; false is noticeably faster when you only need names and rectangles.' },
      skip_empty: { type: 'boolean', description: 'Omit nodes with no name, no automation id and no patterns — usually anonymous layout containers that crowd out the controls you actually want. Default true; set false for the literal tree.' },
      compact: { type: 'boolean', description: 'Render rows short by default: ref, type, name and patterns. Pass false to also get each row\'s centre, the omitted-node counts and the pruning notes. The returned value always carries the full geometry; this only decides what the text spells out.' },
      skip_if_degraded: {
        type: 'boolean',
        description: "With `hwnd`: skip the tree walk when this window was already read as degraded or unavailable within the last 90 s, and return that conclusion instead (default false). Only this explicit form skips: asking for a read is itself new evidence, so an ordinary call always reads.",
      },
      since: { type: 'string', description: 'A snapshot id from an earlier read — see computer_ui.since. Only what changed comes back, with a `delta` summary.' },
      prune: { type: 'boolean', description: 'Fold away what nobody can use — zero-area scaffolding, runs of similar siblings, and the lowest-priority rows when the budget is tight. Shape-preserving: children are re-parented, every surviving row keeps its context, and a node with an automation id or a pattern is never dropped (default true; false gives the raw provider output).' },
      screenshot: { type: 'boolean', description: 'Also capture the screen in the same call, so one round trip gives both the pixels and the tree. With `hwnd` the capture is of *that window* (it renders itself, so whatever covers it is irrelevant), so both halves describe the same thing.' },
      save_path: { type: 'string', description: 'With `screenshot`: write the capture here instead of the plugin temp directory.' },
      scale: { type: 'number', description: 'With `screenshot`: downscale the capture (0.5 halves both edges and roughly quarters the bytes and vision tokens).' },
      format: { type: 'string', enum: ['jpeg', 'png'], description: "With `screenshot`: 'jpeg' (default, a quarter of the bytes) or 'png' for lossless detail." },
      settle_ms: { type: 'integer', description: 'When a write happened just before this read, the floor on how old that write must be before the tree is read (default 300, maximum 5000); time already spent counts. See computer_screenshot.settle_ms.' },
      text: {
        type: 'object',
        additionalProperties: false,
        description: 'Also return the text this read is about, so "read the window, then read the field" is one call. `{}` gives the focused control and what is selected in it; `document: true` reads the document behind it, `selected: true` lists what a list or tree has selected. Every field shares one `max_text_chars` budget, and a field that could not be read says why (`unsupported`, `unavailable`, `budget_exhausted`) instead of coming back empty. The target is the focused control when it belongs to this window, otherwise the text-providing row of this read; if that is still ambiguous the block says `target_required` and you pass text_target.',
        properties: {
          focused: { type: 'boolean', description: 'The focused control as one line: type · name · value (default true once `text` is given).' },
          selection: { type: 'boolean', description: 'The text selected inside the target (default true once `text` is given).' },
          document: { type: 'boolean', description: 'The document behind the target, up to the budget. Off unless asked for — it is the expensive one.' },
          selected: { type: 'boolean', description: 'The items a list or tree has selected (SelectionPattern).' },
        },
      },
      text_target: {
        type: 'object',
        additionalProperties: false,
        description: "Which control `text` reads when the default is not the one you mean: a `ref` from a read, or an exact selector — both at once is refused, because a ref names one element and a selector names a rule. Without it only the focused control and this read's own rows are considered: the read never scans the window, and answers `target_required` rather than guessing.",
        properties: {
          ref: { type: 'string', description: 'A [s#.#] marker from a computer_ui read; a stale one is reported as unavailable.' },
          automation_id: { type: 'string', description: 'Exact AutomationId.' },
          name: { type: 'string', description: 'Substring of the accessible name.' },
          control_type: { type: 'string', description: "Control type to require, e.g. 'Edit'." },
          class_name: { type: 'string', description: 'Exact window class.' },
          index: { type: 'integer', description: 'Which match when several do, 0-based (default 0).' },
          hwnd: { type: 'integer', description: "Window to look in; defaults to this read's window." },
        },
      },
      max_text_chars: { type: 'integer', description: 'Character budget shared by every text field of this read (default 2000, maximum 16000).' },
      max_selected: { type: 'integer', description: 'How many selected items `text.selected` lists (default 20, maximum 100).' },
      captures: {
        type: 'string',
        enum: ['self', 'related'],
        description: "Also capture pixels: 'self' (with screenshot: true) is that window, 'related' captures the window *and* the windows that belong to it — a dialog, a popup menu, a tool window — one frame each, which is how a popup that is its own window becomes visible in the same reply as the tree. Needs `hwnd`; popups come first, two frames by default and three at most, and every frame has its own frame id.",
      },
      max_captures: { type: 'integer', description: "With captures: 'related', how many frames to take (default 2, maximum 3)." },
    },
    output: {
      schema: UIA_STATE_SCHEMA,
      render: (args, value) => {
        const blocks = [{ type: 'text', text: renderState(value, args?.compact !== false) }];
        // B02: a window this conversation has already read as degraded or unavailable says so
        // here, so the next read is *interpreted* instead of trusted blindly. Deliberately
        // scoped to this window: another window of the same application gets its own probe,
        // because one unreadable panel is not a statement about the application.
        const known = capabilityNote(value.window?.hwnd, value.window?.process, value.window?.pid);
        if (known !== '') blocks.push({ type: 'text', text: known });
        // A read that declined to walk the tree says so in its own words (skip_if_degraded).
        if (typeof value.note === 'string' && value.note !== '') blocks.push({ type: 'text', text: value.note });
        if (value.frames !== undefined) {
          blocks.push({ type: 'text', text: `${value.frames.length} related frame(s), popup first: ${value.frames.map((frame) => `[${frame.frame}] ${frame.relation} z=${frame.zRankKnown === true ? frame.zRank : 'unknown'} hwnd=${frame.windowHwnd} ${frame.width}x${frame.height}`).join('; ')}` });
          for (const frame of value.frames) {
            if (frame.image !== undefined) blocks.push({ type: 'image', attachment: frame.image });
          }
          if (Array.isArray(value.omitted) && value.omitted.length > 0) {
            blocks.push({ type: 'text', text: `not captured: ${value.omitted.map((one) => `hwnd ${one.hwnd} — ${one.reason}`).join('; ')}` });
          }
        }
        if (value.shot === undefined) return blocks;
        blocks.push({ type: 'text', text: screenshotEnvelope(value.shot) });
        if (value.shot.image === undefined) {
          blocks.push({ type: 'text', text: value.shot.note ?? `The image is at ${value.shot.path}.` });
          return blocks;
        }
        blocks.push({ type: 'image', attachment: value.shot.image });
        return blocks;
      },
    },
    async execute(args, exec) {
      requireGrant(exec);
      // The one path that may decline to read: the caller said this probe is optional, and this
      // window was already found degraded or unavailable recently. It answers with that
      // conclusion (and how old it is) instead of paying for the same expensive walk again.
      if (args.skip_if_degraded === true && Number.isFinite(Number(args.hwnd)) && Number(args.hwnd) !== 0) {
        const known = capabilityForHwnd(args.hwnd, String(exec?.agent?.session?.id ?? ''));
        if (known !== undefined && known.state !== 'available' && Date.now() - known.observedAt < PROFILE_COOLDOWN_MS) {
          const ageS = Math.round((Date.now() - known.observedAt) / 1000);
          return {
            window: { hwnd: Number(args.hwnd), title: '', process: String(known.app), pid: Number(known.pid ?? 0) },
            nodes: [],
            truncated: false,
            searched: false,
            mode: 'skipped-degraded',
            digest: '',
            walked: 0,
            skipped: 0,
            note: `this window was read as ${known.state} ${ageS}s ago (${known.evidence}), and skip_if_degraded was set, so the tree was not walked again. Leave that argument out to read it anyway (asking is itself evidence), or work from a capture instead.`,
          };
        }
      }
      const search = [args.filter, args.name, args.control_type, args.automation_id].some((value) => typeof value === 'string' && value !== '');
      const textTarget = normalizeTextTarget(args.text_target);
      const treeArgs = {
        hwnd: args.hwnd,
        filter: args.filter,
        name: args.name,
        controlType: args.control_type,
        automationId: args.automation_id,
        patterns: args.patterns,
        skipEmpty: args.skip_empty,
        prune: args.prune,
        since: args.since,
        settleMs: args.settle_ms,
        // B1: the text this read is about travels with it, on one shared budget.
        text: args.text,
        textTarget,
        maxTextChars: args.max_text_chars,
        maxSelected: args.max_selected,
        maxDepth: Math.min(10, Math.max(1, args.max_depth ?? 5)),
        maxNodes: Math.min(1500, Math.max(10, args.max_nodes ?? 250)),
        // §7.4 第 2 条: the traversal budget, separate from the node budget. Left unset unless
        // the caller names it, so no existing read becomes truncated by this feature; the
        // worker derives a generous default of its own and says when it was hit.
        ...(Number.isFinite(Number(args.max_visited)) && Number(args.max_visited) >= 0
          ? { maxVisited: Math.min(200000, Math.max(0, Math.floor(Number(args.max_visited)))) }
          : {}),
      };
      let result = await call(exec, 'uitree', treeArgs, { timeoutMs: Math.max(actionTimeoutMs, 45_000) });
      // A tree served by the MSAA bridge is not this window's tree. The worker says so; the
      // process is replaced and the read is retried once, because a worker that is serving the
      // bridge for a process stays that way and every later read would be a different, poorer
      // view of the same window.
      let restarted = false;
      if (result.legacy === true && Date.now() - lastLegacyRestartMs > 60_000) {
        // Once a minute at most: a genuinely legacy application answers this way for every read,
        // and replacing the worker each time would turn a diagnosis into a thrash.
        lastLegacyRestartMs = Date.now();
        await restartBackend();
        restarted = true;
        result = await call(exec, 'uitree', treeArgs, { timeoutMs: Math.max(actionTimeoutMs, 45_000) });
      }
      let cachedShot;
      // A related capture on a read (8.txt §7): the tree of the window the caller named plus
      // one frame per window that belongs to it. The frames ride the same reply, so "the
      // menu is open — which item is where" stays one call.
      let relatedFrames;
      let relatedOmitted;
      if (args.captures === 'related') {
        if (!Number.isFinite(Number(args.hwnd)) || Number(args.hwnd) <= 0) {
          throw new Error("[BAD_REQUEST] captures: 'related' needs `hwnd`: it captures that window and the windows that belong to it.");
        }
        const related = await call(exec, 'screenshot', {
          window: Number(args.hwnd),
          captures: 'related',
          maxCaptures: args.max_captures,
          path: args.save_path,
          scale: args.scale,
          format: resolveFormat(args.format, args.save_path),
          settleMs: args.settle_ms,
        }, { timeoutMs: Math.max(actionTimeoutMs, 45_000) });
        relatedFrames = [];
        for (const one of Array.isArray(related?.captures) ? related.captures : []) {
          const frameType = one.format === 'jpeg' ? 'image/jpeg' : 'image/png';
          const frameAdmitted = await captureService.admit(ctx, one.path, frameType, one.format === 'jpeg' ? 'screen.jpg' : 'screen.png', exec?.agent?.session?.id);
          await reportAttachment(exec, one, frameAdmitted);
          const entry = {
            frame: String(one.frame ?? ''),
            windowHwnd: Number(one.windowHwnd ?? args.hwnd),
            relation: String(one.relation ?? 'self'),
            x: Number(one.x ?? 0),
            y: Number(one.y ?? 0),
            width: Number(one.width ?? 0),
            height: Number(one.height ?? 0),
            path: String(one.path ?? ''),
          };
          if (Number.isFinite(Number(one.ownerHwnd))) entry.ownerHwnd = Number(one.ownerHwnd);
          if (Number.isFinite(Number(one.zRank))) entry.zRank = Number(one.zRank);
          entry.zRankKnown = one.zRankKnown === true;
          if (typeof one.windowTitle === 'string' && one.windowTitle !== '') entry.windowTitle = one.windowTitle;
          if (Number.isFinite(Number(one.imageWidth))) entry.imageWidth = Number(one.imageWidth);
          if (Number.isFinite(Number(one.imageHeight))) entry.imageHeight = Number(one.imageHeight);
          if (Number.isFinite(Number(one.effectiveScale ?? one.scale))) entry.scale = Number(one.effectiveScale ?? one.scale);
          if (typeof one.source === 'string' && one.source !== '') entry.source = one.source;
          if (typeof one.note === 'string' && one.note !== '') entry.note = one.note;
          if (frameAdmitted?.image !== undefined) entry.image = frameAdmitted.image;
          refs.noteFrame(exec?.agent?.session?.id, entry.frame);
          relatedFrames.push(entry);
        }
        if (relatedFrames.length === 0) {
          const why = (Array.isArray(related?.omitted) ? related.omitted : []).map((one) => `hwnd ${one.hwnd}: ${one.reason}`).join('; ');
          throw new Error(`[CAPTURE_SURFACE_UNAVAILABLE] hwnd ${Number(args.hwnd)} and the windows that belong to it could not be captured${why === '' ? '' : ` — ${why}`}.`);
        }
        if (Array.isArray(related.omitted) && related.omitted.length > 0) relatedOmitted = related.omitted.map((row) => ({ ...row }));
      }
      if (args.screenshot === true) {
        const format = resolveFormat(args.format, args.save_path);
        // The tree and the pixels have to be of the same thing. A read of hwnd 42 that
        // returned a picture of the screen was two observations in one reply, and the
        // second one was whatever happened to be in front.
        const viaWindow = Number.isFinite(Number(args.hwnd)) && Number(args.hwnd) > 0;
        const { shot, path } = await capture(exec, {
          path: args.save_path,
          scale: args.scale,
          format,
          window: viaWindow ? Number(args.hwnd) : undefined,
          settleMs: args.settle_ms,
        });
        const mediaType = shot.format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const admitted = await captureService.admit(ctx, path, mediaType, shot.format === 'jpeg' ? 'screen.jpg' : 'screen.png', exec?.agent?.session?.id);
        await reportAttachment(exec, shot, admitted);
        cachedShot = { shot, admitted };
      }
      const value = stateValue(result, search, cachedShot);
      if (relatedFrames !== undefined) {
        value.frames = relatedFrames;
        if (relatedOmitted !== undefined) value.omitted = relatedOmitted;
      }
      if (value.shot !== undefined) refs.noteFrame(exec?.agent?.session?.id, value.shot.frame);
      if (restarted) {
        value.note = result.legacy === true
          ? 'the worker was restarted because it was answering through the legacy accessibility bridge, and this read still came back from it; treat the control types and ids as approximate'
          : 'the worker was answering through the legacy accessibility bridge and was restarted; this tree comes from the replacement';
      }
      // The key names the read, so a delta against one snapshot is not mistaken for a
      // repeat of the full read with the same selectors.
      markObservation(exec, `ui|${value.window.hwnd}|${value.mode}|${args.filter ?? ''}|${args.name ?? ''}|${args.control_type ?? ''}|${args.automation_id ?? ''}|${args.max_depth ?? ''}|${args.max_nodes ?? ''}|${args.patterns ?? ''}|${args.skip_empty ?? ''}|since=${args.since ?? ''}|prune=${args.prune ?? ''}|text=${args.text === undefined ? 'off' : JSON.stringify(args.text)}|tt=${textTarget === undefined ? '' : 'set'}|mtc=${args.max_text_chars ?? ''}`, value);
      // The refs in this read now belong to this conversation: acting on one from
      // another conversation is refused before it can pin an element nobody here chose.
      refs.noteSnapshot(exec?.agent?.session?.id, value.snapshot);
      return value;
    },
  }));

  safeRegister(defineTracedTool({
    name: 'computer_ui_action',
    description:
      "Act on a window through Windows UI Automation instead of moving the mouse: invoke a button, set an edit field's value, read it back, read a document's text, select text inside one, scroll an item into view, toggle a checkbox, select a list item, expand a menu, or focus a control. This is far more reliable than clicking pixels, handles off-screen controls, sets Chinese text correctly, and works without stealing the user's focus, so prefer it whenever computer_ui can identify the control. Requires 电脑操作.",
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: `One of: ${UIA_ACTION_LIST.map((a) => `'${a}'`).join(', ')}. The window actions ('close'/'minimize'/'maximize'/'restore') go through the window pattern: no foreground needed, no synthesized input — unlike alt+F4. 'legacy_action' fires the MSAA default action, the only way into some older controls. The same list is available inside computer_actions as step actions, so anything that works here works as a step there.`,
      },
      hwnd: { type: 'integer', description: 'Window handle from computer_windows. Omit to act inside the window that currently has focus.' },
      ref: {
        type: 'string',
        description:
          "The [s#.#] marker computer_ui printed next to a node: that exact element, pinned to the read that produced it. The window is read again and the element is matched by its ancestor path, automation id, control type and position, so it survives a tree that moved underneath you; the receipt reports `reresolved` when it was found somewhere other than where it was read, and `drift` in pixels. A ref from before a worker restart, or from a pruned snapshot, is refused with [STALE_REF] rather than re-guessed.",
      },
      automation_id: { type: 'string', description: "Exact AutomationId, as reported by computer_ui. The most stable selector when present." },
      name: { type: 'string', description: 'Case-insensitive substring of the accessible name, e.g. "保存" or "Save".' },
      control_type: { type: 'string', description: "Control type to require, e.g. 'Button', 'Edit', 'ListItem', 'MenuItem', 'TabItem', 'Document'." },
      class_name: { type: 'string', description: 'Exact window class of the control, as reported by computer_ui — a last resort when a control has neither a name nor an automation id.' },
      index: { type: 'integer', description: 'Which match to use when several match, 0-based (default 0).' },
      value: { type: 'string', description: "The text to write for 'set_value'." },
      text: { type: 'string', description: "For 'select_text': the text to locate inside the element." },
      prefix: { type: 'string', description: "For 'select_text': text that must appear immediately before the match, to pick the right occurrence when the string repeats. An ambiguous match is refused rather than resolved to the first hit." },
      suffix: { type: 'string', description: "For 'select_text': text that must appear immediately after the match." },
      selection_type: { type: 'string', enum: ['text', 'cursor_before', 'cursor_after'], description: "For 'select_text': select the match (default), or collapse onto its start/end to place the caret there." },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          value: { type: 'string' },
          truncated: { type: 'boolean' },
          verified: { type: 'boolean' },
          rect: {
            type: 'object',
            additionalProperties: false,
            description: "For 'click_text': the screen rectangle of the matched text range — what was actually clicked.",
            properties: {
              x: { type: 'integer', required: true },
              y: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
            },
          },
          matched: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              name: { type: 'string', required: true },
              controlType: { type: 'string', required: true },
              automationId: { type: 'string', required: true },
              x: { type: 'integer', required: true },
              y: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              patterns: { type: 'array', required: true, items: { type: 'string' } },
            },
          },
          ref: { type: 'string' },
          reresolved: { type: 'boolean' },
          drift: { type: 'integer' },
          resolvedVia: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const type = value.matched.controlType.replace('ControlType.', '');
        const label = value.matched.name ? `"${value.matched.name}"` : `(unnamed ${type})`;
        const centre = value.matched.width > 0
          ? ` centre=(${Math.round(value.matched.x + value.matched.width / 2)},${Math.round(value.matched.y + value.matched.height / 2)})`
          : '';
        // The ref moved: say so on every receipt, because the caller pinned a position
        // and got a different one. It is the difference between "it worked" and "it
        // worked on the element that is there now".
        const moved = value.reresolved === true
          ? ` (the ref's element had moved: re-resolved ${value.drift === undefined ? '' : `${value.drift}px `}from where it was read)`
          : '';
        if (value.action === 'get_value') {
          return [{ type: 'text', text: `${type} ${label}${centre} currently holds: ${value.value ?? ''}${moved}` }];
        }
        if (value.action === 'set_value') {
          // Report what the control holds now, not what was asked for: those differ
          // exactly when the write did not take, which is the case worth surfacing.
          const write = value.verified === true
            ? `Set ${type} ${label}${centre} to ${JSON.stringify(value.value ?? '')}.`
            : `Asked ${type} ${label}${centre} to hold ${JSON.stringify(value.value ?? '')}, but the control reports something else now — read it back with get_value before relying on it.`;
          return [{ type: 'text', text: `${write}${moved}` }];
        }
        if (value.action === 'get_text') {
          const note = value.truncated === true ? ' (truncated)' : '';
          return [{ type: 'text', text: `${type} ${label}${centre} text${note}:\n${value.value ?? ''}` }];
        }
        if (value.action === 'select_text') {
          return [{ type: 'text', text: `Selected ${JSON.stringify(value.value ?? '')} in ${type} ${label}${centre}.${moved}` }];
        }
        if (value.action === 'get_caret') {
          const where = value.rect === undefined ? '' : ` at (${value.rect.x},${value.rect.y})`;
          const line = value.value === '' ? '' : ` on line: ${value.value}`;
          return [{ type: 'text', text: `Caret${where}${line}` }];
        }
        if (value.action === 'click_text' || value.action === 'locate_text') {
          const where = value.rect === undefined ? '' : ` at (${Math.round(value.rect.x + value.rect.width / 2)},${Math.round(value.rect.y + value.rect.height / 2)})`;
          const verb = value.action === 'click_text' ? 'Clicked' : 'Located';
          return [{ type: 'text', text: `${verb} ${JSON.stringify(value.value ?? '')}${where} inside ${type} ${label}.${moved}` }];
        }
        return [{ type: 'text', text: `${value.action} on ${type} ${label}${centre} succeeded.${moved}` }];
      },
    },
    async execute(args, exec) {
      requireGrant(exec);
      const action = String(args.action ?? '').toLowerCase();
      if (!UIA_ACTION_LIST.includes(action)) {
        throw new Error(`[BAD_REQUEST] computer_ui_action needs one of ${UIA_ACTION_LIST.join(', ')}; got '${args.action ?? ''}'`);
      }

      if (args.ref === undefined && args.automation_id === undefined && args.name === undefined && args.control_type === undefined && args.class_name === undefined) {
        throw new Error('[BAD_REQUEST] computer_ui_action needs at least one selector: ref, automation_id, name, control_type, or class_name.');
      }
      // A ref is pinned to the read that minted it, and a read belongs to one
      // conversation. Refusing a foreign ref here is what keeps "this exact element" from
      // meaning "this exact element in someone else's window".
      refs.assertRefOwnership(exec?.agent?.session?.id, args.ref);
      if (action === 'set_value' && typeof args.value !== 'string') {
        throw new Error("[BAD_REQUEST] computer_ui_action with action 'set_value' needs a value.");
      }
      if (action === 'select_text' && typeof args.text !== 'string') {
        throw new Error("[BAD_REQUEST] computer_ui_action with action 'select_text' needs the text to locate.");
      }
      const result = await call(exec, 'uiact', {
        action,
        hwnd: args.hwnd,
        ref: args.ref,
        automationId: args.automation_id,
        name: args.name,
        controlType: args.control_type,
        className: args.class_name,
        index: args.index ?? 0,
        value: args.value,
        text: args.text,
        prefix: args.prefix,
        suffix: args.suffix,
        selectionType: args.selection_type,
      }, { interactive: true, timeoutMs: Math.max(actionTimeoutMs, 45_000) });
      const outcome = {
        action: result.action,
        matched: {
          name: String(result.matched?.name ?? ''),
          controlType: String(result.matched?.controlType ?? 'ControlType.Unknown'),
          automationId: String(result.matched?.automationId ?? ''),
          x: Number(result.matched?.x ?? 0),
          y: Number(result.matched?.y ?? 0),
          width: Number(result.matched?.width ?? 0),
          height: Number(result.matched?.height ?? 0),
          patterns: Array.isArray(result.matched?.patterns) ? result.matched.patterns.map((p) => String(p)) : [],
        },
      };
      // `value` is added only for the actions where it means something. It must be
      // omitted rather than set to undefined: a present-but-undefined key still
      // fails a `type: 'string'` check, because the host validates the object it
      // received and not a JSON round-trip of it.
      if (action === 'get_value' || action === 'set_value' || action === 'get_text' || action === 'select_text' || action === 'click_text' || action === 'locate_text' || action === 'get_caret') {
        outcome.value = String(result.value ?? '');
      }
      // A write that reports success and did not happen is the failure the caller is
      // least equipped to notice, so set_value reads the control back and says whether
      // the control now holds what it was asked to hold. A mismatch is reported rather
      // than refused: fields legitimately transform what they are given (uppercasing,
      // masking, truncation), and the actionable fact is what it holds now.
      if (action === 'set_value') {
        outcome.verified = outcome.value === String(args.value ?? '');
      }
      if (action === 'get_text') outcome.truncated = result.truncated === true;
      if ((action === 'click_text' || action === 'locate_text' || action === 'get_caret') && result.rect !== undefined && result.rect !== null) {
        outcome.rect = {
          x: Number(result.rect.x ?? 0),
          y: Number(result.rect.y ?? 0),
          width: Number(result.rect.width ?? 0),
          height: Number(result.rect.height ?? 0),
        };
      }
      // Only present when the action was addressed by ref, and only when the element
      // was actually found somewhere other than where the ref was read.
      if (typeof result.ref === 'string' && result.ref !== '') {
        outcome.ref = result.ref;
        if (result.reresolved === true) {
          outcome.reresolved = true;
          outcome.drift = Number(result.drift ?? 0);
        }
        // How the ref was re-found: `automation-id` means one provider query answered it,
        // `tree-walk` means the window's tree had to be read. Useful when a ref action
        // feels slow, and it is the measurable half of "don't fetch the tree twice".
        if (typeof result.resolvedVia === 'string' && result.resolvedVia !== '') outcome.resolvedVia = result.resolvedVia;
      }
      return outcome;
    },
  }));

  safeRegister(defineTracedTool({
    name: 'computer_clipboard',
    description:
      'Read the system clipboard, write text to it, or clear it. This is the reliable way to get text *out* of an application: select it, copy it with computer_key, then read it here — far better than trying to read rendered pixels. Requires 电脑操作.',
    parameters: {
      op: { type: 'string', required: true, enum: ['get', 'set', 'clear'], description: "The operation: 'get' returns the current text, 'set' replaces it with `text`, 'clear' empties it." },
      text: { type: 'string', description: "For 'set': the text to put on the clipboard." },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          op: { type: 'string', required: true },
          text: { type: 'string' },
          length: { type: 'integer', required: true },
          truncated: { type: 'boolean' },
        },
      },
      render: (_args, value) => {
        if (value.op === 'set') return [{ type: 'text', text: `The clipboard now holds ${value.length} character(s).` }];
        if (value.op === 'clear') return [{ type: 'text', text: 'The clipboard was cleared.' }];
        if (value.length === 0) return [{ type: 'text', text: 'The clipboard holds no text.' }];
        const note = value.truncated === true ? ` (truncated — the clipboard holds more than ${value.length} characters)` : '';
        return [{ type: 'text', text: `clipboard${note}:\n${value.text ?? ''}` }];
      },
    },
    async execute(args, exec) {
      requireGrant(exec);
      const op = String(args.op ?? '').toLowerCase();
      if (!['get', 'set', 'clear'].includes(op)) throw new Error(`[BAD_REQUEST] computer_clipboard needs op 'get', 'set' or 'clear'; got '${args.op ?? ''}'`);
      if (op === 'set' && typeof args.text !== 'string') throw new Error("[BAD_REQUEST] computer_clipboard with op 'set' needs text.");
      const result = await call(exec, 'clipboard', { op, text: args.text });
      const value = { op: String(result.op ?? op), length: Number(result.length ?? 0) };
      if (op === 'get') {
        value.text = String(result.text ?? '');
        value.truncated = result.truncated === true;
      }
      return value;
    },
  }));

  safeRegister(defineTracedTool({
    name: 'computer_paste',
    description:
      "Put text into the focused control by pasting rather than typing: typing sends each character as a synthesized keystroke, which some editors and any IME-hostile app mangle, while a paste is one atomic gesture and the only dependable way to move a long or non-ASCII string. The user's clipboard is borrowed and put back, and `restoreStatus` says which of the six outcomes happened — including \"something else wrote to the clipboard after us, so its newer content was kept\". `require_restore: true` refuses instead of pasting when the clipboard cannot be put back; `verify` with a readable control confirms the text arrived rather than only that keys were sent. Focus the target field first (click it, or computer_ui_action with 'focus'). Requires 电脑操作.",
    parameters: {
      text: { type: 'string', required: true, description: 'The text to paste.' },
      restore: { type: 'boolean', description: "Put the user's previous clipboard content back afterwards (default true). Set false if you are about to read what you pasted, or to keep your text on the clipboard for a later paste." },
      require_restore: { type: 'boolean', description: "Refuse before writing anything when the clipboard cannot be saved and put back (another application holds it open, or it holds formats this path cannot restore). For when the user's clipboard matters more than this paste; the default acts and reports what happened." },
      verify: {
        type: 'object',
        additionalProperties: false,
        description: 'A control to read back after the paste, turning "the events were sent" into a postcondition: the reply says whether the pasted text is in it. Same shape as computer_ui\'s text_target. Without it the caller only learns that the keys went out.',
        properties: {
          ref: { type: 'string', description: 'A [s#.#] marker from a computer_ui read.' },
          automation_id: { type: 'string' },
          name: { type: 'string' },
          control_type: { type: 'string' },
          class_name: { type: 'string' },
          index: { type: 'integer' },
          hwnd: { type: 'integer', description: 'Window to read in; defaults to into_hwnd.' },
        },
      },
      into_hwnd: { type: 'integer', description: 'Only send if this window (an hwnd from computer_windows) is the one that would receive it; a mismatch is refused before anything is sent. Same guard as computer_type.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pasted: { type: 'integer', required: true },
          restored: { type: 'boolean', required: true },
          savedUser: { type: 'boolean', required: true },
          restoreStatus: {
            type: 'string',
            required: true,
            enum: ['restored', 'not_requested', 'skipped_external_change', 'unsupported_original_format', 'failed_busy', 'failed_other'],
            description: 'What happened to the clipboard: `restored` (borrowed content is back), `not_requested` (restore was off), `skipped_external_change` (somebody wrote to it after us, so their newer content was kept), `unsupported_original_format` (the original was an image/files/markup that this path cannot put back), `failed_busy` (another application held it open), `failed_other`.',
          },
          restoreNote: { type: 'string', description: 'The sentence behind a restore_status that is not `restored`.' },
          eventsSent: { type: 'integer', required: true, description: 'Keyboard events the paste actually delivered — 0 means nothing was sent.' },
          foreground: { type: 'string', required: true },
          clipboard: {
            type: 'object',
            additionalProperties: false,
            required: true,
            description: 'The clipboard sequence numbers this borrow was judged against: the change from `seqBefore` to `seqAfterWrite` is our write, and any further change is somebody else\'s.',
            properties: {
              formatsBefore: { type: 'array', items: { type: 'string' }, required: true },
              seqBefore: { type: 'integer', required: true },
              seqAfterWrite: { type: 'integer', required: true },
            },
          },
          pasteVerification: {
            type: 'object',
            additionalProperties: false,
            description: 'Present when `verify` named a control to read back.',
            properties: {
              status: { type: 'string', required: true, enum: ['verified', 'absent', 'unknown'] },
              source: { type: 'string' },
              note: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => {
        const lines = [`Pasted ${value.pasted} character(s) into ${value.foreground} (${value.eventsSent} key event(s) sent).`];
        const restore = value.restoreStatus ?? (value.restored ? 'restored' : 'failed_other');
        const wording = {
          restored: "The user's previous clipboard content was restored.",
          not_requested: 'The clipboard was left holding the pasted text (restore was off).',
          skipped_external_change: "The clipboard was NOT restored: something else wrote to it after this paste, and that newer content was left in place rather than deleted.",
          unsupported_original_format: "The clipboard was NOT fully restored: what was there before was not text this path can put back.",
          failed_busy: 'The clipboard could NOT be restored: another application was holding it open. It now holds the pasted text.',
          failed_other: 'The clipboard could NOT be restored: the write failed.',
        };
        lines.push(wording[restore] ?? `Clipboard restore: ${restore}.`);
        if (value.restoreNote !== undefined) lines.push(value.restoreNote);
        if (value.pasteVerification !== undefined) {
          const verification = value.pasteVerification;
          if (verification.status === 'verified') lines.push(`Verified: ${verification.note ?? 'the pasted text is in the control'}.`);
          else if (verification.status === 'absent') lines.push('NOT verified: the control was read and the pasted text is not in it — the paste did not arrive.');
          else lines.push(`Not verified: ${verification.note ?? 'the control could not be read back'}.`);
        }
        lines.push('A paste lands wherever the keyboard focus is; without `verify` the reply cannot confirm it arrived.');
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    async execute(args, exec) {
      requireGrant(exec);
      if (typeof args.text !== 'string' || args.text === '') throw new Error('[BAD_REQUEST] computer_paste needs the text to paste.');
      const verify = normalizeTextTarget(args.verify);
      const result = await call(exec, 'paste', {
        intoHwnd: args.into_hwnd,
        text: args.text,
        restore: args.restore,
        requireRestore: args.require_restore === true ? true : undefined,
        verify,
      }, { interactive: true });
      const fg = result.foreground ?? {};
      const value = {
        pasted: Number(result.pasted ?? 0),
        restored: result.restored === true,
        savedUser: result.savedUser === true,
        restoreStatus: String(result.restoreStatus ?? (result.restored === true ? 'restored' : 'failed_other')),
        eventsSent: Number(result.eventsSent ?? result.events ?? 0),
        foreground: `${fg.title ? `"${fg.title}"` : '(untitled window)'}${fg.process ? ` [${fg.process}]` : ''}`,
        clipboard: {
          formatsBefore: Array.isArray(result.clipboard?.formatsBefore) ? result.clipboard.formatsBefore.map((one) => String(one)) : [],
          seqBefore: Number(result.clipboard?.seqBefore ?? -1),
          seqAfterWrite: Number(result.clipboard?.seqAfterWrite ?? -1),
        },
      };
      if (typeof result.restoreNote === 'string' && result.restoreNote !== '') value.restoreNote = result.restoreNote;
      if (result.pasteVerification !== undefined && result.pasteVerification !== null) {
        value.pasteVerification = {
          status: String(result.pasteVerification.status ?? 'unknown'),
          ...(typeof result.pasteVerification.source === 'string' && result.pasteVerification.source !== '' ? { source: result.pasteVerification.source } : {}),
          ...(typeof result.pasteVerification.note === 'string' && result.pasteVerification.note !== '' ? { note: result.pasteVerification.note } : {}),
        };
      }
      return value;
    },
  }));

  safeRegister(defineTracedTool({
    name: 'computer_launch',
    description:
      'Start an application and return the window it opened, so the next call can act on it: this is how a task that needs "open the editor" gets started without shelling out. `target` accepts an executable path, a name on PATH, a Start-menu display name (including a localized one such as 计算器, 微信), or an installed app name. Requires 电脑操作.',
    parameters: {
      target: { type: 'string', required: true, description: 'What to start. Examples: "notepad", "C:\\Program Files\\App\\App.exe", "计算器", "Photoshop".' },
      arguments: { type: 'array', items: { type: 'string' }, description: 'Optional command-line arguments, as separate strings.' },
      wait_seconds: { type: 'number', description: 'How long to wait for the application to show a window (default 8, maximum 30). Many apps open their window well after the process starts.' },
      refresh_discovery: { type: 'boolean', description: 'Rebuild the Start-menu, app-table and usage caches before resolving (default false). They are kept for 60–120 s, which is what makes a fuzzy name cheap to resolve; refresh after installing something.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          resolvedAs: { type: 'string', required: true },
          file: { type: 'string', required: true },
          pid: { type: 'integer', required: true },
          process: { type: 'string', required: true },
          hwnd: { type: 'integer', required: true },
          title: { type: 'string', required: true },
          waitedMs: { type: 'integer', required: true },
          matchedBy: { type: 'string', required: true },
          note: { type: 'string', required: true },
          label: { type: 'string', description: 'The display name this resolved to (a Start-menu entry or an installed app), when it was not a plain path.' },
          source: { type: 'string', description: "How it was found: 'path', 'command' (a PATH lookup or an explicit command line), 'shortcut' (a Start-menu entry), 'start-app-path' (a classic app the shell lists) or 'store' (a packaged app, started through the shell)." },
          matchBasis: { type: 'string', description: "Why this resolution won: 'explicit path', 'explicit command', 'on PATH', 'exact name' or 'name match'." },
          wasRunning: { type: 'boolean', required: true, description: 'Whether it was already running when it was launched — what explains a launch that handed off to an existing instance.' },
          useCount: { type: 'integer', required: true, description: 'How often the shell remembers switching to this application. Read `useCountKnown`: 0 with useCountKnown false means "no usable history", not "never used".' },
          useCountKnown: { type: 'boolean', required: true },
          candidates: {
            type: 'array',
            description: 'The other applications the name matched, with the same signals. Present when a fuzzy name had runners-up — worth a look when the launch opened something you did not expect.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                label: { type: 'string', required: true },
                source: { type: 'string', required: true },
                matchBasis: { type: 'string', required: true },
                isRunning: { type: 'boolean', required: true },
                useCount: { type: 'integer', required: true },
                useCountKnown: { type: 'boolean', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const lines = [`Started ${value.process} (pid ${value.pid}) as a ${value.resolvedAs}: ${value.file}`];
        if (value.label !== undefined && value.label !== value.file) lines.push(`Resolved through ${value.source ?? 'a name'}: "${value.label}"${value.matchBasis === undefined ? '' : ` (${value.matchBasis})`}.`);
        if (value.hwnd !== 0) {
          lines.push(`Its window: hwnd=${value.hwnd} "${value.title}" — pass this hwnd to computer_windows, computer_ui or the batch's focus step to act on it.`);
        } else {
          lines.push('No window appeared within the wait.');
        }
        if (value.process === 'ApplicationFrameHost') {
          lines.push('That process name is the host Windows gives packaged (Store) apps, not the app itself — act on the window handle, not on the process name.');
        }
        if (value.note !== '') lines.push(value.note);
        if (value.wasRunning === true) lines.push('It was already running, so this launch may have handed off to that instance rather than starting a new one.');
        lines.push(value.useCountKnown === true
          ? `The shell remembers ${value.useCount} switch(es) to it.`
          : 'No usable shell history for it (that is not the same as never used).');
        if (Array.isArray(value.candidates) && value.candidates.length > 0) {
          lines.push(`Other candidates the name matched: ${value.candidates.map((one) => `"${one.label}" (${one.source}${one.isRunning ? ', running' : ''}${one.useCountKnown ? `, used ${one.useCount}x` : ''})`).join('; ')} — if the wrong application opened, name one of these exactly.`);
        }
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    async execute(args, exec) {
      requireGrant(exec);
      if (typeof args.target !== 'string' || args.target.trim() === '') throw new Error('[BAD_REQUEST] computer_launch needs a target.');
      const result = await call(exec, 'launch', {
        target: args.target,
        arguments: Array.isArray(args.arguments) ? args.arguments.map((a) => String(a)) : undefined,
        waitSeconds: args.wait_seconds,
        refresh: args.refresh_discovery === true ? true : undefined,
      }, { timeoutMs: Math.max(actionTimeoutMs, 40_000) });
      const value = {
        resolvedAs: String(result.resolvedAs ?? ''),
        file: String(result.file ?? ''),
        pid: Number(result.pid ?? 0),
        process: String(result.process ?? ''),
        hwnd: Number(result.hwnd ?? 0),
        title: String(result.title ?? ''),
        waitedMs: Number(result.waitedMs ?? 0),
        matchedBy: String(result.matchedBy ?? ''),
        note: String(result.note ?? ''),
        wasRunning: result.wasRunning === true,
        useCount: Number(result.useCount ?? 0),
        useCountKnown: result.useCountKnown === true,
      };
      // A browser this plugin started is the one instance whose provenance is known (§10): the
      // debugging flags it was launched with are recorded here, so `browser_state` and
      // `browser_actions` can attach to it without anything having to be configured.
      const launchArgs = Array.isArray(args.arguments) ? args.arguments.map((one) => String(one)) : [];
      const portFlag = launchArgs.find((one) => one.startsWith('--remote-debugging-port='));
      const dirFlag = launchArgs.find((one) => one.startsWith('--user-data-dir='));
      if (portFlag !== undefined || dirFlag !== undefined) {
        const port = portFlag === undefined ? 0 : Number.parseInt(portFlag.slice('--remote-debugging-port='.length), 10);
        managedBrowsers.set(String(exec?.agent?.session?.id ?? ''), {
          endpoint: Number.isFinite(port) && port > 0 ? `http://127.0.0.1:${port}` : '',
          port: Number.isFinite(port) ? port : 0,
          profileDir: dirFlag === undefined ? '' : dirFlag.slice('--user-data-dir='.length),
          pid: Number(result.pid ?? 0),
        });
      }
      if (typeof result.label === 'string' && result.label !== '') value.label = result.label;
      if (typeof result.source === 'string' && result.source !== '') value.source = result.source;
      if (typeof result.matchBasis === 'string' && result.matchBasis !== '') value.matchBasis = result.matchBasis;
      if (Array.isArray(result.candidates) && result.candidates.length > 0) {
        value.candidates = result.candidates.map((one) => ({
          label: String(one?.label ?? ''),
          source: String(one?.source ?? ''),
          matchBasis: String(one?.matchBasis ?? ''),
          isRunning: one?.isRunning === true,
          useCount: Number(one?.useCount ?? 0),
          useCountKnown: one?.useCountKnown === true,
        }));
      }
      return value;
    },
  }));

  safeRegister(defineTracedTool({
    name: 'computer_stop',
    description:
      "Release any mouse button or key this session is still holding down, and optionally hand the capability back to the user. Use it when a gesture was interrupted — a drag that never got its release leaves the desktop holding a button the user cannot shake off. Calling it with disable_capability turns 电脑操作 off for this session, after which every computer_* call is refused until the user switches the chip back on: that is a kill switch, not a pause. Requires 电脑操作.",
    parameters: {
      release_input: { type: 'boolean', description: 'Release anything still held down (default true).' },
      disable_capability: { type: 'boolean', description: 'Also turn the capability off for this session, so nothing can drive the desktop until the user re-enables it (default false).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          released: { type: 'array', required: true, items: { type: 'string' } },
          count: { type: 'integer', required: true },
          note: { type: 'string', required: true },
          disabled: { type: 'boolean' },
          cancelled: { type: 'integer' },
          releaseConfirmed: { type: 'boolean', description: 'Whether the worker confirmed that the input it was holding was released. The capability being off and the input being released are two different facts (§8.4).' },
          releaseError: { type: 'string', description: 'Why the release could not be confirmed, when it could not. A stop that reports success while a key may still be down is the one answer a user must never get.' },
        },
      },
      render: (_args, value) => {
        // Everything the stop actually established, said one fact at a time. The old version
        // printed "Nothing was held down." from `count`, so a release that *failed* — whose
        // reason was already in `note` — read as a clean stop (§8.4, evidence HOST03).
        const lines = [];
        if (value.disabled === true) lines.push('电脑操作 is now OFF for this session; ask the user to click the 电脑操作 chip to enable it again.');
        if (value.count === 0) {
          lines.push(value.releaseConfirmed === false
            ? 'Nothing was confirmed released: the worker was asked to unwind any held input and that did not succeed.'
            : 'Nothing was held down.');
        } else {
          lines.push(`Released: ${value.released.join(', ')}.`);
        }
        if (value.releaseConfirmed === false) {
          lines.push(`Release not confirmed: ${value.releaseError ?? value.note}`);
          lines.push('A key or a mouse button may still be down: click once yourself, or press and release shift, before doing anything else, and check the input state again.');
        }
        if (value.cancelled !== undefined && value.cancelled > 0) lines.push(`${value.cancelled} request(s) that were still running or queued were cancelled, so the steps after this point did not run.`);
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    async execute(args, exec) {
      requireGrant(exec);
      const value = { released: [], count: 0, note: 'nothing was held down' };
      if (args.disable_capability === true) {
        // Turning it off is a stop, not a flag: revoke first, then cancel what is in
        // flight, then unwind anything the worker is still holding. Reporting "off" while
        // a batch is still clicking would be the worst kind of lie about a safety control.
        const outcome = await revokeSession(exec?.agent?.session?.id, 'the capability was turned off by computer_stop');
        value.released = outcome.released;
        value.count = outcome.released.length;
        value.note = outcome.error === '' ? 'the session was revoked and the desktop was unwound' : `the session was revoked, but releasing held input failed: ${outcome.error}`;
        value.disabled = true;
        value.cancelled = outcome.cancelled;
        // The release result is its own fact (§8.4): "the capability is off" and "the input
        // was confirmed released" are two different answers, and the renderer needs the
        // second one separately or it ends up printing a success it never verified.
        value.releaseConfirmed = outcome.error === '';
        if (outcome.error !== '') value.releaseError = outcome.error;
        ctx.logger?.info?.('computer-use: session %s was disabled by computer_stop (%d cancelled)', sessionKey(exec?.agent?.session?.id), outcome.cancelled);
        return value;
      }
      if (args.release_input !== false) {
        try {
          const result = await call(exec, 'release', {}, { timeoutMs: Math.max(actionTimeoutMs, 10_000) });
          value.released = Array.isArray(result.released) ? result.released.map((r) => String(r)) : [];
          value.count = Number(result.count ?? value.released.length);
          value.note = String(result.note ?? value.note);
          value.releaseConfirmed = true;
        } catch (failure) {
          // A release that failed is reported as failed. Saying "nothing was held down"
          // because the answer never arrived is the one outcome a user must never be given
          // about a key or a button that may still be down (§8.4).
          value.note = `releasing held input failed: ${failure?.message ?? failure}`;
          value.releaseConfirmed = false;
          value.releaseError = String(failure?.message ?? failure);
        }
      }
      return value;
    },
  }));

  /* ----------------------------------------------------------------- routes -- */

  /**
   * Current capability snapshot for one Session.
   * @param sessionId - the Session the chip is mounted in.
   * @returns the JSON payload the chip renders.
   */
  const statePayload = (sessionId) => ({
    ok: true,
    plugin: '@local/dsh-computer-use',
    version: VERSION,
    buildId: release.buildId,
    label: LABEL,
    platform: process.platform,
    supported: SUPPORTED,
    ...SUPPORTED ? {} : { reason: UNSUPPORTED_REASON },
    defaultEnabled,
    // An unsupported platform can never be enabled, whatever the grant says; the
    // chip reads `supported` first and never shows an on state it cannot honour.
    enabled: SUPPORTED && isEnabled(sessionId),
    // What the control is doing, in the states a user has to be able to tell apart:
    // 仅观察 / 可操作 / 执行中 / 停止中 / 已停止 (plus 未开启). A single on/off bit cannot
    // express "stopping", which is exactly the state a user needs to see after pressing
    // stop on something that is mid-batch.
    control: controlState(sessionId),
    backend: backend === null
      ? { started: false }
      : { started: true, alive: backend.alive, outstanding: backend.outstanding, dpi: backend.info?.dpi, screens: backend.info?.screens, generation: backend.info?.generation },
  });

  // The chip's routes need a web server, but the tools must not. Registering
  // through a scoped inject means a profile without one still gets computer
  // control, and a profile that gains or replaces its web server re-registers
  // these routes without restarting the plugin.
  ctx.inject(['webServer'], (scoped) => {
    scoped.effect(
      () => scoped.webServer.register({
        kind: 'exact',
        path: `${ROUTE}/status`,
        handler: (req, res) => sendJson(res, 200, { ...statePayload(undefined), runtime: runtimeSummary(), note: 'host half of the 电脑操作 capability is loaded' }),
      }),
      'computer-use: status route',
    );

    scoped.effect(
      () => scoped.webServer.register({
        kind: 'exact',
        path: `${ROUTE}/state`,
        handler: async (req, res) => {
          try {
            const url = new URL(req.url ?? ROUTE, 'http://127.0.0.1');
            if (req.method === 'GET') {
              sendJson(res, 200, statePayload(url.searchParams.get('sessionId') ?? undefined));
              return;
            }
            if (req.method === 'POST') {
              const body = await readJsonBody(req);
              const sessionId = body.sessionId ?? url.searchParams.get('sessionId') ?? undefined;
              if (typeof body.enabled !== 'boolean') {
                sendJson(res, 400, { ok: false, error: 'enabled must be a boolean' });
                return;
              }
              if (sessionId === undefined || sessionId === null || String(sessionId) === '') {
                sendJson(res, 400, { ok: false, error: 'sessionId is required' });
                return;
              }
              if (!SUPPORTED && body.enabled === true) {
                sendJson(res, 409, { ok: false, error: UNSUPPORTED_REASON, supported: false });
                return;
              }
              if (body.enabled === true) {
                sessions.grant(sessionId);
                // Turning it on is also what un-hides the tool schemas for that session.
                // `activate` and not a bare `sync(agentOf(...))`: when no live agent is
                // registered for this session the restriction is lifted anyway. A chip the
                // user has switched on must not be able to leave its tools hidden just
                // because the agent was never registered (see schema-visibility.mjs).
                const visibilityAfter = visibility.activate(sessionKey(sessionId));
                ctx.logger?.info?.('computer-use: session %s grant -> true (schemas %s)', sessionKey(sessionId), SUPPORTED ? visibilityAfter : 'n/a');
                // Turning the capability on is the moment the user has said yes; get
                // the worker ready now rather than inside the model's first click.
                warmBackend();
                sendJson(res, 200, { ...statePayload(sessionId), toolSchemas: SUPPORTED ? visibilityAfter : null });
                return;
              }
              // Turning it off is a stop, not a bookkeeping change: revoke, cancel what is
              // in flight, and unwind what the worker is still holding — and only report
              // the new state once that has actually happened.
              const outcome = await revokeSession(sessionId, 'the user turned 电脑操作 off');
              // …and with the capability off, its schemas stop riding along in every request.
              const visibilityAfter = visibility.deactivate(sessionKey(sessionId));
              ctx.logger?.info?.('computer-use: session %s grant -> false (%d cancelled, %d released)%s', sessionKey(sessionId), outcome.cancelled, outcome.released.length, outcome.error === '' ? '' : `, release failed: ${outcome.error}`);
              sendJson(res, 200, { ...statePayload(sessionId), toolSchemas: SUPPORTED ? visibilityAfter : null, revoked: { cancelled: outcome.cancelled, released: outcome.released, error: outcome.error === '' ? null : outcome.error } });
              return;
            }
            sendJson(res, 405, { ok: false, error: 'use GET or POST' });
          } catch (error) {
            sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
          }
        },
      }),
      'computer-use: state route',
    );

    scoped.effect(
      () => scoped.webServer.register({
        kind: 'exact',
        path: `${ROUTE}/probe`,
        handler: async (req, res) => {
          try {
            const url = new URL(req.url ?? ROUTE, 'http://127.0.0.1');
            const sessionId = url.searchParams.get('sessionId') ?? undefined;
            const instance = await ensureBackend();
            const info = await instance.request('ping', {}, { timeoutMs: startTimeoutMs });
            // The pacing policy and the transport's long-tail counters ride along, because
            // both decide how a call feels and neither is visible from a capture: a policy
            // that still polls for five seconds, and a queue that has been timing out and
            // restarting the worker, look the same from the outside otherwise.
            const pacing = await instance.request('pacing', {}, { timeoutMs: startTimeoutMs }).then((report) => report.after, () => null);
            // §7.4 item 7: the COM boundary's own census. Whether a long session accumulates
            // UI Automation objects is a number here rather than a guess in a comment.
            const health = await instance.request('health', {}, { timeoutMs: startTimeoutMs }).catch(() => null);
            sendJson(res, 200, {
              ok: true,
              enabled: isEnabled(sessionId),
              dpi: info.dpi,
              screens: info.screens,
              virtual: info.virtual,
              cursor: info.cursor,
              pacing,
              comObjects: health?.comObjects ?? null,
              transport: instance.stats ?? null,
              outstanding: instance.outstanding ?? 0,
            });
          } catch (error) {
            sendJson(res, 503, { ok: false, error: backendMessage(error) });
          }
        },
      }),
      'computer-use: backend probe route',
    );

    // 只读自检：不启动 worker、不碰桌面、不改状态，所以用户报告问题的当下就能跑。
    // 它存在的理由见 internal/doctor.mjs 的文件头——这一类故障的特征就是"界面上什么都没有"。
    scoped.effect(
      () => scoped.webServer.register({
        kind: 'exact',
        path: `${ROUTE}/doctor`,
        handler: (req, res) => {
          try {
            const url = new URL(req.url ?? ROUTE, 'http://127.0.0.1');
            const sessionId = url.searchParams.get('sessionId') ?? undefined;
            sendJson(res, 200, {
              ...collectDoctorReport({
                mode: 'host',
                supported: SUPPORTED,
                platform: process.platform,
                version: VERSION,
                packageRoot: PACKAGE_ROOT,
                host,
                release,
                defaultEnabled,
                registrationFailures,
                registeredToolNames,
                schemaVisibility: {
                  enabled: visibility.enabled,
                  liveAgents: visibility.liveAgentCount(),
                  restrictedSessions: visibility.restrictedCount(),
                },
                backend: backend === null
                  ? null
                  : {
                    started: true,
                    alive: backend.alive,
                    generation: backend.info?.generation ?? null,
                    pid: Number(backend.info?.pid ?? 0),
                  },
                hideToolSchemasWhenOff: config.hideToolSchemasWhenOff !== false,
                // 这份报告长在宿主进程里，所以 peer 依赖那一条在这里才是真判定。
                insideHost: true,
              }),
              session: sessionId === undefined
                ? null
                : {
                  sessionId,
                  enabled: SUPPORTED && isEnabled(sessionId),
                  toolSchemas: visibility.toolSchemaState(sessionKey(sessionId)),
                },
            });
          } catch (error) {
            sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
          }
        },
      }),
      'computer-use: doctor route',
    );
  });

  /**
   * Drop captures belonging to this process when the plugin unloads. Leaves the
   * directory itself alone — the user may have asked for a screenshot inside the
   * workspace, and deleting a whole directory the plugin does not exclusively own
   * would be rude.
   */
  ctx.effect(() => () => {
    backend?.dispose();
    backend = null;
    // The isolated read worker is a second process this plugin started, so it is a second
    // process this plugin has to stop (A10).
    readBackend?.dispose();
    readBackend = null;
    // §A: free the host-wide ownership slot. A later mount (after a profile change or a test
    // teardown) must be able to claim it instead of being reported as a duplicate forever.
    releaseOwnership();
    void (async () => {
      try {
        // 登记表里的先删 —— 包括"抓完了还没交给任何会话"的残渣。
        await captureService.releaseAll().catch(() => {});
        const { readdir } = await import('node:fs/promises');
        // 兜底：本进程此前产出的、没进登记表的残留。
        const entries = await readdir(shotRoot).catch(() => []);
        await Promise.all(entries
          .filter((entry) => entry.includes(`capture-${process.pid}-`))
          .map((entry) => rm(join(shotRoot, entry), { force: true }).catch(() => {})));
        // worker 落在系统临时目录的关联帧（它拿不到截图目录的那些路径）。
        await releaseStrayFrames({ olderThanMs: 0 });
        // 本实例的标记目录（cancel / held-input 的 flag 文件）。
        await rm(instanceRoot, { recursive: true, force: true }).catch(() => {});
      } catch {
        /* best effort */
      }
    })();
  }, 'computer-use: backend lifetime');
}
