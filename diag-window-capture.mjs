// The point of a window capture: it is the window even while something covers it.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PowerShellBackend } from './backend/bridge.js';

const b = new PowerShellBackend({ timeoutMs: 120_000 });
await b.start();

const setWindowPos = (hwnd, x, y, w, h) => {
  const script = 'Add-Type -Namespace N -Name W -MemberDefinition \'[DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr h, System.IntPtr a, int x, int y, int cx, int cy, uint f);\'; [void][N.W]::SetWindowPos([IntPtr]' + hwnd + ', [IntPtr]::Zero, ' + x + ', ' + y + ', ' + w + ', ' + h + ', 0x0010 -bor 0x0004)';
  execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore' });
};
const sig = (path) => {
  const buf = readFileSync(path);
  return { bytes: statSync(path).size, hash: createHash('sha256').update(buf).digest('hex').slice(0, 16) };
};

const listed = await b.request('windows', {}, { timeoutMs: 30_000 });
const notepads = (listed.windows ?? []).filter((w) => /notepad/i.test(w.process)).slice(0, 2);
if (notepads.length < 2) { console.log(`need two Notepads, found ${notepads.length}`); process.exit(1); }
const [a, c] = notepads;
console.log(`A hwnd=${a.hwnd} pid=${a.pid}  B hwnd=${c.hwnd} pid=${c.pid}`);

// Give them different content, or two blank windows at the same size are the same image.
const writeInto = async (hwnd, text) => {
  const tree = await b.request('uitree', { hwnd, maxNodes: 40 }, { timeoutMs: 60_000 });
  const doc = tree.nodes.find((n) => String(n.controlType).includes('Document'));
  if (!doc) return;
  await b.request('uiact', { action: 'set_value', hwnd, automationId: doc.automationId, name: doc.automationId ? '' : doc.name, controlType: doc.automationId ? '' : doc.controlType, value: text }, { timeoutMs: 60_000 });
};
await writeInto(a.hwnd, 'ALPHA alpha alpha alpha');
await writeInto(c.hwnd, 'BRAVO bravo bravo bravo');
await new Promise((r) => setTimeout(r, 700));

// Put them in the same place, B over A.
setWindowPos(a.hwnd, 120, 120, 900, 600);
await new Promise((r) => setTimeout(r, 700));
setWindowPos(c.hwnd, 120, 120, 900, 600);
await new Promise((r) => setTimeout(r, 900));

const shot = async (payload, name) => {
  const out = await b.request('screenshot', { path: `./${name}.png`, format: 'png', ...payload }, { timeoutMs: 60_000 });
  return { ...sig(out.path), source: out.source, verification: out.verification, window: out.window, w: out.width, h: out.height };
};

const aWindow = await shot({ window: a.hwnd }, 'win-a-covered');
const bWindow = await shot({ window: c.hwnd }, 'win-b-top');
const region = await shot({ region: { x: 120, y: 120, width: 900, height: 600 } }, 'region-same-rect');

console.log(`\nA (covered)   source=${aWindow.source} ${aWindow.w}x${aWindow.h} ${aWindow.bytes} bytes ${aWindow.hash}`);
console.log(`  window: ${JSON.stringify(aWindow.window)}`);
console.log(`  checked: ${JSON.stringify(aWindow.verification)}`);
console.log(`B (on top)    source=${bWindow.source} ${bWindow.w}x${bWindow.h} ${bWindow.bytes} bytes ${bWindow.hash}`);
console.log(`screen region source=${region.source} ${region.w}x${region.h} ${region.bytes} bytes ${region.hash}`);

console.log(`\nA-window == B-window (they are different windows): ${aWindow.hash === bWindow.hash}`);
console.log(`A-window == screen-region (the screen shows B):     ${aWindow.hash === region.hash}`);

// Occlusion independence: move B away, capture A again, compare.
setWindowPos(c.hwnd, 1400, 120, 900, 600);
await new Promise((r) => setTimeout(r, 900));
const aUncovered = await shot({ window: a.hwnd }, 'win-a-uncovered');
console.log(`\nA (uncovered) ${aUncovered.bytes} bytes ${aUncovered.hash}`);
console.log(`A covered vs A uncovered identical: ${aWindow.hash === aUncovered.hash}  (sizes ${aWindow.bytes} / ${aUncovered.bytes})`);
const regionNow = await shot({ region: { x: 120, y: 120, width: 900, height: 600 } }, 'region-now');
console.log(`screen region now == A window capture: ${regionNow.hash === aUncovered.hash}`);

await b.request('shutdown', {});
b.dispose();
setTimeout(() => process.exit(0), 100).unref();
