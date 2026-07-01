# CodexBridge Weixin Admin

CodexBridge Weixin Admin 是一个面向 Windows 的微信 Bot 桥接与本地管理工具。它可以把微信里的消息转发给本机的 Codex / CodexBridge 服务处理，再把最终结果发回微信，同时提供一个本地桌面管理面板，用来管理账号、会话、日志、模型配置、二维码和运行状态。

这个版本主要围绕“微信 + Codex + 本地管理面板”的个人使用场景整理和打包，适合把自己的模型能力接入微信，也可以生成朋友入口，让朋友扫码后使用。

> 手机端使用 Codex 的完整教程请看：[手机使用 Codex 详细文档](./docs/usage/phone-codex-guide.md)

## 主要功能

- 微信消息接入 Codex，并把最终回复发回微信
- Windows 桌面管理面板，双击安装后即可启动
- 首次启动配置向导，可填写 API key、接口地址、模型和供应商预设
- 支持 OpenAI 兼容接口、Z Token、Claude Code、DeepSeek、Qwen、OpenRouter、Kimi、Gemini、MiniMax、iFlow 等预设
- 支持 CCSwitch 同步配置，也支持手动填写 API key
- 支持微信登录二维码和朋友入口二维码
- 支持多账号管理、主账号切换、授权、禁用和撤销
- 支持会话列表、会话搜索、按名称打开会话、重命名、归档和删除
- 支持图片/文件暂存，多张图片可先缓存，发送提示词后统一提交
- 支持消息去重、停止、重试、追加提示、只发送最终答案
- 支持单会话排队、多用户并发、附件后台处理和并发上限
- 支持服务状态、日志、最近错误、运行监控和一键诊断
- 支持配置和历史数据导出备份
- 支持 GitHub Release 检查更新

## 下载和安装

到 GitHub Release 页面下载 Windows 安装包：

[CodexBridge Weixin Admin v0.1.0](https://github.com/gouyu-hou/CodexBridge-Weixin/releases/tag/v0.1.0)

普通用户只需要下载：

```text
CodexBridge-Weixin-Admin-Setup-0.1.0.exe
```

不需要下载源码压缩包，也不需要下载 `win-unpacked` 目录。

安装包已经内置运行所需的 Electron 应用和 Node.js 运行时，普通用户不需要额外安装 Node.js、npm、pnpm、tsx 或开发工具。

首次使用仍然需要准备：

- 可用的 API key
- 正确的 Base URL / 接口地址
- 正确的模型名称
- 可以联网的 Windows 10 / Windows 11 电脑
- 可用于扫码绑定的微信入口

## 快速开始

1. 下载并安装 `CodexBridge-Weixin-Admin-Setup-0.1.0.exe`
2. 启动 `CodexBridge Weixin Admin`
3. 首次启动时填写模型配置
4. 在管理面板生成微信登录二维码或朋友入口二维码
5. 使用微信扫码并确认绑定
6. 在微信里发送消息，等待 Codex 返回最终结果

如果服务未启动，可以重新打开桌面应用。管理面板里可以查看服务状态、最近错误、运行日志和诊断结果。

## 首次配置说明

首次启动配置页里最重要的是这几项：

```text
供应商预设
供应商名称
API key
Base URL / 接口地址
模型
```

其中真正决定能不能请求成功的是：

```text
API key
Base URL / 接口地址
模型
```

“供应商预设”只是帮助你快速填入常见默认值。如果预设选错，但 API key、Base URL 和模型是正确的，也可能仍然能用；如果预设导致 Base URL 或模型填错，就可能出现 401、404、429、502、503、初始化超时等问题。

### Z Token

如果你使用中转站，可以点击这里获取接口信息：

[ztoken.app](https://ztoken.app/register?aff=8M7CSMLY5J77)

常见填写方式：

```text
供应商预设：OpenAI 兼容 或 Claude Code
API key：Z Token 后台生成的 key
Base URL：Z Token 后台提供的接口地址
模型：Z Token 支持的模型名
```

### DeepSeek

DeepSeek 属于 OpenAI-Compatible 兼容接口，常见填写方式：

```text
供应商预设：DeepSeek
API key：你的 DeepSeek API key
Base URL：https://api.deepseek.com
模型：deepseek-chat 或 deepseek-reasoner
```

### Claude Code

如果你的接口平台提供 Claude / Claude Code 兼容模型，可以选择：

```text
供应商预设：Claude Code
供应商名称：Claude Code
模型：claude-sonnet-4-20250514
```

具体 Base URL 和 API key 以你的接口平台为准。如果使用 Z Token，就填写 Z Token 提供的接口地址和 key。

### CCSwitch

如果电脑上已经安装并配置了 CCSwitch，可以在首次配置页或管理面板点击“同步 CCSwitch”。软件会尝试读取本机 Codex / CCSwitch 相关配置，并自动填入可识别的 provider、Base URL、模型和 API key。

如果没有 CCSwitch，也可以完全手动填写，不影响使用。

## Codex 使用说明

这个工具的核心作用是：让你可以在微信里把任务发给电脑上的 Codex，让 Codex 读取项目、解释代码、修改文件、运行检查命令，并把最终结果回到微信。

### 基本使用流程

1. 在电脑上启动 `CodexBridge Weixin Admin`
2. 确认服务状态正常
3. 在管理面板里设置工作目录，也就是你希望 Codex 操作的项目目录
4. 在微信里发送需求
5. Codex 在电脑上处理任务
6. 处理完成后，微信收到最终结果

如果你想让 Codex 操作某个项目，建议先把工作目录设置为那个项目的根目录。例如：

```text
D:\IT_learn\codex_weixin\CodexBridge
```

这样 Codex 才能读取对应项目里的源码、文档、配置和测试文件。

### 适合让 Codex 做什么

```text
解释项目结构
阅读某个文件或模块
修复 bug
新增功能
修改 README / 文档
运行类型检查或测试
分析报错日志
整理发布说明
生成 Git 提交说明
检查哪些文件不应该上传 GitHub
```

例如可以在微信里发送：

```text
请读取当前项目结构，告诉我这个项目主要由哪些模块组成。
```

```text
请检查为什么启动服务时报 503，只分析原因，先不要修改代码。
```

```text
请帮我修复管理面板里清理日志按钮无效的问题，修复后运行检查。
```

```text
请在 README 里补充 DeepSeek API key 的配置教程，并推送到 GitHub。
```

### 文件修改和命令执行

Codex 可以在你的电脑上读取和修改项目文件，也可以运行命令，例如：

```text
npm run typecheck
npm run weixin:electron:dist
git status
```

建议你给任务时说明清楚是否允许修改：

```text
先不要改代码，只帮我找出问题。
```

```text
可以直接修改，修好后帮我测试。
```

```text
修改完之后帮我提交并推送到 GitHub。
```

涉及删除文件、覆盖发布版本、重写 Git 历史、强制推送等操作时，要格外谨慎。建议明确说明你允许 Codex 执行这些操作。

### 图片和报错截图

你可以在微信里发截图，让 Codex 根据截图分析问题。更推荐同时补充文字说明，例如：

```text
这是管理面板的报错截图，请帮我判断是什么原因，先不要改代码。
```

如果是命令行报错，最好直接复制完整报错文本发送。截图能看界面，文本更方便 Codex 精确定位。

### 使用建议

- 一个任务尽量说清楚目标、现象和期望结果
- 如果只是咨询，写明“先不要改”
- 如果允许修改，写明“可以直接改”
- 如果要发布，写明是否需要打包、提交、推送和上传 Release
- 长任务建议使用单独的新会话，避免上下文太乱
- 重要项目建议先备份或确认 Git 工作区状态

### 常见任务示例

```text
请帮我检查这个项目为什么启动失败，先不要修改代码，只告诉我原因。
```

```text
请帮我新增一个管理面板按钮，用来复制当前日志内容，完成后运行类型检查。
```

```text
请帮我把项目重新打包成 exe，但不要升级版本号。
```

```text
请帮我把本次改动提交到 GitHub，提交信息用中文概括。
```

```text
请帮我看一下当前 Git 状态，哪些文件是我应该提交的，哪些不应该提交。
```

## 微信常用命令

```text
/new        新会话
/stop       停止当前回复
/retry      重试上一条
/reconnect  刷新连接
/model      查看或修改模型
/provider   查看或修改供应商
/up         开启上传模式，连续上传文件/图片后再统一提交
/up status  查看已暂存的上传文件
/up cancel  取消上传模式
/rename this name    给当前会话改名为 name
/search name         搜索名字里包含 name 的历史会话
/open name           直接切换到名为 name 的会话
/status     查看当前会话
/threads    查看历史会话列表
/next       历史会话下一页
/prev       历史会话上一页
/compact    压缩上下文
```

更多手机端命令和使用示例请看：

- [手机使用 Codex 详细文档](./docs/usage/phone-codex-guide.md)
- [微信斜杠命令说明](./docs/usage/weixin-slash-commands.md)

## 管理面板

管理面板主要用于：

- 查看服务是否运行
- 启动和停止微信桥接服务
- 生成微信登录二维码
- 生成朋友入口二维码
- 管理已扫码用户
- 切换主账号
- 查看会话列表
- 搜索、打开、重命名、归档和删除会话
- 查看运行日志和最近错误
- 清理日志、复制日志
- 配置 API key、Base URL、模型和供应商
- 导出和备份配置与历史数据
- 检查软件更新
- 运行一键诊断

如果遇到 502、503、429、初始化超时、端口冲突、朋友扫码无法连接等问题，优先打开管理面板里的诊断功能查看原因。

## 多人使用说明

这个项目可以生成朋友入口二维码，让朋友扫码使用。朋友和 Bot 的会话会通过你的本地服务处理，因此需要你的电脑保持开机、联网，并且服务处于运行状态。

需要注意：

- 朋友使用时会消耗你配置的 API key 额度
- 朋友会话数据保存在你的本地数据目录
- 你可以在管理面板里管理授权账号
- 如果你的电脑关机、断网或服务停止，朋友也无法继续使用

## 图片和文件

支持在微信里发送图片和文件。

常见用法：

1. 发送 `/up` 开启上传模式
2. 连续发送多张图片或多个文件
3. 发送文字提示词
4. 软件把暂存的图片/文件和提示词一起提交给模型

如果不想继续上传，可以发送：

```text
/up cancel
```

查看暂存内容：

```text
/up status
```

## 数据目录

运行数据通常保存在你选择或程序配置的数据目录中，例如：

```text
CodexBridgeData
```

这里可能包含：

- 微信账号绑定状态
- 用户授权信息
- 会话索引和会话配置
- 运行日志
- 最近错误
- 上传暂存文件
- 本地模型供应商配置

这些数据不应该提交到 GitHub。仓库已经通过 `.gitignore` 排除了运行数据、真实配置、日志、打包目录和依赖目录。

## 自动更新

软件支持通过 GitHub Release 检查更新。自动更新依赖 Release 里的三个文件：

```text
CodexBridge-Weixin-Admin-Setup-x.x.x.exe
CodexBridge-Weixin-Admin-Setup-x.x.x.exe.blockmap
latest.yml
```

如果以后发布新版本，建议按版本号递增：

```text
0.1.1
0.1.2
0.1.3
```

不要长期覆盖同一个版本号，否则用户端可能无法准确判断是否需要更新。

## 从源码运行

开发者可以从源码运行：

```powershell
npm install
npm run typecheck
npm run weixin:electron
```

打包 Windows 安装包：

```powershell
npm run weixin:electron:dist
```

打包产物会输出到：

```text
release/
```

`release/` 目录不提交到 Git，只适合作为 GitHub Release 附件上传。

## 项目结构

```text
assets/       图标和 Windows 桌面资源
config/       配置示例
docs/         使用文档和说明
packages/     Codex provider / gateway 等扩展包
scripts/      Electron、服务启动、安装和诊断脚本
src/          核心源码
test/         测试代码
```

## 常见问题

### 安装后为什么占用接近 1GB？

安装包是压缩后的，安装后会解压出 Electron、Node.js、Codex 相关依赖和运行文件。当前版本已经排除了部分非 Windows x64 平台文件，但为了保持“用户双击安装就能用”，仍然会内置必要运行环境。

### 为什么微信没有回复？

可以按顺序检查：

- 管理面板服务是否运行
- 微信账号是否已绑定
- API key 是否有效
- Base URL 是否正确
- 模型名称是否正确
- 网络是否正常
- 是否出现 429、502、503 等上游错误
- 是否有一轮回复正在进行中

### 502 / 503 是代码问题吗？

不一定。很多 502 / 503 是上游模型服务或网络代理临时不可用。可以稍后重试，或切换 provider / Base URL。

### 429 是什么？

429 通常表示额度不足、请求过快或接口限流。需要检查 API key 余额、套餐限制或中转站限流规则。

### 朋友可以直接扫码用吗？

可以，但前提是你的电脑服务正在运行，并且朋友账号已通过入口二维码完成授权。朋友使用会消耗你配置的 API key 额度。

### Mac 可以用吗？

当前安装包主要面向 Windows。源码理论上可以迁移到其他平台，但微信桥接、Electron 打包、内置运行时和部分路径逻辑目前主要按 Windows 使用场景整理。

## 安全提醒

- 不要把真实 API key 上传到 GitHub
- 不要提交 `weixin.service.env`
- 不要提交 `CodexBridgeData/`
- 不要提交 `release/`
- 不要提交 `node_modules/`
- 给朋友使用时，建议让对方填写自己的 API key，或者明确说明会消耗你的额度

## 来源说明

本项目基于 [Gan-Xing/CodexBridge](https://github.com/Gan-Xing/CodexBridge) 的代码基础进行个人化改造，当前版本聚焦微信接入、桌面管理面板和 Windows 安装包体验。

更多说明请看：[NOTICE.md](./NOTICE.md)
