// Is the COM/managed disagreement on File Explorer a real engine difference, or a
// window that is mutating under both of them?
//
// Method: compare each engine against ITSELF first. A window that two reads of the same
// engine disagree about is unstable, and an engine comparison on it means nothing.
import { PowerShellBackend } from './backend/bridge.js';

process.env.DSH_COMPUTER_UI_ENGINE = 'com';
const com = new PowerShellBackend({ timeoutMs: 120_000 });
process.env.DSH_COMPUTER_UI_ENGINE = 'managed';
const managed = new PowerShellBackend({ timeoutMs: 120_000 });
await com.start();
await managed.start();

const listed = await com.request('windows', {}, { timeoutMs: 30_000 });
const target = (listed.windows ?? []).find((w) => /explorer/i.test(w.process));
if (!target) { console.log('no explorer window'); process.exit(1); }
console.log(`target: hwnd=${target.hwnd} "${target.title}" ${target.width}x${target.height}`);

const read = async (backend, label) => {
  const out = await backend.request('uitree', { hwnd: target.hwnd, maxNodes: 400 }, { timeoutMs: 90_000 });
  return { label, nodes: out.nodes, engine: out.mode ?? '' };
};
const sig = (r) => r.nodes.filter((n) => n.name !== '').map((n) => `${n.controlType}|${n.name}`).sort();
const rects = (r) => new Map(r.nodes.filter((n) => n.name !== '').map((n) => [`${n.controlType}|${n.name}`, `${n.x},${n.y} ${n.width}x${n.height}`]));

const compare = (a, b) => {
  const sa = new Set(sig(a));
  const sb = new Set(sig(b));
  const onlyA = [...sa].filter((x) => !sb.has(x));
  const onlyB = [...sb].filter((x) => !sa.has(x));
  const ra = rects(a);
  const rb = rects(b);
  let rectDiff = 0;
  let compared = 0;
  for (const [key, value] of ra) {
    if (!rb.has(key)) continue;
    compared += 1;
    if (rb.get(key) !== value) rectDiff += 1;
  }
  return { onlyA, onlyB, rectDiff, compared, countA: a.nodes.length, countB: b.nodes.length };
};

const show = (label, c) => {
  console.log(`\n${label}`);
  console.log(`  nodes: ${c.countA} vs ${c.countB}   rects differ: ${c.rectDiff}/${c.compared}`);
  if (c.onlyA.length > 0) console.log(`  only in first  (${c.onlyA.length}): ${c.onlyA.slice(0, 3).join(' ; ')}`);
  if (c.onlyB.length > 0) console.log(`  only in second (${c.onlyB.length}): ${c.onlyB.slice(0, 3).join(' ; ')}`);
};

// Each engine against itself.
const com1 = await read(com, 'com#1');
const com2 = await read(com, 'com#2');
show('COM vs COM (same engine, two reads)', compare(com1, com2));

const mgd1 = await read(managed, 'mgd#1');
const mgd2 = await read(managed, 'mgd#2');
show('managed vs managed (same engine, two reads)', compare(mgd1, mgd2));

show('COM vs managed (the comparison the suite makes)', compare(com1, mgd1));

// And the same on Notepad, where it is known to agree.
const np = (listed.windows ?? []).find((w) => /notepad/i.test(w.process));
if (np) {
  const c1 = await com.request('uitree', { hwnd: np.hwnd, maxNodes: 400 }, { timeoutMs: 60_000 });
  const c2 = await com.request('uitree', { hwnd: np.hwnd, maxNodes: 400 }, { timeoutMs: 60_000 });
  const m1 = await managed.request('uitree', { hwnd: np.hwnd, maxNodes: 400 }, { timeoutMs: 60_000 });
  console.log(`\n[control] Notepad: com ${c1.nodes.length} / com ${c2.nodes.length} / managed ${m1.nodes.length}`);
  show('  COM vs managed on Notepad', compare({ nodes: c1.nodes }, { nodes: m1.nodes }));
}

await com.request('shutdown', {});
await managed.request('shutdown', {});
com.dispose();
managed.dispose();
setTimeout(() => process.exit(0), 100).unref();
