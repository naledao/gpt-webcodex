# 第三方软件声明

本仓库包含并管理以下第三方组件。

## Coding Tools MCP

- Project: Coding Tools MCP
- Source: https://github.com/xyTom/coding-tools-mcp
- License: Apache License 2.0
- Bundled path: `resources/coding-tools-mcp/`

仓库保留上游源码以及其 LICENSE / NOTICE 等许可文件。Coding Tools MCP 由 Linux 系统 Python 启动，不作为 npm 依赖安装。

## OpenAI tunnel-client

- Project: OpenAI tunnel-client
- Source: https://github.com/openai/tunnel-client
- Bundled version: v0.0.10
- Bundled platform: Linux x64 / amd64
- License: Apache License 2.0
- Binary path: `resources/tools/tunnel-client`
- License copy: `resources/tools/tunnel-client-LICENSE.txt`
- Upstream checksums: `resources/tools/tunnel-client-SHA256SUMS.txt`

引入的 v0.0.10 Linux amd64 ZIP 已与 OpenAI 官方 `SHA256SUMS.txt` 核对，ZIP SHA-256 为：

```text
b9e0388a343f2d7adeff3992f411a0bd3d916a64bc56534aac5fd15ac1b20cd5
```

`tunnel-client` 的许可证文件与校验和文件随二进制一同保留。

## 系统工具

本程序会调用用户 Linux 环境中已经安装的 Node.js、Python、Git 以及项目构建工具。这些系统工具不由本仓库重新分发，其许可由各自项目提供。
