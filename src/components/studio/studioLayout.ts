import { adjustSizes, MIN_PANE_PERCENT } from '../split/splitSizes';

/**
 * The shape of the studio, kept away from the drawing of it.
 *
 * A layout is a tree of splits and panes, and it is a tree the user edits while working: a new
 * window is a plus, and closing one takes a split away. So the tree is the state, not a preset
 * lookup — presets merely plant one particular tree when the whole arrangement is what changed.
 * Where the dividers were dragged is kept separately, keyed by split id, so resizing never rewrites
 * the tree. Pure functions, so the arithmetic of a drag, the surgery of a split (and what may be
 * stored between sessions) can be checked without a browser.
 */

export type StudioPanel = 'plan' | 'preview' | 'terminal' | 'checks' | 'files' | 'editor';

/**
 * What a pane can hold. `empty` is a real state, not a placeholder: a window the user just added
 * has nothing in it yet, and the choice of what to put there belongs inside that window.
 */
export type StudioPane = StudioPanel | 'empty';

export type StudioPresetId = 'studio' | 'duo' | 'quad' | 'focus';

export interface StudioPaneNode {
  kind: 'pane';
  slot: string;
}

export interface StudioSplitNode {
  kind: 'split';
  /** Stable across renders: the resized sizes are stored under this id. */
  id: string;
  direction: 'row' | 'col';
  /** Starting shares in percent; the live ones live in `ratios`. */
  sizes: number[];
  children: StudioNode[];
}

export type StudioNode = StudioPaneNode | StudioSplitNode;

export const STUDIO_PANELS: StudioPanel[] = ['plan', 'preview', 'terminal', 'checks', 'files', 'editor'];

export const STUDIO_PRESETS: StudioPresetId[] = ['studio', 'duo', 'quad', 'focus'];

export const DEFAULT_PRESET: StudioPresetId = 'studio';

/** The resize arithmetic is shared with the workspace row beside the screens (see splitSizes). */
export { adjustSizes, MIN_PANE_PERCENT };

/** Past this many windows the studio is a mosaic, not a workspace — and every one of them is tiny. */
export const MAX_PANES = 8;

const pane = (slot: string): StudioPaneNode => ({ kind: 'pane', slot });

const split = (
  id: string,
  direction: 'row' | 'col',
  sizes: number[],
  children: StudioNode[]
): StudioSplitNode => ({ kind: 'split', id, direction, sizes, children });

/**
 * Four arrangements, all built from the same two gestures.
 *
 * `studio` is the one the screen opens on: the plan on the left, and on the right the running
 * project above the checks it is judged by, with the autopilot log beside them. Plan, result and
 * tests are the three things a change is read against, and reading all three at once is the point
 * of having windows instead of tabs; the log shares the bottom row because it is read in bursts.
 */
export const PRESET_TREES: Record<StudioPresetId, StudioNode> = {
  studio: split('root', 'row', [52, 48], [
    pane('a'),
    split('right', 'col', [56, 44], [
      pane('b'),
      split('bottom', 'row', [50, 50], [pane('c'), pane('d')])
    ])
  ]),
  duo: split('root', 'row', [50, 50], [pane('a'), pane('b')]),
  quad: split('root', 'row', [50, 50], [
    split('left', 'col', [50, 50], [pane('a'), pane('b')]),
    split('right', 'col', [50, 50], [pane('c'), pane('d')])
  ]),
  focus: pane('a')
};

const PRESET_DEFAULTS: Record<StudioPresetId, Record<string, StudioPanel>> = {
  studio: { a: 'plan', b: 'preview', c: 'checks', d: 'terminal' },
  duo: { a: 'plan', b: 'preview' },
  quad: { a: 'plan', b: 'preview', c: 'terminal', d: 'checks' },
  focus: { a: 'plan' }
};

export function presetPanels(preset: StudioPresetId): Record<string, StudioPane> {
  return { ...PRESET_DEFAULTS[preset] };
}

export function presetState(preset: StudioPresetId = DEFAULT_PRESET): StudioState {
  return { tree: PRESET_TREES[preset], panels: presetPanels(preset), ratios: {} };
}

/** Every slot of a tree, in reading order. */
export function slotsOf(node: StudioNode): string[] {
  if (node.kind === 'pane') return [node.slot];
  return node.children.flatMap(slotsOf);
}

/** Every split of a tree, with its own starting sizes. */
export function splitsOf(node: StudioNode): StudioSplitNode[] {
  if (node.kind === 'pane') return [];
  return [node, ...node.children.flatMap(splitsOf)];
}

/** Equal shares for `count` siblings; used whenever a split gains or loses one. */
function evenSizes(count: number): number[] {
  return Array.from({ length: count }, () => 100 / count);
}

/**
 * Puts a window into a pane. A window is a real one with state of its own, so two panes showing
 * the same thing would both claim the file picker, the preview build and the scroll position: the
 * pane that already held it takes over the incoming one's content instead. Empty panes are the
 * exception — there may be many, and moving a window into one simply moves it: the pane it left
 * becomes empty and asks what goes there next.
 */
export function assignPanel(
  panels: Record<string, StudioPane>,
  slot: string,
  panel: StudioPane
): Record<string, StudioPane> {
  const previous = panels[slot];
  if (previous === panel) return panels;
  const next = { ...panels, [slot]: panel };
  if (panel === 'empty') return next;
  const occupant = Object.keys(panels).find((key) => key !== slot && panels[key] === panel);
  if (occupant) next[occupant] = previous ?? 'empty';
  return next;
}

/** The live shares of one split: what the user dragged, or what the tree starts with. */
export function sizesOf(splitNode: StudioSplitNode, ratios: Record<string, number[]>): number[] {
  const stored = ratios[splitNode.id];
  if (!stored || stored.length !== splitNode.children.length) return splitNode.sizes;
  return stored;
}

/** The slot id of the next window: `a`…`z`, then `s1`, `s2`… */
export function nextSlotId(slots: string[]): string {
  const taken = new Set(slots);
  for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
    if (!taken.has(letter)) return letter;
  }
  let index = 1;
  while (taken.has(`s${index}`)) index += 1;
  return `s${index}`;
}

function nextSplitId(tree: StudioNode): string {
  const taken = new Set(splitsOf(tree).map((node) => node.id));
  let index = 1;
  while (taken.has(`split${index}`)) index += 1;
  return `split${index}`;
}

function replaceLeaf(node: StudioNode, slot: string, replacement: StudioNode): StudioNode {
  if (node.kind === 'pane') return node.slot === slot ? replacement : node;
  return { ...node, children: node.children.map((child) => replaceLeaf(child, slot, replacement)) };
}

function dropLeaf(node: StudioNode, slot: string): StudioNode | null {
  if (node.kind === 'pane') return node.slot === slot ? null : node;
  // Identity, not count: a child that collapsed into its own child leaves the count unchanged and
  // the split still has to be rebuilt around it.
  let changed = false;
  const children: StudioNode[] = [];
  for (const child of node.children) {
    const next = dropLeaf(child, slot);
    if (next !== child) changed = true;
    if (next) children.push(next);
  }
  if (!changed) return node;
  if (children.length === 0) return null;
  // A split with one child left is not a split: the child takes its place, id and all.
  if (children.length === 1) return children[0];
  return { ...node, children, sizes: evenSizes(children.length) };
}

/** Keeps the ratios that still describe a split of this tree, and forgets the rest. */
export function ratiosFor(tree: StudioNode, ratios: unknown): Record<string, number[]> {
  const kept: Record<string, number[]> = {};
  if (!ratios || typeof ratios !== 'object') return kept;
  for (const splitNode of splitsOf(tree)) {
    const stored = (ratios as Record<string, unknown>)[splitNode.id];
    if (
      Array.isArray(stored) &&
      stored.length === splitNode.children.length &&
      stored.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= MIN_PANE_PERCENT)
    ) {
      kept[splitNode.id] = [...(stored as number[])];
    }
  }
  return kept;
}

/**
 * Adds an empty window beside `anchor`: the anchor's half of the split becomes two halves.
 *
 * The new pane is inserted where the user is looking, not at the far edge of the screen — the
 * window it pushes aside is the one they were reading, and its neighbour is the one they want
 * next to it. At `MAX_PANES` the layout is returned untouched rather than squeezed.
 */
export function insertPane(
  state: StudioState,
  anchor: string,
  direction: 'row' | 'col',
  content: StudioPane = 'empty'
): StudioState {
  const slots = slotsOf(state.tree);
  if (slots.length >= MAX_PANES) return state;
  const target = slots.includes(anchor) ? anchor : slots[slots.length - 1];
  if (!target) return state;
  const slot = nextSlotId(slots);
  const tree = replaceLeaf(
    state.tree,
    target,
    split(nextSplitId(state.tree), direction, [50, 50], [pane(target), pane(slot)])
  );
  return { tree, panels: { ...state.panels, [slot]: content }, ratios: ratiosFor(tree, state.ratios) };
}

/**
 * Closes a window. The split that held it either loses a child or collapses into the child that
 * is left, and the last window cannot be closed: a studio with no panes is an empty screen.
 */
export function removePane(state: StudioState, slot: string): StudioState {
  const slots = slotsOf(state.tree);
  if (slots.length <= 1 || !slots.includes(slot)) return state;
  const tree = dropLeaf(state.tree, slot);
  if (!tree) return state;
  const panels = { ...state.panels };
  delete panels[slot];
  return { tree, panels, ratios: ratiosFor(tree, state.ratios) };
}

export interface StudioState {
  /** The arrangement itself. Editable: panes are added and closed, not only swapped. */
  tree: StudioNode;
  panels: Record<string, StudioPane>;
  /** Resized shares per split id; structural edits drop the ones that no longer apply. */
  ratios: Record<string, number[]>;
}

export const STUDIO_STORAGE_KEY = 'easy_project_compiler_studio';

export function defaultStudioState(): StudioState {
  return presetState(DEFAULT_PRESET);
}

function isPanel(value: unknown): value is StudioPanel {
  return typeof value === 'string' && (STUDIO_PANELS as string[]).includes(value);
}

function isContent(value: unknown): value is StudioPane {
  return value === 'empty' || isPanel(value);
}

function isPreset(value: unknown): value is StudioPresetId {
  return typeof value === 'string' && (STUDIO_PRESETS as string[]).includes(value);
}

/**
 * A stored arrangement, read back only as far as it still makes sense.
 *
 * Storage is written by the app but read by a future version of it: an unknown window, a duplicate
 * slot, a split whose sizes do not match its children or a tree deeper than the UI can draw is
 * dropped rather than trusted, so a bad string can never leave the studio with an invisible window
 * or two panes fighting over the same one.
 */
const MAX_DEPTH = 6;

function readTree(value: unknown, depth = 0): StudioNode | null {
  if (!value || typeof value !== 'object' || depth > MAX_DEPTH) return null;
  const node = value as Record<string, unknown>;
  if (node.kind === 'pane') {
    const slot = node.slot;
    if (typeof slot !== 'string' || !slot || slot.length > 12) return null;
    return { kind: 'pane', slot };
  }
  if (node.kind !== 'split') return null;
  if (typeof node.id !== 'string' || !node.id) return null;
  if (node.direction !== 'row' && node.direction !== 'col') return null;
  if (!Array.isArray(node.children) || node.children.length < 2 || node.children.length > 4) return null;
  if (!Array.isArray(node.sizes) || node.sizes.length !== node.children.length) return null;
  if (
    !node.sizes.every(
      (size) => typeof size === 'number' && Number.isFinite(size) && size >= MIN_PANE_PERCENT
    )
  ) {
    return null;
  }
  const children = node.children.map((child) => readTree(child, depth + 1));
  if (children.some((child) => !child)) return null;
  return {
    kind: 'split',
    id: node.id,
    direction: node.direction,
    sizes: [...(node.sizes as number[])],
    children: children as StudioNode[]
  };
}

function readState(parsed: unknown): StudioState | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const source = parsed as {
    tree?: unknown;
    preset?: unknown;
    panels?: unknown;
    ratios?: unknown;
  };

  const fromTree = readTree(source.tree);
  const preset = isPreset(source.preset) ? source.preset : null;
  // Layouts stored before the panes became editable name a preset instead of carrying a tree.
  const tree = fromTree ?? (preset ? PRESET_TREES[preset] : null);
  if (!tree) return null;

  const slots = slotsOf(tree);
  if (slots.length > MAX_PANES || new Set(slots).size !== slots.length) return null;
  const splitIds = splitsOf(tree).map((node) => node.id);
  if (new Set(splitIds).size !== splitIds.length) return null;

  const stored = (source.panels && typeof source.panels === 'object' ? source.panels : {}) as Record<
    string,
    unknown
  >;
  const fallback = fromTree ? 'empty' : presetPanels(preset as StudioPresetId);
  const panels: Record<string, StudioPane> = {};
  const used = new Set<StudioPane>();
  for (const slot of slots) {
    const value = stored[slot];
    const candidate: StudioPane = isContent(value) ? value : fallback[slot] ?? 'empty';
    // `empty` repeats; a real window exists once, or two panes would fight over its state.
    if (candidate !== 'empty' && used.has(candidate)) {
      panels[slot] = 'empty';
      continue;
    }
    panels[slot] = candidate;
    if (candidate !== 'empty') used.add(candidate);
  }

  return { tree, panels, ratios: ratiosFor(tree, source.ratios) };
}

export function parseStudioState(raw: string | null): StudioState {
  if (!raw) return defaultStudioState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultStudioState();
  }
  return readState(parsed) ?? defaultStudioState();
}

export function serializeStudioState(state: StudioState): string {
  return JSON.stringify(state);
}
