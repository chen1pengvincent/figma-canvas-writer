// figma-canvas-writer/plugin/code.js
// Figma Canvas Writer —— Figma 插件主线程（普通插件，在 Figma 设计文件内运行，有画布写权限）。
// 作为 WebSocket 客户端连接本机 Figma Canvas Writer 桥接服务（Figma 沙箱不能监听端口，只能主动外连），
// 接收 {type:"cmd", id, command, params} 命令并执行画布操作，返回 {type:"resp", ...}。

const BRIDGE_URL = 'ws://127.0.0.1:9753/plugin'; // 仅本机回环桥接地址
const PROTOCOL = 1;                              // 与桥接侧约定的握手协议版本
const AUTH_TOKEN_KEY = 'bridgeToken';            // token 存 Figma clientStorage
const RECONNECT_MIN_MS = 1000;                   // 断线重连指数退避下限 1s
const RECONNECT_MAX_MS = 15000;                  // 指数退避上限 15s

// ---- 白名单（安全边界）----
// 原因：所有命令与属性一律在白名单内分发/修改，未收录的键直接拒绝，
// 防止通过命令名或属性名注入、访问画布之外的 API。
const CREATE_TYPES = ['RECTANGLE', 'ELLIPSE', 'TEXT', 'FRAME', 'LINE'];
const MODIFY_PROPS = new Set([
  'name', 'x', 'y', 'width', 'height', 'rotation',
  'opacity', 'visible', 'fills', 'strokes', 'strokeWeight', 'cornerRadius',
]);
const PAINT_TYPES = new Set([
  'SOLID', 'GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR',
  'GRADIENT_DIAMOND', 'IMAGE', 'VIDEO', 'EMOJI',
]);

let socket = null;            // 当前 WebSocket 连接
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
  const first = figma.getNodeById(String(nodeId));
  if (!first) throw appErr('NODE_NOT_FOUND', `找不到节点: ${nodeId}`);
  if (first.type === 'DOCUMENT' || first.type === 'PAGE') {
    throw appErr('INVALID_TARGET', '不能对文档/页面节点执行该操作');
  }
  const page = pageOfNode(first);
  return withPageContext(page, async () => {
    const node = figma.getNodeById(String(nodeId));
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
      if (!isPlainObject(paint.color)) throw appErr('INVALID_PARAM', 'SOLID 填充需要 color');
      const c = paint.color;
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
    parentPre = figma.getNodeById(parentId);
    if (!parentPre) throw appErr('NODE_NOT_FOUND', `找不到父节点: ${parentId}`);
    if (parentPre.type !== 'FRAME') throw appErr('INVALID_PARAM', 'parentId 必须是 FRAME 节点');
  }
  const targetPage = parentPre ? pageOfNode(parentPre) : figma.currentPage;
  if (!targetPage) throw appErr('INVALID_PARAM', '无法确定创建目标页面');

  return withPageContext(targetPage, async () => {
    // 原因：切页后需重新按 id 取父节点引用
    const parent = parentId ? figma.getNodeById(parentId) : null;
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

async function handleIncoming(raw) {
  let msg;
  try { msg = JSON.parse(String(raw)); }
  catch (e) { log('收到非 JSON 消息，忽略'); return; }
  if (!isPlainObject(msg)) return;
  if (msg.type === 'auth_ack') { handleAuthAck(msg); return; }
  if (msg.type === 'pair_ack') { handlePairAck(msg); return; }
  if (msg.type !== 'cmd') return; // 忽略其它消息类型

  const id = msg.id === undefined || msg.id === null ? null : msg.id;
  if (id === null) return;
  const command = msg.command;
  const params = isPlainObject(msg.params) ? msg.params : {};
  if (typeof command !== 'string' || !(command in HANDLERS)) {
    sendResponse(id, false, { code: 'UNKNOWN_COMMAND', message: `未知命令: ${String(command)}` });
    return;
  }
  try {
    const data = await HANDLERS[command](params);
    sendResponse(id, true, data);
  } catch (err) {
    log('命令执行失败', command, err && err.message);
    const code = err && err.code ? err.code : 'PLUGIN_ERROR';
    const message = err && err.message ? err.message : String(err);
    sendResponse(id, false, { code, message });
  }
}

// 统一响应格式：成功 {ok:true,data} / 失败 {ok:false,error:{code,message}}
function sendResponse(id, ok, dataOrError) {
  if (!wsOpen()) return;
  const payload = ok
    ? { type: 'resp', id, ok: true, data: dataOrError }
    : { type: 'resp', id, ok: false, error: dataOrError };
  try { socket.send(JSON.stringify(payload)); } catch (e) { log('发送响应失败', e && e.message); }
}

function sendToBridge(obj) {
  if (!wsOpen()) return false;
  try { socket.send(JSON.stringify(obj)); return true; }
  catch (e) { log('发送失败', e && e.message); return false; }
}
function wsOpen() { return !!socket && socket.readyState === 1; } // WebSocket.OPEN === 1

// ---------------- 连接管理（指数退避自动重连） ----------------

function setStatus(state, detail = '') {
  connectionState = state;
  authDetail = detail;
  try { if (figma.ui) figma.ui.postMessage({ type: 'status', state, detail }); }
  catch (e) { /* UI 尚未就绪时忽略 */ }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  // 指数退避：1s 起加倍，封顶 15s（成功连接后在 onopen 里重置为 1s）
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

function connect() {
  if (typeof WebSocket === 'undefined') {
    setStatus('auth_failed', '当前 Figma 环境不支持 WebSocket');
    log('当前环境无 WebSocket，无法连接桥接');
    return;
  }
  if (socket && (socket.readyState === 0 || socket.readyState === 1)) return; // 已在连接/已连接
  setStatus('connecting', BRIDGE_URL);
  let wsConn;
  try { wsConn = new WebSocket(BRIDGE_URL); }
  catch (e) { log('创建 WebSocket 失败', e && e.message); scheduleReconnect(); return; }
  socket = wsConn;

  wsConn.onopen = async () => {
    reconnectDelay = RECONNECT_MIN_MS; // 连接成功即重置退避
    setStatus('connected', '已连接，正在鉴权…');
    await sendAuth();
  };
  wsConn.onmessage = (ev) => {
    handleIncoming(ev.data).catch((err) => log('处理消息异常', err && err.message));
  };
  wsConn.onerror = () => { /* 交给 onclose 统一处理 */ };
  wsConn.onclose = () => {
    if (socket === wsConn) socket = null;
    setStatus('disconnected', '连接断开，正在重连…');
    scheduleReconnect();
  };
}

async function sendAuth() {
  let token = '';
  try {
    const t = await figma.clientStorage.getAsync(AUTH_TOKEN_KEY);
    if (typeof t === 'string') token = t;
  } catch (e) { log('读取 clientStorage 失败', e && e.message); }
  sendToBridge({ type: 'auth', protocol: PROTOCOL, token });
}

function handleAuthAck(msg) {
  if (msg.ok === true) {
    setStatus('authorized', '已授权（桥接在线）');
  } else {
    const detail = (msg.error && msg.error.message) ? msg.error.message : '鉴权失败';
    setStatus('auth_failed', detail);
  }
}

async function handlePairAck(msg) {
  if (msg.ok === true && typeof msg.token === 'string' && msg.token.length > 0) {
    // 配对成功：真 token 由桥接经 127.0.0.1 WS 帧签发，写入 clientStorage（不进剪贴板）
    try { await figma.clientStorage.setAsync(AUTH_TOKEN_KEY, msg.token); }
    catch (e) { log('保存配对 token 失败', e && e.message); }
    setStatus('disconnected', '配对成功，正在用 token 重连…');
    forceReconnect();
  } else {
    const detail = (msg.error && msg.error.message) ? msg.error.message : '配对失败';
    setStatus('auth_failed', detail);
    try { figma.ui.postMessage({ type: 'pairResult', ok: false, detail }); } catch (e) { /* ignore */ }
  }
}

function forceReconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectDelay = RECONNECT_MIN_MS;
  const old = socket;
  socket = null;
  if (old) { try { old.onclose = null; old.close(); } catch (e) { /* ignore */ } }
  connect();
}

// ---------------- 启动 ----------------

figma.showUI(__html__, { width: 280, height: 200 });

figma.ui.onmessage = async (msg) => {
  if (!msg || !isPlainObject(msg)) return;
  if (msg.type === 'pair') {
    // 发送 6 位配对码给桥接，换取真 token（token 不经过 UI/剪贴板）
    const code = typeof msg.code === 'string' ? msg.code.trim() : '';
    if (!code) { setStatus('disconnected', '配对码为空'); return; }
    sendToBridge({ type: 'pair', code });
  } else if (msg.type === 'queryState') {
    try { figma.ui.postMessage({ type: 'status', state: connectionState, detail: authDetail }); }
    catch (e) { /* ignore */ }
    let hasToken = false;
    try {
      const t = await figma.clientStorage.getAsync(AUTH_TOKEN_KEY);
      hasToken = typeof t === 'string' && t.length > 0;
    } catch (e) { /* ignore */ }
    try { figma.ui.postMessage({ type: 'hasToken', hasToken }); } catch (e) { /* ignore */ }
  }
};

connect();
