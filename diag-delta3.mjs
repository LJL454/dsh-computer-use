// Are the nodes the delta called "removed" actually still in the tree?
import { PowerShellBackend } from './backend/bridge.js';

const b = new PowerShellBackend({ timeoutMs: 90_000 });
await b.start();
const listed = await b.request('windows', {}, { timeoutMs: 30_000 });
const np = (listed.windows ?? []).find((w) => /notepad/i.test(w.process));
if (!np) { console.log('no notepad'); process.exit(1); }

const first = await b.request('uitree', { hwnd: np.hwnd, maxNodes: 60 }, { timeoutMs: 60_000 });
const doc = first.nodes.find((n) => String(n.controlType).includes('Document'));
await b.request('uiact', { action: 'set_value', hwnd: np.hwnd, automationId: doc?.automationId ?? '', name: doc?.automationId ? '' : doc?.name ?? '', controlType: doc?.automationId ? '' : doc?.controlType ?? '', value: 'delta probe 中文' }, { timeoutMs: 60_000 });
await new Promise((r) => setTimeout(r, 900));

const after = await b.request('uitree', { hwnd: np.hwnd, maxNodes: 60, since: first.snapshot }, { timeoutMs: 60_000 });
const now = await b.request('uitree', { hwnd: np.hwnd, maxNodes: 60, prune: false }, { timeoutMs: 60_000 });
const names = new Set(now.nodes.map((n) => n.name));
console.log(`removed nodes the delta reported: ${after.delta.removed}`);
for (const gone of after.delta.removedNodes ?? []) {
  console.log(`  ${gone.controlType.replace('ControlType.', '')} "${gone.name}"  -> still present in the current tree: ${names.has(gone.name) ? 'YES' : 'no'}`);
}
console.log(`\ncurrent tree has ${now.nodes.length} rows; names include: ${[...names].filter((n) => n !== '').slice(0, 18).join(' | ')}`);

await b.request('shutdown', {});
b.dispose();
setTimeout(() => process.exit(0), 100).unref();
