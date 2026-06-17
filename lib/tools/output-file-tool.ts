/**
 * output-file-tool.js — 文件暂存工具（stage_files）
 *
 * agent 声明持有文件，框架按上下文投递（桌面渲染 / bridge 发送）。
 * 服务端拦截 tool_execution_end 事件，通过 WebSocket 推送 file_output 事件给前端。
 *
 * 参数：{ filepaths: string[] }
 * 同时向下兼容旧的单文件调用：{ filePath: string, label?: string }
 */
import fs from "fs";
import path from "path";
import { Type } from "../pi-sdk/index.ts";
import { t } from "../i18n.ts";
import { getToolSessionPath } from "./tool-session.ts";
import { debugLog } from "../debug-log.ts";

/** 修正 LLM 常见的路径问题：转义空格、URL 编码、多余引号 */
function sanitizePath(p) {
  p = p.trim().replace(/^["']|["']$/g, "");
  p = p.replace(/\\ /g, " ");
  if (p.includes("%20")) {
    try { p = decodeURIComponent(p); } catch {}
  }
  return p;
}

export function createStageFilesTool({ registerSessionFile, getSessionPath, sendBridgeMedia, resolveBridgeOwnerChatId } = {}) {
  return {
    name: "stage_files",
    label: t("toolDef.outputFile.label"),
    description: t("toolDef.outputFile.description"),
    parameters: Type.Object({
      filepaths: Type.Optional(Type.Array(Type.String(), {
        minItems: 1,
        description: t("toolDef.outputFile.filepathsDesc"),
      })),
      // 向下兼容旧接口
      filePath: Type.Optional(Type.String({ description: t("toolDef.outputFile.filePathDesc") })),
      label: Type.Optional(Type.String({ description: t("toolDef.outputFile.labelDesc") })),
      // 跨会话投递目标：指定 platform/chatId/agentId 绕过 bridgeContext 限制
      bridgeTarget: Type.Optional(Type.Object({
        platform: Type.String({ description: "目标平台：qq / telegram / wechat / feishu" }),
        chatId: Type.Optional(Type.String({ description: "目标 chatId，不传则自动查 bridge owner" })),
        agentId: Type.Optional(Type.String({ description: "agentId，不传则用当前 agent" })),
      }, { description: "跨会话文件投递目标，用于频道会话向 bridge 平台主动发送文件" })),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      // 统一为路径数组：优先使用 filepaths，兼容 filePath
      let paths = params.filepaths;
      if (!paths || paths.length === 0) {
        if (params.filePath) {
          paths = [params.filePath];
        } else {
          return {
            content: [{ type: "text", text: t("error.outputFileNeedPaths") }],
            details: {},
          };
        }
      }

      const results = [];
      const errors = [];
      const sessionPath = registerSessionFile
        ? getToolSessionPath(ctx) || ctx?.sessionPath || getSessionPath?.() || null
        : null;

      // bridge 投递状态追踪
      const bridgeDelivery = { attempted: false, success: false, error: null, platform: null, skipped: null };
      const bridgeCtx = ctx?.bridgeContext;
      // bridgeTarget 参数：跨会话投递优先用它，不依赖 bridgeContext
      const bridgeTarget = params.bridgeTarget || null;
      let resolvedTarget = null;
      debugLog()?.log("bridge", `stage_files DEBUG: bridgeTarget=${JSON.stringify(bridgeTarget)}, bridgeCtx=${JSON.stringify(bridgeCtx)}, hasResolve=${!!resolveBridgeOwnerChatId}`);
      if (bridgeTarget?.platform) {
        let targetChatId = bridgeTarget.chatId;
        // chatId 缺失时自动从 bridge index 查 owner
        if (!targetChatId && resolveBridgeOwnerChatId) {
          try {
            targetChatId = resolveBridgeOwnerChatId(bridgeTarget.platform);
            debugLog()?.log("bridge", `stage_files DEBUG: resolveBridgeOwnerChatId("${bridgeTarget.platform}") = ${targetChatId}`);
          } catch (e) { debugLog()?.log("bridge", `stage_files DEBUG: resolveBridgeOwnerChatId threw: ${e.message}`); }
        }
        if (targetChatId) {
          resolvedTarget = {
            isBridgeSession: true,
            platform: bridgeTarget.platform,
            chatId: targetChatId,
            agentId: bridgeTarget.agentId || null,
            chatType: bridgeCtx?.chatType || "dm",
          };
        } else {
          bridgeDelivery.skipped = `bridgeTarget: could not resolve chatId for ${bridgeTarget.platform}`;
        }
      }

      for (const raw of paths) {
        const fp = sanitizePath(raw);

        if (!path.isAbsolute(fp)) {
          errors.push(t("error.outputFileNotAbsolute", { path: fp }));
          continue;
        }
        if (!fs.existsSync(fp)) {
          errors.push(t("error.outputFileNotFound", { path: fp }));
          continue;
        }

        const displayLabel = path.basename(fp);
        const ext = path.extname(fp).toLowerCase().replace(".", "");
        const label = params.label || displayLabel;
        if (registerSessionFile) {
          if (!sessionPath) {
            errors.push("stage_files requires an active sessionPath to register files");
            continue;
          }
          try {
            const sessionFile = await registerSessionFile({
              sessionPath,
              filePath: fp,
              label,
              origin: "stage_files",
            });
            results.push(toStageFileResult(sessionFile, { filePath: fp, label, ext }));

            // bridge 文件投递：优先用 bridgeTarget，回退到 bridgeCtx
            const effectiveBridge = resolvedTarget || (bridgeCtx?.isBridgeSession && bridgeCtx?.platform && bridgeCtx?.chatId ? bridgeCtx : null);
            if (effectiveBridge) {
              bridgeDelivery.attempted = true;
              bridgeDelivery.platform = effectiveBridge.platform;
              if (!sendBridgeMedia) {
                bridgeDelivery.error = "sendBridgeMedia callback not configured";
                debugLog()?.warn("bridge", `stage_files: sendBridgeMedia callback missing`);
              } else {
                try {
                  const fileId = sessionFile?.id || sessionFile?.fileId;
                  const isDm = effectiveBridge.chatType !== "group";
                  await sendBridgeMedia({
                    platform: effectiveBridge.platform,
                    chatId: effectiveBridge.chatId,
                    agentId: effectiveBridge.agentId,
                    isGroup: isDm ? false : true,
                    mediaItem: {
                      type: "session_file",
                      fileId,
                      sessionPath,
                      filePath: fp,
                      filename: path.basename(fp),
                      label,
                      mime: sessionFile?.mime,
                      size: sessionFile?.size,
                      kind: sessionFile?.kind,
                    },
                  });
                  bridgeDelivery.success = true;
                  debugLog()?.log("bridge", `stage_files: bridge delivery OK → ${effectiveBridge.platform}/${effectiveBridge.chatId}`);
                } catch (bridgeErr) {
                  bridgeDelivery.error = bridgeErr?.message || String(bridgeErr);
                  debugLog()?.warn("bridge", `stage_files bridge delivery failed: ${bridgeErr.message}`);
                }
              }
            } else {
              // 非 bridge 会话，记录跳过原因
              if (!bridgeCtx) {
                bridgeDelivery.skipped = "no bridgeContext";
              } else if (!bridgeCtx.isBridgeSession) {
                bridgeDelivery.skipped = "not a bridge session";
              } else if (!bridgeCtx.platform) {
                bridgeDelivery.skipped = "bridgeContext missing platform";
              } else if (!bridgeCtx.chatId) {
                bridgeDelivery.skipped = "bridgeContext missing chatId";
              }
            }
          } catch (err) {
            errors.push(err?.message || String(err));
          }
        } else {
          results.push({ filePath: fp, label, ext });
        }
      }

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: errors.join("\n") }],
          details: {},
        };
      }

      const summary = results.map(r => r.label).join(", ");
      // 构建 bridge 投递状态反馈
      let bridgeStatus = "";
      if (bridgeDelivery.attempted) {
        if (bridgeDelivery.success) {
          bridgeStatus = `\n[bridge] ✅ 已通过 ${bridgeDelivery.platform} 发送给用户`;
        } else {
          bridgeStatus = `\n[bridge] ❌ ${bridgeDelivery.platform} 文件投递失败: ${bridgeDelivery.error}`;
        }
      } else if (bridgeDelivery.skipped) {
        bridgeStatus = `\n[bridge] ⏭ 未投递（${bridgeDelivery.skipped}）`;
      }
      return {
        content: [{ type: "text", text: t("error.outputFilePresented", { summary }) + bridgeStatus }],
        details: {
          files: results,
          media: {
            ...(results.some(r => r.fileId) ? { items: results.map(toMediaItem).filter(Boolean) } : {}),
            mediaUrls: results.map(r => r.filePath),
          },
          bridgeDelivery: bridgeDelivery.attempted ? { platform: bridgeDelivery.platform, success: bridgeDelivery.success, error: bridgeDelivery.error } : undefined,
        },
      };
    },
  };
}

function toStageFileResult(sessionFile, legacy) {
  const fileId = sessionFile?.id || sessionFile?.fileId || null;
  return {
    ...(fileId ? { id: fileId, fileId } : {}),
    filePath: sessionFile?.filePath || legacy.filePath,
    label: legacy.label || sessionFile?.displayName || sessionFile?.label,
    ext: sessionFile?.ext || legacy.ext || "",
    ...(sessionFile?.mime ? { mime: sessionFile.mime } : {}),
    ...(sessionFile?.size !== undefined ? { size: sessionFile.size } : {}),
    ...(sessionFile?.kind ? { kind: sessionFile.kind } : {}),
    ...(sessionFile?.sessionPath ? { sessionPath: sessionFile.sessionPath } : {}),
    ...(sessionFile?.origin ? { origin: sessionFile.origin } : {}),
    ...(sessionFile?.storageKind ? { storageKind: sessionFile.storageKind } : {}),
    ...(sessionFile?.status ? { status: sessionFile.status } : {}),
    ...(sessionFile?.missingAt !== undefined ? { missingAt: sessionFile.missingAt } : {}),
    ...(sessionFile?.resource ? { resource: sessionFile.resource } : {}),
  };
}

function toMediaItem(file) {
  if (!file?.fileId) return null;
  return {
    type: "session_file",
    fileId: file.fileId,
    sessionPath: file.sessionPath,
    filePath: file.filePath,
    filename: path.basename(file.filePath),
    label: file.label,
    mime: file.mime,
    size: file.size,
    kind: file.kind,
  };
}
