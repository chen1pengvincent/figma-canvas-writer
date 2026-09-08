// MCP stdio owns this process and the single local Figma connection.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { AUTH_PROTOCOL, KEY_RE, sign, verify, authProof, frameProof, normalizeContext } from './auth.js';

const HOST = '127.0.0.1';
const IPV6_HOST = '::1';
const TEST_PORT = process.env.FIGMA_BRIDGE_TEST_PORT;
const PORT = TEST_PORT === undefined ? 9753 : Number(TEST_PORT);
const WS_PATH = '/plugin';
const MAX_MSG_BYTES = 256 * 1024;
const MAX_STDIO_BYTES = 1024 * 1024;
const MAX_PENDING = 100;
const SUPPORTED_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
const SERVER_INFO = { name: 'figma-canvas-writer', version: '2.0.0' };
const LEGACY_DIR = path.join(os.homedir(), '.dsh-figma-bridge');
const CONFIG_DIR = process.env.FIGMA_BRIDGE_HOME || (fs.existsSync(LEGACY_DIR) ? LEGACY_DIR : path.join(os.homedir(), '.figma-canvas-writer'));
const TOKEN_FILE = path.join(CONFIG_DIR, 'bridge-token');
const AUDIT_FILE = path.join(CONFIG_DIR, 'audit.log');
const WRITE_COMMANDS = new Set(['createNode', 'modifyNode', 'deleteNode', 'setText']);
const CMD_TIMEOUT_MS = process.env.FIGMA_BRIDGE_TIMEOUT_MS === undefined ? 15000 : Number(process.env.FIGMA_BRIDGE_TIMEOUT_MS);
const log = (...args) => console.error('[figma-canvas-writer]', ...args);
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const error = (code, message, extra = {}) => Object.assign(new Error(message), { code }, extra);

function strictKeys(value, keys, label) {
  if (!plain(value)) throw error('INVALID_PARAM', label + ' 必须是对象');
  for (const k of Object.keys(value)) if (!keys.includes(k)) throw error('INVALID_PARAM', label + ' 含未知字段: ' + k);
}

function loadKey(rotate = false) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(CONFIG_DIR, 0o700);
  let existing;
  try {
    const info = fs.lstatSync(TOKEN_FILE);
    if (!info.isFile() || info.isSymbolicLink()) throw error('INVALID_KEY_FILE', '密钥文件必须是普通文件');
    const fd = fs.openSync(TOKEN_FILE, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { existing = fs.readFileSync(fd, 'utf8').trim(); } finally { fs.closeSync(fd); }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!rotate && existing !== undefined) {
    if (!KEY_RE.test(existing)) throw error('INVALID_KEY_FILE', '现有 bridge-token 不是 256 位十六进制密钥；请停服后显式轮换');
    fs.chmodSync(TOKEN_FILE, 0o600);
    return existing.toLowerCase();
  }
  const key = randomBytes(32).toString('hex');
  const tmp = TOKEN_FILE + '.' + randomBytes(8).toString('hex') + '.tmp';
  try {
    fs.writeFileSync(tmp, key + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, TOKEN_FILE);
  } finally { try { fs.unlinkSync(tmp); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  return key;
}

function audit(tool, args, ok, code, ms) {
  // Do not persist Figma text, paint values, pairing keys or complete tool arguments.
  try {
    fs.appendFileSync(AUDIT_FILE, JSON.stringify({
      ts: new Date().toISOString(), tool, ok, code: code || null, ms,
      sessionId: args.sessionId || null, pageId: args.pageId || null, operationId: args.operationId || null,
    }) + '\n', { mode: 0o600 });
    fs.chmodSync(AUDIT_FILE, 0o600);
  } catch (e) { log('审计日志写入失败: ' + e.message); }
}

const str = (maxLength = 1024, minLength = 1) => ({ type: 'string', minLength, maxLength });
const number = (minimum, maximum) => ({ type: 'number', minimum, maximum });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const bool = { type: 'boolean' };
const rgb = object({ r: number(0, 1), g: number(0, 1), b: number(0, 1), a: number(0, 1) }, ['r', 'g', 'b']);
const matrix = { type: 'array', minItems: 2, maxItems: 2, items: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } } };
const paint = object({
  type: { type: 'string', enum: ['SOLID', 'GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND', 'IMAGE', 'VIDEO', 'EMOJI'] },
  color: { anyOf: [rgb, { type: 'string', pattern: '^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' }] },
  opacity: number(0, 1), visible: bool, blendMode: str(),
  boundVariables: object({ color: object({ type: { type: 'string', enum: ['VARIABLE_ALIAS'] }, id: str() }, ['type', 'id']) }),
  gradientTransform: matrix,
  gradientStops: { type: 'array', maxItems: 256, items: object({ position: number(0, 1), color: rgb }, ['position', 'color']) },
  scaleMode: { type: 'string', enum: ['FILL', 'FIT', 'CROP', 'TILE'] },
  imageHash: { anyOf: [str(), { type: 'null' }] }, imageTransform: matrix,
  scalingFactor: number(0, 1e6), rotation: number(-360, 360),
  filters: object(Object.fromEntries(['exposure', 'contrast', 'saturation', 'temperature', 'tint', 'highlights', 'shadows'].map(k => [k, number(-1, 1)]))),
  videoHash: str(), emoji: str(),
}, ['type']);
const paints = { type: 'array', maxItems: 32, items: paint };
const propsSchema = object({
  name: str(10000, 0), x: number(-1e6, 1e6), y: number(-1e6, 1e6),
  width: number(0.01, 1e5), height: number(0, 1e5), rotation: number(-360, 360),
  opacity: number(0, 1), visible: bool, fills: paints, strokes: paints,
  strokeWeight: number(0, 1e5), cornerRadius: number(0, 1e5),
});
const target = { sessionId: str(), pageId: str() };
const pagination = { cursor: { type: 'string', pattern: '^(0|[1-9][0-9]*)$', maxLength: 16 }, limit: integer(1, 100) };
const tools = {};
function define(name, description, command, properties = {}, required = [], write = false) {
  tools[name] = {
    name, description, command, write,
    inputSchema: object({ ...target, ...(write ? { operationId: str(128) } : {}), ...properties },
      ['sessionId', 'pageId', ...(write ? ['operationId'] : []), ...required]),
  };
}
tools.figma_canvas_status = {
  name: 'figma_canvas_status', description: '读取本机桥接状态及已授权插件的真实上下文；先取得 sessionId/pageId 再调用目标工具。',
  inputSchema: object({}),
};
define('figma_get_context', '分页读取当前页面顶层节点和上下文，默认每页 50 个。', 'getContext', pagination);
define('figma_get_selection', '分页读取当前选中节点和上下文，默认每页 50 个。', 'getSelection', pagination);
define('figma_get_node', '读取一个节点摘要及有限深度的子节点；depth 为 0–6 的整数。', 'getNodeInfo', { nodeId: str(), depth: integer(0, 6) }, ['nodeId']);
define('figma_get_operation', '查询同一插件运行会话内写操作的真实状态；超时后先查询，禁止换 operationId 重放未知写入。', 'getOperation', { operationId: str(128) }, ['operationId']);
define('figma_create_node', '在已确认页面创建节点；operationId 是本次写入的唯一标识，相同 ID 不重复执行。', 'createNode', {
  type: { type: 'string', enum: ['RECTANGLE', 'ELLIPSE', 'TEXT', 'FRAME', 'LINE', 'STAR'] },
  parentId: str(), name: str(10000, 0), x: number(-1e6, 1e6), y: number(-1e6, 1e6),
  width: number(0.01, 1e5), height: number(0, 1e5), text: str(200000, 0), props: propsSchema,
}, ['type'], true);
define('figma_modify_node', '修改节点白名单属性；须提供 sessionId/pageId/operationId。', 'modifyNode', { nodeId: str(), props: propsSchema }, ['nodeId', 'props'], true);
define('figma_delete_node', '删除目标节点；须提供 sessionId/pageId/operationId。', 'deleteNode', { nodeId: str() }, ['nodeId'], true);
define('figma_set_text', '修改文本节点；省略 text 保留原文，可单独改字体、字号或位置。', 'setText', {
  nodeId: str(), text: str(200000, 0), fontName: object({ family: str(), style: str() }, ['family', 'style']),
  fontSize: number(1, 1000), x: number(-1e6, 1e6), y: number(-1e6, 1e6),
}, ['nodeId'], true);
tools.figma_create_node.inputSchema.allOf = [
  { if: { properties: { type: { const: 'TEXT' } } }, then: { required: ['text'] } },
  { if: { properties: { type: { const: 'LINE' } } }, else: { properties: { height: { minimum: 0.01 } } } },
];

function validate(value, schema, label = 'arguments') {
  if (schema.anyOf) {
    for (const candidate of schema.anyOf) { try { validate(value, candidate, label); return; } catch {} }
    throw error('INVALID_PARAM', label + ' 格式不合法');
  }
  const valid = schema.type === 'object' ? plain(value) :
    schema.type === 'array' ? Array.isArray(value) :
      schema.type === 'null' ? value === null :
        schema.type === 'integer' ? Number.isSafeInteger(value) :
          schema.type === 'number' ? typeof value === 'number' && Number.isFinite(value) :
            typeof value === schema.type;
  if (!valid) throw error('INVALID_PARAM', label + ' 必须是 ' + schema.type);
  if (schema.enum && !schema.enum.includes(value)) throw error('INVALID_PARAM', label + ' 不在允许值中');
  if (typeof value === 'string') {
    if ((schema.minLength !== undefined && value.length < schema.minLength) || (schema.maxLength !== undefined && value.length > schema.maxLength)) throw error('INVALID_PARAM', label + ' 长度不合法');
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) throw error('INVALID_PARAM', label + ' 格式不合法');
  }
  if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) throw error('INVALID_PARAM', label + ' 超出范围');
  if (schema.type === 'array') {
    if ((schema.minItems !== undefined && value.length < schema.minItems) || (schema.maxItems !== undefined && value.length > schema.maxItems)) throw error('INVALID_PARAM', label + ' 数量不合法');
    value.forEach((v, i) => validate(v, schema.items, label + '[' + i + ']'));
  }
  if (schema.type === 'object') {
    for (const k of schema.required || []) if (!own(value, k)) throw error('INVALID_PARAM', label + ' 缺少 ' + k);
    for (const k of Object.keys(value)) {
      if (!own(schema.properties, k)) throw error('INVALID_PARAM', label + ' 含未知字段: ' + k);
      validate(value[k], schema.properties[k], label + '.' + k);
    }
  }
}

function normalizePaints(list) {
  return list.map(p => {
    const common = ['type', 'opacity', 'visible', 'blendMode', 'boundVariables'];
    const extra = p.type === 'SOLID' ? ['color'] : p.type.startsWith('GRADIENT_') ? ['gradientTransform', 'gradientStops'] :
      p.type === 'IMAGE' ? ['imageHash', 'scaleMode', 'imageTransform', 'scalingFactor', 'rotation', 'filters'] :
        p.type === 'VIDEO' ? ['videoHash', 'scaleMode'] : ['emoji'];
    strictKeys(p, [...common, ...extra], 'paint');
    if (p.type !== 'SOLID') return p;
    if (!own(p, 'color')) throw error('INVALID_PARAM', 'SOLID 缺少 color');
    let c = p.color;
    if (typeof c === 'string') {
      let h = c.replace(/^#/, '');
      if (h.length === 3) h = h.split('').map(x => x + x).join('');
      c = { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 };
    }
    if (own(c, 'a') && own(p, 'opacity') && c.a !== p.opacity) throw error('INVALID_PARAM', 'color.a 与 opacity 冲突');
    const out = { ...p, color: { r: c.r, g: c.g, b: c.b } };
    if (own(c, 'a')) out.opacity = c.a;
    return out;
  });
}
function buildParams(spec, args) {
  if (spec.command === 'createNode') {
    if (args.type === 'TEXT' && !own(args, 'text')) throw error('INVALID_PARAM', 'TEXT 创建必须显式提供 text');
    if (args.type !== 'TEXT' && own(args, 'text')) throw error('INVALID_PARAM', '只有 TEXT 创建可以提供 text');
    if (args.type !== 'LINE' && own(args, 'height') && args.height < 0.01) throw error('INVALID_PARAM', '非 LINE 节点高度至少为 0.01');
    for (const k of ['name', 'x', 'y', 'width', 'height']) if (own(args, k) && args.props && own(args.props, k)) throw error('INVALID_PARAM', '创建字段重复: ' + k);
  }
  const params = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === 'sessionId' || k === 'pageId' || (k === 'operationId' && spec.write)) continue;
    params[k === 'nodeId' ? 'id' : k] = v;
  }
  if (params.props) {
    params.props = { ...params.props };
    for (const k of ['fills', 'strokes']) if (own(params.props, k)) params.props[k] = normalizePaints(params.props[k]);
  }
  if (own(params, 'cursor') && !Number.isSafeInteger(Number(params.cursor))) throw error('INVALID_PARAM', 'cursor 超出安全整数范围');
  return params;
}

let bridgeKey;
let active = null;
let shuttingDown = false;
let requestSeq = 0;
const pending = new Map();
const rpcPending = new Map();
let tokens = 20;
let refillAt = Date.now();
function takeToken() {
  const now = Date.now();
  tokens = Math.min(20, tokens + Math.max(0, now - refillAt) / 1000 * 20);
  refillAt = now;
  if (tokens < 1) throw error('RATE_LIMITED', '请求超过 20 次/秒，请稍后再试');
  tokens--;
}

function failureFor(rec, code, message) {
  return error(code, message, rec.write ? {
    state: 'unknown', details: { operationId: rec.operationId, sessionId: rec.sessionId, pageId: rec.pageId },
  } : {});
}
function settle(id, err, data) {
  const rec = pending.get(id);
  if (!rec) return;
  pending.delete(id);
  clearTimeout(rec.timer);
  if (rec.signal && rec.abort) rec.signal.removeEventListener('abort', rec.abort);
  if (err) rec.reject(err); else rec.resolve(data);
}
function drop(client, code = 'PLUGIN_DISCONNECTED', message = '插件已断开连接', closeCode = 4001) {
  clearTimeout(client.authTimer);
  if (active === client) active = null;
  client.authed = false;
  for (const [id, rec] of pending) if (rec.client === client) settle(id, failureFor(rec, code, message));
  if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
    try { client.close(closeCode, code); } catch { client.terminate(); }
    const deadline = setTimeout(() => client.terminate(), 300);
    deadline.unref();
  }
}
function sendPlain(client, msg) {
  if (client.readyState !== WebSocket.OPEN) return;
  client.send(JSON.stringify(msg));
}
function sendFrame(client, payload, callback) {
  const seq = client.sendSeq + 1;
  const frame = { type: 'frame', connectionId: client.connectionId, seq, payload };
  frame.mac = sign(bridgeKey, frameProof('server', frame.connectionId, seq, payload));
  const text = JSON.stringify(frame);
  if (Buffer.byteLength(text) > MAX_MSG_BYTES) throw error('MSG_TOO_LARGE', '签名命令超过 256KB 上限');
  client.sendSeq = seq;
  client.send(text, callback);
}
function sendCommand(command, params, args, signal) {
  const client = active;
  if (!client || !client.authed || client.readyState !== WebSocket.OPEN) return Promise.reject(error('NO_PLUGIN', '请在 Figma Desktop 运行插件并连接本机桥接'));
  if (args.sessionId !== client.context.sessionId || args.pageId !== client.context.pageId) return Promise.reject(error('STALE_CONTEXT', '目标会话或页面已变化，请重新读取状态并确认目标'));
  if (signal?.aborted) return Promise.reject(error('CANCELLED', '调用已取消'));
  if (pending.size >= MAX_PENDING) return Promise.reject(error('BUSY', '在途请求过多'));
  takeToken();
  const id = client.connectionId + ':' + (++requestSeq);
  const payload = {
    type: 'cmd', id, command, params, sessionId: args.sessionId, pageId: args.pageId,
    ...(WRITE_COMMANDS.has(command) ? { operationId: args.operationId } : {}),
  };
  return new Promise((resolve, reject) => {
    const rec = {
      client, resolve, reject, signal, write: WRITE_COMMANDS.has(command),
      sessionId: args.sessionId, pageId: args.pageId, operationId: args.operationId,
    };
    rec.timer = setTimeout(() => settle(id, failureFor(rec, 'TIMEOUT', '插件未在期限内回复；写入结果可能未知，请查询 operationId')), CMD_TIMEOUT_MS);
    rec.abort = () => settle(id, failureFor(rec, 'CANCELLED', '调用已取消；已开始的写入仍可能完成'));
    if (signal) signal.addEventListener('abort', rec.abort, { once: true });
    pending.set(id, rec);
    try { sendFrame(client, payload, e => { if (e) drop(client, 'SEND_FAILED', e.message); }); }
    catch (e) {
      if (e.code === 'MSG_TOO_LARGE') settle(id, e);
      else drop(client, 'SEND_FAILED', e.message);
    }
  });
}

function serveHttp(req, res) {
  res.writeHead(404, { 'content-type': 'text/plain', 'connection': 'close' });
  res.end('Not found');
}
const httpServers = [createServer(serveHttp), createServer(serveHttp)];
const listenHosts = [];
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG_BYTES, perMessageDeflate: false });
function handleUpgrade(req, socket, head) {
  // Figma Desktop plugin iframes may have an opaque (null) Origin.
  const origin = req.headers.origin;
  const allowedOrigin = origin === undefined || origin === 'null' || origin === 'https://www.figma.com' || origin === 'https://figma.com';
  const allowedHost = [HOST + ':' + PORT, 'localhost:' + PORT, '[' + IPV6_HOST + ']:' + PORT].includes(req.headers.host);
  if (!bridgeKey || ![HOST, IPV6_HOST].includes(req.socket.remoteAddress) || !allowedHost || !allowedOrigin || req.url !== WS_PATH || wss.clients.size >= 8) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  wss.handleUpgrade(req, socket, head, client => wss.emit('connection', client));
}
for (const server of httpServers) server.on('upgrade', handleUpgrade);
function listen(server, host) {
  return new Promise((resolve, reject) => {
    const failed = e => { server.removeListener('listening', ready); reject(e); };
    const ready = () => {
      server.removeListener('error', failed);
      listenHosts.push(server.address().address);
      resolve();
    };
    server.once('error', failed);
    server.once('listening', ready);
    server.listen({ port: PORT, host, ipv6Only: host === IPV6_HOST });
  });
}
function closeListeners() {
  return Promise.all(httpServers.map(server => new Promise(resolve => {
    if (!server.listening) { resolve(); return; }
    server.close(resolve);
  })));
}
wss.on('connection', client => {
  client.authed = false;
  client.serverNonce = randomBytes(32).toString('hex');
  client.recvSeq = 0;
  client.sendSeq = 0;
  client.alive = true;
  client.authTimer = setTimeout(() => drop(client, 'AUTH_TIMEOUT', '鉴权超时'), 10000);
  client.on('pong', () => { client.alive = true; client.lastSeen = Date.now(); });
  client.on('error', () => drop(client));
  client.on('close', () => drop(client));
  client.on('message', (bytes, binary) => {
    try {
      if (binary) throw error('BAD_FRAME', '不接受二进制消息');
      const msg = JSON.parse(bytes.toString('utf8'));
      if (!client.authed) {
        strictKeys(msg, ['type', 'protocol', 'serverNonce', 'clientNonce', 'context', 'proof'], 'auth');
        if (msg.type !== 'auth' || msg.protocol !== AUTH_PROTOCOL || msg.serverNonce !== client.serverNonce ||
            typeof msg.clientNonce !== 'string' || !KEY_RE.test(msg.clientNonce)) throw error('AUTH_FAILED', '鉴权失败');
        const context = normalizeContext(msg.context);
        if (!verify(bridgeKey, authProof('client-auth', client.serverNonce, msg.clientNonce, context), msg.proof)) throw error('AUTH_FAILED', '鉴权失败');
        if (active && active !== client) {
          sendPlain(client, { type: 'auth_ack', ok: false, error: { code: 'PLUGIN_BUSY', message: '另一个插件已获授权，请先断开该插件' } });
          drop(client, 'PLUGIN_BUSY', '已有插件连接');
          return;
        }
        client.context = context;
        client.connectionId = randomBytes(32).toString('hex');
        client.authed = true;
        client.lastSeen = Date.now();
        clearTimeout(client.authTimer);
        active = client;
        sendPlain(client, {
          type: 'auth_ack', ok: true, protocol: AUTH_PROTOCOL, connectionId: client.connectionId,
          proof: sign(bridgeKey, authProof('server-auth', client.serverNonce, msg.clientNonce, context, client.connectionId)),
        });
        return;
      }
      strictKeys(msg, ['type', 'connectionId', 'seq', 'payload', 'mac'], 'frame');
      if (msg.type !== 'frame' || msg.connectionId !== client.connectionId || !Number.isSafeInteger(msg.seq) ||
          msg.seq !== client.recvSeq + 1 || !plain(msg.payload) ||
          !verify(bridgeKey, frameProof('client', msg.connectionId, msg.seq, msg.payload), msg.mac)) throw error('BAD_FRAME', '签名或序号校验失败');
      client.recvSeq = msg.seq;
      client.lastSeen = Date.now();
      const resp = msg.payload;
      strictKeys(resp, ['type', 'id', 'ok', 'data', 'error'], 'resp');
      if (resp.type !== 'resp' || typeof resp.id !== 'string' || typeof resp.ok !== 'boolean') throw error('BAD_FRAME', '响应格式不合法');
      const rec = pending.get(resp.id);
      if (!rec || rec.client !== client) return; // Late results are reconciled via getOperation.
      if (resp.ok) settle(resp.id, null, resp.data);
      else {
        strictKeys(resp.error, ['code', 'message', 'state', 'affectedNodeIds', 'details'], 'error');
        if (typeof resp.error.code !== 'string' || typeof resp.error.message !== 'string') throw error('BAD_FRAME', '错误结果格式不合法');
        settle(resp.id, error(resp.error.code, resp.error.message, resp.error));
      }
    } catch (e) {
      if (!client.authed) sendPlain(client, { type: 'auth_ack', ok: false, error: { code: 'AUTH_FAILED', message: '鉴权失败，请核对本机配对密钥' } });
      drop(client, e.code || 'BAD_FRAME', e.message);
    }
  });
  sendPlain(client, { type: 'challenge', protocol: AUTH_PROTOCOL, serverNonce: client.serverNonce });
});
const heartbeat = setInterval(() => {
  if (!active) return;
  if (!active.alive) { drop(active, 'PLUGIN_DISCONNECTED', '插件心跳丢失'); return; }
  active.alive = false;
  try { active.ping(); } catch { drop(active); }
}, 15000);
heartbeat.unref();

function toolError(e) {
  const result = { code: e.code || 'BRIDGE_ERROR', message: e.message || String(e) };
  for (const key of ['state', 'affectedNodeIds', 'details']) if (own(e, key)) result[key] = e[key];
  return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: result }) }], isError: true };
}
async function callTool(name, args, signal) {
  const started = Date.now();
  try {
    const spec = tools[name];
    if (!spec) throw error('UNKNOWN_TOOL', '未知工具: ' + name);
    validate(args, spec.inputSchema);
    let data;
    if (name === 'figma_canvas_status') {
      const client = active;
      data = { connected: !!client, authorized: false, context: client?.context || null, bridge: { host: 'localhost', listenHosts: [...listenHosts], port: PORT, path: WS_PATH, protocol: AUTH_PROTOCOL } };
      if (client) {
        try {
          data.ping = await sendCommand('ping', {}, client.context, signal);
          data.authorized = active === client && client.authed;
          data.connected = data.authorized;
          if (plain(data.ping)) data.context = normalizeContext(data.ping.context || data.ping);
        } catch (e) {
          data.authorized = false;
          data.pingError = { code: e.code || 'PLUGIN_ERROR', message: e.message };
          data.connected = active === client && client.readyState === WebSocket.OPEN;
        }
      } else takeToken();
    } else data = await sendCommand(spec.command, buildParams(spec, args), args, signal);
    audit(name, args, true, null, Date.now() - started);
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }], isError: false };
  } catch (e) {
    if (own(tools, name) && tools[name].write && !own(e, 'state')) e.state = 'not_started';
    audit(name, args, false, e.code, Date.now() - started);
    return toolError(e);
  }
}

let lifecycle = 'new';
let negotiatedVersion;
function rpcError(code, message, id = null) { return { jsonrpc: '2.0', id, error: { code, message } }; }
const validId = id => typeof id === 'string' || (typeof id === 'number' && Number.isSafeInteger(id));
function checkParams(params, allowed, required = []) {
  strictKeys(params, [...allowed, '_meta'], 'params');
  for (const k of required) if (!own(params, k)) throw error('INVALID_PARAM', 'params 缺少 ' + k);
  if (own(params, '_meta') && !plain(params._meta)) throw error('INVALID_PARAM', '_meta 必须是对象');
}
async function dispatch(msg, signal) {
  const params = msg.params === undefined ? {} : msg.params;
  if (!plain(params)) throw error('INVALID_PARAM', 'params 必须是对象');
  switch (msg.method) {
    case 'initialize': {
      if (lifecycle !== 'new') throw error('INVALID_REQUEST', '连接已初始化');
      checkParams(params, ['protocolVersion', 'capabilities', 'clientInfo'], ['protocolVersion', 'capabilities', 'clientInfo']);
      if (typeof params.protocolVersion !== 'string' || !plain(params.capabilities) || !plain(params.clientInfo) ||
          typeof params.clientInfo.name !== 'string' || typeof params.clientInfo.version !== 'string') throw error('INVALID_PARAM', 'initialize 参数不合法');
      negotiatedVersion = SUPPORTED_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED_VERSIONS.at(-1);
      lifecycle = 'initializing';
      return { protocolVersion: negotiatedVersion, capabilities: { tools: {} }, serverInfo: SERVER_INFO };
    }
    case 'ping': checkParams(params, []); return {};
    case 'tools/list':
      if (lifecycle !== 'ready') throw error('NOT_INITIALIZED', '请先完成 initialize 与 notifications/initialized');
      checkParams(params, ['cursor']);
      if (own(params, 'cursor')) throw error('INVALID_PARAM', '本服务工具清单不支持分页 cursor');
      return { tools: Object.values(tools).map(({ command, write, ...spec }) => spec) };
    case 'tools/call':
      if (lifecycle !== 'ready') throw error('NOT_INITIALIZED', '请先完成 initialize 与 notifications/initialized');
      checkParams(params, ['name', 'arguments'], ['name']);
      if (typeof params.name !== 'string' || (own(params, 'arguments') && !plain(params.arguments))) throw error('INVALID_PARAM', '工具名称或 arguments 不合法');
      if (!own(tools, params.name)) throw error('INVALID_PARAM', '未知工具: ' + params.name);
      return callTool(params.name, params.arguments || {}, signal);
    default: throw error('METHOD_NOT_FOUND', '未知方法: ' + msg.method);
  }
}
async function handleMessage(msg) {
  if (!plain(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string' ||
      Object.keys(msg).some(k => !['jsonrpc', 'id', 'method', 'params'].includes(k)) ||
      (own(msg, 'id') && !validId(msg.id))) return rpcError(-32600, 'Invalid Request');
  if (!own(msg, 'id')) {
    if (msg.method === 'notifications/initialized' && lifecycle === 'initializing') {
      try { checkParams(msg.params === undefined ? {} : msg.params, []); lifecycle = 'ready'; } catch { /* Invalid notifications have no response. */ }
    }
    if (msg.method === 'notifications/cancelled' && plain(msg.params) && validId(msg.params.requestId)) {
      const rec = rpcPending.get(JSON.stringify(msg.params.requestId));
      if (rec && rec.method !== 'initialize') { rec.cancelled = true; rec.controller.abort(); }
    }
    return null;
  }
  if (msg.method.startsWith('notifications/')) return rpcError(-32600, '通知不能携带 id', msg.id);
  const key = JSON.stringify(msg.id);
  if (rpcPending.has(key)) return rpcError(-32600, '重复的在途请求 id', msg.id);
  const rec = { controller: new AbortController(), cancelled: false, method: msg.method };
  rpcPending.set(key, rec);
  try {
    const result = await dispatch(msg, rec.controller.signal);
    return rec.cancelled ? null : { jsonrpc: '2.0', id: msg.id, result };
  } catch (e) {
    const code = e.code === 'METHOD_NOT_FOUND' ? -32601 : e.code === 'INVALID_PARAM' ? -32602 : e.code === 'INVALID_REQUEST' ? -32600 : e.code === 'NOT_INITIALIZED' ? -32002 : -32603;
    return rec.cancelled ? null : rpcError(code, e.message, msg.id);
  } finally { rpcPending.delete(key); }
}
function writeStdout(value) {
  if (!shuttingDown && value !== null) process.stdout.write(JSON.stringify(value) + '\n');
}
async function processLine(bytes) {
  let msg;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    msg = JSON.parse(text);
  } catch { writeStdout(rpcError(-32700, 'Parse error')); return; }
  if (Array.isArray(msg)) {
    if (negotiatedVersion !== '2025-03-26' || msg.length === 0 || msg.length > 100) { writeStdout(rpcError(-32600, '该协议版本不接受此批量请求')); return; }
    const results = (await Promise.all(msg.map(handleMessage))).filter(x => x !== null);
    if (results.length) writeStdout(results);
  } else writeStdout(await handleMessage(msg));
}
function startStdio() {
  let buffer = Buffer.alloc(0);
  let discarding = false;
  process.stdin.on('data', chunk => {
    let start = 0;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] !== 10) continue;
      const part = chunk.subarray(start, i);
      if (!discarding && buffer.length + part.length <= MAX_STDIO_BYTES) {
        const line = Buffer.concat([buffer, part]);
        if (line.length) void processLine(line).catch(e => log('请求处理失败: ' + e.message));
      } else if (!discarding) writeStdout(rpcError(-32600, 'stdio 消息超过 1MB 上限'));
      buffer = Buffer.alloc(0); discarding = false; start = i + 1;
    }
    if (!discarding) {
      const rest = chunk.subarray(start);
      if (buffer.length + rest.length > MAX_STDIO_BYTES) {
        buffer = Buffer.alloc(0); discarding = true;
        writeStdout(rpcError(-32600, 'stdio 消息超过 1MB 上限'));
      } else buffer = Buffer.concat([buffer, rest]);
    }
  });
  process.stdin.on('end', () => shutdown(0));
  process.stdin.on('error', () => shutdown(1));
  process.stdout.on('error', () => shutdown(1));
}
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(heartbeat);
  for (const client of wss.clients) { drop(client); client.terminate(); }
  wss.close();
  void closeListeners().then(() => process.exit(code));
  setTimeout(() => process.exit(code), 300).unref();
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());

async function main() {
  const flags = process.argv.slice(2);
  if (flags.some(x => !['--show-pairing-key', '--rotate-token'].includes(x)) || flags.length > 1) throw error('INVALID_CONFIG', '只接受 --show-pairing-key 或 --rotate-token');
  if (TEST_PORT !== undefined && (process.env.NODE_ENV !== 'test' || !process.env.FIGMA_BRIDGE_HOME || !Number.isSafeInteger(PORT) || PORT < 1024 || PORT > 65535)) throw error('INVALID_CONFIG', 'FIGMA_BRIDGE_TEST_PORT 仅允许使用临时 FIGMA_BRIDGE_HOME 的 NODE_ENV=test 测试进程');
  if (process.env.FIGMA_BRIDGE_PORT !== undefined && process.env.FIGMA_BRIDGE_PORT !== '9753') throw error('INVALID_CONFIG', '此版本固定使用 127.0.0.1:9753，不支持自定义端口');
  if (!Number.isSafeInteger(CMD_TIMEOUT_MS) || CMD_TIMEOUT_MS < 1 || CMD_TIMEOUT_MS > 300000) throw error('INVALID_CONFIG', 'FIGMA_BRIDGE_TIMEOUT_MS 必须为 1–300000 的整数');
  if (flags.includes('--show-pairing-key')) {
    // Explicit local CLI output, never an MCP method or a WebSocket message.
    console.log(loadKey(false));
    return;
  }
  await listen(httpServers[0], HOST);
  try { await listen(httpServers[1], IPV6_HOST); }
  catch (e) {
    if (e.code !== 'EAFNOSUPPORT' && e.code !== 'EADDRNOTAVAIL') throw e;
    log('此系统不支持 IPv6 回环地址，当前仅监听 127.0.0.1；localhost 必须可解析到 IPv4。');
  }
  // Rotation only occurs after this process owns every supported loopback listener.
  bridgeKey = loadKey(flags.includes('--rotate-token'));
  if (flags.includes('--rotate-token')) {
    log('本机配对密钥已轮换；旧密钥失效。请重新显示密钥并在插件中忘记旧配对。');
    await closeListeners();
    return;
  }
  for (const server of httpServers) server.on('error', e => { log('桥接监听失败: ' + e.message); shutdown(1); });
  startStdio();
  log('MCP stdio 已就绪，插件地址 ws://localhost:' + PORT + '/plugin；回环监听: ' + listenHosts.join(', '));
  log('需要配对时，在本机终端显式执行 node bridge/mcp-bridge.js --show-pairing-key');
}
main().catch(e => {
  log(e.code === 'EADDRINUSE' ? '9753 端口已被占用；未修改密钥。请先退出其他桥接或 Agent。' : e.message);
  shutdown(1);
});
