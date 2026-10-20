import { useSyncExternalStore } from 'react';

/**
 * "The folder these windows were reading is not the folder any more."
 *
 * The folder is one fact for the whole app, but the windows that read it are many: Files, Git, the
 * checks, the preview, the studio's own panes. Each of them reads once, when it is mounted, because
 * each is a screen of its own — so a folder connected on the Files screen left a Git panel or a
 * running preview built a minute earlier still showing the *previous* folder's code, and the only
 * way to fix it was to leave the window and come back.
 *
 * The announcement is made where the folder really changes — the transport calls that bind and
 * unbind it (`services/api.ts`) — not in the screen that happened to press the button. Every path
 * into a folder change goes through those two calls (the Files screen, the guided flow, the project
 * being opened, its folder being restored), so a window that listens cannot be left out of one of
 * them.
 *
 * What a listener does with it is its own business: Git re-reads the branch and the changed files,
 * the checks strip re-asks what this folder can run, the preview builds again. A screen that is
 * already in the middle of a read started after the change (see `services/folderGate`) ignores the
 * announcement rather than doing the same work twice.
 */

export type FolderChangeKind = 'bound' | 'unbound';

export interface FolderChange {
  kind: FolderChangeKind;
  /** The folder the server holds now; `null` when it holds none. */
  root: string | null;
  /** Rises by one with every change, so a screen can use it as a dependency of its own read. */
  revision: number;
}

type Listener = (change: FolderChange) => void;

const listeners = new Set<Listener>();
let revision = 0;
let lastChange: FolderChange | null = null;

/** Says that the server's folder changed: called from the transport, once per successful change. */
export function notifyFolderChanged(kind: FolderChangeKind, root: string | null): void {
  revision += 1;
  lastChange = { kind, root, revision };
  for (const listener of [...listeners]) {
    try {
      listener(lastChange);
    } catch {
      // A listener is a reaction to a finished bind; it must never be able to fail the bind.
    }
  }
}

/** Subscribes to folder changes. Returns the unsubscribe function. */
export function onFolderChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function folderRevision(): number {
  return revision;
}

export function lastFolderChange(): FolderChange | null {
  return lastChange;
}

/** Keeps one test's listeners out of the next test's run. */
export function resetFolderFeedForTests(): void {
  listeners.clear();
  revision = 0;
  lastChange = null;
}

// Stable across renders: `useSyncExternalStore` resubscribes whenever the function identity changes,
// and a screen must not drop its subscription on every render of a running build.
const subscribe = (onStoreChange: () => void) => onFolderChanged(() => onStoreChange());

/**
 * The number of folder changes so far, as a render-friendly value.
 *
 * Screens put it in the dependency list of the effect that reads the folder: a change re-runs the
 * read, and the same number never runs it twice.
 */
export function useFolderRevision(): number {
  return useSyncExternalStore(subscribe, folderRevision, folderRevision);
}
