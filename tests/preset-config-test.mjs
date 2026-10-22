/**
 * Regression test for the two `cordis.patch.yml` faults in DSH故障定位与修复方案.md §三/§四.2:
 *
 *   1. `preset-task-analysis` / `preset-task-document` each declare
 *      `@deepseek-ai/dsh-tool-workspace-dependencies` with no `config`, while the host's
 *      schema is `z.object({ source: z.string().min(1).required(), root: z.string().min(1) })`.
 *      The preset loader validates child config before activation, so the row fails with
 *      `$.source missing required value` and the whole preset never loads.
 *
 *   2. The desktop preset mounted a second `@local/dsh-computer-use`. Every `apply()` builds
 *      its own session grant table / visibility manager / backend state and registers the same
 *      `/computer-use/*` routes; `dsh-host-webserver`'s `register()` throws on a duplicate path.
 *
 * This test does not boot a profile. It parses the bundle patch with the *same* YAML dialect
 * the host uses (`JSON_SCHEMA` extended with the `!!js` scalar tag), evaluates every `!!js`
 * node with the loader's own `new Function('ctx','expr','with (ctx) { return eval(expr) }')`
 * semantics, and then checks the two properties the fix promises:
 *
 *   * every workspace-dependencies row resolves to a non-empty **absolute** path that really
 *     contains `runtime.json` and `dependencies`;
 *   * exactly one row mounts `@local/dsh-computer-use`, and it is the global one.
 *
 *   node tests/preset-config-test.mjs
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { importFromApp } from './host-app.mjs';

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

/* ------------------------------------------------------ host YAML dialect -- */

/**
 * Locate the host's `js-yaml`. The patch dialect is defined by the host (`dsh-app-boot`),
 * so the test must parse with the host's own parser rather than a guessed one.
 *
 * The location is derived, never written down — see {@link ./host-app.mjs} for why.
 * @returns the `js-yaml` module namespace.
 */
async function loadHostYaml() {
  return importFromApp('js-yaml/index.js');
}

const yaml = await loadHostYaml();

/** The `!!js` scalar, exactly as `dsh-app-boot` declares it. */
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),
  predicate: (value) => value instanceof Object && '__jsExpr' in value,
  represent: (data) => data.__jsExpr,
});
const dialect = yaml.JSON_SCHEMA.extend(JsExpr);

/** The loader's own evaluator (`@deepseek-ai/cordis-plugin-loader` lib/index.js). */
const evaluate = new Function('ctx', 'expr', `
  with (ctx) {
    return eval(expr)
  }
`);

/* ------------------------------------------------------------------- parse -- */

const patchUrl = new URL('../presets/cordis.patch.yml', import.meta.url);
const corePatchUrl = new URL('../cordis.patch.yml', import.meta.url);
const patchPath = patchUrl.pathname.replace(/^\/([A-Za-z]:)/, '$1');
const corePatchPath = corePatchUrl.pathname.replace(/^\/([A-Za-z]:)/, '$1');
const text = readFileSync(patchUrl, 'utf8');
const coreText = readFileSync(corePatchUrl, 'utf8');

console.log('\n== cordis.patch.yml parses in the host dialect ==');
let document = null;
try {
  document = yaml.load(text, { schema: dialect });
  check('presets/cordis.patch.yml parses with JSON_SCHEMA + !!js', Array.isArray(document), typeof document);
} catch (error) {
  check('presets/cordis.patch.yml parses with JSON_SCHEMA + !!js', false, String(error?.message ?? error));
}
let coreDocument = null;
try {
  coreDocument = yaml.load(coreText, { schema: dialect });
  check('cordis.patch.yml parses with JSON_SCHEMA + !!js', Array.isArray(coreDocument), typeof coreDocument);
} catch (error) {
  check('cordis.patch.yml parses with JSON_SCHEMA + !!js', false, String(error?.message ?? error));
}
if (document === null || coreDocument === null) {
  console.log(`\n===== ${passed} passed, ${failures.length + 1} failed =====`);
  process.exitCode = 1;
  throw new Error('cannot continue without a parsed patch');
}

/* ------------------------------------------------------------- walk rows -- */

/** Every plugin row in the file, at any nesting depth, with the path that owns it. */
function* rows(value, path = '$') {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) yield* rows(item, `${path}[${index}]`);
    return;
  }
  if (!value || typeof value !== 'object' || '__jsExpr' in value) return;
  if (typeof value.name === 'string') yield { row: value, path };
  // Walk *every* container, not a guessed list of keys: the patch dialect nests plugin rows
  // under `insert`, `plugins`, `config`, and (for groups) `config` as an array.
  for (const [key, item] of Object.entries(value)) {
    if (item === null || typeof item !== 'object' || '__jsExpr' in item) continue;
    yield* rows(item, `${path}.${key}`);
  }
}

const all = [...rows(document)];
const coreAll = [...rows(coreDocument)];

console.log('\n== §四.2 the duplicate mount is gone ==');
const mounts = coreAll.filter((entry) => entry.row.name === '@local/dsh-computer-use');
check('core bundle has exactly one @local/dsh-computer-use row', mounts.length === 1, `${mounts.length}: ${mounts.map((m) => m.path).join(', ')}`);
check(
  'and it is the global row, not a preset child',
  mounts.length === 1 && !mounts[0].path.includes('.plugins['),
  mounts[0]?.path,
);
check(
  'the optional preset bundle mounts no copy at all',
  all.filter((entry) => entry.row.name === '@local/dsh-computer-use').length === 0,
  String(all.filter((entry) => entry.row.name === '@local/dsh-computer-use').length),
);
check(
  'the core bundle carries no task presets (1.40.0 split)',
  coreAll.filter((entry) => entry.row.name === '@deepseek-ai/dsh-agent-preset').length === 0,
  String(coreAll.filter((entry) => entry.row.name === '@deepseek-ai/dsh-agent-preset').length),
);
const globalRow = mounts[0]?.row;
check('the global row keeps its tokenGuard config', globalRow?.config?.tokenGuard?.enabled === true);
check('the global row keeps its appLaunch config', globalRow?.config?.appLaunch?.enabled === true);
check('the global row keeps defaultEnabled: false', globalRow?.config?.defaultEnabled === false);
try {
  const presetsManifest = JSON.parse(readFileSync(new URL('../presets/package.json', import.meta.url), 'utf8'));
  check('the optional preset bundle declares its own dsh.bundle patch', presetsManifest?.dsh?.bundle?.patch === './cordis.patch.yml', JSON.stringify(presetsManifest?.dsh));
  check('the optional preset bundle keeps its own version', presetsManifest?.version === JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version, `${presetsManifest?.version}`);
} catch (error) {
  check('the optional preset bundle has a readable manifest', false, String(error?.message ?? error));
}

console.log('\n== §三 the workspace-dependencies rows carry a real source ==');
const dependencyRows = all.filter((entry) => entry.row.name === '@deepseek-ai/dsh-tool-workspace-dependencies');
check('both presets declare the tool', dependencyRows.length === 2, String(dependencyRows.length));

const presetIds = new Set(['task-analysis', 'task-document']);
const owningPreset = (path) => path.match(/\.plugins\[\d+\]/) === null ? null : path;
check(
  'they live in two different presets',
  new Set(dependencyRows.map((entry) => owningPreset(entry.path))).size === dependencyRows.length,
);

for (const entry of dependencyRows) {
  const config = entry.row.config;
  const label = entry.row.id ?? entry.path;
  check(`${label}: declares a config`, config !== undefined && typeof config === 'object', JSON.stringify(config));
  if (config === undefined) continue;
  const raw = config.source;
  check(`${label}: config.source is a !!js expression or a literal string`, typeof raw === 'string' || (raw && typeof raw === 'object' && '__jsExpr' in raw), JSON.stringify(raw));

  // Evaluate exactly the way the loader does, then check the *resolved* value.
  const resolved = raw && typeof raw === 'object' && '__jsExpr' in raw ? evaluate({}, raw.__jsExpr) : raw;
  check(`${label}: resolves to a non-empty string`, typeof resolved === 'string' && resolved !== '', JSON.stringify(resolved));
  if (typeof resolved !== 'string' || resolved === '') continue;
  check(`${label}: is an absolute path`, isAbsolute(resolved), resolved);
  check(`${label}: the directory exists`, existsSync(resolved) && statSync(resolved).isDirectory(), resolved);
  check(`${label}: contains runtime.json`, existsSync(join(resolved, 'runtime.json')), resolved);
  check(`${label}: contains dependencies/`, existsSync(join(resolved, 'dependencies')), resolved);
  check(`${label}: omits the optional root`, config.root === undefined, JSON.stringify(config.root));
}

console.log('\n== the three presets still exist ==');
const presets = all.filter((entry) => entry.row.name === '@deepseek-ai/dsh-agent-preset');
check('three preset rows', presets.length === 3, String(presets.length));
check(
  'ids are task-desktop / task-analysis / task-document',
  JSON.stringify(presets.map((entry) => entry.row.config?.id)) === JSON.stringify(['task-desktop', 'task-analysis', 'task-document']),
  JSON.stringify(presets.map((entry) => entry.row.config?.id)),
);

console.log('\n== and each preset still carries the tools it is supposed to ==');
// §七.2 item 5: "预设能加载" is not the same claim as "预设还是完整的". A fix that quietly dropped a
// row would load fine, so each preset's plugin list is pinned here.
// The compaction pair lives *inside* the `cordis:group` row's own `config` list, so a preset's
// effective plugin list is the declared rows plus whatever each group row carries.
const toolsOf = (preset) => {
  const names = [];
  for (const row of preset.row.config?.plugins ?? []) {
    if (typeof row.name === 'string') names.push(row.name);
    for (const child of Array.isArray(row.config) ? row.config : []) {
      if (typeof child?.name === 'string') names.push(child.name);
    }
  }
  return names;
};
const byId = new Map(presets.map((entry) => [entry.row.config?.id, entry]));
const expectListed = (id, required) => {
  const names = toolsOf(byId.get(id));
  const missing = required.filter((name) => !names.includes(name));
  check(`${id}: keeps ${required.length} required plugins`, missing.length === 0, `missing ${JSON.stringify(missing)}`);
  return names;
};
const common = [
  '@deepseek-ai/dsh-persona',
  '@deepseek-ai/dsh-agent-instructions',
  '@deepseek-ai/dsh-tool-pwsh',
  '@deepseek-ai/dsh-tool-fs',
  '@deepseek-ai/dsh-tool-ask-user',
  '@deepseek-ai/dsh-tool-todo',
  '@deepseek-ai/dsh-tool-present',
  '@deepseek-ai/dsh-compaction-basic',
  '@deepseek-ai/dsh-compaction-tool-result-pruner',
];
expectListed('task-desktop', common);
expectListed('task-analysis', [...common, '@deepseek-ai/dsh-tool-fs-search', '@deepseek-ai/dsh-tool-jobs', '@deepseek-ai/dsh-tool-workspace-dependencies']);
expectListed('task-document', [...common, '@deepseek-ai/dsh-skill-filesystem', '@deepseek-ai/dsh-tool-skill', '@deepseek-ai/dsh-tool-workspace-dependencies']);

check(
  'the desktop preset is the only one that must NOT carry the computer-use package',
  !toolsOf(byId.get('task-desktop')).includes('@local/dsh-computer-use')
    && !toolsOf(byId.get('task-analysis')).includes('@local/dsh-computer-use')
    && !toolsOf(byId.get('task-document')).includes('@local/dsh-computer-use'),
);
check(
  'task-desktop keeps its compaction isolate block',
  byId.get('task-desktop').row.config?.plugins?.some((row) => row.name === 'cordis:group' && row.isolate?.compaction === true) === true,
);

console.log(`\n===== ${passed} passed, ${failures.length} failed =====`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
