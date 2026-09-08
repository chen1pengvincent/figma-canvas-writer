# MCP 配置示例

推荐先在仓库根目录运行 `node install.mjs`，再使用 `generated-config/` 下包含本机 Node 和桥接绝对路径的文件。本目录保留可移植的占位符示例。

将所需服务条目合并到 Agent 的现有配置中，保留其他条目；不要用整个示例覆盖现有配置。JSON、TOML、YAML 中的路径需保持为单个字符串，含空格时也不应另加 shell 引号。

| 宿主 | 示例文件 | 验证状态 |
|---|---|---|
| Claude Desktop | `claude_desktop_config.json` | 配置形状示例，待实际连接验证 |
| Cursor | `cursor-mcp.json` | 配置形状示例，待实际连接验证 |
| Codex | `codex-config.toml` | 配置形状示例，待实际连接验证 |
| Windsurf | `windsurf-mcp_config.json` | 配置形状示例，待实际连接验证 |
| VS Code | `vscode-mcp.json` | 配置形状示例，待实际连接验证 |
| DSH | `dsh-cordis-patch.yml` | 需按当前 DSH 版本核对，待实际连接验证 |

本桥接只提供本机 stdio，插件使用固定端点 `ws://localhost:9753/plugin`。桥接分别显式监听 `127.0.0.1:9753` 与 `[::1]:9753`，共享认证，不绑定通配地址。同一时刻只启动一个宿主的桥接实例，连接一个 **Figma Canvas Writer 3** 插件。此目录不代表上述客户端均已通过真实 Figma 读写验收。
