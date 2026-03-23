import { t } from "../../server/i18n.js";

function maskKey(key = "") {
  if (!key) return "";
  if (key.length <= 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function previewText(value, max = 300) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function debugProviderClient(event, payload = {}) {
  try {
    console.log("[provider-client]", event, payload);
  } catch {}
}

function stripTrailingSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

function stripTrailingHash(url) {
  return stripTrailingSlash(String(url || "").replace(/#+$/, ""));
}

function hasTrailingHash(url) {
  return /#$/.test(String(url || "").trim());
}

function buildApiEndpoint(baseUrl, api) {
  const raw = String(baseUrl || "").trim();
  const disableAppend = hasTrailingHash(raw);
  const normalized = stripTrailingHash(raw);
  let endpoint = normalized;

  if (api === "openai-completions") {
    if (/\/chat\/completions$/i.test(normalized)) {
      endpoint = normalized;
    } else {
      endpoint = disableAppend ? normalized : `${normalized}/chat/completions`;
    }
    debugProviderClient("buildApiEndpoint", { api, raw, normalized, disableAppend, endpoint });
    return endpoint;
  }

  if (api === "anthropic-messages") {
    if (/\/messages$/i.test(normalized)) {
      endpoint = normalized;
    } else {
      endpoint = disableAppend ? normalized : `${normalized}/messages`;
    }
    debugProviderClient("buildApiEndpoint", { api, raw, normalized, disableAppend, endpoint });
    return endpoint;
  }

  if (api === "openai-codex-responses" || api === "openai-responses") {
    if (/\/responses$/i.test(normalized)) {
      endpoint = normalized;
    } else {
      endpoint = disableAppend ? normalized : `${normalized}/responses`;
    }
    debugProviderClient("buildApiEndpoint", { api, raw, normalized, disableAppend, endpoint });
    return endpoint;
  }

  debugProviderClient("buildApiEndpoint", { api, raw, normalized, disableAppend, endpoint });
  return endpoint;
}


function isLocalBaseUrl(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(String(url || ""));
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (!content) return "";
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof content?.text === "string") return content.text;
  return String(content);
}

function normalizeMessages(messages = [], systemPrompt = "") {
  const combined = [];

  if (systemPrompt) {
    combined.push({ role: "system", content: systemPrompt });
  }

  for (const message of messages) {
    if (!message?.role) continue;
    const text = contentToText(message.content);
    if (!text) continue;
    combined.push({ role: message.role, content: text });
  }

  return combined;
}

function buildAnthropicPayload(messages) {
  let system = "";
  const anthropicMessages = [];

  for (const message of messages) {
    if (message.role === "system") {
      system = system ? `${system}\n\n${message.content}` : message.content;
      continue;
    }
    if (message.role !== "user" && message.role !== "assistant") continue;
    anthropicMessages.push({
      role: message.role,
      content: message.content,
    });
  }

  if (anthropicMessages.length === 0) {
    anthropicMessages.push({ role: "user", content: "" });
  }

  return { system, messages: anthropicMessages };
}

function extractOpenAIText(data) {
  const content = data?.choices?.[0]?.message?.content;
  const text = contentToText(content).trim();
  return text || "";
}

function extractResponsesText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];
  for (const item of data?.output || []) {
    if (item?.type !== "message" || item?.role !== "assistant") continue;
    for (const chunk of item.content || []) {
      if (typeof chunk?.text === "string" && chunk.text.trim()) {
        parts.push(chunk.text.trim());
      } else if (typeof chunk?.content === "string" && chunk.content.trim()) {
        parts.push(chunk.content.trim());
      }
    }
  }
  return parts.join("\n").trim();
}

function extractAnthropicText(data) {
  return (data?.content || [])
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

export function buildProviderAuthHeaders(api, apiKey, opts = {}) {
  const allowMissingApiKey = opts.allowMissingApiKey === true;
  debugProviderClient("buildProviderAuthHeaders:start", {
    api,
    allowMissingApiKey,
    hasApiKey: !!apiKey,
    apiKeyMasked: maskKey(apiKey),
  });

  if (!api) {
    throw new Error(t("error.missingApiProtocol"));
  }
  if (!apiKey && !allowMissingApiKey) {
    throw new Error(t("error.missingApiKey"));
  }

  if (api === "anthropic-messages") {
    const headers = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (apiKey) headers["x-api-key"] = apiKey;
    debugProviderClient("buildProviderAuthHeaders:result", {
      api,
      headerKeys: Object.keys(headers),
      hasApiKey: !!apiKey,
    });
    return headers;
  }

  if (api === "openai-completions" || api === "openai-codex-responses" || api === "openai-responses") {
    const headers = {
      "Content-Type": "application/json",
    };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    debugProviderClient("buildProviderAuthHeaders:result", {
      api,
      headerKeys: Object.keys(headers),
      hasApiKey: !!apiKey,
    });
    return headers;
  }

  throw new Error(t("error.unsupportedApiProtocol", { api }));
}

export async function callProviderText({
  api,
  api_key,
  base_url,
  model,
  systemPrompt = "",
  messages = [],
  temperature = 0.3,
  max_tokens = 512,
  timeoutMs = 60_000,
  signal,
}) {
  if (!model) throw new Error(t("error.missingModelId"));
  if (!base_url) throw new Error(t("error.missingBaseUrl"));

  const combinedMessages = normalizeMessages(messages, systemPrompt);
  const baseUrl = stripTrailingHash(base_url);
  const headers = buildProviderAuthHeaders(api, api_key, {
    allowMissingApiKey: isLocalBaseUrl(baseUrl),
  });
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  let endpoint = "";
  let body = null;
  let extractText = () => "";
  let branch = "";

  if (api === "openai-completions") {
    branch = "openai-completions";
    endpoint = buildApiEndpoint(baseUrl, api);
    body = {
      model,
      messages: combinedMessages,
      temperature,
      max_tokens,
      enable_thinking: false,
    };
    extractText = extractOpenAIText;
  } else if (api === "anthropic-messages") {
    branch = "anthropic-messages";
    const anthropic = buildAnthropicPayload(combinedMessages);
    endpoint = buildApiEndpoint(baseUrl, api);
    body = {
      model,
      system: anthropic.system || undefined,
      messages: anthropic.messages,
      temperature,
      max_tokens,
    };
    extractText = extractAnthropicText;
  } else if (api === "openai-codex-responses" || api === "openai-responses") {
    branch = api;
    const responseInput = combinedMessages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));
    endpoint = buildApiEndpoint(baseUrl, api);
    body = {
      model,
      instructions: systemPrompt || undefined,
      input: responseInput,
      temperature,
      max_output_tokens: max_tokens,
    };
    extractText = extractResponsesText;
  } else {
    throw new Error(t("error.unsupportedApiProtocol", { api }));
  }

  debugProviderClient("callProviderText:request", {
    api,
    branch,
    model,
    base_url,
    normalizedBaseUrl: baseUrl,
    endpoint,
    hasApiKey: !!api_key,
    apiKeyMasked: maskKey(api_key),
    messageCount: combinedMessages.length,
    hasSystemPrompt: !!systemPrompt,
    temperature,
    max_tokens,
    bodyPreview: previewText(body),
  });

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: requestSignal,
  });

  const rawText = await res.text();
  debugProviderClient("callProviderText:response", {
    api,
    branch,
    model,
    endpoint,
    status: res.status,
    ok: res.ok,
    rawPreview: previewText(rawText),
  });

  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    debugProviderClient("callProviderText:invalid-json", {
      api,
      branch,
      model,
      endpoint,
      status: res.status,
      rawPreview: previewText(rawText),
    });
    throw new Error(t("error.llmInvalidJson", { status: res.status }));
  }

  if (!res.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      rawText ||
      `HTTP ${res.status}`;
    debugProviderClient("callProviderText:error-response", {
      api,
      branch,
      model,
      endpoint,
      status: res.status,
      message: previewText(message),
    });
    throw new Error(message);
  }

  const text = extractText(data);
  if (!text) {
    debugProviderClient("callProviderText:empty-response", {
      api,
      branch,
      model,
      endpoint,
      status: res.status,
      dataPreview: previewText(data),
    });
    throw new Error(t("error.llmEmptyResponse"));
  }

  debugProviderClient("callProviderText:success", {
    api,
    branch,
    model,
    endpoint,
    status: res.status,
    textPreview: previewText(text),
    textLength: text.length,
  });

  return text;
}
