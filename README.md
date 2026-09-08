# Figma Canvas Writer

通过本机 MCP stdio，把 Agent 的工具调用转交给 Figma Design 插件，在用户当前页面执行受限的读取、创建、修改和删除。此版本采用**一个 Agent 进程连接一个插件实例**；适用于能启动本地 stdio 服务、且与本项目协议版本兼容的宿主。

项目使用 Figma [Plugin API](https://developers.figma.com/docs/plugins/api/api-reference/) 操作画布。插件能力以本项目的工具清单为准；不要求 Dev Mode，也不等同于开放全部 Plugin API。桥接有一个运行时依赖 `ws`，确切版本由已提交的 `bridge/package-lock.json` 锁定。

```text
本机 Agent → MCP stdio → Node 桥接 → ws://localhost:9753/plugin
                                           ↕ 双向鉴权与逐帧签名
                                      Figma 插件 UI
                                           ↕
                                  当前 Design 页面 Plugin API
```

## 安装与首次配对

准备 Node.js **20 或以上（包含 npm）**、Figma Desktop，以及一个有编辑权限的 Design 文件。插件 UI 需要 `crypto.getRandomValues` 提供安全随机数，不依赖 Figma iframe 中可能缺失的 `crypto.subtle`。

1. 获取项目并安装依赖。Windows、macOS、Linux 共用 Node 安装入口：

   ```sh
   git clone https://github.com/chen1pengvincent/figma-canvas-writer.git
   cd figma-canvas-writer
   node install.mjs
   ```

   macOS/Linux 也可使用 `bash install.sh`。安装器每次执行 `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`，按 lockfile 重建运行时依赖并检查本地 `ws` 可加载；残缺的 `node_modules` 不会被当作安装成功。发布的 `plugin/ui.html` 已内联固定版本的加密实现，普通安装省略开发依赖，无需本地构建或执行依赖安装脚本；插件不从网络加载加密代码。

2. 从 **`generated-config/`** 选择一个宿主示例，将服务条目合并到现有 MCP 配置，保留其他配置。生成文件已填入本机 Node 和桥接的绝对路径，支持含空格路径；安装器不会修改用户配置或启动服务。仓库内的 [`config-examples/`](config-examples/README.md) 是可移植的占位符示例。

3. 在该 Agent 中启动或重新加载 MCP 服务。桥接由 Agent 启动，插件连接固定端点 `ws://localhost:9753/plugin`。桥接分别显式监听 `127.0.0.1:9753` 和 `[::1]:9753`，两个回环地址共享同一套认证，不绑定 `0.0.0.0` 或 `::` 通配地址。同一时刻只启动一个实例。

4. 在仓库根目录的本机终端显式显示配对密钥：

   ```sh
   node bridge/mcp-bridge.js --show-pairing-key
   ```

   将输出的 **64 位十六进制密钥（256 bit）**复制到插件面板。此命令只显示密钥后退出，不会启动另一份桥接。密钥不应放进 Agent 配置、提示词或 MCP 工具参数。

5. 在 Figma Desktop 的插件开发菜单中选择 **Import plugin from manifest**，导入 `plugin/manifest.json`。打开有编辑权限的 Design 文件，运行 **Figma Canvas Writer 2**，粘贴密钥并连接。若开发插件列表中还保留旧版 **Figma Canvas Writer**，请按带 **2** 的名称选择本版本。插件保存配对信息后可在下次运行时使用。

6. 让 Agent 调用 `figma_canvas_status`，确认返回的 `data.authorized` 为 `true`，核对 `data.context` 中的文件名与页面名。随后使用其中的 `sessionId` 和 `pageId` 读取当前页面；先在专用测试页面验证一次创建、回读和删除，再用于实际工作。

这些步骤完成了本地授权与连通性检查；只有在目标客户端和真实 Figma 文件中完成读写回读，才能确认该组合已可用。

## 工具与调用约定

所有工具返回 MCP 文本内容，文本中是 JSON。业务成功时为 `{ "ok": true, "data": ... }`；执行失败时为 `{ "ok": false, "error": ... }` 并设置 `isError: true`。协议错误另以 JSON-RPC error 返回。

| 工具 | 用途 |
|---|---|
| `figma_canvas_status` | 检查连接、鉴权和真实插件响应，取得当前文件、页面及会话上下文 |
| `figma_get_context` | 分页读取当前页面的顶层节点 |
| `figma_get_selection` | 分页读取当前选择的节点 |
| `figma_get_node` | 按 ID 读取节点属性与有限深度的子节点 |
| `figma_get_operation` | 查询指定写操作的状态与已记录结果 |
| `figma_create_node` | 创建 RECTANGLE、ELLIPSE、TEXT、FRAME、LINE 或 STAR |
| `figma_modify_node` | 修改白名单中的节点属性 |
| `figma_delete_node` | 删除指定节点 |
| `figma_set_text` | 修改文本、字体、字号或位置；省略 `text` 时保留原文 |

除 `figma_canvas_status` 外，所有工具都要求从最新状态取得的 **`sessionId`、`pageId`**。四个写工具另外要求 **`operationId`**，由调用方为每次新写入生成唯一值，例如 UUID。`sessionId` 用来定位插件运行会话，不是认证密钥。

创建示例（以下是 `figma_create_node` 的参数，替换会话与页面值后使用）：

```json
{
  "sessionId": "从当前状态复制",
  "pageId": "从当前状态复制",
  "operationId": "6e91e2b0-1e81-4968-a2ee-a52c1277c5b1",
  "type": "RECTANGLE",
  "name": "连接验收矩形",
  "x": 0,
  "y": 0,
  "width": 100,
  "height": 80
}
```

用返回的节点 ID 调用 `figma_get_node` 回读；删除时使用另一个新的 `operationId`。创建 TEXT 必须显式提供 `text`，允许空字符串。可修改的属性为 `name`、`x`、`y`、`width`、`height`、`rotation`（度）、`opacity`、`visible`、`fills`、`strokes`、`strokeWeight`、`cornerRadius`，实际适用性还取决于节点类型。

页面或插件会话发生变化后，重新读取状态并确认目标。此版本只操作当前页面，不自动切页，也不接受其他文件或其他页面的节点作为目标。

### 超时、失败与重复调用

插件串行执行读写；同一插件运行会话内，相同 `operationId` 和相同参数返回原操作结果，不再次执行。将同一 ID 用于不同参数会返回冲突错误。

超时、断线或取消后，写入可能已经发生。先用原 `sessionId`、`pageId`、`operationId` 调用 `figma_get_operation`，查询 `queued`、`running`、`succeeded`、`failed`、`partial`、`unknown` 或 `not_found` 状态，并回读涉及的节点。**不要换一个 ID 盲目重发结果未知的写入。** `partial` 表示可能存在部分修改，不承诺所有失败都会原子回滚。

操作记录只保留在本次插件运行的内存中；重开插件后不能凭 `not_found` 推断此前没有写入。记录达到容量限制时会拒绝新写入，先对账，再重开插件。Figma 撤销操作仍由用户控制；本项目不保证每条工具调用都对应一个独立撤销步骤。

### 大页面与读取范围

`figma_get_context` 和 `figma_get_selection` 使用 `cursor`、`limit` 分页，默认每页 50 个、最多 100 个。按返回的 `nextCursor` 继续读取，直到为 `null`。`figma_get_node` 的 `depth` 为 0–6 的整数，节点树有数量上限；读取结果以 `childrenCount`、`truncated`、`charactersTruncated` 等字段标明省略内容。不要把截断结果当作完整页面。

组件库、变量、样式管理、Auto Layout 专用操作、任意代码执行、跨文件操作均不在当前工具范围内。

## 本地授权与恢复

配对使用本机生成的 256 bit 密钥。双方通过 HMAC 证明持有密钥；后续消息绑定连接、方向和递增序号并签名，以拒绝篡改与重放。**密钥不通过 WebSocket 下发**，首次配对由用户在本机终端显式显示后粘贴到插件。HMAC 提供鉴权与完整性，不加密画布消息；连接限定为本机回环。

桥接配置目录按以下优先级选择：显式设置的 `FIGMA_BRIDGE_HOME` → 已存在的旧目录 `~/.dsh-figma-bridge` → 默认目录 `~/.figma-canvas-writer`。密钥保存在所选目录的 `bridge-token` 文件中；保留旧目录优先级可在升级时沿用已有密钥。插件端保存在 Figma `clientStorage`。Agent 启动、显示密钥、轮换密钥必须使用同一个目录。本机同一账户下能读取该密钥的进程处于同一信任边界。

- **临时停用**：在插件中断开连接，或停止 Agent 的 MCP 服务。stdio 关闭后桥接退出并释放端口；重新启用时重新核对上下文。
- **忘记当前插件配对**：使用插件中的忘记配对操作，清除插件保存的密钥，再按安装步骤配对。
- **撤销旧密钥**：先停止占用端口的桥接，再执行以下命令。命令成功后退出；随后重启 Agent 服务、显示新密钥，并让插件忘记旧配对。

  ```sh
  node bridge/mcp-bridge.js --rotate-token
  ```

  若 `9753` 已被占用，轮换失败且不会修改密钥。仅清除插件保存的配对不会吊销其他持有同一密钥的副本；需要吊销时应轮换。

审计日志为配置目录内的 `audit.log`，记录工具名、会话、页面、操作 ID、耗时与结果，不记录完整画布文本或密钥。Unix 权限位用于限制本机文件访问；不以此声称已完成 Windows ACL 验证。

## 兼容性与排障

本项目实现本机 MCP stdio，并协商 `2024-11-05`、`2025-03-26`、`2025-06-18`、`2025-11-25` 协议版本。按照 [MCP 生命周期规范](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)，客户端还需支持协商结果并完成初始化。提供配置示例不等于所有 Agent 已通过实际连接验证。

当前不提供远程 MCP HTTP/SSE 服务、多 Agent 并发、多个插件并发或自定义端口。客户端示例与实际验收状态见 [`config-examples/README.md`](config-examples/README.md)。

| 现象 | 处理 |
|---|---|
| 安装找不到 Node 或 npm | 安装包含 npm 的 Node.js >=20，再运行 `node install.mjs` |
| npm ci 失败或依赖缺失 | 依据原始 npm 错误修复网络/文件问题后重跑；安装器会重建依赖 |
| 仓库移动或 Node 绝对路径变化 | 重跑安装器，使用新生成的配置更新该服务条目 |
| 9753 端口已占用 | 停止另一份 Agent 桥接；不要通过修改端口环境变量绕过 |
| 插件未连接或鉴权失败 | 先确认 Agent 桥接已启动，检查配置目录一致，再忘记旧配对并使用当前密钥 |
| `crypto.getRandomValues` 不可用 | 当前 Figma UI 环境无法安全生成认证随机数；使用支持该 API 的环境后重试 |
| `STALE_CONTEXT`、`SESSION_CHANGED`、`PAGE_CHANGED` | 重新读取状态与目标页面，确认后发起操作 |
| 写入超时、断线、`partial`、`unknown` | 查询原操作 ID 并回读节点，完成对账后再决定下一步 |

## 开发与验证

修改加密实现时，使用 **Node.js >=20.19.0** 安装完整开发依赖并重新生成内联产物。构建无需启用依赖安装脚本。以下命令在仓库根目录开始执行；普通使用者无需此构建步骤：

```sh
cd bridge
npm ci --ignore-scripts
npm run build:crypto
npm run check:crypto
npm run check
npm test
```

安装测试使用临时目录和模拟 npm，覆盖残缺依赖、失败退出码、缺失 lockfile、绝对路径及 Windows 路径转义；不会修改真实 Agent 配置。本次安装入口已在 macOS、Node.js 25.9.0 上执行真实 `npm ci` 并加载锁定的 `ws 8.21.3`。Windows/Linux 和 Node.js 20 尚未进行对应环境的实际安装验收。

2026-09-08 本地修复版在 macOS 26.6.2 arm64、Figma Desktop 126.8.18 上，通过官方 MCP SDK 1.30.0 完成了真实画布验收：两次 stdio 启动（Node.js 26.8.1 / 25.9.0）、九项工具调用、六类节点创建、文字与属性修改、回读、删除、分页、重复操作去重、旧页面/旧会话拒绝、手动断开与重新授权。第二次启动使用普通安装器生成的 Node 路径，且已省略全部开发依赖。七个测试节点均已删除；测试页原有顶层节点摘要与验收前一致。56 项自动化测试全部通过。

这些是官方 SDK 客户端与该 Figma 实机组合的证据，不代表 Claude、Cursor、Codex、DSH 等每个宿主已逐一验收。此次真实 Figma 复用了本机已有配对密钥；全新用户首次粘贴/持久化、真实密钥轮换、网络故障导致的未知写入恢复仍需对应实机验证。认证、撤销、轮换与故障路径已有隔离回归测试。Windows/Linux 的安装入口与 Node.js 20 尚未实机验收；Linux 安装入口不等于提供 Linux Figma Desktop 支持。

修改工具契约时，请同步桥接 schema、插件校验、测试与本文档。修改认证协议时，需要同步桥接、插件 UI 和认证测试。API 行为依据 [Figma Plugin API 官方文档](https://developers.figma.com/docs/plugins/api/api-reference/)。

## 许可证

[MIT](LICENSE)
