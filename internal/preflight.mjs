/**
 * 宿主/依赖预检：把"版本契约"从一句 `engines.node >=20` 变成可核对的事实。
 *
 * 1.39.5 的 manifest 没有 `engines.dsh`，`dsh-tools` / `dsh-scope` 都是 `*`，所以宿主的真实
 * 兼容性检查对 0.0.1-rc.1、0.2.1-rc.2、9.0.0 都不会提出异议——这不是"都能跑"的证据。
 * 本模块只做三件不需要执行插件代码的事：
 *
 *   1. 从当前解析面读 `@deepseek-ai/dsh-app-boot` 的版本，报告"实际宿主版本"；
 *   2. 读两个 peer 的实际解析路径与版本，区分"宿主提供"与"插件目录自带副本"；
 *   3. 用一个足够小的 semver 比较器核对 `engines.dsh` / peer 范围。
 *
 * 裸 Node 下这些解析多半失败，那是正常的：doctor 会把它标成 unknown，而不是推断出一个
 * 看起来权威的"不兼容"。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveHostPackageJson } from './host-packages.mjs';

/** Packages whose versions decide the host contract. */
export const PEER_SPECIFIERS = ['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-scope'];

/**
 * Resolve a package's exported `package.json` and read its version.
 * @param specifier - package name.
 * @returns `{ specifier, resolvable, path, version, error }`.
 */
export function packageInfo(specifier) {
  try {
    const url = import.meta.resolve(`${specifier}/package.json`);
    const path = fileURLToPath(url);
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    return {
      specifier,
      resolvable: true,
      path,
      version: typeof manifest.version === 'string' ? manifest.version : '',
      name: typeof manifest.name === 'string' ? manifest.name : specifier,
      error: '',
    };
  } catch (error) {
    // A `link:` install sits outside every node_modules chain, so the bare specifier fails
    // even though the running application ships the package. Report that copy instead of
    // "unknown" — it is the one the plugin actually loads (see host-packages.mjs).
    const fallback = resolveHostPackageJson(specifier);
    if (fallback !== undefined) {
      try {
        const manifest = JSON.parse(readFileSync(fallback, 'utf8'));
        return {
          specifier,
          resolvable: true,
          path: fallback,
          version: typeof manifest.version === 'string' ? manifest.version : '',
          name: typeof manifest.name === 'string' ? manifest.name : specifier,
          error: '',
          viaApplication: true,
        };
      } catch { /* fall through to the unknown result */ }
    }
    return {
      specifier,
      resolvable: false,
      path: '',
      version: '',
      name: specifier,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * What host this process is running under, as far as package resolution can tell.
 * @returns `{ runtimeVersion, appBootPath, node, electron, executable, platform, arch, resolved }`.
 */
export function detectHost() {
  const appBoot = packageInfo('@deepseek-ai/dsh-app-boot');
  const hostTools = packageInfo('@deepseek-ai/dsh-tools');
  return {
    runtimeVersion: appBoot.version === '' ? null : appBoot.version,
    appBootPath: appBoot.path,
    resolved: appBoot.resolvable,
    resolutionError: appBoot.error,
    // 本插件实际加载的那份 `@deepseek-ai/dsh-tools` 与它的来源。`link:` 安装时它来自运行中的
    // 应用目录（而不是插件旁边），排障时这一行能省掉一轮猜测。
    hostPackages: {
      tools: hostTools.path,
      toolsVersion: hostTools.version === '' ? null : hostTools.version,
      // 按**路径**判断，而不是按"走了哪条解析分支"：装在 profile 里时宿主包可能由适配层
      // 解析到应用目录，那条路也会失败于上次的标记。
      fromApplication: /[\\/]resources[\\/]app[\\/]dsh[\\/]node_modules[\\/]/i.test(hostTools.path),
    },
    node: process.versions.node ?? '',
    electron: process.versions.electron ?? null,
    chrome: process.versions.chrome ?? null,
    executable: process.execPath ?? '',
    platform: process.platform,
    arch: process.arch,
  };
}

/**
 * Parse the numeric and prerelease parts of a semantic version.
 * @param version - e.g. `0.2.1-rc.2`.
 * @returns `{ major, minor, patch, prerelease }` or null when it is not a version.
 */
export function parseVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(version ?? '').trim());
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  };
}

/**
 * Compare two parsed versions, including prerelease ordering.
 * @returns negative, zero, or positive.
 */
export function compareVersions(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  const a = left.prerelease;
  const b = right.prerelease;
  if (a.length === 0 && b.length === 0) return 0;
  // A release outranks any prerelease of the same version.
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const one = a[index];
    const two = b[index];
    if (one === undefined) return -1;
    if (two === undefined) return 1;
    const oneNumeric = /^\d+$/.test(one);
    const twoNumeric = /^\d+$/.test(two);
    if (oneNumeric && twoNumeric) {
      if (Number(one) !== Number(two)) return Number(one) < Number(two) ? -1 : 1;
    } else if (oneNumeric !== twoNumeric) {
      return oneNumeric ? -1 : 1;
    } else if (one !== two) {
      return one < two ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Expand the two convenience ranges used by this project into comparator form.
 * @param token - `^1.2.3`, `~1.2.3`, or an ordinary comparator.
 * @returns an array of comparators.
 */
function expandToken(token) {
  if (token === '' || token === '*' || token.toLowerCase() === 'x') return [];
  if (token.startsWith('^')) {
    const base = parseVersion(token.slice(1));
    if (base === null) return null;
    const upper = base.major > 0
      ? `${base.major + 1}.0.0`
      : base.minor > 0
        ? `0.${base.minor + 1}.0`
        : `0.0.${base.patch + 1}`;
    return [`>=${token.slice(1)}`, `<${upper}`];
  }
  if (token.startsWith('~')) {
    const base = parseVersion(token.slice(1));
    if (base === null) return null;
    return [`>=${token.slice(1)}`, `<${base.major}.${base.minor + 1}.0`];
  }
  return [token];
}

/**
 * A small semver `satisfies` for the ranges this package declares.
 *
 * It deliberately does not pretend to be npm: unsupported syntax returns `null` ("unknown"),
 * never `false`. Only `||`, whitespace-separated comparators, `=`, `>`, `>=`, `<`, `<=`, `^`,
 * `~`, and `*` are understood.
 * @param version - version to test.
 * @param range - declared range.
 * @returns true, false, or null when the range cannot be evaluated.
 */
export function satisfies(version, range) {
  const subject = parseVersion(version);
  if (subject === null) return null;
  const alternatives = String(range ?? '').split('||');
  if (alternatives.length === 0) return null;
  let sawUnknown = false;
  for (const alternative of alternatives) {
    const tokens = alternative.trim().split(/\s+/).filter((token) => token !== '');
    const comparators = [];
    for (const token of tokens) {
      const expanded = expandToken(token);
      if (expanded === null) {
        sawUnknown = true;
        continue;
      }
      comparators.push(...expanded);
    }
    let holds = true;
    for (const comparator of comparators) {
      const match = /^(>=|<=|>|<|=)?(.+)$/.exec(comparator);
      if (match === null) {
        sawUnknown = true;
        continue;
      }
      const operator = match[1] ?? '=';
      const parsed = parseVersion(match[2]);
      if (parsed === null) {
        sawUnknown = true;
        continue;
      }
      const order = compareVersions(subject, parsed);
      const ok = operator === '=' ? order === 0
        : operator === '>' ? order > 0
          : operator === '>=' ? order >= 0
            : operator === '<' ? order < 0
              : order <= 0;
      if (!ok) {
        holds = false;
        break;
      }
    }
    if (holds) return true;
  }
  return sawUnknown ? null : false;
}

/**
 * The peer/local-copy report the doctor renders.
 * @returns `{ tools, scope }`, each with `localToPlugin` and `range`.
 */
export function peerReport() {
  const report = {};
  for (const specifier of PEER_SPECIFIERS) {
    report[specifier.split('/').at(-1)] = packageInfo(specifier);
  }
  return report;
}
