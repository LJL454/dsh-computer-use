/**
 * Build a verifiable candidate package (§13.1–§13.7, plus the 1.40.0 release-identity fix).
 *
 * The plan's release requirements, and how this script answers them:
 *
 *   1. keep the original version and its hashes   -> `BASELINE` below, printed with every build
 *   2. every stage ships a candidate              -> one zip per run, named after the build id
 *   3. output/schema changes documented           -> `release-manifest.json` lists every
 *                                                    production file hash, and the zip is read back
 *   4. the whole release is one build identity    -> `releaseBuildId` covers index.js, client.js,
 *                                                    internal/, browser/, backend/, the patch and
 *                                                    the optional preset bundle; `workerBuildId`
 *                                                    remains the local protocol identity
 *   5. the build check covers all executed code   -> both `worker.ps1` and `release-input.ps1`
 *                                                    are in the identity *and* checked at startup
 *   6. the zip contains no previous releases      -> artifacts (`*.zip`, `*.tgz`, `_zips/`,
 *                                                    `dist/`, `artifacts/`, the output dir) are
 *                                                    excluded from the file walk
 *   7. host and worker roll back together         -> the manifest names both halves, and the
 *                                                    printed rollback line says "as a set"
 *
 * It does not publish anything: it writes a zip, prints a manifest, and stops. Publishing is a
 * decision, not a side effect of running a script.
 *
 *   node tools/pack-candidate.mjs [--out <dir>]
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  MANIFEST_NAME,
  buildReleaseIdentity,
  productionFiles,
  readPackageManifest,
  writeReleaseManifest,
} from '../internal/release-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = dirname(HERE);
const packageJson = readPackageManifest(PLUGIN).manifest;
if (packageJson === null) {
  console.error('FAIL cannot read package.json');
  process.exit(1);
}

/**
 * The version this work started from, with the two hashes that identify the pair (§13.1).
 *
 * `worker.ps1` is the one that matters most: host and worker must be rolled back together, and
 * the baseline hash is how "the original" is named without keeping a second copy of the source
 * in the repository.
 */
const BASELINE = {
  version: '1.39.1',
  workerSha256: '5e6787146c585e1141f8bebbb435da50f2d220cb63ec424cefaf236b9d4ebc7f',
  note: 'the release zip shipped as dist/dsh-computer-use-1.39.1.zip; this candidate is that build plus the 1.40.0 hardening work',
};

const outIndex = process.argv.indexOf('--out');
const outDir = outIndex >= 0 ? resolve(process.argv[outIndex + 1]) : join(PLUGIN, 'dist');
const stamp = new Date().toISOString().slice(0, 10);

/** Files a candidate must contain: every production file from the shared identity module. */
const REQUIRED = productionFiles(PLUGIN);

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const failures = [];
for (const name of REQUIRED) {
  try {
    statSync(join(PLUGIN, ...name.split('/')));
  } catch {
    failures.push(`missing required file: ${name}`);
  }
}
// §10/§13.5: `worker.ps1` 由 `backend/parts/` 生成，所以"片段改了但没重新生成"必须挡住打包——
// 否则包里会有两套互相矛盾的源码（片段 vs 生成物），宿主启动时的构建校验又只认生成物。
{
  const check = spawnSync(process.execPath, [join(PLUGIN, 'tools', 'build-worker.mjs'), '--check'], { encoding: 'utf8' });
  if (check.status !== 0) {
    const reason = `${check.stdout ?? ''}${check.stderr ?? ''}`.trim().split('\n')[0];
    failures.push(`worker.ps1 与 backend/parts 不一致，先跑 \`node tools/build-worker.mjs\`（${reason}）`);
  }
}
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}

/** Write the release manifest before the walk, so the zip and the manifest describe one tree. */
let writtenManifest;
try {
  writtenManifest = writeReleaseManifest(PLUGIN, { builtAt: new Date().toISOString() });
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const identity = buildReleaseIdentity(PLUGIN);

/** Directory names that are products of running the project, never inputs to a release. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'artifacts', '.git', '_zips', 'coverage', '.cache']);
/** File names that are previous releases or packer scratch. */
const ARTIFACT_SUFFIXES = ['.zip', '.tgz', '.tar', '.gz', '.7z', '.sha256', '.sha256.txt'];
const ARTIFACT_NAMES = new Set([MANIFEST_NAME]);

/**
 * Every file the package would ship, in a stable order.
 * @param dir - directory to walk.
 * @param list - accumulator.
 * @returns absolute paths.
 */
function walk(dir, list = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (resolve(full) === outDir) continue;
      walk(full, list);
      continue;
    }
    const lower = entry.name.toLowerCase();
    // release-manifest.json is the one generated file that *is* shipped; it is named apart
    // from the previous-release artifacts so the check can tell the two apart.
    if (!ARTIFACT_NAMES.has(entry.name) && ARTIFACT_SUFFIXES.some((suffix) => lower.endsWith(suffix))) continue;
    list.push(full);
  }
  return list;
}

const files = walk(PLUGIN)
  .filter((path) => !path.includes(`${dirname(PLUGIN)}${process.platform === 'win32' ? '\\' : '/'}dist`))
  // The plan's §10 row: shipping the diagnostics is deliberate — they are what a support request
  // needs — but the *runtime* set is what the build check covers, and the two are named apart.
  .map((path) => ({ path, name: relative(PLUGIN, path).split('\\').join('/') }));

const worker = identity.files.find((entry) => entry.name === 'backend/worker.ps1');
const manifest = {
  name: packageJson.name,
  version: packageJson.version,
  builtAt: new Date().toISOString(),
  baseline: BASELINE,
  // §G: the whole release, not just worker.ps1. The old `buildId` is kept as an alias for
  // scripts that still read it, but its meaning is now the release identity.
  releaseBuildId: identity.buildId,
  buildId: identity.buildId,
  workerBuildId: worker?.sha256?.slice(0, 16) ?? '',
  executionSet: identity.files,
  files: files.map((file) => ({ name: file.name, bytes: statSync(file.path).size, sha256: sha256(file.path) })),
};

mkdirSync(outDir, { recursive: true });
const manifestPath = join(outDir, `candidate-${stamp}-manifest.json`);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

// A zip via PowerShell keeps this dependency-free on the platform the plugin targets.
//
// The entry names are built explicitly, instead of using `Compress-Archive -Path $files.FullName`:
// that form derives each entry name from the file's own path, so every file landed at the archive
// ROOT and the directory tree was lost. The file list is handed over from `walk()` rather than
// re-derived by the packer, so the archive and the manifest are the same set by construction.
const zipPath = join(outDir, `dsh-computer-use-${packageJson.version}-${stamp}.zip`);
const listPath = join(outDir, `.zip-input-${stamp}.txt`);
// `ZipFile.Open(..., 'Create')` refuses an existing file. A rebuild must replace yesterday's
// candidate, not fail because the same version was packed earlier in the day.
rmSync(zipPath, { force: true });
writeFileSync(listPath, `${files.map((file) => file.name).join('\n')}\n`, 'utf8');

/**
 * Every entry gets this timestamp instead of its file's real one.
 *
 * A zip stores each entry's local modification time, so the archive quietly carries the author's
 * timezone offset **and** the hours they were working — a pattern of life, not a build artefact.
 * Normalising removes both, and buys a reproducible archive as a side effect: the same tree packs
 * to the same bytes. Noon is chosen so the date reads the same in every timezone; the DOS field
 * carries no offset at all, so nothing about the author's clock survives.
 */
const NORMALIZED_TIMESTAMP = `${stamp}T12:00:00Z`;

/**
 * A PowerShell single-quoted literal.
 *
 * Not `JSON.stringify`: JSON escapes a Windows path's backslashes as `\\`, and PowerShell's
 * double-quoted strings do not process that escape, so `"E:\\inkos\\…"` reaches the script as a
 * path with doubled separators. That silently shifted every `Substring` computed from it and
 * produced entry names missing their first characters (`tignore`, `kend/bridge.js`). A single-quoted
 * literal has no escapes at all; the only character it cannot hold is `'`, which is doubled.
 */
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

let zipOk = false;
try {
  const script = [
    `$ErrorActionPreference = 'Stop'`,
    `Add-Type -AssemblyName System.IO.Compression.FileSystem`,
    `$root = ${quote(PLUGIN)}`,
    `$names = @(Get-Content -LiteralPath ${quote(listPath)} | Where-Object { $_ -ne '' })`,
    `$stamp = [System.DateTimeOffset]::Parse(${quote(NORMALIZED_TIMESTAMP)})`,
    `$level = [System.IO.Compression.CompressionLevel]::Optimal`,
    `$zip = [System.IO.Compression.ZipFile]::Open(${quote(zipPath)}, 'Create')`,
    `try {`,
    `  foreach ($rel in $names) {`,
    `    $full = Join-Path $root ($rel.Replace('/', '\\'))`,
    // `CreateEntryFromFile` returns an entry whose content stream is already open, and .NET then
    // refuses `LastWriteTime` ("Cannot modify entry in Create mode after entry has been opened for
    // writing"). Creating the entry, stamping it, and only then filling it is also the order that
    // makes the timestamp policy readable.
    `    $entry = $zip.CreateEntry("dsh-computer-use/$rel", $level)`,
    `    $entry.LastWriteTime = $stamp`,
    `    $out = $entry.Open()`,
    `    $in = [System.IO.File]::OpenRead($full)`,
    `    try { $in.CopyTo($out) } finally { $in.Dispose(); $out.Dispose() }`,
    `  }`,
    `} finally { $zip.Dispose() }`,
  ].join('; ');
  const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8' });
  zipOk = result.status === 0 && statSync(zipPath).size > 0;
  if (!zipOk) console.error(`zip failed: ${(result.stderr || '').slice(0, 300)}`);
} catch (error) {
  console.error(`zip failed: ${String(error?.message ?? error)}`);
} finally {
  rmSync(listPath, { force: true });
}

console.log(`candidate: ${packageJson.name}@${packageJson.version} (release ${manifest.releaseBuildId}, worker ${manifest.workerBuildId})`);
console.log(`baseline : ${BASELINE.version}, worker.ps1 sha256 ${BASELINE.workerSha256.slice(0, 16)}…`);
console.log(`manifest : ${manifestPath} (${manifest.files.length} shipped files, ${manifest.executionSet.length} in the execution set)`);
console.log(zipOk ? `package  : ${zipPath}` : 'package  : NOT BUILT (see the error above)');

/**
 * Read the archive back and judge it, rather than trusting the packer.
 *
 * §13.2 says every stage ships a candidate; the one failure a candidate cannot survive is being
 * un-installable. `Compress-Archive -Path <full file paths>` produced exactly that — every entry
 * at the archive root — and nothing in this script noticed, because the size was non-zero and the
 * manifest was built from the filesystem. So the zip's own entry names are checked here: every
 * shipped file must appear under the single `dsh-computer-use/` folder, and the execution set in
 * particular must be there.
 */
let layoutOk = false;
if (zipOk) {
  const script = [
    `$ErrorActionPreference = 'Stop'`,
    `Add-Type -AssemblyName System.IO.Compression.FileSystem`,
    `$zip = [System.IO.Compression.ZipFile]::OpenRead(${quote(zipPath)})`,
    `try { $zip.Entries | ForEach-Object { $_.FullName } } finally { $zip.Dispose() }`,
  ].join('; ');
  const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8' });
  const entries = (result.stdout ?? '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
  const misplaced = entries.filter((name) => !name.startsWith('dsh-computer-use/'));
  const missing = [...REQUIRED, MANIFEST_NAME].filter((name) => !entries.includes(`dsh-computer-use/${name}`));
  const expected = new Set(files.map((file) => `dsh-computer-use/${file.name}`));
  const unexpected = entries.filter((name) => !expected.has(name));
  layoutOk = entries.length > 0 && misplaced.length === 0 && missing.length === 0 && unexpected.length === 0;
  console.log(`layout   : ${layoutOk ? 'OK' : 'BAD'} (${entries.length} entries, all under dsh-computer-use/)`);
  if (!layoutOk) {
    if (misplaced.length > 0) console.error(`  ${misplaced.length} entr(ies) outside the package folder, e.g. ${misplaced.slice(0, 3).join(', ')}`);
    if (missing.length > 0) console.error(`  missing from the archive: ${missing.join(', ')}`);
    if (unexpected.length > 0) console.error(`  unexpected in the archive: ${unexpected.slice(0, 5).join(', ')}`);
  }
}

console.log('rollback : restore index.js, client.js, backend/, browser/, internal/, cordis.patch.yml and presets/ together — host and worker must be the same build (§13.7); old frames, UIA refs and browser refs are invalidated by the restart that follows (§13.8).');
process.exit(zipOk && layoutOk ? 0 : 1);
