const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

function httpRequest(port, method, pathname, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const request = http.request({
      host: '127.0.0.1', port, method, path: pathname,
      headers: {
        ...extraHeaders,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {})
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        text: Buffer.concat(chunks).toString('utf8')
      }));
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

test('Web server requires password authentication and protects REST/SSE', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'web-mcp-server-'));
  const oldConfig = process.env.XDG_CONFIG_HOME;
  const oldState = process.env.XDG_STATE_HOME;
  process.env.XDG_CONFIG_HOME = path.join(temp, 'config');
  process.env.XDG_STATE_HOME = path.join(temp, 'state');

  const { startServer } = require('../web/server');
  const password = 'test-web-password';
  const instance = await startServer({ host: '0.0.0.0', port: 0, password });
  t.after(async () => {
    await instance.close();
    if (oldConfig === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldConfig;
    if (oldState === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = oldState;
    fs.rmSync(temp, { recursive: true, force: true });
  });

  assert.equal(instance.host, '0.0.0.0');
  assert.ok(instance.port > 0);

  const anonymousRoot = await httpRequest(instance.port, 'GET', '/');
  assert.equal(anonymousRoot.statusCode, 302);
  assert.equal(anonymousRoot.headers.location, '/login');

  const anonymousApi = await httpRequest(instance.port, 'GET', '/api/snapshot');
  assert.equal(anonymousApi.statusCode, 401);

  const loginPage = await httpRequest(instance.port, 'GET', '/login');
  assert.equal(loginPage.statusCode, 200);
  assert.match(loginPage.text, /passwordInput/);

  const rejectedLogin = await httpRequest(instance.port, 'POST', '/api/auth/login', { password: 'wrong' });
  assert.equal(rejectedLogin.statusCode, 401);
  assert.equal(rejectedLogin.headers['set-cookie'], undefined);

  const acceptedLogin = await httpRequest(instance.port, 'POST', '/api/auth/login', { password });
  assert.equal(acceptedLogin.statusCode, 200);
  const setCookie = acceptedLogin.headers['set-cookie'];
  assert.ok(Array.isArray(setCookie));
  const cookie = setCookie[0].split(';', 1)[0];
  assert.match(cookie, /^web_mcp_session=/);
  assert.match(setCookie[0], /HttpOnly/);
  assert.match(setCookie[0], /SameSite=Strict/);
  const authenticated = { Cookie: cookie };

  const root = await httpRequest(instance.port, 'GET', '/', undefined, authenticated);
  assert.equal(root.statusCode, 200);
  assert.match(root.text, /web-api\.js/);
  assert.equal(root.text.includes('manager-window-bar'), false);

  const settings = await httpRequest(instance.port, 'POST', '/api/settings', {
    proxyMode: 'environment', mcpPort: 18765, healthPort: 18081, autoStartServices: false
  }, authenticated);
  assert.equal(settings.statusCode, 200);
  assert.equal(JSON.parse(settings.text).data.proxyMode, 'environment');

  const secret = 'sk-test-1234567890';
  const secretResponse = await httpRequest(instance.port, 'POST', '/api/secrets/runtime-key', { value: secret }, authenticated);
  const secretPayload = JSON.parse(secretResponse.text);
  assert.equal(secretPayload.ok, true);
  assert.deepEqual(secretPayload.data, { runtimeApiKey: true, mcpAuthToken: false });
  assert.equal(secretResponse.text.includes(secret), false);

  const task = await httpRequest(instance.port, 'GET', '/api/task-state', undefined, authenticated);
  assert.equal(JSON.parse(task.text).data.exists, false);

  await new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port: instance.port, path: '/api/events', headers: authenticated }, (response) => {
      assert.match(String(response.headers['content-type']), /text\/event-stream/);
      response.once('data', (chunk) => {
        assert.match(chunk.toString('utf8'), /connected/);
        request.destroy();
        resolve();
      });
    });
    request.on('error', (error) => {
      if (error.code === 'ECONNRESET') return;
      reject(error);
    });
  });

  const logout = await httpRequest(instance.port, 'POST', '/api/auth/logout', undefined, authenticated);
  assert.equal(logout.statusCode, 200);
  assert.match(logout.headers['set-cookie'][0], /Max-Age=0/);
  const expiredSession = await httpRequest(instance.port, 'GET', '/api/snapshot', undefined, authenticated);
  assert.equal(expiredSession.statusCode, 401);
});
