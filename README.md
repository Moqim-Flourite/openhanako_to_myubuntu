# OpenHanako for Ubuntu Linux 🐧

> 将 OpenHanako 适配到 Linux 平台，专为 Ubuntu 24.04.4 LTS 优化

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Ubuntu%2024.04-orange.svg)](https://github.com/Moqim-Flourite/openhanako_to_myubuntu)

---

## 🎯 项目目标

将 [OpenHanako](https://github.com/liliMozi/openhanako) 从 macOS/Windows 适配到 Linux 平台。

### 目标环境
- **系统**: Ubuntu 24.04.4 LTS
- **内核**: Linux 6.17.0-14-generic
- **桌面**: GNOME 46 + X11
- **硬件**: ASUS Vivobook M3401QA, AMD Ryzen 7 5800H, 16GB RAM

---

## ✅ 适配进度

| 模块 | 状态 | 说明 |
|------|------|------|
| 沙盒系统 (bubblewrap) | ✅ 已完成 | 原项目已实现 |
| 平台检测 | ✅ 已完成 | 原项目已实现 |
| 构建系统 | 🔄 进行中 | 添加 Linux 打包配置 |
| Electron 主进程 | 🔄 进行中 | Linux 平台适配 |
| 系统托盘 | 📋 待开始 | GNOME 桌面集成 |
| 自动更新 | 📋 待开始 | Linux 更新机制 |

---

## 🚀 快速开始

### 依赖安装

```bash
# 系统依赖
sudo apt update
sudo apt install -y bubblewrap libsecret-1-0 libsecret-1-dev python3 make g++

# Node.js 依赖
npm install

# 重新编译原生模块
npm run rebuild
```

### 开发模式

```bash
npm run start:dev
```

### 构建 Linux 包

```bash
# AppImage (推荐)
npm run dist:linux

# deb 包
npm run dist:linux:deb
```

---

## 📁 项目结构

```
openhanako_to_myubuntu/
├── docs/                    # 适配文档
│   └── README_LINUX_PLAN.md # 详细适配方案
├── core/                    # 引擎编排层
├── lib/                     # 核心库
│   ├── sandbox/            # 沙盒系统 (bwrap 已实现)
│   └── ...
├── desktop/                 # Electron 应用
│   ├── main.cjs            # 主进程 (需Linux适配)
│   └── src/                # React 前端
├── server/                  # Fastify 服务端
└── package.json            # 项目配置 (已添加Linux构建)
```

---

## 🆕 最近更新

### 工具治理与子代理能力增强（2026-04）

本轮更新开始将 Hanako 的工具系统往更接近 Claude Code 的治理方式推进，重点不是增加单个工具数量，而是补齐“工具元信息 → 权限策略 → 确认流程 → 前端可视化”这一整层运行时能力。

#### 已完成内容

- **新增统一 Tool Meta 层**
  - 为工具补充 `category`、`readOnly`、`destructive`、`concurrencySafe`、`requiresConfirmation`、`tags` 等元信息
  - 已接入 `web_search`、`todo`、`browser`、`delegate` 等代表性工具
  - `Agent.tools` 聚合时会自动补全默认 meta

- **新增 Tool Policy（工具权限模式）**
  - 支持三种策略模式：
    - `full`：完全权限
    - `safe`：安全模式（过滤高风险 custom tools）
    - `read-only`：只读模式
  - 已接入 `engine.buildTools()`、隔离执行、Bridge 执行链、sub-agent 委派链

- **Browser 高风险动作确认**
  - `browser.navigate`
  - `browser.evaluate`
  - 在执行前会触发阻塞确认，等待用户批准/拒绝

- **新增通用工具确认链路**
  - 服务端支持 `tool_confirmation`
  - 前端支持工具确认卡片
  - 用户可直接在聊天界面确认或拒绝高风险工具动作

- **Delegate（子代理）支持三层模式**
  - `read-only`：只读子代理
  - `safe`：安全子代理
  - `full`：完全权限子代理
  - 前端工具卡片已支持中文显示：
    - `子代理·只读`
    - `子代理·安全`
    - `子代理·完全`

- **前端工具治理可视化**
  - 工具标签改为中文展示，例如：
    - `搜索`
    - `浏览器`
    - `记忆`
    - `设置`
    - `只读`
    - `需确认`
    - `高风险`

#### 当前意义

这部分改造的目标，是把 Hanako 从“有一组工具的 Agent”逐步推进成“具备工具权限治理、风险控制、确认流程和前端可解释性的 Agent Runtime”。

后续会继续把更多高风险工具（如设置修改、技能安装、未来可能的写文件/执行命令能力）纳入统一策略层。

---

## 🔧 主要修改

### 1. package.json - 添加 Linux 构建配置

```json
{
  "scripts": {
    "dist:linux": "npm run build:renderer && electron-builder --linux",
    "dist:linux:appimage": "npm run build:renderer && electron-builder --linux AppImage",
    "dist:linux:deb": "npm run build:renderer && electron-builder --linux deb"
  },
  "build": {
    "linux": {
      "target": ["AppImage", "deb"],
      "category": "Utility"
    }
  }
}
```

### 2. 沙盒系统 - 已支持

原项目已在 `lib/sandbox/` 中实现了 Linux bubblewrap 沙盒：
- `platform.js`: Linux → "bwrap" 映射
- `bwrap.js`: bubblewrap 执行器
- `exec-helper.js`: 跨平台进程管理

---

## 📚 相关文档

- [Linux 适配详细方案](docs/README_LINUX_PLAN.md)
- [原项目 README](README_CN.md)
- [贡献指南](CONTRIBUTING.md)

---

## 🙏 致谢

本项目基于 [liliMozi/openhanako](https://github.com/liliMozi/openhanako) 开发，感谢原作者的优秀工作！

---

## 📄 许可证

[Apache License 2.0](LICENSE)
