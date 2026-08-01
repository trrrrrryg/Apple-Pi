import mermaid from "../node_modules/mermaid/dist/mermaid.esm.min.mjs";

/**
 * 渲染进程 —— 一体式对话窗口（Codex 风格聊天气泡）
 * 用户消息靠右（深色气泡），AI 回复靠左（全宽，含 thinking 折叠块 + 工具卡片）
 */
const $ = (s) => document.querySelector(s);
const appShell = $("#app");
const chatEl = $("#chat");
const placeholderEl = $("#chat-placeholder");
const inputEl = $("#input");
const btnSend = $("#btn-send");
const btnAttachment = $("#btn-attachment");
const btnExecutionMode = $("#btn-execution-mode");
const executionModeMenu = $("#execution-mode-menu");
const executionModeLabel = $("#execution-mode-label");
const contextCompression = $("#context-compression");
const contextProgress = $("#context-progress");
const contextSummary = $("#context-summary");
const planListWrap = $("#plan-list-wrap");
const btnPlanList = $("#btn-plan-list");
const planListCount = $("#plan-list-count");
const planListPopover = $("#plan-list-popover");
const planListItems = $("#plan-list-items");
const btnChangeReview = $("#btn-change-review");
const changeReviewPanel = $("#change-review-panel");
const workbenchResizer = $("#workbench-resizer");
const terminalView = $("#terminal-view");
const btnWorkbenchBrowser = $("#btn-workbench-browser");
const btnWorkbenchTerminal = $("#btn-workbench-terminal");
const browserTabMenu = $("#browser-tab-menu");
const browserTabList = $("#browser-tab-list");
const terminalTypeMenu = $("#terminal-type-menu");
const terminalOutput = $("#terminal-output");
const terminalCommandForm = $("#terminal-command-form");
const terminalCommandInput = $("#terminal-command");
const terminalCwd = $("#terminal-cwd");
const terminalTypeLabel = $("#terminal-type-label");
const btnStopTerminal = $("#btn-stop-terminal");
const workbenchHelpPopover = $("#workbench-help-popover");
const attachmentListEl = $("#attachment-list");
const btnNewTask = $("#btn-new-task");
const btnThemeToggle = $("#btn-theme-toggle");
const themeToggleIcon = $("#theme-toggle-icon");
const conversationMenuWrap = $("#conversation-menu-wrap");
const btnConversationMenu = $("#btn-conversation-menu");
const conversationMenuPopover = $("#conversation-menu-popover");
const btnWindowMinimize = $("#btn-window-minimize");
const btnWindowMaximize = $("#btn-window-maximize");
const btnWindowClose = $("#btn-window-close");
const titlebarMenuButtons = document.querySelectorAll("[data-window-menu]");
const displayZoomSelect = $("#display-zoom-select");
const displayZoomDisplay = $("#display-zoom-display");
const appVersionDisplay = $("#app-version");
const appVersionChannel = $("#app-version-channel");
const updateBanner = $("#update-banner");
const updateBannerText = $("#update-banner-text");
const updateProgressBar = $("#update-progress-bar");
let displayZoomLayoutFrame = null;
const updateProgressText = $("#update-progress-text");
const btnUpdateDownload = $("#btn-update-download");
const btnUpdateDismiss = $("#btn-update-dismiss");
const updateStatus = $("#update-status");
const btnCheckUpdate = $("#btn-check-update");
const toggleUpdateNotifications = $("#toggle-update-notifications");
const statusDot = document.querySelector(".status-dot"); // 已移除，可能为 null
const statusText = $("#status-text");                    // 已移除，可能为 null

/* ---------------- 状态 ---------------- */
let sessionReady = false;
let isStreaming = false;
let isSwitchingTask = false;
let streamingTaskId = null;
let followLiveOutput = true;
let mermaidDiagramEnabled = true;
let mermaidSettingsNeedSessionRefresh = false;
// prompt() returns only after generation ends, so keep the stop control responsive
// while waiting for the first streaming event from the main process.
let streamStartPending = false;
let pendingAttachments = [];
// 当前 AI 消息块（流式累积）
let currentAiRow = null;
let currentAiTextEl = null;
let currentAiText = "";
let currentThinkingBody = null;
let currentAiHasContent = false;
let activeReadBatch = null;
const readToolEntries = new Map();
// 本地任务索引只保存导航元数据；消息内容由 Pi 的持久化会话文件保存。
const TASK_INDEX_STORAGE_KEY = "pi_task_index_v1";
const LEGACY_TASK_INDEX_STORAGE_KEYS = ["task_index_v1"];
const COLOR_THEME_STORAGE_KEY = "pi_color_theme";
const THINKING_LEVEL_STORAGE_KEY = "pi_thinking_level";
const BROWSER_OPEN_LOCATION_STORAGE_KEY = "pi_browser_open_location";
const WORKBENCH_WIDTH_STORAGE_KEY = "pi_workbench_width";
const BROWSER_TABS_STORAGE_KEY = "pi_workbench_browser_tabs_v1";
const THINKING_LEVEL_LABELS = {
  off: "关闭",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "很高",
  max: "最大",
};
const THEME_ICON_SOURCES = {
  light: {
    brand: "assets/logo-white.png",
    task: "assets/icons/task-list.png",
    folder: "assets/icons/folder.png",
    attachment: "assets/icons/attachment.png",
    toggle: "assets/icons/sun.png",
  },
  dark: {
    brand: "assets/logo-dark.png",
    task: "assets/icons/dark/task-list.png",
    folder: "assets/icons/dark/folder.png",
    attachment: "assets/icons/dark/attachment.png",
    toggle: "assets/icons/dark/moon.png",
  },
};
let colorTheme = "light";
let themeTransitionInProgress = false;
let tasks = [];
let projects = [];
let activeTaskId = null;
let executionMode = "ask";
let pendingToolApproval = null;
let updateDownloading = false;
let updateBannerDismissed = false;
let updateNotificationsDisabled = false;
let isMandatoryUpdate = false;
let compactionJustCompleted = false;
let activeTurnMetrics = null;
let currentContextTokens = null;
// Keep transient retry and error notices scoped to the task that produced them.
// The main process can report the same failure through the event stream, state
// snapshot, and IPC rejection, so the renderer must merge those reports.
const errorNoticeByKey = new Map();
const retryNoticeByTask = new Map();
const ERROR_DEDUPE_WINDOW_MS = 8000;

// Mirror the main-process gate so the UI only creates a plan for substantial
// work. Keep this local because the packaged renderer is loaded independently.
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

const BLOCKING_OVERLAY_SELECTOR = [
  "#conversation-tool-overlay:not(.hidden)",
  "#archive-overlay:not(.hidden)",
  "#settings-overlay:not(.hidden)",
  "#menu-settings-overlay:not(.hidden)",
  "#integration-import-overlay:not(.hidden)",
  "#model-picker.open",
  "#tool-approval-overlay:not(.hidden)",
].join(",");

function hasBlockingOverlay() {
  return Boolean(document.querySelector(BLOCKING_OVERLAY_SELECTOR));
}

function focusComposerWhenAvailable() {
  window.requestAnimationFrame(() => {
    if (document.visibilityState === "visible" && !hasBlockingOverlay()) {
      inputEl?.focus({ preventScroll: true });
    }
  });
}

function clearStartupInteractionBlockers() {
  document.querySelectorAll(
    "#conversation-tool-overlay, #archive-overlay, #settings-overlay, #menu-settings-overlay, #integration-import-overlay, #tool-approval-overlay"
  ).forEach((overlay) => {
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
  });
  const modelPicker = $("#model-picker");
  modelPicker?.classList.remove("open");
  modelPicker?.classList.add("hidden");
  modelPicker?.setAttribute("aria-hidden", "true");
  changeReviewPanel?.classList.remove("open");
  changeReviewPanel?.setAttribute("aria-hidden", "true");
  appShell?.classList.remove("workbench-open");
}

window.addEventListener("focus", focusComposerWhenAvailable);
inputEl?.addEventListener("pointerup", () => window.setTimeout(focusComposerWhenAvailable, 0));

const EXECUTION_MODE_LABELS = {
  "read-only": "只读",
  ask: "每次确认",
  auto: "自动执行",
};

/* ---------------- 工具 ---------------- */
let _restoring = false;
const CHAT_BOTTOM_THRESHOLD = 24;

function isNearChatBottom() {
  return chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight <= CHAT_BOTTOM_THRESHOLD;
}

function scrollToBottom({ force = false } = {}) {
  if (_restoring || (!force && !followLiveOutput)) return;
  chatEl.scrollTop = chatEl.scrollHeight;
}

chatEl.addEventListener("scroll", () => {
  followLiveOutput = isNearChatBottom();
}, { passive: true });
function hidePlaceholder() {
  // 同时隐藏当前 DOM 中的占位区（兼容缓存恢复后引用失效的情况）
  if (placeholderEl) placeholderEl.style.display = "none";
  const live = document.querySelector("#chat-placeholder");
  if (live) live.style.display = "none";
}
function escape(s) { return s; }

function themeIconSource(name) {
  return THEME_ICON_SOURCES[colorTheme][name];
}

function applyColorTheme(theme, persist = true) {
  colorTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = colorTheme;
  document.querySelectorAll("[data-theme-icon]").forEach((icon) => {
    icon.src = themeIconSource(icon.dataset.themeIcon);
  });
  if (themeToggleIcon) themeToggleIcon.src = themeIconSource("toggle");
  if (btnThemeToggle) {
    const nextThemeLabel = colorTheme === "dark" ? "切换到浅色模式" : "切换到深色模式";
    btnThemeToggle.title = nextThemeLabel;
    btnThemeToggle.setAttribute("aria-label", nextThemeLabel);
  }
  if (persist) localStorage.setItem(COLOR_THEME_STORAGE_KEY, colorTheme);
}

function initializeColorTheme() {
  applyColorTheme(localStorage.getItem(COLOR_THEME_STORAGE_KEY), false);
  const preloadIcons = () => {
    Object.values(THEME_ICON_SOURCES).forEach((themeIcons) => {
      Object.values(themeIcons).forEach((src) => {
        const image = new Image();
        image.src = src;
      });
    });
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(preloadIcons, { timeout: 1200 });
  else window.setTimeout(preloadIcons, 200);
}

function setWindowMaximizedState(isMaximized) {
  btnWindowMaximize?.classList.toggle("is-maximized", isMaximized);
  const label = isMaximized ? "还原窗口" : "最大化";
  btnWindowMaximize?.setAttribute("title", label);
  btnWindowMaximize?.setAttribute("aria-label", label);
}

async function initializeWindowControls() {
  if (!window.piAgent?.minimizeWindow) return;
  btnWindowMinimize?.addEventListener("click", () => window.piAgent.minimizeWindow());
  btnWindowMaximize?.addEventListener("click", async () => {
    setWindowMaximizedState(await window.piAgent.toggleMaximizeWindow());
  });
  btnWindowClose?.addEventListener("click", () => window.piAgent.closeWindow());
  window.piAgent.onWindowMaximizedChange(setWindowMaximizedState);
  setWindowMaximizedState(await window.piAgent.isWindowMaximized());
}

function renderDisplayZoom(info) {
  if (!info) return;
  if (displayZoomSelect) displayZoomSelect.value = String(info.zoom);
  if (displayZoomDisplay) displayZoomDisplay.textContent = info.label || "当前显示器";
  if (info.changed) stabilizeLayoutAfterDisplayZoom();
}

function stabilizeLayoutAfterDisplayZoom() {
  if (displayZoomLayoutFrame !== null) window.cancelAnimationFrame(displayZoomLayoutFrame);
  const shouldKeepChatAtBottom = followLiveOutput;
  displayZoomLayoutFrame = window.requestAnimationFrame(() => {
    displayZoomLayoutFrame = window.requestAnimationFrame(() => {
      displayZoomLayoutFrame = null;
      autoResize();
      setWorkbenchWidth(currentWorkbenchWidth());
      if (shouldKeepChatAtBottom) {
        chatEl.scrollTop = chatEl.scrollHeight;
        followLiveOutput = true;
      }
    });
  });
}

async function refreshDisplayZoom() {
  if (!window.piAgent?.getDisplayZoom) return;
  try {
    renderDisplayZoom(await window.piAgent.getDisplayZoom());
  } catch (error) {
    console.warn("Unable to get display zoom:", error);
  }
}

async function refreshAppVersion() {
  if (!window.piAgent?.getAppVersion || !appVersionDisplay) return;
  try {
    const info = await window.piAgent.getAppVersion();
    appVersionDisplay.textContent = `v${info?.version || "—"}`;
    if (appVersionChannel) appVersionChannel.textContent = info?.channel || "";
    updateBannerDismissed = false;
  } catch (error) {
    appVersionDisplay.textContent = "—";
    if (appVersionChannel) appVersionChannel.textContent = "无法读取版本信息";
    console.warn("Unable to get app version:", error);
  }
}

/* ---------------- 软件更新 ---------------- */
function showUpdateBanner(version, isMandatory = false) {
  // 必要更新：无视 dismiss 状态，必须展示
  if (!isMandatory && updateBannerDismissed) return;
  if (!updateBanner) return;
  updateBanner.classList.remove("hidden");
  updateBanner.setAttribute("aria-hidden", "false");
  if (updateBannerText) {
    const prefix = isMandatory ? "【必要更新】" : "";
    updateBannerText.textContent = version ? `${prefix}发现新版本 v${version}` : `${prefix}发现新版本`;
  }
  if (btnUpdateDownload) {
    btnUpdateDownload.classList.remove("hidden");
    btnUpdateDownload.disabled = false;
  }
  // 必要更新：隐藏关闭按钮，用户无法取消
  if (btnUpdateDismiss) {
    btnUpdateDismiss.classList.toggle("hidden", isMandatory);
  }
  if (isMandatory) {
    updateBanner.classList.add("is-mandatory");
  } else {
    updateBanner.classList.remove("is-mandatory");
  }
  updateDownloading = false;
  setUpdateProgressVisible(false);
}

function hideUpdateBanner() {
  if (updateBanner) {
    updateBanner.classList.add("hidden");
    updateBanner.setAttribute("aria-hidden", "true");
  }
}

function setUpdateProgressVisible(visible) {
  if (updateProgressBar) updateProgressBar.classList.toggle("hidden", !visible);
  if (updateProgressText) updateProgressText.classList.toggle("hidden", !visible);
}

function handleUpdateChecking() {
  if (updateStatus) updateStatus.textContent = "正在检查更新…";
}

function handleUpdateAvailable(info) {
  isMandatoryUpdate = info?.isMandatory === true;
  if (updateStatus) {
    const prefix = isMandatoryUpdate ? "【必要更新】" : "";
    updateStatus.textContent = info?.version ? `${prefix}发现新版本 v${info.version}` : `${prefix}有新版本可用`;
  }
  showUpdateBanner(info?.version, isMandatoryUpdate);
}

function handleUpdateNotAvailable() {
  if (updateStatus) updateStatus.textContent = "已是最新版本";
}

function handleUpdateDownloadProgress(progress) {
  updateDownloading = true;
  setUpdateProgressVisible(true);
  if (updateProgressBar) {
    updateProgressBar.value = progress.percent ?? 0;
    updateProgressBar.max = 100;
  }
  if (updateProgressText) updateProgressText.textContent = `${Math.round(progress.percent ?? 0)}%`;
  if (btnUpdateDownload) btnUpdateDownload.classList.add("hidden");
  if (updateStatus) updateStatus.textContent = `正在下载更新… ${Math.round(progress.percent ?? 0)}%`;
}

function handleUpdateDownloaded(info) {
  updateDownloading = false;
  setUpdateProgressVisible(false);
  const prefix = isMandatoryUpdate ? "【必要更新】" : "";
  if (updateStatus) updateStatus.textContent = info?.version ? `${prefix}v${info.version} 已下载，将在退出时安装` : `${prefix}更新已下载，将在退出时安装`;
  if (updateBanner && !updateBanner.classList.contains("hidden")) {
    if (updateBannerText) updateBannerText.textContent = isMandatoryUpdate ? "【必要更新】已下载，关闭应用时将自动安装" : "更新已下载，关闭应用时自动安装";
    if (btnUpdateDownload) btnUpdateDownload.classList.add("hidden");
  }
  // 必要更新无法关闭，不聚焦 dismiss 按钮
  if (!isMandatoryUpdate && btnUpdateDismiss) btnUpdateDismiss.focus();
}

function handleUpdateError(error) {
  updateDownloading = false;
  setUpdateProgressVisible(false);
  const isNetwork = error?.isNetwork !== false;
  if (updateStatus) updateStatus.textContent = isNetwork ? "检查失败，稍后重试" : `更新出错：${error?.message || "未知错误"}`;
  if (updateBanner && !updateBanner.classList.contains("hidden") && isNetwork) {
    hideUpdateBanner();
  }
  if (btnUpdateDownload) {
    btnUpdateDownload.classList.remove("hidden");
    btnUpdateDownload.disabled = false;
  }
}

async function onCheckUpdateClick() {
  if (!window.piAgent?.checkForUpdates || !updateStatus || !btnCheckUpdate) return;
  updateStatus.textContent = "正在检查更新…";
  btnCheckUpdate.disabled = true;
  try {
    const result = await window.piAgent.checkForUpdates();
    if (!result.enabled) {
      updateStatus.textContent = "仅正式安装版支持自动更新";
    } else if (result.updateAvailable) {
      updateStatus.textContent = result.version ? `发现新版本 v${result.version}` : "有新版本可用";
    } else if (result.error) {
      updateStatus.textContent = result.error;
    } else {
      updateStatus.textContent = "已是最新版本";
    }
  } catch (error) {
    updateStatus.textContent = `检查失败：${error?.message ?? error}`;
  } finally {
    btnCheckUpdate.disabled = false;
  }
}

async function onDownloadClick() {
  if (!window.piAgent?.downloadUpdate || !btnUpdateDownload) return;
  updateDownloading = true;
  btnUpdateDownload.disabled = true;
  btnUpdateDownload.textContent = "下载中…";
  try {
    await window.piAgent.downloadUpdate();
  } catch (error) {
    handleUpdateError({ message: error?.message ?? "下载失败", isNetwork: false });
  }
}

function onDismissBanner() {
  updateBannerDismissed = true;
  hideUpdateBanner();
}

function renderUpdateToggle() {
  if (!toggleUpdateNotifications) return;
  // The control represents "Stop update notifications", so its visual state
  // must match the persisted suppression state rather than its inverse.
  toggleUpdateNotifications.classList.toggle("is-enabled", updateNotificationsDisabled);
  toggleUpdateNotifications.setAttribute("aria-checked", String(updateNotificationsDisabled));
  toggleUpdateNotifications.title = updateNotificationsDisabled ? "已停止更新推送" : "停止更新推送";
}

async function onUpdateToggleClick() {
  if (!window.piAgent?.setUpdateNotificationsDisabled || !toggleUpdateNotifications) return;
  const nextDisabled = !updateNotificationsDisabled;
  toggleUpdateNotifications.disabled = true;
  try {
    const prefs = await window.piAgent.setUpdateNotificationsDisabled(nextDisabled);
    updateNotificationsDisabled = prefs?.notificationsDisabled === true;
    renderUpdateToggle();
  } catch (error) {
    addError(`更新推送设置失败：${error?.message ?? error}`);
  } finally {
    toggleUpdateNotifications.disabled = false;
  }
}

async function refreshUpdatePreferences() {
  if (!window.piAgent?.getUpdatePreferences) return;
  try {
    const prefs = await window.piAgent.getUpdatePreferences();
    updateNotificationsDisabled = prefs?.notificationsDisabled === true;
    renderUpdateToggle();
  } catch (error) {
    console.warn("Unable to get update preferences:", error);
  }
}

async function refreshUpdateStatus() {
  if (!window.piAgent?.getUpdateStatus || !updateStatus) return;
  try {
    const status = await window.piAgent.getUpdateStatus();
    if (!status.enabled) {
      updateStatus.textContent = status.disabledReason
        ? `自动更新不可用：${status.disabledReason}`
        : "仅正式安装版支持自动更新";
      if (btnCheckUpdate) btnCheckUpdate.disabled = true;
    } else {
      if (btnCheckUpdate) btnCheckUpdate.disabled = false;
      // The main process may complete its startup check before this renderer
      // finishes restoring a conversation. Recover a pending update here so
      // the notification is not lost with the early IPC event.
      const shouldShowPendingUpdate = status.latestVersion
        && (status.latestIsMandatory || status.notificationsDisabled !== true);
      if (shouldShowPendingUpdate) {
        handleUpdateAvailable({
          version: status.latestVersion,
          isMandatory: status.latestIsMandatory === true,
        });
      }
    }
  } catch (error) {
    console.warn("Unable to get update status:", error);
  }
}

function initializeUpdater() {
  if (!window.piAgent) return;

  window.piAgent.onUpdateChecking(handleUpdateChecking);
  window.piAgent.onUpdateAvailable(handleUpdateAvailable);
  window.piAgent.onUpdateNotAvailable(handleUpdateNotAvailable);
  window.piAgent.onUpdateDownloadProgress(handleUpdateDownloadProgress);
  window.piAgent.onUpdateDownloaded(handleUpdateDownloaded);
  window.piAgent.onUpdateError(handleUpdateError);
  window.piAgent.onUpdatePreferences((prefs) => {
    updateNotificationsDisabled = prefs?.notificationsDisabled === true;
    renderUpdateToggle();
  });

  if (btnCheckUpdate) btnCheckUpdate.addEventListener("click", onCheckUpdateClick);
  if (btnUpdateDownload) btnUpdateDownload.addEventListener("click", onDownloadClick);
  if (btnUpdateDismiss) btnUpdateDismiss.addEventListener("click", onDismissBanner);
  if (toggleUpdateNotifications) toggleUpdateNotifications.addEventListener("click", onUpdateToggleClick);

  refreshUpdateStatus();
  refreshUpdatePreferences();
}

function initializeDisplayZoom() {
  if (!displayZoomSelect || !window.piAgent?.getDisplayZoom) return;
  displayZoomSelect.addEventListener("change", async () => {
    try {
      renderDisplayZoom(await window.piAgent.setDisplayZoom(Number(displayZoomSelect.value)));
    } catch (error) {
      addError(`更新界面缩放失败：${error?.message ?? error}`);
      await refreshDisplayZoom();
    }
  });
  window.piAgent.onDisplayZoomChange?.(renderDisplayZoom);
  refreshDisplayZoom();
}

function initializeTitlebarMenus() {
  if (!window.piAgent?.openWindowMenu) return;
  titlebarMenuButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const rect = button.getBoundingClientRect();
      window.piAgent.openWindowMenu(button.dataset.windowMenu, { x: rect.left, y: rect.bottom });
    });
  });
  window.piAgent.onWindowMenuAction((action) => {
    if (action === "new-task") btnNewTask.click();
  });
}

function setConversationMenuOpen(isOpen) {
  if (!btnConversationMenu || !conversationMenuPopover) return;
  btnConversationMenu.setAttribute("aria-expanded", String(isOpen));
  conversationMenuPopover.classList.toggle("open", isOpen);
  conversationMenuPopover.setAttribute("aria-hidden", String(!isOpen));
}

btnConversationMenu?.addEventListener("click", (event) => {
  event.stopPropagation();
  setConversationMenuOpen(btnConversationMenu.getAttribute("aria-expanded") !== "true");
});

document.querySelector("[data-action='open-menu-settings']")?.addEventListener("click", () => {
  setConversationMenuOpen(false);
  openMenuSettings();
});

const conversationToolOverlay = $("#conversation-tool-overlay");
const conversationToolTitle = $("#conversation-tool-title");
const conversationToolBody = $("#conversation-tool-body");
const archiveOverlay = $("#archive-overlay");
const archiveList = $("#archive-list");

function openConversationTool(title, content) {
  if (!conversationToolOverlay || !conversationToolTitle || !conversationToolBody) return;
  conversationToolTitle.textContent = title;
  conversationToolBody.innerHTML = content;
  conversationToolOverlay.classList.remove("hidden");
  conversationToolOverlay.setAttribute("aria-hidden", "false");
}

function closeConversationTool() {
  conversationToolOverlay?.classList.add("hidden");
  conversationToolOverlay?.setAttribute("aria-hidden", "true");
}

async function createConversationBranch() {
  const source = currentTask();
  if (!source?.sessionFile) {
    addError("当前对话尚未生成可分支的会话记录。");
    return;
  }
  if (isStreaming) {
    addError("请先停止当前回复，再创建分支对话。");
    return;
  }
  const branch = {
    id: newId("task"),
    title: `${source.title || "对话"}（分支）`,
    projectId: source.projectId || null,
    sessionFile: null,
    forkSourceSessionFile: source.sessionFile,
    status: "idle",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    branchOfTaskId: source.id,
  };
  await switchTask(branch, true, true);
  if (!branch.sessionFile) return;
  delete branch.forkSourceSessionFile;
  tasks.unshift(branch);
  await saveTaskIndex();
  openTasksPanel();
}

function openConversationSearch() {
  openConversationTool("搜索当前对话", `
    <input id="conversation-search-input" class="conversation-search-input" type="search" autocomplete="off" placeholder="输入关键词搜索消息、代码或工具调用" aria-label="搜索当前对话" />
    <div id="conversation-search-results" class="conversation-search-results"><p>输入至少一个字符后显示结果。</p></div>`);
  const input = $("#conversation-search-input");
  const results = $("#conversation-search-results");
  const render = () => {
    const keyword = input.value.trim().toLowerCase();
    if (!keyword) { results.innerHTML = "<p>输入至少一个字符后显示结果。</p>"; return; }
    const rows = [...chatEl.querySelectorAll(".msg-row")];
    const matches = rows.filter((row) => row.textContent.toLowerCase().includes(keyword)).slice(0, 30);
    results.innerHTML = matches.length
      ? matches.map((row, index) => `<button type="button" class="conversation-search-result" data-search-result="${index}"><small>${row.classList.contains("user") ? "用户消息" : "助手消息"}</small><span>${escapeHtml(row.textContent.trim().replace(/\s+/g, " ").slice(0, 160))}</span></button>`).join("")
      : "<p>没有找到匹配内容。</p>";
    results.querySelectorAll("[data-search-result]").forEach((button) => button.addEventListener("click", () => {
      const row = matches[Number(button.dataset.searchResult)];
      if (!row) return;
      closeConversationTool();
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      row.classList.add("conversation-search-hit");
      setTimeout(() => row.classList.remove("conversation-search-hit"), 1200);
    }));
  };
  input.addEventListener("input", render);
  input.focus();
}

function openConversationExport() {
  openConversationTool("导出对话", `<p>导出会保留消息、代码块、工具调用和 Mermaid 源码。附件仅保留原始文件引用，不复制附件文件。</p><div class="conversation-tool-actions"><button type="button" data-export-format="json">导出 JSON</button><button type="button" class="primary" data-export-format="markdown">导出 Markdown</button></div>`);
  conversationToolBody.querySelectorAll("[data-export-format]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const result = await window.piAgent.exportConversation(button.dataset.exportFormat, currentTask()?.title || "Pi 对话");
      if (result?.ok) closeConversationTool();
    } catch (error) {
      addError(`导出对话失败：${error?.message ?? error}`);
    } finally { button.disabled = false; }
  }));
}

function openConversationCopy() {
  openConversationTool("复制对话", `<p>选择复制范围。复制内容为纯文本，便于粘贴到文档、邮件或其他工具。</p><div class="conversation-tool-actions"><button type="button" data-copy-scope="assistant">仅复制助手回复</button><button type="button" class="primary" data-copy-scope="all">复制全部对话</button></div>`);
  conversationToolBody.querySelectorAll("[data-copy-scope]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await window.piAgent.copyConversation(button.dataset.copyScope);
      button.textContent = "已复制";
      setTimeout(closeConversationTool, 420);
    } catch (error) { addError(`复制对话失败：${error?.message ?? error}`); }
  }));
}

async function buildConversationSummary() {
  const history = await window.piAgent.getHistory();
  const task = currentTask();
  const userRequests = history.filter((entry) => entry.role === "user").map((entry) => entry.text.trim()).filter(Boolean);
  const assistantMessages = history.filter((entry) => entry.role === "assistant").map((entry) => entry.text.trim()).filter(Boolean);
  const project = projectForTask(task);
  return [
    `目标：${userRequests.at(-1) || task?.title || "未命名对话"}`,
    project ? `项目：${project.name}` : "项目：未绑定项目",
    `进展：共 ${userRequests.length} 条用户消息、${assistantMessages.length} 条助手回复。`,
    userRequests.length > 1 ? `关键请求：\n${userRequests.slice(-4).map((text) => `- ${text.slice(0, 180)}`).join("\n")}` : "待办：补充下一步需求。",
  ].join("\n\n");
}

async function openConversationSummary() {
  const task = currentTask();
  if (!task) return;
  const draft = task.summary || await buildConversationSummary();
  openConversationTool("对话摘要", `<p>摘要保存在当前任务中，可在新对话或交接时直接复制使用。</p><textarea id="conversation-summary-input" class="conversation-summary-input" aria-label="对话摘要"></textarea><div class="conversation-tool-actions"><button type="button" data-summary-action="refresh">自动提取</button><button type="button" class="primary" data-summary-action="save">保存摘要</button></div>`);
  const input = $("#conversation-summary-input");
  input.value = draft;
  conversationToolBody.querySelector("[data-summary-action='refresh']")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    try { input.value = await buildConversationSummary(); } finally { event.currentTarget.disabled = false; }
  });
  conversationToolBody.querySelector("[data-summary-action='save']")?.addEventListener("click", () => {
    task.summary = input.value.trim();
    saveTaskIndex();
    closeConversationTool();
  });
}

async function openConversationInfo() {
  try {
    const info = await window.piAgent.getConversationInfo();
    const usage = info.contextUsage;
    const rows = [
      ["任务", currentTask()?.title || "未命名对话"],
      ["项目", projectForTask(currentTask())?.name || "未绑定项目"],
      ["模型", info.model || "未选择"],
      ["推理强度", info.thinkingLevel || "关闭"],
      ["消息数", String(info.messageCount || 0)],
      ["上下文", usage?.contextWindow ? `${Number(usage.tokens || 0).toLocaleString()} / ${Number(usage.contextWindow).toLocaleString()}` : "尚无统计"],
      ["会话文件", info.sessionFile || "尚未创建"],
      ["工作目录", info.cwd || "默认目录"],
    ];
    openConversationTool("会话信息", `<dl class="conversation-info-grid">${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>`);
  } catch (error) { addError(`读取会话信息失败：${error?.message ?? error}`); }
}

const ENVIRONMENT_GROUPS = [
  { id: "bundled", title: "应用内置", description: "随安装包提供，无需额外安装" },
  { id: "system", title: "系统必需", description: "保证桌面端基础能力可用" },
  { id: "optional", title: "可选工具", description: "按 Git 审查、脚本或本地模型功能按需安装" },
];

function environmentStateLabel(entry) {
  if (entry.state === "ready") return "已就绪";
  if (entry.state === "not-running") return "未运行";
  return entry.required ? "需要安装" : "未安装";
}

function renderEnvironmentReport(report) {
  const entries = Array.isArray(report?.entries) ? report.entries : [];
  const summary = report?.allRequiredReady
    ? `核心环境已就绪（${report.requiredReady}/${report.requiredTotal}）`
    : `核心环境待处理（${report?.requiredReady ?? 0}/${report?.requiredTotal ?? 0}）`;
  const groups = ENVIRONMENT_GROUPS.map((group) => {
    const groupEntries = entries.filter((entry) => entry.group === group.id);
    if (!groupEntries.length) return "";
    return `<section class="environment-group"><div class="environment-group-head"><div><h4>${group.title}</h4><p>${group.description}</p></div></div><div class="environment-list">${groupEntries.map((entry) => `<article class="environment-row state-${escapeHtml(entry.state || "missing")}"><span class="environment-indicator" aria-hidden="true"></span><div class="environment-info"><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.detail || "暂无状态信息")}</small></div><span class="environment-state">${environmentStateLabel(entry)}</span></article>`).join("")}</div></section>`;
  }).join("");
  return `<div class="environment-report"><div class="environment-summary ${report?.allRequiredReady ? "ready" : "attention"}"><div><strong>${summary}</strong><small>检测时间：${new Date(report?.checkedAt || Date.now()).toLocaleTimeString()}</small></div><button type="button" class="environment-refresh" data-action="refresh-environment">重新检测</button></div>${groups}</div>`;
}

async function openEnvironmentStatus() {
  closeAccountPopover();
  openConversationTool("运行环境", '<div class="environment-loading">正在检测本机运行环境…</div>');
  const render = async () => {
    const refresh = conversationToolBody?.querySelector("[data-action='refresh-environment']");
    if (refresh) refresh.disabled = true;
    try {
      const report = await window.piAgent.getEnvironmentStatus();
      if (conversationToolOverlay?.classList.contains("hidden") || conversationToolTitle?.textContent !== "运行环境") return;
      conversationToolBody.innerHTML = renderEnvironmentReport(report);
      conversationToolBody.querySelector("[data-action='refresh-environment']")?.addEventListener("click", render);
    } catch (error) {
      if (!conversationToolOverlay?.classList.contains("hidden") && conversationToolTitle?.textContent === "运行环境") {
        conversationToolBody.innerHTML = `<div class="environment-loading is-error">环境检测失败：${escapeHtml(error?.message ?? error)}</div>`;
      }
    } finally {
      if (refresh) refresh.disabled = false;
    }
  };
  await render();
}

async function compactCurrentConversation() {
  if (isStreaming) { addError("请等待当前回复结束后再压缩上下文。"); return; }
  try {
    await window.piAgent.compactConversation();
  } catch (error) { addError(`压缩上下文失败：${error?.message ?? error}`); }
}

document.querySelectorAll("[data-action^='conversation-']").forEach((button) => button.addEventListener("click", async () => {
  const action = button.dataset.action;
  setConversationMenuOpen(false);
  if (action === "conversation-new") await createTask();
  if (action === "conversation-search") openConversationSearch();
  if (action === "conversation-export") openConversationExport();
  if (action === "conversation-fork") createConversationBranch();
  if (action === "conversation-compact") await compactCurrentConversation();
  if (action === "conversation-summary") await openConversationSummary();
  if (action === "conversation-copy") openConversationCopy();
  if (action === "conversation-archive") await archiveTask(currentTask());
  if (action === "conversation-info") await openConversationInfo();
}));

$("#btn-close-conversation-tool")?.addEventListener("click", closeConversationTool);
conversationToolOverlay?.querySelector(".conversation-tool-backdrop")?.addEventListener("click", closeConversationTool);

document.addEventListener("pointerdown", (event) => {
  if (conversationMenuWrap && !conversationMenuWrap.contains(event.target)) setConversationMenuOpen(false);
});

function toggleColorThemeWithReveal() {
  if (themeTransitionInProgress) return;
  const nextTheme = colorTheme === "light" ? "dark" : "light";
  const revealOrigin = btnThemeToggle?.getBoundingClientRect();
  if (revealOrigin) {
    const originX = revealOrigin.left + revealOrigin.width / 2;
    const originY = revealOrigin.top + revealOrigin.height / 2;
    const revealRadius = Math.hypot(
      Math.max(originX, window.innerWidth - originX),
      Math.max(originY, window.innerHeight - originY),
    ) + 2;
    document.documentElement.style.setProperty("--theme-origin-x", `${originX}px`);
    document.documentElement.style.setProperty("--theme-origin-y", `${originY}px`);
    document.documentElement.style.setProperty("--theme-reveal-radius", `${revealRadius}px`);
  }

  const applyNextTheme = () => applyColorTheme(nextTheme);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || reducedMotion) {
    applyNextTheme();
    return;
  }

  themeTransitionInProgress = true;
  document.startViewTransition(applyNextTheme).finished
    .catch(() => {})
    .finally(() => { themeTransitionInProgress = false; });
}

/* ---------------- 消息 DOM ---------------- */
function integrationIconMarkup(kind, className = "") {
  if (kind === "skill") {
    return `<svg class="skill-line-icon ${className}" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 1.5 9.65 6.35 14.5 8 9.65 9.65 8 14.5 6.35 9.65 1.5 8 6.35 6.35 8 1.5Z"/><path d="M13 2.4v2.2M14.1 3.5h-2.2"/></svg>`;
  }
  return "🔗";
}

function addUserMsg(text, attachments = [], tags = []) {
  hidePlaceholder();
  const row = document.createElement("div");
  row.className = "msg-row user";
  row.innerHTML = `<div class="msg-inner"><div class="message-tags"></div><div class="message-attachments"></div><div class="bubble"></div></div>`;
  // 渲染 Skill/MCP 标签（蓝色高亮 + 图标）
  const tagsEl = row.querySelector(".message-tags");
  if (tags.length) {
    tags.forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip msg-tag";
      chip.innerHTML = `<span class="tag-icon">${integrationIconMarkup(tag.kind)}</span>${escapeIntegrationText(tag.name)}`;
      tagsEl.appendChild(chip);
    });
  } else tagsEl.remove();
  const attachmentEl = row.querySelector(".message-attachments");
  attachments.forEach((attachment) => {
    const item = document.createElement("div");
    item.className = "message-attachment";
    item.textContent = attachment.name;
    attachmentEl.appendChild(item);
  });
  if (attachments.length === 0) attachmentEl.remove();
  row.querySelector(".bubble").textContent = text || `已附加 ${attachments.length} 个文件`;
  chatEl.appendChild(row);
  scrollToBottom({ force: true });
}

function renderPendingAttachments() {
  attachmentListEl.innerHTML = "";
  pendingAttachments.forEach((attachment) => {
    const card = document.createElement("div");
    card.className = "attachment-card";
    card.title = attachment.path;
    if (attachment.previewDataUrl) {
      const preview = document.createElement("img");
      preview.className = "attachment-preview";
      preview.src = attachment.previewDataUrl;
      preview.alt = "";
      card.appendChild(preview);
    } else {
      const icon = document.createElement("span");
      icon.className = "attachment-file-icon";
      const extension = attachment.name.includes(".") ? attachment.name.split(".").pop().slice(0, 4).toUpperCase() : "FILE";
      icon.textContent = extension;
      card.appendChild(icon);
    }
    const name = document.createElement("span");
    name.className = "attachment-name";
    name.textContent = attachment.name;
    card.appendChild(name);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "attachment-remove";
    remove.title = `移除 ${attachment.name}`;
    remove.setAttribute("aria-label", remove.title);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      pendingAttachments = pendingAttachments.filter((item) => item.path !== attachment.path);
      renderPendingAttachments();
      updateComposerState();
    });
    card.appendChild(remove);
    attachmentListEl.appendChild(card);
  });
}

async function selectAttachments() {
  if (isStreaming) return;
  try {
    const selected = await window.piAgent.selectAttachments();
    const knownPaths = new Set(pendingAttachments.map((attachment) => attachment.path));
    pendingAttachments.push(...selected.filter((attachment) => !knownPaths.has(attachment.path)));
    renderPendingAttachments();
    updateComposerState();
    inputEl.focus();
  } catch (error) {
    addError(`添加附件失败：${error?.message ?? error}`);
  }
}

function normalizeAssistantPlainText(text) {
  let normalized = String(text ?? "")
    // Keep the link destination while removing Markdown link punctuation.
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1: $2")
    // Convert structural Markdown into ordinary paragraphs instead of showing
    // the raw markers in the conversation UI.
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+(?=\S)/gm, "")
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, "")
    .replace(/~~([^\n~]+)~~/g, "$1");

  // Two passes handle common nested emphasis without touching code blocks.
  for (let pass = 0; pass < 2; pass += 1) {
    normalized = normalized
      .replace(/\*\*([^\n*]+)\*\*/g, "$1")
      .replace(/(^|[^\w*])\*([^\n*]+)\*/g, "$1$2");
  }
  return normalized;
}

function appendTextSegment(container, text) {
  text = normalizeAssistantPlainText(text);
  if (!text) return;
  const segment = document.createElement("div");
  segment.className = "ai-text-segment";
  const tokenPattern = /`[^`\n]+\.(?:js|cjs|mjs|ts|tsx|jsx|vue|html|css|scss|less|json|jsonl|md|mdx|txt|yml|yaml|toml|ini|env|py|java|go|rs|c|h|cpp|hpp|cs|php|rb|swift|kt|sql|xml|sh|bat|ps1|png|jpe?g|gif|webp|svg|pdf|docx?|xlsx?|pptx?)`|https?:\/\/[^\s<>()]+|[A-Za-z]:[\\/][^<>:"|?*\r\n]+?\.(?:js|cjs|mjs|ts|tsx|jsx|vue|html|css|scss|less|json|jsonl|md|mdx|txt|yml|yaml|toml|ini|env|py|java|go|rs|c|h|cpp|hpp|cs|php|rb|swift|kt|sql|xml|sh|bat|ps1|png|jpe?g|gif|webp|svg|pdf|docx?|xlsx?|pptx?)(?![A-Za-z0-9_])|(?:[A-Za-z0-9_.-]+[\\/])*[A-Za-z0-9_\-\u4e00-\u9fff.]+\.(?:js|cjs|mjs|ts|tsx|jsx|vue|html|css|scss|less|json|jsonl|md|mdx|txt|yml|yaml|toml|ini|env|py|java|go|rs|c|h|cpp|hpp|cs|php|rb|swift|kt|sql|xml|sh|bat|ps1|png|jpe?g|gif|webp|svg|pdf|docx?|xlsx?|pptx?)/gi;
  let lastIndex = 0;
  for (const match of text.matchAll(tokenPattern)) {
    const value = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) segment.appendChild(document.createTextNode(text.slice(lastIndex, index)));
    const isUrl = /^https?:\/\//i.test(value);
    let target = value.startsWith("`") ? value.slice(1, -1) : value;
    let suffix = "";
    if (isUrl) {
      const trimmed = value.match(/^(.*?)([.,;:!?]+)?$/);
      target = trimmed?.[1] || value;
      suffix = trimmed?.[2] || "";
    }
    const link = document.createElement("button");
    link.type = "button";
    link.className = `inline-link ${isUrl ? "url-link" : "file-link"}`;
    link.textContent = target;
    link.title = isUrl ? "打开链接" : "打开文件";
    link.addEventListener("click", async () => {
      try {
        if (isUrl) await openConversationUrl(target);
        else await window.piAgent.openProjectFile(target);
      } catch (error) {
        addError(`${isUrl ? "打开链接" : "打开文件"}失败：${error?.message ?? error}`);
      }
    });
    segment.appendChild(link);
    if (suffix) segment.appendChild(document.createTextNode(suffix));
    lastIndex = index + value.length;
  }
  if (lastIndex < text.length) segment.appendChild(document.createTextNode(text.slice(lastIndex)));
  container.appendChild(segment);
}

function copyCodeText(text, button) {
  const copy = navigator.clipboard?.writeText
    ? navigator.clipboard.writeText(text)
    : new Promise((resolve, reject) => {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      copied ? resolve() : reject(new Error("Clipboard unavailable"));
    });

  copy.then(() => {
    button.classList.add("copied");
    button.title = "已复制";
    button.setAttribute("aria-label", "已复制代码");
    clearTimeout(button.copyResetTimer);
    button.copyResetTimer = setTimeout(() => {
      button.classList.remove("copied");
      button.title = "复制代码";
      button.setAttribute("aria-label", "复制代码");
    }, 1600);
  }).catch(() => {
    button.title = "复制失败";
    setTimeout(() => { button.title = "复制代码"; }, 1600);
  });
}

function appendCodeBlock(container, language, source) {
  const frame = document.createElement("section");
  frame.className = "code-block";
  const header = document.createElement("div");
  header.className = "code-block-header";
  const label = document.createElement("span");
  label.className = "code-block-language";
  label.textContent = language || "代码";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "code-copy-button";
  copy.title = "复制代码";
  copy.setAttribute("aria-label", "复制代码");
  copy.innerHTML = '<span class="code-copy-icon" aria-hidden="true"></span>';
  copy.addEventListener("click", () => copyCodeText(source, copy));
  header.append(label, copy);

  const body = document.createElement("div");
  body.className = "code-block-body";
  const lines = source.split("\n");
  const lineNumbers = document.createElement("span");
  lineNumbers.className = "code-line-numbers";
  lineNumbers.textContent = lines.map((_, index) => index + 1).join("\n");
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = source;
  pre.appendChild(code);
  body.append(lineNumbers, pre);
  frame.append(header, body);
  container.appendChild(frame);
}

function isMermaidLanguage(language) {
  return /^(?:mermaid|mmd)$/i.test(String(language ?? "").trim());
}

let mermaidRenderCount = 0;

function createMermaidDiagram(source, title = "Mermaid") {
  const figure = document.createElement("section");
  figure.className = "mermaid-diagram";
  const header = document.createElement("div");
  header.className = "mermaid-diagram-header";
  const label = document.createElement("span");
  label.className = "mermaid-diagram-title";
  label.textContent = title || "Mermaid";
  const actions = document.createElement("div");
  actions.className = "mermaid-diagram-actions";
  const copyCode = document.createElement("button");
  copyCode.type = "button";
  copyCode.className = "mermaid-copy-button";
  copyCode.title = "复制 Mermaid 代码";
  copyCode.setAttribute("aria-label", "复制 Mermaid 代码");
  copyCode.textContent = "复制代码";
  copyCode.addEventListener("click", () => copyCodeText(source, copyCode));
  const copyImage = document.createElement("button");
  copyImage.type = "button";
  copyImage.className = "mermaid-copy-button";
  copyImage.title = "复制图片";
  copyImage.setAttribute("aria-label", "复制图片");
  copyImage.textContent = "复制图片";
  copyImage.addEventListener("click", () => exportMermaidDiagram(figure, title, copyImage, "copy"));
  const saveImage = document.createElement("button");
  saveImage.type = "button";
  saveImage.className = "mermaid-copy-button";
  saveImage.title = "保存图片";
  saveImage.setAttribute("aria-label", "保存图片");
  saveImage.textContent = "保存图片";
  saveImage.addEventListener("click", () => exportMermaidDiagram(figure, title, saveImage, "save"));
  actions.append(copyCode, copyImage, saveImage);
  header.append(label, actions);
  const canvas = document.createElement("div");
  canvas.className = "mermaid-diagram-canvas";
  canvas.setAttribute("aria-label", title || "Mermaid 图表");
  figure.append(header, canvas);
  renderMermaidSource(canvas, source, figure);
  return figure;
}

async function mermaidDiagramPngDataUrl(figure) {
  const svg = figure.querySelector("svg");
  if (!svg) throw new Error("图表尚未渲染完成");
  const viewBox = svg.viewBox?.baseVal;
  const width = Math.max(1, Math.ceil(viewBox?.width || svg.clientWidth || 640));
  const height = Math.max(1, Math.ceil(viewBox?.height || svg.clientHeight || 360));
  const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器无法导出图片");
  const serialized = new XMLSerializer().serializeToString(svg);
  const utf8 = new TextEncoder().encode(serialized);
  let binary = "";
  for (const byte of utf8) binary += String.fromCharCode(byte);
  const imageUrl = `data:image/svg+xml;base64,${btoa(binary)}`;
  const image = await new Promise((resolve, reject) => {
    const next = new Image();
    next.onload = () => resolve(next);
    next.onerror = () => reject(new Error("图表转换失败"));
    next.src = imageUrl;
  });
  context.scale(scale, scale);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

async function exportMermaidDiagram(figure, title, button, action) {
  const originalLabel = button.textContent;
  button.disabled = true;
  try {
    const dataUrl = await mermaidDiagramPngDataUrl(figure);
    const result = action === "copy"
      ? await window.piAgent.copyMermaidDiagramPng(dataUrl)
      : await window.piAgent.saveMermaidDiagramPng(dataUrl, title);
    if (result?.canceled) return;
    button.textContent = action === "copy" ? "已复制" : "已保存";
    setTimeout(() => { button.textContent = originalLabel; }, 1400);
  } catch (error) {
    button.textContent = "失败";
    addError(`导出图表图片失败：${error?.message ?? error}`);
    setTimeout(() => { button.textContent = originalLabel; }, 1800);
  } finally {
    button.disabled = false;
  }
}

async function renderMermaidSource(canvas, source, figure) {
  const renderId = `pi-mermaid-${Date.now()}-${mermaidRenderCount += 1}`;
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: colorTheme === "dark" ? "dark" : "default",
      flowchart: { htmlLabels: false },
    });
    const { svg } = await mermaid.render(renderId, source);
    if (!canvas.isConnected) return;
    canvas.innerHTML = svg;
    figure?.classList.remove("is-error");
    scrollToBottom();
  } catch (error) {
    if (!canvas.isConnected) return;
    figure?.classList.add("is-error");
    canvas.textContent = `图表无法渲染：${String(error?.message ?? error).replace(/\s+/g, " ").slice(0, 180)}`;
  }
}

function appendMermaidDiagram(container, source, title) {
  if (!mermaidDiagramEnabled) {
    appendCodeBlock(container, "mermaid", source);
    return;
  }
  container.appendChild(createMermaidDiagram(source, title));
}

function renderAssistantContent(container, text) {
  text = stripPlanPayload(text);
  container.innerHTML = "";
  const fences = /```([^\n`]*)\n?([\s\S]*?)(?:\n?```|$)/g;
  let start = 0;
  let match;
  while ((match = fences.exec(text)) !== null) {
    appendTextSegment(container, text.slice(start, match.index));
    const language = match[1].trim();
    const isClosedFence = /```\s*$/.test(match[0]);
    if (isMermaidLanguage(language) && isClosedFence) appendMermaidDiagram(container, match[2]);
    else appendCodeBlock(container, language, match[2]);
    start = fences.lastIndex;
  }
  appendTextSegment(container, text.slice(start));
}

function addAssistantHistory(text) {
  hidePlaceholder();
  const row = document.createElement("div");
  row.className = "msg-row assistant";
  row.innerHTML = `<div class="msg-inner"><div class="ai-block"></div></div>`;
  renderAssistantContent(row.querySelector(".ai-block"), text);
  chatEl.appendChild(row);
}

async function restoreTaskHistory(historyOverride = null) {
  let history = historyOverride;
  if (!history) {
    try {
      history = await window.piAgent.getHistory();
    } catch (error) {
      console.warn("Unable to restore task history:", error);
      return;
    }
  }
  if (!Array.isArray(history) || history.length === 0) {
    // 无历史：恢复默认占位文字，不清除 placeholder
    const p = document.querySelector("#chat-placeholder p");
    if (p && p.textContent === "正在恢复对话…") p.textContent = "描述你的任务，按发送与 Agent 开始对话。";
    return;
  }
  _restoring = true;
  // 批量构建 HTML 并一次性插入，避免逐条 DOM 操作引发的重排
  const fragments = [];
  const assistantHistoryTexts = [];
  const historyToolArgs = new Map();
  const task = currentTask();
  const historyTokenTotals = [];
  let previousHistoryInputTokens = null;
  let historyTurn = -1;
  const appendHistoryMetrics = (turn) => {
    const saved = Array.isArray(task?.turnMetrics) ? task.turnMetrics.find((item) => item?.turn === turn) : null;
    const fallbackTokens = historyTokenTotals[turn] || 0;
    // Older builds persisted the full context as the turn total. Prefer the
    // recomputed per-turn value unless the saved metric uses the new scope.
    const trustedSaved = saved?.tokenScope === "turn_delta_v1" ? saved : null;
    if (trustedSaved || fallbackTokens > 0) fragments.push(renderTurnMetricsHtml(trustedSaved || { turn, tokens: fallbackTokens }));
  };
  let pendingToolId = null;
  history.forEach((message) => {
    if (message.role === "user") {
      if (historyTurn >= 0) appendHistoryMetrics(historyTurn);
      historyTurn += 1;
      fragments.push(`<div class="msg-row user"><div class="msg-inner"><div class="bubble">${escapeHtml(message.text)}</div></div></div>`);
    }
    if (message.role === "assistant") {
      if (historyTurn >= 0) {
        const attributed = turnTokenDelta(message.usage, previousHistoryInputTokens);
        historyTokenTotals[historyTurn] = (historyTokenTotals[historyTurn] || 0) + attributed.tokens;
        previousHistoryInputTokens = attributed.inputTokens;
      }
      const historyIndex = assistantHistoryTexts.push(message.text) - 1;
      fragments.push(`<div class="msg-row assistant"><div class="msg-inner"><div class="ai-block" data-history-index="${historyIndex}">${escapeHtml(message.text)}</div></div></div>`);
    }
    if (message.role === "thinking") {
      fragments.push(`<div class="msg-row assistant"><div class="msg-inner"><div class="thinking">
        <div class="thinking-head">思考</div>
        <div class="thinking-body" style="max-height:0">${escapeHtml(message.text)}</div>
      </div></div></div>`);
    }
    if (message.role === "toolCall") {
      if (isInternalPlanTool(message.name)) return;
      pendingToolId = message.id;
      historyToolArgs.set(message.id, message.args);
      const pres = getToolPresentation(message.name, message.args);
      fragments.push(`<div class="msg-row assistant"><div class="msg-inner"><div class="tool-card tool-${pres.kind}" data-tool-id="${escapeHtml(message.id)}" data-tool-name="${escapeHtml(message.name)}">
        <button class="tool-head" type="button" aria-expanded="false">
          <span class="tool-icon" aria-hidden="true">${pres.icon}</span>
          <span class="tool-action">${pres.running}</span>
        </button>
        <div class="tool-body">
          <section class="tool-detail tool-input-detail"${message.args ? "" : " hidden"}>
            <div class="tool-detail-label">输入</div>
            <pre class="tool-input">${message.args ? escapeHtml(formatToolInput(message.args)) : ""}</pre>
          </section>
          <section class="tool-detail tool-output-detail" hidden>
            <div class="tool-detail-label">输出</div>
            <pre class="tool-output"></pre>
          </section>
        </div>
      </div></div></div>`);
    }
    if (message.role === "toolResult") {
      if (isInternalPlanTool(message.name)) return;
      const pres = getToolPresentation(message.name);
      const statusClass = message.isError ? "error" : "done";
      fragments.push(`<script class="tool-result-update" data-id="${escapeHtml(message.id)}" data-action="${pres.done}" data-output="${escapeHtml(message.result || "")}" data-status="${statusClass}"></script>`);
      pendingToolId = null;
    }
  });
  if (historyTurn >= 0) appendHistoryMetrics(historyTurn);
  chatEl.innerHTML = fragments.join("");
  chatEl.querySelectorAll(".ai-block[data-history-index]").forEach((block) => {
    renderAssistantContent(block, assistantHistoryTexts[Number(block.dataset.historyIndex)] ?? "");
  });

  // 处理 toolResult 的 <script> 标记：回填输出内容
  chatEl.querySelectorAll(".tool-result-update").forEach((s) => {
    const id = s.dataset.id;
    const card = chatEl.querySelector(`[data-tool-id="${id}"]`);
    if (!card) return;
    card.querySelector(".tool-action").textContent = s.dataset.action;
    card.dataset.status = s.dataset.status;
    const out = card.querySelector(".tool-output-detail");
    if (out) {
      out.hidden = false;
      out.querySelector(".tool-output").textContent = s.dataset.output;
    }
    if (s.dataset.status !== "error" && isMermaidDiagramTool(card.dataset.toolName)) {
      renderMermaidToolCard(card, historyToolArgs.get(id));
    }
    s.remove();
  });

  // 绑定点击事件
  bindChatCardEvents();

  _restoring = false;
  scrollToBottom({ force: true });
}

function escapeHtml(text) {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function addThinkingHistory(text) {
  const row = document.createElement("div");
  row.className = "msg-row assistant";
  const inner = document.createElement("div");
  inner.className = "msg-inner";
  const det = document.createElement("div");
  det.className = "thinking";
  det.innerHTML = `<div class="thinking-head">思考</div><div class="thinking-body">${escapeIntegrationText(text)}</div>`;
  det.querySelector(".thinking-head").addEventListener("click", () => {
    const body = det.querySelector(".thinking-body");
    if (det.classList.contains("expanded")) collapseCard(det);
    else expandCard(det, body);
  });
  inner.appendChild(det);
  row.appendChild(inner);
  chatEl.appendChild(row);
}

function addToolCardHistory(id, name, args) {
  // 创建卡片壳子并填入输入参数；详细结果由后续 toolResult 填充
  addToolCard(id, name, "running", { args });
}

// 开始一条 AI 消息（返回容器）
function ensureAiBlock() {
  if (currentAiRow) return;
  hidePlaceholder();
  const row = document.createElement("div");
  row.className = "msg-row assistant";
  row.innerHTML = `
    <div class="msg-inner">
      <div class="ai-status"><span class="spin"></span><span>正在思考…</span></div>
      <div class="ai-block"></div>
    </div>`;
  chatEl.appendChild(row);
  currentAiRow = row;
  currentAiTextEl = row.querySelector(".ai-block");
  currentAiText = "";
  currentThinkingBody = null;
  currentAiHasContent = false;
  scrollToBottom();
}

function appendAiText(delta) {
  activeReadBatch = null;
  ensureAiBlock();
  // 若有正文，把状态行的"正在思考"清掉（只留一次）
  const status = currentAiRow.querySelector(".ai-status span:last-child");
  if (status && !currentAiHasContent) status.textContent = "正在回复…";
  currentAiHasContent = true;
  currentAiText += delta;
  renderAssistantContent(currentAiTextEl, currentAiText);
  scrollToBottom();
}

function appendThinking(delta) {
  activeReadBatch = null;
  ensureAiBlock();
  // 保护：一旦正文已开始，后续 delta 不再归入 thinking
  // （某些模型流式事件顺序可能把正文误标为 thinking）
  if (currentAiHasContent) {
    appendAiText(delta);
    return;
  }
  if (!currentThinkingBody) {
    const det = document.createElement("div");
    det.className = "thinking";
    det.innerHTML = `<div class="thinking-head">思考</div><div class="thinking-body"></div>`;
    det.querySelector(".thinking-head").addEventListener("click", () => {
      const body = det.querySelector(".thinking-body");
      if (det.classList.contains("expanded")) collapseCard(det);
      else expandCard(det, body);
    });
    // thinking 插到正文之前
    currentAiRow.querySelector(".msg-inner").insertBefore(det, currentAiTextEl);
    currentThinkingBody = det.querySelector(".thinking-body");
  }
  currentThinkingBody.textContent += delta;
  scrollToBottom();
}

// 结束当前 AI 消息
function finalizeAiBlock() {
  if (currentAiRow) {
    const status = currentAiRow.querySelector(".ai-status");
    if (status) status.remove(); // 完成后移除状态行
    const visibleText = stripPlanPayload(currentAiText).trim();
    if (!visibleText && !currentThinkingBody) {
      currentAiRow.remove();
    } else if (!currentAiHasContent && !currentThinkingBody) {
      // 完全无内容（可能只有工具调用），补一句
      currentAiText = "（已完成工具调用）";
      renderAssistantContent(currentAiTextEl, currentAiText);
      currentAiTextEl.style.color = "var(--text-faint)";
    }
  }
  currentAiRow = null;
  currentAiTextEl = null;
  currentAiText = "";
  currentThinkingBody = null;
  currentAiHasContent = false;
}

/* ---------------- 工具调用步骤 ---------------- */
const TOOL_PRESENTATION = {
  bash: { label: "终端", icon: ">_", kind: "terminal", running: "正在运行", done: "运行了命令" },
  read: { label: "读取文件", icon: "RD", kind: "read", running: "正在读取", done: "读取了文件" },
  write: { label: "创建文件", icon: "WR", kind: "write", running: "正在创建", done: "创建了文件" },
  edit: { label: "编辑文件", icon: "ED", kind: "edit", running: "正在编辑", done: "编辑了文件" },
  grep: { label: "搜索代码", icon: "RG", kind: "grep", running: "正在搜索代码", done: "搜索了代码" },
  find: { label: "查找文件", icon: "FD", kind: "find", running: "正在查找文件", done: "查找了文件" },
  ls: { label: "浏览文件", icon: "LS", kind: "list", running: "正在浏览文件", done: "浏览了文件" },
  web_search: { label: "联网搜索", icon: "WB", kind: "search", running: "正在联网搜索", done: "已联网搜索" },
  "byted-web-search": { label: "联网搜索", icon: "WB", kind: "search", running: "正在联网搜索", done: "已联网搜索" },
  web_fetch: { label: "访问网页", icon: "WB", kind: "search", running: "正在访问网页", done: "访问了网页" },
};

const SENSITIVE_TOOL_KEY = /api[_-]?key|token|secret|password|authorization|cookie|credential/i;

function redactToolData(value, key = "") {
  if (SENSITIVE_TOOL_KEY.test(key)) return "[已隐藏]";
  if (Array.isArray(value)) return value.map((entry) => redactToolData(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactToolData(entryValue, entryKey),
    ]));
  }
  return value;
}

function redactToolText(value) {
  return String(value ?? "")
    .replace(/\b(api[_-]?key|token|secret|password|authorization|cookie)\b\s*([=:])\s*([^\s,;"'}]+)/gi, "$1$2[已隐藏]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [已隐藏]");
}

function compactToolText(value, maxLength = 180) {
  const text = redactToolText(value).replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function getToolPath(args) {
  return args?.path ?? args?.file_path ?? args?.file ?? args?.directory ?? "";
}

function isWebSearchTool(name, args) {
  const normalized = String(name ?? "").toLowerCase();
  if (normalized.includes("web") || normalized.includes("search")) return true;
  const command = String(args?.command ?? "");
  return /byted[-_ ]?web[-_ ]?search|web[-_ ]?search|web_search|联网搜索/i.test(command);
}

function isMermaidDiagramTool(name) {
  return String(name ?? "").toLowerCase() === "create_mermaid_diagram";
}

function isInternalPlanTool(name) {
  return ["plan_create", "plan_update", "plan_replan"].includes(String(name ?? ""));
}

function getToolPresentation(name, args) {
  if (isMermaidDiagramTool(name)) {
    return { label: "Mermaid 图表", icon: "DG", kind: "diagram", running: "正在生成图表", done: "已生成图表" };
  }
  if (isWebSearchTool(name, args)) return TOOL_PRESENTATION.web_search;
  return TOOL_PRESENTATION[String(name ?? "").toLowerCase()] ?? {
    label: "工具调用",
    icon: "TO",
    kind: "generic",
    running: "正在调用工具",
    done: "调用了工具",
  };
}

function getToolSummary(name, args) {
  const normalized = String(name ?? "").toLowerCase();
  if (isMermaidDiagramTool(name)) return compactToolText(args?.title ?? args?.diagramType ?? "Mermaid 图表");
  if (isWebSearchTool(name, args)) {
    return compactToolText(args?.query ?? args?.search_query ?? args?.q ?? args?.command ?? "正在查询网络");
  }
  if (normalized === "bash") return compactToolText(args?.command ?? "执行命令");
  if (["read", "write", "edit", "ls"].includes(normalized)) return compactToolText(getToolPath(args) || "未指定路径");
  if (normalized === "grep") return compactToolText((args?.pattern ?? args?.query ?? getToolPath(args)) || "搜索内容");
  if (normalized === "find") return compactToolText((args?.pattern ?? args?.query ?? getToolPath(args)) || "查找文件");
  return compactToolText((args?.query ?? args?.command ?? getToolPath(args)) || normalized || "执行操作");
}

function formatToolInput(args) {
  if (args === undefined) return "";
  try {
    return JSON.stringify(redactToolData(args), null, 2);
  } catch {
    return redactToolText(args);
  }
}

function formatToolOutput(result) {
  const text = redactToolText(result);
  return text.length > 3000 ? `${text.slice(0, 3000)}\n...（已截断）` : text;
}

function getToolCardParent() {
  const currentParent = currentAiRow?.querySelector(".msg-inner");
  if (currentParent) return currentParent;

  // 工具调用通常发生在一段 assistant 消息结束之后；仍使用标准消息行，避免直接撑满聊天区。
  const row = document.createElement("div");
  row.className = "msg-row assistant tool-row";
  row.innerHTML = '<div class="msg-inner"></div>';
  chatEl.appendChild(row);
  return row.querySelector(".msg-inner");
}

function renderMermaidToolCard(card, args) {
  if (!mermaidDiagramEnabled) return;
  const source = String(args?.code ?? "").trim();
  if (!source) return;
  const previous = card.querySelector(".mermaid-diagram");
  if (previous?.dataset.source === source) return;
  previous?.remove();
  const diagram = createMermaidDiagram(source, String(args?.title ?? "Mermaid 图表").trim() || "Mermaid 图表");
  diagram.dataset.source = source;
  card.appendChild(diagram);
}

function renderReadBatch(batch) {
  const entries = [...batch._readEntries.values()];
  const runningCount = entries.filter((entry) => entry.status === "running").length;
  const errorCount = entries.filter((entry) => entry.status === "error").length;
  const action = batch.querySelector(".tool-action");
  action.textContent = runningCount
    ? `正在读取 ${entries.length} 个文件`
    : errorCount ? `读取 ${entries.length} 个文件（${errorCount} 个失败）`
    : `读取了 ${entries.length} 个文件`;
  batch.dataset.status = runningCount ? "running" : errorCount ? "error" : "done";
  batch.title = `Pi 工具：读取 ${entries.length} 个文件`;

  const body = batch.querySelector(".tool-body");
  body.textContent = "";
  entries.forEach((entry, index) => {
    const section = document.createElement("section");
    section.className = "tool-batch-entry";
    const label = document.createElement("div");
    label.className = "tool-detail-label";
    label.textContent = `文件 ${index + 1} · ${getToolSummary("read", entry.args)}`;
    section.appendChild(label);
    if (entry.args !== undefined) {
      const input = document.createElement("pre");
      input.textContent = formatToolInput(entry.args);
      section.appendChild(input);
    }
    if (entry.result !== undefined) {
      const output = document.createElement("pre");
      output.textContent = formatToolOutput(entry.result);
      section.appendChild(output);
    }
    body.appendChild(section);
  });
}

function addReadBatchItem(id, status, { args, result } = {}) {
  hidePlaceholder();
  let reference = readToolEntries.get(id);
  let batch = reference?.batch;
  let entry = reference?.entry;
  if (!batch?.isConnected) {
    batch = activeReadBatch?.isConnected ? activeReadBatch : null;
  }
  if (!batch) {
    batch = document.createElement("div");
    batch.className = "tool-card tool-read-batch";
    batch._readEntries = new Map();
    batch.innerHTML = `
      <button class="tool-head" type="button" aria-expanded="false">
        <span class="tool-icon" aria-hidden="true">RD</span>
        <span class="tool-action"></span>
      </button>
      <div class="tool-body"></div>`;
    getToolCardParent().appendChild(batch);
    batch.querySelector(".tool-head").addEventListener("click", () => {
      const body = batch.querySelector(".tool-body");
      if (batch.classList.contains("expanded")) collapseCard(batch);
      else expandCard(batch, body);
    });
    activeReadBatch = batch;
  }
  if (!entry) {
    entry = { args, result, status };
    batch._readEntries.set(id, entry);
    readToolEntries.set(id, { batch, entry });
  } else {
    if (args !== undefined) entry.args = args;
    if (result !== undefined) entry.result = result;
    entry.status = status;
  }
  renderReadBatch(batch);
  scrollToBottom();
}

function addToolCard(id, name, status, { args, result } = {}) {
  hidePlaceholder();
  let card = chatEl.querySelector(`[data-tool-id="${id}"]`);
  const toolArgs = args ?? card?._toolArgs;
  const presentation = getToolPresentation(name, toolArgs);
  if (presentation.kind === "read") {
    addReadBatchItem(id, status, { args, result });
    return;
  }
  activeReadBatch = null;
  if (!card) {
    card = document.createElement("div");
    card.className = `tool-card tool-${presentation.kind}`;
    card.dataset.toolId = id;
    card.innerHTML = `
      <button class="tool-head" type="button" aria-expanded="false">
        <span class="tool-icon" aria-hidden="true"></span>
        <span class="tool-action"></span>
        <span class="tool-summary"></span>
      </button>
      <div class="tool-body">
        <section class="tool-detail tool-input-detail" hidden>
          <div class="tool-detail-label">输入</div>
          <pre class="tool-input"></pre>
        </section>
        <section class="tool-detail tool-output-detail" hidden>
          <div class="tool-detail-label">输出</div>
          <pre class="tool-output"></pre>
        </section>
      </div>`;
    getToolCardParent().appendChild(card);
    card.querySelector(".tool-head").addEventListener("click", () => {
      const body = card.querySelector(".tool-body");
      if (card.classList.contains("expanded")) collapseCard(card);
      else expandCard(card, body);
    });
  }
  card.className = `tool-card tool-${presentation.kind}`;
  card.dataset.toolName = name;
  card.querySelector(".tool-icon").textContent = presentation.icon;
  const isRunning = status === "running";
  card.querySelector(".tool-action").textContent = isRunning
    ? presentation.running
    : status === "error" ? `${presentation.label}失败` : presentation.done;
  const summary = card.querySelector(".tool-summary");
  summary.textContent = isRunning ? getToolSummary(name, toolArgs) : "";
  summary.hidden = !isRunning;
  card.title = `Pi 工具：${name}`;
  if (args !== undefined) {
    card._toolArgs = args;
    const inputDetail = card.querySelector(".tool-input-detail");
    inputDetail.hidden = false;
    inputDetail.querySelector(".tool-input").textContent = formatToolInput(args);
  }
  card.dataset.status = status;
  if (result !== undefined) {
    const outputDetail = card.querySelector(".tool-output-detail");
    outputDetail.hidden = false;
    outputDetail.querySelector(".tool-output").textContent = formatToolOutput(result);
    if (presentation.kind === "diagram" && status !== "error") renderMermaidToolCard(card, card._toolArgs ?? toolArgs);
  }
  scrollToBottom();
}

function addLog(text, level = "info") {
  const method = level === "error" ? "error" : level === "warn" ? "warn" : "info";
  console[method](`[Pi Agent] ${text}`);
}

function errorScopeKey() {
  return String(streamingTaskId || activeTaskId || "global");
}

function normalizeErrorText(value) {
  return String(value ?? "")
    .replace(/Error invoking remote method '[^']+':\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function addError(text) {
  hidePlaceholder();
  const message = normalizeErrorText(text);
  if (!message) return;
  const key = `${errorScopeKey()}::${message.toLowerCase()}`;
  const now = Date.now();
  const previous = errorNoticeByKey.get(key);
  if (previous && now - previous.lastSeenAt <= ERROR_DEDUPE_WINDOW_MS && previous.el.isConnected) {
    previous.lastSeenAt = now;
    previous.count += 1;
    const bar = previous.el.querySelector(".error-bar");
    if (bar && previous.count > 1) {
      bar.textContent = `⚠️ ${message}（已合并 ${previous.count} 次）`;
    }
    return previous.el;
  }

  const el = document.createElement("div");
  el.className = "msg-row assistant";
  el.innerHTML = `<div class="msg-inner"><div class="error-bar"></div></div>`;
  el.querySelector(".error-bar").textContent = `⚠️ ${message}`;
  chatEl.appendChild(el);
  errorNoticeByKey.set(key, { el, count: 1, lastSeenAt: now });
  scrollToBottom();
  return el;
}

function retryScopeKey() {
  return String(streamingTaskId || activeTaskId || "global");
}

function retryReasonLabel(errorMessage) {
  return /heap_pressure|memory pressure|\b503\b/i.test(String(errorMessage ?? ""))
    ? "服务暂时内存压力较高"
    : "服务暂时繁忙";
}

function showRetryNotice(event) {
  hidePlaceholder();
  const key = retryScopeKey();
  let entry = retryNoticeByTask.get(key);
  if (!entry || !entry.el.isConnected) {
    const el = document.createElement("div");
    el.className = "msg-row assistant";
    el.innerHTML = `<div class="msg-inner"><div class="retry-bar" role="status"></div></div>`;
    chatEl.appendChild(el);
    entry = { el };
    retryNoticeByTask.set(key, entry);
  }
  const attempt = Number(event.attempt) || 1;
  const maxAttempts = Number(event.maxAttempts) || 3;
  const delaySeconds = Math.max(1, Math.ceil((Number(event.delayMs) || 0) / 1000));
  const reason = retryReasonLabel(event.errorMessage);
  entry.el.classList.remove("retry-success", "retry-failed");
  entry.el.querySelector(".retry-bar").textContent = `${reason}，正在自动重试（${attempt}/${maxAttempts}），${delaySeconds} 秒后继续`;
  scrollToBottom();
}

function finishRetryNotice(event) {
  const key = retryScopeKey();
  const entry = retryNoticeByTask.get(key);
  if (!entry || !entry.el.isConnected) return;
  const bar = entry.el.querySelector(".retry-bar");
  if (event.success) {
    entry.el.classList.add("retry-success");
    bar.textContent = `服务已恢复，自动重试成功（${Number(event.attempt) || 1} 次）`;
    window.setTimeout(() => {
      if (entry.el.isConnected) entry.el.remove();
      retryNoticeByTask.delete(key);
    }, 2200);
  } else {
    entry.el.classList.add("retry-failed");
    bar.textContent = "自动重试未完成，正在显示最终错误";
    window.setTimeout(() => {
      if (entry.el.isConnected) entry.el.remove();
      retryNoticeByTask.delete(key);
    }, 1800);
  }
}

function isExpectedAbortMessage(value) {
  return /request was aborted|operation was aborted|aborterror/i.test(String(value ?? ""));
}

/* ---------------- 展开/折叠管理器（思考、工具调用、联网搜索） ---------------- */
const expandedCards = new WeakSet();

// IntersectionObserver：展开卡片的内容滚出视口上方时自动折叠
const cardCollapseObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting && entry.boundingClientRect.bottom <= 0) {
      collapseCard(entry.target);
    }
  }
}, { root: null, rootMargin: "0px" });

function expandCard(card, body) {
  card.classList.add("expanded");
  const head = card.querySelector(".tool-head");
  if (head) head.setAttribute("aria-expanded", "true");
  if (body) {
    cardCollapseObserver.observe(body);
    // 动态计算内容高度，避免固定 2000px 导致的动画卡顿
    body.style.maxHeight = "none";
    const h = body.scrollHeight;
    body.style.maxHeight = "";
    // 强制回流后设置真实高度触发过渡
    body.offsetHeight; // eslint-disable-line no-unused-expressions
    body.style.maxHeight = h + "px";
    // 过渡结束后解除高度限制（允许内容动态增长）
    const onEnd = () => { body.style.maxHeight = "none"; body.removeEventListener("transitionend", onEnd); };
    body.addEventListener("transitionend", onEnd, { once: true });
  }
  expandedCards.add(card);
}

function collapseCard(card) {
  const body = card.querySelector(".tool-body, .thinking-body");
  if (body) {
    cardCollapseObserver.unobserve(body);
    // 先锁定当前高度再归零，触发收缩过渡
    body.style.maxHeight = body.scrollHeight + "px";
    body.offsetHeight; // 强制回流
    body.style.maxHeight = "0px";
  }
  card.classList.remove("expanded");
  const head = card.querySelector(".tool-head");
  if (head) head.setAttribute("aria-expanded", "false");
  expandedCards.delete(card);
}

// 点击展开卡片/thinking 之外的任意位置 → 折叠所有
document.addEventListener("click", (e) => {
  const inside = e.target.closest(".tool-card, .thinking, .tool-read-batch");
  if (inside) return;
  if (e.target.closest(".tool-body, .thinking-body")) return;
  document.querySelectorAll(".tool-card.expanded, .tool-read-batch.expanded, .thinking.expanded").forEach((el) => {
    collapseCard(el);
  });
});

/* ---------------- pi 事件 ---------------- */
function handleEvent(event) {
  if (!event || !event.type) return;
  if (streamingTaskId && streamingTaskId !== activeTaskId) {
    handleBackgroundStreamEvent(event, streamingTaskId);
    return;
  }
  switch (event.type) {
    case "agent_start":
      streamStartPending = false;
      if (!isStreaming) setStreamingUi(true);
      break;
    case "message_start":
      if (event.message?.role === "assistant") finalizeAiBlock();
      break;
    case "message_update": {
      const ev = event.assistantMessageEvent;
      if (!ev) break;
      if (ev.type === "text_delta" && ev.delta) appendAiText(ev.delta);
      else if (ev.type === "thinking_delta" && ev.delta) appendThinking(ev.delta);
      break;
    }
    case "message_end": {
      const msg = event.message;
      if (msg?.role === "assistant") {
        const text = (msg.content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("\n");
        recordAssistantUsage(msg.usage);
        finalizeAiBlock();
      } else if (msg?.role === "toolResult") {
        const name = msg.toolName ?? "tool";
        if (isInternalPlanTool(name)) break;
        const text = (msg.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
        addToolCard(msg.toolCallId ?? `t-${Date.now()}`, name, msg.isError ? "error" : "done", {
          result: text || (msg.isError ? "(错误)" : "(无输出)"),
        });
        if (!msg.isError && activeTurnMetrics) activeTurnMetrics.successfulTools += 1;
      }
      break;
    }
    case "tool_execution_start": {
      if (isInternalPlanTool(event.toolName)) break;
      addToolCard(event.toolCallId ?? `t-${Date.now()}`, event.toolName ?? "tool", "running", {
        args: event.args ?? {},
      });
      break;
    }
    case "auto_retry_start":
      showRetryNotice(event);
      break;
    case "auto_retry_end":
      finishRetryNotice(event);
      break;
    case "agent_end":
      // agent_end can arrive before session.prompt()/abort() finishes its cleanup.
      // Keep the stop button active until the main process confirms an idle state.
      streamStartPending = false;
      finalizeAiBlock();
      finishTurnMetrics();
      invalidateChatCache(); // 对话内容已更新，缓存失效
      activeReadBatch = null;
      readToolEntries.clear();
      break;
    case "compaction_start":
      contextProgress?.classList.add("is-compacting");
      compactionJustCompleted = false;
      if (contextSummary) contextSummary.textContent = event.reason === "overflow" ? "上下文溢出，正在自动压缩" : "正在自动压缩上下文";
      break;
    case "compaction_end":
      contextProgress?.classList.remove("is-compacting");
      compactionJustCompleted = !event.aborted;
      // 压缩后 SDK 需要一点时间才能返回新统计数据，延迟刷新
      setTimeout(async () => {
        try {
          const state = await window.piAgent?.getState();
          if (state) updateState(state);
        } catch { /* 刷新失败不影响 UI */ }
        if (compactionJustCompleted) {
          compactionJustCompleted = false;
        }
      }, 800);
      break;
  }
}

function handleBackgroundStreamEvent(event, taskId) {
  if (event.type === "message_end") {
    const message = event.message;
    if (message?.role === "assistant") recordAssistantUsage(message.usage);
    if (message?.role === "toolResult" && !message.isError && !isInternalPlanTool(message.toolName) && activeTurnMetrics) {
      activeTurnMetrics.successfulTools += 1;
    }
    return;
  }
  if (event.type === "agent_end") {
    streamStartPending = false;
    finishTurnMetrics();
    invalidateChatCache(taskId);
  }
}

/* ---------------- 状态栏 ---------------- */
function updateState(state) {
  if (!state) return;
  const stateBelongsToBackgroundTask = Boolean(streamingTaskId && streamingTaskId !== activeTaskId);
  const wasStreaming = isStreaming;
  const reportedStreaming = Boolean(state.isStreaming);
  if (reportedStreaming) {
    streamStartPending = false;
    isStreaming = true;
  } else if (!streamStartPending) {
    // Ignore an older idle snapshot that arrives just after prompt() was sent.
    isStreaming = false;
  }
  if (isStreaming) {
    statusDot?.classList.add("busy");
    if (statusText) statusText.textContent = "运行中";
  } else {
    statusDot?.classList.remove("busy");
    if (statusText) statusText.textContent = "就绪";
  }
  updateComposerState();
  if (state.executionMode) renderExecutionMode(state.executionMode);
  if (!stateBelongsToBackgroundTask) {
    const reportedContextTokens = Number(state.contextUsage?.tokens);
    currentContextTokens = Number.isFinite(reportedContextTokens) && reportedContextTokens >= 0 ? reportedContextTokens : null;
    renderContextUsage(state.contextUsage);
    updateThinkingLevelControl(state);
  }
  if (wasStreaming && !isStreaming) {
    const completedTaskId = streamingTaskId;
    completeTask(completedTaskId);
    streamingTaskId = null;
    if (integrationsNeedSessionRefresh) {
      integrationsNeedSessionRefresh = false;
      recreateActiveTaskSession().catch((error) => addError(`应用集成配置失败：${error?.message ?? error}`));
    }
    if (mermaidSettingsNeedSessionRefresh) {
      mermaidSettingsNeedSessionRefresh = false;
      recreateActiveTaskSession().catch((error) => addError(`应用 Mermaid 设置失败：${error?.message ?? error}`));
    }
    const viewedTask = currentTask();
    if (!sessionReady && viewedTask && !isSwitchingTask) {
      setTimeout(() => switchTask(viewedTask, true), 0);
    }
  }
  if (state.errorMessage && !isExpectedAbortMessage(state.errorMessage)) addError(state.errorMessage);
}

function renderExecutionMode(mode) {
  // A saved plan-only mode from an earlier release behaves as automatic mode.
  const normalizedMode = mode === "plan" ? "auto" : mode;
  executionMode = EXECUTION_MODE_LABELS[normalizedMode] ? normalizedMode : "ask";
  if (executionModeLabel) executionModeLabel.textContent = EXECUTION_MODE_LABELS[executionMode];
  executionModeMenu?.querySelectorAll("[data-execution-mode]").forEach((item) => {
    item.classList.toggle("active", item.dataset.executionMode === executionMode);
  });
}

function setExecutionModeMenuOpen(open) {
  if (!btnExecutionMode || !executionModeMenu) return;
  btnExecutionMode.setAttribute("aria-expanded", String(open));
  executionModeMenu.classList.toggle("open", open);
  executionModeMenu.setAttribute("aria-hidden", String(!open));
}

function renderContextUsage(usage) {
  if (!contextProgress || !contextSummary) return;
  const contextWindow = typeof usage?.contextWindow === "number" ? usage.contextWindow : NaN;
  const tokens = typeof usage?.tokens === "number" ? usage.tokens : NaN;
  const hasContextWindow = Number.isFinite(contextWindow) && contextWindow > 0;
  const hasTokens = Number.isFinite(tokens) && tokens >= 0;
  const reportedPercent = typeof usage?.percent === "number" ? usage.percent : NaN;
  const percent = Number.isFinite(reportedPercent)
    ? reportedPercent
    : hasTokens && hasContextWindow ? (tokens / contextWindow) * 100 : null;
  if (!hasContextWindow) {
    contextProgress.style.width = "0%";
    contextProgress.classList.remove("warn", "critical");
    contextSummary.textContent = "选择模型后显示上下文容量";
    contextCompression?.setAttribute("title", "自动上下文压缩");
    return;
  }
  if (!Number.isFinite(percent)) {
    contextProgress.style.width = "0%";
    contextProgress.classList.remove("warn", "critical");
    contextSummary.textContent = `等待首轮回复 / ${contextWindow.toLocaleString()} · 自动压缩`;
    contextCompression?.setAttribute("title", `上下文容量 ${contextWindow.toLocaleString()} · 自动压缩`);
    return;
  }
  compactionJustCompleted = false;
  const clamped = Math.max(0, Math.min(percent, 100));
  contextProgress.style.width = `${clamped}%`;
  contextProgress.classList.toggle("warn", clamped >= 70 && clamped < 88);
  contextProgress.classList.toggle("critical", clamped >= 88);
  contextSummary.textContent = `${formatContextTokenCount(tokens)} / ${formatContextTokenCount(contextWindow)}`;
  contextCompression?.setAttribute("title", `${tokens.toLocaleString()} / ${contextWindow.toLocaleString()} · 自动压缩`);
}

function formatContextTokenCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return "0";
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(number >= 100_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(Math.round(number));
}

const PLAN_ITEM_STATUSES = new Set(["pending", "in_progress", "completed", "blocked", "skipped"]);
const PLAN_STATUS_LABELS = {
  pending: "等待执行", in_progress: "正在执行", completed: "已完成", blocked: "已阻塞", skipped: "已跳过",
};
const PLAN_STATUS_MARKS = { pending: "", in_progress: "·", completed: "✓", blocked: "!", skipped: "−" };

function stablePlanItemId(text, index) {
  let hash = 0;
  for (const char of String(text)) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return `plan-item-legacy-${index + 1}-${Math.abs(hash)}`;
}

function normalizePlanItems(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.flatMap((item, index) => {
    const text = String(typeof item === "string" ? item : item?.text ?? item?.title ?? item?.name ?? "").replace(/\s+/g, " ").trim();
    const key = text.toLowerCase();
    if (!text || text.length > 160 || seen.has(key)) return [];
    seen.add(key);
    const status = PLAN_ITEM_STATUSES.has(item?.status) ? item.status : item?.done === true ? "completed" : "pending";
    const normalizeList = (value, maxLength = 120) => Array.isArray(value)
      ? value.map((entry) => String(entry ?? "").replace(/\s+/g, " ").trim()).filter((entry) => entry && entry.length <= maxLength).slice(0, 30)
      : [];
    return [{
      id: typeof item?.id === "string" && item.id ? item.id : stablePlanItemId(text, index),
      text,
      status,
      dependsOn: normalizeList(item?.dependsOn),
      startedAt: Number.isFinite(Number(item?.startedAt)) ? Number(item.startedAt) : null,
      completedAt: Number.isFinite(Number(item?.completedAt)) ? Number(item.completedAt) : null,
      evidence: normalizeList(item?.evidence, 500),
      toolCallIds: normalizeList(item?.toolCallIds),
      turnIds: normalizeList(item?.turnIds),
      blockedReason: typeof item?.blockedReason === "string" ? item.blockedReason.slice(0, 500) : null,
    }];
  }).slice(0, 8);
}

function normalizePlan(plan, taskId) {
  const items = normalizePlanItems(plan?.items);
  if (!items.length) return null;
  const createdAt = Number.isFinite(Number(plan?.createdAt)) ? Number(plan.createdAt) : Date.now();
  const status = ["draft", "awaiting_approval", "active", "completed", "cancelled", "superseded"].includes(plan?.status)
    ? plan.status
    : "active";
  return {
    id: typeof plan?.id === "string" && plan.id ? plan.id : `plan-legacy-${taskId || "task"}`,
    schemaVersion: 2,
    version: Math.max(1, Number.parseInt(plan?.version, 10) || 1),
    status,
    createdAt,
    updatedAt: Number.isFinite(Number(plan?.updatedAt)) ? Number(plan.updatedAt) : createdAt,
    items,
    history: Array.isArray(plan?.history) ? plan.history.slice(-20) : [],
  };
}

function migrateTaskPlan(task) {
  if (!task?.plan) return null;
  const normalized = normalizePlan(task.plan, task.id);
  if (!normalized) return null;
  if (JSON.stringify(task.plan) !== JSON.stringify(normalized)) task.plan = normalized;
  return task.plan;
}

function currentPlan() {
  return migrateTaskPlan(currentTask());
}

function getPlanProgress(plan) {
  const executable = plan.items.filter((item) => item.status !== "skipped");
  return {
    completed: plan.items.filter((item) => item.status === "completed").length,
    total: executable.length,
    active: plan.items.filter((item) => item.status === "in_progress").length,
    blocked: plan.items.filter((item) => item.status === "blocked").length,
  };
}

function renderPlanList() {
  const plan = currentPlan();
  if (!planListWrap || !btnPlanList || !planListItems || !planListCount) return;
  planListWrap.classList.toggle("hidden", !plan);
  if (!plan) {
    btnPlanList.setAttribute("aria-expanded", "false");
    planListPopover?.classList.remove("open");
    planListPopover?.setAttribute("aria-hidden", "true");
    return;
  }
  const progress = getPlanProgress(plan);
  planListCount.textContent = `${progress.completed}/${progress.total}`;
  planListItems.innerHTML = plan.items.map((item, index) => `
    <div class="plan-list-item ${item.status} ${item.status === "completed" ? "done" : ""}" title="${PLAN_STATUS_LABELS[item.status]}">
      <span class="plan-list-item-index">${index + 1}</span>
      <span class="plan-list-item-text">${escapeHtml(item.text)}</span>
      <span class="plan-list-item-check" aria-label="${PLAN_STATUS_LABELS[item.status]}">${PLAN_STATUS_MARKS[item.status]}</span>
    </div>`).join("");
}

function setPlanListOpen(open) {
  if (!currentPlan() || !btnPlanList || !planListPopover) return;
  btnPlanList.setAttribute("aria-expanded", String(open));
  planListPopover.classList.toggle("open", open);
  planListPopover.setAttribute("aria-hidden", String(!open));
}

function saveCurrentPlan(items) {
  const task = currentTask();
  const normalized = normalizePlanItems(items);
  if (!task || normalized.length < 2) return false;
  const now = Date.now();
  task.plan = {
    id: newId("plan"), schemaVersion: 2, version: 1, status: "active", createdAt: now, updatedAt: now, history: [],
    items: normalized.map((item) => ({ ...item, status: "pending", dependsOn: [], startedAt: null, completedAt: null, evidence: [], toolCallIds: [], turnIds: [], blockedReason: null })),
  };
  task.updatedAt = Date.now();
  renderPlanList();
  saveTaskIndex().catch((error) => console.warn("Unable to save task plan:", error));
  return true;
}

function extractPlanPayload(text) {
  const source = String(text ?? "")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/<\/??apple[_-]pi[_-]todo\b[^>]*>/gi, (tag) => tag.replace(/_/g, "-"));
  const match = source.match(/<apple-pi-todo\b[^>]*>\s*([\s\S]*?)\s*<\/apple-pi-todo>/i);
  if (!match) return null;
  const raw = match[1].trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const candidates = [raw];
  const objectStart = raw.indexOf("{");
  const objectEnd = raw.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(raw.slice(objectStart, objectEnd + 1));
  for (const candidate of candidates) {
    try {
      const payload = JSON.parse(candidate);
      const rawItems = Array.isArray(payload) ? payload : payload?.todos ?? payload?.tasks ?? payload?.items;
      const items = normalizePlanItems(rawItems);
      if (items.length >= 2) return items;
    } catch { /* Continue with the next compatible payload shape. */ }
  }
  return null;
}

function stripPlanPayload(text) {
  return String(text ?? "")
    .replace(/&lt;apple[_-]pi[_-]todo\b[^&]*&gt;[\s\S]*?&lt;\/apple[_-]pi[_-]todo&gt;\s*/gi, "")
    .replace(/<apple[_-]pi[_-]todo\b[^>]*>[\s\S]*?<\/apple[_-]pi[_-]todo>\s*/gi, "")
    .replace(/<apple[_-]pi[_-]todo\b[^>]*>[\s\S]*$/gi, "")
    .trimStart();
}

function applyPlanUpdate(update) {
  const task = update?.sessionFile
    ? tasks.find((entry) => normalizeSessionPath(entry.sessionFile) === normalizeSessionPath(update.sessionFile))
    : currentTask();
  if (!task || !update || typeof update !== "object") return;
  if (update.sessionFile && task.sessionFile && normalizeSessionPath(update.sessionFile) !== normalizeSessionPath(task.sessionFile)) return;
  const now = Number.isFinite(Number(update.updatedAt)) ? Number(update.updatedAt) : Date.now();
  const createdPlan = update.action === "create";
  if (createdPlan) {
    const plan = normalizePlan(update.plan, task.id);
    if (!plan) return;
    task.plan = plan;
  } else {
    const plan = currentPlan();
    if (!plan || plan.id !== update.planId) return;
    if (update.action === "replan") {
      const oldItemsByText = new Map(plan.items.map((item) => [item.text.toLowerCase(), item]));
      const nextItems = normalizePlanItems(update.items).map((item) => {
        const previous = oldItemsByText.get(item.text.toLowerCase());
        return previous ? { ...previous, id: item.id } : { ...item, status: "pending", dependsOn: [], startedAt: null, completedAt: null, evidence: [], toolCallIds: [], turnIds: [], blockedReason: null };
      });
      if (nextItems.length < 2) return;
      plan.history = [...plan.history, { version: plan.version, updatedAt: now, reason: String(update.reason ?? "").slice(0, 500), items: plan.items }].slice(-20);
      plan.items = nextItems;
      plan.version += 1;
    } else {
      const item = plan.items.find((entry) => entry.id === update.itemId);
      if (!item || item.status === "completed") return;
      if (update.action === "start") {
        plan.items.forEach((entry) => {
          if (entry.id !== item.id && entry.status === "in_progress") entry.status = "pending";
        });
        item.status = "in_progress";
        item.startedAt = item.startedAt ?? now;
        item.blockedReason = null;
      } else if (update.action === "complete" && String(update.evidence ?? "").trim()) {
        item.status = "completed";
        item.startedAt = item.startedAt ?? now;
        item.completedAt = now;
        item.evidence = [...item.evidence, String(update.evidence).trim()].slice(-30);
        item.blockedReason = null;
      } else if (update.action === "block" && String(update.reason ?? "").trim()) {
        item.status = "blocked";
        item.blockedReason = String(update.reason).trim();
      } else if (update.action === "skip" && String(update.reason ?? "").trim()) {
        item.status = "skipped";
        item.blockedReason = String(update.reason).trim();
      } else return;
      if (update.toolCallId) item.toolCallIds = [...item.toolCallIds, String(update.toolCallId)].slice(-30);
    }
    plan.updatedAt = now;
    plan.status = plan.items.every((item) => ["completed", "skipped"].includes(item.status)) ? "completed" : "active";
  }
  task.updatedAt = now;
  if (task.id === activeTaskId) {
    renderPlanList();
    if (createdPlan) setPlanListOpen(true);
  }
  saveTaskIndex().catch((error) => console.warn("Unable to save plan update:", error));
}

function blockPlanItem(task, reason) {
  const plan = task?.plan;
  const item = plan?.items.find((entry) => entry.status === "in_progress");
  if (!plan || !item) return;
  applyPlanUpdate({
    action: "block",
    planId: plan.id,
    itemId: item.id,
    reason,
    sessionFile: task.sessionFile,
    updatedAt: Date.now(),
  });
}

function blockActivePlanItem(reason) {
  blockPlanItem(currentTask(), reason);
}

function tokenTotal(usage) {
  if (!usage || typeof usage !== "object") return 0;
  const total = Number(usage.totalTokens);
  if (Number.isFinite(total) && total >= 0) return total;
  return [usage.input, usage.output, usage.cacheRead, usage.cacheWrite]
    .map(Number)
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);
}

function turnTokenDelta(usage, baselineInputTokens = null) {
  if (!usage || typeof usage !== "object") return { tokens: 0, inputTokens: baselineInputTokens };
  const input = Number(usage.input);
  const output = Number(usage.output);
  const reasoning = Number(usage.reasoning);
  if (!Number.isFinite(input) && !Number.isFinite(output) && !Number.isFinite(reasoning)) {
    return { tokens: tokenTotal(usage), inputTokens: baselineInputTokens };
  }
  const safeInput = Number.isFinite(input) && input >= 0 ? input : 0;
  const safeOutput = Number.isFinite(output) && output >= 0 ? output : 0;
  const safeReasoning = Number.isFinite(reasoning) && reasoning >= 0 ? reasoning : 0;
  const baseline = Number.isFinite(Number(baselineInputTokens)) ? Number(baselineInputTokens) : 0;
  return {
    // Providers report the whole prompt in input. Only the growth since the
    // prior context belongs to this user turn; output always belongs to it.
    tokens: Math.max(0, safeInput - baseline) + safeOutput + safeReasoning,
    inputTokens: safeInput,
  };
}

function formatTurnDuration(durationMs) {
  const seconds = Math.max(0, Math.round(Number(durationMs || 0) / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, "0")}秒` : `${seconds} 秒`;
}

function formatTurnTokens(tokens) {
  const amount = Number(tokens);
  if (!Number.isFinite(amount) || amount <= 0) return "Token 未返回";
  return amount >= 1000 ? `${(amount / 1000).toFixed(amount >= 10000 ? 0 : 1)}K Tokens` : `${Math.round(amount)} Tokens`;
}

function renderTurnMetricsHtml(metrics) {
  if (!metrics) return "";
  const duration = Number.isFinite(Number(metrics.durationMs)) ? `本轮用时 ${formatTurnDuration(metrics.durationMs)} · ` : "";
  return `<div class="msg-row assistant turn-metrics-row" data-turn-metric="${Number(metrics.turn)}"><div class="msg-inner"><div class="turn-metrics"><span class="turn-metrics-text">${duration}本轮消耗 ${formatTurnTokens(metrics.tokens)}</span></div></div></div>`;
}

function appendTurnMetrics(metrics) {
  if (!metrics || chatEl.querySelector(`[data-turn-metric="${metrics.turn}"]`)) return;
  const row = document.createElement("div");
  row.className = "msg-row assistant turn-metrics-row";
  row.dataset.turnMetric = String(metrics.turn);
  row.innerHTML = `<div class="msg-inner"><div class="turn-metrics"><span class="turn-metrics-text">本轮用时 ${formatTurnDuration(metrics.durationMs)} · 本轮消耗 ${formatTurnTokens(metrics.tokens)}</span></div></div>`;
  chatEl.appendChild(row);
}

function beginTurnMetrics() {
  activeTurnMetrics = {
    taskId: currentTask()?.id ?? null,
    turn: chatEl.querySelectorAll(".msg-row.user").length,
    startedAt: Date.now(),
    tokens: 0,
    contextTokensAtStart: currentContextTokens,
    lastInputTokens: null,
    successfulTools: 0,
  };
}

function recordAssistantUsage(usage) {
  if (!activeTurnMetrics) return;
  const baseline = Number.isFinite(activeTurnMetrics.lastInputTokens)
    ? activeTurnMetrics.lastInputTokens
    : activeTurnMetrics.contextTokensAtStart;
  const attributed = turnTokenDelta(usage, baseline);
  activeTurnMetrics.tokens += attributed.tokens;
  activeTurnMetrics.lastInputTokens = attributed.inputTokens;
}

function finishTurnMetrics() {
  const active = activeTurnMetrics;
  if (!active) return;
  activeTurnMetrics = null;
  const task = tasks.find((item) => item.id === active.taskId);
  if (!task) return;
  const metrics = {
    turn: active.turn,
    durationMs: Date.now() - active.startedAt,
    tokens: active.tokens,
    tokenScope: "turn_delta_v1",
    completedAt: Date.now(),
  };
  task.turnMetrics = Array.isArray(task.turnMetrics) ? task.turnMetrics.filter((item) => item?.turn !== metrics.turn) : [];
  task.turnMetrics.push(metrics);
  task.updatedAt = Date.now();
  appendTurnMetrics(metrics);
  saveTaskIndex().catch((error) => console.warn("Unable to save turn metrics:", error));
}

btnPlanList?.addEventListener("click", (event) => {
  event.stopPropagation();
  setPlanListOpen(btnPlanList.getAttribute("aria-expanded") !== "true");
});
document.addEventListener("pointerdown", (event) => {
  if (!planListWrap?.contains(event.target)) setPlanListOpen(false);
});

btnExecutionMode?.addEventListener("click", (event) => {
  event.stopPropagation();
  setExecutionModeMenuOpen(btnExecutionMode.getAttribute("aria-expanded") !== "true");
});
executionModeMenu?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-execution-mode]");
  if (!button) return;
  const mode = button.dataset.executionMode;
  try {
    const result = await window.piAgent.setExecutionMode(mode);
    renderExecutionMode(result?.mode || mode);
    setExecutionModeMenuOpen(false);
  } catch (error) {
    addError(`切换执行权限失败：${error?.message ?? error}`);
  }
});
document.addEventListener("pointerdown", (event) => {
  if (!document.querySelector("#execution-mode-wrap")?.contains(event.target)) setExecutionModeMenuOpen(false);
});

/* ---------------- 项目与任务导航 ---------------- */
const menuTasksEl = $("#menu-tasks");
const tasksPanelEl = $("#tasks-panel");
const projectListEl = $("#project-list");
const unprojectedTaskListEl = $("#unprojected-task-list");
const projectBindingBtn = $("#btn-project-binding");
const projectBindingLabel = $("#project-binding-label");
const projectBindingPopover = $("#project-binding-popover");
const projectContextMenu = $("#project-context-menu");
const taskContextMenu = $("#task-context-menu");

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const chatCache = new Map(); // sessionFile → {html, scrollTop, updatedAt}

function parseTaskIndex(rawValue) {
  if (!rawValue) return { tasks: [], projects: [], activeTaskId: null };
  try {
    const stored = JSON.parse(rawValue);
    return {
      tasks: Array.isArray(stored.tasks) ? stored.tasks : [],
      projects: Array.isArray(stored.projects) ? stored.projects : [],
      activeTaskId: typeof stored.activeTaskId === "string" ? stored.activeTaskId : null,
    };
  } catch {
    return { tasks: [], projects: [], activeTaskId: null };
  }
}

function normalizeProjectPath(projectPath) {
  return typeof projectPath === "string"
    ? projectPath.replace(/[\\/]+$/, "").toLowerCase()
    : "";
}

function normalizeSessionPath(sessionFile) {
  return typeof sessionFile === "string"
    ? sessionFile.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase()
    : "";
}

function mergeTaskIndexes(indexes) {
  const mergedProjects = [];
  const mergedTasks = [];
  const projectIdsByPath = new Map();
  const usedProjectIds = new Set();
  const taskIndexByKey = new Map();
  let preferredActiveTaskId = null;

  for (const index of indexes) {
    const projectIdMap = new Map();
    for (const originalProject of index.projects) {
      if (!originalProject || typeof originalProject !== "object") continue;
      const project = { ...originalProject };
      const normalizedPath = normalizeProjectPath(project.path);
      let resolvedId = normalizedPath ? projectIdsByPath.get(normalizedPath) : null;
      if (!resolvedId && typeof project.id === "string" && !usedProjectIds.has(project.id)) {
        resolvedId = project.id;
      }
      if (!resolvedId) resolvedId = newId("project");
      project.id = resolvedId;
      projectIdMap.set(originalProject.id, resolvedId);
      if (normalizedPath) projectIdsByPath.set(normalizedPath, resolvedId);
      if (!usedProjectIds.has(resolvedId)) {
        usedProjectIds.add(resolvedId);
        mergedProjects.push(project);
      }
    }

    for (const originalTask of index.tasks) {
      if (!originalTask || typeof originalTask !== "object" || typeof originalTask.id !== "string") continue;
      const task = { ...originalTask };
      if (task.projectId) task.projectId = projectIdMap.get(task.projectId) || task.projectId;
      const key = task.sessionFile ? `session:${normalizeSessionPath(task.sessionFile)}` : `id:${task.id}`;
      const existingIndex = taskIndexByKey.get(key);
      if (existingIndex === undefined) {
        taskIndexByKey.set(key, mergedTasks.length);
        mergedTasks.push(task);
      } else {
        const existing = mergedTasks[existingIndex];
        if ((task.updatedAt || 0) >= (existing.updatedAt || 0)) mergedTasks[existingIndex] = task;
      }
    }

    if (index.activeTaskId) preferredActiveTaskId = index.activeTaskId;
  }

  const validProjectIds = new Set(mergedProjects.map((project) => project.id));
  mergedTasks.forEach((task) => {
    if (task.projectId && !validProjectIds.has(task.projectId)) task.projectId = null;
  });
  return {
    tasks: mergedTasks,
    projects: mergedProjects,
    activeTaskId: mergedTasks.some((task) => task.id === preferredActiveTaskId) ? preferredActiveTaskId : null,
  };
}

async function loadTaskIndex() {
  if (!window.piAgent?.loadTaskIndex) return;
  try {
    const stored = await window.piAgent.loadTaskIndex();
    let merged = mergeTaskIndexes([stored]);
    if (merged.tasks.length === 0 && merged.projects.length === 0) {
      const legacyIndexes = LEGACY_TASK_INDEX_STORAGE_KEYS
        .map((key) => parseTaskIndex(localStorage.getItem(key)));
      legacyIndexes.push(parseTaskIndex(localStorage.getItem(TASK_INDEX_STORAGE_KEY)));
      merged = mergeTaskIndexes(legacyIndexes);
    }
    tasks = merged.tasks;
    projects = merged.projects;
    activeTaskId = merged.activeTaskId;
    let plansMigrated = false;
    tasks.forEach((task) => {
      if (!task.plan) return;
      const before = JSON.stringify(task.plan);
      migrateTaskPlan(task);
      plansMigrated ||= before !== JSON.stringify(task.plan);
    });
    purgeEmptyNewTasks();
    if (merged.tasks.length > 0 || merged.projects.length > 0 || plansMigrated) await saveTaskIndex();
  } catch (error) {
    console.warn("Unable to load task index:", error);
  }
}

async function recoverMissingTaskSessions() {
  if (!window.piAgent?.recoverMissingTaskSessions) return;
  try {
    const recovery = await window.piAgent.recoverMissingTaskSessions();
    if (!recovery?.index) return;
    const merged = mergeTaskIndexes([{ tasks, projects, activeTaskId }, recovery.index]);
    tasks = merged.tasks;
    projects = merged.projects;
    activeTaskId = merged.activeTaskId;
    if (recovery.recoveredCount > 0 || recovery.repairedCount > 0) {
      console.info(`Recovered ${recovery.recoveredCount} missing Pi session entries and repaired ${recovery.repairedCount || 0} duplicate task ids.`);
      saveTaskIndex();
    }
  } catch (error) {
    // Session recovery is additive; a malformed legacy file must not block startup.
    console.warn("Unable to recover missing Pi sessions:", error);
  }
}

// 仅清理没有会话文件的临时草稿；任何已创建的 Pi 会话必须保留。
function purgeEmptyNewTasks() {
  let changed = false;
  for (let i = tasks.length - 1; i >= 0; i--) {
    const task = tasks[i];
    if (task.title !== "新建任务") continue;
    if (task.sessionFile || task.draftText || task.lastMessageAt) continue;
    changed = true;
    tasks.splice(i, 1);
  }
  if (changed) {
    if (activeTaskId && !tasks.some((t) => t.id === activeTaskId)) activeTaskId = null;
    saveTaskIndex();
  }
}

function saveTaskIndex() {
  const index = { tasks, projects, activeTaskId };
  const save = window.piAgent?.saveTaskIndex;
  if (typeof save !== "function") return Promise.resolve();
  const pending = save(index);
  pending.catch((error) => {
    console.warn("Unable to save task index:", error);
  });
  return pending;
}

function currentTask() {
  return tasks.find((task) => task.id === activeTaskId && !task.archivedAt) || null;
}

function projectForTask(task) {
  return task?.projectId ? projects.find((project) => project.id === task.projectId) || null : null;
}

function displayTaskTime(timestamp) {
  if (!timestamp) return "刚刚";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  return minutes === 0 ? "刚刚" : minutes < 60 ? `${minutes} 分钟前` : "较早";
}

function taskSortTime(task) {
  return Number(task?.lastRunAt ?? task?.updatedAt ?? task?.createdAt ?? 0) || 0;
}

function showEmptyTaskState() {
  activeTaskId = null;
  sessionReady = false;
  streamStartPending = false;
  finalizeAiBlock();
  chatEl.innerHTML = "";
  const message = placeholderEl?.querySelector("p");
  if (message) message.textContent = "点击“新建任务”开始对话。";
  renderPlanList();
  if (placeholderEl) {
    placeholderEl.style.display = "";
    chatEl.appendChild(placeholderEl);
  }
  hideLoadingBar();
  updateComposerState();
  updateProjectBinding();
}

function ensureActiveTask() {
  let task = currentTask();
  if (task) return task;
  task = {
    id: newId("task"),
    title: "新建任务",
    projectId: null,
    sessionFile: null,
    status: "idle",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  tasks.unshift(task);
  activeTaskId = task.id;
  saveTaskIndex();
  return task;
}

function setTaskStatus(task, status) {
  if (!task || task.status === status) return;
  task.status = status;
  if (status === "running") {
    const now = Date.now();
    task.lastRunAt = now;
    task.updatedAt = now;
  }
  saveTaskIndex();
  renderTaskList();
}

function renderTaskList() {
  projectListEl.innerHTML = "";
  unprojectedTaskListEl.innerHTML = "";

  const orderedProjects = [...projects].sort((a, b) => b.createdAt - a.createdAt);
  if (orderedProjects.length === 0) {
    projectListEl.innerHTML = `<div class="tp-empty">选择文件夹后会显示项目</div>`;
  } else {
    orderedProjects.forEach((project) => {
      const group = document.createElement("div");
      group.className = "tp-project";
      const header = document.createElement("button");
      header.type = "button";
      header.className = "tp-project-header";
      header.innerHTML = `<img class="tp-project-icon" data-theme-icon="folder" src="${themeIconSource("folder")}" alt="" /><span class="tp-project-name"></span><span class="tp-project-more">•••</span>`;
      header.querySelector(".tp-project-name").textContent = project.name;
      header.title = project.path;
      header.addEventListener("contextmenu", (event) => openProjectContextMenu(event, project));
      header.addEventListener("click", (event) => {
        if (!event.target.closest(".tp-project-more")) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.target.getBoundingClientRect();
        openProjectContextMenuAt(project, rect.right, rect.bottom);
      });
      group.appendChild(header);

      const projectTasks = tasks
        .filter((task) => task.projectId === project.id && !task.archivedAt)
        .sort((a, b) => taskSortTime(b) - taskSortTime(a));
      const children = document.createElement("div");
      children.className = "tp-project-tasks";
      if (projectTasks.length === 0) {
        children.innerHTML = `<div class="tp-empty">右键项目以新建任务</div>`;
      } else {
        projectTasks.forEach((task) => children.appendChild(makeTaskItem(task)));
      }
      group.appendChild(children);
      projectListEl.appendChild(group);
    });
  }

  const unprojectedTasks = tasks
    .filter((task) => !task.projectId && !task.archivedAt)
    .sort((a, b) => taskSortTime(b) - taskSortTime(a));
  if (unprojectedTasks.length === 0) {
    unprojectedTaskListEl.innerHTML = `<div class="tp-empty">暂无非项目对话</div>`;
  } else {
    unprojectedTasks.forEach((task) => unprojectedTaskListEl.appendChild(makeTaskItem(task)));
  }
  updateProjectBinding();
}

function makeTaskItem(task) {
  const item = document.createElement("div");
  item.setAttribute("role", "button");
  item.tabIndex = 0;
  item.className = "tp-item" + (task.id === activeTaskId ? " active" : "");
  item.innerHTML = `
    <span class="tp-dot-wrap"><span class="tp-dot ${task.status === "running" ? "running" : "idle"}"></span></span>
    <span class="tp-name"></span>
    <span class="tp-time"></span>`;
  const taskName = item.querySelector(".tp-name");
  taskName.textContent = task.title;
  item.querySelector(".tp-time").textContent = displayTaskTime(taskSortTime(task));
  item.title = task.title;
  item.addEventListener("click", (event) => {
    if (!event.target.closest(".tp-name-input")) switchTask(task);
  });
  item.addEventListener("keydown", (event) => {
    if (event.target.closest(".tp-name-input")) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      switchTask(task);
    }
  });
  item.addEventListener("contextmenu", (event) => openTaskContextMenu(event, task));

  if (task.id === renamingTaskId) {
    const input = document.createElement("input");
    input.className = "tp-name-input";
    input.value = task.title;
    input.maxLength = 80;
    input.setAttribute("aria-label", "任务名称");
    taskName.replaceWith(input);
    item.removeAttribute("title");

    let resolved = false;
    const finishRename = (save) => {
      if (resolved) return;
      resolved = true;
      const nextTitle = input.value.trim();
      if (save && nextTitle) {
        task.title = nextTitle;
        saveTaskIndex();
      }
      renamingTaskId = null;
      renderTaskList();
    };
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        finishRename(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finishRename(false);
      }
    });
    input.addEventListener("blur", () => finishRename(true));
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }
  return item;
}

function updateProjectBinding() {
  const project = projectForTask(currentTask());
  projectBindingLabel.textContent = project ? project.name : "选择项目文件夹";
  projectBindingBtn.classList.toggle("bound", Boolean(project));
  projectBindingBtn.title = project ? project.path : "选择项目文件夹";
  scheduleChangeReviewRefresh();
}

/* ---------------- 对话缓存（LRU DOM 缓存 + 加载进度条） ---------------- */
// 键为 sessionFile（任务标题变化不影响缓存）
const LOADING_BAR_DELAY = 150;
let _loadingBarTimer = null;
let _loadingBarEl = null;

function showLoadingBar() {
  if (!_loadingBarEl) _loadingBarEl = document.querySelector("#chat-loading-bar");
  if (!_loadingBarEl) return;
  clearTimeout(_loadingBarTimer);
  _loadingBarTimer = setTimeout(() => {
    _loadingBarEl.classList.remove("hidden");
  }, LOADING_BAR_DELAY);
}

function hideLoadingBar() {
  clearTimeout(_loadingBarTimer);
  _loadingBarTimer = null;
  if (_loadingBarEl) _loadingBarEl.classList.add("hidden");
}

// 绑定缓存 DOM 中卡片/思考块的点击事件（缓存恢复后调用）
function bindChatCardEvents() {
  document.querySelectorAll(".tool-card .tool-head").forEach((head) => {
    head.addEventListener("click", () => {
      const card = head.closest(".tool-card");
      const body = card.querySelector(".tool-body");
      card.classList.toggle("expanded");
      if (card.classList.contains("expanded")) expandCard(card, body);
      else collapseCard(card);
    });
  });
  document.querySelectorAll(".thinking-head").forEach((head) => {
    head.addEventListener("click", () => {
      const card = head.closest(".thinking");
      const body = card.querySelector(".thinking-body");
      card.classList.toggle("expanded");
      if (card.classList.contains("expanded")) expandCard(card, body);
      else collapseCard(card);
    });
  });
}

// 有新消息到来时，该任务的缓存失效
function invalidateChatCache(taskId = activeTaskId) {
  const task = tasks.find((entry) => entry.id === taskId);
  if (task?.sessionFile) chatCache.delete(task.sessionFile);
}

function cacheRenderedTask(task) {
  if (!task?.sessionFile || chatEl.children.length <= 1) return;
  chatCache.set(task.sessionFile, {
    html: chatEl.innerHTML,
    scrollTop: chatEl.scrollTop,
    updatedAt: Date.now(),
  });
  if (chatCache.size > 8) {
    const first = chatCache.keys().next().value;
    if (first) chatCache.delete(first);
  }
}

function resetLiveMessageReferences() {
  currentAiRow = null;
  currentAiTextEl = null;
  currentAiText = "";
  currentThinkingBody = null;
  currentAiHasContent = false;
  activeReadBatch = null;
  readToolEntries.clear();
}

async function previewTaskWhileStreaming(task) {
  if (isSwitchingTask || task.id === activeTaskId) return false;
  isSwitchingTask = true;
  try {
    cacheRenderedTask(currentTask());
    activeTaskId = task.id;
    sessionReady = false;
    resetLiveMessageReferences();
    renderPlanList();
    renderTaskList();
    updateComposerState();

    const cached = task.sessionFile ? chatCache.get(task.sessionFile) : null;
    if (cached) {
      chatEl.innerHTML = cached.html;
      bindChatCardEvents();
      requestAnimationFrame(() => { chatEl.scrollTop = cached.scrollTop || 0; });
    } else {
      chatEl.innerHTML = "";
      chatEl.appendChild(placeholderEl);
      const message = placeholderEl?.querySelector("p");
      if (message) message.textContent = task.sessionFile ? "正在加载历史对话…" : "点击“新建任务”开始对话。";
      if (task.sessionFile && typeof window.piAgent?.getHistoryForSession === "function") {
        const history = await window.piAgent.getHistoryForSession(task.sessionFile);
        if (activeTaskId !== task.id) return false;
        await restoreTaskHistory(history);
        cacheRenderedTask(task);
      }
    }
    inputEl.focus();
    return true;
  } catch (error) {
    addError(`加载对话历史失败：${error?.message ?? error}`);
    return false;
  } finally {
    isSwitchingTask = false;
  }
}

async function switchTask(task, force = false, forkSession = false) {
  if (isSwitchingTask || (!force && task.id === activeTaskId)) return false;
  if (isStreaming || streamStartPending) {
    return task.id === activeTaskId ? false : previewTaskWhileStreaming(task);
  }
  isSwitchingTask = true;

  // 1. 保存当前对话 DOM + 滚动位置到缓存（LRU，最多 8 条，按 sessionFile 存取）
  const prevTask = currentTask();
  const previousUi = { html: chatEl.innerHTML, scrollTop: chatEl.scrollTop };
  cacheRenderedTask(prevTask);

  // 2. 标记目标会话，先渲染 UI
  sessionReady = false;
  updateComposerState();
  activeTaskId = task.id;
  renderPlanList();
  renderTaskList();
  finalizeAiBlock();

  const cached = chatCache.get(task.sessionFile);
  const hasCache = Boolean(cached && task.sessionFile);

  if (hasCache) {
    // 缓存命中：瞬间恢复 DOM，并异步恢复滚动位置（避免布局未完成导致失效）
    chatEl.innerHTML = cached.html;
    bindChatCardEvents();
    requestAnimationFrame(() => { chatEl.scrollTop = cached.scrollTop || 0; });
  } else {
    // 缓存未命中：显示占位与加载进度条
    chatEl.innerHTML = "";
    chatEl.appendChild(placeholderEl);
    placeholderEl.style.display = "";
    showLoadingBar();
  }

  // 3. 始终在后台创建/激活主进程会话
  const project = projectForTask(task);
  let result = null;
  try {
    result = await window.piAgent.createSession({
      cwd: project?.path,
      sessionFile: (forkSession ? task.forkSourceSessionFile : task.sessionFile) || undefined,
      forkSession,
    });
    task.sessionFile = result?.sessionFile || task.sessionFile;
    if (tasks.includes(task)) await saveTaskIndex();

    if (!hasCache) {
      await restoreTaskHistory();
    }

    // 保存最新 DOM + 滚动位置到缓存（后台重建后）
    if (task.sessionFile) {
      chatCache.set(task.sessionFile, {
        html: chatEl.innerHTML,
        scrollTop: chatEl.scrollTop,
        updatedAt: Date.now(),
      });
      if (chatCache.size > 8) {
        const first = chatCache.keys().next().value;
        if (first) chatCache.delete(first);
      }
    }
    sessionReady = true;
    updateComposerState();
    inputEl.focus();
    return true;
  } catch (error) {
    addError(`创建会话失败：${error?.message ?? error}`);
    console.error("Unable to switch task:", error);
    activeTaskId = prevTask?.id ?? null;
    renderPlanList();
    chatEl.innerHTML = previousUi.html;
    bindChatCardEvents();
    requestAnimationFrame(() => { chatEl.scrollTop = previousUi.scrollTop; });
    renderTaskList();
    if (prevTask?.sessionFile) {
      try {
        const previousProject = projectForTask(prevTask);
        const restored = await window.piAgent.createSession({
          cwd: previousProject?.path,
          sessionFile: prevTask.sessionFile,
        });
        prevTask.sessionFile = restored?.sessionFile || prevTask.sessionFile;
        await saveTaskIndex();
        sessionReady = true;
      } catch (restoreError) {
        console.error("Unable to restore previous task after failed switch:", restoreError);
      }
    }
    updateComposerState();
    return false;
  } finally {
    hideLoadingBar();
    isSwitchingTask = false;
    focusComposerWhenAvailable();
  }
}

async function createTask(projectId = currentTask()?.projectId || null) {
  const task = {
    id: newId("task"),
    title: "新建任务",
    projectId,
    sessionFile: null,
    status: "idle",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  tasks.unshift(task);
  await saveTaskIndex();
  await switchTask(task, true);
  openTasksPanel();
}

async function recreateActiveTaskSession() {
  await switchTask(ensureActiveTask(), true);
}

function findOrCreateProject(folderPath) {
  const folderKey = normalizeProjectPath(folderPath);
  let project = projects.find((item) => normalizeProjectPath(item.path) === folderKey);
  if (!project) {
    const normalized = folderPath.replace(/[\\/]+$/, "");
    project = {
      id: newId("project"),
      path: folderPath,
      name: normalized.split(/[\\/]/).pop() || folderPath,
      createdAt: Date.now(),
    };
    projects.unshift(project);
  }
  return project;
}

async function chooseProjectFolder() {
  const folderPath = await window.piAgent.selectProjectFolder();
  if (!folderPath) return;
  const task = ensureActiveTask();
  const project = findOrCreateProject(folderPath);
  task.projectId = project.id;
  saveTaskIndex();
  await switchTask(task, true, Boolean(task.sessionFile));
  renderTaskList();
}

function unbindCurrentTask() {
  const task = currentTask();
  if (!task) return;
  task.projectId = null;
  saveTaskIndex();
  closeProjectBindingPopover();
  renderTaskList();
  switchTask(task, true, Boolean(task.sessionFile));
}

function completeTask(taskId = activeTaskId) {
  const task = tasks.find((entry) => entry.id === taskId);
  if (task?.status === "running") setTaskStatus(task, "idle");
}

function completeActiveTask() {
  completeTask(activeTaskId);
}

let contextProjectId = null;
function openProjectContextMenu(event, project) {
  event.preventDefault();
  closeTaskContextMenu();
  contextProjectId = project.id;
  openContextMenu(projectContextMenu, event.clientX, event.clientY);
}

function openProjectContextMenuAt(project, clientX, clientY) {
  closeTaskContextMenu();
  contextProjectId = project.id;
  openContextMenu(projectContextMenu, clientX, clientY);
}

function openContextMenu(menu, clientX, clientY) {
  menu.style.left = `${clientX}px`;
  menu.style.top = `${clientY}px`;
  menu.classList.add("open");
  menu.setAttribute("aria-hidden", "false");
  const margin = 8;
  menu.style.left = `${Math.max(margin, Math.min(clientX, window.innerWidth - menu.offsetWidth - margin))}px`;
  menu.style.top = `${Math.max(margin, Math.min(clientY, window.innerHeight - menu.offsetHeight - margin))}px`;
}

let contextTaskId = null;
let renamingTaskId = null;
function openTaskContextMenu(event, task) {
  event.preventDefault();
  closeProjectContextMenu();
  contextTaskId = task.id;
  openContextMenu(taskContextMenu, event.clientX, event.clientY);
}

function renameTask(task) {
  renamingTaskId = task.id;
  renderTaskList();
}

async function archiveTask(task) {
  if (isStreaming) {
    addError("请先停止正在运行的任务后再归档。");
    return;
  }
  task.archivedAt = Date.now();
  task.status = "idle";
  const wasActive = task.id === activeTaskId;
  if (wasActive) activeTaskId = null;
  saveTaskIndex();
  renderTaskList();
  if (wasActive) await createTask(task.projectId);
}

async function deleteTask(task) {
  if (isStreaming) {
    addError("请先停止正在运行的任务后再删除。");
    return;
  }
  if (!confirm(`确定删除"${task.title}"吗？该任务及其本地会话记录将被永久删除。`)) return;
  const hasOtherReference = task.sessionFile && tasks.some((item) => item.id !== task.id
    && normalizeSessionPath(item.sessionFile) === normalizeSessionPath(task.sessionFile));
  task.deletingAt = Date.now();
  try {
    await saveTaskIndex();
  } catch {
    delete task.deletingAt;
    addError("删除准备失败，任务未被删除。");
    return;
  }
  let deletion = null;
  if (task.sessionFile) {
    try {
      if (!hasOtherReference) deletion = await window.piAgent.deleteSessionFile(task.sessionFile);
    } catch (error) {
      delete task.deletingAt;
      await saveTaskIndex().catch(() => {});
      addError(`删除会话文件失败，任务已保留：${error?.message ?? error}`);
      return;
    }
  }
  const wasActive = task.id === activeTaskId;
  const previousTasks = tasks;
  const previousActiveTaskId = activeTaskId;
  tasks = tasks.filter((item) => item.id !== task.id);
  if (wasActive) activeTaskId = null;
  try {
    await saveTaskIndex();
  } catch (error) {
    tasks = previousTasks;
    activeTaskId = previousActiveTaskId;
    delete task.deletingAt;
    if (deletion?.trashPath) await window.piAgent.restoreDeletedSessionFile(deletion.trashPath, task.sessionFile);
    await saveTaskIndex().catch(() => {});
    addError(`删除记录失败，任务已恢复：${error?.message ?? error}`);
    return;
  }
  renderTaskList();
  if (wasActive) {
    // 删除当前活跃任务后，优先切换到最近运行的其他任务；没有任务则保持空状态。
    const candidate = tasks
      .filter((t) => !t.archivedAt)
      .sort((a, b) => taskSortTime(b) - taskSortTime(a))[0];
    if (candidate) {
      await switchTask(candidate, true);
    } else showEmptyTaskState();
  }
}

async function deleteProject(project) {
  if (isStreaming) {
    addError("请先停止正在运行的任务后再删除项目。");
    return;
  }
  const projectTasks = tasks.filter((task) => task.projectId === project.id);
  const taskLabel = projectTasks.length === 1 ? "1 个任务" : `${projectTasks.length} 个任务`;
  if (!confirm(`确定删除项目“${project.name}”吗？这将永久删除项目及其${taskLabel}的本地会话记录。`)) return;

  const previousTasks = tasks;
  const previousProjects = projects;
  const previousActiveTaskId = activeTaskId;
  projectTasks.forEach((task) => { task.deletingAt = Date.now(); });
  try {
    await saveTaskIndex();
  } catch {
    projectTasks.forEach((task) => { delete task.deletingAt; });
    addError("删除项目准备失败，项目未被删除。");
    return;
  }
  const deletingActiveTask = projectTasks.some((task) => task.id === activeTaskId);
  const projectTaskIds = new Set(projectTasks.map((task) => task.id));
  const sessionFiles = [...new Set(projectTasks.map((task) => task.sessionFile).filter(Boolean))]
    .filter((sessionFile) => !tasks.some((task) => !projectTaskIds.has(task.id)
      && normalizeSessionPath(task.sessionFile) === normalizeSessionPath(sessionFile)));
  const failedDeletions = [];
  const deletions = [];
  for (const sessionFile of sessionFiles) {
    try {
      const deletion = await window.piAgent.deleteSessionFile(sessionFile);
      if (deletion?.trashPath) deletions.push({ ...deletion, sessionFile });
    } catch (error) {
      // The index still needs to be removed; report files that could not be removed.
      failedDeletions.push(error?.message ?? String(error));
    }
  }

  if (failedDeletions.length > 0) {
    projectTasks.forEach((task) => { delete task.deletingAt; });
    await Promise.all(deletions.map((item) => window.piAgent.restoreDeletedSessionFile(item.trashPath, item.sessionFile)));
    await saveTaskIndex().catch(() => {});
    addError(`删除项目失败，项目已保留：${failedDeletions[0]}`);
    return;
  }

  projectTasks.forEach((task) => chatCache.delete(task.sessionFile));
  tasks = tasks.filter((task) => task.projectId !== project.id);
  projects = projects.filter((item) => item.id !== project.id);
  if (deletingActiveTask) activeTaskId = null;
  try {
    await saveTaskIndex();
  } catch (error) {
    tasks = previousTasks;
    projects = previousProjects;
    activeTaskId = previousActiveTaskId;
    projectTasks.forEach((task) => { delete task.deletingAt; });
    await Promise.all(deletions.map((item) => window.piAgent.restoreDeletedSessionFile(item.trashPath, item.sessionFile)));
    await saveTaskIndex().catch(() => {});
    addError(`删除项目记录失败，项目已恢复：${error?.message ?? error}`);
    return;
  }
  renderTaskList();

  if (deletingActiveTask) {
    const candidate = tasks
      .filter((task) => !task.archivedAt)
      .sort((left, right) => taskSortTime(right) - taskSortTime(left))[0];
    if (candidate) await switchTask(candidate, true);
    else showEmptyTaskState();
  }
  if (failedDeletions.length > 0) {
    addError(`项目已从侧边栏移除，但有 ${failedDeletions.length} 个会话文件未能删除。`);
  }
}

function closeProjectContextMenu() {
  projectContextMenu.classList.remove("open");
  projectContextMenu.setAttribute("aria-hidden", "true");
  contextProjectId = null;
}

function closeTaskContextMenu() {
  taskContextMenu.classList.remove("open");
  taskContextMenu.setAttribute("aria-hidden", "true");
  contextTaskId = null;
}

function closeProjectBindingPopover() {
  projectBindingPopover.classList.remove("open");
  projectBindingPopover.setAttribute("aria-hidden", "true");
}

const PANEL_ANIM_MS = 280;   // 任务面板高度动画时长（略大于 CSS .24s）
const SIDENAV_ANIM_MS = 260; // 侧边栏宽度动画时长（略大于 CSS .22s）

function openTasksPanel() {
  tasksPanelEl.classList.remove("settled"); // 展开动画期间 overflow:hidden
  tasksPanelEl.classList.add("open");
  menuTasksEl.classList.add("expanded");
  // 展开动画结束后再允许滚动（避免滚动条闪现）
  // 若面板因纯 CSS 编排有 delay（展开侧边栏后），延迟加上侧边栏时长
  const delayed = sidenavEl.classList.contains("panel-open") && !sidenavEl.classList.contains("collapsed");
  clearTimeout(openTasksPanel._t);
  openTasksPanel._t = setTimeout(
    () => tasksPanelEl.classList.add("settled"),
    PANEL_ANIM_MS + (delayed ? SIDENAV_ANIM_MS : 0)
  );
}
function closeTasksPanel() {
  tasksPanelEl.classList.remove("open");
  tasksPanelEl.classList.remove("settled");
  menuTasksEl.classList.remove("expanded");
  clearTimeout(openTasksPanel._t);
}

/* ---------------- 输入框自适应高度 ---------------- */
function autoResize() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + "px";
}

/* ---------------- 交互 ---------------- */
function updateComposerState() {
  const canSend = sessionReady && (inputEl.value.trim().length > 0 || pendingAttachments.length > 0);
  const streamingInBackground = Boolean(isStreaming && streamingTaskId && streamingTaskId !== activeTaskId);
  btnAttachment.disabled = isStreaming;
  btnSend.disabled = isStreaming ? false : !canSend;
  btnSend.classList.toggle("is-stopping", isStreaming);
  btnSend.title = isStreaming ? (streamingInBackground ? "停止后台生成" : "停止生成") : "发送";
  btnSend.setAttribute("aria-label", btnSend.title);
}

function setStreamingUi(nextStreaming) {
  isStreaming = Boolean(nextStreaming);
  updateComposerState();
}

async function sendPrompt() {
  if (isStreaming || streamStartPending) return;

  const rawText = inputEl.value.trim();
  // 把选中的 Skill/MCP 标签名拼到消息开头，让 Agent 感知使用了哪些工具
  const tagPrefix = selectedTags.length
    ? selectedTags.map((t) => `[${t.kind === "skill" ? "Skill" : "MCP"}: ${t.name}]`).join(" ") + " "
    : "";
  const text = tagPrefix + rawText;
  if ((!text.trim() && pendingAttachments.length === 0) || !sessionReady) return;

  const task = ensureActiveTask();
  const attachments = pendingAttachments;
  if (task.title === "新建任务") task.title = (rawText || text).slice(0, 36) || attachments[0]?.name || "新建任务";
  streamingTaskId = task.id;
  setTaskStatus(task, "running");
  renderTaskList();

  beginTurnMetrics();
  addUserMsg(rawText, attachments, selectedTags);
  invalidateChatCache(); // 发送新消息后缓存失效
  inputEl.value = "";
  selectedTags = [];
  renderTagBar();
  pendingAttachments = [];
  renderPendingAttachments();
  autoResize();
  updateComposerState();
  streamStartPending = true;
  setStreamingUi(true);
  try {
    await window.piAgent.prompt(text, attachments.map((attachment) => attachment.path));
  } catch (err) {
    streamStartPending = false;
    setStreamingUi(false);
    completeTask(streamingTaskId);
    streamingTaskId = null;
    finishTurnMetrics();
    addError(String(err?.message ?? err));
  }
}

async function handleSendButton() {
  if (isStreaming) {
    btnSend.disabled = true;
    // An abort may complete before agent_start arrives. Do not let the optimistic
    // pending flag keep the control stuck in its stopping state afterwards.
    streamStartPending = false;
    try {
      await window.piAgent.abort();
      blockPlanItem(tasks.find((task) => task.id === streamingTaskId) || currentTask(), "用户已停止当前轮执行");
    } catch (error) {
      addError(`停止回复失败：${error?.message ?? error}`);
    } finally {
      // The main process restores the send icon only after session.abort()
      // confirms that the session is idle.
      updateComposerState();
    }
    return;
  }
  await sendPrompt();
}

btnSend.addEventListener("click", handleSendButton);
inputEl.addEventListener("keydown", (e) => {
  // 自动补全下拉打开时，优先处理导航键
  if (autocompleteOpen) {
    if (e.key === "ArrowDown") { e.preventDefault(); moveAutocomplete(1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); moveAutocomplete(-1); return; }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); confirmAutocomplete(); return; }
    if (e.key === "Escape") { e.preventDefault(); closeAutocomplete(); return; }
    if (e.key === "Tab") { e.preventDefault(); confirmAutocomplete(); return; }
  }
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!isStreaming && !streamStartPending) sendPrompt();
  }
});
inputEl.addEventListener("input", () => { autoResize(); updateComposerState(); handleAutocompleteInput(); });
inputEl.addEventListener("click", () => closeAutocomplete());
inputEl.addEventListener("blur", () => { setTimeout(() => closeAutocomplete(), 150); });
btnAttachment.addEventListener("click", selectAttachments);

/* ═══════════════ Skill / MCP 自动补全 ═══════════════ */
const autocompleteEl = $("#autocomplete-dropdown");
const tagBarEl = $("#tag-bar");
let autocompleteOpen = false;
let autocompleteItems = [];   // 当前匹配项
let autocompleteIndex = 0;    // 当前高亮索引
let autocompleteStart = -1;   // 匹配文本在输入框中的起始位置
let autocompleteEnd = -1;     // 匹配文本在输入框中的结束位置（光标处）
let autocompletePrefix = "";  // 匹配到的原文前缀
let selectedTags = [];        // 已选标签 {kind, id, name}

// 拉取已启用的 Skill 与 MCP 列表
let autocompleteRequestId = 0;
let integrationCandidateCache = { expiresAt: 0, entries: null };

async function fetchIntegrationCandidates() {
  if (integrationCandidateCache.entries && integrationCandidateCache.expiresAt > Date.now()) {
    return integrationCandidateCache.entries;
  }
  try {
    const data = await window.piAgent.listIntegrations();
    const skills = (data.skills || []).filter((s) => s.enabled !== false)
      .map((s) => ({ kind: "skill", id: s.id, name: s.name, desc: s.description || s.source }));
    const mcps = (data.mcpServers || []).filter((m) => m.enabled !== false)
      .map((m) => ({ kind: "mcp", id: m.id, name: m.name, desc: m.source }));
    const entries = [...skills, ...mcps];
    integrationCandidateCache = { entries, expiresAt: Date.now() + 5000 };
    return entries;
  } catch { return []; }
}

function invalidateIntegrationCandidateCache() {
  integrationCandidateCache = { expiresAt: 0, entries: null };
}

// 计算当前光标前的匹配前缀（≥2 个字符）
function currentMatchPrefix() {
  const pos = inputEl.selectionStart;
  const text = inputEl.value.slice(0, pos);
  const m = text.match(/([A-Za-z][A-Za-z0-9_\-]{1,})$/);
  if (!m) return null;
  return { prefix: m[1], start: pos - m[1].length };
}

async function handleAutocompleteInput() {
  const match = currentMatchPrefix();
  if (!match) { closeAutocomplete(); return; }
  const requestId = ++autocompleteRequestId;
  const inputSnapshot = inputEl.value;
  const cursorPosition = inputEl.selectionStart;
  autocompleteStart = match.start;
  autocompleteEnd = inputEl.selectionStart; // 光标位置（匹配前缀结束处）
  autocompletePrefix = match.prefix;
  const candidates = await fetchIntegrationCandidates();
  if (requestId !== autocompleteRequestId || inputEl.value !== inputSnapshot || inputEl.selectionStart !== cursorPosition) return;
  const lower = match.prefix.toLowerCase();
  // 重合度排序：前缀开头匹配 > 包含匹配 > 其他
  autocompleteItems = candidates
    .filter((c) => c.name.toLowerCase().includes(lower))
    .sort((a, b) => {
      const an = a.name.toLowerCase(), bn = b.name.toLowerCase();
      const aStart = an.startsWith(lower) ? 0 : 1;
      const bStart = bn.startsWith(lower) ? 0 : 1;
      if (aStart !== bStart) return aStart - bStart;
      return an.indexOf(lower) - bn.indexOf(lower);
    })
    .slice(0, 8);
  if (!autocompleteItems.length) { closeAutocomplete(); return; }
  autocompleteIndex = 0;
  renderAutocomplete();
}

function renderAutocomplete() {
  autocompleteEl.innerHTML = autocompleteItems.map((item, i) => {
    const icon = integrationIconMarkup(item.kind);
    const label = item.kind === "skill" ? "SKILL" : "MCP";
    return `<button class="ac-item ${item.kind}${i === autocompleteIndex ? " active" : ""}"
      role="option" data-index="${i}" aria-selected="${i === autocompleteIndex}">
      <span class="ac-icon">${icon}</span>
      <span class="ac-text">
        <div class="ac-name">${escapeIntegrationText(item.name)}</div>
        <div class="ac-desc">${escapeIntegrationText(item.desc)}</div>
      </span>
      <span class="ac-kind">${label}</span>
    </button>`;
  }).join("");
  autocompleteEl.classList.remove("hidden");
  autocompleteEl.setAttribute("aria-hidden", "false");
  autocompleteOpen = true;
  autocompleteEl.querySelectorAll(".ac-item").forEach((el) => {
    el.addEventListener("mousedown", (e) => { e.preventDefault(); confirmAutocomplete(Number(el.dataset.index)); });
    el.addEventListener("mousemove", () => { autocompleteIndex = Number(el.dataset.index); highlightAutocomplete(); });
  });
}

function highlightAutocomplete() {
  autocompleteEl.querySelectorAll(".ac-item").forEach((el, i) => {
    el.classList.toggle("active", i === autocompleteIndex);
    el.setAttribute("aria-selected", String(i === autocompleteIndex));
  });
  const active = autocompleteEl.querySelectorAll(".ac-item")[autocompleteIndex];
  active?.scrollIntoView({ block: "nearest" });
}

function moveAutocomplete(delta) {
  autocompleteIndex = (autocompleteIndex + delta + autocompleteItems.length) % autocompleteItems.length;
  highlightAutocomplete();
}

function confirmAutocomplete(index) {
  const item = autocompleteItems[index ?? autocompleteIndex];
  if (!item) return;
  // 用标签名替换输入框中匹配到的前缀文本（使用检测时记录的位置，避免点击后光标漂移）
  const before = inputEl.value.slice(0, autocompleteStart);
  const after = inputEl.value.slice(autocompleteEnd);
  // 只有当当前匹配前缀仍在输入框中时才替换（防止用户在此期间继续编辑）
  const currentMatch = inputEl.value.slice(autocompleteStart, autocompleteEnd);
  if (currentMatch !== autocompletePrefix) {
    closeAutocomplete();
    return;
  }
  // 删除输入框中匹配的前缀文本，光标回到删除处；标签只显示在标签栏
  inputEl.value = before + after;
  inputEl.setSelectionRange(before.length, before.length);
  // 记录标签并渲染
  if (!selectedTags.some((t) => t.id === item.id)) {
    selectedTags.push(item);
    renderTagBar();
  }
  closeAutocomplete();
  autoResize();
  updateComposerState();
  inputEl.focus();
}

function closeAutocomplete() {
  autocompleteRequestId += 1;
  autocompleteEl.classList.add("hidden");
  autocompleteEl.setAttribute("aria-hidden", "true");
  autocompleteOpen = false;
  autocompleteItems = [];
  autocompleteStart = -1;
  autocompleteEnd = -1;
  autocompletePrefix = "";
}

function renderTagBar() {
  if (!selectedTags.length) { tagBarEl.classList.add("hidden"); tagBarEl.innerHTML = ""; return; }
  tagBarEl.classList.remove("hidden");
  tagBarEl.innerHTML = selectedTags.map((tag, i) => {
    const icon = integrationIconMarkup(tag.kind);
    return `<span class="tag-chip" data-tag-index="${i}">
      <span class="tag-icon">${icon}</span>${escapeIntegrationText(tag.name)}
      <button class="tag-remove" data-remove="${i}" title="移除">×</button>
    </span>`;
  }).join("");
  tagBarEl.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedTags.splice(Number(btn.dataset.remove), 1);
      renderTagBar();
    });
  });
}

btnNewTask.addEventListener("click", () => createTask());
projectBindingBtn.addEventListener("click", () => {
  const isBound = Boolean(projectForTask(currentTask()));
  if (!isBound) {
    chooseProjectFolder();
    return;
  }
  const willOpen = !projectBindingPopover.classList.contains("open");
  projectBindingPopover.classList.toggle("open", willOpen);
  projectBindingPopover.setAttribute("aria-hidden", String(!willOpen));
});
projectBindingPopover.addEventListener("click", (event) => {
  const action = event.target.closest("button")?.dataset.projectAction;
  if (action === "unbind") unbindCurrentTask();
  if (action === "reselect") {
    closeProjectBindingPopover();
    chooseProjectFolder();
  }
});
projectContextMenu.addEventListener("click", async (event) => {
  const action = event.target.closest("button")?.dataset.projectContextAction;
  const project = projects.find((item) => item.id === contextProjectId);
  if (!action || !project) return;
  closeProjectContextMenu();
  if (action === "new-task") await createTask(project.id);
  if (action === "delete-project") await deleteProject(project);
});
taskContextMenu.addEventListener("click", async (event) => {
  const action = event.target.closest("button")?.dataset.taskContextAction;
  const task = tasks.find((item) => item.id === contextTaskId);
  if (!action || !task) return;
  closeTaskContextMenu();
  if (action === "rename") renameTask(task);
  if (action === "archive") await archiveTask(task);
  if (action === "delete") await deleteTask(task);
});

// 侧边栏折叠/展开
// 收缩：任务面板与侧边栏宽度并行动画，避免串行导致的停顿和拖沓。
// 展开：先开展侧边栏，再显示任务面板，避免窄栏下的文字闪动。
const sidenavEl = $("#sidenav");
const btnToggleSidenav = $("#btn-toggle-sidenav");
let sidenavAnimating = false;

function setSidenavCollapsed(collapsed) {
  sidenavEl.classList.toggle("collapsed", collapsed);
  btnToggleSidenav.title = collapsed ? "展开侧边栏" : "收起侧边栏";
  btnToggleSidenav.setAttribute("aria-label", collapsed ? "展开侧边栏" : "收起侧边栏");
}

// 等某元素指定属性的 transitionend（带超时兜底，防止事件漏发）
function afterTransition(el, prop, timeout) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; el.removeEventListener("transitionend", onEnd); resolve(); } };
    const onEnd = (e) => { if (e.target === el && e.propertyName === prop) finish(); };
    el.addEventListener("transitionend", onEnd);
    setTimeout(finish, timeout);
  });
}

btnToggleSidenav.addEventListener("click", async () => {
  if (sidenavAnimating) return;
  const willCollapse = !sidenavEl.classList.contains("collapsed");
  const panelOpen = tasksPanelEl.classList.contains("open");

  sidenavAnimating = true;
  try {
    if (willCollapse) {
      if (panelOpen) {
        // 两条过渡同一周期启动：面板淡出并收高，侧边栏同步收宽。
        // rAF 让浏览器先记录面板展开态，防止 max-height 过渡被合并成跳变。
        const wait = afterTransition(tasksPanelEl, "max-height", PANEL_ANIM_MS + 80);
        closeTasksPanel();
        menuTasksEl.classList.add("was-open");
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const sideWait = afterTransition(sidenavEl, "width", SIDENAV_ANIM_MS + 80);
        setSidenavCollapsed(true);
        await Promise.all([wait, sideWait]);
      } else {
        setSidenavCollapsed(true);
        await afterTransition(sidenavEl, "width", SIDENAV_ANIM_MS + 80);
      }
    } else {
      const reopen = menuTasksEl.classList.contains("was-open");
      if (reopen) {
        // 第一步：开展侧边栏，等宽度动画结束
        setSidenavCollapsed(false);
        await afterTransition(sidenavEl, "width", SIDENAV_ANIM_MS + 80);
        // 第二步：开面板
        openTasksPanel();
        menuTasksEl.classList.remove("was-open");
        await afterTransition(tasksPanelEl, "max-height", PANEL_ANIM_MS + 80);
      } else {
        setSidenavCollapsed(false);
        await afterTransition(sidenavEl, "width", SIDENAV_ANIM_MS + 80);
      }
    }
  } finally {
    sidenavAnimating = false;
  }
});

// "任务"菜单：点击展开/收起任务列表面板
menuTasksEl.addEventListener("click", () => {
  if (sidenavEl.classList.contains("collapsed")) return; // 折叠态不展开面板
  document.querySelectorAll(".menu-item").forEach((x) => x.classList.remove("active"));
  menuTasksEl.classList.add("active");
  menuTasksEl.classList.remove("was-open");
  if (tasksPanelEl.classList.contains("open")) {
    closeTasksPanel();
    sidenavEl.classList.remove("panel-open");
  } else {
    openTasksPanel();
  }
});

// 帮助入口（演示高亮）
document.querySelectorAll(".footer-item").forEach((b) =>
  b.addEventListener("click", () => {
    closeTasksPanel();
    sidenavEl.classList.remove("panel-open");
  })
);

/* ---------------- 账户气泡弹窗 ----------------
 * 展开动效：气泡从头像升起 → 菜单项从上到下依次渐变显现 → 尖角收起（脱离成独立气泡）
 * 关闭动效：尖角先回连 → 菜单项从下到上依次淡出 → 气泡下降缩回头像
 */
const accountWrap = $("#account-wrap");
const accountChip = $("#account-chip");
const accountPopover = $("#account-popover");
let accountOpen = false;
let accountAnimating = false;

const POP_RISE_MS = 260;     // 气泡上升时长
const POP_ITEM_STAGGER = 55; // 菜单项逐项显现间隔（与 CSS --i*55ms 对齐）
const POP_ITEM_COUNT = 3;    // 归档/环境/设置
const POP_DETACH_DELAY = 40 + POP_ITEM_STAGGER * (POP_ITEM_COUNT - 1) + 160; // 全部显现后脱离
const POP_CLOSE_MS = 140;    // 回落时长
const POP_CLOSE_STAGGER = 18;
const POP_CLOSE_PREP_MS = 70;

function openAccountPopover() {
  if (accountAnimating || accountOpen) return;
  accountAnimating = true;
  accountOpen = true;
  accountWrap.classList.remove("account-closing");

  // 1. 升起 + 菜单项依次显现（CSS transition-delay 驱动）
  accountWrap.classList.add("account-open");
  accountPopover.setAttribute("aria-hidden", "false");

  // 2. 全部显现完成后 → 脱离（尖角收起）
  setTimeout(() => {
    accountWrap.classList.add("account-detached");
    accountAnimating = false;
  }, POP_DETACH_DELAY);
}

function closeAccountPopover() {
  if (accountAnimating || !accountOpen) return;
  accountAnimating = true;
  accountWrap.classList.add("account-closing");

  // 1. 先回连（尖角重新连接账户模块）
  accountWrap.classList.remove("account-detached");

  // 2. 尖角回连后：菜单项从下到上依次淡出 + 气泡下降缩回
  setTimeout(() => {
    // 从下到上淡出：为每项设置反向 delay
    const items = accountPopover.querySelectorAll(".ap-item, .ap-divider");
    items.forEach((el) => {
      const i = Number(getComputedStyle(el).getPropertyValue("--i")) || 0;
      el.style.transitionDelay = `${(POP_ITEM_COUNT - 1 - i) * POP_CLOSE_STAGGER}ms`;
    });
    accountWrap.classList.remove("account-open");
    accountPopover.setAttribute("aria-hidden", "true");

    setTimeout(() => {
      // 清理内联 delay，恢复 CSS 展开时的正向 stagger
      items.forEach((el) => { el.style.transitionDelay = ""; });
      accountOpen = false;
      accountAnimating = false;
      accountWrap.classList.remove("account-closing");
    }, POP_CLOSE_MS + POP_ITEM_COUNT * POP_CLOSE_STAGGER);
  }, POP_CLOSE_PREP_MS);
}

accountChip.addEventListener("click", (e) => {
  e.stopPropagation();
  if (accountOpen) closeAccountPopover();
  else openAccountPopover();
});

function formatArchiveTime(timestamp) {
  if (!timestamp) return "归档时间未知";
  return new Date(timestamp).toLocaleString();
}

function closeArchive() {
  archiveOverlay?.classList.add("hidden");
  archiveOverlay?.setAttribute("aria-hidden", "true");
}

function renderArchiveList() {
  if (!archiveList) return;
  const archived = tasks.filter((task) => task.archivedAt).sort((a, b) => b.archivedAt - a.archivedAt);
  if (!archived.length) {
    archiveList.innerHTML = '<div class="archive-empty">暂无归档对话</div>';
    return;
  }
  archiveList.innerHTML = archived.map((task) => {
    const project = projectForTask(task);
    const meta = `${project?.name || "非项目对话"} · ${formatArchiveTime(task.archivedAt)}`;
    return `<article class="archive-item"><div class="archive-item-main"><div class="archive-item-title">${escapeHtml(task.title || "未命名对话")}</div><div class="archive-item-meta">${escapeHtml(meta)}</div></div><div class="archive-item-actions"><button type="button" data-archive-action="restore" data-task-id="${escapeHtml(task.id)}">恢复</button><button type="button" class="danger" data-archive-action="delete" data-task-id="${escapeHtml(task.id)}">删除</button></div></article>`;
  }).join("");
  archiveList.querySelectorAll("[data-archive-action]").forEach((button) => button.addEventListener("click", async () => {
    const task = tasks.find((item) => item.id === button.dataset.taskId);
    if (!task) return;
    if (button.dataset.archiveAction === "restore") {
      task.archivedAt = null;
    saveTaskIndex();
      renderTaskList();
      renderArchiveList();
      return;
    }
    await deleteTask(task);
    renderArchiveList();
  }));
}

function openArchive() {
  closeAccountPopover();
  renderArchiveList();
  archiveOverlay?.classList.remove("hidden");
  archiveOverlay?.setAttribute("aria-hidden", "false");
}

document.querySelector("#account-popover .ap-item")?.addEventListener("click", (event) => {
  event.stopPropagation();
  openArchive();
});
document.querySelector("[data-action='open-environment']")?.addEventListener("click", (event) => {
  event.stopPropagation();
  openEnvironmentStatus();
});
$("#btn-close-archive")?.addEventListener("click", closeArchive);
archiveOverlay?.querySelector(".conversation-tool-backdrop")?.addEventListener("click", closeArchive);

const toolApprovalOverlay = $("#tool-approval-overlay");
const toolApprovalDescription = $("#tool-approval-description");
const toolApprovalArgs = $("#tool-approval-args");

function showToolApproval(request) {
  pendingToolApproval = request;
  toolApprovalDescription.textContent = `Agent 请求执行 ${request.toolName}。请确认是否允许本次操作。`;
  toolApprovalArgs.textContent = JSON.stringify(request.args ?? {}, null, 2);
  toolApprovalOverlay.classList.remove("hidden");
  toolApprovalOverlay.setAttribute("aria-hidden", "false");
  $("#btn-approve-tool")?.focus();
}

async function resolveToolApproval(approved) {
  const request = pendingToolApproval;
  if (!request) return;
  pendingToolApproval = null;
  toolApprovalOverlay.classList.add("hidden");
  toolApprovalOverlay.setAttribute("aria-hidden", "true");
  try {
    await window.piAgent.resolveToolApproval(request.approvalId, approved);
  } catch (error) {
    addError(`提交执行确认失败：${error?.message ?? error}`);
  }
}

$("#btn-approve-tool")?.addEventListener("click", () => resolveToolApproval(true));
$("#btn-deny-tool")?.addEventListener("click", () => resolveToolApproval(false));

const changeReviewList = $("#change-review-list");
const changeReviewStatus = $("#change-review-status");
const changeReviewRoot = $("#change-review-root");
const rejectedReviewFiles = new Set();
const changeReviewView = $("#change-review-view");
const internalBrowserView = $("#internal-browser-view");
const internalBrowser = $("#internal-browser");
const browserAddress = $("#browser-address");
const browserBack = $("#btn-browser-back");
const browserForward = $("#btn-browser-forward");
const browserAutomationStatus = $("#browser-automation-status");
const browserAutomationOutput = $("#browser-automation-output");
const browserAutomationSelector = $("#browser-automation-selector");
const browserAutomationText = $("#browser-automation-text");
const browserAutomationButtons = [$("#btn-browser-inspect"), $("#btn-browser-click"), $("#btn-browser-type"), $("#btn-browser-scroll")].filter(Boolean);
const WORKBENCH_MIN_WIDTH = 320;
const WORKBENCH_MAX_WIDTH = 620;
const WORKBENCH_COMPACT_BREAKPOINT = 1050;
let workbenchResizeState = null;
let workbenchReviewRefreshTimer = null;
let workbenchResizeFrame = null;
let workbenchWindowResizeFrame = null;

function isChangeReviewOpen() {
  return Boolean(appShell?.classList.contains("workbench-open"));
}

function maxWorkbenchWidth() {
  return Math.max(
    WORKBENCH_MIN_WIDTH,
    Math.min(WORKBENCH_MAX_WIDTH, Math.floor((appShell?.clientWidth || window.innerWidth) * 0.48))
  );
}

function currentWorkbenchWidth() {
  const stored = Number.parseFloat(getComputedStyle(appShell).getPropertyValue("--workbench-width"));
  return Number.isFinite(stored) ? stored : 420;
}

function setWorkbenchWidth(width, persist = false, maxWidthOverride = null, updateAccessibility = true) {
  if (!appShell) return;
  const maxWidth = Number.isFinite(maxWidthOverride) ? maxWidthOverride : maxWorkbenchWidth();
  const next = Math.round(Math.min(maxWidth, Math.max(WORKBENCH_MIN_WIDTH, Number(width) || 420)));
  appShell.style.setProperty("--workbench-width", `${next}px`);
  if (updateAccessibility) {
    workbenchResizer?.setAttribute("aria-valuemin", String(WORKBENCH_MIN_WIDTH));
    workbenchResizer?.setAttribute("aria-valuemax", String(maxWidth));
    workbenchResizer?.setAttribute("aria-valuenow", String(next));
  }
  if (persist) localStorage.setItem(WORKBENCH_WIDTH_STORAGE_KEY, String(next));
  return next;
}

function initializeWorkbenchLayout() {
  const stored = Number.parseFloat(localStorage.getItem(WORKBENCH_WIDTH_STORAGE_KEY));
  setWorkbenchWidth(Number.isFinite(stored) ? stored : 420);
  window.addEventListener("resize", () => {
    if (workbenchWindowResizeFrame !== null) return;
    workbenchWindowResizeFrame = window.requestAnimationFrame(() => {
      workbenchWindowResizeFrame = null;
      setWorkbenchWidth(currentWorkbenchWidth());
    });
  });

  workbenchResizer?.addEventListener("pointerdown", (event) => {
    if (!isChangeReviewOpen() || window.innerWidth <= WORKBENCH_COMPACT_BREAKPOINT || event.button !== 0) return;
    event.preventDefault();
    const maxWidth = maxWorkbenchWidth();
    const startWidth = currentWorkbenchWidth();
    workbenchResizeState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth,
      maxWidth,
      pendingWidth: startWidth,
    };
    workbenchResizer.setPointerCapture?.(event.pointerId);
    document.body.classList.add("workbench-resizing");
  });

  window.addEventListener("pointermove", (event) => {
    if (!workbenchResizeState || event.pointerId !== workbenchResizeState.pointerId) return;
    const state = workbenchResizeState;
    state.pendingWidth = Math.min(state.maxWidth, Math.max(WORKBENCH_MIN_WIDTH, state.startWidth + state.startX - event.clientX));
    if (workbenchResizeFrame !== null) return;
    workbenchResizeFrame = window.requestAnimationFrame(() => {
      workbenchResizeFrame = null;
      if (!workbenchResizeState) return;
      setWorkbenchWidth(workbenchResizeState.pendingWidth, false, workbenchResizeState.maxWidth, false);
    });
  });

  const finishWorkbenchResize = (event) => {
    if (!workbenchResizeState || event.pointerId !== workbenchResizeState.pointerId) return;
    const state = workbenchResizeState;
    if (workbenchResizeFrame !== null) {
      window.cancelAnimationFrame(workbenchResizeFrame);
      workbenchResizeFrame = null;
    }
    setWorkbenchWidth(state.pendingWidth, true, state.maxWidth);
    workbenchResizeState = null;
    document.body.classList.remove("workbench-resizing");
  };
  window.addEventListener("pointerup", finishWorkbenchResize);
  window.addEventListener("pointercancel", finishWorkbenchResize);

  workbenchResizer?.addEventListener("keydown", (event) => {
    if (!isChangeReviewOpen() || window.innerWidth <= WORKBENCH_COMPACT_BREAKPOINT) return;
    const step = event.shiftKey ? 32 : 16;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setWorkbenchWidth(currentWorkbenchWidth() + step, true);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setWorkbenchWidth(currentWorkbenchWidth() - step, true);
    }
  });
}

function scheduleChangeReviewRefresh() {
  if (!isChangeReviewOpen()) return;
  window.clearTimeout(workbenchReviewRefreshTimer);
  workbenchReviewRefreshTimer = window.setTimeout(() => {
    if (isChangeReviewOpen()) refreshChangeReview();
  }, 120);
}

function setChangeReviewOpen(open) {
  appShell?.classList.toggle("workbench-open", open);
  changeReviewPanel?.setAttribute("aria-hidden", String(!open));
  btnChangeReview?.setAttribute("aria-expanded", String(open));
  if (!open) setChangeReviewView("review");
}

function setChangeReviewView(view) {
  const showBrowser = view === "browser";
  const showTerminal = view === "terminal";
  changeReviewView?.classList.toggle("hidden", showBrowser || showTerminal);
  internalBrowserView?.classList.toggle("hidden", !showBrowser);
  terminalView?.classList.toggle("hidden", !showTerminal);
  document.querySelectorAll("[data-review-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.reviewView === view);
  });
  btnWorkbenchBrowser?.classList.toggle("active", showBrowser);
  btnWorkbenchTerminal?.classList.toggle("active", showTerminal);
  if (showBrowser) {
    updateBrowserNavigation();
    internalBrowser?.focus();
  }
  if (showTerminal) renderTerminalLocation();
}

let browserTabs = [];
let activeBrowserTabId = "";
let terminalType = localStorage.getItem("pi_workbench_terminal_type") === "cmd" ? "cmd" : "powershell";
let activeTerminalRequestId = null;

function browserTabLabel(url, fallback) {
  try { return new URL(url).hostname || fallback; } catch { return fallback; }
}

function loadBrowserTabs() {
  try { browserTabs = JSON.parse(localStorage.getItem(BROWSER_TABS_STORAGE_KEY) || "[]"); } catch { browserTabs = []; }
  browserTabs = browserTabs.filter((tab) => tab && typeof tab.id === "string" && typeof tab.url === "string");
  if (!browserTabs.length) browserTabs = [{ id: crypto.randomUUID(), title: "浏览器 1", url: "https://www.bing.com" }];
  activeBrowserTabId = browserTabs.some((tab) => tab.id === activeBrowserTabId) ? activeBrowserTabId : browserTabs[0].id;
  persistBrowserTabs();
}

function persistBrowserTabs() {
  localStorage.setItem(BROWSER_TABS_STORAGE_KEY, JSON.stringify(browserTabs));
}

function activeBrowserTab() {
  return browserTabs.find((tab) => tab.id === activeBrowserTabId) || browserTabs[0];
}

function setWorkbenchMenu(menu, open) {
  if (!menu) return;
  menu.classList.toggle("open", open);
  menu.setAttribute("aria-hidden", String(!open));
  const button = menu === browserTabMenu ? btnWorkbenchBrowser : btnWorkbenchTerminal;
  button?.setAttribute("aria-expanded", String(open));
}

function renderBrowserTabMenu() {
  if (!browserTabList) return;
  browserTabList.innerHTML = browserTabs.map((tab, index) => `<button type="button" role="menuitem" data-browser-tab-id="${escapeHtml(tab.id)}" class="${tab.id === activeBrowserTabId ? "selected" : ""}"><span>${escapeHtml(tab.title || `浏览器 ${index + 1}`)}</span><small>${escapeHtml(browserTabLabel(tab.url, "新页面"))}</small></button>`).join("");
  browserTabList.querySelectorAll("[data-browser-tab-id]").forEach((button) => button.addEventListener("click", () => switchBrowserTab(button.dataset.browserTabId)));
}

async function switchBrowserTab(tabId) {
  const next = browserTabs.find((tab) => tab.id === tabId);
  if (!next) return;
  const current = activeBrowserTab();
  if (current && internalBrowser?.getURL?.()) current.url = internalBrowser.getURL();
  activeBrowserTabId = next.id;
  persistBrowserTabs();
  renderBrowserTabMenu();
  setWorkbenchMenu(browserTabMenu, false);
  setChangeReviewView("browser");
  if (browserAddress) browserAddress.value = next.url;
  await navigateInternalBrowser(next.url);
}

async function addBrowserTab() {
  const tab = { id: crypto.randomUUID(), title: `浏览器 ${browserTabs.length + 1}`, url: "https://www.bing.com" };
  browserTabs.push(tab);
  await switchBrowserTab(tab.id);
}

function renderTerminalLocation() {
  const projectPath = projectForTask(currentTask())?.path || "未选择项目";
  if (terminalCwd) terminalCwd.textContent = projectPath;
  if (terminalTypeLabel) terminalTypeLabel.textContent = terminalType === "cmd" ? "命令提示符" : "PowerShell";
  const prompt = $("#terminal-prompt");
  if (prompt) prompt.textContent = terminalType === "cmd" ? "CMD" : "PS";
}

function appendTerminalOutput(value, stream = "stdout") {
  if (!terminalOutput || !value) return;
  terminalOutput.textContent += String(value);
  terminalOutput.classList.toggle("has-error", stream === "stderr");
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

async function runTerminalCommand() {
  const command = terminalCommandInput?.value.trim();
  if (!command || activeTerminalRequestId) return;
  const projectPath = projectForTask(currentTask())?.path;
  const requestId = crypto.randomUUID();
  activeTerminalRequestId = requestId;
  terminalCommandInput.value = "";
  btnStopTerminal.disabled = false;
  appendTerminalOutput(`\n${terminalType === "cmd" ? "CMD" : "PS"} ${command}\n`);
  try {
    const result = await window.piAgent.runTerminalCommand({ requestId, cwd: projectPath, shellType: terminalType, command });
    appendTerminalOutput(`\n[进程结束：${result.code ?? "未知"}]\n`);
  } catch (error) {
    appendTerminalOutput(`\n[终端错误：${error?.message ?? error}]\n`, "stderr");
  } finally {
    if (activeTerminalRequestId === requestId) activeTerminalRequestId = null;
    btnStopTerminal.disabled = true;
  }
}

function updateBrowserNavigation() {
  if (!internalBrowser) return;
  browserBack.disabled = !internalBrowser.canGoBack?.();
  browserForward.disabled = !internalBrowser.canGoForward?.();
}

function normalizeBrowserAddress(value) {
  const input = String(value ?? "").trim();
  if (!input) return "https://www.bing.com";
  if (/^https?:\/\//i.test(input)) return input;
  if (/^[a-z0-9.-]+(?::\d+)?(?:\/|$)/i.test(input)) return `https://${input}`;
  return `https://www.bing.com/search?q=${encodeURIComponent(input)}`;
}

function getBrowserOpenLocation() {
  return localStorage.getItem(BROWSER_OPEN_LOCATION_STORAGE_KEY) === "external" ? "external" : "internal";
}

function renderBrowserOpenLocation() {
  const location = getBrowserOpenLocation();
  document.querySelectorAll("[data-browser-location]").forEach((button) => {
    button.setAttribute("aria-checked", String(button.dataset.browserLocation === location));
  });
}

async function openConversationUrl(value) {
  const url = normalizeBrowserAddress(value);
  if (getBrowserOpenLocation() === "external") {
    await window.piAgent.openExternalUrl(url);
    return;
  }
  if (!isChangeReviewOpen()) setChangeReviewOpen(true);
  setChangeReviewView("browser");
  if (browserAddress) browserAddress.value = url;
  await navigateInternalBrowser(url);
}

async function navigateInternalBrowser(value) {
  if (!internalBrowser) return;
  const url = normalizeBrowserAddress(value);
  try {
    await internalBrowser.loadURL(url);
  } catch (error) {
    addError(`浏览器无法打开页面：${error?.message ?? error}`);
  }
}

function setBrowserAutomationState(status, output) {
  if (browserAutomationStatus) browserAutomationStatus.textContent = status;
  if (output !== undefined && browserAutomationOutput) browserAutomationOutput.textContent = output;
}

async function runBrowserAutomation(action, payload = {}) {
  if (!internalBrowser) throw new Error("内置浏览器尚未初始化");
  if (action === "navigate") {
    const url = normalizeBrowserAddress(payload.url);
    await internalBrowser.loadURL(url);
    if (browserAddress) browserAddress.value = url;
    return { action: "navigate", url };
  }
  const serialized = JSON.stringify({ action, selector: payload.selector || "", text: payload.text || "" });
  const script = `(() => {
    const request = ${serialized};
    const visibleText = (value, limit = 240) => String(value || "").replace(/\\s+/g, " ").trim().slice(0, limit);
    const findTarget = () => {
      if (!request.selector) throw new Error("请先填写 CSS 选择器");
      let target;
      try { target = document.querySelector(request.selector); } catch { throw new Error("CSS 选择器格式无效"); }
      if (!target) throw new Error("当前页面没有找到该元素");
      target.scrollIntoView({ block: "center", inline: "nearest" });
      return target;
    };
    if (request.action === "inspect") {
      const interactive = [...document.querySelectorAll("a, button, input, textarea, select, [role='button']")]
        .filter((element) => element.offsetParent !== null)
        .slice(0, 12)
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          label: visibleText(element.getAttribute("aria-label") || element.innerText || element.value || element.placeholder, 72),
        }));
      return {
        action: "inspect",
        title: document.title || "未命名页面",
        url: location.href,
        text: visibleText(document.body?.innerText, 520),
        interactive,
      };
    }
    if (request.action === "click") {
      const target = findTarget();
      target.click();
      return { action: "click", tag: target.tagName.toLowerCase(), label: visibleText(target.getAttribute("aria-label") || target.innerText || target.value, 96) };
    }
    if (request.action === "type") {
      const target = findTarget();
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)) throw new Error("目标元素不支持文本输入");
      target.focus();
      if (target.isContentEditable) target.textContent = request.text;
      else target.value = request.text;
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: request.text }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return { action: "type", tag: target.tagName.toLowerCase(), count: request.text.length };
    }
    if (request.action === "scroll") {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
      return { action: "scroll", position: "bottom" };
    }
    throw new Error("不支持的浏览器自动化操作");
  })()`;
  return internalBrowser.executeJavaScript(script, true);
}

async function performBrowserAutomation(action) {
  const labels = { inspect: "读取页面", click: "点击元素", type: "填写内容", scroll: "滚动页面" };
  browserAutomationButtons.forEach((button) => { button.disabled = true; });
  setBrowserAutomationState(`正在${labels[action]}…`);
  try {
    const result = await runBrowserAutomation(action, {
      selector: browserAutomationSelector?.value.trim(),
      text: browserAutomationText?.value ?? "",
    });
    if (action === "inspect") {
      const elements = result.interactive.length
        ? result.interactive.map((item) => `• ${item.tag}${item.label ? `  ${item.label}` : ""}`).join("\n")
        : "未检测到可交互元素";
      setBrowserAutomationState(`已读取 ${result.interactive.length} 个可交互元素`, `${result.title}\n${result.url}\n\n${result.text || "页面没有可读取文本"}\n\n${elements}`);
    } else if (action === "click") {
      setBrowserAutomationState("已点击目标元素", `${result.tag}${result.label ? ` · ${result.label}` : ""}`);
    } else if (action === "type") {
      setBrowserAutomationState(`已输入 ${result.count} 个字符`, "文本已写入目标元素，并已触发 input / change 事件。");
    } else {
      setBrowserAutomationState("已滚动到页面底部", "页面正在平滑滚动到底部。");
    }
  } catch (error) {
    setBrowserAutomationState("自动化操作未完成", String(error?.message ?? error));
  } finally {
    browserAutomationButtons.forEach((button) => { button.disabled = false; });
  }
}

window.piAgent.onBrowserAutomationRequest?.(async ({ requestId, action, payload } = {}) => {
  if (!requestId) return;
  try {
    if (!isChangeReviewOpen()) setChangeReviewOpen(true);
    setChangeReviewView("browser");
    setBrowserAutomationState("Agent 正在操作浏览器…");
    const result = await runBrowserAutomation(action, payload);
    if (action === "inspect") {
      const elements = result.interactive?.length
        ? result.interactive.map((item) => `• ${item.tag}${item.label ? `  ${item.label}` : ""}`).join("\n")
        : "未检测到可交互元素";
      setBrowserAutomationState(`Agent 已读取 ${result.interactive?.length || 0} 个可交互元素`, `${result.title}\n${result.url}\n\n${result.text || "页面没有可读取文本"}\n\n${elements}`);
    } else if (action === "navigate") {
      setBrowserAutomationState("Agent 已打开页面", result.url);
    } else {
      setBrowserAutomationState("Agent 操作完成", JSON.stringify(result));
    }
    await window.piAgent.resolveBrowserAutomation(requestId, result);
  } catch (error) {
    const message = String(error?.message ?? error);
    setBrowserAutomationState("Agent 浏览器操作未完成", message);
    await window.piAgent.resolveBrowserAutomation(requestId, null, message);
  }
});

async function refreshChangeReview() {
  if (!changeReviewList) return;
  changeReviewStatus.textContent = "正在读取 Git 改动…";
  changeReviewList.innerHTML = "";
  try {
    const cwd = projectForTask(currentTask())?.path;
    const review = await window.piAgent.getChangeReview(cwd);
    changeReviewRoot.textContent = review.root;
    if (review.isGitRepository === false) {
      changeReviewStatus.textContent = "当前文件夹不是 Git 项目";
      changeReviewList.innerHTML = `<div class="change-review-empty">选择一个包含 .git 文件夹的项目后，即可查看文件 Diff、接受或回退改动。</div>`;
      return;
    }
    const visibleFiles = review.files.filter((file) => !rejectedReviewFiles.has(file.path));
    changeReviewStatus.textContent = visibleFiles.length ? `${visibleFiles.length} 个待审查文件${rejectedReviewFiles.size ? `，已拒绝 ${rejectedReviewFiles.size} 个` : ""}` : "工作区没有待审查改动";
    if (!visibleFiles.length) {
      changeReviewList.innerHTML = `<div class="change-review-empty">没有可审查的改动</div>`;
      return;
    }
    changeReviewList.innerHTML = visibleFiles.map((file) => `<article class="change-review-file">
      <div class="change-review-file-head"><code class="change-review-file-name">${escapeHtml(file.path)}</code><span class="change-review-file-status">${escapeHtml(file.status)}</span>
        <div class="change-review-file-actions"><button type="button" data-review-action="accept" data-review-file="${escapeHtml(file.path)}">接受</button><button type="button" data-review-action="reject" data-review-file="${escapeHtml(file.path)}">拒绝</button><button type="button" class="danger" data-review-action="revert" data-review-file="${escapeHtml(file.path)}">回退</button></div>
      </div><pre class="change-review-diff">${escapeHtml(file.diff || (file.isUntracked ? "未跟踪文件，尚无 Git Diff。" : "没有可显示的文本 Diff。"))}</pre>
    </article>`).join("");
    changeReviewList.querySelectorAll("[data-review-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        const filePath = button.dataset.reviewFile;
        const isRevert = button.dataset.reviewAction === "revert";
        const isReject = button.dataset.reviewAction === "reject";
        if (isReject) {
          rejectedReviewFiles.add(filePath);
          await refreshChangeReview();
          return;
        }
        if (isRevert && !window.confirm(`确认回退 ${filePath} 的全部工作区改动？`)) return;
        button.disabled = true;
        try {
          const cwd = projectForTask(currentTask())?.path;
          if (isRevert) await window.piAgent.revertChangeFile(cwd, filePath);
          else await window.piAgent.acceptChangeFile(cwd, filePath);
          await refreshChangeReview();
        } catch (error) {
          addError(`${isRevert ? "回退" : "接受"}文件失败：${error?.message ?? error}`);
          button.disabled = false;
        }
      });
    });
  } catch (error) {
    changeReviewStatus.textContent = "无法读取 Git 改动";
    changeReviewList.innerHTML = `<div class="change-review-empty">${escapeHtml(error?.message ?? error)}</div>`;
  }
}

document.querySelectorAll("[data-review-view]").forEach((button) => {
  button.addEventListener("click", () => setChangeReviewView(button.dataset.reviewView));
});
btnWorkbenchBrowser?.addEventListener("click", () => {
  setChangeReviewView("browser");
  renderBrowserTabMenu();
  setWorkbenchMenu(browserTabMenu, !browserTabMenu.classList.contains("open"));
  setWorkbenchMenu(terminalTypeMenu, false);
});
$("#btn-add-browser-tab")?.addEventListener("click", addBrowserTab);
btnWorkbenchTerminal?.addEventListener("click", () => {
  setChangeReviewView("terminal");
  setWorkbenchMenu(terminalTypeMenu, !terminalTypeMenu.classList.contains("open"));
  setWorkbenchMenu(browserTabMenu, false);
});
terminalTypeMenu?.querySelectorAll("[data-terminal-type]").forEach((button) => {
  button.addEventListener("click", () => {
    terminalType = button.dataset.terminalType === "cmd" ? "cmd" : "powershell";
    localStorage.setItem("pi_workbench_terminal_type", terminalType);
    renderTerminalLocation();
    setWorkbenchMenu(terminalTypeMenu, false);
  });
});
terminalCommandForm?.addEventListener("submit", (event) => { event.preventDefault(); runTerminalCommand(); });
btnStopTerminal?.addEventListener("click", () => activeTerminalRequestId && window.piAgent.stopTerminalCommand(activeTerminalRequestId));
window.piAgent.onTerminalOutput?.(({ requestId, stream, data }) => {
  if (requestId === activeTerminalRequestId) appendTerminalOutput(data, stream);
});
$("#btn-workbench-help")?.addEventListener("click", () => workbenchHelpPopover?.classList.remove("hidden"));
$("#btn-close-workbench-help")?.addEventListener("click", () => workbenchHelpPopover?.classList.add("hidden"));
document.addEventListener("click", (event) => {
  if (!event.target.closest(".workbench-tab-wrap")) {
    setWorkbenchMenu(browserTabMenu, false);
    setWorkbenchMenu(terminalTypeMenu, false);
  }
});
$("#browser-address-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  navigateInternalBrowser(browserAddress?.value);
});
browserBack?.addEventListener("click", () => internalBrowser?.canGoBack?.() && internalBrowser.goBack());
browserForward?.addEventListener("click", () => internalBrowser?.canGoForward?.() && internalBrowser.goForward());
$("#btn-browser-reload")?.addEventListener("click", () => internalBrowser?.reload());
$("#btn-browser-inspect")?.addEventListener("click", () => performBrowserAutomation("inspect"));
$("#btn-browser-click")?.addEventListener("click", () => performBrowserAutomation("click"));
$("#btn-browser-type")?.addEventListener("click", () => performBrowserAutomation("type"));
$("#btn-browser-scroll")?.addEventListener("click", () => performBrowserAutomation("scroll"));
internalBrowser?.addEventListener("dom-ready", updateBrowserNavigation);
internalBrowser?.addEventListener("did-navigate", (event) => {
  if (browserAddress) browserAddress.value = event.url;
  const active = activeBrowserTab();
  if (active) { active.url = event.url; active.title = browserTabLabel(event.url, active.title); persistBrowserTabs(); renderBrowserTabMenu(); }
  updateBrowserNavigation();
});
internalBrowser?.addEventListener("did-navigate-in-page", (event) => {
  if (browserAddress) browserAddress.value = event.url;
  const active = activeBrowserTab();
  if (active) { active.url = event.url; active.title = browserTabLabel(event.url, active.title); persistBrowserTabs(); renderBrowserTabMenu(); }
  updateBrowserNavigation();
});
document.querySelectorAll("[data-browser-location]").forEach((button) => {
  button.addEventListener("click", () => {
    localStorage.setItem(BROWSER_OPEN_LOCATION_STORAGE_KEY, button.dataset.browserLocation);
    renderBrowserOpenLocation();
  });
});

btnChangeReview?.addEventListener("click", async () => {
  if (isChangeReviewOpen()) {
    setChangeReviewOpen(false);
    return;
  }
  setChangeReviewOpen(true);
  await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
  if (!isChangeReviewOpen()) return;
  await refreshChangeReview();
});
$("#btn-close-change-review")?.addEventListener("click", () => setChangeReviewOpen(false));

// 点击软件其他位置：按相同动效收回
document.addEventListener("click", (e) => {
  if (accountOpen && !accountWrap.contains(e.target)) closeAccountPopover();
  if (!projectBindingBtn.contains(e.target) && !projectBindingPopover.contains(e.target)) {
    closeProjectBindingPopover();
  }
  if (!projectContextMenu.contains(e.target)) closeProjectContextMenu();
  if (!taskContextMenu.contains(e.target)) closeTaskContextMenu();
});

// Esc 关闭
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (accountOpen) closeAccountPopover();
  closeConversationTool();
  closeArchive();
  closeProjectContextMenu();
  closeTaskContextMenu();
});

/* ---------------- 启动 ---------------- */
(async function init() {
  try {
    // 暴露给外部（E2E / 调试）
    window._pi = { openSettings, closeSettings, openModelPicker, closeModelPicker, renderProviderList, renderModelPicker, saveCurrentPlan, renderPlanList };

    initializeWorkbenchLayout();
    loadBrowserTabs();
    renderBrowserTabMenu();
    renderTerminalLocation();
    window.piAgent.onEvent(handleEvent);
    window.piAgent.onState(updateState);
    window.piAgent.onPlanUpdate?.(applyPlanUpdate);
    window.piAgent.onToolApprovalRequested(showToolApproval);
    window.piAgent.onError((msg) => {
      if (!isExpectedAbortMessage(msg)) addError(msg);
    });

    initializeUpdater();

    await loadTaskIndex();
    // A renderer can be restored with stale overlay classes after a prior
    // shutdown. Reset transient UI before any startup dialog is allowed to open.
    clearStartupInteractionBlockers();
    await recoverMissingTaskSessions();
    tasks.forEach((task) => { if (task.status === "running") task.status = "idle"; });
    const initialTask = currentTask() || tasks.find((task) => !task.archivedAt) || null;
    if (initialTask) activeTaskId = initialTask.id;

    // 1. 立即渲染 UI（不等待会话创建）
    renderTaskList();
    openTasksPanel();
    inputEl.focus();
    const placeholderText = document.querySelector("#chat-placeholder p");
    if (placeholderText) placeholderText.textContent = initialTask ? "正在恢复对话…" : "点击“新建任务”开始对话。";

    // 2. 异步恢复厂商配置 + 上传模型（不阻塞 UI）
    const configPromise = (async () => {
      await migrateLegacyPlaintextKeys();
      await refreshConfiguredProviders();
      await refreshCustomProviders();
      await refreshMermaidDiagramSettings();
      renderExecutionMode((await window.piAgent.getExecutionMode())?.mode);
      const savedModel = localStorage.getItem("pi_current_model");
      const savedThinkingLevel = localStorage.getItem(THINKING_LEVEL_STORAGE_KEY);
      const savedProviderId = savedModel?.split("/")[0];
      if (savedModel && !isProviderEnabled(savedProviderId)) {
        localStorage.removeItem("pi_current_model");
      } else if (savedModel) {
        currentModelRef = savedModel;
        document.querySelector("#current-model-name").textContent = savedModel;
      }
      if (savedThinkingLevel) await window.piAgent.setThinkingLevel(savedThinkingLevel);
    })();

    // 3. 创建会话 + 恢复历史（核心耗时操作）
    const sessionPromise = (async () => {
      await configPromise;
      const savedModel = localStorage.getItem("pi_current_model");
      if (savedModel) await window.piAgent.setModel(savedModel);

      if (!initialTask) {
        showEmptyTaskState();
        return;
      }
      activeTaskId = null;
      let opened = await switchTask(initialTask, true);
      if (!opened) {
        const fallback = tasks.find((task) => task.id !== initialTask.id && !task.archivedAt);
        if (fallback) opened = await switchTask(fallback, true);
      }
      if (!opened) {
        showEmptyTaskState();
        return;
      }

      const state = await window.piAgent.getState();
      updateState(state);
      if (!savedModel) updateModelBadge(state);
    })();

    // 4. 并行初始化集成导入
    const importPromise = initializeIntegrationImport().catch((error) => console.warn("Unable to initialize integration import:", error));

    await Promise.all([sessionPromise, importPromise]);
    focusComposerWhenAvailable();
  } catch (e) {
    document.querySelector("#chat-placeholder p").textContent = `启动失败：${e.message}`;
    console.error("init error", e);
  }
})();

/* ---------------- 厂商目录（基于 pi-ai 内置 Provider） ---------------- */
const PROVIDER_CATALOG = [
  { id:"openai",               name:"OpenAI",         icon:"assets/provider-icons/openai.svg", desc:"GPT-5 / GPT-5.6 系列 / o4-mini",   envKey:"OPENAI_API_KEY",          models:["gpt-5.6-terra","gpt-5.6-luna","gpt-5.6-sol","gpt-5.5","gpt-5.4","gpt-5.4-mini","gpt-5.4-nano","gpt-5.2","gpt-5.1-codex","gpt-5","gpt-4o","gpt-4.1","gpt-4.1-mini","o4-mini","o3","o3-mini","o1"] },
  { id:"openai-codex",         name:"OpenAI Codex",   icon:"assets/provider-icons/openai-codex.svg", desc:"ChatGPT 订阅（OAuth）",             envKey:null,                      models:["gpt-5.6-terra","gpt-5.6-luna","gpt-5.6-sol","gpt-5.5","gpt-5.4","gpt-5.4-mini","gpt-5.3-codex-spark"] },
  { id:"anthropic",            name:"Anthropic",      icon:"assets/provider-icons/anthropic.svg", desc:"Claude Opus/Sonnet/Haiku 系列",      envKey:"ANTHROPIC_API_KEY",       models:["claude-sonnet-5","claude-sonnet-4-6","claude-sonnet-4-5","claude-opus-4-8","claude-opus-4-7","claude-opus-4-6","claude-opus-4-5","claude-haiku-4-5","claude-fable-5"] },
  { id:"google",               name:"Google",         icon:"assets/provider-icons/google.svg", desc:"Gemini 系列",                        envKey:"GEMINI_API_KEY",          models:["gemini-3.6-flash","gemini-3.5-flash","gemini-3.1-pro-preview","gemini-2.5-pro","gemini-2.5-flash","gemini-2.0-flash-lite"] },
  { id:"deepseek",             name:"DeepSeek",       icon:"assets/provider-icons/deepseek.svg", desc:"V4 Pro / Flash / V3 / R1",           envKey:"DEEPSEEK_API_KEY",        models:["deepseek-v4-pro","deepseek-v4-flash"] },
  { id:"moonshotai-cn",        name:"Moonshot AI",    icon:"assets/provider-icons/kimi.svg", desc:"月之暗面 Kimi（中国站）",            envKey:"MOONSHOT_API_KEY",        models:["kimi-k3","kimi-k2.7-code","kimi-k2.7-code-highspeed","kimi-k2.6","kimi-k2.5","kimi-k2-thinking","kimi-k2-turbo-preview"] },
  { id:"kimi-coding",          name:"Kimi Coding",    icon:"assets/provider-icons/kimi.svg", desc:"Moonshot 订阅端点",                  envKey:"KIMI_API_KEY",            models:["kimi-for-coding","kimi-for-coding-highspeed","k3"] },
  { id:"minimax-cn",           name:"MiniMax（中国）", icon:"assets/provider-icons/minimax.svg", desc:"MiniMax M 系列（中国站）",           envKey:"MINIMAX_API_KEY",         models:["MiniMax-M3","MiniMax-M2.7","MiniMax-M2.7-highspeed"] },
  { id:"minimax",              name:"MiniMax",        icon:"assets/provider-icons/minimax.svg", desc:"MiniMax 国际站",                     envKey:"MINIMAX_GLOBAL_API_KEY",  models:["MiniMax-M3","MiniMax-M2.7","MiniMax-M2.7-highspeed"] },
  { id:"mistral",              name:"Mistral",        icon:"assets/provider-icons/mistral.svg", desc:"Large / Medium / Small / Codestral",  envKey:"MISTRAL_API_KEY",         models:["mistral-large-latest","mistral-medium-latest","mistral-small-latest","codestral-latest","pixtral-large-latest"] },
  { id:"groq",                 name:"Groq",           icon:"assets/provider-icons/groq.svg", desc:"超低延迟推理（Llama/DeepSeek/Qwen）", envKey:"GROQ_API_KEY",            models:["meta-llama/llama-4-scout-17b-16e-instruct","qwen/qwen3-32b","openai/gpt-oss-120b","openai/gpt-oss-20b","llama-3.3-70b-versatile"] },
  { id:"cerebras",             name:"Cerebras",       icon:"assets/provider-icons/cerebras.svg", desc:"极速推理（Gemma4/GLM/GPT-OSS）",    envKey:"CEREBRAS_API_KEY",        models:["gemma-4-31b","gpt-oss-120b","zai-glm-4.7"] },
  { id:"xai",                  name:"xAI",            icon:"assets/provider-icons/xai.svg", desc:"Grok 系列",                          envKey:"XAI_API_KEY",             models:["grok-4.5","grok-4.3","grok-build-0.1"] },
  { id:"openrouter",           name:"OpenRouter",     icon:"assets/provider-icons/openrouter.svg", desc:"多模型路由（200+ 模型）",            envKey:"OPENROUTER_API_KEY",      models:["openai/gpt-5.6-luna","anthropic/claude-sonnet-5","deepseek/deepseek-v4-pro","google/gemini-2.5-pro","x-ai/grok-4.5","openrouter/auto"] },
  { id:"together",             name:"Together AI",    icon:"assets/provider-icons/together.svg", desc:"ML 模型托管平台",                   envKey:"TOGETHER_API_KEY",        models:["deepseek-ai/DeepSeek-V4-Pro","moonshotai/Kimi-K2.7-Code","Qwen/Qwen3.7-Max","nvidia/nemotron-3-ultra-550b-a55b","zai-org/GLM-5.2"] },
  { id:"nvidia",               name:"NVIDIA NIM",     icon:"assets/provider-icons/nvidia.svg", desc:"NVIDIA 推断微服务",                  envKey:"NVIDIA_API_KEY",          models:["nvidia/nemotron-3-super-120b-a12b","nvidia/nemotron-3-ultra-550b-a55b","moonshotai/kimi-k2.6","z-ai/glm-5.2","minimaxai/minimax-m3"] },
  { id:"fireworks",            name:"Fireworks",      icon:"assets/provider-icons/fireworks.svg", desc:"多模型快速推理平台",                envKey:"FIREWORKS_API_KEY",       models:["accounts/fireworks/models/deepseek-v4-pro","accounts/fireworks/models/kimi-k2p7-code","accounts/fireworks/models/minimax-m3","accounts/fireworks/models/qwen3p7-plus","accounts/fireworks/models/glm-5p2"] },
  { id:"huggingface",          name:"HuggingFace",    icon:"assets/provider-icons/huggingface.svg", desc:"Hugging Face 推断端点",             envKey:"HUGGINGFACE_API_KEY",     models:["moonshotai/Kimi-K2.7-Code","deepseek-ai/DeepSeek-V4-Pro","zai-org/GLM-5.2","Qwen/Qwen3-Coder-Next","openai/gpt-oss-120b","MiniMaxAI/MiniMax-M3"] },
  { id:"azure-openai-responses",name:"Azure OpenAI",  icon:"assets/provider-icons/azure.svg", desc:"微软 Azure 托管",                    envKey:"AZURE_OPENAI_API_KEY",    models:["gpt-5.6-terra","gpt-5.6-luna","gpt-5.5","gpt-5.4","gpt-5.2-codex","gpt-5.1-codex","gpt-5-codex","gpt-4o","o4-mini"] },
  { id:"amazon-bedrock",       name:"Amazon Bedrock", icon:"assets/provider-icons/bedrock.svg", desc:"AWS 托管（Nova/Claude/Llama）",      envKey:null,                      models:["anthropic.claude-sonnet-5","anthropic.claude-opus-4-8","amazon.nova-pro-v1:0","meta.llama4-maverick-17b-instruct-v1:0","deepseek.v3.2"] },
  { id:"cloudflare-ai-gateway",name:"Cloudflare Gateway",icon:"assets/provider-icons/cloudflare.svg",desc:"Cloudflare AI 网关",               envKey:"CLOUDFLARE_API_KEY",      models:["gpt-5.6-terra","claude-sonnet-5","gpt-5.5","gemini-2.5-pro","o4-mini"] },
  { id:"github-copilot",       name:"GitHub Copilot", icon:"assets/provider-icons/github-copilot.svg", desc:"Copilot 订阅（OAuth）",              envKey:null,                      models:["claude-sonnet-5","claude-opus-4.8","gpt-5.6-terra","gemini-3.5-flash","gpt-5.2-codex","kimi-k2.7-code"] },
  { id:"qwen-token-plan-cn",   name:"通义千问（中国）", icon:"assets/provider-icons/qwen.svg", desc:"百炼平台（Token Plan）",           envKey:null,                      models:["qwen3.7-max","qwen3.7-plus","qwen3.6-plus","deepseek-v4-pro","kimi-k2.7-code","minimax-m3","glm-5.2"] },
  { id:"zai-coding-cn",        name:"智谱（中国）",    icon:"assets/provider-icons/zhipu.svg", desc:"GLM 系列（Token Plan）",            envKey:null,                      models:["glm-5.2","glm-5.1","glm-5-turbo","glm-4.7","glm-4.5-air","glm-5v-turbo"] },
  { id:"vercel-ai-gateway",    name:"Vercel AI Gateway",icon:"assets/provider-icons/vercel.svg",desc:"Vercel 边缘推理",                    envKey:"VERCEL_AI_GATEWAY_KEY",   models:["openai/gpt-5.6-terra","anthropic/claude-sonnet-5","deepseek/deepseek-v4-pro","alibaba/qwen3.7-max","google/gemini-2.5-pro","xai/grok-4.5"] },
  { id:"opencode-go",          name:"OpenCode Go",    icon:"assets/provider-icons/opencode.svg", desc:"OpenCode 内置代理",                  envKey:"OPENCODE_API_KEY",        models:["deepseek-v4-pro","deepseek-v4-flash","kimi-k2.7-code","kimi-k3","glm-5.2","grok-4.5","qwen3.7-max","minimax-m3","mimo-v2.5-pro"] },
  { id:"opencode",             name:"OpenCode",       icon:"assets/provider-icons/opencode.svg", desc:"OpenCode 代理（Claude/GPT/GLM…）",    envKey:"OPENCODE_API_KEY",        models:["deepseek-v4-pro","claude-sonnet-5","gpt-5.6-terra","gemini-3.5-flash","glm-5.2","kimi-k2.7-code","qwen3.7-max","minimax-m3"] },
  { id:"xiaomi",               name:"小米 MiMo",      icon:"assets/provider-icons/xiaomi-mimo.svg", desc:"MiMo 多模态模型",                    envKey:"XIAOMI_API_KEY",          models:["mimo-v2.5-pro","mimo-v2.5","mimo-v2-pro","mimo-v2-flash","mimo-v2-omni","mimo-v2.5-pro-ultraspeed"] },
];
let customProviderCatalog = [];
let modelMultimodalCapabilities = {};
let activeModelMultimodalPopover = null;
const CUSTOM_PROVIDER_API_LABELS = {
  "openai-completions": "OpenAI Chat Completions",
  "openai-responses": "OpenAI Responses",
  "anthropic-messages": "Anthropic Messages",
  "google-generative-ai": "Google Generative AI",
};
function allProviderCatalog() { return [...PROVIDER_CATALOG, ...customProviderCatalog]; }

// 当前选择的模型（provider/model 格式，如 "openai/gpt-4o"）
let currentModelRef = null;

function updateModelBadge(state) {
  // 会话已带模型则显示会话模型；否则保留用户选择的 ref
  const name = state?.model ?? (currentModelRef || "—");
  document.querySelector("#current-model-name").textContent =
    typeof name === "object" ? (name.id || name.name || "—") : String(name);
}

/* ---------------- API Key 状态 ----------------
   明文密钥只存主进程 auth.json；渲染进程仅缓存：
   - draftKeys：输入框预填用（localStorage，方便回填，非安全存储）
   - configuredProviders：来自主进程的"已配置厂商 id"列表（过滤/状态徽章的真相来源）
*/
let configuredProviders = [];
const MODEL_PROVIDER_ENABLED_STORAGE_KEY = "pi_model_provider_enabled";
let modelProviderEnablement = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(MODEL_PROVIDER_ENABLED_STORAGE_KEY) || "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
})();
function isProviderEnabled(providerId) {
  return modelProviderEnablement[providerId] !== false;
}
function setProviderEnabled(providerId, enabled) {
  modelProviderEnablement[providerId] = Boolean(enabled);
  localStorage.setItem(MODEL_PROVIDER_ENABLED_STORAGE_KEY, JSON.stringify(modelProviderEnablement));
}
function removeProviderEnabledSetting(providerId) {
  delete modelProviderEnablement[providerId];
  localStorage.setItem(MODEL_PROVIDER_ENABLED_STORAGE_KEY, JSON.stringify(modelProviderEnablement));
}
async function refreshConfiguredProviders() {
  try { configuredProviders = await window.piAgent.listConfiguredProviders(); }
  catch { configuredProviders = []; }
  return configuredProviders;
}
async function refreshModelMultimodalCapabilities() {
  try { modelMultimodalCapabilities = await window.piAgent.getModelMultimodalCapabilities(); }
  catch { modelMultimodalCapabilities = {}; }
  return modelMultimodalCapabilities;
}
function isModelMultimodal(providerId, modelId) {
  const capability = modelMultimodalCapabilities[`${providerId}/${modelId}`];
  return capability === true || capability?.enabled === true;
}
function isModelMultimodalSupported(provider, modelId) {
  if (provider?.custom) return true;
  return modelMultimodalCapabilities[`${provider?.id}/${modelId}`]?.supported === true;
}
function getProviderMultimodalModels(provider) {
  return provider.models.filter((modelId) => isModelMultimodalSupported(provider, modelId));
}
function areAllProviderModelsMultimodal(provider) {
  const models = getProviderMultimodalModels(provider);
  return models.length > 0 && models.every((modelId) => isModelMultimodal(provider.id, modelId));
}
function closeModelMultimodalPopover() {
  activeModelMultimodalPopover?.remove();
  activeModelMultimodalPopover = null;
}
async function recreateSessionForModelCapability(providerId) {
  if (!sessionReady || isStreaming || !currentModelRef?.startsWith(`${providerId}/`)) return;
  try { await recreateActiveTaskSession(); }
  catch (error) { addError(`应用模型能力设置失败：${error?.message ?? error}`); }
}
document.addEventListener("click", (event) => {
  if (!event.target.closest(".model-multimodal-popover, [data-action='open-model-multimodal']")) {
    closeModelMultimodalPopover();
  }
});
async function refreshCustomProviders() {
  try {
    const providers = await window.piAgent.listCustomProviders();
    customProviderCatalog = providers.map((provider) => ({
      ...provider,
      icon: "assets/provider-icons/openai.svg",
      desc: `${CUSTOM_PROVIDER_API_LABELS[provider.api] || provider.api} · ${provider.baseUrl}`,
      models: provider.models.map((model) => model.id),
      custom: true,
    }));
  } catch (error) {
    customProviderCatalog = [];
    console.warn("Unable to load custom providers:", error);
  }
  return customProviderCatalog;
}
function isProviderConfigured(id) {
  // 凭证只由主进程安全存储管理，渲染进程不保留明文副本。
  return configuredProviders.includes(id) ||
    customProviderCatalog.some((provider) => provider.id === id);
}

async function migrateLegacyPlaintextKeys() {
  const storageKey = "pi_api_keys";
  let legacyKeys = {};
  try { legacyKeys = JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch { return; }
  const entries = Object.entries(legacyKeys).filter(([, key]) => typeof key === "string" && key.trim());
  if (!entries.length) {
    localStorage.removeItem(storageKey);
    return;
  }
  try {
    await Promise.all(entries.map(([providerId, apiKey]) => window.piAgent.saveApiKey(providerId, apiKey)));
    localStorage.removeItem(storageKey);
    await refreshConfiguredProviders();
  } catch (error) {
    console.warn("Legacy API key migration was not completed; keeping the local copy for recovery.", error);
  }
}

/* ---------------- 设置面板 ---------------- */
const settingsOverlay = $("#settings-overlay");
const btnCloseSettings = $("#btn-close-settings");
const menuSettingsOverlay = $("#menu-settings-overlay");
const btnCloseMenuSettings = $("#btn-close-menu-settings");
const mermaidDiagramToggle = $("#toggle-mermaid-diagram");

function openSettings(tab = "models") {
  settingsOverlay.classList.remove("hidden");
  settingsOverlay.setAttribute("aria-hidden", "false");
  switchSetTab(tab);
  if (tab === "models") renderProviderList();
  if (tab === "general") { refreshDisplayZoom(); refreshAppVersion(); }
  if (tab === "web-search") renderWebSearchSettings();
  if (tab === "local-models") renderLocalModelSettings();
  if (tab === "mcp" || tab === "skills") renderIntegrationSettings();
}
function closeSettings() {
  settingsOverlay.classList.add("hidden");
  settingsOverlay.setAttribute("aria-hidden", "true");
}

function openMenuSettings() {
  closeSettings();
  menuSettingsOverlay?.classList.remove("hidden");
  menuSettingsOverlay?.setAttribute("aria-hidden", "false");
  refreshMermaidDiagramSettings();
  renderBrowserOpenLocation();
}

function closeMenuSettings() {
  menuSettingsOverlay?.classList.add("hidden");
  menuSettingsOverlay?.setAttribute("aria-hidden", "true");
}

function renderMermaidDiagramToggle() {
  if (!mermaidDiagramToggle) return;
  mermaidDiagramToggle.classList.toggle("is-enabled", mermaidDiagramEnabled);
  mermaidDiagramToggle.setAttribute("aria-checked", String(mermaidDiagramEnabled));
  mermaidDiagramToggle.title = mermaidDiagramEnabled ? "关闭 Mermaid 图表绘制" : "启用 Mermaid 图表绘制";
}

async function refreshMermaidDiagramSettings() {
  try {
    const settings = await window.piAgent.getMermaidDiagramSettings();
    mermaidDiagramEnabled = settings?.enabled !== false;
    renderMermaidDiagramToggle();
  } catch (error) {
    addError(`读取 Mermaid 设置失败：${error?.message ?? error}`);
  }
}

mermaidDiagramToggle?.addEventListener("click", async () => {
  const nextEnabled = !mermaidDiagramEnabled;
  mermaidDiagramToggle.disabled = true;
  try {
    const settings = await window.piAgent.setMermaidDiagramEnabled(nextEnabled);
    mermaidDiagramEnabled = settings?.enabled !== false;
    renderMermaidDiagramToggle();
    if (isStreaming) mermaidSettingsNeedSessionRefresh = true;
    else if (sessionReady) await recreateActiveTaskSession();
  } catch (error) {
    addError(`更新 Mermaid 设置失败：${error?.message ?? error}`);
  } finally {
    mermaidDiagramToggle.disabled = false;
  }
});

// "设置"按钮 → 打开设置面板（在账户弹窗内）
document.querySelectorAll("[data-action='open-settings']").forEach((el) => {
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    closeAccountPopover();
    openSettings("models");
  });
});

btnCloseSettings.addEventListener("click", closeSettings);
settingsOverlay.querySelector(".settings-backdrop").addEventListener("click", closeSettings);
btnCloseMenuSettings?.addEventListener("click", closeMenuSettings);
menuSettingsOverlay?.querySelector(".menu-settings-backdrop")?.addEventListener("click", closeMenuSettings);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && conversationMenuPopover?.classList.contains("open")) {
    setConversationMenuOpen(false);
    btnConversationMenu?.focus();
    return;
  }
  if (e.key === "Escape" && !menuSettingsOverlay?.classList.contains("hidden")) {
    closeMenuSettings();
    return;
  }
  if (e.key === "Escape" && !settingsOverlay.classList.contains("hidden")) closeSettings();
});

// Tab 切换
document.querySelectorAll(".set-tab").forEach((tab) => {
  tab.addEventListener("click", () => switchSetTab(tab.dataset.tab));
});
function switchSetTab(tabId) {
  document.querySelectorAll(".set-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tabId));
  document.querySelectorAll(".set-pane").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== tabId));
  document.querySelector("#set-title").textContent =
    tabId === "models" ? "模型设置" : tabId === "general" ? "通用设置" : tabId === "web-search" ? "联网搜索" : tabId === "local-models" ? "本地模型" : tabId === "mcp" ? "MCP 管理" : "Skill 管理";
  if (tabId === "models") renderProviderList();
  if (tabId === "general") { refreshDisplayZoom(); refreshAppVersion(); }
  if (tabId === "web-search") renderWebSearchSettings();
  if (tabId === "local-models") renderLocalModelSettings();
  if (tabId === "mcp" || tabId === "skills") renderIntegrationSettings();
}

async function renderLocalModelSettings() {
  const list = $("#local-model-list");
  if (!list) return;
  list.innerHTML = `<div class="integration-empty">正在检测 Ollama、LM Studio 和 llama.cpp…</div>`;
  try {
    const runtimes = await window.piAgent.detectLocalModels();
    list.innerHTML = runtimes.map((runtime) => {
      const models = runtime.models?.length ? `${runtime.models.length} 个模型：${runtime.models.join("、")}` : runtime.detail || "未检测到模型";
      return `<article class="local-model-card ${runtime.available ? "online" : "offline"}">
        <span class="local-model-indicator" aria-hidden="true"></span>
        <div class="local-model-info"><div class="local-model-name">${escapeHtml(runtime.name)}</div><div class="local-model-meta">${escapeHtml(runtime.endpoint)} · ${escapeHtml(models)}</div></div>
        <button class="local-model-connect" type="button" data-local-runtime="${escapeHtml(runtime.id)}" ${runtime.available ? "" : "disabled"}>${runtime.available ? "接入" : "未启动"}</button>
      </article>`;
    }).join("");
    list.querySelectorAll("[data-local-runtime]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        const original = button.textContent;
        button.textContent = "接入中";
        try {
          await window.piAgent.connectLocalModelRuntime(button.dataset.localRuntime);
          await refreshCustomProviders();
          await refreshConfiguredProviders();
          button.textContent = "已接入";
        } catch (error) {
          button.disabled = false;
          button.textContent = original;
          addError(`接入本地模型失败：${error?.message ?? error}`);
        }
      });
    });
  } catch (error) {
    list.innerHTML = `<div class="integration-empty">检测失败：${escapeHtml(error?.message ?? error)}</div>`;
  }
}

$("#btn-refresh-local-models")?.addEventListener("click", renderLocalModelSettings);

async function renderWebSearchSettings() {
  const status = document.querySelector("#web-search-status");
  const clearButton = document.querySelector("#btn-clear-tavily-key");
  if (!status || !clearButton) return;

  status.textContent = "正在检查";
  status.className = "web-search-status";
  try {
    const settings = await window.piAgent.getTavilySearchSettings();
    const hasApiKey = Boolean(settings?.hasApiKey);
    status.textContent = hasApiKey ? "正在使用个人 API Key" : "Keyless 免费模式";
    status.classList.add(hasApiKey ? "configured" : "keyless");
    clearButton.hidden = !hasApiKey;
  } catch (error) {
    status.textContent = "状态不可用";
    status.classList.add("error");
    addError(`读取联网搜索设置失败：${error?.message ?? error}`);
  }
}

async function saveTavilyApiKey() {
  const input = document.querySelector("#tavily-api-key");
  const button = document.querySelector("#btn-save-tavily-key");
  if (!input || !button) return;

  button.disabled = true;
  try {
    await window.piAgent.saveTavilyApiKey(input.value);
    input.value = "";
    await renderWebSearchSettings();
    button.textContent = "已保存";
    setTimeout(() => { button.textContent = "保存"; }, 1500);
  } catch (error) {
    addError(`保存 Tavily API Key 失败：${error?.message ?? error}`);
  } finally {
    button.disabled = false;
  }
}

document.querySelector("#btn-save-tavily-key")?.addEventListener("click", saveTavilyApiKey);
document.querySelector("#tavily-api-key")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveTavilyApiKey();
});
document.querySelector("#btn-clear-tavily-key")?.addEventListener("click", async () => {
  try {
    await window.piAgent.saveTavilyApiKey("");
    await renderWebSearchSettings();
  } catch (error) {
    addError(`清除 Tavily API Key 失败：${error?.message ?? error}`);
  }
});
document.querySelector("#btn-open-tavily-dashboard")?.addEventListener("click", async () => {
  try {
    await window.piAgent.openTavilyDashboard();
  } catch (error) {
    addError(`无法打开 Tavily 网站：${error?.message ?? error}`);
  }
});

let integrationState = { skills: [], mcpServers: [] };
let integrationsNeedSessionRefresh = false;
let mcpHealthState = new Map();
let mcpHealthRefreshing = false;

function escapeIntegrationText(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function renderIntegrationSettings() {
  try {
    integrationState = await window.piAgent.listIntegrations();
  } catch (error) {
    addError(`读取 Skill / MCP 配置失败：${error?.message ?? error}`);
    return;
  }
  renderIntegrationList("mcp", document.querySelector("#mcp-settings-list"), integrationState.mcpServers);
  renderIntegrationList("skill", document.querySelector("#skill-settings-list"), integrationState.skills);
  renderComposerMcpMenu();
  renderComposerSkillMenu();
}

function renderIntegrationList(kind, container, entries) {
  if (!container) return;
  if (!entries.length) {
    container.innerHTML = `<div class="integration-empty">暂无已导入的${kind === "mcp" ? " MCP 服务器" : " Skill"}</div>`;
    return;
  }
  container.innerHTML = entries.map((entry) => {
    const details = kind === "mcp" ? `${entry.source} · ${entry.type === "remote" ? "远程服务器" : "本地服务器"}` : `${entry.source}${entry.description ? ` · ${entry.description}` : ""}`;
    return `<div class="integration-card">
      <div class="integration-card-main"><div class="integration-card-name">${escapeIntegrationText(entry.name)}</div><div class="integration-card-meta">${escapeIntegrationText(details)}</div></div>
      <button class="integration-toggle" type="button" role="switch" aria-checked="${entry.enabled !== false}" data-integration-kind="${kind}" data-integration-id="${entry.id}" title="${entry.enabled !== false ? "关闭" : "启用"}"></button>
    </div>`;
  }).join("");
  container.querySelectorAll("[data-integration-id]").forEach((button) => {
    button.addEventListener("click", () => setIntegrationEnabled(button.dataset.integrationKind, button.dataset.integrationId, button.getAttribute("aria-checked") !== "true"));
  });
}

function renderComposerMcpMenu() {
  const list = document.querySelector("#mcp-menu-list");
  if (!list) return;
  const entries = integrationState.mcpServers || [];
  const refreshButton = document.querySelector("#btn-refresh-mcp-health");
  if (refreshButton) refreshButton.disabled = mcpHealthRefreshing;
  if (!entries.length) {
    list.innerHTML = `<div class="composer-menu-empty">暂无已导入的 MCP 服务器</div>`;
    return;
  }
  list.innerHTML = entries.map((entry) => {
    const health = mcpHealthState.get(entry.id) || { status: entry.enabled === false ? "disabled" : "unknown" };
    const description = mcpHealthDescription(health);
    return `<div class="composer-menu-row mcp-menu-row">
      <span class="mcp-health-dot ${escapeIntegrationText(health.status)}" title="${escapeIntegrationText(description)}"></span>
      <div class="mcp-menu-info"><span class="composer-menu-name" data-composer-add="mcp" data-composer-add-id="${entry.id}" data-composer-add-name="${escapeIntegrationText(entry.name)}" title="${escapeIntegrationText(entry.name)}">${escapeIntegrationText(entry.name)}</span><span class="mcp-health-text" title="${escapeIntegrationText(description)}">${escapeIntegrationText(description)}</span></div>
      <button class="integration-toggle" type="button" role="switch" aria-checked="${entry.enabled !== false}" data-composer-menu-kind="mcp" data-composer-menu-id="${entry.id}" title="${entry.enabled !== false ? "关闭" : "启用"}"></button>
    </div>`;
  }).join("");
  bindComposerMenuActions(list);
}
function renderComposerSkillMenu() {
  renderComposerMenu("skill", "#skill-menu-list", "Skill", integrationState.skills || []);
}

function mcpHealthDescription(health) {
  if (health.status === "healthy") return `正常 · ${health.toolCount} 个工具 · ${health.latencyMs} ms`;
  if (health.status === "checking") return "正在检测…";
  if (health.status === "disabled") return "已停用";
  if (health.status === "error") return `不可用 · ${health.message || "连接失败"}`;
  return "尚未检测";
}

async function refreshMcpHealth() {
  const entries = integrationState.mcpServers || [];
  if (!entries.length || mcpHealthRefreshing) return;
  mcpHealthRefreshing = true;
  entries.forEach((entry) => {
    mcpHealthState.set(entry.id, { status: entry.enabled === false ? "disabled" : "checking" });
  });
  renderComposerMcpMenu();
  try {
    const healthEntries = await window.piAgent.getMcpHealth();
    mcpHealthState = new Map(healthEntries.map((entry) => [entry.id, entry]));
  } catch (error) {
    entries.forEach((entry) => {
      if (entry.enabled !== false) mcpHealthState.set(entry.id, { status: "error", message: String(error?.message ?? error) });
    });
  } finally {
    mcpHealthRefreshing = false;
    renderComposerMcpMenu();
  }
}

function bindComposerMenuActions(list) {
  list.querySelectorAll("[data-composer-menu-id]").forEach((button) => {
    button.addEventListener("click", () => setIntegrationEnabled(button.dataset.composerMenuKind, button.dataset.composerMenuId, button.getAttribute("aria-checked") !== "true"));
  });
  list.querySelectorAll("[data-composer-add]").forEach((name) => {
    name.addEventListener("click", () => {
      const tag = { kind: name.dataset.composerAdd, id: name.dataset.composerAddId, name: name.dataset.composerAddName };
      if (!selectedTags.some((item) => item.id === tag.id)) {
        selectedTags.push(tag);
        renderTagBar();
      }
      closeAllComposerPopovers();
    });
  });
}

function renderComposerMenu(kind, listSelector, title, entries) {
  const list = document.querySelector(listSelector);
  if (!list) return;
  if (!entries.length) {
    list.innerHTML = `<div class="composer-menu-empty">暂无已导入的 ${title}</div>`;
    return;
  }
  list.innerHTML = entries.map((entry) =>
    `<div class="composer-menu-row">
      <span class="composer-menu-name" data-composer-add="${kind}" data-composer-add-id="${entry.id}" data-composer-add-name="${escapeIntegrationText(entry.name)}" title="${escapeIntegrationText(entry.name)}">${escapeIntegrationText(entry.name)}</span>
      <button class="integration-toggle" type="button" role="switch" aria-checked="${entry.enabled !== false}" data-composer-menu-kind="${kind}" data-composer-menu-id="${entry.id}" title="${entry.enabled !== false ? "关闭" : "启用"}"></button>
    </div>`).join("");
  bindComposerMenuActions(list);
}
function closeAllComposerPopovers() {
  document.querySelectorAll(".composer-menu-popover").forEach((p) => { p.classList.remove("open"); p.setAttribute("aria-hidden", "true"); });
}

async function setIntegrationEnabled(kind, id, enabled) {
  try {
    integrationState = await window.piAgent.setIntegrationEnabled(kind, id, enabled);
    invalidateIntegrationCandidateCache();
    await renderIntegrationSettings();
    if (isStreaming) {
      integrationsNeedSessionRefresh = true;
    } else if (sessionReady) {
      await recreateActiveTaskSession();
    }
  } catch (error) {
    addError(`更新集成状态失败：${error?.message ?? error}`);
  }
}

function renderIntegrationImportDialog(preview, { rescan = false } = {}) {
  const overlay = document.querySelector("#integration-import-overlay");
  const summary = document.querySelector("#integration-import-summary");
  const details = document.querySelector("#integration-import-details");
  if (!overlay || !summary || !details) return;
  const agents = new Map();
  for (const entry of preview.mcpServers || []) {
    const group = agents.get(entry.source) || { source: entry.source, skills: 0, mcpServers: 0 };
    group.mcpServers += 1;
    agents.set(entry.source, group);
  }
  for (const entry of preview.skills || []) {
    const group = agents.get(entry.source) || { source: entry.source, skills: 0, mcpServers: 0 };
    group.skills += 1;
    agents.set(entry.source, group);
  }
  details.innerHTML = [...agents.values()].map((agent) => `
    <label class="integration-import-agent">
      <input class="integration-import-agent-checkbox" type="checkbox" data-integration-source="${escapeIntegrationText(agent.source)}" checked>
      <span class="integration-import-agent-name">${escapeIntegrationText(agent.source)}</span>
      <span class="integration-import-agent-count">${agent.mcpServers} MCP · ${agent.skills} Skill</span>
    </label>`).join("");

  const updateSelectionSummary = () => {
    const selected = selectedIntegrationSources();
    const button = document.querySelector("#btn-confirm-integration-import");
    if (button) button.disabled = selected.length === 0;
    summary.textContent = selected.length
      ? `${rescan ? "重新扫描" : "检测到"} ${preview.skills.length} 个 Skill 和 ${preview.mcpServers.length} 个 MCP 服务器。已选择 ${selected.length} 个 Agent，导入后默认启用。`
      : "请选择至少一个 Agent 后导入。";
  };
  details.querySelectorAll("[data-integration-source]").forEach((checkbox) => checkbox.addEventListener("change", updateSelectionSummary));
  updateSelectionSummary();
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
}

function selectedIntegrationSources() {
  return [...document.querySelectorAll("[data-integration-source]:checked")].map((checkbox) => checkbox.dataset.integrationSource);
}

function closeIntegrationImportDialog() {
  const overlay = document.querySelector("#integration-import-overlay");
  overlay?.classList.add("hidden");
  overlay?.setAttribute("aria-hidden", "true");
  focusComposerWhenAvailable();
}

async function initializeIntegrationImport() {
  const overlay = document.querySelector("#integration-import-overlay");
  if (!overlay) return;
  try {
    const preview = await window.piAgent.getIntegrationImportPreview();
    if (!preview?.shouldPrompt) return;
    renderIntegrationImportDialog(preview);
  } catch (error) {
    console.warn("Unable to inspect existing integrations:", error);
  }
}

document.querySelector("#btn-confirm-integration-import")?.addEventListener("click", async () => {
  const button = document.querySelector("#btn-confirm-integration-import");
  button.disabled = true;
  try {
    integrationState = await window.piAgent.importIntegrationCandidates(selectedIntegrationSources());
    invalidateIntegrationCandidateCache();
    closeIntegrationImportDialog();
    await renderIntegrationSettings();
    if (sessionReady && !isStreaming) await recreateActiveTaskSession();
  } catch (error) {
    addError(`导入 Skill / MCP 失败：${error?.message ?? error}`);
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#btn-dismiss-integration-import")?.addEventListener("click", async () => {
  await window.piAgent.dismissIntegrationImport();
  closeIntegrationImportDialog();
});
document.querySelector("#btn-rescan-integrations")?.addEventListener("click", async () => {
  const preview = await window.piAgent.getIntegrationImportPreview(true);
  if (!preview?.shouldPrompt) return;
  renderIntegrationImportDialog(preview, { rescan: true });
});
document.querySelector("#btn-mcp-menu")?.addEventListener("click", async (event) => {
  event.stopPropagation();
  const popover = document.querySelector("#mcp-menu-popover");
  const isOpening = !popover.classList.contains("open");
  closeAllComposerPopovers();
  if (!isOpening) return;
  await renderIntegrationSettings();
  popover.classList.add("open");
  popover.setAttribute("aria-hidden", "false");
  refreshMcpHealth();
});
document.querySelector("#btn-refresh-mcp-health")?.addEventListener("click", (event) => {
  event.stopPropagation();
  refreshMcpHealth();
});
document.querySelector("#btn-skill-menu")?.addEventListener("click", async (event) => {
  event.stopPropagation();
  const popover = document.querySelector("#skill-menu-popover");
  const isOpening = !popover.classList.contains("open");
  closeAllComposerPopovers();
  if (!isOpening) return;
  await renderIntegrationSettings();
  popover.classList.add("open");
  popover.setAttribute("aria-hidden", "false");
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".composer-menu-wrap")) closeAllComposerPopovers();
});

/* ---------------- 模型设置：厂商列表渲染 ---------------- */
function captureProviderListView() {
  const container = document.querySelector("#provider-list");
  const pane = document.querySelector('.set-pane[data-pane="models"]');
  return {
    expandedProviderIds: [...(container?.querySelectorAll(".provider-card.expanded") || [])]
      .map((card) => card.dataset.provider)
      .filter(Boolean),
    scrollTop: pane?.scrollTop || 0,
  };
}

function restoreProviderListView(viewState) {
  if (!viewState) return;
  const container = document.querySelector("#provider-list");
  const pane = document.querySelector('.set-pane[data-pane="models"]');
  for (const providerId of viewState.expandedProviderIds || []) {
    container?.querySelector(`.provider-card[data-provider="${providerId}"]`)?.classList.add("expanded");
  }
  if (pane) pane.scrollTop = viewState.scrollTop || 0;
}

async function refreshProviderConfigurationUi(providerId, feedback) {
  const viewState = captureProviderListView();
  if (!viewState.expandedProviderIds.includes(providerId)) viewState.expandedProviderIds.push(providerId);
  await renderProviderList({ viewState });
  renderModelPicker();

  const status = document.querySelector(`.provider-card[data-provider="${providerId}"] .provider-status`);
  if (!status) return;
  status.textContent = feedback;
  status.className = `provider-status ${isProviderConfigured(providerId) ? "configured" : "unconfigured"}`;
  window.setTimeout(() => {
    if (!status.isConnected) return;
    const configured = isProviderConfigured(providerId);
    status.textContent = configured ? "已配置" : "未配置";
    status.className = `provider-status ${configured ? "configured" : "unconfigured"}`;
  }, 1500);
}

async function renderProviderList({ viewState = null } = {}) {
  const container = document.querySelector("#provider-list");
  if (!container) return;
  await Promise.all([refreshConfiguredProviders(), refreshCustomProviders(), refreshModelMultimodalCapabilities()]);
  container.innerHTML = allProviderCatalog().map((p) => {
    const configured = isProviderConfigured(p.id);
    const enabled = isProviderEnabled(p.id);
    const statusClass = configured ? "configured" : "unconfigured";
    const statusText = configured ? "已配置" : "未配置";
    const isOAuth = p.envKey === null && !["openai-codex","google-vertex","amazon-bedrock","github-copilot","qwen-token-plan-cn","zai-coding-cn"].includes(p.id);

    return `
      <div class="provider-card" data-provider="${p.id}">
        <div class="provider-head" data-action="toggle">
          <img class="provider-icon" src="${p.icon}" alt="" />
          <div class="provider-info">
            <div class="provider-name">${p.name}</div>
            <div class="provider-desc">${p.desc}</div>
          </div>
          <span class="provider-status ${statusClass}">${statusText}</span>
          ${p.custom
            ? `<button class="provider-clear" data-action="delete-custom" data-provider="${p.id}" title="删除自定义厂商">删除</button>`
            : configured ? `<button class="provider-clear" data-action="clear-key" data-provider="${p.id}" title="清除该厂商配置">清除</button>` : ""}
          <span class="provider-arrow">▶</span>
        </div>
        <div class="provider-body">
          ${p.custom
            ? `<p class="custom-provider-summary">Base URL：${escapeIntegrationText(p.baseUrl)}<br>API Key 已加密保存到本机。</p>`
            : p.envKey
            ? `<div class="api-key-row">
                <div style="flex:1">
                  <label class="api-key-label">API Key（${p.envKey}）</label>
                  <input class="api-key-input" type="password" placeholder="${configured ? "已保存，重新输入以更新" : `输入 ${p.envKey}…`}" data-provider="${p.id}" />
                </div>
                <button class="api-key-save" data-action="save-key" data-provider="${p.id}">保存</button>
              </div>`
            : `<p style="font-size:12px;color:var(--text-dim);margin-bottom:10px">${p.id === "openai-codex" || p.id === "github-copilot" ? "使用 OAuth 登录，无需填写 API Key" : p.id === "google-vertex" || p.id === "amazon-bedrock" ? "使用云平台默认凭证（ADC / IAM），无需填写 API Key" : "此服务使用 Token Plan 订阅，无需填写 API Key"}</p>`}
          <div class="provider-enable-row">
            <span>启用厂商 <small class="provider-enable-state">${enabled ? "已启用" : "已停用"}</small></span>
            <label class="provider-enable-switch" title="控制该厂商是否显示在对话模型切换中">
              <input data-action="toggle-provider-enabled" data-provider="${p.id}" type="checkbox" role="switch" aria-label="启用 ${p.name}" ${enabled ? "checked" : ""}>
              <span aria-hidden="true"></span>
            </label>
          </div>
        </div>
      </div>`;
  }).join("") + `<div class="custom-provider-entry"><button id="btn-open-custom-provider" class="custom-provider-open" type="button">＋ 自定义厂商</button></div>`;

  // 展开/收起
  container.querySelectorAll("[data-action='toggle']").forEach((el) => {
    el.addEventListener("click", () => el.closest(".provider-card").classList.toggle("expanded"));
  });
  container.querySelectorAll("[data-action='toggle-provider-enabled']").forEach((input) => {
    input.addEventListener("change", async (event) => {
      event.stopPropagation();
      const providerId = input.dataset.provider;
      const enabled = input.checked;
      setProviderEnabled(providerId, enabled);
      const card = input.closest(".provider-card");
      card.querySelector(".provider-enable-state").textContent = enabled ? "已启用" : "已停用";
      card.querySelectorAll(".model-chip").forEach((chip) => {
        chip.classList.toggle("disabled", !enabled);
        chip.setAttribute("aria-disabled", String(!enabled));
      });

      if (!enabled && currentModelRef?.startsWith(`${providerId}/`)) {
        currentModelRef = null;
        localStorage.removeItem("pi_current_model");
        document.querySelector("#current-model-name").textContent = "—";
        await window.piAgent.setModel(null);
      }
      renderModelPicker();
    });
  });
  // 保存 Key（含即时视觉反馈）
  container.querySelectorAll("[data-action='save-key']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const providerId = btn.dataset.provider;
      const input = container.querySelector(`.api-key-input[data-provider="${providerId}"]`);
      const key = input.value.trim();
      // 凭证只持久化到主进程认证存储，并让 ModelRuntime 立即识别。
      btn.disabled = true;
      try {
        await window.piAgent.saveApiKey(providerId, key);
        await refreshConfiguredProviders();
      } catch (e) {
        addError(`保存 ${providerId} 密钥失败：${e?.message ?? e}`);
        btn.disabled = false;
        return;
      }
      btn.disabled = false;
      // 如果当前模型属于被清除的厂商，清空选择
      if (!key && currentModelRef && currentModelRef.startsWith(providerId + "/")) {
        currentModelRef = null;
        localStorage.removeItem("pi_current_model");
        document.querySelector("#current-model-name").textContent = "—";
        await window.piAgent.setModel(null);
      }
      await refreshProviderConfigurationUi(providerId, key ? "已保存" : "已清除");

      if (currentModelRef && currentModelRef.startsWith(providerId + "/")) {
        await recreateActiveTaskSession();
        sessionReady = true;
      }
    });
  });
  // 清除厂商配置
  container.querySelectorAll("[data-action='clear-key']").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation(); // 防止触发卡片展开
      const providerId = btn.dataset.provider;
      const prov = allProviderCatalog().find((p) => p.id === providerId);
      if (!confirm(`确定清除 ${prov?.name || providerId} 的配置吗？`)) return;

      // 清空输入框，并通知主进程删除凭证。
      const input = container.querySelector(`.api-key-input[data-provider="${providerId}"]`);
      if (input) input.value = "";
      try {
        await window.piAgent.saveApiKey(providerId, "");
        await refreshConfiguredProviders();
      } catch (err) {
        addError(`清除 ${providerId} 失败：${err?.message ?? err}`);
        return;
      }

      // 如果当前模型属于该厂商，清空选择
      if (currentModelRef && currentModelRef.startsWith(providerId + "/")) {
        currentModelRef = null;
        localStorage.removeItem("pi_current_model");
        document.querySelector("#current-model-name").textContent = "—";
        await window.piAgent.setModel(null);
      }

      await refreshProviderConfigurationUi(providerId, "已清除");
      addLog(`已清除 ${prov?.name || providerId} 的配置`, "info");
    });
  });
  container.querySelectorAll("[data-action='delete-custom']").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const providerId = btn.dataset.provider;
      const provider = allProviderCatalog().find((item) => item.id === providerId);
      if (!confirm(`确定删除自定义厂商“${provider?.name || providerId}”吗？`)) return;
      try {
        await window.piAgent.deleteCustomProvider(providerId);
        removeProviderEnabledSetting(providerId);
        if (currentModelRef?.startsWith(`${providerId}/`)) {
          currentModelRef = null;
          localStorage.removeItem("pi_current_model");
          document.querySelector("#current-model-name").textContent = "—";
          await window.piAgent.setModel(null);
        }
        await renderProviderList();
        addLog(`已删除自定义厂商：${provider?.name || providerId}`, "info");
      } catch (error) {
        addError(`删除自定义厂商失败：${error?.message ?? error}`);
      }
    });
  });
  container.querySelector("#btn-open-custom-provider")?.addEventListener("click", renderCustomProviderForm);
  restoreProviderListView(viewState);
}

function renderCustomProviderForm() {
  const container = document.querySelector("#provider-list");
  if (!container) return;
  container.innerHTML = `
    <section class="custom-provider-form-wrap" aria-labelledby="custom-provider-title">
      <div class="custom-provider-form-head">
        <div><h4 id="custom-provider-title">自定义厂商</h4><p>添加兼容协议的模型服务，保存后会立即出现在厂商列表中。</p></div>
        <button id="btn-back-to-provider-list" class="custom-provider-back" type="button" title="返回厂商列表" aria-label="返回厂商列表">←</button>
      </div>
      <form id="custom-provider-form" class="custom-provider-form">
        <label>厂商名称<input name="name" required maxlength="60" placeholder="例如：公司模型网关"></label>
        <label class="custom-provider-base-url"><span>Base URL <span class="custom-url-mode"><span class="custom-url-mode-label">自动补全版本路径</span><span class="custom-url-switch"><input name="fullUrl" type="checkbox" role="switch" aria-label="使用完整 URL"><span></span></span></span></span><input name="baseUrl" required type="url" placeholder="https://api.example.com"></label>
        <label>API 协议<select name="api"><option value="openai-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option><option value="google-generative-ai">Google Generative AI</option></select></label>
        <label>API Key<input name="apiKey" required type="password" autocomplete="new-password" placeholder="仅加密保存到本机"></label>
        <section class="custom-provider-model-section" aria-labelledby="custom-model-section-title">
          <div class="custom-provider-model-head"><div><h5 id="custom-model-section-title">模型配置</h5><p id="custom-model-catalog-status" role="status" aria-live="polite">配置可用模型及其显示名称。</p></div><div class="custom-model-actions"><button id="btn-fetch-custom-models" class="custom-model-fetch" type="button">⇩ 获取模型列表</button><button id="btn-add-custom-model" class="custom-model-add" type="button">＋ 添加模型</button></div></div>
          <div class="custom-model-columns"><span></span><span>模型 ID</span><span>显示名称</span><span></span></div>
          <div id="custom-model-list" class="custom-model-list"></div>
        </section>
        <label class="custom-provider-checkbox"><input name="reasoning" type="checkbox">该模型支持推理强度</label>
        <section class="custom-provider-multimodal-section" aria-labelledby="custom-provider-multimodal-title">
          <div class="custom-provider-multimodal-head">
            <div><h5 id="custom-provider-multimodal-title">模型多模态</h5><p>为已配置的模型单独控制图片输入。</p></div>
            <label class="custom-provider-multimodal-all"><span>启用所有模型多模态</span><span class="provider-enable-switch"><input name="multimodalAll" type="checkbox" role="switch" aria-label="启用所有模型多模态"><span aria-hidden="true"></span></span></label>
          </div>
          <div id="custom-provider-multimodal-list" class="custom-provider-multimodal-list"></div>
        </section>
        <div class="custom-provider-form-actions"><button class="custom-provider-save" type="submit">添加厂商</button></div>
      </form>
    </section>`;
  const form = container.querySelector("#custom-provider-form");
  const modelList = container.querySelector("#custom-model-list");
  const modelCatalogStatus = container.querySelector("#custom-model-catalog-status");
  const multimodalAllInput = form.querySelector("input[name='multimodalAll']");
  const multimodalList = container.querySelector("#custom-provider-multimodal-list");
  let fetchedModels = [];
  let modelRowSequence = 0;
  const modelMultimodalState = new Map();
  const setModelCatalogStatus = (message, tone = "info") => {
    modelCatalogStatus.textContent = message;
    modelCatalogStatus.classList.toggle("is-error", tone === "error");
  };
  const fullUrlInput = form.querySelector("input[name='fullUrl']");
  const baseUrlInput = form.querySelector("input[name='baseUrl']");
  const syncUrlMode = () => {
    const fullUrl = fullUrlInput.checked;
    baseUrlInput.placeholder = fullUrl ? "https://api.example.com/v1" : "https://api.example.com";
    baseUrlInput.closest("label").querySelector(".custom-url-mode-label").textContent = fullUrl ? "完整 URL" : "自动补全版本路径";
  };
  const syncModelNameFromCatalog = (row) => {
    const idInput = row.querySelector(".custom-model-id");
    const matched = fetchedModels.find((model) => model.id === idInput.value.trim());
    if (!matched) return;
    row.querySelector(".custom-model-name").value = matched.name || matched.id;
  };
  const configuredModelRows = () => [...modelList.querySelectorAll(".custom-model-row")]
    .filter((row) => row.querySelector(".custom-model-id").value.trim());
  const syncAllModelMultimodal = () => {
    const rows = configuredModelRows();
    multimodalAllInput.checked = rows.length > 0 && rows.every((row) => modelMultimodalState.get(row.dataset.modelKey) === true);
  };
  const renderMultimodalList = () => {
    const rows = configuredModelRows();
    syncAllModelMultimodal();
    if (rows.length === 0) {
      multimodalList.innerHTML = '<p class="custom-provider-multimodal-empty">请先在上方添加模型。</p>';
      return;
    }
    multimodalList.innerHTML = rows.map((row) => {
      const id = row.querySelector(".custom-model-id").value.trim();
      const name = row.querySelector(".custom-model-name").value.trim();
      const enabled = modelMultimodalState.get(row.dataset.modelKey) === true;
      return `<div class="custom-provider-multimodal-row">
        <div class="custom-provider-multimodal-model"><strong title="${escapeIntegrationText(name || id)}">${escapeIntegrationText(name || id)}</strong>${name ? `<small title="${escapeIntegrationText(id)}">${escapeIntegrationText(id)}</small>` : ""}</div>
        <label class="provider-enable-switch"><input data-model-key="${row.dataset.modelKey}" type="checkbox" role="switch" aria-label="启用 ${escapeIntegrationText(name || id)} 多模态" ${enabled ? "checked" : ""}><span aria-hidden="true"></span></label>
      </div>`;
    }).join("");
    multimodalList.querySelectorAll("[data-model-key]").forEach((input) => {
      input.addEventListener("change", () => {
        modelMultimodalState.set(input.dataset.modelKey, input.checked);
        syncAllModelMultimodal();
      });
    });
  };
  const renderModelSuggestions = (row) => {
    const input = row.querySelector(".custom-model-id");
    const menu = row.querySelector(".custom-model-suggestions");
    const query = input.value.trim().toLowerCase();
    const matching = fetchedModels.filter((model) => !query || `${model.id} ${model.name || ""}`.toLowerCase().includes(query));
    if (!matching.length) {
      menu.innerHTML = fetchedModels.length ? '<div class="custom-model-suggestion-empty">未找到匹配模型</div>' : '<div class="custom-model-suggestion-empty">请先获取模型列表</div>';
    } else {
      menu.innerHTML = matching.map((model, index) => `<button type="button" role="option" data-model-index="${fetchedModels.indexOf(model)}"><strong>${escapeIntegrationText(model.id)}</strong>${model.name && model.name !== model.id ? `<small>${escapeIntegrationText(model.name)}</small>` : ""}</button>`).join("");
    }
    menu.classList.remove("hidden");
  };
  const hideModelSuggestions = (row) => row.querySelector(".custom-model-suggestions")?.classList.add("hidden");
  const chooseModelSuggestion = (row, model) => {
    if (!model) return;
    row.querySelector(".custom-model-id").value = model.id;
    row.querySelector(".custom-model-name").value = model.name || model.id;
    hideModelSuggestions(row);
    renderMultimodalList();
  };
  const appendModelRow = (model = {}) => {
    const row = document.createElement("div");
    row.className = "custom-model-row";
    row.dataset.modelKey = `custom-model-${++modelRowSequence}`;
    modelMultimodalState.set(row.dataset.modelKey, model.multimodal === true);
    row.innerHTML = `<span class="custom-model-handle" aria-hidden="true">›</span><div class="custom-model-id-wrap"><input class="custom-model-id" required maxlength="120" autocomplete="off" value="${escapeIntegrationText(model.id || "")}" placeholder="例如：gpt-5.5" aria-label="模型 ID" aria-autocomplete="list" aria-expanded="false"><div class="custom-model-suggestions hidden" role="listbox"></div></div><input class="custom-model-name" maxlength="120" value="${escapeIntegrationText(model.name || "")}" placeholder="显示名称（可选）" aria-label="显示名称"><button class="custom-model-remove" type="button" title="删除模型" aria-label="删除模型">⌫</button>`;
    const idInput = row.querySelector(".custom-model-id");
    const suggestions = row.querySelector(".custom-model-suggestions");
    idInput.addEventListener("focus", () => renderModelSuggestions(row));
    idInput.addEventListener("input", () => {
      syncModelNameFromCatalog(row);
      renderModelSuggestions(row);
      renderMultimodalList();
    });
    idInput.addEventListener("change", () => {
      syncModelNameFromCatalog(row);
      renderMultimodalList();
    });
    idInput.addEventListener("blur", () => setTimeout(() => hideModelSuggestions(row), 120));
    suggestions.addEventListener("mousedown", (event) => {
      const option = event.target.closest("[data-model-index]");
      if (!option) return;
      event.preventDefault();
      chooseModelSuggestion(row, fetchedModels[Number(option.dataset.modelIndex)]);
    });
    row.querySelector(".custom-model-name").addEventListener("input", renderMultimodalList);
    row.querySelector(".custom-model-remove").addEventListener("click", () => {
      if (modelList.children.length === 1) return;
      modelMultimodalState.delete(row.dataset.modelKey);
      row.remove();
      renderMultimodalList();
    });
    modelList.appendChild(row);
    renderMultimodalList();
  };
  appendModelRow();
  multimodalAllInput.addEventListener("change", () => {
    configuredModelRows().forEach((row) => modelMultimodalState.set(row.dataset.modelKey, multimodalAllInput.checked));
    renderMultimodalList();
  });
  syncUrlMode();
  fullUrlInput.addEventListener("change", syncUrlMode);
  container.querySelector("#btn-add-custom-model")?.addEventListener("click", () => appendModelRow());
  container.querySelector("#btn-fetch-custom-models")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const values = new FormData(form);
    button.disabled = true;
    button.textContent = "正在获取…";
    setModelCatalogStatus("正在从模型服务读取可用模型…");
    try {
      const result = await window.piAgent.fetchCustomProviderModels({
        baseUrl: values.get("baseUrl"), api: values.get("api"),
        fullUrl: values.get("fullUrl") === "on", apiKey: values.get("apiKey"),
      });
      fetchedModels = result.models || [];
      setModelCatalogStatus(`已获取 ${fetchedModels.length} 个模型，点击模型 ID 输入框可在滚动列表中选择。`);
    } catch (error) {
      setModelCatalogStatus(`获取模型列表失败：${error?.message ?? error}`, "error");
    } finally {
      button.disabled = false;
      button.textContent = "⇩ 获取模型列表";
    }
  });
  container.querySelector("#btn-back-to-provider-list")?.addEventListener("click", renderProviderList);
  container.querySelector("#custom-provider-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector("button[type='submit']");
    const values = new FormData(form);
    submit.disabled = true;
    let provider;
    try {
      provider = await window.piAgent.createCustomProvider({
        name: values.get("name"), baseUrl: values.get("baseUrl"), api: values.get("api"),
        fullUrl: values.get("fullUrl") === "on", apiKey: values.get("apiKey"),
        models: [...modelList.querySelectorAll(".custom-model-row")].map((row) => ({
          id: row.querySelector(".custom-model-id").value,
          name: row.querySelector(".custom-model-name").value,
          reasoning: values.get("reasoning") === "on",
          multimodal: modelMultimodalState.get(row.dataset.modelKey) === true,
        })),
      });
    } catch (error) {
      addError(`添加自定义厂商失败：${error?.message ?? error}`);
      submit.disabled = false;
      return;
    }

    try {
      await Promise.all([refreshConfiguredProviders(), refreshCustomProviders()]);
      await renderProviderList();
      addLog(`已添加自定义厂商：${provider.name}`, "info");
    } catch (error) {
      addLog(`自定义厂商已添加，但模型设置刷新失败：${error?.message ?? error}`, "error");
      addError(`厂商已添加，但设置列表刷新失败：${error?.message ?? error}`);
    }
  });
}

/* ---------------- 模型选择器弹窗 ---------------- */
const modelPicker = $("#model-picker");
const btnCurrentModel = $("#current-model-btn");
const btnClosePicker = $("#btn-close-picker");
let modelPickerCloseTimer = null;
const thinkingLevelBtn = $("#thinking-level-btn");
const thinkingLevelMenu = $("#thinking-level-menu");
let currentThinkingLevel = localStorage.getItem(THINKING_LEVEL_STORAGE_KEY) || "off";
let availableThinkingLevels = ["off"];

initializeColorTheme();
initializeWindowControls();
initializeTitlebarMenus();
initializeDisplayZoom();
btnThemeToggle?.addEventListener("click", () => {
  toggleColorThemeWithReveal();
});
btnCurrentModel.addEventListener("click", () => openModelPicker());
btnClosePicker.addEventListener("click", () => closeModelPicker());
thinkingLevelBtn?.addEventListener("click", async (event) => {
  event.stopPropagation();
  try { updateThinkingLevelControl(await window.piAgent.getThinkingOptions()); } catch {}
  const willOpen = !thinkingLevelMenu.classList.contains("open");
  thinkingLevelMenu.classList.toggle("open", willOpen);
  thinkingLevelMenu.setAttribute("aria-hidden", String(!willOpen));
  thinkingLevelBtn.setAttribute("aria-expanded", String(willOpen));
});
modelPicker.querySelector(".mp-backdrop").addEventListener("click", () => closeModelPicker());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modelPicker.classList.contains("hidden")) closeModelPicker();
  if (e.key === "Escape") closeThinkingLevelMenu();
});
document.addEventListener("click", (event) => {
  if (!event.target.closest("#thinking-level-wrap")) closeThinkingLevelMenu();
});

function closeThinkingLevelMenu() {
  thinkingLevelMenu?.classList.remove("open");
  thinkingLevelMenu?.setAttribute("aria-hidden", "true");
  thinkingLevelBtn?.setAttribute("aria-expanded", "false");
}

function updateThinkingLevelControl(state) {
  if (state?.thinkingLevel) {
    currentThinkingLevel = state.thinkingLevel;
    localStorage.setItem(THINKING_LEVEL_STORAGE_KEY, currentThinkingLevel);
  }
  if (Array.isArray(state?.availableThinkingLevels)) availableThinkingLevels = state.availableThinkingLevels;
  if (!availableThinkingLevels.length) availableThinkingLevels = ["off"];
  const label = THINKING_LEVEL_LABELS[currentThinkingLevel] || currentThinkingLevel;
  const labelElement = $("#current-thinking-level");
  if (labelElement) labelElement.textContent = label;
  if (!thinkingLevelMenu) return;
  thinkingLevelMenu.innerHTML = availableThinkingLevels.map((level) => `
    <button class="thinking-level-option${level === currentThinkingLevel ? " selected" : ""}" type="button" role="menuitemradio" aria-checked="${level === currentThinkingLevel}" data-thinking-level="${level}">${THINKING_LEVEL_LABELS[level] || level}</button>
  `).join("") || '<div class="thinking-level-empty">当前模型不支持推理</div>';
  thinkingLevelMenu.querySelectorAll("[data-thinking-level]").forEach((option) => {
    option.addEventListener("click", async () => {
      try {
        const result = await window.piAgent.setThinkingLevel(option.dataset.thinkingLevel);
        currentThinkingLevel = result.thinkingLevel;
        availableThinkingLevels = result.availableThinkingLevels;
        localStorage.setItem(THINKING_LEVEL_STORAGE_KEY, currentThinkingLevel);
        updateThinkingLevelControl(result);
        closeThinkingLevelMenu();
      } catch (error) {
        addError(`切换推理强度失败：${error?.message ?? error}`);
      }
    });
  });
}

function openModelPicker() {
  if (modelPickerCloseTimer) {
    clearTimeout(modelPickerCloseTimer);
    modelPickerCloseTimer = null;
  }
  modelPicker.classList.remove("hidden");
  modelPicker.setAttribute("aria-hidden", "false");
  // 依据右上角模型标签动态定位弹窗（锚定在其下方右对齐）
  const pop = modelPicker.querySelector(".mp-popover");
  const r = btnCurrentModel.getBoundingClientRect();
  pop.style.top = `${r.bottom + 8}px`;
  pop.style.right = `${Math.max(12, window.innerWidth - r.right)}px`;
  pop.style.left = "auto";
  pop.style.bottom = "auto";
  requestAnimationFrame(() => {
    if (!modelPicker.classList.contains("hidden")) modelPicker.classList.add("open");
  });
  void renderModelPicker();
}
function closeModelPicker() {
  if (modelPicker.classList.contains("hidden")) return;
  modelPicker.classList.remove("open");
  modelPicker.setAttribute("aria-hidden", "true");
  if (modelPickerCloseTimer) clearTimeout(modelPickerCloseTimer);
  modelPickerCloseTimer = setTimeout(() => {
    modelPicker.classList.add("hidden");
    modelPickerCloseTimer = null;
  }, 190);
}

async function renderModelPicker() {
  const list = document.querySelector("#mp-list");
  if (!list) return;

  let contextSettings = { oneMillion: {} };
  try { contextSettings = await window.piAgent.getModelContextWindowSettings(); } catch {}

  // 已配置厂商可见；当前正在使用的厂商也必须保留在列表中，
  // 以兼容 OAuth、订阅和外部代理等不会出现在 API Key 列表中的配置。
  // 无论哪种来源，关闭厂商开关后都不显示。
  const currentRef = String(currentModelRef || document.querySelector("#current-model-name")?.textContent || "").trim();
  const currentProviderId = currentRef.split("/")[0];
  const configured = allProviderCatalog().filter((p) =>
    isProviderEnabled(p.id) && (
      isProviderConfigured(p.id) ||
      currentRef.startsWith(`${p.id}/`)
    )
  );
  // 当前模型由运行中的会话恢复时，认证状态可能尚未同步到渲染层。
  // 只要用户没有明确关闭该厂商，就始终给当前厂商一个可选入口。
  const currentProvider = allProviderCatalog().find((provider) => provider.id === currentProviderId);
  if (currentProvider && modelProviderEnablement[currentProviderId] !== false && !configured.some((provider) => provider.id === currentProviderId)) {
    configured.unshift(currentProvider);
  }

  if (configured.length === 0) {
    list.innerHTML = '<div class="mp-empty">暂无已启用且已配置的模型厂商。<br/>请在 账户 → 设置 → 模型设置 中填写 API Key，并确认已启用厂商。</div>';
    return;
  }

  // 紧凑模式：只显示厂商名 + 模型名，不显示图标和完整 model ID
  list.innerHTML = configured.map((p) => `
    <div class="mp-group">
      <div class="mp-group-head">${p.name}</div>
      ${p.models.map((m) => {
        const ref = `${p.id}/${m}`;
        const isCurrent = currentRef === ref || currentRef === m;
        const oneMillion = contextSettings.oneMillion?.[ref] === true;
        return `<div class="mp-model-row${isCurrent ? " current" : ""}">
          <button class="mp-item${isCurrent ? " current" : ""}" data-select="${escapeHtml(ref)}">${escapeHtml(m)}</button>
          <label class="mp-context-toggle" title="勾选表示该模型使用 1M 上下文；未勾选默认使用 256K">
            <input type="checkbox" data-model-context="${escapeHtml(ref)}" ${oneMillion ? "checked" : ""}>
            <span>1M</span>
          </label>
        </div>`;
      }).join("")}
    </div>
  `).join("");

  list.querySelectorAll("[data-select]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ref = btn.dataset.select;
      currentModelRef = ref;
      document.querySelector("#current-model-name").textContent = ref;
      localStorage.setItem("pi_current_model", ref);
      // 立即高亮选中项（不关闭弹窗，让用户看到蓝底）
      list.querySelectorAll(".mp-item").forEach((e) => e.classList.toggle("current", e.dataset.select === ref));
      await window.piAgent.setModel(ref);
      addLog(`已切换模型：${ref}`, "info");
      try { await recreateActiveTaskSession(); } catch {}
    });
  });
  list.querySelectorAll("[data-model-context]").forEach((input) => {
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("change", async () => {
      if (isStreaming) {
        input.checked = !input.checked;
        addError("请等待当前回复结束后再修改上下文容量。");
        return;
      }
      const ref = input.dataset.modelContext;
      const [providerId, ...modelIdParts] = String(ref || "").split("/");
      const modelId = modelIdParts.join("/");
      input.disabled = true;
      try {
        await window.piAgent.setModelContextWindow(providerId, modelId, input.checked);
        if (currentRef === ref && sessionReady) await recreateActiveTaskSession();
        await renderModelPicker();
      } catch (error) {
        input.checked = !input.checked;
        addError(`修改上下文容量失败：${error?.message ?? error}`);
      } finally {
        input.disabled = false;
      }
    });
  });
}
