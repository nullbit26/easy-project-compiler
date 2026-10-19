/**
 * The files a card is told to work on.
 *
 * A card already carries `relevantFiles` — the plan's guess at what the work touches. This module
 * is the other direction: a file the user picked, dropped on the card, which is a fact rather than
 * a guess. It is kept apart from the component so the merge rules can be tested without a browser:
 * the limit, the de-duplication and the path clean-up are the parts that are easy to get subtly wrong.
 */

/** How many picked files one card holds. A prompt that names forty files names none of them. */
export const MAX_TASK_FILES = 8;

/** The drag type the board and the file trees agree on. A path, not a payload. */
export const TASK_FILE_DRAG_TYPE = 'application/x-task-file';

/**
 * A dropped path, made into something the plan can hold.
 *
 * Browsers hand over what the drag source put on the clipboard, so this accepts the shapes a file
 * row can plausibly produce: a bare path, a `file://` URL from the desktop, or a quoted path copied
 * from a terminal. Anything that is not a path — a paragraph, an empty line, a URL to a web page —
 * comes back `null` rather than becoming a file the plan cannot open.
 */
export function cleanTaskFilePath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  let value = raw.trim();
  // A drag source may send a URI list; the first entry is the file that was dragged.
  if (value.includes('\n')) value = value.split(/\r?\n/).find((line) => line.trim() && !line.startsWith('#')) || '';
  value = value.trim();
  if (!value || value.length > 400) return null;
  if (/^(https?|mailto|data):/i.test(value)) return null;

  value = value.replace(/^['"]|['"]$/g, '');

  if (/^file:\/\//i.test(value)) {
    // `file:///C:/repo/src/App.tsx` → `C:/repo/src/App.tsx`.
    value = value.slice('file://'.length);
    if (value.startsWith('/') && /^\/[a-zA-Z]:\//.test(value)) value = value.slice(1);
    try {
      value = decodeURIComponent(value);
    } catch {
      // A path with a stray `%` is still a path; keep it as it was written.
    }
  }

  // A trailing separator says the drag was a folder. A card compiles a file, so a folder is not
  // a near miss to be guessed at — it is not a file, and nothing is added.
  if (/[\\/]$/.test(value)) return null;

  value = value.replace(/\\/g, '/');
  // `./src/App.tsx` and `src/App.tsx` are one file as far as the plan is concerned.
  while (value.startsWith('./')) value = value.slice(2);
  if (!value || value === '.' || value.startsWith('/') || /^[a-zA-Z]:$/.test(value)) return null;

  // A path with no name in it is a folder or a mistake — a card can only compile code from a file.
  const name = value.split('/').pop() || '';
  if (!name || name === '.' || name === '..') return null;

  return value;
}

/**
 * The card's list with `added` appended, without repeats and capped at {@link MAX_TASK_FILES}.
 *
 * The oldest pick is the one that falls off, not the newest: the file the user just dropped is the
 * one they are looking at.
 */
export function mergeTaskFiles(
  current: readonly string[] | undefined,
  added: readonly string[],
  limit: number = MAX_TASK_FILES
): string[] {
  const next: string[] = [];
  const seen = new Set<string>();

  for (const raw of [...(current || []), ...added]) {
    const path = cleanTaskFilePath(raw);
    if (!path) continue;
    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(path);
  }

  return next.slice(-Math.max(1, limit));
}

/**
 * The paths inside a drop. A drag source writes the typed format and a plain-text copy, so the
 * board can be reached from the file tree of this app and from anything else that drags a path.
 */
export function taskFilePathsFromDrop(read: (type: string) => string): string[] {
  const raw =
    read(TASK_FILE_DRAG_TYPE) || read('text/plain') || read('text/uri-list');
  if (!raw) return [];

  return raw
    .split(/\r?\n/)
    .map((line) => cleanTaskFilePath(line))
    .filter((path): path is string => Boolean(path));
}

/** The card's list without one file. Removing what is not there changes nothing. */
export function removeTaskFile(current: readonly string[] | undefined, path: string): string[] {
  const clean = cleanTaskFilePath(path);
  if (!clean) return [...(current || [])];
  return (current || []).filter((candidate) => cleanTaskFilePath(candidate)?.toLowerCase() !== clean.toLowerCase());
}
