const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const PNG_PATH = path.join(ROOT, 'electron', 'app-icon.png');
const ICO_PATH = path.join(ROOT, 'electron', 'app-icon.ico');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  name.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return out;
}

function pngEncode(width, height, rgba) {
  const scan = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    scan[row] = 0;
    rgba.copy(scan, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(scan, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const S = size / 512;
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

  function blend(x, y, color, alpha = 1) {
    if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) return;
    const i = (Math.floor(y) * size + Math.floor(x)) * 4;
    const sa = Math.max(0, Math.min(1, alpha * (color[3] ?? 255) / 255));
    const da = px[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    px[i] = clamp((color[0] * sa + px[i] * da * (1 - sa)) / oa);
    px[i + 1] = clamp((color[1] * sa + px[i + 1] * da * (1 - sa)) / oa);
    px[i + 2] = clamp((color[2] * sa + px[i + 2] * da * (1 - sa)) / oa);
    px[i + 3] = clamp(oa * 255);
  }

  function circle(cx, cy, r, color) {
    cx *= S; cy *= S; r *= S;
    const minX = Math.max(0, Math.floor(cx - r - 1));
    const maxX = Math.min(size - 1, Math.ceil(cx + r + 1));
    const minY = Math.max(0, Math.floor(cy - r - 1));
    const maxY = Math.min(size - 1, Math.ceil(cy + r + 1));
    for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      blend(x, y, color, Math.max(0, Math.min(1, r + 0.75 - d)));
    }
  }

  function roundedRect(x, y, w, h, r, color) {
    x *= S; y *= S; w *= S; h *= S; r *= S;
    const x2 = x + w; const y2 = y + h;
    for (let py = Math.max(0, Math.floor(y - 1)); py <= Math.min(size - 1, Math.ceil(y2 + 1)); py += 1) {
      for (let pxX = Math.max(0, Math.floor(x - 1)); pxX <= Math.min(size - 1, Math.ceil(x2 + 1)); pxX += 1) {
        const qx = Math.abs(pxX + 0.5 - (x + w / 2)) - (w / 2 - r);
        const qy = Math.abs(py + 0.5 - (y + h / 2)) - (h / 2 - r);
        const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
        blend(pxX, py, color, Math.max(0, Math.min(1, 0.85 - outside)));
      }
    }
  }

  function line(x1, y1, x2, y2, width, color) {
    x1 *= S; y1 *= S; x2 *= S; y2 *= S; width *= S;
    const vx = x2 - x1; const vy = y2 - y1; const len2 = vx * vx + vy * vy || 1;
    const minX = Math.max(0, Math.floor(Math.min(x1, x2) - width - 2));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(x1, x2) + width + 2));
    const minY = Math.max(0, Math.floor(Math.min(y1, y2) - width - 2));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(y1, y2) + width + 2));
    for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
      const wx = x + 0.5 - x1; const wy = y + 0.5 - y1;
      const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
      const d = Math.hypot(x + 0.5 - (x1 + t * vx), y + 0.5 - (y1 + t * vy));
      blend(x, y, color, Math.max(0, Math.min(1, width / 2 + 0.8 - d)));
    }
  }

  function orbit(cx, cy, rx, ry, width, color, rotate = -0.28) {
    let prev = null;
    for (let i = 0; i <= 180; i += 1) {
      const t = (Math.PI * 2 * i) / 180;
      const ex = rx * Math.cos(t); const ey = ry * Math.sin(t);
      const x = cx + ex * Math.cos(rotate) - ey * Math.sin(rotate);
      const y = cy + ex * Math.sin(rotate) + ey * Math.cos(rotate);
      if (prev) line(prev[0], prev[1], x, y, width, color);
      prev = [x, y];
    }
  }

  // Deep navy rounded tile with subtle vertical gradient.
  for (let y = 0; y < size; y += 1) {
    const t = y / Math.max(1, size - 1);
    const c = [8 + 8 * (1 - t), 22 + 15 * (1 - t), 48 + 28 * (1 - t), 255];
    for (let x = 0; x < size; x += 1) blend(x, y, c, 1);
  }
  roundedRect(18, 18, 476, 476, 94, [5, 15, 35, 255]);
  roundedRect(26, 26, 460, 460, 84, [9, 25, 58, 255]);

  // Web / globe grid.
  circle(252, 246, 154, [23, 63, 112, 80]);
  for (const off of [-92, 0, 92]) line(100, 246 + off * 0.35, 404, 246 + off * 0.35, 3, [43, 103, 164, 90]);
  line(252, 96, 252, 396, 3, [43, 103, 164, 95]);
  orbit(252, 246, 92, 150, 3, [43, 103, 164, 90], 0);
  orbit(252, 246, 150, 92, 3, [43, 103, 164, 85], 0);

  // Neon MCP connection orbit.
  orbit(252, 250, 184, 118, 12, [31, 217, 238, 255], -0.28);
  orbit(252, 250, 184, 118, 4, [114, 246, 255, 255], -0.28);
  circle(105, 337, 22, [86, 239, 247, 255]);
  circle(353, 127, 22, [86, 239, 247, 255]);
  circle(360, 335, 22, [86, 239, 247, 255]);

  // Assistant chat bubble.
  roundedRect(153, 165, 222, 172, 54, [229, 244, 255, 255]);
  // Tail.
  for (let y = Math.floor(294 * S); y < Math.floor(354 * S); y += 1) {
    for (let x = Math.floor(168 * S); x < Math.floor(226 * S); x += 1) {
      const ux = x / S; const uy = y / S;
      if (uy > -1.1 * (ux - 168) + 350 && uy < 0.45 * (ux - 168) + 333) blend(x, y, [229, 244, 255, 255], 1);
    }
  }
  roundedRect(185, 213, 158, 80, 34, [8, 25, 55, 255]);
  circle(231, 253, 10, [53, 233, 241, 255]);
  circle(297, 253, 10, [53, 233, 241, 255]);

  // Tool badge and wrench / connector motif.
  roundedRect(334, 330, 112, 112, 28, [7, 25, 55, 245]);
  line(374, 390, 414, 350, 14, [231, 245, 255, 255]);
  circle(414, 350, 16, [231, 245, 255, 255]);
  circle(414, 350, 7, [7, 25, 55, 255]);
  circle(374, 390, 11, [231, 245, 255, 255]);
  line(360, 414, 394, 414, 5, [45, 225, 237, 255]);
  circle(356, 414, 8, [45, 225, 237, 255]);
  circle(400, 414, 8, [45, 225, 237, 255]);

  return px;
}

function makePng(size) {
  return pngEncode(size, size, render(size));
}

function makeIco(sizes) {
  const images = sizes.map((size) => ({ size, png: makePng(size) }));
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const p = 6 + index * 16;
    header[p] = size >= 256 ? 0 : size;
    header[p + 1] = size >= 256 ? 0 : size;
    header[p + 2] = 0;
    header[p + 3] = 0;
    header.writeUInt16LE(1, p + 4);
    header.writeUInt16LE(32, p + 6);
    header.writeUInt32LE(png.length, p + 8);
    header.writeUInt32LE(offset, p + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((item) => item.png)]);
}

fs.mkdirSync(path.dirname(PNG_PATH), { recursive: true });
fs.writeFileSync(PNG_PATH, makePng(512));
fs.writeFileSync(ICO_PATH, makeIco([16, 24, 32, 48, 64, 128, 256]));
console.log(`generated ${path.relative(ROOT, PNG_PATH)} and ${path.relative(ROOT, ICO_PATH)}`);
