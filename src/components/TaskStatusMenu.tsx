import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { TaskStatus } from '../types';
import { useLanguage } from '../context/LanguageContext';

/**
 * The status of a task, chosen from a menu that belongs to this app.
 *
 * The card used to carry a native `<select>`: the trigger could be styled, the list could not — it
 * opened as an operating-system popup with a blue highlight, in the middle of a board of slate and
 * indigo, and it showed nothing at all for a task in `partial`, because no option carried that
 * value. This is the same control drawn here: a dot in the state's own colour, the word the
 * dictionary already has for it, and a list with a check against the current one.
 *
 * The list is rendered into `document.body` at fixed coordinates, not inside the card. Cards live in
 * a scaled container, and a menu inside one would be a menu at 39% zoom.
 */

/** The dot each state carries. One map, exported, so the card header and the menu agree. */
export const STATUS_DOT: Record<string, string> = {
  ready: 'bg-slate-400',
  backlog: 'bg-slate-500',
  in_progress: 'bg-indigo-400',
  partial: 'bg-indigo-300',
  review: 'bg-purple-400',
  blocked: 'bg-amber-400',
  completed: 'bg-emerald-400'
};

/** The states a person can pick. `partial` is reached by the loop, not chosen here. */
const CHOOSABLE: TaskStatus[] = ['ready', 'in_progress', 'review', 'completed', 'blocked'];

const ITEM_HEIGHT = 30;
const MENU_PADDING = 10;

interface TaskStatusMenuProps {
  status: TaskStatus;
  onChange: (status: TaskStatus) => void;
  /** Icon-sized trigger, for a card read from far away. */
  compact?: boolean;
  className?: string;
}

export const TaskStatusMenu: React.FC<TaskStatusMenuProps> = ({
  status,
  onChange,
  compact = false,
  className = ''
}) => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; top: number; minWidth: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // `backlog` has no word of its own: it is the state before a task is ready, and the plan says so
  // elsewhere. Everything else is read from the dictionary, which is where the words live.
  const label = (t.taskStatuses as Record<string, string>)[status] || status;

  const close = () => setOpen(false);

  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const height = CHOOSABLE.length * ITEM_HEIGHT + MENU_PADDING;
    // Near the bottom of the window the list opens upwards instead of off the screen.
    const opensUp = rect.bottom + height > window.innerHeight && rect.top > height;
    setAnchor({
      left: Math.min(rect.left, Math.max(8, window.innerWidth - 200)),
      top: opensUp ? rect.top - height - 6 : rect.bottom + 6,
      minWidth: Math.max(rect.width, 160)
    });
    setOpen(true);
  };

  // Anything that moves the board would leave the list hanging over the wrong card: the menu lives
  // in the viewport, the card does not.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const choose = (next: TaskStatus) => {
    close();
    if (next !== status) onChange(next);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="task-status-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t.plan.statusLabel}: ${label}`}
        title={t.plan.statusLabel}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => (open ? close() : openMenu())}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/70 font-semibold text-slate-300 transition-colors hover:border-slate-600 hover:text-slate-100 cursor-pointer ${
          compact ? 'h-8 w-8 justify-center' : 'px-2 py-1 text-[10px]'
        } ${className}`}
      >
        {status === 'partial' && (
          <Check className="w-3 h-3 text-emerald-400 shrink-0" aria-hidden="true" />
        )}
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[status] || 'bg-slate-500'}`} />
        {!compact && <span className="truncate">{label}</span>}
        {!compact && <ChevronDown className="w-3 h-3 shrink-0 text-slate-500" aria-hidden="true" />}
      </button>

      {open &&
        anchor &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            data-testid="task-status-menu"
            style={{ left: anchor.left, top: anchor.top, minWidth: anchor.minWidth }}
            className="fixed z-[60] rounded-xl border border-slate-700/80 bg-slate-900/98 p-1 shadow-2xl shadow-black/60 backdrop-blur"
          >
            {CHOOSABLE.map((value) => {
              const active = value === status;
              return (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  data-status-option={value}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => choose(value)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors cursor-pointer ${
                    active ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[value]}`} />
                  <span className="flex-1 truncate">{(t.taskStatuses as Record<string, string>)[value] || value}</span>
                  {active && <Check className="w-3.5 h-3.5 text-indigo-300 shrink-0" aria-hidden="true" />}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
};
