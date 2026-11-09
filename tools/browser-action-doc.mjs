/**
 * PR02 第 ⑤ 步：从动作目录生成文档（方案 4.2 的迁移步骤）。
 *
 * 目录是唯一来源，文档是它的投影；`--check` 用"重新生成并比较"来判断文档是否过期，
 * 于是"改了目录忘了改文档"会变成一次可见的失败，而不是一句注释里的提醒。
 *
 *   node tools/browser-action-doc.mjs            # 写 docs/browser-actions.md
 *   node tools/browser-action-doc.mjs --check    # 只比较，过期则退出码 1
 */
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_ACTION_CATALOG, UPLOAD_LIMITS, STATE_LIMITS, SCROLL_LIMIT, MAX_STEPS } from '../internal/actions/catalog.mjs';
import { catalogRows } from '../internal/actions/schemas.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const TARGET = join(ROOT, 'docs', 'browser-actions.md');

/** Render the catalog as one Markdown table plus the limits it was written in. */
export function renderDoc() {
  const rows = catalogRows();
  const lines = [];
  lines.push('# browser_actions: the action catalogue');
  lines.push('');
  lines.push('Generated from `internal/actions/catalog.mjs` by `tools/browser-action-doc.mjs`.');
  lines.push('Do not edit by hand: run the tool, and `--check` will keep it honest.');
  lines.push('');
  lines.push('Every field a handler reads is declared here and in the tool\'s public `parameters`,');
  lines.push('validated by `internal/actions/schemas.mjs` before any connection is opened.');
  lines.push('');
  lines.push('| action | effect | retry | resources | fields |');
  lines.push('|---|---|---|---|---|');
  for (const row of rows) {
    const fields = row.fields.map((one) => `\`${one.name}\`${one.required ? ' (required)' : ''}: ${one.type}`).join('<br>');
    lines.push(`| \`${row.action}\` | ${row.effect} | ${row.retryPolicy} | ${row.resources.join(', ')} | ${fields} |`);
  }
  lines.push('');
  lines.push('## Limits');
  lines.push('');
  lines.push(`- steps per call: ${MAX_STEPS}`);
  lines.push(`- upload: ${UPLOAD_LIMITS.maxFiles} file(s), each path at most ${UPLOAD_LIMITS.maxPathChars} character(s)`);
  lines.push(`- scroll: each axis within ±${SCROLL_LIMIT} CSS pixels, and at least one non-zero unless a ref is given`);
  lines.push(`- state: at most ${STATE_LIMITS.maxNodes} node(s) and ${STATE_LIMITS.maxChars} character(s)`);
  lines.push('');
  lines.push('## Field notes');
  lines.push('');
  const seen = new Set();
  for (const [action, entry] of Object.entries(BROWSER_ACTION_CATALOG)) {
    for (const [name, spec] of Object.entries(entry.fields)) {
      if (seen.has(name)) continue;
      seen.add(name);
      lines.push(`- \`${name}\` (${spec.type}): ${spec.description ?? ''}`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}`;
}

const text = renderDoc();
if (process.argv.includes('--check')) {
  if (!existsSync(TARGET)) {
    console.error('docs/browser-actions.md does not exist yet; run the tool without --check');
    process.exit(1);
  }
  const current = readFileSync(TARGET, 'utf8').replace(/\r\n/g, '\n');
  if (current === text) {
    console.log('docs/browser-actions.md is up to date');
    process.exit(0);
  }
  console.error('docs/browser-actions.md is stale; rerun tools/browser-action-doc.mjs');
  process.exit(1);
}
mkdirSync(dirname(TARGET), { recursive: true });
writeFileSync(TARGET, text);
console.log(`wrote ${TARGET} (${text.length} bytes)`);
