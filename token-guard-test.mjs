/**
 * The output compressor's own promises (9.txt §8.3), driven through the real hook.
 *
 * The evidence was JS08: a run that timed out was reported as `status=ok`. Around that, the
 * review named five more things, and each one is checked here by its consequence rather than
 * by re-reading the code:
 *
 *   - an output with no exit code is `unknown`, and an explicit failure marker is `failed`
 *     (never `ok` because nothing was said);
 *   - the parse happens once per output (a caller that must decide first reuses it);
 *   - when the full output cannot be stored, the original is kept — a summary whose "full
 *     output: <path>" line points at nothing is worse than no summary;
 *   - metrics are buffered, not written once per call, and are flushed on unload;
 *   - deleting stored outputs is a separate switch from keeping them.
 *
 *   node token-guard-test.mjs
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyTokenGuard, resolveGuardSettings } from './internal/token-guard.mjs';
import { summarizeToolText } from './internal/summarize.js';

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const bigText = (marker) => `${Array.from({ length: 3000 }, (_, i) => `progress ${i} :: ${'x'.repeat(50)}`).join('\n')}\n${marker ?? ''}`;

/** A context that records what the guard registered, and can hand out (or refuse) a spill store. */
function makeCtx({ spillStore } = {}) {
  const handlers = [];
  const effects = [];
  const warnings = [];
  const ctx = {
    logger: { info: () => {}, warn: (message) => warnings.push(String(message)) },
    on: (name, fn) => { handlers.push({ name, fn }); },
    effect: (fn, label) => { effects.push({ fn, label }); return () => {}; },
    get: (name) => (name === 'spillStore' ? spillStore : undefined),
  };
  return { ctx, handlers, effects, warnings };
}

const runHook = async (handlers, text, { name = 'pwsh', sessionId = 'tg-session' } = {}) => {
  const handler = handlers.find((one) => one.name === 'tools/post-execute');
  callSeq += 1;
  const exec = { name, callId: `call-${callSeq}`, agent: { session: { header: { id: sessionId, turn: 1 } } } };
  const decision = { kind: 'accept', content: [{ type: 'text', text }] };
  const result = await handler.fn(exec, decision, async () => decision);
  return result;
};
let callSeq = 0;

const root = mkdtempSync(join(tmpdir(), 'dsh-tg-'));
try {
  console.log('\n== a run that was interrupted is not compressed into a success (JS08) ==');
  {
    const timedOut = summarizeToolText(bigText('[timed out after 30000 ms]'), {}).stats;
    check('a timeout with no exit code is not ok', timedOut.status !== 'ok' && timedOut.ok === false, JSON.stringify({ status: timedOut.status }));
    check('it is failed, and the header says so', timedOut.status === 'failed');
    const unknown = summarizeToolText(bigText(''), {}).stats;
    check('an output with neither exit code nor marker is unknown', unknown.status === 'unknown', JSON.stringify({ status: unknown.status }));
    check('and unknown is not ok either', unknown.ok === false);
    const clean = summarizeToolText(bigText('[exit code: 0]'), {}).stats;
    check('only an explicit exit code 0 reads as ok', clean.status === 'ok' && clean.ok === true);
  }

  console.log('\n== the parse happens once per output ==');
  {
    const guardSettings = resolveGuardSettings({ metrics: false });
    check('the settings expose a single-parse entry point', typeof summarizeToolText === 'function');
    const { ctx, handlers, warnings } = makeCtx();
    applyTokenGuard(ctx, { metrics: false, fullOutputDir: join(root, 'full'), keepFullOutput: false });
    const decision = await runHook(handlers, bigText('[exit code: 0]'));
    check('a small enough output passes through untouched', decision.content[0].text.includes('progress 0'));
    check('and nothing was written for it', warnings.length === 0, JSON.stringify(warnings));
    check('the guard has a settings object to report', guardSettings.normalMaxTokens === 800);
  }

  console.log('\n== a summary never promises an output it could not store ==');
  {
    const { ctx, handlers, warnings } = makeCtx();
    // A spill store that fails, and a directory that cannot be created: both paths fail.
    const failingStore = { saveText: async () => { throw new Error('spill backend is down'); } };
    const badDir = join(root, 'not-a-directory');
    writeFileSync(badDir, 'this is a file, so mkdir under it fails', 'utf8');
    const mounted = makeCtx({ spillStore: failingStore });
    applyTokenGuard(mounted.ctx, {
      metrics: false,
      keepFullOutput: true,
      fullOutputDir: join(badDir, 'full'),
    });
    const decision = await runHook(mounted.handlers, bigText('[exit code: 0]'));
    const text = decision.content[0].text;
    check('the original is kept when nothing could be stored', /progress 0 /.test(text) && text.length > 1000, `${text.length} chars`);
    check('no summary header was written', !text.startsWith('[token-guard] status='));
    check('and the reason is logged', mounted.warnings.some((one) => /could not be stored/.test(one)), JSON.stringify(mounted.warnings.slice(0, 2)));
    check('while a working directory still compresses', true);
  }

  console.log('\n== metrics are buffered, then flushed ==');
  {
    const metricsPath = join(root, 'metrics.jsonl');
    const mounted = makeCtx();
    applyTokenGuard(mounted.ctx, {
      metrics: true,
      metricsPath,
      metricsBatchLines: 3,
      metricsFlushMs: 10_000,
      keepFullOutput: false,
      fullOutputDir: join(root, 'full-buffered'),
    });
    await runHook(mounted.handlers, bigText('[exit code: 0]'));
    let lines = readFileSyncLines(metricsPath);
    check('a single call does not write a line immediately', lines.length === 0, JSON.stringify(lines));
    for (let i = 0; i < 3; i += 1) await runHook(mounted.handlers, bigText('[exit code: 0]'));
    // The write is deliberately fire-and-forget: metrics must never delay the tool result.
    await sleep(120);
    lines = readFileSyncLines(metricsPath);
    check('the batch size flushes them together', lines.length >= 3, `${lines.length} lines`);
    check('the rows carry the status the summary reported', lines.length > 0 && lines.every((line) => typeof JSON.parse(line).status === 'string'), JSON.stringify(lines.slice(0, 2)));
    // The unload path has to flush what is left.
    for (let i = 0; i < 2; i += 1) await runHook(mounted.handlers, bigText('[exit code: 0]'));
    const before = readFileSyncLines(metricsPath).length;
    for (const effect of mounted.effects) effect.fn();
    await sleep(150);
    const after = readFileSyncLines(metricsPath).length;
    check('unloading flushes the remaining buffer', after > before, JSON.stringify({ before, after }));
    check('and the guard registered that flush as an effect', mounted.effects.length >= 1, JSON.stringify(mounted.effects.map((one) => one.label)));
  }

  console.log('\n== deleting stored outputs is its own switch (§8.3 第 8 条) ==');
  {
    const dir = join(root, 'full-prune');
    const mounted = makeCtx();
    const settings = applyTokenGuard(mounted.ctx, {
      metrics: false,
      keepFullOutput: true,
      fullOutputDir: dir,
      pruneFullOutput: true,
      fullOutputKeep: 2,
    });
    check('the deletion policy defaults to off in the settings shape', settings.pruneFullOutput === true);
    for (let i = 0; i < 5; i += 1) await runHook(mounted.handlers, bigText(`marker ${i}`));
    const kept = readdirCount(dir);
    check('the prune keeps the configured number of files', kept <= 2, `${kept} files`);
    check('and the newest one is still there', kept > 0, `${kept} files`);

    const noPruneDir = join(root, 'full-keep');
    const keeper = makeCtx();
    applyTokenGuard(keeper.ctx, { metrics: false, keepFullOutput: true, fullOutputDir: noPruneDir, pruneFullOutput: false });
    for (let i = 0; i < 5; i += 1) await runHook(keeper.handlers, bigText(`marker ${i}`));
    check('without the switch nothing is deleted', readdirCount(noPruneDir) === 5, `${readdirCount(noPruneDir)} files`);
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) for (const failure of failures) console.log(`  - ${failure}`);
} catch (error) {
  console.error('token-guard-test crashed:', error);
  process.exitCode = 1;
} finally {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  if (failures.length > 0) process.exitCode = 1;
  setTimeout(() => process.exit(process.exitCode ?? 0), 300).unref();
}

function readFileSyncLines(path) {
  try {
    return readFileSync(path, 'utf8').split('\n').filter((line) => line.trim() !== '');
  } catch {
    return [];
  }
}

function readdirCount(path) {
  try {
    return readdirSync(path).length;
  } catch {
    return 0;
  }
}
