/**
 * Turns the raw text a build/test/typecheck command prints into a short list of problems,
 * each with a file, a line and a message.
 *
 * This is what closes the verification loop: without it the app could only say "the check
 * failed", and the model (and the user) would have to guess which line to fix.
 *
 * The parser is deliberately forgiving: every tool prints its own dialect, so it tries the
 * known dialects in order and falls back to "a line that mentions an error".
 */

export type ProblemSeverity = 'error' | 'warning';

export interface CheckProblem {
  /** File the problem points at, relative to the project folder when possible. */
  file?: string;
  line?: number;
  column?: number;
  /** Tool-specific code such as TS2339 or CS1002. */
  code?: string;
  severity: ProblemSeverity;
  message: string;
  /** The original line, so the user can always see the tool's own wording. */
  raw: string;
  /**
   * Filled in by the comparison with the previous run (`verificationDelta.ts`), never by the
   * parser: whether this problem is new in this run or was already there in the previous one.
   * Undefined when there was nothing to compare against.
   */
  change?: 'new' | 'persistent';
}

export interface ParseOptions {
  /** Absolute project folder — absolute file paths inside it are made relative. */
  root?: string;
  /** Upper bound on returned problems (default 60). */
  limit?: number;
}

/** Removes colour codes so `tsc --pretty` output stays parseable. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

// src/App.tsx(28,14): error TS2339: Property 'x' does not exist on type 'Y'.
const PAREN_STYLE = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+([A-Za-z]{1,4}\d+)?:?\s*(.*)$/;
// src/App.tsx:28:14 - error TS2339: ...
const DASH_STYLE = /^(.+?):(\d+):(\d+)\s*-\s*(error|warning)\s+([A-Za-z]{1,4}\d+)?:?\s*(.*)$/;
// src/App.tsx:28:14: ERROR: Unexpected token
const COLON_STYLE = /^(.+?):(\d+):(\d+):\s*(.*)$/;
// src/main.js:3:5 warning: unused variable leftover — a location, then the severity itself. This is
// the shape a linter prints when it exits 0: the run is green, and the finding is still real.
const LOCATION_SEVERITY = /^(.+?):(\d+):(\d+)\s+(error|warning)\b:?\s*(.*)$/;
// src/App.tsx:28: message (webpack/python-ish, no column)
const LINE_STYLE = /^(.+?):(\d+):\s*(.*)$/;
// C:\project\src\game.js:12 — a path and a line number and nothing else, which is how node's
// syntax check (and several bundlers) announce a syntax error before printing the reason.
const BARE_PATH_LINE = /^(.+?):(\d+)$/;
// File "app/main.py", line 42, in handler
const PY_TRACEBACK = /^File "(.+)", line (\d+)(?:, in .*)?$/;
// FAILED tests/test_api.py::test_login - AssertionError: assert 401 == 200
const PYTEST_FAILURE = /^(FAILED|ERROR)\s+(\S+?)(?:::(\S+))?\s*(?:-\s*(.*))?$/;
// FAIL src/a.test.ts > suite > the test name — jest and vitest verbose reporters.
const FAIL_LINE = /^FAIL\s+(\S+?)(?:\s*>\s*(.+))?$/;
//   × the test name — how vitest and jest mark one failed test. The test's own name is the
// part worth repeating: "the suite failed" tells the user nothing they can act on.
const TEST_MARK_LINE = /^[×✕✗]\s+(.+)$/;
//   28:14  error  'x' is assigned but never used  no-unused-vars
const ESLINT_STYLE = /^(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}(\S+))?$/;
/**
 * Lines that merely mention errors without being one: "0 errors", "found 2 problems", and npm's
 * own notices — which include the command being run, so a linter's finding is echoed there word for
 * word before the linter itself prints it.
 */
const NOISE = /(\b0\s+errors?\b|^found \d+|^watching|^> |^npm (notice|warn)\b|^\s*$|^\s*\^+$|^\s*\|)/i;

function looksLikeFile(value: string): boolean {
  if (!value) return false;
  if (/^(https?:|[A-Za-z]+:\/\/)/.test(value)) return false;
  // Reject prose that ends with a colon such as "Error:" or "src/App.tsx:28:14: ERROR:".
  if (/\s(error|warning|note)\b/i.test(value)) return false;
  return /[\\/]/.test(value) || /\.[A-Za-z0-9]{1,8}$/.test(value);
}

function normalizePath(file: string, root?: string): string {
  let value = file.trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/');
  if (value.startsWith('./')) value = value.slice(2);
  if (root) {
    const absoluteRoot = root.replace(/\\/g, '/').replace(/\/$/, '');
    if (value.toLowerCase().startsWith(`${absoluteRoot.toLowerCase()}/`)) {
      value = value.slice(absoluteRoot.length + 1);
    }
  }
  return value;
}

function severityFrom(text: string): ProblemSeverity {
  if (/\bwarning\b/i.test(text) || /\bwarn\b/i.test(text)) return 'warning';
  return 'error';
}

function makeProblem(
  raw: string,
  parts: { file?: string; line?: number; column?: number; code?: string; message: string },
  options: ParseOptions
): CheckProblem {
  return {
    file: parts.file ? normalizePath(parts.file, options.root) : undefined,
    line: parts.line,
    column: parts.column,
    code: parts.code,
    severity: severityFrom(raw),
    message: parts.message.trim() || raw.trim(),
    raw: raw.trim()
  };
}

/**
 * Parses one tool's output. Lines that carry no location are kept only when they clearly
 * describe a failure, so the list stays readable instead of echoing the whole log.
 */
export function parseCheckOutput(output: string, options: ParseOptions = {}): CheckProblem[] {
  const limit = options.limit ?? 60;
  const lines = stripAnsi(output || '').split(/\r?\n/);
  const problems: CheckProblem[] = [];
  let lastFile: string | undefined;

  const push = (problem: CheckProblem) => {
    if (problems.length >= limit) return;
    const duplicate = problems.some((existing) => {
      if (existing.message !== problem.message) return false;
      if (existing.file !== problem.file) return false;
      // One dialect can describe the same failure twice — once with a location, then again as a
      // bare reason line below it. The located copy is the useful one, so the other is dropped.
      return existing.line === problem.line || existing.line == null || problem.line == null;
    });
    if (!duplicate) problems.push(problem);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || NOISE.test(trimmed)) continue;

    let match = trimmed.match(PAREN_STYLE);
    if (match && looksLikeFile(match[1])) {
      lastFile = match[1];
      push(
        makeProblem(trimmed, {
          file: match[1],
          line: Number(match[2]),
          column: Number(match[3]),
          code: match[5],
          message: match[6]
        }, options)
      );
      continue;
    }

    match = trimmed.match(DASH_STYLE);
    if (match && looksLikeFile(match[1])) {
      lastFile = match[1];
      push(
        makeProblem(trimmed, {
          file: match[1],
          line: Number(match[2]),
          column: Number(match[3]),
          code: match[5],
          message: match[6]
        }, options)
      );
      continue;
    }

    match = trimmed.match(COLON_STYLE);
    if (match && looksLikeFile(match[1])) {
      lastFile = match[1];
      push(
        makeProblem(trimmed, {
          file: match[1],
          line: Number(match[2]),
          column: Number(match[3]),
          message: match[4]
        }, options)
      );
      continue;
    }

    match = trimmed.match(LOCATION_SEVERITY);
    if (match && looksLikeFile(match[1])) {
      lastFile = match[1];
      push(
        makeProblem(trimmed, {
          file: match[1],
          line: Number(match[2]),
          column: Number(match[3]),
          message: match[5]
        }, options)
      );
      continue;
    }

    match = trimmed.match(PY_TRACEBACK);
    if (match) {
      const detail = (lines[index + 1] || '').trim();
      lastFile = match[1];
      push(
        makeProblem(trimmed, {
          file: match[1],
          line: Number(match[2]),
          message: detail && !DASH_STYLE.test(detail) ? detail : 'Exception raised here.'
        }, options)
      );
      continue;
    }

    match = trimmed.match(PYTEST_FAILURE);
    if (match) {
      const target = match[2];
      const filePart = target.includes('::') ? target.split('::')[0] : target;
      push(
        makeProblem(trimmed, {
          file: filePart,
          message: [match[3], match[4]].filter(Boolean).join(' — ') || match[1]
        }, options)
      );
      continue;
    }

    match = trimmed.match(FAIL_LINE);
    if (match && looksLikeFile(match[1])) {
      lastFile = match[1];
      push(
        makeProblem(trimmed, {
          file: match[1],
          message: match[2] ? `Failed test: ${match[2]}` : 'Failed test file (see the output for details)'
        }, options)
      );
      continue;
    }

    match = trimmed.match(TEST_MARK_LINE);
    if (match) {
      push(
        makeProblem(trimmed, {
          file: lastFile,
          message: `Failed test: ${match[1]}`
        }, options)
      );
      continue;
    }

    match = trimmed.match(ESLINT_STYLE);
    if (match && lastFile) {
      push(
        makeProblem(trimmed, {
          file: lastFile,
          line: Number(match[1]),
          column: Number(match[2]),
          code: match[5],
          message: match[4]
        }, options)
      );
      continue;
    }

    // Path with a line but no column: keep the file for later context too.
    match = trimmed.match(LINE_STYLE);
    if (match && looksLikeFile(match[1]) && /\b(error|warning|failed|exception)\b/i.test(match[3])) {
      lastFile = match[1];
      push(
        makeProblem(trimmed, { file: match[1], line: Number(match[2]), message: match[3] }, options)
      );
      continue;
    }

    /**
     * A path and a line number on their own, which is how node reports a syntax error:
     *
     *     C:\project\src\game.js:12
     *     }
     *     ^
     *     SyntaxError: Unexpected token '}'
     *
     * The reason is two lines further down, and the caret position is the column — without this
     * the app could say that the check failed but not which file or line to repair, and the
     * model would be asked to fix "something" in a folder it cannot search.
     */
    match = trimmed.match(BARE_PATH_LINE);
    if (match && looksLikeFile(match[1])) {
      // The printed source line, the caret and the reason follow, but the reason is not always
      // adjacent (node puts an empty line between them), so the next few lines are scanned.
      let source = '';
      let reason = '';
      let column: number | undefined;
      for (let ahead = index + 1; ahead <= index + 4 && ahead < lines.length; ahead += 1) {
        const candidate = lines[ahead].trim();
        if (!candidate) continue;
        if (candidate.startsWith('^')) {
          if (column === undefined) column = candidate.indexOf('^') + 1;
          continue;
        }
        if (
          /^[A-Za-z_$][\w$.]*(Error|Exception)\b/.test(candidate) ||
          /^(error|fatal|failed)\b[:\s]/i.test(candidate)
        ) {
          reason = candidate;
          break;
        }
        if (!source) source = candidate;
      }

      lastFile = match[1];
      // `raw` is the tool's own wording, and the reason is the part worth repeating; the absolute
      // path above it is the part that must not travel into the UI or into a prompt.
      push(
        makeProblem(reason || trimmed, {
          file: match[1],
          line: Number(match[2]),
          column,
          message: reason || source || trimmed
        }, options)
      );
      continue;
    }

    // A bare file path on its own line: eslint's stylish reporter prints one per file, and the
    // findings that follow belong to it.
    if (!/[\s:]/.test(trimmed) && looksLikeFile(trimmed)) {
      lastFile = trimmed;
      continue;
    }

    // A plain failure line ("AssertionError: ...", "TypeError: ...", "error: ...").
    if (/^[A-Za-z_$][\w$.]*(Error|Exception)\b/.test(trimmed) || /^(error|fatal|failed)\b[:\s]/i.test(trimmed)) {
      push(makeProblem(trimmed, { file: lastFile, message: trimmed }, options));
    }
  }

  return problems;
}

export function summarizeProblems(problems: CheckProblem[]): { errors: number; warnings: number } {
  return {
    errors: problems.filter((problem) => problem.severity === 'error').length,
    warnings: problems.filter((problem) => problem.severity === 'warning').length
  };
}

/**
 * Keeps a command's output readable and bounded: the head (where tools usually explain
 * themselves) plus the tail (where they usually print the failure).
 */
export function capOutput(text: string, headSize = 20_000, tailSize = 40_000): { text: string; truncated: boolean } {
  const clean = stripAnsi(text || '');
  if (clean.length <= headSize + tailSize) return { text: clean, truncated: false };
  const head = clean.slice(0, headSize);
  const tail = clean.slice(clean.length - tailSize);
  return {
    text: `${head}\n\n… [${clean.length - headSize - tailSize} characters omitted] …\n\n${tail}`,
    truncated: true
  };
}
