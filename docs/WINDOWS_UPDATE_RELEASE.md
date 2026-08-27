# Windows 更新与发布

Windows 安装版使用 `electron-updater`、NSIS 和 GitHub Releases。应用启动约 20 秒后检查一次稳定版，之后最多每 6 小时检查一次；下载与安装始终需要用户确认。

## Release 资产契约

本仓库的 Linux 更新器与 Windows 更新器都会读取 GitHub 的 latest 稳定 Release。因此每个稳定 Release 必须同时包含对应版本的全部平台资产。Windows 部分至少包括：

```text
latest.yml
web-mcp-assistant-setup-<version>.exe
web-mcp-assistant-setup-<version>.exe.blockmap
```

不要发布只包含单个平台资产的稳定 Release。先创建统一 Draft Release，分别上传 Linux 与 Windows 资产，完成校验后再发布草稿。

## Windows 构建流程

1. 将 `package.json` 与 `package-lock.json` 版本设为目标版本。
2. 创建同名 Draft Release，例如 `v0.1.9`。
3. 在默认分支可用的 Actions 工作流中运行 `Build Windows Release Assets`，输入该标签。
4. 工作流从 `windows` 分支构建、运行测试并验证 `latest.yml` 的 URL 与 SHA-512。
5. 工作流只允许向现有 Draft Release 上传资产；目标已经发布时会失败。
6. 确认 Linux 与 Windows 资产齐全后发布 Release。

本地可使用：

```powershell
npm.cmd run dist
npm.cmd run verify:release
```

发布工作流需要 `contents: write`。如已配置代码签名，在仓库 Actions secrets 中添加 `WIN_CSC_LINK` 与 `WIN_CSC_KEY_PASSWORD`。

## 安装行为

安装前应用会检查自己管理的 MCP 与 Tunnel 是否正在运行。若正在运行，会先安全停止它们并写入一次性恢复标记，再启动 NSIS。新版本首次启动会消费该标记并恢复服务。

渲染进程只能调用固定的更新 IPC，不能指定下载源、Release URL 或安装包路径。开发模式只展示版本与能力说明，不替换源码。

## 首次引导版本

`v0.1.6` 没有更新器，无法自动升级到带更新功能的版本。用户需手动安装 `v0.1.9` 一次；之后才能在应用内更新。
