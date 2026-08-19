# Linux Web 架构

## 目标

`linux` 分支采用纯 Linux Web 架构：浏览器只提供设置与诊断界面，Node.js 服务负责本地系统能力。项目不包含 Electron 主进程、preload、IPC、托盘、桌面窗口或内嵌 ChatGPT。

## 总体结构

```text
Browser
  │
  │ HTTP JSON + Server-Sent Events
  ▼
web/server.js
  │
  ├─ SettingsStore / SecretStore / LogService
  ├─ EnvironmentService / ProxyService
  ├─ RuntimeOrchestrator
  │    ├─ NativeService ──> python3 -m coding_tools_mcp
  │    └─ TunnelService ──> resources/tools/tunnel-client
  ├─ HealthService
  └─ BuildVerificationService
```

默认监听：

- Web 管理服务：`0.0.0.0:17654`
- Coding Tools MCP：`127.0.0.1:18765`
- Tunnel health/UI：`127.0.0.1:18081`

Web 监听地址可通过 `WEB_HOST` 覆盖；MCP 与 Tunnel health/UI 的绑定地址保持 loopback。

Web 页面、REST API 和 SSE 共用服务端密码会话。登录成功后服务端签发内存会话 Cookie，Cookie 设置为 `HttpOnly` 和 `SameSite=Strict`；服务重启后需要重新登录。默认密码可通过 `WEB_PASSWORD` 覆盖。

## 浏览器层

`renderer/index.html` 是唯一管理页面入口。

`renderer/web-api.js` 把原来的桌面 API 契约改成：

- `fetch()` 调用 REST API。
- `EventSource` 接收 SSE。
- `window.open(..., '_blank')` 打开受允许的外部页面。

管理页包括运行状态、部署、工作目录、任务、构建验证、健康检查、日志、使用指南和设置。不再存在 ChatGPT 内嵌页面。

## HTTP API

主要 REST 接口：

```text
GET    /api/snapshot
POST   /api/settings
POST   /api/workspace/switch
POST   /api/workspace/roots
POST   /api/secrets/runtime-key
DELETE /api/secrets/runtime-key
POST   /api/secrets/mcp-token/regenerate
POST   /api/runtime/start
POST   /api/runtime/stop
POST   /api/runtime/restart
GET    /api/logs
DELETE /api/logs
GET    /api/task-state
DELETE /api/task-state
GET    /api/task-history
GET    /api/build
POST   /api/build/run
GET    /api/health
POST   /api/health/repair
GET    /api/events
```

响应统一为：

```json
{"ok":true,"data":{}}
```

或：

```json
{"ok":false,"error":"message"}
```

SSE 事件：

```text
runtime:progress
runtime:status
runtime:heartbeat
logs:entry
build:progress
```

## Linux 路径

`src/paths.js` 使用 XDG 目录：

```text
${XDG_CONFIG_HOME:-~/.config}/web-mcp-assistant
${XDG_STATE_HOME:-~/.local/state}/web-mcp-assistant
```

工作区和额外授权根目录必须是 Linux 绝对路径。WSL 中的 Windows 文件应使用 `/mnt/<drive>/...` 形式。

## 配置与密钥

设置保存在：

```text
~/.config/web-mcp-assistant/settings.json
```

敏感值保存在：

```text
~/.config/web-mcp-assistant/secrets.json
```

密钥目录为 `0700`，密钥文件为 `0600`。服务内部可读取明文用于启动 Tunnel/MCP，但 Web API 仅返回布尔状态。

## Python 与 Coding Tools MCP

不再下载或维护便携 Python。

`EnvironmentService` 只检测：

```text
python3
python
```

版本必须为 3.11+。

`NativeService` 使用系统 Python 启动仓库内的 `coding_tools_mcp`：

```text
python3 -m coding_tools_mcp \
  --workspace <linux-absolute-path> \
  --host 127.0.0.1 \
  --port <mcp-port> \
  --permission-mode <mode>
```

`PYTHONPATH` 指向仓库内的 Coding Tools MCP 源码和 `python_vendor`。

## Tunnel

Linux Tunnel 二进制按主机架构选择：

```text
x64:   resources/tools/tunnel-client
arm64: resources/tools/tunnel-client-linux-arm64
```

`TunnelService` 以环境变量传入 Runtime API Key 和 MCP Bearer Token，不把密钥直接写进命令行参数。

关键参数包括：

```text
run
--control-plane.tunnel-id
--control-plane.api-key env:CONTROL_PLANE_API_KEY
--health.listen-addr 127.0.0.1:<port>
--mcp.server-url url=http://127.0.0.1:<port>/mcp,channel=main
--mcp.extra-headers Authorization: env:MCP_RUNTIME_HEADER_VALUE
--mcp.discovery-extra-headers Authorization: env:MCP_RUNTIME_HEADER_VALUE
```

仓库当前携带 OpenAI `tunnel-client` v0.0.10 Linux x64 与 arm64 官方产物。

启动器读取 ELF machine 字段并优先原生执行。若 arm64 部署缺少原生文件但仍有旧 x86_64 客户端，会自动兼容回退：

```text
qemu-x86_64 -L /usr/x86_64-linux-gnu resources/tools/tunnel-client ...
```

## 原生单文件发布

`npm run build:native` 使用 Node SEA 生成当前 Linux 架构的 ELF。JavaScript 由 esbuild 合并，`renderer/` 与 `resources/` 作为 SEA assets 嵌入。启动时由 `native/entry.js` 按内容 build ID 释放到 XDG cache，再通过以下覆盖路径复用原有服务代码：

```text
WEB_MCP_RENDERER_ROOT
WEB_MCP_RESOURCES_ROOT
```

发布 ELF 不依赖系统 Node.js；Coding Tools MCP 仍使用系统 Python 3.11+。arm64 发布只嵌入 arm64 Tunnel，x64 发布只嵌入 x64 Tunnel。

## 进程生命周期

运行状态保存在：

```text
~/.local/state/web-mcp-assistant/runtime-state.json
```

只对该文件中由本程序记录的 MCP/Tunnel PID 执行停止操作。

停止流程：

```text
SIGTERM
  ↓ 等待
仍存活
  ↓
SIGKILL
```

不再调用 `taskkill.exe` 或任何 Windows 进程管理命令。

## 代理

代理来源只有：

- `HTTPS_PROXY`
- `https_proxy`
- `HTTP_PROXY`
- `http_proxy`
- 用户手工输入的 HTTP(S) URL
- 自动模式检测到的常见 localhost HTTP 代理端口

不访问 Windows 注册表，不调用 `netsh.exe`。

## 构建验证

构建验证支持 Node.js、Python、Rust 和 Go 项目检测。

用户明确发起后，命令通过：

```text
/bin/sh -lc <command>
```

执行。

产物路径必须位于工作区内部，符号链接不会被遍历；产物文件计算 SHA-256。

## 启停状态机

启动大致顺序：

```text
加载设置
  ↓
检查工作区 / Python / Tunnel 二进制 / 密钥 / 端口 / 代理
  ↓
确保 MCP 本地认证 Token
  ↓
启动 Coding Tools MCP
  ↓
确认 MCP 运行
  ↓
启动 tunnel-client
  ↓
确认 Tunnel health 端口
  ↓
发布 runtime:status / heartbeat
```

停止顺序为 Tunnel -> MCP。

## 不再存在的桌面能力

Linux Web 分支明确删除：

- Electron `BrowserWindow` / `WebContentsView`
- preload / IPC
- Tray
- ChatGPT Cookie/session 管理
- `safeStorage` / DPAPI
- Windows 开机启动
- 窗口关闭后驻留逻辑
- NSIS / electron-builder
- Windows `.exe` 工具
- Windows 系统代理读取逻辑

这些能力不是兼容层，而是从该分支中移除。
