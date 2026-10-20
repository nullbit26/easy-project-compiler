import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React, { useEffect, useState } from 'react';

import { holdFolderRequests, resetFolderGate, whenFolderReady } from '../services/folderGate';
import { fetchWorkspaceApi } from '../services/api';
import { ProjectProvider } from '../context/ProjectContext';
import { LanguageProvider } from '../context/LanguageContext';

/**
 * The window between "the app starts" and "the folder is back".
 *
 * Every screen that reads the folder asks the server at mount, and React runs those effects before
 * the provider's own. Before the gate, the screen that mounted first was told «папка не подключена»
 * for a project that records one, and kept that answer — which is exactly the disagreement between
 * windows this was meant to end. These tests pin both halves: the gate itself, and a real provider
 * start-up where a screen asks before the reconnect has finished.
 */

describe('Folder requests wait for the reconnect', () => {
  beforeEach(() => {
    resetFolderGate();
  });

  it('1. holds a folder request until the restore it is waiting for settles', async () => {
    let finish: (root: string) => void = () => {};
    holdFolderRequests(
      new Promise<string>((resolve) => {
        finish = resolve;
      })
    );

    let ready = false;
    const waiting = whenFolderReady().then(() => {
      ready = true;
    });

    await Promise.resolve();
    expect(ready).toBe(false);

    finish('C:\\demo\\game');
    await waiting;
    expect(ready).toBe(true);
  });

  it('2. opens at once when nothing is being restored', async () => {
    let ready = false;
    await whenFolderReady().then(() => {
      ready = true;
    });
    expect(ready).toBe(true);
  });

  it('3. opens again after a restore fails, so the next request reports the real state', async () => {
    let fail: (error: Error) => void = () => {};
    holdFolderRequests(
      new Promise((_resolve, reject) => {
        fail = reject;
      })
    );

    const waiting = whenFolderReady();
    fail(new Error('the folder is gone'));

    await expect(waiting).resolves.toBeUndefined();
    await expect(whenFolderReady()).resolves.toBeUndefined();
  });
});

/** A server that starts with no folder and reconnects one a moment later. */
function startServer(initialRoot: string | null, reconnectedRoot: string) {
  let root = initialRoot;
  const reads: Array<string | null> = [];

  const answer = (data: any) => ({ ok: true, json: async () => ({ data }) });
  const state = () => ({ root, files: [], backups: [], timeline: [] });

  const fetchMock = vi.fn(async (input: any) => {
    const url = String(input);
    if (url.startsWith('/api/files/workspace')) {
      reads.push(root);
      return answer(state());
    }
    if (url.startsWith('/api/files/bind')) {
      // The reconnect is not instant: this is the window a screen could read in.
      await new Promise((resolve) => setTimeout(resolve, 10));
      root = reconnectedRoot;
      return answer(state());
    }
    throw new Error(`unexpected request ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return { reads };
}

/** The screen that asks for the folder in its own mount effect — the one that used to race. */
const Screen: React.FC = () => {
  const [root, setRoot] = useState<string | null>(null);
  const [seen, setSeen] = useState<Array<string | null>>([]);

  useEffect(() => {
    fetchWorkspaceApi('ru').then((workspace: any) => {
      setRoot(workspace?.root || null);
      setSeen((previous) => [...previous, workspace?.root || null]);
    });
  }, []);

  return (
    <div>
      <span data-testid="root">{root ?? 'none'}</span>
      <span data-testid="seen">{seen.map((value) => value ?? 'none').join(',')}</span>
    </div>
  );
};

describe('The first screen to mount reads the restored folder, not an empty one', () => {
  beforeEach(() => {
    resetFolderGate();
    localStorage.clear();
    localStorage.setItem('easy_project_compiler_lang', 'ru');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('4. waits for the project’s folder to be reconnected before answering', async () => {
    const saved = { id: 'p1', name: 'Saved', phases: [], workspaceRoot: 'C:\\saved-project' };
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([saved]));
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(saved));
    const server = startServer(null, 'C:\\saved-project');

    render(
      <LanguageProvider>
        <ProjectProvider>
          <Screen />
        </ProjectProvider>
      </LanguageProvider>
    );

    await waitFor(() => expect(screen.getByTestId('root')).toHaveTextContent('C:\\saved-project'));

    // The screen never saw "no folder": the read waited for the reconnect instead of racing it.
    expect(screen.getByTestId('seen')).toHaveTextContent('C:\\saved-project');
    expect(screen.getByTestId('seen').textContent).not.toContain('none');
    // The order is the whole point: the repair read the server (nothing there), the screen's read
    // waited, and only after the bind did it ask — so it was answered with the project's folder.
    expect(server.reads).toEqual([null, 'C:\\saved-project']);
  });
});
