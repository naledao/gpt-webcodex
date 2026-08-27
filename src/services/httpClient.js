const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REDIRECTS = 8;

function requestOptions(target, options = {}) {
  return {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || undefined,
    path: `${target.pathname}${target.search}`,
    method: options.method || 'GET',
    headers: options.headers || {}
  };
}

function attachTimeout(request, timeoutMs) {
  request.setTimeout(timeoutMs, () => request.destroy(new Error(`网络请求超时（${timeoutMs} ms）`)));
}

function directRequest(target, options) {
  return new Promise((resolve, reject) => {
    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.request(requestOptions(target, options), resolve);
    attachTimeout(request, options.timeoutMs);
    request.once('error', reject);
    request.end();
  });
}

function httpTargetThroughProxy(target, proxy, options) {
  return new Promise((resolve, reject) => {
    const transport = proxy.protocol === 'https:' ? https : http;
    const request = transport.request({
      protocol: proxy.protocol,
      hostname: proxy.hostname,
      port: proxy.port || undefined,
      path: target.href,
      method: options.method || 'GET',
      headers: { Host: target.host, ...(options.headers || {}) }
    }, resolve);
    attachTimeout(request, options.timeoutMs);
    request.once('error', reject);
    request.end();
  });
}

function httpsTargetThroughProxy(target, proxy, options) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const proxyTransport = proxy.protocol === 'https:' ? https : http;
    const targetPort = Number(target.port || 443);
    const connect = proxyTransport.request({
      protocol: proxy.protocol,
      hostname: proxy.hostname,
      port: proxy.port || undefined,
      method: 'CONNECT',
      path: `${target.hostname}:${targetPort}`,
      headers: {
        Host: `${target.hostname}:${targetPort}`,
        'User-Agent': options.headers?.['User-Agent'] || options.headers?.['user-agent'] || 'web-mcp-assistant'
      }
    });
    attachTimeout(connect, options.timeoutMs);
    connect.once('error', fail);
    connect.once('connect', (response, socket, head) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        fail(new Error(`代理 CONNECT 失败（HTTP ${response.statusCode}）`));
        return;
      }
      if (head?.length) socket.unshift(head);
      const secureSocket = tls.connect({
        socket,
        servername: target.hostname,
        ALPNProtocols: ['http/1.1']
      });
      secureSocket.setTimeout(options.timeoutMs, () => secureSocket.destroy(new Error(`TLS 请求超时（${options.timeoutMs} ms）`)));
      secureSocket.once('error', fail);
      secureSocket.once('secureConnect', () => {
        if (settled) return;
        const request = https.request({
          ...requestOptions(target, options),
          agent: false,
          createConnection: () => secureSocket
        }, (result) => {
          if (settled) {
            result.resume();
            return;
          }
          settled = true;
          resolve(result);
        });
        attachTimeout(request, options.timeoutMs);
        request.once('error', fail);
        request.end();
      });
    });
    connect.end();
  });
}

async function requestOnce(url, options = {}) {
  const target = url instanceof URL ? url : new URL(url);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error(`不支持的下载协议：${target.protocol}`);
  const normalized = { ...options, timeoutMs: Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS };
  if (!options.proxyUrl) return directRequest(target, normalized);

  const proxy = new URL(options.proxyUrl);
  if (!['http:', 'https:'].includes(proxy.protocol)) throw new Error(`不支持的代理协议：${proxy.protocol}`);
  if (proxy.username || proxy.password) throw new Error('更新代理不允许在 URL 中包含凭据。');
  return target.protocol === 'https:'
    ? httpsTargetThroughProxy(target, proxy, normalized)
    : httpTargetThroughProxy(target, proxy, normalized);
}

async function responseText(response, maxBytes = 64 * 1024) {
  const chunks = [];
  let received = 0;
  for await (const chunk of response) {
    received += chunk.length;
    if (received <= maxBytes) chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function requestStream(url, options = {}, redirectCount = 0) {
  const target = url instanceof URL ? url : new URL(url);
  const response = await requestOnce(target, options);
  if (REDIRECT_CODES.has(response.statusCode) && response.headers.location) {
    if (redirectCount >= (options.maxRedirects ?? DEFAULT_MAX_REDIRECTS)) {
      response.resume();
      throw new Error('GitHub 下载重定向次数过多。');
    }
    const next = new URL(response.headers.location, target);
    response.resume();
    return requestStream(next, options, redirectCount + 1);
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const detail = (await responseText(response)).trim();
    throw new Error(`GitHub 请求失败（HTTP ${response.statusCode}）${detail ? `：${detail.slice(0, 500)}` : ''}`);
  }
  response.setTimeout(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, () => {
    response.destroy(new Error('GitHub 响应读取超时。'));
  });
  return response;
}

async function requestJson(url, options = {}) {
  const response = await requestStream(url, options);
  const maxBytes = Number(options.maxBytes) || 2 * 1024 * 1024;
  const chunks = [];
  let received = 0;
  for await (const chunk of response) {
    received += chunk.length;
    if (received > maxBytes) throw new Error('GitHub 元数据响应过大。');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('GitHub 返回了无效的 JSON。');
  }
}

module.exports = { requestStream, requestJson, requestOnce, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_REDIRECTS };
