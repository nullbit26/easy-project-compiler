import React, { useEffect, useRef, useState } from 'react';
import { HashRouter as Router, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { ProjectProvider, useProject } from './context/ProjectContext';
import { isGuidedInterface } from './utils/workingMode';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { Dashboard } from './components/Dashboard';
import { PromptCompiler } from './components/PromptCompiler';
import { SessionReview } from './components/SessionReview';
import { VisualErrorCoach } from './components/VisualErrorCoach';
import { CodePreviewRunner } from './components/CodePreviewRunner';
import { PlanKanban } from './components/PlanKanban';
import { PlanCanvas } from './components/PlanCanvas';
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

/** Screens that can be kept alive. Unknown paths fall back to the dashboard. */
const TAB_PATHS = ['/', '/simple', '/compiler', '/review', '/preview', '/coach', '/plan', '/map', '/files', '/brief'] as const;
type TabPath = (typeof TAB_PATHS)[number];

function normalizeTabPath(pathname: string): TabPath | null {
  if (pathname === '/' || pathname === '/dashboard') return '/';
  return (TAB_PATHS as readonly string[]).includes(pathname) ? (pathname as TabPath) : null;
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
    onApplyFileInsights,
    onUpdateRulesContent,
    onRecordRulesCheck,
    onUpdateTaskStatus,
    onAddTask,
    onAdoptTask,
    onAdaptProjectPhases,
    onUpdateTaskPositions,
    onUpdateTaskTitle,
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

  const setActiveTab = (tabId: string) => {
    if (tabId === 'dashboard') navigate('/');
    else if (tabId === 'simple_flow') navigate('/simple');
    else if (tabId === 'prompt_compiler') navigate('/compiler');
    else if (tabId === 'code_preview') navigate('/preview');
    else if (tabId === 'session_review') navigate('/review');
    else if (tabId === 'error_coach') navigate('/coach');
    else if (tabId === 'project_plan') navigate('/plan');
    else if (tabId === 'project_map') navigate('/map');
    else if (tabId === 'project_files') navigate('/files');
    else if (tabId === 'brief_architecture') navigate('/brief');
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

  const renderTab = (path: TabPath) => {
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
            onUpdateCanvasLanes={onUpdateCanvasLanes}
            onCompileTaskPrompt={(taskTitle) => {
              setCompilerTaskTitle(taskTitle);
              navigate('/compiler');
            }}
            onAddTask={onAddTask}
            onAdaptProjectPhases={onAdaptProjectPhases}
            onOpenNewProjectModal={() => setShowSetupModal(true)}
            onSwitchToKanban={() => setPlanView('kanban')}
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
  const planScreen = activePath === '/plan';

  /** How one screen's box is drawn: only the visible one is shown, and only the board grows. */
  const screenClass = (path: string) => {
    if (path !== activePath) return 'hidden';
    return path === '/plan' ? 'flex min-h-0 flex-1 flex-col' : undefined;
  };

  // The window itself never scrolls: the app fills it exactly, and only the working area moves.
  // That is what keeps the sidebar, the top bar and the app's own title bar in place.
  return (
    <div className="h-screen overflow-hidden bg-slate-950 text-slate-100 font-sans antialiased selection:bg-indigo-500 selection:text-white flex flex-col">
      <TitleBar />

      <div className="flex flex-1 min-h-0 w-full" inert={modalOpen || undefined}>
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
        onToggleAllPanels={() => setShowAllPanels((prev) => !prev)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Toast Notification */}
        <Toast message={toastMessage} onClose={clearToast} />

        {/* "AI is working" status — visible from every screen while a request is in flight */}
        <AiActivityIndicator />

        {/* The rules check that runs by itself after every batch written into the folder. */}
        <RulesWatchdog />

        {/* Navbar Header */}
        <Navbar
          currentProject={currentProject}
          onSelectAgent={onSelectAgent}
          onSelectInterfaceMode={onSelectInterfaceMode}
          onSelectAutonomy={onSelectAutonomy}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onOpenSavedProjectsDrawer={() => setIsSavedDrawerOpen(true)}
          onToggleMobileSidebar={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
          simpleMode={simpleMode}
        />

        {/* Main Tab View Canvas — the only part of the window that scrolls. */}
        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden w-full">
          <div
            className={
              planScreen
                ? 'flex min-h-full w-full flex-col px-3 py-2 short:py-1.5'
                : 'w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 short:py-2'
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
                  {renderTab(path)}
                </div>
              ))}
              {!activePath && <Navigate to="/" replace />}
            </ErrorBoundary>
          </div>
        </main>

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
