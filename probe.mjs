/**
 * Standalone backend probe. Runs the PowerShell worker without DSH so the
 * native layer can be checked (and screenshots inspected) before any plugin
 * wiring exists.
 *
 *   node probe.mjs [--shots <dir>] [--no-input]
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PowerShellBackend } from './backend/bridge.js';

const argv = process.argv.slice(2);
const shotsIndex = argv.indexOf('--shots');
const shotDir = shotsIndex >= 0 ? argv[shotsIndex + 1] : join(tmpdir(), 'dsh-computer-use-probe');
const doInput = !argv.includes('--no-input');
mkdirSync(shotDir, { recursive: true });

const line = (label, value) => console.log(`${label.padEnd(14)} ${value}`);

const backend = new PowerShellBackend({ timeoutMs: 40_000 });
try {
  const t0 = Date.now();
  const info = await backend.start();
  line('startup', `${Date.now() - t0} ms  dpi=${info.dpi} pid=${info.pid} ps=${info.version}`);
  line('virtual', JSON.stringify(info.virtual));
  for (const s of info.screens ?? []) {
    line('screen', `#${s.index} ${s.deviceName} ${s.width}x${s.height} at (${s.x},${s.y})${s.primary ? ' [primary]' : ''}`);
  }

  const t1 = Date.now();
  const ping = await backend.request('ping');
  line('ping', `${Date.now() - t1} ms  cursor=(${ping.cursor.x},${ping.cursor.y})`);

  const shotPath = join(shotDir, 'screen.png');
  const t2 = Date.now();
  const shot = await backend.request('screenshot', { path: shotPath, display: 0 });
  const bytes = statSync(shotPath).size;
  const magic = readFileSync(shotPath).subarray(0, 8).toString('hex');
  const pngOk = magic === '89504e470d0a1a0a';
  line('screenshot', `${Date.now() - t2} ms  ${shot.width}x${shot.height} @(${shot.x},${shot.y})  ${bytes} B  png=${pngOk}`);
  line('foreground', `${shot.foreground.title || '(untitled)'} hwnd=${shot.foreground.hwnd}`);

  const virtualShot = join(shotDir, 'virtual.png');
  const t3 = Date.now();
  const all = await backend.request('screenshot', { path: virtualShot, display: 'all' });
  line('screenshot-all', `${Date.now() - t3} ms  ${all.width}x${all.height}  ${statSync(virtualShot).size} B`);

  const wins = await backend.request('windows', {});
  line('windows', `${wins.windows.length} visible`);
  for (const w of wins.windows.slice(0, 8)) {
    line('', `${w.foreground ? '*' : ' '} [${w.process}] ${w.title.slice(0, 60)}  ${w.width}x${w.height} hwnd=${w.hwnd}`);
  }

  if (doInput) {
    const before = await backend.request('cursor');
    const target = { x: before.x + 12, y: before.y + 12 };
    const t4 = Date.now();
    await backend.request('click', { x: target.x, y: target.y, clicks: 1 });
    const after = await backend.request('cursor');
    line('mouse', `${Date.now() - t4} ms  (${before.x},${before.y}) -> (${after.x},${after.y}) expected (${target.x},${target.y})`);
    if (after.x !== target.x || after.y !== target.y) {
      line('mouse', `MISMATCH: cursor did not land on the requested absolute pixel`);
    }
  }

  const fg = await backend.request('windows', {});
  const active = fg.windows.find((w) => w.foreground);
  if (active !== undefined) {
    const t5 = Date.now();
    try {
      const tree = await backend.request('uitree', { hwnd: active.hwnd, maxDepth: 3, maxNodes: 40 });
      line('uitree', `${Date.now() - t5} ms  ${tree.nodes.length} nodes truncated=${tree.truncated}`);
      for (const n of tree.nodes.slice(0, 10)) {
        line('', `${'  '.repeat(n.depth)}${n.controlType.replace('ControlType.', '')} "${n.name}" ${n.width}x${n.height} [${n.patterns.join(',')}]`);
      }
    } catch (error) {
      line('uitree', `failed: ${error.message}`);
    }
  }

  writeFileSync(join(shotDir, 'last-run.json'), JSON.stringify({ info, shot, all }, null, 2));
  line('shots', shotDir);
} catch (error) {
  console.error('PROBE FAILED:', error.code ?? '', error.message);
  process.exitCode = 1;
} finally {
  backend.dispose();
}
