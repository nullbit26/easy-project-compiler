import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';

import { resetApiKeyStoreForTests } from '../../server/store/apiKeyStore';
import { hasAiProvider } from '../../server/ai/aiProvider';
import { compilePrompt } from '../../server/controllers/prompt.controller';
import { reviewSession } from '../../server/controllers/session.controller';
import { qualityBlock } from '../../server/utils/levelGuidance';
import { offlinePlanVoice } from '../../server/utils/offlineFirstSteps';

/**
 * The offline engine is not a rare path: it answers whenever no key is configured or the provider is
 * slow, and for many users it is the only engine they ever see. Two things are pinned here — that it
 * says which engine it is, and that it no longer writes the same three sentences under every task.
 */

const ENV_VARS = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'NVIDIA_API_KEY'] as const;
const originalEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const name of ENV_VARS) {
    originalEnv[name] = process.env[name];
    delete process.env[name];
  }
  process.env.EPC_API_KEYS_FILE = path.join(os.tmpdir(), 'epc-local-engine-keys.json');
  resetApiKeyStoreForTests();
});

afterAll(() => {
  for (const name of ENV_VARS) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
});

/** A response object that keeps whatever the controller sends. */
function capture() {
  const payload: any = {};
  const res: any = {
    json: (data: any) => {
      payload.body = data;
      return res;
    },
    status: (code: number) => {
      payload.status = code;
      return res;
    }
  };
  return { res, payload };
}

const COMPILE_BODY = {
  userRequest: 'Добавить удаление записи из списка',
  taskTitle: 'Удаление записи',
  projectMap: {
    projectName: 'Заметки',
    projectType: 'React',
    engineOrFramework: 'React 19 + Vite',
    language: 'TypeScript',
    files: [
      { path: 'src/components/NoteList.tsx', type: 'code', description: 'Список' },
      { path: 'src/App.tsx', type: 'code', description: 'Главный экран' }
    ]
  },
  brief: { tagline: 'Заметки' },
  agent: 'Cursor',
  contextMode: 'Balanced',
  skillLevel: 'Beginner / Non-coder',
  language: 'ru'
};

const OTHER_BODY = {
  ...COMPILE_BODY,
  userRequest: 'Показать сумму расходов за месяц',
  taskTitle: 'Итог месяца',
  projectMap: {
    ...COMPILE_BODY.projectMap,
    files: [{ path: 'src/components/Totals.tsx', type: 'code', description: 'Итоги' }]
  }
};

describe('A prompt written without a model says so', () => {
  it('1. carries its engine on the response, next to the prompt', async () => {
    expect(hasAiProvider()).toBe(false);

    const { res, payload } = capture();
    await compilePrompt({ body: COMPILE_BODY } as any, res);

    expect(payload.body.engine).toBe('local');
    expect(typeof payload.body.data.promptText).toBe('string');
  });

  it('2. writes criteria for this task, not the same three sentences for every task', async () => {
    const first = capture();
    const second = capture();
    await compilePrompt({ body: COMPILE_BODY } as any, first.res);
    await compilePrompt({ body: OTHER_BODY } as any, second.res);

    const firstCriteria: string[] = first.payload.body.data.acceptanceCriteria;
    const secondCriteria: string[] = second.payload.body.data.acceptanceCriteria;

    expect(firstCriteria.join(' ')).toContain('Удаление записи');
    expect(secondCriteria.join(' ')).toContain('Итог месяца');
    expect(firstCriteria).not.toEqual(secondCriteria);
    // The boilerplate that stood under every task is gone from both the field and the prompt text.
    for (const criteria of [firstCriteria, secondCriteria]) {
      expect(criteria.join(' ')).not.toContain('Запрошенный функционал работает корректно');
    }
    expect(first.payload.body.data.promptText).not.toContain('Запрошенный функционал работает корректно');
    expect(first.payload.body.data.promptText).toContain('Удаление записи');
  });

  it('3. names checks the project can run, never a description of a check', async () => {
    const { res, payload } = capture();
    await compilePrompt({ body: COMPILE_BODY } as any, res);

    const tests: string[] = payload.body.data.tests;
    expect(tests.length).toBeGreaterThan(0);
    expect(tests.join(' ')).not.toContain('Запустить проверку измененных модулей');
    for (const entry of tests) {
      expect(entry.startsWith('npm run ') || entry.includes('Проверить вручную')).toBe(true);
    }
  });

  it('4. does not claim model-like confidence for facts it never read', async () => {
    const { res, payload } = capture();
    await compilePrompt({ body: COMPILE_BODY } as any, res);

    expect(payload.body.data.confidence).toBeLessThan(88);
    expect(payload.body.data.confidence).toBeLessThanOrEqual(85);
  });
});

describe('A verdict counted without a model says so', () => {
  it('5. carries its engine, so the card cannot pass the count off as a reading', async () => {
    const { res, payload } = capture();
    await reviewSession(
      {
        body: {
          agentOutput: 'Готово: добавил удаление записи в src/components/NoteList.tsx',
          task: {
            title: 'Удаление записи',
            goal: 'Запись можно удалить',
            acceptanceCriteria: [{ description: 'Кнопка удаления есть' }]
          },
          projectMap: { projectName: 'Заметки', projectType: 'React', language: 'TypeScript', files: [] },
          stepNumber: 1,
          previousHistory: [],
          language: 'ru',
          skillLevel: 'Beginner / Non-coder'
        }
      } as any,
      res
    );

    expect(payload.body.engine).toBe('local');
    expect(typeof payload.body.data.progressPercent).toBe('number');
  });
});

describe('The test demand follows the project, not the template', () => {
  it('6. keeps asking for a test where a runner exists', () => {
    expect(qualityBlock(true, true)).toContain('Автотесты на изменённую логику');
    expect(qualityBlock(true)).toContain('Автотесты на изменённую логику');
  });

  it('7. stops demanding a framework the project does not have, without dropping the check', () => {
    const block = qualityBlock(true, false);

    expect(block).not.toContain('Автотесты на изменённую логику');
    expect(block).toContain('не добавляй его в рамках этой задачи');
    expect(block).toContain('Проверки, которые может выполнить проект');
  });
});

describe('The first questions of a new project fit the product', () => {
  it('8. does not ask a to-do app about sound effects and voice synthesis', () => {
    const app = offlinePlanVoice('Advanced', true, false).clarifyingQuestions;
    const game = offlinePlanVoice('Advanced', true, true).clarifyingQuestions;

    expect(app.join(' ')).not.toContain('звуч');
    expect(game.join(' ')).toContain('игрок');
  });

  it('9. keeps the plain voice the same for a game and an app', () => {
    const app = offlinePlanVoice('Beginner / Non-coder', true, false).clarifyingQuestions;
    const game = offlinePlanVoice('Beginner / Non-coder', true, true).clarifyingQuestions;

    expect(app).toEqual(game);
  });
});
