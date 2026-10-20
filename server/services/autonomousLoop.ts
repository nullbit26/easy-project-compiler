import { Type } from '../ai/geminiProvider';
import { callAiJson, getEngineLabel, hasAiProvider } from '../ai/aiProvider';
import { getWorkspaceRoot, WorkspaceError } from '../store/workspaceStore';
import {
  applyFileChanges,
  attachFormatting,
  attachVerification,
  undoFileChanges
} from './workspaceFiles';
import { planTaskContext } from './contextPlan';
import { formatWorkspaceFiles, summarizeFormatting } from './codeFormatter';
import { runVerification, summarizeReport } from './projectChecks';
import { autonomousLog } from './autonomousEvents';

/**
 * The autonomous coding loop.
 *
 * One run takes a task and, between its start and its verdict, no human decides anything:
 *   1. the AI answers with a strict JSON set of file operations,
 *   2. every path passes the same workspace checks a manual write does, and the batch lands with
 *      the same undo backup any manual write gets,
 *   3. the project's formatter runs before the checks, so lint sees the code as the user sees it,
 *   4. the project's native checks run,
 *   5. a failing verdict becomes a bounded repair packet — the task, what was applied, the
 *      failing commands and their output — sent back for the next attempt.
 *
 * The loop ends after AUTONOMOUS_MAX_ATTEMPTS attempts, one way or the other: `completed` (the
 * last batch passed every check) or `failed` (it did not — the disk keeps that batch with its
 * undo link). Every step is appended to the shared event log, which the UI reads over SSE and
 * renders as a live terminal line.
 */

const AUTONOMOUS_MAX_ATTEMPTS = 4;
const MAX_CHANGES = 12;
const FAILING_OUTPUT_CHARS = 4_000;

const proposeSchema = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
    changes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          path: { type: Type.STRING },
          action: { type: Type.STRING },
          content: { type: Type.STRING },
          reason: { type: Type.STRING }
        },
        required: ['path', 'action', 'content']
      }
    }
  },
  required: ['summary', 'changes']
};

export interface AutonomousTaskInput {
  taskTitle: string;
  goal?: string;
  acceptanceCriteria?: string[];
  targetFiles?: string[];
  projectName?: string;
  projectType?: string;
  engineOrFramework?: string;
  language?: string;
  ru: boolean;
}

/** One plan task handed to the pipeline, exactly as the project carries it. */
export interface PipelineTask {
  id: string;
  title: string;
  goal?: string;
  acceptanceCriteria?: string[];
  targetFiles?: string[];
  /** Checked when the pipeline picks the next task: an unfinished dependency holds it back. */
  dependencies?: string[];
}

export interface AutonomousRunResult {
  runId: string;
  status: 'completed' | 'failed';
  attempts: number;
  maxAttempts: number;
  applied: Array<{ path: string; action: string }>;
  backupId: string | null;
  verdict: 'pass' | 'fail' | 'none';
  summary: string;
  engine: string;
  lastError?: string;
}

function stackLabel(task: AutonomousTaskInput): string {
  return [task.projectType, task.engineOrFramework, task.language].filter(Boolean).join(' / ');
}

/**
 * What this task's prompt carries: the files it names, what they import, what imports them, their
 * tests and the neighbours that mention them — in that order, inside one character budget.
 */
function contextFor(task: AutonomousTaskInput) {
  return planTaskContext({ seeds: task.targetFiles || [] });
}

/** The two half-sections that differ between context strategies, kept apart for the eval. */
export interface TaskPromptSections {
  /** Every path in the folder, in the order the prompt lists them. */
  fileIndex: string;
  /** `### FILE:` blocks for the files whose content the model should see. */
  context: string;
}

/**
 * The task's prompt, with the context it is handed.
 *
 * Exported so `tools/eval` can hold both context strategies against the *same* rules, task lines
 * and JSON contract — an eval that re-implements the prompt would compare its own copies.
 */
export function assembleTaskPrompt(
  task: AutonomousTaskInput,
  sections: TaskPromptSections,
  extra?: string
): string {
  const { fileIndex, context } = sections;
  const stack = stackLabel(task);
  const rules = [
    "You are the autonomous code engine. Reply with JSON only: { summary, warnings: [], changes: [{ path, action, content, reason }] }. No prose outside the JSON.",
    'Every "path" is a RELATIVE path inside the project folder, forward slashes. Never absolute, never "..", never a drive letter.',
    '"action" is "create", "update" or "delete"; for "delete" the "content" is an empty string.',
    'For every created or updated file return the COMPLETE byte-for-byte content — never "// rest of the file unchanged" or any other placeholder.',
    `Change as few files as possible (${MAX_CHANGES} at most). Never touch .env files, keys, certificates or build output.`,
    task.ru ? 'Write "summary" and every "reason" in Russian.' : 'Write "summary" and every "reason" in English.'
  ];
  const taskLines = [
    `TASK: ${task.taskTitle}`,
    task.goal ? `GOAL: ${task.goal}` : '',
    (task.acceptanceCriteria || []).length
      ? `ACCEPTANCE CRITERIA:\n${task.acceptanceCriteria!.map((c) => `- ${c}`).join('\n')}`
      : '',
    `PROJECT: ${task.projectName || 'Project'}${stack ? ` (${stack})` : ''}`,
    extra ? `\n${extra}` : ''
  ].filter(Boolean);
  return [
    ...rules,
    '',
    ...taskLines,
    '',
    'FILES IN THE FOLDER (use these exact relative paths; do not invent folders that do not fit):',
    fileIndex || '(the folder is empty — create the files the task needs)',
    context ? `\nCURRENT CONTENT OF THE FILES THAT MATTER:\n${context}` : ''
  ].join('\n');
}

function buildPrompt(task: AutonomousTaskInput): string {
  const plan = contextFor(task);
  return assembleTaskPrompt(task, {
    fileIndex: plan.indexPath.join('\n'),
    context: plan.blocks
  });
}

/** The next attempt's prompt: the task again, plus what just failed and the raw output. */
function buildRepairPrompt(
  task: AutonomousTaskInput,
  diagnosis: string,
  failingOutput: string,
  applied: string[]
): string {
  const context = contextFor(task).blocks;
  return [
    task.ru
      ? 'Предыдущая попытка записала файлы, но проверки проекта не прошли. Ответь полным набором изменений, который проходит эти проверки, в том же JSON-формате.'
      : 'The previous attempt wrote files but the project checks failed. Answer with a complete new set of changes that passes these checks, in the same JSON format.',
    '',
    `TASK: ${task.taskTitle}`,
    task.goal ? `GOAL: ${task.goal}` : '',
    (task.acceptanceCriteria || []).length
      ? `ACCEPTANCE CRITERIA:\n${task.acceptanceCriteria!.map((c) => `- ${c}`).join('\n')}`
      : '',
    '',
    'FILES THE FAILED ATTEMPT WROTE:',
    applied.map((p) => `- ${p}`).join('\n') || '- (none actually written)',
    '',
    `WHAT THE CHECKS SAID:\n${diagnosis}`,
    '',
    `RAW CHECK OUTPUT:\n${failingOutput || '(no detail captured)'}`,
    '',
    /*
     * The first prompt showed the code; the repair prompt used to show only the failure. A model
     * asked to rewrite a file it cannot see answers with nothing — the log showed two attempts
     * ending in «Модель не вернула изменений» for exactly that reason. The failed batch was
     * undone before this prompt was built, so what is read here is the state the model must
     * start from.
     */
    context ? `CURRENT CONTENT OF THE FILES THAT MATTER (the failed batch was undone):\n${context}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

function failingOutputOf(report: any): string {
  const blocks: string[] = [];
  for (const result of report?.results || []) {
    if (result.status !== 'failed') continue;
    blocks.push(`--- ${result.commandLine} (exit ${result.exitCode ?? '?'}) ---\n${result.output || ''}`.trim());
  }
  return blocks.join('\n\n').slice(0, FAILING_OUTPUT_CHARS * 2);
}

function diagnosisOf(report: any): string {
  const lines: string[] = [];
  for (const result of report?.results || []) {
    if (result.status !== 'failed') continue;
    lines.push(`${result.commandLine} exited ${result.exitCode ?? '?'}`);
    for (const problem of (result.problems || []).slice(0, 8)) {
      const where = [problem.file, problem.line].filter(Boolean).join(':');
      lines.push(`  ${where ? `${where}: ` : ''}${problem.raw || problem.message || ''}`.trim());
    }
  }
  return lines.join('\n').slice(0, 4_000);
}

interface AttemptOutcome {
  applied: Array<{ path: string; action: string }>;
  backupId: string | null;
  passed: boolean;
  verdict: 'pass' | 'fail' | 'none';
  summary: string;
  diagnosis: string;
  failingOutput: string;
}

export async function runAutonomousAttempt(
  task: AutonomousTaskInput,
  runId: string,
  attempt: number,
  priorFailure?: { diagnosis: string; applied: string[]; failingOutput: string }
): Promise<AttemptOutcome> {
  const ru = task.ru;
  autonomousLog.push({
    runId,
    seq: 0,
    type: 'attempt_started',
    attempt,
    maxAttempts: AUTONOMOUS_MAX_ATTEMPTS,
    text: ru
      ? `Попытка ${attempt} из ${AUTONOMOUS_MAX_ATTEMPTS}`
      : `Attempt ${attempt} of ${AUTONOMOUS_MAX_ATTEMPTS}`
  });

  const prompt =
    attempt === 1
      ? buildPrompt(task)
      : buildRepairPrompt(
          task,
          priorFailure?.diagnosis || '',
          priorFailure?.failingOutput || '',
          priorFailure?.applied || []
        );

  const parsed = await callAiJson(prompt, proposeSchema);
  const changes = Array.isArray(parsed?.changes) ? parsed.changes : [];

  if (!parsed || changes.length === 0) {
    const reason =
      (Array.isArray(parsed?.warnings) && parsed.warnings.filter(Boolean).join('; ')) ||
      (ru ? 'Модель не вернула изменений.' : 'The model returned no changes.');
    throw new Error(reason);
  }

  autonomousLog.push({
    runId,
    seq: 0,
    type: 'proposal_summary',
    attempt,
    text: String(parsed.summary || '')
  });

  const result = applyFileChanges(
    changes.slice(0, MAX_CHANGES).map((raw: any) => ({
      path: String(raw?.path || ''),
      action: raw?.action === 'update' ? 'update' : raw?.action === 'delete' ? 'delete' : 'create',
      content: String(raw?.content ?? ''),
      reason: String(raw?.reason || '')
    })),
    { label: ru ? 'Автономный цикл' : 'Autonomous loop' }
  );

  const applied = result.results
    .filter((r: any) => r.status !== 'skipped')
    .map((r: any) => ({ path: r.path, action: r.action }));

  autonomousLog.update(runId, { backupId: result.backupId });

  const writtenLines = result.results.map((r: any) =>
    r.status === 'failed' || r.status === 'skipped'
      ? `${ru ? 'не записан' : 'not written'}: ${r.path} — ${r.error || ''}`.trim()
      : `${r.action === 'create' ? (ru ? 'создан' : 'created') : ru ? 'записан' : 'written'}: ${r.path}`
  );
  autonomousLog.push({
    runId,
    seq: 0,
    type: 'files_written',
    attempt,
    text: writtenLines.join('\n'),
    detail: { backupId: result.backupId, applied }
  });

  if (applied.length === 0) {
    throw new Error(ru ? 'Все операции записи были отклонены.' : 'Every file operation was skipped.');
  }

  autonomousLog.push({
    runId,
    seq: 0,
    type: 'formatting',
    attempt,
    text: ru ? 'Запуск форматтера…' : 'Running the formatter…'
  });
  const formatting = await formatWorkspaceFiles(applied.map((a) => a.path));
  const formatSummary = summarizeFormatting(formatting);
  if (result.backupId && formatSummary) attachFormatting(result.backupId, formatSummary);

  autonomousLog.push({
    runId,
    seq: 0,
    type: 'verifying',
    attempt,
    text: ru ? 'Запуск проверок проекта…' : 'Running the project checks…'
  });
  const report = await runVerification({ root: getWorkspaceRoot() || undefined });
  const summary = summarizeReport(report);
  const failed = (report.results || []).filter((r: any) => r.status === 'failed');
  const ranCheck = (report.results || []).length > 0;
  const verdict: 'pass' | 'fail' | 'none' = !ranCheck ? 'none' : failed.length === 0 ? 'pass' : 'fail';

  const verdictLines = (report.results || []).map((r: any) => {
    const label = ru ? r.labelRu || r.labelEn : r.labelEn || r.labelRu;
    return `  ${label}: ${r.status === 'passed' ? (ru ? 'прошло' : 'ok') : r.status}`;
  });
  autonomousLog.push({
    runId,
    seq: 0,
    type: 'verdict',
    attempt,
    text: verdictLines.join('\n') || (ru ? 'Проверки не настроены.' : 'No checks configured.'),
    detail: { verdict }
  });

  attachVerification(result.backupId, summary);

  return {
    applied,
    backupId: result.backupId,
    passed: verdict === 'pass',
    verdict,
    summary: String(parsed.summary || ''),
    diagnosis: diagnosisOf(report),
    failingOutput: failingOutputOf(report)
  };
}

/**
 * Runs one task through the loop. The run id may be handed in by the route — which has already
 * told the client what it is — or generated here when nobody named it.
 */
/**
 * True when the task may start: every task it named as a dependency is already completed.
 * A task whose dependency is missing from the list is held back — the order the plan declares
 * is the order the pipeline runs in, not the order the cards happen to sit in.
 */
function isUnblocked(task: PipelineTask, done: Set<string>): boolean {
  return (task.dependencies || []).every((id) => done.has(id) || !id);
}

/** The next ready task, in plan order: ready first, then backlog, never a blocked one. */
export function pickNextPipelineTask(
  queue: PipelineTask[],
  doneIds: Set<string>
): PipelineTask | null {
  for (const task of queue) {
    if (doneIds.has(task.id)) continue;
    if (!isUnblocked(task, doneIds)) continue;
    return task;
  }
  return null;
}

export async function runAutonomousTask(task: AutonomousTaskInput, runIdInput?: string): Promise<AutonomousRunResult> {
  const root = getWorkspaceRoot();
  if (!root) throw new WorkspaceError('no_workspace', 'No workspace');

  const runId = runIdInput || `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date().toISOString();

  if (!hasAiProvider()) {
    /*
     * The refusal is written under the id the client already opened its stream for. It used to
     * be pushed under `no-run`, so the plate never received it: the run was over while the screen
     * kept saying "the AI is coding", with a counter that never moved.
     */
    autonomousLog.begin({ runId, taskTitle: task.taskTitle, startedAt, maxAttempts: AUTONOMOUS_MAX_ATTEMPTS });
    autonomousLog.push({
      runId,
      seq: 0,
      type: 'run_failed',
      text: task.ru
        ? 'Автономный цикл не запущен: не настроен ни один ключ AI-провайдера.'
        : 'The autonomous loop did not start: no AI provider key is configured.'
    });
    autonomousLog.update(runId, { status: 'failed', attempts: 0 });
    // Not a WorkspaceError: a missing key is a settings problem, and the route turns it into
    // its own translated answer.
    throw new Error('no_ai_key');
  }

  autonomousLog.begin({ runId, taskTitle: task.taskTitle, startedAt, maxAttempts: AUTONOMOUS_MAX_ATTEMPTS });
  autonomousLog.push({
    runId,
    seq: 0,
    type: 'run_started',
    text: task.ru
      ? `Автономный запуск: «${task.taskTitle}», до ${AUTONOMOUS_MAX_ATTEMPTS} попыток`
      : `Autonomous run: "${task.taskTitle}", up to ${AUTONOMOUS_MAX_ATTEMPTS} attempts`,
    maxAttempts: AUTONOMOUS_MAX_ATTEMPTS
  });

  let backupId: string | null = null;
  let applied: Array<{ path: string; action: string }> = [];
  let lastSummary = '';
  let verdict: 'pass' | 'fail' | 'none' = 'none';
  let priorFailure: { diagnosis: string; applied: string[]; failingOutput: string } | undefined;
  let attemptsSpent = 0;

  for (let attempt = 1; attempt <= AUTONOMOUS_MAX_ATTEMPTS; attempt += 1) {
    attemptsSpent = attempt;
    if (attempt > 1 && backupId) {
      // A repair attempt replaces the previous batch: the disk never holds two attempts at once.
      await undoFileChanges(backupId);
      backupId = null;
      applied = [];
      autonomousLog.push({
        runId,
        seq: 0,
        type: 'repairing',
        attempt,
        text: task.ru
          ? 'Предыдущая запись откатывается для новой попытки…'
          : 'Undoing the previous write for the next attempt…'
      });
    }

    let outcome: AttemptOutcome;
    try {
      outcome = await runAutonomousAttempt(task, runId, attempt, priorFailure);
    } catch (err: any) {
      autonomousLog.push({
        runId,
        seq: 0,
        type: 'attempt_failed',
        attempt,
        text: err?.message || String(err)
      });
      // The model refused or its answer could not be written. The remaining attempts are still
      // budget: a bare retry often answers properly, so the loop goes on rather than ending.
      continue;
    }

    backupId = outcome.backupId;
    applied = outcome.applied;
    lastSummary = outcome.summary;
    verdict = outcome.verdict;

    if (verdict === 'none') {
      /*
       * No checks configured is not a failed check: nothing ran, so nothing failed. Retrying
       * asked the same model the same question behind the same missing gate, and each retry
       * rolled the previous batch back — the log said «Проверки не настроены» and then
       * «Проверки не прошли» four times, which is both untrue and useless. The batch stays,
       * the run ends on the first answer, and the words say exactly what was confirmed.
       */
      autonomousLog.push({
        runId,
        seq: 0,
        type: 'run_completed',
        attempt,
        text: task.ru
          ? 'Изменения записаны. В проекте нет проверок — результат не подтверждён, откат доступен в разделе файлов.'
          : 'The files are written. The project has no checks — nothing confirmed the result; the batch can be undone in the files section.',
        detail: { backupId, verdict: 'none' }
      });
      return {
        runId,
        status: 'completed',
        attempts: attempt,
        maxAttempts: AUTONOMOUS_MAX_ATTEMPTS,
        applied,
        backupId,
        verdict,
        summary: lastSummary,
        engine: getEngineLabel()
      };
    }

    if (outcome.passed) {
      autonomousLog.push({
        runId,
        seq: 0,
        type: 'run_completed',
        attempt,
        text: task.ru
          ? `Готово за ${attempt} ${attempt === 1 ? 'попытку' : 'попытки'}: все проверки прошли.`
          : `Completed in ${attempt} attempt(s): every check passed.`,
        detail: { backupId, verdict: 'pass' }
      });
      return {
        runId,
        status: 'completed',
        attempts: attempt,
        maxAttempts: AUTONOMOUS_MAX_ATTEMPTS,
        applied,
        backupId,
        verdict,
        summary: lastSummary,
        engine: getEngineLabel()
      };
    }

    priorFailure = {
      diagnosis: outcome.diagnosis,
      failingOutput: outcome.failingOutput,
      applied: applied.map((a) => a.path)
    };
    autonomousLog.push({
      runId,
      seq: 0,
      type: 'attempt_failed',
      attempt,
      text: task.ru ? 'Проверки не прошли.' : 'Checks failed.',
      detail: { diagnosis: outcome.diagnosis }
    });
  }

  autonomousLog.push({
    runId,
    seq: 0,
    type: 'run_failed',
    attempt: attemptsSpent,
    text: task.ru
      ? `Автономный цикл остановился: проверки не прошли за ${attemptsSpent} ${attemptsSpent === 1 ? 'попытку' : 'попытки'}. Последняя запись оставлена на диске, её можно откатить.`
      : `The autonomous loop stopped: the checks failed ${attemptsSpent} attempt(s) in. The last write stays on disk and can be undone.`,
    detail: { backupId }
  });
  autonomousLog.update(runId, { status: 'failed', attempts: attemptsSpent, backupId, verdict });

  return {
    runId,
    status: 'failed',
    attempts: attemptsSpent,
    maxAttempts: AUTONOMOUS_MAX_ATTEMPTS,
    applied,
    backupId,
    verdict,
    summary: lastSummary,
    engine: getEngineLabel()
  };
}

export { AUTONOMOUS_MAX_ATTEMPTS };

/* ------------------------------------------------------------------ *
 * The pipeline: a queue of plan tasks run back to back.
 *
 * Each task that ends `completed` hands its turn to the next unblocked one; a task that
 * exhausted its attempts is reported and left on the queue — the pipeline stops there, because
 * the tasks behind it usually depend on the one that failed.
 * ------------------------------------------------------------------ */

export interface PipelineEventDetail {
  taskId: string;
  taskTitle: string;
  result: 'completed' | 'failed';
  /** How many tasks of the queue are done, and how many were handed over in total. */
  done: number;
  total: number;
}

export interface PipelineRunResult {
  runId: string;
  /** One entry per task that was actually started; the queue may have been partially skipped. */
  tasks: Array<PipelineEventDetail & { attempts: number; verdict: 'pass' | 'fail' | 'none' }>; 
  stoppedBecause: 'queue_empty' | 'task_failed' | 'no_workspace' | 'no_ai_key';
}

/**
 * Runs the given plan tasks back to back. `onTaskDone` is called as soon as one task reaches its
 * verdict — the client marks the plan card completed from exactly this call, not from a guess.
 */
export async function runPipeline(
  queue: PipelineTask[],
  options: {
    projectName?: string;
    projectType?: string;
    engineOrFramework?: string;
    language?: string;
    ru: boolean;
    onTaskDone?: (detail: PipelineEventDetail) => void;
  },
  runIdInput?: string
): Promise<PipelineRunResult> {
  const ru = options.ru;
  const total = queue.length;
  const runId = runIdInput || `pipe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  autonomousLog.begin({ runId, taskTitle: ru ? 'Конвейер задач' : 'Task pipeline', startedAt: new Date().toISOString(), maxAttempts: AUTONOMOUS_MAX_ATTEMPTS });
  autonomousLog.push({
    runId,
    seq: 0,
    type: 'run_started',
    text: ru ? `Конвейер: ${total} задач(и) в очереди` : `Pipeline: ${total} task(s) queued`,
    maxAttempts: AUTONOMOUS_MAX_ATTEMPTS
  });

  const done = new Set<string>();
  const results: PipelineRunResult['tasks'] = [];
  let stoppedBecause: PipelineRunResult['stoppedBecause'] = 'queue_empty';

  if (!hasAiProvider()) {
    autonomousLog.push({
      runId,
      seq: 0,
      type: 'run_failed',
      text: ru
        ? 'Конвейер не запущен: не настроен ключ AI-провайдера.'
        : 'The pipeline did not start: no AI provider key is configured.'
    });
    return { runId, tasks: results, stoppedBecause: 'no_ai_key' };
  }
  if (!getWorkspaceRoot()) {
    autonomousLog.push({
      runId,
      seq: 0,
      type: 'run_failed',
      text: ru
        ? 'Конвейер не запущен: папка проекта не подключена.'
        : 'The pipeline did not start: no project folder is connected.'
    });
    return { runId, tasks: results, stoppedBecause: 'no_workspace' };
  }

  while (true) {
    const next = pickNextPipelineTask(queue, done);
    if (!next) {
      autonomousLog.push({
        runId,
        seq: 0,
        type: 'run_completed',
        text:
          done.size === 0
            ? ru
              ? 'Конвейер остановился: нет незаблокированных задач.'
              : 'The pipeline stopped: no unblocked task to pick.'
            : ru
            ? `Конвейер завершён: ${done.size} из ${total} задач сделано.`
            : `Pipeline finished: ${done.size} of ${total} task(s) done.`,
        detail: { done: done.size, total }
      });
      break;
    }

    autonomousLog.push({
      runId,
      seq: 0,
      type: 'attempt_started',
      text: ru
        ? `Следующая задача: «${next.title}»${total ? ` (${done.size + 1}/${total})` : ''}`
        : `Next task: "${next.title}"${total ? ` (${done.size + 1}/${total})` : ''}`,
      detail: { taskId: next.id }
    });

    const taskInput: AutonomousTaskInput = {
      taskTitle: next.title,
      goal: next.goal,
      acceptanceCriteria: next.acceptanceCriteria,
      targetFiles: next.targetFiles,
      projectName: options.projectName,
      projectType: options.projectType,
      engineOrFramework: options.engineOrFramework,
      language: options.language,
      ru
    };

    let result: AutonomousRunResult;
    try {
      // The pipeline mints its own run ids so every task of the queue has its own stream page.
      const taskRunId = `${runId}-${next.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      result = await runAutonomousTask(taskInput, taskRunId);
    } catch (err: any) {
      const message = String(err?.message || err);
      autonomousLog.push({
        runId,
        seq: 0,
        type: 'attempt_failed',
        text: ru ? `Задача «${next.title}» не выполнена: ${message}` : `Task "${next.title}" did not run: ${message}`
      });
      results.push({ taskId: next.id, taskTitle: next.title, result: 'failed', done: done.size, total, attempts: 0, verdict: 'none' });
      stoppedBecause = message.includes('no_ai_key') ? 'no_ai_key' : 'task_failed';
      break;
    }

    const detail: PipelineEventDetail = {
      taskId: next.id,
      taskTitle: next.title,
      result: result.status,
      done: result.status === 'completed' ? done.size + 1 : done.size,
      total
    };
    results.push({ ...detail, attempts: result.attempts, verdict: result.verdict });
    options.onTaskDone?.(detail);

    if (result.status === 'completed') {
      done.add(next.id);
      autonomousLog.push({
        runId,
        seq: 0,
        type: 'verdict',
        text: ru ? `Задача «${next.title}» закрыта. Осталось ${total - done.size}.` : `Task "${next.title}" closed. ${total - done.size} left.`,
        detail: { done: done.size, total }
      });
      // The pipeline keeps going: the next attempt may start without the user in between.
      continue;
    }

    // The task failed its checks after every attempt. The plan behind it usually depends on it,
    // so the pipeline stops here and reports, rather than building on top of a failing batch.
    stoppedBecause = 'task_failed';
    autonomousLog.push({
      runId,
      seq: 0,
      type: 'run_failed',
      text: ru
        ? `Конвейер остановился на «${next.title}»: проверки не прошли. Остальные ${total - done.size - 1 >= 0 ? total - done.size - 1 : 0} задач в очереди не тронуты.`
        : `The pipeline stopped at "${next.title}": the checks failed. The remaining ${Math.max(0, total - done.size - 1)} task(s) were not touched.`,
      detail: { backupId: result.backupId }
    });
    break;
  }

  return { runId, tasks: results, stoppedBecause };
}

/** Latest pipeline result registry, so the client can re-read what happened. */
const pipelineResults = new Map<string, PipelineRunResult>();

export function getPipelineResult(runId: string): PipelineRunResult | null {
  return pipelineResults.get(runId) || null;
}

function rememberPipelineResult(result: PipelineRunResult): void {
  pipelineResults.set(result.runId, result);
  if (pipelineResults.size > 20) {
    const oldest = pipelineResults.keys().next().value;
    if (oldest) pipelineResults.delete(oldest);
  }
}

export async function startPipeline(
  queue: PipelineTask[],
  options: {
    projectName?: string;
    projectType?: string;
    engineOrFramework?: string;
    language?: string;
    ru: boolean;
    onTaskDone?: (detail: PipelineEventDetail) => void;
    /** Minted by the route so the client opens SSE under the exact same id from the start. */
    runId?: string;
  }
): Promise<PipelineRunResult> {
  const result = await runPipeline(queue, options, options.runId);
  rememberPipelineResult(result);
  return result;
}
