import React, { useEffect, useRef, useState } from 'react';
import { HashRouter as Router, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { ProjectProvider, useProject } from './context/ProjectContext';
import { isGuidedInterface } from './utils/workingMode';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { WorkspacePane } from './components/workspace/WorkspacePane';
import {
  addPane,
  MAX_EXTRA_PANES,
  parseWorkspace,
  removePane,
  serializeWorkspace,
  setPanePath,
  WORKSPACE_STORAGE_KEY,
  type ScreenPath,
  type WorkspaceState
} from './components/workspace/workspaceLayout';
import { adjustSizes } from './components/split/splitSizes';
import { TitleBar } from './components/TitleBar';
import { Dashboard } from './components/Dashboard';
import { PromptCompiler } from './components/PromptCompiler';
import { SessionReview } from './components/SessionReview';
import { VisualErrorCoach } from './components/VisualErrorCoach';
import { CodePreviewRunner } from './components/CodePreviewRunner';
import { PlanKanban } from './components/PlanKanban';
import { PlanCanvas } from './components/PlanCanvas';
import { StudioScreen } from './components/studio/StudioScreen';
import { ProjectMap } from './components/ProjectMap';
import { ProjectWorkspace } from './components/ProjectWorkspace';
import { BriefView } from './components/BriefView';
import { ProjectSetup } from './components/ProjectSetup';
import { SimpleFlow } from './components/SimpleFlow';
import { SavedProjectsDrawer } from './components/SavedProjectsDrawer';
import { ApiSettingsPanel } from './components/ApiSettingsPanel';
import { Toast } from './components/Toast';
import { AiActivityIndicator } from './components/AiActivityIndicator';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RulesWatchdog } from './components/RulesWatchdog';
import { probeServer } from './services/serverPresence';

/** Screens that can be kept alive. Unknown paths fall back to the dashboard. */
const TAB_PATHS = ['/', '/simple', '/compiler', '/review', '/preview', '/coach', '/plan', '/studio', '/map', '/files', '/brief'] as const;
type TabPath = (typeof TAB_PATHS)[number];

function normalizeTabPath(pathname: string): TabPath | null {
  if (pathname === '/' || pathname === '/dashboard') return '/';
  return (TAB_PATHS as readonly string[]).includes(pathname) ? (pathname as TabPath) : null;
}

/**
 * Whether the left panel is folded to its strip of icons. Remembered: a panel the user folded to
 * read a wide board should not be unfolded again by the next start.
 */
const SIDEBAR_FOLDED_KEY = 'easy_project_compiler_sidebar_folded';

function readSidebarFolded(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_FOLDED_KEY) === '1';
  } catch {
    return false;
  }
}

/** The panes opened beside the screens, remembered between sessions. */
function readWorkspace(): WorkspaceState {
  try {
    return parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY));
  } catch {
    return parseWorkspace(null);
  }
}

function AppContent() {
  const { language, t } = useLanguage();
  const {
    allProjects,
    currentProject,
    toastMessage,
    compilerTaskTitle,
    reviewOutputText,
    coachErrorText,
    setCompilerTaskTitle,
    setReviewOutputText,
    setCoachErrorText,
    reviewTaskHint,
    setReviewTaskHint,
    showToast,
    clearToast,
    onSelectProject,
    onDeleteProject,
    onSelectAgent,
    onSelectInterfaceMode,
    onSelectAutonomy,
    onAddProject,
    onUpdateProjectFiles,
    onSyncProjectFiles,
    onSetProjectFolder,
    onApplyFileInsights,
    onUpdateRulesContent,
    onRecordRulesCheck,
    onUpdateTaskStatus,
    onAddTask,
    onAdoptTask,
    onAdaptProjectPhases,
    onUpdateTaskPositions,
    onUpdateTaskTitle,
    onUpdateTaskFiles,
    onUpdateCanvasLanes
  } = useProject();

  const [showSetupModal, setShowSetupModal] = useState(false);
  const [isSavedDrawerOpen, setIsSavedDrawerOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [showApiSettings, setShowApiSettings] = useState(false);
  // Under the guided interface the eight technical screens stay hidden behind one click, and the
  // step-by-step helper becomes the whole workspace. Only the interface part decides this — the
  // autonomy part never changes which screens exist.
  const [showAllPanels, setShowAllPanels] = useState(false);
  /**
   * The plan screen opens as a board by default: space carries the plan's shape, and columns are
   * still one click away for whoever reads a plan as a list of stages.
   */
  const [planView, setPlanView] = useState<'canvas' | 'kanban'>('canvas');
  /**
   * The panes beside the routed screen. The route is always the first column — the sidebar stays
   * the way screens are navigated — and these are the extra windows opened with the plus.
   */
  const [workspace, setWorkspace] = useState<WorkspaceState>(readWorkspace);
  const [sidebarFolded, setSidebarFolded] = useState(readSidebarFolded);
  const rowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_FOLDED_KEY, sidebarFolded ? '1' : '0');
    } catch {
      // Storage may be refused (private mode); the panel then keeps this shape for the session.
    }
  }, [sidebarFolded]);

  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, serializeWorkspace(workspace));
    } catch {
      // Storage may be refused (private mode); the row then lasts for this session only.
    }
  }, [workspace]);

  const navigate = useNavigate();
  const location = useLocation();

  const getActiveTabFromPath = () => {
    const path = location.pathname;
    if (path === '/' || path === '/dashboard') return 'dashboard';
    if (path === '/simple') return 'simple_flow';
    if (path === '/compiler') return 'prompt_compiler';
    if (path === '/preview') return 'code_preview';
    if (path === '/review') return 'session_review';
    if (path === '/coach') return 'error_coach';
    if (path === '/plan') return 'project_plan';
    if (path === '/studio') return 'studio';
    if (path === '/map') return 'project_map';
    if (path === '/files') return 'project_files';
    if (path === '/brief') return 'brief_architecture';
    return 'dashboard';
  };

  const activeTab = getActiveTabFromPath();
  const activePath = normalizeTabPath(location.pathname);

  // Screens stay mounted once they have been opened. Switching tabs used to unmount the current
  // screen, which silently threw away a running AI request and every result on it — the Prompt
  // Compiler restarted from scratch on each visit. Hidden screens keep their state (and keep
  // their requests running) instead.
  const [visitedPaths, setVisitedPaths] = useState<TabPath[]>(() => (activePath ? [activePath] : []));

  useEffect(() => {
    if (!activePath) return;
    setVisitedPaths((prev) => (prev.includes(activePath) ? prev : [...prev, activePath]));
  }, [activePath]);

  /**
   * Whether this page has the app's own server behind it.
   *
   * The page can be opened from a bare Vite or static server while the interface is being looked at;
   * there every `/api/*` is answered with the app's own HTML, so nothing on the file, Git, check or
   * preview screens can work. One question at start, asked of the one address that answers in data,
   * is enough for the title bar to say so before a screen has failed on its own.
   */
  const [serverMissing, setServerMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void probeServer().then((presence) => {
      if (!cancelled) setServerMissing(presence === 'missing');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** The screen each sidebar entry names. */
  const TAB_TO_PATH: Record<string, TabPath> = {
    dashboard: '/',
    simple_flow: '/simple',
    prompt_compiler: '/compiler',
    code_preview: '/preview',
    session_review: '/review',
    error_coach: '/coach',
    project_plan: '/plan',
    studio: '/studio',
    project_map: '/map',
    project_files: '/files',
    brief_architecture: '/brief'
  };

  const setActiveTab = (tabId: string) => {
    const path = TAB_TO_PATH[tabId];
    if (!path) return;
    /*
     * A screen is live once. Choosing in the sidebar a screen that is open in a pane brings it to
     * the primary column and leaves the pane asking what goes there next — the alternative is two
     * live boards (or two running previews) on one screen, each with its own selection.
     */
    if (path !== '/studio') {
      setWorkspace((current) => {
        const occupant = current.panes.find((pane) => pane.path === path);
        return occupant ? setPanePath(current, occupant.id, null) : current;
      });
    }
    navigate(path);
  };

  const guidedProject = isGuidedInterface(currentProject);
  const simpleMode = guidedProject && !showAllPanels;

  /**
   * Where the app opens, decided once.
   *
   * Nothing saved yet: the step-by-step helper is the only screen with anything to do on it, so
   * that is what opens instead of a dashboard about nothing. Saved projects: the dashboard, with
   * the project that was last worked on (restored from storage) open — the app carries on where
   * the user stopped.
   *
   * Only for a start on the root path: a link straight to one screen (a browser reload on
   * /#/plan, say) names a deliberate destination and is left alone.
   */
  const startupLanded = useRef(false);
  useEffect(() => {
    if (startupLanded.current) return;
    startupLanded.current = true;
    if (location.pathname !== '/') return;

    if (allProjects.length === 0) {
      navigate('/simple', { replace: true });
      return;
    }

    // The remembered project can be missing from the list (deleted, or storage written by hand):
    // the dashboard needs a project that really exists, so the newest one is opened instead.
    if (!currentProject || !allProjects.some((p) => p.id === currentProject.id)) {
      onSelectProject(allProjects[0]);
    }
    // Runs once on purpose: this is the landing decision, not a rule that keeps pulling the user
    // back somewhere.
  }, []);

  /**
   * The four-step helper is where a beginner project belongs — but only when the user moves to one.
   * A beginner project restored at start-up keeps the dashboard chosen above: the default landing
   * is decided once and this rule must not quietly undo it.
   */
  const answeredBeginnerProject = useRef<string | null>(currentProject?.id ?? null);
  useEffect(() => {
    if (!simpleMode) return;
    if (answeredBeginnerProject.current === currentProject?.id) return;
    answeredBeginnerProject.current = currentProject?.id ?? null;
    if (location.pathname === '/') navigate('/simple', { replace: true });
  }, [simpleMode, currentProject?.id, location.pathname, navigate]);

  const handleAddProjectAndNavigate = (newProject: any) => {
    onAddProject(newProject);
    // The destination follows the project that was just created, not the one before it.
    navigate(isGuidedInterface(newProject) ? '/simple' : '/');
  };

  /**
   * `active` is whether this screen is the one in front. The studio is kept mounted while the user
   * works elsewhere (see `visitedPaths`), and its window tools are mounted into the title bar — so
   * only the studio in front may put them there; a hidden one would keep a toolbar for a screen the
   * user is not looking at.
   */
  const renderTab = (path: TabPath, active = true) => {
    switch (path) {
      case '/':
        return (
          <Dashboard
            project={currentProject}
            setActiveTab={setActiveTab}
            onRunQuickTask={(taskTitle) => {
              setCompilerTaskTitle(taskTitle);
              navigate('/compiler');
            }}
            /*
             * A task waiting for a verdict is opened in the review, on that task: the dashboard's
             * sentence says "paste the answer", and this is the screen that takes it.
             */
            onReviewTask={(taskTitle) => {
              setReviewTaskHint({ title: taskTitle, acceptanceCriteria: [] });
              navigate('/review');
            }}
            onOpenNewProjectModal={() => setShowSetupModal(true)}
          />
        );
      case '/simple':
        return (
          <SimpleFlow
            project={currentProject}
            onSyncProjectFiles={onSyncProjectFiles}
            onUpdateProjectFiles={onUpdateProjectFiles}
            onUpdateTaskStatus={onUpdateTaskStatus}
            onOpenNewProjectModal={() => setShowSetupModal(true)}
          />
        );
      case '/compiler':
        return (
          <PromptCompiler
            project={currentProject}
            initialTaskTitle={compilerTaskTitle}
            onSelectAgent={onSelectAgent}
            onSendToReview={(agentResultText, taskTitle, acceptanceCriteria) => {
              const title = (taskTitle || '').trim();
              const criteria = acceptanceCriteria || [];
              setReviewOutputText(agentResultText);
              // The task travels with the answer, so the review cannot judge it against a different
              // one (see the SessionReview prop of the same name).
              setReviewTaskHint({ title, acceptanceCriteria: criteria });
              /*
                A task the plan has never heard of joins the plan on the way in.

                The review keeps everything it decides — the attempts, the verdict, the completion —
                on the task it judged. A task that is not on the plan therefore has nowhere to keep
                any of it: the verdict disappeared on the next tab switch and the same answer was
                judged again on every return. The compiler is the only place that learns the task's
                name, so this is where it is written down.
              */
              const known = currentProject?.phases?.some((phase) =>
                phase.tasks.some((task) => task.title.trim().toLowerCase() === title.toLowerCase())
              );
              if (title && !known) {
                onAdoptTask({ title, acceptanceCriteria: criteria });
              }
              navigate('/review');
            }}
            onOpenNewProjectModal={() => setShowSetupModal(true)}
          />
        );
      case '/review':
        return (
          <SessionReview
            project={currentProject}
            initialAgentOutput={reviewOutputText}
            initialTaskHint={reviewTaskHint}
            onUpdateTaskStatus={onUpdateTaskStatus}
            onUpdateProjectFiles={onUpdateProjectFiles}
            onSendToCompiler={(prompt) => {
              setCompilerTaskTitle(prompt);
              navigate('/compiler');
            }}
            onOpenPreview={() => navigate('/preview')}
            onOpenNewProjectModal={() => setShowSetupModal(true)}
          />
        );
      case '/preview':
        return (
          <CodePreviewRunner
            project={currentProject}
            onSendErrorToCoach={(errText) => {
              setCoachErrorText(errText);
              navigate('/coach');
            }}
            onOpenNewProjectModal={() => setShowSetupModal(true)}
          />
        );
      case '/coach':
        return (
          <VisualErrorCoach
            project={currentProject}
            initialErrorInput={coachErrorText}
            onApplyFixToCode={(filePath, oldCode, newCode) => {
              const targetFile = currentProject?.projectMap.files.find(
                (f: any) => f.path === filePath || f.path.endsWith(filePath)
              );
              if (targetFile && targetFile.content) {
                const updatedContent = targetFile.content.replace(oldCode, newCode);
                onUpdateProjectFiles([{ path: targetFile.path, content: updatedContent }]);
                navigate('/preview');
              } else {
                showToast(
                  language === 'ru'
                    ? 'Целевой файл не найден или пуст в карте проекта.'
                    : 'Target file not found or empty in Project Map.'
                );
              }
            }}
            onSendFixToCompiler={(fixPrompt) => {
              setCompilerTaskTitle(fixPrompt);
              navigate('/compiler');
            }}
            onOpenNewProjectModal={() => setShowSetupModal(true)}
          />
        );
      case '/plan':
        return planView === 'canvas' ? (
          <PlanCanvas
            project={currentProject}
            onUpdateTaskStatus={onUpdateTaskStatus}
            onUpdateTaskPositions={onUpdateTaskPositions}
            onUpdateTaskTitle={onUpdateTaskTitle}
            onUpdateTaskFiles={onUpdateTaskFiles}
            onUpdateCanvasLanes={onUpdateCanvasLanes}
            onCompileTaskPrompt={(taskTitle) => {
              setCompilerTaskTitle(taskTitle);
              navigate('/compiler');
            }}
            onAddTask={onAddTask}
            onAdaptProjectPhases={onAdaptProjectPhases}
            onOpenNewProjectModal={() => setShowSetupModal(true)}
            onSwitchToKanban={() => setPlanView('kanban')}
            onOpenStudio={() => navigate('/studio')}
            /* The pipeline's verdicts are the one way a task turns done without a click: what
               the server's checks said is what the plan now says. */
            onPipelineTaskDone={(taskId, result) => {
              const ru = language !== 'en';
              onUpdateTaskStatus(
                taskId,
                result === 'completed' ? 'completed' : 'blocked',
                result === 'completed'
                  ? ru
                    ? 'Задача выполнена в режиме «Авто»: проверки проекта прошли.'
                    : 'Task completed by the Auto run: project checks passed.'
                  : ru
                  ? 'Режим «Авто» не смог выполнить задачу: нужны ручные правки.'
                  : 'The Auto run could not finish this task; fix it by hand.'
              );
            }}
          />
        ) : (
          <PlanKanban
            project={currentProject}
            onUpdateTaskStatus={onUpdateTaskStatus}
            onCompileTaskPrompt={(taskTitle) => {
              setCompilerTaskTitle(taskTitle);
              navigate('/compiler');
            }}
            onAddTask={onAddTask}
            onAdaptProjectPhases={onAdaptProjectPhases}
            onOpenNewProjectModal={() => setShowSetupModal(true)}
            onSwitchToCanvas={() => setPlanView('canvas')}
          />
        );
      case '/studio':
        return (
          <StudioScreen
            active={active}
            project={currentProject}
            onUpdateTaskStatus={onUpdateTaskStatus}
            onUpdateTaskPositions={onUpdateTaskPositions}
            onUpdateTaskTitle={onUpdateTaskTitle}
            onUpdateTaskFiles={onUpdateTaskFiles}
            onUpdateCanvasLanes={onUpdateCanvasLanes}
            onCompileTaskPrompt={(taskTitle) => {
              setCompilerTaskTitle(taskTitle);
              navigate('/compiler');
            }}
            onAddTask={onAddTask}
            onAdaptProjectPhases={onAdaptProjectPhases}
            onOpenNewProjectModal={() => setShowSetupModal(true)}
            onSendErrorToCoach={(errText) => {
              setCoachErrorText(errText);
              navigate('/coach');
            }}
            onPipelineTaskDone={(taskId, result) => {
              const ru = language !== 'en';
              onUpdateTaskStatus(
                taskId,
                result === 'completed' ? 'completed' : 'blocked',
                result === 'completed'
                  ? ru
                    ? 'Задача выполнена в режиме «Авто»: проверки проекта прошли.'
                    : 'Task completed by the Auto run: project checks passed.'
                  : ru
                  ? 'Режим «Авто» не смог выполнить задачу: нужны ручные правки.'
                  : 'The Auto run could not finish this task; fix it by hand.'
              );
            }}
          />
        );
      case '/map':
        return (
          <ProjectMap
            project={currentProject}
            onOpenNewProjectModal={() => setShowSetupModal(true)}
            onApplyFileInsights={onApplyFileInsights}
            onUpdateRulesContent={onUpdateRulesContent}
            onRecordRulesCheck={onRecordRulesCheck}
          />
        );
      case '/files':
        return (
          <ProjectWorkspace
            project={currentProject}
            onSyncProjectFiles={onSyncProjectFiles}
            onProjectFolderBound={onSetProjectFolder}
            onOpenNewProjectModal={() => setShowSetupModal(true)}
          />
        );
      case '/brief':
        return (
          <BriefView
            project={currentProject}
            onOpenNewProjectModal={() => setShowSetupModal(true)}
          />
        );
      default:
        return null;
    }
  };

  const ru = language === 'ru';

  /** A live screen exists once: the ones already in the row are not offered a second time. */
  const shownScreens: ScreenPath[] = [
    ...workspace.panes.map((pane) => pane.path).filter((path): path is ScreenPath => Boolean(path)),
    ...(activePath && activePath !== '/studio' ? [activePath as ScreenPath] : [])
  ];

  const openPane = () => setWorkspace((current) => addPane(current));
  const closePane = (id: string) => setWorkspace((current) => removePane(current, id));
  const chooseScreen = (id: string, path: ScreenPath) =>
    setWorkspace((current) => setPanePath(current, id, path));
  const clearScreen = (id: string) => setWorkspace((current) => setPanePath(current, id, null));

  /** A divider trades percent with its neighbour, exactly like the studio's. */
  const beginDividerDrag = (index: number, event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const box = rowRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    const origin = event.clientX;
    const start = workspace.shares;
    const move = (moveEvent: PointerEvent) => {
      const delta = ((moveEvent.clientX - origin) / box.width) * 100;
      setWorkspace((current) => ({ ...current, shares: adjustSizes(start, index, delta) }));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  const nudgeDivider = (index: number, event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 2;
    setWorkspace((current) => ({
      ...current,
      shares: adjustSizes(current.shares, index, event.key === 'ArrowRight' ? step : -step)
    }));
  };

  /**
   * A dialog is up: the working area behind it is made inert, so the tab key cannot walk out of the
   * dialog and back into the page underneath it. `inert` also takes the whole background out of the
   * accessibility tree, which is what `aria-modal` promises a screen reader.
   */
  const modalOpen = showSetupModal || showApiSettings;

  /*
   * The plan screen is a board, not a document. The reading screens are set in a centred column,
   * which is the right shape for text and the wrong one for a canvas: 192 px of empty window on
   * each side of a board is the largest room in the app spent on nothing. A board gets the whole
   * working window instead — full width, and the height that is left after the header.
   */
  /*
   * The plan and the studio are boards rather than documents: they get the whole working window,
   * edge to edge, and never a centred reading column — a split layout with 192 px of empty window
   * on each side would not be a split layout.
   */
  const fullBleedScreen =
    activePath === '/plan' || activePath === '/studio' || activePath === '/preview';

  /** How one screen's box is drawn: only the visible one is shown, and the boards grow. */
  const screenClass = (path: string) => {
    if (path !== activePath) return 'hidden';
    /*
     * The boards and the sandbox grow to the window; a page keeps its measured reading column.
     * The sandbox joined them because it is a workspace too: a split preview with a console under
     * it is a pane, and a pane that stops at 64vh leaves the bottom of the window empty.
     */
    return path === '/plan' || path === '/studio' || path === '/preview'
      ? 'flex min-h-0 flex-1 flex-col'
      : undefined;
  };

  // The window itself never scrolls: the app fills it exactly, and only the working area moves.
  // That is what keeps the sidebar, the top bar and the app's own title bar in place.
  return (
    <div className="h-screen overflow-hidden bg-slate-950 text-slate-100 font-sans antialiased selection:bg-indigo-500 selection:text-white flex">
      {/**
       * The sidebar is the window's one full-height column.
       *
       * It used to start under the title bar, which put a horizontal rule above it and made the
       * project switcher a block floating between the rule and the groups beneath it. Now the
       * column begins at the window's first pixel and owns the name and the mark, the way the
       * panels of an editor do; the strip on the right is only the window's controls, and its
       * hairline starts at the column's edge instead of crossing the whole window.
       */}
      <div className="flex h-full min-h-0 shrink-0" inert={modalOpen || undefined}>
      {/* Unified Left Sidebar (Projects + Workspace Tabs) */}
      <Sidebar
        allProjects={allProjects}
        currentProject={currentProject}
        onSelectProject={onSelectProject}
        onDeleteProject={onDeleteProject}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenNewProjectModal={() => setShowSetupModal(true)}
        onOpenApiSettings={() => setShowApiSettings(true)}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        showAllPanels={showAllPanels}
        onToggleAllPanels={() => {
          // Revealing every section is the door out of the guided interface: it is the only place
          // that lists what there is to open, so the switch lives there. Making it stick (the
          // project's interface becomes `full`) is what the old "Полный экран" button in the top
          // bar did — that button, and the empty strip it needed, are gone; the door is where the
          // sections are.
          const revealing = !showAllPanels;
          setShowAllPanels(revealing);
          if (revealing) onSelectInterfaceMode?.('full');
        }}
        collapsed={sidebarFolded}
        onToggleCollapsed={() => setSidebarFolded((prev) => !prev)}
      />
      </div>

      {/* The workspace column: window controls, then the screens, with no rule above the sidebar. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/*
        The plus that adds a column beside the screen lives in the title bar, not in the screen's
        corner: there it sat on the content's scrollbar, over the very panel the user wanted to read.
        The bar is already there, so the control costs no height and never scrolls away.
      */}
      <TitleBar
        onOpenScreenBeside={
          currentProject && activePath && activePath !== '/studio' ? openPane : undefined
        }
        openScreenBesideDisabled={workspace.panes.length >= MAX_EXTRA_PANES}
        serverMissing={serverMissing}
      />

      <div className="flex flex-1 min-h-0 w-full" inert={modalOpen || undefined}>
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Toast Notification */}
        <Toast message={toastMessage} onClose={clearToast} />

        {/*
          "AI is working" status — visible from every screen while a request is in flight, except
          the two screens that open a terminal for the request itself: there a second card counting
          the same seconds in the corner is noise on top of the log. Leaving either screen brings
          the card back, so a request started here is still accounted for elsewhere.
        */}
        <AiActivityIndicator hidden={activePath === '/simple' || activePath === '/compiler'} />

        {/* The rules check that runs by itself after every batch written into the folder. */}
        <RulesWatchdog />

        {/* The narrow window's menu button — nothing at all on a desktop window. */}
        <Navbar onToggleMobileSidebar={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)} />

        {/* Main Tab View Canvas — the only part of the window that scrolls. */}
        <div className="flex flex-1 min-h-0 min-w-0" ref={rowRef}>
          <div
            className="relative flex min-h-0 min-w-0 flex-col"
            style={{ flexGrow: workspace.shares[0] ?? 1, flexBasis: 0 }}
          >
        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden w-full">
          <div
            className={
              activePath === '/studio'
                ? /*
                    The studio is the window, not a panel in it: a padding around the split drew a
                    frame above the plan's own toolbar, and its rounded corner made the whole
                    workspace look like a card inside the app. `@container` and a definite height
                    stay, so a pane reads its own width and keeps filling the box exactly.
                  */
                  '@container flex h-full w-full flex-col'
                : fullBleedScreen
                ? /*
                    `h-full`, not `min-h-full`: a pane reads its height from this box, and a box that
                    only has a minimum leaves the pane to size itself from its content — which is
                    how the sandbox ended up 455 px tall in an 808 px window, with the rest of the
                    screen empty. The height is definite here, so the pane can fill it.
                  */
                  /* `@container`: the screens lay themselves out by the column they were given, not
                     by the window — a screen in a pane beside another screen is narrower than the
                     window and used to keep its three-column desktop grid inside 460 px. */
                  '@container flex h-full w-full flex-col px-3 py-2 short:py-1.5'
                : '@container w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 short:py-2'
            }
          >
            {/* A crash inside one screen must never blank the whole app. */}
            <ErrorBoundary
              title={t.common.errorBoundaryTitle}
              hint={t.common.errorBoundaryHint}
              retryLabel={t.common.errorBoundaryRetry}
            >
              {visitedPaths.map((path) => (
                <div
                  key={path}
                  className={screenClass(path)}
                  aria-hidden={path !== activePath}
                >
                  {renderTab(path, path === activePath)}
                </div>
              ))}
              {!activePath && <Navigate to="/" replace />}
            </ErrorBoundary>
          </div>
        </main>
          </div>

          {workspace.panes.map((pane, index) => (
            <React.Fragment key={pane.id}>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={ru ? 'Изменить ширину окон' : 'Resize the panes'}
                aria-valuenow={Math.round(workspace.shares[index] ?? 0)}
                tabIndex={0}
                data-testid={`workspace-divider-${pane.id}`}
                onPointerDown={(event) => beginDividerDrag(index, event)}
                onKeyDown={(event) => nudgeDivider(index, event)}
                className="group relative z-10 flex w-1 shrink-0 cursor-col-resize items-center justify-center bg-slate-800/60 transition-colors hover:bg-indigo-500/70 focus-visible:bg-indigo-500/70"
              >
                <span className="pointer-events-none h-8 w-0.5 rounded-full bg-slate-600/0 transition-colors group-hover:bg-slate-300/60" />
              </div>
              <div
                className="flex min-h-0 min-w-0 flex-col"
                style={{ flexGrow: workspace.shares[index + 1] ?? 1, flexBasis: 0 }}
              >
                <WorkspacePane
                  path={pane.path}
                  taken={shownScreens}
                  onPick={(path) => chooseScreen(pane.id, path)}
                  onClear={() => clearScreen(pane.id)}
                  onClose={() => closePane(pane.id)}
                >
                  {pane.path && (
                    <ErrorBoundary
                      key={pane.path}
                      title={t.common.errorBoundaryTitle}
                      hint={t.common.errorBoundaryHint}
                      retryLabel={t.common.errorBoundaryRetry}
                    >
                      {renderTab(pane.path)}
                    </ErrorBoundary>
                  )}
                </WorkspacePane>
              </div>
            </React.Fragment>
          ))}
        </div>

        <ErrorBoundary
          title={t.common.errorBoundaryTitle}
          hint={t.common.errorBoundaryHint}
          retryLabel={t.common.errorBoundaryRetry}
        >
        {/* Saved Projects Side Drawer */}
        <SavedProjectsDrawer
          isOpen={isSavedDrawerOpen}
          onClose={() => setIsSavedDrawerOpen(false)}
          allProjects={allProjects}
          currentProject={currentProject}
          onSelectProject={onSelectProject}
          onDeleteProject={onDeleteProject}
          onOpenNewProjectModal={() => {
            setIsSavedDrawerOpen(false);
            setShowSetupModal(true);
          }}
        />

        </ErrorBoundary>
      </div>
      </div>
      </div>

      {/**
       * The two dialogs live outside the working area, and that area is inert while either is open
       * (see `modalOpen` above). Drawn at this level they are siblings of the whole layout, not of
       * the screen that happened to open them.
       */}
      <ErrorBoundary
        title={t.common.errorBoundaryTitle}
        hint={t.common.errorBoundaryHint}
        retryLabel={t.common.errorBoundaryRetry}
      >
        {/* API Keys Settings Modal (opened from the sidebar footer, bottom-left) */}
        {showApiSettings && <ApiSettingsPanel onClose={() => setShowApiSettings(false)} />}

        {/* New Project Setup Modal */}
        {showSetupModal && (
          <ProjectSetup
            onAddProject={handleAddProjectAndNavigate}
            onClose={() => setShowSetupModal(false)}
          />
        )}
      </ErrorBoundary>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <LanguageProvider>
        <ProjectProvider>
          <AppContent />
        </ProjectProvider>
      </LanguageProvider>
    </Router>
  );
}
