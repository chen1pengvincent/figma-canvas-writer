#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const REPOSITORY_ROOT = path.dirname(fileURLToPath(import.meta.url));

export function assertNodeVersion(version = process.versions.node) {
  if (Number(version.split('.')[0]) < 20) {
    throw new Error(`需要 Node.js >= 20，当前为 ${version}。请安装包含 npm 的 Node.js。`);
  }
}

// 直接由当前 Node 执行 npm CLI，避免 Windows .cmd、空格路径和 shell 转义差异。
export function findNpmCli({ nodeExecutable = process.execPath, env = process.env } = {}) {
  const nodeDirectory = path.dirname(nodeExecutable);
  const candidates = [
    env.npm_execpath,
    path.join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(nodeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const directory of (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
    try { candidates.push(fs.realpathSync(path.join(directory, 'npm'))); } catch { /* 下一个 PATH 项 */ }
  }
  const result = candidates.find((candidate) => candidate &&
    path.basename(candidate) === 'npm-cli.js' && fs.existsSync(candidate));
  if (!result) throw new Error('未找到 npm-cli.js。请安装包含 npm 的 Node.js，并确保 npm 在 PATH 中。');
  return path.resolve(result);
}

export function createConfigurations(nodeExecutable, bridgePath) {
  const entry = { command: nodeExecutable, args: [bridgePath] };
  const generic = JSON.stringify({ mcpServers: { 'figma-canvas-writer': entry } }, null, 2) + '\n';
  const quote = JSON.stringify;
  return {
    'claude_desktop_config.json': generic,
    'cursor-mcp.json': generic,
    'windsurf-mcp_config.json': generic,
    'vscode-mcp.json': JSON.stringify({ servers: { 'figma-canvas-writer': { type: 'stdio', ...entry } } }, null, 2) + '\n',
    'codex-config.toml': '# 合并到现有配置；请勿覆盖整个配置文件。\n[mcp_servers.figma-canvas-writer]\n' +
      `command = ${quote(nodeExecutable)}\nargs = [${quote(bridgePath)}]\n`,
    'dsh-cordis-patch.yml': '# 配置形状示例，需按当前 DSH 版本核对；请勿覆盖现有配置。\n- insert:\n' +
      "    - id: figma-canvas-writer\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n" +
      '        serverName: figma-canvas-writer\n        transport: stdio\n' +
      `        command: ${quote(nodeExecutable)}\n        args:\n          - ${quote(bridgePath)}\n`,
  };
}

export function install({ repositoryRoot = REPOSITORY_ROOT, npmCliPath, log = console.log } = {}) {
  assertNodeVersion();
  const root = path.resolve(repositoryRoot);
  const bridgeDirectory = path.join(root, 'bridge');
  if (!fs.existsSync(path.join(bridgeDirectory, 'package-lock.json'))) {
    throw new Error('缺少 bridge/package-lock.json；请恢复仓库中的 lockfile 后重试。');
  }
  const npmCli = npmCliPath || findNpmCli();
  log('按 lockfile 安装运行时依赖（npm ci --omit=dev --ignore-scripts），包括修复残缺的 node_modules…');
  const result = spawnSync(process.execPath,
    [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: bridgeDirectory, stdio: 'inherit', shell: false });
  if (result.error) throw new Error(`无法启动 npm：${result.error.message}`);
  if (result.status !== 0) {
    const error = new Error(`npm ci 失败（${result.signal ? `信号 ${result.signal}` : `退出码 ${result.status}`}），未生成新配置。`);
    error.exitCode = result.status || 1;
    throw error;
  }
  // 必须加载本次安装目录内的依赖，不能由父目录或全局依赖掩盖缺包。
  const wsDirectory = path.join(bridgeDirectory, 'node_modules', 'ws');
  const require = createRequire(path.join(bridgeDirectory, 'package.json'));
  try {
    if (!fs.statSync(path.join(wsDirectory, 'package.json')).isFile() ||
        typeof require(wsDirectory).WebSocketServer !== 'function') throw new Error('ws 导出无效');
  } catch (error) {
    throw new Error(`npm 返回成功，但本地 ws 依赖不可用：${error.message}`);
  }

  const outputDirectory = path.join(root, 'generated-config');
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const [filename, contents] of Object.entries(createConfigurations(process.execPath, path.join(bridgeDirectory, 'mcp-bridge.js')))) {
    fs.writeFileSync(path.join(outputDirectory, filename), contents);
  }
  log(`依赖与本机配置示例已就绪：${outputDirectory}`);
  log('下一步：将一个配置示例合并到 Agent 的现有 MCP 配置，再启动该 MCP 服务。');
  log(`随后将本机终端目录切换到 ${root}，运行 node bridge/mcp-bridge.js --show-pairing-key，取得配对密钥。`);
  log(`在 Figma Desktop 导入 ${path.join(root, 'plugin', 'manifest.json')}，打开有编辑权限的 Design 文件，运行 Figma Canvas Writer 3 并粘贴密钥。`);
  log('同一时刻只使用一个 Agent 实例；安装器不会修改 Agent 配置或启动桥接。');
  return { outputDirectory };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  if (process.argv.slice(2).length > 0) {
    console.error('用法：node install.mjs');
    process.exitCode = 1;
  } else {
    try { install(); }
    catch (error) {
      console.error(`安装失败：${error.message}`);
      process.exitCode = error.exitCode || 1;
    }
  }
}
