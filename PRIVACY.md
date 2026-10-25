# 隐私与发布检查

这个仓库/压缩包会被直接上传到 GitHub，所以下面这些内容**刻意不在包内**，发布前也请再跑一遍扫描。

## 包里不包含

| 类别 | 说明 |
|---|---|
| 凭据 | 没有 `.credentials.yaml`、API key、token、cookie；`setup.mjs` 只读取 `DSH_HOME` 与 `USERPROFILE` 这类环境变量 |
| 会话与附件 | 没有 `~/.dsh/sessions`、`attachments`、`storages` 里的任何文件；截图示例只记录在 `VERIFICATION.md` 的文字里，图片不随包 |
| 用户目录绝对路径 | 文档统一用 `<用户>`、`…`、`%TEMP%`、`<plugin-root>` 占位；测试夹具一律用 `example` |
| 机器指纹 | 不记录计算机名、用户名、域名、IP；`VERIFICATION.md` 里的窗口标题已替换为 `<当前会话窗口标题>` |
| 第三方软件清单 | 安全软件只写“第三方实时 AV”，不点名产品 |

## 发布前跑一次

```powershell
node tools/privacy-scan.mjs          # 扫当前目录
node tools/privacy-scan.mjs <dir>    # 扫别处
```

它会检查：Windows/Unix 用户目录路径、本机用户名与计算机名、邮箱、常见凭据前缀
（`sk-` / `ghp_` / `github_pat_` / `AKIA` / `xox?-`）、以及指向具体安装目录的插件绝对路径。
命中即退出 1，并打印 `文件:行号 [类别] 片段`。

允许的占位写法：`<用户>`、`…`、`%USERNAME%`、`example`、`D:\DSH-Plugins`、`D:\Plugins`、
`<plugin-root>`、`<路径>`。

## 如果要把这个包推到自己的仓库

1. `git init` 之前先确认目录里没有 `*.tgz`、`dist/`、测试输出（`.gitignore` 已覆盖大部分）；
2. 跑 `node tools/privacy-scan.mjs`，必须 0 命中；
3. 检查 `git status` 里没有 `.env`、`*.log`、`capture-*.jpg`、`worker-shot.png`；
4. `release-manifest.json` 只含**相对路径**与哈希，不含安装位置，可以随包发布；
5. 提交信息、PR 描述里同样不要贴 `C:\Users\<用户>\...` 这类路径——扫描器管不了 GitHub 的文本框。

## 已知的、可以公开的信息

- `package.json` 的 `author` / `repository` 指向上游作者（`LJL454`）与其 noreply 邮箱，属公开发布信息；
- 文档里的 `D:\DSH-Plugins\...`、`C:\Users\<用户>\Downloads\...` 是**示例路径**，不是某台机器的实际路径。
