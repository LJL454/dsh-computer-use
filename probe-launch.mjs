/**
 * Probe: how does computer_launch resolve each kind of target?
 *
 * App launching has four different resolution paths (a path, a name on PATH, a
 * Start-menu shortcut, an installed app addressed by its AUMID) and each can fail in
 * its own way, so this prints the resolution and the window it produced for a few
 * representative names. Edit TARGETS for the machine under test.
 *
 *   node probe-launch.mjs
 */
import { PowerShellBackend } from './backend/bridge.js';

/** Display names are localized: put whatever this machine's Start menu actually lists. */
const TARGETS = ['notepad', '计算器', '画图', 'Calculator'];

const backend = new PowerShellBackend({ timeoutMs: 45_000 });

try {
  await backend.start();
  for (const target of TARGETS) {
    const started = Date.now();
    try {
      const result = await backend.request('launch', { target, waitSeconds: 8 }, { timeoutMs: 40_000 });
      console.log(`OK   ${target} [${Date.now() - started}ms] ${JSON.stringify(result)}`);
    } catch (error) {
      console.log(`FAIL ${target}: ${error.message}`);
    }
  }
  await backend.request('shutdown', {});
} catch (error) {
  console.error('PROBE CRASHED:', error);
  process.exitCode = 1;
} finally {
  backend.dispose();
  setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref();
}
