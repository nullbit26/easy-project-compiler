#!/usr/bin/env node
/**
 * Turns the app's own logo into the icon Windows shows for the application.
 *
 * One source of truth ("EPC logo.png" in the project root) and one output (`build/icons/app.ico`),
 * so the mark in the title bar, in the taskbar and on the .exe can never drift apart. The .ico is
 * read by electron-builder (`win.icon`), by the Electron window itself (`BrowserWindow.icon`, which
 * is what covers the unpackaged `npm run desktop` run) and by tools/exe/build-sea.mjs, which stamps
 * it into the single-file build with resedit.
 *
 * Everything here is plain Node — our own PNG reader (tools/assets/png.mjs), no image library —
 * because the build must not depend on something that needs a compiler or a download to resize six
 * pictures. The output is generated, not committed: `build/` is ignored, and every build regenerates
 * it from the logo when the logo is newer.
 *
 * Usage: node tools/assets/make-icons.mjs            (skips work when the .ico is up to date)
 *        node tools/assets/make-icons.mjs --force
 *        node tools/assets/make-icons.mjs --preview  (also writes logo-256.png, to look at it)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const sourcePath = path.join(root, 'EPC logo.png');
const outDir = path.join(root, 'build', 'icons');
export const icoPath = path.join(outDir, 'app.ico');
const previewPath = path.join(outDir, 'logo-256.png');

/**
 * The sizes Windows actually asks for: Explorer's small views, the taskbar, the window frame and
 * the large "extra large icons" view. 16 is the smallest Windows will draw, 256 is the largest it
 * will scale from.
 */
const SIZES = [256, 128, 64, 48, 32, 16];

/**
 * How much of the canvas is left free around the mark, on each side.
 *
 * Windows draws application icons inside a shape of its own (a rounded square on the taskbar, a
 * circle in some lists), and a mark that fills the canvas looks like it has been cropped by it.
 */
const PADDING = 0.07;

/** Below this alpha a pixel counts as "nothing to look at" when the mark's bounds are measured. */
const ALPHA_VISIBLE = 16;

/** How different from the corner colour a pixel has to be to count, for a logo without transparency. */
const COLOUR_TOLERANCE = 24;

/** Reported by the build that called us, which knows how it wants to fail. */
function fail(message) {
  throw new Error(`иконку не собрать: ${message}`);
}

/**
 * The bounds of the mark itself, so a logo that sits in a corner of a wide canvas is not shipped as
 * a small smudge next to a lot of empty space.
 *
 * Two cases, because a logo may or may not come with transparency: with alpha the only thing that
 * counts is what is visible, without it the background is taken to be the colour of the top-left
 * corner and everything that differs from it counts.
 */
function contentBox(image) {
  let transparent = false;
  for (let i = 3; i < image.data.length; i += 4) {
    if (image.data[i] < 255) {
      transparent = true;
      break;
    }
  }

  const background = [image.data[0], image.data[1], image.data[2]];
  let x0 = image.width;
  let y0 = image.height;
  let x1 = -1;
  let y1 = -1;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const i = (y * image.width + x) * 4;
      const visible = transparent
        ? image.data[i + 3] >= ALPHA_VISIBLE
        : Math.abs(image.data[i] - background[0]) +
            Math.abs(image.data[i + 1] - background[1]) +
            Math.abs(image.data[i + 2] - background[2]) >
          COLOUR_TOLERANCE;
      if (!visible) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }

  if (x1 < 0) return { x0: 0, y0: 0, x1: image.width, y1: image.height };
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** Cuts the mark out and centres it on a transparent square canvas, with the chosen padding. */
function squareCanvas(image, box) {
  const content = Math.max(box.x1 - box.x0, box.y1 - box.y0);
  const side = Math.ceil(content / (1 - PADDING * 2));
  const canvas = { width: side, height: side, data: Buffer.alloc(side * side * 4) };
  const offsetX = Math.floor((side - (box.x1 - box.x0)) / 2);
  const offsetY = Math.floor((side - (box.y1 - box.y0)) / 2);

  for (let y = box.y0; y < box.y1; y += 1) {
    const row = ((y - box.y0 + offsetY) * side + offsetX) * 4;
    const from = (y * image.width + box.x0) * 4;
    image.data.copy(canvas.data, row, from, from + (box.x1 - box.x0) * 4);
  }
  return canvas;
}

/**
 * Scales the canvas down to one icon size by averaging the source pixels each destination pixel
 * covers, in premultiplied alpha: averaging the colour and the alpha separately would pull the
 * transparent background's black into the mark's edges and ring a bright logo with a dark halo.
 */
function resize(canvas, size) {
  const out = Buffer.alloc(size * size * 4);
  const scale = canvas.width / size;

  for (let y = 0; y < size; y += 1) {
    const fromY = Math.floor(y * scale);
    const toY = Math.max(fromY + 1, Math.floor((y + 1) * scale));
    for (let x = 0; x < size; x += 1) {
      const fromX = Math.floor(x * scale);
      const toX = Math.max(fromX + 1, Math.floor((x + 1) * scale));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = fromY; sy < toY; sy += 1) {
        for (let sx = fromX; sx < toX; sx += 1) {
          const i = (sy * canvas.width + sx) * 4;
          const alpha = canvas.data[i + 3] / 255;
          r += canvas.data[i] * alpha;
          g += canvas.data[i + 1] * alpha;
          b += canvas.data[i + 2] * alpha;
          a += alpha;
          count += 1;
        }
      }

      const target = (y * size + x) * 4;
      if (a > 0) {
        out[target] = Math.round(r / a);
        out[target + 1] = Math.round(g / a);
        out[target + 2] = Math.round(b / a);
      }
      out[target + 3] = Math.round((a / count) * 255);
    }
  }
  return { width: size, height: size, data: out };
}

/**
 * The .ico container: one directory entry per size, each pointing at a PNG of that size.
 *
 * Windows itself stores big icons as PNG inside the container and has read them that way since
 * Vista, so the pictures go in exactly as they are — no second conversion pass, and no chance of
 * the BMP and PNG copies of the same icon disagreeing.
 */
export function buildIco(images) {
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);

  let offset = directory.length;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    directory[entry] = image.size >= 256 ? 0 : image.size;
    directory[entry + 1] = image.size >= 256 ? 0 : image.size;
    directory[entry + 2] = 0;
    directory[entry + 3] = 0;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(image.png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.png.length;
  });

  return Buffer.concat([directory, ...images.map((image) => image.png)]);
}

/** Builds the .ico from the logo, unless it is already newer than the logo. Returns nothing. */
export function buildIcon({ force = false, preview = false } = {}) {
  const wantPreview = preview || process.argv.includes('--preview');

  if (!fs.existsSync(sourcePath)) fail(`логотип не найден: ${sourcePath}`);
  if (
    !force &&
    !process.argv.includes('--force') &&
    fs.existsSync(icoPath) &&
    fs.statSync(icoPath).mtimeMs >= fs.statSync(sourcePath).mtimeMs
  ) {
    console.log(`· иконка уже собрана из этого логотипа: ${path.relative(root, icoPath)}`);
    return;
  }

  const logo = decodePng(fs.readFileSync(sourcePath));
  const box = contentBox(logo);
  const canvas = squareCanvas(logo, box);
  const images = SIZES.map((size) => ({ size, png: encodePng(resize(canvas, size)) }));

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(icoPath, buildIco(images));
  if (wantPreview) fs.writeFileSync(previewPath, images[0].png);

  const source = `${logo.width}×${logo.height}`;
  const mark = `${box.x1 - box.x0}×${box.y1 - box.y0}`;
  console.log(`· логотип: ${source}, сам знак: ${mark} → ${SIZES.join(', ')}`);
  console.log(
    `· иконка: ${path.relative(root, icoPath)} (${SIZES.length} размер(ов), ${(
      fs.statSync(icoPath).size / 1024
    ).toFixed(1)} KB)`
  );
  if (wantPreview) console.log(`· картинка для просмотра: ${path.relative(root, previewPath)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildIcon();
