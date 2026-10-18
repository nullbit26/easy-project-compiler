import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { FileImplementation, FileInsights, ProjectFile, ProjectState } from '../types';
import { useLanguage } from '../context/LanguageContext';
import {
  describeImplementedApi,
  readWorkspaceFileApi,
  applyFileChangesApi,
  undoFileChangesApi,
  type ApplyChangesResult
} from '../services/api';
import { countFilesByStatus } from '../utils/fileFacts';
import { generateCustomRulesFiles } from '../utils/rulesGenerator';
import {
  RULES_FILE_PATHS,
  ruleFilesToWrite,
  type RuleFileToWrite,
  type RulesContent
} from '../utils/rulesFiles';
import {
  fixRuleDocuments,
  type RuleAuditResult,
  type RuleFindingKind,
  type RulesFixOutcome
} from '../utils/rulesAudit';
import { formatRulesCheckTime, stampFromAudit, type RulesCheckStamp } from '../utils/rulesCheckStamp';
import { auditRulesWithFacts, readFolderFacts, type FolderFacts } from '../services/rulesCheck';
import { ruleKindLabel } from '../utils/rulesFindingLabels';
import { useCopyFlash } from '../utils/copyText';
import {
  Terminal,
  FileCode,
  ShieldCheck,
  RefreshCw,
  Copy,
  Check,
  Sparkles,
  Loader2,
  AlertTriangle,
  ListChecks,
  ArrowRight,
  FolderDown,
  Undo2,
  History,
  X
} from 'lucide-react';

interface ProjectMapProps {
  project: ProjectState | null;
  onOpenNewProjectModal?: () => void;
  /** Stores the AI reading of the files on the project, so it survives a reload. */
  onApplyFileInsights?: (insights: FileInsights) => void;
  /** Keeps corrected rules on the project, so a fix made here is not lost on the next reload. */
  onUpdateRulesContent?: (content: RulesContent) => void;
  /** Keeps the moment of the last comparison, which is what the panel prints under the findings. */
  onRecordRulesCheck?: (stamp: RulesCheckStamp) => void;
}

/** A fix nobody has to think about: a repeat, a dead path, a missing Cursor frontmatter. */
const FIXABLE_KINDS: RuleFindingKind[] = [
  'duplicate-line',
  'missing-file',
  'missing-command',
  'missing-frontmatter'
];

export const ProjectMap: React.FC<ProjectMapProps> = ({
  project,
  onOpenNewProjectModal,
  onApplyFileInsights,
  onUpdateRulesContent,
  onRecordRulesCheck
}) => {
  const { t, language } = useLanguage();
  const isRu = language === 'ru';
  const [selectedFile, setSelectedFile] = useState<ProjectFile | null>(project?.projectMap?.files?.[0] || null);
  const [activeRuleTab, setActiveRuleTab] = useState<'agents' | 'claude' | 'cursor'>('agents');
  const ruleCopy = useCopyFlash(2000);
  const [isDescribing, setIsDescribing] = useState(false);
  const [describeError, setDescribeError] = useState('');

  useEffect(() => {
    setSelectedFile(project?.projectMap?.files?.[0] || null);
    setDescribeError('');
    // A fix belongs to the project it was made on: another project's rules are its own.
    setFixedRules(null);
    setFixOutcome(null);
    setAuditError('');
  }, [project?.id]);

  /* ------------------------------------------------------------------ *
   * Writing the rules into the connected folder. The state is declared here, above the
   * "no project" return, so the hooks are always in the same order — a screen that starts empty
   * and then gets a project must not change how many hooks it calls.
   * ------------------------------------------------------------------ */

  const [folderRoot, setFolderRoot] = useState<string | null>(null);
  const [folderKnown, setFolderKnown] = useState(false);
  const [writeStep, setWriteStep] = useState<'idle' | 'confirm' | 'done'>('idle');
  const [existingFiles, setExistingFiles] = useState<Record<string, boolean>>({});
  const [isChecking, setIsChecking] = useState(false);
  const [isWriting, setIsWriting] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [writeError, setWriteError] = useState('');
  const [writeResult, setWriteResult] = useState<ApplyChangesResult | null>(null);
  const [undoDone, setUndoDone] = useState(false);

  /*
   * The freshness check. A rule file is written once and then the project moves on, so the only
   * useful thing to say about it is what the folder itself says: the line repeats, the file it
   * names is gone, the script it calls was deleted. Everything below is that comparison — against
   * real paths and a real package.json, never against an opinion of how rules should read.
   */

  const [workspacePaths, setWorkspacePaths] = useState<string[] | null>(null);
  const [packageScripts, setPackageScripts] = useState<string[] | null>(null);
  const [audit, setAudit] = useState<RuleAuditResult | null>(null);
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [fixOutcome, setFixOutcome] = useState<RulesFixOutcome | null>(null);
  /** The corrected rules, which replace what is shown and what gets written from then on. */
  const [fixedRules, setFixedRules] = useState<RulesContent | null>(null);

  /**
   * What the folder really holds: every path in it, and the scripts its package.json declares. Both
   * come from the one shared reading, so this panel and the check that follows a written batch are
   * looking at the same folder through the same code.
   */
  const loadFolderFacts = useCallback(async (): Promise<FolderFacts> => {
    const facts = await readFolderFacts(language);
    setFolderRoot(facts.root);
    setWorkspacePaths(facts.workspacePaths);
    setPackageScripts(facts.packageScripts);
    return facts;
  }, [language]);

  /** Whether there is a folder to write into at all — the button is meaningless without one. */
  useEffect(() => {
    let cancelled = false;
    loadFolderFacts()
      .catch(() => {
        if (cancelled) return;
        setFolderRoot(null);
        setWorkspacePaths(null);
        setPackageScripts(null);
      })
      .finally(() => {
        if (!cancelled) setFolderKnown(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loadFolderFacts, project?.id]);

  /**
   * The three documents as they would be written right now. A project that never generated its
   * rules still gets real ones rather than a stub, and a fix made on this screen wins over both:
   * what the panel shows has to be exactly what the write puts on disk.
   */
  const rulesContent = useMemo<RulesContent | null>(() => {
    if (!project) return null;
    return (
      fixedRules ||
      project.rulesFilesContent ||
      generateCustomRulesFiles({
        projectName: project.name,
        projectType: project.projectType,
        engineOrFramework: project.engineOrFramework,
        language: project.language,
        selectedAgent: project.selectedAgent,
        uiLanguage: language
      })
    );
  }, [project, fixedRules, language]);

  const rulesToWrite = useMemo<RuleFileToWrite[]>(
    () => (project && rulesContent ? ruleFilesToWrite(rulesContent, project.name) : []),
    [project, rulesContent]
  );

  /**
   * The check reruns whenever the rules or the folder facts change, so the state on screen is never
   * a reading of a document that has since been edited.
   *
   * Redrawing is not a new check: it compares the same documents with the same folder facts, so it
   * deliberately does not move the recorded date. The date belongs to the comparisons that were made
   * on purpose — after a written batch, or when somebody pressed the button.
   */
  useEffect(() => {
    if (!folderKnown || rulesToWrite.length === 0) return;
    setAudit(auditRulesWithFacts(rulesToWrite, { workspacePaths, packageScripts }));
  }, [folderKnown, rulesToWrite, workspacePaths, packageScripts]);

  /** The button makes a real comparison, so the panel dates it. */
  const handleRecheck = async () => {
    setIsAuditing(true);
    setAuditError('');
    try {
      const facts = await loadFolderFacts();
      if (rulesToWrite.length > 0) {
        onRecordRulesCheck?.(stampFromAudit(auditRulesWithFacts(rulesToWrite, facts)));
      }
    } catch (err: any) {
      setAuditError(err?.userMessage || err?.message || t.map.rulesAuditFailed);
    } finally {
      setIsAuditing(false);
    }
  };

  const fixableFindings = (audit?.findings || []).filter(
    (finding) => finding.severity === 'problem' && FIXABLE_KINDS.includes(finding.kind)
  );

  /**
   * Fixes only what can be fixed without judgement, and keeps the result: a contradiction stays on
   * screen because which half of it is right is the author's decision, not this button's.
   */
  const handleFixRules = () => {
    if (!project || !audit || fixableFindings.length === 0) return;
    const outcome = fixRuleDocuments(rulesToWrite, audit.findings, project.name);

    const byKey: Record<RuleFileToWrite['key'], string> = { agents: '', claude: '', cursor: '' };
    for (const file of outcome.files) byKey[file.key] = file.content;
    const content: RulesContent = { agentsMd: byKey.agents, claudeMd: byKey.claude, cursorRules: byKey.cursor };

    setFixedRules(content);
    setFixOutcome(outcome);
    onUpdateRulesContent?.(content);

    // The corrected documents are a new comparison, against folder facts that were already read.
    if (onRecordRulesCheck) {
      onRecordRulesCheck(stampFromAudit(auditRulesWithFacts(outcome.files, { workspacePaths, packageScripts })));
    }
  };

  if (!project) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 short:p-5 text-center space-y-4 max-w-lg mx-auto my-12 short:my-2">
        <div className="w-12 h-12 rounded-2xl bg-indigo-950 text-indigo-400 border border-indigo-800 flex items-center justify-center mx-auto">
          <Terminal className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-white">{t.common.noProjectSelected}</h3>
        <p className="text-xs text-slate-400">{t.common.noProjectSubtext}</p>
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

  const files = project.projectMap?.files || [];
  const arch = project.projectMap?.detectedArchitecture;
  const insights = project.projectMap?.insights;
  const counts = countFilesByStatus(files);
  const hasLocalFacts = Object.values(counts).some((count) => count > 0);
  const insightFor = (filePath: string) =>
    (insights?.files || []).find((file) => file.path.toLowerCase() === filePath.toLowerCase());

  const statusText = (status: FileImplementation) =>
    status === 'implemented'
      ? t.map.statusImplemented
      : status === 'partial'
      ? t.map.statusPartial
      : status === 'stub'
      ? t.map.statusStub
      : t.map.statusEmpty;

  /* Tone, not frames: each status is a tinted label. A border on top of a tint at this size only
     makes a row of chips look like a row of cages. */
  const statusStyle: Record<FileImplementation, string> = {
    implemented: 'bg-emerald-500/10 text-emerald-300',
    partial: 'bg-amber-500/10 text-amber-300',
    stub: 'bg-slate-800 text-slate-300',
    empty: 'bg-rose-500/10 text-rose-300'
  };

  // Exactly what the write puts on disk, tabs and all — one source, so the panel cannot drift from
  // the file that is about to be created.
  const currentRuleText = rulesToWrite.find((file) => file.key === activeRuleTab)?.content ?? '';

  const handleCopyRules = async () => {
    await ruleCopy.copy(currentRuleText);
  };

  /* ------------------------------------------------------------------ *
   * Writing the rules into the connected folder.
   * ------------------------------------------------------------------ */

  /**
   * What is already in the folder is asked of the files themselves, not guessed from a scan: a
   * wrong "will be created" next to a file that is about to be overwritten would be a lie.
   */
  const handleOpenConfirm = async () => {
    setIsChecking(true);
    setWriteError('');
    try {
      const found = await Promise.all(
        rulesToWrite.map((file) =>
          readWorkspaceFileApi(file.path)
            .then(() => true)
            .catch(() => false)
        )
      );
      const map: Record<string, boolean> = {};
      rulesToWrite.forEach((file, index) => {
        map[file.path] = found[index];
      });
      setExistingFiles(map);
      setWriteStep('confirm');
    } finally {
      setIsChecking(false);
    }
  };

  const handleWriteRules = async () => {
    setIsWriting(true);
    setWriteError('');
    try {
      const result = await applyFileChangesApi(
        rulesToWrite.map((file) => ({
          path: file.path,
          action: existingFiles[file.path] ? 'update' : 'create',
          content: file.content
        })),
        isRu ? 'Файлы правил для агентов' : 'Agent rules files'
      );
      setWriteResult(result);
      setWriteStep('done');
    } catch (err: any) {
      setWriteError(err?.userMessage || err?.message || t.map.rulesWriteFailed);
    } finally {
      setIsWriting(false);
    }
  };

  const handleUndoWrite = async () => {
    if (!writeResult) return;
    setIsUndoing(true);
    setWriteError('');
    try {
      await undoFileChangesApi(writeResult.backupId);
      setUndoDone(true);
    } catch (err: any) {
      setWriteError(err?.userMessage || err?.message || t.map.rulesUndoFailed);
    } finally {
      setIsUndoing(false);
    }
  };

  const closeWriteFlow = () => {
    setWriteStep('idle');
    setWriteResult(null);
    setUndoDone(false);
    setWriteError('');
  };

  /**
   * The AI reading is asked for explicitly: it costs a request, and the deterministic reading above
   * already answers what is implemented. When the answer cannot be read, the facts stay on screen.
   */
  const handleDescribeImplemented = async () => {
    if (isDescribing || files.length === 0) return;
    setIsDescribing(true);
    setDescribeError('');
    try {
      const result = await describeImplementedApi({
        paths: files.slice(0, 60).map((file) => file.path),
        projectName: project.name,
        language
      });
      onApplyFileInsights?.(result);
    } catch (err: any) {
      setDescribeError(err?.userMessage || err?.message || t.map.describeFailed);
    } finally {
      setIsDescribing(false);
    }
  };

  const selectedInsight = selectedFile ? insightFor(selectedFile.path) : undefined;

  return (
    <div className="space-y-6">
      {/* What the real files already contain */}
      {(hasLocalFacts || arch || insights) && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          {/* No heading: the chips themselves are the facts, and each names what it counts. */}
          <div className="flex flex-wrap items-center gap-2">
            {(['implemented', 'partial', 'stub', 'empty'] as FileImplementation[])
              .filter((status) => counts[status] > 0)
              .map((status) => (
                <span
                  key={status}
                  className={`text-[11px] font-bold px-2 py-1 rounded-lg ${statusStyle[status]}`}
                >
                  {statusText(status)}: {counts[status]}
                </span>
              ))}
            {arch?.mainEntry && (
              <span
                title={t.map.mainEntryLabel}
                className="text-[11px] font-mono bg-slate-800/50 text-indigo-300 px-2 py-1 rounded-lg"
              >
                {arch.mainEntry}
              </span>
            )}
            {typeof arch?.componentsOrScriptsCount === 'number' && (
              <span
                title={t.map.scriptsWithCode}
                className="text-[11px] bg-slate-800/50 text-slate-300 px-2 py-1 rounded-lg"
              >
                {arch.componentsOrScriptsCount}
              </span>
            )}
            {arch && (
              <span
                className={`text-[11px] px-2 py-1 rounded-lg ${
                  arch.hasTests
                    ? 'bg-emerald-500/10 text-emerald-300'
                    : 'bg-amber-500/10 text-amber-300'
                }`}
              >
                {arch.hasTests ? t.map.testsPresent : t.map.testsMissing}
              </span>
            )}
            {typeof arch?.fileCount === 'number' && (
              <span
                title={t.map.analyzedFilesLabel}
                className="text-[11px] bg-slate-800/50 text-slate-400 px-2 py-1 rounded-lg"
              >
                {arch.fileCount}
              </span>
            )}
            {insights?.engine && (
              <span className="text-[10px] font-mono bg-slate-800/50 text-slate-400 px-2 py-1 rounded-lg">
                {insights.engine}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleDescribeImplemented}
              disabled={isDescribing || files.length === 0}
              title={isDescribing ? t.map.describingButton : t.map.describeButton}
              aria-label={isDescribing ? t.map.describingButton : t.map.describeButton}
              className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 enabled:hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white transition-all enabled:cursor-pointer"
            >
              {isDescribing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            </button>
            {describeError && (
              <span className="text-[11px] text-rose-300 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                {describeError}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Interactive File Tree (5 cols) */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
              {isRu ? 'Проверенные файлы' : 'Verified File Index'} ({files.length})
            </h3>
            <span className="text-[10px] text-slate-400 font-semibold">{project.projectType}</span>
          </div>

          {/* Files List */}
          <div className="space-y-1.5 max-h-[500px] overflow-y-auto pr-1">
            {files.map((file) => {
              const isSelected = selectedFile?.path === file.path;
              return (
                <div
                  key={file.path}
                  onClick={() => setSelectedFile(file)}
                  className={`p-2.5 rounded-lg text-xs cursor-pointer transition-colors flex items-center justify-between gap-2 ${
                    isSelected
                      ? 'bg-indigo-500/10 text-slate-100 font-semibold'
                      : 'text-slate-400 hover:bg-slate-950/60 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <FileCode className="w-4 h-4 text-slate-500 shrink-0" />
                    <span className="font-mono text-[11px] truncate">{file.path}</span>
                  </div>
                  <span className="flex items-center gap-1 shrink-0">
                    {file.status && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          statusStyle[file.status]
                        }`}
                        title={statusText(file.status)}
                      >
                        {file.symbols?.length ? `${file.symbols.length}` : statusText(file.status).slice(0, 1)}
                      </span>
                    )}
                    <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-bold uppercase">
                      {file.type}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: File Details & Rules Generator (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          {/* Selected File Symbol Breakdown */}
          {selectedFile && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
              {/*
                The path is the title: on a file that is named, an eyebrow saying "file metadata"
                repeated the one thing the reader had already clicked.
              */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <h4 className="text-sm font-bold text-white font-mono truncate">{selectedFile.path}</h4>
                <span className="text-[10px] bg-slate-800/60 text-slate-400 px-2 py-0.5 rounded font-semibold uppercase shrink-0">
                  {selectedFile.type}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {selectedFile.status && (
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                      statusStyle[selectedFile.status]
                    }`}
                  >
                    {statusText(selectedFile.status)}
                  </span>
                )}
                {typeof selectedFile.codeLines === 'number' && (
                  <span className="text-[11px] bg-slate-800/50 text-slate-400 px-2 py-0.5 rounded">
                    {selectedFile.codeLines} {t.map.codeLinesLabel}
                  </span>
                )}
              </div>

              <p className="text-xs text-slate-300">{selectedFile.description}</p>

              {/* Symbols */}
              {selectedFile.symbols && selectedFile.symbols.length > 0 && (
                <div className="space-y-1 pt-2 border-t border-slate-800">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    {t.map.symbolsTitle}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedFile.symbols.map((sym, i) => (
                      <span
                        key={i}
                        className="text-[11px] font-mono bg-slate-800/50 text-slate-300 px-2 py-0.5 rounded"
                      >
                        {sym}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Imports */}
              {selectedFile.imports && selectedFile.imports.length > 0 && (
                <div className="space-y-1 pt-2 border-t border-slate-800">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    {t.map.importsTitle}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedFile.imports.map((item, i) => (
                    <span
                      key={i}
                      className="text-[11px] font-mono bg-slate-950 border border-slate-800 text-slate-400 px-2 py-0.5 rounded"
                      title={t.map.importsTitle}
                    >
                      {item}
                    </span>
                    ))}
                  </div>
                </div>
              )}

              {/* What the AI found in this very file */}
              {selectedInsight && (
                <div className="space-y-1 pt-2 border-t border-slate-800">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3" />
                  {t.map.fileInsightTitle}
                </span>
                  {selectedInsight.implemented.length > 0 ? (
                    <ul className="space-y-1">
                      {selectedInsight.implemented.map((line, i) => (
                        <li key={i} className="text-xs text-slate-300 flex items-start gap-1.5">
                          <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-slate-400">{t.map.fileInsightEmpty}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* The AI reading of the whole project */}
          {insights && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3" />
                  {t.map.insightsTitle}
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {new Date(insights.generatedAt).toLocaleString(isRu ? 'ru-RU' : 'en-US')}
                </span>
              </div>

              <p className="text-xs text-slate-200 leading-relaxed">{insights.overall}</p>

              {insights.nextSteps.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-slate-800">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <ListChecks className="w-3.5 h-3.5 text-slate-500" />
                    {t.map.insightsNextSteps}
                  </span>
                  <ul className="space-y-1">
                    {insights.nextSteps.map((step, i) => (
                      <li key={i} className="text-xs text-slate-300 flex items-start gap-1.5">
                        <ArrowRight className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                        <span>{step}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* AI Agent Rules Generator Panel */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            {/*
              No heading over the tabs: AGENTS.md / CLAUDE.md / .cursor/rules say what this panel is.
              Copy copies the open tab — its title names which one, the tooltip says the rest.
            */}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={handleCopyRules}
                title={
                  ruleCopy.state === 'copied'
                    ? t.common.copied
                    : ruleCopy.state === 'failed'
                    ? t.common.copyFailed
                    : t.map.copyRulesButton
                }
                aria-label={
                  ruleCopy.state === 'copied'
                    ? t.common.copied
                    : ruleCopy.state === 'failed'
                    ? t.common.copyFailed
                    : t.map.copyRulesButton
                }
                className={`grid h-8 w-8 place-items-center rounded-lg transition-all cursor-pointer ${
                  ruleCopy.state === 'copied'
                    ? 'bg-emerald-700 text-emerald-100'
                    : ruleCopy.state === 'failed'
                    ? 'bg-amber-800 text-amber-100'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                }`}
              >
                {ruleCopy.state === 'copied' ? (
                  <Check className="w-4 h-4" />
                ) : ruleCopy.state === 'failed' ? (
                  <AlertTriangle className="w-4 h-4" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>

              <button
                onClick={handleOpenConfirm}
                disabled={!folderRoot || isChecking || isWriting}
                title={folderRoot ? folderRoot : t.map.rulesNoFolder}
                aria-label={t.map.rulesWriteButton}
                className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 enabled:hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white shadow-sm transition-all enabled:cursor-pointer"
              >
                {isChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderDown className="w-4 h-4" />}
              </button>
            </div>

            {folderKnown && !folderRoot && (
              <div className="flex items-start gap-2 bg-slate-950/60 rounded-lg px-3 py-2 text-[11px] text-slate-400">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />
                <span>{t.map.rulesNoFolder}</span>
              </div>
            )}

            {/* Rule File Selector Tabs */}
            <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-semibold">
              <button
                onClick={() => setActiveRuleTab('agents')}
                className={`py-1.5 rounded-md transition-all cursor-pointer ${
                  activeRuleTab === 'agents' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                AGENTS.md
              </button>

              <button
                onClick={() => setActiveRuleTab('claude')}
                className={`py-1.5 rounded-md transition-all cursor-pointer ${
                  activeRuleTab === 'claude' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                CLAUDE.md
              </button>

              <button
                onClick={() => setActiveRuleTab('cursor')}
                className={`py-1.5 rounded-md transition-all cursor-pointer ${
                  activeRuleTab === 'cursor' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {RULES_FILE_PATHS.cursor}
              </button>
            </div>

            {/* Rules Text Editor / Viewer */}
            {/* The only field on this screen without a visible label of its own: the panel's own
                heading names it, so a screen reader gets that name instead of an empty box. */}
            <textarea
              readOnly
              value={currentRuleText}
              rows={8}
              data-testid="rules-text"
              aria-label={t.map.rulesTitle}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-200 font-mono leading-relaxed"
            />

            {/*
              The freshness check, on the same screen as the rules it is about. Its findings are
              read from the folder and from the documents themselves, so the panel states facts and
              says which facts it could not get — instead of implying the rules are fine.
            */}
            <div
              data-testid="rules-audit"
              className="bg-slate-950/60 rounded-lg p-3 space-y-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{t.map.rulesAuditTitle}</span>
                </span>

                <div className="flex items-center gap-2">
                  {audit && (
                    <>
                      <span
                        data-testid="rules-audit-problems"
                        className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          audit.problems > 0
                            ? 'bg-rose-500/10 text-rose-300'
                            : 'bg-emerald-500/10 text-emerald-300'
                        }`}
                      >
                        {audit.problems} {t.map.rulesAuditProblems}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800/60 text-slate-400">
                        {audit.notes} {t.map.rulesAuditNotes}
                      </span>
                    </>
                  )}

                  <button
                    onClick={handleRecheck}
                    disabled={isAuditing}
                    className="bg-slate-800 enabled:hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-bold text-[10px] px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 enabled:cursor-pointer"
                  >
                    {isAuditing ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3" />
                    )}
                    <span>{isAuditing ? t.map.rulesAuditChecking : t.map.rulesAuditRecheck}</span>
                  </button>
                </div>
              </div>

              {/*
                When the rules were last compared with the folder. The check runs by itself after
                every written batch, so this line is usually the answer to "is what I am reading
                still about the folder that is on disk?". A project nobody has checked yet says so
                instead of showing a date that would imply otherwise.
              */}
              <p
                data-testid="rules-last-check"
                className="text-[10px] text-slate-400 flex items-start gap-1.5"
              >
                <History className="w-3 h-3 mt-0.5 shrink-0 text-slate-400" />
                <span>
                  {project.lastRulesCheck
                    ? `${t.map.rulesLastCheck}: ${formatRulesCheckTime(project.lastRulesCheck.at)} · ${project.lastRulesCheck.problems} ${t.map.rulesAuditProblems} · ${project.lastRulesCheck.notes} ${t.map.rulesAuditNotes}`
                    : t.map.rulesLastCheckNever}
                </span>
              </p>

              {/* Before the first reading there is nothing honest to report yet — say so. */}
              {!audit && !auditError && (
                <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span>{t.map.rulesAuditChecking}</span>
                </p>
              )}

              {auditError && (
                <p className="text-[11px] text-rose-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>{auditError}</span>
                </p>
              )}

              {audit && !audit.compared.files && (
                <p className="text-[11px] text-slate-400 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />
                  <span>{t.map.rulesAuditNoFolder}</span>
                </p>
              )}

              {audit && audit.findings.length === 0 && (
                <p className="text-[11px] text-emerald-300 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  <span>{t.map.rulesAuditClean}</span>
                </p>
              )}

              {audit && audit.findings.length > 0 && (
                <ul className="space-y-2">
                  {audit.findings.map((finding) => (
                    <li key={finding.id} className="flex items-start gap-2">
                      <span
                        className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${
                          finding.severity === 'problem'
                            ? 'bg-rose-500/10 text-rose-300'
                            : 'bg-slate-800/60 text-slate-400'
                        }`}
                      >
                        {finding.severity === 'problem'
                          ? t.map.rulesAuditProblemTag
                          : t.map.rulesAuditNoteTag}
                      </span>

                      <div className="min-w-0 space-y-0.5">
                        <p className="text-[11px] text-slate-200">{ruleKindLabel(finding.kind, t)}</p>
                        <p className="text-[11px] font-mono text-slate-400 break-words">
                          {finding.file}
                          {finding.line ? `:${finding.line}` : ''}
                          {finding.againstLines?.length
                            ? ` · ${t.map.rulesAuditAlso} ${finding.againstLines.join(', ')}`
                            : ''}
                        </p>
                        <p className="text-[11px] text-slate-300 break-words">{finding.evidence}</p>
                        {finding.against && (
                          <p className="text-[11px] text-slate-400 break-words">↳ {finding.against}</p>
                        )}
                        {finding.missing && (
                          <p className="text-[10px] font-mono text-amber-300 break-all">
                            {finding.missing}
                            {finding.context === 'no-package-json' ? ` — ${t.map.rulesAuditNoPackageJson}` : ''}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {fixableFindings.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-slate-800">
                  <button
                    onClick={handleFixRules}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>
                      {t.map.rulesAuditFix} ({fixableFindings.length})
                    </span>
                  </button>                  </div>
              )}

              {fixOutcome && (
                <p
                  data-testid="rules-audit-fix-outcome"
                  className="text-[11px] text-emerald-300 flex items-start gap-1.5 pt-2 border-t border-slate-800"
                >
                  <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    {t.map.rulesAuditFixed} {fixOutcome.removedDuplicates} {t.map.rulesAuditRemovedDuplicates}
                    {' · '}
                    {fixOutcome.removedBrokenReferences} {t.map.rulesAuditRemovedReferences}
                    {' · '}
                    {fixOutcome.addedFrontmatter} {t.map.rulesAuditAddedFrontmatter}
                    {onUpdateRulesContent ? ` · ${t.map.rulesAuditSaved}` : ''}
                  </span>
                </p>
              )}
            </div>

            {writeError && (
              <div className="bg-rose-950/40 border border-rose-900 rounded-lg p-3 text-[11px] text-rose-200 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{writeError}</span>
              </div>
            )}

            {/* What is about to happen to the folder, before anything is written into it. */}
            {writeStep === 'confirm' && (
              <div
                data-testid="rules-write-confirm"
                className="bg-slate-950 border border-indigo-800/60 rounded-lg p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">
                    {t.map.rulesConfirmTitle}
                  </span>
                  <button
                    onClick={closeWriteFlow}
                    aria-label={t.common.cancel}
                    className="text-slate-400 hover:text-slate-300 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <p className="text-[11px] font-mono text-slate-400 break-all">{folderRoot}</p>

                <ul className="space-y-1">
                  {rulesToWrite.map((file) => (
                    <li key={file.path} className="flex items-center justify-between gap-3 text-[11px]">
                      <span className="font-mono text-slate-200 truncate">{file.path}</span>
                      <span className={existingFiles[file.path] ? 'text-amber-300 shrink-0' : 'text-emerald-300 shrink-0'}>
                        {existingFiles[file.path] ? t.map.rulesReplace : t.map.rulesCreate}
                      </span>
                    </li>
                  ))}
                </ul>

                <p className="text-[10px] text-slate-400">{t.map.rulesReplaceNote}</p>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={handleWriteRules}
                    disabled={isWriting}
                    className="bg-indigo-600 enabled:hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-[11px] px-3 py-1.5 rounded-lg enabled:cursor-pointer flex items-center gap-1.5"
                  >
                    {isWriting ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderDown className="w-3 h-3" />}
                    <span>{isWriting ? t.map.rulesWriting : t.map.rulesWriteConfirm}</span>
                  </button>
                  <button
                    onClick={closeWriteFlow}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-[11px] px-3 py-1.5 rounded-lg cursor-pointer"
                  >
                    {t.common.cancel}
                  </button>
                </div>
              </div>
            )}

            {/* What actually happened, file by file, with the way back. */}
            {writeStep === 'done' && writeResult && (
              <div
                data-testid="rules-write-result"
                className="bg-slate-950 border border-emerald-800/60 rounded-lg p-3 space-y-2"
              >
                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                  {t.map.rulesWritten}
                </span>

                <ul className="space-y-1">
                  {writeResult.results.map((entry) => (
                    <li key={entry.path} className="flex items-center justify-between gap-3 text-[11px]">
                      <span className="font-mono text-slate-200 truncate">{entry.path}</span>
                      <span
                        className={`shrink-0 ${
                          entry.status === 'failed' || entry.status === 'skipped' ? 'text-rose-300' : 'text-emerald-300'
                        }`}
                        title={entry.error || undefined}
                      >
                        {entry.status === 'created'
                          ? t.map.rulesStatusCreated
                          : entry.status === 'updated'
                          ? t.map.rulesStatusUpdated
                          : entry.error || t.map.rulesStatusSkipped}
                      </span>
                    </li>
                  ))}
                </ul>

                {writeResult.formatting?.ran && (
                  <p className="text-[10px] text-slate-400">
                    {t.map.rulesFormatted} {writeResult.formatting.toolLabel || writeResult.formatting.tool}
                  </p>
                )}

                {undoDone ? (
                  <p className="text-[11px] text-emerald-300 flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" />
                    {t.map.rulesUndone}
                  </p>
                ) : (
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={handleUndoWrite}
                      disabled={isUndoing}
                      className="bg-amber-950/60 enabled:hover:bg-amber-900/60 border border-amber-800 text-amber-200 font-bold text-[11px] px-3 py-1.5 rounded-lg enabled:cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isUndoing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />}
                      <span>{isUndoing ? t.map.rulesUndoing : t.map.rulesUndo}</span>
                    </button>
                  </div>
                )}

                <button
                  onClick={closeWriteFlow}
                  className="text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  {t.map.rulesDone}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
