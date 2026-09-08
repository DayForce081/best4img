import { Outlet, NavLink, Link } from 'react-router-dom';
import type { Locale, PageCopy, SupportedLocale } from '../../i18n';
import { useLocaleSection } from '../../localization';

export default function AppLayout({
  locale,
  contentLocale,
  copy,
  onLocaleChange,
}: {
  locale: SupportedLocale;
  contentLocale: Locale;
  copy: PageCopy;
  onLocaleChange: (locale: SupportedLocale) => void;
}) {
  const layout = useLocaleSection<{ nav: { compress: string; resize: string; crop: string; convert: string; gif: string; all: string }; tools: string[] }>('layout');
  const navText = layout.nav;
  const footerLinks = copy.footer.links;
  const footerLeft = copy.footer.left;
  const currentLanguage = copy.nav.options.find((option) => option.code === locale)?.label ?? copy.nav.current;
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <div className="relative flex flex-1 flex-col overflow-hidden">
        <header className="relative z-30 border-b border-slate-200 bg-white">
          <div className="relative mx-auto flex max-w-[82rem] items-center justify-between px-6 py-4">
            <Link to={`/${locale}`} aria-label={copy.siteName} className="shrink-0">
              <img
                src="/Bestforimg.png"
                alt={copy.siteName}
                className="h-[2.6rem] w-auto"
              />
            </Link>
            <nav className="ml-auto hidden items-center justify-end gap-6 md:flex">
                <NavLink
                  to={`/${locale}/compress`}
                  className={({ isActive }) =>
                    `text-sm font-semibold transition-colors ${
                      isActive ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-900'
                    }`
                  }
                >
                  {navText.compress}
                </NavLink>
                <NavLink
                  to={`/${locale}/resize`}
                  className={({ isActive }) =>
                    `text-sm font-semibold transition-colors ${
                      isActive ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-900'
                    }`
                  }
                >
                  {navText.resize}
                </NavLink>
                <NavLink
                  to={`/${locale}/crop`}
                  className={({ isActive }) =>
                    `text-sm font-semibold transition-colors ${
                      isActive ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-900'
                    }`
                  }
                >
                  {navText.crop}
                </NavLink>
                <NavLink
                  to={`/${locale}/convert`}
                  className={({ isActive }) =>
                    `text-sm font-semibold transition-colors ${
                      isActive ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-900'
                    }`
                  }
                >
                  {navText.convert}
                </NavLink>
                <NavLink
                  to={`/${locale}/images-to-gif`}
                  className={({ isActive }) =>
                    `text-sm font-semibold transition-colors ${
                      isActive ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-900'
                    }`
                  }
                >
                  {navText.gif}
                </NavLink>
                <div className="group relative py-2">
                  <div className="flex items-center gap-1 text-sm font-semibold text-slate-500 transition-colors group-hover:text-slate-900">
                    {navText.all}
                    <span className="material-symbols-outlined text-[18px] transition-transform group-hover:rotate-180">keyboard_arrow_down</span>
                  </div>
                  <div className="invisible absolute right-0 top-full grid w-[39rem] grid-cols-3 gap-1 rounded-lg border border-slate-200 bg-white p-3 opacity-0 shadow-[0_12px_32px_rgba(15,23,42,0.08)] transition-[opacity,visibility] group-hover:visible group-hover:opacity-100">
                    {[
                      ['rotate', 'rotate_right'], ['convert-heic', 'image'], ['watermark', 'branding_watermark'], ['merge-images', 'layers'],
                      ['gif-compress', 'gif'], ['gif-trim', 'content_cut'], ['avatar-crop', 'account_circle'], ['id-photo-crop', 'badge'],
                      ['base64', 'code_blocks'], ['pixel-art', 'grid_on'], ['color-palette', 'palette'], ['glitch-image', 'blur_on'],
                      ['glitch-gif', 'movie_filter'], ['compress/svg', 'data_object'],
                    ].map(([path, icon], index) => (
                      <Link key={path} to={`/${locale}/${path}`} className="flex min-h-12 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800">
                        <span className="material-symbols-outlined shrink-0 text-[21px] text-current">{icon}</span>
                        {layout.tools[index]}
                      </Link>
                    ))}
                  </div>
                </div>
              </nav>
          </div>
        </header>

        <Outlet context={{ copy, locale: contentLocale, routeLocale: locale }} />
      </div>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[82rem] flex-col gap-4 px-6 py-8 text-center md:flex-row md:items-center md:justify-between md:text-left">
          <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-slate-400 md:justify-start">
            <div className="group relative py-2">
              <div
                tabIndex={0}
                role="button"
                aria-haspopup="true"
                aria-label={copy.nav.ariaLabel}
                className="flex h-9 cursor-default items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-slate-600 outline-none transition-colors hover:border-slate-300 hover:bg-white focus-visible:ring-2 focus-visible:ring-indigo-500/30"
              >
                <span className="font-medium">{currentLanguage}</span>
                <span className="material-symbols-outlined text-[16px] transition-transform group-hover:rotate-180">keyboard_arrow_up</span>
              </div>
              <div className="invisible absolute bottom-full left-0 z-50 grid w-[min(82rem,calc(100vw-3rem))] grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-white p-3 text-left opacity-0 shadow-[0_12px_32px_rgba(15,23,42,0.10)] transition-[opacity,visibility] group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-10">
                {copy.nav.options.map((option) => (
                  <button
                    key={option.code}
                    type="button"
                    aria-current={option.code === locale ? 'true' : undefined}
                    onClick={() => {
                      if (option.code !== locale) onLocaleChange(option.code);
                    }}
                    className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-xs transition-colors ${
                      option.code === locale
                        ? 'bg-indigo-50 font-semibold text-indigo-700'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <span className="min-w-0 truncate" title={option.label}>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
            {footerLeft.map((item, index) => (
              <span key={item} className="contents">
                {index > 0 && <span aria-hidden="true">|</span>}
                <span>{item}</span>
              </span>
            ))}
          </div>
          <div className="flex justify-center gap-6 text-xs text-slate-400 md:justify-end">
            {footerLinks.map((label, index) => (
              <Link key={label} to={`/${locale}/${['about', 'terms', 'privacy'][index]}`} className="transition-colors hover:text-slate-700">
                {label}
              </Link>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
