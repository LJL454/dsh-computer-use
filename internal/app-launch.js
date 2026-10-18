/**
 * Launching a GUI application from inside a DSH session.
 *
 * The root cause this module exists for: the agent runtime exports
 * `ELECTRON_RUN_AS_NODE=1` into every command it runs. Electron treats that variable
 * as "act as a plain Node interpreter", so any Electron application started from the
 * session — a chat client, an editor, the DSH desktop app itself — starts, finds no window to
 * show, and exits 0 without ever reaching its GUI. Double-clicking the same icon works
 * because explorer.exe is the parent there and its environment is clean.
 *
 * So the fix is not "run it differently", it is "hand it a clean environment": spawn the
 * target with the Electron/Node-injection variables removed. This module does that and
 * then answers the only question that matters — did a window actually appear, and whose
 * is it (single-instance apps hand off to a sibling process).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join } from 'node:path';

/**
 * Variables the agent runtime (or a Node/Electron parent) may carry that change how an
 * Electron binary behaves. Removing them is what makes the launcher work.
 *
 * `ELECTRON_RUN_AS_NODE`  — the one that causes the reported failure.
 * `ELECTRON_NO_ASAR`      — app launches but its bundled asar entries are unreadable.
 * `ELECTRON_NO_ATTACH_CONSOLE` / `ELECTRON_FORCE_WINDOW_MENU_BAR` — GUI-shape overrides.
 * `NODE_OPTIONS`          — Electron's main process honours a subset of it; a stray
 *                           `--require`/`--inspect` changes startup or breaks it.
 * `NODE_REPL_EXTERNAL_MODULE` — same class: a Node-side injection point.
 */
export const ELECTRON_SENSITIVE_VARS = [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ASAR',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'ELECTRON_FORCE_WINDOW_MENU_BAR',
  'NODE_OPTIONS',
  'NODE_REPL_EXTERNAL_MODULE',
];

/** Suffixes Windows treats as "let the shell decide" rather than "execute this binary". */
const SHELL_KINDS = new Set(['.lnk', '.url', '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.ppt', '.pptx', '.txt', '.md', '.png', '.jpg', '.jpeg', '.mp4', '.mkv']);

/**
 * Copy `source` without the sensitive variables.
 *
 * Windows environment names are case-insensitive, so the match is too — a session that
 * exports `electron_run_as_node` must be cleaned just the same.
 *
 * @param {Record<string, string|undefined>} source environment to copy
 * @param {string[]} extra additional names to remove
 * @returns {{ env: Record<string, string>, stripped: string[] }}
 */
export function sanitizeEnv(source, extra = []) {
  const env = {};
  for (const [key, value] of Object.entries(source ?? {})) {
    if (value === undefined) continue;
    env[key] = String(value);
  }
  const wanted = new Set([...ELECTRON_SENSITIVE_VARS, ...extra].map((name) => name.toUpperCase()));
  const stripped = [];
  for (const key of Object.keys(env)) {
    if (wanted.has(key.toUpperCase())) {
      stripped.push(key);
      delete env[key];
    }
  }
  return { env, stripped };
}

/** Which sensitive variables the *current* process carries — the diagnosis half. */
export function auditEnvironment(source = process.env, extra = []) {
  const present = [];
  const wanted = new Set([...ELECTRON_SENSITIVE_VARS, ...extra].map((name) => name.toUpperCase()));
  for (const [key, value] of Object.entries(source ?? {})) {
    if (wanted.has(key.toUpperCase())) present.push({ name: key, value: String(value) });
  }
  return {
    sessionIsPolluted: present.some((row) => row.name.toUpperCase() === 'ELECTRON_RUN_AS_NODE'),
    present,
    wouldStrip: present.map((row) => row.name),
  };
}

/**
 * Decide how a target gets started.
 *
 * `exe` targets are spawned directly; everything else (documents, URLs, `.lnk`, and
 * anything the caller marks as a packaged/Store app) goes through `explorer.exe`, whose
 * own environment is clean and which is the only thing that can perform shell
 * activation. That mirrors what a double-click does.
 */
export function resolveTarget(target, { kind = '' } = {}) {
  const text = String(target ?? '').trim();
  if (!text) throw new Error('target is required');
  const lower = text.toLowerCase();
  if (kind === 'store' || lower.startsWith('shell:') || /^[a-z]+:\/\//i.test(text)) {
    return { kind: kind || 'shell', file: 'explorer.exe', target: text, viaExplorer: true };
  }
  const extension = extname(text).toLowerCase();
  if (SHELL_KINDS.has(extension)) {
    return { kind: 'shell', file: 'explorer.exe', target: text, viaExplorer: true };
  }
  return { kind: 'exe', file: text, target: text, viaExplorer: false };
}

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Ask Windows what the launched process turned into.
 *
 * A single-instance app (most chat clients, most browsers) exits immediately and focuses the
 * window of the instance that is already running, so the pid we spawned is useless as
 * an identity. This therefore looks up, by pid first and by image name second, the
 * processes that are alive and own a visible window.
 */
export function inspectWindows(pid, imageName, powershell = 'powershell.exe', since = 0) {
  const script = inspectWindowsScript(pid, imageName, since);
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', timeout: 30000, windowsHide: true });
  return parseWindowReport(result);
}

/**
 * The same inspection, without blocking the event loop (§8.2).
 *
 * `inspectWindows` used `spawnSync`, whose wait stops everything else in the host: cancellation,
 * status updates and every other tool response queue behind it for as long as the shell takes
 * (up to the 30 s timeout). The launch path answers with this one; the synchronous export stays
 * for callers that are already synchronous.
 *
 * @returns a promise for the same report `inspectWindows` returns.
 */
export function inspectWindowsAsync(pid, imageName, powershell = 'powershell.exe', since = 0) {
  const script = inspectWindowsScript(pid, imageName, since);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
    } catch (error) {
      resolve({ error: `${error?.message ?? error}` });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (report) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(report);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      finish({ error: `the window inspection did not answer within 30000 ms` });
    }, 30000);
    timer.unref?.();
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish({ error: `${error?.message ?? error}` }));
    child.on('close', () => finish(parseWindowReport({ stdout, stderr })));
  });
}

/** The window-report script, shared by the synchronous and asynchronous inspections. */
function inspectWindowsScript(pid, imageName, since) {
  // A multi-line script, not a `; `-joined one-liner: nested blocks joined by semicolons
  // silently produced an empty report.
  return `
$ErrorActionPreference = 'SilentlyContinue'
$pid0 = ${Number(pid) || 0}
$name = ${quote(imageName ?? '')}
$since = ${Number(since) || 0}
$rows = New-Object System.Collections.ArrayList
function Add-Row($process, $source) {
  if ($null -eq $process) { return }
  [void]$rows.Add([pscustomobject]@{
    pid = $process.Id; name = $process.ProcessName; title = $process.MainWindowTitle
    alive = $true; source = $source
  })
}
if ($pid0 -gt 0) { Add-Row (Get-Process -Id $pid0) 'pid' }
if ($name) { foreach ($p in @(Get-Process | Where-Object { $_.ProcessName -eq $name })) { Add-Row $p 'name' } }
if ($since -gt 0) {
  $cutoff = [datetime]::FromFileTime([int64]$since * 10000 + 116444736000000000)
  foreach ($p in @(Get-Process | Where-Object { $_.MainWindowTitle })) {
    $started = $null
    try { $started = $p.StartTime } catch { $started = $null }
    if ($started -and $started -ge $cutoff) { Add-Row $p 'started' }
  }
}
$unique = @($rows | Sort-Object pid -Unique)
$alive = @($unique | Where-Object { $_.source -eq 'pid' })
$windows = @($unique | Where-Object { $_.title })
[pscustomobject]@{
  launchedAlive = ($alive.Count -gt 0)
  windows = @($windows | ForEach-Object { [pscustomobject]@{ pid = $_.pid; name = $_.name; title = $_.title; source = $_.source } })
  processes = @($unique | ForEach-Object { [pscustomobject]@{ pid = $_.pid; name = $_.name; title = $_.title; source = $_.source } })
} | ConvertTo-Json -Depth 6 -Compress
`;
}

/** Turn one inspection's output into a report, or into a sentence saying why there is none. */
function parseWindowReport(result) {
  if (result?.error) return { error: String(result.error) };
  const text = (result?.stdout || '').trim();
  if (!text) return { error: `empty window report (stderr: ${(result?.stderr || '').slice(0, 200)})` };
  try {
    return JSON.parse(text);
  } catch (error) {
    return { error: `could not parse window report: ${String(error)}`, raw: text.slice(0, 500) };
  }
}

/**
 * Start a target with a clean environment and report what happened.
 *
 * @param {object} options
 * @param {string} options.target exe path, document, URL or `shell:` target
 * @param {string[]} [options.arguments]
 * @param {string} [options.cwd]
 * @param {number} [options.waitMs] how long to watch before answering (default 6000)
 * @param {boolean} [options.detach] leave the child running (default true)
 * @param {boolean} [options.verifyWindow] look for a window before answering (default true)
 * @param {string} [options.kind] `store` for packaged apps
 * @param {string[]} [options.extraStrip] extra variables to remove
 * @param {Record<string,string>} [options.env] environment override (tests use this)
 * @param {boolean} [options.dryRun] resolve and sanitize without starting anything
 */
export async function launchApp(options = {}) {
  const started = Date.now();
  const resolved = resolveTarget(options.target, { kind: options.kind });
  const stripAll = options.stripEnvironment !== false;
  const { env, stripped } = stripAll
    ? sanitizeEnv(options.env ?? process.env, options.extraStrip ?? [])
    : { env: { ...(options.env ?? process.env) }, stripped: [] };

  const waitMs = Math.max(0, Math.min(60000, Number(options.waitMs ?? 6000)));
  const detached = options.detach !== false;
  const shouldVerify = options.verifyWindow !== false;
  const cwd = options.cwd && existsSync(options.cwd) ? options.cwd : undefined;

  if (options.dryRun) {
    return { ok: true, dryRun: true, target: resolved.target, resolved: resolved.kind, viaExplorer: resolved.viaExplorer,
             stripped, command: resolved.file, arguments: options.arguments ?? [] };
  }

  if (!resolved.viaExplorer) {
    if (!isAbsolute(resolved.file)) throw new Error(`target must be an absolute path: ${resolved.file}`);
    if (!existsSync(resolved.file)) throw new Error(`target does not exist: ${resolved.file}`);
    const info = statSync(resolved.file);
    if (info.isDirectory()) throw new Error(`target is a directory, not an application: ${resolved.file}`);
  }

  const args = resolved.viaExplorer
    ? [resolved.target, ...(options.arguments ?? [])]
    : [...(options.arguments ?? [])];

  let child = null;
  let spawnError = null;
  try {
    child = spawn(resolved.file, args, {
      cwd,
      env,
      detached,
      windowsHide: false,
      stdio: 'ignore',
      shell: false,
    });
  } catch (error) {
    // A launch that never started is a *state*, not an exception: the caller asked "start
    // this", and "it could not be started, here is why" is an answer it can act on (§6: 应用
    // 启动错误事件被吞掉). The error event below covers the same ground for failures that
    // arrive asynchronously.
    return launchFailedReport({ error, resolved, stripped, started });
  }
  const pid = child.pid ?? 0;
  const launchedAt = Date.now();
  const imageName = resolved.viaExplorer ? '' : basename(resolved.file, extname(resolved.file));
  // The error event used to be swallowed by an empty handler, so a spawn that failed after
  // `spawn()` returned looked exactly like an application that started and produced no window.
  child.on('error', (error) => { spawnError = error; });
  if (detached) child.unref();

  // Waiting for the window, with a deadline (§8.2): the launch used to sleep the whole
  // `waitMs` and then look once, so an application that was ready in 300 ms still cost the
  // caller six seconds. The wait is still bounded by `waitMs` — that is what the argument
  // means — but a confirmed window ends it early.
  const verify = shouldVerify;
  let windows = [];
  let inspection = null;
  let waited = 0;
  const pollMs = Math.max(150, Math.min(500, waitMs));
  while (true) {
    const slice = Math.min(pollMs, Math.max(0, waitMs - waited));
    if (slice > 0) await new Promise((resolve) => setTimeout(resolve, slice));
    waited += slice;
    if (verify) {
      inspection = await inspectWindowsAsync(pid, imageName, options.powershell, launchedAt);
      windows = windowsFromInspection(inspection);
    }
    if (spawnError !== null) break;
    if (verify && windows.length > 0) break;
    if (waited >= waitMs) break;
    // A launch that has already failed cannot get better by waiting: an exited process with no
    // image name to look for is a failure, not a slow start.
    if (!verify && child.exitCode !== null) break;
  }

  let exited = null;
  let exitCode = null;
  try {
    exited = child.exitCode !== null;
    exitCode = child.exitCode;
  } catch { /* the handle may be gone after unref */ }

  const state = spawnError !== null
    ? 'launch-failed'
    : windows.length > 0
      ? 'window'
      : exited === true
        ? 'exited-without-window'
        : verify ? 'running-no-window' : 'running';
  const ok = state === 'window' || state === 'running';
  const hint = state === 'launch-failed'
    ? `the target could not be started: ${spawnError.message}. Check that it is a runnable program (a document and a URL go through the shell — pass kind: 'store' for a packaged app).`
    : state === 'exited-without-window'
      ? 'the process exited without opening a window — check the target path, or that an instance is not already running with a modal dialog open.'
      : state === 'running-no-window'
        ? `the process is running but no window appeared within ${waited} ms; a slow application can still open one, so check again (computer_windows) before launching it a second time.`
        : undefined;
  return {
    ok,
    state,
    target: resolved.target,
    resolved: resolved.kind,
    viaExplorer: resolved.viaExplorer,
    pid,
    imageName,
    exited,
    exitCode,
    stripped,
    windows,
    // Whether the window(s) below are the launched process itself or only "a window that
    // appeared around the same time" (§6: 应用窗口匹配可能误认无关新窗口).
    windowMatch: windows.length === 0 ? 'none' : windows.some((one) => one.matchedBy !== 'started') ? 'target' : 'started-window',
    fuzzyMatch: windows.length > 0 && windows.every((one) => one.matchedBy === 'started'),
    waitedMs: waited,
    durationMs: Date.now() - started,
    ...(spawnError !== null ? { error: String(spawnError.message ?? spawnError) } : {}),
    ...(inspection?.error !== undefined && windows.length === 0 ? { inspectionError: String(inspection.error) } : {}),
    ...(hint === undefined ? {} : { hint }),
  };
}

/** The report for a launch that never started. */
function launchFailedReport({ error, resolved, stripped, started }) {
  return {
    ok: false,
    state: 'launch-failed',
    target: resolved.target,
    resolved: resolved.kind,
    viaExplorer: resolved.viaExplorer,
    pid: 0,
    imageName: '',
    exited: null,
    exitCode: null,
    stripped,
    windows: [],
    windowMatch: 'none',
    fuzzyMatch: false,
    waitedMs: 0,
    durationMs: Date.now() - started,
    error: String(error?.message ?? error),
    hint: `the target could not be started: ${error?.message ?? error}. Check that it is a runnable program (a document and a URL go through the shell — pass kind: 'store' for a packaged app).`,
  };
}

/**
 * The windows an inspection found, each saying what evidence put it there.
 * @param inspection - the report from `inspectWindowsAsync`.
 * @returns `{ pid, title, matchedBy, fuzzy }[]`.
 */
function windowsFromInspection(inspection) {
  return (inspection?.windows ?? []).map((row) => ({
    pid: row.pid,
    title: row.title,
    matchedBy: String(row.source ?? 'unknown'),
    fuzzy: String(row.source ?? '') === 'started',
  }));
}

/** Convenience for callers that only want to answer *why* it failed before. */
export function envReport(extra = []) {
  const audit = auditEnvironment(process.env, extra);
  return {
    ...audit,
    explanation: audit.sessionIsPolluted
      ? 'This session exports ELECTRON_RUN_AS_NODE=1, so an Electron app started from it runs as Node: no window, silent exit 0. Launch through app_launch (or tools/launch-clean.ps1) to strip it.'
      : 'No Electron/Node-injection variables found in this session; launching an Electron app directly should work.',
  };
}
