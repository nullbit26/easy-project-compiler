import React, { useCallback, useRef } from 'react';
import type { StudioNode, StudioSplitNode } from './studioLayout';
import { adjustSizes, sizesOf } from './studioLayout';

interface SplitLayoutProps {
  node: StudioNode;
  /** Live shares of every split, keyed by split id. */
  ratios: Record<string, number[]>;
  onResize: (splitId: string, sizes: number[]) => void;
  renderPane: (slot: string) => React.ReactNode;
}

/**
 * The flexible grid, drawn.
 *
 * Each split is a flex row or column of panes whose share is a number, and the divider between two
 * panes is a drag handle that trades percent between exactly those two. Nothing inside a pane is
 * ever sized by its content: every level is positioned `absolute inset-0` inside a relative box,
 * so a preview, a terminal and a board all end flush with their split instead of stopping at an
 * empty half-screen. (A percentage height inside a flex item resolves against a height the flex
 * layout has not finished deciding, which is exactly how a board ends up 500 px tall in an 800 px
 * window.)
 *
 * Dividers are also keyboard controls (arrows move them), because a layout that can only be
 * changed with a mouse is a layout half the users cannot arrange.
 */
export const SplitLayout: React.FC<SplitLayoutProps> = ({ node, ratios, onResize, renderPane }) => {
  if (node.kind === 'pane') {
    return <div className="absolute inset-0 flex min-h-0 min-w-0 flex-col">{renderPane(node.slot)}</div>;
  }
  return <Split node={node} ratios={ratios} onResize={onResize} renderPane={renderPane} />;
};

const Split: React.FC<SplitLayoutProps & { node: StudioSplitNode }> = ({
  node,
  ratios,
  onResize,
  renderPane
}) => {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const sizes = sizesOf(node, ratios);
  const horizontal = node.direction === 'row';

  const drag = useCallback(
    (index: number, event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const box = boxRef.current?.getBoundingClientRect();
      if (!box) return;
      const extent = horizontal ? box.width : box.height;
      if (extent <= 0) return;
      const origin = horizontal ? event.clientX : event.clientY;
      const startSizes = sizes;
      const move = (moveEvent: PointerEvent) => {
        const travelled = (horizontal ? moveEvent.clientX : moveEvent.clientY) - origin;
        onResize(node.id, adjustSizes(startSizes, index, (travelled / extent) * 100));
      };
      const stop = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
    },
    [horizontal, node.id, onResize, sizes]
  );

  /** The same gesture from the keyboard: one percent per arrow press, ten with Shift. */
  const nudge = (index: number, event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 2;
    const back = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const forward = horizontal ? 'ArrowRight' : 'ArrowDown';
    if (event.key !== back && event.key !== forward) return;
    event.preventDefault();
    onResize(node.id, adjustSizes(sizes, index, event.key === forward ? step : -step));
  };

  return (
    <div
      ref={boxRef}
      className="absolute inset-0 flex min-h-0 min-w-0"
      style={{ flexDirection: horizontal ? 'row' : 'column' }}
      data-studio-split={node.id}
    >
      {node.children.map((child, index) => (
        <React.Fragment key={child.kind === 'pane' ? child.slot : child.id}>
          <div
            className="relative min-h-0 min-w-0 overflow-hidden"
            style={{ flexGrow: sizes[index], flexShrink: 1, flexBasis: 0 }}
          >
            <SplitLayout node={child} ratios={ratios} onResize={onResize} renderPane={renderPane} />
          </div>
          {index < node.children.length - 1 && (
            <div
              role="separator"
              aria-orientation={horizontal ? 'vertical' : 'horizontal'}
              aria-label={horizontal ? 'Resize panes' : 'Resize panes vertically'}
              aria-valuenow={Math.round(sizes[index])}
              tabIndex={0}
              onPointerDown={(event) => drag(index, event)}
              onKeyDown={(event) => nudge(index, event)}
              data-testid={`studio-divider-${node.id}-${index}`}
              className={`group relative z-10 flex shrink-0 items-center justify-center bg-slate-800/60 transition-colors hover:bg-indigo-500/70 focus-visible:bg-indigo-500/70 ${
                horizontal ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'
              }`}
            >
              <span
                className={`pointer-events-none rounded-full bg-slate-600/0 transition-colors group-hover:bg-slate-300/60 ${
                  horizontal ? 'h-8 w-0.5' : 'h-0.5 w-8'
                }`}
              />
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
};
