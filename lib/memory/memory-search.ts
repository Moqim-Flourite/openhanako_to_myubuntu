/**
 * memory-search.js — search_memory 工具（v2 标签检索）
 *
 * 替代 v1 的 embedding KNN + 混合排序 + 链接展开。
 * v2 用标签匹配 + 日期过滤 + FTS5 全文搜索兜底。
 *
 * 标签由 LLM 在元事实拆分时生成，也由 LLM 在搜索时生成查询标签，
 * 两边的"语言习惯"天然接近，一致性有保障。
 */

import { Type } from "../pi-sdk/index.ts";
import { t } from "../i18n.ts";
import { createModuleLogger } from "../debug-log.ts";

const log = createModuleLogger("memory-search");

const CHANNEL_SESSION_PREFIX = "channel-";
const BRIDGE_SESSION_PREFIX_PATTERN = /^(qq|telegram|wechat|feishu)_/;

/**
 * 把 sources 配置转换为 session_id 匹配函数。
 * sources 格式：
 *   - "ch_xxx" → 匹配 "channel-ch_xxx"
 *   - "bridge:qq:12345" → 匹配 session_id 以 "qq_" 开头且包含 "12345"
 *   - "bridge:telegram" → 匹配 session_id 以 "telegram_" 开头
 *   - "*" → 匹配所有
 */
function buildSourceMatcher(sources: string[]): ((sessionId: string) => boolean) | null {
  if (!Array.isArray(sources) || sources.length === 0) return null;
  const hasWildcard = sources.includes("*");
  if (hasWildcard) return () => true;

  const channelPatterns: string[] = [];
  const bridgePatterns: { platform: string; chatId?: string }[] = [];

  for (const src of sources) {
    if (typeof src !== "string") continue;
    if (src.startsWith("ch_")) {
      channelPatterns.push(`channel-${src}`);
    } else if (src.startsWith("bridge:")) {
      const parts = src.split(":");
      const platform = parts[1] || "";
      const chatId = parts[2] || undefined;
      if (platform) bridgePatterns.push({ platform, chatId });
    }
  }

  return (sessionId: string) => {
    // 频道匹配：session_id 精确匹配 channel-xxx
    if (channelPatterns.includes(sessionId)) return true;
    // bridge 匹配：session_id 以 platform_ 开头，可选 chatId 过滤
    for (const bp of bridgePatterns) {
      const prefix = `${bp.platform}_`;
      if (sessionId.startsWith(prefix)) {
        if (!bp.chatId) return true; // 只指定平台，不指定 chatId
        if (sessionId.includes(bp.chatId)) return true;
      }
    }
    return false;
  };
}

/**
 * 会话作用域过滤：频道 phone 会话默认看不到「其它频道」的事实。
 * 通用事实（session_id 为空或非频道）和当前频道的事实始终可见，
 * 跨频道检索必须显式传 cross_channel: true（#1670 群聊记忆混淆）。
 *
 * globalMemory 模式下：
 *   - 无 allowedSources：跳过所有 scope 过滤，看所有 session
 *   - 有 allowedSources：只看白名单内的 session
 */
function factVisibleInConversationScope(
  row: any,
  scope: any,
  crossChannel: boolean,
  globalMemory: boolean,
  sourceMatcher: ((sessionId: string) => boolean) | null,
) {
  if (globalMemory) {
    if (!sourceMatcher) return true; // 无白名单，全放行
    const sessionId = typeof row?.session_id === "string" ? row.session_id : "";
    if (!sessionId) return true; // 无 session_id 的通用事实始终可见
    return sourceMatcher(sessionId);
  }
  if (!scope || scope.kind !== "channel") return true;
  const sessionId = typeof row?.session_id === "string" ? row.session_id : "";
  if (!sessionId.startsWith(CHANNEL_SESSION_PREFIX)) return true;
  if (sessionId === `${CHANNEL_SESSION_PREFIX}${scope.channelId}`) return true;
  return crossChannel === true;
}

/**
 * 创建 search_memory 工具定义
 * @param {import('./fact-store.ts').FactStore} factStore
 * @param {object} [opts]
 * @param {function} [opts.getMemoryMasterEnabled] - 返回 agent 级别记忆总开关状态
 * @param {{kind:"channel", channelId:string}} [opts.conversationScope]
 *   - 会话作用域。频道 phone 会话注入后，默认排除其它频道的事实；
 *     scoped 实例的 schema 额外暴露 cross_channel 参数供显式跨频道检索
 * @param {boolean} [opts.globalMemory]
 *   - 全局记忆模式。开启后跳过所有 scope 过滤，agent 可以看到所有 session 的事实。
 *     主 agent 功能专用，不影响其他频道。
 * @param {string[]} [opts.allowedSources]
 *   - globalMemory 模式下的来源白名单。
 *     格式："ch_xxx"（频道）、"bridge:qq:12345"（bridge 聊天）、"bridge:telegram"（平台级）、"*"（全部）
 * @returns {import('../pi-sdk/index.ts').ToolDefinition}
 */
export function createMemorySearchTool(factStore, opts: any = {}) {
  const conversationScope = opts.conversationScope?.kind === "channel" && opts.conversationScope.channelId
    ? { kind: "channel" as const, channelId: String(opts.conversationScope.channelId) }
    : null;
  const globalMemory = opts.globalMemory === true;
  // allowedSources: 白名单数组，globalMemory 模式下只看这些来源
  const allowedSources = Array.isArray(opts.allowedSources) ? opts.allowedSources : [];
  const sourceMatcher = globalMemory ? buildSourceMatcher(allowedSources) : null;
  // globalMemory 模式下不暴露 cross_channel 参数（已经是全局的，无需显式跨频道）
  const exposeCrossChannel = conversationScope && !globalMemory;
  return {
    name: "search_memory",
    label: t("error.memorySearchLabel"),
    description: t("error.memorySearchDesc"),
    parameters: Type.Object({
      query: Type.String({ description: t("error.memorySearchQueryDesc") }),
      tags: Type.Optional(
        Type.Array(Type.String(), {
          description: t("error.memorySearchTagsDesc"),
        }),
      ),
      date_from: Type.Optional(
        Type.String({ description: t("error.memorySearchDateFromDesc") }),
      ),
      date_to: Type.Optional(
        Type.String({ description: t("error.memorySearchDateToDesc") }),
      ),
      ...(exposeCrossChannel ? {
        cross_channel: Type.Optional(
          Type.Boolean({ description: t("error.memorySearchCrossChannelDesc") }),
        ),
      } : {}),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const t0 = performance.now();

        if (factStore.size === 0) {
          return {
            content: [{ type: "text", text: t("error.memorySearchEmpty") }],
            details: {},
          };
        }

        const dateRange: { from?: string; to?: string } = {};
        if (params.date_from) dateRange.from = params.date_from;
        if (params.date_to) dateRange.to = params.date_to + "T23:59";

        let results = [];
        const seenIds = new Set();

        const crossChannel = conversationScope ? params.cross_channel === true : false;
        const visibleInScope = (row) => factVisibleInConversationScope(row, conversationScope, crossChannel, globalMemory, sourceMatcher);

        // 策略 1：标签匹配（优先）
        // globalMemory 模式下收紧 limit，节省 token（小模型场景）
        const tagLimit = globalMemory ? 10 : 15;
        const ftsLimit = globalMemory ? 5 : 10;
        if (params.tags && params.tags.length > 0) {
          const tagResults = factStore.searchByTags(
            params.tags,
            Object.keys(dateRange).length > 0 ? dateRange : undefined,
            tagLimit,
          );
          for (const r of tagResults) {
            if (!visibleInScope(r)) continue;
            seenIds.add(r.id);
            results.push({ ...r, source: "tag" });
          }
        }

        // 策略 2：全文搜索补充（标签结果不足 3 条时）
        if (results.length < 3 && params.query) {
          const ftsResults = factStore.searchFullText(params.query, ftsLimit);
          for (const r of ftsResults) {
            if (seenIds.has(r.id)) continue;
            if (!visibleInScope(r)) continue;
            seenIds.add(r.id);
            results.push({ ...r, source: "fts" });
          }
        }

        // 日期过滤（对 FTS 结果也应用）
        if (dateRange.from || dateRange.to) {
          results = results.filter((r) => {
            if (!r.time) return true; // 无时间的不过滤
            if (dateRange.from && r.time < dateRange.from) return false;
            if (dateRange.to && r.time > dateRange.to) return false;
            return true;
          });
        }

        const elapsed = performance.now() - t0;
        log.log(
          `${elapsed.toFixed(0)}ms | ` +
          `hits: ${results.length} (tag: ${results.filter((r) => r.source === "tag").length}, ` +
          `fts: ${results.filter((r) => r.source === "fts").length})`,
        );

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: t("error.memorySearchEmpty") }],
            details: {},
          };
        }

        // globalMemory 模式下限制总输出量，避免小模型上下文溢出
        const maxResults = globalMemory ? 15 : results.length;
        if (results.length > maxResults) {
          results = results.slice(0, maxResults);
        }

        // 格式化输出
        const lines = results.map((r, i) => {
          const tagsStr = r.tags.length > 0 ? ` (${r.tags.join(", ")})` : "";
          const timeStr = r.time ? ` — ${r.time}` : "";
          return `${i + 1}. ${r.fact}${tagsStr}${timeStr}`;
        });

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: { resultCount: results.length },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: t("error.memorySearchError", { msg: err.message }) }],
          details: {},
        };
      }
    },
  };
}
