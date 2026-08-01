# Apple Pi

Apple Pi 是一个面向 Windows 的桌面端 AI 编程 Agent。它以 Electron 为桌面壳，基于 Pi SDK 驱动模型对话、项目文件操作、终端、MCP、Skill、联网搜索与改动审查，并提供适合持续开发任务的项目和会话管理体验。

## 下载

最新安装包请前往 [Releases](https://github.com/trrrrrryg/Apple-Pi/releases/latest) 下载。当前发布版本为 `1.4.2`。

> Windows 10/11 x64。安装后在模型设置中配置任意已支持厂商的 API Key，或接入本地模型运行时，即可开始使用。

## 功能概览

- **项目与会话**：按项目文件夹归档对话，支持非项目对话、重命名、归档、删除、历史恢复和任务状态。
- **多模型配置**：内置与自定义 OpenAI 兼容厂商，支持模型列表读取、启用控制、推理强度、上下文窗口与多模态开关。
- **开发工作流**：提供只读、计划、每次确认、自动执行等权限模式，支持工具调用确认、计划列表、上下文压缩和文件链接跳转。
- **工作台**：集成 Git 改动审查、内置浏览器、多浏览器页签，以及在当前项目目录执行命令的 PowerShell / 命令提示符终端。
- **扩展能力**：支持导入、启停和查看 MCP 与 Skill；输入框可提示已启用的扩展。
- **内容体验**：流式对话、代码块复制、Mermaid 图表渲染与图片导出、附件预览、亮暗主题和应用内更新。
- **本地与联网**：可检测 Ollama、LM Studio、llama.cpp；联网搜索默认可使用免费模式，也可配置个人 Tavily Key。

## 截图

![Apple Pi 1.4.2 主界面](app/scripts/apple-pi-1.4.2-main.png)

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

## 配置模型

启动后从“设置 → 模型”配置模型厂商。应用不会将 API Key 写入仓库；凭证仅保存在本机受控存储中。自定义厂商使用 OpenAI 兼容接口时，填写 Base URL、API Key 和模型 ID 即可。

## 开发与测试

```powershell
Set-Location .\app
npm test                 # 单元测试
npm run dist             # 生成 Windows NSIS 安装包
```

构建产物位于 `app/dist/`，不会提交到 Git。正式安装包通过 GitHub Releases 和应用内更新服务分发。

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

## 发布

发布新版本时修改 `app/package.json` 的版本号，执行 `npm run dist`，并在 GitHub Release 中上传 `苹果Pi Setup <version>.exe`。应用内更新服务的部署和发布顺序见 [更新服务器部署说明](docs/更新服务器部署说明.md)。

## 安全说明

- 不要提交 API Key、OAuth Token、`.env`、会话数据或个人项目文件。
- Agent 的工具执行应根据任务选择合适的执行权限模式。
- 第三方模型、MCP、Skill 和字体资源分别遵循其自身许可证与服务条款。

## 许可证

本项目当前未指定开源许可证。使用、分发或二次开发前，请先联系仓库维护者确认授权范围。
