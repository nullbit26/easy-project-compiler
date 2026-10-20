import React, { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Trash2, Terminal } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { autopilotFeed, useAutopilotFeed } from '../../services/autopilotFeed';
import { IconButton } from '../ui/Button';
import { PaneActionsSlot } from './paneActions';

/**
 * The autopilot terminal, as a window of its own.
 *
 * It reads the shared feed rather than a run: whichever window started the robot — a card's
 * context menu, the pipeline button on the plan — the log arrives here as it streams, so the
 * studio can keep the plan and the terminal side by side without the terminal belonging to
 * either of them. Colours carry the meaning (written, verifying, repairing, failed) so a glance
 * at the bottom half of the screen answers "what is it doing now".
 */

const TONE_CLASS: Record<string, string> = {
  info: 'text-slate-300',
  success: 'text-emerald-300',
  error: 'text-rose-300',
  warn: 'text-amber-300',
  muted: 'text-slate-500'
};

const TONE_GLYPH: Record<string, string> = {
  info: '·',
  success: '✓',
  error: '✗',
  warn: '!',
  muted: ' '
};

function clockOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export const TerminalPane: React.FC = () => {
  const { language } = useLanguage();
  const ru = language === 'ru';
  const feed = useAutopilotFeed();
  const boxRef = useRef<HTMLDivElement | null>(null);
  /** Following the tail is the default; scrolling up stops it until the button asks for it again. */
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    if (!follow) return;
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [feed.lines.length, follow]);

  const statusLabel =
    feed.status === 'running'
      ? ru
        ? 'работает'
        : 'running'
      : feed.status === 'completed'
      ? ru
        ? 'готово'
        : 'done'
      : feed.status === 'failed'
      ? ru
        ? 'остановлен'
        : 'stopped'
      : ru
      ? 'ожидает'
      : 'idle';

  const statusDot =
    feed.status === 'running'
      ? 'bg-indigo-400 animate-pulse'
      : feed.status === 'completed'
      ? 'bg-emerald-400'
      : feed.status === 'failed'
      ? 'bg-rose-400'
      : 'bg-slate-600';

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-950">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-800/80 px-2 py-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot}`} />
        <span className="truncate text-[10px] font-medium text-slate-300">
          {feed.title || (ru ? 'Автопилот' : 'Autopilot')}
        </span>
        <span className="shrink-0 text-[10px] text-slate-400">
          {statusLabel}
          {feed.status === 'running' && feed.total > 0 ? ` · ${feed.done}/${feed.total}` : ''}
          {feed.status === 'running'
            ? ` · ${ru ? 'попытка' : 'attempt'} ${Math.max(1, feed.attempt)}/${feed.maxAttempts}`
            : ''}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton
            label={ru ? 'Следовать за логом' : 'Follow the log'}
            icon={ArrowDownToLine}
            size="xs"
            pressed={follow}
            onClick={() => {
              setFollow(true);
              const box = boxRef.current;
              if (box) box.scrollTop = box.scrollHeight;
            }}
          />
          <IconButton
            label={ru ? 'Очистить лог' : 'Clear the log'}
            icon={Trash2}
            size="xs"
            onClick={() => {
              setFollow(true);
              // A clear only empties the log; the run itself keeps going where it was started.
              autopilotFeed.clear();
            }}
          />
          <PaneActionsSlot />
        </div>
      </div>

      <div
        ref={boxRef}
        data-testid="studio-terminal-log"
        onScroll={(event) => {
          const box = event.currentTarget;
          const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
          setFollow(atBottom);
        }}
        className="min-h-0 flex-1 overflow-y-auto bg-slate-950/80 px-2.5 py-2 font-mono text-[10.5px] leading-relaxed"
      >
        {feed.lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Terminal className="h-6 w-6 text-slate-600" />
            <p className="max-w-xs text-[11px] leading-relaxed text-slate-400">
              {ru
                ? 'Авто ещё не запускался. Правый клик по карточке на плане → значок «Авто», или кнопка конвейера — и шаги робота появятся здесь в реальном времени.'
                : 'The Auto run has not started yet. Right-click a plan card → the Auto icon, or press the pipeline button — and the robot’s steps appear here live.'}
            </p>
          </div>
        ) : (
          feed.lines.map((line) => (
            <div key={line.id} className="flex items-start gap-1.5 border-b border-slate-900/70 py-0.5">
              <span className="w-[52px] shrink-0 text-right text-[9px] tabular-nums text-slate-600">
                {clockOf(line.at)}
              </span>
              <span className={`w-2 shrink-0 ${TONE_CLASS[line.tone] || TONE_CLASS.info}`}>
                {TONE_GLYPH[line.tone] || '·'}
              </span>
              {line.attempt ? (
                <span className="shrink-0 text-[9px] text-slate-600">#{line.attempt}</span>
              ) : null}
              <span className={`whitespace-pre-wrap break-words ${TONE_CLASS[line.tone] || TONE_CLASS.info}`}>
                {line.text}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
