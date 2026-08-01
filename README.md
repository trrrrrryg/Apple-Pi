<div align="center">
  <img src="app/renderer/assets/app-icon-rounded.png" alt="Apple Pi" width="88">
  <h1>Apple Pi</h1>
  <p>基于开源 <a href="https://github.com/earendil-works/pi">Pi Agent</a> 构建的 Windows 桌面端 AI 编程 Agent。</p>
  <p>
    <strong>Windows 10/11 x64</strong> &nbsp;·&nbsp;
    <strong>Electron + Pi SDK</strong> &nbsp;·&nbsp;
    <strong>当前版本 1.4.2</strong>
  </p>
  <p>
    <a href="https://github.com/trrrrrryg/Apple-Pi/releases/latest">下载最新安装包</a>
    &nbsp;·&nbsp;
    <a href="#从源码运行">从源码运行</a>
    &nbsp;·&nbsp;
    <a href="#功能">查看功能</a>
  </p>
</div>

<br>

![Apple Pi 操作演示](docs/github-assets/apple-pi-workflow.gif)

<p align="center"><sub>演示使用隔离实例，不包含项目、会话、目录或凭证。<a href="docs/github-assets/apple-pi-workflow.mp4">下载高清 MP4</a></sub></p>

## 适合持续开发的桌面工作区

Apple Pi 将项目文件夹、会话、模型、工具调用和工作台能力放在同一个桌面应用中。选择项目后，对话默认在对应文件夹内进行；需要审查改动、打开网页或运行项目命令时，不必离开当前工作区。

## 开源基础

Apple Pi 基于开源 [Pi Agent](https://github.com/earendil-works/pi) 开发，并使用其 `@earendil-works/pi-*` 软件包提供的模型接口、Agent 循环与编程 Agent 能力。Apple Pi 在此基础上实现 Windows 桌面应用、项目与会话管理、图形界面、工作台、MCP/Skill 配置及更新分发等功能。

Pi Agent 是独立的开源项目；Apple Pi 并非 Pi Agent 官方产品，也不代表上游项目立场。

| 项目与对话 | 模型与扩展 | 工作台 |
| --- | --- | --- |
| 按项目文件夹归档会话，支持非项目对话、重命名、归档、删除、历史恢复与运行状态。 | 支持内置与自定义 OpenAI 兼容厂商，模型列表读取、推理强度、上下文窗口、多模态与本地模型运行时。 | 集成 Git 改动审查、内置浏览器、多浏览器页签，以及在当前项目目录中运行 PowerShell 或命令提示符。 |

![Apple Pi 主界面](docs/github-assets/apple-pi-main.png)

## 功能

### 开发工作流

- 只读、每次确认、自动执行等权限模式；可视化计划列表与上下文压缩。
- 流式对话、代码块复制、文件与链接跳转、附件预览、Mermaid 图表渲染与图片导出。
- 对话与工具调用分层展示，便于查看终端、联网搜索和文件操作状态。

### MCP 与 Skill

- 首次启动时可检测并导入已有 Agent 的 MCP 与 Skill 配置。
- 可在设置中启停扩展；输入时可提示、选择并高亮已启用的 MCP 或 Skill。
- 输入框旁的 MCP 列表可快速查看服务器状态并控制启用开关。

### 本地与联网能力

- 自动检测 Ollama、LM Studio 和 llama.cpp。
- 联网搜索默认支持免费模式，也可在设置中配置个人 Tavily Key。
- 支持亮暗主题、应用内更新、中文界面与 Windows 桌面安装包分发。

## 开始使用

1. 前往 [Releases](https://github.com/trrrrrryg/Apple-Pi/releases/latest) 下载并安装最新的 Windows 安装包。
2. 启动应用，在“设置 → 模型”配置支持的模型厂商，或连接本地模型运行时。
3. 在输入框上方选择项目文件夹，或直接创建非项目对话。

> 安装包适用于 Windows 10/11 x64。API Key 仅保存在本机受控存储中，不会写入仓库。

## 从源码运行

### 环境

- Windows 10/11
- Node.js 22 或更高版本
- npm

### 安装与启动

```powershell
git clone https://github.com/trrrrrryg/Apple-Pi.git
Set-Location .\Apple-Pi\app
npm ci
npm start
```

也可以在 Windows 下双击根目录的 `run.bat`，它会检查依赖并启动开发版本。

## 开发与测试

```powershell
Set-Location .\app
npm test                 # 单元测试
npm run dist             # 生成 Windows NSIS 安装包
```

构建产物位于 `app/dist/`，不会提交到 Git。正式安装包通过 GitHub Releases 和应用内更新服务分发。发布与更新服务的部署顺序见 [更新服务器部署说明](docs/更新服务器部署说明.md)。

## 项目结构

```text
Apple-Pi/
├─ app/
│  ├─ main/        # Electron 主进程、Pi Agent、更新与本地服务
│  ├─ preload/     # 安全 IPC 桥接层
│  ├─ renderer/    # 对话、设置和工作台界面
│  ├─ scripts/     # 测试、截图和服务器维护脚本
│  └─ test/        # 回归测试
├─ docs/           # 技术、需求、更新部署与设计文档
├─ 软件设计图/       # UI 与图标设计资源
└─ run.bat         # Windows 开发启动脚本
```

## 安全与许可证

- 不要提交 API Key、OAuth Token、`.env`、会话数据或个人项目文件。
- Agent 的工具执行应按任务选择合适的执行权限模式。
- 第三方模型、MCP、Skill 和字体资源分别遵循其自身许可证与服务条款。

本项目当前未指定开源许可证。使用、分发或二次开发前，请先联系仓库维护者确认授权范围。
