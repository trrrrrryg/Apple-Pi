import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MAX_MERMAID_LENGTH = 12_000;
const DIAGRAM_TYPES = ["flowchart", "sequence", "class", "state", "er", "gantt", "mindmap", "usecase"];
const TYPE_PATTERNS = {
  flowchart: /^(?:flowchart|graph)\b/i,
  sequence: /^sequenceDiagram\b/i,
  class: /^classDiagram\b/i,
  state: /^stateDiagram(?:-v2)?\b/i,
  er: /^erDiagram\b/i,
  gantt: /^gantt\b/i,
  mindmap: /^mindmap\b/i,
  // Mermaid has no native usecaseDiagram grammar. Use a flowchart representation
  // so actor-to-use-case relationships remain portable across Mermaid versions.
  usecase: /^(?:flowchart|graph)\b/i,
};

function normalizeCode(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function validateDiagram(diagramType, code) {
  if (!DIAGRAM_TYPES.includes(diagramType)) throw new Error("不支持的 Mermaid 图表类型");
  if (!code) throw new Error("Mermaid 代码不能为空");
  if (code.length > MAX_MERMAID_LENGTH) throw new Error(`Mermaid 代码不能超过 ${MAX_MERMAID_LENGTH} 个字符`);
  if (/<\/?script\b|javascript\s*:/i.test(code)) throw new Error("Mermaid 代码包含不安全内容");
  if (!TYPE_PATTERNS[diagramType].test(code)) {
    throw new Error(`代码开头必须是与 ${diagramType} 对应的 Mermaid 图表声明`);
  }
}

export function createMermaidDiagramTool() {
  return defineTool({
    name: "create_mermaid_diagram",
    label: "生成 Mermaid 图表",
    description: "Create a Mermaid diagram that the desktop client renders inline. Use this whenever the user asks for a flowchart, architecture diagram, sequence diagram, state diagram, ER diagram, Gantt chart, relationship diagram, mind map, or use case diagram. Mermaid does not support native usecaseDiagram syntax: use diagramType usecase with flowchart source instead.",
    promptSnippet: "create_mermaid_diagram - 生成并在对话中渲染 Mermaid 图表",
    promptGuidelines: [
      "当用户要求流程图、架构图、时序图、状态图、关系图、甘特图或思维导图时，必须调用 create_mermaid_diagram。",
      "当用户要求用例图时，使用 diagramType: usecase，并用 flowchart LR 代码表示：参与者使用方括号节点，用例使用圆角或椭圆节点；绝对不要输出 usecaseDiagram。",
      "调用此工具时必须传入完整、可独立渲染的 Mermaid 代码；不要在最终回复中重复输出 Mermaid 代码块。",
    ],
    executionMode: "serial",
    parameters: Type.Object({
      title: Type.Optional(Type.String({ maxLength: 120, description: "Optional concise diagram title" })),
      diagramType: Type.Union(DIAGRAM_TYPES.map((type) => Type.Literal(type)), { description: "Mermaid diagram type" }),
      code: Type.String({ minLength: 3, maxLength: MAX_MERMAID_LENGTH, description: "Complete Mermaid source code" }),
    }),
    execute: async (_toolCallId, params) => {
      const code = normalizeCode(params.code);
      validateDiagram(params.diagramType, code);
      const title = String(params.title ?? "").trim().slice(0, 120);
      return {
        content: [{ type: "text", text: title ? `已生成图表：${title}` : "已生成 Mermaid 图表" }],
        details: { diagramType: params.diagramType, title, code },
      };
    },
  });
}
