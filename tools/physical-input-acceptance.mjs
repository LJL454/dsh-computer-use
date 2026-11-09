/**
 * 人工物理输入的钩子验收（复核结论第 3 条的"人工输入"那一半）。
 *
 * 合成事件只能证明"注入事件经过真实钩子链路"；**物理输入**必须由人真的动鼠标。
 * 这个脚本把这件事变成一条可复现的流程：它自己起 helper、开一个 scope、打印指引，
 * 等人按回车后读取 health 的增量，并把结果写成 JSON 证据。
 *
 *   node tools/physical-input-acceptance.mjs --label build
 *   node tools/physical-input-acceptance.mjs --label installed --exe "C:\\Users\\…\\plugins\\dsh-computer-use\\native\\indicator-helper\\build\\dsh-interaction-indicator.exe"
 *
 * 判据：本轮至少 10 个移动事件、至少 3 次点击、`mouseHookCalls` 有增长；
 * 另外记录 `pressToPresentMs`（按下到出画的延迟）作为体验证据。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const argOf = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
};
const EXE = argOf('exe', join(ROOT, 'native', 'indicator-helper', 'build', 'dsh-interaction-indicator.exe'));
const ASSETS = argOf('assets', join(ROOT, 'assets', 'character'));
const LABEL = argOf('label', 'unlabelled');
const OUT = argOf('out', join(ROOT, 'dist', `physical-input-${LABEL}.json`));

if (!existsSync(EXE) || !existsSync(join(ASSETS, 'pack.json'))) {
  console.error(`FAIL  need ${EXE} and ${ASSETS}`);
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const child = spawn(EXE, [`--assets=${ASSETS}`, '--no-affinity'], { stdio: ['pipe', 'pipe', 'pipe'] });
const events = [];
let carry = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  carry += chunk;
  let index;
  while ((index = carry.indexOf('\n')) >= 0) {
    const line = carry.slice(0, index).trim();
    carry = carry.slice(index + 1);
    if (line === '') continue;
    try { events.push(JSON.parse(line)); } catch { /* ignore */ }
  }
});
let request = 0;
const send = (message) => {
  const requestId = `p${request += 1}`;
  child.stdin.write(`${JSON.stringify({ requestId, ...message })}\n`);
  return requestId;
};
const waitFor = async (name, predicate = () => true, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const index = events.findIndex((one) => one.event === name && predicate(one));
    if (index >= 0) return events.splice(index, 1)[0];
    await sleep(20);
  }
  return null;
};
const health = async () => {
  const requestId = send({ method: 'health' });
  return waitFor('health', (one) => one.requestId === requestId, 6000);
};

const ask = (question) => new Promise((resolve) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question(question, (answer) => { rl.close(); resolve(answer); });
});

try {
  send({ method: 'hello', protocolVersion: 2 });
  const ready = await waitFor('ready', () => true, 10000);
  if (ready === null) {
    console.error('FAIL  the helper never sent ready');
    process.exit(1);
  }
  send({ method: 'setCompanionPreferences', enabled: true, hostInstanceId: `physical-${LABEL}`, settingsRevision: 1, helperGeneration: 1 });
  await waitFor('companionApplied');
  send({ method: 'beginScope', scopeId: `physical-${LABEL}`, epoch: 1 });
  await waitFor('scopeReady', () => true, 10000);
  await sleep(800);

  const before = await health();
  console.log(`\n物理输入验收（${LABEL}）`);
  console.log(`  帮助进程：${EXE}`);
  console.log(`  基线：events=${before?.pointerEventsSeen} clicks=${before?.pointerClicks} hookCalls=${before?.mouseHookCalls}\n`);
  console.log('  请在**真实鼠标**上做下面三件事，然后回到这个窗口按回车：');
  console.log('    1) 慢慢移动鼠标 10 次以上（幅度大一些）');
  console.log('    2) 在任意空白处点击 3 次');
  console.log('    3) 不要把鼠标移出屏幕边缘\n');
  await ask('  完成后按回车继续… ');

  const after = await health();
  const delta = {
    events: Number(after?.pointerEventsSeen ?? 0) - Number(before?.pointerEventsSeen ?? 0),
    clicks: Number(after?.pointerClicks ?? 0) - Number(before?.pointerClicks ?? 0),
    taps: Number(after?.pointerTaps ?? 0) - Number(before?.pointerTaps ?? 0),
    hookCalls: Number(after?.mouseHookCalls ?? 0) - Number(before?.mouseHookCalls ?? 0),
    presents: Number(after?.cursorPresents ?? 0) - Number(before?.cursorPresents ?? 0),
  };
  const verdict = delta.events >= 10 && delta.clicks >= 3 && delta.hookCalls > 0 ? 'pass' : 'fail';
  const evidence = {
    at: new Date().toISOString(),
    label: LABEL,
    exe: EXE,
    assets: ASSETS,
    helperBuild: ready.buildVersion,
    baseline: before,
    delta,
    pressToPresentMs: after?.pressToPresentMs ?? null,
    hookReady: after?.mouseHookReady ?? null,
    cursorSurface: after?.cursorSurface ?? null,
    verdict,
    rule: 'events >= 10, clicks >= 3, mouseHookCalls grew',
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(evidence, null, 2), 'utf8');

  console.log(`\n  移动 ${delta.events}　点击 ${delta.clicks}　钩子回调 ${delta.hookCalls}　Present ${delta.presents}`);
  console.log(`  按下→Present：${evidence.pressToPresentMs} ms`);
  console.log(`  ${verdict === 'pass' ? 'PASS' : 'FAIL'}  证据：${OUT}\n`);

  send({ method: 'endScope' });
  await waitFor('scopeEnded', () => true, 5000);
  send({ method: 'setCompanionPreferences', enabled: false, hostInstanceId: `physical-${LABEL}`, settingsRevision: 2, helperGeneration: 1 });
  await waitFor('companionApplied', () => true, 5000);
  send({ method: 'shutdown' });
  await waitFor('closed', () => true, 5000);
  process.exit(verdict === 'pass' ? 0 : 1);
} catch (error) {
  console.error(`FAIL  ${String(error?.message ?? error)}`);
  process.exit(1);
} finally {
  setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 300);
}
