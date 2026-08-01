import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, screen, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AgentService } from "./agent-service.js";
import { acceptChangeFile, getChangeReview, revertChangeFile } from "./change-review-service.js";
import { TaskIndexService } from "./task-index-service.js";
import { UpdateService } from "./updater.js";
import { getEnvironmentStatus } from "./environment-service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ICON_PATH = path.join(__dirname, "..", "renderer", "assets", "app-icon-rounded.ico");
const UPDATE_FEED_URL = "http://47.93.10.125/apple-pi/updates/";

let win = null;
let agentService = null;
let updateService = null;
let displayZoomPreferences = {};
let displayZoomTimer = null;
let taskIndexService = null;
const terminalProcesses = new Map();

function sendToRenderer(channel, payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

// The sidebar index lives in Chromium local storage. Multiple Electron roots
// sharing this profile can overwrite it, so keep one desktop instance active.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
}

function isExpectedAbort(error) {
  return /request was aborted|operation was aborted|aborterror/i.test(String(error?.message ?? error ?? ""));
}

function getAppVersionInfo() {
  return {
    version: app.getVersion(),
    channel: app.isPackaged ? "正式安装版" : "开发版",
  };
}

function imageFromPngDataUrl(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
    throw new Error("图表图片数据无效");
  }
  if (dataUrl.length > 24 * 1024 * 1024) throw new Error("图表图片过大，无法导出");
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) throw new Error("图表图片无法读取");
  return image;
}

const DISPLAY_ZOOM_STEPS = new Set([1, 1.1, 1.25, 1.5]);
const BROWSER_ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function isAllowedBrowserUrl(value) {
  try {
    return BROWSER_ALLOWED_PROTOCOLS.has(new URL(String(value)).protocol);
  } catch {
    return false;
  }
}

async function resolveTerminalCwd(value) {
  const fallback = app.getPath("documents");
  const candidate = path.resolve(String(value || fallback));
  try {
    return (await fs.stat(candidate)).isDirectory() ? candidate : fallback;
  } catch {
    return fallback;
  }
}

function terminalCommand(shellType, command) {
  if (shellType === "cmd") return { file: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", command] };
  return { file: "powershell.exe", args: ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command] };
}

async function runTerminalCommand(event, { requestId, cwd, shellType, command } = {}) {
  const id = String(requestId || "");
  const input = String(command || "").trim();
  if (!id || !input) throw new Error("终端命令不能为空");
  if (terminalProcesses.has(id)) throw new Error("终端命令正在执行");
  if (input.length > 16000) throw new Error("终端命令过长");
  const workingDirectory = await resolveTerminalCwd(cwd);
  const spec = terminalCommand(shellType, input);
  return new Promise((resolve, reject) => {
    const child = spawn(spec.file, spec.args, { cwd: workingDirectory, windowsHide: true });
    terminalProcesses.set(id, child);
    const send = (stream, chunk) => event.sender.send("terminal:output", { requestId: id, stream, data: String(chunk) });
    child.stdout.on("data", (chunk) => send("stdout", chunk));
    child.stderr.on("data", (chunk) => send("stderr", chunk));
    child.once("error", (error) => { terminalProcesses.delete(id); reject(error); });
    child.once("close", (code, signal) => { terminalProcesses.delete(id); resolve({ cwd: workingDirectory, code, signal, shellType: shellType === "cmd" ? "cmd" : "powershell" }); });
  });
}

function stopTerminalCommand(requestId) {
  const child = terminalProcesses.get(String(requestId || ""));
  if (!child) return { ok: false };
  terminalProcesses.delete(String(requestId));
  if (process.platform === "win32" && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
  else child.kill("SIGTERM");
  return { ok: true };
}

function hardenBrowserGuest(guestContents) {
  guestContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const blockUnsafeNavigation = (event, url) => {
    if (!isAllowedBrowserUrl(url)) event.preventDefault();
  };
  guestContents.on("will-navigate", blockUnsafeNavigation);
  guestContents.on("will-redirect", blockUnsafeNavigation);
  guestContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  guestContents.session.setPermissionCheckHandler(() => false);
  guestContents.session.on("will-download", (event) => event.preventDefault());
}

function getDisplayZoomConfigPath() {
  return path.join(app.getPath("userData"), "display-zoom.json");
}

function normalizeDisplayZoom(value, fallback = 1) {
  const zoom = Number(value);
  return DISPLAY_ZOOM_STEPS.has(zoom) ? zoom : fallback;
}

async function loadDisplayZoomPreferences() {
  try {
    const stored = JSON.parse(await fs.readFile(getDisplayZoomConfigPath(), "utf8"));
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return;
    displayZoomPreferences = Object.fromEntries(
      Object.entries(stored).flatMap(([displayId, zoom]) =>
        DISPLAY_ZOOM_STEPS.has(Number(zoom)) ? [[displayId, Number(zoom)]] : []
      )
    );
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn("Unable to load display zoom preferences:", error);
  }
}

async function saveDisplayZoomPreferences() {
  await fs.writeFile(getDisplayZoomConfigPath(), JSON.stringify(displayZoomPreferences, null, 2), "utf8");
}

function getDisplayZoomInfo(targetWindow) {
  const display = screen.getDisplayMatching(targetWindow.getBounds());
  const displayId = String(display.id);
  // Let Chromium render at the operating system's native per-monitor DPI.
  // A forced fractional page zoom (previously 125% on 100% displays) causes a
  // second rasterization pass that can make text edges uneven on external panels.
  const zoom = normalizeDisplayZoom(displayZoomPreferences[displayId], 1);
  return { displayId, label: display.label || "当前显示器", zoom };
}

function applyDisplayZoom(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  const info = getDisplayZoomInfo(targetWindow);
  const currentZoom = targetWindow.webContents.getZoomFactor();
  const changed = Math.abs(currentZoom - info.zoom) > 0.001;
  if (changed) targetWindow.webContents.setZoomFactor(info.zoom);
  targetWindow.webContents.send("window:displayZoom", { ...info, changed });
}

function scheduleDisplayZoom(targetWindow) {
  clearTimeout(displayZoomTimer);
  displayZoomTimer = setTimeout(() => applyDisplayZoom(targetWindow), 120);
}

const IMAGE_MIME_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
]);

async function getAttachmentMetadata(filePath) {
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) return null;

  const extension = path.extname(filePath).toLowerCase();
  const mimeType = IMAGE_MIME_TYPES.get(extension) ?? null;
  let previewDataUrl = null;
  if (mimeType) {
    const image = nativeImage.createFromPath(filePath);
    if (!image.isEmpty()) {
      previewDataUrl = image.resize({ width: 96, height: 96, quality: "good" }).toDataURL();
    }
  }

  return {
    path: filePath,
    name: path.basename(filePath),
    size: stats.size,
    mimeType,
    previewDataUrl,
  };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0d1117",
    title: "苹果Pi",
    icon: APP_ICON_PATH,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false, // preload 需要 require，关闭 sandbox
    },
  });

  win.removeMenu();
  win.setMenuBarVisibility(false);
  // The application shell never needs to navigate away from its local renderer.
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    if (!isAllowedBrowserUrl(params.src)) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    params.partition = "persist:pi-browser";
  });
  win.webContents.on("did-attach-webview", (_event, guestContents) => hardenBrowserGuest(guestContents));

  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  }

  const sendMaximizedState = (isMaximized) => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send("window:maximized", isMaximized);
  };
  win.on("maximize", () => sendMaximizedState(true));
  win.on("unmaximize", () => sendMaximizedState(false));
  win.webContents.on("did-finish-load", () => {
    sendMaximizedState(win.isMaximized());
    applyDisplayZoom(win);
  });
  win.on("move", () => scheduleDisplayZoom(win));

  win.on("closed", () => {
    win = null;
  });
}

function setupIpc() {
  const send = sendToRenderer;

  const browserAutomationRequests = new Map();
  const runBrowserAutomation = (action, payload = {}) => new Promise((resolve, reject) => {
    const requestId = `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timeoutId = setTimeout(() => {
      browserAutomationRequests.delete(requestId);
      reject(new Error("浏览器自动化请求超时"));
    }, 30000);
    browserAutomationRequests.set(requestId, { resolve, reject, timeoutId });
    send("browser:automationRequest", { requestId, action, payload });
  });
  agentService = new AgentService(send, runBrowserAutomation);

  ipcMain.handle("tasks:loadIndex", async () => taskIndexService.load());
  ipcMain.handle("tasks:saveIndex", async (_event, index) => taskIndexService.save(index));
  ipcMain.handle("tasks:recoverMissingSessions", async () => taskIndexService.recoverMissingSessions());

  ipcMain.handle("agent:createSession", async (_e, opts) => {
    await agentService.createSession(opts);
    return { ok: true, ...agentService.getSessionInfo() };
  });

  ipcMain.handle("agent:deleteSessionFile", async (_e, { sessionFile }) => {
    return agentService.deleteSessionFile(sessionFile);
  });
  ipcMain.handle("agent:restoreDeletedSessionFile", async (_e, { trashPath, sessionFile }) => {
    return agentService.restoreDeletedSessionFile(trashPath, sessionFile);
  });

  ipcMain.handle("dialog:selectProjectFolder", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "选择项目文件夹",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("dialog:selectAttachments", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "选择附件",
      properties: ["openFile", "multiSelections"],
    });
    if (result.canceled) return [];
    const attachments = await Promise.all(result.filePaths.map((filePath) => getAttachmentMetadata(filePath)));
    return attachments.filter(Boolean);
  });

  ipcMain.handle("agent:prompt", async (_e, { text, filePaths }) => {
    // 不 await 完整 prompt（可能很长），立即返回，事件流推送进度
    agentService.prompt(text, filePaths).catch((err) => {
      // A user-triggered stop rejects the pending prompt by design. The final
      // idle state is sent separately, so it must not become a chat error.
      if (!isExpectedAbort(err)) send("agent:error", String(err?.message ?? err));
    });
    return { ok: true };
  });

  ipcMain.handle("agent:abort", async () => {
    await agentService.abort();
    return { ok: true };
  });

  ipcMain.handle("agent:continue", async () => {
    agentService.continue().catch((err) => {
      send("agent:error", String(err?.message ?? err));
    });
    return { ok: true };
  });

  ipcMain.handle("agent:getState", async () => {
    return agentService.getState();
  });

  ipcMain.handle("agent:getHistory", async () => {
    return agentService.getHistory();
  });
  ipcMain.handle("agent:getHistoryForSession", async (_event, { sessionFile } = {}) => {
    return agentService.getHistoryForSessionFile(sessionFile);
  });

  ipcMain.handle("agent:getConversationInfo", async () => agentService.getConversationInfo());
  ipcMain.handle("terminal:run", (event, payload) => runTerminalCommand(event, payload));
  ipcMain.handle("terminal:stop", (_event, { requestId } = {}) => stopTerminalCommand(requestId));
  ipcMain.handle("app:getVersion", async () => getAppVersionInfo());
  ipcMain.handle("app:getEnvironmentStatus", async () => getEnvironmentStatus({
    appVersion: app.getVersion(),
    appPath: app.getAppPath(),
  }));
  ipcMain.handle("agent:compactConversation", async () => agentService.compactConversation());
  ipcMain.handle("agent:copyConversation", async (_event, { scope } = {}) => {
    clipboard.writeText(agentService.getConversationText(scope));
    return { ok: true };
  });
  ipcMain.handle("agent:exportConversation", async (_event, { format, title } = {}) => {
    const exported = agentService.getConversationExport(format);
    const extension = exported.format === "json" ? "json" : "md";
    const baseName = String(title || "Pi 对话").replace(/[\\/:*?\"<>|]/g, "_").trim().slice(0, 80) || "Pi 对话";
    const result = await dialog.showSaveDialog(win, {
      title: "导出对话",
      defaultPath: `${baseName}.${extension}`,
      filters: [{ name: exported.format === "json" ? "JSON 文件" : "Markdown 文件", extensions: [extension] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await fs.writeFile(result.filePath, exported.content, "utf8");
    return { ok: true, filePath: result.filePath };
  });

  // 持久化某厂商的 API Key 到主进程 auth.json（渲染进程不接触明文）
  ipcMain.handle("agent:saveApiKey", async (_e, { providerId, apiKey }) => {
    return agentService.saveApiKey(providerId, apiKey);
  });

  // 列出已配置密钥的厂商 id（不含明文，用于模型选择器过滤）
  ipcMain.handle("agent:listConfiguredProviders", async () => {
    return agentService.listConfiguredProviders();
  });

  ipcMain.handle("agent:listCustomProviders", async () => {
    return agentService.listCustomProviders();
  });

  ipcMain.handle("agent:fetchCustomProviderModels", async (_e, provider) => {
    return agentService.fetchCustomProviderModels(provider);
  });

  ipcMain.handle("agent:createCustomProvider", async (_e, provider) => {
    return agentService.createCustomProvider(provider);
  });

  ipcMain.handle("agent:deleteCustomProvider", async (_e, { providerId }) => {
    return agentService.deleteCustomProvider(providerId);
  });

  ipcMain.handle("agent:getModelMultimodalCapabilities", async () => {
    return agentService.getModelMultimodalCapabilities();
  });

  ipcMain.handle("agent:setModelMultimodal", async (_e, { providerId, modelId, enabled }) => {
    return agentService.setModelMultimodal(providerId, modelId, enabled);
  });

  ipcMain.handle("agent:setProviderMultimodal", async (_e, { providerId, enabled }) => {
    return agentService.setProviderMultimodal(providerId, enabled);
  });

  ipcMain.handle("agent:getModelContextWindowSettings", async () => {
    return agentService.getModelContextWindowSettings();
  });

  ipcMain.handle("agent:setModelContextWindow", async (_e, { providerId, modelId, oneMillion }) => {
    return agentService.setModelContextWindow(providerId, modelId, oneMillion);
  });

  ipcMain.handle("search:getTavilySettings", async () => {
    return agentService.getTavilySearchSettings();
  });

  ipcMain.handle("search:saveTavilyApiKey", async (_e, { apiKey }) => {
    return agentService.saveTavilyApiKey(apiKey);
  });

  ipcMain.handle("search:openTavilyDashboard", async () => {
    await shell.openExternal("https://app.tavily.com/home");
    return { ok: true };
  });

  ipcMain.handle("agent:getMermaidDiagramSettings", async () => {
    return agentService.getMermaidDiagramSettings();
  });

  ipcMain.handle("agent:setMermaidDiagramEnabled", async (_e, { enabled }) => {
    return agentService.setMermaidDiagramEnabled(enabled);
  });

  ipcMain.handle("diagram:copyPng", async (_e, { dataUrl }) => {
    clipboard.writeImage(imageFromPngDataUrl(dataUrl));
    return { ok: true };
  });

  ipcMain.handle("diagram:savePng", async (_e, { dataUrl, title } = {}) => {
    const image = imageFromPngDataUrl(dataUrl);
    const baseName = String(title || "Mermaid 图表").replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 80) || "Mermaid 图表";
    const result = await dialog.showSaveDialog(win, {
      title: "保存图表图片",
      defaultPath: `${baseName}.png`,
      filters: [{ name: "PNG 图片", extensions: ["png"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await fs.writeFile(result.filePath, image.toPNG());
    return { ok: true, filePath: result.filePath };
  });

  ipcMain.handle("integrations:getImportPreview", async (_e, { force = false } = {}) => {
    return agentService.getIntegrationImportPreview(force);
  });

  ipcMain.handle("integrations:importCandidates", async (_e, { selectedSources } = {}) => {
    return agentService.importIntegrationCandidates(selectedSources);
  });

  ipcMain.handle("integrations:dismissImport", async () => {
    await agentService.dismissIntegrationImport();
    return { ok: true };
  });

  ipcMain.handle("integrations:list", async () => {
    return agentService.getIntegrations();
  });

  ipcMain.handle("integrations:getHealth", async () => {
    return agentService.getMcpHealth();
  });

  ipcMain.handle("integrations:setEnabled", async (_e, { kind, id, enabled }) => {
    return agentService.setIntegrationEnabled(kind, id, enabled);
  });

  // 记录当前模型选择（"provider/model"），下次 createSession 生效
  ipcMain.handle("agent:setModel", async (_e, { modelRef }) => {
    return agentService.setCurrentModel(modelRef);
  });

  ipcMain.handle("agent:getThinkingOptions", async () => {
    return agentService.getThinkingOptions();
  });

  ipcMain.handle("agent:setThinkingLevel", async (_e, { level }) => {
    return agentService.setThinkingLevel(level);
  });

  ipcMain.handle("agent:getExecutionMode", async () => agentService.getExecutionMode());
  ipcMain.handle("agent:setExecutionMode", async (_e, { mode }) => agentService.setExecutionMode(mode));
  ipcMain.handle("agent:resolveToolApproval", async (_e, { approvalId, approved }) => {
    return agentService.resolveToolApproval(approvalId, approved === true);
  });
  ipcMain.handle("agent:openProjectFile", async (_e, { reference }) => {
    return agentService.openProjectFileReference(reference);
  });

  ipcMain.handle("browser:openExternal", async (_e, { url }) => {
    const parsed = new URL(String(url ?? ""));
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("仅支持打开 HTTP 或 HTTPS 地址");
    await shell.openExternal(parsed.toString());
    return { ok: true };
  });

  ipcMain.handle("browser:automationResult", async (_e, { requestId, result, error } = {}) => {
    const pending = browserAutomationRequests.get(requestId);
    if (!pending) return { ok: false, stale: true };
    browserAutomationRequests.delete(requestId);
    clearTimeout(pending.timeoutId);
    if (error) pending.reject(new Error(String(error)));
    else pending.resolve(result);
    return { ok: true };
  });

  ipcMain.handle("localModels:detect", async () => agentService.detectLocalModels());
  ipcMain.handle("localModels:connect", async (_e, { runtime }) => agentService.connectLocalRuntime(runtime));

  const reviewCwd = (requestedCwd) => agentService.getSessionInfo().cwd || requestedCwd || process.cwd();
  ipcMain.handle("changes:getReview", async (_e, { cwd } = {}) => getChangeReview(reviewCwd(cwd)));
  ipcMain.handle("changes:acceptFile", async (_e, { cwd, filePath } = {}) => acceptChangeFile(reviewCwd(cwd), filePath));
  ipcMain.handle("changes:revertFile", async (_e, { cwd, filePath } = {}) => revertChangeFile(reviewCwd(cwd), filePath));

  // ---- 自动更新 ----
  ipcMain.handle("updater:check", async () => updateService?.checkForUpdates() ?? { enabled: false });
  ipcMain.handle("updater:download", async () => updateService?.downloadUpdate());
  ipcMain.handle("updater:install", async () => updateService?.quitAndInstall());
  ipcMain.handle("updater:getStatus", async () => updateService?.getStatus() ?? { enabled: false });
  ipcMain.handle("updater:getPreferences", async () => updateService?.getPreferences() ?? { notificationsDisabled: false });
  ipcMain.handle("updater:setNotificationsDisabled", async (_e, { disabled }) => updateService?.setNotificationsDisabled(disabled));

  ipcMain.handle("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle("window:toggleMaximize", (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    if (!targetWindow) return false;
    if (targetWindow.isMaximized()) targetWindow.unmaximize();
    else targetWindow.maximize();
    return targetWindow.isMaximized();
  });

  ipcMain.handle("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle("window:isMaximized", (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });

  ipcMain.handle("window:getDisplayZoom", (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    return targetWindow ? getDisplayZoomInfo(targetWindow) : { displayId: null, label: "当前显示器", zoom: 1 };
  });

  ipcMain.handle("window:setDisplayZoom", async (event, zoom) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    if (!targetWindow) throw new Error("窗口不可用");
    const info = getDisplayZoomInfo(targetWindow);
    const nextZoom = normalizeDisplayZoom(zoom, info.zoom);
    displayZoomPreferences[info.displayId] = nextZoom;
    await saveDisplayZoomPreferences();
    applyDisplayZoom(targetWindow);
    return { ...getDisplayZoomInfo(targetWindow), zoom: nextZoom };
  });

  ipcMain.handle("window:openMenu", (event, menuName, position = {}) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    if (!targetWindow) return;

    const sendMenuAction = (action) => targetWindow.webContents.send("window:menuAction", action);
    const templates = {
      file: [
        { label: "新建任务", click: () => sendMenuAction("new-task") },
        { type: "separator" },
        { label: "关闭窗口", role: "close" },
      ],
      edit: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
      ],
      view: [
        { label: "重新加载", role: "reload" },
        { label: "强制重新加载", role: "forceReload" },
        { type: "separator" },
        { label: "切换全屏", role: "togglefullscreen" },
      ],
      window: [
        { role: "minimize" },
        {
          label: targetWindow.isMaximized() ? "还原窗口" : "最大化窗口",
          click: () => targetWindow.isMaximized() ? targetWindow.unmaximize() : targetWindow.maximize(),
        },
        { type: "separator" },
        { role: "close" },
      ],
    };
    const template = templates[menuName];
    if (!template) return;

    const x = Number.isFinite(position.x) ? Math.max(0, Math.round(position.x)) : 0;
    const y = Number.isFinite(position.y) ? Math.max(0, Math.round(position.y)) : 34;
    Menu.buildFromTemplate(template).popup({ window: targetWindow, x, y });
  });
}

app.whenReady().then(async () => {
  app.setAppUserModelId("com.applepi.desktop");
  await loadDisplayZoomPreferences();
  taskIndexService = new TaskIndexService(app.getPath("userData"));
  setupIpc();
  screen.on("display-metrics-changed", () => scheduleDisplayZoom(win));

  // 自动更新初始化失败不能阻断窗口创建
  try {
    updateService = new UpdateService(sendToRenderer, { feedUrl: UPDATE_FEED_URL });
    await updateService.init();
  } catch (error) {
    console.error("[main] 更新服务初始化失败：", error?.message ?? error);
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let completingQuit = false;
const NORMAL_QUIT_CLEANUP_TIMEOUT_MS = 2500;
const UPDATE_QUIT_CLEANUP_TIMEOUT_MS = 750;

function waitForShutdownCleanup(cleanup, timeoutMs) {
  return Promise.race([
    Promise.resolve(cleanup),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

app.on("before-quit", (event) => {
  if (completingQuit) return;
  event.preventDefault();
  completingQuit = true;
  const installingUpdate = updateService?.isInstallRequested() === true;
  // MCP transports can occasionally stall while closing. An updater installer
  // cannot replace the application until this process exits, so update exits
  // only wait for the durable task index and use a short, bounded cleanup.
  const cleanup = installingUpdate
    ? Promise.all([taskIndexService?.flush()])
    : Promise.all([agentService?.dispose(), taskIndexService?.flush()]);
  const timeoutMs = installingUpdate ? UPDATE_QUIT_CLEANUP_TIMEOUT_MS : NORMAL_QUIT_CLEANUP_TIMEOUT_MS;
  void waitForShutdownCleanup(cleanup, timeoutMs).catch((error) => {
    console.error("Unable to flush application state before exit:", error);
  }).finally(() => app.quit());
});
