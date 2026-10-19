import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

interface ToastProps {
  message: string | null;
  onClose: () => void;
}

/** The length of the leave animation; the text stays mounted until it is over. */
const EXIT_MS = 220;

/**
 * One line under the title bar, for a moment.
 *
 * A toast is a sentence the app owes the reader and nothing else: it used to carry a green plate
 * with a tick, an emerald border and a shadow, which made a one-line report look like a dialog.
 * The tick also claimed success for every message, including the ones that were not one. What is
 * left is the sentence, a hairline and a close button — narrow enough to be read and dismissed
 * without covering the screen it is talking about.
 *
 * Both motions are CSS keyframes (`toast-enter` / `toast-leave` in index.css), not a transition on
 * a class added after mount: an element inserted and given its final class in the same frame never
 * paints the starting value, so the old toast appeared by jumping into place. On exit the message
 * goes to `null` at once, but the component keeps the last text mounted for the length of the fade
 * instead of vanishing on the frame the timer fires.
 */
export const Toast: React.FC<ToastProps> = ({ message, onClose }) => {
  const { language } = useLanguage();
  const ru = language === 'ru';
  /** The text on screen: `message` while it exists, then the last one during the exit. */
  const [text, setText] = useState<string | null>(message);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (message) {
      setText(message);
      setLeaving(false);
      return undefined;
    }

    setLeaving(true);
    const timer = setTimeout(() => setText(null), EXIT_MS);
    return () => clearTimeout(timer);
  }, [message]);

  if (!text) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-11 z-50 flex justify-center px-3">
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-auto flex max-w-[min(26rem,calc(100vw-1.5rem))] items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/95 py-1.5 pl-3 pr-1 shadow-lg shadow-black/20 ${
          leaving ? 'toast-leave' : 'toast-enter'
        }`}
      >
        <span className="line-clamp-2 min-w-0 text-[11px] leading-4 text-slate-200">{text}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={ru ? 'Закрыть уведомление' : 'Dismiss the notification'}
          title={ru ? 'Закрыть' : 'Dismiss'}
          className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};
