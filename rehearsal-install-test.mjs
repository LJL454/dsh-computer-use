/**
 * 安装位置的演练（不碰现役插件）。
 *
 * 候选包在构建目录里"能跑"，到了安装位置未必：相对 import 解析的是最终路径，`PACKAGE_ROOT`
 * 推出来的 helper 与素材路径也是。这一份测试因此把候选包**复制到模拟的 profile 结构**
 * （`<profile>/node_modules/@local/dsh-computer-use`），从那个位置加载并检查：
 *
 *   - 18 个工具、5 条路由都注册成功，`apply` 不抛；
 *   - 默认 helper 路径（`PACKAGE_ROOT/native/indicator-helper/build/*.exe`）真的存在；
 *   - 角色素材（`assets/character/pack.json` 与图集）真的存在；
 *   - 包自己的 `release-manifest.json` 与文件一致（doctor 的 `--release` 层不报漂移）。
 *
 * 它**不**替换 `C:\Users\...\.dsh\profiles\desktop` 里的现役插件，并在结尾复核那边的文件没有被动过。
 *
 *   node rehearsal-install-test.mjs [--source <candidate dir>]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const sourceArg = process.argv.indexOf('--source');
// 不设默认值：默认指向某个历史候选包，只会让这份测试在"包过期"时红，而不是在"包坏了"时红。
const SOURCE = sourceArg >= 0 ? process.argv[sourceArg + 1] : undefined;
if (SOURCE === undefined) {
  console.error('usage: node rehearsal-install-test.mjs --source <candidate package dir>');
  process.exit(2);
}
const LIVE = join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', '@local', 'dsh-computer-use');

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); } else { failures.push(`${label}${detail === undefined ? '' : ` :: ${detail}`}`); console.log(`  FAIL  ${label}${detail === undefined ? '' : ` :: ${detail}`}`); }
}

/** A cheap fingerprint of a directory tree: path, size and mtime of every file. */
function fingerprint(root) {
  const digest = createHash('sha256');
  const walk = (absolute, prefix) => {
    for (const entry of (existsSync(absolute) ? readdirSync(absolute).sort() : [])) {
      const relativePath = prefix === '' ? entry : `${prefix}/${entry}`;
      const full = join(absolute, entry);
      const info = statSync(full);
      if (info.isDirectory()) walk(full, relativePath);
      else digest.update(`${relativePath}:${info.size}:${info.mtimeMs}\n`);
    }
  };
  if (existsSync(root)) walk(root, '');
  return digest.digest('hex');
}
function readdirSorted(absolute) {
  return (existsSync(absolute) ? require$readdir(absolute) : []).sort();
}
function require$readdir(absolute) {
  // eslint-disable-next-line no-undef
  return globalThis.__readdirSync(absolute);
}
globalThis.__readdirSync = (await import('node:fs')).readdirSync;

const liveBefore = fingerprint(LIVE);

console.log('\n== the candidate is staged where the host would install it ==');
const staging = mkdtempSync(join(tmpdir(), 'dsh-profile-rehearsal-'));
const profileRoot = join(staging, 'profile');
const installed = join(profileRoot, 'node_modules', '@local', 'dsh-computer-use');
mkdirSync(join(profileRoot, 'node_modules', '@local'), { recursive: true });
// Node 24 的 cpSync 在这个环境里对整棵目录树静默无操作（返回后目标仍不存在），所以用
// robocopy 拷贝：它按目录复制，退出码 0–7 都算成功，且会如实报出失败。
try {
  execFileSync('robocopy', [SOURCE, installed, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS'], { timeout: 300_000 });
} catch (error) {
  if (!(typeof error?.status === 'number' && error.status < 8)) throw error;
}
check('the package is at the profile path', existsSync(join(installed, 'package.json')));
const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
check('the package keeps its identity', manifest.name === '@local/dsh-computer-use', manifest.name);
check('it still exports the client entry', manifest.exports?.['./client'] === './client.js', JSON.stringify(manifest.exports));

console.log('\n== the native helper and the character assets travel with it ==');
const helper = join(installed, 'native', 'indicator-helper', 'build', 'dsh-interaction-indicator.exe');
check('the default helper path exists', existsSync(helper), helper);
const pack = join(installed, 'assets', 'character', 'pack.json');
check('the character pack exists', existsSync(pack), pack);
if (existsSync(pack)) {
  const parsed = JSON.parse(readFileSync(pack, 'utf8'));
  const missing = Object.values(parsed.clips ?? {}).filter((clip) => !existsSync(join(installed, 'assets', 'character', clip.atlas)));
  check('every atlas the pack names is present', missing.length === 0, JSON.stringify(missing.map((clip) => clip.atlas)));
}

console.log('\n== it loads from that location like a host would ==');
{
  const plugin = await import(pathToFileURL(join(installed, 'index.js')).href);
  const tools = new Map();
  const routes = new Map();
  const services = {
    webServer: { register: (definition) => { routes.set(definition.path, definition); return () => {}; } },
  };
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
    webServer: services.webServer,
    on: () => {},
    effect: (fn) => { const disposer = fn(); return () => { if (typeof disposer === 'function') disposer(); }; },
    inject: (deps, callback) => { if (deps.every((name) => services[name] !== undefined)) callback(ctx); return () => {}; },
    get: (name) => services[name],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
  let applied = true;
  try {
    plugin.apply(ctx, { defaultEnabled: false, shotDir: join(staging, 'shots') });
  } catch (error) {
    applied = false;
    check('apply did not throw', false, String(error?.message ?? error));
  }
  check('apply did not throw', applied === true);
  check('all 18 tools are registered', tools.size === 18, `${tools.size}`);
  check('the status route is registered', routes.has('/computer-use/status'), [...routes.keys()].join(', '));
  check('the visual preferences route is registered', routes.has('/computer-use/visual-preferences'));
  check('the state route is registered', routes.has('/computer-use/state'));
  check('the doctor route is registered', routes.has('/computer-use/doctor'));
}

console.log("\n== the package's own release manifest matches its files ==");
{
  let output = '';
  let threw = false;
  try {
    output = execFileSync(process.execPath, [join(installed, 'doctor.mjs'), '--release'], { cwd: installed, encoding: 'utf8', timeout: 120_000 });
  } catch (error) {
    threw = true;
    output = String(error?.stdout ?? '') + String(error?.stderr ?? '');
  }
  check('doctor --release runs', threw === false, output.slice(0, 200));
  // 只看**结论**：doctor 的措辞里本来就有 "release 验收" 这类字样，不能拿关键词当判据。
  const blocked = /不匹配|mismatch|阻断：|阻断项/i.test(output);
  check('it reports no release mismatch', blocked === false, output.split('\n').filter((line) => /不匹配|mismatch|阻断/i.test(line)).slice(0, 2).join(' | '));
}

console.log('\n== the live profile was not touched ==');
{
  const liveAfter = fingerprint(LIVE);
  check('the installed plugin is byte-identical to before', liveAfter === liveBefore, `${liveBefore.slice(0, 12)} -> ${liveAfter.slice(0, 12)}`);
  if (existsSync(join(LIVE, 'package.json'))) {
    const live = JSON.parse(readFileSync(join(LIVE, 'package.json'), 'utf8'));
    check('and it is still the version it was', live.version === '1.40.3', live.version);
  }
}

rmSync(staging, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
process.exit(0);
