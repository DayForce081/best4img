const CONTENT_LOCALES = ['en', 'zh', 'zh-tw', 'ja', 'ko'] as const;
export const SUPPORTED_LOCALES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'zh-tw'] as const;

export type Locale = (typeof CONTENT_LOCALES)[number];
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

type LocaleOption = {
  code: SupportedLocale;
  label: string;
};

type CompareCopy = {
  original: string;
  compressed: string;
  before: string;
  after: string;
};

type FeatureCard =
  | { type: 'compare'; title: string; body: string }
  | { type: 'image'; title: string; body: string };

export type PageCopy = {
  siteName: string;
  seo: {
    title: string;
    description: string;
  };
  nav: {
    ariaLabel: string;
    current: string;
    options: LocaleOption[];
    tools: {
      compressor: string;
      heicConverter: string;
    };
  };
  heicConverter: {
    heroTitle: string;
    heroSubtitle: string;
    dropTitle: string;
    dropHint: string;
    downloadAll: string;
    zipName: string;
    formatJpg: string;
    formatPng: string;
    statuses: {
      converting: string;
      waiting: string;
      completed: string;
      error: string;
    };
    errors: {
      exceedsLimit: string;
      unsupportedFormat: string;
      failedToProcess: string;
    };
    actions: {
      download: string;
    };
    settings: {
      title: string;
      quality: string;
      qualityHint: string;
      orientation: string;
      orientationAuto: string;
      orientationHint: string;
      metadata: string;
      metadataRemoved: string;
      metadataHint: string;
    };
    content: {
      hero: {
        title: string;
        subtitle: string;
      };
      featureCards: Array<{ icon: string; title: string; body: string }>;
      underHood: {
        eyebrow: string;
        title: string;
        cards: Array<{ title: string; body: string }>;
      };
    };
  };
  compressor: {
    heroTitle: string;
    heroSubtitle: string;
    dropTitle: string;
    dropHint: string;
    downloadAll: string;
    zipName: string;
    statuses: {
      compressing: string;
      waiting: string;
      completed: string;
      error: string;
    };
    errors: {
      exceedsLimit: string;
      unsupportedFormat: string;
      failedToProcess: string;
    };
    actions: {
      download: string;
    };
    settings?: {
      title: string;
      quality: string;
      qualityHint: string;
      targetSize: string;
      targetSizeHint: string;
      unlimited: string;
    };
  };
  hero: {
    title: string;
    subtitle: string;
  };
  featureCards: [FeatureCard, FeatureCard];
  autopilot: {
    title: string;
    body: string;
  };
  underHood: {
    eyebrow: string;
    title: string;
    cards: Array<{ title: string; body: string }>;
  };
  footer: {
    left: string[];
    links: string[];
  };
  compare: CompareCopy;
};

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'best4img_locale';

function normalizeBrowserLocale(input: string | null | undefined): SupportedLocale | null {
  if (!input) return null;
  const normalized = input.toLowerCase().replace('_', '-');

  if (normalized === 'zh-tw' || normalized === 'zh-hk' || normalized === 'zh-mo') {
    return 'zh-tw';
  }
  if (normalized === 'zh-cn' || normalized === 'zh-sg') {
    return 'zh';
  }
  if (SUPPORTED_LOCALES.includes(normalized as SupportedLocale)) {
    return normalized as SupportedLocale;
  }

  const base = normalized.split('-')[0];
  if (SUPPORTED_LOCALES.includes(base as SupportedLocale)) return base as SupportedLocale;

  return null;
}

export function normalizeLocale(input: string | null | undefined): SupportedLocale | null {
  return normalizeBrowserLocale(input);
}

export function getPreferredLocale(): SupportedLocale {
  const saved = normalizeLocale(typeof window !== 'undefined' ? localStorage.getItem(LOCALE_STORAGE_KEY) : null);
  if (saved) return saved;

  if (typeof navigator !== 'undefined') {
    const browserLocales = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const candidate of browserLocales) {
      const locale = normalizeLocale(candidate);
      if (locale) return locale;
    }
  }

  return DEFAULT_LOCALE;
}

export function getLocalePath(locale: SupportedLocale): string {
  return `/${locale}/`;
}

export function getLocaleFromPath(pathname: string): SupportedLocale | null {
  const match = pathname.match(/^\/([a-z]{2}(?:-[a-z]{2})?)(?:\/|$)/i);
  return normalizeLocale(match?.[1]);
}

export function getContentLocale(locale: SupportedLocale): Locale {
  return CONTENT_LOCALES.includes(locale as Locale) ? locale as Locale : DEFAULT_LOCALE;
}
