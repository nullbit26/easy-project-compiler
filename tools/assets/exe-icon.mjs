/**
 * The icon inside a Windows executable: reading it, stamping it and checking it.
 *
 * Two builds need this. tools/desktop/build-desktop.mjs lets electron-builder put the icon in the
 * portable .exe and can check what came out; tools/exe/build-sea.mjs copies node.exe and injects a
 * blob, so `rcedit`-style stamping is its own step there. Both go through resedit, which is pure
 * JavaScript and therefore works on a machine that has nothing installed for it.
 *
 * "The build set the icon" and "the file really carries the logo" are different claims, and tests
 * that only check the first one pass while the taskbar shows something else. So the check here reads
 * the icon *back out* of the finished .exe and compares its pixels with the .ico the build started
 * from — the icon may be stored as a PNG (as we write it) or as a BMP, since a packager is free to
 * convert it, and both are decoded before they are compared.
 */
import fs from 'node:fs';
import * as ResEdit from 'resedit';
import { decodePng, isPng } from './png.mjs';

/** One icon resource as a buffer, whichever way resedit hands it over. */
function iconData(item) {
  if (item.isRaw()) return Buffer.from(new Uint8Array(item.bin));
  return Buffer.from(new Uint8Array(item.generate()));
}

/** Every icon resource in the executable, largest first: { width, height, data }. */
export function iconsInExe(exePath) {
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const resource = ResEdit.NtExecutableResource.from(exe);
  const icons = [];

  for (const group of ResEdit.Resource.IconGroupEntry.fromEntries(resource.entries)) {
    for (const item of group.getIconItemsFromEntries(resource.entries)) {
      // A BMP icon's own header carries the size (doubled in height, because the icon's mask is
      // stored together with its pixels); a PNG icon states it in its header instead.
      const fromBitmap = item.isRaw() ? null : item.bitmapInfo;
      // A dimension of 0 in the icon directory means 256 — the one size the single byte cannot
      // hold. Left unnormalised, a 256-pixel logo sorts as the smallest icon in the file.
      const dimension = (value) => (value === 0 ? 256 : value);
      icons.push({
        width: dimension(item.width ?? fromBitmap?.width ?? 0),
        height: dimension(item.height ?? (fromBitmap ? fromBitmap.height / 2 : 0)),
        data: iconData(item)
      });
    }
  }

  return icons.sort((a, b) => b.width * b.height - a.width * a.height);
}

/** The pixels of one icon resource: a PNG is decoded, a BMP is read as the DIB it is. */
export function iconPixels(data) {
  if (isPng(data)) return decodePng(data);

  const headerSize = data.readUInt32LE(0);
  if (headerSize < 40) throw new Error(`unexpected icon bitmap header (${headerSize} bytes)`);
  const width = data.readInt32LE(4);
  const storedHeight = data.readInt32LE(8);
  const bitCount = data.readUInt16LE(14);
  const compression = data.readUInt32LE(16);
  const height = Math.abs(storedHeight) / 2;

  if (compression !== 0) throw new Error(`compressed icon bitmaps are not supported (${compression})`);
  if (bitCount !== 32 && bitCount !== 24) throw new Error(`unsupported icon depth: ${bitCount} bits`);

  const stride = Math.floor((bitCount * width + 31) / 32) * 4;
  const pixels = Buffer.alloc(width * height * 4);

  // DIB rows are stored bottom-up, and their channels as BGR(A).
  for (let y = 0; y < height; y += 1) {
    const from = headerSize + (height - 1 - y) * stride;
    for (let x = 0; x < width; x += 1) {
      const src = from + x * (bitCount / 8);
      const dst = (y * width + x) * 4;
      pixels[dst] = data[src + 2];
      pixels[dst + 1] = data[src + 1];
      pixels[dst + 2] = data[src];
      pixels[dst + 3] = bitCount === 32 ? data[src + 3] : 255;
    }
  }

  // Some packagers leave the alpha channel empty and rely on the AND mask instead. Say so rather
  // than comparing a fully transparent picture with the logo and reporting a difference that is not
  // one: the shape is then the mask's, which this module does not compare.
  const anyAlpha = (() => {
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 0) return true;
    return false;
  })();
  if (!anyAlpha && bitCount === 32) throw new Error('the stored icon has no alpha channel to compare');

  return { width, height, data: pixels };
}

/**
 * Writes the generated icon into an executable, replacing whatever icon it carried.
 *
 * The icon group keeps the id and language it already had, because that is what Windows' own
 * loader expects to find; a file without any icon (a plain copy of node.exe has one, a stripped
 * binary may not) gets the usual group 1 / en-US.
 */
export function stampExeIcon(exePath, icoPath) {
  const executable = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const resource = ResEdit.NtExecutableResource.from(executable);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resource.entries);

  const id = groups.length > 0 ? groups[0].id : 1;
  const lang = groups.length > 0 ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    resource.entries,
    id,
    lang,
    iconFile.icons.map((item) => item.data)
  );
  resource.outputResource(executable);
  fs.writeFileSync(exePath, Buffer.from(executable.generate()));
  return id;
}

/**
 * Reads the icon back out of a finished executable and compares it with the .ico the build used.
 *
 * Returns a line for the build log; throws when the executable shows something other than the
 * logo, because a build that ships the wrong icon is exactly the mistake this exists to catch.
 */
export function assertExeIcon(exePath, icoPath) {
  const wanted = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
  // The .ico the build generates holds its sizes largest first (see make-icons.mjs).
  const expectedPixels = iconPixels(iconData(wanted.icons[0].data));

  const icons = iconsInExe(exePath);
  if (icons.length === 0) throw new Error(`${exePath} carries no icon at all`);

  const biggest = icons[0];
  const actual = iconPixels(biggest.data);
  if (actual.width !== expectedPixels.width || actual.height !== expectedPixels.height) {
    throw new Error(
      `the icon in the executable is ${actual.width}×${actual.height}, the build icon is ` +
        `${expectedPixels.width}×${expectedPixels.height}`
    );
  }

  let differing = 0;
  let worst = 0;
  for (let i = 0; i < actual.data.length; i += 1) {
    const difference = Math.abs(actual.data[i] - expectedPixels.data[i]);
    if (difference > 0) differing += 1;
    if (difference > worst) worst = difference;
  }
  if (differing > 0) {
    throw new Error(
      `the icon in the executable differs from the build icon in ${differing} of ` +
        `${actual.data.length} channel values (worst difference ${worst})`
    );
  }

  return `${icons.length} icon size(s), largest ${biggest.width}×${biggest.height} matches the logo`;
}
