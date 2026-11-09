#!/usr/bin/env node
/**
 * 把候选包装到目标目录 —— 用**哈希**判断要不要动，而不是大小与时间。
 *
 * 为什么不用 robocopy /MIR（第 24 轮踩到的坑）：打包器会把 `release-manifest.json` 的时间戳归一化，
 * 新旧两版大小与时间都可能相同、内容却不同，`/MIR` 于是判定"未变化"直接跳过 —— 安装目录留着旧清单，
 * `doctor --release` 报身份不一致，而 zip 里明明是新的。这类"看起来装完了其实没换"最难查，所以
 * 安装器自己算 sha256。
 *
 * 三条规则：
 *
 *   1. **内容不同就替换**（哈希不同，或目标里没有）；
 *   2. **候选包里没有的文件从目标删除**（镜像语义；删除清单先列出来）；
 *   3. **`--dry-run` 只打印计划**，一个字节都不动。
 *
 *   node tools/install-candidate.mjs --source <候选包目录> --target <安装目录> [--backup <目录>] [--dry-run]
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** 递归列出文件（相对路径，正斜杠）。 */
export function listFiles(root) {
  const out = [];
  const walk = (absolute, prefix) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const full = join(absolute, entry.name);
      if (entry.isDirectory()) walk(full, relativePath);
      else out.push(relativePath);
    }
  };
  if (existsSync(root)) walk(root, '');
  return out.sort();
}

/**
 * 计算安装计划。
 * @param source - 候选包目录。
 * @param target - 安装目录。
 * @returns `{ copy, remove, unchanged }`。
 */
export function planInstall(source, target) {
  const wanted = listFiles(source);
  const present = new Set(listFiles(target));
  const copy = [];
  const unchanged = [];
  for (const name of wanted) {
    const from = join(source, ...name.split('/'));
    if (!present.has(name)) { copy.push(name); continue; }
    const to = join(target, ...name.split('/'));
    // 大小相同也要比哈希：这正是 robocopy 漏更新的那种情形。
    const same = statSync(from).size === statSync(to).size && sha256(from) === sha256(to);
    if (same) unchanged.push(name);
    else copy.push(name);
  }
  const wantedSet = new Set(wanted);
  const remove = [...present].filter((name) => !wantedSet.has(name)).sort();
  return { copy, remove, unchanged };
}

/**
 * 执行计划（可选先备份）。
 * @param plan - `planInstall` 的结果。
 * @param source - 候选包目录。
 * @param target - 安装目录。
 * @param options.backupDir - 备份目录（给了就先整目录复制过去）。
 * @returns `{ copied, removed, backup }`。
 */
export function applyInstall(plan, source, target, options = {}) {
  let backup = '';
  if (typeof options.backupDir === 'string' && options.backupDir !== '' && existsSync(target)) {
    backup = resolve(options.backupDir);
    mkdirSync(backup, { recursive: true });
    for (const name of listFiles(target)) {
      const to = join(backup, ...name.split('/'));
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(join(target, ...name.split('/')), to);
    }
  }
  for (const name of plan.copy) {
    const to = join(target, ...name.split('/'));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(source, ...name.split('/')), to);
  }
  for (const name of plan.remove) {
    rmSync(join(target, ...name.split('/')), { force: true });
  }
  return { copied: plan.copy.length, removed: plan.remove.length, backup };
}

/**
 * 安装之后的自检：用目标目录自己的清单哈希复核每个文件。
 * @param target - 安装目录。
 * @returns `{ ok, findings }`。
 */
export function verifyInstalledFiles(target) {
  const findings = [];
  const manifestPath = join(target, 'release-manifest.json');
  if (!existsSync(manifestPath)) return { ok: false, findings: [{ code: 'MANIFEST_MISSING', detail: 'no release-manifest.json' }] };
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const entry of manifest.files ?? []) {
    const name = String(entry?.name ?? entry?.path ?? '');
    if (name === '') continue;
    const path = join(target, ...name.split('/'));
    if (!existsSync(path)) { findings.push({ code: 'FILE_MISSING', file: name }); continue; }
    if (sha256(path) !== entry.sha256) findings.push({ code: 'FILE_HASH', file: name });
  }
  return { ok: findings.length === 0, findings };
}

const isMain = process.argv[1] !== undefined && /install-candidate\.mjs$/.test(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const value = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
  const source = value('--source');
  const target = value('--target');
  if (source === undefined || target === undefined) {
    console.error('usage: node tools/install-candidate.mjs --source <candidate dir> --target <install dir> [--backup <dir>] [--dry-run]');
    process.exit(2);
  }
  const plan = planInstall(resolve(source), resolve(target));
  const dryRun = args.includes('--dry-run');
  console.log(`copy   ${plan.copy.length}`);
  console.log(`remove ${plan.remove.length}`);
  console.log(`same   ${plan.unchanged.length}`);
  if (dryRun) {
    for (const name of plan.copy.slice(0, 40)) console.log(`  + ${name}`);
    if (plan.copy.length > 40) console.log(`  + … ${plan.copy.length - 40} more`);
    for (const name of plan.remove.slice(0, 40)) console.log(`  - ${name}`);
    console.log('dry run: nothing was written');
    process.exit(0);
  }
  const result = applyInstall(plan, resolve(source), resolve(target), { backupDir: value('--backup') });
  console.log(`copied ${result.copied}, removed ${result.removed}${result.backup === '' ? '' : `, backup ${result.backup}`}`);
  const check = verifyInstalledFiles(resolve(target));
  if (check.ok) {
    console.log('OK  every file matches the manifest that shipped with it');
    process.exit(0);
  }
  for (const finding of check.findings) console.error(`FAIL  ${finding.code} ${finding.file ?? ''}`);
  process.exit(1);
}
