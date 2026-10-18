/** Which buttons does the COM find path return that the managed one does not? */
import { PowerShellBackend } from './backend/bridge.js';

async function worker(engine) {
  process.env.DSH_COMPUTER_UI_ENGINE = engine;
  const backend = new PowerShellBackend({ timeoutMs: 120_000 });
  await backend.start();
  return backend;
}

const com = await worker('com');
const managed = await worker('managed');

const listed = await com.request('windows', {}, { timeoutMs: 30_000 });
const target = (listed.windows ?? []).filter((w) => /notepad/i.test(w.process)).sort((a, b) => b.width * b.height - a.width * a.height)[0];
if (target === undefined) { console.log('no Notepad window'); process.exit(0); }
console.log(`target hwnd=${target.hwnd} "${target.title}"\n`);

const payload = { hwnd: target.hwnd, maxNodes: 250, controlType: 'Button' };
const a = await com.request('uitree', payload, { timeoutMs: 120_000 });
const b = await managed.request('uitree', payload, { timeoutMs: 120_000 });

const key = (n) => `${n.controlType}|${n.name}|${n.automationId}|${n.x},${n.y} ${n.width}x${n.height}`;
const aKeys = a.nodes.map(key);
const bKeys = b.nodes.map(key);
console.log(`com ${a.nodes.length}, managed ${b.nodes.length}\n`);
console.log('COM only:');
for (const [i, k] of aKeys.entries()) if (!bKeys.includes(k)) console.log(`  [${i}] ${k}  patterns=${(a.nodes[i].patterns ?? []).join('+')}`);
console.log('managed only:');
for (const [i, k] of bKeys.entries()) if (!aKeys.includes(k)) console.log(`  [${i}] ${k}  patterns=${(b.nodes[i].patterns ?? []).join('+')}`);

await com.request('shutdown', {});
await managed.request('shutdown', {});
com.dispose();
managed.dispose();
setTimeout(() => process.exit(0), 100).unref();
