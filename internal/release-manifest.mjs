/**
 * 发行身份：整份插件（不只是 worker.ps1）的路径 + SHA256 清单。
 *
 * 1.39.5 的 buildId 只由 `backend/worker.ps1` 推导，所以改了 `client.js`、
 * `internal/schema-visibility.mjs` 或 `cordis.patch.yml` 仍可能得到同一个 id；`assertWorkerContract()`
 * 又能发现"运行中的 worker 与磁盘上的 worker 不一致"，却证明不了 host / client / internal /
 * patch 来自同一个发行包。1.40.0 把这两件事分开：
 *
 *   * `workerBuildId` —— 当前 dsh-worker.exe 的局部协议身份，用于运行中进程的比对；
 *   * `releaseBuildId` —— 所有生产文件按路径排序后的有序哈希，任何一个文件不同都会变。
 *
 * 发行包在打包时写一份 `release-manifest.json`；宿主启动时重新计算并比对。源码安装没有这份
 * manifest 时只报 `RELEASE_MANIFEST_MISSING`（info），不会把开发副本误判成坏包；`doctor
 * --release` 则把它当阻断项，因为正式发行包必须带清单。
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 插件根目录（`internal/` 的上一层）。 */
export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 清单文件名；它自己不进哈希集合，否则会形成自引用。 */
export const MANIFEST_NAME = 'release-manifest.json';

/** Root-level files that are part of the installed package. */
const ROOT_FILES = [
  'index.js',
  'client.js',
  'doctor.mjs',
  'setup.mjs',
  'package.json',
  'cordis.patch.yml',
  'INSTALL.md',
  'README.md',
  'VERIFICATION.md',
  'LICENSE',
  // 安装入口也是用户会执行的生产文件：1.40.2 里它们变了却不影响 releaseBuildId，
  // 于是“同一个 1.40.2”可以有两种安装行为（研究报告 P1-C）。
  'install-and-repair.cmd',
  'fix-profile-links.cmd',
];

/** Installer helpers that live under tools/ but are executed by users. */
const INSTALLER_FILES = ['tools/fix-profile-links.ps1'];

/** Directories whose every file is executed or read at runtime. */
const RUNTIME_DIRS = ['backend', 'browser', 'internal', 'interaction', 'assets/character'];

/**
 * 原生 helper 的**运行产物**（复核结论第 4 条：发行身份必须覆盖实际运行的 native helper）。
 *
 * 只收 `build/` 下的 exe：源码、构建脚本、中间对象不是运行时要加载的东西，把它们算进身份
 * 会让"只改一句注释"也改变版本号。exe 不存在时由 `buildReleaseIdentity` 的 `missing` 记一笔，
 * 不会静默漏掉。
 */
const NATIVE_RUNTIME_FILES = [
  'native/indicator-helper/build/dsh-interaction-indicator.exe',
];

/** The optional preset bundle is shipped in the same zip but installed separately. */
const PRESET_FILES = [
  'presets/package.json',
  'presets/cordis.patch.yml',
  'presets/README.md',
];

/** Files that are build output or OS noise, never part of the release identity. */
const SKIP_NAMES = new Set(['.DS_Store', 'Thumbs.db']);
const SKIP_SUFFIXES = ['.log', '.tmp', '.bak', '.zip', '.tgz', '.tar', '.gz', '.7z'];

/**
 * Whether a path belongs to the production set.
 * @param name - package-relative path with forward slashes.
 * @returns whether it should be hashed.
 */
function isProductionName(name) {
  if (name === MANIFEST_NAME) return false;
  const base = name.split('/').at(-1) ?? name;
  if (SKIP_NAMES.has(base)) return false;
  return !SKIP_SUFFIXES.some((suffix) => base.toLowerCase().endsWith(suffix));
}

/**
 * Every regular file below a directory, as package-relative forward-slash paths.
 * @param root - package root.
 * @param directory - package-relative directory name.
 * @param list - accumulator.
 * @returns the accumulator.
 */
function walk(root, directory, list = []) {
  const absolute = join(root, directory);
  let entries;
  try {
    entries = readdirSync(absolute, { withFileTypes: true });
  } catch {
    return list;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      walk(root, name, list);
      continue;
    }
    if (entry.isFile() && isProductionName(name)) list.push(name);
  }
  return list;
}

/**
 * The deterministic production file list for a package root.
 * @param root - package root.
 * @returns sorted package-relative paths with forward slashes.
 */
export function productionFiles(root = PACKAGE_ROOT) {
  const names = [];
  for (const name of ROOT_FILES) {
    try {
      if (statSync(join(root, name)).isFile() && isProductionName(name)) names.push(name);
    } catch {
      // Missing files are reported by buildReleaseIdentity, not hidden here.
    }
  }
  for (const directory of RUNTIME_DIRS) walk(root, directory, names);
  for (const name of NATIVE_RUNTIME_FILES) {
    try {
      if (statSync(join(root, name)).isFile() && isProductionName(name)) names.push(name);
    } catch {
      // 缺失由 buildReleaseIdentity 的 missing 报告，这里不吞掉。
      names.push(name);
    }
  }
  for (const name of INSTALLER_FILES) {
    try {
      if (statSync(join(root, name)).isFile() && isProductionName(name)) names.push(name);
    } catch {
      // Missing installer helpers are reported by buildReleaseIdentity, not hidden here.
    }
  }
  for (const name of PRESET_FILES) {
    try {
      if (statSync(join(root, name)).isFile() && isProductionName(name)) names.push(name);
    } catch {
      // Optional before the preset split lands; the identity simply omits it.
    }
  }
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/** Same production set as productionFiles(), without blocking the host on disk I/O. */
export async function productionFilesAsync(root = PACKAGE_ROOT) {
  const names = [];
  const optional = [...ROOT_FILES, ...INSTALLER_FILES, ...PRESET_FILES];
  await Promise.all(optional.map(async (name) => {
    try { if ((await stat(join(root, name))).isFile() && isProductionName(name)) names.push(name); }
    catch { /* Same optional-file semantics as the synchronous verifier. */ }
  }));
  async function visit(directory) {
    let entries;
    try { entries = await readdir(join(root, directory), { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const name = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile() && isProductionName(name)) names.push(name);
    }
  }
  for (const directory of RUNTIME_DIRS) await visit(directory);
  for (const name of NATIVE_RUNTIME_FILES) {
    try { if ((await stat(join(root, name))).isFile() && isProductionName(name)) names.push(name); }
    catch { names.push(name); }
  }
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/** Full hashes, with at most two files in flight; no persistent trust/hash cache. */
export async function buildReleaseIdentityAsync(root = PACKAGE_ROOT, { files } = {}) {
  const names = files ?? await productionFilesAsync(root);
  const entries = new Array(names.length);
  let next = 0;
  async function reader() {
    while (next < names.length) {
      const index = next++;
      const name = names[index];
      try {
        const bytes = await readFile(join(root, name.split('/').join(sep)));
        entries[index] = { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
      } catch { entries[index] = { name, bytes: null, sha256: null }; }
    }
  }
  await Promise.all([reader(), reader()]);
  const digest = createHash('sha256');
  for (const entry of entries) digest.update(`${entry.name}\0${entry.sha256 ?? 'MISSING'}\n`);
  return { root, buildId: digest.digest('hex').slice(0, 16), files: entries, missing: entries.filter(e => e.sha256 === null).map(e => e.name) };
}

/**
 * Read and parse the package manifest.
 * @param root - package root.
 * @returns `{ path, manifest, error }`; `manifest` is null when unreadable.
 */
export function readPackageManifest(root = PACKAGE_ROOT) {
  const path = join(root, 'package.json');
  try {
    return { path, manifest: JSON.parse(readFileSync(path, 'utf8')), error: '' };
  } catch (error) {
    return { path, manifest: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Hash every production file and derive the release identity.
 *
 * Missing files are kept in the list with `sha256: null` and named in `missing`, so a package
 * with a hole cannot accidentally hash to the same id as a complete one.
 * @param root - package root.
 * @param options.files - override the production file list (tests).
 * @returns `{ root, buildId, files, missing }`.
 */
export function buildReleaseIdentity(root = PACKAGE_ROOT, { files } = {}) {
  const names = files ?? productionFiles(root);
  const entries = [];
  const missing = [];
  for (const name of names) {
    const path = join(root, name.split('/').join(sep));
    try {
      const bytes = readFileSync(path);
      entries.push({
        name,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    } catch {
      entries.push({ name, bytes: null, sha256: null });
      missing.push(name);
    }
  }
  const digest = createHash('sha256');
  for (const entry of entries) digest.update(`${entry.name}\0${entry.sha256 ?? 'MISSING'}\n`);
  return {
    root,
    buildId: digest.digest('hex').slice(0, 16),
    files: entries,
    missing,
  };
}

/**
 * Read the shipped release manifest, if any.
 * @param root - package root.
 * @returns `{ path, present, manifest, error }`.
 */
export function readReleaseManifest(root = PACKAGE_ROOT) {
  const path = join(root, MANIFEST_NAME);
  try {
    return { path, present: true, manifest: JSON.parse(readFileSync(path, 'utf8')), error: '' };
  } catch (error) {
    const code = error?.code;
    return {
      path,
      present: code !== 'ENOENT',
      manifest: null,
      error: code === 'ENOENT' ? '' : error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Compare the installed tree with its release manifest.
 *
 * `matches` is true only when name, version, file list, every hash, and the aggregate id agree.
 * The per-file lists are capped by the caller when rendering; this function returns them whole
 * because a doctor report should be able to name the actual offending file.
 * @param root - package root.
 * @param options.version - expected package version (defaults to package.json).
 * @returns the comparison, including `buildId` for status reports even when no manifest exists.
 */
export function verifyRelease(root = PACKAGE_ROOT, { version } = {}) {
  const identity = buildReleaseIdentity(root);
  const shipped = readReleaseManifest(root);
  return compareRelease(root, identity, shipped, readPackageManifest(root).manifest, version);
}

/** Startup/HTTP variant: same comparison, including added/missing/changed files. */
export async function verifyReleaseAsync(root = PACKAGE_ROOT, { version } = {}) {
  const identity = await buildReleaseIdentityAsync(root);
  const manifestPath = join(root, MANIFEST_NAME);
  let shipped;
  try { shipped = { path: manifestPath, present: true, manifest: JSON.parse(await readFile(manifestPath, 'utf8')), error: '' }; }
  catch (error) { shipped = { path: manifestPath, present: error?.code !== 'ENOENT', manifest: null, error: error?.code === 'ENOENT' ? '' : String(error?.message ?? error) }; }
  let packageManifest = null;
  try { packageManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')); } catch { /* comparison fails honestly */ }
  return compareRelease(root, identity, shipped, packageManifest, version);
}

function compareRelease(root, identity, shipped, packageManifest, version) {
  const expected = version ?? packageManifest?.version ?? '';
  const result = {
    root: relative(process.cwd(), root) || '.',
    buildId: identity.buildId,
    files: identity.files.length,
    missing: [...identity.missing],
    extra: [],
    mismatched: [],
    present: shipped.present,
    manifestPath: shipped.path,
    manifest: shipped.manifest === null ? null : {
      name: shipped.manifest.name ?? null,
      version: shipped.manifest.version ?? null,
      releaseBuildId: shipped.manifest.releaseBuildId ?? null,
      builtAt: shipped.manifest.builtAt ?? null,
      files: Array.isArray(shipped.manifest.files) ? shipped.manifest.files.length : 0,
    },
    error: shipped.error,
    matches: false,
  };
  if (!shipped.present || shipped.manifest === null) return result;

  const manifest = shipped.manifest;
  const listed = new Map((Array.isArray(manifest.files) ? manifest.files : [])
    .filter((entry) => typeof entry?.name === 'string')
    .map((entry) => [entry.name, entry.sha256]));
  const actual = new Map(identity.files.map((entry) => [entry.name, entry.sha256]));
  for (const name of listed.keys()) {
    if (!actual.has(name)) result.missing.push(name);
  }
  for (const name of actual.keys()) {
    if (!listed.has(name)) result.extra.push(name);
  }
  for (const [name, sha] of listed) {
    if (actual.has(name) && actual.get(name) !== sha) result.mismatched.push(name);
  }
  const nameMatches = manifest.name === packageManifest?.name;
  const versionMatches = manifest.version === expected;
  const buildIdMatches = manifest.releaseBuildId === identity.buildId;
  result.checks = {
    name: nameMatches,
    version: versionMatches,
    releaseBuildId: buildIdMatches,
    fileSet: result.missing.length === 0 && result.extra.length === 0,
    hashes: result.mismatched.length === 0,
  };
  result.matches = Object.values(result.checks).every(Boolean);
  return result;
}

/**
 * Write a release manifest for the current tree, then verify it by reading it back.
 *
 * Used by `tools/pack-candidate.mjs`; keeping the writer and the verifier in one module is what
 * makes the two agree by construction.
 * @param root - package root.
 * @param options.builtAt - ISO timestamp (defaults to now).
 * @returns `{ path, manifest, verification }`.
 */
export function writeReleaseManifest(root = PACKAGE_ROOT, { builtAt = new Date().toISOString() } = {}) {
  const packageManifest = readPackageManifest(root).manifest;
  if (packageManifest === null) throw new Error(`cannot write ${MANIFEST_NAME}: package.json is unreadable in ${root}`);
  const identity = buildReleaseIdentity(root);
  if (identity.missing.length > 0) {
    throw new Error(`cannot write ${MANIFEST_NAME}: missing ${identity.missing.join(', ')}`);
  }
  const manifest = {
    schema: 1,
    name: packageManifest.name,
    version: packageManifest.version,
    builtAt,
    releaseBuildId: identity.buildId,
    // `sourceSha256` 是**签名前**的构建产物哈希（方案 4.19.5 的"源正文对应关系"）。签名会改字节，
    // 所以最终的 `sha256` 与它不同是正常的；两者都记下来，才能在签名之后回答"这份发布物来自哪次构建"。
    files: identity.files.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256, sourceSha256: sha256 })),
  };
  const path = join(root, MANIFEST_NAME);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const verification = verifyRelease(root, { version: packageManifest.version });
  if (!verification.matches) {
    throw new Error(`release manifest verification failed after writing: ${JSON.stringify(verification.checks)}`);
  }
  return { path, manifest, verification };
}

/* -------------------------------------------------------------------------- */
/* 签名（方案 4.19.5）：哈希证明"没被改过"，签名才证明"是谁发的"                  */
/* -------------------------------------------------------------------------- */

/** 需要 Authenticode 的文件类型：脚本与可执行体。 */
const SIGNED_SUFFIXES = ['.ps1', '.exe', '.dll', '.psm1', '.cmd', '.bat'];

/**
 * 这些后缀的文件是否需要签名。JS/MJS 不在此列：它们靠受信任安装载体或独立签名的发行元数据建立
 * 来源链（方案 4.19.5 最后一段），签名一份 JS 并不构成 Authenticode 信任。
 * @param name - package-relative path.
 * @returns 是否需要 Authenticode 签名。
 */
export function needsSignature(name) {
  const lower = String(name).toLowerCase();
  return SIGNED_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/**
 * 取一组文件的 Authenticode 状态。
 *
 * 判定交给系统（`Get-AuthenticodeSignature`），插件不自己解析 PE 或签名结构。一次 PowerShell
 * 调用查完所有文件，避免每个文件起一个进程。
 *
 * @param root - package root.
 * @param files - package-relative paths; 只查需要签名的那些。
 * @param options.runner - 注入用：`(script) => Promise<string>`，测试里替换成假实现。
 * @returns `{ checked, valid, findings }`。
 */
export async function signatureReport(root = PACKAGE_ROOT, files = productionFiles(root), options = {}) {
  const targets = files.filter((name) => needsSignature(name));
  const findings = [];
  if (targets.length === 0) return { checked: [], valid: [], findings };
  const runner = typeof options.runner === 'function'
    ? options.runner
    : async (script) => {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const run = promisify(execFile);
      const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 60_000 });
      return stdout;
    };
  const quoted = targets.map((name) => `'${join(root, ...name.split('/')).replace(/'/g, "''")}'`).join(',');
  const script = [
    '$ErrorActionPreference = "Stop";',
    `$rows = @(Get-AuthenticodeSignature -LiteralPath @(${quoted}) |`,
    '  ForEach-Object { [pscustomobject]@{ file = $_.Path; status = [string]$_.Status;',
    '    signer = if ($_.SignerCertificate) { [string]$_.SignerCertificate.Subject } else { "" };',
    '    timestamped = [bool]($_.TimeStamperCertificate) } });',
    'ConvertTo-Json -Compress -Depth 4 -InputObject $rows',
  ].join(' ');
  let rows = [];
  try {
    const text = await runner(script);
    const parsed = JSON.parse(String(text).trim() === '' ? '[]' : String(text).trim());
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    // 查不到签名状态本身就是一条发现：发布验收不能因为"查询失败"而默认通过。
    return { checked: targets, valid: [], findings: [{ code: 'SIGNATURE_QUERY_FAILED', detail: String(error?.message ?? error) }] };
  }
  const normalized = rows.map((row) => {
    const absolute = String(row?.file ?? '');
    const name = targets.find((candidate) => absolute.toLowerCase().endsWith(candidate.toLowerCase().replace(/\//g, '\\'))) ?? absolute;
    return { name, status: String(row?.status ?? ''), signer: String(row?.signer ?? ''), timestamped: row?.timestamped === true };
  });
  for (const row of normalized) {
    if (row.status !== 'Valid') findings.push({ code: 'SIGNATURE', file: row.name, detail: `Authenticode status is ${row.status || 'unknown'}` });
    else if (row.signer === '') findings.push({ code: 'SIGNER_MISSING', file: row.name, detail: 'the signature is valid but names no signer' });
    else if (!row.timestamped) findings.push({ code: 'TIMESTAMP_MISSING', file: row.name, detail: 'the signature carries no timestamp' });
  }
  const missing = targets.filter((name) => !normalized.some((row) => row.name.toLowerCase() === name.toLowerCase()));
  for (const name of missing) findings.push({ code: 'SIGNATURE_NOT_REPORTED', file: name, detail: 'the status query did not report this file' });
  return {
    checked: targets,
    valid: normalized.filter((row) => row.status === 'Valid' && row.signer !== '' && row.timestamped).map((row) => row.name),
    findings,
  };
}

/**
 * 正式发布验收：清单自洽 **且** 需要签名的文件都有有效签名。
 * @param root - package root.
 * @param options.version - expected version.
 * @param options.runner - injected Authenticode runner（tests）.
 * @returns `{ matches, findings, signatures, release }`.
 */
export async function verifySignedRelease(root = PACKAGE_ROOT, options = {}) {
  const release = verifyRelease(root, { version: options.version });
  // `release.manifest.files` 是**数量**（给 doctor 的摘要用）；要签名的是清单里那份数组。
  const listed = readReleaseManifest(root).manifest?.files;
  const names = Array.isArray(listed) ? listed.map((one) => one.name).filter((name) => typeof name === 'string') : productionFiles(root);
  const signatures = await signatureReport(root, names, options);
  const findings = [...signatures.findings];
  if (!release.matches) findings.push({ code: 'RELEASE_MISMATCH', detail: JSON.stringify(release.checks) });
  return { matches: release.matches && findings.length === 0, findings, signatures, release };
}

/**
 * A compact form for status/doctor payloads: no per-file hashes.
 * @param report - a {@link verifyRelease} result.
 * @returns the summary fields.
 */
export function summarizeRelease(report) {
  return {
    verification: report.verification ?? 'complete',
    buildId: report.buildId,
    files: report.files,
    missing: report.missing.slice(0, 20),
    extra: report.extra.slice(0, 20),
    mismatched: report.mismatched.slice(0, 20),
    manifest: report.present ? {
      present: true,
      version: report.manifest?.version ?? null,
      releaseBuildId: report.manifest?.releaseBuildId ?? null,
      builtAt: report.manifest?.builtAt ?? null,
      fileCount: report.manifest?.files ?? 0,
    } : { present: false },
    matches: report.matches === true,
    error: report.error,
  };
}
