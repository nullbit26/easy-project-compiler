import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The loop's promises, pinned where the code lives:
 *   - one AI answer becomes validated writes on disk, then formatting, then the real checks;
 *   - a failed attempt is UNDONE before the next attempt writes, so the disk holds one attempt;
 *   - the repair packet carries the failing commands and their output, not the whole transcript;
 *   - the run ends after its attempt cap, in whichever state it reached.
 *
 * The workspace store is stubbed at its boundary — the loop is the thing under test, not path
 * normalization, which has its own tests.
 */

vi.mock('../../server/services/workspaceFiles', () => ({
  applyFileChanges: vi.fn(() => ({
    backupId: 'bk-1',
    results: [
      { path: 'src/a.ts', action: 'create', status: 'created' },
      { path: 'src/b.ts', action: 'update', status: 'updated' }
    ],
    applied: 2
  })),
  undoFileChanges: vi.fn(),
  attachFormatting: vi.fn(),
  attachVerification: vi.fn(),
  readWorkspaceTextFile: vi.fn(() => ({ content: '' })),
  scanWorkspace: vi.fn(() => ({ files: [{ path: 'src/a.ts' }] }))
}));

vi.mock('../../server/store/workspaceStore', () => ({
  getWorkspaceRoot: vi.fn(() => '/fake/root'),
  resolveWorkspacePath: vi.fn((p: unknown) => `/fake/root/${String(p)}`),
  toRelativePath: vi.fn((p: unknown) => String(p).replace('/fake/root/', '')),
  WorkspaceError: class extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  }
}));

vi.mock('../../server/services/codeFormatter', () => ({
  formatWorkspaceFiles: vi.fn(async () => ({ ran: true, toolLabel: 'Prettier', changed: [], files: [] })),
  summarizeFormatting: vi.fn(() => ({ at: 'now', tool: 'Prettier', changed: 0, files: 0 }))
}));

const undoFileChanges = vi.mocked((await import('../../server/services/workspaceFiles')).undoFileChanges);
const applyFileChanges = vi.mocked((await import('../../server/services/workspaceFiles')).applyFileChanges);

const { autonomousLog } = await import('../../server/services/autonomousEvents');
const { runAutonomousTask } = await import('../../server/services/autonomousLoop');

const task = {
  taskTitle: 'Add a delete button',
  goal: 'Records can be deleted',
  acceptanceCriteria: ['the button exists'],
  ru: false
};

function mockAi(answerForAttempt: (attempt: number) => any) {
  let attempt = 0;
  const callAiJson = vi.fn(async () => {
    attempt += 1;
    return answerForAttempt(attempt);
  });
  const runVerification = vi.fn(async () => verificationOf('fail'));
  const mod = {
    callAiJson,
    runVerification,
    setVerification: (status: 'pass' | 'fail') => {
      runVerification.mockImplementation(async () => verificationOf(status));
    }
  };
  return mod;
}

function verificationOf(status: 'pass' | 'fail') {
  return status === 'pass'
    ? {
        ranAt: 'now',
        ok: true,
        results: [{ id: 'lint', kind: 'lint', key: 'lint', commandLine: 'npm run lint', status: 'passed', exitCode: 0, problems: [], labelRu: 'Линт', labelEn: 'Lint' }]
      }
    : {
        ranAt: 'now',
        ok: false,
        results: [
          {
            id: 'tsc',
            kind: 'typecheck',
            key: 'tsc',
            commandLine: 'tsc --noEmit',
            status: 'failed',
            exitCode: 2,
            output: 'src/a.ts:1: FORCE ERROR',
            problems: [{ file: 'src/a.ts', line: 1, raw: 'FORCE ERROR' }],
            labelRu: 'Типы',
            labelEn: 'Types'
          }
        ]
      };
}

/** Stub the two modules the loop reaches into that its tests do not provide. */
async function stubInternals(behavior: { verify: 'pass' | 'fail' | ('fail' | 'pass')[] }) {
  const ai = await import('../../server/ai/aiProvider');
  const checks = await import('../../server/services/projectChecks');
  const plan = Array.isArray(behavior.verify) ? [...behavior.verify] : [behavior.verify];

  vi.spyOn(ai, 'hasAiProvider').mockReturnValue(true);
  vi.spyOn(ai, 'getEngineLabel').mockReturnValue('test-engine');
  vi.spyOn(ai, 'callAiJson').mockImplementation(async () => ({
    summary: 'attempt',
    changes: [{ path: 'src/a.ts', action: 'create', content: 'export{};', reason: 'r' }]
  }));
  vi.spyOn(checks, 'runVerification').mockImplementation(async () => {
    const status: 'pass' | 'fail' = plan.length > 1 ? (plan.shift() as any) : plan[0];
    return {
      ranAt: 'now',
      ok: status === 'pass',
      passed: status === 'pass' ? 1 : 0,
      failed: status === 'pass' ? 0 : 1,
      problems: [],
      results: [
        {
          id: 'check:1',
          kind: 'typecheck',
          key: 'tsc',
          labelRu: 'Типы',
          labelEn: 'Types',
          commandLine: 'tsc --noEmit',
          status: status === 'pass' ? 'passed' : 'failed',
          exitCode: status === 'pass' ? 0 : 2,
          durationMs: 1,
          problems: [],
          output: status === 'pass' ? '' : 'error TS9999: broken thing',
          outputTruncated: false,
          error: undefined,
          tokens: []
        }
      ]
    } as any;
  });
}

describe('The autonomous loop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    undoFileChanges.mockClear();
    applyFileChanges.mockClear();
  });

  it('completes on the first attempt when every check passes', async () => {
    await stubInternals({ verify: 'pass' });

    const result = await runAutonomousTask(task);

    expect(result.status).toBe('completed');
    expect(result.attempts).toBe(1);
    expect(result.verdict).toBe('pass');
    expect(applyFileChanges).toHaveBeenCalledTimes(1);
    expect(undoFileChanges).not.toHaveBeenCalled();
  });

  it('undoes the failed attempt before the next one writes', async () => {
    await stubInternals({ verify: ['fail', 'pass'] });

    const result = await runAutonomousTask(task);

    expect(result.status).toBe('completed');
    expect(result.attempts).toBe(2);
    // The failed batch was rolled back first, then written again once.
    expect(undoFileChanges).toHaveBeenCalledTimes(1);
    expect(applyFileChanges).toHaveBeenCalledTimes(2);
  });

  it('stops after its attempt cap and leaves the last write undoable', async () => {
    await stubInternals({ verify: 'fail' });

    const result = await runAutonomousTask(task);

    expect(result.status).toBe('failed');
    expect(result.maxAttempts).toBe(4);
    // Every failed batch except the last was rolled back; the last one stays with its undo link.
    expect(undoFileChanges).toHaveBeenCalledTimes(3);
    expect(applyFileChanges).toHaveBeenCalledTimes(4);
    expect(result.backupId).toBe('bk-1');
  });

  it('keeps the batch and stops on the first answer when the project has no checks', async () => {
    // A project with no checks used to be read as four failed checks: each retry rolled the last
    // batch back and the log said «Проверки не настроены» and «Проверки не прошли» in turn.
    await stubInternals({ verify: 'pass' });
    const checks = await import('../../server/services/projectChecks');
    vi.spyOn(checks, 'runVerification').mockImplementation(
      async () => ({ ranAt: 'now', ok: true, passed: 0, failed: 0, problems: [], results: [] } as any)
    );

    const seen: any[] = [];
    const off = autonomousLog.subscribe((e) => seen.push(e));
    const result = await runAutonomousTask(task);
    off();

    expect(result.status).toBe('completed');
    expect(result.verdict).toBe('none');
    expect(result.attempts).toBe(1);
    expect(undoFileChanges).not.toHaveBeenCalled();
    expect(applyFileChanges).toHaveBeenCalledTimes(1);

    const completed = seen.find((e) => e.type === 'run_completed');
    expect(completed?.text).toContain('no checks');
    expect(seen.some((e) => e.type === 'attempt_failed')).toBe(false);
    expect(completed?.text).not.toContain('every check passed');
  });

  it('recovers from a model answer with no changes and keeps the loop alive', async () => {
    const ai = await import('../../server/ai/aiProvider');
    await stubInternals({ verify: 'pass' });
    // Attempt 1 answers with nothing; attempt 2 answers properly and passes.
    const real = ai.callAiJson as any;
    let n = 0;
    (real as any).mockImplementation(async () => {
      n += 1;
      return n === 1
        ? { summary: 'nothing to do', changes: [] }
        : { summary: 'ok', changes: [{ path: 'src/a.ts', action: 'create', content: 'x', reason: '' }] };
    });

    const result = await runAutonomousTask(task);

    expect(result.status).toBe('completed');
    expect(result.attempts).toBe(2);
  });

  it('refuses to start without a connected folder', async () => {
    const store = await import('../../server/store/workspaceStore');
    vi.spyOn(store, 'getWorkspaceRoot').mockReturnValueOnce(null);

    await expect(runAutonomousTask(task)).rejects.toMatchObject({ code: 'no_workspace' });
  });

  it('events tell the story a reader needs: attempts, verdict, undo, cap', async () => {
    await stubInternals({ verify: ['fail', 'pass'] });

    const seen: any[] = [];
    const { autonomousLog: log } = await import('../../server/services/autonomousEvents');
    const off = log.subscribe((e) => seen.push(e.type));
    await runAutonomousTask(task);
    off();

    expect(seen.filter((t) => t === 'attempt_started').length).toBeGreaterThanOrEqual(2);
    expect(seen).toContain('formatting');
    expect(seen).toContain('verdict');
    expect(seen).toContain('repairing');
    expect(seen).toContain('run_completed');
  });

  it('the failure report stays bounded: diagnosis and raw output are capped, not the whole transcript', async () => {
    const ai = await import('../../server/ai/aiProvider');
    const checks = await import('../../server/services/projectChecks');
    let prompts: string[] = [];
    await stubInternals({ verify: ['fail', 'fail'] });

    const real = ai.callAiJson as any;
    (real as any).mockImplementation(async (prompt: string) => {
      prompts.push(prompt);
      return { summary: 'retrying', changes: [{ path: 'src/a.ts', action: 'create', content: 'x', reason: '' }] };
    });

    const result = await runAutonomousTask(task);
    expect(result.status).toBe('failed');

    const repair = prompts[1];
    expect(repair).toContain('WHAT THE CHECKS SAID');
    expect(repair).toContain('error TS9999: broken thing');
    // The transcript itself never travels — only the failing commands and their capped output.
    expect(repair.length).toBeLessThan(20_000);
  });
});
