/**
 * Load a package the host owns (`@deepseek-ai/dsh-tools`, …) without assuming this plugin
 * sits inside a profile.
 *
 * Why this file exists
 * --------------------
 * `dsh plugin add` installs the plugin as a `link:`, so the module lives wherever the
 * folder was unzipped — `D:\DSH-Plugins\dsh-computer-use\index.js`, not
 * `<profile>\node_modules\...`. Node resolves a bare `import '@deepseek-ai/dsh-tools'` by
 * walking **up from that folder**: `D:\DSH-Plugins\node_modules`, `D:\node_modules`, …
 * The host's own packages live in `<app>\resources\app\dsh\node_modules`, which is not on
 * that path, so the import throws, the whole row fails to load, and the capability
 * disappears silently: no tools, no chip, no routes. The host itself keeps working (its
 * `tools` row is its own), so all the user sees is "装好了，但没有「电脑操作」按钮".
 *
 * The host's packages are addressed by absolute path instead. Importing the entry by file
 * URL also fixes its own dependency graph: `dsh-tools` imports `dsh-llm`, `cordis`,
 * `dsh-sandbox`, … and Node resolves *those* from the app directory, so no copies are
 * needed next to this plugin.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** entry file of each host package we may need, relative to its node_modules root. */
const ENTRIES = {
  '@deepseek-ai/dsh-tools': ['@deepseek-ai', 'dsh-tools', 'lib', 'index.js'],
  '@deepseek-ai/dsh-scope': ['@deepseek-ai', 'dsh-scope', 'lib', 'index.js'],
};

/**
 * Where the running application keeps its own node_modules, most specific first.
 *
 * `process.execPath` is the Electron binary for both the desktop shell and `dsh <profile>`
 * (the CLI is the same executable in Node mode), so its directory is the reliable anchor.
 * The two environment paths cover a host started by something else, and
 * `DSH_APP_MODULES` lets tests and unusual installs point at it directly.
 */
export function candidateHostRoots() {
  const roots = [];
  const add = (path) => { if (path && !roots.includes(path)) roots.push(path); };
  const exeDir = dirname(process.execPath || '');
  add(join(exeDir, 'resources', 'app', 'dsh', 'node_modules'));
  add(join(exeDir, '..', 'resources', 'app', 'dsh', 'node_modules'));
  if (process.env.LOCALAPPDATA) {
    add(join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'app', 'dsh', 'node_modules'));
  }
  if (process.env.ProgramFiles) {
    add(join(process.env.ProgramFiles, 'DeepSeek Harness', 'resources', 'app', 'dsh', 'node_modules'));
  }
  if (process.env.DSH_APP_MODULES) add(process.env.DSH_APP_MODULES);
  return roots;
}

/** The first existing entry for `specifier`, or undefined. Exported for diagnostics. */
export function resolveHostEntry(specifier) {
  const parts = ENTRIES[specifier];
  if (parts === undefined) return undefined;
  for (const root of candidateHostRoots()) {
    const entry = join(root, ...parts);
    if (existsSync(entry)) return entry;
  }
  return undefined;
}

/**
 * Import a host package.
 *
 * Resolution order:
 *   1. the ordinary specifier — correct when this plugin was installed *inside* a profile,
 *      where the profile's own node_modules (or its junction into the app) is the answer;
 *   2. the running application's copy, addressed by absolute path — the `link:` case.
 *
 * @param specifier - bare package name, e.g. `@deepseek-ai/dsh-tools`.
 * @returns the imported module namespace.
 * @throws when neither path can load it, with both failures in the message.
 */
export async function importHostModule(specifier) {
  let viaSpecifier;
  try {
    return await import(specifier);
  } catch (error) {
    viaSpecifier = error;
  }

  const entry = resolveHostEntry(specifier);
  if (entry === undefined) {
    throw new Error(
      `${specifier} is not reachable: the bare specifier failed (${viaSpecifier?.message ?? viaSpecifier}) `
      + `and no installed application was found near ${process.execPath || '(unknown executable)'}. `
      + 'Install the plugin with `node setup.mjs`, or set DSH_APP_MODULES to the application\'s '
      + '<...>\\resources\\app\\dsh\\node_modules.',
    );
  }

  try {
    return await import(pathToFileURL(entry).href);
  } catch (error) {
    throw new Error(
      `${specifier} could not be loaded from ${entry}: ${error?.message ?? error} `
      + `(the bare specifier had failed with: ${viaSpecifier?.message ?? viaSpecifier})`,
    );
  }
}

/** Human-readable description of where a host package came from; used in logs. */
export function describeHostEntry(specifier) {
  return resolveHostEntry(specifier) ?? '(resolved by the ordinary specifier)';
}
