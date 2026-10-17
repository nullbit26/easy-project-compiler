import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { BuildBadge } from '../components/BuildBadge';
import { LanguageProvider } from '../context/LanguageContext';

/**
 * The badge answers one question only — "which build is on screen?" — so the tests are about it
 * naming the build the server reports and staying out of the way everywhere else.
 */

function mockHealth(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }))
  );
}

/** Lets the fetch promise chain settle without waiting on a real network. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the build badge', () => {
  it('names the exact build the server is running', async () => {
    mockHealth({
      build: {
        id: '261015-1432-ab12',
        builtAt: '2026-10-15T14:32:00.000Z',
        mode: 'desktop',
        stateDir: 'C:\\Приложение-для-тестеров\\data'
      }
    });

    render(
      <LanguageProvider>
        <BuildBadge />
      </LanguageProvider>
    );

    expect(await screen.findByText('261015-1432-ab12')).toBeInTheDocument();
  });

  it('stays quiet on a development run, which has no build id', async () => {
    mockHealth({ build: { id: 'dev', mode: 'development' } });

    const { container } = render(
      <LanguageProvider>
        <BuildBadge />
      </LanguageProvider>
    );
    await settle();

    expect(container.textContent).toBe('');
  });

  it('stays quiet when the server cannot be asked at all', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));

    const { container } = render(
      <LanguageProvider>
        <BuildBadge />
      </LanguageProvider>
    );
    await settle();

    expect(container.textContent).toBe('');
  });
});
