// List the description sizes of one tool's parameters, straight from the source.
//
// Usage: node tools/schema-fields.mjs <toolName> [minChars] [--path steps.items.properties]
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [, , toolName = 'computer_actions', minChars = '0'] = process.argv;
const pathArg = process.argv.includes('--path') ? process.argv[process.argv.indexOf('--path') + 1] : 'steps.items.properties';

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
  console.error(`tool ${toolName} not found (have: ${registered.map((r) => r?.name).join(', ')})`);
  process.exit(1);
}

let node = definition.parameters;
for (const key of pathArg.split('.')) {
  if (node === undefined || node === null) break;
  if (key === 'items') node = node.items ?? node[key];
  else node = node[key] ?? node.properties?.[key];
}
if (!node || typeof node !== 'object') {
  console.error(`path ${pathArg} not found under ${toolName}`);
  process.exit(1);
}

const rows = [];
let total = 0;
for (const [name, spec] of Object.entries(node)) {
  const size = typeof spec?.description === 'string' ? spec.description.length : 0;
  total += size;
  rows.push([name, size, typeof spec?.description === 'string' ? spec.description.slice(0, 60) : '(none)']);
}
rows.sort((a, b) => b[1] - a[1]);
const threshold = Number(minChars);
console.log(`${toolName} / ${pathArg}: ${rows.length} fields, description total ${total} chars ≈ ${Math.ceil(total / 4)} token`);
for (const [name, size, preview] of rows) {
  if (size < threshold) continue;
  console.log(`  ${String(size).padStart(5)}  ${name.padEnd(22)} ${preview}`);
}
