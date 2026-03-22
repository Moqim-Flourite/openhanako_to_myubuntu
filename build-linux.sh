#!/bin/bash
# OpenHanako Linux 构建脚本
# 在真实 Ubuntu 终端中执行此脚本

set -e

echo "=== OpenHanako Linux 构建脚本 ==="
echo "目标系统: Ubuntu 24.04.4 LTS"
echo ""

# 检查依赖
echo "[1/5] 检查系统依赖..."
command -v bwrap >/dev/null 2>&1 || { echo "安装 bubblewrap..."; sudo apt install -y bubblewrap; }
command -v node >/dev/null 2>&1 || { echo "请先安装 Node.js 20+"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "请先安装 npm"; exit 1; }

# 安装依赖
echo "[2/5] 安装 npm 依赖..."
npm install

# 编译原生模块
echo "[3/5] 编译原生模块 (better-sqlite3)..."
npm run rebuild

# 构建前端
echo "[4/5] 构建前端..."
npm run build:renderer

# 构建 Linux 包
echo "[5/5] 构建 Linux 包..."
echo "选择构建目标:"
echo "  1) AppImage (推荐)"
echo "  2) deb (Ubuntu/Debian)"
echo "  3) 全部"
read -p "请输入选项 [1-3]: " choice

case $choice in
    1) npm run dist:linux:appimage ;;
    2) npm run dist:linux:deb ;;
    3) npm run dist:linux ;;
    *) echo "无效选项，构建 AppImage..."; npm run dist:linux:appimage ;;
esac

echo ""
echo "=== 构建完成! ==="
echo "输出目录: dist/"
ls -la dist/ 2>/dev/null || echo "请检查 dist/ 目录"
