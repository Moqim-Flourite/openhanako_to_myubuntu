/**
 * tool-confirmation.js — 通用工具确认辅助
 *
 * 目标：
 * - 复用 Hanako 已有 ConfirmStore / WS 事件链路
 * - 让工具可以低成本接入“执行前确认”
 * - 先服务于高风险动作（如 browser.evaluate / browser.navigate）
 */

/**
 * 请求一次工具确认。
 *
 * @param {object} opts
 * @param {object} opts.confirmStore
 * @param {(event: object) => void} [opts.emitEvent]
 * @param {string} [opts.sessionPath]
 * @param {string} opts.toolName
 * @param {string} [opts.action]
 * @param {string} opts.label
 * @param {string} [opts.description]
 * @param {object} [opts.payload]
 * @returns {Promise<{action: "confirmed"|"rejected"|"timeout", value?: any, confirmId: string}>}
 */
export async function requestToolConfirmation({
  confirmStore,
  emitEvent,
  sessionPath,
  toolName,
  action,
  label,
  description,
  payload = {},
}) {
  if (!confirmStore) {
    return { action: "confirmed", confirmId: "" };
  }

  const { confirmId, promise } = confirmStore.create(
    "tool",
    {
      toolName,
      action: action || null,
      label,
      description: description || null,
      payload,
    },
    sessionPath,
  );

  emitEvent?.({
    type: "tool_confirmation",
    confirmId,
    toolName,
    action: action || null,
    label,
    description: description || null,
    payload,
  });

  const result = await promise;
  return {
    action: result.action,
    value: result.value,
    confirmId,
  };
}
