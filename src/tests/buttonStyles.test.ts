import { describe, it, expect } from 'vitest';
import { buttonClass, type ButtonSize, type ButtonVariant } from '../components/ui/Button';

/**
 * The shared button is one look, and this is what keeps it one look.
 *
 * Every screen draws its controls from `ui/Button.tsx`, so a single change to the variants reaches
 * the whole app at once — which is the point, and also the danger: a shadow added to `primary` for
 * one screen's taste is a glow on all of them, and a filled emerald button next to a tinted indigo
 * one is how the app looked assembled from different kits in the first place.
 *
 * Three things are written down here, because all three drifted before:
 *
 *   • no variant carries a shadow, a blur or a drop-shadow — the depth is a hairline inset ring,
 *     not light spilling around the control;
 *   • only `danger` may be a solid coloured fill. Every other committed action (`success`,
 *     `warning`, `primary`) is a tint with a ring, so colour marks meaning and not volume. Neutral
 *     slate surfaces are ordinary buttons, not a colour statement;
 *   • all sizes sit on one height grid: `xs`/`sm`/`md` rise by exactly one step, and an icon-only
 *     button is a square of exactly its text sibling's height.
 */

const VARIANTS: ButtonVariant[] = [
  'primary',
  'secondary',
  'ghost',
  'accent',
  'danger',
  'success',
  'warning'
];

const SIZES: ButtonSize[] = ['xs', 'sm', 'md'];

/** A neutral surface: shade, not meaning. Everything else is a colour the test cares about. */
const NEUTRAL_PALETTES = new Set(['slate', 'black', 'white', 'transparent', 'current', 'none', 'inherit']);

const tokensOf = (value: string) => value.split(/\s+/).filter(Boolean);

/** The utility itself, without its `hover:` / `enabled:` / `disabled:` prefix. */
const utilityOf = (token: string) => token.slice(token.lastIndexOf(':') + 1);

function classOf(options: Parameters<typeof buttonClass>[0]): string[] {
  return tokensOf(buttonClass(options));
}

function backgroundsOf(options: Parameters<typeof buttonClass>[0]): string[] {
  return classOf(options).filter((token) => utilityOf(token).startsWith('bg-'));
}

/** A background is a fill when it hides what is behind it: no alpha step, no `transparent`. */
function isSolid(token: string): boolean {
  const paint = utilityOf(token).slice('bg-'.length);
  if (paint === 'transparent' || paint === 'none' || paint === 'current') return false;
  return !token.includes('/');
}

function paletteOf(token: string): string {
  return utilityOf(token).slice('bg-'.length).split('-')[0];
}

function heightOf(options: Parameters<typeof buttonClass>[0]): number {
  const token = classOf(options).find((candidate) => /^h-\d+$/.test(utilityOf(candidate)));
  expect(token, `no numeric height in ${buttonClass(options)}`).toBeTruthy();
  return Number(utilityOf(token!).slice('h-'.length));
}

function widthOf(options: Parameters<typeof buttonClass>[0]): number {
  const token = classOf(options).find((candidate) => /^w-\d+$/.test(utilityOf(candidate)));
  expect(token, `no numeric width in ${buttonClass(options)}`).toBeTruthy();
  return Number(utilityOf(token!).slice('w-'.length));
}

describe('the shared button keeps one look', () => {
  it('1. no variant glows: no shadow, no blur, no drop-shadow, pressed state included', () => {
    // The scan is only worth something if it is looking at something: every variant, and the
    // held-down state that is drawn instead of a variant.
    expect(VARIANTS).toHaveLength(7);

    const offenders: string[] = [];
    const states: Array<[string, Parameters<typeof buttonClass>[0]]> = [
      ...VARIANTS.map((variant): [string, { variant: ButtonVariant }] => [variant, { variant }]),
      ['pressed', { pressed: true }]
    ];

    for (const [name, options] of states) {
      for (const token of classOf(options)) {
        const utility = utilityOf(token);
        if (utility.startsWith('shadow-') || utility.startsWith('drop-shadow') || utility.startsWith('blur')) {
          offenders.push(`${name}: ${token}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('2. only danger is a solid coloured fill; every other colour is a tint', () => {
    const offenders: string[] = [];
    for (const variant of VARIANTS) {
      for (const token of backgroundsOf({ variant })) {
        if (!isSolid(token) || NEUTRAL_PALETTES.has(paletteOf(token))) continue;
        if (variant === 'danger') continue;
        offenders.push(`${variant}: ${token}`);
      }
    }
    expect(offenders).toEqual([]);

    // Danger still reads as the one committed, stop-and-look action: a fill, not a tint.
    expect(
      backgroundsOf({ variant: 'danger' }).filter(
        (token) => isSolid(token) && !NEUTRAL_PALETTES.has(paletteOf(token))
      )
    ).not.toHaveLength(0);
  });

  it('3. every size rises by one step, and an icon-only button is a square of the same height', () => {
    const heights = SIZES.map((size) => {
      const text = heightOf({ size });
      const iconOnly = heightOf({ size, iconOnly: true });

      expect(iconOnly, `icon-only ${size} is not the height of a text ${size}`).toBe(text);
      expect(widthOf({ size, iconOnly: true }), `icon-only ${size} is not a square`).toBe(iconOnly);

      return text;
    });

    for (let index = 1; index < heights.length; index += 1) {
      expect(heights[index] - heights[index - 1], `${SIZES[index]} does not step once past ${SIZES[index - 1]}`).toBe(1);
    }
    expect(new Set(heights).size).toBe(SIZES.length);
  });
});
