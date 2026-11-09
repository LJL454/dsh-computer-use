/**
 * 视觉效果的 **Config schema**（方案 3.5 / 4.1 / 4.7 的宿主设置页）。
 *
 * 宿主的 `SettingsForms_default`（见 `@deepseek-ai/dsh-settings`）默认会为每个插件生成设置页，
 * 依据就是插件导出的 `Config`（schemastery schema）。把它声明出来，用户就能在宿主的设置界面里
 * 改这些开关，而不是只靠 `client.js` 里的弹层。
 *
 * 三条保守规则：
 *
 *   1. **schema 拿不到就不声明**：`@deepseek-ai/schemastery` 只能通过宿主解析（插件的真实路径
 *      解析不到它，见 `internal/host-packages.mjs` 的文件头）。解析失败时 `Config` 为 `undefined`，
 *      插件照常加载，只是没有自动设置页 —— 不能因为"想要一个设置页"让插件装不上。
 *   2. **默认值与 `internal/visual-preferences.mjs` 是同一份**：两处漂移会让"设置页显示开的、
 *      实际却是关的"这种问题重新出现。
 *   3. **日常伴随单独成组**：`cursorCompanion` 不是"电脑控制装饰"的一种，它的说明里必须写清
 *      "不会开启电脑操作或高亮提示"（方案 3.5 的界面文案要求）。
 */
import { VISUAL_DEFAULTS, VISUAL_LIMITS } from './visual-preferences.mjs';
import { importHostModule } from './host-packages.mjs';

/** 设置页里每一项的说明。文案刻意短：设置页本身已经说明了上下文。 */
export const VISUAL_EFFECT_LABELS = Object.freeze({
  enabled: '动画总开关（关掉后装饰不画；边缘提示、两段文字与 Esc 仍然有效）',
  bannerCharacter: '横幅角色（横幅左端的吃饭循环）',
  cursorCharacter: '光标角色（鼠标旁的状态动画）',
  cursorHalo: '光标光晕',
  edgeBreathing: '边缘呼吸',
  reducedMotion: '减少动态（不做形变，只换明暗）',
  bannerDecoration: '横幅装饰（胶囊双描边、外光、小鲸与海浪）',
  bannerTheme: '横幅主题（ocean = 海洋胶囊；plain = 基础底板）',
  bannerCharacterHeightDip: `横幅人物可见高度（DIP，${VISUAL_LIMITS.bannerCharacterHeightDip.min}–${VISUAL_LIMITS.bannerCharacterHeightDip.max}）`,
  cursorCharacterHeightDip: `光标人物可见高度（DIP，${VISUAL_LIMITS.cursorCharacterHeightDip.min}–${VISUAL_LIMITS.cursorCharacterHeightDip.max}）`,
  cursorCompanion: 'DeepSeek Harness 运行时显示鼠标角色（在 DeepSeek Harness 运行期间让角色跟随鼠标；不会开启电脑操作或高亮提示）',
});

/**
 * 尝试构建 schema。
 *
 * @param options - 注入用：`{ z?, load? }`。`z` 直接给一个 schemastery 工厂；`load` 替换整段
 *   宿主解析（测试"解析不到"的那条路径时用它，不要靠环境变量去碰运气）。
 * @returns `{ Config, source, error }`；拿不到宿主包时 `Config` 为 undefined。
 */
export async function buildVisualEffectsConfig(options = {}) {
  let z = options.z;
  let source = 'injected';
  let error = '';
  if (z === undefined) {
    const load = typeof options.load === 'function' ? options.load : importHostModule;
    try {
      const hostModule = await load('@deepseek-ai/schemastery');
      z = hostModule?.default ?? hostModule;
      source = 'host';
    } catch (caught) {
      return { Config: undefined, source: 'unavailable', error: String(caught?.message ?? caught) };
    }
  }
  if (typeof z?.object !== 'function') {
    return { Config: undefined, source, error: 'the schemastery module does not expose object()' };
  }
  const withDescription = (schema, description) =>
    (typeof schema?.description === 'function' ? schema.description(description) : schema);
  const bool = (key) => withDescription(z.boolean().default(VISUAL_DEFAULTS[key]), VISUAL_EFFECT_LABELS[key]);
  const num = (key) => {
    const limits = VISUAL_LIMITS[key];
    // 有上下界的整数：滑块本来就会给小数，校验层还会再夹一次。
    let schema = typeof z.number === 'function' ? z.number() : z.any();
    if (typeof schema?.min === 'function') schema = schema.min(limits.min);
    if (typeof schema?.max === 'function') schema = schema.max(limits.max);
    if (typeof schema?.default === 'function') schema = schema.default(VISUAL_DEFAULTS[key]);
    return withDescription(schema, VISUAL_EFFECT_LABELS[key]);
  };
  const union = (key, values) => {
    let schema = typeof z.union === 'function'
      ? z.union(values.map((value) => z.const(value)))
      : (typeof z.any === 'function' ? z.any() : undefined);
    if (typeof schema?.default === 'function') schema = schema.default(VISUAL_DEFAULTS[key]);
    return withDescription(schema, VISUAL_EFFECT_LABELS[key]);
  };
  const Config = z.object({
    enabled: bool('enabled'),
    bannerCharacter: bool('bannerCharacter'),
    cursorCharacter: bool('cursorCharacter'),
    cursorHalo: bool('cursorHalo'),
    edgeBreathing: bool('edgeBreathing'),
    reducedMotion: bool('reducedMotion'),
    bannerDecoration: bool('bannerDecoration'),
    bannerTheme: union('bannerTheme', ['ocean', 'plain']),
    bannerCharacterHeightDip: num('bannerCharacterHeightDip'),
    cursorCharacterHeightDip: num('cursorCharacterHeightDip'),
    cursorCompanion: bool('cursorCompanion'),
  });
  return { Config, source, error };
}

/**
 * 把宿主传进来的 `config.visualEffects` 折成一份补丁（只保留已知键，交给 visual-preferences 校验）。
 *
 * @param visualEffects - 来自宿主配置段的对象。
 * @returns 补丁对象（可能为空）。
 */
export function visualEffectsPatch(visualEffects) {
  const patch = {};
  if (visualEffects === null || typeof visualEffects !== 'object') return patch;
  for (const key of Object.keys(VISUAL_DEFAULTS)) {
    const value = visualEffects[key];
    if (typeof VISUAL_DEFAULTS[key] === 'boolean' && typeof value === 'boolean') patch[key] = value;
    else if (key === 'bannerTheme' && (value === 'ocean' || value === 'plain')) patch[key] = value;
    else if (typeof VISUAL_DEFAULTS[key] === 'number' && typeof value === 'number' && Number.isFinite(value)) patch[key] = value;
  }
  return patch;
}
