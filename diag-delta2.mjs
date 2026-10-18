// Is the tree really changing between two consecutive reads, or is the delta comparing wrongly?
import { PowerShellBackend } from './backend/bridge.js';

const b = new PowerShellBackend({ timeoutMs: 90_000 });
await b.start();
const listed = await b.request('windows', {}, { timeoutMs: 30_000 });
const np = (listed.windows ?? []).find((w) => /notepad/i.test(w.process));
if (!np) { console.log('no notepad'); process.exit(1); }

const read = (extra) => b.request('uitree', { hwnd: np.hwnd, maxNodes: 60, prune: false, ...extra }, { timeoutMs: 60_000 });
const a = await read({});
const c = await read({});

const key = (n) => (n.automationId !== '' ? `id:${n.automationId}` : `p:${n.controlType}|${n.className}|${n.name}`);
const rect = (n) => `${n.x},${n.y} ${n.width}x${n.height}`;
const before = new Map(a.nodes.map((n) => [key(n), n]));
let differing = 0;
const seen = new Set();
for (const n of c.nodes) {
  const k = key(n);
  seen.add(k);
  const was = before.get(k);
  if (!was) continue;
  if (rect(was) !== rect(n)) {
    differing += 1;
    if (differing <= 16) console.log(`  ${k.slice(0, 60)}\n      was ${rect(was)}  now ${rect(n)}  name "${String(was.name).slice(0, 20)}" -> "${String(n.name).slice(0, 20)}"`);
  }
}
console.log(`\nindependent comparison: ${differing} of ${c.nodes.length} rows have a different rect`);
const dupKeys = {};
for (const n of c.nodes) { const k = key(n); dupKeys[k] = (dupKeys[k] ?? 0) + 1; }
const collisions = Object.entries(dupKeys).filter(([, n]) => n > 1);
console.log(`keys appearing more than once in one read: ${collisions.length}`);
for (const [k, n] of collisions.slice(0, 6)) console.log(`  ${k.slice(0, 60)} ×${n}`);

await b.request('shutdown', {});
b.dispose();
setTimeout(() => process.exit(0), 100).unref();
