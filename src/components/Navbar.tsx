import React from 'react';
import { ProjectState, AgentType, AutonomyLevel, InterfaceMode } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { LayoutList, Menu } from 'lucide-react';
import { Button, IconButton } from './ui/Button';

interface NavbarProps {
  currentProject: ProjectState | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenSavedProjectsDrawer: () => void;
  onToggleMobileSidebar?: () => void;
  /** Beginner mode hides the agent/level pickers — the simple flow chooses sensible defaults. */
  simpleMode?: boolean;
  /** Only used by the guided interface, where the bar is the way into the full workspace. */
  onSelectInterfaceMode?: (mode: InterfaceMode) => void;
  /** Kept in the context API: the wizard, not the top bar, is where these are chosen. */
  onSelectAgent?: (agent: AgentType) => void;
  onSelectAutonomy?: (level: AutonomyLevel) => void;
}

/**
 * The top bar, which is now almost nothing — on purpose.
 *
 * It used to carry the project's own name in a dropdown, directly above a sidebar that already lists
 * every project with the current one highlighted: the same words twice, an inch apart, and the copy
 * at the top was the one that could not be read at a glance (it truncated longest of all). Choosing a
 * project is the sidebar's job, and "create a project" is in the sidebar header and on the dashboard.
 *
 * What is left is the one thing the sidebar cannot offer: the way out of the guided interface, and
 * the menu button a narrow window needs. When there is neither, the bar draws nothing at all rather
 * than an empty strip of its own height.
 */
export const Navbar: React.FC<NavbarProps> = ({
  currentProject,
  onToggleMobileSidebar,
  simpleMode = false,
  onSelectInterfaceMode
}) => {
  const { t } = useLanguage();
  const hasWideControls = Boolean(currentProject && simpleMode && onSelectInterfaceMode);

  return (
    /*
      A strip of controls, not a landmark: the window's own title bar is the page's one banner, and a
      second <header> here made a screen reader announce two of them, the second one empty.
    */
    <div
      data-testid="app-top-bar"
      className={`bg-slate-900/90 backdrop-blur-md text-slate-100 border-b border-slate-800 sticky top-0 z-20 shadow-sm ${
        hasWideControls ? '' : 'md:hidden'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 min-h-14 py-1">
          {/* Mobile menu toggle & Active Project Selector */}
          <div className="flex items-center gap-3 min-w-0">
            <IconButton
              label={t.navbar.toggleMenu}
              icon={Menu}
              className="md:hidden"
              onClick={onToggleMobileSidebar}
            />

          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-2 sm:gap-2.5 ml-auto shrink-0">
            {/*
              The door back out of the helper. In the guided interface this bar deliberately shows no
              pickers at all, which used to leave the user with no way to reach the full workspace:
              revealing the sections in the sidebar shows the screens but keeps the interface guided.
            */}
            {currentProject && simpleMode && onSelectInterfaceMode && (
              <Button
                variant="accent"
                size="xs"
                icon={LayoutList}
                title={t.mode.interfaceFullHint}
                onClick={() => onSelectInterfaceMode('full')}
              >
                {t.mode.interfaceFull}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
