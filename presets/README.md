# 可选任务预设 bundle

这是 `@local/dsh-computer-use` 的**可选** bundle，不属于核心安装。它只包含三行
`@deepseek-ai/dsh-agent-preset`：

| 预设 id | 名称 | 用途 |
| --- | --- | --- |
| `task-desktop` | 桌面操作 | 看屏幕、点控件、驱动应用 |
| `task-analysis` | 日志与数据分析 | 脚本、文件、检索、统计 |
| `task-document` | 文档生成 | 读素材、算数据、出文档 |

## 安装

核心插件先按 `../INSTALL.md` 装好。需要预设时，把**本目录**（含 `package.json` 的这一层）
作为独立 bundle 安装：

```powershell
$dsh = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
& $dsh plugin --profile desktop add "<插件根>\presets"
```

然后完整退出并重启 DSH。三个预设会出现在任务预设选择器里；它们是增量，不替换内置的
`standard` / `ptc` / `minimal` / `cordis`。

## 为什么拆出来

1.39.5 把三个预设和核心插件放在同一个 `cordis.patch.yml` 里。预设里的
`@deepseek-ai/dsh-tool-workspace-dependencies` 需要运行时目录（`DSH_RUNTIME_ROOT` 或
`%LOCALAPPDATA%/Programs/DeepSeek Harness/.../primary-runtime`）；在自定义安装、不同分发
形态或环境变量含义不符时，这一行会让预设子插件加载失败。核心能力不该为它承担启动面。

拆开后：

* 核心安装不再读取 `runtime.json`，也不依赖文档/分析运行时；
* 预设坏了只影响对应的预设行，不会遮蔽 `computer_*` 工具；
* `doctor` 的 profile 检查会分别报告核心 bundle 与预设 bundle 的状态。

## 卸载

```powershell
& $dsh plugin --profile desktop remove @local/dsh-computer-use-presets
```

卸载只移除预设贡献；已存在的用户手写 patch 行不会被自动删除，需要按 `INSTALL.md` 的迁移
步骤单独清理。
