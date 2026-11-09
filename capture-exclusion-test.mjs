/**
 * PR10 尾项 —— 截图期间的视觉排除（方案 4.17.1）。
 *
 * 协调器本身不认识 helper：它只有 `suspend` / `resume` 两个钩子。测试因此可以把"并发捕获"、
 * "捕获抛错"、"恢复期间换了代"这些真实里很难复现的时序逐个摆出来：
 *
 *   - 只有一个持有者时才隐藏，最后一个结束才恢复（否则先结束的会把还在拍的窗口提前放出来）；
 *   - `end` 重复调用、未知 token 都不会多恢复一次；
 *   - 捕获抛错之后 `finally` 里的 `end` 仍然恢复；
 *   - 捕获期间 helper 换了一代：旧的恢复**不**去动新窗口；
 *   - suspend/resume 自己失败时只记录，不把协调器卡在"永远隐藏"的状态。
 *
 *   node capture-exclusion-test.mjs
 */
import { createCaptureExclusion } from './internal/capture-exclusion.mjs';

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A coordinator with ordered hook log. */
function makeCoordinator(options = {}) {
  const calls = [];
  const coordinator = createCaptureExclusion({
    suspend: async () => { calls.push('suspend'); if (options.suspendFails) throw new Error('the helper refused'); },
    resume: async () => { calls.push('resume'); if (options.resumeFails) throw new Error('the helper is gone'); },
  });
  return { coordinator, calls };
}

console.log('\n== one hide, one restore, no matter how many captures run ==');
{
  const { coordinator, calls } = makeCoordinator();
  const a = await coordinator.begin(1);
  const b = await coordinator.begin(1);
  const c = await coordinator.begin(1);
  check('the first capture hides', JSON.stringify(calls) === JSON.stringify(['suspend']), JSON.stringify(calls));
  check('the depth counts every holder', coordinator.depth === 3, String(coordinator.depth));
  check('the overlay is marked suspended', coordinator.suspended === true);
  await coordinator.end(a);
  await coordinator.end(b);
  check('finishing early does not restore', JSON.stringify(calls) === JSON.stringify(['suspend']), JSON.stringify(calls));
  await coordinator.end(c);
  check('the last one restores', JSON.stringify(calls) === JSON.stringify(['suspend', 'resume']), JSON.stringify(calls));
  check('and the coordinator is idle again', coordinator.depth === 0 && coordinator.suspended === false);
}

console.log('\n== a repeated or unknown end cannot restore twice ==');
{
  const { coordinator, calls } = makeCoordinator();
  const token = await coordinator.begin(1);
  await coordinator.end(token);
  const second = await coordinator.end(token);
  const unknown = await coordinator.end({ id: 99, generation: 1 });
  check('the second end is refused', second.resumed === false && /unknown token/.test(second.reason), JSON.stringify(second));
  check('an unknown token is refused', unknown.resumed === false, JSON.stringify(unknown));
  check('resume ran exactly once', calls.filter((one) => one === 'resume').length === 1, JSON.stringify(calls));
}

console.log('\n== a capture that throws still restores ==');
{
  const { coordinator, calls } = makeCoordinator();
  let captured = false;
  try {
    const token = await coordinator.begin(1);
    try {
      throw new Error('the screenshot failed');
    } finally {
      await coordinator.end(token);
    }
  } catch {
    captured = true;
  }
  check('the failure propagated', captured === true);
  check('the overlay was restored anyway', JSON.stringify(calls) === JSON.stringify(['suspend', 'resume']), JSON.stringify(calls));
}

console.log('\n== a new helper generation is not touched by the old restore ==');
{
  const { coordinator, calls } = makeCoordinator();
  const token = await coordinator.begin(1);
  // 捕获期间 helper 重启：新的 begin 用代次 2。隐藏发生在代次 1，新代本来就没被隐藏过。
  const newer = await coordinator.begin(2);
  check('the second generation joins the same suspension (still one hide)', JSON.stringify(calls) === JSON.stringify(['suspend']), JSON.stringify(calls));
  await coordinator.end(token);
  check('the old capture finishing does not resume', JSON.stringify(calls) === JSON.stringify(['suspend']), JSON.stringify(calls));
  const last = await coordinator.end(newer);
  check('the new generation is not resumed into (it was never hidden)', last.resumed === false && /generation changed/.test(last.reason), JSON.stringify(last));
  check('and nothing is left marked as suspended', coordinator.suspended === false && coordinator.depth === 0);

  // 单持有者换代的场景：同一个 token，结束时代次已经变了。
  const solo = makeCoordinator();
  const soloToken = await solo.coordinator.begin(1);
  soloToken.generation = 2;
  const outcome = await solo.coordinator.end(soloToken);
  check('a generation mismatch skips the resume', outcome.resumed === false && /generation changed/.test(outcome.reason), JSON.stringify(outcome));
}

console.log('\n== hook failures are recorded, not fatal ==');
{
  const { coordinator } = makeCoordinator({ suspendFails: true });
  const token = await coordinator.begin(1);
  check('a suspend failure does not claim the overlay is hidden', coordinator.suspended === false);
  const end = await coordinator.end(token);
  check('and the end does not try to resume what was never hidden', end.resumed === false && /nothing was suspended/.test(end.reason), JSON.stringify(end));
  check('the failure is counted', coordinator.failures.suspend === 1, JSON.stringify(coordinator.failures));
}
{
  const { coordinator } = makeCoordinator({ resumeFails: true });
  const token = await coordinator.begin(1);
  const end = await coordinator.end(token);
  check('a resume failure is reported', end.resumed === false && /gone/.test(end.reason), JSON.stringify(end));
  check('and it is counted', coordinator.failures.resume === 1, JSON.stringify(coordinator.failures));
  check('a later capture can still start cleanly', (await coordinator.begin(1)) !== null);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
