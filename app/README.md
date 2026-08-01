# Pi Desktop Agent（方案 A：Electron + SDK 直嵌）

基于 `@earendil-works/pi-coding-agent` SDK 的类 Codex 桌面端 Coding Agent 最小可运行 Demo。

## 功能

- 💬 对话式交互 + 流式输出（text_delta 打字机效果）
- 💭 thinking/推理过程折叠块展示（thinking_delta）
- 🔧 工具调用卡片（bash/read/edit/write…，running/done/error 状态 + 结果）
- ⛔ 中止 / ▶ 继续 / ＋ 新会话
- 📊 顶栏状态：当前模型 / streaming 状态 / 消息数
- 🔐 密钥只在主进程，渲染进程通过 contextBridge 受控访问

## 运行

```bash
npm install

# 首次：下载 Electron 二进制（国内镜像）
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
node node_modules/electron/install.js

npm start          # 启动 GUI
```

> 需要至少一个 LLM Provider 的凭证（环境变量如 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / DeepSeek 等，
> 或 `~/.pi/agent/` 下的登录态）。本 Demo 在已配置 DeepSeek 凭证的环境实测通过。

## 测试

```bash
node scripts/smoke.mjs        # 无头冒烟：SDK 会话/订阅/状态
node scripts/e2e-gui.mjs      # E2E：真实窗口发 prompt，断言 DOM + 截图(scripts/e2e-screenshot.png)
```

## 架构

```
渲染进程 (renderer/)  ←─ IPC (contextBridge) ─→  主进程 (main/)
  对话气泡/工具卡片         window.piAgent          AgentService
                                                   └─ createAgentSession (pi SDK)
                                                        ├─ pi-coding-agent (会话/内置工具)
                                                        ├─ pi-agent-core   (Agent 循环/事件流)
                                                        └─ pi-ai           (30+ Provider/密钥)
```

详见 `../docs/技术文档.md` 第 7、8、10 章。

## 后续路线（对应技术文档第 8 章 Codex 功能映射）

- [ ] diff 视图（Monaco DiffEditor 渲染 edit/write 变更）
- [ ] 高危命令审批弹窗（beforeToolCall 钩子 + IPC 确认）
- [ ] 会话列表 / 分支树 UI
- [ ] 模型选择器
- [ ] `@` 引用文件 / 拖拽文件
- [ ] Token/成本状态栏
- [ ] electron-builder 打包分发
