import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MAX_ITEMS = 8;
const MAX_TEXT_LENGTH = 160;
const MAX_EVIDENCE_LENGTH = 500;

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.flatMap((item) => {
    const text = String(item?.text ?? "").replace(/\s+/g, " ").trim();
    const key = text.toLowerCase();
    if (!text || text.length > MAX_TEXT_LENGTH || seen.has(key)) return [];
    seen.add(key);
    return [{ id: newId("plan-item"), text }];
  }).slice(0, MAX_ITEMS);
}

function asResult(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

/** Internal tools for explicit, evidence-backed plan transitions. */
export function createPlanTools(emitUpdate) {
  const emit = (payload) => {
    if (typeof emitUpdate !== "function") throw new Error("计划列表不可用");
    emitUpdate(payload);
  };

  return [
    defineTool({
      name: "plan_create",
      label: "创建执行计划",
      description: "Create a structured plan for a substantial task. Use only in PLAN mode after analyzing the request. Do not use it for simple questions or single small edits.",
      promptSnippet: "plan_create - 创建可追踪的执行计划",
      promptGuidelines: [
        "复杂、长线或多阶段任务在 PLAN 模式下必须调用 plan_create 创建 2 到 8 项计划。",
        "每项必须是可独立验证的动作，不要把多个结果塞进同一项。",
        "简单任务不要创建计划。",
      ],
      executionMode: "serial",
      parameters: Type.Object({
        items: Type.Array(Type.Object({
          text: Type.String({ minLength: 1, maxLength: MAX_TEXT_LENGTH, description: "A short, actionable, independently verifiable task" }),
        }), { minItems: 2, maxItems: MAX_ITEMS }),
      }),
      execute: async (toolCallId, params) => {
        const items = normalizeItems(params.items);
        if (items.length < 2) throw new Error("计划至少需要两项不同的可执行任务");
        const plan = {
          id: newId("plan"), schemaVersion: 2, version: 1, status: "active",
          createdAt: Date.now(), updatedAt: Date.now(),
          items: items.map((item) => ({
            ...item, status: "pending", dependsOn: [], startedAt: null, completedAt: null,
            evidence: [], toolCallIds: [], turnIds: [], blockedReason: null,
          })),
          history: [],
        };
        emit({ action: "create", plan, toolCallId });
        return asResult({ ok: true, planId: plan.id, items: plan.items.map(({ id, text }) => ({ id, text })) });
      },
    }),
    defineTool({
      name: "plan_update",
      label: "更新计划进度",
      description: "Update one item in the active structured plan. Start an item before working on it. Complete an item only after the requested result has been verified, and include concise evidence. Block or skip an item instead of falsely marking it complete.",
      promptSnippet: "plan_update - 逐项更新计划状态",
      promptGuidelines: [
        "执行已有计划时，开始一项前调用 plan_update action=start。",
        "仅在结果可验证时调用 action=complete，并提供 evidence。",
        "遇到失败、权限不足或用户停止时使用 action=block；不再需要的项目使用 action=skip。",
        "绝不因调用了其他工具或回复结束而跳过这些状态更新。",
      ],
      executionMode: "serial",
      parameters: Type.Object({
        planId: Type.String({ minLength: 1, maxLength: 120 }),
        itemId: Type.String({ minLength: 1, maxLength: 120 }),
        action: Type.Union([Type.Literal("start"), Type.Literal("complete"), Type.Literal("block"), Type.Literal("skip")]),
        evidence: Type.Optional(Type.String({ maxLength: MAX_EVIDENCE_LENGTH, description: "Required for complete; concise verification result or artifact" })),
        reason: Type.Optional(Type.String({ maxLength: MAX_EVIDENCE_LENGTH, description: "Required for block or skip" })),
      }),
      execute: async (toolCallId, params) => {
        const action = params.action;
        const evidence = String(params.evidence ?? "").replace(/\s+/g, " ").trim();
        const reason = String(params.reason ?? "").replace(/\s+/g, " ").trim();
        if (action === "complete" && !evidence) throw new Error("完成计划项时必须提供验证证据");
        if ((action === "block" || action === "skip") && !reason) throw new Error("阻塞或跳过计划项时必须说明原因");
        emit({ action, planId: params.planId, itemId: params.itemId, evidence, reason, toolCallId, updatedAt: Date.now() });
        return asResult({ ok: true, planId: params.planId, itemId: params.itemId, action });
      },
    }),
    defineTool({
      name: "plan_replan",
      label: "更新执行计划",
      description: "Replace the remaining plan when requirements or discovered constraints materially change. Preserve completed work where possible and explain why the plan changed.",
      promptSnippet: "plan_replan - 重新规划剩余工作",
      promptGuidelines: [
        "仅在需求变化、发现新约束或原计划无法继续时调用 plan_replan。",
        "保留仍适用的已完成项目；不要因为普通工具成功或回复结束而重新规划。",
      ],
      executionMode: "serial",
      parameters: Type.Object({
        planId: Type.String({ minLength: 1, maxLength: 120 }),
        reason: Type.String({ minLength: 1, maxLength: MAX_EVIDENCE_LENGTH }),
        items: Type.Array(Type.Object({
          text: Type.String({ minLength: 1, maxLength: MAX_TEXT_LENGTH }),
        }), { minItems: 2, maxItems: MAX_ITEMS }),
      }),
      execute: async (toolCallId, params) => {
        const items = normalizeItems(params.items);
        if (items.length < 2) throw new Error("重新规划至少需要两项不同的可执行任务");
        emit({ action: "replan", planId: params.planId, items, reason: params.reason.trim(), toolCallId, updatedAt: Date.now() });
        return asResult({ ok: true, planId: params.planId, action: "replan", items });
      },
    }),
  ];
}

export function isPlanTool(name) {
  return name === "plan_create" || name === "plan_update" || name === "plan_replan";
}
