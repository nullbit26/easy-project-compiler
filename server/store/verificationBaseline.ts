import fs from 'fs';
import path from 'path';
import type { StoredSnapshot } from '../utils/verificationDelta';

/**
 * Remembers the last verification run of each connected folder, so the *next* run can say what
 * changed instead of only what is broken.
 *
 * It lives next to the app (like the backups and the checkpoints), never inside the user's
 * project, and it is deliberately small: one entry per folder, capped problems, capped message
 * length. Losing it costs nothing but a comparison — the checks themselves are unaffected.
 */

const MAX_ROOTS = 8;
const MAX_PROBLEMS = 150;
const MAX_MESSAGE_CHARS = 400;

interface BaselineFile {
  version: 1;
  roots: Record<string, StoredSnapshot>;
}

/** Tests point this at a temp file so they never read or write the developer's own history. */
export function getVerificationBaselinePath(): string {
  return process.env.EPC_VERIFICATION_FILE || path.join(process.cwd(), 'data', 'verification.json');
}

function keyFor(root: string): string {
  return path.resolve(root);
}

function readFile(): BaselineFile {
  try {
    const filePath = getVerificationBaselinePath();
    if (!fs.existsSync(filePath)) return { version: 1, roots: {} };
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const roots = parsed?.roots && typeof parsed.roots === 'object' ? parsed.roots : {};
    return { version: 1, roots };
  } catch {
    // A damaged history is not worth an error message: the worst case is one run without a
    // comparison, and the next run writes a fresh baseline.
    console.warn('[Checks] Could not read the saved verification history, starting fresh.');
    return { version: 1, roots: {} };
  }
}

function writeFile(file: BaselineFile): void {
  try {
    const filePath = getVerificationBaselinePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, { encoding: 'utf8' });
  } catch (err: any) {
    console.warn(`[Checks] Could not save the verification history: ${err?.message || err}`);
  }
}

function trim(snapshot: StoredSnapshot): StoredSnapshot {
  return {
    ranAt: snapshot.ranAt,
    changesetId: snapshot.changesetId,
    checks: snapshot.checks.slice(0, 20),
    problems: snapshot.problems.slice(0, MAX_PROBLEMS).map((problem) => ({
      ...problem,
      message: problem.message.slice(0, MAX_MESSAGE_CHARS)
    }))
  };
}

/** The last run recorded for this folder, or null when it has never been checked here. */
export function readVerificationBaseline(root: string): StoredSnapshot | null {
  const stored = readFile().roots[keyFor(root)];
  if (!stored || typeof stored !== 'object' || !Array.isArray(stored.checks)) return null;
  return trim({
    ranAt: String(stored.ranAt || ''),
    changesetId: stored.changesetId ?? null,
    checks: stored.checks,
    problems: Array.isArray(stored.problems) ? stored.problems : []
  });
}

/** Records this run as the state the next run will be compared against. */
export function writeVerificationBaseline(root: string, snapshot: StoredSnapshot): void {
  const file = readFile();
  file.roots[keyFor(root)] = trim(snapshot);

  const entries = Object.entries(file.roots);
  if (entries.length > MAX_ROOTS) {
    entries
      .sort((a, b) => String(b[1]?.ranAt || '').localeCompare(String(a[1]?.ranAt || '')))
      .slice(MAX_ROOTS)
      .forEach(([key]) => {
        delete file.roots[key];
      });
  }

  writeFile(file);
}

/** Forgets the history of one folder (used when a different folder is connected). */
export function clearVerificationBaseline(root: string): void {
  const file = readFile();
  delete file.roots[keyFor(root)];
  writeFile(file);
}
