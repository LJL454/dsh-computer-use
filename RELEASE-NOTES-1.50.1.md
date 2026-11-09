# v1.50.1 — 看得见的电脑操作

> 从 1.40.3 起算，15 天、71 个小节、302 个新文件。核心只有一件事：给原本"只发命令"的电脑操作插件，加一层**本地渲染的伴随层**——光标、横幅、角色、可从截图里排除的覆盖层；顺带把发行流程从"手工拼 zip"变成可验收的流水线。
>
> `computer_*` 工具集合**一个没变**（23 个工具名与 1.40.3 逐字一致），所以升级不需要改任何调用方式。

| | |
|---|---|
| 版本 | `1.50.1`（沿用版本号，用 `releaseBuildId` 区分构建） |
| releaseBuildId | `bd90e5fd81d8de4b` |
| 发行包 | `local-dsh-computer-use-1.50.1.tgz` · 263 文件 / 15.3 MB |
| 生产文件 | 98（1.40.3 为 94） |
| 运行要求 | Windows · DSH `>=0.2.1-rc.2 <0.3.0` · Node `>=20` · `desktop` profile |

## 亮点

- **覆盖层是全新的**：D3D/D2D 独立进程 `dsh-interaction-indicator.exe`，画光标角色、横幅、边缘呼吸，并且**默认从截图里排除**——`computer_screenshot` 不会把自己的 UI 拍进去。
- **缺件不拦操作**：helper 没构建、没起来、路径写错，一律降级为"没有动画"，写操作照常执行；只有"helper 起来了但没就绪"才拒绝，且拒绝时桌面零写入。
- **物理 Esc 能停**：`escapeReady` 来自键盘钩子自己的就绪状态（不再用"至少一个钩子装上"冒充）。Esc 闩锁后停止派发，并按代次（epoch）隔离，迟到的旧消息不会污染新会话。
- **指针保真有了自检**：按钮边沿改成有序事件队列，`--pointer-self-test` 跑 20,000 组 / 160,025 条断言，覆盖"主线程卡住时整组攒着再排空"的情况。
- **发行可验收**：逐文件 SHA256 清单 + 候选包 + 签名判定 + 一条命令跑完的验收脚本。
- **AMSI / Defender 拦截已解决**：Defender 曾把 `worker.ps1` 判成 `HackTool:PowerShell/EmpireGetScreenshot.C` 并在启动时拦下；已向微软提交误报样本、特征更新后不再命中，实测 `{"ready":true}`、扫描 0 威胁。不绕过、不关 AMSI、不加排除项。

## 🆕 覆盖层与角色

- 新增原生 helper `native/indicator-helper/`（133 个文件），产物 `dsh-interaction-indicator.exe`：覆盖层窗口、WIC 解码、软件合成、五/六个状态机、低级钩子、自检入口。
- 美术包升级到 **鲸鱼女仆 V11**（`whale-maid-restored-v11`，22 个运行时文件 / 13.7 MB）：引擎升到 **pack v3 / perClip**，部件图集按 `<clip>-<atlas>` 解析，部件 z 序真正分层（尾巴、后发画在身体之前，根部被干净遮住）；7 个片段、每段 15 或 16 帧、21 张图集。美术包自带的 249 个批准哈希全过。
- 覆盖层版面：四条边 + 独立横幅 + 一个光标本；横幅角色站左端、两段固定文字整体右移，不遮挡；光标角色贴热点一侧，窗口按"要不要画角色"自动放大（否则 52 DIP 的角色会被 76 DIP 的光晕窗口裁掉半截）。
- 截图排除做成规范的一对开关，并用**同一二进制只切一个开关**做了 A/B 取证。
- 崩溃恢复：helper 挂掉时只做三件事——记诊断、`abortAll`、把 scope 置空；重启交给**下一次派发**。

## 🎛 视觉效果设置

编辑器底栏「电脑操作」旁新增**「效果」**入口，六项开关逐项保存：

```yaml
interactionIndicator:
  enabled: true          # 写操作派发前等覆盖层就绪；物理 Esc 会闩锁并停止派发
  exePath: ''            # 空 = 用包内 native/indicator-helper/build/*.exe
visualEffects:
  enabled: true          # 总开关：只影响画面
  bannerCharacter: true
  cursorCharacter: true
  cursorHalo: true
  edgeBreathing: true
  reducedMotion: false
```

- **关动画关不掉安全通道**：所有开关只影响画面，「操作提示 / 停止 / Esc 取消」永远有效，面板底部也这么写。
- 存储走 `schemaVersion` + 原子写（`.tmp` → `rename`），`settingsRevision` 单调递增并持久化；文件损坏或版本不认识时保留 `.corrupt-<ts>` 副本并回默认值——一个手改坏的 JSON 不能拦住插件。
- 未知键、错类型一律**拒绝并逐条报告**，不猜测升级。
- 路由 `GET/POST /computer-use/visual-preferences`：保存后若覆盖层在跑就把新修订推给 helper，并把"存下来"与"已生效"**分开报告**。

## 🩺 诊断能力

- `trace` 新增三个字段：`verifyMs`（发行校验耗时）、`retryCount`（重试次数）、`gapBeforeMs`（同会话上一组插件调用返回到本次开始的时间差，标注"含宿主调度/模型与网络等待/用户停顿，不是纯推理时间"）。并发调用只标 `overlappedCall: true`，不伪造间隔；空闲会话最多保留 100 个。
- `/computer-use/status` 新增 `indicator: { enabled, state, scope }`——配置有没有真打开、helper 起没起、当前有没有 scope，一处看完。
- helper `health` 新增两组口径：**指针账**（`pointerEventsSeen/Applied/QueueDepth`、`pointerMovesCoalesced`、`pointerDroppedEdges`、`pointerClicks/Taps/Resyncs`、`mouseHookCalls`）与**投递状态**（`deliveryState`: `unavailable/idle/quiet/ok/anomalous`）。只有"位置/按键独立变了、钩子计数一动没动"才算 `anomalous`，静止 60 秒不会被误报。
- 反馈账：`feedbackId` / `feedbackClip` / `feedbackPresented` / `coalesced` / `dropped` / `pressToPresentMs` 等，回答"这次点击为什么没动画"。
- doctor 新增判定码：`INDICATOR_INTEGRITY_TOO_LOW`（致命，低完整性进程装得上钩子但收不到 UIPI 投递）、`INDICATOR_ESCAPE_NOT_READY`、`INDICATOR_FEEDBACK_NEVER_PRESENTED`、`INDICATOR_INPUT_NOT_DELIVERED`。新增 `doctor.mjs --release` 正式发行验收层。
- 新增 `/computer-use/action-table`（schema `dsh.computer-use.action-table/v1`）：事件 → 第一版表现 → 资源状态的**文档**，与"现在发生了什么"的运行时状态分开。

## 🛡 AMSI / Defender 拦截：已解决，不再命中

**先说结论**：以前这会直接把插件打死——Defender 把 `backend/worker.ps1` 里的截图逻辑判成 `HackTool:PowerShell/EmpireGetScreenshot.C`，通过 AMSI 拦在 worker 启动这一步。我们已经向微软**提交了误报样本**，该特征更新后不再命中，现在启动正常。

实测（Windows Defender 实时防护开启，特征库 `1.463.201.0`）：

| 检查 | 结果 |
|---|---|
| 从 `%TEMP%` 副本启动 worker | `{"ready":true, …}`，无 AMSI 报错 |
| 从工作区路径启动 worker | `{"ready":true, …}`，stderr 为空 |
| `MpCmdRun -Scan -ScanType 3 -File worker.ps1` | `found no threats`，`exit 0` |
| 启动后 10 分钟内 Defender 新检测 | 0 条 |

对照用的原始命中记录：`11-08 23:22  amsi:…\backend\worker.ps1 → HackTool:PowerShell/EmpireGetScreenshot.C`。

**怎么解决的**：走正规流程——向微软提交误报样本（附脚本哈希、触发命令与原始报错），由厂商修正特征。全程**没有**改写脚本、没有关 AMSI、没有加排除项：`worker.ps1` 的字节与 1.40.3 完全一致。

判定会随特征库变动，所以插件同时留了一套兜底——万一哪天又被误判，也不会退回到"重装也没用"的状态：

- **认得出**：`ScriptContainedMaliciousContent`、`This script contains malicious content`、`0x8007661x`、Defender 隔离措辞、AppLocker/WDAC/CodeIntegrity 的原文，统一判为 `BACKEND_BLOCKED_BY_AV`（`retry: 'never'`）。拿到 PowerShell 的结构化 errorId 才算 `confirmed`，只有弱文本线索时是 `suspected`——不猜。
- **停得下**：确认被拦后 `start()` 直接以 `BACKEND_BLOCKED_BY_AV` 拒绝，**不再拉起同一个文件**，也不再进"崩溃→重启"循环——被扫一次就停，不制造第二次。
- **说得清**：诊断带 `phase`（launch / run / release）、`errorId`、`scriptHash`、`driverGeneration`、`delivery`、`retryable: false`；stderr 有界（600 字符）并脱敏用户名与邮箱。边界写死在结构里：只有启动阶段允许 `delivery: not_sent`，运行与释放阶段一律 `unknown`——不谎称"没发过输入"。
- **doctor 分开报**：backend 层给 `blocked`，不是 `failed`。处置建议是**提交误报样本**（附版本号、文件哈希、原文），明确**不包含**"关闭 AMSI"或"长期加排除项"这类做法——插件不绕过安全软件。
- **可恢复**：`clearSecurityBlock()` 与 `status.backend.securityBlock` 成对，用户更新病毒库/情报后重试即可，不必重装插件。

一句话：**现在不会命中**；万一哪天判定又变，你得到的也会是一条带错误码、脚本哈希和恢复入口的诊断，而不是一个"重装也没用"的黑箱。

## ⚡ 启动与体积

- 完整发行哈希校验从"挂载时同步跑"改为**挂载后约 2 秒异步跑**（最多同时读两份文件，仍全量重算，不用持久化信任缓存）；状态接口分 `pending / running / complete / error`，诊断接口会等同一次校验，不会把"尚未校验"报成通过。
- CDP 连接、页面状态、动作引擎改为**首次有效浏览器调用时**才加载；注册工具只加载轻量契约，工具名与输出格式保持兼容。
- 人物伴随延后约 2 秒自动恢复；用户主动调用、改设置仍立即生效；卸载时取消未执行的启动任务。
- 包收窄：`files` 从整个 `native/` 目录收敛到单个 `dsh-interaction-indicator.exe`，原生编译中间件、验证副本、旧版备份、探针产物都不再打包（同一份源码，包从 16.9 MB 降到 15.3 MB）。体积增长的大头是**真资源**：美术包 13.7 MB + 原生二进制 6.6 MB。

## 🎯 输入保真

- **按钮边沿不再被覆盖**：三个 `g_*Down` 原子量换成单生产者单消费者环（`Ring<512>`），边沿 **不合并**，队列满时优先丢 move（合并成"最新位置+时间"）并给按钮边沿留 32 个保留槽位。真丢边沿时计数 + 置降级 + 用 `GetAsyncKeyState` 重同步，避免角色永久按住。
- **多键交错算一次手势**（第二键按下不重置按下点，第一个键抬起不结束）；`Resync()` 合成的边沿不计入点击。
- **短按可见**：按下→抬起 ≤120 ms 且未越拖拽阈值时，`release` 按 2.5 倍播放（650 ms → 约 260 ms）。
- **快速拖动**只看位移阈值（约 6 DIP），不再要求先按住 200 ms。
- 修复 `drag-continue` 的真实缺陷——"用句柄接着画"的动作根本走不到 worker。
- 自检：`--pointer-self-test` → 20,000 组（10,000 组正常节奏 + 10,000 组整组攒着再排空）、160,025 条检查、0 失败；每 100 组灌 600 条移动把队列压满，验证"移动合并、边沿仍有保留槽位"。

## 🚀 渲染性能

- 首次解码移出绘制线程（后台预热 + 不可变缓存条目）。
- 按"像素是否变化"调度（`renderKey`），减少动画冻结部件的相位误差。
- 移动节流与按钮响应分离；局部常量只解析一次，光晕单独缓存。
- 缓存预算落到分配前（组级淘汰 + 预估算）。
- 跨片段姿势衔接（进入帧 + 同缓冲区短混合）。
- 实测：**静态画面 CPU 25% → 0%**；每个 scope 周期的句柄增量 **+3.8 → 0**；40 轮浸泡句柄 285 → 285、工作集 +0.5 MB。

## 🔧 修复清单

- helper 一崩就"崩溃→重启→再崩溃"的自我驱动循环：一条写操作曾触发 **45 次 release**，现在 ≤3 次。
- 只开"日常鼠标角色"时，鼠标旁仍挂着一圈雾化光晕（方案 3.5 明令禁止的组合）。
- 覆盖层在实机上不出现，根因是配置里一个空串。
- 换姿势闪动：切 clip 时顺手标脏，导致销毁重建 HWND+DIB；现在一个 scope 从打开到开伴随，窗口只创建 **1 次**（旧代码 2 次）。
- 换帧期限：循环片段的 `NextFrameDeadlineMs` 返回"下一轮边界"而非轮内下一帧；多轮、非均匀帧长、一次性片段都已覆盖（自检 407 → 415 条）。
- 一次性片段被截断：完成时间改从 pack 取（`press_in` 570 ms、`release` 650 ms），不再用状态机自带的 320/360 ms。
- 覆盖层 CPU 测量脚本少了 ×100，此前所有 CPU 数字小了 100 倍——已修，并改用"预热 5 s + 采样 60 s"的口径。
- `build.ps1` 除退出码外再扫 `error C#### / LNK####`（`cl` 在 LINK 致命错误下仍可能返回 0）。
- 插件卡片描述乱码（UTF-8 被按 GBK 读过的双重编码）修正为「电脑操作」。
- 被 AMSI/Defender 拦停在启动步骤（`HackTool:PowerShell/EmpireGetScreenshot.C`）：已向微软提交误报样本，特征更新后不再命中；仍保留 `BACKEND_BLOCKED_BY_AV` 确诊、停手与恢复入口。

## 🧪 测试

- 全量 **71 套件：66 通过 / 5 已知 / 0 未登记失败**（串行总跑器，压掉并行带来的假失败）。
- 指针保真 20,000 组 / 160,025 条断言 0 失败；`indicator-helper-test` 81 通过 / 0 失败。
- 美术包 `tools/verify-release.cjs`：249 个批准哈希全过。
- 发行验收 `node tools/release-acceptance.mjs`，另有 `tools/verify-live-host.mjs` 核对"跑着的就是磁盘上那份"。

## ⚠️ 已知问题

- **工作区里的低级钩子会静默**：在带 Codex 沙箱标记的目录树（例如某些工作区根目录）内启动 helper，钩子装得上、循环正常，但收不到投递（`hookSilent: true`）。同一份字节拷到 `%TEMP%` 或别的目录就正常。这是环境行为，产品路径现在会**如实报出来**，不再让人怀疑鼠标驱动。要精确区分 ACE 与过滤器驱动需要管理员级驱动审计。
- **角色像素级原画核对没跑**：美术包自带的 `native-art-check.cpp` 需要 `tools/native-pixels` 目录，该目录不在交付包内。
- **多屏与混合 DPI**：角色锚点只在单屏复核过，真实多屏/混合 DPI 未逐一验证。
- 5 个"已知"测试套件是历史断言过时（`character-pack` / `client-effects` / `release-report` 等），在未改动的基线副本上同样失败，不是本轮引入。

## 📦 升级须知

1. **必须重启宿主**：配置（`interactionIndicator` / `visualEffects`）在宿主启动时读取，运行中的进程不会热更。
2. **覆盖层默认开启**（`interactionIndicator.enabled: true`）。如果它出问题，把它改成 `false` 再重启即可恢复原状——**电脑操作本身不依赖覆盖层**。
3. **从 1.40.3 升上来**：`tokenGuard` / `appLaunch` 的配置键名不变，新增 `interactionIndicator` 与 `visualEffects` 两段。发行包已带编译好的 exe；要从源码构建需 Visual Studio Build Tools 跑 `native/indicator-helper/build.ps1`。
4. **别只看版本号**：1.50.1 是一系列同版构建，用 `releaseBuildId` 或包 SHA256 判断"装的是不是这一版"。当前为 `bd90e5fd81d8de4b`。
5. **安装**：解压后 `node setup.mjs`（会自动识别宿主布局并执行 `dsh plugin add`），或直接 `dsh plugin add <路径>`。
6. **AMSI / Defender 拦截已解决**：误报样本已提交微软并修正特征，实测实时防护开启（特征库 `1.463.201.0`）下 worker 正常 `ready`。若你的机器上仍出现拦截：`doctor` 会给出 `blocked` 与 `BACKEND_BLOCKED_BY_AV`（附脚本 SHA256 与原始报错），处置同样是**提交误报样本**＋更新情报后用 `clearSecurityBlock()` 重试；不要关闭 AMSI，也不要加长期排除项。

## ✅ 校验

```powershell
# 发行包内部一致性（逐文件 SHA256，构建期口径）
node tools/release-verify.mjs --dir . --build

# 一条命令跑完发行验收
node tools/release-acceptance.mjs

# 确认"跑着的构建就是磁盘上这一份"
node tools/verify-live-host.mjs
```

---

完整过程记录见仓库 `CHANGELOG.md`（自 1.40.3 起新增 71 个小节），发行清单见 `release-manifest.json`。
