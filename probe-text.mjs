/**
 * Probe: which real windows expose TextPattern (and ScrollItemPattern)?
 *
 * `computer_ui_action`'s `get_text` / `select_text` / `scroll_into_view` only work
 * where the provider implements those patterns, and that differs per app and per
 * control type — Win11 Notepad's editor answers TextPattern but not, say, a plain
 * Win32 list. This walks the visible windows and reports what each one offers, so
 * the tool descriptions stay honest about which apps they cover.
 *
 *   node probe-text.mjs
 */
import { PowerShellBackend } from './backend/bridge.js';

const backend = new PowerShellBackend({ timeoutMs: 60_000 });

try {
  await backend.start();
  const windows = await backend.request('windows', {});
  const interesting = windows.windows.filter((w) => w.width > 300 && w.height > 200).slice(0, 8);
  for (const window of interesting) {
    console.log(`\n### ${window.process} "${window.title}" hwnd=${window.hwnd} ${window.width}x${window.height}`);
    let tree;
    try {
      tree = await backend.request('uitree', { hwnd: window.hwnd, maxNodes: 400, maxDepth: 8, patterns: true }, { timeoutMs: 60_000 });
    } catch (error) {
      console.log(`  uitree failed: ${error.message}`);
      continue;
    }
    const withText = tree.nodes.filter((n) => n.patterns.includes('text'));
    const withValue = tree.nodes.filter((n) => n.patterns.includes('value'));
    const withScroll = tree.nodes.filter((n) => n.patterns.includes('scroll_item'));
    console.log(`  nodes=${tree.nodes.length} truncated=${tree.truncated} skipped=${tree.skipped} text=${withText.length} value=${withValue.length} scroll_item=${withScroll.length}`);
    for (const node of withText.slice(0, 4)) {
      console.log(`   [text] ${node.controlType.replace('ControlType.', '')} "${node.name}" #${node.automationId} ${node.x},${node.y} ${node.width}x${node.height}`);
    }
    if (withText.length > 0) {
      const target = withText[0];
      const read = await backend.request('uiact', {
        action: 'get_text',
        hwnd: window.hwnd,
        controlType: target.controlType.replace('ControlType.', ''),
        name: target.name || undefined,
      }, { timeoutMs: 60_000 }).catch((error) => ({ value: `ERROR ${error.message}` }));
      console.log(`   get_text -> ${JSON.stringify(String(read.value).slice(0, 120))}`);
    }
  }
  await backend.request('shutdown', {});
} catch (error) {
  console.error('PROBE CRASHED:', error);
  process.exitCode = 1;
} finally {
  backend.dispose();
  setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref();
}
