import { useSyncExternalStore } from 'react';

/**
 * The log of the AI request the helper screen is waiting on.
 *
 * A status card that only counts seconds says nothing about what was asked, where it was sent or
 * how it ended — and while a model takes 30–60 seconds to answer, that is exactly what the reader
 * wants to know. The screen that starts the request opens a terminal instead, and the request
 * writes its own lifecycle here: what task and agent were sent, the endpoint and payload size, the
 * answer that came back, or the failure. Lines are real events, never a staged progress bar.
 *
 * Same shape as `aiActivity.ts` and `sessionProgress.ts`: a snapshot, a set of listeners and
 * `useSyncExternalStore`, because the panel that renders the log is not the parent of the code
 * that starts the request.
 */

export type RunKind = 'compile' | 'review';
export type RunTone = 'info' | 'step' | 'success' | 'error' | 'muted';
/** How a run ended. `cancelled` is not a failure: nothing went wrong, the reader stopped it. */
export type RunOutcome = 'success' | 'error' | 'cancelled';

export interface RunLogLine {
  id: number;
  /** When the line was written, so the terminal can print a clock beside it. */
  at: number;
  tone: RunTone;
  /**
   * The fact's name, when the line is a fact rather than an event — `Задача`, `Агент`, `Запрос`.
   * The terminal prints these in one column, so the request reads as a small table instead of a
   * sequence of sentences that happen to start with a word and a colon.
   */
  label?: string;
  /** `start` lines are the request's own facts, written before it was sent; the rest are events. */
  origin: 'start' | 'event';
  text: string;
}

export interface RunStreamSnapshot {
  /** True while the request is in flight; the terminal stays on screen only for this and failures. */
  active: boolean;
  kind: RunKind | null;
  title: string;
  lines: RunLogLine[];
  /**
   * The model's own text, as far as it has been written. Empty for a request that does not stream
   * (the answer arrives whole) and for a local answer, which has no model to quote.
   */
  trace: string;
  startedAt: number | null;
  outcome: RunOutcome | null;
}

const IDLE: RunStreamSnapshot = {
  active: false,
  kind: null,
  title: '',
  lines: [],
  trace: '',
  startedAt: null,
  outcome: null
};

let snapshot: RunStreamSnapshot = IDLE;
let nextLineId = 1;
const listeners = new Set<() => void>();

/**
 * Tokens arrive in bursts of a few dozen a second. Publishing each one would re-render the whole
 * screen for every fragment, so the tail is collected here and handed over at human speed. The
 * buffer is flushed at the end of the run too — the last words of the answer must not be lost to a
 * pending timer.
 */
const TRACE_FLUSH_MS = 100;
let pendingTrace = '';
let traceTimer: ReturnType<typeof setTimeout> | null = null;

function publish(next: RunStreamSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function line(
  tone: RunTone,
  text: string,
  options: { label?: string; origin?: 'start' | 'event' } = {}
): RunLogLine {
  return { id: nextLineId++, at: Date.now(), tone, label: options.label, origin: options.origin || 'event', text };
}

export function subscribeRunStream(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRunStream(): RunStreamSnapshot {
  return snapshot;
}

/** Opens a run. The first lines are the request's own facts, written before it is sent. */
export function beginRun(input: {
  kind: RunKind;
  title: string;
  lines: Array<{ tone?: RunTone; label?: string; text: string }>;
}): void {
  nextLineId = 1;
  resetTraceBuffer();
  publish({
    active: true,
    kind: input.kind,
    title: input.title,
    lines: input.lines.map((entry) =>
      line(entry.tone || 'info', entry.text, { label: entry.label, origin: 'start' })
    ),
    trace: '',
    startedAt: Date.now(),
    outcome: null
  });
}

/** Adds one line to the open run. Ignored when nothing is running. */
export function pushRunLine(tone: RunTone, text: string, options: { label?: string } = {}): void {
  if (!snapshot.active) return;
  publish({ ...snapshot, lines: [...snapshot.lines, line(tone, text, { label: options.label, origin: 'event' })] });
}

/** Appends a piece of the model's answer to the live trace. */
export function pushRunDelta(text: string): void {
  if (!snapshot.active || !text) return;
  pendingTrace += text;
  if (traceTimer) return;
  traceTimer = setTimeout(() => {
    traceTimer = null;
    flushTrace();
  }, TRACE_FLUSH_MS);
}

/**
 * Drops the text shown so far without ending the run: the next provider or model is a new answer,
 * and half of the previous one beside it would read as if it were part of this one.
 */
export function resetRunTrace(): void {
  resetTraceBuffer();
  if (!snapshot.trace) return;
  publish({ ...snapshot, trace: '' });
}

function flushTrace(): void {
  if (!pendingTrace) return;
  const next = pendingTrace;
  pendingTrace = '';
  if (!snapshot.active) return;
  publish({ ...snapshot, trace: snapshot.trace + next });
}

function resetTraceBuffer(): void {
  pendingTrace = '';
  if (traceTimer) {
    clearTimeout(traceTimer);
    traceTimer = null;
  }
}

/** Closes the run with the line that says how it ended. */
export function finishRun(outcome: RunOutcome, text: string): void {
  // The words that arrived after the last publish belong to the answer too.
  if (traceTimer) {
    clearTimeout(traceTimer);
    traceTimer = null;
  }
  const trace = snapshot.trace + pendingTrace;
  pendingTrace = '';
  publish({
    ...snapshot,
    active: false,
    trace,
    outcome,
    lines: [
      ...snapshot.lines,
      line(outcome === 'success' ? 'success' : outcome === 'error' ? 'error' : 'muted', text, {
        origin: 'event'
      })
    ]
  });
}

/** Forgets the last run — called when the screen leaves the step that showed it. */
export function clearRun(): void {
  resetTraceBuffer();
  if (snapshot === IDLE) return;
  publish(IDLE);
}

export function useRunStream(): RunStreamSnapshot {
  return useSyncExternalStore(subscribeRunStream, getRunStream, getRunStream);
}

/** Test helper: returns the store to idle without leaving a stale log behind. */
export function resetRunStreamForTests(): void {
  resetTraceBuffer();
  publish(IDLE);
}
