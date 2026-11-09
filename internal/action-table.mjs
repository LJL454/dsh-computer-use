/**
 * 动作表（阶段 5）：事件 → 第一版表现 → 资源状态。
 *
 * 只描述"用户看得到什么"，不描述成败：这张表是设置页"动作说明 + 预览"的数据源，
 * 也是诊断页解释"为什么这次点击没有动画"的词典。预览**只演示动画**，
 * 不触发真实鼠标/键盘输入（预览走同一套 `visualActivity` 消息，`source: 'preview'`）。
 */

/** 预览时需要覆盖的类别（顺序即演示顺序）。 */
export const PREVIEW_KINDS = Object.freeze([
  'pointer_click',
  'pointer_drag',
  'pointer_hold',
  'scroll',
  'type',
  'invoke',
  'set_value',
]);

/**
 * 一行 = 一个事件。
 *
 * `clip` 是首选片段，`fallback` 是资源缺失时的临时映射（与 helper 的 `ResolveFeedbackClip` 一致）。
 * `source` 说明这一类事件由谁驱动：系统输入、工具语义，或两者都有。
 */
export const ACTION_TABLE = Object.freeze([
  {
    event: '静止',
    kinds: [],
    representation: 'idle',
    clip: 'idle',
    fallback: null,
    source: 'pointer',
    note: '没有更高优先级状态时；停止/故障也映射 idle。',
  },
  {
    event: '移动',
    kinds: [],
    representation: 'move',
    clip: 'move',
    fallback: null,
    source: 'pointer',
    note: '最近 160 ms 内有位置变化；位置轮询即可触发。',
  },
  {
    event: '单击 / 右击 / 中击 / 侧键',
    kinds: ['pointer_click'],
    representation: '短按压反馈 + release（150—250 ms）',
    clip: 'tap',
    fallback: 'release',
    source: 'pointer + tool',
    note: '真实边沿与工具动作都能驱动；工具动作不伪造按钮状态。',
  },
  {
    event: '持续按住',
    kinds: ['pointer_hold'],
    representation: 'press_in → pressed_hold',
    clip: 'pressed_hold',
    fallback: 'press_in',
    source: 'pointer',
    note: 'pressed_hold 只有一帧时不会"动"，需要明显活动要补 4—6 帧资源。',
  },
  {
    event: '按住并移动超过阈值（约 6 DIP）',
    kinds: ['pointer_drag'],
    representation: 'drag → release',
    clip: 'drag',
    fallback: 'release',
    source: 'pointer + tool',
    note: '位移是唯一判据；钩子失效时由位置兜底累计，来源标 sampled。',
  },
  {
    event: '滚轮 / 触控板滚动',
    kinds: ['scroll'],
    representation: '短滚动反馈，连续滚动续期',
    clip: 'scroll',
    fallback: 'release',
    source: 'pointer + tool',
    note: '带 delta 的脉冲；连续脉冲在 120 ms 内只续期。',
  },
  {
    event: '普通打字 / 工具输入文本',
    kinds: ['type'],
    representation: 'typing，输入间歇结束后收势',
    clip: 'typing',
    fallback: 'press_in',
    source: 'keyboard + tool',
    note: '只记录"有输入活动"，不保存键值、字符、密码或窗口文字。',
  },
  {
    event: 'UIA invoke / DOM 点击',
    kinds: ['invoke'],
    representation: '短操作反馈',
    clip: 'tap',
    fallback: 'press_in',
    source: 'tool',
    note: 'CUA/CDP 没有系统鼠标边沿，视觉只由活动消息驱动。',
  },
  {
    event: 'UIA set_value / CDP 填写',
    kinds: ['set_value'],
    representation: 'typing 或短操作反馈',
    clip: 'typing',
    fallback: 'press_in',
    source: 'tool',
    note: '与"点击"分开报：它是输入而不是按压。',
  },
  {
    event: '控制横幅活动',
    kinds: [],
    representation: 'eat_loop',
    clip: 'eat_loop',
    fallback: null,
    source: 'banner',
    note: '仍属于横幅，不是鼠标角色的可选状态。',
  },
  {
    event: '失败 / 取消',
    kinds: [],
    representation: '终止活动，安全收势/待机',
    clip: null,
    fallback: null,
    source: 'tool',
    note: '不把失败当成功；不显示成功庆祝。',
  },
]);

/** 只挑预览需要的字段（设置页渲染用）。 */
export function previewPlan() {
  return PREVIEW_KINDS.map((kind) => {
    const row = ACTION_TABLE.find((entry) => entry.kinds.includes(kind));
    return {
      kind,
      event: row?.event ?? kind,
      clip: row?.clip ?? null,
      fallback: row?.fallback ?? null,
      representation: row?.representation ?? '',
    };
  });
}
