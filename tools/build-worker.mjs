/**
 * 从 `backend/parts/*.ps1` 生成 `backend/worker.ps1`（9.txt §10：单一发布脚本，且生成结果可重现）。
 *
 * 运行时只加载 `worker.ps1`——片段不是 dot-source 的模块，而是"按序号拼接就是那一个脚本"的片段，
 * 所以加载顺序、失败语义、分发路径都没有变化。构建要求两条：
 *
 *   1. **可重现**：同样一组片段永远产出同一个字节序列（本脚本没有时间戳/环境依赖）；
 *   2. **覆盖实际执行内容**：`worker.ps1` 启动时自哈希（`build`）、宿主比对磁盘值，
 *      另加 `release-input.ps1` 的哈希；`--check` 在这里把"片段 → worker.ps1"这一步也钉住，
 *      防止改了片段却忘了重新生成。
 *
 * 用法：
 *   node tools/build-worker.mjs          # 生成（片段是唯一源码）
 *   node tools/build-worker.mjs --check  # 只校验"磁盘上的 worker.ps1 == 片段拼出来的"，不改文件
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = join(ROOT, 'backend', 'worker.ps1');
const PARTS_DIR = join(ROOT, 'backend', 'parts');
const CHECK_ONLY = process.argv.includes('--check');

const partNames = readdirSync(PARTS_DIR).filter((name) => name.endsWith('.ps1')).sort();
if (partNames.length === 0) {
  console.error('backend/parts 里没有片段：先跑 node tools/split-worker.mjs');
  process.exit(1);
}
const generated = partNames.map((name) => readFileSync(join(PARTS_DIR, name), 'utf8')).join('');

/** 编码纪律：worker.ps1 必须是**无 BOM 的 UTF-8**，否则 PowerShell 5.1 会按 ANSI 解出乱码。 */
const firstBytes = readFileSync(join(PARTS_DIR, partNames[0]));
if (firstBytes[0] === 0xef && firstBytes[1] === 0xbb && firstBytes[2] === 0xbf) {
  console.error('第一个片段带 UTF-8 BOM：worker.ps1 必须无 BOM，否则 PS 5.1 会按 ANSI 解码。');
  process.exit(1);
}
if (generated.length === 0) {
  console.error('生成结果为空，已中止');
  process.exit(1);
}

const onDisk = readFileSync(WORKER, 'utf8');
if (CHECK_ONLY) {
  if (onDisk === generated) {
    console.log(`worker 构建检查 OK：${partNames.length} 个片段拼出的字节与磁盘上的 worker.ps1 一致（${Buffer.byteLength(generated)} 字节）`);
    process.exit(0);
  }
  const onDiskLines = onDisk.length;
  console.error(`worker 构建检查失败：磁盘上的 worker.ps1（${onDiskLines} 字节）与片段拼出的内容（${generated.length} 字节）不一致。`);
  console.error('说明片段改过但没有重新生成。跑 `node tools/build-worker.mjs` 重新生成，然后重跑 tools/parse-check.ps1。');
  process.exit(1);
}

if (onDisk === generated) {
  console.log(`worker.ps1 已是最新（${partNames.length} 个片段，${Buffer.byteLength(generated)} 字节），未改写`);
  process.exit(0);
}
writeFileSync(WORKER, generated, 'utf8');
const after = readFileSync(WORKER, 'utf8');
if (after !== generated) {
  console.error('写入后校验失败：磁盘内容与生成结果不一致');
  process.exit(1);
}
console.log(`已生成 backend/worker.ps1：${partNames.length} 个片段 → ${Buffer.byteLength(generated)} 字节`);
console.log('下一步：powershell -File tools\\parse-check.ps1（语法与编码），再跑 worker 相关套件。');
