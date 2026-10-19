import { useSyncExternalStore } from 'react';
import type { AutonomousEvent } from './api';

/**
 * The autopilot's log, kept outside the window that started it.
 *
 * The run is started from a card or from the pipeline button, and its terminal used to exist only
 * as a floating plate over that screen: the moment the plate was closed, everything the robot had
 * said was gone. The studio's terminal window is a different window from the one that starts the
 * run, so the events are published here instead — one small store that any window can read.
 *
 * The stream replays a run when a watcher reconnects, and the pipeline opens a stream per task, so
 * an event can arrive twice: lines are deduplicated by run and sequence number.
 */

export type AutopilotTone = 'info' | 'success' | 'error' | 'warn' | 'muted';

export interface AutopilotLine {
  id: number;
  runId: string;
  seq: number;
  text: string;
  type: string;
  tone: AutopilotTone;
  attempt?: number;
  at: string;
}

export type AutopilotStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface AutopilotFeedState {
  lines: AutopilotLine[];
  status: AutopilotStatus;
  /** The task or queue the run is about. */
  title: string;
  attempt: number;
  maxAttempts: number;
  done: number;
  total: number;
  startedAt: string | null;
}

const MAX_LINES = 800;

const IDLE: AutopilotFeedState = {
  lines: [],
  status: 'idle',
  title: '',
  attempt: 0,
  maxAttempts: 4,
  done: 0,
  total: 0,
  startedAt: null
};

let state: AutopilotFeedState = IDLE;
const listeners = new Set<() => void>();
const seen = new Set<string>();
let nextId = 1;

function emit() {
  for (const listener of listeners) listener();
}

function toneOf(type: string, text: string): AutopilotTone {
  if (type === 'run_failed' || type === 'attempt_failed') return 'error';
  if (type === 'run_completed' || type === 'files_written') return 'success';
  if (type === 'repairing') return 'warn';
  if (type === 'formatting' || type === 'verifying') return 'muted';
  if (type === 'verdict' && /fail|error|✗|ошиб/i.test(text)) return 'warn';
  return 'info';
}

export const autopilotFeed = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  snapshot(): AutopilotFeedState {
    return state;
  },

  /** A run begins: the log starts over, because a terminal shows the run in front of it. */
  begin(patch: { title: string; total?: number; maxAttempts?: number }): void {
    seen.clear();
    state = {
      ...IDLE,
      status: 'running',
      title: patch.title,
      total: patch.total ?? 0,
      maxAttempts: patch.maxAttempts ?? 4,
      startedAt: new Date().toISOString()
    };
    emit();
  },

  /** One translated server event. `text` is the line exactly as the plate shows it. */
  push(event: AutonomousEvent, text: string): void {
    const key = `${event.runId}:${event.seq}`;
    if (seen.has(key)) return;
    seen.add(key);

    const lines = [
      ...state.lines,
      {
        id: nextId++,
        runId: event.runId,
        seq: event.seq,
        text,
        type: event.type,
        tone: toneOf(event.type, text),
        attempt: event.attempt,
        at: event.at || new Date().toISOString()
      }
    ].slice(-MAX_LINES);

    state = {
      ...state,
      lines,
      status:
        event.type === 'run_completed'
          ? 'completed'
          : event.type === 'run_failed'
          ? 'failed'
          : 'running',
      attempt: event.attempt ?? state.attempt,
      maxAttempts: event.maxAttempts ?? state.maxAttempts
    };
    emit();
  },

  /** A failure that never became a server event: the run could not even be started. */
  fail(text: string): void {
    state = {
      ...state,
      lines: [
        ...state.lines,
        {
          id: nextId++,
          runId: 'local',
          seq: 0,
          text,
          type: 'run_failed',
          tone: 'error' as AutopilotTone,
          at: new Date().toISOString()
        }
      ].slice(-MAX_LINES),
      status: 'failed'
    };
    emit();
  },

  /** Facts the server sends after the run has started (how many attempts, how many tasks). */
  configure(patch: { maxAttempts?: number; total?: number }): void {
    state = { ...state, ...patch };
    emit();
  },

  /** The pipeline's own bookkeeping: one queued task reached a verdict. */
  markDone(done: number, total: number): void {
    state = { ...state, done, total };
    emit();
  },

  finish(status: 'completed' | 'failed'): void {
    state = { ...state, status };
    emit();
  },

  clear(): void {
    seen.clear();
    state = IDLE;
    emit();
  }
};

/** The live log, for any window that wants to show it. */
export function useAutopilotFeed(): AutopilotFeedState {
  return useSyncExternalStore(autopilotFeed.subscribe, autopilotFeed.snapshot, autopilotFeed.snapshot);
}
