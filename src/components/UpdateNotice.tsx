import React, { useEffect, useState } from 'react';
import { ArrowDownToLine, RefreshCw, RotateCw, TriangleAlert } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { UpdateState } from '../utils/updateRules';
import { IconButton } from './ui/Button';

/**
 * The one place the app talks about updating itself.
 *
 * It is deliberately not a dialog: an update is good news that can wait. A row in the sidebar
 * appears when a release is published, offers an action, and — if nobody presses it — the download
 * happens in the background anyway (see electron/updates.ts). When it is done, the row says the
 * build is ready and offers to restart right now for people who want it over with.
 *
 * The row is one line: the version, at most one icon button, and a hairline of light running around
 * the row's own edge. It used to be a framed card with a heading, two lines of explanation and a
 * full-width filled button, which made a background download the loudest thing in the sidebar — and
 * repeated in words what the controls already said. Colour marks the state; the words name the
 * number and the action.
 *
 * The light on the edge is the status: no glyph takes horizontal room from the version, and the
 * thing that says "working" is the border of the thing being described (see `epc-runner` in
 * index.css). It is decoration only, with the state said in words beside it, so the ring is drawn
 * by a pseudo-element and is never read out.
 *
 * Outside the desktop shell there is no bridge and this renders nothing: a browser build has no
 * .exe to replace.
 */

export interface UpdateBridge {
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

/** The shape every state shares: one quiet line, a hairline, one status colour. */
const ROW = 'flex items-center gap-2 rounded-lg px-2 py-1 ring-1 ring-inset';

/** The colour each state's running light takes; the row keeps its own tint behind it. */
const RUNNER_INK = {
  indigo: 'rgb(129 140 248 / 0.95)',
  sky: 'rgb(56 189 248 / 0.95)',
  emerald: 'rgb(52 211 153 / 0.95)'
} as const;

const runner = (tone: keyof typeof RUNNER_INK) =>
  ({
    '--epc-runner-ink': RUNNER_INK[tone]
  }) as React.CSSProperties;

/**
 * `bridge` is the shell, injected for the preview page and the tests; a normal run reads it from
 * the preload (`window.desktopUpdates`). There is no other way into the updater.
 */
export const UpdateNotice: React.FC<{ bridge?: UpdateBridge }> = ({ bridge: injected }) => {
  const { t } = useLanguage();
  const u = t.update;
  const [state, setState] = useState<UpdateState | null>(null);
  const [busy, setBusy] = useState(false);
  const bridge = injected ?? (typeof window === 'undefined' ? undefined : window.desktopUpdates);

  useEffect(() => {
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
  }, [bridge]);

  if (!bridge || !state) return null;
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

  const versionLine = (value: string, words: string, ink: string) => (
    <p className="min-w-0 flex-1 truncate text-[11px] tabular-nums text-slate-400">
      <span className={`font-semibold ${ink}`}>{value}</span> {words}
    </p>
  );

  if (status === 'available') {
    return (
      <div
        data-update-notice="available"
        data-update-runner="indigo"
        style={runner('indigo')}
        className={`${ROW} epc-runner bg-gradient-to-r from-indigo-500/[0.10] via-indigo-500/[0.03] to-transparent ring-indigo-400/25`}
      >
        {versionLine(version ?? '', u.available, 'text-indigo-100')}
        <IconButton
          label={u.download}
          icon={ArrowDownToLine}
          size="xs"
          variant="ghost"
          className="-mr-1 text-indigo-300 enabled:hover:text-indigo-100"
          disabled={busy}
          onClick={() => run(() => bridge.download())}
        />
      </div>
    );
  }

  if (status === 'downloading') {
    const value = Math.max(0, Math.min(100, percent ?? 0));
    return (
      <div
        data-update-notice="downloading"
        data-update-runner="sky"
        style={runner('sky')}
        className="epc-runner rounded-lg bg-gradient-to-r from-sky-500/[0.09] via-sky-500/[0.03] to-transparent px-2 pb-1.5 pt-1 ring-1 ring-inset ring-slate-700/70"
      >
        <div className="flex items-center gap-2">
          {versionLine(version ?? '', u.downloading, 'text-slate-200')}
          <span className="shrink-0 text-[10px] tabular-nums text-slate-400">{value}%</span>
        </div>
        <div
          role="progressbar"
          aria-label={`${u.downloading} ${version ?? ''}`.trim()}
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-slate-700/70"
        >
          <div
            className="relative h-full overflow-hidden rounded-full bg-sky-400 transition-[width] duration-300"
            style={{ width: `${value}%` }}
          >
            <span className="epc-bar-sheen absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-white/40 to-transparent" />
          </div>
        </div>
      </div>
    );
  }

  if (status === 'ready') {
    return (
      <div
        data-update-notice="ready"
        data-update-runner="emerald"
        style={runner('emerald')}
        className={`${ROW} epc-runner bg-gradient-to-r from-emerald-500/[0.11] via-emerald-500/[0.04] to-transparent ring-emerald-400/25`}
      >
        {versionLine(version ?? '', u.ready, 'text-emerald-100')}
        <IconButton
          label={u.restart}
          icon={RotateCw}
          size="xs"
          variant="ghost"
          className="-mr-1 text-emerald-300 enabled:hover:text-emerald-100"
          disabled={busy}
          onClick={() => run(() => bridge.install())}
        />
      </div>
    );
  }

  /* error */
  return (
    <div
      data-update-notice="error"
      className="flex items-center gap-1.5 rounded-lg bg-amber-400/[0.06] px-2 py-1 ring-1 ring-inset ring-amber-400/25"
    >
      <TriangleAlert className="h-3 w-3 shrink-0 text-amber-300" />
      <p className="line-clamp-2 min-w-0 flex-1 text-[10px] leading-4 text-amber-200/90">
        {error || u.failed}
      </p>
      <IconButton
        label={u.retry}
        icon={RefreshCw}
        size="xs"
        variant="ghost"
        className="-mr-1 text-amber-300 enabled:hover:text-amber-100"
        disabled={busy}
        onClick={() => run(() => bridge.check())}
      />
    </div>
  );
};

export default UpdateNotice;
