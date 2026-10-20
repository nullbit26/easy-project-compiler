/**
 * The one gate between "the app is starting" and "a screen reads the folder".
 *
 * At start-up two things happen in the same commit: the provider opens the saved project, which may
 * have to reconnect its folder on the server, and the screens mount and ask the server for that
 * folder. React runs a child's effects *before* its parent's, so without a gate the screen that
 * happened to mount first asked before the reconnect had begun, was told there is no folder, and
 * kept that answer — the window disagreed with the project until the next reload.
 *
 * The repair is to put the pending reconnect in the way of the requests that need it: whoever starts
 * a restore registers it here, and a folder request waits for it instead of racing it. When nothing
 * is being restored the gate is open, so nothing that has no restore to wait for is ever delayed.
 *
 * Kept apart from both the API layer and the folder module so neither has to import the other: the
 * module that reconciles the folder registers the work, the transport waits on it.
 */

interface HeldWork {
  id: number;
  work: Promise<unknown>;
}

let sequence = 0;
let pending: HeldWork | null = null;

/**
 * Registers a restore that folder requests must wait for, and returns it unchanged.
 *
 * A restore that fails does not close the gate forever: the waiters give up waiting and make their
 * own request, which is what reports the real state. The gate only ever holds *requests*, never the
 * restore itself — the restore calls the ungated transport, so it cannot wait on its own gate.
 */
export function holdFolderRequests<T>(work: Promise<T>): Promise<T> {
  const id = ++sequence;
  const tracked = work.finally(() => {
    if (pending?.id === id) pending = null;
  });
  pending = { id, work: tracked };
  // A restore nobody is waiting on must not surface as an unhandled rejection; callers that do wait
  // receive the same rejection from `whenFolderReady`, and the folder module reports it itself.
  void tracked.catch(() => {});
  return tracked;
}

/** Waits until no restore is in flight. Resolves at once when there is nothing to wait for. */
export async function whenFolderReady(): Promise<void> {
  while (pending) {
    try {
      await pending.work;
    } catch {
      // The caller's own request is the next honest attempt: it reports what the server really has.
    }
  }
}

/** Test seam: forgets any in-flight restore, so one test's promise cannot gate the next. */
export function resetFolderGate(): void {
  pending = null;
}
