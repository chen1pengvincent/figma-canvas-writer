# Figma Canvas Writer

> 让**任何 MCP agent** 都能编辑 Figma 画布内容（创建/修改/删除节点、编辑文本、改属性）——零依赖、单进程、可审计。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-stdio%20server-blue)](https://modelcontextprotocol.io/)

---

## 是什么

DSH 这类 AI 助手（MCP agent）目前只能**读** Figma 画布（通过 Figma Dev Mode MCP），不能写。这个组件填补了"写"的缺口：

- **写入**：在画布上创建/修改/删除节点（矩形/椭圆/文本/框架/线条）、编辑文本内容、改白名单属性
- **通用**：任何支持 MCP stdio 的 agent 都能用（Claude Desktop / Cursor / Codex / Windsurf / VS Code Copilot / DSH / …）
- **极简依赖**：桥接服务只依赖 `ws`（单个零依赖包），无 `@modelcontextprotocol/sdk`（92 个传递包）
- **安全**：token 不过剪贴板（6 位配对码换真 token）、只绑 127.0.0.1、白名单命令、限流、审计日志

## 架构

```
任意 MCP agent → MCP stdio → mcp-bridge.js → WebSocket(127.0.0.1:9753) → Figma 插件(code.js)
                     ↑                                              ↓
              （手写 JSON-RPC 2.0）                        （Plugin API 写画布）
```

- **插件**：普通 Figma 插件（`editorType: figma`），有画布写权限，WebSocket 客户端
- **桥接**：标准 MCP stdio server（任何 agent 都能调）+ WebSocket server（插件连它）
- **无框架依赖**：桥接用 Node 内置模块手写 JSON-RPC，无 `@modelcontextprotocol/sdk`

## 特性

| 特性 | 说明 |
|---|---|
| 🎨 画布写入 | 创建/修改/删除节点、编辑文本、改属性 |
| 🔌 通用 MCP | 任何 stdio MCP agent 都能接 |
| 📦 零依赖 | 桥接只依赖 `ws`（1 个包）|
| 🔒 安全 | 配对码（token 不过剪贴板）+ 白名单 + 限流 + 审计 |
| 🔄 自动拉起 | agent spawn 时自动启动桥接，无需手动常驻 |
| 🔁 token 轮换 | `--rotate-token` 作废旧 token |

## 快速开始

### 一键安装

```bash
git clone <本仓库>
cd figma-canvas-writer
bash install.sh
```

脚本自动完成：Node 检查 → 依赖安装 → token 初始化 → 引导 Figma 插件导入 + 配对 + agent 配置。

### 手动安装（4 步）

1. **装依赖**：`cd bridge && npm install`（只装 `ws`，1 个包）
2. **Figma 装插件**：Figma 桌面 App → Plugins → Development → Import plugin from manifest → 选 `plugin/manifest.json`
3. **配对**：Figma 里打开设计文件 → 运行插件 "Figma Canvas Writer" → 面板输入 **6 位配对码**（桥接首次启动时打印在 stderr，10 分钟有效）→ 状态变绿
4. **接入 agent**：选一个配置示例（`config-examples/`）合并进你的 agent MCP 配置

> 桥接服务由 agent 通过 stdio **自动拉起**，无需手动常驻。

## 接入你的 Agent

配置示例在 `config-examples/`，覆盖主流 MCP agent：

| Agent | 配置文件 |
|---|---|
| Claude Desktop | `config-examples/claude_desktop_config.json` |
| Cursor | `config-examples/cursor-mcp.json` |
| Codex | `config-examples/codex-config.toml` |
| Windsurf | `config-examples/windsurf-mcp_config.json` |
| VS Code Copilot | `config-examples/vscode-mcp.json` |
| DSH | `config-examples/dsh-cordis-patch.yml` |

**核心配置**（通用，替换占位符）：
```json
{
  "mcpServers": {
    "figma-canvas-writer": {
      "command": "<Node 绝对路径>",
      "args": ["<本仓库路径>/bridge/mcp-bridge.js"]
    }
  }
}
```

> macOS GUI 启动的 agent（Claude Desktop/Cursor 等）PATH 极简，`command` 必须用 node 的绝对路径（用 `node -e 'console.log(process.execPath)'` 查询）。

## 工具清单（7 个）

| 工具 | 说明 |
|---|---|
| `figma_canvas_status` | 检查插件连接状态（写操作前置检查） |
| `figma_create_node` | 创建节点（RECTANGLE/ELLIPSE/TEXT/FRAME/LINE） |
| `figma_modify_node` | 改白名单属性（name/x/y/width/height/rotation/opacity/visible/fills/strokes/strokeWeight/cornerRadius） |
| `figma_delete_node` | 删除节点 |
| `figma_set_text` | 编辑文本内容/字体/字号 |
| `figma_get_node` | 读节点摘要（写后校验用） |
| `figma_get_selection` | 当前选中节点列表 |

## 多 Agent 同时使用（端口隔离）

默认端口 `9753`。同时配多个 agent 时，每个 agent 用不同端口：

```json
{
  "mcpServers": {
    "figma-canvas-writer": {
      "command": "<Node 绝对路径>",
      "args": ["<本仓库路径>/bridge/mcp-bridge.js"],
      "env": { "FIGMA_BRIDGE_PORT": "9754" }
    }
  }
}
```

> 插件只连一个端口（默认 9753），多 agent 配不同端口时插件只服务其中一个。多 agent 并发场景建议拆分常驻 daemon + 薄 stdio 转发（见架构演进）。

## 安全模型

- **配对码鉴权**：6 位一次性配对码（CSPRNG、10 分钟 TTL、单次有效）换取真 token；token 只经 127.0.0.1 WS 帧下发，**不过剪贴板**
- **白名单命令**：只允许 ping/getSelection/getNodeInfo/createNode/modifyNode/deleteNode/setText
- **白名单属性**：节点属性严格白名单，防原型链污染
- **限流**：20 cmd/s 令牌桶
- **审计**：JSON Lines 日志（`~/.figma-canvas-writer/audit.log`，0600）
- **网络**：只允许 `ws://127.0.0.1:9753`（Figma `networkAccess` 强制）
- **撤销**：所有写操作可被 Figma Cmd+Z 撤销
- **token 轮换**：`node bridge/mcp-bridge.js --rotate-token` 作废旧 token

### 已知限制

- 只对当前页生效，不支持跨页/跨文件
- LINE 节点高度为 0，resize 的 height 无效
- 文本节点统一单一字体（规避 figma.mixed 无法加载）
- 需要用户有文件编辑权限（纯查看席位只读）
- **双向鉴权未实现**：本场景（单 agent/单用户/本地回环）下，能抢绑 9753 的进程本来就能读 0600 的 token 文件，HMAC 双向鉴权边际收益低且引入加密原语风险，故不做

## 对抗式审查记录

本组件经多轮对抗式审查（K3 规划/验收/复审 + 三路并行审查）：

1. **规划层**：修正 Dev Mode 插件只读、`devtools` 能力不存在、架构矛盾 3 处硬伤
2. **实现层**：rotation 单位换算方向反了、心跳无 pong 检测、断连挂起不清理
3. **复审**：close 事件误清空 pending、authTimeout 未清、handleResp 未校验来源连接
4. **跨 agent**：绝对 node 路径（macOS GUI PATH 缺失）、EADDRINUSE 守卫、端口可配
5. **安全**：maxPayload 上限、status 限流、审计 0600、不泄露 token 路径
6. **安全+效率**：配对码替代复制 token、token 轮换、手写 stdio 消 SDK

验证：MCP stdio 协议全链路实测 ✅、端到端配对/鉴权/重放拒绝 ✅、token 轮换 ✅、全部语法/JSON 校验 ✅

## 贡献

欢迎 issue 和 PR。改动建议：
- 多 agent 并发：拆分常驻 daemon + 薄 stdio 转发
- 双向鉴权：若你的场景有跨用户/容器威胁模型
- 更多 Figma 插件能力：组件库操作、样式变量、布局模式等

## 许可证

[MIT](LICENSE)
