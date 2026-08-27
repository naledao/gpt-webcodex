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
GET    /api/instructions/preview
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

MCP 初始化和 `server/discover` 只返回前 512 字符内的精简指令加载路由，不包含本地规则正文。`workspace_context` 与 `agent_workflow` 共用 `ProjectContext.applicable_instructions()`，按“全局、项目根、从浅到深的项目子目录”装配目标路径适用规则；越具体的规则优先级越高，多目标任务通过 `applicable_to` 保留各自作用域。

相关请求会先重新计算规则快照签名。新增、修改或删除规则后，Runtime 会原子替换快照并同时清理工作区快速缓存和编码上下文缓存；缓存键还包含规则 revision。正文分享由 `instructionSharingMode=off|metadata|content` 控制，升级默认使用 `metadata`。Web 管理页通过经过登录保护的 `/api/instructions/preview` 提供本地预览，切换分享模式会加入 Runtime 指纹并重建 MCP。

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

x64 WSL2 也可以执行 `npm run build:native:arm64`。交叉构建器在项目 `.cache/cross-arm64/` 下准备便携 QEMU、官方 Node arm64 和 Ubuntu arm64 cross sysroot，再让目标架构 Node 生成 SEA blob；x64 esbuild 只负责生成与架构无关的 CommonJS bundle。整个过程不注册 binfmt、不要求 Docker 或 root 权限。WSL 无法直接访问 Windows 回环代理时，下载器会自动通过 Windows `curl.exe` 使用同一代理。

## GitHub Release 更新链路

`src/services/githubReleaseResolver.js` 通过 GitHub API 从新到旧分页遍历正式 Release，跳过 Draft、Prerelease、非稳定语义版本以及不含当前架构资产的版本。`src/services/updateService.js` 再按 `process.arch` 精确选择固定名称的 x64 或 arm64 ELF。元数据和资产下载复用应用的代理选择；`src/services/httpClient.js` 对 HTTPS 目标实现 HTTP(S) 代理 CONNECT、重定向和流式读取。

```text
Stable Release pages
  → newest matching Linux architecture
  → semantic version comparison
  → architecture-specific asset
  → streamed temporary file
  → size + SHA-256 + ELF machine verification
  → .previous backup
  → atomic rename
  → new-ELF restart helper
  → old PID exit
  → bind original Web port
```

更新状态写入 XDG state 的 `update-state.json`，下载暂存于 `updates/`，更新日志写入 `logs/update.log`。Web 更新接口必须通过现有登录会话；源码模式、非 Linux 平台、不支持的架构和不可写安装目录都会在替换前被拒绝。

重启助手由已经校验并完成替换的新 ELF 自己运行。它在旧 Web 进程退出后更新控制脚本的 PID/start-time 跟踪文件，再启动服务。如果新版无法完成资源释放或监听 Web 端口，会把当前文件改名为 `.failed`，将 `.previous` 恢复到原路径并启动旧版本。

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
