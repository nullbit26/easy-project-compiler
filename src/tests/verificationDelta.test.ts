import { describe, it, expect } from 'vitest';

import {
  VerificationProblemRef,
  VerificationRunCheck,
  VerificationRunSnapshot,
  StoredSnapshot,
  compareVerification,
  describeProblem,
  normalizeMessage,
  problemChangeMap,
  problemKey,
  toStoredSnapshot
} from '../../server/utils/verificationDelta';

/**
 * The verdict is the sentence the user acts on, so it has to be right in the cases that look
 * alike but are not: a line that moved is not a new error, a check that was replaced is not a
 * check that regressed, and a run that verified nothing is not a green run to fall from.
 */

function check(id: string, status: VerificationRunCheck['status'], commandLine = 'npm run test'): VerificationRunCheck {
  return { id, labelRu: `Проверка ${id}`, labelEn: `Check ${id}`, commandLine, status };
}

function problem(checkId: string, message: string, file?: string, line?: number): VerificationProblemRef {
  return { checkId, file, line, severity: 'error', message };
}

function run(overrides: Partial<VerificationRunSnapshot> = {}): VerificationRunSnapshot {
  return {
    ranAt: '2026-10-15T12:00:00.000Z',
    changesetId: null,
    checks: [],
    problems: [],
    ...overrides
  };
}

describe('Comparing two check runs', () => {
  it('1. says there is nothing to compare on the very first run', () => {
    const delta = compareVerification(run({ checks: [check('test:test', 'failed')], problems: [problem('test:test', 'boom')] }), null);

    expect(delta.compared).toBe(false);
    expect(delta.regressedChecks).toHaveLength(0);
    expect(delta.newProblems).toHaveLength(0);
    // Nothing is tagged as "new" when there is no baseline: nothing is known to be new.
    expect(problemChangeMap(delta).size).toBe(0);
  });

  it('2. treats a check that stopped passing as a regression, and the opposite as a recovery', () => {
    const baseline = toStoredSnapshot(run({ checks: [check('test:test', 'passed'), check('lint:lint', 'failed')] }));
    const delta = compareVerification(
      run({ checks: [check('test:test', 'failed'), check('lint:lint', 'passed')] }),
      baseline
    );

    expect(delta.compared).toBe(true);
    expect(delta.regressedChecks.map((entry) => entry.id)).toEqual(['test:test']);
    expect(delta.regressedChecks[0]).toMatchObject({ from: 'passed', to: 'failed' });
    expect(delta.recoveredChecks.map((entry) => entry.id)).toEqual(['lint:lint']);
  });

  it('3. never blames a check whose command changed between runs', () => {
    const baseline = toStoredSnapshot(run({ checks: [check('test:test', 'passed', 'npm run test')] }));
    const delta = compareVerification(run({ checks: [check('test:test', 'failed', 'npm run test:unit')] }), baseline);
    expect(delta.regressedChecks).toHaveLength(0);
  });

  it('4. ignores a check that was replaced by "unavailable" in either direction', () => {
    const before = toStoredSnapshot(run({ checks: [check('build:build', 'unavailable')] }));
    expect(compareVerification(run({ checks: [check('build:build', 'failed')] }), before).regressedChecks).toHaveLength(0);

    const after = toStoredSnapshot(run({ checks: [check('build:build', 'failed')] }));
    expect(compareVerification(run({ checks: [check('build:build', 'unavailable')] }), after).recoveredChecks).toHaveLength(0);
  });

  it('5. splits problems into new, pre-existing and fixed', () => {
    const baseline = toStoredSnapshot(
      run({
        problems: [
          problem('test:test', 'AssertionError: expected 2, got 3', 'src/math.test.js'),
          problem('lint:lint', 'no-unused-vars', 'src/old.js')
        ]
      })
    );

    const delta = compareVerification(
      run({
        problems: [
          problem('test:test', 'AssertionError: expected 2, got 3', 'src/math.test.js'),
          problem('test:test', 'TypeError: cannot read property of undefined', 'src/math.test.js')
        ]
      }),
      baseline
    );

    expect(delta.newProblems.map((entry) => entry.message)).toEqual(['TypeError: cannot read property of undefined']);
    expect(delta.persistentProblems.map((entry) => entry.message)).toEqual(['AssertionError: expected 2, got 3']);
    expect(delta.fixedProblems.map((entry) => entry.message)).toEqual(['no-unused-vars']);
  });

  it('6. does not call a moved line a new problem', () => {
    const baseline = toStoredSnapshot(
      run({ problems: [problem('typecheck:typecheck', "Property 'items' does not exist", 'src/App.tsx', 28)] })
    );
    const delta = compareVerification(
      run({ problems: [problem('typecheck:typecheck', "Property 'items' does not exist", 'src/App.tsx', 41)] }),
      baseline
    );

    expect(delta.newProblems).toHaveLength(0);
    expect(delta.fixedProblems).toHaveLength(0);
    expect(delta.persistentProblems).toHaveLength(1);
    // The line the user is shown is the current one, not the baseline's.
    expect(delta.persistentProblems[0].line).toBe(41);
  });

  it('7. matches a problem that only changed in case, spacing or a trailing full stop', () => {
    const baseline = toStoredSnapshot(run({ problems: [problem('test:test', 'Failed  test: adds numbers.', 'a.test.js')] }));
    const delta = compareVerification(
      run({ problems: [problem('test:test', 'failed test: adds numbers', 'a.test.js')] }),
      baseline
    );
    expect(delta.newProblems).toHaveLength(0);
    expect(delta.persistentProblems).toHaveLength(1);
  });

  it('8. counts every problem once, even when a tool prints it twice', () => {
    const duplicate = problem('test:test', 'Same failure', 'a.test.js');
    const delta = compareVerification(run({ problems: [duplicate, { ...duplicate }] }), null);
    // Not compared, so the verdict is empty — but the run itself must not be double counted
    // when the same text is printed twice by one tool.
    expect(delta.persistentProblems.filter((entry) => problemKey(entry) === problemKey(duplicate))).toHaveLength(0);

    const withBaseline = compareVerification(
      run({ problems: [duplicate, { ...duplicate }] }),
      toStoredSnapshot(run({ checks: [check('test:test', 'passed')] }))
    );
    expect(withBaseline.newProblems).toHaveLength(1);
  });

  it('9. a baseline that verified nothing is not a baseline', () => {
    const empty = toStoredSnapshot(run({ checks: [], problems: [] }));
    expect(compareVerification(run({ checks: [check('test:test', 'failed')] }), empty).compared).toBe(false);
  });

  it('10. tags problems for the screen and describes them the way the panel prints them', () => {
    const baseline = toStoredSnapshot(
      run({ checks: [check('test:test', 'passed')], problems: [problem('test:test', 'old failure', 'src/a.js', 3)] })
    );
    const current = run({
      checks: [check('test:test', 'failed')],
      problems: [problem('test:test', 'old failure', 'src/a.js', 3), problem('test:test', 'new failure', 'src/b.js', 9)]
    });
    const delta = compareVerification(current, baseline);
    const changes = problemChangeMap(delta);

    expect(changes.get(problemKey(problem('test:test', 'new failure', 'src/b.js', 9)))).toBe('new');
    expect(changes.get(problemKey(problem('test:test', 'old failure', 'src/a.js', 3)))).toBe('persistent');
    expect(describeProblem(problem('test:test', 'new failure', 'src/b.js', 9), true)).toBe('src/b.js:9 — new failure');
    expect(describeProblem(problem('test:test', 'no place'), true)).toContain('место не указано');
    expect(normalizeMessage('  A   B.  ')).toBe('a b');
  });

  it('11. stores only what the next comparison needs', () => {
    const stored: StoredSnapshot = toStoredSnapshot(
      run({
        changesetId: 'batch-1',
        checks: [check('test:test', 'passed')],
        problems: [problem('test:test', 'boom', 'src/a.js', 4)]
      })
    );

    expect(stored.changesetId).toBe('batch-1');
    expect(stored.checks).toEqual([{ id: 'test:test', commandLine: 'npm run test', status: 'passed' }]);
    expect(stored.problems[0]).toMatchObject({ checkId: 'test:test', file: 'src/a.js', message: 'boom' });
  });
});
