# 网页 MCP 助手 (GPT-WebCodex)

一个让网页版 ChatGPT 能直接读写你本地代码的小工具。**当 Codex / Cursor 额度用尽后，可以用它无缝充当“低配版 Codex”，彻底解决额度不够用的问题**。无需安装 Docker，双击即可在 Windows 上使用。

---

## 📌 为什么搞这个工具？

很多做开发的朋友应该都遇到过这个尴尬情况：**Codex 或 Cursor 的订阅额度没用几天就提示耗尽限额了**，想继续用网页版 ChatGPT 来写代码，但网页端偏偏无法直接读取和修改本地的文件，手动复制粘贴代码简直折磨人。

做这个小助手的核心目的就是：**提供一个免配置的“平替低配版 Codex”**。它把 Python 运行时、网络隧道和目录权限隔离打包成了一个普通的 Windows `.exe` 软件。

启动助手后，你在熟悉的网页版 ChatGPT 聊天框里下指令，AI 就能：
- 📁 **直接读取桌面与本地项目的代码文件**
- ✏️ **直接在你的本地目录里新建文件、修改代码、修复 Bug**

Codex 额度不够用时，直接切到网页版 ChatGPT 接上这个助手，继续丝滑做本地代码重构。

---

## 💡 几个大家关心的点

- **平替低配 Codex**：Codex 额度用光也不慌，用网页版 ChatGPT 配套助手继续改本地代码。
- **免装 Docker**：软件内部内置了便携 Python 运行时，双击即用，不用去改系统的环境变量。
- **目录权限隔离**：每次只向它授权你选择的**单一工程目录**，绝对不会去越权读取你电脑里的其他盘符和隐私文件。
- **密钥本地加密**：API Key 保存在 Windows 本地 DPAPI 密钥库里，不上传任何第三方服务器。
- **自动代理重连**：能自动识别系统代理，后台带连接诊断，掉线了会静默重连。

---

## 📦 怎么下载和使用？

普通使用**完全不需要配置任何开发环境**：

1. 直接点击 GitHub 页面右侧的 **[Releases](../../releases)** 链接。
2. 下载最新的 `.exe` 安装包（如 `web-mcp-assistant-setup-0.1.6.exe`），双击安装即可。

---

## 💻 开发者源码编译（可选）

如果你想修改代码或自己打包：

```powershell
# 克隆项目并安装依赖
git clone https://github.com/3169657175/gpt-webcodex.git
cd gpt-webcodex
npm install

# 本地运行
npm start

# 一键打包生成安装包
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build.ps1
```

---

## 📜 开源协议

- 本项目基于 [MIT License](LICENSE) 开源。
- 内置集成 [Coding Tools MCP](https://github.com/anthropics/anthropic-tools) 源码，遵循 Apache License 2.0 规范，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
