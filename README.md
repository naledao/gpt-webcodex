# Web MCP Assistant

面向 Linux 的本地 Web 管理器，用来启动和管理 Coding Tools MCP 与 OpenAI Secure MCP Tunnel。

当前 `linux` 分支只支持 Linux 运行方式，不包含 Electron、Windows API、桌面托盘、内嵌 ChatGPT 页面或 Windows `.exe` 工具。

## 架构

```text
Browser
  │  HTTP / SSE
  ▼
web/server.js   (0.0.0.0:17654)
  │
  ├─ src/services/*
  ├─ Coding Tools MCP   (127.0.0.1:18765)
  └─ tunnel-client      (127.0.0.1:18081 health/UI)
```

浏览器只负责管理界面。Node.js 服务负责配置、密钥、日志、进程生命周期、构建验证和 Tunnel 管理。

## 环境要求

- Linux；WSL2 Ubuntu 也可以。
- Node.js 22 或更高版本。
- Python 3.11 或更高版本，命令名为 `python3` 或 `python`。
- 源码运行时，`resources/tools/` 中必须有对应架构的 Linux Tunnel 二进制。

仓库当前包含 OpenAI `tunnel-client` v0.0.10 的 Linux x64 与 arm64 官方产物；引入时均使用上游 `SHA256SUMS.txt` 校验。arm64 和 x64 主机会优先直接执行各自的原生客户端，旧 x86_64 客户端在 arm64 上仍保留 QEMU 兼容回退。

## 在 WSL2 中运行

如果仓库位于 Windows：

```text
C:\codes\gpt-webcodex
```

在 Ubuntu 中对应：

```bash
cd /mnt/c/codes/gpt-webcodex
```

先确认 Linux 自己的运行时，而不是 Windows PATH 中的 `node.exe` / `npm.cmd`：

```bash
command -v node
node --version
command -v npm
npm --version
python3 --version
```

然后执行：

```bash
npm install
npm test
npm start
```

默认监听所有网卡。当前设备可从本机或局域网访问：

```text
http://127.0.0.1:17654
http://<设备局域网 IP>:17654
```

打开页面后只需输入 Web 管理密码。部署预设密码只以服务端校验值保存，也可以在启动前通过 `WEB_PASSWORD` 覆盖：

```bash
WEB_PASSWORD='新的密码' npm start
```

如需恢复为仅本机访问，可执行：

```bash
WEB_HOST=127.0.0.1 npm start
```

## 原生二进制

在目标 Linux 主机上执行：

```bash
npm install
npm run build:native
```

arm64 产物位于：

```text
dist/web-mcp-assistant-linux-arm64
dist/web-mcp-assistant-v0.1.6-linux-arm64.tar.gz
dist/SHA256SUMS-native.txt
```

直接运行：

```bash
./dist/web-mcp-assistant-linux-arm64
```

如需在后台运行并脱离当前终端，可直接使用控制脚本：

```bash
chmod +x scripts/web-mcp-assistantctl
scripts/web-mcp-assistantctl start
scripts/web-mcp-assistantctl status
scripts/web-mcp-assistantctl restart
scripts/web-mcp-assistantctl stop
scripts/web-mcp-assistantctl logs
scripts/web-mcp-assistantctl logs -f
```

也可以安装成全局命令：

```bash
sudo install -Dm755 dist/web-mcp-assistant-linux-arm64 /usr/local/libexec/web-mcp-assistant
sudo install -Dm755 scripts/web-mcp-assistantctl /usr/local/bin/web-mcp-assistantctl
web-mcp-assistantctl start
```

脚本使用 `setsid` 和 `nohup` 启动独立会话，并将 PID 与日志保存到：

```text
~/.local/state/web-mcp-assistant/web-manager.pid
~/.local/state/web-mcp-assistant/logs/web-manager.log
```

可通过 `WEB_MCP_BINARY` 指定其他二进制路径，通过 `WEB_MCP_STATE_DIR` 指定其他状态目录。

该 ELF 已内嵌 Node 服务、网页、Coding Tools MCP 和当前架构的 Tunnel 客户端。首次启动会把运行资源释放到：

```text
${XDG_CACHE_HOME:-~/.cache}/web-mcp-assistant/native/<build-id>/
```

arm64 发布包运行时不需要安装 Node.js、npm 或 QEMU，但仍需要系统提供 Python 3.11 或更高版本。配置、密钥和状态继续使用原有 XDG 目录，升级二进制不会清空现有配置。

## 工作目录

Web 页面不再调用桌面文件选择器。请直接填写 Linux 绝对路径，例如：

```text
/home/zq/project
/mnt/c/codes/example-project
```

不要填写：

```text
C:\codes\example-project
```

主工作目录与额外授权目录都必须是 Linux 绝对路径，并且必须真实存在。

## 配置与状态文件

配置目录：

```text
${XDG_CONFIG_HOME:-~/.config}/web-mcp-assistant
```

状态目录：

```text
${XDG_STATE_HOME:-~/.local/state}/web-mcp-assistant
```

主要文件：

```text
~/.config/web-mcp-assistant/settings.json
~/.config/web-mcp-assistant/secrets.json
~/.local/state/web-mcp-assistant/runtime-state.json
~/.local/state/web-mcp-assistant/logs/
```

`secrets.json` 的父目录使用 `0700`，文件使用 `0600`。REST API 只返回密钥是否存在，不返回密钥明文。

## 网络与代理

支持以下代理模式：

- `auto`：先尝试直连，再检测代理环境变量和常见本地代理端口。
- `environment`：读取 `HTTPS_PROXY`、`https_proxy`、`HTTP_PROXY`、`http_proxy`。
- `manual`：手工填写 `http://` 或 `https://` 代理。
- `direct`：强制直连。

代理 URL 不允许内嵌用户名或密码。

## OpenAI Tunnel 配置

在管理页面中填写：

1. Linux 工作目录。
2. Runtime API Key。
3. Tunnel ID。
4. 需要时设置代理。
5. 启动 MCP 与 Tunnel。

`tunnel-client` 通过本地 MCP 地址连接：

```text
http://127.0.0.1:18765/mcp
```

Tunnel 健康/UI 默认地址：

```text
http://127.0.0.1:18081/ui
```

随后在 ChatGPT 的连接器设置中配置对应 Tunnel。ChatGPT 本身不嵌入本项目页面。

## 常用命令

```bash
npm start       # 启动可从局域网访问的 Web 管理服务
npm test        # Node.js 测试
npm run check   # JavaScript 语法检查
npm run build:native # 生成当前 Linux 架构的原生 ELF
```

## 目录

```text
web/                     Node.js HTTP/SSE 服务
src/                     Linux 路径与核心服务
src/services/            配置、密钥、进程、MCP、Tunnel、健康检查等
renderer/                 纯浏览器管理页面
native/                   SEA 启动入口和内嵌资源释放逻辑
scripts/build-native.mjs  原生 ELF 构建脚本
scripts/web-mcp-assistantctl 后台启动、停止和重启脚本
resources/coding-tools-mcp/
resources/tools/tunnel-client
resources/tools/tunnel-client-linux-arm64
resources/tools/tunnel-client-LICENSE.txt
resources/tools/tunnel-client-SHA256SUMS.txt
tests/                   Linux Web 测试
```

## 安全边界

- Web 管理端默认绑定 `0.0.0.0:17654`，页面、REST API 和 SSE 均要求密码会话认证。
- Web 登录使用 `HttpOnly`、`SameSite=Strict` Cookie；当前仍是 HTTP，建议只在可信局域网使用。
- MCP 与 Tunnel health/UI 仍只绑定 `127.0.0.1`。
- 只终止 `runtime-state.json` 中由本程序记录的 PID。
- 进程停止顺序为 `SIGTERM`，超时后再 `SIGKILL`。
- 构建命令通过 `/bin/sh -lc` 执行，只有用户明确发起构建验证时才运行。
- 构建产物只允许收集工作目录内部的路径，并跳过符号链接。
- 项目不再保存 ChatGPT Cookie 或内嵌浏览器会话。

更详细说明见 `docs/ARCHITECTURE.md`、`docs/SECURITY_AUDIT.md` 和 `docs/RELEASE_CHECKLIST.md`。

## 上游项目

- Coding Tools MCP: https://github.com/xyTom/coding-tools-mcp
- OpenAI tunnel-client: https://github.com/openai/tunnel-client

第三方许可信息见 `THIRD_PARTY_NOTICES.md`。
