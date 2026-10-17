import React, { useState, useEffect } from 'react';
import { ProjectState, AgentType, ContextMode, CompiledPrompt } from '../types';
import { compilePromptApi } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { autonomyOf } from '../utils/workingMode';
import { journeyHeading, journeyNumber } from '../utils/journeySteps';
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
  const [errorMsg, setErrorMsg] = useState('');
  const [compiledPrompt, setCompiledPrompt] = useState<CompiledPrompt | null>(null);
  const [compiledSignature, setCompiledSignature] = useState('');
  const [copied, setCopied] = useState(false);
  const [simulatedResult, setSimulatedResult] = useState('');

  /**
   * Mix of everything that changes the compiled result. It is captured when a compile runs and
   * compared afterwards, so an edited task shows "press Start again" instead of silently
   * firing a new request the moment the user opens the screen or types a letter.
   */
  const buildSignature = () =>
    JSON.stringify([taskInput, selectedAgent, contextMode, [...selectedFilePaths].sort(), project?.id || '']);

  const isOutdated = Boolean(compiledPrompt) && compiledSignature !== buildSignature();

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

    try {
      const activeFiles = (project.projectMap?.files || []).filter(
        (f) => selectedFilePaths.length === 0 || selectedFilePaths.includes(f.path)
      );
      const scopedProjectMap = {
        ...project.projectMap,
        files: activeFiles
      };

      const data = await compilePromptApi({
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
      });

      setCompiledPrompt(data);
      setCompiledSignature(signature);
    } catch (err: any) {
      console.error('Failed to compile prompt:', err);
      setErrorMsg(err?.userMessage || err?.message || 'Failed to compile prompt.');
    } finally {
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
          <button
            onClick={onOpenNewProjectModal}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all cursor-pointer inline-flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            <span>{t.common.newProject}</span>
          </button>
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

  const handleCopyPrompt = () => {
    if (!compiledPrompt) return;
    navigator.clipboard.writeText(compiledPrompt.promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
          <span className="w-6 h-6 rounded-lg bg-indigo-500/15 text-indigo-300 flex items-center justify-center font-bold text-xs shrink-0">
            {journeyNumber('prompt')}
          </span>
          <h2 className="text-sm font-semibold text-white">{journeyHeading('prompt', t)}</h2>
        </div>

        <div className="flex items-center gap-3">
          {/*
            Whom this prompt is being built for — the project's own setting, changed here because
            this is the screen that uses it.
          */}
          {offersAgentPicker ? (
            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 shrink-0">
              <Cpu className="w-4 h-4 text-indigo-400" />
              <span className="text-xs text-slate-400 font-medium">{t.common.targetAgent}</span>
              <select
                value={selectedAgent}
                onChange={(e) => onSelectAgent?.(e.target.value as AgentType)}
                aria-label={t.common.targetAgent}
                className="bg-transparent text-xs font-bold text-indigo-300 cursor-pointer"
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
            <span className="flex items-center gap-1.5 text-xs text-slate-400 shrink-0">
              <Cpu className="w-3.5 h-3.5 text-indigo-400/70" />
              <span>{t.common.targetAgent}</span>
              <span data-testid="compiler-agent-value" className="font-bold text-indigo-300">
                {agentLabel}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* 4-Panel Compiler Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Intent Input & Context Selector (5 cols) */}
        <div className="lg:col-span-5 space-y-5">
          {/*
            Panel 1: Task / Intent Input.

            The three panels of this stage used to be numbered 1, 2 and 3 — under a header that
            already said "Step 1" and with the second screen of the loop called "Step 2". A reader
            counting digits met two numbering systems in one screen, so the panels now say what they
            hold and the order is carried by the layout alone.
          */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <label className="block text-xs font-bold text-slate-200">{t.compiler.panel1Title}</label>

            <textarea
              value={taskInput}
              onChange={(e) => setTaskInput(e.target.value)}
              placeholder={t.compiler.taskPlaceholder}
              rows={3}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-100 focus:border-indigo-500 transition-colors"
            />

            {/* Quick Task Selector from Plan */}
            <div className="space-y-2">
              <span className="text-[11px] font-semibold text-slate-400 block">{t.compiler.chooseTaskFromPlan}</span>
              <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
                {project.phases.map((phase) => (
                  <div key={phase.id} className="space-y-1">
                    <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider block">
                      {language === 'ru' ? `Этап ${phase.phaseNumber}` : `Phase ${phase.phaseNumber}`}: {cleanPhaseTitle(phase.title)}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {phase.tasks.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setTaskInput(t.title)}
                          className={`text-[10px] px-2 py-1 rounded-md border font-medium transition-all cursor-pointer flex items-center gap-1 ${
                            taskInput === t.title
                              ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                              : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <span>{t.title}</span>
                          {t.status === 'completed' && <span className="text-emerald-400 font-bold text-[9px]">✓</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Panel 2: Context Mode & File Budget Selector */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <label className="block text-xs font-bold text-slate-200">{t.compiler.panel2Title}</label>

            {settingsAreChosenForUser && !showContextSetup ? (
              <div className="space-y-2 bg-slate-950/60 border border-slate-800 rounded-lg p-3">
                <p className="text-[11px] text-slate-400">{t.compiler.autoChosen}</p>
                <p className="text-xs font-bold text-slate-200">
                  {contextMode === 'Minimal'
                    ? t.contextModes.minimal
                    : contextMode === 'Balanced'
                    ? t.contextModes.balanced
                    : t.contextModes.full}
                  {' · '}
                  {t.compiler.verifiedFileIndex} {selectedFilePaths.length}/{availableFiles.length}
                </p>
                <button
                  onClick={() => setShowContextSetup(true)}
                  className="text-[11px] font-bold text-indigo-300 hover:text-indigo-200 bg-indigo-600/15 border border-indigo-500/40 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                >
                  {t.compiler.customizeContext}
                </button>
              </div>
            ) : (
              <>
            {/* Context Mode Toggle */}
            <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px] font-semibold">
              {(['Minimal', 'Balanced', 'Full'] as ContextMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setContextMode(mode)}
                  className={`py-1.5 rounded-md transition-all cursor-pointer ${
                    contextMode === mode
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {mode === 'Minimal' ? t.contextModes.minimal : mode === 'Balanced' ? t.contextModes.balanced : t.contextModes.full}
                </button>
              ))}
            </div>

            <p className="text-[11px] text-slate-400">
              {contextMode === 'Minimal' && t.contextModes.minimalDesc}
              {contextMode === 'Balanced' && t.contextModes.balancedDesc}
              {contextMode === 'Full' && t.contextModes.fullDesc}
            </p>

            {/* Available Files Checklist */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <span className="text-[11px] font-bold text-slate-300">
                {t.compiler.verifiedFileIndex} ({selectedFilePaths.length}/{availableFiles.length})
              </span>

              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {availableFiles.map((file) => {
                  const isChecked = selectedFilePaths.includes(file.path);
                  return (
                    <label
                      key={file.path}
                      className={`flex items-center justify-between p-2 rounded-lg text-xs cursor-pointer transition-colors ${
                        isChecked
                          ? 'bg-indigo-500/10 text-slate-200'
                          : 'text-slate-400 hover:bg-slate-950/60 hover:text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleFile(file.path)}
                          className="rounded border-slate-700 bg-slate-900 text-indigo-600 cursor-pointer"
                        />
                        <FileCode className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        <span className="font-mono text-[11px] truncate">{file.path}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-semibold uppercase shrink-0">
                        {file.type}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {settingsAreChosenForUser && (
              <button
                onClick={() => setShowContextSetup(false)}
                className="text-[11px] font-bold text-slate-300 hover:text-white bg-slate-800 border border-slate-700 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                {t.compiler.hideContextSetup}
              </button>
            )}
              </>
            )}

            {/* The only trigger: compile on demand, never in the background. */}
            <button
              onClick={handleCompile}
              disabled={isCompiling}
              className={`w-full bg-indigo-600 enabled:hover:bg-indigo-500 text-white font-bold text-xs py-2.5 rounded-lg transition-all shadow-sm flex items-center justify-center gap-2 enabled:cursor-pointer disabled:opacity-50 ${
                isOutdated ? 'ring-2 ring-amber-500/50' : ''
              }`}
            >
              {isCompiling ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{t.compiler.compilingPrompt}</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>{compiledPrompt ? t.compiler.recompilePrompt : t.compiler.startCompile}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Column: Compiled Prompt Output & Agent Execution Simulation (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          {/* Panel 3: Compiled Prompt Result */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                {/* No eyebrow above the heading: "РЕЗУЛЬТАТ КОМПИЛЯЦИИ" only repeated
                    "Скомпилированный промпт" one line lower. */}
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  {/* The agent is named once, in the stage header — not again over the output. */}
                  <span>{t.compiler.compiledOutputTitle}</span>
                  {compiledPrompt && (
                    <span className="text-[10px] bg-indigo-950 text-indigo-300 border border-indigo-800 px-2 py-0.5 rounded font-mono">
                      ~{compiledPrompt.estimatedTokens} {language === 'ru' ? 'токенов' : 'tokens'}
                    </span>
                  )}
                </h3>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadPrompt}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                  title={t.common.export}
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{t.common.export}</span>
                </button>

                <button
                  onClick={handleCopyPrompt}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-3 py-1.5 rounded-lg transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? t.common.copied : t.common.copy}</span>
                </button>
              </div>
            </div>

            {/*
              What the prompt was told about the project's rules. The agent's output is only as
              good as the instructions it was given, so the user sees here which of them were
              already stale when the prompt was compiled.
            */}
            {compiledPrompt?.rulesCheck && (
              <div
                data-testid="compiler-rules-check"
                className="bg-slate-950/60 rounded-lg p-3 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>{t.compiler.rulesCheckTitle}</span>
                  </span>

                  {compiledPrompt.rulesCheck.audit.compared.files && (
                    <span className="flex items-center gap-2">
                      <span
                        data-testid="compiler-rules-problems"
                        className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          compiledPrompt.rulesCheck.audit.problems > 0
                            ? 'bg-rose-500/10 text-rose-300'
                            : 'bg-emerald-500/10 text-emerald-300'
                        }`}
                      >
                        {compiledPrompt.rulesCheck.audit.problems} {t.map.rulesAuditProblems}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800/60 text-slate-400">
                        {compiledPrompt.rulesCheck.audit.notes} {t.map.rulesAuditNotes}
                      </span>
                    </span>
                  )}
                </div>

                <p className="text-[10px] text-slate-400 leading-relaxed">{t.compiler.rulesCheckSubtext}</p>

                {/*
                  The check behind the prompt was made a moment ago, when the prompt was compiled.
                  Saying when keeps the reader from having to wonder how old the facts next to the
                  prompt are.
                */}
                {compiledPrompt.rulesCheck.checkedAt && (
                  <p
                    data-testid="compiler-rules-checked-at"
                    className="text-[10px] text-slate-400 flex items-start gap-1.5"
                  >
                    <History className="w-3 h-3 mt-0.5 shrink-0 text-slate-400" />
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
                    <p className="text-[11px] text-emerald-300 flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 shrink-0" />
                      <span>{t.compiler.rulesCheckClean}</span>
                    </p>
                  )}

                {compiledPrompt.rulesCheck.audit.findings.length > 0 && (
                  <ul className="space-y-1.5">
                    {compiledPrompt.rulesCheck.audit.findings.map((finding) => (
                      <li key={finding.id} className="flex items-start gap-2">
                        <span
                          className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0 mt-0.5 ${
                            finding.severity === 'problem'
                              ? 'bg-rose-950/60 text-rose-300 border-rose-900'
                              : 'bg-slate-900 text-slate-400 border-slate-800'
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
            {compiledPrompt?.architectureWarnings && compiledPrompt.architectureWarnings.length > 0 && (
              <div className="bg-amber-950/40 border border-amber-800/60 rounded-lg p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-amber-300 font-bold text-xs uppercase tracking-wider">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                  <span>{t.compiler.safetyGuard}</span>
                </div>
                {compiledPrompt.architectureWarnings.map((w, i) => (
                  <p key={i} className="text-xs text-slate-300">
                    • {w}
                  </p>
                ))}
              </div>
            )}

            {/* Compiled Prompt Code Block */}
            {errorMsg && (
              <div className="bg-rose-950/40 border border-rose-800/60 rounded-lg p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-rose-300 font-bold text-xs">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>{t.common.error}</span>
                </div>
                <p className="text-xs text-rose-200">{errorMsg}</p>
              </div>
            )}
            {isOutdated && !isCompiling && (
              <div className="bg-amber-950/40 border border-amber-800/60 rounded-lg px-3 py-2 text-[11px] text-amber-200 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{t.compiler.outdatedNotice}</span>
              </div>
            )}

            <div className="relative bg-slate-950/70 rounded-xl p-4 font-mono text-xs text-slate-200 overflow-x-auto max-h-96 leading-relaxed whitespace-pre-wrap">
              {isCompiling ? (
                <div className="flex items-center justify-center py-12 text-slate-400 gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                  <span>{t.compiler.compilingNotice}</span>
                </div>
              ) : compiledPrompt ? (
                compiledPrompt.promptText
              ) : (
                // No second Start button here: the one trigger lives at the end of the form, and a
                // copy inside the empty result box only raised the question of which one to press.
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-center font-sans">
                  <p className="text-xs text-slate-400 max-w-sm">{t.compiler.startHint}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/*
        Step 3 sits under both columns, not inside the result column. Numbered 1 → 2 on the left and
        the compiled prompt on the right, the old place for "3" made the third step look like a
        footnote to the output instead of the next thing to do with it.
      */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-slate-200">
                  {t.compiler.panel4Title}
                </h4>
                <p className="text-[11px] text-slate-400">
                  {t.compiler.panel4Subtext}
                </p>
              </div>

              {onSendToReview && (
                <button
                  onClick={() =>
                    onSendToReview(
                      simulatedResult.trim(),
                      compiledPrompt?.taskTitle || taskInput.trim(),
                      compiledPrompt?.acceptanceCriteria
                    )
                  }
                  className="bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs px-3.5 py-2 rounded-lg shadow-sm transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <span>{simulatedResult.trim() ? t.compiler.reviewPastedCode : t.compiler.goToReview} ➔</span>
                </button>
              )}
            </div>

            <textarea
              value={simulatedResult}
              onChange={(e) => setSimulatedResult(e.target.value)}
              placeholder={t.compiler.simulatedResultPlaceholder}
              rows={3}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-200 focus:border-emerald-500 font-mono placeholder:text-slate-400"
            />
      </div>
    </div>
  );
};
