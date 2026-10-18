# 安装与排障（电脑操作 · dsh-computer-use）

> 这份文件随包发出，就是因为**这个包原来没有它**：上一版 `MANIFEST.txt` 让读者去看
> "README, section 2"，而 README 并没有打进包里。安装步骤只有一句话，漏掉其中任何一半，
> 症状都是"界面上看起来正常、工具却一个都调不动"。

## 1. 装

把 zip 解压到任意目录，让**这一层**（含 `package.json` 的那一层）成为插件根，然后：

```powershell
$dsh = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
& $dsh plugin --profile desktop add "<解压后的插件根目录>"
```

这条命令做两件事，缺一不可：

1. 把插件写成 profile 的 `link:` 依赖；
2. **把它加进 profile 的 `dsh.profile.bundles`**。

少了第 2 步，插件自己的 `cordis.patch.yml` 不会被读取，宿主半边就不会挂载——芯片可能照常显示，
但工具和路由一个都不会注册。

装完必须**完全退出并重新打开 DSH**：桌面端的 profile 只在启动时组合一次，运行中不会重新扫描。

卸载：

```powershell
& $dsh plugin --profile desktop remove @local/dsh-computer-use
```

## 2. 装完先看三件事

```powershell
# 1) 插件自检（只读，不碰桌面）：依赖、PowerShell、后台脚本、工具注册、schema 可见性
node "<插件根目录>\doctor.mjs" http://127.0.0.1:19387

# 2) 宿主半边活着的话，这两个只读路由会直接答话
(Invoke-WebRequest "http://127.0.0.1:19387/computer-use/status" -UseBasicParsing).Content
(Invoke-WebRequest "http://127.0.0.1:19387/computer-use/doctor" -UseBasicParsing).Content

# 3) 主动把后端拉起来（第一次约 600 ms，之后 10–50 ms）
(Invoke-WebRequest "http://127.0.0.1:19387/computer-use/probe" -UseBasicParsing).Content
```

端口以 DSH 实际启动的 web 端口为准。界面验证：重启后打开任意会话，输入框工具栏出现「电脑操作」
芯片，点一下变成开启态。

## 3. "点亮了电脑操作，工具却调不动"

这一类故障的共同点是**没有症状**：芯片由浏览器半边渲染、工具由宿主半边注册，两条加载路径不同，
所以宿主半边整块没挂上时，界面完全看不出来。按下面的顺序读，一条命令就能定位：

| 现象 | 读出来的东西 | 结论 |
| --- | --- | --- |
| `/computer-use/doctor` 返回 404 | 宿主半边没挂载 | 插件行不在 `dsh.profile.bundles`，或装完没重启 DSH |
| `findings` 里有 `NO_TOOLS_REGISTERED` | 一个工具都没注册 | `apply()` 在此之前中断了；看宿主日志里 `computer-use` 的报错 |
| `findings` 里有 `TOOLS_REFUSED` | 某个工具描述符被宿主拒绝 | 被拒的那个不可用，其余工具照常——名字与原话在 `runtime.registrationFailures` |
| CLI 里 `PEER_RESOLUTION_OUTSIDE_HOST` | 裸 Node 解析不到 `@deepseek-ai/dsh-tools` | **正常**，宿主的运行时解析面覆盖它；以宿主那一段为准。只有宿主里出现 `PEER_UNRESOLVED` 才是问题 |
| `findings` 里有 `POWERSHELL_MISSING` | 找不到 Windows PowerShell | worker 起不来，每个 `computer_*` 调用都会失败 |
| `toolSchemas: hidden` 且芯片是开启态 | 可见性没跟着开关走 | 点一下芯片（关再开）即可重新对齐；`/doctor` 的 `schemaVisibility` 会给出当时登记了几个 agent |

芯片自身的状态也在 `/computer-use/status` 里：`control.toolSchemas` 为 `hidden` 表示这一族 schema
此刻不在该会话的视野里（关着的时候是设计行为）。

## 4. 这个包是怎么组装的（排查时的前提）

- `backend/parts/*.ps1` 是**源码**，`backend/worker.ps1` 是运行时产物，由
  `node tools/build-worker.mjs` 按序号拼接生成。改了片段却没重新生成会被 `--check` 拦住。
- 宿主在每次调用前后比对 `worker.ps1` 与 `release-input.ps1` 的哈希（有 30 秒缓存，
  `verifyWorkerBuildEveryCall: true` 可关掉），所以"半套升级"不会被放行。
- `internal/` 是拆分出来的职责模块；`index.js` 只留配置、装配与执行适配。
