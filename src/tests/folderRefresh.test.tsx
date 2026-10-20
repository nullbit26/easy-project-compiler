import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchWorkspaceApi: vi.fn(),
    fetchChecksApi: vi.fn(),
    fetchGitStatusApi: vi.fn(),
    fetchGitBranchesApi: vi.fn(),
    buildPreviewApi: vi.fn()
  };
});

import {
  buildPreviewApi,
  fetchChecksApi,
  fetchGitBranchesApi,
  fetchGitStatusApi,
  fetchWorkspaceApi
} from '../services/api';
import { notifyFolderChanged, resetFolderFeedForTests } from '../services/folderFeed';
import { LanguageProvider } from '../context/LanguageContext';
import { GitPanel } from '../components/GitPanel';
import { ChecksPane } from '../components/studio/ChecksPane';
import { PreviewPane } from '../components/studio/PreviewPane';

/**
 * A window that was open when the folder changed has to show the new folder.
 *
 * Each of these panels reads the folder once, when it is mounted, because each is a screen of its
 * own: a Git list, a checks strip and a running preview drawn a minute ago would otherwise keep
 * showing the previous project's code until the window was closed and opened again. They listen to
 * the announcement made by the transport (`services/folderFeed`) and re-read — and a build already
 * in flight is left alone, because it waited on the folder gate and is already building the new one.
 */

const buildResult = {
  ok: true,
  kind: 'static',
  entry: 'index.html',
  html: '<html><body>the new folder</body></html>',
  diagnostics: [],
  warnings: [],
  candidates: [],
  durationMs: 1,
  root: 'C:\\demo\\game',
  url: null,
  mode: 'inline'
};

const gitStatus = {
  available: true,
  isRepo: true,
  branch: 'main',
  clean: true,
  files: [],
  ahead: 0,
  behind: 0,
  upstream: null,
  identityMissing: false,
  operationInProgress: null
};

const withLanguage = (node: React.ReactNode) => (
  <LanguageProvider>{node}</LanguageProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  resetFolderFeedForTests();
  localStorage.clear();
  localStorage.setItem('easy_project_compiler_lang', 'ru');

  vi.mocked(fetchWorkspaceApi).mockResolvedValue({
    root: 'C:\\demo\\game',
    files: [],
    backups: [],
    timeline: []
  } as any);
  vi.mocked(fetchChecksApi).mockResolvedValue({ checks: [] } as any);
  vi.mocked(fetchGitStatusApi).mockResolvedValue(gitStatus as any);
  vi.mocked(fetchGitBranchesApi).mockResolvedValue({ branches: [], suggestedBase: '' } as any);
  vi.mocked(buildPreviewApi).mockResolvedValue(buildResult as any);
});

afterEach(() => {
  resetFolderFeedForTests();
});

describe('Windows already open when the folder changes', () => {
  it('1. Git re-reads the branch and the changed files of the new folder', async () => {
    render(withLanguage(<GitPanel ru root="C:\\demo\\game" language="ru" />));

    await waitFor(() => expect(fetchGitStatusApi).toHaveBeenCalledTimes(1));

    act(() => notifyFolderChanged('bound', 'C:\\demo\\other'));

    await waitFor(() => expect(fetchGitStatusApi).toHaveBeenCalledTimes(2));
    expect(fetchGitBranchesApi).toHaveBeenCalledTimes(2);
  });

  it('2. the checks window asks the new folder what it can run', async () => {
    render(withLanguage(<ChecksPane />));

    await waitFor(() => expect(fetchChecksApi).toHaveBeenCalledTimes(1));

    act(() => notifyFolderChanged('bound', 'C:\\demo\\other'));

    await waitFor(() => expect(fetchChecksApi).toHaveBeenCalledTimes(2));
  });

  it('3. the preview builds the new folder instead of showing the previous page', async () => {
    render(withLanguage(<PreviewPane project={{ id: 'p1' } as any} />));

    await waitFor(() => expect(buildPreviewApi).toHaveBeenCalledTimes(1));

    act(() => notifyFolderChanged('bound', 'C:\\demo\\other'));

    await waitFor(() => expect(buildPreviewApi).toHaveBeenCalledTimes(2));
  });

  it('4. a build already in flight is not started twice — it is building the new folder already', async () => {
    let finish: (value: any) => void = () => {};
    vi.mocked(buildPreviewApi).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }) as any
    );

    render(withLanguage(<PreviewPane project={{ id: 'p1' } as any} />));
    await waitFor(() => expect(buildPreviewApi).toHaveBeenCalledTimes(1));

    act(() => notifyFolderChanged('bound', 'C:\\demo\\other'));
    await Promise.resolve();

    expect(buildPreviewApi).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish(buildResult);
    });
  });
});
