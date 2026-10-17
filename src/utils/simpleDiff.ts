export type DiffLineType = 'same' | 'add' | 'del';

export interface DiffLine {
  type: DiffLineType;
  text: string;
  /** Line number in the old file (1-based), absent for added lines. */
  oldNumber?: number;
  /** Line number in the new file (1-based), absent for removed lines. */
  newNumber?: number;
}

const MAX_DP_CELLS = 1_200_000;

/**
 * Line diff used by the review screen so the user can see exactly what the AI wants to
 * write into each file. Deliberately small and dependency-free: an LCS table with the
 * identical prefix/suffix trimmed away first, and a plain "replaced" fallback for files
 * that are too large for the table.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = (oldText ?? '').split('\n');
  const newLines = (newText ?? '').split('\n');

  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix);
  const newMiddle = newLines.slice(prefix, newLines.length - suffix);

  const result: DiffLine[] = [];
  for (let i = 0; i < prefix; i++) {
    result.push({ type: 'same', text: oldLines[i], oldNumber: i + 1, newNumber: i + 1 });
  }

  if (oldMiddle.length * newMiddle.length > MAX_DP_CELLS) {
    oldMiddle.forEach((text, i) => result.push({ type: 'del', text, oldNumber: prefix + i + 1 }));
    newMiddle.forEach((text, i) => result.push({ type: 'add', text, newNumber: prefix + i + 1 }));
  } else {
    // lengths table (LCS)
    const rows = oldMiddle.length + 1;
    const cols = newMiddle.length + 1;
    const table: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

    for (let i = oldMiddle.length - 1; i >= 0; i--) {
      for (let j = newMiddle.length - 1; j >= 0; j--) {
        table[i][j] =
          oldMiddle[i] === newMiddle[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }

    let i = 0;
    let j = 0;
    while (i < oldMiddle.length && j < newMiddle.length) {
      if (oldMiddle[i] === newMiddle[j]) {
        result.push({ type: 'same', text: oldMiddle[i], oldNumber: prefix + i + 1, newNumber: prefix + j + 1 });
        i += 1;
        j += 1;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        result.push({ type: 'del', text: oldMiddle[i], oldNumber: prefix + i + 1 });
        i += 1;
      } else {
        result.push({ type: 'add', text: newMiddle[j], newNumber: prefix + j + 1 });
        j += 1;
      }
    }
    while (i < oldMiddle.length) {
      result.push({ type: 'del', text: oldMiddle[i], oldNumber: prefix + i + 1 });
      i += 1;
    }
    while (j < newMiddle.length) {
      result.push({ type: 'add', text: newMiddle[j], newNumber: prefix + j + 1 });
      j += 1;
    }
  }

  for (let k = suffix; k > 0; k--) {
    const oldIndex = oldLines.length - k;
    const newIndex = newLines.length - k;
    result.push({ type: 'same', text: oldLines[oldIndex], oldNumber: oldIndex + 1, newNumber: newIndex + 1 });
  }

  return result;
}

/** Adds/removals only — used for the "3 added, 1 removed" badge. */
export function diffStat(lines: DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((l) => l.type === 'add').length,
    removed: lines.filter((l) => l.type === 'del').length
  };
}

/** Keeps the review readable: only changed lines plus `context` lines around them. */
export function diffHunks(lines: DiffLine[], context = 3, maxLines = 400): DiffLine[] {
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.type === 'same') return;
    for (let i = index - context; i <= index + context; i++) {
      if (i >= 0 && i < lines.length) keep.add(i);
    }
  });
  const picked = lines.filter((_, index) => keep.has(index));
  if (picked.length <= maxLines) return picked;
  return [
    ...picked.slice(0, Math.floor(maxLines / 2)),
    { type: 'same', text: '…' },
    ...picked.slice(picked.length - Math.floor(maxLines / 2))
  ];
}
