/**
 * app-launch —— 用干净的环境启动 GUI 应用。
 *
 * 原本是独立插件 `@local/dsh-app-launch`，现已并入本插件；工具名、参数、输出与行为保持不变。
 *
 * 为什么需要它：DSH 会话导出的环境里带着 `ELECTRON_RUN_AS_NODE=1`，Electron 程序会因此
 * 退化成普通 Node 解释器 —— 没有窗口、退出码 0，表现为"启动了但什么都没出现"。
 * 两个工具：
 *   app_launch     —— 启动目标（exe / 文档 / URL / Store 应用），先摘掉 Electron/Node 注入变量，
 *                     再报出真正出现的窗口与被摘掉的每一个变量。
 *   app_env_audit  —— 只回答"本会话是否受影响、启动器会摘掉什么"，什么都不启动。
 *
 * 所有实际工作都在 ./app-launch.js 里，便于脱离 Cordis 单测。
 */
import { ELECTRON_SENSITIVE_VARS, auditEnvironment, envReport, launchApp } from './app-launch.js';

const DEFAULTS = {
  /** 总开关：false 时两个工具都不注册。 */
  enabled: true,
  /** 与模块默认一致；放在配置里以便 profile 扩展。 */
  stripVars: ELECTRON_SENSITIVE_VARS,
  /** 等窗口出现多久才回话（毫秒）。 */
  defaultWaitMs: 6000,
  /** 启动后不把应用挂在会话下。 */
  detach: true,
};

/**
 * 挂上两个启动工具。
 *
 * @param ctx - 插件上下文；需要 `ctx.tools.register`。
 * @param config - 合并后插件配置里的 `appLaunch` 段。
 * @param options - `{ defineTool }`：默认用普通 `defineTool`；传入主插件的 traced 版本即可与
 *                  其它工具一样出现在 trace 里（合并后 index.js 就是这么做的）。
 * @returns 生效的设置，未启用时返回 undefined。
 */
export function applyAppLaunch(ctx, config = {}, options = {}) {
  const settings = { ...DEFAULTS, ...(config ?? {}) };
  if (!settings.enabled) {
    ctx.logger?.info?.('computer-use/app-launch: disabled by config');
    return undefined;
  }
  // `defineTool` 不再从宿主包里静态 import：`link:` 安装时 Node 从插件目录往上找，
  // 找不到应用里的那份，整个模块图会在加载阶段就失败（见 internal/host-packages.mjs）。
  // 主插件解析好之后通过 options 传进来；没有就不挂这两个工具，而不是把整行拖垮。
  const define = options.defineTool;
  if (typeof define !== 'function') {
    ctx.logger?.warn?.('computer-use/app-launch: no defineTool was supplied; app_launch and app_env_audit stay off');
    return undefined;
  }
  const extraStrip = (settings.stripVars ?? []).filter((name) => !ELECTRON_SENSITIVE_VARS.includes(name));
  const audit = auditEnvironment(process.env, extraStrip);
  if (audit.sessionIsPolluted) {
    ctx.logger?.info?.('computer-use/app-launch: this session carries %s — GUI launches go through app_launch to strip it',
      audit.wouldStrip.join(', '));
  }

  ctx.tools.register(define({
    name: 'app_launch',
    description:
      'Start an application (or open a document/URL) with a clean environment. Use this instead of a bare shell command whenever the target might be an Electron app: this session exports ELECTRON_RUN_AS_NODE=1, which makes Electron binaries run as a plain Node interpreter — no window, exit code 0. `app_launch` removes that (and the other Electron/Node-injection variables), starts the target detached, and reports the window title and pid that actually appeared, including for single-instance apps that hand off to a sibling process.',
    parameters: {
      target: { type: 'string', required: true, description: 'Absolute path to an .exe, or a document/URL/`shell:` target to open through the shell.' },
      arguments: { type: 'array', items: { type: 'string' }, description: 'Command-line arguments passed to the target.' },
      cwd: { type: 'string', description: 'Working directory for the child process.' },
      waitMs: { type: 'integer', description: 'How long to wait for a window before answering (default 6000, max 60000).' },
      detach: { type: 'boolean', description: 'Leave the application running after the call (default true).' },
      verifyWindow: { type: 'boolean', description: 'Look for a window before answering (default true). Set false for a pure fire-and-forget launch.' },
      kind: { type: 'string', description: '`store` to launch a packaged (Store/MSIX) app through the shell instead of spawning a binary.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          target: { type: 'string', required: true },
          resolved: { type: 'string', required: true },
          viaExplorer: { type: 'boolean', required: true },
          pid: { type: 'integer', required: true },
          imageName: { type: 'string' },
          // 进程还活着时 exited/exitCode 的取值就是 null（launchApp 的"未知"档）。声明里必须可空，
          // 否则 host 会以 "value.exitCode must be an integer" 拒掉这次调用 —— 而"直接启动一个常驻
          // GUI 应用"正是本工具的主场景（顺带：undefined 才会被 host 跳过，null 会被当成真实值检查）。
          exited: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
          exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
          stripped: { type: 'array', items: { type: 'string' }, required: true },
          state: { type: 'string', required: true, enum: ['window', 'running', 'running-no-window', 'exited-without-window', 'launch-failed'], description: "How the launch actually ended up: 'window' (a window of the launched process is there), 'running' (the process is alive and no window was looked for), 'running-no-window' (alive, but nothing appeared inside the wait), 'exited-without-window' (it exited and never showed one) or 'launch-failed' (it never started — see `error`)." },
          error: { type: 'string', description: 'Why the target could not be started at all. Separate from a target that started and then exited: those are different problems with different fixes.' },
          windowMatch: { type: 'string', description: "What evidence the windows below rest on: 'target' (the pid or the image name matched), 'started-window' (only \"a window appeared around the same time\"), or 'none'." },
          fuzzyMatch: { type: 'boolean', description: 'True when the only evidence is the start time, so the window listed may belong to something else that started at the same moment. Verify before acting on it.' },
          waitedMs: { type: 'integer', description: 'How long the launch actually waited. The wait ends early once a window is confirmed, so this is usually smaller than waitMs.' },
          inspectionError: { type: 'string', description: 'Present when the window inspection itself failed, which is not the same as "no window appeared".' },
          windows: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                pid: { type: 'integer', required: true },
                title: { type: 'string', required: true },
                matchedBy: { type: 'string', description: "Which lookup found it: 'pid', 'name' or 'started'." },
                fuzzy: { type: 'boolean', description: 'This row rests on the start time alone.' },
              },
            },
          },
          durationMs: { type: 'integer', required: true },
          hint: { type: 'string' },
        },
      },
      // host 把 render 的产出当作"模型实际收到的内容"，所以值里每一档都要在这里说清楚：
      // 声明了 output.schema 就必须有 render —— 缺了它，host 会报
      // "output.render failed: userRender is not a function"（defineTool 无条件包了这一层）。
      render: (args, value) => {
        const lines = [];
        // The first line is the *state*, not a boolean: "it never started", "it started and
        // exited", "it is running with nothing on screen" and "it has a window" are four
        // different answers, and the old line called three of them "no window and the process
        // is gone" (§6: 应用启动错误事件被吞掉).
        const headline = value.state === 'window'
          ? 'launched'
          : value.state === 'launch-failed'
            ? 'could not be started'
            : value.state === 'exited-without-window'
              ? 'exited without opening a window'
              : value.state === 'running-no-window'
                ? 'running, but no window appeared'
                : 'started';
        lines.push(`${headline}: ${value.target}${value.viaExplorer ? ' (through the shell)' : ''}${value.pid > 0 ? ` — pid ${value.pid}` : ''}`);
        if (value.error !== undefined) lines.push(`  ${value.error}`);
        if (value.exited === true) lines.push(`  the process already exited (code ${value.exitCode === null ? 'unknown' : value.exitCode})`);
        else if (value.exited === false) lines.push(`  the process is still running ${value.durationMs} ms after the launch`);
        if (value.windows.length > 0) {
          lines.push(`  ${value.windows.length} window(s)${value.fuzzyMatch === true ? ' — matched by start time only, so check that these belong to the target' : ''}:`);
          for (const window of value.windows) lines.push(`    pid ${window.pid}: "${window.title}" (matched by ${window.matchedBy ?? 'unknown'})`);
        } else if (args?.verifyWindow === false) {
          lines.push('  window verification was skipped (verifyWindow: false)');
        } else if (value.inspectionError !== undefined) {
          lines.push(`  the window inspection failed, so "no window" is not established: ${value.inspectionError}`);
        } else {
          lines.push(`  no window was found within ${value.waitedMs ?? value.durationMs} ms`);
        }
        lines.push(value.stripped.length > 0
          ? `stripped from the child environment: ${value.stripped.join(', ')}`
          : 'nothing needed stripping: the child environment was already clean');
        if (value.hint !== undefined) lines.push(value.hint);
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    async execute(args) {
      return launchApp({
        ...args,
        extraStrip,
        waitMs: args.waitMs ?? settings.defaultWaitMs,
        detach: args.detach ?? settings.detach,
        powershell: settings.powershell,
      });
    },
  }));

  ctx.tools.register(define({
    name: 'app_env_audit',
    description:
      'Report whether this session carries Electron/Node-injection environment variables (ELECTRON_RUN_AS_NODE et al.) and which of them `app_launch` would strip. Read-only; starts nothing. Use it when an application "does not open" with no window and exit code 0.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionIsPolluted: { type: 'boolean', required: true },
          present: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                value: { type: 'string', required: true },
              },
            },
          },
          wouldStrip: { type: 'array', items: { type: 'string' }, required: true },
          explanation: { type: 'string', required: true },
        },
      },
      render: (_args, value) => {
        const lines = [
          value.sessionIsPolluted
            ? 'this session is polluted — launch GUI apps through app_launch, not a bare shell.'
            : 'this session is clean: no Electron/Node-injection variables are set.',
        ];
        if (value.present.length > 0) {
          lines.push('present:');
          for (const row of value.present) lines.push(`  ${row.name}=${row.value}`);
        }
        lines.push(value.wouldStrip.length > 0
          ? `app_launch would strip: ${value.wouldStrip.join(', ')}`
          : 'app_launch would strip nothing');
        lines.push(value.explanation);
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    async execute() {
      return envReport(extraStrip);
    },
  }));

  return settings;
}

export { ELECTRON_SENSITIVE_VARS };
export const appLaunchDefaults = DEFAULTS;
