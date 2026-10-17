import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import App from '../App';

/**
 * Choosing the project folder while creating the project: the wizard connects to the real folder
 * immediately, and the project is born knowing where its files live — with the real file list in
 * its project map instead of a placeholder entry.
 */

const createdProject = {
  projectName: 'Папка с самого начала',
  projectType: 'React',
  engineOrFramework: 'React 19 + Vite',
  language: 'TypeScript',
  tagline: 'Демо',
  targetAudience: 'Все',
  coreProblem: 'Ничего',
  coreValue: 'Ничего',
  mvpFeatures: ['Кнопка'],
  futureFeatures: [],
  nonGoals: [],
  technicalConstraints: [],
  successCriteria: [],
  clarifyingQuestions: [],
  architecture: {
    technologyStack: ['React'],
    folderStructure: ['src/'],
    coreEntities: ['App'],
    dataFlow: 'ui -> api',
    testingStrategy: 'vitest',
    deploymentPlan: 'static',
    securityRisks: []
  },
  phases: [
    {
      phaseNumber: 0,
      title: 'Phase 0 - Setup',
      purpose: 'Старт',
      deliverable: 'Работает',
      tasks: [
        {
          title: 'Собрать экран',
          goal: 'Экран собирается',
          relevantFiles: ['src/main.tsx'],
          acceptanceCriteria: ['Сборка без ошибок'],
          testRequirements: ['Unit test'],
          estimatedComplexity: 'Small (1 prompt)',
          dependencies: []
        }
      ]
    }
  ]
};

/** Counts how often a given endpoint was called. */
function callCount(spy: any, part: string): number {
  return spy.mock.calls.filter((call: any[]) => {
    const url = typeof call[0] === 'string' ? call[0] : call[0]?.url ?? '';
    return url.includes(part);
  }).length;
}

/**
 * The engine/stack is required before anything runs, and it is the only combobox on screen that
 * offers the game engines — the advanced ones sit folded away and are not considered visible.
 */
function pickEngine(value: string) {
  const select = screen
    .getAllByRole('combobox')
    .find((el) => Array.from((el as HTMLSelectElement).options).some((option) => option.value === value));
  if (!select) throw new Error(`Engine option not found: ${value}`);
  fireEvent.change(select, { target: { value } });
}

/**
 * The mode is a first question as well: nothing starts before it is picked, so every creation test
 * picks one — the same way a person does, on the card.
 */
function pickMode(label: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

function mockApi() {
  return vi.spyOn(global, 'fetch').mockImplementation((input: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    const respond = (data: any) =>
      Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as unknown as Response);

    if (url.includes('/api/files/bind')) {
      return respond({
        root: 'C:/my-real-project',
        files: [
          { path: 'src/main.tsx', name: 'main.tsx', dir: 'src', type: 'code', sizeBytes: 120, isText: true },
          { path: 'src/App.tsx', name: 'App.tsx', dir: 'src', type: 'code', sizeBytes: 320, isText: true }
        ],
        backups: []
      });
    }
    if (url.includes('/api/files/workspace')) {
      return respond({ root: null, files: [], backups: [] });
    }
    if (url.includes('/api/project/create-idea')) return respond(createdProject);
    if (url.includes('/api/project/analyze-idea')) return respond({});
    return respond({});
  });
}

describe('Project folder chosen during creation', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    window.location.hash = '';
  });

  it('connects the folder in the wizard and stores it on the new project with its real files', async () => {
    localStorage.setItem('easy_project_compiler_lang', 'ru');
    const spy = mockApi();

    render(<App />);

    // Open the creation wizard (the sidebar offers both a "+" and a dashed entry for it).
    const openButtons = screen.getAllByRole('button', { name: /Создать проект/ });
    fireEvent.click(openButtons[0]);

    const ideaBox = await screen.findByPlaceholderText(/Опишите ключевые механики/);
    fireEvent.change(ideaBox, { target: { value: 'Приложение для заметок с папками и поиском.' } });

    // Nothing starts before the mode and a game/engine are chosen, so pick them first.
    pickMode(/^Вайб-кодер/);
    pickEngine('Phaser.js 3 (Canvas)');

    // The folder field is part of the first wizard step.
    const folderInput = await screen.findByPlaceholderText('Путь к папке (не обязательно)');
    fireEvent.change(folderInput, { target: { value: 'C:/my-real-project' } });
    fireEvent.click(screen.getByRole('button', { name: 'Подключить' }));

    await waitFor(() => expect(screen.getByText('Папка подключена')).toBeInTheDocument(), { timeout: 4000 });
    expect(screen.getByText(/Файлов:/)).toBeInTheDocument();

    // Create the project without the question step.
    const instantPlan = screen.getByRole('button', { name: /Мгновенный план MVP/ });
    expect(instantPlan).not.toBeDisabled();
    fireEvent.click(instantPlan);

    await waitFor(
      () => expect(localStorage.getItem('easy_project_compiler_current_project')).toBeTruthy(),
      { timeout: 5000 }
    );

    const saved = JSON.parse(localStorage.getItem('easy_project_compiler_current_project') as string);
    expect(saved.technicalLevel).toBe('Vibe-coder');
    expect(saved.workspaceRoot).toBe('C:/my-real-project');
    expect(saved.projectMap.files.map((f: any) => f.path)).toEqual(['src/main.tsx', 'src/App.tsx']);
    expect(spy).toHaveBeenCalled();
  }, 20000);

  it('only fills the path field when the folder is chosen in the system dialog', async () => {
    localStorage.setItem('easy_project_compiler_lang', 'ru');

    let bindCalls = 0;
    vi.spyOn(global, 'fetch').mockImplementation((input: any) => {
      const url = typeof input === 'string' ? input : input?.url ?? '';
      const respond = (data: any) =>
        Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as unknown as Response);

      if (url.includes('/api/files/pick-folder')) {
        return respond({ supported: true, path: 'C:/picked-in-wizard', cancelled: false });
      }
      if (url.includes('/api/files/bind')) {
        bindCalls += 1;
        return respond({ root: 'C:/picked-in-wizard', files: [], backups: [] });
      }
      if (url.includes('/api/files/workspace')) return respond({ root: null, files: [], backups: [] });
      return respond({});
    });

    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: /Создать проект/ })[0]);

    const folderInput = await screen.findByPlaceholderText('Путь к папке (не обязательно)');
    fireEvent.click(screen.getByRole('button', { name: /Выбрать папку/ }));


    // The dialog only puts the folder into the field: nothing is read or connected yet, and the
    // field says out loud what the next click has to be.
    await waitFor(() => expect(folderInput).toHaveValue('C:/picked-in-wizard'));
    expect(bindCalls).toBe(0);
    expect(screen.queryByText('Папка подключена')).not.toBeInTheDocument();
    expect(screen.getByText('Папка ещё не подключена — нажмите «Подключить»')).toBeInTheDocument();

    // The explicit button is what connects (and reads) the folder.
    fireEvent.click(screen.getByRole('button', { name: 'Подключить' }));
    await waitFor(() => expect(bindCalls).toBe(1), { timeout: 4000 });
    await waitFor(() => expect(screen.getByText('Папка подключена')).toBeInTheDocument(), { timeout: 4000 });
    expect(screen.queryByText(/Папка ещё не подключена/)).not.toBeInTheDocument();
  }, 20000);

  it('refuses to start the analysis before a game/engine is chosen, and marks what the AI decides', async () => {
    localStorage.setItem('easy_project_compiler_lang', 'ru');

    const spy = vi.spyOn(global, 'fetch').mockImplementation((input: any) => {
      const url = typeof input === 'string' ? input : input?.url ?? '';
      const respond = (data: any) =>
        Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as unknown as Response);

      if (url.includes('/api/project/analyze-idea')) {
        return respond({
          preferredStack: 'Phaser.js 3 (Canvas)',
          architecturalPattern: 'State Machine (FSM)',
          targetPlatform: 'Web Application',
          explanation: 'Phaser 2D оптимален для браузерной игры с физикой.'
        });
      }
      return respond({});
    });

    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: /Создать проект/ })[0]);

    const ideaBox = await screen.findByPlaceholderText(/Опишите ключевые механики/);
    fireEvent.change(ideaBox, {
      target: { value: 'Браузерная 2D игра про открывание бутылок с физикой налива, рекордами и звуком.' }
    });

    // The mode is picked by hand here; the engine is still missing, which is what this test is
    // about — so the flow refuses to start. Nothing nags about it on screen: the disabled buttons
    // are the whole signal, and there is neither a "required" tag nor an amber warning.
    pickMode(/^Средний/);
    expect(screen.getByRole('button', { name: /Уточнить детали архитектуры/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Мгновенный план MVP/ })).toBeDisabled();
    expect(screen.queryByText(/Сначала выберите движок или стек/)).toBeNull();
    expect(screen.queryByText(/^обязательно$/i)).toBeNull();

    // Typing alone never spends an AI request.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    expect(callCount(spy, '/api/project/analyze-idea')).toBe(0);

    // The AI proposes the engine — and what it fills in is marked as its own suggestion.
    fireEvent.click(screen.getByRole('button', { name: /Подобрать с ИИ/ }));
    await waitFor(() => expect(callCount(spy, '/api/project/analyze-idea')).toBe(1), { timeout: 4000 });

    const marksFromAi = await waitFor(() => {
      const marks = screen.getAllByText('предложено ИИ');
      expect(marks.length).toBeGreaterThan(0);
      return marks.length;
    });
    expect(screen.getByText(/Phaser 2D оптимален/)).toBeInTheDocument();

    // With the engine on the table the analysis can finally start.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Уточнить детали архитектуры/ })).not.toBeDisabled()
    );

    // Editing a value by hand clears the mark on that field only.
    pickEngine('Godot 4.3 (GDScript)');
    expect(screen.getAllByText('предложено ИИ').length).toBe(marksFromAi - 1);
  }, 20000);

  /**
   * A folder chosen by mistake must be replaceable where it was chosen.
   *
   * The wizard is the only screen that asks for the folder, so it is the only screen that can be
   * asked to change its mind: the connected plate states the folder and offers "Сменить папку",
   * which brings the chooser back — and the folder actually connected is the one that ends up on the
   * plate, not the one that was connected before the change.
   */
  it('replaces a connected folder without leaving the wizard', async () => {
    localStorage.setItem('easy_project_compiler_lang', 'ru');

    const bound: string[] = [];
    vi.spyOn(global, 'fetch').mockImplementation((input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url ?? '';
      const respond = (data: any) =>
        Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as unknown as Response);

      if (url.includes('/api/files/bind')) {
        const path = JSON.parse(init?.body ?? '{}').path;
        bound.push(path);
        return respond({
          root: path,
          files: [
            { path: 'src/main.tsx', name: 'main.tsx', dir: 'src', type: 'code', sizeBytes: 120, isText: true },
            { path: 'src/App.tsx', name: 'App.tsx', dir: 'src', type: 'code', sizeBytes: 320, isText: true }
          ],
          backups: []
        });
      }
      if (url.includes('/api/files/workspace')) return respond({ root: null, files: [], backups: [] });
      return respond({});
    });

    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: /Создать проект/ })[0]);

    // First folder, connected by hand.
    const folderInput = await screen.findByPlaceholderText('Путь к папке (не обязательно)');
    fireEvent.change(folderInput, { target: { value: 'C:/chosen-by-mistake' } });
    fireEvent.click(screen.getByRole('button', { name: 'Подключить' }));
    await waitFor(() => expect(screen.getByText('Папка подключена')).toBeInTheDocument(), { timeout: 4000 });
    expect(bound).toEqual(['C:/chosen-by-mistake']);

    // The plate offers one way out, and it is the one that replaces the folder.
    fireEvent.click(screen.getByRole('button', { name: 'Сменить папку' }));
    const replacement = await screen.findByPlaceholderText('Путь к папке (не обязательно)');

    // …and changing one's mind twice is possible: the connected folder is one click away.
    fireEvent.click(screen.getByRole('button', { name: 'Оставить эту папку' }));
    expect(await screen.findByText('C:/chosen-by-mistake')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Сменить папку' }));
    fireEvent.change(await screen.findByPlaceholderText('Путь к папке (не обязательно)'), {
      target: { value: 'C:/the-real-one' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Подключить' }));

    // The plate then names the new folder, not the old one, and the folder stays replaceable.
    await waitFor(
      () => expect(screen.getByText('C:/the-real-one')).toBeInTheDocument(),
      { timeout: 4000 }
    );
    expect(screen.queryByText('C:/chosen-by-mistake')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сменить папку' })).toBeInTheDocument();
    expect(bound).toEqual(['C:/chosen-by-mistake', 'C:/the-real-one']);
    expect(replacement).toBeTruthy();
  }, 20000);
});
