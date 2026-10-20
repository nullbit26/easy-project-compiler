import { ApiError } from '../services/api';
import type { UiLanguage } from './uiLanguage';

/**
 * What the sandbox says when the build request never reached the app's own server.
 *
 * The preview is built by the server, not by the page: it reads the connected folder, finds the
 * entry point and serves the result from its own origin. A preview cannot be built by a page alone,
 * so the sandbox's sentence is about the server as well — with the one fact that is specific to it.
 * Every other failure keeps the message the server wrote, because that one knows what went wrong in
 * the folder.
 */
export function previewBuildMessage(error: unknown, language: UiLanguage): string {
  if (error instanceof ApiError) {
    if (error.reason === 'not_json') {
      return language === 'ru'
        ? 'Сервер приложения не отвечает — превью собирается только вместе с ним.'
        : 'The app server is not answering — the preview only builds alongside it.';
    }
    return error.userMessage;
  }
  return language === 'ru' ? 'Не удалось собрать проект.' : 'The project could not be built.';
}
