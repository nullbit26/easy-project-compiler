import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { LanguageProvider } from '../context/LanguageContext';
import { CodePreviewRunner } from '../components/CodePreviewRunner';

/**
 * The sandbox screen is what the user opens to see their own project run.
 *
 * The screen used to require a project in the app and showed "create a project first" otherwise —
 * even with a folder connected, which is exactly when there is something to run. These tests keep
 * that door open: the connected folder runs with no project selected, what the builder found is
 * what the iframe receives, and a failed build is offered to the error coach as text.
 */

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api')>();
  return { ...actual, buildPreviewApi: vi.fn() };
});

import { buildPreviewApi } from '../services/api';

const buildPreviewApiMock = buildPreviewApi as unknown as ReturnType<typeof vi.fn>;

function build(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    kind: 'static' as const,
    entry: 'index.html',
    html: '<!DOCTYPE html><html><body><h1 id="game">Бухово кот</h1></body></html>',
    diagnostics: [],
    warnings: [],
    candidates: [
      { path: 'index.html', kind: 'static' as const },
      { path: 'src/main.js', kind: 'bundle' as const }
    ],
    durationMs: 5,
    root: 'C:/projects/kot',
    ...overrides
  };
}

function renderScreen(props: Partial<React.ComponentProps<typeof CodePreviewRunner>> = {}) {
  return render(
    <LanguageProvider>
      <CodePreviewRunner project={null} {...props} />
    </LanguageProvider>
  );
}

beforeEach(() => {
  buildPreviewApiMock.mockReset();
  localStorage.clear();
});

describe('Sandbox screen', () => {
  it('1. runs the connected folder with no project selected', async () => {
    buildPreviewApiMock.mockResolvedValue(build());

    const { container } = renderScreen();

    await waitFor(() => expect(container.querySelector('iframe')).toBeTruthy());
    const frame = container.querySelector('iframe') as HTMLIFrameElement;
    // The document the builder produced is the one the sandbox receives.
    expect(frame.getAttribute('srcdoc')).toContain('Бухово кот');
    // The folder is explained, not hidden behind a "create a project" wall.
    expect(screen.getByText('Проект не выбран')).toBeTruthy();
    expect(screen.getByText('Подключённая папка запускается и без проекта: выберите точку входа ниже и смотрите результат.')).toBeTruthy();
  });

  it('2. switching the entry point rebuilds the project from that file', async () => {
    buildPreviewApiMock.mockResolvedValue(build());

    const { container } = renderScreen();
    await waitFor(() => expect(buildPreviewApiMock).toHaveBeenCalledTimes(1));

    const select = container.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'src/main.js' } });

    await waitFor(() => expect(buildPreviewApiMock).toHaveBeenCalledTimes(2));
    expect(buildPreviewApiMock.mock.calls[1][0]).toMatchObject({ entry: 'src/main.js' });
  });

  it('3. shows build errors and hands them to the error coach', async () => {
    buildPreviewApiMock.mockResolvedValue(
      build({
        ok: false,
        html: null,
        kind: 'bundle',
        entry: 'src/main.ts',
        diagnostics: [
          { file: 'src/main.ts', line: 4, column: 12, text: 'Expected ";" but found "}"' }
        ]
      })
    );
    const onSendErrorToCoach = vi.fn();

    renderScreen({ onSendErrorToCoach });

    await waitFor(() => expect(screen.getByText('Собрать не удалось — вот что мешает:')).toBeTruthy());
    expect(screen.getByText(/Expected ";" but found "}"/)).toBeTruthy();

    fireEvent.click(screen.getByText('Объяснить и починить с ИИ'));
    expect(onSendErrorToCoach).toHaveBeenCalledTimes(1);
    expect(onSendErrorToCoach.mock.calls[0][0]).toContain('src/main.ts:4:12');
  });

  it('3b. names what the bundle is made of, without blaming packages the bundle never carried', async () => {
    buildPreviewApiMock.mockResolvedValue(
      build({
        kind: 'bundle',
        entry: 'src/main.js',
        composition: {
          bytes: 1_450_000,
          parts: [
            { name: 'phaser', kind: 'package', bytes: 1_180_000, pct: 81.4 },
            { name: 'src/main.js', kind: 'local', bytes: 120_000, pct: 8.3 },
            { name: 'src/scenes/menu.js', kind: 'local', bytes: 40_000, pct: 2.8 }
          ],
          externals: ['vue'],
          truncated: true
        }
      })
    );

    const first = renderScreen();

    await waitFor(() => expect(screen.getByText('Из чего состоит сборка')).toBeTruthy());
    expect(screen.getByText('phaser')).toBeTruthy();
    expect(screen.getByText('пакет')).toBeTruthy();
    // The folder's own files are labelled as such, not lumped in with the dependencies.
    expect(screen.getAllByText('ваш файл').length).toBe(2);
    expect(screen.getByText('1.13 MB')).toBeTruthy();
    expect(screen.getByText('81.4%')).toBeTruthy();
    expect(screen.getByText(/Показаны не все части/)).toBeTruthy();
    // A package that is fetched instead of bundled is said to be outside the number.
    expect(screen.getByText('vue')).toBeTruthy();
    expect(screen.getByText(/берётся из интернета/)).toBeTruthy();

    // A page that needed no bundling gets no composition panel invented for it.
    first.unmount();
    buildPreviewApiMock.mockResolvedValue(build());
    const second = renderScreen();
    await waitFor(() => expect(second.container.querySelector('iframe')).toBeTruthy());
    expect(screen.queryByText('Из чего состоит сборка')).toBeNull();
  });

  it('4. draws the focus ring on the frame itself while the keyboard is inside the preview', async () => {
    buildPreviewApiMock.mockResolvedValue(build());

    const { container } = renderScreen();
    await waitFor(() => expect(container.querySelector('iframe')).toBeTruthy());
    const frame = container.querySelector('iframe') as HTMLIFrameElement;
    expect(frame.className).not.toContain('outline-2');

    /* Focus lands inside the frame's own document: the page sees the frame as the active element and
       the window as blurred — which is exactly the pair the screen watches. */
    frame.focus();
    expect(document.activeElement?.tagName).toBe('IFRAME');
    fireEvent.blur(window);
    await waitFor(() => expect(container.querySelector('iframe')!.className).toContain('outline-2'));

    /* And it goes away again when the keyboard comes back to the rest of the app. */
    (container.querySelector('button') as HTMLButtonElement).focus();
    expect(document.activeElement?.tagName).toBe('BUTTON');
    fireEvent.focus(window);
    await waitFor(() => expect(container.querySelector('iframe')!.className).not.toContain('outline-2'));
  });

  it('5. tells the user to connect a folder when none is bound', async () => {
    buildPreviewApiMock.mockResolvedValue(
      build({
        ok: false,
        html: null,
        kind: null,
        entry: null,
        root: '',
        candidates: []
      })
    );

    const { container } = renderScreen();

    await waitFor(() => expect(screen.getByText('Папка проекта не подключена')).toBeTruthy());
    expect(container.querySelector('iframe')).toBeNull();
  });
});
