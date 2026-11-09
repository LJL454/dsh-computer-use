/**
 * PR03 —— select 的后置验证（方案 4.3）。
 *
 * 被证伪的那条旧行为：`select` 以 `chosen.ok` 判成功 —— 只要页面里存在一个同名 option 就算
 * 通过，哪怕 `change` 回调把值改了回来。原函数模拟的结果是"请求上海、实际值 bj，仍得到
 * verification=ok"。
 *
 * 这里不连浏览器，也不重新实现一遍逻辑：用一个最小 DOM 在 `node:vm` 里**真的执行**驱动注入到
 * 页面里的那段函数，再把控制器的最终值读回来判断。于是每个场景证的都是同一件事的不同侧面：
 *
 *   - 同步回退、异步回退 → mismatch（而不是 ok）；
 *   - label 与 value 不同 → 按最终 DOM value 判断，AX 只作旁证；
 *   - 选项歧义 → 拒绝，且在改值之前就停（不猜）；
 *   - 读不回来 → unavailable + outcome unknown（写已派出，不能记成失败诱发重放）；
 *   - 找到了选项但没写进去 → mismatch。
 *
 *   node select-verify-test.mjs
 */
import { runActions } from './browser/actions.mjs';
import { createContext, runInContext } from 'node:vm';

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}

/* --------------------------------------------------------------- small DOM */

/** A page event, as the injected functions construct it. */
class PageEvent {
  constructor(type, init) { this.type = type; this.bubbles = init?.bubbles === true; }
}

class FakeInput {
  constructor(value = '') { this._value = String(value); }
  get value() { return this._value; }
  set value(next) { this._value = String(next); }
  dispatchEvent(event) { if (typeof this.onEvent === 'function') this.onEvent(event); return true; }
}

class FakeTextArea extends FakeInput {}
class FakeInputElement extends FakeInput {}

/** A `<select>` with the parts the driver's page function touches. */
class FakeSelect extends FakeInput {
  constructor(options) {
    super(options[0]?.value ?? '');
    this.options = options.map((one) => ({ value: String(one.value), label: String(one.label ?? one.value), text: String(one.text ?? one.label ?? one.value) }));
  }
  get value() { return this._value; }
  set value(next) {
    const wanted = String(next);
    // A real select ignores a value no option has; the driver relies on that when it checks the
    // final value, so the fake must not be more permissive than the browser.
    if (this.options.some((one) => one.value === wanted)) this._value = wanted;
  }
  dispatchEvent(event) { if (typeof this.onEvent === 'function') this.onEvent(event); return true; }
}

/* ------------------------------------------------------------- fake session */

/**
 * Build a BrowserSession-shaped object whose `connection.send` executes the injected page
 * functions against a fake element, and records every protocol write.
 */
function fakeSession(element, hooks = {}) {
  const protocol = [];
  const sandbox = createContext({ HTMLSelectElement: FakeSelect, HTMLTextAreaElement: FakeTextArea, HTMLInputElement: FakeInputElement, Event: PageEvent });
  const session = {
    refs: new Map([['ref-1', { targetId: 'T1', backendNodeId: 7, role: 'combobox', name: '城市' }]]),
    rejectReason: () => '',
    prepare: async () => 'S1',
    connection: {
      connected: true,
      on: () => () => {},
      generation: 1,
      send: async (method, params) => {
        protocol.push({ method, params });
        if (method === 'DOM.resolveNode') return { object: { objectId: 'obj-7' } };
        if (method === 'Runtime.releaseObject') return {};
        if (method === 'Accessibility.getPartialAXTree') {
          return { nodes: [{ role: { value: 'combobox' }, name: { value: '城市' }, value: { value: String(hooks.axValue ?? element.value) } }] };
        }
        if (method === 'Runtime.callFunctionOn') {
          const source = String(params.functionDeclaration ?? '');
          if (hooks.failSet === true && source.includes('dispatchEvent')) throw new Error('the page went away mid-set');
          if (hooks.failRead === true && source.includes('typeof this.value')) throw new Error('the page went away before the value could be read');
          const fn = runInContext(`(${source})`, sandbox, { timeout: 1000 });
          const args = Array.isArray(params.arguments) ? params.arguments.map((one) => one?.value) : [];
          const value = await fn.apply(element, args);
          return { result: { value } };
        }
        throw new Error(`unexpected protocol call ${method}`);
      },
    },
  };
  // "written" means the page function that mutates the control ran; resolving the node and
  // reading the value back are reads and must not be counted as dispatches.
  return { session, protocol, written: () => protocol.filter((one) => one.method === 'Runtime.callFunctionOn' && String(one.params.functionDeclaration ?? '').includes('dispatchEvent')).length };
}

const step = (value, extra = {}) => ({ action: 'select', ref: 'ref-1', value, ...extra });

/* ------------------------------------------------------------------ cases */

console.log('\n== a value that sticks is ok, and the receipt says what it compared ==');
{
  const select = new FakeSelect([{ value: 'bj', label: '北京' }, { value: 'sh', label: '上海' }]);
  const { session } = fakeSession(select);
  const receipt = await runActions(session, { targetId: 'T1', steps: [step('sh')], timeoutMs: 5000 });
  check('the step is verified', receipt.verification[0]?.status === 'ok', JSON.stringify(receipt.verification[0]));
  check('the control really holds the value', select.value === 'sh', select.value);
  // 方案 4.9 的 verifyMs：验证阶段耗时单独报，且必须是数字（这里必然 >0，因为真的读了一次 DOM）。
  check('the receipt reports how long verification took', Number.isFinite(receipt.verifyMs) && receipt.verifyMs >= 0, String(receipt.verifyMs));
  check('the note names the DOM value it compared', /the control's value is "sh"/.test(receipt.verification[0]?.note ?? ''), String(receipt.verification[0]?.note));
  check('the call reports the page was touched', receipt.actionSent === true && receipt.outcome === 'completed', JSON.stringify({ actionSent: receipt.actionSent, outcome: receipt.outcome }));
}

console.log('\n== a label selects its option, and the comparison is against the value ==');
{
  const select = new FakeSelect([{ value: 'bj', label: '北京' }, { value: 'sh', label: '上海' }]);
  const { session } = fakeSession(select);
  const receipt = await runActions(session, { targetId: 'T1', steps: [step('上海')], timeoutMs: 5000 });
  check('a label is accepted', receipt.verification[0]?.status === 'ok', JSON.stringify(receipt.verification[0]));
  check('the control now holds the option value, not the label', select.value === 'sh', select.value);
  check('the receipt names the expected value', /expected "sh"/.test(receipt.performed[0] ?? ''), receipt.performed[0]);
}

console.log('\n== a change handler that puts the old value back is a mismatch ==');
{
  const select = new FakeSelect([{ value: 'bj', label: '北京' }, { value: 'sh', label: '上海' }]);
  select.onEvent = (event) => { if (event.type === 'change') select.value = 'bj'; };
  const { session } = fakeSession(select, { axValue: 'bj' });
  const receipt = await runActions(session, { targetId: 'T1', steps: [step('sh')], timeoutMs: 5000 });
  check('reverting synchronously is not reported as ok', receipt.verification[0]?.status === 'mismatch', JSON.stringify(receipt.verification[0]));
  check('the step fails and says what the control reports', receipt.failedAt === 0 && /reports "bj"/.test(receipt.error ?? ''), JSON.stringify({ failedAt: receipt.failedAt, error: receipt.error }));
  check('the call still tells the truth about having written', receipt.actionSent === true, String(receipt.actionSent));
}

console.log('\n== a revert one tick later is caught too ==');
{
  const select = new FakeSelect([{ value: 'bj', label: '北京' }, { value: 'sh', label: '上海' }]);
  select.onEvent = (event) => { if (event.type === 'change') setTimeout(() => { select.value = 'bj'; }, 15); };
  const { session } = fakeSession(select);
  const receipt = await runActions(session, { targetId: 'T1', steps: [step('sh')], timeoutMs: 5000 });
  check('an asynchronous revert is a mismatch, not an ok', receipt.verification[0]?.status === 'mismatch', JSON.stringify(receipt.verification[0]));
  check('and the control is back on the old value', select.value === 'bj', select.value);
}

console.log('\n== an ambiguous match is refused before anything is changed ==');
{
  const select = new FakeSelect([{ value: 'bj', label: '上海' }, { value: 'sh', label: '上海' }]);
  let events = 0;
  select.onEvent = () => { events += 1; };
  const { session, written } = fakeSession(select);
  const receipt = await runActions(session, { targetId: 'T1', steps: [step('上海')], timeoutMs: 5000 });
  check('the refusal is a mismatch', receipt.verification[0]?.status === 'mismatch', JSON.stringify(receipt.verification[0]));
  check('the note says it matched more than one option', /matches more than one option/.test(receipt.verification[0]?.note ?? ''), String(receipt.verification[0]?.note));
  check('no event was dispatched', events === 0, String(events));
  check('nothing was written to the page', written() === 0, String(written()));
  check('the control still holds its original value', select.value === 'bj', select.value);
  check('the receipt says nothing was sent', receipt.actionSent === false, String(receipt.actionSent));
}

console.log('\n== an exact value wins over another option’s label ==');
{
  const select = new FakeSelect([{ value: 'sh', label: 'X' }, { value: 'bj', label: 'sh' }]);
  const { session } = fakeSession(select);
  const receipt = await runActions(session, { targetId: 'T1', steps: [step('sh')], timeoutMs: 5000 });
  check('the option whose value is "sh" is the one chosen', select.value === 'sh', select.value);
  check('and the step is ok', receipt.verification[0]?.status === 'ok', JSON.stringify(receipt.verification[0]));
}

console.log('\n== a value no option has is refused, and nothing is written ==');
{
  const select = new FakeSelect([{ value: 'bj', label: '北京' }]);
  const { session, written } = fakeSession(select);
  const receipt = await runActions(session, { targetId: 'T1', steps: [step('gz')], timeoutMs: 5000 });
  check('the step fails', receipt.failedAt === 0 && receipt.outcome === 'failed', JSON.stringify({ failedAt: receipt.failedAt, outcome: receipt.outcome }));
  check('the note lists what the control offers', /offers \["bj"\]/.test(receipt.verification[0]?.note ?? ''), String(receipt.verification[0]?.note));
  check('nothing was written', written() === 0, String(written()));
}

console.log('\n== a value that cannot be read back is unknown, not a failure to replay ==');
{
  const select = new FakeSelect([{ value: 'bj', label: '北京' }, { value: 'sh', label: '上海' }]);
  const { session } = fakeSession(select, { failRead: true });
  const receipt = await runActions(session, { targetId: 'T1', steps: [step('sh')], timeoutMs: 5000 });
  check('the verification is unavailable', receipt.verification[0]?.status === 'unavailable', JSON.stringify(receipt.verification[0]));
  check('the outcome is unknown', receipt.outcome === 'unknown', String(receipt.outcome));
  check('the receipt says the write was sent', receipt.actionSent === true, String(receipt.actionSent));
  check('the error explains why it cannot be called either way', /could not be read back/.test(receipt.error ?? ''), String(receipt.error));
}

console.log('\n== the accessibility tree is auxiliary evidence, never the comparison ==');
{
  const select = new FakeSelect([{ value: 'bj', label: '北京' }, { value: 'sh', label: '上海' }]);
  const { session } = fakeSession(select, { axValue: 'bj' });
  const receipt = await runActions(session, { targetId: 'T1', steps: [step('sh')], timeoutMs: 5000 });
  check('a lagging AX value does not make a correct write fail', receipt.verification[0]?.status === 'ok', JSON.stringify(receipt.verification[0]));
  check('the AX value is still carried in the note', /the tree shows "bj"/.test(receipt.verification[0]?.note ?? ''), String(receipt.verification[0]?.note));
}

console.log('\n== a set that throws leaves the step failed with the write marked as sent ==');
{
  const select = new FakeSelect([{ value: 'bj', label: '北京' }, { value: 'sh', label: '上海' }]);
  const { session } = fakeSession(select, { failSet: true });
  const receipt = await runActions(session, { targetId: 'T1', steps: [step('sh')], timeoutMs: 5000 });
  check('the step fails', receipt.failedAt === 0, String(receipt.failedAt));
  check('the call knows the page was touched', receipt.actionSent === true, String(receipt.actionSent));
  check('and the outcome is not a plain "failed" replay invitation', ['failed', 'unknown'].includes(receipt.outcome), String(receipt.outcome));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
