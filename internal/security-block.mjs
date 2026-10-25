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
    test: /was blocked by your system administrator|AppLocker|WDAC|CodeIntegrity|cannot be run because it is not digitally signed/i,
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
