/** Why is every Notepad window in this environment a placeholder? */
import { spawn } from 'node:child_process';
import { PowerShellBackend } from './backend/bridge.js';

const backend = new PowerShellBackend({ timeoutMs: 60_000 });
try {
  const info = await backend.start();
  console.log(`worker ready (engine=${process.env.DSH_COMPUTER_UI_ENGINE ?? 'default'})`);

  const health = await backend.request('health', {});
  console.log(`health: interactive=${health.interactive} foreground=${health.foregroundHwnd} "${health.foregroundTitle}"`);

  const child = spawn('notepad.exe', [], { detached: true, stdio: 'ignore' });
  child.unref();
  console.log('\nlaunched notepad, sampling for 8 seconds:');
  for (let round = 0; round < 8; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const listed = await backend.request('windows', { filter: 'notepad' }, { timeoutMs: 30_000 });
    const rows = [];
    for (const win of listed.windows) {
      let nodes = 0;
      let editable = 0;
      let sample = '';
      try {
        const tree = await backend.request('uitree', { hwnd: win.hwnd, maxDepth: 6, maxNodes: 200 }, { timeoutMs: 60_000 });
        nodes = tree.nodes.length;
        editable = tree.nodes.filter((n) => (n.patterns ?? []).some((p) => p === 'value' || p === 'text')).length;
        sample = tree.nodes.slice(0, 4).map((n) => `${n.controlType.replace('ControlType.', '')}"${n.name}"[${(n.patterns ?? []).join('+')}]`).join(' ');
      } catch (error) {
        sample = `tree failed: ${error.message.slice(0, 60)}`;
      }
      rows.push(`    hwnd=${win.hwnd} "${win.title}" ${win.width}x${win.height} fg=${win.foreground} nodes=${nodes} editable=${editable} :: ${sample}`);
    }
    console.log(`  [${round + 1}s] ${listed.windows.length} window(s)`);
    console.log(rows.join('\n'));
  }
  await backend.request('shutdown', {});
} catch (error) {
  console.error('CRASHED:', error.message);
  process.exitCode = 1;
} finally {
  backend.dispose();
  setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref();
}
