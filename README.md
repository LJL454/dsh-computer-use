# @local/dsh-computer-use

DeepSeek Harness（DSH）的电脑操作能力：截图、鼠标、键盘、剪贴板、窗口与 UI Automation、
应用启动、批量动作，以及输入框工具栏里的「电脑操作」开关。

## 安装：一条命令

在解压出来的插件根执行：

```powershell
node setup.mjs
```

它先识别宿主布局（官方 `resources\app.asar` 桌面 / 展开的 `resources\app` / npm CLI），再执行
`dsh plugin add`，然后复核 profile 不会遮蔽宿主自带的包，最后打印结论。装完完整退出 DSH 再打开。

常用参数：`--profile web`、`--check`（只看不改）、`--repair-only`（只修链接不安装）、
`--app <目录>`（DSH 不在默认位置）、`--dsh-cli <cli.js>`（npm 安装的 DSH）、
`--host-modules <dir>`（测试或非常规布局）、`--json`。
不想敲命令就双击 `install-and-repair.cmd`，效果相同。也可以直接装 tarball：

```powershell
dsh plugin --profile desktop add <解压/下载目录>\local-dsh-computer-use-1.40.3.tgz
```

### ⚠️ 不要用弹窗里"输包名"的方式装

DSH 的插件框按 **npm 包名**解析，而本项目不在 npm 上：

| npm 上的名字 | 实际是什么 |
| --- | --- |
| `dsh-computer-use` | **别人的插件**（仓库 `988hj7tczd-oss/dsh-computer-use`，0.3.1），不是本项目 |
| `@deepseek-ai/dsh-computer-use` | 官方 `deepseek-harness` 的 provider 注册辅助包（0.1.6-alpha.1），也不是本项目 |
| `@local/dsh-computer-use` | 本项目的名字，但 `@local` 是不可发布的占位作用域，npm 上不存在 |

在框里输 `dsh-computer-use` 会装到别人的那份老包，然后你会以为"这个插件没修"。本项目的分发
渠道只有 GitHub Release 的 zip / tarball。

如果确实想让它能"按名字安装"，需要先发布到**你自己拥有的名字**下——包里带了工具，它会把
所有出现处（`package.json`、`cordis.patch.yml`、presets、doctor、文档）一次性改写一致，然后
只打包、不发布：

```powershell
node tools/publish-npm.mjs --name @your-scope/dsh-computer-use --dry-run
node tools/publish-npm.mjs --name @your-scope/dsh-computer-use
npm publish dist/@your-scope-dsh-computer-use-1.40.3.tgz --access public
```

之后用户 `dsh plugin add @your-scope/dsh-computer-use` 即可按名字装。

以 `link:` 安装、插件解压目录在别处（`D:\DSH-Plugins\...` 之类）也**不需要**在插件旁边放任何
`node_modules`：宿主自带的包按运行中应用的绝对路径解析，见下面 1.40.3 的解析器那一条。解压位置本身
不受限制——空格、中文、`#`、深层 Downloads 目录都实测过；`/computer-use/status` 的
`runtime.host.hostPackages` 会直接写出当前用的是哪一份、什么版本。

> 为什么不能"加进插件就自动跑"：pnpm 对 `link:` 依赖**不执行任何生命周期脚本**
> （`preinstall` / `install` / `postinstall` / `prepare` 四个都实测过，一个都没跑），
> 所以安装动作只能是一条命令或一个双击文件。

版本 **1.40.3**。这一版修的是「装好了，但加载不到」——官方 ASAR 桌面端和 npm CLI 宿主上，
插件会在挂载前就失败：`/computer-use/*` 一律 404、工具不存在，宿主本身却一切正常。

* **根因**：1.40.1/1.40.2 为了让包管理器不往 profile 里落 `@deepseek-ai/dsh-tools` 副本，把 peer
  声明整个删掉了。但 peer 声明不只影响包管理器：官方 `dsh-app-boot` 的 `routeLinked()` 正是读
  外部 `link:` 插件的 peer 名，命中才把这个裸说明符交给宿主的拦截解析器。声明一删，这条官方
  通路也没了，只剩手写兜底——而旧兜底只认识 `resources\app\dsh\node_modules` 一种布局。
* **optional peers 恢复官方通路**：两个 peer 重新声明并标为 `optional`——官方解析器重新看得到，
  包管理器仍然不会安装副本；范围与 `engines.dsh` 一致。
* **解析器重写**（`internal/host-packages.mjs`）：官方通路优先；只认活动宿主那一份（落到插件旁
  或别的副本时记 `HOST_PACKAGE_LOCAL_COPY` 并改用宿主）；锚点兜底覆盖 CLI 入口、
  `process.resourcesPath`、可执行文件旁的 `app` 与 `app.asar`、npm 布局；**选中后初始化失败
  原样抛出，不偷换副本**；`DSH_APP_MODULES` 与运行宿主冲突时抛 `HOST_INSTANCE_CONFLICT`。
* **安装器**：三种宿主布局都认；asar 内虚拟目录**不建 junction**；退出码由「再次扫描」决定，
  不再按「修过几次」报成功。
* **降级挂载**：宿主导入失败时插件仍会挂上一个只读面，`/computer-use/status` 与
  `/computer-use/doctor` 返回 **503 + `{state:'failed', stage, code, resolution}`**，而不是 404。
* **诊断分层**：`doctor` 输出 `resolve / activate / backend` 三层，未观测的层标 `not-run`；
  安全软件拦截单独报 `BACKEND_BLOCKED_BY_AV`（`retry: never`），处置建议是提交误报样本。

1.40.2 修的「截图重编码写死会话」「`link:` 安装没有芯片」等内容仍是本版的一部分，见
[CHANGELOG.md](CHANGELOG.md)；**哪些实测过、哪些没有**见 [VERIFICATION.md](VERIFICATION.md)。

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
| DSH desktop/runtime | `0.2.1-rc.3` 桌面（ASAR）与 `0.2.1-rc.2`（npm / npx / pnpm dlx）实测通过；manifest 声明 `engines.dsh: >=0.2.1-rc.2 <0.3.0` |
| Node（宿主内） | `>=20` 可加载桌面能力；完整浏览器能力需要全局 `WebSocket`（Node 22+ 稳定） |
| 开发/测试 Node | `>=22.15.0`（测试使用 `node:module.registerHooks`） |
| 操作系统 | Windows 10/11 x64；SendInput + GDI + UI Automation |
| PowerShell | Windows PowerShell 5.1 优先；PowerShell 7 只作兜底，不保证 GAC 程序集 |
| 桌面会话 | 需要可交互桌面；锁屏、无交互服务会话、更高完整性级别目标会失败 |
| 浏览器通道 | 另需显式 CDP endpoint、受控启动的浏览器或可读的 `DevToolsActivePort` |

没有验证过的组合不要按「应该可以」宣传。`engines.dsh` 只声明实测过的 0.2.x 段；升级宿主后先跑
`doctor`，再决定是否扩大范围。

`package.json` 的 `dsh.compatibility` 逐版本记录兼容性——范围不代替逐项证据：

```json
"compatibility": {
  "dsh": ">=0.2.1-rc.2 <0.3.0",
  "node": ">=20",
  "systems": ["win32"],
  "profiles": ["desktop"],
  "dshReleases": { "0.2.1-rc.1": "unknown", "0.2.1-rc.2": "compatible", "0.2.1-rc.3": "compatible" },
  "dshOperations": { "0.2.1-rc.2": { "install": "passed", "start": "passed", "uninstall": "passed", "rollback": "unknown" } }
}
```

`dshReleases` 的每个版本只能取 `compatible` / `incompatible` / `unknown`；rc.1 没有实机证据，所以是
`unknown`，不是猜出来的 `compatible`。`presets/` 是**独立 bundle**（另一个包），上架/引用时插件路径应
写 `tree/main/.`，不要指向仓库根。

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

### 排障判据（1.40.3 新增）

* `DUPLICATE_INSTANCE`：同一宿主第二次挂载在注册前被拒；日志带已有实例的路径/版本和本次路径/版本。
* `RELEASE_BUILD_MISMATCH`：`release-manifest.json` 与磁盘文件不一致——半套升级/混装。
* `RELEASE_SCRIPT_MISSING`：`backend/release-input.ps1` 缺失；worker 被强杀时无法释放按住的键。
* `PROFILE_EXTRA_MOUNT`：用户 `cordis.patch.yml` 里还有第二份本插件行。
* `BUNDLE_NOT_ENABLED`：依赖存在但 bundle 未启用（`add` 对已有依赖不会自动补）。
* `PROFILE_BUNDLE_DUPLICATE`：同一个 bundle 在 `dsh.profile.bundles` 里出现多次。
* `CORE_PACKAGE_COPY`：profile/插件目录里有核心包副本；确认它指向宿主自带版本。
* `WEBSOCKET_UNAVAILABLE`：浏览器底层缺全局 WebSocket；桌面工具不受影响。

1.40.3 追加的宿主解析判据（会出现在 `doctor` 的 `resolve` 层与 `/computer-use/status` 的
`runtime.resolution`）：

| 判据 | 含义 | 下一步 |
| --- | --- | --- |
| `HOST_NOT_IDENTIFIED` | 找不到任何宿主包根：从 CLI 入口、`resourcesPath`、可执行文件旁都没找到 | 用 `--dsh-cli` / `--host-entry` 指定入口 |
| `ASAR_RUNTIME_REQUIRED` | 只找到 `app.asar` 里的包，而当前进程是普通 Node（读不了归档） | 用桌面端的 Electron 进程启动，别用系统 node 跑 |
| `PACKAGE_NOT_RESOLVED` | 官方通路失败且候选根里没有该包 | 确认安装目录就是运行中的那份 DSH |
| `HOST_PACKAGE_IMPORT_FAILED` | 找到了包但 `import()` 失败（缺传递依赖、初始化抛错） | 看 error 原文；**不会**改用别的副本 |
| `HOST_INSTANCE_CONFLICT` | `DSH_APP_MODULES` 指的宿主与运行中的不是同一个 | 取消该环境变量，或指向运行中的那份 |
| `HOST_INSTANCE_MISMATCH` | 插件记录的活动宿主与本次解析不一致 | 重启 DSH，确认只有一份安装 |
| `HOST_PACKAGE_LOCAL_COPY` | 官方通路落到了插件旁边的副本 | 删掉该副本；宿主会自己提供 |
| `SCOPE_RESOLUTION_DEGRADED` | `dsh-scope` 解析失败，schema 可见性降级 | 与 `PACKAGE_*` 同样的排查顺序 |
| `BACKEND_BLOCKED_BY_AV` | worker 被安全软件拦截（AMSI / 隔离 / AppLocker·WDAC） | 提交误报样本；**不要**关 AMSI 或长期加排除项 |

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
* `release-manifest.json` 由 `node tools/pack-candidate.mjs` 生成，`releaseBuildId` 覆盖 59 个生产文件（含安装入口 `setup.mjs`、两个 `.cmd`、`tools/fix-profile-links.ps1`、`VERIFICATION.md`）。
* 宿主启动时重新计算并与清单比对；`/status` 的 `runtime.release` 和 doctor 都会显示。
* 打包器排除 `dist/`、`artifacts/`、`_zips/`、旧 `*.zip`/`*.tgz` 和输出目录，不会把旧发行物再装进新包。

## 8. 开发自检

```powershell
node tools/build-worker.mjs --check
node tests/preset-config-test.mjs
node test-schema-visibility.mjs
node schema-test.mjs
node host-contract-test.mjs        # 宿主契约：peers、四种布局、冲突、asar 运行时
node security-block-test.mjs       # 安全软件拦截的识别与处置
node degraded-bootstrap-test.mjs   # 导入失败时仍能回答 503
node migration-drill-test.mjs      # 旧 profile 迁移：可修 / 原件缺失 / 仍声明依赖 / --check
node tests/bridge/plugin-test.mjs
node tests/hardening-test.mjs
node doctor.mjs --release
```

测试依赖 Node `>=22.15`（`node:module.registerHooks`）；宿主内嵌 Node 与系统 `node.exe` 可能不同，
不要把系统 Node 的版本当成宿主版本。这些用例在 `0.2.1-rc.3` 桌面上全绿，具体数字见
[VERIFICATION.md](VERIFICATION.md)。

## 9. 权限与边界

* 电脑操作默认关闭，按会话授权；子代理不能从内部放宽。
* 截图、UIA 文本、剪贴板可能包含敏感信息；`save_path` 写入的位置由调用方负责。
* `doctor` 只读配置与包文件，不读取 `.credentials.yaml`，不打印凭据。
* 浏览器通道只连接显式配置/受控启动的 CDP endpoint，不扫描任意已打开浏览器；“回环调试连接”不表示
  浏览器导航不会访问外网。

## License

MIT
