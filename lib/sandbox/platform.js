/**
 * platform.js — 平台检测 + 沙盒工具可用性
 */

import { execFileSync } from "child_process";
import { createModuleLogger } from "../debug-log.js";

const log = createModuleLogger("platform");

/**
 * 检测当前平台应使用的沙盒类型
 * @returns {"seatbelt"|"bwrap"|"win32-full-access"|"unsupported"}
 */
export function detectPlatform() {
  const platform = process.platform;
  let sandbox;

  if (platform === "darwin") {
    sandbox = "seatbelt";
  } else if (platform === "linux") {
    sandbox = "bwrap";
  } else if (platform === "win32") {
    sandbox = "win32-full-access";
  } else {
    sandbox = "unsupported";
  }

  log.log(`detectPlatform: ${platform} → ${sandbox}`);
  return sandbox;
}

/**
 * 检查沙盒工具是否可用
 * @param {string} platform - 沙盒类型
 * @returns {boolean}
 */
export function checkAvailability(platform) {
  log.log(`checkAvailability: checking ${platform}`);

  try {
    if (platform === "seatbelt") {
      execFileSync("which", ["sandbox-exec"], { stdio: "ignore" });
      log.log(`checkAvailability: sandbox-exec found → available`);
      return true;
    }
    if (platform === "bwrap") {
      execFileSync("which", ["bwrap"], { stdio: "ignore" });
      // 额外检查 bubblewrap 版本和权限
      try {
        const version = execFileSync("bwrap", ["--version"], { encoding: "utf-8" }).trim();
        log.log(`checkAvailability: bwrap version → ${version}`);
      } catch (verErr) {
        log.warn(`checkAvailability: bwrap found but --version failed → ${verErr.message}`);
      }
      log.log(`checkAvailability: bwrap found → available`);
      return true;
    }
  } catch (err) {
    log.error(`checkAvailability: ${platform} not available → ${err.message}`);
    return false;
  }

  log.warn(`checkAvailability: unknown platform ${platform} → not available`);
  return false;
}
