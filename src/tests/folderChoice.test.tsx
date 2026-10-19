import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import App from '../App';
import { LanguageProvider } from '../context/LanguageContext';
import { ProjectProvider } from '../context/ProjectContext';
import { ProjectWorkspace } from '../components/ProjectWorkspace';
import type { ProjectState } from '../types';

/**
 * Where the folder of a project is decided — and where it is not.
 *
 * A project's folder is chosen once, while the project is created: the creation wizard is the only
 * screen that asks for one, and the only screen that can replace one (see setupFolder.test.tsx).
 * Every other screen reads that decision — it names the folder, counts what is in it, and offers no
 * way to point the app somewhere else, so "which folder is this project allowed to touch" has one
 * answer and one place where it was given.
 *
 * Disconnecting is still allowed, because it decides nothing; its way back is the folder the project
 * was created with, not a picker. A project that never had a folder is sent to the wizard that asks
 * for one instead of being handed a chooser of its own.
 *
 * This used to be the other way round: step 1 of the beginner flow could replace the connected
 * folder, and the working screen had a path field and a "Browse…" button. Three places asking one
 * question is three answers to keep in step, and the screen that asked them was not the screen where
 * the project was being created.
 */

/**
 * One answered server for both screens, behind the app's real services.
 *
 * The folder endpoints are answered and the posting of a folder is recorded, so "which path did this
 * click send" is checked through the code that would send it rather than through a stub of it.
 */
function mockServer({ root, boundRoot = PROJECT_FOLDER }: { root: string | null; boundRoot?: string }) {
  const bound: string[] = [];
  const spy = vi.spyOn(global, 'fetch').mockImplementation((input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    const respond = (data: any) =>
      Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as unknown as Response);

    if (url.includes('/api/files/bind')) {
      try {
        bound.push(JSON.parse(init?.body ?? '{}').path ?? '');
      } catch {
        bound.push('');
      }
      return respond(workspaceState(boundRoot));
    }
    if (url.includes('/api/files/workspace')) return respond(workspaceState(root));
    if (url.includes('/api/files/checks')) return respond({ checks: [] });
    if (url.includes('/api/files/weight/budget')) return respond({ bytes: 0, lines: 0 });
    return respond({});
  });
  return { spy, bound };
}

const PROJECT_FOLDER = 'C:/picked-when-created';
const SERVER_FOLDER = 'C:/demo-folder';

const FILES = [
  { path: 'Assets/Scripts/Game.cs', name: 'Game.cs', dir: 'Assets/Scripts', type: 'code', sizeBytes: 120, isText: true }
];

function projectFixture(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    id: 'folder-choice-project',
    name: 'Folder Choice Demo',
    workspaceRoot: PROJECT_FOLDER,
    projectType: 'Unity 6',
    engineOrFramework: 'Unity 6',
    language: 'C#',
    selectedAgent: 'DeepSeek / Web Chat',
    technicalLevel: 'Beginner / Non-coder',
    nextBestAction: 'Start with step 1',
    brief: {
      id: 'b1',
      projectName: 'Folder Choice Demo',
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
    architecture: {
      technologyStack: ['Unity'],
      folderStructure: [],
      coreEntities: [],
      dataFlow: 'ui -> api',
      testingStrategy: 'none',
      deploymentPlan: 'desktop',
      securityRisks: []
    },
    projectMap: {
      projectName: 'Folder Choice Demo',
      projectType: 'Unity 6',
      engineOrFramework: 'Unity 6',
      language: 'C#',
      rulesFiles: ['AGENTS.md'],
      files: [{ path: 'Assets/Scripts/Game.cs', type: 'code', description: 'Gameplay script' }]
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
            title: 'Add a hunger mechanic',
            goal: 'The player gets hungry',
            status: 'ready',
            relevantFiles: ['Assets/Scripts/Game.cs'],
            acceptanceCriteria: [{ id: 'ac1', description: 'Hunger drains', passed: false }],
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
  } as ProjectState;
}

function workspaceState(root: string | null) {
  return { root, files: root ? FILES : [], backups: [], truncated: false };
}

/** A rendered working screen with a folder already connected on the server. */
function renderWorkspace(project: ProjectState, onOpenNewProjectModal = vi.fn()) {
  render(
    <LanguageProvider>
      <ProjectProvider>
        <ProjectWorkspace project={project} onOpenNewProjectModal={onOpenNewProjectModal} />
      </ProjectProvider>
    </LanguageProvider>
  );
  return { onOpenNewProjectModal };
}

/** Any control that would let this screen point the app at a folder. */
function folderChoosingControls() {
  return screen.queryAllByRole('button', {
    name: /Подключить папку|Подключить$|Обзор|Выбрать папку|Выбрать другую папку|Сменить папку/
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  window.location.hash = '';
  localStorage.setItem('easy_project_compiler_lang', 'ru');
});

describe('The working screen', () => {
  it('1. names the connected folder and offers no way to choose another one', async () => {
    mockServer({ root: SERVER_FOLDER });
    renderWorkspace(projectFixture());

    await waitFor(() => expect(screen.getByText('Папка подключена')).toBeInTheDocument());

    // What it says: which folder, and how much is in it (the path is printed more than once on
    // this screen — the plate that names it, and the file list that works in it).
    expect(screen.getAllByText(SERVER_FOLDER).length).toBeGreaterThan(0);
    expect(screen.getByText('Файлов:')).toBeInTheDocument();

    // What it does not offer: a second place to decide the folder.
    expect(folderChoosingControls()).toHaveLength(0);
    expect(screen.queryByPlaceholderText(/Вставьте путь к папке/)).not.toBeInTheDocument();
    // Reading the same folder again is not choosing anything, so it stays.
    expect(screen.getByRole('button', { name: /Обновить список/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отключить' })).toBeInTheDocument();

    // The sandbox-and-undo sentence is not a paragraph under the row any more: it is the
    // accessible name and the tooltip of one quiet question mark beside the counts.
    expect(screen.queryByText(/Приложение работает только внутри подключённой папки/)).not.toBeInTheDocument();
    const hint = screen.getByRole('button', { name: /^Приложение работает только внутри/ });
    expect(hint).toHaveAttribute('title', expect.stringContaining('никогда не читает .env'));
  });

  it('2. after disconnecting, brings the project’s own folder back instead of asking for one', async () => {
    // The server has no folder, but the project remembers the one it was created with.
    const server = mockServer({ root: null });
    renderWorkspace(projectFixture());

    await waitFor(() => expect(screen.getByText(/Проект создавался с папкой/)).toBeInTheDocument());
    expect(screen.getByText(PROJECT_FOLDER)).toBeInTheDocument();
    expect(folderChoosingControls()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /Подключить её/ }));

    // The project's own folder, sent by name: nothing was chosen, so nothing can be chosen wrongly.
    await waitFor(() => expect(server.bound).toEqual([PROJECT_FOLDER]));
    await waitFor(() => expect(screen.getByText('Папка подключена')).toBeInTheDocument());
  });

  it('3. sends a project that never had a folder to the wizard that asks for one', async () => {
    mockServer({ root: null });
    const project = projectFixture();
    delete (project as { workspaceRoot?: string }).workspaceRoot;
    const { onOpenNewProjectModal } = renderWorkspace(project);

    await waitFor(() => expect(screen.getByText(/Папка не подключена/)).toBeInTheDocument());
    expect(folderChoosingControls()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /Создать проект с папкой/ }));
    expect(onOpenNewProjectModal).toHaveBeenCalledTimes(1);
  });
});

/**
 * The beginner flow, which is the screen a non-coder lives in: it shows the folder step 1 works in
 * and points at the wizard when there is none, but it never becomes a second folder dialog.
 */
async function openBeginnerFlow() {
  await waitFor(() => expect(window.location.hash).not.toBe('#/simple'));
  fireEvent.click(screen.getByRole('button', { name: /Пошаговый помощник/ }));
  await waitFor(() => expect(window.location.hash).toBe('#/simple'), { timeout: 4000 });
}

describe('Step 1 of the beginner flow', () => {
  it('4. shows the folder the project works in without offering to replace it', async () => {
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(projectFixture()));
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([projectFixture()]));

    mockServer({ root: SERVER_FOLDER });
    render(<App />);
    await openBeginnerFlow();

    // A connected folder jumps straight to step 2 — step 1 stays reachable through its chip.
    fireEvent.click(await screen.findByRole('button', { name: /Папка/ }, { timeout: 4000 }));

    await waitFor(() => expect(screen.getByText('Папка подключена:')).toBeInTheDocument(), { timeout: 4000 });
    expect(screen.getByText(SERVER_FOLDER)).toBeInTheDocument();

    // Same rule on the helper's step 1: the sentence is a tooltip, not a paragraph.
    expect(screen.queryByText(/Приложение никогда не читает/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Приложение никогда не читает/ })
    ).toHaveAttribute('title', expect.stringContaining('.env'));

    // Step 1 is not a folder dialog: no picker, no path field, no "connect".
    expect(folderChoosingControls()).toHaveLength(0);
    expect(screen.queryByPlaceholderText('Или вставьте путь к папке')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Обновить список файлов/ })).toBeInTheDocument();
  });

  it('5. hands a project without a folder back to the creation wizard', async () => {
    const project = projectFixture();
    delete (project as { workspaceRoot?: string }).workspaceRoot;
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));

    mockServer({ root: null });
    render(<App />);
    await openBeginnerFlow();

    await waitFor(() => expect(screen.getByText(/Папка не подключена/)).toBeInTheDocument(), { timeout: 4000 });
    expect(folderChoosingControls()).toHaveLength(0);
    // Nothing can be done with this project's files, so step 1 cannot be left.
    expect(screen.getByRole('button', { name: /^Дальше$/ })).toBeDisabled();

    // The folder is chosen where the project is made, so that is where the button goes.
    fireEvent.click(screen.getByRole('button', { name: /Создать проект с папкой/ }));
    await waitFor(() => expect(screen.getByText('Создание нового проекта')).toBeInTheDocument());
    expect(await screen.findByPlaceholderText('Путь к папке (не обязательно)')).toBeInTheDocument();
  });
});
