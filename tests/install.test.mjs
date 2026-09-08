import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { install, findNpmCli, createConfigurations, assertNodeVersion } from '../install.mjs';

const installerPath = fileURLToPath(new URL('../install.mjs', import.meta.url));

function fixture(t, npmBody) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'figma installer 空格 '));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'project 空格');
  const bridge = path.join(root, 'bridge');
  fs.mkdirSync(path.join(bridge, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(bridge, 'package.json'), '{"type":"module"}\n');
  fs.writeFileSync(path.join(bridge, 'package-lock.json'), '{}\n');
  const npmCliPath = path.join(directory, 'npm-cli.js');
  fs.writeFileSync(npmCliPath, npmBody);
  return { root, bridge, npmCliPath };
}

const successfulNpm = `
  const fs = require('node:fs');
  fs.writeFileSync('npm-invocation.json', JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));
  fs.mkdirSync('node_modules/ws', { recursive: true });
  fs.writeFileSync('node_modules/ws/package.json', '{"main":"index.js","version":"8.21.3"}');
  fs.writeFileSync('node_modules/ws/index.js', 'exports.WebSocketServer = class WebSocketServer {};');
`;

test('残缺 node_modules 仍执行 npm ci，空格路径配置仅写到 generated-config', (t) => {
  const { root, bridge, npmCliPath } = fixture(t, successfulNpm);
  const userConfiguration = path.join(root, 'existing-user-config.json');
  fs.writeFileSync(userConfiguration, '{"keep":true}\n');
  const { outputDirectory } = install({ repositoryRoot: root, npmCliPath, log() {} });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(bridge, 'npm-invocation.json'))), {
    cwd: fs.realpathSync(bridge), args: ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
  });
  assert.equal(outputDirectory, path.join(root, 'generated-config'));
  const actual = JSON.parse(fs.readFileSync(path.join(outputDirectory, 'cursor-mcp.json'))).mcpServers['figma-canvas-writer'];
  assert.deepEqual(actual, { command: process.execPath, args: [path.join(bridge, 'mcp-bridge.js')] });
  assert.equal(fs.readFileSync(userConfiguration, 'utf8'), '{"keep":true}\n');
  assert.equal(fs.readdirSync(outputDirectory).length, 6);
});

test('npm 失败保留退出码且不生成配置', (t) => {
  const { root, npmCliPath } = fixture(t, 'process.exit(42);');
  assert.throws(() => install({ repositoryRoot: root, npmCliPath, log() {} }),
    (error) => error.exitCode === 42 && /npm ci 失败/.test(error.message));
  assert.equal(fs.existsSync(path.join(root, 'generated-config')), false);
});

test('npm 假成功但 ws 缺失时仍报失败', (t) => {
  const { root, npmCliPath } = fixture(t, 'process.exit(0);');
  assert.throws(() => install({ repositoryRoot: root, npmCliPath, log() {} }), /本地 ws 依赖不可用/);
  assert.equal(fs.existsSync(path.join(root, 'generated-config')), false);
});

test('缺少 lockfile 时不运行 npm、不生成配置', (t) => {
  const { root, bridge, npmCliPath } = fixture(t, successfulNpm);
  fs.unlinkSync(path.join(bridge, 'package-lock.json'));
  assert.throws(() => install({ repositoryRoot: root, npmCliPath, log() {} }), /缺少 bridge\/package-lock.json/);
  assert.equal(fs.existsSync(path.join(bridge, 'npm-invocation.json')), false);
});

test('CLI 向调用方传播 npm 非零退出码', (t) => {
  const { root, npmCliPath } = fixture(t, 'process.exit(42);');
  const localInstaller = path.join(root, 'install.mjs');
  fs.copyFileSync(installerPath, localInstaller);
  const result = spawnSync(process.execPath, [localInstaller], {
    cwd: os.tmpdir(), env: { ...process.env, npm_execpath: npmCliPath }, encoding: 'utf8', shell: false,
  });
  assert.equal(result.status, 42);
  assert.match(result.stderr, /安装失败.*退出码 42/);
  assert.equal(fs.existsSync(path.join(root, 'generated-config')), false);
});

test('JSON、TOML、YAML 配置均将 Windows 空格和反斜杠路径作为单个字符串', () => {
  const nodePath = 'C:\\Program Files\\nodejs\\node.exe';
  const bridgePath = 'C:\\Users\\设计 师\\figma-canvas-writer\\bridge\\mcp-bridge.js';
  const configurations = createConfigurations(nodePath, bridgePath);
  for (const name of ['claude_desktop_config.json', 'cursor-mcp.json', 'windsurf-mcp_config.json']) {
    const entry = JSON.parse(configurations[name]).mcpServers['figma-canvas-writer'];
    assert.deepEqual(entry, { command: nodePath, args: [bridgePath] });
  }
  assert.deepEqual(JSON.parse(configurations['vscode-mcp.json']).servers['figma-canvas-writer'], {
    type: 'stdio', command: nodePath, args: [bridgePath],
  });
  const toml = configurations['codex-config.toml'];
  assert.equal(JSON.parse(toml.match(/^command = (.+)$/m)[1]), nodePath);
  assert.deepEqual(JSON.parse(toml.match(/^args = (.+)$/m)[1]), [bridgePath]);
  const yaml = configurations['dsh-cordis-patch.yml'];
  assert.equal(JSON.parse(yaml.match(/^        command: (.+)$/m)[1]), nodePath);
  assert.equal(JSON.parse(yaml.match(/^          - (.+)$/m)[1]), bridgePath);
});

test('Node 最低版本和 npm 缺失给出明确错误', () => {
  assert.throws(() => assertNodeVersion('18.20.0'), /Node.js >= 20/);
  assert.doesNotThrow(() => assertNodeVersion('20.0.0'));
  assert.throws(() => findNpmCli({ nodeExecutable: '/nonexistent/node', env: {} }), /未找到 npm-cli.js/);
});

test('Windows 常见 Node 目录布局可直接发现 npm CLI，无需 cmd shell', (t) => {
  const { root } = fixture(t, '');
  const nodeDirectory = path.join(root, 'Program Files', 'nodejs');
  const npmCliPath = path.join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  fs.mkdirSync(path.dirname(npmCliPath), { recursive: true });
  fs.writeFileSync(npmCliPath, '');
  assert.equal(findNpmCli({ nodeExecutable: path.join(nodeDirectory, 'node.exe'), env: {} }), npmCliPath);
});
