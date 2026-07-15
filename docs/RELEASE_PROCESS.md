# CodexBridge Weixin 固定发布流程

本文档用于每次发布新版本时固定执行同一套流程，目标是同时完成：

- 检查代码和敏感文件
- 递增版本号
- 运行完整验证
- 生成 Windows 安装包
- 提交代码并创建 Git Tag
- 推送到 `gouyu-hou/CodexBridge-Weixin`
- 创建 GitHub Release
- 上传自动更新所需文件

以下命令均在仓库根目录执行。进入本机的 CodexBridge 项目目录：

```powershell
Set-Location '<CodexBridge 项目目录>'
```

目标 Git 远程为 `gouyu`，对应 `gouyu-hou/CodexBridge-Weixin`。

## 一、发布前检查

先关闭正在运行的 CodexBridge Weixin Admin。否则打包时内置的
`build/runtime/node/node.exe` 可能被占用，出现 `EBUSY` 错误。

检查当前分支、改动和远程仓库：

```powershell
git branch --show-current
git status --short
git diff --stat
git remote -v
```

发布前必须确认：

- 当前分支是 `main`
- 所有待发布功能已经完成
- 没有误提交真实 API key、账号 Token、日志或用户数据
- 没有提交 `weixin.service.env`
- 没有提交 `CodexBridgeData/`
- 没有提交 `node_modules/`
- 没有提交 `release/`

如果工作区中存在不认识的文件或未完成改动，先查清楚，不要直接发布。

## 二、更新版本号

日常修复和小功能使用补丁版本：

```powershell
npm version patch --no-git-tag-version
```

例如：

```text
0.1.5 -> 0.1.6
```

较大功能升级可以使用：

```powershell
npm version minor --no-git-tag-version
```

重大不兼容升级才使用：

```powershell
npm version major --no-git-tag-version
```

读取更新后的版本号：

```powershell
$Version = node -p "require('./package.json').version"
Write-Host "准备发布 v$Version"
```

版本号会同时写入 `package.json` 和 `package-lock.json`。

不要覆盖已经发布过的相同版本号。自动更新依赖版本号判断，新版本必须大于旧版本。

## 三、运行发布前验证

每次发布统一执行完整门禁：

```powershell
npm run verify:release
```

只有命令完整退出且返回码为 `0` 后才能继续。该脚本会依次验证根项目、Gateway、
Provider Relay、Native API 和 Mission Control 的边界、类型、测试与构建，并在最后
执行 `git diff --check`。

排查失败步骤时，可以先单独执行对应命令，例如：

```powershell
npm run typecheck
npm run typecheck:js
npm test
npm run codex-gateway:test
npm run codex-provider-relay:test
npm run build
git diff --check
```

这些分步命令用于定位问题，不能替代发布前最后一次完整执行
`npm run verify:release`。

说明：

- `typecheck` 检查 TypeScript
- `typecheck:js` 检查项目中的 JavaScript
- 各包的 boundary 检查防止跨包依赖越界
- 各包的 test 和 build 检查独立包可测试、可构建
- `npm test` 运行根项目完整测试套件
- `git diff --check` 检查多余空格和补丁格式
- CRLF/LF 换行提醒通常不是代码错误，但仍需确认没有真正的 `error`

如果测试失败，先修复并重新运行全部验证，不要带着失败测试发布。

## 四、生成安装包

执行：

```powershell
npm run weixin:electron:dist
```

正常完成后，`release/` 中会生成：

```text
CodexBridge-Weixin-Admin-Setup-x.x.x.exe
CodexBridge-Weixin-Admin-Setup-x.x.x.exe.blockmap
latest.yml
win-unpacked/
```

确认安装包和自动更新文件存在：

```powershell
$Version = node -p "require('./package.json').version"
Get-Item "release\CodexBridge-Weixin-Admin-Setup-$Version.exe"
Get-Item "release\CodexBridge-Weixin-Admin-Setup-$Version.exe.blockmap"
Get-Item "release\latest.yml"
```

如果出现以下错误：

```text
EBUSY: resource busy or locked, copyfile ... node.exe
```

说明 CodexBridge 服务仍在运行。关闭软件和后台服务后重新执行打包命令。

如需同时生成轻量更新包，再执行：

```powershell
npm run weixin:electron:lightweight
```

轻量更新属于可选项；完整安装包和自动更新的三个标准文件仍然必须正常生成。

## 五、提交代码

打包成功后再次检查：

```powershell
git status --short
git diff --stat
git diff --check
```

确认内容正确后提交：

```powershell
$Version = node -p "require('./package.json').version"
git add -A
git status --short
git commit -m "release: v$Version"
```

`git add -A` 后必须再看一次 `git status --short`，确认没有把用户数据、密钥、日志、安装包或临时文件加入提交。

## 六、创建 Tag 并推送代码

创建版本 Tag：

```powershell
$Version = node -p "require('./package.json').version"
git tag "v$Version"
```

推送代码和 Tag 到自己的仓库：

```powershell
git push gouyu main
git push gouyu "v$Version"
```

不要推送到原项目的 `origin`；本项目应推送到 `gouyu`。

如果 Git 报错连接 `127.0.0.1:7892` 失败，说明本机 Git 代理已配置但代理软件未运行。可以先打开代理，或者只对本次推送临时绕过代理：

```powershell
git -c http.proxy= -c https.proxy= push gouyu main
git -c http.proxy= -c https.proxy= push gouyu "v$Version"
```

上述命令不会修改全局代理配置。

## 七、创建 GitHub Release

打开：

[GitHub Releases](https://github.com/gouyu-hou/CodexBridge-Weixin/releases)

点击 `Draft a new release`，然后填写：

- Tag：选择刚推送的 `vX.X.X`
- Release title：`vX.X.X`
- Description：使用本文档后面的更新说明模板
- 不勾选预发布，除非这是测试版本

必须上传以下三个文件：

```text
release/CodexBridge-Weixin-Admin-Setup-x.x.x.exe
release/CodexBridge-Weixin-Admin-Setup-x.x.x.exe.blockmap
release/latest.yml
```

三个文件的作用：

- `.exe`：完整安装包
- `.exe.blockmap`：Electron 更新下载所需的差分信息
- `latest.yml`：告诉客户端最新版本号、安装包名称和校验值

缺少 `latest.yml` 或文件名不匹配时，软件内“检查更新”可能找不到新版本。

上传完成后点击 `Publish release`。

## 八、更新说明模板

每次发布可以复制下面的内容再修改：

```markdown
## CodexBridge Weixin Admin vX.X.X

### 更新内容

- 新增：填写本版本新增功能
- 优化：填写本版本体验或性能优化
- 修复：填写本版本修复的问题

### 安装方式

新用户下载并运行：

`CodexBridge-Weixin-Admin-Setup-X.X.X.exe`

已安装旧版本的用户可以在软件内点击“检查更新”。

### 注意事项

- 更新前建议备份重要配置和会话数据
- 安装更新时请先关闭正在运行的 CodexBridge Weixin Admin
- 用户数据默认不会因为覆盖安装而删除
```

不要在更新说明中写入 API key、Token、本地私人路径或其他敏感信息。

## 九、发布后验证

发布后必须检查：

1. GitHub 仓库 `main` 已包含最新提交。
2. GitHub 已存在对应的 `vX.X.X` Tag。
3. Release 页面可以看到 `.exe`、`.blockmap` 和 `latest.yml`。
4. 下载后的安装包能正常启动。
5. 旧版本点击“检查更新”能发现新版本。
6. 微信消息、管理后台和模型调用至少完成一次基础测试。

检查本地工作区是否干净：

```powershell
git status --short
```

没有输出表示当前已跟踪代码全部提交。

## 十、发布失败时怎么处理

如果代码或 Tag 还没有推送到 GitHub，可以在修复后重新执行测试、打包和提交。

如果版本已经公开发布，不建议覆盖同一个 Tag 和同一个版本号。更稳妥的做法是：

1. 修复问题。
2. 再次执行完整测试。
3. 将补丁版本继续递增，例如 `0.1.6 -> 0.1.7`。
4. 重新打包并发布新的 Release。

这样客户端的版本判断和自动更新记录最清晰。

## 每次发布的最短检查清单

```text
[ ] 关闭正在运行的软件和服务
[ ] 检查 git status 和敏感文件
[ ] npm version patch --no-git-tag-version
[ ] npm run verify:release
[ ] npm run weixin:electron:dist
[ ] 确认 exe、blockmap、latest.yml
[ ] git add -A 并再次检查暂存文件
[ ] git commit -m "release: vX.X.X"
[ ] git tag vX.X.X
[ ] git push gouyu main
[ ] git push gouyu vX.X.X
[ ] 创建 GitHub Release
[ ] 上传 exe、blockmap、latest.yml
[ ] 测试安装和软件内检查更新
```
