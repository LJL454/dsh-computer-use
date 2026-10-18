/**
 * End-to-end check of the `config.source` the two presets now carry.
 *
 * `tests/preset-config-test.mjs` proves the YAML resolves to an absolute path that looks like a
 * runtime root. This goes one step further and asks the *real* host module:
 *
 *   1. does the resolved config pass the module's own `Config` schema, and
 *   2. does `resolvePrimaryRuntime(source)` — the exact call `load_workspace_dependencies` makes
 *      when `root` is omitted — return interpreter and library paths that exist on this machine?
 *
 * Nothing is copied: with `root` omitted the module only validates the payload in place.
 *
 *   node tests/workspace-dependencies-test.mjs
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveAppNodeModules } from './host-app.mjs';

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`);
  }
}

/**
 * Import a host package by absolute path, without touching this plugin's own resolution.
 *
 * The application's `node_modules` is *derived*, never written down — see
 * {@link ./host-app.mjs} for why a literal `C:/Users/<name>/...` must not appear in a shipped file.
 * @param specifier - the package name.
 * @param entry - its path inside the package.
 * @returns the imported module namespace.
 */
async function hostImport(specifier, entry = 'lib/index.js') {
  const relative = [...specifier.split('/'), ...entry.split('/')].join('/');
  return import(pathToFileURL(join(resolveAppNodeModules(relative), ...relative.split('/'))).href);
}

const yaml = await hostImport('js-yaml', 'index.js');
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),
  predicate: (value) => value instanceof Object && '__jsExpr' in value,
  represent: (data) => data.__jsExpr,
});
const evaluate = new Function('ctx', 'expr', `
  with (ctx) {
    return eval(expr)
  }
`);

/* ------------------------------------------------- read the patched source -- */

const patchPath = new URL('../cordis.patch.yml', import.meta.url);
const document = yaml.load(readFileSync(patchPath, 'utf8'), { schema: yaml.JSON_SCHEMA.extend(JsExpr) });

/** Every row named `@deepseek-ai/dsh-tool-workspace-dependencies`, anywhere in the tree. */
function* rows(value) {
  if (Array.isArray(value)) {
    for (const item of value) yield* rows(item);
    return;
  }
  if (!value || typeof value !== 'object' || '__jsExpr' in value) return;
  if (typeof value.name === 'string') yield value;
  for (const item of Object.values(value)) {
    if (item === null || typeof item !== 'object' || '__jsExpr' in item) continue;
    yield* rows(item);
  }
}

const sources = [...rows(document)]
  .filter((row) => row.name === '@deepseek-ai/dsh-tool-workspace-dependencies')
  .map((row) => {
    const raw = row.config?.source;
    return raw !== null && typeof raw === 'object' && '__jsExpr' in raw ? evaluate({}, raw.__jsExpr) : raw;
  });

console.log('\n== the patched source, as the preset loader would see it ==');
check('two rows contribute a source', sources.length === 2, String(sources.length));
check('both resolved to the same path', new Set(sources).size === 1, JSON.stringify(sources));
const source = sources[0];
check('it is an absolute path', typeof source === 'string' && isAbsolute(source), String(source));

/* --------------------------------------------- the host module's own schema -- */

console.log('\n== the host module accepts it ==');
const module_ = await hostImport('@deepseek-ai/dsh-tool-workspace-dependencies');

/**
 * Validate through the schema's Standard Schema interface — the same one the Loader's
 * `checkConfig` uses, and the one that produced `$.source missing required value`.
 * @param schema - a schemastery schema instance.
 * @param value - the raw config to check.
 * @returns `{ value }` or `{ issues }`.
 */
async function validate(schema, value) {
  const standard = schema['~standard'];
  if (standard === undefined || typeof standard.validate !== 'function') throw new Error('schema has no ~standard.validate');
  return standard.validate(value);
}

const empty = await validate(module_.Config, {});
check(
  'the module really requires a source',
  Array.isArray(empty.issues) && empty.issues.some((issue) => Array.isArray(issue.path) && issue.path[0] === 'source'),
  JSON.stringify(empty.issues),
);

const accepted = await validate(module_.Config, { source });
check('config { source } passes Config', accepted.issues === undefined, JSON.stringify(accepted.issues));
check('the resolved config keeps the source verbatim', accepted.value?.source === source, String(accepted.value?.source));
check('and carries no root, so nothing is installed', accepted.value?.root === undefined, JSON.stringify(accepted.value?.root));

/* -------------------------------------- the call the tool itself would make -- */

console.log('\n== resolvePrimaryRuntime(source) returns usable paths ==');
let paths = null;
try {
  paths = await module_.resolvePrimaryRuntime(source);
} catch (error) {
  check('resolvePrimaryRuntime(source) succeeds', false, String(error?.message ?? error));
}
check('resolvePrimaryRuntime(source) succeeds', paths !== null);
if (paths !== null) {
  check('python is a file', existsSync(paths.python) && statSync(paths.python).isFile(), paths.python);
  check('pythonPackages is a directory', existsSync(paths.pythonPackages) && statSync(paths.pythonPackages).isDirectory(), paths.pythonPackages);
  check('node is a file', paths.node !== undefined && existsSync(paths.node) && statSync(paths.node).isFile(), String(paths.node));
  check('nodePackages is a directory', paths.nodePackages !== undefined && existsSync(paths.nodePackages) && statSync(paths.nodePackages).isDirectory(), String(paths.nodePackages));
  check('pnpm is a file', paths.pnpm !== undefined && existsSync(paths.pnpm) && statSync(paths.pnpm).isFile(), String(paths.pnpm));
  check('pythonDistributions reports pandas', typeof paths.pythonDistributions?.pandas === 'string', JSON.stringify(paths.pythonDistributions?.pandas));
  check('pythonDistributions reports python-docx', typeof paths.pythonDistributions?.['python-docx'] === 'string', JSON.stringify(paths.pythonDistributions?.['python-docx']));
  console.log(`  INFO  python          ${paths.python}`);
  console.log(`  INFO  node            ${paths.node}`);
  console.log(`  INFO  pythonPackages  ${paths.pythonPackages}`);
}

console.log(`\n===== ${passed} passed, ${failures.length} failed =====`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
