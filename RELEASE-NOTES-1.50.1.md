# 1.50.1：独立 EXE 后端构建（2026-11-10）

本次沿用版本号 `1.50.1`，更新源码、标签及本页附件。请通过构建身份或 SHA256 区分新旧包。

| 构建 | releaseBuildId |
| --- | --- |
| 本地包 `@local/dsh-computer-use` | `05dcc1ffa61d7d4d` |
| GitHub TGZ `dsh-computer-use-ljl454` | `91b400081de8314d` |

两种包使用相同的 `backend/dsh-worker.exe`，工作进程身份为 `41e53fcfb0f2521e`。

## 安装本次构建

**npm registry 上的 `dsh-computer-use-ljl454@1.50.1` 仍是旧构建。** npm 不允许同名同版本覆盖，即使删除也不能复用该版本。本次新构建通过 GitHub 附件分发；仅使用包名安装或执行 `npm update` 不会获得本次更新。

使用公开包名的 GitHub TGZ 安装到 Harness：

```powershell
dsh plugin --profile desktop add https://github.com/LJL454/dsh-computer-use/releases/download/v1.50.1/dsh-computer-use-ljl454-1.50.1.tgz
```

只用 npm 安装文件到当前项目：

```powershell
npm install https://github.com/LJL454/dsh-computer-use/releases/download/v1.50.1/dsh-computer-use-ljl454-1.50.1.tgz
```

也可下载 `local-dsh-computer-use-1.50.1.tgz`，继续使用原来的 `@local/dsh-computer-use` 身份安装。两种包任选一种，避免重复挂载。完整目录包为 `dsh-computer-use-1.50.1-native.zip`。

已有安装需要重新安装本页新附件并完整退出、重开 Harness。同版本替换不会自动刷新已有锁文件；应更新该依赖的来源与锁定信息，不要把旧包缓存当成新构建。

## 后端与性能

- 后端真正迁入独立 C# EXE，目标 x64 / .NET Framework 4.8；正常执行不启动 PowerShell、不加载 `System.Management.Automation`，也不在启动时编译源码。
- 保留常驻 JSON-lines 协议、30 个批量动作、18 个 UIA 动作，以及截图/坐标、鼠标、键盘、窗口、剪贴板、应用启动、批量、等待、截止时间、取消、停止和独立输入释放功能。
- 应用启动后的窗口检查和独立输入释放也由 EXE 完成。原有角色、视觉效果及浏览器功能保持。
- 安装用户无需 SDK 或编译器；Windows 需要 .NET Framework 4.8。开发构建入口为 `node native/worker/build.mjs`。
- 缓存已热时，7 次独立后端启动实测约 **188～202 ms**，重复启动中位数 **192 ms**。这不是首次冷启动或整个 Harness UI 的启动耗时。
- Windows 10/11 x64；Harness `>=0.2.1-rc.2 <0.3.0`、Node `>=20`、desktop profile。

## 验证结果与边界

- 原生专项 **11/11**；公开工具路径 **18 项通过**。
- 底层实机遍历 **64 项通过、1 项控件不支持**：测试控件没有 TextPattern2，因此无法读取 caret，普通文本读取可用。
- 全量 **75 套中 69 套通过**，共 2,590 条通过断言、22 条失败断言。其余 6 套尚未全绿，涉及真实记事本/UIA/窗口状态、旧回滚基线、裸 Node 依赖解析和环境变量断言；其中两套失败在未修改原版上也复现，未将所有失败都算作已经证实的历史问题。
- 重点通过：Harness 188、生命周期 110、坐标契约 71、拖动路径 23、构建身份缓存 15、浏览器动作 47。
- 真实 Harness `0.2.2-rc.1` 中依赖解析、工具注册、人物助手及后端探针成功；全新 TGZ 安装与发行清单校验通过。

## Defender / AMSI

本机构建验收使用 Defender 签名 `1.463.203.0`。实时、行为、脚本、云端及 PUA 防护开启，允许项与排除项为空；插件目录、安装包的扫描未发现威胁，实际运行期间没有新增威胁检测/处置事件。

正常后端不再进入 PowerShell 的 AMSI 脚本执行路径；AMSI 本身保持启用，EXE 仍接受 Defender 文件、行为和云端检查。**这不代表旧 `worker.ps1` 的误报已经消失，也不保证未来签名下永远不会误报。** 旧脚本保留作开发对照，生产路径没有自动脚本回退。

EXE SHA256：

```text
41e53fcfb0f2521e2f03299cccab83360802675b517eb27a8f0f87e6ff687000
```

附件完整哈希见 `SHA256SUMS.txt`；包内生产文件清单见 `release-manifest.json`。遇到拦截请保留威胁名、样本哈希及错误并提交安全厂商复核，不关闭防护、不增加长期排除项。
