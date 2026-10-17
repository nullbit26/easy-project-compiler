import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import App from '../App';

/**
 * Choosing the mode: the four cards are presets, and each one sets two independent parts at once —
 * the interface (the four-step helper or the whole workspace) and the autonomy (how much the agent
 * does itself and how much it explains). It used to be one hidden default folded away under "Show
 * details", so a project created without opening that section silently landed a developer in the
 * beginner helper.
 *
 * These tests pin the contract: the cards are on screen first, "Вайб-кодер" is already chosen so a
 * project can be started without answering anything, each card carries nothing but its name (the
 * description is one hover away), the chosen preset is what the created project gets, and either
 * part can be changed on its own afterwards without touching the other — or the code requirements,
 * which never move.
 */

const createdPlan = {
  projectName: 'Режим с самого начала',
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

/** The values every combobox offers, in order. */
const optionsOf = (el: Element) => Array.from((el as HTMLSelectElement).options).map((option) => option.value);

/** The AI autonomy picker of the mode block. The interface itself is the cards above it. */
function autonomySelect(): HTMLSelectElement | null {
  const block = document.querySelector('[data-testid="mode-parts"]');
  return block ? (block.querySelector('select') as HTMLSelectElement) : null;
}

/** The autonomy this wizard would save right now. */
function autonomyValue(): string | null {
  return autonomySelect()?.value ?? null;
}

/** The only combobox on screen that offers the engines. */
function pickEngine(value: string) {
  const select = screen
    .getAllByRole('combobox')
    .find((el) => Array.from((el as HTMLSelectElement).options).some((option) => option.value === value));
  if (!select) throw new Error(`Engine option not found: ${value}`);
  fireEvent.change(select, { target: { value } });
}

function mockApi(analyze: any = {}) {
  return vi.spyOn(global, 'fetch').mockImplementation((input: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    const respond = (data: any) =>
      Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as unknown as Response);

    if (url.includes('/api/files/workspace')) return respond({ root: null, files: [], backups: [] });
    if (url.includes('/api/project/analyze-idea')) return respond(analyze);
    if (url.includes('/api/project/create-idea')) return respond(createdPlan);
    return respond({});
  });
}

/** Opens the creation wizard the way the app offers it at start-up. */
async function openWizard() {
  render(<App />);
  const openButtons = await screen.findAllByRole('button', { name: /Создать проект/ });
  fireEvent.click(openButtons[0]);
  return screen.findByPlaceholderText(/Опишите ключевые механики/);
}

function savedProject() {
  const raw = localStorage.getItem('easy_project_compiler_current_project');
  return raw ? JSON.parse(raw) : null;
}

describe('Working mode chosen at the very start', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    window.location.hash = '';
  });

  it('asks who the user is on screen, starts on "Вайб-кодер", and keeps every description out of the block', async () => {
    localStorage.setItem('easy_project_compiler_lang', 'ru');
    mockApi();

    const ideaBox = await openWizard();

    // The block is the interface question, with all four presets by name.
    expect(screen.getByText('Интерфейс')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Новичок/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Вайб-кодер/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Средний/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Продвинутый/ })).toBeInTheDocument();

    // The block carries no prose: the visible text of a card is its own name, and the description
    // sits in the hidden tooltip behind the question mark next to it.
    const hints: [string, RegExp][] = [
      ['Новичок', /Пошаговый помощник: четыре шага/],
      ['Вайб-кодер', /Полный экран, но настройки выбираются за вас/],
      ['Средний', /Полный экран: настройки контекста и файлов на виду/],
      ['Продвинутый', /Полный экран без подсказок/]
    ];
    for (const [name, hint] of hints) {
      const card = screen.getByRole('button', { name: new RegExp(`^${name}`) });
      expect(card.querySelector('span')?.textContent).toBe(name);
      expect(card.querySelector('[role="tooltip"]')?.textContent).toMatch(hint);
    }
    // The whole block is labels: no explanatory paragraph anywhere inside it, and no "required" tag.
    const modeBlock = screen.getByTestId('mode-block');
    expect(modeBlock.querySelectorAll('p')).toHaveLength(0);
    expect(modeBlock.textContent).not.toMatch(/Режим решает|Пресет задаёт|Сначала выберите|требования к коду/);
    expect(modeBlock.textContent).not.toMatch(/обязательно/i);

    // The description is reachable by hover (and by keyboard/title) on that question mark.
    expect(screen.getByTitle(/Пошаговый помощник: четыре шага/)).toBeInTheDocument();

    // The default is "Вайб-кодер" — a full workspace, with the matching AI autonomy already set.
    expect(screen.getByRole('button', { name: /^Вайб-кодер/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Продвинутый/ })).toHaveAttribute('aria-pressed', 'false');
    expect(autonomyValue()).toBe('Vibe-coder');

    // The autonomy options are named for what the AI does — never for the interface presets.
    expect(optionsOf(autonomySelect() as Element)).toEqual([
      'Beginner / Non-coder',
      'Vibe-coder',
      'Intermediate',
      'Advanced'
    ]);
    expect(
      Array.from((autonomySelect() as HTMLSelectElement).options).map((option) => option.textContent)
    ).toEqual(['Объясняет по шагам', 'Объясняет коротко', 'Показывает детали', 'Только суть']);
    expect(screen.getAllByText('Автономия ИИ').length).toBeGreaterThan(0);

    // The cards are the only control for the preset. The old select lived in the details grid,
    // stayed in the DOM even while folded, and showed "Новичок" as the fallback of an empty value.
    fireEvent.click(screen.getByRole('button', { name: /Показать детали и настройки ИИ/ }));
    const outsideParts = () =>
      screen
        .getAllByRole('combobox')
        .filter((el) => !el.closest('[data-testid="mode-parts"]'))
        .map(optionsOf);
    // The details panel really is in the query scope: its agent picker is right there.
    expect(outsideParts().some((values) => values.includes('Cursor'))).toBe(true);
    expect(outsideParts().some((values) => values.includes('Vibe-coder'))).toBe(false);

    fireEvent.change(ideaBox, { target: { value: 'Приложение для заметок с папками и поиском.' } });
    pickEngine('React 19 + Vite');

    // Idea and engine are in place, and the default mode is already a valid answer.
    const instantPlan = screen.getByRole('button', { name: /Мгновенный план MVP/ });
    await waitFor(() => expect(instantPlan).not.toBeDisabled());

    // Choosing another preset is one click and it re-seeds both parts.
    fireEvent.click(screen.getByRole('button', { name: /^Продвинутый/ }));
    expect(autonomyValue()).toBe('Advanced');
    fireEvent.click(instantPlan);

    // …and the project is born with that preset: full workspace, advanced autonomy.
    await waitFor(() => expect(savedProject()).toBeTruthy(), { timeout: 5000 });
    expect(savedProject().technicalLevel).toBe('Advanced');
    expect(savedProject().interfaceMode).toBe('full');
    expect(savedProject().autonomyLevel).toBe('Advanced');

    // A technical mode opens the technical app: the four-step helper stays off screen. Screens stay
    // mounted once visited, so "off screen" means its container is the hidden one.
    await waitFor(() => expect(window.location.hash).toBe('#/'));
    await waitFor(() =>
      expect(screen.getByText('Простой режим: шаг за шагом').closest('[aria-hidden="true"]')).not.toBeNull()
    );

    // …and the whole workspace is one click away, exactly as for a technical project.
    fireEvent.click(screen.getByRole('button', { name: /Показать все разделы/ }));
    expect(screen.getByRole('button', { name: 'Компилятор промптов' })).toBeInTheDocument();
  }, 20000);

  it('opens the step-by-step helper when the beginner mode was chosen', async () => {
    localStorage.setItem('easy_project_compiler_lang', 'ru');
    mockApi();

    const ideaBox = await openWizard();
    fireEvent.change(ideaBox, { target: { value: 'Простой сайт-визитка с одной страницей.' } });
    pickEngine('React 19 + Vite');

    fireEvent.click(screen.getByRole('button', { name: /^Новичок/ }));
    const instantPlan = screen.getByRole('button', { name: /Мгновенный план MVP/ });
    await waitFor(() => expect(instantPlan).not.toBeDisabled());
    fireEvent.click(instantPlan);

    await waitFor(() => expect(savedProject()).toBeTruthy(), { timeout: 5000 });
    expect(savedProject().technicalLevel).toBe('Beginner / Non-coder');
    expect(savedProject().interfaceMode).toBe('guided');
    expect(savedProject().autonomyLevel).toBe('Beginner / Non-coder');

    // The beginner lands in the four-step helper — the screen that is actually open …
    await waitFor(() => expect(window.location.hash).toBe('#/simple'), { timeout: 4000 });
    await waitFor(() =>
      expect(screen.getByText('Простой режим: шаг за шагом').closest('[aria-hidden="true"]')).toBeNull()
    );
    // …and the technical sections stay hidden there.
    expect(screen.queryByRole('button', { name: 'Компилятор промптов' })).toBeNull();
  }, 20000);

  it('lets the AI propose the mode as well, marked as its own suggestion', async () => {
    localStorage.setItem('easy_project_compiler_lang', 'ru');
    mockApi({
      preferredStack: 'Phaser.js 3 (Canvas)',
      architecturalPattern: 'State Machine (FSM)',
      targetPlatform: 'Web Application',
      technicalLevel: 'Intermediate',
      explanation: 'Phaser 2D оптимален для браузерной игры с физикой.'
    });

    const ideaBox = await openWizard();
    fireEvent.change(ideaBox, {
      target: { value: 'Браузерная 2D игра про открывание бутылок с физикой налива и рекордами.' }
    });

    fireEvent.click(screen.getByRole('button', { name: /Подобрать с ИИ/ }));

    // The AI's mode is selected on the card and flagged as the assistant's own decision.
    await waitFor(
      () => expect(screen.getByRole('button', { name: /^Средний/ })).toHaveAttribute('aria-pressed', 'true'),
      { timeout: 4000 }
    );
    expect(screen.getAllByText('предложено ИИ').length).toBeGreaterThan(0);

    // With the mode on the table the start is unlocked without any further clicking.
    await waitFor(() => expect(screen.getByRole('button', { name: /Мгновенный план MVP/ })).not.toBeDisabled());
  }, 20000);

  it('lets the preset be split: a plain interface can run at a technical autonomy', async () => {
    localStorage.setItem('easy_project_compiler_lang', 'ru');
    mockApi();

    const ideaBox = await openWizard();
    fireEvent.change(ideaBox, { target: { value: 'Приложение для заметок с папками и поиском.' } });
    pickEngine('React 19 + Vite');

    // The preset is picked first — both parts come from it.
    fireEvent.click(screen.getByRole('button', { name: /^Новичок/ }));
    expect(screen.getByRole('button', { name: /^Новичок/ })).toHaveAttribute('aria-pressed', 'true');
    expect(autonomyValue()).toBe('Beginner / Non-coder');

    // Then the AI autonomy is raised on its own: the helper stays, the explanations do not.
    fireEvent.change(autonomySelect() as HTMLSelectElement, { target: { value: 'Advanced' } });
    expect(autonomyValue()).toBe('Advanced');
    expect(screen.getByRole('button', { name: /^Новичок/ })).toHaveAttribute('aria-pressed', 'true');

    const instantPlan = screen.getByRole('button', { name: /Мгновенный план MVP/ });
    await waitFor(() => expect(instantPlan).not.toBeDisabled());
    fireEvent.click(instantPlan);

    await waitFor(() => expect(savedProject()).toBeTruthy(), { timeout: 5000 });
    expect(savedProject().technicalLevel).toBe('Beginner / Non-coder');
    expect(savedProject().interfaceMode).toBe('guided');
    expect(savedProject().autonomyLevel).toBe('Advanced');

    // The interface decides where the app opens: the helper, not the full workspace.
    await waitFor(() => expect(window.location.hash).toBe('#/simple'), { timeout: 4000 });
    await waitFor(() =>
      expect(screen.getByText('Простой режим: шаг за шагом').closest('[aria-hidden="true"]')).toBeNull()
    );
  }, 20000);

  it('keeps the interface fully technical when only the autonomy is lowered', async () => {
    localStorage.setItem('easy_project_compiler_lang', 'ru');
    mockApi();

    const ideaBox = await openWizard();
    fireEvent.change(ideaBox, { target: { value: 'Внутренний дашборд для склада с отчётами.' } });
    pickEngine('React 19 + Vite');

    fireEvent.click(screen.getByRole('button', { name: /^Продвинутый/ }));
    fireEvent.change(autonomySelect() as HTMLSelectElement, { target: { value: 'Beginner / Non-coder' } });

    const instantPlan = screen.getByRole('button', { name: /Мгновенный план MVP/ });
    await waitFor(() => expect(instantPlan).not.toBeDisabled());
    fireEvent.click(instantPlan);

    await waitFor(() => expect(savedProject()).toBeTruthy(), { timeout: 5000 });
    // A beginner autonomy does not drag the user into the four-step helper — that is the other part.
    expect(savedProject().interfaceMode).toBe('full');
    expect(savedProject().autonomyLevel).toBe('Beginner / Non-coder');
    expect(savedProject().technicalLevel).toBe('Advanced');

    await waitFor(() => expect(window.location.hash).toBe('#/'));
    await waitFor(() =>
      expect(screen.getByText('Простой режим: шаг за шагом').closest('[aria-hidden="true"]')).not.toBeNull()
    );
  }, 20000);
});
