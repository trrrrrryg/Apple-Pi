function normalizeMessageHistory(messages, transformUserText = (text) => text) {
  return messages.flatMap((message) => {
    if (message?.role === "user") {
      const text = typeof message.content === "string"
        ? message.content
        : (message.content ?? []).filter((part) => part?.type === "text").map((part) => part.text).join("\n");
      const displayText = transformUserText(text);
      return displayText ? [{ role: "user", text: displayText }] : [];
    }
    if (message?.role === "assistant") {
      const entries = [];
      for (const part of Array.isArray(message.content) ? message.content : []) {
        if (part?.type === "thinking" && part.thinking) entries.push({ role: "thinking", text: part.thinking });
        else if (part?.type === "toolCall") entries.push({ id: part.id || `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: "toolCall", name: part.name, args: part.arguments ?? {} });
        else if (part?.type === "text" && part.text) entries.push({ role: "assistant", text: part.text, usage: message.usage ?? null });
      }
      return entries;
    }
    if (message?.role === "toolResult") {
      const text = (message.content ?? []).filter((part) => part?.type === "text").map((part) => part.text).join("\n");
      return [{
        id: message.toolCallId ?? `t-${Date.now()}`,
        role: "toolResult",
        name: message.toolName ?? "tool",
        result: text,
        isError: message.isError ?? false,
      }];
    }
    return [];
  });
}

export function extractSessionEvents(raw) {
  const events = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (start < 0) {
      if (/\s/.test(character)) continue;
      if (character === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try { events.push(JSON.parse(raw.slice(start, index + 1))); } catch { /* Ignore a partially written record. */ }
        start = -1;
      }
    }
  }
  return events;
}

export function historyFromSessionEvents(events, transformUserText) {
  const messages = events
    .filter((event) => event?.type === "message" && event.message)
    .map((event) => event.message);
  return normalizeMessageHistory(messages, transformUserText);
}

export function historyFromMessages(messages, transformUserText) {
  return normalizeMessageHistory(Array.isArray(messages) ? messages : [], transformUserText);
}
