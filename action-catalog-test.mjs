/**
 * PR02 —— 动作目录与输入契约（方案 4.2）。
 *
 * 这一组断言不看浏览器、不启进程，只回答三个可以被证伪的问题：
 *
 *   1. 目录是不是名副其实：`browser/actions.mjs` 认识的每个动作都有一条目录项，条目里的每个
 *      字段都在公开声明里，且每个动作在处理器里真有分支。
 *   2. 合法输入能不能过：每个动作一组最小有效输入都必须被接受，规范化后字段还在。
 *   3. 非法输入会不会被挡在派发之前：未知动作、缺必填、错类型、未知字段、跨动作字段、越界值、
 *      空文件数组、零位移滚动、缺 tab 的标签页操作、空条件 —— 每一条都以 `BAD_REQUEST` 失败，
 *      并指出字段路径。
 *
 *   node action-catalog-test.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_ACTIONS } from './browser/actions.mjs';
import {
  ALL_STEP_FIELDS,
  BROWSER_ACTION_CATALOG,
  MAX_STEPS,
  SCROLL_LIMIT,
  STATE_LIMITS,
  UPLOAD_LIMITS,
} from './internal/actions/catalog.mjs';
import {
  BrowserActionInputError,
  browserStepParameterSchema,
  catalogRows,
  validateBrowserSteps,
} from './internal/actions/schemas.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
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

console.log('\n== the catalog covers exactly the actions the driver understands ==');
check(`the driver exports ${BROWSER_ACTIONS.length} action(s)`, BROWSER_ACTIONS.length > 0, String(BROWSER_ACTIONS.length));
check('every driver action has a catalog entry', BROWSER_ACTIONS.every((action) => BROWSER_ACTION_CATALOG[action] !== undefined), Object.keys(BROWSER_ACTION_CATALOG).join(','));
check('the catalog has no action the driver does not know', Object.keys(BROWSER_ACTION_CATALOG).every((action) => BROWSER_ACTIONS.includes(action)));
check('the catalog lists each action once', new Set(Object.keys(BROWSER_ACTION_CATALOG)).size === Object.keys(BROWSER_ACTION_CATALOG).length);
for (const action of BROWSER_ACTIONS) {
  const entry = BROWSER_ACTION_CATALOG[action];
  check(`${action} declares an effect and a retry policy`, ['read', 'write', 'navigation'].includes(entry.effect) && typeof entry.retryPolicy === 'string', `${entry.effect}/${entry.retryPolicy}`);
  check(`${action} declares at least one resource`, Array.isArray(entry.resources) && entry.resources.length > 0, JSON.stringify(entry.resources));
}

console.log('\n== the public declaration names every field the handlers consume ==');
const declared = browserStepParameterSchema();
check('the step object is closed to unknown keys', declared.additionalProperties === false, String(declared.additionalProperties));
check('`action` is declared first and required', Object.keys(declared.properties)[0] === 'action' && declared.properties.action.required === true, Object.keys(declared.properties).slice(0, 3).join(','));
check('the action enum matches the catalog', JSON.stringify(declared.properties.action.enum) === JSON.stringify(Object.keys(BROWSER_ACTION_CATALOG)), JSON.stringify(declared.properties.action.enum));
for (const fieldName of ALL_STEP_FIELDS) {
  check(`"${fieldName}" is declared`, declared.properties[fieldName] !== undefined);
}
// 方案 1.2 第一条：press/upload/scroll/tabs/wait_for 的字段在处理器里读，公开 schema 却没有。
const MISSING_BEFORE = ['key', 'code', 'files', 'dx', 'dy', 'operation', 'tab', 'condition'];
for (const fieldName of MISSING_BEFORE) {
  check(`the previously missing field "${fieldName}" now reaches the public schema`, declared.properties[fieldName] !== undefined);
}
for (const [action, entry] of Object.entries(BROWSER_ACTION_CATALOG)) {
  for (const [fieldName, spec] of Object.entries(entry.fields)) {
    const shown = declared.properties[fieldName];
    check(`${action}.${fieldName} is declared with a matching type`, shown !== undefined && (shown.type === spec.type || (spec.type === 'string-array' && shown.type === 'array')) || (spec.type === 'number' && shown.type === 'number'), `${fieldName}: declared ${shown?.type} vs catalog ${spec.type}`);
  }
}

console.log('\n== each action has a handler branch in the driver ==');
const driverSource = readFileSync(join(HERE, 'browser', 'actions.mjs'), 'utf8');
for (const action of BROWSER_ACTIONS) {
  if (action === 'click') {
    check('click has its default branch', /\/\/ click/.test(driverSource));
    continue;
  }
  check(`${action} is branched on by name`, driverSource.includes(`action === '${action}'`));
}

/* ------------------------------------------------------------ valid inputs */

/** A value that satisfies a field spec, for the minimal-valid-input cases. */
function sample(spec) {
  switch (spec.type) {
    case 'string':
      if (Array.isArray(spec.enum)) return spec.enum[0];
      return spec.minLength !== undefined ? 'x' : 'sample';
    case 'integer': return spec.min ?? 1;
    case 'number': return 1;
    case 'boolean': return true;
    case 'string-array': return ['C:\\temp\\one.txt'];
    case 'object': {
      const entries = Object.entries(spec.subfields ?? {});
      if (entries.length === 0) return {};
      const [name, sub] = entries[0];
      return { [name]: sub.type === 'string' ? 'x' : sample(sub) };
    }
    default: return 'x';
  }
}

console.log('\n== every action accepts a minimal valid step and keeps its fields ==');
for (const [action, entry] of Object.entries(BROWSER_ACTION_CATALOG)) {
  const step = { action };
  for (const [fieldName, spec] of Object.entries(entry.fields)) {
    if (spec.required === true) step[fieldName] = sample(spec);
  }
  // scroll's non-zero rule and tabs' operation both need a legal shape beyond "required only".
  if (action === 'scroll') step.dy = 120;
  if (action === 'tabs') step.operation = 'list';
  try {
    const [normalized] = validateBrowserSteps([step]);
    const kept = Object.keys(entry.fields).every((fieldName) => step[fieldName] === undefined || normalized[fieldName] !== undefined);
    check(`${action} accepts ${JSON.stringify(step)}`, normalized.action === action && kept, JSON.stringify(normalized));
  } catch (error) {
    check(`${action} accepts a minimal valid step`, false, String(error?.message ?? error));
  }
}

console.log('\n== normalization: lower-case actions, trimmed file lists, empty condition keys dropped ==');
{
  const [one] = validateBrowserSteps([{ action: 'CLICK', ref: 'r1' }]);
  check('the action is normalized to lower case', one.action === 'click', one.action);
  const [two] = validateBrowserSteps([{ action: 'upload', ref: 'r1', files: [' a.txt ', '', 'b.txt'] }]);
  check('blank file paths are dropped and the rest trimmed', JSON.stringify(two.files) === JSON.stringify(['a.txt', 'b.txt']), JSON.stringify(two.files));
  const [three] = validateBrowserSteps([{ action: 'wait_for', condition: { name: ' saved ', url: '   ' } }]);
  check('the condition keeps name and drops a blank url', JSON.stringify(three.condition) === JSON.stringify({ name: 'saved' }), JSON.stringify(three.condition));
  const [four] = validateBrowserSteps([{ action: 'tabs', tab: 'T1' }]);
  check('tabs operation defaults to list', four.operation === 'list', String(four.operation));
}

/* ---------------------------------------------------------- invalid inputs */

/** Each case must fail with BAD_REQUEST, before anything could be dispatched. */
const NEGATIVE = [
  ['no steps', [], undefined],
  ['steps is not an array', { action: 'state' }, undefined],
  ['more steps than the cap', Array.from({ length: MAX_STEPS + 1 }, () => ({ action: 'state' })), undefined],
  ['a step that is not an object', ['state'], undefined],
  ['a step with no action', [{}], 'action'],
  ['an unknown action', [{ action: 'fling' }], 'action'],
  ['click without a ref', [{ action: 'click' }], 'ref'],
  ['click with an unknown field', [{ action: 'click', ref: 'r1', colour: 'red' }], 'colour'],
  ['click with a field another action owns', [{ action: 'click', ref: 'r1', key: 'Enter' }], 'key'],
  ['fill with a numeric value', [{ action: 'fill', ref: 'r1', value: 12 }], 'value'],
  ['navigate with an empty url', [{ action: 'navigate', url: '' }], 'url'],
  ['upload with no files', [{ action: 'upload', ref: 'r1', files: [] }], 'files'],
  ['upload with a non-string path', [{ action: 'upload', ref: 'r1', files: ['a.txt', 3] }], 'files'],
  ['upload beyond the file cap', [{ action: 'upload', ref: 'r1', files: Array.from({ length: UPLOAD_LIMITS.maxFiles + 1 }, (_, index) => `f${index}.txt`) }], 'files'],
  ['scroll with no displacement', [{ action: 'scroll', dx: 0, dy: 0 }], 'dy'],
  ['scroll beyond the displacement limit', [{ action: 'scroll', dy: SCROLL_LIMIT + 1 }], 'dy'],
  ['tabs with an unknown operation', [{ action: 'tabs', operation: 'destroy' }], 'operation'],
  ['tabs with an empty step tab', [{ action: 'tabs', operation: 'close', tab: '' }], 'tab'],
  ['wait_for without a condition', [{ action: 'wait_for' }], 'condition'],
  ['wait_for with an empty condition', [{ action: 'wait_for', condition: {} }], 'condition'],
  ['state beyond the node budget', [{ action: 'state', max_nodes: STATE_LIMITS.maxNodes + 1 }], 'max_nodes'],
  ['state beyond the character budget', [{ action: 'state', max_chars: STATE_LIMITS.maxChars + 1 }], 'max_chars'],
  ['press with an over-long key', [{ action: 'press', key: 'x'.repeat(65) }], 'key'],
  ['press without a key', [{ action: 'press' }], 'key'],
  ['select without a value', [{ action: 'select', ref: 'r1' }], 'value'],
  ['hover without a ref', [{ action: 'hover' }], 'ref'],
  ['type with a numeric value', [{ action: 'type', ref: 'r1', value: 5 }], 'value'],
];

console.log('\n== invalid input fails as BAD_REQUEST and names the field ==');
for (const [label, steps, fieldPath] of NEGATIVE) {
  try {
    validateBrowserSteps(steps);
    check(`rejects: ${label}`, false, 'it was accepted');
  } catch (error) {
    const isBadRequest = error instanceof BrowserActionInputError && error.code === 'BAD_REQUEST' && String(error.message).startsWith('[BAD_REQUEST]');
    const namedField = fieldPath === undefined ? true : error.fieldPath === fieldPath;
    check(`rejects: ${label}`, isBadRequest && namedField, `${error?.code ?? 'no code'} / field=${error?.fieldPath ?? '(none)'} / ${error?.message ?? error}`);
  }
}

console.log('\n== 4.2 coverage: the catalog keeps the numbers the contract is written in ==');
const rows = catalogRows();
check(`catalogRows returns one row per action (${BROWSER_ACTIONS.length})`, rows.length === BROWSER_ACTIONS.length, String(rows.length));
check('every row lists its fields', rows.every((row) => row.fields.length > 0), JSON.stringify(rows.map((row) => `${row.action}:${row.fields.length}`)));
check('upload documents its file limit', rows.find((row) => row.action === 'upload').fields.find((one) => one.name === 'files').description.includes(String(UPLOAD_LIMITS.maxFiles)));
check('state documents its node cap', BROWSER_ACTION_CATALOG.state.fields.max_nodes.max === STATE_LIMITS.maxNodes);
check('press documents its key cap', BROWSER_ACTION_CATALOG.press.fields.key.maxChars === 64);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
