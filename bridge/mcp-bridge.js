// MCP stdio owns this process and the single local Figma connection.
// Protocol 3: registry-driven tools, page generations, chunked resource
// transport, artifact files, jobs and reserved control capacity.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { AUTH_PROTOCOL, KEY_RE, sign, verify, authProof, frameProof, normalizeContext } from './auth.js';
import { LIMITS, CONTROL_COMMANDS, BATCH_EXCLUDED_COMMANDS } from '../shared/limits.js';
import { validateSchema, SchemaError } from '../shared/schema-validator.js';
import { TOOLS, COMMANDS, WRITE_COMMANDS, isWriteCall, toolFor, toolsForListing } from '../shared/tool-registry.js';
import { chunkCount, validateTransferHeader, base64ByteLength } from '../shared/transfer.js';
import { contextMatches } from '../shared/context.js';

const HOST = '127.0.0.1';
const IPV6_HOST = '::1';
const TEST_PORT = process.env.FIGMA_BRIDGE_TEST_PORT;
const PORT = TEST_PORT === undefined ? 9753 : Number(TEST_PORT);
const WS_PATH = '/plugin';
const MAX_MSG_BYTES = LIMITS.FRAME_BYTES;
const MAX_STDIO_BYTES = LIMITS.STDIO_BYTES;
const MAX_PENDING = LIMITS.PENDING_REQUESTS;
const SUPPORTED_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
const SERVER_INFO = { name: 'figma-canvas-writer', version: '3.1.0' };
const LEGACY_DIR = path.join(os.homedir(), '.dsh-figma-bridge');
const CONFIG_DIR = process.env.FIGMA_BRIDGE_HOME || (fs.existsSync(LEGACY_DIR) ? LEGACY_DIR : path.join(os.homedir(), '.figma-canvas-writer'));
const TOKEN_FILE = path.join(CONFIG_DIR, 'bridge-token');
const AUDIT_FILE = path.join(CONFIG_DIR, 'audit.log');
const ARTIFACT_DIR = path.join(CONFIG_DIR, 'artifacts');
const CMD_TIMEOUT_MS = process.env.FIGMA_BRIDGE_TIMEOUT_MS === undefined ? 15000 : Number(process.env.FIGMA_BRIDGE_TIMEOUT_MS);
const JOB_TIMEOUT_MS = 150000;
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

// ---- artifacts -------------------------------------------------------------
const artifacts = new Map();
function safeArtifactDir() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true, mode: 0o700 });
  const info = fs.lstatSync(ARTIFACT_DIR);
  if (!info.isDirectory() || info.isSymbolicLink()) throw error('INVALID_CONFIG', '产物目录必须是普通目录');
  return fs.realpathSync(ARTIFACT_DIR);
}
function artifactIdOf(source) {
  return createHash('sha256').update(source, 'utf8').digest('hex').slice(0, 32);
}
function writeArtifact(bytes, extension, meta = {}) {
  const dir = safeArtifactDir();
  const name = meta.artifactId || (meta.transferId ? meta.transferId.slice(0, 16) : randomBytes(8).toString('hex')) + '.' + extension;
  const target = path.join(dir, name);
  const fd = fs.openSync(target, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); } finally { fs.closeSync(fd); }
  const stat = fs.statSync(target);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const record = {
    artifactId: meta.artifactId || name.slice(0, 32), path: target, absolutePath: target,
    bytes: bytes.length, sha256, format: meta.format || extension.toUpperCase(), mime: meta.mime || null,
    operationId: meta.operationId || null, transferId: meta.transferId || null, createdAt: new Date().toISOString(),
  };
  artifacts.set(record.artifactId, record);
  if (record.operationId) artifacts.set('op:' + record.operationId, record);
  return record;
}
function findArtifact({ artifactId, operationId, transferId }) {
  if (artifactId && artifacts.has(artifactId)) return artifacts.get(artifactId);
  if (operationId && artifacts.has('op:' + operationId)) return artifacts.get('op:' + operationId);
  if (transferId) for (const record of artifacts.values()) if (record.transferId === transferId) return record;
  return null;
}

// ---- bridge state ----------------------------------------------------------
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

// ---- transfer state --------------------------------------------------------
// inbound (plugin -> bridge): export/screenshot bytes; outbound: import bytes.
const inboundTransfers = new Map();
const outboundTransfers = new Map();
const finishedTransfers = new Map();
const pendingVideoJobs = new Set();
setInterval(() => {
  for (const transferId of [...outboundTransfers.keys()]) {
    const t = outboundTransfers.get(transferId);
    if (t && t.settled) outboundTransfers.delete(transferId);
  }
  // Fully received transfers expire five minutes after completion even when
  // their command never came back to persist them.
  for (const [transferId, entry] of [...finishedTransfers]) {
    if (Date.now() - entry.completedAt > 300000) finishedTransfers.delete(transferId);
  }
  if (pendingVideoJobs.size > 50) pendingVideoJobs.clear();
}, 60000).unref();
let stagingBytes = 0;

function releaseInbound(transferId) {
  const t = inboundTransfers.get(transferId);
  if (!t) return;
  inboundTransfers.delete(transferId);
  stagingBytes -= t.received;
  clearTimeout(t.idleTimer);
  clearTimeout(t.totalTimer);
  t.reject(error('TRANSFER_ABORTED', '传输已释放'));
}
function touchInbound(t) {
  clearTimeout(t.idleTimer);
  t.idleTimer = setTimeout(() => { releaseInbound(t.transferId); }, LIMITS.TRANSFER_IDLE_MS);
  t.idleTimer.unref();
}
function createInbound(header, client) {
  const received = 0;
  const t = {
    transferId: header.transferId, operationId: header.operationId || null, totalBytes: header.totalBytes,
    totalSha256: header.totalSha256, chunks: new Map(), received, client, settled: false,
    promise: null, resolve: null, reject: null, idleTimer: null,
  };
  t.promise = new Promise((resolve, reject) => { t.resolve = resolve; t.reject = reject; });
  t.totalTimer = setTimeout(() => {
    if (!t.settled) { t.settled = true; releaseInbound(t.transferId); t.reject(error('TRANSFER_TIMEOUT', '传输超时')); }
  }, LIMITS.TRANSFER_TOTAL_MS);
  t.totalTimer.unref();
  touchInbound(t);
  inboundTransfers.set(header.transferId, t);
  return t;
}
function deliverInboundChunk(client, payload) {
  let t = inboundTransfers.get(payload.transferId);
  if (!t) {
    strictKeys(payload, ['type', 'transferId', 'operationId', 'totalBytes', 'totalSha256', 'index', 'data', 'done'], 'chunk');
    if (payload.index !== 0) throw error('BAD_CHUNK', '传输头部必须出现在首个块');
    const header = validateTransferHeader({ transferId: payload.transferId, totalBytes: payload.totalBytes, totalSha256: payload.totalSha256, direction: 'plugin' }, 'plugin');
    if (inboundTransfers.size >= LIMITS.CONCURRENT_TRANSFERS) throw error('TRANSFER_CAPACITY', '并发传输过多');
    t = createInbound({ transferId: payload.transferId, operationId: payload.operationId || null, totalBytes: payload.totalBytes, totalSha256: payload.totalSha256 }, client);
  } else {
    strictKeys(payload, ['type', 'transferId', 'index', 'data', 'done'], 'chunk');
  }
  if (t.client !== client) throw error('BAD_CHUNK', '传输属于其他连接');
  if (typeof payload.index !== 'number' || !Number.isSafeInteger(payload.index) || payload.index < 0) throw error('BAD_CHUNK', '块序号非法');
  const expectedChunks = chunkCount(t.totalBytes);
  if (payload.index >= expectedChunks) throw error('BAD_CHUNK', '块序号超出传输范围');
  if (typeof payload.data !== 'string' || base64ByteLength(payload.data) > LIMITS.CHUNK_RAW_BYTES) throw error('BAD_CHUNK', '块内容超限');
  const existing = t.chunks.get(payload.index);
  if (existing !== undefined && existing !== payload.data) throw error('BAD_CHUNK', '重复块内容冲突');
  if (existing === undefined) {
    t.chunks.set(payload.index, payload.data);
    t.received += base64ByteLength(payload.data);
    stagingBytes += base64ByteLength(payload.data);
    if (stagingBytes > LIMITS.STAGING_BYTES) throw error('TRANSFER_CAPACITY', '暂存空间超出预算');
  }
  touchInbound(t);
  if (t.settled) return t;
  if (payload.done === true) {
    if (t.chunks.size !== expectedChunks) throw error('BAD_CHUNK', '块数量不完整');
    const parts = [];
    let total = 0;
    for (let i = 0; i < expectedChunks; i++) {
      if (!t.chunks.has(i)) throw error('BAD_CHUNK', '缺少块 ' + i);
      const part = Buffer.from(t.chunks.get(i), 'base64');
      parts.push(part);
      total += part.length;
    }
    const bytes = Buffer.concat(parts, total);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== t.totalSha256) throw error('TRANSFER_HASH', '传输哈希校验失败');
    t.settled = true;
    stagingBytes -= t.received;
    clearTimeout(t.idleTimer); clearTimeout(t.totalTimer);
    inboundTransfers.delete(t.transferId);
    finishedTransfers.set(t.transferId, { bytes, completedAt: Date.now() });
    if (t.operationId && pendingVideoJobs.has(t.operationId)) {
      pendingVideoJobs.delete(t.operationId);
      writeArtifact(bytes, 'mp4', { transferId: t.transferId, operationId: t.operationId, format: 'mp4', mime: 'video/mp4' });
    }
    t.resolve(bytes);
  }
  return t;
}

function createOutbound(client, { transferId, totalBytes, totalSha256, bytes }) {
  if (outboundTransfers.size >= LIMITS.CONCURRENT_TRANSFERS) throw error('TRANSFER_CAPACITY', '并发传输过多');
  const expected = chunkCount(totalBytes);
  const t = {
    transferId, totalBytes, totalSha256, client, bytes, expected,
    sent: 0, unacked: new Set(), done: false, settled: false,
    resolve: null, reject: null, idleTimer: null, totalTimer: null,
  };
  t.promise = new Promise((resolve, reject) => { t.resolve = resolve; t.reject = reject; });
  t.totalTimer = setTimeout(() => {
    if (!t.settled) { t.settled = true; outboundTransfers.delete(transferId); t.reject(error('TRANSFER_TIMEOUT', '传输超时')); }
  }, LIMITS.TRANSFER_TOTAL_MS);
  t.totalTimer.unref();
  touchOutbound(t);
  outboundTransfers.set(transferId, t);
  return t;
}
function touchOutbound(t) {
  clearTimeout(t.idleTimer);
  t.idleTimer = setTimeout(() => {
    if (!t.settled) { t.settled = true; outboundTransfers.delete(t.transferId); t.reject(error('TRANSFER_TIMEOUT', '传输无进展超时')); }
  }, LIMITS.TRANSFER_IDLE_MS);
  t.idleTimer.unref();
}
function pumpOutbound(t) {
  if (t.settled || t.done) return;
  while (t.unacked.size < LIMITS.UNACKED_CHUNKS && t.sent < t.expected) {
    const index = t.sent++;
    const slice = t.bytes.subarray(index * LIMITS.CHUNK_RAW_BYTES, (index + 1) * LIMITS.CHUNK_RAW_BYTES);
    t.unacked.add(index);
    sendFrame(t.client, {
      type: 'chunk', transferId: t.transferId, index, done: index === t.expected - 1,
      data: slice.toString('base64'),
    }, e => { if (e && !t.settled) { t.settled = true; t.reject(error('SEND_FAILED', e.message)); } });
  }
}
function ackOutbound(client, payload) {
  // The frame handler already validated {type, transferId, index}.
  const t = outboundTransfers.get(payload.transferId);
  if (!t || t.client !== client) return;
  if (t.settled) return;
  if (typeof payload.index !== 'number' || !Number.isSafeInteger(payload.index)) throw error('BAD_CHUNK', '确认序号非法');
  t.unacked.delete(payload.index);
  touchOutbound(t);
  if (t.unacked.size === 0 && t.sent >= t.expected) {
    t.done = true;
    t.settled = true;
    clearTimeout(t.idleTimer); clearTimeout(t.totalTimer);
    outboundTransfers.delete(t.transferId);
    t.resolve(t);
  } else pumpOutbound(t);
}

// ---- websocket plumbing ----------------------------------------------------
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
  for (const [transferId, t] of [...outboundTransfers]) if (t.client === client && !t.settled) {
    t.settled = true; outboundTransfers.delete(transferId); t.reject(error(code, message));
  }
  for (const [transferId, t] of [...inboundTransfers]) if (t.client === client) releaseInbound(transferId);
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
  // Reconciliation (getOperation) may target a page the user has already left,
  // as long as the authorization generation still holds (contract §6.1).
  const reconcile = command === 'getOperation';
  if (!reconcile && !contextMatches(args, client.context)) return Promise.reject(error('STALE_CONTEXT', '目标会话或页面已变化，请重新读取状态并确认目标'));
  if (reconcile && args.sessionId !== client.context.sessionId) return Promise.reject(error('STALE_CONTEXT', '授权会话已变化，无法对账旧写入'));
  if (signal?.aborted) return Promise.reject(error('CANCELLED', '调用已取消'));
  const isControl = CONTROL_COMMANDS.has(command);
  const effectivePending = pending.size;
  if (effectivePending >= MAX_PENDING) return Promise.reject(error('BUSY', '在途请求过多'));
  if (!isControl && effectivePending >= MAX_PENDING - LIMITS.PENDING_CONTROL_RESERVED) {
    return Promise.reject(error('BUSY', '在途请求过多；仅状态查询等控制请求可用'));
  }
  takeToken();
  const write = isWriteCall(command, params);
  const isJob = toolForByName(command)?.classification === 'job';
  const id = client.connectionId + ':' + (++requestSeq);
  const payload = {
    type: 'cmd', id, command, params, sessionId: args.sessionId, pageId: args.pageId, pageRevision: args.pageRevision,
    ...(write ? { operationId: args.operationId } : {}),
  };
  return new Promise((resolve, reject) => {
    const rec = {
      client, resolve, reject, signal, write, isJob,
      sessionId: args.sessionId, pageId: args.pageId, pageRevision: args.pageRevision,
      operationId: args.operationId, command,
    };
    rec.timer = setTimeout(() => settle(id, failureFor(rec, 'TIMEOUT', '插件未在期限内回复；写入结果可能未知，请查询 operationId')), isJob ? JOB_TIMEOUT_MS : CMD_TIMEOUT_MS);
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
function toolForByName(name) { return COMMANDS.get(name); }

// ---- http/ws server --------------------------------------------------------
function serveHttp(req, res) {
  res.writeHead(404, { 'content-type': 'text/plain', 'connection': 'close' });
  res.end('Not found');
}
const httpServers = [createServer(serveHttp), createServer(serveHttp)];
const listenHosts = [];
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG_BYTES, perMessageDeflate: false });
function handleUpgrade(req, socket, head) {
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
          // Page switches make the UI reconnect while the old socket is still
          // mid-close; accept the replacement when the old client is going
          // away, but keep the takeover protection for a live connection.
          const stale = active.readyState === WebSocket.CLOSING || active.readyState === WebSocket.CLOSED ||
            (Date.now() - (active.lastSeen || 0) > 3000);
          if (!stale) {
            sendPlain(client, { type: 'auth_ack', ok: false, error: { code: 'PLUGIN_BUSY', message: '另一个插件已获授权，请先断开该插件' } });
            drop(client, 'PLUGIN_BUSY', '已有插件连接');
            return;
          }
          drop(active, 'PLUGIN_REPLACED', '插件已用新连接替换旧连接');
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
      if (resp.type === 'chunk') {
        strictKeys(resp, ['type', 'transferId', 'index', 'data', 'done', 'operationId', 'totalBytes', 'totalSha256'], 'chunk');
        if (resp.type !== 'chunk') throw error('BAD_CHUNK', '载荷类型不符');
        const t = deliverInboundChunk(client, resp);
        sendFrame(client, { type: 'chunk_ack', transferId: t.transferId, index: resp.index });
        return;
      }
      if (resp.type === 'chunk_ack') {
        strictKeys(resp, ['type', 'transferId', 'index'], 'chunk_ack');
        ackOutbound(client, resp);
        return;
      }
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

// ---- tool calls ------------------------------------------------------------
function toolError(e) {
  const result = { code: e.code || 'BRIDGE_ERROR', message: e.message || String(e) };
  for (const key of ['state', 'affectedNodeIds', 'details']) if (own(e, key)) result[key] = e[key];
  return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: result }) }], isError: true };
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
  const params = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === 'sessionId' || k === 'pageId' || k === 'pageRevision' || k === 'operationId') continue;
    params[k === 'nodeId' ? 'id' : k] = v;
  }
  // getOperation is read-classified, so its operationId rides in params.
  if (spec.command === 'getOperation') params.operationId = args.operationId;
  if (spec.command === 'createNode') {
    if (args.type === 'TEXT' && !own(args, 'text')) throw error('INVALID_PARAM', 'TEXT 创建必须显式提供 text');
    if (args.type !== 'TEXT' && own(args, 'text')) throw error('INVALID_PARAM', '只有 TEXT 创建可以提供 text');
    if (args.type !== 'LINE' && own(args, 'height') && args.height < 0.01) throw error('INVALID_PARAM', '非 LINE 节点高度至少为 0.01');
    for (const k of ['name', 'x', 'y', 'width', 'height']) if (own(args, k) && args.props && own(args.props, k)) throw error('INVALID_PARAM', '创建字段重复: ' + k);
  }
  if (params.props) {
    params.props = { ...params.props };
    for (const k of ['fills', 'strokes']) if (own(params.props, k)) params.props[k] = normalizePaints(params.props[k]);
  }
  if (own(params, 'cursor') && /^(0|[1-9][0-9]*)$/.test(String(params.cursor)) && !Number.isSafeInteger(Number(params.cursor))) throw error('INVALID_PARAM', 'cursor 超出安全整数范围');
  return params;
}

async function bridgeCapabilities(client) {
  const base = {
    bridge: { protocol: AUTH_PROTOCOL, serverInfo: SERVER_INFO, host: 'localhost', port: PORT, path: WS_PATH, listenHosts: [...listenHosts] },
    limits: { ...LIMITS },
    toolCount: Object.keys(TOOLS).length,
  };
  if (!client) return base;
  const pluginSide = await sendCommand('getCapabilities', {}, { ...client.context }, undefined);
  return { ...base, plugin: pluginSide };
}

async function callTool(name, args, signal) {
  const started = Date.now();
  try {
    const spec = toolFor(name);
    if (!spec) throw error('UNKNOWN_TOOL', '未知工具: ' + name);
    validateSchema(args, spec.inputSchema);
    const write = isWriteCall(spec.command, args);
    if (write && typeof args.operationId !== 'string') throw error('INVALID_PARAM', '写入需要 operationId');
    let data;
    const client = active;
    if (!spec.command) {
      if (name === 'figma_canvas_status') {
        data = { connected: !!client, authorized: false, context: client?.context || null, bridge: { host: 'localhost', listenHosts: [...listenHosts], port: PORT, path: WS_PATH, protocol: AUTH_PROTOCOL, serverInfo: SERVER_INFO } };
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
      } else throw error('UNKNOWN_TOOL', '未知工具: ' + name);
    } else if (spec.command === 'getCapabilities') {
      data = await bridgeCapabilities(client);
    } else if (spec.command === 'readAsset') {
      const record = findArtifact({ artifactId: args.artifactId });
      if (!record) throw error('ARTIFACT_NOT_FOUND', '找不到该产物；产物仅保留本次桥接运行');
      data = { ...record, inlinePreview: record.bytes <= LIMITS.INLINE_PREVIEW_BYTES
        ? fs.readFileSync(record.path).toString('base64') : null };
    } else if (spec.command === 'importAsset') {
      const importResult = await importAssetCommand(spec, args, client, signal);
      data = importResult;
    } else if (spec.command === 'batch') {
      const steps = Array.isArray(args.steps) ? args.steps : [];
      for (const [index, step] of steps.entries()) {
        const commandName = plain(step) ? step.command : null;
        const spec2 = commandName ? COMMANDS.get(commandName) : null;
        if (!spec2) throw error('INVALID_PARAM', `batch step${index} 使用未注册命令: ${commandName}`);
        if (BATCH_EXCLUDED_COMMANDS.has(commandName) || CONTROL_COMMANDS.has(commandName)) {
          throw error('INVALID_PARAM', `${commandName} 不能放入 batch`);
        }
      }
      data = await sendCommand(spec.command, buildParams(spec, args), args, signal);
    } else if (spec.command === 'exportAsset' || spec.command === 'getScreenshot' || spec.command === 'exportVideo') {
      data = await exportCommand(spec, args, client, signal);
    } else {
      data = await sendCommand(spec.command, buildParams(spec, args), args, signal);
      if (spec.command === 'managePage' && plain(data) && data.switched === true) {
        Object.assign(data, await waitForContextRefresh(client, data.context));
      }
      if (spec.command === 'getOperation' && plain(data) && data.state === 'succeeded') {
        const artifact = findArtifact({ operationId: args.operationId });
        if (artifact) data.artifact = { saved: true, path: artifact.path, bytes: artifact.bytes, sha256: artifact.sha256, format: artifact.format, mime: artifact.mime };
      }
    }
    audit(name, args, true, null, Date.now() - started);
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }], isError: false };
  } catch (e) {
    const spec = toolFor(name);
    if (spec && isWriteCall(spec.command, args) && !own(e, 'state')) e.state = 'not_started';
    audit(name, args, false, e.code, Date.now() - started);
    return toolError(e);
  }
}

// Wait until the plugin context reflects the requested page before returning.
async function waitForContextRefresh(client, expected) {
  if (!client || !plain(expected)) return { contextConfirmed: true };
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    // pageRevision is monotonic per plugin run; the UI may report a slightly
    // newer revision than the reply if the pagechange event lands late.
    if (client.context && client.context.pageId === expected.pageId &&
        client.context.pageRevision >= expected.pageRevision) return { contextConfirmed: true };
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return { contextConfirmed: false, note: '插件尚未确认新页面上下文；请重新读取状态后再继续写入' };
}

// Host-file write commands: collect inbound transfer bytes, persist and verify.
async function exportCommand(spec, args, client, signal) {
  const command = spec.command;
  const isScreenshot = command === 'getScreenshot';
  const isVideo = command === 'exportVideo';
  const wantInline = args.destination === 'inline';
  if (isVideo) {
    const result = await sendCommand(command, buildParams(spec, args), args, signal);
    if (plain(result) && (result.state === 'accepted' || result.jobId)) {
      const jobId = result.jobId || args.operationId;
      pendingVideoJobs.add(jobId);
      return { ...result, jobId, artifactPending: true };
    }
    // The plugin replied with a final result directly (deduplicated job).
    return result;
  }
  const transferId = reuseTransferId(args.operationId);
  const result = await sendCommand(command, { ...buildParams(spec, args), transferId }, args, signal);
  if (plain(result) && result.inline === true) return result;
  if (!plain(result) || typeof result.transferId !== 'string') throw error('TRANSFER_MISSING', '未收到资源传输');
  const finishedEntry = finishedTransfers.get(result.transferId);
  const bytes = finishedEntry ? finishedEntry.bytes : null;
  if (bytes === null) {
    const t = inboundTransfers.get(result.transferId);
    if (!t) throw error('TRANSFER_MISSING', '未收到资源传输');
    return await t.promise.then(collected => persistArtifact(args, result.transferId, false, collected));
  }
  return persistArtifact(args, result.transferId, isScreenshot, bytes);
}

const transferIdByOperation = new Map();
function reuseTransferId(operationId) {
  if (operationId && transferIdByOperation.has(operationId)) return transferIdByOperation.get(operationId);
  const transferId = randomBytes(16).toString('hex');
  if (operationId) {
    if (transferIdByOperation.size >= 200) transferIdByOperation.clear();
    transferIdByOperation.set(operationId, transferId);
  }
  return transferId;
}
function persistArtifact(args, transferId, isScreenshot, bytes) {
  // Idempotent: a retry after a lost response must return the existing
  // artifact instead of failing on the exclusive file create.
  const existing = findArtifact({ operationId: args.operationId, transferId });
  if (existing && existing.bytes === bytes.length && existing.sha256 === createHash('sha256').update(bytes).digest('hex')) {
    return { saved: true, ...existing, state: 'succeeded' };
  }
  const format = String(args.format || 'PNG').toLowerCase();
  const ext = format === 'jpeg' ? 'jpg' : format;
  const artifact = writeArtifact(bytes, ext, { transferId, operationId: args.operationId, format, mime: mimeFor(format) });
  finishedTransfers.delete(transferId);
  return { saved: true, ...artifact, state: 'succeeded' };
}

async function importAssetCommand(spec, args, client, signal) {
  if (!client) throw error('NO_PLUGIN', '请在 Figma Desktop 运行插件并连接本机桥接');
  if (!contextMatches(args, client.context)) throw error('STALE_CONTEXT', '目标会话或页面已变化，请重新读取状态并确认目标');
  const resolved = resolveImportPath(args.filePath);
  const bytes = readImportBytes(resolved);
  const ext = path.extname(resolved.real).toLowerCase().slice(1);
  if (!['png', 'jpg', 'jpeg', 'svg'].includes(ext)) throw error('INVALID_ASSET', '仅支持 PNG/JPEG/SVG 文件');
  const header = sniffAssetHeader(bytes, ext);
  const transferId = randomBytes(16).toString('hex');
  const totalSha256 = createHash('sha256').update(bytes).digest('hex');
  const params = {
    transferId, format: header.format, fileName: path.basename(resolved.real),
    totalBytes: bytes.length, totalSha256,
    ...(args.x !== undefined ? { x: args.x } : {}),
    ...(args.y !== undefined ? { y: args.y } : {}),
    ...(args.parentId !== undefined ? { parentId: args.parentId } : {}),
    ...(args.name !== undefined ? { name: args.name } : {}),
  };
  if (pending.size >= MAX_PENDING) throw error('BUSY', '在途请求过多');
  takeToken();
  const id = client.connectionId + ':' + (++requestSeq);
  const payload = { type: 'cmd', id, command: 'importAsset', params, sessionId: args.sessionId, pageId: args.pageId, pageRevision: args.pageRevision, operationId: args.operationId };
  const promise = new Promise((resolve, reject) => {
    const rec = { client, resolve, reject, signal, write: true, sessionId: args.sessionId, pageId: args.pageId, pageRevision: args.pageRevision, operationId: args.operationId, command: 'importAsset' };
    rec.timer = setTimeout(() => settle(id, failureFor(rec, 'TIMEOUT', '插件未在期限内回复；导入结果可能未知，请查询 operationId')), CMD_TIMEOUT_MS);
    rec.abort = () => settle(id, failureFor(rec, 'CANCELLED', '调用已取消；已开始的写入仍可能完成'));
    if (signal) signal.addEventListener('abort', rec.abort, { once: true });
    pending.set(id, rec);
    try { sendFrame(client, payload, e => { if (e) drop(client, 'SEND_FAILED', e.message); }); }
    catch (e) { if (e.code === 'MSG_TOO_LARGE') settle(id, e); else drop(client, 'SEND_FAILED', e.message); }
  });
  const transfer = createOutbound(client, { transferId, totalBytes: bytes.length, totalSha256, bytes });
  pumpOutbound(transfer);
  const result = await promise;
  if (plain(result) && result.data === undefined) return result;
  return result;
}

function mimeFor(format) {
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', pdf: 'application/pdf', mp4: 'video/mp4' }[String(format).toLowerCase()] || 'application/octet-stream';
}

// ---- safe import file reading ---------------------------------------------
function resolveImportPath(filePath) {
  if (typeof filePath !== 'string' || !filePath.length) throw error('INVALID_ASSET', 'filePath 必须是字符串');
  const home = os.homedir();
  const allowedRoots = [path.resolve(home), process.env.FIGMA_IMPORT_DIR ? path.resolve(process.env.FIGMA_IMPORT_DIR) : null].filter(Boolean);
  const requested = path.resolve(filePath);
  const real = fs.realpathSync(requested);
  const within = allowedRoots.some(root => {
    const rel = path.relative(root, real);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  });
  if (!within) throw error('INVALID_ASSET', '文件路径必须在用户主目录或显式允许的导入目录内');
  const stat = fs.lstatSync(real);
  if (!stat.isFile()) throw error('INVALID_ASSET', '目标必须是普通文件');
  if (stat.size > LIMITS.RESOURCE_BYTES) throw error('INVALID_ASSET', '文件超过 16MiB 上限');
  // Re-check after open: prevent directory/symlink swap between check and read.
  const fd = fs.openSync(real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const fstat = fs.fstatSync(fd);
    if (!fstat.isFile()) throw error('INVALID_ASSET', '目标在检查后发生变化');
    const bytes = Buffer.alloc(fstat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    if (offset !== bytes.length) throw error('INVALID_ASSET', '文件在读取期间变化');
    return { real, bytes };
  } finally { fs.closeSync(fd); }
}
function readImportBytes(resolved) {
  return resolved.bytes;
}
function sniffAssetHeader(bytes, ext) {
  if (ext === 'svg') {
    const head = bytes.subarray(0, 4096).toString('utf8').trimStart();
    if (!/^<(\?xml|svg)/i.test(head)) throw error('INVALID_ASSET', 'SVG 文件头不合法');
    return { format: 'SVG' };
  }
  if (ext === 'png') {
    const ok = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    if (!ok) throw error('INVALID_ASSET', 'PNG 文件头不合法');
    return { format: 'PNG' };
  }
  const jpegOk = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!jpegOk) throw error('INVALID_ASSET', 'JPEG 文件头不合法');
  return { format: 'JPEG' };
}

// ---- stdio ----------------------------------------------------------------
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
      return { tools: toolsForListing() };
    case 'tools/call':
      if (lifecycle !== 'ready') throw error('NOT_INITIALIZED', '请先完成 initialize 与 notifications/initialized');
      checkParams(params, ['name', 'arguments'], ['name']);
      if (typeof params.name !== 'string' || (own(params, 'arguments') && !plain(params.arguments))) throw error('INVALID_PARAM', '工具名称或 arguments 不合法');
      if (!own(TOOLS, params.name)) throw error('INVALID_PARAM', '未知工具: ' + params.name);
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
    console.log(loadKey(false));
    return;
  }
  await listen(httpServers[0], HOST);
  try { await listen(httpServers[1], IPV6_HOST); }
  catch (e) {
    if (e.code !== 'EAFNOSUPPORT' && e.code !== 'EADDRNOTAVAIL') throw e;
    log('此系统不支持 IPv6 回环地址，当前仅监听 127.0.0.1；localhost 必须可解析到 IPv4。');
  }
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
