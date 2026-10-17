import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';

import { PlanCanvas } from '../components/PlanCanvas';
import { CARD_HEIGHT, CARD_WIDTH } from '../utils/canvasView';
import type { ProjectPhase, ProjectState, ProjectTask } from '../types';

/**
 * The board's promises, tested through the same interface a person uses: a card dragged by its
 * header is remembered, a click only selects, and the controls *inside* a card still work — which
 * is the whole reason the cards are real DOM instead of drawn on a canvas.
 */

function makeTask(id: string, status: ProjectTask['status'], extra: Partial<ProjectTask> = {}): ProjectTask {
  return {
    id,
    phaseId: 'phase_0',
    title: `Task ${id}`,
    goal: `Goal of ${id}`,
    status,
    relevantFiles: ['src/App.tsx'],
    acceptanceCriteria: [
      { id: `${id}_ac1`, description: 'builds', passed: false },
      { id: `${id}_ac2`, description: 'tested', passed: false }
    ],
    testRequirements: ['Unit test'],
    estimatedComplexity: 'Small (1 prompt)',
    dependencies: [],
    progressPercent: 0,
    ...extra
  };
}

function makeProject(phases: ProjectPhase[]): ProjectState {
  return { id: 'p_board', name: 'Board demo', phases } as unknown as ProjectState;
}

function twoPhaseProject(): ProjectState {
  return makeProject([
    {
      id: 'phase_0',
      phaseNumber: 1,
      title: 'Core loop',
      purpose: 'Make it playable',
      deliverable: 'Playable build',
      tasks: [makeTask('a', 'ready'), makeTask('b', 'in_progress')]
    },
    {
      id: 'phase_1',
      phaseNumber: 2,
      title: 'Polish',
      purpose: 'Make it nice',
      deliverable: 'Polished build',
      tasks: [makeTask('c', 'blocked'), makeTask('d', 'completed')]
    }
  ]);
}

/**
 * A plan held together by dependencies: `b` may start because `a` is finished, `c` is queued behind
 * `b`, and `d` has been started although the task it depends on is still open.
 */
function linkedProject(): ProjectState {
  return makeProject([
    {
      id: 'phase_0',
      phaseNumber: 1,
      title: 'Core',
      purpose: 'Make it playable',
      deliverable: 'Playable build',
      tasks: [
        makeTask('a', 'completed'),
        makeTask('b', 'ready', { dependencies: ['a'] }),
        makeTask('c', 'backlog', { dependencies: ['b'] }),
        makeTask('d', 'in_progress', { dependencies: ['c'] })
      ]
    }
  ]);
}

/**
 * A plan where two tasks feed one: the case a dependency graph has to get right, because two
 * arrows landing side by side on one card read as a mistake rather than as two dependencies.
 */
function fanInProject(): ProjectState {
  return makeProject([
    {
      id: 'phase_0',
      phaseNumber: 1,
      title: 'Core',
      purpose: 'Make it playable',
      deliverable: 'Playable build',
      tasks: [
        makeTask('hub', 'ready'),
        makeTask('other', 'ready'),
        makeTask('target', 'backlog', { dependencies: ['hub', 'other'] })
      ]
    }
  ]);
}

function renderBoard(project: ProjectState, overrides: Partial<React.ComponentProps<typeof PlanCanvas>> = {}) {
  const handlers = {
    onUpdateTaskStatus: vi.fn(),
    onUpdateTaskPositions: vi.fn(),
    onUpdateTaskTitle: vi.fn(),
    onUpdateCanvasLanes: vi.fn(),
    onCompileTaskPrompt: vi.fn(),
    onAddTask: vi.fn(),
    onAdaptProjectPhases: vi.fn(),
    onSwitchToKanban: vi.fn()
  };

  const utils = render(<PlanCanvas project={project} {...handlers} {...overrides} />);
  return { ...utils, ...handlers };
}

/** The header strip of a card is its drag handle. */
function cardHeader(taskId: string): HTMLElement {
  const card = screen.getByTestId(`plan-card-${taskId}`);
  return card.firstElementChild as HTMLElement;
}

function dragCard(taskId: string, from: { x: number; y: number }, to: { x: number; y: number }) {
  const header = cardHeader(taskId);
  fireEvent.pointerDown(header, { pointerId: 1, button: 0, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(header, { pointerId: 1, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(header, { pointerId: 1, clientX: to.x, clientY: to.y });
}

beforeEach(() => {
  localStorage.clear();
});

describe('Opening a plan as a board', () => {
  it('1. shows every task without anyone having placed it, grouped by status lanes', () => {
    renderBoard(twoPhaseProject());

    for (const id of ['a', 'b', 'c', 'd']) {
      expect(screen.getByTestId(`plan-card-${id}`)).toBeTruthy();
    }

    // The lanes are what keeps a free canvas readable: each status says how much is in it.
    expect(within(screen.getByTestId('plan-lane-ready')).getByText('Готово к работе')).toBeTruthy();
    expect(within(screen.getByTestId('plan-lane-active')).getByText('В работе и на проверке')).toBeTruthy();
    expect(within(screen.getByTestId('plan-lane-blocked')).getByText('Заблокировано')).toBeTruthy();
    expect(within(screen.getByTestId('plan-lane-done')).getByText('Завершено')).toBeTruthy();
  });

  it('2. places a task that carries a saved position exactly where it was left', () => {
    const project = twoPhaseProject();
    project.phases[0].tasks[0].canvasPosition = { x: 640, y: -320 };

    renderBoard(project);

    const card = screen.getByTestId('plan-card-a');
    expect(card.style.left).toBe('640px');
    expect(card.style.top).toBe('-320px');
  });

  it('3. never stacks two tasks on the same spot', () => {
    renderBoard(twoPhaseProject());

    const spots = new Set(
      ['a', 'b', 'c', 'd'].map((id) => {
        const card = screen.getByTestId(`plan-card-${id}`);
        return `${card.style.left}|${card.style.top}`;
      })
    );
    expect(spots.size).toBe(4);
  });

  it('4. says so when the plan has no tasks at all', () => {
    renderBoard(makeProject([]));
    expect(screen.getByText('В плане пока нет задач.')).toBeTruthy();
    expect(screen.queryByTestId('plan-card-a')).toBeNull();
  });
});

describe('Dragging a card on the board', () => {
  it('5. writes the new position to the project when the card is really moved', () => {
    const { onUpdateTaskPositions } = renderBoard(twoPhaseProject());

    const card = screen.getByTestId('plan-card-a');
    const before = { x: parseFloat(card.style.left), y: parseFloat(card.style.top) };

    dragCard('a', { x: 100, y: 100 }, { x: 250, y: 160 });

    expect(onUpdateTaskPositions).toHaveBeenCalledTimes(1);
    const saved = onUpdateTaskPositions.mock.calls[0][0];
    expect(Object.keys(saved)).toEqual(['a']);

    // The board is scaled to fit, so the distance is in world units: what must hold is that the
    // card followed the pointer in the same direction and the same proportion.
    const dx = saved.a.x - before.x;
    const dy = saved.a.y - before.y;
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBeGreaterThan(0);
    expect(dx / dy).toBeCloseTo(150 / 60, 6);
  });

  it('6. treats a click as a selection, not as a move', () => {
    const { onUpdateTaskPositions } = renderBoard(twoPhaseProject());

    const header = cardHeader('b');
    fireEvent.pointerDown(header, { pointerId: 2, button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(header, { pointerId: 2, clientX: 300, clientY: 300 });

    expect(onUpdateTaskPositions).not.toHaveBeenCalled();
    // The click is not lost: the card is now the selected one.
    expect(screen.getByTestId('plan-card-b').className).toContain('ring-2');
  });

  it('7. does not lose the card when the pointer is released twice', () => {
    const { onUpdateTaskPositions } = renderBoard(twoPhaseProject());

    const header = cardHeader('a');
    fireEvent.pointerDown(header, { pointerId: 3, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(header, { pointerId: 3, clientX: 90, clientY: 40 });
    fireEvent.pointerUp(header, { pointerId: 3, clientX: 90, clientY: 40 });
    fireEvent.pointerUp(header, { pointerId: 3, clientX: 90, clientY: 40 });

    expect(onUpdateTaskPositions).toHaveBeenCalledTimes(1);
  });

  it('8. keeps an untouched card out of the saved positions', () => {
    const { onUpdateTaskPositions } = renderBoard(twoPhaseProject());

    dragCard('c', { x: 400, y: 200 }, { x: 460, y: 260 });

    const saved = onUpdateTaskPositions.mock.calls[0][0];
    expect(saved.c).toBeTruthy();
    expect(saved.a).toBeUndefined();
    expect(saved.b).toBeUndefined();
  });
});

describe('The real controls stay usable on the board', () => {
  it('9. changes a status from the card’s own dropdown', () => {
    const { onUpdateTaskStatus } = renderBoard(twoPhaseProject());

    const select = within(screen.getByTestId('plan-card-a')).getByRole('combobox');
    fireEvent.change(select, { target: { value: 'completed' } });

    expect(onUpdateTaskStatus).toHaveBeenCalledWith('a', 'completed');
  });

  it('10. sends a task to the prompt compiler from the card', () => {
    const { onCompileTaskPrompt } = renderBoard(twoPhaseProject());

    fireEvent.click(within(screen.getByTestId('plan-card-b')).getByText('Компилировать промпт'));

    expect(onCompileTaskPrompt).toHaveBeenCalledWith('Task b');
  });

  it('11. leaves the plan screen for the columns when asked', () => {
    const { onSwitchToKanban } = renderBoard(twoPhaseProject());

    fireEvent.click(screen.getByText('Канбан'));

    expect(onSwitchToKanban).toHaveBeenCalledTimes(1);
  });
});

describe('Moving the board itself', () => {
  it('12. zooms with the buttons and reports the scale it is really at', () => {
    renderBoard(twoPhaseProject());

    const world = screen.getByTestId('plan-canvas-world');
    const before = world.style.transform;
    const readoutBefore = screen.getByTestId('canvas-zoom-readout').textContent;

    fireEvent.click(screen.getByLabelText('Приблизить'));

    expect(world.style.transform).not.toBe(before);
    expect(screen.getByTestId('canvas-zoom-readout').textContent).not.toBe(readoutBefore);
  });

  it('13. brings every card back into its lane when the plan is arranged again', () => {
    const project = twoPhaseProject();
    project.phases[0].tasks[0].canvasPosition = { x: 9000, y: 9000 };
    const { onUpdateTaskPositions } = renderBoard(project);

    fireEvent.click(screen.getByText('Разложить по дорожкам'));

    const arrangement = onUpdateTaskPositions.mock.calls[0][0];
    expect(Object.keys(arrangement).sort()).toEqual(['a', 'b', 'c', 'd']);
    // The scattered card comes home: no card is left out at 9000.
    expect(arrangement.a.y).toBeLessThan(9000);
    expect(arrangement.a.x).toBeLessThan(9000);
  });

  it('13b. arranges every card into the zone it is drawn in, not where the board would have put the zone', () => {
    const project = twoPhaseProject();
    // The user dragged the ready zone off its resting place and left one of its cards far away. This
    // is the board "Arrange into lanes" used to tidy: the cards were laid out from an empty placement
    // map, so they landed where the zones would have been if nobody had moved them — a plan scattered
    // out from under its own zones.
    project.canvasLanes = { ready: { offsetX: 420, offsetY: -160 } };
    project.phases[0].tasks[0].canvasPosition = { x: 9000, y: 9000 };
    const { onUpdateTaskPositions } = renderBoard(project);

    const zoneOf: Record<string, string> = { a: 'ready', b: 'active', c: 'blocked', d: 'done' };
    const drawn: Record<string, { x: number; y: number; width: number; height: number }> = {};
    for (const key of Object.values(zoneOf)) {
      const lane = screen.getByTestId(`plan-lane-${key}`);
      drawn[key] = {
        x: parseFloat(lane.style.left),
        y: parseFloat(lane.style.top),
        width: parseFloat(lane.style.width),
        height: parseFloat(lane.style.height)
      };
    }
    // The zone really is somewhere else: that is the case the button has to get right.
    expect(drawn.ready.x).toBe(420);
    expect(drawn.ready.y).toBe(-160);

    fireEvent.click(screen.getByText('Разложить по дорожкам'));

    const arrangement = onUpdateTaskPositions.mock.calls[0][0];
    for (const [id, key] of Object.entries(zoneOf)) {
      const card = arrangement[id];
      const zone = drawn[key];
      // Every card is inside the zone it belongs to as that zone is drawn — its whole rectangle, not
      // just its corner: a card that hangs over the edge of its zone is not arranged.
      expect(card.x).toBeGreaterThanOrEqual(zone.x);
      expect(card.y).toBeGreaterThanOrEqual(zone.y);
      expect(card.x + CARD_WIDTH).toBeLessThanOrEqual(zone.x + zone.width);
      expect(card.y + CARD_HEIGHT).toBeLessThanOrEqual(zone.y + zone.height);
    }
    // And the card left at 9000 is back in its own zone, one padding in from its corner.
    expect(arrangement.a).toEqual({ x: drawn.ready.x + 20, y: drawn.ready.y + 56 });
  });

  it('14. pans the whole board when empty space is dragged', () => {
    renderBoard(twoPhaseProject());

    const surface = screen.getByTestId('plan-canvas');
    const world = screen.getByTestId('plan-canvas-world');
    const before = world.style.transform;

    fireEvent.pointerDown(surface, { pointerId: 7, button: 0, clientX: 500, clientY: 400 });
    fireEvent.pointerMove(surface, { pointerId: 7, clientX: 560, clientY: 430 });
    fireEvent.pointerUp(surface, { pointerId: 7, clientX: 560, clientY: 430 });

    const after = world.style.transform;
    expect(after).not.toBe(before);
    // Dragging right and down moves the world right and down by the same amount.
    const shift = (transform: string) => transform.match(/translate3d\((-?[\d.]+)px, (-?[\d.]+)px/);
    const beforeShift = shift(before)!;
    const afterShift = shift(after)!;
    expect(Number(afterShift[1]) - Number(beforeShift[1])).toBeCloseTo(60, 1);
    expect(Number(afterShift[2]) - Number(beforeShift[2])).toBeCloseTo(30, 1);
  });

  it('15. jumps to a spot picked on the minimap', () => {
    renderBoard(twoPhaseProject());

    const world = screen.getByTestId('plan-canvas-world');
    const before = world.style.transform;

    fireEvent.pointerDown(screen.getByTestId('canvas-minimap'), { pointerId: 9, clientX: 20, clientY: 20 });

    expect(world.style.transform).not.toBe(before);
  });
});

describe('Dependency lines on the board', () => {
  it('16. draws one line per dependency and says what each one means', () => {
    renderBoard(linkedProject());

    const ready = screen.getByTestId('plan-link-a-b');
    const waiting = screen.getByTestId('plan-link-b-c');
    const blocked = screen.getByTestId('plan-link-c-d');

    expect(ready.getAttribute('data-link-state')).toBe('ready');
    expect(waiting.getAttribute('data-link-state')).toBe('waiting');
    expect(blocked.getAttribute('data-link-state')).toBe('blocked');

    // A line is a drawn route — a lead square out of the port, then a bend or a curve — not a
    // diagonal stab from one card to the other.
    expect(ready.getAttribute('d')).toMatch(/^M [\d.]+ [\d.]+ (L|C) /);
  });

  it('17. explains the colours instead of leaving the reader to guess', () => {
    renderBoard(linkedProject());

    const legend = screen.getByTestId('plan-links-legend');
    expect(within(legend).getByText('можно начинать')).toBeTruthy();
    expect(within(legend).getByText('ждёт зависимость')).toBeTruthy();
    expect(within(legend).getByText('начато раньше зависимости')).toBeTruthy();
    expect(within(legend).getByText('оба готовы')).toBeTruthy();
  });

  it('18. turns the lines off and on from the board controls', () => {
    renderBoard(linkedProject());

    expect(screen.getByTestId('plan-links')).toBeTruthy();

    fireEvent.click(screen.getByTestId('plan-links-toggle'));

    expect(screen.queryByTestId('plan-links')).toBeNull();
    expect(screen.queryByTestId('plan-links-legend')).toBeNull();

    fireEvent.click(screen.getByTestId('plan-links-toggle'));
    expect(screen.getByTestId('plan-links')).toBeTruthy();
  });

  it('19. marks what is waiting and what can be picked up today', () => {
    renderBoard(linkedProject());

    const waitingCard = screen.getByTestId('plan-card-c');
    const readyCard = screen.getByTestId('plan-card-b');

    // `c` waits for one unfinished task; `b` waits for nothing.
    expect(within(waitingCard).getByText('ждёт 1')).toBeTruthy();
    expect(within(readyCard).getByText('можно начинать')).toBeTruthy();
    expect(within(readyCard).queryByText(/^ждёт/)).toBeNull();
  });

  it('20. tells the truth about a dependency that points at nothing', () => {
    const project = makeProject([
      {
        id: 'phase_0',
        phaseNumber: 1,
        title: 'Core',
        purpose: '',
        deliverable: '',
        tasks: [makeTask('a', 'ready', { dependencies: ['ghost'] })]
      }
    ]);

    renderBoard(project);

    const warning = screen.getByTestId('plan-links-missing');
    expect(warning.textContent).toContain('ghost');
    // Nothing is drawn, and nothing is silently pretended to be fine either.
    expect(screen.queryByTestId('plan-links')).toBeNull();
    expect(screen.queryByTestId('plan-links-toggle')).toBeNull();
  });

  it('21. keeps the line attached to a card while it is being dragged', () => {
    renderBoard(linkedProject());

    const path = screen.getByTestId('plan-link-a-b');
    const before = path.getAttribute('d');

    const header = cardHeader('b');
    fireEvent.pointerDown(header, { pointerId: 11, button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(header, { pointerId: 11, clientX: 320, clientY: 260 });

    expect(path.getAttribute('d')).not.toBe(before);
  });

  it('22. draws nothing at all on a plan without dependencies', () => {
    renderBoard(twoPhaseProject());

    expect(screen.queryByTestId('plan-links')).toBeNull();
    expect(screen.queryByTestId('plan-links-toggle')).toBeNull();
    expect(screen.queryByTestId('plan-links-legend')).toBeNull();
  });

  it('23. marks where each line meets a card, so a link reads as attached', () => {
    renderBoard(linkedProject());

    const line = screen.getByTestId('plan-link-a-b');
    const group = line.parentElement!;
    const anchors = group.querySelectorAll('circle[data-anchor]');

    expect(anchors).toHaveLength(2);
    expect([...anchors].map((node) => node.getAttribute('data-anchor'))).toEqual(['from', 'to']);
  });

  it('24. explains a link next to the link when the pointer is on it', () => {
    renderBoard(linkedProject());

    expect(screen.queryByTestId('plan-link-label')).toBeNull();

    fireEvent.pointerOver(screen.getByTestId('plan-link-hit-a-b'));

    const label = screen.getByTestId('plan-link-label');
    expect(label.getAttribute('data-link-state')).toBe('ready');
    expect(label.textContent).toContain('Task a');
    expect(label.textContent).toContain('Task b');

    fireEvent.pointerOut(screen.getByTestId('plan-link-hit-a-b'));
    expect(screen.queryByTestId('plan-link-label')).toBeNull();
  });

  it('25. fades the links that have nothing to do with the card under the pointer', () => {
    renderBoard(linkedProject());

    // `a` is linked to `b`, and `b` to `c`: looking at `a` must leave `b->c` out of the way.
    expect(screen.getByTestId('plan-link-b-c').getAttribute('data-link-muted')).toBeNull();

    fireEvent.pointerOver(screen.getByTestId('plan-card-a'));

    expect(screen.getByTestId('plan-link-a-b').getAttribute('data-link-muted')).toBeNull();
    expect(screen.getByTestId('plan-link-b-c').getAttribute('data-link-muted')).toBe('true');

    fireEvent.pointerOut(screen.getByTestId('plan-card-a'));
    expect(screen.getByTestId('plan-link-b-c').getAttribute('data-link-muted')).toBeNull();
  });
});

describe('What a card keeps at every zoom', () => {
  it('26. never loses the compile button, however far the board is zoomed out', () => {
    const { onCompileTaskPrompt } = renderBoard(twoPhaseProject());
    const card = () => screen.getByTestId('plan-card-a');

    // At 1:1 the button says what it does.
    fireEvent.click(screen.getByTestId('canvas-zoom-readout'));
    expect(within(within(card()).getByTestId('plan-compile-a')).getByText('Компилировать промпт')).toBeTruthy();

    /*
     * The button the screen exists for used to disappear below 60% — which is where "fit the plan"
     * lands on a four-lane board, so it vanished exactly when the whole plan was being looked at.
     * It is never hidden now; past the point where a label would be four pixels tall it is drawn as
     * an icon button instead, and it is still the thing that compiles the prompt.
     */
    for (let i = 0; i < 6; i += 1) {
      fireEvent.click(screen.getByLabelText('Отдалить'));
    }

    expect(card().getAttribute('data-compact')).toBe('true');
    const button = within(card()).getByTestId('plan-compile-a');
    expect(within(button).queryByText('Компилировать промпт')).toBeNull();
    expect(button.getAttribute('aria-label')).toBe('Компилировать промпт');

    expect(within(card()).getByRole('combobox')).toBeTruthy();
    expect(within(card()).getByText('Goal of a')).toBeTruthy();

    fireEvent.click(button);
    expect(onCompileTaskPrompt).toHaveBeenCalledWith('Task a');
  });

  it('27. keeps the dot grid on at every zoom, instead of switching the background off', () => {
    renderBoard(twoPhaseProject());

    const surface = screen.getByTestId('plan-canvas');
    const scales = [1, 4, 6].map(() => {
      fireEvent.click(screen.getByLabelText('Отдалить'));
      return surface.style.backgroundImage;
    });

    for (const image of scales) {
      expect(image).toContain('radial-gradient');
      expect(image).not.toBe('none');
      // Two levels of dots, crossfaded: the band between them is what keeps the density smooth.
      expect(image.split('radial-gradient').length - 1).toBeGreaterThanOrEqual(1);
      expect(image.split('radial-gradient').length - 1).toBeLessThanOrEqual(2);
    }

    // The on-screen spacing stays inside the readable window instead of collapsing into a haze.
    const spacing = parseFloat(surface.style.backgroundSize.split('px')[0]);
    const scale = Number(screen.getByTestId('canvas-zoom-readout').textContent!.replace('%', '')) / 100;
    expect(spacing / scale).toBeGreaterThanOrEqual(15);
  });
});

describe('Two dependencies, one input', () => {
  it('30. draws one arrowhead into a card, however many links feed it', () => {
    renderBoard(fanInProject());

    // One stem meets the card, in the middle of the side the group arrives at…
    const trunk = screen.getByTestId('plan-trunk-target-top');
    expect(trunk.getAttribute('d')).toBe('M 152 444 L 152 484');
    expect(trunk.getAttribute('marker-end')).toContain('plan-link-arrow-waiting');

    const port = screen.getByTestId('plan-trunk-port-target-top');
    expect(port.getAttribute('cx')).toBe('152');
    expect(port.getAttribute('cy')).toBe('484');
    expect(screen.getAllByTestId(/^plan-trunk-port-/)).toHaveLength(1);

    // …and the links that feed it carry no arrowhead of their own: the group has one, at the end.
    expect(screen.getByTestId('plan-link-hub-target').getAttribute('marker-end')).toBeNull();
    expect(screen.getByTestId('plan-link-other-target').getAttribute('marker-end')).toBeNull();

    // The lines that do not share an input still end on their own card, arrowhead and all.
    expect(screen.queryByTestId('plan-trunk-hub-top')).toBeNull();
    expect(screen.getByTestId('plan-link-hub-target').getAttribute('d')).not.toContain('C');
  });
});

describe('Grabbing a card where the user actually grabs it', () => {
  it('28. drags a card from its body, not only from the header strip', () => {
    const { onUpdateTaskPositions } = renderBoard(twoPhaseProject());

    const card = screen.getByTestId('plan-card-a');
    const before = { x: parseFloat(card.style.left), y: parseFloat(card.style.top) };

    fireEvent.pointerDown(within(card).getByText('Goal of a'), {
      pointerId: 21,
      button: 0,
      clientX: 120,
      clientY: 120
    });
    fireEvent.pointerMove(window, { pointerId: 21, clientX: 200, clientY: 180 });
    fireEvent.pointerUp(window, { pointerId: 21, clientX: 200, clientY: 180 });

    expect(onUpdateTaskPositions).toHaveBeenCalledTimes(1);
    const saved = onUpdateTaskPositions.mock.calls[0][0];
    expect(saved.a.x).not.toBeCloseTo(before.x, 3);
    expect(saved.a.y).toBeGreaterThan(before.y);
  });

  it('29. keeps following the pointer after it has left the card', () => {
    const { onUpdateTaskPositions } = renderBoard(twoPhaseProject());

    const header = cardHeader('b');
    fireEvent.pointerDown(header, { pointerId: 31, button: 0, clientX: 300, clientY: 300 });

    // The pointer is nowhere near the card any more — over the board, then over the page. A drag
    // that only listened on the card itself would have stopped at the first of these moves.
    fireEvent.pointerMove(screen.getByTestId('plan-canvas'), {
      pointerId: 31,
      clientX: 520,
      clientY: 420
    });
    fireEvent.pointerMove(document.body, { pointerId: 31, clientX: 600, clientY: 470 });
    fireEvent.pointerUp(document.body, { pointerId: 31, clientX: 600, clientY: 470 });

    expect(onUpdateTaskPositions).toHaveBeenCalledTimes(1);
    expect(Object.keys(onUpdateTaskPositions.mock.calls[0][0])).toEqual(['b']);
  });

  it('30. leaves a press that lands on a control to that control', () => {
    const { onUpdateTaskPositions, onCompileTaskPrompt } = renderBoard(twoPhaseProject());

    const button = within(screen.getByTestId('plan-card-a')).getByText('Компилировать промпт');
    fireEvent.pointerDown(button, { pointerId: 41, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 41, clientX: 220, clientY: 220 });
    fireEvent.pointerUp(window, { pointerId: 41, clientX: 220, clientY: 220 });

    // A drag that started on the button would have moved the card instead of pressing the button.
    expect(onUpdateTaskPositions).not.toHaveBeenCalled();

    fireEvent.click(button);
    expect(onCompileTaskPrompt).toHaveBeenCalledWith('Task a');
  });

  it('31. does not move a card for a press that never moved', () => {
    const { onUpdateTaskPositions } = renderBoard(twoPhaseProject());

    fireEvent.pointerDown(screen.getByTestId('plan-card-b'), {
      pointerId: 51,
      button: 0,
      clientX: 250,
      clientY: 250
    });
    fireEvent.pointerUp(window, { pointerId: 51, clientX: 250, clientY: 250 });

    expect(onUpdateTaskPositions).not.toHaveBeenCalled();
    expect(screen.getByTestId('plan-card-b').className).toContain('ring-2');
  });
});

/**
 * The zones of the board are the user's. A lane used to be four fixed bands of code — the name, the
 * colour and the place were the app's, not the plan author's — and a card carried a name nobody
 * could change without opening some other screen. Both are now answered where the question is asked:
 * right-click the lane, right-click the card, and drag the lane by its header.
 */
describe('The lanes and cards the user owns', () => {
  it('32. renames a lane from its own right-click menu', () => {
    const { onUpdateCanvasLanes } = renderBoard(twoPhaseProject());

    fireEvent.contextMenu(screen.getByTestId('plan-lane-done'), { clientX: 400, clientY: 300 });

    const menu = screen.getByTestId('plan-context-menu');
    expect(menu.getAttribute('data-menu-for')).toBe('lane-done');

    // The field arrives holding the name the lane has now, so the user edits instead of retyping.
    const field = screen.getByTestId('plan-context-rename') as HTMLInputElement;
    expect(field.value).toBe('Завершено');

    fireEvent.change(field, { target: { value: 'Выпущено' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(onUpdateCanvasLanes).toHaveBeenCalledTimes(1);
    expect(onUpdateCanvasLanes.mock.calls[0][0].done).toEqual({ label: 'Выпущено' });
    // The menu is done with; the board it changed is what the user is looking at again.
    expect(screen.queryByTestId('plan-context-menu')).toBeNull();
  });

  it('33. colours a lane from the same menu, and starts the cards in it off in that colour', () => {
    const { onUpdateCanvasLanes } = renderBoard(twoPhaseProject());

    fireEvent.contextMenu(screen.getByTestId('plan-lane-blocked'), { clientX: 500, clientY: 320 });
    fireEvent.click(screen.getByTestId('plan-lane-color-rose'));

    expect(onUpdateCanvasLanes.mock.calls[0][0].blocked).toEqual({ color: 'rose' });
    expect(screen.queryByTestId('plan-context-menu')).toBeNull();
  });

  it('34. draws a lane with the name and the colour the project carries', () => {
    const project = twoPhaseProject();
    project.canvasLanes = { done: { label: 'Выпущено', color: 'cyan' }, blocked: { offsetX: 200 } };

    renderBoard(project);

    const lane = screen.getByTestId('plan-lane-done');
    expect(within(lane).getByText('Выпущено')).toBeTruthy();
    expect(within(lane).queryByText('Завершено')).toBeNull();
    expect(lane.className).toContain('border-cyan-900/60');
    expect(lane.querySelector('span')!.className).toContain('bg-cyan-400');
    // The card inside says the same thing the zone around it says.
    expect(screen.getByTestId('plan-card-d').className).toContain('border-l-cyan-500');

    // A lane nobody renamed keeps the name its status has always had.
    expect(within(screen.getByTestId('plan-lane-active')).getByText('В работе и на проверке')).toBeTruthy();
  });

  it('35. offers to put a changed lane back the way it was', () => {
    const project = twoPhaseProject();
    project.canvasLanes = { blocked: { label: 'Ждёт заказчика', color: 'rose' } };
    const { onUpdateCanvasLanes } = renderBoard(project);

    fireEvent.contextMenu(screen.getByTestId('plan-lane-blocked'), { clientX: 320, clientY: 260 });
    fireEvent.click(screen.getByTestId('plan-lane-reset'));

    // The map written back has no entry for that lane at all, which is what "no change" means.
    expect(onUpdateCanvasLanes.mock.calls[0][0]).toEqual({});
  });

  it('36. does not offer to reset a lane nobody has touched', () => {
    renderBoard(twoPhaseProject());

    fireEvent.contextMenu(screen.getByTestId('plan-lane-ready'), { clientX: 120, clientY: 120 });

    expect(screen.getByTestId('plan-context-menu')).toBeTruthy();
    expect(screen.queryByTestId('plan-lane-reset')).toBeNull();
  });

  it('37. moves a lane by its header and takes the cards the board laid out with it', () => {
    const { onUpdateCanvasLanes } = renderBoard(twoPhaseProject());

    const lane = screen.getByTestId('plan-lane-ready');
    // `a` was never placed by hand, so it belongs to its lane; `c` is in another lane entirely.
    const card = screen.getByTestId('plan-card-a');
    const before = {
      lane: parseFloat(lane.style.left),
      card: parseFloat(card.style.left),
      other: parseFloat(screen.getByTestId('plan-card-c').style.left),
      neighbour: parseFloat(screen.getByTestId('plan-lane-active').style.left)
    };

    fireEvent.pointerDown(screen.getByTestId('plan-lane-header-ready'), {
      pointerId: 61,
      button: 0,
      clientX: 200,
      clientY: 200
    });
    fireEvent.pointerMove(window, { pointerId: 61, clientX: 320, clientY: 260 });

    // While the lane is in the hand its cards are in it: both moved by the same world distance.
    const laneShift = parseFloat(lane.style.left) - before.lane;
    expect(laneShift).toBeGreaterThan(0);
    expect(parseFloat(card.style.left) - before.card).toBeCloseTo(laneShift, 6);
    expect(parseFloat(screen.getByTestId('plan-card-c').style.left)).toBe(before.other);

    /*
     * Pushed towards its neighbour, the zone leans on it instead of lying on it: the two plates
     * share an edge, and the neighbour itself has not moved a pixel.
     */
    const drawn = { left: parseFloat(lane.style.left), top: parseFloat(lane.style.top) };
    const neighbour = parseFloat(screen.getByTestId('plan-lane-active').style.left);
    expect(drawn.left + parseFloat(lane.style.width)).toBeCloseTo(neighbour, 0);
    expect(neighbour).toBe(before.neighbour);

    fireEvent.pointerUp(window, { pointerId: 61, clientX: 320, clientY: 260 });

    const saved = onUpdateCanvasLanes.mock.calls[0][0];
    expect(Object.keys(saved)).toEqual(['ready']);
    // What is stored is where the zone was drawn, not where the pointer went: the first lane rests
    // at the board's origin, so its saved offset is its drawn position.
    expect(saved.ready.offsetX).toBeCloseTo(drawn.left, 0);
    expect(saved.ready.offsetY).toBeCloseTo(drawn.top, 0);
    // The pointer went further right than the zone could: the vertical move was free and the
    // horizontal one was stopped by the neighbour.
    expect(saved.ready.offsetY).toBeGreaterThan(saved.ready.offsetX);
  });

  it('39. stretches a zone wider by its right edge, and stops at the zone beside it', () => {
    const { onUpdateCanvasLanes } = renderBoard(twoPhaseProject());

    const lane = screen.getByTestId('plan-lane-ready');
    const beforeWidth = parseFloat(lane.style.width);
    const neighbour = parseFloat(screen.getByTestId('plan-lane-active').style.left);
    const left = parseFloat(lane.style.left);

    const grip = screen.getByTestId('plan-lane-resize-x-ready');
    fireEvent.pointerDown(grip, { pointerId: 91, button: 0, clientX: 300, clientY: 300 });
    // Far enough that the zone would swallow its neighbour if nothing stopped it.
    fireEvent.pointerMove(window, { pointerId: 91, clientX: 900, clientY: 300 });

    const drawnWidth = parseFloat(lane.style.width);
    expect(drawnWidth).toBeGreaterThan(beforeWidth);
    // Stretching leans the same way moving does: it stops at the edge it meets.
    expect(left + drawnWidth).toBeCloseTo(neighbour, 0);
    expect(drawnWidth).toBeLessThan(neighbour - left + 1);

    fireEvent.pointerUp(window, { pointerId: 91, clientX: 900, clientY: 300 });

    const saved = onUpdateCanvasLanes.mock.calls[0][0];
    expect(Object.keys(saved)).toEqual(['ready']);
    expect(saved.ready.width).toBeCloseTo(drawnWidth, 0);
    // Only the axis the grip belongs to is written: widening a zone must not also pin the height it
    // happened to have while it was being widened.
    expect(saved.ready.height).toBeUndefined();
    expect(saved.ready.offsetX).toBeUndefined();
  });

  it('40. makes a zone deeper by its bottom edge, and both ways at once by its corner', () => {
    const { onUpdateCanvasLanes } = renderBoard(twoPhaseProject());

    const lane = screen.getByTestId('plan-lane-done');
    const before = { width: parseFloat(lane.style.width), height: parseFloat(lane.style.height) };

    const bottom = screen.getByTestId('plan-lane-resize-y-done');
    fireEvent.pointerDown(bottom, { pointerId: 92, button: 0, clientX: 400, clientY: 400 });
    fireEvent.pointerMove(window, { pointerId: 92, clientX: 400, clientY: 560 });
    const deeper = parseFloat(lane.style.height);
    expect(deeper).toBeGreaterThan(before.height);
    // The width is the same number it was: the bottom grip is the bottom grip.
    expect(parseFloat(lane.style.width)).toBe(before.width);
    fireEvent.pointerUp(window, { pointerId: 92, clientX: 400, clientY: 560 });

    expect(onUpdateCanvasLanes.mock.calls[0][0].done.height).toBeCloseTo(deeper, 0);
    expect(onUpdateCanvasLanes.mock.calls[0][0].done.width).toBeUndefined();

    const corner = screen.getByTestId('plan-lane-resize-xy-done');
    fireEvent.pointerDown(corner, { pointerId: 93, button: 0, clientX: 400, clientY: 560 });
    fireEvent.pointerMove(window, { pointerId: 93, clientX: 470, clientY: 700 });
    // Each gesture here starts from the project's own numbers — the mock does not feed the store
    // back — so the corner is compared with what the board draws, not with the previous gesture.
    const both = { width: parseFloat(lane.style.width), height: parseFloat(lane.style.height) };
    expect(both.width).toBeGreaterThan(before.width);
    expect(both.height).toBeGreaterThan(before.height);
    fireEvent.pointerUp(window, { pointerId: 93, clientX: 470, clientY: 700 });

    const saved = onUpdateCanvasLanes.mock.calls[1][0].done;
    expect(saved.width).toBeCloseTo(both.width, 0);
    expect(saved.height).toBeCloseTo(both.height, 0);
  });

  it('41. moves a zone for a press on its body, and never pans the board under it', () => {
    const { onUpdateCanvasLanes } = renderBoard(twoPhaseProject());

    const lane = screen.getByTestId('plan-lane-ready');
    const world = screen.getByTestId('plan-canvas-world');
    const before = parseFloat(lane.style.left);
    const worldBefore = world.style.transform;

    // The whole body of a zone is a handle: a press that misses every card lands on the zone. It used
    // to be a press on nothing — the zone could only be picked up by its 56px strip, which left the
    // largest part of the plate doing nothing at all.
    fireEvent.pointerDown(lane, { pointerId: 81, button: 0, clientX: 240, clientY: 260 });
    fireEvent.pointerMove(window, { pointerId: 81, clientX: 460, clientY: 380 });
    fireEvent.pointerUp(window, { pointerId: 81, clientX: 460, clientY: 380 });

    expect(onUpdateCanvasLanes).toHaveBeenCalledTimes(1);
    expect(onUpdateCanvasLanes.mock.calls[0][0].ready.offsetX).toBeGreaterThan(0);
    // …and the board under the zone stayed where it was: a press on a zone is the zone's, never the
    // canvas's. Empty space beside the zones is still how the canvas is panned. The zone itself is
    // drawn back at its stored place here, because the mock does not feed the write back — the
    // number the mock was handed is the place the user watched land, which test 48 pins down.
    expect(world.style.transform).toBe(worldBefore);
    expect(parseFloat(lane.style.left)).toBe(before);
  });

  it('42. draws a zone on a plate of its own, with a handle you can find', () => {
    renderBoard(twoPhaseProject());

    const lane = screen.getByTestId('plan-lane-ready');
    // Not a dashed outline with the board showing through it: a zone is a place, and it is drawn
    // as one — while the grid and the cards on top of it stay the brightest thing in the frame.
    expect(lane.className).toContain('bg-slate-900/85');
    expect(lane.className).not.toContain('bg-slate-900/25');

    const handle = screen.getByTestId('plan-lane-header-ready');
    expect(handle.className).toContain('cursor-grab');
    expect(handle.className).toContain('bg-slate-950/45');
    expect(within(handle).getByText('Готово к работе')).toBeTruthy();

    // All three ways to stretch a zone are offered, on every zone.
    for (const key of ['ready', 'active', 'blocked', 'done']) {
      expect(screen.getByTestId(`plan-lane-resize-x-${key}`)).toBeTruthy();
      expect(screen.getByTestId(`plan-lane-resize-y-${key}`)).toBeTruthy();
      expect(screen.getByTestId(`plan-lane-resize-xy-${key}`)).toBeTruthy();
    }
  });

  it('47. carries the cards lying on a zone, including the ones placed by hand', () => {
    /*
     * The zone is a place, and the cards on it are in that place: dragging it either takes them or
     * leaves them standing in a patch of board the user has just said is somewhere else. What is
     * carried is decided by the card's centre, so the zone travels with what is *on* it.
     */
    const project = twoPhaseProject();
    project.phases[0].tasks.push(makeTask('e', 'ready'));

    // The zone's own rectangle is the board's business, so it is read from the board instead of
    // being guessed from the constants: the test then pins the behaviour, not the arithmetic.
    const probe = renderBoard(project);
    const laneNode = screen.getByTestId('plan-lane-ready');
    const rect = {
      left: parseFloat(laneNode.style.left),
      top: parseFloat(laneNode.style.top),
      width: parseFloat(laneNode.style.width)
    };
    probe.unmount();

    // `a` belongs to this zone and was placed by hand; `c` belongs to another lane but has been
    // parked on this one; `e` nobody ever placed.
    project.phases[0].tasks[0].canvasPosition = { x: rect.left + 10, y: rect.top + 80 };
    project.phases[1].tasks[0].canvasPosition = { x: rect.left + rect.width - 154, y: rect.top + 80 };

    const { onUpdateCanvasLanes, onUpdateTaskPositions } = renderBoard(project);

    const lane = screen.getByTestId('plan-lane-ready');
    const placed = screen.getByTestId('plan-card-a');
    const parked = screen.getByTestId('plan-card-c');
    const laidOut = screen.getByTestId('plan-card-e');
    const before = {
      laneTop: parseFloat(lane.style.top),
      placedTop: parseFloat(placed.style.top),
      parkedTop: parseFloat(parked.style.top),
      laidOutTop: parseFloat(laidOut.style.top)
    };

    fireEvent.pointerDown(screen.getByTestId('plan-lane-header-ready'), {
      pointerId: 91,
      button: 0,
      clientX: 200,
      clientY: 200
    });
    // Straight down, where no neighbour is in the way: the zone travels the whole way.
    fireEvent.pointerMove(window, { pointerId: 91, clientX: 200, clientY: 330 });

    // The pointer's distance is divided by the zoom on the way in, and the board opens fitted to the
    // window, so the zone's own travel is what the assertions are written against.
    const laneShift = parseFloat(lane.style.top) - before.laneTop;
    expect(laneShift).toBeGreaterThan(0);
    // While the zone is in the hand, everything on it is in the hand: both hand-placed cards move by
    // the very distance the zone moved, and the card nobody placed follows its lane as always.
    expect(parseFloat(placed.style.top) - before.placedTop).toBeCloseTo(laneShift, 6);
    expect(parseFloat(parked.style.top) - before.parkedTop).toBeCloseTo(laneShift, 6);
    expect(parseFloat(laidOut.style.top) - before.laidOutTop).toBeCloseTo(laneShift, 6);

    fireEvent.pointerUp(window, { pointerId: 91, clientX: 200, clientY: 330 });

    /*
     * The zone is stored where it landed, and the cards lying on it are written down in the very same
     * call, moved by the same distance — the step the zone itself is stored as having taken, so a card
     * keeps its place in the zone drag after drag. Only the cards placed by hand: the one nobody placed
     * would be frozen by a position of its own, and the plan is still allowed to lay it out.
     *
     * One call rather than two is the point: a project update is built from the project as it was when
     * the gesture began, so a second call would rebuild from a snapshot without the first change in it.
     */
    const step = Math.round(laneShift);
    expect(onUpdateCanvasLanes).toHaveBeenCalledTimes(1);
    const [lanes, moved] = onUpdateCanvasLanes.mock.calls[0];
    expect(lanes.ready.offsetY).toBe(step);
    expect(lanes.ready.offsetX).toBe(0);
    expect(Object.keys(moved).sort()).toEqual(['a', 'c']);
    expect(moved.a).toEqual({ x: rect.left + 10, y: rect.top + 80 + step });
    expect(moved.c).toEqual({ x: rect.left + rect.width - 154, y: rect.top + 80 + step });
    expect(onUpdateTaskPositions).not.toHaveBeenCalled();
  });

  it('48. picks a zone up by its empty body, not only by its handle', () => {
    const { onUpdateCanvasLanes } = renderBoard(twoPhaseProject());

    const body = screen.getByTestId('plan-lane-ready');
    const before = parseFloat(body.style.top);

    // A press on the zone itself — the empty space under the card in it — is a press on the zone.
    fireEvent.pointerDown(body, { pointerId: 101, button: 0, clientX: 300, clientY: 400 });
    fireEvent.pointerMove(window, { pointerId: 101, clientX: 300, clientY: 500 });

    const moving = parseFloat(screen.getByTestId('plan-lane-ready').style.top);
    expect(moving).toBeGreaterThan(before);

    fireEvent.pointerUp(window, { pointerId: 101, clientX: 300, clientY: 500 });

    expect(onUpdateCanvasLanes).toHaveBeenCalledTimes(1);
    expect(onUpdateCanvasLanes.mock.calls[0][0].ready.offsetY).toBe(Math.round(moving - before));
  });

  it('49. leaves a zone alone when the press lands on a card standing in it', () => {
    const { onUpdateCanvasLanes, onUpdateTaskPositions } = renderBoard(twoPhaseProject());

    // The cards are drawn over the zone rather than inside it, so the card takes the press: a card
    // dragged by its body moves the card, and the zone under it does not move at all.
    dragCard('a', { x: 200, y: 200 }, { x: 260, y: 260 });

    expect(onUpdateTaskPositions).toHaveBeenCalledTimes(1);
    expect(onUpdateCanvasLanes).not.toHaveBeenCalled();
  });

  it('43. treats a press on a lane header that never moved as a click, not a move', () => {
    const { onUpdateCanvasLanes } = renderBoard(twoPhaseProject());

    const header = screen.getByTestId('plan-lane-header-active');
    fireEvent.pointerDown(header, { pointerId: 71, button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(window, { pointerId: 71, clientX: 300, clientY: 300 });

    expect(onUpdateCanvasLanes).not.toHaveBeenCalled();
  });

  it('44. renames a task from the card’s right-click menu', () => {
    const { onUpdateTaskTitle, onUpdateTaskPositions } = renderBoard(twoPhaseProject());

    fireEvent.contextMenu(screen.getByTestId('plan-card-a'), { clientX: 260, clientY: 240 });

    const menu = screen.getByTestId('plan-context-menu');
    expect(menu.getAttribute('data-menu-for')).toBe('task-a');
    // A task has a name, not a colour: the swatches belong to the lane menu only.
    expect(within(menu).queryByTestId('plan-lane-color-rose')).toBeNull();

    const field = screen.getByTestId('plan-context-rename') as HTMLInputElement;
    expect(field.value).toBe('Task a');
    fireEvent.change(field, { target: { value: 'Налить пиво' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(onUpdateTaskTitle).toHaveBeenCalledWith('a', 'Налить пиво');
    // Right-clicking a card is not a way to move it.
    expect(onUpdateTaskPositions).not.toHaveBeenCalled();
  });

  it('45. refuses an empty name and closes on Escape', () => {
    const { onUpdateTaskTitle } = renderBoard(twoPhaseProject());

    fireEvent.contextMenu(screen.getByTestId('plan-card-b'), { clientX: 200, clientY: 200 });
    const field = screen.getByTestId('plan-context-rename') as HTMLInputElement;

    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onUpdateTaskTitle).not.toHaveBeenCalled();

    // Escape is the way out without changing anything.
    fireEvent.contextMenu(screen.getByTestId('plan-card-b'), { clientX: 200, clientY: 200 });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('plan-context-menu')).toBeNull();
  });

  it('46. draws a zone at the size it was stretched to, and offers to put it back', () => {
    const project = twoPhaseProject();
    project.canvasLanes = { done: { width: 520, height: 700 } };
    const { onUpdateCanvasLanes } = renderBoard(project);

    // The size the user gave the zone is the size it is drawn at, when the project is opened again.
    const lane = screen.getByTestId('plan-lane-done');
    expect(parseFloat(lane.style.width)).toBe(520);
    expect(parseFloat(lane.style.height)).toBe(700);

    // A zone nobody renamed and nobody moved, but which was stretched, is a zone they changed.
    fireEvent.contextMenu(lane, { clientX: 400, clientY: 300 });
    fireEvent.click(screen.getByTestId('plan-lane-reset'));

    expect(onUpdateCanvasLanes.mock.calls[0][0]).toEqual({});
  });
});
