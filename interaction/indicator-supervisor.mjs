/**
 * 交互提示 helper 的宿主侧（方案 4.15 / PR10）。
 *
 * helper 自己不认识工具、不判定成败；它只回答两件事：**视觉是否真的就绪**、**Esc 是否被按下**。
 * 这一层负责把这两件事接到插件上，并且守住四条：
 *
 *   1. **代次**：每次启动 helper 生成一个 `helperGeneration`，事件里带着它；旧代次的事件一律丢弃，
 *      否则一次重启之后的迟到消息会把新 scope 当成旧的。
 *   2. **两个 ready**：`scopeReady` 必须同时 `visualReady` 与 `escapeReady`。等不到就在预算内失败，
 *      调用方据此决定要不要继续派发 —— "窗口创建了"不等于"提示看得见、Esc 装上了"。
 *   3. **有界**：一行最多 64 KiB、缓冲最多 1 MiB；超限只丢这一行并计数，不中断进程。
 *   4. **故障不冒充停止**：helper 崩了、超时、协议不兼容，都只是"提示不可用"，绝不等于"驱动已停"。
 *      执行内核的停止报告仍然是唯一权威（`backend/supervisor.mjs`）。
 *
 * 它不认识 `PowerShellBackend`、不读配置、不发工具调用；测试可以用一个假的 helper 进程驱动。
 */
import { spawn as spawnChild } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

/** 协议版本：与 native/indicator-helper 的 `kProtocolVersion` 一致。v2 起窗口计数与日常伴随。 */
export const INDICATOR_PROTOCOL_VERSION = 2;
/** 一行最多多少字节；与 helper 的上限一致。 */
export const MAX_LINE_BYTES = 64 * 1024;
/** 等待 ready / scopeReady 的默认预算。 */
export const INDICATOR_TIMEOUTS = Object.freeze({ startMs: 4000, scopeMs: 4000, commandMs: 2000, stopMs: 3000 });

/**
 * 活动消息需要的能力位（阶段 4）。
 *
 * 协议号仍然是 v2：`visualActivity` 是**附加**消息，旧宿主不会发它、新宿主按能力位决定发不发。
 * 旧 helper（没有 `capabilities`）会拿到 `undefined`，于是这一层降级成"不发"，而不是发出去等超时。
 */
export const ACTIVITY_CAPABILITIES = Object.freeze(['visualActivity']);

/** 一次请求的序号与超时。 */
let nextRequest = 0;

/**
 * helper 客户端。一个插件实例一份；`start()` 之前所有方法都抛。
 */
export class IndicatorSupervisor {
  /**
   * @param options - `{ exePath, spawn, onCancelRequested, trace, timeouts, maxLineBytes }`。
   */
  constructor(options = {}) {
    this.exePath = options.exePath ?? '';
    /** 角色素材目录；空表示不带角色。 */
    this.assetsDir = typeof options.assetsDir === 'string' ? options.assetsDir : '';
    this.spawnImpl = typeof options.spawn === 'function' ? options.spawn : spawnChild;
    this.onCancelRequested = typeof options.onCancelRequested === 'function' ? options.onCancelRequested : () => {};
    this.onFault = typeof options.onFault === 'function' ? options.onFault : () => {};
    this.trace = typeof options.trace === 'function' ? options.trace : () => {};
    this.timeouts = { ...INDICATOR_TIMEOUTS, ...(options.timeouts ?? {}) };
    this.maxLineBytes = Number.isFinite(options.maxLineBytes) ? options.maxLineBytes : MAX_LINE_BYTES;
    this.state = 'absent';
    this.generation = 0;
    this.helper = null;
    this.info = null;
    this.scope = null;
    this.seq = 0;
    /** 最近一次伴随便回执（`companionApplied` 的载荷）。 */
    this.lastCompanion = null;
    this.pending = new Map();
    this.droppedLines = 0;
    this.exitInfo = null;
    this.exitFlushed = false;
    this.buffer = '';
    this.stderrTail = '';
    /** 阶段 4：最近一次活动的序号与结果（诊断用；不参与任何成败判定）。 */
    this.activitySequence = 0;
    this.activityDropped = 0;
    this.lastActivity = null;
    /** 阶段 1：最近一次 ready/health 里的身份与投递事实。 */
    this.lastIdentity = null;
    this.lastDelivery = null;
  }

  /** helper 自报的能力位（`ready.capabilities`）；旧 helper 没有这一项时返回 null。 */
  get capabilities() {
    const caps = this.info?.capabilities;
    return caps !== null && typeof caps === 'object' ? caps : null;
  }

  /** 活动通道是否可用：能力位显式为 true 才算，不假定"协议对得上就支持"。 */
  get supportsActivity() {
    return this.capabilities?.visualActivity === true;
  }

  /**
   * 记下 helper 自报的身份/投递事实（阶段 1 的 doctor 输入）。
   *
   * 这些字段在 `ready` 和 `health` 里都有；只挑稳定的几项，别的原样留着以便排障。
   * @param payload - `ready` 或 `health` 载荷。
   */
  #rememberIdentity(payload) {
    if (payload === null || typeof payload !== 'object') return;
    if (typeof payload.integrityRid === 'number' || typeof payload.deliveryState === 'string') {
      this.lastIdentity = {
        exePath: String(payload.exePath ?? this.exePath ?? ''),
        integrityRid: Number.isFinite(payload.integrityRid) ? payload.integrityRid : null,
        integrityName: String(payload.integrityName ?? 'unknown'),
        uiAccess: payload.uiAccess === true,
        sessionId: Number.isFinite(payload.sessionId) ? payload.sessionId : null,
        identityCanObserveInput: payload.identityCanObserveInput === true,
      };
    }
    if (typeof payload.deliveryState === 'string') {
      this.lastDelivery = {
        deliveryState: payload.deliveryState,
        hookSilent: payload.hookSilent === true,
        hookDelivered: payload.hookDelivered === true,
        hookReinstalls: Number.isFinite(payload.hookReinstalls) ? payload.hookReinstalls : 0,
        sampledResyncs: Number.isFinite(payload.sampledResyncs) ? payload.sampledResyncs : 0,
        escapeReady: payload.escapeReady === true,
        feedbackCreated: Number.isFinite(payload.feedbackCreated) ? payload.feedbackCreated : null,
        feedbackPresented: Number.isFinite(payload.feedbackPresented) ? payload.feedbackPresented : null,
        feedbackDropReason: typeof payload.feedbackDropReason === 'string' ? payload.feedbackDropReason : null,
        feedbackKind: typeof payload.feedbackKind === 'string' ? payload.feedbackKind : null,
        activityApplied: Number.isFinite(payload.activityApplied) ? payload.activityApplied : null,
        keyActivity: Number.isFinite(payload.keyActivity) ? payload.keyActivity : null,
      };
    }
  }

  /** doctor 用的一次性汇总：身份 + 投递 + 能力位。 */
  get consultation() {
    return {
      identity: this.lastIdentity,
      delivery: this.lastDelivery,
      capabilities: this.capabilities,
      supportsActivity: this.supportsActivity,
    };
  }

  /** 可执行文件在不在。缺件是"没有提示"，不是崩溃。 */
  get available() {
    return this.exePath !== '' && existsSync(this.exePath);
  }

  /**
   * 起一个 helper 并等 `ready`。
   * @returns helper 的 `ready` 载荷。
   */
  async start() {
    if (this.state === 'ready' || this.state === 'active') return this.info;
    if (!this.available) {
      this.state = 'unavailable';
      throw new Error(`the interaction indicator helper is not built (${this.exePath || 'no path'}); the overlay and the physical Esc path are unavailable`);
    }
    this.state = 'starting';
    this.exitInfo = null;
    this.exitFlushed = false;
    this.generation += 1;
    const generation = this.generation;
    // 角色素材目录必须**显式传进去**：helper 只有拿到 `--assets=` 才会加载角色图集。
    // 少了这个参数，角色开关就是空转 —— 覆盖层照样画，但一个角色都不会出现
    // （health 里 `characterSurface` 会是 `degraded`，`characterFrames` 一直是 0）。
    const helperArgs = this.assetsDir === '' ? [] : [`--assets=${this.assetsDir}`];
    const child = this.spawnImpl(this.exePath, helperArgs, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.helper = child;
    this.buffer = '';
    child.stdin.setDefaultEncoding?.('utf8');
    child.stderr.setEncoding?.('utf8');
    child.stderr.on?.('data', (chunk) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-2000);
    });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => this.#onLine(generation, line));
    // 退出与"最后一行"是两件事：进程退出时管道里可能还有一行没读出来（closed 正是那一行）。
    // 所以先记下退出信息，等 stdout 关闭（readline 已经把缓冲读完）再让等待者失败。
    child.on('exit', (code, signal) => this.#onExit(generation, code, signal));
    child.stdout.on('close', () => this.#scheduleFlush(generation));

    const ready = await this.#request({ method: 'hello', protocolVersion: INDICATOR_PROTOCOL_VERSION }, 'ready', this.timeouts.startMs);
    this.info = ready;
    this.state = 'ready';
    this.#rememberIdentity(ready);
    return ready;
  }

  /**
   * 开一个 scope 并等两个 ready。
   * @param args - `{ scopeId, epoch }`。
   * @returns `scopeReady` 载荷；`visualReady`/`escapeReady` 任一为假时抛错（附载荷）。
   */
  async beginScope(args = {}) {
    await this.start();
    const scopeId = String(args.scopeId ?? '');
    const epoch = Number(args.epoch ?? 0);
    if (scopeId === '') throw new Error('beginScope needs a scopeId');
    const ready = await this.#request({ method: 'beginScope', scopeId, epoch }, 'scopeReady', this.timeouts.scopeMs);
    this.scope = { scopeId, epoch };
    this.state = 'active';
    if (ready.visualReady !== true || ready.escapeReady !== true) {
      const error = new Error(`the overlay reported itself not ready (visual=${ready.visualReady}, escape=${ready.escapeReady}); nothing should be dispatched`);
      error.scopeReady = ready;
      throw error;
    }
    return ready;
  }

  /**
   * 把执行状态同步给覆盖层（横幅在停止期间要说"正在停"）。
   * @param args - `{ active, seq }`。
   */
  async updateState(args = {}) {
    if (this.state !== 'active' && this.state !== 'ready') return null;
    this.seq += 1;
    return this.#request({ method: 'updateState', seq: args.seq ?? this.seq, active: args.active !== false }, 'stateApplied', this.timeouts.commandMs);
  }

  /**
   * 视觉偏好（装饰总开关、分项、人物可见高度、横幅主题）。
   * @param prefs - 见 internal/visual-preferences.mjs；`settingsRevision` 必填且单调。
   */
  async setVisualPreferences(prefs = {}, revision) {
    if (this.state !== 'active' && this.state !== 'ready') return null;
    return this.#request({ method: 'setVisualPreferences', settingsRevision: revision, preferences: prefs }, 'visualPreferencesApplied', this.timeouts.commandMs);
  }

  /**
   * 日常伴随（方案 3.5 / 7.1）：独立的开关注册，不需要 scope，也不代表电脑控制就绪。
   *
   * @param args - `{ enabled, hostInstanceId, settingsRevision, helperGeneration }`。
   * @returns `companionApplied` 载荷（含 `effectiveVisible` / `hiddenReason` / `ownerMode`）。
   */
  async setCompanionPreferences(args = {}) {
    await this.start();
    const enabled = args.enabled === true;
    const payload = {
      method: 'setCompanionPreferences',
      enabled,
      hostInstanceId: String(args.hostInstanceId ?? ''),
      settingsRevision: Number.isFinite(args.settingsRevision) ? Number(args.settingsRevision) : 0,
      helperGeneration: Number.isFinite(args.helperGeneration) ? Number(args.helperGeneration) : this.generation,
    };
    const applied = await this.#request(payload, 'companionApplied', this.timeouts.commandMs);
    this.lastCompanion = applied;
    return applied;
  }

  /** 最近一次伴随便回执里的"实际可见"结论；没问过就是 null。 */
  get companionState() {
    return this.lastCompanion;
  }

  /**
   * 截图回退：把覆盖层的像素收起来（方案 4.17.1）。只影响可见性，不解除 Esc 与闩锁。
   * @returns isualSuspended 载荷，或 null（没有活动 scope）。
   */
  async suspendVisual() {
    if (this.state !== 'active') return null;
    return this.#request({ method: 'suspendVisual' }, 'visualSuspended', this.timeouts.commandMs);
  }

  /**
   * 截图结束：把像素放回去，并重画一帧。
   * @returns isualResumed 载荷，或 null。
   */
  async resumeVisual() {
    if (this.state !== 'active') return null;
    return this.#request({ method: 'resumeVisual' }, 'visualResumed', this.timeouts.commandMs);
  }

  /** 当前 helper 代次（截图排除用来核对"恢复时还是不是同一代"）。 */
  get visualGeneration() {
    return this.state === 'active' ? this.generation : null;
  }

  /** 结束当前 scope（幂等；没有 scope 时什么都不做）。 */
  async endScope() {
    if (this.scope === null) return null;
    const scopeId = this.scope.scopeId;
    this.scope = null;
    if (this.state === 'active') this.state = 'ready';
    try {
      return await this.#request({ method: 'endScope', scopeId }, 'scopeEnded', this.timeouts.commandMs);
    } catch {
      return null;
    }
  }

  /** 诊断：helper 自报的健康状态。 */
  async health() {
    if (this.state !== 'active' && this.state !== 'ready') return null;
    try {
      const payload = await this.#request({ method: 'health' }, 'health', this.timeouts.commandMs);
      this.#rememberIdentity(payload);
      return payload;
    } catch {
      return null;
    }
  }

  /**
   * 工具动作的视觉语义（阶段 4）。
   *
   * 三条硬约束，都是这一层自己守的：
   *   1. **不阻塞**：超时预算默认 400 ms 且永不抛出。动画消息慢一秒，绝不能把真实操作拖住。
   *   2. **不冒充成功**：回执只说明"提示已收到/已忽略"，不参与任何成败判定；调用方拿不到结果也不影响操作。
   *   3. **降级明确**：helper 没有能力位、没有活动 scope、或代次已经变了，就直接返回 null 并计数，
   *      不假装发过。
   *
   * @param args - `{ kind, phase, operationId, source, epoch, detail }`。
   * @returns `activityApplied` 载荷，或 null。
   */
  async activity(args = {}) {
    if (this.state !== 'active') {
      this.activityDropped += 1;
      return null;
    }
    if (!this.supportsActivity) {
      // 旧 helper：能力位不存在。明确"这一代不支持"，不要发出去等一个必然超时的答案。
      this.activityDropped += 1;
      return null;
    }
    const kind = String(args.kind ?? '');
    if (kind === '') {
      this.activityDropped += 1;
      return null;
    }
    this.activitySequence += 1;
    const payload = {
      method: 'visualActivity',
      kind,
      phase: String(args.phase ?? 'start'),
      source: String(args.source ?? 'tool'),
      operationId: String(args.operationId ?? `a${this.activitySequence}`),
      sequence: this.activitySequence,
      epoch: Number.isFinite(args.epoch) ? Number(args.epoch) : (this.scope?.epoch ?? -1),
      helperGeneration: this.generation,
    };
    try {
      const applied = await this.#request(payload, 'activityApplied', Math.min(400, this.timeouts.commandMs));
      this.lastActivity = { ...payload, at: Date.now(), applied: applied?.applied === true, feedbackId: applied?.feedbackId ?? null };
      return applied;
    } catch (error) {
      // 超时/断开都只记一笔：视觉是提示能力，缺它不该拦住任何工具。
      this.activityDropped += 1;
      this.lastActivity = { ...payload, at: Date.now(), applied: false, error: String(error?.message ?? error) };
      this.trace('indicator.activityDropped', { kind, phase: payload.phase, error: String(error?.message ?? error) });
      return null;
    }
  }

  /** 关掉 helper；返回 `closed` 载荷（拿不到就是 null）。 */
  async stop() {
    const child = this.helper;
    if (child === null) {
      this.state = this.state === 'unavailable' ? 'unavailable' : 'absent';
      return null;
    }
    this.state = 'stopping';
    let closed = null;
    try {
      closed = await this.#request({ method: 'shutdown' }, 'closed', this.timeouts.stopMs);
    } catch {
      closed = null;
    }
    try {
      if (child.exitCode === null) child.kill();
    } catch {
      /* already gone */
    }
    this.helper = null;
    this.info = null;
    this.scope = null;
    this.state = 'absent';
    return closed;
  }

  /**
   * 发一条命令并等指定事件。
   * @param message - 不含 requestId 的负载。
   * @param event - 等哪个事件。
   * @param timeoutMs - 预算。
   */
  #request(message, event, timeoutMs) {
    const child = this.helper;
    if (child === null) return Promise.reject(new Error('the interaction indicator helper is not running'));
    const requestId = `i${nextRequest += 1}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`the interaction indicator helper did not answer ${message.method} within ${timeoutMs} ms`));
      }, Math.max(1, timeoutMs));
      timer.unref?.();
      this.pending.set(requestId, { event, resolve, reject, timer });
      try {
        child.stdin.write(`${JSON.stringify({ requestId, ...message })}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  /**
   * 一行 JSONL 到达。
   * @param generation - 发出这一行时的代次。
   * @param line - 原文。
   */
  #onLine(generation, line) {
    if (generation !== this.generation) return; // 旧代次的迟到消息：丢弃
    if (line.length > this.maxLineBytes) {
      this.droppedLines += 1;
      return;
    }
    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      this.droppedLines += 1;
      return;
    }
    if (payload?.event === 'cancelRequested') {
      // Esc：先本地闩锁（helper 已经做了），再通知宿主。这条不占用 requestId。
      this.trace('indicator.cancelRequested', { scopeId: payload.scopeId, epoch: payload.epoch, reason: payload.reason });
      try {
        this.onCancelRequested(payload);
      } catch (error) {
        this.trace('indicator.cancelFailed', { message: String(error?.message ?? error) });
      }
      return;
    }
    if (payload?.event === 'topologyChanged') {
      // 主动事件（非请求应答）：留痕即可，等待者不需要它。
      this.trace('indicator.topologyChanged', { layoutEpoch: payload.layoutEpoch, monitors: payload.monitors });
      return;
    }
    const requestId = payload?.requestId;
    if (typeof requestId !== 'string') return;
    const entry = this.pending.get(requestId);
    if (entry === undefined) return;
    if (payload.event === 'error') {
      clearTimeout(entry.timer);
      this.pending.delete(requestId);
      entry.reject(new Error(`${payload.code ?? 'INDICATOR_ERROR'}: ${payload.reason ?? 'the helper refused the command'}`));
      return;
    }
    if (payload.event !== entry.event) return; // 不是它等的那一条
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.resolve(payload);
  }

  /**
   * helper 退出：只记下退出信息，**不**立刻让等待者失败。
   *
   * 进程退出时管道里可能还有一行没读出来 —— `closed` 正是那一行。立刻拒绝会让一次正常的
   * `shutdown` 变成"退出"错误。等 stdout 关闭（readline 已经读空缓冲）再由 `#flushExit` 结算。
   *
   * @param generation - 退出的是哪一代。
   */
  #onExit(generation, code, signal) {
    if (generation !== this.generation) return;
    this.exitInfo = { code, signal };
    // 清理状态，但保留 pending：它们还要等最后几行。
    this.helper = null;
    this.info = null;
    const unexpected = this.state !== 'stopping';
    if (unexpected) {
      this.state = 'faulted';
      // 崩溃不是停止：通知宿主关准入并请求驱动停下，但**不**替它判定动作成败。
      try {
        this.onFault({ generation, code, signal });
      } catch {
        /* the host decides what to do with a fault; a throwing callback must not wedge the reader */
      }
    }
    this.trace('indicator.exited', { code, signal });
    // 最后几行可能还在读缓冲里：等一个 tick 再结算，让 closed 这类"遗言"先到达。
    setImmediate(() => this.#flushExit(generation));
  }

  /**
   * stdout 关闭了：如果退出信息还没到（stdout 先关、exit 后到是可能的），稍等一下再结算。
   * @param generation - 哪一代。
   */
  #scheduleFlush(generation) {
    if (generation !== this.generation) return;
    if (this.exitInfo !== null) {
      setImmediate(() => this.#flushExit(generation));
      return;
    }
    const timer = setTimeout(() => this.#flushExit(generation), 250);
    timer.unref?.();
  }

  /**
   * stdout 已经读完：现在还等着的请求就是真的没有答案了。
   * @param generation - 哪一代。
   */
  #flushExit(generation) {
    if (generation !== this.generation) return;
    if (this.exitFlushed === true) return;
    this.exitFlushed = true;
    const { code = null, signal = null } = this.exitInfo ?? {};
    const detail = `the interaction indicator helper exited (code ${code ?? 'null'}${signal ? `, signal ${signal}` : ''})${this.stderrTail.trim() === '' ? '' : `: ${this.stderrTail.trim().slice(-400)}`}`;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(detail));
    }
    this.pending.clear();
    this.scope = null;
  }
}
