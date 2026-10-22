/**
 * 挑一个 PowerShell 宿主。
 *
 * 单独成一个模块，而不是留在 `backend/bridge.js` 里：那边的模块一被 import 就带着整个后端
 * （spawn、readline、临时文件），而"PowerShell 在哪"这个问题的读者往往根本不想启动任何东西——
 * 自检（`internal/doctor.mjs`）就是最典型的那个读者，它必须在**不拉起 worker** 的前提下回答
 * "当前环境里电脑操作跑得起来吗"。
 *
 * 候选顺序是有理由的：Windows PowerShell（`powershell.exe`）带着 GAC 里的 WinForms / Drawing /
 * UI Automation 程序集，worker 的截图与 UI 树都依赖它们；PowerShell 7 不保证这些程序集可用，
 * 所以它只排在最后当兜底。
 *
 * 1.40.0 修的是"写了候选、却没有逐个验证"：旧实现在绝对路径不存在时，直接返回第一个裸名字
 * `powershell.exe`，完全没有看 PATH 里到底有没有它；doctor 又用 `existsSync('powershell.exe')`
 * 检查一个裸名字，结果永远是"缺失"。现在裸名字会按 PATH + PATHEXT 真正找一遍，找到就返回
 * **绝对路径**，找不到才退回裸名字交给 spawn 报 `SPAWN_FAILED`。
 */
import { statSync } from 'node:fs';
import { extname, join } from 'node:path';

/** Candidate PowerShell hosts, best first: Windows PowerShell carries the GAC WinForms/Drawing assemblies. */
export const POWERSHELL_CANDIDATES = [
  join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  'powershell.exe',
  'pwsh.exe',
];

/**
 * A candidate is a path rather than a command name.
 * @param candidate - one entry from {@link POWERSHELL_CANDIDATES}.
 * @returns whether it should be checked on disk instead of on PATH.
 */
export function isPathLike(candidate) {
  return candidate.includes('\\') || candidate.includes('/') || /^[A-Za-z]:/.test(candidate);
}

/**
 * One file, not a directory.
 * @param path - absolute path.
 * @returns whether a regular file exists there.
 */
function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * The directories on PATH, with the platform's separator and the quoting Windows allows.
 * @param env - environment mapping (defaults to `process.env`).
 * @returns absolute-or-relative directories, in order.
 */
export function pathDirectories(env = process.env) {
  const raw = String(env.PATH ?? env.Path ?? '');
  const separator = process.platform === 'win32' ? ';' : ':';
  return raw
    .split(separator)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter((entry) => entry !== '');
}

/**
 * The executable extensions Windows will append, in PATHEXT order.
 * @param env - environment mapping.
 * @returns lower-case extensions including the dot; `['']` on non-Windows.
 */
export function executableExtensions(env = process.env) {
  if (process.platform !== 'win32') return [''];
  const raw = String(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD');
  const extensions = raw.split(';').map((entry) => entry.trim().toLowerCase()).filter((entry) => entry !== '');
  return extensions.length > 0 ? extensions : ['.exe'];
}

/**
 * Find a command on PATH the way `CreateProcess` would.
 *
 * A name with an extension is checked literally; a bare name is tried with every PATHEXT
 * extension in order. The first regular file wins, so the answer is the same file the OS would
 * start, not a guess based on the first entry of PATH.
 * @param name - command name, e.g. `powershell.exe`.
 * @param env - environment mapping.
 * @returns the absolute path, or an empty string.
 */
export function findOnPath(name, env = process.env) {
  const hasExtension = extname(name) !== '';
  const extensions = hasExtension ? [''] : executableExtensions(env);
  for (const directory of pathDirectories(env)) {
    for (const extension of extensions) {
      const candidate = join(directory, hasExtension ? name : `${name}${extension}`);
      if (isFile(candidate)) return candidate;
    }
  }
  return '';
}

/**
 * Resolve the PowerShell host and say **how** it was found.
 *
 * The detailed form exists for the doctor: "resolved" alone cannot distinguish "the system
 * copy is there" from "some unrelated `pwsh.exe` is first on PATH", and those two have
 * different capabilities (Windows PowerShell carries the GAC assemblies; PowerShell 7 may not).
 * @param options.candidates - candidate list, in preference order.
 * @param options.env - environment mapping used for PATH/PATHEXT.
 * @returns `{ command, found, source, selected, candidates }`.
 */
export function locatePowerShell({ candidates = POWERSHELL_CANDIDATES, env = process.env } = {}) {
  const details = [];
  for (const candidate of candidates) {
    if (isPathLike(candidate)) {
      const exists = isFile(candidate);
      details.push({ candidate, kind: 'absolute', exists, resolved: exists ? candidate : '' });
      if (exists) {
        return {
          command: candidate,
          found: true,
          source: 'absolute',
          selected: { candidate, kind: 'absolute', exists: true, resolved: candidate },
          candidates: details,
        };
      }
      continue;
    }
    const resolved = findOnPath(candidate, env);
    details.push({ candidate, kind: 'path-lookup', exists: resolved !== '', resolved });
    if (resolved !== '') {
      return {
        command: resolved,
        found: true,
        source: 'path',
        selected: { candidate, kind: 'path-lookup', exists: true, resolved },
        candidates: details,
      };
    }
  }
  const fallback = candidates.find((candidate) => !isPathLike(candidate)) ?? (process.platform === 'win32' ? 'powershell.exe' : 'pwsh');
  return {
    command: fallback,
    found: false,
    source: 'fallback',
    selected: { candidate: fallback, kind: 'path-lookup', exists: false, resolved: '' },
    candidates: details,
  };
}

/**
 * Pick a PowerShell executable that exists.
 *
 * Absolute paths are tried first; a bare name is searched on PATH and returned as an absolute
 * path when found. If nothing is found the first bare name is returned so `spawn` reports
 * `SPAWN_FAILED` with the real command name. This keeps the failure at the process boundary
 * instead of silently substituting an interpreter that may lack the GAC assemblies.
 * @param options - see {@link locatePowerShell}.
 * @returns the resolved command name or absolute path.
 */
export function resolvePowerShell(options = {}) {
  return locatePowerShell(options).command;
}
