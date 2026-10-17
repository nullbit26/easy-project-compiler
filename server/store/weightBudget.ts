import fs from 'fs';
import path from 'path';

/**
 * The ceiling a project puts on itself.
 *
 * Measuring the weight answers "how heavy is it?"; a budget is the question a person actually
 * asks after that: "and is that allowed?". One number per folder — the size the folder's build
 * output may not exceed — written down once and then checked every time the build really runs.
 *
 * Two rules keep it honest:
 *  - it is one number in bytes, parsed from what the user typed ("500 KB", "1.5 MB", "400000");
 *  - it lives next to the app, never inside the user's project, and losing it costs nothing but
 *    the check itself.
 */

const MAX_ROOTS = 8;

/** Anything smaller than a kilobyte is not a page budget, it is a typo. */
const MIN_BUDGET_BYTES = 1024;
const MAX_BUDGET_BYTES = 2 * 1024 * 1024 * 1024;

export interface StoredBudget {
  /** The ceiling in bytes. */
  bytes: number;
  /** When the user wrote it down. */
  setAt: string;
}

interface BudgetFile {
  version: 1;
  roots: Record<string, StoredBudget>;
}

/** A budget the user typed that cannot be read as a size. */
export class BudgetError extends Error {
  constructor(public code: 'invalid_budget', message: string) {
    super(message);
    this.name = 'BudgetError';
  }
}

/** Tests point this at a temp file so they never touch the developer's own settings. */
export function getBudgetPath(): string {
  return process.env.EPC_BUDGET_FILE || path.join(process.cwd(), 'data', 'budget.json');
}

function keyFor(root: string): string {
  return path.resolve(root);
}

function readFile(): BudgetFile {
  try {
    const filePath = getBudgetPath();
    if (!fs.existsSync(filePath)) return { version: 1, roots: {} };
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { version: 1, roots: parsed?.roots && typeof parsed.roots === 'object' ? parsed.roots : {} };
  } catch {
    // A damaged file means one folder without a budget, which is a normal state.
    console.warn('[Budget] Could not read the saved weight budget, starting fresh.');
    return { version: 1, roots: {} };
  }
}

function writeFile(file: BudgetFile): void {
  try {
    const filePath = getBudgetPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, { encoding: 'utf8' });
  } catch (err: any) {
    console.warn(`[Budget] Could not save the weight budget: ${err?.message || err}`);
  }
}

/**
 * Reads what the user typed into a ceiling in bytes.
 *
 * `null` means "no budget" — an empty field clears the ceiling. Anything else has to be a size,
 * and a size the person wrote in a unit they understand: bytes, KB or MB, with either separator.
 */
export function parseBudgetBytes(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLowerCase();
  if (!text) return null;

  const match = text.match(/^(\d+(?:[.,]\d+)?)\s*(b|кб|kb|кб|m|mb|мб|мб)?$/);
  if (!match) {
    throw new BudgetError('invalid_budget', 'Write the budget as a size, for example "500 KB" or "1 MB".');
  }

  const amount = Number.parseFloat(match[1].replace(',', '.'));
  const unit = match[2] || 'b';
  const factor = unit === 'mb' || unit === 'мб' || unit === 'm' ? 1024 * 1024 : unit === 'b' ? 1 : 1024;
  // Bytes are the one unit where a fractional number makes no sense.
  const bytes = unit === 'b' ? Math.round(amount) : Math.round(amount * factor);

  if (!Number.isFinite(bytes) || bytes < MIN_BUDGET_BYTES) {
    throw new BudgetError('invalid_budget', 'That budget is too small to mean anything — the smallest is 1 KB.');
  }
  if (bytes > MAX_BUDGET_BYTES) {
    throw new BudgetError('invalid_budget', 'That budget is larger than this app will ever measure.');
  }
  return bytes;
}

/** The ceiling this folder put on itself, or null when it has none. */
export function readWeightBudget(root: string): StoredBudget | null {
  const stored = readFile().roots[keyFor(root)];
  const bytes = Number(stored?.bytes);
  if (!Number.isFinite(bytes) || bytes < MIN_BUDGET_BYTES) return null;
  return { bytes, setAt: String(stored?.setAt || '') };
}

/** Writes the ceiling down, or removes it when `bytes` is null. */
export function writeWeightBudget(root: string, bytes: number | null): StoredBudget | null {
  const file = readFile();
  const key = keyFor(root);

  if (bytes === null) {
    delete file.roots[key];
    writeFile(file);
    return null;
  }

  const stored: StoredBudget = { bytes, setAt: new Date().toISOString() };
  file.roots[key] = stored;

  const entries = Object.entries(file.roots);
  if (entries.length > MAX_ROOTS) {
    entries
      .sort((a, b) => String(b[1]?.setAt || '').localeCompare(String(a[1]?.setAt || '')))
      .slice(MAX_ROOTS)
      .forEach(([stale]) => {
        delete file.roots[stale];
      });
  }

  writeFile(file);
  return stored;
}
