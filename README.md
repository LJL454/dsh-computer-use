# 电脑操作 · dsh-computer-use

> 给 DeepSeek Harness 装上「一双手」——让模型能看你的屏幕、动你的鼠标键盘。

这是一个 DSH 插件。装上之后,输入框工具栏会多一个 **「电脑操作」** 芯片;点开它,模型就能看屏幕、点击、打字、拖拽、操作窗口和控件,像人一样把一件需要点来点去的事做完。

**平台**:Windows · **依赖**:零依赖 · **默认**:关闭,按会话手动开

---

## 它能做什么

装上之后,你可以对模型说:

- 「把 B 站打开」
- 「在那个编辑器里新建一个文件,写上今天的日期」
- 「看看我浏览器里现在开着哪些标签页」
- 「把这个窗口里的表单填了,用刚才那份数据」

模型会自己截图看屏幕、找到该点的位置、点下去、再截图确认。**你不需要告诉它坐标,也不需要写脚本。**

---

## 优点

**快** — 后端是一个常驻进程,首次启动之后每次操作只要 10–50 ms;而且它优先走无障碍接口(比如"调用这个按钮"),命中时连鼠标都不用动。

**省 token** — 截图默认 JPEG,体积约为 PNG 的十分之一,屏幕文字照样看得清。屏幕没变化时直接复用上一帧,不重复上传。

**少来回** — 一次调用可以跑完一整串动作(点输入框 → 打字 → 回车 → 读结果),而不是每做一步就找模型汇报一次。这在"每个模型轮次要花几秒"的场景里是数量级的差距。

**会说人话** — 失败不是甩一句异常,而是带错误码和"下一步该做什么",模型能自己纠正。

**看得懂控件** — 它读的是 Windows 无障碍树,拿到的是"这个按钮叫什么、能不能点",而不是一张图片。需要的时候也能退回像素点击。

**安全默认** — 默认关闭,按会话授权;锁屏和 UAC 提示框会被明确拒绝;子代理用不了;重启 DSH 就回到关闭状态。

---

## 安装

```powershell
$dsh = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
& $dsh plugin --profile desktop add "<插件目录>"
```

然后**完全退出并重新打开 DSH**(桌面端在启动时组装插件,不重启不会生效)。

打开任意会话,输入框工具栏里应该出现「电脑操作」芯片。点一下变成开启态,就可以开始用了。

**卸载**:

```powershell
& $dsh plugin --profile desktop remove @local/dsh-computer-use
```

> 随包发出的 `INSTALL.md` 里有更详细的安装步骤、验证方法和"点亮了却调不动"的排障表。

---

## 怎么用

### 基本用法

点开芯片,直接用自然语言提要求就行。模型会自己决定看哪里、点什么。

### 手动检查

装完之后可以先跑这两个只读检查(不会动你的桌面):

```powershell
# 插件自检:依赖、PowerShell、后台脚本、工具注册、schema 可见性
node "<插件目录>\doctor.mjs" http://127.0.0.1:19387

# 状态探针
(Invoke-WebRequest "http://127.0.0.1:19387/computer-use/status" -UseBasicParsing).Content
```

端口以实际启动的 DSH Web 端口为准。

### 无人值守场景

headless 或脚本环境里没有芯片可点,用配置一次性打开:

```yaml
- id: computer-use
  config:
    defaultEnabled: true
```

---

## 有什么

一共 **18 个工具**,分三组。

### 桌面控制(14 个,受「电脑操作」开关约束)

| 工具 | 干什么 |
|---|---|
| `computer_screenshot` | 截屏给模型看;可只取一块区域、可缩放、可选格式 |
| `computer_actions` | **一次调用做完一串动作** —— 最常用的那个 |
| `computer_click` | 点击(默认优先走无障碍,命中时不动鼠标) |
| `computer_drag` | 拖拽 |
| `computer_scroll` | 滚轮 |
| `computer_type` | 打字(中文可用) |
| `computer_key` | 按键与组合键,如 `ctrl+shift+t` |
| `computer_clipboard` | 读/写/清空剪贴板 |
| `computer_paste` | 用粘贴代替逐字输入,并且还原你原来的剪贴板 |
| `computer_launch` | 启动应用并返回它的窗口 |
| `computer_windows` | 列出/聚焦窗口 |
| `computer_ui` | 读无障碍树(可过滤只看关心的节点) |
| `computer_ui_action` | 直接操作控件:调用、设值、读文本、选中、滚动到可见… |
| `computer_stop` | 急停:放开还按着的键和鼠标键 |

### 浏览器(2 个,同样受开关约束)

| 工具 | 干什么 |
|---|---|
| `browser_state` | 读浏览器:标签页 / 无障碍树 / 页面文本 |
| `browser_actions` | 操作页面:导航、点击、填表、上传、滚动、等待… |

> 浏览器通道只连 127.0.0.1 的回环调试端口,**不会**联网到别处。

### 应用启动(2 个,有自己的开关)

| 工具 | 干什么 |
|---|---|
| `app_launch` | 用干净环境启动图形程序(避开会干扰 Electron 应用的环境变量) |
| `app_env_audit` | 只报告"当前会话的环境是否被污染",什么都不启动 |

### 一个例子

```jsonc
// computer_actions:一次调用做完整件事
{ "steps": [
    { "action": "focus", "hwnd": 1234567 },
    { "action": "set_value", "automation_id": "search", "value": "季度报告" },
    { "action": "key", "keys": "enter" },
    { "action": "wait", "seconds": 0.3 },
    { "action": "key", "keys": "ctrl+a" },
    { "action": "key", "keys": "ctrl+c" },
    { "action": "clipboard", "op": "get" }
  ],
  "evidence": true,                        // 顺便报告屏幕有没有真的变
  "state": { "control_type": "Document" } } // 顺带回一次控件树观察
}
```

一次往返拿到:每步的执行记录、控件里读到的内容、剪贴板文本、屏幕变化证据、一份控件树。

---

## 权限与安全

- **默认关闭,按会话开。** 每个会话单独授权,关着的时候模型碰不到任何桌面能力。
- **关掉就真的看不见。** 关闭时这一族工具的 schema 会从模型的可见列表里摘掉,不占它的上下文预算。
- **子代理用不了。** 子代理的权限范围在启动时固定,不能从内部放宽 —— 需要操作电脑的步骤要交回主代理执行。
- **锁屏 / UAC 会被明确拒绝**,不会静默失败或假装点过了。
- **重启即失效。** 授权状态在内存里,DSH 重启回到默认关闭。
- **一次只有一个会话能驱动桌面。** 写操作要拿租约,避免两个会话同时抢鼠标键盘。
- **截图会在会话结束时删除。** 除了你自己用 `save_path` 指定的那些。

---

## 配置

写在 DSH 配置里:

```yaml
- id: computer-use
  config:
    defaultEnabled: false         # 无人值守场景改成 true
    hideToolSchemasWhenOff: true  # 关闭时摘掉 schema,省上下文
    shotDir: ""                   # 截图目录,默认系统临时目录下的 dsh-computer-use
    actionTimeoutMs: 20000        # 单次动作预算
    appLaunch:
      enabled: true
      defaultWaitMs: 6000         # 等窗口出现的时间上限
```

还有一组环境变量可以微调节奏(正常情况下不用碰):

`DSH_COMPUTER_USE_SETTLE_MS`、`DSH_COMPUTER_USE_STABILITY_MS`、`DSH_COMPUTER_USE_STABLE_MS`、`DSH_COMPUTER_USE_WRITE_TTL_MS`、`DSH_COMPUTER_USE_READ_SETTLE_MS`。

---

## 项目结构

```
dsh-computer-use/
├── index.js              主机半:工具装配、权限门禁、执行适配
├── client.js             浏览器半:「电脑操作」芯片
├── cordis.patch.yml      把插件插进 DSH 的插件树
├── backend/
│   ├── worker.ps1        常驻 PowerShell 后端(实际的桌面操作都在这)
│   ├── parts/*.ps1       worker 的源码片段,拼接生成上面的 worker.ps1
│   ├── bridge.js         Node 与 PowerShell 之间的通信
│   └── release-input.ps1 独立释放路径(worker 被杀时放开仍按住的键)
├── browser/              浏览器通道(回环 CDP)
├── internal/             内部模块:门禁、租约、截图、引用、错误分类、上下文压缩…
├── tests/                测试夹具
├── tools/                构建与打包脚本
└── *-test.mjs, probe*.mjs  各主题的测试与诊断脚本
```

**运行时只看 `backend/worker.ps1` 和上面那几个 JS**;测试与诊断脚本是给排查问题用的,不装也不影响使用。

---

## 更新记录

### 1.39.5 — 预设加载、重复挂载、芯片时序与工具可见性

四类故障一起收掉。前两类在 bundle 的 `cordis.patch.yml` 里,后两类在 `client.js` 与 `internal/schema-visibility.mjs` 里。

**① 分析与文档预设加载失败(预设一行都起不来)。** `preset-task-analysis` / `preset-task-document` 两行声明了 `@deepseek-ai/dsh-tool-workspace-dependencies`,却没有给 `config`;而该工具的描述符是 `z.object({ source: z.string().min(1).required(), root: z.string().min(1) })`,`apply()` 里第一句就是 `isAbsolute(config.source)`,于是预设加载直接抛 `$.source missing required value`。两行现在都带上 `source: !!js …`,从 `DSH_RUNTIME_ROOT` 或 `LOCALAPPDATA` 推出运行时根目录 —— 用 `!!js` 而不是写死路径,是因为 Loader 的 entry config getter 会 `interpolate()` 预设子行的 `config`,这样既能解析又不必把用户名烘进可发布的配置。`root` 故意不写:只校验运行时,不安装。

**② 桌面预设重复挂载同一份实例。** `preset-task-desktop` 里又挂了一次本插件(`id: computer-desktop`)。每次 `apply()` 都会新建自己的授权表、可见性与后端,并重新注册 `/computer-use/*`;而 `dsh-host-webserver` 的 `register()` 在路径已存在时抛 `duplicate route`。桌面预设现在与其它会话一样**通过芯片开启**,全局那一份实例保持不变。没有把全局 `defaultEnabled` 翻成 `true` 来"恢复"旧默认 —— 那会影响所有会话。

**③ 芯片点击不可靠、旧回包能覆盖新状态、稳定后不再同步。** 请求账目从 React state 搬进 `useRef`(`mounted / epoch / readId / toggling / read`):

- 同一轮连点只发一条 POST —— `toggling` 在任何 `setStatus` **之前**同步置位,第二次点击读到的就是 true;`status.phase === 'busy'` 做不到,因为那一帧还没渲染;
- 发 POST 前先递增 `readId` 并 `abort()` 旧读取,回包必须 `mounted && epoch && readId` 三者都对上才允许写状态,所以**取消来不及**时旧值也覆盖不了新值;
- 会话切换递增版本、作废在途读取;卸载后任何回包都写不进状态;
- POST 成功以回包为准(不再乐观写目标值);失败先亮错误,再在**同一会话内重新 GET** 确认真实状态 —— 回包丢了不等于服务器没执行,不能凭空把旧值恢复回去。确认读取也失败时保留原错误;
- 稳定态不再停止同步:隐藏时暂停,可见/聚焦时立即读取,下一次读取永远排在上一次回包之后,结构上不可能重叠。

**④ 工具可见性查询把 Context 当作用域 key。** 原来是 `tools.get(name, agent.ctx)`。宿主 `dsh-tools` 的 `get(name, scope)` 把第二个参数交给按**作用域 key** 索引的层表(`view(scope)` → `layers.chainLayers(scope)`),而 `dsh-scope` 的 `scopeOf(ctx)` 才是从 Context 上取那个 key 的正路(`ctx[kScope]`)。传 Context 等于拿它当 key 用,层表里查不到,于是"这个会话看得见哪些工具"永远答 `undefined`,摘不摘 schema 都跟着错。现在走 `scopeOf(agent.ctx)`;解析器不可用或抛错时退回旧调用形态,**能力不受影响**(工具保持"可见但被拒")。

**依赖变化**:`@deepseek-ai/dsh-scope` 现在是声明的 peer dependency(与 `@deepseek-ai/dsh-tools` 并列)。解析放在模块加载时用带 try/catch 的动态 import,所以一个装不出该包的环境不会连 token-guard 和 app-launch 一起起不来。

**怎么验的**:回归 675 项断言 / 8 个套件全绿 —— `client-smoke.mjs` 86、`test-schema-visibility.mjs` 37、`tests/preset-config-test.mjs` 32、`tests/workspace-dependencies-test.mjs` 15,加上未改动的 `schema-test.mjs` 209、`harness-test.mjs` 184、`lifecycle-test.mjs` 110、`merge-mount-test.mjs` 7。前端模拟器这次补了 `useRef`、**真的执行 effect cleanup**、**真的按依赖比较决定是否重跑** —— 否则"已卸载的 effect 还在更新状态"这类断言本身就没有意义。两个预设的运行时另有 9 项端到端校验(`tests/workspace-dependencies-live.py`):pandas 读 CSV 汇总分组,python-docx 与 openpyxl 各写一份并读回。

> 前端 bundle、宿主代码与预设配置都只在 DSH 启动时组合一次,**要完全退出并重新打开**才会一起生效。

### 1.39.4 — 修掉「芯片点开了、工具却永远不出现」

**症状**:默认关闭时(摘 schema 省上下文),把「电脑操作」芯片点开,控制块报告 `enabled: true`、工具也显示为可见,但模型那边永远看不到那 16 个 `computer_*` / `browser_*` 工具。重启 DSH 才恢复。

**根因**:摘掉限制的那两行写成了 `restricted.dispose?.()`。宿主 `tools.restrict()` 的实现是 `return this.layers.effect(...)`,而 cordis 的 `ctx.effect(fn)` 返回的是**函数**(`export type Disposable<T> = () => T`),函数身上既没有 `.dispose` 也没有 `[Symbol.dispose]`,`?.()` 于是变成静默空操作 —— 拒绝过滤器原地不动地留在 agent 上,而本地账本已经记成"已恢复可见"。

**修复**:`internal/schema-visibility.mjs` 把释放收敛到 `liftRestriction(disposable)`:函数就调用它,对象才走 `.dispose()`。回归钉进 `test-schema-visibility.mjs` —— 测试 stub 从 `{ dispose() {} }` 改成真实契约的 `() => disposed.push(true)`(旧 stub 正好符合插件的错误假设,所以 306 行断言全绿、生产环境却永远释放不了),另加 6 条断言压住"释放后 `restrictedCount()` 必须回到 0"。

**想亲眼确认宿主契约**,在任意机器上跑:

```powershell
node verify-disposer-contract.mjs
# typeof disposer            : function
# disposer.dispose           : undefined
# after disposer.dispose?.() -> cleaned = 0     ← 旧写法的真实效果
# after disposer()           -> cleaned = 1     ← 修复后的效果
```

> 已经装着的旧版本要**重启一次 DSH**:当前会话的 deny 过滤器已经钉在 agent 的 fiber 上,热改救不回来。

---

## 已知限制

- **只支持 Windows。** 后端用的是 SendInput + GDI + UI Automation。
- **管理员窗口点不动。** 受 Windows 权限隔离限制,对以管理员身份运行的窗口操作会无效(而且系统不报错)。要让插件也能操作它们,DSH 本身需要以管理员身份运行。
- **UAC 提示框和锁屏按设计无法操作。**
- **读大窗口的控件树可能慢。** Electron 应用几百个节点要将近一秒。知道要找什么的时候用过滤/查找模式,大约 190 ms 且与窗口大小无关。
- **截图抓不到受保护内容。** DRM 保护的窗口(某些播放器)会抓到黑块。
- **键盘操作无法当场验证。** 鼠标可以靠回读坐标确认真到位了,键盘没有等价办法 —— 所以插件报的是"按键已发送",不是"字符真的进了输入框"。要确认就读回来。
- **同一时刻只有一个会话能操作桌面。**

---

## 许可

MIT © LJL454
