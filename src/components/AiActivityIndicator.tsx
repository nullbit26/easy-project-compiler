import React, { useEffect, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { AiMosaic } from './ui/AiMosaic';
import { useLanguage } from '../context/LanguageContext';
import { Translations } from '../i18n/translations';
import { AiTaskKind, useAiActivity } from '../services/aiActivity';

/** Which line the indicator shows for each kind of AI work. */
const KIND_LABEL: Record<AiTaskKind, keyof Translations['common']> = {
  idea: 'aiTaskIdea',
  questions: 'aiTaskQuestions',
  project: 'aiTaskProject',
  map: 'aiTaskMap',
  plan: 'aiTaskPlan',
  compile: 'aiTaskCompile',
  review: 'aiTaskReview',
  diagnose: 'aiTaskDiagnose',
  edit: 'aiTaskEdit'
};

/** After this many seconds the wait gets an explanation instead of a silent spinner. */
const HINT_AFTER_SECONDS = 15;
const SLOW_HINT_AFTER_SECONDS = 90;
/** How long the green confirmation stays after the answer arrives. */
const DONE_FLASH_MS = 1800;

/**
 * Shows that the app is busy with an AI request: what it is doing, for how long, and what to
 * expect. A 30-60 second wait with no feedback looks like a freeze, so silence is the bug.
 */
/**
 * `hidden` is for the one screen that shows the request as a terminal of its own: two statuses
 * for one request, one of them counting seconds in the corner, is the same lie told twice.
 */
export const AiActivityIndicator: React.FC<{ hidden?: boolean }> = ({ hidden = false }) => {
  const { t } = useLanguage();
  const { active, kind, startedAt, finishedAt, outcome } = useAiActivity();
  const [now, setNow] = useState(() => Date.now());
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, startedAt]);

  useEffect(() => {
    if (!finishedAt) return;
    setShowDone(true);
    const timer = setTimeout(() => setShowDone(false), DONE_FLASH_MS);
    return () => clearTimeout(timer);
  }, [finishedAt]);

  if (hidden) return null;
  if (!active && !showDone) return null;

  const failed = !active && outcome === 'error';
  const elapsedSeconds = active && startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
  const label = active
    ? t.common[kind ? KIND_LABEL[kind] : 'aiWorkingTitle']
    : failed
      ? t.common.aiWorkingFailed
      : t.common.aiWorkingDone;
  const hint =
    elapsedSeconds >= SLOW_HINT_AFTER_SECONDS
      ? t.common.aiWorkingSlowHint
      : elapsedSeconds >= HINT_AFTER_SECONDS
        ? t.common.aiWorkingHint
        : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-40 w-80 max-w-[calc(100vw-2rem)]"
    >
      <div
        className={`rounded-2xl border bg-slate-900/95 p-3.5 shadow-2xl backdrop-blur-md ${
          active ? 'border-indigo-500/60' : failed ? 'border-rose-500/60' : 'border-emerald-500/60'
        }`}
      >
        <div className="flex items-center gap-3">
          {/*
            While the model works the mark stands on its own — no tile, no ring, no frame around it.
            A boxed mark reads as a button, and a square inside a square is exactly the kind of
            furniture the mark is supposed to replace. The fixed 32 × 32 slot keeps the card from
            jumping when a verdict replaces it with an icon.
          */}
          <div
            className={`shrink-0 ${
              active
                ? 'grid h-8 w-8 place-items-center'
                : `rounded-lg border p-2 ${
                    failed
                      ? 'border-rose-800 bg-rose-950 text-rose-400'
                      : 'border-emerald-800 bg-emerald-950 text-emerald-400'
                  }`
            }`}
          >
            {active ? (
              <AiMosaic />
            ) : failed ? (
              <XCircle className="h-4 w-4" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold leading-snug text-slate-100">{label}</p>
            {active && (
              <p className="mt-0.5 text-[11px] text-slate-400">
                {elapsedSeconds} {t.common.aiSecondsShort}
              </p>
            )}
          </div>
        </div>

        {active && (
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-indigo-500" />
          </div>
        )}

        {active && hint && <p className="mt-2 text-[11px] leading-snug text-slate-400">{hint}</p>}
      </div>
    </div>
  );
};
