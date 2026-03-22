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
