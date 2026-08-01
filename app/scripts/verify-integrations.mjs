import { app } from "electron";
import { IntegrationService } from "../main/integration-service.js";

await app.whenReady();

const integrations = new IntegrationService();
const preview = await integrations.getImportPreview(true);
const mock = {
  _readSettings: async () => ({ firstImportChecked: false, skills: [], mcpServers: [] }),
  scanCandidates: async () => ({
    skills: [
      { id: "skill-claude", name: "Claude skill", source: "Claude Code", enabled: true },
      { id: "skill-open", name: "OpenCode skill", source: "OpenCode", enabled: true },
    ],
    mcpServers: [
      { id: "mcp-claude", name: "Claude MCP", source: "Claude Code", type: "stdio", enabled: true, config: { type: "stdio", command: "node" } },
      { id: "mcp-open", name: "OpenCode MCP", source: "OpenCode", type: "stdio", enabled: true, config: { type: "stdio", command: "node" } },
    ],
  }),
  _encryptConfig: () => "test-only",
  _writeSettings: async (settings) => { mock.saved = settings; },
  getIntegrations: async () => ({ skills: mock.saved.skills, mcpServers: mock.saved.mcpServers }),
};
await IntegrationService.prototype.importCandidates.call(mock, ["OpenCode"]);
if (mock.saved.skills.length !== 1 || mock.saved.skills[0].source !== "OpenCode" || mock.saved.mcpServers.length !== 1 || mock.saved.mcpServers[0].source !== "OpenCode") {
  throw new Error("Agent-specific integration import filter failed");
}

process.stderr.write(`${JSON.stringify({
  shouldPrompt: preview.shouldPrompt,
  skillCount: preview.skills.length,
  mcpServerCount: preview.mcpServers.length,
})}\n`);

process.exit(0);
