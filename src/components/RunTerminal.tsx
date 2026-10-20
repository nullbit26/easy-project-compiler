import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Square } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useRunStream } from '../services/runStream';
import { partialPromptText } from '../utils/compileTrace';
import { buttonClass } from './ui/Button';
import { AiMosaic } from './ui/AiMosaic';

/**
 * The helper's live terminal.
 *
 * The step-by-step screen replaces its form with this panel the moment a request is sent, and the
 * request writes its own lines here as they happen (see `services/runStream.ts`). It is a reading,
 * not a dashboard: the facts of the request sit in one labelled column, the events of the run in
 * another, and the only number that moves is the elapsed time beside the status.
 *
 * One colour, used by the app itself, and only where it means something: the dot is rose when the
 * run failed. Everything else is slate at three weights — labels, values, and the timestamps that
 * hold the left edge. Colouring each line by its kind made a short log look like a syntax theme and
 * put four accents on a screen whose only job was to say what happened; the words already say it.
 *
 * Under the log, while the answer is streamed, is the model's own text. Once the compiler reaches
 * `promptText` that text is shown unescaped as the prompt being written (see `utils/compileTrace.ts`);
 * before that — and for a failure — the raw tail of the answer is shown instead. It stays a quote,
 * dimmed and `aria-hidden`, because a screen reader cannot follow a line that changes ten times a
 * second; the steps the answer implies are written into the log as plain lines.
 *
 * The live line is the app's own mark — the five-by-five square of turning cubes — instead of a
 * sentence saying the model has not answered yet. The words the mark replaces are still there for
 * a screen reader (`sr-only`), and the header still names the state in text; the mark is what says
 * "working" to the eye, exactly as it does in the status card elsewhere.
 */

/**
 * Only the tail of the raw answer is drawn. A compiled prompt is tens of kilobytes of JSON, and the
 * screen is interested in what is being written now, not in re-laying out the whole answer.
 */
const TRACE_TAIL = 1000;

function clockOf(at: number): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

interface RunTerminalProps {
  /** What this run is, e.g. «Сборка промпта» — the request's title is stored with the run. */
  title: string;
  /** Said on the waiting line while the model has not answered yet. */
  waiting: string;
  /** Offered after a failure: the same request, asked again. */
  onRetry?: () => void;
  /** Stops the run while it is in flight. The terminal offers it only when the run can be stopped. */
  onCancel?: () => void;
}

export const RunTerminal: React.FC<RunTerminalProps> = ({ title, waiting, onRetry, onCancel }) => {
  const { language } = useLanguage();
  const ru = language === 'ru';
  const run = useRunStream();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const traceRef = useRef<HTMLPreElement | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!run.active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run.active, run.startedAt]);

  useEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [run.lines.length, run.active, now]);

  useEffect(() => {
    const box = traceRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [run.trace]);

  const elapsed = run.active && run.startedAt ? Math.max(0, Math.round((now - run.startedAt) / 1000)) : 0;
  const writing = run.active && run.trace.length > 0;
  const status = run.active
    ? writing
      ? ru
        ? 'пишет'
        : 'writing'
      : ru
      ? 'работает'
      : 'running'
    : run.outcome === 'error'
    ? ru
      ? 'ошибка'
      : 'failed'
    : run.outcome === 'cancelled'
    ? ru
      ? 'отменено'
      : 'cancelled'
    : ru
    ? 'готово'
    : 'done';
  // One moving thing per panel: the mark below says "working", so the dot is only a state colour.
  const dot = run.active ? 'bg-slate-500' : run.outcome === 'error' ? 'bg-rose-400' : 'bg-slate-600';
  /* A failed or stopped run offers the same request again; a finished one has moved on. */
  const stopped = !run.active && (run.outcome === 'error' || run.outcome === 'cancelled');

  /**
   * The prompt being written, or the raw answer when there is nothing readable in it yet. The raw
   * text is tailed, not whole: an answer that fills a screen should still be one line of reading.
   */
  const streamView = useMemo(() => {
    if (!run.trace) return '';
    const prompt = partialPromptText(run.trace);
    if (prompt && prompt.trim()) return prompt;
    return run.trace.length > TRACE_TAIL ? `…${run.trace.slice(-TRACE_TAIL)}` : run.trace;
  }, [run.trace]);

  return (
    <div
      data-run-terminal
      data-run-status={run.active ? 'running' : run.outcome || 'idle'}
      aria-busy={run.active || undefined}
      className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950"
    >
      <div className="flex items-center gap-2.5 border-b border-slate-800/70 px-3.5 py-2.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="truncate text-[12px] font-semibold text-slate-200">{title}</span>
        <span className="ml-auto flex shrink-0 items-baseline gap-2 text-[10px] text-slate-500">
          <span>{status}</span>
          {/* The seconds are a state, not a log line: announced every second they would drown the log. */}
          {run.active && (
            <span aria-hidden className="font-mono tabular-nums text-slate-600">
              {elapsed} {ru ? 'с' : 's'}
            </span>
          )}
        </span>
        {run.active && onCancel && (
          /*
            An icon, named twice: `title` for the mouse, `aria-label` for everything else. The glyph
            is the stop square, not a cross — this ends the request that is running, it does not
            dismiss a message.
          */
          <button
            type="button"
            data-run-cancel
            onClick={onCancel}
            title={ru ? 'Отменить' : 'Cancel'}
            aria-label={ru ? 'Отменить' : 'Cancel'}
            className="ml-1 grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-500 transition-colors hover:bg-slate-800/70 hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400/70"
          >
            <Square className="h-3 w-3" />
          </button>
        )}
      </div>

      <div
        ref={boxRef}
        role="log"
        aria-live="polite"
        aria-label={title}
        className="max-h-60 overflow-y-auto px-3.5 py-2.5 text-[11px] leading-[1.75]"
      >
        {run.lines.map((entry) => (
          <div
            key={entry.id}
            data-run-line
            data-tone={entry.tone}
            className="grid grid-cols-[46px_86px_minmax(0,1fr)] items-baseline gap-x-2"
          >
            <span className="font-mono text-[9.5px] tabular-nums text-slate-600">
              {entry.origin === 'start' ? '' : clockOf(entry.at)}
            </span>
            {entry.label ? (
              <>
                <span className="truncate text-slate-500">
                  {entry.label}:{' '}
                </span>
                <span className="whitespace-pre-wrap break-words text-slate-300">{entry.text}</span>
              </>
            ) : (
              <span className="col-span-2 whitespace-pre-wrap break-words text-slate-400">{entry.text}</span>
            )}
          </div>
        ))}

        {run.active && (
          <div
            data-run-live
            className="grid grid-cols-[46px_86px_minmax(0,1fr)] items-center gap-x-2 pb-1.5 pt-3 text-slate-500"
          >
            <span />
            <span className="col-span-2 flex items-center">
              {/* A 20 × 20 slot reserves the space the mark occupies while its cubes drift. The
                  mark is the whole line: the seconds are already in the header, and a second
                  count beside the cubes only competed with the thing that says "working". */}
              <span className="grid h-5 w-5 shrink-0 place-items-center">
                <AiMosaic />
              </span>
              <span className="sr-only">{writing ? (ru ? 'пишет ответ' : 'writing the answer') : waiting}</span>
            </span>
          </div>
        )}
      </div>

      {streamView && (
        <div data-run-trace aria-hidden className="border-t border-slate-800/70 px-3.5 py-2.5">
          <pre
            ref={traceRef}
            className="max-h-44 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[10.5px] leading-[1.75] text-slate-500"
          >
            {streamView}
            {run.active && <span className="text-slate-300">▍</span>}
          </pre>
        </div>
      )}

      {stopped && onRetry && (
        <div className="flex justify-end border-t border-slate-800/70 px-3.5 py-2">
          <button onClick={onRetry} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{ru ? 'Повторить' : 'Retry'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
