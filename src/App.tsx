import { lazy, Suspense, useEffect, useMemo } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { setTranslationLocale, useLocaleSection } from './localization';
import AppLayout from './components/layout/AppLayout';
import CompressorPage from './pages/Compressor/CompressorPage';
import CropPage from './pages/CropPage';
import FormatConverterPage from './pages/FormatConverterPage';
import HeicConverterPage from './pages/HeicConverter/HeicConverterPage';
import HomePage from './pages/HomePage';
import ImageBase64Page from './pages/ImageBase64Page';
import ResizePage from './pages/ResizePage';
import RotatePage from './pages/RotatePage';
import WatermarkPage from './pages/WatermarkPage';
import InfoPage from './pages/InfoPage';
import {
  DEFAULT_LOCALE,
  type PageCopy,
  type SupportedLocale,
  SUPPORTED_LOCALES,
  getContentLocale,
  getLocaleFromPath,
  getLocalePath,
  getPreferredLocale,
  LOCALE_STORAGE_KEY,
} from './i18n';

const GifCompressPage = lazy(() => import('./pages/GifCompressPage'));
const SvgCompressPage = lazy(() => import('./pages/SvgCompressPage'));
const ImagesToGifPage = lazy(() => import('./pages/ImagesToGifPage'));
const ImageMergePage = lazy(() => import('./pages/ImageMergePage'));
const PixelArtPage = lazy(() => import('./pages/PixelArtPage'));
const ColorPalettePage = lazy(() => import('./pages/ColorPalettePage'));
const AvatarCropPage = lazy(() => import('./pages/AvatarCropPage'));
const IdPhotoCropPage = lazy(() => import('./pages/IdPhotoCropPage'));
const GlitchImagePage = lazy(() => import('./pages/GlitchImagePage'));
const GlitchGifPage = lazy(() => import('./pages/GlitchGifPage'));
const GifTrimPage = lazy(() => import('./pages/GifTrimPage'));

function getDocumentLang(locale: SupportedLocale): string {
  switch (locale) {
    case 'zh':
      return 'zh-CN';
    case 'zh-tw':
      return 'zh-TW';
    case 'ja':
      return 'ja';
    case 'ko':
      return 'ko';
    default:
      return locale;
  }
}

function getHrefLang(locale: SupportedLocale): string {
  switch (locale) {
    case 'zh':
      return 'zh-Hans';
    case 'zh-tw':
      return 'zh-Hant';
    case 'ja':
      return 'ja';
    case 'ko':
      return 'ko';
    default:
      return locale;
  }
}

function upsertMeta(name: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.name = name;
    document.head.appendChild(element);
  }
  element.content = content;
}

function upsertLink(
  selector: string,
  attributes: Record<string, string>
) {
  let element = document.head.querySelector<HTMLLinkElement>(selector);
  if (!element) {
    element = document.createElement('link');
    document.head.appendChild(element);
  }
  Object.entries(attributes).forEach(([key, value]) => {
    element!.setAttribute(key, value);
  });
}

export default function App() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const locale = useMemo(() => getLocaleFromPath(pathname), [pathname]);
  const contentLocale = getContentLocale(locale ?? DEFAULT_LOCALE);
  const pageCopy = useLocaleSection<PageCopy>('site');
  const { loading } = useLocaleSection<{ loading: string }>('common');
  const loadingFallback = <main className="bg-[#f9fafc] p-8 text-center text-sm font-bold text-slate-500">{loading}</main>;

  useEffect(() => {
    if (!locale) {
      navigate(`/${getPreferredLocale()}`, { replace: true });
      return;
    }

    setTranslationLocale(locale);

    document.documentElement.lang = getDocumentLang(locale);
    document.documentElement.dir = 'ltr';
    document.title = pageCopy.seo.title;
    upsertMeta('description', pageCopy.seo.description);

    const origin = window.location.origin;
    upsertLink('link[rel="canonical"]', {
      rel: 'canonical',
      href: `${origin}${getLocalePath(locale)}`,
    });

    SUPPORTED_LOCALES.forEach((supportedLocale) => {
      const hrefLang = getHrefLang(supportedLocale);
      upsertLink(`link[rel="alternate"][hreflang="${hrefLang}"]`, {
        rel: 'alternate',
        hreflang: hrefLang,
        href: `${origin}${getLocalePath(supportedLocale)}`,
      });
    });

    upsertLink('link[rel="alternate"][hreflang="x-default"]', {
      rel: 'alternate',
      hreflang: 'x-default',
      href: `${origin}${getLocalePath(DEFAULT_LOCALE)}`,
    });
  }, [locale, pageCopy, navigate]);

  const handleLocaleChange = (nextLocale: SupportedLocale) => {
    localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    
    const segments = pathname.split('/').filter(Boolean);
    const rest = segments.slice(1).join('/');
    navigate(`/${nextLocale}${rest ? `/${rest}` : ''}`);
  };

  if (!locale) {
    return null;
  }

  return (
    <Routes>
      <Route
        path="/:locale"
        element={<AppLayout locale={locale} contentLocale={contentLocale} copy={pageCopy} onLocaleChange={handleLocaleChange} />}
      >
        <Route index element={<HomePage />} />
        <Route path="compress" element={<CompressorPage />} />
        <Route path="compress/svg" element={<Suspense fallback={loadingFallback}><SvgCompressPage /></Suspense>} />
        <Route path="resize" element={<ResizePage />} />
        <Route path="resize/by-percentage" element={<ResizePage fixedMode="percent" />} />
        <Route path="resize/by-longest-side" element={<ResizePage fixedMode="longest" />} />
        <Route path="resize/gif" element={<ResizePage gifOnly />} />
        <Route path="gif-trim" element={<Suspense fallback={loadingFallback}><GifTrimPage /></Suspense>} />
        <Route path="crop" element={<CropPage />} />
        <Route path="crop/gif" element={<CropPage gifOnly />} />
        <Route path="avatar-crop" element={<Suspense fallback={loadingFallback}><AvatarCropPage /></Suspense>} />
        <Route path="id-photo-crop" element={<Suspense fallback={loadingFallback}><IdPhotoCropPage /></Suspense>} />
        <Route path="glitch-image" element={<Suspense fallback={loadingFallback}><GlitchImagePage /></Suspense>} />
        <Route path="glitch-gif" element={<Suspense fallback={loadingFallback}><GlitchGifPage /></Suspense>} />
        <Route path="rotate" element={<RotatePage />} />
        <Route path="convert" element={<FormatConverterPage />} />
        <Route path="convert/image-to-jpg" element={<FormatConverterPage fixedFormat="image/jpeg" />} />
        <Route path="convert/image-to-png" element={<FormatConverterPage fixedFormat="image/png" />} />
        <Route path="convert-heic" element={<HeicConverterPage />} />
        <Route path="watermark" element={<WatermarkPage />} />
        <Route path="base64" element={<ImageBase64Page />} />
        <Route path="about" element={<InfoPage kind="about" />} />
        <Route path="terms" element={<InfoPage kind="terms" />} />
        <Route path="privacy" element={<InfoPage kind="privacy" />} />
        <Route
          path="pixel-art"
          element={(
            <Suspense fallback={loadingFallback}>
              <PixelArtPage />
            </Suspense>
          )}
        />
        <Route
          path="color-palette"
          element={(
            <Suspense fallback={loadingFallback}>
              <ColorPalettePage />
            </Suspense>
          )}
        />
        <Route
          path="gif-compress"
          element={(
            <Suspense fallback={loadingFallback}>
              <GifCompressPage />
            </Suspense>
          )}
        />
        <Route
          path="merge-images"
          element={(
            <Suspense fallback={loadingFallback}>
              <ImageMergePage />
            </Suspense>
          )}
        />
        <Route
          path="images-to-gif"
          element={(
            <Suspense fallback={loadingFallback}>
              <ImagesToGifPage />
            </Suspense>
          )}
        />
      </Route>
      <Route path="*" element={<Navigate to={`/${getPreferredLocale()}`} replace />} />
    </Routes>
  );
}
