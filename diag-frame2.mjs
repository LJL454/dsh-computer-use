// Frame provenance: cite a frame, hand over image pixels, get the projection and the checks.
import { PowerShellBackend } from './backend/bridge.js';

const b = new PowerShellBackend({ timeoutMs: 90_000 });
await b.start();
const listed = await b.request('windows', {}, { timeoutMs: 30_000 });
const np = (listed.windows ?? []).find((w) => /notepad/i.test(w.process));
if (!np) { console.log('no notepad'); process.exit(1); }
console.log(`window hwnd=${np.hwnd} ${np.width}x${np.height} at ${np.x},${np.y}`);

const click = (payload) => b.request('click', payload, { timeoutMs: 60_000 }).then((r) => ({ ok: true, r }), (e) => ({ ok: false, message: String(e.message) }));
const shot = (extra) => b.request('screenshot', { format: 'png', window: np.hwnd, ...extra }, { timeoutMs: 60_000 });
const imgW = (s) => Math.max(1, Math.round(s.width * s.scale));
const imgH = (s) => Math.max(1, Math.round(s.height * s.scale));

const px = 200;
const py = 200;

// 1. A full-size window capture.
const full = await shot({ path: './frame-1.png' });
console.log(`\nframe ${full.frame}: window ${full.width}x${full.height} at ${full.x},${full.y} scale=${full.scale} source=${full.source} image=${imgW(full)}x${imgH(full)}`);

// 2. Click a harmless spot inside the document, addressed in image pixels.
const hit = await click({ x: px, y: py, fromFrame: full.frame, preferA11y: false });
if (hit.ok) {
  const expectX = Math.round(full.x + px / full.scale);
  const expectY = Math.round(full.y + py / full.scale);
  const got = hit.r.frame.projected;
  console.log(`click from image (${px},${py}) -> projected (${got.x},${got.y}), expected (${expectX},${expectY})  match=${got.x === expectX && got.y === expectY}`);
  console.log(`  receipt: ${JSON.stringify(hit.r.frame)}`);
} else {
  console.log(`click refused: ${hit.message.slice(0, 150)}`);
}

// 3. A downscaled capture: the same image pixel means a different screen pixel.
const half = await shot({ path: './frame-2.png', scale: 0.5 });
console.log(`\nframe ${half.frame}: image ${imgW(half)}x${imgH(half)} for a ${half.width}x${half.height} window, scale=${half.scale}`);
const halfHit = await click({ x: px, y: py, fromFrame: half.frame, preferA11y: false });
if (halfHit.ok) {
  const expectX2 = Math.round(half.x + px / half.scale);
  const expectY2 = Math.round(half.y + py / half.scale);
  const got2 = halfHit.r.frame.projected;
  console.log(`same image pixel (${px},${py}) on the half-size frame -> (${got2.x},${got2.y}), expected (${expectX2},${expectY2})  match=${got2.x === expectX2 && got2.y === expectY2}`);
  console.log('  => the same image coordinate lands on different screen pixels depending on the frame scale');
} else {
  console.log(`refused: ${halfHit.message.slice(0, 150)}`);
}

// 4. A frame this worker never took.
const bogus = await click({ x: 10, y: 10, fromFrame: 'f999', preferA11y: false });
console.log(`\nbogus frame -> ${bogus.ok ? 'NO ERROR (bad)' : bogus.message.replace(/^click failed:\s*/, '').slice(0, 180)}`);

// 5. A point outside the frame's image.
const outside = await click({ x: 99999, y: 10, fromFrame: full.frame, preferA11y: false });
console.log(`outside the image -> ${outside.ok ? 'NO ERROR (bad)' : outside.message.replace(/^click failed:\s*/, '').slice(0, 150)}`);

await b.request('shutdown', {});
b.dispose();
setTimeout(() => process.exit(0), 100).unref();
