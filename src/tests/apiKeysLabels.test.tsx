import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { LanguageProvider } from '../context/LanguageContext';
import { ApiSettingsPanel } from '../components/ApiSettingsPanel';

/**
 * Four providers, four fields that look exactly alike.
 *
 * The fields used to be named by their placeholder and nothing else, so a screen reader announced the
 * same "Вставьте ключ API" for every row: which key was being asked for was impossible to tell without
 * sight. The eye that reveals what was typed was outside the tab order as well, which left a keyboard
 * user unable to check their own input. Both are checked here, because both are silent failures —
 * nothing on the screen looks wrong when a field has no name.
 */

const status = {
  providers: [
    {
      id: 'gemini',
      envVar: 'GEMINI_API_KEY',
      labelRu: 'Google Gemini',
      labelEn: 'Google Gemini',
      keyUrl: 'https://example.test/gemini',
      configured: false,
      source: null,
      masked: null,
      prefixWarning: false
    },
    {
      id: 'openai',
      envVar: 'OPENAI_API_KEY',
      labelRu: 'OpenAI',
      labelEn: 'OpenAI',
      keyUrl: 'https://example.test/openai',
      configured: true,
      source: 'app',
      masked: 'sk-…1234',
      prefixWarning: false
    }
  ],
  activeProvider: 'openai',
  lastModel: 'gpt-4o-mini'
};

function renderPanel() {
  return render(
    <LanguageProvider>
      <ApiSettingsPanel onClose={() => {}} />
    </LanguageProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: status })
      })
    )
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API keys panel: labels', () => {
  it('1. names every field after its own provider, not after the shared placeholder', async () => {
    renderPanel();

    const gemini = await screen.findByLabelText('Ключ API: Google Gemini');
    const openai = screen.getByLabelText('Ключ API: OpenAI');

    // The placeholder is still the hint it was; it just is not the name anymore.
    expect(gemini.getAttribute('placeholder')).toBe('Вставьте ключ API');
    expect(openai.getAttribute('placeholder')).toBe('Вставьте новый ключ, чтобы заменить текущий');
  });

  it('2. names the reveal button after its provider and keeps it in the tab order', async () => {
    renderPanel();

    const reveal = await screen.findByRole('button', { name: 'Показать: OpenAI' });
    expect(reveal.getAttribute('tabindex')).toBeNull();
    expect(screen.getByRole('button', { name: 'Показать: Google Gemini' })).toBeTruthy();
  });
});
