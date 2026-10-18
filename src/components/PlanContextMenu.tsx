import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Cpu, Palette, RotateCcw, Type } from 'lucide-react';

import type { LaneColor } from '../types';
import type { Translations } from '../i18n/translations';
import { LANE_COLOR_ORDER, LANE_COLORS } from '../utils/laneSkin';

/** The name of each swatch, so a colour is not a thing the user has to guess at. */
const COLOR_LABEL_KEY: Record<
  LaneColor,
  'colorSlate' | 'colorIndigo' | 'colorPurple' | 'colorEmerald' | 'colorAmber' | 'colorRose' | 'colorCyan'
> = {
  slate: 'colorSlate',
  indigo: 'colorIndigo',
  purple: 'colorPurple',
  emerald: 'colorEmerald',
  amber: 'colorAmber',
  rose: 'colorRose',
  cyan: 'colorCyan'
};

/**
 * The board's right-click menu: what a lane is called, what colour it wears, and what a card is
 * called.
 *
 * All three are the same kind of thing — a name the author of the plan is allowed to change — and
 * none of them belongs in a settings screen: the lane being renamed is the one under the pointer, and
 * a menu that opens where the right button went down keeps that connection visible. The rename field
 * is the top of the menu and takes the focus, so the whole gesture is right-click, type, Enter.
 */

/** What the menu was opened on, and where. Coordinates are window pixels, as the event reported them. */
export interface PlanMenuTarget {
  x: number;
  y: number;
  lane?: {
    key: string;
    /** The name it shows now — the user's own or the lane's default. */
    label: string;
    color: LaneColor;
    /** True when this lane carries anything the user set, so "put it back" has something to undo. */
    custom: boolean;
  };
  task?: { id: string; title: string };
}

export interface PlanContextMenuProps {
  target: PlanMenuTarget;
  t: Translations;
  onRenameLane: (label: string) => void;
  onColorLane: (color: LaneColor) => void;
  onResetLane: () => void;
  onRenameTask: (title: string) => void;
  /** The card's own right-click action: the autonomous code loop, launched for this task. */
  onAutoCode?: (task: { id: string; title: string }) => void;
  onClose: () => void;
}

const MENU_WIDTH = 244;

export const PlanContextMenu: React.FC<PlanContextMenuProps> = ({
  target,
  t,
  onRenameLane,
  onColorLane,
  onResetLane,
  onRenameTask,
  onAutoCode,
  onClose
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(target.lane?.label || target.task?.title || '');
  /** How far the panel had to move to stay inside the window. */
  const [shift, setShift] = useState({ x: 0, y: 0 });

  /**
   * A menu that opens at the pointer must not hang off the window: the lane at the very right of the
   * board is exactly the one a user right-clicks to rename, and half a menu is not a menu.
   */
  useLayoutEffect(() => {
    const node = panelRef.current;
    if (!node || typeof window === 'undefined') return;
    const rect = node.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const overflowX = Math.max(0, target.x + rect.width + 8 - window.innerWidth);
    const overflowY = Math.max(0, target.y + rect.height + 8 - window.innerHeight);
    if (overflowX || overflowY) {
      setShift({ x: -overflowX, y: -overflowY });
    }
  }, [target.x, target.y, draft]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select?.();
  }, []);

  /**
   * The way out, in the order a user reaches for it: a press anywhere else, Escape, or the window
   * losing the pointer. The press listener runs in the capture phase and stops there, so a click
   * meant for the board behind the menu cannot select a card on its way out.
   */
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  /** Enter and the check button both commit; a name that is only spaces is refused, as is no change. */
  const commit = () => {
    const clean = draft.trim();
    if (!clean) return onClose();
    if (clean === (target.lane?.label || target.task?.title || '')) return onClose();
    if (target.lane) onRenameLane(clean);
    else if (target.task) onRenameTask(clean);
    onClose();
  };

  const title = target.lane?.label || target.task?.title || '';
  const color = target.lane ? LANE_COLORS[target.lane.color] : null;

  return (
    <div
      ref={panelRef}
      role="menu"
      data-testid="plan-context-menu"
      data-menu-for={target.lane ? `lane-${target.lane.key}` : target.task ? `task-${target.task.id}` : undefined}
      style={{ left: target.x + shift.x, top: target.y + shift.y, width: MENU_WIDTH }}
      // The board is a grab surface: the menu has to keep its own presses to itself.
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      className="fixed z-50 rounded-xl border border-slate-700 bg-slate-900/98 backdrop-blur shadow-2xl shadow-black/60 p-2.5 space-y-2.5"
    >
      <div className="flex items-center gap-2 px-1 pt-0.5">
        {color && <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${color.dot}`} />}
        <span className="text-[11px] font-bold text-slate-200 truncate">{title}</span>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 px-1">
          <Type className="w-3 h-3 text-slate-400" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {target.lane ? t.plan.laneMenuRename : t.plan.cardMenuRename}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            data-testid="plan-context-rename"
            value={draft}
            placeholder={target.lane ? t.plan.laneRenamePlaceholder : t.plan.cardRenamePlaceholder}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commit();
              }
            }}
            className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:border-indigo-600"
          />
          <button
            onClick={commit}
            data-testid="plan-context-apply"
            title={t.common.apply}
            aria-label={t.common.apply}
            className="w-7 h-7 shrink-0 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {target.task && onAutoCode && (
        <button
          data-testid="plan-context-autocode"
          onClick={() => {
            onAutoCode(target.task!);
            onClose();
          }}
          title={t.plan.autoCodeButton}
          className="w-full flex items-center gap-2 px-1.5 py-1.5 rounded-lg text-[11px] font-semibold text-indigo-300 hover:bg-indigo-600/15 hover:text-indigo-200 cursor-pointer"
        >
          <Cpu className="w-3.5 h-3.5" />
          {t.plan.autoCodeButton}
        </button>
      )}

      {target.lane && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 px-1">
            <Palette className="w-3 h-3 text-slate-400" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {t.plan.laneMenuColor}
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-1 flex-wrap">
            {LANE_COLOR_ORDER.map((key) => (
              <button
                key={key}
                data-testid={`plan-lane-color-${key}`}
                data-selected={target.lane?.color === key ? 'true' : undefined}
                title={t.plan[COLOR_LABEL_KEY[key]]}
                aria-label={t.plan[COLOR_LABEL_KEY[key]]}
                aria-pressed={target.lane?.color === key}
                onClick={() => {
                  onColorLane(key);
                  onClose();
                }}
                style={{ backgroundColor: LANE_COLORS[key].hex }}
                className={`w-5 h-5 rounded-full cursor-pointer transition-transform hover:scale-110 ${
                  target.lane?.color === key ? 'ring-2 ring-white/80' : 'ring-1 ring-slate-700'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {target.lane?.custom && (
        <button
          data-testid="plan-lane-reset"
          onClick={() => {
            onResetLane();
            onClose();
          }}
          className="w-full flex items-center gap-2 px-1.5 py-1.5 rounded-lg text-[11px] font-semibold text-slate-400 hover:bg-slate-800 hover:text-slate-200 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {t.plan.laneMenuReset}
        </button>
      )}
    </div>
  );
};
