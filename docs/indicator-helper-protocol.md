# `dsh-interaction-indicator.exe` 协议与生命周期（v2）

方案 3.x / 4.x / 6.2 / 7.1 是这份文档的来源。helper 是**独立进程**：它不认识工具、不决定业务成功，
只负责"把状态画出来"和"把真实 Esc 变成一条事件"。所有消息都是一行 JSON（JSONL），stdin 进、stdout 出。

**v2 与 v1 不兼容**：窗口结构从"每屏一张整屏窗口"变成"每屏 4 条边 + 1 个横幅 + 全局 1 个光标窗口"，
`windows` 不再等于显示器数量；同时新增日常伴随消息。旧 supervisor 与 v2 helper 不能混装，
`hello` 的版本不符会回 `PROTOCOL_MISMATCH`。

## 1. 边界

| 归 helper | 不归 helper |
|---|---|
| 每屏四条边条、独立横幅、全局光标窗口 | 授权、租约、请求状态机 |
| 显示器拓扑、每屏 DPI、`WDA_EXCLUDEFROMCAPTURE` | 谁在执行、要不要重放 |
| `WH_KEYBOARD_LL` 与本地停止闩锁 | 判定动作是否成功、释放 held input |
| 视觉偏好（装饰/高度/主题）与日常伴随的**显示资格** | 会话开关、工具可见性、电脑操作授权 |

## 2. 窗口结构与计数（方案 3.1 / 7.1）

```
每台显示器：TopEdge BottomEdge LeftEdge RightEdge Banner
全局：      Cursor（光晕或角色至少一项要显示时才创建）
```

- 边条容量固定：`s = ceil((32 + 4) × dpi / 96)`，呼吸只改窗口内部 alpha，**不改 HWND 尺寸**；
- 上下条拥有四个角，左右条从内边界起止（半开区间，四矩形两两不相交）；
- 角部亮度用**同一个**环形距离场 `alpha = peak × (1 - smoothstep(d / thickness))` 计算，
  所以角部只生成一次颜色，不会由两个窗口叠加变亮；
- 计数分开报：`monitorCount` / `displayWindowCount` / `cursorWindowCount` / `createdWindowCount` /
  `surfaceReadyWindowCount` / `visibleWindowCount` / `presentOkWindowCount` / `failedWindowCount`。

`visualReady` 只有在**每屏五个窗口都创建成功、有有效表面、且最近一次 `UpdateLayeredWindow` 成功**、
并同时 `escapeReady` 时才为真。角色加载失败只降级角色（`characterSurface: degraded`），不影响基础提示。

## 3. 消息

| 方向 | 方法/事件 | 最小字段 | 语义 |
|---|---|---|---|
| → helper | `hello` | `protocolVersion`（=2） | 版本不符回 `error PROTOCOL_MISMATCH`，不启动 |
| ← helper | `ready` | `protocolVersion`、`buildVersion`、`pid`、`renderBackend`、`visualReady`、`escapeReady`、`layoutEpoch`、`counts`、`windows`、`topology`、`characterLoaded`、`characterAssetVersion`、`renderMode`、`companionEnabled` | `escapeReady` 是钩子真的装上了，不是"进程起来了" |
| → helper | `beginScope` | `scopeId`、`epoch` | 建窗→画一帧→再回答；`ready` 不等于已显示 |
| ← helper | `scopeReady` | `scopeId`、`epoch`、`visualReady`、`escapeReady`、`windows`（=已创建数）、`counts`、`layoutEpoch`、`cursorStatus`/`cursorWindows`、`firstPresentMs`、`characterSurface`、`renderMode`、`topology`、`windowsDetail` | 两个 ready 分别确认；光标装饰是第三项 |
| → helper | `updateState` | `seq`（单调）、`active` | 旧 `seq` 回 `applied:false`，不改状态 |
| ← helper | `stateApplied` | `seq`、`applied`、`currentSeq` | |
| → helper | `setVisualPreferences` | `settingsRevision`、`preferences` | 只应用新修订；旧的回 `applied:false` |
| ← helper | `visualPreferencesApplied` | `settingsRevision`、`applied`、`changed`、实际生效值 | 回执代表"真的画了一帧"，不只是字段赋值 |
| → helper | `setCompanionPreferences` | `enabled`、`hostInstanceId`、`settingsRevision`、`helperGeneration` | 日常伴随的独立准入；不伪造 `scopeId` |
| ← helper | `companionApplied` | `requestedEnabled`、`effectiveVisible`、`hiddenReason`、`ownerMode`、`cursorWindows`、`cursorSurface` | "用户选了"与"角色出现了"分开说 |
| ← helper | `cancelRequested` | `scopeId`、`epoch`、`reason:"physical_escape"`、`latch` | 本地闩锁先置位，再发这条事件 |
| → helper | `endScope` | `scopeId` | 不认错 scope；结束后**销毁**边条与横幅 |
| ← helper | `scopeEnded` | `applied`、`frames`、`counts`、`ownerMode` | |
| → helper | `suspendVisual` | — | 截图回退：把像素收起来（只影响可见性，**不**解除 Esc 与闩锁） |
| ← helper | `visualSuspended` | `applied`、`suspended`、`counts`、`ownerMode` | 表示"确实收起来了" |
| → helper | `resumeVisual` | — | 截图结束：按**当前**可见性重画，不复活已结束的 scope |
| ← helper | `visualResumed` | `applied`、`suspended`、`counts`、`ownerMode` | |
| → helper | `health` | — | 诊断用 |
| ← helper | `health` | `phase`、`frames`、`characterFrames`、`characterCacheBytes`/`Entries`、`escapeReady`、`latch`、`layoutEpoch`、`loopIterations`、`counts`、`windows`、`cursorSurface`/`cursorTracking`/`cursorPressed`/`cursorQuadrant`、`companion`/`companionHiddenReason`/`ownerMode`、`bannerHr`、`mouseSelfTestDown`/`Up`、`pointerEventsSeen`/`Applied`/`QueueDepth`、`pointerMovesCoalesced`/`DroppedEdges`/`OverflowEpisodes`、`pointerClicks`/`Resyncs`/`ResyncReason`/`WakeFailures`/`ReleaseRate` | 排障要看得到"没有横幅"与"横幅画失败"的区别；指针那组证明按钮边沿走的是有序队列，而不是被最终值覆盖的布尔量 |
| ← helper | `topologyChanged` | `layoutEpoch`、`monitorCount`、`counts`、`topology` | 显示变化后**合并成一次**重建并上报 |
| → helper | `shutdown` | — | |
| ← helper | `closed` | `frames`、`hookRemoved`、`windows`、`counts`、`uptimeMs` | 释放报告 |
| ← helper | `error` | `code`、`reason`、`requestId` | `PROTOCOL_MISMATCH` / `BAD_REQUEST` / `BAD_JSON` / `LINE_TOO_LONG` / `UNKNOWN_METHOD` |
| → helper | `visualActivity` | `kind`、`phase`、`source`、`operationId`、`sequence`、`epoch`、`helperGeneration` | 工具动作的**视觉**语义（v2 附加消息，见 §12）。只驱动角色动画，不伪造按钮状态、不补发输入 |
| ← helper | `activityApplied` | `operationId`、`kind`、`phase`、`applied`、`feedbackId`、`feedbackClip`、`feedbackSource`、`feedbackPresented`、`reason` | `applied:false` 时 `reason` 是 `stale_generation` / `stale_epoch`：迟到的旧代次消息被丢弃，不污染新会话 |

## 4. 有界性

- 单行输入最多 **64 KiB**，超过整行丢弃并回 `LINE_TOO_LONG`；
- 输出单行同限；
- 命令队列最多 **64** 条，超出计 `rejectedCommands`；
- **所有 UI 操作都在主线程**：读线程只做"读一行、解析、投递"。踩过的坑：在读线程里
  `CreateWindowExW` 会让窗口归属那个线程，随后主线程渲染/销毁它就是跨线程操作，进程以
  `0xC0000374`（堆损坏）退出。`indicator-helper-test.mjs` 的生命周期用例覆盖这条。

## 5. DPI 与刷新（方案 3.3 / 6.2）

- 进程**必须**是 PerMonitorV2 感知：`indicator-helper.manifest` 声明，`build.ps1` 用
  `/MANIFEST:EMBED /MANIFESTINPUT:` 嵌进 exe。缺了它，DWM 会把覆盖层按 150% 拉伸，
  窗口只拿到 1707×960 逻辑坐标，人物必然发虚（这是 1.50.1 的实际状态）。
- 窗口位置 / DIB 尺寸 / 鼠标热点用**物理像素**；布局、文字、人物大小用 **DIP**，
  只在 `overlay::DipToPx` / `PxToDip` 两处换算。D2D render target 保存真实 DPI，
  传进去的坐标因此是 DIP。
- 刷新节奏按视觉分类，各有期限：

  | 内容 | 触发 | 频率 |
  |---|---|---|
  | 四边呼吸 | 装饰开启且可见 | 20 Hz（`kEdgeIntervalMs`） |
  | 横幅文字/底板/装饰 | 内容脏或装饰动效 | ≤20 Hz |
  | 横幅吃饭主动作 | 到达素材帧边界 | 按 `durationsMs` |
  | 光标姿势 | 帧变更或按压状态 | ≤30 Hz |
  | 光标位置 | 真实指针改变 | 钩子唤醒 + 100 ms 兜底轮询，只移动窗口不重画像素 |

  没有期限时 `MsgWaitForMultipleObjectsEx` 等消息，不做固定轮询。

## 6. 截图排除的两条路径

1. **系统能力**：每个窗口设 `WDA_EXCLUDEFROMCAPTURE`，逐窗核对返回值（`captureAffinity` /
   `captureError`），诊断里能看出是哪一窗失败；
2. **回退**：对不认这个标记的捕获后端，宿主在捕获期间调 `suspendVisual`，结束后调 `resumeVisual`。
   宿主侧用引用计数协调（`internal/capture-exclusion.mjs`）：只有第一个持有者隐藏、最后一个恢复；
   `finally` 一定恢复；恢复时**重新计算**可见性，不沿用暂停前的窗口清单。

## 7. 停止语义

真实 Esc（`LLKHF_INJECTED` 不置位）触发：

1. 钩子线程原子置位 `latch`（同一 scope 只响应一次）；
2. 投递 `kEscapeMessage` 给主线程；
3. 主线程把 phase 置 `Stopping`，横幅改说 `Stopping…` / `Esc was pressed`，装饰动效立刻停下；
4. 发出 `cancelRequested`。

helper **不**自己去杀 worker、不判定"已停止"；那是执行内核与 `backend/supervisor.mjs` 的事。
仅日常伴随时不拦截 Esc：没有控制 scope 时键盘钩子完整透传。

## 8. 角色资源（pack v2）

```json
{
  "schema": "dsh.character.pack/v2",
  "assetVersion": "c-frames-v2",
  "alpha": "straight-rgba",
  "renderMode": "composite",
  "clips": {
    "eat_loop": {
      "atlas": "eat_loop.png",
      "frameSize": [272, 362],
      "grid": [4, 4],
      "frameCount": 16,
      "loop": true,
      "durationsMs": [400, 240, 120, 120, 120, 120, 120, 160, 300, 180, 200, 200, 160, 160, 200, 400],
      "totalMs": 3200,
      "anchorPx": [139, 352],
      "contentBounds": [12, 5, 254, 347],
      "bytes": 2544335,
      "sha256": "…"
    }
  }
}
```

- `contentBounds` 是**该片段全部帧的并集**，不是逐帧自动裁剪：否则头发/尾巴一摆，整个人物就跳。
- 尺寸按"人物可见高度 ÷ `contentBounds` 高度"缩放（方案 4.1），透明边距不再吃掉设置值。
- 加载器校验：schema（v1 只读兼容 / v2 / 其它显式拒绝）、行列容量、帧矩形、时长总和、路径不越出
  资源目录、`frameRefs` 不越界、图集字节数不超过像素预算、`sha256` 逐字节一致。
- 缩放只在**资源准备阶段**做一次（面积滤波缩小 / 双线性放大，预乘空间），运行时只做预乘 over；
  缓存按（片段 × 目标像素高度）键控，软上限 32 MiB、硬上限 64 MiB，超了按最久未用淘汰。
- `renderMode: layered` 时额外支持至多 6 个活动部件（尾巴/发束/呆毛），部件按 `pivot` + 相位平移；
  本轮交付的是 `composite`（帧里已经含尾部动作），健康度如实报 `composite`，不冒充分层。

## 9. 日常伴随（方案 3.5）

- 独立开关 `cursorCompanion`（默认关闭），与电脑控制装饰分别保存；开启后**宿主启动即生效**，
  不需要任何 computer 工具调用。
- 只启动视觉 helper 与一个光标窗口：不建 TaskScope、不申请电脑操作权限、不启动 UIA/PowerShell/CDP。
- 不显示边条、横幅、光晕、点击高亮；Esc 正常交给前台应用。
- `hiddenReason` 取值：`disabled` / `suspended` / `assetsMissing` / `shuttingDown`（空串表示正在显示）。
- `ownerMode`：`none` / `control` / `companion` / `both` —— 目标是**始终最多一个光标窗口**。
- 结束控制 scope 时销毁边条与横幅，光标按伴随开关重新计算，不一律关掉。

## 10. 验证

```powershell
# 协议与窗口结构（真实 helper，单屏）
node indicator-helper-test.mjs
# 宿主侧客户端（假 helper 进程）
node indicator-supervisor-test.mjs
# 偏好文档（含 v1 迁移）
node visual-preferences-test.mjs
```

| 用例 | 断言 |
|---|---|
| 版本协商 | 99 → `PROTOCOL_MISMATCH`；2 → `ready` 且 `counts.monitorCount === topology.length` |
| `beginScope` | `visualReady`/`escapeReady` 均为 true；`displayWindowCount === topology.length × 5`；`presentOkWindowCount === displayWindowCount + cursorWindowCount` |
| `setVisualPreferences` | 新修订生效并回显；旧修订 `applied:false` |
| `setCompanionPreferences` | `requestedEnabled` 与 `effectiveVisible` 分开报；关闭后 `cursorWindows: 0` |
| `endScope` | 边条与横幅**销毁**（`counts.displayWindowCount === 0`） |
| `shutdown` | `closed`：`hookRemoved:true`、`windows:0`，进程 exit 0 |

**未验证**：真实双屏与混合 DPI 热插拔（本机单屏）；8 小时常驻成本；真实 200% DPI 下的像素级画质。
这些属于方案第 8 章的实机矩阵，不能由单屏结果外推。

## 11. 手工预览与实机探针

```powershell
# 协议 + 像素 + 窗口几何一次跑完（用 --no-affinity，所以截图里看得见覆盖层）
node tools/overlay-probe.mjs [--shots <dir>] [--hold 1500]

# 只跑协议（不带像素）
node native/indicator-helper/preview.mjs --seconds=8
```

`tools/overlay-probe.mjs` 会做四件事，并把结果打在一行里：
`scopeReady` 的窗口计数、`health` 的角色/缓存/`bannerHr`、`probe-overlay-windows.ps1` 枚举到的真实
窗口矩形（`DshOverlayWindow|2560x54@0,0` 这样的行就是 DPI 感知是否生效的证据，未生效时是 `1707x36`）、
以及"显示/暂停"两张截图的差分（差分为空就说明像素根本没画出来）。

覆盖层期间用模型截图看：**看不到覆盖层是对的**（`WDA_EXCLUDEFROMCAPTURE` 生效）。

## 12. v2 附加能力：身份、投递状态、反馈与活动通道

协议号仍是 **2**：下面这些字段与消息是**附加**的，旧宿主不会发 `visualActivity`、也不读新字段；
宿主侧按 `ready.capabilities.visualActivity` 决定发不发，旧 helper（没有 `capabilities`）明确降级成"不发"，
而不是发出去等一个必然超时。正式统一升级时再谈 v3。

### 12.1 运行身份（阶段 1）

`ready` 与 `health` 都带：`exePath`、`integrityRid`、`integrityName`、`uiAccess`、`sessionId`、`identityCanObserveInput`。

低完整性进程装得上 `WH_MOUSE_LL` / `WH_KEYBOARD_LL`，但 UIPI 不会把用户桌面的输入投递给它：
角色只剩位置轮询，表现是"只有待机和移动"。`identityCanObserveInput` 是 helper 读自己令牌得出的结论，
doctor 据此直接报 `INDICATOR_INTEGRITY_TOO_LOW`，不必再让人怀疑鼠标驱动。

### 12.2 投递状态（阶段 2）

`health.deliveryState` 取值：`unavailable` / `idle` / `quiet` / `ok` / `anomalous`。

- 只有 **anomalous** 才代表"位置/按键独立地变了、钩子计数却一动不动"；
- `quiet` 是"用户真的没动"，正常静止 60 秒不会被报成丢投递；
- 启动自检直接调用钩子回调，**不**计入 `mouseHookCalls` / `lastHookCallbackAtMs`（`mouseSelfTestDown/Up` 只证明
  "回调 → 队列 → 状态机"这条链，不证明系统投递）；
- 判定 anomalous 后：按钮采样降到 16 ms（`sampledResyncs` 计数），并按 0.5/1/2/5 秒退避**有界**重装
  （`hookReinstalls`）。完整性不足（Low）时不重装，直接交给 doctor 报部署问题。

### 12.3 反馈账（阶段 3）

`health` 里：`feedbackId`、`feedbackKind`、`feedbackClip`、`feedbackSource`、`feedbackEventAtMs`、
`feedbackPresentedAtMs`、`feedbackWindowMs`、`feedbackCreated`、`feedbackPresented`、`feedbackCoalesced`、
`feedbackDropped`、`feedbackDropReason`、`gestureTravelPx`、`gestureResampled`、`pressToPresentMs`、
`feedbackPresentLatencyMs`。

三条规矩：

1. 可见窗口从**首帧成功 Present** 起算；没画出来之前不按墙钟判过期（pending 预算 500 ms，超了如实报
   `pending_expired`）。
2. 新反馈有新 `id`，即使片段名仍然是 `release` 也重新起算（连点不会从第 7 帧开始）。
3. 同类高频反馈在 120 ms 内只**续期**（`feedbackCoalesced`），不排队，不积压几秒动画。

### 12.4 动作类别与临时映射

`visualActivity.kind` 至少覆盖：`pointer_click`、`pointer_drag`、`pointer_hold`、`scroll`、`type`、`invoke`、
`set_value`。资源里没有对应片段时退化到已有片段并如实回显 `feedbackClip`：

| kind | 首选片段 | 退化 |
|---|---|---|
| `pointer_click` | `tap` | `release` |
| `pointer_drag` | `drag` | `release` |
| `pointer_hold` | `pressed_hold` | `press_in` |
| `scroll` | `scroll` | `release` |
| `type` / `set_value` | `typing` | `press_in` |
| `invoke` | `tap` | `press_in` |

**动画不是成功证据**：`activityApplied` 只说明"提示收到了"，操作成败仍由执行内核回执判定；
`phase: failed` / `cancelled` 只让动作收势，不显示成功。

### 12.5 停止通道

`escapeReady` 现在来自**键盘钩子自己的**就绪状态（`keyboardHookReady`），
不再用"至少一个钩子装上了"（`hookReady`）冒充。鼠标钩子成功不能证明 Esc 可用。

`ready` 也直接带 `keyboardHookReady` / `mouseHookReady` / `deliveryState`，一条消息就能说清三件事。
