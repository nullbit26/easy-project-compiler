import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { requireWorkspaceRoot, resolveWorkspacePath } from '../store/workspaceStore';

/**
 * Tidying up the files the agent just wrote.
 *
 * The pattern in the market is not a rejection gate but a feedback loop: a hook formats the file
 * that was edited (Claude Code documents exactly that with `prettier --write`), and the checks
 * afterwards run against tidy code. This is that hook, built in.
 *
 * Three rules keep it honest:
 *  - **only what the project already has.** The formatter has to exist inside the folder as a
 *    local binary, and the one the project declares in `package.json` wins over one that merely
 *    happens to be installed. Nothing is installed and nothing is fetched.
 *  - **only the files the app just wrote.** The list comes from the write that preceded it, so a
 *    run never reformats the user's whole repository as a side effect.
 *  - **never a failure of the write.** If the formatter is missing, slow or unhappy, the files
 *    stay exactly as they were written and the screen is told what happened.
 */

export type FormatterId = 'prettier' | 'biome' | 'ruff';
export type FormatterNote = 'no_files' | 'no_formatter' | 'nothing_to_format';

export interface FormattingResult {
  /** True when a formatter was found and actually started. */
  ran: boolean;
  tool: FormatterId | null;
  toolLabel: string | null;
  commandLine: string | null;
  /** Files the formatter was given. */
  files: string[];
  /** Files the formatter actually rewrote — the only thing worth showing the user. */
  changed: string[];
  /** Files the formatter was not asked about, and why they were left out. */
  skipped: string[];
  error?: string;
  note?: FormatterNote;
  durationMs: number;
}

/** What the timeline keeps about one tidy-up, so the history stays readable. */
export interface FormattingSummary {
  at: string;
  tool: string;
  changed: number;
  files: number;
  error?: string;
}

/** The one-line version of a tidy-up for the timeline, or null when nothing ran. */
export function summarizeFormatting(result: FormattingResult): FormattingSummary | null {
  if (!result.ran || !result.toolLabel) return null;
  return {
    at: new Date().toISOString(),
    tool: result.toolLabel,
    changed: result.changed.length,
    files: result.files.length,
    ...(result.error ? { error: result.error } : {})
  };
}

interface FormatterDefinition {
  id: FormatterId;
  label: string;
  /** How the tool is started: a JS entry point through node, or a binary of its own. */
  runner: 'node' | 'direct';
  /** Paths inside the folder, best first. */
  entryPoints: string[];
  /** Package names that mean "this project uses this formatter". */
  packages: string[];
  /** Config file names that mean the same. */
  configFiles: string[];
  /** Extensions the tool is responsible for; null hands it everything it can read. */
  extensions: string[] | null;
  args: (files: string[]) => string[];
}

const MAX_FORMAT_FILES = 40;
const MAX_FORMAT_FILE_BYTES = 400_000;
const FORMAT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 20_000;

const FORMATTERS: FormatterDefinition[] = [
  {
    id: 'prettier',
    label: 'Prettier',
    runner: 'node',
    entryPoints: ['node_modules/prettier/bin/prettier.cjs', 'node_modules/prettier/bin-prettier.js'],
    packages: ['prettier'],
    configFiles: ['.prettierrc', '.prettierrc.json', '.prettierrc.yml', '.prettierrc.yaml', '.prettierrc.js', '.prettierrc.cjs', 'prettier.config.js', 'prettier.config.cjs'],
    // Prettier knows its own list of languages; --ignore-unknown makes it skip the rest instead
    // of failing on a file it cannot read.
    extensions: null,
    args: (files) => ['--write', '--ignore-unknown', '--log-level', 'warn', ...files]
  },
  {
    id: 'biome',
    label: 'Biome',
    runner: 'node',
    entryPoints: ['node_modules/@biomejs/biome/bin/biome'],
    packages: ['@biomejs/biome'],
    configFiles: ['biome.json', 'biome.jsonc'],
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.jsonc', '.css'],
    args: (files) => ['format', '--write', ...files]
  },
  {
    id: 'ruff',
    label: 'Ruff',
    runner: 'direct',
    entryPoints: [
      '.venv/Scripts/ruff.exe',
      '.venv/bin/ruff',
      'venv/Scripts/ruff.exe',
      'venv/bin/ruff',
      'node_modules/.bin/ruff.exe',
      'node_modules/.bin/ruff'
    ],
    packages: ['ruff'],
    configFiles: ['ruff.toml', '.ruff.toml'],
    extensions: ['.py', '.pyi'],
    args: (files) => ['format', ...files]
  }
];

function exists(target: string): boolean {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

function readPackageDependencies(root: string): Set<string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return new Set([
      ...Object.keys(parsed?.dependencies || {}),
      ...Object.keys(parsed?.devDependencies || {})
    ]);
  } catch {
    return new Set();
  }
}

interface DetectedFormatter extends FormatterDefinition {
  entryPoint: string;
}

/**
 * Which formatter this project uses.
 *
 * A tool the project declares in `package.json` beats one that merely has a config file, and a
 * config file beats a binary that came in with something else — otherwise a folder with both
 * Prettier (transitively installed) and Biome (declared) would be formatted by the wrong tool.
 */
export function detectFormatter(root: string = requireWorkspaceRoot()): DetectedFormatter | null {
  const dependencies = readPackageDependencies(root);
  let best: { formatter: DetectedFormatter; score: number } | null = null;

  for (const formatter of FORMATTERS) {
    const entryPoint = formatter.entryPoints.find((candidate) => exists(path.join(root, candidate)));
    // Without a local binary the formatter cannot be started at all, so it does not matter how
    // the project feels about it.
    if (!entryPoint) continue;

    let score = 1;
    if (formatter.packages.some((name) => dependencies.has(name))) score += 2;
    if (formatter.configFiles.some((name) => exists(path.join(root, name)))) score += 1;

    if (!best || score > best.score) best = { formatter: { ...formatter, entryPoint }, score };
  }

  return best?.formatter ?? null;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runFormatter(formatter: DetectedFormatter, root: string, files: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    // A JS entry point is run through node (Biome's shim has no file extension, so the runner is
    // what decides, never the file name); a formatter's own binary is started directly.
    const command = formatter.runner === 'node' ? 'node' : formatter.entryPoint;
    const args =
      formatter.runner === 'node'
        ? [formatter.entryPoint, ...formatter.args(files)]
        : formatter.args(files);

    let child;
    try {
      child = spawn(command, args, {
        cwd: root,
        windowsHide: true,
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
      });
    } catch (err: any) {
      resolve({ code: null, stdout: '', stderr: String(err?.message || err), timedOut: false });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const cap = (value: string) => (value.length > MAX_OUTPUT_CHARS ? value.slice(0, MAX_OUTPUT_CHARS) : value);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ code: null, stdout: cap(stdout), stderr: cap(stderr), timedOut: true });
    }, FORMAT_TIMEOUT_MS);

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (err: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: null, stdout: cap(stdout), stderr: String(err?.message || err), timedOut: false });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout: cap(stdout), stderr: cap(stderr), timedOut: false });
    });
  });
}

function supportedBy(formatter: DetectedFormatter, relativePath: string): boolean {
  if (!formatter.extensions) return true;
  const extension = path.extname(relativePath).toLowerCase();
  return formatter.extensions.includes(extension);
}

/**
 * Formats the given files with the project's own formatter.
 *
 * The list is expected to be the paths that were just written; anything outside the connected
 * folder, anything that looks like a secret, and anything too large is refused by the same guard
 * the write itself went through.
 */
export async function formatWorkspaceFiles(
  files: unknown,
  root: string = requireWorkspaceRoot()
): Promise<FormattingResult> {
  const started = Date.now();
  const empty: FormattingResult = {
    ran: false,
    tool: null,
    toolLabel: null,
    commandLine: null,
    files: [],
    changed: [],
    skipped: [],
    durationMs: 0
  };

  const requested = Array.isArray(files)
    ? files.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
  if (requested.length === 0) return { ...empty, note: 'no_files', durationMs: Date.now() - started };

  const formatter = detectFormatter(root);
  if (!formatter) return { ...empty, note: 'no_formatter', durationMs: Date.now() - started };

  const accepted: string[] = [];
  const skipped: string[] = [];
  const before = new Map<string, string>();

  for (const candidate of requested.slice(0, MAX_FORMAT_FILES)) {
    let absolute: string;
    try {
      // Same guard as every other file operation: inside the folder, and never a secret.
      absolute = resolveWorkspacePath(candidate);
    } catch {
      skipped.push(candidate);
      continue;
    }

    let stats: fs.Stats;
    try {
      stats = fs.statSync(absolute);
    } catch {
      skipped.push(candidate);
      continue;
    }
    if (!stats.isFile() || stats.size > MAX_FORMAT_FILE_BYTES || !supportedBy(formatter, candidate)) {
      skipped.push(candidate);
      continue;
    }

    try {
      before.set(candidate, fs.readFileSync(absolute, 'utf8'));
    } catch {
      skipped.push(candidate);
      continue;
    }
    accepted.push(candidate);
  }

  if (accepted.length === 0) {
    return {
      ...empty,
      tool: formatter.id,
      toolLabel: formatter.label,
      files: [],
      skipped,
      note: 'nothing_to_format',
      durationMs: Date.now() - started
    };
  }

  const run = await runFormatter(formatter, root, accepted);
  const commandLine = `${formatter.runner === 'node' ? 'node ' : ''}${formatter.entryPoint} ${formatter
    .args(accepted)
    .join(' ')}`;

  // What actually changed, read from the files themselves: a formatter that reports success on an
  // already tidy file must not be presented as if it had rewritten anything.
  const changed: string[] = [];
  for (const relativePath of accepted) {
    try {
      const after = fs.readFileSync(resolveWorkspacePath(relativePath), 'utf8');
      if (before.get(relativePath) !== after) changed.push(relativePath);
    } catch {
      // A file the formatter removed is not something this feature should ever cause.
    }
  }

  const failed = run.code !== 0;
  return {
    ran: true,
    tool: formatter.id,
    toolLabel: formatter.label,
    commandLine,
    files: accepted,
    changed,
    skipped,
    error: failed
      ? run.timedOut
        ? `The formatter was stopped after ${Math.round(FORMAT_TIMEOUT_MS / 1000)} s.`
        : (run.stderr || run.stdout || '').trim().slice(-1000) || `The formatter exited with code ${run.code}.`
      : undefined,
    note: changed.length === 0 && !failed ? 'nothing_to_format' : undefined,
    durationMs: Date.now() - started
  };
}
