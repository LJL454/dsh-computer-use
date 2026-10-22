/**
 * 离线 profile 检查：DSH 打不开时也能回答"装在哪、指向哪、有没有重复挂载"。
 *
 * `collectDoctorReport()` 里的工具注册、schema 可见性、后端状态都只有宿主活着才拿得到；
 * 而本次事故最需要证据的恰恰是宿主起不来的时刻。这个模块只读 profile 目录：
 *
 *   * 依赖 spec（`link:` / `file:`）解析到的真实路径、包名、版本；
 *   * `dsh.profile.bundles` 里到底有没有这个 bundle；
 *   * 用户自己的 `cordis.patch.yml` 里有没有第二份挂载行；
 *   * 旧的独立包（`@local/dsh-token-guard` / `@local/dsh-app-launch`）是否还在贡献；
 *   * profile / 插件目录里有没有自带的核心包副本。
 *
 * 它不读 `.credentials.yaml`，不打印令牌、代理口令或无关会话内容。
 */
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/** The package this check is about. */
export const PACKAGE_NAME = '@local/dsh-computer-use';
/** Packages merged into this one; still being enabled is a migration warning. */
export const LEGACY_PACKAGES = ['@local/dsh-token-guard', '@local/dsh-app-launch'];
/** Core packages that must come from the host, not the profile or the plugin tree. */
export const CORE_PACKAGES = ['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-scope'];

/**
 * Resolve the Harness home the way `@deepseek-ai/dsh-home-paths` does.
 * @param env - environment mapping.
 * @returns the absolute home directory.
 */
export function resolveDshHome(env = process.env) {
  const configured = String(env.DSH_HOME ?? '').trim();
  return configured === '' ? join(homedir(), '.dsh') : resolve(configured);
}

/**
 * Resolve a profile name or path.
 * @param profile - `desktop`, an absolute/relative path, or empty.
 * @param env - environment mapping.
 * @returns the absolute profile directory, or an empty string for "not requested".
 */
export function resolveProfileDir(profile, env = process.env) {
  const value = String(profile ?? '').trim();
  if (value === '') return '';
  if (value.includes('/') || value.includes('\\') || isAbsolute(value) || existsSync(value)) return resolve(value);
  return join(resolveDshHome(env), 'profiles', value);
}

/**
 * Read a JSON file, with the error kept rather than thrown.
 * @param path - file to read.
 * @returns `{ ok, value, error }`.
 */
function readJson(path) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')), error: '' };
  } catch (error) {
    return { ok: false, value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Expand an npm dependency spec into a local directory when it is one.
 * @param spec - e.g. `link:E:/plugins/x`, `file:../x`, `^1.0.0`.
 * @param profileDir - directory the spec is relative to.
 * @returns `{ kind, path }`; `path` is empty for registry specs.
 */
export function localDependencyPath(spec, profileDir) {
  const value = String(spec ?? '').trim();
  if (value.startsWith('link:')) return { kind: 'link', path: resolve(profileDir, value.slice(5)) };
  if (value.startsWith('file:')) return { kind: 'file', path: resolve(profileDir, value.slice(5)) };
  if (value.startsWith('.') || value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) {
    return { kind: 'path', path: resolve(profileDir, value) };
  }
  return { kind: 'registry', path: '' };
}

/**
 * Describe the package at a directory.
 * @param directory - candidate package root.
 * @returns `{ exists, name, version, error }`.
 */
function packageAt(directory) {
  if (directory === '' || !existsSync(directory)) return { exists: false, name: '', version: '', error: '' };
  const manifest = readJson(join(directory, 'package.json'));
  if (!manifest.ok) return { exists: true, name: '', version: '', error: manifest.error };
  return {
    exists: true,
    name: String(manifest.value?.name ?? ''),
    version: String(manifest.value?.version ?? ''),
    error: '',
  };
}

/**
 * The real path of `<profile>/node_modules/<name>`, if it exists.
 * @param profileDir - profile directory.
 * @param name - package name.
 * @returns `{ present, path, realPath }`.
 */
function installedPath(profileDir, name) {
  const path = join(profileDir, 'node_modules', ...name.split('/'));
  try {
    const info = lstatSync(path);
    let realPath = path;
    try {
      realPath = realpathSync(path);
    } catch {
      // A broken junction is still a present-but-broken entry; keep the lexical path.
    }
    return { present: true, path, realPath, symlink: info.isSymbolicLink() };
  } catch {
    return { present: false, path, realPath: '', symlink: false };
  }
}

/**
 * Count the plugin's mount rows in a user patch file.
 * @param path - `cordis.patch.yml` path.
 * @returns `{ present, rows, lines }`.
 */
function scanUserPatch(path) {
  if (!existsSync(path)) return { present: false, rows: 0, lines: [], legacy: [] };
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { present: true, rows: 0, lines: [], legacy: [], error: 'unreadable' };
  }
  const lines = text.split(/\r?\n/);
  const rows = [];
  const legacy = [];
  lines.forEach((line, index) => {
    if (new RegExp(`^\\s*name:\\s*['"]?${PACKAGE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`).test(line)) {
      rows.push(index + 1);
    }
    for (const name of LEGACY_PACKAGES) {
      if (new RegExp(`^\\s*name:\\s*['"]?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`).test(line)) {
        legacy.push({ name, line: index + 1 });
      }
    }
  });
  return { present: true, rows: rows.length, lines: rows, legacy };
}

/**
 * Inspect one profile offline.
 * @param options.profile - profile name or directory.
 * @param options.pluginRoot - the currently running plugin's package root.
 * @param options.packageName - package to look for.
 * @param options.env - environment mapping.
 * @returns a report with `findings`, `dependencies`, `bundles`, `patch`, `coreCopies`.
 */
export function inspectProfile({
  profile,
  pluginRoot = '',
  packageName = PACKAGE_NAME,
  env = process.env,
} = {}) {
  const dir = resolveProfileDir(profile, env);
  const findings = [];
  const note = (level, code, message, action) => findings.push({ level, code, message, action });
  if (dir === '') {
    return { requested: false, dir: '', findings, dependencies: {}, bundles: [], patch: null, coreCopies: [] };
  }
  const manifestPath = join(dir, 'package.json');
  if (!existsSync(manifestPath)) {
    note('fatal', 'PROFILE_NOT_FOUND',
      `找不到 profile 的 package.json：${manifestPath}。`,
      '确认 --profile 指向真正的 profile 目录；标准位置是 $DSH_HOME/profiles/<name>。');
    return { requested: true, dir, findings, dependencies: {}, bundles: [], patch: null, coreCopies: [] };
  }
  const read = readJson(manifestPath);
  if (!read.ok) {
    note('fatal', 'PROFILE_MANIFEST_INVALID',
      `profile 的 package.json 无法解析：${read.error}`,
      '先修复 JSON 语法，再重试；不要用整份覆盖来"修"配置。');
    return { requested: true, dir, findings, dependencies: {}, bundles: [], patch: null, coreCopies: [] };
  }
  const manifest = read.value ?? {};
  const dependencies = manifest.dependencies ?? {};
  const bundles = Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles.map(String) : [];
  const spec = dependencies[packageName];
  const dependency = spec === undefined
    ? { declared: false, spec: null, kind: '', path: '', package: null, installed: installedPath(dir, packageName) }
    : { declared: true, spec: String(spec), ...(() => {
      const local = localDependencyPath(spec, dir);
      return { ...local, package: packageAt(local.path), installed: installedPath(dir, packageName) };
    })() };

  if (!dependency.declared) {
    note('fatal', 'PROFILE_DEPENDENCY_MISSING',
      `profile 没有声明 ${packageName}。`,
      `在目标 profile 上运行：dsh plugin --profile <name> add "<插件根>"。`);
  } else if (dependency.kind === 'link' || dependency.kind === 'file' || dependency.kind === 'path') {
    if (!dependency.package.exists) {
      note('fatal', 'PROFILE_LINK_MISSING',
        `${packageName} 指向 ${dependency.path}，但那里没有 package.json。`,
        '把插件解压到长期保留的目录后重新 add；link 安装后不能删除或移动该目录。');
    } else if (dependency.package.name !== packageName) {
      note('fatal', 'PROFILE_LINK_MISMATCH',
        `${packageName} 指向的目录实际是 ${dependency.package.name || '(无名包)'}。`,
        '重新指向真正的插件根（含 package.json、index.js、cordis.patch.yml 的那一层）。');
    }
    if (dependency.installed.present && dependency.installed.realPath !== ''
      && dependency.package.exists && realpathSync(dependency.path) !== dependency.installed.realPath) {
      note('warn', 'PROFILE_INSTALLED_PATH_MISMATCH',
        `profile 的 node_modules 实际解析到 ${dependency.installed.realPath}，与 manifest 声明的 ${dependency.path} 不同。`,
        '这说明旧链接或手工拷贝仍在生效；完整退出 DSH 后重新 add，别在运行中覆盖目录。');
    }
  }

  if (!bundles.includes(packageName)) {
    note('warn', 'BUNDLE_NOT_ENABLED',
      `${packageName} 已在依赖里，但不在 dsh.profile.bundles 中；它的 cordis.patch.yml 不会被读取。`,
      '这是"已有依赖但缺 bundle"的已知情况：dsh plugin add 不会为已有依赖自动补 bundle。手动把包名加入 bundles（或先 remove 再 add），然后重启。');
  } else if (bundles.filter((name) => name === packageName).length > 1) {
    note('warn', 'PROFILE_BUNDLE_DUPLICATE',
      `dsh.profile.bundles 里出现了 ${bundles.filter((name) => name === packageName).length} 次 ${packageName}。`,
      '同一 bundle 只应出现一次；重复项会让 patch 被合成两遍，进而重复挂载。删除多余项后重启。');
  }

  const patch = scanUserPatch(join(dir, 'cordis.patch.yml'));
  if (patch.rows > 0) {
    note('warn', 'PROFILE_EXTRA_MOUNT',
      `用户 patch 里还有 ${patch.rows} 行 ${packageName}（第 ${patch.lines.join('、')} 行）。`,
      'bundle 已经插入一份全局行；用户 patch 再插一份会重复注册 /computer-use/* 路由。删除明确重复的那一份，保留一份。');
  }
  if (patch.legacy.length > 0) {
    note('warn', 'LEGACY_PACKAGE_ACTIVE',
      `用户 patch 仍引用旧独立包：${patch.legacy.map((entry) => `${entry.name}（第 ${entry.line} 行）`).join('、')}。`,
      '这两个包的功能已并入本插件；先迁移 tokenGuard/appLaunch 配置，再移除旧行。');
  }
  for (const name of LEGACY_PACKAGES) {
    if (dependencies[name] !== undefined) {
      note('warn', 'LEGACY_DEPENDENCY_ACTIVE',
        `profile 仍依赖旧独立包 ${name}。`,
        '确认它的贡献已被本插件覆盖后，remove 旧包；不要只删除磁盘目录。');
    }
    if (bundles.includes(name)) {
      note('warn', 'LEGACY_BUNDLE_ACTIVE',
        `profile 的 bundles 仍启用旧独立包 ${name}。`,
        '迁移配置后把它从 bundles 移除，避免重复钩子/工具/预设。');
    }
  }

  const coreCopies = [];
  for (const name of CORE_PACKAGES) {
    for (const [where, root] of [['profile', dir], ['plugin', pluginRoot]]) {
      if (root === '') continue;
      const found = packageAt(join(root, 'node_modules', ...name.split('/')));
      if (!found.exists) continue;
      const entry = { package: name, where, path: join(root, 'node_modules', ...name.split('/')), version: found.version };
      coreCopies.push(entry);
      note('warn', 'CORE_PACKAGE_COPY',
        `${where} 目录里有一份 ${name}@${found.version || '(未知版本)'}：${entry.path}。`,
        '核心包应由宿主提供；不要为了修 ERR_MODULE_NOT_FOUND 在插件目录安装 latest。确认这份副本指向宿主自带版本，或移除它让宿主解析。');
    }
  }

  return {
    requested: true,
    dir,
    packageName,
    packageVersion: dependency.package?.version ?? '',
    dependency,
    bundles,
    patch,
    coreCopies,
    findings,
  };
}
