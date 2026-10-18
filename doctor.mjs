/**
 * 电脑操作插件的自检入口——在装了它的那台机器上直接跑。
 *
 *   node doctor.mjs                       # 只做本地检查，不碰任何服务
 *   node doctor.mjs http://127.0.0.1:19387  # 再向正在运行的 DSH 问一次宿主半边的状态
 *
 * 它回答的是用户报告的那一类症状："我明明点亮了电脑操作，工具却一个都调不动。"
 * 那种情况下界面上不会有任何提示——芯片由浏览器半边渲染，工具由宿主半边注册，两条路径不同——
 * 所以必须有一个不依赖界面、不依赖复现的检查。这个脚本就是它：只读，不启动 worker，不改状态。
 *
 * 退出码：0 = 没发现阻断项；1 = 至少有一项让电脑操作无法工作。
 */
import { collectDoctorReport } from './internal/doctor.mjs';

const url = (process.argv[2] ?? '').trim();

/** 打印一张 findings 表。 */
function printFindings(findings) {
  for (const entry of findings) {
    const tag = entry.level === 'fatal' ? '阻断' : entry.level === 'warn' ? '注意' : '说明';
    console.log(`[${tag}] ${entry.code}  ${entry.message}`);
    if (entry.action !== '') console.log(`        → ${entry.action}`);
  }
}

const local = collectDoctorReport({
  version: 'local',
  registeredToolNames: [],
  registrationFailures: [],
  schemaVisibility: { enabled: true, liveAgents: 0, restrictedSessions: 0 },
  backend: null,
});

// 本地那一次只看"当前环境/这个包"的事实：依赖能不能解析、PowerShell 在不在、脚本全不全。
// 工具注册与可见性的结论只有宿主知道，所以只用一份白名单把本地观测挑出来，其余留给下面那次远程读取。
const LOCAL_CODES = ['UNSUPPORTED_PLATFORM', 'POWERSHELL_MISSING', 'WORKER_SCRIPT_MISSING', 'PEER_RESOLUTION_OUTSIDE_HOST'];
const localOnly = local.findings.filter((entry) => LOCAL_CODES.includes(entry.code));

console.log('== 当前环境与安装包 ==');
console.log(`插件版本      ${local.version}`);
console.log(`平台          ${local.platform}（受支持：${local.supported}）`);
console.log(`PowerShell    ${local.checks.powershell.resolved}`);
for (const candidate of local.checks.powershell.candidates) {
  if (candidate.kind === 'absolute') console.log(`              ${candidate.exists ? '存在' : '缺失'}  ${candidate.candidate}`);
}
console.log(`peer 依赖     ${local.checks.peer.resolvable ? `可解析 → ${local.checks.peer.url}` : '裸 Node 下解析不到（正常，宿主的解析面覆盖它；以宿主那一段为准）'}`);
console.log(`worker 脚本   ${local.checks.scripts.worker.exists ? `${local.checks.scripts.worker.bytes} 字节  ${local.checks.scripts.worker.path}` : `缺失  ${local.checks.scripts.worker.path}`}`);
console.log(`释放脚本      ${local.checks.scripts.release.exists ? `${local.checks.scripts.release.bytes} 字节` : '缺失'}`);
printFindings(localOnly);

let remote = null;
if (url !== '') {
  console.log(`\n== 宿主半边（${url}/computer-use/doctor）==`);
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/computer-use/doctor`);
    if (!response.ok) {
      console.log(`宿主没有答话：HTTP ${response.status}。`);
      console.log('404 表示这个插件行没有挂载（或没重启 DSH）：芯片因此会显示"主机半未加载"。');
      remote = { ok: false };
    } else {
      remote = await response.json();
      console.log(`结论          ${remote.summary}`);
      console.log(`已注册工具    ${remote.checks.tools.registered} 个${remote.checks.tools.failures.length > 0 ? `（另有 ${remote.checks.tools.failures.length} 个被宿主拒绝）` : ''}`);
      for (const failure of remote.checks.tools.failures) console.log(`              拒绝 ${failure.name}：${failure.message}`);
      const visibility = remote.checks.schemaVisibility;
      console.log(`schema 可见性 隐藏 ${visibility.restrictedSessions} 个会话；登记 agent ${visibility.liveAgents} 个`);
      console.log(`后台进程      ${remote.checks.backend === null ? '未启动（懒启动，正常）' : `alive=${remote.checks.backend.alive} pid=${remote.checks.backend.pid}`}`);
      printFindings(remote.findings ?? []);
    }
  } catch (error) {
    console.log(`连不上 ${url}：${error instanceof Error ? error.message : String(error)}`);
    console.log('DSH 没在跑、端口不是这个、或者插件行没有挂载，都会长这样。用 DSH 实际启动的 web 端口重试。');
    remote = { ok: false };
  }
}

const blocked = localOnly.some((entry) => entry.level === 'fatal') || (remote !== null && remote.ok === false);
console.log('');
console.log(blocked ? '结果：发现让电脑操作无法工作的问题，见上面每一条的 →。' : '结果：没有发现让电脑操作无法工作的问题。');
process.exit(blocked ? 1 : 0);
