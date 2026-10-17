import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

/**
 * Writing into someone's project folder is the one irreversible-feeling thing this screen does, so
 * its promises are tested through the interface: nothing is written before it is confirmed, the
 * screen says which file will be replaced and which will be created, the folder is named, and the
 * whole batch comes back with one button.
 */

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api')>();
  return {
    ...actual,
    describeImplementedApi: vi.fn(),
    fetchWorkspaceApi: vi.fn(),
    readWorkspaceFileApi: vi.fn(),
    applyFileChangesApi: vi.fn(),
    undoFileChangesApi: vi.fn()
  };
});

import { ProjectMap } from '../components/ProjectMap';
import {
  applyFileChangesApi,
  describeImplementedApi,
  fetchWorkspaceApi,
  readWorkspaceFileApi,
  undoFileChangesApi
} from '../services/api';
import type { ApplyChangesResult, WorkspaceState } from '../services/api';
import type { ProjectState } from '../types';

const workspaceMock = fetchWorkspaceApi as unknown as ReturnType<typeof vi.fn>;
const readMock = readWorkspaceFileApi as unknown as ReturnType<typeof vi.fn>;
const applyMock = applyFileChangesApi as unknown as ReturnType<typeof vi.fn>;
const undoMock = undoFileChangesApi as unknown as ReturnType<typeof vi.fn>;
const describeMock = describeImplementedApi as unknown as ReturnType<typeof vi.fn>;

const FOLDER = 'C:\\projects\\island-survival';

const WRITTEN_PATHS = ['AGENTS.md', 'CLAUDE.md', '.cursor/rules/project.mdc'];

function projectFixture(): ProjectState {
  return {
    id: 'p_rules',
    name: 'Island Survival',
    projectType: 'Unity',
    engineOrFramework: 'Unity 6 (URP)',
    language: 'C#',
    selectedAgent: 'Cursor',
    rulesFilesContent: {
      agentsMd: '# AGENTS.md\n\n- Строгая типизация\n',
      claudeMd: '# CLAUDE.md — указатель\n\n@AGENTS.md\n',
      cursorRules: '# Правила для Cursor\n\n- Держать сетку чистой\n'
    },
    projectMap: { files: [] }
  } as unknown as ProjectState;
}

function workspace(root: string | null): WorkspaceState {
  return { root, files: [], backups: [], timeline: [], checkpoints: [] };
}

function appliedResult(overrides: Partial<ApplyChangesResult> = {}): ApplyChangesResult {
  return {
    backupId: 'backup-1',
    root: FOLDER,
    results: [
      { path: 'AGENTS.md', action: 'update', status: 'updated' },
      { path: 'CLAUDE.md', action: 'create', status: 'created' },
      { path: '.cursor/rules/project.mdc', action: 'create', status: 'created' }
    ],
    applied: 3,
    failed: 0,
    formatting: { ran: true, tool: 'prettier', toolLabel: 'Prettier', commandLine: 'npx prettier', files: WRITTEN_PATHS, changed: [], skipped: [], durationMs: 40 },
    backups: [],
    ...overrides
  } as ApplyChangesResult;
}

function renderMap() {
  return render(<ProjectMap project={projectFixture()} />);
}

async function openConfirm() {
  // The button is off until the app knows whether there is a folder to write into.
  const button = screen.getByRole('button', { name: /Записать в папку/ });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  fireEvent.click(button);
  return screen.findByTestId('rules-write-confirm');
}

beforeEach(() => {
  vi.clearAllMocks();
  workspaceMock.mockResolvedValue(workspace(FOLDER));
  // By default nothing is in the folder yet.
  readMock.mockRejectedValue(new Error('not found'));
  applyMock.mockResolvedValue(appliedResult());
  undoMock.mockResolvedValue(appliedResult({ results: [], applied: 0 }));
  describeMock.mockResolvedValue({});
});

describe('Writing the rules into the folder', () => {
  it('1. writes nothing at all before the write is confirmed', async () => {
    renderMap();
    const confirm = await openConfirm();

    // The confirm step asks after the three rules files themselves. The freshness check also reads
    // package.json, which is a different question and is not counted here.
    const rulesReads = readMock.mock.calls.filter(([path]: [string]) => WRITTEN_PATHS.includes(path));
    expect(rulesReads).toHaveLength(3);
    expect(applyMock).not.toHaveBeenCalled();

    // The screen shows what is about to be written, path by path.
    for (const path of WRITTEN_PATHS) {
      expect(within(confirm).getByText(path)).toBeTruthy();
    }
  });

  it('2. names the folder it is about to write into', async () => {
    renderMap();
    const confirm = await openConfirm();

    expect(within(confirm).getByText(FOLDER)).toBeTruthy();
  });

  it('3. says which file will be replaced and which will be created', async () => {
    // AGENTS.md is already there; the other two are not.
    readMock.mockImplementation((path: string) =>
      path === 'AGENTS.md' ? Promise.resolve({ path, content: 'old rules', truncated: false, sizeBytes: 9 }) : Promise.reject(new Error('not found'))
    );

    renderMap();
    const confirm = await openConfirm();

    const rows = within(confirm).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('AGENTS.md')).toBeTruthy();
    expect(within(rows[0]).getByText('заменить')).toBeTruthy();
    expect(within(rows[1]).getByText('создать')).toBeTruthy();
    expect(within(rows[2]).getByText('создать')).toBeTruthy();
  });

  it('4. writes exactly the three files, with the action each one needs', async () => {
    readMock.mockImplementation((path: string) =>
      path === 'AGENTS.md' ? Promise.resolve({ path, content: 'old rules', truncated: false, sizeBytes: 9 }) : Promise.reject(new Error('not found'))
    );

    renderMap();
    const confirm = await openConfirm();
    fireEvent.click(within(confirm).getByText('Записать файлы'));

    await waitFor(() => expect(applyMock).toHaveBeenCalledTimes(1));

    const [changes, label] = applyMock.mock.calls[0];
    expect(changes.map((change: any) => change.path)).toEqual(WRITTEN_PATHS);
    expect(changes[0].action).toBe('update');
    expect(changes[1].action).toBe('create');
    expect(changes[2].action).toBe('create');
    // Nothing empty ever reaches the folder: those are the documents the panel showed.
    expect(changes.every((change: any) => change.content.trim().length > 0)).toBe(true);
    expect(changes[0].content).toContain('AGENTS.md');
    expect(changes[2].content).toContain('alwaysApply: true');
    expect(String(label)).toContain('правил');
  });

  it('5. reports what really happened to each file', async () => {
    renderMap();
    const confirm = await openConfirm();
    fireEvent.click(within(confirm).getByText('Записать файлы'));

    const result = await screen.findByTestId('rules-write-result');
    const rows = within(result).getAllByRole('listitem');

    expect(within(rows[0]).getByText('обновлён')).toBeTruthy();
    expect(within(rows[1]).getByText('создан')).toBeTruthy();
    expect(within(rows[2]).getByText('создан')).toBeTruthy();
    // The app tidies up after itself and says so rather than pretending the file is untouched.
    expect(within(result).getByText(/Prettier/)).toBeTruthy();
  });

  it('6. brings the whole write back with one button', async () => {
    renderMap();
    const confirm = await openConfirm();
    fireEvent.click(within(confirm).getByText('Записать файлы'));

    const result = await screen.findByTestId('rules-write-result');
    fireEvent.click(within(result).getByText('Отменить запись'));

    await waitFor(() => expect(undoMock).toHaveBeenCalledWith('backup-1'));
    expect(await screen.findByText('Файлы возвращены как были.')).toBeTruthy();
  });

  it('7. tells the truth when a file could not be written', async () => {
    applyMock.mockResolvedValue(
      appliedResult({
        applied: 2,
        failed: 1,
        results: [
          { path: 'AGENTS.md', action: 'create', status: 'created' },
          { path: 'CLAUDE.md', action: 'create', status: 'failed', error: 'Отказано в доступе' },
          { path: '.cursor/rules/project.mdc', action: 'create', status: 'created' }
        ]
      })
    );

    renderMap();
    const confirm = await openConfirm();
    fireEvent.click(within(confirm).getByText('Записать файлы'));

    const result = await screen.findByTestId('rules-write-result');
    expect(within(result).getByText('Отказано в доступе')).toBeTruthy();
  });

  it('8. shows the reason the server gave when the write is refused outright', async () => {
    applyMock.mockRejectedValue({ userMessage: 'Папка недоступна для записи.' });

    renderMap();
    const confirm = await openConfirm();
    fireEvent.click(within(confirm).getByText('Записать файлы'));

    expect(await screen.findByText('Папка недоступна для записи.')).toBeTruthy();
    expect(screen.queryByTestId('rules-write-result')).toBeNull();
  });
});

describe('When there is nowhere to write', () => {
  it('9. keeps the button off and explains that a folder comes first', async () => {
    workspaceMock.mockResolvedValue(workspace(null));

    renderMap();

    await waitFor(() => expect(screen.getByText(/Папка проекта не подключена/)).toBeTruthy());
    const button = screen.getByRole('button', { name: /Записать в папку/ });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('10. still lets the rules be copied without a folder', async () => {
    workspaceMock.mockResolvedValue(workspace(null));
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });

    renderMap();
    await waitFor(() => expect(screen.getByText(/Папка проекта не подключена/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Копировать правила/ }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String(writeText.mock.calls[0][0])).toContain('AGENTS.md');
  });
});
