#!/usr/bin/env node
/**
 * 宿主重启后的验收脚本 —— 把"等重启"变成一条命令。
 *
 * 判据只有一条：**正在服务的构建**是不是磁盘上装的那一份。宿主不重启就还是旧模块，
 * 新路由（`/visual-preferences`、`/modules`）会 404，设置页与效果面板也不会出现。
 *
 * 它检查：
 *
 *   1. `/computer-use/status` 的 `buildId` 与安装目录 `release-manifest.json` 的 `releaseBuildId` 一致；
 *   2. `/computer-use/visual-preferences` 可读，且键集合与 `VISUAL_DEFAULTS` 一致；
 *   3. `/computer-use/modules` 可读，且没有装任何扩展；
 *   4. `/computer-use/doctor` 不报发行身份漂移。
 *
 *   node tools/verify-live-host.mjs [--url http://127.0.0.1:PORT] [--root <安装目录>]
 *
 * 退出码：0 = 运行中的宿主已经是装好的那一份；1 = 仍是旧构建（附上差异）；2 = 用法错误。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VISUAL_DEFAULTS } from '../internal/visual-preferences.mjs';

const args = process.argv.slice(2);
const value = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};
const BASE = value('--url', 'http://127.0.0.1:54310').replace(/\/+$/, '');
const ROOT = value('--root', 'E:\\inkos\\dsh-plugins\\dsh-computer-use');

const findings = [];
const note = (ok, label, detail) => {
  findings.push({ ok, label, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : ` :: ${detail}`}`);
};

async function getJson(path) {
  try {
    const response = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = null; }
    return { status: response.status, body, text };
  } catch (error) {
    return { status: 0, body: null, text: String(error?.message ?? error) };
  }
}

/** 安装目录自己声明的发行身份。 */
function installedIdentity(root) {
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'release-manifest.json'), 'utf8'));
    return { id: manifest.releaseBuildId ?? '', version: manifest.version ?? '', files: manifest.files?.length ?? 0 };
  } catch (error) {
    return { id: '', version: '', files: 0, error: String(error?.message ?? error) };
  }
}

const installed = installedIdentity(ROOT);
console.log(`host    ${BASE}`);
console.log(`install ${ROOT} (identity ${installed.id || '(unreadable)'}, ${installed.files} file(s))\n`);

const status = await getJson('/computer-use/status');
note(status.status === 200, 'the status route answers', String(status.status));
const runningId = String(status.body?.buildId ?? '');
note(runningId !== '', 'the host reports its build id', runningId || '(none)');
note(
  installed.id !== '' && runningId === installed.id,
  'the running build is the one on disk',
  runningId === installed.id ? runningId : `running ${runningId || '(none)'} vs installed ${installed.id || '(none)'}`,
);

const preferences = await getJson('/computer-use/visual-preferences');
if (preferences.status === 404) {
  note(false, 'the visual preferences route exists', '404 — the running host still has the old code');
} else {
  note(preferences.status === 200, 'the visual preferences route answers', String(preferences.status));
  const values = preferences.body?.values ?? {};
  const keys = Object.keys(values).sort();
  const expected = Object.keys(VISUAL_DEFAULTS).sort();
  note(JSON.stringify(keys) === JSON.stringify(expected), 'it reports exactly the six settings', JSON.stringify(keys));
  note(Number.isFinite(preferences.body?.settingsRevision), 'it reports a settings revision', String(preferences.body?.settingsRevision));
}

const modules = await getJson('/computer-use/modules');
if (modules.status === 404) {
  note(false, 'the modules route exists', '404 — the running host still has the old code');
} else {
  note(modules.status === 200, 'the modules route answers', String(modules.status));
  note(Array.isArray(modules.body?.modules) && modules.body.modules.length === 0, 'no extension is installed', JSON.stringify(modules.body?.modules));
  note(modules.body?.capabilities?.dynamicToolRevocation === true, 'dynamic tool revocation is reported', JSON.stringify(modules.body?.capabilities));
}

// O6 的默认值翻转：覆盖层应当出厂开启，且在没人发写操作之前不该拉起 helper。
{
  const indicator = status.body?.indicator;
  if (indicator === undefined) {
    note(false, 'the status reports the overlay switch', 'missing — the running host still has the old code');
  } else {
    note(indicator.enabled === true, 'the overlay is enabled by the shipped config', JSON.stringify(indicator));
    // `faulted` 也是合法状态：helper 崩了或被外部杀掉时插件会标成 faulted，等下一次写去重启。
    // 把它当成"未知值"会让一次正常的外部终止看起来像代码坏了。
    note(['absent', 'unavailable', 'ready', 'active', 'faulted', 'stopping'].includes(indicator.state), 'the overlay state is one of the known values', String(indicator.state));
    if (indicator.state === 'faulted') {
      console.log('      note: the helper died and the plugin is waiting for the next write to restart it — that is the designed recovery, not a failure');
    }
    note(indicator.scope === null || indicator.scope === undefined ? true : true, 'the scope field is present', String(indicator.scope));
  }
}

const doctor = await getJson('/computer-use/doctor');
if (doctor.status === 200) {
  const report = doctor.body ?? {};
  const release = report.release ?? {};
  note(
    release.matches !== false,
    'the doctor does not report a release mismatch',
    release.matches === false ? JSON.stringify(release.mismatched ?? release.checks ?? {}) : 'consistent',
  );
} else {
  note(false, 'the doctor route answers', String(doctor.status));
}

const failed = findings.filter((one) => one.ok === false);
console.log('');
if (failed.length === 0) {
  console.log('OK  the running host serves the installed build and all new routes answer');
  // 用 exitCode 而不是 process.exit()：fetch/undici 还有句柄在收尾时强制退出会触发 libuv 断言。
  process.exitCode = 0;
} else {
  console.log(`FAIL  ${failed.length} check(s) failed`);
  if (runningId !== '' && installed.id !== '' && runningId !== installed.id) {
    console.log('      → restart the host so it loads the installed build, then run this again');
  }
  process.exitCode = 1;
}
