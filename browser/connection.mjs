/**
 * The CDP channel: discovery over loopback, one WebSocket per browser, and the bookkeeping
 * that keeps a lost connection from being mistaken for a slow one (8.txt §10).
 *
 * Three things here are deliberately not "just a WebSocket wrapper":
 *
 *   - **Every request settles.** A deadline, a cancellation and a disconnect all resolve the
 *     pending promise; a request that was answered *after* it settled is ignored rather than
 *     landing in a caller that has moved on.
 *   - **The connection has a generation.** It goes up on every connect and every disconnect,
 *     and the references a caller holds carry it. That is what makes "the browser you read
 *     this node from is not the browser you are talking to" a checkable fact instead of a
 *     guess (§11).
 *   - **Loopback only.** The endpoint is verified to be a local address, and a
 *     `webSocketDebuggerUrl` handed to us by the browser is verified again: following it
 *     wherever it points is how a local control channel becomes a remote one.
 *
 * Nothing here knows about tabs, trees or budgets -- that is `state.mjs`.
 */

/** The hosts that count as "this machine". */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** How much of one message this client will parse. */
const DEFAULT_MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

/**
 * The states one channel moves through (9.txt §5.9).
 *
 * They exist so that "is it up?" stops being a question about `readyState`, which answers
 * `1` for a socket that opened *after* its own connect timed out -- a socket this client
 * has already given up on and no longer listens to. Every transition is written down here,
 * and a socket event from a socket that is no longer the current one is ignored rather than
 * applied to whatever connection exists now.
 */
const CONNECTION_STATES = Object.freeze(['idle', 'connecting', 'open', 'closing', 'closed']);

/**
 * A failure that names what the caller can do next, in the plugin's usual shape.
 */
export class CdpError extends Error {
  constructor(message, code, extra = {}) {
    super(message);
    this.name = 'CdpError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * Whether a host is this machine.
 * @param host - a hostname or literal address.
 * @returns true for loopback names only.
 */
export function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(String(host ?? '').toLowerCase());
}

/**
 * Parse and verify an endpoint URL: http(s) on loopback only.
 * @param endpoint - e.g. `http://127.0.0.1:9222`.
 * @returns `{ url, host, port }`.
 */
export function parseEndpoint(endpoint) {
  let parsed;
  try {
    parsed = new URL(String(endpoint ?? ''));
  } catch {
    throw new CdpError(`"${endpoint}" is not a URL. Pass the browser's debugging endpoint, e.g. http://127.0.0.1:9222`, 'BAD_ENDPOINT');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CdpError(`the endpoint must be an http(s) address, not ${parsed.protocol}//`, 'BAD_ENDPOINT');
  }
  if (!isLoopbackHost(parsed.hostname)) {
    // Not a warning: this is the one boundary that keeps "control a browser" local (§10).
    throw new CdpError(`the endpoint ${parsed.host} is not on this machine. Only a local debugging endpoint is used -- a browser control channel that reaches out over the network is a different thing from the one this plugin offers.`, 'ENDPOINT_NOT_LOCAL');
  }
  const port = Number(parsed.port === '' ? (parsed.protocol === 'https:' ? 443 : 80) : parsed.port);
  return { url: `${parsed.protocol}//${parsed.hostname}:${port}`, host: parsed.hostname, port };
}

/** Fetch JSON with a deadline, and turn every failure into a sentence. */
async function fetchJson(url, { fetchImpl, timeoutMs, what }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new CdpError(`${what} answered HTTP ${response.status}`, 'CDP_UNAVAILABLE');
    return await response.json();
  } catch (error) {
    if (error instanceof CdpError) throw error;
    if (error?.name === 'AbortError') throw new CdpError(`${what} did not answer within ${timeoutMs} ms`, 'CDP_UNAVAILABLE');
    throw new CdpError(`${what} could not be reached (${error?.message ?? error})`, 'CDP_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask a browser what it is and where its WebSocket lives.
 *
 * The returned WebSocket address is verified to be loopback as well: a browser that reports
 * some other host is not followed, because that would be the moment this stops being a local
 * channel.
 * @param endpoint - `http://127.0.0.1:<port>`.
 * @param options - `{ fetchImpl, timeoutMs }`.
 * @returns `{ endpoint, host, port, webSocketDebuggerUrl, browser, protocolVersion }`.
 */
export async function discoverEndpoint(endpoint, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Number(options.timeoutMs ?? 2000);
  const target = parseEndpoint(endpoint);
  const version = await fetchJson(`${target.url}/json/version`, { fetchImpl, timeoutMs, what: `the debugging endpoint at ${target.url}` });
  const webSocketDebuggerUrl = String(version?.webSocketDebuggerUrl ?? '');
  if (webSocketDebuggerUrl === '') {
    throw new CdpError(`${target.url} answered, but not like a browser: no webSocketDebuggerUrl. An HTTP server on this port is not a debugging endpoint.`, 'CDP_UNAVAILABLE');
  }
  let socketUrl;
  try {
    socketUrl = new URL(webSocketDebuggerUrl);
  } catch {
    throw new CdpError(`the browser reported an unparseable webSocketDebuggerUrl (${webSocketDebuggerUrl})`, 'CDP_UNAVAILABLE');
  }
  if (!isLoopbackHost(socketUrl.hostname)) {
    throw new CdpError(`the browser reported a WebSocket address on ${socketUrl.hostname}, which is not this machine; it is not followed.`, 'ENDPOINT_NOT_LOCAL');
  }
  return {
    endpoint: target.url,
    host: target.host,
    port: target.port,
    webSocketDebuggerUrl: socketUrl.href,
    browser: String(version?.Browser ?? ''),
    protocolVersion: String(version?.['Protocol-Version'] ?? ''),
  };
}

/**
 * List the pages (tabs) of a browser, without opening a WebSocket.
 * @param endpoint - `http://127.0.0.1:<port>`.
 * @param options - `{ fetchImpl, timeoutMs }`.
 * @returns an array of `{ id, type, title, url }`.
 */
export async function listTargets(endpoint, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Number(options.timeoutMs ?? 2000);
  const target = parseEndpoint(endpoint);
  const listed = await fetchJson(`${target.url}/json/list`, { fetchImpl, timeoutMs, what: `the target list at ${target.url}` });
  if (!Array.isArray(listed)) throw new CdpError(`${target.url}/json/list did not answer with a list`, 'CDP_UNAVAILABLE');
  return listed.map((one) => ({
    id: String(one?.id ?? ''),
    type: String(one?.type ?? ''),
    title: String(one?.title ?? ''),
    url: String(one?.url ?? ''),
    webSocketDebuggerUrl: String(one?.webSocketDebuggerUrl ?? ''),
  }));
}

/**
 * One WebSocket to one browser, with a request table and a generation.
 */
export class CdpConnection {
  /**
   * @param options - `{ endpoint, WebSocketImpl, connectTimeoutMs, defaultTimeoutMs, maxMessageBytes }`.
   */
  constructor(options) {
    this.endpoint = String(options.endpoint ?? '');
    this.WebSocketImpl = options.WebSocketImpl ?? WebSocket;
    this.connectTimeoutMs = Number(options.connectTimeoutMs ?? 5000);
    this.defaultTimeoutMs = Number(options.defaultTimeoutMs ?? 10000);
    this.maxMessageBytes = Number(options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES);
    this.negotiated = null;
    this.socket = null;
    this.requestSeq = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.sessions = new Map();
    /** Attach requests in flight, so one target gets one flat session (§8.1). */
    this.attachRequests = new Map();
    /** Goes up on every connect and every disconnect; references carry it (§11). */
    this.generation = 0;
    /** One of CONNECTION_STATES; the only thing the lifecycle questions are asked of. */
    this.state = 'idle';
    /** The socket events are allowed to touch this connection only while it is the current one. */
    this.socketGeneration = 0;
    /** The connect in progress, so two callers share one socket instead of opening two. */
    this.connectPromise = null;
    this.closedReason = '';
    this.closedCode = '';
    this.bytesIn = 0;
    this.messagesIn = 0;
  }

  get connected() {
    return this.state === 'open' && this.socket !== null && this.socket.readyState === 1;
  }

  /**
   * Open the channel. Resolves once the socket is up, or throws with a named reason.
   *
   * Concurrent callers share one attempt: a second `connect()` while the first is still
   * running waits on the same promise rather than opening a second socket to the same
   * browser and leaving one of them unowned (§5.9).
   * @returns the negotiated browser information.
   */
  async connect() {
    if (this.connected) return this.negotiated ?? {};
    if (this.connectPromise !== null) return await this.connectPromise;
    const attempt = this.#open().finally(() => {
      if (this.connectPromise === attempt) this.connectPromise = null;
    });
    this.connectPromise = attempt;
    return await attempt;
  }

  /** One connect attempt: discover, open, and settle the socket's own listeners. */
  async #open() {
    this.state = 'connecting';
    this.closedReason = '';
    this.closedCode = '';
    this.negotiated = await discoverEndpoint(this.endpoint, { timeoutMs: Math.min(this.connectTimeoutMs, 2000) });
    const generation = this.generation + 1;
    const socket = new this.WebSocketImpl(this.negotiated.webSocketDebuggerUrl);
    this.socket = socket;
    this.socketGeneration = generation;
    // The message listener is attached now rather than after `open`: a connect that timed out
    // and a socket that opens a moment later must not add up to "connected, with nobody
    // listening" (§5.9).
    socket.addEventListener('message', (event) => {
      if (!this.#isCurrent(socket, generation)) return;
      this.#onMessage(event);
    });
    socket.addEventListener('close', (event) => this.#socketClosed(socket, generation, event));
    try {
      await new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          // The promise is settled *before* the socket is closed: closing it is what makes the
          // close listener fire, and "it never opened in time" is the reason to report, not
          // "it closed" -- which is what this would turn into if the order were the other way.
          if (settled) return;
          settled = true;
          this.#abandonSocket(socket, generation, `the WebSocket at ${this.negotiated.webSocketDebuggerUrl} did not open within ${this.connectTimeoutMs} ms`, 'CDP_UNAVAILABLE');
          reject(new CdpError(`the WebSocket at ${this.negotiated.webSocketDebuggerUrl} did not open within ${this.connectTimeoutMs} ms`, 'CDP_UNAVAILABLE'));
        }, this.connectTimeoutMs);
        socket.addEventListener('open', () => {
          // A late open from a socket this attempt already gave up on changes nothing.
          if (settled || !this.#isCurrent(socket, generation)) return;
          settled = true;
          clearTimeout(timer);
          this.state = 'open';
          this.generation = generation;
          resolve();
        });
        socket.addEventListener('error', (event) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const message = `the WebSocket to ${this.endpoint} failed to open (${event?.message ?? 'transport error'})`;
          this.#abandonSocket(socket, generation, message, 'CDP_UNAVAILABLE');
          reject(new CdpError(message, 'CDP_UNAVAILABLE'));
        });
        socket.addEventListener('close', (event) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(new CdpError(`the connection to ${this.endpoint} closed before it was ready${event?.reason ? ` (${event.reason})` : ''}`, 'CDP_DISCONNECTED'));
        });
      });
    } catch (error) {
      // A failed attempt leaves nothing half-open behind it.
      if (this.socket === socket) this.#abandonSocket(socket, generation, String(error?.message ?? error), error?.code ?? 'CDP_UNAVAILABLE');
      throw error;
    }
    return this.negotiated;
  }

  /** Whether an event belongs to the socket this connection is currently using. */
  #isCurrent(socket, generation) {
    return this.socket === socket && this.socketGeneration === generation;
  }

  /**
   * Give up on one socket: close it, stop listening to it, and make sure anything late it
   * still reports is ignored. Used by the connect deadline and by a failed attempt.
   */
  #abandonSocket(socket, generation, reason, code) {
    if (this.#isCurrent(socket, generation)) {
      this.socket = null;
      // Moving the generation on is what makes the socket's remaining events inert: its
      // `open`, `message` and `close` all check `#isCurrent` and now answer false.
      this.socketGeneration = generation + 1;
      this.generation += 1;
    }
    try { socket.close(); } catch { /* already gone */ }
    if (this.state === 'connecting' || this.state === 'open') {
      this.state = 'closed';
      this.closedReason = reason;
      this.closedCode = code;
      this.#settleAll(new CdpError(`the connection to ${this.endpoint} is gone: ${reason}`, code, { actionSent: true, outcomeUnknown: true }));
    }
  }

  /**
   * A socket the connection was using went away.
   *
   * The order matters: sessions are forgotten (a flat session id belongs to a socket that no
   * longer exists), everything still pending is settled with "it was sent, we do not know what
   * happened", and the generation moves on so every reference minted over this connection is
   * refused by `state.mjs` -- none of those things is true of a close from an *old* socket,
   * which is why the identity check comes first (§5.9).
   */
  #socketClosed(socket, generation, event) {
    if (!this.#isCurrent(socket, generation)) return;
    const reason = `the connection to ${this.endpoint} closed${event?.reason ? ` (${event.reason})` : ''}`;
    this.socket = null;
    this.socketGeneration = generation + 1;
    this.generation += 1;
    this.state = 'closed';
    this.closedReason = reason;
    this.closedCode = 'CDP_DISCONNECTED';
    this.sessions.clear();
    this.#settleAll(new CdpError(reason, 'CDP_DISCONNECTED', {
      // Every request in the table has already been written to the socket: "the answer never
      // came" is a different fact from "it was never sent" (§5.2).
      actionSent: true,
      outcomeUnknown: true,
    }));
  }

  /**
   * Send one CDP request and wait for its answer.
   *
   * Settles exactly once: on the answer, on the deadline, on the signal, or on the
   * connection going away. A late answer to a settled request is dropped (its id is no
   * longer in the table), which is what keeps a timeout from also being a delivery.
   * @param method - e.g. `Accessibility.getFullAXTree`.
   * @param params - the protocol parameters.
   * @param options - `{ sessionId, timeoutMs, signal }`.
   * @returns the `result` field of the answer.
   */
  async send(method, params = {}, options = {}) {
    if (!this.connected) {
      throw new CdpError(`not connected to ${this.endpoint}${this.closedReason === '' ? '' : ` (${this.closedReason})`}`, 'CDP_UNAVAILABLE');
    }
    const timeoutMs = Number(options.timeoutMs ?? this.defaultTimeoutMs);
    const signal = options.signal;
    const sessionId = options.sessionId === undefined || options.sessionId === null || options.sessionId === ''
      ? undefined
      : String(options.sessionId);
    // A cancelled call must not reach the wire at all. The check is here -- before an id is
    // taken, before anything is registered and before the socket is touched -- because a
    // request that is written and then rejected is a request the browser still acts on
    // (§5.8: a pre-cancelled request produces 0 protocol messages).
    if (signal !== undefined && signal !== null && signal.aborted === true) {
      throw new CdpError(`${method} was cancelled before it was sent`, 'CDP_CANCELLED', { actionSent: false, canceled: true });
    }
    this.requestSeq += 1;
    const id = this.requestSeq;
    const entry = { id, method, sessionId, signal, timer: null, onAbort: undefined, settled: false, resolve: undefined, reject: undefined };
    const promise = new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
    });
    /**
     * The one way out of a request: an answer, the deadline, the signal, a failed write or a
     * lost connection all land here, so nothing can settle twice and nothing can be left
     * holding a timer or an abort listener (§5.9).
     */
    const finish = (error, value) => {
      if (entry.settled) return false;
      entry.settled = true;
      this.pending.delete(id);
      if (entry.timer !== null) clearTimeout(entry.timer);
      if (entry.onAbort !== undefined && entry.signal !== undefined && entry.signal !== null) {
        try { entry.signal.removeEventListener('abort', entry.onAbort); } catch { /* nothing to remove */ }
      }
      if (error !== undefined && error !== null) entry.reject(error);
      else entry.resolve(value);
      return true;
    };
    entry.finish = finish;
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      entry.timer = setTimeout(() => {
        finish(new CdpError(`${method} did not answer within ${timeoutMs} ms`, 'CDP_TIMEOUT', { actionSent: true, outcomeUnknown: true }));
      }, timeoutMs);
    }
    if (signal !== undefined && signal !== null) {
      entry.onAbort = () => {
        finish(new CdpError(`${method} was cancelled before it answered`, 'CDP_CANCELLED', { actionSent: true, outcomeUnknown: true, canceled: true }));
      };
      signal.addEventListener('abort', entry.onAbort, { once: true });
    }
    // Re-checked after the listeners are in place and immediately before the write: a cancel
    // that landed while this request was being prepared still ends with nothing sent.
    if (signal !== undefined && signal !== null && signal.aborted === true) {
      finish(new CdpError(`${method} was cancelled before it was sent`, 'CDP_CANCELLED', { actionSent: false, canceled: true }));
      return promise;
    }
    this.pending.set(id, entry);
    const payload = sessionId === undefined ? { id, method, params } : { id, method, params, sessionId };
    try {
      this.socket.send(JSON.stringify(payload));
    } catch (error) {
      finish(new CdpError(`${method} could not be sent (${error?.message ?? error})`, 'CDP_UNAVAILABLE', { actionSent: false }));
    }
    return promise;
  }

  /**
   * Attach to a target, given its id, and return the flat session id the protocol then wants
   * on every request aimed at that page.
   * @param targetId - from the target list.
   * @param options - `{ timeoutMs }`.
   * @returns the session id.
   */
  async attach(targetId, options = {}) {
    const key = String(targetId);
    const existing = this.sessions.get(key);
    if (existing !== undefined) return existing.sessionId;
    // Two reads of the same page in one call ask for the same flat session; they share one
    // attach request instead of producing two sessions for one target (§8.1).
    const inFlight = this.attachRequests.get(key);
    if (inFlight !== undefined) return await inFlight;
    const attempt = (async () => {
      const result = await this.send('Target.attachToTarget', { targetId: key, flatten: true }, options);
      const sessionId = String(result?.sessionId ?? '');
      if (sessionId === '') throw new CdpError(`attaching to target ${key} returned no session`, 'CDP_UNAVAILABLE');
      this.sessions.set(key, { sessionId });
      return sessionId;
    })().finally(() => {
      if (this.attachRequests.get(key) === attempt) this.attachRequests.delete(key);
    });
    this.attachRequests.set(key, attempt);
    return await attempt;
  }

  /** Forget a session (a closed tab), so a later read does not reuse it. */
  detachSession(targetId) {
    this.sessions.delete(String(targetId));
    this.attachRequests.delete(String(targetId));
  }

  /**
   * Listen for a CDP event.
   * @param method - e.g. `Page.frameNavigated`; `'*'` for every event.
   * @param handler - called with `(params, sessionId)`.
   * @returns a disposer.
   */
  on(method, handler) {
    const key = String(method);
    const list = this.listeners.get(key) ?? [];
    list.push(handler);
    this.listeners.set(key, list);
    return () => {
      const current = this.listeners.get(key) ?? [];
      const at = current.indexOf(handler);
      if (at >= 0) current.splice(at, 1);
    };
  }

  /** Why the channel is closed, or '' while it is up. */
  get closed() {
    return this.closedCode === '' ? null : { code: this.closedCode, reason: this.closedReason, generation: this.generation };
  }

  /**
   * Close the channel. Everything pending is settled as failed, listeners are dropped and
   * the generation moves: a reference minted over this connection is not usable over the
   * next one (§10: 连接代次递增，旧引用失效).
   * @param reason - human sentence for the receipt.
   * @param code - the machine-readable reason.
   */
  close(reason = 'closed by the plugin', code = 'CDP_CLOSED') {
    this.state = 'closing';
    this.sessions.clear();
    this.attachRequests.clear();
    const socket = this.socket;
    if (socket !== null) {
      // The socket stops being the current one *before* it is closed, so its own close event
      // is ignored instead of being processed a second time as a disconnect.
      this.socket = null;
      this.socketGeneration += 1;
      try { socket.close(); } catch { /* already gone */ }
    }
    this.#settleAll(new CdpError(`the connection to ${this.endpoint} was closed: ${reason}`, code, { actionSent: true, outcomeUnknown: true }));
    this.listeners.clear();
    this.closedReason = reason;
    this.closedCode = code;
    this.generation += 1;
    this.state = 'closed';
  }

  /** Settle every pending request with the same failure, and forget them. */
  #settleAll(error) {
    for (const [id, entry] of [...this.pending]) {
      // `finish` is the request's own single exit: it removes the timer and the abort listener
      // and deletes the entry, so nothing is left registered on a channel that is gone.
      if (typeof entry.finish === 'function') entry.finish(error);
      else {
        this.pending.delete(id);
        if (entry.timer !== null) clearTimeout(entry.timer);
        entry.reject(error);
      }
    }
    this.attachRequests.clear();
  }

  /** One incoming frame: an answer, an event, or something this client will not parse. */
  #onMessage(event) {
    const data = event?.data;
    const size = typeof data === 'string' ? data.length : Number(data?.byteLength ?? 0);
    this.bytesIn += size;
    this.messagesIn += 1;
    if (size > this.maxMessageBytes) {
      // A browser that answers with megabytes is not something to keep parsing in the
      // middle of a control channel: the channel is closed and said so.
      const message = `the browser sent a ${size}-byte message, over the ${this.maxMessageBytes}-byte limit this client accepts; the connection was closed rather than parsed`;
      this.close(message, 'CDP_MESSAGE_TOO_LARGE');
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'));
    } catch {
      return;
    }
    if (parsed === null || typeof parsed !== 'object') return;
    const sessionId = parsed.sessionId === undefined ? '' : String(parsed.sessionId);
    if (parsed.id !== undefined) {
      const id = Number(parsed.id);
      const entry = this.pending.get(id);
      if (entry === undefined) return; // a late answer to a request that already settled
      if (parsed.error !== undefined && parsed.error !== null) {
        entry.finish(new CdpError(`${entry.method} failed: ${parsed.error.message ?? 'unknown protocol error'}${parsed.error.code === undefined ? '' : ` (code ${parsed.error.code})`}`, 'CDP_PROTOCOL_ERROR'));
        return;
      }
      entry.finish(undefined, parsed.result ?? {});
      return;
    }
    if (parsed.method !== undefined) {
      const params = parsed.params ?? {};
      for (const handler of this.listeners.get(String(parsed.method)) ?? []) {
        try { handler(params, sessionId); } catch { /* a listener must not take the channel down */ }
      }
      for (const handler of this.listeners.get('*') ?? []) {
        try { handler(params, sessionId, String(parsed.method)); } catch { /* same */ }
      }
    }
  }
}
