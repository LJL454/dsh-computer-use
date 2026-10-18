// Triggering the two capture refusals: a frame with no contrast, and require=window when
// the window cannot render itself.
import { spawn, execFileSync } from 'node:child_process';
import { PowerShellBackend } from './backend/bridge.js';

// A window that is one flat colour, so its pixels carry no contrast at all.
const maker = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$f = New-Object System.Windows.Forms.Form
$f.Text = 'flat'
$f.BackColor = [System.Drawing.Color]::FromArgb(32, 32, 32)
$f.ClientSize = New-Object System.Drawing.Size(320, 240)
$f.StartPosition = 'Manual'
$f.Location = New-Object System.Drawing.Point(200, 200)
$f.Show()
$f.Refresh()
Start-Sleep -Seconds 25
`;
const flat = spawn('powershell.exe', ['-NoProfile', '-Command', maker], { detached: true, stdio: 'ignore' });
flat.unref();
await new Promise((r) => setTimeout(r, 4000));

const b = new PowerShellBackend({ timeoutMs: 90_000 });
await b.start();
const listed = await b.request('windows', {}, { timeoutMs: 30_000 });
const target = (listed.windows ?? []).find((w) => /^flat$/.test(String(w.title)));
if (!target) {
  console.log('the flat window did not appear; windows seen:');
  for (const w of (listed.windows ?? []).slice(0, 8)) console.log(`  [${w.process}] "${w.title}"`);
} else {
  console.log(`flat window: hwnd=${target.hwnd} ${target.width}x${target.height} at ${target.x},${target.y}`);
  const attempt = (args) => b.request('screenshot', args, { timeoutMs: 45_000 }).then((r) => ({ ok: true, r }), (e) => ({ ok: false, m: String(e.message).replace(/^screenshot failed:\s*/, '') }));

  const plain = await attempt({ window: target.hwnd, path: './flat.png', format: 'png' });
  console.log(`\nplain window capture -> ${plain.ok ? `ACCEPTED source=${plain.r.source} ${plain.r.width}x${plain.r.height} bytes=${plain.r.bytes}` : plain.m.slice(0, 200)}`);

  const required = await attempt({ window: target.hwnd, requireWindow: true, path: './flat2.png', format: 'png' });
  console.log(`\nrequire=window       -> ${required.ok ? `ACCEPTED source=${required.r.source}` : required.m.slice(0, 240)}`);

  // And a normal window with require: the guarantee holds, so it must not be refused.
  const np = (listed.windows ?? []).find((w) => /notepad/i.test(w.process));
  if (np) {
    const okCase = await attempt({ window: np.hwnd, requireWindow: true, path: './req-ok.png', format: 'png' });
    console.log(`\nrequire=window on a normal window -> ${okCase.ok ? `ACCEPTED source=${okCase.r.source} ${okCase.r.width}x${okCase.r.height}` : okCase.m.slice(0, 200)}`);
  }
}
await b.request('shutdown', {});
b.dispose();
try { execFileSync('taskkill', ['/IM', 'powershell.exe', '/F', '/FI', 'WINDOWTITLE eq flat'], { stdio: 'ignore' }); } catch { /* best effort */ }
setTimeout(() => process.exit(0), 100).unref();
