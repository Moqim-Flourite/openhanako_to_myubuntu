#!/bin/bash
# HanaAgent 重启脚本
# 自动找到最新的 AppImage，杀掉旧进程，启动新的

APP_DIR="$HOME/Documents/myubuntu_claw/openhanako/dist"
APP_NAME="hanako-restart"

# 找最新的 AppImage
APPIMAGE=$(ls -t "$APP_DIR"/HanaAgent-*.AppImage 2>/dev/null | head -1)

if [ -z "$APPIMAGE" ]; then
    notify-send "$APP_NAME" "找不到 AppImage\n路径: $APP_DIR" -i dialog-error 2>/dev/null
    exit 1
fi

# 杀掉旧进程
pkill -f "HanaAgent.*AppImage" 2>/dev/null
sleep 2

# 启动新的
nohup "$APPIMAGE" > /dev/null 2>&1 &
