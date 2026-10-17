import { clampScale, type CanvasBox, type CanvasPoint } from './canvasView';

/**
 * Dependency lines. A plan on a board already shows *where* tasks are; the lines are what say
 * *why* they are in that order — which task is waiting for which, and what can be picked up today.
 *
 * All of it is decided here, without React, because the interesting part is not drawing a curve:
 * it is deciding what a link means right now. The same link is "queued" today, "can start" once its
 * dependency is finished, and a warning if somebody began the work before its dependency was done.
 */

export type EdgeState = 'done' | 'ready' | 'waiting' | 'blocked';

export interface DependencyTask {
  id: string;
  title: string;
  status: string;
  dependencies?: string[];
}

export interface DependencyEdge {
  id: string;
  fromId: string;
  toId: string;
  fromTitle: string;
  toTitle: string;
  state: EdgeState;
}

export interface DependencyPlan {
  edges: DependencyEdge[];
  /** How many unfinished tasks each task is waiting for. */
  waitingOn: Record<string, number>;
  /** Tasks whose dependencies are all finished and which are not finished themselves. */
  readyToStart: string[];
  /** Dependency references that point at no task in the plan — a plan-level smell, not a crash. */
  unresolved: string[];
}

/** Statuses where somebody is already working; being here with an open dependency is a problem. */
const STARTED_STATUSES = ['in_progress', 'partial', 'review', 'completed'];

function isFinished(status: string): boolean {
  return status === 'completed';
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * A dependency is usually a task id, but an AI-generated plan can carry a title instead. Both are
 * accepted, ids first; anything that matches nothing is reported rather than silently dropped.
 */
export function dependencyPlan(tasks: DependencyTask[]): DependencyPlan {
  const byId = new Map<string, DependencyTask>();
  const byTitle = new Map<string, DependencyTask>();
  for (const task of tasks) {
    byId.set(task.id, task);
    const key = normalize(task.title || '');
    if (key && !byTitle.has(key)) byTitle.set(key, task);
  }

  const edges: DependencyEdge[] = [];
  const waitingOn: Record<string, number> = {};
  const unresolved: string[] = [];
  const seen = new Set<string>();
  const reportedMissing = new Set<string>();

  for (const task of tasks) {
    waitingOn[task.id] = 0;

    for (const reference of task.dependencies || []) {
      const source = byId.get(reference) || byTitle.get(normalize(String(reference)));
      if (!source) {
        // A name that matches nothing is reported once, not once per task that mentions it.
        const label = String(reference);
        if (!reportedMissing.has(label)) {
          reportedMissing.add(label);
          unresolved.push(label);
        }
        continue;
      }
      if (source.id === task.id) continue;

      const edgeId = `${source.id}->${task.id}`;
      if (seen.has(edgeId)) continue;
      seen.add(edgeId);

      let state: EdgeState;
      if (isFinished(source.status) && isFinished(task.status)) {
        state = 'done';
      } else if (isFinished(source.status)) {
        state = 'ready';
      } else if (STARTED_STATUSES.includes(task.status)) {
        // The work is under way (or already finished) while its dependency is not — that is the
        // one combination worth shouting about, because it is how a plan quietly breaks.
        state = 'blocked';
      } else {
        state = 'waiting';
      }

      if (!isFinished(source.status)) waitingOn[task.id] += 1;

      edges.push({
        id: edgeId,
        fromId: source.id,
        toId: task.id,
        fromTitle: source.title,
        toTitle: task.title,
        state
      });
    }
  }

  const readyToStart = tasks
    .filter((task) => !isFinished(task.status) && waitingOn[task.id] === 0 && (task.dependencies || []).length > 0)
    .map((task) => task.id);

  return { edges, waitingOn, readyToStart, unresolved };
}

export type EdgeSide = 'left' | 'right' | 'top' | 'bottom';

export interface EdgeGeometry {
  /** The path itself, in world coordinates. */
  d: string;
  /** Where the line touches the dependency's card, on that card's border. */
  from: CanvasPoint;
  /** Where the line touches the dependent's card, and where the arrowhead lands. */
  to: CanvasPoint;
  fromSide: EdgeSide;
  toSide: EdgeSide;
  /**
   * The route as straight segments: the two ports, the lead-off points and any bends between them,
   * excluding the rounded corners that `d` draws. Empty when the link had to fall back to a curve.
   */
  route: CanvasPoint[];
  /** The two cubic control points, so the curve can be measured instead of guessed at. */
  control1: CanvasPoint;
  control2: CanvasPoint;
  /** The point a label about this link belongs at, measured along the drawn line. */
  mid: CanvasPoint;
  /** True when this link turns onto a shared trunk instead of meeting the card itself. */
  merged?: boolean;
  /** The shared input this link feeds, when it feeds one. */
  trunkId?: string;
}

/**
 * The width a link is drawn at, in screen pixels: it follows the zoom, so a board zoomed out to the
 * whole plan has a thin graph rather than the fat one a constant screen width leaves behind.
 *
 * Both ends are clamped for the same reason: a line thinner than a pixel is not a line, and a line
 * thicker than a few pixels stops being a link and becomes a pipe through the cards.
 */
export const LINK_MIN_SCREEN_PX = 1.2;
export const LINK_MAX_SCREEN_PX = 4.4;

/** How much of its screen width a link keeps at this zoom: 1 at 100%, less on a zoomed-out board. */
export function linkScale(scale: number, base: number): number {
  const wanted = base * clampScale(scale);
  const bounded = Math.min(LINK_MAX_SCREEN_PX, Math.max(LINK_MIN_SCREEN_PX, wanted));
  return bounded / base;
}

/** The longest a control point may reach away from its card; long links stay smooth. */
const PORT_GAP = 180;
/** …and the shortest, so two cards that almost touch still get a curve rather than a stub. */
const PORT_GAP_MIN = 18;

/**
 * How far a link runs straight out of a card before it is allowed to turn, and how round the turn
 * is. This is the whole difference between a dependency that reads as a wire drawn between two
 * boxes and one that reads as a bundle of curves: the line leaves the port square on, travels, and
 * turns once at a radius that matches the cards' own corners.
 */
const ELBOW_LEAD = 26;
const ELBOW_RADIUS = 16;
/** Two runs closer than this to each other are drawn as one straight line instead of a jog. */
const ELBOW_STRAIGHT = 4;

/**
 * How far the curve may bow out. Forty percent of the distance between the ports is the natural
 * amount: less and a link between distant cards reads as a straight line, more and a link between
 * neighbours loops back onto itself.
 */
function controlGap(distance: number): number {
  return Math.min(PORT_GAP, Math.max(PORT_GAP_MIN, distance * 0.4));
}

/**
 * Which two sides a link leaves and arrives at.
 *
 * Cards that stand apart are joined side to side: right to left, or top to bottom. Cards whose
 * rectangles overlap are joined along the axis that separates them most, because a curve leaving
 * the side the other card is *not* on has to loop back through both of them to arrive. The result
 * is always perpendicular to the side it touches, which is what makes a graph read as a graph
 * rather than as a bundle of lines.
 */
function sidePair(from: CanvasBox, to: CanvasBox): [EdgeSide, EdgeSide] {
  /*
   * The four gaps between the two rectangles, each positive when the cards stand apart that way
   * and negative by the depth of the overlap when they do not. The largest one names the axis that
   * separates them most — which is the whole rule, and it covers both cases without a branch: when
   * the cards are disjoint exactly one gap is positive, and when they overlap the *least* deep
   * overlap wins, so the link never doubles back through the cards it connects.
   */
  const gaps: Array<[number, EdgeSide, EdgeSide]> = [
    [to.x - (from.x + from.width), 'right', 'left'],
    [from.x - (to.x + to.width), 'left', 'right'],
    [to.y - (from.y + from.height), 'bottom', 'top'],
    [from.y - (to.y + to.height), 'top', 'bottom']
  ];

  // Ties keep the order above, so the same pair of cards always gets the same sides.
  let best = gaps[0];
  for (const gap of gaps) if (gap[0] > best[0]) best = gap;
  return [best[1], best[2]];
}

/**
 * How much of a side the ports may spread across when several links share it.
 *
 * One link leaves the middle of the side. Three links leaving the same card would otherwise be
 * drawn as one line, and the reader would count two dependencies where there are three — so the
 * ports fan out along the side, and each arrowhead arrives at its own place.
 */
const PORT_SPREAD = 0.72;

function anchorAt(box: CanvasBox, side: EdgeSide, slot: number, count: number): CanvasPoint {
  const share = count <= 1 ? 0.5 : 0.5 + (slot / (count - 1) - 0.5) * PORT_SPREAD;
  if (side === 'left') return { x: box.x, y: box.y + box.height * share };
  if (side === 'right') return { x: box.x + box.width, y: box.y + box.height * share };
  if (side === 'top') return { x: box.x + box.width * share, y: box.y };
  return { x: box.x + box.width * share, y: box.y + box.height };
}

/** A control point: the port pushed straight out of the side it sits on. */
function controlAt(port: CanvasPoint, side: EdgeSide, gap: number): CanvasPoint {
  if (side === 'left') return { x: port.x - gap, y: port.y };
  if (side === 'right') return { x: port.x + gap, y: port.y };
  if (side === 'top') return { x: port.x, y: port.y - gap };
  return { x: port.x, y: port.y + gap };
}

/** Which way a side lets the line out: +1 is right or down, -1 is left or up. */
function sideSign(side: EdgeSide): number {
  return side === 'right' || side === 'bottom' ? 1 : -1;
}

function isHorizontal(side: EdgeSide): boolean {
  return side === 'left' || side === 'right';
}

function distance(from: CanvasPoint, to: CanvasPoint): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function point(x: number, y: number): string {
  return `${round(x)} ${round(y)}`;
}

/** Drops the points that sit in the middle of a straight run, and the ones repeated twice. */
function simplify(points: CanvasPoint[]): CanvasPoint[] {
  const kept: CanvasPoint[] = [];
  for (const current of points) {
    const last = kept[kept.length - 1];
    if (last && distance(last, current) < 0.01) continue;
    kept.push(current);
  }

  const result: CanvasPoint[] = [];
  for (let index = 0; index < kept.length; index += 1) {
    const current = kept[index];
    if (index > 0 && index < kept.length - 1) {
      const before = kept[index - 1];
      const after = kept[index + 1];
      const cross = (current.x - before.x) * (after.y - before.y) - (current.y - before.y) * (after.x - before.x);
      // Half a world pixel of slack keeps a genuinely straight run straight without ever dropping
      // a real corner.
      const straight = Math.abs(cross) / Math.max(1, distance(before, after)) < 0.5;
      if (straight) continue;
    }
    result.push(current);
  }

  // Dropping a straight point can leave two copies of the same corner behind it, and a zero-length
  // segment is a rounded corner of radius zero — a dot of a hiccup in the middle of a clean line.
  return result.filter((current, index) => index === 0 || distance(result[index - 1], current) >= 0.01);
}

/**
 * The orthogonal route between two ports, or `null` when elbows cannot express it.
 *
 * Both ports always leave their card square on — a lead of `ELBOW_LEAD` in the side's own
 * direction — and then the line is free to travel. It only doubles back when the target sits
 * behind the port it would have to leave from, which happens with cards that overlap; there the
 * caller draws its curve instead, because an orthogonally routed line would cross the very cards
 * it connects.
 */
function elbowRoute(start: CanvasPoint, fromSide: EdgeSide, finish: CanvasPoint, toSide: EdgeSide): CanvasPoint[] | null {
  const startLead = controlAt(start, fromSide, ELBOW_LEAD);
  const endLead = controlAt(finish, toSide, ELBOW_LEAD);
  const fromSign = sideSign(fromSide);
  const horizontal = isHorizontal(fromSide);

  // The exit has to make progress: the entry point may not sit behind where the line came from.
  const travel = horizontal ? (endLead.x - startLead.x) * fromSign : (endLead.y - startLead.y) * fromSign;
  if (travel < 0) return null;

  if (horizontal === isHorizontal(toSide)) {
    // Out and in on the same axis: a Z that steps across in the middle of the run. Two ports that
    // already line up get a single straight segment instead of a jog of nothing.
    const offset = horizontal ? Math.abs(endLead.y - startLead.y) : Math.abs(endLead.x - startLead.x);
    if (offset < ELBOW_STRAIGHT) return [start, startLead, endLead, finish];

    if (horizontal) {
      const midX = (startLead.x + endLead.x) / 2;
      return [start, startLead, { x: midX, y: startLead.y }, { x: midX, y: endLead.y }, endLead, finish];
    }
    const midY = (startLead.y + endLead.y) / 2;
    return [start, startLead, { x: startLead.x, y: midY }, { x: endLead.x, y: midY }, endLead, finish];
  }

  // Out along one axis and in along the other: one turn, at the corner the two leads make.
  if (horizontal) return [start, startLead, { x: endLead.x, y: startLead.y }, endLead, finish];
  return [start, startLead, { x: startLead.x, y: endLead.y }, endLead, finish];
}

/**
 * The route as a path, with every turn rounded.
 *
 * A sharp right angle is what a diagram drawing tool draws; a card with a two-pixel border and a
 * twelve-pixel corner drawn with a square corner reads as unfinished. The radius is capped at half
 * of the shortest run into the corner, so a cramped turn degrades into a short bevel rather than
 * overshooting into the next segment.
 */
function elbowPath(points: CanvasPoint[]): string {
  const route = simplify(points);
  if (route.length < 2) return `M ${point(route[0].x, route[0].y)}`;

  let d = `M ${point(route[0].x, route[0].y)}`;
  for (let index = 1; index < route.length - 1; index += 1) {
    const before = route[index - 1];
    const corner = route[index];
    const after = route[index + 1];
    const radius = Math.min(ELBOW_RADIUS, distance(before, corner) / 2, distance(corner, after) / 2);
    const enter = controlAt(corner, opposite(corner, before), radius);
    const leave = controlAt(corner, opposite(corner, after), radius);
    d += ` L ${point(enter.x, enter.y)} Q ${point(corner.x, corner.y)} ${point(leave.x, leave.y)}`;
  }
  const last = route[route.length - 1];
  return `${d} L ${point(last.x, last.y)}`;
}

/** The side of `corner` that `other` stands on — the direction to walk away from the corner. */
function opposite(corner: CanvasPoint, other: CanvasPoint): EdgeSide {
  const dx = other.x - corner.x;
  const dy = other.y - corner.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/** The point halfway along a polyline, measured by length rather than by corner count. */
function routeMidpoint(points: CanvasPoint[]): CanvasPoint {
  const route = simplify(points);
  let total = 0;
  for (let index = 1; index < route.length; index += 1) total += distance(route[index - 1], route[index]);
  if (total === 0) return route[0];

  let walked = 0;
  const half = total / 2;
  for (let index = 1; index < route.length; index += 1) {
    const step = distance(route[index - 1], route[index]);
    if (walked + step >= half) {
      const share = step === 0 ? 0 : (half - walked) / step;
      return {
        x: route[index - 1].x + (route[index].x - route[index - 1].x) * share,
        y: route[index - 1].y + (route[index].y - route[index - 1].y) * share
      };
    }
    walked += step;
  }
  return route[route.length - 1];
}

export interface EdgeEnds {
  id: string;
  from: CanvasBox;
  to: CanvasBox;
  /** What the link means, so a trunk can be drawn in the colour of what it is feeding. */
  state?: EdgeState;
}

/**
 * A shared input: the stem the whole group of links runs into the card along.
 *
 * A task with three dependencies has one input, not three. Drawn as three separate arrows it reads
 * as three places to attach to, and at a glance the two lines that arrive next to each other look
 * like one line drawn twice — which is exactly the "why is this crooked" of a fan-in. The group is
 * routed as a bus instead: every link turns onto the trunk, and the trunk is what meets the card,
 * once, with one arrowhead.
 */
export interface EdgeTrunk {
  id: string;
  toId: string;
  toSide: EdgeSide;
  /** The point on the card's border the whole group enters. */
  port: CanvasPoint;
  /** Where the trunk starts, furthest out from the card. */
  outer: CanvasPoint;
  /** The trunk as a path, arrowhead end included. */
  d: string;
  state: EdgeState;
  /** The links feeding this input, outermost first. */
  members: string[];
}

/** How far apart two links sharing an input turn onto its trunk. */
const TRUNK_STEP = 20;

/** A blocked input is what a reader has to act on, so that is the colour the trunk takes. */
const STATE_URGENCY: Record<EdgeState, number> = { blocked: 3, waiting: 2, ready: 1, done: 0 };

interface Merge {
  trunk: EdgeTrunk;
  /** Where each member turns onto the trunk, and the axis it arrives along. */
  joins: Map<string, { point: CanvasPoint; side: EdgeSide }>;
}

function worstState(states: EdgeState[]): EdgeState {
  return states.reduce((worst, state) => (STATE_URGENCY[state] > STATE_URGENCY[worst] ? state : worst), 'done');
}

/**
 * The geometry of many links at once, because the *other* links decide where each one goes.
 *
 * A single link is drawn port to port, from the middle of a side. Links that share the side they
 * *leave* from are given their own share of it — three dependencies drawn as one line would be
 * counted as two. Links that share the side they *arrive* at are the other case, and it is the one
 * that has no answer per link at all: they merge onto one trunk, decided by the group.
 */
export function dependencyGraph(ends: EdgeEnds[]): { routes: Map<string, EdgeGeometry>; trunks: EdgeTrunk[] } {
  const geometry = new Map<string, EdgeGeometry>();
  const trunks: EdgeTrunk[] = [];

  const sides = new Map<string, { fromSide: EdgeSide; toSide: EdgeSide }>();
  const fromGroups = new Map<string, string[]>();
  const toGroups = new Map<string, string[]>();
  const byId = new Map(ends.map((end) => [end.id, end]));

  for (const end of ends) {
    const [fromSide, toSide] = sidePair(end.from, end.to);
    sides.set(end.id, { fromSide, toSide });

    const fromKey = `${end.from.id}|${fromSide}`;
    const toKey = `${end.to.id}|${toSide}`;
    fromGroups.set(fromKey, [...(fromGroups.get(fromKey) || []), end.id]);
    toGroups.set(toKey, [...(toGroups.get(toKey) || []), end.id]);
  }

  const merges = new Map<string, Merge>();
  for (const [key, ids] of toGroups) {
    if (ids.length < 2) continue;

    const cut = key.lastIndexOf('|');
    const toId = key.slice(0, cut);
    const toSide = key.slice(cut + 1) as EdgeSide;
    const box = byId.get(ids[0])!.to;

    // The group enters the middle of the side: one input, and it is the input's own centre.
    const port = anchorAt(box, toSide, 0, 1);
    // A vertical card side sends the trunk out sideways, so its links arrive along x. The other two
    // sides are the mirror of it.
    const sideways = toSide === 'left' || toSide === 'right';

    // Order the members along the side they arrive at, so the links keep the order they come in
    // and never have to cross each other on their way onto the trunk.
    const ordered = [...ids].sort((a, b) => {
      const portA = anchorAt(byId.get(a)!.from, sides.get(a)!.fromSide, 0, 1);
      const portB = anchorAt(byId.get(b)!.from, sides.get(b)!.fromSide, 0, 1);
      return sideways ? portA.y - portB.y : portA.x - portB.x;
    });

    const joins = new Map<string, { point: CanvasPoint; side: EdgeSide }>();
    ordered.forEach((id, index) => {
      // Each member turns onto the trunk at its own step out from the card, so the turns stack
      // instead of landing on one another.
      const point = controlAt(port, toSide, TRUNK_STEP * (index + 1));
      const source = anchorAt(byId.get(id)!.from, sides.get(id)!.fromSide, 0, 1);
      /*
       * A member arrives *along* the trunk, which is the axis of the side it enters: it comes from
       * whichever end of that axis its own card stands on. Nothing else would do — an arrival that
       * met the trunk sideways would put a corner on the trunk itself, and the whole point of the
       * trunk is that the group looks like one line into the card.
       */
      const side: EdgeSide = sideways
        ? (source.x < point.x ? 'left' : 'right')
        : (source.y < point.y ? 'top' : 'bottom');
      joins.set(id, { point, side });
    });

    const outer = controlAt(port, toSide, TRUNK_STEP * ordered.length);
    trunks.push({
      id: `${toId}|${toSide}`,
      toId,
      toSide,
      port,
      outer,
      d: `M ${point(outer.x, outer.y)} L ${point(port.x, port.y)}`,
      state: worstState(ordered.map((id) => byId.get(id)!.state || 'done')),
      members: ordered
    });
    merges.set(key, {
      trunk: trunks[trunks.length - 1],
      joins
    });
  }

  for (const end of ends) {
    const { fromSide, toSide } = sides.get(end.id)!;
    const fromSlot = fromGroups.get(`${end.from.id}|${fromSide}`)!.indexOf(end.id);
    const toSlot = toGroups.get(`${end.to.id}|${toSide}`)!.indexOf(end.id);
    const merge = merges.get(`${end.to.id}|${toSide}`);
    const join = merge?.joins.get(end.id);

    const start = anchorAt(end.from, fromSide, fromSlot, fromGroups.get(`${end.from.id}|${fromSide}`)!.length);
    const finish = join
      ? join.point
      : anchorAt(end.to, toSide, toSlot, toGroups.get(`${end.to.id}|${toSide}`)!.length);
    const endSide = join ? join.side : toSide;

    const elbow = elbowRoute(start, fromSide, finish, endSide);
    if (elbow) {
      geometry.set(end.id, {
        d: elbowPath(elbow),
        from: start,
        to: finish,
        fromSide,
        toSide: endSide,
        route: simplify(elbow),
        control1: controlAt(start, fromSide, ELBOW_LEAD),
        control2: controlAt(finish, endSide, ELBOW_LEAD),
        mid: routeMidpoint(elbow),
        merged: Boolean(join),
        trunkId: merge?.trunk.id
      });
      continue;
    }

    const span = Math.hypot(finish.x - start.x, finish.y - start.y);
    const gap = controlGap(span);
    const control1 = controlAt(start, fromSide, gap);
    const control2 = controlAt(finish, endSide, gap);

    geometry.set(end.id, {
      d: `M ${point(start.x, start.y)} C ${point(control1.x, control1.y)}, ${point(control2.x, control2.y)}, ${point(finish.x, finish.y)}`,
      from: start,
      to: finish,
      fromSide,
      toSide: endSide,
      route: [],
      control1,
      control2,
      mid: cubicMidpoint(start, control1, control2, finish),
      merged: Boolean(join),
      trunkId: merge?.trunk.id
    });
  }

  return { routes: geometry, trunks };
}

/** The links on their own, for callers that do not draw shared inputs. */
export function dependencyPaths(ends: EdgeEnds[]): Map<string, EdgeGeometry> {
  return dependencyGraph(ends).routes;
}

/**
 * The point halfway along the cubic — where a label about this link belongs.
 *
 * It is evaluated on the curve itself (the cubic at t = 0.5), not averaged from the two ends: for
 * a link that leaves one card sideways and arrives at the other from above, the average of the two
 * ports lands inside a card and the label would be read as belonging to that card.
 */
function cubicMidpoint(from: CanvasPoint, control1: CanvasPoint, control2: CanvasPoint, to: CanvasPoint): CanvasPoint {
  return {
    x: (from.x + 3 * control1.x + 3 * control2.x + to.x) / 8,
    y: (from.y + 3 * control1.y + 3 * control2.y + to.y) / 8
  };
}

/** One link, for callers that only have two cards. */
export function dependencyPath(from: CanvasBox, to: CanvasBox): EdgeGeometry {
  return dependencyPaths([{ id: 'single', from, to }]).get('single')!;
}

/** The point a label about this link belongs at — measured along the line that is drawn. */
export function edgeMidpoint(geometry: EdgeGeometry): CanvasPoint {
  return geometry.mid;
}
