/**
 * 工具契约层：模型可见的**值 schema**与**渲染文案**（9.txt §10"桌面/浏览器工具注册"那行的前半段）。
 *
 * 为什么单独成层：schema 与渲染是"这一族工具对外长什么样"的唯一定义处——参数取值、失败码、坐标口径、
 * 省略原因都写在这里。它们与后端、会话、租约没有任何关系（纯数据 + 纯函数），所以放在入口之外能让
 * "契约"与"装配"分开读：改口径时只看这一个文件，改接线时只看入口。
 *
 * 搬移方式与前面几批一致：**从 index.js 原样切出来**（脚本按括号配对取原文，只加 `export`），
 * 不重写、不调整顺序。`execute` 适配留在入口——那是装配的活。
 *
 * 唯一带状态的是内容摘要 memo（`observedDigests`）：它按内容寻址，属于纯函数的缓存，
 * 多实例共享不影响语义。
 */
import { createHash } from 'node:crypto';
// 批次步骤的动作清单来自失败契约模块（schema、描述与 worker 分发表共用的那一份，曾经有三份且互相
// 矛盾），所以这里**引用**它，而不是抄一份。
import { STEP_ACTION_LIST } from './failures.mjs';

/**
 * The declared image payload, mirroring `read_image`'s value schema so an
 * admitted capture is described the same way anywhere in the harness.
 *
 * Deliberately WITHOUT a top-level `required: true`: embedding it as
 * `image: IMAGE_VALUE_SCHEMA` would then make the field mandatory, and a
 * capture that could not be admitted legitimately has no image.
 */
export const IMAGE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    name: { type: 'string' },
    // 存储层缩放时附带：原图（重编码前）的像素尺寸。没有缩放时该字段缺席，所以不是 required。
    originalDimensions: {
      type: 'object',
      additionalProperties: false,
      properties: {
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
      },
    },
  },
};

/**
 * The pacing report of one capture: whether the wait for a still picture happened, what
 * it concluded, and what it spent.
 *
 * `state` is the honest half, and it is deliberately a word rather than a boolean: a
 * capture that skipped the wait and a capture that ran out of budget both used to read as
 * `stable: false`, which says "the screen is still moving" about a wait nobody asked for.
 *
 *   stable         two identical samples inside the budget -- the picture had stopped
 *   timeout        the budget ran out first; the frame is still the freshest one there is
 *   disabled       a write preceded this capture and the budget for it was 0 (the default)
 *   none           no recent write, so there was nothing to wait for
 *   other-target   the write went to a different window than this capture is of
 *   target-changed the foreground changed while waiting on a foreground capture
 *   target-lost    the window being watched went away
 *   capture-failed the watched region could not be read
 *
 * Every field is optional: a backend that predates this reports only `stable`.
 */
export const STABILITY_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  description: 'What the wait for a stable picture did on this capture.',
  properties: {
    state: { type: 'string' },
    stable: { type: 'boolean' },
    polls: { type: 'integer' },
    waitedMs: { type: 'integer' },
    budgetMs: { type: 'integer' },
    pollMs: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    resolvedBy: { type: 'string' },
    sampled: { type: 'string' },
    note: { type: 'string' },
    conflict: { type: 'string' },
  },
};

/** Shared output shape for the screenshot tool. */
export const SCREENSHOT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    imageWidth: { type: 'integer', required: true },
    imageHeight: { type: 'integer', required: true },
    scale: { type: 'number', required: true },
    format: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
    x: { type: 'integer', required: true },
    y: { type: 'integer', required: true },
    displays: { type: 'string', required: true },
    cursor: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: { x: { type: 'integer', required: true }, y: { type: 'integer', required: true } },
    },
    activeWindow: { type: 'string', required: true },
    source: { type: 'string' },
    // ---------------------------------------------------- the coordinate contract
    //
    // Four rectangles, kept apart because they answer four different questions. They used
    // to be one, which is how a *cropped* frame came to be described with the whole
    // window's geometry, and how a point measured in a delivered image could be projected
    // with arithmetic that only held while nothing had been cropped or scaled:
    //
    //   x/y/width/height  the region of the screen this frame is (what a click means)
    //   surface           the bitmap the pixels came out of, and where it sits
    //   crop              the sub-rectangle of that surface this image holds
    //   imageWidth/Height the file on disk, as the encoder sized it
    //   attachment        what the host delivered to the model, once it has said
    surfaceKind: { type: 'string', description: "Which bitmap the pixels came from: 'wholeWindow' (that window drew itself), 'clientArea' (its client area only), 'screenRegion', 'display' or 'virtualDesktop'." },
    units: { type: 'string', description: "The coordinate space every number in this receipt is in. Always 'physicalPixels': the desktop's own pixels, not the virtualized logical ones a DPI-unaware process would see — which is why a click coordinate and a region coordinate are the same kind of number here." },
    surface: {
      type: 'object',
      additionalProperties: false,
      description: 'The source bitmap and where it sits on the desktop. Its size is the bitmap\'s own; the frame may be a crop of it.',
      properties: {
        kind: { type: 'string', required: true },
        x: { type: 'integer', required: true },
        y: { type: 'integer', required: true },
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
      },
    },
    crop: {
      type: 'object',
      additionalProperties: false,
      description: 'The sub-rectangle of the surface that this image holds, in the surface\'s own pixels. Present when the frame is a region of a window.',
      properties: {
        x: { type: 'integer', required: true },
        y: { type: 'integer', required: true },
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
      },
    },
    scaleRequested: { type: 'number', description: 'The `scale` argument exactly as it was passed.' },
    scaleEffective: { type: 'number', description: 'The scale the image was actually produced at. It differs from `scaleRequested` when a magnification was asked for, because this backend only downscales — and the difference is stated rather than silently resolved.' },
    scaleNote: { type: 'string', description: 'Why the effective scale is not the requested one.' },
    windowRect: {
      type: 'object',
      additionalProperties: false,
      description: 'The whole window\'s rectangle on the desktop at capture time — separate from this frame\'s own geometry, which may be a crop of it. With `surface` and `crop` it is what makes "the window was not where I thought" distinguishable from "the projection was wrong".',
      properties: {
        x: { type: 'integer', required: true },
        y: { type: 'integer', required: true },
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
      },
    },
    captureSpanMs: { type: 'integer', description: 'How long the capture itself took inside the worker (settle floor + stability poll + pixels + encode), as a duration. The frame\'s own instants live on the worker\'s clock and are not comparable across processes, so the span is what travels.' },
    attachment: {
      type: 'object',
      additionalProperties: false,
      description: 'What the host delivered for this frame. `known: false` means no transform could be established, so a coordinate from that image is refused rather than guessed.',
      properties: {
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
        known: { type: 'boolean', required: true },
      },
    },
    verification: { type: 'array', items: { type: 'string' } },
    frame: { type: 'string' },
    window: {
      type: 'object',
      additionalProperties: false,
      properties: {
        hwnd: { type: 'integer', required: true },
        title: { type: 'string', required: true },
        process: { type: 'string', required: true },
        pid: { type: 'integer', required: true },
      },
    },
    unchanged: { type: 'boolean' },
    reused: { type: 'boolean' },
    clipped: { type: 'boolean' },
    timing: {
      type: 'object',
      additionalProperties: false,
      description: 'Where this capture spent its time inside the plugin, in milliseconds: the transport queue, the backend (the settle floor, the stability poll, the pixels and the encoding) and the attachment store.',
      properties: {
        captureMs: { type: 'integer', required: true },
        admitMs: { type: 'integer', required: true },
        queueMs: { type: 'integer', description: 'How long this call waited behind another call on the single worker before it was dispatched.' },
        startMs: { type: 'integer', description: 'How long waiting for the worker to become ready took before this call was even queued. Reported apart from `queueMs` so a slow start is not read as a slow capture (§7.5).' },
        backendMs: { type: 'integer', description: 'How long the capture took inside the worker, as the worker measured it.' },
        settleMs: { type: 'integer', description: 'The settle floor this capture actually spent waiting for the compositor.' },
        pollMs: { type: 'integer', description: 'The stability poll this capture actually spent.' },
        polls: { type: 'integer', description: 'How many samples the poll took.' },
      },
    },
    settledMs: { type: 'integer' },
    stable: { type: 'boolean' },
    afterLastWrite: { type: 'boolean', description: 'True: this frame shows the state after the last write; false: it was taken before it (a batch reusing a frame that a later step superseded). Absent when the question does not arise.' },
    stability: STABILITY_VALUE_SCHEMA,
    windowHwnd: { type: 'integer', description: 'With captures: related, the window this frame is of.' },
    relation: { type: 'string', description: "With captures: related, how this frame's window relates to the one that was asked for: 'self', or 'owned-popup' for a window whose ownership chain reaches it (a dialog, a popup menu, a tool window)." },
    zRank: { type: 'integer', description: "With captures: related, its position in the shell's real z-order (0 is topmost). Read `zRankKnown`: a window the enumeration did not list has no rank, and a rank of -1 is not \"below everything\"." },
    zRankKnown: { type: 'boolean' },
    ownerHwnd: { type: 'integer', description: 'With captures: related, the window that owns this one (0 when it is unowned).' },
    windowTitle: { type: 'string' },
    related: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
      description: "With captures: related, every window that was considered, front to back, with what decided it: owner chain, relation, rect, visibility, minimized, real z-rank, and when it was observed.",
    },
    omitted: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
      description: "With captures: related, the related windows that were NOT captured and why — over the frame budget, minimized (a capture would return the shell's placeholder), or a capture that failed.",
    },
    image: IMAGE_VALUE_SCHEMA,
    note: { type: 'string' },
  },
};

export const FRAME_ITEM_PROPERTIES = { ...SCREENSHOT_VALUE_SCHEMA.properties };

/** One row of a UI Automation tree. */
export const UIA_NODE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    depth: { type: 'integer', required: true },
    name: { type: 'string', required: true },
    controlType: { type: 'string', required: true },
    automationId: { type: 'string', required: true },
    className: { type: 'string', required: true },
    enabled: { type: 'boolean', required: true },
    offscreen: { type: 'boolean', required: true },
    x: { type: 'integer', required: true },
    y: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    patterns: { type: 'array', required: true, items: { type: 'string' } },
    ref: { type: 'string' },
    repeated: { type: 'integer' },
    merged: { type: 'integer' },
    mergedTruncated: { type: 'boolean' },
    delta: { type: 'string' },
  },
};

/** Which window an observation came from. */
export const UIA_WINDOW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    hwnd: { type: 'integer', required: true },
    title: { type: 'string', required: true },
    process: { type: 'string', required: true },
    pid: { type: 'integer', required: true },
  },
};

/**
 * A range-shaped text field: what was selected, or what the document says.
 *
 * `status` is part of the contract, not decoration: `unsupported` (the control has no
 * text pattern), `unavailable` (a named target no longer resolves), `target_required`
 * (nothing certain to read), `budget_exhausted` (an earlier field in the same read
 * spent the shared allowance) and `failed`. A field that could not be read never comes
 * back as an empty string, because "" is exactly what "there was nothing there" looks
 * like — and one of those two is worth retrying.
 */
export const UIA_TEXT_RANGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', required: true },
    value: { type: 'string' },
    truncated: { type: 'boolean' },
    note: { type: 'string' },
  },
};

/**
 * The text block of one read (8.txt §5 / B1).
 *
 * One state read can carry the text the next step needs — the focused control, what is
 * selected inside it, and, only when asked for, the document — so "read the window, then
 * read the text" stops being two model round trips. Every field shares one character
 * budget: B1 only pays off while the reply does not grow by a whole context window.
 */
export const UIA_TEXT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  description: 'The text this read carried (B1). Unrequested fields are absent, not null.',
  properties: {
    target: {
      type: 'object',
      additionalProperties: false,
      description: 'Which control the text was read from, and how it was found.',
      properties: {
        ok: { type: 'boolean', required: true },
        source: { type: 'string', required: true, description: "How the target was resolved: 'ref', 'selector', 'focused' or 'read-row'." },
        status: { type: 'string', description: 'target_required / unavailable when nothing was read.' },
        ref: { type: 'string', description: 'The ref of the control that was read — pass it to computer_ui_action to act on exactly this one.' },
        note: { type: 'string' },
      },
    },
    focused: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', required: true },
        summary: { type: 'string', description: 'One line: control type · name · value when the control holds a value.' },
        ref: { type: 'string' },
        truncated: { type: 'boolean' },
        note: { type: 'string' },
      },
    },
    selection: { ...UIA_TEXT_RANGE_SCHEMA, description: 'The text selected inside the target control.' },
    document: { ...UIA_TEXT_RANGE_SCHEMA, description: 'The document behind the target control (off unless explicitly requested).' },
    selected: {
      type: 'object',
      additionalProperties: false,
      description: 'The items selected in a list/tree control, read through SelectionPattern.',
      properties: {
        status: { type: 'string', required: true },
        count: { type: 'integer' },
        items: { type: 'array', items: { type: 'string' } },
        truncated: { type: 'boolean' },
        budgetExhausted: { type: 'boolean' },
        note: { type: 'string' },
      },
    },
    budget: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        max_chars: { type: 'integer', required: true },
        returned_chars: { type: 'integer', required: true },
        truncated: { type: 'boolean', required: true },
      },
    },
  },
};

export const UIA_STATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    window: { ...UIA_WINDOW_SCHEMA, required: true },
    nodes: { type: 'array', required: true, items: UIA_NODE_SCHEMA },
    truncated: { type: 'boolean', required: true },
    searched: { type: 'boolean', required: true },
    mode: { type: 'string', required: true },
    digest: { type: 'string', required: true },
    walked: { type: 'integer', required: true },
    skipped: { type: 'integer', required: true },
    cachePatterns: { type: 'integer', description: 'How many pattern properties the traversal asked the provider to cache. 0 when the read passed `patterns: false`, which is what makes that flag cheaper rather than merely shorter (§7.4). The COM engine reports it as well as the managed wrapper.' },
    pushdown: { type: 'array', items: { type: 'string' }, description: "Which of the caller's conditions were handed to the UI Automation provider itself instead of being filtered node by node afterwards (`automationId`, `controlType`). Only conditions that mean the same thing when pushed down are listed, so a search that names a control type in full is a smaller enumeration, while a partial one keeps the substring matching the caller asked for." },
    traversal: {
      type: 'object',
      additionalProperties: false,
      description: 'What the read cost, told apart from what it returned (§7.4 第 2 条): the output budget (`max_nodes`) and the traversal budget are different questions, and a tree of anonymous containers used to be walked with no bound of its own.',
      properties: {
        visited: { type: 'integer', required: true, description: 'Nodes the traversal actually looked at. This can be far larger than the number of rows returned when `skip_empty` drops them.' },
        maxQueue: { type: 'integer', required: true, description: 'The largest number of nodes waiting to be visited at any point.' },
        visitBudget: { type: 'integer', required: true, description: 'The traversal budget this read ran under. 0 means no limit.' },
        traversalTruncated: { type: 'boolean', required: true, description: 'True when the traversal budget — not the node budget — stopped the walk, so what came back is partial. Raise `max_visited`, read a narrower window, or search instead.' },
        elapsedMs: { type: 'integer', required: true, description: 'Milliseconds spent walking (or enumerating, for a search).' },
        providerSide: { type: 'boolean', description: 'True for a search, which enumerates inside the provider, so the client-side walk counts are zero by nature rather than because nothing was traversed.' },
        walks: { type: 'integer', description: 'How many traversals of the window this one read took, including re-walks after the client was re-created on purpose. A read that needed more than one is retry cost the caller is paying for, and it is bounded (§7.4).' },
        walkCap: { type: 'integer', description: 'The cap on those traversals for a single read.' },
        healthProbes: { type: 'integer', description: 'How many times the client was asked whether it is healthy. Each probe is a cross-process question, not a free check.' },
        resets: { type: 'integer', description: 'How many times the UI Automation client was re-created during this read.' },
      },
    },
    unchanged: { type: 'boolean' },
    settledMs: { type: 'integer' },
    snapshot: { type: 'string' },
    pruned: { type: 'integer' },
    delta: {
      type: 'object',
      additionalProperties: false,
      description: "Present when the read was asked for as a delta against an earlier snapshot. The rows in `nodes` are then the changes, not the whole tree.",
      properties: {
        base: { type: 'string', required: true },
        known: { type: 'boolean', required: true },
        added: { type: 'integer', required: true },
        moved: { type: 'integer', required: true },
        altered: { type: 'integer', required: true },
        removed: { type: 'integer', required: true },
        same: { type: 'integer', required: true },
        removedNodes: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ref: { type: 'string', required: true },
              name: { type: 'string', required: true },
              controlType: { type: 'string', required: true },
            },
          },
        },
      },
    },
    shot: SCREENSHOT_VALUE_SCHEMA,
    text: UIA_TEXT_SCHEMA,
    frames: {
      type: 'array',
      description: 'With captures: related, one frame per window that belongs to the read window (a dialog, a popup menu, a tool window), each with its own `frame` id to click through, its relation and its real z-rank. The image of each frame is attached to this reply.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          frame: { type: 'string', required: true },
          windowHwnd: { type: 'integer', required: true },
          relation: { type: 'string', required: true, description: "'self', or 'owned-popup' for a window whose ownership chain reaches the read window." },
          zRank: { type: 'integer' },
          zRankKnown: { type: 'boolean' },
          ownerHwnd: { type: 'integer' },
          windowTitle: { type: 'string' },
          x: { type: 'integer', required: true },
          y: { type: 'integer', required: true },
          width: { type: 'integer', required: true },
          height: { type: 'integer', required: true },
          imageWidth: { type: 'integer' },
          imageHeight: { type: 'integer' },
          scale: { type: 'number' },
          path: { type: 'string', required: true },
          source: { type: 'string' },
          image: IMAGE_VALUE_SCHEMA,
          note: { type: 'string' },
        },
      },
    },
    omitted: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
      description: 'With captures: related, the related windows that were not captured and why.',
    },
    legacy: { type: 'boolean', description: 'True when this tree came through the legacy (MSAA) accessibility bridge rather than the window\'s own provider: control types are generic panes and ids are numbers, so a control that should be there may be missing or unnamed.' },
    reinit: { type: 'boolean', description: 'True when the backend re-created its UI Automation client before answering, which happens when the client had stopped reading real properties.' },
    note: { type: 'string', description: 'Present when something about this read needs saying, e.g. that the worker was replaced because it had been answering through the legacy accessibility bridge.' },
  },
};

export const BROWSER_STATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true, description: "Which channel produced this: always 'cdp' (the browser's own protocol), never a screenshot of it." },
    view: { type: 'string', required: true, enum: ['tabs', 'ax', 'text', 'dom'] },
    browser: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        endpoint: { type: 'string', required: true },
        browser: { type: 'string' },
        protocolVersion: { type: 'string' },
        generation: { type: 'integer', required: true, description: 'The connection generation these references belong to; it goes up whenever the channel reconnects, and references from an older one are refused.' },
      },
    },
    tab: {
      type: 'object',
      additionalProperties: false,
      description: 'The tab this read is of.',
      properties: {
        id: { type: 'string', required: true },
        title: { type: 'string', required: true },
        url: { type: 'string', required: true },
        bound: { type: 'boolean', description: 'True when this session is now bound to that tab, so later calls without `tab` keep reading it.' },
      },
    },
    tabs: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
      description: 'The tabs that were listed. Returned instead of guessing a target when several are open and none was named.',
    },
    nodes: {
      type: 'array',
      description: 'The accessibility tree, in document order, each node carrying a `ref` the action layer can address.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ref: { type: 'string', required: true },
          role: { type: 'string', required: true },
          name: { type: 'string', required: true },
          value: { type: 'string', required: true },
          states: { type: 'array', required: true, items: { type: 'string' } },
          backendNodeId: { type: 'integer', required: true },
        },
      },
    },
    text: { type: 'string' },
    total: { type: 'integer', description: 'With view: text, how many characters the page holds in total — the number behind `truncated`.' },
    collected: { type: 'integer', description: 'How many nodes the browser was asked for (the cost of the read), before the budget and the filter.' },
    returned: { type: 'integer', description: 'How many nodes came back — kept apart from `collected` so host-side trimming is not mistaken for a cheaper read.' },
    returnedChars: { type: 'integer' },
    truncated: { type: 'boolean', required: true },
    refs: { type: 'integer', required: true, description: 'References this session holds.' },
    snapshots: { type: 'integer', required: true },
    documentGeneration: { type: 'string', description: 'The loader id of the document these references were minted against.' },
    budget: {
      type: 'object',
      additionalProperties: false,
      properties: {
        max_nodes: { type: 'integer' },
        max_chars: { type: 'integer' },
        timeout_ms: { type: 'integer' },
      },
    },
    status: { type: 'string', description: "Present when nothing was read: 'unavailable', 'not_local', 'bad_endpoint', 'no_target' or 'capability_unavailable'." },
    note: { type: 'string' },
  },
};

/**
 * A condition a wait can end on.
 *
 * One schema rather than a union: the backend decides what was meant from the fields
 * that are present (`kind`, or a bare `hwnd`/`title`/`name`), and states its rule in
 * one refusal. Everything is optional here for the same reason — `{ hwnd: 42 }` is how
 * "that window still exists" is spelled, and `{ name: 'Done', enabled: true }` is how
 * "the button became clickable" is.
 *
 * `every` is the only nesting: a list of conditions, all of which must hold.
 */
export const WAIT_CONDITION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  description:
    "What to wait for. `kind` names the predicate explicitly ('window', 'control', 'value', 'text', 'file', 'region', 'every', 'any'); without it the fields present decide: `hwnd`/`title`/`process` mean a window, `name`/`automation_id`/`control_type` mean a control, `expected` means a control's value, `path` means a file, `rect` means a region of the screen. 'every' takes a list in `every` and holds when all of its conditions do; 'any' takes one in `any` and holds when at least one does. A duration is not a condition — use the `wait` step for that.",
  properties: {
    kind: { type: 'string', enum: ['window', 'control', 'value', 'text', 'file', 'region', 'every', 'any'], description: 'Which predicate this is. Usually omittable: the fields present say it.' },
    is: {
      type: 'string',
      enum: ['present', 'absent', 'not'],
      description: "Invert or qualify the predicate: 'absent' on a window or a control waits for it to be *gone* (a dialog that closed, a spinner that stopped), and 'not' on a value waits for the control to stop holding `expected`.",
    },
    hwnd: { type: 'integer', description: 'The window the condition is about. Omit to use the focused window when a check runs — for a window condition, name `title`/`process` instead, since a handle you do not have yet cannot be given.' },
    title: { type: 'string', description: 'Window condition: case-insensitive substring of a visible window title.' },
    title_exact: { type: 'string', description: 'Window condition: the whole title must equal this (case-insensitive). Written together with `process`, both must hold — every condition you give is applied.' },
    process: { type: 'string', description: 'Window condition: case-insensitive substring of the owning process name, e.g. "chrome".' },
    process_exact: { type: 'string', description: 'Window condition: the process name must equal this (case-insensitive; a trailing .exe is allowed). Use this one when "notepad" must not also match "notepad++".' },
    pid: { type: 'integer', description: 'Window condition: the owning process id must equal this.' },
    name: { type: 'string', description: 'Control or value condition: case-insensitive substring of the accessible name.' },
    automation_id: { type: 'string', description: 'Control or value condition: exact AutomationId, from computer_ui.' },
    control_type: { type: 'string', description: "Control or value condition: control type, e.g. 'Button' or 'Edit'." },
    class_name: { type: 'string', description: 'Control condition: exact window class.' },
    enabled: { type: 'boolean', description: 'Control condition: also require the control to be enabled — the difference between "the button is there" and "the button works now".' },
    visible: { type: 'boolean', description: 'Control condition: also require the control to be on screen rather than scrolled out of view.' },
    expected: { type: 'string', description: 'Value condition: the text the control must hold.' },
    match: { type: 'string', enum: ['contains', 'exact', 'equals', 'matches', 'empty'], description: 'Value condition: how to compare (default contains, case-insensitive). `matches` is a regular expression.' },
    contains: { type: 'string', description: 'Text condition: the text that must now appear in the window\'s controls — for a result, a status line, an error.' },
    path: { type: 'string', description: "File condition: the local path the artefact is expected at — a download, an export, a log. This is a completion signal that needs nothing from the application: the file is written and the disk knows. It is deliberately not satisfied by the name existing alone — a half-written download and a leftover from the previous run look identical from the name." },
    min_bytes: { type: 'integer', description: 'File condition: also require at least this many bytes, which is how "the file exists" becomes "the file has content".' },
    stable_for_ms: { type: 'integer', description: "File condition: require the file's last write to be at least this old, so a file still being appended to is not mistaken for a finished one." },
    parse: { type: 'boolean', description: 'File condition: also require the file to read as what its extension claims (.zip opens, .json parses, .csv/.txt has a non-empty first line). A format it cannot verify is reported as unverified, not as a pass.' },
    rect: {
      type: 'object',
      additionalProperties: false,
      description: 'Region condition: the rectangle of the desktop to watch, in screen pixels. Its presence selects this condition — the one completion signal that needs nothing from the application, because it reads pixels. Use it for self-drawn interfaces where no accessible text exists (§6.2).',
      properties: {
        x: { type: 'integer', required: true },
        y: { type: 'integer', required: true },
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
      },
    },
    mode: { type: 'string', enum: ['stable', 'changed', 'matches'], description: "Region condition: `stable` (default) holds while the region keeps looking the same as on the previous sample — combine it with stable_ms to mean \"it stopped changing\"; `changed` holds once the region differs from the first sample this wait took (a list refreshed, a spinner went away); `matches` holds when the region equals `expected_digest`." },
    expected_digest: { type: 'string', description: 'Region condition with mode matches: the fingerprint the region must equal. The `digest` command returns values of the same kind.' },
    max_side: { type: 'integer', description: 'Region condition: downscale to at most this many pixels on the longest side before fingerprinting (default 160). Larger is more sensitive to small changes and slower.' },
    every: {
      type: 'array',
      description: "For kind 'every': the list of conditions that must all hold. Each entry is another condition object. Judged three-valued: one definite false settles the group, but when no leg is definitely false and one could not be observed at all, the group is *unknown* rather than false.",
      items: { type: 'object', additionalProperties: true },
    },
    any: {
      type: 'array',
      description: "For kind 'any': the list of conditions of which at least one must hold — 'either the export dialog or the error box appeared'. Three-valued the same way: one definite true settles it, and an unobservable leg makes the group unknown rather than false.",
      items: { type: 'object', additionalProperties: true },
    },
    stable_ms: { type: 'integer', description: 'Require the condition to hold this long before reporting success (maximum 30000) — a flickering condition (a progress bar that resets, a dialog that comes and goes) is not settled by one true sample.' },
  },
};

/** One entry of the batch tool's `steps` array. */
export const BATCH_STEP_SCHEMA = {    type: 'object',
  additionalProperties: false,
  properties: {
    action: {
      type: 'string',
      required: true,
      enum: STEP_ACTION_LIST,
      description: "The step to perform (see enum). Groups: pointer click/move/drag/scroll; text type/key/paste; UI Automation invoke/set_value/get_value/get_text/select_text/scroll_into_view/toggle/select/expand/collapse/close/minimize/maximize/restore/legacy_action; plus locate_text/click_text/get_caret, clipboard, focus, wait, wait_for, screenshot. **Every other field of a step means the same as in the matching single-step tool**, whose full schema is in this session's tool list — it is not repeated here.",
    },
    condition: { type: 'json', description: "For 'wait_for': the condition to wait for — the same object the batch-level `wait_for.condition` documents, which is where its full schema lives. Kept free-form here so the condition reference is not serialized twice into every request. The step ends the moment the condition holds." },
    timeout_ms: { type: 'integer', description: "For 'wait_for': how long to keep checking before giving up (default 30000, maximum 120000). A wait that times out is reported, not thrown: \"it never became true inside the budget\" is an answer, and the step log says how long it looked and what it saw." },
    on_timeout: {
      type: 'string',
      enum: ['stop', 'continue'],
      description: "For 'wait_for': what happens when the condition did not hold. 'stop' (the default) ends the batch at that step, because the steps after it were the ones that needed the condition; 'continue' is the explicit request for the other behaviour. Either way the reply names the step it stopped at (`nextStep`).",
    },
    poll_ms: { type: 'integer', description: "For 'wait_for': how often to check (default 120, range 20 to 2000). Lower reacts sooner and costs more; the first check happens immediately, so a condition that is already true never waits." },
    x: { type: 'integer', description: 'Absolute x, for click/move/scroll (scroll moves the pointer there first). With `from_frame`, x is a pixel in that image instead.' },
    y: { type: 'integer', description: 'Absolute y, for click/move/scroll. With `from_frame`, y is a pixel in that image instead.' },
    dx: { type: 'integer', description: 'move: move the pointer by this many pixels instead of to an absolute point — the form that works where the pointer is locked or recentred (a canvas, a 3-D viewport). Excludes x/y and `from_frame`.' },
    dy: { type: 'integer', description: 'move: the y part of a relative move.' },
    path: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'drag: the waypoints to drag through (`{x,y}` each), instead of from_x/from_y/to_x/to_y. Two to 64 points; the gesture is sampled smoothly along them.' },
    duration_ms: { type: 'integer', description: 'drag with a path: how long the whole gesture takes, 100–5000 (default 400).' },
    from_x: { type: 'integer', description: 'drag: absolute start x (or an image pixel when `from_frame` is set).' },
    from_y: { type: 'integer', description: 'drag: absolute start y (or an image pixel when `from_frame` is set).' },
    to_x: { type: 'integer', description: 'drag: absolute end x (or an image pixel when `from_frame` is set).' },
    to_y: { type: 'integer', description: 'drag: absolute end y (or an image pixel when `from_frame` is set).' },
    button: { type: 'string', enum: ['left', 'right', 'middle'], description: "click: button, default 'left'." },
    clicks: { type: 'integer', description: 'click: 1 (default), 2, or 3.' },
    modifiers: { type: 'string', description: "click/drag: a '+' separated chord held for the duration of the action, e.g. 'shift' to extend a selection or 'ctrl' to add to one." },
    prefer_a11y: { type: 'boolean', description: 'click: try the accessibility press first when a pressable control is under the point (default true). A chorded or multi-click is always a real click.' },
    allow_activate: { type: 'boolean', description: "click/drag/scroll/move from a frame: when the landing guard finds another process under the point, bring the target window forward once and look again before refusing (default false). One attempt only — SetForegroundWindow obeys the system's own rules, so a retry loop would hide the problem. The receipt says whether it was needed (`frame.recovered`)." },
    verify_content: { type: 'boolean', description: "click/drag/scroll/move from a frame: set false to skip the content check against an old frame. An animated surface (spinner, blinking status, clock) always reads as changed, so turn it off there rather than working around a refusal. Default true." },
    allow_windows: {
      type: 'array',
      items: { type: 'integer' },
      description: `click/drag/scroll/move from a frame: window handles this step may land on besides the frame's own window (a dialog or a second window of the same app that is the expected transition). Without it a point covered by any other window — *including another window of the same process* — is refused as \`[TARGET_OCCLUDED]\`. The receipt names the rule that allowed the point (\`frame.guard\`).`,
    },
    from_frame: { type: 'string', description: 'click/drag/scroll/move: a frame id from computer_screenshot — see computer_click.from_frame. The frame is re-checked (and re-projected if its window moved) before anything is dispatched.' },
    ref: { type: 'string', description: 'UI Automation step: the [s#.#] marker computer_ui printed next to a node, pinning that exact element. The step then takes the same ref-aware path computer_ui_action does, including the [STALE_REF] refusal for a ref from another read or another worker generation.' },
    into_hwnd: { type: 'integer', description: 'type/key/paste: only send if this window would receive the input — see computer_type.into_hwnd.' },
    direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'scroll: wheel direction.' },
    text: { type: 'string', description: "type/paste: the text to enter (Unicode, so Chinese works). select_text/click_text/locate_text: the text to locate inside the element." },
    keys: { type: 'string', description: "key: a chord such as 'enter' or 'ctrl+shift+t'." },
    repeat: { type: 'integer', description: 'key: how many times to press the chord.' },
    hold_seconds: { type: 'number', description: 'key: hold the chord down for this long instead of tapping it.' },
    delay_ms: { type: 'integer', description: 'type: delay between characters, for apps that drop fast input.' },
    restore: { type: 'boolean', description: "paste: put the user's own clipboard back afterwards (default true)." },
    require_restore: { type: 'boolean', description: 'paste: refuse before writing when the clipboard cannot be saved and put back (see computer_paste).' },
    verify: { type: 'object', additionalProperties: true, description: 'paste: a control to read back after the paste (ref or selector, as in computer_paste).' },
    seconds: { type: 'number', description: 'wait: how long to sleep (maximum 30).' },
    scale: { type: 'number', description: 'screenshot: downscale this one capture (default: the call-level `scale`).' },
    surface: { type: 'string', enum: ['window', 'client'], description: "screenshot with `window`: 'window' (the default) delivers the whole window, 'client' the client area only — the title bar, borders and resize grips are cropped away. Overrides the call-level `surface`." },
    path: { type: 'string', description: 'screenshot: write this one capture here instead of the call-level `save_path`.' },
    settle_ms: { type: 'integer', description: 'screenshot: this step\'s own settle floor, instead of the call-level `settle_ms` (default 300, maximum 5000).' },
    stability_ms: { type: 'number', description: 'screenshot: this step\'s own stability budget instead of the call-level `stability_ms`, so one slow step does not make the whole batch pay for the wait.' },
    stable: { type: 'boolean', description: 'screenshot: this step\'s own on/off for the stability wait, instead of the call-level `stable`.' },
    hwnd: { type: 'integer', description: 'focus/UI Automation steps: the window handle to act in. From computer_windows.' },
    automation_id: { type: 'string', description: 'UI Automation step: exact AutomationId, as reported by computer_ui.' },
    name: { type: 'string', description: 'UI Automation step: case-insensitive substring of the accessible name.' },
    control_type: { type: 'string', description: "UI Automation step: control type to require, e.g. 'Button', 'Edit', 'Document'." },
    class_name: { type: 'string', description: 'UI Automation step: exact window class, as reported by computer_ui.' },
    element_index: { type: 'integer', description: 'UI Automation step: which match to use when several match, 0-based (default 0).' },
    value: { type: 'string', description: "set_value: the text to write into the control." },
    prefix: { type: 'string', description: 'select_text: text that must appear immediately before the match.' },
    suffix: { type: 'string', description: 'select_text: text that must appear immediately after the match.' },
    selection_type: { type: 'string', enum: ['text', 'cursor_before', 'cursor_after'], description: 'select_text: select the match, or collapse onto its start/end to place the caret.' },
    op: { type: 'string', enum: ['get', 'set', 'clear'], description: 'clipboard: the operation. Default get.' },
  },
};

/** The batch tool's declared value: a step log plus optional trailing observations. */
export const BATCH_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    performed: { type: 'array', required: true, items: { type: 'string' } },
    count: { type: 'integer', required: true },
    failedAt: { type: 'integer', required: true },
    error: { type: 'string' },
    canceled: { type: 'boolean' },
    outOfBudget: { type: 'boolean', description: 'The step named by `failedAt` was refused because this call\'s deadline was already spent — not because anything about the step was wrong. The steps before it did run.' },
    partial: { type: 'boolean', description: 'The step named by `failedAt` sent only part of its input: SendInput reported fewer inserted events than the action needed, so some of it is in the application and some is not. Do not repeat the step as it stands — observe, then decide.' },
    partialSteps: { type: 'array', items: { type: 'integer' }, description: 'The steps that landed only partly, in step order.' },
    progress: {
      type: 'array',
      description: 'One entry per step, in order: `completed` (it ran and its input was verified as delivered), `partial` (part of its input landed), `dispatched` (it sent something and the outcome is unknown), `not-sent` (it was refused before sending), `not-run` (the batch stopped before reaching it). This is what separates "the step you care about never ran" from "it ran and we do not know what happened".',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          step: { type: 'integer', required: true },
          action: { type: 'string', required: true },
          state: { type: 'string', required: true, enum: ['completed', 'partial', 'dispatched', 'not-sent', 'not-run'] },
        },
      },
    },
    observation: {
      type: 'object',
      additionalProperties: false,
      description: 'Present when the call\'s trailing `state` read failed: the steps did run, and only the read at the end did not.',
      properties: {
        failed: { type: 'boolean', required: true },
        what: { type: 'string', description: "Which trailing observation failed: 'capture' (the screenshot at the end) or 'state' (the accessibility read at the end)." },
        error: { type: 'string', required: true },
        note: { type: 'string' },
      },
    },
    deadlineMs: { type: 'integer', description: 'The deadline this call was given, when it was given one.' },
    overDeadlineMs: { type: 'integer', description: 'How far past that deadline the call actually ran. A blocking system call inside the worker cannot be interrupted from here, so this is a real, measured number rather than the budget restated as elapsed time.' },
    deadlineMet: { type: 'boolean', description: 'Whether the call finished inside its deadline. False with `overDeadlineMs` is what an overrun looks like; a call that stopped on budget with steps left is reported through `outOfBudget`/`outcome` instead.' },
    timing: {
      type: 'object',
      additionalProperties: false,
      description: 'Where the call spent its time inside the plugin, in milliseconds: the transport queue, the worker (every step plus any capture and encode) and the attachment store.',
      properties: {
        workerMs: { type: 'integer', required: true },
        admitMs: { type: 'integer', required: true },
        queueMs: { type: 'integer', description: 'How long this call waited behind another call on the single worker before it was dispatched.' },
        startMs: { type: 'integer', description: 'How long waiting for the worker to become ready took before this call was even queued, so a slow start is not read as a slow step (§7.5).' },
      },
    },
    shot: SCREENSHOT_VALUE_SCHEMA,
    evidence: {
      type: 'object',
      additionalProperties: false,
      properties: {
        changed: { type: 'boolean', required: true },
        before: { type: 'string', required: true },
        after: { type: 'string', required: true },
        reused: { type: 'boolean', description: 'Whether the "after" reading came from a capture this call already took, instead of a second reading of the same rectangle.' },
        x: { type: 'integer', required: true },
        y: { type: 'integer', required: true },
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
      },
    },
    state: UIA_STATE_SCHEMA,
    waits: {
      type: 'array',
      description: 'One report per condition wait in this call, in step order: what was waited for, whether it became true, how long that took, and what the final check saw. A wait that timed out is here rather than in `error` — the steps that ran did run.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          what: { type: 'string', required: true, description: 'What was waited for, in the backend\'s words.' },
          satisfied: { type: 'boolean', required: true, description: 'Whether the condition held inside the budget.' },
          waitedMs: { type: 'integer', required: true },
          polls: { type: 'integer', required: true, description: 'How many times the condition was checked.' },
          timeoutMs: { type: 'integer', required: true },
          timeoutFrom: { type: 'string', required: true, description: "Whether that budget was asked for ('explicit') or defaulted ('default')." },
          pollMs: { type: 'integer', required: true },
          observed: { type: 'string', required: true, description: 'What the last check saw, e.g. "it is there but it is disabled".' },
          stableMs: { type: 'integer' },
          heldMs: { type: 'integer', description: 'How long the condition actually held, when `stable_ms` was asked for. This is the number that decides success: a condition that was true for 45 ms of a 200 ms requirement did not hold, whatever the last sample happened to say.' },
          status: { type: 'string', description: "The three-valued observation: 'true', 'false', or 'unknown' when the condition could not be observed at all (a provider that would not answer, a read that was truncated). 'unknown' is not 'false'." },
          outcome: { type: 'string', description: "How the wait ended: 'satisfied', 'timeout' (observed false throughout the budget) or 'unavailable' (never observable). Whether the budget ran out is this field, not something to infer from `satisfied`." },
          timeoutKind: { type: 'string', description: "When the budget ran out: 'unavailable' (nothing could be observed) or 'not-held' (it was true, but not for long enough)." },
          pollBackoffTo: { type: 'integer', description: 'The longest gap the poll grew to while waiting: light checks at first, backing off towards a second for a condition that takes a while.' },
          error: { type: 'string' },
          window: UIA_WINDOW_SCHEMA,
          control: UIA_NODE_SCHEMA,
        },
      },
    },
    captureUsed: {
      type: 'object',
      additionalProperties: false,
      description: 'How the frame in `shot` was obtained. A batch whose steps already captured a frame returns that one when it is newer than the last write, instead of taking a second capture of the same screen.',
      properties: {
        from: { type: 'string', required: true, enum: ['step', 'step-stale', 'retaken'], description: "'step': a screenshot step's frame is the answer and no second capture was taken. 'retaken': the step's frame was superseded by a later write, so a fresh one was taken. 'step-stale': the step's frame is returned although it predates the last write, because this call had nowhere to write a new one." },
        stepIndex: { type: 'integer', required: true, description: "Which step produced it, or -1 when the trailing path did." },
        afterLastWrite: { type: 'boolean', required: true, description: 'Whether the frame is on the right side of the last write in this call. False means it shows the state before the steps finished.' },
        note: { type: 'string' },
      },
    },
    outcome: {
      type: 'string',
      description: "What the call as a whole concluded: 'ok', 'step-failed', 'condition-timeout' (a wait_for did not hold and the steps after it were not run), 'condition-unobservable', 'reobserve-required' (the window changed and the rest was not run), 'deadline-partial' (this call's deadline cut a wait short), 'deadline' (the deadline was spent before a step could start — see `outOfBudget`) or 'cancelled'.",
    },
    actionSent: {
      type: 'boolean',
      description: 'Whether any step in this call actually put input into the desktop. That is what tells a caller whether a failure could have changed anything — a different question from whether the call succeeded.',
    },
    wroteSteps: { type: 'array', items: { type: 'integer' }, description: 'The indexes of the steps that sent input, in order.' },
    nextStep: { type: 'integer', description: 'Where the sequence can be picked up again after a stop (an undeclared window change, or a condition that did not hold). Absent when there is nothing to continue.' },
    transitions: {
      type: 'array',
      description: 'The window changes this call followed because they were declared in expected_transitions.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          atStep: { type: 'integer', required: true },
          from: { type: 'integer', required: true },
          to: { type: 'integer', required: true },
          title: { type: 'string', required: true },
          process: { type: 'string', required: true },
          matchedBy: { type: 'string', required: true },
          note: { type: 'string' },
        },
      },
    },
  },
};

/** Shared step arguments the UI Automation and other steps forward verbatim. */
export const STEP_PASSTHROUGH = [
  'hwnd', 'automation_id', 'name', 'control_type', 'class_name', 'element_index',
  'value', 'text', 'prefix', 'suffix', 'selection_type', 'restore', 'op',
];

/** sessionKey|hwnd|query -> the digest of the last observation. */
export const observedDigests = new Map();

export const OBSERVED_DIGEST_LIMIT = 64;

/**
 * Format the display list for the envelope. A plain string field keeps the
 * declared schema small while still giving the model every monitor's geometry.
 * @param screens - the backend's screen list.
 * @returns one line per display.
 */
export function formatDisplays(screens) {
  return (screens ?? [])
    .map((s) => `#${s.index} ${s.deviceName} ${s.width}x${s.height} at (${s.x},${s.y})${s.primary ? ' [primary]' : ''}`)
    .join('\n');
}

/**
 * The pacing report as the declared value, or undefined when the backend sent none.
 *
 * Deliberately copy-by-field rather than pass-through: the value has to survive the
 * declared output schema, and every field here is optional so a reply from an older
 * backend (which reported only `stable`) still validates.
 * @param stability - the backend's stability report.
 * @returns the declared stability value.
 */
export function stabilityValue(stability) {
  if (stability === null || stability === undefined || typeof stability !== 'object') return undefined;
  const value = {};
  if (typeof stability.state === 'string' && stability.state !== '') value.state = stability.state;
  if (typeof stability.stable === 'boolean') value.stable = stability.stable;
  if (Number.isFinite(stability.polls)) value.polls = Number(stability.polls);
  if (Number.isFinite(stability.waitedMs)) value.waitedMs = Number(stability.waitedMs);
  if (Number.isFinite(stability.budgetMs)) value.budgetMs = Number(stability.budgetMs);
  if (Number.isFinite(stability.pollMs)) value.pollMs = Number(stability.pollMs);
  if (Number.isFinite(stability.width) && Number(stability.width) > 0) value.width = Number(stability.width);
  if (Number.isFinite(stability.height) && Number(stability.height) > 0) value.height = Number(stability.height);
  if (typeof stability.resolvedBy === 'string' && stability.resolvedBy !== '') value.resolvedBy = stability.resolvedBy;
  if (typeof stability.sampled === 'string' && stability.sampled !== '') value.sampled = stability.sampled;
  if (typeof stability.note === 'string' && stability.note !== '') value.note = stability.note;
  if (typeof stability.conflict === 'string' && stability.conflict !== '') value.conflict = stability.conflict;
  return Object.keys(value).length > 0 ? value : undefined;
}

/**
 * The staged cost of one capture.
 *
 * queue -> backend (settle floor, stability poll, pixels, encode) -> attachment store.
 * These used to collapse into a single number, which made "the capture itself is slow"
 * indistinguishable from "the worker was still busy with the call before this one" — and
 * the two have different fixes.
 * @param parts - `{ captureMs, admitMs, queueMs?, startMs?, shot? }`.
 * @returns the declared timing value.
 */
export function captureTiming(parts) {
  const timing = { captureMs: Math.round(Number(parts.captureMs ?? 0)), admitMs: Math.round(Number(parts.admitMs ?? 0)) };
  if (Number.isFinite(parts.queueMs) && parts.queueMs > 0) timing.queueMs = Math.round(Number(parts.queueMs));
  // §7.5: how long waiting for a worker to become ready took, which is not the same wait as
  // queueing behind another call and says nothing about the command itself.
  if (Number.isFinite(parts.startMs) && parts.startMs > 0) timing.startMs = Math.round(Number(parts.startMs));
  const shotTiming = parts.shot?.timing;
  if (shotTiming !== null && shotTiming !== undefined && typeof shotTiming === 'object') {
    if (Number.isFinite(shotTiming.totalMs)) timing.backendMs = Number(shotTiming.totalMs);
    if (Number.isFinite(shotTiming.settleMs) && shotTiming.settleMs > 0) timing.settleMs = Number(shotTiming.settleMs);
    if (Number.isFinite(shotTiming.pollMs) && shotTiming.pollMs > 0) timing.pollMs = Number(shotTiming.pollMs);
    if (Number.isFinite(shotTiming.polls) && shotTiming.polls > 0) timing.polls = Number(shotTiming.polls);
  }
  return timing;
}

export function shotValue(shot, admitted) {
  // The size of the file on disk, as the backend measured it after encoding. Deriving it
  // as width x scale was an assumption about rounding that the encoder is free not to
  // honour, and the model's coordinates are read off the file (A04). The derived form is
  // kept only as the fallback for a backend that does not report the real size.
  const effectiveScale = Number(shot.effectiveScale ?? shot.scale ?? 1);
  const realWidth = Number(shot.encodedWidth);
  const realHeight = Number(shot.encodedHeight);
  const imageWidth = Number.isFinite(realWidth) && realWidth > 0 ? realWidth : Math.max(1, Math.round(shot.width * effectiveScale));
  const imageHeight = Number.isFinite(realHeight) && realHeight > 0 ? realHeight : Math.max(1, Math.round(shot.height * effectiveScale));
  const value = {
    path: shot.path,
    width: shot.width,
    height: shot.height,
    imageWidth,
    imageHeight,
    scale: effectiveScale,
    format: shot.format ?? 'png',
    bytes: Number(shot.bytes ?? 0),
    x: shot.x,
    y: shot.y,
    displays: formatDisplays(shot.screens),
    cursor: { x: shot.cursor.x, y: shot.cursor.y },
    activeWindow: shot.foreground?.title ?? '',
    ...admitted.unchanged === true ? { unchanged: true } : {},
    ...admitted,
  };
  if (Number.isFinite(shot.settledMs) && shot.settledMs > 0) value.settledMs = Number(shot.settledMs);
  if (shot.clipped === true) value.clipped = true;
  // Set by a batch, which knows whether the frame it returned came from before or after
  // its own last write. A single capture has no such question to answer.
  if (typeof shot.afterLastWrite === 'boolean') value.afterLastWrite = shot.afterLastWrite;
  // How the pixels were obtained, and what was checked about them. A window capture
  // says the window drew itself; a screen capture says these coordinates are what was
  // visible there, which may be a different window entirely.
  if (typeof shot.source === 'string' && shot.source !== '') value.source = shot.source;
  if (typeof shot.surfaceKind === 'string' && shot.surfaceKind !== '') value.surfaceKind = shot.surfaceKind;
  if (typeof shot.units === 'string' && shot.units !== '') value.units = String(shot.units);
  if (shot.surface !== null && shot.surface !== undefined && typeof shot.surface === 'object') {
    value.surface = {
      kind: String(shot.surface.kind ?? ''),
      x: Number(shot.surface.x ?? 0),
      y: Number(shot.surface.y ?? 0),
      width: Number(shot.surface.width ?? 0),
      height: Number(shot.surface.height ?? 0),
    };
  }
  if (shot.cropRectSurface !== null && shot.cropRectSurface !== undefined && typeof shot.cropRectSurface === 'object') {
    // Only when the frame really is a crop: a whole-surface frame carrying a crop of "the
    // whole surface" would be a field that says nothing and invites arithmetic that is
    // wrong by exactly that nothing.
    const crop = shot.cropRectSurface;
    const isWhole = Number(crop.x ?? 0) === 0 && Number(crop.y ?? 0) === 0
      && Number(crop.width ?? 0) === Number(shot.surface?.width ?? crop.width)
      && Number(crop.height ?? 0) === Number(shot.surface?.height ?? crop.height);
    if (!isWhole) {
      value.crop = {
        x: Number(crop.x ?? 0),
        y: Number(crop.y ?? 0),
        width: Number(crop.width ?? 0),
        height: Number(crop.height ?? 0),
      };
    }
  }
  if (Number.isFinite(Number(shot.requestedScale)) && Math.abs(Number(shot.requestedScale) - effectiveScale) > 0.0001) {
    value.scaleRequested = Number(shot.requestedScale);
    value.scaleEffective = effectiveScale;
  }
  if (typeof shot.scaleNote === 'string' && shot.scaleNote !== '') value.scaleNote = shot.scaleNote;
  // The whole window's rectangle, kept apart from this frame's own geometry: it is what makes
  // "was the window even where I thought it was" answerable from the receipt alone (§9.1).
  if (shot.windowRect !== null && shot.windowRect !== undefined && typeof shot.windowRect === 'object') {
    value.windowRect = {
      x: Number(shot.windowRect.x ?? 0),
      y: Number(shot.windowRect.y ?? 0),
      width: Number(shot.windowRect.width ?? 0),
      height: Number(shot.windowRect.height ?? 0),
    };
  }
  // How long the capture itself took inside the worker: one duration that means the same
  // thing on both sides of the pipe, unlike the worker's monotonic instants, which are not
  // comparable across processes (方案 §2.3).
  if (Number.isFinite(Number(shot.captureSpanMs)) && Number(shot.captureSpanMs) >= 0) value.captureSpanMs = Number(shot.captureSpanMs);
  if (typeof shot.frame === 'string' && shot.frame !== '') value.frame = shot.frame;
  if (shot.window !== undefined && shot.window !== null) {
    value.window = {
      hwnd: Number(shot.window.hwnd ?? 0),
      title: String(shot.window.title ?? ''),
      process: String(shot.window.process ?? ''),
      pid: Number(shot.window.pid ?? 0),
    };
  }
  if (Array.isArray(shot.verification) && shot.verification.length > 0) value.verification = shot.verification.map((v) => String(v));
  if (shot.stability !== null && shot.stability !== undefined && typeof shot.stability.stable === 'boolean') {
    value.stable = shot.stability.stable;
  }
  const stability = stabilityValue(shot.stability);
  if (stability !== undefined) value.stability = stability;
  return value;
}

/**
 * One text field of the text block, mapped onto the declared shape.
 *
 * Field by field, because every field is optional *by request*: a read that asked for
 * the focused control must not come back carrying an empty document field, and a caller
 * has to be able to tell "not asked for" from "asked for, and empty".
 * @param raw - one field of the backend's `text` object.
 * @returns the value `UIA_TEXT_SCHEMA` describes for that field, or undefined.
 */
export function textFieldValue(raw) {
  if (raw === undefined || raw === null) return undefined;
  const field = { status: String(raw.status ?? '') };
  if (typeof raw.summary === 'string' && raw.summary !== '') field.summary = raw.summary;
  if (typeof raw.ref === 'string' && raw.ref !== '') field.ref = raw.ref;
  if (typeof raw.value === 'string') field.value = raw.value;
  if (raw.count !== undefined && raw.count !== null && Number.isFinite(Number(raw.count))) field.count = Number(raw.count);
  if (Array.isArray(raw.items)) field.items = raw.items.map((item) => String(item));
  if (raw.truncated === true) field.truncated = true;
  if (raw.budget_exhausted === true) field.budgetExhausted = true;
  if (typeof raw.note === 'string' && raw.note !== '') field.note = raw.note;
  return field;
}

/**
 * Map the backend's text block onto the declared shape (8.txt §5 / B1).
 * @param raw - the backend's `text` object.
 * @returns the value `UIA_TEXT_SCHEMA` describes.
 */
export function textObservationValue(raw) {
  const target = raw.target ?? {};
  const value = {
    target: {
      ok: target.ok === true,
      source: String(target.source ?? ''),
      ...(typeof target.status === 'string' && target.status !== '' ? { status: target.status } : {}),
      ...(typeof target.ref === 'string' && target.ref !== '' ? { ref: target.ref } : {}),
      ...(typeof target.note === 'string' && target.note !== '' ? { note: target.note } : {}),
    },
  };
  for (const key of ['focused', 'selection', 'document', 'selected']) {
    const field = textFieldValue(raw[key]);
    if (field !== undefined) value[key] = field;
  }
  const budget = raw.budget ?? {};
  value.budget = {
    max_chars: Number(budget.max_chars ?? 0),
    returned_chars: Number(budget.returned_chars ?? 0),
    truncated: budget.truncated === true,
  };
  return value;
}

/**
 * Fingerprint an observation so a repeat can be recognised.
 * @param nodes - the declared node rows.
 * @returns a short hex digest.
 */
export function digestOfNodes(nodes) {
  const hash = createHash('sha256');
  for (const node of nodes) {
    hash.update(`${node.depth}|${node.name}|${node.controlType}|${node.automationId}|${node.className}|${node.enabled}|${node.offscreen}|${node.x},${node.y},${node.width},${node.height}|${node.patterns.join(',')}\n`);
  }
  return hash.digest('hex').slice(0, 16);
}

/**
 * Fold the text block into the observation digest.
 *
 * Without this, a read whose tree did not move but whose *selection* did would answer
 * `unchanged: true` — and "nothing changed since your last read" is precisely the claim
 * that stops a caller from looking again (8.txt §5 acceptance).
 * @param text - the mapped text block.
 * @returns 8 hex characters.
 */
export function digestOfText(text) {
  const hash = createHash('sha256');
  // Deliberately no refs: a ref names a snapshot, and every read mints a new one, so
  // folding it in here would make every repeated read look like a change.
  hash.update([
    text.target?.source ?? '',
    text.target?.ok === true ? 'ok' : 'no',
    text.focused?.summary ?? '',
    text.focused?.status ?? '',
    text.selection?.status ?? '',
    text.selection?.value ?? '',
    text.document?.status ?? '',
    text.document?.value ?? '',
    (text.selected?.items ?? []).join('›'),
  ].join('|'));
  return hash.digest('hex').slice(0, 8);
}

/**
 * Map the backend's tree reply onto the declared observation shape.
 * @param result - the backend reply.
 * @param search - whether this was a search rather than a full read.
 * @param cachedShot - `{ shot, admitted }` when the same call took a capture.
 * @returns the value `UIA_STATE_SCHEMA` describes, without `unchanged`.
 */
export function stateValue(result, search, cachedShot) {
  const window = result.window ?? {};
  const value = {
    window: {
      hwnd: Number(window.hwnd ?? 0),
      title: String(window.title ?? ''),
      process: String(window.process ?? ''),
      pid: Number(window.pid ?? 0),
    },
    nodes: (result.nodes ?? []).map((n) => ({
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
      ...(Number.isFinite(n.repeated) && Number(n.repeated) > 1 ? { repeated: Number(n.repeated) } : {}),
      ...(Number.isFinite(n.merged) && Number(n.merged) > 1 ? { merged: Number(n.merged) } : {}),
      ...(n.mergedTruncated === true ? { mergedTruncated: true } : {}),
      ...(typeof n.delta === 'string' && n.delta !== '' ? { delta: String(n.delta) } : {}),
    })),
    truncated: result.truncated === true,
    searched: search,
    mode: String(result.mode ?? 'tree'),
    digest: '',
    walked: Number(result.walked ?? 0),
    skipped: Number(result.skipped ?? 0),
    // §7.4 第 1 条: what the traversal asked for, reported rather than assumed — the
    // `patterns: false` path is supposed to fetch no pattern at all.
    cachePatterns: Number(result.cachePatterns ?? 0),
  };
  // §7.4 第 3 条: which conditions the provider filtered, rather than the client.
  if (Array.isArray(result.pushdown) && result.pushdown.length > 0) {
    value.pushdown = result.pushdown.map((one) => String(one));
  }
  // §7.4 第 2 条: the cost of the read, kept apart from its output budget.
  if (result.traversal !== null && result.traversal !== undefined && typeof result.traversal === 'object') {
    const counts = (name, fallback = 0) => {
      const value = Number(result.traversal[name]);
      return Number.isFinite(value) ? value : fallback;
    };
    value.traversal = {
      visited: counts('visited'),
      maxQueue: counts('maxQueue'),
      visitBudget: counts('visitBudget'),
      traversalTruncated: result.traversal.traversalTruncated === true,
      elapsedMs: counts('elapsedMs'),
      ...(result.traversal.providerSide === true ? { providerSide: true } : {}),
      // §7.4 第 5 条: how much retrying this read needed, so a chain of client re-creations
      // and health probes is a number in the reply rather than invisible work.
      walks: counts('walks', 1),
      walkCap: counts('walkCap'),
      healthProbes: counts('healthProbes'),
      resets: counts('resets'),
    };
  }
  // The text block is part of what this read observed, so it is part of what "unchanged"
  // is a claim about (see digestOfText): a selection that moved in a tree that did not is
  // a change, and reporting it as "unchanged" would talk the caller out of looking.
  if (result.text !== undefined && result.text !== null) value.text = textObservationValue(result.text);
  value.digest = digestOfNodes(value.nodes);
  if (value.text !== undefined) value.digest = `${value.digest}-${digestOfText(value.text)}`;
  if (Number.isFinite(result.settledMs) && Number(result.settledMs) > 0) value.settledMs = Number(result.settledMs);
  // Reported, not swallowed: a tree that came through the legacy accessibility bridge has
  // generic control types and numeric ids, and a caller that does not know that will read it as
  // "this window has no real controls".
  if (result.legacy === true) value.legacy = true;
  if (result.reinit === true) value.reinit = true;
  if (typeof result.snapshot === 'string' && result.snapshot !== '') value.snapshot = result.snapshot;
  if (Number.isFinite(result.pruned) && Number(result.pruned) > 0) value.pruned = Number(result.pruned);
  if (result.delta !== undefined && result.delta !== null) {
    value.delta = {
      base: String(result.delta.base ?? ''),
      known: result.delta.known === true,
      added: Number(result.delta.added ?? 0),
      moved: Number(result.delta.moved ?? 0),
      altered: Number(result.delta.altered ?? 0),
      removed: Number(result.delta.removed ?? 0),
      same: Number(result.delta.same ?? 0),
    };
    if (Array.isArray(result.delta.removedNodes) && result.delta.removedNodes.length > 0) {
      value.delta.removedNodes = result.delta.removedNodes.map((n) => ({
        ref: String(n.ref ?? ''),
        name: String(n.name ?? ''),
        controlType: String(n.controlType ?? 'ControlType.Unknown'),
      }));
    }
  }
  if (cachedShot !== undefined) value.shot = shotValue(cachedShot.shot, cachedShot.admitted);
  return value;
}

export function renderTextObservation(text) {
  const lines = [];
  const target = text.target ?? {};
  const at = target.ref !== undefined && target.ref !== '' ? ` [${target.ref}]` : '';
  if (target.ok !== true) {
    lines.push(`text: not read — ${target.status ?? 'no target'}${target.note !== undefined ? `: ${target.note}` : ''}`);
    return lines.join('\n');
  }
  if (text.focused !== undefined) {
    const field = text.focused;
    lines.push(field.status === 'ok'
      ? `focused${at}: ${field.summary ?? ''}${field.truncated === true ? ' …(cut at the text budget)' : ''}`
      : `focused: ${field.status}${field.note !== undefined ? ` — ${field.note}` : ''}`);
  }
  if (text.selection !== undefined) {
    const field = text.selection;
    if (field.status !== 'ok') lines.push(`selection: ${field.status}${field.note !== undefined ? ` — ${field.note}` : ''}`);
    else if ((field.value ?? '') === '') lines.push(`selection: empty — ${field.note ?? 'nothing is selected'}`);
    else lines.push(`selection${at}: ${JSON.stringify(field.value)}${field.truncated === true ? ' …(cut at the text budget)' : ''}`);
  }
  if (text.document !== undefined) {
    const field = text.document;
    if (field.status !== 'ok') lines.push(`document: ${field.status}${field.note !== undefined ? ` — ${field.note}` : ''}`);
    else lines.push(`document${at} (${(field.value ?? '').length} chars${field.truncated === true ? ', cut at the text budget' : ''}):\n${field.value ?? ''}`);
  }
  if (text.selected !== undefined) {
    const field = text.selected;
    if (field.status !== 'ok') lines.push(`selected: ${field.status}${field.note !== undefined ? ` — ${field.note}` : ''}`);
    else lines.push(`selected (${field.count ?? 0}${field.truncated === true ? '+ (only the first ones are listed)' : ''}): ${(field.items ?? []).join(' | ')}`);
  }
  const budget = text.budget ?? {};
  lines.push(`text budget: ${budget.returned_chars ?? 0}/${budget.max_chars ?? 0} chars${budget.truncated === true ? ' (truncated)' : ''}`);
  return lines.join('\n');
}

export function renderState(value, compact = true) {
  const textTail = value.text === undefined ? '' : `\n${renderTextObservation(value.text)}`;
  const where = value.window.hwnd === 0
    ? 'no window resolved'
    : `hwnd=${value.window.hwnd} "${value.window.title}" [${value.window.process}] pid=${value.window.pid}`;
  if (value.nodes.length === 0) {
    if (value.delta?.known === true) {
      return `delta against ${value.delta.base}: nothing changed (${value.delta.same} node(s) identical).\nwindow: ${where}${textTail}`;
    }
    const why = value.searched ? 'No UI Automation node matched the search.' : 'No UI Automation nodes matched.';
    return `${why}\nwindow: ${where}${textTail}`;
  }
  // A window that is present but exposes no children at all is a distinct state
  // worth naming: it is what a freshly opened app looks like for the second or two
  // its provider takes to build the tree, and it is also what an app with no
  // accessibility support looks like forever. Saying so beats handing back a
  // one-row tree that reads like a successful observation.
  if (!value.searched && value.nodes.length <= 1 && value.walked <= 1) {
    return `window: ${where}\nthe window exposed no child controls. Either it is still initialising — retry in a moment — or it is a short-lived placeholder: some apps show one window while starting and then replace it, so list windows again (computer_windows) and use the newer handle. If neither applies, the app does not implement UI Automation at all and computer_screenshot with pixel clicks is the way in.${textTail}`;
  }
  const lines = value.nodes.map((n) => {
    const type = n.controlType.replace('ControlType.', '');
    const centre = !compact && n.width > 0 ? ` centre=(${Math.round(n.x + n.width / 2)},${Math.round(n.y + n.height / 2)})` : '';
    const id = n.automationId ? ` #${n.automationId}` : '';
    const patterns = n.patterns.length > 0 ? ` [${n.patterns.join(',')}]` : '';
    const ref = n.ref ? `[${n.ref}] ` : '';
    const many = n.repeated > 1 ? ` ×${n.repeated} similar` : '';
    // A merged run is the opposite of a collapsed one: it kept the text, so the row reads
    // as one line and the marker only says how many nodes it came from.
    const from = n.merged > 1 ? ` (merged from ${n.merged}${n.mergedTruncated === true ? ', text cut' : ''})` : '';
    const geometry = compact && !ref && n.width > 0 ? ` centre=(${Math.round(n.x + n.width / 2)},${Math.round(n.y + n.height / 2)})` : '';
    return `${'  '.repeat(n.depth)}${ref}${type} "${n.name}"${id}${many}${from}${centre}${geometry}${patterns}${n.enabled ? '' : ' (disabled)'}${n.offscreen ? ' (offscreen)' : ''}`;
  });
  const head = value.delta?.known === true
    ? `delta against ${value.delta.base} — ${value.delta.added} added, ${value.delta.moved} moved, ${value.delta.altered} changed, ${value.delta.removed} removed, ${value.delta.same} unchanged. These rows are the changes, not the whole tree:`
    : value.searched ? `${value.nodes.length} matching node(s):` : `${value.nodes.length} node(s):`;
  const notes = [
    `window: ${where}`,
    value.unchanged === true ? 'unchanged: this is byte-for-byte the same tree as your previous read of this window and the same query — nothing in it moved since, so do not read it again before acting.' : '',
    value.truncated ? '(the node budget ran out; increase max_nodes, or search with filter/name/control_type to see fewer, better nodes)' : '',
    !compact ? (value.skipped > 0 ? `(${value.skipped} anonymous container node(s) omitted; pass skip_empty: false to see them)` : '') : '',
    !compact ? (value.pruned > 0 ? `(${value.pruned} row(s) of scaffolding, repeated text or low-priority content were folded away; pass prune: false to read the raw provider output)` : '') : '',
    !compact && value.cachePatterns === 0 ? '(patterns: false — the traversal asked the provider for no pattern at all, so this read was cheaper and not merely shorter)' : '',
    !compact && Array.isArray(value.pushdown) && value.pushdown.length > 0 ? `(the provider filtered on ${value.pushdown.join(' and ')} for you, so this search enumerated less of the tree than a hand-filtered one would have)` : '',
    value.traversal?.traversalTruncated === true ? `(the *traversal* budget stopped this walk after ${value.traversal.visited} node(s) — the node budget did not run out, the tree did: pass max_visited with a bigger number, read a narrower window, or use filter/name/control_type to search instead. What is here is partial.)` : '',
    !compact && Number(value.traversal?.walks ?? 1) > 1 ? `(this read needed ${value.traversal.walks} traversals of the window — the UI Automation client was re-created ${value.traversal.resets ?? 0} time(s) after ${value.traversal.healthProbes ?? 0} health probe(s), so it cost more than a plain read of the same window. The tree above is from the last traversal.)` : '',
    value.delta?.known === false ? `(the snapshot ${value.delta.base} is no longer held — it predates a worker restart or was pruned — so this is the full tree, not a delta)` : '',
    value.delta?.known === true && Array.isArray(value.delta.removedNodes) && value.delta.removedNodes.length > 0 ? `(gone since ${value.delta.base}: ${value.delta.removedNodes.map((n) => `${n.controlType.replace('ControlType.', '')} "${n.name}"`).slice(0, 6).join(', ')})` : '',
    value.nodes.some((n) => n.ref) ? '(the [s#.#] marker is that node\'s ref: pass it as `ref` to computer_ui_action to pin this exact element, and the action will tell you if the element has moved since this read)' : '',
    compact ? '(compact view: rows carry the ref, type, name and patterns. Pass compact: false for every row\'s geometry and the read\'s diagnostics.)' : '',
  ].filter((line) => line !== '');
  return `${head}\n${lines.join('\n')}\n${notes.join('\n')}${textTail}`;
}
