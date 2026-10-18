// Does the pruning pass keep what matters and drop what nobody can use?
import { PowerShellBackend } from './backend/bridge.js';

const b = new PowerShellBackend({ timeoutMs: 120_000 });
await b.start();

const listed = await b.request('windows', {}, { timeoutMs: 30_000 });
const targets = [];
const notepad = (listed.windows ?? []).find((w) => /notepad/i.test(w.process));
if (notepad) targets.push(notepad);
const biggest = (listed.windows ?? []).sort((a, b) => b.width * b.height - a.width * a.height)[0];
if (biggest && (!notepad || biggest.hwnd !== notepad.hwnd)) targets.push(biggest);

for (const target of targets) {
  console.log(`\n=== hwnd=${target.hwnd} "${String(target.title).slice(0, 40)}" [${target.process}] ===`);
  const payload = { hwnd: target.hwnd, maxNodes: 250 };
  const raw = await b.request('uitree', { ...payload, prune: false }, { timeoutMs: 120_000 });
  const pruned = await b.request('uitree', payload, { timeoutMs: 120_000 });

  console.log(`  raw    ${raw.nodes.length} nodes (walked ${raw.walked}, skipped ${raw.skipped}, truncated ${raw.truncated})`);
  console.log(`  pruned ${pruned.nodes.length} nodes, folded away ${pruned.pruned ?? 0}`);

  const key = (n) => `${n.controlType}|${n.name}|${n.automationId}`;
  const kept = new Set(pruned.nodes.map(key));
  const droppedWithId = raw.nodes.filter((n) => n.automationId !== '' && !kept.has(key(n)));
  const droppedWithPattern = raw.nodes.filter((n) => (n.patterns ?? []).length > 0 && !kept.has(key(n)));
  console.log(`  invariant — nodes with an automation id dropped: ${droppedWithId.length}`);
  console.log(`  invariant — nodes with a pattern dropped:        ${droppedWithPattern.length}`);
  if (droppedWithPattern.length > 0) {
    for (const n of droppedWithPattern.slice(0, 4)) console.log(`      ${n.controlType} "${String(n.name).slice(0, 30)}" [${(n.patterns ?? []).join(',')}]`);
  }
  const collapsed = pruned.nodes.filter((n) => (n.repeated ?? 0) > 1);
  console.log(`  collapsed rows: ${collapsed.length}`);
  for (const n of collapsed.slice(0, 6)) console.log(`      ${n.controlType} "${String(n.name).slice(0, 24)}" ×${n.repeated}`);

  // Depth sanity: no row may sit deeper than its parent chain allows.
  let badDepth = 0;
  for (let i = 1; i < pruned.nodes.length; i += 1) {
    if (pruned.nodes[i].depth - pruned.nodes[i - 1].depth > 1) badDepth += 1;
  }
  console.log(`  rows whose depth jumps by more than one: ${badDepth}`);
  const named = pruned.nodes.filter((n) => n.name !== '').length;
  const rawNamed = raw.nodes.filter((n) => n.name !== '').length;
  console.log(`  named rows: raw ${rawNamed} -> pruned ${named}`);
}

await b.request('shutdown', {});
b.dispose();
setTimeout(() => process.exit(0), 100).unref();
