const LOCAL_RUNTIMES = [
  {
    id: "ollama",
    name: "Ollama",
    endpoint: "http://127.0.0.1:11434",
    modelsPath: "/api/tags",
    providerBaseUrl: "http://127.0.0.1:11434",
    parseModels: (payload) => (payload?.models || []).map((model) => model?.name).filter(Boolean),
  },
  {
    id: "lm-studio",
    name: "LM Studio",
    endpoint: "http://127.0.0.1:1234",
    modelsPath: "/v1/models",
    providerBaseUrl: "http://127.0.0.1:1234",
    parseModels: (payload) => (payload?.data || []).map((model) => model?.id).filter(Boolean),
  },
  {
    id: "llama-cpp",
    name: "llama.cpp",
    endpoint: "http://127.0.0.1:8080",
    modelsPath: "/v1/models",
    providerBaseUrl: "http://127.0.0.1:8080",
    parseModels: (payload) => (payload?.data || []).map((model) => model?.id).filter(Boolean),
  },
];

async function probeRuntime(runtime) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1800);
  try {
    const response = await fetch(`${runtime.endpoint}${runtime.modelsPath}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return { ...runtime, available: false, models: [], detail: `HTTP ${response.status}` };
    const payload = await response.json();
    return { ...runtime, available: true, models: runtime.parseModels(payload), detail: null };
  } catch {
    return { ...runtime, available: false, models: [], detail: "未检测到本地服务" };
  } finally {
    clearTimeout(timer);
  }
}

export async function detectLocalModelRuntimes() {
  return Promise.all(LOCAL_RUNTIMES.map(probeRuntime));
}
