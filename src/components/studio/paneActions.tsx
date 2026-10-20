import React, { createContext, useContext } from 'react';

/**
 * The window's own controls, lent to the panel so they sit in the header the panel already draws.
 *
 * A studio pane used to have a header of its own above the panel: a label and three buttons, over
 * a second header inside the panel that said what the panel was — the plan's filter row under a
 * "ПЛАН" title, the preview's entry under a "ПЕСОЧНИЦА" title. Two rows of chrome, one of them
 * repeating the other. The window controls now live at the end of the panel's header, which is a
 * row that had to exist anyway, and the outer one is gone.
 *
 * It is a context rather than props because the panels are also destinations of their own: opened
 * from the sidebar, a panel has no studio around it, the context is empty, and the panel draws
 * exactly what it drew before.
 */
const PaneActionsContext = createContext<React.ReactNode>(null);

export const PaneActionsProvider = PaneActionsContext.Provider;

export const usePaneActions = (): React.ReactNode => useContext(PaneActionsContext);

/**
 * A hairline between a panel's own buttons and the window's.
 *
 * Without it the rebuild, console and close controls read as one row of things that act on the
 * preview. The rule says: these buttons act on the contents, those on the window.
 */
export const PaneActionsDivider: React.FC = () => (
  <span aria-hidden="true" data-testid="studio-pane-actions-divider" className="mx-1 h-3.5 w-px shrink-0 bg-slate-700/70" />
);

/**
 * A header for a panel that draws none: the controls alone, at the height the other headers use.
 * Outside the studio there is nothing to draw, so the row is not there at all.
 */
export const PaneActionsRow: React.FC = () => {
  const actions = usePaneActions();
  if (!actions) return null;
  return (
    <div className="flex h-8 shrink-0 items-center justify-end gap-0.5 border-b border-slate-800/80 bg-slate-900/60 px-1">
      {actions}
    </div>
  );
};

/** The panel's header tail: one rule, then the controls — nothing at all outside the studio. */
export const PaneActionsSlot: React.FC = () => {
  const actions = usePaneActions();
  if (!actions) return null;
  return (
    <>
      <PaneActionsDivider />
      {actions}
    </>
  );
};
