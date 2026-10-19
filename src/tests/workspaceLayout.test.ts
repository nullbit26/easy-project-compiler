import { describe, expect, it } from 'vitest';
import {
  addPane,
  MAX_EXTRA_PANES,
  parseWorkspace,
  removePane,
  SCREEN_PATHS,
  setPanePath,
  splitShares,
  WORKSPACE_STORAGE_KEY
} from '../components/workspace/workspaceLayout';

/**
 * The panes that sit beside the current screen.
 *
 * The workspace is a row of columns: the screen the route names, then whatever was opened with the
 * plus. The arithmetic is small but it is arithmetic with a stored copy of itself, so it is checked
 * here rather than through a dragged pointer: shares always add up, a screen is never open twice,
 * and a stored row is read only as far as it still describes a window somebody can see.
 */
describe('Workspace panes', () => {
  it('1. starts as one screen and grows a column per pane, with even shares', () => {
    const empty = parseWorkspace(null);
    expect(empty).toEqual({ panes: [], shares: [100] });

    const one = addPane(empty);
    expect(one.panes).toHaveLength(1);
    expect(one.panes[0].path).toBeNull();
    expect(one.shares).toEqual([50, 50]);

    const two = addPane(one);
    expect(two.panes).toHaveLength(2);
    expect(two.panes.map((pane) => pane.id)).toEqual(['w1', 'w2']);
    expect(two.shares).toEqual(splitShares(3));

    // The cap keeps the last column readable instead of letting the row become a filmstrip.
    let full = two;
    while (full.panes.length < MAX_EXTRA_PANES) full = addPane(full);
    expect(addPane(full)).toBe(full);
  });

  it('2. closing a pane closes its column and re-shares the row', () => {
    const two = addPane(addPane(parseWorkspace(null)));
    const closed = removePane(two, 'w1');
    expect(closed.panes.map((pane) => pane.id)).toEqual(['w2']);
    expect(closed.shares).toEqual([50, 50]);

    const last = removePane(closed, 'w2');
    expect(last).toEqual({ panes: [], shares: [100] });

    // An id that is not in the row removes nothing at all.
    expect(removePane(two, 'nope')).toBe(two);
  });

  it('3. picking a screen moves it out of the pane that was showing it', () => {
    const two = addPane(addPane(parseWorkspace(null)));
    const withScreens = setPanePath(setPanePath(two, 'w1', '/plan'), 'w2', '/compiler');
    expect(withScreens.panes.map((pane) => pane.path)).toEqual(['/plan', '/compiler']);

    // The same screen twice would be two live boards fighting over one selection.
    const moved = setPanePath(withScreens, 'w2', '/plan');
    expect(moved.panes.map((pane) => pane.path)).toEqual([null, '/plan']);

    // Clearing one is how a pane asks what goes there next.
    expect(setPanePath(moved, 'w2', null).panes.map((pane) => pane.path)).toEqual([null, null]);
  });

  it('4. a stored row is trusted only as far as it still makes sense', () => {
    const real = addPane(parseWorkspace(null));
    expect(parseWorkspace(JSON.stringify(real))).toEqual(real);

    // A screen that does not exist, or the studio (which is a workspace of its own), cannot be a
    // column beside the current one.
    expect(SCREEN_PATHS).not.toContain('/studio');
    const unknown = parseWorkspace(
      JSON.stringify({ panes: [{ id: 'w1', path: '/nope' }], shares: [50, 50] })
    );
    expect(unknown).toEqual({ panes: [], shares: [100] });

    // Duplicate ids or duplicate screens collapse instead of drawing two panes with one key.
    expect(
      parseWorkspace(
        JSON.stringify({
          panes: [
            { id: 'w1', path: '/plan' },
            { id: 'w1', path: '/files' }
          ],
          shares: [50, 25, 25]
        })
      ).panes
    ).toHaveLength(1);

    // Shares that do not match the columns, or squeeze one to nothing, are re-shared evenly.
    expect(
      parseWorkspace(JSON.stringify({ panes: [{ id: 'w1', path: '/plan' }], shares: [95, 5] })).shares
    ).toEqual([50, 50]);
    expect(
      parseWorkspace(JSON.stringify({ panes: [{ id: 'w1', path: '/plan' }], shares: [100] })).shares
    ).toEqual([50, 50]);

    // Garbage is the empty workspace, not a broken row.
    expect(parseWorkspace('not json')).toEqual({ panes: [], shares: [100] });

    // The key the app writes under is stable: a rename would silently close everyone's panes.
    expect(WORKSPACE_STORAGE_KEY).toBe('easy_project_compiler_workspace');
  });

  it('5. a new pane takes the next free id of the row that is on screen', () => {
    const state = setPanePath(addPane(addPane(parseWorkspace(null))), 'w1', '/plan');
    const closed = removePane(state, 'w2');
    // The closed pane's id is reusable: it is not on screen any more, so nothing shares its key.
    expect(addPane(closed).panes.map((pane) => pane.id)).toEqual(['w1', 'w2']);
  });
});
