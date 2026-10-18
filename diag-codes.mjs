// The two new checks: a surrogate-pair diagnosis, and a screen frame that still maps.
import { PowerShellBackend } from './backend/bridge.js';

const b = new PowerShellBackend({ timeoutMs: 90_000 });
await b.start();
const listed = await b.request('windows', {}, { timeoutMs: 30_000 });
const np = (listed.windows ?? []).find((w) => /notepad/i.test(w.process));
if (!np) { console.log('no notepad'); process.exit(1); }

const tree = await b.request('uitree', { hwnd: np.hwnd, maxNodes: 40 }, { timeoutMs: 60_000 });
const doc = tree.nodes.find((n) => String(n.controlType).includes('Document'));
const docSel = { hwnd: np.hwnd, automationId: doc.automationId, name: doc.automationId ? '' : doc.name, controlType: doc.automationId ? '' : doc.controlType };

await b.request('uiact', { action: 'set_value', ...docSel, value: '第一行：定位目标 😀 定位锚点 结束' }, { timeoutMs: 60_000 });
await new Promise((r) => setTimeout(r, 700));

const trySelect = async (label, payload) => {
  try {
    const out = await b.request('uiact', { action: 'select_text', ...docSel, ...payload }, { timeoutMs: 60_000 });
    return `${label}: selected ${JSON.stringify(String(out.value).slice(0, 30))}`;
  } catch (error) {
    return `${label}: ${String(error.message).replace(/^uiact failed:\s*/, '').slice(0, 210)}`;
  }
};

// 1. Plain text: works.
console.log(await trySelect('plain          ', { text: '定位锚点' }));

// 2. An emoji prefix that does not match: the provider may or may not count it as one
//    character, and the refusal should say so rather than "not found".
console.log(await trySelect('emoji prefix   ', { text: '定位锚点', prefix: '😀' }));

// 3. A plain prefix that does not match: the ordinary message.
console.log(await trySelect('plain prefix   ', { text: '定位锚点', prefix: 'ZZZ' }));

// 3b. An emoji prefix that does NOT match: the surrogate branch of the diagnosis.
console.log(await trySelect('emoji nomatch  ', { text: '定位锚点', prefix: '😀😀' }));

// 4. A screen frame: the projection and the layout check.
const shot = await b.request('screenshot', { path: './screen-frame.png', format: 'png', display: 0, scale: 0.25 }, { timeoutMs: 60_000 });
console.log(`\nscreen frame ${shot.frame}: image ${Math.round(shot.width * shot.scale)}x${Math.round(shot.height * shot.scale)} for ${shot.width}x${shot.height} at ${shot.x},${shot.y}`);
const clicked = await b.request('click', { x: 40, y: 40, fromFrame: shot.frame, preferA11y: false }, { timeoutMs: 60_000 }).catch((e) => ({ error: String(e.message) }));
if (clicked.error) {
  console.log(`screen-frame click refused: ${clicked.error.slice(0, 150)}`);
} else {
  console.log(`screen-frame click: image (40,40) -> screen (${clicked.frame.projected.x},${clicked.frame.projected.y}) (expected ${Math.round(shot.x + 40 / shot.scale)},${Math.round(shot.y + 40 / shot.scale)})`);
}

await b.request('shutdown', {});
b.dispose();
setTimeout(() => process.exit(0), 100).unref();
