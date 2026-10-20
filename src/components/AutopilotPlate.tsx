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
import { connectProjectFolder, sameFolder } from '../services/projectFolder';
import { autopilotFeed } from '../services/autopilotFeed';
import { AiMosaic } from './ui/AiMosaic';
import { IconButton } from './ui/Button';

interface ProjectState {
  name?: string;
  projectType?: string;
  engineOrFramework?: string;
  language?: string;
  /** The folder this project was created with; the loop may only write into it. */
  workspaceRoot?: string;
}

/**
 * The loop writes into whatever folder the server has connected, so it has to be this project's.
 *
 * A server that has been running since before the folder was connected (or one restarted without
 * its data file) answers `no_workspace` while the project still remembers its own path — that is a
 * connection to repair, not a reason to fail the run. A server bound to a *different* folder is the
 * opposite: starting there would write another project's code into this one, so the run is refused
 * with the reason instead of silently switching the folder.
 *
 * A project whose own path was never recorded can still run: the app has one connected folder, and
 * that is the folder this project's Files screen shows. It is only when neither side can name one
 * that the refusal is the honest answer — asked here, in the window's language, instead of letting
 * the start route print its own English sentence.
 *
 * Returns the sentence to show, or `null` when the run may start.
 */
async function ensureProjectFolder(
  project: ProjectState | null,
  language: string | undefined,
  t: any
): Promise<string | null> {
  const wanted = project?.workspaceRoot;
  // One resolver for every screen: it tells which folder the server holds and connects the project's
  // own one when the server lost it. A folder that belongs to another project is never switched from
  // here — writing this project's code into that one is the one thing the refusal exists for.
  const folder = await connectProjectFolder(project, language, { bindWhenDifferent: false });
  if (folder.error) {
    // Gone, read-only, or not a folder: the bind route words the reason in the window's language.
    return folder.error?.userMessage || t.plan.autoCodeNoFolder;
  }
  // Whatever the connect route answers, the folder this run may write into is now the project's.
  if (folder.connected) return null;
  if (wanted && folder.root) {
    return sameFolder(folder.root, wanted) ? null : t.plan.autoCodeWrongFolder;
  }
  return folder.root ? null : t.plan.autoCodeNoFolder;
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
  /** True when the request never reached the loop: checks have not run, so they cannot have failed. */
  const [startFailed, setStartFailed] = useState(false);
  const [attemptCount, setAttemptCount] = useState(0);
  const [maxAttempts, setMaxAttempts] = useState(4);
  const [doneCount, setDoneCount] = useState(0);
  const [totalCount, setTotalCount] = useState(pipeline?.tasks.length || 1);
  /** True when the run finished without a check: written, not confirmed. */
  const [unverified, setUnverified] = useState(false);
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
        if (taskEvent.type === 'run_completed' && (taskEvent.detail as { verdict?: string } | undefined)?.verdict === 'none') {
          setUnverified(true);
        }
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
        /*
         * One connection check before the request: the canvas shows the project's folder, and the
         * server is the side that actually writes. Repairing an empty server here is what makes
         * the card work after the app was restarted, and refusing a foreign folder is what keeps
         * the run out of somebody else's project.
         */
        // The language here is the window's, not the project's stack: it is what the server
        // answers in, exactly as the bind screen sends it.
        const blocked = await ensureProjectFolder(project, language, t);
        if (!alive) return;
        if (blocked) {
          setLines([blocked]);
          setEnded('failed');
          setStartFailed(true);
          autopilotFeed.fail(blocked);
          return;
        }
        if (pipeline) {
          setTotalCount(pipeline.tasks.length);
          const created = await startPipelineApi({
            tasks: pipeline.tasks,
            projectName: project?.name,
            projectType: project?.projectType,
            engineOrFramework: project?.engineOrFramework,
            // The window's language, not the project's stack: the server words its log with it.
            language
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
            if (event.type === 'run_failed' && !event.attempt) {
              // The pipeline never started (no key, no folder): say that, not "checks failed".
              setEnded('failed');
              setStartFailed(true);
              autopilotFeed.finish('failed');
            }
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
          // `project.language` is TypeScript or GDScript; the log needs the reader's language.
          language
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
            setUnverified((event.detail as { verdict?: string } | undefined)?.verdict === 'none');
            autopilotFeed.finish('completed');
          }
          if (event.type === 'run_failed') {
            setEnded('failed');
            // No attempt number means the loop stopped before it ever reached the model (no
            // key, no folder): the checks have not run, so they cannot be what failed.
            setStartFailed(!event.attempt);
            autopilotFeed.finish('failed');
          }
        });
      } catch (err: any) {
        if (!alive) return;
        /*
         * The screen already knows two of the server's refusals, and neither is about the work:
         * another run is in progress, or there is nowhere to write. Printing the transport's own
         * English sentence in a Russian window reads like a crash, and "checks failed" for a run
         * that never started is simply not true.
         */
        const noFolder = err?.details?.reason === 'no_workspace';
        const failure =
          err?.status === 409
            ? t.plan.autoCodeRunInProgress
            : noFolder
              ? t.plan.autoCodeNoFolder
              : err?.status === 400 && !project?.workspaceRoot
                ? t.plan.autoCodeNoFolder
                : err?.userMessage || err?.message || (ru ? 'Запуск не удался.' : 'The run could not start.');
        setLines([failure]);
        setEnded('failed');
        setStartFailed(true);
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
    ended === 'failed'
      ? 'text-rose-300'
      : ended === 'completed'
      ? unverified
        ? 'text-amber-300'
        : 'text-emerald-300'
      : 'text-indigo-300';

  // A run with no checks configured is not a run whose checks passed, and the header says so.
  const completedNotice = unverified ? t.plan.autoCodeUnverifiedNotice : t.plan.autoCodeCompletedNotice;
  const statusLine = startFailed
    ? t.plan.autoCodeStartFailed
    : pipeline
    ? ru
      ? ended === 'running'
        ? `${t.plan.autoCodeRunning} · ${doneCount}/${totalCount} задач`
        : ended === 'completed'
        ? completedNotice
        : t.plan.autoCodeFailedNotice
      : ended === 'running'
      ? `${t.plan.autoCodeRunning} · ${doneCount}/${totalCount} tasks`
      : ended === 'completed'
      ? completedNotice
      : t.plan.autoCodeFailedNotice
    : ended === 'running'
    ? `${t.plan.autoCodeRunning} · ${attemptCount}/${maxAttempts}`
    : ended === 'completed'
    ? completedNotice
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
          {/* While the loop runs, the mark does the telling; a verdict keeps the plain dot, because
              by then there is nothing in motion to show. */}
          {ended === 'running' ? (
            <AiMosaic />
          ) : (
            <span
              className={`w-2 h-2 rounded-full ${
                ended === 'completed' ? (unverified ? 'bg-amber-400' : 'bg-emerald-400') : 'bg-rose-400'
              }`}
            />
          )}
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
