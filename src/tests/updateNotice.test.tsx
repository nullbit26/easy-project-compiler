import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { UpdateNotice } from '../components/UpdateNotice';
import { LanguageProvider } from '../context/LanguageContext';
import { UpdateState } from '../utils/updateRules';

/**
 * The sidebar line that talks about a newer build.
 *
 * What these tests guard: the line is not a dialog and never takes the window over; each state says
 * one thing; and the buttons ask the shell for exactly one action. The bridge is the only way the
 * page can reach the updater, so a button that calls the wrong verb is a real bug — it would look
 * like it worked and do nothing.
 */

type Bridge = {
  state: ReturnType<typeof vi.fn>;
  check: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
  install: ReturnType<typeof vi.fn>;
  onStateChange: (listener: (state: UpdateState) => void) => () => void;
};

let listener: ((state: UpdateState) => void) | null = null;

function installBridge(initial: UpdateState): Bridge {
  const bridge: Bridge = {
    state: vi.fn(async () => initial),
    check: vi.fn(async () => initial),
    download: vi.fn(async () => initial),
    install: vi.fn(async () => ({ applied: true })),
    onStateChange: (next) => {
      listener = next;
      return () => {
        listener = null;
      };
    }
  };
  (window as unknown as { desktopUpdates?: Bridge }).desktopUpdates = bridge;
  return bridge;
}

const renderNotice = () =>
  render(
    <LanguageProvider>
      <UpdateNotice />
    </LanguageProvider>
  );

describe('the update line in the sidebar', () => {
  beforeEach(() => {
    listener = null;
    localStorage.setItem('easy_project_compiler_lang', 'ru');
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { desktopUpdates?: Bridge }).desktopUpdates;
  });

  it('1. says nothing at all outside the desktop app', () => {
    const { container } = renderNotice();
    expect(container.textContent).toBe('');
    expect(container.querySelector('[data-update-notice]')).toBeNull();
  });

  it('2. offers the release with a button, and the button asks for the download', async () => {
    const bridge = installBridge({ status: 'available', version: '1.1.0' });
    renderNotice();

    const button = await screen.findByRole('button', { name: /Скачать/ });
    expect(screen.getByText(/1\.1\.0/)).toBeInTheDocument();
    fireEvent.click(button);
    await waitFor(() => expect(bridge.download).toHaveBeenCalledTimes(1));
    expect(bridge.install).not.toHaveBeenCalled();
  });

  it('3. shows the background download as a number that climbs', async () => {
    installBridge({ status: 'downloading', version: '1.1.0', percent: 0 });
    renderNotice();
    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');

    listener?.({ status: 'downloading', version: '1.1.0', percent: 42 });
    const bar = await screen.findByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByText(/42%/)).toBeInTheDocument();
  });

  it('4. when the build is ready it names the version and offers the restart as one icon', async () => {
    const bridge = installBridge({ status: 'ready', version: '1.1.0', percent: 100 });
    const { container } = renderNotice();

    expect(await screen.findByText('1.1.0')).toBeInTheDocument();
    expect(screen.getByText(/готова/)).toBeInTheDocument();

    /*
     * The old card explained itself in a paragraph and asked for a full-width filled button. A
     * status row is one line: the version, and one icon whose name is in its tooltip.
     */
    const row = container.querySelector('[data-update-notice="ready"]')!;
    expect(row.querySelectorAll('p')).toHaveLength(1);
    expect(row.querySelectorAll('button')).toHaveLength(1);
    const restart = screen.getByRole('button', { name: 'Перезапустить и обновить' });
    expect(restart.textContent).toBe('');
    expect(restart.getAttribute('title')).toBe('Перезапустить и обновить');

    fireEvent.click(restart);
    await waitFor(() => expect(bridge.install).toHaveBeenCalledTimes(1));
    expect(bridge.check).not.toHaveBeenCalled();
  });

  it('7. the state is light running around the row’s own edge, not a second control', async () => {
    installBridge({ status: 'ready', version: '1.1.0', percent: 100 });
    const { container } = renderNotice();

    await screen.findByText('1.1.0');
    /*
     * The row used to carry a 5 × 5 field of tiles. The field took horizontal room from the version
     * and read as a small unrelated glyph; the status is now the row's own border, which costs no
     * width and cannot be mistaken for something pressable.
     */
    const row = container.querySelector('[data-update-notice="ready"]')!;
    expect(row.getAttribute('data-update-runner')).toBe('emerald');
    expect(row.className).toContain('epc-runner');
    expect(container.querySelector('[data-update-tiles]')).toBeNull();
    // The light itself is decoration; the row still says the version and the state in words.
    expect(screen.getByText(/готова/)).toBeInTheDocument();
  });

  it('8. the download offer is an icon too, named for the screen reader', async () => {
    const bridge = installBridge({ status: 'available', version: '1.3.1' });
    renderNotice();

    const download = await screen.findByRole('button', { name: 'Скачать обновление' });
    expect(download.textContent).toBe('');
    fireEvent.click(download);
    await waitFor(() => expect(bridge.download).toHaveBeenCalledTimes(1));
  });

  it('5. a failed check is a quiet line with a retry, not an error box', async () => {
    const bridge = installBridge({ status: 'error', error: 'Нет связи с сервером обновлений' });
    renderNotice();

    expect(await screen.findByText('Нет связи с сервером обновлений')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    await waitFor(() => expect(bridge.check).toHaveBeenCalledTimes(1));
  });

  it('6. idle, checking and up-to-date are silent: a line that says nothing is noise', async () => {
    for (const status of ['idle', 'checking', 'current', 'unconfigured'] as const) {
      installBridge({ status });
      const { container, unmount } = renderNotice();
      await waitFor(() => expect(container.querySelector('[data-update-notice]')).toBeNull());
      unmount();
    }
  });
});
