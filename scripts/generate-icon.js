const fs = require('node:fs');
const path = require('node:path');
const { app, nativeImage } = require('electron');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(__dirname, 'app-icon-source.png');
const PNG_PATH = path.join(ROOT, 'electron', 'app-icon.png');
const ICO_PATH = path.join(ROOT, 'electron', 'app-icon.ico');
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];

function makePng(source, size) {
  return source.resize({ width: size, height: size, quality: 'best' }).toPNG();
}

function makeIco(source) {
  const images = ICON_SIZES.map((size) => ({ size, png: makePng(source, size) }));
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header[entry] = size >= 256 ? 0 : size;
    header[entry + 1] = size >= 256 ? 0 : size;
    header[entry + 2] = 0;
    header[entry + 3] = 0;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });

  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

async function main() {
  await app.whenReady();

  const source = nativeImage.createFromPath(SOURCE_PATH);
  if (source.isEmpty()) {
    throw new Error(`Unable to load icon source: ${SOURCE_PATH}`);
  }

  fs.mkdirSync(path.dirname(PNG_PATH), { recursive: true });
  fs.writeFileSync(PNG_PATH, makePng(source, 512));
  fs.writeFileSync(ICO_PATH, makeIco(source));
  console.log(`generated ${path.relative(ROOT, PNG_PATH)} and ${path.relative(ROOT, ICO_PATH)}`);
  app.quit();
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
