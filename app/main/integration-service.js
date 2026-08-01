import { app, safeStorage } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import TOML from "@iarna/toml";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const SETTINGS_FILE = "integrations.json";

const MCP_SOURCES = [
  { source: "Claude Code", path: () => path.join(os.homedir(), ".claude.json"), format: "json", key: "mcpServers" },
  { source: "Claude Code", path: () => path.join(os.homedir(), ".claude", "settings.json"), format: "json", key: "mcpServers" },
  { source: "Claude Code", path: () => path.join(os.homedir(), ".claude", "settings.local.json"), format: "json", key: "mcpServers" },
  { source: "Claude Desktop", path: () => path.join(process.env.APPDATA ?? "", "Claude", "claude_desktop_config.json"), format: "json", key: "mcpServers" },
  { source: "OpenCode", path: () => path.join(os.homedir(), ".config", "opencode", "opencode.json"), format: "json", key: "mcp" },
  { source: "OpenCode", path: () => path.join(os.homedir(), ".config", "opencode", "opencode.jsonc"), format: "jsonc", key: "mcp" },
  { source: "OpenCode", path: () => path.join(process.env.APPDATA ?? "", "opencode", "opencode.json"), format: "json", key: "mcp" },
  { source: "OpenCode", path: () => path.join(process.env.APPDATA ?? "", "opencode", "opencode.jsonc"), format: "jsonc", key: "mcp" },
  { source: "Codex", path: () => path.join(os.homedir(), ".codex", "config.toml"), format: "toml", key: "mcp_servers" },
  { source: "ChatGPT", path: () => path.join(process.env.APPDATA ?? "", "ChatGPT", "mcp.json"), format: "json", key: "mcpServers" },
  { source: "ChatGPT", path: () => path.join(os.homedir(), ".chatgpt", "mcp.json"), format: "json", key: "mcpServers" },
];

const SKILL_ROOTS = [
  { source: "Claude Code", path: () => path.join(os.homedir(), ".claude", "skills") },
  { source: "Claude Desktop", path: () => path.join(process.env.APPDATA ?? "", "Claude", "skills") },
  { source: "Codex", path: () => path.join(os.homedir(), ".codex", "skills") },
  { source: "OpenCode", path: () => path.join(os.homedir(), ".config", "opencode", "skills") },
  { source: "OpenCode", path: () => path.join(os.homedir(), ".opencode", "skills") },
  { source: "Agent Skills", path: () => path.join(os.homedir(), ".agents", "skills") },
  { source: "ChatGPT", path: () => path.join(os.homedir(), ".chatgpt", "skills") },
  { source: "ChatGPT", path: () => path.join(process.env.APPDATA ?? "", "ChatGPT", "skills") },
];

function stableId(type, value) {
  return `${type}-${crypto.createHash("sha1").update(value).digest("hex").slice(0, 12)}`;
}

/** Parse JSONC without evaluating configuration text from another application. */
function parseJsonc(text) {
  let output = "";
  let quote = null;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (quote) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"') {
      quote = character;
      output += character;
      continue;
    }
    if (character === "/" && next === "/") {
      index += 1;
      while (index + 1 < text.length && text[index + 1] !== "\n" && text[index + 1] !== "\r") index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      index += 1;
      while (index + 1 < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1;
      if (text[index + 1] === "/") index += 1;
      continue;
    }
    output += character;
  }

  // JSONC permits a trailing comma before a closing brace or bracket.
  output = output.replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(output.replace(/^\uFEFF/, ""));
}

function publicMcp(entry) {
  return { id: entry.id, name: entry.name, source: entry.source, enabled: entry.enabled !== false, type: entry.type };
}

function publicSkill(entry) {
  return { id: entry.id, name: entry.name, description: entry.description || "", source: entry.source, path: entry.path, enabled: entry.enabled !== false };
}

function parseFrontmatter(text, fallbackName) {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const fields = match?.[1] ?? "";
  const valueFor = (key) => fields.match(new RegExp(`^${key}:\\s*[\"']?([^\\r\\n\"']+)`, "mi"))?.[1]?.trim();
  return { name: valueFor("name") || fallbackName, description: valueFor("description") || "" };
}

function normalizeMcp(name, value, source, originPath) {
  if (!value || typeof value !== "object") return null;
  const rawCommand = Array.isArray(value.command) ? value.command : null;
  const command = rawCommand?.[0] ?? value.command;
  const args = rawCommand ? rawCommand.slice(1) : (Array.isArray(value.args) ? value.args : []);
  const url = value.url ?? value.serverUrl;
  const type = url ? "remote" : command ? "stdio" : null;
  if (!type) return null;
  const remoteTransport = value.transport === "sse" || value.type === "sse" ? "sse" : "http";

  const config = type === "remote"
    ? {
      type,
      transport: remoteTransport,
      url: String(url),
      headers: value.headers && typeof value.headers === "object" ? value.headers : {},
    }
    : {
      type,
      command: String(command),
      args: args.map(String),
      env: value.env && typeof value.env === "object" ? value.env : (value.environment && typeof value.environment === "object" ? value.environment : {}),
      cwd: typeof value.cwd === "string" ? value.cwd : undefined,
    };
  const id = stableId("mcp", `${originPath}:${name}`);
  return { id, name: String(name), source, type, enabled: value.enabled !== false, config };
}

export class IntegrationService {
  constructor() {
    this.settingsPath = path.join(app.getPath("userData"), SETTINGS_FILE);
  }

  async _readSettings() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.settingsPath, "utf8"));
      return { firstImportChecked: Boolean(parsed.firstImportChecked), skills: Array.isArray(parsed.skills) ? parsed.skills : [], mcpServers: Array.isArray(parsed.mcpServers) ? parsed.mcpServers : [] };
    } catch (error) {
      if (error?.code !== "ENOENT") console.warn("Unable to read integration settings:", error);
      return { firstImportChecked: false, skills: [], mcpServers: [] };
    }
  }

  async _writeSettings(settings) {
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify(settings, null, 2), "utf8");
  }

  _encryptConfig(config) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法安全保存 MCP 配置");
    return safeStorage.encryptString(JSON.stringify(config)).toString("base64");
  }

  _decryptConfig(value) {
    return JSON.parse(safeStorage.decryptString(Buffer.from(value, "base64")));
  }

  async scanCandidates() {
    const mcps = [];
    const skills = [];
    const seenMcp = new Set();
    const seenSkill = new Set();

    for (const item of MCP_SOURCES) {
      const configPath = item.path();
      if (!configPath || !(await fs.stat(configPath).then(() => true).catch(() => false))) continue;
      try {
        const raw = await fs.readFile(configPath, "utf8");
        const parsed = item.format === "toml" ? TOML.parse(raw) : parseJsonc(raw);
        const servers = parsed?.[item.key];
        if (!servers || typeof servers !== "object") continue;
        for (const [name, config] of Object.entries(servers)) {
          const mcp = normalizeMcp(name, config, item.source, configPath);
          if (mcp && !seenMcp.has(mcp.id)) {
            seenMcp.add(mcp.id);
            mcps.push(mcp);
          }
        }
      } catch (error) {
        console.warn(`Unable to inspect ${item.source} MCP config:`, error?.message ?? error);
      }
    }

    for (const root of SKILL_ROOTS) {
      const rootPath = root.path();
      if (!rootPath) continue;
      let directories = [];
      try { directories = await fs.readdir(rootPath, { withFileTypes: true }); } catch { continue; }
      for (const directory of directories.filter((entry) => entry.isDirectory())) {
        const skillPath = path.join(rootPath, directory.name, "SKILL.md");
        try {
          const contents = await fs.readFile(skillPath, "utf8");
          const metadata = parseFrontmatter(contents, directory.name);
          const id = stableId("skill", skillPath.toLowerCase());
          if (seenSkill.has(id)) continue;
          seenSkill.add(id);
          skills.push({ id, name: metadata.name, description: metadata.description, source: root.source, path: skillPath, enabled: true });
        } catch { /* A directory without SKILL.md is not importable. */ }
      }
    }
    return { skills, mcpServers: mcps };
  }

  async getImportPreview(force = false) {
    const settings = await this._readSettings();
    if (settings.firstImportChecked && !force) return { shouldPrompt: false, skills: [], mcpServers: [] };
    const candidates = await this.scanCandidates();
    return { shouldPrompt: candidates.skills.length + candidates.mcpServers.length > 0, ...candidates };
  }

  async importCandidates(selectedSources) {
    const [settings, candidates] = await Promise.all([this._readSettings(), this.scanCandidates()]);
    const hasSelection = Array.isArray(selectedSources);
    const sourceSet = new Set(hasSelection ? selectedSources.filter((source) => typeof source === "string") : []);
    if (hasSelection && sourceSet.size === 0) throw new Error("请选择至少一个 Agent 配置");
    const skillsToImport = hasSelection ? candidates.skills.filter((skill) => sourceSet.has(skill.source)) : candidates.skills;
    const serversToImport = hasSelection ? candidates.mcpServers.filter((server) => sourceSet.has(server.source)) : candidates.mcpServers;
    const skills = new Map(settings.skills.map((entry) => [entry.id, entry]));
    const mcpServers = new Map(settings.mcpServers.map((entry) => [entry.id, entry]));
    for (const skill of skillsToImport) {
      if (!skills.has(skill.id)) skills.set(skill.id, skill);
    }
    for (const server of serversToImport) {
      const existing = mcpServers.get(server.id);
      mcpServers.set(server.id, {
        ...publicMcp(server),
        // 导入配置仅保存定义；由用户在 MCP 列表中显式启用后才允许启动命令或连接远程服务。
        enabled: existing?.enabled ?? false,
        encryptedConfig: this._encryptConfig(server.config),
      });
    }
    const next = { firstImportChecked: true, skills: [...skills.values()], mcpServers: [...mcpServers.values()] };
    await this._writeSettings(next);
    return this.getIntegrations();
  }

  async dismissImport() {
    const settings = await this._readSettings();
    settings.firstImportChecked = true;
    await this._writeSettings(settings);
  }

  async getIntegrations() {
    const settings = await this._readSettings();
    return { skills: settings.skills.map(publicSkill), mcpServers: settings.mcpServers.map(publicMcp) };
  }

  async setEnabled(kind, id, enabled) {
    if (kind !== "mcp" && kind !== "skill") throw new Error("不支持的集成类型");
    const settings = await this._readSettings();
    const collection = kind === "mcp" ? settings.mcpServers : settings.skills;
    const entry = collection.find((item) => item.id === id);
    if (!entry) throw new Error("未找到对应的集成配置");
    entry.enabled = Boolean(enabled);
    await this._writeSettings(settings);
    return this.getIntegrations();
  }

  async getEnabledMcpServers() {
    const settings = await this._readSettings();
    const enabledServers = [];
    for (const entry of settings.mcpServers) {
      if (entry.enabled === false) continue;
      try {
        enabledServers.push({ ...publicMcp(entry), config: this._decryptConfig(entry.encryptedConfig) });
      } catch (error) {
        console.warn(`Skipping unavailable MCP server ${entry.name}:`, error?.message ?? error);
      }
    }
    return enabledServers;
  }

  async getMcpServersForHealth() {
    const settings = await this._readSettings();
    return settings.mcpServers.map((entry) => {
      const base = publicMcp(entry);
      if (entry.enabled === false) return base;
      try {
        return { ...base, config: this._decryptConfig(entry.encryptedConfig) };
      } catch (error) {
        console.warn(`Unable to read MCP server ${entry.name} for health check:`, error?.message ?? error);
        return { ...base, configError: true };
      }
    });
  }

  async getEnabledSkills() {
    const settings = await this._readSettings();
    return settings.skills.filter((entry) => entry.enabled !== false).map(publicSkill);
  }
}

export function createSkillTools(getSkills) {
  const listSkills = defineTool({
    name: "list_skills",
    label: "查看 Skills",
    description: "List enabled imported Skills. Use this to discover specialized instructions before working on a matching task.",
    parameters: Type.Object({}),
    execute: async () => {
      const skills = await getSkills();
      const text = skills.length ? skills.map((skill) => `- ${skill.id}: ${skill.name}${skill.description ? ` — ${skill.description}` : ""}`).join("\n") : "没有已启用的 Skill。";
      return { content: [{ type: "text", text }], details: { count: skills.length } };
    },
  });
  const useSkill = defineTool({
    name: "use_skill",
    label: "加载 Skill",
    description: "Load the full instructions of one enabled imported Skill by id. Call list_skills first when the suitable Skill is unknown.",
    parameters: Type.Object({ skill_id: Type.String({ description: "ID returned by list_skills" }) }),
    execute: async (_id, params) => {
      const skill = (await getSkills()).find((item) => item.id === params.skill_id);
      if (!skill) throw new Error("Skill 不存在或已关闭");
      const text = await fs.readFile(skill.path, "utf8");
      return { content: [{ type: "text", text }], details: { skill: skill.name, path: skill.path } };
    },
  });
  return [listSkills, useSkill];
}
