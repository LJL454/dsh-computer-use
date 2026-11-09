/**
 * 浏览器动作目录（方案 4.2 / PR02）。
 *
 * 方案给这一层定的职责只有一句："动作 schema、效果分类、资源、恢复策略、能力要求"，并明确它
 * **不得**导入宿主实例或启动进程。所以这里只有数据与判断，没有 I/O。
 *
 * 为什么需要一份目录而不是继续把字段散在 `index.js` 的 schema 与 `browser/actions.mjs` 的分支里：
 *
 *   - 公开声明与处理器消费的字段没有共同来源。`press` 在处理器里读 `key`/`code`，公开 schema
 *     却没有声明它们，而 `steps.items` 是 `additionalProperties: false` —— 合法输入在宿主那一层
 *     就被拒掉，处理器永远收不到（方案 1.2 第一条）。
 *   - 效果分类不能由模型自报。批次要取各步骤资源的并集，只有可信目录知道 `state` 是只读、
 *     `click` 是写入、`navigate` 会换文档。
 *   - 校验要发生在派发之前。未知动作、缺字段、错类型、越界值都必须在建立 CDP 连接之前失败，
 *     否则"非法输入零写入"这条不变量没法测。
 *
 * 字段类型是目录自己的小词汇表（`string` / `integer` / `boolean` / `number` / `string-array` /
 * `object`），不是 JSON Schema 的子集，也不冒充它：公开参数仍由 `schemas.mjs` 按宿主当前的扁平
 * 声明形式生成，运行时校验按这里的规则执行。两者同源，才有"声明与消费一致"的可测事实。
 */

import { BROWSER_ACTIONS } from '../../browser/contracts.mjs';

/** 动作目录里出现的字段类型。 */
export const FIELD_TYPES = Object.freeze(['string', 'integer', 'number', 'boolean', 'string-array', 'object']);

/** 一个步骤最多允许的步数（与既有上限一致，不在这里改行为）。 */
export const MAX_STEPS = 20;

/** 一次 upload 最多携带的文件数，以及路径字符串的长度上限。 */
export const UPLOAD_LIMITS = Object.freeze({ maxFiles: 20, maxPathChars: 1024 });
/** press 的键名与 code 是有界字符串，避免把整段文本塞进"按键"。 */
export const KEY_LIMITS = Object.freeze({ maxChars: 64 });
/** scroll 的单步位移上限（CSS 像素）。 */
export const SCROLL_LIMIT = 100_000;
/** 一次 state 读取的节点/字符预算上限。 */
export const STATE_LIMITS = Object.freeze({ maxNodes: 1000, maxChars: 20_000 });

/**
 * 字段定义小工具：让目录读起来像一张表，而不是嵌套对象。
 * @param type - FIELD_TYPES 之一。
 * @param extra - 其余约束（required、minLength、enum、subfields…）。
 */
const field = (type, extra = {}) => Object.freeze({ type, ...extra });

/** `verify` 与 `wait_for.condition` 共用的"写完之后看什么"形状。 */
const PRESENCE_FIELDS = Object.freeze({
  name: field('string', { description: 'an accessible name to look for' }),
  text: field('string', { description: 'text to look for when the node has no name' }),
});

/**
 * 权威动作目录。键必须与 `browser/actions.mjs` 导出的 `BROWSER_ACTIONS` 完全一致；
 * 模块加载时自检，缺一个就抛错（见文件末尾），避免目录与处理器悄悄各说各话。
 *
 * 每个动作的 `fields` 只列这个动作**真正消费**的字段：处理器读、公开 schema 声明、校验器检查，
 * 三处同源。`effect` 用于批次资源并集；`retryPolicy` 说明该动作被派发之后能不能重放。
 */
export const BROWSER_ACTION_CATALOG = Object.freeze({
  navigate: Object.freeze({
    summary: 'Go somewhere; the call rebinds to the new document.',
    effect: 'navigation',
    resources: Object.freeze(['browser-target', 'browser-document']),
    retryPolicy: 'never',
    capabilities: Object.freeze(['page']),
    fields: Object.freeze({
      url: field('string', { required: true, minLength: 1, maxChars: 8192, description: 'navigate: where to go.' }),
    }),
  }),
  click: Object.freeze({
    summary: 'Click a reference read from browser_state.',
    effect: 'write',
    resources: Object.freeze(['browser-target']),
    retryPolicy: 'never',
    capabilities: Object.freeze(['page', 'input']),
    fields: Object.freeze({
      ref: field('string', { required: true, minLength: 1, description: 'click: a reference from browser_state, checked against the connection, target, frame and document it was read from before it is used.' }),
      verify: field('object', { subfields: PRESENCE_FIELDS, description: 'click: what to look for afterwards (`{name: "…"}`). Without it the step is reported as `not_verified` rather than implied to have worked.' }),
    }),
  }),
  fill: Object.freeze({
    summary: 'Put a value in a field through the page’s own events.',
    effect: 'write',
    resources: Object.freeze(['browser-target']),
    retryPolicy: 'never',
    capabilities: Object.freeze(['page', 'dom']),
    fields: Object.freeze({
      ref: field('string', { required: true, minLength: 1, description: 'fill: a reference from browser_state.' }),
      value: field('string', { required: true, description: "fill: the text to put in the field, through the page's own input/change events so frameworks notice." }),
    }),
  }),
  type: Object.freeze({
    summary: 'Type text into a focused field (appends, does not replace).',
    effect: 'write',
    resources: Object.freeze(['browser-target']),
    retryPolicy: 'never',
    capabilities: Object.freeze(['page', 'input']),
    fields: Object.freeze({
      ref: field('string', { required: true, minLength: 1, description: 'type: the field to focus before typing.' }),
      value: field('string', { required: true, description: 'type: the text to insert.' }),
    }),
  }),
  upload: Object.freeze({
    summary: 'Attach files to a file input.',
    effect: 'write',
    resources: Object.freeze(['browser-target', 'local-file']),
    retryPolicy: 'never',
    capabilities: Object.freeze(['page', 'dom']),
    fields: Object.freeze({
      ref: field('string', { required: true, minLength: 1, description: 'upload: the file input reference.' }),
      files: field('string-array', { required: true, minItems: 1, maxItems: UPLOAD_LIMITS.maxFiles, description: 'upload: paths on the machine the browser runs on (' + UPLOAD_LIMITS.maxFiles + ' at most).' }),
    }),
  }),
  scroll: Object.freeze({
    summary: 'Scroll the page, or bring one element into view.',
    effect: 'write',
    resources: Object.freeze(['browser-target']),
    retryPolicy: 'never',
    capabilities: Object.freeze(['page', 'input']),
    fields: Object.freeze({
      dx: field('number', { description: 'scroll: horizontal wheel delta in CSS pixels.' }),
      dy: field('number', { description: 'scroll: vertical wheel delta in CSS pixels.' }),
      ref: field('string', { minLength: 1, description: 'scroll: scroll this element into view instead of the window.' }),
    }),
  }),
  hover: Object.freeze({
    summary: 'Move the pointer onto an element and read back whether it reports :hover.',
    effect: 'write',
    resources: Object.freeze(['browser-target']),
    retryPolicy: 'never',
    capabilities: Object.freeze(['page', 'input']),
    fields: Object.freeze({
      ref: field('string', { required: true, minLength: 1, description: 'hover: the element to hover.' }),
    }),
  }),
  press: Object.freeze({
    summary: 'Send one key press, optionally after focusing a reference.',
    effect: 'write',
    resources: Object.freeze(['browser-target']),
    retryPolicy: 'never',
    capabilities: Object.freeze(['page', 'input']),
    fields: Object.freeze({
      key: field('string', { required: true, minLength: 1, maxChars: KEY_LIMITS.maxChars, description: 'press: the key (e.g. "Enter", "Tab", "Escape").' }),
      code: field('string', { maxChars: KEY_LIMITS.maxChars, description: 'press: the physical key code; defaults to the key itself.' }),
      ref: field('string', { minLength: 1, description: 'press: focus this element before the key is sent.' }),
      verify: field('object', { subfields: PRESENCE_FIELDS, description: 'press: what to look for afterwards.' }),
    }),
  }),
  select: Object.freeze({
    summary: 'Choose one option and compare the control’s final value with what was asked for.',
    effect: 'write',
    resources: Object.freeze(['browser-target']),
    retryPolicy: 'never',
    capabilities: Object.freeze(['page', 'dom']),
    fields: Object.freeze({
      ref: field('string', { required: true, minLength: 1, description: 'select: the select element.' }),
      value: field('string', { required: true, description: 'select: the option value to choose (a label is accepted only when it matches exactly one option).' }),
    }),
  }),
  tabs: Object.freeze({
    summary: 'List, create, activate or close a tab.',
    effect: 'write',
    resources: Object.freeze(['browser-target', 'browser-context']),
    retryPolicy: 'never',
    capabilities: Object.freeze(['target']),
    fields: Object.freeze({
      operation: field('string', { enum: Object.freeze(['list', 'create', 'activate', 'close']), description: 'tabs: list (default), create, activate or close.' }),
      tab: field('string', { minLength: 1, description: 'tabs: the target this operation acts on; defaults to the tab this call is bound to. This is the step\u2019s own tab, not the call-level `tab` that binds the whole call.' }),
      url: field('string', { maxChars: 8192, description: 'tabs create: the page to open (default about:blank).' }),
    }),
  }),
  wait_for: Object.freeze({
    summary: 'Wait for a condition inside the call’s budget.',
    effect: 'read',
    resources: Object.freeze(['browser-target']),
    retryPolicy: 'safe-read',
    capabilities: Object.freeze(['page', 'accessibility']),
    fields: Object.freeze({
      condition: field('object', {
        required: true,
        subfields: Object.freeze({
          name: field('string', { description: 'a name to appear' }),
          text: field('string', { description: 'a text to appear' }),
          url: field('string', { description: 'a substring of location.href' }),
        }),
        description: 'wait_for: what to wait for — at least one of name/text, or a url substring.',
      }),
    }),
  }),
  state: Object.freeze({
    summary: 'Read the accessibility tree, bounded by a node and character budget.',
    effect: 'read',
    resources: Object.freeze(['browser-target']),
    retryPolicy: 'safe-read',
    capabilities: Object.freeze(['accessibility']),
    fields: Object.freeze({
      filter: field('string', { description: 'state: substring over role, name and value.' }),
      max_nodes: field('integer', { min: 1, max: STATE_LIMITS.maxNodes, description: 'state: node budget (default 200, maximum 1000).' }),
      max_chars: field('integer', { min: 1, max: STATE_LIMITS.maxChars, description: 'state: character budget.' }),
    }),
  }),
});

/** 目录里出现的全部字段名（任何动作），用于拒绝未知字段。 */
export const ALL_STEP_FIELDS = Object.freeze(
  [...new Set(Object.values(BROWSER_ACTION_CATALOG).flatMap((entry) => Object.keys(entry.fields)))].sort(),
);

/**
 * 目录自检：每个已知动作都要有条目，每个条目也要对应一个已知动作。
 *
 * 这一条放在模块加载时而不是测试里：目录少写一个动作，宿主 schema 就会少一个字段，而那种
 * 错误在运行时的表现是"处理器收不到参数"，很难归因。
 */
const catalogActions = Object.keys(BROWSER_ACTION_CATALOG);
const missing = BROWSER_ACTIONS.filter((action) => !catalogActions.includes(action));
const extra = catalogActions.filter((action) => !BROWSER_ACTIONS.includes(action));
if (missing.length > 0 || extra.length > 0) {
  throw new Error(`the action catalog does not match BROWSER_ACTIONS (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`);
}
