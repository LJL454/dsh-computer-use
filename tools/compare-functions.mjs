/**
 * 函数级差异：把当前 `index.js` 与一份旧副本里的**同名函数/常量**逐个比对，列出"内容变了"的那些。
 *
 * 为什么需要它：`compare-declarations.mjs` 只能回答"某个声明还在不在"，而拆分过程中真正危险的是
 * **同一个名字还在、内容却变了**（或者被截断成语法合法的残片）。这个工具把两侧的函数体都抽出来，
 * 归一化空白后比对，于是"有意改动"和"误伤"能分开看：
 *
 *   node tools/compare-functions.mjs <old-index.js> [--only <名字>] [--quiet]
 *
 * 预期用法：搬迁某一批之后跑一遍，差异清单里**只应该出现你打算改的那几个**。
 */
import { readFileSync } from 'node:fs';

const oldPath = process.argv[2];
if (oldPath === undefined) {
  console.error('用法：node tools/compare-functions.mjs <old-index.js> [--only <名字>] [--quiet]');
  process.exit(2);
}
const onlyAt = process.argv.indexOf('--only');
const ONLY = onlyAt === -1 ? null : process.argv[onlyAt + 1];
const QUIET = process.argv.includes('--quiet');

/** 抽出所有 `function name(...) { … }` 的函数体（按花括号配对），返回 name -> 归一化正文。 */
function functions(text) {
  const found = new Map();
  const pattern = /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of text.matchAll(pattern)) {
    const name = match[1];
    const open = text.indexOf('{', match.index + match[0].length - 1);
    if (open < 0) continue;
    let depth = 0;
    let end = -1;
    for (let index = open; index < text.length; index += 1) {
      const char = text[index];
      if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) { end = index; break; }
      }
    }
    if (end < 0) continue;
    const body = text.slice(open, end + 1);
    // 归一化：压掉空白差异，但保留标识符与字面量——只关心"内容是否变了"。
    const normalized = body.replace(/\s+/g, ' ').trim();
    if (!found.has(name)) found.set(name, normalized);
    else found.set(name, `${found.get(name)}\u0000${normalized}`);
  }
  return found;
}

const before = functions(readFileSync(oldPath, 'utf8'));
const after = functions(readFileSync('index.js', 'utf8'));

const removed = [...before.keys()].filter((name) => !after.has(name));
const added = [...after.keys()].filter((name) => !before.has(name));
const changed = [...before.keys()].filter((name) => after.has(name) && before.get(name) !== after.get(name));

const show = (name) => ONLY === null || name.includes(ONLY);
if (!QUIET) {
  console.log(`旧副本函数 ${before.size} 个，当前 ${after.size} 个`);
  console.log(`\n只在旧副本里（被搬走/改名）${removed.filter(show).length} 个：`);
  for (const name of removed.filter(show).sort()) console.log(`  - ${name}`);
  console.log(`\n只在新文件里（新增/改名）${added.filter(show).length} 个：`);
  for (const name of added.filter(show).sort()) console.log(`  + ${name}`);
  console.log(`\n同名但内容变了 ${changed.filter(show).length} 个：`);
  for (const name of changed.filter(show).sort()) console.log(`  ~ ${name}`);
}
if (changed.filter(show).length > 0) {
  console.log('\n（同名内容变化是需要逐个确认的清单：要么是你打算改的，要么是误伤。）');
}
process.exit(0);
