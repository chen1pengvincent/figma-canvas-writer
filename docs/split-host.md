# Split-host 拓扑：Agent 与 Figma Desktop 分离

适用场景：Agent（及其 MCP 宿主）在远端机器（Linux pod / 服务器），Figma Desktop 在本地 Mac/Windows。本文是唯一官方指导；实践来源见仓库外交接文档（2026-09-09 安装实践）。

## 1. 不可变约束（先读）

1. **插件只认 `ws://localhost:9753/plugin`**（硬编码，无配置项）。
2. **桥接绑定 127.0.0.1 + [::1] 双栈**；当系统不支持 IPv6 回环时仅监听 127.0.0.1 并打日志（`figma_canvas_status.listenHosts` 反映实际监听，容器 Linux 常见仅 v4）。
3. **桥接的 WS 升级校验要求 TCP 对端是回环地址**（`127.0.0.1`/`::1`）。因此：**最终一跳的中继必须落在桥接宿主机的本机回环上**——这就是"双跳中继"设计的原因：
   - 远端机：`0.0.0.0:<对外端口>` → `127.0.0.1:9753`（落在桥接本机回环，满足升级校验）
   - 本地机：`localhost:9753`（v4+v6 双栈）→ `远端机IP:<对外端口>`
4. **HMAC 提供鉴权与完整性，不加密**。跨机链路是明文：优先用拓扑 A（SSH 隧道，自带加密）；仅可信网络用拓扑 B。
5. 端口 9753 与单桥接约束不变；不要用端口环境变量绕过。

## 2. 拓扑 A：SSH 隧道（推荐，自带加密）

在**本地机**（Figma Desktop 所在）执行：

```sh
# 把本地 9753 转发到远端机的 127.0.0.1:9753（桥接在远端机）
ssh -N -L 127.0.0.1:9753:127.0.0.1:9753 -L '[::1]:9753:[::1]:9753' user@远端机
```

keep-alive 配置（`~/.ssh/config`）防断连：

```
Host fcw-relay
  HostName 远端机
  ServerAliveInterval 30
  ServerAliveCountMax 4
  ExitOnForwardFailure yes
```

- 优点：链路加密（补足 I4 明文约束）、不需要在两端装中继脚本。
- 注意 `-L '[::1]:...'` 显式绑定 IPv6 回环：macOS 上 localhost 优先解析 `::1`，只绑 v4 等于没装（用 `node scripts/doctor.mjs` 查看本机解析顺序）。
- 断线重连：`ExitOnForwardFailure` + 外层 `autossh`（或 launchd/systemd KeepAlive）负责拉起。

## 3. 拓扑 B：裸 TCP 双跳中继（fallback，明文）

远端机（桥接侧，对外端口 → 桥接本机回环）：

```sh
node scripts/relay.mjs 9754 127.0.0.1 9753 0.0.0.0
# 第四参数 0.0.0.0 = 对外监听（自动打印明文暴露警告，同时尝试绑定 [::]）。
# 如只给受信网段使用，可加防火墙限制来源地址。
```

本地机（Figma 侧，`localhost:9753` 双栈 → 远端机对外端口）：

```sh
node scripts/relay.mjs 9753 远端机IP 9754
```

`scripts/relay.mjs` 特性：双栈绑定（127.0.0.1 + [::1]），`::1` 不可用时打警告而不是静默失败；每条连接透传并在断开时清理。

### macOS launchd 模板（KeepAlive 守护中继）

保存为 `~/Library/LaunchAgents/com.fcw.relay.plist`（占位符按实际替换）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.fcw.relay</string>
  <key>ProgramArguments</key>
  <array>
    <!-- launchd 无 PATH，必须写 node 绝对路径（Homebrew ARM: /opt/homebrew/bin/node） -->
    <string>NODE_ABSOLUTE_PATH</string>
    <string>REPO_PATH/scripts/relay.mjs</string>
    <string>9753</string>
    <string>REMOTE_IP</string>
    <string>9754</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>REPO_PATH/relay.log</string>
  <key>StandardErrorPath</key><string>REPO_PATH/relay.err.log</string>
</dict>
</plist>
```

```sh
launchctl load ~/Library/LaunchAgents/com.fcw.relay.plist
launchctl list | grep fcw.relay   # 验证
```

### Linux systemd 模板（远端机侧）

保存为 `/etc/systemd/system/fcw-relay.service`：

```ini
[Unit]
Description=figma-canvas-writer relay (0.0.0.0:9754 -> 127.0.0.1:9753)
After=network.target

[Service]
ExecStart=/usr/bin/node /path/to/repo/scripts/relay.mjs 9754 127.0.0.1 9753 0.0.0.0
Restart=always
RestartSec=5
User=YOUR_USER

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl enable --now fcw-relay
```

## 4. 安装与验证清单

1. **远端机**：`git clone` + `node install.mjs`（装 bridge 依赖）；按上文把对外端口接进本机回环。
2. **本地机**：无需完整仓库——但导入插件需要 `plugin/manifest.json`，建议也 clone 一份。
3. **本地机**：按拓扑 A 或 B 把 `localhost:9753` 接到远端桥接（**双栈**）。
4. **预检**：`node scripts/doctor.mjs`（本机 Node/ws/解析顺序/密钥/9753 占用者身份/Figma 运行状态，纯只读）。
5. **连通性探针**（不消耗授权，可随时做）：

   ```sh
   curl -s -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
        -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
        http://localhost:9753/plugin | head -c 400
   ```

   预期首帧形如 `{"type":"challenge","protocol":3,...}`。若出现 `{"type":"challenge","challenge":...}`（无 protocol 字段）说明 9753 上是**旧版本桥**——doctor 会报 WARN。
6. **Figma Desktop**：导入 `plugin/manifest.json` → 运行 **Figma Canvas Writer 3** → 粘贴密钥（远端桥接的密钥！本地机没有桥接）→ 连接。
7. **验收**：`npm run smoke`（五步冒烟：状态 → 建节点 → 截图 → 删除 → 清理）。

## 5. 已知陷阱

| 陷阱 | 症状 | 解法 |
|---|---|---|
| macOS `localhost` 优先 `::1` | 中继只绑 v4 时插件永远连不上 | 中继/隧道双栈绑定；doctor 会打印本机解析顺序 |
| 9753 被旧版桥/其他进程占用 | 插件报「密钥验证失败」或「另一个插件已连接」 | `node scripts/doctor.mjs` 识别占用者身份，按提示停止 |
| 中继落点不在桥接宿主回环 | 桥接升级校验拒绝（403） | 双跳中继：对外端口必须转进桥接本机 127.0.0.1 |
| 桥接进程随 MCP 客户端退出 | 重启后须重连 | 桥接生命周期归宿主管理；中继才需要 launchd/systemd 守护 |
| 明文链路 | 帧内容可被网络观察 | 用拓扑 A（SSH）；或接受拓扑 B 风险并限定可信网络 |
