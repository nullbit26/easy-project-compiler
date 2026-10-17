import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

/**
 * The Git panel is the half of version saving the user actually touches: it has to show what
 * changed, what is about to be saved, and it must never save a file the user did not tick.
 *
 * These tests keep that contract: new files start ticked, a file that looks like a secret does
 * not, the description is written from the selection, and the commit carries exactly the ticks.
 */

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api')>();
  return {
    ...actual,
    fetchGitStatusApi: vi.fn(),
    fetchGitDiffApi: vi.fn(),
    commitGitChangesApi: vi.fn(),
    fetchGitBranchesApi: vi.fn(),
    createGitBranchApi: vi.fn(),
    fetchGitBranchDiffApi: vi.fn()
  };
});

import { GitPanel } from '../components/GitPanel';
import {
  commitGitChangesApi,
  createGitBranchApi,
  fetchGitBranchDiffApi,
  fetchGitBranchesApi,
  fetchGitDiffApi,
  fetchGitStatusApi
} from '../services/api';

const statusMock = fetchGitStatusApi as unknown as ReturnType<typeof vi.fn>;
const diffMock = fetchGitDiffApi as unknown as ReturnType<typeof vi.fn>;
const commitMock = commitGitChangesApi as unknown as ReturnType<typeof vi.fn>;
const branchesMock = fetchGitBranchesApi as unknown as ReturnType<typeof vi.fn>;
const createBranchMock = createGitBranchApi as unknown as ReturnType<typeof vi.fn>;
const branchDiffMock = fetchGitBranchDiffApi as unknown as ReturnType<typeof vi.fn>;

const changedFiles = [
  { path: '.env', state: 'untracked' as const, code: '??', staged: false, untracked: true, sensitive: true },
  { path: 'app.js', state: 'modified' as const, code: ' M', staged: false, untracked: false, sensitive: false },
  { path: 'extra.txt', state: 'untracked' as const, code: '??', staged: false, untracked: true, sensitive: false }
];

function status(overrides: Record<string, unknown> = {}) {
  return {
    available: true,
    isRepo: true,
    branch: 'feature',
    upstream: null,
    ahead: null,
    behind: null,
    clean: false,
    files: changedFiles,
    identityMissing: false,
    message: null,
    ...overrides
  };
}

/** Two branches: the one the work is on, and the one it grew out of. */
function branches(overrides: Record<string, unknown> = {}) {
  return {
    available: true,
    isRepo: true,
    current: 'feature',
    branches: [
      { name: 'feature', current: true, upstream: null, ahead: null, behind: null, tip: 'abc1234' },
      { name: 'master', current: false, upstream: null, ahead: null, behind: null, tip: 'abc1234' }
    ],
    suggestedBase: 'master',
    operationInProgress: null,
    message: null,
    ...overrides
  };
}

function renderPanel() {
  return render(<GitPanel ru root={'C:/projects/demo'} language="ru" refreshToken={0} />);
}

// The version description is the only field the panel used to have; the branch name field would
// otherwise make a bare "textbox" query ambiguous, so both are asked for by name.
const descriptionField = () => screen.getByRole('textbox', { name: 'Описание версии' }) as HTMLTextAreaElement;

beforeEach(() => {
  statusMock.mockReset();
  diffMock.mockReset();
  commitMock.mockReset();
  branchesMock.mockReset();
  createBranchMock.mockReset();
  branchDiffMock.mockReset();
  branchesMock.mockResolvedValue(branches());
});

describe('Git panel', () => {
  it('1. lists what changed, ticks the new files and leaves a secret unticked', async () => {
    statusMock.mockResolvedValue(status());

    renderPanel();

    await waitFor(() => expect(screen.getByText('app.js')).toBeTruthy());
    expect(screen.getByText('feature')).toBeTruthy();
    // Two untracked files, so the "new" badge appears twice; the secret badge once.
    expect(screen.getAllByText('новый')).toHaveLength(2);
    expect(screen.getAllByText('секрет')).toHaveLength(1);

    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    const byRowPath = (path: string) =>
      boxes.find((box) => box.closest('div')?.textContent?.includes(path)) as HTMLInputElement;

    expect(byRowPath('app.js').checked).toBe(true);
    expect(byRowPath('extra.txt').checked).toBe(true);
    // Saving a secret by accident is the one mistake the panel can prevent on its own.
    expect(byRowPath('.env').checked).toBe(false);
    expect((screen.getByRole('button', { name: /Сохранить версию \(2\)/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('2. writes the description from the selection itself, without a model', async () => {
    statusMock.mockResolvedValue(status());

    renderPanel();

    await waitFor(() => expect(screen.getByText('app.js')).toBeTruthy());
    const field = descriptionField();
    expect(field.value).toBe('Обновить: app.js, extra.txt');

    // Ticking the secret adds it to the description — and to the commit — only when asked.
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    const envBox = boxes.find((box) => box.closest('div')?.textContent?.includes('.env')) as HTMLInputElement;
    await act(async () => {
      fireEvent.click(envBox);
    });
    // The order follows the file list, which Git reports sorted by path.
    expect(descriptionField().value).toBe('Обновить: .env, app.js, extra.txt');
  });

  it('3. shows the diff of the file that was opened', async () => {
    statusMock.mockResolvedValue(status());
    diffMock.mockResolvedValue({
      path: 'app.js',
      diff: 'diff --git a/app.js b/app.js\n--- a/app.js\n+++ b/app.js\n@@ -1 +1,2 @@\n one\n+two\n',
      truncated: false,
      binary: false,
      note: null
    });

    renderPanel();

    await waitFor(() => expect(screen.getByText('app.js')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByText('app.js'));
    });

    await waitFor(() => expect(diffMock).toHaveBeenCalledWith('app.js', 'ru'));
    await waitFor(() => expect(screen.getByText('+two')).toBeTruthy());
  });

  it('4. never prints the contents of a file that looks like a secret', async () => {
    statusMock.mockResolvedValue(status());
    diffMock.mockResolvedValue({ path: '.env', diff: '', truncated: false, binary: false, note: 'sensitive' });

    renderPanel();

    await waitFor(() => expect(screen.getByText('.env')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByText('.env'));
    });

    await waitFor(() => expect(screen.getByText(/Содержимое не показывается/)).toBeTruthy());
  });

  it('5. commits exactly the ticked files and reports the saved version', async () => {
    statusMock.mockResolvedValueOnce(status());
    statusMock.mockResolvedValueOnce(status({ clean: true, files: [] }));
    commitMock.mockResolvedValue({
      hash: 'abc1234',
      subject: 'Обновить: app.js, extra.txt',
      committed: ['app.js', 'extra.txt'],
      remaining: []
    });

    renderPanel();

    await waitFor(() => expect(screen.getByText('app.js')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Сохранить версию \(2\)/ }));
    });

    expect(commitMock).toHaveBeenCalledWith({
      files: ['app.js', 'extra.txt'],
      message: 'Обновить: app.js, extra.txt',
      language: 'ru'
    });
    await waitFor(() => expect(screen.getByText('abc1234')).toBeTruthy());
    expect(screen.getByText(/Сохранено файлов: 2/)).toBeTruthy();
    expect(screen.getByText(/Все изменения уже сохранены/)).toBeTruthy();
  });

  it('6b. says what the branch compares with, and starts a branch without moving anything', async () => {
    statusMock.mockResolvedValue(status({ upstream: 'origin/feature', ahead: 2, behind: 1 }));
    createBranchMock.mockResolvedValue({
      branch: 'ai/work-2026-10-15',
      previous: 'feature',
      fromCommit: 'abc1234',
      carriedChanges: 2,
      branches: branches(),
      status: status({ branch: 'ai/work-2026-10-15' })
    });

    renderPanel();

    await waitFor(() => expect(screen.getByText(/Источник origin\/feature/)).toBeTruthy());
    expect(screen.getByText(/своих версий: 2/)).toBeTruthy();

    const nameField = screen.getByRole('textbox', { name: 'Имя новой ветки' }) as HTMLInputElement;
    // The suggestion is dated, so two attempts on different days do not clash.
    expect(nameField.value).toMatch(/^ai\/work-\d{4}-\d{2}-\d{2}$/);

    await act(async () => {
      fireEvent.change(nameField, { target: { value: 'ai/кнопка-дата' } });
      fireEvent.click(screen.getByRole('button', { name: /Начать ветку/ }));
    });

    expect(createBranchMock).toHaveBeenCalledWith({ name: 'ai/кнопка-дата', language: 'ru' });
    // "You are now on a branch" has to come with the two facts that make it safe to believe.
    await waitFor(() => expect(screen.getByText(/Теперь вы на ветке «ai\/work-2026-10-15»/)).toBeTruthy());
    expect(screen.getByText(/коммита abc1234/)).toBeTruthy();
    expect(screen.getByText(/Незакоммиченных файлов перешло с вами: 2/)).toBeTruthy();
  });

  it('6c. shows what the branch added compared with another one', async () => {
    statusMock.mockResolvedValue(status());
    branchDiffMock.mockResolvedValue({
      base: 'master',
      head: 'feature',
      files: [{ path: 'src/button.tsx', state: 'added', additions: 42, deletions: 0 }],
      additions: 42,
      deletions: 0,
      patch: 'diff --git a/src/button.tsx b/src/button.tsx\n@@ -0,0 +1 @@\n+export const Button = 1;\n',
      truncated: false,
      same: false
    });

    renderPanel();

    await waitFor(() => expect(screen.getByText('app.js')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Сравнить/ }));
    });

    expect(branchDiffMock).toHaveBeenCalledWith('master', 'ru');
    await waitFor(() => expect(screen.getByText(/добавлено строк \+42/)).toBeTruthy());
    expect(screen.getByText('src/button.tsx')).toBeTruthy();
    expect(screen.getByText('+42 −0')).toBeTruthy();
  });

  it('6. refuses to commit with nothing selected, and explains a folder without Git', async () => {
    statusMock.mockResolvedValue(status());

    const first = renderPanel();
    await waitFor(() => expect(screen.getByText('app.js')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Снять все' }));
    });
    expect((screen.getByRole('button', { name: /Сохранить версию \(0\)/ }) as HTMLButtonElement).disabled).toBe(true);
    first.unmount();

    statusMock.mockResolvedValue({
      available: true,
      isRepo: false,
      branch: null,
      clean: true,
      files: [],
      identityMissing: false,
      message: 'not_a_repo'
    });
    renderPanel();

    await waitFor(() => expect(screen.getByText(/Эта папка пока не под Git/)).toBeTruthy());
    expect(screen.getByText('git init')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Сохранить версию/ })).toBeNull();
  });

  it('7. reads a reply without a file list as an empty list, not as a broken screen', async () => {
    // The server always names the files it found. A reply this build does not fully recognise — an
    // older server, an answer cut short — still has to leave a screen that works, because the
    // selection is derived from that reply while the screen renders, and a reply that changes shape
    // between the two reads is exactly how a crash reaches a render.
    statusMock.mockResolvedValue({ available: true, isRepo: true, branch: 'feature' });
    branchesMock.mockResolvedValue({ available: true, isRepo: true, current: 'feature' });

    renderPanel();

    await waitFor(() => expect(screen.getByText('Изменённые файлы (0)')).toBeTruthy());
    expect(screen.getByText('feature')).toBeTruthy();
    // Nothing was offered to save, so nothing can be saved by accident.
    expect((screen.getByRole('button', { name: /Сохранить версию \(0\)/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
