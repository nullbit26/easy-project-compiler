import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import App from '../App';

/**
 * One screen — one surface.
 *
 * The app's rule (the interface table of the documentation, §4.1 of the manifest): a screen is a
 * surface, not a stack of plates. A card inside a card was the shape screens kept drifting into —
 * the folder, the file list and the open file each in its own rounded frame, inside a pane that
 * already had an edge — and every one of them cost the reader a border to look past.
 *
 * This test is the rule as a measurement: it walks every screen in the real app and fails on a
 * plate inside a plate, naming both. It is deliberately about *nesting*, not about borders in
 * general: things whose frame means something — a field, a proposed change, a failed check — are
 * allowed to have one, and so is the window's own edge.
 */

/* ------------------------------------------------------------------ the rule itself */

/**
 * What counts as a plate, and what deliberately does not.
 *
 * A plate is a *card*: the `bg-slate-900` surface the screens are built from. Three things are
 * therefore not plates even though they are framed, because their frame is the point of them:
 *
 *   • a field or a control (`input`, `textarea`, `select`, anything inside a `button`) — its border
 *     says "you can type here" or "this is a chip", not "this is another card";
 *   • a recessed region (`bg-slate-950`) — the plan's lane, a diff, the inside of a well — which is
 *     what those cards are laid *on*, not a card of its own;
 *   • a divider (`border-t`) rather than a frame.
 */
const PLATE_FILL = /\bbg-slate-900(?:\/\d+)?\b/;
const PLATE_EDGE =
  /(?:^|\s)border(?:-(?:slate|gray|zinc|neutral|stone|indigo|sky|emerald|amber|rose)-\d{2,3}(?:\/\d+)?)?(?:\s|$)/;
const PLATE_RADIUS = /\brounded-(?:md|lg|xl|2xl|3xl)\b/;
const CONTROL = 'button, input, select, textarea, a, label, summary';

const classNameOf = (el: Element): string =>
  typeof el.className === 'string' ? el.className : String((el as HTMLElement).className || '');

/** Is this element drawn as a card: the surface fill, a frame and a radius? */
function isPlate(el: Element): boolean {
  const className = classNameOf(el);
  if (!className) return false;
  if (el.closest(CONTROL)) return false;
  return PLATE_FILL.test(className) && PLATE_EDGE.test(className) && PLATE_RADIUS.test(className);
}

/** A short way to name an element in a failure message. */
function describeElement(el: Element): string {
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48);
  return `<${el.tagName.toLowerCase()} class="${classNameOf(el).slice(0, 96)}"${text ? ` text="${text}"` : ''}>`;
}

/** Every plate on a screen, in document order. */
function plates(root: Element): Element[] {
  return Array.from(root.querySelectorAll('*')).filter(isPlate);
}

/**
 * Every plate that sits inside another plate, innermost first. `root` is the boundary: the screen's
 * own container is not a plate, and nothing outside it is inspected.
 */
function nestedPlates(root: Element): string[] {
  const found: string[] = [];
  Array.from(root.querySelectorAll('*')).forEach((el) => {
    if (!isPlate(el)) return;
    for (let parent = el.parentElement; parent && parent !== root; parent = parent.parentElement) {
      if (isPlate(parent)) {
        found.push(`plate inside plate: ${describeElement(parent)} → ${describeElement(el)}`);
        break;
      }
    }
  });
  return found;
}

/* ------------------------------------------------------------------ the project on screen */

const project = {
  id: 'surface-project',
  name: 'Поверхностный проект',
  projectType: 'React',
  engineOrFramework: 'React 19 + Vite',
  language: 'TypeScript',
  selectedAgent: 'Cursor',
  technicalLevel: 'Advanced',
  nextBestAction: 'Выполнить первую задачу',
  workspaceRoot: 'C:/demo-project',
  interfaceMode: 'full',
  autonomy: 'Balanced',
  brief: {
    id: 'b1',
    projectName: 'Поверхностный проект',
    tagline: 'Демо',
    targetAudience: 'Все',
    coreProblem: 'Ничего',
    coreValue: 'Ничего',
    mvpFeatures: ['Кнопка'],
    futureFeatures: [],
    nonGoals: [],
    technicalConstraints: [],
    successCriteria: []
  },
  architecture: {
    technologyStack: ['React'],
    folderStructure: ['src/ — код', 'tools/ — сборка'],
    coreEntities: ['Task — задача', 'Project — проект'],
    dataFlow: 'ui -> api',
    testingStrategy: 'vitest',
    deploymentPlan: 'static',
    securityRisks: []
  },
  projectMap: {
    projectName: 'Поверхностный проект',
    projectType: 'React',
    engineOrFramework: 'React 19 + Vite',
    language: 'TypeScript',
    rulesFiles: ['AGENTS.md'],
    files: [
      { path: 'src/App.tsx', type: 'code', description: 'src • 40 B' },
      { path: 'src/main.ts', type: 'code', description: 'src • 30 B' },
      { path: 'package.json', type: 'code', description: '. • 200 B' }
    ]
  },
  phases: [
    {
      id: 'p0',
      phaseNumber: 1,
      title: 'Этап 1',
      purpose: 'Старт',
      deliverable: 'Работает',
      tasks: [
        {
          id: 't1',
          phaseId: 'p0',
          title: 'Сделать кнопку сохранения',
          goal: 'Кнопка сохраняет прогресс',
          status: 'ready',
          relevantFiles: ['src/main.ts'],
          acceptanceCriteria: [{ id: 'ac1', description: 'Кнопка сохраняет', passed: false }],
          testRequirements: ['тест на нажатие'],
          estimatedComplexity: 'Small (1 prompt)',
          dependencies: [],
          progressPercent: 0
        },
        {
          id: 't2',
          phaseId: 'p0',
          title: 'Добавить экран настроек',
          goal: 'Экран настроек',
          status: 'backlog',
          relevantFiles: [],
          acceptanceCriteria: [{ id: 'ac2', description: 'Экран есть', passed: false }],
          testRequirements: [],
          estimatedComplexity: 'Medium (2-3 prompts)',
          dependencies: ['t1'],
          progressPercent: 0
        }
      ]
    }
  ],
  recentErrors: [],
  rulesFilesContent: { agentsMd: '# Правила', claudeMd: '', cursorRules: '' }
};

/* ------------------------------------------------------------------ the API the screens talk to */

function mockApi() {
  return vi.spyOn(global, 'fetch').mockImplementation((input: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    const respond = (data: any) =>
      Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as unknown as Response);

    if (url.includes('/api/files/workspace')) {
      return respond({
        root: 'C:/demo-project',
        truncated: false,
        files: [
          { path: 'src/App.tsx', name: 'App.tsx', dir: 'src', type: 'code', sizeBytes: 40, isText: true },
          { path: 'src/main.ts', name: 'main.ts', dir: 'src', type: 'code', sizeBytes: 30, isText: true },
          { path: 'package.json', name: 'package.json', dir: '', type: 'code', sizeBytes: 200, isText: true }
        ],
        backups: [{ id: 'b1', createdAt: new Date().toISOString(), fileCount: 1, paths: ['src/main.ts'] }],
        timeline: [
          {
            id: 'c1',
            createdAt: new Date().toISOString(),
            fileCount: 1,
            paths: ['src/main.ts'],
            label: 'Автономный цикл'
          }
        ],
        checkpoints: [{ id: 'k1', name: 'Всё работало', createdAt: new Date().toISOString(), changesetId: 'c1' }]
      });
    }
    if (url.includes('/api/files/checks')) {
      return respond({
        checks: [
          {
            id: 'build:build',
            kind: 'build',
            key: 'build',
            labelRu: 'Сборка проекта',
            labelEn: 'Build',
            commandLine: 'npm run build',
            tokens: ['npm', 'run', 'build']
          }
        ]
      });
    }
    if (url.includes('/api/files/weight/budget')) {
      return respond({ bytes: null, fileCount: null, note: null });
    }
    if (url.includes('/api/files/git/status')) {
      return respond({ isRepo: false, branch: '', changes: [], secrets: [] });
    }
    if (url.includes('/api/files/browser') || url.includes('/api/files/browse')) {
      return respond({ path: 'C:/demo-project', dirs: [], files: [] });
    }
    if (url.includes('/api/health')) return respond({ build: 'test', version: '1.2.0' });
    return respond({});
  });
}

const SCREENS: { path: string; button: RegExp | string }[] = [
  { path: '#/', button: 'Обзор проекта' },
  { path: '#/simple', button: /Пошаговый помощник/ },
  { path: '#/compiler', button: 'Компилятор промптов' },
  { path: '#/review', button: 'Проверка ответа' },
  { path: '#/preview', button: 'Песочница и код' },
  { path: '#/coach', button: 'Тренер ошибок' },
  { path: '#/plan', button: 'План и задачи' },
  { path: '#/studio', button: 'Студия' },
  { path: '#/map', button: 'Карта проекта' },
  { path: '#/files', button: 'Файлы проекта' },
  { path: '#/brief', button: 'Бриф и архитектура' }
];

/**
 * The screen the router is showing: every visited screen stays mounted, and only one is visible.
 *
 * The wrapper is the `div` the app draws per screen — icons carry `aria-hidden` of their own, so the
 * search is by tag and value rather than by the attribute alone.
 */
function activeScreen(): HTMLElement {
  const shown = Array.from(document.querySelectorAll<HTMLElement>('main [aria-hidden]')).find(
    (el) => el.tagName === 'DIV' && el.getAttribute('aria-hidden') === 'false'
  );
  if (!shown) throw new Error('no screen is on stage');
  return shown;
}

async function openScreen(button: RegExp | string) {
  fireEvent.click(await screen.findByRole('button', { name: button }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}

describe('One screen — one surface', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    window.location.hash = '';
  });

  it('draws no plate inside a plate on any screen', async () => {
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
    localStorage.setItem('easy_project_compiler_lang', 'ru');
    mockApi();

    render(<App />);

    // Every screen at once: the workspace list starts folded for a saved project.
    fireEvent.click(await screen.findByRole('button', { name: /Показать все разделы/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Студия' })).toBeInTheDocument());

    const offences: Record<string, string[]> = {};
    const cardsSeen: Record<string, number> = {};
    for (const board of SCREENS) {
      await openScreen(board.button);
      await waitFor(() => expect(window.location.hash).toBe(board.path), { timeout: 4000 });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 120));
      });
      const screen = activeScreen();
      cardsSeen[board.path] = plates(screen).length;
      const found = nestedPlates(screen);
      if (found.length > 0) offences[board.path] = found;
    }

    expect(offences).toEqual({});

    // The walk is looking at the real screen: the compiler is built from two cards, so a run that
    // sees none of them would be measuring an empty element and passing for the wrong reason.
    expect(cardsSeen['#/compiler']).toBeGreaterThan(0);

    // The file screen is the one this rule was written for: it is a single surface, no cards at all.
    expect(cardsSeen['#/files']).toBe(0);
  }, 40000);
});
