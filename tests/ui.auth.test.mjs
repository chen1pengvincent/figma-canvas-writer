// Actual offline crypto bundle in the observed opaque-iframe environment (no subtle).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto, randomBytes } from 'node:crypto';
import { AUTH_PROTOCOL, sign, verify, authProof, frameProof } from '../bridge/auth.js';

const html = fs.readFileSync(new URL('../plugin/ui.html', import.meta.url), 'utf8');
const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), match => match[1]);
const script = scripts.find(source => source.includes("const BRIDGE_URL ="));
const cryptoBlock = html.match(/<!-- FCW_CRYPTO_BEGIN -->([\s\S]*?)<!-- FCW_CRYPTO_END -->/);
const cryptoScript = cryptoBlock && Array.from(cryptoBlock[1].matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g), match => match[1]).join('\n');
const key = 'cd'.repeat(32);
const baseContext = { sessionId: 'ui-session', pageId: '10:1', pageName: '页面一', fileName: '测试文件', editorType: 'figma' };
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
    crypto: options.noRandom ? {} : { getRandomValues: bytes => webcrypto.getRandomValues(bytes) }, isSecureContext: false, TextEncoder, Uint8Array,
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
    assert(verify(key, authProof('client-auth', serverNonce, auth.clientNonce, auth.context), auth.proof));
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
const readCmd = id => ({ type: 'cmd', id, sessionId: baseContext.sessionId, pageId: baseContext.pageId, command: 'getContext', params: { limit: 5 } });

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
