import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import App from '../App';
import type { ProjectState } from '../types';

/**
 * One word per thing, and one place to look.
 *
 * Three separate problems used to make these two screens read as a puzzle:
 *
 *   • `Шаг` meant two different things on the review screen at once — the screen of the loop
 *     ("Шаг 4: Проверка") and one pass of the loop inside it ("Анализ шага #1"). A pass is now a
 *     `Попытка`, the word the project already stores for it.
 *   • The task's state was printed as the raw stored value — `ready (0%)`, in English, in caps —
 *     and the same percentage was then printed again by the bar a line below it.
 *   • The right column spent the whole first visit on a page of prompt text that repeated the task
 *     and the criteria already shown on the left, and presented itself as the prompt for the first
 *     step while the compiler is the screen that actually builds it.
 *
 * What is pinned here is that wording: the loop's passes are attempts, the state is in the reader's
 * language, a number is printed once per card, and the first prompt opens on request.
 */

const PASTE_PLACEHOLDER = 'Вставьте сгенерированный код, ответ агента или git diff...';

function makeProject(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    id: 'words-demo',
    name: 'Interface Words Demo',
    projectType: 'React',
    engineOrFramework: 'React 19 + Vite',
    language: 'TypeScript',
    selectedAgent: 'Cursor',
    technicalLevel: 'Advanced',
    interfaceMode: 'full',
    interfaceModeChosen: true,
    nextBestAction: 'Run the first task',
    brief: {
      id: 'b1',
      projectName: 'Interface Words Demo',
      tagline: 'A demo',
      targetAudience: 'Testers',
      coreProblem: 'Nothing',
      coreValue: 'Nothing',
      mvpFeatures: ['Feature'],
      futureFeatures: [],
      nonGoals: [],
      technicalConstraints: [],
      successCriteria: []
    },
    projectMap: {
      projectName: 'Interface Words Demo',
      projectType: 'React',
      engineOrFramework: 'React 19 + Vite',
      language: 'TypeScript',
      rulesFiles: ['AGENTS.md'],
      files: [{ path: 'src/App.tsx', type: 'code', description: 'Main entry point' }]
    },
    phases: [
      {
        id: 'p0',
        phaseNumber: 0,
        title: 'Setup',
        purpose: 'Setup',
        deliverable: 'Working shell',
        tasks: [
          {
            id: 't1',
            phaseId: 'p0',
            title: 'Build the demo screen',
            goal: 'Render the demo screen',
            status: 'ready',
            relevantFiles: ['src/App.tsx'],
            acceptanceCriteria: [{ id: 'ac1', description: 'Renders', passed: false }],
            testRequirements: [],
            estimatedComplexity: 'Small (1 prompt)',
            dependencies: [],
            progressPercent: 0
          }
        ]
      }
    ],
    recentErrors: [],
    rulesFilesContent: { agentsMd: '', claudeMd: '', cursorRules: '' },
    ...overrides
  };
}

/** Opens one screen of a loaded project, with every answer the server would send. */
function openScreen(project: ProjectState, hash: string) {
  localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
  localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
  localStorage.setItem('easy_project_compiler_lang', 'ru');
  window.location.hash = hash;

  vi.spyOn(global, 'fetch').mockImplementation((input: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    const data = url.includes('/api/review/session')
      ? {
          id: 'rev_1',
          taskId: 't1',
          status: 'Partially Completed',
          progressPercent: 60,
          completedCriteria: ['Renders'],
          missingCriteria: ['Handles input'],
          warnings: [],
          unintendedChanges: [],
          nextBestAction: 'Add the input handling',
          agentOutputSummary: 'The screen renders, the input is missing.'
        }
      : {};
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ data }) } as unknown as Response);
  });

  render(<App />);
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('A pass of the loop is an attempt, a screen of it is a step', () => {
  it('1. calls the pass inside the review an attempt, and keeps the step for the screen', async () => {
    openScreen(makeProject(), '#/review');

    // The screen of the loop keeps its own number — the check is step 4 of the one journey, the
    // same number the helper gives it, so switching interfaces never restarts the count.
    expect(await screen.findByText(/Шаг 4:/)).toBeInTheDocument();
    // …and the pass under it is an attempt: the box waiting for the agent's answer says which one.
    expect((await screen.findAllByText('Попытка #1')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Шаг #1')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText(PASTE_PLACEHOLDER), {
      target: { value: 'export const demo = () => null;' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Запустить анализ сессии' }));

    await waitFor(
      () => expect(screen.getByText(/Вердикт проверки · Попытка #1/)).toBeInTheDocument(),
      { timeout: 4000 }
    );
    // The history of the finished pass is named the same way.
    expect(screen.getByText(/История попыток/)).toBeInTheDocument();
    // Only the finished pass carries this number, so the history entry is in there.
    expect((await screen.findAllByText('Попытка #1')).length).toBeGreaterThan(0);
  }, 20000);

  it('2. says the task state in the reader’s language, without repeating its percentage', async () => {
    openScreen(makeProject(), '#/review');

    // The stored value is `ready`, and it used to reach the screen as-is, in caps, with the number
    // the progress bar two lines below already shows.
    const chip = await screen.findByTestId('task-status');
    expect(chip.textContent).toBe('Готово');
    expect(chip.textContent).not.toContain('%');
    // The number itself is still there — once, on the bar that is about it.
    expect(screen.getByText('Готовность задачи:')).toBeInTheDocument();
  }, 20000);

  it('3. opens the first prompt on request instead of spending the first visit on it', async () => {
    openScreen(makeProject(), '#/review');

    expect(await screen.findByText('Первый промпт')).toBeInTheDocument();
    // The card says where the real prompt comes from instead of claiming the first step for itself.
    expect(screen.getByText(/начинается в компиляторе/)).toBeInTheDocument();
    // Its text is not on screen yet, so the criteria are written once — in the task card on the left.
    expect(screen.queryByText(/ИНСТРУКЦИИ ДЛЯ ИИ-АГЕНТА/)).toBeNull();
    // And the button copies the first prompt, not a continuation of one.
    expect(screen.getByRole('button', { name: /Копировать промпт/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Показать промпт/ }));

    expect(screen.getByText(/ИНСТРУКЦИИ ДЛЯ ИИ-АГЕНТА/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Скрыть промпт/ }));
    expect(screen.queryByText(/ИНСТРУКЦИИ ДЛЯ ИИ-АГЕНТА/)).toBeNull();
  }, 20000);
});

describe('The workspace list is grouped, and the panels of a stage are not numbered twice', () => {
  it('4. sorts the ten sections into three named groups, and drops the headers when folded', async () => {
    openScreen(makeProject(), '#/');

    await screen.findByRole('button', { name: 'Обзор проекта' });
    // Folded, two entries are on screen and a title over them would be noise.
    expect(screen.queryByText('Цикл с ИИ')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Показать все разделы/ }));

    expect(await screen.findByText('Начало')).toBeInTheDocument();
    const start = screen.getByText('Начало');
    const loop = screen.getByText('Цикл с ИИ');
    const project = screen.getByText('Проект');
    const compiler = screen.getByRole('button', { name: 'Компилятор промптов' });

    // Drawn in order, and each section sits under the group it belongs to.
    const comesBefore = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(comesBefore(start, loop)).toBe(true);
    expect(comesBefore(loop, project)).toBe(true);
    expect(comesBefore(loop, compiler)).toBe(true);
    expect(comesBefore(compiler, project)).toBe(true);
  }, 20000);

  it('5. names the compiler’s panels instead of numbering them under a numbered stage', async () => {
    openScreen(makeProject(), '#/compiler');

    // The stage is the journey's step 3; the panels used to carry 1, 2 and 3 of their own.
    expect(await screen.findByText('Шаг 3: Промпт')).toBeInTheDocument();
    expect(screen.getByText('Что нужно сделать')).toBeInTheDocument();
    expect(screen.getByText('Что увидит агент')).toBeInTheDocument();
    expect(screen.getByText('Запустить в агенте и проверить')).toBeInTheDocument();
    expect(screen.queryByText('1. Описание задачи пользователя')).toBeNull();
    expect(screen.queryByText('2. Объем контекста и файлы')).toBeNull();
  }, 20000);
});
