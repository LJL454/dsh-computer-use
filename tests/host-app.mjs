/**
 * Locate the installed DSH application's `node_modules`.
 *
 * Several tests and diagnostics need the *host's* own copy of a package — its `js-yaml` dialect,
 * its `@deepseek-ai/cordis`, its `dsh-tool-workspace-dependencies`. That path is machine-specific,
 * and it must not be written down as a literal: `C:/Users/<name>/...` publishes the author's
 * Windows account name to everyone who reads the file, and it is wrong on every other machine
 * anyway.
 *
 * So it is derived: an explicit override first, then the default install location built from
 * `LOCALAPPDATA`. A failure names the missing package and says how to point the lookup elsewhere,
 * rather than failing later with an unexplained `ERR_MODULE_NOT_FOUND`.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Where a normal Windows install keeps the application payload. */
const INSTALL_SUFFIX = ['Programs', 'DeepSeek Harness', 'resources', 'app', 'dsh', 'node_modules'];

/**
 * @param relativePath - a path inside `node_modules` that has to exist, e.g. `js-yaml/index.js`.
 * @returns the absolute `node_modules` directory that holds it.
 * @throws when neither the override nor the default location has it.
 */
export function resolveAppNodeModules(relativePath) {
  const candidates = [
    process.env.DSH_APP_NODE_MODULES,
    process.env.LOCALAPPDATA === undefined
      ? undefined
      : join(process.env.LOCALAPPDATA, ...INSTALL_SUFFIX),
  ].filter((value) => typeof value === 'string' && value !== '');
  for (const base of candidates) {
    if (existsSync(join(base, ...relativePath.split('/')))) return base;
  }
  throw new Error(
    `could not find ${relativePath} under the installed DSH application; `
    + 'set DSH_APP_NODE_MODULES to <DSH install>/resources/app/dsh/node_modules',
  );
}

/**
 * Import one file from the installed application by absolute path, without going through this
 * plugin's own module resolution (which is a development convenience and absent in a release).
 * @param relativePath - the file's path inside `node_modules`.
 * @returns the imported module namespace.
 */
export async function importFromApp(relativePath) {
  const { pathToFileURL } = await import('node:url');
  const base = resolveAppNodeModules(relativePath);
  return import(pathToFileURL(join(base, ...relativePath.split('/'))).href);
}
