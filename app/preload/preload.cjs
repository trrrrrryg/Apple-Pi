// Preload：在渲染进程暴露受控 API（contextIsolation 开启时的安全桥）
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("piAgent", {
  createSession: (opts) => ipcRenderer.invoke("agent:createSession", opts),
  deleteSessionFile: (sessionFile) => ipcRenderer.invoke("agent:deleteSessionFile", { sessionFile }),
  selectProjectFolder: () => ipcRenderer.invoke("dialog:selectProjectFolder"),
  selectAttachments: () => ipcRenderer.invoke("dialog:selectAttachments"),
  prompt: (text, filePaths) => ipcRenderer.invoke("agent:prompt", { text, filePaths }),
  abort: () => ipcRenderer.invoke("agent:abort"),
  continue: () => ipcRenderer.invoke("agent:continue"),
  getState: () => ipcRenderer.invoke("agent:getState"),
  getHistory: () => ipcRenderer.invoke("agent:getHistory"),
  getHistoryForSession: (sessionFile) => ipcRenderer.invoke("agent:getHistoryForSession", { sessionFile }),
  getConversationInfo: () => ipcRenderer.invoke("agent:getConversationInfo"),
  runTerminalCommand: (payload) => ipcRenderer.invoke("terminal:run", payload),
  stopTerminalCommand: (requestId) => ipcRenderer.invoke("terminal:stop", { requestId }),
  getAppVersion: () => ipcRenderer.invoke("app:getVersion"),
  getEnvironmentStatus: () => ipcRenderer.invoke("app:getEnvironmentStatus"),
  compactConversation: () => ipcRenderer.invoke("agent:compactConversation"),
  copyConversation: (scope) => ipcRenderer.invoke("agent:copyConversation", { scope }),
  exportConversation: (format, title) => ipcRenderer.invoke("agent:exportConversation", { format, title }),
  loadTaskIndex: () => ipcRenderer.invoke("tasks:loadIndex"),
  saveTaskIndex: (index) => ipcRenderer.invoke("tasks:saveIndex", index),
  recoverMissingTaskSessions: () => ipcRenderer.invoke("tasks:recoverMissingSessions"),
  restoreDeletedSessionFile: (trashPath, sessionFile) => ipcRenderer.invoke("agent:restoreDeletedSessionFile", { trashPath, sessionFile }),

  // 密钥持久化到主进程（渲染进程拿不到明文回显）
  saveApiKey: (providerId, apiKey) => ipcRenderer.invoke("agent:saveApiKey", { providerId, apiKey }),
  listConfiguredProviders: () => ipcRenderer.invoke("agent:listConfiguredProviders"),
  loginOpenAICodex: () => ipcRenderer.invoke("agent:loginOpenAICodex"),
  submitOpenAICodexCallback: (value) => ipcRenderer.invoke("agent:submitOpenAICodexCallback", { value }),
  cancelOpenAICodexLogin: () => ipcRenderer.invoke("agent:cancelOpenAICodexLogin"),
  listCustomProviders: () => ipcRenderer.invoke("agent:listCustomProviders"),
  fetchCustomProviderModels: (provider) => ipcRenderer.invoke("agent:fetchCustomProviderModels", provider),
  createCustomProvider: (provider) => ipcRenderer.invoke("agent:createCustomProvider", provider),
  deleteCustomProvider: (providerId) => ipcRenderer.invoke("agent:deleteCustomProvider", { providerId }),
  getModelMultimodalCapabilities: () => ipcRenderer.invoke("agent:getModelMultimodalCapabilities"),
  setModelMultimodal: (providerId, modelId, enabled) => ipcRenderer.invoke("agent:setModelMultimodal", { providerId, modelId, enabled }),
  setProviderMultimodal: (providerId, enabled) => ipcRenderer.invoke("agent:setProviderMultimodal", { providerId, enabled }),
  getModelContextWindowSettings: () => ipcRenderer.invoke("agent:getModelContextWindowSettings"),
  setModelContextWindow: (providerId, modelId, oneMillion) => ipcRenderer.invoke("agent:setModelContextWindow", { providerId, modelId, oneMillion }),
  setModel: (modelRef) => ipcRenderer.invoke("agent:setModel", { modelRef }),
  getThinkingOptions: () => ipcRenderer.invoke("agent:getThinkingOptions"),
  setThinkingLevel: (level) => ipcRenderer.invoke("agent:setThinkingLevel", { level }),
  getExecutionMode: () => ipcRenderer.invoke("agent:getExecutionMode"),
  setExecutionMode: (mode) => ipcRenderer.invoke("agent:setExecutionMode", { mode }),
  getPlanPolicy: () => ipcRenderer.invoke("agent:getPlanPolicy"),
  setPlanPolicy: (policy) => ipcRenderer.invoke("agent:setPlanPolicy", { policy }),
  resolveToolApproval: (approvalId, approved) => ipcRenderer.invoke("agent:resolveToolApproval", { approvalId, approved }),
  openProjectFile: (reference) => ipcRenderer.invoke("agent:openProjectFile", { reference }),
  openExternalUrl: (url) => ipcRenderer.invoke("browser:openExternal", { url }),
  resolveBrowserAutomation: (requestId, result, error) => ipcRenderer.invoke("browser:automationResult", { requestId, result, error }),
  detectLocalModels: () => ipcRenderer.invoke("localModels:detect"),
  connectLocalModelRuntime: (runtime) => ipcRenderer.invoke("localModels:connect", { runtime }),
  getChangeReview: (cwd) => ipcRenderer.invoke("changes:getReview", { cwd }),
  acceptChangeFile: (cwd, filePath) => ipcRenderer.invoke("changes:acceptFile", { cwd, filePath }),
  revertChangeFile: (cwd, filePath) => ipcRenderer.invoke("changes:revertFile", { cwd, filePath }),
  getTavilySearchSettings: () => ipcRenderer.invoke("search:getTavilySettings"),
  saveTavilyApiKey: (apiKey) => ipcRenderer.invoke("search:saveTavilyApiKey", { apiKey }),
  openTavilyDashboard: () => ipcRenderer.invoke("search:openTavilyDashboard"),
  getMermaidDiagramSettings: () => ipcRenderer.invoke("agent:getMermaidDiagramSettings"),
  setMermaidDiagramEnabled: (enabled) => ipcRenderer.invoke("agent:setMermaidDiagramEnabled", { enabled }),
  copyMermaidDiagramPng: (dataUrl) => ipcRenderer.invoke("diagram:copyPng", { dataUrl }),
  saveMermaidDiagramPng: (dataUrl, title) => ipcRenderer.invoke("diagram:savePng", { dataUrl, title }),
  getIntegrationImportPreview: (force = false) => ipcRenderer.invoke("integrations:getImportPreview", { force }),
  importIntegrationCandidates: (selectedSources) => ipcRenderer.invoke("integrations:importCandidates", { selectedSources }),
  dismissIntegrationImport: () => ipcRenderer.invoke("integrations:dismissImport"),
  listIntegrations: () => ipcRenderer.invoke("integrations:list"),
  getMcpHealth: () => ipcRenderer.invoke("integrations:getHealth"),
  setIntegrationEnabled: (kind, id, enabled) => ipcRenderer.invoke("integrations:setEnabled", { kind, id, enabled }),

  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggleMaximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  isWindowMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  getDisplayZoom: () => ipcRenderer.invoke("window:getDisplayZoom"),
  setDisplayZoom: (zoom) => ipcRenderer.invoke("window:setDisplayZoom", zoom),
  openWindowMenu: (menuName, position) => ipcRenderer.invoke("window:openMenu", menuName, position),
  onWindowMaximizedChange: (callback) => {
    const listener = (_e, isMaximized) => callback(isMaximized);
    ipcRenderer.on("window:maximized", listener);
    return () => ipcRenderer.removeListener("window:maximized", listener);
  },
  onWindowMenuAction: (callback) => {
    const listener = (_e, action) => callback(action);
    ipcRenderer.on("window:menuAction", listener);
    return () => ipcRenderer.removeListener("window:menuAction", listener);
  },
  onDisplayZoomChange: (callback) => {
    const listener = (_e, info) => callback(info);
    ipcRenderer.on("window:displayZoom", listener);
    return () => ipcRenderer.removeListener("window:displayZoom", listener);
  },
  onTerminalOutput: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on("terminal:output", listener);
    return () => ipcRenderer.removeListener("terminal:output", listener);
  },

  /** 订阅主进程推送的事件 */
  onEvent: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on("agent:event", listener);
    return () => ipcRenderer.removeListener("agent:event", listener);
  },
  onState: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on("agent:state", listener);
    return () => ipcRenderer.removeListener("agent:state", listener);
  },
  onPlanUpdate: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on("agent:planUpdate", listener);
    return () => ipcRenderer.removeListener("agent:planUpdate", listener);
  },
  onError: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on("agent:error", listener);
    return () => ipcRenderer.removeListener("agent:error", listener);
  },
  onBrowserAutomationRequest: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on("browser:automationRequest", listener);
    return () => ipcRenderer.removeListener("browser:automationRequest", listener);
  },
  onToolApprovalRequested: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on("agent:approvalRequested", listener);
    return () => ipcRenderer.removeListener("agent:approvalRequested", listener);
  },
  onOpenAICodexLogin: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on("agent:openAICodexLogin", listener);
    return () => ipcRenderer.removeListener("agent:openAICodexLogin", listener);
  },

  // ---- 自动更新 ----
  checkForUpdates: () => ipcRenderer.invoke("updater:check"),
  downloadUpdate: () => ipcRenderer.invoke("updater:download"),
  installUpdate: () => ipcRenderer.invoke("updater:install"),
  getUpdateStatus: () => ipcRenderer.invoke("updater:getStatus"),
  getUpdatePreferences: () => ipcRenderer.invoke("updater:getPreferences"),
  setUpdateNotificationsDisabled: (disabled) => ipcRenderer.invoke("updater:setNotificationsDisabled", { disabled }),

  onUpdateChecking: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on("updater:checking", listener);
    return () => ipcRenderer.removeListener("updater:checking", listener);
  },
  onUpdateAvailable: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on("updater:available", listener);
    return () => ipcRenderer.removeListener("updater:available", listener);
  },
  onUpdateNotAvailable: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on("updater:not-available", listener);
    return () => ipcRenderer.removeListener("updater:not-available", listener);
  },
  onUpdateDownloadProgress: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on("updater:download-progress", listener);
    return () => ipcRenderer.removeListener("updater:download-progress", listener);
  },
  onUpdateDownloaded: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on("updater:downloaded", listener);
    return () => ipcRenderer.removeListener("updater:downloaded", listener);
  },
  onUpdateError: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on("updater:error", listener);
    return () => ipcRenderer.removeListener("updater:error", listener);
  },
  onUpdatePreferences: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on("updater:preferences", listener);
    return () => ipcRenderer.removeListener("updater:preferences", listener);
  },
});
