import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { LanguageProvider } from '../context/LanguageContext';
import { ApiSettingsPanel } from '../components/ApiSettingsPanel';

/**
 * API keys: a settings list, not six little forms.
 *
 * The fields used to be named by their placeholder and nothing else, so a screen reader announced
 * the same «Вставьте ключ API» for every row. Saved providers also kept an empty field and a Save
 * button under their mask — twice the height of a row that was already set up. Both are pinned
 * here: every field has a name, a saved row is a mask with three icon actions, and the key is
 * written when the field is left rather than when a button is pressed.
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
    },
    {
      id: 'openrouter',
      envVar: 'OPENROUTER_API_KEY',
      labelRu: 'OpenRouter',
      labelEn: 'OpenRouter',
      keyUrl: 'https://example.test/openrouter',
      configured: false,
      source: null,
      masked: null,
      prefixWarning: false
    },
    {
      id: 'groq',
      envVar: 'GROQ_API_KEY',
      labelRu: 'Groq',
      labelEn: 'Groq',
      keyUrl: 'https://example.test/groq',
      configured: false,
      source: null,
      masked: null,
      prefixWarning: false
    }
  ],
  activeProvider: 'openai',
  lastModel: 'gpt-4o-mini'
};

const GEMINI_KEY = 'AIzaSyA1234567890abcdefghijklmnop';

function mockApi() {
  return vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: status })
    })
  );
}

function renderPanel() {
  return render(
    <LanguageProvider>
      <ApiSettingsPanel onClose={() => {}} />
    </LanguageProvider>
  );
}

let fetchMock: ReturnType<typeof mockApi>;

beforeEach(() => {
  localStorage.clear();
  fetchMock = mockApi();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const putCalls = () =>
  (fetchMock.mock.calls as any[]).filter(([, init]) => init?.method === 'PUT');

describe('API keys panel', () => {
  it('1. names every field after its own provider, not after the shared placeholder', async () => {
    renderPanel();

    const gemini = await screen.findByLabelText('Ключ API: Google Gemini');
    expect(gemini.getAttribute('placeholder')).toBe('Вставьте ключ API');
    expect(screen.getByLabelText('Ключ API: OpenRouter')).toBeTruthy();
    expect(screen.getByLabelText('Ключ API: Groq')).toBeTruthy();
  });

  it('2. collapses a saved provider to its mask and three named icon actions', async () => {
    renderPanel();

    await screen.findByText('sk-…1234');
    expect(screen.queryByLabelText('Ключ API: OpenAI')).toBeNull();
    expect(screen.getByRole('button', { name: 'Проверить: OpenAI' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Заменить: OpenAI' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Удалить: OpenAI' })).toBeTruthy();
  });

  it('3. has no Save button: leaving the field writes the key', async () => {
    renderPanel();

    const field = await screen.findByLabelText('Ключ API: Google Gemini');
    fireEvent.change(field, { target: { value: GEMINI_KEY } });
    // Typing alone writes nothing — the field is the draft, leaving it is the commit.
    expect(putCalls()).toHaveLength(0);
    fireEvent.blur(field);

    await waitFor(() => expect(putCalls()).toHaveLength(1));
    const [, init] = putCalls()[0] as any;
    expect(JSON.parse(init.body)).toEqual({ key: GEMINI_KEY });
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
  });

  it('4. a saved key collapses the field into its mask', async () => {
    const saved = {
      ...status,
      providers: status.providers.map((provider) =>
        provider.id === 'gemini'
          ? { ...provider, configured: true, source: 'app' as const, masked: 'AIza••••••mnop' }
          : provider
      )
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: any, init?: any) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true, data: init?.method === 'PUT' ? saved : status })
        })
      )
    );

    renderPanel();

    const field = await screen.findByLabelText('Ключ API: Google Gemini');
    fireEvent.change(field, { target: { value: GEMINI_KEY } });
    fireEvent.blur(field);

    await screen.findByText('AIza••••••mnop');
    expect(screen.queryByLabelText('Ключ API: Google Gemini')).toBeNull();
  });

  it('5. Enter writes once, even though the field blurs right after', async () => {
    renderPanel();

    const field = await screen.findByLabelText('Ключ API: Google Gemini');
    fireEvent.change(field, { target: { value: GEMINI_KEY } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.blur(field);

    await waitFor(() => expect(putCalls()).toHaveLength(1));
  });

  it('6. replacing a saved key opens a named field that can be hidden again', async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Заменить: OpenAI' }));

    const field = screen.getByLabelText('Ключ API: OpenAI');
    expect(field.getAttribute('placeholder')).toBe('Вставьте новый ключ, чтобы заменить текущий');
    const reveal = screen.getByRole('button', { name: 'Показать: OpenAI' });
    expect(reveal.getAttribute('tabindex')).toBeNull();
  });
});
