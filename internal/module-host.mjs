/**
 * 可选扩展的宿主管家（方案 4.21 / PR18，条件项）。
 *
 * 这里只实现**宿主一侧的通用契约**：清单校验、状态机、命名空间、准入代次与实例代次。
 * 它不认识任何具体扩展，也不内置任何业务类型 —— 这正是 4.21.1 的要求：核心不得反向依赖扩展。
 *
 * 几条写进代码而不是写进注释的边界：
 *
 *   1. **不扫描目录**：只有显式 `install()` 才会登记。没装的扩展没有工具、没有进程、没有磁盘扫描。
 *   2. **安装不等于启用**：`install` 之后是 `installed-disabled`，要用户再 `enable`。
 *   3. **停用先改准入代次**：`quiesce` 第一步就是 `moduleAdmissionEpoch += 1`，之后到达的旧代次
 *      请求一律拒绝；`deactivate` 完成才退休实例代次。重新启用会拿到新的 generation。
 *   4. **故障隔离**：扩展的 `activate` 抛错只把它自己标成 `failed`，核心与其它扩展不受影响。
 *   5. **命名空间**：工具只能注册在 `module.<moduleId>.` 下；`computer_*` 这类核心名字一律拒绝。
 *
 * 宿主是否支持"动态撤销工具/设置页注册/配置热更新"仍要 M0 原型验证（4.21.1 最后一段）；
 * 在不支持可靠热更新的宿主上，停用必须表现为"停止派发、待宿主重启生效"，而不是只隐藏按钮。
 */

/** 宿主提供的 API 版本（模块用它声明兼容范围）。 */
export const HOST_API_VERSION = '1.0.0';

/** 模块与宿主之间的协议版本。 */
export const MODULE_PROTOCOL_VERSION = 1;

/** 模块状态机。 */
export const MODULE_STATE = Object.freeze({
  installedDisabled: 'installed-disabled',
  enabledIdle: 'enabled-idle',
  ready: 'ready',
  quiescing: 'quiescing',
  failed: 'failed',
});

/** 核心工具的名字前缀：模块不得占用。 */
const RESERVED_TOOL_PREFIXES = ['computer_', 'app_'];

/**
 * 解析 `hostApiRange` 这种极简范围：`^1.0.0`、`>=1.0.0 <2.0.0`、`1.x`、`*`。
 *
 * 不引第三方 semver：这里只需要判断"宿主版本在不在范围内"，范围写错就拒绝（保守）。
 *
 * @param range - 范围表达式。
 * @param version - 宿主的 API 版本。
 * @returns 是否兼容。
 */
export function satisfiesHostApiRange(range, version = HOST_API_VERSION) {
  const text = String(range ?? '').trim();
  if (text === '' || text === '*') return true;
  const parse = (value) => String(value).split('.').map((part) => Number.parseInt(part, 10));
  const [major, minor, patch] = parse(version);
  const compare = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
  const tokens = text.split(/\s+/).filter((token) => token !== '');
  return tokens.every((token) => {
    if (token === '*') return true;
    if (token.startsWith('^')) {
      const base = parse(token.slice(1));
      if (base.some((value) => !Number.isFinite(value))) return false;
      if (compare([major, minor, patch], base) < 0) return false;
      // `^1.2.3` 表示同一个主版本内。
      return major === base[0];
    }
    if (/^[0-9]+\.x$/.test(token)) return major === Number.parseInt(token, 10);
    const match = /^(>=|<=|>|<|=)?\s*([0-9]+\.[0-9]+\.[0-9]+)$/.exec(token);
    if (match === null) return false;
    const operator = match[1] ?? '=';
    const base = parse(match[2]);
    const order = compare([major, minor, patch], base);
    if (operator === '>=') return order >= 0;
    if (operator === '<=') return order <= 0;
    if (operator === '>') return order > 0;
    if (operator === '<') return order < 0;
    return order === 0;
  });
}

/**
 * 校验一份模块清单。
 *
 * @param raw - 清单对象（来自模块包的 `module.json`）。
 * @param options - `{ hostApi, platform, arch }`。
 * @returns `{ ok, manifest, problems }`。
 */
export function inspectManifest(raw, options = {}) {
  const problems = [];
  const hostApi = options.hostApi ?? HOST_API_VERSION;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, manifest: null, problems: ['the manifest is not an object'] };
  }
  const need = (key, type) => {
    const value = raw[key];
    if (value === undefined || value === null) { problems.push(`${key} is required`); return undefined; }
    if (typeof value !== type) { problems.push(`${key} must be a ${type}`); return undefined; }
    return value;
  };
  const moduleId = need('moduleId', 'string');
  const moduleVersion = need('moduleVersion', 'string');
  const hostApiRange = need('hostApiRange', 'string');
  const protocol = need('moduleProtocolVersion', 'number');
  const entry = need('entry', 'string');
  const permissions = raw.permissions;
  if (permissions !== undefined && !Array.isArray(permissions)) problems.push('permissions must be an array');
  if (entry !== undefined) {
    const normalized = String(entry).replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) problems.push('entry must be a relative path');
    if (normalized.split('/').includes('..')) problems.push('entry must not traverse outside the module directory');
  }
  if (moduleId !== undefined && !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(moduleId)) problems.push('moduleId must be a lowercase slug');
  if (protocol !== undefined && protocol !== MODULE_PROTOCOL_VERSION) {
    problems.push(`moduleProtocolVersion ${protocol} is not ${MODULE_PROTOCOL_VERSION}`);
  }
  if (hostApiRange !== undefined && !satisfiesHostApiRange(hostApiRange, hostApi)) {
    problems.push(`hostApiRange ${hostApiRange} does not include host API ${hostApi}`);
  }
  if (raw.platforms !== undefined) {
    if (!Array.isArray(raw.platforms)) problems.push('platforms must be an array');
    else if (!raw.platforms.includes(platform)) problems.push(`platform ${platform} is not in platforms`);
  }
  if (raw.architectures !== undefined) {
    if (!Array.isArray(raw.architectures)) problems.push('architectures must be an array');
    else if (!raw.architectures.includes(arch)) problems.push(`architecture ${arch} is not in architectures`);
  }
  if (problems.length > 0) return { ok: false, manifest: null, problems };
  return {
    ok: true,
    manifest: { moduleId, moduleVersion, hostApiRange, moduleProtocolVersion: protocol, entry, permissions: permissions ?? [] },
    problems,
  };
}

/**
 * 建一个模块管家。
 *
 * @param options - `{ hostApi, platform, arch, trace }`。
 * @returns 管家的方法集合。
 */
export function createModuleHost(options = {}) {
  const hostApi = options.hostApi ?? HOST_API_VERSION;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const trace = typeof options.trace === 'function' ? options.trace : () => {};
  /** moduleId → 记录。只有显式 install 的模块才在这里（不扫目录）。 */
  const modules = new Map();

  const record = (moduleId) => modules.get(moduleId) ?? null;

  /** 状态迁移的统一入口：非法迁移直接抛，不做"尽力而为"。 */
  function move(entry, next) {
    const allowed = {
      [MODULE_STATE.installedDisabled]: [MODULE_STATE.enabledIdle, MODULE_STATE.ready],
      [MODULE_STATE.enabledIdle]: [MODULE_STATE.ready, MODULE_STATE.installedDisabled, MODULE_STATE.failed],
      [MODULE_STATE.ready]: [MODULE_STATE.quiescing, MODULE_STATE.failed],
      [MODULE_STATE.quiescing]: [MODULE_STATE.installedDisabled, MODULE_STATE.failed],
      [MODULE_STATE.failed]: [MODULE_STATE.installedDisabled],
    };
    if (!allowed[entry.state]?.includes(next)) {
      throw new Error(`module ${entry.manifest.moduleId}: cannot go from ${entry.state} to ${next}`);
    }
    entry.state = next;
    trace('module.state', { id: entry.manifest.moduleId, state: next });
  }

  return {
    /** 装：校验清单、登记为 installed-disabled。**不启用、不执行入口文件**。 */
    install(raw, runtime) {
      const inspected = inspectManifest(raw, { hostApi, platform, arch });
      if (!inspected.ok) return { ok: false, problems: inspected.problems };
      const id = inspected.manifest.moduleId;
      if (modules.has(id)) return { ok: false, problems: [`module ${id} is already installed`] };
      if (typeof runtime?.activate !== 'function') return { ok: false, problems: ['a module must provide activate()'] };
      modules.set(id, {
        manifest: inspected.manifest,
        runtime,
        state: MODULE_STATE.installedDisabled,
        generation: 0,
        admissionEpoch: 1,
        tools: new Map(),
        settings: new Map(),
        disposal: null,
        failure: '',
      });
      return { ok: true, manifest: inspected.manifest };
    },

    /** 启用：只保存用户选择并注册声明；真正激活发生在首次使用。 */
    enable(moduleId) {
      const entry = record(moduleId);
      if (entry === null) return { ok: false, problems: [`module ${moduleId} is not installed`] };
      if (entry.state === MODULE_STATE.enabledIdle || entry.state === MODULE_STATE.ready) return { ok: true };
      move(entry, MODULE_STATE.enabledIdle);
      return { ok: true };
    },

    /** 激活：调扩展的 activate；抛错只把它标成 failed。 */
    async activate(moduleId, api) {
      const entry = record(moduleId);
      if (entry === null) return { ok: false, problems: [`module ${moduleId} is not installed`] };
      if (entry.state !== MODULE_STATE.enabledIdle && entry.state !== MODULE_STATE.installedDisabled) {
        // 已经 ready 的模块再 activate 是幂等的：不新建实例、不改代次（代次只在"停用后重新启用"时变）。
        if (entry.state === MODULE_STATE.ready) return { ok: true, generation: entry.generation, alreadyActive: true };
        return { ok: false, problems: [`module ${moduleId} is ${entry.state}, not enabled`] };
      }
      entry.generation += 1;
      try {
        const disposal = await entry.runtime.activate(api ?? {});
        entry.disposal = typeof disposal === 'function' ? disposal : null;
        move(entry, MODULE_STATE.ready);
        return { ok: true, generation: entry.generation };
      } catch (error) {
        entry.failure = String(error?.message ?? error);
        entry.state = MODULE_STATE.failed;
        return { ok: false, problems: [entry.failure], generation: entry.generation };
      }
    },

    /**
     * 停用：先改准入代次（之后到达的旧代次请求一律拒绝），再调扩展的收尾。
     * @returns `{ ok, admissionEpoch, drained }`。
     */
    async quiesce(moduleId) {
      const entry = record(moduleId);
      if (entry === null) return { ok: false, problems: [`module ${moduleId} is not installed`] };
      if (entry.state !== MODULE_STATE.ready) return { ok: true, admissionEpoch: entry.admissionEpoch };
      entry.admissionEpoch += 1;
      move(entry, MODULE_STATE.quiescing);
      let drained = true;
      if (typeof entry.runtime.quiesce === 'function') {
        try {
          const report = await entry.runtime.quiesce();
          drained = report?.drained !== false;
        } catch (error) {
          // 收尾失败不等于可以假装停干净；如实记下来，让调用方决定。
          drained = false;
          entry.failure = String(error?.message ?? error);
        }
      }
      return { ok: true, admissionEpoch: entry.admissionEpoch, drained };
    },

    /** 卸载前的收尾：deactivate 之后回到 installed-disabled（包文件由调用方处理）。 */
    async deactivate(moduleId) {
      const entry = record(moduleId);
      if (entry === null) return { ok: false, problems: [`module ${moduleId} is not installed`] };
      if (entry.state === MODULE_STATE.installedDisabled) return { ok: true };
      if (entry.state === MODULE_STATE.ready) {
        const quiesced = await this.quiesce(moduleId);
        if (quiesced.ok !== true) return quiesced;
      }
      try {
        if (typeof entry.disposal === 'function') await entry.disposal();
        if (typeof entry.runtime.deactivate === 'function') await entry.runtime.deactivate();
      } catch (error) {
        entry.failure = String(error?.message ?? error);
        entry.state = MODULE_STATE.failed;
        return { ok: false, problems: [entry.failure] };
      }
      entry.disposal = null;
      entry.tools.clear();
      entry.settings.clear();
      entry.state = MODULE_STATE.installedDisabled;
      entry.generation = 0;
      return { ok: true, generation: entry.generation };
    },

    /** 彻底移除登记（不碰磁盘）。仍有在途作业时拒绝，不谎报已卸载。 */
    uninstall(moduleId, { inFlight = 0 } = {}) {
      const entry = record(moduleId);
      if (entry === null) return { ok: false, problems: [`module ${moduleId} is not installed`] };
      if (inFlight > 0) return { ok: false, problems: [`${inFlight} job(s) are still running`], state: 'uninstall-pending' };
      if (entry.state !== MODULE_STATE.installedDisabled && entry.state !== MODULE_STATE.failed) {
        return { ok: false, problems: [`module ${moduleId} is ${entry.state}; deactivate it first`] };
      }
      modules.delete(moduleId);
      return { ok: true };
    },

    /**
     * 登记一个模块工具。名字强制落在 `module.<id>.` 下，核心里已有的名字一律拒绝。
     * @returns `{ ok, name }`。
     */
    registerTool(moduleId, name, definition) {
      const entry = record(moduleId);
      if (entry === null) return { ok: false, problems: [`module ${moduleId} is not installed`] };
      const plain = String(name ?? '');
      if (plain === '' || !/^[a-z][a-z0-9_]*$/.test(plain)) return { ok: false, problems: ['tool names must be lowercase snake_case'] };
      const qualified = `module.${moduleId}.${plain}`;
      if (RESERVED_TOOL_PREFIXES.some((prefix) => plain.startsWith(prefix))) {
        return { ok: false, problems: [`${plain} uses a reserved core prefix`] };
      }
      if (entry.state !== MODULE_STATE.enabledIdle && entry.state !== MODULE_STATE.ready) {
        return { ok: false, problems: [`module ${moduleId} is ${entry.state}; enable it first`] };
      }
      entry.tools.set(qualified, definition);
      return { ok: true, name: qualified };
    },

    /** 当前可派发的工具（停用/未激活时为空）。 */
    toolsFor(moduleId) {
      const entry = record(moduleId);
      if (entry === null || entry.state !== MODULE_STATE.ready) return [];
      return [...entry.tools.keys()];
    },

    /** 一次快照：状态、代次、工具与失败原因。 */
    list() {
      return [...modules.values()].map((entry) => ({
        moduleId: entry.manifest.moduleId,
        moduleVersion: entry.manifest.moduleVersion,
        state: entry.state,
        generation: entry.generation,
        admissionEpoch: entry.admissionEpoch,
        tools: [...entry.tools.keys()],
        failure: entry.failure,
      }));
    },

    get(moduleId) {
      const entry = record(moduleId);
      if (entry === null) return null;
      return {
        moduleId: entry.manifest.moduleId,
        state: entry.state,
        generation: entry.generation,
        admissionEpoch: entry.admissionEpoch,
      };
    },

    /** 停用期间到达的旧代次请求：准入判断的唯一入口。 */
    admits(moduleId, { admissionEpoch } = {}) {
      const entry = record(moduleId);
      if (entry === null) return false;
      if (entry.state !== MODULE_STATE.ready) return false;
      return Number(admissionEpoch) === entry.admissionEpoch;
    },
  };
}
