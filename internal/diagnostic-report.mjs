/**
 * 原生启动诊断报告的第一层解析。
 *
 * 本次事故的弹窗只截取了报告最后 8 行、又受 1,200 字符预算限制，用户看到的是
 * `agent-loop (required)` 和一堆 `tools`，真正的 `Failed plugins`、包路径、异常堆栈都在前面。
 * 这个模块把报告读成三组事实：
 *
 *   1. `Failed plugins` 里的**第一个**失败条目（包名、id、cause 的第一行）；
 *   2. `Plugins waiting for services` 表（谁在等哪些服务，哪些是 required）；
 *   3. 能直接指向本插件或核心服务链的关键词（duplicate route、tools provider、旧包名）。
 *
 * 它只读文本，不执行报告里的任何内容；报告里的路径/堆栈按数据对待。
 */

/** How much of a diagnostic report is worth reading; reports are text and bounded. */
export const MAX_REPORT_BYTES = 5 * 1024 * 1024;

/**
 * Normalize a label such as `agent-loop (required)`.
 * @param label - raw cell/line.
 * @returns `{ id, required }`.
 */
function parseLabel(label) {
  const text = String(label ?? '').trim();
  const required = /\(required\)\s*$/i.test(text);
  return { id: text.replace(/\s*\(required\)\s*$/i, '').trim(), required };
}

/**
 * Pull strings out of a JSON report so the same text parser can look at them.
 * @param value - parsed JSON.
 * @param sink - accumulator.
 * @param depth - recursion guard.
 */
function collectStrings(value, sink, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    sink.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, sink, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, sink, depth + 1);
  }
}

/**
 * Parse the `Failed plugins` section.
 * @param lines - report lines.
 * @param start - index of the header.
 * @returns failed entries.
 */
function parseFailed(lines, start) {
  const failed = [];
  let current = null;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*Plugins waiting for services\b/.test(line)) break;
    if (line.trim() === '') continue;
    if (/^  \S/.test(line) && !/^ {4,}/.test(line)) {
      const { id, required } = parseLabel(line);
      current = { id, required, package: '', detail: [], raw: [] };
      failed.push(current);
      continue;
    }
    if (current === null) continue;
    const packageMatch = /^\s{4,}Package:\s*(.+?)\s*$/.exec(line);
    if (packageMatch !== null) {
      current.package = packageMatch[1];
      continue;
    }
    current.detail.push(line.replace(/^\s{4,}/, ''));
    current.raw.push(line);
  }
  for (const entry of failed) entry.detail = entry.detail.slice(0, 40);
  return failed;
}

/**
 * Parse the waiting-for-services table.
 * @param lines - report lines.
 * @param start - index of the header.
 * @returns waiting entries.
 */
function parseWaiting(lines, start) {
  const waiting = [];
  let headerSkipped = false;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '') continue;
    if (!headerSkipped) {
      // `Plugin` + `Missing services`
      if (/^\s*Plugin\s+Missing services\s*$/.test(line)) {
        headerSkipped = true;
        continue;
      }
      headerSkipped = true;
    }
    const match = /^\s{2}(.+?)\s{2,}(.+?)\s*$/.exec(line);
    if (match === null) continue;
    const { id, required } = parseLabel(match[1]);
    const missing = match[2].split(',').map((entry) => entry.trim()).filter((entry) => entry !== '' && entry !== 'unknown');
    waiting.push({ id, required, missing, raw: line.trim() });
  }
  return waiting;
}

/**
 * Parse a DSH startup diagnostic report.
 *
 * The report may be the plain text produced by `startupDiagnostic()` or a JSON wrapper that
 * contains that text in one of its strings. Both are reduced to the same shape.
 * @param report - report text or parsed JSON value.
 * @returns `{ format, firstFailure, failed, waiting, requiredWaiting, hints, mentions }`.
 */
export function parseDiagnosticReport(report) {
  let text = typeof report === 'string' ? report : '';
  let format = 'text';
  if (typeof report !== 'string' && report !== null && typeof report === 'object') {
    format = 'json';
    const strings = [];
    collectStrings(report, strings);
    text = strings.join('\n');
  }
  const lines = text.split(/\r?\n/);
  const failedHeader = lines.findIndex((line) => /^\s*Failed plugins\s*\(\d+\)\s*:/.test(line) || /^\s*Failed plugins\s*:/.test(line));
  const waitingHeader = lines.findIndex((line) => /^\s*Plugins waiting for services\b/.test(line));
  const failed = failedHeader >= 0 ? parseFailed(lines, failedHeader) : [];
  const waiting = waitingHeader >= 0 ? parseWaiting(lines, waitingHeader) : [];

  const lowered = text.toLowerCase();
  const mentions = [];
  const addMention = (code, message) => mentions.push({ code, message });
  if (/duplicate (exact )?route\s+["']?\/computer-use\/status/i.test(text)) {
    addMention('COMPUTER_USE_DUPLICATE_ROUTE',
      '报告里出现 /computer-use/status 的重复路由：本插件被同一宿主挂载了两次。删掉重复的 bundle/预设/用户 patch 行，保留第一份。');
  }
  if (lowered.includes('@local/dsh-token-guard') || lowered.includes('@local/dsh-app-launch')) {
    addMention('LEGACY_PACKAGE_IN_REPORT',
      '报告里出现 @local/dsh-token-guard / @local/dsh-app-launch：旧独立包仍可能被启用。迁移配置后移除旧包/旧行。');
  }
  if (lowered.includes('err_module_not_found') || lowered.includes('cannot find package')) {
    addMention('MODULE_NOT_FOUND',
      '报告包含 ERR_MODULE_NOT_FOUND / Cannot find package：先确认解析路径和版本，不要用 npm install latest 猜。');
  }
  if (lowered.includes('duplicate exact route')) {
    addMention('DUPLICATE_ROUTE',
      '报告包含重复路由；按报告里的 path 找到重复挂载的包/行。');
  }

  const toolsWaits = waiting.filter((entry) => entry.missing.includes('tools'));
  if (toolsWaits.length > 0) {
    addMention('TOOLS_SERVICE_WAIT',
      `${toolsWaits.length} 个插件在等待 tools 服务${toolsWaits.some((entry) => entry.required) ? '（含 required 条目）' : ''}。先查 tools provider 本身、上游 system-prompt/核心包解析和 profile 配置；等待表是后果，不是根因。`);
  }
  const requiredWaiting = waiting.filter((entry) => entry.required);

  return {
    format,
    bytes: text.length,
    firstFailure: failed.length > 0 ? {
      id: failed[0].id,
      required: failed[0].required,
      package: failed[0].package,
      detail: failed[0].detail[0] ?? '',
      lines: failed[0].detail.slice(0, 20),
    } : requiredWaiting.length > 0 ? {
      id: requiredWaiting[0].id,
      required: true,
      package: '',
      detail: `waiting for services: ${requiredWaiting[0].missing.join(', ') || 'unknown'}`,
      lines: [],
    } : null,
    failed,
    waiting,
    requiredWaiting,
    toolsWaits,
    mentions,
  };
}
