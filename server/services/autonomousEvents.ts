/**
 * The live log of the autonomous loop.
 *
 * Each run appends typed events (model answered, files written, checks ran, verdict) and any
 * number of SSE responses subscribe to the stream — so a page that reconnects mid-run replays
 * what already happened and then follows the tail, and the log stays readable after the run.
 */

export type AutonomousEventType =
  | 'run_started'
  | 'attempt_started'
  | 'proposal_summary'
  | 'files_written'
  | 'formatting'
  | 'verifying'
  | 'verdict'
  | 'repairing'
  | 'attempt_failed'
  | 'run_completed'
  | 'run_failed';

export interface AutonomousEvent {
  runId: string;
  seq: number;
  type: AutonomousEventType;
  at: string;
  attempt?: number;
  maxAttempts?: number;
  /** Human-readable line for the log; the client renders it as one terminal line. */
  text: string;
  detail?: Record<string, unknown>;
}

export interface AutonomousRunDescriptor {
  runId: string;
  taskTitle: string;
  startedAt: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  attempts: number;
  maxAttempts: number;
  backupId: string | null;
  verdict: 'pass' | 'fail' | 'none';
  lastError?: string;
}

export class AutonomousEventLog {
  private listeners = new Set<(event: AutonomousEvent) => void>();
  private history: AutonomousEvent[] = [];
  private runs = new Map<string, AutonomousRunDescriptor>();
  private seqCounter = 0;

  begin(run: { runId: string; taskTitle: string; startedAt: string; maxAttempts: number }): void {
    this.runs.set(run.runId, {
      runId: run.runId,
      taskTitle: run.taskTitle,
      startedAt: run.startedAt,
      status: 'running',
      attempts: 0,
      maxAttempts: run.maxAttempts,
      backupId: null,
      verdict: 'none'
    });
  }

  nextSeq(): number {
    this.seqCounter += 1;
    return this.seqCounter;
  }

  push(event: Omit<AutonomousEvent, 'at'>): AutonomousEvent {
    const full: AutonomousEvent = { ...event, seq: event.seq || this.nextSeq(), at: new Date().toISOString() };
    this.history.push(full);

    for (const listener of this.listeners) {
      try {
        listener(full);
      } catch {
        /* a broken SSE writer must not take the loop down */
      }
    }

    if (event.type === 'run_completed' || event.type === 'run_failed') {
      const run = this.runs.get(event.runId);
      if (run) {
        run.status = event.type === 'run_completed' ? 'completed' : 'failed';
        run.attempts = event.attempt ?? run.attempts;
        if (event.detail) {
          if (typeof event.detail.backupId === 'string') run.backupId = event.detail.backupId;
          if (typeof event.detail.verdict === 'string') run.verdict = event.detail.verdict as AutonomousRunDescriptor['verdict'];
          if (typeof event.detail.error === 'string') run.lastError = event.detail.error;
        }
      }
    }
    return full;
  }

  update(runId: string, patch: Partial<AutonomousRunDescriptor>): void {
    const run = this.runs.get(runId);
    if (run) Object.assign(run, patch);
  }

  markInterrupted(runId: string): void {
    const run = this.runs.get(runId);
    if (run && run.status === 'running') run.status = 'interrupted';
  }

  descriptor(runId: string): AutonomousRunDescriptor | null {
    return this.runs.get(runId) || null;
  }

  /** Events of one run, oldest first — the replay a reconnecting SSE reader asks for. */
  replay(runId: string): AutonomousEvent[] {
    return this.history.filter((event) => event.runId === runId);
  }

  subscribe(listener: (event: AutonomousEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** One global log: the server runs one autonomous task at a time, and the UI watches that run. */
export const autonomousLog = new AutonomousEventLog();
