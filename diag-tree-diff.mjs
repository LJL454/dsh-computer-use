// Dump both engines' trees for the same window and diff them line by line.
import { writeFileSync } from 'node:fs';
import { PowerShellBackend } from './backend/bridge.js';

async function worker(engine) {
  process.env.DSH_COMPUTER_UI_ENGINE = engine;
  const backend = new PowerShellBackend({ timeoutMs: 120_000 });
  await backend.start();
  return backend;
}
const com = await worker('com');
const managed = await worker('managed');
delete process.env.DSH_COMPUTER_UI_ENGINE;

const listed = await com.request('windows', {}, { timeoutMs: 30_000 });
const target = (listed.windows ?? []).find((w) => /explorer/i.test(w.process));
console.log(`target: "${target.title}" ${target.width}x${target.height}`);

// No pruning and no empty-skip: the raw walk of each engine, so any difference is the
// walk itself rather than the shaping that runs on top of it.
const payload = { hwnd: target.hwnd, maxNodes: 200, maxDepth: 4, prune: false, skipEmpty: false, patterns: false };
const c = await com.request('uitree', payload, { timeoutMs: 90_000 });
const m = await managed.request('uitree', payload, { timeoutMs: 90_000 });

const render = (nodes) => nodes.map((n) => `${'  '.repeat(n.depth)}${n.controlType.replace('ControlType.', '')}|${n.name}|${n.automationId}|${n.x},${n.y} ${n.width}x${n.height}`);

console.log(`\ncom ${c.nodes.length} nodes (walked ${c.walked})   managed ${m.nodes.length} nodes (walked ${m.walked})`);
writeFileSync('./tree-com.txt', render(c.nodes).join('\n'));
writeFileSync('./tree-managed.txt', render(m.nodes).join('\n'));

console.log('\n--- com (first 26) ---');
for (const line of render(c.nodes).slice(0, 26)) console.log(`  ${line}`);
console.log('\n--- managed (first 26) ---');
for (const line of render(m.nodes).slice(0, 26)) console.log(`  ${line}`);

// Which top-level branches exist in one and not the other?
const top = (nodes) => nodes.filter((n) => n.depth === 1).map((n) => `${n.controlType}|${n.name}|${n.automationId}`);
console.log(`\ncom depth-1:     ${top(c.nodes).join('   ||   ')}`);
console.log(`managed depth-1: ${top(m.nodes).join('   ||   ')}`);

await com.request('shutdown', {});
await managed.request('shutdown', {});
com.dispose();
managed.dispose();
setTimeout(() => process.exit(0), 100).unref();
