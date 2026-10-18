/**
 * The browser's action layer (8.txt §12): the minimum closed loop — go somewhere, put text
 * in a field, press a thing, and come back with something that says whether it worked.
 *
 * Three rules shape every function here:
 *
 *   - **One deadline for the call.** Every step spends what is left of `timeoutMs`, so a call
 *     bounded to 15 s cannot become eight 15-second waits. A step that runs out of budget is
 *     reported as its own outcome rather than as a browser that hung.
 *   - **An action is sent once.** A write that has been dispatched is never replayed: if the
 *     connection drops after the click went out, the receipt says `actionSent: true` and
 *     `outcome: 'unknown'` — the one answer that stops a caller from clicking twice (§13).
 *   - **A reference is checked before it is used.** The identity a reference carries is
 *     verified against the current connection, target, frame and document, and the refusal
 *     says which of those changed (§11).
 *
 * Waiting for a navigation is an event, not a poll: `Page.loadEventFired` with the deadline
 * as its bound.
 */

import { CdpError } from './connection.mjs';

/** The call-level budget (§12): 15 s by default, 60 s at most. */
export const ACTION_BUDGET = Object.freeze({ defaultMs: 15000, maxMs: 60000 });

/** Clamp a requested call budget into its range. */
export function clampActionBudget(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested) || requested <= 0) return ACTION_BUDGET.defaultMs;
  return Math.min(ACTION_BUDGET.maxMs, Math.max(1000, Math.round(requested)));
}

/** The steps this layer understands today. */
export const BROWSER_ACTIONS = Object.freeze(['navigate', 'click', 'fill', 'type', 'upload', 'scroll', 'hover', 'press', 'select', 'tabs', 'wait_for', 'state']);

/**
 * Register the wait for one navigation, *before* the navigation is sent (§5.11).
 *
 * The listener has to exist before `Page.navigate` goes out: a cache-served or
 * same-origin navigation can fire `Page.loadEventFired` before the answer to the command
 * that caused it comes back, and a wait registered afterwards would sit there until its
 * budget ran out and report "the wait ran out" for a page that had already loaded.
 *
 * The wait also ends when the connection goes away (nothing that page does will be heard
 * again) and when the call is cancelled, rather than spending the rest of its budget on a
 * channel that is gone.
 * @param session - the BrowserSession holding the connection.
 * @param sessionId - the flat session id of the target being navigated.
 * @param args - `{ budgetMs, signal }`.
 * @returns `{ promise, cancel }`; the promise resolves to 'loaded' | 'timeout' | 'cancelled' | 'disconnected'.
 */
function startLoadWait(session, sessionId, args) {
  let disposeListener = () => {};
  let timer = null;
  let poll = null;
  const promise = new Promise((resolve) => {
    let settled = false;
    const done = (how) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      if (poll !== null) clearInterval(poll);
      if (args.signal !== undefined && args.signal !== null) {
        try { args.signal.removeEventListener('abort', onAbort); } catch { /* nothing to remove */ }
      }
      disposeListener();
      resolve(how);
    };
    const onAbort = () => done('cancelled');
    timer = setTimeout(() => done('timeout'), Math.max(250, Number(args.budgetMs ?? 0)));
    // The connection is the authority on whether the page can still be heard from; a wait that
    // outlives it would otherwise report a timeout for a channel that is simply gone.
    poll = setInterval(() => {
      if (session.connection.connected !== true) done('disconnected');
    }, 200);
    if (typeof poll?.unref === 'function') poll.unref();
    disposeListener = session.connection.on('Page.loadEventFired', (_params, eventSession) => {
      if (String(eventSession) === String(sessionId)) done('loaded');
    });
    if (args.signal !== undefined && args.signal !== null) {
      if (args.signal.aborted === true) done('cancelled');
      else args.signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  return { promise, cancel: () => { disposeListener(); if (poll !== null) clearInterval(poll); if (timer !== null) clearTimeout(timer); } };
}

/** How a navigation wait ended, in the words the receipt uses. */
function loadWaitNote(how) {
  if (how === 'loaded') return 'load event fired';
  if (how === 'cancelled') return 'the call was cancelled while waiting';
  if (how === 'disconnected') return 'the connection went away';
  return 'the wait ran out';
}

/** The box of a node, in CSS pixels, or null when the browser cannot produce one. */
async function boxOf(session, sessionId, backendNodeId, options) {
  try {
    const model = await session.connection.send('DOM.getBoxModel', { backendNodeId }, { sessionId, timeoutMs: options.timeoutMs, signal: options.signal });
    const quad = model?.model?.border;
    if (!Array.isArray(quad) || quad.length < 8) return null;
    const xs = [quad[0], quad[2], quad[4], quad[6]].map(Number);
    const ys = [quad[1], quad[3], quad[5], quad[7]].map(Number);
    const x = (Math.min(...xs) + Math.max(...xs)) / 2;
    const y = (Math.min(...ys) + Math.max(...ys)) / 2;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  } catch {
    return null;
  }
}

/** Run one JavaScript expression against a node and return its value. */
async function callOnNode(session, sessionId, backendNodeId, functionDeclaration, args, options) {
  const resolved = await session.connection.send('DOM.resolveNode', { backendNodeId }, { sessionId, timeoutMs: options.timeoutMs, signal: options.signal });
  const objectId = String(resolved?.object?.objectId ?? '');
  if (objectId === '') throw new CdpError('the node could not be resolved to a JavaScript object', 'CDP_PROTOCOL_ERROR');
  try {
    const called = await session.connection.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration,
      arguments: args ?? [],
      returnByValue: true,
      awaitPromise: true,
    }, { sessionId, timeoutMs: options.timeoutMs, signal: options.signal });
    if (called?.exceptionDetails !== undefined) {
      throw new CdpError(`the page threw while the action ran: ${called.exceptionDetails.text ?? 'unknown exception'}`, 'CDP_PROTOCOL_ERROR');
    }
    return called?.result?.value;
  } finally {
    // A resolved node is a remote object that lives in the page until it is released (§6:
    // 浏览器远程对象未显式释放): every action that resolved a node used to leave one behind,
    // and a long session accumulated them in the page it was driving. Best effort and
    // deliberately without the call's signal, so a cancelled action still cleans up after
    // itself; a page that has navigated away has dropped the object already.
    try {
      await session.connection.send('Runtime.releaseObject', { objectId }, { sessionId, timeoutMs: 2000 });
    } catch { /* the object is gone with its document, or the channel is */ }
  }
}

/**
 * What a reference means right now, or a refusal that names what changed.
 *
 * The target the step is acting on is part of the check (§5.10): a reference read from tab A
 * can otherwise be passed to a step that is running in tab B, and the node id would resolve
 * to whatever happens to carry that id in the other document. That is a wrong element being
 * clicked, which is the one failure a check like this exists to prevent.
 * @param session - the BrowserSession holding the references.
 * @param ref - the reference from a previous read.
 * @param targetId - the target this call is acting on right now.
 */
function resolveRef(session, ref, targetId) {
  const identity = session.refs.get(String(ref));
  if (identity !== undefined && targetId !== undefined && targetId !== null && `${targetId}` !== ''
    && String(identity.targetId) !== String(targetId)) {
    throw new CdpError(`the reference ${ref} was read from tab ${identity.targetId}, and this call is running in tab ${targetId}. Read that tab first (browser_state with \`tab\`: ${targetId}) and use the reference it returns.`, 'BROWSER_WRONG_TARGET');
  }
  const reason = session.rejectReason(ref);
  if (reason !== '') throw new CdpError(`the reference ${ref} cannot be used: ${reason}`, 'BROWSER_STALE_REF');
  return session.refs.get(String(ref));
}

/** The value the accessibility tree reports for one node. */
async function axValueOf(session, sessionId, backendNodeId, options) {
  const partial = await session.connection.send('Accessibility.getPartialAXTree', { backendNodeId, fetchRelatives: false }, { sessionId, timeoutMs: options.timeoutMs, signal: options.signal });
  const node = Array.isArray(partial?.nodes) ? partial.nodes[0] : undefined;
  if (node === undefined) return { found: false, role: '', name: '', value: '' };
  return {
    found: true,
    role: String(node.role?.value ?? ''),
    name: String(node.name?.value ?? ''),
    value: node.value?.value === undefined ? '' : String(node.value.value),
  };
}

/**
 * Run a sequence of browser actions in one call.
 *
 * @param session - the BrowserSession holding the references.
 * @param args - `{ targetId, steps, timeoutMs, signal }`.
 * @returns the receipt: what ran, what was sent, what was verified, and where to continue.
 */
export async function runActions(session, args) {
  const startedAt = Date.now();
  const totalMs = clampActionBudget(args.timeoutMs);
  const deadline = startedAt + totalMs;
  const steps = Array.isArray(args.steps) ? args.steps : [];
  const performed = [];
  const verification = [];
  let failedAt = -1;
  let actionSent = false;
  let outcome = 'completed';
  let error = '';
  /** A press that has gone out and not been answered by a release yet, so it can be unwound. */
  let held = null;
  const baseReceipt = () => ({
    performed: [...performed],
    verification: [...verification],
    failedAt,
    actionSent,
    outcome,
    error,
  });
  let sessionId = await session.prepare(String(args.targetId), ['Page', 'DOM', 'Runtime', 'Accessibility'], { timeoutMs: Math.max(500, deadline - Date.now()), signal: args.signal });
  let boundTarget = String(args.targetId);
  /** The last `state` step's read, so a receipt can carry it without a second call. */
  let lastStateRead = null;
  const options = () => ({ timeoutMs: Math.max(250, deadline - Date.now()), signal: args.signal });
  /** Release anything this call is still holding, on a channel that is not being cancelled. */
  const releaseHeld = async () => {
    const heldNow = held;
    held = null;
    if (heldNow === null) return;
    try {
      await session.connection.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: heldNow.x,
        y: heldNow.y,
        button: heldNow.button,
        clickCount: 1,
        // CDP's `buttons` is the set of buttons *still* down: a release clears its bit (§5.11).
        buttons: 0,
      }, { sessionId: heldNow.sessionId, timeoutMs: 750 });
    } catch { /* the page is gone; the receipt already says the click was not completed */ }
  };
  try {
      for (const [index, step] of steps.entries()) {
        const action = String(step?.action ?? '').toLowerCase();
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          failedAt = index;
          outcome = 'deadline';
          error = `the call's ${totalMs} ms budget ran out before step ${index}; the steps before it did run`;
          break;
        }
        // A cancelled call starts no further step: the signal is what the session revoke, the
        // chip's off switch and the caller's own timeout all arrive on (§5.1).
        if (args.signal !== undefined && args.signal !== null && args.signal.aborted === true) {
          failedAt = index;
          outcome = 'cancelled';
          error = `the call was cancelled before step ${index}${actionSent ? '; the steps before it did run' : ''}`;
          break;
        }
        try {
          if (!BROWSER_ACTIONS.includes(action)) {
            throw new CdpError(`unknown action "${action}" (this build understands: ${BROWSER_ACTIONS.join(', ')})`, 'BAD_REQUEST');
          }
          if (action === 'navigate') {
            const url = String(step.url ?? '');
            if (url === '') throw new CdpError('navigate needs a url', 'BAD_REQUEST');
            actionSent = true;
            // Registered before the navigation is sent, so a load that happens while the command
            // is still in flight is not missed (§5.11).
            const load = startLoadWait(session, sessionId, { budgetMs: Math.min(remaining, 8000), signal: args.signal });
            let navigated;
            try {
              navigated = await session.connection.send('Page.navigate', { url }, { sessionId, ...options() });
            } catch (sendFailure) {
              load.cancel();
              throw sendFailure;
            }
            const how = await load.promise;
            if (how === 'cancelled') {
              throw new CdpError(`the navigation to ${url} was sent, and the call was cancelled while waiting for it to load`, 'CDP_CANCELLED', { canceled: true, actionSent: true, outcomeUnknown: true });
            }
            if (how === 'disconnected') {
              throw new CdpError(`the navigation to ${url} was sent, and the connection went away before it loaded`, 'CDP_DISCONNECTED', { actionSent: true, outcomeUnknown: true });
            }
            // A navigate whose document was replaced invalidates the references minted before it;
            // the loader id of the new document is what the next read will bind to.
            session.invalidateTarget(String(boundTarget), 'the page navigated');
            performed.push(`navigate ${url} (${loadWaitNote(how)})`);
            verification.push({ step: index, kind: 'navigation', status: navigated?.errorText === undefined ? (how === 'loaded' ? 'ok' : 'unconfirmed') : 'failed', note: String(navigated?.errorText ?? (how === 'loaded' ? '' : loadWaitNote(how))) });
            if (navigated?.errorText !== undefined && String(navigated.errorText) !== '') {
              failedAt = index;
              outcome = 'failed';
              error = `the browser refused the navigation: ${navigated.errorText}`;
              break;
            }
            continue;
          }
        if (action === 'state') {
          const read = await session.readAx({ targetId: boundTarget, filter: step.filter, maxNodes: step.max_nodes, maxChars: step.max_chars, timeoutMs: Math.max(250, deadline - Date.now()), signal: args.signal });
          lastStateRead = read;
          performed.push(`state: ${read.returned} of ${read.collected} node(s)${read.truncated ? ', truncated' : ''}`);
          verification.push({ step: index, kind: 'state', status: 'ok', note: `${read.returned} node(s)` });
          continue;
        }
        // click / fill both need a usable reference and a node the protocol can address.
        if (action === 'tabs') {
          // Tab management is page-level work: it goes to the browser, not to a page's session.
          // Closing the tab a call was working in is the one operation that invalidates
          // everything after it, so it is said out loud rather than left to fail obscurely.
          const operation = String(step.operation ?? 'list').toLowerCase();
          const listed = await session.tabs({ timeoutMs: Math.max(500, deadline - Date.now()) });
          if (operation === 'list') {
            performed.push(`tabs: ${listed.map((one) => `${one.id} "${one.title}"`).join('; ') || '(none)'}`);
            verification.push({ step: index, kind: 'target', status: 'ok', note: `${listed.length} page(s) open` });
            continue;
          }
          if (operation === 'create') {
            actionSent = true;
            const url = String(step.url ?? 'about:blank');
            const created = await session.connection.send('Target.createTarget', { url, background: false }, options());
            const newId = String(created?.targetId ?? '');
            if (newId === '') throw new CdpError(`the browser created no target for ${url}`, 'CDP_PROTOCOL_ERROR');
            // Later steps in this call act on the new tab: a `tabs create` is usually followed by
            // reading or filling the thing it opened.
            session.boundTargetId = newId;
            boundTarget = newId;
            sessionId = await session.prepare(newId, ['Page', 'DOM', 'Runtime', 'Accessibility'], { timeoutMs: Math.max(500, deadline - Date.now()), signal: args.signal });
            performed.push(`tabs create ${url} -> ${newId}`);
            verification.push({ step: index, kind: 'target', status: 'ok', note: `bound this call to the new tab ${newId}` });
            continue;
          }
          if (operation === 'activate') {
            const wanted = String(step.tab ?? boundTarget);
            await session.connection.send('Target.activateTarget', { targetId: wanted }, options());
            session.boundTargetId = wanted;
            boundTarget = wanted;
            sessionId = await session.prepare(wanted, ['Page', 'DOM', 'Runtime', 'Accessibility'], { timeoutMs: Math.max(500, deadline - Date.now()), signal: args.signal });
            performed.push(`tabs activate ${wanted}`);
            verification.push({ step: index, kind: 'target', status: 'not_verified', note: 'the tab was asked to come forward; whether it is on screen is not something this protocol reports' });
            continue;
          }
          if (operation === 'close') {
            const wanted = String(step.tab ?? boundTarget);
            actionSent = true;
            const closed = await session.connection.send('Target.closeTarget', { targetId: wanted }, options());
            session.connection.detachSession(wanted);
            performed.push(`tabs close ${wanted}${closed?.success === false ? ' (the browser refused)' : ''}`);
            verification.push({ step: index, kind: 'target', status: closed?.success === false ? 'failed' : 'ok', note: closed?.success === false ? 'the browser did not close it' : 'the tab is closed' });
            if (wanted === boundTarget) {
              session.boundTargetId = undefined;
              if (index + 1 < steps.length) {
                failedAt = index;
                outcome = 'failed';
                error = 'that was the tab this call was working in, so the steps after it have no page. Pass another tab and continue.';
                break;
              }
            }
            continue;
          }
          throw new CdpError(`unknown tabs operation "${operation}" (this build understands: list, create, activate, close)`, 'BAD_REQUEST');
        }
        if (action === 'wait_for') {
          // A wait is a *condition*, not a sleep (§12): it re-checks, spends what is left of the
          // call budget, and answers `ok` or `timeout` with what it last saw. A page that never
          // satisfies it fails its step instead of quietly continuing into the next one.
          const condition = step.condition ?? {};
          const wanted = String(condition.name ?? condition.text ?? '');
          const wantedUrl = String(condition.url ?? '');
          if (wanted === '' && wantedUrl === '') {
            throw new CdpError('wait_for needs a condition: a name/text to appear, or a url substring', 'BAD_REQUEST');
          }
          let satisfied = false;
          let lastNote = 'nothing was checked yet';
          while (Date.now() < deadline) {
            if (wantedUrl !== '') {
              const evaluated = await session.connection.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }, { sessionId, ...options() });
              const href = String(evaluated?.result?.value ?? '');
              lastNote = `location.href is ${href}`;
              if (href.includes(wantedUrl)) { satisfied = true; break; }
            } else {
              const read = await session.readAx({ targetId: boundTarget, filter: wanted, maxNodes: 5, timeoutMs: Math.max(250, deadline - Date.now()), signal: args.signal });
              lastNote = read.nodes.length > 0 ? `${read.nodes.length} node(s) match ${JSON.stringify(wanted)}` : `nothing in the tree matches ${JSON.stringify(wanted)} yet`;
              if (read.nodes.length > 0) { satisfied = true; break; }
            }
            await new Promise((resolve) => setTimeout(resolve, Math.min(200, Math.max(50, deadline - Date.now()))));
          }
          performed.push(`wait_for ${wanted !== '' ? JSON.stringify(wanted) : wantedUrl} — ${satisfied ? 'satisfied' : 'timed out'}`);
          verification.push({ step: index, kind: 'condition', status: satisfied ? 'ok' : 'timeout', note: lastNote });
          if (!satisfied) {
            failedAt = index;
            outcome = 'failed';
            error = `the condition (${wanted !== '' ? JSON.stringify(wanted) : wantedUrl}) did not hold before the call's budget ran out`;
            break;
          }
          continue;
        }
        if (action === 'upload') {
          // The file paths are paths on the machine the browser runs on — which, since the
          // endpoint is loopback only, is this machine. There is no upload over the network here.
          const files = Array.isArray(step.files) ? step.files.map((one) => String(one)).filter((one) => one !== '') : [];
          if (files.length === 0) throw new CdpError('upload needs at least one file path', 'BAD_REQUEST');
          const identity = resolveRef(session, step?.ref, boundTarget);
          actionSent = true;
          await session.connection.send('DOM.setFileInputFiles', { files, backendNodeId: identity.backendNodeId }, { sessionId, ...options() });
          // The input's own file list is the page's answer — the accessibility tree does not carry
          // file names, so asking the element is the only real verification available.
          const attached = await callOnNode(session, sessionId, identity.backendNodeId, 'function () { return Array.from(this.files ?? []).map((one) => one.name); }', [], options());
          const names = Array.isArray(attached) ? attached.map((one) => String(one)) : [];
          const ok = files.every((one) => names.includes(String(one).split(/[\\/]/).pop()));
          performed.push(`upload ${files.length} file(s) into ${identity.role} "${identity.name}"`);
          verification.push({
            step: index,
            kind: 'files',
            status: ok ? 'ok' : 'mismatch',
            note: ok ? `the input now holds ${JSON.stringify(names)}` : `the input reports ${JSON.stringify(names)}, not the files that were sent`,
          });
          if (!ok) {
            failedAt = index;
            outcome = 'failed';
            error = `the input did not take the files (it holds ${JSON.stringify(names)})`;
            break;
          }
          continue;
        }
        if (action === 'hover') {
          const identity = resolveRef(session, step?.ref, boundTarget);
          const box = await boxOf(session, sessionId, identity.backendNodeId, options());
          if (box === null) throw new CdpError('this element has no layout box, so there is nothing to move the pointer onto', 'BROWSER_NO_NODE');
          actionSent = true;
          await session.connection.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, button: 'none' }, { sessionId, ...options() });
          // A hover is verifiable after all: the page itself knows whether the pointer is over
          // the element. "Moved the mouse" is not evidence; `:hover` is.
          const hovered = await callOnNode(session, sessionId, identity.backendNodeId, 'function () { return this.matches(":hover") === true; }', [], options());
          performed.push(`hover ${identity.role} "${identity.name}"`);
          verification.push({
            step: index,
            kind: 'hover',
            status: hovered === true ? 'ok' : 'unconfirmed',
            note: hovered === true
              ? 'the element reports :hover'
              : 'the pointer was moved onto it, but the element does not report :hover — it may be overlapped, or the hover styles may belong to a parent',
          });
          continue;
        }
        if (action === 'press') {
          const key = String(step.key ?? '');
          if (key === '') throw new CdpError('press needs a key (e.g. "Enter", "Tab", "Escape")', 'BAD_REQUEST');
          if (typeof step.ref === 'string' && step.ref !== '') {
            const identity = resolveRef(session, step.ref, boundTarget);
            await session.connection.send('DOM.focus', { backendNodeId: identity.backendNodeId }, { sessionId, ...options() });
          }
          actionSent = true;
          const code = String(step.code ?? key);
          await session.connection.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code }, { sessionId, ...options() });
          await session.connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code }, { sessionId, ...options() });
          performed.push(`press ${key}`);
          if (step.verify !== undefined && step.verify !== null) {
            const wanted = String(step.verify.name ?? step.verify.text ?? '');
            const read = await session.readAx({ targetId: boundTarget, filter: wanted, maxNodes: 25, timeoutMs: Math.max(250, deadline - Date.now()), signal: args.signal });
            const found = read.nodes.length > 0;
            verification.push({ step: index, kind: 'presence', status: found ? 'ok' : 'missing', note: found ? `${read.nodes.length} match(es) for ${JSON.stringify(wanted)}` : `nothing in the tree matches ${JSON.stringify(wanted)}` });
            if (!found) {
              failedAt = index;
              outcome = 'failed';
              error = `the key was delivered, but ${JSON.stringify(wanted)} is not in the page`;
              break;
            }
          } else {
            verification.push({ step: index, kind: 'key', status: 'not_verified', note: 'the key was delivered; nothing was read back, so give the step a `verify` or follow it with a `state` step' });
          }
          continue;
        }
        if (action === 'select') {
          const value = String(step.value ?? '');
          const identity = resolveRef(session, step?.ref, boundTarget);
          if (identity.backendNodeId === 0) throw new CdpError('this reference names a node the browser did not give a backend id for', 'BROWSER_NO_NODE');
          actionSent = true;
          const chosen = await callOnNode(session, sessionId, identity.backendNodeId, `function (value) {
            const el = this;
            const options = Array.from(el.options ?? []);
            const option = options.find((one) => one.value === value || one.label === value || one.text === value);
            if (option === undefined) return { ok: false, value: el.value, options: options.map((one) => one.value) };
            const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
            if (setter) setter.call(el, option.value); else el.value = option.value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, value: el.value };
          }`, [{ value }], options());
          const after = await axValueOf(session, sessionId, identity.backendNodeId, options());
          const ok = chosen?.ok === true;
          performed.push(`select ${JSON.stringify(value)} in ${identity.role} "${identity.name}"`);
          verification.push({
            step: index,
            kind: 'value',
            status: ok ? 'ok' : 'mismatch',
            note: ok
              ? `the control's value is now ${JSON.stringify(chosen.value)} (the tree shows ${JSON.stringify(after.value)})`
              : `no option matched ${JSON.stringify(value)}; the control offers ${JSON.stringify(chosen?.options ?? [])}`,
          });
          if (!ok) {
            failedAt = index;
            outcome = 'failed';
            error = `nothing in that control matches ${JSON.stringify(value)} (offered: ${JSON.stringify(chosen?.options ?? [])})`;
            break;
          }
          continue;
        }
        // click / fill / type all need a usable reference and a node the protocol can address.
        if (action === 'type') {
          const value = String(step.value ?? '');
          const identity = resolveRef(session, step?.ref, boundTarget);
          if (identity.backendNodeId === 0) throw new CdpError('this reference names a node the browser did not give a backend id for, so it cannot be focused', 'BROWSER_NO_NODE');
          actionSent = true;
          // The text goes in as *text*: focus first, then one `Input.insertText`, so the page
          // receives the characters the way a keyboard would deliver them rather than as a value
          // assignment a framework would never hear about. Typing appends, it does not replace.
          await session.connection.send('DOM.focus', { backendNodeId: identity.backendNodeId }, { sessionId, ...options() });
          await session.connection.send('Input.insertText', { text: value }, { sessionId, ...options() });
          const after = await axValueOf(session, sessionId, identity.backendNodeId, options());
          const ok = after.found && after.value.includes(value);
          performed.push(`type ${JSON.stringify(value)} into ${identity.role} "${identity.name}"`);
          verification.push({ step: index, kind: 'value', status: ok ? 'ok' : 'mismatch', note: ok ? 'the field reports the typed text' : `the field reports ${JSON.stringify(after.value)}` });
          if (!ok) {
            failedAt = index;
            outcome = 'failed';
            error = `the typed text did not arrive (the field reports ${JSON.stringify(after.value)})`;
            break;
          }
          continue;
        }
        if (action === 'scroll') {
          const dy = Number(step.dy ?? 0) || 0;
          const dx = Number(step.dx ?? 0) || 0;
          actionSent = true;
          const offset = () => session.connection.send('Runtime.evaluate', { expression: '({ x: window.scrollX, y: window.scrollY })', returnByValue: true }, { sessionId, ...options() });
          const from = (await offset())?.result?.value ?? { x: 0, y: 0 };
          if (typeof step.ref === 'string' && step.ref !== '') {
            const identity = resolveRef(session, step.ref, boundTarget);
            await session.connection.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: identity.backendNodeId }, { sessionId, ...options() });
          } else {
            // A wheel event is what a person produces, and it is what a page's own scroll
            // listener sees; `window.scrollTo` would be a different thing that often does not
            // fire the handler the page depends on.
            const metrics = await session.connection.send('Page.getLayoutMetrics', {}, { sessionId, ...options() });
            const view = metrics?.cssLayoutViewport ?? {};
            await session.connection.send('Input.dispatchMouseEvent', {
              type: 'mouseWheel',
              x: Math.round(Number(view.clientWidth ?? 800) / 2),
              y: Math.round(Number(view.clientHeight ?? 600) / 2),
              deltaX: dx,
              deltaY: dy,
              button: 'none',
            }, { sessionId, ...options() });
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
          const to = (await offset())?.result?.value ?? from;
          const moved = Number(to.y) !== Number(from.y) || Number(to.x) !== Number(from.x);
          performed.push(`scroll ${typeof step.ref === 'string' && step.ref !== '' ? `to ${step.ref}` : `by (${dx},${dy})`} — page offset ${from.x},${from.y} -> ${to.x},${to.y}`);
          // "It did not move" is an answer, not a failure: the page may already be at the end, or
          // may not scroll at all, and the two are worth telling apart from "the scroll broke".
          verification.push({ step: index, kind: 'scroll', status: moved ? 'ok' : 'unchanged', note: moved ? `the page is now at ${to.x},${to.y}` : `the page offset did not change (still ${to.x},${to.y}) — it may already have been at the end, or this page does not scroll` });
          continue;
        }
        const identity = resolveRef(session, step?.ref, boundTarget);
        if (identity.backendNodeId === 0) {
          throw new CdpError('this reference names a node the browser did not give a backend id for, so it cannot be addressed', 'BROWSER_NO_NODE');
        }
        if (action === 'fill') {
          const value = String(step.value ?? '');
          actionSent = true;
          // The value goes in through the page's own events: React and friends ignore a plain
          // `el.value = x`, and a caller that sees "filled" while the framework still holds the
          // old state is a caller that submits the wrong thing.
          await callOnNode(session, sessionId, identity.backendNodeId, `function (value) {
            const el = this;
            const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            el.focus();
            if (setter) setter.call(el, value); else el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return el.value;
          }`, [{ value }], options());
          const after = await axValueOf(session, sessionId, identity.backendNodeId, options());
          const ok = after.found && after.value === value;
          performed.push(`fill ${identity.role} "${identity.name}" = ${JSON.stringify(value)}`);
          verification.push({ step: index, kind: 'value', status: ok ? 'ok' : 'mismatch', note: ok ? 'the field reports the value that was written' : `the field reports ${JSON.stringify(after.value)}` });
          if (!ok) {
            failedAt = index;
            outcome = 'failed';
            error = `the field did not take the value (it reports ${JSON.stringify(after.value)})`;
            break;
          }
          continue;
        }
        // click
        actionSent = true;
        const box = await boxOf(session, sessionId, identity.backendNodeId, options());
        let clicked = 'protocol-input';
        if (box !== null) {
          // `buttons` is the CDP bitmask of the buttons that are *still down* when the event is
          // produced (Input domain), not "which button this event is about": a release that
          // keeps `buttons: 1` tells the page the left button is still held, which is how a
          // click becomes a drag or a selection (§5.11).
          const point = { x: box.x, y: box.y, button: 'left', clickCount: 1 };
          held = { sessionId, x: box.x, y: box.y, button: 'left' };
          await session.connection.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, buttons: 1 }, { sessionId, ...options() });
          await session.connection.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, buttons: 0 }, { sessionId, ...options() });
          held = null;
        } else {
          // No box means the node has no layout the browser will give us (hidden, or a provider
          // that does not answer): the element's own click is the honest fallback, and the
          // receipt says which one happened.
          await callOnNode(session, sessionId, identity.backendNodeId, 'function () { this.click(); return true; }', [], options());
          clicked = 'element-click';
        }
        performed.push(`click ${identity.role} "${identity.name}" (${clicked})`);
        // §12's verification: an action is not "done" because the events were sent. When the
        // caller named something to look for, look; otherwise say plainly that nothing was
        // verified rather than implying the click worked.
        if (step.verify !== undefined && step.verify !== null) {
          const wanted = String(step.verify.name ?? step.verify.text ?? '');
          const read = await session.readAx({ targetId: boundTarget, filter: wanted, maxNodes: 25, timeoutMs: Math.max(250, deadline - Date.now()), signal: args.signal });
          const found = read.nodes.length > 0;
          verification.push({ step: index, kind: 'presence', status: found ? 'ok' : 'missing', note: found ? `${read.nodes.length} match(es) for ${JSON.stringify(wanted)}` : `nothing in the tree matches ${JSON.stringify(wanted)}` });
          if (!found) {
            failedAt = index;
            outcome = 'failed';
            error = `the click was sent, but ${JSON.stringify(wanted)} is not in the page`;
            break;
          }
        } else {
          verification.push({ step: index, kind: 'presence', status: 'not_verified', note: 'the click was dispatched; nothing was read back, so this step is not confirmed' });
        }
      } catch (error_) {
        failedAt = index;
        error = error_ instanceof CdpError ? error_.message : String(error_);
        // A write that was already dispatched leaves the page in an unknown state: saying so is
        // the only honest answer, and it is what stops the caller from repeating it (§13).
        outcome = error_?.canceled === true ? 'cancelled' : (actionSent && error_?.outcomeUnknown === true ? 'unknown' : 'failed');
        if (outcome === 'failed' && error_?.code === 'BROWSER_STALE_REF') outcome = 'failed';
        // A press whose release never went out is unwound here, on a channel that is not the
        // cancelled one: leaving the page believing the button is still down turns the next
        // click into a drag (§5.11).
        await releaseHeld();
        break;
      }
    }
    return {
      performed,
      verification,
      failedAt,
      actionSent,
      outcome,
      error,
      // A `state` step already read the page; the caller should not have to pay a second call for
      // what this one saw.
      state: lastStateRead,
      nextStep: failedAt >= 0 ? failedAt + 1 : steps.length,
      budgetMs: totalMs,
      // The time the call actually took. It used to be reported as `budget - remaining`,
      // which is exactly the budget whenever the call ran long: a call that took 40 s of a
      // 15 s budget reported 15 s, so the number that should have shown the overrun hid it
      // (§5.11).
      elapsedMs: Date.now() - startedAt,
    };
  } catch (failure) {
    // Anything thrown out of the loop (a failed attach, an enable that never answered) still
    // carries the receipt: "nothing was sent" is a fact, and it is a different fact from
    // "this call produced no record of what it did" (9.txt §5.2).
    if (failure !== null && typeof failure === 'object' && failure.receipt === undefined) {
      try {
        failure.receipt = { ...baseReceipt(), outcome: outcome === 'completed' ? 'failed' : outcome, error: error === '' ? String(failure?.message ?? failure) : error };
      } catch { /* a frozen error keeps its own message */ }
    }
    throw failure;
  }
}
