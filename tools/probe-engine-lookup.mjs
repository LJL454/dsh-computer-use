// Diagnostic: can the managed engine see the window the COM engine just read?
//
// The B1 text observation resolves its target through the managed UI Automation API.
// When that lookup finds nothing on a window whose COM tree is perfectly readable, the
// question is whether the managed client is blind on this window (a known failure mode
// for providers that answer through the MSAA bridge) or whether the lookup itself is
// wrong. This runs the fixture, reads it through both engines, and reports what each one
// can address.
//
//   node tools/probe-engine-lookup.mjs
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PowerShellBackend } from '../backend/bridge.js';

const POWERSHELL = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const powershell = existsSync(POWERSHELL) ? POWERSHELL : 'powershell.exe';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const workDir = mkdtempSync(join(tmpdir(), 'dsh-cu-engine-'));
const probeScript = join(workDir, 'probe.ps1');
const readyFile = join(workDir, 'ready.txt');
writeFileSync(probeScript, [
  'param([string]$Dir)',
  'Add-Type -AssemblyName System.Windows.Forms',
  'Add-Type -AssemblyName System.Drawing',
  '$form = New-Object System.Windows.Forms.Form',
  "$form.Text = 'dsh-cu-engine-probe'",
  '$form.ClientSize = New-Object System.Drawing.Size(520, 260)',
  '$form.StartPosition = "Manual"',
  '$form.Left = 140; $form.Top = 140',
  '$list = New-Object System.Windows.Forms.ListBox',
  "$list.Name = 'probeList'",
  '$list.Left = 16; $list.Top = 16; $list.Width = 300; $list.Height = 120',
  '$list.SelectionMode = [System.Windows.Forms.SelectionMode]::MultiExtended',
  '$list.Items.Add("alpha") | Out-Null',
  '$list.Items.Add("beta") | Out-Null',
  '$list.Items.Add("gamma") | Out-Null',
  '$list.SetSelected(0, $true)',
  '$list.SetSelected(2, $true)',
  '$form.Controls.AddRange(@($list))',
  '$form.Show()',
  '$form.Activate()',
  '[System.Windows.Forms.Application]::DoEvents()',
  'Set-Content -LiteralPath (Join-Path $Dir "ready.txt") -Value ("hwnd=" + $form.Handle)',
  '$timer = New-Object System.Windows.Forms.Timer',
  '$timer.Interval = 100',
  '$timer.Add_Tick({ if (Test-Path -LiteralPath (Join-Path $Dir "stop")) { $form.Close() } })',
  '$timer.Start()',
  '[System.Windows.Forms.Application]::Run($form)',
  '$timer.Stop()',
  'try { $form.Close() } catch { }',
].join('\n'), 'utf8');

const probe = spawn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', probeScript, workDir], {
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: false,
});
const engines = ['com', 'managed'];
try {
  for (let i = 0; i < 100; i += 1) {
    if (existsSync(readyFile)) break;
    await sleep(100);
  }
  const hwnd = Number(readFileSync(readyFile, 'utf8').replace(/[^0-9]/g, ''));
  await sleep(400);
  console.log(`fixture hwnd=${hwnd}`);
  for (const engine of engines) {
    process.env.DSH_COMPUTER_UI_ENGINE = engine;
    const backend = new PowerShellBackend({ timeoutMs: 60_000 });
    try {
      await backend.start();
      const tree = await backend.request('uitree', { hwnd, maxNodes: 120, maxDepth: 6, patterns: true }, { timeoutMs: 60_000 });
      const ids = tree.nodes.map((n) => n.automationId).filter((id) => id !== '');
      console.log(`\n[${engine}] uitree: nodes=${tree.nodes.length} ids=${JSON.stringify(ids.slice(0, 8))} legacy=${tree.legacy === true} reinit=${tree.reinit === true}`);
      const focus = await backend
        .request('uiact', { action: 'focus', hwnd, automationId: 'probeList' }, { timeoutMs: 30_000 })
        .then(() => 'ok', (error) => `failed: ${String(error.message).slice(0, 120)}`);
      console.log(`[${engine}] uiact focus automationId=probeList -> ${focus}`);
      const readText = await backend
        .request('uiact', { action: 'get_text', hwnd, automationId: 'probeList' }, { timeoutMs: 30_000 })
        .then((reply) => `ok (${String(reply.value ?? '').length} chars)`, (error) => `failed: ${String(error.message).slice(0, 140)}`);
      console.log(`[${engine}] uiact get_text automationId=probeList -> ${readText}`);
      const selectText = await backend
        .request('uiact', { action: 'select_text', hwnd, automationId: 'probeList', text: 'alpha' }, { timeoutMs: 30_000 })
        .then((reply) => `ok (${JSON.stringify(String(reply.value ?? '').slice(0, 30))})`, (error) => `failed: ${String(error.message).slice(0, 140)}`);
      console.log(`[${engine}] uiact select_text 'alpha' -> ${selectText}`);
    } catch (error) {
      console.log(`[${engine}] crashed: ${error.message}`);
    } finally {
      backend.dispose();
    }
  }
  delete process.env.DSH_COMPUTER_UI_ENGINE;
} catch (error) {
  console.error('probe-engine-lookup crashed:', error);
  process.exitCode = 1;
} finally {
  try { writeFileSync(join(workDir, 'stop'), 'stop\n', 'utf8'); } catch { /* gone already */ }
  await sleep(300);
  try { probe.kill(); } catch { /* already dead */ }
  rmSync(workDir, { recursive: true, force: true });
  setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref();
}
