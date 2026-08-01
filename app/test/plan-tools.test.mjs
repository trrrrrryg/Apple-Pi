import assert from "node:assert/strict";
import test from "node:test";
import { createPlanTools, isPlanTool } from "../main/plan-tools.js";

function toolByName(tools, name) {
  return tools.find((tool) => tool.name === name);
}

test("plan_create emits a normalized structured plan", async () => {
  const updates = [];
  const create = toolByName(createPlanTools((update) => updates.push(update)), "plan_create");
  const result = await create.execute("call-create", {
    items: [{ text: "分析现有模块" }, { text: "实现并验证变更" }],
  });

  assert.equal(updates.length, 1);
  assert.equal(updates[0].action, "create");
  assert.equal(updates[0].toolCallId, "call-create");
  assert.equal(updates[0].plan.schemaVersion, 2);
  assert.deepEqual(updates[0].plan.items.map((item) => item.status), ["pending", "pending"]);
  assert.ok(updates[0].plan.items.every((item) => item.id && Array.isArray(item.evidence)));
  assert.equal(JSON.parse(result.content[0].text).planId, updates[0].plan.id);
});

test("plan_update requires evidence for completion and a reason for non-completion", async () => {
  const updates = [];
  const update = toolByName(createPlanTools((event) => updates.push(event)), "plan_update");

  await assert.rejects(
    update.execute("call-complete", { planId: "plan-1", itemId: "item-1", action: "complete" }),
    /验证证据/
  );
  await assert.rejects(
    update.execute("call-block", { planId: "plan-1", itemId: "item-1", action: "block" }),
    /说明原因/
  );

  await update.execute("call-complete", {
    planId: "plan-1", itemId: "item-1", action: "complete", evidence: "npm test 通过",
  });
  assert.deepEqual(updates[0], {
    action: "complete", planId: "plan-1", itemId: "item-1", evidence: "npm test 通过", reason: "", toolCallId: "call-complete",
    updatedAt: updates[0].updatedAt,
  });
  assert.equal(typeof updates[0].updatedAt, "number");
});

test("plan_replan emits replacement items and plan tool detection is explicit", async () => {
  const updates = [];
  const replan = toolByName(createPlanTools((event) => updates.push(event)), "plan_replan");
  await replan.execute("call-replan", {
    planId: "plan-1",
    reason: "发现接口需要额外鉴权步骤",
    items: [{ text: "补充鉴权配置" }, { text: "验证端到端流程" }],
  });
  assert.equal(updates[0].action, "replan");
  assert.equal(updates[0].items.length, 2);
  assert.ok(updates[0].items.every((item) => item.id));
  assert.equal(isPlanTool("plan_create"), true);
  assert.equal(isPlanTool("plan_update"), true);
  assert.equal(isPlanTool("plan_replan"), true);
  assert.equal(isPlanTool("web_search"), false);
});
