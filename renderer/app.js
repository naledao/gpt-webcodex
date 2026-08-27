const api = window.mcpAssistant || createPreviewApi();

function createPreviewApi() {
  const previewSettings = {
    workspace: 'C:\\Users\\示例用户\\Desktop\\my-project', permissionMode: 'safe', toolMode: 'smart',
    mcpPort: 18765, healthPort: 18081, proxyMode: 'auto', proxyUrl: '', tunnelId: 'tunnel_demo',
    theme: 'light', startWithWindows: false, progressReportSeconds: 90, keepRunningOnClose: true, autoStartServices: false, globalAgentsEnabled: false, firstRunCompleted: true, guideProgress: {}, authorizedRoots: []
  };
  const snapshot = {
    settings: previewSettings,
    secrets: { runtimeApiKey: true, mcpAuthToken: true },
    environment: {
      python: { installed: true, version: 'Python 3.12.10' },
      proxy: { mode: 'auto', configured: false, reachable: true, source: 'auto-direct', url: '' }, tunnelClient: { installed: true },
      workspace: { configured: true, exists: true }, globalAgents: { enabled: false, codexHome: 'C:\\Users\\示例用户\\.codex', path: 'C:\\Users\\示例用户\\.codex\\AGENTS.md', exists: false, source: '' }, ports: { mcpListening: true, tunnelListening: true }
    },
    status: { busy: false, runtimeRunning: true, tunnelRunning: true, fullyReady: true, localMcpUrl: 'http://127.0.0.1:18765/mcp', tunnelUiUrl: 'http://127.0.0.1:18081/ui' }
  };
  const updatePreview = { currentVersion: '0.1.9', platform: 'win32', architecture: 'x64', canUpdate: false, capabilityReason: '静态预览模式不会安装更新。', phase: 'idle', available: false, downloaded: false, progress: 0, latest: null, error: '' };
  const ok = (data) => Promise.resolve({ ok: true, data });
  return {
    snapshot: () => ok(snapshot), chooseWorkspace: () => ok(snapshot.settings.workspace), switchWorkspace: (workspace) => { snapshot.settings.workspace=workspace; return ok(snapshot); }, updateAuthorizedRoots: (roots) => { snapshot.settings.authorizedRoots=roots; return ok(snapshot); }, closeManager: () => ok(true),
    saveSettings: (patch) => { Object.assign(snapshot.settings, patch); return ok(snapshot.settings); },
    saveRuntimeKey: () => ok(snapshot.secrets), removeRuntimeKey: () => ok(snapshot.secrets), regenerateMcpToken: () => ok(snapshot.secrets),
    start: () => ok(snapshot), stop: () => ok(snapshot), restart: () => ok(snapshot),
    logs: () => ok([{ time: new Date().toISOString(), level: 'info', message: '静态界面预览模式' }]), clearLogs: () => ok(true),
    taskState: () => ok({ exists: false, state: null }), clearTaskState: () => ok(true), pauseTask: () => ok({}), resumeTask: () => ok({}), stopTask: () => ok({}), taskHistory: () => ok([]), performanceTrace: () => ok(null), clearPerformanceTrace: () => ok(true),
    inspectBuild: () => ok({ type: 'electron', name: 'demo', version: '0.1.0', testCommand: 'npm test', buildCommand: 'npm run dist', artifacts: ['dist'] }), runBuild: () => ok({ overallStatus: 'passed', project: { type: 'electron', name: 'demo', version: '0.1.0' }, testResult: { status: 'passed' }, buildResult: { status: 'passed' }, artifacts: [] }), inspectHealth: () => ok({ healthy: true, checks: [] }), repairHealth: () => ok({ healthy: true, checks: [], actions: [], unresolved: [] }),
    updateStatus: () => ok(updatePreview), checkForUpdate: () => ok(updatePreview), downloadUpdate: () => ok(updatePreview), installUpdate: () => ok(updatePreview),
    openExternal: () => ok(true), installPython: () => ok(true), detectProxy: () => ok(snapshot.environment.proxy), onProgress: () => () => {}, onLog: () => () => {}, onStatus: () => () => {}, onHeartbeat: () => () => {}, onBuildProgress: () => () => {}, onUpdateState: () => () => {}
  };
}

const pageMeta = {
  overview: ['CONTROL CENTER', '运行总览', '集中查看本地 MCP、OpenAI Tunnel 与部署环境。'],
  deploy: ['RUNTIME & CONNECTION', '运行与连接', '管理便携运行时、Tunnel 身份和网络环境。'],
  workspace: ['WORKSPACE ACCESS', '工作区与权限', '管理主工作区、额外授权目录与命令权限。'],
  task: ['TASK STATE', '任务执行状态', '查看可恢复目标、执行步骤、命令、测试、文件和构建报告。'],
  build: ['BUILD & VERIFY', '构建与验证', '自动识别项目、执行测试与构建，并校验构建产物。'],
  health: ['DIAGNOSE & REPAIR', '诊断与修复', '检查运行环境并修复助手能够安全处理的问题。'],
  guide: ['SETUP GUIDE', '接入指南', '按步骤完成 OpenAI Tunnel 与 ChatGPT 网页连接。'],
  logs: ['DIAGNOSTICS', '运行日志', '查看便携运行时、MCP 和 Tunnel 的诊断信息。'],
  settings: ['PREFERENCES', '偏好设置', '管理外观、启动行为、任务反馈和本地凭据。']
};

const state = {
  snapshot: null,
  currentPage: 'overview',
  selectedWorkspace: '',
  logFilter: 'all',
  logs: [],
  busy: false,
  initializedForms: false,
  update: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function unwrap(result) {
  if (!result?.ok) throw new Error(result?.error || '操作失败');
  return result.data;
}

function toast(title, message = '', type = 'success') {
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  const heading = document.createElement('b');
  heading.textContent = title;
  const detail = document.createElement('span');
  detail.textContent = message;
  element.append(heading, detail);
  $('#toastStack').appendChild(element);
  setTimeout(() => element.remove(), 4200);
}

function setBusy(value, overlay = false) {
  state.busy = value;
  $('#busyOverlay').classList.toggle('visible', value && overlay);
  ['#topStartButton', '#heroStartButton', '#deployNow', '#overviewRestart', '#overviewStop'].forEach((selector) => {
    const element = $(selector);
    if (element) element.disabled = value;
  });
}

function setDot(element, status) {
  if (!element) return;
  element.classList.remove('ready', 'warn', 'error');
  if (status) element.classList.add(status);
}

function navigate(page) {
  if (!pageMeta[page]) return;
  state.currentPage = page;
  if (location.hash !== `#${page}`) history.replaceState(null, '', `#${page}`);
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.page === page));
  $$('.page').forEach((item) => item.classList.toggle('active', item.dataset.pageView === page));
  const [eyebrow, title, subtitle] = pageMeta[page];
  $('#pageEyebrow').textContent = eyebrow;
  $('#pageTitle').textContent = title;
  $('#pageSubtitle').textContent = subtitle;
  $('.content-viewport').scrollTop = 0;
  if (page === 'logs') loadLogs();
  if (page === 'task') loadTaskState();
  if (page === 'build') inspectBuild();
  if (page === 'health') inspectHealth();
}

function textOr(value, fallback = '—') { return String(value ?? '').trim() || fallback; }

function renderTaskList(container, items, render) {
  container.replaceChildren();
  if (!items?.length) {
    const empty = document.createElement('span'); empty.className = 'task-muted'; empty.textContent = '暂无记录'; container.appendChild(empty); return;
  }
  items.forEach((item) => container.appendChild(render(item)));
}

function renderTaskState(payload) {
  const task = payload?.state;
  const hasTask = Boolean(task && (
    textOr(task.objective, '') ||
    textOr(task.current_step, '') ||
    textOr(task.next_step, '') ||
    (Array.isArray(task.steps) && task.steps.length) ||
    (task.status && task.status !== 'idle')
  ));
  $('#taskStateEmpty').hidden = hasTask;
  $('#taskStateContent').hidden = !hasTask;
  if (!hasTask) return;
  $('#taskObjective').textContent = textOr(task.objective, '未填写当前目标');
  $('#taskId').textContent = textOr(task.task_id);
  $('#taskStatus').textContent = textOr(task.status, 'idle');
  $('#taskCurrentStep').textContent = textOr(task.current_step);
  $('#taskNextStep').textContent = textOr(task.next_step);
  $('#taskFailureRow').hidden = !task.failure;
  $('#taskFailure').textContent = textOr(task.failure);
  const steps = Array.isArray(task.steps) ? task.steps : [];
  const done = steps.filter((item) => item.status === 'completed').length;
  $('#taskStepCount').textContent = `${done} / ${steps.length}`;
  renderTaskList($('#taskSteps'), steps, (item) => { const row=document.createElement('div'); row.className=`task-step ${item.status || 'pending'}`; const mark=document.createElement('i'); mark.textContent=item.status==='completed'?'✓':item.status==='in_progress'?'→':item.status==='failed'?'!':'•'; const label=document.createElement('span'); label.textContent=textOr(item.text); row.append(mark,label); return row; });
  const command = task.current_command;
  $('#taskCommand').textContent = command ? `${textOr(command.command)}\n${textOr(command.status)} · ${textOr(command.workdir, '.')}` : '当前没有运行中的命令';
  const tests = Array.isArray(task.test_results) ? task.test_results.slice(-5).reverse() : [];
  renderTaskList($('#taskTests'), tests, (item) => { const row=document.createElement('div'); row.className=`task-result ${item.status}`; row.textContent=`${item.status === 'passed' ? '通过' : '失败'} · ${textOr(item.command, '测试')} · ${item.duration_ms ?? 0} ms`; return row; });
  const files = Array.isArray(task.modified_files) ? task.modified_files.slice().reverse() : [];
  $('#taskFileCount').textContent = String(files.length);
  renderTaskList($('#taskFiles'), files, (item) => { const row=document.createElement('div'); row.className='task-file'; const op=document.createElement('b'); op.textContent=textOr(item.operation, 'update').slice(0,1).toUpperCase(); const file=document.createElement('span'); file.textContent=textOr(item.path); row.append(op,file); return row; });
  const report = task.last_build_report;
  const build = $('#taskBuild'); build.replaceChildren();
  if (!report) { build.textContent='尚未运行 verify_build。'; }
  else {
    const summary=document.createElement('div'); summary.className=`build-summary ${report.overall_status}`; summary.textContent=`${report.overall_status === 'passed' ? '验证通过' : '验证失败'} · ${textOr(report.project?.type)} · v${textOr(report.project?.version)}`; build.appendChild(summary);
    (report.artifacts || []).slice(0,8).forEach((item) => { const row=document.createElement('div'); row.className='task-artifact'; const path=document.createElement('span'); path.textContent=textOr(item.path); const hash=document.createElement('code'); hash.textContent=textOr(item.sha256 || item.sha384 || item.sha512).slice(0,16); row.append(path,hash); build.appendChild(row); });
    if (!(report.artifacts || []).length) { const empty=document.createElement('span'); empty.className='task-muted'; empty.textContent=textOr(report.failure, '没有找到构建产物'); build.appendChild(empty); }
  }
}

async function loadTaskState() {
  try {
    const [taskPayload] = await Promise.all([api.taskState(), loadTaskHistory(), loadPerformanceTrace()]);
    renderTaskState(unwrap(taskPayload));
  }
  catch (error) { toast('任务状态读取失败', error.message, 'error'); }
}

function formatDuration(ms) {
  const value = Number(ms || 0);
  if (value < 1000) return `${value} ms`;
  if (value < 60000) return `${(value / 1000).toFixed(1)} 秒`;
  return `${Math.floor(value / 60000)} 分 ${Math.round((value % 60000) / 1000)} 秒`;
}

function renderPerformanceTrace(trace) {
  const metrics = $('#performanceMetrics');
  const timeline = $('#performanceTimeline');
  metrics.replaceChildren(); timeline.replaceChildren();
  if (!trace || !trace.tool_calls) {
    const empty = document.createElement('span'); empty.className = 'task-muted'; empty.textContent = '暂无性能记录'; metrics.append(empty); return;
  }
  const items = [
    ['工具调用', trace.tool_calls], ['本机执行', formatDuration(trace.local_execution_ms)],
    ['估算等待', formatDuration(trace.estimated_wait_ms)], ['缓存命中', trace.cache_hits || 0],
    ['重复拦截', trace.deduplicated_calls || 0], ['失败', trace.errors || 0]
  ];
  items.forEach(([label, value]) => { const card=document.createElement('div'); card.className='performance-metric'; const b=document.createElement('b'); b.textContent=String(value); const span=document.createElement('span'); span.textContent=label; card.append(b,span); metrics.append(card); });
  (trace.recent || []).slice(-30).reverse().forEach((event) => {
    const row=document.createElement('div'); row.className='performance-event';
    const tool=document.createElement('b'); tool.textContent=textOr(event.tool);
    const local=document.createElement('span'); local.textContent=`本机 ${formatDuration(event.duration_ms)}`;
    const wait=document.createElement('span'); wait.textContent=`等待 ${formatDuration(event.wait_before_ms)}`;
    const flag=document.createElement('span'); flag.textContent=event.deduplicated ? '已去重' : event.cache_hit ? '缓存' : event.ok ? '完成' : '失败'; if (event.cache_hit || event.deduplicated) flag.className='cache-hit';
    row.append(tool,local,wait,flag); timeline.append(row);
  });
}

async function loadPerformanceTrace() {
  try { renderPerformanceTrace(unwrap(await api.performanceTrace())); }
  catch (error) { renderPerformanceTrace(null); }
}

async function loadTaskHistory() {
  const container = $('#taskHistory');
  try {
    const items = unwrap(await api.taskHistory());
    renderTaskList(container, items, (task) => {
      const row = document.createElement('div'); row.className = 'task-history-item';
      const copy = document.createElement('div');
      const title = document.createElement('b'); title.textContent = textOr(task.objective, '未命名任务');
      const meta = document.createElement('small'); meta.textContent = `${textOr(task.status, 'unknown')} · ${textOr(task.task_id)} · ${new Date(task.archived_at || task.updated_at || Date.now()).toLocaleString('zh-CN')}`;
      copy.append(title, meta); row.append(copy); return row;
    });
  } catch (error) { container.textContent = `读取失败：${error.message}`; }
}

function applyTheme(theme) {
  document.body.dataset.theme = theme === 'light' ? 'light' : 'dark';
  $('#themeSelect').value = theme === 'light' ? 'light' : 'dark';
}

function applyFormValues(snapshot, force = false) {
  if (state.initializedForms && !force) return;
  const settings = snapshot.settings;
  state.selectedWorkspace = settings.workspace;
  $('#tunnelIdInput').value = settings.tunnelId || '';
  $('#proxyModeSelect').value = settings.proxyMode || 'auto';
  $('#proxyUrlInput').value = settings.proxyUrl || '';
  $('#mcpPortInput').value = settings.mcpPort;
  $('#healthPortInput').value = settings.healthPort;
  $('#startWithWindowsToggle').checked = Boolean(settings.startWithWindows);
  $('#keepRunningToggle').checked = settings.keepRunningOnClose;
  $('#autoStartToggle').checked = settings.autoStartServices;
  $('#globalAgentsToggle').checked = Boolean(settings.globalAgentsEnabled);
  $('#progressReportSelect').value = String(settings.progressReportSeconds || 90);
  if ($('#toolModeSelect')) $('#toolModeSelect').value = 'smart';
  $$('input[name="permission"]').forEach((input) => {
    input.checked = input.value === settings.permissionMode;
    input.closest('.choice').classList.toggle('selected', input.checked);
  });
  applyTheme(settings.theme);
  restoreGuideProgress(settings.guideProgress || {});
  renderProxyControls();
  state.initializedForms = true;
}

function renderSnapshot(snapshot, options = {}) {
  state.snapshot = snapshot;
  applyFormValues(snapshot, options.forceForms);
  const { settings, secrets, environment, status } = snapshot;
  state.selectedWorkspace = settings.workspace;
  const ready = status.fullyReady;

  $('#sideRuntimeText').textContent = ready ? '服务已就绪' : status.runtimeRunning ? '等待 Tunnel' : '服务未运行';
  setDot($('#sideRuntimeDot'), ready ? 'ready' : status.runtimeRunning ? 'warn' : 'error');
  $('#sideWorkspace').textContent = settings.workspace || '尚未选择工作目录';
  $('#sideMcp').textContent = status.runtimeRunning ? 'ON' : 'OFF';
  $('#sideTunnel').textContent = status.tunnelRunning ? 'ON' : 'OFF';

  $('#runtimeStatus').textContent = environment.python.installed ? '环境正常' : '运行时缺失';
  $('#runtimeMeta').textContent = environment.python.version || '未找到内置 Python';
  setDot($('#runtimeDot'), environment.python.installed ? 'ready' : 'error');

  $('#mcpStatus').textContent = status.runtimeRunning ? '正常运行' : '未启动';
  $('#mcpMeta').textContent = status.localMcpUrl;
  setDot($('#mcpDot'), status.runtimeRunning ? 'ready' : 'error');
  $('#tunnelStatus').textContent = status.tunnelRunning ? '已连接' : '未连接';
  $('#tunnelMeta').textContent = settings.tunnelId || '尚未填写 Tunnel ID';
  setDot($('#tunnelDot'), status.tunnelRunning ? 'ready' : settings.tunnelId ? 'warn' : 'error');
  $('#workspaceStatus').textContent = environment.workspace.exists ? '已授权' : '未选择';
  $('#workspaceMeta').textContent = settings.workspace || '仅所选目录可被 MCP 访问';
  setDot($('#workspaceDot'), environment.workspace.exists ? 'ready' : 'error');
  $('#selectedWorkspace').textContent = settings.workspace || '尚未选择目录';
  renderAuthorizedRoots(settings.authorizedRoots || []);
  renderGlobalAgents(settings, environment.globalAgents);

  $('#heroBadge').textContent = ready ? '全部服务运行正常' : '尚未完成部署';
  $('#heroTitle').textContent = ready ? '网页编程工作区已经准备好' : '让网页聊天安全访问你的代码目录';
  $('#heroText').textContent = ready
    ? `当前通过内置便携运行时运行，网页可访问已授权目录${settings.globalAgentsEnabled ? '并只读加载全局 AGENTS.md' : ''}。`
    : '选择一个工作目录，配置 OpenAI Tunnel，然后由助手完成 MCP 的启动、鉴权、健康检查和故障诊断。';
  $('#heroStartButton').textContent = ready ? '重新部署' : '开始部署';
  $('#topStartButton').textContent = ready ? '重新部署' : '一键启动';

  $('#runtimeKeyHint').textContent = secrets.runtimeApiKey ? '已使用 Windows 安全存储保存' : '尚未保存';
  $('#runtimeKeyHint').style.color = secrets.runtimeApiKey ? 'var(--green)' : '';
  $('#settingsKeyState').textContent = secrets.runtimeApiKey ? '已加密保存' : '尚未保存';
  $('#guideLocalUrl').textContent = status.localMcpUrl;
  $('#guideTunnelId').textContent = settings.tunnelId || '尚未填写';
  renderEnvironment(environment);
  renderDeploySummary();
}

function renderAuthorizedRoots(roots) {
  const container = $('#authorizedRootsList');
  if (!container) return;
  container.replaceChildren();
  if (!roots.length) {
    const empty = document.createElement('span');
    empty.className = 'task-muted';
    empty.textContent = '尚未添加额外授权目录';
    container.appendChild(empty);
    return;
  }
  roots.forEach((root) => {
    const row = document.createElement('div');
    row.className = 'authorized-root-row';
    const code = document.createElement('code');
    code.textContent = root;
    code.title = root;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger-button';
    remove.textContent = '移除';
    remove.addEventListener('click', () => removeAuthorizedRoot(root));
    row.append(code, remove);
    container.appendChild(row);
  });
}

function renderGlobalAgents(settings, info = {}) {
  const enabled = Boolean(settings.globalAgentsEnabled);
  const path = textOr(info.path, '未能解析全局 AGENTS.md 路径');
  $('#globalAgentsPath').textContent = path;
  $('#globalAgentsPath').title = path;
  $('#globalAgentsStatus').textContent = enabled
    ? info.enabled === false
      ? '待保存并重新部署 · 届时检查全局规则文件'
      : info.exists ? `已启用 · 将读取 ${info.source || 'AGENTS.md'}` : '已启用 · 当前没有可注入的非空规则文件'
    : '当前未启用 · 不会读取或发送全局规则';
}

async function addAuthorizedRoot() {
  try {
    const selected = unwrap(await api.chooseWorkspace());
    if (!selected) return;
    const current = state.snapshot?.settings?.authorizedRoots || [];
    if (current.some((item) => item.toLowerCase() === selected.toLowerCase())) {
      toast('目录已授权', selected);
      return;
    }
    const snapshot = unwrap(await api.updateAuthorizedRoots([...current, selected]));
    renderSnapshot(snapshot, { forceForms: true });
    toast('已添加授权目录', selected);
  } catch (error) { toast('授权目录失败', error.message, 'error'); }
}

async function removeAuthorizedRoot(root) {
  try {
    const current = state.snapshot?.settings?.authorizedRoots || [];
    const snapshot = unwrap(await api.updateAuthorizedRoots(current.filter((item) => item !== root)));
    renderSnapshot(snapshot, { forceForms: true });
    toast('已移除授权目录', root);
  } catch (error) { toast('移除授权失败', error.message, 'error'); }
}

function renderEnvironment(environment) {
  setDot($('#envPythonDot'), environment.python.installed ? 'ready' : 'error');
  $('#envPythonText').textContent = environment.python.installed ? environment.python.version : '未找到 Python 3.11+';
  const proxy = environment.proxy;
  const sourceLabels = {
    'auto-direct': '自动检测 · 直连', 'auto-system': '自动检测 · Windows 系统代理', 'auto-local': '自动检测 · 本地代理',
    'system': 'Windows 系统代理', 'system-direct': '系统未设代理 · 直连', manual: '手动代理', direct: '强制直连',
    'auto-unavailable': '未找到可用网络路径', error: '代理检测失败'
  };
  setDot($('#envProxyDot'), proxy.reachable ? 'ready' : 'error');
  $('#envProxyText').textContent = `${sourceLabels[proxy.source] || '网络检测'}${proxy.url ? ` · ${proxy.url}` : ''}`;
  $('#proxyHint').textContent = proxy.reachable ? '当前网络路径已通过实际连通性验证。' : '当前路径未通过验证，可重新检测或选择手动代理。';
}

function renderProxyControls() {
  const manual = $('#proxyModeSelect').value === 'manual';
  $('#manualProxyField').classList.toggle('disabled', !manual);
  $('#proxyUrlInput').disabled = !manual;
}

function renderDeploySummary() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  const missing = [];
  const workspace = state.selectedWorkspace || snapshot.settings.workspace;
  const tunnelId = $('#tunnelIdInput').value.trim();
  if (!workspace) missing.push('工作目录');
  if (!tunnelId) missing.push('Tunnel ID');
  if (!snapshot.secrets.runtimeApiKey && !$('#runtimeKeyInput').value.trim()) missing.push('Runtime API Key');
  $('#deploySummary').textContent = missing.length ? `还需要填写：${missing.join('、')}` : '便携运行模式已完成必要配置。';
}

async function refreshSnapshot(options = {}) {
  try {
    const snapshot = unwrap(await api.snapshot());
    renderSnapshot(snapshot, options);
    return snapshot;
  } catch (error) {
    toast('状态检测失败', error.message, 'error');
    return null;
  }
}

function collectSettings() {
  return {
    workspace: state.selectedWorkspace,
    permissionMode: $('input[name="permission"]:checked')?.value || 'safe',
    toolMode: 'smart',
    mcpPort: Number($('#mcpPortInput').value),
    healthPort: Number($('#healthPortInput').value),
    proxyMode: $('#proxyModeSelect').value,
    proxyUrl: $('#proxyUrlInput').value.trim(),
    tunnelId: $('#tunnelIdInput').value.trim(),
    theme: $('#themeSelect').value,
    startWithWindows: $('#startWithWindowsToggle').checked,
    keepRunningOnClose: $('#keepRunningToggle').checked,
    autoStartServices: $('#autoStartToggle').checked,
    globalAgentsEnabled: $('#globalAgentsToggle').checked,
    progressReportSeconds: Number($('#progressReportSelect').value || 90),
    guideProgress: collectGuideProgress()
  };
}

async function saveSettings(showToast = true) {
  const saved = unwrap(await api.saveSettings(collectSettings()));
  if (showToast) toast('设置已保存', '新的配置会在下一次部署时生效。');
  if (state.snapshot) state.snapshot.settings = saved;
  return saved;
}

async function saveKeyIfPresent() {
  const key = $('#runtimeKeyInput').value.trim();
  if (!key) return false;
  unwrap(await api.saveRuntimeKey(key));
  $('#runtimeKeyInput').value = '';
  return true;
}

function updateProgress(payload) {
  const percent = Math.max(0, Math.min(100, Number(payload.percent || 0)));
  $('#progressPercent').textContent = `${percent}%`;
  $('#progressBar').style.width = `${percent}%`;
  $('#progressRing').style.setProperty('--value', `${percent * 3.6}deg`);
  $('#progressTitle').textContent = payload.step === 'failed' ? '部署失败' : payload.step === 'complete' ? '部署完成' : '正在执行部署任务';
  $('#progressMessage').textContent = payload.message;
  $('#progressBadge').textContent = payload.step === 'failed' ? '需要处理' : payload.step === 'complete' ? '已完成' : '运行中';
  if (payload.step === 'failed') toast('部署失败', payload.message, 'error');
}

async function runRuntime(action) {
  setBusy(true, false);
  navigate('overview');
  try {
    const result = unwrap(await api[action]());
    renderSnapshot(result, { forceForms: true });
    toast(action === 'stop' ? '服务已停止' : '操作完成', action === 'stop' ? 'MCP 与 Tunnel 已安全停止。' : 'MCP 与 Tunnel 已通过本地健康检查。');
  } catch (error) {
    toast('操作失败', error.message, 'error');
    if (/工作目录|Runtime API Key|Tunnel ID|Python/.test(error.message)) navigate('deploy');
  } finally {
    setBusy(false);
    await refreshSnapshot();
  }
}

async function deployNow() {
  setBusy(true, false);
  try {
    await saveKeyIfPresent();
    await saveSettings(false);
    navigate('overview');
    const result = unwrap(await api.start());
    renderSnapshot(result, { forceForms: true });
    toast('部署完成', '现在可以按照指导页面在 ChatGPT 中创建或测试 MCP。');
  } catch (error) {
    toast('部署失败', error.message, 'error');
  } finally {
    setBusy(false);
    await refreshSnapshot();
  }
}

async function chooseWorkspace() {
  try {
    const selected = unwrap(await api.chooseWorkspace());
    if (!selected) return;
    state.selectedWorkspace = selected;
    $('#selectedWorkspace').textContent = selected;
    renderDeploySummary();
    toast('正在切换工作目录', 'MCP 与 Tunnel 会在后台重启，以便 ChatGPT 重新加载项目规则。');
    const switched = unwrap(await api.switchWorkspace(selected));
    renderSnapshot(switched, { forceForms: true });
    toast('工作目录已切换', selected);
  } catch (error) { toast('无法选择目录', error.message, 'error'); }
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('已复制', text.length > 70 ? '内容已复制到剪贴板。' : text); }
  catch { toast('复制失败', '请手动选择并复制。', 'error'); }
}

function collectGuideProgress() {
  return Object.fromEntries($$('[data-guide-check]').map((input) => [input.dataset.guideCheck, input.checked]));
}

function restoreGuideProgress(progress) {
  $$('[data-guide-check]').forEach((input) => { input.checked = Boolean(progress[input.dataset.guideCheck]); });
  renderGuideProgress();
}

function renderGuideProgress() {
  const checks = $$('[data-guide-check]');
  const done = checks.filter((input) => input.checked).length;
  const percent = Math.round((done / checks.length) * 100);
  $('#guideProgressPercent').textContent = `${percent}%`;
  $('#guideProgressBar').style.width = `${percent}%`;
  checks.forEach((input, index) => {
    input.closest('.guide-step').classList.toggle('done', input.checked);
    $$('#guideChecklist li')[index]?.classList.toggle('done', input.checked);
  });
}

function appendBuildOutput(text) {
  const consoleElement = $('#buildConsole');
  const next = `${consoleElement.textContent === '尚未执行构建验证。' ? '' : consoleElement.textContent}${text}`;
  consoleElement.textContent = next.slice(-60000);
  consoleElement.scrollTop = consoleElement.scrollHeight;
}

function applyBuildProject(project) {
  $('#buildProjectType').textContent = `${textOr(project.type, 'unknown')} · ${textOr(project.name)}`;
  $('#buildTestCommand').value = project.testCommand || '';
  $('#buildCommand').value = project.buildCommand || '';
  $('#buildArtifacts').value = (project.artifacts || []).join(', ');
}

async function inspectBuild() {
  try { applyBuildProject(unwrap(await api.inspectBuild())); }
  catch (error) { toast('项目识别失败', error.message, 'error'); }
}

function renderBuildReport(report) {
  $('#buildReportStatus').textContent = report.overallStatus === 'passed' ? '验证通过' : '验证失败';
  const container = $('#buildReport'); container.replaceChildren();
  const summary = document.createElement('div'); summary.className = `build-report-summary ${report.overallStatus}`;
  summary.textContent = `${textOr(report.project?.name)} · ${textOr(report.project?.type)} · v${textOr(report.project?.version)} · 测试 ${textOr(report.testResult?.status)} · 构建 ${textOr(report.buildResult?.status)}`;
  container.append(summary);
  (report.artifacts || []).forEach((artifact) => {
    const row = document.createElement('div'); row.className = 'build-report-artifact';
    const name = document.createElement('b'); name.textContent = textOr(artifact.path);
    const size = document.createElement('span'); size.textContent = `${Number(artifact.size || 0).toLocaleString()} bytes`;
    const hash = document.createElement('code'); hash.textContent = textOr(artifact.sha256);
    row.append(name, size, hash); container.append(row);
  });
  if (!(report.artifacts || []).length) {
    const empty = document.createElement('span'); empty.className = 'task-muted'; empty.textContent = '未找到构建产物。'; container.append(empty);
  }
}

async function runBuildVerification() {
  $('#buildConsole').textContent = '';
  $('#buildStatus').textContent = '正在执行';
  $('#runBuild').disabled = true;
  try {
    const options = {
      testCommand: $('#buildTestCommand').value.trim(),
      buildCommand: $('#buildCommand').value.trim(),
      artifacts: $('#buildArtifacts').value.split(',').map((item) => item.trim()).filter(Boolean),
      runTests: $('#buildRunTests').checked,
      runBuild: $('#buildRunBuild').checked
    };
    const report = unwrap(await api.runBuild(options));
    renderBuildReport(report);
    $('#buildStatus').textContent = report.overallStatus === 'passed' ? '已通过' : '未通过';
    toast(report.overallStatus === 'passed' ? '构建验证通过' : '构建验证未通过', `${report.artifacts?.length || 0} 个产物已校验`, report.overallStatus === 'passed' ? 'success' : 'error');
  } catch (error) {
    $('#buildStatus').textContent = '执行失败'; appendBuildOutput(`\n${error.message}\n`); toast('构建验证失败', error.message, 'error');
  } finally { $('#runBuild').disabled = false; }
}

function renderHealth(report) {
  $('#healthSummary').textContent = report.healthy ? '全部正常' : '需要处理';
  const container = $('#healthList'); container.replaceChildren();
  (report.checks || []).forEach((check) => {
    const row = document.createElement('div'); row.className = `health-item ${check.ok ? 'passed' : 'failed'}`;
    const mark = document.createElement('i'); mark.textContent = check.ok ? '✓' : '!';
    const copy = document.createElement('div'); const title = document.createElement('b'); title.textContent = check.label; const detail = document.createElement('small'); detail.textContent = check.detail; copy.append(title, detail);
    const status = document.createElement('span'); status.textContent = check.ok ? '正常' : '待处理'; row.append(mark, copy, status); container.append(row);
  });
  (report.actions || []).forEach((action) => {
    const row = document.createElement('div'); row.className = 'health-item passed';
    const mark = document.createElement('i'); mark.textContent = '↻';
    const copy = document.createElement('div'); const title = document.createElement('b'); title.textContent = '已执行修复'; const detail = document.createElement('small'); detail.textContent = action; copy.append(title, detail);
    const status = document.createElement('span'); status.textContent = '完成'; row.append(mark, copy, status); container.append(row);
  });
}

async function inspectHealth() {
  try { renderHealth(unwrap(await api.inspectHealth())); }
  catch (error) { toast('系统体检失败', error.message, 'error'); }
}

async function repairHealth() {
  $('#repairHealth').disabled = true;
  try {
    const report = unwrap(await api.repairHealth()); renderHealth(report);
    toast(report.healthy ? '一键修复完成' : '已完成可自动处理的项目', report.unresolved?.length ? `仍需手动处理：${report.unresolved.join('、')}` : '当前环境已通过体检。', report.healthy ? 'success' : 'error');
  } catch (error) { toast('一键修复失败', error.message, 'error'); }
  finally { $('#repairHealth').disabled = false; }
}

function formatUpdateBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderUpdateStatus(status) {
  if (!status) return;
  state.update = status;
  const version = textOr(status.currentVersion, '0.0.0').replace(/^v/i, '');
  const latestVersion = textOr(status.latest?.version, '').replace(/^v/i, '');
  $('#currentVersionText').textContent = `v${version}`;
  $('#aboutVersion').textContent = `v${version}`;
  $('#updateArchitecture').textContent = `${status.platform || 'unknown'} · ${status.architecture || 'unknown'}`;
  $('#updateStatusChip').textContent = status.phase === 'downloaded' ? '等待安装' : status.busy ? '处理中' : status.phase === 'up-to-date' ? '已是最新' : status.available ? '有新版本' : '稳定通道';

  let title = '尚未检查更新';
  let detail = '应用会定期检查 GitHub 最新稳定版本，也可以立即手动检查。';
  if (!status.canUpdate) {
    title = '当前模式不支持安装更新';
    detail = status.capabilityReason || detail;
  } else if (status.phase === 'error') {
    title = '更新操作失败';
    detail = status.error || '请稍后重试。';
  } else if (status.phase === 'checking') {
    title = '正在检查 GitHub Releases';
    detail = '正在读取最新稳定版本与 Windows 更新元数据。';
  } else if (status.phase === 'up-to-date') {
    title = '当前已是最新版本';
    detail = `GitHub 最新稳定版本为 v${latestVersion || version}。`;
  } else if (status.phase === 'available') {
    title = `发现新版本 v${latestVersion}`;
    detail = '下载后会验证 SHA-512；已配置代码签名时还会验证安装包发布者。';
  } else if (status.phase === 'downloading') {
    title = `正在下载 v${latestVersion}`;
    detail = `${formatUpdateBytes(status.transferred)} / ${formatUpdateBytes(status.total)} · ${formatUpdateBytes(status.bytesPerSecond)}/s`;
  } else if (status.phase === 'downloaded') {
    title = `v${latestVersion} 已下载并验证`;
    detail = '安装时会先安全停止 MCP 与 Tunnel，完成后重启助手并恢复原来的服务状态。';
  } else if (status.phase === 'install-pending') {
    title = '即将安装并重启';
    detail = '本地服务已安全停止，安装程序正在启动。';
  }

  $('#updateStatusTitle').textContent = title;
  $('#updateStatusText').textContent = detail;
  $('#checkUpdateButton').disabled = Boolean(status.busy) || !status.canUpdate || status.downloaded;
  $('#downloadUpdateButton').disabled = Boolean(status.busy);
  $('#installUpdateButton').disabled = Boolean(status.busy);
  $('#downloadUpdateButton').hidden = !(status.available && !status.downloaded && status.phase !== 'downloading');
  $('#installUpdateButton').hidden = !status.downloaded;
  const showProgress = status.phase === 'downloading';
  $('#updateProgress').hidden = !showProgress;
  const percent = Math.max(0, Math.min(100, Number(status.progress || 0)));
  $('#updateProgressBar').value = percent;
  $('#updateProgressPercent').textContent = `${percent.toFixed(0)}%`;
  const notes = status.latest?.releaseNotes || '';
  $('#updateReleaseNotes').hidden = !notes;
  $('#updateReleaseNotesText').textContent = notes;
}

async function loadUpdateStatus() {
  try { renderUpdateStatus(unwrap(await api.updateStatus())); }
  catch (error) { toast('无法读取更新状态', error.message, 'error'); }
}

async function runUpdateAction(action) {
  try {
    const method = action === 'check' ? 'checkForUpdate' : action === 'download' ? 'downloadUpdate' : 'installUpdate';
    const result = unwrap(await api[method]());
    renderUpdateStatus(result);
    if (action === 'check') {
      toast(result.available ? `发现新版本 v${result.latest?.version}` : '当前已是最新版本', result.available ? '可以在设置页下载更新。' : `当前版本 v${result.currentVersion}。`);
    } else if (action === 'download') {
      toast('更新已下载并验证', '准备好后点击“安装并重启”。');
    } else {
      toast('正在启动安装程序', '助手将退出并在安装完成后重新启动。');
    }
  } catch (error) {
    toast(action === 'check' ? '检查更新失败' : action === 'download' ? '下载更新失败' : '安装更新失败', error.message, 'error');
    await loadUpdateStatus();
  }
}

function applyHeartbeat(status) {
  if (!state.snapshot || !status) return;
  state.snapshot.status.runtimeRunning = Boolean(status.mcpRunning);
  state.snapshot.status.tunnelRunning = Boolean(status.tunnelRunning);
  state.snapshot.status.fullyReady = Boolean(status.fullyReady);
  const ready = state.snapshot.status.fullyReady;
  $('#sideMcp').textContent = status.mcpRunning ? 'ON' : 'OFF';
  $('#sideTunnel').textContent = status.tunnelRunning ? 'ON' : 'OFF';
  $('#mcpStatus').textContent = status.mcpRunning ? '正常运行' : '未启动';
  $('#tunnelStatus').textContent = status.tunnelRunning ? '已连接' : '未连接';
  setDot($('#mcpDot'), status.mcpRunning ? 'ready' : 'error');
  setDot($('#tunnelDot'), status.tunnelRunning ? 'ready' : 'error');
  $('#sideRuntimeText').textContent = ready ? '服务已就绪' : status.mcpRunning ? '等待 Tunnel' : '服务未运行';
  setDot($('#sideRuntimeDot'), ready ? 'ready' : status.mcpRunning ? 'warn' : 'error');
}

async function loadLogs() {
  try {
    state.logs = unwrap(await api.logs());
    renderLogs();
  } catch (error) { toast('日志读取失败', error.message, 'error'); }
}

function renderLogs() {
  const output = $('#logOutput');
  const list = state.logFilter === 'all' ? state.logs : state.logs.filter((item) => item.level === state.logFilter);
  output.replaceChildren();
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<b>暂无匹配日志</b><span>执行部署或切换筛选条件后再查看。</span>';
    output.appendChild(empty);
    return;
  }
  list.forEach((item) => {
    const row = document.createElement('div');
    row.className = `log-line ${item.level}`;
    const time = document.createElement('time');
    time.textContent = new Date(item.time).toLocaleString('zh-CN', { hour12: false });
    const level = document.createElement('em');
    level.textContent = item.level;
    const message = document.createElement('span');
    message.textContent = item.message;
    row.append(time, level, message);
    output.appendChild(row);
  });
  output.scrollTop = output.scrollHeight;
}

function bindEvents() {
  $('#closeManager')?.addEventListener('click', () => api.closeManager());
  $$('.nav-item').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.page)));
  $$('[data-nav]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.nav)));
  $$('[data-open]').forEach((button) => button.addEventListener('click', async () => {
    try { unwrap(await api.openExternal(button.dataset.open)); }
    catch (error) { toast('无法打开页面', error.message, 'error'); }
  }));
  $$('input[name="permission"]').forEach((input) => input.addEventListener('change', () => {
    $$('.choice').forEach((choice) => choice.classList.toggle('selected', choice.contains(input) && input.checked));
  }));

  $('#refreshButton').addEventListener('click', () => refreshSnapshot());
  $('#topStartButton').addEventListener('click', () => runRuntime(state.snapshot?.status.fullyReady ? 'restart' : 'start'));
  $('#heroStartButton').addEventListener('click', () => state.snapshot?.status.fullyReady ? runRuntime('restart') : navigate('deploy'));
  $('#overviewRestart').addEventListener('click', () => runRuntime('restart'));
  $('#overviewStop').addEventListener('click', () => runRuntime('stop'));
  $('#deployNow').addEventListener('click', deployNow);
  $('#chooseWorkspace').addEventListener('click', chooseWorkspace);
  $('#addAuthorizedRoot').addEventListener('click', addAuthorizedRoot);
  $('#globalAgentsToggle').addEventListener('change', () => {
    renderGlobalAgents(
      { globalAgentsEnabled: $('#globalAgentsToggle').checked },
      state.snapshot?.environment?.globalAgents || {}
    );
  });
  $('#saveDeploySettings').addEventListener('click', async () => {
    try { await saveKeyIfPresent(); await saveSettings(); await refreshSnapshot({ forceForms: true }); }
    catch (error) { toast('保存失败', error.message, 'error'); }
  });
  $('#saveWorkspace').addEventListener('click', async () => {
    try { await saveSettings(); await refreshSnapshot({ forceForms: true }); }
    catch (error) { toast('保存失败', error.message, 'error'); }
  });
  $('#saveWorkspaceRestart').addEventListener('click', async () => {
    try { await saveSettings(false); await runRuntime('restart'); }
    catch (error) { toast('重新部署失败', error.message, 'error'); }
  });
  $('#saveRuntimeKey').addEventListener('click', async () => {
    try {
      if (!(await saveKeyIfPresent())) throw new Error('请先粘贴 Runtime API Key。');
      toast('密钥已安全保存', '密钥已使用 Windows 安全存储加密。');
      await refreshSnapshot();
    } catch (error) { toast('保存失败', error.message, 'error'); }
  });
  $('#removeRuntimeKey').addEventListener('click', async () => {
    try { unwrap(await api.removeRuntimeKey()); toast('密钥已删除'); await refreshSnapshot(); }
    catch (error) { toast('删除失败', error.message, 'error'); }
  });
  $('#regenerateToken').addEventListener('click', async () => {
    try { unwrap(await api.regenerateMcpToken()); toast('认证 Token 已重新生成', '重新部署后生效。'); }
    catch (error) { toast('生成失败', error.message, 'error'); }
  });
  $('#pythonInstall').addEventListener('click', async () => {
    setBusy(true, true);
    try { unwrap(await api.installPython()); toast('Python 安装完成', '请重新检测环境。'); await refreshSnapshot(); }
    catch (error) { toast('安装失败', error.message, 'error'); }
    finally { setBusy(false); }
  });
  $('#proxyModeSelect').addEventListener('change', () => { renderProxyControls(); renderDeploySummary(); });
  $('#proxyDetect').addEventListener('click', async () => {
    try {
      await saveSettings(false);
      const result = unwrap(await api.detectProxy());
      toast(result.reachable ? '网络路径可用' : '未检测到可用路径', result.resolvedUrl || (result.reachable ? '当前使用直连。' : '请检查网络或手动代理设置。'), result.reachable ? 'success' : 'error');
      await refreshSnapshot({ forceForms: true });
    } catch (error) { toast('代理检测失败', error.message, 'error'); }
  });
  ['#tunnelIdInput', '#proxyUrlInput', '#runtimeKeyInput'].forEach((selector) => $(selector).addEventListener('input', renderDeploySummary));

  $('#themeToggle').addEventListener('click', async () => {
    const next = document.body.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try { await saveSettings(false); } catch { /* non-critical */ }
  });
  $('#themeSelect').addEventListener('change', async () => { applyTheme($('#themeSelect').value); await saveSettings(false); });
  $('#keepRunningToggle').addEventListener('change', () => saveSettings(false));
  $('#autoStartToggle').addEventListener('change', () => saveSettings(false));

  $$('[data-guide-check]').forEach((input) => input.addEventListener('change', async () => {
    renderGuideProgress();
    try { await saveSettings(false); } catch { /* non-critical */ }
  }));
  $$('[data-copy]').forEach((button) => button.addEventListener('click', () => copyText(button.dataset.copy)));
  $('#copyLocalUrl').addEventListener('click', () => copyText($('#guideLocalUrl').textContent));
  $('#copyTunnelId').addEventListener('click', () => copyText($('#guideTunnelId').textContent));

  $('#refreshLogs').addEventListener('click', loadLogs);
  $('#refreshTaskState').addEventListener('click', loadTaskState);
  $('#refreshTaskHistory').addEventListener('click', loadTaskHistory);
  $('#pauseTask').addEventListener('click', async () => { try { unwrap(await api.pauseTask()); await loadTaskState(); toast('任务已暂停', '当前进度已保存在工作区。'); } catch (error) { toast('暂停失败', error.message, 'error'); } });
  $('#resumeTask').addEventListener('click', async () => { try { unwrap(await api.resumeTask()); await loadTaskState(); toast('任务已继续', '网页模型可从记录的下一步恢复。'); } catch (error) { toast('继续失败', error.message, 'error'); } });
  $('#stopTask').addEventListener('click', async () => { if (!confirm('确定停止当前任务吗？运行中的命令会被终止。')) return; try { unwrap(await api.stopTask()); await loadTaskState(); toast('任务已停止', '状态与历史仍保留，可稍后继续。'); } catch (error) { toast('停止失败', error.message, 'error'); } });
  $('#clearTaskState').addEventListener('click', async () => { if (!confirm('确定清除当前工作区的任务状态吗？')) return; unwrap(await api.clearTaskState()); renderTaskState(null); toast('任务状态已清除'); });
  $('#refreshPerformance').addEventListener('click', loadPerformanceTrace);
  $('#clearPerformance').addEventListener('click', async () => { if (!confirm('确定清空当前工作区的性能记录吗？')) return; try { unwrap(await api.clearPerformanceTrace()); renderPerformanceTrace(null); toast('性能记录已清空'); } catch (error) { toast('清空失败', error.message, 'error'); } });
  $('#inspectBuild').addEventListener('click', inspectBuild);
  $('#runBuild').addEventListener('click', runBuildVerification);
  $('#inspectHealth').addEventListener('click', inspectHealth);
  $('#repairHealth').addEventListener('click', repairHealth);
  $('#checkUpdateButton').addEventListener('click', () => runUpdateAction('check'));
  $('#downloadUpdateButton').addEventListener('click', () => runUpdateAction('download'));
  $('#installUpdateButton').addEventListener('click', () => runUpdateAction('install'));
  $('#toolModeSelect')?.addEventListener('change', async () => {
    try {
      const wasRunning = Boolean(state.snapshot?.status.runtimeRunning);
      await saveSettings(false);
      toast('工具模式已保存', wasRunning ? '正在静默重建 MCP 以应用新的工具范围。' : '下次启动 MCP 时生效。');
      if (wasRunning) await runRuntime('restart');
    } catch (error) { toast('工具模式切换失败', error.message, 'error'); }
  });
  $('#clearLogs').addEventListener('click', async () => { unwrap(await api.clearLogs()); state.logs = []; renderLogs(); toast('日志已清空'); });
  $$('.log-filter').forEach((button) => button.addEventListener('click', () => {
    state.logFilter = button.dataset.logFilter;
    $$('.log-filter').forEach((item) => item.classList.toggle('active', item === button));
    renderLogs();
  }));
}

async function initialize() {
  try {
    bindEvents();
    api.onProgress(updateProgress);
    api.onLog((entry) => {
      state.logs.push(entry);
      if (state.logs.length > 1000) state.logs.shift();
      if (state.currentPage === 'logs') renderLogs();
    });
    api.onStatus((payload) => {
      if (payload?.snapshot) renderSnapshot(payload.snapshot, { forceForms: false });
    });
    api.onHeartbeat(applyHeartbeat);
    api.onBuildProgress((payload) => {
      if (payload.status === 'output') appendBuildOutput(payload.text || '');
      else if (payload.status === 'running') { $('#buildStatus').textContent = payload.stage === 'test' ? '正在测试' : '正在构建'; appendBuildOutput(`\n> ${payload.command}\n`); }
      else if (payload.stage === 'complete') $('#buildStatus').textContent = payload.status === 'passed' ? '已通过' : '未通过';
    });
    api.onUpdateState(renderUpdateStatus);
    const requestedPage = location.hash.slice(1);
    if (pageMeta[requestedPage]) navigate(requestedPage);

    // Show the settings shell immediately. Runtime/network inspection continues
    // in the background so opening Preferences never feels like a diagnostic run.
    document.body.classList.remove('booting');
    document.body.classList.add('booted');
    $('#bootScreen')?.setAttribute('aria-hidden', 'true');

    const firstSnapshot = await refreshSnapshot({ forceForms: true });
    await loadUpdateStatus();
    if (firstSnapshot && !firstSnapshot.settings.firstRunCompleted) {
      try {
        navigate('health');
        await inspectHealth();
        unwrap(await api.saveSettings({ firstRunCompleted: true }));
        toast('首次运行体检', '已检查当前环境；可点击“一键修复”处理能够自动解决的问题。');
      } catch (error) { toast('首次运行体检未完成', error.message, 'error'); }
    }
  } finally {
    document.body.classList.remove('booting');
    document.body.classList.add('booted');
    $('#bootScreen')?.setAttribute('aria-hidden', 'true');
  }
}

initialize();






