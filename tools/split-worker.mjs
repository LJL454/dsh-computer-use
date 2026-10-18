/**
 * worker.ps1 的源码分模块（9.txt §10）。
 *
 * 方案对 PowerShell 这半的要求是明确的："可以先在源码中分模块，**继续生成单一发布脚本**；
 * 必须保证生成结果可重现，并将构建标识覆盖到所有实际执行内容。"
 *
 * 所以这里不引入 dot-sourcing（那会改变加载顺序、失败语义和分发路径），而是：
 *
 *   backend/parts/NN-name.ps1   ← 按**分节横幅**切出来的片段，是唯一的源码
 *   backend/worker.ps1          ← 由 `tools/build-worker.mjs` 按序号拼接生成，运行时只看它
 *
 * 片段不是可独立运行的脚本，而是"按顺序拼接后就是那一个脚本"的片段——这正是"单一发布脚本"
 * 的含义。切分与拼回都是**逐字节**的：本脚本在写盘前会先断言 `parts.join('') === 原文件`，
 * 断言不过就什么都不写。
 *
 * 用法：node tools/split-worker.mjs [--dry]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = join(ROOT, 'backend', 'worker.ps1');
const PARTS_DIR = join(ROOT, 'backend', 'parts');
const DRY = process.argv.includes('--dry');

/**
 * 分节的起点：`worker.ps1` 里那些横线横幅的行号（1 起）与片段名。
 *
 * 这些横幅本来就是文件的骨架（native code / COM UIA engine / input state / frames / refs /
 * what the model has to read / text observation / waiting / batching / main loop），按它们切
 * 不需要移动任何一行代码。序号决定拼接顺序，`00-preamble` 是文件头到第一个横幅之前的部分。
 */
const BOUNDARIES = [
  { at: 1, name: '00-preamble' },
  { at: 31, name: '01-cancellation' },
  { at: 168, name: '02-native-code' },
  { at: 670, name: '03-com-uia-engine' },
  { at: 2577, name: '04-utilities' },
  { at: 2602, name: '05-input-state' },
  { at: 3527, name: '06-related-capture' },
  { at: 4353, name: '07-frames' },
  { at: 6636, name: '08-element-refs' },
  { at: 6758, name: '09-what-the-model-reads' },
  { at: 7205, name: '10-text-observation' },
  { at: 9187, name: '11-waiting' },
  { at: 9986, name: '12-batching' },
  { at: 11117, name: '13-main-loop' },
];

const original = readFileSync(WORKER, 'utf8');

/** 按行号切：每行的起始字符偏移（保留原样换行，包括 CRLF/LF 的差异）。 */
function lineOffsets(text) {
  const offsets = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') offsets.push(index + 1);
  }
  return offsets;
}

const offsets = lineOffsets(original);
let parts;
try {
  parts = BOUNDARIES.map((boundary, index) => {
    const start = offsets[boundary.at - 1];
    const end = index + 1 < BOUNDARIES.length ? offsets[BOUNDARIES[index + 1].at - 1] : original.length;
    if (start === undefined || end === undefined || end <= start) {
      throw new Error(`边界 ${boundary.name} 行号越界（${boundary.at}）`);
    }
    return { name: boundary.name, text: original.slice(start, end) };
  });
} catch (error) {
  console.error(`切分失败（文件可能已经改过，行号需要重算）：${error.message}`);
  process.exit(1);
}

/** 先证明"拼回去等于原文件"，再落盘。 */
const reassembled = parts.map((one) => one.text).join('');
if (reassembled !== original) {
  console.error('切分校验失败：拼回的内容与原文件不一致，未写任何文件');
  process.exit(1);
}
console.log(`切分校验 OK：${parts.length} 个片段，拼回 ${reassembled.length} 字节与原文件逐字节相同`);
for (const part of parts) {
  const lines = part.text.split('\n').length - (part.text.endsWith('\n') ? 1 : 0);
  console.log(`  ${part.name.padEnd(24)} ${String(lines).padStart(6)} 行  ${String(Buffer.byteLength(part.text)).padStart(8)} 字节`);
}

if (DRY) {
  console.log('（--dry：只校验，不写文件）');
  process.exit(0);
}

mkdirSync(PARTS_DIR, { recursive: true });
for (const part of parts) {
  writeFileSync(join(PARTS_DIR, `${part.name}.ps1`), part.text, 'utf8');
}
console.log(`已写入 backend/parts/（${parts.length} 个片段）。生成 worker.ps1 用：node tools/build-worker.mjs`);
