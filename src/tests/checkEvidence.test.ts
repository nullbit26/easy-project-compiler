import { describe, it, expect } from 'vitest';
import {
  MAX_EVIDENCE_PROBLEMS,
  checkEvidenceHeadline,
  failedCheckLines,
  formatCheckProblem,
  toCheckEvidence,
  type CheckEvidence
} from '../utils/checkEvidence';
import { guardReviewAgainstChecks } from '../../server/utils/checkVerdict';
import type { CheckProblem, CheckRunResult, VerificationReport } from '../services/api';

/**
 * The facts the app measured about the folder, and what they do to a verdict.
 *
 * Two failures of the old loop are pinned here: a reviewer that asked the user to run `npm install`
 * and `tsc` (commands this machine runs itself), and a reviewer that could call a task finished over
 * a folder that does not compile. The first is fixed by the text in `reviewCheckFactsSection`, the
 * second by `guardReviewAgainstChecks` — this file covers the numbers and the correction.
 */

function problem(overrides: Partial<CheckProblem> = {}): CheckProblem {
  return {
    severity: 'error',
    message: 'Type \u0027string\u0027 is not assignable to type \u0027number\u0027',
    code: 'TS2322',
    raw: 'src/App.tsx(12,5): error TS2322: Type \u0027string\u0027 is not assignable to type \u0027number\u0027',
    file: 'src/App.tsx',
    line: 12,
    column: 5,
    ...overrides
  };
}

function result(overrides: Partial<CheckRunResult> = {}): CheckRunResult {
  return {
    id: 'typecheck:tsc',
    kind: 'typecheck',
    key: 'tsc',
    labelRu: 'Проверка типов',
    labelEn: 'Type check',
    commandLine: 'node node_modules/typescript/bin/tsc --noEmit --pretty false',
    tokens: ['node', 'node_modules/typescript/bin/tsc', '--noEmit'],
    status: 'passed',
    exitCode: 0,
    durationMs: 2100,
    problems: [],
    output: '',
    outputTruncated: false,
    ...overrides
  };
}

function report(results: CheckRunResult[], ok = results.every((item) => item.status === 'passed')): VerificationReport {
  const problems = results.flatMap((item) => item.problems);
  return {
    ranAt: '2026-10-18T10:00:00.000Z',
    root: 'C:\\projects\\island-survival',
    ok,
    passed: results.filter((item) => item.status === 'passed').length,
    failed: results.filter((item) => item.status === 'failed').length,
    skipped: 0,
    durationMs: 5500,
    problems,
    results
  };
}

describe('One problem as one line', () => {
  it('1. puts the place first, keeps the code last and never invents a location', () => {
    expect(formatCheckProblem(problem())).toBe(
      'src/App.tsx:12:5 Type \u0027string\u0027 is not assignable to type \u0027number\u0027 TS2322'
    );
    expect(formatCheckProblem(problem({ file: undefined, line: undefined, column: undefined }))).toBe(
      'Type \u0027string\u0027 is not assignable to type \u0027number\u0027 TS2322'
    );
    // A warning is named as one: a run where everything passed must not read like breakage.
    expect(formatCheckProblem(problem({ severity: 'warning', code: undefined }))).toContain('warning: ');
  });
});

describe('A verification report as reviewer-facing facts', () => {
  it('2. keeps every check, its real command line and the status of each', () => {
    const evidence = toCheckEvidence(
      report([
        result(),
        result({
          id: 'test:vitest',
          kind: 'test',
          key: 'vitest',
          labelRu: 'Тесты',
          labelEn: 'Tests',
          commandLine: 'node node_modules/vitest/vitest.mjs run --reporter basic',
          status: 'failed',
          durationMs: 3400
        })
      ]),
      true
    );

    expect(evidence.lines.map((line) => line.label)).toEqual(['Проверка типов', 'Тесты']);
    expect(evidence.lines[1].commandLine).toContain('vitest');
    expect(evidence.failed).toBe(1);
    expect(evidence.ok).toBe(false);
  });

  it('3. caps the problem list but keeps the true count, so a cut list is not a small one', () => {
    const many = Array.from({ length: MAX_EVIDENCE_PROBLEMS + 4 }, (_, index) =>
      problem({ line: index + 1 })
    );
    const evidence = toCheckEvidence(report([result({ status: 'failed', problems: many })], false));

    expect(evidence.lines[0].problems).toHaveLength(MAX_EVIDENCE_PROBLEMS);
    expect(evidence.lines[0].problemCount).toBe(many.length);
  });

  it('4. labels follow the language of the session', () => {
    const facts = report([result({ status: 'failed' })]);
    expect(toCheckEvidence(facts, true).lines[0].label).toBe('Проверка типов');
    expect(toCheckEvidence(facts, false).lines[0].label).toBe('Type check');
  });
});

describe('The one sentence about the checks', () => {
  const evidence = (lines: CheckEvidence['lines']): CheckEvidence => ({
    ranAt: '2026-10-18T10:00:00.000Z',
    ok: lines.every((line) => line.status === 'passed'),
    passed: lines.filter((line) => line.status === 'passed').length,
    failed: lines.filter((line) => line.status === 'failed').length,
    lines
  });

  it('5. names what passed, what failed and how many problems came with it', () => {
    const failed = evidence([
      {
        id: 'typecheck:tsc',
        label: 'Проверка типов',
        status: 'failed',
        commandLine: 'tsc',
        durationMs: 100,
        problems: ['src/App.tsx:12:5 TS2322'],
        problemCount: 3
      },
      { id: 'test:vitest', label: 'Тесты', status: 'passed', commandLine: 'vitest', durationMs: 10, problems: [], problemCount: 0 }
    ]);

    expect(checkEvidenceHeadline(failed, true)).toContain('1 прошло, 1 с ошибками (3 проблем)');
    expect(checkEvidenceHeadline(failed, true)).toContain('Проверка типов');
    expect(failedCheckLines(failed).map((line) => line.label)).toEqual(['Проверка типов']);
  });

  it('6. "there are no tests" is not said as "the tests pass"', () => {
    const quiet = evidence([
      { id: 'lint:eslint', label: 'Линтер', status: 'unavailable', commandLine: 'eslint', durationMs: 0, problems: [], problemCount: 0 }
    ]);

    expect(checkEvidenceHeadline(quiet, true)).toContain('не запускались: Линтер');
    expect(checkEvidenceHeadline(null, true)).toContain('не запускались');
    expect(checkEvidenceHeadline(null, false)).toContain('were not run');
  });
});

describe('What a failed check does to a verdict', () => {
  const failedEvidence: CheckEvidence = {
    ranAt: '2026-10-18T10:00:00.000Z',
    ok: false,
    passed: 0,
    failed: 1,
    lines: [
      {
        id: 'typecheck:tsc',
        label: 'Проверка типов',
        status: 'failed',
        commandLine: 'tsc --noEmit',
        durationMs: 2100,
        problems: ['src/App.tsx:12:5 TS2322 Type \u0027string\u0027 is not assignable'],
        problemCount: 3
      }
    ]
  };

  const review = {
    status: 'Completed',
    progressPercent: 100,
    warnings: [],
    missingCriteria: [],
    continuationPrompt: ''
  };

  it('7. a folder that does not compile is never 100% "Completed"', () => {
    const guarded = guardReviewAgainstChecks({ ...review }, failedEvidence, true);

    expect(guarded.status).toBe('Partially Completed');
    expect(guarded.progressPercent).toBe(90);
    expect(guarded.warnings[0]).toContain('Проверка типов');
    expect(guarded.missingCriteria[0]).toContain('src/App.tsx:12:5');
  });

  it('8. what the model already said is not thrown away — the facts are added to it', () => {
    const guarded = guardReviewAgainstChecks(
      {
        status: 'Partially Completed',
        progressPercent: 60,
        warnings: ['Ответ обрезан'],
        missingCriteria: ['Сохранение работает'],
        continuationPrompt: 'доработать'
      },
      failedEvidence,
      false
    );

    expect(guarded.progressPercent).toBe(60);
    expect(guarded.status).toBe('Partially Completed');
    expect(guarded.warnings).toHaveLength(2);
    expect(guarded.missingCriteria).toEqual(['Сохранение работает']);
    expect(guarded.continuationPrompt).toBe('доработать');
  });

  it('9. a run that passed changes nothing at all', () => {
    const green: CheckEvidence = {
      ...failedEvidence,
      ok: true,
      passed: 1,
      failed: 0,
      lines: [{ ...failedEvidence.lines[0], status: 'passed', problems: [], problemCount: 0 }]
    };

    expect(guardReviewAgainstChecks({ ...review }, green, true)).toEqual(review);
    expect(guardReviewAgainstChecks({ ...review }, null, true)).toEqual(review);
  });
});
