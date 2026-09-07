// figma-canvas-writer/bridge/mcp-bridge.js
// Figma Canvas Writer 桥接服务（Node 侧，供任意 MCP agent 调用）：
//   1) 以 MCP stdio server 姿态供任意 MCP agent 调用（stdout 是 MCP 通道，所有日志一律写 stderr）；
//   2) 同时起一个 WebSocket server（127.0.0.1:9753/plugin），Figma 插件作为客户端接入；
//   3) 每个 MCP 工具调用 -> 白名单校验（防御纵深）-> 转成 WS 命令发给插件 -> 等插件响应（15s 超时）-> 回 MCP。
// 运行：node mcp-bridge.js   （agent 通过 stdio 拉起）

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { randomBytes, timingSafeEqual } from 'node:crypto';

import { WebSocketServer, WebSocket } from 'ws';

// ---------------- 常量 ----------------

const HOST = '::';       // 绑双栈(IPv4+IPv6), 让 localhost 无论解析到 127.0.0.1 还是 ::1 都能连; 安全性由 connection 处的回环白名单校验保证
const PORT = Number(process.env.FIGMA_BRIDGE_PORT || 9753);  // 可用环境变量覆盖(多 agent 隔离)
const WS_PATH = '/plugin';      // 插件连接路径
const PROTOCOL = 1;             // 与插件约定的鉴权协议版本
const CMD_TIMEOUT_MS = Number(process.env.FIGMA_BRIDGE_TIMEOUT_MS || 15000);   // 等待插件响应的超时
const RATE_BURST = 20;          // 令牌桶容量（20 cmd/s）
const RATE_REFILL_PER_SEC = 20; // 令牌补充速率
const MAX_MSG_BYTES = 256 * 1024; // 单条消息上限 256KB

// 配置目录：优先环境变量 FIGMA_BRIDGE_HOME，否则用中性名 .figma-canvas-writer
// 向后兼容：若旧目录 ~/.dsh-figma-bridge 存在则复用（避免已有用户 token 丢失）
const LEGACY_DIR = path.join(os.homedir(), '.dsh-figma-bridge');
const DEFAULT_DIR = path.join(os.homedir(), '.figma-canvas-writer');
const CONFIG_DIR = process.env.FIGMA_BRIDGE_HOME
  || (fs.existsSync(LEGACY_DIR) ? LEGACY_DIR : DEFAULT_DIR);
const TOKEN_FILE = path.join(CONFIG_DIR, 'bridge-token');
const AUDIT_FILE = path.join(CONFIG_DIR, 'audit.log');

const COMMAND_WHITELIST = new Set([
  'ping', 'getSelection', 'getNodeInfo', 'createNode', 'modifyNode', 'deleteNode', 'setText',
]);
const CREATE_TYPES = ['RECTANGLE', 'ELLIPSE', 'TEXT', 'FRAME', 'LINE', 'STAR'];
const MODIFY_PROPS = new Set([
  'name', 'x', 'y', 'width', 'height', 'rotation',
  'opacity', 'visible', 'fills', 'strokes', 'strokeWeight', 'cornerRadius',
]);
const PAINT_TYPES = new Set([
  'SOLID', 'GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR',
  'GRADIENT_DIAMOND', 'IMAGE', 'VIDEO', 'EMOJI',
]);

// ---------------- 基础工具 ----------------

function log(...args) { console.error('[figma-canvas-writer]', ...args); }

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype;
}
function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

class BridgeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function err(code, message) { return new BridgeError(code, message); }

function isFiniteNum(v, min, max) {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}
function requireStr(v, name, opts = {}) {
  if (typeof v !== 'string' || (!opts.allowEmpty && v.length === 0)) {
    throw err('INVALID_PARAM', `${name} 必须是非空字符串`);
  }
  return v;
}
function optStr(v, name) {
  if (v === undefined || v === null) return undefined;
  return requireStr(v, name, { allowEmpty: true });
}
function requireNum(v, name, min, max) {
  if (!isFiniteNum(v, min, max)) {
    throw err('INVALID_PARAM', `${name} 必须是 [${min}, ${max}] 内的有限数字`);
  }
  return v;
}
function optNum(v, name, min, max) {
  if (v === undefined || v === null) return undefined;
  return requireNum(v, name, min, max);
}
function requireBool(v, name) {
  if (typeof v !== 'boolean') throw err('INVALID_PARAM', `${name} 必须是布尔值`);
  return v;
}

// ---------------- 令牌 / token 管理 ----------------

// 首次运行生成 256bit 随机 token（32 字节 hex），权限收紧到 0600
function loadOrCreateToken({ rotate = false } = {}) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  if (!rotate) {
    try {
      const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
      if (t) {
        try { fs.chmodSync(TOKEN_FILE, 0o600); } catch (e) { /* 权限纠正失败不致命 */ } // 修复: 已有 token 也强制纠正权限
        return t;
      }
    } catch (e) { /* 不存在则生成 */ }
  }
  // 生成新 token（首启 or --rotate-token 强制轮换）
  const token = randomBytes(32).toString('hex');
  fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  fs.chmodSync(TOKEN_FILE, 0o600); // 原因：token 属于机密，防他人读
  return token;
}

// 常数时间比较，防时序侧信道
function safeTokenEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ---------------- 配对码（一次性、短命，替代"复制 64 位 token 到剪贴板"） ----------------

const PAIR_CODE_TTL_MS = 10 * 60 * 1000; // 10 分钟
let pairCode = null;       // 当前有效配对码（仅存内存，不落盘、不进日志）
let pairCodeExpiry = 0;    // 过期时间戳
let pairCodeTimer = null;  // 过期定时器
let pairedOnce = false;    // 是否已成功配对过（首次成功后不再自动生成配对码）

// 生成 6 位 CSPRNG 配对码，打印到 stderr（不进文件/日志/stdout）
function generatePairCode() {
  // 用 CSPRNG 取 6 位十进制数字（避免 %10 的取模偏差）
  const buf = randomBytes(8);
  const num = Number(buf.readBigUInt64BE(0) % 1000000n);
  pairCode = String(num).padStart(6, '0');
  pairCodeExpiry = Date.now() + PAIR_CODE_TTL_MS;
  if (pairCodeTimer) clearTimeout(pairCodeTimer);
  pairCodeTimer = setTimeout(() => { pairCode = null; }, PAIR_CODE_TTL_MS);
  pairCodeTimer.unref();
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('首次配对：请在 Figma 插件面板输入以下 6 位配对码（10 分钟内有效，仅一次）');
  log('  配对码: ' + pairCode);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  return pairCode;
}

function consumePairCode(code) {
  if (!pairCode) return false;
  if (Date.now() > pairCodeExpiry) { pairCode = null; return false; }
  if (typeof code !== 'string' || !safeTokenEqual(code, pairCode)) return false;
  pairCode = null; // 单次有效，立即作废
  if (pairCodeTimer) { clearTimeout(pairCodeTimer); pairCodeTimer = null; }
  return true;
}

// ---------------- 审计日志（JSON Lines） ----------------

function audit({ tool, args, ok, code, ms }) {
  try {
    let argText = '';
    try { argText = JSON.stringify(args || {}); } catch (e) { argText = '<unserializable>'; }
    if (argText.length > 2000) argText = argText.slice(0, 2000) + '…'; // 防审计文件被撑爆
    try { fs.chmodSync(AUDIT_FILE, 0o600); } catch (e) { /* 首次创建前不存在, 忽略 */ } // V7: 审计文件也 0600
    fs.appendFileSync(AUDIT_FILE, JSON.stringify({
      ts: new Date().toISOString(), tool, args: argText, ok, code: code || null, ms,
    }) + '\n', 'utf8');
    try { fs.chmodSync(AUDIT_FILE, 0o600); } catch (e) { /* ignore */ } // 写后再次确保 0600
  } catch (e) { log('写审计日志失败', e && e.message); }
}

// ---------------- 限流：令牌桶（20 cmd/s） ----------------

let tokens = RATE_BURST;
let lastRefill = Date.now();
function takeToken() {
  const now = Date.now();
  tokens = Math.min(RATE_BURST, tokens + ((now - lastRefill) / 1000) * RATE_REFILL_PER_SEC);
  lastRefill = now;
  if (tokens < 1) throw err('RATE_LIMITED', '请求过频，超过 20 cmd/s');
  tokens -= 1;
}

// ---------------- WebSocket server 与鉴权 ----------------

// 支持 --rotate-token CLI：轮换 token（旧 token 失效），用于"token 疑似泄露"时主动作废
const rotateRequested = process.argv.includes('--rotate-token');
const bridgeToken = loadOrCreateToken({ rotate: rotateRequested });
if (rotateRequested) log('已轮换 token（旧 token 失效），请重新配对插件');

let pluginSock = null;   // 当前已授权插件连接（同一时刻只维护一个）
let cmdSeq = 0;
const pending = new Map(); // id -> {resolve, reject, timer, tool, started}

const httpServer = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('figma-canvas-writer ws server');
});

const wss = new WebSocketServer({ server: httpServer, path: WS_PATH, maxPayload: MAX_MSG_BYTES, perMessageDeflate: false });

function safeSend(sock, obj) {
  if (sock && sock.readyState === WebSocket.OPEN) {
    try { sock.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
  }
  return false;
}

function handlePair(client, msg) {
  // 配对码换取 token：6 位一次性配对码 → 常数时间比较 → 通过后经 127.0.0.1 WS 帧签发真 token
  if (!consumePairCode(msg.code)) {
    safeSend(client, { type: 'pair_ack', ok: false, error: { code: 'PAIR_FAILED', message: '配对码无效、已过期或已使用。请重启桥接生成新配对码。' } });
    return;
  }
  pairedOnce = true;
  safeSend(client, { type: 'pair_ack', ok: true, token: bridgeToken, protocol: PROTOCOL });
  log('配对成功：已向插件签发 token');
}

function handleAuth(client, msg) {
  // 原因：token 鉴权是插件身份的唯一凭据，只认白名单协议版本 + 常数时间比较
  if (msg.protocol !== PROTOCOL) {
    safeSend(client, { type: 'auth_ack', ok: false, error: { code: 'AUTH_FAILED', message: `协议版本不匹配（期望 ${PROTOCOL}）` } });
    return;
  }
  if (typeof msg.token !== 'string' || !safeTokenEqual(msg.token, bridgeToken)) {
    safeSend(client, { type: 'auth_ack', ok: false, error: { code: 'AUTH_FAILED', message: 'token 无效，请将插件面板 token 与本机 ~/.figma-canvas-writer/bridge-token（或环境变量 FIGMA_BRIDGE_HOME 指定） 保持一致' } });
    return;
  }
  // 同一时刻只保留一个授权插件：新连接鉴权通过后踢掉旧的
  if (pluginSock && pluginSock !== client && pluginSock.readyState === WebSocket.OPEN) {
    try { pluginSock.close(); } catch (e) { /* ignore */ }
  }
  client.authed = true;
  client.lastSeen = Date.now();
  if (client.authTimeout) { clearTimeout(client.authTimeout); client.authTimeout = null; } // 修复: 鉴权成功后清掉 auth 超时定时器, 防止误关
  pluginSock = client;
  safeSend(client, { type: 'auth_ack', ok: true, protocol: PROTOCOL });
  log(`插件已鉴权通过 (${client.remoteAddress})`);
}

function handleResp(client, msg) {
  if (client !== pluginSock) return; // L1: 响应必须来自当前授权插件, 防止伪造
  const rec = msg.id !== undefined ? pending.get(msg.id) : undefined;
  if (!rec) return; // 非本进程发起的请求 / 已超时
  pending.delete(msg.id);
  clearTimeout(rec.timer);
  // 原因：审计统一在 CallTool 入口做一次（含工具名/耗时），这里不再重复记
  if (msg.ok === true) {
    rec.resolve(msg.data);
  } else {
    const e = (msg.error && typeof msg.error === 'object')
      ? err(String(msg.error.code || 'PLUGIN_ERROR'), String(msg.error.message || '插件执行失败'))
      : err('PLUGIN_ERROR', '插件返回未知错误');
    rec.reject(e);
  }
}

function startWsServer() {
  wss.on('connection', (client, req) => {
    // 回环白名单校验（绑定双栈 :: 后必须校验，只放行本机回环，拒绝局域网/远程）
    client.remoteAddress = req.socket ? req.socket.remoteAddress : 'unknown';
    const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
    if (!LOOPBACK.has(client.remoteAddress)) {
      log(`拒绝非回环连接: ${client.remoteAddress}`);
      try { client.close(4000, 'localhost only'); } catch (e) { /* ignore */ }
      return;
    }
    client.authed = false;
    client.lastSeen = null;
    client.isAlive = true; // 心跳存活标记: 每轮 ping 前置 false, 收到 pong 置回 true
    client.on('pong', () => { client.isAlive = true; client.lastSeen = Date.now(); }); // 修复: 真正监听 pong, 假死才能被检测
    // 修复: 未鉴权连接 10 秒内不发 auth 帧则关闭, 防止 TCP 挂起耗尽资源
    client.authTimeout = setTimeout(() => {
      if (!client.authed) { try { client.close(4002, 'auth timeout'); } catch (e) { /* ignore */ } }
    }, 10000);

    client.on('message', (buf) => {
      if (buf && Buffer.byteLength(buf) > MAX_MSG_BYTES) {
        log('收到超限消息（忽略）');
        return;
      }
      let msg;
      try { msg = JSON.parse(buf.toString('utf8')); } catch (e) { return; }
      if (!isPlainObject(msg)) return;
      if (msg.type === 'auth') handleAuth(client, msg);
      else if (msg.type === 'pair') handlePair(client, msg);
      else if (msg.type === 'resp') handleResp(client, msg);
      // 其它消息类型一律忽略（原因：仅接受白名单协议消息）
    });
    client.on('error', () => { /* ignore */ });
    client.on('close', () => {
      if (client.authTimeout) { clearTimeout(client.authTimeout); client.authTimeout = null; } // N2: 连接断开即清 auth 超时
      if (pluginSock !== client) return; // N1: 只清理"当前授权插件"的断连, 不误伤新连接/其他连接的在途命令
      pluginSock = null;
      // 修复: 插件断连时立即失败所有在途命令, 不让 MCP 调用方白等超时
      for (const [id, rec] of pending) {
        clearTimeout(rec.timer);
        pending.delete(id);
        rec.reject(err('PLUGIN_DISCONNECTED', '插件连接已断开'));
      }
    });
  });

  // 心跳保活：每 30s ping 前先置 isAlive=false, 收不到 pong 则判定假死并 terminate
  const heartbeat = setInterval(() => {
    const s = pluginSock;
    if (!s || s.readyState !== WebSocket.OPEN || !s.authed) return;
    if (s.isAlive === false) { try { s.terminate(); } catch (e) { /* ignore */ } return; } // 上一周期未 pong, 假死
    s.isAlive = false;
    try { s.ping(); } catch (e) { try { s.terminate(); } catch (e2) { /* ignore */ } }
  }, 30000);
  heartbeat.unref();

  httpServer.listen(PORT, HOST, () => {
    log(`WebSocket server 已监听 ${HOST}:${PORT}${WS_PATH}（token 文件: ${TOKEN_FILE}）`);
  });
  httpServer.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      log(`错误: 端口 ${PORT} 已被占用。请先关闭其他 figma-canvas-writer 桥接实例（可能是多个 agent 同时 spawn 导致），或设置不同 FIGMA_BRIDGE_PORT。`);
      process.exit(1);
    } else {
      log(`WebSocket server 启动失败: ${e.message}`);
      process.exit(1);
    }
  });
}

// ---------------- 转发：MCP 工具 -> WS 命令 -> 等插件响应 ----------------

function sendCommand(command, params, argsForAudit) {
  if (!pluginSock || pluginSock.readyState !== WebSocket.OPEN || !pluginSock.authed) {
    return Promise.reject(err('NO_PLUGIN', 'Figma 插件未连接或未授权（请先在 Figma 里运行并授权插件）'));
  }
  takeToken(); // 可能抛 RATE_LIMITED
  const id = ++cmdSeq;
  const payload = JSON.stringify({ type: 'cmd', id, command, params });
  if (Buffer.byteLength(payload, 'utf8') > MAX_MSG_BYTES) {
    return Promise.reject(err('MSG_TOO_LARGE', '命令消息超过 256KB 上限'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(err('TIMEOUT', `插件 ${CMD_TIMEOUT_MS}ms 内未响应 (${command})`));
    }, CMD_TIMEOUT_MS);
    pending.set(id, {
      resolve, reject, timer,
      tool: command, args: argsForAudit || {}, started: Date.now(),
    });
    pluginSock.send(payload, (e) => {
      if (e) {
        clearTimeout(timer);
        pending.delete(id);
        reject(err('SEND_FAILED', e.message));
      }
    });
  });
}

// ---------------- 输入校验（桥接侧白名单，防御纵深，与插件侧一致） ----------------

function validatePaints(v, name) {
  if (!Array.isArray(v)) throw err('INVALID_PARAM', `${name} 必须是数组`);
  if (v.length > 32) throw err('INVALID_PARAM', `${name} 数量超过 32`);
  const out = [];
  for (const paint of v) {
    if (!isPlainObject(paint)) throw err('INVALID_PARAM', `${name} 元素必须是普通对象`);
    if (typeof paint.type !== 'string' || !PAINT_TYPES.has(paint.type)) {
      throw err('INVALID_PARAM', `${name} 元素 type 非法`);
    }
    if (paint.type === 'SOLID') {
      // 支持 {r,g,b} 对象(0..1) 或 "#RRGGBB"/"#RGB" hex 字符串(自动转对象, 与插件侧 validatePaints 一致)
      let c = paint.color;
      if (typeof c === 'string') c = hexToRgb01(c);
      if (!isPlainObject(c)) throw err('INVALID_PARAM', 'SOLID 填充需要 color');
      for (const ch of ['r', 'g', 'b']) {
        if (!isFiniteNum(c[ch], 0, 1)) throw err('INVALID_PARAM', `color.${ch} 需在 [0,1]`);
      }
      if (c.a !== undefined && !isFiniteNum(c.a, 0, 1)) {
        throw err('INVALID_PARAM', 'color.a 需在 [0,1]');
      }
      out.push({ type: 'SOLID', color: { r: c.r, g: c.g, b: c.b, a: c.a === undefined ? 1 : c.a } });
    } else {
      out.push(JSON.parse(JSON.stringify(paint)));
    }
  }
  return out;
}

// hex 颜色字符串转 {r,g,b}(0..1 浮点); 与插件侧 hexToRgb01 保持一致
function hexToRgb01(hex) {
  if (typeof hex !== 'string') throw err('INVALID_PARAM', 'color 必须是字符串或 {r,g,b} 对象');
  const m = hex.trim().match(/^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/);
  if (!m) throw err('INVALID_PARAM', `非法 hex 颜色: ${hex}（需 #RRGGBB 或 #RGB）`);
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

function validateModifyProps(props) {
  if (!isPlainObject(props)) throw err('INVALID_PARAM', 'props 必须是普通对象');
  const out = {};
  for (const key of Object.keys(props)) {
    if (!MODIFY_PROPS.has(key)) throw err('INVALID_PARAM', `属性不在白名单内: ${key}`);
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

// 按工具把入参规整成插件能直接消费的 {command, params}，并做范围/类型校验
function buildCommand(toolName, a) {
  switch (toolName) {
    case 'figma_get_selection':
      return { command: 'getSelection', params: {} };

    case 'figma_get_node': {
      const params = { id: requireStr(a.nodeId, 'nodeId') };
      const depth = optNum(a.depth, 'depth', 0, 6);
      if (depth !== undefined) params.depth = depth;
      return { command: 'getNodeInfo', params };
    }

    case 'figma_create_node': {
      const type = requireStr(a.type, 'type');
      if (!CREATE_TYPES.includes(type)) {
        throw err('INVALID_PARAM', `不支持创建的类型: ${type}（允许: ${CREATE_TYPES.join('/')}）`);
      }
      const params = { type };
      const parentId = optStr(a.parentId, 'parentId');
      if (parentId !== undefined) params.parentId = parentId;
      const name = optStr(a.name, 'name');
      if (name !== undefined) params.name = name;
      const x = optNum(a.x, 'x', -1e6, 1e6);
      if (x !== undefined) params.x = x;
      const y = optNum(a.y, 'y', -1e6, 1e6);
      if (y !== undefined) params.y = y;
      const w = optNum(a.width, 'width', 0, 1e5);
      if (w !== undefined) params.width = w;
      const h = optNum(a.height, 'height', 0, 1e5);
      if (h !== undefined) params.height = h;
      if (type === 'TEXT') {
        params.text = a.text === undefined ? '' : requireStr(a.text, 'text', { allowEmpty: true });
      }
      return { command: 'createNode', params };
    }

    case 'figma_modify_node':
      return {
        command: 'modifyNode',
        params: { id: requireStr(a.nodeId, 'nodeId'), props: validateModifyProps(a.props) },
      };

    case 'figma_delete_node':
      return { command: 'deleteNode', params: { id: requireStr(a.nodeId, 'nodeId') } };

    case 'figma_set_text': {
      const params = { id: requireStr(a.nodeId, 'nodeId') };
      params.text = a.text === undefined ? '' : requireStr(a.text, 'text', { allowEmpty: true });
      if (a.fontName !== undefined && a.fontName !== null) {
        if (!isPlainObject(a.fontName) ||
            typeof a.fontName.family !== 'string' || typeof a.fontName.style !== 'string') {
          throw err('INVALID_PARAM', 'fontName 必须是 {family, style} 字符串对象');
        }
        params.fontName = { family: a.fontName.family, style: a.fontName.style };
      }
      const fontSize = optNum(a.fontSize, 'fontSize', 1, 1000);
      if (fontSize !== undefined) params.fontSize = fontSize;
      const x = optNum(a.x, 'x', -1e6, 1e6);
      if (x !== undefined) params.x = x;
      const y = optNum(a.y, 'y', -1e6, 1e6);
      if (y !== undefined) params.y = y;
      return { command: 'setText', params };
    }

    default:
      throw err('UNKNOWN_TOOL', `未知工具: ${toolName}`);
  }
}

// ---------------- MCP 工具定义 ----------------

const TOOL_SCHEMAS = {
  figma_canvas_status: {
    name: 'figma_canvas_status',
    description: '查询 Figma Canvas Writer 桥接与 Figma 插件的连接状态（插件是否连上、是否鉴权通过、上次心跳时间）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  figma_create_node: {
    name: 'figma_create_node',
    description: '在 Figma 当前页（或指定 FRAME 父节点内）创建一个节点。type 支持 RECTANGLE/ELLIPSE/TEXT/FRAME/LINE；TEXT 需带 text；可传 name/x/y/width/height。',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['RECTANGLE', 'ELLIPSE', 'TEXT', 'FRAME', 'LINE'], description: '要创建的节点类型' },
        parentId: { type: 'string', description: '目标 FRAME 父节点 id（缺省=当前页）' },
        name: { type: 'string', description: '节点名称' },
        x: { type: 'number', description: 'X（FRAME 内为相对坐标）' },
        y: { type: 'number', description: 'Y（FRAME 内为相对坐标）' },
        width: { type: 'number', description: '宽度' },
        height: { type: 'number', description: '高度' },
        text: { type: 'string', description: 'TEXT 类型必填：文本内容' },
      },
      required: ['type'],
      additionalProperties: false,
    },
  },
  figma_modify_node: {
    name: 'figma_modify_node',
    description: '修改已有节点属性。仅允许白名单属性：name/x/y/width/height/rotation(度)/opacity/visible/fills/strokes/strokeWeight/cornerRadius。',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: '目标节点 id' },
        props: {
          type: 'object',
          description: '要修改的属性集合（仅白名单）',
          additionalProperties: true,
        },
      },
      required: ['nodeId', 'props'],
      additionalProperties: false,
    },
  },
  figma_delete_node: {
    name: 'figma_delete_node',
    description: '删除画布上的一个节点。',
    inputSchema: {
      type: 'object',
      properties: { nodeId: { type: 'string', description: '要删除的节点 id' } },
      required: ['nodeId'],
      additionalProperties: false,
    },
  },
  figma_set_text: {
    name: 'figma_set_text',
    description: '改写一个 TEXT 节点的文本（自动加载字体）；可选改字体/字号/位置。',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'TEXT 节点 id' },
        text: { type: 'string', description: '新文本内容' },
        fontName: { type: 'object', properties: { family: { type: 'string' }, style: { type: 'string' } }, description: '目标字体（缺省=沿用当前字体）' },
        fontSize: { type: 'number', description: '字号（1-1000）' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['nodeId'],
      additionalProperties: false,
    },
  },
  figma_get_node: {
    name: 'figma_get_node',
    description: '读取节点信息（位置/尺寸/旋转/可见性/文本等），返回 JSON。',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: '目标节点 id' },
        depth: { type: 'number', description: '递归子节点深度（0-6，缺省 3）' },
      },
      required: ['nodeId'],
      additionalProperties: false,
    },
  },
  figma_get_selection: {
    name: 'figma_get_selection',
    description: '读取 Figma 当前选中的节点列表信息。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
};

function statusInfo() {
  const sock = pluginSock;
  const connected = !!sock && sock.readyState === WebSocket.OPEN;
  return {
    connected,
    authorized: connected && !!sock.authed,
    lastSeen: (connected && sock.lastSeen) ? new Date(sock.lastSeen).toISOString() : null,
    bridge: { host: HOST, port: PORT, path: WS_PATH, protocol: PROTOCOL },
    // 不返回 tokenFile 绝对路径（V9: 避免泄露含用户名的路径）
  };
}

// ---------------- MCP stdio（手写 JSON-RPC 2.0 over stdio，无 SDK 依赖） ----------------

const MCP_PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'figma-canvas-writer', version: '1.0.0' };

// tools/list 与 tools/call 的处理器（复用原有业务逻辑，仅换 JSON-RPC 外壳）
async function handleListTools() {
  return { tools: Object.values(TOOL_SCHEMAS) };
}

async function handleCallTool(toolName, rawArgs) {
  const started = Date.now();
  const isStatus = toolName === 'figma_canvas_status';

  try {
    if (isStatus) {
      try { takeToken(); } catch (e) { throw e; }
      const info = statusInfo();
      if (info.authorized) {
        try {
          const pingData = await sendCommand('ping', {}, {});
          info.ping = pingData;
        } catch (e) {
          info.ping = null;
          info.pingError = (e && e.message) || 'ping 失败';
        }
      }
      audit({ tool: toolName, args: {}, ok: true, code: null, ms: Date.now() - started });
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, data: info }) }], isError: false };
    }

    if (!Object.prototype.hasOwnProperty.call(TOOL_SCHEMAS, toolName)) {
      throw err('UNKNOWN_TOOL', `未知工具: ${toolName}`);
    }
    const { command, params } = buildCommand(toolName, rawArgs);
    if (!COMMAND_WHITELIST.has(command)) {
      throw err('INVALID_PARAM', `命令不在白名单: ${command}`);
    }
    const data = await sendCommand(command, params, rawArgs);
    audit({ tool: toolName, args: rawArgs, ok: true, code: null, ms: Date.now() - started });
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }], isError: false };
  } catch (e) {
    const code = (e && e.code) ? e.code : 'BRIDGE_ERROR';
    const message = (e && e.message) ? e.message : String(e);
    audit({ tool: toolName, args: rawArgs, ok: false, code, ms: Date.now() - started });
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: false, error: { code, message } }) }],
      isError: true,
    };
  }
}

// 手写 JSON-RPC 2.0 over stdio：逐行读 stdin，stdout 逐行回响应
function startStdioServer() {
  const rl = createInterface({ input: process.stdin, terminal: false });

  rl.on('line', (line) => {
    if (!line || !line.trim()) return; // 忽略空行
    let msg;
    try { msg = JSON.parse(line); } catch (e) { return; } // 非法 JSON 忽略，不崩溃
    if (!msg || typeof msg !== 'object') return;
    // 通知类（无 id）不响应
    if (msg.method === 'notifications/initialized' || msg.method === 'notifications/cancelled') return;
    if (msg.id === undefined || msg.id === null) return;

    dispatch(msg).then((result) => {
      writeStdout({ jsonrpc: '2.0', id: msg.id, result });
    }).catch((e) => {
      writeStdout({
        jsonrpc: '2.0', id: msg.id,
        error: { code: -32603, message: (e && e.message) ? e.message : String(e) },
      });
    });
  });

  rl.on('close', () => {
    // stdio(MCP 通道)关闭 = agent 不再调用工具, 但 WS server 必须继续常驻供插件连接
    // 不退出进程, 只记录(插件可独立于 stdio 连接)
    log('stdio(MCP 通道)已关闭，WS server 继续运行供插件连接');
  });
}

async function dispatch(msg) {
  const method = msg.method;
  const params = (msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params)) ? msg.params : {};
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      };
    case 'ping':
      return {};
    case 'tools/list':
      return handleListTools();
    case 'tools/call': {
      const toolName = typeof params.name === 'string' ? params.name : '';
      const rawArgs = isPlainObject(params.arguments) ? params.arguments : {};
      return handleCallTool(toolName, rawArgs);
    }
    default:
      throw err('METHOD_NOT_FOUND', `未知方法: ${method}`);
  }
}

function writeStdout(obj) {
  try {
    process.stdout.write(JSON.stringify(obj) + '\n');
  } catch (e) {
    log('写 stdout 失败（可能 stdout 已关闭）', e && e.message);
  }
}

// ---------------- 启动 ----------------

async function main() {
  startWsServer();
  startStdioServer();
  // 首次运行（从未成功配对）时生成 6 位配对码，打印到 stderr 供用户配对
  if (!pairedOnce) generatePairCode();
  log('MCP stdio server 已就绪（供 MCP agent 调用）');
  log('审计日志: ' + AUDIT_FILE);
}

function shutdown() {
  try { wss.close(); } catch (e) { /* ignore */ }
  try { httpServer.close(); } catch (e) { /* ignore */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((e) => {
  log('启动失败:', e && e.stack ? e.stack : e);
  process.exit(1);
});
