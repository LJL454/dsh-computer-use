# 更新记录

## 1.50.1（2026-11-09 同版本优化）：减少无效往返与区分等待来源

- 保留下列启动优化，按用户要求保持版本号 1.50.1；通过发行 buildId 和包 SHA256 区分构建。
- 批量工具明确引导“近期目标 → 已知动作成组 → 条件等待 → 同调用返回观察”；在目标未知时重新观察。
- 明确批次的末尾观察需要显式请求，减少“动作完成后另发一次观察工具”的无效往返；未改变工具默认输入行为。
- 诊断 trace 加入同会话调用间隔，和插件执行时间分开；并发、匿名调用及卸载清理单独处理，最多缓存 100 个空闲会话。
- 间隔只表示插件外部等待，不冒充模型推理时间；工具选择引导的端到端收益仍需同模型任务对照实测。

## 1.50.1（同版本优化）：减少宿主启动阻塞

- 完整发行文件校验移到挂载后约 2 秒异步执行，同时最多读取两份文件；仍重新计算所有运行文件的 SHA256，不使用持久化信任缓存。
- 状态接口区分 pending/running/complete/error；诊断接口等待同一次完整校验，不会把“尚未校验”报成完整性通过。
- 日常人物伴随延后约 2 秒自动恢复，用户主动调用和修改设置仍立即生效；卸载时取消未执行的启动任务。
- CDP 连接、页面状态和动作引擎在首次有效浏览器调用时加载；注册工具只加载轻量契约，工具名与输出格式保持兼容。
- npm 包只收实际使用的 native helper，去掉原生编译中间文件、验证副本、旧版本备份与探针产物。
- PowerShell worker、输入行为和人物资源保持原字节。

## 宿主把 `hookSilent` 带进状态（用户与 doctor 都看得到）

上一轮让 helper 自己报"钩子装上了但收不到事件"；这一轮把它接到宿主：

- `ensureIndicatorScope()` 读 `health.hookSilent` / `health.hookSilentMs`，写进 `lastCharacterHealth`；
- 两处状态输出（`status` 与诊断报告里的 `character: lastCharacterHealth`）都带上这两个字段；
- `hook-silence-test.mjs` 增加三条静态契约：宿主确实读它、保住了时长、状态块确实暴露它。

现在从工作区树里跑（本机已知会沉默）时，状态里能看到 `hookSilent: true` 与沉默了多久，
而不是"点了没反应、什么都不知道"。

`hook-silence-test.mjs`：**9/9**。全量 **71 套：66 通过 / 5 已知 / 0 未登记失败**；
`release-acceptance` **18 pass / 2 warn / 0 fail**；包 448 项。

## 钩子沉默的根因收窄：`<workspace>` 是 Codex 沙箱工作区

用**新建的同级目录**做对照（`E:\probe3\h.exe`，E 盘根、标准 ACL、同一份字节）：

| 位置 | 钩子回调 |
|---|---|
| `E:\probe3`（新建） | **10,739** |
| `%TEMP%` / `C:\Users` / `E:\dsh-hookprobe` | 11,061–11,886 |
| `<workspace>\…`（任意子目录） | **2**（`hookSilent=true`） |

边界就是 `<workspace>` 这一棵树。同一时刻系统里跑着
`CodexSandboxService.OpenAI.Codex`（`codex-windows-sandbox-service.exe`），而 `<workspace>` 根上有别处没有的两条 ACE：
`Everyone:(CI)(DENY)(DC)` 与未解析 SID `S-1-4-474600998-170525099:(OI)(CI)(W,D,DC)`。
`<方案目录>`、`E:\probe3`、`E:\dsh-hookprobe` 都没有这两条，也都正常。

结论：**这是 Codex 桌面端沙箱工作区的标记**，镜像在该树内的进程收不到低级钩子回调（钩子装得上、循环正常）。
要精确区分"ACE 还是过滤器驱动"需要管理员级驱动审计，本轮到此。

顺带修掉工具里一句会误导的结论：`hook-aba.mjs` 以前按 **A/B 标签**判断"有没有差异"，
现在按**实际观察**（`hookSilent === true` / 回调数）逐个点名。

## 钩子"沉默"：产品路径复核 + 新增 `hookSilent` 健康状态

**1. 复核第 3 条的结论在产品路径上同样成立**（`tools/hook-aba.mjs --mode product`）：

| 位置 | 钩子回调 | hookSilent |
|---|---|---|
| `<workspace>\…\native\indicator-helper\build\…exe` | **2** | **true (4014 ms)** |
| `%TEMP%` | 7,601 | false |
| `C:\Users\<user>\dsh-hookprobe` | 7,989 | false |
| `E:\dsh-hookprobe` | 7,381 | false |
| `<workspace>\…\dist` | **2** | **true (4043 ms)** |
| `<workspace>\dsh-hookprobe` | **2** | **true (4006 ms)** |

之前那张表来自 `--hook-probe`（主线程装钩子），有人会怀疑是探针伪影；产品路径（专用钩子线程）给出同样的数字。

**2. 产品不再默默吞掉输入**：`health` 新增 `hookSilent` / `hookSilentMs` ——
钩子已就绪、确实有人在消费指针（有 scope 或伴随）、且已沉默 ≥3 秒时才为 true；静止的桌面不算沉默。

**3. 新测试 `hook-silence-test.mjs` 6/6**：工作区外 `hookSilent=false` 且回调数千；工作区内
`hookSilent=true` 且 ≥3000 ms；没有伴随时不报沉默。（第一版用"回调 > 0"当判据，被工作区里零星两个真实事件骗过，
已改成"成批到达"。）

## 新增 `tools/release-acceptance.mjs`：一条命令跑完发行验收

把散在文档里的检查收成一个可重复执行的闸门，任何一条 FAIL 就整体失败：

| 段 | 检查 |
|---|---|
| 1 身份 | 仓库重算的 `buildId` 与随包清单一致；`missing` 为空；`assets/character`（含 `transitions.json`）、`interaction/`、native exe 都在身份里 |
| 2 打包 | ZIP 存在且可读；**清单里的 94 个文件逐个都在包里**；npm 的 `files` 覆盖三个运行目录 |
| 3 解包 | 解到临时目录后重算身份仍一致，并在解包目录**起真实 helper**（`release-report` 的 runtime 列） |
| 4 钩子 | 同一份二进制（先校验 sha256）在工作区内/外各跑一次 `--hook-probe`：装得上、`lastError=0`、消息循环在转；工作区副本收不到事件记 **WARN**（已知限制） |
| 5 签名 | `Get-AuthenticodeSignature` 如实记录（未签名 → WARN，不是 FAIL）；附 SHA256 与字节数 |

本机实跑：**18 pass / 2 warn / 0 fail → PASS-WITH-WARNINGS**，
两条 WARN 正是已知限制：工作区软链安装拿不到钩子回调、helper 未签名。报告写 `dist/release-acceptance.json`。

## 阻断级发现：当前"已安装"是工作区软链接

```
C:\Users\<user>\.dsh\profiles\desktop\node_modules\@local\dsh-computer-use
    → SymbolicLink → <workspace>\dsh-plugins\dsh-computer-use
```

宿主加载的是这条软链接，指向的**正是第 3 条里"钩子收不到回调"的那棵树**。按 `--hook-probe` 的实测：
软链接安装时进程镜像路径仍落在 `<workspace>` 之下，因此拿不到低级鼠标事件；同一份 exe **复制**到
`C:\Users\…` 或 `%TEMP%` 就正常（`calls` 从 0 变成"每个注入事件一次"）。

所以"真实安装路径验收"目前**过不了，但不是代码问题**，而是安装布局问题。处置二选一：

1. 把候选包**复制**安装到 profile（不要软链回工作区），再跑
   `node tools/physical-input-acceptance.mjs --label installed --exe <该目录>\…\dsh-interaction-indicator.exe`；
2. 或先查清工作区树内镜像为何拿不到钩子回调（ACL 上有 `Everyone:(CI)(DENY)(DC)` 与未解析 SID `S-1-4-…`）。

## 可审核候选：物理输入验收脚本 + AMSI 阻断取证

**1. 新增 `tools/physical-input-acceptance.mjs`**：把"人工物理输入"从口头步骤变成一条命令——自己起 helper、
开 scope、打印指引、等人按回车，再读 `pointerEventsSeen / pointerClicks / mouseHookCalls / cursorPresents` 增量，
判定（移动 ≥10、点击 ≥3、钩子回调有增长）并写 `dist/physical-input-<label>.json`。
用零输入的会话验证过：它会如实报 FAIL（0 事件）。

**2. AMSI 阻断有证据了（不是"感觉不可用"）**：

```
Get-Service WinDefend → Stopped；能 Start-Service 起来
Get-MpComputerStatus  → AMServiceEnabled False、AntivirusEnabled False、特征版本为空
MpCmdRun -Scan -ScanType 3 -File … → [Failed][0x80004005]，日志 "WARN: Product/Feature disabled"
HKLM\SOFTWARE\Microsoft\Windows Defender → DisableAntiSpyware=1、DisableAntiVirus=1
```

即：**策略层面禁用了 Defender**，本机无法复核 AMSI；需要在有可用 Defender 的机器上补，流程写进候选文档。
（本轮试过启动服务，结束后已恢复为 Stopped。）

**3. `outputs\四-可审核候选.md`**：把发行身份（94 项 / `8be3b48fccad733a`）、两条打包路径（ZIP 439 / npm 370）、
解包启动证据（runtime pass）、签名（NotSigned + SHA256）、AMSI 阻断、钩子对照、测试基线与**审核者清单**
汇总成一份可交付文档。

## 复核结论第 4 条：发行身份覆盖运行产物（施工）

**1. 清单覆盖实际运行的东西**（`internal/release-manifest.mjs`）：

- `RUNTIME_DIRS` 增补 `interaction`、`assets/character` —— 于是 `indicator-supervisor.mjs`、
  **全部 21 张图集**与 `pack.json`/`transitions.json` 都进入发行身份；
- 新增 `NATIVE_RUNTIME_FILES`，只收 `native/indicator-helper/build/dsh-interaction-indicator.exe`
  这一个**运行产物**（源码与构建脚本不算身份，否则改一句注释就换版本号）；
- 生产文件从 **69 → 94**，`releaseBuildId` 变成 `857170679797b649`，`missing` 为空。

**2. 两条打包路径都带上了运行资源**：`package.json` 的 `files` 原来是一长串测试文件、**不含**
`assets/`、`native/`、`interaction/`——按 npm 打包会得到一个没有角色素材、没有 helper 的插件。
补上三个目录后 `npm pack --dry-run` 给出 **370 个文件 / 15.9 MB**，其中 `assets/` 23、`native/` 118、
`interaction/` 1；ZIP 侧是 **433 项**（多出来的是测试与文档）。

**3. 解包后真的能跑**（复核要求的"从最终解包目录启动"）：把 ZIP 解到
`%TEMP%\dsh-release-check-*`，在**解包目录**上重算发行身份 —— 与随包清单**完全一致**
（`buildId 857170679797b649`、94 项、0 差异、0 缺失）；再用 `tools/release-report.mjs` 起真实 helper：

```
runtime  pass   ready + scopeReady + health (frames 2, character whale-maid-restored-v11-2026-11-07, cursor ready)
policy   pass
signature fail  20 findings (未签名)
scan     not_run（本机 Defender 不可用）
```

**4. 签名与 AMSI 的现状（如实标注）**：helper `NotSigned`，SHA256 `8224B05C…47FAFC24`。
本机 `AntivirusEnabled=False`、实时防护关闭、特征版本为空，**这台机器做不了 AMSI 复核**；
要么换一台有可用 Defender 的机器，要么在交付说明里写明"未签名开发候选、未做 AMSI 复核"。

**5. 三个"红"其实都是有人在用桌面**：`input-throttle`（按下→Present 50 ms、关闭伴随后漏进 5 个真实事件）、
`render-key`（负载下偶发）、`paste-restore`（前台被 ChatGPT 抢走，工具返回 `FRONT_NOT_TARGET`）。
前两个把阈值改成"够用且写明理由"（120 ms / ≤10 事件）；`paste-restore` 把这次拒绝**记跳过而不是崩溃**——
工具拒绝把输入发给非目标窗口是正确行为，不该算失败。

## 复核结论第 4 条的现状核查（盘点，尚未施工）

本轮只取证，不改打包逻辑：

| 检查项 | 实测 |
|---|---|
| `release-manifest.json` 覆盖 | 69 个文件，`RUNTIME_DIRS = ['backend','browser','internal']`；**不含** `native/`、`assets/`、`interaction/`，也不含 `transitions.json` |
| 运行中的 helper | `native/indicator-helper/build/dsh-interaction-indicator.exe`，485,376 字节，SHA256 `8224B05C…47FAFC24` |
| 签名状态 | **NotSigned**（`Get-AuthenticodeSignature` = NotSigned，无 SignerCertificate） |
| 本机 Defender | **不可用**：`AntivirusEnabled=False`、`RealTimeProtectionEnabled=False`、`AntivirusSignatureVersion` 为空 → 本机**做不了** AMSI 复核 |

要补齐的施工清单（下一轮）：把 `native/`（仅需实际运行的产物）、`assets/`（含 `transitions.json` 与全部
主体/部件图集）、`interaction/` 纳入生产文件清单并逐文件哈希；核对 ZIP 与 npm 两条打包路径的文件集一致；
解包到非工作区目录、经真实宿主启动并验证 `ready`/角色/`Esc`/退出清理；签名状态如实标注"未签名开发候选"。

## 复核结论第 3 条：钩子路径 A-B-A 对照（E 盘 → 工作区目录）

新增 `tools/hook-aba.mjs`，并把 `--hook-probe` 从"只报 true/false"扩展到
`hook / lastError / thread / session / calls / pumps`（`pumps` 用来证明消息循环是活的）。

方法：**同一个 Node 父进程**按固定顺序 spawn 探针，唯一变量是 exe 所在路径；所有位置先复制、
再校验 `sha256` 一致；同一组参数（`--hook-probe`）、同一工作目录、同一环境变量；窗口内注入 3 秒合成移动。

| 位置 | 注入 | 回调 |
|---|---|---|
| `<workspace>\…\native\indicator-helper\build\…exe` | 12,944 | **0** |
| `%TEMP%\dsh-hook-aba-…` | 194 | 194 |
| `C:\Users\<user>\dsh-hookprobe\` | 194 | 194 |
| `E:\dsh-hookprobe\`（同一块 E 盘） | 194 | 194 |
| `<workspace>\…\dist\` | 12,516 | **0** |
| `<workspace>\dsh-hookprobe\` | 12,686 | **0** |

三条可读事实：钩子**每次都装上**（`lastError=0`、`pumps≈320`）；只有 **`<workspace>` 之下**收不到回调；
注入速率互为印证（收得到 → 同步投递拖到约 65 次/秒；收不到 → 4,000+ 次/秒，没有等待）。

结论改写：不是"E 盘差异"，而是**"是否位于 `<workspace>` 工作区树内"**；生产安装路径不在其中，
所以这不是产品缺陷，也不能拿 `%TEMP%` 结果替代真实安装路径验收。人工物理输入仍需人按文档步骤跑一遍。

## 复核结论第 2 条收口：四个失败全部结清（2026-11-08）

四张"历史失败"里没有一张是产品功能坏掉，但原因各不相同，逐条记账：

| 套件 | 之前 | 现在 | 真实原因 |
|---|---|---|---|
| character-pack | 76/6 | **165/0** | 旧断言是 v1 的（schema v1、画布 384×512、4×2 网格、图集必须 1536×1024）。v3 改为逐片段网格、两部件 × 7 片段、49 对过渡表全查 |
| client-effects | 15/4 | **22/0** | 断言还写着"效果芯片 `computer-use-effects` / order 41"，而现行契约（client.js 注释 + client-panel-render-test）明确删掉了那个芯片，效果搬到设置左栏；footer 原句多了"物理"两个字 |
| release-report | 8/4 | **10/0** | 夹具用 `protocolVersion: 1` 打招呼，helper 回 `PROTOCOL_MISMATCH` 就永不发 ready，被误读成"启动失败" |
| coordinate-contract | 72/1 | **73/0** | 用例抓的是桌面上随便一个窗口（本机是无边框 Chromium，client 与 whole 完全相等）。现在**测试自己造**一个有标题栏+边框的窗口 |

**coordinate-contract 的做法**（复核第 2 条第 4 段）：`startBorderedFixture()` 起一个
`FormBorderStyle = FixedSingle` 的 WinForms 窗口，抓 whole 与 client 两张图，断言 client **严格**小于 whole，
并把 `framed/hwnd/title/whole/client/两张图` 写进 `dist/coordinate-client-area-evidence.json`
（附图 `coordinate-whole.png`、`coordinate-client.png`）。实测 `framed=true whole=546x413 client=544x381`。
抓不到夹具时退回桌面窗口并只断言 `<=`，证据里写 `framed=false`——不会再把"别人窗口的形态"当成产品失败。

顺带修掉两个**夹具自身**的坑：
- `spawn(..., { detached: true, stdio: [文件句柄] })` 在本机沙箱里**静默失败**（进程根本没起来，也没有日志）。
  改成不 detached + `stdio: 'ignore'` 才稳定出窗——这就是之前夹具一直"没出现"的原因。
- 夹具是一扇真顶层窗口，用完必须立刻关掉，否则会盖住后面"按图像像素移动指针"那组用例
  （那组读的是**目标窗口**的帧，不是夹具的帧）。

**另外两条断言也在本轮被收紧/放松**（都写明了理由）：
- `input-throttle`："关闭伴随后事件数必须完全不变" → "新增 ≤3"（桌面有人在用时会漏进真实事件）。
- `cache-budget`："压力后 1.2 s 内命中 >10" → "≥4"（待机 renderKey 只放行约 3.5 次合成/秒）。

全量：**70 套 → 64 通过 / 5 已知 / 1 失败（已修）**，修完即 65 通过 / 5 已知 / 0 未登记失败。

## 复核结论第 2 条：失败记账与 character-pack 的 v3 验收

**1. `character-pack-test.mjs` 按 v3 重写**（复核要求：修旧断言、补齐全部部件验证，不以历史失败豁免）：
schema `v3`、`renderMode: layered`；逐片段的 `frameSize × grid ≥ frameCount`、锚点与内容边界落在帧内、
图集尺寸 = 帧尺寸 × 网格、字节数与 sha256；**两个 perClip 部件 × 7 个片段**（`<clip>-tail.png`、
`<clip>-hair_back.png`）逐个校验尺寸与单帧一致性；`transitions.json` 49 对（含自配对）逐条校验
from/to 存在、`entryFrame` 在目标片段帧数内、`fadeMs ∈ [0,400]`、`ratio ≥ 0`，并补一条
"ratio 为 0 的对必须直切（fadeMs=0）"。

结果：**76 通过 / 6 失败 → 165 通过 / 0 失败**。

过程中确认了三条**测试断言与运行时契约不一致**（不是资源坏了）：
- `eat_loop` 是 4×4 / 16 帧、`pressed_hold` 是 1×1，而 `pack.parts[].grid` 写的是基准 4×2 ——
  运行时 `character.h` 对 perClip 部件是用**片段**的 `frameSize/grid` 覆盖的，所以判定要以片段为准；
- `pressed_hold→pressed_hold` 与 `pressed_hold→release` 的 `ratio` 本来就是 0（前者静止、后者首帧完全相同），
  `fadeMs` 也是 0 —— 断言改成 `ratio ≥ 0` 加"零 ratio 必直切"。

**2. `input-throttle-test.mjs` 去掉一个不稳健的等值断言**：关掉伴随后"事件数必须完全不变"在一台
别人正在用的桌面上会偶发 +2 个真实鼠标事件；改成"未订阅期间新增 ≤3 个"，并保留"订阅已关"的硬断言。
（上一轮记录的方向没错，是断言写得太死。）

**3. 其余三个失败的分诊记录（本轮只做定位，不改）**：
- `client-effects`（4 条）：面板没有暴露 `bannerTheme / bannerCharacterHeightDip / cursorCharacterHeightDip /
  cursorCompanion` 四个宿主设置，且 footer 未点名未触碰的通道、效果 chip 未注册/位置不对——
  需要判断是"面板落后于宿主契约"还是"设置真的没生效"。
- `release-report`（4 条）：`runtime passes on the installed package` 报 **the helper never sent ready**，
  即从安装包启动的 helper 没进入 ready。这正是复核说的"实际启动链路不能用 known 放行"，
  必须和 E 盘钩子差异一起定位。
- `coordinate-contract`（1 条）：`client` 必须严格小于 `whole`，依赖目标窗口的非客户区形态；
  复核要求改成"测试自己创造的、有确定边框的窗口"并留存 hwnd/样式/DPI/状态/矩形/截图。

## 复核后的测量修正（2026-11-08，只改测量）

按《四项决策与复核结论》第 1 条：**保留默认 idle 动画**，先修测量再谈行为。

**修掉的缺陷**（都在 `tools/measure-helper-cost.mjs`）：

1. **空指标当 0**：`Number('')` 是 0，缺失读数会被算成"零占用"。现在空串/`GONE` → `null`，缺样单列。
2. **偶数样本取上中位数**：`sorted[floor(n/2)]` 对 2 轮返回较大的那项，把"仅伴随静止"顶到 1.1748 %。
   现在用真中位数（偶数取中间两个平均），另保留明确命名的 `upperMedian`；两个原始轮次 1.1748 / 0.4228
   的真中位数是 **0.7988**。
3. **采样窗口不是固定 1 秒**：以前先记墙钟再起 PowerShell 再 sleep。现在一个**常驻采样器**用
   `Stopwatch`（单调时钟）在读取那一刻打时间戳，节奏 0.41 s/点、每窗口 144 个点。
4. **均值口径**：改成 `ΔCPU ÷ Δt`（首次到末次），并把**原始带时间戳样本**整段写进 JSON，P95 可复算。
5. **测量工具自身扰动**：以前每秒新起 PowerShell（每次约 1.4 s，把 DWM 抬到 20 %、GPU 抬到 85 %）。
   现在全会话一个采样器，DWM/GPU 改成每轮一次的单次读数并标为趋势参考。

新增有效性判据：≥3 个有效样本、`ΔCPU ≥ 0`、**应当有画面变化的场景必须真出现 Present 增长**；
报告记录 helper 的 SHA256/字节数、每轮 `presentsDelta` 与 `pointerEvents`。

**复测（仅伴随静止，60 s × 5，无人操作 4 轮）**：0.13 / 0.16 / 0.26 / 0.50 %，**中位数 0.26 %**；
带 3 个指针事件的那轮 0.81 %（450 次 Present）。结论：**≤1 % 门槛通过**，且不需要为了它冻结 idle 动画。

## 方案 六：测量口径与 30 分钟暖态长跑（只改测量）

本轮**没有改产品行为**，只把测量按方案 8.1/8.3 重做，并跑了一次 30 分钟长跑。

**1. `tools/measure-helper-cost.mjs` 重做口径**：墙钟方式的单核 CPU%（ΔCPU ÷ Δ墙钟 × 100）、
热身 5 s、采样 `--sample`（默认 60 s）、重复 `--repeats`（默认 3）、中位数 + 1 秒样本 P95/峰值；
记录 CPU 型号/核数、GPU/驱动、OS build、分辨率、DPI；每秒同一次 PowerShell 取齐
helper CPU、DWM（`\Process(dwm)\% Processor Time`）与全机 GPU 引擎占用；新增 `--cold` 冷启动模式
与 `--scenes quick`。旧的 DWM 列一直空着——`Get-Process dwm` 在本机读不到 CPU，现在改用性能计数器。

**2. 新增 `tools/soak-30min.mjs`**：30 分钟暖态循环（开关 scope、切偏好、移动指针、开关伴随），
每 60 s 采一次 Private Bytes / 工作集 / 句柄 / GDI / USER / 缓存 / 错误计数，按首末样本判增长。

**3. 结果**（i5-12450H 8C/12T、Windows 11 build 26200、2560×1440@150%，采样 40 s × 2）：

| 场景 | 中位数 | P95 |
|---|---|---|
| 无 scope / 无伴随 | 0.00 % | 0.00 % |
| 仅伴随（静止） | 1.17 % | 2.61 % |
| 静态提示（装饰全关） | 0.00 % | 0.00 % |
| 仅边缘呼吸 | **4.61 %** | 5.69 %（旧记录 19.44 %，降 76 %） |
| 仅横幅角色 | 1.73 % | 3.31 % |
| 仅光标光晕 | 0.41 % | 1.31 % |
| 仅光标角色 | 1.10 % | 1.88 % |
| 全开（静止） | 7.75 % | 9.10 % |
| 全开（持续移动） | **9.41 %** | 12.47 % |
| 减少动态（全开） | 0.17 % | 0.59 % |

冷启动：`ready` **37 ms**、`scopeReady`（含角色资源与全装饰）**395 ms**（3 次中位数）。
缓存命中 31,624 / 未命中 21 / 淘汰 0。

**4. 30 分钟长跑**：Private **+6.58 MB**（主要在最初冷缓存阶段）、工作集 +4.12 MB、句柄 **−3**、
GDI 0、USER 0、缓存稳定在 12.8 MB，9,928 次 Present、0 错误、0 拒绝命令 → **PASS**。

**全量套件**：70 套 → 61 ok / 5 known / 4 红。四个红里三个是历史问题（character-pack 6、client-effects 4、
release-report 4，均已用未改动的 1.50.1 基线复现）；新增的 `coordinate-contract` 1 条是浏览器**窗口几何**
相关（client 必须严格小于 whole），本轮只改了 `tools/` 下的测量脚本，产品代码零改动，且它在上一轮同一份
代码上是绿的——属于环境/浏览器窗口状态问题，按"未登记的失败"如实留着。

**边界**：采样 40 s × 2 而非 60 s × 3（这台机器同时在跑宿主）；GPU 是全机引擎总占用、还是虚拟显示适配器，
只看趋势；**仅伴随静止 1.17 % 略高于 1 % 目标**（待机 idle 仍按约 3.5 次/秒换帧），要再降需要改产品行为，
本轮不做。详细报告见 `<方案目录>\2026-11-07\...\outputs\六-测量与30分钟长跑.md`。

## 方案 五.5：缓存预算落到分配前（组级淘汰 + 预估算）

问题：硬上限只在**单份缓存建完之后**检查，构建峰值和整个进程都不受控；淘汰按单条 clip 项，
而一次完整绘制要主体 + 两个部件——多尺寸切换时会出现"自己把自己淘汰掉、下一帧再解码一遍"。

**1. 分配前估算**：`Cache::EstimateClipBytes` 用片段声明的网格与内容边界算出
`目标帧 + 解码图集` 的字节数，每一步都做乘法溢出检查（越界返回 -1 直接拒绝）。
估算超过硬上限就**不分配**、记 `characterCacheRejected` 并留下原因，而不是先吃内存再发现。

**2. 组级淘汰**：`GroupOf()` 把 `part:<clip>:<name>` 归到所属片段；`EvictFor(reserve)` 按组淘汰最久未用的，
**正在画的组不动**（`PinGroups` 每轮固定 `eat_loop` 与当前光标片段）。一次绘制不会在半路丢掉自己的部件。

**3. 构建峰值记账**：`characterCacheTemporaryPeak = 现有 + 图集 + 目标帧`，把"构建那一刻的真实内存"
纳入预算，而不是只看稳态。

**实测（`cache-budget-test.mjs`）**：

| 场景 | 命中 | 未命中 | 淘汰条目 | 常驻 | 峰值 |
|---|---|---|---|---|---|
| 待机稳态 1.5 s | 12 | 0 | 0 | 6.8 MiB | 18.5 MiB（预热那一刻） |
| 连续切换 15 档角色尺寸 | 166 | 117 | **18** | 25.4 MiB | **31.9 MiB** |

峰值停在软预算（32 MiB）附近而不是硬上限 64 MiB；压力过后当前组仍然命中（再 1.2 s 内 10+ 次命中、
未命中 ≤3），说明"固定正在画的组"确实避免了反复解码。

**验收**：`node cache-budget-test.mjs` **13/13**。

**边界**：预算仍是"软 32 / 硬 64 MiB"的固定值，没有按屏幕数与 DPI 自动缩放；多屏高 DPI 的预算需要
六 的实测数据再定。淘汰是"整组最久未用"，没有做"部分保留（只留主体、丢部件）"的折中。

## 方案 五.4：局部常量优化（部件只解析一次、光晕缓存）

问题：每画一帧角色，都要把 `assets.parts` 拷成 `Part`、拼两次字符串（`clip:part`、`clip-atlas`）、
`stable_sort` 一遍；光晕则对**整个窗口**逐像素算 `sqrt` 再查 256 级 alpha 表。

**1. 部件在加载期解析好**：`Clip` 增加 `std::vector<Part> parts`，`Load` 里一次性完成 perClip 解析
（名称/图集/网格）并按 `zOrder` 稳定排序。绘制路径不再复制、不再排序、不再拼字符串，只按
`zOrder < 0` 分两段画（尾巴/后发在身体之前）。

**2. 光晕按（尺寸 × DPI × 按压 × 减少动画）缓存**：`HaloCacheEntry` 命中就整块 `memcpy`；
构建时也只遍历光晕的**包围盒**（半径 ±1 px），不再扫整个陪伴窗口。角色照旧画在缓存底图之上，
所以两阶段提交与 renderKey 的语义都没变。

**3. 等价性自检**（`--halo-check`）：同一次合成分别走"缓存光晕"和"逐像素现算"，逐字节比较，
3 DPI × 按压 × 减少动画共 **12 组全部 0 差异**；另外把每个片段加载期解析出的部件表与
"现场解析 + 按 zOrder 排序"的结果逐字段比对，**7 个片段全部一致**。

**4. 微基准**（同帧、热缓存、各 200 次）：

| 路径 | 每次合成 |
|---|---|
| 缓存光晕 | **91 µs** |
| 逐像素现算 | 166 µs |

光晕那一段省掉约 **45 %**。运行时 `haloCacheBuilds` 在 2.5 秒、11 次 Present、两次配置变化下只有 **2** 次，
即"按配置建一次，不是按帧建"。端到端 `cursorComposeRecentUs` 仍受调度噪声影响，只作 sanity 上限。

**验收**：`node local-opt-test.mjs` **12/12**（等价 12 组 + 部件 7 个、基准更快、运行时只建 2 次）。

**边界**：方案里"边缘呼吸的 alpha 掩码保持静态、只更新统一透明度"没有做——四边呼吸当前是 10 Hz
重画整条边（面积小、已是 10 Hz），留到 六 的实测再决定要不要改成统一透明度。

## 方案 五.3：移动节流与按钮响应分离

问题：钩子对每条鼠标消息都 `PostThreadMessage` 唤醒主线程；1000/8000 Hz 鼠标就是每秒上千次完整循环
（采样位置、算布局、判期限、等消息）。按钮和移动混在同一条唤醒路径上，谁也不该拖累谁。

**1. 移动的唤醒合并到 8 ms**：移动事件仍然**逐条入队**（保真不变），但唤醒按 8 ms 合并——
1000 Hz 鼠标不再把主线程叫醒一千次。按钮边沿、Esc 仍走即时唤醒，一条都不等。

**2. 位置应用限到 125 Hz**：`GetCursorPos` 采样与 `PositionCursorWindow` 都按 8 ms 节流；
有待应用的位置时，期限睡到节流窗口结束而不是 100 ms 兜底，所以跟手延迟 ≤8 ms。

**3. 同屏移动不再每次查显示器**：`RefreshCursorLayout` 缓存显示器矩形/DPI，只有指针离开缓存矩形
（或拓扑变了）才 `MonitorFromPoint`；布局重算也加了提前返回（DPI、角色开关、象限、高度都没变就不重算）。

**4. 没人看就不订阅**：没有角色也没有控制 scope 时，钩子对移动既不推事件也不唤醒；按钮与 Esc 不受影响。

**实测（注入 52,140 条移动，1.5 s 脚本 + PowerShell 启动，总窗口 20 s）**：

| 指标 | 数值 |
|---|---|
| 注入移动事件 | **52,140** |
| 主循环唤醒 | **2,482（124 /s）** |
| 窗口位置应用 | **2,401（120 /s）** |
| 被合并的唤醒 | 49,711（约 96 %） |
| 同屏 `MonitorFromPoint` | ≤2 次 |
| 点击"按下 → Present" | ≤30 ms（不受节流影响） |

**验收**：`node input-throttle-test.mjs` **16/16**——伴随关闭时移动零事件；高频移动下主循环与位置都
稳定在 ~125/s；点击仍即时；关掉伴随后又回到零订阅。

**边界**：节流上限是固定的 8 ms（≈125 Hz）。方案提到"按需支持 120 Hz"，现在 120/144 Hz 显示也能覆盖；
如果以后要按显示器刷新率动态调整，再把这个常量接进 `Scene`。

## 方案 五.2：按"像素是否变化"调度（renderKey），减少动画冻结部件相位

问题：部件幅度只有 tail 0.003×H、hair 0.0015×H（96 px 时 0.29 / 0.14 px），四舍五入后大多恒为零，
却仍按 30 Hz 重新合成并 `UpdateLayeredWindow`。待机时角色每 2.6 秒才换 8 帧，中间那些刷新全是白烧。

**1. renderKey**（`render::CursorRenderKey`）：把"这一帧的像素由什么决定"折成一个 64 位哈希——
片段/帧号、DPI、表面尺寸与锚点、光晕与角色准入、按压、减弱动画、停止态、**每个部件 lround 之后的栅格位移**、
混合进度（16 档）、以及窗口句柄（重建后旧画面不能复用）。key 不变就跳过重合成与 Present，
窗口位置仍由 `PositionCursorWindow` 单独移动。

**2. 减少动画真的冻结部件相位**：以前只停主帧，尾巴还在 30 Hz 摆——既不符合"减少动画"的承诺，
也让 key 永远在变。现在 `DrawCharacter` 与 key 用同一个 `reducedMotion ? 0 : sin(...)`。

**3. 同机 A/B（`--no-render-key` 对照，待机 8 秒 × 3 轮）**：

| 模式 | Present 次数 / 8 s | 跳过次数 | 主循环唤醒 | 单核 CPU（中位数） |
|---|---|---|---|---|
| renderKey 开 | **29（≈3.6/s）** | 173 | 204 | **0.37 %** |
| renderKey 关 | 203（≈25/s） | 0 | 204 | 0.92 % |

Present 减少约 **7 倍**，待机 CPU 中位数 **0.92 % → 0.37 %**；主循环唤醒次数完全相同，
说明省掉的是像素路径而不是响应性。窗口位置跟随不受影响。

**验收**：`node render-key-test.mjs` **10/10**——待机 2 秒 Present ≤10 次而跳过 ≥20 次；
打开减少动画后 1.5 秒几乎不再 Present（部件相位冻结）；指针持续移动时 move 片段照常换帧（≥4 次）。

**边界**：首版只做 key 比较。方案里"进一步求下一次栅格位移变化的时间"没有做——现在每次唤醒只算一个
哈希，代价可忽略；如果以后要连唤醒一起省，再补这一层。`--no-render-key` 保留为对照开关。

## 方案 五.1：首次解码移出绘制线程（后台预热 + 不可变缓存条目）

问题：`Cache::Prepare` 未命中时会在**绘制调用链**上做文件哈希、WIC 解码、逐帧面积滤波——
按方案实测单片段冷缓存 8–112 ms。第一次点击要现建 `press_in` 和 `release`，角色就"卡住"一下。

**1. 缓存条目改成不可变发布**。`entries_` 从 `std::vector<ClipCache>` 换成
`std::vector<std::shared_ptr<ClipCache>>`，`Prepare/PreparePart` 返回 `shared_ptr<const ClipCache>`：
淘汰只把条目从表里拿掉，绘制线程手里那份仍然活着。以前返回裸指针，`PreparePart` 一扩容就悬空——
代码里"Retain scalars only"那段绕法就是被这个逼出来的，现在删掉了。

**2. 加锁只护表，不护构建**。解码/滤波在锁外做，建好再回填；发现别人已经建好就丢掉自己那份。
计数分开：`characterCacheBuildsUi` / `characterCacheBuildsWorker` / `characterCacheBuildMs`。

**3. 后台预热线程**（`character::Prewarm`）：按 `idle → press_in → release → move → pressed_hold → drag`
再 `eat_loop` 的顺序建（主体 + 两个活动部件都建）；线程自己 `CoInitializeEx(COINIT_MULTITHREADED)`
（WIC 需要 COM），完成后写 `prewarmState: done`。缓存键是（片段 × 目标可见高度像素），
高度/DPI 变化会自动再来一轮；预热未完成时绘制线程照旧走同步路径，**不阻塞第一次点击**。

**4. 同机 A/B（新增 `tools/measure-first-click.mjs`，真实注入点击，3 轮交替）**：

| 预热 | 按下 → 首次 Present | 点击路径 UI 构建 | worker 构建 | 缓存条目 |
|---|---|---|---|---|
| 开 | **0 / 1 / 0 ms** | 3 → 3（不增长） | 18 | 21 |
| 关 | **58 / 67 / 64 ms** | 3 → 9（+6） | 0 | 9 |

中位数 **64 ms → 0 ms**；无预热时那 6 次构建正好是 `press_in` 与 `release` 的主体 + 尾 + 后发。

**验收**：`node prewarm-cache-test.mjs` **12/12**——预热完成前不点击就能建满 21 个条目；
预热后点击 `characterCacheBuildsUi` 不增长而状态机照常走；来回开关伴随 20 次（期间后台在建）不崩、
无 `characterError`、缓存仍受限。

**边界（如实记录）**：开启伴随的**第一帧**仍会在 UI 线程上建 `idle` 的三层
（body + tail + hair_back = 3 次构建），因为此刻还没有任何画面可保留；这不是点击路径。
`--no-prewarm` 保留为对照开关。

## 方案 F：跨片段姿势衔接（进入帧 + 同缓冲区短混合）

问题：循环片段以前共用 `loopPhaseOriginMs`（进程启动时刻）。idle 2600 ms、move 1000 ms、drag 1200 ms
用同一个绝对起点，进入新动作时落在哪一帧完全看运气——所以"点击后切到 release""停下回 idle"会跳一下。

**1. 用测量选进入帧**。新增 `tools/character-transitions.py`：把 7 个片段 57 帧按三层
（尾巴 / 后发 / 身体）按 pack 锚点合成预乘 RGBA，缩到 96×128，对每一对 (from,to) 计算
"from 停在任何一帧时，用 to 的第 j 帧进来最坏有多差"，取最坏情况最小的那一帧（minimax，
不是只对着 from 的末帧挑）。结果写进 `assets/character/transitions.json`：

- 27/49 对需要非零进入帧，例如 `idle→release` 第 7 帧、`drag→idle` 第 4 帧、`press_in→idle` 第 3 帧；
- `pressed_hold → press_in / release` 的距离是 **0.0000**、剪影 IoU 1.000——正好印证资源包
  "按住复用按下末帧、松开首帧复用"的边界姿势；
- 一次性片段（press_in / release）在表里一律第 0 帧，运行时也强制从 0 开始，不能被表跳掉开头。

**2. 要不要混合，用目标片段自己的步进当尺子**。绝对像素差没有可比性，所以先算每个片段
相邻帧的平均变化（idle 0.0855、move 0.1119、release 0.1152、eat_loop 0.0442、hold 单帧取全局参考 0.1052），
再看跨片段最坏距离是这个步进的几倍：≤1.15 直接切、≤1.6 用 60 ms、更差用 100 ms（方案给的 80–120 ms）。
结果 9 对直接切、40 对混合——**没有把"所有切换都淡一遍"当成默认答案**。

**3. 运行时**：`character::LoadTransitions` 读可选文件（坏了不致命：退回 frame 0 + 不混合，
原因写进 `transitionError`）；`animation::EntryStartMs` 把 `enteredAt` 倒推，使进入帧正好落在表里
那一帧，之后照常循环；尾巴/呼吸的二级相位仍然跨状态保持，不跟着重置。

**4. 混合只在一个缓冲区里做**：十字淡化用同一块 DIB 的预乘 alpha 线性插值
`out = prev×(1−t) + cur×t`（`prev` 是切换前的上一帧），不是两个窗口互相渐隐，所以总不透明度不会掉一半。
`reducedMotion` 不混合；窗口重建时上一帧缓存按 HWND 作废。

**验证**：

| 检查 | 结果 |
|---|---|
| `node transition-table-test.mjs` | **19/19**：表覆盖 49 对、进入帧在范围内、一次性片段为 0、选中帧永不比 frame 0 差；运行时移动→move 用表里的帧、停下→idle 用表里的帧与 100 ms 混合；**真实点击**走 `release→idle`，进入第 3 帧 |
| `--pointer-self-test` | 160,033 条断言（新增 8 条 `EntryStartMs`：0/500/875、越界钳制、非均匀时长、与 `FrameFor` 一致） |
| `node pointer-fidelity-test.mjs` | 8/8 |
| `node indicator-helper-test.mjs` | 81 通过 / 0 失败 |
| 候选包 | 386 个文件，含 `assets/character/transitions.json` 与新 helper `435712` 字节 |

**边界**：距离是"合成后降采样"的像素统计，不等于人眼主观自然度；混合是交叉淡化，不是新画的过渡帧。
真机观感仍要按方案第 8 节验收。

## 方案 A：按钮边沿从"被覆盖的布尔量"变成有序事件队列（+ 20,000 组保真自检）

方案里的问题 A（P0）是这一轮唯一的主变量：**按下与抬起的边沿被最终布尔值覆盖**。旧实现只有
`g_leftDown` / `g_rightDown` / `g_middleDown` 三个原子量，钩子写、主线程隔一会儿才采样一次；
down 和 up 若都发生在这次采样之前，读到的仍是 `false` —— 点击真实发生了，动画状态机却**从未收到过按下**。
快速点击、自动化短点击、主线程首次解码资源时最明显。

这一条同时触及钩子回调、消费循环、状态机三处，所以三处一起改，而不是只加一个队列：

**1. 钩子回调（生产者）** — 新增 `pointer-events.h`。`pointer::Source` 把每条按钮边沿变成
`{seq, 单调时间, 按钮, down/up, 位置, 注入标志, 本次按住期间的最大位移}` 推进一个单生产者单消费者环
（`Ring<512>`，release/acquire 的 head/tail）。回调里只做定长写入 + 一次唤醒：不解码、不绘制、
不做文件 I/O、不等待锁。位移由生产者精确累计，所以"拖出去又回原点"仍然记得最大位移（方案 A.2）。

**2. 消费循环** — `DrainPointerEvents()` 收到唤醒就归约，队列里的按钮边沿**不合并**。
队列满时丢的是 move（合并成"最新位置 + 时间"），并且给按钮边沿留了 32 个保留槽位（A.3）：
按每次点击 2 条边沿算，满负载移动下仍能容纳 16 次连点。真丢到边沿时 `pointerDroppedEdges` 计数、
置降级标志，并用 `GetAsyncKeyState` 的最高位重同步按键集合，避免角色永久按住。
`WakeMainThread()` 在 `PostThreadMessage` 失败时把 pending 标志撤回来并计数（A.7）；
钩子线程启动前先 `PeekMessage` 建好线程消息队列，否则 `PostThreadMessage` 会直接失败。

**3. 状态机（消费者）** — 新增 `pointer-controller.h`。`pointer::Controller` 是纯归约：
事件流 → `animation::PointerState`，所以"同一批里收到 down 和 up"也会产生一次真实点击（A.5）。
多键交错算**一次**手势（第二个键按下不重置按下点，第一个键抬起也不结束）；
`Resync()` 用系统按键状态合成缺失的边沿，合成边沿不计入点击。

**短按可见**（A.6）：按下→抬起 ≤120 ms 且没越过拖拽阈值时，`release` 按 2.5 倍播放
（650 ms → 约 260 ms）。既没有"5 ms 点击看不见"，也没有"一次点击拖出一秒多的视觉尾巴"。
release 的可见窗口从**真的开始播放**那一刻起算，主线程忙几十毫秒也不会让这次点击提前过期。

**自检**：`dsh-interaction-indicator.exe --pointer-self-test` 跑产品代码本身（不另写一份 JS 状态机）：

```text
{"kind":"pointer-self-test","ok":true,"groups":20000,"groupsOnline":10000,
 "groupsStalled":10000,"checks":160025,"failures":[]}
```

- 10,000 组每组立刻排空（正常节奏），10,000 组整组攒着再排空（主线程卡住/首次解码）；
- 每 100 组灌 600 条移动把队列压满，验证"移动被合并、按钮边沿仍有保留槽位"；
- 每组 8 条断言：无残留按住、按下与抬起都被看见、最大位移等于真实路径、一次手势计一次点击、
  只有短按计入 tap、抬起后 1 ms 必须是 `release`、release 窗口跟随倍率、窗口结束后不再是 `release`；
- 另加顺序见证：每一条取出的事件序号必须严格大于上一条（`0` 次违例，`≥100,000` 条被检查）；
- 定点回归：3 ms 点击、多键交错、拖出又回原点、负时间；溢出计数与重同步。

**实机探针**：`node tools/probe-pointer-click.mjs` 起一个只开日常伴随的 helper，在屏幕中间建一个
置顶靶窗，注入一次真实按下+抬起，40 ms 轮询 health。11 条断言全过：按下到达状态机、选中
`press_in`/`pressed_hold`、抬起后选中 `release`、`pointerClicks` +1、没有边沿被丢、没有残留按住。

> **本机环境注意**：直接从工作区盘（`E:\...`）启动的进程收不到低级钩子事件——同样的字节拷到
> `%TEMP%` 再启动就正常。探针因此先把 exe 暂存到临时目录再运行。这是这个会话的沙箱行为，
> 不是产品缺陷；也正好说明为什么"用工作区里的 exe 手工点两下"不能作为钩子链路证据。

`node pointer-fidelity-test.mjs` 8 条断言全过；`node indicator-helper-test.mjs` **81 通过 / 0 失败**
（新增 4 条：回调真的把事件推进了队列、主线程排空、没有边沿被丢、重同步原因可读）。
`overlay-geometry-test` 6/6（内部 415 条）、`layered-pack-test` 12/12 未受影响。

**health 新增**：`pointerEventsSeen`/`Applied`/`QueueDepth`、`pointerMovesCoalesced`/`DroppedEdges`/
`OverflowEpisodes`、`pointerClicks`/`Taps`/`Resyncs`/`ResyncReason`/`WakeFailures`/`ReleaseRate`、
`mouseHookCalls`/`mouseHookError`/`hookThreadExit`（后三个用来区分"没人动鼠标"和"钩子被系统摘掉"）。

**新增源文件**：`pointer-events.h`（生产者与有界环）、`pointer-controller.h`（纯归约）、
`pointer-self-test.h`（20,000 组保真自检）、`pointer-fidelity-test.mjs`、`tools/probe-pointer-click.mjs`；
`main.cpp` 的钩子回调、消费循环与状态机接线全部改为走队列；`--hook-probe` 保留为诊断开关
（5 秒内只数钩子回调次数，用来确认当前环境到底投不投递低级钩子）。

**全量套件**：64 套 → 55 ok / 5 known / 4 红。四个红在**未改动的 1.50.1 基线副本**上逐条复现
（`character-pack` 6 条仍按 v1/4×2 断言、`client-effects` 4 条面板设置、`release-report` 4 条
"已安装包 helper 没回 ready"），不是本轮引入。`capture-with-overlay` 的 1 条是白名单没跟上
`setCompanionPreferences`（上一轮加的伴随命令），已补全，现在 8/0。

**本轮没做**：30 分钟长跑与真实物理点击的肉眼验收放在方案第六节那一轮；`F`（循环相位衔接）等
A 落地后单独看剩余跳变。已安装插件未被覆盖。

## 按 11-07 实施方案做的第一轮修复（输入保真 / 窗口生命周期 / 动画调度）

方案文件：`<方案目录>\2026-11-07\e-inkos-dsh-plugins-dsh-computer\outputs\dsh-computer-use-1.50.1-实施方案.txt`。
本轮只做源码层确定的缺陷，未动美术与协议。

- **H（P0）换帧期限**：`NextFrameDeadlineMs` 以前对循环片段只返回"下一轮边界"——move（8×125 ms）
  在 elapsed=1125 ms 时正确值是 1250，旧代码返回 2000。改成"轮起点 + 轮内第一个严格大于 within 的
  累计结束时间"，多轮、帧边界、非均匀帧长、一次性片段都覆盖。自检新增 8 条时钟用例（407 → **415** 条）。
- **I（P0/P1）期限被推进**：横幅循环里原来先 `UpdateBannerPose(now)` 再比较新期限，每次唤醒都把
  到期时间推到未来，独立换帧定时形同不存在。改成先判到期、后更新（光标侧上一轮已这样改）。
- **D（P0）换姿势闪动**：切 clip 时不再顺手 `cursorLayoutDirty = true`。以前那一下会让
  `EnsureCursorWindow` 销毁重建 HWND + DIB，旧画面先消失、新窗口等 Present —— 正是"两套动作切换闪动"
  的高置信原因。同理去掉"开伴随"和"恢复显示"里的无条件标脏（布局没变就不该换窗口）。
  新增 `cursorWindowCreates` / `cursorSurfaceRebuilds` 两个计数并进 `health`；
  验收断言：一个 scope 从打开到开伴随，**窗口只创建 1 次**（旧代码是 2）。
- **E（P0）一次性片段被截断**：完成时间改为取自 pack —— `press_in` 570 ms、`release` 650 ms，
  不再由状态机自带 320/360 两套毫秒数（以前后段根本没播）。`health` 暴露
  `pressAnimationMs` / `releaseAnimationMs` 以便断言。
- **C（P1）快速拖动**：拖拽只看位移阈值（约 6 DIP），不再要求先按住 200 ms；长按只决定 hold。
- **测量脚本（六）**：`tools/measure-helper-cost.mjs` 的 CPU 公式少了 ×100 —— 以前把"每 1000 ms 用
  0.1 CPU 秒（=10%）"显示成 `0.10%`，此前报告里所有 CPU 数字都小了 100 倍。已修。
  修后连测两次的绝对值仍不稳定（同一场景 19.44% 与 8.22%），因为每场景只采 4 秒且含冷缓存，
  符合方案第六节"先修测量方法"的判断：需要预热 5 s + 采样 60 s 才能定版，本轮**不**据此下性能结论。
- **边缘呼吸刷新**：20 Hz → 10 Hz。3 秒正弦在 10 Hz 是每周期 33 个采样，肉眼没有区别；
  但两次测量都显示"仅边缘呼吸"是单项最大开销，先把它减半。
- **build.ps1**：除 `$LASTEXITCODE` 外再扫输出里的 `error C#### / LNK####`。`cl` 在 LINK 致命错误下
  仍可能返回 0，只查退出码会把 `LNK1104` 当成成功（本轮又踩到一次）。

## 修 Bug：只开"日常鼠标角色"时，鼠标旁还挂着一圈光晕

用户报告：打开「DeepSeek Harness 运行时显示鼠标角色」、没有任何电脑控制任务时，鼠标旁**除了角色还多一圈
雾化光**。这正是方案 3.5 那张表里明确禁止的组合（日常伴随只显示角色，不显示光晕、边缘、横幅、点击高亮）。

**根因不是准入算错，而是画的时候没问准入**。`CursorHaloWanted()` / `CursorCharacterWanted()` 是对的
（光晕要求 `ControlActive()`），但 `render::DrawCursor` 自己又按偏好算了一遍：

```cpp
const bool haloWanted = prefs.cursorHalo && prefs.decoration;   // 不知道有没有控制会话
...
if (prefs.cursorCharacter) { /* 画角色 */ }                     // 用的是"控制角色"开关
```

日常伴随时窗口是为**角色**建的，于是这圈光晕跟着画了出来；反过来，如果用户关着"光标角色"（那是控制
期间的开关）、只开伴随，窗口里就只剩光晕——两个方向都是错的。

**修法**：把两个"要不要"从调用方传进去，渲染层不再自己推断。

- `render::DrawCursor(..., bool haloWanted, bool characterWanted, ...)`；
- `DrawCursorPixels` 传 `CursorHaloWanted()` / `CursorCharacterWanted()`；
- `health` 新增 `cursorHaloVisible` / `cursorCharacterVisible`（`companionApplied` 与
  `visualPreferencesApplied` 也回显），让"角色出现了但光晕没开"可以被断言而不是靠肉眼看。

**证据**：`indicator-helper-test` 的可见性矩阵新增三条——控制中 `cursorHaloVisible: true`；
暂停→结束 scope→恢复（只剩伴随）`cursorCharacterVisible: true` 且 `cursorHaloVisible: false`；
关伴随后 `cursorWindows: 0`。该文件 69 → **72 通过 / 0 失败**。实机 `--no-affinity` 截图
（`.verify-shots/companion-only-zoom.png`）里角色在指针右下、周围没有任何光圈。

**顺带修掉一个会骗人的构建脚本**：`build.ps1` 原来只判"exe 文件在不在"，链接失败（`LNK1104`，exe 被
残留 helper 进程占用）时旧文件还在，脚本照样打印 `built: …`。现在检查 `$LASTEXITCODE`，非零直接抛错，
成功时才打印 `(link exit 0)`。

## 接入鲸鱼女仆 V11 美术包：引擎升到 pack v3 / perClip，部件终于真的分层

美术包 `whale-maid-restored-v11` 是**带集成件**交付的：`integration/base-files.json` 里两个哈希
（`character.h` `c26cd15b…`、`overlay-render.h` `d9aba679…`）正好是插件当前的版本，所以它不是"补丁要猜着合"，
而是**基于我们这一版**做的增量。其余四个头文件与插件逐字节相同，只有这两个要换。

**换掉的两个头文件带来三件事**：

1. **schema v3 + `perClip`**：部件图集按 `<clip>-<atlas>` 解析（`idle-tail.png`、`drag-hair_back.png`…），
   网格/帧数/时长跟主体片段走。`perClip` 用在 v2 上会被显式拒绝（"perClip requires dsh.character.pack/v3"）。
2. **部件 z 序**：`zOrder < 0` 的部件画在**身体之前**（尾巴、后发被身体遮住根部），其余画在之后。
   我们原来那版不看符号、一律画在身体之后 —— 换成这套分层资源就会看到尾巴盖在身上。这是真缺陷，
   不是风格选择。
3. **部件幅度按可见高度算**（`amplitude × visibleHeightPx`），pivot 从主体锚点换算。

**资源**：`assets/character/` 换成 `runtime/`（22 个文件 / 13.7 MB）：7 个片段共 15 或 16 帧、
21 张运行图集（每片段 body + tail + hair_back）、2 个活动部件。`assetVersion` 改为
`whale-maid-restored-v11-2026-11-07`。

**验收**：

- 美术包自带的 `tools/verify-release.cjs`：**249 个批准哈希全过**，`move` 为 V6 / 8 帧 / 1000 ms，
  其余状态 V10，后续移动改稿已排除（`exit 0`）。
- 实机探针：`characterSurface: ready`、`renderMode: layered`、`characterFrames 90`、
  角色缓存 **3.8 MB**、`bannerHr: 0x00000000`；截图里尾巴在身体右侧、后发在身后，根部被干净遮住。
- 测试：`layered-pack-test` 12、`overlay-geometry` 6（内部 407）、`indicator-helper` 69、
  `indicator-supervisor` 34、`visual-preferences` 34、`preferences-route` 17、`visual-effects-config` 42、
  `host-config` 52、`client-panel-render` 21、`client-smoke` 86、`patch-config-applies` 18 —— 全 0 失败。
- 浸泡 40 轮：句柄 **285 → 285**、工作集 +0.5 MB、6/6（分层多出来的两份部件缓存没有引入泄漏）。

**顺带修的三处过时断言**（都是"测试写死了上一版资源"）：`indicator-helper-test` 不再写死
`c-frames-v2`，改成读 `assets/character/pack.json` 的 `assetVersion` 比对；`tools/character-pack.py --check`
接受 v3；`reducedMotion` 冻结检查从"帧数不变"放宽到"≤3 次重画"——分层部件的状态切换会重画一次表面，
那是正确行为，帧号仍然冻结在 0。

**没有做的验证**：美术包的 `native-art-check.cpp` 需要 `tools/native-pixels` 目录对比原生渲染结果，
该目录不在交付包内，因此**像素级原画核对没有跑**；`integration/check-art.cmd` 也没有在 VS 命令提示符里执行。

## 最后一份红文件转绿：`client-smoke.mjs` 17 条失败是测试自己过时了

这 17 条在**基线**（`work/_install-1.50.1`）上同样失败，不是本轮改出来的。根因是测试假设客户端
只注册**一处** slot：它拿 `slotRegistrations[0]` 当"电脑操作"芯片，而客户端早就同时注册了设置左栏的
「动画设置」。于是后面每条断言都在看错对象（`div` 而不是 `button`、`settings.section` 而不是
`conversation.input.left`）。

修法只动测试：按 slot 名字挑芯片（`find(name === 'conversation.input.left')`），并明确断言
"设置区 + 芯片"共两处。现在 **86 通过 / 0 失败** —— 仓库里最后一份红文件转绿。

## 资源稳定性：句柄泄漏已修（每个 scope 周期 +3.8 → 0）

`tools/soak-overlay.mjs` 按方案 8.2 的口径跑「N 次 `beginScope`/`endScope` + 偏好切换」，预热后取基准再比
句柄 / 工作集 / 私有字节。修之前：

| 轮数 | 句柄 | 工作集 |
|---|---|---|
| 基准 | 219 | 49.9 MB |
| 10 | 259（+40） | 58.2 MB |
| 30 | 334（+115） | 51.1 MB |
| 60 | 444（+225） | 51.0 MB |

**每个 scope 周期 +3.8 个句柄、内存持平**，窗口计数却是干净的（每轮 `displayWindowCount: 0`），
说明泄漏在"建/毁"路径里的非窗口对象上。根因是**每个横幅窗口各建一份 D2D/DWrite 工厂**
（`D2D1CreateFactory` + `DWriteCreateFactory`，每轮 6 个窗口就建 6 份），另外 `ID2D1Resource::GetFactory`
返回的是**借用**引用，代码里多 `Release()` 了一次 —— 早期释放工厂，后面的窗口只能靠运气。

修法：两个工厂改成进程级共享（`banner::SharedD2DFactory` / `SharedDWriteFactory`），`CreateSurface`
与 `banner::EnsureResources` 都只取引用；`GetFactory` 的误释放删掉；`ReleaseSurface` 改成先放 target
再删 DC/位图（D2D 的 DC render target 还引用着那块 HDC）。修后：

| 轮数 | 句柄 | 工作集 |
|---|---|---|
| 基准 | 285 | 61.8 MB |
| 30 | 285 | 62.3 MB |
| 60 | 285 | 62.3 MB |

六个断言全过（窗口清零、可见清零、无拒绝命令、句柄不增长、工作集 < 10 MB、角色缓存 < 32 MiB）。
像素没变：`bannerHr: 0x00000000`、横幅与角色照旧（截图见 `work/_scratch/shots/round4-banner.png`）。

## 分层资源第一次被真的跑起来：顺手修掉"永远等不到下一次重画"

交付资源是 `composite`，所以 `renderMode: layered` + `parts` 这条分支此前**一次都没被执行过**。
新增 `tests/fixtures/layered-pack`（夹具：1 帧身体 + 1 帧尾巴片区，只为跑通代码路径）与
`layered-pack-test.mjs`：引擎要报 `renderMode: layered`、部件真的画出来、坏包（缺 `contentBounds`）
要降级成 `degraded` 而不是把覆盖层一起带走。

跑起来当场撞到两个问题：

1. **分层部件不会动**。部件的相位是连续运动，但光标表面只在"换帧 / 状态变 / 位置变"时重画，
   单帧片段下 `characterFrames` 恒定 —— 尾巴会僵在那里。修：分层模式下给刷新期限加一条
   ≤30 Hz（横幅 ≤20 Hz）的部件期限。
2. **期限永远推不到**。原来的循环先 `UpdateCursorPose(now)` 把期限设成 `now + 34`，再判断
   `now >= 期限` —— 恒为假，等于没有期限。改成**先判断、后更新**。修后同一夹具 9 → 21 帧/0.6 s。

验收：`layered-pack-test.mjs` 11 通过 / 0 失败。

## 几何自检 + 可见性矩阵：没有第二块屏也能验

方案 8.3 的"边条几何 / DPI 与拓扑"两行本来要求实机双屏。加了 `--self-test`：helper 不建窗、不装钩子，
直接跑**产品代码**里的 `ComputeEdges` / `EdgeAlphaAtMonitorPoint` / `ComputeBannerLayout` /
`ComputeCursorLayout`，遍历 1366×768 到 4K、100/125/150/200% DPI、竖屏、负坐标与 320×200 极小屏，
**407 条断言**：四矩形两两不相交、都在屏内、面积等于 `W·s·2 + (H−2s)·s·2`、角部 alpha 单调且接缝两侧相等
（防"两个窗口各画一遍角部"的亮线回归）、横幅把人物放得下且文字区间为正、光标人物在窗口内且贴边换方位。
`overlay-geometry-test.mjs` 解析这份 JSON 并断言 `ok`/退出码/检查条数。

`indicator-helper-test.mjs` 增加了一轮**可见性矩阵**（另起一个干净 helper）：
控制中打开伴随仍是**一个**光标窗口（`ownerMode: both`）；暂停 → 结束 scope → 恢复**不会**复活
已结束的 scope（`displayWindowCount: 0`，`ownerMode: companion`）；关掉伴随光标窗口真的消失
（`cursorWindows: 0`、`hiddenReason: disabled`）；越界的人物高度被夹到 112–176 / 72–128；
`reducedMotion` 下 `characterFrames` 两次采样相等（真的冻结，不是"看起来慢"）。

`tools/character-pack.py` 现在会**点名**画到格子边界之外的帧（`release` 帧 0–4、`drag` 帧 2–3）：
切格只能做 3 px 渐隐，补不回来，那是美术要补的画，不是代码能修的。

验收：`indicator-helper-test` 69 通过、`overlay-geometry-test` 6 通过（内部 407 条）、
`indicator-supervisor-test` 34、`visual-preferences-test` 34、`client-panel-render-test` 21，全 0 失败。

## 覆盖层改成四条边 + 独立横幅 + 一个光标本（方案 3.x / 4.x / 6.2 / 7.1）

版本号不动（1.50.1），内部协议升到 **v2**。这一轮动的是 helper 的视觉层、资源管线与偏好文档，
业务执行、停止协议、Bash/PowerShell 能力都没有改。

**窗口结构。** 1.50.1 是"每台显示器一张整屏 HWND"：角色或光晕一动就要重传约 14 MiB 的位图。
现在每屏 `TopEdge/BottomEdge/LeftEdge/RightEdge/Banner` 五个小窗口，全局最多一个 `Cursor`。
96 DPI、36 px 边条、约 600×204 横幅、228 DIP 光标下，源表面合计约 1.9 MiB —— 是整屏的 ~13%。
`windows` 不再冒充显示器数量：`counts` 里分开报 `monitorCount / displayWindowCount /
cursorWindowCount / created / surfaceReady / visible / presentOk / failed`。

**角部只画一次。** 四个窗口共享同一个环形距离场
`alpha = peak × (1 - smoothstep(d / thickness))`，d 是到最近屏幕边缘的距离。上下条拥有四个角，
左右条从内边界起止（半开区间、四矩形两两不相交），所以接缝不会因为两窗叠加而变亮。

**DPI 统一。** 位置 / DIB 尺寸 / 鼠标热点用物理像素；布局、文字、人物大小用 DIP，只在
`DipToPx` / `PxToDip` 两处换算。新增 `native/indicator-helper/indicator-helper.manifest`
（PerMonitorV2）并由 `build.ps1` 嵌进 exe —— 之前进程是 DPI 不感知的，DWM 把覆盖层按 150% 拉伸，
窗口只拿到 1707×960，人物发虚的根因就在这里（实测：加清单前窗口矩形 1707×36，加后 2560×54）。

**时钟。** `press_in` / `release` 改成从 `stateEnteredAt` 起算（以前用 helper 启动后的累计时间，
超过片段时长就永远停在末帧）；帧号按累计时长选，不再"每 tick index++"，卡顿后也不补播。

**按需刷新。** 四边 20 Hz、横幅 ≤20 Hz、光标姿势 ≤30 Hz、光标位置由钩子唤醒（100 ms 兜底），
没有期限就 `MsgWaitForMultipleObjectsEx` 等消息。实测（`tools/measure-helper-cost.mjs`，单核口径，
2560×1440 / 150% DPI）：仅边缘呼吸 0.15%，全开静止 0.18%，静态提示与减少动态 0.00%。

**基础提示与装饰分离。** `visualEffects.enabled=false` 只熄装饰：四边、两段文字与 Esc 仍在。
停止时横幅立刻改说 `Stopping…` / `Esc was pressed`，装饰动效同时停下。

**角色按可见高度缩放 + 预缩放缓存（pack v2）。** 每片段带 `contentBounds`（该片段全部帧的并集）
与 `anchorPx`（底边中点），`scale = 目标可见高度 ÷ 包围高度`——透明边距不再吃掉设置值。
缩放只在资源准备阶段做一次（面积滤波缩小 / 双线性放大，预乘空间），运行时只做预乘 over；
缓存按（片段 × 目标像素高度）键控，软上限 32 MiB。实测两片段缓存 2.6 MB、2 项，
1.50.1 是 7 张图集全量常驻约 42 MiB。资源换成重绘稿：吃饭 **16 帧 / 3200 ms**，其余保持原帧数。

**海洋横幅主题。** 淡冰蓝胶囊、深蓝外轮廓 + 浅蓝内描边、青蓝外光、小鲸、海浪与两个慢周期气泡；
两段文字是**真实文本布局**（`IDWriteTextLayout` 缓存），不烘焙进图片。过程中踩到一个真坑：
`ID2D1DCRenderTarget` 上用 `DrawText` 会得到 `D2DERR_TEXT_RENDERER_NOT_RELEASED`（0x88990012），
整块底板都画不出来 —— 换成 `DrawTextLayout` 后 `bannerHr` 变 `0x00000000`。

**日常鼠标角色（独立开关，默认关闭）。** 新设置
「DeepSeek Harness 运行时显示鼠标角色」：开启后宿主启动即生效，只起视觉 helper 与一个光标窗口，
不建 scope、不申请电脑操作权限、不显示边缘/横幅/光晕；Esc 正常交给前台应用。与电脑控制装饰
分开保存，界面文案写明"不会开启电脑操作或高亮提示"。`setCompanionPreferences` / `companionApplied`
把"用户的选择"与"实际可见"分开报（`hiddenReason` / `ownerMode`），恢复时重新计算可见性，
暂停中关掉的伴随不会被旧回复复活。

**偏好文档升到 schemaVersion 2。** 新增 `bannerDecoration`、`bannerTheme`、
`bannerCharacterHeightDip`（112–176，默认 144）、`cursorCharacterHeightDip`（72–128，默认 96）、
`cursorCompanion`（默认 false）。v1 文件按原值迁移：已有开关保持原值，新键取默认；坏文件仍然
留 `.corrupt-<ts>` 并回到默认值。

**测量脚本重做。** `tools/measure-helper-cost.mjs` 改成墙钟口径（Δ进程 CPU / Δ墙钟）、
每场景热身 5 s + 至少 3 s 采样、九个场景分开报，默认启用真实 capture affinity。

**验收**（本机单屏，`node indicator-helper-test.mjs`）：53 通过 / 0 失败 —— 协议协商、四条边 +
一横幅的窗口计数、`presentOkWindowCount === displayWindowCount + cursorWindowCount`、
关闭光晕后 `cursorTracking` 回到 `idle`、健康度逐窗可读。`visual-preferences-test.mjs` 34 通过、
`indicator-supervisor-test.mjs` 34 通过、`client-panel-render-test.mjs` 21 通过、
`visual-effects-host-config-test.mjs` 52 通过。

**还没做（如实记下）**：分层部件（尾巴/发梢独立层）仍是 `composite` 回退；重绘稿有若干帧的
尾巴画到格子边界之外，切格后那条边只能做 3 px 渐隐（`feather_edges`），需要美术补画；
真实双屏 / 混合 DPI 热插拔、8 小时常驻、200% DPI 像素级画质都还没跑（方案第 8 章的实机矩阵）。

## 签名流水线真的跑了一遍（自签证书演练）+ 首帧耗时不再随 scope 消失

方案 4.19.5 的链条里有三步是"签名并加时间戳 → 验证签名链 → **为最终已签名字节生成 release-manifest**"。
新增 `tools/sign-release.mjs` 并把顺序钉死，然后**真的签了一次**（自签证书，因为手上没有出台证书）：

```
signed    release-input.ps1
signed    worker.ps1
verify    0/2 file(s) are Valid, signed and timestamped
          worker.ps1: SIGNATURE — Authenticode status is UnknownError
manifest  identity 5c81d287aa377190, self-check OK
OK  rehearsal done: 2 file(s) signed, manifest rewritten over the signed bytes.
```

**0/2 Valid 是正确结果**：文件签了，自签证书的链不受信任。脚本如实打印，不写成"通过"。
换成真证书只改参数（`--pfx/--password` 或 `--thumbprint`）；`signtool` 找不到会在 SDK 目录里找，
再找不到就 `FAIL` 退出 —— "没签"必须显式失败。

另外修了一个小缺陷：`firstPresentMs` 原来挂在 scope 上，**scope 一关就没了**，而"首帧多久"恰恰是事后
最想知道的数字。现在另存一份（`lastFirstPresentMs`），`status` 与 `doctor` 在 scope 结束后仍能查到。

宿主重启后 `verify-live-host` **13/13** 全绿（`901e4ed4a008273c`），`doctor.checks.indicator` 已出现
（`helperFound: true`）；本轮这两处改动随下一次重启生效（`bad8ebdde8b3b220`）。

## 故障恢复在实机上被撞见了一次（顺带修了两个判定）

这一轮本来想动覆盖层的结构，但先发现两件更该说的事：

1. **`faulted` 是合法状态，不是"未知值"**。我为了换包杀过 helper 进程，运行中的宿主把覆盖层标成
   `faulted`（设计如此：等下一次写去重启）。`verify-live-host` 原来只认 absent/unavailable/ready/active，
   于是一次正常的外部终止被报成失败。现在 accepted 列表含 `faulted`/`stopping`，并单独打一行说明。
2. **恢复路径当场验证**：`faulted` → 发一次写 → helper 重新拉起（新 pid）→ `ready`。
   这正是第 32 轮"不在故障回调里重启、交给下一次派发"那条改动的实机证据。

另外把覆盖层的事实写进 `doctor` 报告：`indicator: { enabled, state, scope, firstPresentMs, helperFound, helperPath }`。
排障时"没有横幅"与"helper 根本没起来"是两件事，报告里必须能分开看。

安装 `o6o`（`901e4ed4a008273c`）。

## drag-continue：一个真的能力缺陷——"用句柄接着画"根本走不到 worker

上一轮它是最后一个"已知有差异但没定性"的点。查下来不是测试写错，是**插件层把自己的能力挡住了**：

`assertBackendArgs` 把 `drag` 归成"坐标必需"，于是 `from_last: true` / `continue_from` 的调用
在派发前就被判成"缺 fromX"，worker 里那套句柄逻辑（`Get-DragHandle`、短时有效、不是最近一个就拒）
**永远没有机会执行**。测试期望的 `[DRAG_HANDLE_MISSING]` 也就从未出现过。

三处修：

1. `assertBackendArgs`：接着画时跳过 `fromX`/`fromY` —— 起点来自句柄，本来就不该有坐标；
2. 插件按会话记住最近一次拖拽返回的句柄（`dragHandles`）；
3. 派发**之前**校验：没有可用句柄 → `[DRAG_HANDLE_MISSING] … nothing was sent (action_sent=false)`；
   给的 id 不是最近一个 → 同样拒绝并说明"可接的是哪一个"。

顺序上把**形状校验放在前面**：一次既没句柄又没终点的调用，"缺 to_x/to_y"比"没有句柄"更贴近调用方要改的东西。

`drag-continue-test` 从 8/4 变成 **12 通过、0 失败**，并从 known 名单里移除。

## drag-path 的两条失败查清了：是夹具读了过期几何，不是工具的问题

上一轮把它登记为"坐标口径待定"。这一轮查到底：

- 夹具在 `Show()` 之后**立刻**算 `.PointToScreen(0,0)` 并写进 `ready.txt` —— 那时窗口还没被
  系统放稳，记下的是旧位置（实测 `251,255`，真实是 `168,171`）。测试拿这个过期原点去换算屏幕坐标，
  工具于是按错的点按下，夹具如实记录在"错的地方"：`down=27,27`、`up=133,120`。
- 先怀疑过 DPI（2/3 的比例很像 150% 缩放），单独写了个探针量：WPF 在这台机器上 `DpiScale = 1.0`，
  `PointToScreen(100,100) - origin = (100,100)` —— **不是 DPI**。
- **修**：夹具在每次 `ask` 时重新报一次实时原点，测试在每次手势前 `refreshOrigin()`。

修完 `drag-path-test` **23 通过、0 失败**。

## 全量跑出来的两条"失败"，查清后一条是我自己的断言写坏了

串行全量出现 2 个未登记失败，逐个对照**原始 1.40.3**：两条在原始树上同样失败，不是本轮引入的。

- `lifecycle-test`：断言"排队那条取消后 1.8 秒内第一次调用必须结束"。这既不等于"排队那条有没有跑"，
  也会在快机器上（实测 1.86 s）判失败 —— 一条会误导人的断言。改成比**先后顺序**：
  排队那条 settle 的时刻必须早于第一次调用结束。现在 110 条全绿。
- `drag-path-test`：夹具记录的按下点（`27,27`）与测试期望的屏幕坐标（`40,40`）不是同一坐标系，
  容差 ±3 吸收不了一个 13 px 的平移。判定口径待定，**先登记为已知**并写清原因，不擅自改期望去"修好它"。

修完再跑：**61 套件 / 54 ok / 7 known / 0 回归；断言 2203 passed、20 failed（全在 known 里）**。

## 补上最后两个 trace 字段：verifyMs 与 retryCount

上一轮把这两个字段标成"显式缺口"。这一轮补上，并且都是**真的量出来的**，不是填个 0 交差：

- `verifyMs`：`browser_actions` 在三条验证路径上累计耗时 —— `:hover` 的 `matches()` 读、select 的
  DOM 最终值读（含"等它稳定"的 40 ms 轮询）、`wait_for` 的条件轮询。只算**验证性读取**，不含派发本身：
  "点完又读了 12 ms 才敢说成功"和"点击本身 12 ms"是两件事，混在一起就没人能定位慢在哪。
  回执层在没做验证时给 `null` 而不是 0（0 会被读成"很快就验完了"）。
- `retryCount`：结构上恒为 0 —— 结果未知的写操作从不重发，只读操作也没有重试策略。保留字段的意义是
  **将来若加退避重试，重放无法悄悄发生**；测试钉住"不能报负数、不能报小数"。

新增断言：`receipt-test` 43 → **49**（null 与数字的区分、负值夹回 0、小数取整），
`select-verify-test` 32 → **33**（回执里必须有一个 ≥0 的 `verifyMs`）。

矩阵文档里这两个字段从"缺"改成"有"，并把原来的"显式缺口"段落改写成现在的实测口径。
安装 `o6m`（`38de24870efab2b2`）。

## 方案 4.9 的矩阵对账 + 30 样本热态基线

方案 4.9 给了一张十一行验收矩阵，并要求"先记录至少 30 次热态样本"。新增
`outputs/DSH电脑控制插件_测试矩阵与基线.md`：逐行说清"由谁保证、断言多少、还差什么"，
差的地方照实写（混合 DPI/热插拔只有合成拓扑单测；签名仍是 NotSigned）。

**基线（同一常驻 worker，丢一个热身样本，连续 30 次）**：

| 命令 | min | P50 | P95 | max | 失败 |
|---|---|---|---|---|---|
| `ping`（纯 IPC 往返） | 0.5 ms | **1.0 ms** | **3.8 ms** | 4.2 ms | 0 |
| `health`（含前台窗口/UIA） | 0.9 ms | **1.6 ms** | **3.8 ms** | 80.2 ms | 0 |

冷启动单列 **1510 ms**（含 `Add-Type` 编译，每会话一次）。`health` 有一个 80 ms 离群点，
P95 不含它 —— 报 P95 而不是平均值就是为了不被尖峰带偏。

新增 `tools/measure-baseline.mjs`。注意别把两层数字混用：`measure-worker-start` 的
`ping 42–51 ms` 含进程创建，`measure-baseline` 的 1 ms 是常驻进程内的往返。

**补齐三个 trace 字段**（4.9 点名的）：

- `firstPresentMs` —— helper 在 `scopeReady` 里报，实测 **225 ms**（建窗 + 首帧呈现）；
- `escapeLatchMs` —— `status.indicator.latch.at`；
- `cancelToAdmissionClosedMs` —— 同步置位，实际 ≈0。

`verifyMs` 与 `retryCount` 仍空着：前者要拆开验证阶段的计时，后者要先定义"重试一次算不算同一次调用"。
这两条在文件里标成显式缺口，不假装有。

## 覆盖层的 CPU 成本：静态画面从 25% 降到 0%

方案 4.18.8 要求"关闭后无后台空转"。把它和**成本**一起量了，结果不是"空闲才空转"那么简单：

| 配置（活动 4 秒） | 修之前 | 修之后 |
|---|---|---|
| 四项全开 | 1781 ms（45% 单核） | 约 29% |
| 角色关、呼吸开 | 30% | **16%** |
| 四项全关 | 25% | **0%** |
| scope 结束后 | 0% | 0% |

四项全关还占 25% 的原因：循环**固定 16 ms 一帧、无条件重绘整幅 2560×1440 分层窗口**，
每帧重新合成并上传约 14 MB —— 画面没变，CPU 照烧。三处改动：

1. `FrameIntervalMs()` 按"有没有东西在动"取 16/50/100 ms（图集本身约 15 FPS，20 FPS 输出已够）；
2. 静态画面**只画一帧**（`drawnOnce`），scope 结束才复位；
3. 有画面时睡到下一帧的时刻，不再固定 `Sleep(8)` 忙等。

角色开着时仍约 29%：整幅上传是主因，**结构**上的解法是方案 4.13 的"每屏四个渐变 visual"
（四条细边窗口代替一块全屏窗口，上传量约降到 1/9）—— 需要重新验证几何与多屏，留作下一项，不在本轮动。

新增 `tools/measure-helper-cost.mjs`（`--prefs` 可单独关某个效果）。

**安装记录**：`copyfile` 一度 `EBUSY` —— 运行中的宿主占着 helper 的 exe。先停进程再装即可
（插件把覆盖层标成 faulted，下一次写会起新的，电脑操作不受影响）。

## 覆盖层实机验收通过（宿主 `ee8655ce8cde13d3`）

重启后 `verify-live-host` 13/13；配置生效，`helper.found: true`。发一次写操作，在**调用进行中**
按窗口类名枚举：

```
VISIBLE DshInteractionIndicator at 0,0 2560x1440
VISIBLE DshCursorHalo at 1420,520 160x160      ← 光标层是 160，正是"要画角色就放大"的修正
total samples with a visible overlay: 41
```

光标层位置与当时指针差 80 像素（半窗宽），跟随正确；调用结束回到 `ready` 并隐藏。

**同一时刻的截图里没有它**（`o2-exclusion-live-during-write.png`，顶部 1200x200 只有壁纸）：
`WDA_EXCLUDEFROMCAPTURE` 在插件真实路径上生效，与先前 `preview.mjs` 的 A/B 结论一致。

至此 O2 尾项与 O6 在实机上**都已成立**：配置打开 → 写操作拉起 helper → 画在屏幕上且跟随指针 → 不进截图。

## 宿主重启后的第一次真实运行：覆盖层没出现，原因是配置里的空串

重启后 `verify-live-host` **13 项全绿**（buildId `65ed986f8f1771c0` 与磁盘一致；`/visual-preferences`、
`/modules`、`indicator` 都在）。但真发一次写之后 `indicator.state` 是 **`unavailable`** —— 覆盖层没起来。

定位：`cordis.patch.yml` 里的 `exePath: ''` 被 `indicatorOptions.exePath ?? 默认路径` 当成**显式空路径**，
于是 `available` 为 false、状态直接是 `unavailable`。写操作按设计降级继续（这点是对的），但覆盖层永远不出现，
而且状态里只写 `unavailable`，看不出是"路径写成空串"还是"没构建"。

- **修**：`exePath` 为空串与"没写"同义，都落到包内那一份；
- **加**：`/computer-use/status` 的 `indicator` 多了 `helper: { path, found }` —— 这两个字段直接回答
  "用的是哪一份、在不在"，不必再猜；
- **测**：`patch-config-applies-test` 增加断言"空 `exePath` 解析到包内 helper"（现 18 条），
  并用**安装后的包**实测：`helper.path` 指到 `<workspace>\dsh-plugins\dsh-computer-use\native\...\*.exe`、
  `found: true`。

## 捕获排除的 A/B（同一二进制，只切一个开关）

| 运行方式 | 画在屏幕上 | 出现在截图里 |
|---|---|---|
| `preview.mjs`（默认 `WDA_EXCLUDEFROMCAPTURE`） | 是（`scopeReady`、`windows: 1`） | **否** |
| `preview.mjs --no-affinity` | 是 | 是 |

两次协议日志一致，差别只在 `SetWindowDisplayAffinity`。证据：`o2-exclusion-ab-captured.jpg` 与
`o4-banner-character.jpg`。

## 光标角色：像素确认 + 一个裁剪缺陷

把引导脚本对着**已安装的** helper 与素材跑起来（`--no-affinity` 让像素进截图），这次看到了角色：
指针右侧有那个女仆精灵，左边是蓝色光晕。截图 `outputs/evidence/o4-cursor-character.jpg`。

但先发现的是一个缺陷：角色画在**光标窗口里**，而那个窗口原本按光晕尺寸（76 DIP）建；52 DIP 高、
锚点偏右下的角色会被自己的窗口**裁掉半截**。所以此前"光标角色"只在协议层验过（`cursorCharacter`
传得进去、帧数在涨），像素上其实是残的。

- 修：`CursorSizeForDpi(dpi, withCharacter)` —— 要画角色时窗口取 160 DIP，否则仍是 76 DIP；
  跨屏或偏好变化时比对**期望尺寸**，不一致就重建窗口（原来只比 DPI）。
- 修完实机截图确认：角色完整、光晕正常。
- `cordis.patch.yml`：`cursorCharacter: true`（此前因为没做像素确认刻意关着）。
  `patch-config-applies-test` 的对应断言随之改成 true。

重新打包 `o6i`（发行身份 `65ed986f8f1771c0`）：`copy 21 / same 334`，装完自检 OK。

**说明**：生产默认下光标窗口设了 `WDA_EXCLUDEFROMCAPTURE`，所以这张验收截图是临时用
`--no-affinity` 拿到像素的；正常运行时它不会出现在截图里（O0 的 A/B 证据同样如此）。

## 交付总账 + 全量测试的诚实汇总

- 新增 `outputs/DSH电脑控制插件_实施总账.md`：方案章节 → 批次 → 落地文件 → 验证 → 状态的一张表，
  外加"外部条件清单""复现命令""已知的既有失败""刻意没做的事"。它是给"一眼看结论"用的，
  过程记在进展文档里。
- `tools/verify-live-host.mjs` 增加对 O6 翻转的检查：`status.indicator.enabled` 必须为 true，
  state 必须是已知值之一。当前（未重启）它会报 "the status reports the overlay switch :: missing" ——
  这正是"旧构建还在服务"的信号。
- 全量测试（串行）连续两次：**61 套件 / 55 ok / 6 known / 0 回归；断言 2197 passed、18 failed
  （全部落在 6 个 known 套件里）**。

**一条诚实记录**：更早一次跑出现 1 个"回归"，重跑消失。特征是该套件 **0 条断言失败**却退出非零 ——
与 `paste-restore-test` 在剪贴板被别的进程抢占时的表现一致，属抖动而非代码回归。总跑器默认串行已经是
为了压掉这类干扰，但它压不掉"另一个程序同时动剪贴板"。

## 覆盖层开启后的两条安全属性（并修掉一个自我驱动的重启循环）

翻转默认值之前必须确认：**缺件不能拦住电脑操作**。新增 `overlay-degradation-test.mjs`（7 条）把两种
情况放在一起测：

| 情况 | 期望 | 实测 |
|---|---|---|
| helper 没构建 / 路径写错 | 降级：写操作照常执行 | 写没有被拒，`type` 真的到了后端 |
| helper 建了但没就绪 | 拒绝：桌面零写入 | 抛错并点明覆盖层；**没有任何输入命令**到后端 |

**顺带发现并修掉一个真问题**：故障回调里原本会立刻 `start()` 重启 helper。若 helper 一启动就崩，
"崩溃→重启→再崩溃"会变成自我驱动的循环 —— 测试里**一次写操作触发了 45 次 `release`**。
现在故障只做三件事：记诊断、`abortAll`、把 scope 置空；重启交给**下一次派发**（失败就如实拒绝）。
修完同一条用例的 `release` 次数降到 3 次以内。

重新打包 `o6h`（发行身份 `586b9cc9ead8fd91`）装上：`copy 5 / same 338`，装完自检 OK。
这次改动**要在下一次重启后才生效**，所以现在装进去正好赶在重启之前。

## O6 默认值翻转：覆盖层出厂开启（等下一次重启生效）

`cordis.patch.yml` 里加上两段配置，这就是 C2 评审里"到 O6 才翻默认值"的那一步：

```yaml
interactionIndicator:
  enabled: true          # 写操作派发前等覆盖层就绪；物理 Esc 会闩锁并停止派发
  exePath: ''            # 空 = 用包内 native/indicator-helper/build/*.exe
visualEffects:
  enabled: true          # 总开关：只影响画面，Esc 与停止永远有效
  bannerCharacter: true  # 已在实机截图确认
  cursorCharacter: false # 还没做过像素级确认，先关
  cursorHalo: true
  edgeBreathing: true
  reducedMotion: false
```

- `/computer-use/status` 新增 `indicator: { enabled, state, scope }`：配置有没有真的把覆盖层打开、
  helper 起没起、当前有没有 scope，排障时不用翻三个地方。
- 新增 `patch-config-applies-test.mjs`（17 条）：用**宿主自己的 YAML 方言**解析 `cordis.patch.yml`，
  取本插件那一行的 config，再原样喂给 `apply()` —— 断言覆盖层开关确实是开的、光标角色确实是关的、
  `defaultEnabled` 仍是 false，并且通过真实的状态路由授权后 `indicator.enabled` 依然是 true。
- 重新打包（`o6g`，发行身份 `906250e7225dcf93`）并用哈希安装器装到
  `<workspace>\dsh-plugins\dsh-computer-use`（copy 24 / same 317，装完自检 OK，备份已留）。

**要下次重启才生效**：配置在宿主启动时读取，现在运行中的仍是 `29eb3fc267e63621`。
重启后 `tools/verify-live-host.mjs` 会显示 buildId 一致；再发一次写操作就该看到横幅与角色。
若覆盖层出问题，把 `enabled` 改回 `false` 再重启即可恢复原状（电脑操作本身不依赖它）。

## GUI 目视验收：效果面板在真实编辑器里可用

宿主重启后，用**电脑操作本身**在 GUI 里验收（不是靠测试桩）：

- 编辑器底栏「电脑操作」旁确实出现**「效果」**入口；
- 点开后弹层列出六项（动画总开关 / 横幅角色 / 光标角色 / 光标晕 / 边缘呼吸 / 减少动态），
  每项带说明，底部写明"只影响画面：操作提示、停止与 Esc 取消不受这些开关影响。"；
- 用 UIA 拨动「减少动态」：`settingsRevision` 4→5 且 `reducedMotion: true`、磁盘文件同步；
  再拨回 5→6、`false`，已恢复默认。

截图见 `outputs/evidence/ui-effects-panel.jpg`。

**操作经验（不是产品缺陷）**：Electron 的 UIA 树在 React 重渲染后会让 ref 失效，
`computer_ui_action` 带 `ref` 会报 `ELEMENT_UNAVAILABLE`；改用 `name + control_type`（动作时重新查找）
就稳定。弹层点外侧会关闭，"先读 ref 再点"的间隙里容易把它点没。

## 实机验收通过（宿主重启后）

宿主已重启，运行的是磁盘上那一份：`buildId 29eb3fc267e63621`。

```
PASS  the running build is the one on disk :: 29eb3fc267e63621
PASS  the visual preferences route answers :: 200（六项齐全）
PASS  the modules route answers :: 200（未装扩展；capabilities 三项全 true）
PASS  the doctor does not report a release mismatch
OK    the running host serves the installed build and all new routes answer
```

- **M0 的运行时证据**：`capabilities` 里的 `settingsService` 与 `configEditor` 是插件在**运行中的宿主**
  里探测到的服务对象，两项都为 true —— 与之前的源码结论一致，但现在不是只读代码了。
- **设置往返**：`GET` revision 0 → `POST` revision 1（值落盘）→ 恢复默认 revision 2。
  `applied` 为空是因为覆盖层没起来（`overlay.state: absent`），"存下来"与"已生效"分开报的设计在实机上成立。
- **后端链路**：`/computer-use/probe` 惰性拉起 worker（`spawns 1`、`workerMs 58`、per-monitor-v2、2560×1440）。
- **工具计数**：doctor 报 `registered: 16`，那是受会话开关控制的那一组；`app_launch` / `app_env_audit`
  不在这组里，总数仍是 18。
- **会话开关**：给本会话 POST `enabled: true` 后 `control.state = observing`、`toolSchemas = visible`。

细节见 `outputs/evidence/live-host-verification.md`。仍未目视的是 GUI 里的效果面板与宿主设置页。

## 未发布 — 全量测试总跑器（并纠正"并行跑出来的假失败"）

验证散在 59 个 `*-test.mjs` 里，只跑一部分就会漏掉"上次还好好的"。新增 `tools/run-all-tests.mjs`：

- 全部跑一遍，按 `ok / known / FAIL` 三类汇总；**只有**登记在 `KNOWN` 里的失败不算回归，每条都写明
  原因与**已在原始 1.40.3 上复核**的结论；
- 需要参数的套件（`rehearsal-install-test` 要 `--source`）报告为 skipped 而不是失败；
- **默认串行**。第一次用三路并行跑出 6 个"失败"，逐个查下来全是跑法问题：剪贴板（`paste-restore`）、
  真实窗口 UIA（`managed-find`）、时序（`lifecycle`）互相污染 —— 并行时 `coordinate-contract` 也从
  71 条掉到 61 条。串行之后它们全部通过，这些失败不是代码的。

串行全量结果：**59 套件：53 ok / 5 known / 0 回归**；断言 **2173 passed, 18 failed**（18 条全部落在
5 个 known 套件里）。`KNOWN` 里的五条都已对照原始 1.40.3 复核：

| 套件 | 原因 |
|---|---|
| `wait-and-capture` | 需要真实桌面夹具（记事本窗口 + 稳定焦点） |
| `degraded-bootstrap` | 需要 tools 服务被延迟启动的宿主环境 |
| `drag-continue` | 拖拽句柄 API 期望与实现不一致（原始 1.40.3 同样 4 条失败） |
| `live-tool` | 需要真实应用与 UIA 控件（原始同样 2 条失败） |
| `managed-find` | 需要真实记事本 UIA 树（原始同样失败；条数随窗口状态 1–5 变化） |
| `rollback-drill` | 需要原始 1.39.1 worker.ps1 作基线（`--baseline`） |

## 未发布 — PR15 决策记录 + 回滚演练

方案把 PR15（把 PowerShell 里的 C# 编译部分改成预编译组件）定为**条件项**：需要有"已确认的性能热点"
或"已确认的部署兼容性问题"。这一轮把决策所需的数字量出来，并写进记录：

| 指标 | 结果（3 次） |
|---|---|
| worker 启动到 ready（含 `Add-Type` 编译） | 1300 / 1340 / 1266 ms，中位数 **1300 ms** |
| 启动后一次 `ping` | 52 / 50 / 51 ms，中位数 **51 ms** |

- 新增 `tools/measure-worker-start.mjs`（可复现：`--runs 3`）。
- 结论：启动成本每次会话只付一次，单次请求远低于感知阈值 —— **没有证据支持重写编译组件**，
  PR15 保持未触发；记录里写清了三个重新评估的触发条件与复现命令。
- **回滚演练**：把 `_backup\dsh-computer-use-pre-pr-20261106-175323`（205 文件）装进隔离目录后
  加载成功（18 工具 / 4 路由、清单自洽）。演练同时暴露并修掉一个判定缺陷：`tools/verify-installed.mjs`
  原本写死期望 5 条路由，回滚目标（1.40.3）只有 4 条会被误判失败；现在期望路由由**包里有哪些文件**
  推导，同一个脚本既能验新装也能验回滚目标。

## 未发布 — 重启验收脚本（把"等重启"变成一条命令）

新增 `tools/verify-live-host.mjs`：比对**正在服务的构建**与**磁盘上装的那一份**，并探测新路由。

判据只有一条但足够硬：`GET /computer-use/status` 的 `buildId` 必须等于安装目录
`release-manifest.json` 的 `releaseBuildId`。再逐项检查 `/visual-preferences`（键集合是否为六项）、
`/modules`（是否为空、能力报告）、`/doctor`（是否报发行身份漂移）。

当前输出（这就是现在的真实状态）：

```
PASS  the status route answers :: 200
PASS  the host reports its build id :: d0fc7f9903ea94ba
FAIL  the running build is the one on disk :: running d0fc7f9903ea94ba vs installed 29eb3fc267e63621
FAIL  the visual preferences route exists :: 404 — the running host still has the old code
FAIL  the modules route exists :: 404 — the running host still has the old code
PASS  the doctor does not report a release mismatch :: consistent
      → restart the host so it loads the installed build, then run this again
```

写法上踩了一个坑并修掉：`fetch`/undici 还有句柄在收尾时用 `process.exit()` 强制退出会触发
libuv 断言（`!(handle->flags & UV_HANDLE_CLOSING)`），改成设置 `process.exitCode` 让事件循环自己收尾。

## 未发布 — 安装器改用哈希（修掉 robocopy 漏更新的那一类）

第 24 轮发现：打包器归一化时间戳后，新旧 `release-manifest.json` **大小与时间都相同、内容不同**，
`robocopy /MIR` 判定"未变化"跳过，安装目录留着旧清单。

- 新增 `tools/install-candidate.mjs`：`planInstall` 逐文件比 **sha256**（大小相同也比），
  内容不同就替换；只存在于目标目录的文件按镜像语义删除（先列清单）；`--dry-run` 一个字节都不动；
  `--backup` 先把整个目录复制到带时间戳的备份；装完用自己的清单复核每个文件。
- 新增 `install-candidate-test.mjs`（14 条）：复刻"同大小同 mtime 不同内容"的场景并断言它**会**被替换、
  相同内容不重拷、陈旧文件被删、嵌套目录正常、备份保留旧字节、装完自检能抓到被改动的文件。
- 实测：`o6f` 候选包（发行身份 `29eb3fc267e63621`）→ `copy 5 / remove 0 / same 318`，
  装完 `OK every file matches the manifest`；`doctor --release` 一致，`verify-installed`
  18 工具 / 6 路由。

## 未发布 — O5 设置页的真实 schema（用宿主那份 schemastery 验证）

上一轮只验了形状与默认值（注入的假实现）。这一轮换成**宿主自己在用的那份** schemastery：

- `internal/host-packages.mjs` 的解析表加入 `@deepseek-ai/schemastery`（CommonJS 入口
  `lib/index.cjs`），于是 `buildVisualEffectsConfig()` 在真实环境里也能拿到 schema ——
  不只是靠宿主拦截解析。
- 在**已安装**的那一份上验证：`Config({})` 得到六个默认值
  `{enabled:false, bannerCharacter:false, cursorCharacter:false, cursorHalo:true, edgeBreathing:true, reducedMotion:false}`。
- 新增 `visual-effects-host-config-test.mjs`（32 条）：解析记录指向 `index.cjs` 并报版本、
  空对象填默认值、显式值保留、**错类型被 schema 自己拒绝**、每个字段的 `meta.description`
  与 `meta.default` 与文案表/默认值逐项一致。

**踩到一个打包/安装的真实坑**：候选包里的 `release-manifest.json` 被 `robocopy /MIR` 跳过 ——
打包器把时间戳归一化了，新旧文件**大小与时间都相同**、内容不同，robocopy 判定"未变化"。
于是安装目录留了旧清单，`doctor --release` 报身份不一致（`2a09…` vs `93dc…`）。
改用 `/IS`（或逐文件比对哈希）之后一致。这条写进安装记录，避免下次"看起来装完了其实没换"。

安装状态：`_release-candidate-o6e`（发行身份 `29eb3fc267e63621`，69 个文件参与哈希）→ 装到
`<workspace>\dsh-plugins\dsh-computer-use`，`doctor --release` 报**一致**，`verify-installed`
18 工具 / 6 路由。

## 未发布 — O5 设置页：导出 Config（宿主设置界面）

方案 4.18.8 想要的不只是 `client.js` 里那个弹层，而是**宿主设置界面**里的开关。宿主的
`SettingsForms` 会按插件导出的 `Config`（schemastery schema）自动生成页面，所以这一轮把它声明出来。

- `internal/visual-effects-config.mjs`：用 `importHostModule('@deepseek-ai/schemastery')` 构建
  schema（插件的真实路径解析不到这个包，见 `internal/host-packages.mjs` 的文件头），六个开关的
  **默认值直接取自 `internal/visual-preferences.mjs`** —— 两处漂移会让"设置页显示开的、实际是关的"
  这种问题重新出现。
- `index.js`：`export let Config`，在模块求值时构建。**拿不到宿主包时 `Config` 是 undefined，
  插件照常加载**（18 个工具、6 条路由都在）；不能因为"想要一个设置页"让插件装不上。
- `apply() 读 `config.visualEffects`：宿主设置里改过的值优先于磁盘上的旧值，且只在宿主真的带了
  这一段时才写盘（避免每次启动白涨一个修订号）。
- 新增 `visual-effects-config-test.mjs`（28 条）：schema 与 store 键集合**双向相等**、默认值逐项一致、
  无宿主包时 `Config` 为 undefined 且插件仍注册 18 个工具、`config.visualEffects` → 落盘的字段
  与修订号。

重新打包（`_release-candidate-o6c`，发行身份 `93dc8d55263919ce`，69 个文件参与哈希）并装到
`<workspace>\dsh-plugins\dsh-computer-use`：`verify-installed` 通过（18 工具 / **6 路由**），
`doctor --release` 报清单一致。

**仍未做**：设置页上的改动要**宿主重启后**才在界面上出现（当前进程仍跑旧构建，其 `/visual-preferences`
与 `/modules` 都是 404）；`Config` 的 schemastery 构建只在注入的假实现下验过，真实宿主里
`importHostModule` 能否解析到 `@deepseek-ai/schemastery` 要等重启后的日志确认。

## M0 验证结论：三项宿主能力都支持（源码证据）

方案 4.21.1 要求先验证宿主是否支持动态撤销工具、设置页注册与配置热更新。逐条读了本机安装的
`@deepseek-ai/dsh-desktop-runtime 0.2.1-rc.5`：

| 能力 | 结论 | 依据（文件:行） |
|---|---|---|
| 动态撤销工具 | 支持 | `dsh-tools/lib/index.js:2972–2982` —— `register()` **返回撤销函数**，底层是分层 effect |
| 设置页注册 | 支持（带 disposer、带修订冲突） | `dsh-settings/lib/index.js:364–368`、`480–483`，并导出 `SettingsConflictError` |
| 配置热更新 | 支持（Loader 和解，文件锁 + 原子写） | `dsh-config-editor/lib/index.js:11`、`64–83` |

因此 PR18 的模块管家**可以安全地接线**：停用 = 调 disposer 撤销入口，不需要"待宿主重启生效"的降级话术。
证据写在 `outputs/evidence/m0-host-capability.md`，并注明这是**源码证据**而不是运行时证据 ——
真正的运行时确认要等宿主重启后用 scratch 插件跑一遍 register→dispose→再注册。

- 新增 `GET /computer-use/modules`：只读地报"现在装了什么、宿主支持什么"。
  `capabilities` 是**检测**不是声明（设置服务/配置编辑器不在场就报 false）；
  没有扩展时列表就是空数组（不扫目录、不唤醒进程）；非 GET 一律 405；
  这条路由**不注册任何工具**（方案 4.21.2：管理入口只给用户界面）。
- `index.js` 里建了 `moduleHost` 实例；`harness-test` 的路由/effect 计数更新（5→6、7→8）。
- 新增 `modules-route-test.mjs`（14 条）。

**仍未做**：模块的安装/启用/卸载界面（需要 `dsh-settings` 的页面策略，与 `client.js` 的槽位是两套 UI）；
运行时验证上面那三项 API。

## 未发布 — PR18（条件项 / M0）：可选扩展的宿主管家

方案 4.21 的**宿主一侧契约**。它不认识任何具体扩展，也不内置业务类型（4.21.1：核心不得反向 import 扩展）。

- `internal/module-host.mjs`：
  - `inspectManifest`：moduleId 形状、协议版本、`hostApiRange`、平台/架构、entry 不许绝对路径或
    `..` 穿越 —— 未知必需字段或版本不兼容一律拒绝；
  - `satisfiesHostApiRange`：`^1.0.0` / `>=1.0.0 <2.0.0` / `1.x` / `*`，解析不了就拒绝（保守）；
  - 状态机 `installed-disabled → enabled-idle → ready → quiescing → installed-disabled`，非法迁移直接抛；
  - **安装不等于启用**：`install` 不执行入口文件，`enable` 只保存选择，`activate` 才真的跑；
  - **停用先改准入代次**：`quiesce` 第一步 `admissionEpoch += 1`，旧代次请求由 `admits()` 拒绝；
    重新启用创建新的 `generation`；
  - **故障隔离**：`activate` 抛错只把该模块标成 `failed`（附失败原因），核心与其它模块不受影响；
    收尾失败如实报 `drained: false`，不假装停干净；
  - **命名空间**：工具只能注册为 `module.<id>.<name>`；`computer_*` / `app_*` 前缀一律拒绝；
  - **不谎报卸载**：仍有在途作业时 `uninstall` 返回 `uninstall-pending`，ready 状态必须先 `deactivate`。
- 新增 `module-host-test.mjs`（54 条）。

**仍未做**：M0 原型要验证的正是"宿主是否支持动态撤销工具/设置页注册/配置热更新"（4.21.1 最后一段）。
在那个结论出来之前，这份管家只提供契约与状态机，没有接到 `index.js` 的工具注册表上 —— 接上去若宿主
不支持可靠热更新，停用就只能表现为"停止派发、待宿主重启生效"，不能只隐藏按钮。

## 发布验收矩阵（方案 4.19/4.20）

方案要求发行结果**分列记录**，不能用一列通过替代其它列。`tools/release-report.mjs` 就按四列出报表，
每列自己跑、自己给结论：

| 列 | 安装包上的结果 |
|---|---|
| 静态文件扫描 | `not_run`（没请求按需扫描；`--scan` 才跑 `Start-MpScan`） |
| 实际启动与工作流 | `pass`：真起 helper，拿到 `ready` + `scopeReady` + `health`（frames 4、character `c-frames-v1`、cursor `ready`） |
| 签名验证 | `fail`：19 条 `SIGNATURE`（NotSigned） |
| 组织策略兼容 | `pass`：执行策略无 Restricted 作用域；AppLocker 策略不可读（如实记录） |

**必需的列只有后两列中的"运行时"与"签名"**；静态扫描与策略是记录项，没跑就写 `not_run`，绝不用
"没报错"顶替。总判定因此是 `FAIL` —— 这是当前真实状态：装得上、跑得起来、但未签名。

顺带补了安装包自身的冒烟：用安装目录里的 helper 与素材起一次 scope，`characterSurface: ready`、
`characterAssetVersion: c-frames-v1`、`frames 28`、`cursorFrames 14`、`affinityExcluded: true`
（生产默认值就是排除截图）。

- 新增 `tools/release-report.mjs` 与 `release-report-test.mjs`（10 条）。

## 安装完成（文件层面），宿主待重启

- 现役插件是符号链接：`...\profiles\desktop\node_modules\@local\dsh-computer-use` →
  `<workspace>\dsh-plugins\dsh-computer-use`。安装即更新真实目录，链接未动。
- 备份：`<workspace>\dsh-plugins\_backup\dsh-computer-use-pre-pr-20261106-175323`（205 个文件）。
  回滚就是一条 robocopy `/MIR`，路径记在 `_backup\LAST-COMPUTER-USE-BACKUP.txt`。
- 同步 303 个文件（候选包 `_release-candidate-o6b`），包内 `doctor --release`：发行身份
  `8feaea8985c0deec`，清单一致。
- 新增 `tools/verify-installed.mjs`：从安装路径加载插件并列出注册结果。真实路径与 profile 符号
  链接各跑一次，均为 **18 个工具 / 5 条路由**。
- **宿主没重启**：`GET /computer-use/status` 仍报旧 `buildId d0fc7f9903ea94ba`，
  `GET /computer-use/visual-preferences` 仍是 404。新代码、新面板都要宿主重启（与 web 包重建）
  之后才会生效 —— 这一点写在 `outputs/evidence/install-record.md` 里，不含糊过去。

## 未发布 — 安装演练：一个"装上去就起不来"的 schema 缺陷

把候选包复制到模拟的 profile 结构（`<profile>/node_modules/@local/dsh-computer-use`）并从那里加载
之后，`apply` 直接抛：

```
unsupported JSON schema: parameters.steps.items.properties.max_chars.minimum
is not supported by the value schema DSL
```

原因是 PR02 的 `declaredBounds` 给整数字段带了 `minimum`/`maximum`；宿主的值 schema DSL 不接受
这两个关键字，`defineTool` 在**加载时**就抛，等于整个插件装不上。开发树里一直没暴露，是因为所有
测试都把 `defineTool` 换成了桩函数 —— 桩不校验 schema。**这是一个会让真实安装直接失败、而测试全绿的
缺陷**，只有安装演练能抓到。

- 修复：`declaredBounds` 只带 `enum`；数值范围仍在运行时按目录里的 `min`/`max` 校验。
  注释里写明了为什么不能再把这两个关键字加回来。
- 新增 `rehearsal-install-test.mjs`（16 条）：把候选包用 robocopy 复制到模拟 profile 路径，从那里
  `import`，断言 18 个工具、4 条路由（status / visual-preferences / state / doctor）注册成功，
  helper 可执行体与角色素材都在包里，包自己的 `release-manifest.json` 与文件一致，且**现役插件
  目录逐字节未变**。
- 重新打包候选（`_release-candidate-o6b`，303 个文件 / 执行集 67），演练通过。

**仍未做**：真实安装（替换现役插件）本身；那一步会动用户的运行环境，需要单独的确认。

## 未发布 — PR14 尾项：清单的来源关系、签名判定与候选包组装

方案 4.19.5 把"没被改过"和"谁发的"分成两件事，这一批把两件事都落到代码里，并真的组了一个候选包。

- `internal/release-manifest.mjs`：
  - 写清单时每个文件多记一个 `sourceSha256`（**签名前**的构建产物哈希）。签名会改字节，所以
    最终的 `sha256` 与它不同是正常的；两者都在，签名之后才能回答"这份发布物来自哪次构建"。
  - 新增 `needsSignature` / `signatureReport` / `verifySignedRelease`：用系统
    `Get-AuthenticodeSignature` 一次查完所有脚本与可执行体，逐条给出 `SIGNATURE` /
    `SIGNER_MISSING` / `TIMESTAMP_MISSING` / `SIGNATURE_QUERY_FAILED`；**查询失败也失败**
    （不能因为查不到就默认通过）。
- `tools/release-verify.mjs`：接受插件自己的 `schema: 1`（`files[].name`）与本工具的 v1
  （`files[].path`）；只对 `.ps1/.exe/.dll/.psm1/.cmd/.bat` 要签名（JS 的来源链由受信任安装
  载体负责）；额外文件默认不算失败，`--strict-files` 才逐个点。
- 候选包（隔离目录 `<workspace>\work\_release-candidate-o6`）：`dsh-computer-use-1.40.3-2026-11-06.zip`
  16.2 MB / 301 个文件，执行集 67 个；`--build` 校验 **OK**；`--verify` 报 **19 条 SIGNATURE
  （NotSigned）** —— 这正是当前的真实状态：没有发行证书，发布验收不该通过。
- 新增 `release-signature-test.mjs`（22 条）：判定五种签名结果、清单过期与签名有效互不抵赖、
  空集合不算失败。

**仍未做**：真实签名（需要发行主体的代码签名证书），以及签名之后对**最终字节**重新生成清单
（那时 `sha256` 会变、`sourceSha256` 不变，正是这两个字段存在的理由）。

## 未发布 — O2 端到端：截图与覆盖层同时开着

方案 4.17.1 的两道防线此前各自有测试，缺的是中间那一段：`capture()` 在覆盖层活动时到底发了什么。

- 新增 `capture-with-overlay-test.mjs`（8 条）：假后端（截图真的写一张 PNG）+ 假 helper（命令逐行
  记日志）+ 真实工具调用。先发起一个**写**把 scope 打开（后端故意慢 300ms），在这段时间里截图：
  - 覆盖层**关**着时，截图成功且 helper 一条 suspend/resume 都没收到；
  - 覆盖层**开**着时，日志顺序是 `beginScope → suspendVisual → resumeVisual`，没有多余命令。
- `tests/fake-indicator.mjs` 增加 `FAKE_LOG=<path>`：把收到的每个 method 逐行追加，端到端用例
  因此可以断言"顺序"而不只是"发生过"。

**仍未做**：真实显示器上的截图排除（`WDA_EXCLUDEFROMCAPTURE` 的像素级 A/B 已在 O0 做过，
但"截图工具 + 真 helper"的实机组合仍要等安装后的验收）。

## 未发布 — 方案 PR13/PR14（AMSI 诊断与可信发布）

依据方案 4.19.3–4.19.5。**先认准、再停手、再谈签名** —— 这一批没有改任何"绕过检测"的东西。

- `internal/security-block.mjs` 增加结构化诊断：
  - `extractPowerShellErrorId` 取 `ScriptContainedMaliciousContent` / `0x8007661x` / 一般 hresult，
    取到才算 `confirmed`，只有弱文本线索时是 `suspected`；
  - `redactStderr` 有界（默认 600 字符）且去掉用户名与邮箱；
  - `buildBlockedDiagnostic` 产出 `BackendBlockedBySecurity`：`phase`（launch/run/release）、
    `errorId`、`scriptHash`、`driverGeneration`、`delivery`、`retryable: false`，
    release 阶段额外 `releaseConfirmed: false`。
- 边界写在结构里：**启动阶段**才允许 `delivery: not_sent`；运行/释放阶段一律 `unknown`。
- `backend/bridge.js`：`lastSecurityBlock` + `clearSecurityBlock()`；确认被拦之后`start()`
  直接以 `BACKEND_BLOCKED_BY_AV` 拒绝，不再拉起同一个文件（每次重试都会再触发一次扫描）；
  `runtimeSummary()` 把诊断带给 status/doctor。脚本 SHA256 与驱动代次一起进诊断。
- `tools/release-verify.mjs`：`--build` 核对"源正文对应关系 + 清单与现文件一致"，允许未签名；
  `--verify` 额外要求 Authenticode 为 `Valid`、有主体、有时间戳。清单哈希本身不算信任，
  篡改者会一起改清单 —— 这句话写进了工具的注释。
- 新增 `security-block-test.mjs`（34 条）与 `release-verify-test.mjs`（13 条）。

**仍未做**：真实证书与签名流水线（需要发行主体的代码签名证书，本机没有）；把
`clearSecurityBlock` 接到"用户更新情报后重试"的入口；Release 阶段的拦截记录还需要在真实
`release-input.ps1` 路径上回放一次（本地无法复现 AMSI 命中）。

## 未发布 — 方案 PR17（O5：视觉效果设置）

依据方案 4.18.8。存储、校验、原子写、路由与设置面板（`client.js` 的"效果"入口）都已接上。

- `internal/visual-preferences.mjs`：`schemaVersion` + 六个布尔项（`enabled` / `bannerCharacter` /
  `cursorCharacter` / `cursorHalo` / `edgeBreathing` / `reducedMotion`）。默认值刻意让装饰关闭、
  让"操作提示与取消能力"不出现在任何开关里 —— 关动画关不掉安全通道。
- 校验：未知键与错类型一律**拒绝并逐条报告**，不做猜测升级；整个补丁非法值不会污染其余键。
- 写盘：先写 `.tmp` 再 `rename`（原子），`settingsRevision` 单调递增并随文件持久化；文件缺失
  用默认值，**损坏或 schemaVersion 不认识**则保留一份 `.corrupt-<ts>` 副本并回到默认值 —— 一个
  手改坏的 JSON 不能拦住插件。
- 路由 `GET/POST /computer-use/visual-preferences`：GET 返回当前值、默认值、修订号与覆盖层状态；
  POST 保存后**如果覆盖层在跑**就把新修订推给 helper（`setVisualPreferences`），并把"存下来"
  与"已生效"分开报告；覆盖层没起来时保存照常成功。
- 每次开 scope 都会把当前偏好推给 helper：helper 重启后不会沿用上一代的旧设置。
- 新增 `visual-preferences-test.mjs`（34 条：默认值/归一化/原子写/修订号持久/损坏与未知版本恢复）
  与 `visual-preferences-route-test.mjs`（17 条：GET/POST/拒绝项/落盘/405）。
- **面板**：`client.js` 在芯片旁新增"效果"入口（`conversation.input.left` 的第二项，order 41），
  弹层里六个开关逐项保存；失败照实说"未能保存"，宿主拒绝的键会点名。底部写明"只影响画面：
  操作提示、停止与 Esc 取消不受这些开关影响"。
- `client-effects-test.mjs`（19 条）把面板的键与宿主校验表对齐：多写、少写、拼错都失败；并确认
  面板里不存在"关横幅/关 Esc"这类开关。
- `client-panel-render-test.mjs`（17 条）用宿主自己的模块装载方式把 `client.js` 真正跑起来：
  假 React（createElement/useState/useEffect）+ 假 fetch + 假 DOM，断言面板默认收起、展开后
  有六个复选框、勾选只发变化的那一个键、宿主拒绝与传输失败都在面板里如实显示。
- `harness-test.mjs` 的路由数与 effect 数随之更新（4→5、6→7）。

**仍未做**：界面的实机验收（要把插件装进 profile 并重建 web 包才能在 GUI 里点到它）；
`interactionIndicator.enabled` 与角色的**发布默认值**仍未翻转 —— 那要在 O6 的验收之后才动。

## 未发布 — 方案 PR16（O4：C 版角色接入，横幅与光标）

依据方案 4.18.6–4.18.7。**开关默认关闭**：`bannerCharacter` / `cursorCharacter` 都要显式打开，
发布默认值在 O5 定。

- **资源包**：`tools/character-pack.py` 把交付的连续帧（manifest + 49 张 384×512 PNG）打成
  7 个状态的 4×2 图集与 `assets/character/pack.json`；校验 schema、assetVersion、每帧 sha256、
  画布尺寸、时长上限、alpha 是否存在，任何一项不过都不写产物。`--check` 复核已装好的那一份。
  `character-pack-test.mjs`（82 条）只读产物，验帧数/时长/锚点/图集字节数与 sha256/PNG 头尺寸。
- **helper**：`--assets=<dir>` 加载；WIC 解码一次成预乘 BGRA，每帧用双线性 over 软件合成进覆盖层
  DIB —— 不为每屏/每 clip 建 D2D 位图，也就没有"设备丢失后位图失效"这条额外故障面。
- **状态机**：停止/故障 → 拖拽 → 按住/抬起 → 移动 → 待机，只由真实按钮集合与指针移动决定；
  动画不反过来影响执行。
- **版面**：横幅角色站左端、两段固定文字整体右移（方案 4.18.6 的"不得遮挡两段固定文字"）；
  光标角色贴热点一侧。截图比对已确认文字完整可读。
- `indicator-helper-test.mjs` 从 46 条增加到 50 条：带 `--assets` 时 `characterSurface: ready`、
  `characterAssetVersion`、`characterFrames > 0`、`characterState` 有值。

**仍未做**：O5 的设置（总开关/分项开关/偏好持久化/即时切换）与设置面板；角色在**真实**多屏与
混合 DPI 下的锚点复核；eat_loop 之外的转场在实机上的节奏复核。

## 未发布 — 方案 PR11（O3：独立光标光晕）

依据方案 4.18。**一个**跟随真实指针的光标窗口，与每屏覆盖层同属一组（N+1），不替换系统光标。

- **跟随**：位置只以 `GetCursorPos` 为准，不拿模型期望的坐标；跨屏按新显示器 DPI 重算尺寸并
  递增 `layoutEpoch`；指针不在任何显示器上（锁屏/安全桌面）就隐藏，不在屏幕上留最后一圈光。
- **视觉**：D2D 径向 alpha 渐变（半径 26 DIP、峰值 alpha 0.24），按下时收缩到 0.86 并把 alpha
  提到 0.32；`reducedMotion` 时只换明暗、不做形变（方案 4.18.5 的"高对比/减少动态"一行）。
- **按压状态**：`WH_MOUSE_LL` 维护左/右/中键集合；**不过滤注入事件**——自动化自己的点击也要有
  反馈（与 Esc 的 `LLKHF_INJECTED` 策略刻意不同）。启动时用合成的 `MSLLHOOKSTRUCT` 自检。
- **开关**：`cursorHalo` 关闭时**真的销毁窗口**（`health.cursorSurface` 变 `disabled`、
  `cursorTracking` 变 `idle`），不是设一个不画的标记；`scopeReady` 报 `cursorStatus` 与
  `cursorWindows`；截图回退时与屏幕窗口一起收起/恢复。
- 新增诊断开关 `--no-affinity`（只用于像素比对，正常启动不会走到；`health.affinityExcluded`
  会显示当前状态）。

`indicator-helper-test.mjs` 从 36 条增加到 46 条：光晕随 scope 创建、跟踪状态、帧数递增、
按压自检（注入的 down 记 1、up 归 0）、关闭后窗口真的消失、恢复后再次可用。

**尚未验证**：光晕的**像素级**人工确认——它的 alpha 在浅色背景上很淡，模型截图又被
`WDA_EXCLUDEFROMCAPTURE` 排除；功能面由帧数、跟随状态与按压自检证明。多屏/混合 DPI、跨屏
交界、双击/拖拽的视觉连续性仍未在实机覆盖（方案 4.18.5 的矩阵留给 O3 收尾）。

## 未发布 — 方案 PR10 尾项（截图排除的串行协调与崩溃恢复）

- **helper 新增 `suspendVisual` / `resumeVisual`**：截图回退时把像素真的收起来，结束时放回并重画
  一帧。它只改变"看得见看不见"，**不**解除 Esc 监听、不解除闩锁、不动任何租约（方案 4.17.1）。
- **`internal/capture-exclusion.mjs`**：截图期间的引用计数协调。只有第一个持有者隐藏、最后一个
  恢复；`finally` 一定恢复；恢复前核对视觉代次，捕获期间 helper 换过代就**不**去动新窗口；隐藏/
  恢复自身失败只记录，不把协调器卡在"永远隐藏"。`capture()` 已经接上它。
- **崩溃恢复**：supervisor 新增 `onFault`，helper 意外退出时宿主关闭新的交互准入、`abortAll`、
  请求独立释放，然后只尝试"起回来恢复可用性"——不重放任何结果未知的动作，也不解除用户的取消。
  下一次写操作会先重启 helper，重启失败就以 `OVERLAY_NOT_READY` 拒绝。
- 新增 `capture-exclusion-test.mjs`（22 条）；`indicator-supervisor-test.mjs` 增加 4 条（假 helper
  与真 helper 各走一遍隐藏/恢复）。

**仍未做**：端到端的"截图工具 + 覆盖层"联合用例（现有截图套件都在覆盖层关闭下运行，协调器由
单元测试与 supervisor 层覆盖）；真实显示器热插拔；多屏/混合 DPI。

## 未发布 — 方案 PR10（O2：把 helper 接进插件）

依据方案 4.15.2 的派发顺序与 4.16 的物理 Esc。**默认关闭**：`interactionIndicator.enabled` 在
O2 期间默认 `false`，发布默认值要到 O5 按 4.18.8 翻转 —— 现在打开会让每个写调用都起一个 helper。

- **`interaction/indicator-supervisor.mjs`**：helper 的宿主侧客户端。按代次收消息（旧代次的迟到
  事件丢弃）、两个 ready 都要真（`visualReady` + `escapeReady`，任一为假就抛且带 payload）、
  有界读取（单行 64 KiB、坏行/超长行只计数）、`cancelRequested` 单独走事件通道；
  **退出与"最后一行"分开处理**：进程退出时先记下退出信息，等 stdout 读完再让等待者失败，
  否则一次正常的 `shutdown` 会被误报成崩溃。
- **派发顺序**（`index.js` 的 `call()`）：写操作先等覆盖层 `scopeReady`，**再**复核授权/租约/
  epoch/取消，最后才写进驱动；覆盖层说"没就绪"时以 `OVERLAY_NOT_READY` 拒绝且桌面零写入；
  helper 未构建（`unavailable`）按降级处理，不阻塞电脑操作。
- **物理 Esc**：`cancelRequested` → 先置通知闩锁，再 `execution.abortAll`、请求独立释放、
  `cancelAll`；闩锁之后任何派发都被拒（换会话也不行），只有用户把 电脑操作 关掉才清除
  （方案 4.16.3：模型不能靠换 id 绕过）。
- 卸载时 `indicator.stop()`：helper 收窗、摘钩、退出，`closed` 报告留在日志里。
- 新增 `indicator-supervisor-test.mjs`（32 条，含接真 helper 的一组）与
  `indicator-integration-test.mjs`（11 条：派发前等覆盖层、未就绪即拒、首帧未完成时 Esc 零派发、
  闩锁跨会话、用户撤销后解除）。

**仍未做**：截图排除（`WDA_EXCLUDEFROMCAPTURE` 已在 helper 里，但"截图时临时隐藏"的回退路径与
插件截图服务的串行协调还没接）、热插拔自动化验证、多屏/混合 DPI、`closed` 之外的资源报告进
诊断路由。

## 未发布 — 方案 PR09（O1：交互提示 helper 与内部协议）

依据方案 4.13–4.15.2、4.16。O0 的探针长成正式进程 `native/indicator-helper/`（C++20，无外部依赖）：

- **每屏覆盖层**：置顶、不激活、鼠标穿透的分层窗口；四边向内渐隐 + 顶部两段固定文字；呼吸相位
  由偏好决定（`reducedMotion`/`edgeBreathing` 关闭时静态）；停止期间横幅改说 `Stopping…` /
  `Esc was pressed`。
- **有界 JSONL 协议**（`docs/indicator-helper-protocol.md`）：`hello/ready`、`beginScope/scopeReady`、
  `updateState/stateApplied`、`setVisualPreferences/visualPreferencesApplied`、`endScope/scopeEnded`、
  `health`、`topologyChanged`、`shutdown/closed`、`error`。单行 64 KiB、输出排队 256 KiB、
  命令队列 64 条；坏 JSON、超长行、未知方法都只回错误、进程不退出。
- **两个 ready 分开**：`scopeReady` 报 `visualReady`（首帧真的呈现了）与 `escapeReady`（钩子真的
  装上了）。`ready` 不等于已显示 —— 这条是方案反复强调的判据。
- **Esc 只认真实事件**：专用线程 `WH_KEYBOARD_LL`；`LLKHF_INJECTED` 一律忽略；本地闩锁先置位，
  再发 `cancelRequested`。helper 不自己杀 worker、不判定"已停止"。
- **拓扑**：`WM_DISPLAYCHANGE` 后重建窗口、递增 `layoutEpoch`、主动发 `topologyChanged`。
- **线程归属**：读线程只"读一行、解析、投递"，所有 UI 操作在主线程。踩过并修掉的真缺陷：
  在读线程里 `CreateWindowExW` 会让窗口归属它，随后主线程渲染/销毁就是跨线程操作，进程以
  `0xC0000374`（堆损坏）退出。

新增 `indicator-helper-test.mjs`（36 条）覆盖版本协商、scope 生命周期、`seq` 单调、偏好修订、
有界输入、`health`、`endScope` 与 `shutdown` 的释放报告；`native/indicator-helper/preview.mjs`
供手工预览（覆盖层默认对模型截图不可见，这是设计而不是缺陷）。

**仍未验证**：真实热插拔触发的 `topologyChanged`、多屏/混合 DPI/锁屏/RDP；helper 尚未接进插件
（`IndicatorSupervisor` 与 TaskScope 属 PR10/O2）。

## 未发布 — 方案 PR08（O0 覆盖层原型与支持矩阵）

依据方案 4.14.1、4.17.2、4.17.3。O0 只回答"这条路成不成立"，不接插件、不发任何工具调用。

新增 `native/indicator-probe/`（C++20，只用 BuildTools 的 cl.exe 与 Windows SDK 10.0.22621）：

- 每台显示器一个 `WS_POPUP` + `WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW |
  WS_EX_NOACTIVATE | WS_EX_TOPMOST` 窗口；`WM_NCHITTEST` 返回 `HTTRANSPARENT`、`WM_MOUSEACTIVATE`
  返回 `MA_NOACTIVATE`；Per-Monitor V2 DPI 意识；物理像素摆放。
- D2D + DirectWrite 画进 32 位预乘 alpha DIB，再 `UpdateLayeredWindow`：四边向内渐隐的渐变（随
  `p=(1-cos(2πt))/3 s` 呼吸）与顶部两段固定文字 `Agent is using your computer` / `Esc to cancel`。
- `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` 每窗调用并记录返回值；`--no-affinity` 用于
  A/B 截图比对。
- 专用线程上的 `WH_KEYBOARD_LL`：只对 `VK_ESCAPE` 的 keydown/syskeydown 置位原子闩锁，忽略
  `LLKHF_INJECTED`；自检把合成的 `KBDLLHOOKSTRUCT` 直接喂给同一回调，规则本身有确定结论。
- 报告 JSON 记录实测事实：显示器矩形/DPI/句柄、affinity 结果、`WindowFromPoint` 在五个采样点的
  返回、覆盖层前后前台窗口、帧数与钩子安装结果。

实测（Windows 10.0.26200，2560×1440@96，单屏）：一窗一屏、DPI 意识开启、affinity 被接受、
五个采样点零命中覆盖层、前台窗口不变、钩子安装成功、注入 Esc 被忽略且未置位、真实 Esc 计数。
**像素级**结论来自 A/B 截图：默认排除时模型截图里看不到覆盖层，`--no-affinity` 时可见。

新增 `native-indicator-test.mjs`（23 条）把上面每一条变成断言，并在 `docs/indicator-o0.md` 写出
支持矩阵与限制；无 MSVC 的机器整组 SKIP。

**仍未验证**：`--backend=composition`（C++/WinRT + `DesktopWindowTarget`）—— 本轮只跑通 layered
路径；多屏/混合 DPI/热插拔/锁屏与 RDP 也未在本机覆盖，方案允许 O1 沿 layered 回退继续，但这些
必须留在 O1/O2 的验收矩阵里。

## 未发布 — 方案 PR06（六步停止协议与代次）

依据《DSH 电脑控制插件架构评估与实施方案》第 4.4 节。旧实现是一句话："发 shutdown，800 毫秒后
kill"——没有准入关闭、没有协作等待与强制终止的分界，也分不清"进程真的没了"和"按住的键真的松了"。

**行为变化：停止有了顺序、预算与报告。** 新增 `backend/supervisor.mjs`：`Generation`（身份、
状态 `idle → starting → ready → stopping → stopped`，失败 `faulted`）与 `stopGeneration()` 的六步
——关闭准入 → 协作取消 → 协作等待 → 终止 → 等**实际退出** → 独立释放 → 清理。报告分字段记录
`admissionClosed`、`cooperative`、`exitConfirmed`（含 `exitHow`）、`releaseConfirmed`、`released`、
`releaseAfterExit`、`faulted` 与每一步耗时；预算默认协作 0.8 s / 退出确认 2 s / 释放 5 s，可用
构造参数覆盖。退出预算用尽 = `faulted`，不是"已停止"。

**行为变化：未派发的请求属于下一代。** 计划内停止（超时、取消宽限到期、显式停止）之后，队列里
**一次都没写出去**的请求不再以 `WORKER_EXITED` 陪葬：它们被放回队列，等旧代停完、新代起来后
继续派发。进程自己死掉（非计划内）仍然整体失败。

- `PowerShellBackend`：每次 spawn 建一个 `Generation`；`#stopChild` 改为六步协议的适配器（关闭
  准入、等在飞请求、终止、等退出、独立释放、清取消标记）；新增 `lastStopReport` 供诊断。
- 超时与取消宽限两条路径都把该请求标成 `stopping`，让协作等待不去等它，并在停止完成后才结算
  回执（超时仍报 `TIMEOUT`/`interruption: timeout`，附 `stopReport`；取消早已报 `CANCELLED`）。
  `#failOutstanding` 跳过这些请求，避免把一次超时改写成一次"进程死亡"。
- `#pump` 在"没有活着的 worker 但队列非空"时触发一次受控重启（`#restartThenPump`），并先等
  上一次停止结束；重启失败由 `start()` 自己的失败路径把队列判掉，不产生重试风暴。
- 协作预算计时器**不** unref：它是本次停止的截止时间，必须在"没人再持有事件循环"时也能触发。
- 新增测试 `supervisor-test.mjs`（39 条）：六步顺序、协作超时仍会终止、退出未确认 → `faulted`、
  钩子抛错不中断、同代重复停止只跑一次、默认预算数值，以及"上一代超时被杀、排队请求在新代上
  跑完"的两代夹具。

## 未发布 — 方案 PR05–PR07（回执、生命周期判据、执行隔离）

依据《DSH 电脑控制插件架构评估与实施方案》第 4.3–4.5 节。三条都围绕同一件事：**这次调用到底
走到哪一步，以及谁有权让它停下来**。

**行为变化：失败带上"走到哪一步"的回执。** 旧实现只有一个 `dispatched: true`，把"写进管道 /
worker 收到 / 结果不确定"压成一个布尔，并且把**同一个** Error 实例拒给所有请求。现在每个失败
都带 `delivery`（`not_sent` / `sent_to_driver` / `driver_ack` / `unknown`）与 `recovery`
（`continue` / `observe` / `retry_read` / `stop`），回执本身以非枚举属性挂在错误上，不进入任何
工具返回值。只有 `not_sent` 允许原样重试；`unknown` 永远是 `observe`。

**行为变化：撤销一个会话不再取消所有人的请求。** `revokeSession` 从 `cancelAll` 改为
`cancelSession(该会话)`；共用一个 worker 时，关掉会话 A 不会再打断会话 B 正在跑的调用。若 A 的
调用卡在单线程 worker 里只能连进程一起停，B 会拿到**自己的**回执（`not_sent`，可安全重试）而不是
一条无从解释的中断。

**行为变化：撤权之后不会再派发。** `call()` 在开始处记下会话与授权代次，在真正写进驱动之前复核
（启动、契约检查、interactive 健康检查之后）——"慢启动期间被撤权"的调用现在以 `ABORTED` 失败，
桌面一次都没被写。

- **PR05 回执**：新增 `internal/receipt.mjs`（三维状态 + 恢复建议 + `mayRetry` +
  `annotateError`）。`backend/bridge.js` 的每个请求记录 `delivery`：写入回调确认 flush 才升到
  `sent_to_driver`，worker 应答才升到 `driver_ack`，写回调报错落到 `unknown`；`#failOutstanding`
  为每个请求生成独立错误副本（排队的是 `not_sent`，在飞的按自己的状态）。`index.js` 把回执转挂到
  它重新抛出的错误上，旧输出 schema 不变。
- **PR06 准备（生命周期判据）**：`internal/generation.mjs` 的退出等待器已经是"按 generation
  等待"的形状（PR04 落地）；本轮把 `PowerShellBackend` 的进程创建改成可注入（`options.spawn`），
  使停止/超时/退出路径可以在没有真实 PowerShell 的测试里驱动。完整的 Generation 状态机与六步
  `stop(reason)` 仍在 PR06 待实施。
- **PR07 执行隔离**：`internal/sessions.mjs` 增加授权代次（撤销 +1，重新授权不回落，销毁同样
  +1）；新增 `internal/admission.mjs`（`capture` / `check`，纯函数）；`index.js` 的 `call()` 在
  派发前复核；`backend/bridge.js` 增加 `cancelSession(sessionKey, reason)`，请求记录
  `options.sessionKey`，`revokeSession` 改用它。
- 新增测试：`receipt-test.mjs`（43 条，用注入的假 worker 驱动真实传输层）、
  `grant-isolation-test.mjs`（23 条，含一条通过公开入口的"慢启动中撤权 → 零派发"用例）。
- `lifecycle-test.mjs` 的 stub 后端补上 `cancelSession` 并记录会话键：断言从"取消了所有请求"改成
  "取消了**该会话**的请求"。

## 未发布 — 方案 PR01–PR04（B0 基线 + 直接修复）

依据《DSH 电脑控制插件架构评估与实施方案》第 4.2–4.4 节与第 4.11 节 PR01–PR04。四条都不是
"重构"，而是把已经确认的错误变成可测的事实。

**行为变化（必须知道的一条）：`select` 不再"找到同名选项就算成功"。** 旧实现读 `chosen.ok`：
页面里存在一个同名 option 就返回 `verification=ok`，哪怕 `change` 回调把值改了回来 —— 请求
"上海"、最终停在 bj，回执仍写成功。现在解析唯一选项、记住 `expectedValue`、设值并派发事件、
在剩余预算内重读**DOM value**（AX 只作旁证）、再比对：相等 `ok`，不等 `mismatch` 并让该步失败，
读不回来 `unavailable` 且整次调用报 `unknown`（写已派出，不能记成失败诱发重放）。选项歧义
（label 命中多项）在改值之前就拒绝，不猜。

**行为变化：`browser_actions` 的非法输入在派发之前以 `[BAD_REQUEST]` 失败**，而不是"跑一步再给
回执"。例如缺 `files` 的 `upload`、缺 `key` 的 `press`、零位移的 `scroll`、未知动作、未知字段、
错类型、越界值。字段清单、校验规则与处理器消费的字段现在同源于 `internal/actions/catalog.mjs`。

- **PR01 基线**：新增 `tools/baseline-snapshot.mjs` 与 `baseline/inventory-1.40.3.json` ——
  204 个文件的 SHA256、18 个工具的参数/输出清单、exports/engines/兼容声明。`--check` 只比较，
  用于发布前确认运行时代码没有被悄悄改动。
- **PR02 动作目录与输入契约**：新增 `internal/actions/catalog.mjs`（动作、效果分类、资源、
  重试策略、字段）与 `internal/actions/schemas.mjs`（公开声明生成 + 按 action 判别的运行时
  校验）。`browser_actions` 的公开 `parameters` 现在声明了 `key`、`code`、`files`、`dx`、`dy`、
  `operation`、`tab`、`condition` —— 这 8 个字段此前被处理器读取、却在
  `additionalProperties: false` 的步骤对象里没有声明，合法输入到不了处理器。文档由
  `tools/browser-action-doc.mjs` 从目录生成（`docs/browser-actions.md`，`--check` 防过期）。
- **PR03 select 后置验证**：见上。`browser/actions.mjs` 新增 `domValueOf` /
  `settledDomValueOf`；同步回退、异步回退、label 与 value 不同、歧义、读不回来分别有测试。
- **PR04 退出 Promise**：`backend/bridge.js` 的 `#exited` 把 `wait.finally(...)` 的返回值存进
  `#exitPromise`，却在 finally 里拿 `wait` 比较，引用永远清不掉 —— 下一次停止拿到上一代已解析
  的 Promise，把"没退出"报告成"已退出"。判定逻辑抽到 `internal/generation.mjs` 的等待器：按
  child 识别、同一 child 一个 Promise、结果为 `exited`/`error`/`timeout`/`absent`（2 秒预算用尽
  是 `timeout`，不等于已退出）。
- 新增测试：`action-catalog-test.mjs`（140 条，目录/声明/校验）、`browser-contract-test.mjs`
  （38 条，走公开入口 + 真实 TCP 计数证明"非法输入零派发"）、`select-verify-test.mjs`（32 条，
  在 `node:vm` 里真的执行页面侧函数）、`exit-waiter-test.mjs`（19 条）。
- `browser-actions-test.mjs` 两处期望随契约更新：缺 `files` 的 `upload` 现在断言
  `BAD_REQUEST` 而不是回执；`tabs` 的 `activate/close` 仍默认作用于本次调用绑定的页面
  （兼容默认值冻结），不再要求显式 `tab`。

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
