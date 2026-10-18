// Three capture paths on the same windows: where does each one actually fail?
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { PowerShellBackend } from './backend/bridge.js';

// This one needs a native addon that exposes a Windows.Graphics.Capture path. Point ADDON at
// that .node file, or set DSH_CAPTURE_ADDON. Without it the third capture path is skipped and
// the other two still run.
const ADDON = process.env.DSH_CAPTURE_ADDON ?? 'capture-addon.node';
const require = createRequire(import.meta.url);
let native = null;
try {
  native = require(ADDON);
} catch (error) {
  console.log(`(the reference addon was not loadable from ${ADDON}: ${error.message.slice(0, 80)})`);
  console.log('(set DSH_CAPTURE_ADDON to that addon file to include the third capture path)');
}

const b = new PowerShellBackend({ timeoutMs: 120_000 });
await b.start();
const listed = await b.request('windows', {}, { timeoutMs: 30_000 });

// Pick a spread of window sizes and processes.
const byProcess = new Map();
for (const w of listed.windows) {
  if (!byProcess.has(w.process)) byProcess.set(w.process, w);
}
const targets = [...byProcess.values()].slice(0, 6);
console.log(`comparing ${targets.length} window(s) across three capture paths\n`);

const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const timeIt = async (fn, rounds = 3) => {
  const samples = [];
  let last;
  for (let i = 0; i < rounds; i += 1) {
    const t0 = performance.now();
    last = await fn();
    samples.push(performance.now() - t0);
  }
  return { ms: Math.round(median(samples)), out: last };
};

for (const target of targets) {
  const rect = { x: target.x, y: target.y, width: Math.min(target.width, 1400), height: Math.min(target.height, 900) };
  console.log(`=== hwnd=${target.hwnd} [${target.process}] "${String(target.title).slice(0, 30)}" ${target.width}x${target.height} ===`);

  // 1. GDI, from the screen at those coordinates.
  try {
    const gdi = await timeIt(async () => {
      const r = await b.request('screenshot', { path: './cmp-gdi.png', format: 'png', region: rect }, { timeoutMs: 60_000 });
      return r;
    });
    console.log(`  gdi screen   ${String(gdi.ms).padStart(4)} ms  ${String(gdi.out.width).padStart(4)}x${String(gdi.out.height).padEnd(4)} ${String(Math.round(gdi.out.bytes / 1024)).padStart(5)} KB  source=${gdi.out.source}`);
  } catch (error) { console.log(`  gdi screen   FAILED: ${String(error.message).slice(0, 70)}`); }

  // 2. PrintWindow: the window draws itself.
  try {
    const pw = await timeIt(async () => {
      const r = await b.request('screenshot', { path: './cmp-pw.png', format: 'png', window: target.hwnd }, { timeoutMs: 60_000 });
      return r;
    });
    console.log(`  printwindow  ${String(pw.ms).padStart(4)} ms  ${String(pw.out.width).padStart(4)}x${String(pw.out.height).padEnd(4)} ${String(Math.round(pw.out.bytes / 1024)).padStart(5)} KB  source=${pw.out.source}  ${JSON.stringify(pw.out.verification ?? []).slice(0, 90)}`);
  } catch (error) { console.log(`  printwindow  FAILED: ${String(error.message).slice(0, 70)}`); }

  // 3. A WGC path through the external addon, as a reference.
  // The two member names below come from that addon's own export surface.
  try {
    const info = native.applicationInfo(target.pid);
    const bundle = info?.bundle_id ?? '';
    const wgc = await timeIt(async () => {
      const r = await native.captureWindowPngVerifiedAsync(target.hwnd, target.pid, bundle);
      return r;
    }, 2);
    const bytes = wgc.out?.data?.length ?? 0;
    console.log(`  wgc (addon)  ${String(wgc.ms).padStart(4)} ms  ${String(wgc.out?.width ?? 0).padStart(4)}x${String(wgc.out?.height ?? 0).padEnd(4)} ${String(Math.round(bytes / 1024)).padStart(5)} KB  ok=${wgc.out?.ok} ${wgc.out?.error ?? ''}`);
  } catch (error) { console.log(`  wgc (addon)  FAILED: ${String(error.message).slice(0, 70)}`); }
}

await b.request('shutdown', {});
b.dispose();
setTimeout(() => process.exit(0), 100).unref();
