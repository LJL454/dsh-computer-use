# 覆盖层 O0 支持矩阵（实测）

生成时间：2026-11-08T06:33:48.247Z
系统：Windows 10.0.26200　｜　显示器：1　｜　后端：layered

| 验收项 | 实测值 | 结论 |
|---|---|---|
| 每屏一个分层窗口 | 1 个（显示器 1 台） | pass |
| Per-Monitor V2 DPI | true | pass |
| 窗口矩形/DPI | 2560x1440@96 | recorded |
| 截图排除（API 返回） | ok | pass |
| 截图排除（像素 A/B） | 默认排除时截图无覆盖层；`--no-affinity` 时可见 | pass（人工比对） |
| 鼠标穿透（WindowFromPoint） | 0 次命中覆盖层，共 5 个采样点 | pass |
| 不抢焦点 | 前台窗口未变 | pass |
| 低级键盘钩子（专用线程） | 安装成功 | pass |
| 注入 Esc 过滤 | 注入事件被忽略、未置位取消闩锁 | pass |
| 四边渐变 + 双文本 | 24 帧已呈现 | pass |

## 判定与限制

- 分层窗口（layered + `UpdateLayeredWindow`）这条路成立：四边渐变、双文本横幅、预乘 alpha、鼠标穿透、
  不抢焦点、截图排除、专用线程低级钩子都在本机实测通过。
- `WDA_EXCLUDEFROMCAPTURE` 的**像素级**结论来自 A/B 截图比对：同一套视觉，默认排除时截图里看不到覆盖层，
  `--no-affinity` 时可见。API 返回 `TRUE` 只说明系统接受了请求，不代替这次比对。
- `--backend=composition`（C++/WinRT + DesktopWindowTarget）仍待验证：本轮只完成 layered 路径与全部判据。
  方案 4.14.1 允许在组合不稳定时保留同一协议走 layered 回退，O1 按这条路径继续。
- 多屏、混合 DPI、热插拔、锁屏/RDP 尚未在本机覆盖（只有一台 2560×1440@96 显示器）；这些属于 O1/O2 的验收项，
  不能由单屏结果外推。

