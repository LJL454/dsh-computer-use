// Walk their failure-condition list against this implementation: which conditions exist
// here and go unchecked?
import { PowerShellBackend } from './backend/bridge.js';

const b = new PowerShellBackend({ timeoutMs: 90_000 });
await b.start();
const listed = await b.request('windows', {}, { timeoutMs: 30_000 });
const np = (listed.windows ?? []).find((w) => /notepad/i.test(w.process));
if (!np) { console.log('no notepad'); process.exit(1); }
const attempt = (cmd, args) => b.request(cmd, args, { timeoutMs: 45_000 }).then((r) => ({ ok: true, r }), (e) => ({ ok: false, m: String(e.message).replace(/^\w+ failed:\s*/, '') }));

// dpi_awareness_unverified: is the awareness actually what we think it is?
const health = await b.request('health', {}, { timeoutMs: 30_000 });
console.log(`dpi mode reported: ${JSON.stringify(health.info?.dpi ?? health.dpi ?? null)}`);
console.log(`engine: ${health.info?.engine ?? health.engine}`);

// unsupported_modifier_token / invalid_modifier_chord
for (const keys of ['hyper+x', 'ctrl+hyper+x', 'ctrl+shift+zzz']) {
  const r = await attempt('key', { keys });
  console.log(`key '${keys}' -> ${r.ok ? 'ACCEPTED' : r.m.slice(0, 110)}`);
}

// capture_geometry_unavailable: a minimized window still has a handle.
const min = await attempt('uiact', { hwnd: np.hwnd, control_type: 'Window', action: 'minimize' });
console.log(`\nminimize: ${min.ok ? 'ok' : min.m.slice(0, 90)}`);
await new Promise((r) => setTimeout(r, 900));
const geo = await attempt('windows', {});
const nowMin = (geo.r?.windows ?? []).find((w) => w.hwnd === np.hwnd);
console.log(`after minimize, the list reports: ${nowMin ? `${nowMin.x},${nowMin.y} ${nowMin.width}x${nowMin.height}` : 'the window is gone from the list'}`);
const shotMin = await attempt('screenshot', { window: np.hwnd, path: './minimized.png', format: 'png' });
console.log(`capture of a minimized window -> ${shotMin.ok ? `ACCEPTED ${shotMin.r.width}x${shotMin.r.height} source=${shotMin.r.source} verification=${JSON.stringify(shotMin.r.verification)}` : shotMin.m.slice(0, 130)}`);
const clickMin = await attempt('click', { x: 10, y: 10, fromFrame: shotMin.ok ? shotMin.r.frame : 'f1', preferA11y: false });
console.log(`frame click after minimize -> ${clickMin.ok ? 'ACCEPTED' : clickMin.m.slice(0, 140)}`);

// drag_in_flight: is a new drag refused while a button is still held?
const held = await attempt('mousedown', {});
console.log(`\nmousedown: ${held.ok ? JSON.stringify(held.r).slice(0, 90) : held.m.slice(0, 90)}`);
const drag2 = await attempt('drag', { fromX: 200, fromY: 200, toX: 260, toY: 240 });
console.log(`a drag while a button is held -> ${drag2.ok ? 'ACCEPTED (no drag_in_flight check)' : drag2.m.slice(0, 130)}`);
const drag3 = await attempt('drag', { fromX: 200, fromY: 200, toX: 260, toY: 240 });
console.log(`a second drag -> ${drag3.ok ? 'ACCEPTED' : drag3.m.slice(0, 130)}`);
await attempt('release', {});

// verified_text_replacement_unavailable: does set_value check that it took?
const tree = await b.request('uitree', { hwnd: np.hwnd, maxNodes: 40 }, { timeoutMs: 60_000 }).catch(() => ({ nodes: [] }));
console.log(`\n(restoring the window)`);
await attempt('uiact', { hwnd: np.hwnd, control_type: 'Window', action: 'restore' });

await b.request('shutdown', {});
b.dispose();
setTimeout(() => process.exit(0), 100).unref();
