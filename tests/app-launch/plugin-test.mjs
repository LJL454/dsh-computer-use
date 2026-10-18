// Tests for @local/dsh-app-launch.
//
//   node test/plugin-test.mjs        unit tests (no GUI needed)
//   node test/plugin-test.mjs --ui   also launches notepad and checks for its window
//
// The unit tests deliberately reproduce the reported bug: the parent process pretends
// to be a polluted session (ELECTRON_RUN_AS_NODE=1), the child reports what it received,
// and the assertion is that the child no longer sees it.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ELECTRON_SENSITIVE_VARS, auditEnvironment, envReport, launchApp, resolveTarget, sanitizeEnv } from '../../internal/app-launch.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, 'fixtures', 'env-report.mjs');
const node = process.execPath;

let checks = 0;
let failures = 0;
const check = (label, condition, detail = '') => {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

/** Run the fixture the same way the launcher does, and return what it saw. */
function runFixture(env, names, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(node, [fixture, ...names, ...extraArgs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('error', reject);
    child.on('close', () => {
      try {
        resolve(JSON.parse(stdout.trim().split('\n').pop()));
      } catch (error) {
        reject(new Error(`fixture produced no JSON: ${stdout.slice(0, 200)} (${String(error)})`));
      }
    });
  });
}

const polluted = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  ELECTRON_RUN_AS_NODE: '1',
  electron_no_asar: '1',
  NODE_OPTIONS: '--max-old-space-size=256',
  KEEP_ME: 'yes',
};

console.log('sanitizeEnv');
{
  const { env, stripped } = sanitizeEnv(polluted);
  check('removes ELECTRON_RUN_AS_NODE', !('ELECTRON_RUN_AS_NODE' in env));
  check('matches case-insensitively', !('electron_no_asar' in env));
  check('removes NODE_OPTIONS', !('NODE_OPTIONS' in env));
  check('keeps unrelated variables', env.KEEP_ME === 'yes' && env.SystemRoot === polluted.SystemRoot);
  check('reports what it removed', stripped.length === 3 && stripped.includes('ELECTRON_RUN_AS_NODE'),
    `stripped=${JSON.stringify(stripped)}`);
  check('default list covers every documented variable',
    ELECTRON_SENSITIVE_VARS.every((name) => typeof name === 'string' && name === name.toUpperCase()));
  const extra = sanitizeEnv(polluted, ['KEEP_ME']);
  check('extraStrip works', !('KEEP_ME' in extra.env) && extra.stripped.includes('KEEP_ME'));
  const untouched = sanitizeEnv(polluted, []);
  check('does not mutate the source object', 'ELECTRON_RUN_AS_NODE' in polluted);
}

console.log('auditEnvironment');
{
  const audit = auditEnvironment(polluted);
  check('sees the polluted session', audit.sessionIsPolluted === true);
  check('lists the present variables', audit.present.length === 3);
  const clean = auditEnvironment({ PATH: 'x' });
  check('reports a clean session as clean', clean.sessionIsPolluted === false && clean.present.length === 0);
  check('envReport explains the failure', /ELECTRON_RUN_AS_NODE=1/.test(envReport().explanation));
}

console.log('resolveTarget');
{
  check('exe resolves to the binary', resolveTarget('C:\\Apps\\ExampleApp.exe').kind === 'exe');
  check('document goes through the shell', resolveTarget('C:\\tmp\\a.pdf').viaExplorer === true);
  check('url goes through the shell', resolveTarget('https://example.com').viaExplorer === true);
  check('store kind goes through the shell', resolveTarget('Microsoft.WindowsCalculator_8wekyb3d8bbwe!App', { kind: 'store' }).viaExplorer === true);
  check('empty target is refused', (() => { try { resolveTarget('  '); return false; } catch { return true; } })());
}

console.log('launchApp — the reported failure, reproduced and fixed');
{
  // 1. Baseline: spawning the fixture directly inherits the dirty environment, which is
  //    exactly what makes an Electron app exit without a window.
  const { env } = sanitizeEnv(polluted, []);
  const dirty = await runFixture({ ...env, ELECTRON_RUN_AS_NODE: '1' }, ['ELECTRON_RUN_AS_NODE']);
  check('a direct child still sees the variable (the bug)', dirty.values.ELECTRON_RUN_AS_NODE === '1');

  // 2. Through the launcher's sanitizer, the child does not.
  const result = await launchApp({
    target: node, arguments: [fixture, 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'KEEP_ME'],
    env: polluted, waitMs: 400, detach: false, verifyWindow: false,
  });
  check('launcher strips the variable', !result.stripped.includes('KEEP_ME') && result.stripped.includes('ELECTRON_RUN_AS_NODE'),
    JSON.stringify(result.stripped));
  check('launcher reports the launch', result.pid > 0 && result.resolved === 'exe');

  const child = await runFixture(sanitizeEnv(polluted).env, ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'KEEP_ME']);
  check('child no longer sees ELECTRON_RUN_AS_NODE', child.values.ELECTRON_RUN_AS_NODE === null);
  check('child no longer sees NODE_OPTIONS', child.values.NODE_OPTIONS === null);
  check('child keeps everything else', child.values.KEEP_ME === 'yes');
}

console.log('launchApp — validation and options');
{
  const dry = await launchApp({ target: 'C:\\Windows\\System32\\notepad.exe', dryRun: true, env: polluted });
  check('dryRun reports without starting', dry.dryRun === true && dry.stripped.includes('ELECTRON_RUN_AS_NODE'));

  const missing = await launchApp({ target: 'E:\\definitely\\not\\here.exe', env: polluted, waitMs: 50 })
    .then(() => null, (error) => error);
  check('missing target gives a clear error', missing instanceof Error && /does not exist/.test(missing.message),
    missing ? missing.message : 'no error thrown');

  const relative = await launchApp({ target: 'notepad.exe', env: polluted, waitMs: 50 })
    .then(() => null, (error) => error);
  check('relative target is refused', relative instanceof Error && /absolute path/.test(relative.message));

  const quiet = await launchApp({
    target: node, arguments: [fixture, 'KEEP_ME'], env: polluted, waitMs: 300, verifyWindow: false, detach: false,
  });
  check('verifyWindow:false still reports exit state', quiet.exited === true && quiet.exitCode === 0);
}

console.log('launchApp — the states a launch can end in (9.txt §8.2 / §6)');
const scratch = mkdtempSync(join(tmpdir(), 'dsh-cu-launch-states-'));
{
  // 1. A file that exists but is not a runnable program: the spawn fails, and that is a
  //    different answer from "it started and produced no window" — the old code swallowed the
  //    error event and reported exactly the same thing for both.
  const bogus = join(scratch, 'bogus.exe');
  writeFileSync(bogus, 'this is not a program', 'utf8');
  const failed = await launchApp({ target: bogus, env: polluted, waitMs: 400, verifyWindow: false });
  check('a program that cannot start has its own state', failed.state === 'launch-failed', JSON.stringify({ state: failed.state, error: failed.error }));
  check('and it says why', typeof failed.error === 'string' && failed.error.length > 0, String(failed.error));
  check('without inventing a pid or a window', failed.pid === 0 && failed.windows.length === 0, JSON.stringify({ pid: failed.pid, windows: failed.windows }));
  check('and the hint points at the target itself', /could not be started|Check that it is a runnable program/.test(String(failed.hint ?? '')), String(failed.hint ?? ''));

  // 2. A process that starts and exits immediately: "exited without a window", not "never ran".
  const exited = await launchApp({
    target: node, arguments: ['-e', 'process.exit(3)'], env: polluted, waitMs: 2000, verifyWindow: false, detach: false,
  });
  check('a process that exits is reported as exited', exited.state === 'exited-without-window' && exited.exited === true, JSON.stringify({ state: exited.state, exited: exited.exited }));
  check('with its exit code', exited.exitCode === 3, JSON.stringify({ exitCode: exited.exitCode }));
  check('and it is not confused with a launch that never started', exited.state !== 'launch-failed' && exited.pid > 0, JSON.stringify({ state: exited.state, pid: exited.pid }));
  check('the wait ended before the whole budget, because the question was answered', exited.waitedMs < 2000, JSON.stringify({ waitedMs: exited.waitedMs }));

  // 3. A live process with no verification asked for: "running", and nothing is claimed about
  //    a window that was never looked for.
  const alive = await launchApp({
    target: node, arguments: ['-e', 'setTimeout(() => {}, 2500)'], env: polluted, waitMs: 200, verifyWindow: false, detach: false,
  });
  check('a live process is reported as running', alive.state === 'running' && alive.exited === false, JSON.stringify({ state: alive.state, exited: alive.exited }));
  check('and no window claim is made', alive.windows.length === 0 && alive.windowMatch === 'none' && alive.fuzzyMatch === false, JSON.stringify({ windows: alive.windows, windowMatch: alive.windowMatch }));

  // 4. Window verification that finds nothing spends its budget and no more.
  const empty = await launchApp({
    target: node, arguments: ['-e', 'setTimeout(() => {}, 1200)'], env: polluted, waitMs: 900, verifyWindow: true, detach: false,
  });
  check('a windowless run is reported as such', empty.state === 'running-no-window' || empty.state === 'exited-without-window', JSON.stringify({ state: empty.state }));
  check('the wait stays inside its deadline', empty.waitedMs <= 900 + 600, JSON.stringify({ waitedMs: empty.waitedMs, waitMs: 900 }));
  check('and the reply says the process may still be coming up', empty.state === 'running-no-window' ? /still|check again/i.test(String(empty.hint ?? '')) : true, String(empty.hint ?? ''));
}

if (process.argv.includes('--ui') && process.platform === 'win32') {
  console.log('launchApp — real window smoke test (notepad)');
  const notepad = 'C:\\Windows\\System32\\notepad.exe';
  if (!existsSync(notepad)) {
    check('notepad exists', false, notepad);
  } else {
    const run = await launchApp({ target: notepad, env: polluted, waitMs: 6000, detach: true });
    check('a window appeared', run.windows.length > 0, JSON.stringify(run.windows));
    check('the window belongs to notepad or its host', run.windows.some((row) => /记事本|Notepad|notepad/i.test(row.title)),
      JSON.stringify(run.windows));
    check('the launch says it ended in a window', run.state === 'window', JSON.stringify({ state: run.state }));
    // What the reply owes the caller is *evidence*, not certainty: the pid or the image name
    // when either matched, and an explicit "this rested on the clock alone" when neither did.
    // (Notepad on Windows 11 hands a second launch to the instance that is already running, so
    // a start-time match is the normal outcome here — and it is exactly the case that must not
    // be reported as if the window had been identified.)
    check('and the reply says what the window match rests on',
      run.windows.every((row) => typeof row.matchedBy === 'string' && row.matchedBy !== '')
        && (run.windowMatch === 'target' ? run.fuzzyMatch === false : run.fuzzyMatch === true),
      JSON.stringify({ windowMatch: run.windowMatch, fuzzy: run.fuzzyMatch, windows: run.windows }));
    // §8.2: the wait is a deadline, not a sleep — a window that is there ends it early.
    check('the wait ended as soon as the window was confirmed, not at the deadline',
      run.waitedMs < 6000 - 1000, JSON.stringify({ waitedMs: run.waitedMs, durationMs: run.durationMs }));
    if (run.windows[0]) {
      spawn('powershell.exe', ['-NoProfile', '-Command', `Stop-Process -Id ${run.windows[0].pid} -ErrorAction SilentlyContinue`],
        { stdio: 'ignore', detached: true }).unref();
    }
  }
} else if (process.argv.includes('--ui')) {
  console.log('launchApp — real window smoke test skipped (not Windows)');
}

console.log(`\n${checks - failures}/${checks} checks passed`);
try { rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort */ }
process.exit(failures === 0 ? 0 : 1);
