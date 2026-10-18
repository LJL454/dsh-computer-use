// Which real windows actually exercise the pruning pass?
import { PowerShellBackend } from './backend/bridge.js';

const b = new PowerShellBackend({ timeoutMs: 120_000 });
await b.start();
const listed = await b.request('windows', {}, { timeoutMs: 30_000 });
const others = (listed.windows ?? []).filter((w) => !/notepad/i.test(w.process));
console.log(`${listed.windows.length} window(s), ${others.length} of them not Notepad`);

for (const target of others.slice(0, 10)) {
  const payload = { hwnd: target.hwnd, maxNodes: 250 };
  let raw;
  let pruned;
  try {
    raw = await b.request('uitree', { ...payload, prune: false }, { timeoutMs: 120_000 });
    pruned = await b.request('uitree', payload, { timeoutMs: 120_000 });
  } catch (error) {
    console.log(`  hwnd=${target.hwnd} [${target.process}] READ FAILED: ${String(error.message).slice(0, 60)}`);
    continue;
  }
  const folded = pruned.pruned ?? 0;
  const collapsed = pruned.nodes.filter((n) => (n.repeated ?? 0) > 1);
  const named = pruned.nodes.filter((n) => n.name !== '').length;
  const rawNamed = raw.nodes.filter((n) => n.name !== '').length;
  console.log(
    `  hwnd=${target.hwnd} [${String(target.process).slice(0, 14)}] "${String(target.title).slice(0, 26)}" raw=${raw.nodes.length} pruned=${pruned.nodes.length} folded=${folded} collapsedRows=${collapsed.length} named ${rawNamed}->${named}`,
  );
  for (const n of collapsed.slice(0, 4)) console.log(`        ${n.controlType} "${String(n.name).slice(0, 20)}" x${n.repeated}`);
  const kept = new Set(pruned.nodes.map((n) => `${n.controlType}|${n.name}|${n.automationId}`));
  const lost = raw.nodes.filter((n) => (n.automationId !== '' || (n.patterns ?? []).length > 0) && !kept.has(`${n.controlType}|${n.name}|${n.automationId}`));
  console.log(`        invariant — addressable or actionable rows lost: ${lost.length}`);
}

await b.request('shutdown', {});
b.dispose();
setTimeout(() => process.exit(0), 100).unref();
