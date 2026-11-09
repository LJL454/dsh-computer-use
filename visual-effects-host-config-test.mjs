/**
 * O5 设置页的**真实** schema：用宿主那份 `@deepseek-ai/schemastery` 构建，而不是注入的假实现。
 *
 * 上一轮 `visual-effects-config-test.mjs` 验的是形状与默认值；这一份验的是同一段代码在**真实解析**
 * 下能不能工作：
 *
 *   * `importHostModule('@deepseek-ai/schemastery')` 能否从宿主 node_modules 找到并导入（`.cjs` 入口）；
 *   * 构建出的 `Config` 是**真的** schemastery schema —— 拿 `{}` 喂进去要得到六个默认值；
 *   * 宿主没给这一段时，`Config({})` 的结果与 `VISUAL_DEFAULTS` 逐项相等。
 *
 * 解析用 `DSH_APP_MODULES` 指向宿主自己的 node_modules（`host-packages.mjs` 的显式覆盖通路），
 * 这样不必依赖“插件恰好装在 profile 里”。
 *
 *   node visual-effects-host-config-test.mjs
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOST_MODULES = join(homedir(), 'AppData', 'Local', 'Programs', 'DeepSeek Harness', 'resources', 'app', 'dsh', 'node_modules');

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}

if (!existsSync(join(HOST_MODULES, '@deepseek-ai', 'schemastery'))) {
  console.log('SKIP  the host does not ship @deepseek-ai/schemastery on this machine');
  process.exit(0);
}

process.env.DSH_APP_MODULES = HOST_MODULES;
const { buildVisualEffectsConfig, VISUAL_EFFECT_LABELS } = await import(`./internal/visual-effects-config.mjs?host=${Date.now()}`);
const { VISUAL_DEFAULTS } = await import('./internal/visual-preferences.mjs');
const { hostResolution } = await import('./internal/host-packages.mjs');

console.log('\n== schemastery is resolved from the host, not from the plugin ==');
const built = await buildVisualEffectsConfig();
check('a schema is produced', built.Config !== undefined, JSON.stringify({ source: built.source, error: built.error.slice(0, 120) }));
check('it came from the host package', built.source === 'host', built.source);
const record = hostResolution('@deepseek-ai/schemastery');
check('the resolution record names an entry', typeof record?.selected?.entry === 'string' && record.selected.entry !== '', JSON.stringify(record?.selected ?? null));
check('the entry is the CommonJS build', /index\.cjs$/.test(record?.selected?.entry ?? ''), record?.selected?.entry ?? '(none)');
check('it reports a version', typeof record?.selected?.version === 'string' && record.selected.version !== '', String(record?.selected?.version));

console.log('\n== the schema really is a schemastery schema ==');
{
  const value = built.Config({});
  check('an empty object fills every default', typeof value === 'object' && value !== null, JSON.stringify(value));
  for (const [key, expected] of Object.entries(VISUAL_DEFAULTS)) {
    check(`${key} defaults to ${String(expected)}`, value?.[key] === expected, JSON.stringify(value?.[key]));
  }
  const coerced = built.Config({ bannerCharacter: true, cursorHalo: false });
  check('explicit values are kept', coerced.bannerCharacter === true && coerced.cursorHalo === false, JSON.stringify(coerced));
  let rejected = false;
  try {
    built.Config({ cursorHalo: 'not a boolean' });
  } catch {
    rejected = true;
  }
  check('a wrong type is refused by the schema itself', rejected === true);
}

console.log('\n== the descriptions are the ones the settings page shows ==');
{
  // schemastery 把元数据挂在字段 schema 自己的 `.meta` 上（不是 dict 那一层）。
  const fields = built.Config.dict ?? {};
  for (const key of Object.keys(VISUAL_DEFAULTS)) {
    const text = fields[key]?.meta?.description ?? '';
    check(`${key} has a description`, String(text).length > 0, String(text).slice(0, 60));
    check(`${key} description matches the label table`, String(text) === VISUAL_EFFECT_LABELS[key], String(text).slice(0, 60));
    check(`${key} schema records the default`, fields[key]?.meta?.default === VISUAL_DEFAULTS[key], JSON.stringify(fields[key]?.meta?.default));
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
