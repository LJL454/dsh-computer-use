// Is the desktop accepting synthesized input right now?
import { PowerShellBackend } from './backend/bridge.js';

const b = new PowerShellBackend({ timeoutMs: 60_000 });
await b.start();
const health = await b.request('health', {}, { timeoutMs: 20_000 });
console.log(`interactive=${health.interactive} foreground=${health.foregroundHwnd} "${String(health.foregroundTitle).slice(0, 40)}"`);
console.log(`note: ${health.note}`);
console.log(`engine=${health.engine} engineError="${String(health.engineError).slice(0, 60)}"`);
const cursor = await b.request('cursor', {}, { timeoutMs: 20_000 });
console.log(`cursor: ${JSON.stringify(cursor)}`);
const windows = await b.request('windows', {}, { timeoutMs: 30_000 });
const top = windows.windows.slice(0, 6);
for (const w of top) console.log(`  hwnd=${w.hwnd} fg=${w.foreground} [${w.process}] "${String(w.title).slice(0, 40)}"`);
await b.request('shutdown', {});
b.dispose();
setTimeout(() => process.exit(0), 100).unref();
