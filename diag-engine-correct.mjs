// Correct engine A/B: the bridge has no `env` option, so the variable has to be set on
// process.env immediately before each spawn (which is what engine-ab.mjs does).
import { PowerShellBackend } from './backend/bridge.js';

async function worker(engine) {
  process.env.DSH_COMPUTER_UI_ENGINE = engine;
  const backend = new PowerShellBackend({ timeoutMs: 120_000 });
  await backend.start();
  const ping = await backend.request('ping', {}, { timeoutMs: 30_000 });
  console.log(`worker for '${engine}': dpi=${ping.dpiActual}`);
  return backend;
}

const com = await worker('com');
const managed = await worker('managed');
delete process.env.DSH_COMPUTER_UI_ENGINE;

// Prove the two are really different engines: the worker reports which one it compiled.
const comHealth = await com.request('health', {}, { timeoutMs: 30_000 });
const mgdHealth = await managed.request('health', {}, { timeoutMs: 30_000 });
console.log(`health: com.engine=${comHealth.engine} (${comHealth.engineError || 'no error'})  managed.engine=${mgdHealth.engine} (${mgdHealth.engineError || 'no error'})`);

const listed = await com.request('windows', {}, { timeoutMs: 30_000 });
const target = (listed.windows ?? []).find((w) => /explorer/i.test(w.process));
if (!target) { console.log('no explorer window'); process.exit(1); }
console.log(`\ntarget: hwnd=${target.hwnd} "${target.title}" [${target.process}] ${target.width}x${target.height}`);

const hist = (nodes) => {
  const byDepth = new Map();
  for (const n of nodes) byDepth.set(n.depth, (byDepth.get(n.depth) ?? 0) + 1);
  return [...byDepth.entries()].sort((a, b) => a[0] - b[0]).map(([d, c]) => `${d}:${c}`).join('  ');
};

for (const depth of [undefined, 3, 6, 8, 10]) {
  const payload = { hwnd: target.hwnd, maxNodes: 250 };
  if (depth !== undefined) payload.maxDepth = depth;
  const c = await com.request('uitree', payload, { timeoutMs: 90_000 });
  const m = await managed.request('uitree', payload, { timeoutMs: 90_000 });
  const label = depth === undefined ? 'default ' : `depth=${String(depth).padEnd(2)}`;
  const same = c.nodes.length === m.nodes.length;
  console.log(`\n${label}  com ${String(c.nodes.length).padStart(3)} nodes   mgd ${String(m.nodes.length).padStart(3)} nodes   ${same ? 'same count' : '** DIFFERENT **'}`);
  console.log(`  com depths: ${hist(c.nodes)}`);
  console.log(`  mgd depths: ${hist(m.nodes)}`);
  if (!same) {
    const ck = new Set(c.nodes.map((n) => `${n.controlType}|${n.name}`));
    const mk = new Set(m.nodes.map((n) => `${n.controlType}|${n.name}`));
    const onlyManaged = [...mk].filter((x) => !ck.has(x));
    const onlyCom = [...ck].filter((x) => !mk.has(x));
    console.log(`  only managed (${onlyManaged.length}): ${onlyManaged.slice(0, 4).join(' ; ')}`);
    console.log(`  only com     (${onlyCom.length}): ${onlyCom.slice(0, 4).join(' ; ')}`);
  }
}

// Each engine against itself, at the depth where they disagree.
const payload6 = { hwnd: target.hwnd, maxNodes: 250, maxDepth: 6 };
const c1 = await com.request('uitree', payload6, { timeoutMs: 90_000 });
const c2 = await com.request('uitree', payload6, { timeoutMs: 90_000 });
const m1 = await managed.request('uitree', payload6, { timeoutMs: 90_000 });
const m2 = await managed.request('uitree', payload6, { timeoutMs: 90_000 });
const sig = (r) => r.nodes.map((n) => `${n.depth}|${n.controlType}|${n.name}`).join('\n');
console.log(`\nself-consistency at depth=6: com ${c1.nodes.length}/${c2.nodes.length} (${sig(c1) === sig(c2) ? 'stable' : 'UNSTABLE'}), managed ${m1.nodes.length}/${m2.nodes.length} (${sig(m1) === sig(m2) ? 'stable' : 'UNSTABLE'})`);

await com.request('shutdown', {});
await managed.request('shutdown', {});
com.dispose();
managed.dispose();
setTimeout(() => process.exit(0), 100).unref();
