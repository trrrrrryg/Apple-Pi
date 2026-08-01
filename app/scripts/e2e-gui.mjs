// E2E：用 CDP 驱动真实 Electron 窗口，验证渲染进程事件解析 + 截图
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "..");
const electronBin = path.join(appDir, "node_modules", "electron", "dist", "electron.exe");

const child = spawn(electronBin, [".", "--remote-debugging-port=9222"], {
  cwd: appDir,
  stdio: "inherit",
});

const get = (url) =>
  new Promise((res, rej) => {
    http.get(url, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => res(JSON.parse(d)));
    }).on("error", rej);
  });

async function waitForDebugger(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const list = await get("http://127.0.0.1:9222/json/list");
      const page = list.find((t) => t.type === "page" && t.url.includes("index.html"));
      if (page) return page;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("debugger not ready");
}

async function main() {
  const page = await waitForDebugger();
  console.log("✅ 找到页面:", page.url);

  const WebSocket = (await import("ws")).default;
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise((r) => ws.once("open", r));

  let id = 0;
  const pending = new Map();
  const cdp = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      const { res } = pending.get(msg.id);
      pending.delete(msg.id);
      res(msg.result);
    }
  });

  await cdp("Runtime.enable");
  await cdp("Page.enable");

  // 等待 SDK 会话创建完成（渲染进程 init 中 createSession）
  await new Promise((r) => setTimeout(r, 4000));

  const evalJs = async (expr) => {
    const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    return r?.result?.value;
  };

  // 检查 piAgent 桥是否就绪
  const bridge = await evalJs("typeof window.piAgent");
  console.log("✅ window.piAgent =", bridge);

  const sessionState = await evalJs("window.piAgent.getState()");
  console.log("✅ 会话状态:", JSON.stringify(sessionState));

  // 在页面里发一个真实 prompt（触发工具调用），并等待 agent_end
  console.log("▶ 发送 prompt: 用 ls 列出当前目录…");
  await evalJs(`
    (async () => {
      const input = document.querySelector('#input');
      input.value = 'Use the ls tool to list the current directory, then briefly tell me what folders exist.';
      document.querySelector('#btn-send').click();
    })()
  `);

  // 轮询直到 idle（agent_end）
  let finalState = null;
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    finalState = await evalJs("window.piAgent.getState()");
    if (finalState && !finalState.isStreaming && finalState.messageCount > 0) break;
  }
  console.log("✅ 最终状态:", JSON.stringify(finalState));

  // 检查渲染出的 DOM：用户气泡 / 工具卡片 / assistant 气泡
  const dom = await evalJs(`({
    userBubbles: document.querySelectorAll('.msg.user').length,
    assistantBubbles: document.querySelectorAll('.msg.assistant').length,
    toolCards: document.querySelectorAll('.tool-card').length,
    toolNames: [...document.querySelectorAll('.tool-card .tool-name')].map(e => e.textContent),
    toolStatuses: [...document.querySelectorAll('.tool-card .tool-status')].map(e => e.textContent),
    lastAssistantText: (() => { const a=[...document.querySelectorAll('.msg.assistant .text')]; return a.length? a[a.length-1].textContent.slice(0,200): null; })(),
  })`);
  console.log("✅ DOM 渲染结果:", JSON.stringify(dom, null, 2));

  // 截图
  const shot = await cdp("Page.captureScreenshot", { format: "png" });
  const outPath = path.join(appDir, "scripts", "e2e-screenshot.png");
  fs.writeFileSync(outPath, Buffer.from(shot.data, "base64"));
  console.log("✅ 截图已保存:", outPath);

  ws.close();
}

main()
  .catch((e) => { console.error("❌", e); process.exitCode = 1; })
  .finally(() => { child.kill(); setTimeout(() => process.exit(process.exitCode ?? 0), 1000); });
