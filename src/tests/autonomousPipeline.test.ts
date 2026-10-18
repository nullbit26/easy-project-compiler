import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The pipeline promises, pinned where the code lives:
 *   - tasks run back to back: the next one starts only after the previous verdict;
 *   - a task with an unfinished dependency is skipped until that dependency is done;
 *   - the first failing task stops the queue — the plan behind it is not built on top of it;
 *   - every verdict is handed to the caller as it happens, with the plan task's own id.
 */

vi.mock('../../server/services/workspaceFiles', () => ({
  applyFileChanges: vi.fn(() => ({
    backupId: 'bk-1',
    results: [{ path: 'src/a.ts', action: 'create', status: 'created' }],
    applied: 1
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
    constructor(public code: string, message: any) {
      super(message);
    }
  }
}));

vi.mock('../../server/services/codeFormatter', () => ({
  formatWorkspaceFiles: vi.fn(async () => ({ ran: true, toolLabel: 'Prettier', changed: [], files: [] })),
  summarizeFormatting: vi.fn(() => ({ at: 'now', tool: 'Prettier', changed: 0, files: 0 }))
}));

const callAiJson = vi.fn();
const runVerification = vi.fn();

vi.mock('../../server/ai/aiProvider', () => ({
  callAiJson: (...args: any[]) => callAiJson(...args),
  getEngineLabel: vi.fn(() => 'test-engine'),
  hasAiProvider: vi.fn(() => true),
  Type: {}
}));

vi.mock('../../server/services/projectChecks', () => ({
  runVerification: (...args: any[]) => runVerification(...args),
  summarizeReport: vi.fn((report: any) => ({ ranAt: report?.ranAt, ok: report?.ok })),
  Type: {}
}));

const aiMod = await import('../../server/ai/aiProvider');
const { pickNextPipelineTask, startPipeline } = await import('../../server/services/autonomousLoop');
const { autonomousLog } = await import('../../server/services/autonomousEvents');

const checksMod = await import('../../server/services/projectChecks');

function verification(status: 'pass' | 'fail') {
  return {
    ranAt: 'now',
    ok: status === 'pass',
    passesd: 0,
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
        tokens: [],
        status: status === 'pass' ? 'passed' : 'failed',
        exitCode: status === 'pass' ? 0 : 2,
        durationMs: 1,
        problems: [],
        output: status === 'pass' ? '' : 'error TS9999: broken',
        outputTruncated: false
      }
    ]
  } as any;
}

describe('Picking the next task of the queue', () => {
  it('takes the first not-done, unblocked task, in plan order', () => {
    const done = new Set(['a']);
    const next = pickNextPipelineTask(
      [
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' }
      ],
      done
    );
    expect(next?.id).toBe('b');
  });

  it('holds a task back while any of its dependencies is not done', () => {
    const next = pickNextPipelineTask(
      [
        { id: 'a', title: 'A', dependencies: ['x'] },
        { id: 'b', title: 'B' }
      ],
      new Set()
    );
    expect(next?.id).toBe('b');
  });

  it('unblocks the task as soon as its dependency is done', () => {
    const next = pickNextPipelineTask([{ id: 'a', title: 'A', dependencies: ['x'] }], new Set(['x']));
    expect(next?.id).toBe('a');
  });

  it('returns null on an empty or fully-done queue', () => {
    expect(pickNextPipelineTask([], new Set())).toBeNull();
    expect(pickNextPipelineTask([{ id: 'a', title: 'A' }], new Set(['a']))).toBeNull();
  });
});

describe('The pipeline run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callAiJson.mockReset();
    runVerification.mockReset();
    vi.spyOn(aiMod, 'hasAiProvider').mockReturnValue(true);
  });

  it('runs two tasks back to back and reports each verdict as it happens', async () => {
    callAiJson.mockResolvedValue({ summary: 'ok', changes: [{ path: 'src/a.ts', action: 'create', content: 'x', reason: '' }] });
    runVerification.mockResolvedValue(verification('pass'));

    const verdicts: any[] = [];
    const result = await startPipeline(
      [
        { id: 't1', title: 'Task one' },
        { id: 't2', title: 'Task two' }
      ],
      {
        ru: false,
        onTaskDone: (detail) => verdicts.push(detail)
      }
    );

    expect(result.stoppedBecause).toBe('queue_empty');
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks.every((t: any) => t.result === 'completed')).toBe(true);
    expect(callAiJson).toHaveBeenCalledTimes(2);
    expect(verdicts.map((v) => ({ id: v.taskId, result: v.result }))).toEqual([
      { id: 't1', result: 'completed' },
      { id: 't2', result: 'completed' }
    ]);
  });

  it('stops at the first failing task and leaves the rest untouched', async () => {
    callAiJson.mockResolvedValue({ summary: 'ok', changes: [{ path: 'src/a.ts', action: 'create', content: 'x', reason: '' }] });
    runVerification.mockResolvedValue(verification('fail'));

    const verdicts: any[] = [];
    const result = await startPipeline(
      [
        { id: 't1', title: 'Task one' },
        { id: 't2', title: 'Task two' }
      ],
      {
        ru: false,
        onTaskDone: (detail) => verdicts.push(detail)
      }
    );

    expect(result.stoppedBecause).toBe('task_failed');
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].result).toBe('failed');
    // The second task was never started: four attempts of t1 were the whole effort.
    expect(callAiJson).toHaveBeenCalledTimes(4);
  });

  it('skips a blocked task and runs the one behind it', async () => {
    callAiJson.mockResolvedValue({ summary: 'ok', changes: [{ path: 'src/a.ts', action: 'create', content: 'x', reason: '' }] });
    runVerification.mockResolvedValue(verification('pass'));

    const result = await startPipeline(
      [
        { id: 'blocked1', title: 'Blocked task', dependencies: ['ghost-dep'] },
        { id: 'free1', title: 'Free task' }
      ],
      { ru: false }
    );

    // The pipeline finished with the free task, and only that one ran.
    expect(result.stoppedBecause).toBe('queue_empty');
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].taskId).toBe('free1');
  });

  it('looks like an honest run in the log: queue opened, each task closed, cap line at the end', async () => {
    callAiJson.mockResolvedValue({ summary: 'ok', changes: [{ path: 'src/a.ts', action: 'create', content: 'x', reason: '' }] });
    runVerification.mockResolvedValue(verification('pass'));

    const types: any[] = [];
    const off = autonomousLog.subscribe((e) => types.push(e.type));
    await startPipeline([{ id: 't1', title: 'Task one' }, { id: 't2', title: 'Task two' }], { ru: false });
    off();

    // One terminal event per task run, plus the pipeline's own closing line.
    expect(types.filter((t) => t === 'run_completed')).toHaveLength(3);
    expect(types.at(-1)).toBe('run_completed');
  });
});
