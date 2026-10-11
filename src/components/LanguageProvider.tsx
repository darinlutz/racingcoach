'use client';

import { createContext, useContext, useMemo } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';
import { fmt, LANGUAGE_LOCALES, plural, type Language, type Plural } from '@/lib/i18n/languages';

type LanguageContextValue = {
  language: Language;
  // The user's dictionary: every piece of text on the site, in their Preferred Language
  t: Dictionary;
  // en-US, pt-BR or es-419, for toLocaleString and Intl
  locale: string;
  fmt: typeof fmt;
  plural: (n: number, forms: Plural, values?: Record<string, string | number>) => string;
  // A number formatted for the language, e.g. 1,234.5 / 1.234,5
  number: (n: number, options?: Intl.NumberFormatOptions) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

// Gives client components the user's language and dictionary. The root layout picks them on the server
// (src/lib/i18n/server.ts) and wraps the whole site in this.
export default function LanguageProvider({
  language,
  dictionary,
  children,
}: {
  language: Language;
  dictionary: Dictionary;
  children: React.ReactNode;
}) {
  const value = useMemo<LanguageContextValue>(() => {
    const locale = LANGUAGE_LOCALES[language];
    return {
      language,
      t: dictionary,
      locale,
      fmt,
      plural: (n, forms, values) => plural(language, n, forms, values),
      number: (n, options) => n.toLocaleString(locale, options),
    };
  }, [language, dictionary]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('useLanguage must be used inside LanguageProvider');
  return value;
}
