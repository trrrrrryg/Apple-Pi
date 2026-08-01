import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "..");
const bin = path.join(appDir, "node_modules", "electron", "dist", "electron.exe");
const child = spawn(bin, [".", "--remote-debugging-port=9995"], { cwd: appDir, stdio: "pipe" });
const get = (u) => new Promise((res, rej) => { http.get(u, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => res(JSON.parse(d))); }).on("error", rej); });
async function waitPage() { for (let i = 0; i < 40; i++) { try { const l = await get("http://127.0.0.1:9995/json/list"); const p = l.find((t) => t.type === "page" && t.url.includes("index.html")); if (p) return p; } catch {} await new Promise((r) => setTimeout(r, 500)); } throw new Error("not ready"); }
async function main() {
  const page = await waitPage();
  const WebSocket = (await import("ws")).default;
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise((r) => ws.once("open", r));
  let id = 0; const pend = new Map();
  const cdp = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
  await cdp("Runtime.enable"); await cdp("Page.enable");
  await new Promise((r) => setTimeout(r, 3500));
  const evalJs = async (e) => (await cdp("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }))?.result?.value;
  const shot = async (n) => { const s = await cdp("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(appDir, "scripts", n), Buffer.from(s.data, "base64")); };

  // 发 2 个任务让面板有内容
  await evalJs(`(async()=>{const i=document.querySelector('#input');i.value='介绍 Vue';document.querySelector('#btn-send').click();})()`);
  let s = null;
  for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 1000)); s = await evalJs("window.piAgent.getState()"); if (s && !s.isStreaming && s.messageCount > 0) break; }
  await evalJs(`(async()=>{const i=document.querySelector('#input');i.value='介绍 React';document.querySelector('#btn-send').click();})()`);
  for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 1000)); s = await evalJs("window.piAgent.getState()"); if (s && !s.isStreaming && s.messageCount > 2) break; }
  await new Promise((r) => setTimeout(r, 300));

  // 折叠侧边栏（面板展开会先收面板再收侧边栏）
  await evalJs(`document.querySelector('#btn-toggle-sidenav').click()`);
  await new Promise((r) => setTimeout(r, 800)); // 等两步动画都完成
  await shot("align-collapsed.png");

  // 测量折叠后任务圆点与菜单图标的水平中心是否对齐
  const align = await evalJs(`(()=>{
    const menuIcon = document.querySelector('#sidenav.collapsed .menu-item .menu-icon');
    const dotWrap = document.querySelector('#sidenav.collapsed .tp-item .tp-dot-wrap');
    if(!menuIcon || !dotWrap) return {err:'not found'};
    const mi = menuIcon.getBoundingClientRect();
    const dw = dotWrap.getBoundingClientRect();
    return { menuIconCenterX: Math.round(mi.left + mi.width/2), dotWrapCenterX: Math.round(dw.left + dw.width/2), diff: Math.abs(Math.round(mi.left+mi.width/2) - Math.round(dw.left+dw.width/2)) };
  })()`);
  console.log("折叠对齐测量:", JSON.stringify(align));

  console.log("done");
  ws.close();
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { child.kill(); setTimeout(() => process.exit(process.exitCode ?? 0), 1000); });
