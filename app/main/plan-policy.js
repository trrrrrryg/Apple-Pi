export const PLAN_POLICIES = new Set(["explicit", "smart", "always"]);

const EXPLICIT_PLAN_PATTERN = /(?:\u8ba1\u5212|\u89c4\u5212|\u62c6\u89e3|\u5f85\u529e|\u4efb\u52a1\u5217\u8868|\u8def\u7ebf\u56fe|\u5206\u6b65\u9aa4|\u6267\u884c\u6b65\u9aa4|\u957f\u671f|\u957f\u7ebf|\u591a\u6b65|(?:\u5236\u5b9a|\u8bbe\u8ba1|\u751f\u6210|\u5217\u51fa)\u65b9\u6848|\bplan\b|\btodo\b|\broadmap\b|break\s+down|step[- ]by[- ]step)/i;
const PLAN_ONLY_PATTERN = /(?:\u53ea|\u4ec5|\u5148|\u6682\u4e0d|\u4e0d\u8981|\u65e0\u9700).{0,18}(?:\u6267\u884c|\u4fee\u6539|\u5b9e\u73b0|\u52a8\u624b|\u63d0\u4ea4|\u90e8\u7f72)|(?:\u8ba1\u5212|\u89c4\u5212|\u65b9\u6848).{0,18}(?:\u5373\u53ef|\u5c31\u884c|\u4e0d\u8981\u6267\u884c)/i;
const IMPLEMENTATION_PATTERN = /(?:\u521b\u5efa|\u5236\u4f5c|\u5f00\u53d1|\u5b9e\u73b0|\u91cd\u6784|\u8fc1\u79fb|\u90e8\u7f72|\u4f18\u5316|\u4fee\u590d|\u8bbe\u8ba1|\u6784\u5efa|\u6539\u9020|\u66ff\u6362|\u8c03\u6574|\u5b8c\u5584|\bbuild\b|\bcreate\b|\bdevelop\b|\bimplement\b|\brefactor\b|\bmigrate\b|\bdeploy\b|\boptimi[sz]e\b|\brepair\b|\bdesign\b)/ig;
const ANALYSIS_PATTERN = /(?:\u5206\u6790|\u5ba1\u67e5|\u6392\u67e5|\u8c03\u7814|\u68c0\u67e5|\u68b3\u7406|\u8bc4\u4f30|\u6d4b\u8bd5|\u5bf9\u6bd4|\u6838\u5bf9|\banaly[sz]e\b|\baud\it\b|\binvestigate\b|\breview\b)/ig;
const DELIVERY_PATTERN = /(?:\u6d4b\u8bd5|\u9a8c\u8bc1|\u6253\u5305|\u53d1\u5e03|\u4ea4\u4ed8|\u68c0\u67e5|\u786e\u8ba4|\u63d0\u4ea4|\u62a5\u544a|\u5efa\u8bae|\u6587\u6863|\btest\b|\bvalidate\b|\bpackage\b|\bpublish\b|\bship\b|\brelease\b|\breport\b)/ig;
const ARTIFACT_PATTERN = /(?:\u9879\u76ee|\u8f6f\u4ef6|\u5e94\u7528|\u7f51\u7ad9|\u524d\u7aef|\u540e\u7aef|\u7cfb\u7edf|\u6a21\u5757|\u529f\u80fd|\u6570\u636e\u5e93|\u63a5\u53e3|\u670d\u52a1|\u9875\u9762|\u754c\u9762|\u7ec4\u4ef6|\u6d41\u7a0b|\u6837\u5f0f|\u5e93|\u5de5\u7a0b|\bproject\b|\bapp\b|\bsoftware\b|\bwebsite\b|\bfrontend\b|\bbackend\b|\bsystem\b|\bmodule\b|\bfeature\b|\bdatabase\b|\bapi\b)/i;
const MULTI_PHASE_PATTERN = /(?:\u5e76\u4e14|\u540c\u65f6|\u7136\u540e|\u4e4b\u540e|\u4ee5\u53ca|\u5305\u62ec|\u5206\u522b|\u5404\u81ea|\u591a\u4e2a|\u591a\u9879|\u7b2c\u4e00|\u7b2c\u4e8c|\u7b2c\u4e09|\u5e76\u63d0\u51fa|\u5e76\u4fee\u590d|\u5e76\u5b8c\u6210|\band\b|\balso\b|\bthen\b|\bafter\b|\binclude\b|\bmultiple\b|\bfirst\b.*\bthen\b)/i;
const LARGE_SCOPE_PATTERN = /(?:\u5b8c\u6574|\u5168\u5957|\u4ece\u96f6|\u5168\u6d41\u7a0b|\u751f\u4ea7\u7ea7|\u6240\u6709|\u6574\u4e2a|\u5168\u90e8|\u6279\u91cf|\bcomplete\b|\bfull\b|\bend[- ]to[- ]end\b|\bproduction\b|\ball\b)/i;

function countMatches(pattern, value) {
  return [...value.matchAll(pattern)].length;
}

function normalizePolicy(policy) {
  return PLAN_POLICIES.has(policy) ? policy : "smart";
}

/**
 * Decide whether the host must create a structured plan before handling a
 * message. This policy is intentionally independent from tool permissions.
 */
export function classifyPlanIntent(text, policy = "smart") {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  const normalizedPolicy = normalizePolicy(policy);
  if (!value) return { shouldPlan: false, kind: "none", reason: "empty", policy: normalizedPolicy };

  const lower = value.toLowerCase();
  const explicit = EXPLICIT_PLAN_PATTERN.test(lower);
  if (explicit) {
    return {
      shouldPlan: true,
      kind: PLAN_ONLY_PATTERN.test(lower) ? "plan_only" : "explicit",
      reason: "explicit_request",
      policy: normalizedPolicy,
    };
  }

  if (normalizedPolicy === "explicit") {
    return { shouldPlan: false, kind: "none", reason: "explicit_policy", policy: normalizedPolicy };
  }

  const implementationCount = countMatches(IMPLEMENTATION_PATTERN, lower);
  const analysisCount = countMatches(ANALYSIS_PATTERN, lower);
  const deliveryCount = countMatches(DELIVERY_PATTERN, lower);
  const actionKinds = Number(implementationCount > 0) + Number(analysisCount > 0) + Number(deliveryCount > 0);
  const artifact = ARTIFACT_PATTERN.test(lower);
  const multiPhase = MULTI_PHASE_PATTERN.test(lower);
  const largeScope = LARGE_SCOPE_PATTERN.test(lower);
  const multipleActions = implementationCount + analysisCount + deliveryCount >= 2;
  const hasAction = actionKinds > 0;

  const substantial =
    (hasAction && largeScope) ||
    (artifact && actionKinds >= 2) ||
    (artifact && implementationCount > 0 && multiPhase) ||
    (multipleActions && (multiPhase || value.length >= 16)) ||
    (actionKinds >= 3 && value.length >= 12);

  if (normalizedPolicy === "always" ? hasAction : substantial) {
    return { shouldPlan: true, kind: "substantial", reason: "task_scope", policy: normalizedPolicy };
  }
  return { shouldPlan: false, kind: "none", reason: "simple_request", policy: normalizedPolicy };
}

export function createDraftPlanItems() {
  return [
    { text: "梳理任务目标、范围与验收标准" },
    { text: "分析现状并细化可执行步骤" },
    { text: "验证计划覆盖范围并确认下一步" },
  ];
}

export function isPlanOnlyIntent(intent) {
  return intent?.kind === "plan_only";
}
