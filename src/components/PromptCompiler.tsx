import React, { useState, useEffect, useRef } from 'react';
import { ProjectState, AgentType, ContextMode, CompiledPrompt } from '../types';
import { compilePromptStreamApi } from '../services/api';
import { beginRun, finishRun, pushRunDelta, pushRunLine, resetRunTrace, useRunStream } from '../services/runStream';
import { RunTerminal } from './RunTerminal';
import { formatBytes } from '../utils/byteSize';
import { useLanguage } from '../context/LanguageContext';
import { autonomyOf } from '../utils/workingMode';
import { journeyHeading, journeyNumber } from '../utils/journeySteps';
import { useCopyFlash } from '../utils/copyText';
import { Button, IconButton, buttonClass } from './ui/Button';
import { Sparkles, Copy, Download, Check, Cpu, FileCode, Layers, ShieldAlert, ShieldCheck, Play, Loader2, ArrowRight, AlertTriangle, History } from 'lucide-react';
import { ruleKindLabel } from '../utils/rulesFindingLabels';
import { formatRulesCheckTime } from '../utils/rulesCheckStamp';

interface PromptCompilerProps {
  project: ProjectState | null;
  /**
   * Hands the pasted answer to the review, together with the task it was compiled for. The review
   * judges against a task's acceptance criteria, and the compiler's field is free text — without
   * the name travelling along, an answer written for one task was checked against whichever task
   * the review happened to open on.
   */
  onSendToReview?: (agentResultText: string, taskTitle?: string, acceptanceCriteria?: string[]) => void;
  initialTaskTitle?: string;
  onOpenNewProjectModal?: () => void;
  /**
   * The agent the prompt is compiled for, kept on the project. The screen shows the same value the
   * top bar does and writes to the same place, because two dropdowns holding two different answers
   * is how a prompt ends up made for the agent nobody selected.
   */
  onSelectAgent?: (agent: AgentType) => void;
}

const cleanPhaseTitle = (rawTitle: string) => {
  if (!rawTitle) return '';
  return rawTitle.replace(/^Phase \d+ - /i, '').replace(/^Phase \d+: /i, '').trim();
};

export const PromptCompiler: React.FC<PromptCompilerProps> = ({
  project,
  onSendToReview,
  initialTaskTitle = '',
  onOpenNewProjectModal,
  onSelectAgent
}) => {
  const { language, t } = useLanguage();
  /**
   * The field starts on the task the project is actually on. It used to start on a written example
   * sentence, which reads exactly like a real task — so pressing Start compiled a prompt about
   * somebody else's game. With no task to offer, the field is empty and the example shows as the
   * placeholder it always was.
   */
  const [taskInput, setTaskInput] = useState(
    initialTaskTitle ||
      project?.phases?.flatMap((p) => p.tasks).find((t) => t.status === 'ready' || t.status === 'partial')?.title ||
      ''
  );

  useEffect(() => {
    if (initialTaskTitle && initialTaskTitle.trim()) {
      setTaskInput(initialTaskTitle);
    }
  }, [initialTaskTitle]);

  /** Read from the project, never held here: one agent, one place that owns it. */
  const selectedAgent: AgentType = project?.selectedAgent || 'Cursor';
  /** The name as the screens print it, including the Russian wording for the web-chat agent. */
  const agentLabel =
    selectedAgent === 'DeepSeek / Web Chat' && language === 'ru' ? 'DeepSeek / Веб-чат' : selectedAgent;
  /**
   * This card is the only place the agent can be changed: the top bar carries the project and
   * nothing else, so the control lives where the prompt it affects is built.
   */
  const offersAgentPicker = Boolean(onSelectAgent);
  const [contextMode, setContextMode] = useState<ContextMode>('Balanced');
  // A lower autonomy means fewer decisions to make: the settings are picked for the user and stay
  // out of the way until they ask for them. The interface part has no say here.
  const settingsAreChosenForUser = autonomyOf(project) === 'Vibe-coder';
  const [showContextSetup, setShowContextSetup] = useState(false);
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>(
    project?.projectMap?.files?.map((f) => f.path) || []
  );

  const [isCompiling, setIsCompiling] = useState(false);
  /** How this screen's last compile ended, when it ended without a prompt. */
  const [compileOutcome, setCompileOutcome] = useState<'error' | 'cancelled' | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const run = useRunStream();
  /** The request in flight: the terminal's stop button aborts it, and the server stops with it. */
  const compileAbort = useRef<AbortController | null>(null);
  const [compiledPrompt, setCompiledPrompt] = useState<CompiledPrompt | null>(null);
  const [compiledSignature, setCompiledSignature] = useState('');
  const copyFlash = useCopyFlash(2000);
  const [simulatedResult, setSimulatedResult] = useState('');

  /**
   * Mix of everything that changes the compiled result. It is captured when a compile runs and
   * compared afterwards, so an edited task shows "press Start again" instead of silently
   * firing a new request the moment the user opens the screen or types a letter.
   */
  const buildSignature = () =>
    JSON.stringify([taskInput, selectedAgent, contextMode, [...selectedFilePaths].sort(), project?.id || '']);

  const isOutdated = Boolean(compiledPrompt) && compiledSignature !== buildSignature();

  /**
   * Stops the compile the terminal is showing.
   *
   * Aborting the fetch closes the response; the server sees the close and stops asking the
   * provider, so a cancelled run is not paid for behind a hidden card.
   */
  const cancelCompile = () => {
    if (!isCompiling) return;
    compileAbort.current?.abort();
  };

  const handleCompile = async () => {
    if (!project) return;
    if (!taskInput.trim()) {
      setErrorMsg(t.compiler.emptyTaskNotice);
      return;
    }
    if (isCompiling) return;
    const signature = buildSignature();
    setIsCompiling(true);
    setErrorMsg('');
    setCompileOutcome(null);

    const activeFiles = (project.projectMap?.files || []).filter(
      (f) => selectedFilePaths.length === 0 || selectedFilePaths.includes(f.path)
    );
    const scopedProjectMap = {
      ...project.projectMap,
      files: activeFiles
    };
    const payload = {
      userRequest: taskInput,
      taskTitle: taskInput,
      projectMap: scopedProjectMap,
      brief: project.brief,
      agent: selectedAgent,
      contextMode,
      skillLevel: autonomyOf(project),
      language,
      // The server reads these against the connected folder, so a rule that names a file the
      // folder no longer has does not reach the agent as an instruction to be followed.
      rules: project.rulesFilesContent,
      projectName: project.name
    };

    /*
     * The form becomes a terminal before the request leaves, like the beginner flow does: the
     * request's own facts go in first, then the model writes into the same log as it produces the
     * prompt. A spinner with a sentence under it was the one screen in the app that hid what it was
     * waiting for.
     */
    const controller = new AbortController();
    compileAbort.current = controller;
    const startedAt = Date.now();
    beginRun({
      kind: 'compile',
      title: language === 'ru' ? 'Сборка промпта' : 'Building the prompt',
      lines: [
        { label: language === 'ru' ? 'Задача' : 'Task', text: payload.taskTitle },
        { label: language === 'ru' ? 'Агент' : 'Agent', text: agentLabel },
        {
          tone: 'muted',
          label: language === 'ru' ? 'Контекст' : 'Context',
          text: `${activeFiles.length} ${language === 'ru' ? 'файлов' : 'files'} · ${contextMode}`
        },
        {
          label: language === 'ru' ? 'Запрос' : 'Request',
          text: `POST /api/prompt/compile?stream=1 · ${formatBytes(
            new TextEncoder().encode(JSON.stringify(payload)).length
          )}`
        }
      ]
    });

    try {
      const data = await compilePromptStreamApi(payload, {
        // A new provider or model is a new answer: the abandoned model's half-written text is not
        // part of it, so the trace is dropped with the model that wrote it.
        onAttempt: (provider, model) => {
          resetRunTrace();
          pushRunLine('step', `${provider}${model ? ` / ${model}` : ''}`, {
            label: language === 'ru' ? 'Модель' : 'Model'
          });
        },
        onDelta: pushRunDelta,
        signal: controller.signal
      });

      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      pushRunLine('success', `200 OK · ${seconds} ${language === 'ru' ? 'с' : 's'}`);
      finishRun(
        'success',
        language === 'ru'
          ? `Промпт собран · ${data.promptText.length} симв. · ~${data.estimatedTokens} токенов`
          : `Prompt built · ${data.promptText.length} chars · ~${data.estimatedTokens} tokens`
      );
      setCompiledPrompt(data);
      setCompiledSignature(signature);
    } catch (err: any) {
      // A stopped request is not a failure: nothing went wrong, the reader stopped it.
      if (controller.signal.aborted) {
        finishRun(
          'cancelled',
          language === 'ru' ? 'Отменено · запрос остановлен' : 'Cancelled · the request was stopped'
        );
        setErrorMsg('');
        setCompileOutcome('cancelled');
        return;
      }
      const message = err?.userMessage || err?.message || 'Failed to compile prompt.';
      finishRun('error', `${language === 'ru' ? 'Ошибка' : 'Failed'} · ${message}`);
      setErrorMsg(message);
      setCompileOutcome('error');
    } finally {
      if (compileAbort.current === controller) compileAbort.current = null;
      setIsCompiling(false);
    }
  };

  // Nothing is compiled automatically: opening this screen used to start an AI request by
  // itself, which cost time and money before the user had even looked at the task. The single
  // entry point is the Start button (and the empty-output call to action).

  if (!project) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 short:p-5 text-center space-y-4 max-w-lg mx-auto my-12 short:my-2">
        <div className="w-12 h-12 rounded-2xl bg-indigo-950 text-indigo-400 border border-indigo-800 flex items-center justify-center mx-auto">
          <Sparkles className="w-6 h-6" />
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

  const availableFiles = project.projectMap?.files || [];

  const handleToggleFile = (path: string) => {
    if (selectedFilePaths.includes(path)) {
      setSelectedFilePaths(selectedFilePaths.filter((p) => p !== path));
    } else {
      setSelectedFilePaths([...selectedFilePaths, path]);
    }
  };

  const handleCopyPrompt = async () => {
    if (!compiledPrompt) return;
    await copyFlash.copy(compiledPrompt.promptText);
  };

  const handleDownloadPrompt = () => {
    if (!compiledPrompt) return;
    const blob = new Blob([compiledPrompt.promptText], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AGENT_PROMPT_${selectedAgent.replace(/\s+/g, '_')}.md`;
    a.click();
  };

  return (
    <div className="space-y-6">
      {/*
        Where this screen sits in the loop: one line, no card.

        The step number and its name are the only things the reader needs to know about position;
        the badge that repeated "current step" and the paragraph explaining the screen were both
        saying what the fields underneath already say, over two lines of a workspace that wants the
        room.
      */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="w-6 h-6 rounded-md bg-slate-800/80 ring-1 ring-inset ring-slate-700 text-slate-300 flex items-center justify-center font-semibold text-[11px] shrink-0">
            {journeyNumber('prompt')}
          </span>
          <h2 className="text-sm font-semibold text-slate-100">{journeyHeading('prompt', t)}</h2>
        </div>

        <div className="flex items-center gap-3">
          {/*
            Whom this prompt is being built for — the project's own setting, changed here because
            this is the screen that uses it.
          */}
          {offersAgentPicker ? (
            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 shrink-0">
              <Cpu className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[11px] text-slate-400">{t.common.targetAgent}</span>
              <select
                value={selectedAgent}
                onChange={(e) => onSelectAgent?.(e.target.value as AgentType)}
                aria-label={t.common.targetAgent}
                className="bg-transparent text-[11px] font-medium text-slate-200 cursor-pointer"
              >
                <option value="DeepSeek / Web Chat">{language === 'ru' ? 'DeepSeek / Веб-чат' : 'DeepSeek / Web Chat'}</option>
                <option value="Cursor">Cursor</option>
                <option value="Claude Code">Claude Code</option>
                <option value="Windsurf">Windsurf</option>
                <option value="GitHub Copilot">GitHub Copilot</option>
                <option value="Cline">Cline</option>
                <option value="Roo Code">Roo Code</option>
                <option value="Replit">Replit</option>
                <option value="Lovable">Lovable</option>
                <option value="Bolt">Bolt</option>
                <option value="ChatGPT / API">ChatGPT / API</option>
              </select>
            </div>
          ) : (
            <span className="flex items-center gap-1.5 text-[11px] text-slate-400 shrink-0">
              <Cpu className="w-3.5 h-3.5 text-slate-500" />
              <span>{t.common.targetAgent}</span>
              <span data-testid="compiler-agent-value" className="font-medium text-slate-200">
                {agentLabel}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* 4-Panel Compiler Workspace */}
      <div className="grid grid-cols-1 @3xl:grid-cols-12 gap-6">
        {/* Left Column: Intent Input & Context Selector (5 cols) */}
        <div className="@3xl:col-span-5 space-y-5">
          {/*
            Panel 1: Task / Intent Input.

            The three panels of this stage used to be numbered 1, 2 and 3 — under a header that
            already said "Step 1" and with the second screen of the loop called "Step 2". A reader
            counting digits met two numbering systems in one screen, so the panels now say what they
            hold and the order is carried by the layout alone.
          */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
            {/*
              The box says what it holds: the placeholder names the task, the field itself carries
              the name for screen readers — no heading above both.
            */}
            <textarea
              value={taskInput}
              onChange={(e) => setTaskInput(e.target.value)}
              placeholder={t.compiler.taskPlaceholder}
              rows={3}
              aria-label={t.compiler.panel1Title}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-100 focus:border-slate-600 transition-colors"
            />

            {/* Quick Task Selector from Plan */}
            <div
              title={t.compiler.chooseTaskFromPlan}
              aria-label={t.compiler.chooseTaskFromPlan}
              className="space-y-2"
            >
              <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
                {project.phases.map((phase) => (
                  <div key={phase.id} className="space-y-1">
                    <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide block">
                      {language === 'ru' ? `Этап ${phase.phaseNumber}` : `Phase ${phase.phaseNumber}`}: {cleanPhaseTitle(phase.title)}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {phase.tasks.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setTaskInput(t.title)}
                          className={`text-[10px] px-2 py-1 rounded-md border transition-colors cursor-pointer flex items-center gap-1 ${
                            taskInput === t.title
                              ? 'bg-slate-800 text-slate-100 border-slate-700'
                              : 'bg-transparent text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200'
                          }`}
                        >
                          <span>{t.title}</span>
                          {t.status === 'completed' && <span className="text-emerald-400/80 text-[9px]">✓</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Panel 2: Context Mode & File Budget Selector */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
            {settingsAreChosenForUser && !showContextSetup ? (
              <div className="space-y-2 bg-slate-950/60 border border-slate-800 rounded-lg p-3">
                <p className="text-[11px] text-slate-400">{t.compiler.autoChosen}</p>
                <p className="text-xs font-medium text-slate-200">
                  {contextMode === 'Minimal'
                    ? t.contextModes.minimal
                    : contextMode === 'Balanced'
                    ? t.contextModes.balanced
                    : t.contextModes.full}
                  {' · '}
                  {t.compiler.verifiedFileIndex} {selectedFilePaths.length}/{availableFiles.length}
                </p>
                <Button variant="secondary" size="xs" onClick={() => setShowContextSetup(true)}>
                  {t.compiler.customizeContext}
                </Button>
              </div>
            ) : (
              <>
            {/* Context Mode Toggle */}
            <div className="grid grid-cols-3 gap-0.5 bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px] font-medium">
              {(['Minimal', 'Balanced', 'Full'] as ContextMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setContextMode(mode)}
                  className={`py-1.5 rounded-md transition-colors cursor-pointer ${
                    contextMode === mode
                      ? 'bg-slate-800 text-slate-100 ring-1 ring-inset ring-slate-700'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {mode === 'Minimal' ? t.contextModes.minimal : mode === 'Balanced' ? t.contextModes.balanced : t.contextModes.full}
                </button>
              ))}
            </div>

            {/* Available Files Checklist: the count is in its row — no line above it. */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                {t.compiler.verifiedFileIndex} ({selectedFilePaths.length}/{availableFiles.length})
              </span>

              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {availableFiles.map((file) => {
                  const isChecked = selectedFilePaths.includes(file.path);
                  return (
                    <label
                      key={file.path}
                      className={`flex items-center justify-between p-2 rounded-md text-xs cursor-pointer transition-colors ${
                        isChecked
                          ? 'bg-slate-800/60 text-slate-100'
                          : 'text-slate-500 hover:bg-slate-950/60 hover:text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleFile(file.path)}
                          className="rounded border-slate-700 bg-slate-900 text-slate-500 cursor-pointer"
                        />
                        <FileCode className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span className="font-mono text-[11px] truncate">{file.path}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 uppercase shrink-0">
                        {file.type}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {settingsAreChosenForUser && (
              <Button variant="ghost" size="xs" onClick={() => setShowContextSetup(false)}>
                {t.compiler.hideContextSetup}
              </Button>
            )}
              </>
            )}

            {/*
              The only trigger: compile on demand, never in the background. An icon with the name in
              its tooltip, like every other control on the plan screens — the result next to it tells
              the rest of the story.
            */}
            <button
              onClick={handleCompile}
              disabled={isCompiling}
              title={isCompiling ? t.compiler.compilingPrompt : compiledPrompt ? t.compiler.recompilePrompt : t.compiler.startCompile}
              aria-label={isCompiling ? t.compiler.compilingPrompt : compiledPrompt ? t.compiler.recompilePrompt : t.compiler.startCompile}
              className={buttonClass({
                variant: 'primary',
                size: 'md',
                className: `w-full ${isOutdated ? 'ring-2 ring-amber-500/50' : ''}`
              })}
            >
              {/*
                Named while it is idle: a full-width bar holding one small triangle is a slab, not a
                control. While the run is open the terminal is the thing being read, so the button
                only keeps the spinner and the word in its tooltip.
              */}
              {isCompiling ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t.compiler.compilingPrompt}</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>{t.compiler.startCompile}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Column: Compiled Prompt Output & Agent Execution Simulation (7 cols) */}
        <div className="@3xl:col-span-7 space-y-5">
          {/*
            Panel 3: Compiled Prompt Result.

            Before the first compile there is no result, so there is no panel either: a framed box
            holding one sentence about pressing Start was the largest empty surface on the screen.
            The sentence stands on the page, and the surface appears with the prompt.

            The panel is drawn around a prompt, never around the terminal: the terminal is a surface
            of its own, and a bordered log inside a bordered card is the plate-in-a-plate the rest of
            the app avoids. While the run is open (or stopped) the column holds the log and nothing
            else.
          */}
          <div
            className={`space-y-4 ${compiledPrompt ? 'rounded-xl border border-slate-800 bg-slate-900 p-4' : ''}`}
          >
            {/*
              The output has no heading of its own: the token count and, when the offline engine
              answered, its badge say everything a title would — the box itself is the result.
              Both buttons are icons with the name in the tooltip, so actions read in one glance.
              There is nothing to export while the prompt is still being written.
            */}
            {compiledPrompt && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {compiledPrompt && (
                  <span className="text-[10px] bg-slate-800/60 text-slate-400 px-2 py-0.5 rounded font-mono">
                    ~{compiledPrompt.estimatedTokens} {language === 'ru' ? 'токенов' : 'tokens'}
                  </span>
                )}
                {compiledPrompt?.engine === 'local' && (
                  <span
                    data-testid="compiler-local-engine"
                    title={
                      language === 'ru'
                        ? 'Модель не ответила: промпт собран из задачи, файлов проекта и команд его package.json'
                        : 'No model answered: the prompt was assembled from the task, the project files and its package.json scripts'
                    }
                    className="text-[10px] text-amber-200/80 border border-amber-500/25 px-2 py-0.5 rounded font-mono"
                  >
                    {language === 'ru' ? 'без ИИ' : 'no AI'}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <IconButton label={t.common.export} icon={Download} onClick={handleDownloadPrompt} />

                <IconButton
                  label={
                    copyFlash.state === 'copied'
                      ? t.common.copied
                      : copyFlash.state === 'failed'
                      ? t.common.copyFailed
                      : t.common.copy
                  }
                  icon={
                    copyFlash.state === 'copied'
                      ? Check
                      : copyFlash.state === 'failed'
                      ? AlertTriangle
                      : Copy
                  }
                  variant={
                    copyFlash.state === 'copied'
                      ? 'success'
                      : copyFlash.state === 'failed'
                      ? 'warning'
                      : 'secondary'
                  }
                  onClick={handleCopyPrompt}
                />
              </div>
            </div>
            )}

            {/*
              What the prompt was told about the project's rules. The agent's output is only as
              good as the instructions it was given, so the user sees here which of them were
              already stale when the prompt was compiled.
            */}
            {compiledPrompt?.rulesCheck && !isCompiling && (
              <div
                data-testid="compiler-rules-check"
                className="bg-slate-950/40 border border-slate-800/70 rounded-xl p-3 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
                    <span>{t.compiler.rulesCheckTitle}</span>
                  </span>

                  {/*
                    Two counts, two weights: a problem is a fact worth seeing, a note is
                    bookkeeping. Neither gets a filled chip — colour here is a dot, not a surface.
                  */}
                  {compiledPrompt.rulesCheck.audit.compared.files && (
                    <span className="flex items-center gap-3 text-[10px] tabular-nums">
                      <span
                        data-testid="compiler-rules-problems"
                        className={`flex items-center gap-1.5 ${
                          compiledPrompt.rulesCheck.audit.problems > 0 ? 'text-rose-200' : 'text-slate-400'
                        }`}
                      >
                        <span
                          aria-hidden
                          className={`h-1 w-1 rounded-full ${
                            compiledPrompt.rulesCheck.audit.problems > 0 ? 'bg-rose-400' : 'bg-slate-600'
                          }`}
                        />
                        {compiledPrompt.rulesCheck.audit.problems} {t.map.rulesAuditProblems}
                      </span>
                      <span className="flex items-center gap-1.5 text-slate-500">
                        <span aria-hidden className="h-1 w-1 rounded-full bg-slate-700" />
                        {compiledPrompt.rulesCheck.audit.notes} {t.map.rulesAuditNotes}
                      </span>
                    </span>
                  )}
                </div>

                {/*
                  The check behind the prompt was made a moment ago, when the prompt was compiled.
                  Saying when keeps the reader from having to wonder how old the facts next to the
                  prompt are.
                */}
                {compiledPrompt.rulesCheck.checkedAt && (
                  <p
                    data-testid="compiler-rules-checked-at"
                    className="text-[10px] text-slate-500 flex items-start gap-1.5"
                  >
                    <History className="w-3 h-3 mt-0.5 shrink-0 text-slate-600" />
                    <span>
                      {t.compiler.rulesCheckCheckedAt}: {formatRulesCheckTime(compiledPrompt.rulesCheck.checkedAt)}
                    </span>
                  </p>
                )}

                {!compiledPrompt.rulesCheck.audit.compared.files && (
                  <p className="text-[11px] text-slate-400 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />
                    <span>{t.compiler.rulesCheckNoFolder}</span>
                  </p>
                )}

                {compiledPrompt.rulesCheck.audit.compared.files &&
                  compiledPrompt.rulesCheck.audit.findings.length === 0 && (
                    <p className="text-[11px] text-slate-300 flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 shrink-0 text-emerald-400/80" />
                      <span>{t.compiler.rulesCheckClean}</span>
                    </p>
                  )}

                {compiledPrompt.rulesCheck.audit.findings.length > 0 && (
                  <ul className="space-y-1.5">
                    {compiledPrompt.rulesCheck.audit.findings.map((finding) => (
                      <li key={finding.id} className="flex items-start gap-2">
                        <span
                          className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0 mt-0.5 ${
                            finding.severity === 'problem'
                              ? 'text-rose-200/90 border-rose-500/25 bg-rose-500/[0.06]'
                              : 'text-slate-500 border-slate-800 bg-slate-950/60'
                          }`}
                        >
                          {finding.severity === 'problem' ? t.map.rulesAuditProblemTag : t.map.rulesAuditNoteTag}
                        </span>
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-[11px] text-slate-200">{ruleKindLabel(finding.kind, t)}</p>
                          <p className="text-[11px] font-mono text-slate-400 break-words">
                            {finding.file}
                            {finding.line ? `:${finding.line}` : ''}
                          </p>
                          <p className="text-[11px] text-slate-300 break-words">{finding.evidence}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Architecture / Rule Warnings */}
            {/*
              A warning is a margin note, not a poster: a hairline on the left, the same slate the
              rest of the page uses, and one amber mark to say this is the part to read.
            */}
            {!isCompiling && compiledPrompt?.architectureWarnings && compiledPrompt.architectureWarnings.length > 0 && (
              <div className="border-l-2 border-amber-500/50 pl-3 py-0.5 space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-200/90">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-400/80" />
                  <span>{t.compiler.safetyGuard}</span>
                </div>
                {compiledPrompt.architectureWarnings.map((w, i) => (
                  <p key={i} className="text-[11px] leading-relaxed text-slate-400">
                    • {w}
                  </p>
                ))}
              </div>
            )}

            {/* Compiled Prompt Code Block */}
            {errorMsg && (
              <div className="border-l-2 border-rose-500/50 pl-3 py-0.5 space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-rose-200/90">
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-400/80" />
                  <span>{t.common.error}</span>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-400">{errorMsg}</p>
              </div>
            )}
            {isOutdated && !isCompiling && (
              <div className="border-l-2 border-amber-500/50 pl-3 py-0.5 text-[11px] text-slate-400 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400/70" />
                <span>{t.compiler.outdatedNotice}</span>
              </div>
            )}

            {/*
              While the prompt is written, the run is the screen: the request's own facts, the model
              as it is chosen, and the text it is producing right now — the same terminal the
              beginner flow shows, with the same stop button. A spinner and one grey sentence said
              only that something was happening.
            */}
            {isCompiling ? (
              <RunTerminal
                title={language === 'ru' ? 'Сборка промпта' : 'Building the prompt'}
                waiting={language === 'ru' ? 'жду ответ модели' : 'waiting for the model'}
                onCancel={cancelCompile}
              />
            ) : compiledPrompt ? (
              <div className="relative bg-slate-950/70 border border-slate-800/70 rounded-xl p-4 font-mono text-[11.5px] text-slate-300 overflow-x-auto max-h-96 leading-relaxed whitespace-pre-wrap">
                {compiledPrompt.promptText}
              </div>
            ) : compileOutcome ? (
              <RunTerminal
                title={language === 'ru' ? 'Сборка промпта' : 'Building the prompt'}
                waiting={language === 'ru' ? 'жду ответ модели' : 'waiting for the model'}
                onRetry={handleCompile}
              />
            ) : (
              <p className="text-xs text-slate-500 max-w-sm">{t.compiler.startHint}</p>
            )}
          </div>
        </div>
      </div>

      {/*
        Step 3 sits under both columns, not inside the result column. Numbered 1 → 2 on the left and
        the compiled prompt on the right, the old place for "3" made the third step look like a
        footnote to the output instead of the next thing to do with it.
      */}
      <div className="space-y-2">
            {/*
              The answer goes into the field and leaves with one icon: the placeholder names the
              field, the tooltip names where the button goes. No heading and no paragraph above
              both — they said what the placeholder and the icon already say.
            */}
            {onSendToReview && (
              <div className="flex justify-end">
                <button
                  onClick={() =>
                    onSendToReview(
                      simulatedResult.trim(),
                      compiledPrompt?.taskTitle || taskInput.trim(),
                      compiledPrompt?.acceptanceCriteria
                    )
                  }
                  title={simulatedResult.trim() ? t.compiler.reviewPastedCode : t.compiler.goToReview}
                  aria-label={simulatedResult.trim() ? t.compiler.reviewPastedCode : t.compiler.goToReview}
                  className={buttonClass({ variant: 'secondary', size: 'sm', iconOnly: true, className: 'shrink-0' })}
                >
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            )}

            <textarea
              value={simulatedResult}
              onChange={(e) => setSimulatedResult(e.target.value)}
              placeholder={t.compiler.simulatedResultPlaceholder}
              rows={3}
              aria-label={t.compiler.panel4Title}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-200 focus:border-slate-600 font-mono placeholder:text-slate-500"
            />
      </div>
    </div>
  );
};
