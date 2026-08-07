# 网页 MCP 助手 (GPT-WebCodex)

> **免 Docker、零配置开箱即用的 Windows 桌面端 Coding Tools MCP 自动化助手**

![Windows Only](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows)
![License](https://img.shields.io/badge/License-MIT-green)
![Electron](https://img.shields.io/badge/Electron-43.2.0-47848F?logo=electron)

如果你想用网页端 ChatGPT 或 API 驱动本地代码仓库，但又不想折腾笨重的 Docker 容器、也不想暴露整个电脑磁盘的权限，这个助手就是为你准备的。

---

## 💡 解决什么问题？

平时使用 Coding Tools MCP 或连接 AI 助手时，经常会遇到以下烦恼：

1. **依赖环境复杂**：传统的 MCP 服务往往要求本地安装 Docker、配置复杂的容器网络和环境变量。
2. **磁盘权限过大**：直接运行脚本容易让 AI 助手访问到整块硬盘的敏感文件。
3. **网络与代理掉线**：频繁因为代理或网络隧道断连导致 MCP 服务崩溃。

**网页 MCP 助手** 把便携 Python 环境、工作区授权隔离、OpenAI 隧道和健康诊断打包在了一个轻量的 Windows 桌面应用中，双击即可直接使用。

---

## ✨ 核心特性

- **🚀 免装 Docker**：内置便携式 Python 运行环境，下载即用，不修改系统环境变量。
- **🛡️ 严格工作区隔离**：每次只向 MCP 授权当前选择的**单一工作目录**。切换目录时后台静默重建服务，绝不上报或授权整块磁盘。
- **🔒 凭据安全存储**：API Key 及敏感凭据全程使用 Windows 本地 `safeStorage` (DPAPI) 加密保存，不在日志中明文打印。
- **🌐 自动代理与隧道打通**：智能识别系统代理或网关设置，内置 OpenAI 隧道与健康状态监测，服务异常自动尝试静默修复。
- **💬 内嵌网页助手**：界面直接集成 ChatGPT 交互面板，支持文件读取、任务状态监控和实时构建体检。

---

## 🛠️ 快速开始

### 1. 从源码开发运行

需求环境：Node.js >= 18 (Windows 环境)

```powershell
# 克隆仓库
git clone https://github.com/3169657175/gpt-webcodex.git
cd gpt-webcodex

# 安装依赖
npm install

# 启动应用
npm start
```

### 2. 打包生成安装包

助手提供了一键自动化打包脚本：

```powershell
# 完整打包（包含便携运行时，生成 nsis 安装包）
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build.ps1

# 快速 Electron 打包（跳过运行时准备）
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build.ps1 -SkipPortableRuntime
```

---

## 🔒 隐私与安全说明

1. **零个人隐私上报**：助手默认关闭一切匿名遥测与数据上报逻辑。
2. **独立隔离**：授权目录外的所有磁盘文件对 MCP 保持不可见。
3. **本地加密**：密钥保存在本地注册表/DPAPI 密钥库，不上传至任何第三方服务器。

---

## 📜 协议与鸣谢

- 本项目基于 [MIT License](LICENSE) 开源。
- 本项目内置集成了 [Coding Tools MCP](https://github.com/anthropics/anthropic-tools) 运行源码，遵循 Apache License 2.0 规范，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
