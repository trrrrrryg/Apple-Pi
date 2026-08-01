import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

function asToolResult(result) {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

/** Browser operations run in the renderer-owned webview through a narrow bridge. */
export function createBrowserAutomationTools(runBrowserAutomation) {
  const execute = async (action, payload = {}) => {
    if (typeof runBrowserAutomation !== "function") throw new Error("浏览器自动化工作区不可用");
    return runBrowserAutomation(action, payload);
  };
  return [
    defineTool({
      name: "browser_open",
      label: "打开浏览器页面",
      description: "Open a URL or search query in the desktop browser workspace.",
      parameters: Type.Object({ url: Type.String({ description: "URL or search query to open" }) }),
      execute: async (_id, params) => asToolResult(await execute("navigate", { url: params.url })),
    }),
    defineTool({
      name: "browser_inspect",
      label: "读取浏览器页面",
      description: "Read the current page title, URL, visible text, and a compact list of interactive elements.",
      parameters: Type.Object({}),
      executionMode: "parallel",
      execute: async () => asToolResult(await execute("inspect")),
    }),
    defineTool({
      name: "browser_click",
      label: "点击网页元素",
      description: "Click one element in the desktop browser workspace using a CSS selector.",
      parameters: Type.Object({ selector: Type.String({ description: "CSS selector for the target element" }) }),
      execute: async (_id, params) => asToolResult(await execute("click", { selector: params.selector })),
    }),
    defineTool({
      name: "browser_type",
      label: "填写网页文本",
      description: "Fill an input, textarea, or contenteditable element in the desktop browser workspace using a CSS selector.",
      parameters: Type.Object({
        selector: Type.String({ description: "CSS selector for the editable element" }),
        text: Type.String({ description: "Text to enter" }),
      }),
      execute: async (_id, params) => asToolResult(await execute("type", params)),
    }),
    defineTool({
      name: "browser_scroll",
      label: "滚动浏览器页面",
      description: "Scroll the desktop browser workspace to the bottom of the current page.",
      parameters: Type.Object({}),
      execute: async () => asToolResult(await execute("scroll")),
    }),
  ];
}
