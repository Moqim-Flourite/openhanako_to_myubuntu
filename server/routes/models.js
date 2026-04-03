/**
 * 模型管理 REST 路由
 */
import { supportsXhigh } from "@mariozechner/pi-ai";
import { t } from "../i18n.js";
import { createRequire } from "module";
import { buildApiEndpoint, buildModelEndpoints, callProviderText } from "../../lib/llm/provider-client.js";
const _require = createRequire(import.meta.url);
const _knownModels = _require("../../lib/known-models.json");

/** 查询模型显示名：overrides > SDK name > known-models > id */
function resolveModelName(id, sdkName, overrides) {
  if (overrides?.[id]?.displayName) return overrides[id].displayName;
  if (sdkName && sdkName !== id) return sdkName;
  if (_knownModels[id]?.name) return _knownModels[id].name;
  return sdkName || id;
}

export default async function modelsRoute(app, { engine }) {

  // 列出可用模型
  app.get("/api/models", async (req, reply) => {
    try {
      const overrides = engine.config?.models?.overrides;
      const models = engine.availableModels.map(m => ({
        id: m.id,
        name: resolveModelName(m.id, m.name, overrides),
        provider: m.provider,
        isCurrent: m.id === engine.currentModel?.id,
      }));
      debugLog()?.log("api", `[models] list count=${models.length} current=${engine.currentModel?.id || "-"} ids=${models.map(m => m.id).join(",")}`);
      return { models, current: engine.currentModel?.id || null };
    } catch (err) {
      debugLog()?.error("api", `[models] list failed: ${err?.stack || err?.message || String(err)}`);
      reply.code(500);
      return { error: err.message };
    }
  });

  // 收藏模型列表（给聊天页面用，直接读 favorites，和设置页同源）
  app.get("/api/models/favorites", async (req, reply) => {
    try {
      const favoritesRaw = engine.readFavorites();
      const favorites = Array.isArray(favoritesRaw) ? favoritesRaw.filter(id => typeof id === "string" && id.trim()) : [];
      const availableRaw = engine.availableModels;
      const available = Array.isArray(availableRaw) ? availableRaw : [];
      const availableIds = new Set(available.map(m => m?.id).filter(Boolean));
      const validFavorites = favorites.filter(id => availableIds.has(id));

      debugLog()?.log("api", `[models/favorites] raw favoritesRawType=${Array.isArray(favoritesRaw) ? "array" : typeof favoritesRaw} favorites=${favorites.join(",")} availableCount=${available.length} availableIds=${[...availableIds].join(",")} validFavorites=${validFavorites.join(",")} current=${engine.currentModel?.id || "-"}`);

      const overrides = engine.config?.models?.overrides;
      const result = validFavorites.map(id => {
        const m = available.find(am => am?.id === id);
        return {
          id,
          name: resolveModelName(id, m?.name, overrides),
          provider: m?.provider || "",
          isCurrent: id === engine.currentModel?.id,
          reasoning: !!m?.reasoning,
          xhigh: m ? supportsXhigh(m) : false,
        };
      });

      if (validFavorites.length !== favorites.length) {
        debugLog()?.warn("api", `[models/favorites] filtered invalid favorites removed=${favorites.length - validFavorites.length}`);
      }

      return {
        models: result,
        current: engine.currentModel?.id || null,
        hasFavorites: result.length > 0,
      };
    } catch (err) {
      debugLog()?.error("api", `[models/favorites] failed: ${err?.stack || err?.message || String(err)}`);
      reply.code(500);
      return { error: err.message };
    }
  });


  // 健康检测：发一个最小请求测试模型连通性
  app.post("/api/models/health", async (req, reply) => {
    try {
      const { modelId } = req.body || {};
      if (!modelId) { reply.code(400); return { error: "modelId required" }; }

      const model = engine.availableModels.find(m => m.id === modelId);
      if (!model) { reply.code(404); return { error: `model "${modelId}" not found` }; }

      // 凭证解析：providers.yaml → auth.json OAuth（含 resourceUrl）→ 模型对象自带 baseUrl
      const creds = engine._resolveProviderCredentials(model.provider);

      // OAuth provider 可能有 resourceUrl（实际使用的域名，可能和内置不同）
      const oauthCred = engine.authStorage.get(model.provider);
      const oauthBaseUrl = oauthCred?.type === "oauth" ? oauthCred.resourceUrl : "";

      const baseUrl = creds.base_url || oauthBaseUrl || model.baseUrl || "";
      if (!baseUrl) return { ok: false, error: "no base_url" };

      let apiKey = creds.api_key;
      if (!apiKey) {
        try { apiKey = await engine.authStorage.getApiKey(model.provider); } catch {}
      }
      const api = creds.api || model.api || "openai-completions";

      if (api === "openai-codex-responses") {
        return { ok: true, status: 0, provider: model.provider, skipped: t("error.codexNoHealthCheck") };
      }

      try {
        const endpoint = buildApiEndpoint(baseUrl, api);
        await callProviderText({
          api,
          api_key: apiKey,
          base_url: baseUrl,
          model: modelId,
          messages: [{ role: "user", content: "." }],
          max_tokens: 1,
          temperature: 0,
          timeoutMs: 10000,
        });
        return { ok: true, status: 200, provider: model.provider, method: "callProviderText", endpoint };
      } catch (err) {
        const msg = err?.message || String(err);
        const authFailed = /401|403|invalid api key|unauthorized|incorrect api key|authentication/i.test(msg);

        if (!authFailed && api !== "anthropic-messages") {
          const urls = buildModelEndpoints(baseUrl, api);
          for (const url of urls) {
            try {
              const headers = apiKey
                ? (await import("../../lib/llm/provider-client.js")).buildProviderAuthHeaders(api, apiKey)
                : { "Content-Type": "application/json" };
              const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
              if (res.ok) {
                return { ok: true, status: res.status, provider: model.provider, method: "models", endpoint: url };
              }
            } catch {}
          }
        }

        return { ok: false, error: msg, provider: model.provider, method: "callProviderText" };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 切换模型
  app.post("/api/models/set", async (req, reply) => {
    try {
      const { modelId } = req.body || {};
      debugLog()?.log("api", `[models/set] start requested=${modelId || "-"}`);
      if (!modelId) {
        reply.code(400);
        return { error: t("error.missingParam", { param: "modelId" }) };
      }

      const available = engine.availableModels || [];
      const exists = available.some((m) => m.id === modelId || `${m.provider}/${m.id}` === modelId);
      if (!exists) {
        debugLog()?.warn("api", `[models/set] unavailable requested=${modelId} availableCount=${available.length}`);
        reply.code(400);
        return {
          error: `model not available: ${modelId}`,
          code: "MODEL_NOT_AVAILABLE",
          availableCount: available.length,
        };
      }

      await engine.setModel(modelId);
      debugLog()?.log("api", `[models/set] success requested=${modelId} current=${engine.currentModel?.provider || "-"}\/${engine.currentModel?.id || "-"}`);
      return { ok: true, model: engine.currentModel?.name };
    } catch (err) {
      debugLog()?.error("api", `[models/set] failed: ${err?.stack || err?.message || String(err)}`);
      reply.code(500);
      return { error: err.message };
    }
  });
}
