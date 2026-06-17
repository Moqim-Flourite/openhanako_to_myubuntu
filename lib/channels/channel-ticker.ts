/**
 * channel-ticker.js — 频道手机调度器（中断恢复 + 主动提醒）
 *
 * 调度模型：
 * - 群聊新消息 → 中断当前执行 → 手机送达所有频道成员 → 恢复中断点
 * - 频道提醒到期 → 随机点醒一个频道成员 → 让它基于频道 Truth 主动发言
 *
 * 中断恢复机制：
 * - 用户消息到达时，abort 当前 session
 * - 保存检查点（已处理到哪个 agent 的哪个频道）
 * - 处理完用户消息后，从检查点恢复继续
 *
 * 调度器本身不调用 LLM，通过回调委托给 engine。
 */

import {
  readBookmarks,
  updateBookmark,
  getNewMessages,
  getRecentMessages,
  getChannelMembers,
  getChannelMeta,
} from "./channel-store.ts";
import { debugLog, createModuleLogger } from "../debug-log.ts";
import { readBoolean, resolveAgentPhoneGuardLimit } from "../conversations/agent-phone-prompt.ts";
import fs from "fs";
import path from "path";

const log = createModuleLogger("channel-ticker");

const DEFAULT_UNREAD_DELIVERY_WINDOW = 20;

function normalizeBookmarkState(bookmark) {
  if (bookmark === undefined || bookmark === null || bookmark === "") {
    return { value: null, state: "missing" };
  }
  if (bookmark === "never") {
    return { value: null, state: "never" };
  }
  return { value: bookmark, state: "timestamp" };
}

export function buildChannelUnreadDeliveryWindow({
  channelFile,
  bookmark,
  agentId,
  limit = DEFAULT_UNREAD_DELIVERY_WINDOW,
}) {
  const maxMessages = Math.max(1, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : DEFAULT_UNREAD_DELIVERY_WINDOW);
  const normalized = normalizeBookmarkState(bookmark);
  const unreadMessages = getNewMessages(channelFile, normalized.value, agentId);
  const droppedUnreadCount = Math.max(0, unreadMessages.length - maxMessages);
  const messages = droppedUnreadCount > 0 ? unreadMessages.slice(-maxMessages) : unreadMessages;
  return {
    messages,
    totalUnreadCount: unreadMessages.length,
    droppedUnreadCount,
    bookmarkState: normalized.state,
    bookmarkTimestamp: messages.length > 0 ? messages[messages.length - 1].timestamp : null,
  };
}

/**
 * 创建频道并发调度器（per-channel 并发 + agent 分批并行）
 *
 * @param {object} opts
 * @param {string} opts.channelsDir - 频道目录
 * @param {string} opts.agentsDir - agents 父目录
 * @param {() => string[]} opts.getAgentOrder - 返回参与轮转的 agent ID 列表
 * @param {(agentId, channelName, newMessages, allUpdates, opts?) => Promise<{replied, replyContent?}>} opts.executeCheck
 * @param {(agentId, channelName, payload) => Promise<void>} opts.onMemorySummarize
 * @param {(event, data) => void} [opts.onEvent]
 * @returns {{ start, stop, triggerImmediate, isRunning }}
 */
export function createChannelTicker({
  channelsDir,
  agentsDir,
  getAgentOrder,
  executeCheck,
  onMemorySummarize,
  onEvent,
  random = Math.random,
  isEnabled = () => true,
}) {
  const DEFAULT_REMINDER_INTERVAL_MINUTES = 31;
  const PAUSE_MS = DEFAULT_REMINDER_INTERVAL_MINUTES * 60 * 1000;

  // ── 状态 ──
  let _timer = null;          // 下一个 cycle 的定时器（仅 scheduleCycle 用）
  // per-channel 执行状态：每个频道独立的 cycle/abort，互不干扰
  const _channelCyclePromises = new Map();  // channelName → Promise
  const _channelAbortCtrls = new Map();     // channelName → AbortController
  let _interruptPending = false; // 中断标记（仅用于 scheduleCycle）
  let _checkpoint = null;     // { agentIdx, channelIdx } 中断恢复点
  let _running = false;       // 是否有 cycle 在运行
  const _reminderDueAt = new Map(); // channelName → { dueAt, intervalMs }

  // ── 手机送达状态（新群聊消息触发的立即处理）──
  // per-channel 并发：每个频道独立 delivery，不同频道互不阻塞
  const _channelDeliveries = new Map(); // channelName → { promise, abortCtrl } — per-channel 锁
  let _stopped = false;          // stop() 后禁止新的 delivery
  const _activeDeliveries = new Map(); // channelName → { ...progress } — 多频道并发活跃状态

  // ── 工具函数 ──
  function isTickerEnabled() {
    try {
      return isEnabled() !== false;
    } catch {
      return false;
    }
  }

  /** 获取频道文件中最新一条消息的时间戳 */
  function getLatestTimestamp(channelFile) {
    if (!fs.existsSync(channelFile)) return null;
    const content = fs.readFileSync(channelFile, "utf-8");
    const headerRe = /^### .+? \| (\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)$/gm;
    let lastMatch = null;
    let m;
    while ((m = headerRe.exec(content)) !== null) {
      lastMatch = m[1];
    }
    return lastMatch;
  }

  function listChannelFiles() {
    if (!fs.existsSync(channelsDir)) return [];
    return fs.readdirSync(channelsDir)
      .filter(f => f.endsWith(".md"))
      .map(f => ({
        channelName: f.replace(/\.md$/, ""),
        channelFile: path.join(channelsDir, f),
      }));
  }

  function readReminderIntervalMs(channelFile) {
    const meta = getChannelMeta(channelFile);
    const minutes = Number(meta.agentPhoneReminderIntervalMinutes);
    const normalized = Number.isFinite(minutes) && minutes > 0
      ? Math.floor(minutes)
      : DEFAULT_REMINDER_INTERVAL_MINUTES;
    return normalized * 60 * 1000;
  }

  function isProactiveEnabled(channelFile) {
    const meta = getChannelMeta(channelFile);
    return meta.agentPhoneProactiveEnabled === undefined
      ? true
      : readBoolean(meta.agentPhoneProactiveEnabled);
  }

  function refreshReminderSchedule(now = Date.now()) {
    if (!isTickerEnabled()) return;
    const seen = new Set();
    for (const { channelName, channelFile } of listChannelFiles()) {
      seen.add(channelName);
      if (!isProactiveEnabled(channelFile)) {
        _reminderDueAt.delete(channelName);
        continue;
      }
      const intervalMs = readReminderIntervalMs(channelFile);
      const existing = _reminderDueAt.get(channelName);
      if (!existing || existing.intervalMs !== intervalMs) {
        _reminderDueAt.set(channelName, { intervalMs, dueAt: now + intervalMs });
      }
    }
    for (const channelName of [..._reminderDueAt.keys()]) {
      if (!seen.has(channelName)) _reminderDueAt.delete(channelName);
    }
  }

  function resetChannelReminder(channelName, now = Date.now()) {
    const channelFile = path.join(channelsDir, `${channelName}.md`);
    if (!fs.existsSync(channelFile)) {
      _reminderDueAt.delete(channelName);
      return;
    }
    if (!isProactiveEnabled(channelFile)) {
      _reminderDueAt.delete(channelName);
      return;
    }
    const intervalMs = readReminderIntervalMs(channelFile);
    _reminderDueAt.set(channelName, { intervalMs, dueAt: now + intervalMs });
  }

  function snapshot(channelName = null) {
    const active = channelName
      ? (_activeDeliveries.has(channelName) ? { ..._activeDeliveries.get(channelName) } : null)
      : (_activeDeliveries.size > 0 ? { ..._activeDeliveries.values().next().value } : null);
    const reminderEntry = channelName ? _reminderDueAt.get(channelName) : null;
    return {
      active,
      running: _running,
      queued: _channelDeliveries.size > 0,
      checkpoint: _checkpoint ? { ..._checkpoint } : null,
      activeChannels: [..._channelDeliveries.keys()],
      nextReminder: reminderEntry
        ? {
          channelName,
          dueAt: new Date(reminderEntry.dueAt).toISOString(),
          dueAtMs: reminderEntry.dueAt,
          intervalMs: reminderEntry.intervalMs,
        }
        : null,
    };
  }

  function readGuardLimit(channelFile, memberCount) {
    const meta = getChannelMeta(channelFile);
    return resolveAgentPhoneGuardLimit(meta.agentPhoneGuardLimit, memberCount);
  }

  function isCurrentChannelMember(channelFile, agentId) {
    if (!fs.existsSync(channelFile)) return false;
    return getChannelMembers(channelFile).includes(agentId);
  }

  function hasExplicitDecision(result) {
    return result?.replied === true || result?.passed === true;
  }

  function shouldAdvanceBookmark(result) {
    return hasExplicitDecision(result) || result?.missingDecision === true || result?.permissionBlocked === true;
  }

  function bookmarkTimestampForDelivery(result, deliveryWindow, channelFile) {
    if (typeof result?.bookmarkTimestamp === "string" && result.bookmarkTimestamp) {
      return result.bookmarkTimestamp;
    }
    if (typeof deliveryWindow?.bookmarkTimestamp === "string" && deliveryWindow.bookmarkTimestamp) {
      return deliveryWindow.bookmarkTimestamp;
    }
    return getLatestTimestamp(channelFile);
  }

  function pickRandomAgent(channelName) {
    const channelFile = path.join(channelsDir, `${channelName}.md`);
    if (!fs.existsSync(channelFile)) return null;
    const channelMembers = new Set(getChannelMembers(channelFile));
    const agents = getAgentOrder().filter(id => channelMembers.has(id));
    if (agents.length === 0) return null;
    const idx = Math.min(agents.length - 1, Math.floor(Math.max(0, Math.min(0.999999, random())) * agents.length));
    return agents[idx];
  }

  /** 收集一个 agent 的所有频道更新（有新消息的） */
  function collectAgentChannels(agentId) {
    const channelsMdPath = path.join(agentsDir, agentId, "channels.md");
    const bookmarks = readBookmarks(channelsMdPath);
    const updates = [];

    for (const { channelName, channelFile } of listChannelFiles()) {
      const members = getChannelMembers(channelFile);
      if (!members.includes(agentId)) continue;

      // 每个 agent 的 phone cursor 是自己的 bookmark；送达内容只包含它还没看过的新群聊消息。
      const bookmark = bookmarks.get(channelName);
      const deliveryWindow = buildChannelUnreadDeliveryWindow({ channelFile, bookmark, agentId });
      const hasNew = deliveryWindow.messages.length > 0;

      updates.push({
        channelName,
        channelFile,
        channelsMdPath,
        bookmark,
        newMessages: deliveryWindow.messages,
        deliveryWindow,
        hasNew,
      });
    }
    return updates;
  }

  // ── 核心：顺序轮询 ──

  /**
   * 执行一个完整的 cycle：所有 agent 依次处理所有频道
   * 支持从 checkpoint 恢复
   */
  async function _runCycle() {
    if (!isTickerEnabled()) return;
    _running = true;
    try {
      const agents = getAgentOrder();
      if (agents.length === 0) return;

      // 从检查点恢复或从头开始
      const startAgent = _checkpoint?.agentIdx ?? 0;
      const startChannel = _checkpoint?.channelIdx ?? 0;
      _checkpoint = null;

      log.log(`cycle 开始（${agents.length} 个 agent${startAgent > 0 ? `，从 ${agents[startAgent]} 恢复` : ""}）`);
      debugLog()?.log("ticker", `cycle start (${agents.length} agents${startAgent > 0 ? `, resume from idx ${startAgent}` : ""})`);
      onEvent?.("channel_cycle_start", { agents, resumeFrom: startAgent });

      for (let ai = startAgent; ai < agents.length; ai++) {
        const agentId = agents[ai];
        const channelUpdates = collectAgentChannels(agentId);
        const withNew = channelUpdates.filter(u => u.hasNew);
        const startCh = (ai === startAgent) ? startChannel : 0;

        if (withNew.length === 0) {
          debugLog()?.log("ticker", `${agentId}: no new messages, skipping`);
          continue;
        }

        log.log(`→ ${agentId}（${withNew.length} 个频道有新消息）`);
        debugLog()?.log("ticker", `→ ${agentId} (${withNew.length} channels with new msgs)`);

        for (let ci = startCh; ci < channelUpdates.length; ci++) {
          // ★ 每个频道之前检查中断
          if (_interruptPending) {
            _checkpoint = { agentIdx: ai, channelIdx: ci };
            log.log(`中断！保存检查点 agent=${agentId} ch=${ci}`);
            debugLog()?.log("ticker", `interrupted, checkpoint: agent=${ai} ch=${ci}`);
            return;
          }

          const update = channelUpdates[ci];
          if (!update.hasNew) continue;

          await _processOneChannel(agentId, update);
        }
      }

      // 全部完成
      log.log(`cycle 完成，${Math.round(PAUSE_MS / 1000)}秒后下一轮`);
      debugLog()?.log("ticker", `cycle done, next in ${Math.round(PAUSE_MS / 1000)}s`);
      onEvent?.("channel_cycle_done", {});
      _scheduleNext(PAUSE_MS);
    } catch (err) {
      log.error(`cycle 错误: ${err.message}`);
      debugLog()?.error("ticker", `cycle error: ${err.message}`);
      // 出错后也调度下一轮
      _scheduleNext(PAUSE_MS);
    } finally {
      _running = false;
    }
  }

  /**
   * 处理单个频道（可被 abort）
   */
  async function _processOneChannel(agentId, update) {
    if (!isCurrentChannelMember(update.channelFile, agentId)) return;
    // per-channel abort controller，不干扰其他频道
    const chAbortCtrl = new AbortController();
    _channelAbortCtrls.set(update.channelName, chAbortCtrl);

    log.log(`${agentId} 检查 #${update.channelName}（${update.newMessages.length} 条新消息）`);

    try {
      // 429 退避重试：主 LLM 调用也可能遇到 rate limit
      let result;
      const maxRetries = 2;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          result = await executeCheck(
            agentId,
            update.channelName,
            update.newMessages,
            [],
            { signal: chAbortCtrl.signal, deliveryWindow: update.deliveryWindow },
          );
          break;
        } catch (execErr) {
          const isRateLimit = execErr?.code === "LLM_RATE_LIMITED" || execErr?.status === 429;
          if (isRateLimit && attempt < maxRetries && !chAbortCtrl.signal.aborted) {
            const delayMs = (2 ** attempt) * 5000 + Math.random() * 2000; // 5s, 10s + jitter
            log.log(`${agentId}/#${update.channelName} 429 退避 ${Math.round(delayMs / 1000)}s（第 ${attempt + 1} 次重试）`);
            await new Promise(r => setTimeout(r, delayMs));
            continue;
          }
          throw execErr;
        }
      }

      // 完成送达：有显式 reply/pass，或 phone session 已结束但没有作出频道决定。
      // 后者也要推进 cursor，否则同一批消息会无限重投；但不写记忆摘要。
      if (shouldAdvanceBookmark(result) && isCurrentChannelMember(update.channelFile, agentId)) {
        const bookmarkTs = bookmarkTimestampForDelivery(result, update.deliveryWindow, update.channelFile);
        if (bookmarkTs) {
          await updateBookmark(update.channelsMdPath, update.channelName, bookmarkTs);
        }
      }

      // 回复了 → 记忆摘要
      if (hasExplicitDecision(result) && onMemorySummarize) {
        await onMemorySummarize(agentId, update.channelName, {
          messages: update.newMessages,
          replyContent: result.replyContent || "",
        });
      }
    } catch (err) {
      if (chAbortCtrl.signal.aborted) {
        // 被中断，不更新 bookmark（下次重试）
        log.log(`${agentId}/#${update.channelName} 被中断`);
        return;
      }
      log.error(`${agentId} 处理 #${update.channelName} 失败: ${err.message}`);
    } finally {
      _channelAbortCtrls.delete(update.channelName);
    }
  }

  // ── 中断处理 ──

  /**
   * 新群聊消息后立即中断 + 手机送达
   *
   * 合并机制：如果用户连续发多条消息，后到的消息会：
   * 1. abort 正在进行的 delivery（如果有）
   * 2. 等它结束
   * 3. 用最新的滑动窗口重新开始
   *
   * 这样保证 agent 看到的永远是最新的完整上下文。
   *
   * @param {string} channelName
   * @param {{ mentionedAgents?: string[] }} [opts]
   */
  function triggerImmediate(channelName, { mentionedAgents } = {}) {
    if (_stopped || !isTickerEnabled()) return Promise.resolve();

    // per-channel 并发：同一频道内串行（避免重复处理），不同频道并发
    const existing = _channelDeliveries.get(channelName);
    if (existing && existing.abortCtrl && !existing.abortCtrl.signal.aborted) {
      log.log(`#${channelName} 新消息到达，abort 当前 delivery 并重新开始`);
      debugLog()?.log("ticker", `#${channelName} new message arrived, aborting current delivery to restart`);
      existing.abortCtrl.abort();
    }

    // 同一频道串行化：等前一个 delivery 完成后再启动新的
    const prevPromise = existing?.promise || Promise.resolve();
    const chainPromise = prevPromise.then(async () => {
      if (_stopped) return;

      const newAbortCtrl = new AbortController();
      _channelDeliveries.set(channelName, { promise: chainPromise, abortCtrl: newAbortCtrl });

      try {
        await _doDelivery(channelName, { mentionedAgents, signal: newAbortCtrl.signal });
      } catch (err) {
        log.error(`#${channelName} delivery 错误: ${err.message}`);
      } finally {
        // 只有当前 entry 还是自己时才清除（避免清除新启动的 delivery）
        if (_channelDeliveries.get(channelName)?.promise === chainPromise) {
          _channelDeliveries.delete(channelName);
        }
      }
    }).catch(() => {});

    _channelDeliveries.set(channelName, { promise: chainPromise, abortCtrl: null });
    return chainPromise;
  }

  function triggerReminder(channelName) {
    if (_stopped || !isTickerEnabled()) return Promise.resolve();

    // per-channel 并发：提醒也走 per-channel 锁
    const existing = _channelDeliveries.get(channelName);
    const prevPromise = existing?.promise || Promise.resolve();
    const chainPromise = prevPromise.then(async () => {
      if (_stopped) return;
      const channelFile = path.join(channelsDir, `${channelName}.md`);
      if (!fs.existsSync(channelFile) || !isProactiveEnabled(channelFile)) return;
      const proactiveAgentId = pickRandomAgent(channelName);
      if (!proactiveAgentId) return;

      const newAbortCtrl = new AbortController();
      _channelDeliveries.set(channelName, { promise: chainPromise, abortCtrl: newAbortCtrl });

      try {
        await _doDelivery(channelName, { proactiveAgentId, signal: newAbortCtrl.signal });
      } catch (err) {
        log.error(`#${channelName} reminder 错误: ${err.message}`);
      } finally {
        if (_channelDeliveries.get(channelName)?.promise === chainPromise) {
          _channelDeliveries.delete(channelName);
        }
      }
    }).catch(() => {});

    _channelDeliveries.set(channelName, { promise: chainPromise, abortCtrl: null });
    return chainPromise;
  }

  /**
   * 实际执行手机消息送达的内部方法（可被 abort）
   * signal 由调用方（triggerImmediate/triggerReminder）通过 per-channel 锁提供
   */
  async function _doDelivery(channelName, { mentionedAgents, proactiveAgentId = null, signal } = {}) {
    if (!isTickerEnabled()) return;
    // ── 1. 中断该频道正在运行的 cycle（per-channel，不干扰其他频道）──
    const chAbortCtrl = _channelAbortCtrls.get(channelName);
    if (chAbortCtrl) {
      chAbortCtrl.abort();
    }

    if (_timer) {
      clearTimeout(_timer);
      _timer = null;
    }

    const chCyclePromise = _channelCyclePromises.get(channelName);
    if (chCyclePromise) {
      await chCyclePromise.catch(() => {});
      _channelCyclePromises.delete(channelName);
    }

    // ── 2. signal 由调用方提供（per-channel 锁管理 AbortController）──
    if (!signal) {
      // 兜底：兼容旧调用方式
      const fallbackCtrl = new AbortController();
      signal = fallbackCtrl.signal;
    }

    // ── 3. 过滤 agent：频道 members 是唯一成员真相源，cursor 只表示读到哪儿 ──
    const channelFile = path.join(channelsDir, `${channelName}.md`);
    if (!fs.existsSync(channelFile)) {
      return;
    }
    const channelMembers = new Set(getChannelMembers(channelFile));
    const allAgents = getAgentOrder();
    const mentionedList = Array.from(new Set(
      Array.isArray(mentionedAgents)
        ? mentionedAgents.filter((agentId) => typeof agentId === "string" && agentId.trim()).map((agentId) => agentId.trim())
        : [],
    ));
    const mentionedSet = new Set(mentionedList);
    const hasMentions = mentionedSet.size > 0;
    const memberAgents = allAgents
      .filter(id => channelMembers.has(id))
      .sort((a, b) =>
        Number(b === proactiveAgentId) - Number(a === proactiveAgentId)
        || Number(mentionedSet.has(b)) - Number(mentionedSet.has(a)));
    let agents = proactiveAgentId
      ? memberAgents.filter(id => id === proactiveAgentId)
      : memberAgents;

    const deliveryLabel = proactiveAgentId
      ? `频道提醒 → ${proactiveAgentId}`
      : `新群聊消息 → 手机送达`;
    log.log(`${deliveryLabel} #${channelName}（${agents.length}/${allAgents.length} 个 agent${hasMentions ? `，优先 @ ${[...mentionedSet].join(",")}` : ""}）`);
    debugLog()?.log("ticker", `phone delivery #${channelName} (${agents.length} agents${proactiveAgentId ? `, proactive=${proactiveAgentId}` : ""}${hasMentions ? `, mentioned first: ${[...mentionedSet].join(",")}` : ""})`);

    // ── 4. 分批并发送达 agent：每批 BATCH_SIZE 个 agent 并行，组间串行 ──
    const BATCH_SIZE = 3; // 每批最多 3 个 agent 并行调用 LLM
    try {
      const maxChecks = readGuardLimit(channelFile, memberAgents.length);
      _activeDeliveries.set(channelName, {
        channelName,
        mode: proactiveAgentId ? "reminder" : "delivery",
        proactiveAgentId,
        agentCount: agents.length,
        memberCount: memberAgents.length,
        delivered: 0,
        checks: 0,
        maxChecks,
        startedAt: new Date().toISOString(),
        mentionedAgents: mentionedList,
      });
      let checks = 0;
      let proactiveDelivered = false;
      let expandedAfterProactiveReply = false;

      while (agents.length > 0 && checks < maxChecks) {
        // ★ 被 abort 了就停
        if (signal.aborted) {
          log.log(`#${channelName} 手机送达被中断，停止`);
          debugLog()?.log("ticker", `#${channelName} phone delivery aborted`);
          return;
        }

        // 构建本批次的 agent 任务列表
        const batchAgents = agents.slice(0, Math.min(BATCH_SIZE, maxChecks - checks));
        if (batchAgents.length === 0) break;

        // 为每个 agent 准备任务数据
        const tasks = [];
        for (const agentId of batchAgents) {
          if (!isCurrentChannelMember(channelFile, agentId)) continue;
          const channelsMdPath = path.join(agentsDir, agentId, "channels.md");
          const bookmarks = readBookmarks(channelsMdPath);
          const proactive = !proactiveDelivered && proactiveAgentId === agentId;
          const deliveryWindow = proactive
            ? {
              messages: getRecentMessages(channelFile, DEFAULT_UNREAD_DELIVERY_WINDOW, agentId),
              totalUnreadCount: 0,
              droppedUnreadCount: 0,
              bookmarkState: "proactive",
              bookmarkTimestamp: getLatestTimestamp(channelFile),
            }
            : buildChannelUnreadDeliveryWindow({
              channelFile,
              bookmark: bookmarks.get(channelName),
              agentId,
            });
          const unreadMsgs = deliveryWindow.messages;
          if (unreadMsgs.length === 0) continue;
          if (proactive) proactiveDelivered = true;

          checks += 1;
          log.log(`${proactive ? "提醒" : "送达"} ${agentId} → #${channelName}（${unreadMsgs.length} 条${proactive ? "最近消息" : "未读"}）`);
          tasks.push({ agentId, channelsMdPath, unreadMsgs, deliveryWindow, proactive });
        }

        if (tasks.length === 0) break;

        // 更新活跃状态
        const activeEntry = _activeDeliveries.get(channelName);
        if (activeEntry) {
          _activeDeliveries.set(channelName, {
            ...activeEntry,
            agentCount: agents.length,
            checks,
            batchAgents: tasks.map(t => t.agentId),
          });
        }

        // ★ 批内并发：多个 agent 同时调用 LLM
        const results = await Promise.all(
          tasks.map(async ({ agentId, channelsMdPath, unreadMsgs, deliveryWindow, proactive }) => {
            try {
              const result = await executeCheck(agentId, channelName, unreadMsgs, [], {
                signal,
                proactive,
                deliveryWindow,
                ...(hasMentions ? {
                  mentionedAgents: mentionedList,
                  mentionTargeted: mentionedSet.has(agentId),
                } : {}),
              });
              return { agentId, channelsMdPath, unreadMsgs, deliveryWindow, result, proactive };
            } catch (err) {
              if (signal.aborted) return null;
              log.error(`手机送达 ${agentId}/#${channelName} 失败: ${err.message}`);
              return null;
            }
          }),
        );

        if (signal.aborted) return;

        // 处理结果：更新 bookmark 和记忆摘要
        let replied = false;
        for (const entry of results) {
          if (!entry) continue;
          const { agentId, channelsMdPath, unreadMsgs, deliveryWindow, result, proactive } = entry;

          if (shouldAdvanceBookmark(result) && isCurrentChannelMember(channelFile, agentId)) {
            const bookmarkTs = bookmarkTimestampForDelivery(result, deliveryWindow, channelFile);
            if (bookmarkTs) {
              await updateBookmark(channelsMdPath, channelName, bookmarkTs);
            }
          }

          if (hasExplicitDecision(result) && onMemorySummarize) {
            await onMemorySummarize(agentId, channelName, {
              messages: unreadMsgs,
              replyContent: result?.replyContent || "",
            });
          }

          if (result?.replied) replied = true;
          if (result?.replied && proactiveAgentId && !expandedAfterProactiveReply) {
            agents = memberAgents;
            expandedAfterProactiveReply = true;
          }
        }

        if (!replied) break;
      }

      if (checks >= maxChecks) {
        log.warn(`#${channelName} phone delivery reached guard limit (${maxChecks})`);
        debugLog()?.warn?.("ticker", `phone delivery guard limit hit #${channelName} (${maxChecks} checks)`);
        onEvent?.("channel_delivery_guard", { channelName, maxChecks });
      }
    } finally {
      _activeDeliveries.delete(channelName);

      // ── 5. 恢复被中断的 cycle 或调度下一轮 ──
      // 放在 finally 里，这样即使 delivery 被 abort 也能恢复 checkpoint。
      // 但如果被 abort 了，由新的 delivery 负责恢复，这里跳过。
      if (!signal.aborted) {
        if (_checkpoint) {
          log.log(`恢复中断的 cycle（checkpoint agent=${_checkpoint.agentIdx} ch=${_checkpoint.channelIdx}）`);
          debugLog()?.log("ticker", `resuming cycle from checkpoint`);
          const resumedCycle = _runCycle();
          _channelCyclePromises.set(channelName, resumedCycle);
        } else {
          resetChannelReminder(channelName);
          _scheduleNext(PAUSE_MS);
        }
      }
    }
  }

  // ── 定时调度 ──

  /** 调度下一个 cycle */
  function _scheduleNext(_delayMs) {
    if (_stopped || !isTickerEnabled()) return;
    if (_timer) clearTimeout(_timer);
    refreshReminderSchedule();
    let nextChannel = null;
    let nextDueAt = Infinity;
    for (const [channelName, entry] of _reminderDueAt.entries()) {
      if (entry.dueAt < nextDueAt) {
        nextDueAt = entry.dueAt;
        nextChannel = channelName;
      }
    }
    if (!nextChannel) return;
    const delayMs = Math.max(0, nextDueAt - Date.now());
    _timer = setTimeout(() => {
      _timer = null;
      triggerReminder(nextChannel).finally(() => _scheduleNext());
    }, delayMs);
    if (_timer.unref) _timer.unref();

    log.log(`下次频道提醒：#${nextChannel}，${Math.round(delayMs / 1000)}秒后`);
  }

  function refreshSchedule() {
    if (_stopped) return;
    _scheduleNext();
  }

  /** 启动调度器 */
  function start() {
    if (_timer || _running) return;
    if (!isTickerEnabled()) return;
    _stopped = false;

    log.log(`调度器已启动（默认频道提醒间隔 ${DEFAULT_REMINDER_INTERVAL_MINUTES} 分钟）`);
    _scheduleNext();
  }

  /** 停止调度器 */
  async function stop() {
    _stopped = true; // 禁止新的 delivery
    if (_timer) {
      clearTimeout(_timer);
      _timer = null;
    }
    // 停止所有 per-channel delivery
    for (const [ch, entry] of _channelDeliveries) {
      if (entry.abortCtrl && !entry.abortCtrl.signal.aborted) {
        entry.abortCtrl.abort();
      }
    }
    // 等待所有 per-channel delivery 完成
    const allPromises = [..._channelDeliveries.values()].map(e => e.promise).filter(Boolean);
    await Promise.allSettled(allPromises);
    _channelDeliveries.clear();
    _activeDeliveries.clear();
    // 标记中断，让所有 per-channel cycle 尽快退出
    _interruptPending = true;
    for (const [, ctrl] of _channelAbortCtrls) {
      ctrl.abort();
    }
    _channelAbortCtrls.clear();
    const allChannelCycles = [..._channelCyclePromises.values()];
    _channelCyclePromises.clear();
    await Promise.allSettled(allChannelCycles.map(p => p.catch(() => {})));
    _interruptPending = false;
    _checkpoint = null;
  }

  return {
    start,
    stop,
    triggerImmediate,
    triggerReminder,
    refreshSchedule,
    snapshot,
    get isRunning() { return _running; },
  };
}
