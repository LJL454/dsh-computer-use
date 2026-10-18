/**
 * 临时取证：宿主 `ctx.effect()`（也就是 `tools.restrict()` 转手的那一层）到底返回什么。
 *
 * 直接 import 应用里那份 @deepseek-ai/cordis 4.0.5（跟 dsh-tools 用的是同一个包），
 * 断言三件事：
 *   1. disposer 的 typeof
 *   2. 它身上有没有 `.dispose` / `[Symbol.dispose]`
 *   3. `disposer.dispose?.()` 与 `disposer()` 各自真正清理掉了几条资源
 *
 * 用法：node verify-disposer-contract.mjs
 *      DSH_APP_NODE_MODULES=<DSH 安装目录>/resources/app/dsh/node_modules node verify-disposer-contract.mjs
 */
import { importFromApp } from './tests/host-app.mjs';

const { Context } = await importFromApp('@deepseek-ai/cordis/lib/index.js');

let cleaned = 0;
const ctx = new Context();
const disposer = ctx.effect(() => () => { cleaned += 1; });

console.log('typeof disposer          :', typeof disposer);
console.log('disposer.dispose         :', disposer.dispose);
console.log('disposer[Symbol.dispose] :', disposer[Symbol.dispose]);

disposer.dispose?.();
console.log('after disposer.dispose?.() -> cleaned =', cleaned);

disposer();
console.log('after disposer()           -> cleaned =', cleaned);

const objectish = { dispose: () => { cleaned += 1; } };
objectish.dispose?.();
console.log('object stub .dispose?.()   -> cleaned =', cleaned);
