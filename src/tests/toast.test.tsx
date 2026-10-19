import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { LanguageProvider } from '../context/LanguageContext';
import { Toast } from '../components/Toast';

/**
 * A notification arrives and leaves over time, and says only what happened.
 *
 * The toast used to be a green plate with a tick, an emerald border and a shadow — a one-line
 * report dressed as a dialog — and its entrance classes (`animate-in fade-in slide-in-from-top-4`)
 * belonged to a plugin this project does not use, so it appeared by jumping into place. The exit
 * was worse: the message went to `null` and the component unmounted on that same frame, so there
 * was nothing to fade.
 *
 * These checks pin the behaviour that is invisible in a screenshot: the component is mounted at
 * rest and then moves in, and when the message is cleared it stays in the tree while it fades out
 * instead of disappearing at once.
 */
describe('the toast', () => {
  const renderToast = (message: string | null, onClose = vi.fn()) =>
    render(
      <LanguageProvider>
        <Toast message={message} onClose={onClose} />
      </LanguageProvider>
    );

  it('1. rides in on its own animation instead of appearing already in place', () => {
    renderToast('Проверки прошли: 1');

    // A keyframe animation starts with the element; a transition on a class added after mount
    // does not, which is why the old toast simply appeared. The class is the contract with
    // index.css.
    const toast = screen.getByRole('status');
    expect(toast.className).toContain('toast-enter');
    expect(toast.className).not.toContain('toast-leave');
  });

  it('2. stays mounted while it fades out, then leaves', async () => {
    const { rerender } = renderToast('Проверки прошли: 1');
    expect(screen.getByRole('status').className).toContain('toast-enter');

    rerender(
      <LanguageProvider>
        <Toast message={null} onClose={vi.fn()} />
      </LanguageProvider>
    );

    // Still on screen, now running the leave animation — this is the window the fade plays in.
    const fading = screen.getByRole('status');
    expect(fading.className).toContain('toast-leave');
    expect(fading).toHaveTextContent('Проверки прошли: 1');

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument(), { timeout: 1000 });
  });

  it('3. carries no state colour and no tick — just the sentence and a close control', async () => {
    const onClose = vi.fn();
    const { container } = renderToast('Проверки прошли: 1', onClose);

    const toast = screen.getByRole('status');
    expect(toast.textContent).toBe('Проверки прошли: 1');
    expect(toast.innerHTML).not.toMatch(/emerald/);
    // One glyph only: the cross in the close button. The green check plate is gone.
    expect(container.querySelectorAll('svg')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /Закрыть уведомление|Dismiss the notification/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
