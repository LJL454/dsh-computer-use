// The two engines return different trees under maxDepth. Pin down how.
import { PowerShellBackend } from './backend/bridge.js';

process.env.DSH_COMPUTER_UI_ENGINE = 'com';
const com = new PowerShellBackend({ timeoutMs: 120_000 });
process.env.DSH_COMPUTER_UI_ENGINE = 'managed';
const managed = new PowerShellBackend({ timeoutMs: 120_000 });
await com.start();
await managed.start();

const listed = await com.request('windows', {}, { timeoutMs: 30_000 });
const target = (listed.windows ?? []).find((w) => /explorer/i.test(w.process))
  ?? (listed.windows ?? []).find((w) => /notepad/i.test(w.process));
console.log(`target: hwnd=${target.hwnd} "${target.title}" [${target.process}]`);

const hist = (nodes) => {
  const byDepth = new Map();
  for (const n of nodes) byDepth.set(n.depth, (byDepth.get(n.depth) ?? 0) + 1);
  return [...byDepth.entries()].sort((a, b) => a[0] - b[0]).map(([d, c]) => `${d}:${c}`).join('  ');
};

for (const depth of [undefined, 3, 6, 10]) {
  const payload = { hwnd: target.hwnd, maxNodes: 250 };
  if (depth !== undefined) payload.maxDepth = depth;
  const c = await com.request('uitree', payload, { timeoutMs: 90_000 });
  const m = await managed.request('uitree', payload, { timeoutMs: 90_000 });
  const label = depth === undefined ? 'default' : `maxDepth=${depth}`;
  console.log(`\n${label}:  com ${c.nodes.length} nodes (maxDepth seen ${c.maxDepth ?? '?'}, walked ${c.walked}, skipped ${c.skipped})`);
  console.log(`          mgd ${m.nodes.length} nodes (maxDepth seen ${m.maxDepth ?? '?'}, walked ${m.walked}, skipped ${m.skipped})`);
  console.log(`  com depths: ${hist(c.nodes)}`);
  console.log(`  mgd depths: ${hist(m.nodes)}`);
}

// Where does one specific node sit in each engine, under maxDepth 6?
console.log('\n--- a node only the managed engine reports, under maxDepth 6 ---');
const c6 = await com.request('uitree', { hwnd: target.hwnd, maxNodes: 250, maxDepth: 6 }, { timeoutMs: 90_000 });
const m6 = await managed.request('uitree', { hwnd: target.hwnd, maxNodes: 250, maxDepth: 6 }, { timeoutMs: 90_000 });
const comKeys = new Set(c6.nodes.map((n) => `${n.controlType}|${n.name}`));
for (const n of m6.nodes.filter((x) => x.name !== '' && !comKeys.has(`${x.controlType}|${x.name}`)).slice(0, 6)) {
  const inCom = c6.nodes.find((x) => x.name === n.name && x.controlType === n.controlType);
  console.log(`  managed: "${n.name}" depth=${n.depth}  ${n.x},${n.y} ${n.width}x${n.height}   com has it: ${inCom ? `depth=${inCom.depth}` : 'no'}`);
}

await com.request('shutdown', {});
await managed.request('shutdown', {});
com.dispose();
managed.dispose();
setTimeout(() => process.exit(0), 100).unref();
