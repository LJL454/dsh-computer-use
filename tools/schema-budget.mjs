// Measure the schema cost of this plugin's tools directly from the source.
//
// The session log's `request/header` measures what one session actually sent;
// this measures what the current source would send, so a wording change can be
// scored before any restart. Both use the harness's density heuristic
// (4 characters per token), so the two numbers are comparable.
//
// Usage: node tools/schema-budget.mjs [--json] [--top 12]
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const top = argv.includes('--top') ? Number(argv[argv.indexOf('--top') + 1]) : 12;

const registered = [];
const ctx = {
  logger: { info: () => {}, warn: () => {} },
  on: () => {},
  effect: () => {},
  inject: () => {},
  tools: { register: (definition) => { registered.push(definition); return { dispose() {} }; } },
};

const module = await import(pathToFileURL(join(here, '..', 'index.js')).href);
module.apply(ctx, {});

/** Walk a definition's parameter tree collecting description sizes. */
function collectDescriptions(node, path, out) {
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'description' && typeof value === 'string') {
      out.push([`${path}.description`, value.length]);
    } else {
      collectDescriptions(value, `${path}.${key}`, out);
    }
  }
}

let familyChars = 0;
let familyDescriptionChars = 0;
const rows = [];
for (const definition of registered) {
  const model = {
    name: definition.name,
    description: definition.description ?? '',
    parameters: definition.parameters ?? {},
  };
  const raw = JSON.stringify(model);
  const found = [];
  collectDescriptions(model.parameters, 'parameters', found);
  const parameterDescriptionChars = found.reduce((total, [, size]) => total + size, 0);
  familyChars += raw.length;
  familyDescriptionChars += (model.description.length + parameterDescriptionChars);
  rows.push({
    tool: definition.name,
    chars: raw.length,
    tokens: Math.ceil(raw.length / 4),
    descriptionChars: model.description.length,
    parameterDescriptionChars,
    largest: found.sort((a, b) => b[1] - a[1]).slice(0, top),
  });
}
rows.sort((a, b) => b.tokens - a.tokens);

if (asJson) {
  console.log(JSON.stringify({
    tools: rows,
    familyChars,
    familyTokens: Math.ceil(familyChars / 4),
    familyDescriptionChars,
    familyDescriptionTokens: Math.ceil(familyDescriptionChars / 4),
  }, null, 2));
} else {
  console.log(`tools=${rows.length} family_chars=${familyChars} family_tokens≈${Math.ceil(familyChars / 4)}`);
  console.log(`description prose: ${familyDescriptionChars} chars ≈ ${Math.ceil(familyDescriptionChars / 4)} token`);
  for (const row of rows) {
    console.log(`  ${String(row.tokens).padStart(6)} tok  ${row.chars.toString().padStart(6)} chars  ` +
      `desc=${row.descriptionChars}  paramdesc=${row.parameterDescriptionChars}  ${row.tool}`);
  }
  console.log('\nlargest description fields per tool:');
  for (const row of rows) {
    const biggest = row.largest.filter(([, size]) => size >= 150);
    if (biggest.length === 0) continue;
    console.log(`  ${row.tool}:`);
    for (const [path, size] of biggest) console.log(`    ${String(size).padStart(5)}  ${path}`);
  }
}
