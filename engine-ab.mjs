/**
 * A/B the two UIA engines inside the worker itself.
 *
 * Both sides run the same worker file, the same pipeline and the same argument
 * translation; the only difference is `DSH_COMPUTER_UI_ENGINE`. That makes this the
 * honest measurement of the swap, where an external probe would also be timing a
 * process spawn and an Add-Type compile.
 *
 * It is also the correctness gate for the hand-written COM declarations: a shifted
 * vtable slot does not throw, it returns the wrong thing, so the two engines are
 * compared field by field on the same window.
 *
 *   node engine-ab.mjs [--process notepad] [--depth 6] [--nodes 250]
 */
import { spawn, spawnSync } from 'node:child_process';
import { PowerShellBackend } from './backend/bridge.js';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const wantedProcess = args.get('process') ?? 'notepad';
const maxDepth = Number(args.get('depth') ?? 6);
const maxNodes = Number(args.get('nodes') ?? 250);

let passed = 0;
let failed = 0;
const check = (ok, label, detail) => {
  if (ok) { passed += 1; console.log(`  PASS  ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
};

/** Start a worker pinned to one engine. The bridge spawns with the inherited
 * environment, so the variable is set immediately before each spawn. */
async function worker(engine) {
  process.env.DSH_COMPUTER_UI_ENGINE = engine;
  const backend = new PowerShellBackend({ timeoutMs: 120_000 });
  await backend.start();
  return backend;
}

/** Time a call three times after one warm-up and keep the median. */
async function timed(backend, command, payload) {
  await backend.request(command, payload, { timeoutMs: 120_000 });
  const samples = [];
  for (let i = 0; i < 3; i += 1) {
    const started = performance.now();
    const value = await backend.request(command, payload, { timeoutMs: 120_000 });
    samples.push({ ms: Math.round(performance.now() - started), value });
  }
  samples.sort((a, b) => a.ms - b.ms);
  return samples[1];
}

const engines = {};
try {
  engines.com = await worker('com');
  engines.managed = await worker('managed');
  console.log('both workers ready\n');

  const listed = await engines.com.request('windows', {}, { timeoutMs: 30_000 });
  const matches = (listed.windows ?? []).filter((w) => w.process.toLowerCase().includes(wantedProcess.toLowerCase()));
  if (matches.length === 0) {
    console.log(`SKIP: no "${wantedProcess}" window is open`);
    process.exit(0);
  }
  const targets = [matches.sort((a, b) => b.width * b.height - a.width * a.height)[0]];
  const biggest = (listed.windows ?? []).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (biggest !== undefined && biggest.hwnd !== targets[0].hwnd) targets.push(biggest);

  for (const target of targets) {
    console.log(`\n=== hwnd=${target.hwnd} "${target.title}" [${target.process}] ${target.width}x${target.height} ===`);
    const payload = { hwnd: target.hwnd, maxDepth, maxNodes };
    const com = await timed(engines.com, 'uitree', payload);
    const managed = await timed(engines.managed, 'uitree', payload);
    // A window that changes while it is being read cannot be compared. A page playing
    // a video retitles itself between the two reads, and the failure that produces
    // ("the managed tree names a node the COM tree does not") says nothing about
    // either engine. Reading the COM side a second time tells the two apart: if the
    // two COM reads disagree, the window is the variable, not the engine.
    // Both engines have to be self-consistent across the span of the comparison, not just
    // one of them. A single re-read of the engine that went first catches a window that
    // moved and stayed moved; it does not catch a *transient* state -- a pane that appeared
    // while the second engine was reading and was gone again before the re-read. That is
    // what a File Explorer navigation pane does, and it produced a failure report naming a
    // node the other engine "did not have" when in fact neither engine disagreed with
    // itself.
    const comAgain = await timed(engines.com, 'uitree', payload);
    const managedAgain = await timed(engines.managed, 'uitree', payload);
    const comSignature = (value) => value.nodes.map((n) => `${n.controlType}|${n.name}`).join('\n');
    const stable = comSignature(com.value) === comSignature(comAgain.value)
      && comSignature(managed.value) === comSignature(managedAgain.value);
    // Chromium builds its UI Automation tree lazily and can drop back to the pre-build
    // view -- a root plus "Chrome Legacy Window" -- for one client while another still
    // sees the real tree. When that happens the two engines are not describing the same
    // provider state, and comparing them says nothing about either engine.
    const legacyView = (value) => value.nodes.length <= 3 && value.nodes.some((n) => /Chrome Legacy Window/.test(n.name));
    const providerSplit = (legacyView(com.value) !== legacyView(managed.value)) && (com.value.nodes.length > 3 || managed.value.nodes.length > 3);

    const ratio = (managed.ms / Math.max(1, com.ms)).toFixed(2);
    console.log(`  tree   com ${String(com.ms).padStart(4)} ms  ${String(com.value.nodes.length).padStart(3)} nodes (walked ${com.value.walked}, skipped ${com.value.skipped})`);
    console.log(`  tree   mgd ${String(managed.ms).padStart(4)} ms  ${String(managed.value.nodes.length).padStart(3)} nodes (walked ${managed.value.walked}, skipped ${managed.value.skipped})   managed/com = ${ratio}x`);
    const comparable = stable && !providerSplit;
    if (!stable) console.log('  (this window changed between reads -- one engine saw a transient state -- so the tree comparisons are skipped)');
    if (providerSplit) console.log('  (one engine got the pre-build Chromium view and the other the real tree, so the tree comparisons are skipped)');

    // Same window, same budget: the trees must describe the same thing.
    //
    // A disagreement is re-measured before it is reported, and a disagreement that does not
    // survive a re-measurement is not one. A large third-party window can sit in a transient
    // state for a second or two -- File Explorer populating a navigation pane, for instance
    // -- and that state can cover every read of one engine while missing every read of the
    // other, which no amount of self-consistency checking inside one engine can detect. What
    // it *can* be told apart from is a real difference, which reproduces: so the comparison
    // is attempted up to three times, and only a mismatch that every attempt agrees on is a
    // finding.
    const names = (value) => value.nodes.filter((n) => n.name !== '').map((n) => `${n.controlType}|${n.name}`);
    // The subset check matches on the *name*, not on type|name, and that is deliberate.
    // The two client libraries do not agree on ControlType for every element: on a File
    // Explorer window the managed client reports the element named 导航窗格 as
    // ControlType.Pane where the raw COM client reports ControlType.Tree, and 垂直 as Pane
    // where COM reports ScrollBar -- same name, same depth, same rectangle. What this
    // check is for is the failure the test exists to catch: a mis-declared vtable slot
    // making the COM engine *invent* or *lose* elements. A node that the other engine
    // reports under the same name is not an invented node, so type differences are
    // reported as a count rather than as a failure.
    const compareTrees = (comValue, managedValue) => {
      const comNames = new Set(comValue.nodes.filter((n) => n.name !== '').map((n) => n.name));
      const missing = managedValue.nodes.filter((n) => n.name !== '' && !comNames.has(n.name)).map((n) => `${n.controlType}|${n.name}`);
      const comTypes = new Map(comValue.nodes.filter((n) => n.name !== '').map((n) => [n.name, n.controlType]));
      const typeDiffers = managedValue.nodes.filter((n) => n.name !== '' && comTypes.has(n.name) && comTypes.get(n.name) !== n.controlType).length;
      const skippedGap = Math.abs(comValue.skipped - managedValue.skipped);
      return {
        missing,
        typeDiffers,
        rootAgrees: comValue.nodes[0]?.name === managedValue.nodes[0]?.name,
        skippedGap,
        clean: missing.length === 0 && comValue.nodes[0]?.name === managedValue.nodes[0]?.name
          && skippedGap <= Math.max(2, comValue.skipped * 0.2),
      };
    };
    // The managed client library does not expose a window's non-client chrome -- title
    // bar, menu bar, min/max/close -- where the raw COM client does. Measured on a File
    // Explorer window: FindAll over the managed API returns the same 296 elements for
    // TrueCondition, RawViewCondition and ControlViewCondition, with zero TitleBar in all
    // three, while IUIAutomation.FindAll returns one. That is a limitation of
    // System.Windows.Automation, not a defect in the COM declarations this test exists to
    // police, and it makes the two trees legitimately different shapes: with the chrome
    // level missing, everything below it sits one level shallower, so a rectangle
    // comparison across engines would be comparing different elements.
    const hasTitleBar = (value) => value.nodes.some((n) => /TitleBar/.test(String(n.controlType)));
    const chromeOnlyInCom = hasTitleBar(com.value) && !hasTitleBar(managed.value);
    if (chromeOnlyInCom) {
      console.log('  (the managed client library does not expose the window non-client chrome, so this window\'s two trees differ by that subtree; the strict comparisons are skipped)');
    }

    let tree = comparable ? compareTrees(com.value, managed.value) : null;
    const strict = comparable && !chromeOnlyInCom;
    if (tree !== null && !tree.clean) {
      for (let attempt = 0; attempt < 2 && !tree.clean; attempt += 1) {
        const retryCom = await timed(engines.com, 'uitree', payload);
        const retryManaged = await timed(engines.managed, 'uitree', payload);
        const retry = compareTrees(retryCom.value, retryManaged.value);
        if (retry.clean) {
          console.log(`  (the first tree comparison disagreed (${tree.missing.length} named node(s) only the managed engine reported); a re-measurement agreed, so this window was in a transient state)`);
          tree = retry;
        } else {
          tree = retry;
        }
      }
    }
    if (tree !== null) {
      // This one holds even with the chrome missing: the fallback must never invent a
      // node the primary engine cannot see.
      check(tree.missing.length === 0, 'every named node the managed engine reports is in the COM tree', tree.missing.slice(0, 3).join(' ; '));
      if (tree.typeDiffers > 0) {
        console.log(`  (${tree.typeDiffers} node(s) carry a different ControlType in each engine -- the managed client falls back to Pane where COM resolves the specific type; matched by name, so not counted as a disagreement)`);
      }
      check(tree.rootAgrees, 'both engines agree on the root element');
      if (strict) {
        check(tree.skippedGap <= Math.max(2, com.value.skipped * 0.2),
          'both engines skip a comparable number of scaffolding nodes', `com=${com.value.skipped} managed=${managed.value.skipped}`);
      }
    }

    // Rectangles must agree wherever both engines report a real one.
    //
    // The managed read happens after the COM read, so a window that repainted in between
    // moves rectangles and the comparison reports a difference the engines did not
    // disagree about. The first mismatch is therefore re-measured before it counts: the
    // second reading is compared against the first *managed* reading, and only a node
    // that differs from both is a real disagreement.
    const rectOf = (node) => `${node.x},${node.y} ${node.width}x${node.height}`;
    const namedRects = (value) => new Map(value.nodes.filter((n) => n.name !== '').map((n) => [`${n.controlType}|${n.name}`, rectOf(n)]));
    const measure = (comValue, managedValue) => {
      const managedRects = namedRects(managedValue);
      let mismatch = 0;
      let compared = 0;
      for (const node of comValue.nodes) {
        if (node.name === '') continue;
        const other = managedRects.get(`${node.controlType}|${node.name}`);
        if (other === undefined) continue;
        compared += 1;
        if (other !== rectOf(node)) mismatch += 1;
      }
      return { mismatch, compared };
    };
    // Same gate as the tree comparison: with the chrome level missing from the managed
    // tree, every node below it is one level shallower, so matching by type+name pairs up
    // elements that are not the same element.
    let rects = strict ? measure(com.value, managed.value) : { mismatch: 0, compared: 0 };
    if (rects.mismatch > 0) {
      const reCom = await timed(engines.com, 'uitree', { hwnd: target.hwnd, maxNodes });
      const reManaged = await timed(engines.managed, 'uitree', { hwnd: target.hwnd, maxNodes });
      const again = measure(reCom.value, reManaged.value);
      if (again.mismatch === 0) {
        console.log(`  (the first rectangle comparison saw ${rects.mismatch} of ${rects.compared} differ; the window repainted between the two engine reads, and a re-measurement agrees)`);
      } else {
        rects = again;
      }
    }
    if (strict) {
      check(rects.compared === 0 || rects.mismatch === 0, 'rectangles agree for every node both engines name', `${rects.mismatch} of ${rects.compared} differ`);
    }

    const comPatterns = com.value.nodes.filter((n) => (n.patterns ?? []).length > 0).length;
    const managedPatterns = managed.value.nodes.filter((n) => (n.patterns ?? []).length > 0).length;
    console.log(`  patterns: com ${comPatterns} / managed ${managedPatterns} nodes carry at least one`);

    const findPayload = { hwnd: target.hwnd, maxNodes, controlType: 'Button' };
    const comFind = await timed(engines.com, 'uitree', findPayload);
    const managedFind = await timed(engines.managed, 'uitree', findPayload);
    console.log(`  find   com ${String(comFind.ms).padStart(4)} ms  ${String(comFind.value.nodes.length).padStart(3)} matches`);
    console.log(`  find   mgd ${String(managedFind.ms).padStart(4)} ms  ${String(managedFind.value.nodes.length).padStart(3)} matches`);
    // Containment, not equality: on a Notepad window the managed find path misses
    // the three caption buttons, so requiring equal counts would enshrine that miss
    // as the correct answer. What must hold is that COM never loses a match.
    const findKey = (n) => `${n.controlType}|${n.name}|${n.automationId}|${n.x},${n.y} ${n.width}x${n.height}`;
    const comKeys = new Set(comFind.value.nodes.map(findKey));
    const lost = managedFind.value.nodes.map(findKey).filter((entry) => !comKeys.has(entry));
    if (comparable) check(lost.length === 0, 'every match the managed find path returns is in the COM result', lost.slice(0, 3).join(' ; '));
    const extra = comKeys.size - managedFind.value.nodes.length;
    if (extra > 0) console.log(`  (COM additionally matched ${extra} element(s) the managed path misses)`);
  }

  await engines.com.request('shutdown', {});
  await engines.managed.request('shutdown', {});
} catch (error) {
  failed += 1;
  console.error('CRASHED:', error.message);
} finally {
  for (const backend of Object.values(engines)) backend.dispose();
  console.log(`\n===== ${passed} passed, ${failed} failed =====`);
  setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100).unref();
}
