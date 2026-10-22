/**
 * 电脑操作插件的自检入口——在装了它的那台机器上直接跑。
 *
 *   node doctor.mjs                         # 只做离线检查，不碰任何服务
 *   node doctor.mjs --profile desktop        # 额外检查 profile 的依赖/链接/bundles/重复挂载
 *   node doctor.mjs http://127.0.0.1:19387   # 再向正在运行的 DSH 问一次宿主半边的状态
 *   node doctor.mjs --json                   # 机器可读的完整报告
 *   node doctor.mjs --release                # 正式发行验收：缺 release-manifest.json 也算阻断
 *   node doctor.mjs --probe-backend <origin> # 显式拉起后端（会 spawn worker）
 *
 * 它回答的是用户报告的那一类症状："我明明点亮了电脑操作，工具却一个都调不动。"
 * 那种情况下界面上不会有任何提示——芯片由浏览器半边渲染，工具由宿主半边注册，两条路径不同——
 * 所以必须有一个不依赖界面、不依赖复现的检查。这个脚本就是它：默认只读，不启动 worker，不改状态。
 *
 * 退出码：0 = 没发现阻断项；1 = 至少有一项让电脑操作无法工作，或宿主半边不可达。
 */
import { readFileSync, statSync } from 'node:fs';
import { collectDoctorReport } from './internal/doctor.mjs';
import { PACKAGE_ROOT, readPackageManifest } from './internal/release-manifest.mjs';
import { detectHost } from './internal/preflight.mjs';
import { inspectProfile } from './internal/profile-check.mjs';
import { MAX_REPORT_BYTES, parseDiagnosticReport } from './internal/diagnostic-report.mjs';

/** Parsed command line. */
function parseArgs(argv) {
  const options = {
    origin: '',
    json: false,
    profile: process.env.DSH_PROFILE ?? '',
    probeBackend: false,
    requireManifest: false,
    diagnostic: '',
    timeoutMs: 3000,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--release') options.requireManifest = true;
    else if (arg === '--probe-backend') options.probeBackend = true;
    else if (arg === '--no-profile') options.profile = '';
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--profile') options.profile = argv[++index] ?? '';
    else if (arg.startsWith('--profile=')) options.profile = arg.slice('--profile='.length);
    else if (arg === '--diagnostic') options.diagnostic = argv[++index] ?? '';
    else if (arg.startsWith('--diagnostic=')) options.diagnostic = arg.slice('--diagnostic='.length);
    else if (arg === '--timeout') options.timeoutMs = Math.max(250, Number(argv[++index] ?? 3000) || 3000);
    else if (arg.startsWith('--timeout=')) options.timeoutMs = Math.max(250, Number(arg.slice('--timeout='.length)) || 3000);
    else if (!arg.startsWith('--')) options.origin = arg;
    else {
      console.error(`未知参数：${arg}`);
      options.help = true;
    }
  }
  return options;
}

/** Human-readable tag for a finding level. */
function tagOf(level) {
  return level === 'fatal' ? '阻断' : level === 'warn' ? '注意' : '说明';
}

/**
 * Print findings.
 * @param findings - report findings.
 */
function printFindings(findings) {
  for (const entry of findings) {
    console.log(`[${tagOf(entry.level)}] ${entry.code}  ${entry.message}`);
    if (entry.action !== '') console.log(`        → ${entry.action}`);
  }
}

/**
 * Fetch JSON with a hard timeout, so a dead/orphaned service cannot hang the doctor.
 * @param url - absolute URL.
 * @param timeoutMs - budget.
 * @returns `{ ok, status, body, error }`.
 */
async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    const text = await response.text();
    let body = null;
    try {
      body = text === '' ? null : JSON.parse(text);
    } catch {
      body = null;
    }
    return { ok: response.ok, status: response.status, body, error: '' };
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? `超过 ${timeoutMs} ms 没有答话`
      : (error instanceof Error ? error.message : String(error));
    return { ok: false, status: 0, body: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log('用法：node doctor.mjs [origin] [--json] [--profile <name|dir>] [--no-profile] [--release] [--probe-backend] [--diagnostic <report>] [--timeout <ms>]');
  process.exit(0);
}

const packageManifest = readPackageManifest(PACKAGE_ROOT).manifest;
const version = String(packageManifest?.version ?? '0.0.0-unversioned');
const profileReport = options.profile === '' ? null : inspectProfile({ profile: options.profile, pluginRoot: PACKAGE_ROOT });

const local = collectDoctorReport({
  mode: 'offline',
  version,
  packageRoot: PACKAGE_ROOT,
  registeredToolNames: [],
  registrationFailures: [],
  schemaVisibility: { enabled: true, liveAgents: 0, restrictedSessions: 0 },
  backend: null,
  host: detectHost(),
  profile: profileReport,
  requireReleaseManifest: options.requireManifest,
});

const origin = options.origin.trim().replace(/\/+$/, '');
let diagnostic = null;
if (options.diagnostic !== '') {
  try {
    const info = statSync(options.diagnostic);
    if (!info.isFile()) throw new Error('不是一个文件');
    if (info.size > MAX_REPORT_BYTES) throw new Error(`报告超过 ${MAX_REPORT_BYTES} 字节`);
    const text = readFileSync(options.diagnostic, 'utf8');
    diagnostic = parseDiagnosticReport(text);
    diagnostic.path = options.diagnostic;
  } catch (error) {
    diagnostic = {
      path: options.diagnostic,
      error: error instanceof Error ? error.message : String(error),
      firstFailure: null,
      failed: [],
      waiting: [],
      requiredWaiting: [],
      mentions: [],
    };
  }
}
let remote = null;
let probe = null;
if (origin !== '') {
  const answer = await fetchJson(`${origin}/computer-use/doctor`, options.timeoutMs);
  if (!answer.ok) {
    remote = { ok: false, reachable: false, error: answer.error, status: answer.status };
  } else if (answer.body === null) {
    remote = { ok: false, reachable: true, error: '响应不是 JSON', status: answer.status };
  } else {
    remote = { ...answer.body, reachable: true };
  }
  if (options.probeBackend) {
    const answerProbe = await fetchJson(`${origin}/computer-use/probe`, Math.max(options.timeoutMs, 45_000));
    probe = answerProbe.body === null
      ? { ok: false, status: answerProbe.status, error: answerProbe.error }
      : answerProbe.body;
  }
}

const localFatal = local.findings.filter((entry) => entry.level === 'fatal').length;
const remoteBlocked = remote !== null && remote.ok === false;
const probeBlocked = probe !== null && probe.ok !== true;
const diagnosticBlocked = diagnostic !== null
  && (diagnostic.error !== undefined || diagnostic.firstFailure?.required === true || (diagnostic.requiredWaiting?.length ?? 0) > 0);
const exitCode = localFatal > 0 || remoteBlocked || probeBlocked || diagnosticBlocked ? 1 : 0;

if (options.json) {
  console.log(JSON.stringify({ local, remote, probe, diagnostic, exitCode }, null, 2));
  process.exit(exitCode);
}

console.log('== 安装包 ==');
console.log(`插件版本      ${local.version}`);
console.log(`插件根        ${local.package.root}`);
console.log(`检查模式      ${local.mode}${options.requireManifest ? '（release 验收）' : ''}`);
console.log(`发行身份      ${local.checks.release.buildId}  清单：${local.checks.release.manifest.present ? `v${local.checks.release.manifest.version ?? '?'} / ${local.checks.release.manifest.releaseBuildId ?? '?'} (${local.checks.release.matches ? '一致' : '不一致'})` : '未随包提供'}`);
console.log(`插件文件      ${local.checks.release.files} 个参与哈希${local.checks.release.missing.length > 0 ? `；缺少 ${local.checks.release.missing.join('、')}` : ''}`);

console.log('\n== 环境与依赖 ==');
console.log(`平台          ${local.platform}（受支持：${local.supported}）`);
console.log(`PowerShell    ${local.checks.powershell.resolved}${local.checks.powershell.found ? `（${local.checks.powershell.source}）` : '（未找到）'}`);
for (const candidate of local.checks.powershell.candidates) {
  if (candidate.kind === 'absolute') console.log(`              ${candidate.exists ? '存在' : '缺失'}  ${candidate.candidate}`);
}
for (const [label, peer] of Object.entries(local.checks.peers)) {
  console.log(`peer ${label.padEnd(5)} ${peer.resolvable ? `可解析 → ${peer.version || '?'}  ${peer.path}` : '解析不到（裸 Node 下正常；以宿主那一段为准）'}`);
}
console.log(`worker 脚本   ${local.checks.scripts.worker.exists ? `${local.checks.scripts.worker.bytes} 字节  ${local.checks.scripts.worker.path}` : `缺失  ${local.checks.scripts.worker.path}`}`);
console.log(`释放脚本      ${local.checks.scripts.release.exists ? `${local.checks.scripts.release.bytes} 字节` : `缺失  ${local.checks.scripts.release.path}`}`);
console.log(`浏览器能力    Node ${local.checks.browser.node}；WebSocket=${local.checks.browser.webSocket}；fetch=${local.checks.browser.fetch}`);

if (local.checks.profile !== null) {
  const profile = local.checks.profile;
  console.log('\n== profile ==');
  console.log(`目录          ${profile.dir}`);
  console.log(`依赖          ${profile.dependency?.declared ? `${profile.dependency.spec} → ${profile.dependency.path || '(registry)'}` : '未声明'}`);
  console.log(`bundle        ${profile.bundles.includes('@local/dsh-computer-use') ? '已启用' : '未启用'}`);
  console.log(`用户 patch    ${profile.patch?.present ? `存在；本插件行 ${profile.patch.rows} 个` : '不存在'}`);
  if (profile.coreCopies.length > 0) {
    console.log(`核心包副本    ${profile.coreCopies.map((entry) => `${entry.package}@${entry.version || '?'} (${entry.where})`).join('；')}`);
  }
}

console.log('\n== 离线检查结论 ==');
printFindings(local.findings);
console.log(`（${local.summary}）`);

if (diagnostic !== null) {
  console.log(`\n== 原生诊断报告（${diagnostic.path}）==`);
  if (diagnostic.error !== undefined) {
    console.log(`读取失败：${diagnostic.error}`);
  } else {
    console.log(`格式          ${diagnostic.format}；${diagnostic.bytes} 字符`);
    if (diagnostic.firstFailure === null) {
      console.log('首个失败      （报告里没有 Failed plugins / required 等待条目）');
    } else {
      console.log(`首个失败      ${diagnostic.firstFailure.id}${diagnostic.firstFailure.required ? '（required）' : ''}`);
      if (diagnostic.firstFailure.package !== '') console.log(`包            ${diagnostic.firstFailure.package}`);
      if (diagnostic.firstFailure.detail !== '') console.log(`原因          ${diagnostic.firstFailure.detail}`);
      for (const line of diagnostic.firstFailure.lines.slice(1, 8)) console.log(`              ${line}`);
    }
    if (diagnostic.failed.length > 1) {
      console.log(`其余失败      ${diagnostic.failed.slice(1).map((entry) => `${entry.id}${entry.required ? '(required)' : ''}`).join('、')}`);
    }
    if (diagnostic.waiting.length > 0) {
      console.log(`等待服务      ${diagnostic.waiting.length} 个`);
      for (const entry of diagnostic.waiting) {
        console.log(`              ${entry.id}${entry.required ? '（required）' : ''} ← ${entry.missing.join(', ') || 'unknown'}`);
      }
    }
    for (const mention of diagnostic.mentions) {
      console.log(`[提示] ${mention.code}  ${mention.message}`);
    }
    if (diagnostic.mentions.length === 0) console.log('（没有命中本插件的已知模式；按报告里的首个 cause 继续查。）');
  }
}

if (origin !== '') {
  console.log(`\n== 宿主半边（${origin}/computer-use/doctor）==`);
  if (remote?.reachable !== true) {
    if (remote?.status === 404) {
      console.log('宿主没有答话：HTTP 404。这只证明该 origin/path 没有可用路由——可能是错误端口、错误实例、插件行没挂载，或加载失败；不能单凭 404 判定"缺 bundle"。');
    } else {
      console.log(`连不上 ${origin}：${remote?.error || `HTTP ${remote?.status ?? '?'}`}。`);
    }
    console.log('DSH 没在跑、端口不是这个、或者插件行没有挂载，都会长这样。用 DSH 实际启动的 web 端口重试。');
  } else {
    console.log(`结论          ${remote.summary ?? '(无 summary)'}`);
    console.log(`模式/版本     ${remote.mode ?? '?'} / ${remote.version ?? '?'}；发行身份 ${remote.checks?.release?.buildId ?? '?'}`);
    console.log(`已注册工具    ${remote.checks?.tools?.registered ?? '?'} 个${(remote.checks?.tools?.failures?.length ?? 0) > 0 ? `（另有 ${remote.checks.tools.failures.length} 个被宿主拒绝）` : ''}`);
    for (const failure of remote.checks?.tools?.failures ?? []) console.log(`              拒绝 ${failure.name}：${failure.message}`);
    const visibility = remote.checks?.schemaVisibility;
    if (visibility !== undefined) console.log(`schema 可见性 隐藏 ${visibility.restrictedSessions} 个会话；登记 agent ${visibility.liveAgents} 个`);
    console.log(`后台进程      ${remote.checks?.backend === null || remote.checks?.backend === undefined ? '未启动（懒启动，正常）' : `alive=${remote.checks.backend.alive} pid=${remote.checks.backend.pid}`}`);
    printFindings(remote.findings ?? []);
  }
}

if (probe !== null) {
  console.log(`\n== 后端 probe（${origin}/computer-use/probe）==`);
  if (probe.ok === true) {
    console.log(`可用          dpi=${probe.dpi ?? '?'} screens=${probe.screens ?? '?'} transport=${JSON.stringify(probe.transport ?? null)}`);
  } else {
    console.log(`失败          ${probe.error ?? `HTTP ${probe.status ?? '?'}`}`);
  }
}

console.log('');
console.log(exitCode === 0
  ? '结果：没有发现让电脑操作无法工作的问题。'
  : '结果：发现让电脑操作无法工作的问题，见上面每一条的 →。');
process.exit(exitCode);
