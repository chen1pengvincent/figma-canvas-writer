#!/usr/bin/env node
// Read-only preflight doctor (requirement C1/C2 of the install-practice review):
// every environment assumption the bridge/plugin make becomes a checkable
// assertion. Never mutates state; occupant identification is probe-only
// (challenge protocol classification + lsof cmdline), no key-based handshake.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRIDGE_PORT = 9753;
const LEGACY_DIR = path.join(os.homedir(), '.dsh-figma-bridge');
const DEFAULT_DIR = path.join(os.homedir(), '.figma-canvas-writer');
const KEY_RE = /^[0-9a-f]{64}$/i;

function stat(value) {
  return value; // status: ok | warn | fail | info
}

function checkNodeVersion(version = process.versions.node) {
  const major = Number(String(version).split('.')[0]);
  if (Number.isFinite(major) && major >= 20) {
    return stat({ id: 'node', status: 'ok', detail: `Node ${version}` });
  }
  return stat({ id: 'node', status: 'fail', detail: `Node ${version} 过旧`, fix: '安装 Node.js >= 20（含 npm），然后重新运行安装' });
}

function checkWsDependency({ repositoryRoot = REPOSITORY_ROOT } = {}) {
  const wsPackage = path.join(repositoryRoot, 'bridge', 'node_modules', 'ws', 'package.json');
  if (!fs.existsSync(wsPackage)) {
    return stat({ id: 'ws', status: 'info', detail: 'bridge/node_modules/ws 未安装', fix: '运行 node install.mjs 安装运行时依赖' });
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(wsPackage, 'utf8'));
    return stat({ id: 'ws', status: 'ok', detail: `ws ${pkg.version || '已安装'} 可用` });
  } catch (e) {
    return stat({ id: 'ws', status: 'warn', detail: `ws 依赖不可读: ${e.message}`, fix: '重跑 node install.mjs 重建依赖' });
  }
}

async function resolveLocalhost() {
  // Node >= 18 supports { all: true }; mirror the bridge's dual-stack bind.
  const { lookup } = await import('node:dns').then(m => m.promises);
  return lookup('localhost', { all: true, verbatim: true });
}

async function checkLocalhostResolution() {
  let addresses;
  try { addresses = await resolveLocalhost(); }
  catch (e) {
    return stat({ id: 'localhost', status: 'warn', detail: `localhost 解析失败: ${e.message}`, fix: '检查 /etc/hosts 中 localhost 的条目' });
  }
  const order = addresses.map(a => a.address).join(', ');
  const v6First = addresses.length > 0 && addresses[0].family === 6;
  const detail = `localhost 解析顺序: ${order}` + (v6First ? '（IPv6 优先）' : '');
  // macOS 常见 IPv6 优先：本项目桥接双栈绑定所以同机没问题；split-host 中继必须双栈。
  return stat({ id: 'localhost', status: 'ok', detail, note: v6First ? 'split-host 中继必须同时监听 [::1]，否则插件可能拨到无监听的 ::1' : null });
}

function resolveConfigDir(env = process.env) {
  if (env.FIGMA_BRIDGE_HOME) return { dir: path.resolve(env.FIGMA_BRIDGE_HOME), source: 'FIGMA_BRIDGE_HOME' };
  if (fs.existsSync(LEGACY_DIR)) return { dir: LEGACY_DIR, source: 'legacy 目录（优先保留）' };
  return { dir: DEFAULT_DIR, source: '默认目录' };
}

function checkKeyFile(env = process.env) {
  const { dir, source } = resolveConfigDir(env);
  const keyFile = path.join(dir, 'bridge-token');
  if (!fs.existsSync(keyFile)) {
    return stat({ id: 'key', status: 'info', detail: `密钥不存在（${source}: ${dir}）`, fix: '首次运行桥接时自动生成；或运行 node bridge/mcp-bridge.js --show-pairing-key' });
  }
  try {
    const key = fs.readFileSync(keyFile, 'utf8').trim();
    if (!KEY_RE.test(key)) {
      return stat({ id: 'key', status: 'fail', detail: `密钥文件不是 64 位十六进制（${keyFile}）`, fix: '停止桥接后运行 node bridge/mcp-bridge.js --rotate-token' });
    }
    return stat({ id: 'key', status: 'ok', detail: `配对密钥存在（${source}）` });
  } catch (e) {
    return stat({ id: 'key', status: 'fail', detail: `密钥文件不可读: ${e.message}`, fix: `检查 ${keyFile} 的文件权限` });
  }
}

function portProbe(port, timeoutMs = 2000) {
  // 读-only 探测：完成 WS upgrade 并读取首个帧，绝不发送认证材料。
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let settled = false;
    const finish = result => { if (!settled) { settled = true; socket.destroy(); resolve(result); } };
    socket.setTimeout(timeoutMs, () => finish({ state: 'timeout' }));
    socket.on('error', e => finish({ state: e.code === 'ECONNREFUSED' ? 'free' : 'error', code: e.code }));
    socket.on('connect', () => {
      const request = [
        `GET /plugin HTTP/1.1`, 'Host: localhost:' + port, 'Upgrade: websocket',
        'Connection: Upgrade', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version: 13', '', '',
      ].join('\r\n');
      socket.write(request);
    });
    let buffer = Buffer.alloc(0);
    let upgraded = false;
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const terminator = buffer.indexOf('\r\n\r\n');
        if (terminator === -1) return;
        const head = buffer.subarray(0, terminator).toString('latin1');
        buffer = buffer.subarray(terminator + 4);
        if (!head.startsWith('HTTP/1.1 101')) {
          finish({ state: 'open', kind: 'not-websocket', head: head.split('\r\n')[0] });
          return;
        }
        upgraded = true;
      }
      // 101 与 challenge 帧可能分片到达：等齐一个完整 WS 帧再分类。
      if (buffer.length < 2) return;
      const payloadLength = buffer[1] & 0x7f;
      const frameTotal = 2 + payloadLength;
      if (buffer.length < frameTotal) return;
      const payload = buffer.subarray(2, frameTotal);
      let message = null;
      try { message = JSON.parse(payload.toString('utf8')); } catch { /* 非本协议 */ }
      if (message && message.type === 'challenge') {
        finish({ state: 'open', kind: Number.isFinite(message.protocol) ? 'fcw-bridge' : 'fcw-legacy',
          protocol: message.protocol ?? null });
      } else finish({ state: 'open', kind: 'unknown-ws' });
    });
  });
}

function listPortOccupant(port) {
  // best-effort：lsof 不存在或权限不足时返回 null，不影响 doctor 结论。
  try {
    const output = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8', timeout: 3000 });
    const lines = output.split('\n').filter(line => line && !line.startsWith('COMMAND'));
    const pids = [...new Set(lines.map(line => Number(line.split(/\s+/)[1])).filter(Number.isFinite))];
    return pids.map(pid => {
      let command = '';
      try { command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 3000 }).trim(); } catch { /* 进程可能刚退出 */ }
      return { pid, command };
    });
  } catch { return []; }
}

export async function checkPort(port = BRIDGE_PORT) {
  const probe = await portProbe(port);
  if (probe.state === 'free') return stat({ id: `port${port}`, status: 'ok', detail: `端口 ${port} 空闲` });
  const occupants = listPortOccupant(port);
  const occupantText = occupants.map(o => `PID ${o.pid} ${o.command}`).join('; ') || '未知进程';
  if (probe.state === 'open' && probe.kind === 'fcw-bridge' && probe.protocol === 3) {
    return stat({ id: `port${port}`, status: 'ok',
      detail: `端口 ${port} 正在运行本项目的桥接（协议 3）— ${occupantText}`,
      note: '同一时刻只允许一个 Agent 桥接；若这不是你预期的实例，请先停止它' });
  }
  if (probe.state === 'open' && (probe.kind === 'fcw-legacy' || probe.kind === 'unknown-ws' || (probe.kind === 'fcw-bridge' && probe.protocol !== 3))) {
    return stat({ id: `port${port}`, status: 'warn',
      detail: `端口 ${port} 被外部程序占用（${probe.kind === 'fcw-legacy' ? '旧版本 figma 桥（协议未知）' : probe.kind === 'fcw-bridge' ? `协议 ${probe.protocol} 桥` : '未知 WebSocket 服务'}）— ${occupantText}`,
      fix: `停止占用者（lsof -ti:${port} | xargs kill），插件会静默连到错误目标并报密钥验证失败` });
  }
  if (probe.state === 'open' && probe.kind === 'not-websocket') {
    return stat({ id: `port${port}`, status: 'warn', detail: `端口 ${port} 被非 WebSocket 服务占用 — ${occupantText}`,
      fix: `停止占用者（lsof -ti:${port} | xargs kill）` });
  }
  if (probe.state === 'timeout') {
    return stat({ id: `port${port}`, status: 'warn', detail: `端口 ${port} 连接超时（防火墙或挂起的进程）`, fix: `lsof -iTCP:${port} 检查占用者` });
  }
  return stat({ id: `port${port}`, status: 'warn', detail: `端口 ${port} 探测失败: ${probe.code || probe.state}`, fix: `lsof -iTCP:${port} 检查占用者` });
}

function checkFigmaDesktop(platform = process.platform) {
  if (platform === 'darwin') {
    try {
      const out = execFileSync('pgrep', ['-f', 'Figma.app'], { encoding: 'utf8', timeout: 3000 });
      return stat({ id: 'figma', status: 'ok', detail: 'Figma Desktop 正在运行' });
    } catch {
      return stat({ id: 'figma', status: 'warn', detail: 'Figma Desktop 未在运行', fix: '启动 Figma Desktop 并打开有编辑权限的文件' });
    }
  }
  return stat({ id: 'figma', status: 'info', detail: `平台 ${platform} 无法自动检测 Figma（若 Agent 与 Figma 分离属正常）` });
}

export async function doctor(options = {}) {
  const checks = [];
  checks.push(checkNodeVersion(options.nodeVersion));
  checks.push(checkWsDependency(options));
  checks.push(await checkLocalhostResolution());
  checks.push(checkKeyFile(options.env));
  checks.push(await checkPort(options.port ?? BRIDGE_PORT));
  checks.push(checkFigmaDesktop(options.platform));
  const failed = checks.some(c => c.status === 'fail');
  const warned = checks.some(c => c.status === 'warn');
  return { checks, exitCode: failed ? 2 : warned ? 1 : 0 };
}

export function formatDoctorReport({ checks, exitCode }) {
  const lines = checks.map(check => {
    const label = { ok: '[OK]', warn: '[WARN]', fail: '[FAIL]', info: '[INFO]' }[check.status];
    let text = `${label} ${check.detail}`;
    if (check.fix) text += `\n       修复: ${check.fix}`;
    if (check.note) text += `\n       注意: ${check.note}`;
    return text;
  });
  const verdict = exitCode === 0 ? '环境就绪' : exitCode === 1 ? '存在警告（可继续，但建议处理）' : '存在阻塞性失败';
  return [...lines, `doctor 结论: ${verdict}（退出码 ${exitCode}）`].join('\n');
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const asJson = process.argv.includes('--json');
  try {
    const report = await doctor();
    if (asJson) console.log(JSON.stringify(report, null, 2));
    else console.log(formatDoctorReport(report));
    process.exitCode = report.exitCode;
  } catch (error) {
    console.error(`doctor 运行失败：${error.message}`);
    process.exitCode = 2;
  }
}
