/**
 * 1.40.0 hardening regressions:
 *
 *   1. duplicate mounts are refused before any tool/route is registered;
 *   2. the release identity covers the whole production tree, not only worker.ps1;
 *   3. doctor reports a missing release script instead of `ok=true` (the §H false pass);
 *   4. doctor's offline mode does not invent host-only failures;
 *   5. a bare command name is actually searched on PATH, not assumed missing/found;
 *   6. the CDP constructor names a missing global WebSocket;
 *   7. the offline profile check finds the known "dependency exists but bundle missing" state,
 *      a second user-patch mount, and legacy packages.
 *
 *   node tests/hardening-test.mjs
 */
import { registerHooks } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-hardening-'));
const stub = join(shimDir, 'dsh-tools-stub.mjs');
writeFileSync(stub, 'export const defineTool = (definition) => definition;\n');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: pathToFileURL(stub).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`);
  }
}

const tempRoots = [shimDir];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

/** A host-shaped fake: `root` is shared by all mounts in one "host". */
function makeHost(root = undefined) {
  const tools = new Map();
  const routes = new Map();
  const effects = [];
  const errors = [];
  const ctx = {
    ...(root === undefined ? {} : { root }),
    tools: { register(definition) { tools.set(definition.name, definition); return () => tools.delete(definition.name); } },
    on() {},
    effect(fn, label) {
      const disposer = fn();
      effects.push({ label, dispose: typeof disposer === 'function' ? disposer : () => {} });
      return () => {};
    },
    inject(deps, callback) {
      if (deps.every((name) => name === 'webServer')) callback(ctx);
      return () => {};
    },
    get() { return undefined; },
    logger: {
      info() {},
      warn() {},
      error(message) { errors.push(String(message)); },
    },
    webServer: {
      register(route) {
        if (routes.has(route.path)) throw new Error(`duplicate exact route "${route.path}"`);
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      },
    },
  };
  return { ctx, tools, routes, effects, errors };
}

/** Call one route handler. */
async function callRoute(route) {
  let text = '';
  const req = { method: 'GET', url: route.path };
  const res = { writeHead() {}, end(chunk) { text += chunk ?? ''; } };
  await route.handler(req, res);
  return JSON.parse(text);
}

const plugin = await import('../index.js');
const { buildReleaseIdentity } = await import('../internal/release-manifest.mjs');
const { collectDoctorReport } = await import('../internal/doctor.mjs');
const { locatePowerShell } = await import('../internal/powershell.mjs');
const { CdpConnection, CdpError } = await import('../browser/connection.mjs');
const { inspectProfile } = await import('../internal/profile-check.mjs');
const { parseDiagnosticReport } = await import('../internal/diagnostic-report.mjs');

/* --------------------------------------------------------- duplicate mounts -- */

console.log('\n== one owner per host root ==');
{
  const hostRoot = {};
  const first = makeHost(hostRoot);
  const second = makeHost(hostRoot);
  plugin.apply(first.ctx, { appLaunch: { enabled: false }, tokenGuard: { enabled: false } });
  const toolsAfterFirst = first.tools.size;
  const routesAfterFirst = first.routes.size;
  check('the first mount registers tools', toolsAfterFirst > 10, String(toolsAfterFirst));
  check('and the fixed routes', routesAfterFirst === 4, String(routesAfterFirst));

  plugin.apply(second.ctx, { appLaunch: { enabled: false }, tokenGuard: { enabled: false } });
  check('the second mount registers no tools at all', second.tools.size === 0, String(second.tools.size));
  check('the second mount registers no routes', second.routes.size === 0, String(second.routes.size));
  check('and says DUPLICATE_INSTANCE with both paths',
    second.errors.some((message) => message.includes('DUPLICATE_INSTANCE') && message.includes('dsh-computer-use')),
    second.errors.join(' | '));

  const status = await callRoute(first.routes.get('/computer-use/status'));
  check('the first instance stays usable', status?.ok === true && status?.runtime?.instance?.packageName === '@local/dsh-computer-use');
  check('the first status counts the duplicate attempt', status?.runtime?.instance?.duplicateAttempts === 1, JSON.stringify(status?.runtime?.instance));
  check('the first status reports a release identity', typeof status?.runtime?.release?.buildId === 'string' && status.runtime.release.buildId.length === 16, JSON.stringify(status?.runtime?.release));

  for (const effect of [...first.effects].reverse()) effect.dispose();
  const afterDispose = makeHost(hostRoot);
  plugin.apply(afterDispose.ctx, { appLaunch: { enabled: false }, tokenGuard: { enabled: false } });
  check('a disposed host frees the slot for the next mount', afterDispose.tools.size > 10, String(afterDispose.tools.size));
  for (const effect of [...afterDispose.effects].reverse()) effect.dispose();
}

/* ------------------------------------------------------------ release identity -- */

console.log('\n== releaseBuildId covers every production file ==');
{
  const root = tempDir('dsh-cu-release-');
  writeFileSync(join(root, 'a.txt'), 'a', 'utf8');
  writeFileSync(join(root, 'b.txt'), 'b', 'utf8');
  const one = buildReleaseIdentity(root, { files: ['a.txt', 'b.txt'] });
  writeFileSync(join(root, 'b.txt'), 'changed', 'utf8');
  const two = buildReleaseIdentity(root, { files: ['a.txt', 'b.txt'] });
  check('the id is 16 hex characters', /^[0-9a-f]{16}$/.test(one.buildId), one.buildId);
  check('changing one file changes the id', one.buildId !== two.buildId, `${one.buildId} vs ${two.buildId}`);
  check('the file list records each hash', one.files.length === 2 && one.files.every((entry) => entry.sha256.length === 64));
  const missing = buildReleaseIdentity(root, { files: ['a.txt', 'missing.txt'] });
  check('a missing file is named, not silently skipped', missing.missing.includes('missing.txt'), JSON.stringify(missing.missing));
}

/* ------------------------------------------------------------------- doctor -- */

console.log('\n== doctor: missing release script is fatal ==');
{
  const missingRelease = join(tempDir('dsh-cu-doctor-'), 'release-input.ps1');
  const fakeRelease = {
    present: false,
    buildId: '0123456789abcdef',
    files: 0,
    missing: [],
    extra: [],
    mismatched: [],
    matches: false,
    error: '',
    manifest: null,
    manifestPath: '',
  };
  const report = collectDoctorReport({
    mode: 'offline',
    paths: { release: missingRelease },
    release: fakeRelease,
  });
  check('ok is false', report.ok === false);
  check('RELEASE_SCRIPT_MISSING is a fatal finding',
    report.findings.some((entry) => entry.code === 'RELEASE_SCRIPT_MISSING' && entry.level === 'fatal'),
    JSON.stringify(report.findings.map((entry) => `${entry.level}:${entry.code}`)));
  check('offline mode does not invent NO_TOOLS_REGISTERED',
    !report.findings.some((entry) => entry.code === 'NO_TOOLS_REGISTERED'),
    JSON.stringify(report.findings.map((entry) => entry.code)));
  check('offline mode does not invent BACKEND_NOT_STARTED',
    !report.findings.some((entry) => entry.code === 'BACKEND_NOT_STARTED'),
    JSON.stringify(report.findings.map((entry) => entry.code)));
  check('the release summary is present', report.checks.release.buildId === '0123456789abcdef');
}

console.log('\n== doctor: release mismatch is fatal, and --release requires a manifest ==');
{
  const mismatch = collectDoctorReport({
    mode: 'host',
    registeredToolNames: ['computer_windows'],
    release: {
      present: true,
      buildId: '0123456789abcdef',
      files: 1,
      missing: [],
      extra: [],
      mismatched: ['index.js'],
      matches: false,
      checks: { version: true, hashes: false },
      error: '',
      manifest: { version: '1.40.0', releaseBuildId: 'fedcba9876543210', files: 1 },
      manifestPath: 'C:\\x\\release-manifest.json',
    },
  });
  check('RELEASE_BUILD_MISMATCH is fatal',
    mismatch.findings.some((entry) => entry.code === 'RELEASE_BUILD_MISMATCH' && entry.level === 'fatal'),
    JSON.stringify(mismatch.findings.map((entry) => entry.code)));
  const strict = collectDoctorReport({
    mode: 'offline',
    requireReleaseManifest: true,
    release: {
      present: false, buildId: '0123456789abcdef', files: 0, missing: [], extra: [], mismatched: [], matches: false, error: '', manifest: null,
    },
  });
  check('a missing manifest is fatal under --release',
    strict.findings.some((entry) => entry.code === 'RELEASE_MANIFEST_MISSING' && entry.level === 'fatal'),
    JSON.stringify(strict.findings.map((entry) => `${entry.level}:${entry.code}`)));
}

/* --------------------------------------------------------------- PowerShell -- */

console.log('\n== PowerShell: bare names are searched on PATH ==');
{
  const dir = tempDir('dsh-cu-path-');
  const fake = join(dir, 'fake-pwsh.exe');
  writeFileSync(fake, '', 'utf8');
  const found = locatePowerShell({ candidates: ['fake-pwsh.exe'], env: { PATH: dir, PATHEXT: '.EXE' } });
  check('a bare name that exists on PATH is found', found.found === true && found.command === fake, JSON.stringify(found));
  const missing = locatePowerShell({ candidates: ['definitely-not-installed-pwsh.exe'], env: { PATH: dir, PATHEXT: '.EXE' } });
  check('a bare name that does not exist is reported missing', missing.found === false, JSON.stringify(missing));
  check('the fallback still names a command for spawn to report', missing.command.endsWith('.exe'), missing.command);
}

/* -------------------------------------------------------------- WebSocket -- */

console.log('\n== CDP: no global WebSocket is a named capability error ==');
{
  const saved = globalThis.WebSocket;
  let error = null;
  try {
    // eslint-disable-next-line no-global-assign
    delete globalThis.WebSocket;
    try {
      new CdpConnection({ endpoint: 'http://127.0.0.1:1' });
    } catch (caught) {
      error = caught;
    }
  } finally {
    globalThis.WebSocket = saved;
  }
  check('the constructor throws CdpError', error instanceof CdpError, String(error));
  check('with the WEBSOCKET_UNAVAILABLE code', error?.code === 'WEBSOCKET_UNAVAILABLE', String(error?.code));
}

/* ------------------------------------------------------------ profile check -- */

console.log('\n== profile: link, bundle and duplicate-mount diagnostics ==');
{
  const root = tempDir('dsh-cu-profile-');
  const pluginDir = join(root, 'plugin');
  const profileDir = join(root, 'profile');
  mkdirSync(pluginDir, { recursive: true });
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({ name: '@local/dsh-computer-use', version: '1.40.0' }), 'utf8');
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'profile',
    dependencies: { '@local/dsh-computer-use': 'link:../plugin', '@local/dsh-token-guard': 'link:../legacy' },
    dsh: { profile: { bundles: [] } },
  }), 'utf8');
  writeFileSync(join(profileDir, 'cordis.patch.yml'), "- insert:\n    - id: computer-use\n      name: '@local/dsh-computer-use'\n", 'utf8');

  const report = inspectProfile({ profile: profileDir, pluginRoot: pluginDir });
  const codes = report.findings.map((entry) => entry.code);
  check('the link target resolves', report.dependency?.package?.name === '@local/dsh-computer-use', JSON.stringify(report.dependency));
  check('BUNDLE_NOT_ENABLED is reported', codes.includes('BUNDLE_NOT_ENABLED'), codes.join(','));
  check('PROFILE_EXTRA_MOUNT is reported', codes.includes('PROFILE_EXTRA_MOUNT'), codes.join(','));
  check('LEGACY_DEPENDENCY_ACTIVE is reported', codes.includes('LEGACY_DEPENDENCY_ACTIVE'), codes.join(','));

  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'profile',
    dependencies: { '@local/dsh-computer-use': 'link:../plugin' },
    dsh: { profile: { bundles: ['@local/dsh-computer-use', '@local/dsh-computer-use'] } },
  }), 'utf8');
  const duplicated = inspectProfile({ profile: profileDir, pluginRoot: pluginDir });
  check('PROFILE_BUNDLE_DUPLICATE is reported',
    duplicated.findings.some((entry) => entry.code === 'PROFILE_BUNDLE_DUPLICATE'),
    duplicated.findings.map((entry) => entry.code).join(','));

  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'profile',
    dependencies: { '@local/dsh-computer-use': 'link:../plugin' },
    dsh: { profile: { bundles: ['@local/dsh-computer-use'] } },
  }), 'utf8');
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '# no duplicate row\n', 'utf8');
  const clean = inspectProfile({ profile: profileDir, pluginRoot: pluginDir });
  check('the clean profile has no link/bundle findings',
    !clean.findings.some((entry) => ['BUNDLE_NOT_ENABLED', 'PROFILE_LINK_MISSING', 'PROFILE_EXTRA_MOUNT', 'PROFILE_BUNDLE_DUPLICATE'].includes(entry.code)),
    clean.findings.map((entry) => entry.code).join(','));
}

/* --------------------------------------------------------- diagnostic report -- */

console.log('\n== native diagnostic report: first cause, not the waiting table ==');
{
  const report = [
    'dsh: startup failed: 1 required plugin did not activate',
    '',
    'Failed plugins (1):',
    '  some-plugin',
    '    Package: @local/some-plugin',
    '    Error: register() threw: duplicate exact route "/computer-use/status"',
    '    at register (host.js:1:1)',
    '',
    'Plugins waiting for services (2):',
    '  Plugin                Missing services',
    '  agent-loop (required)  tools',
    '  working-directory      tools',
  ].join('\n');
  const parsed = parseDiagnosticReport(report);
  check('the first failed plugin is named', parsed.firstFailure?.id === 'some-plugin', JSON.stringify(parsed.firstFailure));
  check('its package is kept', parsed.firstFailure?.package === '@local/some-plugin', parsed.firstFailure?.package);
  check('its first cause is kept', parsed.firstFailure?.detail.includes('duplicate exact route'), parsed.firstFailure?.detail);
  check('the required waiting entry is separated from the cause',
    parsed.requiredWaiting.length === 1 && parsed.requiredWaiting[0].id === 'agent-loop',
    JSON.stringify(parsed.requiredWaiting));
  check('the tools wait gets the provider hint',
    parsed.mentions.some((entry) => entry.code === 'TOOLS_SERVICE_WAIT'),
    JSON.stringify(parsed.mentions.map((entry) => entry.code)));
  check('the duplicate route is recognised as a computer-use mount',
    parsed.mentions.some((entry) => entry.code === 'COMPUTER_USE_DUPLICATE_ROUTE'),
    JSON.stringify(parsed.mentions.map((entry) => entry.code)));
  check('the report is not mistaken for a JSON document', parsed.format === 'text', parsed.format);
}

for (const dir of tempRoots) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

console.log(`\n===== ${passed} passed, ${failures.length} failed =====`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
