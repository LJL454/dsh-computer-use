/**
 * What a page looks like to this plugin, and what a reference into one means (8.txt §11).
 *
 * The shape of a node is the same shape the desktop reader uses — role, name, value, states
 * and a reference — because the model should not have to learn a second vocabulary to read a
 * browser. What is different is where the reference points: a browser node is identified by
 * the session, the connection generation, the target, the frame, the document generation and
 * the backend node id, and a navigation invalidates all of them even though the page looks
 * similar (§11). "SPA did not navigate" is why the node is also re-checked before it is acted
 * on, but that check belongs to the action layer.
 *
 * Budgets are the §11 engineering values: `max_nodes` 200 (up to 1000), `max_chars` 6000 (up
 * to 20000), `timeout_ms` 5000 (up to 30000), 4000 references and 64 snapshots per session.
 */

import { CdpError, listTargets } from './connection.mjs';

/** The starting budgets (§11), with the caps the plan names. */
export const BROWSER_BUDGETS = Object.freeze({
  maxNodes: { default: 200, max: 1000 },
  maxChars: { default: 6000, max: 20000 },
  timeoutMs: { default: 5000, max: 30000 },
  refsPerSession: 4000,
  snapshotsPerSession: 64,
});

/** Clamp one requested number into a budget's range. */
function clampBudget(value, spec) {
  const requested = Number(value);
  if (!Number.isFinite(requested) || requested <= 0) return spec.default;
  return Math.min(spec.max, Math.max(1, Math.round(requested)));
}

/** The states worth carrying out of an accessibility node. */
const STATE_PROPERTIES = new Set(['focused', 'disabled', 'expanded', 'selected', 'checked', 'required', 'readonly', 'invalid', 'modal', 'busy']);

/** A node's states, as flat strings, in a stable order. */
function statesOf(axNode) {
  const states = [];
  for (const property of Array.isArray(axNode?.properties) ? axNode.properties : []) {
    const name = String(property?.name ?? '');
    if (!STATE_PROPERTIES.has(name)) continue;
    const value = property?.value?.value;
    if (value === true) states.push(name);
    else if (typeof value === 'string' && value !== '' && value !== 'false') states.push(`${name}:${value}`);
  }
  return states;
}

/** One line of a node, the way the desktop reader writes them. */
export function formatBrowserNode(node) {
  const states = node.states.length > 0 ? ` [${node.states.join(',')}]` : '';
  const value = node.value === undefined || node.value === '' ? '' : ` = ${JSON.stringify(node.value)}`;
  return `${node.ref ? `[${node.ref}] ` : ''}${node.role} ${JSON.stringify(node.name)}${value}${states}`;
}

/**
 * One session's view of one browser: its references, its snapshots, and the document
 * generation each reference was minted against.
 */
export class BrowserSession {
  /**
   * @param options - `{ connection, sessionKey, budgets }`.
   */
  constructor(options) {
    this.connection = options.connection;
    this.sessionKey = String(options.sessionKey ?? '');
    this.budgets = options.budgets ?? BROWSER_BUDGETS;
    /** ref -> identity. Registered per session; never shared between sessions (§14). */
    this.refs = new Map();
    /** The last N snapshots, oldest first. */
    this.snapshots = [];
    this.snapshotSeq = 0;
    /** targetId -> the loader id of the document the refs were minted against. */
    this.documentGenerations = new Map();
    /** targetId -> the main frame the last read of that target came from (§5.10). */
    this.currentFrames = new Map();
    /** Which protocol domains a target has already had enabled. */
    this.enabled = new Set();
    /** Remove the event subscriptions when the session ends. */
    this.disposers = [];
    this.documentGenerationFor = this.documentGenerationFor.bind(this);
    this.disposers.push(this.connection.on('Page.frameNavigated', this.documentGenerationFor));
    this.disposers.push(this.connection.on('Page.navigatedWithinDocument', this.documentGenerationFor));
    this.disposers.push(this.connection.on('Target.targetDestroyed', (params) => {
      const targetId = String(params?.targetId ?? '');
      if (targetId !== '') this.invalidateTarget(targetId);
    }));
  }

  /** A navigation replaces the document; everything minted against the old one is stale. */
  documentGenerationFor(params, sessionId) {
    const frame = params?.frame ?? {};
    const parentId = frame.parentId;
    if (parentId !== undefined && parentId !== null && `${parentId}` !== '') return; // a subframe
    const targetId = this.targetForSession(sessionId);
    if (targetId === '') return;
    this.documentGenerations.set(targetId, String(frame.loaderId ?? ''));
    this.invalidateTarget(targetId, 'the page navigated, so the document these references were read from is gone');
  }

  /** Which target a flat session id belongs to. */
  targetForSession(sessionId) {
    for (const [targetId, entry] of this.connection.sessions) {
      if (entry.sessionId === String(sessionId)) return targetId;
    }
    return '';
  }

  /**
   * Every reference against one target becomes unusable, and remembers *why*.
   *
   * The entries are tombstoned rather than deleted: "this reference was read before the page
   * navigated" and "this reference was never mine" call for different next steps, and a
   * registry that forgot the difference could only say the second one (§13).
   */
  invalidateTarget(targetId, reason = 'the target is gone') {
    const key = String(targetId);
    let dropped = 0;
    for (const [, identity] of this.refs) {
      if (identity.targetId !== key) continue;
      if (identity.invalidated === undefined) {
        identity.invalidated = reason;
        dropped += 1;
      }
    }
    if (dropped > 0) this.lastInvalidation = { targetId: key, dropped, reason };
    return dropped;
  }

  /** How the plugin describes a browser when it is not attached (§13's failure table). */
  detachedNote(error) {
    const code = error instanceof CdpError ? error.code : '';
    if (code === 'ENDPOINT_NOT_LOCAL') return { status: 'not_local', note: String(error.message) };
    if (code === 'BAD_ENDPOINT') return { status: 'bad_endpoint', note: String(error.message) };
    if (code === 'CDP_MESSAGE_TOO_LARGE') return { status: 'protocol_error', note: String(error.message) };
    return {
      status: 'unavailable',
      note: `${error?.message ?? error} Nothing was read. The desktop tools are unaffected: this only means the browser channel is not usable right now.`,
    };
  }

  /** The tabs of the browser, straight from its target list. */
  async tabs(options = {}) {
    const listed = await listTargets(this.connection.endpoint, { timeoutMs: options.timeoutMs ?? 2000 });
    return listed
      .filter((one) => one.type === 'page')
      .map((one) => ({ id: one.id, title: one.title, url: one.url }));
  }

  /** Attach to a target and enable the domains this session needs for one kind of read. */
  async prepare(targetId, domains, options = {}) {
    const sessionId = await this.connection.attach(targetId, { timeoutMs: options.timeoutMs });
    for (const domain of domains) {
      const key = `${sessionId}|${domain}`;
      if (this.enabled.has(key)) continue;
      await this.connection.send(`${domain}.enable`, {}, { sessionId, timeoutMs: options.timeoutMs, signal: options.signal });
      this.enabled.add(key);
    }
    return sessionId;
  }

  /**
   * Register one node and hand back its reference.
   * @param identity - everything that would have to still be true for the reference to mean
   *   the same node: session, connection generation, target, frame, document generation and
   *   the backend node id.
   * @returns the reference.
   */
  registerRef(identity) {
    this.snapshotSeq += 1;
    const snapshot = `b${this.connection.generation}x${this.snapshotSeq}`;
    const ref = `${snapshot}.${this.refs.size}`;
    this.refs.set(ref, {
      ...identity,
      // The session is part of the identity, not just of the registry's own bookkeeping: a
      // reference is only ever meaningful for the conversation that read it (§5.10).
      sessionKey: this.sessionKey,
      snapshot,
      seq: this.snapshotSeq,
      connectionGeneration: this.connection.generation,
      mintedAt: Date.now(),
    });
    if (this.refs.size > this.budgets.refsPerSession) {
      const oldest = this.refs.keys().next().value;
      if (oldest !== undefined) this.refs.delete(oldest);
    }
    this.snapshots.push(snapshot);
    while (this.snapshots.length > this.budgets.snapshotsPerSession) this.snapshots.shift();
    return ref;
  }

  /**
   * Why a reference cannot be used, or '' when it can.
   *
   * The order matters: a reference from another connection generation is not "an element
   * that disappeared", and saying either of those things wrongly sends the caller down a
   * different path (§11, §13).
   */
  rejectReason(ref) {
    const identity = this.refs.get(String(ref));
    if (identity === undefined) return 'this reference is not in this session\'s registry (it belongs to another session, or to a read this session never made)';
    if (identity.sessionKey !== undefined && String(identity.sessionKey) !== this.sessionKey) return `this reference belongs to another conversation (session ${identity.sessionKey})`;
    if (identity.invalidated !== undefined) return String(identity.invalidated);
    if (identity.connectionGeneration !== this.connection.generation) return `this reference was minted over connection generation ${identity.connectionGeneration}, and the browser is now on generation ${this.connection.generation}`;
    const current = this.documentGenerations.get(identity.targetId);
    if (current !== undefined && identity.documentGeneration !== '' && current !== identity.documentGeneration) return `the page navigated since this reference was read (document ${identity.documentGeneration} -> ${current})`;
    // A frame the target no longer shows is the same kind of fact as a replaced document: the
    // node id belongs to a document that is not the one on screen any more (§5.10).
    const currentFrame = this.currentFrames.get(identity.targetId);
    if (currentFrame !== undefined && currentFrame !== '' && identity.frameId !== undefined && identity.frameId !== '' && currentFrame !== identity.frameId) return `the frame this reference was read from has been replaced (frame ${identity.frameId} -> ${currentFrame})`;
    return '';
  }

  /** Drop every subscription and reference this session holds. */
  dispose() {
    for (const dispose of this.disposers.splice(0)) {
      try { dispose(); } catch { /* nothing to undo */ }
    }
    this.refs.clear();
    this.snapshots.length = 0;
    this.documentGenerations.clear();
    this.currentFrames.clear();
    this.enabled.clear();
  }

  /**
   * Read the accessibility tree of one page, bounded.
   *
   * The whole tree is collected and then filtered locally, which is honest but not optimal:
   * the receipt reports `collected` separately from `returned` so the cost of a filtered read
   * is visible rather than hidden behind the host's own trimming (§11). A known target should
   * eventually query a subtree instead.
   * @param args - `{ targetId, filter, maxNodes, maxChars, timeoutMs, signal }`.
   * @returns the read, in the tool's shape.
   */
  async readAx(args) {
    const maxNodes = clampBudget(args.maxNodes, this.budgets.maxNodes);
    const maxChars = clampBudget(args.maxChars, this.budgets.maxChars);
    const sessionId = await this.prepare(String(args.targetId), ['Accessibility', 'Page'], args);
    const targetKey = String(args.targetId);
    // The document this read is *of*, before the tree is collected (§6 the collection/navigation
    // race): a page that navigates while its tree is being walked would otherwise hand back
    // nodes from one document with the generation of another, and every reference minted from
    // them would claim to belong to a document the caller is no longer looking at.
    const documentBefore = this.documentGenerations.get(targetKey) ?? '';
    const tree = await this.connection.send('Accessibility.getFullAXTree', {}, { sessionId, timeoutMs: args.timeoutMs, signal: args.signal });
    const documentAfter = this.documentGenerations.get(targetKey) ?? '';
    if (documentBefore !== '' && documentAfter !== documentBefore) {
      throw new CdpError(`the page navigated while its accessibility tree was being read (document ${documentBefore} -> ${documentAfter}), so the nodes in hand belong to neither of the two states in a way that could be acted on. Read it again — a second read of a page that has stopped navigating is exact. (element_lookup=discarded)`, 'BROWSER_NAVIGATED_DURING_READ');
    }
    const raw = Array.isArray(tree?.nodes) ? tree.nodes : [];
    const frameId = String(tree?.nodes?.[0]?.frameId ?? '');
    // What this target is showing *now*, so a reference read against an older frame is refused
    // rather than resolved against whatever carries that node id today (§5.10).
    if (frameId !== '') this.currentFrames.set(targetKey, frameId);
    const documentGeneration = documentAfter;
    const filter = String(args.filter ?? '').toLowerCase();
    const nodes = [];
    let chars = 0;
    let truncated = false;
    let returned = 0;
    for (const node of raw) {
      if (node?.ignored === true) continue;
      const role = String(node?.role?.value ?? '');
      const name = String(node?.name?.value ?? '');
      const value = node?.value?.value === undefined ? '' : String(node.value.value);
      if (filter !== '' && !`${role} ${name} ${value}`.toLowerCase().includes(filter)) continue;
      if (returned >= maxNodes) { truncated = true; break; }
      const states = statesOf(node);
      const lineLength = role.length + name.length + value.length + states.join(',').length;
      if (chars + lineLength > maxChars) { truncated = true; break; }
      chars += lineLength;
      returned += 1;
      const ref = this.registerRef({
        targetId: String(args.targetId),
        frameId,
        documentGeneration,
        backendNodeId: Number(node?.backendDOMNodeId ?? 0),
        role,
        name,
      });
      nodes.push({
        ref,
        role: role === '' ? 'unknown' : role,
        name,
        value,
        states,
        backendNodeId: Number(node?.backendDOMNodeId ?? 0),
      });
    }
    return {
      nodes,
      filter,
      collected: raw.length,
      returned: nodes.length,
      truncated,
      refs: this.refs.size,
      documentGeneration,
      budget: { max_nodes: maxNodes, max_chars: maxChars },
    };
  }

  /**
   * Read the visible text of one page, bounded at the page end.
   *
   * The slice happens inside the page, so a 2 MB document does not cross the protocol before
   * being trimmed (§11: 文本在页面端或协议读取阶段尽量限制范围).
   */
  async readText(args) {
    const maxChars = clampBudget(args.maxChars, this.budgets.maxChars);
    const sessionId = await this.prepare(String(args.targetId), ['Runtime', 'Page'], args);
    const expression = `(() => { const body = document.body; const full = body ? (body.innerText || '') : ''; return { total: full.length, text: full.slice(0, ${maxChars}) }; })()`;
    const evaluated = await this.connection.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false }, { sessionId, timeoutMs: args.timeoutMs, signal: args.signal });
    if (evaluated?.exceptionDetails !== undefined) {
      throw new CdpError(`reading the page text failed: ${evaluated.exceptionDetails.text ?? 'the page threw while the text was read'}`, 'CDP_PROTOCOL_ERROR');
    }
    const value = evaluated?.result?.value ?? {};
    const text = String(value.text ?? '');
    const total = Number(value.total ?? text.length);
    const documentGeneration = this.documentGenerations.get(String(args.targetId)) ?? '';
    return {
      text,
      total,
      truncated: total > text.length,
      returned_chars: text.length,
      documentGeneration,
      budget: { max_chars: maxChars },
    };
  }
}
