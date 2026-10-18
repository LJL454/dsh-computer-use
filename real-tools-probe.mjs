/**
 * Activate the plugin against the REAL @deepseek-ai/dsh-tools, not a stub.
 *
 * Why this file exists: every other suite replaces `defineTool` with an identity
 * function, so a descriptor the host would reject passes all of them and then fails
 * at activation. That is not a theoretical risk — it happened. `defineTool` threw
 * `unsupported JSON schema: parameters.region.additionalProperties must be explicitly
 * true or false`, the whole `apply()` aborted, and the visible symptom was a
 * 「电脑操作」 chip that rendered fine (its client half loads by a different path) and
 * did nothing when clicked, because neither the tools nor the routes had registered.
 *
 * It reaches into the installed application for the real package. The app ships it
 * inside app.asar, which Node cannot import from, so the needed subtree is extracted
 * to a temp directory first — walking the dependency closure until the import
 * succeeds.
 *
 *   node real-tools-probe.mjs
 *   DSH_ASAR="D:\path\app.asar" node real-tools-probe.mjs
 *
 * Skips (exit 0) when the application is not installed, so the rest of the suite
 * stays runnable on a machine that only has the source.
 */
import { registerHooks } from 'node:module';
import { mkdirSync, mkdtempSync, openSync, readFileSync, readSync, closeSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ASAR_CANDIDATES = [
  process.env.DSH_ASAR,
  join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DeepSeek Harness', 'resources', 'app.asar'),
  join(process.env.PROGRAMFILES ?? '', 'DeepSeek Harness', 'resources', 'app.asar'),
].filter((value) => typeof value === 'string' && value !== '');

const asarPath = ASAR_CANDIDATES.find((candidate) => existsSync(candidate));
if (asarPath === undefined) {
  console.log('SKIP: the DeepSeek Harness app.asar was not found; set DSH_ASAR to point at one.');
  process.exit(0);
}

/* ------------------------------------------------------------------ asar -- */

/** Read the entry table out of an asar archive (u32 sizes, JSON header at 16). */
function readAsar(path) {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(16);
    readSync(fd, head, 0, 16, 0);
    const headerSize = head.readUInt32LE(12);
    const headerBuf = Buffer.alloc(headerSize);
    readSync(fd, headerBuf, 0, headerSize, 16);
    const header = JSON.parse(headerBuf.toString('utf8'));
    const base = 16 + headerSize;
    const entries = [];
    const walk = (node, prefix) => {
      if (node.files !== undefined) {
        for (const [name, child] of Object.entries(node.files)) {
          walk(child, prefix === '' ? name : `${prefix}/${name}`);
        }
        return;
      }
      if (typeof node.offset !== 'string') return;
      entries.push({ path: prefix, offset: Number(node.offset), size: Number(node.size) });
    };
    walk(header, '');
    return { fd, base, entries };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

/** Extract every entry under `prefix` into `outDir`, keeping the full archive path. */
function extractPrefix(archive, prefix, outDir) {
  let count = 0;
  for (const entry of archive.entries) {
    if (!entry.path.startsWith(prefix) || entry.size === 0) continue;
    // The full archive path is kept, not the prefix-stripped one: the import that
    // follows resolves `outDir/dsh/node_modules/...`, so stripping here would write
    // the file somewhere nobody looks.
    const target = join(outDir, ...entry.path.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    const buf = Buffer.alloc(entry.size);
    readSync(archive.fd, buf, 0, entry.size, archive.base + Number(entry.offset));
    writeFileSync(target, buf);
    count += 1;
  }
  return count;
}

/* ------------------------------------------------------ extract the tools -- */

const work = mkdtempSync(join(tmpdir(), 'dsh-real-tools-'));
const archive = readAsar(asarPath);

/** Extract `name` and report whether it contributed anything. */
function ensurePackage(name) {
  const count = extractPrefix(archive, `dsh/node_modules/${name}/`, work);
  return count > 0;
}

const entryPath = join(work, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js');
const entryUrl = pathToFileURL(entryPath).href;

/**
 * Extract the dependency closure first, then import once.
 *
 * Import-retry does not work here: Node caches a package.json miss for the life of
 * the process, so a package extracted *after* the first failed resolution stays
 * invisible to it and the probe loops on the same error forever. Reading the closure
 * out of the archive's own manifests avoids that entirely.
 *
 * @returns the number of packages extracted.
 */
function extractClosure() {
  const queue = ['@deepseek-ai/dsh-tools'];
  const seen = new Set();
  let count = 0;
  while (queue.length > 0 && seen.size < 120) {
    const name = queue.shift();
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    if (!ensurePackage(name)) continue;
    count += 1;
    const manifestPath = join(work, ...`dsh/node_modules/${name}/package.json`.split('/'));
    let manifest = {};
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      // A missing manifest is fine (the package may be a leaf the loader never
      // reads one for); anything else is a bug in this probe and must not hide.
      if (!(error instanceof SyntaxError) && error?.code !== 'ENOENT') throw error;
      manifest = {};
    }
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const dep of Object.keys(manifest[field] ?? {})) queue.push(dep);
    }
  }
  return count;
}

const extractedCount = extractClosure();
if (extractedCount === 0) {
  console.log('SKIP: this app.asar does not contain a usable @deepseek-ai/dsh-tools.');
  process.exit(0);
}

const ok = true;

/* ---------------------------------------------------------------- activate -- */

if (ok) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '@deepseek-ai/dsh-tools') return { url: entryUrl, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });

  const { assertSupportedJsonSchema } = await import(entryUrl);
  const tools = new Map();
  const routes = new Map();
  const services = {
    webServer: { register: (route) => { routes.set(route.path, route); return () => {}; } },
  };
  const ctx = {
    tools: {
      register(definition) {
        // The same guard, in the same order, as ToolRuntime.register.
        if (definition.output === undefined || typeof definition.output !== 'object' || typeof definition.output.render !== 'function') {
          throw new TypeError(`tool "${definition.name}" must declare output { schema, render, presentationMeta? }`);
        }
        assertSupportedJsonSchema(definition.output.schema);
        tools.set(definition.name, definition);
        return () => tools.delete(definition.name);
      },
    },
    webServer: services.webServer,
    effect(fn) { fn(); return () => {}; },
    inject(deps, callback) { if (deps.every((name) => services[name] !== undefined)) callback(ctx); return () => {}; },
    get: (name) => services[name],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };

  try {
    const plugin = await import('./index.js');
    if (typeof plugin.apply !== 'function') throw new Error('the plugin does not export apply()');
    plugin.apply(ctx, { defaultEnabled: false });
    console.log(`ACTIVATION OK: ${tools.size} tools, ${routes.size} routes`);
    for (const name of tools.keys()) console.log(`  ${name}`);
    if (tools.size === 0) {
      console.error('FAIL: the plugin activated but registered no tools');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('ACTIVATION FAILED — this is what a chip that renders but does nothing looks like:');
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    if (error instanceof Error && typeof error.stack === 'string') {
      console.error(error.stack.split('\n').slice(0, 5).join('\n'));
    }
    process.exitCode = 1;
  }
}

closeSync(archive.fd);
rmSync(work, { recursive: true, force: true });
