import assert from "node:assert/strict";
import test from "node:test";
import { classifyPlanIntent, createDraftPlanItems } from "../main/plan-policy.js";
import { createStructuredPlan } from "../main/plan-tools.js";

test("explicit planning is independent from the automatic planning policy", () => {
  const result = classifyPlanIntent("请先生成完整的执行计划，暂时不要修改文件", "explicit");
  assert.equal(result.shouldPlan, true);
  assert.equal(result.kind, "plan_only");
  assert.equal(result.reason, "explicit_request");
});

test("smart policy catches common multi-stage Chinese tasks", () => {
  const cases = [
    "把所有页面统一改成深色风格，之后修复响应式问题",
    "审查这个项目并提出改进建议",
    "修复登录问题、补充测试并打包发布",
    "开发一个完整的网站，包含前端、后端、数据库和部署",
  ];
  for (const text of cases) {
    const result = classifyPlanIntent(text, "smart");
    assert.equal(result.shouldPlan, true, text);
    assert.equal(result.kind, "substantial", text);
  }
});

test("simple requests stay unplanned unless planning is explicitly requested", () => {
  assert.equal(classifyPlanIntent("解释这段代码的作用", "smart").shouldPlan, false);
  assert.equal(classifyPlanIntent("修复一个拼写", "explicit").shouldPlan, false);
  assert.equal(classifyPlanIntent("修复一个拼写", "always").shouldPlan, true);
});

test("host draft plan is renderer-compatible and awaits model refinement", () => {
  const plan = createStructuredPlan(createDraftPlanItems(), { status: "draft" });
  assert.equal(plan.status, "draft");
  assert.equal(plan.items.length, 3);
  assert.ok(plan.items.every((item) => item.status === "pending" && item.id));
});
