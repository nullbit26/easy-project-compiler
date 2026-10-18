import { useSyncExternalStore } from 'react';

/**
 * Whether a run of the loop is under way, and what it is doing right now.
 *
 * A session is several fetches long — the code is written, the folder's own checks run, then the
 * reviewer answers — and until this existed the only sign of it was a spinner inside one card. Four
 * attempts into a task, a reader who scrolled away from that card had no way to tell whether the
 * app was working on their task or sitting idle, and the sidebar entry they arrived through looked
 * exactly the same in both states.
 *
 * The state lives outside React on purpose: the indicator belongs to the sidebar, the buttons
 * belong to the step-by-step screen, and neither is the parent of the other. Same shape as
 * `aiActivity.ts` — a snapshot, a set of listeners, and `useSyncExternalStore`.
 */

/**
 * The stages narrow enough to be worth naming.
 *
 * The project's own checks are not one of them: a command that runs on this machine reports itself,
 * with a spinner per command and a result per command (see `ProjectCheckStrip`), while these two
 * are the waits that have nothing to show but a sentence.
 */
export type SessionPhase = 'writing' | 'reviewing';

export interface SessionProgressSnapshot {
  /** True from the moment the answer is handed over until the verdict is on screen. */
  active: boolean;
  /** The task this run belongs to, so a screen can tell its own run from another one's. */
  taskId: string | null;
  taskTitle: string;
  /** Which attempt of the task is being judged. Never converted back to "step". */
  attempt: number;
  phase: SessionPhase | null;
  startedAt: number | null;
}

const IDLE: SessionProgressSnapshot = {
  active: false,
  taskId: null,
  taskTitle: '',
  attempt: 0,
  phase: null,
  startedAt: null
};

let snapshot: SessionProgressSnapshot = IDLE;
const listeners = new Set<() => void>();

function publish(next: SessionProgressSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function subscribeSessionProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSessionProgress(): SessionProgressSnapshot {
  return snapshot;
}

/** Opens a run. Called when the user hands an answer over, not when a card starts spinning. */
export function startSessionProgress(input: {
  taskId?: string | null;
  taskTitle?: string;
  attempt: number;
  phase: SessionPhase;
}): void {
  publish({
    active: true,
    taskId: input.taskId ?? null,
    taskTitle: input.taskTitle || '',
    attempt: input.attempt,
    phase: input.phase,
    startedAt: Date.now()
  });
}

/** Moves the run to its next stage; ignored when no run is open. */
export function setSessionPhase(phase: SessionPhase): void {
  if (!snapshot.active || snapshot.phase === phase) return;
  publish({ ...snapshot, phase });
}

/** Closes the run. The attempt number stays readable for the "finished" flash, hence `active` false. */
export function finishSessionProgress(): void {
  if (snapshot === IDLE) return;
  publish({ ...IDLE, attempt: snapshot.attempt });
}

export function useSessionProgress(): SessionProgressSnapshot {
  return useSyncExternalStore(subscribeSessionProgress, getSessionProgress, getSessionProgress);
}

/** Test helper: returns the store to idle without leaving a stale attempt behind. */
export function resetSessionProgressForTests(): void {
  publish(IDLE);
}
