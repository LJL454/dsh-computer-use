/**
 * 安装器必须用哈希判断，不能用"大小 + 时间"（第 24 轮踩到的坑）。
 *
 * 那次的具体情形值得固化成测试：候选包里的 `release-manifest.json` 与安装目录里那份**字节数相同、
 * 修改时间相同、内容不同**（打包器归一化了时间戳），`robocopy /MIR` 判定"未变化"直接跳过，
 * 于是安装目录留着旧清单、`doctor --release` 报身份不一致 —— 而 zip 里明明是新的。
 *
 * 这份测试就复刻那个场景，外加镜像删除、dry-run 不动盘、备份、以及装完用清单自检。
 *
 *   node install-candidate-test.mjs
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { applyInstall, listFiles, planInstall, verifyInstalledFiles } from './tools/install-candidate.mjs';

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}
/** 把两个文件的 mtime 设成同一时刻：这就是打包器归一化时间戳的效果。 */
function sameMtime(a, b) {
  const when = new Date('2026-11-06T12:00:00Z');
  utimesSync(a, when, when);
  utimesSync(b, when, when);
}

const root = mkdtempSync(join(tmpdir(), 'dsh-install-'));
const source = join(root, 'candidate');
const target = join(root, 'installed');

console.log('\n== a file with the same size and mtime but different bytes is replaced ==');
{
  write(join(source, 'release-manifest.json'), 'AAAA');
  write(join(target, 'release-manifest.json'), 'BBBB');
  sameMtime(join(source, 'release-manifest.json'), join(target, 'release-manifest.json'));
  const before = statSync(join(target, 'release-manifest.json')).size;
  const plan = planInstall(source, target);
  check('the sizes really match', before === statSync(join(source, 'release-manifest.json')).size);
  check('the mtimes really match', statSync(join(target, 'release-manifest.json')).mtimeMs === statSync(join(source, 'release-manifest.json')).mtimeMs);
  check('the plan still replaces it', plan.copy.includes('release-manifest.json'), JSON.stringify(plan));
  applyInstall(plan, source, target);
  check('the target now has the candidate content', readFileSync(join(target, 'release-manifest.json'), 'utf8') === 'AAAA');
}

console.log('\n== unchanged content is left alone ==');
{
  write(join(source, 'index.js'), 'export const a = 1;\n');
  write(join(target, 'index.js'), 'export const a = 1;\n');
  const plan = planInstall(source, target);
  check('the identical file is not copied', plan.unchanged.includes('index.js') && !plan.copy.includes('index.js'), JSON.stringify(plan));
}

console.log('\n== files that only exist in the target are removed (mirror) ==');
{
  write(join(target, 'old-test.mjs'), 'stale\n');
  const plan = planInstall(source, target);
  check('the stale file is scheduled for removal', plan.remove.includes('old-test.mjs'), JSON.stringify(plan.remove));
  applyInstall(plan, source, target);
  check('and it is gone afterwards', existsSync(join(target, 'old-test.mjs')) === false);
}

console.log('\n== a nested tree is planned the same way ==');
{
  write(join(source, 'internal', 'a.mjs'), 'export const x = 1;\n');
  write(join(source, 'internal', 'b.mjs'), 'export const y = 2;\n');
  write(join(target, 'internal', 'a.mjs'), 'export const x = 999;\n');
  const plan = planInstall(source, target);
  check('the changed nested file is copied', plan.copy.includes('internal/a.mjs'), JSON.stringify(plan.copy));
  check('the new nested file is copied', plan.copy.includes('internal/b.mjs'), JSON.stringify(plan.copy));
  check('the listing uses forward slashes', listFiles(source).every((name) => !name.includes('\\')), JSON.stringify(listFiles(source)));
}

console.log('\n== a backup is taken before anything is overwritten ==');
{
  const backupDir = join(root, 'backup');
  const plan = planInstall(source, target);
  const result = applyInstall(plan, source, target, { backupDir });
  check('the installer reports the backup', result.backup === backupDir, result.backup);
  check('the backup holds the previous bytes', readFileSync(join(backupDir, 'internal', 'a.mjs'), 'utf8') === 'export const x = 999;\n', readFileSync(join(backupDir, 'internal', 'a.mjs'), 'utf8'));
}

console.log('\n== the installed tree verifies against the manifest it shipped with ==');
{
  const manifest = {
    schema: 1,
    name: '@local/dsh-computer-use',
    version: '1.40.3',
    files: [
      { name: 'index.js', sha256: 'PLACEHOLDER' },
    ],
  };
  // 用真实哈希填进去：模拟"清单与文件一致"的正常状态。
  const { createHash } = await import('node:crypto');
  const digest = createHash('sha256').update(readFileSync(join(target, 'index.js'))).digest('hex');
  manifest.files[0].sha256 = digest;
  write(join(target, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const ok = verifyInstalledFiles(target);
  check('a consistent tree verifies', ok.ok === true, JSON.stringify(ok.findings));

  write(join(target, 'index.js'), 'export const a = 2;\n');
  const broken = verifyInstalledFiles(target);
  check('a changed file is caught', broken.ok === false && broken.findings.some((one) => one.code === 'FILE_HASH'), JSON.stringify(broken.findings));
}

rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
