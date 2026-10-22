/**
 * 截图服务：参数规范化、格式推断、信封文案、落盘命名、摘要去重与入库
 * （9.txt §5.4 / §5.5 / §6 第 7 条 / §10）。
 *
 * 从 `index.js` 搬出来（§10 宿主半边拆分）。留下的是"调 worker 抓一张图"那一步——它需要后端的
 * `call`，属于入口的编排；搬走的是四件与后端无关的事：
 *
 *   1. **参数规范化**：单张与批次共用同一条规则（它们曾经不一致：同样的参数，单张返回整窗、批次返回
 *      裁切，而调用方除了看图大小没有任何办法分辨）。
 *   2. **落盘命名**：序号在这里，所以两张图永远不会撞同一个文件名。
 *   3. **摘要去重与入库**：同样的字节可以复用附件，但"屏幕没动"是**另一个问题**；去重状态只在图真的
 *      交付成功之后才提交（§6 第 7 条），否则一次失败的保存会把没人看过的画面记成"你看过了"。
 *   4. **信封文案**：像素↔屏幕换算、缩放、复用/未变、节奏与裁剪结论。
 *
 * 下面的函数体是**从 index.js 原样切出来的**（不是重写）：搬迁脚本按花括号配对取原文，只给声明加了
 * `export`，并把去重状态关进一层工厂。
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export /**
 * One capture request, normalised — the single-shot tool and the batch share this.
 *
 * They did not agree before: `window` + `region` returned the whole window from
 * `computer_screenshot` (the region was dropped on the floor) and a crop of that window
 * from `computer_actions`. Same arguments, two different pictures, and no way for the
 * caller to find out which one it got apart from the size of the image.
 *
 * The rule, stated once and applied by both:
 *
 *   region_space: 'screen'   the rectangle is absolute virtual-desktop pixels (the default)
 *   region_space: 'window'   the rectangle is pixels of the named window's own bitmap
 *
 * 'screen' is the default because that is what the argument already meant: a region has
 * always been a rectangle of the desktop, and the old batch converted it into the window's
 * own pixels itself. A window-local rectangle has to be asked for, and the two are never
 * told apart by the size of the numbers.
 * @param options - `{ window, region, regionSpace, display, clip }`.
 * @returns the normalised request.
 */
function normalizeCaptureSpec(options) {
  const hasWindow = options.window !== undefined && options.window !== null && Number(options.window) !== 0;
  const hasRegion = options.region !== undefined && options.region !== null;
  const requested = typeof options.regionSpace === 'string' && options.regionSpace !== '' ? options.regionSpace : undefined;
  const space = requested ?? 'screen';
  if (space !== 'screen' && space !== 'window') {
    throw new Error(`[BAD_REQUEST] region_space must be 'screen' or 'window' (got '${space}')`);
  }
  if (hasRegion && space === 'window' && !hasWindow) {
    throw new Error("[BAD_REQUEST] region_space: 'window' needs a window to be relative to: pass window with it, or leave the region in screen coordinates (region_space: 'screen', the default).");
  }
  return {
    window: hasWindow ? Number(options.window) : undefined,
    region: hasRegion ? options.region : undefined,
    regionSpace: space,
    display: hasWindow ? undefined : options.display,
    clip: options.clip === true,
    // Which part of the window to deliver: the whole of it, or its client area (§2.2). Only
    // meaningful with a window, and only 'client' needs to travel.
    surface: hasWindow && options.surface === 'client' ? 'client' : undefined,
  };
}

export /**
 * Pick the image format: an explicit argument wins, otherwise a caller-chosen
 * path's extension decides, otherwise JPEG (a quarter of the bytes of PNG at a
 * quality that keeps screen text readable).
 * @param requested - the `format` argument, if any.
 * @param path - a caller-chosen save path, if any.
 * @returns `'png'` or `'jpeg'`.
 */
function resolveFormat(requested, path) {
  if (requested === 'png' || requested === 'jpeg' || requested === 'jpg') {
    return requested === 'png' ? 'png' : 'jpeg';
  }
  if (typeof path === 'string') {
    const lower = path.toLowerCase();
    if (lower.endsWith('.png')) return 'png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'jpeg';
  }
  return 'jpeg';
}

export /**
 * Render the coordinate context the model needs to interpret a capture.
 *
 * Built from the tool's *declared* value rather than from the raw backend reply,
 * so the envelope can never describe a shape the output schema would reject.
 * @param value - the declared `computer_screenshot` value.
 * @returns the model-facing envelope.
 */
function screenshotEnvelope(value) {
const window = value.activeWindow === '' ? '(untitled)' : `"${value.activeWindow}"`;
const scale = Number(value.scale ?? 1);
const scaled = Math.abs(scale - 1) > 0.001;
const mapping = scaled
  ? `scale: the image is ${value.imageWidth}x${value.imageHeight} px for a ${value.width}x${value.height} px screen region — multiply an image coordinate by ${(1 / scale).toFixed(4)} before using it as a click target`
  : 'scale: image pixels are screen pixels (1:1)';
const unchanged = value.unchanged === true
  ? '\nunchanged: this frame is byte-identical to the *previous* frame this conversation was shown — nothing on screen has changed since you last looked'
  : '';
// The image resource being reused and the screen being unchanged are different facts,
// and the second one is the one worth acting on: an A → B → A sequence reuses the same
// attachment without the screen having stayed still.
const reused = value.unchanged !== true && value.reused === true
  ? '\nreused: this image is the same file already delivered earlier in this conversation (the attachment was not stored twice) — it is not a claim about the screen'
  : '';
// The pacing report, said in one line and only when it carries something the reader can
// act on. "The screen was still moving" and "you did not ask me to wait, so I did not" are
// different facts: the first is a warning about this frame, the second is not a warning at
// all, and reporting them as the same `stable: false` is how a skipped wait read as a
// failure. The four states that matter:
//   timeout        -- the budget ran out; this frame may be mid-update (the old warning)
//   conflict       -- two pacing arguments disagreed, and which one won is worth knowing
//   *-target/lost  -- the wait stopped because the thing being watched changed or went away
//   stable         -- said nothing: the caller waited precisely so it would not have to think
const pacing = (() => {
  const stability = value.stability;
  if (stability === undefined) return '';
  const budget = Number(stability.budgetMs ?? 0);
  const samples = Number(stability.polls ?? 0);
  const waited = Number(stability.waitedMs ?? 0);
  if (stability.state === 'timeout') {
    return `\nstill changing: the picture had not stopped changing within the ${budget} ms you asked for (${samples} sample(s), ${waited} ms), so part of this frame may be mid-update. Take another capture if what you need to read looks incomplete, or raise stability_ms if this surface is genuinely slow to settle.`;
  }
  if (stability.state === 'other-target' || stability.state === 'target-changed' || stability.state === 'target-lost' || stability.state === 'capture-failed') {
    return `\nwhile waiting: ${stability.note ?? stability.state}`;
  }
  if (stability.conflict !== undefined) return `\npacing: ${stability.conflict}`;
  return '';
})();
const clipped = value.clipped === true
  ? '\nclipped: the requested region ran past the virtual desktop and was trimmed to the part that exists — the origin above is the trimmed origin, not the one you asked for.'
  : '';
// Where this frame came from, when it is not the whole surface. The distinction matters
// for reading a coordinate back: a window region's image origin is that region's, not the
// window's, and the crop is what makes those two different numbers.
const crop = value.crop === undefined
  ? ''
  : `\nregion: this frame is the ${value.crop.width}x${value.crop.height} px part of ${value.surfaceKind === 'wholeWindow' ? 'that window' : 'the captured surface'} at (${value.crop.x},${value.crop.y}) within it — so image (0,0) is screen (${value.x},${value.y}), and the rest of that surface is not in this image`;
const scaleRequest = value.scaleNote === undefined ? '' : `\nscale note: ${value.scaleNote}`;
// How these pixels were obtained decides what they mean. A window capture is the
// window even while something covers it; a screen capture is whatever was visible at
// those coordinates, which may be a different window entirely.
const source = value.source === 'window'
  ? `\nhow: hwnd ${value.window?.hwnd ?? ''} drew its own pixels — this is that window even if something covers it on screen`
  : value.source === 'screen'
    ? '\nhow: copied from the screen at these coordinates — whatever was on top is what you are looking at'
    : '';
const verification = Array.isArray(value.verification) && value.verification.length > 0
  ? `\nchecked: ${value.verification.join('; ')}`
  : '';
// Staged cost, so a slow look can be attributed instead of just felt: the queue is the
// wait behind another call on the single worker, the backend number is the settle floor
// plus the stability poll plus the pixels and the encode, and the attachment number is
// the image crossing into the session store.
const timingParts = [];
if (value.timing !== undefined) {
  timingParts.push(`${value.timing.captureMs} ms for this call`);
  if (value.timing.startMs !== undefined) timingParts.push(`${value.timing.startMs} ms waiting for the worker to start`);
  if (value.timing.queueMs !== undefined) timingParts.push(`${value.timing.queueMs} ms queued behind another call`);
  if (value.timing.backendMs !== undefined) timingParts.push(`${value.timing.backendMs} ms inside the worker`);
  if (value.timing.settleMs !== undefined) timingParts.push(`settle ${value.timing.settleMs} ms`);
  if (value.timing.pollMs !== undefined) timingParts.push(`stability poll ${value.timing.pollMs} ms in ${value.timing.polls} sample(s)`);
  timingParts.push(`${value.timing.admitMs} ms to attach`);
}
const timing = timingParts.length === 0 ? '' : `\ntiming: ${timingParts.join(', ')}`;
// Handing over the frame id is what makes the arithmetic unnecessary: cite it and the
// worker projects the image pixel for you.
const frame = typeof value.frame === 'string' && value.frame !== ''
  ? `\nframe: ${value.frame} — pass it as from_frame with x,y measured *in this image*, and the projection (origin and scale) is done for you, with the frame checked before anything is dispatched`
  : '';
return `<screen_capture>
file: ${value.path}
image: ${value.imageWidth}x${value.imageHeight} px (${value.format}), captured at (${value.x},${value.y}) of the Windows virtual desktop
${mapping}${source}${verification}${frame}${unchanged}${reused}${pacing}${clipped}${crop}${scaleRequest}${timing}
cursor: (${value.cursor.x}, ${value.cursor.y})
active window: ${window}
displays:
${(value.displays ?? '').split('\n').map((line) => `  ${line}`).join('\n')}
coordinates: every pixel coordinate in this image and in the computer_* tools is an ABSOLUTE virtual-desktop pixel **in physical pixels** — the units this image is 1:1 with at scale 1, and the units a click or a drag is sent in. It is not a DPI-virtualized coordinate, and it is not a coordinate of the (possibly downscaled) copy of this image that was delivered to you. Add the capture origin (${value.x},${value.y}) to a position measured inside the image before clicking; the file above is always what this envelope describes.
</screen_capture>`;
}

/**
 * 捕获的落盘命名与入库去重（每个插件实例一份）。
 * @param options.sessionKey - 会话标识归一化函数（去重按会话记账）。
 */
export function createCaptureService({ sessionKey }) {
  /** 单调递增的截图文件名序号。 */
  let shotSeq = 0;

  /**
   * sha256 of admitted capture bytes -> the image fields that describe them.
   * Small on purpose: this exists to make the immediately repeated frame free,
   * not to be a general image cache.
   */
  const shotCache = new Map();

  const SHOT_CACHE_LIMIT = 8;

  /**
   * sessionKey -> the digest of the frame this session was last shown.
   *
   * Kept separately from `shotCache` because the two answer different questions, and
   * conflating them produced a wrong answer: "these bytes were seen before" is a fact
   * about the cache (so the attachment can be reused), while "nothing on screen has
   * changed since you last looked" is a fact about this session's *previous* frame.
   * A → B → A hit the cache and was reported as "unchanged", which told the model the
   * screen had not moved when it had moved twice.
   */
  const lastShotDigest = new Map();

  /**
   * 这次任务产出的文件，按会话记账 —— 会话收尾时删的就是这些。
   *
   * 归属是**后填的**：`nextCapturePath` 只知道要一个文件名，不知道谁在要；真正把它交给模型的是
   * `admit`，而 `admit` 手里有 sessionId。所以路径先落进 `unclaimed`，`admit` 时再挪进对应会话的
   * 集合。这样"谁的文件"由事实决定（谁真的看过了），而不是猜。
   *
   * 有一条路径**永远不会进这两个集合**：调用方用 `save_path` 显式指定落盘位置的那些 —— 它们不经过
   * `nextCapturePath`，所以我们既不知道、也不该删。那是调用方的文件。
   */
  const producedBySession = new Map();
  const unclaimed = new Set();

  /**
   * 把一张图认到某个会话名下。
   * 不在 `unclaimed` 里的一律不动：要么是调用方自己指路存的，要么不属于这个服务。
   */
  function claim(path, sessionId) {
    if (typeof path !== 'string' || path === '') return;
    if (!unclaimed.delete(path)) return;
    const key = sessionKey(sessionId);
    let set = producedBySession.get(key);
    if (set === undefined) {
      set = new Set();
      producedBySession.set(key, set);
    }
    set.add(path);
  }

  /**
   * 删除一批文件，并连带带走它们的派生帧。
   *
   * 关联帧（related）由 worker 决定抓几张，命名是在基名后接 `.related-<index>-<hwnd>`；所以按**基名
   * 前缀**扫一遍所在目录比给每个派生帧单独记账可靠 —— 记账会漏，扫目录不会。
   * 删除是 best effort：文件可能已经不在，或被别的进程占着；失败不该让收尾本身失败。
   * @returns 实际处理过的路径数。
   */
  async function removeFiles(paths) {
    const byDir = new Map();
    for (const path of paths) {
      if (typeof path !== 'string' || path === '') continue;
      const dir = dirname(path);
      let names = byDir.get(dir);
      if (names === undefined) {
        names = new Set();
        byDir.set(dir, names);
      }
      names.add(basename(path));
    }
    let handled = 0;
    for (const [dir, names] of byDir) {
      let entries;
      try {
        entries = await readdir(dir);
      } catch {
        continue; // 目录没了也算处理过了
      }
      const doomed = entries.filter((entry) => {
        for (const name of names) {
          if (entry === name || entry.startsWith(`${name}.related-`)) return true;
        }
        return false;
      });
      await Promise.all(doomed.map((entry) => rm(join(dir, entry), { force: true }).catch(() => {})));
      handled += doomed.length;
    }
    return handled;
  }

  /**
   * 会话收尾：删掉这次会话看过的所有图与派生帧。
   *
   * 只删自己产出的 —— `unclaimed` 与别的会话的集合都不动。
   * @param sessionId - 要收尾的会话。
   * @returns 实际处理过的路径数。
   */
  async function releaseSession(sessionId) {
    const key = sessionKey(sessionId);
    const set = producedBySession.get(key);
    if (set === undefined) return 0;
    producedBySession.delete(key);
    return await removeFiles([...set]);
  }

  /**
   * 实例收尾：把登记表里剩下的全删了 ——包括 `unclaimed`，那是"抓完了但还没交给任何会话"的残渣
   * （进程被杀、抓图失败、会话已先一步结束都会留下它）。
   * @returns 实际处理过的路径数。
   */
  async function releaseAll() {
    const all = [...unclaimed];
    for (const set of producedBySession.values()) all.push(...set);
    producedBySession.clear();
    unclaimed.clear();
    return await removeFiles(all);
  }

  /** 现在登记着多少张图（会话收尾的测试要看这个数）。 */
  function pendingCount() {
    let total = unclaimed.size;
    for (const set of producedBySession.values()) total += set.size;
    return total;
  }

  /**
   * 下一张图的落盘路径（序号在这里，避免两张图撞名）。
   * @param root - 插件自己的截图目录。
   * @param format - 'jpeg' 或 'png'。
   * @returns 绝对路径。
   */
  function nextCapturePath(root, format) {
    shotSeq += 1;
    const path = join(root, `capture-${process.pid}-${shotSeq}.${format === 'jpeg' ? 'jpg' : 'png'}`);
    // 先记在"还没归属"里；`admit` 会把它挪到真正看过它的那个会话名下。
    unclaimed.add(path);
    return path;
  }

  /**
   * Admit a capture into the durable attachment store.
   *
   * Captures are content-addressed, so an identical frame resolves to the same bytes
   * and the attachment can be reused instead of stored twice. Two facts follow from
   * that, and they are deliberately reported separately:
   *
   *   * `reused` — these bytes are already in this session's attachment store, so the
   *     image was not uploaded again;
   *   * `unchanged` — these bytes are identical to the *previous* frame this session was
   *     shown, so nothing on screen has moved since the model last looked. Only this one
   *     may be read as "you have already seen this screen".
   *
   * Returns the fields of `IMAGE_VALUE_SCHEMA` rather than a live reference,
   * because a tool's returned value has to survive the declared output schema —
   * `additionalProperties: false` rejects anything the schema does not name.
   * @param ctx - the plugin context.
   * @param path - the image on disk.
   * @param mediaType - the media type the backend actually wrote.
   * @param name - display name for the attachment.
   * @param sessionId - the Session the capture is being shown to.
   * @returns the image fields plus the `reused`/`unchanged` flags, or a note explaining why there are none.
   */
  async function admitCapture(ctx, path, mediaType, name, sessionId) {
    // 谁看过它，它就算谁的 —— 会话收尾时按这个归属删。
    claim(path, sessionId);
    const attachments = ctx.get('attachments');
    if (attachments === undefined || typeof attachments.saveImages !== 'function') {
      return { note: `No attachment store is mounted, so the image is not attached. Read it with the read_image tool: ${path}` };
    }
    try {
      const data = await readFile(path);
      const digest = createHash('sha256').update(data).digest('hex');
      const key = sessionKey(sessionId);
      // What this session was shown *last*: read here, committed only once the frame really
      // reached the caller (§6). Committing it up front meant a save that failed still
      // recorded the frame as "seen", and the next identical capture was then answered with
      // "nothing has changed since you last looked" about a picture nobody ever looked at.
      const previous = lastShotDigest.get(key);
      const unchanged = previous !== undefined && previous === digest;
      const remember = () => {
        lastShotDigest.delete(key);
        lastShotDigest.set(key, digest);
        while (lastShotDigest.size > SHOT_CACHE_LIMIT) {
          const oldest = lastShotDigest.keys().next().value;
          if (oldest === undefined) break;
          lastShotDigest.delete(oldest);
        }
      };
      const cached = shotCache.get(digest);
      if (cached !== undefined) {
        // Refresh recency: the entry the model is most likely to see again is the
        // frame it is currently looking at. These bytes are already in the store, so this
        // frame *is* being shown: committing the record here is honest.
        shotCache.delete(digest);
        shotCache.set(digest, cached);
        remember();
        return unchanged ? { image: cached, reused: true, unchanged: true } : { image: cached, reused: true };
      }
      const [ref] = await attachments.saveImages([{ data: new Uint8Array(data), mediaType, name }]);
      if (ref === undefined) {
        // Nothing was stored and nothing was shown, so the record is left alone: a retry of
        // the same capture has to be able to say "you have not seen this".
        return { note: `The capture was not attached. Read it with the read_image tool: ${path}` };
      }
      // 这一条记录会被宿主逐字节复核：`dsh-attachment-local.readImageFile()` 重新探测落盘
      // 对象的格式/尺寸，任何一项与 ref 不符就抛 ATTACHMENT_CORRUPT，而这条 image block 会被
      // 之后每一轮请求重放——一次截图就能让整个会话永久不可用。
      //
      // 存储层是**有损重编码**的：超限的 PNG 会被转成 WebP（带 alpha）或 JPEG，并可能附带
      // originalDimensions。所以 mediaType/bytes/width/height 必须全部来自同一个 ref；
      // 用入参的 mediaType 覆盖它，正是"PNG 标签 + WebP 实体"那条坏记录的来源（1.39.5 事故）。
      const image = {
        ...ref,
        attachmentId: String(ref.attachmentId),
        mediaType: String(ref.mediaType ?? mediaType),
        bytes: Number(ref.bytes ?? data.byteLength),
        width: Number(ref.width ?? 0),
        height: Number(ref.height ?? 0),
        name,
      };
      shotCache.set(digest, image);
      if (shotCache.size > SHOT_CACHE_LIMIT) {
        const oldest = shotCache.keys().next().value;
        if (oldest !== undefined) shotCache.delete(oldest);
      }
      remember();
      return unchanged ? { image, unchanged: true } : { image };
    } catch (error) {
      // The capture itself worked; only the attaching failed, so the "last shown" record is
      // deliberately not committed and the same frame can be attached again on the next call.
      return {
        note: `The capture could not be attached (${error instanceof Error ? error.message : String(error)}). Read it with the read_image tool instead: ${path}`,
      };
    }
  }

  return { nextCapturePath, admit: admitCapture, releaseSession, releaseAll, pendingCount };
}
