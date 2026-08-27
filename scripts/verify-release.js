const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { load: parseYaml } = require('js-yaml');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const output = path.resolve(process.argv[2] || path.join(root, 'dist'));
const expectedTag = String(process.env.RELEASE_TAG || '').trim();
if (expectedTag && expectedTag !== `v${pkg.version}`) {
  throw new Error(`Release tag ${expectedTag} 与 package.json v${pkg.version} 不一致。`);
}

const installerName = `web-mcp-assistant-setup-${pkg.version}.exe`;
const installer = path.join(output, installerName);
const blockmap = `${installer}.blockmap`;
const metadata = path.join(output, 'latest.yml');
for (const file of [installer, blockmap, metadata]) {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) throw new Error(`缺少发布产物：${file}`);
}

const manifest = parseYaml(fs.readFileSync(metadata, 'utf8'));
const url = manifest?.files?.[0]?.url || manifest?.path;
const sha512 = manifest?.files?.[0]?.sha512 || manifest?.sha512;
if (url !== installerName) throw new Error(`latest.yml 指向了错误的安装包：${url || 'missing'}`);
if (!sha512) throw new Error('latest.yml 缺少 SHA-512。');
const expectedArch = String(process.env.RELEASE_ARCH || process.arch);
const updatePackage = manifest?.updatePackages?.find((entry) => (
  entry?.platform === 'win32'
  && entry?.arch === expectedArch
  && entry?.type === 'nsis'
  && entry?.file === installerName
));
if (!updatePackage) throw new Error(`latest.yml 缺少 win32-${expectedArch} 更新包声明。`);
const digest = crypto.createHash('sha512').update(fs.readFileSync(installer)).digest('base64');
if (digest !== sha512) throw new Error('latest.yml SHA-512 与安装包不一致。');

process.stdout.write(`Windows Release 校验通过：v${pkg.version}\n${installerName}\nlatest.yml (${updatePackage.platform}-${updatePackage.arch}) + blockmap\n`);
