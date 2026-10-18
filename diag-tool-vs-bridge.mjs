/** Why does the tool path report 7 nodes where the bridge reports 37? */
import { registerHooks } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PowerShellBackend } from './backend/bridge.js';

// Same stub the live test installs: the plugin imports the host's tool factory.
const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-diag-'));
const toolsStub = join(shimDir, 'dsh-tools-stub.mjs');
writeFileSync(toolsStub, 'export const defineTool = (definition) => definition;\n');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: pathToFileURL(toolsStub).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const HOST = new URL('./', import.meta.url).href;

const plugin = await import(`${HOST}index.js`);
const tools = new Map();
const services = { webServer: { register: () => () => {} }, attachments: { saveImages: async () => [] } };
const ctx = {
  tools: { register: (d) => { tools.set(d.name, d); return () => {}; } },
  webServer: services.webServer,
  effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d(); }; },
  inject: (deps, cb) => { if (deps.every((n) => services[n] !== undefined)) cb(ctx); return () => {}; },
  get: (n) => services[n],
  logger: { info: () => {} },
};
plugin.apply(ctx, { defaultEnabled: true });
const exec = { agent: { session: { id: 'diag' } }, signal: undefined };

const direct = new PowerShellBackend({ timeoutMs: 60_000 });
await direct.start();

const listed = await direct.request('windows', {}, { timeoutMs: 30_000 });
console.log('windows returned:', JSON.stringify(listed).slice(0, 300));
const target = (listed.windows ?? []).filter((w) => /notepad/i.test(w.process)).sort((a, b) => b.width * b.height - a.width * a.height)[0];
if (target === undefined) { console.log('no notepad window'); process.exit(0); }
console.log(`target hwnd=${target.hwnd} "${target.title}"`);

const raw = await direct.request('uitree', { hwnd: target.hwnd, maxDepth: 6, maxNodes: 200 }, { timeoutMs: 60_000 });
console.log(`\nbridge  uitree(hwnd, maxDepth=6, maxNodes=200)          -> ${raw.nodes.length} nodes, walked ${raw.walked}, skipped ${raw.skipped}`);
const rawPatterns = raw.nodes.filter((n) => (n.patterns ?? []).length > 0).length;
console.log(`        nodes with patterns: ${rawPatterns}`);
console.log(`        first 6: ${raw.nodes.slice(0, 6).map((n) => `${n.controlType.replace('ControlType.', '')}"${n.name}"[${(n.patterns ?? []).join('+')}]`).join(' ')}`);

const viaTool = await tools.get('computer_ui').execute({ hwnd: target.hwnd, max_depth: 6, max_nodes: 200 }, exec);
console.log(`\ntool    computer_ui({hwnd, max_depth: 6, max_nodes: 200}) -> ${viaTool.nodes.length} nodes, walked ${viaTool.walked}, skipped ${viaTool.skipped}`);
const toolPatterns = viaTool.nodes.filter((n) => (n.patterns ?? []).length > 0).length;
console.log(`        nodes with patterns: ${toolPatterns}`);
console.log(`        first 6: ${viaTool.nodes.slice(0, 6).map((n) => `${n.controlType.replace('ControlType.', '')}"${n.name}"[${(n.patterns ?? []).join('+')}]`).join(' ')}`);

// The tool sends explicit undefined for the optional fields; reproduce that shape.
const shaped = await direct.request('uitree', {
  hwnd: target.hwnd,
  filter: undefined,
  name: undefined,
  controlType: undefined,
  automationId: undefined,
  patterns: undefined,
  skipEmpty: undefined,
  settleMs: undefined,
  maxDepth: 6,
  maxNodes: 200,
}, { timeoutMs: 60_000 });
console.log(`\nbridge  uitree with the tool's exact argument shape       -> ${shaped.nodes.length} nodes`);

await direct.request('shutdown', {});
direct.dispose();
setTimeout(() => process.exit(0), 100).unref();
