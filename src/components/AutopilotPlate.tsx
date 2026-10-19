import React, { useEffect, useRef, useState } from 'react';
import { Terminal, X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import {
  AutonomousEvent,
  startAutonomousRunApi,
  startPipelineApi,
  streamAutonomousRun,
  type PipelineTaskInput
} from '../services/api';
import { autopilotFeed } from '../services/autopilotFeed';
import { IconButton } from './ui/Button';

interface ProjectState {
  name?: string;
  projectType?: string;
  engineOrFramework?: string;
  language?: string;
}

interface AutopilotPlateProps {
  /** The task the plate was opened for. In pipeline mode it names where the run started. */
  task: { id: string; title: string; goal?: string; relevantFiles?: string[] };
  project: ProjectState | null;
  onClose: () => void;
  /** Present when this plate runs the whole queue of the plan instead of one task. */
  pipeline?: {
    tasks: PipelineTaskInput[];
    /** Called exactly when the server reached a verdict for each task. */
    onTaskDone?: (done: { taskId: string; result: 'completed' | 'failed' }) => void;
  };
  /**
   * Run without a plate of its own, because another window already shows the log.
   *
   * The studio's terminal pane reads the shared feed, so a floating box over the split would be
   * the same lines twice, covering the board it is talking about. In this mode the component only
   * starts the run and publishes it.
   */
  docked?: boolean;
}

/**
 * The terminal plate of the autonomous loop: it opens the moment the card menu hands the task
 * over, streams every step the server takes — proposal, writes, formatter, checks, verdict —
 * and stays open until the run ends, whatever the verdict was.
 *
 * In pipeline mode the plate watches the *pipeline log*: the queue of plan tasks is run back to
 * back on the server, and the client marks each plan card completed from the server's verdict,
 * not from a guess. A failed task stops the queue — the tasks behind it usually depend on it.
 */
export const AutopilotPlate: React.FC<AutopilotPlateProps> = ({ task, project, onClose, pipeline, docked }) => {
  const { language, t } = useLanguage();
  const ru = language !== 'en';
  const [lines, setLines] = useState<string[]>([]);
  const [ended, setEnded] = useState<'running' | 'completed' | 'failed'>('running');
  const [attemptCount, setAttemptCount] = useState(0);
  const [maxAttempts, setMaxAttempts] = useState(4);
  const [doneCount, setDoneCount] = useState(0);
  const [totalCount, setTotalCount] = useState(pipeline?.tasks.length || 1);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const verdictRef = useRef(pipeline?.onTaskDone);

  useEffect(() => {
    let alive = true;
    let stream: { close: () => void } | null = null;
    /** Per-task run ids the pipeline logs under; each opens its own SSE page on the same terms. */
    const openedStreams = new Set<string>();

    /** The pipeline announces its task runs; each gets a live stream of its own. */
    const watchTaskRun = (event: AutonomousEvent) => {
      if (!alive || openedStreams.has(event.runId)) return;
      openedStreams.add(event.runId);
      // The task's real id rides in the event detail — the run id only mangles it for the URL.
      const detailTaskId = (event.detail as { taskId?: string } | undefined)?.taskId || '';
      const taskIdOf = (runId: string): string => {
        const suffix = runId.startsWith('pipe') ? runId.split('-').slice(2).join('-') : '';
        return detailTaskId || suffix;
      };
      streamAutonomousRun(event.runId, (taskEvent) => {
        if (!alive) return;
        if (taskEvent.attempt) setAttemptCount(taskEvent.attempt);
        const taskLine = lineFor(taskEvent, ru, t);
        setLines((prev) => [...prev, taskLine]);
        autopilotFeed.push(taskEvent, taskLine);
        if (
          taskEvent.type === 'run_completed' ||
          taskEvent.type === 'run_failed'
        ) {
          setDoneCount((count) => {
            const next = count + 1;
            autopilotFeed.markDone(next, pipeline?.tasks.length || 1);
            return next;
          });
          verdictRef.current?.({
            taskId: taskIdOf(taskEvent.runId),
            result: taskEvent.type === 'run_completed' ? 'completed' : 'failed'
          });
        }
      });
    };

    const start = async () => {
      try {
        /*
         * The log outlives this plate: the studio's terminal window reads it, and it is opened
         * from a different window than the one the run was started in. The plate clears it here,
         * once per run, so the terminal always shows the run it is watching rather than a pile of
         * every earlier one.
         */
        autopilotFeed.begin({ title: task.title, total: pipeline?.tasks.length || 1 });
        if (pipeline) {
          setTotalCount(pipeline.tasks.length);
          const created = await startPipelineApi({
            tasks: pipeline.tasks,
            projectName: project?.name,
            projectType: project?.projectType,
            engineOrFramework: project?.engineOrFramework,
            language: undefined
          });
          if (!alive) return;
          setDoneCount(0);
          autopilotFeed.markDone(0, pipeline.tasks.length);
          const startedLine = ru
            ? `Конвейер запущен: ${created.queued} задач(и) в очереди, каждая берётся после вердикта предыдущей.`
            : `Pipeline started: ${created.queued} task(s) queued, each taken after the previous verdict.`;
          setLines((prev) => [...prev, startedLine]);
          autopilotFeed.push(
            {
              runId: (created as { runId?: string }).runId || 'pipeline',
              seq: -1,
              type: 'run_started',
              at: new Date().toISOString(),
              text: startedLine
            },
            startedLine
          );
          // Every attempt/task event that arrives through the stream of this very pipeline
          // opens a live view of that task's own run — and reports its verdict when it ends.
          // The plate streams the pipeline id the server minted; each task's verdict then
          // arrives through the task's own run id, which the pipeline event announces.
          stream = streamAutonomousRun((created as { runId?: string }).runId || 'pipe-unknown', (event: AutonomousEvent) => {
            if (!alive) return;
            const translated = lineFor(event, ru, t);
            setLines((prev) => [...prev, translated]);
            autopilotFeed.push(event, translated);
            if (
              event.type === 'attempt_started' &&
              event.runId !== ((event.detail as unknown as { runId?: string })?.runId || event.runId)
            ) {
              // The task runs log under their own id; watching each as it is announced.
              watchTaskRun(event);
            }
          });
          return;
        }

        const created = await startAutonomousRunApi({
          taskTitle: task.title,
          goal: task.goal,
          targetFiles: task.relevantFiles,
          projectName: project?.name,
          projectType: project?.projectType,
          engineOrFramework: project?.engineOrFramework,
          language: project?.language
        });
        if (!alive) return;
        setMaxAttempts(created.maxAttempts);
        autopilotFeed.configure({ maxAttempts: created.maxAttempts, total: 1 });
        stream = streamAutonomousRun(created.runId, (event: AutonomousEvent) => {
          if (!alive) return;
          if (event.attempt) setAttemptCount(event.attempt);
          const translated = lineFor(event, ru, t);
          setLines((prev) => [...prev, translated]);
          autopilotFeed.push(event, translated);
          if (event.type === 'run_completed') {
            setEnded('completed');
            autopilotFeed.finish('completed');
          }
          if (event.type === 'run_failed') {
            setEnded('failed');
            autopilotFeed.finish('failed');
          }
        });
      } catch (err: any) {
        if (!alive) return;
        const failure = err?.userMessage || err?.message || (ru ? 'Запуск не удался.' : 'The run could not start.');
        setLines([failure]);
        setEnded('failed');
        autopilotFeed.fail(failure);
      }
    };

    void start();
    return () => {
      alive = false;
      stream?.close();
    };
    // One queue per plate: the effect never re-runs mid-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, pipeline?.tasks.map((t) => t.id).join('|')]);

  useEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [lines]);

  const statusColor =
    ended === 'completed' ? 'text-emerald-300' : ended === 'failed' ? 'text-rose-300' : 'text-indigo-300';

  const statusLine = pipeline
    ? ru
      ? ended === 'running'
        ? `${t.plan.autoCodeRunning} · ${doneCount}/${totalCount} задач`
        : ended === 'completed'
        ? t.plan.autoCodeCompletedNotice
        : t.plan.autoCodeFailedNotice
      : ended === 'running'
      ? `${t.plan.autoCodeRunning} · ${doneCount}/${totalCount} tasks`
      : ended === 'completed'
      ? t.plan.autoCodeCompletedNotice
      : t.plan.autoCodeFailedNotice
    : ended === 'running'
    ? `${t.plan.autoCodeRunning} · ${attemptCount}/${maxAttempts}`
    : ended === 'completed'
    ? t.plan.autoCodeCompletedNotice
    : t.plan.autoCodeFailedNotice;

  if (docked) return null;

  return (
    <div
      data-testid="autopilot-plate"
      data-autopilot-state={ended}
      className="fixed bottom-4 right-4 z-40 w-[26rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-700 bg-slate-900/98 backdrop-blur shadow-2xl shadow-black/60 overflow-hidden"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <span className={`text-[11px] font-bold flex items-center gap-2 ${statusColor}`}>
          <span
            className={`w-2 h-2 rounded-full ${
              ended === 'running' ? 'bg-indigo-400 animate-pulse' : ended === 'completed' ? 'bg-emerald-400' : 'bg-rose-400'
            }`}
          />
          {statusLine}
        </span>
        <IconButton label={t.common.cancel} icon={X} size="xs" onClick={onClose} />
      </div>

      <div
        ref={boxRef}
        data-testid="autopilot-log"
        className="h-56 overflow-y-auto px-3 py-2 space-y-1 font-mono text-[11px] leading-relaxed text-slate-300 bg-slate-950/60"
      >
        {lines.map((line, i) => (
          <p key={i} className="whitespace-pre-wrap break-words">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
};

/** One server event → one terminal line, in the reader's language. */
function lineFor(event: AutonomousEvent, ru: boolean, t: any): string {
  switch (event.type) {
    case 'run_started':
      return event.text;
    case 'attempt_started':
      return event.text;
    case 'proposal_summary':
      return event.text;
    case 'files_written':
      return event.text;
    case 'formatting':
    case 'verifying':
      return event.text;
    case 'verdict':
      return `${ru ? 'Проверки' : 'Checks'}:${event.text.startsWith('  ') ? '' : ' '}${event.text}`;
    case 'repairing':
      return event.text;
    case 'attempt_failed':
      return `✗ ${event.text}`;
    case 'run_completed':
    case 'run_failed':
      return event.text;
    default:
      return event.text;
  }
}
