import { describe, expect, it } from 'vitest';
import {
  adjustSizes,
  assignPanel,
  defaultStudioState,
  insertPane,
  MAX_PANES,
  MIN_PANE_PERCENT,
  nextSlotId,
  parseStudioState,
  presetPanels,
  presetState,
  PRESET_TREES,
  removePane,
  slotsOf,
  splitsOf,
  STUDIO_PRESETS,
  STUDIO_STORAGE_KEY,
  type StudioState
} from '../components/studio/studioLayout';

/**
 * The studio's layout arithmetic.
 *
 * A split is two numbers that must keep adding up, a window exists once, an added window lands
 * beside the one it was added next to, and a stored layout is input from a previous version of the
 * app rather than a promise. All of it is pure functions, so it is checked here instead of through
 * a dragged pointer.
 */
describe('Studio layout', () => {
  it('1. every preset is a tree with one slot per pane and one window per slot', () => {
    for (const preset of STUDIO_PRESETS) {
      const slots = slotsOf(PRESET_TREES[preset]);
      expect(new Set(slots).size).toBe(slots.length);

      const panels = presetPanels(preset);
      expect(Object.keys(panels).sort()).toEqual([...slots].sort());
      expect(new Set(Object.values(panels)).size).toBe(Object.values(panels).length);
    }

    expect(presetPanels('studio')).toEqual({ a: 'plan', b: 'preview', c: 'checks', d: 'terminal' });
    // Four panes in the default arrangement: the plan on the left; the running project above the
    // checks and the autopilot log on the right. Result and tests are read together, not in turns.
    expect(slotsOf(PRESET_TREES.studio)).toEqual(['a', 'b', 'c', 'd']);
    expect(splitsOf(PRESET_TREES.studio).map((split) => split.id)).toEqual(['root', 'right', 'bottom']);
    expect(defaultStudioState()).toEqual(presetState('studio'));
  });

  it('2. a divider trades percent with its neighbour and never squeezes a pane below the minimum', () => {
    const start = [50, 50];
    const moved = adjustSizes(start, 0, 12);
    expect(moved).toEqual([62, 38]);
    expect(moved[0] + moved[1]).toBe(100);

    // The neighbour stops at the minimum even when the pointer keeps going.
    expect(adjustSizes([50, 50], 0, 400)).toEqual([100 - MIN_PANE_PERCENT, MIN_PANE_PERCENT]);
    expect(adjustSizes([50, 50], 0, -400)).toEqual([MIN_PANE_PERCENT, 100 - MIN_PANE_PERCENT]);

    // Out-of-range indexes are left alone rather than silently moving another divider.
    expect(adjustSizes([50, 50], 1, 10)).toEqual([50, 50]);

    // In a three-pane row the pair moves while the third keeps its share.
    const three = adjustSizes([40, 30, 30], 1, 10);
    expect(three).toEqual([40, 40, 20]);
    expect(three.reduce((sum, value) => sum + value, 0)).toBe(100);
  });

  it('3. a window moved into an occupied pane trades places instead of appearing twice', () => {
    const panels = { a: 'plan' as const, b: 'preview' as const, c: 'terminal' as const };
    const next = assignPanel(panels, 'a', 'preview');
    expect(next).toEqual({ a: 'preview', b: 'plan', c: 'terminal' });
    expect(Object.values(next).filter((value) => value === 'preview')).toHaveLength(1);

    // Asking for what is already there changes nothing (and does not renumber the slots).
    expect(assignPanel(panels, 'a', 'plan')).toBe(panels);
  });

  it('4. moving a window into an empty window carries it there and leaves the old pane empty', () => {
    // Two empty panes are allowed — they are windows waiting for a choice, not windows.
    const panels = { a: 'preview' as const, b: 'empty' as const, c: 'empty' as const };
    expect(assignPanel(panels, 'b', 'preview')).toEqual({ a: 'empty', b: 'preview', c: 'empty' });
    expect(assignPanel(panels, 'c', 'empty')).toBe(panels);
    expect(assignPanel(panels, 'a', 'empty')).toEqual({ a: 'empty', b: 'empty', c: 'empty' });

    // An empty window that is filled keeps its neighbours as they were.
    expect(assignPanel(panels, 'b', 'files')).toEqual({ a: 'preview', b: 'files', c: 'empty' });
  });

  it('5. a plus splits the focused pane and leaves an empty window beside it', () => {
    const start = presetState('duo');
    const grown = insertPane(start, 'b', 'col');

    // `b` keeps its pane, and a new one is added under it without disturbing the left half.
    expect(slotsOf(grown.tree)).toEqual(['a', 'b', 'c']);
    expect(grown.panels).toEqual({ a: 'plan', b: 'preview', c: 'empty' });
    expect(splitsOf(grown.tree).map((split) => split.id)).toEqual(['root', 'split1']);
    expect(splitsOf(grown.tree)[1]).toMatchObject({ direction: 'col', sizes: [50, 50] });

    // Slot names are the next free letter, and the layout can be grown sideways as well.
    expect(nextSlotId(['a', 'b', 'c'])).toBe('d');
    const side = insertPane(start, 'a', 'row');
    expect(slotsOf(side.tree)).toEqual(['a', 'c', 'b']);
    expect(side.panels.c).toBe('empty');

    // Dragged dividers survive an edit that does not touch their split.
    const withRatios = { ...start, ratios: { root: [70, 30] } };
    expect(insertPane(withRatios, 'b', 'col').ratios).toEqual({ root: [70, 30] });

    // A full studio is left alone rather than squeezed, and an unknown anchor falls back to the
    // last pane instead of writing a window nobody can see.
    let full = presetState('focus');
    for (let index = 0; index < MAX_PANES - 1; index += 1) {
      full = insertPane(full, slotsOf(full.tree)[0], 'row');
    }
    expect(slotsOf(full.tree)).toHaveLength(MAX_PANES);
    expect(insertPane(full, 'a', 'row')).toBe(full);
    expect(slotsOf(insertPane(presetState('duo'), 'nope', 'row').tree)).toEqual(['a', 'b', 'c']);
  });

  it('6. closing a window removes its pane and collapses the split it leaves behind', () => {
    const grown = insertPane(presetState('duo'), 'b', 'col');
    const closed = removePane(grown, 'c');
    expect(slotsOf(closed.tree)).toEqual(['a', 'b']);
    expect(closed.panels).toEqual({ a: 'plan', b: 'preview' });

    // The collapsed split leaves no ratio behind for a split that no longer exists.
    const withRatios = { ...grown, ratios: { root: [70, 30], split1: [60, 40] } };
    expect(removePane(withRatios, 'c').ratios).toEqual({ root: [70, 30] });

    // A three-pane row keeps two even panes when the middle one goes (a tree that arrived from
    // storage can hold three siblings even though a plus only ever makes two).
    const three: StudioState = {
      tree: {
        kind: 'split',
        id: 'root',
        direction: 'row',
        sizes: [40, 30, 30],
        children: [
          { kind: 'pane', slot: 'a' },
          { kind: 'pane', slot: 'b' },
          { kind: 'pane', slot: 'c' }
        ]
      },
      panels: { a: 'plan', b: 'files', c: 'editor' },
      ratios: {}
    };
    const middle = removePane(three, 'b');
    expect(slotsOf(middle.tree)).toEqual(['a', 'c']);
    expect(splitsOf(middle.tree)[0].sizes).toEqual([50, 50]);
    expect(middle.panels).toEqual({ a: 'plan', c: 'editor' });

    // The last window is not closeable: a studio with no panes is an empty screen.
    const alone = presetState('focus');
    expect(removePane(alone, 'a')).toBe(alone);
    // And a slot that is not in the tree is not a way to remove somebody else's pane.
    expect(removePane(alone, 'b')).toBe(alone);
  });

  it('7. a stored layout is trusted only as far as it still makes sense', () => {
    expect(parseStudioState(null)).toEqual(defaultStudioState());
    expect(parseStudioState('not json')).toEqual(defaultStudioState());
    expect(parseStudioState(JSON.stringify({ preset: 'nope' }))).toEqual(defaultStudioState());

    // Layouts written before the panes became editable name a preset; they still open.
    const legacy = parseStudioState(
      JSON.stringify({
        preset: 'duo',
        panels: { a: 'files', b: 'preview', c: 'terminal' },
        ratios: { root: [70, 30] }
      })
    );
    // `c` is not a slot of the two-pane preset, so it is dropped rather than shown nowhere.
    expect(legacy).toEqual({
      tree: PRESET_TREES.duo,
      panels: { a: 'files', b: 'preview' },
      ratios: { root: [70, 30] }
    });

    // The tree a user built is read back as it was saved, empty pane and all.
    const custom = insertPane(presetState('duo'), 'b', 'col');
    const restored = parseStudioState(JSON.stringify(custom));
    expect(restored.tree).toEqual(custom.tree);
    expect(restored.panels).toEqual(custom.panels);

    // Sizes that do not match the split, or leave a pane unreadable, fall back to the tree's own.
    expect(
      parseStudioState(JSON.stringify({ preset: 'duo', ratios: { root: [95, 5] } })).ratios
    ).toEqual({});
    expect(parseStudioState(JSON.stringify({ preset: 'duo', ratios: { root: [50] } })).ratios).toEqual(
      {}
    );

    // A stored tree that cannot be drawn is replaced by the default instead of leaving a hole.
    const badTree = {
      kind: 'split',
      id: 'root',
      direction: 'row',
      sizes: [50, 50],
      children: [
        { kind: 'pane', slot: 'a' },
        { kind: 'pane', slot: 'a' }
      ]
    };
    expect(parseStudioState(JSON.stringify({ tree: badTree }))).toEqual(defaultStudioState());
    expect(
      parseStudioState(JSON.stringify({ tree: { ...badTree, sizes: [95, 5] } }))
    ).toEqual(defaultStudioState());
    expect(
      parseStudioState(
        JSON.stringify({
          tree: {
            kind: 'split',
            id: 'root',
            direction: 'row',
            sizes: [50, 50],
            children: [{ kind: 'pane', slot: 'a' }, { kind: 'pane' }]
          }
        })
      )
    ).toEqual(defaultStudioState());

    // An unknown window becomes an empty one, and a window named twice is shown once: two panes
    // claiming the same preview would both drive the build.
    const repaired = parseStudioState(
      JSON.stringify({
        tree: {
          kind: 'split',
          id: 'root',
          direction: 'row',
          sizes: [50, 50],
          children: [
            { kind: 'pane', slot: 'a' },
            { kind: 'pane', slot: 'b' }
          ]
        },
        panels: { a: 'preview', b: 'preview' }
      })
    );
    expect(repaired.panels).toEqual({ a: 'preview', b: 'empty' });
    expect(
      parseStudioState(
        JSON.stringify({
          tree: {
            kind: 'split',
            id: 'root',
            direction: 'row',
            sizes: [50, 50],
            children: [
              { kind: 'pane', slot: 'a' },
              { kind: 'pane', slot: 'b' }
            ]
          },
          panels: { a: 'nope', b: 'files' }
        })
      ).panels
    ).toEqual({ a: 'empty', b: 'files' });

    // The key the screen writes under is stable: a rename would silently reset everyone's layout.
    expect(STUDIO_STORAGE_KEY).toBe('easy_project_compiler_studio');
  });
});
