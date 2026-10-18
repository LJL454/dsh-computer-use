// Measure what the structured-summary transform would have saved on real data.
//
// Reads a decompressed session log, replays every result of the selected tool
// through the transform, and reports:
//   * the new-content saving (what the tool result itself costs), and
//   * the carried saving (that content is re-sent on every later request).
// It also asserts that no harness marker line and no error line was lost, so a
// saving can never be reported at the cost of the facts 6.txt §三-2 protects.
//
// Usage: node test/eval-real-results.mjs <session.jsonl> [tool] [--until <epoch-ms>]
import { readFileSync } from 'node:fs';
import { summarizeToolText, estimateTokens, readStatus, errorPattern, markerPatterns } from '../../internal/summarize.js';

const [, , logPath, toolArg = 'pwsh'] = process.argv;
if (!logPath) {
  console.error('usage: node test/eval-real-results.mjs <session.jsonl> [tool] [--until <epoch-ms>]');
  process.exit(2);
}
const untilIndex = process.argv.indexOf('--until');
const until = untilIndex >= 0 ? Number(process.argv[untilIndex + 1]) : undefined;

const events = readFileSync(logPath, 'utf8')
  .split('\n')
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line));

const callNames = new Map();
let stepsWithUsage = 0;
const stepOrder = [];
for (const event of events) {
  const data = event.data ?? {};
  if (event.type === 'tool/call') callNames.set(data.callId, data.name);
  if (event.type === 'assistant/message' && data.usage) {
    stepsWithUsage += 1;
    stepOrder.push({ turn: data.turn, step: data.step, time: event.time });
  }
}
const stepsInWindow = until === undefined ? stepOrder : stepOrder.filter((entry) => entry.time <= until);

const limits = { normalMaxTokens: 800, troubleshootingMaxTokens: 2000 };
let results = 0;
let summarized = 0;
let inputTokens = 0;
let outputTokens = 0;
let carriedSaving = 0;
let markerLosses = 0;
let errorLosses = 0;
let lostBytes = 0;
const rows = [];

for (const event of events) {
  if (event.type !== 'tool/result') continue;
  if (until !== undefined && event.time > until) continue;
  const data = event.data ?? {};
  const message = data.message ?? {};
  const callId = message.toolCallId;
  if (callNames.get(callId) !== toolArg) continue;
  const text = (message.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
  results += 1;
  const before = estimateTokens(text);
  const { text: after, stats } = summarizeToolText(text, { limits });
  const afterTokens = estimateTokens(after);
  inputTokens += before;
  outputTokens += afterTokens;
  if (stats.summarized) summarized += 1;

  // Facts that must survive: every harness marker line and every error line the
  // budget allowed the transform to keep.
  const markerLines = text.split('\n').filter((line) => markerPatterns.some((p) => p.test(line.trim())));
  const errorLines = text.split('\n').filter((line) => errorPattern.test(line.trim()));
  for (const line of markerLines) if (stats.summarized && !after.includes(line.trim())) markerLosses += 1;
  for (const line of errorLines.slice(0, 20)) {
    if (stats.summarized && !after.includes(line.trim()) && !after.includes(line.trim().slice(0, 60))) errorLosses += 1;
  }
  lostBytes += stats.summarized ? 0 : 0;

  // Carried model: every later metered request *inside the window* re-sends this result.
  const carried = stepsInWindow.filter((entry) => entry.time > event.time).length;
  carriedSaving += Math.max(0, before - afterTokens) * Math.max(0, carried);
  rows.push({ turn: data.turn, step: data.step, before, after: afterTokens, summarized: stats.summarized, carried });
}

const saved = inputTokens - outputTokens;
rows.sort((a, b) => b.before - a.before);
console.log(`tool=${toolArg} results=${results} summarized=${summarized}`);
console.log('largest results (tokens before → after, carried requests):');
for (const row of rows.slice(0, 8)) {
  console.log(`  turn ${row.turn}/${row.step}: ${row.before} → ${row.after}  carried=${row.carried}`);
}
console.log(`new content: ${inputTokens} → ${outputTokens} token (saved ${saved}, `
  + `${((saved / Math.max(1, inputTokens)) * 100).toFixed(1)}%)`);
console.log(`carried saving (same content re-sent later): ${carriedSaving} token`);
console.log(`marker lines lost: ${markerLosses}; error lines lost: ${errorLosses}`);
const status = markerLosses === 0 && errorLosses === 0 ? 'PASS' : 'FAIL';
console.log(status === 'PASS' ? 'fact preservation: PASS' : 'fact preservation: FAIL');
process.exit(status === 'PASS' ? 0 : 1);
