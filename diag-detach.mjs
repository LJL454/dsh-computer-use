// Is `detached: true` what stops the GUI child from appearing?
import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PowerShellBackend } from './backend/bridge.js';

const candidates = readdirSync(tmpdir())
  .filter((name) => name.startsWith('dsh-flat-probe-') && name.endsWith('.ps1'))
  .map((name) => join(tmpdir(), name))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
const script = candidates[0];
console.log(`script: ${script}`);

const b = new PowerShellBackend({ timeoutMs: 60_000 });
await b.start();

const tryVariant = async (label, options) => {
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], options);
  console.log(`\n${label}: pid=${String(child.pid)}`);
  let appeared = '';
  for (let i = 0; i < 10; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    const listed = await b.request('windows', {}, { timeoutMs: 30_000 });
    const hit = (listed.windows ?? []).find((w) => /flat-probe/i.test(String(w.title)));
    if (hit) { appeared = `appeared after ${(i + 1) * 500} ms (hwnd=${hit.hwnd})`; break; }
  }
  console.log(`  ${appeared || `never appeared; exitCode=${String(child.exitCode)}`}`);
  try { process.kill(child.pid); } catch { /* already gone */ }
  await new Promise((r) => setTimeout(r, 500));
};

await tryVariant('detached: true,  stdio ignore', { detached: true, stdio: 'ignore' });
await tryVariant('detached: false, stdio ignore', { detached: false, stdio: 'ignore' });

await b.request('shutdown', {});
b.dispose();
setTimeout(() => process.exit(0), 100).unref();
