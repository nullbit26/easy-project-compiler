import React, { useEffect, useState } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
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
 * The window's title bar, drawn by the app instead of by Windows.
 *
 * The desktop window has no system frame (see electron/main.ts), so the top of the window is the
 * same dark surface as everything under it — which is also why this bar has to carry the app's mark,
 * its name, and the minimise/maximise/close buttons itself. The build the app is running is shown
 * once, in the sidebar footer, and not repeated up here. In a plain browser build the bridge is
 * missing and only the mark and the name are shown.
 *
 * The mark is the launch screen's asset, not a second drawing of it: the picture the app opens with
 * is the picture that stays in the corner. It sits on nothing — the file's own transparent
 * background is the only backing it has — and it is never a drag handle for itself (`draggable`),
 * or pulling the window by the mark would start an image drag instead of moving the window. Its two
 * animations live in index.css and are ambient rather than an entrance: the bar is already mounted
 * behind the launch screen, so an entrance would have played out where nobody could see it.
 */
export const TitleBar: React.FC = () => {
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
      className="h-9 shrink-0 flex items-stretch justify-between bg-slate-950 border-b border-slate-800/80 select-none"
    >
      <div className="flex items-center gap-2 pl-3 min-w-0">
        {/* The app's mark, breathing, with a glint that crosses it every few seconds. */}
        <span data-testid="app-mark" className="title-mark shrink-0">
          <img src={logo} alt="" draggable={false} className="title-mark-img" />
          <span
            aria-hidden="true"
            className="title-mark-sheen"
            style={{ WebkitMaskImage: `url(${logo})`, maskImage: `url(${logo})` }}
          />
        </span>
        <span className="text-[11px] font-semibold text-slate-300 truncate">Easy Project Compiler</span>
      </div>

      <div className="flex items-stretch" style={NO_DRAG}>
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
