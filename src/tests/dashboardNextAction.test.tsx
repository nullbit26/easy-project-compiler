import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import App from '../App';

/**
 * The dashboard's one call to action is a sentence plus a button under it. The sentence used to be a
 * model's line stored with the project and never revisited, and the button only switched screens —
 * so the two could disagree with each other and with the plan. What is pinned here is that the
 * sentence comes from the tasks now, and the button acts on the sentence it sits under.
 */

function task(title: string, status: string, id = `t_${title}`) {
  return {
    id,
    phaseId: 'p0',
    title,
    goal: title,
    status,
    relevantFiles: [],
    acceptanceCriteria: [],
    testRequirements: [],
    estimatedComplexity: 'Small (1 prompt)',
    dependencies: [],
    progressPercent: status === 'completed' ? 100 : 0
  };
}

function makeProject(overrides: Record<string, any> = {}) {
  return {
    id: 'next-action-demo',
    name: 'Заметки',
    projectType: 'React',
    engineOrFramework: 'React 19 + Vite',
    language: 'TypeScript',
    technicalLevel: 'Beginner / Non-coder',
    nextBestAction: 'Добавьте скрипт "test" в package.json и запустите npm test',
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
        tasks: [task('Список записей', 'in_progress')]
      }
    ],
    recentErrors: [],
    rulesFilesContent: null,
    ...overrides
  };
}

function open(project: Record<string, any>) {
  localStorage.clear();
  localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
  localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
  localStorage.setItem('easy_project_compiler_lang', 'ru');
  window.location.hash = '#/';

  vi.spyOn(global, 'fetch').mockImplementation(
    () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: {} })
      } as unknown as Response)
  );

  render(<App />);
}

async function clickRecommendation() {
  const button = await screen.findByTestId('dashboard-recommendation-action');
  fireEvent.click(button);
  return button;
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('The recommended action is read from the plan', () => {
  it('1. names the task that is in progress, not the stored sentence', async () => {
    open(makeProject());

    const text = (await screen.findByTestId('dashboard-recommendation')).textContent || '';
    expect(text).toContain('Список записей');
    expect(text).not.toContain('npm test');
  }, 15000);

  it('2. compiles the task the sentence names', async () => {
    open(makeProject());

    await clickRecommendation();

    await waitFor(() => expect(window.location.hash).toBe('#/compiler'));
    const field = await screen.findByPlaceholderText(/Например: добавить механику/);
    expect((field as HTMLTextAreaElement).value).toBe('Список записей');
  }, 15000);

  it('3. does not leave the field holding a stale stored recommendation', async () => {
    open(makeProject({ nextBestAction: 'Показать сумму расходов за месяц' }));

    await clickRecommendation();

    const field = await screen.findByPlaceholderText(/Например: добавить механику/);
    expect((field as HTMLTextAreaElement).value).toBe('Список записей');
  }, 15000);

  it('4. sends a task waiting for a verdict to the review, with the right label', async () => {
    open(
      makeProject({
        phases: [
          { id: 'p0', phaseNumber: 0, title: 'Основа', purpose: '', deliverable: '', tasks: [task('Удаление записи', 'review')] }
        ]
      })
    );

    const button = await clickRecommendation();
    expect(button.textContent).toContain('Проверить ответ');
    await waitFor(() => expect(window.location.hash).toBe('#/review'));
  }, 15000);

  it('5. offers the plan when every task is finished', async () => {
    open(
      makeProject({
        phases: [
          {
            id: 'p0',
            phaseNumber: 0,
            title: 'Основа',
            purpose: '',
            deliverable: '',
            tasks: [task('Список записей', 'completed'), task('Удаление записи', 'completed')]
          }
        ]
      })
    );

    const button = await clickRecommendation();
    expect(button.textContent).toContain('Открыть план');
    await waitFor(() => expect(window.location.hash).toBe('#/plan'));
  }, 15000);

  it('6. keeps the stored sentence only for a project that has no plan yet', async () => {
    open(
      makeProject({
        phases: [],
        nextBestAction: 'Опишите идею в пошаговом помощнике'
      })
    );

    const text = (await screen.findByTestId('dashboard-recommendation')).textContent || '';
    expect(text).toContain('Опишите идею');
  }, 15000);
});

describe('A project without an agent does not print an empty label', () => {
  it('7. hides the agent when the project names none', async () => {
    open(makeProject());

    await screen.findByRole('heading', { name: 'Заметки' });
    expect(screen.queryByText(/Агент:/)).toBeNull();
  }, 15000);

  it('8. still prints the agent when the project has one', async () => {
    open(makeProject({ selectedAgent: 'Cursor' }));

    await screen.findByRole('heading', { name: 'Заметки' });
    expect(screen.getByText(/Агент:/).textContent).toContain('Cursor');
  }, 15000);
});
