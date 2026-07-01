# CodexBridge Weixin Admin

手机端使用说明：如果你想用手机微信控制电脑上的 Codex，请先阅读 [手机使用 Codex 详细文档](./docs/usage/phone-codex-guide.md)。这份文档包含绑定微信、手机控制项目、权限审批、图片/文件上传、会话管理、模型切换和常见问题处理。

CodexBridge Weixin Admin 是一个面向 Windows 的微信 Bot 桥接工具。它把微信里的消息转发给本地 Codex/CodexBridge 服务处理，再把最终结果发回微信，同时提供一个本地桌面管理面板，方便管理账号、会话、日志、配置和二维码。

这个版本主要围绕“微信 + Codex + 本地管理面板”使用场景整理和打包，适合个人把自己的模型能力接入微信，也可以生成入口让朋友扫码使用。

## 主要功能

- 微信消息接入 Codex，并把回复发回微信
- Electron 桌面管理面板，双击即可启动
- 首次使用可在管理面板填写 API key、provider 和 model
- 支持微信登录二维码和朋友入口二维码
- 支持多账号管理、主账号切换、授权和撤销
- 支持会话列表、会话搜索、按名称打开会话、重命名、归档和删除
- 支持服务状态、日志、最近错误和运行监控
- 支持消息去重、停止、重试、追加提示和只发送最终答案
- 支持图片/文件暂存，发送提示词后统一提交
- 支持单会话排队、多用户并发、附件后台处理和并发上限
- 支持关键词触发、定时任务、常用模板和自动归档
- 支持导出和备份配置/历史数据

## 下载和安装

在 GitHub Release 页面下载 Windows 安装包：

[CodexBridge Weixin Admin v0.1.0](https://github.com/gouyu-hou/CodexBridge-Weixin/releases/tag/v0.1.0)

下载后双击安装即可。安装包已经包含运行所需的 Electron 应用和 Node.js 运行时，普通用户不需要额外安装 Node.js、npm、pnpm、tsx 或开发工具。

首次使用仍然需要准备：

- 可用的 API key
- provider 配置
- 模型名称
- 可正常联网的 Windows 电脑
- 微信 Bot / iLink Bot 登录或扫码授权

## 快速开始

1. 安装并启动 `CodexBridge Weixin Admin`
2. 在管理面板填写 API key、provider、model 等配置
3. 在管理面板生成微信登录二维码或朋友入口二维码
4. 使用微信扫码并确认
5. 在微信里发送消息，等待 Codex 返回最终结果

如果服务未启动，可以重新打开桌面应用；如果网络或模型服务异常，管理面板会显示状态和最近错误。

## 微信常用命令

```text
/new        新会话
/stop       停止当前回复
/retry      重试上一条
/reconnect  刷新连接
/model      看/改模型
/provider   看/改供应商
/up         开启上传模式，连续上传文件/图片后再统一提交
/up status  查看已暂存的上传文件
/up cancel  取消上传模式
/rename this name    给当前会话改名为“name”
/search name    搜索名字里包含“name”的历史会话
/open name      直接切换到名为“name”的会话
/status     看当前会话
/threads    看历史会话列表
/next       历史会话下一页
/prev       历史会话上一页
/compact    压缩上下文
```

## 本地数据

默认运行数据会放在用户选择或程序配置的数据目录中，例如 `CodexBridgeData`。这里可能包含：

- 微信账号绑定状态
- 会话索引和会话设置
- 日志、指标和最近错误
- 上传暂存文件
- 本地运行配置

这些数据不应该提交到 GitHub。本仓库已经通过 `.gitignore` 排除了运行数据、真实配置、日志、打包目录和依赖目录。

## 从源码运行

如果你是开发者，可以从源码运行：

```powershell
npm install
npm run typecheck
npm run weixin:electron
```

打包 Windows 安装包：

```powershell
npm run weixin:electron:dist
```

打包产物会输出到 `release/` 目录。该目录不会提交到 Git，只适合作为 GitHub Release 附件上传。

## 项目结构

```text
assets/          图标和 Windows 桌面资源
config/          配置示例
docs/            设计文档和使用说明
scripts/         Electron、服务启动、安装和诊断脚本
src/             核心源码
test/            测试代码
packages/        保留的实验性/扩展包
```

## 安全提醒

- 不要把真实 API key 上传到 GitHub
- 不要提交 `weixin.service.env`
- 不要提交 `CodexBridgeData/`
- 不要提交 `release/`、`build/`、`node_modules/`
- 给朋友使用时，建议让对方填写自己的 API key 和模型配置

## 来源说明

本项目基于 Gan-Xing/CodexBridge(https://github.com/Gan-Xing/CodexBridge.git) 的代码基础进行个人化改造，当前版本聚焦于微信接入、桌面管理面板和 Windows 安装包体验。

本仓库保留原项目来源说明。当前代码树和上游引用中未发现独立 `LICENSE` 文件，因此未擅自新增或修改许可证类型。如后续上游补充许可证，应按上游许可证要求继续保留版权和授权说明。

更多说明见 [NOTICE.md](./NOTICE.md)。
