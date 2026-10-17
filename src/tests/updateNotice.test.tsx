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

  it('4. when the build is ready it says it waits for the next start, and offers a restart', async () => {
    const bridge = installBridge({ status: 'ready', version: '1.1.0', percent: 100 });
    renderNotice();

    expect(await screen.findByText(/Обновление готово/)).toBeInTheDocument();
    expect(screen.getByText(/следующем запуске/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Перезапустить/ }));
    await waitFor(() => expect(bridge.install).toHaveBeenCalledTimes(1));
    expect(bridge.check).not.toHaveBeenCalled();
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
