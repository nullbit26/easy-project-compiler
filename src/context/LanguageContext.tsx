import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Language, translations, Translations } from '../i18n/translations';
import { LANGUAGE_STORAGE_KEY, storedLanguage } from '../utils/uiLanguage';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: Translations;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  /*
   * The stored choice is read by a plain function, not here: the API layer needs the same language
   * for the failures it writes before any screen sees them, and two readers of one key would drift.
   */
  const [language, setLanguageState] = useState<Language>(storedLanguage);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    } catch {
      // ignore
    }
  };

  const toggleLanguage = () => {
    const next = language === 'ru' ? 'en' : 'ru';
    setLanguage(next);
  };

  useEffect(() => {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // ignore
    }
  }, [language]);

  const value: LanguageContextType = {
    language,
    setLanguage,
    toggleLanguage,
    t: translations[language]
  };

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    // Graceful fallback to avoid test crash when mounted outside provider
    return {
      language: 'ru',
      setLanguage: () => {},
      toggleLanguage: () => {},
      t: translations['ru']
    };
  }
  return context;
};
