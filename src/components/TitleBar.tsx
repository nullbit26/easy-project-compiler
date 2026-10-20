import React, { useEffect, useState } from 'react';
import { Copy, Minus, Plus, Square, X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { IconButton } from './ui/Button';
import { serverUnreachableMessage } from '../utils/serverUnreachable';
import logo from '../assets/epc-logo.webp';

/** The bridge electron/preload.ts puts on the page; absent when the page runs in a browser. */
interface DesktopWindowBridge {
  /** True when the shell started this window to check itself (`--self-test`). */
  selfTest?: boolean;
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (listener: (maximized: boolean) => void) => () => void;
}

declare global {
  interface Window {
    desktopWindow?: DesktopWindowBridge;
  }
}

const DRAG = { WebkitAppRegion: 'drag' } as React.CSSProperties;
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

/**
 * The strip above the workspace, drawn by the app instead of by Windows.
 *
 * It begins where the sidebar ends: the name and the mark live at the top of that full-height
 * column, so this bar is only the window's controls and the one action that belongs to no screen.
 * Its hairline therefore starts at the column's edge instead of running across the whole window and
 * leaving the sidebar as a block that begins underneath a header.
 *
 * The desktop window has no system frame (see electron/main.ts), so this bar carries the
 * minimise/maximise/close buttons itself. The build the app is running is shown once, in the sidebar
 * footer, and not repeated up here. In a plain browser build the bridge is missing and the bar is
 * empty on the right; with no screen to add beside, it draws nothing at all.
 *
 * The bar also carries the one screen action that is not a screen's own: the plus that opens another
 * column beside the current one. It used to float in the top-right corner of the screen, where it sat
 * on the content's scrollbar and had to be nudged for every screen that drew a full-bleed box. Here
 * it costs no height (the bar is already there), it is outside every scrolling area, and the window
 * controls keep a hairline of their own so the app's button is not read as another window control.
 *
 * The left end of the bar is an empty slot for the active screen's own tools: the studio's window
 * controls (add a window, the arrangements, reset) are mounted there instead of in a second strip
 * below the bar. Two rows of buttons above the content — the studio's own toolbar and then a pane's
 * header — is one row of chrome too many, and it made the top of the window the heaviest part of it.
 * The studio owns those controls and their state; this bar only hands over the place to put them.
 */

/** The id the studio looks for when it mounts its tools into this bar. */
export const TITLE_TOOLS_ID = 'epc-title-tools';

interface TitleBarProps {
  /** Opens one more screen column beside the current one. Absent when the screen cannot host one. */
  onOpenScreenBeside?: () => void;
  /** At the pane ceiling: the plus stays in place, visibly spent, instead of disappearing. */
  openScreenBesideDisabled?: boolean;
  /** The page was opened without the app's server: nothing that reads the folder or builds can work. */
  serverMissing?: boolean;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  onOpenScreenBeside,
  openScreenBesideDisabled = false,
  serverMissing = false
}) => {
  const { language } = useLanguage();
  const ru = language === 'ru';
  const bridge = typeof window === 'undefined' ? undefined : window.desktopWindow;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!bridge) return undefined;
    let cancelled = false;
    bridge
      .isMaximized()
      .then((value) => {
        if (!cancelled) setMaximized(value);
      })
      .catch(() => {
        // The button still works; only the icon would be out of date.
      });
    const stop = bridge.onMaximizedChange(setMaximized);
    return () => {
      cancelled = true;
      stop();
    };
  }, [bridge]);

  const buttonClass =
    'w-11 flex items-center justify-center text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer';

  return (
    <header
      data-testid="app-title-bar"
      style={DRAG}
      className="h-9 shrink-0 flex items-stretch justify-end bg-slate-950 border-b border-slate-800/80 select-none"
    >
      {/*
        Narrow windows fold the sidebar into a drawer, which is also where the name and mark live.
        Below that breakpoint they move up here, so the window never loses its name; side by side
        with the column they are hidden, and the name is not printed twice.
      */}
      <div className="mr-auto flex items-center gap-2 pl-3 min-w-0 md:hidden">
        <span className="title-mark shrink-0">
          <img src={logo} alt="" draggable={false} className="title-mark-img" />
        </span>
        <span className="text-[11px] font-semibold text-slate-300 truncate">Easy Project Compiler</span>
      </div>

      {/*
        The server is the half that reads folders, runs checks and builds previews. Without it the
        screens can only fail one by one, each with the same sentence; the bar says it once, in the
        window itself, before the first failed request. A dot and three words: the full sentence is
        the tooltip, because a lost server is not a paragraph to read on every screen.
      */}
      {serverMissing && (
        <span
          data-testid="server-status"
          title={serverUnreachableMessage(language)}
          style={NO_DRAG}
          className="mr-2 flex min-w-0 items-center gap-1.5 pl-3 text-[11px] text-rose-300"
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" aria-hidden="true" />
          <span className="truncate">
            {ru ? 'Сервер приложения не отвечает' : 'The app server is not answering'}
          </span>
        </span>
      )}

      {/* The active screen's own tools land here (see TITLE_TOOLS_ID); empty on every other screen. */}
      <div
        id={TITLE_TOOLS_ID}
        data-testid="title-bar-tools"
        style={NO_DRAG}
        className="flex min-w-0 items-center gap-1 pl-3 empty:hidden"
      />

      <div className="ml-auto flex items-stretch" style={NO_DRAG}>
        {onOpenScreenBeside && (
          /*
            A clear gap, no hairline: the plus is the app's action, and next to a 44 px minimise it
            read as a fourth window control. Twenty pixels of the bar, owned by neither group, are
            enough to say "not with those three".
          */
          <div className="flex items-center pl-1 pr-5">
            {/* The studio's plus, size for size: `sm`, one 16 px glyph. */}
            <IconButton
              data-testid="title-bar-open-pane"
              label={ru ? 'Открыть экран рядом' : 'Open a screen beside'}
              icon={Plus}
              size="sm"
              onClick={onOpenScreenBeside}
              disabled={openScreenBesideDisabled}
              className="text-slate-400"
            />
          </div>
        )}

        {bridge && (
          <>
            <button
              type="button"
              data-window-control="minimize"
              onClick={() => bridge.minimize()}
              aria-label={ru ? 'Свернуть' : 'Minimise'}
              title={ru ? 'Свернуть' : 'Minimise'}
              className={buttonClass}
            >
              <Minus className="w-4 h-4" />
            </button>
            <button
              type="button"
              data-window-control="maximize"
              onClick={() => bridge.toggleMaximize()}
              aria-label={ru ? (maximized ? 'Восстановить' : 'Развернуть') : maximized ? 'Restore' : 'Maximise'}
              title={ru ? (maximized ? 'Восстановить' : 'Развернуть') : maximized ? 'Restore' : 'Maximise'}
              className={buttonClass}
            >
              {maximized ? <Copy className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              data-window-control="close"
              onClick={() => bridge.close()}
              aria-label={ru ? 'Закрыть' : 'Close'}
              title={ru ? 'Закрыть' : 'Close'}
              className="w-11 flex items-center justify-center text-slate-400 hover:text-white hover:bg-rose-600 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </header>
  );
};

export default TitleBar;
