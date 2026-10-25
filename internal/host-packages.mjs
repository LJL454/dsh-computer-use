/**
 * 解析宿主自有包（`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-scope`）。
 *
 * 为什么不能直接 `import '@deepseek-ai/dsh-tools'`
 * ------------------------------------------------
 * `dsh plugin add` 以 `link:` 安装时，模块位于用户解压目录（`D:\Plugins\dsh-computer-use`），
 * Node 会从那里逐级向上找 `node_modules`；宿主那份在
 * `<app>\resources\app.asar\dsh\node_modules`（或旧的展开目录），不在链上。
 *
 * 1.39.5 能工作，是因为 manifest 声明了这两个 peer：官方 `dsh-app-boot` 的 `routeLinked()`
 * 会读外部链接插件的 peer 名称，命中就交给宿主的拦截解析器（interception）。1.40.2 删掉
 * peer 声明以避开“包管理器装一份核心包副本”，同时把这条官方通路也切断了，只剩本文件的手动
 * 兜底——而旧兜底只认识 `resources\app\dsh\node_modules`。
 *
 * 1.40.3 的解析顺序（研究报告 P0-A / P0-B）
 * ----------------------------------------
 *   1. **官方通路优先**：先试裸说明符。宿主的拦截解析器命中时，拿到的就是宿主共享实例。
 *   2. **只认已识别宿主的那一份**：若裸说明符落到别的副本（插件旁、另一个 profile），记为
 *      `HOST_PACKAGE_LOCAL_COPY` 并改用活动宿主的副本，避免两套实例混用。
 *   3. **只在“找不到”时兜底**：从真实锚点（CLI 入口、`process.resourcesPath`、可执行文件旁的
 *      `resources\app` 与 `resources\app.asar`、npm 布局）定位。选定后初始化失败就**原样抛出**，
 *      不再换另一份副本。
 *   4. **显式覆盖要报冲突**：`DSH_APP_MODULES` 只作为被验证的候选；与活动宿主指向不同实例时抛
 *      `HOST_INSTANCE_CONFLICT`。
 *   5. **记录解析事实**：说明符、入口、来源、运行时类型、版本、尝试列表都留档，doctor 与
 *      `detectHost()` 读同一份记录。
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 插件根目录（`internal/` 的上一层）。 */
export const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 结构化错误码：既挂在 `error.code`，也进 doctor 报告。 */
export const HOST_CODES = Object.freeze({
  NOT_IDENTIFIED: 'HOST_NOT_IDENTIFIED',
  ASAR_RUNTIME_REQUIRED: 'ASAR_RUNTIME_REQUIRED',
  PACKAGE_NOT_RESOLVED: 'HOST_PACKAGE_NOT_RESOLVED',
  PACKAGE_IMPORT_FAILED: 'HOST_PACKAGE_IMPORT_FAILED',
  INSTANCE_CONFLICT: 'HOST_INSTANCE_CONFLICT',
  LOCAL_COPY: 'HOST_PACKAGE_LOCAL_COPY',
});

/** 每个宿主包的入口文件（相对其 node_modules 根）。 */
const ENTRIES = {
  '@deepseek-ai/dsh-tools': ['@deepseek-ai', 'dsh-tools', 'lib', 'index.js'],
  '@deepseek-ai/dsh-scope': ['@deepseek-ai', 'dsh-scope', 'lib', 'index.js'],
};

const MODULES = new Map();
const RECORDS = new Map();

/** 归一化用于比较的路径（Windows 大小写不敏感）。 */
function pathKey(path) {
  if (typeof path !== 'string' || path === '') return '';
  return normalize(path).replace(/[\\/]+$/, '').toLowerCase();
}

function inside(parent, child) {
  const a = pathKey(parent);
  const b = pathKey(child);
  return a !== '' && b !== '' && (b === a || b.startsWith(`${a}\\`) || b.startsWith(`${a}/`));
}

function safeRealpath(path) {
  try {
    return realpathSync.native(path);
  } catch {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  }
}

function safeResolve(specifier) {
  try {
    const url = import.meta.resolve(specifier);
    return url.startsWith('file:') ? fileURLToPath(url) : url;
  } catch {
    return undefined;
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 从一条路径判断宿主运行时类型。
 * @param {string} path - 入口文件或其所在根目录。
 * @returns {'desktop-asar'|'desktop-unpacked'|'npm-cli'|'custom'|'unknown'}
 */
export function hostRuntimeKind(path) {
  const value = String(path ?? '').replace(/\//g, '\\').toLowerCase();
  if (value === '') return 'unknown';
  if (value.includes('\\resources\\app.asar\\')) return 'desktop-asar';
  if (value.includes('\\resources\\app\\dsh\\node_modules')) return 'desktop-unpacked';
  if (value.includes('\\node_modules\\@deepseek-ai\\dsh\\')) return 'npm-cli';
  if (value.includes('\\node_modules\\')) return 'custom';
  // 候选根本身就是 `<...>/node_modules`（npm 布局）：没有尾部分隔符，单独认一次。
  if (value.endsWith('\\node_modules') || value.endsWith('/node_modules')) return 'custom';
  return 'unknown';
}

/** 当前进程是否运行在 Electron 的 Node 模式（能读 asar）。 */
export function runsInElectron() {
  return typeof process.versions.electron === 'string' && process.versions.electron !== '';
}

/** 一个根对应的运行时类型：npm 布局的根是 `<...>/node_modules`，光看根路径认不出来。 */
function kindForRoot(root) {
  const kind = hostRuntimeKind(root);
  if (kind === 'custom' && existsSync(join(root, '@deepseek-ai', 'dsh', 'package.json'))) return 'npm-cli';
  return kind;
}

/**
 * 从一个锚点推导候选 node_modules 根。
 * @param {string} anchor - 绝对路径（文件或目录）。
 * @param {string} source - 记录用的来源标签。
 * @param {{ explicit?: boolean }} options
 * @returns {Array<{root:string, source:string, explicit:boolean}>}
 */
function rootsFromAnchor(anchor, source, { explicit = false } = {}) {
  const found = [];
  if (typeof anchor !== 'string' || anchor === '' || !isAbsolute(anchor)) return found;

  const add = (root) => {
    if (typeof root !== 'string' || !isAbsolute(root)) return;
    // asar 内的目录在普通 Node 下 existsSync 为 false；归档本身是普通文件，**存在**。
    // 这里要区分两种 asar 候选：
    //   * Electron 下可读（existsSync 为真）→ 它就是活动宿主，必须参与实例冲突判断；
    //   * 普通 Node 下不可读 → 记成 virtual，只用于诊断（ASAR_RUNTIME_REQUIRED），
    //     不参与“活动宿主”判定，否则测试里的显式覆盖会被误判成冲突。
    const marker = root.toLowerCase().indexOf('\\app.asar\\');
    if (marker > 0) {
      const archive = root.slice(0, marker + '\\app.asar'.length);
      if (!existsSync(archive)) return;
      const readable = existsSync(root);
      found.push({ root: readable ? safeRealpath(root) : root, source, explicit, virtual: !readable });
      return;
    }
    if (existsSync(root) && isDirectory(root)) {
      found.push({ root: safeRealpath(root), source, explicit, virtual: false });
    }
  };

  const seeds = [anchor];
  if (!isDirectory(anchor)) seeds.push(dirname(anchor));
  for (const seed of seeds) {
    add(join(seed, 'resources', 'app.asar', 'dsh', 'node_modules'));
    add(join(seed, 'resources', 'app', 'dsh', 'node_modules'));
    add(join(seed, 'app.asar', 'dsh', 'node_modules'));
    add(join(seed, 'app', 'dsh', 'node_modules'));
    add(join(seed, 'dsh', 'node_modules'));
    let cursor = isDirectory(anchor) ? anchor : dirname(anchor);
    for (let depth = 0; cursor && depth < 12; depth += 1) {
      add(join(cursor, 'node_modules'));
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  return found;
}

/**
 * 宿主候选根，按可信度从高到低；只保留确实带 `@deepseek-ai/dsh-tools|dsh-scope` 的根。
 * @returns {Array<{root:string, source:string, explicit:boolean}>}
 */
export function candidateRootDetails() {
  const out = [];
  const seen = new Set();
  const push = (candidate) => {
    const key = pathKey(candidate.root);
    if (key === '' || seen.has(key)) return;
    if (candidate.virtual !== true
      && !existsSync(join(candidate.root, '@deepseek-ai', 'dsh-tools'))
      && !existsSync(join(candidate.root, '@deepseek-ai', 'dsh-scope'))) return;
    seen.add(key);
    out.push(candidate);
  };

  // 1. 显式覆盖（测试 / 非常规安装）
  if (process.env.DSH_APP_MODULES) {
    push({ root: safeRealpath(normalize(process.env.DSH_APP_MODULES)), source: 'DSH_APP_MODULES', explicit: true });
  }

  // 2. 进程命令行里的真实入口：桌面是 dsh-desktop-host/index.js，npm 是 node.exe <cli.js>
  for (const arg of process.argv.slice(1)) {
    if (typeof arg !== 'string' || arg === '') continue;
    for (const candidate of rootsFromAnchor(arg, 'process.argv')) push(candidate);
  }

  // 3. Electron 运行时信息
  if (typeof process.resourcesPath === 'string' && process.resourcesPath !== '') {
    for (const candidate of rootsFromAnchor(process.resourcesPath, 'process.resourcesPath')) push(candidate);
  }

  // 4. 可执行文件旁边（桌面安装）
  if (typeof process.execPath === 'string' && process.execPath !== '') {
    for (const candidate of rootsFromAnchor(dirname(process.execPath), 'process.execPath')) push(candidate);
  }

  // 5. 默认安装位置：仅在没有更具体身份时作为发现线索
  if (out.length === 0) {
    const defaults = [
      process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness'),
      process.env.ProgramFiles && join(process.env.ProgramFiles, 'DeepSeek Harness'),
      process.env.ProgramW6432 && join(process.env.ProgramW6432, 'DeepSeek Harness'),
    ].filter(Boolean);
    for (const base of defaults) {
      for (const candidate of rootsFromAnchor(base, 'default-install')) push(candidate);
    }
  }
  return out;
}

/** Back-compat：只要根路径字符串。 */
export function candidateHostRoots() {
  return candidateRootDetails().map((candidate) => candidate.root);
}

/** 已识别的活动宿主根（`DSH_APP_MODULES` 是覆盖而不是证据；asar 虚拟候选只用于诊断）。 */
function activeHostRoot() {
  return candidateRootDetails().find((candidate) => candidate.explicit !== true && candidate.virtual !== true);
}

function packageJsonAt(root, specifier) {
  const parts = specifier.replace(/^@/, '').split('/');
  if (parts.length !== 2) return undefined;
  const path = join(root, `@${parts[0]}`, parts[1], 'package.json');
  return existsSync(path) ? path : undefined;
}

function entryAt(root, specifier) {
  const parts = ENTRIES[specifier];
  if (parts === undefined) return undefined;
  const path = join(root, ...parts);
  return existsSync(path) ? path : undefined;
}

function manifestVersion(packageJson) {
  const manifest = packageJson === undefined ? undefined : readJson(packageJson);
  return typeof manifest?.version === 'string' ? manifest.version : '';
}

/** 判断裸说明符解析到的模块是不是插件自己带的副本。 */
function isPluginLocalCopy(entry) {
  return entry !== undefined && inside(PLUGIN_ROOT, safeRealpath(entry));
}

function makeError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

/**
 * 导入宿主包，并记录这次解析的事实。
 * @param {string} specifier - `@deepseek-ai/dsh-tools` / `@deepseek-ai/dsh-scope`。
 * @returns {Promise<any>} 模块命名空间。
 */
export async function importHostModule(specifier) {
  if (MODULES.has(specifier)) return MODULES.get(specifier);

  const record = { specifier, selected: null, attempts: [], codes: [], degraded: false };
  RECORDS.set(specifier, record);

  // 0. 先确定候选与活动宿主，再做实例冲突判断。
  //    这段必须在裸导入之前：官方通路能成功，不代表 DSH_APP_MODULES 指的那份就是对的；
  //    “悄悄忽略覆盖”与“悄悄换成另一套运行时”都不允许（报告 P0-B 第 4 条）。
  const roots = candidateRootDetails();
  const explicit = roots.find((candidate) => candidate.explicit === true);
  const active = roots.find((candidate) => candidate.explicit !== true && candidate.virtual !== true);
  if (explicit !== undefined && active !== undefined && pathKey(explicit.root) !== pathKey(active.root)) {
    record.codes.push(HOST_CODES.INSTANCE_CONFLICT);
    record.attempts.push({ source: 'conflict', candidate: explicit.root, ok: false, code: HOST_CODES.INSTANCE_CONFLICT, error: `active host ${active.root}` });
    throw makeError(
      HOST_CODES.INSTANCE_CONFLICT,
      `DSH_APP_MODULES points at ${explicit.root}, but the running host is ${active.root}. `
      + 'Refusing to mix two host instances: unset DSH_APP_MODULES or point it at the running host.',
      { resolution: record },
    );
  }

  const bareEntry = safeResolve(specifier);

  // 1. 官方通路：裸说明符。
  //
  // 注意 `safeResolve` 只是“记录用”的旁证：测试用 `module.registerHooks` 注入 stub 时，
  // `import.meta.resolve` 看不到钩子，可能返回 undefined 或别的位置。所以判据是**导入本身**，
  // 解析路径有则拿来分类，没有就按“宿主解析器给的”记。
  try {
    const module = await import(specifier);
    const localCopy = bareEntry !== undefined && isPluginLocalCopy(bareEntry);
    if (localCopy && active !== undefined) {
      // 插件旁边那份不算宿主：记下来，改用活动宿主
      record.codes.push(HOST_CODES.LOCAL_COPY);
      record.degraded = true;
      record.attempts.push({
        source: 'bare',
        candidate: bareEntry,
        ok: false,
        code: HOST_CODES.LOCAL_COPY,
        error: 'resolved into the plugin directory while a host is reachable',
      });
    } else {
      if (localCopy) {
        record.codes.push(HOST_CODES.LOCAL_COPY);
        record.degraded = true;
      }
      const packageJson = safeResolve(`${specifier}/package.json`) ?? '';
      record.attempts.push({ source: 'bare', candidate: bareEntry ?? '', ok: true });
      record.selected = {
        entry: bareEntry ?? '',
        canonicalEntry: bareEntry === undefined ? '' : safeRealpath(bareEntry),
        packageJson,
        version: manifestVersion(packageJson),
        source: localCopy ? 'plugin-local-copy' : 'host-specifier',
        root: bareEntry === undefined ? '' : dirname(dirname(dirname(dirname(bareEntry)))),
        runtimeKind: bareEntry === undefined ? 'unknown' : hostRuntimeKind(bareEntry),
      };
      MODULES.set(specifier, module);
      return module;
    }
  } catch (error) {
    record.attempts.push({ source: 'bare', candidate: bareEntry ?? '', ok: false, code: error?.code ?? '', error: String(error?.message ?? error) });
  }

  // 2. （冲突判断已在上方完成——它必须先于裸导入，避免“官方解析成功就悄悄忽略覆盖”。）

  // 3. 兜底：按候选根定位，找到即用；导入失败原样抛出
  const order = explicit === undefined ? roots : [explicit, ...roots.filter((candidate) => candidate !== explicit)];
  for (const candidate of order) {
    const entry = entryAt(candidate.root, specifier);
    if (entry === undefined) continue;
    try {
      const module = await import(pathToFileURL(entry).href);
      record.attempts.push({ source: candidate.source, candidate: entry, ok: true });
      record.selected = {
        entry,
        canonicalEntry: safeRealpath(entry),
        packageJson: packageJsonAt(candidate.root, specifier) ?? '',
        version: manifestVersion(packageJsonAt(candidate.root, specifier)),
        source: candidate.source,
        root: candidate.root,
        runtimeKind: kindForRoot(candidate.root),
      };
      MODULES.set(specifier, module);
      return module;
    } catch (error) {
      record.attempts.push({ source: candidate.source, candidate: entry, ok: false, code: error?.code ?? '', error: String(error?.message ?? error) });
      throw makeError(
        HOST_CODES.PACKAGE_IMPORT_FAILED,
        `${specifier} resolved to ${entry} (${candidate.source}) but failed to initialize: ${error?.message ?? error}`,
        { cause: error, resolution: record },
      );
    }
  }

  // 4. 哪个都没找到：区分“普通 Node 读不了 asar”与“单纯没装对”
  const asarBesideExe = typeof process.execPath === 'string'
    && existsSync(join(dirname(process.execPath), 'resources', 'app.asar'));
  const sawVirtual = roots.some((candidate) => candidate.virtual === true);
  const code = (sawVirtual || asarBesideExe) && !runsInElectron() ? HOST_CODES.ASAR_RUNTIME_REQUIRED : HOST_CODES.PACKAGE_NOT_RESOLVED;
  record.codes.push(code);
  record.degraded = true;
  throw makeError(
    code,
    `${specifier} is not reachable: no host package was found from ${process.execPath || '(unknown executable)'} `
    + `(runtime=${runsInElectron() ? 'electron' : 'node'}). `
    + `Attempted: ${record.attempts.map((attempt) => `${attempt.source}:${attempt.candidate || '-'}`).join(', ')}. `
    + 'Set DSH_APP_MODULES to the running host\'s node_modules, or install the plugin inside the host profile.',
    { resolution: record },
  );
}

/** 已选中的入口（导入后可靠）；未导入时按候选根查找。 */
export function resolveHostEntry(specifier) {
  const record = RECORDS.get(specifier);
  if (record?.selected?.entry) return record.selected.entry;
  for (const candidate of candidateRootDetails()) {
    const entry = entryAt(candidate.root, specifier);
    if (entry !== undefined) return entry;
  }
  return undefined;
}

/** 已选中的 package.json；用于版本与实例判断。 */
export function resolveHostPackageJson(specifier) {
  const record = RECORDS.get(specifier);
  if (record?.selected?.packageJson) return record.selected.packageJson;
  const viaSpecifier = safeResolve(`${specifier}/package.json`);
  if (viaSpecifier !== undefined && existsSync(viaSpecifier) && !isPluginLocalCopy(viaSpecifier)) return viaSpecifier;
  for (const candidate of candidateRootDetails()) {
    const path = packageJsonAt(candidate.root, specifier);
    if (path !== undefined) return path;
  }
  return undefined;
}

/** 给人看的一行：描述**实际选中**的那份，而不是再扫一遍候选。 */
export function describeHostEntry(specifier) {
  const record = RECORDS.get(specifier);
  if (record?.selected) {
    return `${record.selected.entry} (${record.selected.source}, ${record.selected.runtimeKind})`;
  }
  const entry = resolveHostEntry(specifier);
  return entry === undefined ? '(resolved by the host\'s own specifier)' : `${entry} (candidate, not imported yet)`;
}

/** 某个说明符的解析记录。 */
export function hostResolution(specifier) {
  return RECORDS.get(specifier);
}

/** 所有已记录的解析事实（doctor / status 用）。 */
export function hostResolutionReport() {
  return [...RECORDS.values()];
}

/** `createRequire` 锚点解析：诊断层不 import 也能问“这个包在哪”。 */
export function resolveFromAnchor(anchor, specifier) {
  try {
    return createRequire(anchor).resolve(specifier);
  } catch {
    return undefined;
  }
}
