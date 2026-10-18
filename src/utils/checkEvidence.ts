import type { CheckProblem, CheckRunResult, CheckStatus, VerificationReport } from '../services/api';

/**
 * What the app can honestly tell the reviewer about the folder it just wrote code into.
 *
 * The reviewer used to judge a paste of the agent's answer and nothing else, so its "what still has
 * to be done" was written from the text alone: it asked the author to run `npm install` and `tsc`,
 * to add PixiJS to devDependencies — commands nobody on that side of the loop can run, because the
 * folder is on this machine and the app is the thing that runs commands here. The four screenshots
 * of the beginner loop all show the same verdict, "0% · попытка 2 … 4", next to a demand that was
 * already satisfied on disk.
 *
 * This module turns a real verification report into plain facts — which commands were run, what each
 * answered, and the first problems it printed — so the review prompt can say "these are done, do not
 * ask for them again" instead of guessing from prose.
 */

/** How many problem lines from one check travel with the review. The rest stay in the check log. */
export const MAX_EVIDENCE_PROBLEMS = 5;

export interface CheckEvidenceLine {
  id: string;
  /** The name the app shows for this check, in the language of the session. */
  label: string;
  status: CheckStatus;
  /** The command line really run in the folder, so the reviewer cannot ask for it a second time. */
  commandLine: string;
  durationMs: number;
  /** Up to `MAX_EVIDENCE_PROBLEMS` problems, already formatted as "file:line message". */
  problems: string[];
  /** How many problems the check reported in total, not just the ones kept. */
  problemCount: number;
}

export interface CheckEvidence {
  /** When the run happened — evidence about code is only as good as its moment. */
  ranAt: string;
  /** True when every check that ran passed. */
  ok: boolean;
  passed: number;
  failed: number;
  lines: CheckEvidenceLine[];
}

/** One problem as a single line: the place first, because the message alone rarely says where. */
export function formatCheckProblem(problem: CheckProblem): string {
  const place = [problem.file, problem.line ? `:${problem.line}` : '', problem.column ? `:${problem.column}` : '']
    .filter(Boolean)
    .join('');
  const code = problem.code ? ` ${problem.code}` : '';
  return `${place ? `${place} ` : ''}${problem.severity === 'warning' ? 'warning: ' : ''}${
    problem.message || problem.raw
  }`.trim() + code;
}

/** The label in the language of the session; the check ships both. */
export function checkLabel(
  result: Pick<CheckRunResult, 'labelRu' | 'labelEn' | 'commandLine'>,
  isRu: boolean
): string {
  return (isRu ? result.labelRu : result.labelEn) || result.commandLine;
}

export function toCheckEvidence(report: VerificationReport, isRu = true): CheckEvidence {
  const lines: CheckEvidenceLine[] = (report.results || []).map((result) => ({
    id: result.id,
    label: checkLabel(result, isRu),
    status: result.status,
    commandLine: result.commandLine,
    durationMs: result.durationMs,
    problems: (result.problems || []).slice(0, MAX_EVIDENCE_PROBLEMS).map(formatCheckProblem),
    problemCount: (result.problems || []).length
  }));

  return {
    ranAt: report.ranAt,
    ok: !!report.ok,
    passed: report.passed || 0,
    failed: report.failed || 0,
    lines
  };
}

/**
 * One sentence for the screen and for the verdict's warnings: what was run and how it answered.
 *
 * "Passed" is not claimed for a check that never ran, and a skipped or unavailable check is named
 * as such — the difference between "the tests pass" and "there are no tests" is the whole point of
 * running them here instead of asking the agent to describe them.
 */
export function checkEvidenceHeadline(evidence: CheckEvidence | null | undefined, isRu: boolean): string {
  if (!evidence || evidence.lines.length === 0) {
    return isRu ? 'Проверки проекта не запускались.' : 'The project checks were not run.';
  }

  const failed = evidence.lines.filter((line) => line.status === 'failed' || line.status === 'timeout');
  const passed = evidence.lines.filter((line) => line.status === 'passed');
  const skipped = evidence.lines.filter((line) => line.status === 'skipped' || line.status === 'unavailable');

  if (failed.length === 0) {
    const done = isRu
      ? `Проверки прошли: ${passed.map((line) => line.label).join(', ') || '—'}`
      : `Checks passed: ${passed.map((line) => line.label).join(', ') || '—'}`;
    return skipped.length
      ? `${done}${isRu ? ', не запускались: ' : ', not run: '}${skipped.map((line) => line.label).join(', ')}`
      : done;
  }

  const problems = failed.reduce((sum, line) => sum + line.problemCount, 0);
  return isRu
    ? `Проверки: ${passed.length} прошло, ${failed.length} с ошибками (${problems} проблем): ${failed
        .map((line) => line.label)
        .join(', ')}`
    : `Checks: ${passed.length} passed, ${failed.length} failed (${problems} problems): ${failed
        .map((line) => line.label)
        .join(', ')}`;
}

/** The checks that failed, for a screen that wants to point at them rather than list everything. */
export function failedCheckLines(evidence: CheckEvidence | null | undefined): CheckEvidenceLine[] {
  if (!evidence) return [];
  return evidence.lines.filter((line) => line.status === 'failed' || line.status === 'timeout');
}
