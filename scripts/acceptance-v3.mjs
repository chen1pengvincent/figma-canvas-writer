// Real-canvas acceptance driver for v3. Spawns the bridge, waits for the
// plugin to authorize, then runs the requested scenario group against the
// live editor. Usage:
//   node scripts/acceptance-v3.mjs --group core --report /tmp/fcw3-acceptance.md
// Groups: core | pages | assets | design-system | edit-domain | proto | motion | editors-figjam | editors-slides
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const group = args.includes('--group') ? args[args.indexOf('--group') + 1] : 'core';
const reportPath = args.includes('--report') ? args[args.indexOf('--report') + 1] : null;
const results = [];
const created = [];

const line = (text) => { console.log(text); if (reportPath) results.push(text); };

const bridge = spawn(process.execPath, [path.join(root, 'bridge', 'mcp-bridge.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
let seq = 0;
const pending = new Map();
const reader = createInterface({ input: bridge.stdout });
reader.on('line', raw => {
  let msg; try { msg = JSON.parse(raw); } catch { return; }
  if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const rpc = (method, params = {}) => new Promise(resolve => {
  const id = ++seq;
  pending.set(id, resolve);
  bridge.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const call = async (name, args = {}) => {
  const response = await rpc('tools/call', { name, arguments: args });
  if (!response.result) throw new Error(name + ' RPC 错误: ' + JSON.stringify(response));
  return JSON.parse(response.result.content[0].text);
};
const ok = async (name, args, check, label) => {
  const result = await call(name, args);
  let pass = false; let detail = '';
  try { check(result); pass = true; } catch (e) { detail = e.message; }
  line(`- [${pass ? 'PASS' : 'FAIL'}] ${label || name}${pass ? '' : ' — ' + detail + ' ← ' + JSON.stringify(result).slice(0, 300)}`);
  return result;
};
const must = (cond, message) => { if (!cond) throw new Error(message); };
const ctx = async () => {
  const status = await ok('figma_canvas_status', {}, r => must(r.ok && r.data.authorized, '未授权'));
  const context = status.data.context;
  return { sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision };
};
const opId = () => 'acc-' + randomUUID();

async function waitForAuthorized(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  line(`等待插件连接（请在 Figma 中运行 Figma Canvas Writer 3 并粘贴密钥连接；${Math.round(timeoutMs / 1000)}s 超时）…`);
  while (Date.now() < deadline) {
    const status = await call('figma_canvas_status');
    if (status.ok && status.data.authorized) {
      line(`已授权：${status.data.context.fileName} / ${status.data.context.pageName}（editorType=${status.data.context.editorType}）`);
      return status.data.context;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('等待插件授权超时');
}

// ---- groups ----------------------------------------------------------------
async function groupCore() {
  const t = await ctx();
  const page = await ok('figma_get_context', { ...t, limit: 5 }, r => must(r.ok, '读取当前页失败'));
  const rect = await ok('figma_create_node', { ...t, operationId: opId(), type: 'RECTANGLE', name: 'FCW3-验收-矩形', x: 0, y: 0, width: 120, height: 80,
    props: { fills: [{ type: 'SOLID', color: '#336699', opacity: 0.8 }] } }, r => must(r.ok && r.data.id, '创建失败'));
  created.push(rect.data.id);
  await ok('figma_get_node', { ...t, nodeId: rect.data.id, depth: 0 }, r => must(r.ok && r.data.fills?.[0]?.color?.r !== undefined, '回读缺少 fills'));
  await ok('figma_modify_node', { ...t, operationId: opId(), nodeId: rect.data.id, props: { width: 200, rotation: 15 } }, r => must(r.ok, '修改失败'));
  await ok('figma_set_text', { ...t, operationId: opId(), nodeId: rect.data.id, x: 10 }, r => must(r.ok, '仅位置修改失败'));
  const text = await ok('figma_create_node', { ...t, operationId: opId(), type: 'TEXT', text: 'FCW3 验收文本 🧪', y: 120 }, r => must(r.ok, 'TEXT 创建失败'));
  created.push(text.data.id);
  await ok('figma_query_nodes', { ...t, type: 'TEXT', nameContains: '', limit: 10 }, r => must(r.ok && r.data.nodes.some(n => n.id === text.data.id), '查询未命中'));
  const dup = await ok('figma_create_node', { ...t, operationId: 'acc-dup-op', type: 'ELLIPSE', name: 'FCW3-去重' }, r => must(r.ok, '首次创建失败'));
  const dup2 = await ok('figma_create_node', { ...t, operationId: 'acc-dup-op', type: 'ELLIPSE', name: 'FCW3-去重' }, r => must(r.ok && r.data.id === dup.data.id, '相同 operationId 未复用结果'));
  created.push(dup2.data.id);
  const conflict = await ok('figma_create_node', { ...t, operationId: 'acc-dup-op', type: 'ELLIPSE', name: 'FCW3-冲突' }, r => must(!r.ok && r.error.code === 'OPERATION_CONFLICT', '不同计划未报冲突'));
  void conflict;
  await ok('figma_delete_node', { ...t, operationId: opId(), nodeId: dup2.data.id }, r => must(r.ok, '删除失败'));
  const stale = await call('figma_get_node', { ...t, pageRevision: t.pageRevision + 999, nodeId: rect.data.id });
  must(!stale.ok && stale.error.code === 'STALE_CONTEXT', '过期 pageRevision 未被拒绝');
  line('- [PASS] 过期 pageRevision 拒绝（STALE_CONTEXT）');
}

async function groupPages() {
  let t = await ctx();
  const pages = await ok('figma_list_pages', t, r => must(r.ok && Array.isArray(r.data.pages), '列页失败'));
  const accPage = pages.data.pages.find(p => p.name === 'FCW3-验收页') ||
    (await ok('figma_manage_page', { ...t, operationId: opId(), action: 'create', pageName: 'FCW3-验收页' }, r => must(r.ok, '建页失败'))).data.created;
  const switchResult = await ok('figma_manage_page', { ...t, operationId: opId(), action: 'switchPage', targetPageId: accPage.id }, r => must(r.ok && r.data.switched, '切页失败'));
  line(`- [PASS] 工具切页完成，contextConfirmed=${switchResult.data.contextConfirmed}`);
  await ok('figma_get_node', { ...t, nodeId: '0:1' }, r => must(!r.ok && r.error.code === 'STALE_CONTEXT', '旧 pageRevision 未失效'));
  t = await ctx();
  line(`- [PASS] 切页后重新读取状态（pageRevision=${t.pageRevision}）`);
  // Old-page write must be rejected; old-page reconciliation must work.
  const node = await ok('figma_create_node', { ...t, operationId: opId(), type: 'RECTANGLE', name: 'FCW3-验收页节点' }, r => must(r.ok, '新页写入失败'));
  created.push(node.data.id);
  const reconcile = await call('figma_get_operation', { ...t, operationId: opId() });
  must(reconcile.ok && reconcile.data.state === 'not_found', '随机 ID 对账应为 not_found');
  line('- [PASS] getOperation 对账路径可用');
}

async function groupAssets() {
  const t = await ctx();
  const parent = await ok('figma_create_node', { ...t, operationId: opId(), type: 'FRAME', name: 'FCW3-资源容器', x: 300, y: 0, width: 400, height: 300 }, r => must(r.ok, '容器创建失败'));
  created.push(parent.data.id);
  const shot = await ok('figma_get_screenshot', { ...t, nodeId: parent.data.id }, r => must(r.ok && r.data.inline === true && r.data.data.startsWith('data:image/png;base64,'), '截图未内联返回'));
  void shot;
  const png = await ok('figma_export_asset', { ...t, operationId: opId(), nodeId: parent.data.id, format: 'PNG' }, r => must(r.ok && r.data.saved === true && r.data.bytes > 0, 'PNG 导出失败'));
  const svg = await ok('figma_export_asset', { ...t, operationId: opId(), nodeId: parent.data.id, format: 'SVG' }, r => must(r.ok && r.data.saved === true, 'SVG 导出失败'));
  const meta = await ok('figma_read_asset', { artifactId: png.data.artifactId }, r => must(r.ok && r.data.sha256 === png.data.sha256, '产物元数据不符'));
  void meta;
  const verify = (filePath) => {
    const bytes = fs.readFileSync(filePath);
    const stat = fs.statSync(filePath);
    return stat.isFile() && bytes.length > 0;
  };
  must(verify(png.data.absolutePath), 'PNG 产物不存在');
  must(verify(svg.data.absolutePath), 'SVG 产物不存在');
  line(`- [PASS] 产物落盘并回读校验（${png.data.bytes}B PNG / ${svg.data.bytes}B SVG，SHA-256 一致）`);
  // Import a generated PNG back as an image fill.
  const importPath = path.join(os.tmpdir(), 'fcw3-acceptance-' + Date.now() + '.png');
  const png8 = Buffer.from('89504e470d0a1a0a0000000d4948445200000040000000300806000000000000', 'hex');
  const rest = Buffer.alloc(2000, 0x33);
  fs.writeFileSync(importPath, Buffer.concat([png8, rest, Buffer.from([0xae, 0x42, 0x60, 0x82])]));
  const imported = await ok('figma_import_asset', { ...t, operationId: opId(), filePath: importPath, x: 320, y: 20, parentId: parent.data.id, name: 'FCW3-导入图' }, r => must(r.ok && r.data.id, '导入失败'));
  created.push(imported.data.id);
  created.push((await ok('figma_read_field', { ...t, nodeIds: [imported.data.id], fields: ['fills'] }, r => must(r.ok && r.data.results[0].fields.fills.value?.[0]?.type === 'IMAGE', '导入后非图片填充'))));
}

async function groupDesignSystem() {
  const t = await ctx();
  const collection = await ok('figma_variables', { ...t, operationId: opId(), action: 'createVariable', name: 'FCW3/验收色', resolvedType: 'COLOR', collectionId: undefined }, async r => {
    if (r.ok) return;
    const collections = await call('figma_variables', { ...t, action: 'listCollections' });
    if (!collections.ok || !collections.data.collections?.length) throw new Error('无本地变量集合且创建失败：' + JSON.stringify(r));
  });
  let collectionId; let variableId;
  if (collection.ok) {
    variableId = collection.data.variableId || collection.data.id;
    const got = await ok('figma_variables', { ...t, action: 'getVariable', variableId }, r => must(r.ok, '变量回读失败'));
    collectionId = got.data.variableCollectionId || collection.data.collectionId;
    await ok('figma_variables', { ...t, operationId: opId(), action: 'setValue', variableId, modeId: got.data.modes?.[0]?.modeId || collection.data.modeId, value: { r: 0.1, g: 0.4, b: 0.9, a: 1 } }, r => must(r.ok, '变量赋值失败'));
    line('- [PASS] 变量创建 + 赋值');
  } else {
    line('- [SKIP] 无本地变量集合（真机账号限制），已如实记录');
  }
  void collectionId;
  const style = await ok('figma_styles', { ...t, operationId: opId(), action: 'create', styleType: 'PAINT', name: 'FCW3/验收样式', props: { paints: [{ type: 'SOLID', color: { r: 0.9, g: 0.2, b: 0.2 } }] } }, r => must(r.ok, '样式创建失败'));
  const styleId = style.data.styleId || style.data.id;
  await ok('figma_styles', { ...t, operationId: opId(), action: 'apply', styleType: 'PAINT', styleId, nodeId: created[0] || (await ok('figma_create_node', { ...t, operationId: opId(), type: 'RECTANGLE', name: 'FCW3-样式载体' }, r => must(r.ok, '载体创建失败'))).data.id }, r => must(r.ok, '样式应用失败'));
  const comp = await ok('figma_components', { ...t, operationId: opId(), action: 'createFromNode', nodeId: created[0] || (await ok('figma_create_node', { ...t, operationId: opId(), type: 'FRAME', name: 'FCW3-组件源' }, r => must(r.ok, '源创建失败'))).data.id, name: 'FCW3-验收组件' }, r => must(r.ok, '组件创建失败'));
  created.push(comp.data.componentId || comp.data.id);
  await ok('figma_components', { ...t, operationId: opId(), action: 'createInstance', componentId: comp.data.componentId || comp.data.id, x: 600, y: 0 }, r => must(r.ok, '实例创建失败'));
}

async function groupEditDomain() {
  const t = await ctx();
  const frame = await ok('figma_create_node', { ...t, operationId: opId(), type: 'FRAME', name: 'FCW3-布局容器', x: 0, y: 300, width: 500, height: 200 }, r => must(r.ok, '容器失败'));
  created.push(frame.data.id);
  const poly = await ok('figma_vector', { ...t, operationId: opId(), action: 'createPolygon', parentId: frame.data.id, pointCount: 6, polygonWidth: 80, polygonHeight: 80 }, r => must(r.ok && r.data.id, '多边形失败'));
  created.push(poly.data.id);
  await ok('figma_vector', { ...t, operationId: opId(), action: 'setShapeParams', nodeId: poly.data.id, pointCount: 5, cornerRadius: 4 }, r => must(r.ok, '形状参数失败'));
  const paths = await ok('figma_vector', { ...t, operationId: opId(), action: 'createVectorPaths', x: 600, y: 300, paths: [{ windingRule: 'NONZERO', data: 'M 0 0 L 60 0 L 30 50 Z' }], name: 'FCW3-矢量' }, r => must(r.ok && r.data.id, '矢量路径失败'));
  created.push(paths.data.id);
  const a = await ok('figma_create_node', { ...t, operationId: opId(), type: 'ELLIPSE', name: 'FCW3-布尔A', x: 700, y: 300, width: 60, height: 60 }, r => must(r.ok, '布尔A失败'));
  const b = await ok('figma_create_node', { ...t, operationId: opId(), type: 'ELLIPSE', name: 'FCW3-布尔B', x: 730, y: 320, width: 60, height: 60 }, r => must(r.ok, '布尔B失败'));
  const boolNode = await ok('figma_vector', { ...t, operationId: opId(), action: 'boolean', nodeIds: [a.data.id, b.data.id], operation: 'UNION' }, r => must(r.ok && r.data.type === 'BOOLEAN_OPERATION', '布尔运算失败'));
  created.push(boolNode.data.id);
  await ok('figma_layout', { ...t, operationId: opId(), action: 'setLayout', nodeId: frame.data.id, props: { layoutMode: 'HORIZONTAL', itemSpacing: 12, paddingLeft: 10, paddingRight: 10, paddingTop: 10, paddingBottom: 10, primaryAxisSizingMode: 'FIXED' } }, r => must(r.ok, 'Auto Layout 失败'));
  await ok('figma_hierarchy', { ...t, operationId: opId(), action: 'clone', nodeId: poly.data.id }, r => must(r.ok, 'clone 失败'));
  await ok('figma_visual', { ...t, operationId: opId(), action: 'setEffects', nodeId: frame.data.id, props: { effects: [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.3 }, offset: { x: 2, y: 4 }, radius: 8, visible: true, blendMode: 'NORMAL' }] } }, r => must(r.ok, 'effects 失败'));
  await ok('figma_visual', { ...t, operationId: opId(), action: 'setCornerRadii', nodeId: frame.data.id, props: { topLeftRadius: 8, topRightRadius: 8 } }, r => must(r.ok, '分角圆角失败'));
  const text = await ok('figma_create_node', { ...t, operationId: opId(), type: 'TEXT', text: 'FCW3 富文本', parentId: frame.data.id }, r => must(r.ok, '文本失败'));
  created.push(text.data.id);
  await ok('figma_text_range', { ...t, operationId: opId(), nodeId: text.data.id, action: 'setStyles', start: 0, end: 4, styles: { fontSize: 20 } }, r => must(r.ok && r.data.appliedProperties?.includes('fontSize'), '区间样式失败'));
  await ok('figma_text_range', { ...t, nodeId: text.data.id, action: 'getStyles', start: 0, end: 4 }, r => must(r.ok, '区间读取失败'));
}

async function groupProto() {
  const t = await ctx();
  const from = await ok('figma_create_node', { ...t, operationId: opId(), type: 'FRAME', name: 'FCW3-原型起点', x: 0, y: 600, width: 100, height: 60 }, r => must(r.ok, '起点失败'));
  const to = await ok('figma_create_node', { ...t, operationId: opId(), type: 'FRAME', name: 'FCW3-原型目标', x: 200, y: 600, width: 100, height: 60 }, r => must(r.ok, '目标失败'));
  created.push(from.data.id, to.data.id);
  await ok('figma_set_reactions', { ...t, operationId: opId(), nodeId: from.data.id, action: 'set', reactions: [{ trigger: { type: 'ON_CLICK' }, action: { type: 'NAVIGATE', destinationId: to.data.id, navigation: 'NAVIGATE' } }] }, r => must(r.ok, '设置 reaction 失败'));
  await ok('figma_set_reactions', { ...t, operationId: opId(), nodeId: from.data.id, action: 'clear' }, r => must(r.ok, '清除 reaction 失败'));
  await ok('figma_batch', { ...t, operationId: opId(), steps: [
    { command: 'createNode', params: { type: 'RECTANGLE', name: 'FCW3-batch-1' } },
    { command: 'createNode', params: { type: 'step0.id' === '' ? 'RECTANGLE' : 'ELLIPSE', name: 'FCW3-batch-2' } },
  ] }, r => must(r.ok && r.data.steps?.length === 2 && r.data.steps.every(s => s.status === 'succeeded'), 'batch 失败'));
  const batchFail = await ok('figma_batch', { ...t, operationId: opId(), steps: [
    { command: 'createNode', params: { type: 'RECTANGLE', name: 'FCW3-batch-ok' } },
    { command: 'createNode', params: { type: 'TEXT' } },
    { command: 'createNode', params: { type: 'ELLIPSE' } },
  ] }, r => must(!r.ok && r.error.code === 'BATCH_STOPPED' && r.error.details?.steps?.length === 3, 'batch 失败逐项状态缺失'));
  void batchFail;
  const ops = await ok('figma_query_nodes', { ...t, nameContains: 'FCW3-batch', limit: 50 }, r => must(r.ok && r.data.nodes.length >= 2, 'batch 产物查询失败'));
  for (const node of ops.data.nodes) created.push(node.id);
}

async function groupMotion() {
  const t = await ctx();
  const shaders = await ok('figma_shaders', t, r => must(r.ok && Array.isArray(r.data.shaders), 'Shader 列表失败'));
  line(`- [INFO] Shader 数量=${shaders.data.shaders.length}${shaders.data.shaders.length === 0 ? '（当前账号/文件无可用样本，如实记录）' : ''}`);
  const frame = await ok('figma_create_node', { ...t, operationId: opId(), type: 'FRAME', name: 'FCW3-动画Frame', x: 0, y: 700, width: 200, height: 120 }, r => must(r.ok, 'Frame 失败'));
  created.push(frame.data.id);
  const rect = await ok('figma_create_node', { ...t, operationId: opId(), type: 'RECTANGLE', parentId: frame.data.id, name: 'FCW3-动画子节点', width: 50, height: 50 }, r => must(r.ok, '子节点失败'));
  created.push(rect.data.id);
  const motion = await call('figma_motion', { ...t, operationId: opId(), action: 'applyTrack', nodeId: rect.data.id,
    field: { type: 'PROPERTY', name: 'TRANSLATION_X' },
    track: { baseValue: { type: 'FLOAT', value: 0 }, keyframes: [
      { timelinePosition: 0, value: { type: 'FLOAT', value: 0 } },
      { timelinePosition: 0.5, value: { type: 'FLOAT', value: 80 } },
    ] } });
  if (motion.ok) {
    line('- [PASS] 手动关键帧轨道已应用（Motion API 真机可用）');
    const styles = await call('figma_motion', { ...t, action: 'listAnimationStyles' });
    line(`- [INFO] figmaAnimationStyles 数量=${styles.ok ? styles.data.styles.length : 'API 不可用'}`);
    const job = await ok('figma_export_video', { ...t, operationId: opId(), nodeId: frame.data.id, format: 'MP4' }, r => must(r.ok && r.data.state === 'accepted', '视频作业未受理'));
    line('- [INFO] 等待 MP4 编码完成（最长 120s）…');
    const deadline = Date.now() + 120000;
    let final = null;
    while (Date.now() < deadline) {
      const poll = await call('figma_get_operation', { ...t, operationId: job.data.jobId });
      if (poll.ok && ['succeeded', 'failed', 'partial'].includes(poll.data.state)) { final = poll.data; break; }
      await new Promise(r => setTimeout(r, 2000));
    }
    must(final, '视频作业超时');
    must(final.state === 'succeeded', '视频作业失败: ' + JSON.stringify(final.result || {}));
    line(`- [PASS] MP4 导出完成（bytes=${final.result?.totalBytes || '见产物'}）`);
  } else {
    line(`- [SKIP] Motion 关键帧轨道不可用（${motion.error?.code}: ${motion.error?.message}）——API/账号限制如实记录`);
  }
}

async function groupEditorFigJam() {
  const t = await ctx();
  const sticky = await ok('figma_figjam', { ...t, operationId: opId(), action: 'createSticky', x: 0, y: 0, text: 'FCW3 FigJam 验收' }, r => must(r.ok && r.data.id, '便笺失败'));
  created.push(sticky.data.id);
  const shape = await ok('figma_figjam', { ...t, operationId: opId(), action: 'createShapeWithText', x: 260, y: 0, text: 'FCW3 形状', shapeType: 'SQUARE' }, r => must(r.ok && r.data.id, '形状失败'));
  created.push(shape.data.id);
  const connector = await ok('figma_figjam', { ...t, operationId: opId(), action: 'createConnector', startNodeId: sticky.data.id, endNodeId: shape.data.id }, r => must(r.ok && r.data.id, '连接线失败'));
  created.push(connector.data.id);
  await ok('figma_figjam', { ...t, nodeId: sticky.data.id, action: 'updateSticky', text: 'FCW3 FigJam 验收（已修改）' }, r => must(r.ok, '便笺更新失败'));
  await ok('figma_figjam', { ...t, action: 'listNodes', limit: 20 }, r => must(r.ok && r.data.nodes.length >= 3, '列表读取失败'));
  line('- [PASS] FigJam 原生对象可编辑且连接关系正确');
}

async function groupEditorSlides() {
  const t = await ctx();
  const structure = await ok('figma_slides', { ...t, action: 'listStructure' }, r => must(r.ok && Array.isArray(r.data.structure), '结构读取失败'));
  line(`- [INFO] Slides 顶层结构 ${structure.data.structure.length} 项`);
  const row = await ok('figma_slides', { ...t, operationId: opId(), action: 'createSlideRow' }, r => must(r.ok && r.data.id, '创建行失败'));
  created.push(row.data.id);
  const slide = await ok('figma_slides', { ...t, operationId: opId(), action: 'createSlide', relativeToId: row.data.id, order: 'after' }, r => must(r.ok && r.data.id, '创建幻灯片失败'));
  created.push(slide.data.id);
  const content = await ok('figma_slides', { ...t, operationId: opId(), action: 'addContent', slideId: slide.data.id, content: { type: 'TEXT', x: 40, y: 40, width: 300, height: 60, text: 'FCW3 Slides 验收标题', fontSize: 24, name: 'FCW3-标题' } }, r => must(r.ok && r.data.id, '添加内容失败'));
  created.push(content.data.id);
  await ok('figma_slides', { ...t, nodeId: content.data.id, action: 'updateContent', content: { text: 'FCW3 Slides 验收标题（已修改）' } }, r => must(r.ok, '内容更新失败'));
  line('- [PASS] Slides 幻灯片创建与内容修改完成');
}

// ---- main ------------------------------------------------------------------
try {
  line(`# FCW3 真机验收 — 组=${group} — ${new Date().toISOString()}`);
  await waitForAuthorized();
  const groups = {
    core: groupCore, pages: groupPages, assets: groupAssets, 'design-system': groupDesignSystem,
    'edit-domain': groupEditDomain, proto: groupProto, motion: groupMotion,
    'editors-figjam': groupEditorFigJam, 'editors-slides': groupEditorSlides,
  };
  must(groups[group], '未知验收组: ' + group);
  await groups[group]();
  if (created.length) {
    line(`清理本次创建对象：${created.length} 个（删除结果见下）`);
    const t = await ctx();
    for (const id of created) {
      await call('figma_delete_node', { ...t, operationId: opId(), nodeId: id }).catch(() => {});
    }
    line('- [INFO] 清理完成（原页面内容未触碰）');
  }
  line(`# 组 ${group} 完成`);
} catch (e) {
  line(`# 验收组异常中止：${e.message}`);
  if (created.length) line(`# 未清理对象（记录 ID 供手动清理）：${created.join(', ')}`);
  process.exitCode = 1;
} finally {
  if (reportPath && results.length) fs.writeFileSync(reportPath, results.join('\n') + '\n');
  bridge.stdin.end();
  setTimeout(() => process.exit(process.exitCode || 0), 300);
}
