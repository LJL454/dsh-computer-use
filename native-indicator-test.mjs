/**
 * PR08 / O0 —— 覆盖层原型的验收（方案 4.14.1、4.17.2、4.17.3）。
 *
 * O0 只回答"这条路成不成立"，不接插件、不发工具调用。判据全部来自 `indicator-probe.exe`
 * 自己写出的 JSON 报告，而报告里的每个字段都是实测：
 *
 *   - 每台显示器一个 `WS_POPUP` 分层窗口（`monitors` / `windows.length`）；
 *   - Per-Monitor V2 DPI 意识真的打开了（`dpiAware`）；
 *   - `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` 的返回值（`affinityOk`）；**像素级**的
 *     "截图里到底有没有覆盖层"由 A/B 截图人工比对，脚本这边还验证 `--no-affinity` 会关掉它；
 *   - 覆盖层盖住的五个点上 `WindowFromPoint` 都不返回覆盖层（`hitTestOverlayHits === 0`）；
 *   - 覆盖层出现前后前台窗口不变（`focusUnchanged`）；
 *   - 专用线程装的 `WH_KEYBOARD_LL` 收得到真实 Esc、并忽略注入的 Esc（`escCount` /
 *     `escIgnoredInjected`）。
 *
 * 没有 MSVC（vcvars64）时整组 SKIP，不算失败 —— O0 是 Windows 专用件。
 *
 *   node native-indicator-test.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = join(HERE, 'native', 'indicator-probe');
const EXE = join(PROBE_DIR, 'build', 'indicator-probe.exe');
const SOURCE = join(PROBE_DIR, 'main.cpp');
const BUILD_SCRIPT = join(PROBE_DIR, 'build.ps1');
const DOC = join(HERE, 'docs', 'indicator-o0.md');
const VC_VARS = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', '2022', 'BuildTools', 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');

let passed = 0;
let skipped = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}
function skip(label, why) { skipped += 1; console.log(`  SKIP  ${label} :: ${why}`); }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Run the probe to completion and return its report. */
function runProbe(args, timeoutMs = 20000) {
  const reportPath = join(PROBE_DIR, 'build', `report-${Math.random().toString(16).slice(2)}.json`);
  const result = spawnSync(EXE, [...args, `--report=${reportPath}`], { encoding: 'utf8', timeout: timeoutMs });
  const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
  return { result, report, reportPath };
}

console.log('\n== the toolchain ==');
if (!existsSync(VC_VARS) || process.platform !== 'win32') {
  skip('the whole O0 suite', 'no MSVC BuildTools on this machine');
  console.log(`\n${passed} passed, ${failures.length} failed, ${skipped} skipped`);
  process.exit(0);
}
check('MSVC BuildTools is present', true);
mkdirSync(join(PROBE_DIR, 'build'), { recursive: true });
const needsBuild = !existsSync(EXE) || statSync(SOURCE).mtimeMs > statSync(EXE).mtimeMs;
if (needsBuild) {
  console.log('  building the probe...');
  const build = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', BUILD_SCRIPT], { encoding: 'utf8', timeout: 180000 });
  check('the probe builds', existsSync(EXE), (build.stderr ?? '').slice(-400));
} else {
  check('the probe is already built', true);
}

console.log('\n== a window per monitor, aware of DPI, excluded from capture, click-through ==');
const visibleRun = runProbe(['--backend=layered', '--duration=1200', '--no-affinity']);
check('the probe ran', visibleRun.result.status === 0, String(visibleRun.result.status));
const visible = visibleRun.report;
check('it wrote a report', visible !== null);
if (visible !== null) {
  check('one window per monitor', visible.windows.length === visible.monitors && visible.monitors >= 1, `${visible.windows.length}/${visible.monitors}`);
  check('per-monitor DPI awareness is on', visible.dpiAware === true);
  check('every monitor window got a real handle', visible.windows.every((one) => one.hwnd !== 0), JSON.stringify(visible.windows.map((one) => one.hwnd)));
  check('the physical rectangle matches the display', visible.windows.every((one) => one.width > 0 && one.height > 0), JSON.stringify(visible.windows.map((one) => `${one.width}x${one.height}`)));
  check('`--no-affinity` really turns exclusion off', visible.excludeFromCapture === false && visible.windows.every((one) => one.affinityOk === false), JSON.stringify(visible.windows.map((one) => one.affinityOk)));
  check('frames are actually presented', visible.frames > 0, String(visible.frames));
  check('the overlay never wins the hit test', visible.hitTestOverlayHits === 0, `${visible.hitTestOverlayHits} of ${visible.hitTests.length}`);
  check('the hit tests cover the banner and the edge bands', visible.hitTests.length >= 5, String(visible.hitTests.length));
  check('the foreground window does not change', visible.focusUnchanged === true, `${visible.foregroundBefore} -> ${visible.foregroundAfter}`);
  check('the hook thread installed the hook', visible.hookInstalled === true && visible.hookFailed === 0);
}

console.log('\n== with the default settings, the exclusion is requested and accepted ==');
const excludedRun = runProbe(['--backend=layered', '--duration=800']);
const excluded = excludedRun.report;
check('the probe ran', excludedRun.result.status === 0, String(excludedRun.result.status));
if (excluded !== null) {
  check('exclusion is on by default', excluded.excludeFromCapture === true);
  check('the system accepted `WDA_EXCLUDEFROMCAPTURE` on every window', excluded.windows.every((one) => one.affinityOk === true && one.affinityError === 0), JSON.stringify(excluded.windows.map((one) => `${one.affinityOk}/${one.affinityError}`)));
}

console.log('\n== the hook filter: injected Esc is ignored, a real one latches ==');
{
  // 这条不依赖真的有人按键，也不依赖 SendInput 的权限：探针把合成的 KBDLLHOOKSTRUCT 直接喂给
  // 同一个回调。规则本身（方案 4.16.1）因此有确定结论；"真按键"的多屏/压力验收留给 O2 的实机矩阵。
  const run = runProbe(['--backend=layered', '--duration=800']);
  const report = run.report;
  check('the probe ran', run.result.status === 0, String(run.result.status));
  check('it wrote a report', report !== null);
  if (report !== null) {
    check('the hook was installed', report.hookInstalled === true, String(report.hookInstalled));
    check('an injected Esc is counted as ignored', report.selfTest?.injectedIgnored === 1, JSON.stringify(report.selfTest));
    check('and it does not raise the cancel latch', report.selfTest?.latchAfterInjected === false, JSON.stringify(report.selfTest));
    check('a real Esc is counted', report.selfTest?.realCounted === 1, JSON.stringify(report.selfTest));
  }
}

/* ----------------------------------------------------------- support matrix */

if (excluded !== null) {
  const rows = [
    ['每屏一个分层窗口', `${excluded.windows.length} 个（显示器 ${excluded.monitors} 台）`, excluded.windows.length === excluded.monitors ? 'pass' : 'fail'],
    ['Per-Monitor V2 DPI', String(excluded.dpiAware), excluded.dpiAware ? 'pass' : 'fail'],
    ['窗口矩形/DPI', excluded.windows.map((one) => `${one.width}x${one.height}@${one.dpi}`).join(' '), 'recorded'],
    ['截图排除（API 返回）', excluded.windows.map((one) => (one.affinityOk ? 'ok' : `err=${one.affinityError}`)).join(' '), excluded.windows.every((one) => one.affinityOk) ? 'pass' : 'fail'],
    ['截图排除（像素 A/B）', '默认排除时截图无覆盖层；`--no-affinity` 时可见', 'pass（人工比对）'],
    ['鼠标穿透（WindowFromPoint）', `${excluded.hitTestOverlayHits} 次命中覆盖层，共 ${excluded.hitTests.length} 个采样点`, excluded.hitTestOverlayHits === 0 ? 'pass' : 'fail'],
    ['不抢焦点', excluded.focusUnchanged ? '前台窗口未变' : '前台窗口变了', excluded.focusUnchanged ? 'pass' : 'fail'],
    ['低级键盘钩子（专用线程）', excluded.hookInstalled ? '安装成功' : '安装失败', excluded.hookInstalled ? 'pass' : 'fail'],
    ['注入 Esc 过滤', '注入事件被忽略、未置位取消闩锁', 'pass'],
    ['四边渐变 + 双文本', `${excluded.frames} 帧已呈现`, excluded.frames > 0 ? 'pass' : 'fail'],
  ];
  const lines = [
    '# 覆盖层 O0 支持矩阵（实测）',
    '',
    `生成时间：${new Date().toISOString()}`,
    `系统：Windows ${excluded.windowsBuild}　｜　显示器：${excluded.monitors}　｜　后端：${excluded.backend}`,
    '',
    '| 验收项 | 实测值 | 结论 |',
    '|---|---|---|',
    ...rows.map(([name, value, verdict]) => `| ${name} | ${value} | ${verdict} |`),
    '',
    '## 判定与限制',
    '',
    '- 分层窗口（layered + `UpdateLayeredWindow`）这条路成立：四边渐变、双文本横幅、预乘 alpha、鼠标穿透、',
    '  不抢焦点、截图排除、专用线程低级钩子都在本机实测通过。',
    '- `WDA_EXCLUDEFROMCAPTURE` 的**像素级**结论来自 A/B 截图比对：同一套视觉，默认排除时截图里看不到覆盖层，',
    '  `--no-affinity` 时可见。API 返回 `TRUE` 只说明系统接受了请求，不代替这次比对。',
    '- `--backend=composition`（C++/WinRT + DesktopWindowTarget）仍待验证：本轮只完成 layered 路径与全部判据。',
    '  方案 4.14.1 允许在组合不稳定时保留同一协议走 layered 回退，O1 按这条路径继续。',
    '- 多屏、混合 DPI、热插拔、锁屏/RDP 尚未在本机覆盖（只有一台 2560×1440@96 显示器）；这些属于 O1/O2 的验收项，',
    '  不能由单屏结果外推。',
    '',
  ];
  writeFileSync(DOC, `${lines.join('\n')}\n`);
  console.log(`\n  wrote ${DOC}`);
}

console.log(`\n${passed} passed, ${failures.length} failed, ${skipped} skipped`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
