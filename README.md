# 网页 MCP 助手 (GPT-WebCodex)

> **直接让网页版 ChatGPT 拥有 Codex 级的本地代码读写能力！免 Docker、零配置的 Windows 桌面助手**

![Windows Only](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows)
![License](https://img.shields.io/badge/License-MIT-green)
![Electron](https://img.shields.io/badge/Electron-43.2.0-47848F?logo=electron)

借助 **GPT-WebCodex**，你不需要购买昂贵的专用 AI 编辑器客户端，直接在熟悉的 **网页版 ChatGPT** 中，就能让 AI 拥有像 Codex / Cursor 一样的本地代码库读写能力：

- 📁 **直接读取桌面与本地工程文件**：不用手动复制粘贴代码，ChatGPT 自动读取你授权的项目文件。
- ✏️ **直接创建与修改本地代码**：对话提出要求，ChatGPT 会直接在你的本地目录中新建文件、编辑代码、修复 Bug。
- 🛡️ **安全独立隔离**：只授权指定的文件夹，绝不暴露整个硬盘权限。

---

## 🚀 快速安装使用

普通用户**无需安装任何编程环境或 Docker**，只需简单两步：

1. 前往 GitHub 仓库右侧的 **[Releases](../../releases)** 页面。
2. 下载最新的 `.exe` 安装包（例如 `web-mcp-assistant-setup-0.1.6.exe`），双击运行安装即可使用！

---

## 💡 为什么需要这个助手？

在网页版 ChatGPT 里操控本地代码时，传统的解决方案通常极其繁琐：

1. **配置极其痛苦**：一般的 MCP 部署需要本地安装 Docker、配置复杂的容器网络与 Python 环境变量。
2. **缺乏目录安全控制**：直接运行脚本容易让 AI 助手误读或修改到磁盘其他位置的私密文件。
3. **网络与代理经常断连**：缺少自动代理切换与连接健康诊断，掉线后需要频繁手动重启。

**网页 MCP 助手** 将便携 Python 运行时、目录硬授权隔离、OpenAI 隧道和健康检查全部打包成了一个轻量的 Windows 桌面程序，真正的双击即用。

---

## ✨ 核心亮点

- **🤖 网页版 ChatGPT 秒变 Codex**：直接在浏览器对话框命令 ChatGPT 读取本地项目、修改代码、重构逻辑。
- **📦 零 Docker 依赖**：内置便携 Python 运行环境，开箱即用，无需配置复杂的系统环境变量。
- **🔒 严格工作区授权**：每次只向 MCP 授权当前选择的**单一工作目录**。切换目录时后台静默重建服务，绝不上报或授权整块磁盘。
- **🔐 凭据安全存储**：API Key 及敏感凭据全程使用 Windows 本地 `safeStorage` (DPAPI) 加密保存。
- **🌐 自动代理与健康诊断**：智能识别系统代理或网关设置，内置 OpenAI 隧道与连接健康监测，断线自动静默重连。

---

## 💻 开发者编译说明（可选）

如果你是开发者，想要二次开发或自行打包：

```powershell
# 1. 克隆仓库与安装依赖
git clone https://github.com/3169657175/gpt-webcodex.git
cd gpt-webcodex
npm install

# 2. 本地开发启动
npm start

# 3. 执行自动化打包脚本
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build.ps1
```

---

## 📜 协议与鸣谢

- 本项目基于 [MIT License](LICENSE) 开源。
- 本项目内置集成了 [Coding Tools MCP](https://github.com/anthropics/anthropic-tools) 运行源码，遵循 Apache License 2.0 规范，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
