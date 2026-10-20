import type { UiLanguage } from './uiLanguage';

/**
 * What every screen says when the request did not reach the app's own server.
 *
 * The page can be opened from a bare Vite or static server — the kind used to look at the interface
 * while it is being built. Every `/api/*` is answered there with the app's own HTML, so the API layer
 * has nothing but the status text ("Not Found") and screens used to print `Server error: Not Found`,
 * which names the transport and sends the user looking in the wrong place. The app's server is the
 * half that reads folders, runs checks and builds previews; without it nothing on those screens can
 * work, and saying so is the only honest thing to say.
 *
 * It lives in a module of its own because the API layer writes it: importing the error type from
 * `services/api` here would make the two modules import each other.
 */
export function serverUnreachableMessage(language: UiLanguage): string {
  return language === 'ru'
    ? 'Сервер приложения не отвечает — перезапустите его и обновите страницу.'
    : 'The app server is not answering — restart it and reload the page.';
}
