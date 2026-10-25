#!/usr/bin/env node
/**
 * 发布前隐私扫描：找出会跟着仓库/压缩包一起上传的个人信息与机器指纹。
 *
 *   node tools/privacy-scan.mjs           扫描当前目录
 *   node tools/privacy-scan.mjs <dir>     扫描指定目录
 *
 * 退出码：0 = 干净，1 = 有命中，2 = 参数错误。
 *
 * 这不是通用秘密扫描器，只覆盖这个项目实际会碰到的几类：
 *   * Windows / Unix 的用户目录绝对路径（含本机用户名）；
 *   * 本机用户名、计算机名原样出现；
 *   * 非 noreply 的邮箱；
 *   * 常见凭据前缀（sk- / ghp_ / github_pat_ / AKIA / xox?-）；
 *   * 指向某个具体安装目录的插件绝对路径。
 *
 * 允许的占位写法：`<用户>`、`…`、`%USERNAME%`、`example`、`D:\DSH-Plugins`、`D:\Plugins`、
 * `<plugin-root>`、`<路径>`。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ?? process.cwd();

const TEXT_EXTENSIONS = new Set([
  '.md', '.mjs', '.js', '.cjs', '.json', '.yml', '.yaml', '.ps1', '.cmd', '.txt', '.ts', '.html', '.css',
]);

const ALLOWED = [
  /C:\\Users\\<用户>/i,
  /C:\\Users\\…/i,
  /C:\\Users\\example\\/i,
  /\/home\/example\//i,
  /%USERNAME%/i,
  /<plugin-root>/i,
  /<路径>/i,
  /D:\\{1,2}DSH-Plugins\\/i,
  /D:\\{1,2}Plugins\\dsh-computer-use/i,
  /@users\.noreply\.github\.com/i,
  /@example\.(com|org)/i,
];

const RULES = [
  {
    id: 'windows-user-path',
    label: 'Windows 用户目录绝对路径',
    test: (line) => [...line.matchAll(/[A-Za-z]:\\Users\\[^\\\s"'`<>…]+/g)].map((m) => m[0]),
  },
  {
    id: 'unix-home-path',
    label: 'Unix 家目录绝对路径',
    test: (line) => [...line.matchAll(/\/home\/[A-Za-z0-9._-]+\//g)].map((m) => m[0]),
  },
  {
    id: 'local-username',
    label: '本机用户名',
    test: (line) => {
      const name = process.env.USERNAME ?? process.env.USER ?? '';
      return name.length >= 3 && line.toLowerCase().includes(name.toLowerCase()) ? [name] : [];
    },
  },
  {
    id: 'computer-name',
    label: '本机计算机名',
    test: (line) => {
      const name = process.env.COMPUTERNAME ?? '';
      return name.length >= 3 && line.toLowerCase().includes(name.toLowerCase()) ? [name] : [];
    },
  },
  {
    id: 'email',
    label: '邮箱地址',
    test: (line) => [...line.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0]),
  },
  {
    id: 'credential',
    label: '疑似凭据',
    test: (line) => [
      ...line.matchAll(/\b(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{12,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g),
    ].map((m) => m[0]),
  },
  {
    id: 'plugin-absolute-path',
    label: '插件安装目录绝对路径',
    test: (line) => [...line.matchAll(/[A-Za-z]:\\[^"\s]*?(?:dsh-plugins|dsh-computer-use)(?:\\|$)/gi)].map((m) => m[0]),
  },
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) out.push(path);
  }
  return out;
}

const SELF = resolve(fileURLToPath(import.meta.url));
const files = walk(root).filter((file) => resolve(file) !== SELF);
const hits = [];
for (const file of files) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (ALLOWED.some((pattern) => pattern.test(line))) continue;
    for (const rule of RULES) {
      const found = rule.test(line);
      if (found.length === 0) continue;
      hits.push({ file: relative(process.cwd(), file) || file, line: index + 1, rule: rule.id, label: rule.label, sample: found[0].slice(0, 120) });
    }
  }
}

console.log(`scanned ${files.length} text files under ${root}`);
if (hits.length === 0) {
  console.log('OK: no personal paths, names, emails or credentials found.');
  process.exit(0);
}
console.log(`\n${hits.length} hit(s):`);
for (const hit of hits) {
  console.log(`  ${hit.file}:${hit.line}  [${hit.label}]  ${hit.sample}`);
}
console.log('\nFix them, or add an explicit placeholder (<用户>, … , <plugin-root>) before publishing.');
process.exit(1);
