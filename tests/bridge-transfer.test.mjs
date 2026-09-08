// Bridge-side chunk transfer, artifact and job coverage: real stdio child process
// plus a fake HMAC peer, exercising both directions of the protocol 3 resource
// channel, integrity failures, control capacity and capability discovery.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { AUTH_PROTOCOL, sign, verify, authProof, frameProof } from '../bridge/auth.js';
import { TOOLS } from '../shared/tool-registry.js';
const { WebSocket } = createRequire(new URL('../bridge/package.json', import.meta.url))('ws');
const entry = fileURLToPath(new URL('../bridge/mcp-bridge.js', import.meta.url));
const key = 'ab'.repeat(32);
const context = { sessionId: 'test-session', runId: 'test-run', pageId: '1:2', pageName: '测试页', fileName: '模拟文件', editorType: 'figma', pageRevision: 0 };
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = fn(); if (value) return value; await delay(5); }
  throw new Error('test timed out');
}
async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(r => server.close(r)); return port;
}
async function fixture(options = {}) {
  const home = realpathSync(await fs.mkdtemp(path.join(os.tmpdir(), 'figma-bridge-transfer-')));
  await fs.writeFile(path.join(home, 'bridge-token'), key, { mode: 0o600 });
  const port = await freePort();
  const env = { ...process.env, NODE_ENV: 'test', FIGMA_BRIDGE_HOME: home, FIGMA_IMPORT_DIR: home, FIGMA_BRIDGE_TEST_PORT: String(port), FIGMA_BRIDGE_TIMEOUT_MS: String(options.timeout || 500) };
  delete env.FIGMA_BRIDGE_PORT;
  const f = { home, port, env, messages: [], stderr: '', seq: 0, peers: [] };
  f.child = spawn(process.execPath, [entry], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  f.exited = once(f.child, 'exit');
  createInterface({ input: f.child.stdout }).on('line', line => f.messages.push(JSON.parse(line)));
  f.child.stderr.on('data', x => { f.stderr += x; });
  await until(() => f.stderr.includes('MCP stdio 已就绪') || f.child.exitCode !== null);
  assert.equal(f.child.exitCode, null, f.stderr);
  f.send = msg => f.child.stdin.write(JSON.stringify(msg) + '\n');
  f.rpc = async (method, params = {}, id = ++f.seq) => {
    f.send({ jsonrpc: '2.0', id, method, params });
    return until(() => f.messages.find(m => !Array.isArray(m) && m.id === id));
  };
  f.init = async () => {
    const r = await f.rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test-client', version: '1' } });
    f.send({ jsonrpc: '2.0', method: 'notifications/initialized', params: { _meta: {} } });
    return r;
  };
  f.tool = (name, args) => f.rpc('tools/call', { name, arguments: args });
  f.stop = async () => {
    f.child.stdin.end();
    await Promise.race([f.exited, delay(1500).then(() => { throw new Error('stdio EOF did not exit'); })]);
    for (const p of f.peers) p.ws.terminate();
  };
  f.close = async () => {
    if (f.child.exitCode === null) await f.stop();
    for (const p of f.peers) p.ws.terminate();
    await fs.rm(home, { recursive: true, force: true });
  };
  return f;
}
function content(response) { return JSON.parse(response.result.content[0].text); }
async function rawPeer(f) {
  const p = { messages: [], closes: [], sendSeq: 0, recvSeq: 0 };
  p.ws = new WebSocket('ws://127.0.0.1:' + f.port + '/plugin', { origin: 'null' });
  p.ws.on('message', x => p.messages.push(JSON.parse(x)));
  p.ws.on('error', () => {});
  p.ws.on('close', (code, reason) => p.closes.push({ code, reason: reason ? reason.toString() : '' }));
  f.peers.push(p);
  p.challenge = await until(() => p.messages.find(m => m.type === 'challenge'));
  p.clientNonce = randomBytes(32).toString('hex');
  p.auth = {
    type: 'auth', protocol: AUTH_PROTOCOL, serverNonce: p.challenge.serverNonce, clientNonce: p.clientNonce, context,
    proof: sign(key, authProof('client-auth', p.challenge.serverNonce, p.clientNonce, context)),
  };
  p.ws.send(JSON.stringify(p.auth));
  p.ack = await until(() => p.messages.find(m => m.type === 'auth_ack'));
  assert(p.ack.ok, 'fake peer must authenticate');
  assert(verify(key, authProof('server-auth', p.challenge.serverNonce, p.clientNonce, context, p.ack.connectionId), p.ack.proof));
  p.connectionId = p.ack.connectionId;
  p.command = async () => {
    const m = await until(() => p.messages.find(m => m.type === 'frame' && m.seq === p.recvSeq + 1));
    assert(verify(key, frameProof('server', m.connectionId, m.seq, m.payload), m.mac));
    assert.equal(m.connectionId, p.connectionId);
    p.recvSeq = m.seq;
    return m.payload;
  };
  p.frame = payload => {
    const seq = ++p.sendSeq;
    return { type: 'frame', connectionId: p.connectionId, seq, payload, mac: sign(key, frameProof('client', p.connectionId, seq, payload)) };
  };
  p.push = payload => p.ws.send(JSON.stringify(p.frame(payload)));
  p.respond = (cmd, data, err) => {
    const payload = err ? { type: 'resp', id: cmd.id, ok: false, error: err } : { type: 'resp', id: cmd.id, ok: true, data };
    p.push(payload);
  };
  p.acknowledge = (transferId, index) => p.push({ type: 'chunk_ack', transferId, index });
  return p;
}
const sha256hex = bytes => createHash('sha256').update(bytes).digest('hex');
const pngBytes = size => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(size - 8, 7)]);
const artifactCount = async f => (await fs.readdir(path.join(f.home, 'artifacts')).catch(() => [])).length;
// If the tool call fails before any cmd leaves the bridge, surface that error
// instead of letting the frame wait time out without context.
function firstFrame(p, call, label) {
  return Promise.race([
    p.command(),
    call.then(r => { throw new Error(label + ' 未发出 cmd 即返回: ' + JSON.stringify(content(r))); }),
  ]);
}
async function expectAck(p, transferId, index, hint) {
  try {
    assert.deepEqual(await p.command(), { type: 'chunk_ack', transferId, index });
  } catch (e) {
    await until(() => p.closes.length > 0, 1000).catch(() => {});
    const close = p.closes.at(-1);
    if (close) throw new Error(hint + ' — bridge closed the connection instead (code ' + close.code + ', reason ' + close.reason + ')');
    throw e;
  }
}
async function assertClose(p, expectedReason) {
  await until(() => p.closes.length > 0, 2500);
  assert.equal(p.closes.at(-1).reason, expectedReason, 'expected close reason ' + expectedReason + ', saw: ' + JSON.stringify(p.closes));
}

test('scenario A: figma_import_asset streams a local file in 64KiB chunks under a 4-unacked window', async () => {
  const f = await fixture({ timeout: 8000 });
  try {
    await f.init();
    const bytes = pngBytes(400 * 1024);
    const filePath = path.join(f.home, 'asset.png');
    await fs.writeFile(filePath, bytes);
    const sha = sha256hex(bytes);
    const p = await rawPeer(f);
    const call = f.tool('figma_import_asset', { sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision, operationId: 'imp-1', filePath, x: 0, y: 0 });
    const cmd = await firstFrame(p, call, 'figma_import_asset');
    assert.equal(cmd.command, 'importAsset');
    assert.equal(cmd.operationId, 'imp-1');
    assert.equal(cmd.pageRevision, context.pageRevision);
    assert.equal(cmd.params.format, 'PNG');
    assert.equal(cmd.params.fileName, 'asset.png');
    assert.equal(cmd.params.totalBytes, bytes.length);
    assert.equal(cmd.params.totalSha256, sha);
    assert.equal(cmd.params.x, 0);
    assert.equal(cmd.params.y, 0);
    const transferId = cmd.params.transferId;
    const chunks = [];
    for (let i = 0; i < 4; i++) {
      const chunk = await p.command();
      assert.equal(chunk.type, 'chunk');
      assert.equal(chunk.transferId, transferId);
      assert.equal(chunk.index, i);
      assert.equal(chunk.done, false);
      assert(Buffer.from(chunk.data, 'base64').length <= 64 * 1024, 'no chunk may exceed 64KiB raw');
      chunks.push(chunk);
    }
    await delay(150);
    assert.equal(p.messages.filter(x => x.type === 'frame').length, 5, 'the outbound window must hold at 4 unacked chunks');
    for (const index of [0, 1, 2]) {
      p.acknowledge(transferId, index);
      const next = await p.command();
      assert.equal(next.type, 'chunk');
      assert.equal(next.index, index + 4, 'acknowledging a chunk must pump exactly the next one');
      assert.equal(next.done, index === 2);
      chunks.push(next);
    }
    for (const index of [3, 4, 5, 6]) p.acknowledge(transferId, index);
    assert.equal(chunks.length, 7);
    assert(Buffer.concat(chunks.map(c => Buffer.from(c.data, 'base64'))).equals(bytes), 'streamed chunks must reassemble into the exact file bytes');
    p.respond(cmd, { id: '1:9', format: 'PNG' });
    const result = content(await call);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.id, '1:9');
  } finally { await f.close(); }
});

test('scenario B: plugin chunk upload is acked per block, persisted under artifacts/ and readable via figma_read_asset', async () => {
  const f = await fixture({ timeout: 8000 });
  try {
    await f.init();
    const p = await rawPeer(f);
    const bytes = pngBytes(100 * 1024);
    const sha = sha256hex(bytes);
    const transferId = 'ab12'.repeat(8);
    p.push({ type: 'chunk', transferId, operationId: 'exp-1', totalBytes: bytes.length, totalSha256: sha, index: 0, data: bytes.subarray(0, 64 * 1024).toString('base64'), done: false });
    await expectAck(p, transferId, 0, 'the unsolicited export header chunk was not acknowledged');
    p.push({ type: 'chunk', transferId, index: 1, data: bytes.subarray(64 * 1024).toString('base64'), done: true });
    await expectAck(p, transferId, 1, 'the final export chunk was not acknowledged');
    const call = f.tool('figma_export_asset', { sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision, operationId: 'exp-1', nodeId: '1:3', format: 'PNG' });
    const cmd = await firstFrame(p, call, 'figma_export_asset');
    assert.equal(cmd.command, 'exportAsset');
    assert.equal(cmd.params.id, '1:3');
    assert.equal(cmd.params.format, 'PNG');
    assert.equal(typeof cmd.params.transferId, 'string');
    p.respond(cmd, { transferId });
    const result = content(await call);
    assert.equal(result.ok, true, JSON.stringify(result));
    const data = result.data;
    assert.equal(data.saved, true);
    assert.equal(data.bytes, bytes.length);
    assert.equal(data.sha256, sha);
    assert.equal(data.format, 'png');
    assert.equal(data.mime, 'image/png');
    assert(path.resolve(data.absolutePath).startsWith(path.resolve(f.home, 'artifacts')), 'the artifact must live inside CONFIG_DIR/artifacts');
    assert((await fs.readFile(data.absolutePath)).equals(bytes), 'persisted bytes must match the transferred bytes');
    const read = content(await f.tool('figma_read_asset', { artifactId: data.artifactId }));
    assert.equal(read.ok, true, JSON.stringify(read));
    assert.equal(read.data.bytes, bytes.length);
    assert.equal(read.data.sha256, sha);
    assert.equal(read.data.format, 'png');
    assert.equal(read.data.mime, 'image/png');
    assert.equal(read.data.operationId, 'exp-1');
    assert.equal(Buffer.from(read.data.inlinePreview, 'base64').equals(bytes), true, 'assets within the inline budget must include a preview');
    // Re-streaming the same transferId resolves to the same artifact record:
    // exclusive create + idempotent persist means no overwrite and no new file.
    p.push({ type: 'chunk', transferId, operationId: 'exp-2', totalBytes: bytes.length, totalSha256: sha, index: 0, data: bytes.subarray(0, 64 * 1024).toString('base64'), done: false });
    await expectAck(p, transferId, 0, 're-streamed header chunk was not acknowledged');
    p.push({ type: 'chunk', transferId, index: 1, data: bytes.subarray(64 * 1024).toString('base64'), done: true });
    await expectAck(p, transferId, 1, 're-streamed final chunk was not acknowledged');
    const again = f.tool('figma_export_asset', { sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision, operationId: 'exp-2', nodeId: '1:3', format: 'PNG' });
    const cmd2 = await firstFrame(p, again, 'figma_export_asset (second)');
    p.respond(cmd2, { transferId });
    const duplicate = content(await again);
    assert.equal(duplicate.ok, true, JSON.stringify(duplicate));
    assert.equal(duplicate.data.sha256, sha);
    assert.equal(await artifactCount(f), 1, 'artifact files must never be overwritten');
  } finally { await f.close(); }
});

test('scenario C1: an inbound chunk stream with a wrong total hash fails closed with TRANSFER_HASH and persists nothing', async () => {
  const f = await fixture({ timeout: 4000 });
  try {
    await f.init();
    const p = await rawPeer(f);
    p.push({ type: 'chunk', transferId: 'c1fe'.repeat(8), operationId: 'exp-bad', totalBytes: 5, totalSha256: sha256hex(Buffer.from('world')), index: 0, data: Buffer.from('hello').toString('base64'), done: true });
    await assertClose(p, 'TRANSFER_HASH');
    assert.equal(await artifactCount(f), 0);
  } finally { await f.close(); }
});

test('scenario C2: conflicting duplicate chunk content disconnects the sender', async () => {
  const f = await fixture({ timeout: 4000 });
  try {
    await f.init();
    const p = await rawPeer(f);
    const transferId = 'c2fe'.repeat(8);
    p.push({ type: 'chunk', transferId, operationId: 'exp-c2', totalBytes: 8192, totalSha256: sha256hex(Buffer.alloc(8192, 1)), index: 0, data: Buffer.alloc(1024, 1).toString('base64'), done: false });
    await expectAck(p, transferId, 0, 'the first chunk of a valid stream was not acknowledged');
    p.push({ type: 'chunk', transferId, index: 0, data: Buffer.alloc(1024, 2).toString('base64'), done: false });
    await assertClose(p, 'BAD_CHUNK');
    assert.equal(await artifactCount(f), 0);
  } finally { await f.close(); }
});

test('scenario C3: declaring done before all chunks arrive disconnects the sender', async () => {
  const f = await fixture({ timeout: 4000 });
  try {
    await f.init();
    const p = await rawPeer(f);
    p.push({ type: 'chunk', transferId: 'c3fe'.repeat(8), operationId: 'exp-c3', totalBytes: 70000, totalSha256: sha256hex(Buffer.alloc(70000, 1)), index: 0, data: Buffer.alloc(1024, 1).toString('base64'), done: true });
    await assertClose(p, 'BAD_CHUNK');
    assert.equal(await artifactCount(f), 0);
  } finally { await f.close(); }
});

test('scenario C4: a chunk for an undeclared transfer id disconnects the sender', async () => {
  const f = await fixture({ timeout: 4000 });
  try {
    await f.init();
    const p = await rawPeer(f);
    p.push({ type: 'chunk', transferId: 'c4fe'.repeat(8), index: 3, data: Buffer.alloc(16, 1).toString('base64'), done: false });
    await assertClose(p, 'BAD_CHUNK');
    assert.equal(await artifactCount(f), 0);
  } finally { await f.close(); }
});

test('scenario D: export_video is accepted, its chunk stream lands as an artifact and getOperation merges it', async () => {
  const f = await fixture({ timeout: 9000 });
  try {
    await f.init();
    const p = await rawPeer(f);
    const bytes = Buffer.alloc(64 * 1024 + 10, 3);
    const sha = sha256hex(bytes);
    const call = f.tool('figma_export_video', { sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision, operationId: 'vid-1', nodeId: '1:3' });
    const cmd = await firstFrame(p, call, 'figma_export_video');
    assert.equal(cmd.command, 'exportVideo');
    assert.equal(cmd.operationId, 'vid-1');
    assert(!Object.hasOwn(cmd.params, 'transferId'), 'the accepted job command must not pre-allocate a transfer');
    p.respond(cmd, { state: 'accepted', jobId: 'vid-1' });
    const accepted = content(await call);
    assert.equal(accepted.data.state, 'accepted');
    assert.equal(accepted.data.jobId, 'vid-1');
    const transferId = 'ef01'.repeat(8);
    p.push({ type: 'chunk', transferId, operationId: 'vid-1', totalBytes: bytes.length, totalSha256: sha, index: 0, data: bytes.subarray(0, 64 * 1024).toString('base64'), done: false });
    await expectAck(p, transferId, 0, 'inbound video chunk was not acknowledged');
    p.push({ type: 'chunk', transferId, index: 1, data: bytes.subarray(64 * 1024).toString('base64'), done: true });
    await expectAck(p, transferId, 1, 'final video chunk was not acknowledged');
    const poll = f.tool('figma_get_operation', { sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision, operationId: 'vid-1' });
    const query = await p.command();
    assert.equal(query.command, 'getOperation');
    p.respond(query, { operationId: 'vid-1', state: 'succeeded', result: { format: 'MP4' } });
    const result = content(await poll);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.state, 'succeeded');
    assert(result.data.artifact, 'completed video jobs must expose the persisted artifact');
    assert.equal(result.data.artifact.saved, true);
    assert.equal(result.data.artifact.bytes, bytes.length);
    assert.equal(result.data.artifact.sha256, sha);
    assert.equal(result.data.artifact.format, 'mp4');
  } finally { await f.close(); }
});

test('scenario E: business capacity stops at 92 in-flight while control queries keep a reserved lane', async () => {
  const f = await fixture({ timeout: 12000 });
  try {
    await f.init();
    const p = await rawPeer(f);
    const write = id => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'figma_create_node', arguments: { sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision, operationId: id, type: 'RECTANGLE' } } });
    for (let i = 0; i < 92; i++) {
      f.send(write('busy-' + i));
      await delay(55);
    }
    const over = content(await f.tool('figma_create_node', { sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision, operationId: 'over-capacity', type: 'RECTANGLE' }));
    assert.equal(over.error.code, 'BUSY', 'the next business request beyond the reserved capacity must be rejected');
    const control = f.tool('figma_get_operation', { sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision, operationId: 'busy-0' });
    for (let i = 0; i < 92; i++) {
      const cmd = await p.command();
      assert.equal(cmd.command, 'createNode');
      p.respond(cmd, { state: 'succeeded' });
    }
    const query = await p.command();
    assert.equal(query.command, 'getOperation', 'control commands must not be starved by the business backlog');
    p.respond(query, { state: 'running' });
    assert.equal(content(await control).data.state, 'running');
  } finally { await f.close(); }
});

test('scenario F: figma_get_capabilities merges the plugin report with bridge protocol, limits and tool count', async () => {
  const f = await fixture();
  try {
    await f.init();
    const p = await rawPeer(f);
    const call = f.tool('figma_get_capabilities', { sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision });
    const cmd = await firstFrame(p, call, 'figma_get_capabilities');
    assert.equal(cmd.command, 'getCapabilities');
    p.respond(cmd, { editorType: 'figma', domains: { nodes: { implemented: true, actions: ['getContext'] } }, status: 'implemented' });
    const result = content(await call);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert(result.data.plugin, 'the plugin capability report must be present');
    assert.equal(result.data.plugin.editorType, 'figma');
    assert.equal(result.data.bridge.protocol, 3);
    assert(result.data.limits, 'shared limits must be reported');
    assert.equal(result.data.toolCount, Object.keys(TOOLS).length);
  } finally { await f.close(); }
});
