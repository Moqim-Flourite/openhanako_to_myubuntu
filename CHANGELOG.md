# Changelog
All notable changes to this project will be documented in this file.

## [0.58.1-linux.7] - 2026-03-23
### Added
- **手动输入模型 ID 功能**: 在 Onboarding 模型选择页面添加手动输入选项
  - 复选框切换手动输入模式（中英文双语）
  - 当模型列表为空或找不到模型时，可手动输入模型 ID
  - 参考 Operit 设计理念：模型名称输入框始终可编辑，不依赖模型列表获取成功与否
### Fixed
- 修复自定义 API 提供商（如联通 GLM5，anthropic-messages API）模型列表为空时无法继续配置的问题

## [0.58.1-linux.5] - 2026-03-23
### Fixed
- **anthropic-messages API 建议模型列表**: 当自定义 provider 使用 anthropic-messages API 且无法获取模型列表时，返回一组常见的 Anthropic 兼容模型 ID 作为建议
  - Claude 系列：claude-3-5-sonnet, claude-3-5-haiku, claude-3-opus
  - GLM 系列：glm-4-plus, glm-4, glm-4-flash

## [0.58.1-linux.4] - 2026-03-23

### Fixed
- **自定义 provider 模型列表问题**: 修复自定义 provider (anthropic-messages API) 无法获取模型列表的问题
- 现在会从 `providers.yaml` 的 `models` 字段读取模型列表

---

## [0.58.1-linux.3] - 2026-03-22

### Fixed
- **Linux 打包配置简化**: 移除冗余的 desktop/appImage/deb 配置项，修复打包失败问题

---

## [0.58.1-linux.2] - 2026-03-22

### Added
- **调试日志增强**: 为 Linux 沙盒相关模块添加详细的持久化日志
  - `platform.js`: 平台检测和工具可用性检查日志
  - `bwrap.js`: bubblewrap 执行生命周期和参数构建日志
  - `exec-helper.js`: 进程 spawn/kill 操作和状态日志
  - `index.js`: 沙盒工具创建和平台选择日志
  - `policy.js`: 策略推导和路径计数日志
  - `path-guard.js`: 访问权限检查结果日志

### Technical Details
- 所有日志使用 `createModuleLogger()` 写入 `~/.hanako/logs/` 目录
- 日志格式: `[HH:MM:SS.mmm] [LEVEL] [MODULE] message`
- 支持日志去重和隐私清洗（自动隐藏 token、密钥等敏感信息）
- 日志文件按启动时间戳命名，自动清理 7 天前的旧日志

---

## [0.58.1-linux.1] - 2026-03-22

### Added
- **Linux 构建支持**: 添加 AppImage 和 deb 打包配置
- **Linux 沙盒支持**: 验证 bubblewrap (bwrap) 沙盒功能正常
- **Linux 桌面集成**: 添加 .desktop 文件配置

### Changed
- **package.json**: 
  - 添加 `dist:linux`, `dist:linux:appimage`, `dist:linux:deb`, `dist:linux:rpm` 脚本
  - 添加 `linux` 构建配置
  - 更新 `publish` 配置指向新仓库
  - 添加 contributors 信息
  - 版本号更新为 `0.58.1-linux.1`

### Platform Support
| Platform | Status | Notes |
|----------|--------|-------|
| macOS (Apple Silicon) | ✅ Supported | Original support |
| Windows | ✅ Supported | Original support |
| **Linux (Ubuntu 24.04)** | ✅ Added | AppImage + deb |
| Linux (Other distros) | 🔄 Testing | Should work with bwrap |

### Technical Details
- 沙盒系统使用 `bubblewrap` 实现 Linux 隔离
- 平台检测通过 `lib/sandbox/platform.js` 自动识别
- 所有核心模块（Node.js/React/SQLite）均为跨平台

---

## [0.58.1] - Original Release

Based on [liliMozi/openhanako](https://github.com/liliMozi/openhanako) v0.58.1

### Features
- AI Agent with memory and personality
- Multi-agent collaboration
- Desktop GUI (Electron)
- Multi-platform support (macOS/Windows)
- Sandbox security (Seatbelt/bwrap)
