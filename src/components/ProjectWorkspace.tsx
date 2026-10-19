import React, { useEffect, useMemo, useState } from 'react';
import { ProjectFile, ProjectState } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { useProject } from '../context/ProjectContext';
import {
  ApplyChangesResult,
  CheckProblem,
  FileChangeProposal,
  FormattingResult,
  ProjectCheckDefinition,
  VerificationReport,
  WeightBudget,
  WorkspaceChangeset,
  WorkspaceCheckpoint,
  WorkspaceFileEntry,
  WorkspaceState,
  applyFileChangesApi,
  bindWorkspaceApi,
  createCheckpointApi,
  deleteCheckpointApi,
  fetchChecksApi,
  fetchWeightBudgetApi,
  fetchWorkspaceApi,
  fixChecksApi,
  saveWeightBudgetApi,
  generateFileChangesApi,
  readWorkspaceFileApi,
  rollbackToCheckpointApi,
  runVerificationApi,
  scanWorkspaceApi,
  unbindWorkspaceApi,
  undoFileChangesApi,
  writeWorkspaceFileApi
} from '../services/api';
import { VerificationPanel } from './VerificationPanel';
import { GitPanel } from './GitPanel';
import { CheckpointTimeline } from './CheckpointTimeline';
import { diffHunks, diffLines, diffStat } from '../utils/simpleDiff';
import { formatBytes, weightDetailLine, weightLine } from '../utils/byteSize';
import { TASK_FILE_DRAG_TYPE } from '../utils/taskFiles';
import { Button, IconButton, buttonClass } from './ui/Button';
import { HelpHint } from './ui/HelpHint';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileCode,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  Save,
  Search,
  SearchCheck,
  Sparkles,
  Undo2,
  Wand2,
  X
} from 'lucide-react';

interface ProjectWorkspaceProps {
  project: ProjectState | null;
  onSyncProjectFiles?: (files: ProjectFile[], root: string) => void;
  onOpenNewProjectModal?: () => void;
}

const MAX_CONTEXT_FILES = 8;

/**
 * One surface, not a stack of plates.
 *
 * The folder, the list, the editor, the generator and the three panels under them used to be a card
 * inside a card inside a card — the screen was a fence of rounded rectangles and the eye had to find
 * the content inside two borders. A window already has an edge (its own frame or the pane's
 * header), so the blocks inside are separated by a hairline and air: `SECTION` is that rule, and no
 * block draws a border of its own.
 */
const SECTION = 'border-t border-slate-800/70 pt-5';

/**
 * What to say about the tidy-up after a write, in one line — and nothing at all when there is
 * nothing to say (no files written, or the folder simply has no formatter).
 */
function formattingLine(formatting: FormattingResult | null | undefined, ru: boolean): string {
  if (!formatting) return '';
  if (formatting.error) {
    return ru
      ? `Привести в порядок не получилось (${formatting.toolLabel || 'форматтер'}): ${formatting.error}`
      : `Could not tidy up (${formatting.toolLabel || 'formatter'}): ${formatting.error}`;
  }
  if (!formatting.ran) {
    if (formatting.note === 'no_formatter') {
      return ru
        ? 'Приводить в порядок нечем: в папке нет Prettier, Biome или Ruff'
        : 'Nothing to tidy with: this folder has no Prettier, Biome or Ruff';
    }
    return '';
  }
  if (formatting.changed.length > 0) {
    return ru
      ? `Приведено в порядок: ${formatting.changed.length} (${formatting.toolLabel})`
      : `Tidied up: ${formatting.changed.length} file(s) (${formatting.toolLabel})`;
  }
  return ru
    ? `Код уже был в порядке — ${formatting.toolLabel} ничего не менял`
    : `The code was already tidy — ${formatting.toolLabel} changed nothing`;
}

/**
 * The screen that turns the app from an advice-giver into a doer: connect the real project
 * folder, see the real files, let the AI write them, review the diff, and apply — with a
 * one-click undo for every batch that was written.
 */
export const ProjectWorkspace: React.FC<ProjectWorkspaceProps> = ({
  project,
  onSyncProjectFiles,
  onOpenNewProjectModal
}) => {
  const { language } = useLanguage();
  const { showToast } = useProject();
  const ru = language === 'ru';

  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [isBinding, setIsBinding] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [filter, setFilter] = useState('');
  const [checkedPaths, setCheckedPaths] = useState<string[]>([]);
  const [openedFile, setOpenedFile] = useState<{ path: string; content: string; truncated: boolean; sizeBytes: number } | null>(null);
  const [fileDraft, setFileDraft] = useState('');
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isSavingFile, setIsSavingFile] = useState(false);

  const [taskTitle, setTaskTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [changes, setChanges] = useState<FileChangeProposal[] | null>(null);
  const [changeSummary, setChangeSummary] = useState('');
  const [changeWarnings, setChangeWarnings] = useState<string[]>([]);
  const [skippedForApply, setSkippedForApply] = useState<string[]>([]);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyChangesResult | null>(null);

  // Verification loop: what can be checked here, what the last run found, and what to re-check
  // after a repair. Checkpoints are the history half of the same story.
  const [checks, setChecks] = useState<ProjectCheckDefinition[]>([]);
  const [checksLoading, setChecksLoading] = useState(false);
  const [verification, setVerification] = useState<VerificationReport | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [autoVerify, setAutoVerify] = useState(true);
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetHint, setBudgetHint] = useState('');
  // The ceiling and what the last measured build makes of it. Read on its own, so a project with
  // no checks to run can still set one before anything is ever built.
  const [weightBudget, setWeightBudget] = useState<WeightBudget | null>(null);
  // Tidying up after a write is on by default, exactly like the verification that follows it:
  // it only ever runs the formatter the project itself already has.
  const [formatAfterWrite, setFormatAfterWrite] = useState(true);
  const [recheckIds, setRecheckIds] = useState<string[] | null>(null);
  // The command the user typed is not part of the folder's own list of checks, so a re-check has
  // to carry it along — otherwise the repair would be "verified" by running nothing at all.
  const [lastCustomCommand, setLastCustomCommand] = useState<string | null>(null);
  const [lastChangesetId, setLastChangesetId] = useState<string | null>(null);
  const [fixHint, setFixHint] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  // Every write to the folder (and every rollback) moves this forward, so the Git panel
  // re-reads what changed without the two panels having to know about each other.
  const [gitRefreshKey, setGitRefreshKey] = useState(0);

  const files = workspace?.files || [];
  const root = workspace?.root || null;
  const timeline: WorkspaceChangeset[] = workspace?.timeline || [];
  const checkpoints: WorkspaceCheckpoint[] = workspace?.checkpoints || [];
  const isHistoryBusy = busyId !== null || isUndoing || isVerifying || isFixing;

  // The folder lives on the server, so the screen restores itself from there on every visit —
  // and again when another project is picked, which may bring its own connected folder.
  useEffect(() => {
    let cancelled = false;
    fetchWorkspaceApi(language)
      .then((state) => {
        if (!cancelled) setWorkspace(state);
      })
      .catch(() => {
        /* The screen simply starts disconnected. */
      });
    return () => {
      cancelled = true;
    };
  }, [language, project?.id]);

  /** Which checks this folder has — asked once per connected folder. */
  const loadChecks = async () => {
    setChecksLoading(true);
    try {
      const result = await fetchChecksApi();
      setChecks(result.checks);
    } catch {
      setChecks([]);
    } finally {
      setChecksLoading(false);
    }
  };

  // A different folder means a different history, different checks and a different ceiling.
  useEffect(() => {
    setVerification(null);
    setLastChangesetId(null);
    setRecheckIds(null);
    setFixHint('');
    setBudgetHint('');
    if (root) loadChecks();
    else setChecks([]);
    if (!root) {
      setWeightBudget(null);
      return;
    }
    let cancelled = false;
    fetchWeightBudgetApi(language)
      .then((saved) => {
        if (!cancelled) setWeightBudget(saved);
      })
      .catch(() => {
        // A folder whose budget cannot be read simply has none.
        if (!cancelled) setWeightBudget(null);
      });
    return () => {
      cancelled = true;
    };
  }, [root, language]);

  useEffect(() => {
    const activeTask =
      project?.phases
        ?.flatMap((phase) => phase.tasks)
        .find((task) => task.id === project?.activeTaskId) ||
      project?.phases?.flatMap((phase) => phase.tasks).find((task) => task.status === 'ready' || task.status === 'partial');
    if (activeTask?.title && !taskTitle) setTaskTitle(activeTask.title);
  }, [project?.id]);

  const visibleFiles = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return files;
    return files.filter((file) => file.path.toLowerCase().includes(needle));
  }, [files, filter]);

  const contextPaths = useMemo(() => {
    if (checkedPaths.length > 0) return checkedPaths.slice(0, MAX_CONTEXT_FILES);
    if (openedFile?.path) return [openedFile.path];
    return files
      .filter((file) => file.isText && (file.type === 'code' || file.type === 'test'))
      .slice(0, MAX_CONTEXT_FILES)
      .map((file) => file.path);
  }, [checkedPaths, openedFile?.path, files]);

  /**
   * Connects the folder this project was created with — the one way back after "Отключить".
   *
   * It takes the path as an argument and never reads one from a field, because this screen does not
   * choose folders: it reconnects the project's own one, which is a different act with a different
   * question behind it ("start working in my folder again", not "which folder should this be").
   */
  const handleBind = async (pathToBind: string) => {
    const value = pathToBind.trim();
    if (!value || isBinding) return;
    setIsBinding(true);
    setErrorMsg('');
    try {
      const state = await bindWorkspaceApi({ path: value, language });
      setWorkspace(state);
      setChanges(null);
      setApplyResult(null);
      showToast(
        ru
          ? `Папка подключена: ${state.root} (файлов: ${state.files.length})`
          : `Folder connected: ${state.root} (${state.files.length} files)`
      );
    } catch (err: any) {
      setErrorMsg(err?.userMessage || err?.message || (ru ? 'Не удалось подключить папку.' : 'Could not connect the folder.'));
    } finally {
      setIsBinding(false);
    }
  };

  const handleRescan = async () => {
    if (!root || isScanning) return;
    setIsScanning(true);
    setErrorMsg('');
    try {
      const state = await scanWorkspaceApi();
      setWorkspace(state);
      showToast(ru ? `Найдено файлов: ${state.files.length}` : `Found ${state.files.length} files`);
    } catch (err: any) {
      setErrorMsg(err?.userMessage || err?.message || 'Scan failed');
    } finally {
      setIsScanning(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      const state = await unbindWorkspaceApi();
      setWorkspace(state);
      setOpenedFile(null);
      setCheckedPaths([]);
      setChanges(null);
      setApplyResult(null);
    } catch (err: any) {
      setErrorMsg(err?.userMessage || err?.message || 'Failed');
    }
  };

  const handleOpenFile = async (path: string) => {
    setIsLoadingFile(true);
    setErrorMsg('');
    try {
      const file = await readWorkspaceFileApi(path);
      setOpenedFile(file);
      setFileDraft(file.content);
    } catch (err: any) {
      setErrorMsg(err?.userMessage || err?.message || 'Cannot read file');
      setOpenedFile(null);
    } finally {
      setIsLoadingFile(false);
    }
  };

  const handleSaveFile = async () => {
    if (!openedFile || isSavingFile) return;
    setIsSavingFile(true);
    setErrorMsg('');
    try {
      const result = await writeWorkspaceFileApi({ path: openedFile.path, content: fileDraft });
      showToast(
        result.status === 'created'
          ? ru
            ? `Создан файл ${result.path}`
            : `Created ${result.path}`
          : ru
          ? `Сохранён файл ${result.path}`
          : `Saved ${result.path}`
      );
      await handleRescan();
      setOpenedFile({ ...openedFile, content: fileDraft, sizeBytes: fileDraft.length });
    } catch (err: any) {
      setErrorMsg(err?.userMessage || err?.message || 'Cannot save file');
    } finally {
      setIsSavingFile(false);
    }
  };

  const handleGenerate = async () => {
    if (!root) return;
    if (!taskTitle.trim() || isGenerating) {
      if (!taskTitle.trim()) {
        setErrorMsg(ru ? 'Опишите задачу, которую нужно реализовать.' : 'Describe the task first.');
      }
      return;
    }
    setIsGenerating(true);
    setErrorMsg('');
    setApplyResult(null);
    try {
      const data = await generateFileChangesApi({
        taskTitle: taskTitle.trim(),
        goal: instructions.trim() || undefined,
        instructions: instructions.trim() || undefined,
        targetFiles: contextPaths,
        projectName: project?.name,
        projectType: project?.projectType,
        engineOrFramework: project?.engineOrFramework,
        language,
        brief: project?.brief
      });
      setChanges(data.changes);
      setChangeSummary(data.summary);
      setChangeWarnings(data.warnings || []);
      setSkippedForApply([]);
      setExpandedPath(data.changes[0]?.path || null);
      if (data.changes.length === 0) {
        showToast(
          ru
            ? 'Модель не предложила изменений — уточните задачу.'
            : 'The model proposed no changes — refine the task.'
        );
      }
    } catch (err: any) {
      setErrorMsg(
        err?.userMessage ||
          err?.message ||
          (ru ? 'Не удалось получить изменения от модели.' : 'Could not get changes from the model.')
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApply = async () => {
    if (!changes || isApplying) return;
    const selected = changes.filter((change) => !skippedForApply.includes(change.path));
    if (selected.length === 0) {
      setErrorMsg(ru ? 'Не выбрано ни одного файла.' : 'No file is selected.');
      return;
    }
    setIsApplying(true);
    setErrorMsg('');
    setFixHint('');
    try {
      const result = await applyFileChangesApi(selected, undefined, { format: formatAfterWrite });
      setApplyResult(result);
      setLastChangesetId(result.backupId);
      setWorkspace((prev) =>
        prev
          ? {
              ...prev,
              backups: result.backups,
              timeline: result.timeline || prev.timeline,
              checkpoints: result.checkpoints || prev.checkpoints
            }
          : prev
      );
      await handleRescan();
      if (openedFile && selected.some((change) => change.path === openedFile.path)) {
        const updated = selected.find((change) => change.path === openedFile.path);
        if (updated && updated.action !== 'delete') {
          setOpenedFile({ ...openedFile, content: updated.content, sizeBytes: updated.content.length });
          setFileDraft(updated.content);
        } else {
          setOpenedFile(null);
        }
      }
      setChanges(null);
      const tidied = result.formatting?.changed.length || 0;
      const tidiedSuffix = tidied > 0 ? (ru ? `, приведено в порядок: ${tidied}` : `, tidied: ${tidied}`) : '';
      showToast(
        result.failed > 0
          ? ru
            ? `Записано файлов: ${result.applied}, ошибок: ${result.failed}${tidiedSuffix}`
            : `Written ${result.applied} file(s), ${result.failed} failed${tidiedSuffix}`
          : ru
          ? `Готово! Записано файлов: ${result.applied}${tidiedSuffix}`
          : `Done! ${result.applied} file(s) written${tidiedSuffix}`
      );
      setGitRefreshKey((key) => key + 1);
      // The loop closes here: what was just written is checked, and a repair is re-checked with
      // exactly the commands that failed before.
      if (autoVerify && (recheckIds?.length || checks.length > 0)) {
        const ids = recheckIds?.length ? recheckIds : checks.map((check) => check.id);
        setRecheckIds(null);
        await runChecks(ids, lastCustomCommand ?? undefined, result.backupId);
      }
    } catch (err: any) {
      setErrorMsg(err?.userMessage || err?.message || (ru ? 'Не удалось записать файлы.' : 'Could not write the files.'));
    } finally {
      setIsApplying(false);
    }
  };

  /** Runs the project's checks and keeps the answer on screen. */
  const runChecks = async (ids: string[], customCommand?: string, changesetId?: string | null) => {
    if (isVerifying) return;
    setIsVerifying(true);
    setErrorMsg('');
    // Whatever was just run is what a later re-check has to repeat.
    setLastCustomCommand(customCommand && customCommand.trim() ? customCommand : null);
    try {
      const report = await runVerificationApi({
        ids,
        customCommand,
        changesetId: changesetId ?? lastChangesetId,
        language
      });
      setVerification(report);
      // A run that really built the project is the freshest word on the ceiling there is.
      if (report.budget) {
        const verdict = report.budget;
        setWeightBudget((prev) => ({ bytes: verdict.bytes, setAt: prev?.setAt ?? null, verdict }));
      }
      setWorkspace((prev) =>
        prev ? { ...prev, timeline: report.timeline, checkpoints: report.checkpoints } : prev
      );
      showToast(
        report.ok
          ? ru
            ? `Проверки прошли: ${report.passed}`
            : `Checks passed: ${report.passed}`
          : ru
          ? `Проверка нашла ошибок: ${report.summary.errors}`
          : `The check found ${report.summary.errors} error(s)`
      );
    } catch (err: any) {
      setErrorMsg(
        err?.userMessage || err?.message || (ru ? 'Не удалось запустить проверки.' : 'Could not run the checks.')
      );
    } finally {
      setIsVerifying(false);
    }
  };

  /** Asks the model to repair exactly what the last run reported. */
  const handleFixChecks = async () => {
    if (!verification || isFixing) return;
    setIsFixing(true);
    setErrorMsg('');
    setFixHint('');
    setApplyResult(null);
    try {
      const data = await fixChecksApi({
        verification,
        // A build over its ceiling is a task of its own, exactly like a failed check.
        budget: verification.budget ?? null,
        projectName: project?.name,
        projectType: project?.projectType,
        engineOrFramework: project?.engineOrFramework,
        language,
        brief: project?.brief
      });
      setChanges(data.changes);
      setChangeSummary(data.summary);
      setChangeWarnings(data.warnings || []);
      setSkippedForApply([]);
      setExpandedPath(data.changes[0]?.path || null);
      setRecheckIds(data.recheckIds?.length ? data.recheckIds : null);
      setFixHint(
        ru
          ? 'Исправление готово: проверьте дифф выше, отметьте нужные файлы и нажмите «Записать». После записи проверка запустится снова сама.'
          : 'The fix is ready: review the diff above, tick the files and press "Write". The check runs again by itself afterwards.'
      );
      if (data.changes.length === 0) {
        showToast(ru ? 'Модель не предложила исправлений.' : 'The model proposed no fix.');
      }
    } catch (err: any) {
      setErrorMsg(
        err?.userMessage || err?.message || (ru ? 'Не удалось получить исправление.' : 'Could not get a fix.')
      );
    } finally {
      setIsFixing(false);
    }
  };

  /**
   * Writes the weight ceiling down, or removes it when the field was emptied.
   *
   * The answer carries the verdict for the folder as it stands, measured against the last build
   * that really ran here — so "you are already 200 KB over" arrives with the same click that sets
   * the limit, instead of after the next build surprises somebody.
   */
  const handleSaveBudget = async (value: string) => {
    if (budgetSaving) return;
    setBudgetSaving(true);
    setBudgetHint('');
    try {
      const saved = await saveWeightBudgetApi({ bytes: value, language });
      setWeightBudget(saved);
      // The report, if there is one, carries the verdict the panel draws; the saved answer is the
      // newer truth about the ceiling itself.
      setVerification((prev) => (prev ? { ...prev, budget: saved.verdict ?? null } : prev));
      setBudgetHint(
        saved.bytes === null
          ? ru
            ? 'Бюджет убран: размер сборки снова просто измеряется.'
            : 'The budget is removed: the build size is only measured again.'
          : saved.verdict
          ? ru
            ? 'Бюджет сохранён и сравнён с последней измеренной сборкой в этой папке.'
            : 'The budget is saved and was compared with the last build measured in this folder.'
          : ru
            ? 'Бюджет сохранён. В этой папке сборку ещё не измеряли — результат будет виден после первой сборки.'
            : 'The budget is saved. No build has been measured in this folder yet — the first one will show the result.'
      );
    } catch (err: any) {
      setBudgetHint(
        err?.userMessage || err?.message || (ru ? 'Не удалось сохранить бюджет веса.' : 'Could not save the weight budget.')
      );
    } finally {
      setBudgetSaving(false);
    }
  };

  const handleCreateCheckpoint = async (name: string) => {
    if (busyId) return;
    setBusyId('create');
    setErrorMsg('');
    try {
      const result = await createCheckpointApi({ name });
      setWorkspace((prev) =>
        prev ? { ...prev, checkpoints: result.checkpoints, timeline: result.timeline } : prev
      );
      showToast(
        ru ? `Чекпоинт «${result.checkpoint.name}» создан` : `Checkpoint "${result.checkpoint.name}" created`
      );
    } catch (err: any) {
      setErrorMsg(
        err?.userMessage || err?.message || (ru ? 'Не удалось создать чекпоинт.' : 'Could not create the checkpoint.')
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteCheckpoint = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      const result = await deleteCheckpointApi(id);
      setWorkspace((prev) => (prev ? { ...prev, checkpoints: result.checkpoints } : prev));
    } catch (err: any) {
      setErrorMsg(err?.userMessage || err?.message || 'Failed');
    } finally {
      setBusyId(null);
    }
  };

  /** Returns the whole folder to a checkpoint by undoing every batch written after it. */
  const handleRollback = async (checkpointId: string) => {
    if (busyId) return;
    setBusyId(checkpointId);
    setErrorMsg('');
    try {
      const result = await rollbackToCheckpointApi(checkpointId);
      setWorkspace(result.scan);
      setApplyResult(null);
      setChanges(null);
      setVerification(null);
      setLastChangesetId(null);
      setRecheckIds(null);
      setFixHint('');
      if (openedFile) {
        try {
          const file = await readWorkspaceFileApi(openedFile.path);
          setOpenedFile(file);
          setFileDraft(file.content);
        } catch {
          setOpenedFile(null);
        }
      }
      showToast(
        result.undoneChangesets === 0
          ? ru
            ? `Папка уже находится в состоянии чекпоинта «${result.checkpointName}» — откатывать нечего.`
            : `The folder is already at checkpoint "${result.checkpointName}" — there is nothing to roll back.`
          : ru
          ? `Откат к «${result.checkpointName}»: отменено записей ${result.undoneChangesets}, файлов ${result.applied}`
          : `Rolled back to "${result.checkpointName}": ${result.undoneChangesets} batch(es), ${result.applied} file(s)`
      );
    } catch (err: any) {
      setErrorMsg(
        err?.userMessage || err?.message || (ru ? 'Не удалось откатить проект.' : 'The rollback failed.')
      );
    } finally {
      setBusyId(null);
    }
  };

  /** Clicking a finding opens the file it points at, so the fix starts where the error is. */
  const handleOpenProblem = (problem: CheckProblem) => {
    if (problem.file) handleOpenFile(problem.file);
  };

  const handleUndo = async (backupId: string) => {
    if (isUndoing) return;
    setIsUndoing(true);
    setBusyId(backupId);
    setErrorMsg('');
    try {
      const result = await undoFileChangesApi(backupId);
      setWorkspace((prev) =>
        prev
          ? {
              ...prev,
              backups: result.backups,
              timeline: result.timeline || prev.timeline,
              checkpoints: result.checkpoints || prev.checkpoints
            }
          : prev
      );
      await handleRescan();
      setGitRefreshKey((key) => key + 1);
      if (applyResult?.backupId === backupId) setApplyResult(null);
      showToast(ru ? `Откат выполнен, файлов: ${result.applied}` : `Undo complete, ${result.applied} file(s)`);
    } catch (err: any) {
      setErrorMsg(err?.userMessage || err?.message || (ru ? 'Не удалось откатить изменения.' : 'Undo failed.'));
    } finally {
      setIsUndoing(false);
      setBusyId(null);
    }
  };

  const handleSyncToProject = () => {
    if (!project || !onSyncProjectFiles || !root) return;
    const mapped: ProjectFile[] = files.map((file) => ({
      path: file.path,
      type: file.type,
      description: `${file.dir || '.'} • ${formatBytes(file.sizeBytes)}`,
      sizeBytes: file.sizeBytes
    }));
    onSyncProjectFiles(mapped, root);
  };

  if (!project) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 short:p-5 text-center space-y-4 max-w-lg mx-auto my-12 short:my-2">
        <div className="w-12 h-12 rounded-2xl bg-indigo-950 text-indigo-400 border border-indigo-800 flex items-center justify-center mx-auto">
          <HardDrive className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-white">{ru ? 'Проект не выбран' : 'No project selected'}</h3>
        <p className="text-xs text-slate-400">
          {ru
            ? 'Выберите проект или создайте новый — затем подключите к нему папку с файлами на диске.'
            : 'Pick or create a project, then connect the folder with its files on disk.'}
        </p>
        {onOpenNewProjectModal && (
          <Button variant="primary" size="md" icon={Sparkles} onClick={onOpenNewProjectModal}>
            {ru ? 'Новый проект' : 'New project'}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {errorMsg && (
        <div className="bg-rose-500/10 rounded-xl px-4 py-3 text-xs text-rose-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
          <IconButton
            label={ru ? 'Скрыть' : 'Dismiss'}
            icon={X}
            size="xs"
            className="ml-auto"
            onClick={() => setErrorMsg('')}
          />
        </div>
      )}

      {/*
        The project's folder: which one it is, and what it holds.

        Choosing a folder happens once, while the project is created, and this screen reads that
        decision rather than offering a second place to make it — a project whose folder can be
        swapped from any screen is a project whose "what am I allowed to touch" question has more
        than one answer. Two buttons stay, and neither of them chooses anything: rescanning the same
        folder, and disconnecting it (whose way back is the folder the project was created with,
        not a picker).
      */}
      {/*
        The folder, stated the way the studio states it: the path, a count and the actions — no
        heading over them, no green tick. "Connected" is the path being here at all; a checkmark
        and a colour said it a second time, and the green was the loudest thing on a screen that
        otherwise only lists files.
      */}
      <div className="space-y-3">
        {root ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400">
                <span className="text-slate-300">
                  {ru ? 'Папка подключена' : 'Folder connected'}
                </span>
                <span>
                  {ru ? 'Файлов' : 'Files'}: <span className="tabular-nums text-slate-400">{files.length}</span>
                </span>
                {/* The safety of writing into this folder is a fact about the app, not a state of
                    the folder: it belongs in the mark's tooltip, not in a paragraph under the row. */}
                <HelpHint
                  text={
                    ru
                      ? 'Приложение работает только внутри подключённой папки, никогда не читает .env и ключи, а перед каждой записью сохраняет копию — изменения можно откатить одной кнопкой.'
                      : 'The app only works inside the connected folder, never reads .env files or keys, and backs every file up before writing — any change can be undone in one click.'
                  }
                />
              </div>
              {/* The whole path stays reachable in the tooltip, so a long one cannot break the card. */}
              <p className="truncate font-mono text-[11px] text-slate-400" title={root}>
                {root}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleRescan}
                disabled={isScanning}
                className={buttonClass({ variant: 'secondary', size: 'xs' })}
              >
                {isScanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                <span>{ru ? 'Обновить список' : 'Rescan'}</span>
              </button>
              {onSyncProjectFiles && (
                <button
                  onClick={handleSyncToProject}
                  className={buttonClass({ variant: 'primary', size: 'xs' })}
                >
                  <SearchCheck className="w-3.5 h-3.5" />
                  <span>{ru ? 'Использовать в проекте' : 'Use in project'}</span>
                </button>
              )}
              <button
                onClick={handleDisconnect}
                className={buttonClass({ variant: 'ghost', size: 'xs', className: 'hover:text-rose-300' })}
              >
                {ru ? 'Отключить' : 'Disconnect'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {project.workspaceRoot ? (
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                <span className="min-w-0">
                  {ru ? 'Проект создавался с папкой:' : 'This project was created with the folder:'}{' '}
                  <span className="font-mono text-slate-300 break-all">{project.workspaceRoot}</span>
                </span>
                <button
                  onClick={() => handleBind(project.workspaceRoot)}
                  disabled={isBinding}
                  className={buttonClass({ variant: 'accent', size: 'xs', className: 'shrink-0' })}
                >
                  {isBinding ? (ru ? 'Подключаю…' : 'Connecting…') : ru ? 'Подключить её' : 'Connect it'}
                </button>
              </div>
            ) : (
              <p className="text-[11px] text-slate-400">
                {ru
                  ? 'Папка не подключена. Её выбирают при создании проекта — здесь показано, с какой папкой проект работает.'
                  : 'No folder is connected. It is chosen while the project is created — this screen shows which one the project works in.'}
              </p>
            )}

            {!project.workspaceRoot && onOpenNewProjectModal && (
              <button
                onClick={onOpenNewProjectModal}
                className={buttonClass({ variant: 'secondary', size: 'xs' })}

              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>{ru ? 'Создать проект с папкой' : 'Create a project with a folder'}</span>
              </button>
            )}
          </div>
        )}

      </div>

      {root && (
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 @3xl:grid-cols-12">
          {/* File tree */}
          <div className={`@3xl:col-span-5 space-y-3 ${SECTION}`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                {ru ? 'Файлы в папке' : 'Files in folder'} ({files.length})
              </h3>
              {workspace?.truncated && (
                <span className="text-[10px] text-amber-300">{ru ? 'список обрезан' : 'list truncated'}</span>
              )}
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label={ru ? 'Поиск по имени файла' : 'Search file name'}
                placeholder={ru ? 'Поиск по имени файла…' : 'Search file name…'}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-2 text-xs text-slate-200 focus:border-indigo-600"
              />
            </div>

            <div className="text-[10px] text-slate-400">
              {ru
                ? `Отмечено для контекста ИИ: ${contextPaths.length} (максимум ${MAX_CONTEXT_FILES})`
                : `Checked for AI context: ${contextPaths.length} (max ${MAX_CONTEXT_FILES})`}
            </div>

            <div className="space-y-1 max-h-[460px] overflow-y-auto pr-1">
              {visibleFiles.map((file: WorkspaceFileEntry) => {
                const isOpen = openedFile?.path === file.path;
                const isChecked = checkedPaths.includes(file.path);
                return (
                  <div
                    key={file.path}
                    /* A row is also what a card's AI context can be built from: drag it onto the
                       plan and the path is added there. The hint is the tooltip, not a line in
                       the list. */
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(TASK_FILE_DRAG_TYPE, file.path);
                      event.dataTransfer.setData('text/plain', file.path);
                      event.dataTransfer.effectAllowed = 'copy';
                    }}
                    title={ru ? 'Перетащите на карточку плана' : 'Drag onto a plan card'}
                    className={`p-2 rounded-lg text-xs flex items-center gap-2 transition-colors cursor-grab active:cursor-grabbing ${
                      isOpen
                        ? 'bg-indigo-500/10'
                        : 'hover:bg-slate-950/60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() =>
                        setCheckedPaths((prev) =>
                          prev.includes(file.path)
                            ? prev.filter((p) => p !== file.path)
                            : [...prev, file.path].slice(-MAX_CONTEXT_FILES)
                        )
                      }
                      className="accent-indigo-500 cursor-pointer shrink-0"
                      title={ru ? 'Включить файл в контекст для ИИ' : 'Include this file in the AI context'}
                    />
                    <button
                      onClick={() => handleOpenFile(file.path)}
                      className="flex-1 min-w-0 text-left cursor-pointer"
                      title={file.path}
                    >
                      <div className="flex items-center gap-2">
                        <FileCode className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        <span className="font-mono text-[11px] text-slate-300 truncate">{file.name}</span>
                      </div>
                      {file.dir && <div className="text-[10px] text-slate-400 truncate pl-5">{file.dir}</div>}
                    </button>
                    <span className="text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-bold uppercase shrink-0">
                      {file.type}
                    </span>
                  </div>
                );
              })}
              {visibleFiles.length === 0 && (
                <div className="text-[11px] text-slate-400 px-2 py-6 text-center">
                  {files.length === 0
                    ? ru
                      ? 'В папке нет файлов, которые стоит показывать. Можно сразу сгенерировать код справа.'
                      : 'No files worth showing in this folder. You can generate code on the right anyway.'
                    : ru
                    ? 'Ничего не найдено.'
                    : 'Nothing matched.'}
                </div>
              )}
            </div>
          </div>

          {/* Viewer + AI edits */}
          <div className="@3xl:col-span-7 space-y-5">
            {openedFile && (
              <div className={`space-y-2 ${SECTION}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-white font-mono truncate">{openedFile.path}</h4>
                    <span className="text-[10px] text-slate-400">
                      {formatBytes(openedFile.sizeBytes)}
                      {openedFile.truncated ? (ru ? ' • показан фрагмент' : ' • showing a fragment') : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={handleSaveFile}
                      disabled={isSavingFile || fileDraft === openedFile.content}
                      className={buttonClass({ variant: 'success', size: 'xs' })}
                    >
                      {isSavingFile ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      <span>{ru ? 'Сохранить в файл' : 'Save to file'}</span>
                    </button>
                    <IconButton
                      label={ru ? 'Закрыть файл' : 'Close the file'}
                      icon={X}
                      size="xs"
                      onClick={() => setOpenedFile(null)}
                    />
                  </div>
                </div>
                {isLoadingFile ? (
                  <div className="text-xs text-slate-400 py-6 text-center">
                    {ru ? 'Читаю файл…' : 'Reading the file…'}
                  </div>
                ) : (
                  <textarea
                    value={fileDraft}
                    onChange={(e) => setFileDraft(e.target.value)}
                    spellCheck={false}
                    rows={14}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] font-mono text-slate-200 focus:border-emerald-600 leading-relaxed"
                  />
                )}
              </div>
            )}

            {/* AI edits */}
            <div className={`space-y-3 ${SECTION}`}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <Wand2 className="w-4 h-4 text-indigo-400" />
                    <span>{ru ? 'Сгенерировать изменения' : 'Generate changes'}</span>
                  </h4>
                </div>
              </div>

              <input
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                aria-label={ru ? 'Задача для генерации изменений' : 'Task for generated changes'}
                placeholder={ru ? 'Задача: например «Добавить механику голода»' : 'Task: e.g. "Add a hunger mechanic"'}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:border-indigo-600"
              />
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                aria-label={ru ? 'Уточнения к задаче' : 'Extra instructions'}
                rows={2}
                placeholder={
                  ru
                    ? 'Уточнения (не обязательно): какие файлы менять, какие правила соблюдать…'
                    : 'Extra instructions (optional): which files to change, which rules to follow…'
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:border-indigo-600"
              />

              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className={buttonClass({ variant: 'primary', size: 'md', className: 'w-full' })}
              >
                {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                <span>
                  {isGenerating
                    ? ru
                      ? 'Модель пишет код…'
                      : 'The model is writing code…'
                    : ru
                    ? 'ИИ: сгенерировать изменения файлов'
                    : 'AI: generate file changes'}
                </span>
              </button>

              {changes && (
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  {changeSummary && <p className="text-xs text-slate-300">{changeSummary}</p>}

                  {changeWarnings.length > 0 && (
                    <div className="bg-amber-950/40 border border-amber-800/60 rounded-lg p-3 space-y-1">
                      {changeWarnings.map((warning, index) => (
                        <div key={index} className="text-[11px] text-amber-200 flex items-start gap-2">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>{warning}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {changes.length > 0 && (
                    <div className="space-y-2">
                      {changes.map((change) => {
                        const isSkipped = skippedForApply.includes(change.path);
                        const isExpanded = expandedPath === change.path;
                        const lines = diffLines(change.oldContent || '', change.content || '');
                        const stat = diffStat(lines);
                        const hunks = diffHunks(lines);
                        return (
                          <div
                            key={change.path}
                            className={`bg-slate-950 border rounded-xl ${
                              isSkipped ? 'border-slate-800 opacity-60' : 'border-slate-800'
                            }`}
                          >
                            <div className="flex items-center gap-2 p-2.5">
                              <input
                                type="checkbox"
                                checked={!isSkipped}
                                onChange={() =>
                                  setSkippedForApply((prev) =>
                                    prev.includes(change.path)
                                      ? prev.filter((p) => p !== change.path)
                                      : [...prev, change.path]
                                  )
                                }
                                className="accent-emerald-500 cursor-pointer shrink-0"
                                title={ru ? 'Записать этот файл на диск' : 'Write this file to disk'}
                              />
                              <button
                                onClick={() => setExpandedPath(isExpanded ? null : change.path)}
                                className="flex-1 min-w-0 text-left cursor-pointer"
                              >
                                <div className="flex items-center gap-2">
                                  {isExpanded ? (
                                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  ) : (
                                    <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  )}
                                  <span className="font-mono text-[11px] text-slate-200 truncate">{change.path}</span>
                                </div>
                                {change.reason && (
                                  <div className="text-[10px] text-slate-400 pl-5 truncate">{change.reason}</div>
                                )}
                              </button>
                              <span
                                className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${
                                  change.action === 'delete'
                                    ? 'bg-rose-950 text-rose-300'
                                    : change.action === 'create'
                                    ? 'bg-emerald-950 text-emerald-300'
                                    : 'bg-indigo-950 text-indigo-300'
                                }`}
                              >
                                {change.action === 'create'
                                  ? ru
                                    ? 'создать'
                                    : 'create'
                                  : change.action === 'delete'
                                  ? ru
                                    ? 'удалить'
                                    : 'delete'
                                  : ru
                                  ? 'изменить'
                                  : 'update'}
                              </span>
                              <span className="text-[10px] text-slate-400 shrink-0">
                                +{stat.added} / −{stat.removed}
                              </span>
                            </div>

                            {change.warnings.length > 0 && (
                              <div className="px-3 pb-2 space-y-1">
                                {change.warnings.map((warning, index) => (
                                  <div key={index} className="text-[10px] text-amber-300 flex items-start gap-1.5">
                                    <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                                    <span>{warning}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {isExpanded && (
                              <div className="border-t border-slate-800 max-h-72 overflow-auto">
                                {change.oldTruncated && (
                                  <div className="text-[10px] text-amber-300 px-3 py-1.5">
                                    {ru
                                      ? 'Старый файл показан фрагментом — сравнение только по началу файла.'
                                      : 'The old file is shown as a fragment — the comparison covers only its beginning.'}
                                  </div>
                                )}
                                <pre className="text-[10px] font-mono leading-relaxed p-2">
                                  {hunks.map((line, index) => (
                                    <div
                                      key={index}
                                      className={
                                        line.type === 'add'
                                          ? 'bg-emerald-950/50 text-emerald-200'
                                          : line.type === 'del'
                                          ? 'bg-rose-950/50 text-rose-200'
                                          : 'text-slate-400'
                                      }
                                    >
                                      <span className="inline-block w-8 text-right pr-2 text-slate-400 select-none">
                                        {line.newNumber ?? line.oldNumber ?? ''}
                                      </span>
                                      <span className="select-none mr-1">
                                        {line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}
                                      </span>
                                      {line.text || ' '}
                                    </div>
                                  ))}
                                </pre>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      <label className="flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formatAfterWrite}
                          onChange={(e) => setFormatAfterWrite(e.target.checked)}
                          className="accent-emerald-500 cursor-pointer"
                        />
                        <span>
                          {ru
                            ? 'Привести записанные файлы в порядок (если в папке есть Prettier, Biome или Ruff)'
                            : 'Tidy up the written files (if the folder has Prettier, Biome or Ruff)'}
                        </span>
                      </label>

                      <button
                        onClick={handleApply}
                        disabled={isApplying}
                        className={buttonClass({ variant: 'success', size: 'md', className: 'w-full' })}
                      >
                        {isApplying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        <span>
                          {ru
                            ? `Записать выбранные файлы в папку (${changes.length - skippedForApply.length})`
                            : `Write selected files to the folder (${changes.length - skippedForApply.length})`}
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {applyResult && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-emerald-300">
                      {ru
                        ? `Записано: ${applyResult.applied}${applyResult.failed ? `, ошибок: ${applyResult.failed}` : ''}`
                        : `Written: ${applyResult.applied}${applyResult.failed ? `, failed: ${applyResult.failed}` : ''}`}
                    </span>
                    <button
                      onClick={() => handleUndo(applyResult.backupId)}
                      disabled={isUndoing}
                      className={buttonClass({ variant: 'secondary', size: 'xs' })}
                    >
                      {isUndoing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
                      <span>{ru ? 'Отменить это применение' : 'Undo this apply'}</span>
                    </button>
                  </div>
                  {formattingLine(applyResult.formatting, ru) && (
                    <div className="text-[10px] text-slate-300">
                      {formattingLine(applyResult.formatting, ru)}
                    </div>
                  )}
                  {weightLine(applyResult.weight, ru) && (
                    <div className={`text-[10px] ${applyResult.weight?.heavy ? 'text-amber-300' : 'text-slate-300'}`}>
                      {weightLine(applyResult.weight, ru)}
                    </div>
                  )}
                  {weightDetailLine(applyResult.weight, ru) && (
                    <div className="text-[10px] text-slate-400">{weightDetailLine(applyResult.weight, ru)}</div>
                  )}
                  <div className="space-y-1">
                    {applyResult.results.map((result, index) => (
                      <div key={`${result.path}-${index}`} className="text-[10px] font-mono flex items-center gap-2">
                        <span
                          className={
                            result.status === 'failed'
                              ? 'text-rose-300'
                              : result.status === 'skipped'
                              ? 'text-slate-400'
                              : 'text-emerald-300'
                          }
                        >
                          {result.status}
                        </span>
                        <span className="text-slate-400 truncate">{result.path}</span>
                        {result.error && <span className="text-rose-300 truncate">— {result.error}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(workspace?.backups?.length || 0) > 0 && (
                <div className="pt-2 border-t border-slate-800 space-y-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    {ru ? 'Копии перед записью (для отката)' : 'Backups taken before writing'}
                  </span>
                  {workspace!.backups.slice(0, 3).map((backup) => (
                    <div key={backup.id} className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="text-slate-400 font-mono truncate">
                        {new Date(backup.createdAt).toLocaleString()} • {backup.fileCount}{' '}
                        {ru ? 'файл(ов)' : 'file(s)'}
                      </span>
                      <button
                        onClick={() => handleUndo(backup.id)}
                        disabled={isUndoing}
                        className={buttonClass({ variant: 'ghost', size: 'xs' })}
                      >
                        {ru ? 'Вернуть' : 'Restore'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <VerificationPanel
              ru={ru}
              checks={checks}
              checksLoading={checksLoading}
              verification={verification}
              isVerifying={isVerifying}
              isFixing={isFixing}
              autoVerify={autoVerify}
              fixHint={fixHint}
              budget={weightBudget}
              budgetSaving={budgetSaving}
              budgetHint={budgetHint}
              onToggleAutoVerify={setAutoVerify}
              onVerify={(ids, customCommand) => runChecks(ids, customCommand)}
              onFix={handleFixChecks}
              onSaveBudget={handleSaveBudget}
              onOpenProblem={handleOpenProblem}
            />

            <GitPanel ru={ru} root={root} language={language} refreshToken={gitRefreshKey} />

            <CheckpointTimeline
              ru={ru}
              checkpoints={checkpoints}
              timeline={timeline}
              busy={isHistoryBusy}
              busyId={busyId}
              onCreate={handleCreateCheckpoint}
              onRollback={handleRollback}
              onDelete={handleDeleteCheckpoint}
              onUndoChangeset={handleUndo}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectWorkspace;
