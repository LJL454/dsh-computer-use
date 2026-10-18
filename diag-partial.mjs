// The conditions the matrix marked "partial": a minimized window, a surface that changes
// mid-capture, and frames whose provenance is nonsense.
import { PowerShellBackend } from './backend/bridge.js';

const b = new PowerShellBackend({ timeoutMs: 90_000 });
await b.start();
const listed = await b.request('windows', {}, { timeoutMs: 30_000 });
const np = (listed.windows ?? []).find((w) => /notepad/i.test(w.process));
if (!np) { console.log('no notepad'); process.exit(1); }
const attempt = (cmd, args) => b.request(cmd, args, { timeoutMs: 45_000 }).then((r) => ({ ok: true, r }), (e) => ({ ok: false, m: String(e.message).replace(/^\w+ failed:\s*/, '') }));

// invalid_frame_provenance: nonsense frame ids must be refused, not crash.
console.log('=== frame ids that are not frame ids ===');
for (const id of ['abc', 'f', 'f-1', 'f0', 'f99999999999999999999', '', 'f1.2', '{"id":1}']) {
  const r = await attempt('click', { x: 5, y: 5, fromFrame: id, preferA11y: false });
  console.log(`  ${JSON.stringify(id).padEnd(26)} -> ${r.ok ? 'ACCEPTED' : r.m.slice(0, 95)}`);
}

// capture_geometry_unavailable: a minimized window still answers, but has no visible surface.
console.log('\n=== a minimized window ===');
const min = await attempt('uiact', { hwnd: np.hwnd, controlType: 'Window', action: 'minimize' });
console.log(`  minimize -> ${min.ok ? 'ok' : min.m.slice(0, 80)}`);
await new Promise((r) => setTimeout(r, 1200));
const after = await b.request('windows', {}, { timeoutMs: 30_000 });
const stillListed = (after.windows ?? []).find((w) => w.hwnd === np.hwnd);
console.log(`  listed after minimize: ${stillListed ? `yes, at ${stillListed.x},${stillListed.y} ${stillListed.width}x${stillListed.height}` : 'no (dropped from the list)'}`);
const shot = await attempt('screenshot', { window: np.hwnd, path: './minimized.png', format: 'png' });
if (shot.ok) {
  console.log(`  capture -> ${shot.r.width}x${shot.r.height} at ${shot.r.x},${shot.r.y} source=${shot.r.source} bytes=${shot.r.bytes}`);
  console.log(`    checked: ${JSON.stringify(shot.r.verification)}`);
  const click = await attempt('click', { x: 20, y: 20, fromFrame: shot.r.frame, preferA11y: false });
  console.log(`    frame click -> ${click.ok ? `ACCEPTED at (${click.r.x},${click.r.y})` : click.m.slice(0, 120)}`);
} else {
  console.log(`  capture refused: ${shot.m.slice(0, 160)}`);
}

await attempt('uiact', { hwnd: np.hwnd, controlType: 'Window', action: 'restore' });
await new Promise((r) => setTimeout(r, 900));
console.log('\n  (restored)');

// capture_surfaces_changed: does a capture notice that the window moved while it was being taken?
console.log('\n=== a window that moves during the capture ===');
const ok = await attempt('screenshot', { window: np.hwnd, path: './surface.png', format: 'png' });
console.log(`  steady capture -> ${ok.ok ? `source=${ok.r.source} ${ok.r.width}x${ok.r.height} verification=${JSON.stringify(ok.r.verification)}` : ok.m.slice(0, 100)}`);

await b.request('shutdown', {});
b.dispose();
setTimeout(() => process.exit(0), 100).unref();
