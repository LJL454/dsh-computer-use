/**
 * 动作目录的两个投影（方案 4.2 / PR02）。
 *
 * 同一份 `catalog.mjs` 要同时满足两种消费方式，这个文件就是那两座桥：
 *
 *   1. **公开声明**：DSH 当前把工具参数声明成"扁平属性袋"（每个属性自带 `required`），
 *      `steps.items` 再用 `additionalProperties: false` 关掉未知键。所以这里把目录里所有动作的
 *      字段并成一个属性袋，`action` 排在最前。声明是"并集"，严格性交给第 2 步。
 *
 *   2. **运行时校验**：`validateBrowserSteps` 按 `action` 判别，逐字段查必填、类型、范围、
 *      未知字段与条件依赖（`tabs activate` 要 tab、`wait_for` 要至少一个条件……），失败抛
 *      `BrowserActionInputError`，`code` 沿用既有的 `BAD_REQUEST`。调用方必须在建立连接、
 *      写 worker、发 CDP 之前调用它 —— "非法输入零派发"就是靠这个顺序成立的。
 *
 * 校验返回的是**规范化副本**：`action` 转小写、`files` 去掉空串、`condition` 去掉空键。处理器
 * 拿到的就是校验过的那一份，不必再猜。
 */

import {
  ALL_STEP_FIELDS,
  BROWSER_ACTION_CATALOG,
  MAX_STEPS,
  SCROLL_LIMIT,
  UPLOAD_LIMITS,
} from './catalog.mjs';

/** 输入不合法。`code` 是既有错误码，`fieldPath` 指向具体字段，便于诊断而不改变旧输出契约。 */
export class BrowserActionInputError extends Error {
  /**
   * @param message - 不含前缀的说明。
   * @param detail - `{ step, action, fieldPath }`。
   */
  constructor(message, detail = {}) {
    super(`[BAD_REQUEST] ${message}`);
    this.name = 'BrowserActionInputError';
    this.code = 'BAD_REQUEST';
    this.step = detail.step;
    this.action = detail.action;
    this.fieldPath = detail.fieldPath ?? '';
  }
}

/** 把目录里的字段类型翻成宿主声明用的类型。 */
function declaredType(spec, name) {
  switch (spec.type) {
    case 'string-array':
      return { type: 'array', items: { type: 'string' } };
    case 'object': {
      const properties = {};
      for (const [key, sub] of Object.entries(spec.subfields ?? {})) {
        properties[key] = { type: sub.type, description: sub.description };
      }
      return { type: 'object', additionalProperties: true, properties };
    }
    default:
      return { type: spec.type, ...(name === undefined ? {} : {}) };
  }
}

/**
 * 声明里要带上的约束。
 *
 * **只带 `enum`**：宿主的值 schema DSL 不接受 `minimum`/`maximum`，带上它们会让 `defineTool`
 * 在加载时直接抛 "is not supported by the value schema DSL"，整个插件装不上。这个错误只在
 * **真实宿主**里出现 —— 测试里 `defineTool` 是桩函数，把问题盖住了，直到安装演练
 * （`rehearsal-install-test.mjs`）才暴露。数值范围仍在运行时按目录里的 `min`/`max` 校验。
 */
function declaredBounds(spec) {
  const out = {};
  if (Array.isArray(spec.enum)) out.enum = [...spec.enum];
  return out;
}

/**
 * 公开参数声明：`steps.items` 的对象形状。
 *
 * 字段的说明合并了"哪些动作用它"，因为一个字段袋装的是并集 —— 模型看到 `key` 时要知道它属于
 * `press`，而不是所有动作。
 */
export function browserStepParameterSchema() {
  const usage = new Map();
  for (const [action, entry] of Object.entries(BROWSER_ACTION_CATALOG)) {
    for (const name of Object.keys(entry.fields)) {
      const list = usage.get(name) ?? [];
      list.push(action);
      usage.set(name, list);
    }
  }
  const properties = {
    action: { type: 'string', required: true, enum: Object.keys(BROWSER_ACTION_CATALOG), description: 'The action this step performs.' },
  };
  for (const name of ALL_STEP_FIELDS) {
    // 同一字段在不同动作里约束可能不同；声明取最宽松的一份，运行时再按动作收紧。
    const specs = Object.values(BROWSER_ACTION_CATALOG)
      .map((entry) => entry.fields[name])
      .filter((spec) => spec !== undefined);
    const widest = specs.reduce((left, right) => (declaredBreadth(right) > declaredBreadth(left) ? right : left), specs[0]);
    const required = specs.length === Object.keys(BROWSER_ACTION_CATALOG).length && specs.every((spec) => spec.required === true);
    const declared = { ...declaredType(widest), ...declaredBounds(widest) };
    if (required) declared.required = true;
    declared.description = `${usage.get(name).join('/')}: ${widest.description ?? ''}`.trim();
    properties[name] = declared;
  }
  return { type: 'object', additionalProperties: false, properties };
}

/** 宽松度排序：数组 > 对象 > 字符串 > 数字，只用于"并集声明"取最不严格的那份。 */
function declaredBreadth(spec) {
  return { 'string-array': 5, object: 4, string: 3, number: 2, integer: 1, boolean: 0 }[spec.type] ?? 0;
}

/** 类型名，用在报错里。 */
function describeType(spec) {
  if (spec.type === 'string-array') return 'an array of strings';
  if (spec.type === 'object') return 'an object';
  if (spec.type === 'integer' || spec.type === 'number') return 'a number';
  return `a ${spec.type}`;
}

/** 这个值是否符合字段的类型（不做范围检查）。 */
function typeOk(spec, value) {
  switch (spec.type) {
    case 'string': return typeof value === 'string';
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'string-array': return Array.isArray(value) && value.every((one) => typeof one === 'string');
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    default: return false;
  }
}

/**
 * 校验并规范化整批步骤。
 *
 * @param steps - 调用方给的 `steps`。
 * @param options - `{ maxSteps }`；默认沿用既有 20 步上限。
 * @returns 规范化后的步骤数组（新对象，不修改入参）。
 * @throws BrowserActionInputError 任何不合法输入。
 */
export function validateBrowserSteps(steps, options = {}) {
  const maxSteps = Number.isFinite(options.maxSteps) ? Number(options.maxSteps) : MAX_STEPS;
  if (!Array.isArray(steps)) {
    throw new BrowserActionInputError('`steps` must be an array of step objects.', { fieldPath: 'steps' });
  }
  if (steps.length === 0) {
    throw new BrowserActionInputError('browser_actions needs at least one step.', { fieldPath: 'steps' });
  }
  if (steps.length > maxSteps) {
    throw new BrowserActionInputError(`browser_actions accepts at most ${maxSteps} steps per call (got ${steps.length}).`, { fieldPath: 'steps' });
  }
  return steps.map((step, index) => validateStep(step, index));
}

/**
 * 校验一步。
 * @param step - 单步输入。
 * @param index - 步序号，只用于报错。
 */
function validateStep(step, index) {
  if (step === null || typeof step !== 'object' || Array.isArray(step)) {
    throw new BrowserActionInputError(`step ${index} must be an object.`, { step: index });
  }
  const action = String(step.action ?? '').toLowerCase();
  if (action === '') {
    throw new BrowserActionInputError(`step ${index} has no action.`, { step: index, fieldPath: 'action' });
  }
  const entry = BROWSER_ACTION_CATALOG[action];
  if (entry === undefined) {
    throw new BrowserActionInputError(`step ${index} has unknown action "${step.action ?? ''}" (this build understands: ${Object.keys(BROWSER_ACTION_CATALOG).join(', ')}).`, { step: index, action, fieldPath: 'action' });
  }
  for (const key of Object.keys(step)) {
    if (key === 'action') continue;
    if (!ALL_STEP_FIELDS.includes(key)) {
      throw new BrowserActionInputError(`step ${index} (${action}) has unknown field "${key}". This build accepts: ${Object.keys(entry.fields).join(', ') || '(none)'}.`, { step: index, action, fieldPath: key });
    }
    if (entry.fields[key] === undefined) {
      throw new BrowserActionInputError(`step ${index} (${action}) does not use "${key}". ${action} accepts: ${Object.keys(entry.fields).join(', ') || '(no other field)'}.`, { step: index, action, fieldPath: key });
    }
  }
  const normalized = { action };
  for (const [name, spec] of Object.entries(entry.fields)) {
    const present = Object.prototype.hasOwnProperty.call(step, name) && step[name] !== undefined && step[name] !== null;
    if (!present) {
      if (spec.required === true) {
        throw new BrowserActionInputError(`step ${index} (${action}) needs "${name}" (${describeType(spec)}).`, { step: index, action, fieldPath: name });
      }
      continue;
    }
    normalized[name] = checkField(step[name], spec, { index, action, name });
  }
  checkActionRules(action, normalized, index);
  return normalized;
}

/**
 * 单字段的类型与范围检查；返回规范化后的值。
 * @param value - 原始值。
 * @param spec - 目录里的字段定义。
 * @param where - `{ index, action, name }`，只用于报错。
 */
function checkField(value, spec, where) {
  const fail = (message) => {
    throw new BrowserActionInputError(`step ${where.index} (${where.action}) field "${where.name}": ${message}`, { step: where.index, action: where.action, fieldPath: where.name });
  };
  if (!typeOk(spec, value)) fail(`must be ${describeType(spec)}, got ${typeName(value)}.`);
  if (spec.type === 'string') {
    if (spec.minLength !== undefined && value.length < spec.minLength) fail('must not be empty.');
    if (spec.maxChars !== undefined && value.length > spec.maxChars) fail(`must be at most ${spec.maxChars} character(s).`);
    if (Array.isArray(spec.enum) && !spec.enum.includes(value)) fail(`must be one of ${spec.enum.join(', ')}.`);
    return value;
  }
  if (spec.type === 'integer' || spec.type === 'number') {
    if (spec.min !== undefined && value < spec.min) fail(`must be at least ${spec.min}.`);
    if (spec.max !== undefined && value > spec.max) fail(`must be at most ${spec.max}.`);
    return value;
  }
  if (spec.type === 'string-array') {
    const items = value.map((one) => one.trim()).filter((one) => one !== '');
    if (spec.minItems !== undefined && items.length < spec.minItems) fail(`needs at least ${spec.minItems} non-empty path(s).`);
    if (spec.maxItems !== undefined && items.length > spec.maxItems) fail(`accepts at most ${spec.maxItems} path(s).`);
    for (const one of items) {
      if (one.length > UPLOAD_LIMITS.maxPathChars) fail(`a path must be at most ${UPLOAD_LIMITS.maxPathChars} character(s).`);
    }
    return items;
  }
  if (spec.type === 'object') {
    const out = {};
    for (const [key, sub] of Object.entries(spec.subfields ?? {})) {
      const raw = value[key];
      if (raw === undefined || raw === null) continue;
      if (!typeOk(sub, raw)) fail(`"${key}" must be ${describeType(sub)}, got ${typeName(raw)}.`);
      if (sub.type === 'string' && String(raw).trim() === '') continue;
      out[key] = sub.type === 'string' ? String(raw).trim() : raw;
    }
    return out;
  }
  return value;
}

/** 动作自身的组合规则（跨字段），与字段级检查分开写，读起来就是方案 4.2 那张表。 */
function checkActionRules(action, step, index) {
  const fail = (message, fieldPath) => {
    throw new BrowserActionInputError(`step ${index} (${action}) ${message}`, { step: index, action, fieldPath });
  };
  if (action === 'scroll') {
    const dx = Number(step.dx ?? 0);
    const dy = Number(step.dy ?? 0);
    if (Math.abs(dx) > SCROLL_LIMIT || Math.abs(dy) > SCROLL_LIMIT) fail(`expects a displacement within ±${SCROLL_LIMIT} CSS pixels.`, 'dy');
    if (step.ref === undefined && dx === 0 && dy === 0) fail('needs a non-zero dx or dy (or a ref to scroll into view).', 'dy');
    return;
  }
  if (action === 'tabs') {
    const operation = String(step.operation ?? 'list').toLowerCase();
    if (!['list', 'create', 'activate', 'close'].includes(operation)) fail(`has unknown tabs operation "${step.operation}" (this build understands: list, create, activate, close).`, 'operation');
    step.operation = operation;
    // activate/close 的默认目标是"这次调用当前绑定的那个页面"（既有行为，必须保留）；给了 tab
    // 就按给的来，空串由 minLength 挡掉。默认值本身不在这里补，处理器仍读 `step.tab ?? boundTarget`。
    return;
  }
  if (action === 'wait_for') {
    const condition = step.condition ?? {};
    const wanted = String(condition.name ?? condition.text ?? '').trim();
    const wantedUrl = String(condition.url ?? '').trim();
    if (wanted === '' && wantedUrl === '') {
      fail('needs a condition: a name/text to appear, or a url substring.', 'condition');
    }
  }
}

/** 值的中文类型名，只出现在报错里。 */
function typeName(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

/**
 * 供文档生成器使用的目录表：一行一个字段。
 * @returns `{ action, effect, retryPolicy, resources, fields }` 的数组。
 */
export function catalogRows() {
  return Object.entries(BROWSER_ACTION_CATALOG).map(([action, entry]) => ({
    action,
    effect: entry.effect,
    retryPolicy: entry.retryPolicy,
    resources: [...entry.resources],
    fields: Object.entries(entry.fields).map(([name, spec]) => ({
      name,
      type: spec.type,
      required: spec.required === true,
      description: spec.description ?? '',
    })),
  }));
}
