# 人物动作触发问题：按方案落地的改动与验证记录

对象：`dsh-computer-use` 1.50.1（运行目录 `E:\inkos\dsh-plugins\dsh-computer-use`）。
依据：`outputs/action-trigger-review/人物动作触发问题调查与实施方案.txt`（2026-11-08）。
本文只写"改了什么、怎么验的、还差什么"，不重复方案原文。

---

## 0. 一句话结论

方案里的四类问题（部署身份、输入采集/降级、反馈呈现、自动化语义）都已在源码里落地，
并用可复现的自检与协议测试覆盖；**唯一没有在本机完成的是"真实用户桌面上的输入投递"**——
本轮环境里合成的 `SendInput` 不会被送到任何低级钩子（新旧探针都是 0 回调），所以那一条必须回到
普通用户 Medium 桌面上按第 4 节的步骤验收。

---

## 1. 改动清单

### 阶段 1：部署与运行身份（P0）

| 位置 | 改动 |
|---|---|
| `index.js` | helper 路径解析改为三级：显式 `exePath` → **已部署安装位置** `%LOCALAPPDATA%\dsh-computer-use\helper` → 包内 `native/indicator-helper/build`；新增 `indicatorExeSource`（`explicit`/`installed`/`development`），`/status` 与 doctor 都能看到 |
| `native/indicator-helper/main.cpp` | 新增 `ReadIdentity()`（`OpenProcessToken` + `TokenIntegrityLevel` + `TokenUIAccess` + `ProcessIdToSessionId`），`ready`/`health` 报告 `exePath`、`integrityRid`、`integrityName`、`uiAccess`、`sessionId`、`identityCanObserveInput`；`--hook-probe` 也带这几项 |
| `internal/doctor.mjs` | 新增 `INDICATOR_INTEGRITY_TOO_LOW`（fatal）、`INDICATOR_INPUT_NOT_DELIVERED`、`INDICATOR_HOOK_MISSING`、`INDICATOR_ESCAPE_NOT_READY`、`INDICATOR_FEEDBACK_NEVER_PRESENTED`，每条都给出下一步动作 |
| `tools/deploy-helper.ps1`（新增） | 把 helper 复制到普通安装位置，校验 SHA256、**文件完整性标签**与**真实进程令牌**；发现 Low 直接失败并说明原因。不请求管理员、不改开发树权限、不带 SACL |
| `native/indicator-helper/build.ps1` | 新增 `-OutDir`：验证构建可以写进另一个目录（正在运行的 helper 会锁住默认 `build/` 里的 exe，报 LNK1104），并把 `advapi32.lib` 加进链接 |

### 阶段 2：输入采集、降级与拖拽（P1-B/C）

| 位置 | 改动 |
|---|---|
| `pointer-events.h` | 新增 `Kind::Wheel`（带 `wheelDelta` / `horizontal`）与 `Button::X1/X2`（`kButtonCount = 5`）；新增 `PushWheel()` 与 `WheelEvents()`；滚轮与按钮一样受保留槽位保护 |
| `pointer-controller.h` | `UpdatePosition()` 现在累计"按下原点 → 当前位置"的最大距离（**P1-C**：只靠位置兜底也能进 `drag`）；`ResyncExtended()` 支持五个按钮并打 `pressTravelResampled`；`Wheel()` 产生滚动反馈而不伪造按住 |
| `main.cpp` | 钩子处理 `WM_MOUSEWHEEL` / `WM_MOUSEHWEEL` / `WM_XBUTTONDOWN` / `WM_XBUTTONUP`；键盘钩子只累加 `keyActivity` 与时间戳（**不保存键值/字符/密码/窗口文字**），50 ms 限速唤醒 |
| `main.cpp` | `DeliveryState()` 把 `unavailable/idle/quiet/ok/anomalous` 分开（**P1-G**：正常静止不再误报）；`SamplePointer()` 健康时 1 s 一致性检查、判定异常时降到 16 ms 采样，并**有界**重装（0.5/1/2/5 s 退避，`hookReinstalls` 计数；完整性不足时不重装） |
| `main.cpp` | 启动自检用 `g_inSelfTest` 隔离：`mouseSelfTestDown/Up` 不再污染 `mouseHookCalls` / `lastHookCallbackAtMs` |

### 阶段 3：反馈真的显示出来（P1-D/E）

| 位置 | 改动 |
|---|---|
| `animation-player.h` | 新增 `animation::Feedback`（`id`、`kind`、`clip`、`source`、`eventAtMs`、`presentedAtMs`、`windowMs`、`rate`、`coalesced`、`resampled`、`external`）；`StateFor()` 先看反馈对象：未呈现则**不许按墙钟判过期**（`kPendingFeedbackMs = 500`），已呈现则窗口从首帧 Present 起算 |
| `pointer-controller.h` | `EmitFeedback()`（新 id / 120 ms 同类合并）、`MarkPresented()`（只有成功 Present 才记账）、`ExpireFeedback()`（超预算如实报 `pending_expired`）、`EndExternal()`（结束时收势而不是重播） |
| `main.cpp` | `UpdateCursorPose()` 用 **feedback id** 判断"是否新反馈"（**P1-E**：同名 `release` 连点也重新起算）；`DrawCursorPixels()` 在 `overlay::Present` 成功后才 `MarkPresented`，并在有 pending 反馈时**不许**走 `renderKey` 跳过路径 |
| `pointer-controller.h` | 短按倍率改为 `releaseAnimationMs / kTapFeedbackMs(220)`，落在 150—250 ms 区间（不再写死 2.5 倍） |

### 阶段 4：工具动作语义通道（P1-F）

| 位置 | 改动 |
|---|---|
| `main.cpp` | 新增命令 `visualActivity`：`kind`、`phase`、`source`、`operationId`、`sequence`、`epoch`、`helperGeneration`；旧代次/旧 epoch 直接 `applied:false` + `stale_generation`/`stale_epoch`；`ResolveFeedbackClip()` 做 kind → 片段映射与退化 |
| `interaction/indicator-supervisor.mjs` | 新增 `activity()`：只在 `state === 'active'` 且能力位为真时发；**不抛出、不阻塞**（400 ms 预算）；`supportsActivity`、`activityDropped`、`lastActivity`、`consultation` |
| `index.js` | `activityKindFor()` 把后端命令映射成动作类别（含 `uiact` 的 `invoke`/`set_value` 细分、`batch` 取第一步）；在 `call()` 的**派发边界**发 `start`/`end`/`failed`，发完不 await |
| `index.js` | `browserActivityKind()` + `runActions` 包裹：CDP 的 `click`/`type`/`fill`/`press`/`scroll` 也发 `source: 'cdp'` 的活动（CDP 不产生系统鼠标边沿，这是**唯一**能驱动视觉的路径） |
| `ready` | 新增 `capabilities`：`visualActivity`、`wheel`、`sideButtons`、`typing`、`feedbackIds`、`presentConfirmed`、`deliveryState`、`identity` |

### 停止通道（附带项）

`escapeReady` 现在来自 `keyboardHookReady`（`ready`、`health`、`scopeReady` 三处），
不再用"至少一个钩子装上了"冒充。

### 阶段 5：动作表与预览（P2）

| 位置 | 改动 |
|---|---|
| `internal/action-table.mjs`（新增） | 11 行动作表（事件 → 第一版表现 → 首选片段 / 退化 / 来源 / 说明）+ `previewPlan()`（7 个可预览类别） |
| `index.js` `GET /computer-use/action-table` | 把动作表与预览计划作为**文档**暴露给设置页/诊断页，和运行时事实分开 |
| `index.js` `POST /computer-use/visual-preview` | 预览走**与真实工具动作同一条**活动消息（`source: 'preview'`），不发任何桌面输入；helper 无活动通道时明确 409，不报成功 |
| `indicator-activity-test.mjs` | 对 7 个预览类别逐个跑 start/end，断言真的产生了反馈且解析到真实片段 |

设置页的渲染仍在宿主那一侧（包内没有 HTML/CSS）：它只要读这两条路由就能画出"动作说明 + 预览"，
插件侧已经提供数据与预览通道。

---

## 2. 验证证据（本轮实际跑过的）

| 命令 | 结果 |
|---|---|
| `build.ps1 -OutDir build-verify` | `built: 517632 bytes (link exit 0)`，`/W4` 无警告 |
| `dsh-interaction-indicator.exe --pointer-self-test` | `ok:true`，20,000 组 / **180,065** 条断言 / 0 失败（改前 160,033 条） |
| `dsh-interaction-indicator.exe --self-test` | `{"ok":true,"checks":415,"failures":[]}` |
| `node indicator-helper-test.mjs`（`DSH_INDICATOR_EXE` 指向新构建） | **81 passed, 0 failed** |
| `node indicator-activity-test.mjs`（新增） | **67 passed, 0 failed**：身份、能力位、活动通道、旧代次/旧 epoch 拒绝、7 个预览类别、health 29 个新字段 |
| `node indicator-supervisor-test.mjs` | 34 passed |
| `node indicator-integration-test.mjs` | 11 passed |
| `node visual-preferences-test.mjs` / `action-catalog-test.mjs` / `browser-actions-test.mjs` | 34 / 140 / 47 passed |
| `node cache-budget-test.mjs` / `transition-table-test.mjs` | 13 / 19 passed |
| `tools/deploy-helper.ps1` | `ok:true`：`steps=[copied, hash-verified, file-label-ok, process-identity-ok]`，部署后 `integrity=high(12288)`、`canObserveInput=true`、`hook=true`、`lastError=0` |
| 身份 A/B（同一 SHA256，两处路径） | 源码树副本：`integrityRid=4096 low`、`canObserveInput=false`；普通目录副本：`12288 high`、`canObserveInput=true` |
| `node doctor.mjs`（离线） | `结果：没有发现让电脑操作无法工作的问题`（exit 0） |
| 发行身份 | 新的 `release-manifest.json`：`releaseBuildId = 189a9911e33ac1c1`，95 个文件，`matches: true` |

> 说明：`native/indicator-helper/build/dsh-interaction-indicator.exe` 已换成新构建
> （旧二进制留在 `native/indicator-helper/build/rollback/dsh-interaction-indicator.exe.2026-11-08`，
> 作为回滚记录——正在运行的 helper 不会被中断，它继续用已改名的旧文件）。

## 3. 新增的回归断言（`pointer-self-test.h`）

- 兜底拖拽：`Resync` 按下 + `UpdatePosition` 移动 100 px 后 `pressTravelPx ≥ 100`、状态读到 `drag`、反馈 `source=sampled`；
- 同名片段连点：第二次点击 `feedback.id` 必须变大、`presentedAtMs` 归 -1、`StateFor` 立刻回到 `release`（**P1-E**）；
- 延迟 350 ms 消费：仍在 pending 预算内必须还是 `release`；`MarkPresented` 之后窗口才走；超预算如实 `pending_expired` 且不再占据状态（**P1-D**）；
- 滚轮：不伪造按住、`kind=scroll`、30 ms 内两次脉冲合并成一条并计数、横向单独计数；
- 侧键：X1 独立 down/up 并计一次点击；
- 工具语义：`invoke` 不伪造按住、标 `external`、`EndExternal` 收势、**不计作用户点击**。

## 4. 还没完成 / 只能在真实桌面验收的部分

1. **真实投递**：本机自动化上下文里合成的 `SendInput` 不会被送到任何低级钩子（新旧探针都是 `calls:0`），
   所以"钩子能收到真实鼠标"这一条本轮无法自证。验收步骤：
   - `tools/deploy-helper.ps1` 部署 → 确认 `integrityName` 至少 `medium`；
   - 在普通用户桌面移动/单击/按住/拖拽/滚轮/侧键，读 `/computer-use/status` 的 `deliveryState`（应为 `ok`）
     与 `feedbackCreated`/`feedbackPresented`（两者都应增长）；
   - 静止 60 秒后 `deliveryState` 应为 `quiet` 而不是 `anomalous`。
2. **UIA/CDP 端到端**：活动通道的协议、宿主侧接线与 CDP 步骤上报都已完成，但没有在自建窗口/本地页面上跑
   "逐条 `operationId` 的开始/结束 + 无双播"的验收（方案 阶段 4 第 8 条）。`batch` 目前只按**第一步**上报一个类别，
   逐步细化要等 worker 的分步回执。
3. **视觉验收**：100%/150%/200% DPI 下按压/拖拽可辨认、`reducedMotion` 下静态反馈，未做像素级验收。
4. **性能目标**：事件→成功呈现 P95 ≤ 50 ms 未测（需要真实输入）。
5. **美术资源**：`scroll` / `typing` / `tap` 仍是临时映射（退化到 `release` / `press_in`），未制作独立片段；
   设置页的动作说明与预览 UI 由宿主渲染，插件侧已提供 `GET /action-table` 与 `POST /visual-preview`。

## 5. 复现命令

```powershell
cd E:\inkos\dsh-plugins\dsh-computer-use

# 1) 构建（默认 build/ 被运行中的 helper 占用时用 -OutDir）
powershell -NoProfile -ExecutionPolicy Bypass -File native/indicator-helper/build.ps1 -OutDir build-verify

# 2) 纯逻辑自检（不建窗口、不装钩子）
& native\indicator-helper\build-verify\dsh-interaction-indicator.exe --pointer-self-test
& native\indicator-helper\build-verify\dsh-interaction-indicator.exe --self-test

# 3) 协议与能力位
$env:DSH_INDICATOR_EXE = "$PWD\native\indicator-helper\build-verify\dsh-interaction-indicator.exe"
node indicator-helper-test.mjs
node indicator-activity-test.mjs

# 4) 部署到普通安装位置并核验身份
powershell -NoProfile -ExecutionPolicy Bypass -File tools/deploy-helper.ps1 -Source native/indicator-helper/build-verify
```
