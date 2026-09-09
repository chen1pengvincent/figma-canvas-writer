#!/usr/bin/env node
// Dual-stack TCP relay for the split-host topology (docs/split-host.md).
// The plugin dials ws://localhost:9753/plugin and macOS resolves localhost to
// ::1 first, so the relay MUST bind both 127.0.0.1 and [::1] (the doctor's
// localhost check prints this machine's actual order).
//
// Usage:
//   node scripts/relay.mjs <listenPort> <targetHost> <targetPort> [listenHost]
// Default listenHost is loopback (dual-stack 127.0.0.1 + ::1) — the Figma side
// needs exactly this. The bridge side must expose the port to the network:
//   node scripts/relay.mjs 9754 127.0.0.1 9753 0.0.0.0
// (also binds [::] when available). Exposure is opt-in and warned: the
// relayed stream is plaintext (HMAC protects integrity only — the bridge does
// not encrypt). Prefer the SSH-tunnel topology in docs/split-host.md.
import net from 'node:net';

const [, , listenPortArg, targetHost, targetPortArg, listenHostArg] = process.argv;
const listenPort = Number(listenPortArg);
const targetPort = Number(targetPortArg);
const exposed = listenHostArg === '0.0.0.0' || listenHostArg === '::';
if (!Number.isSafeInteger(listenPort) || listenPort < 1 || listenPort > 65535 ||
    !targetHost || !Number.isSafeInteger(targetPort) || targetPort < 1 || targetPort > 65535 ||
    (listenHostArg && listenHostArg !== 'loopback' && !exposed)) {
  console.error('用法: node scripts/relay.mjs <listenPort> <targetHost> <targetPort> [listenHost]');
  console.error('  listenHost: 省略或 loopback = 127.0.0.1 + ::1（Figma 侧）；0.0.0.0 = 对外监听（桥接侧，明文暴露会打印警告）');
  process.exit(2);
}
if (exposed) console.error('[warn] 对外监听：链路为明文（HMAC 仅保完整性），请限定可信网络或改用 docs/split-host.md 拓扑 A（SSH 隧道）');

const log = (...args) => console.log(new Date().toISOString(), ...args);

function bind(host) {
  const server = net.createServer(client => {
    const upstream = net.connect({ host: targetHost, port: targetPort });
    client.pipe(upstream).pipe(client);
    const teardown = () => { client.destroy(); upstream.destroy(); };
    client.on('error', teardown);
    upstream.on('error', teardown);
    client.on('close', teardown);
    upstream.on('close', teardown);
  });
  server.on('error', error => {
    if (error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT') {
      log(`[warn] ${host} 不可用（${error.code}）：本机回环只有单栈，插件若解析到 ::1 将无法连接（docs/split-host.md）`);
      return;
    }
    log(`[error] ${host} 监听失败: ${error.message}`);
  });
  server.listen(listenPort, host, () => log(`relay ${host}:${listenPort} -> ${targetHost}:${targetPort} 已监听`));
}

const hosts = exposed ? ['0.0.0.0', '::'] : ['127.0.0.1', '::1'];
for (const host of hosts) bind(host);
