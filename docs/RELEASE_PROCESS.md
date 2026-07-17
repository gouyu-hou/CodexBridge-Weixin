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

## 自动化发布（推荐）

发布脚本会执行本文档后续的固定流程，并在任何门禁失败时立即停止。
运行前需要安装 Node.js、npm、Git 和 GitHub CLI，并确保 GitHub 凭据可用。

先从 UTF-8 模板创建本次发布说明：

```powershell
$Version = '0.1.7'
Copy-Item 'docs/releases/RELEASE_NOTES_TEMPLATE.md' "docs/releases/v$Version.md"
```

编辑 `docs/releases/v0.1.7.md`，替换版本号和更新内容。发布说明会直接通过
`gh release create --notes-file` 读取，不经过 PowerShell 文本管道，因此不会
把中文转换成 `????`。说明文件必须位于仓库内、不能被 Git 忽略，并且会单独
执行敏感信息扫描。

先执行 dry-run：

```powershell
npm run release -- --version 0.1.7 --dry-run
```

dry-run 会：

- 检查 `main`、`gouyu`、Tag、冲突、敏感路径和凭据模式
- 将 `package.json` 与 `package-lock.json` 更新到目标版本
- 执行 `npm run verify:release`
- 生成并校验安装包、blockmap 和 `latest.yml`
- 使用隔离临时状态目录运行打包应用冒烟测试
- 再次审计待发布文件

dry-run **不会**暂存、提交、创建 Tag、推送或创建 GitHub Release。版本更新和
其他源码修改会保留在当前工作区，供人工检查。

确认 dry-run 结果和改动后执行正式发布：

```powershell
npm run release -- --version 0.1.7 --publish
```

publish 会重新执行全部 dry-run 门禁，然后继续：

- `git add -A` 并重新检查暂存内容
- 创建唯一提交 `release: v0.1.7` 和 Tag `v0.1.7`
- 在任何提交前检查 GitHub 登录、仓库写权限和同名 Release 冲突
- 使用一次 `git push --atomic` 只向 `gouyu` 推送 `main` 和 Tag，绝不推送 `origin`
- 创建 Draft GitHub Release，并在公开前核对远端正文、资产状态、大小、SHA-256
  和下载后的 `latest.yml`
- Draft 全部核验通过后才公开，公开后再次确认正文和 Release 状态
- 确认发布后的本地工作区干净

如果正式发布在原子推送成功后因网络或 GitHub API 中断，使用记录的恢复状态
继续，不要再次执行 `--publish`：

```powershell
npm run release -- --version 0.1.7 --resume
```

`--resume` 会验证本地和远端 Commit/Tag、发布说明以及三个资产的摘要。已有
Draft 中只有缺失资产会被补传；已有资产大小或 SHA-256 不一致时会立即停止，
不会覆盖或使用 `--clobber`。Draft 正文和全部资产核验通过后才会公开 Release。
如果本地原始打包资产已经丢失或被修改，应先人工恢复原始 `release/` 目录，
不要让脚本静默重新生成并替换已记录的资产。

CI 会在 Ubuntu 和 Windows 上执行 `npm ci`，使用 Web 独立 lockfile 安装
`apps/web` 依赖，然后执行完整 `verify:release`。Windows
还会生成安装包并运行打包应用冒烟测试；CI 不创建 Tag、不推送 Git，也不发布
GitHub Release。

查看命令帮助不会修改仓库：

```powershell
npm run release -- --help
```

失败恢复规则：

- 原子推送前或推送失败时，脚本只撤销自己创建的发布提交和 Tag，所有源码改动
  会保留在工作区，可以修复问题后重新执行。
- 原子推送成功后不执行 force-push 或远端回滚。如果后续 Draft 上传或核验失败，
  脚本会将失败步骤记录到 `.git/codexbridge-release-recovery.json`。此时不要直接
  重跑发布命令，应先检查远端 Tag/Draft，再从本文档的手动流程对应步骤继续。
- 完整发布并通过最终核验后，恢复状态文件会自动删除。

如果自动化脚本因环境问题无法使用，再按本文档后续章节执行手动回退流程。

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

只有命令完整退出且返回码为 `0` 后才能继续。该脚本会依次验证根项目与 Web 控制台，
再验证 Gateway、Provider Relay、Native API 和 Mission Control 的边界、类型、测试
与构建，并在最后执行 `git diff --check`。Web 控制台会执行 TypeScript 检查和 Next.js
生产构建；首次运行前需要先执行 `pnpm --dir apps/web install --frozen-lockfile`。

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

### 轻量更新签名配置

轻量更新包包含可执行 TypeScript，发布时必须使用 Ed25519 私钥生成 schema-v2
签名清单。未签名、旧 schema 或无效签名的轻量更新包都会被客户端拒绝；这不会
影响标准 NSIS / electron-updater 完整安装包更新。

首次配置时，在仓库外的受控目录生成密钥对：

```powershell
$KeyDir = Join-Path $env:USERPROFILE '.codexbridge-keys'
New-Item -ItemType Directory -Force $KeyDir | Out-Null
openssl genpkey -algorithm ED25519 -out (Join-Path $KeyDir 'lightweight-private.pem')
openssl pkey -in (Join-Path $KeyDir 'lightweight-private.pem') -pubout -out (Join-Path $KeyDir 'lightweight-public.pem')
```

私钥不得提交到 Git、放入 Release 附件、写入日志或复制到应用资源目录。发布机
只通过以下环境变量向构建器提供仓库外的私钥文件：

```powershell
$env:CODEXBRIDGE_LIGHTWEIGHT_SIGNING_PRIVATE_KEY_FILE = Join-Path $env:USERPROFILE '.codexbridge-keys\lightweight-private.pem'
$env:CODEXBRIDGE_LIGHTWEIGHT_BASE_APP_VERSION = '0.1.6'
npm run weixin:electron:lightweight
```

`CODEXBRIDGE_LIGHTWEIGHT_BASE_APP_VERSION` 是该轻量包允许覆盖的内置安装版本，
客户端要求精确匹配。只有确认新源码不需要新增或变更 `node_modules` 依赖时，才把
它设置为用户当前安装的旧版本；未设置时默认等于本次 `package.json` 版本。
清单版本必须与 Release 轻量 ZIP 文件名一致并高于客户端当前版本。

构建器会拒绝仓库内的私钥路径和打包输入中的符号链接。即使本地测试密钥没有
提交到 Git，也不要把它暂存在 `assets/`、`config/`、`scripts/` 或其他仓库目录。

构建器会生成 `release/lightweight/CodexBridge-Lightweight-X.X.X.zip`。该 ZIP 可以
作为可选附件上传到同版本 GitHub Release；现有一键发布脚本只处理标准安装包的
三个必需资产，不会自动上传这个可选 ZIP。

验证公钥可以通过下列位置之一提供，优先级从高到低：

1. `CODEXBRIDGE_LIGHTWEIGHT_UPDATE_PUBLIC_KEYS`（JSON 公钥环或单个 PEM）
2. `CODEXBRIDGE_LIGHTWEIGHT_UPDATE_PUBLIC_KEY`（兼容旧版单公钥 PEM）
3. `CODEXBRIDGE_LIGHTWEIGHT_UPDATE_PUBLIC_KEY_FILE`（PEM 或 JSON 公钥环）
4. `assets/update/lightweight-public-keys.json`
5. `assets/update/lightweight-public-key.pem`（兼容旧版回退）

公钥环格式如下：
```json
{
  "schemaVersion": 1,
  "keys": [
    { "keyId": "<sha256-spki>", "publicKey": "-----BEGIN PUBLIC KEY-----..." }
  ]
}
```

正式安装包推荐提交并打包第 4 项公钥环文件；公钥可以进入 Git，私钥不能。没有
可用 Ed25519 公钥时，客户端不会访问远程轻量更新接口，并提示改用完整安装包。
轮换时必须先发布包含新公钥的完整安装包，再使用新私钥签署后续轻量包；旧公钥要
保留到其签署的包超过支持的回滚窗口，之后再通过后续完整安装包移除。客户端会把
脱敏的验签、安装、失败和回滚记录到 `stateDir/updates/history.json`。

客户端还会限制下载为 64 MiB、ZIP 条目为 5,000 个、单文件为 64 MiB、解压后
文件总量为 256 MiB，并拒绝 HTTP、非 GitHub 下载地址、路径穿越、重复路径、
符号链接、额外文件以及任何摘要不一致的内容。Windows 客户端会按实际写入字节
受控解压；其他系统不支持轻量 ZIP 安装时会 fail-closed，可改用已解压目录或完整
安装包。

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
