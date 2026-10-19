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
      {/*
        The menu is icons, not a document.
        *
        * A card right-click used to open a small panel that said the card's name twice (a heading
        * above a field already holding it), labelled its one field with an uppercase caption, and
        * spelled the robot action out as "Автокодинг: сделать самому". Three lines of words to
        * describe two things a pencil and a chip say on their own. What is left is the name field —
        * which has to be a field, because renaming is typing — and a row of icon buttons, each
        * carrying its words in the tooltip and the accessible name.
        */}
      <div className="flex items-center gap-1.5">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400"
          title={target.lane ? t.plan.laneMenuRename : t.plan.cardMenuRename}
        >
          {color ? (
            <span className={`h-2.5 w-2.5 rounded-full ${color.dot}`} />
          ) : (
            <Type className="h-3.5 w-3.5" />
          )}
        </span>
        <input
          ref={inputRef}
          data-testid="plan-context-rename"
          aria-label={target.lane ? t.plan.laneMenuRename : t.plan.cardMenuRename}
          value={draft}
          placeholder={target.lane ? t.plan.laneRenamePlaceholder : t.plan.cardRenamePlaceholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
          }}
          className="h-7 min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-950 px-2 text-xs text-slate-100 focus:border-indigo-600"
        />
        <button
          onClick={commit}
          data-testid="plan-context-apply"
          title={t.common.apply}
          aria-label={t.common.apply}
          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-indigo-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(2_6_23/0.55)] hover:bg-indigo-500"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-1 border-t border-slate-800/80 pt-2">
        {target.task && onAutoCode && (
          <button
            data-testid="plan-context-autocode"
            onClick={() => {
              onAutoCode(target.task!);
              onClose();
            }}
            title={t.plan.autoCodeButton}
            aria-label={t.plan.autoCodeButton}
            className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-indigo-500/12 text-indigo-300 ring-1 ring-inset ring-indigo-400/30 transition-colors hover:bg-indigo-500/20 hover:text-indigo-200"
          >
            <Cpu className="h-3.5 w-3.5" />
          </button>
        )}

        {target.lane && (
          <>
            <span
              className="flex h-7 w-5 items-center justify-center text-slate-400"
              title={t.plan.laneMenuColor}
            >
              <Palette className="h-3.5 w-3.5" />
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
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
          </>
        )}

        {target.lane?.custom && (
          <button
            data-testid="plan-lane-reset"
            onClick={() => {
              onResetLane();
              onClose();
            }}
            title={t.plan.laneMenuReset}
            aria-label={t.plan.laneMenuReset}
            className="ml-auto flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
