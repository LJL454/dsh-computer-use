/**
 * 降级挂载（研究报告 P1-A 的中期做法）。
 *
 * 如果宿主导入失败（`@deepseek-ai/dsh-tools` / `dsh-scope` 解析不到、asar 在当前运行时读不了、
 * 两份实例冲突……），旧行为是整个模块导入失败：`apply()` 一行都没跑，`/computer-use/*`
 * 全是 404，界面上只能看到“装好了但没反应”。运维此时没有任何可读的东西——插件自己就是坏的那一段。
 *
 * 这里注册一个**最小可用面**：不带任何工具、不启动 worker，只把失败原因挂成两条只读路由，
 * 让 `GET /computer-use/status` 回答 503 + 结构化原因，而不是 404。这样：
 *
 *   * 宿主加载失败与“工具没注册”“worker 起不来”能分开看；
 *   * 离线诊断与现场排查都有一条稳定入口；
 *   * 不假装成功：`ok:false`、HTTP 503、`state:'failed'`，绝不注册任何能动作的工具。
 */
import { PACKAGE_ROOT, readPackageManifest } from './release-manifest.mjs';

/** 与正常实现共用同一个路由前缀。 */
const ROUTE = '/computer-use';

/** 与 index.js 的 `sendJson` 等价：降级模块不 import 主实现，避免把大模块图拖进来。 */
function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  try {
    res.statusCode = status;
    res.setHeader?.('content-type', 'application/json; charset=utf-8');
    res.setHeader?.('cache-control', 'no-store');
    res.end(text);
  } catch {
    // A dead socket is not this module's problem; the payload was already built.
  }
}

/**
 * 把一次导入失败变成可读的降级插件。
 * @param {object} ctx - Cordis context（可能只有 `inject` / `logger`）。
 * @param {object} config - 插件配置（降级时不使用）。
 * @param {Error & { code?: string, resolution?: unknown }} error - 顶层导入抛出的错误。
 */
export function applyDegraded(ctx, config, error) {
  const payload = {
    ok: false,
    state: 'failed',
    stage: 'resolve/import',
    code: error?.code ?? 'HOST_PACKAGE_IMPORT_FAILED',
    message: String(error?.message ?? error),
    resolution: error?.resolution ?? null,
    plugin: '@local/dsh-computer-use',
    version: versionOf(),
    executable: process.execPath ?? '',
    electron: process.versions.electron ?? null,
    node: process.versions.node ?? '',
    note: 'host half is mounted in degraded mode: no tools, no backend, no actions',
    at: new Date().toISOString(),
  };

  try {
    ctx?.logger?.error?.(`computer-use: degraded mount — ${payload.code}: ${payload.message}`);
  } catch { /* a logger that throws must not take the row down */ }

  try {
    ctx?.inject?.(['webServer'], (scoped) => {
      scoped.effect(
        () => scoped.webServer.register({
          kind: 'exact',
          path: `${ROUTE}/status`,
          handler: (req, res) => sendJson(res, 503, payload),
        }),
        'computer-use: degraded status route',
      );
      scoped.effect(
        () => scoped.webServer.register({
          kind: 'exact',
          path: `${ROUTE}/doctor`,
          handler: (req, res) => sendJson(res, 503, payload),
        }),
        'computer-use: degraded doctor route',
      );
    });
  } catch { /* no web server in this profile: the stderr line above is the record */ }
}

/** The plugin version, read from the package manifest; never throws. */
function versionOf() {
  try {
    const manifest = readPackageManifest(PACKAGE_ROOT).manifest;
    return typeof manifest?.version === 'string' ? manifest.version : '0.0.0-unversioned';
  } catch {
    return '0.0.0-unversioned';
  }
}
