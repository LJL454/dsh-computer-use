/**
 * PR15 的证据：**要不要现在把 PowerShell 里的 C# 编译部分改成预编译组件**。
 *
 * 方案把 PR15 定为条件项：只有当出现"已确认的性能热点"或"已确认的部署兼容性问题"才做局部预编译。
 * 这份脚本量的是决策真正需要的那两个数：
 *
 *   1. 常驻 worker **启动一次**要多久（含 `Add-Type` 编译 P/Invoke/UIA 那一段）；
 *   2. 启动之后**一次请求**要多久（这是用户真正感知的延迟）。
 *
 * 如果启动成本只付一次、单次请求又远低于感知阈值，那"重写编译组件"就没有证据支持 —— 该记结论，
 * 不该为了架构好看去动它。
 *
 *   node tools/measure-worker-start.mjs [--runs 3]
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args0 = process.argv.slice(2);
const workerIndex = args0.indexOf('--worker');
const WORKER = workerIndex >= 0 && args0[workerIndex + 1] !== undefined
  ? args0[workerIndex + 1]
  : join(HERE, '..', 'backend', 'worker.ps1');
const args = process.argv.slice(2);
const runsIndex = args.indexOf('--runs');
const RUNS = runsIndex >= 0 ? Math.max(1, Number(args[runsIndex + 1]) || 3) : 3;

/**
 * 起一次 worker，量"到 ready"和"一次 ping"的时间。
 * @returns `{ startupMs, pingMs, ready }`
 */
function measureOnce() {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', WORKER], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let buffer = '';
    let startupMs = null;
    let pingSentAt = null;
    let readySeen = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* already gone */ }
      resolve(result);
    };
    const timer = setTimeout(() => finish({ startupMs, pingMs: null, ready: readySeen, error: 'timeout' }), 60_000);

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
        if (message.ready === true && startupMs === null) {
          startupMs = Date.now() - started;
          readySeen = true;
          pingSentAt = Date.now();
          child.stdin.write(`${JSON.stringify({ id: 1, cmd: 'ping', args: {} })}\n`);
          continue;
        }
        if (message.id === 1) {
          clearTimeout(timer);
          finish({ startupMs, pingMs: pingSentAt === null ? null : Date.now() - pingSentAt, ready: true, error: '' });
          return;
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', () => { /* startup noise is not the measurement */ });
    child.on('error', (error) => finish({ startupMs, pingMs: null, ready: false, error: String(error?.message ?? error) }));
  });
}

const results = [];
for (let run = 0; run < RUNS; run += 1) {
  const result = await measureOnce();
  results.push(result);
  console.log(`run ${run + 1}: startup ${result.startupMs ?? 'n/a'} ms, ping ${result.pingMs ?? 'n/a'} ms${result.error === '' ? '' : ` (${result.error})`}`);
}

const ready = results.filter((one) => one.ready === true && Number.isFinite(one.startupMs));
const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
};
const startup = median(ready.map((one) => one.startupMs));
const ping = median(ready.filter((one) => Number.isFinite(one.pingMs)).map((one) => one.pingMs));
console.log(`\nready ${ready.length}/${RUNS}；startup 中位数 ${startup ?? 'n/a'} ms；ping 中位数 ${ping ?? 'n/a'} ms`);
if (startup === null) {
  console.log('FAIL  the worker never became ready; no conclusion can be drawn from this run');
  process.exit(1);
}
console.log(startup <= 5000 && (ping ?? 0) <= 500
  ? 'VERDICT  PR15 不成立：启动成本付一次、单次请求远低于感知阈值，没有"已确认的性能热点"支撑重写编译组件'
  : 'VERDICT  PR15 需要复核：启动或单次请求已超出预期，先查原因再谈预编译');
process.exit(0);
