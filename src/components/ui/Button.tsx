import React from 'react';

/**
 * The app's one button. Everything pressable is drawn from here.
 *
 * The screens had grown a dozen button shapes: some `rounded-xl` with `font-bold` and a flat fill,
 * some pill-shaped, some with a white background and dark text, some with a border and some
 * without. None of them was wrong on its own; together they made the app look assembled from
 * different kits, and the loudest ones (a large flat indigo capsule next to a large grey one) read
 * as cheap precisely because they were large and unconditional.
 *
 * What is written once here:
 *
 *   • a compact height, so controls sit on the same line as text and never tower over it;
 *   • one corner radius, one weight (`font-medium`, not bold — weight is for headings);
 *   • a hairline inset ring instead of shadows around a flat rectangle — no glow, no inner
 *     highlight, nothing that makes a control read as a sticker;
 *   • a single accent (indigo) for the main action, neutral slate for everything secondary, and
 *     colour only where colour means something: rose for destructive, emerald for confirmed.
 *
 * `IconButton` is the same button without words: the tooltip and the accessible name carry the
 * label. It is what toolbars use, so a row of controls is a row of equally sized hit areas.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'accent' | 'danger' | 'success' | 'warning';
export type ButtonSize = 'xs' | 'sm' | 'md';

const BASE =
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium antialiased ' +
  'transition-[background-color,color,box-shadow,opacity] duration-150 ' +
  'disabled:opacity-40 disabled:pointer-events-none cursor-pointer';

const SIZES: Record<ButtonSize, string> = {
  xs: 'h-7 px-2 text-[11px]',
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-[13px]'
};

const SQUARE: Record<ButtonSize, string> = {
  xs: 'h-7 w-7',
  sm: 'h-8 w-8',
  md: 'h-9 w-9'
};

const VARIANTS: Record<ButtonVariant, string> = {
  /*
   * The main action is a tint, not a slab.
   *
   * A filled violet rectangle in the middle of a dark screen is the loudest thing in the window and
   * it competes with the content the button acts on. The studio's toolbar showed the alternative —
   * one accent, thin ring, no fill — so the primary action is drawn the same way everywhere: an
   * indigo surface you can find, not one that shouts over the page.
   */
  primary:
    'bg-indigo-500/15 text-indigo-100 ring-1 ring-inset ring-indigo-400/40 hover:bg-indigo-500/25 hover:text-white active:bg-indigo-500/20',
  secondary:
    'bg-slate-800/80 text-slate-200 ring-1 ring-inset ring-slate-700/80 hover:bg-slate-700/80 hover:text-white active:bg-slate-800',
  ghost: 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 active:bg-slate-800',
  accent:
    'bg-indigo-500/12 text-indigo-300 ring-1 ring-inset ring-indigo-400/30 hover:bg-indigo-500/20 hover:text-indigo-200',
  /*
   * Colour is a signal, not a surface.
   *
   * A filled emerald bar for "done" beside tinted indigo controls read as a different kit, and at
   * the loudest volume in the window. Success and warning are therefore drawn exactly like
   * `accent`: a tinted control inside a hairline ring. Danger keeps its fill — it is the one action
   * that should stop the eye — but loses the plastic white inner highlight the filled buttons
   * used to carry, and the emerald tint is light enough to stay at AA contrast on the dark surface.
   */
  danger:
    'bg-rose-600 text-white ring-1 ring-inset ring-rose-400/30 hover:bg-rose-500 active:bg-rose-700',
  success:
    'bg-emerald-500/12 text-emerald-200 ring-1 ring-inset ring-emerald-400/30 hover:bg-emerald-500/20 hover:text-emerald-100 active:bg-emerald-500/25',
  warning:
    'bg-amber-400/12 text-amber-200 ring-1 ring-inset ring-amber-400/35 hover:bg-amber-400/20 hover:text-amber-100 active:bg-amber-400/25'
};

/** The pressed state of a toggle: the same control, held down. */
export const PRESSED_CLASS = 'bg-slate-800 text-slate-50 ring-1 ring-inset ring-slate-700';

export interface ButtonClassOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** A square hit area with no words: the icon is the whole button. */
  iconOnly?: boolean;
  /** Drawn as a held-down toggle. */
  pressed?: boolean;
  /** Extra utilities, appended last so a screen can position the button. */
  className?: string;
}

/** The class string of one button, for the few places that need a non-`button` element. */
export function buttonClass({
  variant = 'secondary',
  size = 'sm',
  iconOnly = false,
  pressed = false,
  className = ''
}: ButtonClassOptions = {}): string {
  return [BASE, iconOnly ? SQUARE[size] : SIZES[size], pressed ? PRESSED_CLASS : VARIANTS[variant], className]
    .filter(Boolean)
    .join(' ');
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Drawn before the label. */
  icon?: React.ComponentType<{ className?: string }>;
  /** Drawn after the label — a chevron, an arrow. */
  trailing?: React.ComponentType<{ className?: string }>;
}

const ICON_SIZE: Record<ButtonSize, string> = {
  xs: 'h-3.5 w-3.5',
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4'
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'sm',
  icon: Icon,
  trailing: Trailing,
  className = '',
  children,
  type = 'button',
  ...rest
}) => (
  <button type={type} className={buttonClass({ variant, size, className })} {...rest}>
    {Icon && <Icon className={ICON_SIZE[size]} />}
    {children}
    {Trailing && <Trailing className={ICON_SIZE[size]} />}
  </button>
);

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** The accessible name and the tooltip: an icon-only control has no other words. */
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  variant?: ButtonVariant;
  size?: ButtonSize;
  pressed?: boolean;
  /** Overrides `label` in the tooltip when the two differ (a title that says more). */
  title?: string;
}

const ICON_ONLY_SIZE: Record<ButtonSize, string> = {
  xs: 'h-3.5 w-3.5',
  sm: 'h-4 w-4',
  md: 'h-[18px] w-[18px]'
};

export const IconButton: React.FC<IconButtonProps> = ({
  label,
  icon: Icon,
  variant = 'ghost',
  size = 'sm',
  pressed,
  title,
  className = '',
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    title={title ?? label}
    aria-label={label}
    aria-pressed={pressed}
    className={buttonClass({ variant, size, iconOnly: true, pressed, className })}
    {...rest}
  >
    <Icon className={ICON_ONLY_SIZE[size]} />
  </button>
);

export interface SegmentItem<T extends string> {
  id: T;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export interface SegmentedProps<T extends string> {
  items: ReadonlyArray<SegmentItem<T>>;
  value: T;
  onChange: (value: T) => void;
  size?: ButtonSize;
  className?: string;
  /** Names the group for a screen reader. */
  label?: string;
}

/**
 * A row of mutually exclusive views (canvas/columns, desktop/phone), drawn as one control: a
 * recessed track with a raised raised selected key. It replaces the loose row of coloured buttons
 * each screen had invented for itself.
 */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  size = 'sm',
  className = '',
  label
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex items-center gap-0.5 rounded-lg border border-slate-800 bg-slate-950/70 p-0.5 ${className}`}
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            title={item.label}
            aria-label={item.label}
            aria-pressed={active}
            className={buttonClass({
              variant: 'ghost',
              size,
              iconOnly: true,
              pressed: active,
              className: active ? '' : 'ring-0'
            })}
          >
            <item.icon className={ICON_ONLY_SIZE[size]} />
          </button>
        );
      })}
    </div>
  );
}
