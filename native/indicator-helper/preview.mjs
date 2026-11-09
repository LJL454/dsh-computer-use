/**
 * 手工预览 helper 的覆盖层（开发用，不随插件发布）。
 *
 *   node native/indicator-helper/preview.mjs --seconds=8
 *
 * 它做的事和插件将来做的完全一样：`hello` → `beginScope` → 保持活动 → `endScope` → `shutdown`。
 * 覆盖层期间用模型截图看一眼：默认会被 `WDA_EXCLUDEFROMCAPTURE` 排除（这正是要的），
 * 想看像素就用 `native/indicator-probe --no-affinity`。
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXE = join(HERE, 'build', 'dsh-interaction-indicator.exe');
const seconds = Number((process.argv.find((one) => one.startsWith('--seconds=')) ?? '--seconds=8').split('=')[1]) || 8;

// --no-affinity：诊断用，让覆盖层出现在模型截图里（正常启动不会这样）。
const passThrough = process.argv.includes('--no-affinity') ? ['--no-affinity'] : [];
const assets = join(HERE, '..', '..', 'assets', 'character');
passThrough.push(`--assets=${assets}`);
const child = spawn(EXE, passThrough, { stdio: ['pipe', 'pipe', 'inherit'] });
const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => process.stdout.write(chunk));

send({ requestId: 'p1', method: 'hello', protocolVersion: 1 });
setTimeout(() => send({ requestId: 'p0', method: 'setVisualPreferences', settingsRevision: 1, preferences: { bannerCharacter: true, cursorCharacter: true } }), 120);
setTimeout(() => send({ requestId: 'p2', method: 'beginScope', scopeId: 'preview', epoch: 1 }), 200);
setTimeout(() => send({ requestId: 'p3', method: 'updateState', seq: 1, active: true }), 500);
setTimeout(() => {
  send({ requestId: 'p4', method: 'endScope', scopeId: 'preview' });
  setTimeout(() => send({ requestId: 'p5', method: 'shutdown' }), 300);
}, seconds * 1000);
child.once('exit', (code) => process.exit(code ?? 0));
