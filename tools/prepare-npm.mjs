#!/usr/bin/env node
/** Build a renamed npm tarball from npm's pack list, with a regenerated manifest.
 * Publication is deliberately a separate npm command.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeReleaseManifest } from '../internal/release-manifest.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sourceManifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const currentName = sourceManifest.name;
const textExtensions = /\.(js|mjs|cjs|json|yml|yaml|md|ps1|cmd)$/i;
function arg(key, fallback) {
  const index = process.argv.indexOf(key);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}
const name = arg('--name', '');
if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) || name === currentName || name.startsWith('@local/')) {
  throw new Error('Pass --name with a valid npm package name you own, different from the local package name.');
}
const outDir = resolve(arg('--out', join(ROOT, 'dist')));
const slug = name.replace(/^@/, '').replaceAll('/', '-');
const stage = resolve(outDir, `npm-${slug}`);
if (dirname(stage) !== outDir || existsSync(stage)) throw new Error(`Choose a fresh staging directory; refusing to overwrite ${stage}`);

function runNpm(args, cwd) {
  let command = 'npm';
  let commandArgs = args;
  if (process.platform === 'win32') {
    // Execute the JS entry directly; no cmd quoting or path-with-spaces ambiguity.
    const candidates = [process.env.npm_execpath, ...[dirname(process.execPath), ...(process.env.PATH ?? '').split(delimiter)].map(dir => join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'))].filter(Boolean);
    const cli = candidates.find(path => path.endsWith('npm-cli.js') && existsSync(path));
    if (!cli) throw new Error('Cannot find npm-cli.js beside Node/npm on PATH.');
    command = process.execPath;
    commandArgs = [cli, ...args];
  }
  const result = spawnSync(command, commandArgs, { cwd, encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  if (result.status !== 0) throw new Error(`npm ${args[0]} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  return JSON.parse(result.stdout.trim());
}

const [sourcePack] = runNpm(['pack', '--dry-run', '--ignore-scripts', '--json'], ROOT);
mkdirSync(stage, { recursive: true });
let renamedFiles = 0;
for (const file of sourcePack.files) {
  if (file.path === 'release-manifest.json') continue;
  const source = resolve(ROOT, file.path);
  const target = resolve(stage, file.path);
  const child = relative(stage, target);
  if (isAbsolute(file.path) || child === '..' || child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(child)) throw new Error(`Unsafe pack entry ${file.path}`);
  mkdirSync(dirname(target), { recursive: true });
  if (textExtensions.test(file.path)) {
    const original = readFileSync(source, 'utf8');
    const rewritten = original.split(currentName).join(name);
    writeFileSync(target, rewritten, 'utf8');
    if (original !== rewritten) renamedFiles++;
  } else cpSync(source, target);
}

const manifestPath = join(stage, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.publishConfig = { ...manifest.publishConfig, registry: 'https://registry.npmjs.org/', access: 'public' };
manifest.keywords = ['deepseek-harness', 'computer-use', 'windows', 'desktop-automation'];
if (manifest.name !== name || manifest.version !== sourceManifest.version) throw new Error('Renaming changed the package identity unexpectedly.');
const patch = readFileSync(join(stage, 'cordis.patch.yml'), 'utf8');
if (!patch.includes(`name: '${name}'`)) throw new Error('The bundle patch does not name the published package.');
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const installCommand = `dsh plugin --profile desktop add ${name}@${manifest.version}`;
const readme = `# ${name}\n\nDeepSeek Harness 的 Windows 电脑操作插件，版本 ${manifest.version}。\n\n## 安装到 Harness\n\n在 Harness 的插件安装框输入 \`${name}\`，或在可使用 dsh 命令的终端执行：\n\n\`\`\`powershell\n${installCommand}\n\`\`\`\n\n安装后完整退出并重新打开 Harness，在需要控制电脑的会话开启「电脑操作」。\n鼠标、键盘、截图、窗口、无障碍控件、剪贴板、应用启动、浏览器操作与批量动作随包提供。\n包内包含原生交互助手，无需另外下载 SDK 或编译程序；模型使用 Harness 已配置的模型。\n\n## 普通 npm 下载\n\n\`\`\`powershell\nnpm install ${name}@${manifest.version}\n\`\`\`\n\n普通 npm install 只把文件放进当前项目，不会自动登记 Harness profile。要在 Harness 使用，请用上面的 dsh plugin add 或插件安装框。\n\n## 支持范围与开关\n\n- Windows 桌面 profile；Harness >=0.2.1-rc.2 且 <0.3.0，Node >=20。\n- 电脑操作为会话级开关；人物日常伴随需要在效果设置中开启。\n- pwsh 输出压缩与应用启动能力随核心包挂载。\n- presets/ 内的桌面、分析和文档任务预设为可选独立 bundle，不是核心依赖。\n- 本包提供常驻后端和批量操作；模型仍按观察、动作、观察的循环运行。\n\n## 从本地包迁移\n\n如果已经安装了原来的 \`@local/dsh-computer-use\` 或本地 tgz，请先在 Harness 插件管理中移除旧包，再安装本包，避免两份插件重复挂载。\n不要删除旧插件目录后仍保留指向它的 link 配置。\n\n## 完整性与诊断\n\n\`release-manifest.json\` 包含生产文件的 SHA256 和 releaseBuildId。启动后异步核对；诊断等待完整结果。\n如遇安全软件拦截，请保留威胁名称与文件哈希并向安全厂商申请复核。\n\n## License\n\nMIT，见 LICENSE。\n`;
writeFileSync(join(stage, 'README.md'), readme, 'utf8');
writeFileSync(join(stage, 'INSTALL.md'), `# 安装 ${name}\n\n${readme.split('## 安装到 Harness\n\n')[1].split('## License')[0]}`, 'utf8');

// npm pack does not create our release manifest; renaming requires new hashes.
const release = writeReleaseManifest(stage);
const [packed] = runNpm(['pack', '--ignore-scripts', '--json', '--pack-destination', outDir], stage);
const report = { name, version: manifest.version, stage, tarball: join(outDir, packed.filename), bytes: packed.size, files: packed.entryCount, renamedFiles, releaseBuildId: release.manifest.releaseBuildId, verified: release.verification.matches, integrity: packed.integrity, installCommand };
writeFileSync(join(outDir, 'npm-release.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
console.log(`Not published. Next: npm publish "${report.tarball}" --access public --registry=https://registry.npmjs.org/`);
