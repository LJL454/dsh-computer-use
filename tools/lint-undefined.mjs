/**
 * 静态检查：找出"用了但没声明/没导入"的标识符——也就是 `node --check` 抓不到的那类错。
 *
 * 为什么需要它：这轮拆分里踩过两次同样的坑，都是**语法合法、运行到那行才炸**：
 *
 *   - `STEP_ACTION_LIST is not defined`（模块里用了别处的常量，忘了 import）；
 *   - `observedDigests is not defined`（同上）。
 *
 * 还有一次更隐蔽：一个函数被截断成 `if (...) ret  }`——`ret` 是个未声明标识符，但语法合法，
 * 而且同名函数声明后者覆盖前者，于是套件全绿、问题潜伏。
 *
 * 做法（不做完整作用域分析，做"可疑清单"）：把注释与字符串/模板字符串剥掉，收集所有声明
 * （import、各层级的 const/let/var/function/class、参数、解构模式），再找出剩下的标识符用法，
 * 排除属性访问（`.foo`）、对象字面量的键（`foo:`）与已知全局。剩下的按"可疑度"分两档：
 *
 *   - **ALL_CAPS / 下划线常量**：几乎总是真错（比如漏 import 的常量）→ 非零退出；
 *   - **驼峰名字**：可能是真错，也可能是漏识别的声明形式 → 只列出来，不判失败（除非 `--strict`）。
 *
 * 用法：node tools/lint-undefined.mjs [--strict] [--file <path>]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');
const onlyAt = process.argv.indexOf('--file');
const ONLY = onlyAt === -1 ? null : process.argv[onlyAt + 1];

/** 宿主与后端的运行时代码（测试/工具脚本另算，它们可以依赖更多东西）。 */
const SOURCES = ['index.js', 'client.js'];
for (const dir of ['internal', 'backend', 'browser']) {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (/\.(mjs|js)$/.test(name)) SOURCES.push(`${dir}/${name}`);
  }
}

/** 语言/运行时里可以合法出现、不需要声明的名字。 */
const GLOBALS = new Set([
  // 语言
  'undefined', 'null', 'true', 'false', 'this', 'super', 'arguments', 'NaN', 'Infinity', 'globalThis',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Math', 'JSON', 'Date', 'RegExp',
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'EvalError', 'ReferenceError', 'URIError', 'AggregateError',
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'Intl', 'ArrayBuffer', 'Uint8Array',
  'Uint8ClampedArray', 'Int32Array', 'Float64Array', 'DataView', 'TextEncoder', 'TextDecoder', 'SharedArrayBuffer',
  'Function', 'Generator', 'AsyncFunction', 'Iterator', 'AsyncIterator', 'Proxy', 'structuredClone', 'atob', 'btoa',
  // 运行时
  'process', 'console', 'Buffer', 'URL', 'URLSearchParams', 'AbortController', 'AbortSignal', 'fetch',
  'WebSocket', 'Headers', 'Request', 'Response', 'FormData', 'Blob', 'File', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'performance',
  'require', 'module', 'exports', '__dirname', '__filename', 'import', 'export', 'await', 'async', 'yield',
  'global', 'navigator', 'document', 'window', 'self', 'location', 'localStorage', 'crypto', 'loadImage',
  'encodeURIComponent', 'decodeURIComponent', 'escape', 'unescape', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  // 本工具自己产出的 ${ 标记：不是标识符
  '$',
]);

/** JS 关键字/保留字：它们当然"没被声明"，但也不是标识符用法。 */
const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'class', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case',
  'default', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new', 'delete', 'typeof', 'instanceof',
  'in', 'of', 'void', 'yield', 'await', 'async', 'static', 'get', 'set', 'extends', 'super', 'this', 'import',
  'export', 'from', 'as', 'null', 'true', 'false', 'undefined',
]);

/**
 * 去掉注释、字符串/模板字符串、正则字面量的**内容**（保留引号与换行，便于定位与识别 import）。
 *
 * 第一版用正则做这件事，踩了两个坑：① 引号也被抹掉，导致 `from '...'` 认不出来；② 正则字面量
 * （`/\[SEND_INPUT_BLOCKED\]|.../i`）与**嵌套模板字符串**里的内容被当成代码扫，报了一堆假阳性。
 * 所以这里改成状态机：模板字符串里遇到 `${` 递归当代码处理，`/` 前面是运算符/括号等位置时按正则处理。
 */
function stripNoise(text) {
  let out = '';
  let index = 0;
  const prevSignificant = () => {
    for (let at = out.length - 1; at >= 0; at -= 1) {
      const char = out[at];
      if (char === '\n' || char === ' ') continue;
      return char;
    }
    return '';
  };
  const blank = (char) => (char === '\n' ? '\n' : ' ');

  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    // 注释
    if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') { out += ' '; index += 1; }
      continue;
    }
    if (char === '/' && next === '*') {
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) {
        out += blank(text[index]); index += 1;
      }
      out += '  '; index += 2;
      continue;
    }
    // 字符串
    if (char === "'" || char === '"') {
      out += char; index += 1;
      while (index < text.length && text[index] !== char) {
        if (text[index] === '\\') { out += '  '; index += 2; continue; }
        out += blank(text[index]); index += 1;
      }
      out += char; index += 1;
      continue;
    }
    // 模板字符串：内容抹掉，但 `${…}` 里的表达式**按代码处理**（里面还可能有嵌套模板）
    if (char === '`') {
      out += '`'; index += 1;
      while (index < text.length && text[index] !== '`') {
        if (text[index] === '\\') { out += '  '; index += 2; continue; }
        if (text[index] === '$' && text[index + 1] === '{') {
          // 把 `${…}` 整段交给递归处理（保持长度：外层补空格）
          let depth = 1;
          let scan = index + 2;
          while (scan < text.length && depth > 0) {
            if (text[scan] === '{') depth += 1;
            else if (text[scan] === '}') depth -= 1;
            scan += 1;
          }
          const inner = text.slice(index + 2, scan - 1);
          const stripped = stripNoise(inner);
          out += `\${${stripped}}`;
          index = scan;
          continue;
        }
        out += blank(text[index]); index += 1;
      }
      out += '`'; index += 1;
      continue;
    }
    // 正则字面量：只在"这里不可能是除号"的位置按正则处理
    if (char === '/' && ![')', ']', 'word'].includes(prevSignificant()) && !/[\w$)\]]/.test(prevSignificant())) {
      let scan = index + 1;
      let inClass = false;
      while (scan < text.length) {
        const inner = text[scan];
        if (inner === '\\') { scan += 2; continue; }
        if (inner === '[') inClass = true;
        else if (inner === ']') inClass = false;
        else if (inner === '/' && !inClass) break;
        else if (inner === '\n') { scan = -1; break; }
        scan += 1;
      }
      if (scan > 0) {
        out += '/' + ' '.repeat(Math.max(0, scan - index - 1)) + '/';
        index = scan + 1;
        while (index < text.length && /[a-z]/.test(text[index])) { out += ' '; index += 1; } // flags
        continue;
      }
    }
    out += char;
    index += 1;
  }
  return out;
}

/** 收集声明名（含解构模式、无初始化的 `let x;`、对象方法简写里的方法名）。 */
function collectDeclarations(code) {
  const declared = new Set();
  const addPattern = (pattern) => {
    for (const match of pattern.matchAll(/([A-Za-z_$][\w$]*)/g)) {
      const name = match[1];
      if (/^(const|let|var|function|async|await|return|of|in|new|typeof|instanceof|void|delete)$/.test(name)) continue;
      declared.add(name);
    }
  };
  for (const match of code.matchAll(/import\s+([^;]+?)\s+from\s*['"`]/g)) addPattern(match[1].replace(/\bas\b/g, ' '));
  for (const match of code.matchAll(/import\s*\(\s*([^)]*)\)/g)) addPattern(match[1]);
  for (const match of code.matchAll(/\b(?:const|let|var)\s+([^=;]+?)\s*=/g)) addPattern(match[1]);
  // 无初始化的声明：`let cachedShot;` / `let a, b;`（第一版漏了这种，把 `cachedShot` 报成未声明）
  for (const match of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*)\s*;/g)) addPattern(match[1]);
  for (const match of code.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) declared.add(match[1]);
  for (const match of code.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) declared.add(match[1]);
  // 参数与 catch
  for (const match of code.matchAll(/(?:\(([^)]*)\)\s*=>|function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)|\bcatch\s*\(([^)]*)\))/g)) {
    addPattern(match[1] ?? '');
    addPattern(match[2] ?? '');
    addPattern(match[3] ?? '');
  }
  // for (const x of y) / for (x in y)
  for (const match of code.matchAll(/for\s*\(\s*(?:const|let|var)?\s*([^)]+?)\s+(?:of|in)\s/g)) addPattern(match[1]);
  // 对象字面量的方法简写：`factory(require) {` / `execute(args, exec) {`
  for (const match of code.matchAll(/(?:^|[{,]\s*)([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)) declared.add(match[1]);
  // **类方法**与缩进后的对象方法：`  readAx(args) {`、`  async readAx(args) {`、`  static x() {`、
  // `  #private() {`（类体里方法前面没有 `{` 或 `,`，上面那条抓不到；`if (x) {` 这类名字是关键字，
  // 早被过滤掉，所以这条安全）。**方法参数也要收进来**——第一版只收函数/箭头/catch 的参数，
  // 于是 `readAx(args)` 的 `args` 被报成未声明。
  for (const match of code.matchAll(/^\s+(?:async\s+|static\s+|get\s+|set\s+|\*\s*)*#?([A-Za-z_$][\w$]*)\s*(\([^)]*\))\s*\{/gm)) {
    declared.add(match[1]);
    addPattern(match[2]);
  }
  // 私有字段：`#startTimeoutMs = ...` / `#disposed;`（类里通过 `this.#x` 访问，不是"未声明标识符"）
  for (const match of code.matchAll(/#([A-Za-z_$][\w$]*)\s*[=;(]/g)) declared.add(match[1]);
  return declared;
}

/** 找出用到的标识符（排除属性访问、对象键、声明本身的位置）。 */
function collectUsages(code) {
  const usages = new Map();
  // 边界写法很要紧：`([\w$]*)(?!\s*:)` 会**回溯**——`max_nodes:` 会被截成 `max_node` 当成用法
  // （第一版就报了一堆这种假阳性）。所以标识符后面必须紧跟"非词字符、非点、非冒号"。
  for (const match of code.matchAll(/(^|[^.\w$#])([A-Za-z_$][\w$]*)(?![\w$.])(?!\s*:)/g)) {
    const name = match[2];
    const at = match.index + match[1].length;
    const line = code.slice(0, at).split('\n').length;
    if (!usages.has(name)) usages.set(name, line);
  }
  // 对象字面量的键 `foo:` 不算用法（上面的 lookahead 已排除，这里再兜一层）
  for (const match of code.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*:/g)) {
    usages.delete(match[2]);
  }
  return usages;
}

let hardFailures = 0;
let softFindings = 0;
const files = ONLY === null ? SOURCES : [ONLY];
for (const relative of files) {
  const full = join(ROOT, relative);
  try {
    statSync(full);
  } catch {
    console.error(`跳过（不存在）：${relative}`);
    continue;
  }
  const code = stripNoise(readFileSync(full, 'utf8'));
  const declared = collectDeclarations(code);
  const usages = collectUsages(code);
  if (process.argv.includes('--debug')) {
    console.log(`${relative}: 收集到声明 ${declared.size} 个，其中 import 名样例：${[...declared].slice(0, 12).join(', ')}`);
    console.log(`  WORKER_PATH 在声明集里？${declared.has('WORKER_PATH')}`);
    const sample = code.slice(code.indexOf('import {'), code.indexOf('import {') + 160);
    console.log(`  import 片段（剥噪声后）：${JSON.stringify(sample)}`);
  }
  const suspects = [...usages].filter(([name]) => !declared.has(name) && !GLOBALS.has(name) && !KEYWORDS.has(name));
  const hard = suspects.filter(([name]) => /^[A-Z][A-Z0-9_]*$/.test(name) || /^[a-z]+[A-Z]/.test(name) === false && name.includes('_'));
  const soft = suspects.filter(([name]) => !hard.includes(suspects.find(([other]) => other === name)));
  if (hard.length === 0 && soft.length === 0) {
    console.log(`${relative}: 无未声明标识符`);
    continue;
  }
  if (hard.length > 0) {
    hardFailures += hard.length;
    console.log(`${relative}: 可疑常量 ${hard.length} 个`);
    for (const [name, line] of hard) console.log(`  L${line}  ${name}`);
  }
  if (soft.length > 0) {
    softFindings += soft.length;
    console.log(`${relative}: 待人工确认 ${soft.length} 个`);
    for (const [name, line] of soft.slice(0, 25)) console.log(`  L${line}  ${name}`);
  }
}

console.log(`\n可疑常量 ${hardFailures} 个（非零退出），待确认 ${softFindings} 个${STRICT ? '（--strict 也判失败）' : ''}`);
if (hardFailures > 0 || (STRICT && softFindings > 0)) process.exitCode = 1;
