# Web MCP Assistant

面向 Linux 的本地 Web 管理器，用来启动和管理 Coding Tools MCP 与 OpenAI Secure MCP Tunnel。

当前 `linux` 分支只支持 Linux 运行方式，不包含 Electron、Windows API、桌面托盘、内嵌 ChatGPT 页面或 Windows `.exe` 工具。

## 架构

```text
Browser
  │  HTTP / SSE
  ▼
web/server.js   (127.0.0.1:17654)
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
- `resources/tools/tunnel-client` 必须是可执行的 Linux 二进制。

仓库当前包含 OpenAI `tunnel-client` v0.0.10 Linux x64 版本；引入时已使用上游 `SHA256SUMS.txt` 校验。

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

默认管理地址：

```text
http://127.0.0.1:17654
```

服务默认只监听 `127.0.0.1`，不会监听 `0.0.0.0`。

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
npm start       # 启动本地 Web 管理服务
npm test        # Node.js 测试
npm run check   # JavaScript 语法检查
```

## 目录

```text
web/                     Node.js HTTP/SSE 服务
src/                     Linux 路径与核心服务
src/services/            配置、密钥、进程、MCP、Tunnel、健康检查等
renderer/                 纯浏览器管理页面
resources/coding-tools-mcp/
resources/tools/tunnel-client
resources/tools/tunnel-client-LICENSE.txt
resources/tools/tunnel-client-SHA256SUMS.txt
tests/                   Linux Web 测试
```

## 安全边界

- Web、MCP、Tunnel health/UI 默认全部绑定 `127.0.0.1`。
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
