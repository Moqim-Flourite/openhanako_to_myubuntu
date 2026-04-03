/**
 * tool-policy.js — Hanako 通用工具策略层
 *
 * 第一阶段目标：
 * - 不改 Pi SDK 内部调度，只在 Hanako 的工具构建阶段做过滤
 * - 基于 tool.meta 为不同 mode 提供统一策略
 */

/**
 * @typedef {"full"|"read-only"|"safe"} ToolPolicyMode
 */

/**
 * 按策略模式过滤 custom tools。
 *
 * full:
 *   - 不过滤
 * read-only:
 *   - 仅保留 meta.readOnly === true
 * safe:
 *   - 排除 destructive，且保留 readOnly / requiresConfirmation / 非 destructive 工具
 *
 * @param {Array<object>} customTools
 * @param {ToolPolicyMode} mode
 * @returns {Array<object>}
 */
export function applyCustomToolPolicy(customTools, mode = "full") {
  const tools = Array.isArray(customTools) ? customTools : [];

  switch (mode) {
    case "read-only":
      return tools.filter((t) => t?.meta?.readOnly === true);

    case "safe":
      return tools.filter((t) => t?.meta?.destructive !== true);

    case "full":
    default:
      return tools;
  }
}

/**
 * 统一构建 tool policy mode。
 *
 * @param {object} opts
 * @param {boolean} [opts.readOnly]
 * @param {boolean} [opts.safe]
 * @returns {ToolPolicyMode}
 */
export function resolveToolPolicyMode(opts = {}) {
  if (opts.readOnly) return "read-only";
  if (opts.safe) return "safe";
  return "full";
}
