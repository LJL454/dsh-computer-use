/**
 * The interface inventory (8.txt §2, P0): one row per tool this plugin registers, with what it
 * costs to advertise.
 *
 * The schema budget answers "how big is the family"; this answers "what is in it" — which tool
 * carries which parameters, how much of the budget each one owns, and which fields are the
 * optional ones worth reviewing when the budget has to come down. It runs against *any* plugin
 * directory, so two versions can be compared by pointing it at each in turn (the baseline copy
 * under `dist/dsh-computer-use-1.19.1` included).
 *
 * The token estimate is the same one `tools/schema-budget.mjs` uses: characters / 4 over the
 * serialized declaration. Same rule, so the numbers line up.
 *
 *   node tools/interface-inventory.mjs                       # the plugin in this directory
 *   node tools/interface-inventory.mjs --plugin <dir>        # another copy
 *   node tools/interface-inventory.mjs --markdown            # a table for the baseline document
 */
import { registerHooks } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const pluginDir = resolve(args.includes('--plugin') ? args[args.indexOf('--plugin') + 1] : join(HERE, '..'));
const asMarkdown = args.includes('--markdown');
const asJson = args.includes('--json');

if (!existsSync(join(pluginDir, 'index.js'))) {
  console.error(`no index.js in ${pluginDir}`);
  process.exit(1);
}

const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-inventory-'));
const toolsStub = join(shimDir, 'dsh-tools-stub.mjs');
writeFileSync(toolsStub, 'export const defineTool = (definition) => definition;\n');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: pathToFileURL(toolsStub).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const rows = [];
try {
  const plugin = await import(pathToFileURL(join(pluginDir, 'index.js')).href);
  const order = [];
  const services = { webServer: { register: () => () => {} } };
  const ctx = {
    tools: { register: (definition) => { order.push(definition); return () => {}; } },
    webServer: services.webServer,
    on: () => {},
    effect: (fn) => { const disposer = fn(); return () => { if (typeof disposer === 'function') disposer(); }; },
    inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx); return () => {}; },
    get: (name) => services[name],
    logger: { info: () => {}, warn: () => {} },
  };
  plugin.apply(ctx, { defaultEnabled: true });

  for (const definition of order) {
    const parameters = definition.parameters ?? {};
    // The plugin declares parameters as a plain name -> spec map; a JSON-Schema `properties`
    // wrapper is also accepted, so the same script can read a copy that uses either shape.
    const properties = parameters.properties ?? parameters;
    const specs = Object.fromEntries(Object.entries(properties).filter(([, spec]) => spec !== null && typeof spec === 'object' && ('type' in spec || 'enum' in spec)));
    const required = Object.entries(specs).filter(([, spec]) => spec?.required === true).map(([name]) => name);
    const optional = Object.keys(specs).filter((name) => !required.includes(name));
    const outputProperties = Object.keys(definition.output?.schema?.properties ?? {});
    const declared = JSON.stringify({
      description: definition.description ?? '',
      parameters: definition.parameters ?? {},
      output: definition.output?.schema ?? {},
    });
    rows.push({
      tool: definition.name,
      params: Object.keys(properties).length,
      required: required.length,
      optional,
      outputFields: outputProperties.length,
      chars: declared.length,
      tokens: Math.ceil(declared.length / 4),
      descriptionChars: String(definition.description ?? '').length,
    });
  }
} catch (error) {
  console.error(`could not mount ${pluginDir}: ${error?.message ?? error}`);
  process.exitCode = 1;
} finally {
  try { rmSync(shimDir, { recursive: true, force: true }); } catch { /* best effort */ }
}

if (rows.length > 0) {
  const total = rows.reduce((sum, row) => sum + row.tokens, 0);
  const descriptionTokens = rows.reduce((sum, row) => sum + Math.ceil(row.descriptionChars / 4), 0);
  if (asJson) {
    console.log(JSON.stringify({ plugin: pluginDir, tools: rows, familyTokens: total, descriptionTokens }, null, 2));
  } else if (asMarkdown) {
    const name = JSON.parse(String(await import('node:fs').then((fs) => fs.readFileSync(join(pluginDir, 'package.json'), 'utf8')))).name;
    const version = JSON.parse(String(await import('node:fs').then((fs) => fs.readFileSync(join(pluginDir, 'package.json'), 'utf8')))).version;
    const lines = [];
    lines.push(`# 接口清单（${name} ${version}）`);
    lines.push('');
    lines.push(`生成方式：\`node tools/interface-inventory.mjs --plugin <此目录> --markdown\`。token 估算与 \`tools/schema-budget.mjs\` 同一规则（序列化字符数 ÷ 4），但**覆盖范围不同**：本清单把工具描述与输出 schema 都算进来（回答"钱花在哪个工具上"），预算量具算的是一次请求的家族注入成本，两个总量不可互相换算。`);
    lines.push('');
    lines.push(`合计：**${rows.length} 个工具、≈${total} token/请求**（其中工具描述 ≈${descriptionTokens}）。`);
    lines.push('');
    lines.push('| 工具 | 参数 | 必填 | 输出字段 | 声明 token | 描述 token | 可选参数 |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | --- |');
    for (const row of rows) {
      lines.push(`| \`${row.tool}\` | ${row.params} | ${row.required} | ${row.outputFields} | ${row.tokens} | ${Math.ceil(row.descriptionChars / 4)} | ${row.optional.join(', ')} |`);
    }
    lines.push('');
    console.log(lines.join('\n'));
  } else {
    console.log(`plugin: ${pluginDir}`);
    console.log(`${'tool'.padEnd(22)}${'params'.padStart(7)}${'req'.padStart(5)}${'out'.padStart(5)}${'tok'.padStart(6)}  optional`);
    for (const row of rows) {
      console.log(`${row.tool.padEnd(22)}${String(row.params).padStart(7)}${String(row.required).padStart(5)}${String(row.outputFields).padStart(5)}${String(row.tokens).padStart(6)}  ${row.optional.join(',')}`);
    }
    console.log(`${'TOTAL'.padEnd(22)}${''.padStart(7)}${''.padStart(5)}${''.padStart(5)}${String(total).padStart(6)}  (${rows.length} tools, description ≈${descriptionTokens})`);
  }
}

// Mounting the plugin opens paths that are meant to stay open (the backend, the browser
// channel): this is a one-shot report, so it leaves once it has printed.
setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref();
