import { Router, Request, Response } from 'express';
import { requireLocal } from '../utils/localRequest';
import { sendSuccess, sendError } from '../utils/apiResponse';
import { autonomousLog, AutonomousEvent } from '../services/autonomousEvents';
import {
  AUTONOMOUS_MAX_ATTEMPTS,
  runAutonomousTask,
  startPipeline,
  getPipelineResult,
  PipelineTask,
  AutonomousTaskInput
} from '../services/autonomousLoop';
import { getWorkspaceRoot } from '../store/workspaceStore';

const router = Router();

router.use((req, res, next) => {
  const allowed = requireLocal(
    req,
    res,
    'The autonomous loop can only be driven from the machine that runs the app (localhost).'
  );
  if (!allowed) return;
  next();
});

/**
 * One autonomous run at a time, per server: a second write starts only after the previous
 * loop has reached its verdict, whatever it was. The route registry holds the run id while
 * the service emits it, so the status endpoint can answer while the loop is running.
 */
let activeRunId: string | null = null;

/**
 * "No folder" is a state of the app, not a failed run, and both routes answer it before any work
 * starts. The sentence follows the window that asked: the client sends `language`, and a Russian
 * interface must not receive the loop's English fallback.
 */
function noWorkspace(req: Request, res: Response) {
  const ru = !(req.body?.language && req.body.language !== 'ru');
  return sendError(
    res,
    400,
    'no_workspace',
    ru ? 'Папка проекта не подключена.' : 'No project folder is connected.',
    { reason: 'no_workspace' }
  );
}

function taskFromRequest(req: Request): AutonomousTaskInput {
  const body = req.body || {};
  return {
    taskTitle: String(body.taskTitle || '').trim(),
    goal: body.goal ? String(body.goal) : undefined,
    acceptanceCriteria: Array.isArray(body.acceptanceCriteria)
      ? body.acceptanceCriteria.filter((c: unknown) => typeof c === 'string').slice(0, 12)
      : undefined,
    targetFiles: Array.isArray(body.targetFiles)
      ? body.targetFiles.filter((f: unknown) => typeof f === 'string').slice(0, 8)
      : undefined,
    projectName: body.projectName ? String(body.projectName) : undefined,
    projectType: body.projectType ? String(body.projectType) : undefined,
    engineOrFramework: body.engineOrFramework ? String(body.engineOrFramework) : undefined,
    language: body.language ? String(body.language) : undefined,
    ru: !(body.language && body.language !== 'ru')
  };
}

function startHandler(req: Request, res: Response) {
  const task = taskFromRequest(req);
  if (!task.taskTitle) {
    return sendError(res, 422, 'empty_task', 'The task has no title — nothing to run.');
  }
  if (!getWorkspaceRoot()) return noWorkspace(req, res);
  if (activeRunId) {
    return sendError(res, 409, 'run_in_progress', 'One autonomous run is already in progress.');
  }

  // The run id is minted here so the client can open the SSE stream immediately, before the
  // model answers — the service logs under exactly this id from its first event on.
  const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  activeRunId = runId;
  void runAutonomousTask(task, runId)
    .catch((err: any) => {
      console.error('[Autonomous] run failed:', err?.message || err);
      return null;
    })
    .finally(() => {
      if (activeRunId === runId) activeRunId = null;
    });

  return sendSuccess(res, { started: true, runId, maxAttempts: AUTONOMOUS_MAX_ATTEMPTS });
}

/**
 * The pipeline endpoint: the whole ready part of the plan arrives as the queue, and the server
 * runs it back to back — each task right after the previous verdict, no human in between.
 * The response returns immediately; progress goes over the same SSE stream.
 */
function pipelineHandler(req: Request, res: Response) {
  if (!getWorkspaceRoot()) return noWorkspace(req, res);
  if (activeRunId) {
    return sendError(res, 409, 'run_in_progress', 'One autonomous run is already in progress.');
  }
  const body = req.body || {};
  const queue: PipelineTask[] = (Array.isArray(body.tasks) ? body.tasks : [])
    .filter((raw: any) => raw && typeof raw === 'object' && String(raw.title || '').trim())
    .slice(0, 30)
    .map((raw: any) => ({
      id: String(raw.id || ''),
      title: String(raw.title || '').trim(),
      goal: raw.goal ? String(raw.goal) : undefined,
      acceptanceCriteria: Array.isArray(raw.acceptanceCriteria)
        ? raw.acceptanceCriteria.filter((c: any) => typeof c === 'string').slice(0, 12)
        : undefined,
      targetFiles: Array.isArray(raw.targetFiles)
        ? raw.targetFiles.filter((f: any) => typeof f === 'string').slice(0, 8)
        : undefined,
      dependencies: Array.isArray(raw.dependencies)
        ? raw.dependencies.filter((d: any) => typeof d === 'string').slice(0, 12)
        : undefined
    }));
  if (queue.length === 0) {
    return sendError(res, 422, 'empty_queue', 'The pipeline queue is empty — give it at least one task.');
  }

  activeRunId = 'pipeline-starting';
  // The run id is minted here, exactly as /start does: the client opens its SSE under the same
  // id the pipeline logs under, from its very first event.
  const pipelineRunId = `pipe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  void startPipeline(queue, {
    projectName: body.projectName ? String(body.projectName) : undefined,
    projectType: body.projectType ? String(body.projectType) : undefined,
    engineOrFramework: body.engineOrFramework ? String(body.engineOrFramework) : undefined,
    ru: !(body.language && body.language !== 'ru'),
    runId: pipelineRunId
  })
    .then((result) => {
      console.log(`[Autonomous] pipeline ${result.runId}: ${result.stoppedBecause}, ${result.tasks.length} task(s) reported`);
    })
    .catch((err: any) => {
      console.error('[Autonomous] pipeline failed:', err?.message || err);
    })
    .finally(() => {
      if (activeRunId === pipelineRunId) activeRunId = null;
    });

  return sendSuccess(res, { started: true, runId: pipelineRunId, queued: queue.length });
}

/** The recorded result of a pipeline run, when the client wants to re-read it. */
function pipelineResultHandler(req: Request, res: Response) {
  const result = getPipelineResult(String(req.params.runId || ''));
  if (!result) {
    return sendError(res, 404, 'not_found', 'No pipeline run recorded under this id (yet).');
  }
  return sendSuccess(res, result);
}

/** SSE: replays what already happened for this run, then follows until it ends. */
function streamHandler(req: Request, res: Response) {
  const runId = String(req.query.runId || '');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });
  res.write('retry: 2000\n\n');

  const writeEvent = (event: AutonomousEvent) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  for (const event of autonomousLog.replay(runId)) writeEvent(event);

  const descriptor = autonomousLog.descriptor(runId);
  if (descriptor && descriptor.status === 'completed') {
    res.write('event: stream_end\ndata: {}\n\n');
    res.end();
    return;
  }

  const unsubscribe = autonomousLog.subscribe((event) => {
    if (event.runId !== runId) return;
    writeEvent(event);
    if (event.type === 'run_completed' || event.type === 'run_failed') {
      unsubscribe();
      res.write('event: stream_end\ndata: {}\n\n');
      res.end();
    }
  });

  req.on('close', unsubscribe);
}

function statusHandler(_req: Request, res: Response) {
  return sendSuccess(res, {
    active: Boolean(activeRunId),
    maxAttempts: AUTONOMOUS_MAX_ATTEMPTS,
    runId: activeRunId
  });
}

router.post('/start', startHandler);
router.post('/pipeline', pipelineHandler);
router.get('/pipeline/:runId', pipelineResultHandler);
router.get('/stream', streamHandler);
router.get('/status', statusHandler);

export default router;
