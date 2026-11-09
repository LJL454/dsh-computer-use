/**
 * 局部常量优化（方案 五.4）：部件只解析/排序一次、光晕按尺寸×DPI×按压×减少动画缓存。
 *
 * 三段断言：
 *   1. 等价性：缓存光晕与逐像素现算**逐字节相同**（3 DPI × 按压 × 减少动画 = 12 组）；
 *      每个片段加载期解析出的部件表与"现场解析再按 zOrder 排序"完全一致（7 个片段）。
 *   2. 收益：同一帧热缓存上各跑 200 次，缓存路径明显快于现算路径。
 *   3. 运行时：开一个带光晕的 scope，3 秒内光晕只建 1 次左右（帧数远多于构建次数）。
 *
 *   node local-opt-test.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXE = join(HERE, 'native', 'indicator-helper', 'build', 'dsh-interaction-indicator.exe');
const ASSETS = join(HERE, 'assets', 'character');

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

console.log('\n== equivalence: the cached halo is byte-identical to the computed one ==');
const report = JSON.parse(execFileSync(EXE, ['--halo-check', `--assets=${ASSETS}`], { encoding: 'utf8', timeout: 120_000 }).trim());
check('the check reports ok', report?.ok === true, JSON.stringify(report?.detail ?? ''));
check('all 12 halo combinations were compared', report?.checks === 12, String(report?.checks));
check('every clip part list matches the on-the-fly resolution', report?.partChecks === 7, String(report?.partChecks));
check('no pixel differs', report?.failures === 0, String(report?.failures));

console.log('\n== gain: cached halo vs recomputed halo, 200 warm frames each ==');
check('the benchmark ran', Number(report?.benchCachedUs) > 0 && Number(report?.benchComputedUs) > 0,
  `${report?.benchCachedUs} / ${report?.benchComputedUs}`);
check('the cached path is clearly faster', Number(report?.benchCachedUs) < Number(report?.benchComputedUs),
  `${report?.benchCachedUs} vs ${report?.benchComputedUs} µs`);
check('and by at least a quarter', Number(report?.benchCachedUs) <= Number(report?.benchComputedUs) * 0.75,
  `${report?.benchCachedUs} vs ${report?.benchComputedUs} µs`);

console.log('\n== runtime: the halo is built once, not per frame ==');
const staged = join(tmpdir(), `dsh-local-opt-${process.pid}.exe`);
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

try {
  send({ method: 'hello', protocolVersion: 2 });
  await waitFor('ready');
  send({ method: 'beginScope', scopeId: 'opt', epoch: 1 });
  const ready = await waitFor('scopeReady', () => true, 8000);
  check('the scope came up', ready?.visualReady === true, JSON.stringify(ready?.counts));
  send({ method: 'setVisualPreferences', settingsRevision: 2, preferences: { enabled: true, decoration: true, cursorHalo: true, cursorCharacter: true } });
  await waitFor('visualPreferencesApplied');
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const sample = await health();
  const builds = Number(sample?.haloCacheBuilds);
  const presents = Number(sample?.cursorPresents);
  console.log(`  presents=${presents} haloBuilds=${builds} composeAvg=${sample?.cursorComposeAvgUs}µs composeRecent=${sample?.cursorComposeRecentUs}µs composeMax=${sample?.cursorComposeMaxUs}µs`);
  check('the halo was built a handful of times, not per frame', builds <= 4, `${builds} builds / ${presents} presents`);
  check('many frames were composed', presents >= 5, String(presents));
  // 端到端读数受调度噪声影响（只有十来个样本，还要和宿主抢 CPU），**不做断言**：
  // 真正的对比看上面 200 帧微基准与 `haloCacheBuilds`。这里只把数字打出来便于人工核对。
  console.log(`  (end-to-end compose ≈ ${sample?.cursorComposeRecentUs} µs, max ${sample?.cursorComposeMaxUs} µs — scheduling noise, not asserted)`);
  check('no character error', (sample?.characterError ?? '') === '', String(sample?.characterError));

  send({ method: 'endScope' });
  await waitFor('scopeEnded', () => true, 4000);
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
