/**
 * The row of panes beside the current screen.
 *
 * The app used to be a stack of destinations: every screen replaced the one before it, and the only
 * way to look at two of them was to switch back and forth. The studio already answers that with
 * splits — a plus, an empty window, a choice — so the same gesture is available here, next to any
 * screen: the route is the first column, and the plus opens another one.
 *
 * The state is deliberately small: a list of extra panes and the shares of the row. The first
 * column is the screen the route names and is not stored as a pane — the sidebar stays the way the
 * app is navigated, and extra panes are readers opened beside it.
 */

import { MIN_PANE_PERCENT } from '../split/splitSizes';

/** Every screen that can be opened beside the current one. The studio is a workspace of its own. */
export type ScreenPath =
  | '/'
  | '/simple'
  | '/compiler'
  | '/review'
  | '/preview'
  | '/coach'
  | '/plan'
  | '/map'
  | '/files'
  | '/brief';

export const SCREEN_PATHS: ScreenPath[] = [
  '/',
  '/simple',
  '/compiler',
  '/review',
  '/preview',
  '/coach',
  '/plan',
  '/map',
  '/files',
  '/brief'
];

/** Four columns of an app screen is the most a window can hold before every one is a sliver. */
export const MAX_EXTRA_PANES = 3;

export const WORKSPACE_STORAGE_KEY = 'easy_project_compiler_workspace';

export interface WorkspacePane {
  id: string;
  /** The screen in the pane; `null` is a window that still asks what goes in it. */
  path: ScreenPath | null;
}

export interface WorkspaceState {
  panes: WorkspacePane[];
  /** Shares of the whole row, first column (the routed screen) included. */
  shares: number[];
}

export function splitShares(count: number): number[] {
  const columns = Math.max(1, count);
  return Array.from({ length: columns }, () => 100 / columns);
}

export function emptyWorkspace(): WorkspaceState {
  return { panes: [], shares: [100] };
}

export function isScreenPath(value: unknown): value is ScreenPath {
  return typeof value === 'string' && (SCREEN_PATHS as string[]).includes(value);
}

function nextPaneId(panes: WorkspacePane[]): string {
  let highest = 0;
  for (const pane of panes) {
    const match = /^w(\d+)$/.exec(pane.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `w${highest + 1}`;
}

/** A plus: one more column, empty, waiting for a choice. The row is re-shared evenly. */
export function addPane(state: WorkspaceState, path: ScreenPath | null = null): WorkspaceState {
  if (state.panes.length >= MAX_EXTRA_PANES) return state;
  const panes = [...state.panes, { id: nextPaneId(state.panes), path }];
  return { panes, shares: splitShares(panes.length + 1) };
}

export function removePane(state: WorkspaceState, id: string): WorkspaceState {
  if (!state.panes.some((pane) => pane.id === id)) return state;
  const panes = state.panes.filter((pane) => pane.id !== id);
  return { panes, shares: splitShares(panes.length + 1) };
}

/**
 * Puts a screen in a pane. A screen is live — a board, a running preview — so it exists once:
 * choosing one that another pane already shows moves it there and leaves the pane it left asking
 * what goes in it next.
 */
export function setPanePath(
  state: WorkspaceState,
  id: string,
  path: ScreenPath | null
): WorkspaceState {
  if (!state.panes.some((pane) => pane.id === id)) return state;
  const panes = state.panes.map((pane) => {
    if (pane.id === id) return pane.path === path ? pane : { ...pane, path };
    if (path && pane.path === path) return { ...pane, path: null };
    return pane;
  });
  if (panes.every((pane, index) => pane === state.panes[index])) return state;
  return { ...state, panes };
}

/**
 * What a stored row means, or the empty one.
 *
 * Storage is written by this app and read by a future version of it: a screen that no longer
 * exists, an id named twice or shares that do not match the columns are dropped rather than
 * trusted, so a bad string cannot leave a column blank or a screen open twice.
 */
export function parseWorkspace(raw: string | null): WorkspaceState {
  if (!raw) return emptyWorkspace();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyWorkspace();
  }
  if (!parsed || typeof parsed !== 'object') return emptyWorkspace();
  const source = parsed as { panes?: unknown; shares?: unknown };
  if (!Array.isArray(source.panes)) return emptyWorkspace();

  const panes: WorkspacePane[] = [];
  const ids = new Set<string>();
  const screens = new Set<ScreenPath>();

  for (const value of source.panes) {
    if (panes.length >= MAX_EXTRA_PANES) break;
    if (!value || typeof value !== 'object') continue;
    const { id, path } = value as { id?: unknown; path?: unknown };
    if (typeof id !== 'string' || !id || ids.has(id)) continue;
    let screen: ScreenPath | null = null;
    if (path !== null) {
      // A screen that no longer exists is not a column; the pane goes with it.
      if (!isScreenPath(path)) continue;
      screen = screens.has(path) ? null : path;
      if (screen) screens.add(screen);
    }
    ids.add(id);
    panes.push({ id, path: screen });
  }

  if (panes.length === 0) return emptyWorkspace();

  const stored = source.shares;
  const usable =
    Array.isArray(stored) &&
    stored.length === panes.length + 1 &&
    stored.every(
      (share) => typeof share === 'number' && Number.isFinite(share) && share >= MIN_PANE_PERCENT
    );

  return { panes, shares: usable ? [...(stored as number[])] : splitShares(panes.length + 1) };
}

export function serializeWorkspace(state: WorkspaceState): string {
  return JSON.stringify(state);
}
