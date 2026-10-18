// Diagnostic: what does Windows actually expose for the B1 fixture window?
//
// `text-density-test.mjs` asserts against a WinForms fixture; when a provider exposes
// something other than what the test assumed, the useful output is not "FAIL" but the
// tree itself. This starts the same fixture shape, then dumps both the handle the
// fixture reports and the one the window list finds, with the patterns each row carries.
//
//   node tools/probe-window-tree.mjs [seconds]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PowerShellBackend } from '../backend/bridge.js';

const POWERSHELL = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const powershell = existsSync(POWERSHELL) ? POWERSHELL : 'powershell.exe';
const seconds = Number(process.argv[2] ?? 20);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const workDir = mkdtempSync(join(tmpdir(), 'dsh-cu-probe-tree-'));
const probeScript = join(workDir, 'probe.ps1');
const readyFile = join(workDir, 'ready.txt');
writeFileSync(probeScript, [
  'param([string]$Dir)',
  'Add-Type -AssemblyName System.Windows.Forms',
  'Add-Type -AssemblyName System.Drawing',
  '$form = New-Object System.Windows.Forms.Form',
  "$form.Text = 'dsh-cu-text-probe'",
  '$form.ClientSize = New-Object System.Drawing.Size(620, 330)',
  '$form.StartPosition = "Manual"',
  '$form.Left = 120; $form.Top = 120',
  '$doc = New-Object System.Windows.Forms.RichTextBox',
  "$doc.Name = 'probeDoc'",
  '$doc.Left = 16; $doc.Top = 16; $doc.Width = 580; $doc.Height = 180',
  "$doc.Text = 'placeholder text'",
  '$button = New-Object System.Windows.Forms.Button',
  "$button.Name = 'probeButton'",
  "$button.Text = 'probe-action'",
  '$button.Left = 16; $button.Top = 210; $button.Width = 140',
  '$list = New-Object System.Windows.Forms.ListBox',
  "$list.Name = 'probeList'",
  '$list.Left = 180; $list.Top = 206; $list.Width = 220; $list.Height = 90',
  '$list.SelectionMode = [System.Windows.Forms.SelectionMode]::MultiExtended',
  '$list.Items.Add("alpha") | Out-Null',
  '$list.Items.Add("beta") | Out-Null',
  '$list.Items.Add("gamma") | Out-Null',
  '$form.Controls.AddRange(@($doc, $button, $list))',
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
const backend = new PowerShellBackend({ timeoutMs: 60_000 });
try {
  for (let i = 0; i < 100; i += 1) {
    if (existsSync(readyFile)) break;
    await sleep(100);
  }
  const reported = Number(readFileSync(readyFile, 'utf8').replace(/[^0-9]/g, ''));
  console.log(`fixture reports hwnd=${reported}`);
  await backend.start();
  const windows = await backend.request('windows', {});
  const match = windows.windows.filter((w) => /text-probe/i.test(w.title));
  console.log(`windows matching the fixture title: ${match.length}`);
  for (const w of match) console.log(`  hwnd=${w.hwnd} pid=${w.pid} "${w.title}" ${w.width}x${w.height} fg=${w.foreground}`);
  for (const target of [reported, ...match.map((w) => w.hwnd)]) {
    console.log(`\n=== uitree hwnd=${target} ===`);
    try {
      const tree = await backend.request('uitree', { hwnd: target, maxNodes: 200, maxDepth: 8, patterns: true }, { timeoutMs: 60_000 });
      console.log(`window: ${JSON.stringify(tree.window)} nodes=${tree.nodes.length} walked=${tree.walked} legacy=${tree.legacy === true}`);
      for (const node of tree.nodes) {
        const type = String(node.controlType).replace('ControlType.', '');
        console.log(`  d${node.depth} ${type} "${node.name}" #${node.automationId} [${(node.patterns ?? []).join(',')}] ${node.x},${node.y} ${node.width}x${node.height}${node.ref ? ` ref=${node.ref}` : ''}`);
      }
    } catch (error) {
      console.log(`  uitree failed: ${error.message}`);
    }
  }
  console.log('\nforeground now:');
  const fg = await backend.request('windows', {});
  const foreground = fg.windows.find((w) => w.foreground === true);
  console.log(`  ${foreground === undefined ? '(none reported)' : `${foreground.hwnd} "${foreground.title}" [${foreground.process}]`}`);
} catch (error) {
  console.error('probe-window-tree crashed:', error);
  process.exitCode = 1;
} finally {
  try { writeFileSync(join(workDir, 'stop'), 'stop\n', 'utf8'); } catch { /* gone already */ }
  await sleep(seconds > 0 ? 300 : 0);
  try { probe.kill(); } catch { /* already dead */ }
  backend.dispose();
  rmSync(workDir, { recursive: true, force: true });
  spawnSync('cmd', ['/c', 'exit'], { stdio: 'ignore' });
  setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref();
}
