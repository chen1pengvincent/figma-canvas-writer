// Real bridge child processes + WebSocket/HMAC fake peers; this is NOT Figma E2E.
// Protocol 3: runId/pageRevision context, registry-driven 37-tool listing,
// pageRevision-bearing cmd payloads and legacy-protocol rejection.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
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
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'figma-bridge-test-'));
  await fs.writeFile(path.join(home, 'bridge-token'), key, { mode: 0o600 });
  const port = await freePort();
  const env = { ...process.env, NODE_ENV: 'test', FIGMA_BRIDGE_HOME: home, FIGMA_BRIDGE_TEST_PORT: String(port), FIGMA_BRIDGE_TIMEOUT_MS: String(options.timeout || 500) };
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
  f.init = async (version = '2025-11-25') => {
    const r = await f.rpc('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'test-client', version: '1' } });
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
async function rawPeer(f, origin = 'null', hostname = '127.0.0.1') {
  const p = { messages: [], closes: [], sendSeq: 0, recvSeq: 0 };
  p.ws = new WebSocket('ws://' + hostname + ':' + f.port + '/plugin', { origin });
  p.ws.on('message', x => p.messages.push(JSON.parse(x)));
  p.ws.on('error', () => {});
  p.ws.on('close', (code, reason) => p.closes.push({ code, reason: reason ? reason.toString() : '' }));
  f.peers.push(p);
  p.challenge = await until(() => p.messages.find(m => m.type === 'challenge'));
  assert.equal(p.challenge.protocol, AUTH_PROTOCOL);
  p.clientNonce = randomBytes(32).toString('hex');
  p.auth = {
    type: 'auth', protocol: AUTH_PROTOCOL, serverNonce: p.challenge.serverNonce, clientNonce: p.clientNonce, context,
    proof: sign(key, authProof('client-auth', p.challenge.serverNonce, p.clientNonce, context)),
  };
  p.ws.send(JSON.stringify(p.auth));
  p.ack = await until(() => p.messages.find(m => m.type === 'auth_ack'));
  if (p.ack.ok) {
    assert(verify(key, authProof('server-auth', p.challenge.serverNonce, p.clientNonce, context, p.ack.connectionId), p.ack.proof));
    p.connectionId = p.ack.connectionId;
  }
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
  p.respond = (cmd, data, err) => {
    const payload = err ? { type: 'resp', id: cmd.id, ok: false, error: err } : { type: 'resp', id: cmd.id, ok: true, data };
    const frame = p.frame(payload); p.ws.send(JSON.stringify(frame)); return frame;
  };
  return p;
}
async function runCli(f, flag) {
  const child = spawn(process.execPath, [entry, flag], { env: f.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout += b; });
  child.stderr.on('data', b => { stderr += b; });
  const [code] = await once(child, 'exit');
  return { code, stdout, stderr };
}

test('real stdio: negotiates four supported versions and the 2025-03-26 batch contract', async () => {
  for (const version of ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']) {
    const f = await fixture();
    try {
      assert.equal((await f.init(version)).result.protocolVersion, version);
      const list = await f.rpc('tools/list');
      assert.equal(list.result.tools.length, Object.keys(TOOLS).length, 'tools/list must mirror the shared registry');
      for (const t of list.result.tools) {
        if (t.name === 'figma_canvas_status' || t.name === 'figma_read_asset') continue;
        assert(t.inputSchema.required.includes('sessionId'), t.name + ' must require sessionId');
        assert(t.inputSchema.required.includes('pageId'), t.name + ' must require pageId');
        assert(t.inputSchema.required.includes('pageRevision'), t.name + ' must require pageRevision');
      }
      for (const [name, spec] of Object.entries(TOOLS)) {
        const listed = list.result.tools.find(t => t.name === name);
        if (['write', 'file', 'job', 'context'].includes(spec.classification)) {
          assert(listed.inputSchema.required.includes('operationId'), name + ' must require operationId');
        }
        if (spec.classification === 'mixed') {
          assert(Array.isArray(listed.inputSchema.allOf) && listed.inputSchema.allOf.length > 0, name + ' must guard mutating actions via if/then');
          assert(listed.inputSchema.allOf[0].if && listed.inputSchema.allOf[0].then, name + ' allOf must carry if/then');
          assert(listed.inputSchema.properties.operationId, name + ' must declare the conditional operationId');
        }
      }
      const create = list.result.tools.find(t => t.name === 'figma_create_node');
      assert(create.inputSchema.required.includes('operationId'));
      assert(create.inputSchema.properties.type.enum.includes('STAR'));
      f.send([{ jsonrpc: '2.0', id: 'batch-1', method: 'ping' }, { jsonrpc: '2.0', id: 'batch-2', method: 'ping' }]);
      if (version === '2025-03-26') assert.equal((await until(() => f.messages.find(Array.isArray))).length, 2);
      else assert.equal((await until(() => f.messages.find(x => x.error && x.id === null))).error.code, -32600);
      assert(!f.stderr.includes(key), 'key must not appear in default stderr');
    } finally { await f.close(); }
  }
});

test('real stdio: JSON-RPC errors, initialization state, size cap and stream recovery', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.rpc('tools/list')).error.code, -32002);
    await f.init();
    assert.equal((await f.rpc('unknown/method')).error.code, -32601);
    assert.equal((await f.rpc('tools/call', { name: 'unknown' })).error.code, -32602);
    assert.equal((await f.rpc('tools/list', [])).error.code, -32602);
    f.child.stdin.write('{bad json}\n');
    assert.equal((await until(() => f.messages.find(x => x.error?.code === -32700))).id, null);
    f.send({ jsonrpc: '1.0', id: 90, method: 'ping' });
    assert(await until(() => f.messages.find(x => x.error?.code === -32600)));
    const before = f.messages.length;
    f.child.stdin.write('x'.repeat(1024 * 1024 + 2) + '\n');
    assert(await until(() => f.messages.slice(before).find(x => x.error?.code === -32600)));
    assert.deepEqual((await f.rpc('ping')).result, {});
    const wrong = await f.tool('figma_get_context', { sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision, limit: 1.5 });
    assert.equal(content(wrong).error.code, 'INVALID_PARAM');
  } finally { await f.close(); }
});

test('real process: EOF releases port; rotation while active leaves key untouched; stopped rotation and show-key work', async () => {
  const f = await fixture();
  try {
    const before = await fs.readFile(path.join(f.home, 'bridge-token'), 'utf8');
    const denied = await runCli(f, '--rotate-token');
    assert.equal(denied.code, 1);
    assert.equal(await fs.readFile(path.join(f.home, 'bridge-token'), 'utf8'), before);
    assert(!denied.stdout.includes(key));
    await f.stop();
    const rotated = await runCli(f, '--rotate-token');
    assert.equal(rotated.code, 0, rotated.stderr);
    assert.equal(rotated.stdout, '');
    const after = (await fs.readFile(path.join(f.home, 'bridge-token'), 'utf8')).trim();
    assert.notEqual(after, before);
    assert.match(after, /^[a-f0-9]{64}$/);
    const shown = await runCli(f, '--show-pairing-key');
    assert.equal(shown.stdout.trim(), after);
  } finally { await f.close(); }
});

test('real WS: mutual proofs contain no key, active plugin cannot be taken over, untrusted Origin rejected', async () => {
  const f = await fixture();
  try {
    const p = await rawPeer(f);
    assert(p.ack.ok);
    assert(!JSON.stringify([p.auth, p.ack]).includes(key));
    const b = await rawPeer(f);
    assert.equal(b.ack.ok, false);
    assert.equal(b.ack.error.code, 'PLUGIN_BUSY');
    assert.equal(p.ws.readyState, WebSocket.OPEN);
    const untrusted = new WebSocket('ws://127.0.0.1:' + f.port + '/plugin', { origin: 'https://untrusted.example' });
    const err = await once(untrusted, 'error');
    assert.match(err[0].message, /403/);
    untrusted.terminate();
    await f.init();
    const call = f.tool('figma_canvas_status', {});
    const cmd = await p.command();
    p.respond(cmd, { pong: true, ...context });
    assert.deepEqual(content(await call).data.context, context);
    assert.equal(content(await call).data.authorized, true);
  } finally { await f.close(); }
});

test('real WS: legacy protocol 2 handshake fails closed with AUTH_FAILED instead of downgrading', async () => {
  const f = await fixture();
  try {
    const p = { messages: [], closes: [] };
    p.ws = new WebSocket('ws://127.0.0.1:' + f.port + '/plugin', { origin: 'null' });
    p.ws.on('message', x => p.messages.push(JSON.parse(x)));
    p.ws.on('error', () => {});
    p.ws.on('close', (code, reason) => p.closes.push({ code, reason: reason ? reason.toString() : '' }));
    f.peers.push(p);
    const challenge = await until(() => p.messages.find(m => m.type === 'challenge'));
    const clientNonce = randomBytes(32).toString('hex');
    const legacyContext = { sessionId: 'legacy-session', pageId: '1:2', pageName: '旧页', fileName: '旧文件', editorType: 'figma' };
    p.ws.send(JSON.stringify({
      type: 'auth', protocol: 2, serverNonce: challenge.serverNonce, clientNonce, context: legacyContext,
      proof: sign(key, authProof('client-auth', challenge.serverNonce, clientNonce, legacyContext)),
    }));
    const ack = await until(() => p.messages.find(m => m.type === 'auth_ack'));
    assert.equal(ack.ok, false);
    assert.equal(ack.error.code, 'AUTH_FAILED');
    assert.equal(ack.protocol, undefined);
    await until(() => p.closes.length > 0);
  } finally { await f.close(); }
});

test('real WS: rejects authentication replay against a fresh server nonce', async () => {
  const f = await fixture();
  try {
    const p = await rawPeer(f);
    p.ws.close(); await once(p.ws, 'close');
    const ws = new WebSocket('ws://127.0.0.1:' + f.port + '/plugin', { origin: 'null' });
    const messages = [];
    ws.on('message', b => messages.push(JSON.parse(b)));
    await until(() => messages.some(m => m.type === 'challenge'));
    ws.send(JSON.stringify(p.auth));
    const ack = await until(() => messages.find(m => m.type === 'auth_ack'));
    assert.equal(ack.ok, false);
    ws.terminate();
  } finally { await f.close(); }
});

test('real HMAC peer: schemas preserve text omission/STAR/props/paint alpha and errors, reject stale or extra args', async () => {
  const f = await fixture();
  try {
    await f.init(); const p = await rawPeer(f);
    const a = { sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision, operationId: 'font-only', nodeId: '1:3', fontSize: 24 };
    const call = f.tool('figma_set_text', a);
    const cmd = await p.command();
    assert.equal(cmd.command, 'setText');
    assert.equal(cmd.sessionId, context.sessionId);
    assert.equal(cmd.pageId, context.pageId);
    assert.equal(cmd.pageRevision, context.pageRevision, 'protocol 3 cmd payloads must carry pageRevision');
    assert(!Object.hasOwn(cmd.params, 'text'));
    assert.equal(cmd.operationId, 'font-only');
    p.respond(cmd, null, { code: 'FAILED', message: 'test error', state: 'rolled_back', affectedNodeIds: ['1:3'], details: { step: 'font' } });
    const failure = content(await call).error;
    assert.equal(failure.state, 'rolled_back'); assert.deepEqual(failure.affectedNodeIds, ['1:3']); assert.deepEqual(failure.details, { step: 'font' });
    const create = f.tool('figma_create_node', { sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision, operationId: 'star', type: 'STAR', props: { fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 0.3 }, visible: false }] } });
    const star = await p.command();
    assert.equal(star.pageRevision, context.pageRevision);
    assert.deepEqual(star.params.props.fills, [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 0.3, visible: false }]);
    p.respond(star, { id: 'star' }); assert.equal(content(await create).ok, true);
    const invalids = [
      ['figma_set_text', { ...a, extra: true }],
      ['figma_set_text', { ...a, fontName: { family: 'Inter', style: 'Regular', extra: 1 } }],
      ['figma_create_node', { ...a, nodeId: undefined, fontSize: undefined, type: 'TEXT' }],
      ['figma_modify_node', { ...a, fontSize: undefined, props: { fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 0.3 }, opacity: 0.9 }] } }],
      ['figma_create_node', { sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision, operationId: 'dup', type: 'FRAME', width: 5, props: { width: 6 } }],
    ];
    for (const [name, args] of invalids) assert.equal(content(await f.tool(name, args)).error.code, 'INVALID_PARAM');
    assert.equal(content(await f.tool('figma_set_text', { ...a, pageId: 'other' })).error.code, 'STALE_CONTEXT');
    assert.equal(content(await f.tool('figma_set_text', { ...a, pageRevision: 999 })).error.code, 'STALE_CONTEXT', 'a stale pageRevision must be rejected like a stale pageId');
    assert.equal(p.messages.filter(x => x.type === 'frame').length, 2);
  } finally { await f.close(); }
});

test('real HMAC peer: tampering disconnects with unknown write state; replayed frame cannot settle a new request', async () => {
  const f = await fixture();
  try {
    await f.init(); const p = await rawPeer(f);
    const call = f.tool('figma_create_node', { sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision, operationId: 'tamper-op', type: 'RECTANGLE' });
    const cmd = await p.command();
    const frame = p.frame({ type: 'resp', id: cmd.id, ok: true, data: { id: 'forged' } });
    frame.payload.data.id = 'tampered-after-signing';
    p.ws.send(JSON.stringify(frame));
    const result = content(await call);
    assert.equal(result.error.state, 'unknown'); assert.equal(result.error.code, 'BAD_FRAME');
    await until(() => p.ws.readyState === WebSocket.CLOSED);
    const b = await rawPeer(f);
    assert(b.ack.ok);
    const read = f.tool('figma_get_context', { sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision });
    const readCmd = await b.command();
    const valid = b.respond(readCmd, { ...context, nodes: [], total: 0, nextCursor: null, truncated: false });
    assert.equal(content(await read).ok, true);
    const read2 = f.tool('figma_get_context', { sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision });
    await b.command();
    b.ws.send(JSON.stringify(valid));
    assert.equal(content(await read2).error.code, 'BAD_FRAME');
  } finally { await f.close(); }
});

test('real peer timeout: write returns unknown; late reply does not replay write, getOperation reconciles same id', async () => {
  const f = await fixture({ timeout: 80 });
  try {
    await f.init(); const p = await rawPeer(f);
    const call = f.tool('figma_delete_node', { sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision, operationId: 'late-delete', nodeId: '1:3' });
    const cmd = await p.command();
    const result = content(await call);
    assert.equal(result.error.code, 'TIMEOUT'); assert.equal(result.error.state, 'unknown');
    assert.equal(result.error.details.operationId, 'late-delete');
    p.respond(cmd, { state: 'completed', operationId: 'late-delete' });
    const reconcile = f.tool('figma_get_operation', { sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision, operationId: 'late-delete' });
    const query = await p.command();
    assert.equal(query.command, 'getOperation');
    p.respond(query, { state: 'completed', operationId: 'late-delete' });
    assert.equal(content(await reconcile).data.state, 'completed');
    assert.equal(p.messages.filter(x => x.type === 'frame' && x.payload.command === 'deleteNode').length, 1);
  } finally { await f.close(); }
});

test('real stdio: cancellation suppresses the response without replaying an in-flight write', async () => {
  const f = await fixture();
  try {
    await f.init(); const p = await rawPeer(f);
    f.send({ jsonrpc: '2.0', id: 'cancel-write', method: 'tools/call', params: { name: 'figma_delete_node', arguments: { sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision, operationId: 'cancel-op', nodeId: '1:3' } } });
    const cmd = await p.command();
    f.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'cancel-write' } });
    await f.rpc('ping');
    p.respond(cmd, { state: 'completed' });
    await f.rpc('ping');
    assert(!f.messages.some(m => m.id === 'cancel-write'));
    assert.equal(p.messages.filter(x => x.type === 'frame').length, 1);
  } finally { await f.close(); }
});

test('real HMAC peer: oversized UTF-8 command is not_started and does not consume frame sequence', async () => {
  const f = await fixture();
  try {
    await f.init();
    const args = { sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision, operationId: 'large-text', type: 'TEXT', text: '测'.repeat(100000) };
    const noPlugin = content(await f.tool('figma_create_node', { ...args, text: '短文本' }));
    assert.equal(noPlugin.error.code, 'NO_PLUGIN');
    assert.equal(noPlugin.error.state, 'not_started');
    const p = await rawPeer(f);
    const rejected = content(await f.tool('figma_create_node', args));
    assert.equal(rejected.error.code, 'MSG_TOO_LARGE');
    assert.equal(rejected.error.state, 'not_started');
    assert.equal(p.messages.filter(x => x.type === 'frame').length, 0);
    const status = f.tool('figma_canvas_status', {});
    const ping = await p.command();
    assert.equal(p.recvSeq, 1);
    p.respond(ping, { pong: true, ...context });
    assert.equal(content(await status).data.authorized, true);
    const normal = f.tool('figma_create_node', { ...args, operationId: 'small-text', text: '合法文本' });
    const create = await p.command();
    assert.equal(p.recvSeq, 2);
    p.respond(create, { id: 'small-text' });
    assert.equal(content(await normal).ok, true);
  } finally { await f.close(); }
});

test('real IPv6 and localhost sockets authenticate; listeners are explicit loopback addresses, never wildcard', async t => {
  const f = await fixture();
  try {
    await f.init();
    const info = content(await f.tool('figma_canvas_status', {})).data.bridge;
    assert(info.listenHosts.includes('127.0.0.1'));
    assert(info.listenHosts.every(host => host === '127.0.0.1' || host === '::1'));
    if (!info.listenHosts.includes('::1')) { t.skip('OS has no supported IPv6 loopback; explicit IPv4 fallback checked'); return; }
    assert.deepEqual(info.listenHosts, ['127.0.0.1', '::1']);
    if (process.platform === 'darwin') {
      const output = await new Promise((resolve, reject) => execFile('/usr/sbin/lsof', ['-nP', '-a', '-p', String(f.child.pid), '-iTCP', '-sTCP:LISTEN', '-Fn'], (e, stdout) => e ? reject(e) : resolve(stdout)));
      const addresses = output.split('\n').filter(line => line.startsWith('n')).map(line => line.slice(1));
      assert.equal(addresses.length, 2);
      assert(addresses.includes('127.0.0.1:' + f.port));
      assert(addresses.includes('[::1]:' + f.port));
      assert(addresses.every(address => !address.includes('*') && !address.startsWith('0.0.0.0:')));
    }
    const ipv6 = await rawPeer(f, 'null', '[::1]');
    assert(ipv6.ack.ok);
    const status = f.tool('figma_canvas_status', {});
    ipv6.respond(await ipv6.command(), { pong: true, ...context });
    assert.equal(content(await status).data.authorized, true);
    ipv6.ws.close(); await once(ipv6.ws, 'close');
    const localhost = await rawPeer(f, 'null', 'localhost');
    assert(localhost.ack.ok);
    await f.stop();
    for (const host of ['127.0.0.1', '::1']) {
      const probe = net.createServer();
      probe.listen({ host, port: f.port, ipv6Only: host === '::1' }); await once(probe, 'listening');
      await new Promise(resolve => probe.close(resolve));
    }
  } finally { await f.close(); }
});

test('real IPv6-only port conflict prevents rotation and releases the newly acquired IPv4 listener', async t => {
  const f = await fixture(); let blocker;
  try {
    await f.init();
    const info = content(await f.tool('figma_canvas_status', {})).data.bridge;
    if (!info.listenHosts.includes('::1')) { t.skip('OS has no supported IPv6 loopback'); return; }
    await f.stop();
    blocker = net.createServer(); blocker.listen({ host: '::1', port: f.port, ipv6Only: true });
    await once(blocker, 'listening');
    const before = await fs.readFile(path.join(f.home, 'bridge-token'), 'utf8');
    const rejected = await runCli(f, '--rotate-token');
    assert.equal(rejected.code, 1);
    assert.equal(await fs.readFile(path.join(f.home, 'bridge-token'), 'utf8'), before);
    assert.equal(rejected.stdout, '');
    const probe = net.createServer(); probe.listen(f.port, '127.0.0.1'); await once(probe, 'listening');
    await new Promise(resolve => probe.close(resolve));
  } finally {
    if (blocker?.listening) await new Promise(resolve => blocker.close(resolve));
    await f.close();
  }
});
