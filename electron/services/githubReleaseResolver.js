const { load: parseYaml } = require('js-yaml');

const DEFAULT_OWNER = 'naledao';
const DEFAULT_REPO = 'gpt-webcodex';
const CHANNEL_FILE = 'latest.yml';
const RELEASE_PAGE_SIZE = 100;
const MAX_RELEASE_PAGES = 10;

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function targetName(platform, architecture) {
  return `${String(platform || '').toLowerCase()}-${String(architecture || '').toLowerCase()}`;
}

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

function packageMatches(entry, platform, architecture, assetNames) {
  const expected = targetName(platform, architecture);
  if (typeof entry === 'string') return targetName(...entry.toLowerCase().split(/[-/]/, 2)) === expected;
  if (!entry || typeof entry !== 'object') return false;
  if (targetName(entry.platform, entry.arch) !== expected) return false;
  const file = String(entry.file || '').trim();
  return !file || assetNames.has(file);
}

function manifestSupports(manifest, platform, architecture, assetNames = new Set()) {
  if (!Array.isArray(manifest?.updatePackages)) return false;
  return manifest.updatePackages.some((entry) => packageMatches(entry, platform, architecture, assetNames));
}

class GitHubReleaseResolver {
  constructor(options = {}) {
    this.owner = options.owner || DEFAULT_OWNER;
    this.repo = options.repo || DEFAULT_REPO;
    this.fetch = options.fetch;
    this.log = options.log || null;
    this.pageSize = options.pageSize || RELEASE_PAGE_SIZE;
    this.maxPages = options.maxPages || MAX_RELEASE_PAGES;
    this.webBaseUrl = `https://github.com/${this.owner}/${this.repo}`;
    this.apiBaseUrl = `https://api.github.com/repos/${this.owner}/${this.repo}`;
  }

  async request(url, accept, options = {}) {
    if (typeof this.fetch !== 'function') {
      throw codedError('ERR_UPDATER_RELEASE_DISCOVERY_FAILED', '当前网络会话不支持查询 GitHub Releases。');
    }
    const response = await this.fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    if (!response?.ok) {
      const status = Number(response?.status || 0);
      if (status === 404 && options.notFoundCode) {
        throw codedError(options.notFoundCode, `${CHANNEL_FILE} 不存在。`);
      }
      const remaining = response?.headers?.get?.('x-ratelimit-remaining');
      const reason = status === 403 && remaining === '0'
        ? 'GitHub 匿名 API 请求额度已用完，请稍后重试。'
        : `GitHub 返回 HTTP ${status || 'unknown'}。`;
      throw codedError('ERR_UPDATER_RELEASE_DISCOVERY_FAILED', reason);
    }
    return response;
  }

  async requestJson(url) {
    const response = await this.request(url, 'application/vnd.github+json');
    try {
      return await response.json();
    } catch (error) {
      throw codedError('ERR_UPDATER_RELEASE_DISCOVERY_FAILED', `GitHub Release 列表格式无效：${error.message}`);
    }
  }

  async requestManifest(url) {
    const response = await this.request(url, 'application/yaml, text/yaml, text/plain', {
      notFoundCode: 'ERR_UPDATER_MANIFEST_UNAVAILABLE'
    });
    const raw = await response.text();
    try {
      const manifest = parseYaml(raw);
      if (!manifest || typeof manifest !== 'object') throw new Error('清单内容为空');
      return manifest;
    } catch (error) {
      throw codedError('ERR_UPDATER_INVALID_UPDATE_INFO', `无法解析 ${CHANNEL_FILE}：${error.message}`);
    }
  }

  async findLatest(platform, architecture) {
    const expectedTarget = targetName(platform, architecture);
    let inspected = 0;
    for (let page = 1; page <= this.maxPages; page += 1) {
      const releases = await this.requestJson(`${this.apiBaseUrl}/releases?per_page=${this.pageSize}&page=${page}`);
      if (!Array.isArray(releases)) {
        throw codedError('ERR_UPDATER_RELEASE_DISCOVERY_FAILED', 'GitHub Release 列表格式无效。');
      }
      for (const release of releases) {
        if (release?.draft || release?.prerelease) continue;
        inspected += 1;
        const assets = Array.isArray(release?.assets) ? release.assets : [];
        if (!assets.some((asset) => asset?.name === CHANNEL_FILE)) continue;
        const tagName = String(release?.tag_name || '').trim();
        if (!tagName) continue;
        const encodedTag = encodeURIComponent(tagName);
        const downloadBaseUrl = `${this.webBaseUrl}/releases/download/${encodedTag}/`;
        let manifest;
        try {
          manifest = await this.requestManifest(`${downloadBaseUrl}${CHANNEL_FILE}`);
        } catch (error) {
          this.log?.warn(`跳过无法读取的更新清单：${tagName}`, { stage: 'update-discovery', error: error.message });
          if (error?.code === 'ERR_UPDATER_MANIFEST_UNAVAILABLE' || error?.code === 'ERR_UPDATER_INVALID_UPDATE_INFO') continue;
          throw error;
        }
        const assetNames = new Set(assets.map((asset) => String(asset?.name || '')).filter(Boolean));
        if (!manifestSupports(manifest, platform, architecture, assetNames)) continue;
        const version = normalizeVersion(manifest.version);
        if (!version || normalizeVersion(tagName) !== version) {
          this.log?.warn(`跳过版本不一致的更新清单：${tagName}`, { stage: 'update-discovery', manifestVersion: version });
          continue;
        }
        this.log?.info(`已找到 ${expectedTarget} 更新源 ${tagName}`, { stage: 'update-discovery', inspected });
        return {
          tagName,
          version,
          downloadBaseUrl,
          releaseUrl: String(release.html_url || `${this.webBaseUrl}/releases/tag/${encodedTag}`),
          releaseName: String(release.name || tagName),
          releaseNotes: String(release.body || ''),
          releaseDate: String(release.published_at || release.created_at || ''),
          inspected
        };
      }
      if (releases.length < this.pageSize) break;
    }
    throw codedError(
      'ERR_UPDATER_TARGET_RELEASE_NOT_FOUND',
      `没有找到适用于 ${expectedTarget} 的稳定更新包；已检查 ${inspected} 个 Release。`
    );
  }
}

module.exports = {
  GitHubReleaseResolver,
  CHANNEL_FILE,
  targetName,
  manifestSupports,
  normalizeVersion
};
