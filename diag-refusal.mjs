// Do the refusals now say which kind of "not found" it is, and whether the UI was touched?
import { PowerShellBackend } from './backend/bridge.js';

const b = new PowerShellBackend({ timeoutMs: 90_000 });
await b.start();
const listed = await b.request('windows', {}, { timeoutMs: 30_000 });
const np = (listed.windows ?? []).find((w) => /notepad/i.test(w.process));
if (!np) { console.log('no notepad'); process.exit(1); }

const attempt = async (ref) => {
  try {
    const out = await b.request('uiact', { action: 'get_value', ref }, { timeoutMs: 30_000 });
    return `NO ERROR (bad): ${JSON.stringify(out).slice(0, 80)}`;
  } catch (error) {
    return String(error.message).replace(/^uiact failed:\s*/, '').slice(0, 230);
  }
};

console.log('1. a snapshot this session never issued:');
console.log(`   ${await attempt('s999.5')}`);

console.log('\n2. a malformed ref:');
console.log(`   ${await attempt('not-a-ref')}`);

// 26 reads push s1 out of the keep window (SnapshotKeep = 24).
const first = await b.request('uitree', { hwnd: np.hwnd, maxNodes: 30 }, { timeoutMs: 60_000 });
const oldest = `${first.snapshot}.1`;
for (let i = 0; i < 70; i += 1) await b.request('uitree', { hwnd: np.hwnd, maxNodes: 60 }, { timeoutMs: 60_000 });
console.log(`\n3. a ref whose observation has been retired (${oldest}, after 70 more reads (past the 64-snapshot window)):`);
console.log(`   ${await attempt(oldest)}`);

console.log('\n4. a ref that is still live:');
const live = await b.request('uitree', { hwnd: np.hwnd, maxNodes: 30 }, { timeoutMs: 60_000 });
const doc = live.nodes.find((n) => String(n.controlType).includes('Document')) ?? live.nodes[1];
const ok = await b.request('uiact', { action: 'get_value', ref: doc.ref }, { timeoutMs: 60_000 }).catch((e) => ({ error: String(e.message) }));
console.log(`   ref ${doc.ref} -> ${ok.error ? `refused: ${ok.error.slice(0, 80)}` : `read back, reresolved=${ok.reresolved ?? false}`}`);

await b.request('shutdown', {});
b.dispose();
setTimeout(() => process.exit(0), 100).unref();
