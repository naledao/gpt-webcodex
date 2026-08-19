# Linux Web 发布检查清单

更新日期：2026-08-19

## 源码结构

- [x] 当前分支为 Linux-only Web 架构。
- [x] `electron/` 已删除。
- [x] Electron main/preload/IPC/Tray/BrowserWindow/WebContentsView 已删除。
- [x] 内嵌 ChatGPT 页面和会话管理已删除。
- [x] Windows 开机启动、窗口驻留、注册表和系统代理逻辑已删除。
- [x] `cmd.exe`、`taskkill.exe`、`where.exe`、`reg.exe`、`netsh.exe` 调用已删除。
- [x] Windows `.exe` 工具已从 `resources/tools` 删除。
- [x] NSIS/electron-builder/electron-updater 已从 npm 依赖删除。
- [x] 共享服务已迁移到 `src/services/`。
- [x] 新增 `web/server.js` 和 `renderer/web-api.js`。

## Linux 运行时

- [x] 配置使用 XDG config/state 路径。
- [x] 密钥目录 `0700`、密钥文件 `0600`。
- [x] Python 只检测 `python3` / `python`，最低 3.11。
- [x] 不自动安装 Python。
- [x] MCP 和 Tunnel 都只绑定 `127.0.0.1`。
- [x] 进程停止使用 `SIGTERM -> SIGKILL`。
- [x] 只管理状态文件中记录的 MCP/Tunnel PID。
- [x] 构建命令使用 `/bin/sh -lc`。
- [x] 代理只使用环境变量、手动 HTTP(S) URL 和 localhost 自动探测。

## OpenAI tunnel-client

- [x] 使用 Linux x64 ELF 二进制，不使用 Windows `.exe`。
- [x] 当前 bundled 版本：v0.0.10。
- [x] 下载源使用 OpenAI 官方发行资源。
- [x] ZIP SHA-256 与官方 `SHA256SUMS.txt` 一致：`b9e0388a343f2d7adeff3992f411a0bd3d916a64bc56534aac5fd15ac1b20cd5`。
- [x] WSL2 中 `tunnel-client --version` 可执行。
- [x] 已确认 `run --help` 存在所需参数：Tunnel ID、API Key、health listen、MCP server URL、extra headers、proxy。
- [x] 上游 Apache-2.0 LICENSE 已保存到 `resources/tools/tunnel-client-LICENSE.txt`。
- [x] 上游 v0.0.10 `SHA256SUMS.txt` 已保存到 `resources/tools/tunnel-client-SHA256SUMS.txt`。

## Web API / UI

- [x] `npm start` 入口是 `node web/server.js`。
- [x] Web 服务默认 `127.0.0.1:17654`。
- [x] 实现 snapshot/settings/workspace/secrets/runtime/logs/task/build/health REST API。
- [x] 实现 `/api/events` SSE。
- [x] SSE 包含 runtime progress/status/heartbeat、logs、build progress。
- [x] 前端不依赖 Electron preload/IPC。
- [x] 工作区改为 Linux 绝对路径输入。
- [x] 外部 OpenAI/ChatGPT 页面使用浏览器新标签页。
- [x] REST API 不返回 Runtime API Key 或 MCP Token 明文。

## 自动测试

在 Ubuntu-26.04 / WSL2 的 Linux Node.js 环境中已完成：

- [x] `npm install --ignore-scripts` 通过。
- [x] `npm run check` 通过。
- [x] Linux Web 测试 13/13 通过。
- [x] REST/SSE 测试通过。
- [x] XDG 路径测试通过。
- [x] 0600/0700 权限逻辑测试通过。
- [x] Linux Shell/进程规则测试通过。
- [x] 源码无 Electron/Windows API/`.exe` 运行时残留测试通过。
- [x] `npm audit --omit=dev` 为 0 vulnerabilities。

## WSL2 实机状态

目标环境：`Ubuntu-26.04` on WSL2。

已确认：

- [x] WSL2 Ubuntu 可正常启动。
- [x] Linux Node.js v24.19.0 已安装到 `~/.local/opt/node-v24.19.0`。
- [x] `~/.local/bin/node` 与 `~/.local/bin/npm` 已生效；新登录 shell 使用 Linux Node/npm，不再使用 Windows npm。
- [x] `python3` 为 Python 3.14.4，满足 3.11+。
- [x] 仓库可从 `/mnt/c/codes/gpt-webcodex` 访问。
- [x] bundled `tunnel-client` 在 WSL2 中可执行并报告 v0.0.10。
- [x] `npm start` 在 WSL2 中成功启动 Web 管理服务。
- [x] `ss` 确认 Web 只监听 `127.0.0.1:17654`。
- [x] `curl http://127.0.0.1:17654/` 返回 HTTP 200。
- [x] Coding Tools MCP 可由 Python 3.14.4 启动并监听 `127.0.0.1:18766` 测试端口。
- [x] `NativeService.status()` 返回正常。
- [x] `NativeService.stop()` 后测试端口释放。

## 需要真实 OpenAI 凭据的验收

以下项目不能用假的 Runtime API Key/Tunnel ID 代替：

- [ ] 使用真实 Runtime API Key 与 Tunnel ID 启动 `tunnel-client`。
- [ ] Tunnel health/UI 就绪。
- [ ] OpenAI 控制平面连接成功。
- [ ] ChatGPT 连接器能发现并调用本地 Coding Tools MCP。

这几项属于凭据相关端到端验收，不影响当前 Linux Web 代码、Linux tunnel-client、本地 MCP 和 Web API 已通过的验证结果。

## 发布前重复执行

```bash
cd /mnt/c/codes/gpt-webcodex
npm install
npm run check
npm test
npm audit --omit=dev
```

并确认：

```bash
command -v node
node --version
command -v npm
npm --version
python3 --version
resources/tools/tunnel-client --version
```

## 发布阻断条件

出现下列任意情况时不要发布：

- Web/MCP/Tunnel 任一服务监听 `0.0.0.0` 或非预期外部地址。
- REST API 回显密钥明文。
- `resources/tools` 中重新出现 Windows `.exe`。
- npm 依赖重新引入 Electron/electron-builder/electron-updater。
- 工作区接受 Windows `C:\...` 路径。
- Linux Node.js 端到端启动失败。
- Coding Tools MCP 在系统 Python 3.11+ 下无法启动。
- bundled `tunnel-client` 校验值或版本来源不明确。
