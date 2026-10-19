import React from 'react';
import { HelpCircle } from 'lucide-react';

interface HelpHintProps {
  /** The sentence the mark stands for: also its accessible name, so it is not a hover-only secret. */
  text: string;
  className?: string;
}

/**
 * A quiet question mark for one sentence that explains a mechanism rather than a state.
 *
 * The folder card used to end with a paragraph about sandboxing and undo copies — true, but it was
 * the widest line in a row of one-line facts, and it described how the app behaves in general, not
 * what this folder is doing right now. The rule the interface follows is that a caption explaining
 * an element should be the element's own tooltip when the explanation is not about the current
 * state. The mark is a hairline glyph, not an emoji and not a coloured badge, and the sentence is
 * both its tooltip and its accessible name.
 */
export const HelpHint: React.FC<HelpHintProps> = ({ text, className = '' }) => (
  <button
    type="button"
    title={text}
    aria-label={text}
    className={`flex h-5 w-5 shrink-0 cursor-help items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-800/80 hover:text-slate-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-400 ${className}`}
  >
    <HelpCircle className="h-3.5 w-3.5" />
  </button>
);
