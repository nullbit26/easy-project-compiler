import React, { useState, useEffect, useRef } from 'react';
import { ProjectState, ProjectTask, SessionReview as ReviewType, ReviewAttempt } from '../types';
import { reviewSessionApi } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  Loader2,
  Sparkles,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  History,
  CornerDownRight,
  Zap,
  RotateCcw,
  Play,
  FileCode
} from 'lucide-react';
import { extractFilesFromAgentOutput } from '../utils/fileExtractor';
import { localizeText } from '../utils/textLocalizer';
import { autonomyOf } from '../utils/workingMode';
import { journeyHeading, journeyNumber } from '../utils/journeySteps';
import { useCopyFlash } from '../utils/copyText';
import { Button, IconButton } from './ui/Button';

/**
 * The id of the task the compiler named when the plan could not take it — a project with no phases
 * at all. It is never written to the project: the review judges against it, and the verdict has no
 * home until the task is on the plan.
 */
const HINTED_TASK_ID = 'review-hinted-task';

const cleanPhaseTitle = (rawTitle: string) => {
  if (!rawTitle) return '';
  return rawTitle.replace(/^Phase \d+ - /i, '').replace(/^Phase \d+: /i, '').trim();
};

/**
 * A review the screen can draw, whatever arrived.
 *
 * The verdict is kept on the project and read back after a reload, and every list in it is drawn by
 * a screen that counts entries (`completedCriteria.length`). A review saved before a field existed,
 * or an answer a provider sent without one, used to throw while rendering and take the whole review
 * screen down with it — with the defaults in place the attempt simply shows what it does have.
 */
function withReviewDefaults(review: Partial<ReviewType> | null | undefined): ReviewType {
  return {
    id: review?.id || '',
    taskId: review?.taskId || '',
    status: review?.status || 'Blocked',
    progressPercent: review?.progressPercent ?? 0,
    completedCriteria: review?.completedCriteria || [],
    missingCriteria: review?.missingCriteria || [],
    warnings: review?.warnings || [],
    unintendedChanges: review?.unintendedChanges || [],
    nextBestAction: review?.nextBestAction || '',
    agentOutputSummary: review?.agentOutputSummary || '',
    ...(review?.continuationPrompt ? { continuationPrompt: review.continuationPrompt } : {})
  };
}

interface SessionReviewProps {
  project: ProjectState | null;
  onUpdateTaskStatus: (
    taskId: string,
    newStatus: 'completed' | 'partial' | 'blocked' | 'ready',
    nextAction: string,
    reviewHistory?: ReviewAttempt[],
    progressPercent?: number
  ) => void;
  onUpdateProjectFiles?: (updatedFiles: Array<{ path: string; content: string }>) => void;
  initialAgentOutput?: string;
  /** The task the pasted answer was compiled for, when it came from the compiler. */
  initialTaskHint?: { title: string; acceptanceCriteria?: string[] };
  onSendToCompiler?: (prompt: string) => void;
  onOpenPreview?: () => void;
  onOpenNewProjectModal?: () => void;
}

export const SessionReview: React.FC<SessionReviewProps> = ({
  project,
  onUpdateTaskStatus,
  onUpdateProjectFiles,
  initialAgentOutput = '',
  initialTaskHint,
  onSendToCompiler,
  onOpenPreview,
  onOpenNewProjectModal
}) => {
  const { language, t } = useLanguage();
  const allProjectTasks = project?.phases?.flatMap((p) => p.tasks) || [];

  /**
   * The task the answer was written for, when the compiler named one that is not on the plan.
   *
   * The compiler's task field is free text, so an answer produced for a task of the user's own used
   * to be judged against whichever plan task the review happened to open on — that task's criteria,
   * that task's goal, and a verdict stored on it. A task that *is* on the plan — including one the
   * compiler just added to it — is selected by that name before the first render; one the plan could
   * not take (no phases at all) becomes the task under review for this visit, built from the
   * criteria the compiled prompt was checked against.
   */
  const hintedPlanTask: ProjectTask | null = (() => {
    const title = initialTaskHint?.title?.trim().toLowerCase();
    if (!title) return null;
    return allProjectTasks.find((task) => task.title.trim().toLowerCase() === title) || null;
  })();

  const hintedTask: ProjectTask | null = (() => {
    const title = initialTaskHint?.title?.trim();
    const criteria = initialTaskHint?.acceptanceCriteria || [];
    if (hintedPlanTask || !title || criteria.length === 0) return null;
    return {
      id: HINTED_TASK_ID,
      phaseId: 'review',
      title,
      goal: title,
      status: 'ready',
      relevantFiles: [],
      acceptanceCriteria: criteria.map((description, index) => ({
        id: `review-hinted-ac-${index + 1}`,
        description,
        passed: false
      })),
      testRequirements: [],
      estimatedComplexity: 'Small (1 prompt)',
      dependencies: [],
      progressPercent: 0
    };
  })();

  /**
   * The task's state in the reader's own words, and a colour for it.
   *
   * This chip used to print the stored status as it is kept in the project — `ready`, `partial`,
   * `in_progress` — in English, in caps, on a Russian screen, and then repeated the percentage the
   * bar two lines below already shows. It now says what the state means and leaves the number to
   * the bar.
   */
  const statusLabel = (status: string) => (t.taskStatuses as Record<string, string>)[status] || status;
  const statusTone = (status: string) =>
    status === 'completed'
      ? 'bg-emerald-500/10 text-emerald-400'
      : status === 'blocked'
      ? 'bg-rose-500/10 text-rose-300'
      : 'bg-amber-500/10 text-amber-300';

  /**
   * Everything the picker can select: the plan's tasks, plus the compiler's own task when the plan
   * could not take it. Both are options rather than an override, so choosing another task in the
   * picker actually changes the task under review.
   */
  const selectableTasks: ProjectTask[] = hintedTask ? [hintedTask, ...allProjectTasks] : allProjectTasks;

  /**
   * The carried task is chosen here, in the state's own initial value, and not by an effect below.
   *
   * An effect runs after the render it belongs to, and the review of the answer that just arrived is
   * started by another effect of that same render — one that reads the task of the render, not of the
   * state an earlier effect has just set. Selecting by name after the fact would have judged the
   * answer against the previously open task and stored the verdict on it.
   */
  const [selectedTaskId, setSelectedTaskId] = useState<string>(() => {
    if (hintedPlanTask) return hintedPlanTask.id;
    if (hintedTask) return HINTED_TASK_ID;
    const active = allProjectTasks.find((t) => t.status === 'in_progress' || t.status === 'partial' || t.status === 'ready');
    return active?.id || allProjectTasks[0]?.id || '';
  });

  const activeTask = selectableTasks.find((t) => t.id === selectedTaskId) || allProjectTasks[0] || hintedTask;
  /** True while the plan has no such task: nothing here can store a status or an attempt history. */
  const isOffPlanTask = !!hintedTask && activeTask?.id === HINTED_TASK_ID;

  /**
   * A second answer can arrive while this screen is open (the compiler is one click away and back),
   * and it can name another task. The selection follows the name, unless the task is one the plan
   * does not have at all — then there is nothing to select and the fallback above already applies.
   */
  useEffect(() => {
    if (hintedPlanTask) setSelectedTaskId(hintedPlanTask.id);
    else if (hintedTask) setSelectedTaskId(HINTED_TASK_ID);
  }, [initialTaskHint?.title, allProjectTasks.length]);

  const [attempts, setAttempts] = useState<ReviewAttempt[]>(() =>
    (activeTask?.reviewHistory || []).map((attempt) => ({ ...attempt, review: withReviewDefaults(attempt.review) }))
  );
  const [agentOutput, setAgentOutput] = useState(initialAgentOutput || '');
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewResult, setReviewResult] = useState<ReviewType | null>(() =>
    activeTask?.reviewHistory && activeTask.reviewHistory.length > 0
      ? activeTask.reviewHistory[activeTask.reviewHistory.length - 1].review
      : null
  );
  const [expandedAttemptIds, setExpandedAttemptIds] = useState<Record<string, boolean>>({});
  const continuationCopy = useCopyFlash(2000);
  /**
   * The prompt for the very first attempt opens folded.
   *
   * On arrival there is none of the app's own verdict to read yet, so this card was the only thing
   * in the right column — a page of prompt text repeating the task and the criteria already written
   * on the left, and claiming to be the prompt for step 1 while the compiler screen is the place
   * that actually builds it. It now says where the real prompt comes from and opens its short
   * version on request.
   */
  const [showInitialPrompt, setShowInitialPrompt] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [appliedFilesCount, setAppliedFilesCount] = useState<number | null>(null);
  // "Re-evaluate" on a task that is already marked completed used to be a dead end: clearing the
  // result did nothing because the completed-task panel is driven by the task status as well.
  // This flag lets the user re-open the paste box and report the next step anyway.
  const [forceReEvaluate, setForceReEvaluate] = useState(false);

  const extractedFiles = extractFilesFromAgentOutput(
    agentOutput,
    activeTask?.relevantFiles?.[0] || 'src/App.tsx'
  );

  const handleApplyFiles = () => {
    if (extractedFiles.length > 0 && onUpdateProjectFiles) {
      onUpdateProjectFiles(extractedFiles);
      setAppliedFilesCount(extractedFiles.length);
      setTimeout(() => setAppliedFilesCount(null), 3000);
    }
  };

  const handleRunReview = async (customOutput?: string) => {
    if (!project) return;
    const inputToReview = customOutput || agentOutput;
    if (!inputToReview.trim()) return;
    setIsReviewing(true);
    setErrorMsg('');

    try {
      const stepToEvaluate = attempts.length + 1;
      const answer = await reviewSessionApi({
        agentOutput: inputToReview,
        task: activeTask,
        projectMap: project.projectMap,
        stepNumber: stepToEvaluate,
        previousHistory: attempts,
        // The autonomy part decides how the verdict is phrased for this user — never how it is judged.
        skillLevel: autonomyOf(project),
        language
      });

      // Whatever arrived goes through the defaults before it is drawn or stored: the answer is kept
      // on the project and read back after a reload, and a list the provider dropped used to take
      // the whole review screen down with it (the attempt list counts the criteria).
      const data = withReviewDefaults(answer);

      setReviewResult(data);
      setForceReEvaluate(false);

      // Add to attempts history
      const newAttempt: ReviewAttempt = {
        id: `attempt_${Date.now()}`,
        attemptNumber: stepToEvaluate,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        agentOutput: inputToReview,
        review: data
      };

      const updatedAttempts = [...attempts, newAttempt];
      setAttempts(updatedAttempts);

      // Save to task state & update task status accurately
      if (activeTask) {
        const isComplete = data.status === 'Completed' || data.progressPercent >= 100;
        onUpdateTaskStatus(
          activeTask.id,
          isComplete ? 'completed' : 'partial',
          data.nextBestAction,
          updatedAttempts,
          data.progressPercent
        );
      }
    } catch (err: any) {
      console.error('Failed to review session:', err);
      setErrorMsg(err?.userMessage || err?.message || 'Failed to review session.');
    } finally {
      setIsReviewing(false);
    }
  };

  // Sync state whenever active task or its review history changes
  useEffect(() => {
    if (activeTask) {
      const history = (activeTask.reviewHistory || []).map((attempt) => ({
        ...attempt,
        review: withReviewDefaults(attempt.review)
      }));
      setAttempts(history);
      if (history.length > 0) {
        setReviewResult(history[history.length - 1].review);
      } else {
        setReviewResult(null);
      }
    }
    setForceReEvaluate(false);
  }, [activeTask?.id, activeTask?.reviewHistory?.length]);

  // Run review whenever new agent output arrives from the Compiler (once per output).
  const lastReviewedOutputRef = useRef('');
  useEffect(() => {
    if (!initialAgentOutput || !initialAgentOutput.trim() || !project) return;
    // Skip duplicate reviews when the tab remounts or StrictMode double-invokes effects.
    if (lastReviewedOutputRef.current === initialAgentOutput) return;
    const alreadyReviewed = attempts.some((a) => a.agentOutput === initialAgentOutput);
    lastReviewedOutputRef.current = initialAgentOutput;
    setAgentOutput(initialAgentOutput);
    if (!alreadyReviewed) {
      handleRunReview(initialAgentOutput);
    }
  }, [initialAgentOutput]);

  if (!project) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 short:p-5 text-center space-y-4 max-w-lg mx-auto my-12 short:my-2">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/12 text-indigo-300 ring-1 ring-inset ring-indigo-400/25">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <h3 className="text-lg font-bold text-white">{t.common.noProjectSelected}</h3>
        <p className="text-xs text-slate-400">
          {t.common.noProjectSubtext}
        </p>
        {onOpenNewProjectModal && (
          <Button variant="primary" size="md" icon={Sparkles} onClick={onOpenNewProjectModal}>
            {t.common.newProject}
          </Button>
        )}
      </div>
    );
  }

  const currentStepNumber = attempts.length + 1;
  const nextStepNumber = currentStepNumber;

  const handleCopyContinuationPrompt = async (promptText: string) => {
    await continuationCopy.copy(promptText);
  };

  const handleApplyStatus = (status: 'completed' | 'partial' | 'blocked') => {
    if (!activeTask) return;
    const nextAction = reviewResult?.nextBestAction || 'Proceed to next task in plan.';
    onUpdateTaskStatus(
      activeTask.id,
      status,
      nextAction,
      attempts,
      status === 'completed' ? 100 : reviewResult?.progressPercent || 50
    );

    // Auto-advance to the next incomplete task when marked as completed
    if (status === 'completed') {
      const allTasks = project.phases.flatMap(p => p.tasks);
      const currentIndex = allTasks.findIndex(t => t.id === activeTask.id);
      if (currentIndex !== -1) {
        const nextTask = allTasks.slice(currentIndex + 1).find(t => t.status !== 'completed');
        if (nextTask) {
          setSelectedTaskId(nextTask.id);
          setReviewResult(null);
          setAgentOutput('');
        }
      }
    }
  };

  const handleResetHistory = () => {
    setAttempts([]);
    setReviewResult(null);
    setAgentOutput('');
    if (activeTask) {
      onUpdateTaskStatus(activeTask.id, 'ready', 'Restart task review from Step 1.', [], 0);
    }
  };

  const toggleExpandAttempt = (id: string) => {
    setExpandedAttemptIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const activePhase = activeTask ? project.phases.find(p => p.tasks.some(t => t.id === activeTask.id)) : null;
  const allTasks = project.phases.flatMap(p => p.tasks);
  const currentTaskIndex = allTasks.findIndex(t => t.id === activeTask?.id);
  const nextTask = currentTaskIndex !== -1 ? allTasks.slice(currentTaskIndex + 1).find(t => t.status !== 'completed') : null;

  // Safely extract acceptance criteria strings
  const taskCriteriaStrings = activeTask?.acceptanceCriteria
    ? activeTask.acceptanceCriteria.map((ac: any) => (typeof ac === 'string' ? ac : ac?.description || ac?.text || ''))
    : [];

  // Build Continuation or Initial Prompt dynamically
  const getContinuationPromptText = (): string => {
    if (reviewResult?.continuationPrompt) {
      return reviewResult.continuationPrompt;
    }

    const taskTitle = localizeText(activeTask?.title, language) || (language === 'ru' ? 'Текущая задача' : 'Current Task');
    const phaseTitle = activePhase
      ? `${language === 'ru' ? 'Этап' : 'Phase'} ${activePhase.phaseNumber}: ${localizeText(cleanPhaseTitle(activePhase.title), language)}`
      : (language === 'ru' ? 'Этап 1' : 'Phase 1');
    const taskGoal = localizeText(activeTask?.goal, language) || taskTitle;
    const framework = project.engineOrFramework || project.projectType;

    if (attempts.length === 0) {
      if (language === 'ru') {
        return `НАЧАЛЬНЫЙ ПРОМПТ (${t.review.attempt} #1):
Целевая задача: "${taskTitle}"
Этап: ${phaseTitle}
Цель: ${taskGoal}
Стек / Движок: ${framework}

КРИТЕРИИ ПРИЕМКИ ДЛЯ РЕАЛИЗАЦИИ:
${taskCriteriaStrings.length > 0 ? taskCriteriaStrings.map((c) => `- ${localizeText(c, language)}`).join('\n') : '- Качественно реализовать основной функционал задачи'}

ИНСТРУКЦИИ ДЛЯ ИИ-АГЕНТА:
1. Создайте начальную реализацию, полностью удовлетворяющую всем критериям приемки выше.
2. Предоставьте полный, готовый к использованию исходный код для всех целевых файлов без сокращений.
3. Оформите код в блоки markdown с точным указанием пути к файлу (например: // File: src/App.tsx).
4. Убедитесь в отсутствии ошибок компиляции и синтаксиса.`;
      }

      return `INITIAL PROMPT (${t.review.attempt} #1):
Target Task: "${taskTitle}"
Phase: ${phaseTitle}
Goal: ${taskGoal}
Framework/Engine: ${framework}

ACCEPTANCE CRITERIA TO IMPLEMENT:
${taskCriteriaStrings.length > 0 ? taskCriteriaStrings.map((c) => `- ${c}`).join('\n') : '- Implement core task functionality cleanly'}

INSTRUCTIONS FOR AI AGENT:
1. Build the initial implementation to satisfy all acceptance criteria above.
2. Provide complete, ready-to-use source code for all target files.
3. Wrap all code in markdown code blocks like \`\`\`tsx ... \`\`\` with filename comments (e.g. // File: src/App.tsx).
4. Do NOT omit implementation details or use placeholder comments.`;
    }

    const nextStep = attempts.length + 1;
    const completedStr = reviewResult?.completedCriteria?.length
      ? reviewResult.completedCriteria.map(c => localizeText(c, language)).join('; ')
      : (language === 'ru' ? 'Базовая настройка предыдущей попытки' : 'Previous attempt setup');
    const missingStr = reviewResult?.missingCriteria?.length
      ? reviewResult.missingCriteria.map((c) => `- ${localizeText(c, language)}`).join('\n')
      : (language === 'ru' ? '- Оставшиеся критерии приемки' : '- Remaining acceptance criteria');

    if (language === 'ru') {
      return `ПРОМПТ ПРОДОЛЖЕНИЯ (${t.review.attempt} #${nextStep}, до 100%):
Целевая задача: "${taskTitle}"

ТЕКУЩИЙ ПРОГРЕСС (${reviewResult?.progressPercent || 50}% выполнено после попытки #${attempts.length}):
- Выполненные критерии: ${completedStr}

ЧТО ОСТАЛОСЬ РЕАЛИЗОВАТЬ В ПОПЫТКЕ #${nextStep}:
${missingStr}

ИНСТРУКЦИИ ДЛЯ ИИ-АГЕНТА (${t.review.attempt} #${nextStep}):
1. Не удаляйте и не переписывайте работающую реализацию из попыток #1..#${attempts.length}.
2. Реализуйте ТОЛЬКО недостающие элементы, перечисленные в блоке выше.
3. Предоставьте полный, готовый к использованию код для всех измененных или новых файлов.
4. Убедитесь в отсутствии синтаксических ошибок и несоответствий импортов.`;
    }

    return `CONTINUATION PROMPT (${t.review.attempt} #${nextStep}, to reach 100%):
Target Task: "${taskTitle}"

PROGRESS SO FAR (${reviewResult?.progressPercent || 50}% Completed after attempt #${attempts.length}):
- Completed Criteria: ${completedStr}

STILL MISSING FOR ATTEMPT #${nextStep}:
${missingStr}

INSTRUCTIONS FOR AI AGENT (${t.review.attempt} #${nextStep}):
1. Do NOT delete or rewrite working implementation from attempts #1..#${attempts.length}.
2. Implement ONLY the missing elements listed under "STILL MISSING FOR ATTEMPT #${nextStep}".
3. Provide complete, ready-to-use source code for any modified or new files.
4. Ensure all imports match and there are no syntax errors.`;
  };

  /**
   * The prompt card.
   *
   * It used to be a gradient panel with a two-pixel indigo frame and a shadow — the loudest border
   * in the app, for a card that is simply the first thing to copy. Now it is one surface with one
   * accent (the icon) and a hairline under its heading.
   */
  const renderPromptGenerator = (isInitial = false) => (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div className="flex flex-col @xl:flex-row sm:items-center justify-between border-b border-slate-800/70 pb-3 gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-500/15 text-indigo-300 ring-1 ring-inset ring-indigo-400/25">
            <Zap className="h-3.5 w-3.5" />
          </div>
          <div>
            <span className="block text-[10px] font-medium uppercase tracking-wider text-indigo-300">
              {isInitial ? t.review.initialPromptTitle : t.review.continuationPromptTitle}
            </span>
            <h3 className="text-sm font-bold text-white">
              {t.review.attempt} #{attempts.length + 1}
              {!isInitial && (language === 'ru' ? ' — до 100%' : ' — to reach 100%')}
            </h3>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            icon={
              continuationCopy.state === 'copied'
                ? Check
                : continuationCopy.state === 'failed'
                ? AlertTriangle
                : Copy
            }
            onClick={() => handleCopyContinuationPrompt(getContinuationPromptText())}
          >
            {/* The first card holds the first prompt, not a continuation of one. */}
            {continuationCopy.state === 'copied'
              ? t.common.copied
              : continuationCopy.state === 'failed'
              ? t.common.copyFailed
              : attempts.length === 0
              ? t.review.copyPrompt
              : t.review.copyContinuation}
          </Button>

          {onSendToCompiler && (
            <Button
              variant="secondary"
              size="sm"
              icon={Sparkles}
              trailing={ArrowRight}
              title={t.review.openInCompiler}
              onClick={() => onSendToCompiler(isInitial ? (activeTask?.title || '') : getContinuationPromptText())}
            >
              {t.review.openInCompiler}
            </Button>
          )}
        </div>
      </div>

      {isInitial && (
        <p className="text-[11px] text-slate-400 leading-relaxed">{t.review.initialPromptHint}</p>
      )}

      {!isInitial || showInitialPrompt ? (
        <>
          <div className="bg-slate-950/70 rounded-xl p-4 font-mono text-xs text-slate-200 leading-relaxed whitespace-pre-wrap max-h-52 overflow-y-auto">
            {getContinuationPromptText()}
          </div>
          {isInitial && (
            <Button
              variant="ghost"
              size="sm"
              icon={ChevronUp}
              className="w-full"
              onClick={() => setShowInitialPrompt(false)}
            >
              {t.review.hidePrompt}
            </Button>
          )}
        </>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          icon={ChevronDown}
          className="w-full"
          onClick={() => setShowInitialPrompt(true)}
        >
          {t.review.showPrompt}
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/*
        Where this screen sits in the loop: one line, no card. The badge that repeated "current
        step" and the paragraph explaining the screen said what the fields underneath say already.
      */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="w-6 h-6 rounded-lg bg-emerald-500/15 text-emerald-300 flex items-center justify-center font-bold text-xs shrink-0">
            {journeyNumber('check')}
          </span>
          <h2 className="text-sm font-semibold text-white">{journeyHeading('check', t)}</h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Task Dropdown Selector */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 flex items-center gap-2">
            <span className="text-xs text-slate-400 font-medium shrink-0">{t.review.selectTaskToReview}</span>
            <select
              value={selectedTaskId}
              onChange={(e) => setSelectedTaskId(e.target.value)}
              className="bg-transparent text-xs font-bold text-indigo-300 cursor-pointer max-w-xs truncate"
            >
              {hintedTask && (
                // The task under review has to be visible in the picker, not only on the card: an
                // option list that opens on a different task than the one being judged reads as the
                // screen ignoring the click.
                <optgroup
                  label={language === 'ru' ? 'Задача из компилятора' : 'Task from the compiler'}
                  className="bg-slate-900 text-slate-400 font-normal"
                >
                  <option value={hintedTask.id} className="bg-slate-900 text-slate-200 font-medium">
                    {hintedTask.title}
                  </option>
                </optgroup>
              )}
              {project.phases.map((phase) => (
                <optgroup key={phase.id} label={`${language === 'ru' ? 'Этап' : 'Phase'} ${phase.phaseNumber}: ${phase.title}`} className="bg-slate-900 text-slate-400 font-normal">
                  {phase.tasks.map((task) => (
                    <option key={task.id} value={task.id} className="bg-slate-900 text-slate-200 font-medium">
                      {task.status === 'completed' ? '✓ ' : ''}{task.title} ({task.progressPercent}%)
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {attempts.length > 0 && (
            <IconButton
              label={language === 'ru' ? 'Сбросить историю' : 'Reset history'}
              icon={RotateCcw}
              onClick={handleResetHistory}
            />
          )}

          {onSendToCompiler && (
            <Button
              variant="secondary"
              size="sm"
              icon={Sparkles}
              className="shrink-0"
              onClick={() => onSendToCompiler(activeTask?.title || '')}
            >
              {/* Names the destination, so the way back is never a jump to an unnamed "step 1". */}
              ← {journeyHeading('prompt', t)}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 @3xl:grid-cols-12 gap-6">
        {/* Left Column: Task & Input + History Timeline (5 cols) */}
        <div className="@3xl:col-span-5 space-y-4">
          {/* Active Task Summary Card */}
          {activeTask && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
              {/* The task, with its status beside it. The card used to open with
                  "ЦЕЛЕВАЯ ЗАДАЧА ПОД ПРОВЕРКОЙ" over the task's own title, which is the same sentence
                  twice, and the badge lived on a line of its own. */}
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-bold text-white">{activeTask.title}</h3>
                <span
                  data-testid="task-status"
                  className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${statusTone(activeTask.status)}`}
                >
                  {statusLabel(activeTask.status)}
                </span>
              </div>
              <p className="text-xs text-slate-300">{activeTask.goal}</p>

              {/* Progress Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-mono text-slate-400">
                  <span>{language === 'ru' ? 'Готовность задачи:' : 'Task Completion:'}</span>
                  <span className="font-semibold text-indigo-300">{activeTask.progressPercent}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-950">
                  <div
                    className={`h-full transition-all duration-500 ${
                      activeTask.progressPercent >= 100
                        ? 'bg-emerald-500'
                        : activeTask.progressPercent >= 50
                        ? 'bg-indigo-500'
                        : 'bg-amber-500'
                    }`}
                    style={{ width: `${activeTask.progressPercent}%` }}
                  />
                </div>
              </div>

              {/* Target Criteria */}
              <div className="pt-2 border-t border-slate-800 space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {language === 'ru' ? 'Критерии приемки:' : 'Acceptance Criteria:'}
                </span>
                <ul className="text-xs text-slate-300 space-y-1 list-disc list-inside">
                  {activeTask.acceptanceCriteria.map((ac: any, idx: number) => {
                    const isStr = typeof ac === 'string';
                    const text = isStr ? ac : ac?.description || ac?.text || String(ac);
                    const isPassed = !isStr && Boolean(ac?.passed);
                    return (
                      <li key={isStr ? idx : ac?.id || idx} className={isPassed ? 'text-emerald-400 line-through' : 'text-slate-300'}>
                        {text}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}

          {/* Input Box for Current Step (e.g. Step 1 or Next Step) */}
          {(!forceReEvaluate && (reviewResult?.progressPercent === 100 || activeTask?.status === 'completed')) ? (
            <div className="bg-emerald-500/5 rounded-2xl p-5 text-center space-y-3">
              <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-300 ring-1 ring-inset ring-emerald-400/25">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-emerald-200">
                  {language === 'ru' ? 'Задача полностью выполнена (100%)' : 'Task 100% Completed!'}
                </h4>
                <p className="text-xs text-slate-400 mt-1">
                  {language === 'ru' ? 'Все критерии приемки проверены и подтверждены.' : 'All criteria for this task have been verified.'}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                {nextTask && (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={Sparkles}
                    trailing={ArrowRight}
                    onClick={() => {
                      handleApplyStatus('completed');
                      if (onSendToCompiler) {
                        onSendToCompiler(nextTask.title);
                      }
                    }}
                  >
                    {language === 'ru' ? `Следующая: ${nextTask.title}` : `Next: ${nextTask.title}`}
                  </Button>
                )}
                {onOpenPreview && (
                  <Button variant="secondary" size="sm" icon={Play} onClick={onOpenPreview}>
                    {t.review.openPreview}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  icon={RotateCcw}
                  onClick={() => {
                    setReviewResult(null);
                    setForceReEvaluate(true);
                  }}
                >
                  {language === 'ru' ? 'Повторный анализ' : 'Re-evaluate'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-200 block">
                  {t.review.pasteAgentOutputLabel}
                </label>
                <span className="rounded bg-indigo-500/15 px-2 py-0.5 font-mono text-[10px] font-medium text-indigo-300">
                  {t.review.attempt} #{attempts.length + 1}
                </span>
              </div>

              {errorMsg && (
                <div className="bg-rose-950/40 border border-rose-850 rounded-lg p-3 text-xs text-rose-200">
                  <strong>{t.common.error}:</strong> {errorMsg}
                </div>
              )}

              {extractedFiles.length > 0 && onUpdateProjectFiles && (
                <div className="bg-indigo-500/10 rounded-lg p-2.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileCode className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                    <span className="text-[11px] text-slate-300 truncate">
                      {language === 'ru' ? `Найдено файлов: ${extractedFiles.length}` : `Detected ${extractedFiles.length} file(s)`}: {extractedFiles.map(f => f.path).join(', ')}
                    </span>
                  </div>
                  <Button
                    variant="accent"
                    size="xs"
                    icon={FileCode}
                    className="shrink-0"
                    onClick={handleApplyFiles}
                  >
                    {appliedFilesCount !== null ? t.review.filesApplied : t.review.applyFilesButton}
                  </Button>
                </div>
              )}

              <textarea
                value={agentOutput}
                onChange={(e) => setAgentOutput(e.target.value)}
                aria-label={language === 'ru' ? 'Ответ агента' : 'Agent output'}
                placeholder={t.review.pasteAgentPlaceholder}
                rows={6}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-200 focus:border-emerald-500 font-mono placeholder:text-slate-400"
              />

              <Button
                variant="primary"
                size="sm"
                icon={isReviewing ? Loader2 : ShieldCheck}
                className={`w-full ${isReviewing ? 'animate-pulse' : ''}`}
                onClick={() => handleRunReview()}
                disabled={isReviewing || !agentOutput.trim()}
              >
                {isReviewing ? t.review.reviewing : t.review.runReviewButton}
              </Button>
            </div>
          )}

          {/* Timeline History of Previous Steps */}
          {attempts.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <History className="h-3.5 w-3.5 text-indigo-400" />
                  <h4 className="text-xs font-bold text-slate-200">
                    {t.review.attemptHistoryTitle} ({attempts.length})
                  </h4>
                </div>
                <span className="text-[10px] text-slate-400 font-mono">{t.common.saved}</span>
              </div>

              <div className="space-y-2">
                {attempts.map((attempt) => {
                  const isExpanded = !!expandedAttemptIds[attempt.id];
                  const percent = attempt.review.progressPercent;
                  return (
                    <div
                      key={attempt.id}
                      className="bg-slate-950/60 rounded-lg overflow-hidden transition-all"
                    >
                      <button
                        onClick={() => toggleExpandAttempt(attempt.id)}
                        className="w-full p-2.5 flex items-center justify-between text-left hover:bg-slate-900/60 cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-indigo-500/15 px-2 py-0.5 font-mono text-[10px] font-medium text-indigo-300">
                            {t.review.attempt} #{attempt.attemptNumber}
                          </span>
                          <span
                            className={`text-xs font-semibold ${
                              percent >= 100
                                ? 'text-emerald-400'
                                : percent >= 50
                                ? 'text-indigo-400'
                                : 'text-amber-400'
                            }`}
                          >
                            {percent}%
                          </span>
                          <span className="text-[10px] text-slate-400">{attempt.timestamp}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-400 font-medium">
                            {attempt.review.completedCriteria.length} {language === 'ru' ? 'критериев' : 'criteria'}
                          </span>
                          {isExpanded ? (
                            <ChevronUp className="h-3.5 w-3.5 text-slate-500" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
                          )}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="p-3 border-t border-slate-800/80 space-y-2 text-xs">
                          <div className="text-[11px] text-slate-300">
                            <strong>{language === 'ru' ? 'Итог:' : 'Analysis:'}</strong> {attempt.review.agentOutputSummary}
                          </div>
                          <div className="bg-slate-900 p-2 rounded text-[11px] font-mono text-slate-400 max-h-24 overflow-y-auto whitespace-pre-wrap">
                            {attempt.agentOutput}
                          </div>
                          <div className="flex gap-3 text-[10px] pt-1">
                            <span className="text-emerald-400">✓ {language === 'ru' ? 'Выполнено' : 'Done'}: {attempt.review.completedCriteria.join(', ') || '—'}</span>
                            {attempt.review.missingCriteria.length > 0 && (
                              <span className="text-amber-400">✗ {language === 'ru' ? 'Осталось' : 'Missing'}: {attempt.review.missingCriteria.join(', ')}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Review Results & Dynamic Continuation Prompt (7 cols) */}
        <div className="@3xl:col-span-7 space-y-5">
          {reviewResult ? (
            <div className="space-y-5">
              {/* Verdict Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-5">
                {/* Top Status Badge & Progress */}
                <div className="flex flex-col @xl:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      {t.review.verdictTitle} · {t.review.attempt} #{attempts.length}
                    </span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <h3 className="text-lg font-bold text-white">
                        {reviewResult.status === 'Completed'
                          ? t.review.verdictPass
                          : reviewResult.status === 'Partially Completed'
                          ? t.review.verdictPartial
                          : t.review.verdictFail}
                      </h3>
                      <span
                        className={`shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium ${
                          reviewResult.progressPercent >= 100
                            ? 'bg-emerald-500/10 text-emerald-300'
                            : reviewResult.progressPercent >= 50
                            ? 'bg-indigo-500/10 text-indigo-300'
                            : 'bg-amber-500/10 text-amber-300'
                        }`}
                      >
                        {reviewResult.progressPercent}% {language === 'ru' ? 'Готово' : 'Complete'}
                      </span>
                      {/*
                        Who judged it. Without a key no model reads the answer: the offline engine
                        matches the task's criteria against the pasted text and adds the app's own
                        checks. Saying so is what keeps the percentage honest.
                      */}
                      {reviewResult.engine === 'local' && (
                        <span
                          data-testid="review-local-engine"
                          title={
                            language === 'ru'
                              ? 'Модель не отвечала: процент посчитан по тексту ответа и по проверкам, которые запустило приложение'
                              : 'No model answered: the percentage comes from the answer text and the checks the app ran itself'
                          }
                          className="text-[10px] bg-amber-950/60 text-amber-300 border border-amber-900 px-2 py-0.5 rounded font-mono"
                        >
                          {language === 'ru' ? 'без ИИ' : 'no AI'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/*
                    Action Buttons.

                    A task the plan does not have gets no status button: the write would match no
                    task and the click would be accepted with nothing kept. The verdict it shows is
                    still the one the answer was judged against — what is missing is a place to
                    store "done", not the verdict.
                  */}
                  {activeTask && !isOffPlanTask && (
                    <div className="flex flex-wrap gap-2">
                      {extractedFiles.length > 0 && onUpdateProjectFiles && (
                        <Button variant="secondary" size="sm" icon={FileCode} onClick={handleApplyFiles}>
                          {appliedFilesCount !== null
                            ? t.review.filesApplied
                            : `${t.review.applyFilesButton} (${extractedFiles.length})`}
                        </Button>
                      )}
                      {onOpenPreview && (
                        <Button variant="secondary" size="sm" icon={Play} onClick={onOpenPreview}>
                          {t.review.openPreview}
                        </Button>
                      )}
                      {nextTask && (reviewResult.progressPercent >= 100 || reviewResult.status === 'Completed') ? (
                        <Button
                          variant="primary"
                          size="sm"
                          icon={Sparkles}
                          trailing={ArrowRight}
                          onClick={() => {
                            handleApplyStatus('completed');
                            if (onSendToCompiler) {
                              onSendToCompiler(nextTask.title);
                            }
                          }}
                        >
                          {t.review.markCompletedAndNext}
                        </Button>
                      ) : (
                        <Button
                          variant="success"
                          size="sm"
                          icon={CheckCircle2}
                          onClick={() => handleApplyStatus('completed')}
                        >
                          {t.review.markCompleted}
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {/* Progress Bar in Verdict */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-slate-300">{t.review.measuredProgress}</span>
                    <span className="font-semibold text-indigo-300">{reviewResult.progressPercent}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-950">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        reviewResult.progressPercent >= 100
                          ? 'bg-emerald-500'
                          : reviewResult.progressPercent >= 50
                          ? 'bg-indigo-500'
                          : 'bg-amber-500'
                      }`}
                      style={{ width: `${reviewResult.progressPercent}%` }}
                    />
                  </div>
                </div>

                {/* Summary */}
                <p className="text-xs text-slate-200 bg-slate-950 p-3 rounded-lg border border-slate-800 leading-relaxed">
                  {reviewResult.agentOutputSummary}
                </p>

                {/* Passed vs Missing Criteria Breakdown */}
                <div className="grid grid-cols-1 @xl:grid-cols-2 gap-4">
                  {/* Passed */}
                  <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950 p-3">
                    <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      <span>{t.review.criteriaTitle} ({reviewResult.completedCriteria.length})</span>
                    </span>
                    <ul className="text-xs text-slate-200 space-y-1">
                      {reviewResult.completedCriteria.length === 0 ? (
                        <li className="text-slate-400 text-[11px]">{language === 'ru' ? 'Критерии еще не подтверждены.' : 'No criteria verified yet.'}</li>
                      ) : (
                        reviewResult.completedCriteria.map((c, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span className="text-emerald-400">•</span>
                            <span>{c}</span>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>

                  {/* Missing */}
                  <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950 p-3">
                    <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-amber-300">
                      <XCircle className="h-3.5 w-3.5 text-amber-500" />
                      <span>{language === 'ru' ? 'Оставшиеся критерии' : 'Remaining Criteria'} ({reviewResult.missingCriteria.length})</span>
                    </span>
                    <ul className="text-xs text-slate-300 space-y-1">
                      {reviewResult.missingCriteria.length === 0 ? (
                        <li className="text-emerald-400 text-[11px] font-semibold">{language === 'ru' ? 'Все критерии подтверждены (100%).' : 'All criteria verified! 100% Complete.'}</li>
                      ) : (
                        reviewResult.missingCriteria.map((c, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-amber-300">
                            <span className="text-amber-400">•</span>
                            <span>{c}</span>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                </div>

                {/* Next Best Action Callout */}
                <div className="space-y-2 rounded-xl border border-indigo-400/20 bg-indigo-500/[0.07] p-4">
                  <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-indigo-300">
                    <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                    <span>{t.dashboard.nextAction}</span>
                  </span>
                  <p className="text-sm font-semibold text-white">{reviewResult.nextBestAction}</p>
                </div>
              </div>

              {/* DYNAMIC CONTINUATION PROMPT CARD (Step N -> Step N+1) */}
              {(reviewResult.status !== 'Completed' || reviewResult.progressPercent < 100) && (
                renderPromptGenerator(false)
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {attempts.length === 0 ? (
                renderPromptGenerator(true)
              ) : (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 space-y-3">
                  <ShieldCheck className="mx-auto h-9 w-9 text-slate-500" />
                  <h3 className="text-sm font-bold text-slate-200">{language === 'ru' ? 'Анализ еще не запущен' : 'No Review Performed Yet'}</h3>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    {language === 'ru' ? 'Вставьте вывод агента слева и запустите анализ сессии.' : 'Paste your AI agent output on the left and run analysis.'}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
