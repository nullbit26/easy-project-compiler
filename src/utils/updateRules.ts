/**
 * The arithmetic of "is there a newer version?", kept apart from the downloading.
 *
 * The desktop build checks a small `version.json` published with each release. Everything that can
 * be decided from strings alone lives here, where a test can pin it: which of two versions is newer,
 * where the file named by the manifest is, and whether a downloaded file is the one the manifest
 * describes. The updater in electron/updates.ts does the rest — asking, downloading, checking the
 * hash and putting the new executable in place.
 */

/** The shape of `version.json`, published next to the release. */
export interface UpdateManifest {
  version: string;
  /** The file name of the new build, next to the manifest (or an absolute URL). */
  file: string;
  /** SHA-256 of that file, lowercase hex. A download whose hash differs is never installed. */
  sha256: string;
  /** Free-form line shown to the user, e.g. what changed. */
  notes?: string;
}

/**
 * What the sidebar needs to know about an update. The shell owns this value; the page only draws it.
 *
 * `ready` is the one that matters: the new build is on disk, checked against its hash, and will be
 * in place the next time the app starts — whether the user presses the button or simply closes it.
 */
export interface UpdateState {
  status: 'unconfigured' | 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error';
  /** The version that is being offered, once one is known. */
  version?: string;
  /** Progress of the background download, 0-100. */
  percent?: number;
  /** What the release says about itself, if it says anything. */
  notes?: string;
  error?: string;
}

/**
 * A version as three numbers.
 *
 * The build stamps `1.0.0`-style versions; anything after a `-` or `+` is deliberately ignored, so
 * `1.2.0-beta.1` sorts as `1.2.0` and a build id can never make a version look newer than it is.
 * A string without a leading number reads as zeros rather than throwing: the manifest comes from the
 * network, and a broken answer must not take the app down with it.
 */
export function parseVersion(value: unknown): [number, number, number] {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = text.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/i);
  if (!match) return [0, 0, 0];
  return [Number(match[1] || 0), Number(match[2] || 0), Number(match[3] || 0)];
}

/** Is `candidate` a version after `current`? Equal and older both answer false. */
export function isNewerVersion(candidate: unknown, current: unknown): boolean {
  const next = parseVersion(candidate);
  const now = parseVersion(current);
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== now[index]) return next[index] > now[index];
  }
  return false;
}

/** `1.0.0` stays as it is, `v.1` becomes `0.1.0`, and nothing becomes `0.0.0`. */
export function normalizeVersion(value: unknown): string {
  return parseVersion(value).join('.');
}

/**
 * The manifest, or null when the answer cannot be trusted.
 *
 * A release that forgot the hash is not accepted: the whole point of the download is that the file
 * is the one that was published, and a manifest without a hash cannot say that.
 */
export function readManifest(payload: unknown): UpdateManifest | null {
  if (!payload || typeof payload !== 'object') return null;
  const source = payload as Record<string, unknown>;
  const version = typeof source.version === 'string' ? source.version.trim() : '';
  const file = typeof source.file === 'string' ? source.file.trim() : '';
  const sha256 = typeof source.sha256 === 'string' ? source.sha256.trim().toLowerCase() : '';
  if (!version || !file || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  const notes = typeof source.notes === 'string' ? source.notes.trim() : undefined;
  return { version, file, sha256, notes };
}

/** Where the new build is downloaded from: the file name is relative to the feed, or absolute. */
export function resolveAssetUrl(feed: string, file: string): string {
  if (/^https?:\/\//i.test(file)) return file;
  const base = feed.endsWith('/') ? feed : `${feed}/`;
  return `${base}${encodeURIComponent(file).replace(/%2F/g, '/')}`;
}

/**
 * The same file, under the name a release host may actually have stored it as.
 *
 * A release asset does not keep the spaces in the name it was uploaded with: GitHub stores
 * `Easy Project Compiler.exe` as `Easy.Project.Compiler.exe`, and the URL the manifest names answers
 * 404. This project's own publisher now records the stored form, so this is for the releases
 * published before it did — a build already in someone's hands cannot be fixed by today's publisher,
 * and an update that 404s is an update that never arrives.
 *
 * Null when the name has no spaces to change, which is also the answer for an absolute URL: that one
 * names its own host and is not ours to rewrite.
 */
export function alternateAssetUrl(feed: string, file: string): string | null {
  if (/^https?:\/\//i.test(file)) return null;
  const stored = file.replace(/\s+/g, '.');
  return stored === file ? null : resolveAssetUrl(feed, stored);
}

/** The file name inside a download URL, for storing it next to the app without asking the server. */
export function fileNameOf(url: string, fallback = 'update.exe'): string {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
    // A name with a path separator or a drive colon would let a manifest write outside the folder.
    return /^[^\\/:*?"<>|]+$/.test(name) ? name : fallback;
  } catch {
    return fallback;
  }
}
