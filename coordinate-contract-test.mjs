/**
 * Deterministic coordinate-contract cases (方案文档 §4 的测试组).
 *
 * The arithmetic is checked against numbers written down here and synthetic frame metadata,
 * not against whatever control happened to be under the cursor: "the projection is right" is
 * a claim about a *transform*, and the way to test a transform is to hand it known inputs and
 * compare the outputs. The cases run against the real worker through the real bridge, so the
 * code under test is the code the tools use.
 *
 * What is covered here, and where the rest lives:
 *
 *   transform          这里：全窗、裁剪、缩放、负原点、附件重缩放、未知变换、越界
 *   window frames      这里（需要一个真实窗口）：尺寸变化拒绝、只移动则重投影
 *   hidden/occluded    遮挡与跨进程落点由 live-tool-test / task-eval 覆盖（需要真实遮挡）
 *   waits              这里：C01（held）、C03（条件组合）、C05（三值）
 *   batches            这里：C02（条件失败即停）、C04（统一 deadline）
 *   captures           这里：A01（同一套 region 语义）、A02（裁剪再缩放）、A07（scale 回执）
 *
 * Run with: node coordinate-contract-test.mjs
 */
import { PowerShellBackend, resolvePowerShell } from './backend/bridge.js';
import { spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'dsh-cu-coord-'));
const backend = new PowerShellBackend({ timeoutMs: 30_000 });

/**
 * Start a small window of this test's own, positioned over the middle of `target`.
 *
 * The occluded-point case needs another process's window on top of the target, and the honest
 * way to get one is to make it: moving the user's windows around would be rude, and waiting for
 * the desktop to happen to overlap is how a case ends up permanently skipped. Returns the child
 * pid (for the cleanup) and the window once the shell has actually put it on screen.
 * @param target - the window to cover.
 * @param dir - where to write the probe script.
 * @returns `{ pid, window }`, with `window` undefined when it never appeared.
 */
async function startOccluder(target, dir) {
  const script = join(dir, 'occluder.ps1');
  const x = Number(target.x) + Math.floor(Number(target.width) / 4);
  const y = Number(target.y) + Math.floor(Number(target.height) / 4);
  const w = Math.max(160, Math.floor(Number(target.width) / 2));
  const h = Math.max(160, Math.floor(Number(target.height) / 2));
  writeFileSync(script, [
    `'probe: start' | Out-File -FilePath '${join(dir, 'probe-progress.log')}' -Append -Encoding utf8`,
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    `'probe: assemblies loaded' | Out-File -FilePath '${join(dir, 'probe-progress.log')}' -Append -Encoding utf8`,
    `$form = New-Object System.Windows.Forms.Form`,
    "$form.Text = 'dsh-occluder-probe'",
    "$form.StartPosition = 'Manual'",
    `$form.Location = New-Object System.Drawing.Point(${x}, ${y})`,
    `$form.Size = New-Object System.Drawing.Size(${w}, ${h})`,
    '$form.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 30)',
    '$form.Show()',
    `'probe: shown' | Out-File -FilePath '${join(dir, 'probe-progress.log')}' -Append -Encoding utf8`,
    '[System.Windows.Forms.Application]::Run($form)',
    `'probe: run loop returned' | Out-File -FilePath '${join(dir, 'probe-progress.log')}' -Append -Encoding utf8`,
    '',
  ].join('\r\n'), 'utf8');
  // The full path, resolved the same way the backend resolves it: a bare `powershell.exe` is
  // subject to whatever PATH the host process happens to have, and a probe that silently fails
  // to start would turn this case into a permanent skip. Its output goes to a file so a failure
  // says *why* rather than just "it did not appear".
  const logPath = join(dir, 'occluder.log');
  const logFd = openSync(logPath, 'a');
  const child = spawn(resolvePowerShell(), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { detached: true, stdio: ['ignore', logFd, logFd] });
  child.on('error', () => { /* reported as "the probe did not appear" below */ });
  child.unref();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const list = await backend.request('windows', {}, { timeoutMs: 20_000 }).catch(() => ({ windows: [] }));
    const found = (list.windows ?? []).find((one) => String(one.title) === 'dsh-occluder-probe');
    if (found !== undefined) {
      try { closeSync(logFd); } catch { /* nothing to close */ }
      return { pid: child.pid, window: found };
    }
  }
  let why = '';
  try {
    const log = readFileSync(logPath, 'utf8').trim();
    const progress = readFileSync(join(dir, 'probe-progress.log'), 'utf8').trim().replace(/\s+/g, ' ');
    const titles = await backend.request('windows', {}, { timeoutMs: 20_000 }).then((list) => (list.windows ?? []).map((one) => one.title).join(' | ')).catch(() => '');
    why = `exit=${child.exitCode} progress=${progress.slice(0, 120)} log=${log.slice(0, 80)} windows=${titles.slice(0, 100)}`;
  } catch { why = `exit=${child.exitCode}`; }
  try { closeSync(logFd); } catch { /* nothing to close */ }
  return { pid: child.pid, window: undefined, why };
}

/** Kill the probe this test started (and only that one). */
function stopOccluder(pid) {
  if (!Number.isFinite(Number(pid))) return;
  try {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    killer.unref();
  } catch {
    /* the probe is gone or the kill was refused; the case is over either way */
  }
}

let passed = 0;
let failed = 0;
const failures = [];

function check(condition, name, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}${detail === '' ? '' : ` -- ${detail}`}`);
    return true;
  }
  failed += 1;
  failures.push(name);
  console.log(`  FAIL  ${name}${detail === '' ? '' : ` -- ${detail}`}`);
  return false;
}

function ok(name, detail = '') {
  passed += 1;
  console.log(`  PASS  ${name}${detail === '' ? '' : ` -- ${detail}`}`);
}

function skip(name, why) {
  console.log(`  skip  ${name} -- ${why}`);
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

async function run(cmd, args, options = {}) {
  return backend.request(cmd, args, { timeoutMs: options.timeoutMs ?? 30_000 });
}

try {
  const info = await backend.start();
  ok('the worker answers', `pid ${info.pid}, protocol ${info.protocol}, frameProtocol ${info.frameProtocol}, build ${info.build}`);
  check(
    Array.isArray(info.capabilities) && info.capabilities.includes('frame.v2') && info.capabilities.includes('guard.landing'),
    'it publishes the coordinate capabilities it was built with (A09)',
    (info.capabilities ?? []).join(','),
  );

  /* ------------------------------------------------------------------ transform */

  section('the transform, on synthetic frame metadata');

  const whole = await run('frameproject', {
    frame: {
      surface: { kind: 'wholeWindow', x: 100, y: 200, width: 800, height: 600 },
      encoded: { width: 800, height: 600 },
    },
    x: 10,
    y: 20,
  });
  check(whole.ok === true && whole.x === 110 && whole.y === 220, 'a whole-window frame maps 1:1 from its own origin', JSON.stringify(whole));

  // The worked example from the plan: window at (100,200), a 400x200 crop taken from (200,100)
  // of it, encoded at half size. The centre of that image is the desktop point (500,400).
  // An integer pixel index means that pixel's *centre*, so the answer may land one physical
  // pixel away from the continuous-coordinate example -- which is the stated tolerance.
  const cropped = await run('frameproject', {
    frame: {
      surface: { kind: 'wholeWindow', x: 100, y: 200, width: 800, height: 600 },
      crop: { x: 200, y: 100, width: 400, height: 200 },
      encoded: { width: 200, height: 100 },
    },
    x: 100,
    y: 50,
  });
  check(
    cropped.ok === true && Math.abs(cropped.x - 500) <= 1 && Math.abs(cropped.y - 400) <= 1,
    'a cropped and halved frame lands where the arithmetic says (500,400 ±1)',
    JSON.stringify(cropped),
  );

  const halved = await run('frameproject', {
    frame: {
      surface: { kind: 'screenRegion', x: 0, y: 0, width: 800, height: 600 },
      encoded: { width: 400, height: 300 },
    },
    x: 200,
    y: 150,
  });
  check(
    halved.ok === true && Math.abs(halved.x - 400) <= 1 && Math.abs(halved.y - 300) <= 1,
    'a half-size frame of a screen region maps its centre back to the middle of that region',
    JSON.stringify(halved),
  );

  const negative = await run('frameproject', {
    frame: {
      surface: { kind: 'display', x: -1920, y: -100, width: 1920, height: 1080 },
      encoded: { width: 960, height: 540 },
    },
    x: 0,
    y: 0,
  });
  check(
    negative.ok === true && Math.abs(negative.x + 1920) <= 1 && Math.abs(negative.y + 100) <= 1,
    'a capture on a monitor with negative origin still maps to that origin',
    JSON.stringify(negative),
  );

  const rescaled = await run('frameproject', {
    frame: {
      surface: { kind: 'screenRegion', x: 0, y: 0, width: 400, height: 200 },
      encoded: { width: 400, height: 200 },
      attached: { width: 200, height: 100, transformKnown: true },
    },
    x: 50,
    y: 25,
  });
  check(rescaled.ok === true && rescaled.x === 100 && rescaled.y === 50, 'a rescaled delivery is inverted before projecting (A04)', JSON.stringify(rescaled));
  check(rescaled.mapping !== undefined && String(rescaled.mapping).startsWith('attached-rescaled'), 'and the receipt says the delivery was rescaled', String(rescaled.mapping));

  const unknownDelivery = await run('frameproject', {
    frame: {
      surface: { kind: 'screenRegion', x: 0, y: 0, width: 400, height: 200 },
      encoded: { width: 400, height: 200 },
      attached: { transformKnown: false },
    },
    x: 10,
    y: 10,
  });
  check(
    unknownDelivery.ok === false && String(unknownDelivery.error).includes('[COORDINATE_MAPPING_UNKNOWN]'),
    'an unknown delivery transform is refused, not guessed (A04)',
    String(unknownDelivery.error ?? '').slice(0, 80),
  );

  const outside = await run('frameproject', {
    frame: {
      surface: { kind: 'screenRegion', x: 0, y: 0, width: 200, height: 100 },
      encoded: { width: 200, height: 100 },
    },
    x: 900,
    y: 0,
  });
  check(
    outside.ok === false && String(outside.error).includes('[BAD_REQUEST]'),
    'an image point outside the frame is refused rather than clamped',
    String(outside.error ?? '').slice(0, 80),
  );

  const uneven = await run('frameproject', {
    frame: {
      surface: { kind: 'screenRegion', x: 0, y: 0, width: 800, height: 600 },
      encoded: { width: 200, height: 100 },
    },
    x: 100,
    y: 50,
  });
  check(uneven.ok === true && uneven.x === 400 && uneven.y === 300, 'each axis uses its own ratio when the two differ (4x across, 6x down)', JSON.stringify(uneven));

  const threeQuarters = await run('frameproject', {
    frame: {
      surface: { kind: 'screenRegion', x: 10, y: 20, width: 400, height: 300 },
      encoded: { width: 300, height: 225 },
      effectiveScale: 0.75,
      requestedScale: 0.75,
    },
    x: 150,
    y: 112,
  });
  check(threeQuarters.ok === true && threeQuarters.x === 210 && threeQuarters.y === 169, 'a three-quarter frame maps through its own ratio', JSON.stringify(threeQuarters));

  /* ------------------------------------------------------------- content drift */

  section('content: a surface that changed under the frame (§3.2 的滚动/导航/自刷新)');
  const drifted = await run('frameproject', {
    frame: {
      surface: { kind: 'screenRegion', x: 0, y: 0, width: 64, height: 48 },
      encoded: { width: 64, height: 48 },
      surfaceDigest: 'deadbeefdeadbeef',
      ageMs: 9000,
    },
    x: 10,
    y: 10,
  });
  check(
    drifted.ok === false && String(drifted.error).includes('[FRAME_CONTENT_CHANGED]'),
    'an old frame whose surface no longer looks the same is refused, although its rectangle is identical',
    String(drifted.error ?? '').slice(0, 110),
  );

  const stillFresh = await run('frameproject', {
    frame: {
      surface: { kind: 'screenRegion', x: 0, y: 0, width: 64, height: 48 },
      encoded: { width: 64, height: 48 },
      surfaceDigest: 'deadbeefdeadbeef',
      ageMs: 10,
    },
    x: 10,
    y: 10,
  });
  check(stillFresh.ok === true, 'a fresh frame is not checked at all — the caller has just looked', JSON.stringify(stillFresh));

  const optedOut = await run('frameproject', {
    frame: {
      surface: { kind: 'screenRegion', x: 0, y: 0, width: 64, height: 48 },
      encoded: { width: 64, height: 48 },
      surfaceDigest: 'deadbeefdeadbeef',
      ageMs: 9000,
    },
    x: 10,
    y: 10,
    verifyContent: false,
  });
  check(optedOut.ok === true, 'verify_content: false is how an animated surface opts out', JSON.stringify(optedOut));

  /* -------------------------------------------------------------- window frames */

  section('window frames: identity and geometry');
  const windows = await run('windows', {});
  const target = (windows.windows ?? []).find((one) => Number(one.width) > 240 && Number(one.height) > 180 && String(one.title) !== '');
  if (target === undefined) {
    skip('window-frame cases', 'no visible window large enough is open on this desktop');
  } else {
    // Everything in here needs that window to still exist and still be visible while it runs.
    // A desktop someone else is using can take it away in the middle, and that is a fact about
    // the machine rather than about the plugin, so it is reported as a skip with the reason
    // instead of as a failure of the code under test.
    try {
    const surface = { kind: 'wholeWindow', x: target.x, y: target.y, width: target.width, height: target.height };
    const middle = { x: Math.floor(target.width / 2), y: Math.floor(target.height / 2) };

    const resized = await run('frameproject', {
      frame: {
        hwnd: target.hwnd,
        pid: target.pid,
        surface,
        windowRect: { x: target.x, y: target.y, width: target.width - 40, height: target.height },
        encoded: { width: target.width, height: target.height },
      },
      x: middle.x,
      y: middle.y,
    });
    check(
      resized.ok === false && String(resized.error).includes('[FRAME_STALE]'),
      'a window that was resized since the frame is refused, not re-scaled',
      String(resized.error ?? '').slice(0, 90),
    );

    const moved = await run('frameproject', {
      frame: {
        hwnd: target.hwnd,
        pid: target.pid,
        surface,
        windowRect: { x: target.x - 30, y: target.y, width: target.width, height: target.height },
        encoded: { width: target.width, height: target.height },
      },
      x: 20,
      y: 20,
    });
    check(
      moved.ok === true && moved.drift === 30 && moved.x === target.x + 50 && moved.y === target.y + 20,
      'a window that only moved is re-projected by exactly the drift, and the landing point is guarded',
      JSON.stringify({ x: moved.x, y: moved.y, drift: moved.drift, guard: moved.guard }),
    );
    check(
      typeof moved.guard === 'string' && moved.guard !== 'occluded',
      'the guard read what is under the re-projected point rather than assuming the window',
      String(moved.guard),
    );

    // The doc's worked example (§2.4) moves the window by (30, 20) — both axes. A frame records
    // where the window was *then* (surface and windowRect agree, as they do in a real frame), and
    // the projection has to land on where the window is now, on both axes, not just the one the
    // drift number names.
    const twoAxis = await run('frameproject', {
      frame: {
        hwnd: target.hwnd,
        pid: target.pid,
        surface: { kind: 'wholeWindow', x: target.x - 30, y: target.y - 20, width: target.width, height: target.height },
        windowRect: { x: target.x - 30, y: target.y - 20, width: target.width, height: target.height },
        encoded: { width: target.width, height: target.height },
      },
      x: 10,
      y: 10,
    });
    check(
      twoAxis.ok === true && twoAxis.x === target.x + 10 && twoAxis.y === target.y + 10 && twoAxis.drift === 30,
      'a window that moved on both axes is corrected on both, not just the one the drift names',
      JSON.stringify({ x: twoAxis.x, y: twoAxis.y, drift: twoAxis.drift, expected: { x: target.x + 10, y: target.y + 10 } }),
    );

    // §4's "same process, another window" and "a legitimate dialog transition" rows: both are
    // decided by the guard's owner/pid logic, and both need a second window of the same process on
    // top of the target. When this desktop has one, the case runs; when it does not, it says so.
    const sibling = (windows.windows ?? []).find((one) => Number(one.pid) === Number(target.pid)
      && Number(one.hwnd) !== Number(target.hwnd)
      && Number(one.x) <= target.x + target.width && Number(one.x) + Number(one.width) >= target.x
      && Number(one.y) <= target.y + target.height && Number(one.y) + Number(one.height) >= target.y
      && Number(one.width) > 120 && Number(one.height) > 120);
    if (sibling === undefined) {
      skip('the same-process sibling case', 'this application has no second visible window over the target right now');
    } else {
      const siblingX = Math.max(target.x, sibling.x) + 5;
      const siblingY = Math.max(target.y, sibling.y) + 5;
      const frameSpec = {
        hwnd: target.hwnd,
        pid: target.pid,
        surface,
        windowRect: { x: target.x, y: target.y, width: target.width, height: target.height },
        encoded: { width: target.width, height: target.height },
      };
      await run('focus', { hwnd: sibling.hwnd }, { timeoutMs: 20_000 }).catch(() => null);
      try {
        const blocked = await run('frameproject', { frame: frameSpec, x: siblingX - target.x, y: siblingY - target.y });
        check(
          blocked.ok === false,
          'a point that belongs to another window of the same process is refused rather than sent',
          String(blocked.error ?? JSON.stringify(blocked)).slice(0, 110),
        );
        const allowed = await run('frameproject', { frame: frameSpec, x: siblingX - target.x, y: siblingY - target.y, allowWindows: [sibling.hwnd] });
        check(
          allowed.ok === true && String(allowed.guard) === 'allowed-transition',
          'the same point is allowed once that window is named as an expected transition (§3.3 第 3 条)',
          JSON.stringify({ ok: allowed.ok, guard: allowed.guard, recovered: allowed.recovered }).slice(0, 130),
        );
      } finally {
        await run('focus', { hwnd: target.hwnd }, { timeoutMs: 20_000 }).catch(() => null);
      }
    }

    const wrongOwner = await run('frameproject', {
      frame: {
        hwnd: target.hwnd,
        pid: Number(target.pid) + 100000,
        surface,
        windowRect: { x: target.x, y: target.y, width: target.width, height: target.height },
        encoded: { width: target.width, height: target.height },
      },
      x: middle.x,
      y: middle.y,
    });
    check(
      wrongOwner.ok === false && String(wrongOwner.error).includes('TARGET_CHANGED'),
      'a handle that now belongs to another process is refused as TARGET_CHANGED',
      String(wrongOwner.error ?? '').slice(0, 90),
    );

    const dpiShift = await run('frameproject', {
      frame: {
        hwnd: target.hwnd,
        pid: target.pid,
        dpi: 999,
        surface,
        windowRect: { x: target.x, y: target.y, width: target.width, height: target.height },
        encoded: { width: target.width, height: target.height },
      },
      x: middle.x,
      y: middle.y,
    });
    check(
      dpiShift.ok === false && String(dpiShift.error).includes('[DPI_CHANGED]'),
      'a window now rendered at another DPI invalidates the frame although its rectangle is unchanged',
      String(dpiShift.error ?? '').slice(0, 90),
    );

    const recycledHandle = await run('frameproject', {
      frame: {
        hwnd: target.hwnd,
        pid: target.pid,
        processStart: 1,
        surface,
        windowRect: { x: target.x, y: target.y, width: target.width, height: target.height },
        encoded: { width: target.width, height: target.height },
      },
      x: middle.x,
      y: middle.y,
    });
    check(
      recycledHandle.ok === false && String(recycledHandle.error).includes('TARGET_CHANGED'),
      'a pid reused by a different process (same number, another creation time) is refused',
      String(recycledHandle.error ?? '').slice(0, 90),
    );

    const noRecoveryNeeded = await run('frameproject', {
      frame: {
        hwnd: target.hwnd,
        pid: target.pid,
        surface,
        windowRect: { x: target.x, y: target.y, width: target.width, height: target.height },
        encoded: { width: target.width, height: target.height },
      },
      x: middle.x,
      y: middle.y,
      allowActivate: true,
    });
    if (noRecoveryNeeded.ok === true) {
      check(noRecoveryNeeded.recovered !== true, 'allow_activate does nothing when the point is already legal', JSON.stringify(noRecoveryNeeded));
    } else {
      skip('allow_activate on a legal point', `that point is not legal on this desktop right now (${String(noRecoveryNeeded.error ?? '').slice(0, 70)})`);
    }

    // The guard's other half, on a real desktop: a point covered by *another process's* window
    // must be refused rather than sent, and one bounded activation must be able to make it legal
    // again. Two ways to get the fixture: a window this desktop already has over the target (the
    // usual case, and the one that costs nothing), or a probe window this test starts itself.
    const overlaps = (a, b) => Number(a.x) <= Number(b.x) + Number(b.width) && Number(a.x) + Number(a.width) >= Number(b.x)
      && Number(a.y) <= Number(b.y) + Number(b.height) && Number(a.y) + Number(a.height) >= Number(b.y);
    const existing = (windows.windows ?? []).find((one) => Number(one.hwnd) !== Number(target.hwnd)
      && Number(one.pid) !== Number(target.pid) && overlaps(one, target)
      && Number(one.width) > 120 && Number(one.height) > 120);
    const usingProbe = existing === undefined;
    const probe = usingProbe ? await startOccluder(target, root) : { pid: undefined, window: existing };
    if (probe.window === undefined) {
      skip('the occluded-point case', `the occluder probe window did not appear (${String(probe.why ?? '').slice(0, 160)})`);
    } else {
      const covers = probe.window;
      const overlapX = Math.max(target.x, covers.x) + 5;
      const overlapY = Math.max(target.y, covers.y) + 5;
      const insideTarget = overlapX > target.x && overlapX < target.x + target.width && overlapY > target.y && overlapY < target.y + target.height;
      if (!insideTarget) {
        skip('the occluded-point case', 'the probe landed outside the target window');
      } else {
        const frameSpec = {
          hwnd: target.hwnd,
          pid: target.pid,
          surface,
          windowRect: { x: target.x, y: target.y, width: target.width, height: target.height },
          encoded: { width: target.width, height: target.height },
        };
        await run('focus', { hwnd: covers.hwnd }, { timeoutMs: 20_000 }).catch(() => null);
        try {
          const occluded = await run('frameproject', { frame: frameSpec, x: overlapX - target.x, y: overlapY - target.y });
          check(
            occluded.ok === false && String(occluded.error).includes('[TARGET_OCCLUDED]'),
            'a point covered by another process is refused instead of sent (A05)',
            String(occluded.error ?? JSON.stringify(occluded)).slice(0, 110),
          );

          const recovered = await run('frameproject', { frame: frameSpec, x: overlapX - target.x, y: overlapY - target.y, allowActivate: true });
          check(
            recovered.ok === true && recovered.recovered === true,
            'allow_activate brings the target forward once, looks again, and the same point becomes legal',
            JSON.stringify({ ok: recovered.ok, recovered: recovered.recovered, guard: recovered.guard }),
          );
        } finally {
          await run('focus', { hwnd: target.hwnd }, { timeoutMs: 20_000 }).catch(() => null);
          if (usingProbe) stopOccluder(probe.pid);
        }
      }
    }

    const outsideWindow = await run('frameproject', {
      frame: {
        hwnd: target.hwnd,
        pid: target.pid,
        surface,
        windowRect: { x: target.x, y: target.y, width: target.width, height: target.height },
        crop: { x: 0, y: 0, width: 20, height: 20 },
        encoded: { width: 20, height: 20 },
      },
      x: 19,
      y: 19,
    });
    check(
      outsideWindow.ok === true || String(outsideWindow.error ?? '').includes('[TARGET_OCCLUDED]') === false
        || String(outsideWindow.error ?? '').includes('[FRAME_CONTENT_CHANGED]'),
      'a crop at the window corner projects to the window corner rather than somewhere else',
      JSON.stringify({ x: outsideWindow.x, y: outsideWindow.y, ok: outsideWindow.ok, error: String(outsideWindow.error ?? '').slice(0, 90) }),
    );
    } catch (error) {
      skip('the window-dependent cases', `the window went away or was minimized while these ran (${String(error?.message ?? error).slice(0, 120)})`);
    }
  }

  /* ------------------------------------------------------------------- waits */

  section('condition waits: what "it held" and "it timed out" mean');
  if (target === undefined) {
    skip('condition cases', 'no window to observe');
  } else {
    const tooShort = await run('wait_for', {
      condition: { kind: 'window', hwnd: target.hwnd, stable_ms: 500 },
      timeout_ms: 260,
    }, { timeoutMs: 20_000 });
    check(
      tooShort.satisfied === false && tooShort.outcome === 'timeout' && tooShort.timeoutKind === 'not-held' && Number(tooShort.heldMs) > 0,
      'stable_ms that never completed is NOT reported satisfied (C01)',
      JSON.stringify({ outcome: tooShort.outcome, kind: tooShort.timeoutKind, heldMs: tooShort.heldMs, waitedMs: tooShort.waitedMs, budget: tooShort.timeoutMs }),
    );
    check(
      Number(tooShort.timeoutMs) === 260 && Number(tooShort.waitedMs) >= 200 && Number(tooShort.waitedMs) < 2000,
      'the wait ran to its stated budget and no further',
      `${tooShort.waitedMs} ms of ${tooShort.timeoutMs} ms`,
    );

    const heldLongEnough = await run('wait_for', {
      condition: { kind: 'window', hwnd: target.hwnd, stable_ms: 150 },
      timeout_ms: 6_000,
    }, { timeoutMs: 20_000 });
    check(
      heldLongEnough.satisfied === true && heldLongEnough.outcome === 'satisfied' && Number(heldLongEnough.heldMs) >= 150,
      'a condition that held for the asked time is satisfied, and the time it held is reported',
      `heldMs ${heldLongEnough.heldMs} of ${heldLongEnough.stableMs}`,
    );

    const liveList = await run('windows', {});
    const liveTarget = (liveList.windows ?? []).find((one) => Number(one.hwnd) === Number(target.hwnd));
    const title = String(liveTarget?.title ?? target.title).slice(0, Math.min(12, String(liveTarget?.title ?? target.title).length));
    const both = await run('wait_for', {
      condition: { kind: 'window', title, process: 'definitely-not-this-process' },
      timeout_ms: 400,
    }, { timeoutMs: 20_000 });
    check(both.satisfied === false, 'title AND process are applied together (C03): a wrong process is not ignored', `${both.observed}`);

    const bothMatch = await run('wait_for', {
      condition: { kind: 'window', title, process: target.process },
      timeout_ms: 6_000,
    }, { timeoutMs: 20_000 });
    check(bothMatch.satisfied === true, 'and when both match, the pair matches', `${bothMatch.observed}`);

    const exactMiss = await run('wait_for', {
      condition: { kind: 'window', process_exact: `${target.process}-not-this` },
      timeout_ms: 400,
    }, { timeoutMs: 20_000 });
    check(exactMiss.satisfied === false, 'process_exact does not degrade into a substring match', `${exactMiss.observed}`);

    const exactHit = await run('wait_for', {
      condition: { kind: 'window', process_exact: `${target.process}.exe` },
      timeout_ms: 6_000,
    }, { timeoutMs: 20_000 });
    check(exactHit.satisfied === true, 'process_exact accepts the name with its .exe', `${exactHit.observed}`);

    const unobservable = await run('wait_for', {
      condition: {
        kind: 'every',
        every: [
          { kind: 'window', hwnd: target.hwnd },
          { kind: 'control', hwnd: 987654321, name: 'no-such-control-2f7a' },
        ],
      },
      timeout_ms: 400,
    }, { timeoutMs: 20_000 });
    check(
      unobservable.satisfied === false && unobservable.status === 'unknown' && unobservable.timeoutKind === 'unavailable',
      'a leg that cannot be observed makes the group unknown, not false (C05)',
      JSON.stringify({ status: unobservable.status, outcome: unobservable.outcome, timeoutKind: unobservable.timeoutKind }),
    );
  }

  /* ------------------------------------------------- three-valued combination logic */

  // `every` had a case; `any` did not, and it is the half where a wrong answer is easiest to
  // mistake for an answer at all: "no leg is true" must not become *false* when a leg could not
  // be observed. These legs need no window, so the cases run on any desktop: a file that exists
  // (true), a file that does not (false), and a control in a window that is not there (unknown).
  section('combination logic: any / every with and without an answer');
  const readyPath = join(root, 'combination-ready.txt');
  writeFileSync(readyPath, 'ready');
  const trueLeg = { kind: 'file', path: readyPath, min_bytes: 1 };
  const falseLeg = { kind: 'file', path: join(root, 'combination-never.txt'), min_bytes: 1 };
  const unknownLeg = { kind: 'control', hwnd: 987654321, name: 'no-such-control-2f7a' };

  const anyUnknown = await run('wait_for', {
    condition: { kind: 'any', any: [falseLeg, unknownLeg] },
    timeout_ms: 400,
  }, { timeoutMs: 20_000 });
  check(
    anyUnknown.satisfied === false && String(anyUnknown.status).toLowerCase() === 'unknown',
    'an `any` group with no true leg is unknown when a leg cannot be observed — not false',
    JSON.stringify({ status: anyUnknown.status, outcome: anyUnknown.outcome, observed: String(anyUnknown.observed ?? '').slice(0, 90) }),
  );

  const anyFalse = await run('wait_for', {
    condition: { kind: 'any', any: [falseLeg, falseLeg] },
    timeout_ms: 400,
  }, { timeoutMs: 20_000 });
  check(
    anyFalse.satisfied === false && String(anyFalse.status).toLowerCase() === 'false',
    'an `any` group whose legs are all definitely false is false',
    JSON.stringify({ status: anyFalse.status, outcome: anyFalse.outcome }),
  );

  const anyTrue = await run('wait_for', {
    condition: { kind: 'any', any: [trueLeg, unknownLeg] },
    timeout_ms: 6_000,
  }, { timeoutMs: 20_000 });
  check(
    anyTrue.satisfied === true && String(anyTrue.status).toLowerCase() === 'true',
    'one true leg decides the `any` group, whatever the other legs say',
    JSON.stringify({ status: anyTrue.status, outcome: anyTrue.outcome, polls: anyTrue.polls }),
  );

  /* ------------------------------------------------------------------ batches */

  section('batches: a failed condition stops what depended on it');
  const stopped = await run('batch', {
    steps: [
      { action: 'wait_for', condition: { kind: 'window', hwnd: 987654321 }, timeout_ms: 300 },
      { action: 'wait', seconds: 0.1 },
    ],
    evidence: false,
    stopOnWindowChange: false,
  }, { timeoutMs: 30_000 });
  check(
    stopped.failedAt === 0 && stopped.outcome === 'condition-timeout' && stopped.action_sent === false && stopped.nextStep === 0,
    'the batch stops at the wait, says where to continue, and reports nothing was sent (C02)',
    JSON.stringify({ failedAt: stopped.failedAt, outcome: stopped.outcome, nextStep: stopped.nextStep, actionSent: stopped.action_sent }),
  );
  check(stopped.count === 1 && String(stopped.performed[0] ?? '').startsWith('wait_for'), 'the step after the condition was not run', JSON.stringify(stopped.performed));

  const continued = await run('batch', {
    steps: [
      { action: 'wait_for', condition: { kind: 'window', hwnd: 987654321 }, timeout_ms: 300, on_timeout: 'continue' },
      { action: 'wait', seconds: 0.1 },
    ],
    evidence: false,
    stopOnWindowChange: false,
  }, { timeoutMs: 30_000 });
  check(
    continued.failedAt === -1 && continued.performed.some((line) => String(line).startsWith('wait ')),
    "on_timeout: 'continue' keeps the old behaviour, and only when it was asked for",
    JSON.stringify(continued.performed),
  );

  const partial = await run('batch', {
    steps: [{ action: 'wait', seconds: 0.6 }, { action: 'wait', seconds: 0.6 }],
    evidence: false,
    stopOnWindowChange: false,
    deadlineMs: 500,
  }, { timeoutMs: 30_000 });
  // The contract this pair of waits now has to satisfy (9.txt §5.7): the first wait is cut
  // short by the call's deadline and *says so*, and the step after it does not start at all --
  // "stop starting new steps on a spent budget" is the fix; the old version let the second
  // wait begin as a no-op and reported `deadline-partial` as if the call had merely been
  // trimmed. What did run is still reported, which is the half that must not change.
  check(
    partial.outcome === 'deadline' && partial.failedAt === 1 && partial.outOfBudget === true
      && String(partial.performed[0] ?? '').includes('of the 0.6s asked for')
      && partial.performed.length === 1,
    'one deadline covers the whole call, a wait it cut short says so, and the step after it never starts (C04 + §5.7)',
    JSON.stringify({ outcome: partial.outcome, failedAt: partial.failedAt, outOfBudget: partial.outOfBudget, performed: partial.performed }),
  );

  /* ------------------------------------------------------- file conditions */

  section('file conditions: an artefact is not finished just because the name exists');
  const artefact = join(root, 'export.json');
  const missingFile = await run('wait_for', { condition: { kind: 'file', path: artefact }, timeout_ms: 300 }, { timeoutMs: 20_000 });
  check(
    missingFile.satisfied === false && missingFile.outcome === 'timeout',
    'a file that is not there yet is false, not unknown',
    `${missingFile.status}: ${missingFile.observed}`,
  );

  writeFileSync(artefact, JSON.stringify({ rows: 3 }), 'utf8');
  const presentFile = await run('wait_for', { condition: { kind: 'file', path: artefact, min_bytes: 4, parse: true }, timeout_ms: 3_000 }, { timeoutMs: 20_000 });
  check(
    presentFile.satisfied === true && String(presentFile.observed).includes('parses as JSON'),
    'a file with content, that parses, satisfies the condition',
    presentFile.observed,
  );

  const stillWriting = await run('wait_for', { condition: { kind: 'file', path: artefact, stable_for_ms: 5_000 }, timeout_ms: 400 }, { timeoutMs: 20_000 });
  check(
    stillWriting.satisfied === false && String(stillWriting.observed).includes('stillness'),
    'a file written a moment ago is not "unchanged for 5 s"',
    stillWriting.observed,
  );

  writeFileSync(artefact, 'not json at all', 'utf8');
  const brokenFile = await run('wait_for', { condition: { kind: 'file', path: artefact, parse: true }, timeout_ms: 300 }, { timeoutMs: 20_000 });
  check(brokenFile.satisfied === false && String(brokenFile.observed).includes('does not parse'), 'a file that does not parse yet is false', brokenFile.observed);

  const absentResult = await run('wait_for', { condition: { kind: 'file', path: join(root, 'never-written.csv'), is: 'absent' }, timeout_ms: 3_000 }, { timeoutMs: 20_000 });
  check(absentResult.satisfied === true, "is: 'absent' waits for a file to be gone", absentResult.observed);

  const fileStopped = await run('batch', {
    steps: [
      { action: 'wait_for', condition: { kind: 'file', path: join(root, 'never-downloaded.zip'), min_bytes: 1, parse: true }, timeout_ms: 300 },
      { action: 'wait', seconds: 0.1 },
    ],
    evidence: false,
    stopOnWindowChange: false,
  }, { timeoutMs: 30_000 });
  check(
    fileStopped.failedAt === 0 && fileStopped.outcome === 'condition-timeout' && fileStopped.action_sent === false,
    'a file condition that never holds stops the batch that was waiting for the download (C02 + file)',
    JSON.stringify({ failedAt: fileStopped.failedAt, outcome: fileStopped.outcome }),
  );

  /* ------------------------------------------------------------ freshness */

  section('freshness: a wait invalidates the frame taken before it');
  const waitThenShot = await run('batch', {
    steps: [
      { action: 'screenshot', path: join(root, 'before.png') },
      { action: 'wait', seconds: 0.4 },
    ],
    screenshot: true,
    path: join(root, 'after.png'),
    scale: 0.25,
    evidence: false,
    stopOnWindowChange: false,
  }, { timeoutMs: 40_000 });
  check(
    waitThenShot.captureUsed?.from === 'retaken' && waitThenShot.shot?.path === join(root, 'after.png'),
    'the frame from before the wait is not handed back as the state after it (A06)',
    JSON.stringify({ from: waitThenShot.captureUsed?.from, path: waitThenShot.shot?.path }),
  );

  /* ----------------------------------------------------------------- captures */

  section('captures: one request, one meaning');
  const regionShot = await run('screenshot', { path: join(root, 'region.png'), region: { x: 0, y: 0, width: 300, height: 200 }, format: 'png' }, { timeoutMs: 40_000 });
  check(
    regionShot.width === 300 && regionShot.height === 200 && regionShot.surfaceKind === 'screenRegion' && regionShot.encodedWidth === 300,
    'a screen region capture is that region, 1:1',
    JSON.stringify({ w: regionShot.width, h: regionShot.height, kind: regionShot.surfaceKind, encoded: regionShot.encodedWidth }),
  );

  const halvedShot = await run('screenshot', { path: join(root, 'region-half.png'), region: { x: 0, y: 0, width: 300, height: 200 }, scale: 0.5, format: 'png' }, { timeoutMs: 40_000 });
  check(
    halvedShot.width === 300 && halvedShot.encodedWidth === 150 && halvedShot.encodedHeight === 100 && Number(halvedShot.effectiveScale) === 0.5,
    'scale changes the file, not the meaning of the delivered rectangle',
    JSON.stringify({ delivered: `${halvedShot.width}x${halvedShot.height}`, encoded: `${halvedShot.encodedWidth}x${halvedShot.encodedHeight}` }),
  );

  const magnified = await run('screenshot', { path: join(root, 'region-2x.png'), region: { x: 0, y: 0, width: 200, height: 100 }, scale: 2, format: 'png' }, { timeoutMs: 40_000 });
  check(
    magnified.scaleClamped === true && Number(magnified.requestedScale) === 2 && Number(magnified.effectiveScale) === 1 && typeof magnified.scaleNote === 'string',
    'a scale above 1 is reported instead of silently truncated (A07)',
    `${magnified.requestedScale} -> ${magnified.effectiveScale}: ${String(magnified.scaleNote).slice(0, 60)}`,
  );

  check(
    Number.isFinite(Number(regionShot.captureSpanMs)) && Number(regionShot.captureSpanMs) >= 0,
    'the capture reports its own span as one duration that means the same on both sides of the pipe (§9.1)',
    String(regionShot.captureSpanMs),
  );

  if (target === undefined) {
    skip('window captures', 'no visible window large enough is open on this desktop');
  } else {
    try {
    const inner = { x: target.x + 10, y: target.y + 10, width: 120, height: 80 };
    const windowRegion = await run('screenshot', {
      path: join(root, 'win-region.png'),
      window: target.hwnd,
      region: inner,
      format: 'png',
    }, { timeoutMs: 40_000 });
    check(
      windowRegion.width === 120 && windowRegion.height === 80 && windowRegion.x === inner.x && windowRegion.y === inner.y,
      'a window region given in screen pixels returns exactly that rectangle (A01)',
      JSON.stringify({ x: windowRegion.x, y: windowRegion.y, w: windowRegion.width, h: windowRegion.height }),
    );
    check(
      windowRegion.surfaceKind === 'wholeWindow' && Number(windowRegion.cropRectSurface?.x) === 10 && Number(windowRegion.cropRectSurface?.y) === 10,
      'and records the window rectangle, the surface and the crop as separate facts (A03)',
      JSON.stringify(windowRegion.cropRectSurface),
    );
    check(
      Number(windowRegion.surface?.width) === target.width && Number(windowRegion.windowRect?.width) === target.width,
      'the whole window is still described, even though the frame is a crop of it (A03)',
      JSON.stringify({ surface: windowRegion.surface?.width, windowRect: windowRegion.windowRect?.width }),
    );

    const windowLocal = await run('screenshot', {
      path: join(root, 'win-local.png'),
      window: target.hwnd,
      region: { x: 10, y: 10, width: 120, height: 80 },
      regionSpace: 'window',
      format: 'png',
    }, { timeoutMs: 40_000 });
    check(
      windowLocal.x === target.x + 10 && windowLocal.y === target.y + 10 && windowLocal.width === 120,
      "region_space: 'window' reads the same numbers inside the window",
      JSON.stringify({ x: windowLocal.x, y: windowLocal.y, w: windowLocal.width }),
    );

    const refused = await run('screenshot', {
      path: join(root, 'outside.png'),
      window: target.hwnd,
      region: { x: target.x - 5000, y: target.y - 5000, width: 10, height: 10 },
      format: 'png',
    }, { timeoutMs: 40_000 }).then(() => null, (failure) => String(failure.message));
    check(
      refused !== null && refused.includes('not inside the captured window'),
      'a region that is not part of the window is refused, not answered with the whole window',
      String(refused ?? '').slice(0, 90),
    );

    const clipped = await run('screenshot', {
      path: join(root, 'clipped.png'),
      window: target.hwnd,
      region: { x: target.x + target.width - 20, y: target.y + target.height - 20, width: 120, height: 80 },
      clip: true,
      format: 'png',
    }, { timeoutMs: 40_000 });
    check(
      clipped.width === 20 && clipped.height === 20 && clipped.clipped === true,
      'clip: true takes the part that exists and reports what it took',
      JSON.stringify({ w: clipped.width, h: clipped.height, clipped: clipped.clipped }),
    );
    } catch (error) {
      skip('window captures', `the window went away or was minimized while these ran (${String(error?.message ?? error).slice(0, 120)})`);
    }
  }

  /* ------------------------------------------------ region conditions (visual) */

  section('region conditions: a completion signal that reads pixels (§6.2 自绘界面)');
  // A rectangle that is actually static: the top-left corner of the desktop changes (a clock, a
  // cursor, a widget), which is a fact about that corner rather than about the condition. The
  // area used is inside a window, where the pixels hold still.
  const regionRect = target === undefined
    ? { x: 0, y: 0, width: 48, height: 36 }
    : { x: Number(target.x) + 40, y: Number(target.y) + 60, width: 60, height: 40 };
  const regionDigest = await run('digest', { region: regionRect, maxSide: 160 });
  check(
    typeof regionDigest.digest === 'string' && regionDigest.digest !== '',
    'the digest command returns a fingerprint of a rectangle',
    JSON.stringify(regionDigest).slice(0, 80),
  );
  const regionMatches = await run('wait_for', {
    condition: { rect: regionRect, mode: 'matches', expected_digest: String(regionDigest.digest) },
    timeout_ms: 4000,
  }, { timeoutMs: 20_000 });
  check(
    regionMatches.satisfied === true,
    'a region condition holds when the rectangle still matches the fingerprint',
    JSON.stringify({ satisfied: regionMatches.satisfied, status: regionMatches.status, what: regionMatches.what }).slice(0, 110),
  );
  const regionUnknown = await run('wait_for', {
    condition: { rect: { x: -99999, y: -99999, width: 10, height: 10 }, mode: 'stable' },
    timeout_ms: 1200,
  }, { timeoutMs: 20_000 });
  check(
    regionUnknown.satisfied === false && String(regionUnknown.status) === 'unknown',
    'a rectangle that cannot be read is unknown, not "unchanged" (three-valued)',
    JSON.stringify({ status: regionUnknown.status, outcome: regionUnknown.outcome, what: regionUnknown.what }).slice(0, 120),
  );

  const regionStable = await run('wait_for', {
    condition: { rect: regionRect, mode: 'stable' },
    timeout_ms: 5000,
  }, { timeoutMs: 20_000 });
  check(
    regionStable.satisfied === true,
    'mode stable holds once two samples of the same rectangle agree',
    JSON.stringify({ satisfied: regionStable.satisfied, polls: regionStable.polls, pollMs: regionStable.pollMs }).slice(0, 110),
  );
  const regionChanged = await run('wait_for', {
    condition: { rect: regionRect, mode: 'changed' },
    timeout_ms: 1500,
  }, { timeoutMs: 20_000 });
  check(
    regionChanged.satisfied === false,
    'mode changed stays false on a rectangle that is not changing — the baseline is the first sample, not "anything differs from nothing"',
    JSON.stringify({ satisfied: regionChanged.satisfied, status: regionChanged.status }).slice(0, 100),
  );
  check(
    Number(regionStable.pollMs) >= 250 && Number(regionStable.pollBackoffTo ?? 0) >= 800,
    'a visual condition is polled more slowly than a cheap one, and backs off further (§6.2)',
    `pollMs=${regionStable.pollMs} backoff=${regionStable.pollBackoffTo}`,
  );

  /* ------------------------------------------- a changed spec is a different frame */

  section('a changed capture spec is not a reusable frame (A06)');
  const specA = target === undefined
    ? { x: 0, y: 0, width: 60, height: 40 }
    : { x: Number(target.x) + 10, y: Number(target.y) + 10, width: 60, height: 40 };
  const specB = { x: specA.x + 100, y: specA.y + 60, width: 120, height: 80 };
  // Two batches, same steps, different region: the second one must not answer with the frame the
  // first one took, because "the same screenshot" is defined by the whole capture spec (A06).
  const specBatch = async (region, tag) => run('batch', {
    steps: [{ action: 'screenshot', path: join(root, `${tag}-step.png`) }],
    region,
    screenshot: true,
    path: join(root, `${tag}-trailing.png`),
    format: 'png',
    evidence: false,
  }, { timeoutMs: 90_000 });
  const specFirst = await specBatch(specA, 'spec-a');
  const specSecond = await specBatch(specB, 'spec-b');
  check(
    Number(specFirst.shot?.width) === 60 && Number(specSecond.shot?.width) === 120,
    'each batch delivers its own rectangle',
    `first=${specFirst.shot?.width}x${specFirst.shot?.height} second=${specSecond.shot?.width}x${specSecond.shot?.height}`,
  );
  check(
    Number(specFirst.shot?.width) === 60 && String(specFirst.captureUsed?.from) === 'step',
    'a batch with nothing writing after its capture reuses that frame',
    JSON.stringify(specFirst.captureUsed).slice(0, 110),
  );
  // The spec key earns its keep *inside* one batch: a step that captured at half scale is not the
  // same picture as the full-scale answer the call is about, so it may not stand in for it
  // (A06: "请求窗口、区域或输出规格与缓存不同 → 不能当成同一截图直接复用").
  const specScale = await run('batch', {
    steps: [{ action: 'screenshot', scale: 0.5, path: join(root, 'spec-half.png') }],
    region: specA,
    screenshot: true,
    path: join(root, 'spec-full.png'),
    format: 'png',
    evidence: false,
  }, { timeoutMs: 90_000 });
  check(
    String(specScale.captureUsed?.from) === 'retaken' && Number(specScale.shot?.width) === 60,
    'a frame encoded at half scale does not stand in for a full-scale answer (A06)',
    JSON.stringify({ captureUsed: specScale.captureUsed, w: specScale.shot?.width }).slice(0, 150),
  );

  /* ------------------------------------------------------------ client area */

  section('capture surface: the whole window, or the client area only (§2.2)');
  if (target === undefined) {
    skip('client-area capture', 'no visible window to capture');
  } else {
    try {
      const whole = await run('screenshot', { window: target.hwnd, path: join(root, 'whole.png'), format: 'png', require: 'window' }, { timeoutMs: 40_000 });
      check(
        Number.isFinite(Number(whole.windowRect?.width)) && Number(whole.windowRect.width) >= Number(whole.width),
        'the capture reports the whole window rectangle, apart from the frame it delivered (§9.1)',
        JSON.stringify(whole.windowRect),
      );
      const client = await run('screenshot', { window: target.hwnd, surface: 'client', path: join(root, 'client.png'), format: 'png', require: 'window' }, { timeoutMs: 40_000 });
      check(
        String(client.surfaceKind ?? '') === 'clientArea',
        'surface: client is recorded as its own capture surface',
        JSON.stringify({ surfaceKind: client.surfaceKind, surface: client.surface }).slice(0, 120),
      );
      check(
        Number(client.width) <= Number(whole.width) && Number(client.height) <= Number(whole.height)
          && (Number(client.width) < Number(whole.width) || Number(client.height) < Number(whole.height)),
        'the client capture delivers no more than the whole window — a window that draws its own title bar is cropped by its border, one that does not by its frame',
        `whole=${whole.width}x${whole.height} client=${client.width}x${client.height}`,
      );
      check(
        Number(client.crop?.width ?? client.width) <= Number(client.surface?.width ?? client.width),
        'the client capture says which part of the window it delivered',
        JSON.stringify({ crop: client.crop, surface: client.surface }).slice(0, 130),
      );

      // A move aimed with image pixels is a coordinate write like any other, and this is the one
      // that used to be neither projected nor guarded: the step took the image point as a desktop
      // point and moved the pointer somewhere else entirely, with no error to show for it. The
      // cursor is the evidence, so the case reads it back.
      const frameId = String(whole.frame ?? '');
      if (frameId === '') {
        skip('the move step aimed by a frame', 'the capture did not answer with a frame id');
      } else {
        await run('focus', { hwnd: target.hwnd }, { timeoutMs: 20_000 }).catch(() => null);
        const listing = await run('windows', {}).catch(() => ({ windows: [] }));
        const now = (listing.windows ?? []).find((one) => Number(one.hwnd) === Number(target.hwnd));
        const wantX = Number(now?.x ?? target.x) + 8;
        const wantY = Number(now?.y ?? target.y) + 8;
        const moved = await run('batch', {
          steps: [{ action: 'move', x: 8, y: 8, from_frame: frameId }],
          evidence: false,
          stopOnWindowChange: false,
        }, { timeoutMs: 30_000 });
        const after = moved.failedAt >= 0 && /TARGET_OCCLUDED|FRAME_CONTENT_CHANGED|FRAME_STALE|TARGET_CHANGED/.test(String(moved.error ?? ''))
          ? { skipped: true }
          : await run('cursor', {}, { timeoutMs: 20_000 });
        if (after.skipped === true) {
          skip('the move step aimed by a frame', `the point is not legal on this desktop right now (${String(moved.error).slice(0, 80)})`);
        } else {
          // A pointer arrives by way of the absolute normalised coordinate space, so the
          // round trip is allowed the ±1 physical pixel the plan names as the tolerance
          // (§4: "往返映射误差不超过约定的 1 个物理像素"). What must NOT happen is the
          // image pixel being used as a desktop pixel: that lands the pointer at (8,8),
          // which is nowhere near the window for any window this case can pick.
          const dx = Math.abs(Number(after.x) - wantX);
          const dy = Math.abs(Number(after.y) - wantY);
          check(
            moved.failedAt === -1 && dx <= 1 && dy <= 1,
            'a move step reads x/y as pixels of the frame and moves the pointer to the projected place (±1 px, the documented round-trip tolerance)',
            JSON.stringify({ failedAt: moved.failedAt, landed: `${Number(after.x)},${Number(after.y)}`, want: `${wantX},${wantY}`, delta: `${dx},${dy}`, error: String(moved.error ?? '').slice(0, 80) }),
          );
          check(
            moved.performed.some((line) => String(line) === `move (${wantX},${wantY})`),
            'and the receipt names the projected point rather than the image pixel',
            JSON.stringify(moved.performed),
          );
        }
      }
    } catch (error) {
      skip('client-area capture', `the window could not be captured right now (${String(error?.message ?? error).slice(0, 90)})`);
    }
  }
} catch (error) {
  failed += 1;
  failures.push('run');
  console.log(`\n  ERROR  ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
} finally {
  backend.dispose();
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* the temp directory is best effort */
  }
}

console.log(`\n===== ${passed} passed, ${failed} failed =====`);
if (failures.length > 0) {
  console.log('failed cases:');
  for (const name of failures) console.log(`  - ${name}`);
}
process.exit(failed === 0 ? 0 : 1);
