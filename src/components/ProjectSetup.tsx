import React, { useEffect, useRef, useState } from 'react';
import {
  ProjectState,
  ProjectFile,
  ProjectPhase,
  AgentType,
  AutonomyLevel,
  InterfaceMode,
  TechnicalLevel,
  WorkspaceFacts
} from '../types';
import { AUTONOMY_LEVELS, presetParts } from '../utils/workingMode';
import { UNITY_SEED_PROJECT, REACT_SEED_PROJECT, PHASER_SEED_PROJECT, GODOT_SEED_PROJECT } from '../data/seedProjects';
import { UNITY_SEED_PROJECT_EN, REACT_SEED_PROJECT_EN, PHASER_SEED_PROJECT_EN, GODOT_SEED_PROJECT_EN } from '../data/seedProjectsEn';
import {
  analyzeIdeaApi,
  bindWorkspaceApi,
  createProjectFromIdea,
  fetchWorkspaceApi,
  generateProjectQuestionsApi,
  importWorkspaceApi,
  pickFolderApi,
  type WorkspaceUnderstanding
} from '../services/api';
import { generateCustomRulesFiles } from '../utils/rulesGenerator';
import { RULES_FILE_PATHS } from '../utils/rulesFiles';
import { parseFileList, inferFileType } from '../utils/fileListParser';
import { attachFactsToFiles, detectedArchitectureFromFacts } from '../utils/fileFacts';
import { isSameFolder } from '../utils/folderPath';
import { useLanguage } from '../context/LanguageContext';
import { Sparkles, Upload, Gamepad2, Code2, Cpu, ArrowRight, Loader2, FileCode, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, HelpCircle, HelpCircle as QuestionIcon, ArrowLeft, RefreshCw, ShieldCheck, Layers, Gauge, Settings, FolderOpen, Users } from 'lucide-react';
import { ApiSettingsPanel } from './ApiSettingsPanel';
import { buttonClass } from './ui/Button';

interface ProjectSetupProps {
  onAddProject: (project: ProjectState) => void;
  onClose: () => void;
}

/**
 * The project settings the AI is allowed to fill in. Every one of them is marked as suggested
 * until the user edits it themselves.
 */
type AiField = 'stack' | 'pattern' | 'platform' | 'agent' | 'level';

/** Maps whatever the analysis returns onto the exact value of the engine <select> option. */
function canonicalStack(raw: string): string {
  if (!raw) return '';
  if (raw.includes('Three')) return 'Three.js / React Three Fiber';
  if (raw.includes('Phaser')) return 'Phaser.js 3 (Canvas)';
  if (raw.includes('Godot')) return 'Godot 4.3 (GDScript)';
  if (raw.includes('Unity')) return 'Unity 6 (URP)';
  if (raw.includes('React')) return 'React 19 + Vite';
  if (raw.includes('Pixi')) return 'PixiJS v8';
  return raw;
}

/**
 * Maps a plan returned by the AI (idea flow or folder import — same shape) onto project phases.
 * One implementation means an imported project gets exactly the same task structure as a planned one.
 */
function mapPlanPhases(phases: any[] | undefined): ProjectPhase[] {
  return (phases || []).map((phase, idx) => ({
    id: `phase_${idx}`,
    phaseNumber: phase.phaseNumber ?? idx,
    title: (phase.title || `Phase ${idx}`).replace(/^Phase \d+ - /i, '').replace(/^Phase \d+: /i, ''),
    purpose: phase.purpose || '',
    deliverable: phase.deliverable || '',
    tasks: (phase.tasks || []).map((task: any, taskIdx: number) => ({
      id: `task_${idx}_${taskIdx}`,
      phaseId: `phase_${idx}`,
      title: (task.title || `Task ${taskIdx + 1}`).replace(/^Step \d+: /i, ''),
      goal: task.goal || '',
      status: idx === 0 && taskIdx === 0 ? 'ready' : 'backlog',
      relevantFiles: task.relevantFiles || [],
      acceptanceCriteria: (task.acceptanceCriteria || []).map((ac: any, acIdx: number) => ({
        id: `ac_${idx}_${taskIdx}_${acIdx}`,
        description: typeof ac === 'string' ? ac : ac?.description || String(ac),
        passed: false
      })),
      testRequirements: task.testRequirements || [],
      estimatedComplexity: task.estimatedComplexity || 'Small (1 prompt)',
      dependencies: task.dependencies || [],
      progressPercent: 0
    }))
  }));
}

export const ProjectSetup: React.FC<ProjectSetupProps> = ({ onAddProject, onClose }) => {
  const { t, language } = useLanguage();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<'idea' | 'import'>('idea');

  /*
   * The caret starts inside the dialog, and Escape closes it.
   *
   * Neither was true before: the tab key began on the page behind the wizard, so reaching the
   * wizard's own fields meant walking the whole background first, and a keyboard had no way out of
   * the dialog at all — the ✕ was the only exit.
   */
  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Wizard Step for Mode A: 1 = Idea & Stack, 2 = Contextual Questions & Trade-offs
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);

  // Mode A state: Idea & Name
  const [projectName, setProjectName] = useState('');
  const [ideaText, setIdeaText] = useState('');
  const [platform, setPlatform] = useState('PC / Desktop');
  // Nothing is chosen for the user: the engine/stack starts empty, because no idea analysis and no
  // plan may start before the user picked one — or accepted the one the AI proposes.
  const [preferredStack, setPreferredStack] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<AgentType>('DeepSeek / Web Chat');
  // The preset starts on "Вайб-кодер": a full workspace with plain explanations, which is the safest
  // starting point for a new project. It only seeds the two parts below — either can be changed.
  const [technicalLevel, setTechnicalLevel] = useState<TechnicalLevel>('Vibe-coder');
  const [interfaceMode, setInterfaceMode] = useState<InterfaceMode>(presetParts('Vibe-coder').interface);
  const [autonomyLevel, setAutonomyLevel] = useState<AutonomyLevel>(presetParts('Vibe-coder').autonomy);
  // The wizard opens minimal: everything that is not strictly needed to describe the idea and pick
  // the engine sits behind one click, without losing any of it.
  const [showDetails, setShowDetails] = useState(false);
  // Fields the AI filled in or changed; each is marked on screen until the user edits it.
  const [aiSuggested, setAiSuggested] = useState<Partial<Record<AiField, boolean>>>({});
  const [aiSummary, setAiSummary] = useState<{
    stack: string;
    pattern: string;
    explanation: string;
    changed: AiField[];
  } | null>(null);

  // Where the project files will live. Choosing it here means the new project is born connected
  // to the real folder — the agent writes code there from the very first task.
  const [folderPath, setFolderPath] = useState('');
  const [folderScan, setFolderScan] = useState<{ root: string; files: ProjectFile[] } | null>(null);
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [isFolderBusy, setIsFolderBusy] = useState(false);
  /**
   * Whether the connected folder is being replaced right now.
   *
   * The plate states one fact and offers one way out of it; the field that can choose another
   * folder only appears when that offer is taken. Showing both at once is what made the block read
   * like a form to fill in rather than a folder that is already working.
   */
  const [isChangingFolder, setIsChangingFolder] = useState(false);
  const [folderError, setFolderError] = useState('');

  // AI analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [customAiReason, setCustomAiReason] = useState<string>('');
  const [validationError, setValidationError] = useState<{
    isTooShort: boolean;
    message: string;
    suggestions: string[];
  } | null>(null);

  const getAiRecommendationExplanation = (stack: string, pattern: string) => {
    if (customAiReason) return customAiReason;
    if (language === 'ru') {
      if (stack.includes('Phaser')) {
        return 'Phaser 2D оптимален для браузерных HTML5-игр. Обеспечивает стабильные 60 fps в Canvas/WebGL без установки локальных движков.';
      }
      if (stack.includes('Godot')) {
        return 'Godot 4.3 GDScript отлично подходит для 2D-платформеров. Встроенная иерархия узлов и физический движок гарантируют быстрый отклик.';
      }
      if (stack.includes('Unity')) {
        return 'Unity 6 (URP) является стандартом для производительных 3D-игр со сложными объектами и шейдерной графикой.';
      }
      if (stack.includes('Three')) {
        return 'Three.js / React Three Fiber обеспечивает качественную 3D-графику WebGL непосредственно в окне браузера.';
      }
      if (stack.includes('React')) {
        return 'React 19 + Vite предлагает быструю сборку HMR, реактивное управление состоянием и легкую модульную структуру.';
      }
      return 'ИИ выбрал наиболее производительный движок и архитектурный паттерн под ваши требования.';
    }

    if (stack.includes('Phaser')) {
      return 'Phaser 2D Canvas is optimal for HTML5 browser games. Delivers high 60fps WebGL/Canvas 2D physics with zero engine install needed.';
    }
    if (stack.includes('Godot')) {
      return 'Godot 4.3 GDScript is ideal for 2D platformers and action games. Native node hierarchy and physics engines ensure snappy gameplay.';
    }
    if (stack.includes('Unity')) {
      return 'Unity 6 (URP) with ECS is the industry standard for high-performance 3D games with complex entities and shader graphics.';
    }
    if (stack.includes('Three')) {
      return 'Three.js / React Three Fiber delivers high-quality 3D WebGL flight/space graphics directly inside modern browsers.';
    }
    if (stack.includes('React')) {
      return 'React 19 + Vite offers rapid HMR, reactive state management, and lightweight frontend architecture for web tools.';
    }
    return 'AI selected the most performant engine and architectural pattern tailored specifically to your project requirements.';
  };

  // Real server-side idea analysis: it runs only when the user asks for it — never while typing —
  // and only once an engine/stack is on the table, so nothing is decided behind their back.
  const analysisSeqRef = useRef(0);

  const runAiAnalysisAndAutoSelect = async (rawText: string) => {
    const text = rawText.trim();
    if (!text) return;

    const seq = ++analysisSeqRef.current;
    setIsAnalyzing(true);
    setCustomAiReason('');
    try {
      const data = await analyzeIdeaApi({ ideaText: text, title: projectName, language });

      // Ignore responses from stale requests when the user kept typing.
      if (seq !== analysisSeqRef.current) return;

      if (data.isTooShort) {
        setValidationError({
          isTooShort: true,
          message: data.validationMessage || (language === 'ru'
            ? 'Описание слишком краткое для точного анализа ИИ.'
            : 'The description is too short for a precise AI analysis.'),
          suggestions: data.clarifyingQuestions || (language === 'ru'
            ? [
                'Уточните 2D или 3D графику вы хотите использовать?',
                'Какова главная механика вашей игры?',
                'Целевая платформа — браузер или ПК?'
              ]
            : [
                'Should the visuals be 2D or 3D?',
                'What is the core gameplay mechanic of your game?',
                'Is the target platform a browser or desktop?'
              ])
        });
        setAiSummary(null);
      } else {
        setValidationError(null);
        // Every field the AI actually fills in or changes is both flagged on screen and listed in
        // the summary, so the user can see at a glance what the assistant decided for them.
        const changed: AiField[] = [];
        let stack = preferredStack;
        let pattern = architecturalPattern;

        if (data.preferredStack) {
          stack = canonicalStack(data.preferredStack);
          setPreferredStack(stack);
          changed.push('stack');
        }
        if (data.architecturalPattern) {
          pattern = data.architecturalPattern;
          setArchitecturalPattern(pattern);
          changed.push('pattern');
        }
        if (data.targetPlatform) {
          setPlatform(data.targetPlatform);
          changed.push('platform');
        }
        if (data.selectedAgent) {
          setSelectedAgent(data.selectedAgent as AgentType);
          changed.push('agent');
        }
        if (data.technicalLevel) {
          applyPreset(data.technicalLevel as TechnicalLevel);
          changed.push('level');
        }

        if (data.explanation) setCustomAiReason(data.explanation);
        setAiSummary({ stack, pattern, explanation: data.explanation || '', changed });
        setAiSuggested((prev) => {
          const next = { ...prev };
          changed.forEach((field) => {
            next[field] = true;
          });
          return next;
        });
      }
    } catch (err) {
      console.error('Error running AI Auto-Select:', err);
    } finally {
      if (seq === analysisSeqRef.current) setIsAnalyzing(false);
    }
  };

  const handleRunAiAnalysis = () => {
    if (!ideaText.trim()) {
      setErrorMsg(t.setup.ideaRequiredHint);
      return;
    }
    runAiAnalysisAndAutoSelect(ideaText);
  };

  // Helper functions for color-coded difficulty indicators
  const getStackDifficulty = (stack: string): 'easy' | 'medium' | 'advanced' => {
    if (stack.includes('Phaser') || stack.includes('React 19') || stack.includes('FastAPI')) return 'easy';
    if (stack.includes('Godot') || stack.includes('Three.js') || stack.includes('Next.js') || stack.includes('PixiJS') || stack.includes('Flutter') || stack.includes('PlayCanvas') || stack.includes('Defold')) return 'medium';
    return 'advanced'; // Unity, Unreal Engine
  };

  const getPatternDifficulty = (pattern: string): 'easy' | 'medium' | 'advanced' => {
    if (pattern.includes('FSM') || pattern.includes('Unidirectional') || pattern.includes('MVC')) return 'easy';
    if (pattern.includes('Object Pooling') || pattern.includes('Scene Tree') || pattern.includes('Clean')) return 'medium';
    return 'advanced'; // ECS, FSD
  };

  const renderDifficultyBadge = (difficulty: 'easy' | 'medium' | 'advanced') => {
    if (difficulty === 'easy') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span>{language === 'ru' ? 'Легкий' : 'Easy'}</span>
        </span>
      );
    }
    if (difficulty === 'medium') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          <span>{language === 'ru' ? 'Средний' : 'Medium'}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
        <span>{language === 'ru' ? 'Сложный' : 'Advanced'}</span>
      </span>
    );
  };

  // Typing never spends an AI request: it only drops the now-stale analysis summary.
  const handleIdeaChange = (newIdea: string) => {
    setIdeaText(newIdea);
    setAiSummary(null);
    setValidationError(null);
  };

  // Advanced Architectural Planning State
  const [architecturalPattern, setArchitecturalPattern] = useState('State Machine (FSM)');
  const [reliabilityGuarantees, setReliabilityGuarantees] = useState<string[]>([
    'Strict Typing (TypeScript / C# / GDScript)',
    'Automated Unit & Integration Tests',
    'Error Boundary & Exception Guarding'
  ]);
  const [mvpDepth, setMvpDepth] = useState('Production MVP');

  // Step 2 Questions & Trade-Offs State
  const [questions, setQuestions] = useState<{ id: string; topic: string; questionText: string; placeholder: string; defaultSuggestion: string }[]>([]);
  const [tradeOffs, setTradeOffs] = useState<{ id: string; title: string; optionA: string; optionB: string; recommendation: string }[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [tradeOffChoices, setTradeOffChoices] = useState<Record<string, string>>({});
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Mode B state: the connected folder (or a pasted file list) is read and understood by the AI.
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [isUnderstanding, setIsUnderstanding] = useState(false);
  const [importPlan, setImportPlan] = useState<any | null>(null);
  const [understanding, setUnderstanding] = useState<WorkspaceUnderstanding | null>(null);

  /**
   * The server remembers the connected folder across restarts, so the import tab opens on the
   * folder the app already works in instead of making the user paste its path again. Nothing is
   * typed over: a path the user entered while this request was in flight always wins.
   */
  useEffect(() => {
    let cancelled = false;
    fetchWorkspaceApi(language)
      .then((state) => {
        if (cancelled || !state.root) return;
        const root = state.root;
        setFolderPath((current) => current || root);
        setFolderScan((current) => current ?? { root, files: mapScannedFiles({ root, files: state.files || [] }) });
      })
      .catch(() => {
        /* No folder connected yet — the field stays empty and the user picks one. */
      });
    return () => {
      cancelled = true;
    };
  }, [language]);

  const mapScannedFiles = (state: { root: string | null; files: any[] }): ProjectFile[] =>
    (state.files || []).map((file) => ({
      path: file.path,
      type: file.type,
      description: `${file.dir || '.'} • ${file.sizeBytes} B`,
      sizeBytes: file.sizeBytes
    }));

  /** Connects the chosen folder right away, so the wizard can show the real file count. */
  const connectFolder = async (raw?: string): Promise<boolean> => {
    const value = (raw ?? folderPath).trim();
    if (!value || isFolderBusy) return false;
    setIsFolderBusy(true);
    setFolderError('');
    try {
      const state = await bindWorkspaceApi({ path: value, language });
      setFolderPath(state.root || value);
      setFolderScan({ root: state.root || value, files: mapScannedFiles(state) });
      // The chooser folds back into the plate once it has done its job: leaving it open would keep
      // asking to connect a folder that is already connected.
      setIsChangingFolder(false);
      // Another folder means the previous understanding of the project no longer applies.
      setImportPlan(null);
      setUnderstanding(null);
      return true;
    } catch (err: any) {
      setFolderScan(null);
      setFolderError(
        err?.userMessage || err?.message || (language === 'ru' ? 'Не удалось подключить папку.' : 'Could not connect the folder.')
      );
      return false;
    } finally {
      setIsFolderBusy(false);
    }
  };

  const handlePickFolder = async () => {
    if (isPickingFolder) return;
    setIsPickingFolder(true);
    setFolderError('');
    try {
      const result = await pickFolderApi({ initialPath: folderPath.trim() || undefined, language });
      if (!result.supported) {
        setFolderError(
          language === 'ru'
            ? 'Системное окно недоступно — вставьте путь к папке в поле.'
            : 'The system dialog is unavailable — paste the folder path into the field.'
        );
        return;
      }
      if (result.path) {
        // Only the field is filled: the folder is read and connected by "Connect",
        // so the dialog itself never triggers any work with the user's files.
        setFolderPath(result.path);
        setFolderError('');
      }
    } catch (err: any) {
      setFolderError(err?.userMessage || err?.message || (language === 'ru' ? 'Не удалось открыть окно выбора папки.' : 'Could not open the folder dialog.'));
    } finally {
      setIsPickingFolder(false);
    }
  };

  /**
   * At creation time: reuse the folder connected in the wizard, or connect the typed path now.
   * Returns nothing when no folder was chosen — the project simply starts without one. A folder
   * that was chosen but cannot be connected is reported instead of being dropped silently: this is
   * the folder the project will work in from here on.
   */
  const resolveProjectFolder = async (): Promise<{ root?: string; files?: ProjectFile[]; error?: string }> => {
    const wanted = folderPath.trim();
    if (!wanted) return {};
    if (folderScan && isSameFolder(folderScan.root, wanted)) {
      return { root: folderScan.root, files: folderScan.files };
    }
    try {
      const state = await bindWorkspaceApi({ path: wanted, language });
      return { root: state.root || wanted, files: mapScannedFiles(state) };
    } catch (err: any) {
      return {
        error:
          err?.userMessage || err?.message || (language === 'ru' ? 'Не удалось подключить папку.' : 'Could not connect the folder.')
      };
    }
  };

  /**
   * The precondition of the whole flow: an idea to analyse and an engine/stack to analyse it for.
   * Every path that starts the analysis or builds the plan goes through this check.
   */
  const ensureReadyToStart = (): boolean => {
    if (!preferredStack.trim()) {
      setErrorMsg(t.setup.startRequiresEngine);
      return false;
    }
    if (!ideaText.trim()) {
      setErrorMsg(language === 'ru' ? 'Пожалуйста, введите краткое описание идеи проекта.' : 'Please enter a brief description of your project idea.');
      return false;
    }
    return true;
  };

  const handleFetchQuestions = async () => {
    if (!ensureReadyToStart()) return;

    setIsLoadingQuestions(true);
    setErrorMsg('');

    try {
      const data = await generateProjectQuestionsApi({
        idea: ideaText,
        platform,
        stack: preferredStack,
        agent: selectedAgent,
        // The autonomy part is what the engine writes for; the interface part stays in the browser.
        skillLevel: autonomyLevel,
        architecturalPattern,
        reliabilityGuarantees,
        mvpDepth,
        language
      });

      if (data && data.questions && data.questions.length > 0) {
        setQuestions(data.questions);
        const initAns: Record<string, string> = {};
        data.questions.forEach((q) => {
          initAns[q.id] = q.defaultSuggestion;
        });
        setAnswers(initAns);

        if (data.tradeOffs && data.tradeOffs.length > 0) {
          setTradeOffs(data.tradeOffs);
          const initTradeOffs: Record<string, string> = {};
          data.tradeOffs.forEach((t) => {
            initTradeOffs[t.id] = t.optionA;
          });
          setTradeOffChoices(initTradeOffs);
        }

        setWizardStep(2);
      } else {
        // Fallback to direct generation if no questions
        handleGenerateIdeaDirect();
      }
    } catch (err: any) {
      console.error('Failed to generate questions:', err);
      const msg = err?.userMessage || err?.message || (language === 'ru' ? 'Не удалось сгенерировать вопросы. Переход к созданию плана.' : 'Failed to generate questions. Falling back to direct plan generation.');
      setErrorMsg(msg);
      setTimeout(() => {
        handleGenerateIdeaDirect();
      }, 1500);
    } finally {
      setIsLoadingQuestions(false);
    }
  };

  /**
   * The single place that turns an AI plan into a project. The idea flow and the folder-import flow
   * both come through here, so an imported project gets the same brief, plan and project map.
   */
  const buildProjectFromPlan = (
    data: any,
    options: {
      folder: { root?: string; files?: ProjectFile[] };
      stack?: string;
      mapFiles?: ProjectFile[];
      nextBestAction?: string;
      /** What the real files already contain, read during the import. */
      facts?: WorkspaceFacts | null;
    }
  ): ProjectState => {
    const finalName = projectName.trim() || data.projectName || (language === 'ru' ? 'Новый ИИ-проект' : 'New AI Project');
    const stack = options.stack || data.engineOrFramework || 'React 19 + Vite';
    const projectType = data.projectType || 'Generic';
    const projectLanguage = data.language || 'TypeScript';

    // Generate custom tailored agent rules
    const generatedRules = generateCustomRulesFiles({
      projectName: finalName,
      projectType,
      engineOrFramework: stack,
      language: projectLanguage,
      selectedAgent,
      architecturalPattern,
      reliabilityGuarantees,
      mvpDepth,
      uiLanguage: language
    });

    return {
      id: `proj_${Date.now()}`,
      name: finalName,
      workspaceRoot: options.folder.root,
      projectType,
      engineOrFramework: stack,
      language: projectLanguage,
      selectedAgent,
      // The wizard requires an explicit pick on every creation path; the fallback only keeps the
      // type total for a project object that must always carry a level.
      technicalLevel,
      // The preset seeded both parts; anything the user changed afterwards is kept as it is.
      interfaceMode,
      autonomyLevel,
      nextBestAction:
        options.nextBestAction ||
        (data.phases?.[0]?.tasks?.[0]?.title
          ? language === 'ru'
            ? `Начните с Шага 1: ${data.phases[0].tasks[0].title}`
            : `Start with Step 1: ${data.phases[0].tasks[0].title}`
          : language === 'ru'
          ? 'Скомпилируйте промпт для этапа 0.'
          : 'Compile prompt for Phase 0 setup.'),
      brief: {
        id: `brief_${Date.now()}`,
        projectName: finalName,
        tagline: data.tagline || '',
        targetAudience: data.targetAudience || (language === 'ru' ? 'Новички и тестировщики' : 'Beginners and testers'),
        coreProblem: data.coreProblem || '',
        coreValue: data.coreValue || '',
        mvpFeatures: data.mvpFeatures || [],
        futureFeatures: data.futureFeatures || [],
        nonGoals: data.nonGoals || [],
        technicalConstraints: data.technicalConstraints || [],
        successCriteria: data.successCriteria || []
      },
      architecture: data.architecture || {
        technologyStack: [stack],
        folderStructure: ['src/ or Assets/'],
        coreEntities: ['Project', 'User'],
        dataFlow: 'Standard flow',
        testingStrategy: 'Unit tests',
        deploymentPlan: 'Standalone or Web',
        securityRisks: []
      },
      phases: mapPlanPhases(data.phases),
      projectMap: {
        projectName: finalName,
        projectType,
        engineOrFramework: stack,
        language: projectLanguage,
        // The real paths, matching where the rules screen writes them and what Cursor reads.
        rulesFiles: [RULES_FILE_PATHS.agents, RULES_FILE_PATHS.claude, RULES_FILE_PATHS.cursor],
        // The real files win: first the connected folder, then what the analysis read.
        files: attachFactsToFiles(
          options.folder.files ?? options.mapFiles ?? [
            {
              path: projectType === 'Unity' ? 'Assets/Features/Core/GameManager.cs' : 'src/App.tsx',
              type: 'code',
              symbols: ['MainLogic'],
              description: 'Main project entry logic.'
            }
          ],
          options.facts
        ),
        detectedArchitecture: detectedArchitectureFromFacts(options.facts)
      },
      recentErrors: [],
      rulesFilesContent: generatedRules
    };
  };

  const handleGenerateIdeaDirect = async () => {
    if (isGenerating || isLoadingQuestions) return;
    if (!ensureReadyToStart()) return;

    setIsGenerating(true);
    setErrorMsg('');

    try {
      const data = await createProjectFromIdea({
        idea: ideaText,
        projectName: projectName.trim() || undefined,
        platform,
        stack: preferredStack,
        agent: selectedAgent,
        // The autonomy part is what the engine writes for; the interface part stays in the browser.
        skillLevel: autonomyLevel,
        architecturalPattern,
        reliabilityGuarantees,
        mvpDepth,
        userAnswers: wizardStep === 2 ? answers : undefined,
        tradeOffChoices: wizardStep === 2 ? tradeOffChoices : undefined,
        language
      });

      const folder = await resolveProjectFolder();
      if (folder.error) {
        // The project must be born with the folder it was given, or not at all.
        setErrorMsg(folder.error);
        return;
      }

      onAddProject(buildProjectFromPlan(data, { folder, stack: preferredStack }));
      onClose();
    } catch (err: any) {
      console.error('Failed to create idea:', err);
      setErrorMsg(err?.userMessage || err?.message || 'Failed to process project plan. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  /* --------------------- Mode B: understanding a project that exists --------------------- */

  /**
   * Lets the AI read the project before anything is created: the connected folder (README,
   * manifests, entry points and their real contents) or, with no folder connected, the pasted
   * list of paths. What comes back is the app's understanding of the project.
   */
  const handleUnderstandWorkspace = async (source: 'folder' | 'paths') => {
    if (isUnderstanding) return;

    let paths: string[] | undefined;
    if (source === 'paths') {
      const parsed = parseFileList(importText);
      if (!parsed) {
        setImportError(
          language === 'ru'
            ? 'Не удалось распознать файлы. Вставьте список путей (например: src/App.tsx, Assets/Scripts/Player.cs).'
            : 'Could not recognize any files. Paste a list of paths (e.g. src/App.tsx, Assets/Scripts/Player.cs).'
        );
        return;
      }
      paths = parsed.paths;
    } else if (!folderScan) {
      // A folder that was only typed in is connected right here, so there is something to read.
      const connected = await connectFolder();
      if (!connected) return;
    }

    setIsUnderstanding(true);
    setImportError('');
    setImportPlan(null);
    setUnderstanding(null);
    try {
      const data = await importWorkspaceApi({
        paths,
        projectName: projectName.trim() || undefined,
        language
      });
      setImportPlan(data);
      setUnderstanding(data.understanding);
    } catch (err: any) {
      setImportError(
        err?.userMessage ||
          err?.message ||
          (language === 'ru' ? 'Не удалось прочитать проект.' : 'Could not read the project.')
      );
    } finally {
      setIsUnderstanding(false);
    }
  };

  /** Creates the project from what was understood about it and continues along the flow. */
  const handleCreateFromImport = async () => {
    if (!importPlan || isGenerating || isUnderstanding) return;
    setIsGenerating(true);
    setImportError('');
    try {
      const folder = await resolveProjectFolder();
      if (folder.error) {
        setImportError(folder.error);
        return;
      }

      // The map is built from the files that really exist: the connected folder wins, otherwise the
      // files the analysis read plus the pasted paths.
      const parsed = parseFileList(importText);
      const mapFiles: ProjectFile[] | undefined = folder.files
        ? undefined
        : [...(understanding?.keyFiles || []), ...(parsed?.paths || [])]
            .filter((path, index, all) => all.indexOf(path) === index)
            .slice(0, 60)
            .map((path) => ({
              path,
              type: inferFileType(path) as ProjectFile['type'],
              description: language === 'ru' ? 'Файл существующего проекта' : 'Existing project file'
            }));

      onAddProject(
        buildProjectFromPlan(importPlan, {
          folder,
          mapFiles,
          facts: understanding?.facts,
          nextBestAction:
            language === 'ru'
              ? 'Начните с первой задачи: она уже указывает на реальные файлы вашего проекта.'
              : 'Start with the first task: it already points at the real files of your project.'
        })
      );
      onClose();
    } catch (err: any) {
      setImportError(
        err?.userMessage || err?.message || (language === 'ru' ? 'Не удалось создать проект.' : 'Could not create the project.')
      );
    } finally {
      setIsGenerating(false);
    }
  };

  // A path in the field is not connected until "Connect" is pressed (or the project is created).
  const showFolderNotConnectedNote =
    folderPath.trim() !== '' && !isSameFolder(folderPath, folderScan?.root);

  const hasEngine = preferredStack.trim() !== '';
  const hasIdea = ideaText.trim().length > 0;
  const canRunAiAnalysis = hasIdea && !isAnalyzing && !isGenerating && !isLoadingQuestions;
  const canStartAnalysis = hasEngine && hasIdea && !isLoadingQuestions && !isGenerating;

  /** Drops the "AI suggested" mark of a field the user edited themselves. */
  const clearAiSuggested = (field: AiField) =>
    setAiSuggested((prev) => (prev[field] ? { ...prev, [field]: false } : prev));

  /** How every AI-touchable setting is called on screen. */
  const aiFieldLabels: Record<AiField, string> = {
    stack: t.setup.engineLabel,
    pattern: language === 'ru' ? 'Архитектурный паттерн' : 'Architectural pattern',
    platform: t.setup.platformLabel,
    agent: language === 'ru' ? 'Целевой ИИ-агент' : 'Target AI agent',
    level: t.setup.techLevelLabel
  };

  const aiFields = (Object.keys(aiSuggested) as AiField[]).filter((field) => aiSuggested[field]);

  /** The "AI suggested" mark that sits next to a field the assistant filled in or changed. */
  const AiChip: React.FC = () => (
    <span
      title={t.setup.aiBadgeHint}
      className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-indigo-200 bg-indigo-500/15 border border-indigo-500/40 px-1.5 py-0.5 rounded shrink-0"
    >
      <Sparkles className="w-2.5 h-2.5" />
      <span>{t.setup.aiBadge}</span>
    </span>
  );

  /**
   * The question mark next to a mode name: the only place a mode's description lives. It shows on
   * hover, so the block stays four short names, and it carries the text as a native title as well so
   * the description is still reachable by keyboard and by a test.
   */
  const ModeHint: React.FC<{ text: string; label: string }> = ({ text, label }) => (
    <span
      className="relative inline-flex group/modehint"
      onClick={(event) => event.stopPropagation()}
    >
      <span
        title={text}
        aria-label={`${label}: ${text}`}
        tabIndex={0}
        className="inline-flex text-slate-400 hover:text-slate-300 focus:text-slate-300 cursor-help"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden w-56 -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-left text-[11px] font-normal leading-relaxed text-slate-200 shadow-xl group-hover/modehint:block group-focus-within/modehint:block"
      >
        {text}
      </span>
    </span>
  );

  /**
   * The mode: four short names, one of them already chosen. What each preset changes is one hover
   * away on the question mark next to its name — the block itself carries no prose.
   */
  const modeOptions: { value: TechnicalLevel; label: string; hint: string }[] = [
    { value: 'Beginner / Non-coder', label: t.technicalLevels.beginner, hint: t.setup.modeBeginnerHint },
    { value: 'Vibe-coder', label: t.technicalLevels.vibecoder, hint: t.setup.modeVibecoderHint },
    { value: 'Intermediate', label: t.technicalLevels.intermediate, hint: t.setup.modeIntermediateHint },
    { value: 'Advanced', label: t.technicalLevels.advanced, hint: t.setup.modeAdvancedHint }
  ];

  /** A preset sets both parts at once — and leaves them editable separately right below. */
  const applyPreset = (preset: TechnicalLevel) => {
    const parts = presetParts(preset);
    setTechnicalLevel(preset);
    setInterfaceMode(parts.interface);
    setAutonomyLevel(parts.autonomy);
  };

  /**
   * The AI autonomy is its own thing and is named its own way: it says how much the AI does by
   * itself and how much it explains. The names are deliberately not the interface names, so the two
   * pickers cannot be mistaken for each other. The current level is spelled out on hover.
   */
  const autonomyLabels: Record<AutonomyLevel, string> = {
    'Beginner / Non-coder': t.mode.autonomyLevels.beginner,
    'Vibe-coder': t.mode.autonomyLevels.vibecoder,
    Intermediate: t.mode.autonomyLevels.intermediate,
    Advanced: t.mode.autonomyLevels.advanced
  };

  const autonomyHints: Record<AutonomyLevel, string> = {
    'Beginner / Non-coder': t.mode.autonomyHints.beginner,
    'Vibe-coder': t.mode.autonomyHints.vibecoder,
    Intermediate: t.mode.autonomyHints.intermediate,
    Advanced: t.mode.autonomyHints.advanced
  };

  /** The AI autonomy on its own: the interface itself is the cards above. */
  const autonomyBlock = (
    <div data-testid="mode-parts" className="border-t border-slate-800/80 pt-2.5">
      <label className="space-y-1 block">
        <span className="block text-[11px] font-bold text-slate-200">{t.mode.autonomyLabel}</span>
        <select
          value={autonomyLevel}
          title={autonomyHints[autonomyLevel]}
          onChange={(e) => {
            setAutonomyLevel(e.target.value as AutonomyLevel);
            clearAiSuggested('level');
          }}
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-100 focus:border-indigo-500 cursor-pointer"
        >
          {AUTONOMY_LEVELS.map((level) => (
            <option key={level} value={level} className="bg-slate-900">
              {autonomyLabels[level]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  /*
   * The three settings blocks of the wizard are sections of one dialog, not cards on a page.
   *
   * Each was a rounded plate with its own fill inside the dialog's own plate, so the first screen
   * a new project sees was three frames deep before the first field. A hairline and a little air do
   * the same separating work without adding a surface to look through.
   */
  const modeBlock = (
    <div data-testid="mode-block" className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Users className="w-4 h-4 text-indigo-400" />
        <span className="text-xs font-bold text-slate-200">{t.mode.interfaceLabel}</span>
        {aiSuggested.level && <AiChip />}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {modeOptions.map((option) => {
          const isActive = technicalLevel === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => {
                applyPreset(option.value);
                clearAiSuggested('level');
              }}
              className={buttonClass({
                variant: isActive ? 'primary' : 'secondary',
                size: 'sm',
                className: 'w-full justify-center'
              })}
            >
              <span className="text-xs font-medium">{option.label}</span>
              <ModeHint text={option.hint} label={option.label} />
            </button>
          );
        })}
      </div>

      {autonomyBlock}
    </div>
  );

  /**
   * The folder field, shared by both creation tabs — and the only place in the app where the folder
   * of a project is chosen.
   *
   * Two states, and only two. A connected folder is a statement: the mark, the folder, how many
   * files are in it, and one action that replaces it. Anything else is the chooser: the path field,
   * the system dialog, and the button that actually connects (and reads) the folder.
   */
  const folderBlock = (
    <div className="space-y-2.5 border-t border-slate-800 pt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-slate-500" />
          <span className="truncate text-xs font-medium text-slate-300">{t.setup.folderLabel}</span>
        </div>
        {folderScan && !isChangingFolder && (
          <button
            type="button"
            onClick={() => setIsChangingFolder(true)}
            className={buttonClass({ variant: 'secondary', size: 'xs' })}
          >
            {t.setup.folderChange}
          </button>
        )}
      </div>

      {folderScan && !isChangingFolder ? (
        /* One line, one fact, one action: the folder is already doing its job. */
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2.5">
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-xs font-medium text-slate-200">{t.setup.folderConnected}</span>
              <span className="text-[11px] text-slate-400">
                {t.setup.folderFiles}:{' '}
                <span className="tabular-nums text-slate-300">{folderScan.files.length}</span>
              </span>
            </div>
            {/* The whole path is in the tooltip: a long one must not push the plate out of shape. */}
            <p className="truncate font-mono text-[11px] text-slate-400" title={folderScan.root}>
              {folderScan.root}
            </p>
          </div>
        </div>
      ) : (
        <>
          <p className="text-[11px] text-slate-400">{t.setup.folderHelp}</p>

          <div className="flex flex-col sm:flex-row gap-2">
            <div
              className={`flex flex-1 min-w-0 items-center gap-2 rounded-lg border bg-slate-950 pl-3 transition-colors ${
                showFolderNotConnectedNote
                  ? 'border-amber-700/70 focus-within:border-amber-500'
                  : 'border-slate-800 focus-within:border-emerald-600'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                value={folderPath}
                onChange={(e) => {
                  setFolderPath(e.target.value);
                  if (folderError) setFolderError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') connectFolder();
                }}
                placeholder={t.setup.folderPlaceholder}
                className="flex-1 min-w-0 bg-transparent py-2.5 text-xs font-mono text-slate-100"
              />
            </div>
            <button
              type="button"
              onClick={handlePickFolder}
              disabled={isPickingFolder || isFolderBusy}
              className={buttonClass({ variant: 'secondary', size: 'md' })}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>{t.setup.folderChoose}</span>
            </button>
            <button
              type="button"
              onClick={() => connectFolder()}
              disabled={!folderPath.trim() || isFolderBusy}
              className={buttonClass({ variant: 'primary', size: 'md' })}
            >
              {isFolderBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{t.setup.folderConnect}</span>
            </button>
          </div>

          {showFolderNotConnectedNote && (
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{t.setup.folderNotConnectedHint}</span>
            </p>
          )}

          {/* Replacing the folder was the user's own decision, so undoing it is one quiet click. */}
          {folderScan && (
            <button
              type="button"
              onClick={() => {
                setIsChangingFolder(false);
                setFolderPath(folderScan.root);
                setFolderError('');
              }}
              className={buttonClass({ variant: 'ghost', size: 'xs' })}
            >
              {t.setup.folderKeepConnected}
            </button>
          )}
        </>
      )}

      {folderError && <p className="text-[11px] text-rose-300">{folderError}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-hidden">
      {/*
        The wizard is a dialog, and says so: a screen reader is told what the panel is and which
        heading names it, the caret starts inside it rather than on the page behind, and Escape
        closes it like the ✕ does. The page behind is made inert by App, which is what keeps the tab
        key inside this box.
      */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-dialog-title"
        tabIndex={-1}
        ref={dialogRef}
        className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col text-slate-100 shadow-2xl overflow-hidden"
      >
        {/* Header & Tabs Container */}
        <div className="p-4 sm:p-5 border-b border-slate-800 shrink-0 space-y-3 bg-slate-900">
          <div className="flex items-center justify-between">
            <div>
              <h2 id="setup-dialog-title" className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-400" />
                <span>{t.setup.modalTitle}</span>
              </h2>
            </div>
            <div className="flex items-center gap-2">
            <button
              onClick={() => setShowApiSettings(true)}
              className={buttonClass({ variant: 'ghost', size: 'xs' })}
            >
              <Settings className="h-3.5 w-3.5" />
              <span>API</span>
            </button>
            <button
              onClick={onClose}
              className={buttonClass({ variant: 'ghost', size: 'xs' })}
            >
              ✕ {t.common.close}
            </button>
            </div>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveTab('idea')}
              aria-pressed={activeTab === 'idea'}
              className={buttonClass({
                variant: activeTab === 'idea' ? 'primary' : 'ghost',
                size: 'sm',
                className: 'w-full'
              })}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>{t.setup.tabIdea}</span>
            </button>

            <button
              onClick={() => setActiveTab('import')}
              aria-pressed={activeTab === 'import'}
              className={buttonClass({
                variant: activeTab === 'import' ? 'primary' : 'ghost',
                size: 'sm',
                className: 'w-full'
              })}
            >
              <Upload className="h-3.5 w-3.5" />
              <span>{t.setup.tabImport}</span>
            </button>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
        {showApiSettings && <ApiSettingsPanel onClose={() => setShowApiSettings(false)} />}

        {/* Mode A Content: Idea -> Plan */}
        {activeTab === 'idea' && (
          <div className="space-y-5">
            {/* Step Indicator */}
            <div className="flex items-center justify-between bg-slate-950/80 p-2 rounded-xl text-xs font-semibold">
              <div className={`flex items-center gap-2 ${wizardStep === 1 ? 'text-indigo-400' : 'text-slate-400'}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${wizardStep === 1 ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'}`}>1</span>
                <span>{t.setup.step1Title}</span>
              </div>
              <div className="h-0.5 w-8 bg-slate-800" />
              <div className={`flex items-center gap-2 ${wizardStep === 2 ? 'text-indigo-400' : 'text-slate-400'}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${wizardStep === 2 ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'}`}>2</span>
                <span>{t.setup.step2Title}</span>
              </div>
            </div>

            {wizardStep === 1 && (
              <>
                {/* First question of the whole wizard: who the user is decides which app opens. */}
                {modeBlock}

                {/* Project Name Field */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-200 block">
                    {t.setup.projectNameLabel}
                  </label>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder={t.setup.projectNamePlaceholder}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-100 focus:border-indigo-500 font-semibold placeholder:text-slate-400"
                  />
                </div>

                {/* Freeform Prompt Area */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-200 block">
                    {t.setup.ideaLabel}
                  </label>
                  <textarea
                    value={ideaText}
                    onChange={(e) => handleIdeaChange(e.target.value)}
                    placeholder={t.setup.ideaPlaceholder}
                    rows={4}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:border-indigo-500 transition-colors placeholder:text-slate-400"
                  />
                </div>

                {/* The engine/stack is the one choice nothing can run without, so it stands on its
                    own instead of hiding among the advanced settings. Nothing warns about it: the
                    buttons below stay disabled until it is picked, and that is the whole rule. */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-200 flex flex-wrap items-center gap-2">
                    <span>{t.setup.engineLabel}</span>
                    {aiSuggested.stack && <AiChip />}
                  </label>
                  <select
                    value={preferredStack}
                    onChange={(e) => {
                      setPreferredStack(e.target.value);
                      clearAiSuggested('stack');
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 focus:border-indigo-500 font-medium"
                  >
                    <option value="" disabled>
                      {t.setup.enginePlaceholder}
                    </option>
                    <optgroup label={language === 'ru' ? 'Браузерные и HTML5 движки' : 'Browser & HTML5 Game Engines'}>
                      <option value="Phaser.js 3 (Canvas)">Phaser.js 3 (2D Canvas / WebGL)</option>
                      <option value="Three.js / React Three Fiber">Three.js / React Three Fiber (3D WebGL)</option>
                      <option value="PixiJS v8">PixiJS v8 (2D Engine)</option>
                      <option value="PlayCanvas">PlayCanvas (WebGL 3D Engine)</option>
                      <option value="Construct 3 / Defold">Defold / Construct 3 (HTML5 2D)</option>
                    </optgroup>
                    <optgroup label={language === 'ru' ? 'Десктопные и кроссплатформенные движки' : 'Desktop & Cross-Platform Engines'}>
                      <option value="Godot 4.3 (GDScript)">Godot 4.3 (GDScript / Open Source)</option>
                      <option value="Unity 6 (URP)">Unity 6 (C# / URP / 2D & 3D)</option>
                      <option value="Unreal Engine 5">Unreal Engine 5 (C++ / Blueprints)</option>
                    </optgroup>
                    <optgroup label={language === 'ru' ? 'Веб-фреймворки и бэкенд' : 'Web & Backend Frameworks'}>
                      <option value="React 19 + Vite">React 19 + Vite (TypeScript)</option>
                      <option value="Next.js App Router">Next.js 15 (React / Node)</option>
                      <option value="Python FastAPI">{language === 'ru' ? 'Python FastAPI (бэкенд)' : 'Python FastAPI Backend'}</option>
                      <option value="Flutter">{language === 'ru' ? 'Flutter (мобильные, Dart)' : 'Flutter Mobile (Dart)'}</option>
                    </optgroup>
                  </select>
                </div>

                {/* The idea analysis is an explicit action, never something that happens while typing. */}
                <div className="space-y-3 border-t border-slate-800 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-lg bg-indigo-500/15 text-indigo-400">
                        <Sparkles className={`w-4 h-4 ${isAnalyzing ? 'animate-spin text-amber-400' : ''}`} />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white flex items-center gap-2">
                          <span>{t.setup.aiAnalyzeTitle}</span>
                          {validationError && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                              {language === 'ru' ? 'ТРЕБУЮТСЯ ДЕТАЛИ' : 'NEEDS DETAILS'}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">{t.setup.aiAnalyzeHint}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleRunAiAnalysis}
                      disabled={!canRunAiAnalysis}
                      title={canRunAiAnalysis ? undefined : t.setup.ideaRequiredHint}
                      className={buttonClass({ variant: 'primary', size: 'sm' })}
                    >
                      <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
                      <span>
                        {isAnalyzing ? t.setup.aiAnalyzing : aiSummary ? t.setup.aiAnalyzeAgain : t.setup.aiAnalyze}
                      </span>
                    </button>
                  </div>

                  {/* Validation Warning Box when description is too short */}
                  {validationError && (
                    <div className="bg-amber-950/40 border border-amber-500/40 rounded-xl p-3.5 space-y-2.5 text-xs text-amber-200">
                      <div className="flex items-start gap-2">
                        <HelpCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <div className="font-bold text-amber-300 text-xs">
                            {validationError.message}
                          </div>
                          <p className="text-[11px] text-amber-200/90 leading-relaxed">
                            {language === 'ru'
                              ? 'Дополните ваш текст конкретикой, чтобы ИИ смог выстроить наилучший стек:'
                              : 'Add specifics to your description so the AI can build the optimal stack:'}
                          </p>
                        </div>
                      </div>

                      <div className="bg-slate-950/80 border border-amber-500/20 rounded-lg p-2.5 space-y-1.5">
                        <ul className="space-y-1 text-[11px] text-slate-300">
                          {validationError.suggestions.map((sug, i) => (
                            <li key={i} className="flex items-start gap-1.5">
                              <span className="text-amber-400 font-bold">•</span>
                              <span>{sug}</span>
                            </li>
                          ))}
                        </ul>
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              const enriched = ideaText.trim()
                                ? (language === 'ru'
                                    ? `${ideaText.trim()} - 2D браузерная игра с физикой, одиночным режимом, звуковыми эффектами, сохранением прогресса и рекордами.`
                                    : `${ideaText.trim()} - 2D pixel art browser physics game with single-player mechanics, sound effects, level progress and local high scores.`)
                                : (language === 'ru'
                                    ? '2D браузерная игра с физикой наливания жидкостей, одиночным аркадным геймплеем, звуковыми эффектами и таблицей рекордов.'
                                    : 'A 2D pixel art browser physics game with liquid pouring mechanics, single-player arcade gameplay, sound effects, and high score tracking.');
                              setIdeaText(enriched);
                              runAiAnalysisAndAutoSelect(enriched);
                            }}
                            className={buttonClass({ variant: 'warning', size: 'xs' })}
                          >
                            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                            <span>{language === 'ru' ? 'Дополнить примерными деталями' : 'Enrich with sample details'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* What the AI proposed, and exactly which fields it wrote itself. */}
                  {aiSummary && !validationError && (
                    <div className="bg-gradient-to-r from-indigo-950/40 via-slate-900 to-slate-950 border border-indigo-500/30 rounded-lg p-3 text-xs space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
                        <AiChip />
                        <span className="text-indigo-300">
                          {aiSummary.stack}
                          {aiSummary.pattern ? ` + ${aiSummary.pattern}` : ''}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        <strong className="text-slate-100">{language === 'ru' ? 'Обоснование:' : 'Why this:'}</strong>{' '}
                        {aiSummary.explanation || getAiRecommendationExplanation(aiSummary.stack, aiSummary.pattern)}
                      </p>
                      {aiSummary.changed.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-indigo-200">
                          <span className="font-bold uppercase tracking-wider">{t.setup.aiChangedFields}</span>
                          {aiSummary.changed.map((field) => (
                            <span
                              key={field}
                              className="bg-indigo-500/15 border border-indigo-500/40 rounded px-1.5 py-0.5 font-semibold"
                            >
                              {aiFieldLabels[field]}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Everything the assistant can preset lives one click away; the essentials — the
                    idea, the engine and the folder — stay on screen. */}
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => setShowDetails(!showDetails)}
                    className={buttonClass({
                      variant: 'secondary',
                      size: 'md',
                      className: 'w-full justify-between'
                    })}
                  >
                    {/*
                      One full-width row: the button's own class centres its content, so the two
                      ends are put in a single wrapper that takes the whole width — otherwise the
                      chevron sat beside the label instead of at the far edge.
                    */}
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <Settings className="h-3.5 w-3.5 text-slate-400" />
                        <span>{showDetails ? t.setup.detailsHide : t.setup.detailsShow}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        {aiFields.length > 0 && <AiChip />}
                        {showDetails ? (
                          <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                        )}
                      </span>
                    </span>
                  </button>

                  {!showDetails && (
                    <p className="px-1 text-[11px] text-slate-400">
                      {t.setup.detailsHint}
                      {aiFields.length > 0 && (
                        <span className="text-indigo-300">
                          {' '}
                          {t.setup.aiChangedFields} {aiFields.map((field) => aiFieldLabels[field]).join(', ')}
                        </span>
                      )}
                    </p>
                  )}
                </div>

                {/* Selectors Grid */}
                <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${showDetails ? '' : 'hidden'}`}>
                  {/* Target Coding Agent */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300 flex flex-wrap items-center gap-2">
                      <span>{language === 'ru' ? 'Целевой ИИ-агент' : 'Target AI Coding Agent'}</span>
                      {aiSuggested.agent && <AiChip />}
                    </label>
                    <select
                      value={selectedAgent}
                      onChange={(e) => {
                        setSelectedAgent(e.target.value as AgentType);
                        clearAiSuggested('agent');
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:border-indigo-500"
                    >
                      <option value="DeepSeek / Web Chat">{language === 'ru' ? 'DeepSeek / Веб-чат (Браузер)' : 'DeepSeek / Web Chat (Browser)'}</option>
                      <option value="Cursor">Cursor AI Editor</option>
                      <option value="Claude Code">Claude Code CLI</option>
                      <option value="Windsurf">Windsurf AI</option>
                      <option value="GitHub Copilot">GitHub Copilot Workspace</option>
                      <option value="Cline">Cline (VS Code)</option>
                      <option value="Roo Code">Roo Code (VS Code)</option>
                      <option value="Replit">Replit Agent</option>
                      <option value="Lovable">Lovable.dev</option>
                      <option value="Bolt">Bolt.new</option>
                      <option value="ChatGPT / API">ChatGPT / Custom API</option>
                    </select>
                  </div>

                  {/* Architectural Pattern */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300 flex flex-wrap items-center gap-2">
                      <span>{language === 'ru' ? 'Архитектурный паттерн' : 'Architectural Pattern'}</span>
                      {aiSuggested.pattern && <AiChip />}
                    </label>
                    <select
                      value={architecturalPattern}
                      onChange={(e) => {
                        setArchitecturalPattern(e.target.value);
                        clearAiSuggested('pattern');
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-indigo-300 focus:border-indigo-500 font-semibold"
                    >
                      <optgroup label={language === 'ru' ? 'Игровые паттерны' : 'Game Architecture Patterns'}>
                        <option value="State Machine (FSM)">{language === 'ru' ? 'Конечный автомат (FSM)' : 'Finite State Machine (FSM)'}</option>
                        <option value="Object Pooling & Event Bus">{language === 'ru' ? 'Пул объектов и шина событий' : 'Object Pooling & Event Bus'}</option>
                        <option value="Component-Driven Scene Tree">{language === 'ru' ? 'Иерархическое дерево сцены' : 'Component-Driven Scene Tree'}</option>
                        <option value="Entity-Component-System (ECS)">Entity-Component-System (ECS)</option>
                      </optgroup>
                      <optgroup label={language === 'ru' ? 'Архитектура веб/приложений' : 'Software Architecture Patterns'}>
                        <option value="Unidirectional Data Flow">{language === 'ru' ? 'Однонаправленный поток данных' : 'Unidirectional Data Flow'}</option>
                        <option value="MVC / Service-Oriented">MVC / Service-Oriented</option>
                        <option value="Clean Architecture & Repository">{language === 'ru' ? 'Чистая архитектура и репозиторий' : 'Clean Architecture & Repository'}</option>
                        <option value="Feature-Sliced Design (FSD)">Feature-Sliced Design (FSD)</option>
                      </optgroup>
                    </select>
                  </div>

                  {/* MVP Granularity & Detail Level */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">
                      {language === 'ru' ? 'Глубина и детализация MVP' : 'MVP Detail & Scope Depth'}
                    </label>
                    <select
                      value={mvpDepth}
                      onChange={(e) => setMvpDepth(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:border-indigo-500 font-medium"
                    >
                      <option value="Fast Prototype">{language === 'ru' ? 'Быстрый прототип (2 этапа, 3-4 задачи)' : 'Fast Prototype (2 Phases, 3-4 Lean Tasks)'}</option>
                      <option value="Production MVP">{language === 'ru' ? 'Продакшн MVP (3 этапа, 6-8 задач)' : 'Production MVP (3 Phases, 6-8 Detailed Tasks)'}</option>
                      <option value="Scalable Enterprise">{language === 'ru' ? 'Масштабируемый Enterprise (4-5 этапов, 10+ задач)' : 'Scalable Enterprise (4-5 Phases, 10+ Complete Tasks)'}</option>
                    </select>
                  </div>

                  {/* The level has no second control here on purpose: the mode is asked once, at the
                      top of the wizard, where it also shows which interface it opens. A duplicate
                      select showed "Новичок" even when nothing was chosen, because an empty value
                      falls back to the first option. */}

                  {/* Target Platform */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300 flex flex-wrap items-center gap-2">
                      <span>{t.setup.platformLabel}</span>
                      {aiSuggested.platform && <AiChip />}
                    </label>
                    <select
                      value={platform}
                      onChange={(e) => {
                        setPlatform(e.target.value);
                        clearAiSuggested('platform');
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:border-indigo-500"
                    >
                      <option value="PC / Desktop">{language === 'ru' ? 'ПК / Десктоп (Windows / Mac)' : 'PC / Desktop (Windows / Mac)'}</option>
                      <option value="Web Application">{language === 'ru' ? 'Веб-приложение (Браузер)' : 'Web Application (Browser)'}</option>
                      <option value="Mobile App">{language === 'ru' ? 'Мобильное приложение (iOS / Android)' : 'Mobile App (iOS / Android)'}</option>
                      <option value="Cross-Platform">{language === 'ru' ? 'Кроссплатформенный проект' : 'Cross-Platform'}</option>
                    </select>
                  </div>
                </div>

                {/* Reliability Guarantees Checklist */}
                <div
                  className={`space-y-2 border-t border-slate-800 pt-4 ${
                    showDetails ? '' : 'hidden'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold text-slate-200">
                      {language === 'ru' ? 'Гарантии надежности архитектуры' : 'Architectural Reliability & Code Guarantees'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-300">
                    {[
                      language === 'ru' ? 'Строгая типизация (TypeScript / C# / GDScript)' : 'Strict Typing (TypeScript / C# / GDScript)',
                      language === 'ru' ? 'Автоматические модульные тесты' : 'Automated Unit & Integration Tests',
                      language === 'ru' ? 'Защитные контуры и обработка ошибок' : 'Error Boundary & Exception Guarding',
                      language === 'ru' ? 'Безопасное сохранение состояния' : 'Persistent Local State Recovery'
                    ].map((g, i) => {
                      const baseKey = [
                        'Strict Typing (TypeScript / C# / GDScript)',
                        'Automated Unit & Integration Tests',
                        'Error Boundary & Exception Guarding',
                        'Persistent Local State Recovery'
                      ][i];
                      const isChecked = reliabilityGuarantees.includes(baseKey);
                      return (
                        <label
                          key={baseKey}
                          className={`flex items-center gap-2 p-2 rounded-lg border transition-all cursor-pointer ${
                            isChecked
                              ? 'bg-indigo-950/40 border-indigo-800/80 text-indigo-200'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              if (isChecked) {
                                setReliabilityGuarantees(reliabilityGuarantees.filter((x) => x !== baseKey));
                              } else {
                                setReliabilityGuarantees([...reliabilityGuarantees, baseKey]);
                              }
                            }}
                            className="rounded bg-slate-950 border-slate-800 text-indigo-500"
                          />
                          <span className="font-medium">{g}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {folderBlock}

                {errorMsg && <p className="text-xs text-rose-400 font-medium">{errorMsg}</p>}

                {/* Action Buttons */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <button
                    onClick={handleFetchQuestions}
                    disabled={!canStartAnalysis}
                    className={buttonClass({ variant: 'primary', size: 'md' })}
                  >
                    {isLoadingQuestions ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>{language === 'ru' ? 'Генерация вопросов...' : 'Generating Questions for Idea...'}</span>
                      </>
                    ) : (
                      <>
                        <QuestionIcon className="w-4 h-4 text-indigo-200" />
                        <span>{language === 'ru' ? 'Уточнить детали архитектуры' : 'Interactive Setup: Ask Project Questions'}</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleGenerateIdeaDirect}
                    disabled={!canStartAnalysis}
                    className={buttonClass({ variant: 'secondary', size: 'md' })}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>{t.setup.analyzing}</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 text-amber-400" />
                        <span>{language === 'ru' ? 'Мгновенный план MVP' : 'Instant Plan (Skip Questions)'}</span>
                      </>
                    )}
                  </button>
                </div>
              </>
            )}

            {wizardStep === 2 && (
              <div className="space-y-4 bg-slate-950/60 p-4 border border-slate-800 rounded-xl">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-indigo-400" />
                      <span>{t.setup.questionsTitle}</span>
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {language === 'ru' ? 'Ответьте на вопросы для калибровки архитектуры:' : `Tailored specifically for "${projectName || 'Your Idea'}".`}
                    </p>
                  </div>
                  <button
                    onClick={() => setWizardStep(1)}
                    className={buttonClass({ variant: 'ghost', size: 'xs' })}
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>{t.setup.backButton}</span>
                  </button>
                </div>

                {/* Clarifying Questions */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <QuestionIcon className="w-3.5 h-3.5 text-indigo-400" />
                    <span>{t.setup.questionsTitle}</span>
                    <AiChip />
                  </h4>
                  {questions.map((q, idx) => (
                    <div key={q.id} className="bg-slate-900 border border-slate-800/90 rounded-xl p-3.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider bg-indigo-950 border border-indigo-900 px-2 py-0.5 rounded">
                          {language === 'ru' ? 'Вопрос ' : 'Question '}{idx + 1}: {q.topic}
                        </span>
                        <AiChip />
                      </div>
                      <p className="text-xs font-semibold text-slate-200">{q.questionText}</p>
                      <input
                        type="text"
                        value={answers[q.id] || ''}
                        onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                        placeholder={q.placeholder}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-indigo-200 focus:border-indigo-500 font-medium"
                      />
                    </div>
                  ))}
                </div>

                {/* Architectural Trade-Off Decisions */}
                {tradeOffs && tradeOffs.length > 0 && (
                  <div className="space-y-3 pt-2 border-t border-slate-800/80">
                    <h4 className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-amber-400" />
                      <span>{language === 'ru' ? 'Архитектурные компромиссы' : 'AI Architect Trade-Off Decisions'}</span>
                      <AiChip />
                    </h4>
                    <div className="grid grid-cols-1 gap-3">
                      {tradeOffs.map((t) => {
                        const selectedOption = tradeOffChoices[t.id] || t.optionA;
                        return (
                          <div key={t.id} className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-100">{t.title}</span>
                              <span className="text-[10px] bg-amber-950/80 text-amber-300 border border-amber-800/60 px-2 py-0.5 rounded font-medium">
                                {language === 'ru' ? 'Рек.' : 'Rec:'} {t.recommendation}
                              </span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {[t.optionA, t.optionB].map((opt) => {
                                const isSelected = selectedOption === opt;
                                return (
                                  <button
                                    key={opt}
                                    type="button"
                                    onClick={() => setTradeOffChoices({ ...tradeOffChoices, [t.id]: opt })}
                                    className={buttonClass({
                                      variant: isSelected ? 'primary' : 'secondary',
                                      size: 'sm',
                                      className: 'w-full justify-between text-left'
                                    })}
                                  >
                                    <span className="flex w-full items-center justify-between gap-2">
                                      <span>{opt}</span>
                                      {isSelected && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-indigo-300" />}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {folderBlock}

                {errorMsg && <p className="text-xs text-rose-400 font-medium">{errorMsg}</p>}

                <button
                  onClick={handleGenerateIdeaDirect}
                  disabled={isGenerating || !canStartAnalysis}
                  className={buttonClass({ variant: 'primary', size: 'md', className: 'mt-4 w-full' })}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{t.setup.analyzing}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-amber-300" />
                      <span>{t.setup.confirmCreateButton}</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Mode B Content: Import Seed / Snapshot */}
        {activeTab === 'import' && (
          <div className="space-y-5">
            {modeBlock}

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-200">
                {language === 'ru' ? 'Выберите готовый шаблон проекта:' : 'Select a Pre-configured Sample Project Seed:'}
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Phaser Seed Card */}
                <div
                  onClick={() => {
                    onAddProject(language === 'ru' ? PHASER_SEED_PROJECT : PHASER_SEED_PROJECT_EN);
                    onClose();
                  }}
                  className="bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/60 rounded-xl p-4 transition-all cursor-pointer group space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Gamepad2 className="w-5 h-5 text-amber-400" />
                      <span className="font-bold text-sm text-slate-100 group-hover:text-amber-300">
                        Beer Simulator 2D
                      </span>
                    </div>
                    <span className="text-[10px] bg-amber-950 text-amber-300 border border-amber-800 px-2 py-0.5 rounded font-semibold">
                      Phaser 3 Canvas
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    {language === 'ru'
                      ? '2D игра с физикой открывания напитков, пробкой, частицами пены и Web Audio.'
                      : 'Browser 2D physics game with bottle opener drag gestures, cap collision, foam particles, and Web Audio.'}
                  </p>
                </div>

                {/* Godot Seed Card */}
                <div
                  onClick={() => {
                    onAddProject(language === 'ru' ? GODOT_SEED_PROJECT : GODOT_SEED_PROJECT_EN);
                    onClose();
                  }}
                  className="bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/60 rounded-xl p-4 transition-all cursor-pointer group space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Gamepad2 className="w-5 h-5 text-cyan-400" />
                      <span className="font-bold text-sm text-slate-100 group-hover:text-cyan-300">
                        Pixel Knight 2D
                      </span>
                    </div>
                    <span className="text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-800 px-2 py-0.5 rounded font-semibold">
                      Godot 4 GDScript
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    {language === 'ru'
                      ? '2D платформер с физикой CharacterBody2D, прыжками от стен, коллизиями TileMap и патрулированием врагов.'
                      : '2D action platformer with CharacterBody2D physics, wall jumps, TileMap collisions, and enemy patrol AI.'}
                  </p>
                </div>

                {/* Unity Seed Card */}
                <div
                  onClick={() => {
                    onAddProject(language === 'ru' ? UNITY_SEED_PROJECT : UNITY_SEED_PROJECT_EN);
                    onClose();
                  }}
                  className="bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500/60 rounded-xl p-4 transition-all cursor-pointer group space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Gamepad2 className="w-5 h-5 text-indigo-400" />
                      <span className="font-bold text-sm text-slate-100 group-hover:text-indigo-300">
                        Island Survival 3D
                      </span>
                    </div>
                    <span className="text-[10px] bg-indigo-950 text-indigo-300 border border-indigo-800 px-2 py-0.5 rounded font-semibold">
                      Unity C#
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    {language === 'ru'
                      ? '3D игра на выживание со скриптами PlayerHealth, PlayerStats, префабами и разбором ошибки NullReferenceException.'
                      : '3D survival game with PlayerHealth, PlayerStats, Prefab references, and simulated NullReferenceException.'}
                  </p>
                </div>

                {/* React Seed Card */}
                <div
                  onClick={() => {
                    onAddProject(language === 'ru' ? REACT_SEED_PROJECT : REACT_SEED_PROJECT_EN);
                    onClose();
                  }}
                  className="bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500/60 rounded-xl p-4 transition-all cursor-pointer group space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Code2 className="w-5 h-5 text-emerald-400" />
                      <span className="font-bold text-sm text-slate-100 group-hover:text-emerald-300">
                        TaskMaster AI SaaS
                      </span>
                    </div>
                    <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded font-semibold">
                      React 19 TS
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    {language === 'ru'
                      ? 'Стек React 19 + Express API с автокатегоризацией Gemini и канбан-доской.'
                      : 'Full React 19 + Express API setup with Gemini auto-categorization and Kanban board layout.'}
                  </p>
                </div>
              </div>
            </div>

            {folderBlock}

            {/* The AI reads the real project before anything is created. */}
            <div className="pt-3 border-t border-slate-800 space-y-2">
              <label className="text-xs font-bold text-slate-200 block">{t.setup.importUnderstandTitle}</label>
              <p className="text-[11px] text-slate-400">{t.setup.importUnderstandHint}</p>
              <button
                type="button"
                onClick={() => handleUnderstandWorkspace('folder')}
                disabled={isUnderstanding || (!folderScan && !folderPath.trim())}
                className={buttonClass({ variant: 'primary', size: 'md', className: 'w-full' })}
              >
                {isUnderstanding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                <span>{isUnderstanding ? t.setup.importReading : t.setup.importUnderstandFolder}</span>
              </button>
              {!folderScan && (
                <p className="flex items-start gap-1.5 text-[11px] font-semibold text-amber-300">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{t.setup.folderNotConnectedHint}</span>
                </p>
              )}
            </div>

            {/* What the AI understood about the project that already exists. */}
            {understanding && importPlan && (
              <div className="space-y-3 bg-slate-950/80 border border-indigo-500/40 rounded-xl p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <AiChip />
                  <span className="text-xs font-bold text-white">{t.setup.importUnderstoodTitle}</span>
                </div>

                <p className="text-xs text-slate-200 leading-relaxed">
                  <strong className="text-white">{importPlan.projectName}</strong>
                  {` — ${importPlan.engineOrFramework} · ${importPlan.language}`}
                </p>
                {importPlan.tagline && (
                  <p className="text-[11px] text-slate-300 leading-relaxed">{importPlan.tagline}</p>
                )}

                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                  <span>
                    {t.setup.importFilesRead}:{' '}
                    <span className="font-bold text-slate-200">{understanding.fileCount}</span>
                  </span>
                  <span>·</span>
                  <span>
                    {t.setup.importPlanSummary}:{' '}
                    <span className="font-bold text-slate-200">
                      {(importPlan.phases || []).length} / {(importPlan.phases || []).reduce((sum: number, phase: any) => sum + (phase.tasks || []).length, 0)}
                    </span>
                  </span>
                </div>

                {understanding.keyFiles.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t.setup.importKeyFiles}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {understanding.keyFiles.map((file) => (
                        <span key={file} className="text-[10px] font-mono bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 text-slate-300">
                          {file}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {understanding.evidence.length > 0 && (
                  <ul className="space-y-1 text-[11px] text-slate-300">
                    {understanding.evidence.map((line, index) => (
                      <li key={index} className="flex gap-1.5">
                        <span className="text-indigo-400">•</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                  onClick={handleCreateFromImport}
                  disabled={isGenerating}
                  className={buttonClass({ variant: 'success', size: 'md', className: 'flex-1' })}
                  >
                    {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                    <span>{isGenerating ? t.setup.analyzing : t.setup.importCreateContinue}</span>
                  </button>
                  <button
                    type="button"
                  onClick={() => handleUnderstandWorkspace(understanding.source)}
                  disabled={isUnderstanding}
                  className={buttonClass({ variant: 'secondary', size: 'md' })}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>{t.setup.importReRead}</span>
                  </button>
                </div>

              </div>
            )}

            {/* No folder? The list of real paths is enough for the AI to understand the project. */}
            <div className="pt-3 border-t border-slate-800 space-y-2">
              <label className="text-xs font-bold text-slate-200">{t.setup.importListTitle}</label>
              <textarea
                value={importText}
                onChange={(e) => {
                  setImportText(e.target.value);
                  if (importError) setImportError('');
                }}
                placeholder={language === 'ru' ? 'Вставьте список файлов (например, Assets/Scripts/PlayerHealth.cs, Assets/Prefabs/Player.prefab)...' : 'Paste folder structure or file list (e.g. Assets/Scripts/PlayerHealth.cs, Assets/Prefabs/Player.prefab)...'}
                rows={4}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:border-indigo-500 font-mono"
              />
              {importError && <p className="text-xs text-rose-400 font-medium">{importError}</p>}
              <button
                type="button"
                onClick={() => handleUnderstandWorkspace('paths')}
                disabled={isUnderstanding || !importText.trim()}
                className={buttonClass({ variant: 'secondary', size: 'md', className: 'w-full' })}
              >
                {isUnderstanding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                <span>{t.setup.importUnderstandList}</span>
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
};
