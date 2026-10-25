# 1.40.3 验收记录（哪些跑了、哪些没跑）

本文件对应研究报告 §8 的要求：**没有执行、环境缺失、主动跳过必须单独计数，不能算 PASS。**
下表只写实际执行过的；未执行的单独列在最后一节。

## 环境

| 项 | 值 |
|---|---|
| 桌面宿主 | DeepSeek Harness **0.2.1-rc.3**（Electron 44.7.0 / Node 24.21.0），官方 ASAR 布局（`resources/app.asar`，无解包目录） |
| npm 宿主 | `@deepseek-ai/dsh@0.2.1-rc.2`（npm 安装到隔离前缀，`lib/bin.js` 启动） |
| 临时宿主 | `npx --yes @deepseek-ai/dsh@0.2.1-rc.2`、`pnpm dlx @deepseek-ai/dsh@0.2.1-rc.2`（pnpm 11.5.2） |
| 插件安装 | `link:`（目录）与 tarball（`npm pack` → `dsh plugin add <tgz>`，由宿主自带 pnpm 11.5.2 执行） |
| 隔离方式 | 每个场景独立 `DSH_HOME`、独立 profile、独立端口；桌面场景通过真实 `dsh-desktop-host` 入口启动 |

## 已执行（PASS）

| # | 场景 | 方式 | 结果 |
|---|---|---|---|
| 1 | 干净官方 ASAR 桌面 | `link:` | `/computer-use/status` **200**，`ok:true`，版本与 `buildId` 与 `release-manifest.json` 一致 |
| 2 | 路径含空格、中文、`#` | `link:`（`E:\...\路径 测试 #1\`） | **200** |
| 3 | 桌面宿主 + 矛盾的 `DSH_APP_MODULES` | `link:` | 插件 row **仍挂载**，`/computer-use/status` **503** + `HOST_INSTANCE_CONFLICT`（不是 404） |
| 4 | npm 宿主 | `link:` | **200**，`instance.root` 指向解压目录 |
| 5 | npm 宿主 | tarball | **200**；profile 内无 `@deepseek-ai/dsh-tools` 副本；bundle 行自动补齐 |
| 6 | npx 宿主 | `link:` | **200** |
| 7 | pnpm dlx 宿主 | `link:` | **200** |
| 8 | 旧 profile 有真实副本、宿主原件可用 | `setup.mjs --repair-only` | 换成指向宿主的 junction，退出 0 |
| 9 | 旧 profile 有真实副本、宿主原件缺失 | 同上 | **退出 1**，副本原样保留（未删除） |
| 10 | 副本修好但 profile 仍声明依赖 | 同上 | **退出 1**，点名声明行 |
| 11 | `--check` 只读 | 同上 | 退出 1（有问题），文件未改动 |
| 12 | **U4 真实动作**：截图 / 指针移动 / 键盘按下 | 在运行的 rc.3 桌面宿主里直接调用 `computer_*` 工具 | 截图 **2560×1440**、475 ms（worker 内 350 ms）；指针移动 2 步、214 ms；`shift` 送达前台窗口（详见“U4 现场记录”） |

以上 1–7 的判据都是 `GET /computer-use/status`：它能答话，说明 `apply()` 执行到了路由注册阶段；
宿主模块解析、peer 契约、profile 安装这三层都已经过。第 12 行走的是**真正的工具调用链**
（tool → bridge → worker → GDI/SendInput），补上了 1–7 未覆盖的那一段。

## 未执行（NOT VERIFIED，不计入 PASS）

| # | 场景 | 为什么没跑 |
|---|---|---|
| U1 | rc.2 **桌面端**（ASAR，Electron） | 本机只装了 rc.3 桌面；npm 的 rc.2 是 CLI 宿主，不能冒充桌面 |
| U2 | Defender 无排除项环境下的 worker 启动 | **在本机尝试过，未能构成有效测试**：WinDefend 服务可以启动，但 `RealTimeProtectionEnabled`/`AntivirusEnabled` 仍为 False、`AMSIProviderVersion` 为空；`Set-MpPreference` 返回 `0x800106ba`，`MpCmdRun -Scan` 返回 `0x80004005`（引擎被动）。原因是另一款实时 AV（第三方实时 AV）仍在 Windows 安全中心注册且其服务有自保护、停不掉。要有效验收需要在 Defender 真正接管的机器上重做（详见下方“U2 现场记录”） |
| U3 | 宿主包损坏（缺传递依赖）的**实机**复现 | 需要一份坏掉的宿主安装；单元层已覆盖“找到但初始化失败 → `HOST_PACKAGE_IMPORT_FAILED`，不换副本” |
| U5 | 旧版（1.39.5 / 1.40.0）用户机上的实际迁移 | 只有夹具演练，没有真实用户历史 profile |

## 结论口径

- “插件加载成功”指：`/computer-use/status` 返回 200 且 `ok:true`。
- “失败可诊断”指：返回 503 且 body 带 `state:'failed'`、`stage`、`code`、`resolution`。
- 任何被跳过的场景都不得写进发行说明的“已验证”一栏；本文件即依据。

## U2 现场记录（2026-10-25，本机）

目的是判断默认配置的 Defender（AMSI）会不会拦 `backend/worker.ps1`。结论：**这台机器上无法构成有效测试**，
不是“通过”，也不是“失败”。

现场数据：

```text
Start-Service WinDefend                     → 成功，服务 Running
(Get-MpComputerStatus).RealTimeProtectionEnabled → False
(Get-MpComputerStatus).AntivirusEnabled          → False
(Get-MpComputerStatus).AMSIProviderVersion       → （空）
Set-MpPreference -DisableRealtimeMonitoring $false → 0x800106ba（引擎不可用）
MpCmdRun.exe -Scan -ScanType 3 -File worker.ps1    → 0x80004005
Get-CimInstance root/SecurityCenter2 AntiVirusProduct → Windows Defender、第三方实时 AV
Stop-Service HRWSCCtrl                      → 被自保护拒绝
```

原因：Windows 在第三方实时 AV 注册期间让 Defender 处于被动状态——服务能起，引擎不给用，
AMSI 提供者不注册，按需扫描也跑不了。

已完成的**部分**验证（不能替代 U2）：

| 项 | 结果 |
|---|---|
| 用宿主同一条命令行启动 `backend/worker.ps1` | 输出 `{"ready":true,"info":{…}}`（15 项 capabilities，pid、dpi 正常） |
| 发一条 `screenshot` 请求 | 2 秒内返回 `ok:true`，落盘 PNG 2.79 MB |
| 该次运行的安全签名 | 未出现 `ScriptContainedMaliciousContent` / AMSI / `0x8007` 文本 |

也就是说：后端链路本身通；**未被验证的只是“Defender 引擎是否会拦它”**。

要补上 U2，需要：一台由 Defender 接管的 Windows（或临时卸载第三方 AV 并重启），确认三项为真后重跑
`worker.ps1` 探针，并检查 `Microsoft-Windows-Windows Defender/Operational` 的 1116/1117 事件。

## U4 现场记录（2026-10-25，rc.3 桌面）

在**正在运行的桌面宿主**里直接调用插件的工具（不是探针脚本，也不是 stub），走完整链路
`tool → ctx.tools → bridge → worker.ps1 → GDI / SendInput`：

```text
computer_screenshot   → 2560x1440 JPEG，475 ms（worker 内 350 ms，排队 1 ms）
                        文件 %TEMP%\dsh-computer-use\capture-2820-1.jpg
                        frame f68bc1，光标 (1761,935)，前台窗口 “<当前会话窗口标题>”
computer_actions      → 2 步指针移动（8,8 → 1761,935），后端 214 ms
computer_key shift    → “Pressed shift into <当前会话窗口标题>”
```

结论：截图、指针移动、键盘注入三条路径都通，且截图同时验证了编码、附件挂载与坐标信封
（1:1 物理像素、capture origin、frame id）。

**没有做的**（仍在 U4 之外，避免干扰正在使用的桌面）：

- 鼠标点击 / 双击 / 右键、拖拽、滚轮；
- 文本输入（`computer_type` / `computer_paste`）；
- UI Automation 动作（`computer_ui` / `computer_ui_action`）；
- 批量动作与等待条件（`wait_for`、`expected_transitions`）。

这些走的是同一条 SendInput/UIA 通道，但各自的参数语义未经本次实测；需要时可以单独补。


