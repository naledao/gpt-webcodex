# 网页 MCP 助手 (GPT-WebCodex)

一个让网页版 ChatGPT 能直接读写你本地代码的小工具。无需安装 Docker，双击即可在 Windows 上使用。

---

## 📌 为什么搞这个工具？

平时用网页版 ChatGPT 挺顺手的，但每次想让它帮我重构个本地项目、改改 Bug 时就比较头疼：要么手动一段段复制粘贴代码，要么得在本地装笨重的 Docker 去配置各种 MCP 环境变量，网络还总掉线。

做这个小助手的目的很简单：**把 Python 运行时、网络隧道和目录权限隔离打包成了一个普通的 Windows `.exe` 软件**。

启动助手后，你直接在熟悉的网页版 ChatGPT 聊天框里下指令，AI 就能：
- 📁 **直接读取桌面与本地项目的代码文件**
- ✏️ **直接在你的本地目录里新建文件、修改代码、修复 Bug**

不用买昂贵的专用 AI 编辑器，直接用网页版 ChatGPT 就能搞定本地代码读写。

---

## 💡 几个大家关心的点

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
