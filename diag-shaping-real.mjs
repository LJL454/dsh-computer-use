// What the two shaping passes do to real windows, before and after.
import { PowerShellBackend } from './backend/bridge.js';

const b = new PowerShellBackend({ timeoutMs: 120_000 });
await b.start();
const listed = await b.request('windows', {}, { timeoutMs: 30_000 });

const seen = new Set();
for (const w of listed.windows ?? []) {
  if (seen.has(w.process) || w.width < 300 || w.height < 200) continue;
  seen.add(w.process);
  const pruned = await b.request('uitree', { hwnd: w.hwnd, prune: true, maxNodes: 400 }, { timeoutMs: 60_000 }).catch((e) => ({ error: String(e.message) }));
  const raw = await b.request('uitree', { hwnd: w.hwnd, prune: false, maxNodes: 400 }, { timeoutMs: 60_000 }).catch((e) => ({ error: String(e.message) }));
  if (pruned.error || raw.error) { console.log(`[${w.process}] skipped: ${String(pruned.error ?? raw.error).slice(0, 70)}`); continue; }
  const merged = (pruned.nodes ?? []).filter((n) => n.merged !== undefined);
  const repeated = (pruned.nodes ?? []).filter((n) => n.repeated !== undefined);
  const textKept = merged.reduce((sum, n) => sum + (n.merged ?? 0), 0);
  console.log(`\n[${w.process}] "${String(w.title).slice(0, 34)}"`);
  console.log(`  raw ${raw.nodes.length} -> pruned ${pruned.nodes.length}   (pruned=${pruned.pruned ?? 0})`);
  console.log(`  text runs merged: ${merged.length} row(s) standing in for ${textKept} node(s)`);
  for (const n of merged.slice(0, 3)) {
    console.log(`    "${String(n.name).slice(0, 88)}"  (${n.merged})`);
  }
  if (repeated.length > 0) {
    console.log(`  runs collapsed: ${repeated.length} row(s) standing in for ${repeated.reduce((s, n) => s + (n.repeated ?? 0), 0)} node(s)`);
  }
  if (seen.size >= 5) break;
}

await b.request('shutdown', {});
b.dispose();
setTimeout(() => process.exit(0), 100).unref();
