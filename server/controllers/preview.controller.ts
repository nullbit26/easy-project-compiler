import { Request, Response } from 'express';
import { buildPreview, buildPreviewPlan, listPreviewCandidates } from '../services/previewBuilder';
import { servePreviewPlan, previewServerInfo } from '../services/previewServer';
import { WorkspaceError, getWorkspaceRoot } from '../store/workspaceStore';
import { sendError, sendSuccess } from '../utils/apiResponse';

/**
 * The preview endpoints. They only read the connected folder — through the same workspace store
 * the file screens use — and answer with a document the sandbox iframe can run.
 */

function isRu(req: Request): boolean {
  const language = req.body?.language ?? req.query?.language;
  return !language || language === 'ru';
}

const ERROR_STATUS: Record<string, number> = {
  no_workspace: 400,
  empty_path: 422,
  not_found: 404,
  outside_root: 403,
  sensitive_file: 403,
  too_large: 413
};

const RU_MESSAGES: Record<string, string> = {
  no_workspace: 'Папка проекта ещё не подключена — запускать нечего. Подключите папку на экране «Файлы проекта».',
  not_found: 'Файл, с которого нужно запустить проект, не найден.',
  outside_root: 'Этот путь вне подключённой папки проекта.',
  sensitive_file: 'Файлы, похожие на секреты, в предпросмотр не попадают.',
  too_large: 'Файл слишком большой для запуска в песочнице.'
};

const EN_MESSAGES: Record<string, string> = {
  no_workspace: 'No project folder is connected, so there is nothing to run. Connect one on the Project Files screen.',
  not_found: 'The file this project should start from was not found.',
  outside_root: 'That path is outside the connected project folder.',
  sensitive_file: 'Files that look like secrets never go into the preview.',
  too_large: 'The file is too large to run in the sandbox.'
};

function handle(fn: (req: Request, res: Response) => Promise<any> | any) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      const code: string | undefined = err instanceof WorkspaceError ? err.code : undefined;
      const status = code ? ERROR_STATUS[code] || 400 : 500;
      const table = isRu(req) ? RU_MESSAGES : EN_MESSAGES;
      const userMessage = code
        ? table[code] || err.message
        : err?.message || (isRu(req) ? 'Не удалось собрать предпросмотр.' : 'The preview could not be built.');
      console.error(`[Preview] ${req.method} ${req.path} failed: ${code || err?.message || err}`);
      sendError(res, status, code || 'preview_failed', userMessage, { reason: code });
    }
  };
}

/** What the screen can start from, without building anything yet. */
export const getPreviewStatus = handle((_req: Request, res: Response) => {
  const root = getWorkspaceRoot();
  return sendSuccess(res, {
    root,
    candidates: listPreviewCandidates(root),
    server: previewServerInfo()
  });
});

/**
 * Builds the chosen entry and serves it from the preview origin.
 *
 * The URL is what the screen embeds: a real address means the project's own stylesheets, scripts,
 * workers, WebAssembly and media are requested by the browser itself, so animations and graphics run
 * exactly as they do outside the app. The inline document is still produced when the origin cannot
 * be started, so the screen always has something to show.
 */
export const postPreviewBuild = handle(async (req: Request, res: Response) => {
  const entry = typeof req.body?.entry === 'string' ? req.body.entry : undefined;
  const plan = await buildPreviewPlan(entry);

  if (plan.ok) {
    try {
      const served = await servePreviewPlan(plan, { rebuild: (nextEntry) => buildPreviewPlan(nextEntry) });
      return sendSuccess(res, {
        ok: true,
        kind: plan.kind,
        entry: plan.entry,
        html: null,
        diagnostics: plan.diagnostics,
        warnings: plan.warnings,
        candidates: plan.candidates,
        durationMs: plan.durationMs,
        root: plan.root,
        // What the served bundle is made of — the half of "how heavy" that names a cause.
        composition: plan.composition,
        url: served.url,
        origin: served.origin,
        port: served.port,
        isolation: served.isolation,
        liveReload: served.liveReload,
        mode: 'origin'
      });
    } catch (error: any) {
      console.error(`[Preview] origin unavailable, falling back to an inline document: ${error?.message || error}`);
    }
  }

  // Fallback: the document built in memory, run through `srcDoc` as before.
  const result = await buildPreview(entry);
  return sendSuccess(res, { ...result, url: null, mode: 'inline' });
});
