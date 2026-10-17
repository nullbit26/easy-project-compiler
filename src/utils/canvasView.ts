/**
 * The maths behind the board. It is kept free of React on purpose: the awkward parts of an
 * infinite canvas — keeping the point under the cursor fixed while zooming, deciding what is
 * worth drawing, and laying cards out when nobody has moved them yet — are exactly the parts
 * that must be provable by a test rather than eyeballed on a screenshot.
 *
 * The dot grid belongs here too, for the same reason. A grid drawn in world units and multiplied
 * by the zoom becomes a solid haze a few steps below 100% and a sparse scatter above it, and the
 * first version of this board simply switched it off below 45% — which is exactly the zoom the
 * "fit the plan" button lands on, so the background visibly snapped off the moment the user zoomed
 * out to look at the whole plan. The next version doubled the spacing, which kept the dots
 * readable but moved them in one jump — the background still changed abruptly, only in the other
 * direction. `gridLevels` now crossfades two levels, so the density follows the zoom smoothly.
 */

export interface CanvasView {
  /** Screen-space offset of the canvas origin. */
  x: number;
  y: number;
  scale: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export interface CanvasBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How a card sits on the board before anyone has touched it. */
export interface LayoutTask {
  id: string;
  status: string;
  /** Order of the task's phase, so cards of one phase stay together inside a lane. */
  phaseIndex: number;
}

export interface LaneBand extends CanvasRect {
  key: string;
  count: number;
}

/** How far a lane was dragged from the place the board lays it out in, and how big it was made. */
export interface LanePlacement {
  offsetX?: number;
  offsetY?: number;
  /** The width the user stretched it to. Absent means the width its own cards need. */
  width?: number;
  /** The height the user stretched it to. Absent means the board's common floor. */
  height?: number;
}

/** The dragged lanes of a project, by lane key. Absent means "where the board puts it". */
export type LanePlacements = Record<string, LanePlacement | undefined>;

export interface LaneLayout {
  positions: Record<string, CanvasPoint>;
  lanes: LaneBand[];
  bounds: CanvasRect;
}

export interface LaneLayoutOptions {
  /**
   * The lane the user is holding right now. It yields to the lanes around it instead of shoving
   * them: the thing in your hand is the thing that moves, and the board it is pushed against has to
   * stay where its author put it.
   */
  pinnedKey?: string;
}

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 2.5;
export const CARD_WIDTH = 264;
export const CARD_HEIGHT = 196;

const LANE_PADDING_X = 20;
const LANE_HEADER_HEIGHT = 56;
const LANE_PADDING_BOTTOM = 28;
const LANE_GAP = 28;
const CARD_GAP = 18;

/** The distance from one lane's resting place to the next one's. */
export const LANE_STRIDE = CARD_WIDTH + LANE_PADDING_X * 2 + LANE_GAP;

/**
 * Where a lane sits when nobody has moved it, by its place in the row. The lanes are written down
 * as a distance from this point, so it has to be one number in one place: the board draws a zone
 * from its stored offset and the drag writes that offset back from what is on screen.
 */
export function laneRestOrigin(index: number): CanvasPoint {
  return { x: index * LANE_STRIDE, y: 0 };
}

/**
 * What a lane is allowed to be.
 *
 * A lane narrower than one card plus its own padding would cut its cards off, and a lane shorter
 * than its handle would have no place left to drop a card into — so stretching has a floor at the
 * size the board already gives a lane, and grows from there.
 */
export const LANE_MIN_WIDTH = CARD_WIDTH + LANE_PADDING_X * 2;
export const LANE_MIN_HEIGHT = LANE_HEADER_HEIGHT + 64;
/** The lane's handle: the strip at the top that a lane is dragged by, and the room its name needs. */
export const LANE_HEADER = LANE_HEADER_HEIGHT;

/**
 * The four bands a plan is read through. `blocked` is a lane of its own: a blocked task is the
 * one thing the author has to act on, so it must not hide inside "in progress".
 */
export const LANE_ORDER = ['ready', 'active', 'blocked', 'done'] as const;
export type LaneKey = (typeof LANE_ORDER)[number];

const LANE_OF_STATUS: Record<string, LaneKey> = {
  backlog: 'ready',
  ready: 'ready',
  in_progress: 'active',
  partial: 'active',
  review: 'active',
  blocked: 'blocked',
  completed: 'done'
};

export function laneOfStatus(status: string): LaneKey {
  return LANE_OF_STATUS[status] || 'ready';
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The dot grid at 100%: one dot every 28 world pixels. */
export const GRID_BASE = 28;
/**
 * The on-screen spacing the grid aims for. It is the spacing of the *stronger* of the two levels
 * drawn at any zoom, so the board never crowds the dots and never loses them either.
 */
export const GRID_TARGET_PX = 30;
/** On screen, a drawn level never sits closer together than this… */
export const GRID_MIN_PX = GRID_TARGET_PX / 2;
/** …nor further apart than this. */
export const GRID_MAX_PX = GRID_TARGET_PX * 2;

/** One density of dots. Positions of a coarser level are a subset of a finer one's. */
export interface GridLevel {
  /** World spacing between this level's dots — always a power of two times `GRID_BASE`. */
  step: number;
  /** How much of this level is drawn, from 0 (gone) to 1 (full strength). */
  alpha: number;
  /** Dot radius, in screen pixels. */
  radius: number;
}

/**
 * The dots to draw at a given zoom: two levels, crossfaded.
 *
 * The spacing has to double as the user zooms out, or the dots collide into a solid haze; but a
 * spacing that simply doubles the moment it crosses a threshold makes the whole background jump,
 * and that jump is what "the grid changes as I zoom" looks like on a screenshot-free review. Here
 * the doubling is spread over a full zoom factor instead: the level about to become too dense fades
 * out while the level twice as coarse fades in, and the two always add up to one. Since every
 * coarser level shares the finer level's dot positions, the two fade into each other at the same
 * places — nothing moves, only a set of dots arrives or leaves, one at a time as the zoom changes.
 */
export function gridLevels(scale: number): GridLevel[] {
  const s = clampScale(scale);
  // How many doublings of the base spacing it takes to bring this zoom up to the target.
  const wanted = Math.log2(GRID_TARGET_PX / (GRID_BASE * s));
  const level = Math.floor(wanted);
  // 0: this level already has the target spacing. 1: it is half of it, and its coarser sibling is
  // exactly on target — which is where the two have swapped roles.
  const fade = wanted - level;
  const fine = GRID_BASE * Math.pow(2, level);

  return [
    { step: fine, alpha: 1 - fade, radius: 1.1 },
    { step: fine * 2, alpha: fade, radius: 1.35 }
  ].filter((layer) => layer.alpha > 0.004);
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return clamp(scale, MIN_SCALE, MAX_SCALE);
}

/** The world point sitting under a screen point. */
export function screenToWorld(point: CanvasPoint, view: CanvasView): CanvasPoint {
  const scale = clampScale(view.scale);
  return {
    x: (point.x - view.x) / scale,
    y: (point.y - view.y) / scale
  };
}

export function worldToScreen(point: CanvasPoint, view: CanvasView): CanvasPoint {
  const scale = clampScale(view.scale);
  return {
    x: point.x * scale + view.x,
    y: point.y * scale + view.y
  };
}

/**
 * Zooming keeps the world point under the cursor exactly where it was: with the cursor at screen
 * point `p` and world point `q = (p - t) / s`, the new offset is `t' = p - q * s'`. Without this
 * a wheel zoom drifts away from what the user is pointing at.
 */
export function zoomAtPoint(view: CanvasView, point: CanvasPoint, nextScale: number): CanvasView {
  const scale = clampScale(nextScale);
  const world = screenToWorld(point, view);
  return {
    scale,
    x: point.x - world.x * scale,
    y: point.y - world.y * scale
  };
}

/** Steps through the zoom ladder so repeated clicks do not land on meaningless values. */
export function nextZoom(scale: number, direction: 1 | -1): number {
  const steps = [0.2, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5];
  const current = clampScale(scale);
  if (direction > 0) {
    return steps.find((step) => step > current + 0.001) ?? MAX_SCALE;
  }
  return [...steps].reverse().find((step) => step < current - 0.001) ?? MIN_SCALE;
}

/** The world rectangle currently on screen, used to skip drawing what nobody can see. */
export function visibleWorldRect(view: CanvasView, size: CanvasSize): CanvasRect {
  const scale = clampScale(view.scale);
  return {
    x: -view.x / scale,
    y: -view.y / scale,
    width: size.width / scale,
    height: size.height / scale
  };
}

export function isBoxVisible(box: CanvasBox, rect: CanvasRect, margin = 0): boolean {
  return (
    box.x + box.width + margin >= rect.x &&
    box.x - margin <= rect.x + rect.width &&
    box.y + box.height + margin >= rect.y &&
    box.y - margin <= rect.y + rect.height
  );
}

export function boundsOfBoxes(boxes: CanvasBox[]): CanvasRect {
  if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Frames every card with a little air around them. An empty board is shown at 1:1 rather than at
 * whatever scale an empty rectangle would produce.
 */
export function fitView(boxes: CanvasBox[], size: CanvasSize, padding = 48): CanvasView {
  const bounds = boundsOfBoxes(boxes);
  if (bounds.width <= 0 || bounds.height <= 0 || size.width <= 0 || size.height <= 0) {
    return { x: size.width / 2, y: size.height / 2, scale: 1 };
  }

  const usableWidth = Math.max(1, size.width - padding * 2);
  const usableHeight = Math.max(1, size.height - padding * 2);
  const scale = clampScale(Math.min(usableWidth / bounds.width, usableHeight / bounds.height));

  return {
    scale,
    x: size.width / 2 - (bounds.x + bounds.width / 2) * scale,
    y: size.height / 2 - (bounds.y + bounds.height / 2) * scale
  };
}

/** Do two rectangles share any area at all? Touching edges do not count as sharing. */
export function rectsOverlap(a: CanvasRect, b: CanvasRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Where a rectangle has to sit so that it leans against the others instead of lying on top of them.
 *
 * The shortest way out wins, so a lane pushed into its neighbour from the left stops at that
 * neighbour's left edge and stays there while the pointer keeps travelling — leaning, rather than
 * pressing through. Both axes are considered, which is what lets a lane slide along the side of one
 * it is pushed into instead of stopping dead.
 */
export function separateRect(rect: CanvasRect, others: CanvasRect[], passes = 3): CanvasPoint {
  let x = rect.x;
  let y = rect.y;

  for (let pass = 0; pass < passes; pass += 1) {
    let moved = false;
    for (const other of others) {
      if (!rectsOverlap({ ...rect, x, y }, other)) continue;
      // How far it would have to travel to clear the other one on each of its four sides.
      const outLeft = other.x - (x + rect.width);
      const outRight = other.x + other.width - x;
      const outUp = other.y - (y + rect.height);
      const outDown = other.y + other.height - y;
      const stepX = Math.abs(outLeft) <= Math.abs(outRight) ? outLeft : outRight;
      const stepY = Math.abs(outUp) <= Math.abs(outDown) ? outUp : outDown;

      if (Math.abs(stepX) <= Math.abs(stepY)) x += stepX;
      else y += stepY;
      moved = true;
    }
    if (!moved) break;
  }

  return { x, y };
}

/**
 * The lanes as they end up on the board: none of them lies on another one.
 *
 * The lane the user is holding goes last, so it is the one that gets out of the way — a lane in the
 * hand must never shove the ones its author placed. A board whose saved places overlap, which is how
 * lanes could be left before they leaned against each other, is settled in lane order, so the same
 * project draws the same arrangement every time.
 */
export function settleLaneRects(lanes: LaneBand[], pinnedKey?: string): LaneBand[] {
  const ordered = [
    ...lanes.filter((lane) => lane.key !== pinnedKey),
    ...lanes.filter((lane) => lane.key === pinnedKey)
  ];

  const placed: LaneBand[] = [];
  for (const lane of ordered) {
    const { x, y } = separateRect(lane, placed);
    placed.push({ ...lane, x, y });
  }

  // The board's own order comes back: lanes are drawn, fitted and measured in it.
  const settled = new Map(placed.map((lane) => [lane.key, lane]));
  return lanes.map((lane) => settled.get(lane.key)!);
}

/**
 * How big a lane may become before it would lie on its neighbour: stretching stops at the edge it
 * meets, the same way moving a lane does.
 */
export function clampLaneSize(
  rect: CanvasRect,
  others: CanvasRect[],
  limits: { minWidth: number; minHeight: number } = { minWidth: LANE_MIN_WIDTH, minHeight: LANE_MIN_HEIGHT }
): { width: number; height: number } {
  let width = Math.max(limits.minWidth, rect.width);
  let height = Math.max(limits.minHeight, rect.height);

  for (const other of others) {
    const beside = rect.y < other.y + other.height && rect.y + rect.height > other.y;
    if (beside && other.x >= rect.x + limits.minWidth) {
      width = Math.min(width, Math.max(limits.minWidth, other.x - rect.x));
    }
    const aboveOrBelow = rect.x < other.x + other.width && rect.x + rect.width > other.x;
    if (aboveOrBelow && other.y >= rect.y + limits.minHeight) {
      height = Math.min(height, Math.max(limits.minHeight, other.y - rect.y));
    }
  }

  return { width: Math.round(width), height: Math.round(height) };
}

/**
 * The first layout of a plan. Cards are grouped into lanes by status — the one meaning a Kanban
 * column carries that a free board does not — while their order inside a lane follows the phase
 * order, so a phase stays together and the board still tells the plan's story on first open.
 *
 * A lane is a zone the user owns: it can be moved, and it can be stretched wider and deeper. Both
 * of those are stored, and both still leave the lanes leaning against each other — a zone is a place
 * in the plan, and two places cannot occupy the same patch of board.
 */
export function laneLayout(
  tasks: LayoutTask[],
  placements: LanePlacements = {},
  options: LaneLayoutOptions = {}
): LaneLayout {
  const byLane = new Map<LaneKey, LayoutTask[]>();
  for (const key of LANE_ORDER) byLane.set(key, []);
  for (const task of tasks) {
    byLane.get(laneOfStatus(task.status))!.push(task);
  }

  const groups = LANE_ORDER.map((key, laneIndex) => {
    const laneTasks = [...(byLane.get(key) || [])].sort((a, b) => a.phaseIndex - b.phaseIndex);
    // A lane the user dragged carries everything the board laid out inside it. That is the whole
    // point of moving a lane rather than its cards one by one: the band and the cards nobody has
    // placed are the same thing, seen with and without a border.
    const resting = laneRestOrigin(laneIndex);
    const laneX = resting.x + (placements[key]?.offsetX || 0);
    const laneY = resting.y + (placements[key]?.offsetY || 0);
    const cardsHeight = laneTasks.length * CARD_HEIGHT + Math.max(0, laneTasks.length - 1) * CARD_GAP;
    return {
      key,
      tasks: laneTasks,
      x: laneX,
      y: laneY,
      width: Math.max(LANE_MIN_WIDTH, placements[key]?.width || LANE_MIN_WIDTH),
      // The lane the board lays out is as tall as its own cards; the floor they all share is
      // decided below, and a lane the user stretched keeps the depth they gave it.
      height: Math.max(LANE_MIN_HEIGHT, LANE_HEADER_HEIGHT + cardsHeight + LANE_PADDING_BOTTOM),
      chosenHeight: placements[key]?.height
    };
  });

  // Every lane reaches the same floor: four columns of different heights look like a bug. A lane
  // that was dragged somewhere else keeps that length — it is the same column, moved.
  const tallestLane = groups.reduce((tallest, group) => Math.max(tallest, group.height), 0);

  const wanted: LaneBand[] = groups.map((group) => ({
    key: group.key,
    x: group.x,
    y: group.y,
    width: group.width,
    height: Math.max(LANE_MIN_HEIGHT, group.chosenHeight || tallestLane),
    count: group.tasks.length
  }));

  /*
   * Only the lane in the hand is moved out of the way of the others.
   *
   * A stored board is drawn exactly as its author left it — a project is not silently rearranged
   * because the board would have placed its lanes differently — and while a zone is being dragged or
   * stretched, the one being held is the one that yields: what the user is holding has to follow the
   * pointer, and the zones it is pushed against have to stay where they were put. Nothing else on the
   * board moves because one lane is being moved.
   */
  const lanes = options.pinnedKey ? settleLaneRects(wanted, options.pinnedKey) : wanted;

  // A zone stretched by hand can still be wider than the room beside it — a project saved before
  // its neighbour was moved, or one written by another version — so the sizes are settled as well:
  // a lane that does not fit next to its neighbour is shortened until it does, and what the user
  // sees is never two plates in one patch of board.
  const fitted: LaneBand[] = [];
  for (const lane of lanes) {
    const size = clampLaneSize(lane, fitted);
    fitted.push({ ...lane, width: size.width, height: size.height });
  }

  // The cards nobody placed hang off their own lane, so they follow it wherever it was settled.
  const positions: Record<string, CanvasPoint> = {};
  for (const lane of fitted) {
    const group = groups.find((candidate) => candidate.key === lane.key)!;
    group.tasks.forEach((task, index) => {
      positions[task.id] = {
        x: lane.x + LANE_PADDING_X,
        y: lane.y + LANE_HEADER_HEIGHT + index * (CARD_HEIGHT + CARD_GAP)
      };
    });
  }

  return {
    positions,
    lanes: fitted,
    bounds: boundsOfBoxes(fitted.map((lane) => ({ id: lane.key, ...lane })))
  };
}

/**
 * Where each card actually goes: a position the user dragged wins, and only the cards nobody has
 * placed yet fall back to the lane layout. This is what lets an old project — saved before the
 * board existed — open with everything visible.
 */
export function resolvePositions(
  tasks: LayoutTask[],
  stored: Record<string, CanvasPoint | undefined>,
  layout: LaneLayout = laneLayout(tasks)
): Record<string, CanvasPoint> {
  const resolved: Record<string, CanvasPoint> = {};
  for (const task of tasks) {
    const saved = stored[task.id];
    const fallback = layout.positions[task.id] || { x: 0, y: 0 };
    resolved[task.id] = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : fallback;
  }
  return resolved;
}

/**
 * The cards a zone is carrying: the ones that lie on it.
 *
 * "Lies on it" is decided by the card's centre — the same as asking which zone the card is mostly
 * over, without a rule that has to be argued about at the margin. A card leaning over the edge of a
 * zone belongs to the place most of it is in, and picking the zone up does not change hands halfway
 * through the gesture.
 *
 * `ids` narrows the answer, which is how the board asks the only question it has to ask: *which of
 * the cards I would otherwise leave standing are on this zone*. Cards the board laid out itself are
 * already inside their lane and follow it for free — writing them down would freeze a card that the
 * plan is still allowed to rearrange.
 */
export function cardsOnZone(
  positions: Record<string, CanvasPoint>,
  rect: CanvasRect,
  ids?: string[]
): string[] {
  const list = ids ?? Object.keys(positions);
  return list.filter((id) => {
    const point = positions[id];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    const centreX = point.x + CARD_WIDTH / 2;
    const centreY = point.y + CARD_HEIGHT / 2;
    return (
      centreX >= rect.x &&
      centreX <= rect.x + rect.width &&
      centreY >= rect.y &&
      centreY <= rect.y + rect.height
    );
  });
}

export function boxesOfCards(positions: Record<string, CanvasPoint>, ids?: string[]): CanvasBox[] {
  const list = ids ?? Object.keys(positions);
  return list
    .filter((id) => positions[id])
    .map((id) => ({ id, x: positions[id].x, y: positions[id].y, width: CARD_WIDTH, height: CARD_HEIGHT }));
}

/**
 * The minimap: a card's world rectangle mapped into a small box, and the way back. A click on the
 * map has to land on the same world point, otherwise the map is decoration rather than a control.
 */
export function minimapTransform(rect: CanvasRect, size: CanvasSize) {
  const scale = Math.min(size.width / Math.max(1, rect.width), size.height / Math.max(1, rect.height));
  const offsetX = (size.width - rect.width * scale) / 2;
  const offsetY = (size.height - rect.height * scale) / 2;
  return {
    scale,
    offsetX,
    offsetY,
    toMap: (point: CanvasPoint): CanvasPoint => ({
      x: point.x * scale + offsetX,
      y: point.y * scale + offsetY
    }),
    toWorld: (point: CanvasPoint): CanvasPoint => ({
      x: (point.x - offsetX) / scale,
      y: (point.y - offsetY) / scale
    })
  };
}
