import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Columns3,
  GripVertical,
  Layers,
  Link2,
  Map as MapIcon,
  Maximize2,
  Minus,
  Plus,
  Rows3,
  Sparkles
} from 'lucide-react';

import { CanvasLaneSkin, LaneColor, ProjectState, ProjectPhase, ProjectTask, TaskStatus } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { localizeText } from '../utils/textLocalizer';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  CanvasBox,
  CanvasPoint,
  CanvasView,
  LANE_HEADER,
  LANE_ORDER,
  LaneKey,
  boxesOfCards,
  cardsOnZone,
  clampLaneSize,
  clampScale,
  fitView,
  gridLevels,
  isBoxVisible,
  laneLayout,
  laneOfStatus,
  laneRestOrigin,
  minimapTransform,
  nextZoom,
  resolvePositions,
  screenToWorld,
  separateRect,
  visibleWorldRect,
  worldToScreen,
  zoomAtPoint
} from '../utils/canvasView';
import { PlanTaskDialogs } from './PlanTaskDialogs';
import { PlanContextMenu, type PlanMenuTarget } from './PlanContextMenu';
import { laneColorOf, laneSkinOf } from '../utils/laneSkin';
import {
  dependencyGraph,
  dependencyPlan,
  edgeMidpoint,
  linkScale,
  type DependencyEdge,
  type EdgeGeometry,
  type EdgeState,
  type EdgeTrunk
} from '../utils/canvasEdges';

/**
 * The plan as an infinite board. A Kanban column can only ever say "this is ready" — the plan
 * itself is a shape: a phase that must happen before another, a task parked next to the file it
 * touches, the one blocked card everyone keeps scrolling past. Space says those things, and
 * columns cannot.
 *
 * The cards stay real DOM: their dropdowns and buttons work exactly as they do in the columns,
 * because they *are* the same React components — only the container is transformed.
 */

const MINIMAP = { width: 188, height: 118 };
const FALLBACK_SIZE = { width: 1180, height: 720 };

/** How much of a link's colour survives when it is not the one being looked at. */
const DIMMED_LINK = 0.18;

/**
 * The ink of a dot grid at full strength; the level alphas fade it, never the colour.
 *
 * The two crossfaded levels overlap on every other dot, so what the eye reads is the sum of them:
 * at half strength each, roughly this value spread over the field. It is set so a board zoomed to
 * the whole plan has the same amount of background it had when a single layer carried all of it.
 */
const GRID_INK = 0.55;

/**
 * Below this zoom a card is too small to carry a readable label, so its one action becomes an icon
 * on a square that is still a comfortable thing to hit. Above it the button says what it does.
 */
const COMPACT_CARD_SCALE = 0.7;

/** The name a lane carries until someone renames it, and what it says it holds. */
const LANE_LABEL_KEY: Record<LaneKey, 'laneReady' | 'laneActive' | 'laneBlocked' | 'laneDone'> = {
  ready: 'laneReady',
  active: 'laneActive',
  blocked: 'laneBlocked',
  done: 'laneDone'
};

/** How a dependency line looks, by what it means. Widths are divided by the zoom: a link should
 * read the same at 40% and at 200%, and the arrow marker scales with the stroke. */
const LINK_LABEL_KEY: Record<EdgeState, 'linkReady' | 'linkWaiting' | 'linkBlocked' | 'linkDone'> = {
  ready: 'linkReady',
  waiting: 'linkWaiting',
  blocked: 'linkBlocked',
  done: 'linkDone'
};

const LINK_SKIN: Record<EdgeState, { color: string; width: number; dash?: string; opacity: number }> = {
  ready: { color: '#34d399', width: 2.4, opacity: 0.95 },
  waiting: { color: '#6366f1', width: 1.7, dash: '7 6', opacity: 0.9 },
  blocked: { color: '#fbbf24', width: 2.4, dash: '7 6', opacity: 0.95 },
  done: { color: '#334155', width: 1.5, opacity: 0.75 }
};

const STATUS_DOT: Record<string, string> = {
  ready: 'bg-slate-400',
  backlog: 'bg-slate-500',
  in_progress: 'bg-indigo-400',
  partial: 'bg-indigo-300',
  review: 'bg-purple-400',
  blocked: 'bg-amber-400',
  completed: 'bg-emerald-400'
};

interface PlanCanvasProps {
  project: ProjectState | null;
  onUpdateTaskStatus: (taskId: string, status: TaskStatus) => void;
  onUpdateTaskPositions: (positions: Record<string, { x: number; y: number }>) => void;
  /** Renaming a card: the plan's own words for the work, changed where the card is. */
  onUpdateTaskTitle?: (taskId: string, title: string) => void;
  /**
   * The lanes as the user arranged them: name, colour, and where each one was dragged to. The second
   * argument is the cards a moved zone carried with it — a zone and the cards lying on it are one
   * gesture and have to reach the project as one write.
   */
  onUpdateCanvasLanes?: (
    lanes: Record<string, CanvasLaneSkin>,
    positions?: Record<string, { x: number; y: number }>
  ) => void;
  onCompileTaskPrompt: (taskTitle: string) => void;
  onAddTask: (phaseId: string, title: string, goal: string) => void;
  onAdaptProjectPhases?: (updatedPhases: ProjectPhase[]) => void;
  onOpenNewProjectModal?: () => void;
  /** Present when the plan screen can also be read as columns. */
  onSwitchToKanban?: () => void;
}

export const PlanCanvas: React.FC<PlanCanvasProps> = ({
  project,
  onUpdateTaskStatus,
  onUpdateTaskPositions,
  onUpdateTaskTitle,
  onUpdateCanvasLanes,
  onCompileTaskPrompt,
  onAddTask,
  onAdaptProjectPhases,
  onOpenNewProjectModal,
  onSwitchToKanban
}) => {
  const { language, t } = useLanguage();

  const [view, setView] = useState<CanvasView>({ x: 0, y: 0, scale: 1 });
  const [size, setSize] = useState(FALLBACK_SIZE);
  const [panning, setPanning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phaseFilter, setPhaseFilter] = useState('all');
  /** The card under the pointer — its links are the ones worth showing at full strength. */
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  /** The link under the pointer, and the label that explains it. */
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  /** The card the pointer went down on; the drag lives as long as this is set. */
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{ taskId: string; position: CanvasPoint } | null>(null);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [adaptOpen, setAdaptOpen] = useState(false);
  const [showLinks, setShowLinks] = useState(true);
  /** The right-click menu: what it is about, and where the pointer was. */
  const [menu, setMenu] = useState<PlanMenuTarget | null>(null);
  /**
   * A lane in the hand. Only the distance from where the drag began is kept: the lane's stored place
   * is what the release writes to, and reading it here would fight the state that is being written.
   */
  const [laneDrag, setLaneDrag] = useState<{ key: string; dx: number; dy: number } | null>(null);
  /**
   * A lane being stretched. The size is a world-unit number from the start of the gesture rather than
   * a distance from it, because a zone is sized by where its edges end up, not by how far the pointer
   * travelled — and the release writes exactly the number being drawn.
   */
  const [laneResize, setLaneResize] = useState<{ key: string; width: number; height: number } | null>(null);
  /**
   * The cards the zone in the hand is carrying, and where the zone stood when it was picked up.
   *
   * Captured at the start of the gesture rather than recomputed along the way: what moves is the
   * zone that was picked up, and a zone that collected new cards as it slid past them would be a
   * different object halfway through the drag.
   */
  const laneDragCardsRef = useRef<{
    key: string;
    rect: { x: number; y: number; width: number; height: number };
    cards: Record<string, CanvasPoint>;
  } | null>(null);

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const panPointerRef = useRef<{ pointerId: number; startX: number; startY: number; origin: CanvasView } | null>(null);
  const cardPointerRef = useRef<{
    taskId: string;
    pointerId: number;
    grabX: number;
    grabY: number;
    moved: boolean;
    /**
     * The card's position as the pointer last put it. The release reads this, not React state:
     * a fast drag can deliver the last move and the release in one batch, and a position that
     * only exists in state would be read as a stale `null` and silently dropped.
     */
    position?: CanvasPoint;
  } | null>(null);

  const applyView = useCallback((next: CanvasView) => {
    viewRef.current = next;
    setView(next);
  }, []);

  /** Every task, in phase order — the board is always the whole plan, even when filtered. */
  const layoutTasks = useMemo(() => {
    if (!project) {
      return [] as { id: string; title: string; status: string; dependencies: string[]; phaseIndex: number }[];
    }
    return project.phases.flatMap((phase, phaseIndex) =>
      phase.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        dependencies: task.dependencies || [],
        phaseIndex
      }))
    );
  }, [project]);

  /** What the user changed about the lanes: their names, their colours, where they were dragged. */
  const laneSkins = useMemo(() => (project?.canvasLanes || {}) as Record<string, CanvasLaneSkin>, [project?.canvasLanes]);

  /**
   * The lanes as they are being drawn right now. A lane in the hand is added to the stored place
   * rather than replacing it, so a second drag carries on from where the first one left the lane
   * instead of jumping back to where the board would have put it.
   */
  const lanePlacements = useMemo(() => {
    if (!laneDrag && !laneResize) return laneSkins;
    if (laneResize) {
      const base = laneSkins[laneResize.key] || {};
      return {
        ...laneSkins,
        [laneResize.key]: { ...base, width: laneResize.width, height: laneResize.height }
      };
    }
    const base = laneSkins[laneDrag!.key] || {};
    return {
      ...laneSkins,
      [laneDrag!.key]: {
        ...base,
        offsetX: (base.offsetX || 0) + laneDrag!.dx,
        offsetY: (base.offsetY || 0) + laneDrag!.dy
      }
    };
  }, [laneSkins, laneDrag, laneResize]);

  /**
   * Which lane is being held, so the board can make it yield to the others instead of shoving them:
   * the zone in your hand is the one that moves, and the ones you push it against stay put.
   */
  const pinnedLane = laneDrag?.key ?? laneResize?.key;

  /*
   * The lanes are laid out from the placement the user made, not from the placement the board would
   * have made: every card nobody has dragged hangs off its lane, so moving a lane moves its cards
   * with it. That is the difference between a zone and a decoration.
   */
  const layout = useMemo(
    () => laneLayout(layoutTasks, lanePlacements, { pinnedKey: pinnedLane }),
    [layoutTasks, lanePlacements, pinnedLane]
  );

  /**
   * The zones as they are drawn, readable from the pointers that outlive a render: an edge being
   * dragged has to grow from the size on screen now, not from the size of the lane the drag started
   * on — a second stretch carries on from where the first one left the zone.
   */
  const laneRectsRef = useRef<Record<string, { x: number; y: number; width: number; height: number }>>({});
  laneRectsRef.current = Object.fromEntries(
    layout.lanes.map((lane) => [lane.key, { x: lane.x, y: lane.y, width: lane.width, height: lane.height }])
  );

  /**
   * The cards somebody placed by hand. They are the only ones the board has to write down when a
   * zone carries them: every other card is laid out inside its lane and follows the lane for free.
   */
  const storedPositions = useMemo(() => {
    const stored: Record<string, CanvasPoint> = {};
    if (project) {
      for (const phase of project.phases) {
        for (const task of phase.tasks) {
          const point = task.canvasPosition;
          if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) stored[task.id] = point;
        }
      }
    }
    return stored;
  }, [project]);

  /*
   * What the cards in the hand's zone have to move by: the distance the zone itself travelled, read
   * from the rectangle being drawn rather than from the pointer. A zone pushed against its neighbour
   * leans on it and travels less than the hand does, and the cards in it lean with it — taking the
   * pointer's distance instead would slide them out from under the zone they belong to.
   */
  const carriedCards = useMemo(() => {
    const held = laneDragCardsRef.current;
    if (!laneDrag || !held || held.key !== laneDrag.key) return null;
    const now = laneRectsRef.current[laneDrag.key];
    if (!now) return null;
    const dx = now.x - held.rect.x;
    const dy = now.y - held.rect.y;
    return dx === 0 && dy === 0 ? null : { cards: held.cards, dx, dy };
  }, [laneDrag, layout]);

  const positions = useMemo(() => {
    const resolved = resolvePositions(layoutTasks, storedPositions, layout);
    // A card placed by hand is an absolute point, so carrying it means moving that point; the cards
    // the board laid out are already inside their lane and need nothing.
    if (carriedCards) {
      for (const [id, start] of Object.entries(carriedCards.cards)) {
        resolved[id] = { x: start.x + carriedCards.dx, y: start.y + carriedCards.dy };
      }
    }
    return resolved;
  }, [layoutTasks, storedPositions, layout, carriedCards]);

  /** A card being dragged must pull its lines with it, not the position it had a moment ago. */
  const livePositions = useMemo(() => {
    if (!dragState) return positions;
    return { ...positions, [dragState.taskId]: dragState.position };
  }, [positions, dragState]);

  /*
   * The drag lives in window listeners, so they read through refs: a listener registered when the
   * drag started must not keep a copy of the plan from that moment.
   */
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const updatePositionsRef = useRef(onUpdateTaskPositions);
  updatePositionsRef.current = onUpdateTaskPositions;

  const localPoint = useCallback((clientX: number, clientY: number): CanvasPoint => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left || 0), y: clientY - (rect?.top || 0) };
  }, []);

  /** Removes the listeners of a drag in progress; a no-op when nothing is being dragged. */
  const detachRef = useRef<() => void>(() => {});

  /** Whether a card is in the hand, readable from the callbacks that must not be rebuilt. */
  const draggingRef = useRef<string | null>(null);
  draggingRef.current = dragging;

  /**
   * The listeners of the drag in progress, so they can be taken off exactly once — by the release,
   * by its own cancellation, or by the board being unmounted mid-drag.
   */
  const attachDrag = useCallback((move: (event: PointerEvent) => void, finish: (event: PointerEvent) => void) => {
    detachRef.current();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    detachRef.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      detachRef.current = () => {};
    };
  }, []);

  const boxById = useMemo(() => {
    const boxes: Record<string, CanvasBox> = {};
    for (const [id, point] of Object.entries(livePositions)) {
      boxes[id] = { id, x: point.x, y: point.y, width: CARD_WIDTH, height: CARD_HEIGHT };
    }
    return boxes;
  }, [livePositions]);

  const dependency = useMemo(() => dependencyPlan(layoutTasks), [layoutTasks]);
  const readyToStart = useMemo(() => new Set(dependency.readyToStart), [dependency]);

  /**
   * The lines to draw: both ends have to exist, and at least one end has to be near the viewport —
   * a link between two cards nobody can see is a shape, not information.
   *
   * The geometry is built for all of them at once: a card with three outgoing links spreads them
   * along the side it sends them from, and a port position cannot be decided one link at a time
   * without the three landing on the same spot.
   */
  const drawnEdges = useMemo(() => {
    if (!showLinks) {
      return { edges: [] as { edge: DependencyEdge; path: EdgeGeometry }[], trunks: [] as EdgeTrunk[] };
    }
    const rect = visibleWorldRect(view, size);
    const measured = size.width > 0 && size.height > 0;

    const visible = dependency.edges.flatMap((edge) => {
      const from = boxById[edge.fromId];
      const to = boxById[edge.toId];
      if (!from || !to) return [];
      if (measured && !isBoxVisible(from, rect, 240) && !isBoxVisible(to, rect, 240)) return [];
      return [{ edge, from, to }];
    });

    const graph = dependencyGraph(
      visible.map(({ edge, from, to }) => ({ id: edge.id, from, to, state: edge.state }))
    );
    return {
      edges: visible.map(({ edge }) => ({ edge, path: graph.routes.get(edge.id)! })),
      trunks: graph.trunks
    };
  }, [dependency, boxById, showLinks, view, size]);

  /**
   * Which lines are worth showing at full strength. Hovering a card shows *its* links and lets the
   * rest fade; hovering a line shows that one. Without this a plan of twenty tasks reads as a
   * thicket, and the one dependency being asked about is the hardest thing on the board to find.
   */
  const mutedEdges = useMemo(() => {
    const muted = new Set<string>();
    if (hoveredEdgeId) {
      for (const { edge } of drawnEdges.edges) if (edge.id !== hoveredEdgeId) muted.add(edge.id);
      return muted;
    }
    if (hoveredTaskId) {
      for (const { edge } of drawnEdges.edges) {
        if (edge.fromId !== hoveredTaskId && edge.toId !== hoveredTaskId) muted.add(edge.id);
      }
    }
    return muted;
  }, [drawnEdges, hoveredEdgeId, hoveredTaskId]);

  /**
   * The shared inputs, as the render sees them: a trunk is as dim as the whole group, and lit as
   * soon as one of its links is being followed.
   */
  const drawnTrunks = useMemo(
    () =>
      drawnEdges.trunks.map((trunk) => ({
        trunk,
        muted: trunk.members.every((id) => mutedEdges.has(id)),
        focused: trunk.members.some((id) => id === hoveredEdgeId) || hoveredTaskId === trunk.toId
      })),
    [drawnEdges, mutedEdges, hoveredEdgeId, hoveredTaskId]
  );

  /** The one link under the pointer, drawn where the reader is looking. */
  const hoveredEdge = useMemo(() => {
    if (!hoveredEdgeId) return null;
    return drawnEdges.edges.find(({ edge }) => edge.id === hoveredEdgeId) || null;
  }, [drawnEdges, hoveredEdgeId]);

  const edgeLayer = useMemo(() => {
    if (drawnEdges.edges.length === 0) return null;
    const points = [
      ...drawnEdges.edges.flatMap(({ path }) => [path.from, path.to]),
      ...drawnEdges.trunks.flatMap((trunk) => [trunk.port, trunk.outer])
    ];
    const minX = Math.min(...points.map((point) => point.x)) - 40;
    const minY = Math.min(...points.map((point) => point.y)) - 40;
    const maxX = Math.max(...points.map((point) => point.x)) + 40;
    const maxY = Math.max(...points.map((point) => point.y)) + 40;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }, [drawnEdges]);

  /**
   * How wide a link is drawn at this zoom. A link keeps its colour and its meaning when the board
   * shrinks, but not its width: the line and its arrowhead follow the zoom down to a floor, which
   * is what stops a zoomed-out plan from being covered by a dozen full-size arrowheads.
   */
  const linkWidth = useCallback(
    (base: number) => (base * linkScale(view.scale, base)) / view.scale,
    [view.scale]
  );

  const allBoxes = useMemo(() => boxesOfCards(livePositions), [livePositions]);

  /**
   * What "show the whole plan" means. The lanes belong in it: a plan of one card would otherwise
   * be framed as a single card and blown up to the maximum zoom, which reads as a broken screen
   * rather than as a plan.
   */
  const boardBoxes = useMemo(
    () => [...layout.lanes.map((lane) => ({ id: `lane-${lane.key}`, ...lane })), ...allBoxes],
    [layout, allBoxes]
  );

  /**
   * Lane badges count what the filter shows, not what is on screen: a number that changes while
   * you scroll the board would describe the viewport, not the plan.
   */
  const laneCounts = useMemo(() => {
    const counts: Record<LaneKey, number> = { ready: 0, active: 0, blocked: 0, done: 0 };
    if (!project) return counts;
    for (const phase of project.phases) {
      if (phaseFilter !== 'all' && phase.id !== phaseFilter) continue;
      for (const task of phase.tasks) counts[laneOfStatus(task.status)] += 1;
    }
    return counts;
  }, [project, phaseFilter]);

  const cardsToDraw = useMemo(() => {
    if (!project) return [] as { task: ProjectTask; phase: ProjectPhase; box: CanvasBox }[];
    const chosen = new Set(layoutTasks.map((task) => task.id));
    const visibleRect = visibleWorldRect(view, size);
    const measured = size.width > 0 && size.height > 0;

    const cards: { task: ProjectTask; phase: ProjectPhase; box: CanvasBox }[] = [];
    for (const phase of project.phases) {
      if (phaseFilter !== 'all' && phase.id !== phaseFilter) continue;
      for (const task of phase.tasks) {
        if (!chosen.has(task.id)) continue;
        const point = livePositions[task.id];
        if (!point) continue;
        const box: CanvasBox = { id: task.id, x: point.x, y: point.y, width: CARD_WIDTH, height: CARD_HEIGHT };
        // A margin keeps cards that are almost in view mounted, so dragging one does not blink.
        if (measured && !isBoxVisible(box, visibleRect, 160)) continue;
        cards.push({ task, phase, box });
      }
    }
    return cards;
  }, [project, layoutTasks, livePositions, phaseFilter, view, size]);

  /* ---------------------------------------------------------------- measuring */

  useEffect(() => {
    const node = surfaceRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(node);
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height });
    return () => observer.disconnect();
  }, [project?.id]);

  /* --------------------------------------------------------- wheel (native) */

  useEffect(() => {
    const node = surfaceRef.current;
    if (!node) return;

    const onWheel = (event: WheelEvent) => {
      // The browser would scroll the page instead; the board owns the wheel.
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const current = viewRef.current;
      // Trackpad pinch arrives as ctrl+wheel with small deltas; the same maths serves both.
      const factor = Math.exp(-event.deltaY * 0.0015);
      applyView(zoomAtPoint(current, point, clampScale(current.scale * factor)));
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [applyView, project?.id]);

  const fitAll = useCallback(() => {
    applyView(fitView(boardBoxes, size, 56));
  }, [boardBoxes, size, applyView]);

  /**
   * Opened once per project — and again once the surface reports its real size, because the first
   * frame is drawn before anything has been measured. Framing the board with a guessed size looks
   * like a bug: the last lane is cut off on a plan that is taller than the guess.
   */
  const fittedRef = useRef<{ projectId: string | null; measured: boolean }>({ projectId: null, measured: false });
  useEffect(() => {
    if (!project || allBoxes.length === 0) return;

    const measured = size.width !== FALLBACK_SIZE.width || size.height !== FALLBACK_SIZE.height;
    const projectChanged = fittedRef.current.projectId !== project.id;
    if (!projectChanged && (fittedRef.current.measured || !measured)) return;

    fittedRef.current = { projectId: project.id, measured };
    applyView(fitView(boardBoxes, size, 56));
  }, [project, allBoxes, boardBoxes, size, applyView]);

  useEffect(() => {
    setSelectedId(null);
    setDragState(null);
    setDragging(null);
    setHoveredTaskId(null);
    setHoveredEdgeId(null);
    setPhaseFilter('all');
    setMenu(null);
    setLaneDrag(null);
  }, [project?.id]);

  /* ------------------------------------------------------------- panning */

  const capture = useCallback((node: HTMLElement, pointerId: number) => {
    try {
      node.setPointerCapture?.(pointerId);
    } catch {
      // Not every environment implements pointer capture; dragging still works without it.
    }
  }, []);

  const handleSurfacePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    setSelectedId(null);
    panPointerRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: viewRef.current
    };
    setPanning(true);
    capture(event.currentTarget, event.pointerId);
  };

  const handleSurfacePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panPointerRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    applyView({
      scale: pan.origin.scale,
      x: pan.origin.x + (event.clientX - pan.startX),
      y: pan.origin.y + (event.clientY - pan.startY)
    });
  };

  const endSurfacePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panPointerRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    panPointerRef.current = null;
    setPanning(false);
  };

  /* -------------------------------------------------------- moving a card */

  /**
   * A card is dragged from anywhere on it except its own controls.
   *
   * The first version of this board hung the drag on the header strip only, and it showed: that
   * strip is twenty pixels tall at 100% and eight at 40%, so a press in the middle of a card
   * selected it and did nothing else, and the user pressed again — several times — before landing
   * on the one strip that moved. The card itself is the handle now, a press that lands on a button
   * or a dropdown is left to that control, and a press that never moves is still just a click.
   */
  const beginCardDrag = useCallback((event: React.PointerEvent<HTMLDivElement>, taskId: string) => {
    // A press that belongs to a card must never also pan the board underneath it.
    event.stopPropagation();
    setSelectedId(taskId);

    const target = event.target as HTMLElement | null;
    if (target?.closest?.('select, button, input, textarea, a, [data-board-control]')) return;
    if (event.button !== 0) return;

    // Read through the ref: this handler is shared by every card and must not be rebuilt (and so
    // must not re-render every card) each time a card moves.
    const origin = positionsRef.current[taskId];
    if (!origin) return;

    // Keeps the grabbed point under the cursor, so the card does not jump its corner to the
    // pointer the moment the drag begins.
    const world = screenToWorld(localPoint(event.clientX, event.clientY), viewRef.current);
    cardPointerRef.current = {
      taskId,
      pointerId: event.pointerId,
      grabX: world.x - origin.x,
      grabY: world.y - origin.y,
      moved: false
    };
    setDragging(taskId);
    capture(event.currentTarget, event.pointerId);

    /*
     * The drag is driven from window listeners rather than from the card.
     *
     * A card is a small thing to stay inside: drag across the board and the pointer leaves it, drag
     * past a lane and it leaves the board entirely. Pointer capture is meant to cover exactly that,
     * but it was called inside a `try`/`catch` that swallowed the failure — and with no capture the
     * drag stopped the moment the cursor left the card. Two listeners on `window` cost nothing and
     * keep the card on the pointer wherever it goes, including out of the window.
     *
     * They are attached here rather than in an effect on purpose: an effect runs after the render
     * that follows this press, and a fast flick can deliver its first move before that — which is a
     * move the card would have ignored.
     */
    const move = (native: PointerEvent) => {
      const drag = cardPointerRef.current;
      if (!drag || drag.pointerId !== native.pointerId) return;

      const point = screenToWorld(localPoint(native.clientX, native.clientY), viewRef.current);
      const position = { x: point.x - drag.grabX, y: point.y - drag.grabY };

      // A press that has not moved is a click, and a click must not rewrite a position.
      if (!drag.moved) {
        const start = positionsRef.current[drag.taskId];
        if (start && Math.abs(position.x - start.x) < 2 && Math.abs(position.y - start.y) < 2) return;
        drag.moved = true;
      }
      drag.position = position;
      setDragState({ taskId: drag.taskId, position });
    };

    const finish = (native: PointerEvent) => {
      detachRef.current();

      const drag = cardPointerRef.current;
      if (!drag || drag.pointerId !== native.pointerId) return;
      cardPointerRef.current = null;

      // A click only selects; a real move is what gets written to the project.
      if (drag.moved && drag.position) updatePositionsRef.current({ [drag.taskId]: drag.position });
      setDragState(null);
      setDragging(null);
    };

    attachDrag(move, finish);
  }, [attachDrag, capture, localPoint]);

  /* ----------------------------------------------------------- moving a lane */

  /**
   * Writes one lane's change. The board draws from the whole map, so a change to one lane is written
   * as that map with the one lane replaced — and `null` means "put it back the way it was".
   *
   * `positions` is for the one gesture that changes cards as well as the zone: the cards lying on a
   * zone being moved. They go out with the lanes in a single call, because a project update is built
   * from the project as it was when the gesture began.
   */
  const saveLane = useCallback(
    (key: string, change: CanvasLaneSkin | null, positions?: Record<string, CanvasPoint>) => {
      if (!onUpdateCanvasLanes) return;
      const next: Record<string, CanvasLaneSkin> = { ...laneSkins };
      if (!change) delete next[key];
      else next[key] = { ...(laneSkins[key] || {}), ...change };
      onUpdateCanvasLanes(next, positions);
    },
    [laneSkins, onUpdateCanvasLanes]
  );

  /**
   * A zone is dragged by its handle — or by any empty part of the plate — and it takes its cards
   * with it.
   *
   * The lane is a zone of the board rather than a column of a table, so where it sits is the user's
   * decision — and the cards the board laid out inside it are part of that zone. Only the cards
   * somebody has placed by hand stay where they were put: those are the cards the user is telling the
   * board something about, and a lane moving must not quietly overrule that.
   *
   * The drag works in screen pixels and is divided by the zoom on the way in: the lane has to follow
   * the pointer at every scale, and the board moves in world units.
   */
  const beginLaneDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, key: string) => {
      // A press on a lane's handle must never also pan the board underneath it.
      event.stopPropagation();
      setSelectedId(null);
      setMenu(null);
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('select, button, input, textarea, a, [data-board-control]')) return;
      if (event.button !== 0) return;

      const startX = event.clientX;
      const startY = event.clientY;
      const pointerId = event.pointerId;

      /*
       * Everything lying on the zone comes with it — including the cards placed by hand, which are
       * the ones that would otherwise be left standing where the zone used to be. Only those are
       * written down (see `storedPositions`); the rest follow their lane by construction.
       */
      const held = laneRectsRef.current[key];
      const cards: Record<string, CanvasPoint> = {};
      if (held) {
        for (const id of cardsOnZone(positionsRef.current, held, Object.keys(storedPositions))) {
          cards[id] = { ...positionsRef.current[id] };
        }
      }
      laneDragCardsRef.current = held ? { key, rect: { ...held }, cards } : null;

      const move = (native: PointerEvent) => {
        if (native.pointerId !== pointerId) return;
        const scale = viewRef.current.scale || 1;
        setLaneDrag({ key, dx: (native.clientX - startX) / scale, dy: (native.clientY - startY) / scale });
      };

      const finish = (native: PointerEvent) => {
        detachRef.current();
        if (native.pointerId !== pointerId) return;
        const scale = viewRef.current.scale || 1;
        const dx = (native.clientX - startX) / scale;
        const dy = (native.clientY - startY) / scale;
        setLaneDrag(null);
        const carried = laneDragCardsRef.current;
        laneDragCardsRef.current = null;
        // A press that never moved is a click on the lane's name, not a move of the lane.
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;

        const base = laneSkins[key] || {};
        const drawn = laneRectsRef.current[key];
        const index = LANE_ORDER.indexOf(key as LaneKey);
        if (!drawn || index < 0) return;

        /*
         * Where the zone ended up, not where the pointer did.
         *
         * A zone pushed into its neighbour leans against it rather than travelling the whole way, so
         * the stored place is the one the user watched land — the drawn position and the saved one
         * are the same number, and a reload puts the zone back exactly where it was left. The
         * position is settled again here from the pointer's own distance, so a release that arrives
         * before the last frame was drawn cannot store a position one move out of date.
         */
        const resting = laneRestOrigin(index);
        const others = Object.entries(laneRectsRef.current)
          .filter(([otherKey]) => otherKey !== key)
          .map(([, rect]) => rect);
        const landed = separateRect(
          {
            x: resting.x + (base.offsetX || 0) + dx,
            y: resting.y + (base.offsetY || 0) + dy,
            width: drawn.width,
            height: drawn.height
          },
          others
        );

        const nextOffsetX = Math.round(landed.x - resting.x);
        const nextOffsetY = Math.round(landed.y - resting.y);

        /*
         * The cards in the zone move by the same distance the zone is stored as having moved.
         *
         * Not by the distance the pointer travelled, and not by the difference of two rounded
         * rectangles either: the step is the rounded step of the zone itself, so a card keeps its
         * place inside the zone however many times it is dragged, instead of drifting a pixel each
         * time two roundings disagree.
         */
        const stepX = nextOffsetX - (base.offsetX || 0);
        const stepY = nextOffsetY - (base.offsetY || 0);
        let carriedPositions: Record<string, CanvasPoint> | undefined;
        if (carried && Object.keys(carried.cards).length > 0 && (stepX !== 0 || stepY !== 0)) {
          carriedPositions = {};
          for (const [id, start] of Object.entries(carried.cards)) {
            carriedPositions[id] = { x: start.x + stepX, y: start.y + stepY };
          }
        }

        // One gesture, one write: the zone and the cards it carried are stored together, so neither
        // can be applied from a snapshot that does not have the other in it.
        saveLane(key, { offsetX: nextOffsetX, offsetY: nextOffsetY }, carriedPositions);
      };

      attachDrag(move, finish);
    },
    [attachDrag, laneSkins, saveLane, storedPositions]
  );

  /**
   * A zone is stretched by its own edges: wider by the right edge, deeper by the bottom one, both at
   * once by the corner.
   *
   * Two things make this feel like a zone rather than a box being resized. The size follows the
   * pointer in world units, so it grows by the same amount at every zoom; and it stops at the edge of
   * the zone next to it, exactly as moving one does — a zone leans against its neighbour whichever
   * way it is pushed. Only the axes the grip belongs to are written on release: stretching a zone
   * wider must not also pin the height it happened to have at that moment.
   */
  const beginLaneResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, key: string, axes: { x: boolean; y: boolean }) => {
      event.stopPropagation();
      if (event.button !== 0) return;
      setSelectedId(null);
      setMenu(null);

      const from = laneRectsRef.current[key];
      if (!from) return;

      const startX = event.clientX;
      const startY = event.clientY;
      const pointerId = event.pointerId;
      const others = Object.entries(laneRectsRef.current)
        .filter(([otherKey]) => otherKey !== key)
        .map(([, rect]) => rect);

      const measure = (native: PointerEvent) => {
        const scale = viewRef.current.scale || 1;
        return clampLaneSize(
          {
            x: from.x,
            y: from.y,
            width: from.width + (axes.x ? (native.clientX - startX) / scale : 0),
            height: from.height + (axes.y ? (native.clientY - startY) / scale : 0)
          },
          others
        );
      };

      const move = (native: PointerEvent) => {
        if (native.pointerId !== pointerId) return;
        setLaneResize({ key, ...measure(native) });
      };

      const finish = (native: PointerEvent) => {
        detachRef.current();
        if (native.pointerId !== pointerId) return;
        setLaneResize(null);
        const size = measure(native);
        const same = (!axes.x || size.width === Math.round(from.width)) && (!axes.y || size.height === Math.round(from.height));
        if (same) return;
        saveLane(key, {
          ...(axes.x ? { width: size.width } : {}),
          ...(axes.y ? { height: size.height } : {})
        });
      };

      attachDrag(move, finish);
    },
    [attachDrag, saveLane]
  );

  /* ------------------------------------------------------- the right-click menu */

  /** Right-click on a lane: rename it, recolour it, or put it back the way it was. */
  const openLaneMenu = useCallback(
    (event: React.MouseEvent, key: LaneKey, label: string, stored: CanvasLaneSkin) => {
      event.preventDefault();
      // The lane is inside nothing that wants a right-click, but a lane that fires and then lets its
      // own board open a menu under it would leave two menus fighting over one pointer.
      event.stopPropagation();
      setMenu({
        x: event.clientX,
        y: event.clientY,
        lane: {
          key,
          label,
          color: laneColorOf(key, stored.color),
          // A zone that was stretched is a zone the user changed, even if they never renamed it or
          // moved it: "put it back" has a size to undo as well.
          custom: Boolean(
            (stored.label || '').trim() ||
              stored.color ||
              stored.offsetX ||
              stored.offsetY ||
              stored.width ||
              stored.height
          )
        }
      });
    },
    []
  );

  /**
   * Right-click on a card: its name is the task's name, and this is where it is changed.
   *
   * Stable on purpose: a new function on every render would break the memo that keeps a drag from
   * re-rendering twenty cards, and the only thing it does is open a menu.
   */
  const openTaskMenu = useCallback((event: React.MouseEvent, task: ProjectTask) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, task: { id: task.id, title: task.title } });
  }, []);

  /**
   * Which card the pointer is over — and, while a drag is running, nothing: the links of the card
   * in the hand are the ones being read, and a hover that changed on every crossing would make
   * them flicker.
   */
  const handleCardHover = useCallback((taskId: string, hovering: boolean) => {
    if (draggingRef.current) return;
    setHoveredTaskId((current) => (hovering ? taskId : current === taskId ? null : current));
  }, []);

  /** A drag that is interrupted — a project switch, an unmount — must not leave the card stuck. */
  useEffect(() => {
    return () => {
      detachRef.current();
      cardPointerRef.current = null;
    };
  }, []);

  /* ------------------------------------------------------------- controls */

  const zoomByStep = (direction: 1 | -1) => {
    applyView(zoomAtPoint(viewRef.current, { x: size.width / 2, y: size.height / 2 }, nextZoom(view.scale, direction)));
  };

  /**
   * "Arrange into lanes" is the plan tidying itself up: every card goes back inside the zone its
   * status belongs to.
   *
   * The zones go to the user, not to the board: the layout is laid out from the placements the user
   * made, the same map the board is drawn from. Laid out from an empty map instead, every card would
   * be put at its lane's resting place while the zones stayed where they had been dragged to — cards
   * standing under nobody's zone, which is how a button that tidies a plan read as one that scatters
   * it. A card belongs in the lane it is drawn in, and that is the lane the button has to use.
   *
   * The view is fitted to the zones rather than to the cards: the cards sit inside their zones, so
   * fitting the cards alone pushes the bottom of every lane off the screen as the view lands.
   */
  const handleArrange = () => {
    const arrangement = laneLayout(layoutTasks, lanePlacements);
    if (Object.keys(arrangement.positions).length === 0) return;
    onUpdateTaskPositions(arrangement.positions);
    const zones = arrangement.lanes.map((lane) => ({
      id: lane.key,
      x: lane.x,
      y: lane.y,
      width: lane.width,
      height: lane.height
    }));
    applyView(fitView(zones, size, 56));
  };

  const handleMinimapPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const map = minimapTransform(mapBounds, MINIMAP);
    const world = map.toWorld({ x: event.clientX - box.left, y: event.clientY - box.top });
    applyView({
      scale: viewRef.current.scale,
      x: size.width / 2 - world.x * viewRef.current.scale,
      y: size.height / 2 - world.y * viewRef.current.scale
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = 80;
    switch (event.key) {
      case '+':
      case '=':
        zoomByStep(1);
        break;
      case '-':
        zoomByStep(-1);
        break;
      case '0':
        applyView({ x: size.width / 2, y: size.height / 2, scale: 1 });
        break;
      case 'f':
      case 'F':
        fitAll();
        break;
      case 'Escape':
        setSelectedId(null);
        break;
      case 'ArrowLeft':
        applyView({ ...view, x: view.x + step });
        break;
      case 'ArrowRight':
        applyView({ ...view, x: view.x - step });
        break;
      case 'ArrowUp':
        applyView({ ...view, y: view.y + step });
        break;
      case 'ArrowDown':
        applyView({ ...view, y: view.y - step });
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  /* ------------------------------------------------------------- rendering */

  const mapBounds = useMemo(() => {
    const union = visibleWorldRect(view, size);
    const boxes = [...boardBoxes];
    if (boxes.length === 0) return union;
    const minX = Math.min(union.x, ...boxes.map((box) => box.x));
    const minY = Math.min(union.y, ...boxes.map((box) => box.y));
    const maxX = Math.max(union.x + union.width, ...boxes.map((box) => box.x + box.width));
    const maxY = Math.max(union.y + union.height, ...boxes.map((box) => box.y + box.height));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }, [boardBoxes, view, size]);

  const minimap = useMemo(() => minimapTransform(mapBounds, MINIMAP), [mapBounds]);

  if (!project) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 short:p-5 text-center space-y-4 max-w-lg mx-auto my-12 short:my-2">
        <div className="w-12 h-12 rounded-2xl bg-indigo-950 text-indigo-400 border border-indigo-800 flex items-center justify-center mx-auto">
          <Layers className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-white">{t.common.noProjectSelected}</h3>
        <p className="text-xs text-slate-400">{t.common.noProjectSubtext}</p>
        {onOpenNewProjectModal && (
          <button
            onClick={onOpenNewProjectModal}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all cursor-pointer inline-flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            <span>{t.common.newProject}</span>
          </button>
        )}
      </div>
    );
  }

  const activePhase = project.phases.find((phase) => phase.id === phaseFilter) || project.phases[0];
  const taskCount = project.phases.reduce((total, phase) => total + phase.tasks.length, 0);
  const viewportBox = visibleWorldRect(view, size);
  /*
   * The grid: two crossfaded levels of dots, painted in screen pixels so a dot keeps its size at
   * every zoom while its spacing still follows the zoom smoothly. Both layers share the world
   * origin, which is what keeps the dots from sliding under the cards.
   */
  const grid = gridLevels(view.scale);
  const gridImage = grid
    .map((layer) => `radial-gradient(circle, rgba(148,163,184,${(GRID_INK * layer.alpha).toFixed(3)}) ${layer.radius}px, transparent ${layer.radius}px)`)
    .join(', ');
  const gridSize = grid.map((layer) => `${(layer.step * view.scale).toFixed(2)}px ${(layer.step * view.scale).toFixed(2)}px`).join(', ');
  const gridPosition = grid.map(() => `${view.x}px ${view.y}px`).join(', ');

  return (
    // The screen is a column: the header takes what it needs and the board takes the rest, so the
    // board is the size of the window instead of the size of a guess. The gaps are deliberately
    // tight — every pixel between the two cards is a pixel the board does not get.
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/*
       * The row of controls, with no heading above it and no box around it.
       *
       * The panel used to open with an <h2> reading "План разработки и задачи", over an eyebrow that
       * said the same, over a paragraph explaining the canvas. All three said what the screen already
       * says elsewhere — the sidebar's "План и задачи", the project in the top bar, the plan under
       * them — and cost two lines of height above a board whose whole point is the room it gives the
       * plan. What is left is the actions, one height of control (h-9), one corner radius, and a
       * single accent — the AI action — with everything else neutral. The frame the row used to sit
       * in went the same way: it drew a box between the board and the top of the window and nothing
       * else.
       *
       * The row wraps on its own width rather than on a breakpoint: the controls drop to their own
       * line exactly when they genuinely do not fit.
       */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        {/* The controls keep the order they act in: view, filter, then what changes the plan. */}
        <div className="flex flex-wrap items-center gap-2">
          {onSwitchToKanban && (
            <div className="flex items-center gap-0.5 rounded-lg border border-slate-800 bg-slate-950 p-0.5">
              <span className="flex h-8 items-center gap-1.5 rounded-md bg-slate-800 px-3 text-xs font-semibold text-white">
                <Rows3 className="w-3.5 h-3.5" />
                {t.plan.viewCanvas}
              </span>
              <button
                onClick={onSwitchToKanban}
                className="flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-slate-400 transition-colors hover:text-slate-100 cursor-pointer"
              >
                <Columns3 className="w-3.5 h-3.5" />
                {t.plan.viewKanban}
              </button>
            </div>
          )}

          {/* The options name the phase themselves, so the field needs no label of its own. */}
          <select
            value={phaseFilter}
            onChange={(event) => setPhaseFilter(event.target.value)}
            aria-label={t.plan.phase}
            className="h-9 rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs font-medium text-slate-300 transition-colors hover:border-slate-700 focus:border-indigo-500 cursor-pointer"
          >
            <option value="all" className="bg-slate-900 text-slate-200">
              {t.plan.allPhases} ({taskCount} {t.plan.tasksCount})
            </option>
            {project.phases.map((phase) => (
              <option key={phase.id} value={phase.id} className="bg-slate-900 text-slate-200">
                {language === 'ru' ? 'Этап' : 'Phase'} {phase.phaseNumber}: {phase.title}
              </option>
            ))}
          </select>

          <button
            onClick={handleArrange}
            title={t.plan.arrangeHint}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white cursor-pointer"
          >
            <Rows3 className="w-4 h-4" />
            <span>{t.plan.arrange}</span>
          </button>

          {onAdaptProjectPhases && (
            <button
              onClick={() => setAdaptOpen(true)}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-500 cursor-pointer"
            >
              <Bot className="w-4 h-4" />
              <span>{t.plan.adaptPlanButton}</span>
            </button>
          )}

          <button
            onClick={() => setAddTaskOpen(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-slate-800 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-slate-700 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{t.plan.addTaskButton}</span>
          </button>
        </div>
      </div>

      {/* A dependency that points at nothing is a plan-level problem, and silently drawing no line
          would hide it: the reader would think the task simply has no dependencies. */}
      {dependency.unresolved.length > 0 && (
        <div
          data-testid="plan-links-missing"
          className="flex items-start gap-2 bg-amber-950/30 border border-amber-900/60 rounded-xl px-3 py-2 text-[11px] text-amber-200"
        >
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            {t.plan.linksMissing} <span className="font-mono">{dependency.unresolved.join(', ')}</span>
          </span>
        </div>
      )}

      {/*
       * The board itself. It is given the room that is left in the window rather than a height
       * guessed from the viewport: `clamp(420px, calc(100vh - 320px), 940px)` was a guess that ran
       * out on a tall window and left a band of empty slate under a board that could have used it.
       * The floor stays, so a short window scrolls instead of shrinking the board to nothing.
       */}
      <div className="relative flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
        <div
          ref={surfaceRef}
          tabIndex={0}
          role="application"
          aria-label={t.plan.canvasTitle}
          data-testid="plan-canvas"
          onPointerDown={handleSurfacePointerDown}
          onPointerMove={handleSurfacePointerMove}
          onPointerUp={endSurfacePointer}
          onPointerCancel={endSurfacePointer}
          onKeyDown={handleKeyDown}
          style={{
            cursor: panning ? 'grabbing' : 'grab',
            backgroundImage: gridImage,
            backgroundSize: gridSize,
            backgroundPosition: gridPosition
          }}
          className="relative min-h-0 w-full flex-1 touch-none select-none"
        >
          <div
            data-testid="plan-canvas-world"
            className="absolute left-0 top-0 origin-top-left"
            style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}
          >
            {/*
             * Status lanes stay on the board: they are the meaning a free canvas otherwise loses.
             * They are the user's zones now — the name, the colour and the place are theirs to
             * change (right-click, or drag the header) — while the status a lane holds is still the
             * plan's, because that is what its cards are.
             */}
            {layout.lanes.map((lane) => {
              const key = lane.key as LaneKey;
              const stored = laneSkins[key] || {};
              const skin = laneSkinOf(key, stored.color);
              const named = (stored.label || '').trim();
              const custom = Boolean(
                named || stored.color || stored.offsetX || stored.offsetY || stored.width || stored.height
              );
              const held = laneDrag?.key === key;
              const stretched = laneResize?.key === key;

              return (
                <div
                  key={key}
                  data-testid={`plan-lane-${key}`}
                  data-lane-custom={custom ? 'true' : undefined}
                  data-lane-dragging={held ? 'true' : undefined}
                  data-lane-stretching={stretched ? 'true' : undefined}
                  className={`absolute touch-none rounded-2xl border border-dashed ${skin.ring} ${skin.fill} shadow-[0_24px_50px_-30px_rgba(2,6,23,0.95)] ${
                    held ? 'cursor-grabbing' : 'cursor-grab'
                  } ${held || stretched ? 'z-20' : ''}`}
                  style={{ left: lane.x, top: lane.y, width: lane.width, height: lane.height }}
                  title={t.plan.laneHandle}
                  onContextMenu={(event) =>
                    openLaneMenu(event, key, named || t.plan[LANE_LABEL_KEY[key]], stored)
                  }
                  /*
                   * The whole zone is a handle. The empty space under and around the cards was the
                   * one part of a zone that answered nothing: a zone could only be picked up by its
                   * 56px strip, so moving one meant finding that strip first — while the rest of the
                   * plate, which looks like the same thing, did not move it at all.
                   *
                   * The cards stand *over* the zone rather than inside it, so a press on a card is
                   * the card's own and never reaches the zone under it: a card is dragged by its
                   * body, a zone moves when the press lands on the zone itself. The header and the
                   * three grips stop the press before it arrives here, so dragging by the handle and
                   * stretching by the edges are unchanged — and a press that misses everything still
                   * does not pan the board under the pointer, which is what it used to do.
                   */
                  onPointerDown={(event) => beginLaneDrag(event, key)}
                >
                  {/* The zone's own colour, fading out inside the handle. */}
                  <div
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-x-0 top-0 rounded-t-2xl bg-gradient-to-b ${skin.tint} to-transparent`}
                    style={{ height: LANE_HEADER * 1.6 }}
                  />

                  {                  /*
                   * The handle: a strip that says the zone can be picked up. It is a plate of its own
                   * — darker than the zone under it, closed by a line — so that "drag it here" is
                   * something the user can see rather than something they are told. It is not the only
                   * thing that can be: the body below it is a handle too (see above), and this is the
                   * part that names the zone, counts its cards and says what holding it does.
                   */}
                  <div
                    data-testid={`plan-lane-header-${key}`}
                    onPointerDown={(event) => beginLaneDrag(event, key)}
                    title={t.plan.laneHandle}
                    style={{ height: LANE_HEADER }}
                    className={`relative flex items-center justify-between gap-3 rounded-t-2xl border-b border-white/[0.07] bg-slate-950/45 px-4 touch-none ${
                      held ? 'cursor-grabbing bg-slate-950/65' : 'cursor-grab hover:bg-slate-950/65'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${skin.dot}`} />
                      <span className={`text-[11px] font-bold uppercase tracking-wider truncate ${skin.text}`}>
                        {named || t.plan[LANE_LABEL_KEY[key]]}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-400">{laneCounts[key]}</span>
                      <span aria-hidden="true" className="flex flex-col items-center gap-[3px]">
                        <span className={`h-[2px] w-4 rounded-full ${held ? 'bg-slate-300' : 'bg-slate-600'}`} />
                        <span className={`h-[2px] w-4 rounded-full ${held ? 'bg-slate-300' : 'bg-slate-600'}`} />
                      </span>
                    </div>
                  </div>

                  {laneCounts[key] === 0 && (
                    <div className="pointer-events-none px-4 pt-3 text-[10px] text-slate-400">
                      {t.plan.emptyLane}
                    </div>
                  )}

                  {/*
                   * The three grips. They are invisible surfaces over the edges of the zone — the
                   * corner one carries a small bracket so it can be found without a tooltip — and
                   * each of them stops at the next zone instead of overlapping it.
                   */}
                  <div
                    data-testid={`plan-lane-resize-x-${key}`}
                    onPointerDown={(event) => beginLaneResize(event, key, { x: true, y: false })}
                    title={t.plan.laneResize}
                    className="absolute right-0 w-2.5 cursor-ew-resize touch-none"
                    style={{ top: LANE_HEADER, bottom: 24 }}
                  />
                  <div
                    data-testid={`plan-lane-resize-y-${key}`}
                    onPointerDown={(event) => beginLaneResize(event, key, { x: false, y: true })}
                    title={t.plan.laneResize}
                    className="absolute bottom-0 left-4 right-2.5 h-2.5 cursor-ns-resize touch-none"
                  />
                  <div
                    data-testid={`plan-lane-resize-xy-${key}`}
                    onPointerDown={(event) => beginLaneResize(event, key, { x: true, y: true })}
                    title={t.plan.laneResize}
                    className="absolute bottom-0 right-0 flex h-5 w-5 cursor-nwse-resize items-end justify-end p-0.5 touch-none"
                  >
                    <span aria-hidden="true" className="h-2.5 w-2.5 rounded-br-[6px] border-b-2 border-r-2 border-slate-500" />
                  </div>
                </div>
              );
            })}

            {edgeLayer && (
              <svg
                data-testid="plan-links"
                width={edgeLayer.width}
                height={edgeLayer.height}
                style={{ position: 'absolute', left: edgeLayer.x, top: edgeLayer.y, overflow: 'visible', pointerEvents: 'none' }}
              >
                <g transform={`translate(${-edgeLayer.x}, ${-edgeLayer.y})`}>
                  <defs>
                    {(Object.keys(LINK_SKIN) as EdgeState[]).map((state) => (
                      <marker
                        key={state}
                        id={`plan-link-arrow-${state}`}
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerWidth="4.4"
                        markerHeight="4.4"
                        /*
                         * The head is measured in stroke widths, and the stroke follows the zoom —
                         * so the arrow grows and shrinks *with* the line instead of staying a
                         * full-size arrow on a board that has been zoomed out to a diagram. It is
                         * deliberately slimmer than it is long: a triangle as wide as it is long
                         * reads as a blob once a dozen of them share a screen.
                         */
                        markerUnits="strokeWidth"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 1.4 L 10 5 L 0 8.6 z" fill={LINK_SKIN[state].color} />
                      </marker>
                    ))}
                  </defs>

                  {drawnEdges.edges.map(({ edge, path }) => {
                    const skin = LINK_SKIN[edge.state];
                    const width = linkWidth(skin.width);
                    const focused = hoveredEdgeId === edge.id;
                    const muted = mutedEdges.has(edge.id);
                    /*
                     * The line follows the zoom, so the graph shrinks with the board instead of
                     * turning into a frame of full-size arrows around a shrunken plan. What does not
                     * scale is the dark underlay, whose whole job is to keep a 1px line visible on a
                     * dark board. The caps stay round and the muted links fade rather than vanish, so
                     * the graph is still readable while one dependency is being followed.
                     */
                    const opacity = muted ? DIMMED_LINK : skin.opacity;
                    const fade = { opacity, transition: 'opacity 140ms linear' };
                    // Everything that is measured in screen pixels has to be divided by the zoom: the
                    // layer itself is scaled by it, so a `dash` of 6 would otherwise be 6 * zoom px.
                    const dash = skin.dash
                      ? skin.dash
                          .split(' ')
                          .map((step) =>
                            (Number(step) * linkScale(view.scale, skin.width) / view.scale).toFixed(2)
                          )
                          .join(' ')
                      : undefined;

                    return (
                      <g key={edge.id} data-edge={edge.id}>
                        {/*
                         * The line is drawn twice: a dark, wider copy underneath and the coloured
                         * line on top of it. That underlay is what separates a link from the dot
                         * grid and from the lane it crosses — without it the line reads as part of
                         * the background exactly where the plan is busiest.
                         */}
                        <path
                          data-testid={`plan-link-halo-${edge.fromId}-${edge.toId}`}
                          d={path.d}
                          fill="none"
                          stroke="#020617"
                          strokeOpacity={muted ? 0.35 : 0.9}
                          strokeWidth={width + 3.4 / view.scale}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={fade}
                        />
                        <path
                          data-testid={`plan-link-${edge.fromId}-${edge.toId}`}
                          data-link-state={edge.state}
                          data-link-muted={muted ? 'true' : undefined}
                          d={path.d}
                          fill="none"
                          stroke={skin.color}
                          strokeWidth={focused ? width * 1.7 : width}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeDasharray={dash}
                          // A link that turns onto a shared trunk carries no arrowhead of its own: the
                          // trunk is what meets the card, and it carries the one the input has.
                          markerEnd={path.merged ? undefined : `url(#plan-link-arrow-${edge.state})`}
                          style={fade}
                        >
                          <title>
                            {language === 'ru'
                              ? `«${edge.toTitle}» — ${t.plan[LINK_LABEL_KEY[edge.state]]} («${edge.fromTitle}»)`
                              : `“${edge.toTitle}” — ${t.plan[LINK_LABEL_KEY[edge.state]]} (“${edge.fromTitle}”)`}
                          </title>
                        </path>

                        {/*
                         * A port mark on each end. A line that simply stops at a card border reads
                         * as clipped; a dot on the border reads as "attached here", which is what
                         * tells the reader which side of the card the dependency is coming from —
                         * the part that matters when a card carries more than one.
                         */}
                        {(path.merged ? [path.from] : [path.from, path.to]).map((port, index) => (
                          <circle
                            key={index}
                            data-anchor={index === 0 ? 'from' : 'to'}
                            cx={port.x}
                            cy={port.y}
                            r={(3 * linkScale(view.scale, skin.width)) / view.scale}
                            fill="#020617"
                            stroke={skin.color}
                            strokeWidth={(1.6 * linkScale(view.scale, skin.width)) / view.scale}
                            style={fade}
                          />
                        ))}

                        {/*
                         * A wide, invisible copy of the same curve: a 2px line is impossible to
                         * point at, and `pointer-events` is switched back on for this one only,
                         * because the layer as a whole must stay out of the way of the cards.
                         */}
                        <path
                          data-testid={`plan-link-hit-${edge.fromId}-${edge.toId}`}
                          d={path.d}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={Math.max(16, width * 8) / view.scale}
                          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                          onPointerEnter={() => setHoveredEdgeId(edge.id)}
                          onPointerLeave={() =>
                            setHoveredEdgeId((current) => (current === edge.id ? null : current))
                          }
                        />
                      </g>
                    );
                  })}

                  {/*
                   * The shared inputs. A card that three tasks feed has one input, so the three
                   * lines merge onto one stem and one arrowhead meets the card — several arrows
                   * landing side by side on one border is what makes a fan-in look drawn by hand.
                   */}
                  {drawnTrunks.map(({ trunk, muted, focused }) => {
                    const skin = LINK_SKIN[trunk.state];
                    const width = linkWidth(skin.width);
                    const opacity = muted ? DIMMED_LINK : skin.opacity;
                    return (
                      <g key={trunk.id} data-trunk={trunk.id} data-link-state={trunk.state}>
                        <path
                          data-testid={`plan-trunk-halo-${trunk.toId}-${trunk.toSide}`}
                          d={trunk.d}
                          fill="none"
                          stroke="#020617"
                          strokeOpacity={muted ? 0.35 : 0.9}
                          strokeWidth={width + 3.4 / view.scale}
                          strokeLinecap="round"
                          style={{ opacity: 1, transition: 'opacity 140ms linear' }}
                        />
                        <path
                          data-testid={`plan-trunk-${trunk.toId}-${trunk.toSide}`}
                          d={trunk.d}
                          fill="none"
                          stroke={skin.color}
                          strokeWidth={focused ? width * 1.7 : width}
                          strokeLinecap="round"
                          markerEnd={`url(#plan-link-arrow-${trunk.state})`}
                          style={{ opacity, transition: 'opacity 140ms linear' }}
                        >
                          <title>
                            {language === 'ru'
                              ? `${trunk.members.length} зависимостей входят в одну задачу`
                              : `${trunk.members.length} dependencies enter one task`}
                          </title>
                        </path>
                        <circle
                          data-testid={`plan-trunk-port-${trunk.toId}-${trunk.toSide}`}
                          cx={trunk.port.x}
                          cy={trunk.port.y}
                          r={(3 * linkScale(view.scale, skin.width)) / view.scale}
                          fill="#020617"
                          stroke={skin.color}
                          strokeWidth={(1.6 * linkScale(view.scale, skin.width)) / view.scale}
                          style={{ opacity, transition: 'opacity 140ms linear' }}
                        />
                      </g>
                    );
                  })}
                </g>
              </svg>
            )}

            {cardsToDraw.map(({ task, phase, box }) => (
              <CanvasCard
                key={task.id}
                task={task}
                phase={phase}
                x={box.x}
                y={box.y}
                selected={selectedId === task.id}
                dragging={dragging === task.id}
                hovered={hoveredTaskId === task.id}
                compact={view.scale < COMPACT_CARD_SCALE}
                language={language}
                compileLabel={t.plan.compilePrompt}
                phaseLabel={`${t.plan.phaseOf} ${phase.phaseNumber}`}
                laneColor={laneSkins[laneOfStatus(task.status)]?.color}
                waitingCount={dependency.waitingOn[task.id] || 0}
                readyToStart={readyToStart.has(task.id)}
                onDragStart={beginCardDrag}
                onHoverChange={handleCardHover}
                onUpdateStatus={onUpdateTaskStatus}
                onCompilePrompt={onCompileTaskPrompt}
                onOpenMenu={openTaskMenu}
              />
            ))}
          </div>

          {/*
           * What the link under the pointer means, next to the link itself. A title attribute is a
           * tooltip the user has to wait for and cannot read while moving; the chip follows the
           * curve's own midpoint, so the answer arrives where the question was asked.
           */}
          {hoveredEdge &&
            (() => {
              const mid = worldToScreen(edgeMidpoint(hoveredEdge.path), view);
              const skin = LINK_SKIN[hoveredEdge.edge.state];
              return (
                <div
                  data-testid="plan-link-label"
                  data-link-state={hoveredEdge.edge.state}
                  className="absolute z-30 pointer-events-none -translate-x-1/2 -translate-y-1/2 bg-slate-900/95 border border-slate-700 rounded-lg px-2.5 py-1.5 shadow-2xl backdrop-blur max-w-[260px]"
                  style={{ left: mid.x, top: mid.y }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-0.5 rounded-full" style={{ backgroundColor: skin.color }} />
                    <span className="text-[10px] font-bold text-slate-200">
                      {t.plan[LINK_LABEL_KEY[hoveredEdge.edge.state]]}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {hoveredEdge.edge.fromTitle} → {hoveredEdge.edge.toTitle}
                  </div>
                </div>
              );
            })()}
        </div>

        {/* Board controls, in screen space so they never scale with the plan. */}
        <div className="absolute right-3 top-3 flex items-center gap-1 bg-slate-900/95 border border-slate-800 rounded-xl p-1 shadow-lg backdrop-blur">
          {dependency.edges.length > 0 && (
            <button
              onClick={() => setShowLinks((visible) => !visible)}
              title={t.plan.linksLegendTitle}
              aria-pressed={showLinks}
              data-testid="plan-links-toggle"
              className={`h-7 px-2 rounded-lg text-[11px] font-bold flex items-center gap-1.5 cursor-pointer ${
                showLinks ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              <Link2 className="w-3.5 h-3.5" />
              {t.plan.linksShow}
              <span className="tabular-nums opacity-70">{dependency.edges.length}</span>
            </button>
          )}

          <button
            onClick={() => zoomByStep(-1)}
            title={t.plan.zoomOut}
            aria-label={t.plan.zoomOut}
            className="w-7 h-7 rounded-lg text-slate-300 hover:bg-slate-800 flex items-center justify-center cursor-pointer"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            onClick={() => applyView({ x: size.width / 2, y: size.height / 2, scale: 1 })}
            title={t.plan.resetZoom}
            data-testid="canvas-zoom-readout"
            className="px-2 h-7 rounded-lg text-[11px] font-bold text-slate-300 hover:bg-slate-800 cursor-pointer tabular-nums"
          >
            {Math.round(view.scale * 100)}%
          </button>
          <button
            onClick={() => zoomByStep(1)}
            title={t.plan.zoomIn}
            aria-label={t.plan.zoomIn}
            className="w-7 h-7 rounded-lg text-slate-300 hover:bg-slate-800 flex items-center justify-center cursor-pointer"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={fitAll}
            title={t.plan.fitView}
            aria-label={t.plan.fitView}
            className="w-7 h-7 rounded-lg text-slate-300 hover:bg-slate-800 flex items-center justify-center cursor-pointer"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>

        {/* The overview: what is on the board and where the viewport sits on it. */}
        <div className="absolute left-3 bottom-3 bg-slate-900/95 border border-slate-800 rounded-xl p-2 shadow-lg backdrop-blur">
          <div className="flex items-center gap-1.5 mb-1.5 px-1">
            <MapIcon className="w-3 h-3 text-slate-400" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{t.plan.minimapTitle}</span>
          </div>
          <svg
            width={MINIMAP.width}
            height={MINIMAP.height}
            role="img"
            aria-label={t.plan.minimapHint}
            data-testid="canvas-minimap"
            className="rounded-lg bg-slate-950 cursor-pointer"
            onPointerDown={handleMinimapPointer}
            onPointerMove={(event) => {
              if (event.buttons === 1) handleMinimapPointer(event);
            }}
          >
            {boardBoxes.map((box) => {
              const point = minimap.toMap({ x: box.x, y: box.y });
              const isLane = box.id.startsWith('lane-');
              return (
                <rect
                  key={box.id}
                  x={point.x}
                  y={point.y}
                  width={Math.max(2, box.width * minimap.scale)}
                  height={Math.max(2, box.height * minimap.scale)}
                  rx={1}
                  // Lanes as the floor, cards on top of them: the map reads as the plan, not as noise.
                  className={isLane ? 'fill-slate-800' : 'fill-slate-500'}
                />
              );
            })}
            <rect
              x={minimap.toMap({ x: viewportBox.x, y: viewportBox.y }).x}
              y={minimap.toMap({ x: viewportBox.x, y: viewportBox.y }).y}
              width={Math.max(2, viewportBox.width * minimap.scale)}
              height={Math.max(2, viewportBox.height * minimap.scale)}
              rx={2}
              className="fill-indigo-500/15 stroke-indigo-400"
              strokeWidth={1}
            />
          </svg>
        </div>

        {showLinks && dependency.edges.length > 0 && (
          <div
            data-testid="plan-links-legend"
            className="absolute right-3 bottom-3 bg-slate-900/95 border border-slate-800 rounded-xl px-3 py-2 shadow-lg backdrop-blur space-y-1"
          >
            <div className="flex items-center gap-1.5">
              <Link2 className="w-3 h-3 text-slate-400" />
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                {t.plan.linksLegendTitle}
              </span>
            </div>
            {(Object.keys(LINK_SKIN) as EdgeState[]).map((state) => (
              <div key={state} className="flex items-center gap-2">
                <span
                  className="inline-block w-5 h-0.5 rounded-full"
                  style={{ backgroundColor: LINK_SKIN[state].color, opacity: LINK_SKIN[state].opacity }}
                />
                <span className="text-[10px] text-slate-400">{t.plan[LINK_LABEL_KEY[state]]}</span>
              </div>
            ))}
          </div>
        )}

        {taskCount === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-xs text-slate-400 bg-slate-900/90 border border-slate-800 rounded-xl px-4 py-3">
              {language === 'ru' ? 'В плане пока нет задач.' : 'The plan has no tasks yet.'}
            </p>
          </div>
        )}
      </div>

      {/*
       * The menu is drawn over the board and positioned from the pointer, not from the layout: a
       * fixed panel is the only way it can hang over a card at the edge of the board without being
       * clipped by the board's own rounded corner.
       */}
      {menu && (
        <PlanContextMenu
          target={menu}
          t={t}
          onRenameLane={(label) => menu.lane && saveLane(menu.lane.key, { label })}
          onColorLane={(color: LaneColor) => menu.lane && saveLane(menu.lane.key, { color })}
          onResetLane={() => menu.lane && saveLane(menu.lane.key, null)}
          onRenameTask={(title) => menu.task && onUpdateTaskTitle?.(menu.task.id, title)}
          onClose={() => setMenu(null)}
        />
      )}

      <PlanTaskDialogs
        project={project}
        targetPhaseId={activePhase?.id ?? null}
        onAddTask={onAddTask}
        onAdaptProjectPhases={onAdaptProjectPhases}
        addTaskOpen={addTaskOpen}
        onCloseAddTask={() => setAddTaskOpen(false)}
        adaptOpen={adaptOpen}
        onCloseAdapt={() => setAdaptOpen(false)}
        adaptTargetPhaseId={phaseFilter !== 'all' ? phaseFilter : undefined}
      />
    </div>
  );
};

/**
 * One card. It is a normal React card: the container's transform is the only extraordinary thing.
 *
 * Nothing inside it is hidden at any zoom. An earlier version dropped the footer — status and the
 * "compile prompt" button — below 60%, on the reasoning that the text is unreadable that small
 * anyway. It is, but the reasoning was wrong about the user: the fit-the-plan button lands on 50–85%
 * on a four-lane plan, so the button the screen exists for disappeared *while looking at the whole
 * plan*, and the board seemed to lose its controls. A card is drawn whole, always; the zoom scales
 * it, which is what a canvas is for.
 *
 * It is memoized, and every prop it gets is either a primitive, a task straight out of the project,
 * or a callback the board keeps stable. Dragging one card then re-renders that card, not the plan:
 * the pointer moves sixty times a second, and the other nineteen cards have nothing new to say.
 */
const CanvasCardBase: React.FC<{
  task: ProjectTask;
  phase: ProjectPhase;
  /** Where the card sits on the board, in world units. Numbers, not a box: `memo` compares them. */
  x: number;
  y: number;
  selected: boolean;
  dragging: boolean;
  hovered: boolean;
  /** The zoom is low enough that a label would be a smudge: the action becomes an icon. */
  compact: boolean;
  language: 'ru' | 'en';
  compileLabel: string;
  phaseLabel: string;
  /** The colour of the lane this card's status belongs to, when the user changed it. */
  laneColor?: LaneColor;
  /** How many unfinished tasks this one is waiting for. */
  waitingCount: number;
  /** True when every dependency is finished, so this is what can be picked up today. */
  readyToStart: boolean;
  onDragStart: (event: React.PointerEvent<HTMLDivElement>, taskId: string) => void;
  onHoverChange: (taskId: string, hovering: boolean) => void;
  onUpdateStatus: (taskId: string, status: TaskStatus) => void;
  onCompilePrompt: (taskTitle: string) => void;
  /** Right-click on the card: renaming the task, without leaving the board for a dialog. */
  onOpenMenu: (event: React.MouseEvent, task: ProjectTask) => void;
}> = ({
  task,
  x,
  y,
  selected,
  dragging,
  hovered,
  compact,
  language,
  compileLabel,
  phaseLabel,
  laneColor,
  waitingCount,
  readyToStart,
  onDragStart,
  onHoverChange,
  onUpdateStatus,
  onCompilePrompt,
  onOpenMenu
}) => {
  const { t } = useLanguage();
  const passed = task.acceptanceCriteria?.filter((criterion) => criterion.passed).length || 0;
  const total = task.acceptanceCriteria?.length || 0;
  const lane = laneOfStatus(task.status);
  // The stripe down the card's left edge is the lane's colour, so a recoloured lane reads the same
  // on the cards inside it as it does on the zone around them.
  const laneSkin = laneSkinOf(lane, laneColor);
  const marked = lane === 'blocked' || lane === 'done';

  return (
    <div
      data-testid={`plan-card-${task.id}`}
      data-dragging={dragging ? 'true' : undefined}
      data-compact={compact ? 'true' : undefined}
      // The whole card is the handle: it selects and drags, while a press that lands on a control
      // inside it is left alone. `touch-none` belongs here rather than on the header so a touch
      // drag works from anywhere on the card.
      onPointerDown={(event) => onDragStart(event, task.id)}
      onPointerEnter={() => onHoverChange(task.id, true)}
      onPointerLeave={() => onHoverChange(task.id, false)}
      onContextMenu={(event) => onOpenMenu(event, task)}
      className={`absolute rounded-xl border bg-slate-950 transition-[border-color,box-shadow,transform] ${
        selected
          ? 'border-indigo-500 ring-2 ring-indigo-500/40'
          : hovered
            ? 'border-slate-600'
            : 'border-slate-800'
      } ${dragging ? 'z-30 shadow-2xl shadow-black/60' : 'z-10 shadow-lg'} ${
        marked ? `border-l-4 ${laneSkin.accent}` : ''
      }`}
      style={{
        left: x,
        top: y,
        width: CARD_WIDTH,
        minHeight: CARD_HEIGHT,
        cursor: dragging ? 'grabbing' : 'grab',
        // The lift a real board gives a card in the hand: it comes off the surface while moved.
        transform: dragging ? 'translateY(-1px)' : undefined
      }}
    >
      <div className="flex items-start gap-2 p-3 touch-none">
        <GripVertical className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <h4 className="text-xs font-bold text-slate-100 leading-snug">{task.title}</h4>
          <div className="flex items-center gap-2 mt-1.5">
            <span className={`w-2 h-2 rounded-full ${STATUS_DOT[task.status] || 'bg-slate-500'}`} />
            <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">{phaseLabel}</span>
            <span className="text-[9px] font-medium text-slate-400 truncate">
              {localizeText(task.estimatedComplexity, language)}
            </span>
          </div>

          {(waitingCount > 0 || readyToStart) && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              {waitingCount > 0 && (
                <span className="text-[9px] font-semibold text-amber-300 bg-amber-950/40 border border-amber-900/60 rounded px-1.5 py-0.5">
                  {t.plan.waitsBadge} {waitingCount}
                </span>
              )}
              {readyToStart && (
                <span className="text-[9px] font-semibold text-emerald-300 bg-emerald-950/40 border border-emerald-900/60 rounded px-1.5 py-0.5">
                  {t.plan.linkReady}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="px-3 pb-3 space-y-2.5">
        <p className="text-[11px] text-slate-400 line-clamp-3">{task.goal}</p>

        {total > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium">
              <span>{language === 'ru' ? 'Критерии' : 'Acceptance'}</span>
              <span className="tabular-nums">
                {passed}/{total}
              </span>
            </div>
            <div className="h-1 rounded-full bg-slate-800 overflow-hidden">
              <div
                className={`h-full ${passed === total ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                style={{ width: `${total === 0 ? 0 : Math.round((passed / total) * 100)}%` }}
              />
            </div>
          </div>
        )}

        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
          <select
            value={task.status}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => onUpdateStatus(task.id, event.target.value as TaskStatus)}
            className="bg-slate-900 border border-slate-800 text-slate-300 text-[10px] font-semibold rounded px-1.5 py-1 cursor-pointer min-w-0"
          >
            <option value="ready">{language === 'ru' ? 'Готово к работе' : 'Ready'}</option>
            <option value="in_progress">{language === 'ru' ? 'В работе' : 'In Progress'}</option>
            <option value="review">{language === 'ru' ? 'На проверке' : 'In Review'}</option>
            <option value="completed">{language === 'ru' ? 'Завершено' : 'Completed'}</option>
            <option value="blocked">{language === 'ru' ? 'Заблокировано' : 'Blocked'}</option>
          </select>

          {/*
           * The one control the board exists for, and it is the one that used to vanish: at the
           * fit-the-plan zoom the label is four pixels tall, so the button read as gone. Below the
           * point where a label could still be read it keeps its colour and turns into a square
           * icon button — a target the size of a toolbar button rather than a smudge, and one that
           * still says what it does on hover.
           */}
          <button
            data-testid={`plan-compile-${task.id}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onCompilePrompt(task.title)}
            title={compileLabel}
            aria-label={compileLabel}
            className={`bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-md transition-all flex items-center justify-center gap-1 cursor-pointer shrink-0 ${
              compact
                ? 'w-11 h-11 shadow-lg shadow-indigo-950/60'
                : 'text-[10px] px-2 py-1'
            }`}
          >
            <Sparkles className={compact ? 'w-5 h-5' : 'w-3 h-3'} />
            {!compact && <span>{compileLabel}</span>}
          </button>
        </div>
      </div>
    </div>
  );
};

const CanvasCard = React.memo(CanvasCardBase);
