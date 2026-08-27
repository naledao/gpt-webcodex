# Electron 安全审计（2026-07-29）

## 运行时结论

- Electron 已由 31 升级到 43.2.0。
- `nodeIntegration` 在本地管理页中关闭。
- 管理渲染进程启用 `contextIsolation` 与 `sandbox`。
- 主进程 IPC 统一验证调用来源必须为本地 `file://` 页面。
- 禁止挂载 `<webview>`，默认 Session 拒绝权限请求。
- 已删除 ChatGPT `WebContentsView`、持久化网页 Session、登录弹窗和网页 DOM 注入逻辑。
- ChatGPT/OpenAI 外链统一通过 `shell.openExternal()` 交给系统默认浏览器，不在 Electron 内加载远程网页。
- 管理页设置严格 CSP，不允许内联脚本。
- Runtime Key 与 MCP Token 不进入渲染进程明文和普通日志。
- 更新检查、下载与安装只存在于主进程固定 IPC 中；渲染进程不能指定更新源或本地安装路径。
- Windows 更新元数据使用 SHA-512 校验；配置 Authenticode 后，安装时还会验证签名发布者。

## 依赖审计

- `npm audit --omit=dev`：0 个生产依赖漏洞。
- 完整 `npm audit`：0 个已知漏洞。
- `js-yaml` 已提升到包含 `!!omap` 复杂度修复的 4.3.2；构建链中的 `brace-expansion` 与 `fast-uri` 也已更新到公告修复版本。

## 剩余注意事项

- 未进行代码签名的 Windows 安装包仍可能触发 SmartScreen；这与应用运行时安全加固是两件事。
- 正式开放自动更新前仍应完成 Windows 代码签名；GitHub HTTPS 与 SHA-512 不能替代安装包发布者验证。
- “完整工具模式”权限最高，默认仍保持“编码模式”。
- 构建验证页只在用户明确点击后执行当前工作区内的本地命令，产物路径禁止越出工作区，符号链接不会被扫描。
- 全局 `AGENTS.md` 注入默认关闭；启用后只读访问 `CODEX_HOME` 下两个固定候选文件，并在界面展示目标路径。文件内容会作为 MCP 指令发送到 ChatGPT。
