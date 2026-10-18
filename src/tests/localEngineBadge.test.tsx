import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import App from '../App';

import { compilePromptApi, reviewSessionApi } from '../services/api';

/**
 * The offline engine answers exactly when the provider is slow or no key is configured, and it is
 * the engine most users ever see. It used to hand back a prompt and a verdict that looked identical
 * to a model's: the engine label was on the response envelope and the client dropped it on the floor.
 * Two things are pinned here — the client keeps the label, and the screen says it out loud.
 */

function makeProject() {
  return {
    id: 'local-engine-demo',
    name: 'Заметки',
    projectType: 'React',
    engineOrFramework: 'React 19 + Vite',
    language: 'TypeScript',
    selectedAgent: 'Cursor',
    technicalLevel: 'Beginner / Non-coder',
    nextBestAction: 'Добавить удаление записи',
    brief: {
      id: 'b1',
      projectName: 'Заметки',
      tagline: 'Список заметок',
      targetAudience: 'Люди',
      coreProblem: 'Записи теряются',
      coreValue: 'Всё под рукой',
      mvpFeatures: ['Список'],
      futureFeatures: [],
      nonGoals: [],
      technicalConstraints: [],
      successCriteria: []
    },
    projectMap: {
      projectName: 'Заметки',
      projectType: 'React',
      engineOrFramework: 'React 19 + Vite',
      language: 'TypeScript',
      rulesFiles: [],
      files: [{ path: 'src/components/NoteList.tsx', type: 'code', description: 'Список' }]
    },
    phases: [
      {
        id: 'p0',
        phaseNumber: 0,
        title: 'Основа',
        purpose: 'Основа',
        deliverable: 'Работающий экран',
        tasks: [
          {
            id: 't1',
            title: 'Добавить удаление записи',
            goal: 'Запись можно удалить',
            status: 'ready',
            acceptanceCriteria: [],
            dependencies: [],
            progressPercent: 0
          }
        ]
      }
    ],
    recentErrors: [],
    rulesFilesContent: null
  };
}

function compiledResponse() {
  return {
    taskTitle: 'Добавить удаление записи',
    confidence: 75,
    includedFiles: [],
    excludedFiles: [],
    missingContext: [],
    architectureWarnings: [],
    promptText: 'PROMPT BUILT WITHOUT A MODEL',
    acceptanceCriteria: ['«Добавить удаление записи» работает в запущенном проекте'],
    tests: ['npm run build'],
    estimatedTokens: 900,
    nextBestAction: 'Скопируйте промпт',
    securityWarnings: [],
    contextMode: 'Balanced',
    createdAt: new Date().toISOString(),
    rulesCheck: undefined
  };
}

/** Every fetch answers with the same envelope; only the compile payload matters here. */
function mockFetchWithEngine(engine?: string) {
  return vi.spyOn(global, 'fetch').mockImplementation((input: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    const data = url.includes('/api/prompt/compile') ? compiledResponse() : {};
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => (engine ? { data, engine } : { data })
    } as unknown as Response);
  });
}

async function compile(engine?: string) {
  const project = makeProject();
  localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
  localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
  localStorage.setItem('easy_project_compiler_lang', 'ru');
  window.location.hash = '#/compiler';

  mockFetchWithEngine(engine);
  render(<App />);

  const start = (await screen.findAllByRole('button', { name: 'Начать' }))[0];
  fireEvent.click(start);
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('The screen knows which engine answered', () => {
  it('1. marks a prompt written without a model', async () => {
    await compile('local');

    await waitFor(() => expect(screen.getByText('PROMPT BUILT WITHOUT A MODEL')).toBeTruthy());
    const badge = screen.getByTestId('compiler-local-engine');
    expect(badge.textContent).toContain('без ИИ');
  }, 15000);

  it('2. leaves a model-built prompt unmarked', async () => {
    await compile('gemini');

    await waitFor(() => expect(screen.getByText('PROMPT BUILT WITHOUT A MODEL')).toBeTruthy());
    expect(screen.queryByTestId('compiler-local-engine')).toBeNull();
  }, 15000);

  it('3. does not invent the mark when the response carries no engine at all', async () => {
    await compile(undefined);

    await waitFor(() => expect(screen.getByText('PROMPT BUILT WITHOUT A MODEL')).toBeTruthy());
    expect(screen.queryByTestId('compiler-local-engine')).toBeNull();
  }, 15000);
});

describe('The client keeps the engine label from the envelope', () => {
  it('4. carries it into the compiled prompt', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: compiledResponse(), engine: 'local' })
    } as unknown as Response);

    const result = await compilePromptApi({
      userRequest: 'Добавить удаление записи',
      projectMap: makeProject().projectMap as any,
      agent: 'Cursor',
      contextMode: 'Balanced'
    });

    expect(result.engine).toBe('local');
  });

  it('5. carries it into the verdict, so the percentage cannot pass as a reading', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          id: 'rev_1',
          taskId: 't1',
          status: 'Partially Completed',
          progressPercent: 60,
          completedCriteria: [],
          missingCriteria: [],
          warnings: [],
          unintendedChanges: [],
          nextBestAction: 'Доделать',
          agentOutputSummary: 'Часть сделана'
        },
        engine: 'local'
      })
    } as unknown as Response);

    const result = await reviewSessionApi({
      agentOutput: 'Готово',
      task: { title: 'Добавить удаление записи' },
      projectMap: makeProject().projectMap as any
    });

    expect(result.engine).toBe('local');
    expect(result.progressPercent).toBe(60);
  });
});
