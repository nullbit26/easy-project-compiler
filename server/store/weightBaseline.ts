import fs from 'fs';
import path from 'path';

/**
 * Remembers how heavy the connected folder was when it was last measured, so the *next* write can
 * say what it added instead of only how big the project is now.
 *
 * Two numbers per folder, both optional:
 *  - the size of the project's own files, refreshed after every write through the app;
 *  - the size of the folder's build output, refreshed only when the build check really ran — a
 *    `dist/` left over from an older build must never be compared with itself and reported as
 *    "the bundle did not change".
 *
 * It lives next to the app, never inside the user's project, and losing it costs one comparison.
 */

const MAX_ROOTS = 8;

export interface StoredWeight {
  at: string;
  changesetId: string | null;
  /**
   * When the project's own files were last measured, or null when they never were.
   *
   * Kept apart from `at` on purpose: a build measurement must not pass for a project measurement,
   * or the first write after a build would report "the project grew from 0 bytes".
   */
  projectAt: string | null;
  /** Bytes of the project's own files (the walk the file list uses; build output excluded). */
  projectBytes: number;
  projectFileCount: number;
  /** True when the walk hit its file cap, which makes every number a floor rather than a total. */
  projectTruncated: boolean;
  buildDir: string | null;
  buildBytes: number | null;
  buildFileCount: number | null;
}

interface WeightFile {
  version: 1;
  roots: Record<string, StoredWeight>;
}

/** Tests point this at a temp file so they never read or write the developer's own history. */
export function getWeightBaselinePath(): string {
  return process.env.EPC_WEIGHT_FILE || path.join(process.cwd(), 'data', 'weight.json');
}

function keyFor(root: string): string {
  return path.resolve(root);
}

function readFile(): WeightFile {
  try {
    const filePath = getWeightBaselinePath();
    if (!fs.existsSync(filePath)) return { version: 1, roots: {} };
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const roots = parsed?.roots && typeof parsed.roots === 'object' ? parsed.roots : {};
    return { version: 1, roots };
  } catch {
    // A damaged history is not worth an error message: the worst case is one write without a
    // comparison, and the next one writes a fresh baseline.
    console.warn('[Weight] Could not read the saved weight history, starting fresh.');
    return { version: 1, roots: {} };
  }
}

function writeFile(file: WeightFile): void {
  try {
    const filePath = getWeightBaselinePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, { encoding: 'utf8' });
  } catch (err: any) {
    console.warn(`[Weight] Could not save the weight history: ${err?.message || err}`);
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function trim(stored: any): StoredWeight {
  return {
    at: String(stored?.at || ''),
    changesetId: typeof stored?.changesetId === 'string' ? stored.changesetId : null,
    projectAt: typeof stored?.projectAt === 'string' ? stored.projectAt : null,
    projectBytes: numberOrNull(stored?.projectBytes) ?? 0,
    projectFileCount: numberOrNull(stored?.projectFileCount) ?? 0,
    projectTruncated: Boolean(stored?.projectTruncated),
    buildDir: typeof stored?.buildDir === 'string' ? stored.buildDir : null,
    buildBytes: numberOrNull(stored?.buildBytes),
    buildFileCount: numberOrNull(stored?.buildFileCount)
  };
}

/** The last measurement of this folder, or null when it has never been measured here. */
export function readWeightBaseline(root: string): StoredWeight | null {
  const stored = readFile().roots[keyFor(root)];
  if (!stored || typeof stored !== 'object') return null;
  return trim(stored);
}

/**
 * Records a measurement, keeping the half that this measurement does not cover: a write updates
 * the project numbers and leaves the build numbers from the last real build in place.
 */
export function writeWeightBaseline(
  root: string,
  patch: Partial<StoredWeight> & { at: string }
): void {
  const file = readFile();
  const key = keyFor(root);
  const previous = file.roots[key] ? trim(file.roots[key]) : null;

  file.roots[key] = {
    at: patch.at,
    changesetId: patch.changesetId ?? previous?.changesetId ?? null,
    projectAt: patch.projectAt !== undefined ? patch.projectAt : previous?.projectAt ?? null,
    projectBytes: patch.projectBytes ?? previous?.projectBytes ?? 0,
    projectFileCount: patch.projectFileCount ?? previous?.projectFileCount ?? 0,
    projectTruncated: patch.projectTruncated ?? previous?.projectTruncated ?? false,
    buildDir: patch.buildDir !== undefined ? patch.buildDir : previous?.buildDir ?? null,
    buildBytes: patch.buildBytes !== undefined ? patch.buildBytes : previous?.buildBytes ?? null,
    buildFileCount:
      patch.buildFileCount !== undefined ? patch.buildFileCount : previous?.buildFileCount ?? null
  };

  const entries = Object.entries(file.roots);
  if (entries.length > MAX_ROOTS) {
    entries
      .sort((a, b) => String(b[1]?.at || '').localeCompare(String(a[1]?.at || '')))
      .slice(MAX_ROOTS)
      .forEach(([stale]) => {
        delete file.roots[stale];
      });
  }

  writeFile(file);
}

/** Forgets one folder's history. */
export function clearWeightBaseline(root: string): void {
  const file = readFile();
  delete file.roots[keyFor(root)];
  writeFile(file);
}
