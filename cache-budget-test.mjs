/**
 * 缓存预算（方案 五.5）：分配前估算、按组淘汰、固定正在画的组。
 *
 * 断言：
 *   1. 稳态下命中远多于未命中（同一帧不重复解码），临时峰值不超过硬上限；
 *   2. 连续切换角色尺寸制造压力：确实发生组级淘汰，但**当前组**不被淘汰（下一帧仍然命中）；
 *   3. 全程没有"超预算被拒"之外的角色错误，也没有把缓存撑过 64 MiB。
 *
 *   node cache-budget-test.mjs
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXE = join(HERE, 'native', 'indicator-helper', 'build', 'dsh-interaction-indicator.exe');
const ASSETS = join(HERE, 'assets', 'character');
const HARD_LIMIT = 64 * 1024 * 1024;

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

if (!existsSync(EXE) || !existsSync(ASSETS)) {
  console.error(`FAIL  need ${EXE} and ${ASSETS}`);
  process.exit(2);
}

const staged = join(tmpdir(), `dsh-cache-budget-${process.pid}.exe`);
copyFileSync(EXE, staged);  // 工作区盘直接启动的进程收不到低级钩子（本机沙箱行为）
const child = spawn(staged, [`--assets=${ASSETS}`, '--no-affinity'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = '';
const events = [];
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line === '') continue;
    try { events.push(JSON.parse(line)); } catch { /* ignore */ }
  }
});
let nextRequest = 0;
const send = (message) => {
  const requestId = `r${nextRequest += 1}`;
  child.stdin.write(`${JSON.stringify({ requestId, ...message })}\n`);
  return requestId;
};
const waitFor = async (name, predicate = () => true, timeoutMs = 6000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const index = events.findIndex((one) => one.event === name && predicate(one));
    if (index >= 0) return events.splice(index, 1)[0];
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return null;
};
const health = async (predicate = () => true, timeoutMs = 6000) => {
  const requestId = send({ method: 'health' });
  return waitFor('health', (one) => one.requestId === requestId && predicate(one), timeoutMs);
};
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  send({ method: 'hello', protocolVersion: 2 });
  await waitFor('ready', () => true, 8000);
  send({ method: 'setCompanionPreferences', enabled: true, hostInstanceId: 'budget', settingsRevision: 1, helperGeneration: 1 });
  await waitFor('companionApplied');
  await settle(2500);
  const warm = await health((one) => one.prewarmState === 'done', 8000);

  console.log('\n== steady state: hits dominate, the peak stays under the hard limit ==');
  const baseline = await health();
  await settle(1500);
  const steady = await health();
  const hits = Number(steady?.characterCacheHits) - Number(baseline?.characterCacheHits);
  const misses = Number(steady?.characterCacheMisses) - Number(baseline?.characterCacheMisses);
  const peak = Number(steady?.characterCacheTemporaryPeak);
  console.log(`  hits=${hits} misses=${misses} peak=${(peak / 1048576).toFixed(1)} MiB bytes=${steady?.characterCacheBytes}`);
  // 待机时 renderKey 把大部分唤醒挡掉了（~3.5 次合成/秒，每次 3 个 Prepare），所以 1.5 秒只有十来个命中。
  check('the cache is hit on every composed frame', hits >= 6, String(hits));
  check('and almost never misses', misses <= 1, String(misses));
  check('the build peak is recorded and under the hard limit', peak > 0 && peak < HARD_LIMIT,
    `${(peak / 1048576).toFixed(1)} MiB`);
  check('the resident cache is far below the hard limit', Number(steady?.characterCacheBytes) < HARD_LIMIT,
    String(steady?.characterCacheBytes));
  check('the prewarm really ran', Number(warm?.prewarmBuilt) >= 7, String(warm?.prewarmBuilt));

  console.log('\n== pressure: cycling sizes evicts whole groups, never the active one ==');
  const heights = [72, 80, 88, 96, 104, 112, 120, 128, 76, 84, 92, 100, 108, 116, 124];
  for (const height of heights) {
    send({ method: 'setVisualPreferences', settingsRevision: 100 + height, preferences: { cursorCharacterHeightDip: height } });
    await waitFor('visualPreferencesApplied', () => true, 4000);
    await settle(120);
  }
  const pressured = await health();
  console.log(`  hits=${pressured?.characterCacheHits} misses=${pressured?.characterCacheMisses} evictions=${pressured?.characterCacheEvictions} bytes=${pressured?.characterCacheBytes} peak=${(Number(pressured?.characterCacheTemporaryPeak) / 1048576).toFixed(1)} MiB`);
  check('changing sizes produced real cache builds', Number(pressured?.characterCacheMisses) > misses + 4,
    String(pressured?.characterCacheMisses));
  check('group eviction actually happened', Number(pressured?.characterCacheEvictions) > 0,
    String(pressured?.characterCacheEvictions));
  check('nothing was refused for exceeding the budget', Number(pressured?.characterCacheRejected) === 0,
    String(pressured?.characterCacheRejected));
  check('the resident cache stayed bounded', Number(pressured?.characterCacheBytes) < HARD_LIMIT,
    String(pressured?.characterCacheBytes));
  check('the peak stayed bounded', Number(pressured?.characterCacheTemporaryPeak) < HARD_LIMIT,
    String(pressured?.characterCacheTemporaryPeak));

  console.log('\n== the active group survives: the next frames hit again ==');
  const afterBefore = await health();
  await settle(1200);
  const after = await health();
  const hitsAfter = Number(after?.characterCacheHits) - Number(afterBefore?.characterCacheHits);
  const missesAfter = Number(after?.characterCacheMisses) - Number(afterBefore?.characterCacheMisses);
  // 待机时 renderKey 只放行 ~3.5 次合成/秒、每次 3 个 Prepare，所以 1.2 秒能有 4 次以上命中就说明'当前组还在'。
  check('the current clip keeps hitting after the pressure', hitsAfter >= 4, String(hitsAfter));
  check('without re-decoding every frame', missesAfter <= 3, String(missesAfter));
  check('no character error', (after?.characterError ?? '') === '', String(after?.characterError));

  send({ method: 'setCompanionPreferences', enabled: false, hostInstanceId: 'budget', settingsRevision: 999, helperGeneration: 1 });
  await waitFor('companionApplied');
  send({ method: 'shutdown' });
  await waitFor('closed', () => true, 4000);
} catch (error) {
  failures.push(`probe crashed :: ${error?.message ?? error}`);
  console.error(error);
} finally {
  try { child.stdin.end(); } catch { /* gone */ }
  setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 300);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
