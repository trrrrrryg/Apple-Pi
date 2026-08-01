import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const SEARCH_TIMEOUT_MS = 20_000;

function formatSearchResults(query, results) {
  if (!Array.isArray(results) || results.length === 0) {
    return `未找到与“${query}”相关的网页结果。`;
  }

  return results.map((result, index) => {
    const title = String(result.title || "未命名页面").trim();
    const url = String(result.url || "").trim();
    const content = String(result.content || "").trim();
    return `${index + 1}. ${title}\n链接: ${url}\n摘要: ${content}`;
  }).join("\n\n");
}

function createRequestSignal(signal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("联网搜索超时")), SEARCH_TIMEOUT_MS);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return { signal: controller.signal, dispose: () => clearTimeout(timeout) };
}

/** Resolves the optional key for every call so settings apply immediately. */
export function createTavilyWebSearchTool(getApiKey) {
  return defineTool({
    name: "web_search",
    label: "联网搜索",
    description: "Search the live web with Tavily. Use this for current facts, product documentation, news, and sources. Return cited links in the final answer.",
    promptSnippet: "web_search - 搜索实时网页并返回可引用的结果",
    promptGuidelines: ["遇到时效性或需要核实的信息时，优先使用 web_search，并在回答中附上来源链接。"],
    executionMode: "parallel",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 500, description: "Search query" }),
      max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: "Maximum number of results, default 5" })),
    }),
    execute: async (_toolCallId, params, signal) => {
      const apiKey = await getApiKey();
      const request = createRequestSignal(signal);
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      else headers["X-Tavily-Access-Mode"] = "keyless";

      try {
        const response = await fetch(TAVILY_SEARCH_URL, {
          method: "POST",
          headers,
          signal: request.signal,
          body: JSON.stringify({ query: params.query.trim(), max_results: params.max_results ?? 5, search_depth: "basic" }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(`Tavily 联网搜索失败：${String(payload?.detail || payload?.message || `HTTP ${response.status}`)}`);
        }
        const text = formatSearchResults(params.query.trim(), payload?.results);
        return {
          content: [{ type: "text", text }],
          details: { provider: "tavily", mode: apiKey ? "api_key" : "keyless", resultCount: Array.isArray(payload?.results) ? payload.results.length : 0 },
        };
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? new Error("联网搜索已停止");
        throw error;
      } finally {
        request.dispose();
      }
    },
  });
}
