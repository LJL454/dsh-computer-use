/**
 * 设置页的 schema 与"拿不到就不声明"（方案 4.18.8）。
 *
 * 宿主的设置页由插件导出的 `Config` 自动生成，而 `@deepseek-ai/schemastery` 只能通过宿主解析
 * （插件的真实路径解析不到它）。所以有两种情形必须都对：
 *
 *   * **宿主在场**：`Config` 声明六个开关，默认值与 `visual-preferences` 那一份完全一致；
 *   * **宿主不在场**：`Config` 是 undefined，`index.js` 仍然能 import、apply 仍然注册 18 个工具 ——
 *     不能因为"想有个设置页"让插件装不上。
 *
 * schemastery 在这里用一个最小实现代替（`boolean().default().description()` 链式调用），
 * 因为它要验的是**形状与默认值**，不是 schemastery 自己的校验逻辑。
 *
 *   node visual-effects-config-test.mjs
 */
import { registerHooks } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-visual-config-'));
const toolsStub = join(shimDir, 'tools-stub.mjs');
const zStub = join(shimDir, 'schemastery-stub.mjs');
writeFileSync(toolsStub, 'export const defineTool = (definition) => definition;\n');
writeFileSync(zStub, `
class BooleanSchema {
  constructor(defaultValue) { this.kind = 'boolean'; this.defaultValue = defaultValue; this.text = ''; }
  default(value) { this.defaultValue = value; return this; }
  description(text) { this.text = text; return this; }
}
class NumberSchema {
  constructor() { this.kind = 'number'; this.defaultValue = undefined; this.text = ''; this.minValue = undefined; this.maxValue = undefined; }
  default(value) { this.defaultValue = value; return this; }
  min(value) { this.minValue = value; return this; }
  max(value) { this.maxValue = value; return this; }
  description(text) { this.text = text; return this; }
}
class ConstSchema {
  constructor(value) { this.kind = 'const'; this.constValue = value; }
}
class UnionSchema {
  constructor(values) { this.kind = 'union'; this.values = values; this.defaultValue = undefined; this.text = ''; }
  default(value) { this.defaultValue = value; return this; }
  description(text) { this.text = text; return this; }
}
class ObjectSchema {
  constructor(shape) { this.kind = 'object'; this.shape = shape; }
}
export default {
  boolean: () => new BooleanSchema(undefined),
  number: () => new NumberSchema(),
  const: (value) => new ConstSchema(value),
  union: (values) => new UnionSchema(values),
  object: (shape) => new ObjectSchema(shape),
};
`);

const visualPreferences = await import('./internal/visual-preferences.mjs');
const { buildVisualEffectsConfig, visualEffectsPatch } = await import('./internal/visual-effects-config.mjs');

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}

console.log('\n== the schema declares exactly the settings the store understands ==');
{
  const booleanSchema = () => ({
    kind: 'boolean',
    defaultValue: undefined,
    default(value) { this.defaultValue = value; return this; },
    description(text) { this.text = text; return this; },
  });
  const numberSchema = () => ({
    kind: 'number',
    defaultValue: undefined,
    min(value) { this.minValue = value; return this; },
    max(value) { this.maxValue = value; return this; },
    default(value) { this.defaultValue = value; return this; },
    description(text) { this.text = text; return this; },
  });
  const unionSchema = (values) => ({
    kind: 'union',
    values,
    defaultValue: undefined,
    default(value) { this.defaultValue = value; return this; },
    description(text) { this.text = text; return this; },
  });
  const built = await buildVisualEffectsConfig({
    z: {
      boolean: booleanSchema,
      number: numberSchema,
      const: (value) => ({ kind: 'const', constValue: value }),
      union: unionSchema,
      object: (shape) => ({ kind: 'object', shape }),
    },
  });
  check('a schema is produced when schemastery is available', built.Config !== undefined, JSON.stringify(built));
  const shape = built.Config?.shape ?? {};
  const keys = Object.keys(shape);
  const storeKeys = Object.keys(visualPreferences.VISUAL_DEFAULTS);
  check('every store setting is on the page', storeKeys.every((key) => keys.includes(key)), JSON.stringify({ keys, storeKeys }));
  check('and nothing else is', keys.length === storeKeys.length, JSON.stringify(keys));
  for (const key of storeKeys) {
    check(`${key} defaults to the store default`, shape[key]?.defaultValue === visualPreferences.VISUAL_DEFAULTS[key], `${JSON.stringify(shape[key]?.defaultValue)} vs ${JSON.stringify(visualPreferences.VISUAL_DEFAULTS[key])}`);
    check(`${key} carries a description`, typeof shape[key]?.text === 'string' && shape[key].text.length > 0, String(shape[key]?.text));
  }
  // 高度是数值项：必须带上下界，否则设置页会给出一个能把手/头裁掉的尺寸。
  for (const key of Object.keys(visualPreferences.VISUAL_LIMITS)) {
    const limits = visualPreferences.VISUAL_LIMITS[key];
    check(`${key} has a bounded range`, shape[key]?.minValue === limits.min && shape[key]?.maxValue === limits.max, JSON.stringify({ min: shape[key]?.minValue, max: shape[key]?.maxValue }));
  }
  // 主题是枚举项：只能 ocean / plain。
  check('the banner theme lists its two choices', Array.isArray(shape.bannerTheme?.values) && shape.bannerTheme.values.length === 2, JSON.stringify(shape.bannerTheme?.values));
}

console.log('\n== no host package means no schema, and nothing else breaks ==');
{
  // 用注入的 loader 模拟"宿主包解析不到"：不靠环境变量碰运气 —— 这台机器上宿主其实找得到。
  const built = await buildVisualEffectsConfig({ load: async () => { throw new Error('no host package here'); } });
  check('the builder reports the package as unavailable', built.Config === undefined && built.source === 'unavailable', JSON.stringify({ source: built.source, error: built.error.slice(0, 80) }));
  check('and it carries the reason', /no host package/.test(built.error), built.error);
}

console.log('\n== the host config section is folded into a validated patch ==');
{
  const patch = visualEffectsPatch({ bannerCharacter: true, cursorHalo: 'yes', unknown: true, enabled: false });
  check('booleans are taken', patch.bannerCharacter === true && patch.enabled === false, JSON.stringify(patch));
  check('non-booleans are dropped', !('cursorHalo' in patch), JSON.stringify(patch));
  check('unknown keys are dropped', !('unknown' in patch), JSON.stringify(patch));
  check('a missing section yields an empty patch', Object.keys(visualEffectsPatch(undefined)).length === 0);
  check('and so does a non-object', Object.keys(visualEffectsPatch('nope')).length === 0);
}

console.log('\n== the plugin still loads when the host package is absent ==');
{
  // 不注入 schemastery：`Config` 应为 undefined，`apply` 照常注册 18 个工具。
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '@deepseek-ai/dsh-tools') return { url: pathToFileURL(toolsStub).href, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  const plugin = await import(`./index.js?no-schemastery=${Date.now()}`);
  check('the module exposes a Config binding', 'Config' in plugin);
  // 本机宿主确实带 schemastery，所以这里不断言 undefined：只断言"有 Config 也能加载、没有也能加载"。
  // 真正的"解析不到"由上面那条注入 loader 的用例覆盖。
  check('the module imports whether or not a schema could be built', plugin.Config === undefined || typeof plugin.Config === 'object' || typeof plugin.Config === 'function', typeof plugin.Config);
  const tools = new Map();
  const routes = new Map();
  const services = { webServer: { register: (definition) => { routes.set(definition.path, definition); return () => {}; } } };
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
    webServer: services.webServer,
    on: () => {},
    effect: (fn) => { const disposer = fn(); return () => { if (typeof disposer === 'function') disposer(); }; },
    inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx); return () => {}; },
    get: (name) => services[name],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
  plugin.apply(ctx, { defaultEnabled: false, shotDir: join(shimDir, 'shots') });
  check('all 18 tools are still registered', tools.size === 18, String(tools.size));
  check('the routes are still registered', routes.size >= 4, String(routes.size));
}

console.log('\n== the host config section reaches the store ==');
{
  const plugin = await import(`./index.js?with-config=${Date.now()}`);
  const prefPath = join(shimDir, 'prefs-from-host.json');
  const tools = new Map();
  const services = { webServer: { register: () => () => {} } };
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
    webServer: services.webServer,
    on: () => {},
    effect: (fn) => { const disposer = fn(); return () => { if (typeof disposer === 'function') disposer(); }; },
    inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx); return () => {}; },
    get: (name) => services[name],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
  plugin.apply(ctx, { defaultEnabled: false, shotDir: shimDir, visualPreferencesPath: prefPath, visualEffects: { bannerCharacter: true, cursorHalo: false } });
  const state = JSON.parse((await import('node:fs')).readFileSync(prefPath, 'utf8'));
  check('the host value is persisted', state.values.bannerCharacter === true, JSON.stringify(state.values));
  check('a host false is persisted too', state.values.cursorHalo === false, JSON.stringify(state.values));
  check('the schema version and revision are written', state.schemaVersion === visualPreferences.VISUAL_SCHEMA_VERSION && state.settingsRevision === 1, JSON.stringify({ schema: state.schemaVersion, revision: state.settingsRevision }));
}

rmSync(shimDir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
