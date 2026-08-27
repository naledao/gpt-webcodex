(() => {
  async function request(method, url, body) {
    try {
      const response = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store'
      });
      const payload = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
      if (response.status === 401) {
        location.replace('/login');
        return { ok: false, error: payload?.error || '登录已失效。' };
      }
      if (!response.ok && payload?.ok !== false) return { ok: false, error: `HTTP ${response.status}` };
      return payload;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  const eventSource = new EventSource('/api/events');
  const subscribe = (name, listener) => {
    const handler = (event) => {
      try { listener(JSON.parse(event.data)); }
      catch { /* ignore malformed event payload */ }
    };
    eventSource.addEventListener(name, handler);
    return () => eventSource.removeEventListener(name, handler);
  };

  async function openExternal(target) {
    const urls = {
      'chatgpt-connectors': 'https://chatgpt.com/#settings/Connectors',
      'openai-tunnels': 'https://platform.openai.com/settings/organization/tunnels',
      'openai-runtime-keys': 'https://platform.openai.com/settings/organization/api-keys',
      'coding-tools-source': 'https://github.com/xyTom/coding-tools-mcp'
    };
    let url = urls[target];
    if (target === 'tunnel-ui') {
      const snapshot = await request('GET', '/api/snapshot');
      if (!snapshot.ok) return snapshot;
      url = snapshot.data?.status?.tunnelUiUrl;
    }
    if (!url) return { ok: false, error: '不允许打开该地址。' };
    window.open(url, '_blank', 'noopener,noreferrer');
    return { ok: true, data: true };
  }

  window.mcpAssistant = {
    snapshot: (options) => request('GET', options?.force ? '/api/snapshot?force=1' : '/api/snapshot'),
    switchWorkspace: (workspace) => request('POST', '/api/workspace/switch', { workspace }),
    updateAuthorizedRoots: (roots) => request('POST', '/api/workspace/roots', { roots }),
    taskState: () => request('GET', '/api/task-state'),
    clearTaskState: () => request('DELETE', '/api/task-state'),
    pauseTask: () => request('POST', '/api/task-state/pause'),
    resumeTask: () => request('POST', '/api/task-state/resume'),
    stopTask: () => request('POST', '/api/task-state/stop'),
    taskHistory: () => request('GET', '/api/task-history'),
    performanceTrace: () => request('GET', '/api/performance'),
    clearPerformanceTrace: () => request('DELETE', '/api/performance'),
    inspectBuild: () => request('GET', '/api/build'),
    runBuild: (options) => request('POST', '/api/build/run', options || {}),
    inspectHealth: () => request('GET', '/api/health'),
    repairHealth: () => request('POST', '/api/health/repair'),
    saveSettings: (patch) => request('POST', '/api/settings', patch || {}),
    saveRuntimeKey: (value) => request('POST', '/api/secrets/runtime-key', { value }),
    removeRuntimeKey: () => request('DELETE', '/api/secrets/runtime-key'),
    regenerateMcpToken: () => request('POST', '/api/secrets/mcp-token/regenerate'),
    start: () => request('POST', '/api/runtime/start'),
    stop: () => request('POST', '/api/runtime/stop'),
    restart: () => request('POST', '/api/runtime/restart'),
    logs: () => request('GET', '/api/logs'),
    clearLogs: () => request('DELETE', '/api/logs'),
    detectProxy: () => request('POST', '/api/proxy/detect'),
    updateStatus: () => request('GET', '/api/update/status'),
    checkUpdate: () => request('POST', '/api/update/check'),
    downloadUpdate: () => request('POST', '/api/update/download'),
    applyUpdate: () => request('POST', '/api/update/apply'),
    logout: () => request('POST', '/api/auth/logout'),
    openExternal,
    onProgress: (listener) => subscribe('runtime:progress', listener),
    onLog: (listener) => subscribe('logs:entry', listener),
    onStatus: (listener) => subscribe('runtime:status', listener),
    onHeartbeat: (listener) => subscribe('runtime:heartbeat', listener),
    onBuildProgress: (listener) => subscribe('build:progress', listener),
    onUpdateProgress: (listener) => subscribe('update:progress', listener)
  };
})();
