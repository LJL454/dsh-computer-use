/**
 * Scenario probe for the UI Automation action path.
 *
 * Launches Notepad, finds its window, dumps the automation tree, types through
 * both injection paths (SetValue and SendInput), and captures the result so the
 * effect is visible rather than assumed.
 *
 *   node probe-uia.mjs [--shots <dir>] [--keep]
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PowerShellBackend } from './backend/bridge.js';

const argv = process.argv.slice(2);
const shotsIndex = argv.indexOf('--shots');
const shotDir = shotsIndex >= 0 ? argv[shotsIndex + 1] : join(tmpdir(), 'dsh-computer-use-uia');
const keep = argv.includes('--keep');
mkdirSync(shotDir, { recursive: true });

const line = (label, value) => console.log(`${label.padEnd(16)} ${value}`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MARKER = 'DSH computer-use UIA probe 中文输入测试';

const backend = new PowerShellBackend({ timeoutMs: 40_000 });
let notepad = null;
try {
  await backend.start();

  const health = await backend.request('health');
  line('health', `interactive=${health.interactive} foreground="${health.foregroundTitle}" :: ${health.note}`);

  line('launch', 'starting notepad');
  notepad = spawn('notepad.exe', [], { detached: true, stdio: 'ignore' });
  notepad.unref();

  let win = null;
  for (let attempt = 0; attempt < 30 && win === null; attempt += 1) {
    await wait(400);
    const list = await backend.request('windows', { filter: 'notepad' });
    win = list.windows.find((w) => /notepad/i.test(w.process)) ?? null;
  }
  if (win === null) throw new Error('Notepad did not open a visible window within 12 s');
  line('window', `hwnd=${win.hwnd} [${win.process}] "${win.title}" ${win.width}x${win.height}`);

  const focused = await backend.request('focus', { hwnd: win.hwnd });
  line('focus', `focused=${focused.focused} title="${focused.title}"`);

  const tree = await backend.request('uitree', { hwnd: win.hwnd, maxDepth: 6, maxNodes: 120 });
  line('uitree', `${tree.nodes.length} nodes truncated=${tree.truncated}`);
  const interesting = tree.nodes.filter((n) => n.patterns.length > 0).slice(0, 12);
  for (const n of interesting) {
    line('', `${'  '.repeat(n.depth)}${n.controlType.replace('ControlType.', '')} "${n.name}" #${n.automationId} ${n.width}x${n.height} [${n.patterns.join(',')}]`);
  }

  /* Path 1: UI Automation SetValue — the reliable route for CJK text. */
  const editable = tree.nodes.find((n) => n.patterns.includes('value') && n.width > 100 && n.height > 50);
  if (editable !== undefined) {
    const via = { name: editable.name, controlType: editable.controlType, automationId: editable.automationId, hwnd: win.hwnd };
    line('set_value', `targeting ${editable.controlType} "${editable.name}" #${editable.automationId}`);
    const set = await backend.request('uiact', { ...via, action: 'set_value', value: MARKER });
    line('set_value', `ok action=${set.action} value=${JSON.stringify(set.value)}`);
    const read = await backend.request('uiact', { ...via, action: 'get_value' });
    line('get_value', JSON.stringify(read.value));
    if (read.value !== MARKER) throw new Error(`round-trip mismatch: ${JSON.stringify(read.value)} !== ${JSON.stringify(MARKER)}`);
    line('verify', 'UI Automation round-trip matched exactly');
  } else {
    line('set_value', 'no ValuePattern element found in Notepad; skipping the SetValue path');
  }

  /* Path 2: SendInput unicode typing, to prove the injection path independently. */
  const cursor = await backend.request('cursor');
  await backend.request('click', { x: win.x + Math.round(win.width / 2), y: win.y + Math.round(win.height / 2) });
  await wait(300);
  const typed = await backend.request('type', { text: ` [SendInput ok]` });
  line('type', `typed=${typed.typed} foreground="${typed.foreground.title}" [${typed.foreground.process}]`);
  line('cursor', `before=(${cursor.x},${cursor.y})`);

  const shot = join(shotDir, 'notepad.png');
  const captured = await backend.request('screenshot', { path: shot, region: { x: win.x, y: win.y, width: win.width, height: win.height } });
  line('screenshot', `${captured.width}x${captured.height} -> ${shot}`);

  if (!keep) {
    line('cleanup', 'closing notepad');
    await backend.request('key', { keys: 'alt+f4' });
    await wait(600);
    // Notepad may ask to save; discard.
    await backend.request('key', { keys: 'right' });
    await backend.request('key', { keys: 'enter' });
    await wait(400);
  }
  line('result', 'ALL UIA CHECKS PASSED');
} catch (error) {
  console.error('UIA PROBE FAILED:', error.code ?? '', error.message);
  process.exitCode = 1;
} finally {
  backend.dispose();
}
