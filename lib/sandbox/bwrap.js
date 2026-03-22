/**
 * bwrap.js — Linux bubblewrap 沙盒
 *
 * 构造 bwrap 参数，用 argv 数组直接 spawn。
 * 返回符合 Pi SDK BashOperations.exec 接口的函数。
 */

import fs from "fs";
import path from "path";
import os from "os";
import { spawnAndStream } from "./exec-helper.js";
import { writeScript, cleanup } from "./script.js";
import { createModuleLogger } from "../debug-log.js";

const log = createModuleLogger("bwrap");

/**
 * 创建 Linux 沙盒化的 exec 函数
 * @param {object} policy  从 deriveSandboxPolicy() 得到
 * @returns {(command, cwd, opts) => Promise<{exitCode}>}
 */
export function createBwrapExec(policy) {
  log.log(`createBwrapExec: policy mode=${policy?.mode}, writablePaths=${policy?.writablePaths?.length || 0}, protectedPaths=${policy?.protectedPaths?.length || 0}`);

  return async (command, cwd, { onData, signal, timeout, env }) => {
    const { scriptPath } = writeScript(command, cwd);
    log.log(`exec: script=${scriptPath}, cwd=${cwd}, timeout=${timeout || "none"}`);

    const args = buildArgs(policy, env);
    log.log(`exec: bwrap args count=${args.length}, writable=${policy?.writablePaths?.join(",") || "none"}`);

    try {
      const result = await spawnAndStream(
        "bwrap",
        [...args, "--", "/bin/bash", scriptPath],
        { cwd, env, onData, signal, timeout },
      );
      log.log(`exec: completed with exitCode=${result.exitCode}`);
      return result;
    } catch (err) {
      log.error(`exec: failed → ${err.message}`);
      throw err;
    } finally {
      cleanup(scriptPath);
    }
  };
}

/**
 * 构造 bwrap 参数
 */
function buildArgs(policy, env) {
  const args = [
    "--ro-bind", "/", "/",
    "--dev", "/dev",
    "--proc", "/proc",
    "--tmpfs", "/tmp",
    "--unshare-pid",
    "--unshare-net",
    "--new-session",
    "--die-with-parent",
  ];

  log.log(`buildArgs: base args set (${args.length} items)`);

  // 可写路径：覆盖为可写绑定
  let writableCount = 0;
  for (const p of policy.writablePaths) {
    if (fs.existsSync(p)) {
      args.push("--bind", p, p);
      writableCount++;
    } else {
      log.warn(`buildArgs: writable path does not exist → ${p}`);
    }
  }
  if (writableCount > 0) {
    log.log(`buildArgs: added ${writableCount} writable binds`);
  }

  // 受保护路径：在可写范围内再覆盖为只读
  let protectedCount = 0;
  for (const p of policy.protectedPaths) {
    if (fs.existsSync(p)) {
      args.push("--ro-bind", p, p);
      protectedCount++;
    }
  }
  if (protectedCount > 0) {
    log.log(`buildArgs: added ${protectedCount} protected ro-binds`);
  }

  // 读取拒绝：文件绑 /dev/null，目录绑 tmpfs
  let denyCount = 0;
  for (const p of policy.denyReadPaths) {
    if (!fs.existsSync(p)) continue;
    try {
      if (fs.statSync(p).isDirectory()) {
        args.push("--tmpfs", p);
        denyCount++;
      } else {
        args.push("--ro-bind", "/dev/null", p);
        denyCount++;
      }
    } catch (err) {
      log.warn(`buildArgs: deny path check failed → ${p}: ${err.message}`);
    }
  }
  if (denyCount > 0) {
    log.log(`buildArgs: added ${denyCount} deny entries`);
  }

  // 缓存目录：确保 npm/pip 等能正常写缓存（临时可写，进程结束即丢弃）
  const home = env?.HOME || os.homedir();
  const cacheDirs = [
    path.join(home, ".cache"),
    path.join(home, ".npm"),
  ];
  let cacheCount = 0;
  for (const d of cacheDirs) {
    const isWritable = policy.writablePaths.some(
      (w) => d === w || d.startsWith(w + path.sep),
    );
    if (!isWritable && fs.existsSync(d)) {
      args.push("--tmpfs", d);
      cacheCount++;
    }
  }
  if (cacheCount > 0) {
    log.log(`buildArgs: added ${cacheCount} cache tmpfs mounts`);
  }

  log.log(`buildArgs: total ${args.length} arguments`);
  return args;
}
