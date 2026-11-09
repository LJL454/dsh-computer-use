/**
 * 热态基线：方案 4.9 要求"先记录至少 30 次热态样本用于初步分布"。
 *
 * 冷启动与热态必须分开报 —— 冷启动含 `Add-Type` 编译（约 1.3 秒），把它混进"一次调用的耗时"里
 * 会让数字毫无意义。所以这里：
 *
 *   * 只计**同一个常驻 worker** 上的连续请求；
 *   * 至少 30 个样本，报 min / P50 / P95 / max；
 *   * 每个样本都带 requestId 与命令名，失败单独计数，不混进分布。
 *
 *   node tools/measure-baseline.mjs [--samples 30] [--cmd ping]
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const args = process.argv.slice(2);
const value = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};
const SAMPLES = Math.max(10, Number(value('--samples', '30')) || 30);
const COMMAND = value('--cmd', 'ping');
const WORKER = value('--worker', join(ROOT, 'backend', 'worker.ps1'));

const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', WORKER], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

const pending = new Map();
let buffer = '';
let nextId = 1;
let readyAt = null;
const startedAt = Date.now();

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line === '') continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.ready === true) { readyAt = Date.now(); continue; }
    const waiter = pending.get(message.id);
    if (waiter !== undefined) {
      pending.delete(message.id);
      waiter(message);
    }
  }
});

const waitForReady = () => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('the worker never became ready')), 60_000);
  const poll = setInterval(() => {
    if (readyAt !== null) { clearInterval(poll); clearTimeout(timer); resolve(); }
  }, 20);
});

/** 发一条请求并量它的往返时间。 */
function request(command) {
  const id = nextId;
  nextId += 1;
  const sentAt = process.hrtime.bigint();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`request ${id} (${command}) timed out`)); }, 30_000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      const ms = Number(process.hrtime.bigint() - sentAt) / 1e6;
      resolve({ id, ok: message.ok === true, ms, error: message.error ?? '' });
    });
    child.stdin.write(`${JSON.stringify({ id, cmd: command, args: {} })}\n`);
  });
}

await waitForReady();
const coldStartMs = readyAt - startedAt;
console.log(`worker ready in ${coldStartMs} ms (cold start, includes the Add-Type compile)`);

// 一个热身样本：第一个请求往往还要碰 COM/UIA 的惰性初始化，单独丢掉。
await request(COMMAND).catch(() => {});

const results = [];
const failures = [];
for (let index = 0; index < SAMPLES; index += 1) {
  try {
    const result = await request(COMMAND);
    if (result.ok) results.push(result); else failures.push(result);
  } catch (error) {
    failures.push({ id: -1, ms: 0, error: String(error?.message ?? error) });
  }
}
try { child.stdin.write(`${JSON.stringify({ id: 0, cmd: 'shutdown', args: {} })}\n`); } catch { /* ignore */ }
setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 300);

const sorted = results.map((one) => one.ms).sort((a, b) => a - b);
const at = (fraction) => (sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]);
const round = (value) => (value === null ? null : Math.round(value * 10) / 10);

console.log(`\ncommand "${COMMAND}" · ${results.length} warm sample(s) · ${failures.length} failure(s)`);
if (sorted.length > 0) {
  console.log(`min ${round(sorted[0])} ms · P50 ${round(at(0.5))} ms · P95 ${round(at(0.95))} ms · max ${round(sorted[sorted.length - 1])} ms`);
  const samples = results.map((one) => `${one.id}:${round(one.ms)}`).join(' ');
  console.log(`samples :: ${samples}`);
}
if (failures.length > 0) {
  console.log(`failures :: ${JSON.stringify(failures.slice(0, 5))}`);
  process.exitCode = 1;
}
console.log(`\n冷启动 ${coldStartMs} ms（每次宿主会话一次）；热态 P95 ${round(at(0.95))} ms（每次调用）`);
