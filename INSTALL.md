# 安装与排障（电脑操作 · dsh-computer-use 1.40.3）

## 最快装法：一条命令

```powershell
node setup.mjs
```

在当前目录（解压出来的插件根）执行这一条就够了。它按顺序做三件事，并把结论打出来：

```text
== @local/dsh-computer-use@1.40.3 -> profile "desktop"
== 1/2  dsh plugin add              ← 安装；pnpm 顺手把旧版留下的 dsh-tools 副本挪走
== 2/2  profile cannot shadow ...   ← 确认 profile 里没有任何会抢先宿主的 @deepseek-ai 副本
[OK] The profile cannot shadow the host packages. Fully quit DeepSeek Harness, then start it again.
```

常用参数：`--profile web`（装到别的 profile）、`--check`（只看不改）、`--app <目录>`（DSH 不在默认
安装位置）。**给 AI 装的话，把它执行 `node setup.mjs` 就结束了**——不需要它理解这里的历史。

为什么不能"加进插件就自动生效"：pnpm 对 `link:` 依赖**不运行任何生命周期脚本**（对本插件的
`preinstall` / `install` / `postinstall` / `prepare` 四个都实测过，一个都没跑），所以插件侧没有
可挂的安装钩子。安装入口只能是一条命令或一个双击文件。

不想敲命令的话，双击 `install-and-repair.cmd`，效果与 `node setup.mjs` 相同。

> 这份文件随包发出。1.39.5 及更早的 INSTALL 有两处会误导的表述，本版已改掉：
>
> * “`add` 一定补齐依赖和 bundle”——**已有依赖但缺 bundle 时不会自动补**；
> * “link 到任意目录”——`link:` 指向原解压目录，装完把它删掉/移走，路径就失效了。
>
> 另外，“半套升级不会被放行”已收窄：`assertWorkerContract()` 只覆盖 worker 与
> release-input 的运行时一致性，完整发行身份由 `release-manifest.json` / `releaseBuildId` 负责。

## 0. 1.40.3 改了什么

**1.40.3 修的是“官方 ASAR 桌面装完加载不到插件”。** 1.40.1/1.40.2 为了让包管理器不往 profile 里
落核心包副本，把 `@deepseek-ai/dsh-tools` / `dsh-scope` 的 peer 声明整个删掉了。但 peer 声明不只
影响包管理器：官方 `dsh-app-boot` 的 `routeLinked()` 正是**读外部 `link:` 插件的 peer 名称**，
命中才把这个裸说明符交给宿主自己的拦截解析器。声明一删，这条官方通路也跟着没了，只剩插件里的
手写兜底——而旧兜底只认识 `resources\app\dsh\node_modules` 一种布局：

```text
官方桌面：resources\app.asar\dsh\node_modules     ← 看不到
npm CLI ：...\node_modules\@deepseek-ai\dsh\node_modules
```

`index.js` 第 107 行的顶层 `await importHostModule('@deepseek-ai/dsh-tools')` 因此失败，模块导入
没完成，`apply()` 从未执行 → 工具与 `/computer-use/*` 路由都不存在（issue #1 / #2 的 404、unknown）。

1.40.3 的改法：

* **optional peers 恢复官方通路**（`peerDependenciesMeta.optional = true`）：官方解析器重新看到这
  两个名字，包管理器仍不会替你安装副本。运行时仍然必须有它们，缺了会按结构化错误报出来。
* **解析器重写**（`internal/host-packages.mjs`）：官方通路优先；解析到插件旁/别处的副本时改用活动
  宿主；兜底锚点覆盖 CLI 入口、`process.resourcesPath`、可执行文件旁的 `app` 与 `app.asar`、npm
  布局；**选中后初始化失败原样抛出**，不再偷换副本；`DSH_APP_MODULES` 与运行宿主冲突时明确报错。
* **安装器不再假设展开目录**（`setup.mjs`）：官方 asar 桌面、npm CLI、展开的开发宿主三种布局都认；
  不再要求 `DeepSeek Harness.exe` 与 `resources\app\...\cli.js` 同时存在；**绝不把 asar 内的虚拟
  目录做成 junction**；退出码由再次扫描决定。
* **诊断说人话**（`internal/preflight.mjs` / `internal/doctor.mjs`）：新增
  `HOST_NOT_IDENTIFIED`、`ASAR_RUNTIME_REQUIRED`、`HOST_INSTANCE_CONFLICT`、
  `HOST_INSTANCE_MISMATCH`。普通 Node 读不到 asar 不再等于“宿主版本未知”，也不建议重装。

安装命令没有变：`node setup.mjs`（或双击 `install-and-repair.cmd`）。新增排障参数
`--dsh-cli`、`--host-entry`、`--host-modules`、`--repair-only`、`--json`。

## 0.1 1.40.2 / 1.40.1 改了什么（历史）

**1.40.2 修的是会话被一次截图写死的问题。** 宿主会把超限的截图重编码（带 alpha 的 PNG →
WebP）后再落盘，而插件过去把**入参**声明的 `mediaType` 写进会话记录，于是记录成了
“PNG 标签 + WebP 实体”。宿主下一次重放历史时按字节复核 ref，判 `ATTACHMENT_CORRUPT`，
该会话此后每一轮都在 step 1 失败，界面上只显示
`Stored attachment metadata does not match its reference.`。

1.40.2 起 `internal/capture.mjs` 的 `admitCapture()` 整条 ref 透传：`mediaType`、`bytes`、
`width`、`height`、`originalDimensions` 全部取自存储层的实测值，不再与入参混用。
`IMAGE_VALUE_SCHEMA` 相应增加可选的 `originalDimensions`。

**已经写坏的会话不会自己恢复**——坏记录在日志里，只能改那条记录的 `mediaType`（改成落盘
对象的真实格式）或弃用该会话；本版只保证不再产生新坏记录。

**1.40.1 修的是装完起不来的问题。** 1.39.x 与 1.40.0 都在 `package.json` 里把
`@deepseek-ai/dsh-tools` 声明成 **peer**（1.39 是 `"*"`，1.40.0 是 `>=0.2.1-rc.2 <0.3.0`，
两者都是 `optional: false`）。这个声明会让包管理器在用户的 profile 里落一份**实体副本**：

```text
<profile>\node_modules\@deepseek-ai\dsh-tools\      ← 包管理器装的
```

而宿主的 `tools` 这一行**优先从 profile 解析**，只有 profile 里没有才回落到安装目录自带的
那份。副本与桌面版版本一旦不一致（1.39 的 `"*"` 会解析到 npm 上的 `latest`，当时是
`0.0.1-rc.1`），loader 会直接禁用该行：

```text
dsh: disabling profile plugin row "tools": Plugin @deepseek-ai/dsh-tools@0.0.1-rc.1
is incompatible with dsh 0.2.1-rc.2 ...
```

于是所有注入 `tools` 的 row 一起挂起，`agent-loop` 是 required，DSH 起不来，界面上只有
`The application could not start or stopped unexpectedly.` 加上一张 waiting 表——**不点名任何
插件**，所以很难查。

1.40.1 删掉了这两个 peer，避免包管理器落副本。**这个动机在 1.40.3 里用 optional 保留了**，但当时
是整条删掉——于是官方 `routeLinked()` 也读不到声明（见上面 1.40.3 一节）。宿主的
`@deepseek-ai/dsh-tools` 仍由 loader 的解析适配层提供给插件，profile 里不需要副本；区别只在于
**声明要留着、并且标成 optional**，官方才有据可依去走拦截解析。

**从 1.39.x / 1.40.0 升级的用户：不用额外跑修复脚本。**

最省事的一条路：**双击包内的 `install-and-repair.cmd`**。它按顺序做两件事，然后提示你重启：

```text
1/2  dsh plugin add <这个目录>   ← 安装 1.40.3；pnpm 顺手把残留副本移走
2/2  tools\fix-profile-links.ps1 ← 再确认 profile 里没有任何会抢先的副本
```

命令行等价形式（GUI 打不开也能跑，`dsh plugin` 只做安装、不组装 profile）：

```powershell
& $DshCli plugin --profile desktop add $PluginRoot
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PluginRoot 'tools\fix-profile-links.ps1')
```

### 为什么"装一遍"通常就够了

安装内部会跑一次 `pnpm install`。1.40.3 把 `@deepseek-ai/dsh-tools` 声明成 **optional** peer，
pnpm 不会替你安装它；发现 profile 里那份已经不在依赖树中，会自己把它挪走：

```text
[WARN] Moving @deepseek-ai/dsh-tools to "node_modules\.ignored\@deepseek-ai\dsh-tools".
       It is not in the dependency tree and pnpm has no record of installing it.
```

实测：一个 `tools` 行已被禁用、完全起不来的 profile，只重跑这条安装命令就恢复启动。

### 那为什么还要第 2 步

有一种情况安装删不掉：那份副本被写进了 profile 自己的 `package.json`（例如你曾手工
`pnpm add @deepseek-ai/dsh-tools`）。这时 pnpm 会认为它是"你要的"，下次安装还会装回来。
第 2 步会当场把这种声明**报出来**（它不会替你改 `package.json`，那需要你自己删那一行）：

```text
[q2] package.json DECLARES @deepseek-ai/dsh-tools in dependencies - delete that line, ...
```

只想先检查、不改动任何东西：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PluginRoot 'tools\fix-profile-links.ps1') -CheckOnly
```

脚本把 `<profile>\node_modules\@deepseek-ai\{dsh-tools,dsh-scope}` 中**是实体目录**的那些换成
指向安装目录的 junction；已经是 junction、或根本不存在，就不动。跑完**完整退出 DSH 再打开**
（profile 只在启动时组合一次）。

## 1. 装

### 1.0 不要用 GitHub 仓库 URL 安装

`dsh plugin --profile desktop add https://github.com/LJL454/dsh-computer-use` 会被 pnpm 当成 **git 依赖**（它要去跑 `git ls-remote`）。本机没有装 git 时直接失败：

```text
[ERR_PNPM_GIT_RESOLVE_FAILED] Failed to resolve git dependency "https://github.com/LJL454/dsh-computer-use":
git ls-remote failed: 'git' 不是内部或外部命令，也不是可运行的程序或批处理文件。
```

这不是插件的问题，是安装方式的问题。两种正确装法都不需要 git：

1. **zip**：下载 Release 里的 `dsh-computer-use-<版本>.zip`，解压后按 §1.1–§1.2 用目录安装（推荐）；
2. **tarball**：下载 Release 里的 `dsh-computer-use-<版本>.tgz`，用**本地文件路径**安装：

   ```powershell
   dsh plugin --profile desktop add D:\Downloads\dsh-computer-use-1.40.3.tgz
   ```

只有直接把 `https://github.com/...` 写进 `add` 才会触发 git。确实要走这种方式，就先装 Git for Windows 并确认 `git` 在 PATH 里。

### 1.1 解压到稳定目录

把 zip 解压到**长期保留、可读取**的目录，例如：

```text
D:\DSH-Plugins\dsh-computer-use\1.40.2\
```

插件根是含以下文件的那一层，不能多一层也不能少一层：

```text
package.json
index.js
client.js
cordis.patch.yml
backend\worker.ps1
backend\release-input.ps1
release-manifest.json
```

### 1.2 用目标 DSH 的 CLI 安装

```powershell
$PluginRoot = 'D:\DSH-Plugins\dsh-computer-use\1.40.2'
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

标准路径 `%LOCALAPPDATA%\Programs\DeepSeek Harness\...` 只适用于默认用户安装；自定义安装请填真实
CLI 路径。**不要**改用另一套全局 `dsh`，那会把插件装到另一个 profile/运行时上。

### 1.3 `add` 实际做了什么（以及没做什么）

`add` 会：

1. 把插件写成 profile 的 `link:` 依赖（指向 `$PluginRoot`）；
2. 当这是一个**新增直接依赖**时，把包名加入 profile 的 `dsh.profile.bundles`。

`add` **不会**：

* 为“已有同名依赖、但缺 bundle”的 profile 自动补 bundle；
* 删除用户手写的 `cordis.patch.yml` 行；
* 清理旧独立包、旧链接或正在运行的旧 worker；
* 在运行中热重载已经组合好的 profile。

如果 `doctor` 报 `BUNDLE_NOT_ENABLED`，把 `@local/dsh-computer-use` 加入 profile 的
`dsh.profile.bundles`，或先 `remove` 再 `add`，然后**完整退出并重启 DSH**。

### 1.4 可选任务预设

三个预设（`task-desktop` / `task-analysis` / `task-document`）自 1.40.0 起拆成独立 bundle：

```powershell
& $DshCli plugin --profile desktop add (Join-Path $PluginRoot 'presets')
```

包名是 `@local/dsh-computer-use-presets`。不装它不影响电脑操作；预设里的
`workspace-dependencies` 需要 `DSH_RUNTIME_ROOT` 或标准运行时目录。

## 2. 装完先看三件事

```powershell
# 1) 离线自检：插件根、链接、bundles、重复挂载、PowerShell、发行身份
node (Join-Path $PluginRoot 'doctor.mjs') --release --profile desktop

# 2) 宿主活着时：在线 doctor（默认 3 秒超时，不会挂死）
node (Join-Path $PluginRoot 'doctor.mjs') http://127.0.0.1:19387 --json

# 3) 主动把后端拉起来（会 spawn worker；普通 doctor 不碰桌面）
node (Join-Path $PluginRoot 'doctor.mjs') http://127.0.0.1:19387 --probe-backend

# 4) 宿主启动失败：直接读原生 Diagnostic report 的首个失败
node (Join-Path $PluginRoot 'doctor.mjs') --diagnostic "<报告文件>" --no-profile
```

`--diagnostic` 只读报告，不执行报告里的任何内容；它把 `Failed plugins` 的第一个条目、
`Plugins waiting for services` 表和 `tools` provider 提示分开列出，不会把等待表当根因。

端口以 DSH 实际启动的 web 端口为准。界面验证：重启后打开任意会话，输入框工具栏出现「电脑操作」
芯片，点一下变成开启态。

`/computer-use/status` 是**无会话**的全局状态；要判断某个会话的 schema 是否与芯片一致，用
`/computer-use/state?sessionId=...` 或 doctor 的会话参数。

## 3. 排障：先分清阶段

| 现象 | 读什么 | 处理 |
| --- | --- | --- |
| 整个 DSH 启动失败，包含 `agent-loop (required)` / `tools` 等待 | **原生 Diagnostic report** 的第一个 `Failed plugins`、`--- error ---`、cause | 先查 `tools` 服务本身和 profile 依赖；不要先跑在线 doctor，也不要把等待表当根因 |
| 安装命令非零退出 | CLI 输出、退出码、包管理器诊断文件 | 按报错修路径/权限/兼容性；保留日志 |
| DSH 能开，但 `/computer-use/*` 404 | 实际 origin、profile bundles、加载日志 | 404 只说明该 origin/path 没有路由；先确认端口/实例/bundle/加载失败 |
| `findings` 有 `DUPLICATE_INSTANCE` | 日志里的既有路径/版本、本次路径/版本 | 删除重复的 bundle 行或预设行；不要靠“再挂一次”修 |
| `findings` 有 `RELEASE_BUILD_MISMATCH` | `releaseBuildId`、manifest 版本、mismatch 文件 | 半套升级/混装：用新目录整体切换，别只替换一个文件 |
| `findings` 有 `RELEASE_SCRIPT_MISSING` | `backend/release-input.ps1` | 重新解压完整包；不要只复制 worker.ps1 |
| `findings` 有 `NO_TOOLS_REGISTERED` | `runtime.registrationFailures`、宿日志 | `apply()` 在此之前中断；看 `defineTool` 拒绝原因 |
| `findings` 有 `TOOLS_REFUSED` | 每个工具名 + 原文 | 被拒工具不可用，其余照常；按原文修 schema |
| `findings` 有 `POWERSHELL_MISSING` | 解析结果、候选绝对路径 | 确认 Windows PowerShell 5.1 存在；企业策略可能移除了它 |
| `findings` 有 `POWERSHELL_7_SELECTED` | 实际路径 | PowerShell 7 不保证 GAC 程序集；优先装回 5.1 |
| `findings` 有 `BUNDLE_NOT_ENABLED` | profile bundles | 手动补 bundle 或 remove/add；这是 `add` 的已知条件行为 |
| `findings` 有 `PROFILE_BUNDLE_DUPLICATE` | profile bundles | 同一 bundle 只留一项；重复会让 patch 合成两遍 |
| `findings` 有 `PROFILE_EXTRA_MOUNT` | 用户 patch 行号 | 删除重复插入行；bundle 已有一份全局行 |
| `findings` 有 `LEGACY_*` | 旧包/旧行 | 按第 5 节迁移后移除；卸载包不会自动删用户 patch |
| `findings` 有 `CORE_PACKAGE_COPY` | profile/插件目录副本路径、版本 | 核心包应由宿主提供；确认副本指向宿主版本 |
| `capability_unavailable` / `WEBSOCKET_UNAVAILABLE` | Node 版本、`doctor` 的 browser 块 | 浏览器能力需要全局 WebSocket（Node 22+）；桌面工具不受影响 |
| `WORKER_EXITED` / `START_TIMEOUT` / `TIMEOUT` | worker stderr、UIA provider、执行预算 | 先看后端阶段；失败后可重试启动 |
| 工具可见但 `NOT_AUTHORIZED` | 会话授权、scope、agent 绑定 | 点芯片授权；子代理不能从内部放宽 |
| 目标应用没打开 | 是否经 `app_launch`、`ELECTRON_RUN_AS_NODE` | 用 `app_env_audit` 确认注入变量 |

### 3.1 一段值得注意的启动失败链

如果宿主启动时报 `agent-loop (required)` 等待 `tools`，而插件自己的 `inject = ['tools']`，那么本插件
只是 `tools` 的**使用者**。优先查：

1. 完整报告最早的失败条目；
2. 合成后的 `tools` 行是否存在、启用、作用域正确；
3. `tools`/`scope`/`session` 等核心包实际从哪里加载、版本是否混用；
4. 禁用本插件后的单变量对照；
5. 宿主启动器是否被第三方补丁修改。

`doctor` 能查 profile、链接、bundle、核心包副本和 `engines.dsh`；它不能替代原生 Diagnostic report。
宿主打不开时，先保留报告文件，别反复请求一个不存在的 HTTP 服务。

## 4. 更新、启用、卸载

四个动作分开做，不要混在一次里：

| 动作 | 做法 |
| --- | --- |
| 更新 | 解压到**新版本目录** → 记录旧路径/版本 → 完整退出 DSH → `add` 新目录（或切换 link）→ 重启 → `doctor --release` |
| 启用 | 确认依赖存在、bundle 在 `dsh.profile.bundles` 中 → 重启 |
| 临时停用 | 从 bundles 移除（或 `remove`），重启；不要只删磁盘目录 |
| 卸载 | 完整退出 → `dsh plugin --profile desktop remove @local/dsh-computer-use` → 检查用户 patch 是否还有手写行 → 重启 |

`link:` 安装卸载后，插件目录仍可保留；删除它之前先确认 profile 不再引用。

## 5. 从三个旧包迁移

旧包：`@local/dsh-token-guard`、`@local/dsh-app-launch`。功能对应：

| 旧包 | 新位置 |
| --- | --- |
| `@local/dsh-token-guard` | `config.tokenGuard`（键名不变） |
| `@local/dsh-app-launch` | `config.appLaunch`（键名不变） |
| 旧 token-guard 的三个预设 | `presets/` 独立 bundle |

顺序：

1. 记录实际启用的旧包、旧 bundle 行、用户手写 patch；
2. 备份 profile 的 `package.json` 与 `cordis.patch.yml`；
3. 迁移旧配置到 `tokenGuard` / `appLaunch`；
4. 完整退出 DSH；
5. 移除明确重复的旧包/旧行（**卸载包 ≠ 自动删除用户手写 patch**）；
6. 安装完整新目录，重启；
7. `doctor --profile desktop` 确认唯一实例、无 `LEGACY_*`、无 `PROFILE_EXTRA_MOUNT`。

不要整份覆盖用户 profile；只改与本插件相关的键和行。

## 6. 发行包怎么组装（排查前提）

* `backend/parts/*.ps1` 是源码，`backend/worker.ps1` 是生成物；`node tools/build-worker.mjs --check`
  会挡住“片段改了但没重新生成”。
* `release-manifest.json` 由 `node tools/pack-candidate.mjs` 生成；`releaseBuildId` 覆盖 51 个生产文件
  （index/client/internal/browser/backend/patch/presets），`workerBuildId` 只表示 worker 局部身份。
* 宿主启动时重算整份身份并与清单比对；`/status` 的 `runtime.release`、doctor 的 `RELEASE_BUILD_MISMATCH`
  都来自同一份计算。
* 打包器排除 `dist/`、`artifacts/`、`_zips/`、旧 `*.zip`/`*.tgz` 和输出目录；从干净检出打包，再把
  zip 解到临时目录验证路径、文件清单和导入。

## 7. 最小故障材料

报告问题时请附：

1. DSH desktop/runtime/Node/Electron 精确版本；插件版本、来源、`releaseBuildId`；
2. 完整安装命令、退出码、包管理器诊断文件；是否手工 `npm/pnpm install` 过核心包；
3. 故障阶段：安装 / 启动 / 预设 / 开启芯片 / 首次调用 / 运行一段时间 / 目标应用启动；
4. 原生报告的 `error`、`host diagnostic`、第一个 `Failed plugins` 和 cause；
5. 相关 profile 依赖、bundles、电脑操作相关 patch、实际链接目录；旧独立包是否仍启用；
6. Windows 版本/架构、PowerShell 版本及 `LanguageMode`、是否远程/锁屏/受管；
7. 禁用本插件、只保留核心、启用预设的对照结果。

只抽取相关配置，隐藏凭据、代理口令、令牌和无关会话内容。
