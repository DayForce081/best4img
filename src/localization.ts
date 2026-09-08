import i18n from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import type { SupportedLocale } from './i18n';

type LocaleDocument = Record<string, unknown>;

const modules = import.meta.glob<LocaleDocument>('./locales/*.json', {
  eager: true,
  import: 'default',
});

const resources = Object.fromEntries(
  Object.entries(modules).map(([path, translation]) => [
    path.match(/\/([^/]+)\.json$/)?.[1],
    { translation },
  ]),
);

void i18n.use(initReactI18next).init({
  resources,
  fallbackLng: 'en',
  supportedLngs: Object.keys(resources),
  lowerCaseLng: true,
  interpolation: { escapeValue: false },
  returnObjects: true,
});

export function setTranslationLocale(locale: SupportedLocale) {
  if (i18n.language !== locale) void i18n.changeLanguage(locale);
}

export function useLocaleSection<T>(section: string): T {
  const { t } = useTranslation();
  return t(section, { returnObjects: true }) as T;
}

export function formatLocale(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{{${key}}}`).join(String(value)), template);
}

export default i18n;
