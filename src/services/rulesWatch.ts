/**
 * A written batch of changes, announced once.
 *
 * Changes reach the folder from four different screens — the workspace, the review screen, the
 * guided flow and the Project Map's own write of the rules — and they all go through
 * `applyFileChangesApi`. That one call is therefore the only place the app can learn that a batch
 * really landed, which is why the announcement is made there and not in each screen: a check wired
 * into one caller would silently stop running in the next screen that grows a write of its own.
 *
 * Undo announces itself too. It writes files back, so the folder the rules describe has changed
 * again and the same question ("do the rules still hold?") is due a fresh answer.
 */
export type WorkspaceBatchKind = 'apply' | 'undo';

export interface WorkspaceBatch {
  kind: WorkspaceBatchKind;
  /** How many files the batch really wrote. A batch that wrote nothing changed nothing. */
  applied: number;
  /** The paths the folder reports for it, in the order the server returned them. */
  paths: string[];
}

type Listener = (batch: WorkspaceBatch) => void;

const listeners = new Set<Listener>();

/** Subscribes to written batches. Returns the unsubscribe function. */
export function onWorkspaceBatchWritten(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyWorkspaceBatchWritten(batch: WorkspaceBatch): void {
  for (const listener of [...listeners]) {
    try {
      listener(batch);
    } catch {
      // A listener is a reaction to a finished write; it must never be able to fail the write.
    }
  }
}

/** Keeps one test's listeners out of the next test's run. */
export function resetRulesWatchForTests(): void {
  listeners.clear();
}
