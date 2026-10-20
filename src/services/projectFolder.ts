import { bindWorkspaceApi, readWorkspaceApi } from './api';
import { holdFolderRequests } from './folderGate';

/**
 * One answer to "which folder is this project allowed to touch".
 *
 * Every screen that reads or writes the folder — Files, Git, checks, preview, the studio windows and
 * the Auto run — asks the server, and the server asks one file (`data/workspace.json`). That part was
 * already single: nothing caches a root per screen or per request. What was not single is the *repair*
 * of that file. A project remembers its own folder (`project.workspaceRoot`) because the project list
 * is what survives reinstalls; the server remembers the connected one because that is what writes go
 * through. When the server comes up without one — a fresh data folder, an update that replaced it, a
 * deleted workspace.json — the project still knows its path, and only two screens knew how to act on
 * that: Files offered a button, the Auto run repaired itself. Git, checks and preview just said "no
 * folder" and stayed that way, so one window disagreed with the next about the project.
 *
 * This module is that repair, in one place, called when the current project is opened. The rule is
 * narrow on purpose:
 *
 *  - the project's own path exists and the server already holds it   → nothing to do;
 *  - the project's own path exists and the server holds nothing       → connect it;
 *  - the project's own path exists and the server holds another one   → connect the project's
 *    (the folder follows the project; otherwise a switched project would show — and write into —
 *    the previous project's code);
 *  - the project never recorded a path                                → leave the connected folder as
 *    it is: the app has one folder, and that is the folder its screens show.
 *
 * A failure (folder moved, deleted, read-only) is reported to the caller, never invented away: the
 * screens keep showing what the server really has, and the one screen that can explain it in the
 * window's language does.
 *
 * Every call also holds the folder gate (`services/folderGate`) until it settles, because a screen
 * that mounts in the same commit as the provider would otherwise ask the server before this repair
 * has begun and be told "no folder" for a project that records one. The reads here go through the
 * ungated `readWorkspaceApi`, so the repair never waits on its own gate.
 */

export interface FolderConnection {
  /** The folder the app works in now, as the server reports it. `null` when there is none. */
  root: string | null;
  /** The folder this call connected, when it connected one. */
  connected?: string;
  /**
   * Why the project's own folder could not be connected. Carries the server's `userMessage`, which is
   * already worded in the window's language; the caller decides whether to show it.
   */
  error?: any;
}

/**
 * Windows paths compare without case, and pickers mix the two separators. The separator is built from
 * its code point so the function reads the same whichever escapers sit between it and the file.
 */
function canonicalFolder(value: string): string {
  const backslash = String.fromCharCode(92);
  return value
    .replaceAll(backslash, '/')
    .split('/')
    .filter(Boolean)
    .join('/')
    .toLowerCase();
}

export function sameFolder(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return canonicalFolder(a) === canonicalFolder(b);
}

/** Binds already in flight, per folder, so two screens opening at once connect the folder once. */
const inFlight = new Map<string, Promise<FolderConnection>>();

async function connect(
  project: { workspaceRoot?: string } | null,
  language: string | undefined,
  bindWhenDifferent: boolean
): Promise<FolderConnection> {
  const wanted = (project?.workspaceRoot || '').trim();

  let serverRoot: string | null = null;
  try {
    const state = await readWorkspaceApi(language);
    serverRoot = state?.root || null;
  } catch {
    // The server could not be asked: the caller's own request is the next honest attempt.
    return { root: wanted || null };
  }

  if (!wanted) return { root: serverRoot };
  if (serverRoot && sameFolder(serverRoot, wanted)) return { root: serverRoot };
  // Another folder is connected and this caller may not take it over: it reports what it found.
  if (serverRoot && !bindWhenDifferent) return { root: serverRoot };

  try {
    const state = await bindWorkspaceApi({ path: wanted, language });
    return { root: state?.root || wanted, connected: state?.root || wanted };
  } catch (error) {
    return { root: serverRoot, error };
  }
}

export function connectProjectFolder(
  project: { workspaceRoot?: string } | null,
  language?: string,
  options: { bindWhenDifferent?: boolean } = {}
): Promise<FolderConnection> {
  const bindWhenDifferent = options.bindWhenDifferent !== false;
  const wanted = (project?.workspaceRoot || '').trim();
  if (!wanted) return connect(project, language, bindWhenDifferent);

  const key = `${language || 'ru'}|${bindWhenDifferent ? 'adopt' : 'keep'}|${canonicalFolder(wanted)}`;
  const running = inFlight.get(key);
  if (running) return running;

  const request = holdFolderRequests(
    connect(project, language, bindWhenDifferent).finally(() => inFlight.delete(key))
  );
  inFlight.set(key, request);
  return request;
}
