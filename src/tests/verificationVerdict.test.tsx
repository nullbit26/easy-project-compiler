import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import React from 'react';

import { VerificationPanel } from '../components/VerificationPanel';
import type { VerificationReport, WeightBudget } from '../services/api';

/**
 * The verdict is what a beginner actually reads, so its wording is part of the contract:
 * "this change broke checks that used to pass" has to be visible, a pre-existing error must not
 * look like a new one, and a first run must not pretend to know what changed.
 */

function result(id: string, status: 'passed' | 'failed', problems: VerificationReport['results'][number]['problems'] = []) {
  return {
    id,
    kind: 'test' as const,
    key: id,
    labelRu: `Проверка ${id}`,
    labelEn: `Check ${id}`,
    commandLine: 'node check.js',
    tokens: ['node', 'check.js'],
    status,
    exitCode: status === 'passed' ? 0 : 1,
    durationMs: 12,
    problems,
    output: 'output',
    outputTruncated: false
  };
}

function report(overrides: Partial<VerificationReport> = {}): VerificationReport {
  return {
    ranAt: '2026-10-15T12:00:00.000Z',
    root: 'C:/projects/demo',
    ok: false,
    passed: 0,
    failed: 1,
    skipped: 0,
    durationMs: 12,
    problems: [],
    results: [result('test:test', 'failed')],
    delta: null,
    ...overrides
  };
}

function renderPanel(verification: VerificationReport | null, budget: WeightBudget | null = null) {
  return render(
    <VerificationPanel
      ru
      checks={[]}
      checksLoading={false}
      verification={verification}
      budget={budget}
      isVerifying={false}
      isFixing={false}
      autoVerify
      onToggleAutoVerify={vi.fn()}
      onVerify={vi.fn()}
      onFix={vi.fn()}
      onSaveBudget={vi.fn()}
      onOpenProblem={vi.fn()}
    />
  );
}

/** The ceiling as the screen knows it: its size, plus what the last measured build made of it. */
function budget(bytes: number | null, verdict: WeightBudget['verdict'] = null): WeightBudget {
  return { bytes, setAt: null, verdict };
}

describe('The check panel verdict', () => {
  it('1. says which checks this change broke, and marks the new problem as new', () => {
    const newProblem = {
      file: 'src/math.js',
      line: 41,
      severity: 'error' as const,
      message: 'the BROKEN marker is still there.',
      raw: 'src/math.js(41,1): error TS2322: the BROKEN marker is still there.',
      change: 'new' as const
    };
    const oldProblem = {
      file: 'src/legacy.js',
      line: 1,
      severity: 'error' as const,
      message: 'Cannot find name legacy.',
      raw: 'src/legacy.js(1,1): error TS2304: Cannot find name legacy.',
      change: 'persistent' as const
    };

    renderPanel(
      report({
        problems: [newProblem, oldProblem],
        results: [result('test:test', 'failed', [newProblem, oldProblem])],
        delta: {
          compared: true,
          baselineRanAt: '2026-10-15T11:00:00.000Z',
          baselineChangesetId: 'batch-1',
          regressedChecks: [
            { id: 'test:test', labelRu: 'Тесты', labelEn: 'Tests', from: 'passed', to: 'failed' }
          ],
          recoveredChecks: [],
          newProblems: [
            { checkId: 'test:test', file: 'src/math.js', line: 41, severity: 'error', message: 'the BROKEN marker is still there.' }
          ],
          fixedProblems: [],
          persistentProblems: [
            { checkId: 'test:test', file: 'src/legacy.js', line: 1, severity: 'error', message: 'Cannot find name legacy.' }
          ]
        }
      })
    );

    expect(screen.getByText('Эта правка сломала проверки, которые раньше проходили')).toBeTruthy();
    expect(screen.getByText(/Тесты: раньше проходила, теперь упала/)).toBeTruthy();
    expect(screen.getByText(/src\/math.js:41 — the BROKEN marker/)).toBeTruthy();
    expect(screen.getByText(/Сравнение с прошлым прогоном проверок/)).toBeTruthy();
    expect(screen.getByText('новое')).toBeTruthy();
    expect(screen.getByText('было и раньше')).toBeTruthy();
    // The repair is offered as "fix what broke", not as a general cleanup.
    expect(screen.getByText('ИИ: исправить то, что сломала эта правка')).toBeTruthy();
  });

  it('2. says plainly when nothing new broke', () => {
    const oldProblem = {
      file: 'src/legacy.js',
      line: 1,
      severity: 'error' as const,
      message: 'Cannot find name legacy.',
      raw: 'src/legacy.js(1,1): error TS2304: Cannot find name legacy.',
      change: 'persistent' as const
    };

    renderPanel(
      report({
        problems: [oldProblem],
        results: [result('test:test', 'failed', [oldProblem])],
        delta: {
          compared: true,
          baselineRanAt: '2026-10-15T11:00:00.000Z',
          baselineChangesetId: null,
          regressedChecks: [],
          recoveredChecks: [],
          newProblems: [],
          fixedProblems: [],
          persistentProblems: [
            { checkId: 'test:test', file: 'src/legacy.js', line: 1, severity: 'error', message: 'Cannot find name legacy.' }
          ]
        }
      })
    );

    expect(screen.getByText('Ничего нового не сломалось')).toBeTruthy();
    expect(screen.getByText(/были и в прошлом прогоне: 1/)).toBeTruthy();
    // No new failures, so the fix button stays the ordinary one.
    expect(screen.getByText('ИИ: исправить ошибки проверки')).toBeTruthy();
  });

  it('3. reports what a repair fixed', () => {
    renderPanel(
      report({
        ok: true,
        failed: 0,
        passed: 1,
        results: [result('test:test', 'passed')],
        delta: {
          compared: true,
          baselineRanAt: '2026-10-15T11:00:00.000Z',
          baselineChangesetId: null,
          regressedChecks: [],
          recoveredChecks: [{ id: 'test:test', labelRu: 'Тесты', labelEn: 'Tests', from: 'failed', to: 'passed' }],
          newProblems: [],
          fixedProblems: [
            { checkId: 'test:test', file: 'src/math.js', line: 3, severity: 'error', message: 'the BROKEN marker is still there.' }
          ],
          persistentProblems: []
        }
      })
    );

    expect(screen.getByText('Ничего нового не сломалось — стало лучше')).toBeTruthy();
    expect(screen.getByText(/Тесты: снова проходит/)).toBeTruthy();
    expect(screen.getByText(/src\/math.js:3 — the BROKEN marker/)).toBeTruthy();
    expect(screen.getByText('Все проверки прошли.')).toBeTruthy();
  });

  it('5. can hide the errors that were there before, leaving only what broke now', async () => {
    const newProblem = {
      file: 'src/math.js',
      line: 41,
      severity: 'error' as const,
      message: 'the new failure',
      raw: 'src/math.js(41,1): error: the new failure',
      change: 'new' as const
    };
    const oldProblem = {
      file: 'src/legacy.js',
      line: 1,
      severity: 'error' as const,
      message: 'the old failure',
      raw: 'src/legacy.js(1,1): error: the old failure',
      change: 'persistent' as const
    };

    renderPanel(
      report({
        problems: [newProblem, oldProblem],
        results: [result('test:test', 'failed', [newProblem, oldProblem])],
        delta: {
          compared: true,
          baselineRanAt: '2026-10-15T11:00:00.000Z',
          baselineChangesetId: null,
          regressedChecks: [{ id: 'test:test', labelRu: 'Тесты', labelEn: 'Tests', from: 'passed', to: 'failed' }],
          recoveredChecks: [],
          newProblems: [
            { checkId: 'test:test', file: 'src/math.js', line: 41, severity: 'error', message: 'the new failure' }
          ],
          fixedProblems: [],
          persistentProblems: [
            { checkId: 'test:test', file: 'src/legacy.js', line: 1, severity: 'error', message: 'the old failure' }
          ]
        }
      })
    );

    expect(screen.getByText(/новых: 1, было и раньше: 1/)).toBeTruthy();
    expect(screen.getByText('the new failure')).toBeTruthy();
    expect(screen.getByText('the old failure')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: /только новые/ }));
    });

    expect(screen.getByText('the new failure')).toBeTruthy();
    expect(screen.queryByText('the old failure')).toBeNull();
  });

  it('4. shows how heavy the build became, and says nothing when nothing was built', () => {
    renderPanel(
      report({
        ok: true,
        passed: 1,
        failed: 0,
        results: [{ ...result('build:build', 'passed'), kind: 'build' as const }],
        build: {
          at: '2026-10-15T12:00:00.000Z',
          dir: 'dist',
          bytes: 1_450_000,
          fileCount: 12,
          truncated: false,
          deltaBytes: 120_000,
          deltaPct: 9,
          heavy: true
        }
      })
    );

    expect(screen.getByText(/Сборка заметно потяжелела/)).toBeTruthy();
    expect(screen.getByText(/Сборка \(dist\): 1.38 MB/)).toBeTruthy();

    // A folder that built nothing gets no number invented for it.
    cleanup();
    renderPanel(report({ build: null }));
    expect(screen.queryByText(/Сборка \(/)).toBeNull();
  });

  it('5b. judges the build against the budget the project set, and offers to shrink it', () => {
    const overBudget = budget(512_000, {
      bytes: 512_000,
      actual: 1_450_000,
      over: true,
      deltaBytes: 938_000,
      usedPct: 283.2
    });

    renderPanel(
      report({
        ok: true,
        passed: 1,
        failed: 0,
        results: [{ ...result('build:build', 'passed'), kind: 'build' as const }],
        build: {
          at: '2026-10-15T12:00:00.000Z',
          dir: 'dist',
          bytes: 1_450_000,
          fileCount: 12,
          truncated: false,
          deltaBytes: null,
          deltaPct: null,
          heavy: false
        }
      }),
      overBudget
    );

    // The number stops being a report and becomes a verdict with a way out of it.
    expect(screen.getByText(/Бюджет превышен/)).toBeTruthy();
    expect(screen.getByText(/при пределе 500\.0 KB/)).toBeTruthy();
    expect(screen.getByText('ИИ: вернуть сборку в бюджет')).toBeTruthy();
    // The verdict stays on the working screen; the field that writes the ceiling is a setting.
    expect(screen.queryByRole('textbox', { name: 'Бюджет веса' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Настройки сборки' }));
    expect((screen.getByRole('textbox', { name: 'Бюджет веса' }) as HTMLInputElement).value).toBe('500 KB');

    cleanup();
    renderPanel(
      report({ ok: true, passed: 1, failed: 0, results: [{ ...result('build:build', 'passed'), kind: 'build' as const }] }),
      budget(2_000_000, { bytes: 2_000_000, actual: 1_450_000, over: false, deltaBytes: -550_000, usedPct: 72.5 })
    );
    expect(screen.getByText(/Бюджет соблюдён/)).toBeTruthy();
    // Nothing over budget, so nothing is offered to repair.
    expect(screen.queryByText('ИИ: вернуть сборку в бюджет')).toBeNull();

    // No ceiling at all: the working screen says nothing about one instead of inventing it.
    cleanup();
    renderPanel(report({ ok: true, passed: 1, failed: 0 }), budget(null));
    expect(screen.queryByText(/Бюджет/)).toBeNull();

    // A ceiling written down before anything was built is honest about what it can say.
    cleanup();
    renderPanel(report({ ok: true, passed: 1, failed: 0 }), budget(512_000));
    expect(screen.getByText(/сборку ещё не измеряли/)).toBeTruthy();
    expect(screen.queryByText('ИИ: вернуть сборку в бюджет')).toBeNull();

    // The budget is not a reward for running the checks: a folder that has never been checked
    // still gets to write one down.
    cleanup();
    renderPanel(null, budget(null));
    fireEvent.click(screen.getByRole('button', { name: 'Настройки сборки' }));
    expect(screen.getByRole('button', { name: 'Задать бюджет' })).toBeTruthy();
  });

  it('5c. offers to clear a new finding even though every check passed', () => {
    const warning = {
      file: 'src/app.js',
      line: 7,
      severity: 'warning' as const,
      message: 'unused variable leftover',
      raw: 'src/app.js:7:5 warning: unused variable leftover',
      change: 'new' as const
    };

    renderPanel(
      report({
        ok: true,
        passed: 1,
        failed: 0,
        problems: [warning],
        results: [result('test:test', 'passed', [warning])],
        delta: {
          compared: true,
          baselineRanAt: '2026-10-15T11:00:00.000Z',
          baselineChangesetId: null,
          regressedChecks: [],
          recoveredChecks: [],
          newProblems: [
            { checkId: 'test:test', file: 'src/app.js', line: 7, severity: 'warning', message: 'unused variable leftover' }
          ],
          fixedProblems: [],
          persistentProblems: []
        }
      })
    );

    expect(screen.getByText('Все проверки прошли.')).toBeTruthy();
    expect(screen.getByText('новое')).toBeTruthy();
    // A warning is called a finding, not an error, even though the verdict is worth reading.
    expect(screen.getByText('Эта правка добавила новые замечания')).toBeTruthy();
    expect(screen.getByText(/Замечания проверок \(1\)/)).toBeTruthy();
    // The report is not where it stops: a green run with a new finding is still work.
    expect(screen.getByText('ИИ: убрать замечания, которые добавила эта правка (1)')).toBeTruthy();

    // Without a new finding there is nothing to hand over.
    cleanup();
    renderPanel(report({ ok: true, passed: 1, failed: 0, results: [result('test:test', 'passed')] }));
    expect(screen.queryByText(/убрать замечания/)).toBeNull();
  });

  it('5. does not pretend to know what changed on the first run', () => {
    const problem = {
      file: 'src/legacy.js',
      severity: 'error' as const,
      message: 'Cannot find name legacy.',
      raw: 'src/legacy.js: Cannot find name legacy.'
    };

    renderPanel(report({ problems: [problem], results: [result('test:test', 'failed', [problem])] }));

    expect(screen.getByText(/Это первый прогон проверок в этой папке/)).toBeTruthy();
    expect(screen.queryByText('Ничего нового не сломалось')).toBeNull();
    expect(screen.queryByText('новое')).toBeNull();
  });
});
