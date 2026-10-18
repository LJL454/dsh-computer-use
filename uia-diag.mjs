/** Diagnostic: where does the UI-tree time go? */
import { PowerShellBackend } from './backend/bridge.js';

const backend = new PowerShellBackend();
await backend.start();

async function timed(label, args) {
  const t0 = performance.now();
  const r = await backend.request('uitree', args, { timeoutMs: 120_000 });
  const ms = performance.now() - t0;
  const nodes = r.nodes ?? [];
  const named = nodes.filter((n) => n.name !== '').length;
  const typed = nodes.filter((n) => n.controlType && n.controlType !== 'ControlType.Unknown').length;
  console.log(`${label.padEnd(42)} ${String(Math.round(ms)).padStart(6)} ms  nodes=${String(nodes.length).padStart(4)}  named=${String(named).padStart(4)}  typed=${String(typed).padStart(4)}  mode=${r.mode}  truncated=${r.truncated}`);
  return r;
}

console.log('--- default (maxDepth 6, maxNodes 400) ---');
for (let i = 0; i < 3; i += 1) await timed(`run ${i}`, {});
console.log('--- bounded ---');
await timed('maxDepth 2, maxNodes 50', { maxDepth: 2, maxNodes: 50 });
await timed('maxDepth 3, maxNodes 150', { maxDepth: 3, maxNodes: 150 });
await timed('maxDepth 4, maxNodes 400', { maxDepth: 4, maxNodes: 400 });
console.log('--- find mode ---');
await timed('find name~="e"', { name: 'e', maxNodes: 40 });
await timed('find controlType~="Button"', { controlType: 'Button', maxNodes: 40 });
console.log('--- pattern probing cost ---');
await timed('tree 400, patterns on', { maxDepth: 4, maxNodes: 400, patterns: true });
await timed('tree 400, patterns off', { maxDepth: 4, maxNodes: 400, patterns: false });
await timed('tree 150, patterns off', { maxDepth: 3, maxNodes: 150, patterns: false });
await timed('find 40, patterns off', { name: 'e', maxNodes: 40, patterns: false });

backend.dispose();
