# Figma Canvas Writer 3

通过本机 MCP stdio，把 Agent 的工具调用转交给 Figma 插件，在**经用户逐次授权的画布会话**内执行受限的读取、创建、修改、资源进出与结构化验收。此版本采用**一个 Agent 进程连接一个插件实例**；适用于能启动本地 stdio 服务、且与本协议（版本 3）兼容的宿主。

v3 相比 v2 的核心扩展：工具从 9 个增加到 **37 个**，新增语义查询与续读、页面管理、资源导入导出（分块传输 + 本机产物）、层级/矢量/布局/富文本区间/视觉属性编辑、变量/样式/组件/库发现导入、原型 reactions、有限批量（batch）、Motion/MP4 导出作业、Shader 只读发现，并扩展支持 **FigJam 与 Slides 编辑器**。逐工具清单见下文；与官方 Figma MCP 的能力差距见 [`MIGRATION.md`](MIGRATION.md) 与下方"能力边界"。

项目使用 Figma [Plugin API](https://developers.figma.com/docs/plugins/api/api-reference/) 操作画布。插件能力以本项目工具清单为准；不要求 Dev Mode，也不等同于开放全部 Plugin API。桥接运行时依赖只有 `ws`（版本由 `bridge/package-lock.json` 锁定）。

```text
本机 Agent → MCP stdio → Node 桥接 → ws://localhost:9753/plugin
                                           ↕ 协议 3：双向鉴权 + 逐帧签名
                                      Figma 插件 UI（分块资源通道）
                                           ↕
                              当前文档/页面的 Plugin API（Design / FigJam / Slides）
```

## 安装与首次配对

准备 Node.js **20 或以上（包含 npm）**、Figma Desktop，以及一个有编辑权限的文件。插件 UI 需要 `crypto.getRandomValues` 提供安全随机数。

1. 获取项目并安装依赖（Windows、macOS、Linux 共用）：

   ```sh
   git clone https://github.com/chen1pengvincent/figma-canvas-writer.git
   cd figma-canvas-writer
   node install.mjs
   ```

   macOS/Linux 也可使用 `bash install.sh`。安装器每次执行 `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` 重建运行时依赖并检查本地 `ws` 可加载。发布的 `plugin/code.js` 与 `plugin/ui.html` 是已构建/已内联的产物，普通安装零构建、不执行依赖安装脚本、不从网络加载代码。

2. 从 **`generated-config/`** 选择宿主示例，把服务条目合并进现有 MCP 配置。生成文件已填入本机 Node 与桥接的绝对路径；安装器不修改用户配置、不启动服务。可移植占位示例在 [`config-examples/`](config-examples/README.md)。

3. 在 Agent 中启动/重载 MCP 服务。桥接由 Agent 启动，插件连接固定端点 `ws://localhost:9753/plugin`；分别显式监听 `127.0.0.1:9753` 与 `[::1]:9753`，不绑定通配地址。同一时刻只运行一个桥接、授权一个插件。

4. 本机终端显式显示配对密钥：

   ```sh
   node bridge/mcp-bridge.js --show-pairing-key
   ```

   把输出的 **64 位十六进制密钥（256 bit）**粘贴到插件面板。该命令只显示密钥后退出；密钥不进入 Agent 配置、提示词或工具参数。**从 v2 升级可沿用原密钥**（见 [`MIGRATION.md`](MIGRATION.md)）。

5. 在 Figma Desktop 插件开发菜单选择 **Import plugin from manifest** 导入 `plugin/manifest.json`，打开有编辑权限的文件并运行 **Figma Canvas Writer 3**，粘贴密钥连接。v3 同时在 Design、FigJam、Slides 文件中可用；本插件为普通插件（非 Dev Mode），`teamlibrary` 权限仅用于库发现/按 key 导入。

6. 让 Agent 调用 `figma_canvas_status`，确认 `data.authorized === true`，核对 `data.context`（文件名、页面名、`editorType`）。**之后所有目标工具都要求 `sessionId`、`pageId`、`pageRevision`**——三者都来自最新一次状态读取；切页（手动或工具）后必须重新读取。

## 预检与验收（doctor / smoke）

```sh
node scripts/doctor.mjs        # 只读预检：Node/ws/localhost 解析顺序/配对密钥/9753 占用者身份/Figma 运行状态
npm run smoke                  # 五步冒烟：授权 → 建节点 → 截图 → 删除 → 清理（退出码 0/1/2）
```

- doctor **纯只读**：对 9753 占用者做 WS 握手探针并按 challenge 协议号分类（本项目 v3 桥 / 旧版本桥 / 非本协议服务），配合 lsof 显示 PID 与命令行；不做密钥级握手。
- smoke 自带桥接进程并要求插件已授权；`--json` 输出机器可读结果；任何失败都会清理测试节点。
- Agent 与 Figma Desktop 分离部署（SSH 隧道 / 双栈中继、launchd/systemd 模板、明文链路警告与回环校验硬约束）见 [`docs/split-host.md`](docs/split-host.md)。

## 工具与调用约定

所有工具返回 MCP 文本内容（JSON）。业务成功 `{ "ok": true, "data": ... }`；执行失败 `{ "ok": false, "error": ... }` 且 `isError: true`。

**调用约定（v3）**：除 `figma_canvas_status` 与 `figma_read_asset` 外，所有工具必填 `sessionId` + `pageId` + `pageRevision`（**新增必填，破坏性变更**）。写类工具另必填 `operationId`（每次新写入唯一，相同 ID + 相同计划复用原结果，不同计划返回 `OPERATION_CONFLICT`）。混合分类工具（variables/styles/components/libraries/textRange/motion/figjam/slides）仅在调用写动作时要求 `operationId`。

| 领域 | 工具 | 说明 |
|---|---|---|
| 状态 | `figma_canvas_status` | 连接/鉴权状态与当前上下文（含 pageRevision） |
| 能力 | `figma_get_capabilities` | 逐域实现状态、前置条件、限额、`verified` 标志 |
| 基础读 | `figma_get_context` / `figma_get_selection` / `figma_get_node` | 分页读取当前页顶层/选区；节点摘要 + 有限深度 |
| 语义读 | `figma_query_nodes` | 类型/名称受限条件 + 字段投影 + 分页；续读游标固定成员列表 |
| | `figma_get_children` | 容器子节点续读；成员列表创建时固定，移除成员标记 `expired` |
| | `figma_read_field` | 多节点字段读取；区分 `absent/mixed/unsupported/truncated` |
| | `figma_get_text_runs` | 文本样式分段 + 正文分块；UTF-16 边界安全；内容变化使游标失效 |
| | `figma_get_design_context` | 结构化设计上下文（布局/文字/组件/变量/样式/资源） |
| 操作对账 | `figma_get_operation` | 查询写操作/作业真实状态；**切页后仍可对账**（仅需 sessionId 有效） |
| 页面 | `figma_list_pages` / `figma_manage_page` | 列表、创建、重命名、删除（显式 confirm）、切页（独立上下文操作，完成后重新读取状态） |
| 资源 | `figma_get_screenshot` | 节点 PNG 截图；≤128KiB 内联 data URL，否则落产物 |
| | `figma_export_asset` | PNG/JPG/SVG/PDF 导出到 `~/.figma-canvas-writer/artifacts/`（排他创建、SHA-256 校验） |
| | `figma_import_asset` | 本机 PNG/JPEG → 持久图片填充；SVG（有界解析子集）→ 可编辑矢量；不接受 URL |
| | `figma_read_asset` | 产物元数据（路径/字节/SHA-256/MIME）；小产物含内联预览 |
| 编辑 | `figma_create_node` / `figma_modify_node` / `figma_delete_node` / `figma_set_text` | 与 v2 语义一致的受限编辑 |
| | `figma_hierarchy` | clone / group / ungroup / reparent（绝对或局部坐标）/ reorder；拒绝循环层级 |
| | `figma_vector` | 多边形、矢量路径、布尔运算（union/subtract/intersect/exclude）、形状参数、vectorNetwork |
| | `figma_layout` | Auto Layout、间距、内边距、对齐、尺寸模式、约束 |
| | `figma_text_range` | 字符区间样式读写；字体加载失败不静默替换 |
| | `figma_visual` | effects、混合、裁切、遮罩、网格、描边细节、分角圆角 |
| 设计系统 | `figma_variables` | 本地变量集合/变量/模式/值/别名/绑定/解析 |
| | `figma_styles` | 本地 Paint/Text/Effect/Grid 样式查询、创建、修改、应用 |
| | `figma_components` | 组件/变体/实例创建、属性、swap、detach、属性管理 |
| | `figma_libraries` | 已启用库的变量集合发现 + 按已知 key 导入变量/组件/样式（需 `teamlibrary` 权限且用户已启用库） |
| 原型批量 | `figma_set_reactions` | 设置/清除原型 reactions 与起始节点 |
| | `figma_batch` | ≤50 步顺序执行、前序结果引用（`step{n}.id`）、失败默认停止并返回逐项状态 |
| 动画 | `figma_motion` | 动画样式发现、节点时间线/关键帧轨道读写 |
| | `figma_export_video` | 顶层动画 Frame → MP4（作业：accepted → 轮询 `figma_get_operation` → 产物） |
| | `figma_shaders` | 可用 Shader 列表与可读公开配置（只读，不导入不应用） |
| 专用编辑器 | `figma_figjam` | FigJam：便笺、带字形状、连接线、列表读取（仅 FigJam 文件） |
| | `figma_slides` | Slides：结构读取、幻灯片/行创建、内容节点（仅 Slides 文件） |

### 超时、失败与重复调用

写操作串行执行；相同 `operationId` + 相同计划复用原结果。超时/断线后写入可能已发生：**先用原参数调 `figma_get_operation` 对账**（切页后依然可用），再决定下一步；不要换 ID 盲目重发。`partial` 表示可能部分修改；`unknown` 表示结果未知。批量失败默认停止，逐项状态在 `error.details.steps` 与对账记录中。

### 读取与资源边界

- 分页默认 50/页、上限 100；`figma_query_nodes`/`figma_get_children` 的续读游标绑定会话与页面，TTL 120 秒，最多 16 个活动句柄。
- 资源通道：单块 64KiB（签名帧内）、单资源 16MiB、并发 2、4 块确认窗口、SHA-256 完整性校验；产物目录 `~/.figma-canvas-writer/artifacts/`（排他创建、不覆盖、不自动清理）。
- 导入路径限用户主目录或 `FIGMA_IMPORT_DIR` 指定目录内的普通文件；校验真实路径、文件头与扩展名一致性；不跟随越界符号链接。

## 能力边界（与官方 Figma 集成的差距）

v3 定位是**本地 MCP 能力补齐**，不是官方 27 项对照的等价实现。明确的差距：不生成业务/框架代码、不做 Code Connect、不接 Figma REST/Remote MCP、不做网页捕获、不支持 Make/Weave、不新建 Figma 文件、不发布团队库。本地子集边界（如 SVG 解析子集、Slides 内容类型限制、Shader 只读）见各工具描述与 `figma_get_capabilities` 返回。

**验收状态声明**：229 项自动化测试全部通过（真实 stdio/WS 协议 + 严格插件 fixture + 完整性反例）。**真实 Figma 画布验收（跨页、资源往返、设计系统、原型点击、FigJam/Slides、MP4 解码、真实 Shader 样本）记录在 [`MIGRATION.md`](MIGRATION.md) 附带的对账摘要中；未通过真实验收的能力一律不得当作已验收。**

## 本地授权与恢复

配对使用本机生成的 256 bit 密钥；HMAC 双向证明持有密钥，后续消息绑定连接、方向与递增序号签名，拒绝篡改与重放。**密钥不通过 WebSocket 下发**。桥接配置目录优先级：`FIGMA_BRIDGE_HOME` → 旧目录 `~/.dsh-figma-bridge` → 默认 `~/.figma-canvas-writer`。

- **临时停用**：插件中断开连接，或停止 Agent 的 MCP 服务。
- **忘记插件配对**：插件内"忘记配对"后重新粘贴密钥。
- **吊销旧密钥**：

  ```sh
  node bridge/mcp-bridge.js --rotate-token
  ```

  9753 被占用时轮换失败且不修改密钥。撤销授权（revoke）会同时清空操作记录与读取游标：旧 `operationId` 不再可查询，也不会泄露操作存在性。

审计日志为配置目录 `audit.log`：只记录工具名、会话/页面/操作 ID、耗时与结果，不记录画布文本或密钥。

## 兼容性与排障

实现本机 MCP stdio，协商 `2024-11-05`、`2025-03-26`、`2025-06-18`、`2025-11-25` 协议版本。**协议 3 与 v2 的协议 2 互不兼容：桥接与插件必须成套升级**（旧插件对 v3 桥接握手即败，反之亦然）。从 v2 迁移见 [`MIGRATION.md`](MIGRATION.md)。

| 现象 | 处理 |
|---|---|
| 安装找不到 Node/npm | 安装 Node.js >= 20 后重跑 `node install.mjs` |
| 9753 端口被占用 | 停止另一份桥接；不要改端口环境变量绕过 |
| 插件协议不匹配 | 桥接与插件版本不一致；成套升级到 3.0.0 |
| `STALE_CONTEXT` | 重新 `figma_canvas_status`，用新 `sessionId/pageId/pageRevision` 重试 |
| `PAGE_CHANGED` / `SESSION_CHANGED` | 页面或会话已变化；重新读取状态确认目标 |
| 写入超时/断线/partial/unknown | 用原 `sessionId` + `operationId` 调 `figma_get_operation` 对账（切页后仍可用） |
| `OPERATION_CONFLICT` | 同一 operationId 用了不同计划；换新 ID |
| 导入路径被拒 | 路径必须在主目录或 `FIGMA_IMPORT_DIR` 内且为普通 PNG/JPEG/SVG 文件 |
| `crypto.getRandomValues` 不可用 | 当前 Figma UI 环境无法安全生成随机数；换支持的环境 |

## 开发与验证

修改加密或插件源码时，用 Node.js >= 20.19.0 安装完整开发依赖并重建产物（普通使用者无需此步）：

```sh
cd bridge
npm ci --ignore-scripts
npm run build:crypto    # 重建 ui.html 内联加密块
npm run build:plugin    # 由 plugin/src 打包 plugin/code.js
npm run check           # 语法 + 产物一致性
npm test                # 全量测试（229 项）
```

产物（`plugin/code.js`、`ui.html` 内联块）与源码必须同步提交：`npm run check:plugin` 与 `npm run check:crypto` 在发布前必须通过。测试套件覆盖：真实 stdio/WS 协议与故障路径（篡改、重放、超时、取消、批量、限额）、插件 VM 严格 fixture（各领域动作成功/失败/回滚/对账）、资源分块双向传输与完整性反例、安装链路。

## 许可证

[MIT](LICENSE)
