import { Request, Response } from 'express';
import { hasAiProvider } from '../ai/aiProvider';
import {
  WorkspaceError,
  bindWorkspace,
  getWorkspaceRoot,
  unbindWorkspace
} from '../store/workspaceStore';
import {
  attachFormatting,
  attachVerification,
  attachWeight,
  applyFileChanges,
  browseFolders,
  createCheckpoint,
  deleteCheckpoint,
  listBackups,
  listCheckpoints,
  readWorkspaceTextFile,
  rollbackToCheckpoint,
  scanWorkspace,
  undoFileChanges,
  writeWorkspaceTextFile
} from '../services/workspaceFiles';
import { detectChecks, runVerification, summarizeReport, VerificationReport } from '../services/projectChecks';
import { proposeFileChanges } from '../services/changeProposals';
import { formatWorkspaceFiles, summarizeFormatting } from '../services/codeFormatter';
import {
  BuildBudgetVerdict,
  evaluateBuildBudget,
  lastBuildBudgetVerdict,
  measureBuildWeight,
  measureWriteWeight
} from '../services/changeWeight';
import { BudgetError, parseBudgetBytes, readWeightBudget, writeWeightBudget } from '../store/weightBudget';
import { pickFolder } from '../services/folderPicker';
import { sendError, sendSuccess } from '../utils/apiResponse';

/**
 * The only place in the app that touches the user's real files.
 *
 * Every handler is wrapped by `handle` so a path-escape or a read-only folder turns into a
 * clear, translated message instead of a stack trace, and every mutating handler goes through
 * the workspace store's path checks.
 */

function isRu(req: Request): boolean {
  const language = req.body?.language ?? req.query?.language;
  return !language || language === 'ru';
}

const ERROR_STATUS: Record<string, number> = {
  no_workspace: 400,
  empty_path: 422,
  not_found: 404,
  not_a_directory: 422,
  not_writable: 422,
  outside_root: 403,
  sensitive_file: 403,
  too_large: 413,
  no_changes: 400,
  unknown_backup: 404,
  nothing_to_fix: 400,
  no_checks: 400,
  invalid_budget: 422
};

const RU_MESSAGES: Record<string, string> = {
  no_workspace: 'Папка проекта ещё не подключена. Укажите путь к папке с вашим проектом.',
  empty_path: 'Не указан путь к файлу.',
  not_found: 'Такой папки или файла не существует.',
  not_a_directory: 'По этому пути не папка.',
  not_writable: 'Папка недоступна для записи.',
  outside_root: 'Этот путь находится вне подключённой папки проекта — приложение его не трогает.',
  sensitive_file: 'Файлы, похожие на секреты (.env, ключи, сертификаты), защищены и не читаются.',
  too_large: 'Файл слишком большой для этой операции.',
  no_changes: 'Нет изменений для применения.',
  unknown_backup: 'Копия для отмены не найдена.',
  nothing_to_fix: 'Проверок с ошибками нет — исправлять нечего.',
  no_checks: 'В этой папке не нашлось проверок, которые можно запустить.',
  invalid_budget: 'Бюджет веса надо написать как размер: например «500 KB» или «1.5 MB». Оставьте поле пустым, чтобы убрать бюджет.'
};

const EN_MESSAGES: Record<string, string> = {
  no_workspace: 'No project folder is connected yet. Point the app at your project folder first.',
  empty_path: 'The file path is missing.',
  not_found: 'That folder or file does not exist.',
  not_a_directory: 'That path is not a folder.',
  not_writable: 'The folder is not writable.',
  outside_root: 'That path is outside the connected project folder, so the app refuses to touch it.',
  sensitive_file: 'Files that look like secrets (.env, keys, certificates) are protected and never read.',
  too_large: 'The file is too large for this operation.',
  no_changes: 'There are no changes to apply.',
  unknown_backup: 'The undo copy could not be found.',
  nothing_to_fix: 'No check is reporting a problem, so there is nothing to fix.',
  no_checks: 'No runnable checks were found in this folder.',
  invalid_budget: 'Write the weight budget as a size, for example "500 KB" or "1.5 MB". Leave the field empty to remove the budget.'
};

function userMessageFor(err: any, req: Request): string {
  if (err instanceof WorkspaceError || err instanceof BudgetError) {
    const table = isRu(req) ? RU_MESSAGES : EN_MESSAGES;
    return table[err.code] || err.message;
  }
  return err?.message || (isRu(req) ? 'Не удалось выполнить операцию с файлами.' : 'The file operation failed.');
}

function handle(fn: (req: Request, res: Response) => Promise<any> | any) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      const code: string | undefined =
        err instanceof WorkspaceError || err instanceof BudgetError ? err.code : undefined;
      const status = code ? ERROR_STATUS[code] || 400 : 500;
      console.error(`[Files] ${req.method} ${req.path} failed: ${code || err?.message || err}`);
      sendError(res, status, code || 'file_operation_failed', userMessageFor(err, req), { reason: code });
    }
  };
}

/** Everything the screen needs to redraw the folder, the timeline and the checkpoints. */
function workspacePayload() {
  return {
    ...scanWorkspace(),
    backups: listBackups(5),
    timeline: listBackups(25),
    checkpoints: listCheckpoints()
  };
}

/** Connection state + a fresh scan, so the screen can restore itself after a reload. */
export const getWorkspace = handle((_req: Request, res: Response) => {
  const root = getWorkspaceRoot();
  if (!root) {
    return sendSuccess(res, {
      root: null,
      files: [],
      backups: [],
      timeline: [],
      checkpoints: [],
      truncated: false
    });
  }
  return sendSuccess(res, workspacePayload());
});

export const bindFolder = handle((req: Request, res: Response) => {
  const bound = bindWorkspace(req.body?.path);
  return sendSuccess(res, { ...workspacePayload(), boundFrom: bound.root });
});

export const unbindFolder = handle((_req: Request, res: Response) => {
  unbindWorkspace();
  return sendSuccess(res, { root: null, files: [], backups: [], timeline: [], checkpoints: [] });
});

export const browseFolder = handle((req: Request, res: Response) => {
  return sendSuccess(res, browseFolders(req.query?.dir));
});

/**
 * Opens the operating system's own folder picker and waits for the answer. The request stays
 * open while the user browses, so the UI shows a "the dialog is on your screen" hint.
 */
export const pickFolderDialog = handle(async (req: Request, res: Response) => {
  const ru = isRu(req);
  const result = await pickFolder({ initialPath: req.body?.initialPath, title: req.body?.title });

  if (!result.supported) {
    return sendSuccess(res, { supported: false, path: null });
  }
  if (result.error === 'timeout') {
    return sendError(
      res,
      504,
      'picker_timeout',
      ru
        ? 'Окно выбора папки оставалось открытым слишком долго и было закрыто. Попробуйте ещё раз.'
        : 'The folder dialog stayed open for too long and was closed. Please try again.',
      { reason: 'picker_timeout' }
    );
  }
  if (result.error) {
    return sendError(
      res,
      502,
      'picker_failed',
      ru
        ? `Не удалось открыть системное окно выбора папки (${result.error}). Вставьте путь в поле вручную.`
        : `The system folder dialog could not be opened (${result.error}). Paste the path into the field instead.`,
      { reason: 'picker_failed' }
    );
  }
  return sendSuccess(res, { supported: true, path: result.path, cancelled: Boolean(result.cancelled) });
});

export const scanFolder = handle((_req: Request, res: Response) => {
  return sendSuccess(res, workspacePayload());
});

export const readFile = handle((req: Request, res: Response) => {
  return sendSuccess(res, readWorkspaceTextFile(req.query?.path));
});

export const writeFile = handle((req: Request, res: Response) => {
  const result = writeWorkspaceTextFile(req.body?.path, req.body?.content);
  return sendSuccess(res, result);
});

/**
 * Writes the accepted changes, then tidies the written files with the project's own formatter.
 *
 * The order matters: the checks that run next see formatted code, and the tidy-up is recorded on
 * the same changeset, so the timeline shows what was written and what was tidied in one row.
 * `format: false` turns it off for one call; a folder without a local formatter simply reports
 * that it has nothing to tidy with.
 */
export const applyChanges = handle(async (req: Request, res: Response) => {
  const result = applyFileChanges(req.body?.changes, { label: req.body?.label });

  const written = result.results
    .filter((entry) => entry.status === 'created' || entry.status === 'updated')
    .map((entry) => entry.path);

  const formatting =
    req.body?.format === false ? null : await formatWorkspaceFiles(written);
  const summary = formatting ? summarizeFormatting(formatting) : null;

  // How heavy this batch was. The "before" sizes come from the same write that produced the undo
  // copies, so the number describes this change and not "something about the folder".
  const weight = await measureWriteWeight({
    changesetId: result.backupId,
    changes: result.results
  });

  if (summary) attachFormatting(result.backupId, summary);

  return sendSuccess(res, {
    ...result,
    formatting,
    weight,
    backups: listBackups(5),
    timeline: attachWeight(result.backupId, weight),
    checkpoints: listCheckpoints()
  });
});

export const undoChanges = handle((req: Request, res: Response) => {
  const result = undoFileChanges(req.body?.backupId);
  return sendSuccess(res, {
    ...result,
    backups: listBackups(5),
    timeline: listBackups(25),
    checkpoints: listCheckpoints()
  });
});

export const getBackups = handle((_req: Request, res: Response) => {
  return sendSuccess(res, listBackups(50));
});

/* ------------------------------------------------------------------ *
 * Checkpoints: named moments the project can be put back to.
 * ------------------------------------------------------------------ */

export const getCheckpoints = handle((_req: Request, res: Response) => {
  return sendSuccess(res, { checkpoints: listCheckpoints(), timeline: listBackups(25) });
});

export const addCheckpoint = handle((req: Request, res: Response) => {
  const result = createCheckpoint(req.body?.name);
  return sendSuccess(res, { ...result, timeline: listBackups(25) });
});

export const removeCheckpoint = handle((req: Request, res: Response) => {
  return sendSuccess(res, { checkpoints: deleteCheckpoint(req.params?.id) });
});

export const rollback = handle((req: Request, res: Response) => {
  const result = rollbackToCheckpoint(req.body?.checkpointId);
  return sendSuccess(res, { ...result, checkpoints: listCheckpoints(), scan: workspacePayload() });
});

/* ------------------------------------------------------------------ *
 * Verification: run the project's own checks and report what breaks.
 * ------------------------------------------------------------------ */

/** Which checks this folder actually has — asked before running anything. */
export const getChecks = handle((_req: Request, res: Response) => {
  const root = getWorkspaceRoot();
  if (!root) throw new WorkspaceError('no_workspace', 'No workspace');
  return sendSuccess(res, { checks: detectChecks(root) });
});

/**
 * Runs the selected checks inside the connected folder and records the result next to the
 * batch that is being verified, so the timeline shows which write passed and which did not.
 */
export const runChecks = handle(async (req: Request, res: Response) => {
  const ru = isRu(req);
  const root = getWorkspaceRoot();
  if (!root) throw new WorkspaceError('no_workspace', 'No workspace');

  const ids: string[] | undefined = Array.isArray(req.body?.ids) ? req.body.ids.filter((id: unknown) => typeof id === 'string') : undefined;
  const customCommand = typeof req.body?.customCommand === 'string' ? req.body.customCommand : undefined;

  if ((ids && ids.length === 0) && !customCommand && detectChecks(root).length === 0) {
    throw new WorkspaceError('no_checks', ru ? 'В этой папке нечего проверять.' : 'There is nothing to check here.');
  }

  const changesetId = typeof req.body?.changesetId === 'string' ? req.body.changesetId : null;
  // The batch id travels into the run, so the verdict can say "this write broke that check".
  const report = await runVerification({ root, ids, customCommand, changesetId });

  // The build number is measured here and nowhere else: only a build that really ran makes the
  // size of `dist/` mean something, and a leftover folder from last week must not be compared
  // with itself and reported as "the bundle did not change".
  const buildRan = report.results.some((entry) => entry.kind === 'build' && entry.status === 'passed');
  const buildWeight = buildRan ? await measureBuildWeight({ changesetId, root }) : null;
  // The ceiling is only judged against a build that really ran, so a leftover `dist/` from last
  // week can never be reported as "over budget".
  const budget = buildWeight ? evaluateBuildBudget({ root, actual: buildWeight.bytes }) : null;
  const summary = {
    ...summarizeReport(report),
    ...(buildWeight ? { build: buildWeight } : {}),
    ...(budget ? { budget } : {})
  };

  return sendSuccess(res, {
    ...report,
    summary,
    build: buildWeight,
    budget,
    timeline: attachVerification(changesetId, summary),
    checkpoints: listCheckpoints()
  });
});

/* ------------------------------------------------------------------ *
 * The weight budget: the number the project may not grow past.
 * ------------------------------------------------------------------ */

/** The ceiling this folder has, and what the last measured build makes of it. */
export const getWeightBudget = handle((_req: Request, res: Response) => {
  const root = getWorkspaceRoot();
  if (!root) throw new WorkspaceError('no_workspace', 'No workspace');
  const stored = readWeightBudget(root);
  return sendSuccess(res, {
    bytes: stored?.bytes ?? null,
    setAt: stored?.setAt ?? null,
    // Null when the folder's build was never measured here: an honest "cannot say yet".
    verdict: lastBuildBudgetVerdict(root)
  });
});

/** Writes the ceiling down, or removes it when the field is emptied. */
export const setWeightBudget = handle((req: Request, res: Response) => {
  const root = getWorkspaceRoot();
  if (!root) throw new WorkspaceError('no_workspace', 'No workspace');
  const bytes = parseBudgetBytes(req.body?.bytes);
  const stored = writeWeightBudget(root, bytes);
  return sendSuccess(res, {
    bytes: stored?.bytes ?? null,
    setAt: stored?.setAt ?? null,
    verdict: lastBuildBudgetVerdict(root)
  });
});

const MAX_FIX_FILES = 8;
const MAX_REPORT_CHARS = 6_000;

/** A size as a sentence, in the same units the screen uses. */
function humanBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * The paragraph that turns a size into a task.
 *
 * A budget is only worth having if exceeding it produces the same kind of instruction a failing
 * test does — so the numbers are written out (measured, ceiling, overrun, share used) and the
 * model is told which of them has to move.
 */
function budgetSection(budget: BuildBudgetVerdict, ru: boolean): string {
  const actual = humanBytes(budget.actual);
  const ceiling = humanBytes(budget.bytes || 0);
  const over = humanBytes(Math.abs(budget.deltaBytes || 0));
  const used = budget.usedPct === null ? '' : `${budget.usedPct}%`;
  return ru
    ? [
        `БЮДЖЕТ ВЕСА ПРЕВЫШЕН. Собранный результат весит ${actual}, а предел, который поставил этот проект, — ${ceiling}.`,
        `Перебор: ${over}${used ? ` (использовано ${used} бюджета)` : ''}.`,
        'Число — это размер папки сборки, то есть всё, что попадает к пользователю целиком: одна тяжёлая зависимость объясняет его чаще всего.',
        'Верните сборку в бюджет, сохранив работу проекта: уберите или замените тяжёлое, разделите код, отключите то, что не нужно в первой загрузке.'
      ].join('\n')
    : [
        `THE WEIGHT BUDGET IS EXCEEDED. The built result weighs ${actual}, and the ceiling this project set for itself is ${ceiling}.`,
        `Over by ${over}${used ? ` (${used} of the budget used)` : ''}.`,
        'The number is the size of the build output — everything that reaches the user in one go — and one heavy dependency is the most common reason for it.',
        'Bring the build back under the ceiling while keeping the project working: drop or replace the heavy part, split the code, switch off what the first load does not need.'
      ].join('\n');
}

/**
 * Turns a verification report into the prompt block that asks the model to repair it.
 *
 * With a verdict, the repair is scoped to what the last change broke — the checks that stopped
 * passing and the problems that were not there before — instead of the whole backlog of old
 * errors, which is how a repair request turns into a rewrite of somebody else's code.
 */
function buildFixSection(
  report: VerificationReport,
  ru: boolean,
  budget?: BuildBudgetVerdict | null,
  onlyFindings = false
): { section: string; files: string[] } {
  const delta = report.delta;
  const newOnly = Boolean(delta?.compared && (delta.regressedChecks.length > 0 || delta.newProblems.length > 0));
  const regressedIds = new Set((delta?.regressedChecks || []).map((check) => check.id));

  const failing = report.results.filter((result) => {
    if (result.status !== 'failed' && result.status !== 'timeout') return false;
    if (!newOnly) return true;
    // Only the checks that this change broke, or that carry a problem it introduced.
    return regressedIds.has(result.id) || result.problems.some((problem) => problem.change === 'new');
  });

  const scopedProblems = newOnly ? delta!.newProblems : report.problems;

  const blocks = failing.map((result) => {
    const label = ru ? result.labelRu : result.labelEn;
    const tail = result.output.slice(-MAX_REPORT_CHARS);
    const header = `${label} — "${result.commandLine}" — ${
      result.status === 'timeout' ? (ru ? 'остановлено по таймауту' : 'stopped by timeout') : `exit code ${result.exitCode}`
    }`;
    return `### ${header}\n\`\`\`\n${tail}\n\`\`\``;
  });

  const problems = scopedProblems.slice(0, 25).map((problem) => {
    const where = problem.file ? `${problem.file}${problem.line ? `:${problem.line}` : ''}${problem.column ? `:${problem.column}` : ''}` : ru ? '(место не указано)' : '(no location)';
    return `- ${where} — ${problem.message}`;
  });

  const regressionNote = newOnly
    ? [
        ru
          ? 'ВАЖНО: до последней правки проект эти проверки проходил. Ошибки ниже вызваны именно ею:'
          : 'IMPORTANT: the project passed these checks before the most recent change. The failures below were introduced by it:',
        delta!.regressedChecks.length
          ? `${ru ? 'ПЕРЕСТАЛИ ПРОХОДИТЬ' : 'STOPPED PASSING'}: ${delta!.regressedChecks
              .map((check) => (ru ? check.labelRu : check.labelEn))
              .join(', ')}`
          : '',
        ru
          ? 'Верни проект в прежнее состояние минимальным изменением и не переписывай посторонний код.'
          : 'Restore the previous state with the smallest possible change, and leave unrelated code alone.'
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  // A run where every check passed but a lint warning or a weight ceiling is still new is not a
  // failure being repaired — the heading says which of the two this request actually is.
  const heading =
    onlyFindings && budget?.over
      ? ru
        ? 'СБОРКА ВЫШЛА ЗА БЮДЖЕТ ВЕСА, И ПОСЛЕ ПРАВКИ ПОЯВИЛИСЬ НОВЫЕ ЗАМЕЧАНИЯ:'
        : 'THE BUILD IS OVER ITS WEIGHT BUDGET, AND THE LAST CHANGE ADDED NEW FINDINGS:'
      : onlyFindings
      ? ru
        ? 'ПОСЛЕ ПОСЛЕДНЕЙ ПРАВКИ ПОЯВИЛИСЬ НОВЫЕ ЗАМЕЧАНИЯ. Проверки при этом прошли:'
        : 'THE LAST CHANGE ADDED NEW FINDINGS. Every check still passes:'
      : budget?.over
      ? ru
        ? 'СБОРКА ВЫШЛА ЗА БЮДЖЕТ ВЕСА. Ниже — измеренный результат:'
        : 'THE BUILD IS OVER ITS WEIGHT BUDGET. Below is the measured result:'
      : ru
      ? 'ПРОВЕРКА ПРОЕКТА НАШЛА ОШИБКИ. Ниже — реальный вывод команд и список найденных проблем:'
      : 'THE PROJECT CHECK FAILED. Below is the real command output and the list of problems:';

  const section = [
    heading,
    budget?.over ? budgetSection(budget, ru) : '',
    regressionNote,
    blocks.join('\n\n').slice(0, 20_000),
    problems.length ? `${ru ? 'РАЗБОР ПРОБЛЕМ' : 'PARSED PROBLEMS'}:\n${problems.join('\n')}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');

  const files = Array.from(
    new Set(scopedProblems.map((problem) => problem.file).filter((file): file is string => Boolean(file)))
  ).filter((file) => {
    try {
      return readWorkspaceTextFile(file, 1).path === file;
    } catch {
      return false;
    }
  });

  return { section, files: files.slice(0, MAX_FIX_FILES) };
}

/**
 * The second half of the loop: takes the failing checks and asks the model for a minimal fix.
 * Like every other proposal it only returns text — the user reviews and applies it, and the
 * whole apply is one more undoable batch.
 */
export const fixChecks = handle(async (req: Request, res: Response) => {
  const ru = isRu(req);
  const root = getWorkspaceRoot();
  if (!root) throw new WorkspaceError('no_workspace', 'No workspace');

  // The report comes from the screen (so the fix matches exactly what the user saw); if it is
  // missing, the checks are simply run again.
  const provided: VerificationReport | null = req.body?.verification?.results ? req.body.verification : null;
  const report = provided || (await runVerification({ root }));
  const summary = summarizeReport(report);

  const failing = report.results.filter((result) => result.status === 'failed' || result.status === 'timeout');

  // A green run is not the same as nothing to do. A lint warning the last change introduced, or a
  // build that pushed the page past its ceiling, is work the same way a failed test is — and
  // stopping at the report is exactly what leaves a beginner with "so what do I do now?".
  const sentBudget: BuildBudgetVerdict | null = req.body?.budget?.bytes ? req.body.budget : null;
  const budget = sentBudget || report.budget || null;
  const budgetOver = Boolean(budget?.over);
  const newFindings = report.delta?.compared ? report.delta.newProblems : [];
  const onlyFindings = failing.length === 0 && newFindings.length > 0;

  // "Nothing to fix" is the more precise answer, so it is given before asking for a key: nobody
  // should be sent to configure a model in order to repair a project that already passes.
  if (failing.length === 0 && newFindings.length === 0 && !budgetOver) {
    return sendError(
      res,
      400,
      'nothing_to_fix',
      ru ? RU_MESSAGES.nothing_to_fix : EN_MESSAGES.nothing_to_fix,
      { reason: 'nothing_to_fix' }
    );
  }

  if (!hasAiProvider()) {
    return sendError(
      res,
      400,
      'no_ai_provider',
      ru
        ? 'Ошибки есть, но нужен ключ API: откройте «Ключи API» внизу слева и добавьте ключ Gemini, OpenAI, Claude или NVIDIA — без модели приложение не сможет их исправить.'
        : 'There are failures, but an API key is required: open "API Keys" at the bottom left and add a Gemini, OpenAI, Claude or NVIDIA key — without a model the app cannot fix them.',
      { reason: 'no_ai_provider' }
    );
  }

  const { section, files } = buildFixSection(report, ru, budget, onlyFindings || budgetOver);
  // A verdict turns "something is broken" into "your last change broke this", which is both a
  // better task title and a better instruction for the model.
  const regressions = report.delta?.compared ? report.delta.regressedChecks : [];
  const taskTitle =
    String(req.body?.taskTitle || '').trim() ||
    (ru
      ? failing.length === 0 && onlyFindings
        ? `Убрать замечания, которые добавила эта правка: ${newFindings.length}`
        : failing.length === 0
        ? `Уменьшить вес сборки: сейчас ${Math.round((budget?.actual || 0) / 1024)} KB при пределе ${Math.round((budget?.bytes || 0) / 1024)} KB`
        : regressions.length
        ? `Снова заставить проходить проверки, которые сломались: ${regressions
            .map((check) => check.labelRu)
            .join(', ')}`
        : `Исправить ошибки проверки: ${failing.map((result) => result.labelRu).join(', ')}`
      : failing.length === 0 && onlyFindings
      ? `Remove the findings this change added: ${newFindings.length}`
      : failing.length === 0
      ? `Bring the build back under its budget: ${Math.round((budget?.actual || 0) / 1024)} KB against a ${Math.round((budget?.bytes || 0) / 1024)} KB ceiling`
      : regressions.length
      ? `Make the broken checks pass again: ${regressions.map((check) => check.labelEn).join(', ')}`
      : `Fix the failing checks: ${failing.map((result) => result.labelEn).join(', ')}`);

  const outcome = await proposeFileChanges({
    ru,
    taskTitle,
    goal: ru
      ? 'Проект должен проходить эти проверки после вашего изменения.'
      : 'The project must pass these checks after your change.',
    instructions: String(req.body?.instructions || '').trim() || undefined,
    targetFiles: files.length > 0 ? files : undefined,
    projectName: req.body?.projectName,
    projectType: req.body?.projectType,
    engineOrFramework: req.body?.engineOrFramework,
    language: req.body?.language,
    brief: req.body?.brief,
    extraSection: section,
    extraRules: [
      ru
        ? `${9}. Это исправление, а не переписывание: меняйте только то, из-за чего падают проверки, и не трогайте посторонний код, стиль и архитектуру.`
        : `${9}. This is a repair, not a rewrite: change only what makes the checks fail, and leave unrelated code, style and architecture alone.`,
      ru
        ? `${10}. Если ошибка вызвана отсутствующим файлом или конфигурацией — создайте или исправьте именно их.`
        : `${10}. If a failure is caused by a missing file or configuration, create or fix exactly that.`,
      ...(onlyFindings
        ? [
            ru
              ? `${12}. Проверки уже проходят: уберите только перечисленные новые замечания и не меняйте поведение проекта.`
              : `${12}. The checks already pass: clear exactly the new findings listed above and do not change how the project behaves.`
          ]
        : []),
      ...(budgetOver
        ? [
            ru
              ? `${13}. Вес важнее удобства: уменьшите итоговый размер сборки (уберите или замените тяжёлую зависимость, разделите код на части, отключите лишнее), сохранив работу проекта.`
              : `${13}. Weight matters more than convenience: reduce the size of the built output (drop or replace a heavy dependency, split the code, switch things off) while keeping the project working.`
          ]
        : []),
      ...(report.delta?.compared &&
      (report.delta.regressedChecks.length > 0 || report.delta.newProblems.length > 0)
        ? [
            ru
              ? `${11}. Эти проверки проходили до последней правки: верните проект в прежнее состояние, а не «улучшайте» его дальше.`
              : `${11}. These checks passed before the most recent change: bring the project back to that state instead of improving it further.`
          ]
        : [])
    ]
  });

  if (!outcome) {
    return sendError(
      res,
      502,
      'ai_unavailable',
      ru
        ? 'Модель не дала ответ. Проверьте ключ API и попробуйте ещё раз.'
        : 'The model did not answer. Check the API key and try again.',
      { reason: 'ai_unavailable' }
    );
  }

  return sendSuccess(res, {
    ...outcome,
    verification: { summary, results: failing.map((result) => ({ id: result.id, status: result.status })) },
    // The repair itself is checked by the same command that failed.
    recheckIds: failing.map((result) => result.id)
  });
});

/**
 * Asks the configured AI model to produce the actual file contents for one task.
 * Nothing is written here — the client reviews every file first and then calls /apply.
 */
export const generateChanges = handle(async (req: Request, res: Response) => {
  const ru = isRu(req);
  const root = getWorkspaceRoot();
  if (!root) {
    throw new WorkspaceError('no_workspace', 'No workspace');
  }

  const taskTitle = String(req.body?.taskTitle || '').trim();
  if (!taskTitle) {
    throw new WorkspaceError('empty_path', ru ? 'Опишите задачу, которую нужно реализовать.' : 'Describe the task first.');
  }

  if (!hasAiProvider()) {
    return sendError(
      res,
      400,
      'no_ai_provider',
      ru
        ? 'Нужен ключ API: откройте «Ключи API» внизу слева и добавьте ключ Gemini, OpenAI, Claude или NVIDIA — без модели приложение не сможет написать код.'
        : 'An API key is required: open "API Keys" at the bottom left and add a Gemini, OpenAI, Claude or NVIDIA key — without a model the app cannot write code.',
      { reason: 'no_ai_provider' }
    );
  }

  const outcome = await proposeFileChanges({
    ru,
    taskTitle,
    goal: String(req.body?.goal || '').trim(),
    instructions: String(req.body?.instructions || '').trim(),
    acceptanceCriteria: Array.isArray(req.body?.acceptanceCriteria) ? req.body.acceptanceCriteria : [],
    targetFiles: Array.isArray(req.body?.targetFiles) ? req.body.targetFiles : [],
    projectName: req.body?.projectName || req.body?.brief?.projectName,
    projectType: req.body?.projectType,
    engineOrFramework: req.body?.engineOrFramework,
    language: req.body?.language,
    brief: req.body?.brief
  });

  if (!outcome) {
    return sendError(
      res,
      502,
      'ai_unavailable',
      ru
        ? 'Модель не дала ответ. Проверьте ключ API и попробуйте ещё раз.'
        : 'The model did not answer. Check the API key and try again.',
      { reason: 'ai_unavailable' }
    );
  }

  return sendSuccess(res, outcome);
});
