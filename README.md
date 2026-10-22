# @local/dsh-computer-use

DeepSeek Harness（DSH）的电脑操作能力：截图、鼠标、键盘、剪贴板、窗口与 UI Automation、
应用启动、批量动作，以及输入框工具栏里的「电脑操作」开关。

## 安装：一条命令

在解压出来的插件根执行：

```powershell
node setup.mjs
```

它做三件事：`dsh plugin add` 装进 profile → 清掉旧版可能留下的 `@deepseek-ai/dsh-tools`
副本 → 复核 profile 不会遮蔽宿主自带的包，最后打印结论。装完完整退出 DSH 再打开。

常用参数：`--profile web`、`--check`（只看不改）、`--app <目录>`（DSH 不在默认位置）。
不想敲命令就双击 `install-and-repair.cmd`，效果相同。

> 为什么不能"加进插件就自动跑"：pnpm 对 `link:` 依赖**不执行任何生命周期脚本**
> （`preinstall` / `install` / `postinstall` / `prepare` 四个都实测过，一个都没跑），
> 所以安装动作只能是一条命令或一个双击文件。

版本 **1.40.2**。本版修两个会让 DSH 直接不可用的问题，都不需要用户理解内部机制：

* **1.40.1 — 装完起不来**：旧版把 `@deepseek-ai/dsh-tools` 声明成 `optional: false` 的 peer，
  包管理器因此往 profile 里落一份实体副本；宿主的 `tools` 行优先从 profile 解析，版本一旦
  不一致就被 loader 禁用，全体注入 `tools` 的 row 挂起，`agent-loop` 是 required → 启动失败，
  弹窗还不点名任何插件。现在删掉该 peer，宿主统一用安装目录自带的那份（实测：profile 里没有
  该包时插件照常加载、工具照常注册）。
* **1.40.2 — 一次截图写死会话**：宿主的附件归一化会把超限 PNG 重编码成 WebP，而插件过去把
  **入参**的 `mediaType` 写进会话记录，形成"PNG 标签 + WebP 实体"。宿主每轮重放历史时按字节
  复核，判 `ATTACHMENT_CORRUPT`，该会话此后每一轮都在 step 1 失败。现在 `admitCapture()`
  整条 ref 透传（`mediaType` / `bytes` / `width` / `height` / `originalDimensions` 同源），
  `IMAGE_VALUE_SCHEMA` 相应放行 `originalDimensions`，并加了会咬人的回归测试。

1.40.0 的内容（重复挂载拒绝、`engines.dsh`、`doctor` 离线/在线分层、全发行 `releaseBuildId`、
预设拆包等）见 [CHANGELOG.md](CHANGELOG.md)。

## 1. 它提供什么

| 部分 | 内容 | 默认 |
| --- | --- | --- |
| 电脑操作 | `computer_*` 工具（截图、鼠标、键盘、窗口、UIA、剪贴板、启动、停止） | 会话级关闭，点芯片开启 |
| token-guard | 把过长的工具输出压成结构化摘要（原 `@local/dsh-token-guard`） | 开启，`config.tokenGuard.enabled` |
| app-launch | 用干净环境启动 GUI 应用（原 `@local/dsh-app-launch`） | 开启，`config.appLaunch.enabled` |
| 任务预设 | `task-desktop` / `task-analysis` / `task-document` | **不在核心安装里**，见 `presets/` |

「默认关闭」只指**电脑操作的会话授权**。token-guard 默认挂钩、app-launch 默认启用，不要把它们
误解成受同一个芯片控制。

## 2. 兼容性与前置条件

| 维度 | 已验证 / 要求 |
| --- | --- |
| DSH desktop/runtime | `0.2.1-rc.2` 实测通过；manifest 声明 `engines.dsh: >=0.2.1-rc.2 <0.3.0` |
| Node（宿主内） | `>=20` 可加载桌面能力；完整浏览器能力需要全局 `WebSocket`（Node 22+ 稳定） |
| 开发/测试 Node | `>=22.15.0`（测试使用 `node:module.registerHooks`） |
| 操作系统 | Windows 10/11 x64；SendInput + GDI + UI Automation |
| PowerShell | Windows PowerShell 5.1 优先；PowerShell 7 只作兜底，不保证 GAC 程序集 |
| 桌面会话 | 需要可交互桌面；锁屏、无交互服务会话、更高完整性级别目标会失败 |
| 浏览器通道 | 另需显式 CDP endpoint、受控启动的浏览器或可读的 `DevToolsActivePort` |

没有验证过的组合不要按「应该可以」宣传。`engines.dsh` 只声明实测过的 0.2.x 段；升级宿主后先跑
`doctor`，再决定是否扩大范围。

## 3. 安装

先解压到**长期保留、可读取**的目录。`link:` 安装指向这个目录，安装后不能把它当临时目录删掉。
插件根是含 `package.json`、`index.js`、`client.js`、`cordis.patch.yml`、`backend/` 的那一层。

```powershell
$PluginRoot = 'D:\DSH-Plugins\dsh-computer-use\1.40.0'
$DshCli = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'

if (-not (Test-Path -LiteralPath $DshCli -PathType Leaf)) {
    throw '找不到此 DSH CLI；请填写实际安装位置，不要改用另一套全局 dsh。'
}
foreach ($RelativeFile in @('package.json','index.js','client.js','cordis.patch.yml','backend\worker.ps1','backend\release-input.ps1','release-manifest.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $PluginRoot $RelativeFile) -PathType Leaf)) {
        throw "插件根不完整：$RelativeFile"
    }
}
$PluginManifest = Get-Content -Raw -LiteralPath (Join-Path $PluginRoot 'package.json') | ConvertFrom-Json
if ($PluginManifest.name -ne '@local/dsh-computer-use') { throw '选中的目录不是本插件根目录。' }

& $DshCli plugin --profile desktop add $PluginRoot
if ($LASTEXITCODE -ne 0) { throw '安装命令失败；保留 CLI 输出及其中的诊断日志路径。' }
```

`add` 会写 `link:` 依赖。**已有依赖时它不会自动补 bundle**：如果 profile 里本来就有同名依赖、
但不含 `@local/dsh-computer-use`，安装后仍需把包名加入 `dsh.profile.bundles`（或先 `remove`
再 `add`）。详见 `INSTALL.md` 的安装/更新/启用/卸载四步。

装完必须**完全退出并重新打开 DSH**；桌面端只在启动时组合 profile。不要在运行中的链接目录上覆盖
解压新版本——用新版本目录整体切换。

### 可选任务预设

需要三个任务预设时，再把 `presets/` 作为独立 bundle 安装：

```powershell
& $DshCli plugin --profile desktop add (Join-Path $PluginRoot 'presets')
```

它有自己的包名 `@local/dsh-computer-use-presets`，卸载它不会影响核心电脑操作。预设里的
`workspace-dependencies` 需要 `DSH_RUNTIME_ROOT` 或标准运行时目录；不满足时只影响预设本身。

## 4. 装完先看什么

```powershell
# 离线：安装包、profile、链接、bundles、重复挂载、PowerShell、发行身份
node "<插件根>\doctor.mjs" --profile desktop

# 正式发行验收：缺 release-manifest.json 也算阻断
node "<插件根>\doctor.mjs" --release --profile desktop

# 宿主活着时：在线 doctor + 按会话 state
node "<插件根>\doctor.mjs" http://127.0.0.1:19387 --json
(Invoke-WebRequest "http://127.0.0.1:19387/computer-use/state?sessionId=<会话 id>" -UseBasicParsing).Content

# 显式拉起后端（会 spawn worker；默认 doctor 不碰桌面）
node "<插件根>\doctor.mjs" http://127.0.0.1:19387 --probe-backend

# 宿主启动失败：直接从原生 Diagnostic report 提取首个失败，而不是猜弹窗最后几行
node "<插件根>\doctor.mjs" --diagnostic "<报告文件>"
```

端口以 DSH 实际启动的 web 端口为准。界面验证：重启后打开会话，输入框工具栏出现「电脑操作」芯片，
点一下变为开启态。

## 5. 排障顺序：先分清「哪一层」坏了

| 阶段 | 特征 | 先读什么 |
| --- | --- | --- |
| 安装命令失败 | CLI 非零退出；解压/路径/包管理器/兼容性报错 | 安装日志、`dsh.cmd`、profile、依赖解析 |
| **整个 DSH 启动失败** | 系统错误弹窗；required entry 无法激活；`agent-loop` 等待 `tools` | **原生 Diagnostic report 的第一处 `Failed plugins` / cause**；不要先跑在线 doctor |
| 单个插件不激活 | DSH 能开；路由不存在；加载器有错误 | 宿主日志里的 `computer-use`、`DUPLICATE_INSTANCE`、`defineTool` 报错 |
| 预设不可用 | 桌面仍运行；某预设标 broken/invalid | 预设 bundle 是否安装、`workspace-dependencies` 的 `source` |
| 芯片异常/界面错误 | 宿主活着；renderer console 异常 | 前端日志、`/status` 的版本/`buildId` |
| 开启芯片或首次调用失败 | DSH 可用；worker 起不来或 503 | `doctor --probe-backend`、PowerShell、UIA、权限 |
| 使用中 worker 退出 | `WORKER_EXITED` / `START_TIMEOUT` / `TIMEOUT` | worker stderr、UIA provider、执行预算 |
| 工具可见但被拒 | `NOT_AUTHORIZED`、hidden、子代理拒绝 | 会话授权、scope、实际 agent 绑定 |
| 仅浏览器不可用 | `capability_unavailable`、无 CDP endpoint | WebSocket/fetch、调试端口 |
| 目标应用没打开 | DSH 正常；目标 Electron 应用无窗口 | 是否经 `app_launch` 启动、`ELECTRON_RUN_AS_NODE` |

**宿主整体启动失败时，不要用「插件在线 doctor 返回 404」推根因**：404 只说明该 origin/path 没有
可用路由，可能是错误端口、错误实例、未挂载或加载失败。先读原生报告的“第一个异常”。

### 本版新增的判据

* `DUPLICATE_INSTANCE`：同一宿主第二次挂载在注册前被拒；日志带已有实例的路径/版本和本次路径/版本。
* `RELEASE_BUILD_MISMATCH`：`release-manifest.json` 与磁盘文件不一致——半套升级/混装。
* `RELEASE_SCRIPT_MISSING`：`backend/release-input.ps1` 缺失；worker 被强杀时无法释放按住的键。
* `PROFILE_EXTRA_MOUNT`：用户 `cordis.patch.yml` 里还有第二份本插件行。
* `BUNDLE_NOT_ENABLED`：依赖存在但 bundle 未启用（`add` 对已有依赖不会自动补）。
* `PROFILE_BUNDLE_DUPLICATE`：同一个 bundle 在 `dsh.profile.bundles` 里出现多次。
* `CORE_PACKAGE_COPY`：profile/插件目录里有核心包副本；确认它指向宿主自带版本。
* `WEBSOCKET_UNAVAILABLE`：浏览器底层缺全局 WebSocket；桌面工具不受影响。

## 6. 从三个旧包迁移

旧包 `@local/dsh-token-guard`、`@local/dsh-app-launch` 已并入本插件。迁移顺序：

1. 记录实际启用的旧包、旧 bundle 行和用户手写 patch；
2. 备份 profile 的 `package.json` 与 `cordis.patch.yml`；
3. 把旧配置迁到本插件的 `tokenGuard` / `appLaunch` 段（键名不变）；
4. 完整退出 DSH；
5. 移除明确重复的旧包/旧行（卸载包不等于自动删除用户手写 patch）；
6. 安装完整新目录，重启，确认唯一实例；
7. 跑 `doctor --profile <name>`，确认没有 `LEGACY_*` / `PROFILE_EXTRA_MOUNT`。

## 7. 构建与发行身份

* `backend/parts/*.ps1` 是源码，`backend/worker.ps1` 由 `node tools/build-worker.mjs` 生成；
  `--check` 会挡住“片段改了但没重新生成”。
* `release-manifest.json` 由 `node tools/pack-candidate.mjs` 生成，`releaseBuildId` 覆盖 51 个生产文件。
* 宿主启动时重新计算并与清单比对；`/status` 的 `runtime.release` 和 doctor 都会显示。
* 打包器排除 `dist/`、`artifacts/`、`_zips/`、旧 `*.zip`/`*.tgz` 和输出目录，不会把旧发行物再装进新包。

## 8. 开发自检

```powershell
node tools/build-worker.mjs --check
node tests/preset-config-test.mjs
node test-schema-visibility.mjs
node schema-test.mjs
node tests/bridge/plugin-test.mjs
node tests/hardening-test.mjs
node doctor.mjs --release
```

测试依赖 Node `>=22.15`（`node:module.registerHooks`）；宿主内嵌 Node 与系统 `node.exe` 可能不同，
不要把系统 Node 的版本当成宿主版本。

## 9. 权限与边界

* 电脑操作默认关闭，按会话授权；子代理不能从内部放宽。
* 截图、UIA 文本、剪贴板可能包含敏感信息；`save_path` 写入的位置由调用方负责。
* `doctor` 只读配置与包文件，不读取 `.credentials.yaml`，不打印凭据。
* 浏览器通道只连接显式配置/受控启动的 CDP endpoint，不扫描任意已打开浏览器；“回环调试连接”不表示
  浏览器导航不会访问外网。

## License

MIT
