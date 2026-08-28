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

在 x64 WSL2 上交叉构建 arm64 单文件 ELF：

```bash
npm run build:native:arm64
```

该命令不需要 `sudo` 或 Docker。它会在项目的 `.cache/cross-arm64/` 下载并校验官方 Node arm64 运行时，同时使用便携 QEMU 和 Ubuntu arm64 cross sysroot 执行目标架构 SEA 构建。网络请求遵循 `HTTP_PROXY`、`HTTPS_PROXY`；在 WSL 中检测到 `127.0.0.1` 回环代理时，会自动改由 Windows `curl.exe` 访问该代理。

产物名称随当前主机架构变化（`x64` 或 `arm64`）：

```text
dist/web-mcp-assistant-linux-<arch>
dist/web-mcp-assistant-v0.1.12-linux-<arch>.tar.gz
dist/SHA256SUMS-native.txt
```

直接运行：

```bash
./dist/web-mcp-assistant-linux-<arch>
```

如需在后台运行并脱离当前终端，可直接使用控制脚本：

```bash
chmod +x scripts/web-mcp-assistantctl
scripts/web-mcp-assistantctl start
scripts/web-mcp-assistantctl status
scripts/web-mcp-assistantctl restart
scripts/web-mcp-assistantctl update
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

原生发布包运行时不需要安装 Node.js 或 npm，但仍需要系统提供 Python 3.11 或更高版本。配置、密钥和状态继续使用原有 XDG 目录，升级二进制不会清空现有配置。

### GitHub Release 更新

原生 ELF 可以在“助手设置 → 版本与更新”中检查稳定版本。更新器从 GitHub API 返回的正式 Release 中由新到旧查找，跳过 Draft、Prerelease 以及不含当前 `x64` 或 `arm64` 资产的版本。选中最近的匹配 Release 后，在安装前依次校验：

- Release 声明的文件大小；
- GitHub 返回的 SHA-256 digest；
- ELF64 标识和目标 machine 架构。

下载文件保存在：

```text
${XDG_STATE_HOME:-~/.local/state}/web-mcp-assistant/updates/
```

安装时会在目标二进制旁保留一个 `.previous` 备份，使用同一文件系统内的原子重命名完成替换。新版 ELF 先作为重启助手等待旧进程完全退出，再接管原端口；如果新版连 Web 服务都无法启动，会恢复备份并重新启动旧版。

后台安装也可以执行：

```bash
web-mcp-assistantctl update
```

自动替换只在原生 SEA 模式且当前用户对二进制目录有写权限时启用。`npm start` 源码模式不会尝试替换系统 Node.js；安装在 `/usr/local/libexec` 且归 root 所有的文件，需要使用有权限的终端更新。版本发布必须使用递增的新标签，不应覆盖已经发布的稳定版本资产。

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

## AGENTS.md 指令

GPT 通过 MCP 工具按以下优先级取得当前目标路径适用的指令：

1. 全局指令：`${CODEX_HOME:-~/.codex}/AGENTS.md`。
2. 当前工作区根目录的 `AGENTS.md`。
3. 执行子目录任务时适用的嵌套 `AGENTS.md`。

更具体的项目指令优先于全局指令。MCP 初始化和 `server/discover` 只返回精简的加载路由，不包含规则正文；`workspace_context` 和 `agent_workflow` 根据目标路径实时返回同一份规则状态。规则文件新增、修改或删除后会自动刷新并使相关缓存失效，不需要重启 MCP。

正文是否返回由本地设置 `instructionSharingMode` 控制：

- `off`：不返回路径或正文，只报告本地策略关闭。
- `metadata`：默认值，只返回路径、作用域、版本、截断与告警状态。
- `content`：仅在 Web 管理页预览并明确确认后，向已连接的模型服务返回适用正文。

全局与单个嵌套文件仍受 16 KiB 上限约束；发生截断时工具结果会明确标记。凭据、令牌和私钥不应保存在 `AGENTS.md` 中。

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
