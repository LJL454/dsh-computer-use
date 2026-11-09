import assert from 'node:assert/strict';
import { createCallCadence } from './internal/call-cadence.mjs';

let passed = 0;
function test(name, body) { body(); passed++; console.log(`PASS ${name}`); }
function fixture(limit = 100) {
  let clock = 0;
  return { cadence: createCallCadence({ now: () => clock, limit }), at(value) { clock = value; } };
}
test('gap starts at prior completion, not prior dispatch; sessions stay separate', () => {
  const { cadence: c, at } = fixture();
  const a = c.begin('a'); assert.deepEqual(a.observation, {});
  at(800); a.finish(); at(1300);
  assert.deepEqual(c.begin('a').observation, { gapBeforeMs: 500 });
  assert.deepEqual(c.begin('b').observation, {});
});
test('overlap is explicit and the next gap starts after all calls finish', () => {
  const { cadence: c, at } = fixture();
  const a = c.begin('a'); at(100); const b = c.begin('a');
  assert.deepEqual(b.observation, { overlappedCall: true });
  at(200); b.finish(); b.finish();
  at(500); a.finish(); at(600);
  assert.deepEqual(c.begin('a').observation, { gapBeforeMs: 100 });
});
test('failure/cancellation cleanup uses the same completion boundary', () => {
  const { cadence: c, at } = fixture();
  const a = c.begin('a');
  try { at(10); throw Error('cancelled'); } catch {} finally { a.finish(); }
  at(25); assert.deepEqual(c.begin('a').observation, { gapBeforeMs: 15 });
});
test('idle history is bounded and evicts the least recently used session', () => {
  const { cadence: c, at } = fixture(2);
  c.begin('a').finish(); at(10); c.begin('b').finish();
  at(20); c.begin('a').finish(); at(30); c.begin('c').finish();
  at(40); assert.deepEqual(c.begin('a').observation, { gapBeforeMs: 20 });
  assert.deepEqual(c.begin('b').observation, {});
});
test('anonymous calls are not combined into a fictional session', () => {
  const { cadence: c, at } = fixture();
  c.begin(undefined).finish(); at(10);
  assert.deepEqual(c.begin('').observation, {});
});
test('dispose drops history and ignores late completion', () => {
  const { cadence: c, at } = fixture();
  const a = c.begin('a'); c.dispose(); at(100); a.finish();
  assert.deepEqual(c.begin('a').observation, {});
});
console.log(`${passed}/${passed} passed`);
