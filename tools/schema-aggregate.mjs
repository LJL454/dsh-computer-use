// Aggregate a tool's description cost by subtree, to see where the prose lives.
//
// Usage: node tools/schema-aggregate.mjs <toolName> [depth]
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [, , toolName = 'computer_actions', depthArg = '3'] = process.argv;
const depth = Number(depthArg);

const registered = [];
const ctx = {
  logger: { info: () => {}, warn: () => {} },
  on: () => {}, effect: () => {}, inject: () => {},
  tools: { register: (definition) => { registered.push(definition); return { dispose() {} }; } },
};
const module = await import(pathToFileURL(join(here, '..', 'index.js')).href);
module.apply(ctx, {});

const definition = registered.find((entry) => entry?.name === toolName);
if (!definition) {
  console.error(`tool ${toolName} not found`);
  process.exit(1);
}

const totals = new Map();
let grand = 0;
function walk(node, path) {
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'description' && typeof value === 'string') {
      const bucket = path.split('.').slice(0, depth).join('.') || '(root)';
      totals.set(bucket, (totals.get(bucket) ?? 0) + value.length);
      grand += value.length;
    } else {
      walk(value, path === '' ? key : `${path}.${key}`);
    }
  }
}

walk({ description: definition.description ?? '', parameters: definition.parameters ?? {} }, '');
const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]);
console.log(`${toolName}: description prose ${grand} chars ≈ ${Math.ceil(grand / 4)} token, by subtree (depth ${depth}):`);
for (const [bucket, size] of rows) {
  console.log(`  ${String(size).padStart(6)}  ${(100 * size / grand).toFixed(1).padStart(5)}%  ${bucket}`);
}
