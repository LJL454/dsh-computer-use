/**
 * 有/无预热时"按下 → 首次 Present"的对照（方案 五.1 / 六）。
 *
 * 同一台机器、同一份资源包，唯一变量是 `--no-prewarm`：
 *   A 组：后台预热完成后再点击 —— 点击路径不应再有解码；
 *   B 组：禁用预热 —— 首次点击要把 press_in 解码 + 面积滤波，落在绘制线程上。
 *
 * 每组都是一次真实注入点击（置顶靶窗，不会点到用户的应用），读 helper 的
 * `pressToPresentMs`、`characterCacheBuildsUi/Worker`、`characterCacheEntries`。
 *
 *   node tools/measure-first-click.mjs [--runs 3]
 */
import { spawn } from 'node:child_process';
import { copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const EXE = join(ROOT, 'native', 'indicator-helper', 'build', 'dsh-interaction-indicator.exe');
const ASSETS = join(ROOT, 'assets', 'character');

const argOf = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] !== undefined ? Number(process.argv[index + 1]) : fallback;
};
const RUNS = Math.max(1, argOf('runs', 3));

const CLICK_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class FirstClick {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
}
"@
$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'; $form.TopMost = $true; $form.ShowInTaskbar = $false
$form.StartPosition = 'Manual'; $form.Location = New-Object System.Drawing.Point(240, 240)
$form.Size = New-Object System.Drawing.Size(240, 200)
$form.Show(); [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 250
[void][FirstClick]::SetCursorPos(360, 340)
Start-Sleep -Milliseconds 100
[FirstClick]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero)
for ($i = 0; $i -lt 12; $i++) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 20 }
[FirstClick]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)
for ($i = 0; $i -lt 30; $i++) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 20 }
$form.Close(); $form.Dispose()
`;

const clickScriptPath = join(tmpdir(), `dsh-first-click-${process.pid}.ps1`);
writeFileSync(clickScriptPath, CLICK_SCRIPT, 'utf8');

function runOnce(disablePrewarm) {
  return new Promise((resolve, reject) => {
    const staged = join(tmpdir(), `dsh-first-click-${process.pid}-${disablePrewarm ? 'off' : 'on'}.exe`);
    copyFileSync(EXE, staged);
    const args = [`--assets=${ASSETS}`, '--no-affinity'];
    if (disablePrewarm) args.push('--no-prewarm');
    const child = spawn(staged, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    const events = [];
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line === '') continue;
        try { events.push(JSON.parse(line)); } catch { /* ignore */ }
      }
    });
    let nextRequest = 0;
    const send = (message) => {
      const requestId = `r${nextRequest += 1}`;
      child.stdin.write(`${JSON.stringify({ requestId, ...message })}\n`);
      return requestId;
    };
    const waitFor = async (name, predicate = () => true, timeoutMs = 5000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const index = events.findIndex((one) => one.event === name && predicate(one));
        if (index >= 0) return events.splice(index, 1)[0];
        await new Promise((done) => setTimeout(done, 15));
      }
      return null;
    };
    const health = async (predicate = () => true, timeoutMs = 6000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const requestId = send({ method: 'health' });
        const sample = await waitFor('health', (one) => one.requestId === requestId && predicate(one), 400);
        if (sample !== null) return sample;
      }
      return null;
    };
    const runClick = () => new Promise((done, fail) => {
      const clicker = spawn('powershell', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', clickScriptPath], { windowsHide: true });
      clicker.on('exit', done);
      clicker.on('error', fail);
    });

    (async () => {
      const row = { disabled: disablePrewarm };
      try {
        send({ method: 'hello', protocolVersion: 2 });
        await waitFor('ready', () => true, 8000);
        send({ method: 'setCompanionPreferences', enabled: true, hostInstanceId: 'first-click', settingsRevision: 1, helperGeneration: 1 });
        await waitFor('companionApplied');
        const ready = await health((one) => (disablePrewarm ? true : one.prewarmState === 'done'), 8000);
        row.prewarmState = ready?.prewarmState ?? null;
        row.buildsUiBefore = ready?.characterCacheBuildsUi ?? null;
        row.entriesBefore = ready?.characterCacheEntries ?? null;
        await runClick();
        const after = (await health((one) => Number(one.pressToPresentMs) >= 0, 5000)) ?? (await health(null, 3000));
        row.pressToPresentMs = after?.pressToPresentMs ?? null;
        row.buildsUiAfter = after?.characterCacheBuildsUi ?? null;
        row.buildsWorker = after?.characterCacheBuildsWorker ?? null;
        row.entries = after?.characterCacheEntries ?? null;
        row.clicks = after?.pointerClicks ?? null;
        send({ method: 'shutdown' });
        await waitFor('closed', () => true, 3000);
        resolve(row);
      } catch (error) {
        reject(error);
      } finally {
        try { child.stdin.end(); } catch { /* gone */ }
        setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 200);
      }
    })();
  });
}

const rows = [];
for (let index = 0; index < RUNS; index += 1) {
  rows.push(await runOnce(false));
  rows.push(await runOnce(true));
}

console.log('\n预热 | pressToPresentMs | UiBuilds 前→后 | worker | 缓存条目 | 点击');
for (const row of rows) {
  console.log(
    `${row.disabled ? '关' : '开'}   | ${String(row.pressToPresentMs).padStart(16)} | ` +
    `${String(row.buildsUiBefore).padStart(5)}→${String(row.buildsUiAfter).padEnd(6)} | ` +
    `${String(row.buildsWorker).padStart(6)} | ${String(row.entries).padStart(8)} | ${row.clicks}`,
  );
}
const median = (list) => {
  const sorted = list.filter((value) => Number.isInteger(value)).sort((a, b) => a - b);
  return sorted.length === 0 ? null : sorted[Math.floor(sorted.length / 2)];
};
const warm = median(rows.filter((row) => !row.disabled).map((row) => row.pressToPresentMs));
const cold = median(rows.filter((row) => row.disabled).map((row) => row.pressToPresentMs));
console.log(`\n有预热中位数 ${warm} ms，无预热中位数 ${cold} ms${warm !== null && cold !== null ? `（差 ${cold - warm} ms）` : ''}`);
process.exit(0);
