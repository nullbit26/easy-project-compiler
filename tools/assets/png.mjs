/**
 * The smallest PNG reader and writer this project needs, in plain Node.
 *
 * It exists so that the icon pipeline (tools/assets/make-icons.mjs, tools/assets/exe-icon.mjs) can
 * work with pictures without a native image library: a build tool that needs a compiler or a
 * download to resize six pictures is a build tool that fails on somebody else's machine.
 *
 * Reading covers what a logo may reasonably be: 8 bits per channel, no interlacing, colour types
 * 0, 2, 3, 4 and 6. Writing always produces 8-bit RGBA, which is what Windows icons are made of.
 */
import zlib from 'node:zlib';

/** Decodes a PNG into straight (non-premultiplied) RGBA8 pixels. */
export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('this file is not a PNG');

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  let paletteAlpha = null;
  const parts = [];

  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      paletteAlpha = data;
    } else if (type === 'IDAT') {
      parts.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (!width || !height) throw new Error('the PNG has no size');
  if (interlace !== 0) throw new Error('interlaced PNG is not supported');
  if (bitDepth !== 8) throw new Error(`only 8 bits per channel is supported, got ${bitDepth}`);
  if (![0, 2, 3, 4, 6].includes(colorType)) throw new Error(`unknown colour type ${colorType}`);

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const raw = zlib.inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);

  // Undo the per-scanline filters (PNG spec, section 9.2). Every row carries its own filter byte.
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = y * stride;
    const previous = row - stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[row + x - channels] : 0;
      const up = y > 0 ? pixels[previous + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[previous + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(up - upLeft);
        const pb = Math.abs(left - upLeft);
        const pc = Math.abs(left + up - 2 * upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      pixels[row + x] = value & 0xff;
    }
  }

  // One pixel format on the way out, whichever format the file used on the way in.
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    let r;
    let g;
    let b;
    let a = 255;
    if (colorType === 6) {
      r = pixels[i * 4];
      g = pixels[i * 4 + 1];
      b = pixels[i * 4 + 2];
      a = pixels[i * 4 + 3];
    } else if (colorType === 2) {
      r = pixels[i * 3];
      g = pixels[i * 3 + 1];
      b = pixels[i * 3 + 2];
    } else if (colorType === 4) {
      r = pixels[i * 2];
      g = r;
      b = r;
      a = pixels[i * 2 + 1];
    } else if (colorType === 0) {
      r = pixels[i];
      g = r;
      b = r;
    } else {
      const index = pixels[i];
      r = palette[index * 3];
      g = palette[index * 3 + 1];
      b = palette[index * 3 + 2];
      a = paletteAlpha && index < paletteAlpha.length ? paletteAlpha[index] : 255;
    }
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = a;
  }

  return { width, height, data: rgba };
}

let crcTable = null;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = (crc >>> 8) ^ crcTable[(crc ^ buffer[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

/** Writes RGBA pixels as a PNG. Filter 0 (none) per row: icons are small and this stays readable. */
export function encodePng(image) {
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    raw[y * (stride + 1)] = 0;
    image.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** Whether a buffer starts with the PNG signature. */
export function isPng(buffer) {
  return buffer.length > 8 && buffer.readUInt32BE(0) === 0x89504e47;
}
