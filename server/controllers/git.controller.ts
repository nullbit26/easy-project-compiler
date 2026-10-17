import { Request, Response } from 'express';
import { WorkspaceError, getWorkspaceRoot } from '../store/workspaceStore';
import {
  GitError,
  commitGitChanges,
  createGitBranch,
  getGitBranchDiff,
  getGitBranches,
  getGitDiff,
  getGitStatus
} from '../services/gitService';
import { sendError, sendSuccess } from '../utils/apiResponse';

/**
 * The Git half of the file routes: what changed in the connected folder, one file's diff, and
 * a commit of exactly the files the user ticked.
 *
 * Nothing here talks to a remote: the app never pushes, fetches or pulls, so a commit stays a
 * local save. Every handler is wrapped by `handle`, so a missing Git or a folder that is not a
 * repository turns into one clear sentence instead of a stack trace.
 */

function isRu(req: Request): boolean {
  const language = req.body?.language ?? req.query?.language;
  return !language || language === 'ru';
}

const RU_MESSAGES: Record<string, string> = {
  git_missing:
    'Git не установлен на этом компьютере. Установите Git (git-scm.com) и перезапустите приложение — тогда сохранение версий станет доступно.',
  not_a_repo:
    'Эта папка пока не под Git. Чтобы включить сохранение версий, откройте папку в терминале и выполните: git init',
  status_failed: 'Git не смог прочитать состояние папки. Возможно, репозиторий повреждён.',
  no_workspace: 'Папка проекта ещё не подключена. Укажите путь к папке с вашим проектом.',
  nothing_selected: 'Ничего не выбрано: отметьте хотя бы один файл и напишите описание.',
  unknown_path:
    'Среди выбранных файлов есть те, которых нет в списке изменений Git. Нажмите «Обновить» и выберите файлы заново.',
  no_changes: 'В выбранных файлах нет изменений — коммитить нечего.',
  identity_missing:
    'Git ещё не знает ваше имя и почту, поэтому он отказывается делать коммит. Выполните в терминале один раз: git config --global user.name "Ваше имя" и git config --global user.email "ваша@почта"',
  commit_failed: 'Git не смог создать коммит. Подробность ниже.',
  invalid_branch:
    'Такое имя ветки Git не примет. Используйте буквы, цифры, дефис и слеши — например «ai/новая-кнопка».',
  branch_exists: 'Ветка с таким именем уже есть в этом проекте.',
  unknown_branch: 'Такой ветки в этом проекте нет.',
  branch_failed: 'Git не смог создать ветку. Подробность ниже.',
  outside_root: 'Этот путь находится вне подключённой папки проекта — приложение его не трогает.',
  sensitive_file: 'Файлы, похожие на секреты (.env, ключи, сертификаты), защищены и не читаются.',
  not_found: 'Такой папки или файла не существует.',
  empty_path: 'Не указан путь к файлу.'
};

const EN_MESSAGES: Record<string, string> = {
  git_missing:
    'Git is not installed on this computer. Install Git (git-scm.com) and restart the app to save versions.',
  not_a_repo:
    'This folder is not under Git yet. To start saving versions, open the folder in a terminal and run: git init',
  status_failed: 'Git could not read the state of this folder. The repository may be damaged.',
  no_workspace: 'No project folder is connected yet. Point the app at your project folder first.',
  nothing_selected: 'Nothing is selected: tick at least one file and write a description.',
  unknown_path:
    'Some selected files are not in Git’s list of changes. Press “Refresh” and select them again.',
  no_changes: 'The selected files have no changes, so there is nothing to commit.',
  identity_missing:
    'Git does not know your name and email yet, so it refuses to commit. Run this once in a terminal: git config --global user.name "Your Name" and git config --global user.email "you@example.com"',
  commit_failed: 'Git could not create the commit. Details below.',
  invalid_branch:
    'Git will not accept that branch name. Use letters, digits, dashes and slashes — for example "ai/new-button".',
  branch_exists: 'A branch with that name already exists in this project.',
  unknown_branch: 'There is no such branch in this project.',
  branch_failed: 'Git could not create the branch. Details below.',
  outside_root: 'That path is outside the connected project folder, so the app refuses to touch it.',
  sensitive_file: 'Files that look like secrets (.env, keys, certificates) are protected and never read.',
  not_found: 'That folder or file does not exist.',
  empty_path: 'The file path is missing.'
};

function userMessageFor(code: string | undefined, err: any, req: Request): string {
  const table = isRu(req) ? RU_MESSAGES : EN_MESSAGES;
  if (code && table[code]) return table[code];
  return err?.message || (isRu(req) ? 'Операция с Git не удалась.' : 'The Git operation failed.');
}

/** A Git failure is a normal answer (no repository, nothing selected), not a server crash. */
const ERROR_STATUS: Record<string, number> = {
  git_missing: 400,
  not_a_repo: 400,
  nothing_selected: 422,
  unknown_path: 409,
  no_changes: 409,
  identity_missing: 400,
  commit_failed: 500,
  status_failed: 500,
  invalid_branch: 422,
  branch_exists: 409,
  unknown_branch: 404,
  branch_failed: 500
};

/**
 * A folder problem keeps its own meaning here: "no folder is connected" is a 400 with its own
 * message, exactly as it is on the file routes — not a 500 about Git.
 */
const WORKSPACE_STATUS: Record<string, number> = {
  no_workspace: 400,
  empty_path: 422,
  not_found: 404,
  not_a_directory: 422,
  not_writable: 422,
  outside_root: 403,
  sensitive_file: 403,
  too_large: 413
};

function handle(fn: (req: Request, res: Response) => Promise<any> | any) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      const code: string | undefined =
        err instanceof GitError
          ? err.code
          : err instanceof WorkspaceError
          ? err.code
          : undefined;
      const status = code ? ERROR_STATUS[code] || WORKSPACE_STATUS[code] || 400 : 500;
      console.error(`[Git] ${req.method} ${req.path} failed: ${code || err?.message || err}`);
      return sendError(res, status, code || 'git_failed', userMessageFor(code, err, req), {
        reason: code,
        detail: err instanceof GitError ? err.detail : undefined
      });
    }
  };
}

/** Which repository the folder is in, and what changed inside it. */
export const getGitStatusHandler = handle((req: Request, res: Response) => {
  const root = getWorkspaceRoot();
  if (!root) throw new WorkspaceError('no_workspace', 'No workspace');
  return sendSuccess(res, getGitStatus(root));
});

/** One file's diff, for the panel's preview. */
export const getGitDiffHandler = handle((req: Request, res: Response) => {
  const root = getWorkspaceRoot();
  if (!root) throw new WorkspaceError('no_workspace', 'No workspace');
  return sendSuccess(res, getGitDiff(root, req.query?.file ?? req.body?.file));
});

/** Saves the selected files as one local commit. Nothing is sent anywhere. */
export const commitGitHandler = handle((req: Request, res: Response) => {
  const root = getWorkspaceRoot();
  if (!root) throw new WorkspaceError('no_workspace', 'No workspace');
  return sendSuccess(res, commitGitChanges(root, { files: req.body?.files, message: req.body?.message }));
});

/** The branches of this repository, and which one is checked out. Read-only. */
export const getGitBranchesHandler = handle((_req: Request, res: Response) => {
  const root = getWorkspaceRoot();
  if (!root) throw new WorkspaceError('no_workspace', 'No workspace');
  return sendSuccess(res, getGitBranches(root));
});

/**
 * Starts a branch for the work that is about to happen. The only branch command the app has:
 * it creates one and nothing else — no switch, no merge, no delete.
 */
export const createGitBranchHandler = handle((req: Request, res: Response) => {
  const root = getWorkspaceRoot();
  if (!root) throw new WorkspaceError('no_workspace', 'No workspace');
  const created = createGitBranch(root, { name: req.body?.name });
  return sendSuccess(res, { ...created, branches: getGitBranches(root), status: getGitStatus(root) });
});

/** What the current branch has that another one does not. Nothing is checked out. */
export const getGitBranchDiffHandler = handle((req: Request, res: Response) => {
  const root = getWorkspaceRoot();
  if (!root) throw new WorkspaceError('no_workspace', 'No workspace');
  return sendSuccess(res, getGitBranchDiff(root, req.query?.base ?? req.body?.base));
});
