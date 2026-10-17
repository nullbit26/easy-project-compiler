import fs from 'fs';
import path from 'path';
import { requireWorkspaceRoot } from '../store/workspaceStore';
import { scanWorkspace } from './workspaceFiles';
import { readWeightBaseline, writeWeightBaseline } from '../store/weightBaseline';
import { readWeightBudget } from '../store/weightBudget';

/**
 * How heavy the change was.
 *
 * "The checks still pass" says nothing about the bill: an agent can leave a project working and
 * three times as heavy in a single batch. This answers two questions a person actually asks after
 * a write:
 *
 *  - **how big was this change** — the exact byte math of the batch, counted from the undo copies
 *    (what was there) and from disk (what is there now). This is exact, because it is the same
 *    write the user just reviewed;
 *  - **how big is the project now** — the folder's own files, and, when the folder's build check
 *    really ran, the size of its build output. The project number is a comparison against the last
 *    write, so it can also contain changes that were not made here; the difference is reported as
 *    `otherBytes` instead of being quietly attributed to the batch.
 *
 * Nothing is installed, nothing is bundled a second time and nothing leaves the machine: the
 * project number is the same walk the file list already does, and the build number is a directory
 * on disk that the project's own build script wrote.
 */

/** Growth worth pointing out: big in bytes and big relative to the project. */
const HEAVY_BYTES = 20_000;
const HEAVY_PCT = 20;

const MAX_DIR_FILES = 20_000;
const MAX_DIR_DEPTH = 12;

/** Where build output conventionally lands, most likely first. */
const BUILD_DIR_CANDIDATES = ['dist', 'build', 'out', '.output', 'public/build', 'public/dist', '.next'];

/**
 * One file of a batch that was just applied, as `applyFileChanges` reports it.
 *
 * Deliberately a plain shape: the sizes come from the same write that produced the undo copies,
 * so weighing a batch never needs a second look at the folder.
 */
export interface AppliedChange {
  path: string;
  action?: string;
  status?: string;
  /** What the file weighed before this write. */
  previousBytes?: number;
  /** What it weighs now. */
  sizeBytes?: number;
}

export interface WriteWeight {
  at: string;
  changesetId: string | null;
  /** Files this batch touched, with both sizes. */
  files: number;
  beforeBytes: number;
  afterBytes: number;
  netBytes: number;
  /** The file that grew the most, so the number has a name attached to it. */
  heaviest: { path: string; deltaBytes: number; afterBytes: number } | null;
  /** The folder as it now stands. */
  projectBytes: number;
  projectFileCount: number;
  /** True when the walk hit its cap: the size is then a floor, not a total. */
  projectTruncated: boolean;
  /** Change since the previous write in this folder, when there is one to compare with. */
  projectDeltaBytes: number | null;
  projectDeltaPct: number | null;
  /** Part of the project delta this batch cannot explain (hand edits, another tool, a build). */
  otherBytes: number | null;
  /** True when the project grew enough that it deserves a word. */
  heavy: boolean;
  note?: 'first_measurement';
}

export interface BuildWeight {
  at: string;
  dir: string;
  bytes: number;
  fileCount: number;
  truncated: boolean;
  /** Change since the previous build, when there was one to compare with. */
  deltaBytes: number | null;
  deltaPct: number | null;
  heavy: boolean;
  note?: 'first_measurement';
}

/**
 * The measured build output against the ceiling the project set for itself.
 *
 * A number nobody judges is a report; the same number in front of a ceiling is a check. When the
 * folder has no ceiling, `over` is null instead of false — "not over budget" and "no budget"
 * are different answers, and only one of them is good news.
 */
export interface BuildBudgetVerdict {
  /** The ceiling in bytes, or null when this folder has none. */
  bytes: number | null;
  /** What was measured, in bytes. */
  actual: number;
  /** True when the output is over the ceiling. Null when there is no ceiling to be over. */
  over: boolean | null;
  /** How far over (positive) or under (negative). Null without a ceiling. */
  deltaBytes: number | null;
  /** How much of the ceiling is used, in per cent. Null without a ceiling. */
  usedPct: number | null;
}

/** Judges one measured size against the folder's own ceiling. */
export function evaluateBuildBudget(input: { root?: string; actual: number }): BuildBudgetVerdict {
  const root = input.root || requireWorkspaceRoot();
  const actual = Math.max(0, Math.round(input.actual || 0));
  const budget = readWeightBudget(root);

  if (!budget) {
    return { bytes: null, actual, over: null, deltaBytes: null, usedPct: null };
  }

  return {
    bytes: budget.bytes,
    actual,
    over: actual > budget.bytes,
    deltaBytes: actual - budget.bytes,
    usedPct: Math.round((actual / budget.bytes) * 1000) / 10
  };
}

/**
 * The verdict for the folder as it stands, or null when its build was never measured here.
 *
 * Used right after the user writes a budget down: the answer to "is it already over?" has to
 * come from the last real build of this folder, not from a number invented on the spot.
 */
export function lastBuildBudgetVerdict(root?: string): BuildBudgetVerdict | null {
  const resolved = root || requireWorkspaceRoot();
  const stored = readWeightBaseline(resolved);
  if (typeof stored?.buildBytes !== 'number') return null;
  return evaluateBuildBudget({ root: resolved, actual: stored.buildBytes });
}

export interface DirMeasurement {
  bytes: number;
  fileCount: number;
  truncated: boolean;
}

/** Rounds a change to a percentage with one decimal, or null when there is nothing to divide by. */
export function percentChange(before: number, after: number): number | null {
  if (!Number.isFinite(before) || before <= 0) return null;
  const pct = ((after - before) / before) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.round(pct * 10) / 10;
}

function isHeavy(delta: number | null, pct: number | null): boolean {
  if (delta === null || delta < HEAVY_BYTES) return false;
  // Growing from nothing is heavy by definition; there is no percentage to consult.
  return pct === null || pct >= HEAVY_PCT;
}

/**
 * Whether the write deserves a word.
 *
 * With a previous measurement the question is about the project; without one, only the batch can
 * be judged — and then the wording says so, because "the project got heavier" is not something a
 * single batch can prove.
 */
function isWriteHeavy(projectDeltaBytes: number | null, projectDeltaPct: number | null, netBytes: number): boolean {
  if (projectDeltaBytes === null) return netBytes >= HEAVY_BYTES;
  return isHeavy(projectDeltaBytes, projectDeltaPct);
}

/** Total size of a directory as it is on disk. Symlinks and unreadable entries are skipped. */
export function measureDirectory(absoluteDir: string): DirMeasurement {
  let bytes = 0;
  let fileCount = 0;
  let truncated = false;

  const walk = (dir: string, depth: number) => {
    if (fileCount >= MAX_DIR_FILES || depth > MAX_DIR_DEPTH) {
      truncated = true;
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (fileCount >= MAX_DIR_FILES) {
        truncated = true;
        return;
      }
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        bytes += fs.statSync(absolute).size;
        fileCount += 1;
      } catch {
        // A file that vanished mid-walk is simply not counted.
      }
    }
  };

  walk(absoluteDir, 0);
  return { bytes, fileCount, truncated };
}

/** The build output folder this project keeps, if it keeps one. */
export function findBuildDir(root: string): string | null {
  for (const candidate of BUILD_DIR_CANDIDATES) {
    const absolute = path.join(root, ...candidate.split('/'));
    try {
      if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) return candidate;
    } catch {
      // An unreadable candidate is not a build output folder.
    }
  }
  return null;
}

/** The size of the project's own files, with the same walk (and the same ignore list) as the file list. */
export function measureProject(root?: string): {
  bytes: number;
  fileCount: number;
  truncated: boolean;
} {
  const scan = scanWorkspace();
  const bytes = scan.files.reduce((total, file) => total + (file.sizeBytes || 0), 0);
  return { bytes, fileCount: scan.files.length, truncated: scan.truncated };
}

/**
 * Measures a batch that was just written.
 *
 * `files` is expected to carry the size each file had before the write (taken from the undo copy)
 * and the size it has now — so the batch number is exact even when other things changed in the
 * folder at the same time.
 */
export async function measureWriteWeight(input: {
  changesetId: string | null;
  changes: AppliedChange[];
  root?: string;
}): Promise<WriteWeight> {
  const root = input.root || requireWorkspaceRoot();
  const at = new Date().toISOString();

  // A file that failed or was skipped was not written, so it has no weight to report.
  const clean = (Array.isArray(input.changes) ? input.changes : [])
    .filter(
      (entry) =>
        typeof entry?.path === 'string' &&
        entry.path.length > 0 &&
        entry.status !== 'failed' &&
        entry.status !== 'skipped'
    )
    .map((entry) => ({
      path: entry.path,
      beforeBytes: Math.max(0, Math.round(entry.previousBytes || 0)),
      afterBytes: entry.action === 'delete' ? 0 : Math.max(0, Math.round(entry.sizeBytes || 0))
    }));

  const beforeBytes = clean.reduce((total, file) => total + file.beforeBytes, 0);
  const afterBytes = clean.reduce((total, file) => total + file.afterBytes, 0);
  const grew = clean
    .map((file) => ({ ...file, deltaBytes: file.afterBytes - file.beforeBytes }))
    .filter((file) => file.deltaBytes > 0)
    .sort((a, b) => b.deltaBytes - a.deltaBytes);
  const heaviest = grew[0]
    ? { path: grew[0].path, deltaBytes: grew[0].deltaBytes, afterBytes: grew[0].afterBytes }
    : null;

  const project = measureProject(root);
  // Only a previous *project* measurement can be compared with. A folder whose build was just
  // measured has no project history yet, and "grew from 0 bytes" is not an answer.
  const stored = readWeightBaseline(root);
  const baseline = stored?.projectAt ? stored : null;

  const projectDeltaBytes = baseline ? project.bytes - baseline.projectBytes : null;
  const projectDeltaPct = baseline ? percentChange(baseline.projectBytes, project.bytes) : null;
  // What the batch did not do. Shown instead of being folded into "this change added N bytes".
  const otherBytes =
    projectDeltaBytes === null ? null : projectDeltaBytes - (afterBytes - beforeBytes);

  const weight: WriteWeight = {
    at,
    changesetId: input.changesetId,
    files: clean.length,
    beforeBytes,
    afterBytes,
    netBytes: afterBytes - beforeBytes,
    heaviest,
    projectBytes: project.bytes,
    projectFileCount: project.fileCount,
    projectTruncated: project.truncated,
    projectDeltaBytes,
    projectDeltaPct,
    otherBytes,
    heavy: isWriteHeavy(projectDeltaBytes, projectDeltaPct, afterBytes - beforeBytes),
    ...(baseline ? {} : { note: 'first_measurement' as const })
  };

  writeWeightBaseline(root, {
    at,
    changesetId: input.changesetId,
    projectAt: at,
    projectBytes: project.bytes,
    projectFileCount: project.fileCount,
    projectTruncated: project.truncated
  });

  return weight;
}

/**
 * Measures the folder's build output.
 *
 * Called only after the folder's own build check ran, so the number belongs to *this* build: a
 * `dist/` left over from an earlier run is never compared with itself and reported as unchanged.
 * Returns null when the folder keeps no build output, because then there is nothing to say.
 */
export async function measureBuildWeight(input: {
  changesetId: string | null;
  root?: string;
}): Promise<BuildWeight | null> {
  const root = input.root || requireWorkspaceRoot();
  const dir = findBuildDir(root);
  if (!dir) return null;

  const measured = measureDirectory(path.join(root, ...dir.split('/')));
  // An existing but empty folder is not a build output.
  if (measured.fileCount === 0) return null;

  const at = new Date().toISOString();
  const baseline = readWeightBaseline(root);
  const before = baseline?.buildBytes ?? null;
  const deltaBytes = typeof before === 'number' ? measured.bytes - before : null;
  const deltaPct = typeof before === 'number' ? percentChange(before, measured.bytes) : null;

  const weight: BuildWeight = {
    at,
    dir,
    bytes: measured.bytes,
    fileCount: measured.fileCount,
    truncated: measured.truncated,
    deltaBytes,
    deltaPct,
    heavy: isHeavy(deltaBytes, deltaPct),
    ...(typeof before === 'number' ? {} : { note: 'first_measurement' as const })
  };

  writeWeightBaseline(root, { at, changesetId: input.changesetId, buildDir: dir, buildBytes: measured.bytes, buildFileCount: measured.fileCount });

  return weight;
}
