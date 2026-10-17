import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * The verdict is only worth something if it changes what happens next. This test keeps the
 * promise the panel makes when it offers "fix what this change broke": the model receives the
 * new failures, not the folder's whole backlog of old ones — a request scoped to the last change
 * is what keeps a repair from turning into a rewrite.
 */

vi.mock('../../server/ai/aiProvider', () => ({ hasAiProvider: () => true }));
vi.mock('../../server/services/changeProposals', () => ({ proposeFileChanges: vi.fn() }));

import { proposeFileChanges } from '../../server/services/changeProposals';
import { fixChecks } from '../../server/controllers/files.controller';
import { bindWorkspace, resetWorkspaceStoreForTests } from '../../server/store/workspaceStore';

const proposeMock = proposeFileChanges as unknown as ReturnType<typeof vi.fn>;

let sandbox: string;
let projectRoot: string;

beforeAll(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'epc-fix-scope-'));
  process.env.EPC_WORKSPACE_FILE = path.join(sandbox, 'workspace.json');
  process.env.EPC_WORKSPACE_BACKUP_DIR = path.join(sandbox, 'backups');
});

beforeEach(() => {
  resetWorkspaceStoreForTests();
  projectRoot = fs.mkdtempSync(path.join(sandbox, 'project-'));
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'src', 'new.js'), 'export const broken = true;\n', 'utf8');
  fs.writeFileSync(path.join(projectRoot, 'src', 'legacy.js'), 'export const legacy = 1;\n', 'utf8');
  bindWorkspace(projectRoot);

  proposeMock.mockReset();
  proposeMock.mockResolvedValue({
    summary: 'A repair',
    changes: [],
    warnings: [],
    root: projectRoot
  });
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

/** A minimal Express response that records what the handler answered. */
function responseRecorder() {
  const state: { status: number; body: any } = { status: 200, body: null };
  const res: any = {
    status(code: number) {
      state.status = code;
      return res;
    },
    json(payload: any) {
      state.body = payload;
      return res;
    }
  };
  return { res, state };
}

function reportWithVerdict() {
  return {
    ranAt: '2026-10-15T12:00:00.000Z',
    root: projectRoot,
    ok: false,
    passed: 1,
    failed: 1,
    skipped: 0,
    durationMs: 20,
    problems: [
      {
        file: 'src/new.js',
        line: 1,
        severity: 'error',
        message: 'the new failure',
        raw: 'src/new.js(1,1): error TS2322: the new failure',
        change: 'new'
      },
      {
        file: 'src/legacy.js',
        line: 1,
        severity: 'error',
        message: 'the old failure',
        raw: 'src/legacy.js(1,1): error TS2304: the old failure',
        change: 'persistent'
      }
    ],
    results: [
      { id: 'custom:user', kind: 'custom', key: 'user', labelRu: 'Своя команда', labelEn: 'Custom command', commandLine: 'node check.js', tokens: ['node', 'check.js'], status: 'failed', exitCode: 1, durationMs: 20, problems: [], output: 'failing output', outputTruncated: false }
    ],
    delta: {
      compared: true,
      baselineRanAt: '2026-10-15T11:00:00.000Z',
      baselineChangesetId: null,
      regressedChecks: [
        { id: 'custom:user', labelRu: 'Своя команда', labelEn: 'Custom command', from: 'passed', to: 'failed' }
      ],
      recoveredChecks: [],
      newProblems: [{ checkId: 'custom:user', file: 'src/new.js', line: 1, severity: 'error', message: 'the new failure' }],
      fixedProblems: [],
      persistentProblems: [{ checkId: 'custom:user', file: 'src/legacy.js', line: 1, severity: 'error', message: 'the old failure' }]
    }
  };
}

describe('Repairing what the change broke', () => {
  it('1. sends the new failure and the regression, and leaves the old error out', async () => {
    const { res, state } = responseRecorder();

    await fixChecks({ body: { verification: reportWithVerdict(), language: 'ru' }, method: 'POST', path: '/fix-checks' } as any, res);

    expect(state.body.success).toBe(true);
    expect(proposeMock).toHaveBeenCalledTimes(1);
    const sent = proposeMock.mock.calls[0][0];

    expect(sent.extraSection).toContain('src/new.js');
    expect(sent.extraSection).toContain('Своя команда');
    expect(sent.extraSection).toContain('ПЕРЕСТАЛИ ПРОХОДИТЬ');
    // The old error is not what the model is asked to fix.
    expect(sent.extraSection).not.toContain('the old failure');
    // ...and it is not offered as a file to change either.
    expect(sent.targetFiles).toEqual(['src/new.js']);
    expect(String(sent.taskTitle)).toContain('которые сломались');
    expect(sent.extraRules.join(' ')).toContain('11.');
  });

  it('1b. hands over new findings even when every check still passes', async () => {
    const { res, state } = responseRecorder();
    const report = reportWithVerdict();
    // A lint warning that does not fail the check: the run is green, the finding is new.
    const warning = {
      file: 'src/new.js',
      line: 3,
      severity: 'warning' as const,
      message: 'unused variable unusedInNew',
      raw: 'src/new.js:3:5 warning: unused variable unusedInNew',
      change: 'new' as const
    };
    const passing = {
      ...report,
      ok: true,
      failed: 0,
      passed: 1,
      problems: [warning],
      results: [{ ...report.results[0], status: 'passed', exitCode: 0, problems: [warning] }],
      delta: {
        ...report.delta,
        regressedChecks: [],
        newProblems: [{ checkId: 'custom:user', file: 'src/new.js', line: 3, severity: 'warning', message: 'unused variable unusedInNew' }],
        persistentProblems: []
      }
    };

    await fixChecks({ body: { verification: passing, language: 'ru' }, method: 'POST', path: '/fix-checks' } as any, res);

    expect(state.body.success).toBe(true);
    const sent = proposeMock.mock.calls[0][0];
    // The heading tells the model the truth: nothing is broken, something new is untidy.
    expect(sent.extraSection).toContain('НОВЫЕ ЗАМЕЧАНИЯ');
    expect(sent.extraSection).toContain('unused variable unusedInNew');
    expect(String(sent.taskTitle)).toContain('Убрать замечания');
    expect(sent.extraRules.join(' ')).toContain('12.');
  });

  it('1c. sends an over-budget build back as a task of its own', async () => {
    const { res, state } = responseRecorder();
    const report = reportWithVerdict();
    // Everything passes and nothing is broken — the build is simply too heavy.
    const passing = {
      ...report,
      ok: true,
      failed: 0,
      passed: 1,
      problems: [],
      results: [{ ...report.results[0], status: 'passed', exitCode: 0, problems: [] }],
      delta: { ...report.delta, regressedChecks: [], newProblems: [], persistentProblems: [] }
    };
    const budget = { bytes: 512_000, actual: 1_450_000, over: true, deltaBytes: 938_000, usedPct: 283.2 };

    await fixChecks({ body: { verification: passing, budget, language: 'ru' }, method: 'POST', path: '/fix-checks' } as any, res);

    expect(state.body.success).toBe(true);
    const sent = proposeMock.mock.calls[0][0];
    expect(sent.extraSection).toContain('БЮДЖЕТ ВЕСА ПРЕВЫШЕН');
    expect(sent.extraSection).toContain('1.38 MB');
    expect(sent.extraSection).toContain('500.0 KB');
    expect(sent.extraSection).toContain('283.2%');
    expect(String(sent.taskTitle)).toContain('Уменьшить вес сборки');
    // The reduction has to keep the project working, and the re-check is the build itself.
    expect(sent.extraRules.join(' ')).toContain('13.');
    // No check failed, so the re-check is "run everything that this folder has" — which includes
    // the build that produced the number, and therefore judges the budget again.
    expect(state.body.data.recheckIds).toEqual([]);

    // Within budget and green: there is genuinely nothing to do.
    proposeMock.mockClear();
    const withinBudget = responseRecorder();
    await fixChecks(
      {
        body: { verification: passing, budget: { ...budget, over: false, deltaBytes: -200_000 }, language: 'ru' },
        method: 'POST',
        path: '/fix-checks'
      } as any,
      withinBudget.res
    );
    expect(withinBudget.state.status).toBe(400);
    expect(withinBudget.state.body.error).toBe('nothing_to_fix');
    expect(proposeMock).not.toHaveBeenCalled();
  });

  it('2. keeps the whole list when there is no verdict to narrow it with', async () => {
    const { res, state } = responseRecorder();
    const report = reportWithVerdict();
    // No delta: the app cannot tell what is new, so it must not pretend to.
    const { delta, ...withoutVerdict } = report;

    await fixChecks({ body: { verification: withoutVerdict, language: 'ru' }, method: 'POST', path: '/fix-checks' } as any, res);

    expect(state.body.success).toBe(true);
    const sent = proposeMock.mock.calls[0][0];
    expect(sent.extraSection).toContain('the new failure');
    expect(sent.extraSection).toContain('the old failure');
    expect(sent.targetFiles).toEqual(['src/new.js', 'src/legacy.js']);
    expect(sent.extraRules.join(' ')).not.toContain('11.');
  });
});
