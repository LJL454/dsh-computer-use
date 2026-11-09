/**
 * 视觉效果的偏好（方案 3.5 / 4.1 / 7.1）。
 *
 * 这一层要同时满足四件互相牵制的事：
 *
 *   1. **用户关得掉**：总开关和分项开关都必须真的熄灭对应的东西（角色、光标装饰、呼吸），而且
 *      关掉之后不能连带关掉"操作提示"与"取消能力"——那是安全通道，不属于装饰。
 *   2. **日常伴随是独立开关**：`cursorCompanion` 与电脑控制装饰分开保存，默认关闭；开启后宿主
 *      启动即生效，与有没有电脑控制任务无关（方案 3.5）。
 *   3. **坏文件不能拦住插件**：文件缺失、损坏、schemaVersion 不认识，都回到默认值继续跑，并把
 *      坏文件留一份 `.corrupt-<ts>` 供诊断；绝不因为一个 JSON 装不上就不让人用电脑操作。
 *   4. **写盘是原子的**：先写 `.tmp` 再 `rename`，中途掉电不会留下半截文件；`settingsRevision`
 *      单调递增并随文件持久化，helper 那边"只接受新修订"的规则才有意义。
 *
 * 它不认识 helper、不认识路由：只负责"值、校验、修订号与磁盘"。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * 偏好文件的 schema 版本。
 *
 * v1 → v2 的变化是**加法**：新增装饰分项、人物可见高度（横幅/光标各一）与日常伴随开关。
 * v1 文件照原值迁移：已有开关保持原值，新键取默认值（日常伴随默认 false），不让用户重新配一遍。
 */
export const VISUAL_SCHEMA_VERSION = 2;

/**
 * 人物可见高度的范围（DIP）。横幅默认 144（≈当前未裁切主体的 1.85 倍），光标默认 96（≈2 倍）。
 * 上限不是随手取的：再大就要按 200% DPI 重新算缓存与 Banner 面积预算（方案 4.1 / 6.3）。
 */
export const VISUAL_LIMITS = Object.freeze({
  bannerCharacterHeightDip: Object.freeze({ min: 112, max: 176, default: 144 }),
  cursorCharacterHeightDip: Object.freeze({ min: 72, max: 128, default: 96 }),
});

/** 横幅主题：`ocean` 是完整海洋胶囊，`plain` 是基础底板（方案 4.7）。 */
export const BANNER_THEMES = Object.freeze(['ocean', 'plain']);

/**
 * 默认值。角色默认关闭：发布默认值仍要用户显式打开。`reducedMotion` 与 `edgeBreathing`
 * 只影响动态，不影响"提示是否存在"；`cursorCompanion` 是日常伴随，默认关闭。
 */
export const VISUAL_DEFAULTS = Object.freeze({
  enabled: false,
  bannerCharacter: false,
  cursorCharacter: false,
  cursorHalo: true,
  edgeBreathing: true,
  reducedMotion: false,
  bannerDecoration: true,
  bannerTheme: 'ocean',
  bannerCharacterHeightDip: VISUAL_LIMITS.bannerCharacterHeightDip.default,
  cursorCharacterHeightDip: VISUAL_LIMITS.cursorCharacterHeightDip.default,
  cursorCompanion: false,
});

/** 每个键的校验规则，校验、文档与界面共用一份。 */
const FIELDS = Object.freeze({
  enabled: Object.freeze({ type: 'boolean' }),
  bannerCharacter: Object.freeze({ type: 'boolean' }),
  cursorCharacter: Object.freeze({ type: 'boolean' }),
  cursorHalo: Object.freeze({ type: 'boolean' }),
  edgeBreathing: Object.freeze({ type: 'boolean' }),
  reducedMotion: Object.freeze({ type: 'boolean' }),
  bannerDecoration: Object.freeze({ type: 'boolean' }),
  bannerTheme: Object.freeze({ type: 'enum', values: BANNER_THEMES }),
  bannerCharacterHeightDip: Object.freeze({ type: 'number', ...VISUAL_LIMITS.bannerCharacterHeightDip }),
  cursorCharacterHeightDip: Object.freeze({ type: 'number', ...VISUAL_LIMITS.cursorCharacterHeightDip }),
  cursorCompanion: Object.freeze({ type: 'boolean' }),
});

/** 供界面/路由枚举的字段清单。 */
export const VISUAL_FIELDS = Object.freeze(Object.keys(FIELDS));

/** 日常伴随字段既接受 `true/false`，也接受 `{ enabled }`（方案里写的是 `cursorCompanion.enabled`）。 */
function readCompanion(raw) {
  if (typeof raw === 'boolean') return { ok: true, value: raw };
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const inner = raw.enabled;
    if (typeof inner === 'boolean') return { ok: true, value: inner };
    return { ok: false, reason: 'must be a boolean or { enabled: boolean }' };
  }
  return { ok: false, reason: 'must be a boolean or { enabled: boolean }' };
}

/**
 * 归一化一份输入。
 *
 * @param input - 任意值（来自 HTTP body 或磁盘）。
 * @returns `{ values, rejected }`：`rejected` 列出被丢弃的键与原因。
 */
export function normalizeVisualPreferences(input) {
  const values = { ...VISUAL_DEFAULTS };
  const rejected = [];
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { values, rejected: [{ key: '(root)', reason: 'not an object' }] };
  }
  for (const [key, raw] of Object.entries(input)) {
    const field = FIELDS[key];
    if (field === undefined) {
      rejected.push({ key, reason: 'unknown setting' });
      continue;
    }
    if (key === 'cursorCompanion') {
      const companion = readCompanion(raw);
      if (!companion.ok) rejected.push({ key, reason: companion.reason });
      else values[key] = companion.value;
      continue;
    }
    if (field.type === 'boolean') {
      if (typeof raw !== 'boolean') {
        rejected.push({ key, reason: 'must be a boolean' });
        continue;
      }
      values[key] = raw;
      continue;
    }
    if (field.type === 'enum') {
      if (typeof raw !== 'string' || !field.values.includes(raw)) {
        rejected.push({ key, reason: `must be one of ${field.values.join(', ')}` });
        continue;
      }
      values[key] = raw;
      continue;
    }
    if (field.type === 'number') {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        rejected.push({ key, reason: 'must be a number' });
        continue;
      }
      // 越界按范围**夹紧**而不是丢弃：滑块本来就可能因为 DPI 换算出现 175.9999。
      values[key] = Math.min(field.max, Math.max(field.min, raw));
      continue;
    }
    rejected.push({ key, reason: 'has no validator' });
  }
  return { values, rejected };
}

/**
 * 建一份偏好存储。
 *
 * @param options - `{ filePath }`；文件不存在时用默认值。
 * @returns `{ load, save, current, revision, filePath, degraded, migratedFrom }`。
 */
export function createVisualPreferencesStore(options = {}) {
  const filePath = String(options.filePath ?? '');
  let values = { ...VISUAL_DEFAULTS };
  let revision = 0;
  let updatedAt = null;
  let degraded = null;
  let migratedFrom = null;
  let loaded = false;

  /** 把当前值写成 `{schemaVersion, settingsRevision, updatedAt, values}`。 */
  function toDocument() {
    return { schemaVersion: VISUAL_SCHEMA_VERSION, settingsRevision: revision, updatedAt, values: { ...values } };
  }

  /**
   * 从磁盘读一次。坏文件保留副本并回到默认值；v1 文件按原值迁移。
   * @returns `{ values, revision, degraded }`。
   */
  function load() {
    loaded = true;
    if (filePath === '') return { values: { ...values }, revision, degraded };
    if (!existsSync(filePath)) {
      degraded = null;
      return { values: { ...values }, revision, degraded };
    }
    let raw;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch (error) {
      degraded = `unreadable: ${String(error?.message ?? error)}`;
      return { values: { ...values }, revision, degraded };
    }
    let document;
    try {
      document = JSON.parse(raw);
    } catch {
      keepCorruptCopy();
      degraded = 'corrupt';
      values = { ...VISUAL_DEFAULTS };
      revision = 0;
      return { values: { ...values }, revision, degraded };
    }
    const version = document?.schemaVersion;
    if (version !== VISUAL_SCHEMA_VERSION && version !== 1) {
      // 不认识的版本不猜：按损坏处理，文件留一份供诊断（方案 4.18.8 第 2 条）。
      keepCorruptCopy();
      degraded = `schemaVersion ${String(version)} is not ${VISUAL_SCHEMA_VERSION}`;
      values = { ...VISUAL_DEFAULTS };
      revision = 0;
      return { values: { ...values }, revision, degraded };
    }
    const normalized = normalizeVisualPreferences(document.values);
    values = normalized.values;
    revision = Number.isFinite(document.settingsRevision) ? Number(document.settingsRevision) : 0;
    updatedAt = typeof document.updatedAt === 'string' ? document.updatedAt : null;
    migratedFrom = version === 1 ? 1 : null;
    const notes = [];
    if (migratedFrom !== null) notes.push('migrated from schemaVersion 1 (companion defaults to off)');
    if (normalized.rejected.length > 0) notes.push(`dropped ${normalized.rejected.map((one) => one.key).join(', ')}`);
    degraded = notes.length === 0 ? null : notes.join('; ');
    return { values: { ...values }, revision, degraded, rejected: normalized.rejected, migratedFrom };
  }

  /** 坏文件留一份副本，诊断时能看出原来的样子。 */
  function keepCorruptCopy() {
    if (filePath === '') return;
    try {
      renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);
    } catch {
      /* best effort: the next save overwrites it anyway */
    }
  }

  /**
   * 保存一份补丁。
   *
   * @param patch - 只带要改的键。
   * @returns `{ values, revision, rejected }`。
   */
  function save(patch) {
    if (!loaded) load();
    const normalized = normalizeVisualPreferences(patch);
    // 补丁里没提到的键保持原值（normalize 会给默认值，这里要合并回去）。
    const next = { ...values };
    if (patch !== null && typeof patch === 'object' && !Array.isArray(patch)) {
      for (const key of Object.keys(FIELDS)) {
        if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
        if (key === 'cursorCompanion') {
          const companion = readCompanion(patch[key]);
          if (companion.ok) next[key] = companion.value;
          continue;
        }
        const field = FIELDS[key];
        const raw = patch[key];
        if (field.type === 'boolean' && typeof raw === 'boolean') next[key] = raw;
        else if (field.type === 'enum' && typeof raw === 'string' && field.values.includes(raw)) next[key] = raw;
        else if (field.type === 'number' && typeof raw === 'number' && Number.isFinite(raw)) {
          next[key] = Math.min(field.max, Math.max(field.min, raw));
        }
      }
    }
    values = next;
    revision += 1;
    updatedAt = new Date().toISOString();
    if (filePath !== '') {
      mkdirSync(dirname(filePath), { recursive: true });
      const temporary = join(dirname(filePath), `.${process.pid}-${Date.now()}.tmp`);
      writeFileSync(temporary, `${JSON.stringify(toDocument(), null, 2)}\n`, 'utf8');
      // rename 是原子的：要么是旧文件，要么是完整的新文件，不会出现半截 JSON。
      renameSync(temporary, filePath);
    }
    return { values: { ...values }, revision, rejected: normalized.rejected };
  }

  return {
    load,
    save,
    get current() {
      return { values: { ...values }, revision, updatedAt, degraded, migratedFrom };
    },
    get revision() {
      return revision;
    },
    get filePath() {
      return filePath;
    },
    get degraded() {
      return degraded;
    },
    get migratedFrom() {
      return migratedFrom;
    },
  };
}
