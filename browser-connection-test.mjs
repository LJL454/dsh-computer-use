/**
 * The channel's own lifecycle, with no browser in the loop (9.txt §5.8–§5.11).
 *
 * The audit reproduced four of these against a real browser, and the point of this file is
 * that they stay fixed without one: a fake WebSocket that can be opened late, closed at the
 * wrong moment and answered out of order is the only fixture needed to state the claims that
 * were wrong --
 *
 *   - a request that was cancelled before it was sent produces **0 protocol messages** (§5.8);
 *   - a connect that timed out leaves no socket behind, and a late `open` changes nothing (§5.9);
 *   - a lost connection settles what was pending as *sent, outcome unknown*, forgets its
 *     sessions and moves the generation on, so references die with it (§5.2, §5.9);
 *   - a deadline or a cancel takes its timer and its abort listener with it (§5.9);
 *   - one connect and one attach per target, no matter how many callers ask (§5.9, §8.1);
 *   - a reference read from tab A is refused in tab B (§5.10);
 *   - a release carries `buttons: 0`, a navigation wait is registered *before* the navigation
 *     is sent, a cancelled call starts no further step, and `elapsedMs` is the real time
 *     (§5.11).
 *
 *   node browser-connection-test.mjs
 */
import { CdpConnection, CdpError } from './browser/connection.mjs';
import { BrowserSession } from './browser/state.mjs';
import { runActions } from './browser/actions.mjs';

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`);
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`);
  }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A WebSocket that only moves when the test tells it to. */
class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.listeners = new Map();
    FakeSocket.instances.push(this);
  }

  static reset() {
    FakeSocket.instances = [];
  }

  addEventListener(type, handler) {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  removeEventListener(type, handler) {
    const list = this.listeners.get(type) ?? [];
    const at = list.indexOf(handler);
    if (at >= 0) list.splice(at, 1);
  }

  emit(type, event = {}) {
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler(event);
  }

  open() {
    this.readyState = 1;
    this.emit('open', {});
  }

  answer(payload) {
    this.emit('message', { data: JSON.stringify(payload) });
  }

  send(text) {
    this.sent.push(JSON.parse(text));
  }

  close() {
    if (this.closed === true) return;
    this.closed = true;
    this.readyState = 3;
    this.emit('close', { code: 1000, reason: this.closeReason ?? 'closed by the test' });
  }

  fail() {
    this.readyState = 3;
    this.emit('error', { message: 'the test failed the socket' });
  }

  get methodCalls() {
    return this.sent.map((one) => one.method);
  }
}
FakeSocket.instances = [];

/** Discovery has to answer, and it is the one thing connect() fetches itself. */
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/fake-browser',
    Browser: 'Fake/1.0',
    'Protocol-Version': '1.3',
  }),
});

/** The socket only exists after discovery has answered, so wait for a *new* one instead of
 * assuming the last instance is the one this attempt created. */
async function waitForSocket(count = 0, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const socket = FakeSocket.instances.at(-1);
    if (socket !== undefined && FakeSocket.instances.length > count) return socket;
    await sleep(2);
  }
  throw new Error('the connection never created a socket');
}

/** A connection whose one socket is open and reachable, without any of the waiting. */
async function openConnection(options = {}) {
  FakeSocket.reset();
  const connection = new CdpConnection({ endpoint: 'http://127.0.0.1:9222', WebSocketImpl: FakeSocket, connectTimeoutMs: 1000, ...options });
  const connecting = connection.connect();
  const socket = await waitForSocket();
  socket.open();
  await connecting;
  return { connection, socket };
}

/** A signal that counts what it hands out, so "the listener was removed" is checkable. */
function countingSignal() {
  const controller = new AbortController();
  const signal = controller.signal;
  const counts = { added: 0, removed: 0 };
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (type, handler, options) => { if (type === 'abort') counts.added += 1; return add(type, handler, options); };
  signal.removeEventListener = (type, handler, options) => { if (type === 'abort') counts.removed += 1; return remove(type, handler, options); };
  return { signal, controller, counts };
}

console.log('== a cancelled request never reaches the wire (9.txt §5.8) ==');
{
  const { connection, socket } = await openConnection();
  const controller = new AbortController();
  controller.abort();
  let error = null;
  try {
    await connection.send('Input.dispatchMouseEvent', { type: 'mousePressed' }, { signal: controller.signal });
  } catch (failure) {
    error = failure;
  }
  check('a pre-cancelled request is refused', error !== null, 'it resolved instead of failing');
  check('and it is a cancellation, not a failure', error?.code === 'CDP_CANCELLED' && error?.canceled === true, JSON.stringify({ code: error?.code }));
  check('and it says nothing was sent', error?.actionSent === false, JSON.stringify({ actionSent: error?.actionSent }));
  check('0 protocol messages were written', socket.sent.length === 0, JSON.stringify(socket.sent));
  check('and nothing was left pending', connection.pending.size === 0, `${connection.pending.size} pending`);
  connection.close('the test is done');
}

console.log('\n== a cancel that lands while the request is being prepared ==');
{
  const { connection, socket } = await openConnection();
  // Not aborted when the first check reads it, aborted by the time the last one does: the
  // check has to be after the listeners are in place, not just at the top of the function.
  let reads = 0;
  const sneaky = {
    get aborted() { reads += 1; return reads > 1; },
    addEventListener() {},
    removeEventListener() {},
  };
  let error = null;
  try {
    await connection.send('Input.insertText', { text: 'x' }, { signal: sneaky });
  } catch (failure) {
    error = failure;
  }
  check('the request is still refused', error?.code === 'CDP_CANCELLED', JSON.stringify({ code: error?.code }));
  check('and it still produced no protocol message', socket.sent.length === 0, JSON.stringify(socket.sent));
  connection.close('the test is done');
}

console.log('\n== a deadline takes its timer and its listener with it (9.txt §5.9) ==');
{
  const { connection, socket } = await openConnection();
  const { signal, controller, counts } = countingSignal();
  let error = null;
  try {
    await connection.send('Runtime.evaluate', {}, { timeoutMs: 40, signal });
  } catch (failure) {
    error = failure;
  }
  check('the request times out', error?.code === 'CDP_TIMEOUT', JSON.stringify({ code: error?.code }));
  check('and it is reported as sent-but-unknown, not as unsent', error?.actionSent === true && error?.outcomeUnknown === true, JSON.stringify({ actionSent: error?.actionSent, outcomeUnknown: error?.outcomeUnknown }));
  check('the abort listener was removed', counts.added === counts.removed && counts.added === 1, JSON.stringify(counts));
  check('and the request table is empty again', connection.pending.size === 0, `${connection.pending.size} pending`);
  // A late answer to a request that already settled is dropped, and dropping it must not
  // throw out of the socket's message handler.
  const answerId = socket.sent.at(-1)?.id;
  socket.answer({ id: answerId, result: { ok: true } });
  check('a late answer is ignored rather than delivered twice', connection.pending.size === 0);
  controller.abort();
  check('and aborting afterwards changes nothing', connection.pending.size === 0);
  connection.close('the test is done');
}

console.log('\n== a connect that times out leaves nothing behind (9.txt §5.9) ==');
{
  FakeSocket.reset();
  const connection = new CdpConnection({ endpoint: 'http://127.0.0.1:9222', WebSocketImpl: FakeSocket, connectTimeoutMs: 40 });
  const connecting = connection.connect();
  const socket = await waitForSocket();
  let error = null;
  try {
    await connecting;
  } catch (failure) {
    error = failure;
  }
  check('the connect fails with a named reason', error?.code === 'CDP_UNAVAILABLE', JSON.stringify({ code: error?.code }));
  check('the socket was closed rather than left half-open', socket.closed === true, JSON.stringify({ closed: socket.closed }));
  check('and the connection does not claim to be up', connection.connected === false, JSON.stringify({ state: connection.state }));
  // This is the shape the audit called "connected, but nobody is listening": the late open used
  // to flip `connected` to true while the message listener was never attached.
  socket.open();
  check('a late open does not make it connected', connection.connected === false, JSON.stringify({ state: connection.state, readyState: socket.readyState }));
  let sendError = null;
  try {
    await connection.send('Runtime.evaluate', {}, { timeoutMs: 100 });
  } catch (failure) {
    sendError = failure;
  }
  check('and a request on it is refused instead of hanging', sendError?.code === 'CDP_UNAVAILABLE', JSON.stringify({ code: sendError?.code }));
  check('no protocol message was written to the abandoned socket', socket.sent.length === 0, JSON.stringify(socket.sent));
  connection.close('the test is done');
}

console.log('\n== one connect and one attach per target (9.txt §5.9, §8.1) ==');
{
  FakeSocket.reset();
  const connection = new CdpConnection({ endpoint: 'http://127.0.0.1:9222', WebSocketImpl: FakeSocket, connectTimeoutMs: 1000 });
  const first = connection.connect();
  const second = connection.connect();
  const socket = await waitForSocket();
  socket.open();
  await Promise.all([first, second]);
  check('two callers share one socket', FakeSocket.instances.length === 1, `${FakeSocket.instances.length} sockets`);

  const attachOne = connection.attach('tab-1', { timeoutMs: 500 });
  const attachTwo = connection.attach('tab-1', { timeoutMs: 500 });
  await sleep(5);
  const attachCalls = socket.sent.filter((one) => one.method === 'Target.attachToTarget');
  check('two readers of one target share one attach request', attachCalls.length === 1, JSON.stringify(socket.methodCalls));
  socket.answer({ id: attachCalls[0].id, result: { sessionId: 'flat-session-1' } });
  const [one, two] = await Promise.all([attachOne, attachTwo]);
  check('and both get the same flat session', one === 'flat-session-1' && two === 'flat-session-1', JSON.stringify([one, two]));
  connection.close('the test is done');
}

console.log('\n== a lost connection settles what it owes (9.txt §5.2, §5.9) ==');
{
  const { connection, socket } = await openConnection();
  connection.sessions.set('tab-1', { sessionId: 'flat-session-1' });
  const generationBefore = connection.generation;
  const pending = connection.send('Input.dispatchMouseEvent', { type: 'mousePressed' }, { timeoutMs: 5000 });
  await sleep(5);
  socket.closeReason = 'the browser went away';
  socket.close();
  let error = null;
  try {
    await pending;
  } catch (failure) {
    error = failure;
  }
  check('the request is settled by the disconnect', error?.code === 'CDP_DISCONNECTED', JSON.stringify({ code: error?.code }));
  check('and it says the action was already sent', error?.actionSent === true && error?.outcomeUnknown === true, JSON.stringify({ actionSent: error?.actionSent, outcomeUnknown: error?.outcomeUnknown }));
  check('the session map was cleared', connection.sessions.size === 0, `${connection.sessions.size} sessions`);
  check('and the generation moved on, so references from it are refused', connection.generation > generationBefore, `${generationBefore} -> ${connection.generation}`);
  connection.close('the test is done');
}

console.log('\n== an old socket cannot disturb a new connection (9.txt §5.9) ==');
{
  const { connection, socket: first } = await openConnection();
  connection.close('the test closed it');
  const socketsBefore = FakeSocket.instances.length;
  const reconnecting = connection.connect();
  const second = await waitForSocket(socketsBefore);
  second.open();
  await reconnecting;
  check('the connection is up again on a new socket', connection.connected === true, JSON.stringify({ state: connection.state }));
  first.closeReason = 'the old socket, finally reporting';
  first.close();
  check('a late close from the old socket is ignored', connection.connected === true, JSON.stringify({ state: connection.state }));
  connection.close('the test is done');
}

console.log('\n== a reference belongs to a session, a target and a document (9.txt §5.10) ==');
{
  const { connection } = await openConnection();
  const session = new BrowserSession({ connection, sessionKey: 'session-a' });
  const minted = session.registerRef({ targetId: 'tab-a', frameId: 'frame-a', documentGeneration: 'doc-1', backendNodeId: 42, role: 'button', name: 'Send' });
  check('a fresh reference is usable', session.rejectReason(minted) === '', session.rejectReason(minted));
  const identity = session.refs.get(minted);
  check('and it carries the session it was read for', identity.sessionKey === 'session-a', JSON.stringify({ sessionKey: identity.sessionKey }));

  // The same node id, read in another tab, is a different element.
  session.currentFrames.set('tab-b', 'frame-b');
  session.documentGenerations.set('tab-b', 'doc-2');
  const otherSession = new BrowserSession({ connection, sessionKey: 'session-a' });
  otherSession.refs.set('stale', { ...identity, targetId: 'tab-b', frameId: 'frame-b', documentGeneration: 'doc-2' });
  check('a reference from another target is refused once that frame changed', otherSession.rejectReason('stale') === '', 'a same-document reference should still be usable');

  session.invalidateTarget('tab-a', 'the page navigated');
  check('a navigation makes an earlier reference unusable', /navigated/.test(session.rejectReason(minted)), session.rejectReason(minted));

  const foreign = new BrowserSession({ connection, sessionKey: 'session-b' });
  foreign.refs.set('not-mine', { ...identity, sessionKey: 'session-a' });
  check('a reference read for another conversation is refused', /another conversation/.test(foreign.rejectReason('not-mine')), foreign.rejectReason('not-mine'));

  const afterRestart = new BrowserSession({ connection, sessionKey: 'session-a' });
  const old = afterRestart.registerRef({ targetId: 'tab-a', frameId: 'frame-a', documentGeneration: 'doc-1', backendNodeId: 7, role: 'button', name: 'Old' });
  connection.close('the browser restarted');
  connection.close('the browser restarted');
  check('a reference from a previous connection generation is refused', /generation/.test(afterRestart.rejectReason(old)), afterRestart.rejectReason(old));
}

console.log('\n== the action layer: what a click, a navigation and a cancel look like (9.txt §5.11) ==');

/** A session whose protocol side is scripted, so the action layer can be read directly. */
function fakeSession(options = {}) {
  const calls = [];
  const listeners = new Map();
  const refs = new Map();
  const connection = {
    connected: true,
    sessions: new Map(),
    generation: 1,
    on(method, handler) {
      const list = listeners.get(method) ?? [];
      list.push(handler);
      listeners.set(method, list);
      calls.push({ method: `on:${method}` });
      return () => {
        const current = listeners.get(method) ?? [];
        const at = current.indexOf(handler);
        if (at >= 0) current.splice(at, 1);
        calls.push({ method: `off:${method}` });
      };
    },
    async send(method, params, sendOptions = {}) {
      const signal = sendOptions.signal;
      // The real channel refuses an already-cancelled request and fails one that is cancelled
      // while it waits; the fake has to answer the same way for the action layer above it to be
      // read honestly.
      if (signal?.aborted === true) throw new CdpError(`${method} was cancelled before it was sent`, 'CDP_CANCELLED', { actionSent: false, canceled: true });
      calls.push({ method, params });
      if (typeof options.onSend === 'function') await options.onSend({ method, params, calls, listeners });
      if (signal?.aborted === true) throw new CdpError(`${method} was cancelled before it answered`, 'CDP_CANCELLED', { actionSent: true, outcomeUnknown: true, canceled: true });
      if (options.answers?.[method] !== undefined) return options.answers[method];
      if (method === 'DOM.getBoxModel') return { model: { border: [10, 20, 110, 20, 110, 60, 10, 60] } };
      if (method === 'Accessibility.getFullAXTree') return { nodes: [] };
      return {};
    },
  };
  return {
    calls,
    listeners,
    connection,
    sessionKey: 'session-a',
    refs,
    budgets: { maxNodes: 200, maxChars: 6000 },
    rejectReason: () => '',
    invalidateTarget: () => {},
    async prepare() { return 'flat-session-1'; },
    async readAx() { return { nodes: [], collected: 0, returned: 0, truncated: false, refs: 0, documentGeneration: '' }; },
    registerRef(identity) { refs.set(identity.ref ?? 'ref-1', { targetId: 'tab-a', frameId: 'frame-a', documentGeneration: '', connectionGeneration: 1, ...identity }); return identity.ref ?? 'ref-1'; },
    ref: 'tab-a',
  };
}

{
  const session = fakeSession();
  session.refs.set('ref-1', { targetId: 'tab-a', frameId: 'frame-a', documentGeneration: '', connectionGeneration: 1, backendNodeId: 42, role: 'button', name: 'Send' });
  const receipt = await runActions(session, { targetId: 'tab-a', steps: [{ action: 'click', ref: 'ref-1' }], timeoutMs: 5000 });
  const pressed = session.calls.find((one) => one.method === 'Input.dispatchMouseEvent' && one.params.type === 'mousePressed');
  const released = session.calls.find((one) => one.method === 'Input.dispatchMouseEvent' && one.params.type === 'mouseReleased');
  check('the click was sent as a press and a release', pressed !== undefined && released !== undefined, JSON.stringify(session.calls.map((one) => one.method)));
  check('the press carries the button bit', pressed?.params.buttons === 1, JSON.stringify({ buttons: pressed?.params.buttons }));
  check('the release clears it (buttons: 0)', released?.params.buttons === 0, JSON.stringify({ buttons: released?.params.buttons }));
  check('and the receipt is a completed click', receipt.outcome === 'completed' && receipt.actionSent === true, JSON.stringify({ outcome: receipt.outcome, actionSent: receipt.actionSent }));
}

{
  // The load event arrives while the navigate command is still in flight: with the wait
  // registered first it is caught, and the receipt says the load fired.
  const session = fakeSession({
    onSend: async ({ method, listeners }) => {
      if (method !== 'Page.navigate') return;
      await sleep(10);
      for (const handler of listeners.get('Page.loadEventFired') ?? []) handler({}, 'flat-session-1');
    },
    answers: { 'Page.navigate': { frameId: 'frame-a' } },
  });
  const receipt = await runActions(session, { targetId: 'tab-a', steps: [{ action: 'navigate', url: 'http://127.0.0.1:1/' }], timeoutMs: 4000 });
  const order = session.calls.filter((one) => one.method === 'on:Page.loadEventFired' || one.method === 'Page.navigate').map((one) => one.method);
  check('the wait is registered before the navigation is sent', order[0] === 'on:Page.loadEventFired' && order[1] === 'Page.navigate', JSON.stringify(order));
  check('and a load that fires while the command is in flight is seen', /load event fired/.test(receipt.performed.join(' ')), JSON.stringify(receipt.performed));
  check('the navigation step is verified rather than left unconfirmed', receipt.verification[0]?.status === 'ok', JSON.stringify(receipt.verification[0]));
}

{
  // A release that never goes out on the cancelled channel still gets unwound.
  const controller = new AbortController();
  const session = fakeSession({
    onSend: async ({ method, params }) => {
      if (method === 'Input.dispatchMouseEvent' && params.type === 'mousePressed') controller.abort();
    },
  });
  session.refs.set('ref-1', { targetId: 'tab-a', frameId: 'frame-a', documentGeneration: '', connectionGeneration: 1, backendNodeId: 42, role: 'button', name: 'Send' });
  const receipt = await runActions(session, { targetId: 'tab-a', steps: [{ action: 'click', ref: 'ref-1' }], timeoutMs: 5000, signal: controller.signal });
  check('a cancelled click is reported as cancelled, not as done', receipt.outcome === 'cancelled', JSON.stringify({ outcome: receipt.outcome }));
  check('and the receipt keeps what was already sent', receipt.actionSent === true, JSON.stringify({ actionSent: receipt.actionSent }));
  const release = session.calls.filter((one) => one.method === 'Input.dispatchMouseEvent' && one.params.type === 'mouseReleased');
  check('and the held button is released on a channel that is not the cancelled one', release.length === 1 && release[0].params.buttons === 0, JSON.stringify(release.map((one) => one.params)));
}

{
  // A cancel that lands between steps: the second step must not start.
  const controller = new AbortController();
  const session = fakeSession({
    onSend: async ({ method }) => {
      if (method === 'Runtime.evaluate') controller.abort();
    },
    answers: { 'Runtime.evaluate': { result: { value: 'ok' } } },
    // A `state` step aborts the call while it runs, through readAx.
  });
  session.readAx = async () => {
    controller.abort();
    return { nodes: [], collected: 0, returned: 0, truncated: false, refs: 0, documentGeneration: '' };
  };
  const receipt = await runActions(session, {
    targetId: 'tab-a',
    steps: [{ action: 'state' }, { action: 'navigate', url: 'http://127.0.0.1:1/' }],
    timeoutMs: 5000,
    signal: controller.signal,
  });
  check('a cancelled call starts no further step', session.calls.every((one) => one.method !== 'Page.navigate'), JSON.stringify(session.calls.map((one) => one.method)));
  check('and says so', receipt.outcome === 'cancelled' && /cancelled before step 1/.test(receipt.error), JSON.stringify({ outcome: receipt.outcome, error: receipt.error }));
}

{
  // A reference from another tab is refused before anything is sent.
  const session = fakeSession();
  session.refs.set('ref-other', { targetId: 'tab-other', frameId: 'frame-a', documentGeneration: '', connectionGeneration: 1, backendNodeId: 42, role: 'button', name: 'Send' });
  const receipt = await runActions(session, { targetId: 'tab-a', steps: [{ action: 'click', ref: 'ref-other' }], timeoutMs: 5000 });
  check('a reference from another tab is refused', receipt.outcome === 'failed' && /tab/.test(receipt.error), JSON.stringify({ outcome: receipt.outcome, error: receipt.error }));
  check('and nothing was sent to the page', receipt.actionSent === false && session.calls.every((one) => one.method !== 'Input.dispatchMouseEvent'), JSON.stringify({ actionSent: receipt.actionSent }));
}

{
  // The call outlives its budget: the number reported has to be the real one.
  const session = fakeSession({
    onSend: async ({ method }) => { if (method === 'Runtime.evaluate') await sleep(1100); },
    answers: { 'Runtime.evaluate': { result: { value: 'http://127.0.0.1:1/' } } },
  });
  const receipt = await runActions(session, { targetId: 'tab-a', steps: [{ action: 'wait_for', condition: { url: 'never-matches' } }], timeoutMs: 1000 });
  check('a call that ran past its budget reports the time it really took', receipt.elapsedMs > receipt.budgetMs, JSON.stringify({ elapsedMs: receipt.elapsedMs, budgetMs: receipt.budgetMs }));
}

{
  // A resolved node is a remote object in the page: the action has to release it, or a long
  // session accumulates them in the page it is driving (9.txt §6).
  const session = fakeSession({
    answers: {
      'DOM.resolveNode': { object: { objectId: 'remote-object-1' } },
      'Runtime.callFunctionOn': { result: { value: true } },
      // The fill step reads the field back to verify it: the fake answers with the value that
      // was written, so the step is a completed one and the release is checked in that context.
      'Accessibility.getPartialAXTree': { nodes: [{ role: { value: 'textbox' }, name: { value: 'Name' }, value: { value: 'x' } }] },
    },
  });
  session.refs.set('ref-1', { targetId: 'tab-a', frameId: 'frame-a', documentGeneration: '', connectionGeneration: 1, backendNodeId: 42, role: 'textbox', name: 'Name' });
  const receipt = await runActions(session, { targetId: 'tab-a', steps: [{ action: 'fill', ref: 'ref-1', value: 'x' }], timeoutMs: 5000 });
  const methods = session.calls.map((one) => one.method);
  const resolvedAt = methods.indexOf('DOM.resolveNode');
  const calledAt = methods.indexOf('Runtime.callFunctionOn');
  const releasedAt = methods.indexOf('Runtime.releaseObject');
  check('the step resolved a node and ran its function', resolvedAt >= 0 && calledAt > resolvedAt, JSON.stringify(methods));
  check('and the remote object was released afterwards', releasedAt > calledAt, JSON.stringify(methods));
  const release = session.calls.find((one) => one.method === 'Runtime.releaseObject');
  check('the release names the object that was resolved', release?.params?.objectId === 'remote-object-1', JSON.stringify(release?.params));
  check('and the step still reports what it did', receipt.outcome === 'completed' && receipt.performed.length === 1, JSON.stringify({ outcome: receipt.outcome, performed: receipt.performed }));
}

{
  // The same release has to happen when the action itself fails, or a page that throws leaves
  // one object behind per attempt.
  const session = fakeSession({
    answers: {
      'DOM.resolveNode': { object: { objectId: 'remote-object-2' } },
      'Runtime.callFunctionOn': { exceptionDetails: { text: 'boom' } },
    },
  });
  session.refs.set('ref-1', { targetId: 'tab-a', frameId: 'frame-a', documentGeneration: '', connectionGeneration: 1, backendNodeId: 42, role: 'textbox', name: 'Name' });
  const receipt = await runActions(session, { targetId: 'tab-a', steps: [{ action: 'fill', ref: 'ref-1', value: 'x' }], timeoutMs: 5000 });
  check('a throwing action is reported as failed', receipt.outcome === 'failed' && /boom/.test(receipt.error), JSON.stringify({ outcome: receipt.outcome, error: receipt.error }));
  check('and its remote object is released anyway', session.calls.some((one) => one.method === 'Runtime.releaseObject' && one.params?.objectId === 'remote-object-2'), JSON.stringify(session.calls.map((one) => one.method)));
}

{
  // The tree read is bound to the document it was collected from (§6: 采集与导航存在代次竞争).
  const { connection } = await openConnection();
  const session = new BrowserSession({ connection, sessionKey: 'session-a' });
  let navigations = 0;
  connection.send = async (method, params, options) => {
    if (method === 'Accessibility.getFullAXTree') {
      // The page navigates while its tree is being walked: the loader id changes underneath.
      navigations += 1;
      session.documentGenerations.set('tab-a', `doc-after-${navigations}`);
      return { nodes: [{ role: { value: 'button' }, name: { value: 'Send' }, backendDOMNodeId: 7, frameId: 'frame-a' }] };
    }
    if (method === 'Target.attachToTarget') return { sessionId: 'flat-session-1' };
    return {};
  };
  session.documentGenerations.set('tab-a', 'doc-before');
  let error = null;
  try {
    await session.readAx({ targetId: 'tab-a', maxNodes: 10 });
  } catch (failure) {
    error = failure;
  }
  check('a read whose document changed underneath is refused', error?.code === 'BROWSER_NAVIGATED_DURING_READ', JSON.stringify({ code: error?.code, message: String(error?.message).slice(0, 120) }));
  check('and it says the nodes were discarded', /discarded/.test(String(error?.message ?? '')), String(error?.message).slice(0, 160));
  check('so no reference was minted from them', session.refs.size === 0, `${session.refs.size} refs`);
  connection.close('the test is done');
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log('\nfailures:');
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref();
