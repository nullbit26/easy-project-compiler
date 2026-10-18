import React, { useEffect, useState } from 'react';
import { ProjectState } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { useSessionProgress } from '../services/sessionProgress';
import { BuildBadge } from './BuildBadge';
import { UpdateNotice } from './UpdateNotice';
import {
  Sparkles,
  Terminal,
  Code2,
  BookOpen,
  Layers,
  Bug,
  CheckCircle2,
  Play,
  FolderOpen,
  Plus,
  HardDrive,
  KeyRound,
  Wand2,
  LayoutList,
  Trash2,
  ChevronsUpDown
} from 'lucide-react';

interface SidebarProps {
  allProjects: ProjectState[];
  currentProject: ProjectState | null;
  onSelectProject: (proj: ProjectState) => void;
  onDeleteProject: (projectId: string) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenNewProjectModal: () => void;
  onOpenApiSettings?: () => void;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
  /** The workspace starts folded: only the step-by-step screen is visible until it is revealed. */
  showAllPanels?: boolean;
  onToggleAllPanels?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  allProjects,
  currentProject,
  onSelectProject,
  onDeleteProject,
  activeTab,
  setActiveTab,
  onOpenNewProjectModal,
  onOpenApiSettings,
  isOpenMobile = false,
  onCloseMobile,
  showAllPanels = false,
  onToggleAllPanels
}) => {
  const { language, setLanguage, t } = useLanguage();
  /** The project a delete button was pressed for; nothing is removed until this is confirmed. */
  const [pendingDelete, setPendingDelete] = useState<ProjectState | null>(null);

  /*
   * A run of the loop is several waits long, and the screen that shows them is one tab among
   * several. The entry that leads to it carries the sign instead: a soft pulse, the attempt being
   * judged, and what the run is doing right now — so "the app is working on my task" is readable
   * from anywhere in the workspace.
   */
  const session = useSessionProgress();
  const sessionPhaseLabel =
    session.phase === 'writing'
      ? t.simple.sessionPhaseWriting
      : session.phase === 'reviewing'
      ? t.simple.sessionPhaseReviewing
      : '';

  /*
   * Escape closes the delete confirmation wherever the focus is.
   *
   * A listener on the dialog itself only fires once something inside it has been focused, and this
   * dialog is opened by a click — so the key would have done nothing for exactly the people who
   * need it.
   */
  useEffect(() => {
    if (!pendingDelete) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPendingDelete(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pendingDelete]);

  /**
   * The workspace list in three groups. Ten entries in one flat column made every section look like
   * the same kind of place: the two screens that start a project, the four that move one task through
   * the AI and the four that describe the project itself all sat in a single undifferentiated list,
   * and working out which was which was left to the reader.
   */
  const tabs = [
    { id: 'simple_flow', label: t.simple.navLabel, icon: Wand2, group: 'start' as const },
    { id: 'dashboard', label: t.tabs.dashboard, icon: Layers, group: 'start' as const },
    { id: 'prompt_compiler', label: t.tabs.compiler, icon: Sparkles, group: 'loop' as const },
    { id: 'session_review', label: t.tabs.review, icon: CheckCircle2, group: 'loop' as const },
    { id: 'code_preview', label: t.tabs.preview, icon: Play, group: 'loop' as const },
    {
      id: 'error_coach',
      label: t.tabs.coach,
      icon: Bug,
      group: 'loop' as const,
      badge: currentProject && currentProject.recentErrors?.length > 0 ? (language === 'ru' ? 'Сбой' : 'Alert') : undefined,
      badgeColor: 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
    },
    { id: 'project_plan', label: t.tabs.plan, icon: Code2, group: 'project' as const },
    { id: 'project_map', label: t.tabs.map, icon: Terminal, group: 'project' as const },
    { id: 'project_files', label: language === 'ru' ? 'Файлы проекта' : 'Project Files', icon: HardDrive, group: 'project' as const },
    { id: 'brief_architecture', label: t.tabs.brief, icon: BookOpen, group: 'project' as const }
  ];

  /** The order the groups are drawn in, and the name over each of them. */
  const groupOrder = ['start', 'loop', 'project'] as const;
  const groupLabels: Record<(typeof groupOrder)[number], string> = {
    start: t.common.groupStart,
    loop: t.common.groupLoop,
    project: t.common.groupProject
  };

  /**
   * The workspace opens folded for every project: the step-by-step screen and the screen the user
   * is on right now. Everything else is one click away under "Show all sections" and never in the
   * way — pressing that entry again folds the list back. Without a project there is nothing to
   * fold, so the full list stays open.
   */
  const isCollapsed = !showAllPanels && !!currentProject;
  const visibleTabs = isCollapsed
    ? tabs.filter((tab) => tab.id === 'simple_flow' || tab.id === activeTab)
    : tabs;

  const content = (
    // The app's name and build live in the window's title bar (TitleBar), so the sidebar opens
    // straight into the work: one name at the top of the window, not the same name twice.
    <div className="flex flex-col h-full gap-4 pt-1">
      {/* Projects Section */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between px-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          <span className="flex items-center gap-1.5">
            <FolderOpen className="w-3.5 h-3.5 text-indigo-400" />
            {t.common.projectsCount} ({allProjects.length})
          </span>
          <button
            onClick={onOpenNewProjectModal}
            className="p-1 rounded text-slate-400 hover:text-indigo-300 hover:bg-slate-800 transition-all cursor-pointer"
            title={t.common.createProject}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {allProjects.length > 0 ? (
          <div className="space-y-0.5 max-h-40 overflow-y-auto pr-1">
            {allProjects.map((proj) => {
              const isSelected = currentProject?.id === proj.id;
              return (
                <div
                  key={proj.id}
                  className={`group flex items-center rounded-lg transition-all ${
                    isSelected
                      ? 'bg-indigo-950/60 border-l-2 border-indigo-500'
                      : 'hover:bg-slate-800/50'
                  }`}
                >
                  <button
                    data-project-row={proj.id}
                    onClick={() => {
                      onSelectProject(proj);
                      if (onCloseMobile) onCloseMobile();
                    }}
                    className={`flex-1 min-w-0 text-left px-2.5 py-1.5 text-xs flex items-center justify-between gap-1 cursor-pointer ${
                      isSelected ? 'text-indigo-200 font-semibold' : 'text-slate-400 hover:text-slate-200 font-normal'
                    }`}
                    title={proj.name}
                  >
                    <span className="truncate">{proj.name}</span>
                    <span className="text-[9px] text-slate-400 group-hover:text-slate-400 uppercase tracking-wider shrink-0">
                      {proj.projectType}
                    </span>
                  </button>
                  {/* Deleting a project was impossible to find before; it stays visible, but the
                      confirmation below is what actually removes anything. */}
                  <button
                    data-project-delete={proj.id}
                    type="button"
                    onClick={() => setPendingDelete(proj)}
                    className="p-1 mr-1 rounded text-slate-400 opacity-70 hover:opacity-100 hover:text-rose-300 hover:bg-rose-500/10 transition-all cursor-pointer shrink-0"
                    aria-label={`${t.common.delete}: ${proj.name}`}
                    title={t.drawer.deleteHint}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <button
            onClick={onOpenNewProjectModal}
            className="w-full text-left px-2.5 py-2 rounded-lg text-xs text-slate-400 hover:text-slate-300 border border-dashed border-slate-800 hover:border-slate-700 transition-all flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-indigo-400" />
            <span>{t.common.createProject}...</span>
          </button>
        )}
      </div>

      {/* Navigation Section */}
      <div className="space-y-1.5 flex-1 flex flex-col min-h-0 border-t border-slate-800/60 pt-3">
        <div className="px-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            {t.common.workspace}
          </span>
        </div>

        <nav className="space-y-0.5 overflow-y-auto pr-1 flex-1 min-h-0">
          {groupOrder.map((group) => {
            const groupTabs = visibleTabs.filter((tab) => tab.group === group);
            if (groupTabs.length === 0) return null;
            return (
              <div key={group} className="space-y-0.5">
                {/* The header is only worth its line when the whole list is on screen: folded,
                    the two visible entries need no title over them. */}
                {!isCollapsed && (
                  <span className="block px-2.5 pt-2 pb-0.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    {groupLabels[group]}
                  </span>
                )}
                {groupTabs.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => {
                        setActiveTab(tab.id);
                        if (onCloseMobile) onCloseMobile();
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-2 text-xs rounded-lg transition-all cursor-pointer ${
                        isActive
                          ? 'bg-indigo-600/20 text-indigo-200 font-semibold border-l-2 border-indigo-500 pl-2'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 font-normal'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`} />
                        <span className="truncate">{tab.label}</span>
                      </div>
                      {tab.id === 'simple_flow' && session.active && (
                        <span
                          data-session-indicator
                          className="flex items-center gap-1.5 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider shrink-0 bg-emerald-500/20 text-emerald-200 border border-emerald-500/40"
                          title={`${t.simple.sessionRunning} • ${t.simple.attemptLabel} ${session.attempt}${
                            sessionPhaseLabel ? ` • ${sessionPhaseLabel}` : ''
                          }`}
                        >
                          {/* The dot pulses twice over: a steady one that is always there, and a
                              ring fading out of it, which is what reads as "still working". */}
                          <span className="relative flex w-2 h-2 items-center justify-center shrink-0">
                            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                            <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          </span>
                          <span data-session-attempt>{session.attempt}</span>
                        </span>
                      )}
                      {tab.badge && (
                        <span
                          className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider shrink-0 ${
                            isActive
                              ? 'bg-indigo-500/30 text-indigo-200'
                              : tab.badgeColor || 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {tab.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}

          {/* The other screens are one click away, never in the way. */}
          {currentProject && onToggleAllPanels && (
            <button
              onClick={onToggleAllPanels}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-[11px] rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-all cursor-pointer"
            >
              {showAllPanels ? (
                <>
                  <ChevronsUpDown className="w-3.5 h-3.5" />
                  <span>{t.simple.hideExtraPanels}</span>
                </>
              ) : (
                <>
                  <LayoutList className="w-3.5 h-3.5" />
                  <span>{t.simple.showAllPanels}</span>
                </>
              )}
            </button>
          )}
        </nav>
      </div>

      {/*
        Footer: language, API keys, version and which build is on screen.

        Quiet, and without a single box. Four framed pills stacked in a panel that is already a
        column of framed entries read as controls fighting the list above them for attention, and
        the language toggle was the loudest thing on the panel. Now the language is two letters, the
        keys are a label, and the version and the build are small print along the bottom.
      */}
      <div data-testid="sidebar-footer" className="pt-3 border-t border-slate-800/60 space-y-1.5">
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-1 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setLanguage('ru')}
              className={`px-0.5 transition-colors cursor-pointer ${
                language === 'ru' ? 'text-slate-200' : 'text-slate-400 hover:text-slate-400'
              }`}
              title={language === 'ru' ? 'Переключить на русский язык' : 'Switch to Russian'}
            >
              RU
            </button>
            <span className="text-slate-700">/</span>
            <button
              type="button"
              onClick={() => setLanguage('en')}
              className={`px-0.5 transition-colors cursor-pointer ${
                language === 'en' ? 'text-slate-200' : 'text-slate-400 hover:text-slate-400'
              }`}
              title={language === 'ru' ? 'Переключить на английский' : 'Switch to English'}
            >
              EN
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenApiSettings}
            className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            title={language === 'ru' ? 'Настройки API-ключей' : 'API Keys Settings'}
          >
            <KeyRound className="w-3 h-3" />
            <span>{language === 'ru' ? 'Ключи API' : 'API Keys'}</span>
          </button>
        </div>

        {/*
          The update line sits above the version, because it is about that number: a newer build is
          published, it is being fetched, or it is already here and waits for the next start. In a
          browser build there is no bridge and the line never appears.
        */}
        <UpdateNotice />

        {/* The number of saved projects is in the section header above; this row is the version on
            the left and the build the app is running on the right. */}
        <div className="flex items-center justify-between gap-2 px-1 text-[10px] text-slate-400">
          <span className="whitespace-nowrap">{t.common.version}</span>
          <BuildBadge />
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Permanent Sidebar */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 p-4 pb-3 hidden md:flex flex-col h-full min-h-0 shrink-0 z-30">
        {content}
      </aside>

      {/* Mobile Drawer Overlay */}
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm transition-opacity"
            onClick={onCloseMobile}
          />
          <aside className="relative w-72 max-w-[80vw] bg-slate-900 border-r border-slate-800 p-4 pb-3 h-full flex flex-col z-10 shadow-2xl">
            {content}
          </aside>
        </div>
      )}

      {/*
        The delete confirmation lives outside the sidebar itself so it covers the whole window and
        cannot be cut off by the sidebar's own scrolling or by the mobile drawer.
      */}
      {pendingDelete && (
        <div
          data-delete-dialog
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            onClick={() => setPendingDelete(null)}
          />
          <div className="relative w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <span className="p-2 rounded-lg bg-rose-500/10 text-rose-300 shrink-0">
                <Trash2 className="w-5 h-5" />
              </span>
              <div className="min-w-0 space-y-1">
                <h3 id="delete-dialog-title" className="text-sm font-bold text-white">{t.drawer.deleteConfirmTitle}</h3>
                <p className="text-xs text-slate-400">{t.drawer.deleteConfirmNotice}</p>
                <p className="text-xs font-semibold text-rose-300 truncate" title={pendingDelete.name}>
                  {pendingDelete.name}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                data-project-delete-cancel
                type="button"
                onClick={() => setPendingDelete(null)}
                className="text-xs font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-2 rounded-xl transition-colors cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                data-project-delete-confirm
                type="button"
                onClick={() => {
                  onDeleteProject(pendingDelete.id);
                  setPendingDelete(null);
                }}
                className="text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 px-3 py-2 rounded-xl transition-colors shadow-sm cursor-pointer"
              >
                {t.common.delete}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
