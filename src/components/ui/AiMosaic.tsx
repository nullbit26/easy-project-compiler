import React from 'react';

/**
 * The app's "the model is working" mark.
 *
 * A square assembled from twenty-five small cubes: one violet, one pixel of space between them,
 * and a wave of turns that passes through the field. It stands where a spinner would otherwise be —
 * in the AI status card, in the autopilot plate — because a turning cube says "something is being
 * put together" better than a rotating arc, and it keeps the app's own violet instead of a generic
 * grey ring.
 *
 * Every cube drifts out along its own radius once per cycle, then turns a full revolution and comes
 * back in sky. The colour is swapped exactly when the cube is edge-on (90° and 270°), so the change
 * is hidden inside the turn. The drift and the turn are separate animations on separate elements —
 * see `epc-mosaic` in index.css — so neither timing bends the other.
 *
 * Purely decorative: the caller already says in words what is happening, so this is `aria-hidden`.
 *
 * It is never framed. No plate, border, ring, tinted tile or rounded square goes behind or around
 * it — a box turns the mark into a button and puts a square inside a square. The caller may reserve
 * its size (a bare 32 × 32 slot) so the card does not jump, but nothing is drawn there. The
 * indicator and the autopilot plate are both checked for this in their tests.
 */

const GRID = 5;

/** The second ink a cube turns into; a few shades of the same sky keep the wave from looking flat. */
const FLIP_INKS = ['#7dd3fc', '#38bdf8', '#0ea5e9'];

/**
 * A deterministic scatter in 0..1, so the field looks unplanned but is identical on every render —
 * no `Math.random`, nothing to flicker when React re-renders the indicator.
 */
const scatter = (seed: number): number => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

interface Piece {
  index: number;
  dx: number;
  dy: number;
  rot: number;
  delay: number;
  flip: string;
}

/**
 * One period for the whole field — 2.4 s — with the phase scattered by a few tens of milliseconds.
 * A shared period keeps the block's choreography stable over a long run; separate durations would
 * slowly drift it into a cloud.
 */
const PIECES: Piece[] = Array.from({ length: GRID * GRID }, (_, index) => {
  const x = index % GRID;
  const y = Math.floor(index / GRID);
  const reach = 0.85 + scatter(index + 1) * 0.3;

  return {
    index,
    dx: (x - (GRID - 1) / 2) * 1.6 * reach + (scatter(index + 3) - 0.5) * 0.35,
    dy: (y - (GRID - 1) / 2) * 1.6 * reach + (scatter(index + 5) - 0.5) * 0.35,
    rot: (x - (GRID - 1) / 2) * 7 + (scatter(index + 8) - 0.5) * 5,
    delay: (x + y) * 75 + Math.round((scatter(index + 12) - 0.5) * 60),
    flip: FLIP_INKS[(x * 2 + y) % FLIP_INKS.length]
  };
});

export const AiMosaic: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span aria-hidden className={`epc-mosaic ${className}`}>
    {PIECES.map((piece) => (
      <span
        key={piece.index}
        className="epc-mosaic-piece"
        style={
          {
            '--epc-mosaic-dx': `${piece.dx.toFixed(2)}px`,
            '--epc-mosaic-dy': `${piece.dy.toFixed(2)}px`,
            '--epc-mosaic-rot': `${piece.rot.toFixed(1)}deg`,
            '--epc-mosaic-delay': `${piece.delay}ms`,
            '--epc-mosaic-flip': piece.flip
          } as React.CSSProperties
        }
      >
        <span className="epc-mosaic-face" />
      </span>
    ))}
  </span>
);

export default AiMosaic;
