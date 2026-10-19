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
  PanelsTopLeft,
  Trash2,
  ChevronsUpDown,
  ChevronsLeft,
  ChevronsRight
} from 'lucide-react';
import { Button, IconButton } from './ui/Button';
import logo from '../assets/epc-logo.webp';

/** The window is frameless, so the sidebar's own top row is a drag handle like the title bar. */
const DRAG = { WebkitAppRegion: 'drag' } as React.CSSProperties;

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
  /** The whole panel is folded into a strip of icons, so the work gets the width. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

/** One or two letters of a project's name, for the folded panel where there is no room for it. */
function projectInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
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
  onToggleAllPanels,
  collapsed = false,
  onToggleCollapsed
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
    {
      id: 'studio',
      label: language === 'ru' ? 'Студия' : 'Studio',
      icon: PanelsTopLeft,
      group: 'project' as const
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

  /*
   * Folding the panel is a different thing from folding the list of screens: the list hides entries
   * it does not need, while this hides the words. Both keep the way in reach — the strip still has
   * every screen, every project and the way back — because a panel that can be collapsed into
   * nothing is a panel the user has to go looking for.
   */
  const collapseLabel = language === 'ru' ? 'Свернуть панель' : 'Collapse the sidebar';
  const expandLabel = language === 'ru' ? 'Развернуть панель' : 'Expand the sidebar';

  /*
   * The app's name and mark open the sidebar, not the window's control strip.
   *
   * The column is the one thing that runs from the top pixel of the window to the bottom; giving it
   * the name is what makes it a monolith instead of a panel that starts under a header. The strip on
   * the right is then purely the window's controls, and its hairline begins exactly where this
   * column ends.
   */
  const brand = (compact: boolean) => (
    <div
      data-testid="app-brand"
      style={DRAG}
      className={`flex h-9 shrink-0 select-none items-center ${
        compact ? 'w-full justify-center' : 'gap-2 px-4'
      }`}
    >
      <span data-testid="app-mark" className="title-mark shrink-0">
        <img src={logo} alt="" draggable={false} className="title-mark-img" />
        <span
          aria-hidden="true"
          className="title-mark-sheen"
          style={{ WebkitMaskImage: `url(${logo})`, maskImage: `url(${logo})` }}
        />
      </span>
      {!compact && <span className="text-[11px] font-semibold text-slate-300 truncate">Easy Project Compiler</span>}
    </div>
  );

  const renderContent = (withCollapseControl: boolean) => (
    <div className="flex flex-col h-full min-h-0">
    {brand(false)}
    {/* No rules run across this column: the groups are separated by space, so the sidebar reads as
        one surface from the first pixel to the last. */}
    <div className="flex flex-1 min-h-0 flex-col gap-4 px-4 pb-3 pt-2">
      {/* Projects Section */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between px-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          <span className="flex items-center gap-1.5">
            <FolderOpen className="w-3.5 h-3.5 text-indigo-400" />
            {t.common.projectsCount} ({allProjects.length})
          </span>
          <div className="flex items-center gap-0.5">
            <IconButton
              label={t.common.createProject}
              icon={Plus}
              size="xs"
              onClick={onOpenNewProjectModal}
            />
            {withCollapseControl && onToggleCollapsed && (
              <IconButton
                label={collapseLabel}
                icon={ChevronsLeft}
                size="xs"
                aria-expanded={!collapsed}
                data-sidebar-toggle
                onClick={onToggleCollapsed}
              />
            )}
          </div>
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
                  <IconButton
                    label={`${t.common.delete}: ${proj.name}`}
                    title={t.drawer.deleteHint}
                    icon={Trash2}
                    size="xs"
                    data-project-delete={proj.id}
                    className="mr-1 shrink-0"
                    onClick={() => setPendingDelete(proj)}
                  />
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
      <div className="space-y-1.5 flex-1 flex flex-col min-h-0 pt-1">
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
      <div data-testid="sidebar-footer" className="pt-2 space-y-1.5">
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
    </div>
  );

  /*
   * Folded, the panel is a strip of icons: each keeps its accessible name and its tooltip, so the
   * entry is still a named control and not a picture. The project rows become their initials and the
   * screens their symbols; nothing else is left, because nothing else is needed to keep working.
   */
  const rail = (
    <div data-sidebar-rail className="flex h-full min-h-0 flex-col items-center gap-1">
      {brand(true)}
      {onToggleCollapsed && (
        <IconButton
          label={expandLabel}
          icon={ChevronsRight}
          aria-expanded={!collapsed}
          data-sidebar-toggle
          onClick={onToggleCollapsed}
        />
      )}
      <IconButton label={t.common.createProject} icon={Plus} onClick={onOpenNewProjectModal} />

      {allProjects.length > 0 && (
        <div className="mt-1 flex max-h-40 w-full flex-col items-center gap-1 overflow-y-auto pt-1">
          {allProjects.map((proj) => {
            const isSelected = currentProject?.id === proj.id;
            return (
              <button
                key={proj.id}
                type="button"
                onClick={() => onSelectProject(proj)}
                title={proj.name}
                aria-label={proj.name}
                aria-current={isSelected ? 'true' : undefined}
                data-project-row={proj.id}
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-semibold tracking-wide transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-indigo-600/25 text-indigo-100 ring-1 ring-inset ring-indigo-400/50'
                    : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {projectInitials(proj.name)}
              </button>
            );
          })}
        </div>
      )}

      <nav className="mt-1 flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto pt-1">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              title={tab.label}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors cursor-pointer ${
                isActive
                  ? 'bg-indigo-600/20 text-indigo-300 ring-1 ring-inset ring-indigo-500/40'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.id === 'simple_flow' && session.active && (
                <>
                  {/* The dot is colour alone; the words say the same thing to a screen reader. */}
                  <span
                    className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-400"
                    title={`${t.simple.sessionRunning} • ${t.simple.attemptLabel} ${session.attempt}`}
                  />
                  <span className="sr-only">{t.simple.sessionRunning}</span>
                </>
              )}
              {tab.badge && (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-rose-400" />
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex w-full flex-col items-center gap-1 pt-2">
        {currentProject && onToggleAllPanels && (
          <IconButton
            label={showAllPanels ? t.simple.hideExtraPanels : t.simple.showAllPanels}
            icon={showAllPanels ? ChevronsUpDown : LayoutList}
            onClick={onToggleAllPanels}
          />
        )}
        <IconButton
          label={language === 'ru' ? 'Ключи API' : 'API Keys'}
          icon={KeyRound}
          onClick={onOpenApiSettings}
        />
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Permanent Sidebar — folded, it is the width of one icon column. */}
      <aside
        data-sidebar
        className={`${
          collapsed ? 'w-14' : 'w-64'
        } bg-slate-900 border-r border-slate-800 hidden md:flex flex-col h-full min-h-0 shrink-0 z-30`}
      >
        {collapsed ? rail : renderContent(true)}
      </aside>

      {/* Mobile Drawer Overlay */}
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm transition-opacity"
            onClick={onCloseMobile}
          />
          <aside className="relative w-72 max-w-[80vw] bg-slate-900 border-r border-slate-800 h-full flex flex-col z-10">
            {renderContent(false)}
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
              <Button
                variant="secondary"
                size="sm"
                data-project-delete-cancel
                onClick={() => setPendingDelete(null)}
              >
                {t.common.cancel}
              </Button>
              <Button
                variant="danger"
                size="sm"
                data-project-delete-confirm
                onClick={() => {
                  onDeleteProject(pendingDelete.id);
                  setPendingDelete(null);
                }}
              >
                {t.common.delete}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
