import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import App from '../App';

/**
 * Starting a project from an existing folder ("Импорт структуры"): the AI reads the connected
 * folder, the wizard shows what it understood, and only then the project is created and the flow
 * continues — the same way it does for a project created from an idea.
 */

const importedPlan = {
  projectName: 'TaskMaster Legacy',
  projectType: 'React',
  engineOrFramework: 'React 19 + Vite',
  language: 'TypeScript',
  tagline: 'Канбан-доска задач для небольших команд.',
  targetAudience: 'Небольшие команды',
  coreProblem: 'Задачи теряются в переписке',
  coreValue: 'Порядок в задачах',
  mvpFeatures: ['Доска задач'],
  futureFeatures: [],
  nonGoals: [],
  technicalConstraints: ['Сохранять текущий стек'],
  successCriteria: ['Проект собирается'],
  clarifyingQuestions: [],
  architecture: {
    technologyStack: ['React 19', 'Vite'],
    folderStructure: ['src/'],
    coreEntities: ['src/App.tsx'],
    dataFlow: 'ui -> api',
    testingStrategy: 'vitest',
    deploymentPlan: 'static',
    securityRisks: []
  },
  phases: [
    {
      phaseNumber: 0,
      title: 'Знакомство с проектом',
      purpose: 'Понять, что уже написано',
      deliverable: 'Карта файлов',
      tasks: [
        {
          title: 'Изучить точку входа',
          goal: 'Прочитать src/App.tsx',
          relevantFiles: ['src/App.tsx'],
          acceptanceCriteria: ['Точка входа прочитана'],
          testRequirements: ['Сборка'],
          estimatedComplexity: 'Small (1 prompt)',
          dependencies: []
        },
        {
          title: 'Проверить сборку',
          goal: 'Собрать проект',
          relevantFiles: ['package.json'],
          acceptanceCriteria: ['Сборка без ошибок'],
          testRequirements: ['Сборка'],
          estimatedComplexity: 'Small (1 prompt)',
          dependencies: []
        }
      ]
    },
    {
      phaseNumber: 1,
      title: 'Развитие функциональности',
      purpose: 'Добавить фильтр',
      deliverable: 'Фильтр работает',
      tasks: [
        {
          title: 'Добавить фильтр задач',
          goal: 'Отфильтровать задачи по статусу',
          relevantFiles: ['src/App.tsx'],
          acceptanceCriteria: ['Фильтр работает'],
          testRequirements: ['Ручная проверка'],
          estimatedComplexity: 'Medium (2-3 prompts)',
          dependencies: ['0_0']
        }
      ]
    }
  ],
  understanding: {
    source: 'folder',
    root: 'C:/legacy-task-board',
    fileCount: 2,
    keyFiles: ['README.md', 'package.json'],
    evidence: ['Компоненты .tsx в папке', 'README: Team task board'],
    projectType: 'React',
    engineOrFramework: 'React 19 + Vite',
    language: 'TypeScript'
  },
  engine: 'local'
};

function callCount(spy: any, part: string): number {
  return spy.mock.calls.filter((call: any[]) => {
    const url = typeof call[0] === 'string' ? call[0] : call[0]?.url ?? '';
    return url.includes(part);
  }).length;
}

function requestBody(spy: any, part: string): any {
  const call = spy.mock.calls.find((entry: any[]) => {
    const url = typeof entry[0] === 'string' ? entry[0] : entry[0]?.url ?? '';
    return url.includes(part);
  });
  return JSON.parse(call[1].body);
}

function mockApi(plan: any = importedPlan) {
  return vi.spyOn(global, 'fetch').mockImplementation((input: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    const respond = (data: any) =>
      Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as unknown as Response);

    if (url.includes('/api/files/bind')) {
      return respond({
        root: 'C:/legacy-task-board',
        files: [
          { path: 'src/App.tsx', name: 'App.tsx', dir: 'src', type: 'code', sizeBytes: 900, isText: true },
          { path: 'README.md', name: 'README.md', dir: '', type: 'asset', sizeBytes: 120, isText: true }
        ],
        backups: []
      });
    }
    if (url.includes('/api/files/workspace')) return respond({ root: null, files: [], backups: [] });
    if (url.includes('/api/project/import-workspace')) return respond(plan);
    return respond({});
  });
}

async function openImportTab() {
  fireEvent.click(screen.getAllByRole('button', { name: /Создать проект/ })[0]);
  fireEvent.click(await screen.findByRole('button', { name: 'Импорт структуры' }));
  // This tab asks for the mode too: an imported project must not get a silent default either.
  fireEvent.click(screen.getByRole('button', { name: /^Вайб-кодер/ }));
}

async function connectFolder() {
  const folderInput = await screen.findByPlaceholderText('Путь к папке (не обязательно)');
  fireEvent.change(folderInput, { target: { value: 'C:/legacy-task-board' } });
  fireEvent.click(screen.getByRole('button', { name: 'Подключить' }));
  await waitFor(() => expect(screen.getByText('Папка подключена')).toBeInTheDocument(), { timeout: 4000 });
}

describe('Importing an existing project folder', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    window.location.hash = '';
  });

  it('has the AI read the folder, shows what it understood, and only then creates the project', async () => {
    localStorage.setItem('easy_project_compiler_lang', 'ru');
    const spy = mockApi();

    render(<App />);
    await openImportTab();
    await connectFolder();

    // Nothing is understood before the user asks for it.
    expect(callCount(spy, '/api/project/import-workspace')).toBe(0);
    expect(screen.queryByText('ИИ понял проект')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Изучить папку и понять проект/ }));

    await waitFor(() => expect(callCount(spy, '/api/project/import-workspace')).toBe(1), { timeout: 4000 });
    // No file list in the request: the server reads the connected folder itself.
    expect(requestBody(spy, '/api/project/import-workspace').paths).toBeUndefined();

    // What the AI understood is on screen, marked as AI work.
    expect(await screen.findByText('ИИ понял проект')).toBeInTheDocument();
    expect(screen.getByText('TaskMaster Legacy')).toBeInTheDocument();
    expect(screen.getByText('Канбан-доска задач для небольших команд.')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
    expect(screen.getByText(/Компоненты \.tsx в папке/)).toBeInTheDocument();
    expect(screen.getAllByText('предложено ИИ').length).toBeGreaterThan(0);

    // …and only the explicit continue creates the project.
    expect(localStorage.getItem('easy_project_compiler_current_project')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Создать проект и продолжить/ }));

    await waitFor(() => expect(localStorage.getItem('easy_project_compiler_current_project')).toBeTruthy(), {
      timeout: 5000
    });

    const saved = JSON.parse(localStorage.getItem('easy_project_compiler_current_project') as string);
    expect(saved.name).toBe('TaskMaster Legacy');
    expect(saved.workspaceRoot).toBe('C:/legacy-task-board');
    expect(saved.engineOrFramework).toBe('React 19 + Vite');
    expect(saved.brief.tagline).toBe('Канбан-доска задач для небольших команд.');
    // The plan came from the understanding, with real paths in the tasks.
    expect(saved.phases).toHaveLength(2);
    expect(saved.phases[0].tasks[0].relevantFiles).toEqual(['src/App.tsx']);
    expect(saved.phases[0].tasks[0].status).toBe('ready');
    expect(saved.projectMap.files.map((file: any) => file.path)).toEqual(['src/App.tsx', 'README.md']);
  }, 20000);

  it('understands the project from a pasted file list when no folder is connected', async () => {
    localStorage.setItem('easy_project_compiler_lang', 'ru');
    const spy = mockApi({
      ...importedPlan,
      understanding: { ...importedPlan.understanding, source: 'paths', root: null, keyFiles: [], fileCount: 3 }
    });

    render(<App />);
    await openImportTab();

    const listBox = await screen.findByPlaceholderText(/Вставьте список файлов/);
    fireEvent.change(listBox, { target: { value: 'Assets/Scripts/PlayerHealth.cs\nAssets/Scenes/ForestLevel.unity' } });

    fireEvent.click(screen.getByRole('button', { name: /Понять проект по списку файлов/ }));

    await waitFor(() => expect(callCount(spy, '/api/project/import-workspace')).toBe(1), { timeout: 4000 });
    expect(requestBody(spy, '/api/project/import-workspace').paths).toEqual([
      'Assets/Scripts/PlayerHealth.cs',
      'Assets/Scenes/ForestLevel.unity'
    ]);

    expect(await screen.findByText('ИИ понял проект')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Создать проект и продолжить/ }));
    await waitFor(() => expect(localStorage.getItem('easy_project_compiler_current_project')).toBeTruthy(), {
      timeout: 5000
    });

    const saved = JSON.parse(localStorage.getItem('easy_project_compiler_current_project') as string);
    expect(saved.name).toBe('TaskMaster Legacy');
    // Nothing was connected, so the map keeps the files the user listed.
    expect(saved.projectMap.files.map((file: any) => file.path)).toEqual([
      'Assets/Scripts/PlayerHealth.cs',
      'Assets/Scenes/ForestLevel.unity'
    ]);
  }, 20000);
});
