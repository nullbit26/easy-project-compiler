import type { ProblemSeverity } from './checkOutputParser';

/**
 * The difference between two verification runs.
 *
 * "The tests failed" is a weak answer: the interesting sentence is *"this patch broke the two
 * tests that used to pass"*, or *"nothing new broke, and three old errors are gone"*. This module
 * produces exactly that, from two runs the app already has — no model, no guessing.
 *
 * The subtle part is identity. A problem is the same problem when the same check complains about
 * the same file with the same message, even if the line number moved: a patch that adds ten lines
 * at the top of a file shifts every later line, and counting every shifted error as "new" would
 * make the verdict useless. The line is therefore kept for display, but never used as identity.
 */

export type VerificationCheckStatus = 'passed' | 'failed' | 'timeout' | 'unavailable' | 'skipped';

/** One problem, tagged with the check it came from. */
export interface VerificationProblemRef {
  checkId: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  severity: ProblemSeverity;
  message: string;
}

/** One check as it ran a moment ago, with what it actually ran. */
export interface VerificationRunCheck {
  id: string;
  labelRu: string;
  labelEn: string;
  commandLine: string;
  status: VerificationCheckStatus;
}

/** A finished run, ready to be compared (or stored as the next baseline). */
export interface VerificationRunSnapshot {
  ranAt: string;
  changesetId?: string | null;
  checks: VerificationRunCheck[];
  problems: VerificationProblemRef[];
}

/** What is kept between runs: enough to compare, and nothing more. */
export interface StoredCheckState {
  id: string;
  commandLine: string;
  status: VerificationCheckStatus;
}

export interface StoredSnapshot {
  ranAt: string;
  changesetId: string | null;
  checks: StoredCheckState[];
  problems: VerificationProblemRef[];
}

export interface CheckTransition {
  id: string;
  labelRu: string;
  labelEn: string;
  from: VerificationCheckStatus;
  to: VerificationCheckStatus;
}

export interface VerificationDelta {
  /** False when there was nothing to compare against (the first run in this folder). */
  compared: boolean;
  baselineRanAt: string | null;
  baselineChangesetId: string | null;
  /** Checks that passed in the baseline and do not pass now. */
  regressedChecks: CheckTransition[];
  /** Checks that failed in the baseline and pass now. */
  recoveredChecks: CheckTransition[];
  /** Problems this run has that the baseline did not. */
  newProblems: VerificationProblemRef[];
  /** Problems the baseline had that are gone now. */
  fixedProblems: VerificationProblemRef[];
  /** Problems both runs have. */
  persistentProblems: VerificationProblemRef[];
}

const MAX_DELTA_PROBLEMS = 60;

/**
 * The comparable part of a message: case, runs of whitespace and a trailing full stop are
 * presentation, not meaning, and tools change them between versions.
 */
export function normalizeMessage(message: string): string {
  return (message || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.。;]+$/, '');
}

/** A stable identity for one problem: which check, which file, which complaint. */
export function problemKey(problem: VerificationProblemRef): string {
  return [
    problem.checkId,
    (problem.file || '').toLowerCase(),
    normalizeMessage(problem.message)
  ].join('|');
}

/** The report as it is stored between runs. */
export function toStoredSnapshot(run: VerificationRunSnapshot): StoredSnapshot {
  return {
    ranAt: run.ranAt,
    changesetId: run.changesetId ?? null,
    checks: run.checks.map((check) => ({
      id: check.id,
      commandLine: check.commandLine,
      status: check.status
    })),
    problems: run.problems.map((problem) => ({
      checkId: problem.checkId,
      file: problem.file,
      line: problem.line,
      column: problem.column,
      code: problem.code,
      severity: problem.severity,
      message: problem.message
    }))
  };
}

/**
 * Compares a finished run with the previous one.
 *
 * A check only counts as regressed or recovered when it ran the *same command* both times —
 * otherwise the comparison would blame a change on a check that was replaced between runs.
 */
export function compareVerification(
  run: VerificationRunSnapshot,
  baseline: StoredSnapshot | null
): VerificationDelta {
  const empty: VerificationDelta = {
    compared: false,
    baselineRanAt: baseline?.ranAt ?? null,
    baselineChangesetId: baseline?.changesetId ?? null,
    regressedChecks: [],
    recoveredChecks: [],
    newProblems: [],
    fixedProblems: [],
    persistentProblems: []
  };

  // A baseline that verified nothing says nothing: it is not a green run to regress from.
  if (!baseline || (baseline.checks.length === 0 && baseline.problems.length === 0)) return empty;

  const baselineChecks = new Map(baseline.checks.map((check) => [check.id, check]));
  const regressedChecks: CheckTransition[] = [];
  const recoveredChecks: CheckTransition[] = [];

  for (const check of run.checks) {
    const previous = baselineChecks.get(check.id);
    if (!previous) continue;
    if (previous.commandLine !== check.commandLine) continue;
    if (previous.status === check.status) continue;

    const wasGreen = previous.status === 'passed';
    const isRed = check.status === 'failed' || check.status === 'timeout';
    const wasRed = previous.status === 'failed' || previous.status === 'timeout';
    const isGreen = check.status === 'passed';

    if (wasGreen && isRed) {
      regressedChecks.push({
        id: check.id,
        labelRu: check.labelRu,
        labelEn: check.labelEn,
        from: previous.status,
        to: check.status
      });
    } else if (wasRed && isGreen) {
      recoveredChecks.push({
        id: check.id,
        labelRu: check.labelRu,
        labelEn: check.labelEn,
        from: previous.status,
        to: check.status
      });
    }
  }

  const baselineProblems = new Map(baseline.problems.map((problem) => [problemKey(problem), problem]));
  const newProblems: VerificationProblemRef[] = [];
  const persistentProblems: VerificationProblemRef[] = [];
  const seen = new Set<string>();

  for (const problem of run.problems) {
    const key = problemKey(problem);
    if (seen.has(key)) continue;
    seen.add(key);
    if (baselineProblems.has(key)) persistentProblems.push(problem);
    else newProblems.push(problem);
  }

  const fixedProblems: VerificationProblemRef[] = [];
  const currentKeys = new Set(run.problems.map((problem) => problemKey(problem)));
  const seenFixed = new Set<string>();
  for (const problem of baseline.problems) {
    const key = problemKey(problem);
    if (currentKeys.has(key) || seenFixed.has(key)) continue;
    seenFixed.add(key);
    fixedProblems.push(problem);
  }

  return {
    compared: true,
    baselineRanAt: baseline.ranAt,
    baselineChangesetId: baseline.changesetId,
    regressedChecks: regressedChecks.slice(0, MAX_DELTA_PROBLEMS),
    recoveredChecks: recoveredChecks.slice(0, MAX_DELTA_PROBLEMS),
    newProblems: newProblems.slice(0, MAX_DELTA_PROBLEMS),
    fixedProblems: fixedProblems.slice(0, MAX_DELTA_PROBLEMS),
    persistentProblems: persistentProblems.slice(0, MAX_DELTA_PROBLEMS)
  };
}

/**
 * Which of this run's problems are new, keyed by `problemKey`, so the report can be tagged
 * before it reaches the screen. The screen then never has to repeat the comparison logic.
 */
export function problemChangeMap(delta: VerificationDelta): Map<string, 'new' | 'persistent'> {
  const changes = new Map<string, 'new' | 'persistent'>();
  if (!delta.compared) return changes;
  for (const problem of delta.newProblems) changes.set(problemKey(problem), 'new');
  for (const problem of delta.persistentProblems) changes.set(problemKey(problem), 'persistent');
  return changes;
}

/** One problem as a line a human reads: "src/game.js:42 — Unexpected token". */
export function describeProblem(problem: VerificationProblemRef, ru: boolean): string {
  const where = problem.file
    ? `${problem.file}${problem.line ? `:${problem.line}` : ''}`
    : ru
    ? 'место не указано'
    : 'no location';
  return `${where} — ${problem.message}`;
}

/** True when the run says something worth a red banner. */
export function hasFailuresToReport(delta: VerificationDelta): boolean {
  return delta.compared && (delta.regressedChecks.length > 0 || delta.newProblems.length > 0);
}
