/**
 * Smoke test for the browser half.
 *
 * The client bundle is a `window.__ModuleLoader__.load` registration that needs
 * React and a DOM, neither of which exists in plain Node. This stands up the
 * smallest environment that can run it for real: a hook emulator, a recording
 * fetch, and a document stub. That is enough to prove the bundle registers under
 * the right id, claims the `conversation.input.left` slot with the right options,
 * renders the chip the reference design describes, and sends the toggle the host
 * route expects.
 *
 * The emulator is deliberately faithful about the three hook behaviours the chip's
 * correctness rests on:
 *
 *   * `useEffect` runs the previous cleanup before the next effect — otherwise an
 *     unmounted effect would be free to keep updating state, and the tests below
 *     could not catch it;
 *   * `useCallback` keeps its identity while its dependencies are unchanged, so an
 *     effect keyed on a callback does not restart on every render;
 *   * `useRef` survives re-renders, which is where the request bookkeeping lives.
 *
 *   node client-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`);
  }
}

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');

/**
 * The two intervals the sync loop uses, read out of the bundle so this test cannot drift
 * away from the code it is checking.
 */
const CONTROL_POLL_MS = Number(/const CONTROL_POLL_MS = (\d+)/u.exec(source)?.[1]);
const IDLE_SYNC_MS = Number(/const IDLE_SYNC_MS = (\d+)/u.exec(source)?.[1]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* --------------------------------------------------------------- React shim -- */

const hookStates = [];
const hookDeps = [];
const hookRefs = [];
const hookCallbacks = [];
const hookCallbackDeps = [];
const hookCleanups = [];
let hookIndex = 0;

/** React's dependency rule, in one place: same length and every entry `Object.is`. */
function depsChanged(previous, deps) {
  return previous === undefined
    || deps === undefined
    || deps.length !== previous.length
    || deps.some((value, index) => !Object.is(value, previous[index]));
}

const React = {
  createElement(type, props, ...children) {
    return { type, props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children } };
  },
  useState(initial) {
    const slot = hookIndex;
    hookIndex += 1;
    if (!(slot in hookStates)) hookStates[slot] = typeof initial === 'function' ? initial() : initial;
    return [hookStates[slot], (next) => {
      hookStates[slot] = typeof next === 'function' ? next(hookStates[slot]) : next;
    }];
  },
  useRef(initial) {
    const slot = hookIndex;
    hookIndex += 1;
    if (!(slot in hookRefs)) hookRefs[slot] = { current: initial };
    return hookRefs[slot];
  },
  useEffect(effect, deps) {
    const slot = hookIndex;
    hookIndex += 1;
    if (!depsChanged(hookDeps[slot], deps)) return;
    hookDeps[slot] = deps;
    // React runs the previous cleanup before the next effect. Without it, this emulator would
    // quietly allow an unmounted effect to keep updating state — the very bug several tests
    // below exist to catch.
    if (typeof hookCleanups[slot] === 'function') hookCleanups[slot]();
    hookCleanups[slot] = effect();
  },
  useCallback(fn, deps) {
    const slot = hookIndex;
    hookIndex += 1;
    if (depsChanged(hookCallbackDeps[slot], deps)) {
      hookCallbackDeps[slot] = deps;
      hookCallbacks[slot] = fn;
    }
    return hookCallbacks[slot];
  },
};

/* ------------------------------------------------------------ environment --- */

/** A listener registry small enough to see through, so "did the loop clean up?" is answerable. */
function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn({ type });
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

const documentTarget = eventTarget();
const windowTarget = eventTarget();

const registrations = [];
globalThis.window = {
  ...windowTarget,
  __ModuleLoader__: {
    load(registration) {
      registrations.push(registration);
    },
  },
};

const styleElements = [];
globalThis.document = {
  ...documentTarget,
  visibilityState: 'visible',
  getElementById: () => null,
  createElement: (tag) => ({ tag, id: '', textContent: '', setAttribute() {} }),
  head: { appendChild: (element) => styleElements.push(element) },
};

/* ---------------------------------------------------------------- the wire -- */

const requests = [];
let stateResponse = { enabled: false, ok: true, label: '电脑操作' };

/** Set to make the next POST answer with an HTTP failure instead of switching. */
let forcedPostFailure = null;

/**
 * When true, the next request resolves its headers immediately but holds the **body** until the
 * test delivers it. That is the "the cancel lost the race" case: the reply was already on the
 * wire, so only the chip's own epoch/sequence guard can keep it from repainting the switch.
 */
let slowBodyNext = false;
const heldBodies = [];

/** @returns an `AbortError` shaped the way `fetch` rejects. */
function abortError() {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

globalThis.fetch = (url, options = {}) => {
  const method = options.method ?? 'GET';
  const entry = { url, method, body: options.body, signal: options.signal };
  requests.push(entry);

  // Snapshot the payload *now*: a reply carries what the host said when it answered, which is
  // exactly what makes a late reply dangerous.
  let payload = stateResponse;
  if (method === 'POST') {
    const body = JSON.parse(options.body);
    if (forcedPostFailure !== null) {
      entry.failure = forcedPostFailure;
    } else {
      stateResponse = { ...stateResponse, ok: true, enabled: body.enabled };
      payload = stateResponse;
    }
  }
  entry.payload = payload;

  const answer = () => {
    if (entry.failure !== undefined) {
      const failure = entry.failure;
      return {
        ok: false,
        status: failure.status,
        async json() {
          return { ok: false, error: failure.error };
        },
      };
    }
    const held = slowBodyNext;
    slowBodyNext = false;
    return {
      ok: true,
      status: 200,
      json() {
        if (!held) return Promise.resolve(entry.payload);
        return new Promise((resolve) => {
          entry.deliver = () => resolve(entry.payload);
          heldBodies.push(entry);
        });
      },
    };
  };

  return new Promise((resolve, reject) => {
    const signal = options.signal;
    if (signal !== undefined) {
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      signal.addEventListener('abort', () => reject(abortError()));
    }
    resolve(answer());
  });
};

/** @returns the requests recorded so far, by method. */
const posted = () => requests.filter((request) => request.method === 'POST');
const read = () => requests.filter((request) => request.method === 'GET');

/* ------------------------------------------------------------------- drive -- */

console.log('\n== bundle registration ==');
check('calls window.__ModuleLoader__.load once', /__ModuleLoader__\s*\.\s*load\s*\(/.test(source));
check('declares the plugin id', source.includes("id: '@local/dsh-computer-use'"));
check('the sync loop keeps reading a settled chip', Number.isFinite(IDLE_SYNC_MS) && IDLE_SYNC_MS > CONTROL_POLL_MS, `CONTROL_POLL_MS=${CONTROL_POLL_MS} IDLE_SYNC_MS=${IDLE_SYNC_MS}`);

await import('./client.js');
check('registered exactly one bundle', registrations.length === 1, String(registrations.length));
const bundle = registrations[0];
check('bundle id is @local/dsh-computer-use', bundle.id === '@local/dsh-computer-use', bundle.id);
check('bundle exposes a factory', typeof bundle.factory === 'function');

const requireShim = (specifier) => {
  if (specifier === 'react') return React;
  throw new Error(`unexpected require in the client bundle: ${specifier}`);
};
const exports_ = bundle.factory(requireShim);
check('exports apply', typeof exports_.apply === 'function');
check("exports inject: ['slots']", Array.isArray(exports_.inject) && exports_.inject[0] === 'slots', JSON.stringify(exports_.inject));

console.log('\n== slot registration ==');
const injections = [];
const slotRegistrations = [];
const slotContext = {
  effect(fn) {
    fn();
    return () => {};
  },
  slots: {
    inject(key, factory) {
      injections.push(key);
      return factory();
    },
    register(options, component) {
      slotRegistrations.push({ options, component });
      return () => {};
    },
  },
};

exports_.apply(slotContext);
check('a style element was injected', styleElements.length === 1 && styleElements[0].textContent.includes('.dsh-cu-chip'));
check('injected into conversation.input.left', injections.length === 1 && injections[0] === 'conversation.input.left', injections.join(', '));
check('registered exactly one slot entry', slotRegistrations.length === 1, String(slotRegistrations.length));
const entry = slotRegistrations[0];
check('slot name is conversation.input.left', entry.options.name === 'conversation.input.left', entry.options.name);
check('entry id is computer-use', entry.options.id === 'computer-use', entry.options.id);
check('entry label is 电脑操作', entry.options.label === '电脑操作', entry.options.label);
check('entry declares an order', Number.isFinite(entry.options.order), String(entry.options.order));
check('entry does not reuse a shipped id', !['permission', 'plan', 'model', 'activity'].includes(entry.options.id), entry.options.id);

console.log('\n== render, capability off ==');
function render(props) {
  hookIndex = 0;
  return entry.component(props);
}

const off = render({ sessionId: 'session-1' });
check('renders a button', off.type === 'button', String(off.type));
check('uses the chip class', off.props.className === 'dsh-cu-chip', off.props.className);
check('aria-pressed=false while off', off.props['aria-pressed'] === false, String(off.props['aria-pressed']));
check('data-state=loading before the fetch resolves', off.props['data-state'] === 'loading', String(off.props['data-state']));
const labels = (Array.isArray(off.props.children) ? off.props.children : [off.props.children]);
const textSpan = labels.find((child) => child?.props?.className === 'dsh-cu-label');
check('label text is exactly 电脑操作', textSpan?.props?.children === '电脑操作', JSON.stringify(textSpan?.props?.children));
// The icon is its own component, so the svg only appears once it is invoked.
const iconSlot = labels.find((child) => typeof child?.type === 'function');
const icon = iconSlot === undefined ? undefined : iconSlot.type(iconSlot.props);
check('renders the monitor glyph', icon !== undefined && icon.type === 'svg' && icon.props.viewBox === '0 0 16 16', JSON.stringify(icon?.type));
check('the glyph is aria-hidden', icon?.props?.['aria-hidden'] === true);
check('the glyph has a screen, a stand and a base', Array.isArray(icon?.props?.children) && icon.props.children.length === 3);
check('renders the state dot', labels.some((child) => child?.props?.className === 'dsh-cu-dot'));
check('title explains what the chip does', String(off.props.title).includes('电脑操作'), String(off.props.title).slice(0, 50));

check('GET the state for this Session', requests.length === 1 && requests[0].url === '/computer-use/state?sessionId=session-1', JSON.stringify(requests[0]));
check('GET carries no body', requests[0].method === 'GET');

await sleep(10);
const ready = render({ sessionId: 'session-1' });
check('settles to data-state=off', ready.props['data-state'] === 'off', String(ready.props['data-state']));
check('a settled render does not refetch', requests.length === 1, `${requests.length} requests`);

console.log('\n== toggle on ==');
ready.props.onClick();
await sleep(10);
const post = posted()[0];
check('POSTs to the state route', post !== undefined && post.url === '/computer-use/state', JSON.stringify(requests.map((r) => `${r.method} ${r.url}`)));
check('POST body carries sessionId and enabled', JSON.parse(post.body).sessionId === 'session-1' && JSON.parse(post.body).enabled === true, post.body);

const on = render({ sessionId: 'session-1' });
check('settles to data-state=on', on.props['data-state'] === 'on', String(on.props['data-state']));
check('aria-pressed=true while on', on.props['aria-pressed'] === true, String(on.props['aria-pressed']));
check('title explains how to turn it off', String(on.props.title).includes('点击关闭'), String(on.props.title).slice(0, 60));

console.log('\n== toggle back off ==');
on.props.onClick();
await sleep(10);
const posts = posted();
check('second POST disables', posts.length === 2 && JSON.parse(posts[1].body).enabled === false, posts[1]?.body);
const offAgain = render({ sessionId: 'session-1' });
check('settles back to data-state=off', offAgain.props['data-state'] === 'off', String(offAgain.props['data-state']));

console.log('\n== unsupported platform ==');
// The host reports support separately from the grant, so the chip must be able to
// say "this build cannot do it here" instead of offering a toggle that would be
// refused server-side.
stateResponse = { ok: true, enabled: false, supported: false, reason: '电脑操作目前只实现了 Windows。' };
const beforeUnsupported = requests.length;
hookIndex = 0;
entry.component({ sessionId: 'session-unsupported' });
await sleep(10);
hookIndex = 0;
const unsupported = entry.component({ sessionId: 'session-unsupported' });
check('renders data-state=unsupported', unsupported.props['data-state'] === 'unsupported', String(unsupported.props['data-state']));
check('the chip is disabled', unsupported.props.disabled === true, String(unsupported.props.disabled));
check('aria-pressed stays false', unsupported.props['aria-pressed'] === false);
check('the title explains the platform limit', String(unsupported.props.title).includes('当前平台不支持'), String(unsupported.props.title).slice(0, 60));
check('the accessible name says so too', String(unsupported.props['aria-label']).includes('不支持'), String(unsupported.props['aria-label']));
unsupported.props.onClick();
await sleep(10);
check('clicking an unsupported chip sends nothing', requests.length === beforeUnsupported + 1, `${requests.length - beforeUnsupported} requests (expected only the GET)`);

console.log('\n== no Session ==');
hookIndex = 0;
const barren = entry.component({});
check('renders nothing without a sessionId', barren === null, JSON.stringify(barren));
check('and stops listening for wake-ups', documentTarget.listenerCount('visibilitychange') === 0 && windowTarget.listenerCount('focus') === 0);

/* ------------------------------------------- the switch's request lifecycle -- */

/** Mount or re-render one Session, with the hook cursor reset the way a real render would. */
const chipFor = (sessionId) => render({ sessionId });

console.log('\n== a second click in the same render pass sends one request ==');
stateResponse = { ok: true, enabled: false, control: { state: 'off', inFlight: 0, lease: null, lastAction: null } };
hookIndex = 0;
entry.component({ sessionId: 'session-double' });
await sleep(10);
const doubleChip = chipFor('session-double');
const beforeDouble = posted().length;
// Both clicks use the *same* closure, so `status.phase` is still 'ready' for the second one.
// Only the synchronous ref can refuse it.
doubleChip.props.onClick();
doubleChip.props.onClick();
await sleep(20);
check('exactly one POST goes out', posted().length === beforeDouble + 1, `${posted().length - beforeDouble} POSTs`);
const afterDouble = chipFor('session-double');
check('and the chip settles on the value the host confirmed', afterDouble.props['data-state'] === 'on', String(afterDouble.props['data-state']));

console.log('\n== a read already on the wire cannot overwrite a switch that landed ==');
stateResponse = { ok: true, enabled: false, control: { state: 'off', inFlight: 0, lease: null, lastAction: null } };
hookIndex = 0;
entry.component({ sessionId: 'session-late' });
await sleep(10);
// Hold the *body* of the next read: headers are answered, so the abort below cannot reach it.
// This is the "the cancel lost the race" case the sequence number exists for.
slowBodyNext = true;
documentTarget.dispatch('visibilitychange');
await sleep(10);
const lateRead = heldBodies.at(-1);
check('a read is on the wire with its reply held', lateRead !== undefined && lateRead.url.includes('session-late'), JSON.stringify(lateRead?.url));
const lateChip = chipFor('session-late');
lateChip.props.onClick();
await sleep(20);
check('the switch landed while that read was still out', chipFor('session-late').props['data-state'] === 'on', String(chipFor('session-late').props['data-state']));
lateRead.deliver();
await sleep(20);
const afterLate = chipFor('session-late');
check('the late reply, carrying the old value, is ignored', afterLate.props['data-state'] === 'on' && afterLate.props['aria-pressed'] === true, `${afterLate.props['data-state']} / ${afterLate.props['aria-pressed']}`);

console.log('\n== a switch that fails asks the host what actually happened ==');
stateResponse = { ok: true, enabled: true, control: { state: 'ready', inFlight: 0, lease: null, lastAction: null } };
hookIndex = 0;
entry.component({ sessionId: 'session-fail' });
await sleep(10);
const failChip = chipFor('session-fail');
check('starts on', failChip.props['data-state'] === 'on', String(failChip.props['data-state']));
const readsBeforeFailure = read().length;
forcedPostFailure = { status: 500, error: 'the host refused the switch' };
failChip.props.onClick();
await sleep(30);
forcedPostFailure = null;
const afterFailure = chipFor('session-fail');
check('a lost response triggers a confirming read', read().length > readsBeforeFailure, `${readsBeforeFailure} -> ${read().length}`);
check('the chip shows the position the host confirmed', afterFailure.props['data-state'] === 'on', String(afterFailure.props['data-state']));
check('and keeps the last confirmed switch position', afterFailure.props['aria-pressed'] === true, String(afterFailure.props['aria-pressed']));
// The confirming read succeeding must not erase the fact that the click did not take.
check('the failure is still reported after the read lands', afterFailure.props['data-warning'] === 'switch', String(afterFailure.props['data-warning']));
check("the server's own message survives", String(afterFailure.props.title).includes('the host refused the switch'), String(afterFailure.props.title).slice(0, 90));
check('and the accessible name carries it', String(afterFailure.props['aria-label']).includes('切换失败'), String(afterFailure.props['aria-label']));
check('a failed switch leaves the chip clickable', afterFailure.props.disabled === false, String(afterFailure.props.disabled));

console.log('\n== a switch whose confirming read also fails keeps the failure ==');
stateResponse = { ok: true, enabled: false, control: { state: 'off', inFlight: 0, lease: null, lastAction: null } };
hookIndex = 0;
entry.component({ sessionId: 'session-fail-twice' });
await sleep(10);
check('starts off', chipFor('session-fail-twice').props['data-state'] === 'off', String(chipFor('session-fail-twice').props['data-state']));
forcedPostFailure = { status: 503, error: 'the host is restarting' };
// Fail the switch *and* the read that would confirm it, so nothing can re-establish the position.
let failEveryRead = true;
const realFetch = globalThis.fetch;
globalThis.fetch = (url, options = {}) => {
  if (failEveryRead && (options.method ?? 'GET') === 'GET') {
    requests.push({ url, method: 'GET', body: undefined, signal: options.signal });
    const error = new Error('HTTP 503');
    error.status = 503;
    return Promise.resolve({ ok: false, status: 503, async json() { return { ok: false, error: 'the host is restarting' }; } });
  }
  return realFetch(url, options);
};
chipFor('session-fail-twice').props.onClick();
await sleep(40);
failEveryRead = false;
forcedPostFailure = null;
globalThis.fetch = realFetch;
const afterDoubleFailure = chipFor('session-fail-twice');
check('the chip stays in the error state', afterDoubleFailure.props['data-state'] === 'error', String(afterDoubleFailure.props['data-state']));
check('and says both that the switch failed and that nothing was read back', String(afterDoubleFailure.props.title).includes('the host is restarting') && String(afterDoubleFailure.props.title).includes('随后也没能读回状态'), String(afterDoubleFailure.props.title).slice(0, 110));
check('without claiming a fresh report of the position', !String(afterDoubleFailure.props.title).includes('主机现在报告的是'), String(afterDoubleFailure.props.title).slice(0, 110));
check('and the last confirmed position is still shown', afterDoubleFailure.props['aria-pressed'] === false, String(afterDoubleFailure.props['aria-pressed']));

console.log('\n== a previous Session cannot touch the next one ==');
stateResponse = { ok: true, enabled: false, control: { state: 'off', inFlight: 0, lease: null, lastAction: null } };
slowBodyNext = true;
hookIndex = 0;
entry.component({ sessionId: 'session-old' });
const oldRead = heldBodies.at(-1);
check('the old Session read is held', oldRead !== undefined, JSON.stringify(oldRead?.url));
stateResponse = { ok: true, enabled: true, control: { state: 'ready', inFlight: 0, lease: null, lastAction: null } };
hookIndex = 0;
entry.component({ sessionId: 'session-new' });
await sleep(20);
check('the new Session reads its own state', chipFor('session-new').props['data-state'] === 'on', String(chipFor('session-new').props['data-state']));
oldRead.deliver();
await sleep(20);
const afterSwitch = chipFor('session-new');
check('the old Session reply is discarded', afterSwitch.props['data-state'] === 'on' && afterSwitch.props['aria-pressed'] === true, `${afterSwitch.props['data-state']} / ${afterSwitch.props['aria-pressed']}`);

/* ------------------------------------------------- the control state, and sync -- */

console.log('\n== the control state the host reports ==');
// The switch and the activity are separate facts: "on" is what the user granted, the
// control state is what the desktop is doing with it. A chip that can only say on/off
// shows "on" while a batch is mid-flight and while a stop is draining — the two moments
// the difference matters most.
stateResponse = {
  ok: true,
  enabled: true,
  control: {
    state: 'busy',
    inFlight: 2,
    lease: { owner: '…f3a1', idleMs: 120, held: true },
    lastAction: { what: 'batch 3 step(s)', at: Date.now(), ageMs: 120 },
  },
};
hookIndex = 0;
entry.component({ sessionId: 'session-control' });
await sleep(20);
const busyChip = chipFor('session-control');
check('the chip carries the control state', busyChip.props['data-control'] === 'busy', String(busyChip.props['data-control']));
check('data-state stays the switch position', busyChip.props['data-state'] === 'on', String(busyChip.props['data-state']));
check('data-state=busy is NOT used for a host-side call in flight', busyChip.props['data-state'] !== 'busy', String(busyChip.props['data-state']));
check('the title says what is being driven', String(busyChip.props.title).includes('执行中') && String(busyChip.props.title).includes('batch 3 step(s)'), String(busyChip.props.title));
check('and how many calls are in flight', String(busyChip.props.title).includes('2 个调用'), String(busyChip.props.title));
check('the accessible name carries it too', String(busyChip.props['aria-label']).includes('执行中'), String(busyChip.props['aria-label']));
check('a busy chip is still clickable, because clicking it is how a user stops it', busyChip.props.disabled === false, String(busyChip.props.disabled));

const beforePoll = read().length;
await sleep(CONTROL_POLL_MS + 200);
check('a busy chip keeps reading the state instead of going stale', read().length > beforePoll, `${beforePoll} -> ${read().length}`);

stateResponse = { ok: true, enabled: true, control: { state: 'stopping', inFlight: 1, lease: null, lastAction: null } };
await sleep(CONTROL_POLL_MS + 200);
const stoppingChip = chipFor('session-control');
check('a stop in progress reads as 停止中, not as off', stoppingChip.props['data-control'] === 'stopping' && stoppingChip.props['data-state'] === 'on', `${stoppingChip.props['data-control']} / ${stoppingChip.props['data-state']}`);
check('and the title says it is stopping', String(stoppingChip.props.title).includes('停止中'), String(stoppingChip.props.title));

stateResponse = { ok: true, enabled: false, control: { state: 'stopped', inFlight: 0, lease: null, lastAction: null } };
await sleep(CONTROL_POLL_MS + 200);
const stoppedChip = chipFor('session-control');
check('a revoked session reads as off with its control state named', stoppedChip.props['data-state'] === 'off' && stoppedChip.props['data-control'] === 'stopped', `${stoppedChip.props['data-state']} / ${stoppedChip.props['data-control']}`);
check('and the switch can be turned back on', stoppedChip.props.disabled === false, String(stoppedChip.props.disabled));

console.log('\n== a settled chip keeps syncing ==');
// The chip used to stop reading as soon as it saw ready/off/stopped, and nothing ever restarted
// it — so a change made anywhere else left this page showing a stale switch. These two checks
// pin the replacement: the periodic read, and the immediate read on wake-up.
const beforeIdle = read().length;
await sleep(IDLE_SYNC_MS + 400);
check('a settled chip keeps reading', read().length > beforeIdle, `${beforeIdle} -> ${read().length}`);

stateResponse = { ok: true, enabled: true, control: { state: 'ready', inFlight: 0, lease: null, lastAction: null } };
const beforeWake = read().length;
documentTarget.dispatch('visibilitychange');
await sleep(20);
check('and a wake-up reads immediately rather than waiting out the interval', read().length === beforeWake + 1, `${beforeWake} -> ${read().length}`);
const externallyOn = chipFor('session-control');
check('so an external change shows without a manual refresh', externallyOn.props['data-state'] === 'on' && externallyOn.props['aria-pressed'] === true, `${externallyOn.props['data-state']} / ${externallyOn.props['aria-pressed']}`);

console.log('\n== a hidden page pauses, and unmounting stops it ==');
check('the loop is listening while mounted', documentTarget.listenerCount('visibilitychange') === 1 && windowTarget.listenerCount('focus') === 1, `${documentTarget.listenerCount('visibilitychange')} / ${windowTarget.listenerCount('focus')}`);
globalThis.document.visibilityState = 'hidden';
const beforeHidden = read().length;
await sleep(IDLE_SYNC_MS + 400);
check('a hidden page does not keep asking', read().length - beforeHidden <= 1, `${beforeHidden} -> ${read().length}`);
globalThis.document.visibilityState = 'visible';

// Unmount the way the shell does: the Session goes away, so `sessionId` becomes undefined and
// the effect's cleanup must run. An effect that outlives its render would keep hitting the host
// forever, which is why this is asserted rather than assumed.
hookIndex = 0;
entry.component({});
const afterUnmount = read().length;
check('the listeners are removed on unmount', documentTarget.listenerCount('visibilitychange') === 0 && windowTarget.listenerCount('focus') === 0);
documentTarget.dispatch('visibilitychange');
windowTarget.dispatch('focus');
await sleep(20);
check('a wake-up after unmount sends nothing', read().length === afterUnmount, `${afterUnmount} -> ${read().length}`);
await sleep(IDLE_SYNC_MS + 400);
check('and no timer survives either', read().length === afterUnmount, `${afterUnmount} -> ${read().length}`);

console.log(`\n===== ${passed} passed, ${failures.length} failed =====`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
