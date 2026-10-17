/**
 * Comparing folder paths that the user typed or picked with the folder the app is connected to.
 *
 * The same folder can be written in several ways: `C:\Work\App`, `c:/work/app` and `C:\Work\App\`
 * all point at one place. Windows also ignores letter case, while macOS and Linux do not — so the
 * comparison only lowercases paths that are clearly Windows paths.
 */

/** Windows paths are case-insensitive; POSIX paths are not. */
function isWindowsPath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || path.includes('\\');
}

/** Normalises separators, a trailing slash and (on Windows) the letter case. */
export function normalizeFolderPath(path?: string | null): string {
  const trimmed = (path || '').trim();
  const unified = trimmed.replace(/[\\/]+/g, '/').replace(/\/+$/, '');
  return isWindowsPath(trimmed) ? unified.toLowerCase() : unified;
}

/** Whether both paths point at the same folder. Empty paths never match. */
export function isSameFolder(a?: string | null, b?: string | null): boolean {
  const left = normalizeFolderPath(a);
  const right = normalizeFolderPath(b);
  return left !== '' && right !== '' && left === right;
}
