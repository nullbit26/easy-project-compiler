import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';

/**
 * The checks the app runs itself, on screen.
 *
 * The loop used to hand the commands to the wrong side: the verdict told a non-coder to run
 * `npm install` and `tsc --noEmit` in the project folder, while this machine — which has the folder
 * and the commands — ran nothing. The strip is where that stops: the folder's own checks run here,
 * each one reports its own outcome in place, and the result is handed to whoever has to judge it.
 */

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api')>();
  return {
    ...actual,
    fetchChecksApi: vi.fn(),
    runVerificationApi: vi.fn()
  };
});

import { ProjectCheckStrip } from '../components/ProjectCheckStrip';
import { fetchChecksApi, runVerificationApi } from '../services/api';
import type { ProjectCheckDefinition, VerificationReport, VerificationResponse } from '../services/api';

const checksMock = fetchChecksApi as unknown as ReturnType<typeof vi.fn>;
const runMock = runVerificationApi as unknown as ReturnType<typeof vi.fn>;

const FOLDER = 'C:\\projects\\island-survival';

const typecheck: ProjectCheckDefinition = {
  id: 'typecheck:tsc',
  kind: 'typecheck',
  key: 'tsc',
  labelRu: 'Проверка типов',
  labelEn: 'Type check',
  commandLine: 'node node_modules/typescript/bin/tsc --noEmit --pretty false',
  tokens: ['node', 'node_modules/typescript/bin/tsc', '--noEmit']
};

const tests: ProjectCheckDefinition = {
  id: 'test:vitest',
  kind: 'test',
  key: 'vitest',
  labelRu: 'Тесты',
  labelEn: 'Tests',
  commandLine: 'node node_modules/vitest/vitest.mjs run --reporter basic',
  tokens: ['node', 'node_modules/vitest/vitest.mjs', 'run']
};

function runResult(check: ProjectCheckDefinition, status: 'passed' | 'failed', problems: string[] = []) {
  return {
    ...check,
    status,
    exitCode: status === 'passed' ? 0 : 1,
    durationMs: 2100,
    problems: problems.map((message) => ({
      severity: 'error' as const,
      message,
      raw: message,
      file: 'src/App.tsx',
      line: 12
    })),
    output: '',
    outputTruncated: false
  };
}

function response(results: ReturnType<typeof runResult>[], ok: boolean): VerificationResponse {
  const report: VerificationReport = {
    ranAt: '2026-10-18T10:00:00.000Z',
    root: FOLDER,
    ok,
    passed: results.filter((item) => item.status === 'passed').length,
    failed: results.filter((item) => item.status === 'failed').length,
    skipped: 0,
    durationMs: 5500,
    problems: results.flatMap((item) => item.problems),
    results
  };
  return {
    ...report,
    summary: {
      ranAt: report.ranAt,
      ok,
      passed: report.passed,
      failed: report.failed,
      problemCount: report.problems.length,
      errors: report.problems.length,
      warnings: 0
    },
    timeline: [],
    checkpoints: []
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  checksMock.mockResolvedValue({ checks: [typecheck, tests] });
});

describe('The check strip in the guided flow', () => {
  it('1. runs the folder’s own checks by itself when the code changes, and shows each outcome', async () => {
    runMock.mockResolvedValue(
      response([runResult(typecheck, 'failed', ['src/App.tsx:12:5 TS2322']), runResult(tests, 'passed')], false)
    );
    const onReport = vi.fn();

    const { container } = render(
      <ProjectCheckStrip root={FOLDER} autoRunKey={'backup-1'} onReport={onReport} />
    );

    await waitFor(() => expect(runMock).toHaveBeenCalledTimes(1));
    // One request for all of them: the server compares this run with the previous one in the same
    // folder, so splitting it per check would overwrite that baseline.
    expect(runMock.mock.calls[0][0].ids).toEqual(['typecheck:tsc', 'test:vitest']);

    await waitFor(() =>
      expect(container.querySelector('[data-check-row="typecheck:tsc"]')?.getAttribute('data-check-status')).toBe(
        'failed'
      )
    );
    expect(container.querySelector('[data-check-row="test:vitest"]')?.getAttribute('data-check-status')).toBe(
      'passed'
    );

    // The verdict sentence names the command that failed, not a vague "problems found".
    await waitFor(() =>
      expect(container.querySelector('[data-check-headline]')?.textContent).toContain('Проверка типов')
    );
    expect(onReport).toHaveBeenCalled();
  });

  it('2. says it is working while it works — every row, in place', async () => {
    let release: (value: VerificationResponse) => void = () => {};
    runMock.mockReturnValue(new Promise<VerificationResponse>((resolve) => (release = resolve)));

    const { container } = render(<ProjectCheckStrip root={FOLDER} autoRunKey={1} />);

    await waitFor(() => expect(container.querySelector('[data-check-running]')).toBeTruthy());
    expect(container.querySelector('[data-check-row="typecheck:tsc"]')?.getAttribute('data-check-status')).toBe(
      'running'
    );

    await act(async () => {
      release(response([runResult(typecheck, 'passed'), runResult(tests, 'passed')], true));
    });

    await waitFor(() => expect(container.querySelector('[data-check-running]')).toBeNull());
    expect(container.querySelector('[data-check-row="typecheck:tsc"]')?.getAttribute('data-check-status')).toBe(
      'passed'
    );
    expect(screen.getByText(/Проверки прошли/)).toBeTruthy();
  });

  it('3. the same write never runs the checks twice; a new write does', async () => {
    runMock.mockResolvedValue(response([runResult(typecheck, 'passed'), runResult(tests, 'passed')], true));

    const { rerender } = render(<ProjectCheckStrip root={FOLDER} autoRunKey={'backup-1'} />);
    await waitFor(() => expect(runMock).toHaveBeenCalledTimes(1));

    // A re-render of the parent for any other reason must not start another run.
    rerender(<ProjectCheckStrip root={FOLDER} autoRunKey={'backup-1'} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runMock).toHaveBeenCalledTimes(1);

    rerender(<ProjectCheckStrip root={FOLDER} autoRunKey={'backup-2'} />);
    await waitFor(() => expect(runMock).toHaveBeenCalledTimes(2));
  });

  it('4. a folder with nothing to check says so instead of pretending it verified something', async () => {
    checksMock.mockResolvedValue({ checks: [] });

    render(<ProjectCheckStrip root={FOLDER} autoRunKey={'backup-1'} />);

    await waitFor(() => expect(screen.getByText(/нечего проверять автоматически/)).toBeTruthy());
    expect(runMock).not.toHaveBeenCalled();
  });

  it('5. without a connected folder the strip is not there at all', async () => {
    const { container } = render(<ProjectCheckStrip root={null} autoRunKey={'backup-1'} />);

    expect(container.querySelector('[data-check-strip]')).toBeNull();
    expect(checksMock).not.toHaveBeenCalled();
  });
});
