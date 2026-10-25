/**
 * 宿主依赖契约的回归测试（1.40.3）。
 *
 * 钉住的是研究报告 P0-A / P0-B 的三条结论：
 *   1. manifest 仍以 **optional peers** 声明 `dsh-tools` / `dsh-scope` —— 包管理器不该装副本，
 *      但官方 `routeLinked()` 仍能读到这两个名字（删掉声明会退回普通 Node 查找）。
 *   2. 显式 `DSH_APP_MODULES` 被当作被验证的候选，选中的入口与 `describeHostEntry()` 一致。
 *   3. 选定包之后初始化失败 → `HOST_PACKAGE_IMPORT_FAILED`，**不**偷偷换另一份副本。
 *
 *   node host-contract-test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('.', import.meta.url);
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

function writePackage(dir, name, version, body) {
  mkdirSync(join(dir, ...name.split('/'), 'lib'), { recursive: true });
  writeFileSync(join(dir, ...name.split('/'), 'package.json'), JSON.stringify({ name, version, type: 'module', main: 'lib/index.js' }, null, 2));
  writeFileSync(join(dir, ...name.split('/'), 'lib', 'index.js'), body);
}

const temp = mkdtempSync(join(tmpdir(), 'dsh-cu-contract-'));
const good = join(temp, 'good');
const bad = join(temp, 'bad');
writePackage(good, '@deepseek-ai/dsh-tools', '0.2.1-rc.3', 'export const defineTool = (spec) => spec;\nexport const marker = "good";\n');
writePackage(good, '@deepseek-ai/dsh-scope', '0.2.1-rc.3', 'export const scopeOf = (ctx) => ctx?.__scope;\n');
writePackage(bad, '@deepseek-ai/dsh-tools', '9.9.9', 'throw new Error("boom from a broken host package");\n');

console.log('== A. manifest keeps the optional peer contract ==');
const manifest = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8'));
check('dsh-tools is declared as a peer', () => {
  assert.equal(manifest.peerDependencies?.['@deepseek-ai/dsh-tools'], '>=0.2.1-rc.2 <0.3.0');
});
check('dsh-scope is declared as a peer', () => {
  assert.equal(manifest.peerDependencies?.['@deepseek-ai/dsh-scope'], '>=0.2.1-rc.2 <0.3.0');
});
check('both peers are optional, so a package manager does not install a copy', () => {
  assert.equal(manifest.peerDependenciesMeta?.['@deepseek-ai/dsh-tools']?.optional, true);
  assert.equal(manifest.peerDependenciesMeta?.['@deepseek-ai/dsh-scope']?.optional, true);
});
check('the version was bumped off the re-published 1.40.2', () => {
  assert.notEqual(manifest.version, '1.40.2');
});

console.log('\n== B. runtime kinds are recognised, not guessed from one layout ==');
const resolverUrl = new URL('internal/host-packages.mjs', ROOT).href;
const resolver = await import(resolverUrl);
check('desktop asar', () => assert.equal(resolver.hostRuntimeKind('C:/App/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js'), 'desktop-asar'));
check('desktop unpacked', () => assert.equal(resolver.hostRuntimeKind('C:/App/resources/app/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js'), 'desktop-unpacked'));
check('npm cli layout', () => assert.equal(resolver.hostRuntimeKind('C:/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js'), 'npm-cli'));
check('unknown path stays unknown', () => assert.equal(resolver.hostRuntimeKind('C:/somewhere/else.js'), 'unknown'));

console.log('\n== C. DSH_APP_MODULES is validated and reused ==');
process.env.DSH_APP_MODULES = good;
const resolver2 = await import(`${resolverUrl}?case=c`);
const tools = await resolver2.importHostModule('@deepseek-ai/dsh-tools');
check('the explicit root is the first candidate', () => {
  assert.equal(resolver2.candidateRootDetails()[0]?.explicit, true);
});
check('the imported namespace is the fixture', () => assert.equal(tools.marker, 'good'));
check('the record names the source', () => {
  const record = resolver2.hostResolution('@deepseek-ai/dsh-tools');
  assert.equal(record.selected.source, 'DSH_APP_MODULES');
});
check('describeHostEntry reports the entry that was actually selected', () => {
  const text = resolver2.describeHostEntry('@deepseek-ai/dsh-tools');
  assert.match(text, /DSH_APP_MODULES/);
  assert.match(text.replaceAll('\\', '/'), /good\/@deepseek-ai\/dsh-tools\/lib\/index\.js/);
});

console.log('\n== D. a package that is found but fails to initialize does not fall back ==');
process.env.DSH_APP_MODULES = bad;
const resolver3 = await import(`${resolverUrl}?case=d`);
let importError;
try {
  await resolver3.importHostModule('@deepseek-ai/dsh-tools');
} catch (error) {
  importError = error;
}
check('the error carries HOST_PACKAGE_IMPORT_FAILED', () => assert.equal(importError?.code, 'HOST_PACKAGE_IMPORT_FAILED'));
check('the original cause is preserved', () => assert.match(String(importError?.cause?.message ?? ''), /boom from a broken host package/));
check('the failure is recorded, not hidden', () => {
  const record = resolver3.hostResolution('@deepseek-ai/dsh-tools');
  assert.equal(record.selected, null);
  assert.ok(record.attempts.some((attempt) => attempt.ok === false && attempt.code === 'HOST_PACKAGE_IMPORT_FAILED' || attempt.error?.includes?.('boom')));
});

console.log('\n== E. two host instances never get mixed ==');
// 子进程里把 argv 伪造成"活动宿主"，再用 DSH_APP_MODULES 指向另一份：必须报冲突而不是静默切换。
const activeRoot = join(temp, 'active');
writePackage(join(activeRoot, 'resources', 'app', 'dsh', 'node_modules'), '@deepseek-ai/dsh-tools', '0.2.1-rc.3', 'export const marker = "active";\n');
const otherRoot = join(temp, 'other');
writePackage(otherRoot, '@deepseek-ai/dsh-tools', '0.2.1-rc.3', 'export const marker = "other";\n');
const childScript = join(temp, 'conflict-child.mjs');
writeFileSync(childScript, `
process.env.DSH_APP_MODULES = process.argv[2];
process.argv.push(process.argv[3]);
const resolver = await import(process.argv[4]);
try {
  await resolver.importHostModule('@deepseek-ai/dsh-tools');
  console.log('NO_CONFLICT');
} catch (error) {
  console.log('CODE=' + (error?.code ?? ''));
}
`);
const conflictRun = spawnSync(process.execPath, [childScript, otherRoot, activeRoot, resolverUrl], { encoding: 'utf8' });
check('a conflicting DSH_APP_MODULES raises HOST_INSTANCE_CONFLICT', () => {
  assert.match(String(conflictRun.stdout), /CODE=HOST_INSTANCE_CONFLICT/);
});

console.log('\n== F. an asar archive this runtime cannot read is named as such ==');
const asarRoot = join(temp, 'asar-host');
mkdirSync(join(asarRoot, 'resources'), { recursive: true });
writeFileSync(join(asarRoot, 'resources', 'app.asar'), '');
const asarChild = join(temp, 'asar-child.mjs');
writeFileSync(asarChild, `
delete process.env.DSH_APP_MODULES;
process.argv.push(process.argv[2]);
const resolver = await import(process.argv[3]);
try {
  await resolver.importHostModule('@deepseek-ai/dsh-tools');
  console.log('NO_ERROR');
} catch (error) {
  console.log('CODE=' + (error?.code ?? ''));
}
`);
const asarRun = spawnSync(process.execPath, [asarChild, asarRoot, resolverUrl], { encoding: 'utf8' });
check('plain Node reports ASAR_RUNTIME_REQUIRED instead of "unknown host"', () => {
  assert.match(String(asarRun.stdout), /CODE=ASAR_RUNTIME_REQUIRED/);
});

console.log('\n== G. npm layout is anchored from the real CLI entry ==');
const npmModules = join(temp, 'npm', 'node_modules');
writePackage(npmModules, '@deepseek-ai/dsh-tools', '0.2.1-rc.3', 'export const marker = "npm";\n');
const dshCliDir = join(npmModules, '@deepseek-ai', 'dsh', 'bin');
mkdirSync(dshCliDir, { recursive: true });
writeFileSync(join(npmModules, '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.3', type: 'module' }, null, 2));
const npmCli = join(dshCliDir, 'cli.js');
writeFileSync(npmCli, '// npm-installed dsh CLI entry\n');
const npmChild = join(temp, 'npm-child.mjs');
writeFileSync(npmChild, `
delete process.env.DSH_APP_MODULES;
process.argv.push(process.argv[2]);
const resolver = await import(process.argv[3]);
await resolver.importHostModule('@deepseek-ai/dsh-tools');
const record = resolver.hostResolution('@deepseek-ai/dsh-tools');
console.log('KIND=' + record.selected.runtimeKind);
console.log('SOURCE=' + record.selected.source);
`);
const npmRun = spawnSync(process.execPath, [npmChild, npmCli, resolverUrl], { encoding: 'utf8' });
check('the npm host is found from its CLI entry', () => {
  assert.match(String(npmRun.stdout), /SOURCE=process\.argv/, String(npmRun.stdout));
});
check('and reported as npm-cli, not "custom"', () => {
  assert.match(String(npmRun.stdout), /KIND=npm-cli/, String(npmRun.stdout));
});

rmSync(temp, { recursive: true, force: true });
delete process.env.DSH_APP_MODULES;

console.log(`\n===== ${passed} passed, ${failed} failed =====`);
process.exit(failed === 0 ? 0 : 1);
