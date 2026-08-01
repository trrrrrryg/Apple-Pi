import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Opening a conversation must not wait indefinitely for an unavailable MCP.
// Slow servers can still be retried later from the MCP health panel.
const MCP_CONNECT_TIMEOUT_MS = 2500;

function safeToolName(serverName, toolName) {
  return `mcp_${serverName}_${toolName}`.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96);
}

function resultToText(result) {
  const parts = Array.isArray(result?.content) ? result.content : [];
  const text = parts.map((part) => {
    if (part.type === "text") return part.text;
    if (part.type === "resource") return part.resource?.text ?? part.resource?.uri ?? "[资源]";
    if (part.type === "resource_link") return `${part.name}: ${part.uri}`;
    if (part.type === "image") return `[图片：${part.mimeType}]`;
    if (part.type === "audio") return `[音频：${part.mimeType}]`;
    return "[MCP 返回内容]";
  }).filter(Boolean);
  if (result?.structuredContent) text.push(JSON.stringify(result.structuredContent, null, 2));
  return text.join("\n\n") || "MCP 工具未返回文本内容。";
}

function healthErrorMessage(error) {
  const message = String(error?.message ?? error ?? "连接失败")
    .replace(/(Bearer\s+)[^\s,;]+/gi, "$1***")
    .replace(/(https?:\/\/)[^\s@/]+@/gi, "$1***@")
    .replace(/([?&](?:token|key|api[_-]?key)=)[^&#\s]+/gi, "$1***");
  return message.slice(0, 180);
}

export class McpRuntime {
  constructor() {
    this.connections = new Map();
    this.connecting = new Map();
    this.toolDefinitions = [];
  }

  async closeAll() {
    const active = [...this.connections.values()];
    this.connections.clear();
    this.toolDefinitions = [];
    await Promise.allSettled(active.map(async ({ client, transport }) => {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
    }));
  }

  _serverConfigKey(server) {
    return JSON.stringify({
      id: server.id,
      type: server.type,
      command: server.config?.command,
      args: server.config?.args,
      env: server.config?.env,
      cwd: server.config?.cwd,
      url: server.config?.url,
      transport: server.config?.transport,
      headers: server.config?.headers,
    });
  }

  async _connect(server) {
    const existing = this.connections.get(server.id);
    if (existing && this._serverConfigKey(existing.server) === this._serverConfigKey(server)) {
      return existing;
    }

    const configKey = this._serverConfigKey(server);
    const pending = this.connecting.get(server.id);
    if (pending?.configKey === configKey) return pending.promise;

    const client = new Client({ name: "apple-pi-desktop", version: "1.0.0" });
    const transport = server.type === "remote"
      ? server.config.transport === "sse"
        ? new SSEClientTransport(new URL(server.config.url), {
          eventSourceInit: { headers: server.config.headers ?? {} },
          requestInit: { headers: server.config.headers ?? {} },
        })
        : new StreamableHTTPClientTransport(new URL(server.config.url), { requestInit: { headers: server.config.headers ?? {} } })
      : new StdioClientTransport({
        command: server.config.command,
        args: server.config.args ?? [],
        env: { ...process.env, ...(server.config.env ?? {}) },
        cwd: server.config.cwd,
        stderr: "pipe",
      });

    const closePendingConnection = async () => {
      await Promise.allSettled([
        client.close(),
        transport.close(),
      ]);
    };
    const connectionPromise = (async () => {
      let timeoutId = null;
      try {
        const connection = await Promise.race([
          (async () => {
            await client.connect(transport);
            const listed = await client.listTools();
            return { client, transport, tools: listed.tools ?? [], server };
          })(),
          new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(new Error(`MCP server ${server.name} connection timed out after ${MCP_CONNECT_TIMEOUT_MS}ms`));
            }, MCP_CONNECT_TIMEOUT_MS);
          }),
        ]);
        this.connections.set(server.id, connection);
        return connection;
      } catch (error) {
        await closePendingConnection();
        throw error;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    })();

    this.connecting.set(server.id, { configKey, promise: connectionPromise });
    try {
      return await connectionPromise;
    } finally {
      const current = this.connecting.get(server.id);
      if (current?.promise === connectionPromise) this.connecting.delete(server.id);
    }
  }

  async createTools(servers) {
    const neededIds = new Set((servers || []).map((s) => s.id));
    // 关闭不再需要的连接
    for (const [id, connection] of this.connections.entries()) {
      if (!neededIds.has(id)) {
        this.connections.delete(id);
        connection.client.close().catch(() => {});
        connection.transport.close().catch(() => {});
      }
    }

    const results = await Promise.allSettled(servers.map((server) => this._connect(server)));
    const definitions = [];
    const runtime = this;
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const connection = result.value;
      for (const tool of connection.tools) {
        const name = safeToolName(connection.server.name, tool.name);
        const toolName = tool.name;
        const serverName = connection.server.name;
        const serverId = connection.server.id;
        definitions.push(defineTool({
          name,
          label: `${serverName}: ${toolName}`,
          description: tool.description || `Call ${toolName} from the ${serverName} MCP server.`,
          parameters: Type.Unsafe(tool.inputSchema ?? { type: "object", properties: {} }),
          executionMode: "parallel",
          execute: async (_id, params) => {
            const conn = runtime.connections.get(serverId);
            if (!conn) throw new Error(`MCP server ${serverName} 未连接`);
            const response = await conn.client.callTool({ name: toolName, arguments: params });
            const text = resultToText(response);
            if (response?.isError) throw new Error(text);
            return { content: [{ type: "text", text }], details: { server: serverName, tool: toolName } };
          },
        }));
      }
    }
    this.toolDefinitions = definitions;
    const unavailable = results.filter((result) => result.status === "rejected");
    if (unavailable.length) {
      console.warn(`[McpRuntime] ${unavailable.length} MCP server(s) were unavailable while opening the session.`);
    }
    return definitions;
  }

  async getHealth(servers) {
    const checks = (servers || []).map(async (server) => {
      const base = { id: server.id, name: server.name, enabled: server.enabled !== false };
      if (server.enabled === false) return { ...base, status: "disabled", toolCount: 0, latencyMs: null };
      if (server.configError || !server.config) {
        return { ...base, status: "error", toolCount: 0, latencyMs: null, message: "MCP 配置无法读取" };
      }
      const startedAt = Date.now();
      let timeoutId = null;
      try {
        const connection = await Promise.race([
          this._connect(server),
          new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error("连接超时（8 秒）")), 8000); }),
        ]);
        return {
          ...base,
          status: "healthy",
          toolCount: connection.tools.length,
          latencyMs: Date.now() - startedAt,
        };
      } catch (error) {
        return {
          ...base,
          status: "error",
          toolCount: 0,
          latencyMs: Date.now() - startedAt,
          message: healthErrorMessage(error),
        };
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    });
    return Promise.all(checks);
  }
}
