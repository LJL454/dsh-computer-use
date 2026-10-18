/**
 * Live probe: does a continuation actually pick up the previous drag's end point?
 *
 * Two short drags over empty desktop background (harmless — nothing is under them), the second
 * one asking to start from the last one. The proof is in the receipts: the second `from` must
 * equal the first `to`, and the two handles must differ. Prints the numbers rather than
 * asserting, so this stays a probe (the assertions live in drag-continue-test.mjs).
 *
 *   node tools/probe-drag-continue.mjs
 */
import { registerHooks } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-dragprobe-'));
const toolsStub = join(shimDir, 'dsh-tools-stub.mjs');
writeFileSync(toolsStub, 'export const defineTool = (definition) => definition;\n');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: pathToFileURL(toolsStub).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const plugin = await import(pathToFileURL(join(HERE, '..', 'index.js')).href);
const tools = new Map();
const services = { webServer: { register: () => () => {} } };
const ctx = {
  tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
  webServer: services.webServer,
  on: () => {},
  effect: (fn) => { const disposer = fn(); return () => { if (typeof disposer === 'function') disposer(); }; },
  inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx); return () => {}; },
  get: (name) => services[name],
  logger: { info: () => {}, warn: () => {} },
};
plugin.apply(ctx, { defaultEnabled: true });
const exec = { agent: { session: { id: `drag-probe-${Date.now()}` } }, signal: undefined };
const drag = (args) => tools.get('computer_drag').execute(args, exec).then((value) => value, (error) => ({ error: String(error.message) }));

try {
  const first = await drag({ from_x: 200, from_y: 200, to_x: 260, to_y: 230 });
  console.log('first  :', JSON.stringify({ from: first.from, to: first.to, handle: first.handle, error: first.error }));
  const second = await drag({ to_x: 320, to_y: 260, from_last: true });
  console.log('second :', JSON.stringify({ from: second.from, to: second.to, handle: second.handle, error: second.error }));
  const matched = first.to !== undefined && second.from !== undefined
    && Number(second.from.x) === Number(first.to.x) && Number(second.from.y) === Number(first.to.y);
  console.log(matched ? 'CONTINUATION OK: the second stroke started where the first ended' : `MISMATCH: second.from=${JSON.stringify(second.from)} first.to=${JSON.stringify(first.to)}`);
} catch (error) {
  console.error('probe failed:', error?.message ?? error);
  process.exitCode = 1;
} finally {
  try { rmSync(shimDir, { recursive: true, force: true }); } catch { /* best effort */ }
  setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref();
}
