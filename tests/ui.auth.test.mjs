// Actual offline crypto bundle in the observed opaque-iframe environment (no subtle).
// Protocol 3: runId/pageRevision context, pageRevision-bearing cmd frames and the
// UI-side chunk transfer paths (outbound upload window, inbound import assembly).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto, randomBytes, createHash } from 'node:crypto';
import { AUTH_PROTOCOL, sign, verify, authProof, frameProof } from '../bridge/auth.js';

const html = fs.readFileSync(new URL('../plugin/ui.html', import.meta.url), 'utf8');
const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), match => match[1]);
const script = scripts.find(source => source.includes("const BRIDGE_URL ="));
const cryptoBlock = html.match(/<!-- FCW_CRYPTO_BEGIN -->([\s\S]*?)<!-- FCW_CRYPTO_END -->/);
const cryptoScript = cryptoBlock && Array.from(cryptoBlock[1].matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g), match => match[1]).join('\n');
const key = 'cd'.repeat(32);
const baseContext = { sessionId: 'ui-session', runId: 'ui-run', pageId: '10:1', pageName: '页面一', fileName: '测试文件', editorType: 'figma', pageRevision: 0 };
function harness(options = {}) {
  const elements = new Map();
  const mainMessages = [];
  const sockets = [];
  const timers = new Set();
  const top = {};
  const parent = { parent: {}, postMessage: m => mainMessages.push(m.pluginMessage) };
  const element = id => {
    if (!elements.has(id)) elements.set(id, { style: {}, value: '', textContent: '', className: '', addEventListener(event, fn) { this[event] = fn; } });
    return elements.get(id);
  };
  class FakeWS {
    constructor(url) { assert.equal(url, 'ws://localhost:9753/plugin'); this.url = url; this.readyState = 1; this.sent = []; sockets.push(this); }
    send(text) { this.sent.push(JSON.parse(text)); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const sandbox = {
    parent, window: { top }, document: { getElementById: element }, WebSocket: FakeWS,
    crypto: options.noRandom ? {} : { getRandomValues: bytes => webcrypto.getRandomValues(bytes) }, isSecureContext: false,
    TextEncoder, TextDecoder, Uint8Array,
    setTimeout(fn) { const t = { fn }; timers.add(t); return t; },
    clearTimeout(t) { timers.delete(t); },
  };
  assert(cryptoScript, 'Actual generated inline FCWCrypto bundle is required');
  vm.createContext(sandbox); vm.runInContext(cryptoScript, sandbox); vm.runInContext(script, sandbox);
  const h = { sandbox, sockets, mainMessages, element, timers, top, parent };
  h.eval = code => vm.runInContext(code, sandbox);
  h.main = msg => sandbox.window.onmessage({ source: top, origin: 'https://www.figma.com', data: { pluginMessage: msg } });
  h.connect = async () => {
    h.main({ type: 'init', context: baseContext });
    await h.eval('setKey(' + JSON.stringify(key) + ', false)');
    const ws = sockets.at(-1); ws.onopen?.(); return ws;
  };
  h.receive = async (ws, msg) => {
    const c = h.eval('connection');
    ws.onmessage({ data: JSON.stringify(msg) });
    await c.receiveQueue;
  };
  h.authenticate = async ws => {
    const serverNonce = randomBytes(32).toString('hex');
    await h.receive(ws, { type: 'challenge', protocol: AUTH_PROTOCOL, serverNonce });
    const auth = ws.sent.at(-1);
    assert.equal(auth.type, 'auth');
    assert.equal(auth.protocol, AUTH_PROTOCOL);
    assert(verify(key, authProof('client-auth', serverNonce, auth.clientNonce, auth.context), auth.proof));
    assert.equal(auth.context.pageRevision, baseContext.pageRevision);
    assert.equal(auth.context.runId, baseContext.runId);
    const connectionId = randomBytes(32).toString('hex');
    await h.receive(ws, { type: 'auth_ack', protocol: AUTH_PROTOCOL, ok: true, connectionId,
      proof: sign(key, authProof('server-auth', serverNonce, auth.clientNonce, auth.context, connectionId)) });
    return { connectionId, auth, serverNonce };
  };
  h.frame = (info, seq, payload) => ({
    type: 'frame', connectionId: info.connectionId, seq, payload,
    mac: sign(key, frameProof('server', info.connectionId, seq, payload)),
  });
  return h;
}
const readCmd = id => ({ type: 'cmd', id, sessionId: baseContext.sessionId, pageId: baseContext.pageId, pageRevision: baseContext.pageRevision, command: 'getContext', params: { limit: 5 } });
const chunkPayloads = ws => ws.sent.filter(x => x.type === 'frame' && x.payload.type === 'chunk').map(x => x.payload);
const ackPayloads = ws => ws.sent.filter(x => x.type === 'frame' && x.payload.type === 'chunk_ack').map(x => x.payload);
const sha256hex = bytes => createHash('sha256').update(bytes).digest('hex');
const pngBytes = size => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(size - 8, 7)]);
const delay = ms => new Promise(r => setTimeout(r, ms));

test('UI actual offline bundle without subtle authenticates Node HMAC proof; authentic frame and signed result work', async () => {
  const h = harness(); const ws = await h.connect(); const info = await h.authenticate(ws);
  assert.equal(h.eval('typeof crypto.subtle'), 'undefined');
  assert.equal(h.eval('isSecureContext'), false);
  assert.equal(h.element('statusText').textContent, '已授权');
  assert(!JSON.stringify(ws.sent).includes(key));
  const cmd = readCmd('read-1');
  await h.receive(ws, h.frame(info, 1, cmd));
  const exec = h.mainMessages.find(x => x.type === 'exec');
  assert.equal(exec.id, cmd.id); assert.equal(exec.sessionId, cmd.sessionId); assert.equal(exec.pageId, cmd.pageId);
  assert.equal(exec.pageRevision, cmd.pageRevision, 'exec must forward the pageRevision target');
  const c = h.eval('connection');
  h.main({ type: 'exec_result', id: cmd.id, ok: false, error: { code: 'TEST', message: '真实错误', state: 'partial', affectedNodeIds: ['10:3'], details: { why: 'test' } } });
  await c.sendQueue;
  const frame = ws.sent.at(-1);
  assert(verify(key, frameProof('client', info.connectionId, 1, frame.payload), frame.mac));
  assert.equal(frame.payload.error.state, 'partial');
  assert.deepEqual(frame.payload.error.affectedNodeIds, ['10:3']);
});

test('UI rejects cmd before authentication and forged server proof', async () => {
  const h = harness(); const ws = await h.connect();
  await h.receive(ws, readCmd('unauthenticated'));
  assert.equal(h.mainMessages.filter(x => x.type === 'exec').length, 0);
  assert.equal(ws.readyState, 3);
  const q = harness(); const other = await q.connect();
  const serverNonce = randomBytes(32).toString('hex');
  await q.receive(other, { type: 'challenge', protocol: AUTH_PROTOCOL, serverNonce });
  await q.receive(other, { type: 'auth_ack', protocol: AUTH_PROTOCOL, ok: true, connectionId: '1'.repeat(64), proof: '0'.repeat(64) });
  assert.equal(other.readyState, 3);
  assert.equal(q.mainMessages.filter(x => x.type === 'exec').length, 0);
  assert.equal(q.element('statusText').textContent, '连接未获授权');
});

test('UI replay or altered authenticated frame is rejected before a second execution', async () => {
  const h = harness(); const ws = await h.connect(); const info = await h.authenticate(ws);
  const frame = h.frame(info, 1, readCmd('once'));
  await h.receive(ws, frame);
  await h.receive(ws, frame);
  assert.equal(h.mainMessages.filter(x => x.type === 'exec').length, 1);
  assert.equal(ws.readyState, 3);
  const q = harness(); const w = await q.connect(); const info2 = await q.authenticate(w);
  const tampered = q.frame(info2, 1, readCmd('tamper')); tampered.payload.params.limit = 99;
  await q.receive(w, tampered);
  assert.equal(q.mainMessages.filter(x => x.type === 'exec').length, 0);
});

test('UI rejects an authenticated cmd whose pageRevision lags the bound context', async () => {
  const h = harness(); const ws = await h.connect(); const info = await h.authenticate(ws);
  const stale = { ...readCmd('stale-revision'), pageRevision: baseContext.pageRevision + 5 };
  await h.receive(ws, h.frame(info, 1, stale));
  assert.equal(h.mainMessages.filter(x => x.type === 'exec').length, 0);
  assert.equal(ws.readyState, 3, 'a stale pageRevision target must disconnect the UI');
});

test('UI binds result to original connection generation; late result is dropped after network reconnect', async () => {
  const h = harness(); const ws = await h.connect(); const info = await h.authenticate(ws);
  await h.receive(ws, h.frame(info, 1, readCmd('old-call')));
  ws.close();
  h.element('connectBtn').click();
  const next = h.sockets.at(-1); assert.notEqual(next, ws);
  await h.authenticate(next);
  const before = next.sent.length;
  h.main({ type: 'exec_result', id: 'old-call', ok: true, data: { old: true } });
  assert.equal(next.sent.length, before);
  assert.equal(h.eval('context.sessionId'), baseContext.sessionId, 'network reconnect must retain operation registry session');
  assert.equal(h.mainMessages.filter(x => x.type === 'revoke').length, 0);
});

test('UI manual disconnect/forget revoke main authorization and never auto-connect on returned context', async () => {
  const h = harness(); const ws = await h.connect(); await h.authenticate(ws);
  h.element('disconnectBtn').click();
  assert.equal(h.mainMessages.at(-1).type, 'revoke');
  const count = h.sockets.length;
  h.main({ type: 'context', context: { ...baseContext, sessionId: 'revoked-session' } });
  assert.equal(h.sockets.length, count);
  assert.equal(h.eval('wantConnected'), false);
  h.element('connectBtn').click();
  assert.equal(h.sockets.length, count + 1);
  h.element('forgetBtn').click();
  assert.equal(h.eval('cryptoKey'), null);
  assert.equal(h.eval('token'), '');
  assert.deepEqual(h.mainMessages.slice(-2).map(x => x.type), ['revoke', 'clearToken']);
  h.main({ type: 'context', context: { ...baseContext, sessionId: 'revoked-again' } });
  assert.equal(h.sockets.length, count + 1);
  assert.equal(h.element('pairArea').style.display, '');
});

test('UI context changes close authenticated connection; foreign parent messages cannot cause execution', async () => {
  const h = harness(); const ws = await h.connect(); await h.authenticate(ws);
  h.main({ type: 'context', context: { ...baseContext, pageId: '10:2', pageName: '页面二' } });
  assert.equal(ws.readyState, 3);
  const next = h.sockets.at(-1); assert.notEqual(next, ws);
  assert.equal(h.eval('connection.context.pageId'), '10:2');
  const count = next.sent.length;
  h.sandbox.window.onmessage({ source: {}, data: { pluginMessage: { type: 'exec_result', id: 'anything', ok: true, data: {} } } });
  assert.equal(next.sent.length, count);
});

test('UI accepts only Figma HTTPS editor top window in the observed deeply nested iframe model', async () => {
  const h = harness(); const ws = await h.connect(); const info = await h.authenticate(ws);
  assert.notEqual(h.top, h.parent);
  assert.notEqual(h.top, h.parent.parent);
  assert.notEqual(h.top, h.sandbox.window);
  await h.receive(ws, h.frame(info, 1, readCmd('source-bound-result')));
  const before = ws.sent.length;
  const fakeResult = { type: 'exec_result', id: 'source-bound-result', ok: true, data: { forged: true } };
  for (const event of [
    { source: h.top, origin: 'https://untrusted.example' },
    { source: h.top, origin: 'http://www.figma.com' },
    { source: h.top, origin: 'null' },
    { source: h.parent, origin: 'https://www.figma.com' },
    { source: h.parent.parent, origin: 'https://www.figma.com' },
    { source: h.sandbox.window, origin: 'https://www.figma.com' },
    { source: null, origin: 'https://www.figma.com' },
  ]) h.sandbox.window.onmessage({ ...event, data: { pluginMessage: fakeResult } });
  assert.equal(ws.sent.length, before);
  assert.equal(h.eval('executions.has("source-bound-result")'), true);
  const c = h.eval('connection');
  h.sandbox.window.onmessage({ source: h.top, origin: 'https://figma.com', data: { pluginMessage: { ...fakeResult, data: { trusted: true } } } });
  await c.sendQueue;
  assert.equal(ws.sent.length, before + 1);
  assert.deepEqual(ws.sent.at(-1).payload.data, { trusted: true });
});

test('UI offline bundle never substitutes an insecure random source when getRandomValues is missing', async () => {
  const h = harness({ noRandom: true });
  h.main({ type: 'init', context: baseContext });
  await assert.rejects(h.eval('setKey(' + JSON.stringify(key) + ', false)'), /安全随机数/);
  assert.equal(h.sockets.length, 0);
});

test('UI transfer_upload splits 64KiB chunks with a first-block header and honors the 4-unacked window', async () => {
  const h = harness(); const ws = await h.connect(); const info = await h.authenticate(ws);
  const raw = pngBytes(300 * 1024);
  const sha = sha256hex(raw);
  const transferId = 'ab'.repeat(16);
  h.main({ type: 'transfer_upload', id: 'up-1', transferId, operationId: 'exp-1', totalBytes: raw.length, data: raw.toString('base64') });
  await h.eval('connection.sendQueue');
  let chunks = chunkPayloads(ws);
  assert.equal(chunks.length, 4, 'only 4 unacked chunks may be in flight initially');
  const first = chunks[0];
  assert.equal(first.transferId, transferId);
  assert.equal(first.index, 0);
  assert.equal(first.done, false);
  assert.equal(first.operationId, 'exp-1', 'first chunk must carry the header');
  assert.equal(first.totalBytes, raw.length);
  assert.equal(first.totalSha256, sha);
  assert.equal(Buffer.from(first.data, 'base64').length, 64 * 1024);
  for (const [i, chunk] of chunks.entries()) assert.equal(chunk.index, i);
  const ack = h.frame(info, 1, { type: 'chunk_ack', transferId, index: 0 });
  await h.receive(ws, ack);
  await h.eval('connection.sendQueue');
  chunks = chunkPayloads(ws);
  assert.equal(chunks.length, 5, 'acknowledging one chunk must open the window for the next');
  assert.equal(chunks[4].index, 4);
  assert.equal(chunks[4].done, true, 'last chunk must carry done');
  assert.equal(Buffer.from(chunks[4].data, 'base64').length, raw.length - 4 * 64 * 1024);
  for (const index of [1, 2, 3, 4]) await h.receive(ws, h.frame(info, index + 1, { type: 'chunk_ack', transferId, index }));
  await h.eval('connection.sendQueue');
  const assembled = Buffer.concat(chunkPayloads(ws).map(c => Buffer.from(c.data, 'base64')));
  assert(assembled.equals(raw), 'reassembled chunks must equal the uploaded bytes');
  const done = h.mainMessages.find(x => x.type === 'transfer_upload_done');
  assert(done, 'a fully acknowledged transfer must report completion to the main thread');
  assert.equal(done.id, 'up-1');
  assert.equal(done.ok, true);
});

test('UI stops sending outbound chunks when the connection drops mid-transfer', async () => {
  const h = harness(); const ws = await h.connect(); const info = await h.authenticate(ws);
  const raw = pngBytes(300 * 1024);
  const transferId = 'cd'.repeat(16);
  h.main({ type: 'transfer_upload', id: 'up-mid', transferId, operationId: 'exp-2', totalBytes: raw.length, data: raw.toString('base64') });
  const c = h.eval('connection');
  await c.sendQueue;
  assert.equal(chunkPayloads(ws).length, 4);
  ws.close();
  const before = ws.sent.length;
  ws.onmessage({ data: JSON.stringify(h.frame(info, 1, { type: 'chunk_ack', transferId, index: 0 })) });
  await c.receiveQueue;
  await delay(20);
  assert.equal(ws.sent.length, before, 'no further chunks may be sent after disconnect');
  assert(!h.mainMessages.some(x => x.type === 'transfer_upload_done' && x.ok === true), 'an abandoned transfer must not report success');
});

test('UI assembles importAsset chunks, acks every block and forwards import_asset_request after sha256 verification', async () => {
  const h = harness(); const ws = await h.connect(); const info = await h.authenticate(ws);
  const raw = pngBytes(100 * 1024);
  const sha = sha256hex(raw);
  const transferId = 'ef'.repeat(16);
  const cmd = { type: 'cmd', id: 'imp-1', sessionId: baseContext.sessionId, pageId: baseContext.pageId, pageRevision: baseContext.pageRevision,
    operationId: 'imp-1', command: 'importAsset', params: { transferId, totalBytes: raw.length, totalSha256: sha, format: 'PNG', fileName: 'a.png' } };
  await h.receive(ws, h.frame(info, 1, cmd));
  assert(!h.mainMessages.some(x => x.type === 'import_asset_request'), 'no request before the transfer completes');
  const parts = [raw.subarray(0, 64 * 1024), raw.subarray(64 * 1024)];
  await h.receive(ws, h.frame(info, 2, { type: 'chunk', transferId, index: 0, data: parts[0].toString('base64'), done: false }));
  await h.eval('connection.sendQueue');
  assert.deepEqual(ackPayloads(ws), [{ type: 'chunk_ack', transferId, index: 0 }]);
  await h.receive(ws, h.frame(info, 3, { type: 'chunk', transferId, index: 1, data: parts[1].toString('base64'), done: true }));
  await h.eval('connection.sendQueue');
  assert.deepEqual(ackPayloads(ws), [
    { type: 'chunk_ack', transferId, index: 0 },
    { type: 'chunk_ack', transferId, index: 1 },
  ]);
  const req = h.mainMessages.find(x => x.type === 'import_asset_request');
  assert(req, 'verified transfer must be forwarded to the main thread');
  assert.equal(req.id, 'imp-1');
  assert.equal(req.sessionId, baseContext.sessionId);
  assert.equal(req.pageId, baseContext.pageId);
  assert.equal(req.pageRevision, baseContext.pageRevision);
  assert.equal(req.operationId, 'imp-1');
  assert.equal(req.params.transferId, transferId);
  assert.equal(req.params.totalBytes, raw.length);
  assert.equal(req.params.totalSha256, sha);
  assert.equal(req.params.format, 'PNG');
  assert.equal(req.params.fileName, 'a.png');
  assert.equal(Buffer.from(req.params.assetBase64, 'base64').equals(raw), true, 'assetBase64 must be the reassembled asset');
});

test('UI disconnects when the importAsset chunk stream fails the sha256 check', async () => {
  const h = harness(); const ws = await h.connect(); const info = await h.authenticate(ws);
  const raw = pngBytes(4096);
  const transferId = '12'.repeat(16);
  const cmd = { type: 'cmd', id: 'imp-bad', sessionId: baseContext.sessionId, pageId: baseContext.pageId, pageRevision: baseContext.pageRevision,
    operationId: 'imp-bad', command: 'importAsset', params: { transferId, totalBytes: raw.length, totalSha256: 'f'.repeat(64), format: 'PNG', fileName: 'bad.png' } };
  const c = h.eval('connection');
  await h.receive(ws, h.frame(info, 1, cmd));
  ws.onmessage({ data: JSON.stringify(h.frame(info, 2, { type: 'chunk', transferId, index: 0, data: raw.toString('base64'), done: true })) });
  await c.receiveQueue;
  await delay(20);
  assert.equal(ws.readyState, 3, 'hash mismatch must fail closed');
  assert(!h.mainMessages.some(x => x.type === 'import_asset_request'));
});

test('UI ignores chunk_ack for unknown transfers without breaking the connection', async () => {
  const h = harness(); const ws = await h.connect(); const info = await h.authenticate(ws);
  await h.receive(ws, h.frame(info, 1, { type: 'chunk_ack', transferId: 'ff'.repeat(16), index: 3 }));
  assert.equal(ws.readyState, 1, 'unknown transfer acknowledgements must be ignored');
  assert.equal(h.element('statusText').textContent, '已授权');
  await h.receive(ws, h.frame(info, 2, readCmd('still-alive')));
  assert(h.mainMessages.find(x => x.type === 'exec' && x.id === 'still-alive'), 'the connection must stay usable');
});
