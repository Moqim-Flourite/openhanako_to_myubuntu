/**
 * xAI (Grok) provider plugin
 *
 * 文档：https://docs.x.ai
 */

/** @type {import('../../core/provider-registry.js').ProviderPlugin} */
export const xaiPlugin = {
  id: "xai",
  displayName: "xAI (Grok)",
  authType: "api-key",
  defaultBaseUrl: "https://api.x.ai/v1",
  defaultApi: "openai-completions",
  builtinModels: [
    "grok-4-1-fast-reasoning", "grok-4-1-fast-non-reasoning",
    "grok-3-beta", "grok-3-mini-beta",
  ],
  capabilities: {
    vision: true,
    functionCall: true,
    streaming: true,
    reasoning: true,
    quirks: [],
  },
};
