/**
 * Node-side bridge to the long-lived compiled desktop backend.
 *
 * The worker is spawned once on first use and then answers one JSON line per
 * request. The normal path starts dsh-worker.exe directly without a script host
 * or runtime source compilation. A crashed or exited
 * worker is discarded and respawned on the next request; requests that were in
 * flight when it died reject with a clear error instead of hanging.
 *
 * Three properties this file is responsible for, because nothing downstream can
 * restore them once they are lost:
 *
 *   1. **A cancelled call is not executed later.** Cancelling has to run through
 *      the queue as well as the running request. The worker speaks one request at
 *      a time, so anything still queued here has never been written to it: that
 *      request is dropped and rejected as "nothing was sent to the desktop". A
 *      request that *was* already written is cancelled in the worker (a marker
 *      file it polls between steps, see `cancelFilePath`) and, if the worker does
 *      not come back within `cancelGraceMs`, the process is stopped rather than
 *      left driving the desktop.
 *   2. **A failed startup is recoverable.** A readiness timeout used to leave the
 *      rejected readiness promise in place, so every later call failed instantly
 *      with the same stale error and the capability never came back. A timed-out
 *      start now tears the process down and resets the state, so the next call
 *      really is a fresh attempt.
 *   3. **The caller is never told an unknown outcome is a failed one.** A timeout
 *      on a request that was already dispatched is tagged `dispatched = true`,
 *      because replaying a click or a paste that may have happened is a different
 *      (and worse) mistake than not replaying one that did not.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { buildBlockedDiagnostic, classifySecurityBlock } from '../internal/security-block.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createExitWaiter } from '../internal/generation.mjs';
import { DELIVERY, INTERRUPTION, annotateError, createReceipt } from '../internal/receipt.mjs';
import { Generation, STOP_BUDGETS, stopGeneration } from './supervisor.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCRIPT = join(HERE, 'dsh-worker.exe');
/** The independent release path a force-kill uses before the worker goes away (§6 item 4). */
const RELEASE_SCRIPT = join(HERE, 'release-input.ps1');
/** How long that path may take. It sends two events; anything slower is not helping. */
const RELEASE_TIMEOUT_MS = 4_000;

/**
 * Candidate PowerShell hosts live in `internal/powershell.mjs` so that a reader which only wants to
 * *know* where PowerShell is — the doctor — does not have to load this module, and with it the whole
 * backend: spawn, readline, temp files. Re-exported here because this is where the transport uses it.
 */
export { POWERSHELL_CANDIDATES, resolvePowerShell } from '../internal/powershell.mjs';
import { resolvePowerShell } from '../internal/powershell.mjs';

/** Raised when the backend cannot start or dies mid-request. */
export class ComputerUseBackendError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ComputerUseBackendError';
    this.code = code;
    /**
     * Whether the request had already been handed to the worker when this failed.
     *
     * The distinction is the whole value of this flag: a call that was never
     * written cannot have moved the desktop, so retrying it is free, while a call
     * that was dispatched may or may not have acted, and only an observation can
     * tell the difference. Deployments must not turn the second case into a blind
     * retry.
     */
    this.dispatched = false;
  }
}

/** A per-process path the worker polls for cancellation, so no two workers share one. */
function defaultCancelFilePath() {
  return join(tmpdir(), `dsh-computer-use-cancel-${process.pid}-${randomBytes(4).toString('hex')}.flag`);
}

/**
 * One long-lived native worker conversation. The historical class name remains
 * an API alias; only explicit developer fixtures select a PowerShell host.
 *
 * Timeout invariant: `#defaultTimeoutMs` must stay longer than the worker's
 * longest single blocking operation, otherwise a legitimate slow command would be
 * killed by the transport instead of answering. The worker's worst case is a key
 * hold, capped at 10 s, plus process scheduling — comfortably inside the 20 s
 * default. Commands that can run longer than that (UI Automation walks, deep
 * window trees) pass an explicit `timeoutMs`.
 */
export class PowerShellBackend {
  #script;
  #command;
  #legacyFixture = false;
  #child = null;
  /** 进程创建的注入点（方案 4.1：把 spawn 放在边界适配器上，核心状态测试用可控驱动）。 */
  #spawn;
  /** 当前这一代 worker（方案 4.4 / PR06）：身份、状态与停止报告都挂在它上面。 */
  #generation = null;
  #nextGeneration = 1;
  /** 最近一次**经 supervisor 的**停止报告（超时、取消宽限到期、显式停止）。 */
  #lastStopReport = null;
  /** 停止预算，可由构造参数覆盖；报告里带每一步的实际耗时。 */
  #stopBudgets = STOP_BUDGETS;
  /** 正在重启的过程中，避免 #pump 反复触发。 */
  #restarting = false;
  /** 正在进行的停止（六步协议），让"重启新代"能先等旧的停完。 */
  #stopPromise = null;
  /** id -> entry for requests that have been written to the worker. */
  #pending = new Map();
  /** Requests accepted but not written yet: the part of the queue a cancel can still drop. */
  #queue = [];
  #runningId = null;
  #nextId = 1;
  #ready = null;
  #info = null;
  #lines = null;
  #stderr = [];
  #defaultTimeoutMs;
  #startTimeoutMs;
  /**
   * Long-tail counters for the transport.
   *
   * An average hides every one of these and each is a cost a caller really pays at the
   * tail: a queued request waited behind another one (the worker is single-threaded, so a
   * five-second capture delays everything after it), a timeout also costs a restart, and a
   * restart costs the next request the worker's whole cold start. Read by tests and by the
   * host's diagnostics; nothing here changes behaviour.
   */
  #stats = { requests: 0, dispatched: 0, timeouts: 0, cancelled: 0, spawns: 0, queuedMs: 0, workerMs: 0 };
  #disposed = false;
  #cancelFilePath;
  #cancelGraceMs;
  /**
   * Where this backend is in its own lifecycle (9.txt §5.12).
   *
   * `starting` and `ready` are the two states a request may bind to; `stopping` means a
   * worker was killed (a timeout, a cancel that would not unwind) and its process is still
   * on its way out, so a new request waits for it instead of writing into a dying pipe.
   */
  #state = 'idle';
  /** 等待"被停掉的那一代真的退出了"（按 child 识别，见 internal/generation.mjs）。 */
  #exitWaiter = createExitWaiter();
  /** Where the worker mirrors held input, so a force-kill can release it (§6 item 4). */
  #heldFilePath;
  /** What the last force-kill's independent release said. */
  #lastRelease = null;
  constructor(options = {}) {
    this.#script = options.executablePath ?? options.scriptPath ?? DEFAULT_SCRIPT;
    // Explicit legacy fixtures remain usable by developer tests; production always uses the EXE.
    this.#legacyFixture = options.powerShell != null || /\.ps1$/i.test(this.#script);
    this.#spawn = typeof options.spawn === 'function' ? options.spawn : spawn;
    this.#stopBudgets = { ...STOP_BUDGETS, ...(options.stopBudgets ?? {}) };
    this.#command = this.#legacyFixture ? (options.powerShell ?? resolvePowerShell()) : this.#script;
    this.#defaultTimeoutMs = options.timeoutMs ?? 30_000;
    // Startup includes CLR initialization and security scanning, so it gets its
    // own budget. It is a real option rather than a constant because
    // the timeout path is exactly the one that has to be exercised by a test, and a test
    // cannot wait thirty seconds to watch a failure recover.
    this.#startTimeoutMs = Number.isFinite(options.startTimeoutMs)
      ? Math.max(1, options.startTimeoutMs)
      : Math.max(this.#defaultTimeoutMs, 30_000);
    this.#cancelFilePath = options.cancelFilePath ?? defaultCancelFilePath();
    this.#cancelGraceMs = Number.isFinite(options.cancelGraceMs) ? Math.max(100, options.cancelGraceMs) : 2_000;
    // §6 item 4: where the worker mirrors what it is holding, and what the last independent
    // release managed to do. The file name rides on the same per-instance identity as the
    // cancel file, so two backends in one process can never release each other's input (§6 ⑧).
    this.#heldFilePath = options.heldFilePath ?? `${this.#cancelFilePath}.held.json`;
  }

  /** Metadata reported by the worker at startup (DPI mode, monitors, pid, generation). */
  get info() {
    return this.#info;
  }

  /** Whether a live worker is currently answering. */
  get alive() {
    return this.#child !== null && this.#child.exitCode === null && !this.#disposed;
  }

  /** The lifecycle state, for diagnostics and for the tests that exercise it. */
  get state() {
    return this.#state;
  }

  /** How many requests are waiting for the worker, including the one it is running. */
  get outstanding() {
    return this.#queue.length + this.#pending.size;
  }

  /** The marker file the worker watches; the host reports it in diagnostics. */
  get cancelFilePath() {
    return this.#cancelFilePath;
  }

  /** The transport's long-tail counters (see the field's comment), as a copy. */
  get stats() {
    return { ...this.#stats };
  }

  /**
   * Start the worker if it is not running and wait for its readiness line.
   * @returns startup metadata.
   */
  async start() {
    if (this.#disposed) throw new ComputerUseBackendError('the computer-use backend has been disposed', 'DISPOSED');
    // 被安全软件**确认**拦下之后，同一个文件不再拉起：每次重试都会再触发一次扫描，用户只会看到
    // "又失败了"。诊断随错误一起返回，等用户处理完（更新情报/复核版本）再显式清掉。
    if (this.#securityBlock !== null && this.#securityBlock.confidence === 'confirmed') {
      const error = new ComputerUseBackendError(
        `the computer-use worker was blocked by ${this.#securityBlock.vendor} (${this.#securityBlock.errorId || this.#securityBlock.signature})`,
        SECURITY_BLOCK_CODE,
      );
      error.diagnostic = this.#securityBlock;
      throw error;
    }
    if (this.#ready !== null && (this.#state === 'starting' || this.#state === 'ready')) return this.#ready;
    // A worker was killed to break a stuck call: wait for that process to be gone before
    // binding a new request to anything (§5.12: 超时后等待旧实例退出或隔离).
    if (this.#state === 'stopping') await this.#exited();
    if (this.#disposed) throw new ComputerUseBackendError('the computer-use backend has been disposed', 'DISPOSED');
    if (!existsSync(this.#script)) {
      throw new ComputerUseBackendError(`computer-use worker executable not found at ${this.#script}`, 'NO_WORKER_SCRIPT');
    }
    // A stale marker from an earlier worker would cancel this one's first request.
    this.#clearCancelFile();
    this.#state = 'starting';
    const child = this.#spawn(
      this.#command,
      this.#legacyFixture ? ['-NoProfile', '-NonInteractive', '-File', this.#script] : [],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, DSH_COMPUTER_USE_CANCEL_FILE: this.#cancelFilePath, DSH_COMPUTER_USE_HELD_FILE: this.#heldFilePath },
      },
    );
    this.#child = child;
    // 每一代都有自己的身份：进程、取消文件、引用代次都跟着它走，旧代的事件不会被当成新代的。
    this.#generation = new Generation({ id: this.#nextGeneration, child, budgets: this.#stopBudgets });
    this.#nextGeneration += 1;
    this.#generation.markStarting();
    this.#stats.spawns += 1;
    this.#stderr = [];
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      this.#stderr.push(chunk);
      if (this.#stderr.length > 40) this.#stderr.shift();
    });
    // A broken pipe surfaces as an 'error' event on the stream, not as a throw
    // from write(); unhandled it would take the whole host process down.
    child.stdin.on('error', () => {
      /* the exit handler reports it; the caller is rejected there */
    });

    this.#ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new ComputerUseBackendError(
          `the computer-use worker did not start within ${this.#startTimeoutMs} ms: ${this.#stderrText()}`,
          'START_TIMEOUT',
        );
        // The one bug this block exists for: rejecting alone left the failed
        // readiness promise installed, so every later call failed instantly with
        // this same message and the capability never recovered.
        this.#failReady(error);
        this.#failOutstanding(new ComputerUseBackendError('the computer-use worker did not start', 'WORKER_EXITED'));
        this.#stopChild(child);
        this.#teardown();
      }, this.#startTimeoutMs);
      this.#readyTimer = timer;
      this.#readyResolve = resolve;
      this.#readyReject = reject;
    });
    // A synchronous spawn failure (missing executable) surfaces as an 'error' event.
    child.on('error', (error) => {
      if (this.#child !== child) return;
      this.#failReady(new ComputerUseBackendError(`could not spawn ${this.#command}: ${error.message}`, 'SPAWN_FAILED'));
      this.#failOutstanding(new ComputerUseBackendError(`could not spawn ${this.#command}`, 'SPAWN_FAILED'));
      this.#teardown();
    });

    this.#lines = createInterface({ input: child.stdout });
    this.#lines.on('line', (line) => this.#onLine(line));
    child.on('exit', (code, signal) => {
      // Only the worker that is still *this* backend's worker reports its own death.
      // A process killed for a timeout or a cancel is replaced immediately, and its
      // exit event arrives asynchronously — without this guard it would reject the fresh
      // attempt's readiness promise, which is the same "never recovers" bug in a new
      // disguise (the fault-injection test caught exactly that).
      if (this.#child !== child) return;
      const detail = `the computer-use worker exited (code ${code ?? 'null'}${signal ? `, signal ${signal}` : ''})`;
      // 计划内的停止（六步协议正在跑）与"进程自己死了"必须分开：前者里排队的请求**一次都没派发**，
      // 它们属于下一代；后者只能全部失败。方案 4.4 第 6 步就是这条。
      const planned = this.#stopPromise !== null || this.#state === 'stopping';
      this.#failReady(new ComputerUseBackendError(`${detail}: ${this.#stderrText()}`, 'WORKER_EXITED'));
      if (planned) {
        for (const entry of [...this.#pending.values()]) {
          // 已经进入停止路径的请求由那条路径自己结算（超时要报超时、取消要报取消），这里不能
          // 用"worker 退出了"覆盖它的原因。它占用的运行位会在那次停止的 `.then` 里清掉。
          if (entry.stopping === true) continue;
          this.#finish(entry, this.#copyFailure(entry, new ComputerUseBackendError(`${detail}: ${this.#stderrText()}`, 'WORKER_EXITED'), INTERRUPTION.driver_exit));
        }
      } else {
        this.#failOutstanding(new ComputerUseBackendError(`${detail}: ${this.#stderrText()}`, 'WORKER_EXITED'));
      }
      this.#teardown();
      // 方案 4.19.3：被安全软件拦下的同一个文件不再自动重启 —— 换一种 PowerShell 调用方式继续试
      // 同样不会通过，只会把"确定被拦"变成"反复被拦"。诊断留在 `lastSecurityBlock` 里给 status 用。
      this.#recordSecurityBlock({ phase: 'launch', exitCode: code, signal, stderr: this.#stderrText() });
      if (planned && !this.#disposed && this.#queue.length > 0 && this.#securityBlock === null) void this.#restartThenPump();
    });

    return this.#ready;
  }

  /** 最近一次被安全软件拦截的诊断（方案 4.19.3 的 `BackendBlockedBySecurity`）。 */
  #securityBlock = null;
  /** 驱动代次：每次成功拉起 worker 递增，诊断里用它对齐"哪一代被拦"。 */
  #driverGeneration = 0;
  /** 实际工作进程文件的 SHA256（读一次就缓存）：诊断里要能对上具体文件。 */
  #scriptHashCache = null;

  get generation() {
    return this.#driverGeneration;
  }

  get #scriptHash() {
    if (this.#scriptHashCache !== null) return this.#scriptHashCache;
    try {
      this.#scriptHashCache = createHash('sha256').update(readFileSync(this.#script)).digest('hex');
    } catch {
      this.#scriptHashCache = '';
    }
    return this.#scriptHashCache;
  }

  get lastSecurityBlock() {
    return this.#securityBlock;
  }

  /**
   * 显式清除"被拦"的诊断，让下一次启动重新尝试。
   *
   * 只给用户的明确动作调用（例如更新了安全情报并确认版本无误之后）；模型不能靠换一个会话
   * 或重试工具来绕开它。
   */
  clearSecurityBlock() {
    this.#securityBlock = null;
  }

  /**
   * 把这次退出归类：真的被拦才记诊断，并且**只有**在确认被拦时禁止自动重启。
   *
   * @param {object} detail - `{ phase, exitCode, signal, stderr, delivery }`。
   */
  #recordSecurityBlock(detail) {
    const stderr = typeof detail?.stderr === 'string' ? detail.stderr : '';
    if (classifySecurityBlock(stderr).blocked === false) return null;
    this.#securityBlock = buildBlockedDiagnostic({
      phase: detail?.phase ?? 'launch',
      stderr,
      exitCode: detail?.exitCode,
      driverGeneration: this.generation,
      delivery: detail?.delivery,
      scriptHash: this.#scriptHash,
    });
    return this.#securityBlock;
  }

  #readyTimer = null;
  #readyResolve = null;
  #readyReject = null;

  #stderrText() {
    const text = this.#stderr.join('').trim();
    return text === '' ? '(no stderr)' : text.slice(-800);
  }

  #failReady(error) {
    if (this.#readyReject !== null) {
      clearTimeout(this.#readyTimer);
      const reject = this.#readyReject;
      this.#readyReject = null;
      this.#readyResolve = null;
      reject(error);
    }
  }

  #teardown() {
    this.#lines?.close();
    this.#lines = null;
    this.#child = null;
    this.#ready = null;
    this.#readyReject = null;
    this.#readyResolve = null;
    this.#info = null;
    this.#runningId = null;
    // A backend that has been disposed stays disposed; anything else is idle and will start
    // a fresh worker on the next request.
    this.#state = this.#disposed ? 'disposed' : 'idle';
  }

  /**
   * Stop one worker generation through the six-step protocol (方案 4.4 / PR06).
   *
   * 旧实现是"发 shutdown，800 毫秒后 kill"：没有准入关闭、没有协作等待与强制终止的分界，
   * 也分不清"进程真的没了"与"按住的键真的松了"。现在顺序、预算与报告都在
   * `backend/supervisor.mjs` 里，这里只负责把本后端的钩子接上去：
   *
   *   closeAdmission → 拒绝新请求（并可选择把未派发请求记为取消）
   *   waitForDrain   → 协作预算内等在飞请求结束
   *   kill           → 终止受控旧进程
   *   waitForExit    → 按 child 等实际退出（internal/generation.mjs）
   *   release        → 独立释放程序（held-input 清单）
   *   cleanup        → 清取消标记
   *
   * @param child - the process to stop; defaults to the current one.
   * @param options - `{ reason, cancelQueued }`。
   * @returns 停止报告，或 null（没有进程可停）。
   */
  async #stopChild(child = this.#child, options = {}) {
    if (child === null || child === undefined) return null;
    if (!this.#disposed) this.#state = 'stopping';
    const generation = this.#generation !== null && this.#generation.child === child
      ? this.#generation
      : new Generation({ id: 0, child, budgets: this.#stopBudgets });
    // 同一代只跑一次停止；这里再记一个进程外的 promise，好让"重启新代"能先等旧的停完。
    const running = (async () => stopGeneration(generation, {
      reason: options.reason ?? 'the worker was stopped',
      closeAdmission: (reason) => {
        if (!this.#disposed) this.#state = 'stopping';
        if (options.cancelQueued !== true) return 0;
        const queued = this.#queue.splice(0);
        for (const entry of queued) {
          const failure = new ComputerUseBackendError(`${reason}; the request was dropped before dispatch, so nothing was sent to the desktop`, 'ABORTED');
          failure.interruption = INTERRUPTION.cancel;
          this.#settle(entry, failure, undefined);
        }
        return queued.length;
      },
      cancelInFlight: () => {
        // 取消标记由触发停止的那条路径写好（超时不需要，取消路径已经写过）。
        return true;
      },
      waitForDrain: (ms) => this.#drainPending(ms),
      kill: () => {
        try {
          if (child.exitCode === null) child.kill();
        } catch {
          /* the process is already gone */
        }
      },
      waitForExit: () => this.#exitWaiter.waitForExit(child),
      release: () => this.#releaseHeldInput(),
      cleanup: () => this.#clearCancelFile(),
    }))();
    // 同一个身份陷阱（PR04 的教训）：`#stopPromise` 要存 finally 派生的那个 promise，比较的也必须
    // 是它自己，否则引用永远清不掉，"还在停"就会变成永久状态。
    const finalPromise = running.finally(() => {
      if (this.#stopPromise === finalPromise) this.#stopPromise = null;
    });
    this.#stopPromise = finalPromise;
    const report = await running;
    this.#lastStopReport = report;
    return report;
  }

  /**
   * 等旧代停完，再起一代新的，然后继续派发队列里的请求。
   *
   * 旧行为是"上一代停了，队列里所有请求一起以 WORKER_EXITED 失败"：一次超时会让别的会话
   * 排队的调用陪葬，而它们**一次都没写出去**。现在它们被放回队列，在新代上继续跑 —— 这正是
   * 回执里 `not_sent` 的含义（方案 4.5：只有能证明未派发时才允许记录 not_sent）。
   *
   * 失败路径不需要额外的重试风暴：`start()` 自己会在启动失败时把队列判掉。
   */
  async #restartThenPump() {
    if (this.#disposed || this.#restarting) return;
    this.#restarting = true;
    try {
      if (this.#stopPromise !== null) await this.#stopPromise.catch(() => {});
      this.#teardown();
      if (this.#disposed) return;
      this.#state = 'idle';
      await this.start();
    } catch {
      /* start() 已经把队列判掉：这里的失败不再重复报告 */
    } finally {
      this.#restarting = false;
      this.#pump();
    }
  }

  /**
   * 在协作预算内等在飞请求结束。
   * @param ms - 预算。
   * @returns 是否真的清空了。
   */
  async #drainPending(ms) {
    const deadline = Date.now() + Math.max(0, ms);
    const active = () => [...this.#pending.values()].filter((entry) => entry.stopping !== true).length;
    while (active() > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return active() === 0;
  }

  /**
   * 最近一次经 supervisor 的停止报告（超时、取消宽限到期、显式停止）。
   * `dispose()` 走的是宿主卸载时那条更短的路，不在其列。
   */
  get lastStopReport() {
    return this.#lastStopReport;
  }

  /**
   * Ask the independent release path to unwind what the worker recorded as held.
   *
   * Bounded and best effort by design: it runs before a kill, it never throws, and what it could
   * not do is reported rather than assumed away. A worker that recorded nothing held (the
   * ordinary case) costs one `Test-Path` in the child process.
   */
  async #releaseHeldInput() {
    if (this.#heldFilePath === '') return this.#lastRelease;
    if (!existsSync(this.#heldFilePath)) {
      // Nothing was recorded, so nothing is held: no process needed for the common case.
      this.#lastRelease = { releaseConfirmed: true, released: [], releaseError: undefined };
      return this.#lastRelease;
    }
    const started = Date.now();
    const result = await new Promise((resolve) => {
      let child = null;
      let stdout = '';
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        try { child?.kill(); } catch { /* already gone */ }
        finish({ ok: false, released: [], error: `the release did not answer within ${RELEASE_TIMEOUT_MS} ms` });
      }, RELEASE_TIMEOUT_MS);
      timer.unref?.();
      try {
        child = spawn(this.#command, this.#legacyFixture ? [
          '-NoProfile', '-NonInteractive', '-File', RELEASE_SCRIPT, '-StateFile', this.#heldFilePath,
        ] : ['--release-input', this.#heldFilePath], { windowsHide: true });
      } catch (error) {
        finish({ ok: false, released: [], error: String(error?.message ?? error) });
        return;
      }
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk) => { stdout += chunk; });
      child.on('error', (error) => finish({ ok: false, released: [], error: String(error?.message ?? error) }));
      child.on('close', () => {
        const line = stdout.trim().split('\n').filter((one) => one.trim() !== '').pop() ?? '';
        try {
          finish(JSON.parse(line));
        } catch {
          finish({ ok: false, released: [], error: `the release answered nothing that could be read (${line.slice(0, 120)})` });
        }
      });
    });
    this.#lastRelease = {
      releaseConfirmed: result?.ok === true,
      released: Array.isArray(result?.released) ? result.released.map(String) : [],
      releaseError: result?.ok === true ? undefined : String(result?.error ?? 'the release failed'),
      how: 'independent-process',
      ms: Date.now() - started,
    };
    return this.#lastRelease;
  }

  /** What the last force-kill's independent release managed to do (§6 item 4). */
  get lastRelease() {
    return this.#lastRelease;
  }

  /**
   * Wait for the process this backend stopped to be really gone. A killed process still holds
   * its stdin for a moment, and writing a request into that window is how a fresh call lands
   * in a dying instance.
   *
   * 方案 4.4 / PR04：判定逻辑搬到 `internal/generation.mjs` 的等待器里，按 child 识别、同一个
   * child 只挂一份 Promise、结果显式区分 `exited`/`error`/`timeout`/`absent`。原来的写法把
   * `wait.finally(...)` 的返回值存进 `#exitPromise`，却在 finally 里拿 `wait` 去比较，引用永远
   * 清不掉 —— 下一次停止会拿到上一代那个已解析的 Promise，把"没退出"报告成"已退出"。
   *
   * @param child - the process to wait for; defaults to the current one.
   * @returns `'exited' | 'error' | 'timeout' | 'absent'`（2 秒预算用尽即 `timeout`，不等于已退出）。
   */
  #exited(child = this.#child) {
    return this.#exitWaiter.waitForExit(child);
  }

  /** @deprecated use #stopChild; kept for the internal call sites' readability. */
  #abortWorker() {
    this.#stopChild();
  }

  /**
   * Settle one request's caller exactly once, without removing it from `#pending`:
   * the worker's reply (or its death) is still needed to know when it is free again.
   * @param entry - the request.
   * @param error - the failure, or null for success.
   * @param value - the result payload on success.
   */
  #settle(entry, error, value) {
    if (entry === undefined || entry.settledCaller) return;
    entry.settledCaller = true;
    clearTimeout(entry.timer);
    entry.timer = null;
    if (entry.onAbort !== undefined && entry.signal !== undefined) {
      entry.signal.removeEventListener('abort', entry.onAbort);
    }
    if (error === null) entry.resolve(value);
    else entry.reject(this.#annotate(entry, error));
  }

  /**
   * 给一个失败补上回执（方案 4.3 / PR05）。
   *
   * 回执在**离开传输层的那一刻**生成：那时 `entry.delivery` 已经是它最终的样子（没写过 /
   * 写进去了 / 收到了应答 / 不确定），不需要调用方再去猜。已经带 `receipt` 的错误原样返回，
   * 这样更精确的中断原因（超时、取消）不会被这里覆盖。
   *
   * @param entry - 请求。
   * @param error - 失败。
   * @returns 标注后的同一个错误。
   */
  #annotate(entry, error) {
    if (error === null || typeof error !== 'object') return error;
    if (error.receipt !== undefined) return error;
    const timings = {};
    if (Number.isFinite(entry?.queueMs)) timings.queueMs = Math.round(entry.queueMs);
    if (Number.isFinite(entry?.startMs)) timings.startMs = Math.round(entry.startMs);
    if (entry?.sentAt !== null && entry?.sentAt !== undefined) timings.workerMs = Math.round(performance.now() - entry.sentAt);
    return annotateError(error, createReceipt({
      requestId: entry?.id ?? null,
      delivery: entry?.delivery ?? DELIVERY.not_sent,
      interruption: error.interruption ?? INTERRUPTION.none,
      errorCode: error.code ?? null,
      timings,
    }));
  }

  /**
   * 复制一份失败，用于"同一个原因、不同请求"的场景。
   *
   * 旧实现把**同一个** Error 实例拒给所有请求，于是每个请求各自走到了哪一步无从表达（方案 1.2
   * 第四条）。复制时只搬既有语义字段，再按该请求自己的派发状态写回执。
   *
   * @param entry - 这个副本所属的请求。
   * @param error - 原始失败。
   * @param interruption - 该路径的中断原因。
   */
  #copyFailure(entry, error, interruption) {
    const copy = error instanceof ComputerUseBackendError
      ? new ComputerUseBackendError(error.message, error.code)
      : new Error(String(error?.message ?? error));
    for (const key of ['dispatched', 'canceled', 'performed', 'actionSent', 'partial', 'queueMs', 'releaseConfirmed', 'released', 'releaseError', 'stderrTail']) {
      if (error?.[key] !== undefined) copy[key] = error[key];
    }
    copy.interruption = interruption;
    return copy;
  }

  /**
   * Reject everything queued or in flight — used when the worker dies or is disposed.
   *
   * 每个请求拿到的是**独立**的副本：排队的那些还停在 `not_sent`（它们确实没出去），在飞的那一个
   * 可能已经是 `sent_to_driver` 或 `unknown`。这正是方案 4.3 要求"遍历 pending 逐条生成错误回执"
   * 的原因。
   *
   * @param error - the failure to report.
   * @param interruption - `driver_exit`（进程没了）或 `cancel`（主动 dispose）。
   */
  #failOutstanding(error, interruption = INTERRUPTION.driver_exit) {
    const queued = this.#queue.splice(0);
    for (const entry of queued) this.#settle(entry, this.#copyFailure(entry, error, interruption), undefined);
    // 正在走六步停止的那条请求由停止路径自己结算（它要带上超时/取消的原因和停止报告里的
    // 释放事实）。这里若也用"worker 退出了"去覆盖它，回执会把一次超时写成一次进程死亡。
    for (const entry of [...this.#pending.values()]) {
      if (entry.stopping === true) continue;
      this.#finish(entry, this.#copyFailure(entry, error, interruption));
    }
    this.#runningId = null;
  }

  /**
   * The one way a request leaves this transport (9.txt §5.12).
   *
   * It settles the caller, forgets the entry, releases the run slot and clears the cancel
   * grace timer, so no exit path can leave a request that still occupies the worker's slot
   * — which is what used to happen when the arguments could not be serialized: the caller
   * was rejected while `#runningId` stayed set, and every later request queued behind it.
   * @param entry - the request.
   * @param error - the failure, or null for success.
   * @param value - the result payload on success.
   */
  #finish(entry, error, value) {
    if (entry === undefined || entry === null) return;
    if (this.#runningId === entry.id) this.#runningId = null;
    this.#pending.delete(entry.id);
    if (entry.graceTimer !== null && entry.graceTimer !== undefined) {
      clearTimeout(entry.graceTimer);
      entry.graceTimer = null;
    }
    if (error === null || error === undefined) this.#settle(entry, null, value);
    else this.#settle(entry, error, undefined);
  }

  /** Reject everything queued or in flight — the body lives in #failOutstanding above. */

  #onLine(line) {
    const text = line.trim();
    if (text === '') return;
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      // Anything the shell prints outside the protocol is noise, not a response.
      return;
    }
    if (payload.ready === true) {
      this.#info = payload.info ?? {};
      clearTimeout(this.#readyTimer);
      this.#state = 'ready';
      this.#driverGeneration += 1;
      this.#generation?.markReady();
      const resolve = this.#readyResolve;
      this.#readyReject = null;
      this.#readyResolve = null;
      if (resolve !== null) resolve(this.#info);
      return;
    }
    const entry = this.#pending.get(payload.id);
    if (entry === undefined) return;
    if (payload.ok === true) {
      // Transport bookkeeping, attached as a non-enumerable property: a tool's returned
      // value has to survive its declared output schema, and `additionalProperties: false`
      // would reject anything enumerable that the schema does not name. The host reads this
      // explicitly where it reports where a call spent its time.
      const timing = {
        queueMs: Math.round(entry.queueMs ?? 0),
        startMs: Math.round(entry.startMs ?? 0),
        workerMs: Math.round(performance.now() - (entry.sentAt ?? entry.queuedAt)),
        cmd: entry.cmd,
      };
      this.#stats.workerMs += timing.workerMs;
      if (payload.result !== null && typeof payload.result === 'object') {
        try {
          Object.defineProperty(payload.result, '__bridgeTiming', { value: timing, enumerable: false, configurable: true });
        } catch {
          /* a frozen payload loses only the timing, not the result */
        }
      }
      this.#finish(entry, null, payload.result);
    } else {
      // `canceled` is how the worker reports a request it stopped between steps:
      // the caller asked for that stop, so it is reported as a cancellation and
      // not as a failed action.
      const code = payload.canceled === true ? 'CANCELLED' : 'WORKER_ERROR';
      const error = new ComputerUseBackendError(`${entry.cmd} failed: ${payload.error ?? 'unknown error'}`, code);
      error.dispatched = true;
      error.canceled = payload.canceled === true;
      // 收到应答是唯一能证明"驱动确实处理过这条请求"的证据，所以回执在这一刻升到 driver_ack。
      entry.delivery = DELIVERY.driver_ack;
      error.interruption = payload.canceled === true ? INTERRUPTION.cancel : INTERRUPTION.none;
      if (payload.performed !== undefined) error.performed = payload.performed;
      if (payload.actionSent !== undefined) error.actionSent = payload.actionSent === true;
      if (payload.partial !== undefined) error.partial = payload.partial === true;
      this.#finish(entry, error);
    }
    this.#pump();
  }

  /**
   * Write the next queued request, if the worker is free.
   *
   * One request is in the worker at a time, so everything still in `#queue` has
   * not reached the desktop and can be cancelled without any cleanup there.
   */
  #pump() {
    if (this.#disposed) return;
    if (this.#runningId !== null || this.#pending.size > 0) return;
    const entry = this.#queue.shift();
    if (entry === undefined) return;
    if (entry.settledCaller) return this.#pump();
    const child = this.#child;
    if (child === null || child.exitCode !== null) {
      // 方案 4.4 / PR06 第 6 步：未派发的请求属于**下一**代，不该因为上一代被停就一起失败。
      // 把它们放回队列，先把旧的停完、再起一个新 worker，然后继续派发。
      this.#queue.unshift(entry);
      void this.#restartThenPump();
      return;
    }
    // The line is built *before* the run slot is taken. Arguments that cannot be turned
    // into one JSON line used to reject the caller while leaving the slot occupied, so the
    // whole queue stopped advancing (§5.12).
    let line;
    try {
      line = `${JSON.stringify({ id: entry.id, cmd: entry.cmd, args: entry.args })}\n`;
    } catch (error) {
      this.#finish(entry, new ComputerUseBackendError(`the arguments of ${entry.cmd} could not be serialized to send to the worker (${error?.message ?? error}); nothing was sent to the desktop`, 'BAD_REQUEST'));
      return this.#pump();
    }
    // A cancel marker left over from the previous request must not leak into this one.
    this.#clearCancelFile();
    entry.written = true;
    entry.sentAt = performance.now();
    entry.queueMs = Math.max(0, entry.sentAt - entry.queuedAt);
    this.#stats.dispatched += 1;
    this.#stats.queuedMs += Math.round(entry.queueMs);
    this.#runningId = entry.id;
    this.#pending.set(entry.id, entry);
    entry.timer = setTimeout(() => {
      // A blocking Win32 or UI Automation call inside the worker cannot be
      // interrupted from here, and it would otherwise queue every later request
      // behind it. Drop the process; the next request respawns a clean one.
      this.#stats.timeouts += 1;
      const error = new ComputerUseBackendError(`${entry.cmd} did not answer within ${entry.timeoutMs} ms; the backend was restarted`, 'TIMEOUT');
      // Dispatched: the action may or may not have happened. The caller must
      // observe before deciding, never replay blindly.
      error.dispatched = true;
      error.queueMs = Math.round(entry.queueMs);
      // 超时：`sent_to_driver` 说明写入已 flush，`unknown` 说明连这一步都没能确认 —— 两者都不能
      // 记成 not_sent，也都不能重放。中断原因是 timeout，恢复建议因此是 stop（先停再看）。
      error.interruption = INTERRUPTION.timeout;
      // §6 item 4 / 方案 4.4：超时之后走完整的六步停止协议 —— 关闭准入、协作等待、终止、
      // 等实际退出、独立释放、清理，再把**停止报告**里的事实挂到这次失败上。调用方因此能分别
      // 读出"worker 被停了"（stopReport.exitConfirmed）与"按住的键松了"（releaseConfirmed）。
      // 这条请求自己已经被判超时，先标 stopping，让协作等待不必再等它。
      entry.stopping = true;
      void this.#stopChild(child, { reason: `${entry.cmd} did not answer within ${entry.timeoutMs} ms` }).then((report) => {
        if (report !== null) {
          error.releaseConfirmed = report.releaseConfirmed === true;
          error.released = Array.isArray(report.released) ? report.released : [];
          if (report.releaseError !== undefined) error.releaseError = String(report.releaseError);
          error.stopReport = report;
        }
        this.#finish(entry, error);
        // 停止完成、运行位已清：队列里的下一条要去新一代上跑（#pump 会触发重启）。
        this.#pump();
      });
    }, entry.timeoutMs);
    try {
      // 写入回调是"这行字节真的出了本进程"的唯一证据：返回 true 只表示还排在内存缓冲里。
      // 因此在回调成功之前，回执停在 sent_to_driver 之前的状态；回调报错则记为 unknown ——
      // 已经写过就说不清落没落地（方案 4.3：只有能证明未派发时才允许记录 not_sent）。
      child.stdin.write(line, (writeError) => {
        if (writeError) {
          entry.delivery = DELIVERY.unknown;
          return;
        }
        if (entry.delivery === DELIVERY.not_sent) entry.delivery = DELIVERY.sent_to_driver;
      });
    } catch (error) {
      const failure = new ComputerUseBackendError(`could not write to the computer-use worker: ${error.message}`, 'WRITE_FAILED');
      failure.interruption = INTERRUPTION.none;
      this.#finish(entry, failure);
      this.#pump();
    }
  }

  /**
   * Cancel one request: drop it if it was never written, stop it in the worker if
   * it was.
   * @param entry - the request to cancel.
   * @param reason - text for the caller.
   */
  #cancelEntry(entry, reason) {
    if (entry === undefined || entry.settledCaller) return;
    if (entry.written !== true) {
      const at = this.#queue.indexOf(entry);
      if (at >= 0) this.#queue.splice(at, 1);
      // The important half of "cancel": this action never reached the desktop, and
      // it never will — not even after the cancel, which is what a caller assumes.
      const error = new ComputerUseBackendError(`${reason}; the request was dropped before dispatch, so nothing was sent to the desktop`, 'ABORTED');
      error.interruption = INTERRUPTION.cancel;
      this.#settle(entry, error, undefined);
      return;
    }
    this.#stats.cancelled += 1;
    this.#touchCancelFile(String(entry.id));
    const error = new ComputerUseBackendError(`${reason}; ${entry.cmd} had already been dispatched, so the worker was told to stop at the next step boundary`, 'CANCELLED');
    error.dispatched = true;
    error.interruption = INTERRUPTION.cancel;
    this.#settle(entry, error, undefined);
    // The worker is single-threaded: a blocking Win32 or UI Automation call inside
    // it can only be stopped by stopping it. Give it the grace period to finish
    // unwinding (it releases held input on the way out) and then end the process.
    entry.graceTimer = setTimeout(() => {
      if (this.#pending.has(entry.id)) {
        this.#stderr.push(`\ncancel: ${entry.cmd} (id ${entry.id}) did not stop within ${this.#cancelGraceMs} ms; stopping the worker\n`);
        // 宽限到期：走六步停止协议，并把这条请求标成 stopping，让协作等待不再等它。
        entry.stopping = true;
        void this.#stopChild(this.#child, { reason: `${entry.cmd} did not stop within ${this.#cancelGraceMs} ms` }).then(() => {
          // 调用方早已收到 CANCELLED；这里只清掉它占用的运行位，好让队列继续（通常是在新一代上）。
          this.#finish(entry, null);
          this.#pump();
        });
      }
    }, this.#cancelGraceMs);
  }

  /**
   * Cancel everything this backend is doing, queued or in flight.
   * @param reason - text for the callers.
   * @returns how many requests it actually cancelled.
   */
  cancelAll(reason = 'the capability was turned off') {
    const entries = [...this.#queue, ...this.#pending.values()];
    let cancelled = 0;
    for (const entry of entries) {
      const settledBefore = entry.settledCaller;
      this.#cancelEntry(entry, reason);
      if (!settledBefore && entry.settledCaller) cancelled += 1;
    }
    return cancelled;
  }

  /**
   * Cancel one session's requests, queued or in flight, and leave every other session alone.
   *
   * 方案 4.5 / PR07：撤销一个会话时旧实现调用的是 `cancelAll` —— 一个宿主进程只有一个 worker，
   * 于是"关掉会话 A"会把会话 B 正在跑的那次调用一起取消，B 看到的是自己无法解释的中断。
   * 取消是**按会话**的事实，不是按进程的事实。
   *
   * @param sessionKey - 要取消的会话（`''` 是匿名会话；`undefined` 表示不匹配任何会话）。
   * @param reason - text for the callers.
   * @returns how many requests it actually cancelled.
   */
  cancelSession(sessionKey, reason = 'the capability was turned off') {
    if (typeof sessionKey !== 'string') return 0;
    const entries = [...this.#queue, ...this.#pending.values()].filter((entry) => (entry.sessionKey ?? '') === sessionKey);
    let cancelled = 0;
    for (const entry of entries) {
      const settledBefore = entry.settledCaller;
      this.#cancelEntry(entry, reason);
      if (!settledBefore && entry.settledCaller) cancelled += 1;
    }
    return cancelled;
  }

  #touchCancelFile(id) {
    try {
      writeFileSync(this.#cancelFilePath, `${id}\n`, 'utf8');
    } catch {
      /* the marker is best effort: the timeout path still stops the worker */
    }
  }

  #clearCancelFile() {
    try {
      rmSync(this.#cancelFilePath, { force: true });
    } catch {
      /* nothing to clear */
    }
  }

  /**
   * Run one backend command.
   * @param cmd - worker command name.
   * @param args - command arguments (JSON-serializable).
   * @param options - `timeoutMs` override and an optional abort signal.
   * @returns the command's `result` payload.
   */
  async request(cmd, args = {}, options = {}) {
    // §7.5: waiting for the worker to be ready and waiting behind another call are different
    // waits, and only one of them says anything about the command. They are measured apart so
    // a slow *start* cannot be read as a slow UI Automation call.
    const acceptedAt = performance.now();
    await this.start();
    const startMs = Math.max(0, performance.now() - acceptedAt);
    const signal = options.signal;
    if (signal?.aborted === true) {
      const error = new ComputerUseBackendError('the call was cancelled before it was dispatched; nothing was sent to the desktop', 'ABORTED');
      error.interruption = INTERRUPTION.cancel;
      annotateError(error, createReceipt({ delivery: DELIVERY.not_sent, interruption: INTERRUPTION.cancel, errorCode: 'ABORTED' }));
      throw error;
    }
    const id = this.#nextId;
    this.#nextId += 1;
    this.#stats.requests += 1;
    const entry = {
      id,
      cmd,
      args,
      signal,
      written: false,
      // 回执的起点：还没写进管道。`#pump` 在 flush 确认后升到 sent_to_driver，`#onLine` 在应答
      // 到达时升到 driver_ack；任何一步没被确认就停在原地或落到 unknown（方案 4.3）。
      delivery: DELIVERY.not_sent,
      settledCaller: false,
      timer: null,
      graceTimer: null,
      onAbort: undefined,
      timeoutMs: options.timeoutMs ?? this.#defaultTimeoutMs,
      /** 这次请求属于哪个会话（'' 是匿名）。按会话取消只认它，不再波及别的会话（方案 4.5）。 */
      sessionKey: typeof options.sessionKey === 'string' ? options.sessionKey : '',
      // Timestamps for the queue split: accepted here, written to the worker in #pump.
      // Measured with performance.now() rather than the wall clock, because the difference
      // between two of these is a duration and nothing else.
      queuedAt: performance.now(),
      sentAt: null,
      queueMs: 0,
      // How long `start()` took before this request was even in the queue.
      startMs,
      resolve: null,
      reject: null,
    };
    return new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
      if (signal !== undefined && signal !== null) {
        entry.onAbort = () => this.#cancelEntry(entry, 'the call was cancelled');
        signal.addEventListener('abort', entry.onAbort, { once: true });
      }
      this.#queue.push(entry);
      this.#pump();
    });
  }

  /** Stop the worker and reject anything still queued or pending. */
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#state = 'disposed';
    const child = this.#child;
    // A `start()` that is still waiting for its readiness line is a caller too: without this
    // it awaited a promise nothing would ever settle (§5.12).
    this.#failReady(new ComputerUseBackendError('the computer-use backend was disposed while starting', 'DISPOSED'));
    this.#failOutstanding(new ComputerUseBackendError('the computer-use backend was disposed', 'DISPOSED'), INTERRUPTION.cancel);
    if (child !== null && child.exitCode === null) {
      try {
        child.stdin.write(`${JSON.stringify({ id: 0, cmd: 'shutdown', args: {} })}\n`);
      } catch {
        /* the pipe is already gone */
      }
      const killer = setTimeout(() => {
        if (child.exitCode === null) child.kill();
      }, 800);
      killer.unref?.();
      child.once('exit', () => clearTimeout(killer));
    }
    this.#teardown();
    this.#clearCancelFile();
  }
}

export { PowerShellBackend as NativeBackend };
