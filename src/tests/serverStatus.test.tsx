import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { LanguageProvider } from '../context/LanguageContext';
import { TitleBar } from '../components/TitleBar';
import App from '../App';

/**
 * The window says once that it has no server, before any screen has failed on its own.
 *
 * The title bar is the only strip that exists on every screen, so the sentence lives there: a dot
 * and three words, with the actionable sentence in the tooltip. The app asks `/api/health` when it
 * opens; a page served by a bare static server answers with its own HTML, and that is the answer
 * this state exists for.
 */

function htmlAnswer() {
  return {
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token <');
    }
  } as unknown as Response;
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('The title bar without the app’s server', () => {
  it('1. says it in Russian, with the actionable sentence in the tooltip', () => {
    render(
      <LanguageProvider>
        <TitleBar serverMissing />
      </LanguageProvider>
    );

    const status = screen.getByTestId('server-status');
    expect(status).toHaveTextContent('Сервер приложения не отвечает');
    expect(status.getAttribute('title')).toBe(
      'Сервер приложения не отвечает — перезапустите его и обновите страницу.'
    );
  });

  it('2. says it in English when the window is set to English', () => {
    localStorage.setItem('easy_project_compiler_lang', 'en');

    render(
      <LanguageProvider>
        <TitleBar serverMissing />
      </LanguageProvider>
    );

    const status = screen.getByTestId('server-status');
    expect(status).toHaveTextContent('The app server is not answering');
    expect(status.getAttribute('title')).toBe(
      'The app server is not answering — restart it and reload the page.'
    );
  });

  it('3. stays out of the bar when the server is there', () => {
    render(
      <LanguageProvider>
        <TitleBar />
      </LanguageProvider>
    );

    expect(screen.queryByTestId('server-status')).toBeNull();
  });

  it('4. the app asks its own server when it opens, and the status appears when it is not there', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(htmlAnswer());

    render(<App />);

    expect(await screen.findByTestId('server-status')).toHaveTextContent(
      'Сервер приложения не отвечает'
    );
  });
});
