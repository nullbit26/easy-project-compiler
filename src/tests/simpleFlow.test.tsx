import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import App from '../App';

/**
 * The beginner mode: a project set to "Beginner / Non-coder" must open the four-step helper
 * instead of the metric dashboard, hide the eight technical screens behind one click, and only
 * ever call the AI when the user presses the button on the current step.
 */

const task = {
  id: 'task_simple',
  phaseId: 'p0',
  title: 'Сделать кнопку сохранения',
  goal: 'Кнопка сохраняет прогресс',
  status: 'ready',
  relevantFiles: ['src/main.ts'],
  acceptanceCriteria: [{ id: 'ac1', description: 'Кнопка сохраняет', passed: false }],
  testRequirements: [],
  estimatedComplexity: 'Small (1 prompt)',
  dependencies: [],
  progressPercent: 0
};

function makeProject(technicalLevel: string) {
  return {
    id: `simple-${technicalLevel}`,
    name: 'Простой проект',
    projectType: 'React',
    engineOrFramework: 'React 19 + Vite',
    language: 'TypeScript',
    selectedAgent: 'DeepSeek / Web Chat',
    technicalLevel,
    nextBestAction: 'Выполнить первую задачу',
    brief: {
      id: 'b1',
      projectName: 'Простой проект',
      tagline: 'Демо',
      targetAudience: 'Все',
      coreProblem: 'Ничего',
      coreValue: 'Ничего',
      mvpFeatures: ['Кнопка сохранения'],
      futureFeatures: [],
      nonGoals: [],
      technicalConstraints: [],
      successCriteria: []
    },
    architecture: {
      technologyStack: ['React'],
      folderStructure: [],
      coreEntities: [],
      dataFlow: 'ui -> api',
      testingStrategy: 'vitest',
      deploymentPlan: 'static',
      securityRisks: []
    },
    projectMap: {
      projectName: 'Простой проект',
      projectType: 'React',
      engineOrFramework: 'React 19 + Vite',
      language: 'TypeScript',
      rulesFiles: ['AGENTS.md'],
      files: [
        { path: 'src/main.ts', type: 'code', description: 'src • 40 B' },
        { path: 'README.md', type: 'asset', description: '. • 20 B' }
      ]
    },
    phases: [{ id: 'p0', phaseNumber: 1, title: 'Этап 1', purpose: 'Старт', deliverable: 'Работает', tasks: [task] }],
    recentErrors: [],
    rulesFilesContent: { agentsMd: '', claudeMd: '', cursorRules: '' }
  };
}

const compiledPrompt = {
  id: 'c1',
  taskId: 'task_simple',
  agent: 'DeepSeek / Web Chat',
  projectType: 'React',
  engineOrFramework: 'React 19 + Vite',
  language: 'TypeScript',
  taskTitle: 'Сделать кнопку сохранения',
  confidence: 90,
  includedFiles: [{ path: 'src/main.ts', reason: 'Основной файл', tokensEstimate: 120 }],
  excludedFiles: [],
  missingContext: [],
  architectureWarnings: [],
  promptText: 'СОБРАННЫЙ ПРОМПТ ДЛЯ НОВИЧКА',
  acceptanceCriteria: ['Кнопка работает'],
  tests: ['Проверить кнопку'],
  estimatedTokens: 200,
  nextBestAction: 'Вставить промпт в DeepSeek',
  securityWarnings: [],
  contextMode: 'Balanced',
  createdAt: new Date().toISOString()
};

/** What the reviewer answers when everything the task asked for is in the pasted code. */
const completedReview = {
  id: 'r1',
  taskId: 'task_simple',
  status: 'Completed',
  progressPercent: 100,
  completedCriteria: ['Кнопка работает'],
  missingCriteria: [],
  warnings: [],
  unintendedChanges: [],
  nextBestAction: 'Задача закрыта, берите следующую',
  agentOutputSummary: 'Кнопка сохранения добавлена и работает',
  continuationPrompt: ''
};

function mockApi(reviewData: any = completedReview) {
  const spy = vi.spyOn(global, 'fetch').mockImplementation((input: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    const respond = (data: any) =>
      Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as unknown as Response);

    if (url.includes('/api/files/workspace')) {
      return respond({
        root: 'C:/demo-project',
        files: [
          { path: 'src/main.ts', name: 'main.ts', dir: 'src', type: 'code', sizeBytes: 40, isText: true },
          { path: 'README.md', name: 'README.md', dir: '', type: 'asset', sizeBytes: 20, isText: true }
        ],
        backups: []
      });
    }
    if (url.includes('/api/prompt/compile')) return respond(compiledPrompt);
    if (url.includes('/api/session/review')) return respond(reviewData);
    if (url.includes('/api/files/apply')) {
      return respond({
        backupId: 'b1',
        root: 'C:/demo-project',
        results: [{ path: 'src/main.ts', action: 'update', status: 'updated' }],
        applied: 1,
        failed: 0,
        backups: []
      });
    }
    return respond({});
  });
  return spy;
}

function callCount(spy: any, part: string): number {
  return spy.mock.calls.filter((call: any[]) => {
    const url = typeof call[0] === 'string' ? call[0] : call[0]?.url ?? '';
    return url.includes(part);
  }).length;
}

describe('Beginner step-by-step mode', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    window.location.hash = '';
  });

  it('opens the four-step flow, hides the technical screens and compiles only on demand', async () => {
    const project = makeProject('Beginner / Non-coder');
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
    localStorage.setItem('easy_project_compiler_lang', 'ru');

    const spy = mockApi();

    render(<App />);

    // A project that is already saved opens on the dashboard (see the start-up landing rule); the
    // helper is the first entry in the sidebar, one click away — and then it is what the beginner
    // lives in, instead of the metrics dashboard.
    await waitFor(() => expect(window.location.hash).not.toBe('#/simple'), { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: /Пошаговый помощник/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/simple'), { timeout: 4000 });

    // The sidebar shows the helper as the only workflow entry.
    expect(screen.getByRole('button', { name: /Пошаговый помощник/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Компилятор промптов' })).toBeNull();
    expect(screen.getByRole('button', { name: /Показать все разделы/ })).toBeInTheDocument();

    // Folder is already connected in the mock, so step 2 offers the task from the plan.
    await waitFor(() => expect(screen.getByText('Сделать кнопку сохранения')).toBeInTheDocument(), {
      timeout: 4000
    });
    expect(callCount(spy, '/api/prompt/compile')).toBe(0);

    // Nothing is compiled until the beginner presses the button.
    fireEvent.click(screen.getByRole('button', { name: /Собрать промпт/ }));
    await waitFor(() => expect(screen.getByText('СОБРАННЫЙ ПРОМПТ ДЛЯ НОВИЧКА')).toBeInTheDocument(), {
      timeout: 4000
    });
    expect(callCount(spy, '/api/prompt/compile')).toBe(1);

    // Step 3 → step 4, then the pasted answer is checked.
    fireEvent.click(screen.getByRole('button', { name: /Я вставил/ }));
    const answerBox = await screen.findByPlaceholderText('Вставьте ответ агента...');
    fireEvent.change(answerBox, {
      target: { value: 'Готово.\n\n### src/main.ts\n```ts\nconsole.log("saved");\n```\n' }
    });
    fireEvent.click(screen.getByRole('button', { name: /Проверить ответ/ }));

    await waitFor(() => expect(screen.getByText('Всё сделано')).toBeInTheDocument(), { timeout: 4000 });
    expect(callCount(spy, '/api/session/review')).toBe(1);
    // The verdict is asked for in the project's own mode, so its wording fits the person reading it.
    const reviewCall = spy.mock.calls.find((entry: any[]) =>
      String(typeof entry[0] === 'string' ? entry[0] : entry[0]?.url ?? '').includes('/api/session/review')
    );
    expect(JSON.parse(String(reviewCall[1].body)).skillLevel).toBe('Beginner / Non-coder');
    expect(screen.getByText('Кнопка сохранения добавлена и работает')).toBeInTheDocument();

    // The code found in the answer can be written into the real folder, with an undo beside it.
    fireEvent.click(screen.getByRole('button', { name: /Записать код в файлы проекта/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Отменить запись/ })).toBeInTheDocument(), {
      timeout: 4000
    });
    expect(callCount(spy, '/api/files/apply')).toBe(1);
  });

  it('hands the next attempt back as a prompt, instead of ending the loop at “build it again”', async () => {
    const project = makeProject('Beginner / Non-coder');
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
    localStorage.setItem('easy_project_compiler_lang', 'ru');

    const continuation =
      'ПРОМПТ ПРОДОЛЖЕНИЯ (Попытка 2 для 100%):\nВыполните следующее:\n1. Напишите автотесты для HungerTracker.\n2. Не переписывайте работающий код.';
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });

    const spy = mockApi({
      ...completedReview,
      status: 'Partially Completed',
      progressPercent: 40,
      completedCriteria: [],
      missingCriteria: ['автотесты', 'обработка граничного случая'],
      nextBestAction: 'Скопируйте промпт продолжения и вставьте его в ИИ-агента.',
      agentOutputSummary: 'Класс добавлен, тестов нет.',
      continuationPrompt: continuation
    });

    render(<App />);

    await waitFor(() => expect(window.location.hash).not.toBe('#/simple'), { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: /Пошаговый помощник/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/simple'), { timeout: 4000 });

    fireEvent.click(await screen.findByRole('button', { name: /Собрать промпт/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Я вставил/ }));
    const answerBox = await screen.findByPlaceholderText('Вставьте ответ агента...');
    fireEvent.change(answerBox, { target: { value: '```ts\n// File: src/HungerTracker.ts\nexport class HungerTracker {}\n```\n' } });

    const reviewCalls = () =>
      spy.mock.calls.filter((call: any[]) =>
        String(typeof call[0] === 'string' ? call[0] : call[0]?.url ?? '').includes('/api/session/review')
      );

    // The first check: the verdict lists what is missing, and the way forward is a prompt built
    // from exactly that list — not a fresh prompt from the task title.
    fireEvent.click(screen.getByRole('button', { name: /Проверить ответ/ }));
    await waitFor(() => expect(screen.getByText(/Промпт для следующей попытки/)).toBeInTheDocument(), {
      timeout: 4000
    });
    expect(screen.getByText('автотесты')).toBeInTheDocument();
    expect(screen.getByText(/ПРОМПТ ПРОДОЛЖЕНИЯ/)).toBeInTheDocument();
    expect(screen.getByText(/Попытка 1/)).toBeInTheDocument();

    const firstCall = JSON.parse(String(reviewCalls()[0][1].body));
    expect(firstCall.stepNumber).toBe(1);
    expect(firstCall.previousHistory).toEqual([]);

    // Copying it is the whole of the user's part: the text that lands in the clipboard is the
    // continuation prompt itself.
    fireEvent.click(screen.getByRole('button', { name: /Скопировать промпт продолжения/ }));
    expect(writeText).toHaveBeenCalledWith(continuation);

    // The attempt that used it is judged as the second one, with the first one in hand.
    fireEvent.click(screen.getByRole('button', { name: /Проверить ответ/ }));
    await waitFor(() => expect(reviewCalls()).toHaveLength(2), { timeout: 4000 });
    const secondCall = JSON.parse(String(reviewCalls()[1][1].body));
    expect(secondCall.stepNumber).toBe(2);
    expect(secondCall.previousHistory).toHaveLength(1);
    expect(secondCall.previousHistory[0].review.missingCriteria).toEqual(['автотесты', 'обработка граничного случая']);
    // The counter is on the verdict itself, and the card now offers the third attempt. The prompt
    // text quotes its own attempt number, so the counter is matched as the whole line.
    await waitFor(() =>
      expect(
        screen.getByText(
          (_text, node) => node?.tagName === 'SPAN' && /^Готовность задачи: 40% • Попытка 2$/.test((node.textContent || '').trim())
        )
      ).toBeInTheDocument()
    );
    expect(screen.getByText(/Промпт для следующей попытки • Попытка 3/)).toBeInTheDocument();
  });

  it('keeps the workspace folded for every other mode until the user reveals it', async () => {
    const project = makeProject('Vibe-coder');
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
    localStorage.setItem('easy_project_compiler_lang', 'ru');

    mockApi();

    render(<App />);

    // No redirect: the dashboard is the landing screen.
    expect(window.location.hash).not.toBe('#/simple');
    await screen.findByText('Обзор проекта');

    // The sidebar starts folded: the helper, the screen the user is on, and the reveal entry.
    expect(screen.queryByRole('button', { name: 'Компилятор промптов' })).toBeNull();
    const reveal = screen.getByRole('button', { name: /Показать все разделы/ });

    // Revealing brings every screen back…
    fireEvent.click(reveal);
    expect(await screen.findByRole('button', { name: 'Компилятор промптов' })).toBeInTheDocument();

    // …and the same entry folds the list again.
    fireEvent.click(screen.getByRole('button', { name: /Скрыть лишние разделы/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Компилятор промптов' })).toBeNull());
  });
});
