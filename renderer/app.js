const api = window.mcpAssistant || createPreviewApi();

function createPreviewApi() {
  const previewSettings = {
    workspace: 'C:\\Users\\示例用户\\Desktop\\my-project', permissionMode: 'safe', toolMode: 'smart',
    mcpPort: 18765, healthPort: 18081, proxyMode: 'auto', proxyUrl: '', tunnelId: 'tunnel_demo',
    theme: 'light', startWithWindows: false, progressReportSeconds: 90, keepRunningOnClose: true, autoStartServices: false, globalAgentsEnabled: false, firstRunCompleted: true, guideProgress: {}, authorizedRoots: [], allowAllDirectories: false
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
  const setPreviewRuntime = (running) => {
    snapshot.status.runtimeRunning = running;
    snapshot.status.tunnelRunning = running;
    snapshot.status.fullyReady = running;
    snapshot.environment.ports.mcpListening = running;
    snapshot.environment.ports.tunnelListening = running;
    return ok(snapshot);
  };
  return {
    snapshot: () => ok(snapshot), chooseWorkspace: () => ok(snapshot.settings.workspace), switchWorkspace: (workspace) => { snapshot.settings.workspace=workspace; return ok(snapshot); }, updateAuthorizedRoots: (roots) => { snapshot.settings.authorizedRoots=roots; return ok(snapshot); }, setAllowAllDirectories: (enabled) => { snapshot.settings.allowAllDirectories = Boolean(enabled); return ok(snapshot); }, closeManager: () => ok(true),
    saveSettings: (patch) => { Object.assign(snapshot.settings, patch); return ok(snapshot.settings); },
    saveRuntimeKey: () => ok(snapshot.secrets), removeRuntimeKey: () => ok(snapshot.secrets), regenerateMcpToken: () => ok(snapshot.secrets),
    start: () => setPreviewRuntime(true), stop: () => setPreviewRuntime(false), restart: () => setPreviewRuntime(true),
    logs: () => ok([{ time: new Date().toISOString(), level: 'info', message: '静态界面预览模式' }]), clearLogs: () => ok(true),
    taskState: () => ok({ exists: false, state: null }), clearTaskState: () => ok(true), pauseTask: () => ok({}), resumeTask: () => ok({}), stopTask: () => ok({}), taskHistory: () => ok([]), performanceTrace: () => ok(null), clearPerformanceTrace: () => ok(true),
    inspectBuild: () => ok({ type: 'electron', name: 'demo', version: '0.1.0', testCommand: 'npm test', buildCommand: 'npm run dist', artifacts: ['dist'] }), runBuild: () => ok({ overallStatus: 'passed', project: { type: 'electron', name: 'demo', version: '0.1.0' }, testResult: { status: 'passed' }, buildResult: { status: 'passed' }, artifacts: [] }), inspectHealth: () => ok({ healthy: true, checks: [] }), repairHealth: () => ok({ healthy: true, checks: [], actions: [], unresolved: [] }),
    updateStatus: () => ok(updatePreview), checkForUpdate: () => ok(updatePreview), downloadUpdate: () => ok(updatePreview), installUpdate: () => ok(updatePreview),
    openExternal: () => ok(true), installPython: () => ok(true), detectProxy: () => ok(snapshot.environment.proxy), onProgress: () => () => {}, onLog: () => () => {}, onStatus: () => () => {}, onHeartbeat: () => () => {}, onBuildProgress: () => () => {}, onUpdateState: () => () => {}
  };
}

const pageMeta = {
  overview: ['CONTROL CENTER', '运行总览', '集中查看本地 MCP、OpenAI Tunnel 与部署环境。'],
  deploy: ['RUNTIME & CONNECTION', '连接与服务', '管理 MCP、Tunnel 与网络连接'],
  workspace: ['WORKSPACE ACCESS', '工作区', '管理当前项目目录与权限范围'],
  task: ['ACTIVITY', '活动', '查看任务进度与构建状态'],
  build: ['ACTIVITY', '活动', '查看任务进度与构建状态'],
  health: ['DIAGNOSTICS', '诊断', '检测系统状态并快速修复问题'],
  guide: ['SETUP GUIDE', '接入指南', '按步骤完成 OpenAI Tunnel 与 ChatGPT 网页连接。'],
  logs: ['DIAGNOSTICS', '运行日志', '查看便携运行时、MCP 和 Tunnel 的诊断信息。'],
  settings: ['SETTINGS', '设置', '个性化、启动、更新与安全配置']
};

const state = {
  snapshot: null,
  currentPage: 'overview',
  selectedWorkspace: '',
  logFilter: 'all',
  logs: [],
  diagnosticLogFilter: 'all',
  healthReport: null,
  busy: false,
  initializedForms: false,
  update: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const modalState = {
  content: null,
  placeholder: null,
  trigger: null,
  wasHidden: true
};

function modalFocusableElements() {
  const dialog = $('#appModalDialog');
  if (!dialog) return [];
  return $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', dialog)
    .filter((element) => !element.closest('[hidden]') && element.getAttribute('aria-hidden') !== 'true');
}

function closeModal({ restoreFocus = true } = {}) {
  const modal = $('#appModal');
  if (!modalState.content || !modal) return;
  const { content, placeholder, trigger, wasHidden } = modalState;
  if (placeholder?.parentNode) placeholder.parentNode.insertBefore(content, placeholder);
  placeholder?.remove();
  content.hidden = wasHidden;
  $('#appModalBody')?.replaceChildren();
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  modalState.content = null;
  modalState.placeholder = null;
  modalState.trigger = null;
  modalState.wasHidden = true;
  if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
}

function openModal({ title, content, trigger, size = 'default', onOpen } = {}) {
  const modal = $('#appModal');
  const body = $('#appModalBody');
  const dialog = $('#appModalDialog');
  if (!modal || !body || !dialog || !content?.parentNode) return;
  if (modalState.content) closeModal({ restoreFocus: false });
  const placeholder = document.createComment(`modal:${content.id || 'content'}`);
  content.parentNode.insertBefore(placeholder, content);
  modalState.content = content;
  modalState.placeholder = placeholder;
  modalState.trigger = trigger || document.activeElement;
  modalState.wasHidden = content.hidden;
  content.hidden = false;
  body.appendChild(content);
  $('#appModalTitle').textContent = title || '详情';
  dialog.dataset.size = size;
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  if (typeof onOpen === 'function') onOpen();
  requestAnimationFrame(() => {
    const [first] = modalFocusableElements();
    (first || dialog).focus({ preventScroll: true });
  });
}

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
  ['#topStartButton', '#heroStartButton', '#deployNow', '#overviewRestart', '#overviewStop', '#connectionRestartService', '#connectionReconnectTunnel'].forEach((selector) => {
    const element = $(selector);
    if (element) element.disabled = value;
  });
  syncRuntimeActionAvailability();
}

function syncRuntimeActionAvailability() {
  const stopButton = $('#overviewStop');
  if (!stopButton) return;
  const status = state.snapshot?.status;
  const runtimeActive = Boolean(status?.runtimeRunning || status?.tunnelRunning);
  stopButton.disabled = state.busy || !runtimeActive;
  stopButton.title = runtimeActive ? '停止 MCP 与 Tunnel 服务' : '服务当前未运行';
}

function setDot(element, status) {
  if (!element) return;
  element.classList.remove('ready', 'warn', 'error');
  if (status) element.classList.add(status);
}

function setActivityTab(tab) {
  const target = tab === 'build' ? 'build' : 'task';
  $$('.activity-tab').forEach((button) => {
    const active = button.dataset.activityTab === target;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $$('[data-activity-panel]').forEach((panel) => {
    const active = panel.dataset.activityPanel === target;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
}

function navigate(page) {
  if (!pageMeta[page]) return;
  if (modalState.content) closeModal({ restoreFocus: false });
  const viewPage = page === 'build' ? 'task' : page;
  state.currentPage = page;
  if (location.hash !== `#${page}`) history.replaceState(null, '', `#${page}`);
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.page === viewPage));
  $$('.page').forEach((item) => item.classList.toggle('active', item.dataset.pageView === viewPage));
  const [eyebrow, title, subtitle] = pageMeta[page];
  $('#pageEyebrow').textContent = eyebrow;
  $('#pageTitle').textContent = title;
  $('#pageSubtitle').textContent = subtitle;
  $('.content-viewport').scrollTop = 0;
  $('#topbarMenu')?.setAttribute('hidden', '');
  $('#searchResults')?.setAttribute('hidden', '');
  if (page === 'logs') loadLogs();
  if (viewPage === 'task') {
    setActivityTab(page === 'build' ? 'build' : 'task');
    if (page === 'build') inspectBuild();
    else loadTaskState();
  }
  if (page === 'health') inspectHealth();
  if (page === 'overview') loadOverviewActivity();
}

function textOr(value, fallback = '—') { return String(value ?? '').trim() || fallback; }

function workspaceName(value) {
  const parts = String(value || '').split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) || '未选择';
}

function formatActivityTime(value) {
  if (!value) return '刚刚';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function activityKind(text) {
  const value = String(text || '').toLowerCase();
  if (/codex|校对|build|构建|代码/.test(value)) return ['code', '‹›'];
  if (/workspace|工作区|目录/.test(value)) return ['workspace', '▱'];
  if (/tunnel|连接|重连/.test(value)) return ['tunnel', '↗'];
  if (/诊断|检测|health|环境/.test(value)) return ['health', '✓'];
  return ['info', '•'];
}

function renderOverviewActivities(items) {
  const container = $('#overviewRecentActivity');
  if (!container) return;
  container.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'overview-activity-empty';
    empty.textContent = '暂无最近活动';
    container.appendChild(empty);
    return;
  }
  items.slice(0, 4).forEach((item) => {
    const [kind, glyph] = activityKind(item.title);
    const row = document.createElement('div');
    row.className = 'recent-activity-item';
    const icon = document.createElement('i');
    icon.className = `recent-activity-icon ${kind}`;
    icon.textContent = glyph;
    const title = document.createElement('span');
    title.textContent = item.title;
    const time = document.createElement('time');
    time.textContent = formatActivityTime(item.time);
    row.append(icon, title, time);
    container.appendChild(row);
  });
}

async function loadOverviewActivity() {
  if (!$('#overviewRecentActivity')) return;
  const [logsResult, historyResult] = await Promise.allSettled([api.logs(), api.taskHistory()]);
  const items = [];
  if (logsResult.status === 'fulfilled' && logsResult.value?.ok) {
    const logs = logsResult.value.data || [];
    state.logs = logs;
    logs.slice(-8).reverse().forEach((entry) => items.push({
      title: textOr(entry.message, '运行状态更新'),
      time: entry.time,
      timestamp: new Date(entry.time || 0).getTime() || 0
    }));
  }
  if (historyResult.status === 'fulfilled' && historyResult.value?.ok) {
    (historyResult.value.data || []).slice(0, 5).forEach((task) => {
      const time = task.archived_at || task.updated_at;
      items.push({
        title: `${textOr(task.objective, 'Codex 任务')} · ${textOr(task.status, '完成')}`,
        time,
        timestamp: new Date(time || 0).getTime() || 0
      });
    });
  }
  items.sort((a, b) => b.timestamp - a.timestamp);
  if (!items.length && state.snapshot) {
    const { status } = state.snapshot;
    items.push({ title: status.fullyReady ? 'MCP 与 Tunnel 已连接' : '服务状态已刷新', time: null, timestamp: 0 });
  }
  renderOverviewActivities(items);
}

const searchEntries = [
  ['overview', '总览 首页 状态 dashboard 服务运行'],
  ['deploy', '连接与服务 运行 连接 MCP Tunnel 代理 Runtime Key 部署'],
  ['workspace', '工作区 目录 权限 授权 AGENTS'],
  ['task', '活动 任务 状态 历史 性能 Codex'],
  ['health', '诊断 修复 体检 环境 网络'],
  ['build', '构建 验证 测试 build'],
  ['guide', '帮助 接入 指南 ChatGPT MCP'],
  ['logs', '日志 运行日志 diagnostics'],
  ['settings', '设置 偏好 主题 更新']
];

function searchPages(query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) return [];
  return searchEntries.filter(([, keywords]) => keywords.toLowerCase().includes(normalized)).map(([page]) => page);
}

function renderSearchResults(query) {
  const container = $('#searchResults');
  if (!container) return;
  const pages = searchPages(query);
  container.replaceChildren();
  if (!String(query || '').trim()) { container.hidden = true; return; }
  if (!pages.length) {
    const empty = document.createElement('span');
    empty.className = 'search-empty';
    empty.textContent = '没有匹配的页面';
    container.appendChild(empty);
  } else {
    pages.slice(0, 6).forEach((page) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.searchPage = page;
      button.innerHTML = `<b>${pageMeta[page][1]}</b><small>${pageMeta[page][2]}</small>`;
      button.addEventListener('click', () => { navigate(page); $('#globalSearch').value = ''; container.hidden = true; });
      container.appendChild(button);
    });
  }
  container.hidden = false;
}

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
  const rawStatus = textOr(task.status, 'idle').toLowerCase();
  const statusLabels = { active: '运行中', running: '运行中', in_progress: '运行中', waiting: '等待中', paused: '已暂停', completed: '已完成', passed: '已完成', failed: '失败', stopped: '已停止', idle: '等待' };
  const statusElement = $('#taskStatus');
  statusElement.textContent = statusLabels[rawStatus] || textOr(task.status, '等待');
  statusElement.className = `activity-status-pill ${rawStatus.replace(/[^a-z0-9_-]/g, '-')}`;
  $('#taskCurrentStep').textContent = textOr(task.current_step);
  $('#taskNextStep').textContent = textOr(task.next_step);
  $('#taskFailureRow').hidden = !task.failure;
  $('#taskFailure').textContent = textOr(task.failure);
  const steps = Array.isArray(task.steps) ? task.steps : [];
  const done = steps.filter((item) => item.status === 'completed').length;
  $('#taskStepCount').textContent = `${done} / ${steps.length}`;
  const progress = steps.length ? Math.round(done / steps.length * 100) : ['completed', 'passed'].includes(rawStatus) ? 100 : 0;
  $('#taskProgressBar').style.width = `${progress}%`;
  const paused = rawStatus === 'paused';
  $('#pauseTask').hidden = paused;
  $('#resumeTask').hidden = !paused;
  const finished = ['completed', 'passed', 'failed', 'stopped'].includes(rawStatus);
  $('#pauseTask').disabled = finished;
  $('#resumeTask').disabled = finished;
  $('#stopTask').disabled = finished;
  renderTaskList($('#taskSteps'), steps, (item) => { const row=document.createElement('div'); row.className=`task-step ${item.status || 'pending'}`; const mark=document.createElement('i'); mark.textContent=item.status==='completed'?'✓':item.status==='in_progress'?'→':item.status==='failed'?'!':'•'; const label=document.createElement('span'); label.textContent=textOr(item.text); row.append(mark,label); return row; });
  const command = task.current_command;
  $('#taskCommand').textContent = command ? `${textOr(command.command)}\n${textOr(command.status)} · ${textOr(command.workdir, '.')}` : '当前没有运行中的命令';
  const tests = Array.isArray(task.test_results) ? task.test_results.slice(-3).reverse() : [];
  renderTaskList($('#taskTests'), tests, (item) => { const row=document.createElement('div'); row.className=`activity-test-row ${item.status || ''}`; const mark=document.createElement('i'); mark.textContent=item.status === 'passed' ? '✓' : item.status === 'failed' ? '!' : '•'; const name=document.createElement('span'); name.textContent=textOr(item.command, '测试'); const duration=document.createElement('time'); duration.textContent=formatDuration(item.duration_ms); row.append(mark,name,duration); return row; });
  const files = Array.isArray(task.modified_files) ? task.modified_files.slice(-3).reverse() : [];
  $('#taskFileCount').textContent = String(files.length);
  renderTaskList($('#taskFiles'), files, (item) => { const row=document.createElement('div'); row.className='activity-file-row'; const icon=document.createElement('i'); icon.textContent='‹›'; const file=document.createElement('span'); file.textContent=textOr(item.path); file.title=textOr(item.path); const op=document.createElement('small'); const operation=textOr(item.operation, 'update').toLowerCase(); op.textContent=operation === 'create' ? '新增' : operation === 'delete' ? '删除' : '修改'; row.append(icon,file,op); return row; });
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

function buildSettingsPage() {
  const page = $('[data-page-view="settings"]');
  if (!page || page.dataset.settingsRedesigned === 'true') return;

  const controls = {
    theme: $('#themeSelect'),
    startWithWindows: $('#startWithWindowsToggle'),
    autoStart: $('#autoStartToggle'),
    keepRunning: $('#keepRunningToggle'),
    reportInterval: $('#progressReportSelect'),
    keyState: $('#settingsKeyState'),
    removeKey: $('#removeRuntimeKey'),
    regenerateToken: $('#regenerateToken'),
    currentVersion: $('#currentVersionText'),
    updateArchitecture: $('#updateArchitecture'),
    updateStatus: $('#updateStatusChip'),
    updateStatusTitle: $('#updateStatusTitle'),
    updateStatusText: $('#updateStatusText'),
    checkUpdate: $('#checkUpdateButton'),
    downloadUpdate: $('#downloadUpdateButton'),
    installUpdate: $('#installUpdateButton'),
    updateProgress: $('#updateProgress'),
    updateReleaseNotes: $('#updateReleaseNotes'),
    aboutVersion: $('#aboutVersion')
  };
  if (Object.values(controls).some((element) => !element)) return;

  page.replaceChildren();
  page.classList.add('settings-page-v2');
  page.dataset.settingsRedesigned = 'true';

  const heading = document.createElement('header');
  heading.className = 'settings-v2-heading';
  const title = document.createElement('h2');
  title.textContent = '设置';
  const subtitle = document.createElement('p');
  subtitle.textContent = '个性化、启动、更新与安全配置';
  heading.append(title, subtitle);

  const stack = document.createElement('div');
  stack.className = 'settings-v2-stack';
  const createGroup = (name, className = '') => {
    const group = document.createElement('section');
    group.className = `settings-v2-group ${className}`.trim();
    const groupTitle = document.createElement('h3');
    groupTitle.textContent = name;
    group.appendChild(groupTitle);
    stack.appendChild(group);
    return group;
  };
  const createRow = (label, className = '') => {
    const row = document.createElement('div');
    row.className = `settings-v2-row ${className}`.trim();
    const labelNode = document.createElement('span');
    labelNode.className = 'settings-v2-label';
    labelNode.textContent = label;
    row.appendChild(labelNode);
    return row;
  };

  const appearanceGroup = createGroup('外观');
  const themeRow = createRow('界面主题', 'settings-select-row');
  const themeControl = document.createElement('div');
  themeControl.className = 'settings-v2-select';
  themeControl.append(controls.theme);
  themeRow.appendChild(themeControl);
  appearanceGroup.appendChild(themeRow);

  const startupGroup = createGroup('启动');
  [
    ['开机自动启动', controls.startWithWindows],
    ['启动软件时启动服务', controls.autoStart],
    ['关闭窗口后保持服务运行', controls.keepRunning]
  ].forEach(([label, toggle]) => {
    const row = createRow(label, 'settings-toggle-row');
    row.appendChild(toggle);
    startupGroup.appendChild(row);
  });

  const taskGroup = createGroup('任务');
  const reportRow = createRow('主动汇报间隔', 'settings-select-row');
  const reportControl = document.createElement('div');
  reportControl.className = 'settings-v2-select';
  reportControl.append(controls.reportInterval);
  reportRow.appendChild(reportControl);
  taskGroup.appendChild(reportRow);

  const updateGroup = createGroup('更新', 'settings-update-group');
  const updateRow = createRow('当前版本', 'settings-update-row');
  const updateActions = document.createElement('div');
  updateActions.className = 'settings-v2-update-actions';
  controls.currentVersion.className = 'settings-current-version';
  controls.updateStatus.className = 'settings-update-status';
  updateActions.append(controls.currentVersion, controls.updateStatus, controls.checkUpdate);
  updateRow.appendChild(updateActions);
  updateGroup.appendChild(updateRow);
  const updateDetail = document.createElement('div');
  updateDetail.className = 'settings-update-detail';
  const updateCopy = document.createElement('div');
  updateCopy.className = 'settings-update-copy';
  updateCopy.append(controls.updateStatusTitle, controls.updateStatusText);
  const updateSecondaryActions = document.createElement('div');
  updateSecondaryActions.className = 'settings-update-secondary-actions';
  updateSecondaryActions.append(controls.downloadUpdate, controls.installUpdate);
  controls.updateArchitecture.classList.add('settings-update-architecture');
  updateDetail.append(controls.updateArchitecture, updateCopy, updateSecondaryActions);
  updateGroup.append(updateDetail, controls.updateProgress, controls.updateReleaseNotes);

  const securityGroup = createGroup('安全', 'settings-security-group');
  const createSecurityRow = (kind, label, statusNode, actionId) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-security-entry';
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'settings-v2-row settings-security-row';
    row.dataset.settingsSecurityTarget = actionId;
    row.dataset.settingsSecurityTitle = label;
    row.setAttribute('aria-haspopup', 'dialog');
    const labelNode = document.createElement('span');
    labelNode.className = 'settings-v2-label';
    labelNode.textContent = label;
    const stateNode = document.createElement('span');
    stateNode.className = 'settings-security-state';
    statusNode.className = 'settings-security-status';
    const indicator = document.createElement('i');
    indicator.id = `${kind}ConfiguredIndicator`;
    indicator.className = 'settings-security-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    indicator.textContent = '✓';
    const chevron = document.createElement('b');
    chevron.className = 'settings-security-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '›';
    stateNode.append(statusNode, indicator, chevron);
    row.append(labelNode, stateNode);
    wrapper.appendChild(row);
    securityGroup.appendChild(wrapper);
    return wrapper;
  };

  const runtimeEntry = createSecurityRow('runtimeKey', 'Runtime API Key', controls.keyState, 'runtimeKeyActions');
  const runtimeActions = document.createElement('div');
  runtimeActions.id = 'runtimeKeyActions';
  runtimeActions.className = 'settings-security-actions';
  runtimeActions.hidden = true;
  const manageRuntimeKey = document.createElement('button');
  manageRuntimeKey.id = 'settingsManageRuntimeKey';
  manageRuntimeKey.type = 'button';
  manageRuntimeKey.className = 'secondary-button';
  manageRuntimeKey.textContent = '管理密钥';
  runtimeActions.append(manageRuntimeKey, controls.removeKey);
  runtimeEntry.appendChild(runtimeActions);

  const tokenStatus = document.createElement('span');
  tokenStatus.id = 'settingsTokenState';
  const tokenEntry = createSecurityRow('mcpToken', 'MCP Token', tokenStatus, 'mcpTokenActions');
  const tokenActions = document.createElement('div');
  tokenActions.id = 'mcpTokenActions';
  tokenActions.className = 'settings-security-actions';
  tokenActions.hidden = true;
  tokenActions.appendChild(controls.regenerateToken);
  tokenEntry.appendChild(tokenActions);

  const aboutGroup = createGroup('关于', 'settings-about-group');
  const aboutRow = createRow('网页 MCP 助手', 'settings-about-row');
  controls.aboutVersion.className = 'settings-about-version';
  aboutRow.appendChild(controls.aboutVersion);
  aboutGroup.appendChild(aboutRow);

  page.append(heading, stack);
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
    input.closest('.choice')?.classList.toggle('selected', input.checked);
  });
  renderWorkspacePermission(settings.permissionMode || 'safe');
  applyTheme(settings.theme);
  restoreGuideProgress(settings.guideProgress || {});
  renderProxyControls();
  state.initializedForms = true;
}

function renderConnectionPage(snapshot) {
  if (!snapshot || !$('#connectionMcpStatus')) return;
  const { settings = {}, secrets = {}, environment = {}, status = {} } = snapshot;
  const proxy = environment.proxy || {};
  const proxyModeLabels = { auto: '自动检测', system: 'Windows 代理', manual: '手动代理', direct: '直接连接' };
  const runtimeRunning = Boolean(status.runtimeRunning);
  const tunnelRunning = Boolean(status.tunnelRunning);
  const keyConfigured = Boolean(secrets.runtimeApiKey);
  const latencyValue = proxy.latencyMs ?? proxy.latency ?? proxy.responseTimeMs;
  const latency = Number(latencyValue);

  $('#connectionMcpStatus').textContent = runtimeRunning ? '运行中' : '未启动';
  $('#connectionMcpStatus').classList.toggle('is-error', !runtimeRunning);
  $('#connectionMcpUrl').textContent = textOr(status.localMcpUrl, '未获取到 MCP 地址');
  $('#connectionTunnelId').textContent = textOr(settings.tunnelId, '未配置');
  $('#connectionRuntimeKey').textContent = keyConfigured ? '已配置' : '未配置';
  $('#connectionRuntimeKey').classList.toggle('success', keyConfigured);
  $('#connectionRuntimeKey').classList.toggle('danger', !keyConfigured);
  $('#connectionLastSync').textContent = tunnelRunning ? '刚刚' : '未同步';
  $('#connectionProxyMode').textContent = proxyModeLabels[settings.proxyMode] || proxyModeLabels[proxy.mode] || '自动检测';
  $('#connectionProxyUrl').textContent = textOr(proxy.url || (settings.proxyMode === 'manual' ? settings.proxyUrl : ''), '未配置');
  $('#connectionProxyLatency').textContent = Number.isFinite(latency) && latency >= 0 ? Math.round(latency) + ' ms' : '--';
  $('#connectionMcpPort').textContent = textOr(settings.mcpPort, '--');
  $('#connectionHealthPort').textContent = textOr(settings.healthPort, '--');
  $('#connectionManualProxy').textContent = textOr(settings.proxyUrl, '未配置');
}

function renderWorkspacePermission(mode = 'safe') {
  const safe = mode !== 'trusted';
  const toggle = $('#workspaceSafeToggle');
  if (toggle) toggle.checked = safe;
  const description = $('#workspacePermissionDescription');
  if (description) description.textContent = safe
    ? '限制潜在风险操作，提升执行安全性'
    : '完全放开限制：允许网络访问、执行脚本并放行 Base URL 与 API Key 等配置落盘';
  const recommended = $('#workspacePermissionRecommended');
  if (recommended) recommended.hidden = !safe;
  const whitelist = $('#workspaceWhitelistToggle');
  if (whitelist) whitelist.checked = safe;
  const whitelistNote = $('#workspaceWhitelistNote');
  if (whitelistNote) whitelistNote.textContent = safe
    ? '当前版本由安全模式统一控制'
    : '可信模式下不进行拦截审计';
}

function setWorkspacePermissionMode(mode) {
  $$('input[name="permission"]').forEach((input) => {
    input.checked = input.value === mode;
    input.closest('.choice')?.classList.toggle('selected', input.checked);
  });
  renderWorkspacePermission(mode);
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

  $('#mcpStatus').textContent = status.runtimeRunning ? '运行中' : '未启动';
  $('#mcpMeta').textContent = status.localMcpUrl;
  setDot($('#mcpDot'), status.runtimeRunning ? 'ready' : 'error');
  $('#tunnelStatus').textContent = status.tunnelRunning ? '已连接' : '未连接';
  $('#tunnelMeta').textContent = settings.tunnelId || '尚未填写 Tunnel ID';
  setDot($('#tunnelDot'), status.tunnelRunning ? 'ready' : settings.tunnelId ? 'warn' : 'error');
  $('#workspaceStatus').textContent = environment.workspace.exists ? workspaceName(settings.workspace) : '未选择';
  $('#workspaceMeta').textContent = settings.workspace || '仅所选目录可被 MCP 访问';
  setDot($('#workspaceDot'), environment.workspace.exists ? 'ready' : 'error');
  $('#selectedWorkspace').textContent = settings.workspace || '尚未选择目录';
  $('#selectedWorkspace').title = settings.workspace || '';
  renderWorkspacePermission(settings.permissionMode || 'safe');
  renderAuthorizedRoots(settings.authorizedRoots || [], Boolean(settings.allowAllDirectories));
  renderGlobalAgents(settings, environment.globalAgents);

  const partial = status.runtimeRunning || status.tunnelRunning;
  $('#heroBadge').textContent = ready ? '全部服务运行正常' : partial ? '部分服务需要关注' : '服务尚未启动';
  $('#heroTitle').textContent = ready ? '服务运行正常' : partial ? '部分服务需要关注' : '服务尚未启动';
  $('#heroText').textContent = ready ? 'MCP 与 Tunnel 已连接' : status.runtimeRunning ? 'MCP 已运行，正在等待 Tunnel 连接' : 'MCP 与 Tunnel 当前未连接';
  const heroState = $('#overviewHeroStatus');
  heroState.classList.remove('ready', 'warn', 'error');
  heroState.classList.add(ready ? 'ready' : partial ? 'warn' : 'error');
  heroState.textContent = ready ? '✓' : partial ? '!' : '×';
  $('#heroStartButton').textContent = ready ? '重新部署' : '开始部署';
  $('#topStartButton').textContent = ready ? '重新部署' : '一键启动';
  syncRuntimeActionAvailability();

  const networkOk = Boolean(environment.proxy?.reachable);
  const keyOk = Boolean(secrets.runtimeApiKey);
  $('#attentionNetworkStatus').textContent = networkOk ? '网络正常' : '网络需要检查';
  $('#attentionNetworkMeta').textContent = networkOk ? '网络连接与 OpenAI 路径检查通过' : '当前网络路径未通过连通性检查';
  setDot($('#attentionNetworkDot'), networkOk ? 'ready' : 'error');
  $('#attentionKeyStatus').textContent = keyOk ? 'Runtime Key 已配置' : 'Runtime Key 未配置';
  $('#attentionKeyMeta').textContent = keyOk ? '运行所需的密钥已正确配置' : '请在连接与服务中安全保存 Runtime API Key';
  setDot($('#attentionKeyDot'), keyOk ? 'ready' : 'error');

  $('#runtimeKeyHint').textContent = secrets.runtimeApiKey ? '已使用 Windows 安全存储保存' : '尚未保存';
  $('#runtimeKeyHint').style.color = secrets.runtimeApiKey ? 'var(--green)' : '';
  $('#settingsKeyState').textContent = secrets.runtimeApiKey ? '已加密保存' : '尚未保存';
  const settingsTokenState = $('#settingsTokenState');
  if (settingsTokenState) settingsTokenState.textContent = secrets.mcpAuthToken ? '已配置' : '未配置';
  $('#runtimeKeyConfiguredIndicator')?.classList.toggle('configured', Boolean(secrets.runtimeApiKey));
  $('#mcpTokenConfiguredIndicator')?.classList.toggle('configured', Boolean(secrets.mcpAuthToken));
  $('#guideLocalUrl').textContent = status.localMcpUrl;
  $('#guideTunnelId').textContent = settings.tunnelId || '尚未填写';
  renderConnectionPage(snapshot);
  renderEnvironment(environment);
  renderDeploySummary();
}

function renderAuthorizedRoots(roots, allowAllDirectories = false) {
  const addRootBtn = $('#addAuthorizedRoot');
  if (addRootBtn) {
    addRootBtn.disabled = Boolean(allowAllDirectories);
    addRootBtn.title = allowAllDirectories ? '全局访问已开启，无需添加单个授权目录' : '添加额外授权目录';
  }

  const toggleBtn = $('#toggleAllowAllDirectories');
  const toggleText = $('#allowAllDirectoriesText');
  if (toggleBtn) {
    toggleBtn.classList.toggle('active', Boolean(allowAllDirectories));
    toggleBtn.setAttribute('aria-pressed', String(Boolean(allowAllDirectories)));
    toggleBtn.title = allowAllDirectories ? '已允许访问本地任意目录与磁盘路径（点击恢复限制）' : '允许访问本地任意目录与磁盘路径';
  }
  if (toggleText) {
    toggleText.textContent = allowAllDirectories ? '已允许访问任意目录' : '允许访问任意目录';
  }

  const container = $('#authorizedRootsList');
  if (!container) return;
  container.replaceChildren();

  if (allowAllDirectories) {
    const banner = document.createElement('div');
    banner.className = 'workspace-allow-all-notice';
    const badge = document.createElement('span');
    badge.className = 'allow-all-badge';
    badge.textContent = '全局访问已开启';
    const hint = document.createElement('span');
    hint.className = 'allow-all-hint';
    hint.textContent = 'AI 可以读取与修改本地任意目录和磁盘路径';
    banner.append(badge, hint);
    container.appendChild(banner);
  }

  if (!roots.length) {
    const empty = document.createElement('span');
    empty.className = 'task-muted';
    empty.textContent = allowAllDirectories ? '未添加特定额外授权目录（当前已开放全局访问）' : '尚未添加额外授权目录';
    container.appendChild(empty);
    return;
  }
  roots.forEach((root) => {
    const row = document.createElement('div');
    row.className = 'authorized-root-row workspace-root-row';
    const icon = document.createElement('span');
    icon.className = 'workspace-folder-icon small';
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElement('span');
    path.className = 'workspace-root-path';
    path.textContent = root;
    path.title = root;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'workspace-root-remove';
    remove.textContent = '⌫';
    remove.title = `移除授权目录：${root}`;
    remove.setAttribute('aria-label', `移除授权目录：${root}`);
    remove.addEventListener('click', () => removeAuthorizedRoot(root));
    row.append(icon, path, remove);
    container.appendChild(row);
  });
}

function confirmEnableAllDirectories(trigger) {
  return new Promise((resolve) => {
    const modalBody = $('#allowAllModalBody');
    if (!modalBody) {
      resolve(false);
      return;
    }
    const cancelBtn = $('#cancelAllowAllBtn');
    const confirmBtn = $('#confirmAllowAllBtn');

    let resolved = false;
    let checkInterval = null;

    const cleanup = (value) => {
      if (resolved) return;
      resolved = true;
      if (checkInterval) clearInterval(checkInterval);
      cancelBtn?.removeEventListener('click', onCancel);
      confirmBtn?.removeEventListener('click', onConfirm);
      closeModal();
      resolve(value);
    };

    const onCancel = () => cleanup(false);
    const onConfirm = () => cleanup(true);

    cancelBtn?.addEventListener('click', onCancel);
    confirmBtn?.addEventListener('click', onConfirm);

    openModal({
      title: '权限确认',
      content: modalBody,
      trigger,
      size: 'default'
    });

    checkInterval = setInterval(() => {
      if (!modalState.content) {
        clearInterval(checkInterval);
        cleanup(false);
      }
    }, 120);
  });
}

async function toggleAllowAllDirectories() {
  const current = Boolean(state.snapshot?.settings?.allowAllDirectories);
  if (!current) {
    const confirmed = await confirmEnableAllDirectories($('#toggleAllowAllDirectories'));
    if (!confirmed) return;
  }
  try {
    const nextState = !current;
    const snapshot = unwrap(await api.setAllowAllDirectories(nextState));
    renderSnapshot(snapshot, { forceForms: true });
    toast(nextState ? '已开启全局目录访问' : '已恢复目录访问限制', nextState ? 'AI 可访问本地任意目录与磁盘路径。' : '已重新限制为仅访问工作区与授权目录。');
  } catch (error) {
    toast('设置失败', error.message, 'error');
  }
}

function renderGlobalAgents(settings, info = {}) {
  const enabled = Boolean(settings.globalAgentsEnabled);
  const path = textOr(info.path, '未能解析全局 AGENTS.md 路径');
  $('#globalAgentsPath').textContent = path;
  $('#globalAgentsPath').title = path;
  $('#globalAgentsStatus').textContent = enabled
    ? info.enabled === false
      ? '已开启 · 等待重新部署后检查规则文件'
      : info.exists ? `已启用 · ${info.source || 'AGENTS.md'}` : '已启用 · 当前规则文件不存在或为空'
    : '当前未启用';
}

async function addAuthorizedRoot() {
  if (state.snapshot?.settings?.allowAllDirectories) {
    toast('已开启全局访问', '当前已允许访问任意目录，无需单独添加授权目录。', 'warn');
    return;
  }
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
    if (state.currentPage === 'overview') loadOverviewActivity();
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

async function runRuntime(action, returnPage = 'overview') {
  setBusy(true, false);
  navigate(returnPage);
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

function findHealthCheck(report, id) {
  return (report?.checks || []).find((item) => item.id === id) || null;
}

function diagnosticStateFor(check, fallbackOk = false, softFailure = false) {
  const ok = check ? Boolean(check.ok) : Boolean(fallbackOk);
  return ok ? 'ok' : softFailure ? 'warn' : 'error';
}

function setDiagnosticStatus(selector, stateName, detail) {
  const item = $(selector);
  if (!item) return;
  item.classList.remove('ok', 'warn', 'error');
  item.classList.add(stateName);
  const mark = $('i', item);
  const status = $('small', item);
  if (mark) mark.textContent = stateName === 'ok' ? '✓' : stateName === 'warn' ? '!' : '×';
  if (status) status.textContent = detail || (stateName === 'ok' ? '正常' : stateName === 'warn' ? '警告' : '异常');
}

function collectDiagnosticIssues(report) {
  const issues = (report?.checks || []).filter((check) => !check.ok).map((check) => ({ ...check, source: 'health' }));
  const proxy = report?.environment?.proxy;
  if (proxy && proxy.reachable === false) {
    issues.push({
      id: 'proxy',
      label: '代理连接异常',
      detail: proxy.url ? `连接 ${proxy.url} 失败` : '当前代理或 OpenAI 网络路径不可达',
      repair: 'proxy',
      source: 'environment'
    });
  }
  return issues;
}

function renderDiagnosticSummary(report) {
  const workspace = findHealthCheck(report, 'workspace');
  const runtime = findHealthCheck(report, 'runtime');
  const mcp = findHealthCheck(report, 'mcp');
  const tunnel = findHealthCheck(report, 'tunnel');
  const proxy = report?.environment?.proxy;

  setDiagnosticStatus('#diagnosticWorkspace', diagnosticStateFor(workspace, report?.environment?.workspace?.exists), workspace?.ok ? '正常' : '异常');
  setDiagnosticStatus('#diagnosticRuntime', diagnosticStateFor(runtime, report?.environment?.python?.installed), runtime?.ok ? '正常' : '异常');
  setDiagnosticStatus('#diagnosticMcp', diagnosticStateFor(mcp, report?.ownership?.runtimeOwned, true), mcp?.ok ? '正常' : '警告');
  setDiagnosticStatus('#diagnosticTunnel', diagnosticStateFor(tunnel, report?.ownership?.tunnelOwned, true), tunnel?.ok ? '正常' : '警告');
  const proxyOk = proxy?.reachable !== false;
  setDiagnosticStatus('#diagnosticProxy', proxyOk ? 'ok' : 'warn', proxyOk ? '正常' : '警告');

  const issues = collectDiagnosticIssues(report);
  const issueCard = $('#diagnosticIssueCard');
  const repairButton = $('#repairHealth');
  issueCard?.classList.remove('pending', 'healthy', 'warning', 'error');
  if (!issues.length) {
    issueCard?.classList.add('healthy');
    $('#diagnosticIssueIcon').textContent = '✓';
    $('#diagnosticIssueCount').textContent = '系统状态正常';
    $('#diagnosticIssueTitle').textContent = '未发现需要处理的问题';
    $('#diagnosticIssueDetail').textContent = report?.inspectedAt ? `最近检测：${new Date(report.inspectedAt).toLocaleString('zh-CN', { hour12: false })}` : '工作区、运行时与服务检查均已通过。';
    if (repairButton) repairButton.hidden = true;
    return;
  }

  const primary = issues[0];
  const critical = issues.some((item) => ['workspace', 'runtime', 'tunnel-client'].includes(item.id));
  issueCard?.classList.add(critical ? 'error' : 'warning');
  $('#diagnosticIssueIcon').textContent = '!';
  $('#diagnosticIssueCount').textContent = `发现 ${issues.length} 个问题`;
  $('#diagnosticIssueTitle').textContent = textOr(primary.label, '检测到异常');
  $('#diagnosticIssueDetail').textContent = textOr(primary.detail, '请查看诊断详情。');
  if (repairButton) repairButton.hidden = false;
}

function renderHealth(report) {
  state.healthReport = report;
  const issues = collectDiagnosticIssues(report);
  const summary = $('#healthSummary');
  if (summary) summary.textContent = issues.length ? `${issues.length} 项待处理` : '全部正常';
  renderDiagnosticSummary(report);

  const container = $('#healthList');
  if (container) {
    container.replaceChildren();
    const checks = report.checks || [];
    if (!checks.length) {
      const empty = document.createElement('span');
      empty.className = 'task-muted';
      empty.textContent = '没有返回额外检查项。';
      container.append(empty);
    }
    checks.forEach((check) => {
      const row = document.createElement('div'); row.className = `health-item ${check.ok ? 'passed' : 'failed'}`;
      const mark = document.createElement('i'); mark.textContent = check.ok ? '✓' : '!';
      const copy = document.createElement('div'); const title = document.createElement('b'); title.textContent = check.label; const detail = document.createElement('small'); detail.textContent = check.detail; copy.append(title, detail);
      const status = document.createElement('span'); status.textContent = check.ok ? '正常' : '待处理'; row.append(mark, copy, status); container.append(row);
    });
  }

  const actionBox = $('#diagnosticRepairActions');
  if (actionBox) {
    actionBox.replaceChildren();
    const actions = report.actions || [];
    actionBox.hidden = !actions.length;
    actions.forEach((action) => {
      const row = document.createElement('div'); row.className = 'diagnostic-repair-action';
      const mark = document.createElement('i'); mark.textContent = '✓';
      const copy = document.createElement('span'); copy.textContent = action;
      row.append(mark, copy); actionBox.append(row);
    });
  }
}

function renderDiagnosticLogs() {
  const output = $('#diagnosticLogOutput');
  if (!output) return;
  const filter = state.diagnosticLogFilter || 'all';
  const list = (state.logs || []).filter((item) => filter === 'all' || String(item.level || '').toLowerCase() === filter).slice(-80).reverse();
  output.replaceChildren();
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'diagnostic-log-empty';
    empty.textContent = filter === 'all' ? '暂无日志' : '暂无匹配日志';
    output.append(empty);
    return;
  }
  list.forEach((item) => {
    const levelName = String(item.level || 'info').toLowerCase();
    const row = document.createElement('div');
    row.className = `diagnostic-log-row ${levelName}`;
    const time = document.createElement('time');
    const date = new Date(item.time);
    time.textContent = Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('zh-CN', { hour12: false });
    const dot = document.createElement('i');
    const level = document.createElement('em');
    level.textContent = levelName === 'warn' ? 'WARN' : levelName === 'error' ? 'ERROR' : 'INFO';
    const message = document.createElement('span');
    message.textContent = textOr(item.message, '运行状态更新');
    row.append(time, dot, level, message);
    output.append(row);
  });
}

async function loadDiagnosticLogs() {
  try {
    state.logs = unwrap(await api.logs());
    renderDiagnosticLogs();
  } catch (error) {
    const output = $('#diagnosticLogOutput');
    if (output) output.innerHTML = `<div class="diagnostic-log-empty">日志读取失败：${String(error.message || error)}</div>`;
  }
}

async function inspectHealth() {
  const button = $('#inspectHealth');
  if (button) button.disabled = true;
  try {
    const [healthResult, logsResult] = await Promise.allSettled([api.inspectHealth(), api.logs()]);
    if (healthResult.status !== 'fulfilled') throw healthResult.reason;
    renderHealth(unwrap(healthResult.value));
    if (logsResult.status === 'fulfilled' && logsResult.value?.ok) state.logs = logsResult.value.data || [];
    renderDiagnosticLogs();
  } catch (error) { toast('系统检测失败', error.message, 'error'); }
  finally { if (button) button.disabled = false; }
}

async function repairHealth() {
  const button = $('#repairHealth');
  if (button) button.disabled = true;
  try {
    const report = unwrap(await api.repairHealth()); renderHealth(report);
    await loadDiagnosticLogs();
    toast(report.healthy ? '修复完成' : '已完成可自动处理的项目', report.unresolved?.length ? `仍需手动处理：${report.unresolved.join('、')}` : '当前环境已通过检测。', report.healthy ? 'success' : 'error');
  } catch (error) { toast('自动修复失败', error.message, 'error'); }
  finally { if (button) button.disabled = false; }
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
  $('#mcpStatus').textContent = status.mcpRunning ? '运行中' : '未启动';
  $('#tunnelStatus').textContent = status.tunnelRunning ? '已连接' : '未连接';
  setDot($('#mcpDot'), status.mcpRunning ? 'ready' : 'error');
  setDot($('#tunnelDot'), status.tunnelRunning ? 'ready' : 'error');
  $('#sideRuntimeText').textContent = ready ? '服务已就绪' : status.mcpRunning ? '等待 Tunnel' : '服务未运行';
  setDot($('#sideRuntimeDot'), ready ? 'ready' : status.mcpRunning ? 'warn' : 'error');
  const partial = status.mcpRunning || status.tunnelRunning;
  $('#heroTitle').textContent = ready ? '服务运行正常' : partial ? '部分服务需要关注' : '服务尚未启动';
  $('#heroText').textContent = ready ? 'MCP 与 Tunnel 已连接' : status.mcpRunning ? 'MCP 已运行，正在等待 Tunnel 连接' : 'MCP 与 Tunnel 当前未连接';
  const heroState = $('#overviewHeroStatus');
  heroState?.classList.remove('ready', 'warn', 'error');
  heroState?.classList.add(ready ? 'ready' : partial ? 'warn' : 'error');
  if (heroState) heroState.textContent = ready ? '✓' : partial ? '!' : '×';
  syncRuntimeActionAvailability();
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
    if (!input.checked) return;
    setWorkspacePermissionMode(input.value);
  }));

  $('#refreshButton').addEventListener('click', () => refreshSnapshot());
  $('#topStartButton').addEventListener('click', () => runRuntime(state.snapshot?.status.fullyReady ? 'restart' : 'start'));
  $('#heroStartButton').addEventListener('click', () => state.snapshot?.status.fullyReady ? runRuntime('restart') : navigate('deploy'));
  $('#overviewRestart').addEventListener('click', () => runRuntime('restart'));
  $('#overviewStop').addEventListener('click', () => runRuntime('stop'));
  $('#connectionInspectHealth')?.addEventListener('click', () => { navigate('health'); inspectHealth(); });
  $('#connectionRestartService')?.addEventListener('click', () => runRuntime('restart', 'deploy'));
  $('#connectionReconnectTunnel')?.addEventListener('click', () => runRuntime('restart', 'deploy'));
  $('#connectionRetestNetwork')?.addEventListener('click', () => $('#proxyDetect')?.click());
  $('#connectionAdvancedToggle')?.addEventListener('click', (event) => {
    openModal({ title: '高级设置', content: $('#connectionAdvancedBody'), trigger: event.currentTarget, size: 'wide' });
  });
  $('#connectionEditConfig')?.addEventListener('click', () => {
    openModal({ title: '连接配置', content: $('#connectionConfigEditor'), trigger: $('#connectionAdvancedToggle'), size: 'wide' });
  });

  const searchInput = $('#globalSearch');
  searchInput?.addEventListener('input', () => renderSearchResults(searchInput.value));
  searchInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const [page] = searchPages(searchInput.value);
      if (page) { event.preventDefault(); navigate(page); searchInput.value = ''; $('#searchResults').hidden = true; }
    }
    if (event.key === 'Escape') { searchInput.value = ''; $('#searchResults').hidden = true; searchInput.blur(); }
  });
  document.addEventListener('keydown', (event) => {
    if (modalState.content) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      searchInput?.focus();
      searchInput?.select();
    }
  });
  $('#moreMenuButton')?.addEventListener('click', (event) => {
    event.stopPropagation();
    const menu = $('#topbarMenu');
    menu.hidden = !menu.hidden;
  });
  $('#topbarMenu')?.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', () => { if ($('#topbarMenu')) $('#topbarMenu').hidden = true; });
  $('#appModal')?.addEventListener('click', (event) => {
    if (event.target.matches('[data-modal-close]')) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (!modalState.content) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = modalFocusableElements();
    if (!focusable.length) {
      event.preventDefault();
      $('#appModalDialog')?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  $('#deployNow').addEventListener('click', deployNow);
  $('#chooseWorkspace').addEventListener('click', chooseWorkspace);
  $('#addAuthorizedRoot').addEventListener('click', addAuthorizedRoot);
  $('#toggleAllowAllDirectories')?.addEventListener('click', toggleAllowAllDirectories);
  $('#workspaceSafeToggle')?.addEventListener('change', async (event) => {
    const mode = event.target.checked ? 'safe' : 'trusted';
    setWorkspacePermissionMode(mode);
    try {
      await saveSettings(false);
    } catch (error) {
      toast('权限设置保存失败', error.message, 'error');
      await refreshSnapshot({ forceForms: true });
    }
  });
  $('#workspaceAdvancedToggle')?.addEventListener('click', (event) => {
    openModal({ title: '高级权限设置', content: $('#workspaceAdvancedBody'), trigger: event.currentTarget });
  });
  $('#globalAgentsToggle').addEventListener('change', async () => {
    renderGlobalAgents(
      { globalAgentsEnabled: $('#globalAgentsToggle').checked },
      state.snapshot?.environment?.globalAgents || {}
    );
    try {
      await saveSettings(false);
    } catch (error) {
      toast('全局规则设置保存失败', error.message, 'error');
      await refreshSnapshot({ forceForms: true });
    }
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
  $('#startWithWindowsToggle').addEventListener('change', () => saveSettings(false));
  $('#keepRunningToggle').addEventListener('change', () => saveSettings(false));
  $('#autoStartToggle').addEventListener('change', () => saveSettings(false));
  $('#progressReportSelect').addEventListener('change', () => saveSettings(false));
  $('#settingsManageRuntimeKey')?.addEventListener('click', () => navigate('deploy'));
  $$('[data-settings-security-target]').forEach((button) => button.addEventListener('click', () => {
    const panel = document.getElementById(button.dataset.settingsSecurityTarget);
    if (!panel) return;
    openModal({ title: button.dataset.settingsSecurityTitle || '安全设置', content: panel, trigger: button });
  }));
  $('#updateReleaseNotesButton')?.addEventListener('click', (event) => {
    openModal({ title: '版本说明', content: $('#updateReleaseNotesPanel'), trigger: event.currentTarget });
  });

  $$('[data-guide-check]').forEach((input) => input.addEventListener('change', async () => {
    renderGuideProgress();
    try { await saveSettings(false); } catch { /* non-critical */ }
  }));
  $$('[data-copy]').forEach((button) => button.addEventListener('click', () => copyText(button.dataset.copy)));
  $('#copyLocalUrl').addEventListener('click', () => copyText($('#guideLocalUrl').textContent));
  $('#copyTunnelId').addEventListener('click', () => copyText($('#guideTunnelId').textContent));

  $('#refreshLogs').addEventListener('click', loadLogs);
  $('#refreshTaskState').addEventListener('click', loadTaskState);
  $('#activityRefreshTask')?.addEventListener('click', loadTaskState);
  $('#refreshTaskHistory').addEventListener('click', loadTaskHistory);
  $('#pauseTask').addEventListener('click', async () => { try { unwrap(await api.pauseTask()); await loadTaskState(); toast('任务已暂停', '当前进度已保存在工作区。'); } catch (error) { toast('暂停失败', error.message, 'error'); } });
  $('#resumeTask').addEventListener('click', async () => { try { unwrap(await api.resumeTask()); await loadTaskState(); toast('任务已继续', '网页模型可从记录的下一步恢复。'); } catch (error) { toast('继续失败', error.message, 'error'); } });
  $('#stopTask').addEventListener('click', async () => { if (!confirm('确定停止当前任务吗？运行中的命令会被终止。')) return; try { unwrap(await api.stopTask()); await loadTaskState(); toast('任务已停止', '状态与历史仍保留，可稍后继续。'); } catch (error) { toast('停止失败', error.message, 'error'); } });
  $('#clearTaskState').addEventListener('click', async () => { if (!confirm('确定清除当前工作区的任务状态吗？')) return; unwrap(await api.clearTaskState()); renderTaskState(null); toast('任务状态已清除'); });
  $('#refreshPerformance').addEventListener('click', loadPerformanceTrace);
  $('#clearPerformance').addEventListener('click', async () => { if (!confirm('确定清空当前工作区的性能记录吗？')) return; try { unwrap(await api.clearPerformanceTrace()); renderPerformanceTrace(null); toast('性能记录已清空'); } catch (error) { toast('清空失败', error.message, 'error'); } });
  $$('.activity-tab').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.activityTab === 'build' ? 'build' : 'task')));
  $('#taskDetailsToggle')?.addEventListener('click', (event) => {
    openModal({ title: '任务详情', content: $('#taskDetailsPanel'), trigger: event.currentTarget, size: 'wide' });
  });
  $('#activityPerformanceToggle')?.addEventListener('click', (event) => {
    openModal({ title: '性能详情', content: $('#activityPerformanceBody'), trigger: event.currentTarget, size: 'wide', onOpen: loadPerformanceTrace });
  });
  $('#inspectBuild').addEventListener('click', inspectBuild);
  $('#runBuild').addEventListener('click', runBuildVerification);
  $('#inspectHealth')?.addEventListener('click', inspectHealth);
  $('#repairHealth')?.addEventListener('click', repairHealth);
  $('#diagnosticDetailsToggle')?.addEventListener('click', (event) => {
    openModal({ title: '诊断详情', content: $('#diagnosticDetails'), trigger: event.currentTarget, size: 'wide' });
  });
  $$('.diagnostic-log-filter').forEach((button) => button.addEventListener('click', () => {
    state.diagnosticLogFilter = button.dataset.diagnosticLogFilter || 'all';
    $$('.diagnostic-log-filter').forEach((item) => item.classList.toggle('active', item === button));
    renderDiagnosticLogs();
  }));
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
    buildSettingsPage();
    bindEvents();
    api.onProgress(updateProgress);
    api.onLog((entry) => {
      state.logs.push(entry);
      if (state.logs.length > 1000) state.logs.shift();
      if (state.currentPage === 'logs') renderLogs();
      if (state.currentPage === 'health') renderDiagnosticLogs();
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






