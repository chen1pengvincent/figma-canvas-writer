// Oversized-response regression: a write must succeed even when its result is
// too large to fit one signed frame, the connection must survive, and the
// getOperation replay must not loop (the handover incident of 2026-09-09).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { makePlugin, success } from './helpers/figma-vm.js';
import { authProof, frameProof, sign as hmacSign } from '../bridge/auth.js';
import { randomBytes } from 'node:crypto';

const FRAME_LIMIT = 256 * 1024;

test('batch with 50 oversized readbacks: bounded reply, per-step statuses, connection alive', async () => {
  const plugin = await makePlugin();
  const bigText = '汉'.repeat(16000);
  const steps = Array.from({ length: 50 }, (_, i) => ({
    command: 'createNode', params: { type: 'TEXT', text: bigText, name: `step${i}` },
  }));
  const reply = await plugin.send('batch', { steps });
  const bytes = Buffer.byteLength(JSON.stringify(reply), 'utf8');
  assert.ok(bytes <= 220 * 1024, `batch reply ${bytes} bytes must fit one frame budget`);
  const data = success(reply);
  assert.equal(data.state, 'succeeded');
  assert.equal(data.steps.length, 50);
  for (const step of data.steps) {
    assert.equal(step.status, 'succeeded');
    assert.equal(step.data.stepDataOmitted, true, 'huge step data must be slimmed, not dropped');
    assert.ok(step.data.id, 'slimmed steps keep the created node id');
  }
  assert.equal(data.affectedNodeIds.length, 50);
});

test('getOperation replay after a huge batch stays small (no disconnect loop)', async () => {
  const plugin = await makePlugin();
  const bigText = '汉'.repeat(16000);
  await plugin.send('batch', {
    steps: Array.from({ length: 50 }, (_, i) => ({ command: 'createNode', params: { type: 'TEXT', text: bigText, name: `s${i}` } })),
  });
  const replay = await plugin.send('getOperation', { operationId: 'test-operation-1' });
  const bytes = Buffer.byteLength(JSON.stringify(replay), 'utf8');
  assert.ok(bytes <= 220 * 1024, `replay ${bytes} bytes must fit one frame`);
  const data = success(replay);
  assert.equal(data.state, 'succeeded');
  // The replay stays small because per-step slimming already shrank the
  // envelope; per-step statuses (not the full readbacks) are what survive.
  assert.equal(data.result.ok, true);
  const batchResult = data.result.data;
  assert.ok(Array.isArray(batchResult.steps) && batchResult.steps.length === 50);
  assert.ok(batchResult.steps.every(step => step.status === 'succeeded' && step.data.stepDataOmitted === true));
  assert.ok(bytes <= 220 * 1024);
});

test('readField with 100 x 16000-char characters degrades gracefully within budget', async () => {
  const plugin = await makePlugin();
  const ids = [];
  for (let i = 0; i < 100; i++) ids.push(plugin.seed('TEXT', { text: '汉'.repeat(16000) }).id);
  const reply = await plugin.send('readField', { nodeIds: ids, fields: ['characters'] });
  const bytes = Buffer.byteLength(JSON.stringify(reply), 'utf8');
  assert.ok(bytes <= 220 * 1024, `readField reply ${bytes} bytes must fit one frame`);
  const data = success(reply);
  assert.equal(data.truncated, true);
  assert.ok(Array.isArray(data.omittedNodeIds) && data.omittedNodeIds.length > 0);
  assert.ok(data.results.length > 0 && data.results.length < 100, 'must include a bounded prefix of results');
  for (const entry of data.results) {
    const characters = entry.fields.characters;
    assert.ok(characters.status === 'value' || characters.status === 'truncated');
  }
});

test('readField of a node with several large fields stays within budget', async () => {
  const plugin = await makePlugin();
  const node = plugin.seed('TEXT', { text: '汉'.repeat(16000), name: 'A'.repeat(16000) });
  const reply = await plugin.send('readField', { nodeIds: [node.id], fields: ['characters', 'name'] });
  const bytes = Buffer.byteLength(JSON.stringify(reply), 'utf8');
  assert.ok(bytes <= 220 * 1024, `reply ${bytes} bytes must fit one frame`);
  const data = success(reply);
  assert.equal(data.results.length, 1);
  assert.ok(data.results[0].fields.characters.status === 'value' || data.results[0].fields.characters.status === 'truncated');
});

test('UI safety net: an oversized resp becomes a RESPONSE_TOO_LARGE error frame, connection survives', async () => {
  const harness = await makeUiHarness();
  try {
    const ws = await harness.connect();
    const { connectionId } = await harness.authenticate(ws);
    // 投一条已签名命令让 UI 登记在途执行，再回超大结果（真实场景：批量写入的巨大读回）。
    const connection = harness.eval('connection');
    const cmd = { type: 'cmd', id: 'big-write', sessionId: uiContext.sessionId, pageId: uiContext.pageId,
      pageRevision: uiContext.pageRevision, command: 'getContext', params: { limit: 5 } };
    ws.onmessage({ data: JSON.stringify({ type: 'frame', connectionId, seq: 1, payload: cmd,
      mac: harness.signOf(frameProof('server', connectionId, 1, cmd)) }) });
    await connection.receiveQueue;
    const huge = '汉'.repeat(300 * 1024);
    harness.main({ type: 'exec_result', id: 'big-write', ok: true, data: { state: 'succeeded', blob: huge } });
    await connection.sendQueue;
    assert.equal(ws.readyState, 1, 'the connection must survive an oversized result');
    const sent = ws.sent.at(-1);
    assert.equal(sent.payload.type, 'resp');
    assert.equal(sent.payload.id, 'big-write');
    assert.equal(sent.payload.ok, false);
    assert.equal(sent.payload.error.code, 'RESPONSE_TOO_LARGE');
    const frameBytes = Buffer.byteLength(JSON.stringify(sent), 'utf8');
    assert.ok(frameBytes <= FRAME_LIMIT, `error frame ${frameBytes} must fit the frame limit`);
  } finally {
    harness.sandbox = null;
  }
});

// ---- minimal UI harness (same pattern as ui.auth.test.mjs) ------------------
const uiKey = 'ef'.repeat(32);
const uiContext = { sessionId: 'ui-oversize', runId: 'ui-run', pageId: '20:1', pageName: '页面', fileName: '文件', editorType: 'figma', pageRevision: 0 };

async function makeUiHarness() {
  const html = await readFile(new URL('../plugin/ui.html', import.meta.url), 'utf8');
  const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), m => m[1]);
  const script = scripts.find(source => source.includes("const BRIDGE_URL ="));
  const cryptoBlock = html.match(/<!-- FCW_CRYPTO_BEGIN -->([\s\S]*?)<!-- FCW_CRYPTO_END -->/);
  const cryptoScript = Array.from(cryptoBlock[1].matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g), m => m[1]).join('\n');
  const { webcrypto } = await import('node:crypto');
  const elements = new Map();
  const sockets = [];
  const mainMessages = [];
  const parent = { postMessage: m => mainMessages.push(m.pluginMessage) };
  const element = id => {
    if (!elements.has(id)) elements.set(id, { style: {}, value: '', textContent: '', className: '', addEventListener() {} });
    return elements.get(id);
  };
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 1; this.sent = []; sockets.push(this); }
    send(text) { this.sent.push(JSON.parse(text)); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const top = {};
  const sandbox = {
    parent, window: { top }, document: { getElementById: element },
    WebSocket: FakeWS, crypto: { getRandomValues: bytes => webcrypto.getRandomValues(bytes) },
    isSecureContext: false, TextEncoder, TextDecoder, Uint8Array,
    setTimeout, clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(cryptoScript, sandbox);
  vm.runInContext(script, sandbox);
  const { createHmac } = await import('node:crypto');
  const canonical = value => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(v => canonical(v)).join(',') + ']';
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  };
  const signOf = value => createHmac('sha256', Buffer.from(uiKey, 'hex')).update(canonical(value), 'utf8').digest('hex');
  const harness = {
    signOf, sandbox, sockets, mainMessages, element, parent,
    eval: code => vm.runInContext(code, sandbox),
    main: msg => sandbox.window.onmessage({ source: top, origin: 'https://www.figma.com', data: { pluginMessage: msg } }),
    async connect() {
      // Mirror ui.auth.test.mjs: init -> setKey -> open socket.
      harness.main({ type: 'init', context: uiContext });
      await harness.eval('setKey(' + JSON.stringify(uiKey) + ', false)');
      const ws = sockets.at(-1);
      ws.onopen?.();
      return ws;
    },
    async authenticate(ws) {
      // Deliver the challenge; the UI answers with a signed auth message.
      const serverNonce = randomBytes(32).toString('hex');
      const c = harness.eval('connection');
      ws.onmessage({ data: JSON.stringify({ type: 'challenge', protocol: 3, serverNonce }) });
      await c.receiveQueue;
      const auth = ws.sent.find(f => f.type === 'auth');
      assert.ok(auth, 'UI must send auth');
      assert.equal(auth.protocol, 3);
      const connectionId = randomBytes(32).toString('hex');
      ws.onmessage({ data: JSON.stringify({ type: 'auth_ack', protocol: 3, ok: true, connectionId,
        proof: signOf(authProof('server-auth', serverNonce, auth.clientNonce, auth.context, connectionId)) }) });
      await c.receiveQueue;
      assert.equal(harness.element('statusText').textContent, '已授权');
      return { connectionId };
    },
  };
  return harness;
}
