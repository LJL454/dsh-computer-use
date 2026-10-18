/**
 * Survey how many UI Automation nodes several kinds of window expose, to tell
 * whether the single-node Character Map result is app-specific or systemic.
 *
 *   node survey-uia.mjs
 */
import { spawn } from 'node:child_process';
import { PowerShellBackend } from './backend/bridge.js';

const line = (label, value) => console.log(`${String(label).padEnd(30)} ${value}`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const TARGETS = [
  { label: 'Character Map (classic)', command: 'charmap.exe', needle: 'charmap' },
  { label: 'Paint (classic Win32)', command: 'mspaint.exe', needle: 'mspaint' },
  { label: 'Control Panel (explorer)', command: 'control.exe', needle: 'explorer' },
  { label: 'Registry Editor (classic tree)', command: 'regedit.exe', needle: 'regedit' },
];

const backend = new PowerShellBackend({ timeoutMs: 45_000 });
const opened = [];

try {
  await backend.start();
  for (const target of TARGETS) {
    const before = new Set((await backend.request('windows', {})).windows.map((w) => w.hwnd));
    const child = spawn(target.command, [], { detached: true, stdio: 'ignore' });
    child.unref();
    let win = null;
    for (let attempt = 0; attempt < 30 && win === null; attempt += 1) {
      await wait(500);
      const { windows } = await backend.request('windows', {});
      win = windows.find((w) => !before.has(w.hwnd) && new RegExp(target.needle, 'i').test(w.process)) ?? null;
    }
    if (win === null) {
      line(target.label, 'no new window appeared');
      continue;
    }
    opened.push(win.hwnd);
    try {
      const tree = await backend.request('uitree', { hwnd: win.hwnd, maxDepth: 5, maxNodes: 400 }, { timeoutMs: 20_000 });
      const usable = tree.nodes.filter((n) => n.width > 0 && n.height > 0).length;
      const actionable = tree.nodes.filter((n) => n.patterns.length > 0).length;
      line(target.label, `hwnd=${win.hwnd} "${win.title}" nodes=${tree.nodes.length} onscreen=${usable} actionable=${actionable} truncated=${tree.truncated}`);
    } catch (error) {
      line(target.label, `uitree FAILED: ${error.message}`);
    }
  }

  /* Also survey a window that is already open, to compare without launching. */
  const existing = (await backend.request('windows', {})).windows.filter((w) => !opened.includes(w.hwnd));
  for (const win of existing.slice(0, 4)) {
    try {
      const tree = await backend.request('uitree', { hwnd: win.hwnd, maxDepth: 4, maxNodes: 300 }, { timeoutMs: 20_000 });
      line(`open: ${win.process}`, `hwnd=${win.hwnd} "${win.title.slice(0, 34)}" nodes=${tree.nodes.length}`);
    } catch (error) {
      line(`open: ${win.process}`, `uitree FAILED: ${error.message}`);
    }
  }
} catch (error) {
  console.error('SURVEY FAILED:', error.code ?? '', error.message);
  process.exitCode = 1;
} finally {
  for (const hwnd of opened) {
    try {
      await backend.request('focus', { hwnd }, { timeoutMs: 6_000 });
      await wait(200);
      await backend.request('key', { keys: 'alt+f4' }, { timeoutMs: 6_000 });
    } catch { /* ignore */ }
  }
  backend.dispose();
}
