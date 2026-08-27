# Linux Web 安全审计

审计日期：2026-08-19

## 结论

当前 `linux` 分支已从 Electron/Windows 桌面程序改为 Linux Web 管理服务。Web 管理端按当前部署要求监听所有网卡；其余安全边界包括当前 Linux 用户文件权限、明确的工作区授权和只管理本程序记录的进程。

本版本可以直接从可信局域网访问。Web 页面、REST API 和 SSE 需要密码会话认证，但当前没有 TLS，不应暴露到公网或不可信网络。

## 网络暴露面

默认监听：

```text
Web 管理服务    0.0.0.0:17654
Coding Tools MCP 127.0.0.1:18765
Tunnel health/UI 127.0.0.1:18081
```

`web/server.js` 默认绑定 `0.0.0.0`，可通过 `WEB_HOST` 覆盖。

未登录页面请求会跳转到 `/login`，未登录 REST API 与 SSE 请求返回 `401`。密码只在服务端校验，默认密码以 SHA-256 校验值保存；可通过 `WEB_PASSWORD` 覆盖。成功登录后签发随机内存会话，Cookie 使用 `HttpOnly`、`SameSite=Strict` 和 24 小时有效期，服务重启后会话立即失效。

静态文件采用白名单映射，只提供管理页面所需的 HTML、JS 和 CSS，不把仓库目录作为通用静态文件根目录暴露。

REST 请求体限制为 1 MiB，并要求 JSON。响应使用 `no-store`，静态响应设置 `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer` 和 `X-Frame-Options: DENY`。

## 密钥

敏感值包括：

- OpenAI Runtime API Key
- MCP 本地 Bearer Token

保存位置：

```text
${XDG_CONFIG_HOME:-~/.config}/web-mcp-assistant/secrets.json
```

权限设计：

```text
目录 0700
文件 0600
```

写入采用临时文件 + `fsync` + rename 的原子替换方式。

Web API 不返回密钥明文，只返回：

```json
{
  "runtimeApiKey": true,
  "mcpAuthToken": true
}
```

说明：Linux Web 版本不再使用 Windows DPAPI/Electron `safeStorage`。密钥在磁盘上是当前用户可读取的明文 JSON，安全性依赖 Linux 用户权限和文件权限；这属于当前设计边界，不应描述为“加密存储”。

## 密钥进入子进程的方式

Tunnel 的 Runtime API Key 和 MCP Token 通过环境变量传入，再由 `env:` 引用：

```text
CONTROL_PLANE_API_KEY
MCP_RUNTIME_HEADER_VALUE
```

这样避免把真实密钥直接拼进 `tunnel-client` 命令行参数。

日志服务会对常见密钥形态做脱敏；REST API 也不会回显用户提交的 Runtime API Key。

## 原生发布资源

SEA 二进制内嵌的网页、MCP 源码和 Tunnel 客户端会释放到当前用户的 XDG cache。构建 ID 来自资源内容摘要，不同构建使用不同目录；目录权限为 `0700`，普通资源文件为 `0600`，Tunnel 可执行文件为 `0700`。密钥不会写入该缓存目录，仍只保存在 XDG config 下。

原生 ELF 省去系统 Node.js 依赖，但不是完全静态系统镜像：仍依赖目标 Linux 的 glibc 和 Python 3.11+。arm64 发布嵌入官方 arm64 Tunnel，不需要 QEMU。

## 原生更新供应链

更新器分页遍历仓库正式 Release，只接受最近一个与当前架构完全匹配的固定资产名；Draft、Prerelease、无效稳定版本以及只含其他平台/架构资产的 Release 会被跳过。目标资产一旦出现，其大小、GitHub API SHA-256 digest 或下载 URL 无效就会终止检查，不会静默降级到更老资产。文件先流式写入 XDG state 临时目录，再校验 Release 声明大小、SHA-256 digest 和 ELF machine；任何一步失败都不会触碰当前可执行文件。

替换前要求当前进程确实是 Linux SEA，且运行用户对目标目录有写权限。旧二进制保留为 `.previous`，新版本无法启动 Web 服务时会自动回滚。更新接口沿用 Web 登录认证，不接受客户端提供任意仓库、URL、文件名或目标路径。

GitHub digest 可以检测传输损坏和元数据不一致，但如果攻击者能够同时修改可变 Release 及其元数据，它不等价于独立发布签名。因此正式启用自动更新前，应对未来 Release 启用不可变发布；若需要脱离 GitHub 账户信任边界，还应增加内嵌 Ed25519 公钥验证的签名更新清单。

## 工作区访问边界

主工作区和额外授权根目录必须：

- 是 Linux 绝对路径；
- 真实存在；
- 由用户显式填写或保存。

WSL 下应使用 `/mnt/c/...`，不接受 `C:\...` 作为运行时工作区。

Coding Tools MCP 的 `CODING_TOOLS_MCP_AUTHORIZED_ROOTS` 只传入已经保存的额外授权目录。

## 进程管理

应用只终止 `runtime-state.json` 中记录的 MCP 和 Tunnel PID。

停止策略：

1. `SIGTERM`
2. 等待宽限期
3. 进程仍存活时 `SIGKILL`

没有全局进程名匹配，也不再调用 `taskkill.exe`。

PID 仍存在复用的理论风险，因此状态中同时保留运行配置指纹和实例信息；未来若引入更强进程身份校验，可进一步降低复用风险。

## Shell 与构建验证

普通 MCP/Tunnel 启动使用 `spawn(..., { shell: false })`。

只有用户明确触发“构建验证”时，用户配置的测试/构建命令才通过：

```text
/bin/sh -lc <command>
```

执行。

保护措施：

- 命令长度限制；
- 禁止 CR/LF/NUL；
- 工作目录固定为当前授权 workspace；
- 产物路径必须位于 workspace 内；
- 不遍历符号链接；
- 产物计算 SHA-256。

这里仍然属于“用户授权执行任意 shell 命令”的高权限功能，因此不应向未受信任的远程用户开放 Web 管理端。

## 代理

代理只来自：

- HTTP(S) 代理环境变量；
- 用户手工配置；
- 自动模式探测到的常见 localhost HTTP 代理端口。

手工代理只允许 `http://` / `https://`，且拒绝 URL 内嵌用户名或密码，避免凭据被持久化到普通设置文件。

不读取 Windows 注册表，不调用 `netsh.exe`。

## 浏览器与外部页面

本项目不再嵌入 ChatGPT，也不持有 ChatGPT Cookie、缓存或登录会话。

外部页面只通过浏览器新标签页打开，并使用固定目标映射，不接受任意 URL 直接从管理 API 传入。

## 依赖面

Node.js Web 管理器当前没有 npm runtime/dev dependencies；HTTP/SSE、文件、进程和加密哈希都使用 Node.js 内置模块。

仓库包含两个主要第三方运行组件：

- Coding Tools MCP 源码及其 vendored Python 依赖；
- OpenAI `tunnel-client` Linux 二进制。

第三方许可和版本信息记录在 `THIRD_PARTY_NOTICES.md`。

## 已删除的高风险桌面面

Linux Web 分支已经移除：

- Electron main/preload/IPC；
- `BrowserWindow` / `WebContentsView`；
- 内嵌 ChatGPT session；
- Cookie 清理与持久化逻辑；
- `safeStorage` / DPAPI；
- Windows 注册表、系统代理、开机启动；
- `cmd.exe`、`taskkill.exe`、`where.exe`、`reg.exe`、`netsh.exe`；
- NSIS/electron-builder；
- Windows `.exe` 工具。

## 剩余风险与上线限制

### 1. 局域网管理端没有 TLS

当前管理端已有密码会话认证，但 HTTP 传输没有 TLS。监听 `0.0.0.0` 时，同一网络内的被动监听者仍可能看到登录请求或会话流量，因此只适合可信局域网。

在不可信网络中使用前必须增加：

- TLS；
- 更强的身份认证与密码轮换；
- CSRF/Origin 校验；
- 更细粒度 API 授权；
- 速率限制和审计日志。

### 2. 本地密钥是权限保护，不是加密保护

拥有同一 Linux 用户权限的进程可以读取 `secrets.json`。需要更强 at-rest 保护时，应改接 Linux Secret Service、内核 keyring 或部署环境提供的秘密管理器。

### 3. 构建接口具备 shell 执行能力

只应由本机可信用户操作；不要把管理端口转发到不可信网络。

### 4. 真正的 OpenAI Tunnel 端到端仍依赖用户凭据

无 Runtime API Key 和有效 Tunnel ID 时，只能验证 Linux 二进制、CLI 参数、进程启动逻辑和本地 API，不能完成真实控制平面连接。

## 发布前最低检查

```bash
npm install
npm run check
npm test
npm audit
```

并在目标 Linux/WSL 环境中确认：

```bash
command -v node
node --version
python3 --version
file resources/tools/tunnel-client
resources/tools/tunnel-client run --help
npm run build:native
```

最后确认 Web、MCP 和 Tunnel health/UI 都只监听 loopback。
