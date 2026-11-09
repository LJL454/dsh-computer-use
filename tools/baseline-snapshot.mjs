/**
 * PR01 —— 冻结基线。
 *
 * 方案第 4.11 节把"冻结压缩包哈希、工具/config/exports/结果样本；建立输入契约入口"列为第一项
 * 变更，理由是后面每一条修复都要能回答"相对什么变了"。这个脚本生成那份基线：
 *
 *   - 运行时代码树中每个文件的 SHA256 与字节数（node_modules、快照自身除外）；
 *   - 插件注册出的工具清单：名称、参数键、输出 schema 的顶层键、是否必填；
 *   - package.json 的 exports / engines / dsh 兼容声明；
 *   - 本脚本自身的版本与生成时间。
 *
 * 输出写到 baseline/inventory-<version>.json。第二次生成时用 --check 只比较、不写盘：
 * 退出码 1 表示与已冻结的基线不一致，这就是"旧调用样本和构建检查可重复"的判据。
 *
 *   node tools/baseline-snapshot.mjs            # 写 baseline/inventory-1.40.3.json
 *   node tools/baseline-snapshot.mjs --check    # 只比较
 */
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const args = new Set(process.argv.slice(2));
const CHECK = args.has('--check');

/* ------------------------------------------------------------------ modules */

const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-baseline-'));
const toolsStub = join(shimDir, 'dsh-tools-stub.mjs');
writeFileSync(toolsStub, 'export const defineTool = (definition) => definition;\nexport const toolDefinitions = [];\n');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: pathToFileURL(toolsStub).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
/**
 * 快照名。默认是版本号，也就是"上一批发行的原样"；每批改动后可以用 `--name 1.40.3-pr04`
 * 冻结一个新的参照点，而不覆盖最初那份基线 —— 否则"相对什么变了"就随每次生成一起漂走。
 */
const nameIndex = process.argv.indexOf('--name');
const SNAPSHOT_NAME = nameIndex > 0 && process.argv[nameIndex + 1] !== undefined ? String(process.argv[nameIndex + 1]) : packageJson.version;

/* -------------------------------------------------------------------- files */

/** Directories that are built artifacts, caches or the snapshot's own home. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'baseline', 'dist', 'build']);
const SKIP_FILES = new Set(['local-dsh-computer-use-1.40.3.tgz', '.cache-baseline-schema.json']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (entry.isFile()) {
      if (SKIP_FILES.has(entry.name)) continue;
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const files = walk(ROOT)
  .map((path) => {
    const bytes = readFileSync(path);
    return {
      path: relative(ROOT, path).split(sep).join('/'),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  })
  .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

/* -------------------------------------------------------------------- tools */

/** Load the plugin entry with a stub host and list what it registers. */
async function toolInventory() {
  const plugin = await import(pathToFileURL(join(ROOT, 'index.js')).href);
  const tools = new Map();
  const services = { webServer: { register: () => () => {} } };
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
    webServer: services.webServer,
    on: () => {},
    effect: (fn) => { const disposer = fn(); return () => { if (typeof disposer === 'function') disposer(); }; },
    inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx); return () => {}; },
    get: (name) => services[name],
    logger: { info: () => {}, warn: () => {} },
  };
  plugin.apply(ctx, { defaultEnabled: true });
  const inventory = {};
  for (const name of [...tools.keys()].sort()) {
    const definition = tools.get(name);
    const parameters = definition.parameters ?? {};
    inventory[name] = {
      parameters: Object.fromEntries(Object.entries(parameters).map(([key, spec]) => [key, {
        type: String(spec?.type ?? ''),
        required: spec?.required === true,
        // Step-level objects carry their own closed property bag; keeping the key list is what
        // lets a later change prove it did not silently drop a field a handler consumes.
        properties: spec?.properties === undefined ? null : Object.keys(spec.properties).sort(),
        additionalProperties: spec?.additionalProperties === undefined ? null : spec.additionalProperties === true,
      }])),
      outputKeys: Object.keys(definition.output?.schema?.properties ?? {}).sort(),
      outputClosed: definition.output?.schema?.additionalProperties === false,
    };
  }
  return inventory;
}

const tools = await toolInventory();
rmSync(shimDir, { recursive: true, force: true });

const snapshot = {
  schema: 1,
  generatedBy: 'tools/baseline-snapshot.mjs',
  name: packageJson.name,
  version: packageJson.version,
  package: {
    exports: packageJson.exports,
    engines: packageJson.engines,
    files: packageJson.files,
    compatibility: packageJson.dsh?.compatibility ?? null,
  },
  tools,
  files,
};

const target = join(ROOT, 'baseline', `inventory-${SNAPSHOT_NAME}.json`);
const text = `${JSON.stringify(snapshot, null, 2)}\n`;

if (CHECK) {
  if (!existsSync(target)) {
    console.error(`no frozen baseline at ${relative(ROOT, target)}`);
    process.exit(1);
  }
  const frozen = JSON.parse(readFileSync(target, 'utf8'));
  const drift = [];
  const before = new Map(frozen.files.map((file) => [file.path, file]));
  const after = new Map(files.map((file) => [file.path, file]));
  for (const [path, file] of after) {
    const was = before.get(path);
    if (was === undefined) drift.push(`+ ${path}`);
    else if (was.sha256 !== file.sha256) drift.push(`~ ${path} (${was.bytes} -> ${file.bytes} bytes)`);
  }
  for (const path of before.keys()) if (!after.has(path)) drift.push(`- ${path}`);
  if (JSON.stringify(frozen.tools) !== JSON.stringify(tools)) drift.push('tools: the registered tool/parameter/output surface changed');
  if (JSON.stringify(frozen.package) !== JSON.stringify(snapshot.package)) drift.push('package: exports/engines/compatibility changed');
  if (drift.length === 0) {
    console.log(`baseline ${packageJson.version}: ${files.length} file(s), ${Object.keys(tools).length} tool(s) — unchanged`);
    process.exit(0);
  }
  console.error(`baseline ${packageJson.version}: ${drift.length} difference(s)`);
  for (const line of drift) console.error(`  ${line}`);
  process.exit(1);
}

writeFileSync(target, text);
console.log(`wrote ${relative(ROOT, target)}: ${files.length} file(s), ${Object.keys(tools).length} tool(s), ${text.length} bytes`);
// The plugin installs a heartbeat and a lazy backend; a snapshot tool must not wait for them
// to be collected, or the shell that piped it never sees EOF.
process.exit(0);
