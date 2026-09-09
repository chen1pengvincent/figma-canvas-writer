#!/usr/bin/env node
// Five-step smoke test per the install-practice review: proves "installed and
// operational" machine-checkably, not just "installed". Speaks MCP over stdio
// to a bridge it spawns itself; cleans up every node it creates; never needs
// manual interaction.
// Exit codes: 0 = all passed; 1 = some step failed; 2 = cannot start (bridge
// never authorized).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const json = process.argv.includes('--json');
const steps = [];
const line = (text) => { if (!json) console.log(text); else steps.push(text); };
const step = (index, total, name) => ({ index, total, name });

async function waitForAuthorized(call, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await call('figma_canvas_status', {});
    if (status.ok && status.data.authorized) return status.data.context;
    if (Date.now() > deadline) {
      const error = new Error(`桥接未在 ${timeoutMs / 1000}s 内获得插件授权（提示：在 Figma 运行 Figma Canvas Writer 3 并连接；node scripts/doctor.mjs 可诊断 9753 占用者）`);
      error.code = 'NOT_AUTHORIZED';
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 800));
  }
}

export async function runSmoke({ spawnBridge, call, authorizedTimeoutMs } = {}) {
  let context = null;
  let screenshot = null;
  const created = [];
  const results = [];
  const run = async (index, total, name, fn) => {
    try {
      const detail = await fn();
      results.push({ step: index, name, status: 'PASS', detail });
      if (!json) console.log(`[${index}/${total}] ${name} ... OK${detail ? ` (${detail})` : ''}`);
    } catch (error) {
      results.push({ step: index, name, status: 'FAIL', error: error.message });
      throw Object.assign(error, { stepIndex: index, resultsSoFar: results });
    }
  };
  try {
    if (spawnBridge) spawnBridge();
    const total = 5;
    await run(1, total, step(1, total, 'bridge 启动与授权').name, async () => {
      context = await waitForAuthorized(call, authorizedTimeoutMs);
      return `authorized, ${context.fileName} / ${context.pageName}`;
    });
    let nodeId = null;
    await run(2, total, 'figma_create_node（RECTANGLE）', async () => {
      const result = await call('figma_create_node', {
        sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision,
        operationId: 'smoke-' + randomUUID(), type: 'RECTANGLE',
        name: 'FCW3-smoke-' + Date.now().toString(36), x: 0, y: 0, width: 120, height: 80,
      });
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
      nodeId = result.data.id;
      created.push(nodeId);
      return `id=${nodeId}`;
    });
    await run(3, total, 'figma_get_screenshot（内联 PNG 预览）', async () => {
      const result = await call('figma_get_screenshot', {
        sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision, nodeId,
      });
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
      screenshot = result.data;
      if (screenshot.inline !== true || typeof screenshot.data !== 'string' ||
          !screenshot.data.startsWith('data:image/png;base64,') || screenshot.data.length < 64) {
        throw new Error('截图不是预期的内联 PNG data URL');
      }
      return `${screenshot.width}x${screenshot.height}`;
    });
    await run(4, total, '清理：figma_delete_node', async () => {
      const result = await call('figma_delete_node', {
        sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision,
        operationId: 'smoke-' + randomUUID(), nodeId,
      });
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
      created.length = 0;
      return nodeId;
    });
    await run(5, total, '收尾状态核对', async () => {
      const status = await call('figma_canvas_status', {});
      if (!status.ok || !status.data.authorized) throw new Error('结束后连接不再授权');
      return '连接健康';
    });
    return { ok: true, results, screenshot };
  } catch (error) {
    // 幂等清理：无论成败，测试节点不留现场。
    if (created.length && context) {
      for (const nodeId of created) {
        try {
          await call('figma_delete_node', {
            sessionId: context.sessionId, pageId: context.pageId, pageRevision: context.pageRevision,
            operationId: 'smoke-cleanup-' + randomUUID(), nodeId,
          });
        } catch { /* 已被删除则忽略 */ }
      }
    }
    return { ok: false, results, error, screenshot };
  }
}

async function main() {
  const bridge = spawn(process.execPath, [path.join(root, 'bridge', 'mcp-bridge.js')], { stdio: ['pipe', 'pipe', 'ignore'] });
  let seq = 0;
  const pending = new Map();
  createInterface({ input: bridge.stdout }).on('line', raw => {
    let message; try { message = JSON.parse(raw); } catch { return; }
    if (message.id !== undefined && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  });
  let bridgeExit = null;
  bridge.on('exit', code => { bridgeExit = code; for (const resolve of pending.values()) resolve(undefined); pending.clear(); });
  const rpc = (method, params = {}, timeoutMs = 15000) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`桥接 ${timeoutMs}ms 未响应 ${method}`)); }, timeoutMs);
    pending.set(id, message => {
      clearTimeout(timer);
      if (message === undefined) reject(new Error(bridgeExit !== null ? `桥接已退出（code ${bridgeExit}），常见于 9753 端口被占用` : '桥接无响应'));
      else resolve(message);
    });
    bridge.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const call = async (name, args) => {
    const response = await rpc('tools/call', { name, arguments: args });
    if (!response.result) throw new Error('RPC 错误: ' + JSON.stringify(response));
    return JSON.parse(response.result.content[0].text);
  };
  let initialized = false;
  try {
    try {
      await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fcw3-smoke', version: '3.1.0' } });
      initialized = true;
    } catch (e) {
      console.error(`❌ 无法开始：桥接未启动（${e.message}）。`);
      console.error('   常见原因：9753 被占用（node scripts/doctor.mjs 识别占用者）或桥接立即退出（见上方 stderr）。');
      process.exitCode = 2;
      return;
    }
    bridge.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
    void initialized;
    const report = await runSmoke({ call, authorizedTimeoutMs: 60000 });
    if (json) console.log(JSON.stringify(report, null, 2));
    else if (report.ok) console.log('\n✅ Smoke 通过：figma-canvas-writer 可正常工作。');
    else console.error(`\n❌ Smoke 未通过（步骤 ${errorStepText(report)}）：${report.error?.message || ''}`);
    process.exitCode = report.ok ? 0 : report.error?.code === 'NOT_AUTHORIZED' ? 2 : 1;
  } finally {
    bridge.stdin.end();
    setTimeout(() => process.exit(process.exitCode || 0), 300);
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main().catch(error => { console.error(`smoke 运行失败：${error.message}`); process.exitCode = 2; });
}

function errorStepText(report) {
  const failed = report.results?.find(step => step.status === 'FAIL');
  return failed ? `${failed.step}/${failed.name}` : '未知步骤';
}
