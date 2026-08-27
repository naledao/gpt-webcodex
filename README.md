# 网页 MCP 助手 (GPT-WebCodex)

一个让网页版 ChatGPT 能直接读写你本地代码的小工具。**当 Codex / Cursor 额度用尽后，可以用它无缝充当“低配版 Codex”，彻底解决额度不够用的问题**。无需安装 Docker，双击即可在 Windows 上使用。

---

## 📌 为什么搞这个工具？

很多做开发的朋友应该都遇到过这个尴尬情况：**Codex 或 Cursor 的订阅额度没用几天就提示耗尽限额了**，想继续用网页版 ChatGPT 来写代码，但网页端偏偏无法直接读取和修改本地的文件，手动复制粘贴代码简直折磨人。

做这个小助手的核心目的就是：**提供一个免配置的“平替低配版 Codex”**。它把 Python 运行时、网络隧道和目录权限隔离打包成了一个普通的 Windows `.exe` 软件。

当前 Windows 版本只提供本地设置/管理中心，**不会在 Electron 内嵌 ChatGPT 或其他远程网页**。需要进入 ChatGPT、OpenAI Tunnels 或 Runtime Keys 时，会使用系统默认浏览器打开。

启动助手后，你在熟悉的网页版 ChatGPT 聊天框里下指令，AI 就能：
- 📁 **直接读取桌面与本地项目的代码文件**
- ✏️ **直接在你的本地目录里新建文件、修改代码、修复 Bug**

Codex 额度不够用时，直接切到网页版 ChatGPT 接上这个助手，继续丝滑做本地代码重构。

---

## 💡 几个大家关心的点

- **平替低配 Codex**：Codex 额度用光也不慌，用网页版 ChatGPT 配套助手继续改本地代码。
- **免装 Docker**：软件内部内置了便携 Python 运行时，双击即用，不用去改系统的环境变量。
- **目录权限隔离**：文件工具只访问你明确授权的工程目录。只有主动开启“全局 AGENTS.md”后，助手才会额外只读加载 `%CODEX_HOME%`（默认 `%USERPROFILE%\.codex`）中的规则文件，并将规则发送到 ChatGPT。
- **全局项目规则分层**：可选择注入全局 `AGENTS.override.md` / `AGENTS.md`，再叠加项目规则；项目规则具有更高优先级。该功能默认关闭，重新部署后生效。
- **密钥本地加密**：API Key 保存在 Windows 本地 DPAPI 密钥库里，不上传任何第三方服务器。
- **自动代理重连**：能自动识别系统代理，后台带连接诊断，掉线了会静默重连。
- **GitHub 稳定版更新**：安装版会定期检查 GitHub Releases；由用户确认下载、校验并安装，更新重启后恢复原来的 MCP 与 Tunnel 运行状态。

---

## 📦 怎么下载和使用？

普通使用**完全不需要配置任何开发环境**：

1. 直接点击 GitHub 页面右侧的 **[Releases](../../releases)** 链接。
2. 下载最新的 `.exe` 安装包（如 `web-mcp-assistant-setup-0.1.10.exe`），双击安装即可。
3. 启动后直接进入管理中心，完成工作目录、Tunnel、Runtime Key、代理和启动行为配置。

从 `v0.1.9` 开始，后续稳定版可以在“偏好设置 → 软件更新”中检查、下载并安装。旧版尚未包含更新器，因此从 `v0.1.6` 升级到 `v0.1.9` 仍需手动下载安装一次。

---

## 💻 开发者源码编译（可选）

如果你想修改代码或自己打包：

```powershell
# 克隆项目并安装依赖
git clone https://github.com/naledao/gpt-webcodex.git
cd gpt-webcodex
npm install

# 本地运行
npm start

# 一键打包生成安装包
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build.ps1
```

发布 Windows 更新资产前，先创建与 `package.json` 版本一致的 Draft Release，并运行 GitHub Actions 的 `Build Windows Release Assets`。构建会在 `latest.yml` 写入 `updatePackages`，Windows 客户端从新到旧查找包含自身平台与架构的最近稳定 Release。详见 [Windows 更新发布说明](docs/WINDOWS_UPDATE_RELEASE.md)。

---

## 📜 开源协议

- 本项目基于 [MIT License](LICENSE) 开源。
- 内置集成 [Coding Tools MCP](https://github.com/xyTom/coding-tools-mcp) 源码，遵循 Apache License 2.0 规范，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
