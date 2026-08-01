/**
 * AgentService —— pi SDK 在主进程的封装层
 * 职责：
 *  1. 创建/管理 pi Agent 会话（createAgentSession）
 *  2. 订阅 pi 事件流，通过回调推送给主进程（再由 IPC 广播到渲染进程）
 *  3. 暴露 prompt / abort / continue / 模型切换等控制接口
 *  4. 预留 beforeToolCall 审批钩子（当前 demo 自动放行，可扩展为弹窗确认）
 *
 * 说明：所有 API Key / OAuth token 都只存在于主进程，渲染进程永远接触不到。
 */
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { app, safeStorage, shell } from "electron";
import { createTavilyWebSearchTool } from "./tavily-web-search.js";
import { createMermaidDiagramTool } from "./mermaid-diagram.js";
import { IntegrationService, createSkillTools } from "./integration-service.js";
import { McpRuntime } from "./mcp-runtime.js";
import { createBrowserAutomationTools } from "./browser-automation-tools.js";
import { createPlanTools, isPlanTool } from "./plan-tools.js";
import { detectLocalModelRuntimes } from "./local-model-service.js";
import { resolveProjectFileReference } from "./project-file-resolver.js";
import { extractSessionEvents, historyFromMessages, historyFromSessionEvents } from "./session-history.js";
// AuthStorage 未在包根导出（受 package.json exports 限制），但实体文件存在于 dist。
// 用 file:// 绝对路径动态 import 可绕过 exports 映射直接加载该 ESM 模块。
import path from "node:path";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authStorageUrl = pathToFileURL(
  path.resolve(__dirname, "../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js")
).href;
const resourceLoaderUrl = pathToFileURL(
  path.resolve(__dirname, "../node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js")
).href;
const settingsManagerUrl = pathToFileURL(
  path.resolve(__dirname, "../node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js")
).href;
const piConfigUrl = pathToFileURL(
  path.resolve(__dirname, "../node_modules/@earendil-works/pi-coding-agent/dist/config.js")
).href;
const { AuthStorage } = await import(authStorageUrl);
const { DefaultResourceLoader } = await import(resourceLoaderUrl);
const { SettingsManager } = await import(settingsManagerUrl);
const { getAgentDir } = await import(piConfigUrl);

const IMAGE_MIME_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
]);
const TEXT_FILE_EXTENSIONS = new Set([
  ".txt", ".md", ".mdx", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".ini", ".env", ".csv", ".tsv",
  ".js", ".cjs", ".mjs", ".ts", ".tsx", ".jsx", ".html", ".css", ".scss", ".less", ".vue",
  ".py", ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".go", ".rs", ".php", ".rb", ".swift", ".kt",
  ".sql", ".xml", ".sh", ".bat", ".ps1", ".log", ".properties", ".cfg",
]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const TAVILY_SETTINGS_FILE = "tavily-search.json";
const CUSTOM_PROVIDERS_FILE = "custom-providers.json";
const MODEL_MULTIMODAL_FILE = "model-multimodal.json";
const MODEL_CONTEXT_WINDOWS_FILE = "model-context-windows.json";
const MERMAID_DIAGRAM_SETTINGS_FILE = "mermaid-diagram.json";
const EXECUTION_MODE_SETTINGS_FILE = "execution-mode.json";
const PI_MODEL_DATA_DIR = path.resolve(__dirname, "../node_modules/@earendil-works/pi-ai/dist/providers/data");
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const EXECUTION_MODES = new Set(["read-only", "ask", "auto"]);
const LEGACY_PLAN_EXECUTION_MODE = "plan";
const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "list", "ls", "glob", "web_search", "tavily_search", "create_mermaid_diagram"]);
const WRITE_OR_EXECUTE_TOOL_PATTERN = /(^|[_:-])(write|edit|patch|delete|remove|move|rename|mkdir|exec|bash|shell|terminal|command|install|git|run)([_:-]|$)/i;
const CUSTOM_PROVIDER_APIS = new Set(["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"]);
const DEFAULT_CONTEXT_WINDOW = 256 * 1024;
const LARGE_CONTEXT_WINDOW = 1_000_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 16 * 1024;
const MERMAID_REQUEST_PATTERN = /流程图|架构图|时序图|状态图|关系图|实体关系图|ER\s*图|甘特图|思维导图|用例图|flowchart|architecture\s*diagram|sequence\s*diagram|state\s*diagram|relationship\s*diagram|use\s*case|gantt|mind\s*map/i;
const MERMAID_PROMPT_SUFFIX = "\n\n<pi-mermaid-tool-requirement>这是图表请求。你必须先调用 create_mermaid_diagram 生成图表，不要直接输出 Mermaid 代码块。请选择正确的 diagramType，并提交完整、可渲染的 Mermaid 代码。</pi-mermaid-tool-requirement>";
const MERMAID_CODE_SUFFIX = "\n\n<pi-mermaid-code-requirement>这是图表请求。Mermaid 图表绘制当前已关闭。不要调用 create_mermaid_diagram；请仅输出一个完整的 ```mermaid 代码块，不要将其渲染为图片。</pi-mermaid-code-requirement>";
const DESKTOP_RESPONSE_STYLE_SYSTEM_PROMPT = [
  "<apple-pi-desktop-assistant>",
  "你是苹果Pi桌面应用中的 AI 助手。面向用户时，自称“苹果Pi”或“AI 助手”；不要自称 Pi CLI、Coding Agent、终端 Agent，也不要说自己运行在终端环境中。",
  "你可以在内部使用文件、终端、联网搜索和其他工具完成任务，但这些是桌面应用的后台能力，不应成为最终回复的叙述方式。",
  "最终回复应当自然、清晰、以结果为中心。不要主动罗列工具能力、工具名称、终端命令、命令输出或逐步执行日志，除非用户明确要求这些细节。",
  "默认使用普通自然语言段落，不使用 Markdown 写作。不要用 **、*、_、#、> 等符号强调文字，也不要用 -、* 或数字项目符号列清单。需要表达多个要点时，改用连贯句子或“第一、第二”等自然语言。",
  "完成操作后，简洁说明结果、重要改动和必要的下一步。用户要求代码时才输出代码块，并使用带语言标识的 Markdown 代码块。",
  "</apple-pi-desktop-assistant>",
].join("\n");
const TEXT_OUTPUT_CONSTRAINT = [
  "\n\n<pi-system-instruction>",
  "你正在通过图形化桌面应用与用户对话。最终正文必须是自然、清晰、面向用户的中文；先给出结果，再说明必要的细节。",
  "工具调用、终端命令、文件读取和联网搜索会由界面单独展示。除非用户明确要求命令、原始日志、完整路径或排查细节，不要在最终正文中复述工具名称、参数、命令、逐步执行过程或大段原始输出。",
  "调用工具后，用简短自然的语言总结完成了什么、结果如何以及用户是否还需要操作。不要使用 CLI 口吻、命令执行日志口吻或机械化的过程播报。",
  "默认写成普通自然语言段落。不要使用 Markdown 的 **、*、_、#、> 作为强调或标题，也不要使用 -、* 或数字项目符号制作列表；只有用户明确要求代码时才使用代码块。",
  "用户要求代码时使用带语言标识的代码块，并在代码外简要说明用途；普通问答不要为了形式而输出代码块或冗长列表。",
  "重要输出规则：你必须始终在思考过程之后输出正文内容，不能只输出思考过程。即使任务看似简单，也必须给出完整的文字回复。永远不要以思考内容结束回复。",
  "</pi-system-instruction>",
].join("");

const AUTO_EXECUTION_PLAN_CONSTRAINT = [
  "\n\n<apple-pi-auto-plan-mode>",
  "Execution mode: AUTO. This request has been classified as substantial, long-running, or multi-phase.",
  "Before any file modification, command execution, or other implementation tool, call the internal plan_create tool exactly once with 2 to 8 independently verifiable items.",
  "A request for a plan is not a request to pause. After plan_create succeeds, immediately begin executing the plan with the available tools; never wait for user confirmation or stop after creating the plan.",
  "Before working on each item call plan_update with action=start. Call action=complete only after verification and include concise evidence. Use action=block or action=skip with a reason when appropriate.",
  "If requirements or discovered constraints materially change, use plan_replan and explain the reason. Do not output plan XML, JSON, Markdown task lists, or hidden envelopes in the visible reply.",
  "</apple-pi-auto-plan-mode>",
].join("");

// Keep automatic planning limited to long-horizon work without forcing a todo
// list onto every message. This intentionally favors false negatives over noise.
function shouldOfferPlan(text) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!value) return false;
  const lower = value.toLowerCase();
  const explicitPlan = /(?:\u8ba1\u5212|\u89c4\u5212|\u62c6\u89e3|\u5f85\u529e|\u4efb\u52a1\u5217\u8868|\u8def\u7ebf\u56fe|\u5206\u6b65\u9aa4|\u957f\u671f|\u957f\u7ebf|\u591a\u6b65|(?:\u5236\u5b9a|\u8bbe\u8ba1|\u751f\u6210)\u65b9\u6848|\bplan\b|\btodo\b|\broadmap\b|break\s+down|step[- ]by[- ]step)/i.test(lower);
  if (explicitPlan) return true;
  if (value.length < 10) return false;

  const implementation = /(?:\u521b\u5efa|\u5236\u4f5c|\u5f00\u53d1|\u5b9e\u73b0|\u91cd\u6784|\u8fc1\u79fb|\u90e8\u7f72|\u4f18\u5316|\u4fee\u590d|\u8bbe\u8ba1|\u6784\u5efa|\bbuild\b|\bcreate\b|\bdevelop\b|\bimplement\b|\brefactor\b|\bmigrate\b|\bdeploy\b|\boptimi[sz]e\b|\brepair\b|\bdesign\b)/i.test(lower);
  const artifact = /(?:\u9879\u76ee|\u8f6f\u4ef6|\u5e94\u7528|\u7f51\u7ad9|\u524d\u7aef|\u540e\u7aef|\u7cfb\u7edf|\u6a21\u5757|\u529f\u80fd|\u6570\u636e\u5e93|\u63a5\u53e3|\u670d\u52a1|\u5b8c\u6574|\bproject\b|\bapp\b|\bsoftware\b|\bwebsite\b|\bfrontend\b|\bbackend\b|\bsystem\b|\bmodule\b|\bfeature\b|\bdatabase\b|\bapi\b)/i.test(lower);
  const multiPhase = /(?:\u5e76\u4e14|\u540c\u65f6|\u7136\u540e|\u4ee5\u53ca|\u5305\u62ec|\u5206\u522b|\u5404\u81ea|\u591a\u4e2a|\u591a\u9879|\u7b2c\u4e00|\u7b2c\u4e8c|\u7b2c\u4e09|\band\b|\balso\b|\bthen\b|\bafter\b|\binclude\b|\bmultiple\b|\bfirst\b.*\bthen\b)/i.test(lower);
  const delivery = /(?:\u6d4b\u8bd5|\u9a8c\u8bc1|\u6253\u5305|\u53d1\u5e03|\u90e8\u7f72|\u4ea4\u4ed8|\u68c0\u67e5|\u786e\u8ba4|\btest\b|\bvalidate\b|\bpackage\b|\bpublish\b|\bship\b|\brelease\b)/i.test(lower);
  const numbered = /(?:^|\s)(?:\d+[.)]|[-*])\s+/.test(value);
  const largeScope = /(?:\u5b8c\u6574|\u5168\u5957|\u4ece\u96f6|\u5168\u6d41\u7a0b|\u751f\u4ea7\u7ea7|\bcomplete\b|\bfull\b|\bend[- ]to[- ]end\b|\bproduction\b)/i.test(lower);
  const score = [implementation, artifact, multiPhase, delivery, numbered].filter(Boolean).length;
  return (score >= 2 && value.length >= 36) || (score >= 2 && largeScope && value.length >= 10) || (score >= 3 && value.length >= 18);
}

function escapeFileName(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function requiresMermaidDiagram(text) {
  return MERMAID_REQUEST_PATTERN.test(String(text ?? ""));
}

function stripPromptSuffixes(text) {
  return String(text ?? "")
    .replace(MERMAID_PROMPT_SUFFIX, "")
    .replace(MERMAID_CODE_SUFFIX, "")
    .replace(TEXT_OUTPUT_CONSTRAINT, "")
    .replace(AUTO_EXECUTION_PLAN_CONSTRAINT, "");
}

function publicCustomProvider(provider) {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    fullUrl: provider.fullUrl === true,
    localRuntime: provider.localRuntime ?? null,
    api: provider.api,
    models: provider.models.map((model) => ({
      id: model.id,
      name: model.name,
      reasoning: model.reasoning === true,
      multimodal: model.multimodal === true,
      contextWindow: model.contextWindow === LARGE_CONTEXT_WINDOW ? LARGE_CONTEXT_WINDOW : DEFAULT_CONTEXT_WINDOW,
    })),
  };
}

function normalizeCustomModels(provider) {
  const sourceModels = Array.isArray(provider.models)
    ? provider.models
    : [{ id: provider.modelId, name: provider.modelName, reasoning: provider.reasoning }];
  return sourceModels
    .filter((model) => model && typeof model.id === "string" && model.id.trim())
    .map((model) => ({
      id: model.id.trim(),
      name: typeof model.name === "string" && model.name.trim() ? model.name.trim() : model.id.trim(),
      reasoning: model.reasoning === true,
      multimodal: model.multimodal === true,
      contextWindow: model.contextWindow === LARGE_CONTEXT_WINDOW || model.oneMillionContext === true
        ? LARGE_CONTEXT_WINDOW
        : DEFAULT_CONTEXT_WINDOW,
    }));
}

function resolveCustomBaseUrl(value, api, fullUrl) {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Base URL 必须是有效的 HTTP 或 HTTPS 地址");
  if (fullUrl) return parsed.toString().replace(/\/$/, "");

  const version = api === "google-generative-ai" ? "v1beta" : "v1";
  const pathname = parsed.pathname.replace(/\/+$/, "");
  if (!new RegExp(`/${version}$`, "i").test(pathname)) parsed.pathname = `${pathname}/${version}`.replace(/\/+/g, "/");
  return parsed.toString().replace(/\/$/, "");
}

function getCustomProviderModelsEndpoint(baseUrl) {
  return `${baseUrl.replace(/\/+$/, "")}/models`;
}

function normalizeFetchedModels(payload, api) {
  const source = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : [];
  const seen = new Set();
  return source.flatMap((model) => {
    const rawId = typeof model === "string" ? model : model?.id ?? model?.name;
    const id = String(rawId ?? "").replace(/^models\//, "").trim();
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const name = typeof model === "object" && typeof model.display_name === "string"
      ? model.display_name
      : typeof model === "object" && typeof model.displayName === "string"
        ? model.displayName
        : id;
    return [{ id, name, reasoning: api === "anthropic-messages" && /thinking|opus|sonnet/i.test(id) }];
  }).slice(0, 200);
}

export class AgentService {
  /** @param {(channel: string, payload: unknown) => void} sendToRenderer */
  constructor(sendToRenderer, runBrowserAutomation) {
    this.sendToRenderer = sendToRenderer;
    this.session = null;
    this.modelRuntime = null;
    this.unsubscribe = null;
    this._initPromise = null;
    this.bundledModelCapabilities = new Map();
    this.authStorage = AuthStorage.create(); // 默认 auth.json 路径
    this.currentModelRef = null; // "provider/model"
    this.currentThinkingLevel = null;
    this.customProviders = null;
    this.currentCwd = null;
    this.integrations = new IntegrationService();
    this.mcpRuntime = new McpRuntime();
    this._tavilyTool = null;
    this._mermaidDiagramTool = null;
    this.mermaidDiagramEnabled = null;
    this._mcpToolCache = null;
    this._mcpToolCacheKey = null;
    this._skillToolCache = null;
    this._skillToolCacheKey = null;
    this.modelMultimodalOverrides = null;
    this.modelContextWindows = null;
    this._activePrompt = null;
    this._abortRequested = false;
    this.executionMode = "ask";
    this.executionModeLoaded = false;
    this.pendingApprovals = new Map();
    this.runBrowserAutomation = runBrowserAutomation;
    this.sessionRoot = path.join(app.getPath("userData"), "sessions");
    this.sessionTrashRoot = path.join(app.getPath("userData"), "session-trash");
  }

  _isManagedSessionFile(sessionFile) {
    if (typeof sessionFile !== "string" || !sessionFile.trim()) return false;
    const root = path.resolve(this.sessionRoot);
    const target = path.resolve(sessionFile);
    const relative = path.relative(root, target);
    return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative) && path.extname(target).toLowerCase() === ".jsonl";
  }

  async _cloneLegacySessionFile(sessionFile) {
    const source = path.resolve(sessionFile);
    if (this._isManagedSessionFile(source)) return source;
    const raw = await fs.readFile(source, "utf8");
    const firstLineEnd = raw.indexOf("\n");
    const headerText = (firstLineEnd < 0 ? raw : raw.slice(0, firstLineEnd)).trim();
    const header = JSON.parse(headerText);
    if (header?.type !== "session") throw new Error("无法迁移无效的历史会话文件");
    delete header.parentSession;
    await fs.mkdir(this.sessionRoot, { recursive: true });
    const target = path.join(this.sessionRoot, `legacy-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jsonl`);
    const remainder = firstLineEnd < 0 ? "" : raw.slice(firstLineEnd + 1);
    await fs.writeFile(target, `${JSON.stringify(header)}\n${remainder}`, "utf8");
    return target;
  }

  _getExecutionModePath() {
    return path.join(app.getPath("userData"), EXECUTION_MODE_SETTINGS_FILE);
  }

  async _ensureExecutionMode() {
    if (this.executionModeLoaded) return;
    this.executionModeLoaded = true;
    try {
      const saved = JSON.parse(await fs.readFile(this._getExecutionModePath(), "utf8"));
      if (saved?.mode === LEGACY_PLAN_EXECUTION_MODE) {
        // The former plan-only mode is now part of automatic execution.
        this.executionMode = "auto";
        await fs.writeFile(this._getExecutionModePath(), JSON.stringify({ ...saved, mode: "auto" }, null, 2), "utf8");
      } else if (EXECUTION_MODES.has(saved?.mode)) {
        this.executionMode = saved.mode;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") console.warn("Unable to load execution mode:", error);
    }
  }

  async getExecutionMode() {
    await this._ensureExecutionMode();
    return { mode: this.executionMode };
  }

  async setExecutionMode(mode) {
    await this._ensureExecutionMode();
    if (!EXECUTION_MODES.has(mode)) throw new Error("不支持的执行权限模式");
    this.executionMode = mode;
    await fs.writeFile(this._getExecutionModePath(), JSON.stringify({ mode }, null, 2), "utf8");
    this.sendToRenderer("agent:state", this._snapshotState());
    return this.getExecutionMode();
  }

  _isReadOnlyTool(name) {
    const normalized = String(name ?? "").toLowerCase();
    if (READ_ONLY_TOOLS.has(normalized)) return true;
    return /^(read|list|search|web_search|tavily|glob|grep|find)/i.test(normalized) && !WRITE_OR_EXECUTE_TOOL_PATTERN.test(normalized);
  }

  async _handleToolApproval(context, signal) {
    const name = String(context?.toolCall?.name ?? "tool");
    if (isPlanTool(name)) return undefined;
    if (this.executionMode === "auto") return undefined;
    if (this.executionMode === "read-only" && !this._isReadOnlyTool(name)) {
      return { block: true, reason: "当前为只读模式。该操作可能修改文件或执行命令，已被阻止。" };
    }
    if (this.executionMode === "read-only" || this._isReadOnlyTool(name)) return undefined;

    const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve) => {
      const deny = () => resolve({ block: true, reason: "用户拒绝执行此操作" });
      const entry = { resolve, deny };
      this.pendingApprovals.set(approvalId, entry);
      const abort = () => {
        if (!this.pendingApprovals.delete(approvalId)) return;
        deny();
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.sendToRenderer("agent:approvalRequested", {
        approvalId,
        toolName: name,
        args: context?.args ?? {},
        mode: this.executionMode,
      });
    });
  }

  resolveToolApproval(approvalId, approved) {
    const entry = this.pendingApprovals.get(approvalId);
    if (!entry) return { ok: false, stale: true };
    this.pendingApprovals.delete(approvalId);
    entry.resolve(approved ? undefined : { block: true, reason: "用户拒绝执行此操作" });
    return { ok: true };
  }

  _clearPendingApprovals() {
    for (const [approvalId, entry] of this.pendingApprovals) {
      this.pendingApprovals.delete(approvalId);
      entry.deny();
    }
  }

  async detectLocalModels() {
    return detectLocalModelRuntimes();
  }

  async openProjectFileReference(reference) {
    const resolved = await resolveProjectFileReference({
      cwd: this.currentCwd || process.cwd(),
      reference,
    });
    const result = await shell.openPath(resolved.path);
    if (result) throw new Error(result);
    return { ok: true, path: resolved.path, resolvedBy: resolved.resolvedBy };
  }

  async connectLocalRuntime(runtime) {
    const runtimes = await this.detectLocalModels();
    const found = runtimes.find((item) => item.id === runtime && item.available);
    if (!found) throw new Error("未检测到此本地模型服务，请先启动对应服务后重试");
    const existing = (this.customProviders ?? []).find((provider) => provider.localRuntime === runtime);
    if (existing) return publicCustomProvider(existing);

    const models = found.models.length ? found.models : [{ id: "default", name: "default" }];
    return this.createCustomProvider({
      name: found.name,
      baseUrl: found.providerBaseUrl,
      api: "openai-completions",
      fullUrl: false,
      models,
      // OpenAI-compatible local runtimes do not require a secret, but Pi's
      // credential layer needs a value to register the provider.
      apiKey: "local-runtime",
      localRuntime: runtime,
    });
  }

  _getCachedTavilyTool() {
    if (!this._tavilyTool) {
      this._tavilyTool = createTavilyWebSearchTool(() => this._getTavilyApiKey());
    }
    return this._tavilyTool;
  }

  _getMermaidDiagramTool() {
    if (!this._mermaidDiagramTool) this._mermaidDiagramTool = createMermaidDiagramTool();
    return this._mermaidDiagramTool;
  }

  _getMermaidDiagramSettingsPath() {
    return path.join(app.getPath("userData"), MERMAID_DIAGRAM_SETTINGS_FILE);
  }

  async getMermaidDiagramSettings() {
    if (typeof this.mermaidDiagramEnabled !== "boolean") {
      try {
        const saved = JSON.parse(await fs.readFile(this._getMermaidDiagramSettingsPath(), "utf8"));
        this.mermaidDiagramEnabled = saved?.enabled !== false;
      } catch (error) {
        if (error?.code !== "ENOENT") console.warn("Unable to read Mermaid diagram settings:", error);
        this.mermaidDiagramEnabled = true;
      }
    }
    return { enabled: this.mermaidDiagramEnabled };
  }

  async setMermaidDiagramEnabled(enabled) {
    this.mermaidDiagramEnabled = enabled !== false;
    const targetPath = this._getMermaidDiagramSettingsPath();
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, JSON.stringify({ enabled: this.mermaidDiagramEnabled }, null, 2), "utf8");
    return { enabled: this.mermaidDiagramEnabled };
  }

  _keyForServers(servers) {
    return JSON.stringify((servers || []).map((s) => s.id).sort());
  }

  async _getCachedMcpTools(enabledMcpServers) {
    const key = this._keyForServers(enabledMcpServers);
    if (this._mcpToolCache && this._mcpToolCacheKey === key) {
      return this._mcpToolCache;
    }
    this._mcpToolCache = await this.mcpRuntime.createTools(enabledMcpServers);
    this._mcpToolCacheKey = key;
    return this._mcpToolCache;
  }

  _keyForSkills(skills) {
    return JSON.stringify((skills || []).map((s) => s.id).sort());
  }

  async _getCachedSkillTools(enabledSkills) {
    const key = this._keyForSkills(enabledSkills);
    if (this._skillToolCache && this._skillToolCacheKey === key) {
      return this._skillToolCache;
    }
    this._skillToolCache = enabledSkills.length ? createSkillTools(() => this.integrations.getEnabledSkills()) : [];
    this._skillToolCacheKey = key;
    return this._skillToolCache;
  }

  /** 惰性初始化 ModelRuntime（只做一次） */
  async _ensureRuntime() {
    if (!this.modelRuntime) {
      // 显式把持久化的凭证存储注入 ModelRuntime
      this.modelRuntime = await ModelRuntime.create({ credentials: this.authStorage });
      await this._registerStoredCustomProviders();
      await this._loadModelMultimodalOverrides();
      await this._loadModelContextWindows();
      this._applyStoredModelMultimodalOverrides();
    }
    return this.modelRuntime;
  }

  _getCustomProvidersPath() {
    return path.join(app.getPath("userData"), CUSTOM_PROVIDERS_FILE);
  }

  _getModelMultimodalPath() {
    return path.join(app.getPath("userData"), MODEL_MULTIMODAL_FILE);
  }

  _getModelContextWindowsPath() {
    return path.join(app.getPath("userData"), MODEL_CONTEXT_WINDOWS_FILE);
  }

  async _loadModelContextWindows() {
    if (this.modelContextWindows) return this.modelContextWindows;
    try {
      const saved = JSON.parse(await fs.readFile(this._getModelContextWindowsPath(), "utf8"));
      const oneMillion = saved?.oneMillion;
      this.modelContextWindows = oneMillion && typeof oneMillion === "object" && !Array.isArray(oneMillion)
        ? Object.fromEntries(Object.entries(oneMillion).filter(([, value]) => value === true))
        : {};
    } catch (error) {
      if (error?.code !== "ENOENT") console.warn("Unable to read model context settings:", error);
      this.modelContextWindows = {};
    }
    return this.modelContextWindows;
  }

  async _writeModelContextWindows() {
    const targetPath = this._getModelContextWindowsPath();
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, JSON.stringify({ oneMillion: this.modelContextWindows ?? {} }, null, 2), "utf8");
  }

  async _loadModelMultimodalOverrides() {
    if (this.modelMultimodalOverrides) return this.modelMultimodalOverrides;
    try {
      const saved = JSON.parse(await fs.readFile(this._getModelMultimodalPath(), "utf8"));
      const overrides = saved?.overrides;
      this.modelMultimodalOverrides = overrides && typeof overrides === "object" && !Array.isArray(overrides)
        ? Object.fromEntries(Object.entries(overrides).filter(([, value]) => typeof value === "boolean"))
        : {};
    } catch (error) {
      if (error?.code !== "ENOENT") console.warn("Unable to read model multimodal settings:", error);
      this.modelMultimodalOverrides = {};
    }
    return this.modelMultimodalOverrides;
  }

  async _writeModelMultimodalOverrides() {
    await fs.writeFile(
      this._getModelMultimodalPath(),
      JSON.stringify({ overrides: this.modelMultimodalOverrides ?? {} }, null, 2),
      "utf8"
    );
  }

  async _readCustomProviders() {
    try {
      const saved = JSON.parse(await fs.readFile(this._getCustomProvidersPath(), "utf8"));
      if (!Array.isArray(saved?.providers)) return [];
      return saved.providers.flatMap((provider) => {
        if (!provider || typeof provider.id !== "string" || typeof provider.name !== "string" ||
          typeof provider.baseUrl !== "string" || typeof provider.api !== "string") return [];
        const models = normalizeCustomModels(provider);
        return models.length ? [{ ...provider, fullUrl: provider.fullUrl !== false, models }] : [];
      });
    } catch (error) {
      if (error?.code !== "ENOENT") console.warn("Unable to read custom providers:", error);
      return [];
    }
  }

  async _writeCustomProviders(providers) {
    const targetPath = this._getCustomProvidersPath();
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, JSON.stringify({ providers }, null, 2), "utf8");
  }

  _toPiProviderConfig(provider) {
    return {
      name: provider.name,
      baseUrl: provider.baseUrl,
      api: provider.api,
      models: provider.models.map((model) => ({
        id: model.id,
        name: model.name || model.id,
        reasoning: model.reasoning === true,
        input: model.multimodal === true ? ["text", "image"] : ["text"],
        // Pi calculates token usage after every response. Custom providers do
        // not have a public pricing table, so use a zero-cost placeholder.
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: model.contextWindow === LARGE_CONTEXT_WINDOW ? LARGE_CONTEXT_WINDOW : DEFAULT_CONTEXT_WINDOW,
        maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      })),
    };
  }

  async _registerStoredCustomProviders() {
    this.customProviders = await this._readCustomProviders();
    for (const provider of this.customProviders) {
      try {
        this.modelRuntime.registerProvider(provider.id, this._toPiProviderConfig(provider));
      } catch (error) {
        console.warn(`Unable to register custom provider ${provider.id}:`, error?.message ?? error);
      }
    }
  }

  async listCustomProviders() {
    await this._ensureRuntime();
    return (this.customProviders ?? []).map(publicCustomProvider);
  }

  _modelRef(providerId, modelId) {
    return `${providerId}/${modelId}`;
  }

  _parseModelRef(modelRef) {
    const separator = String(modelRef ?? "").indexOf("/");
    if (separator <= 0) return ["", ""];
    return [modelRef.slice(0, separator), modelRef.slice(separator + 1)];
  }

  _isCustomProvider(providerId) {
    return (this.customProviders ?? []).some((provider) => provider.id === providerId);
  }

  _getBundledModelMultimodalSupport(providerId, modelId) {
    if (this._isCustomProvider(providerId)) return null;
    if (!this.bundledModelCapabilities.has(providerId)) {
      const dataPath = path.join(PI_MODEL_DATA_DIR, `${providerId}.json`);
      try {
        const models = JSON.parse(fsSync.readFileSync(dataPath, "utf8"));
        this.bundledModelCapabilities.set(
          providerId,
          new Map(Object.entries(models).map(([id, model]) => [id, model?.input?.includes("image") === true]))
        );
      } catch {
        this.bundledModelCapabilities.set(providerId, new Map());
      }
    }
    const models = this.bundledModelCapabilities.get(providerId);
    return models.has(modelId) ? models.get(modelId) : false;
  }

  _registeredModelConfig(model, multimodal, contextWindow = DEFAULT_CONTEXT_WINDOW) {
    const { provider: _provider, ...config } = model;
    return {
      ...config,
      input: multimodal ? ["text", "image"] : ["text"],
      contextWindow,
      maxTokens: Number(model.maxTokens) > 0 ? model.maxTokens : DEFAULT_MAX_OUTPUT_TOKENS,
    };
  }

  _getModelContextWindow(providerId, modelId) {
    return this.modelContextWindows?.[this._modelRef(providerId, modelId)] === true
      ? LARGE_CONTEXT_WINDOW
      : DEFAULT_CONTEXT_WINDOW;
  }

  _applyStoredModelMultimodalOverrides() {
    const overrides = this.modelMultimodalOverrides ?? {};
    const providerIds = new Set(
      this.modelRuntime.getModels().map((model) => model.provider).filter((providerId) =>
        Object.keys(overrides).some((modelRef) => modelRef.startsWith(`${providerId}/`))
      )
    );
    for (const providerId of providerIds) {
      if (!this._isCustomProvider(providerId)) this._applyProviderModelOverrides(providerId);
    }
  }

  _applyProviderModelOverrides(providerId) {
    const models = this.modelRuntime.getModels(providerId);
    if (!models.length) return;
    const overrides = this.modelMultimodalOverrides ?? {};

    this.modelRuntime.registerProvider(providerId, {
      models: models.map((model) => {
        const ref = this._modelRef(providerId, model.id);
        const supported = this._getBundledModelMultimodalSupport(providerId, model.id);
        const multimodal = supported === true
          ? (Object.hasOwn(overrides, ref) ? overrides[ref] : model.input.includes("image"))
          : model.input.includes("image");
        return this._registeredModelConfig(
          model,
          multimodal,
          this._getModelContextWindow(providerId, model.id)
        );
      }),
    });
  }

  async getModelMultimodalCapabilities() {
    await this._ensureRuntime();
    return Object.fromEntries(
      this.modelRuntime.getModels().map((model) => [
        this._modelRef(model.provider, model.id),
        this._isCustomProvider(model.provider)
          ? { enabled: model.input.includes("image"), supported: null, manual: true }
          : {
              enabled: model.input.includes("image"),
              supported: this._getBundledModelMultimodalSupport(model.provider, model.id) === true,
              manual: false,
            },
      ])
    );
  }

  async setModelMultimodal(providerId, modelId, enabled) {
    await this._ensureRuntime();
    const multimodal = enabled === true;
    const model = this.modelRuntime.getModel(providerId, modelId);
    if (!model) throw new Error("未找到需要设置的模型");

    const customProvider = (this.customProviders ?? []).find((provider) => provider.id === providerId);
    if (customProvider) {
      const target = customProvider.models.find((item) => item.id === modelId);
      if (!target) throw new Error("未找到需要设置的自定义模型");
      target.multimodal = multimodal;
      await this._writeCustomProviders(this.customProviders);
      this.modelRuntime.registerProvider(providerId, this._toPiProviderConfig(customProvider));
    } else {
      if (multimodal && this._getBundledModelMultimodalSupport(providerId, modelId) !== true) {
        throw new Error("该内置模型未声明支持图片输入，无法启用多模态");
      }
      const overrides = await this._loadModelMultimodalOverrides();
      overrides[this._modelRef(providerId, modelId)] = multimodal;
      await this._writeModelMultimodalOverrides();
      this._applyProviderModelOverrides(providerId);
    }
    return this.getModelMultimodalCapabilities();
  }

  async setProviderMultimodal(providerId, enabled) {
    await this._ensureRuntime();
    const modelIds = this.modelRuntime.getModels(providerId).map((model) => model.id);
    if (!modelIds.length) throw new Error("该厂商没有可设置的模型");
    const multimodal = enabled === true;
    const customProvider = (this.customProviders ?? []).find((provider) => provider.id === providerId);

    if (customProvider) {
      customProvider.models.forEach((model) => { model.multimodal = multimodal; });
      await this._writeCustomProviders(this.customProviders);
      this.modelRuntime.registerProvider(providerId, this._toPiProviderConfig(customProvider));
    } else {
      const overrides = await this._loadModelMultimodalOverrides();
      modelIds.forEach((modelId) => {
        const supported = this._getBundledModelMultimodalSupport(providerId, modelId) === true;
        overrides[this._modelRef(providerId, modelId)] = supported && multimodal;
      });
      await this._writeModelMultimodalOverrides();
      this._applyProviderModelOverrides(providerId);
    }
    return this.getModelMultimodalCapabilities();
  }

  async getModelContextWindowSettings() {
    await this._ensureRuntime();
    const stored = await this._loadModelContextWindows();
    const oneMillion = { ...stored };
    for (const provider of this.customProviders ?? []) {
      for (const model of provider.models) {
        const ref = this._modelRef(provider.id, model.id);
        if (model.contextWindow === LARGE_CONTEXT_WINDOW) oneMillion[ref] = true;
        else delete oneMillion[ref];
      }
    }
    return {
      defaultContextWindow: DEFAULT_CONTEXT_WINDOW,
      largeContextWindow: LARGE_CONTEXT_WINDOW,
      oneMillion,
    };
  }

  async setModelContextWindow(providerId, modelId, oneMillion) {
    await this._ensureRuntime();
    const model = this.modelRuntime.getModel(providerId, modelId);
    if (!model) throw new Error("未找到需要设置上下文容量的模型");
    const enabled = oneMillion === true;
    const ref = this._modelRef(providerId, modelId);
    const customProvider = (this.customProviders ?? []).find((provider) => provider.id === providerId);
    if (customProvider) {
      const target = customProvider.models.find((item) => item.id === modelId);
      if (!target) throw new Error("未找到需要设置上下文容量的自定义模型");
      target.contextWindow = enabled ? LARGE_CONTEXT_WINDOW : DEFAULT_CONTEXT_WINDOW;
      await this._writeCustomProviders(this.customProviders);
      this.modelRuntime.registerProvider(providerId, this._toPiProviderConfig(customProvider));
    } else {
      const settings = await this._loadModelContextWindows();
      if (enabled) settings[ref] = true;
      else delete settings[ref];
      await this._writeModelContextWindows();
      this._applyProviderModelOverrides(providerId);
    }
    return this.getModelContextWindowSettings();
  }

  async fetchCustomProviderModels(input = {}) {
    const api = String(input.api ?? "openai-completions");
    const baseUrlInput = String(input.baseUrl ?? "").trim();
    const apiKey = String(input.apiKey ?? "").trim();
    const fullUrl = input.fullUrl === true;
    if (!CUSTOM_PROVIDER_APIS.has(api)) throw new Error("不支持的 API 协议");
    if (!baseUrlInput) throw new Error("请先填写 Base URL");
    if (!apiKey) throw new Error("请先填写 API Key 后再获取模型列表");

    let baseUrl;
    try {
      baseUrl = resolveCustomBaseUrl(baseUrlInput, api, fullUrl);
    } catch {
      throw new Error("Base URL 必须是有效的 HTTP 或 HTTPS 地址");
    }

    const endpoint = new URL(getCustomProviderModelsEndpoint(baseUrl));
    if (api === "anthropic-messages") endpoint.searchParams.set("limit", "100");
    const headers = { Accept: "application/json" };
    if (api === "anthropic-messages") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (api === "google-generative-ai") {
      headers["x-goog-api-key"] = apiKey;
    } else {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let response;
    try {
      response = await fetch(endpoint, { method: "GET", headers, signal: controller.signal });
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("获取模型列表超时，请检查网络或服务地址");
      throw new Error("无法连接模型服务，请检查 Base URL 和网络连接");
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error("模型服务拒绝了 API Key，请检查密钥权限");
      if (response.status === 404) throw new Error("未找到模型列表接口，请检查 Base URL、完整 URL 开关和 API 协议");
      throw new Error(`获取模型列表失败（HTTP ${response.status}）`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("模型服务返回了无法识别的列表数据");
    }
    const models = normalizeFetchedModels(payload, api);
    if (!models.length) throw new Error("模型服务未返回可用模型，请手动添加模型 ID");
    return { models };
  }

  async createCustomProvider(input = {}) {
    const name = String(input.name ?? "").trim();
    const api = String(input.api ?? "openai-completions");
    const fullUrl = input.fullUrl === true;
    const baseUrlInput = String(input.baseUrl ?? "").trim();
    const apiKey = String(input.apiKey ?? "").trim();
    const models = normalizeCustomModels({ models: input.models });
    if (!name || !baseUrlInput || !models.length || !apiKey) throw new Error("请填写厂商名称、Base URL、至少一个模型 ID 和 API Key");
    if (!CUSTOM_PROVIDER_APIS.has(api)) throw new Error("不支持的 API 协议");
    try {
      resolveCustomBaseUrl(baseUrlInput, api, fullUrl);
    } catch {
      throw new Error("Base URL 必须是有效的 HTTP 或 HTTPS 地址");
    }

    await this._ensureRuntime();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "provider";
    const providers = [...(this.customProviders ?? [])];
    let id = `custom-${slug}`;
    let suffix = 2;
    while (providers.some((provider) => provider.id === id) || this.modelRuntime.getProvider(id)) id = `custom-${slug}-${suffix++}`;
    const provider = {
      id,
      name,
      baseUrl: resolveCustomBaseUrl(baseUrlInput, api, fullUrl),
      fullUrl,
      api,
      models,
      localRuntime: typeof input.localRuntime === "string" ? input.localRuntime : null,
    };

    this.modelRuntime.registerProvider(id, this._toPiProviderConfig(provider));
    try {
      await this.authStorage.modify(id, async () => ({ type: "api_key", key: apiKey }));
      await this.modelRuntime.setRuntimeApiKey(id, apiKey);
      providers.push(provider);
      await this._writeCustomProviders(providers);
      this.customProviders = providers;
    } catch (error) {
      this.modelRuntime.unregisterProvider(id);
      throw error;
    }
    return publicCustomProvider(provider);
  }

  async deleteCustomProvider(providerId) {
    await this._ensureRuntime();
    const providers = (this.customProviders ?? []).filter((provider) => provider.id !== providerId);
    if (providers.length === (this.customProviders ?? []).length) throw new Error("未找到自定义厂商");
    await this._writeCustomProviders(providers);
    this.customProviders = providers;
    this.modelRuntime.unregisterProvider(providerId);
    await this.authStorage.delete(providerId);
    await this.modelRuntime.removeRuntimeApiKey(providerId);
    if (this.currentModelRef?.startsWith(`${providerId}/`)) this.currentModelRef = null;
    return { ok: true };
  }

  /**
   * 持久化（或清除）某厂商的 API Key 到主进程 auth.json。
   * 渲染进程永远不接触明文密钥。
   */
  async saveApiKey(providerId, apiKey) {
    await this._ensureRuntime();
    if (apiKey && apiKey.trim()) {
      const key = apiKey.trim();
      await this.authStorage.modify(providerId, async () => ({ type: "api_key", key }));
      // 让运行中的 ModelRuntime 立即识别新凭证
      await this.modelRuntime.setRuntimeApiKey(providerId, key);
    } else {
      await this.authStorage.delete(providerId);
      await this.modelRuntime.removeRuntimeApiKey(providerId);
    }
    return { ok: true };
  }

  /** 列出已配置密钥的厂商 id（不含明文） */
  async listConfiguredProviders() {
    const infos = await this.authStorage.list();
    return infos.map((c) => c.providerId ?? c.provider ?? c.id).filter(Boolean);
  }

  _getTavilySettingsPath() {
    return path.join(app.getPath("userData"), TAVILY_SETTINGS_FILE);
  }

  async _getTavilyApiKey() {
    try {
      const raw = await fs.readFile(this._getTavilySettingsPath(), "utf8");
      const saved = JSON.parse(raw);
      if (!saved?.encryptedApiKey || !safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.decryptString(Buffer.from(saved.encryptedApiKey, "base64")) || null;
    } catch (error) {
      if (error?.code !== "ENOENT") console.warn("Unable to read Tavily search settings:", error);
      return null;
    }
  }

  async saveTavilyApiKey(apiKey) {
    const key = String(apiKey ?? "").trim();
    const targetPath = this._getTavilySettingsPath();
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    if (!key) {
      await fs.rm(targetPath, { force: true });
      return { ok: true, hasApiKey: false };
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("当前系统无法安全保存 Tavily API Key");
    }

    const encryptedApiKey = safeStorage.encryptString(key).toString("base64");
    await fs.writeFile(targetPath, JSON.stringify({ encryptedApiKey }), "utf8");
    this._tavilyTool = null;
    return { ok: true, hasApiKey: true };
  }

  async getTavilySearchSettings() {
    return { hasApiKey: Boolean(await this._getTavilyApiKey()) };
  }

  getIntegrationImportPreview(force = false) {
    return this.integrations.getImportPreview(force);
  }

  importIntegrationCandidates(selectedSources) {
    this._invalidateToolCaches();
    return this.integrations.importCandidates(selectedSources);
  }

  dismissIntegrationImport() {
    return this.integrations.dismissImport();
  }

  getIntegrations() {
    return this.integrations.getIntegrations();
  }

  async getMcpHealth() {
    const servers = await this.integrations.getMcpServersForHealth();
    return this.mcpRuntime.getHealth(servers);
  }

  setIntegrationEnabled(kind, id, enabled) {
    this._invalidateToolCaches();
    return this.integrations.setEnabled(kind, id, enabled);
  }

  _invalidateToolCaches() {
    this._mcpToolCache = null;
    this._mcpToolCacheKey = null;
    this._skillToolCache = null;
    this._skillToolCacheKey = null;
  }

  /** 记录当前模型选择，供下次 createSession 使用 */
  async setCurrentModel(modelRef) {
    this.currentModelRef = modelRef || null;
    const [providerId] = this._parseModelRef(this.currentModelRef);
    if (providerId) {
      await this._ensureRuntime();
      if (!this._isCustomProvider(providerId)) this._applyProviderModelOverrides(providerId);
    }
    return { ok: true };
  }

  getThinkingOptions() {
    const availableLevels = this.session?.getAvailableThinkingLevels?.() ?? [...THINKING_LEVELS];
    const thinkingLevel = this.session?.thinkingLevel ?? this.currentThinkingLevel ?? "off";
    return { thinkingLevel, availableThinkingLevels: availableLevels };
  }

  setThinkingLevel(level) {
    if (!THINKING_LEVELS.has(level)) throw new Error("不支持的推理强度");
    this.currentThinkingLevel = level;
    if (this.session) {
      this.session.setThinkingLevel(level);
      this.currentThinkingLevel = this.session.thinkingLevel;
      this.sendToRenderer("agent:state", this._snapshotState());
    }
    return this.getThinkingOptions();
  }

  /**
   * 创建一个新会话。
   * @param {{ cwd?: string, sessionFile?: string, forkSession?: boolean, sessionManager?: any }} opts
   */
  async createSession(opts = {}) {
    const t0 = Date.now();
    await this._ensureExecutionMode();
    await this.disposeSession();
    const t1 = Date.now();
    const modelRuntime = await this._ensureRuntime();
    const t2 = Date.now();
    const [enabledMcpServers, enabledSkills] = await Promise.all([
      this.integrations.getEnabledMcpServers(),
      this.integrations.getEnabledSkills(),
    ]);
    const t3 = Date.now();
    const mcpTools = await this._getCachedMcpTools(enabledMcpServers);
    const t4 = Date.now();
    const skillTools = await this._getCachedSkillTools(enabledSkills);
    const t5 = Date.now();

    const cwd = opts.cwd || process.cwd();
    const agentDir = getAgentDir();
    const settingsManager = SettingsManager.create(cwd, agentDir);
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      appendSystemPromptOverride: (appendedPrompts) => [
        ...appendedPrompts,
        DESKTOP_RESPONSE_STYLE_SYSTEM_PROMPT,
      ],
    });
    await resourceLoader.reload();
    let sessionManager = opts.sessionManager ?? null;
    const t6 = Date.now();

    const tavilyTool = this._getCachedTavilyTool();
    const mermaidDiagramTool = this._getMermaidDiagramTool();
    const planTools = createPlanTools((update) => this.sendToRenderer("agent:planUpdate", {
      ...update,
      sessionFile: this.getSessionInfo().sessionFile,
    }));
    const browserAutomationTools = createBrowserAutomationTools(this.runBrowserAutomation);
    const { enabled: mermaidDiagramEnabled } = await this.getMermaidDiagramSettings();
    const createWithManager = (manager) => createAgentSession({
      modelRuntime,
      sessionManager: manager,
      cwd,
      agentDir,
      settingsManager,
      resourceLoader,
      customTools: [tavilyTool, ...(mermaidDiagramEnabled ? [mermaidDiagramTool] : []), ...planTools, ...browserAutomationTools, ...skillTools, ...mcpTools],
      // TODO(审批门): 传入 beforeToolCall 钩子，弹窗让用户确认高危操作
      // beforeToolCall: async ({ toolCall, args, context }) => {
      //   const approved = await this.askApproval(toolCall.name, args);
      //   return approved ? {} : { block: true, reason: "用户拒绝" };
      // },
    });

    let session;
    try {
      if (!sessionManager) {
        if (opts.forkSession && opts.sessionFile) {
          const sourceSessionFile = await this._cloneLegacySessionFile(opts.sessionFile);
          sessionManager = SessionManager.forkFrom(sourceSessionFile, cwd, this.sessionRoot);
        } else if (opts.sessionFile) {
          const sessionFile = await this._cloneLegacySessionFile(opts.sessionFile);
          sessionManager = SessionManager.open(sessionFile, this.sessionRoot, cwd);
        } else {
          sessionManager = SessionManager.create(cwd, this.sessionRoot);
        }
      }
      ({ session } = await createWithManager(sessionManager));
    } catch (error) {
      throw error;

    }
    const t7 = Date.now();

    this.session = session;
    this.currentCwd = cwd;

    // AgentSession installs its own extension hook during construction. Chain
    // it so the desktop permission gate controls every tool without disabling
    // existing Skill/MCP interception.
    const extensionBeforeToolCall = session.agent.beforeToolCall;
    session.agent.beforeToolCall = async (context, signal) => {
      const extensionResult = await extensionBeforeToolCall?.(context, signal);
      if (extensionResult?.block) return extensionResult;
      return this._handleToolApproval(context, signal);
    };

    // 应用用户选择的模型（"provider/model"），并校验该厂商已配置密钥
    if (this.currentModelRef) {
      // 自定义网关的模型 ID 可以包含 "/"，例如 OmniRoute 的
      // "oc/deepseek-v4-flash-free"；只能拆分第一个分隔符。
      const [providerId, modelId] = this._parseModelRef(this.currentModelRef);
      if (!this._isCustomProvider(providerId)) this._applyProviderModelOverrides(providerId);
      const model = modelRuntime.getModel(providerId, modelId);
      if (model) {
        try {
          await session.setModel(model);
        } catch (e) {
          this.sendToRenderer("agent:error", `模型 ${this.currentModelRef} 设置失败：${e?.message ?? e}`);
        }
      } else {
        this.sendToRenderer("agent:error", `未找到模型：${this.currentModelRef}`);
      }
    }
    if (this.currentThinkingLevel) {
      session.setThinkingLevel(this.currentThinkingLevel);
      this.currentThinkingLevel = session.thinkingLevel;
    }
    const t8 = Date.now();

    // 订阅 pi 事件流并转发到渲染进程
    this.unsubscribe = session.subscribe((event) => {
      this.sendToRenderer("agent:event", event);
      if (["turn_end", "agent_end", "session_compact", "session_compaction"].includes(event?.type)) {
        this.sendToRenderer("agent:state", this._snapshotState());
      }
    });

    // 把初始状态推给前端
    this.sendToRenderer("agent:state", this._snapshotState());

    console.log(
      `[AgentService.createSession] total=${t8 - t0}ms | dispose=${t1 - t0} ensureRuntime=${t2 - t1} ` +
      `integrations=${t3 - t2} mcpTools=${t4 - t3} skillTools=${t5 - t4} sessionManager=${t6 - t5} ` +
      `createAgentSession=${t7 - t6} setModel=${t8 - t7}`
    );
    return session;
  }

  /** 发送用户消息 */
  async prompt(text, filePaths = []) {
    this._assertSession();
    if (this._activePrompt) {
      throw new Error("Agent 正在处理上一条消息，请等待其停止或完成。");
    }

    this._abortRequested = false;
    const run = (async () => {
      const { fileText, images } = await this._prepareAttachments(filePaths);
      if (this._abortRequested) return;

      const userText = text?.trim() || "";
      const promptText = [userText, fileText].filter(Boolean).join("\n\n") || "请查看所附文件。";
      const { enabled: mermaidDiagramEnabled } = await this.getMermaidDiagramSettings();
      let enforcedPrompt = requiresMermaidDiagram(userText)
        ? `${promptText}${mermaidDiagramEnabled ? MERMAID_PROMPT_SUFFIX : MERMAID_CODE_SUFFIX}`
        : promptText;
      // 始终注入正文输出约束，防止模型只输出思考内容
      enforcedPrompt = `${enforcedPrompt}${TEXT_OUTPUT_CONSTRAINT}`;
      if (this.executionMode === "auto" && shouldOfferPlan(userText)) {
        enforcedPrompt = `${enforcedPrompt}${AUTO_EXECUTION_PLAN_CONSTRAINT}`;
      }
      await this.session.prompt(enforcedPrompt, { images: images.length > 0 ? images : undefined });
    })();
    this._activePrompt = run;

    try {
      await run;
    } finally {
      if (this._activePrompt === run) this._activePrompt = null;
      this._abortRequested = false;
      this.sendToRenderer("agent:state", this._snapshotState());
    }
  }

  async _prepareAttachments(filePaths) {
    if (!Array.isArray(filePaths)) return { fileText: "", images: [] };

    const textParts = [];
    const images = [];
    for (const filePath of filePaths) {
      if (typeof filePath !== "string" || !filePath) continue;
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) throw new Error(`附件不是文件：${filePath}`);

      const extension = path.extname(filePath).toLowerCase();
      const fileName = escapeFileName(filePath);
      const imageMimeType = IMAGE_MIME_TYPES.get(extension);
      if (imageMimeType) {
        if (stats.size > MAX_IMAGE_BYTES) throw new Error(`图片过大：${path.basename(filePath)}，最大支持 10 MB`);
        const data = (await fs.readFile(filePath)).toString("base64");
        images.push({ type: "image", mimeType: imageMimeType, data });
        textParts.push(`<file name="${fileName}"></file>`);
        continue;
      }

      if (TEXT_FILE_EXTENSIONS.has(extension)) {
        if (stats.size > MAX_TEXT_FILE_BYTES) throw new Error(`文本文件过大：${path.basename(filePath)}，最大支持 1 MB`);
        const content = await fs.readFile(filePath, "utf8");
        textParts.push(`<file name="${fileName}">\n${content}\n</file>`);
        continue;
      }

      textParts.push(`<file name="${fileName}">已附加此文件。请使用 read 工具读取该文件内容。</file>`);
    }
    return { fileText: textParts.join("\n"), images };
  }

  /** 中止当前运行 */
  async abort() {
    if (!this.session) return;
    this._abortRequested = true;
    this._clearPendingApprovals();
    await this.session.abort();
    // session.abort() waits for the agent, and this also waits for attachment
    // preprocessing or prompt cleanup to settle before the UI can send again.
    if (this._activePrompt) await this._activePrompt.catch(() => undefined);
    this.sendToRenderer("agent:state", this._snapshotState());
  }

  /** 从上次中断处继续 */
  async continue() {
    this._assertSession();
    await this.session.continue();
    this.sendToRenderer("agent:state", this._snapshotState());
  }

  /** 获取当前状态快照 */
  getState() {
    return this._snapshotState();
  }

  /** 为侧栏任务切换提供可安全渲染的基础对话文本。 */
  getHistory() {
    const state = this.session?.agent?.state ?? this.session?.state;
    return historyFromMessages(state?.messages, stripPromptSuffixes);
  }

  async getHistoryForSessionFile(sessionFile) {
    const target = path.resolve(String(sessionFile ?? ""));
    if (!this._isManagedSessionFile(target)) throw new Error("只能读取本软件管理的会话历史");
    if (path.resolve(this.session?.sessionFile ?? "") === target) return this.getHistory();
    const raw = await fs.readFile(target, "utf8");
    return historyFromSessionEvents(extractSessionEvents(raw), stripPromptSuffixes);
  }

  getConversationInfo() {
    const state = this._snapshotState();
    return {
      ...this.getSessionInfo(),
      model: state?.model ?? null,
      thinkingLevel: state?.thinkingLevel ?? null,
      messageCount: state?.messageCount ?? 0,
      contextUsage: state?.contextUsage ?? null,
    };
  }

  getConversationExport(format = "markdown") {
    const history = this.getHistory();
    const normalizedFormat = format === "json" ? "json" : "markdown";
    if (normalizedFormat === "json") {
      return { format: normalizedFormat, content: JSON.stringify({ exportedAt: new Date().toISOString(), ...this.getConversationInfo(), messages: history }, null, 2) };
    }
    const content = history.map((entry) => {
      if (entry.role === "user") return `## 用户\n\n${entry.text}`;
      if (entry.role === "assistant") return `## 助手\n\n${entry.text}`;
      if (entry.role === "thinking") return `> 推理过程\n> ${String(entry.text).replace(/\n/g, "\n> ")}`;
      if (entry.role === "toolCall") return `> 工具调用：\`${entry.name}\`\n\n\`\`\`json\n${JSON.stringify(entry.args ?? {}, null, 2)}\n\`\`\``;
      if (entry.role === "toolResult") return `> 工具结果：\`${entry.name}\`\n\n\`\`\`\n${entry.result ?? ""}\n\`\`\``;
      return "";
    }).filter(Boolean).join("\n\n---\n\n");
    return { format: normalizedFormat, content: `# Pi 对话导出\n\n导出时间：${new Date().toLocaleString()}\n\n${content}` };
  }

  getConversationText(scope = "all") {
    return this.getHistory()
      .filter((entry) => scope !== "assistant" || entry.role === "assistant")
      .map((entry) => {
        if (entry.role === "toolCall") return `[工具调用：${entry.name}]\n${JSON.stringify(entry.args ?? {}, null, 2)}`;
        if (entry.role === "toolResult") return `[工具结果：${entry.name}]\n${entry.result ?? ""}`;
        return entry.text ?? "";
      })
      .filter(Boolean)
      .join("\n\n");
  }

  async compactConversation() {
    this._assertSession();
    if (this._activePrompt) throw new Error("当前回复尚未完成，无法压缩上下文");
    const before = this.session.getContextUsage?.() ?? null;
    const result = await this.session.compact();
    const after = this.session.getContextUsage?.() ?? null;
    this.sendToRenderer("agent:state", this._snapshotState());
    return { before, after, summary: result?.summary ?? null };
  }

  /** 仅返回任务索引需要的会话定位信息。 */
  getSessionInfo() {
    return {
      sessionFile: this.session?.sessionFile ?? null,
      cwd: this.currentCwd,
    };
  }

  /** 删除 Pi 保存的单个会话文件，仅允许操作默认 sessions 目录中的 JSONL 文件。 */
  async deleteSessionFile(sessionFile) {
    if (typeof sessionFile !== "string" || !sessionFile.trim()) {
      throw new Error("缺少会话文件路径");
    }

    const target = path.resolve(sessionFile);
    if (!this._isManagedSessionFile(target)) {
      if (path.resolve(this.session?.sessionFile ?? "") === target) {
        await this.abort();
        await this.disposeSession();
      }
      // Legacy sessions were created before the desktop app owned its own
      // session directory. Removing their sidebar entry must never erase a
      // shared Pi/CLI history that might still be used by another tool.
      return { ok: true, legacyDetached: true };
    }

    if (path.resolve(this.session?.sessionFile ?? "") === target) {
      await this.abort();
      await this.disposeSession();
    }
    try {
      await fs.mkdir(this.sessionTrashRoot, { recursive: true });
      const trashPath = path.join(this.sessionTrashRoot, `${Date.now()}-${path.basename(target)}`);
      await fs.rename(target, trashPath);
      return { ok: true, trashPath };
    } catch (error) {
      if (error?.code === "ENOENT") return { ok: true, alreadyMissing: true };
      // 任务索引可能仍指向已被 Pi 清理的历史会话；此时应视为删除完成。
      if (error?.code === "ENOENT") return { ok: true, alreadyMissing: true };
      throw error;
    }
  }

  async restoreDeletedSessionFile(trashPath, sessionFile) {
    if (!this._isManagedSessionFile(sessionFile) || typeof trashPath !== "string") return;
    await fs.rename(trashPath, sessionFile).catch(() => {});
  }

  /** 释放当前会话 */
  async disposeSession() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.session = null;
    // 不再每次切换会话都关闭 MCP 连接；连接随应用生命周期保持，退出时统一关闭。
  }

  async dispose() {
    await this.disposeSession();
    await this.mcpRuntime.closeAll();
  }

  _assertSession() {
    if (!this.session) {
      throw new Error("会话尚未创建，请先调用 createSession()");
    }
  }

  _snapshotState() {
    if (!this.session) return null;
    const s = this.session.agent?.state ?? this.session.state;
    if (!s) return null;
    return {
      isStreaming: s.isStreaming,
      model: s.model?.id ?? s.model?.name ?? null,
      thinkingLevel: s.thinkingLevel,
      availableThinkingLevels: this.session.getAvailableThinkingLevels?.() ?? ["off"],
      messageCount: s.messages?.length ?? 0,
      pendingToolCalls: s.pendingToolCalls ? [...s.pendingToolCalls] : [],
      executionMode: this.executionMode,
      contextUsage: this._getContextUsage(),
      errorMessage: s.errorMessage ?? null,
    };
  }

  _getContextUsage() {
    const usage = this.session?.getContextUsage?.();
    const model = this.session?.model;
    const contextWindow = Number(usage?.contextWindow) > 0
      ? Number(usage.contextWindow)
      : Number(model?.contextWindow) > 0
        ? Number(model.contextWindow)
        : DEFAULT_CONTEXT_WINDOW;
    const tokens = typeof usage?.tokens === "number" ? usage.tokens : NaN;
    const hasTokens = Number.isFinite(tokens) && tokens >= 0;
    const percent = typeof usage?.percent === "number" ? usage.percent : NaN;
    return {
      tokens: hasTokens ? tokens : null,
      contextWindow,
      percent: Number.isFinite(percent) ? percent : hasTokens ? (tokens / contextWindow) * 100 : null,
    };
  }
}
