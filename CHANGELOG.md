# Changelog

All notable changes to this project will be documented in this file.

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
