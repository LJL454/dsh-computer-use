#!/usr/bin/env node
/**
 * One command installs this plugin and makes the profile safe.
 *
 *   node setup.mjs                      install into the desktop profile, then repair
 *   node setup.mjs --profile web        another profile
 *   node setup.mjs --check              only inspect, change nothing
 *   node setup.mjs --dsh-home <dir>     use another DSH_HOME (testing)
 *   node setup.mjs --app <dir>          DeepSeek Harness is not in the default location
 *
 * Why this exists
 * ---------------
 * Installing used to leave a real copy of `@deepseek-ai/dsh-tools` inside the profile
 * (older versions declared it as a peer). The host loads its own `tools` row from the
 * profile first, so a mismatched copy makes the whole application refuse to start:
 *
 *     The application could not start or stopped unexpectedly.
 *     agent-loop (required)  tools ...
 *
 * `dsh plugin add` runs pnpm, which no longer installs that copy (this version declares
 * no peer) and moves a leftover one to node_modules\.ignored. This script does the same
 * install and then verifies the profile cannot shadow the host packages — so a single
 * command is enough, for a human or for an assistant doing it for someone else.
 *
 * It cannot be done from package.json: pnpm does not run preinstall/install/postinstall/
 * prepare for a `link:` dependency (verified against pnpm 11.28.5 — none of them ran).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = fileURLToPath(new URL('.', import.meta.url));
const LINKED = ['dsh-tools', 'dsh-scope'];

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const checkOnly = process.argv.includes('--check');
const profile = arg('--profile', 'desktop');
const dshHome = arg('--dsh-home', process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh'));
const appDir = arg('--app', join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness'));

const exe = join(appDir, 'DeepSeek Harness.exe');
const cli = join(appDir, 'resources', 'app', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js');
const hostPackages = join(appDir, 'resources', 'app', 'dsh', 'node_modules', '@deepseek-ai');
const profileDir = join(dshHome, 'profiles', profile);
const profilePackages = join(profileDir, 'node_modules', '@deepseek-ai');

function fail(message, code = 2) {
  console.error(`[X] ${message}`);
  process.exit(code);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { stdio: 'inherit', windowsHide: true, ...options });
}

if (!existsSync(exe)) fail(`DeepSeek Harness was not found at "${appDir}". Pass --app <dir>.`);
if (!existsSync(cli)) fail(`The DSH host CLI is missing (${cli}). The install looks incomplete; reinstall DeepSeek Harness.`);
if (!existsSync(join(PLUGIN_ROOT, 'package.json'))) fail('Run this from inside the unzipped plugin folder.');

const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'));
console.log(`== ${manifest.name}@${manifest.version} -> profile "${profile}"`);
console.log(`   DSH_HOME ${dshHome}`);
console.log(`   app      ${appDir}`);

/* ---------------------------------------------------------------- 1. install */
if (checkOnly) {
  console.log('\n== --check: install skipped');
} else {
  console.log('\n== 1/2  dsh plugin add');
  const installed = run(exe, ['--expose-internals', cli, 'plugin', '--profile', profile, 'add', PLUGIN_ROOT], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: dshHome },
  });
  if (installed.status !== 0) fail(`the install command failed (exit ${installed.status}). Keep the output above.`, installed.status || 1);
}

/* ---------------------------------------------------------------- 2. repair */
console.log('\n== 2/2  profile cannot shadow the host packages');
let problems = 0;
let repaired = 0;
let declared = 0;

if (!existsSync(profileDir)) {
  console.log(`   profile "${profile}" does not exist yet; nothing to repair`);
} else {
  for (const name of LINKED) {
    const dst = join(profilePackages, name);
    const src = join(hostPackages, name);
    if (!existsSync(dst)) {
      console.log(`   ${name.padEnd(10)} absent -> host falls back to the app copy (ok)`);
      continue;
    }
    const item = lstatSync(dst);
    if (item.isSymbolicLink()) {
      console.log(`   ${name.padEnd(10)} junction/link (ok)`);
      continue;
    }
    problems += 1;
    let version = '(unreadable)';
    try { version = JSON.parse(readFileSync(join(dst, 'package.json'), 'utf8')).version; } catch {}
    console.log(`   ${name.padEnd(10)} REAL COPY ${version}`);
    if (checkOnly) continue;
    if (!existsSync(src)) { console.log(`   ${name.padEnd(10)} cannot repair: the app copy is missing`); continue; }
    run('cmd', ['/c', 'rmdir', '/s', '/q', dst], { stdio: 'ignore' });
    const made = run('cmd', ['/c', 'mklink', '/J', dst, src], { stdio: 'ignore' });
    if (made.status === 0 && existsSync(join(dst, 'package.json'))) {
      repaired += 1;
      console.log(`   ${name.padEnd(10)} replaced with a junction to the app copy`);
    } else {
      console.log(`   ${name.padEnd(10)} REPAIR FAILED — check permissions`);
    }
  }

  // A copy that is a declared dependency comes back on the next install. Say so.
  const manifestPath = join(profileDir, 'package.json');
  if (existsSync(manifestPath)) {
    let pkg = null;
    try { pkg = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch {}
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const name of LINKED) {
        if (pkg?.[section]?.[`@deepseek-ai/${name}`] !== undefined) {
          console.log(`   package.json DECLARES @deepseek-ai/${name} in ${section} — delete that line, or the next install restores the copy`);
          declared += 1;
        }
      }
    }
  }
}

/* ---------------------------------------------------------------- verdict */
console.log('');
if (problems === 0 && declared === 0) {
  console.log('[OK] The profile cannot shadow the host packages. Fully quit DeepSeek Harness, then start it again.');
  process.exit(0);
}
if (checkOnly) {
  console.log(`[!] ${problems} path problem(s), ${declared} declared dependency line(s). Re-run without --check to repair the paths.`);
  process.exit(1);
}
if (declared > 0) {
  console.log(`[!] ${repaired} path(s) repaired, but the profile still declares the package. Delete those package.json lines, then restart DSH.`);
  process.exit(1);
}
console.log(`[OK] ${repaired} path(s) repaired. Fully quit DeepSeek Harness, then start it again.`);
process.exit(0);
