import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { bindWorkspaceApi, unbindWorkspaceApi } from '../services/api';
import {
  folderRevision,
  lastFolderChange,
  notifyFolderChanged,
  onFolderChanged,
  resetFolderFeedForTests
} from '../services/folderFeed';

/**
 * The announcement that a window was reading the wrong folder.
 *
 * The transport is where a folder really changes — every way into one (the Files screen, the guided
 * flow, a project being opened, a folder restored at start-up) goes through `bindWorkspaceApi` or
 * `unbindWorkspaceApi` — so those two are the only places that have to say so. What is pinned here
 * is that they do, and that a listener hears it once per change.
 */

describe('Folder changes are announced where the folder changes', () => {
  beforeEach(() => {
    resetFolderFeedForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('1. counts a change and hands it to a listener, with the folder the server now holds', () => {
    const heard: Array<{ kind: string; root: string | null; revision: number }> = [];
    const off = onFolderChanged((change) => heard.push(change));

    notifyFolderChanged('bound', 'C:\\demo\\game');

    expect(folderRevision()).toBe(1);
    expect(heard).toEqual([{ kind: 'bound', root: 'C:\\demo\\game', revision: 1 }]);

    notifyFolderChanged('unbound', null);
    expect(folderRevision()).toBe(2);
    expect(heard).toHaveLength(2);
    expect(heard[1]).toEqual({ kind: 'unbound', root: null, revision: 2 });

    off();
    notifyFolderChanged('bound', 'D:/another');
    expect(heard).toHaveLength(2);
  });

  it('2. a listener that throws cannot fail the change itself', () => {
    const after = vi.fn();
    onFolderChanged(() => {
      throw new Error('this screen is broken');
    });
    onFolderChanged(after);

    expect(() => notifyFolderChanged('bound', 'C:\\demo')).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('3. binding a folder announces it, so every open window can re-read', async () => {
    const answer = (data: any) => ({ ok: true, json: async () => ({ data }) });
    const fetchMock = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.startsWith('/api/files/bind')) {
        return answer({ root: 'C:\\demo\\game', files: [], backups: [], timeline: [] });
      }
      if (url.startsWith('/api/files/unbind')) {
        return answer({ root: null, files: [], backups: [], timeline: [] });
      }
      throw new Error(`unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const heard = vi.fn();
    onFolderChanged(heard);

    await bindWorkspaceApi({ path: 'C:\\demo\\game', language: 'ru' });
    expect(heard).toHaveBeenCalledWith({ kind: 'bound', root: 'C:\\demo\\game', revision: 1 });

    await unbindWorkspaceApi();
    expect(heard).toHaveBeenLastCalledWith({ kind: 'unbound', root: null, revision: 2 });
    expect(lastFolderChange()).toEqual({ kind: 'unbound', root: null, revision: 2 });
  });

  it('4. a bind the server refuses announces nothing: no folder changed', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      json: async () => ({ userMessage: 'Такой папки не существует.' })
    }));
    vi.stubGlobal('fetch', fetchMock);

    const heard = vi.fn();
    onFolderChanged(heard);

    await expect(bindWorkspaceApi({ path: 'C:\\gone', language: 'ru' })).rejects.toBeTruthy();
    expect(heard).not.toHaveBeenCalled();
    expect(folderRevision()).toBe(0);
  });
});
