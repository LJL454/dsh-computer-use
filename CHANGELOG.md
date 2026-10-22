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
