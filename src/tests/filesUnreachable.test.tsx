import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { LanguageProvider } from '../context/LanguageContext';
import { FilePane } from '../components/studio/FilePane';
import { LANGUAGE_STORAGE_KEY } from '../utils/uiLanguage';

/**
 * The files window is the first one a bare Vite server breaks: it asks for the connected folder and
 * is answered with the app's own HTML. The sentence comes from the API layer, in the window's
 * language, and the window prints it as it is — this test keeps that chain whole rather than
 * asserting that a component can render a string it was handed.
 */

function htmlError() {
  return {
    ok: false,
    status: 404,
    statusText: 'Not Found',
    json: async () => {
      throw new SyntaxError('Unexpected token <');
    }
  } as unknown as Response;
}

/**
 * A GET is answered with the app's own page and a 200, because the single-page fallback treats every
 * path as a screen. This is the shape the files window actually meets on a bare server.
 */
function htmlSuccess() {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => {
      throw new SyntaxError('Unexpected token <');
    }
  } as unknown as Response;
}

function renderFiles(language: 'ru' | 'en') {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  return render(
    <LanguageProvider>
      <FilePane onOpenFile={() => {}} />
    </LanguageProvider>
  );
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('The files window without the app server', () => {
  it('1. says the server is not answering, in the window’s language', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(htmlError());

    renderFiles('ru');

    expect(
      await screen.findByText('Сервер приложения не отвечает — перезапустите его и обновите страницу.')
    ).toBeTruthy();
    expect(screen.queryByText(/Server error/)).toBeNull();
  });

  it('2. says the same thing in English', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(htmlError());

    renderFiles('en');

    expect(
      await screen.findByText('The app server is not answering — restart it and reload the page.')
    ).toBeTruthy();
    expect(screen.queryByText(/Server error/)).toBeNull();
  });

  it('3. treats the app’s own page served with a 200 as the same absence', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(htmlSuccess());

    renderFiles('ru');

    expect(
      await screen.findByText('Сервер приложения не отвечает — перезапустите его и обновите страницу.')
    ).toBeTruthy();
    expect(screen.queryByText(/Unexpected token|Server error/)).toBeNull();
  });
});
