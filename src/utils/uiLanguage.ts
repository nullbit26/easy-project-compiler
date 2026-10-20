/**
 * The language the window is set to, readable outside React.
 *
 * The screens take their language from `LanguageContext`, but the API layer is not a React
 * component: when a request fails without an answer it has to write a sentence before any screen
 * catches it, and that sentence must be in the language the user picked. The storage key lives here
 * so the context and the API layer cannot drift apart.
 */

export const LANGUAGE_STORAGE_KEY = 'easy_project_compiler_lang';

export type UiLanguage = 'ru' | 'en';

export function storedLanguage(): UiLanguage {
  try {
    const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === 'en' || saved === 'ru') return saved;
  } catch {
    // Storage can be refused (private mode); the window still has a language.
  }
  return 'ru';
}
