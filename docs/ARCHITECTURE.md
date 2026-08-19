# 网页 MCP 助手架构

## 进程边界

```text
Renderer：本地管理中心（无 Node 权限）
  ↓ contextBridge / allowlisted IPC
Electron Main
  ├─ SettingsStore：非敏感配置
  ├─ SecretStore：Windows safeStorage / DPAPI
  ├─ RuntimeOrchestrator：部署状态机
  ├─ NativeService：便携 Python 模式
  ├─ TunnelService：OpenAI Tunnel
  └─ LogService：脱敏诊断日志
```

渲染进程启用 `contextIsolation`、关闭 `nodeIntegration` 并启用沙箱。它不能读取文件、密钥或执行系统命令，只能调用预加载层暴露的固定方法。应用只有 `renderer/index.html` 这一套本地管理界面，不再创建浏览器壳、`WebContentsView` 或 ChatGPT 持久化 Session。

ChatGPT、OpenAI Tunnels、Runtime Keys 等远程页面统一通过 `shell.openExternal()` 交给系统默认浏览器打开，Electron 不加载这些远程页面。

## 运行模式

### 便携运行模式

- 使用安装包内置的 Python 3.12 解释器。
- Coding Tools MCP 与 PyJWT 安装在隔离的 `site-packages`。
- 不依赖系统 Python，也不会向系统 Python 安装包。
- 文件工具受 MCP 工作区与额外授权目录边界约束。

## 密钥与认证

- Runtime API Key 使用 Electron `safeStorage` 加密后保存。
- MCP Bearer Token 由 `crypto.randomBytes(32)` 生成并加密保存。
- 渲染进程只能查询“是否已经保存”，不能取回明文。
- 日志元数据中匹配 `key/token/authorization/secret` 的字段会被替换为 `[已隐藏]`。
- 代理 URL 禁止嵌入用户名和密码。

## 部署状态机

```text
配置校验
→ 环境检测
→ 停止本助手旧实例
→ 启动 Docker 或便携运行时
→ MCP 本地发现接口健康检查
→ 启动 OpenAI Tunnel
→ Tunnel 健康端口检查
→ 完成
```

任意阶段失败都会产生结构化日志和用户可读错误，不继续执行后续阶段。

## 第三方许可

内置的 Coding Tools MCP 使用 Apache License 2.0。源码、LICENSE、NOTICE 与来源声明随安装包保留。
