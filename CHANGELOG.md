# 更新记录

## 1.40.3 — 2026-10-25

**修复：官方 ASAR 桌面端与 npm CLI 装完后“加载不到插件”。**（依据《dsh-computer-use 1.40.2：问题研究与可执行修正方案》P0-A / P0-B / P0-C / P1-C）

两个 issue 的入口症状相同：状态路由 404、工具 unknown。根因不在 worker，而在挂载之前——
插件拿不到宿主共享的 `dsh-tools`，`index.js` 第 107 行的顶层 await 直接失败，`apply()` 从未执行。

- `package.json`：恢复 `@deepseek-ai/dsh-tools` / `@deepseek-ai/dsh-scope` 的 peer 声明，并标为
  **optional**（`peerDependenciesMeta`）。这是官方 `dsh-app-boot` 的 `routeLinked()` 判断
  “这个外部链接插件该走宿主拦截解析”的依据；optional 只表示包管理器不必替你安装，不表示
  运行时可以没有。两者范围与 `engines.dsh` 保持一致，不再用 `*` 冒充兼容。
- `internal/host-packages.mjs`：解析改成“官方通路优先 + 锚点兜底 + 事实记录”：
  裸说明符成功且属于活动宿主时直接使用；落到插件旁或别的副本时记 `HOST_PACKAGE_LOCAL_COPY`
  并改用活动宿主；锚点覆盖 CLI 入口、`process.resourcesPath`、可执行文件旁的 `app` 与
  `app.asar`、npm 的 `node_modules` 布局；找到包后初始化失败原样抛
  `HOST_PACKAGE_IMPORT_FAILED`，不再换另一份副本；`DSH_APP_MODULES` 与运行中宿主冲突时抛
  `HOST_INSTANCE_CONFLICT`。`describeHostEntry()` 现在描述**实际选中**的那份。
- `internal/schema-visibility.mjs`：`dsh-scope` 从裸 `import` 改为统一解析器，失败时不再被
  `catch` 静默吞掉——新增 `scopeResolution()`，把 `SCOPE_RESOLUTION_DEGRADED` 作为事实报出去。
- `internal/preflight.mjs`：`detectHost()` 读解析记录里的 `runtimeKind` / `resolutionSource` /
  `sameHostInstance`，不再用“路径里有没有 `resources/app`”猜来源；ASAR、npm、unpacked 都算
  正确宿主。新增 `hostContractReport()`。
- `internal/doctor.mjs`：新增 `HOST_NOT_IDENTIFIED`、`ASAR_RUNTIME_REQUIRED`、
  `HOST_INSTANCE_CONFLICT`、`HOST_INSTANCE_MISMATCH` 四条结论。普通 Node 读不到 `app.asar`
  不再等于“宿主版本未知”，也不再建议重装。
- `setup.mjs`：不再要求 `DeepSeek Harness.exe` 与 `resources\app\...\cli.js` 同时存在；
  支持 `--dsh-cli`、`--host-entry`、`--host-modules`、`--repair-only`、`--json`；asar 宿主
  不做修复（归档内目录不是 Windows 目录，不能建 junction）；退出码由**再次扫描**决定，
  不再因为“执行过修复”就报成功。
- `install-and-repair.cmd` / `fix-profile-links.cmd`：改为调用 `setup.mjs`，不再各自实现安装
  与路径判断；`tools/fix-profile-links.ps1` 遇到官方 asar 布局时明确 SKIP 而不是 exit 3。
- `internal/release-manifest.mjs`：`setup.mjs`、两个 `.cmd` 安装入口与
  `tools/fix-profile-links.ps1` 纳入发行身份——安装器变了，`releaseBuildId` 必须跟着变。
- 新增 `host-contract-test.mjs`（15 条）：optional peers 声明、四种运行时类型的识别、
  `DSH_APP_MODULES` 的选中与来源记录、以及“找到但初始化失败不得换副本”。

- **诊断分层**（P1-A）：`doctor` 现在输出 `resolve / activate / backend` 三层结论，未观测到的层
  标 `not-run` 而不是混进 `ok`；宿主内 scope 解析失败改报 `SCOPE_RESOLUTION_DEGRADED`，不再被
  `catch` 吞成“可解析”。`index.js` 的顶层宿主导入失败时先向 stderr 打一行结构化
  `BOOTSTRAP_FAILED {stage, code, attempts, runtime}`。
- **降级挂载**（P1-A 中期）：导入失败不再让整个模块起不来。插件以 `inject: []` 挂上一个只读面，
  `/computer-use/status` 与 `/computer-use/doctor` 回答 **503 + `{ok:false, state:'failed',
  stage:'resolve/import', code, resolution}`**——不注册任何工具、不启动 worker，也不假装成功。
  这样“宿主没加载起来”终于有一个能读的入口，而不是一片 404。
  真实宿主验证：把 `DSH_APP_MODULES` 指向另一份宿主后，row 仍然挂载成功，`/computer-use/status`
  返回 **503 + `HOST_INSTANCE_CONFLICT`**（点名“运行中的宿主是 app.asar 那份”），不是 404。
- **npm 布局识别**：候选根就是 `<...>/node_modules` 时也能认成 `npm-cli`（此前只会落到 `custom`），
  并用真实 CLI 入口 `process.argv` 锚定，不再依赖“可执行文件旁边猜目录”。
- **安全软件拦截**（P1-B）：新增 `internal/security-block.mjs`，把 AMSI / Defender 隔离区 /
  AppLocker·WDAC 的文本识别为 `BACKEND_BLOCKED_BY_AV`（`retry: 'never'`），并与“脚本缺失”“挂载
  失败”分开叙述；`doctor` 的 backend 层给出 `blocked` 而不是 `failed`，处置建议是提交误报样本，
  不包含“关闭 AMSI / 长期加排除”这类做法。
- **`real-tools-probe.mjs`**：找不到 `app.asar` 从 `exit 0` 改为 **`exit 3`（NOT EXECUTED）**；
  `--allow-skip` 只是显式承认“没跑”，仍然不算 PASS。
- 新增 `security-block-test.mjs`（11 条）、`degraded-bootstrap-test.mjs`（12 条）、
  `migration-drill-test.mjs`（14 条），`host-contract-test.mjs` 扩到 19 条（含
  `HOST_INSTANCE_CONFLICT`、`ASAR_RUNTIME_REQUIRED`、npm 布局的子进程用例）。

**矩阵实测（1.40.3）**

| 场景 | 结果 |
|---|---|
| 干净官方 0.2.1-rc.3 ASAR 桌面 + `link:` | `/computer-use/status` **200**，buildId 与清单一致 |
| 同一发行包从 `路径 测试 #1\`（空格、中文、`#`）安装 | **200** |
| 桌面宿主 + 矛盾的 `DSH_APP_MODULES` | row 仍挂载，**503 + `HOST_INSTANCE_CONFLICT`**（不是 404） |
| **npm 安装的 DSH 0.2.1-rc.2 + `link:`** | **200**，`instance.root` 指向解压目录 |
| **npm 安装的 DSH 0.2.1-rc.2 + tarball（pnpm 11.5.2）** | **200**；profile 内**没有** `@deepseek-ai/dsh-tools` 副本（optional peers 生效），bundle 行自动补齐 |
| **`npx @deepseek-ai/dsh@0.2.1-rc.2` + `link:`** | **200** |
| **`pnpm dlx @deepseek-ai/dsh@0.2.1-rc.2` + `link:`** | **200** |
| 旧 profile 有真实副本 → 宿主原件可用 | 换成指向宿主的 junction，退出 0 |
| 旧 profile 有真实副本 → 宿主原件缺失 | **退出 1，副本原样保留**（不删、不报成功） |
| 副本修好但 profile 仍声明依赖 | **退出 1** 并点名声明行 |
| `setup.mjs --check` | 退出 1（有问题），但一个文件都没动 |

尚未完成（下一轮）：宿主包损坏（缺传递依赖）的实机复现、rc.2 桌面实机（本机只有 rc.3），
以及 Defender 无排除环境下的 worker 启动。**完整清单与“未验证”项见随包的 `VERIFICATION.md`**
（按报告 §8 的口径：跳过与未执行不计入 PASS）。

其中 **U2（Defender 无排除项）** 已在 2026-10-25 尝试并记录为“环境受限、不构成有效测试”：
本机 WinDefend 服务可启动，但实时防护与引擎仍被第三方 AV（第三方实时 AV）压住（`Set-MpPreference` →
`0x800106ba`、`MpCmdRun -Scan` → `0x80004005`、`AMSIProviderVersion` 为空），因此不能算通过。
worker 基线本身已跑通（`{"ready":true}` + 截图 2.79 MB，无 AV 签名），详见 `VERIFICATION.md` 的“U2 现场记录”。

## 1.40.2 — 2026-10-22

**修复：一次大尺寸 PNG 截图会让所在会话永久不可用。**

宿主对附件做归一化时会把超限的 PNG 重编码（带 alpha → WebP，否则 JPEG），插件过去把**入参**
声明的 `mediaType` 写进会话记录，于是记录成了"PNG 标签 + WebP 实体"，`bytes` / `width` /
`height` 却是归一化后的真值。宿主每轮重放历史时按字节复核 ref，判 `ATTACHMENT_CORRUPT`：

```
Stored attachment metadata does not match its reference.   (code: UNKNOWN)
```

失败发生在请求组装阶段（`step` 停在 1），模型一次都没被调用；新建会话正常。

- `internal/capture.mjs`：`admitCapture()` 整条 ref 透传 —— `mediaType` 取 `ref.mediaType`，
  `bytes` / `width` / `height` / `originalDimensions` 全部来自同一个 ref，不再与入参混用。
- `internal/tool-contracts.mjs`：`IMAGE_VALUE_SCHEMA` 增加可选的 `originalDimensions`
  （`additionalProperties: false`，不声明就会被宿主判为未声明属性）。
- `schema-test.mjs`：新增 4 条断言，用一个"会改格式"的假存储把这条路径钉死；把修复退回旧写法
  时测试立刻失败并打印 `image/png vs image/webp`。

**已经写坏的会话不会自愈**：日志里那条 image block 仍会被每轮重放。处置办法是把它记的
`mediaType` 改成落盘对象的真实格式（看对象头魔数：`89 50 4E 47`=PNG、
`52 49 46 46 … 57 45 42 50`=WebP、`FF D8 FF`=JPEG），或弃用该会话。

**修复：以 `link:` 安装后没有「电脑操作」按钮。**

`dsh plugin add` 装出来的是 `link:`，模块留在解压目录（例如 `D:\DSH-Plugins\...`）。插件过去
用静态 `import '@deepseek-ai/dsh-tools'` 取 `defineTool`，Node 会从那个目录逐级向上找
`node_modules` —— 应用自带的包在 `<app>\resources\app\dsh\node_modules`，不在这条路径上，
于是整行导入失败：

```
dsh: warning: 1 entry did not activate
computer-use (@local/dsh-computer-use): failed to import: Error [ERR_MODULE_NOT_FOUND]:
Cannot find package '@deepseek-ai/dsh-tools' imported from D:\DSH-Plugins\...
```

宿主本身一切正常（`tools` 行是它自己的），所以界面上只有"装好了但没有芯片"，没有任何报错。
过去的临时办法是往插件目录里塞一份宿主同版本的 `dsh-tools` / `cordis` / `dsh-llm` /
`dsh-sandbox` / `dsh-scope`，但那是把宿主版本抄进插件，升级必然错位。

- 新增 `internal/host-packages.mjs`：先按普通说明符解析（装在 profile 里时正确），失败则按
  **运行中应用的绝对路径**导入 `<exe>\resources\app\dsh\node_modules\@deepseek-ai\...`。
  以文件 URL 导入入口后，它自己的依赖（`dsh-llm`、`cordis`、`dsh-sandbox`…）由 Node 从应用
  目录解析，所以插件旁边**不需要任何 node_modules 副本**。
- `index.js`：静态 import 改为顶层 `await importHostModule('@deepseek-ai/dsh-tools')`。
- `internal/app-launch.mjs`：不再自己 import `defineTool`，改用主插件传入的那份；缺失时只关掉
  `app_launch` / `app_env_audit` 两个工具，不再拖垮整行。
- `internal/schema-visibility.mjs` 的 `dsh-scope` 解析本来就是 try/catch 降级，保持不动。

验证：把包解压到一个**没有 node_modules** 的目录、以 `link:` 装进干净 profile —— 修复前
`/computer-use/status` 返回 404（行未激活），修复后返回 200 且 `registrationFailures: 0`。

**与插件解压到哪一行无关。** 解析锚点始终是**运行中的应用**，不是插件目录：命令行
（`<app>\resources\app\dsh\node_modules\...`）→ `process.execPath` → `%LOCALAPPDATA%` /
`%ProgramFiles%` → `DSH_APP_MODULES`。实测三种刁钻路径全部正常（HTTP 200、
`registrationFailures: 0`）：

| 解压位置 | 结果 |
| --- | --- |
| `E:\临时 目录\插件 安装位置\dsh-computer-use`（空格 + 中文） | 200 |
| `C:\Users\<用户>\Downloads\插件包\dsh-computer-use-1.40.2\dsh-computer-use`（深层） | 200 |
| `E:\cu #1\dsh-computer-use`（`#`） | 200 |

`/computer-use/status` 的 `runtime.host` 新增 `hostPackages`，直接写出这份
`@deepseek-ai/dsh-tools` 来自哪里、是什么版本、是否来自安装目录：

```json
"hostPackages": {
  "tools": "C:\\...\\resources\\app\\dsh\\node_modules\\@deepseek-ai\\dsh-tools\\package.json",
  "toolsVersion": "0.2.1-rc.2",
  "fromApplication": true
}
```

顺带把 `runtimeVersion` 也修好了：`link:` 安装下 `import.meta.resolve` 必然失败，过去这里显示
`unknown`；现在同一个解析器回落到安装目录读 `dsh-app-boot` 的清单。

**安装入口**：新增 `setup.mjs`（一条命令完成安装 + 清理 + 复核）、`install-and-repair.cmd`
与 `fix-profile-links.cmd`（双击即可）。

**安装渠道澄清：npm 上那两个名字都不是本项目。**

有用户用插件框"输包名"安装，装到的是 npm 上的 `dsh-computer-use@0.3.1`——**另一个作者的插件**
（仓库 `988hj7tczd-oss/dsh-computer-use`），所以看起来"包体还是老的"。本项目的名字是
`@local/dsh-computer-use`，`@local` 是不可发布的占位作用域，npm 上并不存在。

| npm 上的名字 | 实际是什么 |
| --- | --- |
| `dsh-computer-use` | 别人的插件，0.3.1，2026-09-10 最后更新 |
| `@deepseek-ai/dsh-computer-use` | 官方 `deepseek-harness` 的 provider 注册辅助包 0.1.6-alpha.1 |
| `@local/dsh-computer-use` | 本项目，未发布 |

- Release 多带一个可直接安装的 tarball：`dsh plugin add <路径>\local-dsh-computer-use-1.40.2.tgz`
  （实测：安装后 `/computer-use/status` 返回 200、`registrationFailures: 0`）。
- 新增 `tools/publish-npm.mjs`：要发布到自己名下的包时用它把名字**一次性改写一致**（manifest、
  bundle patch、presets、doctor、文档），只打包不发布，最后打印 `npm publish` 命令。
  用 `--name dsh-computer-use-ljl454` 实测：改写 19 个文件后打包 888 KB，装进干净 profile
  后行正常激活（`fromApplication: true`）。
- `runtime.host.hostPackages.fromApplication` 改为按**路径**判断（是否落在
  `<app>\resources\app\dsh\node_modules`），不再依赖"走了哪条解析分支"——装在 profile 里时
  宿主包也可能由适配层解析到应用目录，旧写法会误报 `false`。



## 1.40.1 — 2026-10-22

**修复：装完之后 DeepSeek Harness 起不来。**

1.39.x 与 1.40.0 都把 `@deepseek-ai/dsh-tools` 声明成 peer（1.39 是 `"*"`，1.40.0 是
`>=0.2.1-rc.2 <0.3.0`，两者都是 `optional: false`）。包管理器据此会在用户的 profile 里落一份
实体副本：

```
<profile>\node_modules\@deepseek-ai\dsh-tools\      ← 包管理器装的
```

而宿主的 `tools` 这一行**优先从 profile 解析**。副本与桌面版版本一旦不一致，loader 直接禁用
该行（`dsh: disabling profile plugin row "tools" ...`），所有注入 `tools` 的 row 一起挂起，
其中 `agent-loop` 是 required：

```
The application could not start or stopped unexpectedly.
agent-loop (required)  tools
tool-working-directory tools
...
```

界面上这张表**不点名任何插件**，所以很难查。1.39 的 `"*"` 在 npm 上解析到 `latest`
（当时是 `0.0.1-rc.1`），因此几乎必然触发。

- `package.json`：删除 `peerDependencies` / `peerDependenciesMeta` 中的 `@deepseek-ai/dsh-tools`
  与 `@deepseek-ai/dsh-scope`（后者从未被 `import`）。宿主的包由 loader 的解析适配层提供，
  不需要 profile 里有副本 —— 在"profile 里完全没有该包"的干净环境上实测通过。
- `index.js`：`apply()` 增加只读自检，profile 若自带一份 `dsh-tools` 会报到
  `runtime.profileShadow`，并在日志里给出修复命令。
- 新增 `tools/fix-profile-links.ps1`：把实体副本换成指向安装目录的 junction（幂等），
  并报告"被写进 `package.json` 依赖树"这种安装删不掉的情况。

**升级的用户不需要额外动作**：`dsh plugin add` 内部的 `pnpm install` 会把那份已不在依赖树里的
副本移到 `node_modules\.ignored\`。实测一个 `tools` 行已被禁用、完全起不来的 profile，重跑
一次安装命令即恢复启动。

## 1.40.0 — 2026-10-22

把 1.39.5 已确认的安装/诊断问题修掉，不加新工具：

- 重复挂载在注册任何工具/路由之前被拒绝（`DUPLICATE_INSTANCE`）；
- manifest 声明 `engines.dsh`，peer 范围不再写 `*`；
- `doctor` 分离线/在线两层，缺 `release-input.ps1` 或缺发行清单不再假通过；
- 全发行 `releaseBuildId` 覆盖 host / client / internal / patch / worker，不再只看 `worker.ps1`；
- PowerShell 候选按 PATH + PATHEXT 真正解析；
- 三个任务预设拆成独立可选 bundle（`presets/`），核心安装不再依赖文档/分析运行时；
- 浏览器底层缺全局 WebSocket 时报 `WEBSOCKET_UNAVAILABLE`，不再裸 `ReferenceError`。

## 1.39.5 — 2026-10-18

预设加载、重复挂载、芯片时序与工具可见性的一组修复。
