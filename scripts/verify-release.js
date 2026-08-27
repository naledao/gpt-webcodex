const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

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

const yaml = fs.readFileSync(metadata, 'utf8');
const url = yaml.match(/^\s*-?\s*url:\s*(.+)$/m)?.[1]?.trim();
const sha512 = yaml.match(/^\s*sha512:\s*(\S+)$/m)?.[1];
if (url !== installerName) throw new Error(`latest.yml 指向了错误的安装包：${url || 'missing'}`);
if (!sha512) throw new Error('latest.yml 缺少 SHA-512。');
const digest = crypto.createHash('sha512').update(fs.readFileSync(installer)).digest('base64');
if (digest !== sha512) throw new Error('latest.yml SHA-512 与安装包不一致。');

process.stdout.write(`Windows Release 校验通过：v${pkg.version}\n${installerName}\nlatest.yml + blockmap\n`);
