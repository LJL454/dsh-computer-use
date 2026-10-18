/**
 * 一次性核查：压缩连续空行时，是否**动到了模板字符串内部**的有意空行。
 *
 * 起因：压缩空行是个纯文本操作，而模板字符串里的空行可能是渲染文案的一部分；`compare-functions.mjs`
 * 会把空白归一化，因此看不见这类改动。这里直接比较两份文件里**每个模板字符串**的内容。
 *
 * 用法：node tools/check-string-literals.mjs <old-index.js>
 */
import { readFileSync } from 'node:fs';

const oldPath = process.argv[2];
if (oldPath === undefined) {
  console.error('用法：node tools/check-string-literals.mjs <old-index.js>');
  process.exit(2);
}

/** 抽出所有反引号模板字符串（不含嵌套转义场景，够用于这个核查）。 */
function literals(text) {
  const found = [];
  let index = 0;
  while (index < text.length) {
    const start = text.indexOf('`', index);
    if (start < 0) break;
    let end = start + 1;
    while (end < text.length) {
      if (text[end] === '\\') { end += 2; continue; }
      if (text[end] === '`') break;
      end += 1;
    }
    found.push(text.slice(start, end + 1));
    index = end + 1;
  }
  return found;
}

const before = literals(readFileSync(oldPath, 'utf8'));
const after = literals(readFileSync('index.js', 'utf8'));
const countRuns = (list) => list.reduce((total, one) => total + ((one.match(/\n{3,}/g) ?? []).length), 0);
console.log(`备份：${before.length} 个模板字符串，含 3+ 连续换行 ${countRuns(before)} 处`);
console.log(`当前：${after.length} 个模板字符串，含 3+ 连续换行 ${countRuns(after)} 处`);

const beforeSet = new Set(before);
const afterSet = new Set(after);
const lost = before.filter((one) => !afterSet.has(one));
const gained = after.filter((one) => !beforeSet.has(one));
console.log(`\n备份里有、当前没有（被改动或被搬走）${lost.length} 个：`);
for (const one of lost.slice(0, 20)) {
  console.log(`  ${JSON.stringify(one.slice(0, 90))}`);
}
console.log(`\n当前有、备份里没有（新增或改写）${gained.length} 个：`);
for (const one of gained.slice(0, 20)) {
  console.log(`  ${JSON.stringify(one.slice(0, 90))}`);
}
