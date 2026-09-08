#!/usr/bin/env bash
# macOS/Linux 入口；Windows、macOS、Linux 均可直接运行 node install.mjs。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js。请先安装 Node.js >= 20（包含 npm）：https://nodejs.org/" >&2
  exit 1
fi
exec node "$SCRIPT_DIR/install.mjs" "$@"
