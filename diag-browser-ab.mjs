// Why does the managed tree name a node the COM tree does not, on a Chromium window?
import { PowerShellBackend } from './backend/bridge.js';

process.env.DSH_COMPUTER_UI_ENGINE = 'com';
const com = new PowerShellBackend({ timeoutMs: 60_000 });
process.env.DSH_COMPUTER_UI_ENGINE = 'managed';
const mgd = new PowerShellBackend({ timeoutMs: 60_000 });
await com.start();
await mgd.start();

const listed = await com.request('windows', {}, { timeoutMs: 30_000 });
const target = (listed.windows ?? []).sort((a, b) => b.width * b.height - a.width * a.height)[0];
console.log(`target hwnd=${target.hwnd} "${target.title}" [${target.process}] ${target.width}x${target.height}`);

const payload = { hwnd: target.hwnd, maxDepth: 6, maxNodes: 250 };
const a = await com.request('uitree', payload, { timeoutMs: 120_000 });
const b = await mgd.request('uitree', payload, { timeoutMs: 60_000 });
const key = (n) => `${n.controlType}|${n.name}`;

console.log(`\nCOM: ${a.nodes.length} nodes (walked ${a.walked}, skipped ${a.skipped}, truncated ${a.truncated})`);
console.log(`MGD: ${b.nodes.length} nodes (walked ${b.walked}, skipped ${b.skipped}, truncated ${b.truncated})`);
console.log('\nCOM first 6:');
for (const n of a.nodes.slice(0, 6)) console.log(`  ${key(n)}  id="${n.automationId}" class="${n.className}" ${n.x},${n.y} ${n.width}x${n.height}`);
console.log('MGD all:');
for (const n of b.nodes) console.log(`  ${key(n)}  id="${n.automationId}" class="${n.className}" ${n.x},${n.y} ${n.width}x${n.height}`);

const comKeys = new Set(a.nodes.map(key));
console.log('\nmanaged keys missing from COM:');
for (const n of b.nodes) if (!comKeys.has(key(n))) console.log(`  MISSING ${key(n)}`);
console.log('\nmanaged keys present in COM:');
for (const n of b.nodes) if (comKeys.has(key(n))) console.log(`  present ${key(n)}`);

await com.request('shutdown', {});
await mgd.request('shutdown', {});
com.dispose();
mgd.dispose();
setTimeout(() => process.exit(0), 100).unref();
