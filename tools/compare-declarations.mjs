/**
 * 一次性核查：把"当前 index.js"与"上一轮候选包里的 index.js"的**顶层声明**对一遍，列出差异。
 *
 * 起因：按注释块整段删除时连带删掉了同区间的其它声明（在飞调用登记）。这类错误靠跑套件能发现，
 * 但只有把两边声明集**列出来比**，才能确认没有第二处、第三处遗漏。
 *
 * 用法：node tools/compare-declarations.mjs <old-index.js>
 */
import { readFileSync } from 'node:fs';

const oldPath = process.argv[2];
if (oldPath === undefined) {
  console.error('用法：node tools/compare-declarations.mjs <old-index.js>');
  process.exit(2);
}

/** 抓 2 空格缩进的顶层声明（apply() 内部）与文件级声明。 */
function declarations(text) {
  const names = new Map();
  for (const match of text.matchAll(/^( {2})?(?:async )?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    if (!names.has(match[2])) names.set(match[2], 0);
    names.set(match[2], names.get(match[2]) + 1);
  }
  return names;
}

const before = declarations(readFileSync(oldPath, 'utf8'));
const after = declarations(readFileSync('index.js', 'utf8'));

const removed = [...before.keys()].filter((name) => !after.has(name));
const added = [...after.keys()].filter((name) => !before.has(name));
console.log(`旧文件声明 ${before.size} 个，当前 ${after.size} 个`);
console.log(`\n当前里没有的（被删除或改名）${removed.length} 个：`);
for (const name of removed.sort()) console.log(`  - ${name}`);
console.log(`\n当前新出现的 ${added.length} 个：`);
for (const name of added.sort()) console.log(`  + ${name}`);
