import React, { useEffect, useState } from 'react';
import { Download, RefreshCw, RotateCw, TriangleAlert } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { UpdateState } from '../utils/updateRules';

/**
 * The one place the app talks about updating itself.
 *
 * It is deliberately not a dialog: an update is good news that can wait. A line in the sidebar
 * appears when a release is published, offers a button, and — if nobody presses it — the download
 * happens in the background anyway (see electron/updates.ts). When it is done, the line says the
 * build will be in place at the next start, and offers to restart right now for people who want it
 * over with.
 *
 * Outside the desktop shell there is no bridge and this renders nothing: a browser build has no
 * .exe to replace.
 */

interface UpdateBridge {
  state: () => Promise<UpdateState>;
  check: () => Promise<UpdateState>;
  download: () => Promise<UpdateState>;
  install: () => Promise<unknown>;
  onStateChange: (listener: (state: UpdateState) => void) => () => void;
}

declare global {
  interface Window {
    desktopUpdates?: UpdateBridge;
  }
}

export const UpdateNotice: React.FC = () => {
  const { t } = useLanguage();
  const u = t.update;
  const [state, setState] = useState<UpdateState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const bridge = typeof window === 'undefined' ? undefined : window.desktopUpdates;
    if (!bridge) return undefined;
    let cancelled = false;

    bridge
      .state()
      .then((initial) => {
        if (!cancelled) setState(initial);
      })
      .catch(() => {
        /* the notice is a convenience; a shell that cannot answer simply shows nothing */
      });

    const stop = bridge.onStateChange((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  if (!window.desktopUpdates || !state) return null;
  const { status, version, percent, error } = state;
  if (status === 'idle' || status === 'checking' || status === 'current' || status === 'unconfigured') {
    return null;
  }

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch {
      /* the shell reports its own failure through the next state */
    } finally {
      setBusy(false);
    }
  };

  if (status === 'available') {
    return (
      <div data-update-notice="available" className="rounded-xl border border-indigo-500/40 bg-indigo-500/10 p-2.5 space-y-1.5">
        <p className="text-[11px] font-bold text-indigo-200">
          {u.available} {version}
        </p>
        <p className="text-[10px] leading-snug text-slate-400">{u.willDownload}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => window.desktopUpdates!.download())}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 enabled:hover:bg-indigo-500 disabled:opacity-50 px-2 py-1.5 text-[11px] font-bold text-white transition-colors enabled:cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          {u.download}
        </button>
      </div>
    );
  }

  if (status === 'downloading') {
    const value = Math.max(0, Math.min(100, percent ?? 0));
    return (
      <div data-update-notice="downloading" className="rounded-xl border border-slate-700 bg-slate-800/60 p-2.5 space-y-2">
        <p className="text-[11px] font-semibold text-slate-200">
          {u.downloading} {version} — {value}%
        </p>
        <div className="h-1 rounded-full bg-slate-700 overflow-hidden" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-indigo-500 transition-all" style={{ width: `${value}%` }} />
        </div>
      </div>
    );
  }

  if (status === 'ready') {
    return (
      <div data-update-notice="ready" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-2.5 space-y-1.5">
        <p className="text-[11px] font-bold text-emerald-200">
          {u.ready} {version}
        </p>
        <p className="text-[10px] leading-snug text-slate-400">{u.readyHint}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => window.desktopUpdates!.install())}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 enabled:hover:bg-emerald-500 disabled:opacity-50 px-2 py-1.5 text-[11px] font-bold text-white transition-colors enabled:cursor-pointer"
        >
          <RotateCw className="w-3.5 h-3.5" />
          {u.restart}
        </button>
      </div>
    );
  }

  /* error */
  return (
    <div data-update-notice="error" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 space-y-1.5">
      <p className="flex items-start gap-1.5 text-[10px] leading-snug text-amber-200">
        <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
        <span>{error || u.failed}</span>
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => run(() => window.desktopUpdates!.check())}
        className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-500/40 enabled:hover:bg-amber-500/10 disabled:opacity-50 px-2 py-1 text-[10px] font-bold text-amber-100 transition-colors enabled:cursor-pointer"
      >
        <RefreshCw className="w-3 h-3" />
        {u.retry}
      </button>
    </div>
  );
};

export default UpdateNotice;
