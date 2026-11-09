import { readReleaseManifest, verifyReleaseAsync } from './release-manifest.mjs';

/** Defer optional startup work; settings/tools can still take their immediate path. */
export function deferStartupWork(work, delayMs = 2000) {
  let timer = setTimeout(() => { timer = null; void work(); }, delayMs);
  timer.unref?.();
  return () => { if (timer !== null) clearTimeout(timer); timer = null; };
}

/**
 * Keep synchronous plugin mounting small. A declared build id is never reported as
 * verified: status says pending until the full, uncached file/hash comparison ends.
 * Doctor can start/await the same check immediately, without creating a second scan.
 */
export function createBackgroundReleaseCheck({ root, version, delayMs = 2000, verify = verifyReleaseAsync, onComplete = () => {} }) {
  const shipped = readReleaseManifest(root);
  let report = {
    root, buildId: null, files: 0, missing: [], extra: [], mismatched: [],
    present: shipped.present, manifestPath: shipped.path,
    manifest: shipped.manifest === null ? null : {
      name: shipped.manifest.name ?? null, version: shipped.manifest.version ?? null,
      releaseBuildId: shipped.manifest.releaseBuildId ?? null, builtAt: shipped.manifest.builtAt ?? null,
      files: Array.isArray(shipped.manifest.files) ? shipped.manifest.files.length : 0,
    },
    matches: false, error: shipped.error, verification: 'pending',
  };
  let pending = null;
  let disposed = false;
  let cancel = () => {};
  function ensure() {
    cancel();
    if (pending !== null) return pending;
    if (disposed) return Promise.resolve(report);
    report = { ...report, verification: 'running' };
    pending = Promise.resolve().then(() => verify(root, { version })).then(
      value => ({ ...value, verification: 'complete' }),
      error => ({ ...report, matches: false, error: String(error?.message ?? error), verification: 'error' }),
    ).then(value => {
      if (!disposed) {
        report = value;
        // A diagnostic/logger failure must not turn a finished background check
        // into an unhandled rejection in the host process.
        try { onComplete(value); } catch { /* report remains available to doctor/status */ }
      }
      return value;
    });
    return pending;
  }
  cancel = deferStartupWork(ensure, delayMs);
  return { get current() { return report; }, ensure, dispose() { disposed = true; cancel(); } };
}
