/**
 * Node-side bridge to the long-lived PowerShell backend.
 *
 * The worker is spawned once on first use and then answers one JSON line per
 * request, so the ~1s cost of `Add-Type` compiling the P/Invoke helpers is paid
 * a single time per host process rather than per action. A crashed or exited
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
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCRIPT = join(HERE, 'worker.ps1');
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
 * One long-lived `powershell -File worker.ps1` conversation.
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
  #child = null;
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
  /** Resolves when the process this backend killed has actually exited. */
  #exitPromise = null;
  /** Where the worker mirrors held input, so a force-kill can release it (§6 item 4). */
  #heldFilePath;
  /** What the last force-kill's independent release said. */
  #lastRelease = null;
  constructor(options = {}) {
    this.#script = options.scriptPath ?? DEFAULT_SCRIPT;
    this.#command = options.powerShell ?? resolvePowerShell();
    this.#defaultTimeoutMs = options.timeoutMs ?? 30_000;
    // Startup is slower than any single command (Add-Type compiles the P/Invoke helpers
    // once), so it gets its own budget. It is a real option rather than a constant because
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
    if (this.#ready !== null && (this.#state === 'starting' || this.#state === 'ready')) return this.#ready;
    // A worker was killed to break a stuck call: wait for that process to be gone before
    // binding a new request to anything (§5.12: 超时后等待旧实例退出或隔离).
    if (this.#state === 'stopping') await this.#exited();
    if (this.#disposed) throw new ComputerUseBackendError('the computer-use backend has been disposed', 'DISPOSED');
    if (!existsSync(this.#script)) {
      throw new ComputerUseBackendError(`computer-use worker script not found at ${this.#script}`, 'NO_WORKER_SCRIPT');
    }
    // A stale marker from an earlier worker would cancel this one's first request.
    this.#clearCancelFile();
    this.#state = 'starting';
    const child = spawn(
      this.#command,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.#script],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, DSH_COMPUTER_USE_CANCEL_FILE: this.#cancelFilePath, DSH_COMPUTER_USE_HELD_FILE: this.#heldFilePath },
      },
    );
    this.#child = child;
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
      this.#failReady(new ComputerUseBackendError(`${detail}: ${this.#stderrText()}`, 'WORKER_EXITED'));
      this.#failOutstanding(new ComputerUseBackendError(`${detail}: ${this.#stderrText()}`, 'WORKER_EXITED'));
      this.#teardown();
    });

    return this.#ready;
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
   * Kill one worker process. Its `exit` handler rejects anything still pending
   * and clears the handle, so the next `start()` spawns a fresh backend.
   *
   * §6 item 4: a killed worker never reaches the `finally` that unwinds held input, so before
   * the kill this asks an *independent* process (`backend/release-input.ps1`) to release exactly
   * what the worker recorded as held. The outcome is kept on the backend (`lastRelease`) and
   * attached to the requests the kill rejects, because "the worker was stopped" and "the input
   * was released" are two different facts and the caller has to be able to tell them apart.
   *
   * @param child - the process to stop; defaults to the current one.
   * @returns a promise for the process actually being gone.
   */
  async #stopChild(child = this.#child) {
    if (child === null || child === undefined) return Promise.resolve();
    if (!this.#disposed) this.#state = 'stopping';
    await this.#releaseHeldInput();
    try {
      if (child.exitCode === null) child.kill();
    } catch {
      /* the process is already gone */
    }
    return this.#exited(child);
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
        child = spawn(this.#command, [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
          '-File', RELEASE_SCRIPT, '-StateFile', this.#heldFilePath,
        ], { windowsHide: true });
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
   */
  #exited(child = this.#child) {
    if (this.#exitPromise !== null) return this.#exitPromise;
    if (child === null || child === undefined || child.exitCode !== null) return Promise.resolve();
    const wait = new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, 2_000);
      timer.unref?.();
      child.once('exit', finish);
      child.once('error', finish);
    });
    this.#exitPromise = wait.finally(() => {
      if (this.#exitPromise === wait) this.#exitPromise = null;
    });
    return this.#exitPromise;
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
    else entry.reject(error);
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

  /** Reject everything queued or in flight — used when the worker dies or is disposed. */
  #failOutstanding(error) {
    const queued = this.#queue.splice(0);
    for (const entry of queued) this.#settle(entry, error, undefined);
    for (const entry of [...this.#pending.values()]) this.#finish(entry, error);
    this.#runningId = null;
  }

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
      this.#finish(entry, new ComputerUseBackendError('the computer-use worker is not running', 'WORKER_EXITED'));
      return this.#pump();
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
      // §6 item 4: a killed worker never runs the `finally` that unwinds held input, so the
      // independent release runs *before* the process goes away -- and what it managed to do is
      // reported with the failure. The caller can then tell "the worker was stopped" from "the
      // mouse button you were holding was released". The wait is bounded and skipped entirely
      // when the worker recorded nothing held, which is the ordinary case.
      void this.#releaseHeldInput().then((release) => {
        if (release !== null && release !== undefined) {
          error.releaseConfirmed = release.releaseConfirmed === true;
          error.released = Array.isArray(release.released) ? release.released : [];
          if (release.releaseError !== undefined) error.releaseError = String(release.releaseError);
        }
        this.#finish(entry, error);
        // The next request waits for this process to be gone before it binds to an instance.
        void this.#stopChild();
      });
    }, entry.timeoutMs);
    try {
      child.stdin.write(line);
    } catch (error) {
      this.#finish(entry, new ComputerUseBackendError(`could not write to the computer-use worker: ${error.message}`, 'WRITE_FAILED'));
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
      this.#settle(entry, error, undefined);
      return;
    }
    this.#stats.cancelled += 1;
    this.#touchCancelFile(String(entry.id));
    const error = new ComputerUseBackendError(`${reason}; ${entry.cmd} had already been dispatched, so the worker was told to stop at the next step boundary`, 'CANCELLED');
    error.dispatched = true;
    this.#settle(entry, error, undefined);
    // The worker is single-threaded: a blocking Win32 or UI Automation call inside
    // it can only be stopped by stopping it. Give it the grace period to finish
    // unwinding (it releases held input on the way out) and then end the process.
    entry.graceTimer = setTimeout(() => {
      if (this.#pending.has(entry.id)) {
        this.#stderr.push(`\ncancel: ${entry.cmd} (id ${entry.id}) did not stop within ${this.#cancelGraceMs} ms; stopping the worker\n`);
        this.#stopChild();
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
      settledCaller: false,
      timer: null,
      graceTimer: null,
      onAbort: undefined,
      timeoutMs: options.timeoutMs ?? this.#defaultTimeoutMs,
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
    this.#failOutstanding(new ComputerUseBackendError('the computer-use backend was disposed', 'DISPOSED'));
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
