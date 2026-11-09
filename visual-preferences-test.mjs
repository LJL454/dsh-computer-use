/**
 * PR17 —— 视觉效果偏好（方案 4.18.8）。
 *
 * 用户关得掉、坏文件拦不住、写盘是原子的 —— 这三条各自都有一种具体的翻车样子，所以各自都有断言：
 *
 *   - 总开关没真关掉装饰（或反过来把"操作提示/取消能力"一起关了）；
 *   - 一个手改坏的 JSON 让插件起不来；
 *   - 写到一半掉电，留下半截文件，下次启动把偏好读成默认值（用户会以为设置自己丢了）。
 *
 *   node visual-preferences-test.mjs
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VISUAL_DEFAULTS, VISUAL_SCHEMA_VERSION, createVisualPreferencesStore, normalizeVisualPreferences } from './internal/visual-preferences.mjs';

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}

console.log('\n== defaults: decor off, safety channels untouched ==');
check('the character is off by default', VISUAL_DEFAULTS.bannerCharacter === false && VISUAL_DEFAULTS.cursorCharacter === false);
check('the cursor halo is on by default', VISUAL_DEFAULTS.cursorHalo === true);
check('breathing is on, reduced motion is off', VISUAL_DEFAULTS.edgeBreathing === true && VISUAL_DEFAULTS.reducedMotion === false);
check('there is no setting that turns off the banner or the Esc path', !('banner' in VISUAL_DEFAULTS) && !('escape' in VISUAL_DEFAULTS) && !('indicator' in VISUAL_DEFAULTS), JSON.stringify(Object.keys(VISUAL_DEFAULTS)));

console.log('\n== normalization: unknown keys and wrong types are refused, not guessed ==');
{
  const { values, rejected } = normalizeVisualPreferences({ bannerCharacter: true, cursorHalo: 'yes', sparkle: true });
  check('a valid value is taken', values.bannerCharacter === true);
  check('a wrong type keeps the default', values.cursorHalo === VISUAL_DEFAULTS.cursorHalo);
  check('the wrong type is reported', rejected.some((one) => one.key === 'cursorHalo' && /boolean/.test(one.reason)), JSON.stringify(rejected));
  check('the unknown key is reported', rejected.some((one) => one.key === 'sparkle' && /unknown/.test(one.reason)), JSON.stringify(rejected));
  const notObject = normalizeVisualPreferences('nonsense');
  check('a non-object is refused wholesale', notObject.rejected.length === 1 && notObject.values.enabled === VISUAL_DEFAULTS.enabled, JSON.stringify(notObject.rejected));
}

console.log('\n== a fresh store is the defaults, revision 0 ==');
const dir = mkdtempSync(join(tmpdir(), 'dsh-visual-prefs-'));
const filePath = join(dir, 'visual-preferences.json');
const store = createVisualPreferencesStore({ filePath });
check('nothing is written before the first save', existsSync(filePath) === false);
const loaded = store.load();
check('loading a missing file gives the defaults', loaded.values.bannerCharacter === false && loaded.revision === 0, JSON.stringify(loaded));
check('and it is not degraded', loaded.degraded === null, String(loaded.degraded));

console.log('\n== saving is atomic, monotonic, and keeps the untouched keys ==');
{
  const first = store.save({ bannerCharacter: true, cursorCharacter: true });
  check('the first save bumps the revision to 1', first.revision === 1, String(first.revision));
  check('the file exists', existsSync(filePath));
  const document = JSON.parse(readFileSync(filePath, 'utf8'));
  check('the file carries the schema version', document.schemaVersion === VISUAL_SCHEMA_VERSION, String(document.schemaVersion));
  check('the file carries the revision', document.settingsRevision === 1, String(document.settingsRevision));
  check('the file carries the values', document.values.bannerCharacter === true && document.values.cursorCharacter === true, JSON.stringify(document.values));
  check('no temporary file is left behind', readdirSync(dir).filter((one) => one.endsWith('.tmp')).length === 0, JSON.stringify(readdirSync(dir)));

  const second = store.save({ cursorHalo: false });
  check('a later save bumps the revision again', second.revision === 2, String(second.revision));
  check('keys not in the patch are preserved', second.values.bannerCharacter === true && second.values.cursorCharacter === true, JSON.stringify(second.values));
  check('the patched key changed', second.values.cursorHalo === false);

  const rejected = store.save({ cursorHalo: 'no', bannerCharacter: false });
  check('an invalid patch is not applied', rejected.values.cursorHalo === false, JSON.stringify(rejected.values));
  check('the valid part of the patch is applied', rejected.values.bannerCharacter === false);
  check('and the rejection is reported', rejected.rejected.length === 1 && rejected.rejected[0].key === 'cursorHalo', JSON.stringify(rejected.rejected));
}

console.log('\n== the revision survives a reload ==');
{
  const reopened = createVisualPreferencesStore({ filePath });
  const state = reopened.load();
  check('the values come back', state.values.bannerCharacter === false && state.values.cursorHalo === false, JSON.stringify(state.values));
  check('the revision comes back', state.revision >= 3, String(state.revision));
  check('and a save continues from there', reopened.save({ cursorHalo: true }).revision > state.revision);
}

console.log('\n== a corrupt file does not take the plugin down with it ==');
{
  writeFileSync(filePath, '{"schemaVersion": 1, "values": {', 'utf8');
  const broken = createVisualPreferencesStore({ filePath });
  const state = broken.load();
  check('the defaults are used', state.values.bannerCharacter === false && state.values.cursorHalo === true, JSON.stringify(state.values));
  check('it is reported as degraded', state.degraded === 'corrupt', String(state.degraded));
  const quarantined = readdirSync(dir).filter((one) => one.includes('.corrupt-'));
  check('the broken file was kept for diagnosis', quarantined.length >= 1, JSON.stringify(readdirSync(dir)));
  check('the store still works afterwards', broken.save({ cursorHalo: false }).revision === 1);
}

console.log('\n== an unknown schema version is not guessed at ==');
{
  const otherPath = join(dir, 'future.json');
  writeFileSync(otherPath, JSON.stringify({ schemaVersion: 99, settingsRevision: 7, values: { bannerCharacter: true } }), 'utf8');
  const future = createVisualPreferencesStore({ filePath: otherPath });
  const state = future.load();
  check('the defaults are used', state.values.bannerCharacter === false, JSON.stringify(state.values));
  check('the reason names the version', /99/.test(String(state.degraded)), String(state.degraded));
  check('the revision does not inherit a number it did not understand', state.revision === 0, String(state.revision));
}

rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
