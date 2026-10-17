import { useSyncExternalStore } from 'react';

/**
 * Live status of the AI calls the app is waiting on.
 *
 * A single answer from the configured providers takes 30-60 seconds, and while it runs nothing
 * on screen changes — which reads as "the app froze". Every call in `services/api.ts` reports
 * itself here, so one small indicator can show the truth everywhere instead of every screen
 * keeping its own loading flag (and forgetting to clear it).
 */

export type AiTaskKind =
  | 'idea'
  | 'questions'
  | 'project'
  | 'map'
  | 'plan'
  | 'compile'
  | 'review'
  | 'diagnose'
  | 'edit';

export type AiOutcome = 'success' | 'error';

export interface AiActivitySnapshot {
  /** True while at least one AI request is in flight. */
  active: boolean;
  /** What the first in-flight request is doing; drives the indicator label. */
  kind: AiTaskKind | null;
  startedAt: number | null;
  /** When the last request settled — the indicator flashes a short confirmation for it. */
  finishedAt: number | null;
  /** How it settled. A failed call must not be reported as a finished job. */
  outcome: AiOutcome | null;
  activeCount: number;
}

const IDLE: AiActivitySnapshot = {
  active: false,
  kind: null,
  startedAt: null,
  finishedAt: null,
  outcome: null,
  activeCount: 0
};

let snapshot: AiActivitySnapshot = IDLE;
const listeners = new Set<() => void>();

function publish(next: AiActivitySnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function subscribeAiActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAiActivity(): AiActivitySnapshot {
  return snapshot;
}

/**
 * Wraps one AI call so the UI can show that work is happening. The call itself is untouched:
 * results and errors pass through to the caller exactly as before.
 */
export async function trackAiRequest<T>(kind: AiTaskKind, run: () => Promise<T>): Promise<T> {
  const isFirstRequest = snapshot.activeCount === 0;
  publish({
    activeCount: snapshot.activeCount + 1,
    active: true,
    kind: isFirstRequest ? kind : snapshot.kind,
    startedAt: isFirstRequest ? Date.now() : snapshot.startedAt,
    finishedAt: null,
    outcome: null
  });

  try {
    const result = await run();
    settle('success');
    return result;
  } catch (error) {
    // The request still has to clear the status, but it must not look like a success.
    settle('error');
    throw error;
  }
}

function settle(outcome: AiOutcome): void {
  const remaining = snapshot.activeCount - 1;
  publish(
    remaining > 0
      ? { ...snapshot, activeCount: remaining }
      : { active: false, kind: null, startedAt: null, finishedAt: Date.now(), outcome, activeCount: 0 }
  );
}

/** Subscribes a component to the current status without polling. */
export function useAiActivity(): AiActivitySnapshot {
  return useSyncExternalStore(subscribeAiActivity, getAiActivity, getAiActivity);
}

/** Test helper: returns the store to its idle state. */
export function resetAiActivityForTests(): void {
  publish(IDLE);
}
