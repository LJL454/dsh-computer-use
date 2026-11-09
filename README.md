# dsh-computer-use

DeepSeek Harness（DSH）的电脑操作能力：截图、鼠标、键盘、剪贴板、窗口与 UI Automation、应用启动、
批量动作，以及输入框工具栏里的「电脑操作」开关。

**1.50.1** · Windows 10/11 x64 · DSH `>=0.2.1-rc.2 <0.3.0` · Node `>=20`
[发布说明](RELEASE-NOTES-1.50.1.md) · [完整变更](CHANGELOG.md) · [npm](https://www.npmjs.com/package/dsh-computer-use-ljl454) · [Release](https://github.com/LJL454/dsh-computer-use/releases)

> **两个名字**：仓库里的包名是 `@local/dsh-computer-use`（源码身份），发布到 npm 的名字是
> `dsh-computer-use-ljl454`。npm 包在打包时会把 `package.json`、`cordis.patch.yml`、presets 里的名字
> 一次性改写成与 npm 一致，所以**按 npm 名安装**和**按目录安装**都能用，只是名字不同。

## 安装

三条路，任选一条。装完都要**完全退出 DSH 再打开**——桌面端只在启动时组合 profile。

### 方式一：npm（推荐）

```powershell
# 装进 DSH 的 profile（把桌面能力交给宿主管理）
dsh plugin --profile desktop add dsh-computer-use-ljl454@1.50.1

# 或者作为当前项目的依赖（自己写脚本、跑测试时用）
npm install dsh-computer-use-ljl454@1.50.1
```

更新：

```powershell
dsh plugin --profile desktop add dsh-computer-use-ljl454@latest
# 或
npm update dsh-computer-use-ljl454
```

`@latest` 或省略版本号取当前最新版；要锁版本就写全 `@1.50.1`。升级后同样需要重启宿主，
并跑一次 `doctor`（见「装完先看什么」）。

### 方式二：GitHub Release 的 tarball

从 [Releases](https://github.com/LJL454/dsh-computer-use/releases) 下载
`local-dsh-computer-use-1.50.1.tgz`，然后：

```powershell
dsh plugin --profile desktop add <下载目录>\local-dsh-computer-use-1.50.1.tgz
```

tarball 与 npm 包内容一致（逐文件 SHA256 见包内 `release-manifest.json`）。

### 方式三：从源码目录（`link:`）

先把仓库克隆/解压到**长期保留、可读取**的目录——`link:` 指向它，装完不能当临时目录删掉。
插件根是含 `package.json`、`index.js`、`client.js`、`cordis.patch.yml`、`backend/` 的那一层。

```powershell
$PluginRoot = 'D:\DSH-Plugins\dsh-computer-use'
$DshCli = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
if (-not (Test-Path -LiteralPath $DshCli -PathType Leaf)) { throw '找不到此 DSH CLI；请填实际安装位置' }

& $DshCli plugin --profile desktop add $PluginRoot
if ($LASTEXITCODE -ne 0) { throw '安装命令失败；保留 CLI 输出与诊断日志路径' }
```

`add` 会写 `link:` 依赖。**已有同名依赖时它不会自动补 bundle**：如果 profile 里本来就有同名依赖、
但不含本包，安装后仍需把包名加入 `dsh.profile.bundles`（或先 `remove` 再 `add`）。
不要在运行中的链接目录上覆盖解压新版本——用新目录整体切换。

### 可选任务预设

三个任务预设（`task-desktop` / `task-analysis` / `task-document`）是**独立 bundle**，不在核心安装里：

```powershell
dsh plugin --profile desktop add (Join-Path $PluginRoot 'presets')
```

它有自己的包名，卸载它不影响核心电脑操作。预设依赖 `workspace-dependencies`；缺 `DSH_RUNTIME_ROOT`
或标准运行时目录时只影响预设本身。

## 1.50.1 有什么（自 1.40.3）

- **看得见的操作**：新增原生覆盖层（D3D/D2D，独立进程）——光标角色、横幅、边缘呼吸，并**自动从截图里排除**；美术包升级到鲸鱼女仆 V11（pack v3 / perClip，部件按 z 序真分层）。
- **一个「效果」面板**：总开关 / 横幅角色 / 光标角色 / 光晕 / 边缘呼吸 / 减少动态，逐项保存。只影响画面——操作提示、停止与 Esc 取消永远有效。
- **物理 Esc 真能停**：就绪状态来自键盘钩子本身，不再"假装可用"；按代次隔离，迟到的旧消息不会污染新任务。
- **指针保真**：按钮边沿改成有序事件队列，20,000 组自检；快速点击、多键交错、拖出去又拖回来都算得准。
- **更安静**：启动不再堵宿主（发行校验延后约 2 秒、CDP 按需加载），静态画面 CPU 从 25% 降到 0%。
- **AMSI / Defender 误报已解决**：曾被判成 `HackTool:PowerShell/EmpireGetScreenshot.C` 拦在启动；已向微软提交误报样本，特征修正后实测不再命中（没关 AMSI、没加排除项）。
- 工具仍是 `computer_*` 那 23 个，调用方式与 1.40.3 完全一致。

## 它提供什么

| 部分 | 内容 | 默认 |
| --- | --- | --- |
| 电脑操作 | `computer_*` 工具（截图、鼠标、键盘、窗口、UIA、剪贴板、启动、停止） | 会话级关闭，点芯片开启 |
| 覆盖层 | 光标/横幅角色、光晕、边缘呼吸；截图中自动排除 | 开启，`config.visualEffects` |
| token-guard | 把过长的工具输出压成结构化摘要（原 `@local/dsh-token-guard`） | 开启，`config.tokenGuard.enabled` |
| app-launch | 用干净环境启动 GUI 应用（原 `@local/dsh-app-launch`） | 开启，`config.appLaunch.enabled` |
| 任务预设 | `task-desktop` / `task-analysis` / `task-document` | **不在核心安装里**，见 `presets/` |

「默认关闭」只指**电脑操作的会话授权**。token-guard 默认挂钩、app-launch 默认启用，不要把它们误解成
受同一个芯片控制。覆盖层开关只影响画面：关掉动画不影响任何工具能力、停止与 Esc 取消。

## 兼容性

| 维度 | 已验证 / 要求 |
| --- | --- |
| DSH desktop/runtime | `0.2.1-rc.3` 桌面（ASAR）与 `0.2.1-rc.2`（npm / npx / pnpm dlx）实测通过；声明 `engines.dsh: >=0.2.1-rc.2 <0.3.0` |
| Node（宿主内） | `>=20` 可加载桌面能力；完整浏览器能力需要全局 `WebSocket`（Node 22+ 稳定） |
| 开发/测试 Node | `>=22.15.0`（测试使用 `node:module.registerHooks`） |
| 操作系统 | Windows 10/11 x64；SendInput + GDI + UI Automation |
| PowerShell | Windows PowerShell 5.1 优先；PowerShell 7 只作兜底，不保证 GAC 程序集 |
| 桌面会话 | 需要可交互桌面；锁屏、无交互服务会话、更高完整性级别目标会失败 |
| 浏览器通道 | 另需显式 CDP endpoint、受控启动的浏览器或可读的 `DevToolsActivePort` |

没有验证过的组合不要按「应该可以」宣传。`engines.dsh` 只声明实测过的 0.2.x 段；升级宿主后先跑
`doctor`，再决定是否扩大范围。`package.json` 的 `dsh.compatibility` 逐版本记录兼容性——范围不代替
逐项证据。

## 装完先看什么

```powershell
# 离线：安装包、profile、链接、bundles、重复挂载、PowerShell、发行身份
node "<插件根>\doctor.mjs" --profile desktop

# 正式发行验收：缺 release-manifest.json 也算阻断
node "<插件根>\doctor.mjs" --release --profile desktop

# 宿主活着时：在线 doctor + 按会话 state
node "<插件根>\doctor.mjs" http://127.0.0.1:<端口> --json
(Invoke-WebRequest "http://127.0.0.1:<端口>/computer-use/state?sessionId=<会话 id>" -UseBasicParsing).Content

# 显式拉起后端（会 spawn worker；默认 doctor 不碰桌面）
node "<插件根>\doctor.mjs" http://127.0.0.1:<端口> --probe-backend

# 宿主启动失败：直接提取原生 Diagnostic report 的首个失败
node "<插件根>\doctor.mjs" --diagnostic "<报告文件>"
```

端口以 DSH 实际启动的 Web 端口为准。界面验证：重启后打开会话，输入框工具栏出现「电脑操作」芯片，
点一下变为开启态；它旁边应有「效果」入口。

## 排障顺序：先分清「哪一层」坏了

| 阶段 | 特征 | 先读什么 |
| --- | --- | --- |
| 安装命令失败 | CLI 非零退出；解压/路径/包管理器/兼容性报错 | 安装日志、`dsh.cmd`、profile、依赖解析 |
| **整个 DSH 启动失败** | 系统错误弹窗；required entry 无法激活；`agent-loop` 等待 `tools` | **原生 Diagnostic report 的第一处 `Failed plugins` / cause**；不要先跑在线 doctor |
| 单个插件不激活 | DSH 能开；路由不存在；加载器有错误 | 宿主日志里的 `computer-use`、`DUPLICATE_INSTANCE`、`defineTool` 报错 |
| 预设不可用 | 桌面仍运行；某预设标 broken/invalid | 预设 bundle 是否安装、`workspace-dependencies` 的 `source` |
| 芯片/覆盖层异常 | 宿主活着；renderer console 异常 | 前端日志、`/status` 的版本/`buildId`、`indicator.state` |
| 开启芯片或首次调用失败 | DSH 可用；worker 起不来或 503 | `doctor --probe-backend`、PowerShell、UIA、权限 |
| 使用中 worker 退出 | `WORKER_EXITED` / `START_TIMEOUT` / `TIMEOUT` | worker stderr、UIA provider、执行预算 |
| 工具可见但被拒 | `NOT_AUTHORIZED`、hidden、子代理拒绝 | 会话授权、scope、实际 agent 绑定 |
| 仅浏览器不可用 | `capability_unavailable`、无 CDP endpoint | WebSocket/fetch、调试端口 |
| 目标应用没打开 | DSH 正常；目标 Electron 应用无窗口 | 是否经 `app_launch` 启动、`ELECTRON_RUN_AS_NODE` |

**宿主整体启动失败时，不要用「插件在线 doctor 返回 404」推根因**：404 只说明该 origin/path 没有可用
路由，可能是错误端口、错误实例、未挂载或加载失败。先读原生报告的"第一个异常"。

### 判据

* `DUPLICATE_INSTANCE`：同一宿主第二次挂载在注册前被拒；日志带已有实例的路径/版本与本次路径/版本。
* `RELEASE_BUILD_MISMATCH`：`release-manifest.json` 与磁盘文件不一致——半套升级/混装。
* `RELEASE_SCRIPT_MISSING`：`backend/release-input.ps1` 缺失；worker 被强杀时无法释放按住的键。
* `PROFILE_EXTRA_MOUNT` / `PROFILE_BUNDLE_DUPLICATE`：用户 `cordis.patch.yml` 里还有第二份本插件行，或
  `dsh.profile.bundles` 里重复。
* `BUNDLE_NOT_ENABLED`：依赖存在但 bundle 未启用（`add` 对已有依赖不会自动补）。
* `CORE_PACKAGE_COPY`：profile/插件目录里有核心包副本；确认它指向宿主自带版本。
* `WEBSOCKET_UNAVAILABLE`：浏览器底层缺全局 WebSocket；桌面工具不受影响。
* `INDICATOR_INTEGRITY_TOO_LOW`：helper 完整性太低，装得上钩子但收不到 UIPI 投递——只有位置轮询，
  表现是"只有待机和移动"。
* `BACKEND_BLOCKED_BY_AV`：worker 被安全软件拦截（AMSI / 隔离 / AppLocker·WDAC）。处置是提交误报样本，
  **不要**关 AMSI 或长期加排除项。

宿主解析层判据（出现在 `doctor` 的 `resolve` 层与 `/computer-use/status` 的 `runtime.resolution`）：

| 判据 | 含义 | 下一步 |
| --- | --- | --- |
| `HOST_NOT_IDENTIFIED` | 找不到任何宿主包根 | 用 `--dsh-cli` / `--host-entry` 指定入口 |
| `ASAR_RUNTIME_REQUIRED` | 只找到 `app.asar` 里的包，当前进程是普通 Node | 用桌面端 Electron 进程启动，别用系统 node |
| `PACKAGE_NOT_RESOLVED` | 官方通路失败且候选根里没有该包 | 确认安装目录就是运行中的那份 DSH |
| `HOST_PACKAGE_IMPORT_FAILED` | 找到包但 `import()` 失败 | 看 error 原文；**不会**改用别的副本 |
| `HOST_INSTANCE_CONFLICT` / `HOST_INSTANCE_MISMATCH` | `DSH_APP_MODULES` 或记录的活动宿主与运行中的不一致 | 取消该变量，或指向运行中的那份并重启 |
| `HOST_PACKAGE_LOCAL_COPY` | 官方通路落到了插件旁边的副本 | 删掉该副本；宿主会自己提供 |
| `SCOPE_RESOLUTION_DEGRADED` | `dsh-scope` 解析失败，schema 可见性降级 | 与 `PACKAGE_*` 同样的排查顺序 |

## 从旧包迁移

旧包 `@local/dsh-token-guard`、`@local/dsh-app-launch` 已并入本插件。迁移顺序：

1. 记录实际启用的旧包、旧 bundle 行和用户手写 patch；
2. 备份 profile 的 `package.json` 与 `cordis.patch.yml`；
3. 把旧配置迁到本插件的 `tokenGuard` / `appLaunch` 段（键名不变）；
4. 完整退出 DSH；
5. 移除明确重复的旧包/旧行（卸载包不等于自动删除用户手写 patch）；
6. 安装完整新目录，重启，确认唯一实例；
7. 跑 `doctor --profile <name>`，确认没有 `LEGACY_*` / `PROFILE_EXTRA_MOUNT`。

## 构建与发行身份

* `backend/parts/*.ps1` 是源码，`backend/worker.ps1` 由 `node tools/build-worker.mjs` 生成；
  `--check` 会挡住"片段改了但没重新生成"。
* `release-manifest.json` 由 `internal/release-manifest.mjs` 的 `writeReleaseManifest()` 生成，
  `releaseBuildId` 覆盖 **98 个生产文件**（含 `index.js`、`client.js`、`native/` 的可执行体、
  `assets/` 的全部图集与 `interaction/`）。
* 宿主启动时重新计算并与清单比对；`/status` 的 `runtime.release` 和 doctor 都会显示。
* 候选包用 `node tools/pack-candidate.mjs` 组装，发行验收用 `node tools/release-acceptance.mjs`；
  打包器排除 `dist/`、`artifacts/`、`_zips/`、旧 `*.zip`/`*.tgz` 与输出目录。
* 同一版本号可能有多个构建（例如只改文档）。判断"装的是不是这一版"看 `release-manifest.json` 的
  `releaseBuildId` 与包 SHA256，不要只看版本号。

## 开发自检

```powershell
node tools/build-worker.mjs --check
node tools/release-verify.mjs --dir . --build   # 逐文件 SHA256，构建期口径
node tools/release-acceptance.mjs               # 发行验收
node security-block-test.mjs                    # 安全软件拦截的识别与处置
node indicator-helper-test.mjs                  # 覆盖层/指针协议
node harness-test.mjs                           # 工具与路由注册
node host-contract-test.mjs                     # 宿主契约：peers、四种布局、冲突、asar
node degraded-bootstrap-test.mjs                # 导入失败时仍能回答 503
node doctor.mjs --release
```

测试依赖 Node `>=22.15`（`node:module.registerHooks`）；宿主内嵌 Node 与系统 `node.exe` 可能不同，
不要把系统 Node 的版本当成宿主版本。全量套件与其中的"已知失败"见 [VERIFICATION.md](VERIFICATION.md)。

## 权限与边界

* 电脑操作默认关闭，按会话授权；子代理不能从内部放宽。
* 截图、UIA 文本、剪贴板可能包含敏感信息；`save_path` 写入的位置由调用方负责。
* 覆盖层只画画面：不伪造按钮状态、不补发输入；`visualActivity` 只驱动动画，操作成败仍由执行内核判定。
* `doctor` 只读配置与包文件，不读取 `.credentials.yaml`，不打印凭据。
* 浏览器通道只连接显式配置/受控启动的 CDP endpoint，不扫描任意已打开浏览器；"回环调试连接"不表示
  浏览器导航不会访问外网。

## License

MIT
