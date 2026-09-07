// figma-canvas-writer/plugin/code.js
// Figma Canvas Writer —— Figma 插件主线程（普通插件，在 Figma 设计文件内运行，有画布写权限）。
// 作为命令执行器：经 ui.html(iframe, 有 WebSocket) 转发桥接命令，执行画布操作后回传结果。
// 接收 {type:"cmd", id, command, params} 命令并执行画布操作，返回 {type:"resp", ...}。

const BRIDGE_URL = 'ws://localhost:9753/plugin'; // 仅本机回环桥接地址
const PROTOCOL = 1;                              // 与桥接侧约定的握手协议版本
const AUTH_TOKEN_KEY = 'bridgeToken';            // token 存 Figma clientStorage
const RECONNECT_MIN_MS = 1000;                   // 断线重连指数退避下限 1s
const RECONNECT_MAX_MS = 15000;                  // 指数退避上限 15s

// ---- 白名单（安全边界）----
// 原因：所有命令与属性一律在白名单内分发/修改，未收录的键直接拒绝，
// 防止通过命令名或属性名注入、访问画布之外的 API。
const CREATE_TYPES = ['RECTANGLE', 'ELLIPSE', 'TEXT', 'FRAME', 'LINE', 'STAR'];
const MODIFY_PROPS = new Set([
  'name', 'x', 'y', 'width', 'height', 'rotation',
  'opacity', 'visible', 'fills', 'strokes', 'strokeWeight', 'cornerRadius',
]);
const PAINT_TYPES = new Set([
  'SOLID', 'GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR',
  'GRADIENT_DIAMOND', 'IMAGE', 'VIDEO', 'EMOJI',
]);

let reconnectDelay = RECONNECT_MIN_MS;
let reconnectTimer = null;
let connectionState = 'idle'; // idle|connecting|connected|authorized|auth_failed|disconnected
let authDetail = '';

// ---------------- 通用工具 ----------------

function log(...args) { console.error('[figma-canvas-writer]', ...args); }

// 防原型链污染：只接受“真·普通对象”（Object.prototype 直系），
// 数组/Date/Map 及带自定义原型的对象一律拒绝，之后只按白名单键名取值。
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype;
}
function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

class AppError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function appErr(code, message) { return new AppError(code, message); }

function round3(v) { return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v; }
function isFiniteNum(v, min, max) {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}
function nextFrame() { return new Promise((res) => setTimeout(res, 0)); }

function requireStr(v, name, opts = {}) {
  if (typeof v !== 'string' || (!opts.allowEmpty && v.length === 0)) {
    throw appErr('INVALID_PARAM', `${name} 必须是非空字符串`);
  }
  return v;
}
function optStr(v, name) {
  if (v === undefined || v === null) return undefined;
  return requireStr(v, name, { allowEmpty: true });
}
function requireNum(v, name, min, max) {
  if (!isFiniteNum(v, min, max)) {
    throw appErr('INVALID_PARAM', `${name} 必须是 [${min}, ${max}] 内的有限数字`);
  }
  return v;
}
function optNum(v, name, min, max) {
  if (v === undefined || v === null) return undefined;
  return requireNum(v, name, min, max);
}
function requireBool(v, name) {
  if (typeof v !== 'boolean') throw appErr('INVALID_PARAM', `${name} 必须是布尔值`);
  return v;
}
function optBool(v, name) {
  if (v === undefined || v === null) return undefined;
  return requireBool(v, name);
}

// ---------------- 页面上下文 / 节点定位 ----------------

function pageOfNode(node) {
  let cur = node;
  while (cur && cur.type !== 'PAGE' && cur.type !== 'DOCUMENT') cur = cur.parent;
  return cur && cur.type === 'PAGE' ? cur : null;
}

// 在指定页面上下文中执行 fn；跨页时切换 figma.currentPage（documentAccess: dynamic-page 允许运行时切页），
// 原因：Figma 只允许在“当前页”直接修改节点，跨页必须先切页。
async function withPageContext(page, fn) {
  const was = figma.currentPage;
  let switched = false;
  if (page && page !== was) {
    figma.currentPage = page;
    switched = true;
    await nextFrame(); // 切页后等一帧让 Figma 同步页面上下文
  }
  try {
    return await fn();
  } finally {
    // 原因：改回原页，避免打扰用户当前正在查看的页面
    if (switched && figma.currentPage !== was) figma.currentPage = was;
  }
}

// 对目标节点执行 fn(node)；自动切到其所在页面并重新按 id 取引用
// （原因：切页后旧的节点对象引用可能失效，必须重新 getNodeById）。
async function withNode(nodeId, fn) {
  const first = await figma.getNodeByIdAsync(String(nodeId));
  if (!first) throw appErr('NODE_NOT_FOUND', `找不到节点: ${nodeId}`);
  if (first.type === 'DOCUMENT' || first.type === 'PAGE') {
    throw appErr('INVALID_TARGET', '不能对文档/页面节点执行该操作');
  }
  const page = pageOfNode(first);
  return withPageContext(page, async () => {
    const node = await figma.getNodeByIdAsync(String(nodeId));
    if (!node) throw appErr('NODE_NOT_FOUND', `找不到节点: ${nodeId}`);
    return fn(node);
  });
}

// ---------------- 节点信息序列化 ----------------

function buildNodeInfo(node, depth, maxDepth, maxTotal) {
  if (!node || maxTotal <= 0) return null;
  let geom;
  try {
    // 原因：TEXT 节点在字体未加载时读 width/height 可能抛错，逐个兜底
    geom = {
      x: round3(node.x), y: round3(node.y),
      width: round3(node.width), height: round3(node.height),
    };
  } catch (e) {
    geom = { x: null, y: null, width: null, height: null };
  }
  const info = {
    id: node.id, name: node.name, type: node.type,
    x: geom.x, y: geom.y, width: geom.width, height: geom.height,
    rotation: round3(node.rotation), // Figma Plugin API 返回的 rotation 即度数(-180~180)
    opacity: round3(node.opacity),
    visible: !!node.visible,
  };
  if (node.type === 'TEXT') {
    try { info.characters = String(node.characters || ''); } catch (e) { info.characters = null; }
  }
  let budget = maxTotal - 1;
  const kids = node.children;
  if (kids && kids.length && depth < maxDepth) {
    info.children = [];
    for (const k of kids) {
      if (budget <= 0) break; // 原因：限制递归规模，防止超大节点树打爆消息
      const sub = buildNodeInfo(k, depth + 1, maxDepth, budget);
      if (sub) { info.children.push(sub); budget -= countNodes(sub); }
    }
  }
  return info;
}
function countNodes(info) {
  let c = 1;
  if (info.children) for (const ch of info.children) c += countNodes(ch);
  return c;
}

// ---------------- 输入校验（属性白名单 + 类型/范围 + 防原型链污染） ----------------

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
      out.push({ type: 'SOLID', color: { r: c.r, g: c.g, b: c.b, a: c.a === undefined ? 1 : c.a } });
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
      case 'width': out.width = requireNum(v, 'width', 0, 1e5); break;
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

// ---------------- 字体加载 ----------------

async function loadFont(font) {
  try { await figma.loadFontAsync(font); }
  catch (e) { throw appErr('FONT_NOT_LOADABLE', `无法加载字体 ${font.family} ${font.style}`); }
}
function dedupeFonts(list) {
  const seen = new Set();
  const out = [];
  for (const f of list) {
    const k = `${f.family}::${f.style}`;
    if (!seen.has(k)) { seen.add(k); out.push(f); }
  }
  return out;
}

// ---------------- 命令处理器 ----------------

async function handlePing() {
  return { pong: true, ts: Date.now() };
}

async function handleGetSelection() {
  const sel = figma.currentPage.selection || [];
  return sel.map((n) => buildNodeInfo(n, 0, 2, 60));
}

async function handleGetNodeInfo(p) {
  const id = requireStr(p.id, 'id');
  const depth = p.depth === undefined ? 3 : requireNum(p.depth, 'depth', 0, 6);
  const data = await withNode(id, (node) => buildNodeInfo(node, 0, depth, 100));
  return data;
}

async function handleCreateNode(p) {
  const type = requireStr(p.type, 'type');
  if (!CREATE_TYPES.includes(type)) {
    throw appErr('INVALID_PARAM', `不支持创建的类型: ${type}（允许: ${CREATE_TYPES.join('/')}）`);
  }
  const name = optStr(p.name, 'name');
  const x = optNum(p.x, 'x', -1e6, 1e6);
  const y = optNum(p.y, 'y', -1e6, 1e6);
  const w = optNum(p.width, 'width', 0, 1e5);
  const h = optNum(p.height, 'height', 0, 1e5);
  const text = p.text === undefined ? undefined : requireStr(p.text, 'text', { allowEmpty: true });
  if (type === 'TEXT' && text === undefined) {
    throw appErr('INVALID_PARAM', '创建 TEXT 节点必须提供 text 内容');
  }
  let parentId;
  let parentPre = null;
  if (p.parentId !== undefined && p.parentId !== null) {
    parentId = requireStr(p.parentId, 'parentId');
    parentPre = await figma.getNodeByIdAsync(parentId);
    if (!parentPre) throw appErr('NODE_NOT_FOUND', `找不到父节点: ${parentId}`);
    if (parentPre.type !== 'FRAME') throw appErr('INVALID_PARAM', 'parentId 必须是 FRAME 节点');
  }
  const targetPage = parentPre ? pageOfNode(parentPre) : figma.currentPage;
  if (!targetPage) throw appErr('INVALID_PARAM', '无法确定创建目标页面');

  return withPageContext(targetPage, async () => {
    // 原因：切页后需重新按 id 取父节点引用
    const parent = parentId ? await figma.getNodeByIdAsync(parentId) : null;
    let node = null;
    if (type === 'RECTANGLE') node = figma.createRectangle();
    else if (type === 'ELLIPSE') node = figma.createEllipse();
    else if (type === 'TEXT') {
      node = figma.createText();
      await loadFontForText(node); // 写字符前必须先加载字体
      node.characters = text;
    } else if (type === 'FRAME') {
      node = figma.createFrame();
    } else if (type === 'LINE') {
      node = figma.createLine();
      node.strokeWeight = 1;
      node.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }];
    } else if (type === 'STAR') {
      node = figma.createStar(); // Figma Plugin API 原生星形
    }
    if (!node) throw appErr('CREATE_FAILED', '节点创建失败');
    if (name !== undefined) node.name = name;

    if (parent) parent.appendChild(node); // 挂到指定 FRAME
    else figma.currentPage.appendChild(node); // 否则留在当前页

    if (type !== 'LINE' && (w !== undefined || h !== undefined)) {
      const cw = w !== undefined ? w : node.width;
      const ch = h !== undefined ? h : node.height;
      try { node.resize(cw, ch); } catch (e) { /* LINE 等不支持 resize 时忽略 */ }
    }
    if (x !== undefined) node.x = x;
    if (y !== undefined) node.y = y;
    // 修复: createNode 之前完全没应用 props(fills/strokes/rotation 等), 导致颜色等属性丢失。
    // 在定位后统一应用 props(经 validateModifyProps 做 hex 颜色转换 + applyProps 应用)
    if (p.props !== undefined && p.props !== null) {
      const extraProps = validateModifyProps(p.props);
      await applyProps(node, extraProps);
    }
    return { id: node.id, name: node.name, type: node.type };
  });
}

async function loadFontForText(textNode) {
  let font = null;
  try { font = textNode.fontName; } catch (e) { font = null; }
  const target = font || { family: 'Inter', style: 'Regular' };
  try { await figma.loadFontAsync(target); }
  catch (e) {
    if (font) throw appErr('FONT_NOT_LOADABLE', `无法加载默认字体 ${font.family} ${font.style}`);
    throw appErr('FONT_NOT_LOADABLE', '无法加载默认字体 Inter Regular');
  }
}

async function handleModifyNode(p) {
  const id = requireStr(p.id, 'id');
  const props = validateModifyProps(p.props);
  const applied = await withNode(id, async (node) => {
    await applyProps(node, props);
    return { id: node.id };
  });
  return applied;
}

async function applyProps(node, props) {
  const has = (k) => hasOwn(props, k);
  // 逐属性 try/catch：Figma 不同节点类型对属性支持不同，给出干净的错误
  try { if (has('name')) node.name = props.name; } catch (e) { throw appErr('PROP_APPLY_FAILED', `name 应用失败: ${e.message}`); }
  if (has('x') || has('y')) {
    try {
      node.x = has('x') ? props.x : node.x;
      node.y = has('y') ? props.y : node.y;
    } catch (e) { throw appErr('PROP_APPLY_FAILED', `位置属性应用失败: ${e.message}`); }
  }
  if (has('width') || has('height')) {
    const nw = has('width') ? props.width : node.width;
    const nh = has('height') ? props.height : node.height;
    if (node.type !== 'LINE') {
      try { node.resize(nw, nh); }
      catch (e) { throw appErr('PROP_APPLY_FAILED', `resize 失败: ${e.message}`); }
    }
  }
  try {
    if (has('rotation')) node.rotation = props.rotation; // Figma Plugin API 的 rotation 即度数, 直接写入
  } catch (e) { throw appErr('PROP_APPLY_FAILED', `rotation 应用失败: ${e.message}`); }
  try { if (has('opacity')) node.opacity = props.opacity; } catch (e) { throw appErr('PROP_APPLY_FAILED', `opacity 应用失败: ${e.message}`); }
  try { if (has('visible')) node.visible = props.visible; } catch (e) { throw appErr('PROP_APPLY_FAILED', `visible 应用失败: ${e.message}`); }
  try { if (has('strokeWeight')) node.strokeWeight = props.strokeWeight; } catch (e) { throw appErr('PROP_APPLY_FAILED', '该节点不支持 strokeWeight'); }
  try { if (has('cornerRadius')) node.cornerRadius = props.cornerRadius; } catch (e) { throw appErr('PROP_APPLY_FAILED', '该节点不支持 cornerRadius'); }
  try { if (has('fills')) node.fills = props.fills; } catch (e) { throw appErr('PROP_APPLY_FAILED', `fills 应用失败: ${e.message}`); }
  try { if (has('strokes')) node.strokes = props.strokes; } catch (e) { throw appErr('PROP_APPLY_FAILED', `strokes 应用失败: ${e.message}`); }
}

async function handleDeleteNode(p) {
  const id = requireStr(p.id, 'id');
  const removed = await withNode(id, (node) => { node.remove(); return { id }; });
  return removed;
}

async function handleSetText(p) {
  const id = requireStr(p.id, 'id');
  const text = p.text === undefined ? '' : requireStr(p.text, 'text', { allowEmpty: true });
  const fontSize = optNum(p.fontSize, 'fontSize', 1, 1000);
  const x = optNum(p.x, 'x', -1e6, 1e6);
  const y = optNum(p.y, 'y', -1e6, 1e6);
  let fontNameObj = null;
  if (p.fontName !== undefined && p.fontName !== null) {
    if (!isPlainObject(p.fontName) ||
        typeof p.fontName.family !== 'string' || typeof p.fontName.style !== 'string') {
      throw appErr('INVALID_PARAM', 'fontName 必须是 {family, style} 字符串对象');
    }
    fontNameObj = { family: p.fontName.family, style: p.fontName.style };
  }

  const res = await withNode(id, async (node) => {
    if (node.type !== 'TEXT') throw appErr('INVALID_TARGET', '目标节点不是文本节点');
    // 先确定要加载的字体：显式 fontName 优先；否则取当前字体；都没有则退回默认
    let fontsToLoad = [];
    if (fontNameObj) {
      fontsToLoad.push(fontNameObj);
    } else {
      try {
        const len = node.characters.length;
        fontsToLoad.push(...node.getRangeAllFontNames(0, Math.max(len, 1)));
      } catch (e) { /* 忽略空文本/未加载字体的读取失败 */ }
      if (fontsToLoad.length === 0) fontsToLoad.push({ family: 'Inter', style: 'Regular' });
    }
    // 原因：修改字符内容前必须先 loadFontAsync 目标字体，否则 Figma 抛 “font not loaded”
    const uniq = dedupeFonts(fontsToLoad);
    for (const f of uniq) await loadFont(f);
    if (fontNameObj) node.fontName = fontNameObj;
    if (fontSize !== undefined) node.fontSize = fontSize;
    node.characters = text;
    if (x !== undefined) node.x = x;
    if (y !== undefined) node.y = y;
    return { id: node.id, characters: text };
  });
  return res;
}

// ---------------- 命令分发 ----------------

const HANDLERS = {
  ping: handlePing,
  getSelection: handleGetSelection,
  getNodeInfo: handleGetNodeInfo,
  createNode: handleCreateNode,
  modifyNode: handleModifyNode,
  deleteNode: handleDeleteNode,
  setText: handleSetText,
};


// ---------------- 通信层（postMessage ↔ ui.html；主线程无 WebSocket，网络全在 iframe） ----------------
// 架构：主线程(本文件, QuickJS, 有 Plugin API, 无 WebSocket) ←→ ui.html(iframe, 有 WebSocket) ←→ 桥接
// 桥接命令经 ui.html 转发给主线程执行，结果原路返回。

function postToUi(obj) {
  try { figma.ui.postMessage(obj); } catch (e) { /* UI 未就绪时忽略 */ }
}

// 执行命令并回传结果给 ui.html（由它经 WebSocket 回桥接）
async function execAndReply(id, command, params) {
  try {
    if (!(command in HANDLERS)) {
      postToUi({ type: 'exec_result', id, ok: false, error: { code: 'UNKNOWN_COMMAND', message: `未知命令: ${String(command)}` } });
      return;
    }
    const data = await HANDLERS[command](params);
    postToUi({ type: 'exec_result', id, ok: true, data });
  } catch (err) {
    const code = err && err.code ? err.code : 'PLUGIN_ERROR';
    const message = err && err.message ? err.message : String(err);
    postToUi({ type: 'exec_result', id, ok: false, error: { code, message } });
  }
}

// ---------------- 启动 ----------------

figma.showUI(__html__, { width: 280, height: 230 });

// 通知 UI 当前是否有已保存 token（供 UI 决定显示配对框还是直接连）
(async () => {
  let hasToken = false;
  try {
    const t = await figma.clientStorage.getAsync(AUTH_TOKEN_KEY);
    hasToken = typeof t === 'string' && t.length > 0;
  } catch (e) { /* ignore */ }
  postToUi({ type: 'init', hasToken, bridgeUrl: BRIDGE_URL });
})();

figma.ui.onmessage = async (msg) => {
  if (!msg || typeof msg !== 'object') return;

  // UI 转发的桥接命令：执行并回结果
  if (msg.type === 'exec') {
    const id = msg.id === undefined || msg.id === null ? null : msg.id;
    if (id === null) return;
    const params = (msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params)) ? msg.params : {};
    execAndReply(id, msg.command, params);
    return;
  }

  // UI 要求保存配对拿到的 token
  if (msg.type === 'saveToken') {
    const token = typeof msg.token === 'string' ? msg.token : '';
    try { await figma.clientStorage.setAsync(AUTH_TOKEN_KEY, token); }
    catch (e) { postToUi({ type: 'saved', ok: false }); return; }
    postToUi({ type: 'saved', ok: true });
    return;
  }

  // UI 要求读取已保存 token（用于 auto-connect 鉴权）
  if (msg.type === 'getToken') {
    let token = '';
    try {
      const t = await figma.clientStorage.getAsync(AUTH_TOKEN_KEY);
      if (typeof t === 'string') token = t;
    } catch (e) { /* ignore */ }
    postToUi({ type: 'token', token });
    return;
  }

  // UI 要求清除配对（重新配对）
  if (msg.type === 'clearToken') {
    try { await figma.clientStorage.deleteAsync(AUTH_TOKEN_KEY); } catch (e) { /* ignore */ }
    postToUi({ type: 'tokenCleared' });
    return;
  }
};
