/**
 * Diagnostic probe for the UI Automation path.
 *
 * The first scenario run exposed three things worth pinning down before the
 * plugin ships:
 *   1. `uitree` returned a single node for Windows 11 Notepad (a WinUI 3 app);
 *   2. `focus` reported a title that did not match the listed window;
 *   3. a click at the window centre left the desktop focused, so SendInput text
 *      went nowhere.
 *
 * This script answers all three by checking the foreground window handle rather
 * than trusting a title, retrying the tree dump until the app has actually
 * rendered, and running the same sequence against a classic Win32 dialog
 * (`charmap.exe`) as a control.
 *
 *   node diag-uia.mjs [--shots <dir>]
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PowerShellBackend } from './backend/bridge.js';

const argv = process.argv.slice(2);
const shotsIndex = argv.indexOf('--shots');
const shotDir = shotsIndex >= 0 ? argv[shotsIndex + 1] : join(tmpdir(), 'dsh-computer-use-diag');
mkdirSync(shotDir, { recursive: true });

const line = (label, value) => console.log(`${String(label).padEnd(18)} ${value}`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const backend = new PowerShellBackend({ timeoutMs: 60_000 });

/** Launch a program and wait for a new visible window owned by it. */
async function launchAndFind(command, processNeedle, knownHwnds) {
  const before = new Set((await backend.request('windows', {})).windows.map((w) => w.hwnd));
  for (const hwnd of knownHwnds ?? []) before.add(hwnd);
  const child = spawn(command, [], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await wait(500);
    const { windows } = await backend.request('windows', {});
    const fresh = windows.find((w) => !before.has(w.hwnd) && new RegExp(processNeedle, 'i').test(w.process));
    if (fresh !== undefined) return fresh;
  }
  return null;
}

/** Focus a window and confirm the foreground handle really is that window. */
async function focusVerified(hwnd) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await backend.request('focus', { hwnd });
    await wait(250);
    const health = await backend.request('health');
    if (health.foregroundHwnd === hwnd) return health;
  }
  return await backend.request('health');
}

/** Dump the tree, retrying while the app is still painting. */
async function dumpTree(hwnd, { maxDepth = 6, maxNodes = 200, tries = 6 } = {}) {
  let last = null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    last = await backend.request('uitree', { hwnd, maxDepth, maxNodes });
    if (last.nodes.length > 1) return last;
    await wait(800);
  }
  return last;
}

async function scenario(label, command, processNeedle) {
  console.log(`\n===== ${label} =====`);
  const win = await launchAndFind(command, processNeedle);
  if (win === null) {
    line('launch', `FAILED: no new ${processNeedle} window appeared`);
    return;
  }
  line('window', `hwnd=${win.hwnd} [${win.process}] "${win.title}" ${win.width}x${win.height} at (${win.x},${win.y})`);

  const health = await focusVerified(win.hwnd);
  line('foreground', `hwnd=${health.foregroundHwnd} "${health.foregroundTitle}" match=${health.foregroundHwnd === win.hwnd}`);
  if (health.foregroundHwnd !== win.hwnd) {
    line('focus', 'WARNING: could not make this window the foreground window');
  }

  const tree = await dumpTree(win.hwnd);
  line('uitree', `${tree.nodes.length} nodes truncated=${tree.truncated}`);
  for (const n of tree.nodes.slice(0, 18)) {
    const type = n.controlType.replace('ControlType.', '');
    const pat = n.patterns.length > 0 ? ` [${n.patterns.join(',')}]` : '';
    line('', `${'  '.repeat(n.depth)}${type} "${n.name}" #${n.automationId}${pat}`);
  }

  const edit = tree.nodes.find((n) => n.patterns.includes('value') && n.width > 60 && n.height > 16);
  if (edit !== undefined) {
    const selector = { hwnd: win.hwnd, action: 'set_value', value: 'DSH-UIA-中文-42' };
    if (edit.automationId) selector.automationId = edit.automationId;
    else if (edit.name) selector.name = edit.name;
    else selector.controlType = edit.controlType;
    line('set_value', `target ${edit.controlType} "${edit.name}" #${edit.automationId} via ${JSON.stringify({ ...selector, hwnd: undefined, action: undefined, value: undefined })}`);
    try {
      await backend.request('uiact', selector, { timeoutMs: 15_000 });
      const read = await backend.request('uiact', { ...selector, action: 'get_value' }, { timeoutMs: 15_000 });
      const ok = read.value === 'DSH-UIA-中文-42';
      line('set_value', `readback=${JSON.stringify(read.value)} match=${ok}`);
    } catch (error) {
      line('set_value', `FAILED: ${error.message}`);
    }
  } else {
    line('set_value', 'no ValuePattern control found');
  }

  const clickable = tree.nodes.find((n) => n.patterns.includes('invoke') && n.width > 20 && n.height > 10);
  if (clickable !== undefined) {
    const selector = { hwnd: win.hwnd, action: 'invoke' };
    if (clickable.automationId) selector.automationId = clickable.automationId;
    else if (clickable.name) selector.name = clickable.name;
    else selector.controlType = clickable.controlType;
    try {
      const invoked = await backend.request('uiact', selector, { timeoutMs: 15_000 });
      line('invoke', `ok -> ${invoked.matched.controlType} "${invoked.matched.name}"`);
    } catch (error) {
      line('invoke', `FAILED: ${error.message}`);
    }
  }

  const centre = { x: win.x + Math.round(win.width / 2), y: win.y + Math.round(win.height / 2) };
  const before = await backend.request('health');
  await backend.request('click', centre);
  await wait(350);
  const after = await backend.request('health');
  line('click', `(${centre.x},${centre.y}) fg before=${before.foregroundHwnd} after=${after.foregroundHwnd} "${after.foregroundTitle}"`);

  const typed = await backend.request('type', { text: ' [SendInput-中文-ok]' });
  line('type', `typed=${typed.typed} landed in hwnd=${typed.foreground.hwnd} "${typed.foreground.title}"`);

  const shot = join(shotDir, `${processNeedle}.png`);
  const captured = await backend.request('screenshot', { path: shot, region: { x: win.x, y: win.y, width: win.width, height: win.height } });
  line('screenshot', `${captured.width}x${captured.height} -> ${shot}`);

  return win.hwnd;
}

try {
  await backend.start();
  const health = await backend.request('health');
  line('health', `interactive=${health.interactive} fg="${health.foregroundTitle}" :: ${health.note}`);

  const notepadHwnd = await scenario('Windows 11 Notepad (WinUI 3)', 'notepad.exe', 'notepad');
  const charmapHwnd = await scenario('Character Map (classic Win32)', 'charmap.exe', 'charmap');

  line('cleanup', 'closing both windows');
  for (const hwnd of [notepadHwnd, charmapHwnd]) {
    if (hwnd === undefined || hwnd === null) continue;
    try {
      await backend.request('focus', { hwnd });
      await wait(200);
      await backend.request('key', { keys: 'alt+f4' });
      await wait(300);
      await backend.request('key', { keys: 'enter' });
      await wait(300);
    } catch { /* already gone */ }
  }
  line('done', 'diagnostics complete');
} catch (error) {
  console.error('DIAG FAILED:', error.code ?? '', error.message);
  process.exitCode = 1;
} finally {
  backend.dispose();
}
