/**
 * UpdateService —— 软件自动更新服务
 *
 * 基于 electron-updater + 自定义 HTTP 服务器 (generic provider)。
 * 仅在正式安装版 (app.isPackaged) 下启用，开发版跳过所有更新逻辑。
 *
 * 策略：启动时自动检查 → 用户确认 → 下载 → 退出时安装
 */
import { createRequire } from "node:module";
import { app, dialog } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { autoUpdater } = require("electron-updater");

const STARTUP_CHECK_DELAY_MS = 3000;
const PREFERENCES_FILE = "update-preferences.json";

function compareVersions(left, right) {
  const parse = (value) => {
    const normalized = String(value ?? "").trim().replace(/^v/i, "").split("+", 1)[0];
    const [main, prerelease = ""] = normalized.split("-", 2);
    const parts = main.split(".").map((part) => /^\d+$/.test(part) ? Number(part) : 0);
    return { parts, prerelease };
  };
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.parts.length, b.parts.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (a.parts[index] ?? 0) - (b.parts[index] ?? 0);
    if (delta !== 0) return Math.sign(delta);
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

function isNewerVersion(candidate, current) {
  return Boolean(candidate && current) && compareVersions(candidate, current) > 0;
}

/** releaseNotes 中包含此标记的版本为"必要更新"，用户不可跳过 */
const MANDATORY_UPDATE_MARKER = /\[必要更新\]|#必要更新#/;

/**
 * @param {(channel: string, payload: unknown) => void} sendToRenderer
 * @param {{ feedUrl?: string }} [opts]
 */
export class UpdateService {
  constructor(sendToRenderer, opts = {}) {
    this.sendToRenderer = sendToRenderer;
    this.feedUrl = opts.feedUrl ?? null;
    this._enabled = false;
    this._disabledReason = null;
    this._checking = false;
    this._latestVersion = null;
    this._latestIsMandatory = false;
    this._notificationsDisabled = false;
    this._pendingUpdateVersion = null;
    this._installPromptOpen = false;
    this._installRequested = false;
    this._prefsLoaded = false;
  }

  _preferencesPath() {
    return path.join(app.getPath("userData"), PREFERENCES_FILE);
  }

  /** 加载更新偏好 */
  async _loadPreferences() {
    if (this._prefsLoaded) return;
    this._prefsLoaded = true;
    try {
      const saved = JSON.parse(await fs.readFile(this._preferencesPath(), "utf8"));
      this._notificationsDisabled = saved?.notificationsDisabled === true;
      this._pendingUpdateVersion = typeof saved?.pendingUpdateVersion === "string"
        ? saved.pendingUpdateVersion
        : null;
    } catch (error) {
      if (error?.code !== "ENOENT") console.warn("[UpdateService] 读取偏好失败：", error?.message ?? error);
      this._notificationsDisabled = false;
    }
  }

  /** 持久化更新偏好 */
  async _savePreferences() {
    const targetPath = this._preferencesPath();
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(
      targetPath,
      JSON.stringify({
        notificationsDisabled: this._notificationsDisabled,
        pendingUpdateVersion: this._pendingUpdateVersion,
      }, null, 2),
      "utf8"
    );
  }

  /** 判断是否为必要更新 */
  _isMandatoryUpdate(releaseNotes) {
    if (typeof releaseNotes === "string" && MANDATORY_UPDATE_MARKER.test(releaseNotes)) {
      return true;
    }
    // 也支持在 version 字段前检查（部分发布流程可能在 version 描述中标记）
    return false;
  }

  /**
   * 初始化自动更新服务。
   * - 开发版 (!app.isPackaged) 直接跳过
   * - 安装版注册事件监听，启动后延迟自动检查
   * - 若未显式传入 feedUrl，electron-updater 自动从 package.json 的 build.publish 读取
   * @param {{ feedUrl?: string }} [opts]
   */
  async init(opts = {}) {
    if (!app.isPackaged) {
      this._disabledReason = "development build";
      console.log("[UpdateService] 开发版，跳过自动更新。");
      return;
    }

    try {
      let feedUrl = opts.feedUrl ?? this.feedUrl;
      this._enabled = true;
      this._disabledReason = null;

      await this._loadPreferences();
      if (this._pendingUpdateVersion && !isNewerVersion(this._pendingUpdateVersion, app.getVersion())) {
        this._pendingUpdateVersion = null;
        await this._savePreferences();
      }

      // 配置 autoUpdater
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.allowDowngrade = false;

      // 如果未显式传入 feedUrl，开发目录可从 package.json 读取 publish 配置。
      // Electron Builder 会在正式安装包的 resources/app-update.yml 中保存同一配置，
      // 但会从 resources/app/package.json 移除 build 字段。此时不要禁用更新，
      // 交由 electron-updater 按标准方式读取 app-update.yml。
      if (!feedUrl) {
        try {
          const pkgPath = path.join(app.getAppPath(), "package.json");
          const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
          const publishUrl = pkg?.build?.publish?.url;
          if (publishUrl && typeof publishUrl === "string") {
            feedUrl = publishUrl;
          }
        } catch (err) {
          console.warn("[UpdateService] 无法读取打包配置中的更新地址：", err?.message ?? err);
        }
      }

      if (feedUrl) {
        this.feedUrl = feedUrl;
        autoUpdater.setFeedURL(feedUrl);
      }

      this._registerEvents();

      setTimeout(() => {
        if (this._pendingUpdateVersion && isNewerVersion(this._pendingUpdateVersion, app.getVersion())) {
          void this._promptForDownloadedUpdate(this._pendingUpdateVersion);
        }
        this.checkForUpdates().catch(() => {});
      }, STARTUP_CHECK_DELAY_MS);

      console.log("[UpdateService] 已初始化" +
        (this.feedUrl ? `，更新地址：${this.feedUrl}` : "（使用打包内 app-update.yml 配置）") +
        (this._notificationsDisabled ? "，通知已关闭" : ""));
    } catch (error) {
      console.error("[UpdateService] 初始化失败，已禁用自动更新：", error?.message ?? error);
      this._enabled = false;
      this._disabledReason = String(error?.message ?? error);
    }
  }

  /** 注册 autoUpdater 事件监听，通过 sendToRenderer 转发到渲染进程 */
  _registerEvents() {
    autoUpdater.on("checking-for-update", () => {
      this._checking = true;
      this.sendToRenderer("updater:checking", {});
    });

    autoUpdater.on("update-available", (info) => {
      this._checking = false;
      const version = info.version ?? null;
      if (!isNewerVersion(version, app.getVersion())) {
        console.log("[UpdateService] Ignore stale update metadata:", version, "current:", app.getVersion());
        this._latestVersion = null;
        this._latestIsMandatory = false;
        this.sendToRenderer("updater:not-available", {});
        return;
      }
      this._latestVersion = version;
      const isMandatory = this._isMandatoryUpdate(info.releaseNotes ?? info.releaseName ?? "");
      this._latestIsMandatory = isMandatory;

      // 非必要更新 + 用户关闭了通知 → 静默处理，不弹出通知条
      if (!isMandatory && this._notificationsDisabled) {
        console.log("[UpdateService] 发现更新 v" + (info.version ?? "?") + "，但通知已关闭（非必要更新），静默跳过。");
        return;
      }

      this.sendToRenderer("updater:available", {
        version: info.version ?? null,
        releaseNotes: info.releaseNotes ?? null,
        releaseDate: info.releaseDate ?? null,
        isMandatory,
      });
    });

    autoUpdater.on("update-not-available", () => {
      this._checking = false;
      this._latestVersion = null;
      this._latestIsMandatory = false;
      this.sendToRenderer("updater:not-available", {});
    });

    autoUpdater.on("download-progress", (progress) => {
      this.sendToRenderer("updater:download-progress", {
        percent: progress.percent ?? 0,
        bytesPerSecond: progress.bytesPerSecond ?? 0,
        transferred: progress.transferred ?? 0,
        total: progress.total ?? 0,
      });
    });

    autoUpdater.on("update-downloaded", (info) => {
      const version = info.version ?? this._latestVersion;
      if (!isNewerVersion(version, app.getVersion())) {
        console.log("[UpdateService] Ignore stale downloaded update:", version, "current:", app.getVersion());
        return;
      }
      this._latestVersion = version;
      this._pendingUpdateVersion = this._latestVersion;
      this.sendToRenderer("updater:downloaded", {
        version: info.version ?? this._latestVersion ?? null,
      });
      void this._savePreferences().catch((error) => {
        console.warn("[UpdateService] Failed to save pending update state:", error?.message ?? error);
      });
      void this._promptForDownloadedUpdate(this._pendingUpdateVersion);
    });

    autoUpdater.on("error", (error) => {
      this._checking = false;
      const message = String(error?.message ?? error ?? "更新检查失败");
      // 网络错误、服务器未配置等场景下静默处理，不向用户弹错误
      console.warn("[UpdateService] 更新错误：", message);
      this.sendToRenderer("updater:error", {
        message,
        isNetwork: /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET|network|offline/i.test(message),
      });
    });
  }

  async _promptForDownloadedUpdate(version) {
    if (!version || this._installPromptOpen || this._installRequested) return;
    this._installPromptOpen = true;
    try {
      const result = await dialog.showMessageBox({
        type: "info",
        buttons: ["是，重启并更新", "取消"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        message: "更新已下载完成，是否重启确认更新？",
        detail: `版本 ${version} 已准备就绪。选择“是”将关闭应用并显示安装程序进度；选择“取消”将在本次关闭应用时自动安装。`,
      });

      if (result.response === 0) {
        this._installRequested = true;
        this.sendToRenderer("updater:installing", { version });
        setImmediate(() => autoUpdater.quitAndInstall(false, false));
      } else {
        this.sendToRenderer("updater:install-deferred", { version });
      }
    } finally {
      this._installPromptOpen = false;
    }
  }

  /** 手动触发更新检查 */
  async checkForUpdates() {
    if (!this._enabled) {
      return { enabled: false, reason: "当前为开发版或未配置更新服务器" };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      const version = result?.updateInfo?.version ?? null;
      return {
        enabled: true,
        updateAvailable: isNewerVersion(version, app.getVersion()),
        version,
      };
    } catch (error) {
      const message = String(error?.message ?? error);
      if (/ERR_INTERNET|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|offline/i.test(message)) {
        return { enabled: true, updateAvailable: false, error: "网络连接失败，请稍后重试" };
      }
      return { enabled: true, updateAvailable: false, error: message };
    }
  }

  /** 下载已发现的更新 */
  async downloadUpdate() {
    if (!this._enabled) {
      throw new Error("当前为开发版或未配置更新服务器");
    }
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (error) {
      throw new Error(`下载更新失败：${error?.message ?? error}`);
    }
  }

  /** 退出并安装已下载的更新 */
  quitAndInstall() {
    if (!this._enabled) {
      throw new Error("当前为开发版或未配置更新服务器");
    }
    this._installRequested = true;
    setImmediate(() => autoUpdater.quitAndInstall(false, false));
    return { ok: true };
  }

  /** 更新安装已请求时，主进程应避免被长时间的普通退出清理阻塞。 */
  isInstallRequested() {
    return this._installRequested;
  }

  /** 返回当前更新服务状态 */
  getStatus() {
    return {
      enabled: this._enabled,
      disabledReason: this._disabledReason,
      feedUrl: this.feedUrl,
      checking: this._checking,
      latestVersion: this._latestVersion,
      latestIsMandatory: this._latestIsMandatory,
      notificationsDisabled: this._notificationsDisabled,
      pendingUpdateVersion: this._pendingUpdateVersion,
      currentVersion: app.getVersion(),
    };
  }

  /** 返回更新偏好 */
  getPreferences() {
    return {
      notificationsDisabled: this._notificationsDisabled,
    };
  }

  /** 设置是否关闭更新通知 */
  async setNotificationsDisabled(disabled) {
    this._notificationsDisabled = disabled === true;
    await this._savePreferences();
    // 推送最新偏好到渲染进程
    this.sendToRenderer("updater:preferences", this.getPreferences());
    return this.getPreferences();
  }
}
