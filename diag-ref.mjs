// Ref round trip: read a tree, act by ref, move the window, act again by the same ref.
import { execFileSync } from 'node:child_process';
import { PowerShellBackend } from './backend/bridge.js';

const b = new PowerShellBackend({ timeoutMs: 90_000 });
await b.start();

const listed = await b.request('windows', {}, { timeoutMs: 30_000 });
const np = (listed.windows ?? []).find((w) => /notepad/i.test(w.process));
if (!np) {
  console.log('no notepad window');
  process.exit(1);
}
console.log(`window hwnd=${np.hwnd} "${np.title}"`);

const tree = await b.request('uitree', { hwnd: np.hwnd, maxNodes: 60 }, { timeoutMs: 60_000 });
const withRef = tree.nodes.filter((n) => n.ref);
console.log(`snapshot=${tree.snapshot} nodes=${tree.nodes.length} carrying a ref=${withRef.length}`);
const doc = tree.nodes.find((n) => String(n.controlType).includes('Document'));
if (!doc) {
  console.log('no Document node');
  process.exit(1);
}
console.log(`document: ref=${doc.ref} rect=${doc.x},${doc.y} ${doc.width}x${doc.height} path-ish name="${doc.name}"`);

const set = await b.request('uiact', { action: 'set_value', ref: doc.ref, value: '第一行 内容A\n第二行 内容B' }, { timeoutMs: 60_000 });
console.log(`set_value by ref      -> matched="${set.matched?.name}" reresolved=${set.reresolved} drift=${set.drift}`);

// Move the window: the element is still there, but not where the ref was read.
const script = 'Add-Type -Namespace N -Name W -MemberDefinition \'[DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr h, System.IntPtr a, int x, int y, int cx, int cy, uint f);\'; [void][N.W]::SetWindowPos([IntPtr]' + np.hwnd + ', [IntPtr]::Zero, 140, 160, 0, 0, 0x0001 -bor 0x0004)';
execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));

const moved = await b.request('uiact', { action: 'get_value', ref: doc.ref }, { timeoutMs: 60_000 });
console.log(`get_value same ref    -> value="${String(moved.value).slice(0, 18)}" reresolved=${moved.reresolved} drift=${moved.drift}`);

const fresh = await b.request('uitree', { hwnd: np.hwnd, maxNodes: 60 }, { timeoutMs: 60_000 });
console.log(`second read snapshot=${fresh.snapshot} (different snapshot id expected: ${fresh.snapshot !== tree.snapshot})`);

try {
  await b.request('uiact', { action: 'get_value', ref: 's999.999' }, { timeoutMs: 30_000 });
  console.log('bogus ref             -> NO ERROR (wrong)');
} catch (error) {
  console.log(`bogus ref             -> ${String(error.message).slice(0, 140)}`);
}

await b.request('shutdown', {});
b.dispose();
setTimeout(() => process.exit(0), 100).unref();
