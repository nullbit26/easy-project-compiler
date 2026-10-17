import { describe, it, expect } from 'vitest';

import {
  CARD_HEIGHT,
  CARD_WIDTH,
  GRID_BASE,
  GRID_MAX_PX,
  GRID_MIN_PX,
  GRID_TARGET_PX,
  LANE_MIN_HEIGHT,
  LANE_MIN_WIDTH,
  LANE_STRIDE,
  LaneBand,
  MAX_SCALE,
  MIN_SCALE,
  boundsOfBoxes,
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
  settleLaneRects,
  visibleWorldRect,
  worldToScreen,
  zoomAtPoint
} from '../utils/canvasView';

/**
 * The board's arithmetic. Every one of these is a bug that a screenshot cannot catch: a canvas
 * that drifts away from the cursor looks fine until you are the one holding the wheel.
 */

describe('Zooming an infinite canvas', () => {
  it('1. keeps the world point under the cursor fixed while zooming in and out', () => {
    const view = { x: 120, y: -40, scale: 1 };
    const cursor = { x: 640, y: 300 };
    const before = screenToWorld(cursor, view);

    const zoomedIn = zoomAtPoint(view, cursor, 2.4);
    const afterIn = screenToWorld(cursor, zoomedIn);
    expect(afterIn.x).toBeCloseTo(before.x, 9);
    expect(afterIn.y).toBeCloseTo(before.y, 9);

    const zoomedOut = zoomAtPoint(zoomedIn, cursor, 0.35);
    const afterOut = screenToWorld(cursor, zoomedOut);
    expect(afterOut.x).toBeCloseTo(before.x, 9);
    expect(afterOut.y).toBeCloseTo(before.y, 9);
  });

  it('2. refuses a scale outside the sane range, and a broken one outright', () => {
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(clampScale(0.0001)).toBe(MIN_SCALE);
    expect(clampScale(Number.NaN)).toBe(1);
    expect(clampScale(0)).toBe(1);
  });

  it('3. walks the zoom ladder instead of accumulating odd values', () => {
    expect(nextZoom(1, 1)).toBe(1.25);
    expect(nextZoom(1, -1)).toBe(0.8);
    expect(nextZoom(MAX_SCALE, 1)).toBe(MAX_SCALE);
    expect(nextZoom(MIN_SCALE, -1)).toBe(MIN_SCALE);

    // Repeated clicks must be idempotent at the ends, never returning NaN or going past them.
    let scale = 1;
    for (let i = 0; i < 20; i += 1) scale = nextZoom(scale, 1);
    expect(scale).toBe(MAX_SCALE);
    for (let i = 0; i < 30; i += 1) scale = nextZoom(scale, -1);
    expect(scale).toBe(MIN_SCALE);
  });

  it('4. reports the world rectangle that is actually on screen', () => {
    const rect = visibleWorldRect({ x: -100, y: -200, scale: 2 }, { width: 800, height: 600 });
    expect(rect).toEqual({ x: 50, y: 100, width: 400, height: 300 });
  });
});

describe('Framing the plan', () => {
  it('5. fits every card on screen with air around them, and centres the board', () => {
    const boxes = [
      { id: 'a', x: 0, y: 0, width: 100, height: 100 },
      { id: 'b', x: 200, y: 100, width: 100, height: 100 }
    ];
    const size = { width: 800, height: 600 };
    const view = fitView(boxes, size, 48);

    for (const box of boxes) {
      const topLeft = worldToScreen({ x: box.x, y: box.y }, view);
      const bottomRight = worldToScreen({ x: box.x + box.width, y: box.y + box.height }, view);
      expect(topLeft.x).toBeGreaterThanOrEqual(-0.001);
      expect(topLeft.y).toBeGreaterThanOrEqual(-0.001);
      expect(bottomRight.x).toBeLessThanOrEqual(size.width + 0.001);
      expect(bottomRight.y).toBeLessThanOrEqual(size.height + 0.001);
    }

    const bounds = boundsOfBoxes(boxes);
    const centre = worldToScreen(
      { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      view
    );
    expect(centre.x).toBeCloseTo(size.width / 2, 6);
    expect(centre.y).toBeCloseTo(size.height / 2, 6);
  });

  it('6. leaves an empty board at 1:1 instead of dividing by nothing', () => {
    const size = { width: 900, height: 500 };
    const view = fitView([], size);
    expect(view.scale).toBe(1);
    expect(view.x).toBe(450);
    expect(view.y).toBe(250);
  });

  it('7. never zooms past the limit, even when the plan is a single small card', () => {
    const view = fitView([{ id: 'a', x: 0, y: 0, width: 10, height: 10 }], { width: 4000, height: 3000 });
    expect(view.scale).toBe(MAX_SCALE);
  });
});

describe('Deciding what to draw', () => {
  it('8. culls cards outside the viewport and keeps the touching ones', () => {
    const view = { x: 0, y: 0, scale: 1 };
    const rect = visibleWorldRect(view, { width: 800, height: 600 });

    expect(isBoxVisible({ id: 'far', x: 5000, y: 5000, width: CARD_WIDTH, height: CARD_HEIGHT }, rect)).toBe(false);
    expect(isBoxVisible({ id: 'near', x: 100, y: 100, width: CARD_WIDTH, height: CARD_HEIGHT }, rect)).toBe(true);
    // A card that starts off-screen but reaches into the viewport is still drawn.
    expect(isBoxVisible({ id: 'edge', x: -200, y: -200, width: 300, height: 300 }, rect)).toBe(true);
  });

  it('9. culling follows a pan, so scrolling away really does stop drawing', () => {
    const panned = { x: -2000, y: 0, scale: 1 };
    const rect = visibleWorldRect(panned, { width: 800, height: 600 });
    const far = { id: 'far', x: 100, y: 100, width: CARD_WIDTH, height: CARD_HEIGHT };
    expect(isBoxVisible(far, rect)).toBe(false);

    const back = visibleWorldRect({ x: 0, y: 0, scale: 1 }, { width: 800, height: 600 });
    expect(isBoxVisible(far, back)).toBe(true);
  });
});

describe('Laying out a plan nobody has arranged yet', () => {
  const tasks = [
    { id: 'a', status: 'ready', phaseIndex: 0 },
    { id: 'b', status: 'in_progress', phaseIndex: 0 },
    { id: 'c', status: 'ready', phaseIndex: 1 },
    { id: 'd', status: 'blocked', phaseIndex: 0 },
    { id: 'e', status: 'completed', phaseIndex: 0 }
  ];    it("10. puts each status in its own lane and keeps a phase's tasks together", () => {
    const { positions, lanes } = laneLayout(tasks);

    // Lane order: ready, active, blocked, done — left to right.
    expect(positions.a.x).toBeLessThan(positions.b.x);
    expect(positions.b.x).toBeLessThan(positions.d.x);
    expect(positions.d.x).toBeLessThan(positions.e.x);

    // Inside the ready lane the phase-0 card comes before the phase-1 card.
    expect(positions.a.y).toBeLessThan(positions.c.y);
    expect(positions.a.x).toBe(positions.c.x);

    expect(lanes.map((lane) => lane.key)).toEqual(['ready', 'active', 'blocked', 'done']);
    expect(lanes.map((lane) => lane.count)).toEqual([2, 1, 1, 1]);
  });

  it('11. gives a blocked task a lane of its own instead of burying it in "in progress"', () => {
    expect(laneOfStatus('blocked')).toBe('blocked');
    expect(laneOfStatus('in_progress')).toBe('active');
    expect(laneOfStatus('partial')).toBe('active');
    expect(laneOfStatus('review')).toBe('active');
    expect(laneOfStatus('backlog')).toBe('ready');
    expect(laneOfStatus('nonsense-status')).toBe('ready');
  });

  it('12. makes every lane the same height, so four columns do not look like a bug', () => {
    const { lanes } = laneLayout(tasks);
    const heights = new Set(lanes.map((lane) => lane.height));
    expect(heights.size).toBe(1);
    // The ready lane holds two cards, so every lane is tall enough for two stacked cards.
    expect(lanes[0].height).toBeGreaterThan(CARD_HEIGHT * 2);
  });

  it('13. lays out an empty plan without inventing lanes full of cards', () => {
    const { positions, lanes, bounds } = laneLayout([]);
    expect(Object.keys(positions)).toHaveLength(0);
    expect(lanes.every((lane) => lane.count === 0)).toBe(true);
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
  });

  it('14. lets a dragged card keep its place while the others fall back to the lanes', () => {
    const layout = laneLayout(tasks);
    const resolved = resolvePositions(tasks, { b: { x: -900, y: 420 } }, layout);

    expect(resolved.b).toEqual({ x: -900, y: 420 });
    expect(resolved.a).toEqual(layout.positions.a);

    // A half-written position is not a position: it must not place a card at NaN.
    const broken = resolvePositions(tasks, { b: { x: Number.NaN, y: 10 } as any }, layout);
    expect(broken.b).toEqual(layout.positions.b);
  });

  it('15. builds the card rectangles the viewport test needs', () => {
    const boxes = boxesOfCards({ a: { x: 10, y: 20 } });
    expect(boxes).toEqual([{ id: 'a', x: 10, y: 20, width: CARD_WIDTH, height: CARD_HEIGHT }]);
    expect(boxesOfCards({ a: { x: 10, y: 20 } }, ['nope'])).toEqual([]);
  });

  it('15b. knows which cards lie on a zone, by the card’s own centre', () => {
    const zone = { x: 0, y: 0, width: 400, height: 300 };
    const positions = {
      inside: { x: 40, y: 40 },
      outside: { x: 900, y: 700 },
      parked: { x: 260, y: 120 }
    };

    expect(cardsOnZone(positions, zone)).toEqual(['inside', 'parked']);

    // The rule is the card's centre, so half a card over the edge is in and half is out — the
    // boundary is read inclusively and nothing is decided by a card's size.
    const onTheEdge = { x: zone.width - CARD_WIDTH / 2, y: 0 };
    expect(cardsOnZone({ edge: onTheEdge }, zone)).toEqual(['edge']);
    expect(cardsOnZone({ edge: { x: onTheEdge.x + 1, y: 0 } }, zone)).toEqual([]);

    // The caller can narrow the question to the cards it has to write down, and the answer keeps
    // the order it was asked in.
    expect(cardsOnZone(positions, zone, ['parked', 'outside'])).toEqual(['parked']);
    expect(cardsOnZone(positions, zone, ['outside'])).toEqual([]);
    // A card nobody has placed is not a card at all.
    expect(cardsOnZone({ ghost: { x: Number.NaN, y: 10 } }, zone)).toEqual([]);
  });

  it('24. carries the cards nobody placed when their lane is dragged somewhere else', () => {
    const base = laneLayout(tasks);
    const dragged = laneLayout(tasks, { ready: { offsetX: 420, offsetY: -160 } });

    const ready = base.lanes.find((lane) => lane.key === 'ready')!;
    const movedReady = dragged.lanes.find((lane) => lane.key === 'ready')!;
    expect(movedReady.x - ready.x).toBe(420);
    expect(movedReady.y - ready.y).toBe(-160);

    // Both cards of the ready lane go with it…
    expect(dragged.positions.a.x - base.positions.a.x).toBe(420);
    expect(dragged.positions.a.y - base.positions.a.y).toBe(-160);
    expect(dragged.positions.c.x - base.positions.c.x).toBe(420);

    // …while the lanes next door, and their cards, stay exactly where they were.
    expect(dragged.positions.b).toEqual(base.positions.b);
    expect(dragged.positions.d).toEqual(base.positions.d);
    expect(dragged.lanes.find((lane) => lane.key === 'done')!.x).toBe(
      base.lanes.find((lane) => lane.key === 'done')!.x
    );

    // A lane moved sideways still reaches as deep as the others: it is the same column, moved.
    expect(movedReady.height).toBe(ready.height);
  });

  it('25. leaves a card that was placed by hand where its owner put it', () => {
    const layout = laneLayout(tasks, { ready: { offsetX: 420 } });
    const resolved = resolvePositions(tasks, { a: { x: -60, y: 900 } }, layout);

    // A card the user dragged is the user's, and a lane moving must not quietly overrule that.
    expect(resolved.a).toEqual({ x: -60, y: 900 });
    expect(resolved.c).toEqual(layout.positions.c);

    // The bounds are the lanes themselves, so "fit the whole plan" frames a moved lane too —
    // otherwise a lane dragged out of the box would be cut off by the very button that fits them.
    const base = laneLayout(tasks).bounds;
    const pulledLeft = laneLayout(tasks, { ready: { offsetX: -420 } }).bounds;
    expect(pulledLeft.x).toBe(base.x - 420);
    expect(pulledLeft.width).toBe(base.width + 420);
  });
});

describe('The dot grid under the plan', () => {
  const zoomSweep: number[] = [];
  for (let scale = MIN_SCALE; scale <= MAX_SCALE + 1e-9; scale += 0.005) zoomSweep.push(scale);

  it('19. keeps every level of dots a readable distance apart at every zoom', () => {
    for (const scale of zoomSweep) {
      const levels = gridLevels(scale);
      expect(levels.length).toBeGreaterThan(0);

      for (const level of levels) {
        const onScreen = level.step * scale;
        expect(onScreen).toBeGreaterThanOrEqual(GRID_MIN_PX - 0.001);
        expect(onScreen).toBeLessThanOrEqual(GRID_MAX_PX + 0.001);
      }
    }
  });

  it('20. spaces the dots in powers of two, so the grid stays put on the world origin', () => {
    for (const scale of [MIN_SCALE, 0.5, 1, 2, MAX_SCALE]) {
      for (const level of gridLevels(scale)) {
        const steps = Math.log2(level.step / GRID_BASE);
        // A spacing that was not a power of two would slide the dots under the cards as the user
        // zooms, and a coarser level that was not a multiple of a finer one could not be faded
        // into it: the two levels have to share their dot positions, not merely their look.
        expect(steps).toBeCloseTo(Math.round(steps), 9);
      }
    }

    // At 1:1 the grid is the one the board has always shown, at the spacing it has always had.
    expect(gridLevels(1).some((level) => level.step === GRID_BASE)).toBe(true);
  });

  it('21. crossfades the levels, so no zoom changes the background in one step', () => {
    for (const scale of zoomSweep) {
      const levels = gridLevels(scale);

      // The levels are two views of the same grid: together they always amount to one grid.
      expect(levels.reduce((total, level) => total + level.alpha, 0)).toBeCloseTo(1, 2);
      for (const level of levels) expect(level.alpha).toBeGreaterThan(0);
      expect(levels.every((level) => level.alpha <= 1)).toBe(true);
    }

    // …and a level arrives or leaves the drawing only once it has faded to nothing: no step in the
    // zoom may make an alpha jump. A hard threshold here is the background that "changes by itself".
    const step = 0.005;
    for (let scale = MIN_SCALE; scale + step <= MAX_SCALE; scale += step) {
      const before = new Map(gridLevels(scale).map((level) => [level.step, level.alpha]));
      for (const level of gridLevels(scale + step)) {
        const was = before.get(level.step);
        if (was === undefined) continue;
        expect(Math.abs(level.alpha - was)).toBeLessThan(0.06);
      }
    }
  });

  it('22. lays down the same amount of ink from one zoom step to the next', () => {
    /*
     * How much background a zoom step actually changes, in dots per world area rather than in
     * "which level is the strong one": at half strength both levels are on their own equal
     * footing, so a rule stated over the strongest level would only prove that some level is
     * always the strongest. Ink is what the eye sees, and it has to move smoothly.
     */
    const ink = (scale: number): number =>
      gridLevels(scale).reduce((total, level) => total + level.alpha / (level.step * level.step), 0);

    for (let scale = MIN_SCALE; scale + 0.005 <= MAX_SCALE; scale += 0.005) {
      const before = ink(scale);
      const after = ink(scale + 0.005);
      expect(Math.abs(after - before) / before).toBeLessThan(0.08);
    }
  });

  it('23. keeps the dots near the spacing the board aims for', () => {
    for (const scale of zoomSweep) {
      const spacings = gridLevels(scale).map((level) => level.step * scale);
      // One of the two levels is always within a zoom step of the target, so the dot field is
      // never a haze and never a scatter.
      expect(Math.min(...spacings.map((spacing) => Math.abs(Math.log2(spacing / GRID_TARGET_PX))))).toBeLessThan(0.51);
    }
  });
});

describe('The minimap as a control', () => {
  it('16. maps a world point into the map and back again', () => {
    const transform = minimapTransform(
      { x: 0, y: 0, width: 1000, height: 500 },
      { width: 200, height: 100 }
    );

    expect(transform.toMap({ x: 500, y: 250 })).toEqual({ x: 100, y: 50 });

    const roundTrip = transform.toWorld(transform.toMap({ x: 137, y: 402 }));
    expect(roundTrip.x).toBeCloseTo(137, 9);
    expect(roundTrip.y).toBeCloseTo(402, 9);
  });

  it('17. centres a board whose shape does not match the map', () => {
    const transform = minimapTransform(
      { x: 0, y: 0, width: 1000, height: 100 },
      { width: 200, height: 100 }
    );
    // The board is a wide strip: it is pinned to the middle of the map vertically.
    expect(transform.toMap({ x: 0, y: 0 }).y).toBeCloseTo(40, 9);
    expect(transform.toWorld({ x: 0, y: 40 })).toEqual({ x: 0, y: 0 });
  });

  it('18. survives a board with no size yet', () => {
    const transform = minimapTransform({ x: 0, y: 0, width: 0, height: 0 }, { width: 200, height: 100 });
    expect(Number.isFinite(transform.scale)).toBe(true);
    expect(Number.isFinite(transform.toMap({ x: 0, y: 0 }).x)).toBe(true);
  });
});

/**
 * Zones lean against each other instead of lying on top of each other, and a zone is as big as the
 * user stretched it. Both are arithmetic before they are anything else: where a zone ends up when it
 * is pushed into its neighbour, and how big it may become before it would cover one.
 */
describe('Zones that lean, and zones that stretch', () => {
  const lane = { x: 0, y: 0, width: LANE_MIN_WIDTH, height: 500 };
  const neighbour = { x: LANE_STRIDE, y: 0, width: LANE_MIN_WIDTH, height: 500 };

  it('26. leans a zone on the edge it was pushed into, from whichever side it arrived', () => {
    // Pushed right: it stops where the two plates would touch.
    expect(separateRect({ ...lane, x: 200 }, [neighbour])).toEqual({ x: LANE_STRIDE - LANE_MIN_WIDTH, y: 0 });
    // Pushed from the other side: it stops on that side of the neighbour.
    expect(separateRect({ ...lane, x: 400 }, [neighbour])).toEqual({ x: LANE_STRIDE + LANE_MIN_WIDTH, y: 0 });
    // Pushed down while sharing the rows: the shorter way out is the vertical one.
    expect(separateRect({ ...lane, x: 320, y: 420 }, [neighbour])).toEqual({ x: 320, y: 500 });
    // Sharing only an edge is not touching anything: a zone that already leans is left alone.
    expect(separateRect({ ...lane, x: LANE_STRIDE - LANE_MIN_WIDTH }, [neighbour])).toEqual({
      x: LANE_STRIDE - LANE_MIN_WIDTH,
      y: 0
    });
  });

  it('27. moves only the zone in the hand, and re-draws a saved board as it was left', () => {
    const lanes: LaneBand[] = [
      { key: 'ready', ...lane, count: 1 },
      { key: 'active', ...neighbour, count: 1 }
    ];

    // Nothing is in the hand: the stored arrangement is what is drawn, overlapping or not — a
    // project is not rearranged because the board would have placed its lanes differently.
    expect(settleLaneRects(lanes).map((entry) => entry.x)).toEqual([0, LANE_STRIDE]);

    // The lane being held yields; the one it is pushed against stays exactly where it was.
    const held = settleLaneRects([{ ...lanes[0], x: 200 }, lanes[1]], 'ready');
    expect(held[0].x).toBe(LANE_STRIDE - LANE_MIN_WIDTH);
    expect(held[1].x).toBe(LANE_STRIDE);

    // …and a zone that is not the one in the hand cannot shove the other one either.
    const pushed = settleLaneRects([lanes[0], { ...lanes[1], x: 120 }], 'active');
    expect(pushed[0].x).toBe(0);
    expect(pushed[1].x).toBe(LANE_MIN_WIDTH);
  });

  it('28. stops a stretch at the next zone, and never below the size a zone needs', () => {
    // Wider than the room beside it: it stops where the plates would touch.
    expect(clampLaneSize({ ...lane, width: 900 }, [neighbour])).toEqual({ width: LANE_STRIDE, height: 500 });
    // Deeper: there is nothing under it, so the depth is the user's to choose.
    expect(clampLaneSize({ ...lane, height: 900 }, [neighbour])).toEqual({ width: LANE_MIN_WIDTH, height: 900 });
    // Shrunk past the floor: refused rather than drawn — a zone keeps room for its own cards and
    // for the handle it is dragged by.
    expect(clampLaneSize({ ...lane, width: 40, height: 20 }, [neighbour])).toEqual({
      width: LANE_MIN_WIDTH,
      height: LANE_MIN_HEIGHT
    });
    // A zone that shares no rows with it is not in the way at all.
    expect(clampLaneSize({ ...lane, width: 900 }, [{ ...neighbour, y: 900 }])).toEqual({ width: 900, height: 500 });
  });

  it('29. gives a stretched zone the size it was given, and keeps its cards under its own handle', () => {
    const tasks = [
      { id: 'a', status: 'ready', phaseIndex: 0 },
      { id: 'b', status: 'in_progress', phaseIndex: 0 },
      { id: 'd', status: 'completed', phaseIndex: 0 }
    ];

    const base = laneLayout(tasks);
    const done = base.lanes.find((entry) => entry.key === 'done')!;
    const stretched = laneLayout(tasks, { done: { width: done.width + 220, height: done.height + 300 } });
    const bigger = stretched.lanes.find((entry) => entry.key === 'done')!;

    expect(bigger.width).toBe(done.width + 220);
    expect(bigger.height).toBe(done.height + 300);
    // One zone's size is one zone's business.
    const untouched = stretched.lanes.find((entry) => entry.key === 'ready')!;
    expect(untouched.width).toBe(done.width);
    expect(untouched.height).toBe(done.height);

    // The cards nobody placed start under the handle, wherever the zone is — and the cards the user
    // placed by hand stay where that user put them.
    expect(stretched.positions.d.x - bigger.x).toBe(base.positions.d.x - done.x);
    expect(stretched.positions.d.y - bigger.y).toBe(base.positions.d.y - done.y);
    expect(stretched.positions.a).toEqual(base.positions.a);
  });

  it('30. keeps a depth the user chose when the plan grows, instead of snapping to the common floor', () => {
    const short: LaneBand[] = laneLayout([{ id: 'd', status: 'completed', phaseIndex: 0 }], {
      done: { height: LANE_MIN_HEIGHT }
    }).lanes;
    expect(short.find((entry) => entry.key === 'done')!.height).toBe(LANE_MIN_HEIGHT);

    // Another lane gets two cards, so the board's shared floor rises: the zone that was sized by
    // hand keeps the size it was given.
    const grown = laneLayout(
      [
        { id: 'd', status: 'completed', phaseIndex: 0 },
        { id: 'a', status: 'ready', phaseIndex: 0 },
        { id: 'b', status: 'ready', phaseIndex: 1 }
      ],
      { done: { height: LANE_MIN_HEIGHT } }
    ).lanes;
    expect(grown.find((entry) => entry.key === 'done')!.height).toBe(LANE_MIN_HEIGHT);
    expect(grown.find((entry) => entry.key === 'ready')!.height).toBeGreaterThan(LANE_MIN_HEIGHT);

    // Every zone of an untouched plan still reaches the same floor.
    expect(new Set(laneLayout([{ id: 'a', status: 'ready', phaseIndex: 0 }]).lanes.map((entry) => entry.height)).size).toBe(1);
    // And a zone's resting place is written down as one number in one place.
    expect(laneRestOrigin(2).x).toBe(LANE_STRIDE * 2);
  });
});
