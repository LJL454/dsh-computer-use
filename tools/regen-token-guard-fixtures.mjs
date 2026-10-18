/**
 * Regenerate tests/token-guard/fixtures/*.txt as synthetic samples.
 *
 * Why: the originals were real `pwsh` results captured from live sessions — they carried the
 * operator's user name, home paths, a local IP, provider/model identifiers, and raw session
 * logs with the operator's own prompts. Nothing in the summary tests needs that: every
 * assertion is structural (budget compliance, marker survival, the body being a real prefix).
 *
 * So each fixture is replaced by output of the same shape and scale, produced here, containing
 * nothing that came off a real machine.
 *
 * Run:  node tools/regen-token-guard-fixtures.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, '..', 'tests', 'token-guard', 'fixtures');

/** Target character counts, matched to the originals so the size-based branches stay covered. */
const SPECS = [
  { name: 'pwsh-1-13-4906B.txt', target: 4900, kind: 'listing', first: '--- module listing ---' },
  { name: 'pwsh-1-22-3615B.txt', target: 3600, kind: 'listing', first: '--- dependency scan ---' },
  { name: 'pwsh-1-23-5451B.txt', target: 5450, kind: 'listing', first: '--- manifest dump ---' },
  { name: 'pwsh-2-11-7097B.txt', target: 7100, kind: 'build', first: '--- build transcript ---' },
  { name: 'pwsh-2-5-6193B.txt', target: 6200, kind: 'env', first: '=== ALL environment variables in this shell ===' },
  { name: 'pwsh-5-4-34429B.txt', target: 34400, kind: 'chatty', first: '--- soak transcript ---' },
  { name: 'pwsh-7-11-18617B.txt', target: 18600, kind: 'journal', first: 'records: 654' },
  { name: 'pwsh-7-15-5761B.txt', target: 5760, kind: 'listing', first: '--- process snapshot ---' },
  { name: 'pwsh-7-3-5962B.txt', target: 5960, kind: 'tree', first: '--- sessions tree ---' },
  { name: 'pwsh-9-3-6237B.txt', target: 6230, kind: 'journal', first: '--- journal replay ---' },
];

const pad = (n, w = 4) => String(n).padStart(w, '0');

/** A plausible-looking path that belongs to nobody. */
const FAKE = {
  home: 'C:\\Users\\example',
  work: 'C:\\work',
  tmp: 'C:\\Users\\example\\AppData\\Local\\Temp',
};

const body = {
  listing: (i) => `  entry-${pad(i)}  ${(11 + (i % 40)).toString().padStart(3)} KB  modified 2026-01-${pad((i % 28) + 1)}  detail row ${i}`,
  build: (i) => `[${pad(i)}/${'1200'}] compiling unit-${pad(i)} :: ${'ok'.padEnd(3)} ${(8 + (i % 90))} ms`,
  env: (i) => {
    const names = ['PATH', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'SYSTEMROOT', 'USERPROFILE', 'COMPUTERNAME', 'PROCESSOR_ARCHITECTURE'];
    const name = `${names[i % names.length]}_${pad(i)}`;
    const value = i % 3 === 0 ? `${FAKE.home}\\AppData\\Roaming\\tool-${pad(i)}` : `value-${pad(i)}`;
    return `${name}=${value}`;
  },
  chatty: (i) => `progress ${pad(i)} :: ${'x'.repeat(52)}`,
  journal: (i) => `[event/${i % 5 === 0 ? 'notice' : 'progress'}] seq=${i + 1} t=00:${pad(i % 60, 2)}:${pad((i * 7) % 60, 2)}.${pad((i * 13) % 1000, 3)} ${JSON.stringify({ index: i, scope: 'run', payload: `record ${i}` })}`,
  tree: (i) => `${'  '.repeat(i % 4)}|-- branch-${pad(i)}${i % 6 === 0 ? '\\' : '/'} ${i % 6 === 0 ? `leaf-${pad(i)}.json` : ''}`,
};

function build(kind, target, first) {
  const lines = [first, ''];
  let bytes = lines.join('\n').length;
  let i = 0;
  while (bytes < target) {
    const line = body[kind](i);
    lines.push(line);
    bytes += line.length + 1;
    if (i % 11 === 10) {
      lines.push('');
      bytes += 1;
    }
    i += 1;
  }
  return lines.join('\n');
}

let total = 0;
for (const spec of SPECS) {
  const text = build(spec.kind, spec.target, spec.first);
  writeFileSync(join(FIX, spec.name), text, 'utf8');
  total += Buffer.byteLength(text, 'utf8');
  console.log(`  wrote ${spec.name.padEnd(28)} ${Buffer.byteLength(text, 'utf8')} bytes`);
}
console.log(`\n${SPECS.length} fixtures regenerated, ${total} bytes total`);
