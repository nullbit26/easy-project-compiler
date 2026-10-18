import { describe, it, expect } from 'vitest';

import type { CanvasPoint } from '../utils/canvasView';

import {
  LINK_MAX_SCREEN_PX,
  LINK_MIN_SCREEN_PX,
  dependencyGraph,
  dependencyPath,
  dependencyPaths,
  dependencyPlan,
  edgeMidpoint,
  linkScale,
  type DependencyTask
} from '../utils/canvasEdges';
import type { CanvasBox } from '../utils/canvasView';

/**
 * A line between two cards is easy to draw and hard to get right: the same link has to say
 * "queued", "you can start this today" or "somebody began before its dependency was done",
 * and it has to survive a plan whose references point at titles or at nothing at all.
 */

function task(id: string, status: string, dependencies: string[] = [], title = `Task ${id}`): DependencyTask {
  return { id, title, status, dependencies };
}

describe('What a dependency means right now', () => {
  it('1. says a task can start as soon as its dependency is finished', () => {
    const plan = dependencyPlan([task('a', 'completed', [], 'Draw the map'), task('b', 'ready', ['a'], 'Place enemies')]);

    expect(plan.edges).toHaveLength(1);
    expect(plan.edges[0]).toMatchObject({ fromId: 'a', toId: 'b', state: 'ready' });
    expect(plan.edges[0].fromTitle).toBe('Draw the map');
    expect(plan.readyToStart).toEqual(['b']);
  });

  it('2. keeps a task waiting while its dependency is unfinished', () => {
    const plan = dependencyPlan([task('a', 'in_progress'), task('b', 'backlog', ['a']), task('c', 'ready', ['b'])]);

    const byPair = new Map(plan.edges.map((edge) => [edge.id, edge.state]));
    expect(byPair.get('a->b')).toBe('waiting');
    expect(byPair.get('b->c')).toBe('waiting');
    expect(plan.waitingOn.b).toBe(1);
    expect(plan.readyToStart).toEqual([]);
  });

  it('3. warns when work has begun before its dependency is done', () => {
    const plan = dependencyPlan([task('a', 'ready'), task('b', 'in_progress', ['a'])]);

    expect(plan.edges[0].state).toBe('blocked');
    // Starting early is a warning, not a reason to hide the task from the list of things to do.
    expect(plan.readyToStart).toEqual([]);
  });

  it('4. fades a link whose both ends are finished', () => {
    const plan = dependencyPlan([task('a', 'completed'), task('b', 'completed', ['a'])]);

    expect(plan.edges[0].state).toBe('done');
    expect(plan.waitingOn.b).toBe(0);
    // A finished task is never offered as the next thing to start.
    expect(plan.readyToStart).toEqual([]);
  });

  it('5. counts only the unfinished dependencies of each task', () => {
    const plan = dependencyPlan([
      task('a', 'completed'),
      task('b', 'in_progress'),
      task('c', 'backlog', ['a', 'b'])
    ]);

    expect(plan.waitingOn.c).toBe(1);
    expect(plan.waitingOn.a).toBe(0);
  });

  it('6. does not offer a dependency-free task as "the next thing to start"', () => {
    // Readiness here means the frontier of the dependency graph, not every task that is not done —
    // otherwise the highlight would sit on half the plan.
    const plan = dependencyPlan([task('a', 'completed'), task('b', 'ready'), task('c', 'ready', ['a'])]);

    // `b` has no dependencies at all, so it is not the frontier — `c` is, with `a` finished.
    expect(plan.readyToStart).toEqual(['c']);
  });
});

describe('Resolving the references a plan carries', () => {
  it('7. accepts a title when the plan points at a name instead of an id', () => {
    const plan = dependencyPlan([
      { id: 'x1', title: 'Input System', status: 'completed', dependencies: [] },
      { id: 'x2', title: 'Camera', status: 'ready', dependencies: [' input system '] }
    ]);

    expect(plan.edges).toHaveLength(1);
    expect(plan.edges[0].state).toBe('ready');
    expect(plan.unresolved).toEqual([]);
  });

  it('7b. accepts the short name an AI-written plan stores instead of the real id', () => {
    /*
     * The model names a dependency by where the task sits — phase 0, task 1 — because ids are
     * assigned after it answers. Those names are what ends up in the saved plan, and read literally
     * they pointed at nothing: the board greeted a perfectly well-connected plan with "dependencies
     * that name no task in the plan: 0_0, 0_1, 1_0".
     */
    const plan = dependencyPlan([
      { id: 'task_0_0', title: 'Setup', status: 'completed', dependencies: [] },
      { id: 'task_0_1', title: 'Camera', status: 'ready', dependencies: ['0_0'] },
      { id: 'task_1_0', title: 'Enemies', status: 'backlog', dependencies: ['0_1', 'task_1_0'] }
    ]);

    expect(plan.unresolved).toEqual([]);
    expect(plan.edges.map((edge) => edge.id)).toEqual(['task_0_0->task_0_1', 'task_0_1->task_1_0']);
    expect(plan.edges[0].state).toBe('ready');
  });

  it('7c. never lets a short name shadow a task that really has that id', () => {
    const plan = dependencyPlan([
      { id: 'task_0_0', title: 'Setup', status: 'completed', dependencies: [] },
      { id: '0_0', title: 'Literal id', status: 'ready', dependencies: [] },
      { id: 'task_1_0', title: 'Enemies', status: 'backlog', dependencies: ['0_0'] }
    ]);

    // The source of the line is the task whose real id is `0_0` — not `task_0_0`, which only answers
    // to that name when nothing else claims it.
    expect(plan.edges.map((edge) => edge.fromId)).toEqual(['0_0']);
    expect(plan.edges.map((edge) => edge.toId)).toEqual(['task_1_0']);
    expect(plan.unresolved).toEqual([]);
  });

  it('8. reports a reference that points at nothing instead of dropping it silently', () => {
    const plan = dependencyPlan([task('a', 'ready', ['ghost'])]);

    expect(plan.edges).toEqual([]);
    expect(plan.unresolved).toEqual(['ghost']);
    expect(plan.waitingOn.a).toBe(0);
  });

  it('9. reports a dangling reference once, however often it is repeated', () => {
    const plan = dependencyPlan([task('a', 'ready', ['ghost', 'ghost']), task('b', 'ready', ['ghost'])]);

    expect(plan.unresolved).toEqual(['ghost']);
  });

  it('10. ignores a task that depends on itself and never draws a duplicated line', () => {
    const plan = dependencyPlan([task('a', 'ready', ['a', 'b', 'b']), task('b', 'in_progress')]);

    expect(plan.edges.map((edge) => edge.id)).toEqual(['b->a']);
    expect(plan.waitingOn.a).toBe(1);
  });

  it('11. leaves a plan with no dependencies alone', () => {
    const plan = dependencyPlan([task('a', 'ready'), task('b', 'completed')]);

    expect(plan.edges).toEqual([]);
    expect(plan.readyToStart).toEqual([]);
    expect(plan.unresolved).toEqual([]);
  });
});

describe('Drawing the line between two cards', () => {
  const left: CanvasBox = { id: 'l', x: 0, y: 0, width: 264, height: 196 };
  const right: CanvasBox = { id: 'r', x: 600, y: 40, width: 264, height: 196 };

  /** Every segment of a route runs along one axis — the whole point of drawing one. */
  const expectOrthogonal = (route: CanvasPoint[]) => {
    for (let index = 1; index < route.length; index += 1) {
      const before = route[index - 1];
      const after = route[index];
      const straight = before.x === after.x || before.y === after.y;
      expect(straight).toBe(true);
    }
  };

  it('12. joins two side-by-side cards at their facing edges, out square and in square', () => {
    const path = dependencyPath(left, right);

    expect(path.from).toEqual({ x: 264, y: 98 });
    expect(path.to).toEqual({ x: 600, y: 138 });

    // Out of the port, one step across in the middle of the run, and in — the leads that made it
    // possible are consumed by the straight runs, which is why the route is four points and not six.
    expect(path.route).toEqual([
      { x: 264, y: 98 },
      { x: 432, y: 98 },
      { x: 432, y: 138 },
      { x: 600, y: 138 }
    ]);
    expectOrthogonal(path.route);

    // The turns are rounded, and nothing about this link is a curve.
    expect(path.d.startsWith('M 264 98 L ')).toBe(true);
    expect(path.d.endsWith('L 600 138')).toBe(true);
    expect(path.d).toContain('Q 432 98');
    expect(path.d).not.toContain(' C ');
  });

  it('13. turns around when the dependency stands to the right of its dependent', () => {
    const path = dependencyPath(right, left);

    // Both ports flip to the other side, so the line never crosses through the cards.
    expect(path.from).toEqual({ x: 600, y: 138 });
    expect(path.to).toEqual({ x: 264, y: 98 });
    expect(path.route[0]).toEqual({ x: 600, y: 138 });
    expect(path.route[path.route.length - 1]).toEqual({ x: 264, y: 98 });
    expect(path.route[1]).toEqual({ x: 432, y: 138 });
    expectOrthogonal(path.route);
  });

  it('14. joins top-to-bottom when the cards overlap horizontally', () => {
    const below: CanvasBox = { id: 'b', x: 40, y: 400, width: 264, height: 196 };
    const path = dependencyPath(left, below);

    expect(path.from).toEqual({ x: 132, y: 196 });
    expect(path.to).toEqual({ x: 172, y: 400 });
    expect(path.route).toEqual([
      { x: 132, y: 196 },
      { x: 132, y: 298 },
      { x: 172, y: 298 },
      { x: 172, y: 400 }
    ]);
    expectOrthogonal(path.route);
  });

  it('16. falls back to a curve when an elbow would have to double back', () => {
    // The dependent starts to the right of its dependency, so a routed line would have to run back
    // through both cards; the curve is the honest shape for it.
    const overlapping: CanvasBox = { id: 'o', x: 240, y: 0, width: 264, height: 196 };
    const path = dependencyPath(left, overlapping);

    expect(path.route).toEqual([]);
    expect(path.d).toContain(' C ');
  });

  it('15. joins bottom-to-top when the dependency stands below its dependent', () => {
    const below: CanvasBox = { id: 'b', x: 40, y: 400, width: 264, height: 196 };
    const path = dependencyPath(below, left);

    expect(path.from).toEqual({ x: 172, y: 400 });
    expect(path.to).toEqual({ x: 132, y: 196 });
  });

  it('17. gives a curve room to breathe even when the cards nearly touch', () => {
    const close: CanvasBox = { id: 'c', x: 270, y: 0, width: 264, height: 196 };
    const path = dependencyPath(left, close);

    // The control points still leave the card's edge at an angle rather than collapsing.
    const numbers = path.d.match(/-?[\d.]+/g)!.map(Number);
    expect(numbers).toHaveLength(8);
    expect(numbers[2]).toBeGreaterThan(path.from.x);
    expect(numbers[4]).toBeLessThan(path.to.x);
  });
});

describe('Choosing the sides a link joins', () => {
  const card: CanvasBox = { id: 'card', x: 0, y: 0, width: 264, height: 196 };
  const elsewhere = (x: number, y: number): CanvasBox => ({ id: 'other', x, y, width: 264, height: 196 });

  it('18. joins the two sides that face each other', () => {
    expect(dependencyPath(card, elsewhere(600, 0))).toMatchObject({ fromSide: 'right', toSide: 'left' });
    expect(dependencyPath(card, elsewhere(-600, 0))).toMatchObject({ fromSide: 'left', toSide: 'right' });
    expect(dependencyPath(card, elsewhere(0, 600))).toMatchObject({ fromSide: 'bottom', toSide: 'top' });
    expect(dependencyPath(card, elsewhere(0, -600))).toMatchObject({ fromSide: 'top', toSide: 'bottom' });

    // A diagonal follows whichever axis separates the cards more, so a link never sets off along
    // the longer way round.
    expect(dependencyPath(card, elsewhere(600, 40)).fromSide).toBe('right');
    expect(dependencyPath(card, elsewhere(40, 600)).fromSide).toBe('bottom');
  });

  it('19. never leaves through the side the other card is not on', () => {
    // Overlapping rectangles have no free side, so the *shallower* overlap loses: these two cards
    // are 64px into each other horizontally but only 46px vertically, and the link joins
    // bottom-to-top rather than doubling back through both of them.
    const path = dependencyPath(card, elsewhere(200, 150));

    expect([path.fromSide, path.toSide]).toEqual(['bottom', 'top']);
    expect(path.from.y).toBe(196);
    expect(path.to.y).toBe(150);
  });

  it('20. touches the border of the card, square on', () => {
    const path = dependencyPath(card, elsewhere(600, 0));

    // The port is on the edge itself — a link that stops short reads as clipped, one that starts
    // inside the card reads as drawn over it.
    expect(path.from).toEqual({ x: 264, y: 98 });
    expect(path.to).toEqual({ x: 600, y: 98 });

    // The control points push straight out of that edge, which is what makes the curve arrive at
    // a right angle instead of sliding in sideways.
    expect(path.control1.y).toBe(path.from.y);
    expect(path.control1.x).toBeGreaterThan(path.from.x);
    expect(path.control2.y).toBe(path.to.y);
    expect(path.control2.x).toBeLessThan(path.to.x);
  });

  it('21. gives every link its own port when three leave the same card', () => {
    const hub: CanvasBox = { id: 'hub', x: 0, y: 0, width: 264, height: 196 };
    const geometry = dependencyPaths([
      { id: 'up', from: hub, to: elsewhere(700, -320) },
      { id: 'mid', from: hub, to: elsewhere(700, 0) },
      { id: 'low', from: hub, to: elsewhere(700, 320) }
    ]);

    const ports = ['up', 'mid', 'low'].map((id) => geometry.get(id)!.from);

    // All three leave the right-hand edge…
    for (const port of ports) expect(port.x).toBe(264);
    // …at three different heights. Three dependencies drawn as one line would be counted as two.
    expect(new Set(ports.map((port) => port.y)).size).toBe(3);
    expect(ports[0].y).toBeLessThan(ports[1].y);
    expect(ports[1].y).toBeLessThan(ports[2].y);
    // The middle link keeps the centre of the side, and no port ever leaves the side it is on.
    expect(ports[1].y).toBeCloseTo(98, 6);
    for (const port of ports) {
      expect(port.y).toBeGreaterThan(0);
      expect(port.y).toBeLessThan(196);
    }
  });

  it('22. merges several links into one input, with one arrowhead for the group', () => {
    const hub: CanvasBox = { id: 'hub', x: 0, y: 0, width: 264, height: 196 };
    const other: CanvasBox = { id: 'other', x: 0, y: 400, width: 264, height: 196 };
    const target: CanvasBox = { id: 'target', x: 600, y: 0, width: 264, height: 196 };

    const graph = dependencyGraph([
      { id: 'first', from: hub, to: target, state: 'ready' },
      { id: 'second', from: other, to: target, state: 'waiting' }
    ]);

    // One input: the two links share a trunk, and only the trunk meets the card.
    expect(graph.trunks).toHaveLength(1);
    const trunk = graph.trunks[0];
    expect(trunk.toSide).toBe('left');
    expect(trunk.port).toEqual({ x: 600, y: 98 });
    expect(trunk.members).toEqual(['first', 'second']);

    // The trunk runs straight out of the border, so the arrowhead lands square on it.
    expect(trunk.d).toBe('M 560 98 L 600 98');
    expect(trunk.outer).toEqual({ x: 560, y: 98 });

    // Both links stop on the trunk rather than on the card, at two different points of it: two
    // features cannot arrive at one border pixel without looking like a mistake.
    const first = graph.routes.get('first')!;
    const second = graph.routes.get('second')!;
    expect(first.merged).toBe(true);
    expect(second.merged).toBe(true);
    expect(first.trunkId).toBe(trunk.id);
    expect(first.to).toEqual({ x: 580, y: 98 });
    expect(second.to).toEqual({ x: 560, y: 98 });
    expect(first.d.endsWith('L 580 98')).toBe(true);

    // A group enters the card once, in the colour of the worst thing it is waiting for.
    expect(trunk.state).toBe('waiting');

    // …and the whole way in is still a routed line, not a bundle of diagonals.
    const route = graph.routes.get('second')!.route;
    for (let index = 1; index < route.length; index += 1) {
      const before = route[index - 1];
      const after = route[index];
      expect(before.x === after.x || before.y === after.y).toBe(true);
    }
    expect(route[route.length - 1]).toEqual({ x: 560, y: 98 });
  });

  it('23. leaves a single link into a side alone', () => {
    const hub: CanvasBox = { id: 'hub', x: 0, y: 0, width: 264, height: 196 };
    const target: CanvasBox = { id: 'target', x: 600, y: 0, width: 264, height: 196 };

    const graph = dependencyGraph([{ id: 'only', from: hub, to: target, state: 'ready' }]);

    expect(graph.trunks).toEqual([]);
    expect(graph.routes.get('only')!.to).toEqual({ x: 600, y: 98 });
    expect(graph.routes.get('only')!.merged).toBeFalsy();
  });

  it('24. scales a link with the zoom, inside a floor and a ceiling', () => {
    // A line drawn at a constant screen width is what turns a zoomed-out plan into a frame of
    // full-size arrowheads: the board shrinks, and the graph has to shrink with it.
    expect(linkScale(1, 2.4)).toBeCloseTo(1, 9);
    expect(linkScale(0.5, 2.4)).toBeCloseTo(0.5, 9);
    expect(linkScale(0.2, 2.4)).toBeCloseTo(LINK_MIN_SCREEN_PX / 2.4, 9);
    expect(linkScale(2.5, 2.4)).toBeCloseTo(LINK_MAX_SCREEN_PX / 2.4, 9);

    // What the eye gets: the line's width on screen, which is the base width times the factor.
    for (const scale of [0.2, 0.33, 0.5, 0.8, 1, 1.5, 2.5]) {
      for (const base of [1.5, 1.7, 2.4]) {
        const onScreen = base * linkScale(scale, base);
        expect(onScreen).toBeGreaterThanOrEqual(LINK_MIN_SCREEN_PX - 1e-9);
        expect(onScreen).toBeLessThanOrEqual(LINK_MAX_SCREEN_PX + 1e-9);
      }
    }

    // A zoomed-out board gets a thin graph, not a thick one: the factor never grows as it shrinks.
    expect(linkScale(0.4, 2.4)).toBeLessThan(linkScale(0.8, 2.4));
    expect(linkScale(0.8, 2.4)).toBeLessThan(linkScale(1, 2.4));
  });

  it('25. leaves a lone link in the middle of its side', () => {
    const lone: CanvasBox = { id: 'lone', x: 0, y: 0, width: 264, height: 196 };
    const geometry = dependencyPaths([{ id: 'solo', from: lone, to: elsewhere(700, 0) }]);

    expect(geometry.get('solo')!.from).toEqual({ x: 264, y: 98 });
  });

  it('26. puts a link’s label between the cards, never inside one of them', () => {
    const horizontal = dependencyPath(card, elsewhere(600, 0));
    const mid = edgeMidpoint(horizontal);
    expect(mid.x).toBeGreaterThan(horizontal.from.x);
    expect(mid.x).toBeLessThan(horizontal.to.x);

    const vertical = edgeMidpoint(dependencyPath(card, elsewhere(0, 600)));
    expect(vertical.y).toBeGreaterThan(196);
    expect(vertical.y).toBeLessThan(600);
  });
});
