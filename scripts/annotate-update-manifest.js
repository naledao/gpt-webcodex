const fs = require('node:fs');
const path = require('node:path');
const { load: parseYaml, dump: dumpYaml } = require('js-yaml');

const root = path.resolve(__dirname, '..');

function annotateUpdateManifest(outputDirectory, architecture = process.arch) {
  const pkg = require(path.join(root, 'package.json'));
  const output = path.resolve(outputDirectory);
  const manifestPath = path.join(output, 'latest.yml');
  const installerName = `web-mcp-assistant-setup-${pkg.version}.exe`;
  const installerPath = path.join(output, installerName);
  if (!fs.existsSync(manifestPath)) throw new Error(`缺少更新清单：${manifestPath}`);
  if (!fs.existsSync(installerPath)) throw new Error(`缺少 Windows 安装包：${installerPath}`);

  const manifest = parseYaml(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest || typeof manifest !== 'object') throw new Error('latest.yml 内容无效。');
  manifest.updatePackages = [{
    platform: 'win32',
    arch: architecture,
    type: 'nsis',
    file: installerName
  }];
  fs.writeFileSync(manifestPath, dumpYaml(manifest, { lineWidth: -1, noRefs: true }), 'utf8');
  return { manifestPath, installerName, architecture };
}

if (require.main === module) {
  const output = process.argv[2] || path.join(root, 'dist');
  const architecture = String(process.env.RELEASE_ARCH || process.arch);
  const result = annotateUpdateManifest(output, architecture);
  process.stdout.write(`已写入更新包清单：win32-${result.architecture}\n${result.manifestPath}\n`);
}

module.exports = { annotateUpdateManifest };
