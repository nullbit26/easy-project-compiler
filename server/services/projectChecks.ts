import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { requireWorkspaceRoot } from '../store/workspaceStore';
import { capOutput, CheckProblem, parseCheckOutput, summarizeProblems } from '../utils/checkOutputParser';
import { readVerificationBaseline, writeVerificationBaseline } from '../store/verificationBaseline';
import type { BuildBudgetVerdict, BuildWeight } from './changeWeight';
import {
  VerificationDelta,
  VerificationProblemRef,
  VerificationRunSnapshot,
  compareVerification,
  problemChangeMap,
  problemKey,
  toStoredSnapshot
} from '../utils/verificationDelta';

/**
 * The verification half of the loop: it discovers which checks this project actually has
 * (typecheck, lint, tests, build) and runs them inside the connected folder, so "written"
 * can be told apart from "working".
 *
 * Two rules shape everything here:
 *  - never touch the network or install anything: only local binaries and the project's own
 *    package scripts are used;
 *  - never hang the app: every check has a timeout and is killed with its whole process tree.
 */

export type CheckKind = 'typecheck' | 'lint' | 'test' | 'build' | 'custom';
export type CheckStatus = 'passed' | 'failed' | 'timeout' | 'unavailable' | 'skipped';

export interface CheckDefinition {
  id: string;
  kind: CheckKind;
  key: string;
  /** Russian-facing text is kept here, English in the sibling field — the app is bilingual. */
  labelRu: string;
  labelEn: string;
  /** Tokens actually spawned, for display ("npm run build"). */
  commandLine: string;
  tokens: string[];
}

export interface CheckRunResult extends CheckDefinition {
  status: CheckStatus;
  exitCode: number | null;
  durationMs: number;
  problems: CheckProblem[];
  output: string;
  outputTruncated: boolean;
  error?: string;
}

export interface VerificationReport {
  ranAt: string;
  root: string;
  ok: boolean;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  problems: CheckProblem[];
  results: CheckRunResult[];
  /**
   * What changed since the previous run in this folder: which checks that used to pass do not
   * pass now, which problems are new, and which are gone. Null only when the folder has never
   * been checked before anything could be recorded.
   */
  delta: VerificationDelta | null;
  /**
   * The measured build output against the ceiling this project set for itself, when its build
   * really ran in this pass. Null when nothing was built, so there was nothing to judge.
   */
  budget?: BuildBudgetVerdict | null;
}

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_CHARS = 60_000;
const MAX_CHECKS = 6;
export const MAX_PROBLEMS = 60;

const KIND_TIMEOUT: Record<CheckKind, number> = {
  typecheck: 150_000,
  lint: 150_000,
  test: 300_000,
  build: 300_000,
  custom: 180_000
};

const KIND_LABEL: Record<CheckKind, { ru: string; en: string }> = {
  typecheck: { ru: 'Проверка типов', en: 'Type check' },
  lint: { ru: 'Линтер', en: 'Lint' },
  test: { ru: 'Тесты', en: 'Tests' },
  build: { ru: 'Сборка проекта', en: 'Project build' },
  custom: { ru: 'Своя команда', en: 'Custom command' }
};

/**
 * Executables a user-typed command may start. Everything else is refused, so a paste from the
 * internet cannot turn the check box into a general-purpose shell.
 */
const ALLOWED_EXECUTABLES = new Set([
  'node', 'npm', 'npx', 'bun', 'bunx', 'yarn', 'pnpm', 'tsc', 'vitest', 'jest', 'eslint',
  'pytest', 'python', 'python3', 'py', 'dotnet', 'cargo', 'go', 'gradle', 'mvn', 'msbuild', 'make'
]);

/** A token may only contain characters that cannot chain, redirect or substitute anything. */
const SAFE_TOKEN = /^[A-Za-z0-9_@./:=+*-]+$/;

function exists(target: string): boolean {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

type PackageManager = 'npm' | 'bun' | 'pnpm' | 'yarn';

function detectPackageManager(root: string): PackageManager {
  if (exists(path.join(root, 'bun.lockb')) || exists(path.join(root, 'bun.lock'))) return 'bun';
  if (exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (exists(path.join(root, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function scriptTokens(pm: PackageManager, script: string): string[] {
  if (pm === 'npm') return ['npm', 'run', script];
  if (pm === 'bun') return ['bun', 'run', script];
  return [pm, 'run', script];
}

/** Local binaries are run through `node <file>`: no shell tricks, no network fetch. */
function localBinary(root: string, candidates: string[]): string | null {
  for (const candidate of candidates) {
    const absolute = path.join(root, 'node_modules', candidate);
    if (exists(absolute)) return path.relative(root, absolute).split(path.sep).join('/');
  }
  return null;
}

function quoteToken(token: string): string {
  return /^[A-Za-z0-9_@./:=+*-]+$/.test(token) ? token : `"${token.replace(/"/g, '')}"`;
}

export function buildCommandLine(tokens: string[]): string {
  return tokens.map(quoteToken).join(' ');
}

interface PackageJsonShape {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
}

const SCRIPT_ALIASES: Array<{ kind: CheckKind; key: string; names: string[] }> = [
  { kind: 'typecheck', key: 'typecheck', names: ['typecheck', 'type-check', 'check-types', 'ts:check', 'tsc'] },
  { kind: 'lint', key: 'lint', names: ['lint', 'eslint'] },
  { kind: 'test', key: 'test', names: ['test', 'test:unit', 'tests', 'unit'] },
  { kind: 'build', key: 'build', names: ['build', 'compile'] }
];

function findScript(scripts: Record<string, string>, names: string[]): string | null {
  for (const name of names) {
    if (typeof scripts[name] === 'string' && scripts[name].trim()) return name;
  }
  return null;
}

/**
 * What can actually be checked in this folder right now. A Unity or Godot project has no CLI
 * checks, and the answer then is an empty list plus the custom-command box — not an error.
 */
export function detectChecks(rootInput?: string): CheckDefinition[] {
  const root = rootInput ?? requireWorkspaceRoot();
  const checks: CheckDefinition[] = [];
  const packageJson = exists(path.join(root, 'package.json'))
    ? readJson<PackageJsonShape>(path.join(root, 'package.json'))
    : null;
  const scripts = packageJson?.scripts || {};
  const devDeps = { ...(packageJson?.dependencies || {}), ...(packageJson?.devDependencies || {}) };
  const pm = detectPackageManager(root);

  const add = (kind: CheckKind, tokens: string[], key: string) => {
    if (checks.length >= MAX_CHECKS) return;
    if (checks.some((check) => check.kind === kind && check.key === key)) return;
    checks.push({
      id: `${kind}:${key}`,
      kind,
      key,
      labelRu: KIND_LABEL[kind].ru,
      labelEn: KIND_LABEL[kind].en,
      commandLine: buildCommandLine(tokens),
      tokens
    });
  };

  // --- Type checking -------------------------------------------------------
  const tscEntry = localBinary(root, ['typescript/bin/tsc']);
  const typecheckScript = findScript(scripts, SCRIPT_ALIASES[0].names);
  const hasTsconfig = exists(path.join(root, 'tsconfig.json'));

  if (tscEntry && (hasTsconfig || typecheckScript)) {
    // Running tsc directly with --pretty false is what makes its output parseable.
    add('typecheck', ['node', tscEntry, '--noEmit', '--pretty', 'false'], 'tsc');
  } else if (typecheckScript && !/tsc/.test(scripts[typecheckScript] || '')) {
    add('typecheck', scriptTokens(pm, typecheckScript), typecheckScript);
  }

  // --- Lint ---------------------------------------------------------------
  const lintScript = findScript(scripts, SCRIPT_ALIASES[1].names);
  if (lintScript) add('lint', scriptTokens(pm, lintScript), lintScript);

  // --- Tests --------------------------------------------------------------
  // Watch mode would never exit, so a known runner is invoked in its one-shot form.
  const vitestEntry = localBinary(root, ['vitest/vitest.mjs', 'vitest/dist/cli.js']);
  const jestEntry = localBinary(root, ['jest/bin/jest.js']);
  const testScript = findScript(scripts, SCRIPT_ALIASES[2].names);

  if (vitestEntry && devDeps.vitest) {
    add('test', ['node', vitestEntry, 'run', '--reporter', 'basic'], 'vitest');
  } else if (jestEntry && devDeps.jest) {
    add('test', ['node', jestEntry, '--ci'], 'jest');
  } else if (testScript) {
    const body = scripts[testScript] || '';
    // "vitest" without "run" and bare "jest" both wait for a keyboard by default.
    const suffix = /\bvitest\b/.test(body) && !/\brun\b/.test(body) ? ['--', 'run'] : [];
    add('test', [...scriptTokens(pm, testScript), ...suffix], testScript);
  } else if (exists(path.join(root, 'pytest.ini')) || exists(path.join(root, 'tests'))) {
    add('test', ['python', '-m', 'pytest', '-q'], 'pytest');
  }

  // --- Build --------------------------------------------------------------
  const buildScript = findScript(scripts, SCRIPT_ALIASES[3].names);
  if (buildScript) add('build', scriptTokens(pm, buildScript), buildScript);

  // --- Non-JavaScript ecosystems -----------------------------------------
  const rootEntries = (() => {
    try {
      return fs.readdirSync(root);
    } catch {
      return [] as string[];
    }
  })();
  if (rootEntries.some((name) => name.endsWith('.sln') || name.endsWith('.csproj'))) {
    add('build', ['dotnet', 'build', '--nologo', '-v', 'quiet'], 'dotnet');
  }
  if (exists(path.join(root, 'Cargo.toml'))) add('typecheck', ['cargo', 'check'], 'cargo');
  if (exists(path.join(root, 'go.mod'))) add('build', ['go', 'build', './...'], 'go');

  return checks;
}

/** Splits a user-typed command into safe tokens; null means "refuse with this reason". */
export function parseCustomCommand(input: string): { tokens: string[]; error?: string } {
  const raw = String(input || '').trim();
  if (!raw) return { tokens: [], error: 'empty' };
  const tokens = raw.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => token.replace(/^["']|["']$/g, '')) || [];
  if (tokens.length === 0) return { tokens: [], error: 'empty' };
  if (/[&|;<>`$(){}[\]!^%]/.test(raw)) return { tokens: [], error: 'unsafe' };
  const executable = path.basename(tokens[0]).toLowerCase().replace(/\.(cmd|exe|bat)$/, '');
  if (!ALLOWED_EXECUTABLES.has(executable)) return { tokens: [], error: 'not_allowed' };
  if (!tokens.every((token) => SAFE_TOKEN.test(token))) return { tokens: [], error: 'unsafe' };
  return { tokens };
}

/**
 * The checks running right now, so they can be stopped when the app itself goes away.
 *
 * A timeout only fires in the process that owns it. If the app is closed while a build is running,
 * the build is not killed — it is simply orphaned, and it keeps writing to the user's folder with
 * nobody watching and no screen left to report it on. Measured, not assumed: after the process that
 * owned a check was killed, the check kept working (75 ticks → 96 in 2.5 s).
 */
const runningChecks = new Set<ReturnType<typeof spawn>>();

/** Stops every check still running; safe to call when there are none. */
export function killRunningChecks(): void {
  for (const child of [...runningChecks]) killTree(child);
  runningChecks.clear();
}

/*
 * A process about to exit is the last moment anything can be done about its children, and the hook
 * has to be synchronous to be of any use — `killTree` waits for the kill on purpose, which is
 * exactly the property wanted here. It also covers Ctrl+C: the default signal handling exits the
 * process, which runs this listener on the way out.
 */
process.on('exit', killRunningChecks);

/**
 * Stops a timed-out check and everything it started.
 *
 * This waits for the kill to finish on purpose: a build that keeps running after the app said
 * "stopped" would keep the project folder locked and keep burning CPU behind the user's back.
 */
function killTree(child: ReturnType<typeof spawn>): void {
  const pid = child.pid;
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: 8_000 });
    } else {
      // The child is spawned detached, so it leads its own process group.
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    // Nothing left to kill, or the process was already gone.
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // The process already exited.
  }
}

interface RawRun {
  status: CheckStatus;
  exitCode: number | null;
  output: string;
  outputTruncated: boolean;
  durationMs: number;
  error?: string;
}

/**
 * Runs one command line inside the project folder. The shell is used only because Windows
 * needs it for npm.cmd; every token is validated above, so it cannot carry a second command.
 */
export function runCommand(options: {
  root: string;
  tokens: string[];
  timeoutMs?: number;
}): Promise<RawRun> {
  const { root, tokens } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const commandLine = buildCommandLine(tokens);
  const startedAt = Date.now();

  return new Promise<RawRun>((resolve) => {
    let settled = false;
    let output = '';
    let truncated = false;
    let timedOut = false;
    // Declared before `finish`, because a command that cannot be started at all reports its failure
    // from inside the catch below — before the timeout above it would otherwise have been created.
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (status: CheckStatus, exitCode: number | null, error?: string) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ status, exitCode, output, outputTruncated: truncated, durationMs: Date.now() - startedAt, error });
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(commandLine, {
        cwd: root,
        shell: true,
        windowsHide: true,
        detached: process.platform !== 'win32',
        /*
         * Nothing is typed at a check, so its standard input is closed rather than a pipe nobody
         * holds. A tool that asks a question — a runner in its interactive mode, a build script
         * waiting on a prompt — reads end-of-file and gets on with its default instead of sitting
         * there until the timeout (150–300 s by default) goes off.
         */
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CI: '1',
          NO_COLOR: '1',
          FORCE_COLOR: '0',
          npm_config_yes: 'true',
          npm_config_update_notifier: 'false'
        }
      });
    } catch (err: any) {
      finish('unavailable', null, err?.message || 'Could not start the command.');
      return;
    }

    runningChecks.add(child);

    timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
      finish('timeout', null, `Stopped after ${Math.round(timeoutMs / 1000)} s.`);
    }, timeoutMs);

    const collect = (chunk: Buffer) => {
      if (output.length > MAX_OUTPUT_CHARS * 2) {
        truncated = true;
        return;
      }
      output += chunk.toString('utf8');
    };

    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);

    child.on('error', (err: any) => {
      const missing = err?.code === 'ENOENT' || err?.code === 'EINVAL';
      finish(
        'unavailable',
        null,
        missing
          ? `"${tokens[0]}" is not installed on this computer.`
          : err?.message || 'The command could not be started.'
      );
    });

    child.on('close', (code) => {
      runningChecks.delete(child);
      if (timedOut) return;
      finish(code === 0 ? 'passed' : 'failed', code);
    });
  });
}

function toResult(definition: CheckDefinition, run: RawRun, root?: string): CheckRunResult {
  const capped = capOutput(run.output);
  return {
    ...definition,
    status: run.status,
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    // Tools print absolute paths (node, dotnet, tsc in a monorepo), and a path relative to the
    // folder is what the screen shows and what the repair step can actually open.
    //
    // A passed run is parsed too. A linter that exits 0 while printing warnings is the normal
    // case, and throwing its output away is what used to leave the user with "the checks pass"
    // and a screen full of untidy code the app could not offer to clean: the findings are what
    // makes a warning the last change introduced into a task.
    problems:
      run.status === 'passed' || run.status === 'failed'
        ? parseCheckOutput(capped.text, { limit: MAX_PROBLEMS, root })
        : [],
    output: capped.text,
    outputTruncated: run.outputTruncated || capped.truncated,
    error: run.error
  };
}

/**
 * Runs the requested checks one after another (a build and a test run at the same time would
 * just fight for the same CPU) and returns one report the UI and the AI can both read.
 */
export async function runVerification(options: {
  root?: string;
  ids?: string[];
  customCommand?: string;
  /** The batch this run verifies, so the verdict can be tied to a specific write. */
  changesetId?: string | null;
} = {}): Promise<VerificationReport> {
  const root = options.root ?? requireWorkspaceRoot();
  const available = detectChecks(root);
  // An explicit selection is honoured as-is: an empty list means "only my own command", which
  // is what the screen sends when the user unticked every check and typed one instead.
  const requestedIds = Array.isArray(options.ids) ? options.ids : null;
  const selected = requestedIds ? available.filter((check) => requestedIds.includes(check.id)) : available;

  const results: CheckRunResult[] = [];

  for (const check of selected) {
    const run = await runCommand({ root, tokens: check.tokens, timeoutMs: KIND_TIMEOUT[check.kind] });
    results.push(toResult(check, run, root));
  }

  if (options.customCommand) {
    const parsed = parseCustomCommand(options.customCommand);
    const definition: CheckDefinition = {
      id: 'custom:user',
      kind: 'custom',
      key: 'user',
      labelRu: KIND_LABEL.custom.ru,
      labelEn: KIND_LABEL.custom.en,
      commandLine: parsed.tokens.map(quoteToken).join(' '),
      tokens: parsed.tokens
    };
    if (parsed.error) {
      results.push({
        ...definition,
        status: 'unavailable',
        exitCode: null,
        durationMs: 0,
        problems: [],
        output: '',
        outputTruncated: false,
        error:
          parsed.error === 'empty'
            ? 'The command is empty.'
            : parsed.error === 'not_allowed'
            ? `"${parsed.tokens[0] || ''}" is not on the allowed list of build tools.`
            : 'The command contains characters that are not allowed.'
      });
    } else {
      const run = await runCommand({ root, tokens: parsed.tokens, timeoutMs: KIND_TIMEOUT.custom });
      results.push(toResult(definition, run, root));
    }
  }

  /**
   * A requested id that produced no result is reported instead of being dropped.
   *
   * Re-checking a repair names exactly the checks that failed before, and one of them is often the
   * command the user typed (a custom id, which the folder does not list). Running nothing and
   * answering "ok" is the one outcome that must never happen: the screen would show a green
   * "every check passed" for a project nobody looked at.
   */
  const unresolved = (requestedIds || []).filter((id) => !results.some((result) => result.id === id));
  for (const id of unresolved) {
    results.push({
      id,
      kind: 'custom',
      key: id,
      labelRu: 'Проверка недоступна',
      labelEn: 'Check unavailable',
      commandLine: id,
      tokens: [],
      status: 'unavailable',
      exitCode: null,
      durationMs: 0,
      problems: [],
      output: '',
      outputTruncated: false,
      error: 'This check is not offered by the folder any more, so nothing was verified for it.'
    });
  }

  const problems = results.flatMap((result) => result.problems).slice(0, MAX_PROBLEMS);
  const failed = results.filter((result) => result.status === 'failed' || result.status === 'timeout').length;
  const passed = results.filter((result) => result.status === 'passed').length;
  const skipped = results.filter((result) => result.status === 'unavailable').length;

  const ranAt = new Date().toISOString();
  const snapshot: VerificationRunSnapshot = {
    ranAt,
    changesetId: options.changesetId ?? null,
    checks: results.map((result) => ({
      id: result.id,
      labelRu: result.labelRu,
      labelEn: result.labelEn,
      commandLine: result.commandLine,
      status: result.status
    })),
    problems: results.flatMap((result) => result.problems.map((problem) => asProblemRef(result.id, problem)))
  };

  // The verdict: what this run has that the previous one did not.
  const delta = compareVerification(snapshot, readVerificationBaseline(root));

  // Tag what the screen will show, so the panel only has to render "new" or "was already there"
  // instead of repeating the comparison.
  const changes = problemChangeMap(delta);
  for (const result of results) {
    for (const problem of result.problems) {
      const change = changes.get(problemKey(asProblemRef(result.id, problem)));
      if (change) problem.change = change;
    }
  }

  // The run that just finished is the state the next run will be compared against.
  writeVerificationBaseline(root, toStoredSnapshot(snapshot));

  return {
    ranAt,
    root,
    // A check that never ran is not a check that passed: "all green" means every requested check
    // actually ran and none of them failed.
    ok: failed === 0 && skipped === 0 && results.length > 0,
    passed,
    failed,
    skipped,
    durationMs: results.reduce((total, result) => total + result.durationMs, 0),
    problems,
    results,
    delta
  };
}

/** A problem plus the check it came from — the shape the comparison understands. */
function asProblemRef(checkId: string, problem: CheckProblem): VerificationProblemRef {
  return {
    checkId,
    file: problem.file,
    line: problem.line,
    column: problem.column,
    code: problem.code,
    severity: problem.severity,
    message: problem.message
  };
}

/** What the timeline stores for each batch: the outcome in one compact row. */
export interface VerificationSummary {
  ranAt: string;
  ok: boolean;
  passed: number;
  failed: number;
  problemCount: number;
  errors: number;
  warnings: number;
  /** How heavy the build output is, when the folder's own build ran in this pass. */
  build?: BuildWeight;
  /** The same number against the project's own ceiling, when it has one. */
  budget?: BuildBudgetVerdict;
}

/** Short line for the timeline: "тесты упали, 3 ошибки". */
export function summarizeReport(report: VerificationReport): VerificationSummary {
  const counts = summarizeProblems(report.problems);
  return {
    ranAt: report.ranAt,
    ok: report.ok,
    passed: report.passed,
    failed: report.failed,
    problemCount: report.problems.length,
    errors: counts.errors,
    warnings: counts.warnings
  };
}
