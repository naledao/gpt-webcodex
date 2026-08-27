# AGENTS.md 远程上下文注入修复设计

> 状态：Implemented（本地单元、协议与 Web 验证完成；Secure MCP Tunnel / ChatGPT 新会话端到端验收待连接侧执行）
>
> 调研基线：`linux` 分支，提交 `06ad913`，2026-08-27
>
> 适用范围：Linux Web 模式、Coding Tools MCP、Secure MCP Tunnel、ChatGPT 开发者模式连接

## 实施记录（2026-08-27）

已完成：

- `initialize` 与 `server/discover` 返回完全相同的 395 字符短路由，初始化元数据不再包含规则正文。
- `workspace_context`、`prepare_coding_context` 与 `agent_workflow` 共用 `ProjectContext.applicable_instructions()`；支持多目标 `applicable_to`、嵌套优先级、截断、missing / unavailable / withheld 状态和 SHA-256 revision。
- 相关请求实时重建规则快照；内容 revision 变化时同时使快速工具缓存和上下文包缓存失效，缓存键也包含规则 revision 与分享模式。
- `instructionSharingMode=off|metadata|content` 已接入配置迁移、Runtime 指纹、MCP 环境、Web 设置与经过登录保护的本地预览；旧配置统一迁移为 `metadata`。
- `smart` 模式仍固定为 8 个工具；`workspace_context` 描述和文本摘要已经更新。
- README、架构说明、Python 测试、Node 测试和原生 arm64 构建已经同步。

本地验证结果：Python 34 项、Node 25 项和 JavaScript 语法检查全部通过；独立 HTTP JSON-RPC 探针确认四个请求均为 HTTP 200、两个发现入口指令一致、短路由为 395 字符、`smart` 工具数为 8，且 `workspace_context` 返回 metadata revision 与不重复正文的文本摘要。最终 v0.1.9 arm64 ELF 为 122,620,672 bytes，SHA-256 为 `f7505e8fb182538bf11a53963c663ccbfeae3f1fe282f163a091b01562fb4e93`；原生包已在独立 27654 端口完成未登录跳转、登录和 snapshot 冒烟测试。

仍需在连接侧执行：部署新 ELF 后，通过 Secure MCP Tunnel 重复协议抓包；在 ChatGPT 中 Refresh 连接并新建会话运行第 8.3 节 golden prompts。当前实现没有擅自重启正在使用的 18765/Tunnel 实例。

## 1. 结论

当前问题不是“服务端完全没有读取全局 `AGENTS.md`”，而是“读取以后没有通过一个稳定、可发现、可刷新且安全的模型可见通道交付”。

现有实现把全局和项目根指令正文拼进 MCP `initialize.instructions`。标准初始化响应里确实存在这段正文，但以下缺口会让 ChatGPT 最终表现为“没有注入”：

1. 关键路由提示不在初始化指令的前 512 个字符内，完整正文也可能被客户端弱化、缓存或截断。
2. 自定义兼容接口 `server/discover` 不返回 `instructions`，与标准 `initialize` 不一致。
3. `smart` 模式对外暴露的 `workspace_context` 没有返回任何指令信息，其工具描述也没有要求在回答机器、工作区或 `AGENTS.md` 问题前加载规则。
4. 真正包含全局和项目根正文的 `prepare_coding_context` 在 `smart` 模式下只是兼容工具，正常工具列表中不可见；嵌套规则目前主要只公布路径。
5. `ProjectContext` 在 Runtime 创建时加载，修改指令后通常要重启 MCP 才能生效，缓存还可能继续返回旧上下文。

推荐修复是：

- `initialize` 和 `server/discover` 只返回一致、精简的“先加载规则”路由指令，最重要的要求放在前 512 个字符内。
- 复用现有 `workspace_context`，让它返回当前路径实际适用的全局、项目根和嵌套指令；不新增第九个 `smart` 工具。
- `agent_workflow` 的 `prepare`、`run`、`resume` 阶段复用同一份指令载荷，禁止维护两套装配逻辑。
- 指令文件变化后自动重载并清理相关缓存。
- 完整正文只能按本地配置授权后进入工具结果，绝不能继续无条件放进初始化或发现元数据。

## 2. “注入成功”的定义

为避免把不同阶段混在一起，本项目把“注入”拆成四层：

| 层级 | 定义 | 当前状态 |
| --- | --- | --- |
| 发现 | 服务端找到正确的全局、根目录和嵌套规则文件 | 部分成功 |
| 传输 | 规则或可靠的加载入口出现在客户端实际使用的 MCP 响应中 | 不稳定 |
| 选择 | 工具元数据能促使模型在相关问题前调用上下文工具 | 缺失 |
| 使用 | 模型取得适用正文、理解优先级，并据此回答或执行 | 不可保证 |

只有四层全部成立，才能称为“已注入”。仅在服务端内存中读到文件，或者仅在 `initialize.instructions` 中返回正文，都不足以证明模型已经收到并使用。

## 3. 已验证现象

以下数据来自 2026-08-27 对当前工作区和本机运行环境的只读检查。文档不记录 `AGENTS.md` 中的任何凭据值。

| 检查项 | 结果 | 含义 |
| --- | --- | --- |
| 当前分支与基线 | `linux` / `06ad913` | 本设计基于该版本 |
| 全局文件 | `/root/.codex/AGENTS.md`，18,953 bytes | 文件存在，不是路径缺失 |
| 全局读取上限 | `MAX_GLOBAL_CONTEXT_BYTES = 16 * 1024` | 当前全局正文必然被截断 |
| 标准初始化 | 本地 MCP HTTP 200，协议 `2025-06-18` | MCP 标准初始化链路正常 |
| `initialize.instructions` | 13,688 个 Unicode 字符、18,600 UTF-8 bytes | 初始化确实返回了较长指令 |
| 全局段落位置 | 约从字符 2,155 开始，并带 `[truncated]` | 不满足“关键内容优先”的要求 |
| `server/discover` | 只有协议、服务信息、能力和工具，无 `instructions` | 兼容发现路径丢失指令 |
| `workspace_context` | 返回目录、Git、项目、任务等，无 `instructions` | 模型最容易调用的只读入口拿不到规则 |
| `prepare_coding_context` | 有全局/根正文和嵌套路径 | 数据存在，但在 `smart` 工具面中不可直接选择 |
| `smart` 工具数 | 固定 8 个 | 修复应保持此边界，不新增工具 |

标准初始化能看到正文，说明“旧二进制完全不支持全局规则”不是本次现象的主要原因。OpenAI 官方文档说明 Secure MCP Tunnel 会转发 JSON-RPC 请求并回传响应，目前也没有证据表明它会主动删除该字段。因此本设计不把 Tunnel 作为首要根因；但本次数据来自本地 MCP，仍须在最终端到端测试中抓取 Tunnel 两端结果后才能排除传输差异。

## 4. 代码层根因

### 4.1 初始化载荷承担了不适合它的职责

[`project_context.py`](../resources/coding-tools-mcp/coding_tools_mcp/project_context.py) 的 `ProjectContext.server_instructions()` 先拼接多段通用工具规则，再追加全局和项目根正文。结果是：

- “先加载 `AGENTS.md`”不是首屏路由信息。
- 大文件增加初始化上下文、延迟和缓存不确定性。
- 16 KiB 全局上限会把规则从任意位置截断，不保证保留真正关键的段落。
- 初始化发生一次，不适合承载运行中会变化的本地文件。
- 初始化元数据无条件携带正文，扩大了敏感信息暴露面。

OpenAI 官方文档建议服务器指令只放跨工具指导，并把最重要的内容放在前 512 个字符内；工具的名称、描述、参数和结果才是模型决定何时调用以及完成任务的主要契约。

### 4.2 标准初始化与兼容发现不对称

[`server.py`](../resources/coding-tools-mcp/coding_tools_mcp/server.py) 的 `Runtime.initialize()` 返回 `instructions`，但 [`protocol.py`](../resources/coding-tools-mcp/coding_tools_mcp/protocol.py) 的 `server/discover` 分支没有该字段。

`server/discover` 是项目自定义兼容方法，OpenAI 官方文档没有承诺 ChatGPT 一定会调用它。因此不能断言它就是截图现象的唯一原因；但两个发现入口表达不同能力是明确缺陷，应修复为同一份精简指令。

### 4.3 `smart` 模式缺少稳定的规则读取入口

[`nativeService.js`](../src/services/nativeService.js) 强制设置 `CODING_TOOLS_MCP_TOOL_MODE=smart`。该模式只公开：

```text
workspace_context
agent_workflow
task_control
document_workflow
exec_command
command_control
request_permissions
view_image
```

`workspace_context` 是回答“当前目录、分支、项目是什么”时最可能被选择的工具，但它目前没有指令载荷，描述中也没有 `AGENTS.md`、机器规则或“回答前必须加载”的语义。

`prepare_coding_context` 虽然返回全局和根目录正文，但属于隐藏的兼容工具。`agent_workflow` 内部会间接调用它，简单问答却通常不会触发完整编码工作流。因此会出现模型知道工作目录和 Git 分支，却不知道全局规则文件的现象。

### 4.4 嵌套规则只有路径，没有可靠的适用范围装配

当前 `prepare_coding_context` 把 `nested_paths` 放入结果，但不会始终根据目标路径自动读取所有适用的嵌套正文。模型必须先注意到路径，再主动把它作为普通文件读取；这不是可靠的优先级实现。

需要由服务端根据任务路径计算：

```text
global → project root → parent nested → deepest nested
```

越靠后的规则越具体，发生冲突时覆盖前面的规则。对于同时涉及多个目录的任务，还要标明每个嵌套文件适用于哪些目标路径，不能把一个子目录的规则错误应用到整个项目。

### 4.5 上下文和缓存不会随文件变化可靠刷新

`Runtime` 创建时保存 `self.project_context`；`workspace_context` 有快速缓存，`prepare_coding_context` 还有上下文包缓存。当前文档也明确要求修改规则后重启 MCP。

这会造成三种错误：

- 文件已修改，模型仍使用旧正文。
- 文件已新增或删除，嵌套规则列表仍是旧值。
- 工具结果虽然刷新了目录/Git，指令部分却仍来自旧 Runtime。

## 5. 目标与非目标

### 5.1 目标

1. ChatGPT 在回答工作区、机器能力、全局规则和项目规则问题前，能稳定选择正确工具。
2. 编码工作流始终收到目标路径实际适用的指令正文和明确优先级。
3. 全局、根目录、嵌套文件修改后，无需重启 MCP 即可在下一次上下文请求中生效。
4. `initialize`、`server/discover` 和工具元数据保持一致。
5. 保持 `smart` 模式固定 8 个工具，不扩大模型选择面。
6. 初始化与发现响应不包含完整 `AGENTS.md` 正文或秘密信息。
7. 能通过单元、协议和 ChatGPT 端到端测试证明“发现、传输、选择、使用”四层均成功。

### 5.2 非目标

- 不把 `AGENTS.md` 变成密钥存储系统。
- 不依赖模型自行猜测全局文件路径。
- 不依赖正则表达式把任意敏感正文可靠“清洗”为安全正文。
- 不通过新增大量细粒度工具解决问题。
- 不假设 ChatGPT 对自定义 `server/discover` 的内部调用顺序。
- 不在本修复中改变现有指令优先级语义。

## 6. 推荐架构

```text
ChatGPT
   │
   ├─ initialize / server/discover
   │     └─ 仅返回前 512 字符内的精简路由指令
   │
   ├─ 简单问答 ──> workspace_context
   │                   └─ 实时 ProjectContext 适用规则载荷
   │
   └─ 编码任务 ──> agent_workflow prepare/run/resume
                       └─ 复用同一份实时 ProjectContext 适用规则载荷
```

核心原则是“初始化负责路由，工具负责实时数据”。

### 6.1 精简服务器指令

新增单一方法，例如 `ProjectContext.routing_instructions()`，由 `initialize` 和 `server/discover` 同时调用。建议英文正文如下，关键要求应完整落在前 512 个字符内：

```text
Before answering workspace, machine, or instruction questions, call workspace_context. Before coding, call agent_workflow with phase=prepare or run. Treat the returned global, project-root, and applicable nested AGENTS.md as authoritative; nested overrides root, and root overrides global. Never claim instructions are absent unless the context result reports them missing or withheld by policy.
```

约束：

- 不附加全局或项目正文。
- 不重复八个工具的完整描述。
- 不放用户凭据、绝对内容快照或频繁变化的数据。
- 增加单元测试，断言关键路由句在前 512 个字符内。
- `initialize.instructions == server/discover.instructions`，避免发现路径分叉。

### 6.2 统一指令载荷

在 `ProjectContext` 中新增一个唯一装配入口，例如：

```python
applicable_instructions(
    target_paths: list[str],
    sharing_mode: str,
) -> dict[str, object]
```

建议输出结构：

```json
{
  "revision": "sha256:<context-revision>",
  "sharing_mode": "content",
  "requested_paths": ["src/module/file.py"],
  "precedence": ["global", "project_root", "nested"],
  "files": [
    {
      "scope": "global",
      "path": "/absolute/path/to/AGENTS.md",
      "content": "<authorized instruction content>",
      "truncated": false,
      "applicable_to": ["src/module/file.py"]
    }
  ],
  "missing": [],
  "warnings": []
}
```

实现要求：

- `revision` 对文件顺序、规范化路径、正文和截断状态计算 SHA-256；不得包含秘密原文。
- `files` 严格按全局、项目根、从浅到深的嵌套目录排序。
- 只加载目标路径祖先目录中的嵌套规则。
- 多目标任务使用 `applicable_to` 保留作用域，不把局部规则全局化。
- 继续执行现有 UTF-8、符号链接、工作区边界、文件数、扫描深度和字节上限检查。
- 被截断、无法读取、超出授权范围或被分享策略阻止时，必须返回明确状态；模型不能把 `withheld` 误说成 `missing`。
- `workspace_context`、`prepare_coding_context` 和 `agent_workflow` 禁止各自重新拼装规则字典。

### 6.3 扩展 `workspace_context`

不新增工具，在现有返回值中增加：

```json
{
  "instructions": {
    "revision": "sha256:...",
    "sharing_mode": "content",
    "precedence": ["global", "project_root", "nested"],
    "files": [],
    "missing": [],
    "warnings": []
  }
}
```

`path` 参数同时作为规则适用范围的目标路径。即使 `detail=compact`，也必须保留完整的指令状态；是否返回正文由本地分享配置决定，不能因为 compact 模式静默删除。

工具描述应以 `Use this when...` 开头并明确覆盖触发场景。建议：

```text
Use this when the user asks about the current workspace, directory, Git state, machine capabilities, AGENTS.md, or applicable instructions. It returns the authoritative live global, project-root, and applicable nested instruction state with workspace metadata. Call it before claiming an instruction file is absent; do not use exec_command merely to inspect this context.
```

当前 `make_tool_result()` 会把完整字典放进模型可见的 `structuredContent`，因此正文不需要再复制一份到 `content`。但应为 `workspace_context` 增加简短文本渲染器，至少说明：

```text
Workspace context loaded. Applicable instructions are in structuredContent.instructions; revision sha256:...; sharing mode: content.
```

这样可兼容只突出文本摘要的客户端，同时避免正文重复消耗上下文。

### 6.4 复用到 `agent_workflow`

`prepare_coding_context` 当前手工构造 `instructions` 字典，应改为调用统一装配入口。以下阶段必须得到同一结构：

- `agent_workflow phase=prepare`
- `agent_workflow phase=run`
- `agent_workflow phase=resume`

路径来源按以下顺序合并、去重：

1. `path`
2. `paths[]`
3. 搜索后选中的 `selected_paths`
4. 执行阶段即将修改、读取、测试或构建的文件路径

如果执行计划新增了之前未出现的目录，服务端必须在写入前补算该目录的嵌套规则。不能仅依赖 prepare 阶段的旧路径集合。

### 6.5 自动刷新与缓存失效

为 `Runtime` 增加 `refresh_project_context_if_changed()`，在以下入口调用：

- `initialize`
- `server/discover`
- `workspace_context`
- `prepare_coding_context`
- `agent_workflow` 在真正写文件前

建议刷新算法：

1. 计算已知全局、根和嵌套候选文件的存在状态、规范化路径、`mtime_ns` 和大小。
2. 对目录扫描结果也计算签名，以检测规则文件新增和删除。
3. 快速签名未变化时复用内存对象；变化时重新读取正文并计算内容 `revision`。
4. 内容 revision 变化后，清理当前工作区的 `_FAST_TOOL_CACHE` 与 `_CONTEXT_BUNDLE_CACHE`。
5. 缓存键中加入 instruction revision，作为并发情况下的第二道保护。

可以给文件状态检查增加很短的节流窗口以降低扫描开销，但不能继续使用 30 秒工具缓存返回旧规则。刷新与缓存操作应置于同一把 Runtime 级锁下，避免一个请求看到新目录列表和旧正文的混合状态。

### 6.6 分享控制与敏感信息边界

本机全局 `AGENTS.md` 当前包含服务连接和认证类信息。修复会让工具调用更可靠，因此也会让原本“尝试发送但未稳定生效”的内容真正进入远端模型上下文；这必须视为发布阻断风险。

新增本地配置 `instructionSharingMode`：

| 模式 | 返回内容 | 用途 |
| --- | --- | --- |
| `off` | 不返回路径和正文，只报告策略关闭 | 完全禁用 |
| `metadata` | 返回路径、作用域、revision、截断和告警，不返回正文 | 安全诊断 |
| `content` | 返回经用户预览并授权的适用正文 | 实际遵循规则 |

推荐行为：

- 新安装和升级后的首次运行默认 `metadata`，由用户在本地 Web 管理页预览后显式切换到 `content`。
- 配置由 [`config.js`](../src/services/config.js)、[`settingsStore.js`](../src/services/settingsStore.js) 和 Web 设置接口持久化，再由 [`nativeService.js`](../src/services/nativeService.js) 通过环境变量传给 MCP。
- 切换模式需要重启 Runtime 或触发明确的上下文刷新，并让 ChatGPT 刷新连接元数据。
- UI 必须说明“content 会把适用指令发送给已连接的模型服务”，并显示文件路径、大小、截断状态，不在普通日志中显示正文。
- 长期方案是把凭据移出 `AGENTS.md`，放入环境变量或现有 SecretStore，只在规则里保留变量名、服务用途和非秘密操作约定。
- 不提供名为 `sanitized` 的自动模式，除非有可审计的结构化规则格式。通用正则无法可靠识别所有私钥、令牌、密码和业务秘密。
- 无论分享模式如何，完整正文都不得出现在 `initialize`、`server/discover`、工具描述、遥测、错误堆栈或普通日志中。

## 7. 预计代码改动

| 文件 | 改动 |
| --- | --- |
| [`project_context.py`](../resources/coding-tools-mcp/coding_tools_mcp/project_context.py) | 拆分路由指令和正文载荷；计算适用嵌套规则、revision、文件签名和分享状态 |
| [`server.py`](../resources/coding-tools-mcp/coding_tools_mcp/server.py) | `initialize` 只返回短指令；扩展 `workspace_context`；让编码工作流复用统一载荷；执行前刷新；缓存键加入 revision |
| [`protocol.py`](../resources/coding-tools-mcp/coding_tools_mcp/protocol.py) | `server/discover` 返回与 `initialize` 一致的短 `instructions` |
| [`tool_results.py`](../resources/coding-tools-mcp/coding_tools_mcp/tool_results.py) | 增加 `workspace_context` 文本摘要渲染器，不重复正文 |
| [`config.js`](../src/services/config.js) | 定义并校验 `instructionSharingMode` |
| [`nativeService.js`](../src/services/nativeService.js) | 把分享模式加入 Runtime 指纹和 MCP 环境；配置变化时重建 Runtime |
| [`web/server.js`](../web/server.js) | 允许保存分享模式并保持 API 脱敏 |
| `renderer/index.html`、`renderer/app.js` | 增加本地预览、风险提示和模式选择 |
| [`test_project_context.py`](../resources/coding-tools-mcp/tests/test_project_context.py) | 覆盖装配、优先级、截断、revision、刷新和分享策略 |
| [`test_task_state_and_build.py`](../resources/coding-tools-mcp/tests/test_task_state_and_build.py) | 覆盖 8 工具边界、`workspace_context`、工作流复用和 `server/discover` 对称性 |
| [`README.md`](../README.md)、[`ARCHITECTURE.md`](ARCHITECTURE.md) | 删除“正文直接进入初始化”的旧说明，改为“初始化路由 + 工具实时加载” |

## 8. 测试计划

### 8.1 单元测试

`ProjectContext` 至少覆盖：

- 全局不存在、存在、非 UTF-8、超限截断。
- 全局、根、父级嵌套、深层嵌套的排序与覆盖顺序。
- 单路径和跨多个子目录路径的 `applicable_to`。
- 符号链接越界、文件新增、修改、删除。
- 相同内容保持相同 revision；内容或截断状态变化会改变 revision。
- `off`、`metadata`、`content` 三种分享模式。
- 警告与策略阻止状态不能被表示成“文件不存在”。

Runtime 和协议至少覆盖：

- `initialize.instructions` 不含测试正文哨兵，只含短路由指令。
- 路由关键句结束位置小于等于 512 字符。
- `server/discover.instructions` 与初始化完全相同。
- `workspace_context` 在 compact 和 full 下都有指令状态。
- `workspace_context` 工具描述以 `Use this when` 开头并包含 `AGENTS.md`。
- `agent_workflow` 的 prepare/run/resume 返回同结构、同 revision。
- 修改规则后不重启 Runtime，下一次调用能拿到新 revision 和新正文。
- 指令变化后两个缓存都失效；内容不变时仍可命中缓存。
- `smart` 模式仍严格等于现有 8 个工具。
- 初始化、发现、日志和错误结果不包含秘密测试夹具。

建议命令：

```bash
PYTHONPATH=resources/coding-tools-mcp \
  python3 -m unittest discover -s resources/coding-tools-mcp/tests -p 'test_*.py'

npm test
npm run check
```

### 8.2 协议测试

使用 MCP Inspector 或等价 JSON-RPC 探针验证：

1. 标准 `initialize` 成功，短指令存在且无正文哨兵。
2. `server/discover` 在初始化前可调用，并返回相同短指令。
3. `tools/list` 中 `workspace_context` 的名称、描述、schema 和只读 annotation 正确。
4. `tools/call workspace_context` 的 `structuredContent.instructions` 包含安全哨兵、路径、作用域和 revision。
5. 修改测试 `AGENTS.md` 后再次调用，不重启即可看到新 revision。
6. Tunnel 连接下重复上述检查，比较本地 MCP 与 Tunnel 返回的关键字段。

### 8.3 ChatGPT 开发者模式端到端测试

每次修改工具描述、schema 或服务器指令后：重启/部署 MCP，在 ChatGPT Plugins 连接中选择 Refresh，确认元数据变化，然后新建会话。旧会话不能作为验收依据。

建立固定 golden prompt 集：

| 类型 | 示例 | 期望 |
| --- | --- | --- |
| 直接 | “当前是否加载了全局 AGENTS.md？路径是什么？” | 调用 `workspace_context`，区分 loaded、withheld、missing |
| 间接 | “这台机器做 Android 构建有什么本地约定？” | 调用 `workspace_context`，使用已授权规则回答 |
| 编码 | “修改子目录 A 中的文件并测试” | `agent_workflow` 加载 global/root/A 的规则 |
| 多目录 | “同时修改 A 和 B” | 各自只应用本目录嵌套规则 |
| 刷新 | 修改安全哨兵后再次询问 | 无需重启 MCP 即看到新值 |
| 负例 | 普通知识问答 | 不调用工作区工具 |
| 安全 | 分享模式为 metadata 时询问正文 | 明确说明正文被策略阻止，不猜测、不泄露 |

记录每条用例的工具选择、参数、结构化结果、最终回答和是否发生误触发。验收不仅看工具是否调用，还要检查最终回答确实使用了返回的优先级和正文。

## 9. 验收标准

修复完成必须同时满足：

1. 开启 `content` 分享后，安全哨兵能通过 `workspace_context` 和 `agent_workflow` 被模型准确复述或遵循。
2. 模型在未调用上下文工具前，不再断言全局或项目 `AGENTS.md` 不存在。
3. `initialize` 与 `server/discover` 都有相同短路由指令，且不含完整规则正文。
4. 全局文件大于 16 KiB 时，工具结果明确报告截断；不能静默表现成“全部加载”。
5. 修改、新增、删除规则后，无需重启 MCP 即在下一次相关调用中生效。
6. 根和嵌套规则的顺序、作用域及冲突优先级正确。
7. `smart` 模式仍只有 8 个工具。
8. 初始化、发现、工具元数据、日志和遥测中没有规则正文或秘密测试值。
9. `metadata` 模式下能诊断文件状态，但模型无法取得正文。
10. 本地直连和 Secure MCP Tunnel 的协议结果一致。

## 10. 发布与回滚

### 10.1 分阶段发布

1. 先完成 Python 服务端、协议、缓存和单元测试。
2. 完成 Web 分享控制与预览；在此之前不得把可靠正文注入作为正式版本发布。
3. 更新 README 和架构文档，构建新的 native ELF。
4. 本地 Inspector 验证后，再通过 Secure MCP Tunnel 验证。
5. 在 ChatGPT 中 Refresh 连接并新建会话，运行完整 golden prompt 集。
6. 观察工具调用错误、上下文大小、刷新次数和错误选择率；日志只记录 revision、路径状态和耗时，不记录正文。

### 10.2 回滚

- 保留上一版本 ELF 和配置备份。
- 若新版本导致工具选择异常，可回滚二进制并将分享模式切换为 `metadata` 或 `off`。
- 回滚后同样需要刷新 ChatGPT 连接并新建会话，避免旧元数据继续影响判断。
- 不应通过恢复“初始化塞完整正文”的方式回滚安全边界。

## 11. 实施时必须更新的旧说明

当前 [`README.md`](../README.md) 和 [`ARCHITECTURE.md`](ARCHITECTURE.md) 都写着“全局和项目根正文直接进入初始化响应，修改后需重启 MCP”。实现本方案后，这两句话必须同步改为：

```text
MCP 初始化只返回精简的指令加载路由。全局、项目根和目标路径适用的嵌套规则由 workspace_context 或 agent_workflow 实时返回；修改规则后会自动刷新并使相关缓存失效。正文是否返回受本地 instructionSharingMode 控制。
```

## 12. 决策记录与待确认项

已确定：

- 不新增 `smart` 工具。
- 不再把正文放入初始化或发现响应。
- `workspace_context` 是简单问答的权威入口。
- `agent_workflow` 与 `workspace_context` 使用同一装配逻辑。
- 自动刷新必须和缓存失效一起实现。
- 不使用不可审计的自动“脱敏”承诺。

实现决策：

- 升级用户的 `instructionSharingMode` 一律迁移为 `metadata`；只有 Web 管理页的明确确认才能切换到 `content`。
- 第一版保留现有上限：全局和单个规则文件 16 KiB，项目根规则合计 32 KiB；结果明确报告截断，暂不增加分页。
- 第一版不增加扫描节流窗口。相关上下文请求均重新计算不可变快照，以保证紧接着的一次请求也能观察到新增、修改和删除；内容未变化时 revision 不变并可继续命中缓存。

## 13. 官方依据

- [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)：服务器指令用于跨工具指导，最重要内容应在前 512 字符；工具元数据决定模型何时、如何调用；结果应提供足够的模型可见信息且不得包含秘密。
- [Optimize Metadata](https://developers.openai.com/plugins/guides/optimize-metadata)：描述应以 “Use this when…” 开头，并用直接、间接和负例提示集评估工具选择。
- [Connect and test your plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt)：元数据变化后要重启/部署、Refresh 连接、确认元数据并新建会话复测。
- [Security & Privacy](https://developers.openai.com/plugins/guides/security-privacy)：遵循最小权限、明确用户同意、纵深防御，只返回当前请求所需的数据并避免在日志中记录敏感内容。
- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)：Tunnel 把 OpenAI 产品的 MCP JSON-RPC 请求转发给私有服务并回传响应，适合在端到端阶段验证传输一致性。
