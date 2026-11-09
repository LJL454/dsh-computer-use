/**
 * PR17 尾项 —— 设置面板与宿主校验表的**对齐**（方案 4.18.8）。
 *
 * 面板是浏览器里的一段 React 代码，宿主是另一份校验表；两边一旦写歪，症状是"点了没反应"——
 * 宿主把未知键当垃圾丢掉，面板还显示着勾。这份测试把两边放在一起比：
 *
 *   - 面板上的每一个键都在宿主的 `VISUAL_DEFAULTS` 里（拼错就红）；
 *   - 宿主接受的每一个键都在面板上（新增设置却没人能改也是缺陷）；
 *   - 面板里没有"关闭横幅/关闭 Esc"这类开关，底面明确写着安全通道不受影响；
 *   - `apply` 注册了两个槽位（芯片 + 效果）。
 *
 * 它不执行 React —— 面板的渲染行为由宿主路由测试与其后的界面验收覆盖；这里管的是两边别走散。
 *
 *   node client-effects-test.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VISUAL_DEFAULTS } from './internal/visual-preferences.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, 'client.js'), 'utf8');

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}

console.log('\n== the panel and the host agree on the setting names ==');
const rowsBlock = source.slice(source.indexOf('const EFFECT_ROWS = ['), source.indexOf('];', source.indexOf('const EFFECT_ROWS = [')));
const panelKeys = [...rowsBlock.matchAll(/key:\s*'([A-Za-z]+)'/g)].map((match) => match[1]);
// 伴随开关单独一行（COMPANION_ROW），不在 EFFECT_ROWS 里。
const companionKey = /const COMPANION_ROW = \{\s*key: '([A-Za-z]+)'/.exec(source)?.[1];
if (companionKey !== undefined) panelKeys.push(companionKey);
const hostKeys = Object.keys(VISUAL_DEFAULTS);

/**
 * 面板只有**开关**这一种行（`effectRow` 只渲染布尔）。
 *
 * 数值/枚举类设置（主题、两处高度）没有对应的控件，所以它们不在面板上——这是**设计**，
 * 不是漏配。这里把它们显式列出来：将来新增一个设置，要么在面板上有开关、要么必须写进这份
 * 清单，不能默默溜过去。
 */
const ADVANCED_KEYS = ['bannerTheme', 'bannerCharacterHeightDip', 'cursorCharacterHeightDip'];
const booleanHostKeys = hostKeys.filter((key) => !ADVANCED_KEYS.includes(key));

check('the panel has rows', panelKeys.length >= 4, JSON.stringify(panelKeys));
check('every panel key is a host setting', panelKeys.every((key) => hostKeys.includes(key)), JSON.stringify(panelKeys.filter((key) => !hostKeys.includes(key))));
check('every boolean host setting has a panel row', booleanHostKeys.every((key) => panelKeys.includes(key)),
  JSON.stringify(booleanHostKeys.filter((key) => !panelKeys.includes(key))));
check('the advanced (non-boolean) settings are the documented three', ADVANCED_KEYS.every((key) => hostKeys.includes(key)),
  JSON.stringify(ADVANCED_KEYS.filter((key) => !hostKeys.includes(key))));
check('every host setting is classified', hostKeys.every((key) => panelKeys.includes(key) || ADVANCED_KEYS.includes(key)),
  JSON.stringify(hostKeys.filter((key) => !panelKeys.includes(key) && !ADVANCED_KEYS.includes(key))));
check('no key is listed twice', new Set(panelKeys).size === panelKeys.length, JSON.stringify(panelKeys));

console.log('\n== the panel cannot switch off the safety surface ==');
check('there is no "banner off" switch', !panelKeys.some((key) => /^(banner|bannerEnabled|showBanner)$/.test(key)), JSON.stringify(panelKeys));
check('there is no "escape off" switch', !panelKeys.some((key) => /escape|esc$|cancel/i.test(key)), JSON.stringify(panelKeys));
check('the footer names the untouched channels', /操作提示、停止与物理 Esc 取消不受这些开关影响/.test(source));

console.log('\n== the control is wired to its own slot and route ==');
// 现行契约（见 client.js 里的注释与 client-panel-render-test）：合成器上只留「电脑操作」一个芯片，
// 「效果」去设置左栏的「动画设置」。所以这里断言的是**设置分区**，而不是已删除的旧芯片。
check('the animation settings section is registered', source.includes("id: 'computer-use-animation'"));
check('the composer keeps exactly the computer-use chip', source.includes("id: 'computer-use', order: 40"));
check('the settings section and the chip do not share an order', /id: 'computer-use-animation', order: 30/.test(source) && /order: 41/.test(source) === false);
check('it reads the visual preferences route', source.includes('`${ROUTE}/visual-preferences`'));
check('it posts a values patch', /body: JSON.stringify\(\{ values: patch \}\)/.test(source));
check('a failed save is reported, not swallowed', /未能保存/.test(source));
check('a refused key is named', /宿主拒绝了/.test(source));

console.log('\n== the styles the panel needs are present ==');
for (const className of ['dsh-cu-fx', 'dsh-cu-fx-trigger', 'dsh-cu-fx-panel', 'dsh-cu-fx-row', 'dsh-cu-fx-note', 'dsh-cu-fx-foot']) {
  check(`.${className} has a rule`, source.includes(`.${className}`));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
