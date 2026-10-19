/**
 * The arithmetic of a row of panes, kept apart from the drawing of it.
 *
 * Two panes are two numbers that must keep adding up. The studio and the workspace beside the
 * current screen both drag the same kind of divider, so the rule lives in one place: a drag trades
 * percent with exactly one neighbour and stops each pane at the floor.
 */

/** A pane never shrinks below this share of its row. */
export const MIN_PANE_PERCENT = 16;

export function adjustSizes(
  sizes: number[],
  index: number,
  delta: number,
  min = MIN_PANE_PERCENT
): number[] {
  if (index < 0 || index >= sizes.length - 1) return sizes;
  const pair = sizes[index] + sizes[index + 1];
  const next = [...sizes];
  const first = Math.min(Math.max(sizes[index] + delta, min), pair - min);
  next[index] = first;
  next[index + 1] = pair - first;
  return next;
}
