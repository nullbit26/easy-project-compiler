import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { Menu } from 'lucide-react';
import { IconButton } from './ui/Button';

interface NavbarProps {
  onToggleMobileSidebar?: () => void;
}

/**
 * The bar that is not there.
 *
 * It used to carry the project's own name in a dropdown, directly above a sidebar that already lists
 * every project with the current one highlighted: the same words twice, an inch apart. Then it kept
 * a single button — the way out of the guided interface — in a full-width strip of its own, so a
 * screen that is already the whole workspace opened under an empty band with one control in it. That
 * band is gone: revealing all sections in the sidebar is the same door (and the sidebar is the place
 * those sections are listed), and the studio draws its own tools in the title bar.
 *
 * What is left is the one thing a narrow window needs and the title bar does not carry: the menu
 * button. On a desktop window this bar draws nothing at all — no strip, no height, no rule.
 */
export const Navbar: React.FC<NavbarProps> = ({ onToggleMobileSidebar }) => {
  const { t } = useLanguage();

  return (
    /*
      A strip of controls, not a landmark: the window's own title bar is the page's one banner, and a
      second <header> here made a screen reader announce two of them, the second one empty.
    */
    <div
      data-testid="app-top-bar"
      className="bg-slate-900/90 backdrop-blur-md text-slate-100 border-b border-slate-800 sticky top-0 z-20 shadow-sm md:hidden"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 min-h-14 py-1">
          <div className="flex min-w-0 items-center gap-3">
            <IconButton
              label={t.navbar.toggleMenu}
              icon={Menu}
              onClick={onToggleMobileSidebar}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
