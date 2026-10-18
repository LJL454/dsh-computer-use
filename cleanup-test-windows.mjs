/**
 * Close the windows this plugin's probes opened, identified by the markers the
 * probes typed into them or by an untouched "untitled" title. Windows the user
 * already had open are left alone.
 *
 *   node cleanup-test-windows.mjs [--dry]
 */
import { PowerShellBackend } from './backend/bridge.js';

const dry = process.argv.includes('--dry');
const MARKERS = ['SendInput', 'DSH-UIA', 'DSH computer-use'];
const UNTITLED = /^(无标题|Untitled)/;

const backend = new PowerShellBackend({ timeoutMs: 20_000 });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  await backend.start();
  const { windows } = await backend.request('windows', {});
  const mine = windows.filter((w) => MARKERS.some((m) => w.title.includes(m)) || (UNTITLED.test(w.title) && /notepad|mspaint|记事本|画图/i.test(`${w.title} ${w.process}`)));
  if (mine.length === 0) {
    console.log('nothing to clean up');
  }
  for (const win of mine) {
    console.log(`${dry ? 'would close' : 'closing'} hwnd=${win.hwnd} [${win.process}] "${win.title}"`);
    if (dry) continue;
    try {
      await backend.request('focus', { hwnd: win.hwnd }, { timeoutMs: 6_000 });
      await wait(200);
      await backend.request('key', { keys: 'alt+f4' }, { timeoutMs: 6_000 });
      await wait(500);
      // Notepad asks to save; "don't save" is the right-hand button, then Enter.
      await backend.request('key', { keys: 'right' }, { timeoutMs: 6_000 });
      await backend.request('key', { keys: 'enter' }, { timeoutMs: 6_000 });
      await wait(400);
    } catch (error) {
      console.log(`  could not close it: ${error.message}`);
    }
  }
  const after = await backend.request('windows', {});
  console.log(`\nremaining visible windows: ${after.windows.length}`);
  for (const win of after.windows) console.log(`  [${win.process}] "${win.title}"`);
} catch (error) {
  console.error('CLEANUP FAILED:', error.message);
  process.exitCode = 1;
} finally {
  backend.dispose();
}
