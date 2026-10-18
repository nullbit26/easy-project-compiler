/**
 * Putting text on the clipboard — and never saying it happened when it did not.
 *
 * Handing a prompt to another program is the app's whole job, and the buttons that do it called
 * `navigator.clipboard.writeText` and set «Скопировано» in the same breath, without waiting for the
 * answer. In the desktop shell that answer was always a refusal — every permission request went back
 * as «нет», clipboard writes among them — so the button said it had copied while the clipboard kept
 * whatever was there before.
 *
 * Three ways, tried in this order, because the app runs in three kinds of window. The desktop shell
 * has a bridge of its own (see electron/preload.ts): the main process writes to the system clipboard
 * with no permission to be granted or refused, which is the one path that cannot be broken by a
 * permission handler. In a browser there is no bridge, so the async clipboard API is the way — and
 * when a window refuses that too, the selection-based copy is the floor, needing no permission at
 * all because the click itself is the gesture.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** The shell's own clipboard writer, when the app is running in the desktop window. */
interface DesktopClipboardBridge {
  write: (text: string) => Promise<boolean>;
}

declare global {
  interface Window {
    desktopClipboard?: DesktopClipboardBridge;
  }
}

/** True when the text really is on the clipboard. */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  const bridge = typeof window === 'undefined' ? undefined : window.desktopClipboard;
  if (bridge?.write) {
    try {
      if (await bridge.write(text)) return true;
    } catch {
      /* a shell that cannot answer still leaves the browser ways below */
    }
  }

  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      /* refused or not permitted — the selection-based copy below is still a way */
    }
  }

  return copyThroughSelection(text);
}

/**
 * The copy every browser has had for far longer than the async one: a temporary field, selected,
 * `execCommand('copy')`. It cannot be denied by a permission handler, which is why it is the floor
 * this file stands on.
 */
function copyThroughSelection(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;

  const field = document.createElement('textarea');
  field.value = text;
  // Read-only so a mobile keyboard does not open, and off screen but still selectable: `display: none`
  // would be nothing to select.
  field.setAttribute('readonly', 'readonly');
  field.style.position = 'fixed';
  field.style.top = '-1000px';
  field.style.left = '-1000px';
  field.style.opacity = '0';
  document.body.appendChild(field);

  let copied = false;
  try {
    field.select();
    field.setSelectionRange(0, field.value.length);
    copied = document.execCommand('copy') === true;
  } catch {
    copied = false;
  } finally {
    field.remove();
  }
  return copied;
}

/** What a copying button has to say about itself, and nothing else. */
export type CopyState = 'idle' | 'copied' | 'failed';

/**
 * Copying, with the two things a button owes the person pressing it: it worked, or it did not and the
 * text has to be selected by hand. One hook so every such button tells the same story — and so the
 * failure of one of them is a thing the app can say, not a thing it hides.
 */
export function useCopyFlash(resetMs = 2000): {
  state: CopyState;
  copy: (text: string) => Promise<boolean>;
  /** Back to «nothing copied yet», for a screen that has just replaced the text on offer. */
  reset: () => void;
} {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const copy = useCallback(
    async (text: string) => {
      const ok = await copyText(text);
      setState(ok ? 'copied' : 'failed');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState('idle'), resetMs);
      return ok;
    },
    [resetMs]
  );

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setState('idle');
  }, []);

  return { state, copy, reset };
}
