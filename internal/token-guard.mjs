/**
 * token-guard —— 把过大的工具返回压成结构化摘要。
 *
 * 原本是独立插件 `@local/dsh-token-guard`，现已并入本插件；逻辑保持原样，只有一处删减：
 * 原插件里那段「把 agent-preset 注册表读出来写成 presets-seen.json」的取证脚手架不再需要
 * （预设行本身保留，见 cordis.patch.yml）。
 *
 * 6.txt §三-2 的三条要求在下面依次落地：
 *   1. 模型读到的是**决策就绪**的摘要（status / exit code / 关键结果 / 错误摘要 / 是否被截断），
 *      而不是原始输出；
 *   2. 普通结果控制在 ~300–800 token，排障结果 ~2,000 以内；
 *   3. 大日志、目录树、完整 JSON 落到文件里，返回里带上定位符，保证任何东西都还能找回。
 *
 * 挂的是 harness 自己 spill 策略用的同一个缝 —— `tools/post-execute`，但不带 `prepend`，
 * 因此摘要先产生，再由那套策略按自己的预算检验。已经够小的结果**原样返回（逐字节相同）**；
 * 带图的结果默认不碰（图像路径另有专项，不能受这里扰动）。
 *
 * 每次压缩追加一行指标到 JSONL，供配对测试直接读，而不是从对话里猜。
 */
import { appendFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseOutput, renderSummary, summarizeToolText, estimateTokens } from './summarize.js';

const DEFAULTS = {
  /** 总开关：false 时工具返回完全不变。 */
  enabled: true,
  /** 允许压缩的工具名。 */
  tools: ['pwsh'],
  /** 普通成功结果的预算（估算 token）。 */
  normalMaxTokens: 800,
  /** 失败/排障结果的预算（非零退出、错误、沙箱拒绝）。 */
  troubleshootingMaxTokens: 2000,
  /** 带图结果不碰（另行测量）。 */
  skipImageResults: true,
  /** 保存完整输出并在摘要里给出定位符。 */
  keepFullOutput: true,
  /** 完整输出落盘目录；开启删除策略时也只清理这里。 */
  fullOutputDir: '',
  /**
   * 删除策略：独立开关，默认关闭（§8.3 第 8 条）。
   *
   * `keepFullOutput` 决定"要不要保留"，它不该顺带拥有"删除用户文件"的权力。
   */
  pruneFullOutput: false,
  /** `pruneFullOutput` 打开时保留多少个最近的完整输出文件。 */
  fullOutputKeep: 100,
  /** 每次压缩追加一行 JSON。 */
  metrics: true,
  /** 指标文件；默认为 `<dsh home>/token-guard/metrics.jsonl`。 */
  metricsPath: '',
  /** 指标缓冲多少行后立即落盘。 */
  metricsBatchLines: 20,
  /** 否则最多等这么久（毫秒）再落盘。 */
  metricsFlushMs: 1000,
};

/** 原插件写在用户主目录下，保持同一位置，历史指标不断档。 */
function homeDir() {
  return process.env.DSH_HOME
    || (process.env.USERPROFILE ? join(process.env.USERPROFILE, '.dsh') : process.cwd());
}

/**
 * 合并配置与默认值，并挡掉会破坏契约的取值（预算为 0 会静默删掉每一个结果）。
 *
 * @param raw - 合并后插件配置里的 `tokenGuard` 段（或原插件行的 config，键名相同）。
 * @returns 生效的设置。
 */
export function resolveGuardSettings(raw) {
  const settings = { ...DEFAULTS, ...(raw ?? {}) };
  for (const key of ['normalMaxTokens', 'troubleshootingMaxTokens']) {
    if (!Number.isFinite(settings[key]) || settings[key] < 120) {
      settings[key] = DEFAULTS[key];
    }
  }
  if (!Array.isArray(settings.tools) || settings.tools.length === 0) {
    settings.tools = [...DEFAULTS.tools];
  }
  if (settings.fullOutputDir === '') settings.fullOutputDir = join(homeDir(), 'token-guard', 'full');
  if (settings.metricsPath === '') settings.metricsPath = join(homeDir(), 'token-guard', 'metrics.jsonl');
  if (!Number.isFinite(settings.fullOutputKeep) || settings.fullOutputKeep < 1) {
    settings.fullOutputKeep = DEFAULTS.fullOutputKeep;
  }
  if (!Number.isFinite(settings.metricsBatchLines) || settings.metricsBatchLines < 1) {
    settings.metricsBatchLines = DEFAULTS.metricsBatchLines;
  }
  if (!Number.isFinite(settings.metricsFlushMs) || settings.metricsFlushMs < 0) {
    settings.metricsFlushMs = DEFAULTS.metricsFlushMs;
  }
  return settings;
}

/** 把结果里所有文本块拼起来，并按顺序记下非文本块。 */
function splitContent(content) {
  const texts = [];
  const others = [];
  for (const block of content ?? []) {
    if (block?.type === 'text') texts.push(block.text ?? '');
    else others.push(block);
  }
  return { text: texts.join('\n'), others };
}

/**
 * 把完整输出放到模型仍能读到的地方。
 *
 * spill 库是 harness 原生路径（带保留期与会话归属）；插件自己的目录是兜底，
 * 这样即使组合里没有 `dsh-spill-local`，摘要里也照样给出一个可读路径。
 *
 * @returns 定位符，以及摘要里该带的那一行。
 */
async function keepFullOutput(ctx, settings, exec, text) {
  const owner = exec?.agent?.session?.header?.id;
  const callId = String(exec?.callId ?? 'call');
  const spillStore = ctx.get?.('spillStore');
  if (spillStore !== undefined && owner !== undefined) {
    try {
      const ref = await spillStore.saveText({
        owner: { sessionId: owner },
        source: { kind: 'tool', toolName: exec.name, callId, label: 'result' },
        suggestedName: `${exec.name}.txt`,
        content: text,
      });
      return {
        locator: ref?.locator,
        line: `完整输出: ${ref?.locator} (${ref?.bytes ?? text.length} bytes) — ${ref?.retrievalHint ?? 'read/grep 该路径'}`,
        how: 'spill',
      };
    } catch (error) {
      ctx.logger?.warn?.(`computer-use/token-guard: spill failed (${String(error)}); writing a local copy`);
    }
  }
  try {
    const file = join(settings.fullOutputDir, `${owner ?? 'session'}-${callId}.txt`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text, 'utf8');
    return {
      locator: file,
      line: `完整输出: ${file} (${Buffer.byteLength(text, 'utf8')} bytes) — 用 read 读取，或用 grep 在该文件内检索`,
      how: 'local-file',
    };
  } catch (error) {
    ctx.logger?.warn?.(`computer-use/token-guard: local copy failed (${String(error)})`);
    return { locator: undefined, line: '完整输出: 未保存（spill 与本地写入都不可用）', how: 'none' };
  }
}

/**
 * 指标改为缓冲写入（§8.3 第 7 条）。
 *
 * 每次调用都 `mkdir` + `appendFile`，等于让工具结果等两次文件系统往返 —— 而指标是诊断，
 * 不是结果。这里把行先放进内存队列，按条数或时间合并成一次写入；插件卸载时冲刷。
 * 指标永远不能让工具结果失败：任何错误只记日志。
 *
 * @param settings - 已解析的设置。
 * @returns `{ push, flush, size }`。
 */
function createMetricBuffer(settings) {
  const pending = [];
  let timer = null;
  const write = async () => {
    if (pending.length === 0) return;
    const batch = pending.splice(0, pending.length);
    try {
      await mkdir(dirname(settings.metricsPath), { recursive: true });
      await appendFile(settings.metricsPath, batch.map((row) => `${JSON.stringify(row)}\n`).join(''), 'utf8');
    } catch {
      /* metrics are best effort by design */
    }
  };
  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    return write();
  };
  return {
    push(row) {
      if (!settings.metrics) return;
      pending.push(row);
      if (pending.length >= settings.metricsBatchLines) {
        void flush();
        return;
      }
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null;
          void write();
        }, settings.metricsFlushMs);
        timer.unref?.();
      }
    },
    flush,
    size: () => pending.length,
  };
}

/**
 * 保留策略与删除策略分开配置（§8.3 第 8 条）。
 *
 * 保留输出本身由 `keepFullOutput` 决定；**删除**由 `pruneFullOutput` 单独决定，默认关闭：
 * 一个"写下完整输出"的开关不应该顺带拥有删除用户文件的权力。开启时只清理插件自己的目录
 * （`fullOutputDir`），保留最近的 `fullOutputKeep` 个文件，spill 库里的内容始终不碰。
 *
 * @returns 删除的文件数，以及目录里的文件总数。
 */
async function pruneFullOutput(settings) {
  if (!settings.pruneFullOutput) return { deleted: 0, kept: undefined };
  try {
    const entries = (await readdir(settings.fullOutputDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
    if (entries.length <= settings.fullOutputKeep) return { deleted: 0, kept: entries.length };
    const stats = [];
    for (const name of entries) {
      const info = await stat(join(settings.fullOutputDir, name)).catch(() => null);
      stats.push({ name, at: info?.mtimeMs ?? 0 });
    }
    stats.sort((a, b) => a.at - b.at);
    const doomed = stats.slice(0, Math.max(0, stats.length - settings.fullOutputKeep));
    let deleted = 0;
    for (const item of doomed) {
      try {
        await rm(join(settings.fullOutputDir, item.name), { force: true });
        deleted += 1;
      } catch {
        /* a file in use stays */
      }
    }
    return { deleted, kept: stats.length - deleted };
  } catch {
    return { deleted: 0, kept: undefined };
  }
}

/**
 * 挂上压缩钩子。
 *
 * @param ctx - 插件上下文；需要 `ctx.on`。
 * @param config - 合并后插件配置里的 `tokenGuard` 段。
 * @returns 生效的设置（便于调用方记录/断言），未启用时返回 undefined。
 */
export function applyTokenGuard(ctx, config = {}) {
  const settings = resolveGuardSettings(config);
  if (!settings.enabled) {
    ctx.logger?.info?.('computer-use/token-guard: disabled by config; tool returns pass through unchanged');
    return undefined;
  }
  const allowed = new Set(settings.tools);
  const metricBuffer = createMetricBuffer(settings);
  // 插件卸载时把缓冲里的指标冲刷到磁盘：一个缓冲写入不能因为进程结束而丢掉最后几行。
  ctx.effect?.(() => {
    const dispose = () => {
      void metricBuffer.flush();
    };
    return dispose;
  }, 'computer-use: token-guard metrics flush');

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next();
    try {
      if (decision?.kind !== 'accept') return decision;
      if (Object.hasOwn(decision, 'value')) return decision;
      if (!allowed.has(exec?.name)) return decision;
      const content = decision.content ?? result?.content ?? [];
      const { text, others } = splitContent(content);
      if (text.length === 0) return decision;
      if (settings.skipImageResults && others.some((block) => block?.type === 'image')) return decision;

      const limits = {
        normalMaxTokens: settings.normalMaxTokens,
        troubleshootingMaxTokens: settings.troubleshootingMaxTokens,
      };
      // §8.3: 解析只做一次。判断"要不要压缩"用的是这次解析的结果，生成摘要也用它——
      // 过去这里先跑一遍 summarizeToolText 只为读 stats.summarized，再跑第二遍。
      const parsed = parseOutput(text, { limits });
      if (!parsed.overBudget) return decision;

      const kept = settings.keepFullOutput
        ? await keepFullOutput(ctx, settings, exec, text)
        : { locator: undefined, line: '完整输出: 未保存（keepFullOutput=false）', how: 'none' };
      if (settings.keepFullOutput && kept.how === 'none') {
        // §8.3: 压缩的前提是原文仍然可读。spill 与本地落盘都失败时，摘要里那句"完整输出"
        // 就成了空头承诺——此时保留原文，宁可多花 token，也不把唯一一份输出丢掉。
        ctx.logger?.warn?.('computer-use/token-guard: the full output could not be stored; keeping the original result instead of a summary that would promise a path nobody can read');
        return decision;
      }
      if (settings.keepFullOutput) await pruneFullOutput(settings);
      const { text: summary, stats } = renderSummary(parsed, { note: kept.line });

      metricBuffer.push({
        time: Date.now(),
        sessionId: exec?.agent?.session?.header?.id,
        callId: exec?.callId,
        tool: exec.name,
        turn: exec?.agent?.session?.header?.turn,
        inputTokens: stats.inputTokens,
        outputTokens: stats.outputTokens,
        inputBytes: stats.inputBytes,
        budgetTokens: stats.budgetTokens,
        status: stats.status,
        exitCode: stats.exitCode,
        ok: stats.ok,
        keptLines: stats.keptLines,
        omittedLines: stats.omittedLines,
        clampedLines: stats.clampedLines ?? 0,
        fullOutput: kept.locator,
        fullOutputHow: kept.how,
      });

      // 文本被摘要替换；非文本块按原顺序跟在后面。
      const rebuilt = [{ type: 'text', text: summary }, ...others];
      return { ...decision, content: rebuilt };
    } catch (error) {
      ctx.logger?.warn?.(`computer-use/token-guard: ${String(error)}; keeping the original result`);
      return decision;
    }
  });
  return settings;
}

export { estimateTokens };
export const tokenGuardDefaults = DEFAULTS;
