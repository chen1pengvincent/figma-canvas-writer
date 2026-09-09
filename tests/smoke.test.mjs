// Doctor, relay and smoke coverage without Figma. Smoke's positive path runs
// against a fake HMAC plugin peer (same pattern as bridge-transfer tests).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { AUTH_PROTOCOL, sign, verify, authProof, frameProof } from '../bridge/auth.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  return (async () => {
    while (Date.now() < end) { const value = fn(); if (value) return value; await new Promise(r => setTimeout(r, 25)); }
    throw new Error('until 超时');
  })();
}
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

// ---- doctor ----------------------------------------------------------------
test('doctor: read-only checks classify healthy temp env with exit 0', async () => {
  const home = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fcw-doctor-'));
  await fs.promises.writeFile(path.join(home, 'bridge-token'), 'ab'.repeat(32));
  const port = await freePort();
  const { doctor } = await import('../scripts/doctor.mjs');
  const report = await doctor({
    env: { ...process.env, FIGMA_BRIDGE_HOME: home },
    port,
    nodeVersion: process.versions.node,
  });
  assert.equal(report.exitCode, 0, JSON.stringify(report.checks, null, 2));
  const byId = Object.fromEntries(report.checks.map(check => [check.id, check]));
  assert.equal(byId.node.status, 'ok');
  assert.equal(byId.key.status, 'ok');
  await fs.promises.rm(home, { recursive: true, force: true });
});

test('doctor: invalid key and old node fail blocking', async () => {
  const home = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fcw-doctor-'));
  await fs.promises.writeFile(path.join(home, 'bridge-token'), 'not-a-key');
  const port = await freePort();
  const { doctor } = await import('../scripts/doctor.mjs');
  const badKey = await doctor({ env: { FIGMA_BRIDGE_HOME: home }, nodeVersion: process.versions.node, port });
  assert.equal(badKey.exitCode, 2);
  assert.ok(badKey.checks.some(check => check.id === 'key' && check.status === 'fail'));
  const oldNode = await doctor({ env: { FIGMA_BRIDGE_HOME: home }, nodeVersion: '18.20.0', port });
  assert.equal(oldNode.exitCode, 2);
  assert.ok(oldNode.checks.some(check => check.id === 'node' && check.status === 'fail'));
  await fs.promises.rm(home, { recursive: true, force: true });
});

test('doctor: occupant probe classifies a real v3 bridge through a socket', async () => {
  const port = await freePort();
  const server = net.createServer(socket => {
    socket.on('data', chunk => {
      if (chunk.toString('latin1').includes('Upgrade: websocket')) {
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
          'Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n');
        const payload = Buffer.from(JSON.stringify({ type: 'challenge', protocol: AUTH_PROTOCOL, serverNonce: 'ab'.repeat(32) }));
        socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
      }
    });
  });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  try {
    const { checkPort } = await import('../scripts/doctor.mjs');
    const result = await checkPort(port);
    assert.equal(result.status, 'ok', JSON.stringify(result));
    assert.match(result.detail, /协议 3/);
  } finally {
    server.close();
  }
});

// ---- relay -----------------------------------------------------------------
test('relay: forwards bytes over the loopback and logs bind degradation', async () => {
  const target = net.createServer(socket => socket.end('pong'));
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  const targetPort = target.address().port;
  const relayPort = await freePort();
  const relay = spawn(process.execPath,
    [path.join(root, 'scripts', 'relay.mjs'), String(relayPort), '127.0.0.1', String(targetPort)],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  relay.stderr.on('data', chunk => { stderr += chunk; });
  let stdout = '';
  relay.stdout.on('data', chunk => { stdout += chunk; });
  try {
    await until(() => stdout.includes('已监听'));
    const answer = await new Promise(resolve => {
      const socket = net.connect(relayPort, '127.0.0.1', () => socket.write('ping'));
      socket.on('data', data => { resolve(data.toString()); socket.destroy(); });
      socket.on('error', resolve);
    });
    assert.equal(answer, 'pong');
  } finally {
    relay.kill();
    target.close();
  }
});

// ---- smoke (fake plugin peer) ----------------------------------------------
const key = 'cd'.repeat(32);
const context = { sessionId: 'smoke-session', runId: 'smoke-run', pageId: '1:2',
  pageName: 'Smoke Page', fileName: 'Smoke File', editorType: 'figma', pageRevision: 0 };

async function smokeFixture({ denyAuth = false } = {}) {
  const home = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fcw-smoke-'));
  await fs.promises.writeFile(path.join(home, 'bridge-token'), key, { mode: 0o600 });
  const port = await freePort();
  const env = { ...process.env, NODE_ENV: 'test', FIGMA_BRIDGE_HOME: home, FIGMA_BRIDGE_TEST_PORT: String(port), FIGMA_BRIDGE_TIMEOUT_MS: '6000' };
  delete env.FIGMA_BRIDGE_PORT;
  const child = spawn(process.execPath, [path.join(root, 'bridge', 'mcp-bridge.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  await until(() => stderr.includes('MCP stdio 已就绪') || child.exitCode !== null);
  assert.equal(child.exitCode, null, stderr);
  let seq = 0;
  const pending = new Map();
  const { createInterface } = await import('node:readline');
  createInterface({ input: child.stdout }).on('line', raw => {
    let message; try { message = JSON.parse(raw); } catch { return; }
    if (message.id !== undefined && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  });
  const call = async (name, args) => {
    const response = await rpc('tools/call', { name, arguments: args });
    if (!response.result) throw new Error('RPC 错误: ' + JSON.stringify(response.error || response));
    return JSON.parse(response.result.content[0].text);
  };
  function rpc(method, params = {}) {
    return new Promise(resolve => {
      const id = ++seq;
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  // Fake plugin peer: authenticates, then auto-answers every command as it
  // arrives (the bridge waits for the plugin resp before answering MCP).
  const { WebSocket } = createRequire(path.join(root, 'bridge', 'package.json'))('ws');
  const ws = new WebSocket('ws://127.0.0.1:' + port + '/plugin', { origin: 'null' });
  const peer = { messages: [], connectionId: null, seq: 0 };
  ws.on('message', raw => {
    const message = JSON.parse(raw.toString());
    peer.messages.push(message);
    if (message.type === 'auth_ack' && message.ok) peer.connectionId = message.connectionId;
    if (message.type === 'frame' && peer.connectionId) {
      const payload = message.payload;
      if (payload.command && !payload._answered) {
        payload._answered = true;
        peer.frame({ type: 'resp', id: payload.id, ok: true, data: respondTo(payload) });
      }
    }
  });
  function respondTo(payload) {
    switch (payload.command) {
      case 'ping': return { pong: true, ...context };
      case 'createNode': return { id: '9:91', name: payload.params.name, state: 'succeeded' };
      case 'getScreenshot': {
        const png = Buffer.alloc(64, 0x5a); png[0] = 0x89; png[1] = 0x50; png[2] = 0x4e; png[3] = 0x47;
        return { inline: true, format: 'PNG', mime: 'image/png', width: 120, height: 80, bytes: png.length,
          data: 'data:image/png;base64,' + png.toString('base64') };
      }
      case 'deleteNode': return { id: payload.params.id, deleted: true };
      default: return {};
    }
  }
  await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fcw3-smoke-test', version: '3.1.0' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
  await new Promise(resolve => ws.on('open', resolve));
  await until(() => peer.messages.find(m => m.type === 'challenge'));
  const challenge = peer.messages.find(m => m.type === 'challenge');
  peer.frame = payload => {
    const frame = { type: 'frame', connectionId: peer.connectionId, seq: ++peer.seq, payload,
      mac: sign(key, frameProof('client', peer.connectionId, peer.seq, payload)) };
    ws.send(JSON.stringify(frame));
  };
  const clientNonce = randomBytes(32).toString('hex');
  ws.send(JSON.stringify({ type: 'auth', protocol: AUTH_PROTOCOL, serverNonce: challenge.serverNonce,
    clientNonce, context, proof: sign(key, authProof('client-auth', challenge.serverNonce, clientNonce, context)) }));
  await until(() => peer.messages.find(m => m.type === 'auth_ack'));
  const ack = peer.messages.find(m => m.type === 'auth_ack');
  assert.ok(ack.ok, 'fake peer must authenticate');
  if (denyAuth) ws.close();
  const stop = async () => {
    child.stdin.end();
    await Promise.race([once(child, 'exit'), new Promise(r => setTimeout(r, 1500))]);
    ws.terminate();
    await fs.promises.rm(home, { recursive: true, force: true });
  };
  return { call, stop, peer };
}

test('smoke: five steps pass against a fake authorized plugin', async () => {
  const fixture = await smokeFixture();
  try {
    const { runSmoke } = await import('../scripts/smoke.mjs');
    const report = await runSmoke({ call: fixture.call, authorizedTimeoutMs: 8000 });
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.ok(report.results.every(result => result.status === 'PASS'), JSON.stringify(report));
    assert.match(report.results.map(r => r.name).join(','), /figma_create_node/);
    assert.match(report.results.map(r => r.name).join(','), /figma_get_screenshot/);
    assert.ok(report.screenshot.inline === true);
  } finally {
    await fixture.stop();
  }
});

test('smoke: unauthorized environment fails with NOT_AUTHORIZED', async () => {
  const fixture = await smokeFixture({ denyAuth: true });
  try {
    const { runSmoke } = await import('../scripts/smoke.mjs');
    const report = await runSmoke({ call: fixture.call, authorizedTimeoutMs: 3000 });
    assert.equal(report.ok, false);
    assert.equal(report.error.code, 'NOT_AUTHORIZED');
  } finally {
    await fixture.stop();
  }
});
