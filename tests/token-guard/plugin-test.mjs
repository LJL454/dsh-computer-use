// End-to-end test for the guard's wiring: mount applyTokenGuard() against a stub context,
// push one oversized and one small result through the registered listener, and
// assert the summary, the full-output copy and the metrics line.
//
// 合并后本文件位于 dsh-computer-use/tests/token-guard/，被测对象是 internal/token-guard.mjs。
//
// Usage: node tests/token-guard/plugin-test.mjs
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyTokenGuard as apply, tokenGuardDefaults as defaults } from '../../internal/token-guard.mjs';

let failures = 0;
let checks = 0;
function check(name, condition, detail = '') {
  checks += 1;
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** A context with just enough surface for the plugin: on()/get()/logger. */
function stubContext({ spillStore } = {}) {
  const listeners = new Map();
  return {
    listeners,
    logger: { warn: (message) => console.log(`  [warn] ${message}`), info: () => {} },
    on(event, handler) {
      listeners.set(event, handler);
    },
    get(name) {
      return name === 'spillStore' ? spillStore : undefined;
    },
  };
}

const workdir = await mkdtemp(join(tmpdir(), 'token-guard-test-'));
const fullOutputDir = join(workdir, 'full');
const metricsPath = join(workdir, 'metrics.jsonl');

/**
 * Read a file the plugin writes *after* it has answered.
 *
 * Metrics are batched on purpose: `createMetricBuffer` flushes once the buffer reaches
 * `metricsBatchLines`, and otherwise arms an `unref`'d timer for `metricsFlushMs`. So the file
 * appears some time after the tool result comes back, and reading it straight away is a race the
 * test can only lose — the first version of this file read it immediately and died with ENOENT
 * while every assertion about the summary itself passed. Waiting for the write is the honest
 * shape; shortening the interval only makes the race less likely.
 * @param path - the file to wait for.
 * @param timeoutMs - how long to keep looking before giving up.
 * @returns its contents.
 */
async function waitForFile(path, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT' || Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

console.log('mounting the plugin');
const ctx = stubContext();
// `metricsFlushMs: 0` keeps the wait short. The batching stays enabled — it is part of what this
// test is about.
apply(ctx, { fullOutputDir, metricsPath, normalMaxTokens: 800, troubleshootingMaxTokens: 2000, metricsFlushMs: 0 });
check('registers tools/post-execute', typeof ctx.listeners.get('tools/post-execute') === 'function');

const handler = ctx.listeners.get('tools/post-execute');
const exec = {
  name: 'pwsh',
  callId: 'call-1',
  agent: { session: { header: { id: 'session-test' } } },
};

/** Run one result through the listener with an accept-everything `next`. */
async function run(text, { tool = 'pwsh', images = [] } = {}) {
  const content = [{ type: 'text', text }, ...images];
  const decision = await handler(
    { ...exec, name: tool },
    { content },
    async () => ({ kind: 'accept', content }),
  );
  return decision;
}

console.log('\noversized failure result');
{
  const lines = [];
  for (let i = 0; i < 3000; i += 1) lines.push(`progress ${i} ${'p'.repeat(50)}`);
  lines[1500] = 'Error: cannot open file C:\\logs\\app.log';
  lines.push('[exit code: 1]');
  const raw = lines.join('\n');
  const decision = await run(raw);
  const text = decision.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  check('content was replaced', text !== raw);
  check('summary header present', text.startsWith('[token-guard] status=failed'));
  check('exit code surfaced in the summary', text.includes('exit=1'));
  check('mid-file error kept', text.includes('Error: cannot open file C:\\logs\\app.log'));
  check('harness marker kept', text.includes('[exit code: 1]'));
  check('full-output locator named', /完整输出: .+call-1\.txt/.test(text));
  check('summary is small', text.length < 800 * 4, `${text.length} chars`);

  const fullPath = join(fullOutputDir, 'session-test-call-1.txt');
  const stored = await readFile(fullPath, 'utf8');
  check('complete output written verbatim', stored === raw);

  const metrics = (await waitForFile(metricsPath)).trim().split('\n').map((l) => JSON.parse(l));
  check('one metrics line recorded', metrics.length === 1, `${metrics.length}`);
  check('metrics carry the budget and the locator',
    metrics[0].budgetTokens === 2000 && metrics[0].fullOutput === fullPath,
    JSON.stringify(metrics[0]));
  check('metrics carry the exit status', metrics[0].exitCode === 1 && metrics[0].ok === false);
}

console.log('\nsmall result and non-target tool');
{
  const small = 'done\n[exit code: 0]\n';
  const decision = await run(small);
  check('small result untouched', decision.content[0].text === small);

  const other = await run('x'.repeat(9000), { tool: 'read' });
  check('non-target tool untouched', other.content[0].text.length === 9000);

  const withImage = await run('y'.repeat(9000), { images: [{ type: 'image', attachment: { attachmentId: 'sha256:x' } }] });
  check('image-bearing result untouched', withImage.content.some((b) => b.type === 'image'));
  check('image-bearing payload not summarized', withImage.content.find((b) => b.type === 'text').text.length === 9000);
}

console.log('\nspill store path');
{
  const saved = [];
  const spillCtx = stubContext({
    spillStore: {
      async saveText(request) {
        saved.push(request);
        return { locator: 'C:\\spill\\pwsh.txt', bytes: request.content.length, retrievalHint: 'read 该路径' };
      },
    },
  });
  apply(spillCtx, { fullOutputDir, metricsPath: join(workdir, 'metrics2.jsonl'), metrics: false });
  const spillHandler = spillCtx.listeners.get('tools/post-execute');
  const big = Array.from({ length: 2000 }, (_, i) => `line ${i} ${'q'.repeat(40)}`).join('\n');
  const decision = await spillHandler(exec, { content: [{ type: 'text', text: big }] },
    async () => ({ kind: 'accept', content: [{ type: 'text', text: big }] }));
  check('spill store used when mounted', saved.length === 1);
  check('spill locator appears in the summary',
    decision.content[0].text.includes('C:\\spill\\pwsh.txt'));
  check('spill request carries the session owner',
    saved[0]?.owner?.sessionId === 'session-test');
}

console.log('\ndisabled switch');
{
  const off = stubContext();
  apply(off, { enabled: false });
  check('disabled plugin registers nothing', off.listeners.size === 0);
  check('defaults expose the documented budgets',
    defaults.normalMaxTokens === 800 && defaults.troubleshootingMaxTokens === 2000);
}

await rm(workdir, { recursive: true, force: true });
console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
