/** Same window, three ways to ask for its tree: does `patterns` change the answer? */
import { registerHooks } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { PowerShellBackend } from './backend/bridge.js';

const shimDir = mkdtempSync(join(tmpdir(), 'dsh-cu-diag-'));
const toolsStub = join(shimDir, 'dsh-tools-stub.mjs');
writeFileSync(toolsStub, 'export const defineTool = (definition) => definition;\n');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: pathToFileURL(toolsStub).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const plugin = await import('./index.js');
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

const pick = async () => {
  const listed = await direct.request('windows', {}, { timeoutMs: 30_000 });
  const candidates = (listed.windows ?? []).filter((w) => /notepad/i.test(w.process));
  let best = null;
  for (const candidate of candidates) {
    const tree = await direct.request('uitree', { hwnd: candidate.hwnd, maxDepth: 6, maxNodes: 200 }, { timeoutMs: 60_000 });
    const editor = tree.nodes.find((n) => /ControlType\.(Document|Edit)$/.test(n.controlType));
    if (editor !== undefined && (best === null || tree.nodes.length > best.nodes)) {
      best = { hwnd: candidate.hwnd, title: candidate.title, nodes: tree.nodes.length };
    }
  }
  return best;
};

let target = await pick();
if (target === null) {
  console.log('no Notepad window; launching one and waiting');
  spawn('notepad.exe', [], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 20 && target === null; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    target = await pick();
  }
}
if (target === null) { console.log('still no Notepad window'); process.exit(0); }
console.log(`target hwnd=${target.hwnd} "${target.title}" (bridge read: ${target.nodes} nodes)\n`);

const show = (label, value) => {
  const withPatterns = value.nodes.filter((n) => (n.patterns ?? []).length > 0).length;
  console.log(`${label.padEnd(52)} ${String(value.nodes.length).padStart(3)} nodes  walked=${String(value.walked).padStart(3)} skipped=${String(value.skipped).padStart(3)} withPatterns=${withPatterns}`);
  console.log(`    ${value.nodes.slice(0, 5).map((n) => `${n.controlType.replace('ControlType.', '')}"${n.name}"[${(n.patterns ?? []).join('+')}]`).join(' ')}`);
};

show('bridge uitree (no patterns arg)', await direct.request('uitree', { hwnd: target.hwnd, maxDepth: 6, maxNodes: 200 }, { timeoutMs: 60_000 }));
show('bridge uitree (patterns: true)', await direct.request('uitree', { hwnd: target.hwnd, maxDepth: 6, maxNodes: 200, patterns: true }, { timeoutMs: 60_000 }));
show('bridge uitree (patterns: false)', await direct.request('uitree', { hwnd: target.hwnd, maxDepth: 6, maxNodes: 200, patterns: false }, { timeoutMs: 60_000 }));
show('tool computer_ui (no patterns)', await tools.get('computer_ui').execute({ hwnd: target.hwnd, max_depth: 6, max_nodes: 200 }, exec));
show('tool computer_ui (patterns: true)', await tools.get('computer_ui').execute({ hwnd: target.hwnd, max_depth: 6, max_nodes: 200, patterns: true }, exec));

await direct.request('shutdown', {});
direct.dispose();
setTimeout(() => process.exit(0), 100).unref();
