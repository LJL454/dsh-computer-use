/**
 * 安全软件拦截：把"后端起不来"里的 AV/AMSI 一类单独认出来。
 *
 * 研究报告 P1-B：Defender 拦 `worker.ps1` 是**另一层故障**，不能用它解释"挂载前 404"，
 * 也不能反过来把宿主加载失败说成被杀软拦住。两者要分开报：
 *
 *   * 宿主加载 / 工具注册 —— 与 PowerShell 无关；
 *   * worker 启动 —— 可能被 AMSI 或实时防护拦下。
 *
 * 这里只做纯文本判别，不读注册表、不改 AMSI、不建议用户加排除项。
 */

/** 稳定错误码：模型与 doctor 都按它归类。 */
export const SECURITY_BLOCK_CODE = 'BACKEND_BLOCKED_BY_AV';

/** 已知签名。顺序即优先级：AMSI 的措辞最具体，放最前。 */
const SIGNATURES = [
  {
    kind: 'amsi',
    vendor: 'Windows Defender / AMSI',
    test: /ScriptContainedMaliciousContent|This script contains malicious content|Antimalware Scan Interface|\bAMSI\b|0x8007661[0-9A-F]/i,
  },
  {
    kind: 'quarantine',
    vendor: 'antivirus quarantine',
    test: /Operation did not complete successfully because the file contains a virus|virus or potentially unwanted software|has been quarantined|blocked by (?:your )?(?:antivirus|antimalware)/i,
  },
  {
    kind: 'execution-policy',
    vendor: 'AppLocker / WDAC',
    test: /was blocked by your system administrator|blocked by group policy|contact your system administrator|AppLocker|WDAC|CodeIntegrity|cannot be run because it is not digitally signed/i,
  },
];

/**
 * 判断一段后端错误文本是不是安全软件拦截。
 * @param {unknown} text - 错误消息、stderr 片段或诊断报告全文。
 * @returns {{ blocked: boolean, code: string, kind: string, vendor: string, signature: string, remediation: string }}
 */
export function classifySecurityBlock(text) {
  const value = typeof text === 'string' ? text : String(text ?? '');
  for (const signature of SIGNATURES) {
    const match = signature.test.exec(value);
    if (match !== null) {
      return {
        blocked: true,
        code: SECURITY_BLOCK_CODE,
        kind: signature.kind,
        vendor: signature.vendor,
        signature: match[0],
        remediation: '这是后端被安全软件拦截，不是插件挂载失败：不要用"重装插件/宿主"处理，也不要关闭 AMSI。'
          + '先确认宿主加载与工具注册这两层是否正常；如果只有 worker 起不来，可按发行说明提交样本给安全厂商做误报分析，'
          + '并保留版本号、文件哈希与这段原文。',
      };
    }
  }
  return { blocked: false, code: '', kind: '', vendor: '', signature: '', remediation: '' };
}

/** 一句话结论，给 status / doctor 的 backend 层用。 */
export function securityBlockSummary(text) {
  const verdict = classifySecurityBlock(text);
  if (!verdict.blocked) return '';
  return `${verdict.vendor} 拦截了后端（${verdict.signature}）：${verdict.remediation}`;
}

/* -------------------------------------------------------------------------- */
/* 结构化诊断：方案 4.19.3 的 `BackendBlockedBySecurity`                        */
/* -------------------------------------------------------------------------- */

/**
 * 从 PowerShell 的错误文本里取一个**结构化**的错误标识。
 *
 * 有它才算"确认"：`ScriptContainedMaliciousContent` 是 PowerShell 对 AMSI 拦截给出的错误标识，
 * 比"文本里出现了 AMSI 四个字母"强得多。取不到就只能是 `suspected`。
 *
 * @param {unknown} text
 * @returns {string} 错误标识，取不到时为空串。
 */
export function extractPowerShellErrorId(text) {
  const value = typeof text === 'string' ? text : String(text ?? '');
  const named = /\b(ScriptContainedMaliciousContent|ScriptContainedMaliciousCnotent)\b/.exec(value);
  if (named !== null) return named[1];
  const amsiCode = /\b(0x8007661[0-9A-Fa-f])\b/.exec(value);
  if (amsiCode !== null) return amsiCode[1];
  const hresult = /\b(0x[0-9A-Fa-f]{8})\b/.exec(value);
  if (hresult !== null) return hresult[1];
  const psError = /\b(FullyQualifiedErrorId|CategoryInfo)\s*:\s*([^\r\n]+)/.exec(value);
  if (psError !== null) return psError[2].trim().slice(0, 120);
  return '';
}

/**
 * 有界脱敏：只保留首尾一段，去掉用户名与常见的主目录前缀。
 *
 * 诊断里要能看出"它说了什么"，但不能把整台机器的路径与人名抄进日志。上限按字符算，超出时中间
 * 用 `…` 省略。
 *
 * @param {unknown} text
 * @param {{ limit?: number }} options
 * @returns {string}
 */
export function redactStderr(text, options = {}) {
  const limit = Number.isFinite(options.limit) ? Number(options.limit) : 600;
  let value = typeof text === 'string' ? text : String(text ?? '');
  value = value
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/gi, 'C:\\\\Users\\\\<user>')
    .replace(/\/home\/[^/\s]+/g, '/home/<user>')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '<email>')
    .replace(/\r\n/g, '\n')
    .trim();
  if (value.length <= limit) return value;
  const head = Math.floor(limit * 0.6);
  const tail = limit - head - 1;
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

/**
 * 组装一份 `BackendBlockedBySecurity` 诊断。
 *
 * 三条边界写在返回结构里，而不是写在文档里：
 *
 *   * `retryable: false` —— 被拦的同一个文件不再自动重启（换一种 PowerShell 调用方式继续试同样不行）；
 *   * `confidence` 区分 `confirmed`（有结构化错误标识）与 `suspected`（只有弱文本线索）；
 *   * `delivery` 原样带上：被拦发生在启动阶段才有 `not_sent`，运行/释放阶段只能是 `unknown`。
 *
 * @param {object} input
 * @param {'launch'|'run'|'release'} input.phase
 * @param {unknown} [input.stderr]
 * @param {string} [input.errorId]
 * @param {string} [input.scriptHash]
 * @param {number} [input.driverGeneration]
 * @param {string} [input.delivery]
 * @param {number} [input.exitCode]
 * @param {number} [input.at]
 * @returns {object}
 */
export function buildBlockedDiagnostic(input = {}) {
  const phase = input.phase === 'run' || input.phase === 'release' ? input.phase : 'launch';
  const stderr = typeof input.stderr === 'string' ? input.stderr : '';
  const verdict = classifySecurityBlock(stderr);
  const errorId = typeof input.errorId === 'string' && input.errorId !== '' ? input.errorId : extractPowerShellErrorId(stderr);
  // 结构化错误标识或"带引号的原句"才算确认；其余只是怀疑。
  const confirmed = errorId !== '' && /ScriptContainedMalicious|0x8007/i.test(errorId) || /"This script contains malicious content/i.test(stderr);
  // 启动阶段还没把请求发给驱动，才允许说 not_sent；其余阶段一律 unknown。
  const delivery = phase === 'launch' ? (typeof input.delivery === 'string' && input.delivery !== '' ? input.delivery : 'not_sent') : 'unknown';
  return {
    code: SECURITY_BLOCK_CODE,
    blocked: verdict.blocked,
    phase,
    confidence: verdict.blocked === false ? 'none' : (confirmed ? 'confirmed' : 'suspected'),
    kind: verdict.kind,
    vendor: verdict.vendor,
    signature: verdict.signature,
    errorId,
    scriptHash: typeof input.scriptHash === 'string' ? input.scriptHash : '',
    stderrExcerpt: redactStderr(stderr),
    driverGeneration: Number.isFinite(input.driverGeneration) ? Number(input.driverGeneration) : null,
    exitCode: Number.isFinite(input.exitCode) ? Number(input.exitCode) : null,
    delivery,
    at: Number.isFinite(input.at) ? Number(input.at) : Date.now(),
    retryable: false,
    releaseConfirmed: phase === 'release' ? false : null,
    remediation: verdict.blocked
      ? '这不是插件挂载失败：不要重装插件、不要关闭 AMSI/实时防护、也不要加目录排除。'
        + '保留本诊断里的 errorId、scriptHash 与 stderrExcerpt，按发行说明向安全厂商提交误报，'
        + '并在同一版本上等待情报更新后重测。'
      : '后端失败的原因不是已知的安全软件拦截；请按普通启动失败排查（见 doctor 的 backend 层）。',
  };
}

