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
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Candidate PowerShell hosts, best first: Windows PowerShell carries the GAC WinForms/Drawing assemblies. */
export const POWERSHELL_CANDIDATES = [
  join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  'powershell.exe',
  'pwsh.exe',
];

/**
 * Pick a PowerShell executable that exists.
 *
 * 绝对路径先按存在的挑；一个都不存在时退回第一个裸名字，交给 PATH —— spawn 会以 `SPAWN_FAILED`
 * 把话说清楚，这比在这里悄悄换一个解释器好：换掉的解释器可能缺 GAC 程序集，于是失败会推迟到
 * 某一个具体动作上，而且看起来像是那个动作的问题。
 * @returns the resolved command name.
 */
export function resolvePowerShell() {
  for (const candidate of POWERSHELL_CANDIDATES) {
    if (candidate.includes('\\') || candidate.includes('/')) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return POWERSHELL_CANDIDATES.find((candidate) => !candidate.includes('\\') && !candidate.includes('/'))
    ?? 'powershell.exe';
}
