/**
 * PR09 / O1 —— 交互提示 helper 的协议验收（方案 4.15.2、4.16）。
 *
 * 这一组不测像素（O0 已经证明渲染），测的是**接到插件之前必须先成立的那层契约**：
 *
 *   - `hello` 带版本协商，不兼容就拒绝启动；`ready` 报的 `escapeReady` 必须是钩子真的装上了；
 *   - `beginScope` 之后先建窗、画一帧，再回 `scopeReady` —— "ready 不等于已显示"；
 *   - `updateState` 只接受单调 `seq`，旧序列回执 `applied:false` 而不改状态；
 *   - `setVisualPreferences` 只应用新修订，旧修订同样回执而非静默覆盖；
 *   - 有界输入：超长行、坏 JSON、未知方法都必须被拒且**进程还活着**；
 *   - `endScope` 不认错的 scope；`shutdown` 之后发 `closed` 并退出 0。
 *
 *   node indicator-helper-test.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPER_DIR = join(HERE, 'native', 'indicator-helper');
// 阶段 1：允许把这一套验收指向另一个构建目录。正在运行的 helper 会锁住默认 `build/` 里的 exe
// （LNK1104），于是"验证构建"必须在别处；发行验收仍然走默认路径。
const EXE = process.env.DSH_INDICATOR_EXE !== undefined && process.env.DSH_INDICATOR_EXE !== ''
  ? process.env.DSH_INDICATOR_EXE
  : join(HELPER_DIR, 'build', 'dsh-interaction-indicator.exe');
const SOURCE = join(HELPER_DIR, 'main.cpp');
const BUILD_SCRIPT = join(HELPER_DIR, 'build.ps1');
const VC_VARS = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', '2022', 'BuildTools', 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');

let passed = 0;
let skipped = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}

console.log('\n== the toolchain ==');
if (process.platform !== 'win32' || !existsSync(VC_VARS)) {
  skipped += 1;
  console.log('  SKIP  the whole helper suite :: no MSVC BuildTools');
  console.log(`\n${passed} passed, ${failures.length} failed, ${skipped} skipped`);
  process.exit(0);
}
mkdirSync(join(HELPER_DIR, 'build'), { recursive: true });
if (!existsSync(EXE) || (EXE.includes(`${sep}build${sep}`) && statSync(SOURCE).mtimeMs > statSync(EXE).mtimeMs)) {
  console.log('  building the helper...');
  const build = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', BUILD_SCRIPT], { encoding: 'utf8', timeout: 180000 });
  check('the helper builds', existsSync(EXE), (build.stderr ?? '').slice(-400));
} else {
  check('the helper is already built', true);
}

/* ------------------------------------------------------------- harness --- */

const child = spawn(EXE, ['--backend=layered'], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.on('data', () => {});
const events = [];
let buffer = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line === '') continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      events.push({ event: '__unparsable__', line });
    }
  }
});

let nextRequest = 0;
function send(message) {
  const requestId = message.requestId ?? `r${nextRequest += 1}`;
  child.stdin.write(`${JSON.stringify({ requestId, ...message })}\n`);
  return requestId;
}

/** Wait for an event matching the predicate; fails the whole run on timeout. */
async function waitFor(event, predicate = () => true, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const index = events.findIndex((one) => one.event === event && predicate(one));
    if (index >= 0) return events.splice(index, 1)[0];
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return null;
}

const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));

try {
  console.log('\n== version negotiation ==');
  send({ method: 'hello', protocolVersion: 99 });
  const mismatch = await waitFor('error');
  check('an incompatible protocol is refused', mismatch?.code === 'PROTOCOL_MISMATCH', JSON.stringify(mismatch));

  send({ method: 'hello', protocolVersion: 2 });
  const ready = await waitFor('ready');
  check('hello is answered with ready', ready !== null);
  check('it speaks protocol 2', ready?.protocolVersion === 2, String(ready?.protocolVersion));
  check('it reports a build identity', typeof ready?.buildVersion === 'string' && ready.buildVersion.length > 0, String(ready?.buildVersion));
  check('it reports its pid', Number.isFinite(ready?.pid) && ready.pid > 0, String(ready?.pid));
  check('the keyboard hook is up before any scope', ready?.escapeReady === true, String(ready?.escapeReady));
  check('the topology lists the displays', Array.isArray(ready?.topology) && ready.topology.length >= 1, JSON.stringify(ready?.topology));
  check('window counts are reported separately from displays', ready?.counts?.monitorCount === ready.topology.length && Number.isFinite(ready?.counts?.createdWindowCount), JSON.stringify(ready?.counts));
  // 没有 --assets 就没有角色：这一条不能靠"包里其实有图集"蒙过去（第二个 helper 专门验有资源那条路径）。
  check('no assets passed means no character', ready?.characterLoaded === false, String(ready?.characterLoaded));

  console.log('\n== beginScope: windows first, then the answer ==');
  send({ method: 'beginScope' });
  const badScope = await waitFor('error');
  check('a scope without an id is refused', badScope?.code === 'BAD_REQUEST', JSON.stringify(badScope));

  send({ method: 'beginScope', scopeId: 'task-1', epoch: 3 });
  const scopeReady = await waitFor('scopeReady', () => true, 8000);
  check('the scope is announced', scopeReady !== null, JSON.stringify(scopeReady));
  check('the visual was actually presented before the answer', scopeReady?.visualReady === true, String(scopeReady?.visualReady));
  check('the escape path is confirmed separately', scopeReady?.escapeReady === true, String(scopeReady?.escapeReady));
  // 每台显示器 4 条边 + 1 个横幅：窗口数不再等于显示器数（方案 3.1 / 7.1）。
  check('four edges plus one banner per display', scopeReady?.counts?.displayWindowCount === scopeReady?.topology?.length * 5,
    `${scopeReady?.counts?.displayWindowCount}/${scopeReady?.topology?.length}`);
  check('every display window is presenting', scopeReady?.counts?.presentOkWindowCount === scopeReady?.counts?.displayWindowCount + scopeReady?.counts?.cursorWindowCount,
    JSON.stringify(scopeReady?.counts));
  check('the layout epoch is nonzero', Number.isFinite(scopeReady?.layoutEpoch) && scopeReady.layoutEpoch >= 1, String(scopeReady?.layoutEpoch));

  console.log('\n== the cursor halo: created with the scope, removed when turned off ==');
  send({ method: 'health' });
  const cursorHealth = await waitFor('health');
  check('the scope says the halo is ready', scopeReady?.cursorStatus === 'ready' && scopeReady?.cursorWindows === 1, JSON.stringify({ status: scopeReady?.cursorStatus, windows: scopeReady?.cursorWindows }));
  check('health reports a live cursor surface', cursorHealth?.cursorSurface === 'ready', String(cursorHealth?.cursorSurface));
  check('the halo follows the real pointer', cursorHealth?.cursorTracking === 'following', String(cursorHealth?.cursorTracking));
  check('it is actually presenting frames', cursorHealth?.cursorFrames > 0, String(cursorHealth?.cursorFrames));
  check('no button is held', cursorHealth?.cursorPressed === false, String(cursorHealth?.cursorPressed));
  check('a synthetic (injected) press is tracked', cursorHealth?.mouseSelfTestDown === 1, String(cursorHealth?.mouseSelfTestDown));
  check('and the release clears it', cursorHealth?.mouseSelfTestUp === 0, String(cursorHealth?.mouseSelfTestUp));
  // 方案 二·问题 A：链路必须是"钩子回调 → 有序队列 → 状态归约"，而不是一个被最终值覆盖的布尔量。
  check('the hook callback really pushed events into the queue', cursorHealth?.pointerEventsSeen >= 2, String(cursorHealth?.pointerEventsSeen));
  check('the main thread drained them', cursorHealth?.pointerQueueDepth === 0, String(cursorHealth?.pointerQueueDepth));
  check('no button edge was dropped', cursorHealth?.pointerDroppedEdges === 0, String(cursorHealth?.pointerDroppedEdges));
  check('the resync reason is reported', typeof cursorHealth?.pointerResyncReason === 'string' && cursorHealth.pointerResyncReason.length > 0, String(cursorHealth?.pointerResyncReason));

  send({ method: 'setVisualPreferences', settingsRevision: 1, preferences: { cursorHalo: false } });
  const haloOff = await waitFor('visualPreferencesApplied');
  check('the halo can be turned off', haloOff?.applied === true && haloOff?.cursorHalo === false, JSON.stringify(haloOff));
  send({ method: 'health' });
  const afterOff = await waitFor('health');
  check('turning it off really removes the window', afterOff?.cursorSurface === 'disabled', String(afterOff?.cursorSurface));
  check('and stops the tracking', afterOff?.cursorTracking === 'idle', String(afterOff?.cursorTracking));

  send({ method: 'setVisualPreferences', settingsRevision: 1, preferences: { cursorHalo: true } });
  await waitFor('visualPreferencesApplied');
  console.log('\n== updateState: a monotonic sequence, and nothing else ==');
  send({ method: 'updateState', seq: 2, active: true });
  const applied = await waitFor('stateApplied');
  check('a new sequence is applied', applied?.applied === true && applied?.seq === 2, JSON.stringify(applied));
  send({ method: 'updateState', seq: 2, active: false });
  const stale = await waitFor('stateApplied');
  check('a replay of the same sequence is acknowledged but not applied', stale?.applied === false && stale?.seq === 2, JSON.stringify(stale));
  send({ method: 'updateState', active: true });
  const noSeq = await waitFor('error');
  check('a state change without a sequence is refused', noSeq?.code === 'BAD_REQUEST', JSON.stringify(noSeq));

  console.log('\n== setVisualPreferences: only a newer revision wins ==');
  send({ method: 'setVisualPreferences', settingsRevision: 2, preferences: { enabled: false, edgeBreathing: false } });
  const prefs = await waitFor('visualPreferencesApplied');
  check('the preference revision is applied', prefs?.applied === true && prefs?.settingsRevision === 2, JSON.stringify(prefs));
  check('and the helper reports the values it actually took', prefs?.enabled === false && prefs?.edgeBreathing === false, JSON.stringify(prefs));
  send({ method: 'setVisualPreferences', settingsRevision: 1, preferences: { enabled: true } });
  const older = await waitFor('visualPreferencesApplied');
  check('an older revision is not applied', older?.applied === false && older?.currentRevision === 2, JSON.stringify(older));
  send({ method: 'setVisualPreferences', settingsRevision: 3, preferences: { enabled: true, edgeBreathing: true } });
  const restored = await waitFor('visualPreferencesApplied');
  check('a newer revision restores the visuals', restored?.applied === true && restored?.enabled === true, JSON.stringify(restored));

  console.log('\n== the input is bounded, and a bad line does not kill the process ==');
  child.stdin.write(`${'x'.repeat(70 * 1024)}\n`);
  const tooLong = await waitFor('error');
  check('an over-long line is refused', tooLong?.code === 'LINE_TOO_LONG', JSON.stringify(tooLong)?.slice(0, 120));
  child.stdin.write('{not json}\n');
  const badJson = await waitFor('error');
  check('malformed JSON is refused', badJson?.code === 'BAD_JSON', JSON.stringify(badJson)?.slice(0, 160));
  send({ method: 'fly-to-the-moon' });
  const unknown = await waitFor('error');
  check('an unknown method is refused', unknown?.code === 'UNKNOWN_METHOD', JSON.stringify(unknown)?.slice(0, 160));

  console.log('\n== health while a scope is active ==');
  send({ method: 'health' });
  const health = await waitFor('health');
  check('health answers', health !== null);
  check('the scope is reported as active', health?.phase === 'active', String(health?.phase));
  check('frames are being presented', health?.frames > 0, String(health?.frames));
  check('the rejected commands are counted', health?.rejectedCommands >= 3, String(health?.rejectedCommands));
  check('the hook is still ready', health?.escapeReady === true, String(health?.escapeReady));

  console.log('\n== the character pack, when it is built ==');
  {
    const assets = join(HERE, 'assets', 'character');
    if (!existsSync(join(assets, 'pack.json'))) {
      console.log('  SKIP  the character pack is not built on this machine');
    } else {
      const withAssets = spawn(EXE, [`--assets=${assets}`], { stdio: ['pipe', 'pipe', 'pipe'] });
      const lines = [];
      let carry = '';
      withAssets.stdout.setEncoding('utf8');
      withAssets.stdout.on('data', (chunk) => {
        carry += chunk;
        let index;
        while ((index = carry.indexOf('\n')) >= 0) {
          const line = carry.slice(0, index).trim();
          carry = carry.slice(index + 1);
          if (line !== '') { try { lines.push(JSON.parse(line)); } catch { /* ignore */ } }
        }
      });
      const sendTo = (message) => withAssets.stdin.write(`${JSON.stringify({ requestId: message.method, ...message })}
`);
      const waitOn = async (event) => {
        for (let i = 0; i < 250; i += 1) {
          const found = lines.findIndex((one) => one.event === event);
          if (found >= 0) return lines.splice(found, 1)[0];
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return null;
      };
      sendTo({ method: 'hello', protocolVersion: 2 });
      await waitOn('ready');
      sendTo({ method: 'setVisualPreferences', settingsRevision: 1, preferences: { bannerCharacter: true, cursorCharacter: true } });
      await waitOn('visualPreferencesApplied');
      sendTo({ method: 'beginScope', scopeId: 'char', epoch: 1 });
      await waitOn('scopeReady');
      await new Promise((resolve) => setTimeout(resolve, 300));
      sendTo({ method: 'health' });
      const health = await waitOn('health');
      check('the pack loads', health?.characterSurface === 'ready', String(health?.characterSurface));
      // 素材版本由实际装进包里的 pack.json 决定（美术会整批替换资源），所以对着它比，而不是写死一个字符串。
      const shippedVersion = JSON.parse(readFileSync(join(HERE, 'assets', 'character', 'pack.json'), 'utf8')).assetVersion;
      check('it reports the shipped asset version', health?.characterAssetVersion === shippedVersion, String(health?.characterAssetVersion) + ' vs ' + String(shippedVersion));
      check('the character actually draws frames', health?.characterFrames > 0, String(health?.characterFrames));
      check('the state machine names a state', typeof health?.characterState === 'string' && health.characterState.length > 0, String(health?.characterState));
      sendTo({ method: 'shutdown' });
      await waitOn('closed');
      withAssets.kill();
    }
  }

  console.log('\n== 可见性矩阵：伴随 / 控制 / 暂停 / 减少动态（方案 8.3 的四行） ==');
  {
    // 单独起一个 helper：前面那一个已经跑过一串偏好，这里要的是干净状态。
    const fresh = spawn(EXE, ['--assets=' + join(HERE, 'assets', 'character')], { stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = [];
    let carry = '';
    fresh.stdout.setEncoding('utf8');
    fresh.stdout.on('data', (chunk) => {
      carry += chunk;
      let index;
      while ((index = carry.indexOf('\n')) >= 0) {
        const line = carry.slice(0, index).trim();
        carry = carry.slice(index + 1);
        if (line !== '') { try { lines.push(JSON.parse(line)); } catch { /* ignore */ } }
      }
    });
    let requestId = 0;
    const sendFresh = (message) => fresh.stdin.write(`${JSON.stringify({ requestId: `v${(requestId += 1)}`, ...message })}\n`);
    const waitFresh = async (event, timeoutMs = 8000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = lines.findIndex((one) => one.event === event);
        if (found >= 0) return lines.splice(found, 1)[0];
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return null;
    };
    const prefs = (extra) => {
      sendFresh({
        method: 'setVisualPreferences',
        settingsRevision: (requestId += 1),
        preferences: { enabled: true, bannerCharacter: true, cursorCharacter: true, cursorHalo: true, bannerDecoration: true, bannerTheme: 'ocean', bannerCharacterHeightDip: 144, cursorCharacterHeightDip: 96, ...extra },
      });
    };

    try {
      sendFresh({ method: 'hello', protocolVersion: 2 });
      const ready2 = await waitFresh('ready');
      check('the fresh helper answers ready', ready2?.protocolVersion === 2, JSON.stringify(ready2?.protocolVersion));

      prefs({});
      const appliedDefaults = await waitFresh('visualPreferencesApplied');
      check('the defaults are applied and echoed', appliedDefaults?.applied === true && appliedDefaults?.bannerCharacterHeightDip === 144, JSON.stringify(appliedDefaults));

      sendFresh({ method: 'beginScope', scopeId: 'matrix', epoch: 1 });
      const scope2 = await waitFresh('scopeReady');
      check('the scope opens with five windows per display', scope2?.counts?.displayWindowCount === scope2?.topology?.length * 5, JSON.stringify(scope2?.counts));

      // 控制中打开伴随：仍然只有一个光标窗口（方案 3.5 的"始终最多一个"）。
      sendFresh({ method: 'setCompanionPreferences', enabled: true, hostInstanceId: 'matrix-host', settingsRevision: (requestId += 1), helperGeneration: 1 });
      const both = await waitFresh('companionApplied');
      check('the companion shows up during control', both?.effectiveVisible === true, JSON.stringify(both));
      check('control and companion share one cursor window', both?.ownerMode === 'both' && both?.cursorWindows === 1, JSON.stringify({ mode: both?.ownerMode, windows: both?.cursorWindows }));
      check('control keeps the halo available', both?.cursorHaloVisible === true, String(both?.cursorHaloVisible));

      // 方案 4.D / 4.E 的两条验收：换姿势不重建 HWND；一次性片段的完成时间取自 pack。
      sendFresh({ method: 'health' });
      const churn = await waitFresh('health');
      const shipped = JSON.parse(readFileSync(join(HERE, 'assets', 'character', 'pack.json'), 'utf8')).clips;
      check('a pose switch never rebuilds the cursor window', churn?.cursorWindowCreates === 1, String(churn?.cursorWindowCreates));
      check('the press threshold comes from the pack', churn?.pressAnimationMs === shipped.press_in.totalMs,
        `${churn?.pressAnimationMs} vs ${shipped.press_in.totalMs}`);
      check('the release threshold comes from the pack', churn?.releaseAnimationMs === shipped.release.totalMs,
        `${churn?.releaseAnimationMs} vs ${shipped.release.totalMs}`);

      // 截图回退：暂停 → 结束 scope → 恢复。恢复**不能**复活已结束的 scope。
      sendFresh({ method: 'suspendVisual' });
      const suspended = await waitFresh('visualSuspended');
      check('suspend is acknowledged', suspended?.suspended === true, JSON.stringify(suspended));
      sendFresh({ method: 'endScope', scopeId: 'matrix' });
      const endedWhileHidden = await waitFresh('scopeEnded');
      check('the scope ends while the pixels are hidden', endedWhileHidden?.applied === true, JSON.stringify(endedWhileHidden));
      sendFresh({ method: 'resumeVisual' });
      const resumed = await waitFresh('visualResumed');
      check('resume does not resurrect the ended scope', resumed?.counts?.displayWindowCount === 0, JSON.stringify(resumed?.counts));
      check('and the companion is still the only owner', resumed?.ownerMode === 'companion', String(resumed?.ownerMode));

      sendFresh({ method: 'health' });
      const afterResume = await waitFresh('health');
      check('the cursor window survived the hand-off', afterResume?.counts?.cursorWindowCount === 1 && afterResume?.cursorVisible === true, JSON.stringify({ counts: afterResume?.counts, visible: afterResume?.cursorVisible }));
      // 日常伴随只买角色，不买光晕/高亮（方案 3.5 的表）。之前 render::DrawCursor 只看偏好、不看会话，
      // 于是只开伴随也会在鼠标旁挂一圈雾化光。
      check('companion keeps the character', afterResume?.cursorCharacterVisible === true, String(afterResume?.cursorCharacterVisible));
      check('companion does not turn the halo on', afterResume?.cursorHaloVisible === false, String(afterResume?.cursorHaloVisible));
      // 方案 4.B：两个低级钩子分别可观测。以前只有笼统的 escapeReady，鼠标钩子被系统摘掉也报正常。
      check('the mouse hook reports ready on its own', afterResume?.mouseHookReady === true, String(afterResume?.mouseHookReady));
      check('the keyboard hook reports ready on its own', afterResume?.keyboardHookReady === true, String(afterResume?.keyboardHookReady));

      // 关掉伴随：光标窗口必须真的消失（不是只设一个"不画"的标记）。
      sendFresh({ method: 'setCompanionPreferences', enabled: false, hostInstanceId: 'matrix-host', settingsRevision: (requestId += 1), helperGeneration: 1 });
      const companionOff = await waitFresh('companionApplied');
      check('turning the companion off removes the cursor window', companionOff?.cursorWindows === 0, JSON.stringify(companionOff));
      check('and says why nothing is visible', companionOff?.hiddenReason === 'disabled', String(companionOff?.hiddenReason));

      // 越界的高度被夹到范围内，而不是丢弃或照单全收。
      prefs({ bannerCharacterHeightDip: 400, cursorCharacterHeightDip: 20 });
      const clamped = await waitFresh('visualPreferencesApplied');
      check('an oversized height is clamped to the range', clamped?.bannerCharacterHeightDip === 176, String(clamped?.bannerCharacterHeightDip));
      check('a tiny height is clamped too', clamped?.cursorCharacterHeightDip === 72, String(clamped?.cursorCharacterHeightDip));

      // 减少动态：开了 scope 也不再换帧（characterFrames 停住）。
      prefs({ reducedMotion: true });
      await waitFresh('visualPreferencesApplied');
      sendFresh({ method: 'beginScope', scopeId: 'matrix-reduced', epoch: 2 });
      await waitFresh('scopeReady');
      sendFresh({ method: 'health' });
      const beforeFreeze = await waitFresh('health');
      await new Promise((resolve) => setTimeout(resolve, 700));
      sendFresh({ method: 'health' });
      const afterFreeze = await waitFresh('health');
      check('reduced motion freezes the character frames', Number(afterFreeze?.characterFrames) - Number(beforeFreeze?.characterFrames) <= 3, `${beforeFreeze?.characterFrames} -> ${afterFreeze?.characterFrames}`);
      check('reduced motion still reports the surface as ready', afterFreeze?.characterSurface === 'ready', String(afterFreeze?.characterSurface));

      sendFresh({ method: 'shutdown' });
      await waitFresh('closed');
    } finally {
      fresh.kill();
    }
  }

  console.log('\n== endScope, then shutdown ==');
  send({ method: 'endScope', scopeId: 'some-other-task' });
  const wrongEnd = await waitFor('scopeEnded');
  check('ending another scope is refused', wrongEnd?.applied === false, JSON.stringify(wrongEnd));
  send({ method: 'endScope', scopeId: 'task-1' });
  const ended = await waitFor('scopeEnded');
  check('ending the active scope is applied', ended?.applied === true, JSON.stringify(ended));
  check('and the frame count comes with it', ended?.frames > 0, String(ended?.frames));

  send({ method: 'shutdown' });
  const closed = await waitFor('closed', () => true, 8000);
  check('shutdown answers with closed', closed !== null, JSON.stringify(closed));
  check('the hook was removed', closed?.hookRemoved === true, String(closed?.hookRemoved));
  check('the windows are gone', closed?.windows === 0, String(closed?.windows));
  const code = await exited;
  check('the process exits cleanly', code === 0, String(code));
} finally {
  if (child.exitCode === null) child.kill();
}

console.log(`\n${passed} passed, ${failures.length} failed, ${skipped} skipped`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
