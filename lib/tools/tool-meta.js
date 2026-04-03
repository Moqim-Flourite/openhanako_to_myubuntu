/**
 * tool-meta.js — Hanako Tool 元信息包装层
 *
 * 目标：
 * 1. 保持现有 Pi SDK ToolDefinition 兼容
 * 2. 为工具补充统一元信息，便于后续做权限、调度、计划模式、并发策略
 * 3. 不强迫一次性重写全部工具
 */

/**
 * @typedef {Object} HanakoToolMeta
 * @property {string} [category]            工具分类，如 search / browser / memory / automation / system
 * @property {boolean} [readOnly]           是否只读
 * @property {boolean} [destructive]        是否具有破坏性
 * @property {boolean} [concurrencySafe]    是否适合并发执行
 * @property {boolean} [requiresConfirmation] 是否建议在 UI/权限层要求确认
 * @property {string[]} [tags]              标签，供筛选与路由使用
 */

/**
 * 为现有工具定义附加统一 meta。
 * 不改变原工具执行逻辑，只追加 `meta` 字段。
 *
 * @template T
 * @param {T & object} tool
 * @param {HanakoToolMeta} meta
 * @returns {T & { meta: HanakoToolMeta }}
 */
export function withToolMeta(tool, meta = {}) {
  return {
    ...tool,
    meta: normalizeToolMeta(meta),
  };
}

/**
 * 标准化 meta，补默认值，避免后续消费方到处判空。
 * @param {HanakoToolMeta} meta
 * @returns {Required<HanakoToolMeta>}
 */
export function normalizeToolMeta(meta = {}) {
  return {
    category: meta.category || "general",
    readOnly: meta.readOnly === true,
    destructive: meta.destructive === true,
    concurrencySafe: meta.concurrencySafe !== false,
    requiresConfirmation: meta.requiresConfirmation === true,
    tags: Array.isArray(meta.tags) ? [...new Set(meta.tags.filter(Boolean))] : [],
  };
}

/**
 * 批量包装工具数组。
 * @param {Array<object>} tools
 * @param {(tool: object) => HanakoToolMeta | null | undefined} resolver
 * @returns {Array<object>}
 */
export function attachToolMetaBatch(tools, resolver) {
  return tools.map((tool) => {
    if (!tool || typeof tool !== "object") return tool;
    if (tool.meta) return { ...tool, meta: normalizeToolMeta(tool.meta) };
    const meta = resolver?.(tool);
    return withToolMeta(tool, meta || {});
  });
}

/**
 * Hanako 内置工具默认元信息映射。
 * 先覆盖最常用工具，后续逐步扩充。
 */
export const BUILTIN_TOOL_META_MAP = {
  search_memory: {
    category: "memory",
    readOnly: true,
    destructive: false,
    concurrencySafe: true,
    tags: ["memory", "search"],
  },
  web_search: {
    category: "search",
    readOnly: true,
    destructive: false,
    concurrencySafe: true,
    tags: ["web", "search"],
  },
  web_fetch: {
    category: "web",
    readOnly: true,
    destructive: false,
    concurrencySafe: true,
    tags: ["web", "fetch"],
  },
  todo: {
    category: "planning",
    readOnly: false,
    destructive: false,
    concurrencySafe: false,
    tags: ["task", "planning", "session-state"],
  },
  browser: {
    category: "browser",
    readOnly: false,
    destructive: false,
    concurrencySafe: false,
    tags: ["browser", "interactive", "web"],
  },
  cron: {
    category: "automation",
    readOnly: false,
    destructive: false,
    concurrencySafe: false,
    requiresConfirmation: true,
    tags: ["automation", "schedule"],
  },
  notify: {
    category: "system",
    readOnly: false,
    destructive: false,
    concurrencySafe: true,
    tags: ["notification", "system"],
  },
  present_files: {
    category: "filesystem",
    readOnly: true,
    destructive: false,
    concurrencySafe: true,
    tags: ["file", "output"],
  },
  create_artifact: {
    category: "artifact",
    readOnly: false,
    destructive: false,
    concurrencySafe: true,
    tags: ["artifact", "output"],
  },
  update_settings: {
    category: "settings",
    readOnly: false,
    destructive: false,
    concurrencySafe: false,
    requiresConfirmation: true,
    tags: ["settings", "preferences"],
  },
  delegate: {
    category: "agent",
    readOnly: false,
    destructive: false,
    concurrencySafe: false,
    tags: ["agent", "delegate", "sub-agent"],
  },
};

/**
 * 按名称推断默认 meta。
 * @param {object} tool
 * @returns {HanakoToolMeta}
 */
export function inferBuiltInToolMeta(tool) {
  const name = tool?.name || "";
  return BUILTIN_TOOL_META_MAP[name] || {
    category: "general",
    readOnly: false,
    destructive: false,
    concurrencySafe: true,
    tags: [],
  };
}
