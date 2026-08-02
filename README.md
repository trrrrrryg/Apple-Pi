<div align="center">
  <img src="app/renderer/assets/app-icon-rounded.png" alt="Apple Pi" width="88">
  <h1>Apple Pi</h1>
  <p><strong>把项目上下文、执行计划、工具调用和权限边界放进同一个 Windows 桌面工作区。</strong></p>
  <p>基于开源 <a href="https://github.com/earendil-works/pi">Pi Agent</a> 构建的 Windows 桌面端 AI 编程 Agent。</p>
  <p>
    <strong>Windows 10/11 x64</strong> &nbsp;·&nbsp;
    <strong>Electron + Pi SDK</strong> &nbsp;·&nbsp;
    <strong>当前版本 1.4.4</strong>
  </p>
  <p>
    <a href="https://github.com/trrrrrryg/Apple-Pi/releases/latest">下载最新安装包</a>
    &nbsp;·&nbsp;
    <a href="#为什么是-apple-pi">为什么是 Apple Pi</a>
    &nbsp;·&nbsp;
    <a href="#从源码运行">从源码运行</a>
  </p>
</div>

<br>

![Apple Pi：从任务到计划的桌面工作流](docs/github-assets/apple-pi-workflow.gif)

<p align="center"><sub>演示来自隔离实例：任务先生成可审阅计划，再由策略和执行权限决定下一步。没有包含项目文件、会话、目录或凭证。<a href="docs/github-assets/apple-pi-workflow.mp4">下载带音轨的高清 MP4</a></sub></p>

## 为什么是 Apple Pi？

很多 Agent 软件首先是一个“能和模型聊天、也能调用工具”的入口。Apple Pi 更关注把它放回持续开发的实际工作流：**当前任务属于哪个项目、计划是否已经确认、Agent 现在能做什么、做过什么**，都应在同一个桌面窗口内看得见。

这意味着它并不把“生成代码”看成单次回答，而是把一项开发工作拆成可追溯的上下文、可审阅的计划、受权限约束的执行，以及可以回到现场的工具过程。

![Apple Pi 完整主界面：任务、计划卡片、项目侧栏和执行控件同时可见](docs/github-assets/apple-pi-main.png)

### Pi Agent 相比常见 Agent 工具的优势

Pi Agent 的核心竞争力不是把所有功能预装进一个固定界面，而是把自己定位为一个 **minimal agent harness（最小 Agent 运行底座）**：开发者可以用 TypeScript 扩展、Skill、提示词模板、主题和 npm/Git 包改造工作流；同时可在命令行、JSON/Print、RPC 与 SDK 方式中使用同一套核心能力。[Pi 官方产品页](https://pi.dev/) 与 [官方文档](https://pi.dev/docs/latest) 将这种取向概括为“primitives, not features”。

下表将 Pi 与常见的“功能预设较多、工作流更一体化”的 Agent 产品形态进行比较，并不对每一个具体品牌或版本下结论。

| 对比维度 | Pi Agent 的优势 | 常见一体化 Agent 产品形态 | 对开发者的价值 |
| --- | --- | --- | --- |
| 核心定位 | 保持小而稳定的 Agent 内核，优先提供可组合的基础能力 | 将对话、计划、权限或自动化流程预先固化为产品默认路径 | 团队可以在不改造核心 Agent 循环的前提下，按自己的工程流程增加能力 |
| 扩展方式 | 支持 TypeScript 扩展、Skill、模板、主题与可安装包；扩展可接入工具、命令、按键、事件与 TUI | 插件能力和可修改范围随产品而异，部分关键流程由产品本身决定 | 更适合把组织规范、专有工具、提示词和交互约束做成可维护的资产 |
| 模型与提供商 | 官方支持 15+ 提供商、数百个模型、API Key/OAuth 登录、会话中切换，以及自定义提供商和模型定义 | 常以少数预置云模型和固定配置路径为主 | 可在质量、成本、隐私、地区可用性和本地运行之间自主取舍 |
| 上下文工程 | 提供会话树、`AGENTS.md` / `SYSTEM.md`、可定制压缩、按需渐进加载的 Skill 与动态上下文 | 上下文策略通常更偏向产品默认值，细粒度控制程度不一 | 长任务的规则、知识和会话演进可以更贴近实际代码库，而不只依赖一段临时提示词 |
| 接入与自动化 | 同时提供交互式 CLI、Print/JSON、RPC 与 SDK 四种使用方式 | 往往优先服务单一图形界面或单一交互入口 | 同一 Agent 能力既可给人用，也可嵌入脚本、IDE、内部工具和自动化流水线 |

### Apple Pi 补足 Pi Agent 的桌面工作流层

Pi 的极简并非功能缺失的偶然：上游明确选择**不内置** MCP、子 Agent、权限弹窗、计划模式、待办列表和后台 Bash，避免把一种工作流强加给所有用户。[Pi 官方产品页的设计取舍说明](https://pi.dev/) 同时指出，Pi 默认继承启动它的用户进程权限，并不自带文件、进程、网络或凭证的权限系统。[上游仓库的权限与容器说明](https://github.com/earendil-works/pi) 也建议在需要更强隔离时采用容器或操作系统级沙箱。

Apple Pi 不替换 Pi 的模型接口和 Agent 循环，而是在其上将这些可选基础能力做成面向 Windows 开发流程的现成桌面体验：

| Pi 上游有意留给扩展/宿主层的能力 | Apple Pi 的补足 | 实际带来的变化 |
| --- | --- | --- |
| 无内置计划模式与待办列表 | 提供独立的可视化计划列表，以及“仅明确规划 / 智能规划 / 总是规划”三种策略；规划判断与执行权限保持分离 | 长任务可先审阅目标、步骤和验证方式，再决定是否开始改动，而不是把计划埋在一段对话文本中 |
| 无内置权限弹窗或权限系统 | 提供只读、每次确认、自动执行三种持久化执行模式，并在工具执行前进行拦截 | “是否规划”和“能否执行”成为两个可见、可单独控制的决定；**这属于交互与执行控制，不替代容器或系统级沙箱** |
| 无内置 MCP | 提供 MCP/Skill 配置、启停、状态呈现和运行时调用封装 | 需要连接现有工具服务器时，可在桌面设置和当前任务中完成管理，而不必先自行编写 Pi 扩展 |
| 终端优先的基础交互 | 在 Pi 会话能力之上增加项目文件夹归档、非项目对话、任务侧栏和运行状态 | 切换会话或重开应用后，更容易回到对应项目与任务现场 |
| 不预设图形化工作台 | 集成 Git 改动审查、内置浏览器、多页签和当前项目目录中的终端 | 查看结果、审查修改、运行命令与网页验证可保持在同一个任务上下文内 |
| 不预设桌面端的模型配置体验 | 为 OpenAI 兼容厂商、GPT 订阅 OAuth、推理强度、上下文窗口、多模态和本地模型运行时提供图形化配置 | 保留 Pi 的提供商自由度，同时降低 Windows 桌面端首次配置、授权与切换模型的门槛 |

换句话说：**Pi Agent 负责“可扩展、可嵌入、模型开放”的 Agent 内核；Apple Pi 负责把其中需要长期使用和明确控制的部分，组织成可见、可审阅、可操作的 Windows 桌面工作区。**

### 一个完整任务如何流动

1. **从项目或非项目对话开始。** Apple Pi 将会话与当前文件夹关联；不属于某个仓库的研究、方案或临时问题也可以单独保存。
2. **按策略生成计划。** 对复杂任务或明确要求，智能规划会先形成计划列表；你也可以强制每个执行任务都先建立计划。
3. **确认执行边界。** 在只读、每次确认或自动执行等模式间选择。计划存在不代表已经修改文件，执行权限也不会被计划策略隐式改变。
4. **在同一工作台完成实现与验证。** 对话、工具调用、文件操作、网页检查、终端输出和 Git 改动审查保持在同一个任务现场。

![Apple Pi 完整界面中的智能规划菜单：三种计划触发策略可直接查看](docs/github-assets/apple-pi-workbench.png)

<p align="center"><sub>上图是与主界面同一演示任务的真实状态：下方控件展开“仅明确规划 / 智能规划 / 总是规划”。</sub></p>

## 能力概览

| 项目与会话 | 模型与扩展 | 工作台与验证 |
| --- | --- | --- |
| 按项目文件夹归档会话，支持非项目对话、重命名、归档、删除、历史恢复与运行状态。 | 支持内置与自定义 OpenAI 兼容厂商、模型列表读取、推理强度、上下文窗口、多模态、本地模型运行时与 GPT 订阅 OAuth。 | 集成 Git 改动审查、内置浏览器、多浏览器页签，以及在当前项目目录中运行 PowerShell 或命令提示符。 |

### 开发工作流

- 可视化计划列表和上下文压缩；计划策略可设为仅明确规划、智能规划或总是规划。
- 只读、每次确认、自动执行等权限模式；计划生成和执行权限相互独立。
- 流式对话、代码块复制、文件与链接跳转、附件预览、Mermaid 图表渲染与图片导出。
- 对话与工具调用分层展示，便于查看终端、联网搜索和文件操作状态。

### MCP 与 Skill

- 首次启动时可检测并导入已有 Agent 的 MCP 与 Skill 配置。
- 可在设置中启停扩展；输入时可提示、选择并高亮已启用的 MCP 或 Skill。
- 输入框旁的 MCP 列表可快速查看服务器状态并控制启用开关。

### 本地与联网能力

- 自动检测 Ollama、LM Studio 和 llama.cpp。
- 联网搜索默认支持免费模式，也可在设置中配置个人 Tavily Key。
- 支持亮暗主题、中文界面、应用内更新与 Windows 桌面安装包分发。

## 开源基础

Apple Pi 基于开源 [Pi Agent](https://github.com/earendil-works/pi) 开发，并使用其 `@earendil-works/pi-*` 软件包提供的模型接口、Agent 循环与编程 Agent 能力。Apple Pi 在此基础上实现 Windows 桌面应用、项目与会话管理、图形界面、工作台、MCP/Skill 配置及更新分发等功能。

Pi Agent 是独立的开源项目；Apple Pi 并非 Pi Agent 官方产品，也不代表上游项目立场。

## 开始使用

1. 前往 [Releases](https://github.com/trrrrrryg/Apple-Pi/releases/latest) 下载并安装最新的 Windows 安装包。
2. 启动应用，在“设置 → 模型”配置支持的模型厂商、GPT 订阅 OAuth，或连接本地模型运行时。
3. 在输入框上方选择项目文件夹，或直接创建非项目对话；按任务需要选择规划策略和执行权限。

> 安装包适用于 Windows 10/11 x64。API Key 和 OAuth 凭证仅保存在本机受控存储中，不会写入仓库。

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
