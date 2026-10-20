import { describe, it, expect, afterEach, vi } from 'vitest';
import { ApiError, buildPreviewApi } from '../services/api';
import { previewBuildMessage } from '../utils/apiFailure';
import { serverUnreachableMessage } from '../utils/serverUnreachable';
import { LANGUAGE_STORAGE_KEY, storedLanguage } from '../utils/uiLanguage';

/**
 * The server's absence is the one failure every screen has to explain the same way.
 *
 * When the page is served by a bare Vite or static server — the kind used to look at the interface
 * while it is being built — `/api/*` is answered with the app's own HTML. The API layer has nothing
 * but the status text then, and screens used to print `Server error: Not Found`: a sentence about
 * the transport that sends the user looking in the wrong place. The sentence is written once, in the
 * window's language, and every screen prints `userMessage` — files, Git, checks and the sandbox.
 *
 * The sandbox keeps a sentence of its own, because a preview is built by the server specifically.
 */

function htmlError() {
  return {
    ok: false,
    status: 404,
    statusText: 'Not Found',
    // The app's shell (or an empty 404) is not JSON: this is the bare-server case.
    json: async () => {
      throw new SyntaxError('Unexpected token <');
    }
  } as unknown as Response;
}

/**
 * The other shape of the same absence: a GET is handed the app's own page with a 200, because the
 * single-page fallback treats every path as a screen. It looks like success until it is parsed.
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

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('When the app server is not there', () => {
  it('1. says so in the language the window is set to', () => {
    expect(serverUnreachableMessage('ru')).toBe(
      'Сервер приложения не отвечает — перезапустите его и обновите страницу.'
    );
    expect(serverUnreachableMessage('en')).toBe(
      'The app server is not answering — restart it and reload the page.'
    );
  });

  it('2. reads the window’s language from the one key the language switch writes', () => {
    expect(storedLanguage()).toBe('ru');

    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    expect(storedLanguage()).toBe('en');

    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    expect(storedLanguage()).toBe('ru');
  });

  it('3. puts that sentence on the error, so files, Git and checks show it without a rule of their own', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(htmlError());

    const ruFailure = await buildPreviewApi({ language: 'ru' }).catch((error) => error);

    expect(ruFailure).toBeInstanceOf(ApiError);
    expect(ruFailure.status).toBe(404);
    expect(ruFailure.reason).toBe('not_json');
    expect(ruFailure.userMessage).toBe(serverUnreachableMessage('ru'));

    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    const enFailure = await buildPreviewApi({ language: 'en' }).catch((error) => error);
    expect(enFailure.userMessage).toBe(serverUnreachableMessage('en'));
  });

  it('4. catches the same absence behind a 200, where the app’s HTML is parsed as JSON', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(htmlSuccess());

    const failure = await buildPreviewApi({ language: 'ru' }).catch((error) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.reason).toBe('not_json');
    expect(failure.userMessage).toBe(serverUnreachableMessage('ru'));
  });
});

describe('What the sandbox says about the same failure', () => {
  it('5. blames the app server, not the folder, and names what the preview needs', () => {
    const error = new ApiError(404, serverUnreachableMessage('ru'), undefined, 'not_json');

    expect(previewBuildMessage(error, 'ru')).toBe(
      'Сервер приложения не отвечает — превью собирается только вместе с ним.'
    );
    expect(previewBuildMessage(error, 'en')).toBe(
      'The app server is not answering — the preview only builds alongside it.'
    );
  });

  it('6. keeps the message the server wrote when the build itself failed', () => {
    const error = new ApiError(400, 'Папка проекта ещё не подключена — запускать нечего.');

    // The server answered in the language the request asked for; its sentence is kept as it is.
    expect(previewBuildMessage(error, 'ru')).toBe('Папка проекта ещё не подключена — запускать нечего.');
    expect(previewBuildMessage(error, 'en')).toBe('Папка проекта ещё не подключена — запускать нечего.');
  });

  it('7. leaves anything that is not an API error to the screen’s own fallback', () => {
    expect(previewBuildMessage(new Error('boom'), 'ru')).toBe('Не удалось собрать проект.');
    expect(previewBuildMessage('boom', 'en')).toBe('The project could not be built.');
  });
});
