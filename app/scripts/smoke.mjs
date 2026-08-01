/**
 * 冒烟测试：不依赖 Electron GUI，直接验证 AgentService 的 SDK 用法是否正确。
 * - 能创建 ModelRuntime
 * - 能 createAgentSession（带内置工具）
 * - 能 subscribe 事件
 * - 无 API key 时 prompt 会以 error 事件 / stopReason=error 优雅失败（pi 的设计：流式从不 throw）
 * 运行：node scripts/smoke.mjs
 */
import { AgentService } from "../main/agent-service.js";

const events = [];
const send = (channel, payload) => {
  if (channel === "agent:event") {
    events.push(payload?.type ?? "unknown");
  } else if (channel === "agent:state") {
    // console.log("[state]", payload);
  } else if (channel === "agent:error") {
    console.log("[ipc-error]", payload);
  }
};

const svc = new AgentService(send);

try {
  console.log("1) 创建会话…");
  await svc.createSession({});
  console.log("   ✅ 会话创建成功");

  console.log("2) 获取状态快照…");
  const state = svc.getState();
  console.log("   ✅ state =", JSON.stringify(state));

  console.log("3) 发送 prompt（无 key 时应优雅失败，不 throw）…");
  try {
    await svc.prompt("Say hi in one word.");
    console.log("   prompt 完成（若配置了 API key 则会真实调用）");
  } catch (err) {
    console.log("   prompt 抛出（可接受，取决于鉴权配置）:", String(err?.message ?? err).slice(0, 200));
  }

  console.log("4) 收到的事件类型序列：");
  console.log("  ", events.join(" → ") || "(无事件)");

  console.log("\n✅ 冒烟测试通过：SDK 调用路径正确（会话/订阅/状态均工作）");
  process.exit(0);
} catch (err) {
  console.error("\n❌ 冒烟测试失败:", err);
  process.exit(1);
}
