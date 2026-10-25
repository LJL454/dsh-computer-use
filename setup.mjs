#!/usr/bin/env node
/**
 * One command installs this plugin and makes the profile safe.
 *
 *   node setup.mjs                          install into the desktop profile, then repair
 *   node setup.mjs --profile web            another profile
 *   node setup.mjs --check                  only inspect, change nothing
 *   node setup.mjs --repair-only            skip the install, repair paths only
 *   node setup.mjs --dsh-home <dir>         use another DSH_HOME (testing)
 *   node setup.mjs --app <dir>              DeepSeek Harness is not in the default location
 *   node setup.mjs --dsh-cli <cli.js>       npm-installed DSH: its real CLI entry
 *   node setup.mjs --host-modules <dir>     explicit host node_modules (testing)
 *   node setup.mjs --host-entry <file>      explicit running-host entry (diagnostics)
 *   node setup.mjs --json                   machine-readable result
 *
 * 1.40.3 fixes (research report P0-C)
 * -----------------------------------
 *   * An official desktop keeps only `resources/app.asar`; a plain-Node `existsSync` cannot see
 *     inside it. The old version read that as "the host CLI is missing" and refused to install on
 *     a perfectly clean official setup. The archive is now detected as a FILE and its interior is
 *     read by Electron's Node mode instead.
 *   * An npm-installed host has no `resources` and must not be required to ship
 *     `DeepSeek Harness.exe`: use `--dsh-cli`, or the discovered `node_modules/@deepseek-ai/dsh`.
 *   * Never build a junction into an asar virtual directory: Electron can read it, NTFS cannot
 *     treat it as a directory. An asar host resolves peers itself, so there is nothing to repair.
 *   * The exit code comes from a fresh scan, not from "how many repairs ran"; anything still
 *     shadowing the host is a non-zero exit.
 *   * The selected host version, path and profile are printed before anything changes.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = fileURLToPath(new URL('.', import.meta.url));
const LINKED = ['dsh-tools', 'dsh-scope'];

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const checkOnly = process.argv.includes('--check');
const repairOnly = process.argv.includes('--repair-only');
const jsonMode = process.argv.includes('--json');
const profile = arg('--profile', 'desktop');
const dshHome = arg('--dsh-home', process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh'));
const appDir = arg('--app', process.env.DSH_APP_DIR || join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness'));
const explicitCli = arg('--dsh-cli', '');
const explicitEntry = arg('--host-entry', '');
const explicitModules = arg('--host-modules', process.env.DSH_APP_MODULES || '');

const profileDir = join(dshHome, 'profiles', profile);
const profilePackages = join(profileDir, 'node_modules', '@deepseek-ai');

function say(line = '') {
  if (!jsonMode) console.log(line);
}

function fail(message, code = 2) {
  if (jsonMode) console.log(JSON.stringify({ ok: false, error: message, code }, null, 2));
  else console.error(`[X] ${message}`);
  process.exit(code);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { stdio: jsonMode ? 'pipe' : 'inherit', windowsHide: true, encoding: 'utf8', ...options });
}

function isLink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Whether a node_modules root really carries the host packages. */
function hasHostPackages(root) {
  return existsSync(join(root, '@deepseek-ai', 'dsh-tools')) || existsSync(join(root, '@deepseek-ai', 'dsh-scope'));
}

/** Walk up from any path to the nearest node_modules that carries the host packages. */
function hostModulesFrom(anchor) {
  let cursor = existsSync(anchor) && lstatSync(anchor).isDirectory() ? anchor : dirname(anchor);
  for (let depth = 0; cursor && depth < 15; depth += 1) {
    if (hasHostPackages(cursor)) return cursor;
    const candidate = join(cursor, 'node_modules');
    if (hasHostPackages(candidate)) return candidate;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return '';
}

/** Version reported for the selected host, when it is readable from this process. */
function readVersion(modules) {
  if (modules === '') return '';
  try {
    return JSON.parse(readFileSync(join(modules, '@deepseek-ai', 'dsh-tools', 'package.json'), 'utf8')).version ?? '';
  } catch {
    return '';
  }
}

/**
 * Identify the host to install into.
 * @returns {{ kind: 'desktop-asar'|'desktop-unpacked'|'npm-cli'|'custom', exe: string, cli: string, modules: string, version: string }}
 */
function detectInstall() {
  // 1. explicit host modules (also the testing hook)
  if (explicitModules !== '') {
    const modules = resolve(explicitModules);
    if (!hasHostPackages(modules)) fail(`--host-modules does not contain @deepseek-ai/dsh-tools: ${modules}`);
    return { kind: 'custom', exe: '', cli: '', modules, version: readVersion(modules) };
  }

  // 2. explicit CLI (npm host)
  if (explicitCli !== '') {
    const cli = resolve(explicitCli);
    if (!existsSync(cli)) fail(`--dsh-cli does not exist: ${cli}`);
    const modules = hostModulesFrom(cli);
    const npmKind = modules !== '' && !modules.toLowerCase().includes('\\resources\\app');
    return {
      kind: npmKind ? 'npm-cli' : 'desktop-unpacked',
      exe: process.execPath,
      cli,
      modules,
      version: readVersion(modules),
    };
  }

  // 3. desktop install: the executable is the requirement; the archive interior is not
  const exe = join(appDir, 'DeepSeek Harness.exe');
  if (existsSync(exe)) {
    const resources = join(appDir, 'resources');
    const asarFile = join(resources, 'app.asar');
    const unpackedModules = join(resources, 'app', 'dsh', 'node_modules');
    const asarModules = join(asarFile, 'dsh', 'node_modules');
    let modules = '';
    let kind = 'custom';
    if (existsSync(unpackedModules)) {
      modules = unpackedModules;
      kind = 'desktop-unpacked';
    } else if (existsSync(asarFile)) {
      // The archive is a regular FILE; its interior is visible only to Electron's Node mode.
      modules = asarModules;
      kind = 'desktop-asar';
    }
    const cli = modules === '' ? '' : join(modules, '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js');
    return { kind, exe, cli, modules, version: readVersion(modules) };
  }

  // 4. explicit host entry (diagnostics)
  if (explicitEntry !== '') {
    const entry = resolve(explicitEntry);
    if (!existsSync(entry)) fail(`--host-entry does not exist: ${entry}`);
    const modules = hostModulesFrom(entry);
    return { kind: 'custom', exe: process.execPath, cli: entry, modules, version: readVersion(modules) };
  }

  // 5. no desktop install: an npm-installed host
  const npmCandidates = [
    join(resolve(PLUGIN_ROOT), '..', 'node_modules', '@deepseek-ai', 'dsh'),
    join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh'),
  ];
  for (const candidate of npmCandidates) {
    if (existsSync(candidate)) {
      const modules = hostModulesFrom(candidate);
      return { kind: 'npm-cli', exe: process.execPath, cli: candidate, modules, version: readVersion(modules) };
    }
  }
  return { kind: 'custom', exe: '', cli: '', modules: '', version: '' };
}

/** Install command: Electron's Node mode for a desktop host, plain Node for an npm host. */
function installHost(host) {
  const addArgs = ['plugin', '--profile', profile, 'add', PLUGIN_ROOT];
  if (host.kind === 'desktop-asar' || host.kind === 'desktop-unpacked') {
    if (host.cli === '') fail(`cannot find the DSH host CLI under ${host.modules}; reinstall DeepSeek Harness or pass --dsh-cli`);
    return run(host.exe, ['--expose-internals', host.cli, ...addArgs], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: dshHome },
    });
  }
  if (host.cli === '') fail('no host CLI to run; pass --dsh-cli or --host-modules');
  return run(process.execPath, [host.cli, ...addArgs], { env: { ...process.env, DSH_HOME: dshHome } });
}

/** Classify `<profile>/node_modules/@deepseek-ai/<name>` against the running host. */
function classify(target, hostModules) {
  if (!existsSync(target) && !isLink(target)) return { state: 'absent' };
  if (isLink(target)) {
    let linkTarget = '';
    try { linkTarget = readlinkSync(target); } catch { linkTarget = ''; }
    let canonical = '';
    try { canonical = realpathSync.native(target); } catch { return { state: 'broken', linkTarget }; }
    if (hostModules !== '' && existsSync(hostModules)) {
      const hostCanonical = realpathSync.native(hostModules);
      if (canonical === hostCanonical || canonical.startsWith(`${hostCanonical}${sep}`)) {
        return { state: 'linked-current-host', linkTarget, canonical };
      }
    }
    return { state: 'linked-elsewhere', linkTarget, canonical };
  }
  let version = '(unreadable)';
  try { version = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).version; } catch {}
  return { state: 'real-copy', version };
}

function declaredInProfile() {
  const manifestPath = join(profileDir, 'package.json');
  if (!existsSync(manifestPath)) return [];
  let pkg = null;
  try { pkg = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { return []; }
  const found = [];
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const name of LINKED) {
      const spec = pkg?.[section]?.[`@deepseek-ai/${name}`];
      if (spec !== undefined) found.push({ section, name, spec });
    }
  }
  return found;
}

/* ------------------------------------------------------------------ main */

const host = detectInstall();
if (host.kind === 'custom' && host.modules === '') {
  fail(`No host found: no desktop install at ${appDir} and no npm DSH. Pass --app, --dsh-cli or --host-modules.`);
}
if (!existsSync(join(PLUGIN_ROOT, 'package.json'))) fail('Run this from inside the unzipped plugin folder.');

const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'));
say(`== ${manifest.name}@${manifest.version} -> profile "${profile}"`);
say(`   DSH_HOME  ${dshHome}`);
say(`   host kind ${host.kind}`);
say(`   host mods ${host.modules || '(none)'}`);
say(`   host ver  ${host.version || '(unknown from this process)'}`);

/* 1. install */
if (checkOnly || repairOnly) {
  say(`\n== install skipped (${checkOnly ? '--check' : '--repair-only'})`);
} else {
  say(`\n== 1/2  dsh plugin add${host.kind === 'desktop-asar' ? ' (asar host: Electron reads the archive)' : ''}`);
  const installed = installHost(host);
  if (installed.status !== 0) {
    const detail = (installed.stderr || installed.stdout || '').trim().slice(0, 800);
    fail(`the install command failed (exit ${installed.status}). Keep the output above.${detail === '' ? '' : `\n${detail}`}`, installed.status || 1);
  }
}

/* 2. repair */
say('\n== 2/2  profile cannot shadow the host packages');
const result = { host, problems: 0, repaired: 0, declared: [], entries: [] };
if (!existsSync(profileDir)) {
  say(`   profile "${profile}" does not exist yet; nothing to repair`);
} else if (host.kind === 'desktop-asar') {
  // A directory inside app.asar is not a Windows directory: it cannot be inspected or junctioned.
  say('   host packages live inside app.asar — the official loader resolves them itself; nothing to repair');
} else {
  for (const name of LINKED) {
    const target = join(profilePackages, name);
    const src = host.modules === '' ? '' : join(host.modules, '@deepseek-ai', name);
    const state = classify(target, host.modules);
    result.entries.push({ name, ...state });
    if (state.state === 'absent') {
      say(`   ${name.padEnd(10)} absent -> host falls back to its own copy (ok)`);
      continue;
    }
    if (state.state === 'linked-current-host') {
      say(`   ${name.padEnd(10)} link to the running host (ok)`);
      continue;
    }
    if (state.state === 'linked-elsewhere') {
      result.problems += 1;
      say(`   ${name.padEnd(10)} LINK TO ANOTHER HOST -> ${state.canonical}`);
      if (checkOnly) continue;
      if (src === '' || !existsSync(src)) { say(`   ${name.padEnd(10)} cannot repair: the host copy is missing`); continue; }
      run('cmd', ['/c', 'rmdir', target], { stdio: 'ignore' });
      const made = run('cmd', ['/c', 'mklink', '/J', target, src], { stdio: 'ignore' });
      if (made.status === 0 && existsSync(join(target, 'package.json'))) {
        result.repaired += 1;
        say(`   ${name.padEnd(10)} relinked to the running host`);
      } else {
        say(`   ${name.padEnd(10)} REPAIR FAILED — check permissions`);
      }
      continue;
    }
    if (state.state === 'broken') {
      result.problems += 1;
      say(`   ${name.padEnd(10)} BROKEN LINK -> ${state.linkTarget}`);
      if (checkOnly) continue;
      run('cmd', ['/c', 'rmdir', target], { stdio: 'ignore' });
      say(`   ${name.padEnd(10)} removed; the host will provide its own copy`);
      continue;
    }
    result.problems += 1;
    say(`   ${name.padEnd(10)} REAL COPY ${state.version}`);
    if (checkOnly) continue;
    if (src === '' || !existsSync(src)) { say(`   ${name.padEnd(10)} cannot repair: the host copy is missing`); continue; }
    run('cmd', ['/c', 'rmdir', '/s', '/q', target], { stdio: 'ignore' });
    const made = run('cmd', ['/c', 'mklink', '/J', target, src], { stdio: 'ignore' });
    if (made.status === 0 && existsSync(join(target, 'package.json'))) {
      result.repaired += 1;
      say(`   ${name.padEnd(10)} replaced with a junction to the running host`);
    } else {
      say(`   ${name.padEnd(10)} REPAIR FAILED — check permissions`);
    }
  }

  result.declared = declaredInProfile();
  for (const entry of result.declared) {
    say(`   package.json DECLARES @deepseek-ai/${entry.name} in ${entry.section} — delete that line, or the next install restores the copy`);
  }
}

/* 3. verdict: a fresh scan decides, not the repair counter */
let remaining = 0;
if (host.kind !== 'desktop-asar' && existsSync(profileDir)) {
  for (const name of LINKED) {
    const state = classify(join(profilePackages, name), host.modules).state;
    if (state !== 'absent' && state !== 'linked-current-host') remaining += 1;
  }
}
result.remaining = remaining;
result.declaredCount = result.declared.length;
result.ok = remaining === 0 && result.declared.length === 0;

if (jsonMode) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

say('');
if (result.ok) {
  say('[OK] The profile cannot shadow the host packages. Fully quit DeepSeek Harness, then start it again.');
  process.exit(0);
}
if (checkOnly) {
  say(`[!] ${remaining} path problem(s), ${result.declared.length} declared dependency line(s). Re-run without --check to repair the paths.`);
  process.exit(1);
}
if (remaining > 0) {
  say(`[!] ${result.repaired} path(s) repaired, but ${remaining} still shadow the host. Fix them before starting DSH.`);
  process.exit(1);
}
say(`[!] ${result.repaired} path(s) repaired, but the profile still declares the package. Delete those package.json lines, then restart DSH.`);
process.exit(1);
