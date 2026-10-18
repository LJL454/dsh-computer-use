/**
 * 一次性整理：把 `internal/tool-contracts.mjs` 里 `export /** 注释 *\/\nconst X` 的写法调成
 * `/** 注释 *\/\nexport const X`（语义不变，只为人读），并补上跨模块引用 `STEP_ACTION_LIST`。
 *
 * 起因：搬迁脚本把 `export` 加在"含注释的整段"前面，于是导出关键字落在了文档注释之前——ESM 允许，
 * 但读起来像注释被导出。这里只挪位置，不动任何内容。
 *
 * 用法：node tools/fix-contracts-exports.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'internal/tool-contracts.mjs';
const DRY = process.argv.includes('--dry');
let text = readFileSync(FILE, 'utf8');
const original = text;

// 1) export 移到注释之后
text = text.replace(/export (\/\*\*[\s\S]*?\*\/)\n(const|function|async function) /g, '$1\nexport $2 ');

// 2) 补跨模块引用（只补一次）
const ANCHOR = "import { createHash } from 'node:crypto';";
if (!text.includes("from './failures.mjs'")) {
  if (!text.includes(ANCHOR)) {
    console.error('找不到 import 锚点');
    process.exit(1);
  }
  text = text.replace(ANCHOR, `${ANCHOR}
// 批次步骤的动作清单来自失败契约模块（schema、描述与 worker 分发表共用的那一份，曾经有三份且互相
// 矛盾），所以这里**引用**它，而不是抄一份。
import { STEP_ACTION_LIST } from './failures.mjs';`);
}

const remaining = (text.match(/export \/\*\*/g) ?? []).length;
console.log(`export 位置调整：${original !== text ? '有改动' : '无改动'}；剩余 \`export /**\` ${remaining} 处`);
if (remaining > 0) {
  console.error('仍有未调整的 export 位置，请检查');
  process.exit(1);
}
if (DRY) {
  console.log('（--dry：不写文件）');
  process.exit(0);
}
writeFileSync(FILE, text, 'utf8');
console.log('已写入', FILE);
