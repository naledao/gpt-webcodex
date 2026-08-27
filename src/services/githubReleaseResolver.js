const DEFAULT_OWNER = 'naledao';
const DEFAULT_REPO = 'gpt-webcodex';
const RELEASE_PAGE_SIZE = 100;
const MAX_RELEASE_PAGES = 10;

function isStableRelease(release) {
  if (!release || typeof release !== 'object' || release.draft || release.prerelease) return false;
  return /^v?\d+\.\d+\.\d+$/.test(String(release.tag_name || '').trim());
}

function hasUploadedAsset(release, assetName) {
  return Array.isArray(release?.assets)
    && release.assets.some((asset) => asset?.name === assetName && asset?.state === 'uploaded');
}

class GitHubReleaseResolver {
  constructor(options = {}) {
    this.owner = options.owner || DEFAULT_OWNER;
    this.repo = options.repo || DEFAULT_REPO;
    this.requestJson = options.requestJson;
    this.log = options.log || null;
    this.pageSize = options.pageSize || RELEASE_PAGE_SIZE;
    this.maxPages = options.maxPages || MAX_RELEASE_PAGES;
    this.apiBaseUrl = `https://api.github.com/repos/${this.owner}/${this.repo}`;
  }

  async findLatest(assetName, requestOptions = {}) {
    if (typeof this.requestJson !== 'function') {
      throw new Error('当前网络会话不支持查询 GitHub Releases。');
    }
    const expectedAsset = String(assetName || '').trim();
    if (!expectedAsset) throw new Error('未指定当前 Linux 架构的更新资产。');

    let inspected = 0;
    for (let page = 1; page <= this.maxPages; page += 1) {
      const releases = await this.requestJson(
        `${this.apiBaseUrl}/releases?per_page=${this.pageSize}&page=${page}`,
        requestOptions
      );
      if (!Array.isArray(releases)) throw new Error('GitHub Release 列表格式无效。');
      for (const release of releases) {
        if (!isStableRelease(release)) continue;
        inspected += 1;
        if (!hasUploadedAsset(release, expectedAsset)) continue;
        this.log?.info(`已找到 Linux 更新源 ${release.tag_name}`, {
          stage: 'update-discovery',
          asset: expectedAsset,
          inspected
        });
        return { release, inspected };
      }
      if (releases.length < this.pageSize) break;
    }
    throw new Error(`没有找到包含 ${expectedAsset} 的稳定 Release；已检查 ${inspected} 个 Release。`);
  }
}

module.exports = {
  GitHubReleaseResolver,
  RELEASE_PAGE_SIZE,
  MAX_RELEASE_PAGES,
  isStableRelease,
  hasUploadedAsset
};
