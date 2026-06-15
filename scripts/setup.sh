#!/bin/bash
# ============================================================
# 橘与杏中医生活 — 项目部署设置脚本
# 运行: bash scripts/setup.sh
# ============================================================

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║       橘与杏中医生活 · 项目部署助手                  ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# 步骤 1: 检查 AppID
echo "📋 步骤 1/4 — 检查小程序 AppID"
APPID=$(grep '"appid"' project.config.json | head -1 | sed 's/.*"appid"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/')
if [ "$APPID" = "your-app-id" ]; then
  echo "  ⚠️   AppID 尚未填写"
  echo "  请在 project.config.json 中将 \"your-app-id\" 替换为你的真实 AppID"
  echo "  路径: $(pwd)/project.config.json"
else
  echo "  ✅ AppID: $APPID"
fi
echo ""

# 步骤 2: 检查云环境 ID
echo "📋 步骤 2/4 — 检查云环境 ID"
ENV_IN_APP=$(grep "envId" miniprogram/app.js | head -1 | sed 's/.*envId:[[:space:]]*["'\'']\(.*\)["'\''].*/\1/')
ENV_IN_CONFIG=$(grep '"envId"' cloudbaserc.json | head -1 | sed 's/.*"envId"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/')
if [ "$ENV_IN_APP" = "your-env-id" ] || [ "$ENV_IN_CONFIG" = "your-env-id" ]; then
  echo "  ⚠️   云环境 ID 尚未填写"
  echo "  请在以下文件中将 \"your-env-id\" 替换为云开发环境 ID:"
  echo "    - $(pwd)/miniprogram/app.js (第 7 行)"
  echo "    - $(pwd)/cloudbaserc.json (第 2 行)"
else
  echo "  ✅ app.js: $ENV_IN_APP"
  echo "  ✅ cloudbaserc.json: $ENV_IN_CONFIG"
fi
echo ""

# 步骤 3: 检查云函数依赖
echo "📋 步骤 3/4 — 检查云函数依赖"
ALL_OK=true
for dir in cloudfunctions/*/; do
  name=$(basename "$dir")
  if [ -d "${dir}node_modules/wx-server-sdk" ]; then
    echo "  ✅ $name"
  else
    echo "  ⚠️   $name — 缺少依赖，正在安装..."
    (cd "$dir" && npm install --production 2>/dev/null)
    if [ -d "${dir}node_modules/wx-server-sdk" ]; then
      echo "      → 安装完成"
    else
      echo "      → 安装失败，请手动在 $dir 中运行 npm install"
      ALL_OK=false
    fi
  fi
done
if $ALL_OK; then echo "  全部云函数依赖已就绪"; fi
echo ""

# 步骤 4: 部署指南
echo "📋 步骤 4/4 — 部署指南"
echo ""
echo "  完成以上配置后，请在微信开发者工具中："
echo ""
echo "  ┌─────────────────────────────────────────────────────┐"
echo "  │  1. 导入项目 → 选择 $(pwd)            │"
echo "  │  2. 点击顶部「云开发」→ 开通/选择环境              │"
echo "  │  3. 在云控制台创建以下 8 个集合:                    │"
echo "  │     users / products / orders / cart               │"
echo "  │     addresses / commissions / withdrawals          │"
echo "  │     admin_config                                    │"
echo "  │  4. 部署所有云函数：                                │"
echo "  │     云控制台 → 云函数 → 右键「上传并部署」        │"
echo "  │     部署顺序: init → login → product → cart        │"
echo "  │              → order → pay → agent → commission     │"
echo "  │              → withdrawal → admin                   │"
echo "  │  5. 运行 init 函数：                                │"
echo "  │     云控制台 → 云函数 → init → 测试                 │"
echo "  │     参数: {\"action\": \"init\"}                   │"
echo "  │  6. 设置管理员 openId：                              │"
echo "  │     云控制台 → 数据库 → admin_config                │"
echo "  │     将 \"openId\" 替换为你的微信 openId             │"
echo "  │  7. 点击「编译」预览小程序                           │"
echo "  └─────────────────────────────────────────────────────┘"
echo ""
echo "============================================================"
