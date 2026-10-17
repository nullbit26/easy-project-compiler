import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import App from '../App';
import type { ProjectState } from '../types';

/**
 * The two ends of the AI loop, joined.
 *
 * The compiler's task field is free text, and the review judges against a task's acceptance
 * criteria. Nothing used to carry the name from one screen to the other, so an answer written for a
 * task of the user's own — one that is not on the plan — was checked against whichever plan task the
 * review happened to open on. The name and the criteria now travel with the pasted answer, and the
 * task itself joins the plan on the way in, because every verdict, attempt and completion is kept on
 * the task it belongs to: without a task to keep them, they were lost on the next tab switch and the
 * same answer was judged all over again.
 *
 * These tests read that name and those criteria back off the request that reaches the reviewer, and
 * check that the plan holds them.
 */

const PLAN_TASK_TITLE = 'Создание инстанса Phaser и BootScene';
const CUSTOM_TASK_TITLE = 'Добавить сохранение прогресса между сессиями';
const CRITERIA = ['Кнопка сохранения есть на экране', 'Прогресс читается после перезагрузки'];
const ANSWER = '### src/App.tsx\n```tsx\nexport const App = () => null;\n```\n';

function makeProject(phases?: ProjectState['phases']): ProjectState {
  return {
    id: 'loop-demo',
    name: 'Loop Demo',
    projectType: 'React',
    engineOrFramework: 'React 19 + Vite',
    language: 'TypeScript',
    selectedAgent: 'DeepSeek / Web Chat',
    technicalLevel: 'Advanced',
    interfaceMode: 'full',
    interfaceModeChosen: true,
    nextBestAction: 'Run the first task',
    brief: {
      id: 'b1',
      projectName: 'Loop Demo',
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
      projectName: 'Loop Demo',
      projectType: 'React',
      engineOrFramework: 'React 19 + Vite',
      language: 'TypeScript',
      rulesFiles: ['AGENTS.md'],
      files: [{ path: 'src/App.tsx', type: 'code', description: 'Main entry point' }]
    },
    phases:
      phases === undefined
        ? [
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
                  title: PLAN_TASK_TITLE,
                  goal: 'Boot the game',
                  status: 'ready',
                  relevantFiles: ['src/App.tsx'],
                  acceptanceCriteria: [{ id: 'ac1', description: 'Scene renders', passed: false }],
                  testRequirements: [],
                  estimatedComplexity: 'Small (1 prompt)',
                  dependencies: [],
                  progressPercent: 0
                }
              ]
            }
          ]
        : phases,
    recentErrors: [],
    rulesFilesContent: { agentsMd: '', claudeMd: '', cursorRules: '' }
  };
}

/** Records every AI request while answering both screens from the same mock. */
function openCompiler(project: ProjectState) {
  localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
  localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
  localStorage.setItem('easy_project_compiler_lang', 'ru');
  window.location.hash = '#/compiler';

  const bodies: Array<{ url: string; body: any }> = [];
  vi.spyOn(global, 'fetch').mockImplementation((input: any, init: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    if (init?.body) {
      try {
        bodies.push({ url, body: JSON.parse(String(init.body)) });
      } catch {
        /* not JSON — nothing to inspect */
      }
    }
    const data = url.includes('/api/prompt/compile')
      ? {
          taskTitle: CUSTOM_TASK_TITLE,
          confidence: 90,
          includedFiles: [{ path: 'src/App.tsx', reason: 'Main file', tokensEstimate: 300 }],
          excludedFiles: [],
          missingContext: [],
          architectureWarnings: [],
          promptText: 'СОБРАННЫЙ ПРОМПТ ДЛЯ ЗАДАЧИ СОХРАНЕНИЯ',
          acceptanceCriteria: CRITERIA,
          tests: ['npm test'],
          estimatedTokens: 900,
          nextBestAction: 'Copy it',
          securityWarnings: [],
          contextMode: 'Balanced',
          createdAt: new Date().toISOString()
        }
      : url.includes('/api/session/review')
      ? {
          status: 'Partially Completed',
          progressPercent: 50,
          completedCriteria: [CRITERIA[0]],
          missingCriteria: [CRITERIA[1]],
          warnings: [],
          unintendedChanges: [],
          nextBestAction: 'Read the progress back',
          agentOutputSummary: 'The button is there.',
          continuationPrompt: 'ПРОМПТ ПРОДОЛЖЕНИЯ (Попытка 2 — до 100%)'
        }
      : {};
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as unknown as Response);
  });

  render(<App />);
  return bodies;
}

/** Types the task, compiles it, pastes an answer and hands it to the review. */
async function runLoopUpToReview() {
  const field = await screen.findByPlaceholderText(
    'Например: добавить механику голода с уменьшением здоровья при нулевом значении...'
  );
  fireEvent.change(field, { target: { value: CUSTOM_TASK_TITLE } });
  fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
  await waitFor(() => expect(screen.getByText('СОБРАННЫЙ ПРОМПТ ДЛЯ ЗАДАЧИ СОХРАНЕНИЯ')).toBeInTheDocument(), {
    timeout: 4000
  });

  fireEvent.change(screen.getByPlaceholderText('Вставьте код или ответ, полученный от агента...'), {
    target: { value: ANSWER }
  });
  fireEvent.click(screen.getByRole('button', { name: /Проверить вставленный код|Перейти к анализу кода/ }));
}

/** The plan as it stands in the project the app writes to. */
function storedTaskTitles(): string[] {
  const raw = localStorage.getItem('easy_project_compiler_current_project');
  const project = raw ? JSON.parse(raw) : null;
  return (project?.phases || []).flatMap((phase: any) => phase.tasks.map((task: any) => task.title));
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('The answer carries its task from the compiler into the review', () => {
  it('1. judges the pasted answer against the task it was compiled for, not the plan’s first task', async () => {
    const bodies = openCompiler(makeProject());
    await runLoopUpToReview();

    await waitFor(() => expect(bodies.some((call) => call.url.includes('/api/session/review'))).toBe(true), {
      timeout: 4000
    });
    const reviewCall = bodies.find((call) => call.url.includes('/api/session/review'))!.body;

    // The task under review is the one the prompt was built for…
    expect(reviewCall.task.title).toBe(CUSTOM_TASK_TITLE);
    // …and the criteria are the ones the compiled prompt listed, not the plan task's own.
    expect(reviewCall.task.acceptanceCriteria.map((ac: any) => ac.description)).toEqual(CRITERIA);
    expect(reviewCall.task.title).not.toBe(PLAN_TASK_TITLE);

    // The task it judged is on the plan, so the verdict and the attempts have somewhere to live.
    expect(storedTaskTitles()).toContain(CUSTOM_TASK_TITLE);

    // The screen says the same thing the request did. The title shows twice — as the heading and as
    // the goal the review sends along with the criteria — so any occurrence counts.
    expect((await screen.findAllByText(CUSTOM_TASK_TITLE)).length).toBeGreaterThan(0);
    for (const criterion of CRITERIA) {
      expect(screen.getAllByText(criterion).length).toBeGreaterThan(0);
    }
  }, 30000);

  it('2. keeps what each screen was holding while the user switches between them', async () => {
    const bodies = openCompiler(makeProject());
    await runLoopUpToReview();

    await waitFor(() => expect(screen.getAllByText('Попытка #1').length).toBeGreaterThan(0), { timeout: 4000 });
    expect(bodies.filter((call) => call.url.includes('/api/session/review'))).toHaveLength(1);

    // The sections are folded while the guided default is off, so reveal the list to reach the other
    // tab.
    fireEvent.click(screen.getByRole('button', { name: /Показать все разделы/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Компилятор промптов' }));

    // Back on the compiler: the prompt it compiled is still there, not restarted.
    expect(screen.getByText('СОБРАННЫЙ ПРОМПТ ДЛЯ ЗАДАЧИ СОХРАНЕНИЯ')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Проверка ответа' }));

    // And back on the review: the pass it recorded is still counted, and the same answer is not
    // judged a second time — the task it belongs to has the history and the history says "done".
    expect(screen.getAllByText('Попытка #1').length).toBeGreaterThan(0);
    expect(bodies.filter((call) => call.url.includes('/api/session/review'))).toHaveLength(1);
  }, 30000);

  it('2b. writes the code taken out of the answer into the project when the user applies it', async () => {
    openCompiler(makeProject());
    await runLoopUpToReview();

    // The review reads the file out of the pasted answer and offers to keep it.
    const applyButton = await screen.findByRole('button', { name: /Применить файлы к проекту/ }, { timeout: 4000 });
    fireEvent.click(applyButton);
    await waitFor(() => expect(screen.getAllByText('Файлы успешно сохранены в проект').length).toBeGreaterThan(0), {
      timeout: 4000
    });

    const raw = localStorage.getItem('easy_project_compiler_current_project');
    const file = JSON.parse(String(raw)).projectMap.files.find((f: any) => f.path === 'src/App.tsx');
    expect(file.content).toContain('export const App = () => null;');
  }, 30000);

  it('3. still judges the answer when the plan has no phases to put the task in', async () => {
    const bodies = openCompiler(makeProject([]));
    await runLoopUpToReview();

    await waitFor(() => expect(bodies.some((call) => call.url.includes('/api/session/review'))).toBe(true), {
      timeout: 4000
    });
    const reviewCall = bodies.find((call) => call.url.includes('/api/session/review'))!.body;

    // Nothing to store it on, but the verdict is still about the work that was asked for…
    expect(reviewCall.task.title).toBe(CUSTOM_TASK_TITLE);
    expect(reviewCall.task.acceptanceCriteria.map((ac: any) => ac.description)).toEqual(CRITERIA);

    // …and the screen offers no status button, because a status that matches no task would be
    // written nowhere while the click looked accepted.
    expect((await screen.findAllByText(CUSTOM_TASK_TITLE)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Отметить/ })).toBeNull();
  }, 30000);
});
