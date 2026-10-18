/**
 * 两份 `stress-soak.mjs` 结果的对照（9.txt §12.3）。
 *
 * §12.3 的门槛里有一条是可执行的："同一稳定场景的 p95 不出现超过 5% 的持续退化；发生波动时
 * 增加样本确认原因"。所以基线要能**比**，而不只是存着——这个脚本就是那把尺子：
 *
 *   node tools/compare-soak.mjs <before.json> <after.json> [--threshold 5]
 *
 * 它只做三件事：对齐同名调用、给出 p50/p95 的差值与百分比、并在"样本数不同"或"超出阈值"时
 * 明说。它**不**下结论说"变快/变慢"——桌面同时在跑别的东西（可见窗口数写在 JSON 的
 * `environment` 里），一两次差异要按噪声读，持续差异才需要查原因。
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const paths = args.filter((one) => !one.startsWith('--'));
const thresholdAt = args.indexOf('--threshold');
const THRESHOLD = thresholdAt === -1 ? 5 : Number(args[thresholdAt + 1]);

if (paths.length !== 2) {
  console.error('用法：node tools/compare-soak.mjs <before.json> <after.json> [--threshold 5]');
  process.exit(2);
}
const load = (given) => JSON.parse(readFileSync(isAbsolute(given) ? given : join(ROOT, given), 'utf8'));
const before = load(paths[0]);
const after = load(paths[1]);

const pct = (from, to) => (from === null || from === undefined || from === 0 ? null : ((to - from) / from) * 100);
const fmt = (value) => (value === null || value === undefined ? '—' : `${Math.round(value * 10) / 10}`);
const signed = (value) => (value === null ? '—' : `${value >= 0 ? '+' : ''}${Math.round(value * 10) / 10}%`);

const byLabel = (report) => new Map(report.summary.map((row) => [row.label, row]));
const beforeRows = byLabel(before);
const afterRows = byLabel(after);
const labels = [...new Set([...beforeRows.keys(), ...afterRows.keys()])];

console.log(`before: ${paths[0]}（${before.environment?.visibleWindows ?? '?'} 个可见窗口，每类 ${[...beforeRows.values()][0]?.calls ?? '?'} 个样本）`);
console.log(`after : ${paths[1]}（${after.environment?.visibleWindows ?? '?'} 个可见窗口，每类 ${[...afterRows.values()][0]?.calls ?? '?'} 个样本）`);
console.log('');
console.log('调用                 p50 before → after         p95 before → after          判定');
const regressions = [];
for (const label of labels) {
  const one = beforeRows.get(label);
  const two = afterRows.get(label);
  if (one === undefined || two === undefined) {
    console.log(`${label.padEnd(20)} 只有一份结果，无法对照`);
    continue;
  }
  const p50 = pct(one.total.p50, two.total.p50);
  const p95 = pct(one.total.p95, two.total.p95);
  const sampleMismatch = one.calls !== two.calls;
  let verdict = '在噪声范围内';
  if (sampleMismatch) verdict = `样本数不同（${one.calls} vs ${two.calls}）——先对齐再判断`;
  else if (p95 !== null && p95 > THRESHOLD) {
    verdict = `p95 退化 ${signed(p95)}（阈值 ${THRESHOLD}%）——需要加样本确认原因`;
    regressions.push({ label, p95 });
  }
  console.log(`${label.padEnd(20)} ${fmt(one.total.p50).padStart(6)} → ${fmt(two.total.p50).padStart(6)} ms ${signed(p50).padStart(8)}   ${fmt(one.total.p95).padStart(6)} → ${fmt(two.total.p95).padStart(6)} ms ${signed(p95).padStart(8)}   ${verdict}`);
}
console.log('');
console.log(`冷启动 before：${(before.coldStart ?? []).map((one) => `${one.label} ${one.ms.join('/')}`).join('；')}`);
console.log(`冷启动 after ：${(after.coldStart ?? []).map((one) => `${one.label} ${one.ms.join('/')}`).join('；')}`);
console.log(`事件循环延迟 p50/p95：before ${fmt(before.loopLagMs?.p50)}/${fmt(before.loopLagMs?.p95)} ms，after ${fmt(after.loopLagMs?.p50)}/${fmt(after.loopLagMs?.p95)} ms`);
if (regressions.length === 0) console.log('\n没有超过阈值的 p95 退化。');
else console.log(`\n超过阈值的项：${regressions.map((one) => one.label).join('、')}（按 §12.3：先加样本确认原因，再决定是否回退）。`);
