# 更新记录

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
