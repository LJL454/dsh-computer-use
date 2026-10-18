// Delta protocol: read, re-read, change something, re-read with `since`.
import { PowerShellBackend } from './backend/bridge.js';

const b = new PowerShellBackend({ timeoutMs: 90_000 });
await b.start();

const listed = await b.request('windows', {}, { timeoutMs: 30_000 });
const np = (listed.windows ?? []).find((w) => /notepad/i.test(w.process));
if (!np) {
  console.log('no notepad window');
  process.exit(1);
}
console.log(`window hwnd=${np.hwnd} "${np.title}"`);

const first = await b.request('uitree', { hwnd: np.hwnd, maxNodes: 60 }, { timeoutMs: 60_000 });
console.log(`read 1: snapshot=${first.snapshot} nodes=${first.nodes.length}`);

const repeat = await b.request('uitree', { hwnd: np.hwnd, maxNodes: 60, since: first.snapshot }, { timeoutMs: 60_000 });
console.log(`read 2 (since ${first.snapshot}): rows=${repeat.nodes.length} delta=${JSON.stringify(repeat.delta)}`);

// Change the document: the text control's label and the window title both move.
const doc = first.nodes.find((n) => String(n.controlType).includes('Document'));
await b.request('uiact', { action: 'set_value', hwnd: np.hwnd, automationId: doc?.automationId ?? '', name: doc?.automationId ? '' : doc?.name ?? '', controlType: doc?.automationId ? '' : doc?.controlType ?? '', value: 'delta probe 中文' }, { timeoutMs: 60_000 });
await new Promise((r) => setTimeout(r, 900));

const afterChange = await b.request('uitree', { hwnd: np.hwnd, maxNodes: 60, since: first.snapshot }, { timeoutMs: 60_000 });
console.log(`read 3 (since ${first.snapshot}, after the document changed): rows=${afterChange.nodes.length} delta=${JSON.stringify({ ...afterChange.delta, removedNodes: undefined })}`);
for (const n of afterChange.nodes.slice(0, 5)) console.log(`    [${n.delta}] ${n.controlType} "${String(n.name).slice(0, 26)}" ${n.x},${n.y} ${n.width}x${n.height}`);
if (afterChange.delta?.removedNodes) console.log(`    gone: ${JSON.stringify(afterChange.delta.removedNodes)}`);

// A snapshot this worker never minted.
const unknown = await b.request('uitree', { hwnd: np.hwnd, maxNodes: 60, since: 's999' }, { timeoutMs: 60_000 });
console.log(`read 4 (since s999): rows=${unknown.nodes.length} delta=${JSON.stringify({ ...unknown.delta, removedNodes: undefined })}`);

// The delta must agree with the `unchanged` digest: a repeat read has no changes.
const again = await b.request('uitree', { hwnd: np.hwnd, maxNodes: 60, since: afterChange.snapshot }, { timeoutMs: 60_000 });
console.log(`read 5 (since ${afterChange.snapshot}, immediately): rows=${again.nodes.length} delta=${JSON.stringify({ ...again.delta, removedNodes: undefined })}`);

await b.request('shutdown', {});
b.dispose();
setTimeout(() => process.exit(0), 100).unref();
