# Linux Web 版开发方案

## 1. 分支定位

当前 `linux` 分支是 **纯 Linux Web 版本**，不再兼容 Windows，也不保留 Electron 桌面端。

最终形态：

```text
Browser
  │ HTTP / SSE
  ▼
Linux Node.js Web Server
  │
  ├─ 管理设置页面
  ├─ Coding Tools MCP
  ├─ OpenAI Tunnel
  ├─ 工作区/权限
  ├─ 任务状态
  ├─ 构建验证
  ├─ 健康检查
  └─ 日志
```

明确删除：

- Electron 主进程、preload、IPC、Tray、BrowserWindow。
- `ChatViewController`、`WebContentsView`、ChatGPT 内嵌网页及登录 Session。
- Windows DPAPI / `safeStorage`。
- `winget.exe`、`where.exe`、`taskkill.exe`、`cmd.exe`、`reg.exe`、`netsh.exe`。
- `.exe` 版 `tunnel-client`、`rg`、`fd`。
- NSIS、electron-builder、Windows 安装脚本和 Windows 专用配置。

## 2. 推荐架构

```text
renderer/
  ├─ index.html
  ├─ app.js
  ├─ styles.css
  └─ web-api.js
        │ fetch / EventSource
        ▼
web/server.js
        │
        ▼
src/services/
  ├─ settingsStore.js
  ├─ secretStore.js
  ├─ environmentService.js
  ├─ runtimeOrchestrator.js
  ├─ nativeService.js
  ├─ tunnelService.js
  ├─ healthService.js
  ├─ buildVerificationService.js
  ├─ logService.js
  └─ jsonStore.js
```

现有管理中心是普通 HTML/CSS/JS，可以继续复用。核心改造是把：

```text
window.mcpAssistant → Electron preload → IPC
```

替换为：

```text
window.mcpAssistant → web-api.js → REST/SSE → web/server.js
```

`web-api.js` 尽量保持现有 `window.mcpAssistant` 方法名和返回结构，使 `renderer/app.js` 少改。

## 3. 目录调整

将可复用业务代码从 `electron/services/` 移到 `src/services/`，完成后删除整个 `electron/` 目录。

建议最终目录：

```text
web-mcp-assistant/
├─ web/
│  └─ server.js
├─ src/
│  ├─ paths.js
│  └─ services/
├─ renderer/
│  ├─ index.html
│  ├─ app.js
│  ├─ web-api.js
│  └─ styles.css
├─ resources/
│  ├─ coding-tools-mcp/
│  └─ tools/
├─ tests/
├─ docs/
└─ package.json
```

## 4. Linux 平台改造

### 路径

不再依赖 `electron.app.getPath()`。

建议使用：

```text
配置：${XDG_CONFIG_HOME:-~/.config}/web-mcp-assistant/
状态：${XDG_STATE_HOME:-~/.local/state}/web-mcp-assistant/
```

保存：

```text
settings.json
secrets.json
runtime-state.json
logs/
```

工作区中的 `.coding-tools/` 结构保持不变。

### 密钥

删除 Electron `safeStorage`。

第一版使用本地 `secrets.json`：

- 文件权限固定 `0600`。
- 所在目录权限建议 `0700`。
- Web API 只能返回密钥是否存在，不能返回明文。
- Runtime API Key 和 MCP Token 不写入普通日志。

### Python

只检测 Linux：

```text
python3
python
```

要求 Python 3.11+。不在 Web 服务里自动执行 `apt install`，缺失时提示用户安装。

### 进程管理

启动继续使用 Node `spawn()`。

停止流程：

```text
SIGTERM
→ 等待进程退出
→ 超时后 SIGKILL
```

需要避免误杀非本程序启动的进程，继续通过 `runtime-state.json` 中保存的 PID 和运行状态进行管理。

### 构建命令

将：

```text
cmd.exe /c <command>
```

替换为：

```text
/bin/sh -lc <command>
```

原有工作区边界、命令长度检查、超时和产物路径限制继续保留。

### 代理

删除 Windows 注册表和 WinHTTP 检测。

Linux 只考虑：

```text
HTTPS_PROXY
HTTP_PROXY
https_proxy
http_proxy
```

以及现有手动代理和常见本地代理端口探测。

## 5. Linux 工具文件

当前 `resources/tools/` 中的：

```text
fd.exe
rg.exe
tunnel-client.exe
```

在该分支全部删除。

Linux 版需要：

```text
resources/tools/tunnel-client
```

并保证可执行权限：

```bash
chmod +x resources/tools/tunnel-client
```

`rg`、`fd` 优先直接使用 Linux 系统命令；如果后续希望免安装，再单独打包 Linux 二进制。

**开发前置条件：必须先确认可用的 Linux `tunnel-client` 二进制及其参数与当前 Windows 版一致。**

## 6. Web API

使用 HTTP API 替代 Electron IPC，SSE 替代 IPC 事件推送。

最小接口：

```text
GET  /api/snapshot
POST /api/settings
POST /api/workspace/switch
POST /api/workspace/roots

POST /api/secrets/runtime-key
DELETE /api/secrets/runtime-key
POST /api/secrets/mcp-token/regenerate

POST /api/runtime/start
POST /api/runtime/stop
POST /api/runtime/restart

GET  /api/logs
DELETE /api/logs

GET  /api/task-state
GET  /api/task-history

GET  /api/build
POST /api/build/run

GET  /api/health
POST /api/health/repair

GET  /api/events
```

返回结构继续保持：

```json
{ "ok": true, "data": {} }
```

失败：

```json
{ "ok": false, "error": "错误信息" }
```

`/api/events` 使用 SSE 推送：

```text
runtime:progress
runtime:status
runtime:heartbeat
logs:entry
build:progress
```

## 7. 管理页面调整

保留现有管理中心，但删除所有桌面端和网页嵌入相关 UI。

必须删除或修改：

- 删除 Electron 自定义标题栏和关闭按钮。
- 删除“清除 ChatGPT 登录数据”。
- 删除“关闭窗口后保持服务运行”。
- 删除“Windows 安全存储”文案。
- 删除“Windows 系统代理”文案。
- 删除内嵌 ChatGPT 的所有入口和说明。
- 工作目录选择改为输入 Linux 绝对路径并由服务端校验。
- 外部链接直接由浏览器打开。

页面仍保留：

```text
总览
运行与连接
工作区与权限
任务状态
构建验证
诊断与修复
接入指南
运行日志
偏好设置
```

## 8. Web 服务安全

Web 管理服务默认监听：

```text
0.0.0.0
```

这样同一局域网内的设备可以直接打开管理页面。页面、REST API 和 SSE 统一使用服务端密码会话认证，登录页只要求输入密码。

会话 Cookie 使用 `HttpOnly` 和 `SameSite=Strict`，服务重启后失效。默认密码可通过 `WEB_PASSWORD` 覆盖。当前没有 TLS，只应在可信局域网使用，不应映射到公网。

MCP 和 Tunnel 健康端口同样继续绑定 `127.0.0.1`。

如需恢复仅本机访问，使用 `WEB_HOST=127.0.0.1 npm start`。需要跨越不可信网络时，应增加 TLS、更细粒度授权和反向代理。

## 9. package.json 调整

删除：

```text
electron
electron-builder
electron-updater
```

删除 Windows 打包脚本和 `build.win` / `nsis` 配置。

Linux 分支直接把 Web 服务作为默认启动入口：

```json
{
  "scripts": {
    "start": "node web/server.js",
    "test": "node --test tests/*.test.js"
  }
}
```

如 Web Server 采用 Express，则把 `express` 放入 `dependencies`；不要再保留 Electron 运行时依赖。

## 10. 实施顺序

1. 删除网页嵌入、Electron 和 Windows 专用文件/依赖。
2. 将 `electron/services/` 中可复用代码迁移到 `src/services/`。
3. 实现 Linux `paths.js`、密钥存储、Python 检测和进程管理。
4. 改造 `NativeService`、`TunnelService`、构建验证和代理检测为 Linux 实现。
5. 准备 Linux `tunnel-client`。
6. 新增 `web/server.js`，将原 IPC 能力映射成 REST/SSE。
7. 新增 `renderer/web-api.js`，保持现有前端 API 契约。
8. 清理管理页面中的 Windows/Electron/内嵌 ChatGPT 内容。
9. 补 Linux 单元测试和端到端启动测试。

## 11. 启动方式

环境：

```text
Linux
Node.js 22+
Python 3.11+
Linux tunnel-client
```

启动：

```bash
npm install
npm start
```

也可以生成并运行当前架构的原生 ELF：

```bash
npm run build:native
./dist/web-mcp-assistant-linux-$(uname -m | sed 's/aarch64/arm64/;s/x86_64/x64/')
```

原生 ELF 内嵌 Node、网页、MCP 代码和对应架构 Tunnel，运行时仅保留 Python 3.11+ 系统依赖。

访问：

```text
http://<设备局域网 IP>:<web-port>
```

后续正式部署可增加 systemd service，使 Web 服务和配置完整时的 MCP/Tunnel 随系统启动。

## 12. 验收标准

- Linux 上执行 `npm start` 可以直接启动 Web 管理服务。
- 项目运行时不存在 Electron 进程和 Electron 依赖。
- 仓库中不存在 Windows 专用 `.exe` 和 Windows 启动逻辑。
- 浏览器只显示管理中心，不包含任何网页嵌入区域。
- 设置、工作区、任务、日志、构建和诊断正常工作。
- MCP 和 Tunnel 可以启动、停止、重启并实时更新状态。
- Python、进程终止、Shell、代理检测全部走 Linux 实现。
- Runtime API Key 不通过读取接口返回明文。
- 未登录请求不能访问管理页面、REST API 或 SSE。
- Web 管理端默认监听 `0.0.0.0`；MCP 与 Tunnel 管理端口只监听 `127.0.0.1`。
- `npm run build:native` 可以生成可独立启动的当前架构 Linux ELF。
