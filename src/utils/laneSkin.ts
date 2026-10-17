import type { LaneKey } from './canvasView';
import type { LaneColor } from '../types';

/**
 * How a lane is painted, and what the user is allowed to paint it.
 *
 * A lane says two things at once: which status it holds, and — through its colour — how that status
 * reads at a glance. The colour was hard-coded per lane, which meant "Blocked" was amber because the
 * code said so and nothing short of editing the source could say otherwise. It is a palette now, so
 * a user can move the amber to "In progress" and give "Blocked" a red of their own.
 *
 * The palette is a named set rather than a colour picker on purpose. Every entry is already part of
 * the board's own palette, so a recoloured lane still reads as part of the app; and the two ways a
 * free picker goes wrong here — a colour that vanishes into the dark board, or a lane whose dot no
 * longer matches its border — cannot happen.
 */
export interface LaneSkin {
  /** The dot beside the name. */
  dot: string;
  /** The lane's dashed border. */
  ring: string;
  /** The lane's name. */
  text: string;
  /**
   * The plate a zone is drawn on. A lane used to be a dashed outline with the board showing through
   * it, which made a zone read as a suggestion — and made a card that had drifted out of its lane
   * look like it was still standing in one. The plate is dark and slightly transparent, so the grid
   * underneath is still visible and the cards on it are the brightest thing in the frame.
   */
  fill: string;
  /**
   * The colour wash along the top of the zone, in the lane's own colour: the plate says "a place in
   * the plan" and this says which place. It fades out within the handle, so nothing below it is
   * dimmed.
   */
  tint: string;
  /** The stripe down the left edge of a card in this lane, on the cards that carry one. */
  accent: string;
  /** The same colour as a plain value, for the swatches in the menu. */
  hex: string;
}

export const LANE_COLORS: Record<LaneColor, LaneSkin> = {
  slate: { dot: 'bg-slate-400', ring: 'border-slate-800', text: 'text-slate-300', fill: 'bg-slate-900/85', tint: 'from-slate-400/15', accent: 'border-l-slate-500', hex: '#94a3b8' },
  indigo: { dot: 'bg-indigo-400', ring: 'border-indigo-900/60', text: 'text-indigo-300', fill: 'bg-indigo-950/80', tint: 'from-indigo-500/20', accent: 'border-l-indigo-500', hex: '#818cf8' },
  purple: { dot: 'bg-purple-400', ring: 'border-purple-900/60', text: 'text-purple-300', fill: 'bg-purple-950/80', tint: 'from-purple-500/20', accent: 'border-l-purple-500', hex: '#c084fc' },
  emerald: { dot: 'bg-emerald-400', ring: 'border-emerald-900/60', text: 'text-emerald-300', fill: 'bg-emerald-950/75', tint: 'from-emerald-500/20', accent: 'border-l-emerald-500', hex: '#34d399' },
  amber: { dot: 'bg-amber-400', ring: 'border-amber-900/60', text: 'text-amber-300', fill: 'bg-amber-950/75', tint: 'from-amber-500/20', accent: 'border-l-amber-500', hex: '#fbbf24' },
  rose: { dot: 'bg-rose-400', ring: 'border-rose-900/60', text: 'text-rose-300', fill: 'bg-rose-950/75', tint: 'from-rose-500/20', accent: 'border-l-rose-500', hex: '#fb7185' },
  cyan: { dot: 'bg-cyan-400', ring: 'border-cyan-900/60', text: 'text-cyan-300', fill: 'bg-cyan-950/75', tint: 'from-cyan-500/20', accent: 'border-l-cyan-500', hex: '#22d3ee' }
};

/** The order the swatches appear in: the board's own colours first, the rest after them. */
export const LANE_COLOR_ORDER: LaneColor[] = ['slate', 'indigo', 'purple', 'emerald', 'amber', 'rose', 'cyan'];

/** The colour a lane wears until someone chooses another one. */
export const LANE_DEFAULT_COLOR: Record<LaneKey, LaneColor> = {
  ready: 'slate',
  active: 'indigo',
  blocked: 'amber',
  done: 'emerald'
};

/**
 * The colour a lane is drawn in. A stored colour that is not in the palette — a project written by a
 * newer version, or a file edited by hand — falls back to the lane's own default rather than drawing
 * a lane with no classes at all.
 */
export function laneColorOf(key: LaneKey, chosen?: LaneColor): LaneColor {
  return chosen && LANE_COLORS[chosen] ? chosen : LANE_DEFAULT_COLOR[key];
}

export function laneSkinOf(key: LaneKey, chosen?: LaneColor): LaneSkin {
  return LANE_COLORS[laneColorOf(key, chosen)];
}
