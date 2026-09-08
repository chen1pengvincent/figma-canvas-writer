// Figma Canvas Writer: current-page executor. Network authentication lives in ui.html.
// sessionId routes a plugin run; it is never used as an authentication secret.
const BRIDGE_URL = 'ws://localhost:9753/plugin';
const AUTH_TOKEN_KEY = 'bridgeToken';
const CREATE_TYPES = ['RECTANGLE', 'ELLIPSE', 'TEXT', 'FRAME', 'LINE', 'STAR'];
const MODIFY_PROPS = new Set(['name', 'x', 'y', 'width', 'height', 'rotation',
  'opacity', 'visible', 'fills', 'strokes', 'strokeWeight', 'cornerRadius']);
const PAINT_TYPES = new Set(['SOLID', 'GRADIENT_LINEAR', 'GRADIENT_RADIAL',
  'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND', 'IMAGE', 'VIDEO', 'EMOJI']);
const WRITES = new Set(['createNode', 'modifyNode', 'deleteNode', 'setText']);
let sessionId = newSessionId();
let pageRevision = 0;
let queue = Promise.resolve();
const operations = new Map();
let operationBytes = 0;

function newSessionId() {
  return Date.now().toString(36) + '-' + Array.from({length: 4}, () => Math.random().toString(36).slice(2)).join('');
}
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}
function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function appErr(code, message) { const e = new Error(message); e.code = code; return e; }
function isFiniteNum(v, min, max) { return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max; }
function requireStr(v, name, opts = {}) {
  if (typeof v !== 'string' || (!opts.allowEmpty && !v.length)) throw appErr('INVALID_PARAM', `${name} 必须是字符串`);
  return v;
}
function requireNum(v, name, min, max) {
  if (!isFiniteNum(v, min, max)) throw appErr('INVALID_PARAM', `${name} 必须在 [${min}, ${max}] 内`);
  return v;
}
function requireBool(v, name) {
  if (typeof v !== 'boolean') throw appErr('INVALID_PARAM', `${name} 必须是布尔值`);
  return v;
}
function onlyKeys(p, keys) {
  if (!isPlainObject(p)) throw appErr('INVALID_PARAM', 'params 必须是普通对象');
  for (const k of Object.keys(p)) if (!keys.includes(k)) throw appErr('INVALID_PARAM', `未知参数: ${k}`);
}
function getContext() {
  const pageName = String(figma.currentPage.name);
  const fileName = String(figma.root.name);
  return { sessionId, pageId: figma.currentPage.id, pageName: pageName.slice(0, 256),
    fileName: fileName.slice(0, 256), editorType: figma.editorType,
    ...(pageName.length > 256 ? { pageNameTruncated: true } : {}),
    ...(fileName.length > 256 ? { fileNameTruncated: true } : {}) };
}
function assertTarget(t) {
  if (t.sessionId !== sessionId) throw appErr('SESSION_CHANGED', '插件授权会话已变化，请重新读取状态');
  if (t.pageId !== figma.currentPage.id || t.revision !== pageRevision) throw appErr('PAGE_CHANGED', '目标页面已变化，请重新读取状态');
}
function pageOfNode(node) {
  let n = node;
  while (n && n.type !== 'PAGE' && n.type !== 'DOCUMENT') n = n.parent;
  return n && n.type === 'PAGE' ? n : null;
}
async function getNode(id, t) {
  requireStr(id, 'id');
  const node = await figma.getNodeByIdAsync(id);
  assertTarget(t);
  if (!node || node.removed) throw appErr('NODE_NOT_FOUND', `找不到节点: ${id}`);
  if (node.type === 'DOCUMENT' || node.type === 'PAGE') throw appErr('INVALID_TARGET', '请使用页面上下文接口读取页面');
  if (!pageOfNode(node) || pageOfNode(node).id !== t.pageId) throw appErr('PAGE_CHANGED', '节点不在当前授权页面');
  return node;
}
function markMutation(t, node) {
  assertTarget(t);
  if (node && (node.removed || !pageOfNode(node) || pageOfNode(node).id !== t.pageId)) throw appErr('PAGE_CHANGED', '节点已移出当前授权页面或被移除');
  t.mutating = true;
  if (node && !t.affected.includes(node.id)) t.affected.push(node.id);
}
function cloneValue(v) {
  if (v === figma.mixed) return { mixed: true };
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  if (v === undefined) return undefined;
  return JSON.parse(JSON.stringify(v));
}
function buildNodeInfo(node, depth = 0, budget = { remaining: 100, remainingChars: 56000 }) {
  budget.remaining--;
  const name = String(node.name);
  const info = { id: node.id, name: name.slice(0, 1024), type: node.type, parentId: node.parent ? node.parent.id : null };
  if (name.length > 1024) { info.nameTruncated = true; info.nameLength = name.length; }
  const errors = [];
  const truncatedFields = [];
  budget.remainingChars -= JSON.stringify(info).length + 256;
  for (const k of ['x','y','width','height','rotation','opacity','visible','locked',
    'fills','strokes','strokeWeight','cornerRadius','fontName','fontSize','characters']) {
    try {
      if (!(k in node)) continue;
      let v = cloneValue(node[k]);
      if (k === 'characters' && typeof v === 'string' && v.length > 16000) {
        info.charactersLength = v.length; info.charactersTruncated = true; v = v.slice(0, 16000);
      }
      if (v !== undefined) {
        const size = JSON.stringify(v).length;
        if (size > 24000 || size > budget.remainingChars) { truncatedFields.push(k); continue; }
        budget.remainingChars -= size + k.length + 4;
        info[k] = v;
      }
    } catch (e) { errors.push(k); }
  }
  const children = node.children || [];
  info.childrenCount = children.length;
  if (depth > 0 && children.length) {
    info.children = [];
    for (const child of children) {
      if (budget.remaining <= 0 || budget.remainingChars < 2000) break;
      info.children.push(buildNodeInfo(child, depth - 1, budget));
    }
  }
  info.truncated = children.length > ((info.children || []).length) || !!(info.children || []).find(n => n.truncated);
  if (errors.length) info.readErrors = errors;
  if (truncatedFields.length) { info.truncatedFields = truncatedFields; info.truncated = true; }
  return info;
}
function paginate(nodes, p) {
  onlyKeys(p, ['cursor','limit']);
  const limit = p.limit === undefined ? 50 : requireNum(p.limit, 'limit', 1, 100);
  if (!Number.isInteger(limit)) throw appErr('INVALID_PARAM', 'limit 必须是整数');
  if (p.cursor !== undefined && (typeof p.cursor !== 'string' || !/^(0|[1-9][0-9]*)$/.test(p.cursor))) throw appErr('INVALID_PARAM', 'cursor 必须是非负整数的字符串');
  const offset = p.cursor === undefined ? 0 : Number(p.cursor);
  if (!Number.isSafeInteger(offset) || offset > nodes.length) throw appErr('INVALID_PARAM', 'cursor 超出范围，请重新从首页读取');
  const budget = { remaining: 100, remainingChars: 56000 };
  const selected = [];
  for (const n of nodes.slice(offset, offset + limit)) {
    if (budget.remainingChars < 18000 && selected.length) break;
    selected.push(buildNodeInfo(n, 0, budget));
  }
  const next = offset + selected.length;
  return { ...getContext(), nodes: selected, total: nodes.length,
    nextCursor: next < nodes.length ? String(next) : null, truncated: next < nodes.length };
}
function validatePaints(v, name) {
  if (!Array.isArray(v)) throw appErr('INVALID_PARAM', `${name} 必须是数组`);
  if (v.length > 32) throw appErr('INVALID_PARAM', `${name} 数量超过 32`);
  const out = [];
  for (const paint of v) {
    if (!isPlainObject(paint)) throw appErr('INVALID_PARAM', `${name} 元素必须是普通对象`);
    if (typeof paint.type !== 'string' || !PAINT_TYPES.has(paint.type)) {
      throw appErr('INVALID_PARAM', `${name} 元素 type 非法`);
    }
    if (paint.type === 'SOLID') {
      // 支持两种颜色格式: {r,g,b} 对象(0..1) 或 "#RRGGBB"/"#RGB" hex 字符串(自动转 {r,g,b})
      let c = paint.color;
      if (typeof c === 'string') {
        c = hexToRgb01(c); // hex 字符串转 {r,g,b}(0..1); 非法 hex 会抛错
      }
      if (!isPlainObject(c)) throw appErr('INVALID_PARAM', 'SOLID 填充需要 color');
      for (const ch of ['r', 'g', 'b']) {
        if (!isFiniteNum(c[ch], 0, 1)) throw appErr('INVALID_PARAM', `color.${ch} 需在 [0,1]`);
      }
      if (c.a !== undefined && !isFiniteNum(c.a, 0, 1)) {
        throw appErr('INVALID_PARAM', 'color.a 需在 [0,1]');
      }
      if (c.a !== undefined && paint.opacity !== undefined && c.a !== paint.opacity) {
        throw appErr('INVALID_PARAM', 'color.a 与 opacity 冲突');
      }
      const normalized = { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b } };
      const opacity = paint.opacity === undefined ? c.a : paint.opacity;
      if (opacity !== undefined) normalized.opacity = requireNum(opacity, 'opacity', 0, 1);
      if (paint.visible !== undefined) normalized.visible = requireBool(paint.visible, 'visible');
      if (paint.blendMode !== undefined) normalized.blendMode = requireStr(paint.blendMode, 'blendMode');
      if (paint.boundVariables !== undefined) normalized.boundVariables = JSON.parse(JSON.stringify(paint.boundVariables));
      const allowed = new Set(['type', 'color', 'opacity', 'visible', 'blendMode', 'boundVariables']);
      for (const key of Object.keys(paint)) if (!allowed.has(key)) throw appErr('INVALID_PARAM', `不支持 SOLID.${key}`);
      for (const key of Object.keys(c)) if (!['r', 'g', 'b', 'a'].includes(key)) throw appErr('INVALID_PARAM', `不支持 color.${key}`);
      out.push(normalized);
    } else {
      // 非 SOLID（渐变/图片等）深拷贝为纯数据；JSON 往返同时剔除函数并规避 __proto__ 特殊键
      out.push(JSON.parse(JSON.stringify(paint)));
    }
  }
  return out;
}

// hex 颜色字符串转 {r,g,b}(0..1 浮点); 支持 "#RRGGBB" 和 "#RGB", 非法格式抛 INVALID_PARAM
function hexToRgb01(hex) {
  if (typeof hex !== 'string') throw appErr('INVALID_PARAM', 'color 必须是字符串或 {r,g,b} 对象');
  const m = hex.trim().match(/^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/);
  if (!m) throw appErr('INVALID_PARAM', `非法 hex 颜色: ${hex}（需 #RRGGBB 或 #RGB）`);
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

function validateModifyProps(props) {
  if (!isPlainObject(props)) throw appErr('INVALID_PARAM', 'props 必须是普通对象');
  const out = {};
  for (const key of Object.keys(props)) {
    if (!MODIFY_PROPS.has(key)) {
      throw appErr('INVALID_PARAM', `属性不在白名单内: ${key}`);
    }
    const v = props[key];
    switch (key) {
      case 'name': out.name = requireStr(v, 'name', { allowEmpty: true }); break;
      case 'x': out.x = requireNum(v, 'x', -1e6, 1e6); break;
      case 'y': out.y = requireNum(v, 'y', -1e6, 1e6); break;
      case 'width': out.width = requireNum(v, 'width', 0.01, 1e5); break;
      case 'height': out.height = requireNum(v, 'height', 0, 1e5); break;
      case 'rotation': out.rotation = requireNum(v, 'rotation', -360, 360); break; // 角度
      case 'opacity': out.opacity = requireNum(v, 'opacity', 0, 1); break;
      case 'visible': out.visible = requireBool(v, 'visible'); break;
      case 'strokeWeight': out.strokeWeight = requireNum(v, 'strokeWeight', 0, 1e5); break;
      case 'cornerRadius': out.cornerRadius = requireNum(v, 'cornerRadius', 0, 1e5); break;
      case 'fills': out.fills = validatePaints(v, 'fills'); break;
      case 'strokes': out.strokes = validatePaints(v, 'strokes'); break;
    }
  }
  return out;
}


async function loadFont(font) {
  try { await figma.loadFontAsync(font); }
  catch (e) { throw appErr('FONT_NOT_LOADABLE', `无法加载字体 ${font.family} ${font.style}`); }
}
async function loadNodeFonts(node, extra) {
  let fonts = [];
  if (extra) fonts = [extra];
  else if (node.characters.length) fonts = node.getRangeAllFontNames(0, node.characters.length);
  else if (node.fontName !== figma.mixed) fonts = [node.fontName];
  const seen = new Set();
  for (const f of fonts) {
    const key = JSON.stringify(f);
    if (!seen.has(key)) { seen.add(key); await loadFont(f); }
  }
}
function preflightProps(node, props) {
  for (const k of Object.keys(props)) {
    if (!(k in node)) throw appErr('UNSUPPORTED_PROPERTY', `${node.type} 不支持 ${k}`);
  }
  if (hasOwn(props, 'width') || hasOwn(props, 'height')) {
    if (typeof node.resize !== 'function') throw appErr('UNSUPPORTED_PROPERTY', '节点不能调整尺寸');
    const w = hasOwn(props, 'width') ? props.width : node.width;
    const h = hasOwn(props, 'height') ? props.height : node.height;
    requireNum(w, 'width', 0.01, 1e5);
    if (node.type === 'LINE') {
      if (h !== 0) throw appErr('INVALID_PARAM', 'LINE 的 height 必须为 0');
    } else requireNum(h, 'height', 0.01, 1e5);
  }
}
function applyProps(node, props, t) {
  preflightProps(node, props);
  const applied = [];
  try {
    for (const k of Object.keys(props)) {
      if (k === 'width' || k === 'height') continue;
      markMutation(t, node); node[k] = props[k]; applied.push(k);
    }
    if (hasOwn(props, 'width') || hasOwn(props, 'height')) {
      markMutation(t, node);
      node.resize(hasOwn(props, 'width') ? props.width : node.width,
        node.type === 'LINE' ? 0 : hasOwn(props, 'height') ? props.height : node.height);
      applied.push('size');
    }
  } catch (e) {
    const failure = appErr('PROP_APPLY_FAILED', e.message);
    failure.state = t.mutating ? 'partial' : 'not_started';
    failure.details = { appliedProperties: applied };
    if (t.mutating && !node.removed && pageOfNode(node) && pageOfNode(node).id === t.pageId) failure.details.readBack = buildNodeInfo(node);
    throw failure;
  }
}
async function handleCreateNode(p, t) {
  onlyKeys(p, ['type','name','x','y','width','height','parentId','text','props']);
  if (!CREATE_TYPES.includes(p.type)) throw appErr('INVALID_PARAM', '不支持创建该类型');
  const props = p.props === undefined ? {} : validateModifyProps(p.props);
  for (const k of ['name','x','y','width','height']) {
    if (hasOwn(p, k)) {
      if (hasOwn(props, k)) throw appErr('INVALID_PARAM', `重复指定属性 ${k}`);
      Object.assign(props, validateModifyProps({ [k]: p[k] }));
    }
  }
  if (p.type === 'TEXT') requireStr(p.text, 'text', {allowEmpty: true});
  else if (p.text !== undefined) throw appErr('INVALID_PARAM', 'text 只用于 TEXT');
  if (hasOwn(props, 'height')) {
    if (p.type === 'LINE' && props.height !== 0) throw appErr('INVALID_PARAM', 'LINE 的 height 必须为 0');
    if (p.type !== 'LINE') requireNum(props.height, 'height', 0.01, 1e5);
  }
  const parent = p.parentId === undefined ? null : await getNode(p.parentId, t);
  if (parent && parent.type !== 'FRAME') throw appErr('INVALID_TARGET', 'parentId 必须是当前页 FRAME');
  const font = { family: 'Inter', style: 'Regular' };
  if (p.type === 'TEXT') await loadFont(font);
  assertTarget(t); // no node may be created on a page changed during an await
  if (parent && (parent.removed || !pageOfNode(parent) || pageOfNode(parent).id !== t.pageId)) throw appErr('PAGE_CHANGED', '父节点已移出当前授权页面或被移除');
  let node;
  try {
    const creators = { RECTANGLE: 'createRectangle', ELLIPSE: 'createEllipse', TEXT: 'createText',
      FRAME: 'createFrame', LINE: 'createLine', STAR: 'createStar' };
    markMutation(t);
    node = figma[creators[p.type]]();
    t.affected.push(node.id);
    if (parent) parent.appendChild(node);
    if (p.type === 'TEXT') { node.fontName = font; node.characters = p.text; }
    applyProps(node, props, t);
    return buildNodeInfo(node);
  } catch (e) {
    if (node) {
      try { node.remove(); e.state = 'rolled_back'; t.affected = []; }
      catch (cleanup) { e.state = 'partial'; e.details = { cleanupError: cleanup.message }; }
    } else e.state = 'unknown';
    throw e;
  }
}
async function handleModifyNode(p, t) {
  onlyKeys(p, ['id','props']);
  const props = validateModifyProps(p.props);
  const node = await getNode(p.id, t);
  preflightProps(node, props);
  if (node.type === 'TEXT' && (hasOwn(props,'width') || hasOwn(props,'height'))) await loadNodeFonts(node);
  assertTarget(t);
  applyProps(node, props, t);
  return buildNodeInfo(node);
}
async function handleSetText(p, t) {
  onlyKeys(p, ['id','text','fontName','fontSize','x','y']);
  if (p.text !== undefined) requireStr(p.text, 'text', { allowEmpty: true });
  if (p.fontSize !== undefined) requireNum(p.fontSize, 'fontSize', 1, 1000);
  for (const k of ['x','y']) if (p[k] !== undefined) requireNum(p[k], k, -1e6, 1e6);
  if (p.fontName !== undefined) {
    onlyKeys(p.fontName, ['family','style']);
    requireStr(p.fontName.family, 'fontName.family'); requireStr(p.fontName.style, 'fontName.style');
  }
  const node = await getNode(p.id, t);
  if (node.type !== 'TEXT') throw appErr('INVALID_TARGET', '目标不是文本节点');
  // Moving text does not require loading or normalizing its fonts.
  if (p.fontName !== undefined || p.fontSize !== undefined || p.text !== undefined) await loadNodeFonts(node, p.fontName);
  assertTarget(t);
  try {
    for (const k of ['fontName','fontSize','text','x','y']) {
      if (!hasOwn(p, k)) continue;
      markMutation(t, node); node[k === 'text' ? 'characters' : k] = p[k];
    }
  } catch (e) { e.state = t.mutating ? 'partial' : 'not_started'; throw e; }
  return buildNodeInfo(node);
}
async function handleDeleteNode(p, t) {
  onlyKeys(p, ['id']);
  const node = await getNode(p.id, t);
  markMutation(t, node); node.remove();
  return { id: p.id, deleted: true };
}
const HANDLERS = {
  ping: async () => ({ pong: true, ...getContext() }),
  getContext: async (p) => paginate(figma.currentPage.children, p),
  getSelection: async (p) => paginate(figma.currentPage.selection || [], p),
  getNodeInfo: async (p,t) => {
    onlyKeys(p, ['id','depth']);
    const depth = p.depth === undefined ? 3 : requireNum(p.depth, 'depth', 0, 6);
    if (!Number.isInteger(depth)) throw appErr('INVALID_PARAM', 'depth 必须是整数');
    return buildNodeInfo(await getNode(p.id,t), depth);
  },
  createNode: handleCreateNode, modifyNode: handleModifyNode, setText: handleSetText, deleteNode: handleDeleteNode,
};
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (isPlainObject(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function postToUi(value) { figma.ui.postMessage(value); }
function failure(e, t) {
  return { ok: false, error: { code: e.code || 'PLUGIN_ERROR', message: e.message || String(e),
    state: e.state || (t.mutating ? 'unknown' : 'not_started'), affectedNodeIds: t.affected,
    ...(e.details ? { details: e.details } : {}) } };
}
async function execute(msg, t) {
  try {
    assertTarget(t);
    if (!hasOwn(HANDLERS, msg.command)) throw appErr('UNKNOWN_COMMAND', '未知命令');
    if (!isPlainObject(msg.params)) throw appErr('INVALID_PARAM', 'params 必须是普通对象');
    const data = await HANDLERS[msg.command](msg.params, t);
    return { ok: true, data: WRITES.has(msg.command)
      ? { ...data, state: 'succeeded', operationId: msg.operationId, affectedNodeIds: t.affected } : data };
  } catch (e) { return failure(e,t); }
}
async function dispatch(msg) {
  const t = { sessionId: msg.sessionId, pageId: msg.pageId, revision: pageRevision, mutating: false, affected: [] };
  const reply = r => postToUi({ type:'exec_result', id:msg.id, ...r });
  if (msg.command === 'ping') { reply({ok:true,data:await HANDLERS.ping()}); return; }
  try { assertTarget(t); } catch (e) { reply(failure(e,t)); return; }
  if (msg.command === 'getOperation') {
    try {
      onlyKeys(msg.params, ['operationId']);
      const id = requireStr(msg.params.operationId, 'operationId');
      const rec = operations.get(id);
      if (rec && (rec.sessionId !== msg.sessionId || rec.pageId !== msg.pageId)) throw appErr('OPERATION_TARGET_MISMATCH', '操作属于另一目标');
      reply({ok:true,data: rec ? {operationId:id,state:rec.state,result:rec.result || null} : {operationId:id,state:'not_found'}});
    } catch (e) { reply(failure(e,t)); }
    return;
  }
  if (!WRITES.has(msg.command)) {
    // Reads wait for earlier mutations; result lookup above may inspect an in-flight write.
    const task = queue.then(() => execute(msg,t));
    queue = task.then(() => undefined, () => undefined);
    reply(await task); return;
  }
  let rec;
  try {
    const id = requireStr(msg.operationId, 'operationId');
    if (id.length > 128) throw appErr('INVALID_PARAM', 'operationId 过长');
    if (!isPlainObject(msg.params)) throw appErr('INVALID_PARAM', 'params 必须是普通对象');
    const signature = canonical({ sessionId:msg.sessionId,pageId:msg.pageId,command:msg.command,params:msg.params });
    rec = operations.get(id);
    if (rec) {
      if (rec.signature !== signature) throw appErr('OPERATION_CONFLICT', '同一个 operationId 不能用于不同操作');
      reply(await rec.promise); return;
    }
    const reserve = signature.length * 2 + 1024;
    if (operations.size >= 1000 || operationBytes + reserve > 8 * 1024 * 1024) throw appErr('OPERATION_CAPACITY', '本次插件运行操作记录已满；对账后重开插件，不会逐出旧记录再重复执行');
    operationBytes += reserve;
    rec = { signature,sessionId:msg.sessionId,pageId:msg.pageId,state:'queued',result:null };
    rec.promise = queue.then(async () => {
      rec.state = 'running';
      const result = operationBytes + 196608 > 8 * 1024 * 1024
        ? failure(appErr('OPERATION_CAPACITY', '操作记录已满，请对账后重开插件'), t)
        : await execute(msg,t);
      rec.result = result;
      operationBytes += JSON.stringify(result).length * 2 - 1024;
      rec.state = result.ok ? 'succeeded' : result.error.state === 'partial' ? 'partial' : result.error.state === 'unknown' ? 'unknown' : 'failed';
      return result;
    });
    operations.set(id,rec);
    queue = rec.promise.then(() => undefined, () => undefined);
    reply(await rec.promise);
  } catch (e) { reply(failure(e,t)); }
}

figma.showUI(__html__, { width: 360, height: 440 });
postToUi({type:'init',context:getContext(),bridgeUrl:BRIDGE_URL});
figma.on('currentpagechange', () => {
  pageRevision++;
  postToUi({type:'context',context:getContext()});
});
figma.ui.onmessage = async msg => {
  if (!isPlainObject(msg)) return;
  if (msg.type === 'exec' && (typeof msg.id === 'string' || typeof msg.id === 'number')) {
    await dispatch(msg); return;
  }
  if (msg.type === 'revoke') {
    sessionId = newSessionId(); pageRevision++;
    postToUi({type:'context',context:getContext()}); return;
  }
  if (msg.type === 'getToken') {
    postToUi({type:'context',context:getContext()});
    try {
      const t = await figma.clientStorage.getAsync(AUTH_TOKEN_KEY);
      postToUi({type:'token',token:typeof t === 'string' && /^[a-f0-9]{64}$/.test(t) ? t : ''});
    } catch (e) { postToUi({type:'token',token:'',error:'无法读取本地配对信息'}); }
  } else if (msg.type === 'saveToken') {
    try {
      if (typeof msg.token !== 'string' || !/^[a-f0-9]{64}$/.test(msg.token)) throw new Error('配对密钥格式错误');
      await figma.clientStorage.setAsync(AUTH_TOKEN_KEY,msg.token);
      postToUi({type:'saved',ok:true});
    } catch (e) { postToUi({type:'saved',ok:false,error:e.message}); }
  } else if (msg.type === 'clearToken') {
    try { await figma.clientStorage.deleteAsync(AUTH_TOKEN_KEY); postToUi({type:'tokenCleared',ok:true}); }
    catch (e) { postToUi({type:'tokenCleared',ok:false,error:e.message}); }
  }
};
