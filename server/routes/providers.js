/**
 * 供应商管理 REST 路由
 */
import { getAllProviders } from "../../lib/memory/config-loader.js";
import { buildProviderAuthHeaders, buildModelEndpoints, buildApiEndpoint, callProviderText } from "../../lib/llm/provider-client.js";

function debugProviderRoute(event, payload = {}) {
  try {
    console.log("[provider-route]", event, payload);
  } catch {}
}

async function fetchFirstAvailableModelEndpoint(urls, fetchOptions) {
  let lastError = null;
  const candidates = [...new Set(urls)].filter(Boolean);
  debugProviderRoute("fetchFirstAvailableModelEndpoint:start", { candidates });

  for (const url of candidates) {
    try {
      debugProviderRoute("fetchFirstAvailableModelEndpoint:try", { url });
      const res = await fetch(url, fetchOptions);
      debugProviderRoute("fetchFirstAvailableModelEndpoint:response", {
        url,
        status: res.status,
        statusText: res.statusText,
        ok: res.ok,
      });
      if (res.ok) {
        return { ok: true, url, res };
      }
      lastError = new Error(`HTTP ${res.status}: ${res.statusText}`);
    } catch (err) {
      debugProviderRoute("fetchFirstAvailableModelEndpoint:error", {
        url,
        error: err?.message || String(err),
      });
      lastError = err;
    }
  }
  debugProviderRoute("fetchFirstAvailableModelEndpoint:failed", {
    candidates,
    lastError: lastError?.message || String(lastError),
  });
  throw lastError || new Error("No model endpoint available");
}

function maskKey(key) {
  if (!key || key.length < 8) return key ? "***" : "";
  return key.slice(0, 4) + "..." + key.slice(-4);
}

export default async function providersRoute(app, { engine }) {

  // ── Provider Summary ──

  /**
   * 统一概览：合并 providers.yaml + OAuth status + favorites + SDK 模型
   * 前端新 ProvidersTab 的核心数据源
   */
  app.get("/api/providers/summary", async () => {
    const providers = getAllProviders(engine.configPath);

    // ProviderRegistry 作为 OAuth 判断的权威来源
    const provRegistry = engine.providerRegistry;

    // OAuth 白名单：authJsonKey 集合（auth.json 中的 key，如 minimax / openai-codex）
    const ALLOWED_OAUTH = provRegistry
      ? new Set(provRegistry.getOAuthProviderIds().map(id => provRegistry.getAuthJsonKey(id)))
      : new Set(["minimax", "openai-codex"]); // fallback

    // authJsonKey → registryId 映射（如 minimax → minimax-oauth）
    const authKeyToRegistryId = new Map();
    if (provRegistry) {
      for (const id of provRegistry.getOAuthProviderIds()) {
        const authKey = provRegistry.getAuthJsonKey(id);
        if (authKey !== id) authKeyToRegistryId.set(authKey, id);
      }
    }

    const favorites = engine.readFavorites();
    const favSet = new Set(favorites);

    // OAuth provider 登录状态（Pi SDK AuthStorage，key 是 authJsonKey 如 minimax）
    const oauthProviders = engine.authStorage?.getOAuthProviders?.() || [];
    const oauthLoginMap = new Map();
    for (const p of oauthProviders) {
      const cred = engine.authStorage.get(p.id);
      oauthLoginMap.set(p.id, { name: p.name, loggedIn: cred?.type === "oauth" });
    }

    // OAuth 自定义模型
    const oauthCustom = engine.preferences.getOAuthCustomModels();

    // SDK 可用模型（含 OAuth 注入的）
    const sdkModels = engine.availableModels || [];
    const sdkByProvider = new Map();
    for (const m of sdkModels) {
      if (!sdkByProvider.has(m.provider)) sdkByProvider.set(m.provider, []);
      sdkByProvider.get(m.provider).push(m.id);
    }

    const result = {};

    // 判断 provider 是否为 OAuth 类型（优先用 ProviderRegistry，回退到 oauthLoginMap）
    function isOAuthProvider(name) {
      if (provRegistry) {
        // 直接匹配 registry ID（如 minimax-oauth）
        if (provRegistry.isOAuth(name)) return true;
        // 或者 name 是某个 OAuth provider 的 authJsonKey（如 minimax）
        const registryId = authKeyToRegistryId.get(name);
        if (registryId && provRegistry.isOAuth(registryId)) return true;
        return false;
      }
      return oauthLoginMap.has(name);
    }

    // 获取 OAuth 登录信息（oauthLoginMap 用 authJsonKey 索引）
    function getOAuthLoginInfo(name) {
      if (oauthLoginMap.has(name)) return oauthLoginMap.get(name);
      // name 可能是 registry ID（如 minimax-oauth），查对应的 authJsonKey
      if (provRegistry) {
        const authKey = provRegistry.getAuthJsonKey(name);
        if (authKey !== name && oauthLoginMap.has(authKey)) return oauthLoginMap.get(authKey);
      }
      return null;
    }

    // Coding Plan 判断（id 以 -coding 结尾的 provider）
    function isCodingPlan(name) {
      return name.endsWith("-coding");
    }

    // 先处理 providers.yaml 中的 provider（保持顺序）
    for (const [name, p] of Object.entries(providers)) {
      const isOAuth = isOAuthProvider(name);
      const oauthInfo = getOAuthLoginInfo(name);
      const sdkIds = sdkByProvider.get(name) || [];
      // 合并：providers.yaml models + SDK 发现的模型
      const allModels = [...new Set([...(p.models || []), ...sdkIds])];
      const customModels = oauthCustom[name] || [];

      result[name] = {
        type: isOAuth ? "oauth" : "api-key",
        display_name: oauthInfo?.name || name,
        base_url: p.base_url || "",
        api: p.api || "",
        api_key_masked: p.api_key ? maskKey(p.api_key) : "",
        models: allModels,
        custom_models: customModels,
        has_credentials: !!(p.api_key || (isOAuth && oauthInfo?.loggedIn)),
        logged_in: isOAuth ? !!oauthInfo?.loggedIn : undefined,
        supports_oauth: isOAuth && ALLOWED_OAUTH.has(name),
        is_coding_plan: isCodingPlan(name),
        can_delete: !isOAuth || Object.prototype.hasOwnProperty.call(providers, name),
      };
    }

    // 追加 OAuth-only provider（有 auth.json 但没在 providers.yaml 里）
    // 只暴露白名单内的，其他 coding plan 会封号
    for (const [id, info] of oauthLoginMap) {
      if (result[id]) continue;
      if (!ALLOWED_OAUTH.has(id)) continue;
      const sdkIds = sdkByProvider.get(id) || [];
      const customModels = oauthCustom[id] || [];
      result[id] = {
        type: "oauth",
        display_name: info.name || id,
        base_url: "",
        api: "",
        api_key_masked: "",
        models: sdkIds,
        custom_models: customModels,
        has_credentials: !!info.loggedIn,
        logged_in: !!info.loggedIn,
        supports_oauth: true,
        can_delete: false,
      };
    }

    // 追加 ProviderRegistry 中已声明但尚未出现的 provider（未配置状态）
    // 让用户在设置页看到所有可用供应商，点击即可配置
    if (provRegistry) {
      for (const [id, entry] of provRegistry.getAll()) {
        if (result[id]) continue;
        if (entry.authType === "oauth") continue; // OAuth provider 走上面的白名单逻辑
        const sdkIds = sdkByProvider.get(id) || [];
        result[id] = {
          type: "api-key",
          display_name: entry.displayName || id,
          base_url: entry.baseUrl || "",
          api: entry.api || "",
          api_key_masked: "",
          models: sdkIds,
          custom_models: [],
          has_credentials: false,
          logged_in: undefined,
          supports_oauth: false,
          is_coding_plan: isCodingPlan(id),
          can_delete: false,
        };
      }
    }

    return { providers: result, favorites };
  });

  // ── Fetch / Test ──

  function normalizeRegistryModels(models) {
    return models.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      context: model.contextWindow ?? model.context ?? null,
      maxOutput: model.maxOutputTokens ?? model.maxOutput ?? null,
    }));
  }

  /**
   * 从供应商的 /v1/models (OpenAI 兼容) 端点拉取模型列表
   * body: { name, base_url, api, api_key? }
   */
  app.post("/api/providers/fetch-models", async (req, reply) => {
    const { name, base_url, api: explicitApi, api_key } = req.body || {};
    debugProviderRoute("fetch-models:start", {
      name,
      base_url,
      explicitApi,
      hasApiKey: !!api_key,
      apiKeyMasked: maskKey(api_key || ""),
    });
    if (!name && !base_url) {
      reply.code(400);
      debugProviderRoute("fetch-models:bad-request", { error: "name or base_url is required" });
      return { error: "name or base_url is required" };
    }

    const providers = name ? getAllProviders(engine.configPath) : {};
    const savedProvider = name ? providers[name] || {} : {};
    const savedKey = savedProvider.api_key || "";
    const effectiveBaseUrl = base_url || savedProvider.base_url || "";
    const effectiveApi = explicitApi || savedProvider.api || "";
    const hasExplicitRemoteConfig = !!(effectiveBaseUrl && effectiveApi && (api_key || savedKey));

    const oauthProviderIds = new Set(
      (engine.authStorage?.getOAuthProviders?.() || []).map((provider) => provider.id),
    );
    const isOAuthProvider = !!name && oauthProviderIds.has(name);

    debugProviderRoute("fetch-models:resolved-config", {
      name,
      effectiveBaseUrl,
      effectiveApi,
      hasExplicitRemoteConfig,
      isOAuthProvider,
      savedProviderHasKey: !!savedKey,
    });

    if (isOAuthProvider && !hasExplicitRemoteConfig) {
      try {
        await engine.refreshAvailableModels();
        const registryModels = engine.availableModels.filter((model) => model.provider === name);
        if (registryModels.length > 0) {
          return { source: "registry", models: normalizeRegistryModels(registryModels) };
        }

        return {
          error: `Pi registry has no available models for provider "${name}" yet. Please finish login or re-login, then try again.`,
          models: [],
        };
      } catch (err) {
        return { error: err.message, models: [] };
      }
    }

    if (!base_url) {
      reply.code(400);
      debugProviderRoute("fetch-models:bad-request", { error: "base_url is required for remote model fetch", name });
      return { error: "base_url is required for remote model fetch" };
    }

    // 解析 api_key：显式传入 > providers 块 > auth.json OAuth token
    let key = api_key || "";
    let api = explicitApi || "";
    if (!key && name) {
      key = savedKey;
      api = api || savedProvider.api || "";
    }
    // OAuth provider fallback：从 AuthStorage 获取 token
    if (!key && name) {
      try {
        key = await engine.authStorage.getApiKey(name) || "";
      } catch {}
    }

    // Anthropic 格式没有 /models 端点，从 Pi SDK + ProviderRegistry builtinModels 返回
    if (api === "anthropic-messages") {
      const registryModels = engine.modelRegistry
        ? engine.modelRegistry.getAll().filter((m) => m.provider === name)
        : [];
      if (registryModels.length > 0) {
        return { source: "registry", models: normalizeRegistryModels(registryModels) };
      }
      // fallback：从 ProviderRegistry 的 builtinModels 声明返回
      const provEntry = engine.providerRegistry?.get(name);
      if (provEntry?.builtinModels?.length > 0) {
        return {
          source: "builtin",
          models: provEntry.builtinModels.map(id => ({ id, name: id, context: null, maxOutput: null })),
        };
      }
      // 自定义 provider：从 providers.yaml 的 models 字段返回
      const savedProvider = name ? (getAllProviders(engine.configPath)[name] || {}) : {};
      if (savedProvider.models?.length > 0) {
        return {
          source: "config",
          models: savedProvider.models.map(id => ({ id, name: id, context: null, maxOutput: null })),
        };
      }
      // 最后 fallback：返回常见的 Anthropic 兼容模型 ID 作为建议
      // 用户可以根据自己的 API 提供商修改
      return {
        source: "suggested",
        models: [
          { id: "claude-3-5-sonnet-20241022", name: "claude-3-5-sonnet-20241022", context: null, maxOutput: null },
          { id: "claude-3-5-haiku-20241022", name: "claude-3-5-haiku-20241022", context: null, maxOutput: null },
          { id: "claude-3-opus-20240229", name: "claude-3-opus-20240229", context: null, maxOutput: null },
          { id: "glm-4-plus", name: "glm-4-plus", context: null, maxOutput: null },
          { id: "glm-4", name: "glm-4", context: null, maxOutput: null },
          { id: "glm-4-flash", name: "glm-4-flash", context: null, maxOutput: null },
        ],
        note: "Anthropic-compatible API doesn't provide a model list. These are suggested model IDs. Please verify with your API provider.",
      };
    }

    try {
      const urls = buildModelEndpoints(base_url, api || "openai-completions");

      let headers = { "Content-Type": "application/json" };
      if (key) {
        if (!api) {
          debugProviderRoute("fetch-models:missing-api", { name, base_url, hasKey: !!key });
          return { error: "api is required when api_key is present", models: [] };
        }
        headers = buildProviderAuthHeaders(api, key);
      }

      debugProviderRoute("fetch-models:request", {
        name,
        base_url,
        api,
        hasKey: !!key,
        keyMasked: maskKey(key),
        urls,
        headerKeys: Object.keys(headers),
      });

      const { res, url } = await fetchFirstAvailableModelEndpoint(urls, {
        headers,
        signal: AbortSignal.timeout(15000),
      });

      const data = await res.json();
      // OpenAI 兼容格式：{ data: [{ id, ... }] }
      // 尝试从返回里抓取上下文长度和最大输出（各 provider 扩展字段不同）
      const models = (data.data || []).map(m => ({
        id: m.id,
        name: m.id,
        context: m.context_length || m.context_window || m.max_context_length || null,
        maxOutput: m.max_completion_tokens || m.max_output_tokens || null,
      }));

      debugProviderRoute("fetch-models:success", {
        name,
        api,
        requestUrl: url,
        status: res.status,
        modelCount: models.length,
        sampleModels: models.slice(0, 5).map((m) => m.id),
      });

      return { models };
    } catch (err) {
      debugProviderRoute("fetch-models:error", {
        name,
        base_url,
        api,
        error: err?.message || String(err),
      });
      return { error: err.message, models: [] };
    }
  });

  /**
   * 测试供应商连接
   * body: { base_url, api, api_key }
   * 
   * 策略：
   * 1. 先尝试 /models 端点（标准 OpenAI 兼容）
   * 2. 如果 /models 失败但不是 401/403（认证错误），则 fallback 到 /chat/completions 做最小化请求
   * 3. 这样可以支持远景等不支持 /models 但支持 /chat/completions 的 OpenAI-compatible 接口
   */

  app.post("/api/providers/test", async (req, reply) => {
    const { base_url, api, model } = req.body || {};
    const api_key = (req.body?.api_key || "").replace(/[^\x20-\x7E]/g, "").trim();

    debugProviderRoute("provider-test:start", {
      base_url,
      api,
      model,
      hasApiKey: !!api_key,
      apiKeyMasked: maskKey(api_key),
    });

    if (!base_url) {
      reply.code(400);
      debugProviderRoute("provider-test:bad-request", { error: "base_url is required" });
      return { error: "base_url is required" };
    }
    if (!api) {
      reply.code(400);
      debugProviderRoute("provider-test:bad-request", { error: "api is required" });
      return { error: "api is required" };
    }

    const requestedModel = String(model || "").trim();
    const probeModel = requestedModel
      || (api === "anthropic-messages" ? "claude-3-5-haiku-20241022" : "glm-5");
    debugProviderRoute("provider-test:probe-model", {
      requestedModel,
      fallbackReason: requestedModel ? "explicit" : (api === "anthropic-messages" ? "anthropic-default" : "openai-default"),
      probeModel,
    });

    try {
      const endpoint = buildApiEndpoint(base_url, api);
      debugProviderRoute("provider-test:callProviderText", {
        api,
        base_url,
        endpoint,
        probeModel,
        hasApiKey: !!api_key,
      });

      await callProviderText({
        api,
        api_key,
        base_url,
        model: probeModel,
        messages: [{ role: "user", content: "Reply with OK only." }],
        max_tokens: 8,
        temperature: 0,
        timeoutMs: 15000,
      });

      return { ok: true, method: "callProviderText", endpoint, model: probeModel };
    } catch (err) {
      const msg = err?.message || String(err);
      debugProviderRoute("provider-test:callProviderText-error", {
        api,
        base_url,
        probeModel,
        error: msg,
      });

      const authFailed = /401|403|invalid api key|unauthorized|incorrect api key|authentication/i.test(msg);
      return {
        ok: false,
        method: "callProviderText",
        model: probeModel,
        error: msg,
        authFailed,
      };
    }
  });
}
