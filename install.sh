#!/usr/bin/env bash
# figma-canvas-writer 一键安装脚本
# 完成：依赖安装 + token 生成 + 引导用户完成 Figma 插件导入
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_DIR="$SCRIPT_DIR/bridge"
BRIDGE_PATH="$BRIDGE_DIR/mcp-bridge.js"

echo "=============================================="
echo "  Figma Canvas Writer 安装"
echo "=============================================="
echo ""

# 1. 检查 Node
if ! command -v node >/dev/null 2>&1; then
  echo "❌ 未检测到 Node.js（需要 >= 18）"
  echo "   请先安装：https://nodejs.org/"
  exit 1
fi
NODE_VER=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [ "$NODE_VER" -lt 18 ]; then
  echo "❌ Node 版本过低（$NODE_VER < 18），请升级 Node.js"
  exit 1
fi
echo "✅ Node.js v$(node -v)"

# 2. 安装桥接依赖
echo ""
echo "📦 安装桥接依赖..."
cd "$BRIDGE_DIR"
if [ -d node_modules ]; then
  echo "   node_modules 已存在，跳过 npm install"
else
  npm install --silent 2>&1 | tail -3
fi
echo "✅ 依赖就绪"

# 3. 生成 token（与 mcp-bridge.js 的目录选择逻辑一致：LEGACY 目录优先）
echo ""
echo "🔑 初始化鉴权 token..."
if [ -d "$HOME/.dsh-figma-bridge" ]; then
  CONFIG_DIR="$HOME/.dsh-figma-bridge"
else
  CONFIG_DIR="${FIGMA_BRIDGE_HOME:-$HOME/.figma-canvas-writer}"
fi
TOKEN_FILE="$CONFIG_DIR/bridge-token"
if [ ! -f "$TOKEN_FILE" ]; then
  node -e '
    const fs=require("fs"),path=require("path"),crypto=require("crypto");
    const dir=process.argv[1];
    fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const f=path.join(dir,"bridge-token");
    if(!fs.existsSync(f)){fs.writeFileSync(f, crypto.randomBytes(32).toString("hex"), {mode:0o600});}
  ' "$CONFIG_DIR"
fi
chmod 600 "$TOKEN_FILE" 2>/dev/null || true
echo "✅ 鉴权 token 已就绪（token 不再需要手动复制）"
echo ""

# 4. 引导 Figma 插件导入 + 配对
echo "=============================================="
echo "  下一步（手动，约 1 分钟）"
echo "=============================================="
echo "1. 打开 Figma 桌面 App"
echo "2. 菜单 → Plugins → Development → Import plugin from manifest"
echo "3. 选择这个文件："
echo "   $SCRIPT_DIR/plugin/manifest.json"
echo "4. 打开任意设计文件，运行插件 'Figma Canvas Writer'"
echo "5. 插件面板会显示「6 位配对码」输入框"
echo ""
echo "⚠️ 配对码如何获取："
echo "   首次启动桥接时会打印 6 位配对码（stderr），"
echo "   在插件面板输入该配对码即可完成配对，真 token 自动下发，无需复制。"
echo ""

# 5. 提示各 agent 配置
echo "=============================================="
echo "  接入你的 Agent（选一个）"
echo "=============================================="
echo "配置示例已生成在 $SCRIPT_DIR/config-examples/"
echo ""
echo "Claude Desktop → 复制 claude_desktop_config.json 内容到 ~/Library/Application Support/Claude/claude_desktop_config.json"
echo "Cursor        → 复制 cursor-mcp.json 到 ~/.cursor/mcp.json"
echo "Codex         → 追加 codex-config.toml 到 ~/.codex/config.toml"
echo "Windsurf      → 复制 windsurf-mcp_config.json 到 ~/.windsurf/mcp_config.json"
echo "VS Code       → 复制 vscode-mcp.json 到 .vscode/mcp.json"
echo "DSH           → 追加 dsh-cordis-patch.yml 到 ~/.dsh/profiles/desktop/cordis.patch.yml"
echo ""
echo "桥接服务会由 agent 通过 stdio 自动拉起，无需手动常驻。"
echo ""
echo "✅ 安装完成！"
