import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The review endpoint with the app's own check run in front of it.
 *
 * Two things are asserted here, on both engines. The offline one (no provider configured — what most
 * users have) has to put the check result in the verdict instead of inventing a 100%, and a model
 * that answers "Completed" over a failing check has to be corrected rather than believed. The
 * screenshots of the beginner loop are the reason: "0% · попытка 4" next to an instruction to run
 * `npm install` and `tsc`, none of which anyone on that side of the loop could run.
 */

vi.mock('../../server/ai/aiProvider', () => ({
  hasAiProvider: vi.fn(() => false),
  callAiJson: vi.fn(),
  getEngineLabel: () => 'test engine'
}));

vi.mock('../../server/utils/levelGuidance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/levelGuidance')>();
  return actual;
});

import { reviewSession } from '../../server/controllers/session.controller';
import { callAiJson, hasAiProvider } from '../../server/ai/aiProvider';

const aiAvailable = hasAiProvider as unknown as ReturnType<typeof vi.fn>;
const aiAnswer = callAiJson as unknown as ReturnType<typeof vi.fn>;

const failingEvidence = {
  ranAt: '2026-10-18T10:00:00.000Z',
  ok: false,
  passed: 0,
  failed: 1,
  lines: [
    {
      id: 'typecheck:tsc',
      label: 'Проверка типов',
      status: 'failed',
      commandLine: 'node node_modules/typescript/bin/tsc --noEmit --pretty false',
      durationMs: 2100,
      problems: ["src/main.ts:12:5 TS2322 Type 'string' is not assignable to type 'number'"],
      problemCount: 3
    }
  ]
};

const passingEvidence = {
  ...failingEvidence,
  ok: true,
  passed: 1,
  failed: 0,
  lines: [{ ...failingEvidence.lines[0], status: 'passed', problems: [], problemCount: 0 }]
};

/** A body the beginner screen really sends, minus the two fields under test. */
function body(checkEvidence?: unknown) {
  return {
    agentOutput:
      'Готово. Кнопка сохранения добавлена на главный экран, обработка нажатия тоже сделана — ' +
      'ниже полный код файла.\n\n### src/main.ts\n```ts\nexport const save = () => localStorage.setItem("p", "1");\n```\n',
    task: {
      title: 'Кнопка сохранения',
      goal: 'Кнопка сохраняет прогресс',
      acceptanceCriteria: [{ description: 'Кнопка есть' }]
    },
    projectMap: { files: [] },
    stepNumber: 4,
    previousHistory: [],
    language: 'ru',
    skillLevel: 'Beginner / Non-coder',
    checkEvidence
  };
}

function call(requestBody: Record<string, unknown>) {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return reviewSession({ body: requestBody } as any, { json, status } as any).then(() => {
    const answer = json.mock.calls[0]?.[0];
    if (!answer) throw new Error('the endpoint answered nothing');
    return answer.data as any;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  aiAvailable.mockReturnValue(false);
});

describe('The review without a provider, with a failing check behind it', () => {
  it('1. cannot report a finished task, and says which command disagreed', async () => {
    const data = await call(body(failingEvidence));

    expect(data.progressPercent).toBe(90);
    expect(data.status).toBe('Partially Completed');
    expect(data.warnings[0]).toContain('Проверка типов');
    expect(data.warnings.join(' ')).toContain('Пока проверка не проходит');
    // What has to be fixed, not which command to run — the app has already run it.
    expect(data.missingCriteria.join(' ')).toContain('Исправить то, что нашла проверка');
    expect(data.missingCriteria.join(' ')).toContain('src/main.ts:12:5');
  });

  it('2. the next attempt’s prompt names the check as work to finish', async () => {
    const data = await call(body(failingEvidence));

    expect(data.continuationPrompt).toContain('Исправить то, что нашла проверка');
    // The old loop asked for the commands themselves; a prompt that does is a prompt nobody can run.
    expect(data.continuationPrompt).not.toMatch(/npm install|tsc --noEmit/);
  });

  it('3. a run that passed leaves the verdict exactly as it was', async () => {
    const data = await call(body(passingEvidence));

    expect(data.progressPercent).toBe(100);
    expect(data.status).toBe('Completed');
    expect(data.warnings.join(' ')).toContain('Проверки прошли');
  });

  it('4. with no run at all nothing is claimed about checks', async () => {
    const data = await call(body());

    expect(data.progressPercent).toBe(100);
    expect(data.warnings.join(' ')).not.toContain('Проверки');
  });
});

describe('The review with a model answering, with a failing check behind it', () => {
  it('5. a model that calls a failing check “Completed” is corrected, not believed', async () => {
    aiAvailable.mockReturnValue(true);
    aiAnswer.mockResolvedValue({
      status: 'Completed',
      progressPercent: 100,
      completedCriteria: ['Кнопка есть'],
      missingCriteria: [],
      warnings: [],
      unintendedChanges: [],
      nextBestAction: 'Отметьте задачу выполненной',
      agentOutputSummary: 'Кнопка добавлена.',
      continuationPrompt: ''
    });

    const data = await call(body(failingEvidence));

    expect(data.status).toBe('Partially Completed');
    expect(data.progressPercent).toBe(90);
    expect(data.warnings[0]).toContain('Проверка типов');
    expect(data.missingCriteria.join(' ')).toContain('src/main.ts:12:5');
  });

  it('6. the model’s own list survives the correction, and a passing run changes nothing', async () => {
    aiAvailable.mockReturnValue(true);
    aiAnswer.mockResolvedValue({
      status: 'Partially Completed',
      progressPercent: 50,
      completedCriteria: ['Кнопка есть'],
      missingCriteria: ['Сохранение работает'],
      warnings: ['Часть кода пришлось додумать'],
      unintendedChanges: [],
      nextBestAction: 'Доделать сохранение',
      agentOutputSummary: 'Кнопка добавлена, сохранение — нет.',
      continuationPrompt: 'ПРОМПТ ПРОДОЛЖЕНИЯ'
    });

    const withFailingCheck = await call(body(failingEvidence));
    expect(withFailingCheck.progressPercent).toBe(50);
    expect(withFailingCheck.missingCriteria).toEqual(['Сохранение работает']);
    expect(withFailingCheck.continuationPrompt).toBe('ПРОМПТ ПРОДОЛЖЕНИЯ');
    // Two warnings: the model's own sentence first, the measured fact in front of it.
    expect(withFailingCheck.warnings).toHaveLength(2);
    expect(withFailingCheck.warnings[0]).toContain('Проверка типов');

    const withPassingCheck = await call(body(passingEvidence));
    expect(withPassingCheck.progressPercent).toBe(50);
    expect(withPassingCheck.warnings).toEqual(['Часть кода пришлось додумать']);
  });
});
