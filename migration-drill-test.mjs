/**
 * 旧 profile 迁移演练（1.40.3，报告 §8 的 "旧 profile / 迁移可回滚 / 失败不能报成功"）。
 *
 * 三个场景，全部用运行时生成的夹具，不依赖本机安装：
 *   A. profile 里有一份真实的 @deepseek-ai/dsh-tools 副本，宿主原件可用 → 换成指向宿主的 junction，退出 0。
 *   B. 宿主原件缺失 → 不得删除副本、不得报成功，退出 1。
 *   C. 副本修好后 profile 仍声明该依赖 → 仍需退出 1（下一次安装会把副本装回来）。
 *
 *   node migration-drill-test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SETUP = join(ROOT, 'setup.mjs');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error?.message ?? error}`);
  }
}

const temp = mkdtempSync(join(tmpdir(), 'dsh-cu-migrate-'));

function writeHostPackage(root, name, version) {
  const dir = join(root, '@deepseek-ai', name);
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `@deepseek-ai/${name}`, version, type: 'module', main: 'lib/index.js' }, null, 2));
  writeFileSync(join(dir, 'lib', 'index.js'), 'export const marker = 1;\n');
  return dir;
}

function runSetup(args) {
  const result = spawnSync(process.execPath, [SETUP, '--repair-only', '--json', ...args], { encoding: 'utf8' });
  let report = null;
  try { report = JSON.parse(result.stdout); } catch { report = null; }
  return { status: result.status, report, stdout: result.stdout, stderr: result.stderr };
}

function makeProfile(home, { realCopy = true, declare = false } = {}) {
  const profile = join(home, 'profiles', 'desktop');
  const scoped = join(profile, 'node_modules', '@deepseek-ai');
  mkdirSync(scoped, { recursive: true });
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-desktop',
    private: true,
    dependencies: declare ? { '@deepseek-ai/dsh-tools': '^0.2.1-rc.2' } : {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }, null, 2));
  if (realCopy) {
    const copy = join(scoped, 'dsh-tools');
    mkdirSync(join(copy, 'lib'), { recursive: true });
    writeFileSync(join(copy, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tools', version: '0.0.1-rc.1' }, null, 2));
    writeFileSync(join(copy, 'lib', 'index.js'), 'export const stale = true;\n');
  }
  return profile;
}

/* ---------------------------------------------------------------- A */
console.log('== A. a real copy is replaced by a junction to the running host ==');
const goodHost = join(temp, 'host-good');
writeHostPackage(goodHost, 'dsh-tools', '0.2.1-rc.3');
writeHostPackage(goodHost, 'dsh-scope', '0.2.1-rc.3');
const homeA = join(temp, 'home-a');
makeProfile(homeA, { realCopy: true });
const runA = runSetup(['--dsh-home', homeA, '--host-modules', goodHost]);
check('exit code is 0', () => assert.equal(runA.status, 0, runA.stdout + runA.stderr));
check('the report says ok', () => assert.equal(runA.report?.ok, true));
check('it repaired exactly one path', () => assert.equal(runA.report?.repaired, 1));
check('the stale copy is gone and a junction now points at the host', () => {
  const target = join(homeA, 'profiles', 'desktop', 'node_modules', '@deepseek-ai', 'dsh-tools');
  assert.equal(existsSync(join(target, 'package.json')), true);
  const real = realpathSync.native(target);
  const host = realpathSync.native(join(goodHost, '@deepseek-ai', 'dsh-tools'));
  assert.equal(real.toLowerCase(), host.toLowerCase());
  const version = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).version;
  assert.equal(version, '0.2.1-rc.3');
});

/* ---------------------------------------------------------------- B */
console.log('\n== B. a missing host source is a failure, and nothing is deleted ==');
const thinHost = join(temp, 'host-thin');
writeHostPackage(thinHost, 'dsh-scope', '0.2.1-rc.3');
const homeB = join(temp, 'home-b');
makeProfile(homeB, { realCopy: true });
const runB = runSetup(['--dsh-home', homeB, '--host-modules', thinHost]);
check('exit code is non-zero', () => assert.equal(runB.status, 1, runB.stdout + runB.stderr));
check('the report says not ok', () => assert.equal(runB.report?.ok, false));
check('the copy is still there (no destructive "repair")', () => {
  const copy = join(homeB, 'profiles', 'desktop', 'node_modules', '@deepseek-ai', 'dsh-tools', 'package.json');
  assert.equal(existsSync(copy), true);
  assert.equal(JSON.parse(readFileSync(copy, 'utf8')).version, '0.0.1-rc.1');
});
check('the remaining count is reported', () => assert.equal(runB.report?.remaining, 1));

/* ---------------------------------------------------------------- C */
console.log('\n== C. a declared dependency still fails the verdict ==');
const homeC = join(temp, 'home-c');
makeProfile(homeC, { realCopy: true, declare: true });
const runC = runSetup(['--dsh-home', homeC, '--host-modules', goodHost]);
check('exit code is non-zero', () => assert.equal(runC.status, 1, runC.stdout + runC.stderr));
check('the declaration is named', () => assert.equal(runC.report?.declaredCount, 1));
check('the path itself was still repaired', () => assert.equal(runC.report?.repaired, 1));

/* ---------------------------------------------------------------- D */
console.log('\n== D. --check never changes anything ==');
const homeD = join(temp, 'home-d');
makeProfile(homeD, { realCopy: true });
const runD = spawnSync(process.execPath, [SETUP, '--check', '--json', '--dsh-home', homeD, '--host-modules', goodHost], { encoding: 'utf8' });
const reportD = JSON.parse(runD.stdout);
check('exit code is 1 (a problem was found)', () => assert.equal(runD.status, 1));
check('nothing was repaired', () => assert.equal(reportD.repaired, 0));
check('the copy is untouched', () => {
  const copy = join(homeD, 'profiles', 'desktop', 'node_modules', '@deepseek-ai', 'dsh-tools', 'package.json');
  assert.equal(JSON.parse(readFileSync(copy, 'utf8')).version, '0.0.1-rc.1');
});

rmSync(temp, { recursive: true, force: true });
console.log(`\n===== ${passed} passed, ${failed} failed =====`);
process.exit(failed === 0 ? 0 : 1);
