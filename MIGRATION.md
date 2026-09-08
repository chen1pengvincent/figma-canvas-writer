# 迁移指南：v2 → v3.0.0

v3 是一次**破坏性协议升级**（鉴权协议 2 → 3）。桥接与插件必须成套升级；旧版混搭会在握手阶段明确失败，不存在静默降级。

## 1. 必须知道的变化

1. **协议 3**：握手签名内容与上下文语义变化（新增 `runId`、`pageRevision`、多编辑器 `editorType`）。v2 桥接 + v3 插件（或反之）互不认可。
2. **配对密钥沿用**：本机 `bridge-token` 与 Figma `clientStorage` 中保存的密钥继续有效，**无需重新贴密钥**；协议升级不影响密钥格式与信任边界。
3. **插件需重新导入**：在 Figma Desktop 导入新的 `plugin/manifest.json` 并运行 **Figma Canvas Writer 3**。旧 "Canvas Writer 2" 条目对 v3 桥接握手必败；建议从开发插件列表移除旧条目。
4. **`pageRevision` 成为必填参数（破坏性变更）**：除 `figma_canvas_status` 与 `figma_read_asset` 外，所有工具必填 `sessionId` + `pageId` + `pageRevision`。三者都从最新一次 `figma_canvas_status` 的 `data.context` 取得。手动切页、`figma_manage_page` 切页都会使旧 `pageRevision` 失效（`STALE_CONTEXT`）。v2 时代只传 `sessionId/pageId` 的提示词与调用代码必须更新。
5. **工具 9 → 37**：新增语义读取、页面管理、资源通道、层级/矢量/布局/富文本/视觉编辑、设计系统、原型/批量、动画/视频/Shader、FigJam/Slides 领域工具。全部清单见 [README](README.md#工具与调用约定)。
6. **混合分类工具的条件必填**：`figma_variables` 等混合工具仅在调用写动作时要求 `operationId`（schema 以 `if/then` 表达）。
7. **资源产物目录**：导出文件写入 `<配置目录>/artifacts/`（默认 `~/.figma-canvas-writer/artifacts/`）。排他创建、不覆盖、不自动清理；需要回收时手动删除。
8. **新限额**：资源单块 64KiB / 单资源 16MiB / 并发 2 / 暂存 64MiB；batch ≤50 步；读取游标 16 个活动句柄、TTL 120 秒。超限返回明确的资源限制错误，不静默截断。

## 2. 升级步骤

```sh
git pull                      # 或重新 clone
node install.mjs              # 重建运行时依赖、重新生成 generated-config
node bridge/mcp-bridge.js --show-pairing-key   # 确认旧密钥仍可用（无需轮换）
```

随后在 Agent 中重载 MCP 服务，在 Figma Desktop 重新导入 `plugin/manifest.json`，运行 **Figma Canvas Writer 3**，确认插件面板显示"已授权"。

## 3. 回退

v3 出现问题时可整成回退到上一个 v2 tag 的桥接与插件（密钥与用户配置保留）。注意：**v3 创建的设计对象不会因代码回退自动消失**；真实验收遗留对象应按记录的节点 ID 清理，不删除原有设计内容。

## 4. 与官方 Figma 集成的能力差距（对照清单）

以下能力在 v3 中**未实现**，调用方不得假设其存在：

- Code Connect（CLI/REST/映射服务）
- Figma REST API / Remote MCP / OAuth 服务端
- 网页捕获（HTML/CSS → 画布）
- Make / Weave 工作流
- 新建 Figma 文件、跨文件寻址、多客户端调度
- 团队库发布、组织级全文搜索
- 官方代码生成/框架转换结果（`figma_get_design_context` 只返回结构化设计事实）

本地子集限制：SVG 导入为有界解析子集（脚本/外链/嵌入内容拒绝）；Slides 内容节点限 FRAME/RECTANGLE/ELLIPSE/TEXT/LINE；Shader 仅列举与读取；MP4 仅顶层带动画 Frame，上限 4K。

## 5. 验收状态对账摘要（随版本更新）

| 能力域 | 自动化测试 | 真实 Figma 画布 |
|---|---|---|
| 连接/鉴权/协议故障路径 | 229 项中的协议套件 | v2 基线已验收；v3 握手待真机复核 |
| 基础编辑（创建/修改/删除/文本） | ✅ | v2 基线已验收；v3 待复核 |
| 跨页世代/对账 | ✅（含回归） | 待真机 |
| 资源导入导出/截图/产物 | ✅（桥接级 + 完整性反例） | 待真机 |
| 语义读取/续读/设计上下文 | ✅ | 待真机 |
| 层级/矢量/布局/富文本/视觉 | ✅ | 待真机 |
| 变量/样式/组件/库发现导入 | ✅ | 待真机（库导入需已启用库） |
| 原型 reactions/batch | ✅（点击验收除外） | 待真机（关键导航须实际点击） |
| Motion/MP4/Shader | ✅（fixture 级） | 待真机（需带动画顶层 Frame 与真实 Shader 样本） |
| FigJam / Slides | ✅（fixture 级） | 待真机（需对应编辑器文件） |

> 规则：任何能力在"真实 Figma 画布"一列未打勾前，调用方与文档都不得声称该能力已验收。`figma_get_capabilities` 的逐域 `verified` 字段与 `acceptance.realCanvas` 反映同一事实。
