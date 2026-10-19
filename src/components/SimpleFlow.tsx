import React, { useEffect, useMemo, useState } from 'react';
import {
  CompiledPrompt,
  ErrorDiagnosis,
  ProjectFile,
  ProjectState,
  ProjectTask,
  ReviewAttempt,
  SessionReview as ReviewType,
  TaskStatus
} from '../types';
import { useLanguage } from '../context/LanguageContext';
import {
  ApplyChangesResult,
  VerificationResponse,
  WorkspaceState,
  applyFileChangesApi,
  bindWorkspaceApi,
  compilePromptApi,
  diagnoseErrorApi,
  fetchWorkspaceApi,
  reviewSessionApi,
  scanWorkspaceApi,
  undoFileChangesApi,
  writeWorkspaceFileApi
} from '../services/api';
import {
  finishSessionProgress,
  setSessionPhase,
  startSessionProgress,
  useSessionProgress
} from '../services/sessionProgress';
import { toCheckEvidence } from '../utils/checkEvidence';
import { ProjectCheckStrip } from './ProjectCheckStrip';
import { extractFilesFromAgentOutput } from '../utils/fileExtractor';
import { starterFileContent, suggestedStarterPath } from '../utils/starterFile';
import { autonomyOf } from '../utils/workingMode';
import { journeyName, journeySentence } from '../utils/journeySteps';
import { useCopyFlash } from '../utils/copyText';
import { buttonClass } from './ui/Button';
import { HelpHint } from './ui/HelpHint';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  FileCode,
  FilePlus,
  FolderOpen,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  Undo2,
  Wrench
} from 'lucide-react';

interface SimpleFlowProps {
  project: ProjectState | null;
  onSyncProjectFiles?: (files: ProjectFile[], root: string | null) => void;
  onUpdateProjectFiles?: (updatedFiles: Array<{ path: string; content: string }>) => void;
  onUpdateTaskStatus?: (
    taskId: string,
    newStatus: TaskStatus,
    nextAction?: string,
    reviewHistory?: any[],
    progressPercent?: number
  ) => void;
  onOpenNewProjectModal?: () => void;
}

const SIMPLE_AGENTS = ['DeepSeek / Web Chat', 'ChatGPT / API', 'Cursor', 'Claude Code'] as const;

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

type Step = 1 | 2 | 3 | 4;

/**
 * The "beginner" screen: four big steps with one action each and no technical jargon — connect
 * the folder, choose the task, copy the prompt, paste the answer and write the code back.
 *
 * The interface part of the mode is the switch: while a project uses the guided interface the sidebar
 * shows only this screen (extra sections stay one click away under "Show all sections"). The
 * autonomy part travels with every request, because it shapes how the agent talks, not what is on
 * screen — a guided interface running at "Advanced" autonomy is a valid combination.
 */
export const SimpleFlow: React.FC<SimpleFlowProps> = ({
  project,
  onSyncProjectFiles,
  onUpdateProjectFiles,
  onUpdateTaskStatus,
  onOpenNewProjectModal
}) => {
  const { language, t } = useLanguage();
  const s = t.simple;

  const [step, setStep] = useState<Step>(1);
  const [maxStep, setMaxStep] = useState<Step>(1);

  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [isBinding, setIsBinding] = useState(false);
  const [isRescanning, setIsRescanning] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [customTask, setCustomTask] = useState('');
  const [agent, setAgent] = useState<string>(project?.selectedAgent || 'DeepSeek / Web Chat');
  const [isCompiling, setIsCompiling] = useState(false);

  const [compiled, setCompiled] = useState<CompiledPrompt | null>(null);
  const promptCopy = useCopyFlash(2500);

  const [answer, setAnswer] = useState('');
  const [isReviewing, setIsReviewing] = useState(false);
  const [review, setReview] = useState<ReviewType | null>(null);
  //
  // Every check of an answer is one attempt of the same task, and the count is what the reviewer
  // needs to say "the rest is still missing" instead of judging each answer as the first one. It is
  // kept on the task as well, so the loop survives a reload.
  const [attempts, setAttempts] = useState<ReviewAttempt[]>([]);
  const continuationCopy = useCopyFlash(2500);

  //
  // The first file of a project that has none: the name is suggested from the stack and the reader
  // can change it before it is created.
  const [starterPath, setStarterPath] = useState('');
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [createdFile, setCreatedFile] = useState('');

  const [isWriting, setIsWriting] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyChangesResult | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);
  /*
   * The last real check run of this folder. It is what turns the verdict from an opinion about a
   * paste into a statement about the code on disk — and it is why `npm install` and `tsc` no longer
   * appear in the "what still has to be done" list: the app runs them itself and hands the result
   * to the reviewer.
   */
  const [checkReport, setCheckReport] = useState<VerificationResponse | null>(null);
  const [checksRunning, setChecksRunning] = useState(false);
  const session = useSessionProgress();

  const [errorText, setErrorText] = useState('');
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<ErrorDiagnosis | null>(null);
  const fixCopy = useCopyFlash(2500);

  const root = workspace?.root || null;
  const projectFiles = workspace?.files || [];
  /*
   * A project with no file at all is the one case where a prompt cannot work: the agent is asked to
   * change code that does not exist yet, answers "send me the files", and every attempt after that
   * reviews the same nothing. The guard only speaks once the folder has actually been read, so a
   * slow or failed scan never blocks a project that may well have files.
   */
  const filesKnown = workspace !== null;
  const noFilesYet = filesKnown && projectFiles.length === 0;
  const starterSuggestion = useMemo(
    () => suggestedStarterPath(project),
    [project?.projectType, project?.engineOrFramework, project?.language]
  );

  useEffect(() => {
    setAgent(project?.selectedAgent || 'DeepSeek / Web Chat');
  }, [project?.id]);

  // Leaving the screen ends the run as far as the workspace is concerned: an indicator that keeps
  // blinking after the work is over is worse than no indicator at all.
  useEffect(() => finishSessionProgress, []);

  // The folder lives on the server, so the screen restores itself on every visit — and again
  // when another project is picked, because a new project may come with its own folder.
  useEffect(() => {
    let cancelled = false;
    fetchWorkspaceApi(language)
      .then((state) => {
        if (cancelled) return;
        setWorkspace(state);
        // A folder is already connected: there is nothing to do on step 1.
        if (state.root) {
          setStep((prev) => (prev === 1 ? 2 : prev));
          setMaxStep((prev) => (prev < 2 ? 2 : prev));
        }
      })
      .catch(() => {
        /* The screen simply starts disconnected. */
      });
    return () => {
      cancelled = true;
    };
  }, [language, project?.id]);

  useEffect(() => {
    const all = project?.phases?.flatMap((phase) => phase.tasks) || [];
    setTasks(all);
    if (!all.length) return;
    setSelectedTaskId((prev) => {
      if (prev && all.some((task) => task.id === prev)) return prev;
      const active =
        all.find((task) => task.status === 'in_progress' || task.status === 'partial') ||
        all.find((task) => task.status === 'ready') ||
        all[0];
      return active?.id || '';
    });
  }, [project?.id, project?.phases]);

  const activeTask = tasks.find((task) => task.id === selectedTaskId) || null;
  const taskTitle = customTask.trim() || activeTask?.title || '';

  const extractedFiles = useMemo(
    () => extractFilesFromAgentOutput(answer, activeTask?.relevantFiles?.[0] || 'src/App.tsx'),
    [answer, activeTask?.relevantFiles]
  );

  /*
   * The attempts of the task in hand. Another task is another loop, so the count restarts with it;
   * the length is the dependency rather than the array, because the parent hands back a new array
   * on every write and that would loop.
   */
  useEffect(() => {
    setAttempts((activeTask?.reviewHistory as ReviewAttempt[] | undefined) || []);
  }, [activeTask?.id, activeTask?.reviewHistory?.length]);

  const goToStep = (next: Step) => {
    setStep(next);
    setMaxStep((prev) => (next > prev ? next : prev));
  };

  /* ------------------------------- step 1: folder ------------------------------- */

  const syncFilesToProject = (state: WorkspaceState) => {
    if (!onSyncProjectFiles || !state.root) return;
    onSyncProjectFiles(
      state.files.map((file) => ({
        path: file.path,
        type: file.type,
        description: `${file.dir || '.'} • ${formatBytes(file.sizeBytes)}`,
        sizeBytes: file.sizeBytes
      })),
      state.root
    );
  };

  /**
   * Reconnects the folder this project was created with — the only thing step 1 can still do here.
   *
   * Choosing a folder is the creation wizard's job (see ProjectSetup); a beginner who reaches this
   * step with a project whose folder is not connected gets that folder back, not a second folder to
   * choose from.
   */
  const handleBind = async (pathToBind: string) => {
    const value = pathToBind.trim();
    if (!value || isBinding) return;
    setIsBinding(true);
    setErrorMsg('');
    try {
      const state = await bindWorkspaceApi({ path: value, language });
      setWorkspace(state);
      syncFilesToProject(state);
      goToStep(2);
    } catch (err: any) {
      setErrorMsg(err?.userMessage || err?.message || (language === 'ru' ? 'Не удалось подключить папку.' : 'Could not connect the folder.'));
    } finally {
      setIsBinding(false);
    }
  };

  /**
   * Creates the one file the agent can be pointed at. The comment carries the task, so the file is
   * a start rather than an empty accident, and the folder is re-read so the helper stops asking for
   * a file that now exists.
   */
  const handleCreateStarterFile = async () => {
    if (!root || isCreatingFile) return;
    const value = (starterPath.trim() || starterSuggestion).replace(/^[\\/]+/, '').trim();
    if (!value) return;
    if (projectFiles.some((file) => file.path.toLowerCase() === value.toLowerCase())) {
      setErrorMsg(
        language === 'ru' ? 'Такой файл уже есть — выберите другое имя.' : 'That file already exists — pick another name.'
      );
      return;
    }
    setIsCreatingFile(true);
    setErrorMsg('');
    try {
      await writeWorkspaceFileApi({ path: value, content: starterFileContent(value, taskTitle, language === 'ru') });
      const state = await scanWorkspaceApi();
      setWorkspace(state);
      setStarterPath('');
      // The confirmation is about the write, so it is set before the project map is synced: a sync
      // problem must not read as "the file was not created".
      setCreatedFile(value);
      syncFilesToProject(state);
    } catch (err: any) {
      setErrorMsg(err?.userMessage || err?.message || (language === 'ru' ? 'Не удалось создать файл.' : 'Could not create the file.'));
    } finally {
      setIsCreatingFile(false);
    }
  };

  const handleRescan = async () => {
    if (isRescanning) return;
    setIsRescanning(true);
    try {
      const state = await scanWorkspaceApi();
      setWorkspace(state);
      syncFilesToProject(state);
    } catch (err: any) {
      setErrorMsg(err?.userMessage || err?.message || 'Scan failed');
    } finally {
      setIsRescanning(false);
    }
  };

  /* -------------------------------- step 2: task -------------------------------- */

  const handleCompile = async () => {
    if (!project || !taskTitle.trim() || isCompiling || noFilesYet) return;
    setIsCompiling(true);
    setErrorMsg('');
    try {
      const result = await compilePromptApi({
        userRequest: taskTitle.trim(),
        taskTitle: taskTitle.trim(),
        projectMap: project.projectMap,
        brief: project.brief,
        agent,
        contextMode: 'Balanced',
        // The autonomy part shapes how the agent talks — never how strict the result has to be.
        skillLevel: autonomyOf(project),
        language
      });
      setCompiled(result);
      // A new prompt is a new thing to copy: the previous answer must not stand over it.
      promptCopy.reset();
      goToStep(3);
    } catch (err: any) {
      setErrorMsg(err?.userMessage || err?.message || (language === 'ru' ? 'Не удалось собрать промпт.' : 'Could not build the prompt.'));
    } finally {
      setIsCompiling(false);
    }
  };

  const handleCopyPrompt = async () => {
    if (!compiled) return;
    await promptCopy.copy(compiled.promptText);
  };

  /* ---------------------------- step 4: check + write --------------------------- */

  const reviewTask: ProjectTask | null = useMemo(() => {
    if (activeTask) return activeTask;
    if (!project || !taskTitle.trim()) return null;
    return {
      id: 'simple-custom-task',
      phaseId: 'simple',
      title: taskTitle.trim(),
      goal: taskTitle.trim(),
      status: 'ready',
      relevantFiles: (project.projectMap?.files || []).slice(0, 2).map((file) => file.path),
      acceptanceCriteria: [
        {
          id: 'simple-ac-1',
          description:
            language === 'ru' ? 'Код добавляет запрошенную функцию' : 'The code adds the requested feature',
          passed: false
        }
      ],
      testRequirements: [],
      estimatedComplexity: 'Small (1 prompt)',
      dependencies: [],
      progressPercent: 0
    };
  }, [activeTask, project, taskTitle, language]);

  const handleReview = async () => {
    if (!project || !reviewTask || !answer.trim() || isReviewing) return;
    setIsReviewing(true);
    setErrorMsg('');
    setApplyResult(null);
    // The run is open to the rest of the workspace for as long as it takes: the sidebar says which
    // task is being judged and how many attempts it has had.
    startSessionProgress({
      taskId: reviewTask.id,
      taskTitle: reviewTask.title,
      attempt: attempts.length + 1,
      phase: 'reviewing'
    });
    try {
      const result = await reviewSessionApi({
        agentOutput: answer,
        task: reviewTask,
        projectMap: project.projectMap,
        // The commands the app ran in this folder, with their real output. The reviewer is told not
        // to ask for them again, and a failed check cannot be reported as a finished task.
        checkEvidence: checkReport ? toCheckEvidence(checkReport, language === 'ru') : null,
        // The attempt being judged, and the ones before it: without them the reviewer cannot tell a
        // first try from a fifth, and its own continuation prompt is written for the wrong attempt.
        stepNumber: attempts.length + 1,
        previousHistory: attempts,
        // Step 4 is where the beginner reads the verdict, so its wording follows the mode too.
        skillLevel: autonomyOf(project),
        language
      });
      setReview(result);
      continuationCopy.reset();

      const attempt: ReviewAttempt = {
        id: `attempt_${Date.now()}`,
        attemptNumber: attempts.length + 1,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        agentOutput: answer.trim(),
        review: result
      };
      const updated = [...attempts, attempt];
      setAttempts(updated);
      // The attempt is written to the task along with its verdict, so the plan shows that this task
      // is under way and the next visit to this screen carries on from the right attempt number.
      if (reviewTask) {
        const finished = result.status === 'Completed' || result.progressPercent >= 100;
        onUpdateTaskStatus?.(
          reviewTask.id,
          finished ? 'completed' : 'partial',
          result.nextBestAction,
          updated,
          result.progressPercent
        );
      }
    } catch (err: any) {
      setErrorMsg(err?.userMessage || err?.message || (language === 'ru' ? 'Не удалось проверить ответ.' : 'Could not check the answer.'));
    } finally {
      setIsReviewing(false);
      finishSessionProgress();
    }
  };

  const handleWriteFiles = async () => {
    if (!extractedFiles.length || isWriting) return;
    setIsWriting(true);
    setErrorMsg('');
    startSessionProgress({
      taskId: reviewTask?.id || null,
      taskTitle: reviewTask?.title || taskTitle,
      attempt: Math.max(1, attempts.length + 1),
      phase: 'writing'
    });
    try {
      if (onUpdateProjectFiles) onUpdateProjectFiles(extractedFiles);
      const result = await applyFileChangesApi(
        extractedFiles.map((file) => ({ path: file.path, action: 'update', content: file.content }))
      );
      setApplyResult(result);
    } catch (err: any) {
      setErrorMsg(err?.userMessage || err?.message || (language === 'ru' ? 'Не удалось записать файлы.' : 'Could not write the files.'));
    } finally {
      setIsWriting(false);
      finishSessionProgress();
    }
  };

  const handleUndoWrite = async () => {
    if (!applyResult || isUndoing) return;
    setIsUndoing(true);
    try {
      await undoFileChangesApi(applyResult.backupId);
      setApplyResult(null);
      if (onSyncProjectFiles) await handleRescan();
    } catch (err: any) {
      setErrorMsg(err?.userMessage || err?.message || (language === 'ru' ? 'Не удалось отменить запись.' : 'Could not undo the write.'));
    } finally {
      setIsUndoing(false);
    }
  };

  /**
   * What stands between the task and "done".
   *
   * The button used to close a task at 0%, in front of a failing build, which made both the verdict
   * and the check strip beside it look like decoration. A task is closed by what was measured: the
   * reviewer's verdict has to be a pass, and the folder's own checks have to pass with it. Each
   * reason is named, because "not allowed" without a cause is just a broken button.
   */
  /*
   * Only checks that actually failed (or ran out of time) block the task. The report's own `ok` is
   * false when a check was skipped too, and a skipped check is exactly the kind that proved nothing —
   * blocking on it would stop a task over a check nobody could run, under the wrong reason.
   */
  const failingChecks = (checkReport?.results || []).filter(
    (result) => result.status === 'failed' || result.status === 'timeout'
  );
  const checksBlockDone = failingChecks.length > 0;

  const markDoneBlockers: string[] = [];
  if (!review) {
    markDoneBlockers.push(s.markDoneNeedsVerdict);
  } else if (review.progressPercent < 100 && review.status !== 'Completed') {
    markDoneBlockers.push(s.markDoneNeedsProgress);
  }
  if (checksBlockDone) {
    const names = failingChecks
      .map((result) => (language === 'ru' ? result.labelRu : result.labelEn))
      .filter(Boolean);
    markDoneBlockers.push(names.length ? `${s.markDoneNeedsChecks} ${names.join(' · ')}` : s.markDoneNeedsChecksNoName);
  }

  const handleMarkDone = () => {
    if (!reviewTask || !onUpdateTaskStatus) return;
    // The button is off in this state; the action refuses it too, so a stray Enter cannot close a
    // task the screen says is still open.
    if (markDoneBlockers.length > 0) return;
    onUpdateTaskStatus(reviewTask.id, 'completed', review?.nextBestAction, attempts, 100);
  };

  /**
   * The prompt for the next attempt, written by the reviewer from what the answer left undone.
   *
   * It is the step the whole loop hangs on: the verdict says what is missing, and this is the same
   * thing said as an instruction the agent can act on. Without it the only way forward was to build
   * the prompt again from the task title, which throws the missing list away and starts the user's
   * memory doing the work the app had already done.
   */
  const handleCopyContinuation = async () => {
    const text = review?.continuationPrompt || '';
    if (!text.trim()) return;
    await continuationCopy.copy(text);
  };

  const handleDiagnose = async () => {
    if (!errorText.trim() || isDiagnosing) return;
    setIsDiagnosing(true);
    setErrorMsg('');
    try {
      const result = await diagnoseErrorApi({
        errorText: errorText.trim(),
        projectType: project?.projectType,
        framework: project?.engineOrFramework,
        skillLevel: autonomyOf(project),
        language
      });
      setDiagnosis(result);
    } catch (err: any) {
      setErrorMsg(err?.userMessage || err?.message || (language === 'ru' ? 'Не удалось разобрать ошибку.' : 'Could not work out the error.'));
    } finally {
      setIsDiagnosing(false);
    }
  };

  const handleCopyFix = async () => {
    if (!diagnosis) return;
    await fixCopy.copy(diagnosis.repairPrompt);
  };

  /* ---------------------------------- render ---------------------------------- */

  if (!project) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 short:p-5 text-center space-y-4 max-w-lg mx-auto my-12 short:my-2">
        <div className="w-12 h-12 rounded-2xl bg-indigo-950 text-indigo-400 border border-indigo-800 flex items-center justify-center mx-auto">
          <Sparkles className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-white">{s.noProject}</h3>
        <p className="text-xs text-slate-400">{s.noProjectHelp}</p>
        {onOpenNewProjectModal && (
          <button
            onClick={onOpenNewProjectModal}
            className={buttonClass({ variant: 'primary', size: 'md' })}
          >
            <Sparkles className="w-4 h-4" />
            <span>{s.createProject}</span>
          </button>
        )}
      </div>
    );
  }

  /**
   * The helper's four screens are the journey's four steps, numbered by the shared module
   * (`utils/journeySteps.ts`) so the workspace loop — which shows steps 3 and 4 in depth — carries
   * on with the same count. Switching interfaces resumes where the reader was instead of dropping
   * back to 1.
   */
  const stepLabels: Record<Step, string> = {
    1: journeyName('folder', t),
    2: journeyName('task', t),
    3: journeyName('prompt', t),
    4: journeyName('check', t)
  };

  /**
   * Said instead of the prompt when there is nothing to put in it.
   *
   * The two remedials are the only two honest ones: point the project at a folder that has code,
   * or create the single file the agent can fill on its first attempt. Both are on the card, because
   * a warning that only explains the problem leaves the reader to invent the way out.
   */
  const noFilesCard = (
    <div data-no-files className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 space-y-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
        <div className="space-y-1">
          <p className="text-sm font-bold text-amber-200">{s.noFilesTitle}</p>
          <p className="text-[11px] text-amber-100/80 leading-relaxed">{s.noFilesHint}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setStep(1)}
          className={buttonClass({ variant: 'secondary', size: 'sm' })}
        >
          <FolderOpen className="w-4 h-4" />
          <span>{s.noFilesConnect}</span>
        </button>
      </div>

      {root && (
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-amber-200">{s.noFilesCreateLabel}</label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={starterPath}
              onChange={(event) => setStarterPath(event.target.value)}
              placeholder={starterSuggestion}
              aria-label={s.noFilesCreateLabel}
              className="flex-1 min-w-[11rem] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs font-mono text-slate-100 focus:border-amber-600 placeholder:text-slate-500"
            />
            <button
              onClick={handleCreateStarterFile}
              disabled={isCreatingFile}
              className={buttonClass({ variant: 'warning', size: 'sm' })}
            >
              {isCreatingFile ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePlus className="w-4 h-4" />}
              <span>{isCreatingFile ? s.noFilesCreating : s.noFilesCreate}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const verdict = review
    ? review.progressPercent >= 100 || review.status === 'Completed'
      ? { label: s.verdictReady, emoji: '✅', tone: 'emerald' as const }
      : review.progressPercent >= 40
      ? { label: s.verdictPartial, emoji: '⚠️', tone: 'amber' as const }
      : { label: s.verdictFailed, emoji: '❌', tone: 'rose' as const }
    : null;

  return (
    <div className="space-y-6 short:space-y-3 max-w-3xl mx-auto">
      {/*
        The stepper, without the title block above it.

        The name of the helper is already on the sidebar entry and in the app's own name, so the
        heading, its eyebrow and the sentence describing the four steps only pushed the step the
        reader is on further down the screen. The heading stays for screen readers, which navigate
        the app by headings.
      */}
      {/* No panel around the stepper: the four steps are a control row, and the plan screen's row
          of controls sits on the page the same way. */}
      <div>
        <h2 className="sr-only">{s.title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {([1, 2, 3, 4] as Step[]).map((value) => {
            const isActive = step === value;
            const isDone = maxStep > value;
            const canOpen = value <= maxStep;
            return (
              <button
                key={value}
                onClick={() => canOpen && setStep(value)}
                disabled={!canOpen}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-all inline-flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-indigo-600 shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(2_6_23/0.55)] border-indigo-500 text-white'
                    : canOpen
                    ? 'bg-slate-800 border-slate-700 text-slate-200 enabled:cursor-pointer enabled:hover:bg-slate-700'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${isActive ? 'bg-white/20' : isDone ? 'bg-emerald-500/30 text-emerald-300' : 'bg-slate-800'}`}>
                  {isDone ? '✓' : value}
                </span>
                <span>{stepLabels[value]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/*
        The run, said out loud.

        The sidebar carries a quiet version of this (a pulsing dot and the attempt number on the
        entry that leads here), but a reader who is on this screen wants the sentence: which task,
        which attempt, and what the app is doing with it right now. It appears while the answer is
        being judged and disappears the moment the verdict does.
      */}
      {session.active && (
        <div
          data-session-banner
          className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3.5 py-2.5 text-[11px] text-emerald-200"
        >
          <span className="relative flex w-2 h-2 items-center justify-center shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
            <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-emerald-400" />
          </span>
          <span className="font-bold">{s.sessionRunning}</span>
          <span className="text-emerald-300/80">
            • {s.attemptLabel} {session.attempt}
          </span>
          {session.phase === 'writing' && <span className="text-emerald-300/80">• {s.sessionPhaseWriting}</span>}
          {session.phase === 'reviewing' && <span className="text-emerald-300/80">• {s.sessionPhaseReviewing}</span>}
          {session.taskTitle && <span className="text-emerald-200/70 truncate">• {session.taskTitle}</span>}
        </div>
      )}

      {errorMsg && (
        <div className="bg-rose-500/10 rounded-xl px-4 py-3 text-xs text-rose-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* -------------------------------- STEP 1 -------------------------------- */}
      {step === 1 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 short:p-4 space-y-4">
          <div>
            <h3 className="text-base font-bold text-white">{journeySentence('folder', t, s.folderTitle)}</h3>
            <p className="text-xs text-slate-400 mt-1">{s.folderHelp}</p>
          </div>

          {root ? (
            /*
              The folder, stated rather than offered: which one it is, how much is in it, and
              nothing to choose. It was chosen while the project was created (ProjectSetup) — that
              is the one screen that knows which folder a new project is going to work in, and the
              only one that asks.
            */
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="text-sm font-medium text-slate-200">{s.folderConnected}</span>
                <span className="text-xs text-slate-400">
                  {s.filesCountLabel}{' '}
                  <span className="tabular-nums text-slate-300">{projectFiles.length}</span>
                </span>
                <HelpHint
                  text={
                    language === 'ru'
                      ? 'Приложение никогда не читает .env и ключи, а перед записью сохраняет копию — изменения можно отменить.'
                      : 'The app never reads .env files or keys, and keeps a copy before writing — any change can be undone.'
                  }
                />
              </div>
              {/* The whole path is in the tooltip: a long one must not stretch the card. */}
              <p className="text-xs font-mono text-slate-400 truncate" title={root}>
                {root}
              </p>
              {/* The folder saved on the project card is one click away — the project's own folder,
                  not a chooser: the server may hold a different one after a restart. */}
              {project?.workspaceRoot && project.workspaceRoot !== root && (
                <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-2 pt-1">
                  <span>
                    {s.savedFolderHint}{' '}
                    <span className="font-mono text-slate-300 break-all">{project.workspaceRoot}</span>
                  </span>
                  <button
                    onClick={() => handleBind(project.workspaceRoot)}
                    disabled={isBinding}
                    className="text-indigo-300 enabled:hover:text-indigo-200 disabled:opacity-50 font-medium enabled:cursor-pointer"
                  >
                    {s.connectSavedFolder}
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* No folder to read: the answer is not a picker here, it is the wizard that asks. */
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
              <p className="flex items-start gap-1.5 text-xs font-semibold text-amber-300">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{s.noFolderHint}</span>
              </p>
              {onOpenNewProjectModal && (
                <button                  onClick={onOpenNewProjectModal}
                className={buttonClass({ variant: 'secondary', size: 'sm', className: 'w-full' })}
                >
                  <FolderOpen className="w-4 h-4" />
                  <span>{s.createProjectWithFolder}</span>
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {root && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                onClick={handleRescan}
                disabled={isRescanning}
                className={buttonClass({ variant: 'secondary', size: 'sm' })}
                >
                  {isRescanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  <span>{s.refreshFiles}</span>
                </button>
              </div>
            )}
            <button
              onClick={() => goToStep(2)}
              disabled={!root}
              className={buttonClass({ variant: 'primary', size: 'md', className: 'ml-auto' })}
            >
              <span>{s.next}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------- STEP 2 -------------------------------- */}
      {step === 2 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div>
            <h3 className="text-base font-bold text-white">{journeySentence('task', t, s.taskTitle)}</h3>
            <p className="text-xs text-slate-400 mt-1">{s.taskHelp}</p>
          </div>

          {/* No prompt can be written for a folder with no files in it, so the blocker is said
              before the task is picked rather than after the button refuses to work. */}
          {noFilesYet
            ? noFilesCard
            : createdFile && (
                <p data-file-created className="text-[11px] text-emerald-300">
                  {s.noFilesCreated} <span className="font-mono text-emerald-200">{createdFile}</span>
                </p>
              )}

          {tasks.length > 0 && (
            <div className="divide-y divide-slate-800/80 -mx-2">
              {tasks.slice(0, 8).map((task) => {
                const isSelected = selectedTaskId === task.id && !customTask.trim();
                return (
                  <button
                    key={task.id}
                    onClick={() => {
                      setSelectedTaskId(task.id);
                      setCustomTask('');
                    }}
                    className={`w-full text-left px-2 py-2.5 transition-colors cursor-pointer ${
                      isSelected ? 'bg-indigo-500/10' : 'hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${isSelected ? 'border-indigo-400 bg-indigo-500/30' : 'border-slate-600'}`}>
                        {isSelected && <Check className="w-3 h-3 text-indigo-200" />}
                      </span>
                      <span className="text-sm font-bold text-slate-100">{task.title}</span>
                    </div>
                    {task.goal && <p className="text-[11px] text-slate-400 mt-1 pl-6">{task.goal}</p>}
                  </button>
                );
              })}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300">{s.otherTask}</label>
            <textarea
              value={customTask}
              onChange={(e) => setCustomTask(e.target.value)}
              rows={2}
              placeholder={s.otherTaskPlaceholder}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-100 focus:border-indigo-600 placeholder:text-slate-400"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300">{s.agentLabel}</label>
            <select
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-200 focus:border-indigo-600 cursor-pointer"
            >
              {SIMPLE_AGENTS.map((value) => (
                <option key={value} value={value}>
                  {value === 'DeepSeek / Web Chat' && language === 'ru' ? 'DeepSeek / Веб-чат' : value}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              onClick={() => setStep(1)}
              className={buttonClass({ variant: 'ghost', size: 'sm' })}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{s.back}</span>
            </button>
            <button
              onClick={handleCompile}
              disabled={!taskTitle.trim() || isCompiling || noFilesYet}
              title={noFilesYet ? s.noFilesTitle : undefined}
              className={buttonClass({ variant: 'primary', size: 'md' })}
            >
              {isCompiling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span>{isCompiling ? (language === 'ru' ? 'Собираем промпт…' : 'Building the prompt…') : s.compileButton}</span>
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------- STEP 3 -------------------------------- */}
      {step === 3 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div>
            <h3 className="text-base font-bold text-white">{journeySentence('prompt', t, s.promptTitle)}</h3>
            <p className="text-xs text-slate-400 mt-1">{s.promptHelp}</p>
          </div>

          {/* The same blocker as step 2: a prompt shown over an empty folder would still be a
              prompt the agent cannot act on, so the screen says that instead of offering a copy. */}
          {noFilesYet ? (
            noFilesCard
          ) : (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 max-h-80 overflow-auto">
              <pre className="text-[11px] font-mono text-slate-200 whitespace-pre-wrap leading-relaxed">
                {compiled?.promptText || ''}
              </pre>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleCopyPrompt}
              disabled={!compiled || noFilesYet}
              className={buttonClass({ variant: 'success', size: 'md' })}
            >
              {promptCopy.state === 'copied' ? (
                <Check className="w-4 h-4" />
              ) : promptCopy.state === 'failed' ? (
                <AlertTriangle className="w-4 h-4" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
              <span>
                {promptCopy.state === 'copied' ? s.promptCopied : promptCopy.state === 'failed' ? t.common.copyFailed : s.copyPrompt}
              </span>
            </button>
            <button
              onClick={() => setStep(2)}
              className={buttonClass({ variant: 'ghost', size: 'sm' })}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{s.back}</span>
            </button>
            <button
              onClick={() => goToStep(4)}
              disabled={noFilesYet}
              className={buttonClass({ variant: 'primary', size: 'md', className: 'ml-auto' })}
            >
              <span>{s.readyButton}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------- STEP 4 -------------------------------- */}
      {step === 4 && (
        <div className="space-y-5">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div>
              <h3 className="text-base font-bold text-white">{journeySentence('check', t, s.answerTitle)}</h3>
              <p className="text-xs text-slate-400 mt-1">{s.answerHelp}</p>
            </div>

            {/*
              The answer field holds an answer, so an empty one is a short field, not a page: four
              rows say "this is where the answer goes", and the field grows once there is something
              in it. (Reading the clipboard is deliberately impossible in the desktop shell, so
              there is no paste button here — a control that can only fail is worse than none.)
            */}
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={answer.trim() ? 12 : 4}
              aria-label={s.answerTitle}
              placeholder={s.answerPlaceholder}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-3 text-xs font-mono text-slate-100 focus:border-emerald-600 placeholder:text-slate-400"
            />

            {extractedFiles.length > 0 && (
              <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-2">
                <FileCode className="w-3.5 h-3.5 text-indigo-400" />
                <span>{s.filesDetected}</span>
                {extractedFiles.map((file) => (
                  <span key={file.path} className="font-mono bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-slate-300">
                    {file.path}
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                onClick={() => setStep(3)}
                className={buttonClass({ variant: 'ghost', size: 'sm' })}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{s.back}</span>
              </button>
              {/*
               * The code goes on disk before it is judged, not after. The write used to live only
               * inside the verdict card, so the plain order of this screen was "paste, judge, then
               * write" — and the reviewer had nothing measured to judge against.
               */}
              <div className="flex flex-wrap items-center gap-2 ml-auto">
                {extractedFiles.length > 0 && (
                  <button
                    onClick={handleWriteFiles}
                    disabled={isWriting}
                    data-write-files
                    className={buttonClass({ variant: 'secondary', size: 'md' })}
                  >
                    {isWriting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    <span>{s.writeFiles}</span>
                  </button>
                )}
                <button
                  onClick={handleReview}
                  disabled={!answer.trim() || isReviewing}
                  className={buttonClass({ variant: 'success', size: 'md' })}
                >
                  {isReviewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  <span>{isReviewing ? s.checking : s.checkButton}</span>
                </button>
              </div>
            </div>

            {/* Honest about the one thing that can make a verdict thinner: a check run that has
                not answered yet, so the reviewer has no measured facts to judge with. */}
            {checksRunning && !isReviewing && (
              <p data-checks-pending className="text-[11px] text-indigo-300">
                {language === 'ru'
                  ? 'Проверки проекта ещё идут: ответ можно проверить и сейчас, но вывод будет без их результатов.'
                  : 'The project checks are still running: you can review the answer now, but the verdict will not include them.'}
              </p>
            )}
          </div>

          <ProjectCheckStrip
            root={root}
            autoRunKey={applyResult?.backupId ?? null}
            onReport={setCheckReport}
            onRunningChange={setChecksRunning}
          />

          {review && verdict && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{verdict.emoji}</span>
                <div>
                  <h3 className="text-lg font-bold text-white">{verdict.label}</h3>
                  <span className="text-xs text-slate-400">
                    {language === 'ru' ? 'Готовность задачи' : 'Task progress'}: {review.progressPercent}%
                    {attempts.length > 0 && (
                      <>
                        {' • '}
                        {s.attemptLabel} {attempts.length}
                      </>
                    )}
                  </span>
                </div>
              </div>

              {review.agentOutputSummary && (
                <p className="text-sm text-slate-200 bg-slate-950 border border-slate-800 rounded-xl p-3 leading-relaxed">
                  {review.agentOutputSummary}
                </p>
              )}

              {review.missingCriteria.length > 0 && (
                <div className="space-y-1">
                  <span className="text-xs font-bold text-amber-300">{s.missingTitle}</span>
                  <ul className="text-xs text-amber-200 space-y-1">
                    {review.missingCriteria.map((item, index) => (
                      <li key={index} className="flex gap-1.5">
                        <span>•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {review.nextBestAction && (
                <div className="bg-indigo-950/70 border border-indigo-800 rounded-xl p-3 space-y-1">
                  <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider">{s.nextActionTitle}</span>
                  <p className="text-sm font-semibold text-white">{review.nextBestAction}</p>
                </div>
              )}

              {/*
               * The next step of the loop, ready to paste. The reviewer wrote this text for exactly
               * the criteria the check above found missing, so copying it is the whole of the user's
               * part here — no rewriting the task into a new prompt, and nothing to remember.
               */}
              {review.progressPercent < 100 && (review.continuationPrompt || '').trim() !== '' && (
                <div className="bg-slate-950 border border-indigo-800 rounded-xl p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider">
                      {s.continuationTitle} • {s.attemptLabel} {attempts.length + 1}
                    </span>
                    <button
                      onClick={handleCopyContinuation}
                      className={buttonClass({ variant: 'primary', size: 'sm' })}
                    >
                      {continuationCopy.state === 'copied' ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : continuationCopy.state === 'failed' ? (
                        <AlertTriangle className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {continuationCopy.state === 'copied'
                          ? s.continuationCopied
                          : continuationCopy.state === 'failed'
                          ? t.common.copyFailed
                          : s.copyContinuation}
                      </span>
                    </button>
                  </div>
                  <pre className="max-h-56 overflow-auto text-[11px] font-mono text-slate-200 whitespace-pre-wrap leading-relaxed">
                    {review.continuationPrompt}
                  </pre>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {/*
                 * No second "write the code" button here.
                 *
                 * It used to live only in this card, which read as "judge first, write later" — and
                 * the reviewer had nothing on disk to judge against. The write now happens in the
                 * card above, before the check, and this one stays the place that reports what was
                 * written and takes it back.
                 */}
                {reviewTask && onUpdateTaskStatus && (
                  <button
                    onClick={handleMarkDone}
                    disabled={markDoneBlockers.length > 0}
                    data-mark-done
                    title={markDoneBlockers.length > 0 ? s.markDoneBlocked : undefined}
                    className={buttonClass({ variant: 'secondary', size: 'md' })}
                  >
                    <CheckCircle2 className={`w-4 h-4 ${markDoneBlockers.length > 0 ? 'text-slate-400' : 'text-emerald-400'}`} />
                    <span>{s.markDone}</span>
                  </button>
                )}
                {/* Starting the task over is not the same as continuing it: the prompt is written
                    from the task itself again, and the attempts already made stay on the task. */}
                <button
                  onClick={() => {
                    setReview(null);
                    setAnswer('');
                    continuationCopy.reset();
                    setStep(2);
                  }}
                  className={buttonClass({ variant: 'ghost', size: 'sm' })}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{s.restartPrompt}</span>
                </button>
              </div>

              {reviewTask && onUpdateTaskStatus && markDoneBlockers.length > 0 && (
                <div
                  data-mark-done-blocked
                  className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-1"
                >
                  <span className="text-[10px] font-bold text-amber-300 uppercase tracking-wider">
                    {s.markDoneBlocked}
                  </span>
                  <ul className="text-[11px] text-amber-100/80 space-y-1">
                    {markDoneBlockers.map((reason) => (
                      <li key={reason} className="flex gap-1.5">
                        <span>•</span>
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {applyResult && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-emerald-300">
                      {s.writtenFiles} {applyResult.applied}
                    </span>
                    <button
                      onClick={handleUndoWrite}
                      disabled={isUndoing}
                      className={buttonClass({ variant: 'secondary', size: 'xs' })}
                    >
                      {isUndoing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
                      <span>{s.undoWrite}</span>
                    </button>
                  </div>
                  {applyResult.results.map((result, index) => (
                    <div key={`${result.path}-${index}`} className="text-[10px] font-mono flex items-center gap-2">
                      <span className={result.status === 'failed' ? 'text-rose-300' : 'text-emerald-300'}>{result.status}</span>
                      <span className="text-slate-400 truncate">{result.path}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Plain-language help with an error */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Wrench className="w-4 h-4 text-amber-400" />
              <span>{s.errorHelpTitle}</span>
            </h3>

            <textarea
              value={errorText}
              onChange={(e) => setErrorText(e.target.value)}
              rows={3}
              placeholder={s.errorHelpPlaceholder}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs font-mono text-slate-100 focus:border-amber-600 placeholder:text-slate-400"
            />

            <button
              onClick={handleDiagnose}
              disabled={!errorText.trim() || isDiagnosing}
              className={buttonClass({ variant: 'warning', size: 'sm' })}
            >
              {isDiagnosing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
              <span>{isDiagnosing ? s.explaining : s.explainError}</span>
            </button>

            {diagnosis && (
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-3">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-amber-300 uppercase tracking-wider">{s.simpleExplanation}</span>
                  <p className="text-sm text-slate-100 leading-relaxed">{diagnosis.explanations?.verySimple}</p>
                </div>
                {diagnosis.verificationSteps?.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{s.repairStepsTitle}</span>
                    <ol className="text-xs text-slate-200 space-y-1 list-decimal pl-4">
                      {diagnosis.verificationSteps.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ol>
                  </div>
                )}
                <button
                  onClick={handleCopyFix}
                  className={buttonClass({ variant: 'secondary', size: 'xs' })}
                >
                  {fixCopy.state === 'copied' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : fixCopy.state === 'failed' ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{fixCopy.state === 'failed' ? t.common.copyFailed : s.copyFix}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SimpleFlow;
