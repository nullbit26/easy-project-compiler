import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { copyText, useCopyFlash } from '../utils/copyText';

/**
 * Copying, and the two things a copying button owes the person pressing it.
 *
 * The desktop shell answered every permission request with «нет», clipboard writes among them, and
 * the buttons did not wait for the answer anyway: they said «Скопировано» over a clipboard that never
 * changed. What is pinned here is the answer itself — the async API first, the selection-based copy
 * as the floor, and «не удалось» when neither of them worked.
 */

const originalExec = document.execCommand;

function offerClipboard(writeText: (text: string) => Promise<void>) {
  Object.assign(navigator, { clipboard: { writeText } });
}

afterEach(() => {
  Object.assign(navigator, { clipboard: undefined });
  delete (window as unknown as { desktopClipboard?: unknown }).desktopClipboard;
  document.execCommand = originalExec;
});

describe('1. putting text on the clipboard', () => {
  it('1a. uses the window’s own clipboard API when it answers', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    offerClipboard(writeText);

    await expect(copyText('промпт')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('промпт');
  });

  it('1b. falls back to the selection copy when the window refuses the API', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    offerClipboard(writeText);
    const exec = vi.fn(() => true);
    document.execCommand = exec as unknown as typeof document.execCommand;

    await expect(copyText('промпт')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalled();
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('1c. answers false when neither way works, so the button can say so', async () => {
    offerClipboard(() => Promise.reject(new Error('NotAllowedError')));
    document.execCommand = vi.fn(() => false) as unknown as typeof document.execCommand;

    await expect(copyText('промпт')).resolves.toBe(false);
  });

  it('1e. uses the shell’s own bridge when the app runs in the desktop window', async () => {
    // The shell writes to the system clipboard itself: no permission to be granted, and therefore
    // nothing that can silently turn the button back into a lie.
    const write = vi.fn(() => Promise.resolve(true));
    Object.assign(window, { desktopClipboard: { write } });
    const writeText = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    offerClipboard(writeText);

    await expect(copyText('промпт')).resolves.toBe(true);
    expect(write).toHaveBeenCalledWith('промпт');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('1f. a bridge that could not write does not lose the browser ways', async () => {
    Object.assign(window, { desktopClipboard: { write: () => Promise.resolve(false) } });
    const writeText = vi.fn(() => Promise.resolve());
    offerClipboard(writeText);

    await expect(copyText('промпт')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('промпт');
  });

  it('1d. nothing to copy is not a copy', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    offerClipboard(writeText);

    await expect(copyText('')).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe('2. what the button remembers about it', () => {
  it('2a. remembers a copy that worked', async () => {
    offerClipboard(() => Promise.resolve());
    const { result } = renderHook(() => useCopyFlash(40));

    await act(async () => {
      await result.current.copy('промпт');
    });
    expect(result.current.state).toBe('copied');

    // And forgets it again, so the button goes back to offering the copy.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(result.current.state).toBe('idle');
  });

  it('2b. remembers a copy that did not happen', async () => {
    offerClipboard(() => Promise.reject(new Error('NotAllowedError')));
    document.execCommand = vi.fn(() => false) as unknown as typeof document.execCommand;
    const { result } = renderHook(() => useCopyFlash(40));

    await act(async () => {
      await result.current.copy('промпт');
    });
    expect(result.current.state).toBe('failed');
  });

  it('2c. a new screen’s text takes the old answer away', async () => {
    offerClipboard(() => Promise.resolve());
    const { result } = renderHook(() => useCopyFlash(5000));

    await act(async () => {
      await result.current.copy('первый промпт');
    });
    expect(result.current.state).toBe('copied');

    act(() => result.current.reset());
    expect(result.current.state).toBe('idle');
  });
});
