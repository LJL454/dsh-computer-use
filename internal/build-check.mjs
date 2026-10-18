/**
 * 构建校验：宿主怎么确认"正在跑的工作进程就是这次装上的那份代码"（9.txt §7.2 / §13.5）。
 *
 * 从 `index.js` 搬出来的（§10 的宿主半边拆分）：这一块自成一体——它只读两个文件的哈希、
 * 记一个数字、有一个开关，不碰会话、工具或路由；把状态关在这里，比散在 6k 行的入口里好核对。
 *
 * 两条规矩：
 *
 *   1. **覆盖实际执行的全部代码**：`worker.ps1`（11.7k 行、被 dot-source 的长驻进程）与
 *      `release-input.ps1`（worker 被强杀时宿主亲自跑的那一个）。两个都要比哈希，因为两半
 *      版本不一致时"能跑"不等于"跑对了"。
 *   2. **读取有成本，所以有记忆，但记忆是可关的**：每次调用都同步读 606 KB 是 §7.2 要修的
 *      高频路径开销；这里改成异步读 + 按"文件身份（dev/ino/size/mtime）"记忆 + 30 秒上限，
 *      并留一个开关（`verifyWorkerBuildEveryCall`）在排查时退回"每次都真读"。
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** 工作进程脚本的位置。 */
export const WORKER_PATH = fileURLToPath(new URL('../backend/worker.ps1', import.meta.url));

/**
 * 宿主自己执行的第二个脚本（`backend/release-input.ps1`）。
 *
 * 它在 worker 被强杀的瞬间运行，所以是版本不一致里最危险的一处：它按记录按键，而记录来自
 * 另一个构建的话，按下去的可能是用户从没按过的键。
 */
export const RELEASE_PATH = fileURLToPath(new URL('../backend/release-input.ps1', import.meta.url));

/**
 * 一个文件的构建标识，原样读盘。
 *
 * 给宿主**自己**执行的脚本用：它们很小、每次启动只读一次，而且不在热路径上——老实读一遍就是
 * 最合适的做法。
 * @param {string} path 文件路径。
 * @returns {Promise<string>} 16 个十六进制字符，读不到时为空串。
 */
export async function hashFileOnDisk(path) {
  try {
    const bytes = await readFile(path);
    return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  } catch {
    return '';
  }
}

/** 记忆可以被信任多久（§7.2）。过了这个点就重新读一遍。 */
const BUILD_TRUST_MS = 30_000;

/** 上次校验过的摘要，连同它来自的那个文件身份。 */
let buildVerification = null;
/** 正在进行的读取，好让并发校验共用同一次 606 KB 的读。 */
let buildReadInFlight = null;
/** 真正读过并哈希过几次——作为诊断数字上报（`runtime.metrics.buildReads`）。 */
let buildReads = 0;
/**
 * 记忆是否可用（§13.6 的受控回退）。
 *
 * 配置 `verifyWorkerBuildEveryCall: true` 会把它关掉，于是每次校验都真读文件；除了"是否记忆"
 * 之外什么都不变，所以它适合用来判断"某次诡异行为是不是缓存造成的"。
 */
let buildCacheEnabled = true;

/**
 * 文件身份：设备号、inode、大小、mtime。
 *
 * 刻意不止"时间戳没变"：一次复用时间戳的替换（或同一文件系统刻内写出同样大小的构建）会改变
 * inode 或大小，组合起来才让下面那条捷径变成**可核对的判断**而不是猜测。读不到身份时返回空串，
 * 调用方就会去真读。
 * @returns {string} 身份字符串，或空串。
 */
function workerFileIdentity() {
  try {
    const info = statSync(WORKER_PATH);
    return `${info.dev}:${info.ino}:${info.size}:${Math.round(info.mtimeMs)}`;
  } catch {
    return '';
  }
}

/**
 * 构建标识：不阻塞事件循环，也不是每次都真读。
 *
 *   - 读取是异步的，并发校验共用同一次进行中的读；
 *   - 摘要与**文件身份**一起记住，只有身份没变且记忆未过期才复用；
 *   - 身份变了（或读不到身份）就落到真读，所以被替换的文件仍会被发现，旧 worker 也不会被放行。
 * @returns {Promise<string>} 16 个十六进制字符，读不到时为空串。
 */
export async function workerBuildOnDiskAsync() {
  const identity = workerFileIdentity();
  if (identity === '') return '';
  if (buildCacheEnabled
    && buildVerification !== null
    && buildVerification.identity === identity
    && Date.now() - buildVerification.at < BUILD_TRUST_MS) {
    return buildVerification.digest;
  }
  if (buildReadInFlight !== null) return await buildReadInFlight;
  const attempt = (async () => {
    try {
      const bytes = await readFile(WORKER_PATH);
      const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
      buildReads += 1;
      // 身份在**读之后**取：读写之间文件若变过，记下的就是新身份，下次会重读。
      buildVerification = { identity: workerFileIdentity(), digest, at: Date.now() };
      return digest;
    } catch {
      return '';
    }
  })().finally(() => {
    if (buildReadInFlight === attempt) buildReadInFlight = null;
  });
  buildReadInFlight = attempt;
  return await attempt;
}

/** 真正读过几次（诊断用，状态路由上报）。 */
export function buildReadsCount() {
  return buildReads;
}

/** 打开/关闭摘要记忆（§13.6）。 */
export function setBuildCacheEnabled(enabled) {
  buildCacheEnabled = enabled !== false;
}
