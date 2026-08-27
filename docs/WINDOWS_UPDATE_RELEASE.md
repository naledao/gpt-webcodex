# Windows 更新与发布

Windows 安装版使用 `electron-updater`、NSIS 和 GitHub Releases。应用启动约 20 秒后检查一次稳定版，之后最多每 6 小时检查一次；下载与安装始终需要用户确认。

## Release 资产契约

每个 Windows Release 至少包括：

```text
latest.yml
web-mcp-assistant-setup-<version>.exe
web-mcp-assistant-setup-<version>.exe.blockmap
```

`latest.yml` 还必须声明它所包含的更新包：

```yaml
updatePackages:
  - platform: win32
    arch: x64
    type: nsis
    file: web-mcp-assistant-setup-<version>.exe
```

Windows 客户端通过 GitHub API 从最新正式 Release 开始向旧版本遍历。没有 `latest.yml`、清单未声明当前 `platform-arch`、声明的安装包资产不存在、Draft 和 Prerelease 都会被跳过。找到最近的匹配 Release 后，客户端才把该 Release 的固定下载目录交给 `electron-updater` 比较版本并执行 SHA-512、blockmap 与安装流程。

这使 Windows 客户端不再依赖 GitHub 的全局 Latest 是否恰好包含 Windows 包。Linux 分支当前仍使用全局 Latest；在 Linux 更新器实现相同回退能力前，发布 Windows-only 稳定版仍需评估旧 Linux 客户端的兼容性。

## Windows 构建流程

1. 将 `package.json` 与 `package-lock.json` 版本设为目标版本。
2. 创建同名 Draft Release，例如 `v0.1.9`，用于上传前复核。
3. 在默认分支可用的 Actions 工作流中运行 `Build Windows Release Assets`，输入该标签。
4. 工作流从 `windows` 分支构建、自动写入 `updatePackages`，并验证 URL、平台、架构、安装包文件名与 SHA-512。
5. 工作流只允许向现有 Draft Release 上传资产；目标已经发布时会失败。
6. 确认目标客户端兼容性后发布 Release。

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
