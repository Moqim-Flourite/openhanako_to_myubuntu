# OpenHanako Linux 适配方案

## 项目概述

将 OpenHanako (v0.58.1) 从 macOS/Windows 适配到 Linux 平台，目标系统：Ubuntu 24.04.4 LTS

### 目标环境
- **系统**: Ubuntu 24.04.4 LTS
- **内核**: Linux 6.17.0-14-generic
- **桌面**: GNOME 46 + X11
- **硬件**: ASUS Vivobook M3401QA, AMD Ryzen 7 5800H, 16GB RAM

---

## 一、Linux 支持现状分析

### 1.1 已有 Linux 支持（代码层面）

✅ **沙盒系统** (`lib/sandbox/`)
- `platform.js`: 已定义 Linux → "bwrap" 映射
- `bwrap.js`: 已实现 bubblewrap 沙盒执行器
- `exec-helper.js`: 已支持 Linux 进程管理

✅ **核心架构**
- Node.js 后端 (跨平台)
- React 前端 (跨平台)
- SQLite 数据库 (跨平台)

### 1.2 缺失的 Linux 支持

❌ **构建系统** (`package.json`)
- 缺少 Linux 打包配置 (AppImage/deb/rpm)
- 缺少 `dist:linux` 脚本

❌ **Electron 主进程** (`desktop/main.cjs`)
- 窗口管理：缺少 Linux 标题栏逻辑
- 系统托盘：需要 Linux 桌面环境适配
- 应用更新：缺少 Linux 自动更新逻辑

❌ **前端平台检测** (`desktop/src/modules/platform.js`)
- Linux 桌面环境检测不完整
- 文件管理器打开命令不一致

❌ **原生依赖**
- `better-sqlite3`: 需要 electron-rebuild
- `bwrap`: 需要系统安装 bubblewrap

---

## 二、详细修改计划

### 2.1 依赖准备 (Phase 1)

```bash
# 系统依赖
sudo apt install -y bubblewrap libsecret-1-0 libsecret-1-dev

# Node.js 依赖
npm install --save-dev @electron/rebuild
```

### 2.2 构建系统修改 (Phase 2)

**文件**: `package.json`

添加 Linux 打包配置：
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
      "category": "Utility",
      "icon": "desktop/src/icon.png",
      "maintainer": "Your Name <your@email.com>",
      "artifactName": "${productName}-${version}-Linux-${arch}.${ext}",
      "desktop": {
        "StartupWMClass": "hanako",
        "Comment": "Personal AI Assistant with Memory and Soul"
      }
    }
  }
}
```

### 2.3 Electron 主进程修改 (Phase 3)

**文件**: `desktop/main.cjs`

#### 2.3.1 标题栏样式
```javascript
function titleBarOpts(trafficLight = { x: 16, y: 16 }) {
  if (process.platform === "darwin") {
    return { titleBarStyle: "hiddenInset", trafficLightPosition: trafficLight };
  }
  // Windows/Linux: 无框窗口 + 前端自绘 window controls
  return { frame: false };
}
```
✅ 已支持，无需修改

#### 2.3.2 系统托盘
```javascript
// 需要针对不同 Linux 桌面环境适配
function createTray() {
  const iconPath = process.platform === "linux"
    ? path.join(__dirname, "src", "icon.png")  // Linux 用 PNG
    : path.join(__dirname, "src", process.platform === "darwin" ? "icon.icns" : "icon.png");
  
  tray = new Tray(nativeImage.createFromPath(iconPath));
  // ...
}
```

#### 2.3.3 PATH 环境变量处理
```javascript
// 现有代码已处理 Linux/macOS 的 PATH 问题
if (process.platform !== "win32") {
  // 用登录 shell 解析完整 PATH
}
```
✅ 已支持

#### 2.3.4 文件管理器打开
```javascript
// 需要添加 Linux 分支
function showItemInFolder(fullPath) {
  if (process.platform === "darwin") {
    shell.showItemInFolder(fullPath);
  } else if (process.platform === "win32") {
    shell.showItemInFolder(fullPath);
  } else {
    // Linux: 使用 xdg-open 打开所在目录
    shell.openPath(path.dirname(fullPath));
  }
}
```

### 2.4 前端平台适配 (Phase 4)

**文件**: `desktop/src/modules/platform.js`

```javascript
// 添加 Linux 文件管理器支持
openFolder: (p) => {
  if (process.platform === "darwin") {
    shell.openExternal(`file://${p}`);
  } else if (process.platform === "win32") {
    shell.openExternal(`file:///${p.replace(/\\/g, '/')}`);
  } else {
    // Linux
    shell.openExternal(`file://${p}`);
  }
}
```

### 2.5 沙盒验证 (Phase 5)

**文件**: `lib/sandbox/bwrap.js`

验证 bubblewrap 沙盒是否正常工作：
```javascript
// 检查 bwrap 是否安装
import { execFileSync } from "child_process";

function checkBwrapAvailable() {
  try {
    execFileSync("which", ["bwrap"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
```

### 2.6 自动更新 (Phase 6)

Linux 不像 macOS/Windows 有统一的自动更新机制，建议：
- AppImage: 使用 AppImageUpdate 或提供下载链接
- deb/rpm: 提示用户通过包管理器更新

---

## 三、实施步骤

### Step 1: 环境准备
```bash
# 安装系统依赖
sudo apt update
sudo apt install -y bubblewrap libsecret-1-0 libsecret-1-dev python3 make g++

# 克隆项目（已完成）
cd /home/operit/openhanako

# 安装 Node.js 依赖
npm install

# 重新编译原生模块
npm run rebuild
```

### Step 2: 验证沙盒
```bash
# 检查 bwrap 是否可用
bwrap --version

# 测试沙盒
bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp echo "Sandbox OK"
```

### Step 3: 开发模式测试
```bash
# 启动开发服务器
npm run start:dev
```

### Step 4: 构建 Linux 包
```bash
# 构建 AppImage (推荐，通用性最好)
npm run dist:linux

# 或构建 deb (Ubuntu/Debian)
npm run dist:linux:deb
```

### Step 5: 测试运行
```bash
# 运行 AppImage
chmod +x Hanako-*-Linux-x64.AppImage
./Hanako-*-Linux-x64.AppImage

# 或安装 deb
sudo dpkg -i hanako_*_amd64.deb
```

---

## 四、风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| better-sqlite3 编译失败 | 中 | 使用 electron-rebuild |
| bubblewrap 权限问题 | 低 | 配置正确的用户权限 |
| GNOME 托盘集成 | 中 | 使用 libappindicator |
| 文件权限差异 | 低 | 添加权限检查 |

---

## 五、预期成果

1. ✅ Linux 下可运行的 AppImage/deb 包
2. ✅ 完整的沙盒隔离功能
3. ✅ 系统托盘支持
4. ✅ 文件关联和拖放支持
5. ✅ 自动检测并提示更新

---

## 六、后续优化

1. **Wayland 支持**: 验证 Wayland 环境下的兼容性
2. **多发行版测试**: Ubuntu, Fedora, Arch 等
3. **Flatpak 打包**: 提供更通用的分发方式
4. **性能优化**: 针对 Linux 内核优化

---

## 附录：相关文件清单

| 文件路径 | 修改类型 | 优先级 |
|----------|----------|--------|
| `package.json` | 添加 Linux 构建配置 | P0 |
| `desktop/main.cjs` | Linux 平台适配 | P0 |
| `desktop/src/modules/platform.js` | 前端平台检测 | P1 |
| `lib/sandbox/platform.js` | 验证 Linux 沙盒 | P0 |
| `lib/sandbox/bwrap.js` | 验证/修复沙盒逻辑 | P0 |
| `desktop/auto-updater.cjs` | Linux 更新逻辑 | P2 |
| `desktop/preload.cjs` | Linux IPC 适配 | P1 |

---

**文档版本**: 1.0  
**创建时间**: 2026-03-22  
**目标平台**: Ubuntu 24.04.4 LTS (GNOME 46 + X11)
